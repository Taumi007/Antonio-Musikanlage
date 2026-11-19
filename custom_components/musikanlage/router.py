"""Router: reads current state, plans, executes plans, guards against volume blasts."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.util import dt as dt_util

from .const import SIGNAL_ROUTE_UPDATED
from .drivers import MixerDriver, SonosDriver, make_mixer
from .model import Preset, Route, RouteError, SourceKind
from .planner import (
    Join,
    MixerFade,
    MixerMic,
    Pause,
    Plan,
    PlayFavorite,
    PlayUri,
    Step,
    Unjoin,
    VolumeRamp,
    VolumeSet,
    ZoneState,
    plan_route,
)
from .sonos_uri import is_input_stream, stream_key
from .topology import Topology

_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class RouterStatus:
    busy: bool = False
    last_route: dict[str, Any] | None = None
    last_plan: list[str] = field(default_factory=list)
    last_error: str | None = None
    last_warnings: list[str] = field(default_factory=list)
    guard_events: list[str] = field(default_factory=list)
    updated: datetime | None = None


class AudioRouter:
    """One router per config entry."""

    def __init__(self, hass: HomeAssistant, topology: Topology) -> None:
        self.hass = hass
        self.topo = topology
        self.sonos = {zid: SonosDriver(hass, z.player) for zid, z in topology.zones.items()}
        self.mixers: dict[str, MixerDriver] = {
            mid: make_mixer(hass, cfg) for mid, cfg in topology.mixers.items()
        }
        self._lock = asyncio.Lock()
        self._in_transition: set[str] = set()
        self.status = RouterStatus()
        self._unsub: list = []

    # ------------------------------------------------------------------ lifecycle

    @callback
    def async_start(self) -> None:
        players = [z.player for z in self.topo.zones.values()]
        self._unsub.append(async_track_state_change_event(self.hass, players, self._guard))

    @callback
    def async_stop(self) -> None:
        while self._unsub:
            self._unsub.pop()()

    # ------------------------------------------------------------------ state

    def _zone_by_player(self, player: str) -> str | None:
        return next((zid for zid, z in self.topo.zones.items() if z.player == player), None)

    def current_state(self) -> dict[str, ZoneState]:
        out: dict[str, ZoneState] = {}
        for zid, z in self.topo.zones.items():
            st = self.hass.states.get(z.player)
            if st is None:
                continue
            group = tuple(
                g for g in (self._zone_by_player(p) for p in st.attributes.get("group_members") or []) if g
            ) or (zid,)
            out[zid] = ZoneState(
                playing=st.state == "playing",
                uri=st.attributes.get("media_content_id"),
                volume=float(st.attributes.get("volume_level") or 0.0),
                group=group,
            )
        return out

    # ------------------------------------------------------------------ routing

    def build_route(
        self, zones: list[str], source: str, mixer_input: str | None, preset: str, mic: bool
    ) -> Route:
        kind, _, ref = source.partition(":")
        if kind == "mixer":
            return Route(tuple(zones), SourceKind.MIXER, interface=ref, mixer_input=mixer_input,
                         preset=Preset(preset), mic=mic)
        if kind == "radio":
            fav = self.topo.favorites.get(ref, ref)
            return Route(tuple(zones), SourceKind.RADIO, favorite=fav, preset=Preset(preset), mic=False)
        if kind == "none":
            return Route(tuple(zones), SourceKind.NONE)
        raise RouteError(f"Unknown source {source}")

    def plan(self, route: Route) -> Plan:
        return plan_route(
            route,
            self.topo.zones,
            self.topo.interfaces,
            self.current_state(),
            mixer_level_db=self.topo.level_table(),
        )

    async def async_route(self, route: Route, dry_run: bool = False) -> Plan:
        try:
            plan = self.plan(route)
        except RouteError as err:
            raise HomeAssistantError(str(err)) from err
        if dry_run:
            return plan
        async with self._lock:
            self._in_transition = set(route.zones)
            self.status.busy = True
            self.status.last_plan = plan.describe()
            self.status.last_warnings = plan.warnings
            self.status.last_error = None
            self._notify()
            try:
                for stage in plan.stages:
                    await asyncio.gather(*(self._run(step) for step in stage))
                self.status.last_route = {
                    "zones": list(route.zones),
                    "kind": route.kind.value,
                    "interface": route.interface,
                    "input": route.mixer_input,
                    "favorite": route.favorite,
                    "preset": route.preset.value,
                    "mic": route.mic,
                }
            except Exception as err:
                self.status.last_error = str(err)
                _LOGGER.error("Transition aborted: %s", err)
                await self._emergency_quiet(route)
                raise HomeAssistantError(f"Transition aborted: {err}") from err
            finally:
                self._in_transition = set()
                self.status.busy = False
                self._notify()
        return plan

    async def _run(self, step: Step) -> None:
        _LOGGER.debug("step: %s", step.describe())
        match step:
            case MixerFade(mixer=m, inputs=i, db=db, seconds=s):
                await self.mixers[m].fade(i, db, s)
            case MixerMic(mixer=m, on=on):
                await self.mixers[m].mic(on)
            case VolumeRamp(zone=z, volume=v, seconds=s):
                await self.sonos[z].ramp_volume(v, s)
            case VolumeSet(zone=z, volume=v):
                await self.sonos[z].set_volume(v)
            case Pause(zone=z):
                await self.sonos[z].pause()
            case Unjoin(zone=z):
                await self.sonos[z].unjoin()
            case Join(coordinator=c, members=mem):
                await self.sonos[c].join([self.topo.zones[m].player for m in mem])
            case PlayUri(zone=z, uri=uri, hdmi=hdmi):
                await self.sonos[z].play_uri(uri, hdmi)
            case PlayFavorite(zone=z, favorite=fav):
                await self.sonos[z].play_favorite(fav)
            case _:
                raise RuntimeError(f"Unknown step {step}")

    async def _emergency_quiet(self, route: Route) -> None:
        """After a failed step: never leave a zone loud on an unknown source.

        Volume first (works on every input), then pause; each step is tried
        on its own so one failure does not skip the other.
        """
        for zid in route.zones:
            drv = self.sonos[zid]
            safe = self.topo.zones[zid].radio_volume.get(Preset.NORMAL, 0.1)
            for action in (lambda: drv.set_volume(safe), drv.pause):
                try:
                    await action()
                except Exception as err:  # noqa: BLE001
                    _LOGGER.error("Emergency quiet step failed for %s: %s", zid, err)

    # ------------------------------------------------------------------ guard

    @callback
    def _guard(self, event: Event[EventStateChangedData]) -> None:
        """Clamp volume when something outside the router starts non-mixer content loud.

        Catches the Sonos app, alarms, TV autoplay, sonos.restore, buttons...
        """
        new, old = event.data["new_state"], event.data["old_state"]
        if new is None or self._lock.locked():
            return
        zid = self._zone_by_player(new.entity_id)
        if zid is None or zid in self._in_transition:
            return
        uri = new.attributes.get("media_content_id")
        vol = float(new.attributes.get("volume_level") or 0.0)
        if new.state != "playing" or is_input_stream(uri):
            return
        changed = old is None or old.attributes.get("media_content_id") != uri or old.state != "playing"
        if not changed or vol <= self.topo.max_radio_volume:
            return
        safe = self.topo.zones[zid].radio_volume.get(Preset.NORMAL, 0.1)
        msg = f"{dt_util.now():%H:%M:%S} {zid}: {uri} started at {vol:.2f} -> clamped to {safe:.2f}"
        _LOGGER.warning("Guard: %s", msg)
        self.status.guard_events = [msg, *self.status.guard_events][:10]
        self.hass.async_create_task(self.sonos[zid].set_volume(safe))
        self._notify()

    # ------------------------------------------------------------------ graph

    def graph(self) -> dict[str, Any]:
        """Nodes/edges for the flow diagram card."""
        state = self.current_state()
        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []
        for mid, m in self.mixers.items():
            nodes.append({"id": f"mixer:{mid}", "type": "mixer", "levels_db": m.snapshot()})
        for iid, i in self.topo.interfaces.items():
            nodes.append({"id": f"iface:{iid}", "type": "interface", "kind": i.kind.value,
                          "latency": i.latency.value})
            if i.mixer:
                edges.append({"from": f"mixer:{i.mixer}", "to": f"iface:{iid}", "active": False})
        for zid, z in self.topo.zones.items():
            s = state.get(zid, ZoneState())
            nodes.append({"id": f"zone:{zid}", "type": "zone", "playing": s.playing,
                          "volume": s.volume, "wireless": z.wireless, "group": list(s.group)})
            if s.playing and is_input_stream(s.uri):
                for iid, i in self.topo.interfaces.items():
                    if stream_key(s.uri) == (i.kind.value, i.uid):
                        edges.append({"from": f"iface:{iid}", "to": f"zone:{zid}", "active": True})
                        for e in edges:
                            if e["to"] == f"iface:{iid}":
                                e["active"] = True
            elif s.playing:
                edges.append({"from": "radio", "to": f"zone:{zid}", "active": True, "uri": s.uri})
        if any(e["from"] == "radio" for e in edges):
            nodes.append({"id": "radio", "type": "radio"})
        return {"nodes": nodes, "edges": edges}

    def options(self) -> dict[str, Any]:
        """What the panel can offer as quick actions."""
        return {
            "zones": [
                {"id": zid, "player": z.player, "wireless": z.wireless}
                for zid, z in self.topo.zones.items()
            ],
            "interfaces": [
                {"id": iid, "kind": i.kind.value, "mixer": i.mixer, "player": i.player}
                for iid, i in self.topo.interfaces.items()
            ],
            "mixer_inputs": {mid: list(m.inputs) for mid, m in self.topo.mixers.items()},
            "favorites": list(self.topo.favorites),
        }

    @callback
    def _notify(self) -> None:
        self.status.updated = dt_util.utcnow()
        async_dispatcher_send(self.hass, SIGNAL_ROUTE_UPDATED)
