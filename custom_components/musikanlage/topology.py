"""Parse the topology config (dict from YAML) into the model. Pure logic."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .model import Interface, InterfaceKind, Preset, Zone


@dataclass(frozen=True, slots=True)
class MixerConfig:
    id: str
    type: str  # "behringer_entities" | "virtual"
    prefix: str | None = None  # entity prefix for behringer_entities, e.g. "restaurant_mixer"
    inputs: dict[str, tuple[int, ...]] = field(default_factory=dict)  # input -> channels
    mic_channel: int = 1
    mic_db: float = 0.0
    levels: dict[Preset, float] = field(default_factory=dict)  # preset -> dB


@dataclass(frozen=True, slots=True)
class QuickAction:
    """A dashboard button: one route with fixed parameters."""

    id: str
    name: str
    zones: tuple[str, ...]
    source: str  # "mixer:<interface>", "radio:<favourite>" or "none"
    area: str = ""
    icon: str = ""
    input: str | None = None
    preset: str = "normal"
    mic: bool = True


@dataclass(frozen=True, slots=True)
class FollowAp:
    """A portable speaker joins the zone its WiFi access point belongs to."""

    zone: str  # the portable zone
    tracker: str  # UniFi device_tracker of the speaker (attribute ap_mac)
    aps: dict[str, str]  # ap_mac (lower case) -> zone id to join
    auto: bool = True


@dataclass(frozen=True, slots=True)
class Topology:
    zones: dict[str, Zone]
    interfaces: dict[str, Interface]
    mixers: dict[str, MixerConfig]
    favorites: dict[str, str]
    max_radio_volume: float
    quick_actions: tuple[QuickAction, ...] = ()
    follow_ap: tuple[FollowAp, ...] = ()
    names: dict[str, str] = field(default_factory=dict)  # zone id -> display name
    areas: dict[str, str] = field(default_factory=dict)  # zone id -> area label
    raw: dict[str, Any] = field(default_factory=dict)

    def level_table(self) -> dict[tuple[str, Preset], float]:
        return {(m.id, p): db for m in self.mixers.values() for p, db in m.levels.items()}


class TopologyError(ValueError):
    """Invalid topology."""


def _presets(raw: dict[str, Any] | None) -> dict[Preset, float]:
    return {Preset(k): float(v) for k, v in (raw or {}).items()}


def parse_topology(raw: dict[str, Any], uids: dict[str, str]) -> Topology:
    """Build a Topology. ``uids`` maps media_player entity_id -> RINCON uid."""
    if not isinstance(raw, dict):
        raise TopologyError("Topology must be a mapping")

    def uid_for(player: str) -> str:
        if player not in uids:
            raise TopologyError(f"{player} is not a known Sonos player")
        return uids[player]

    mixers: dict[str, MixerConfig] = {}
    for mid, m in (raw.get("mixers") or {}).items():
        mtype = m.get("type", "virtual")
        if mtype not in ("virtual", "behringer_entities"):
            raise TopologyError(f"Mixer {mid}: unknown type {mtype}")
        if mtype == "behringer_entities" and not m.get("prefix"):
            raise TopologyError(f"Mixer {mid}: prefix required")
        mixers[mid] = MixerConfig(
            id=mid,
            type=mtype,
            prefix=m.get("prefix"),
            inputs={str(k): tuple(int(c) for c in v) for k, v in (m.get("inputs") or {}).items()},
            mic_channel=int(m.get("mic_channel", 1)),
            mic_db=float(m.get("mic_db", 0.0)),
            levels=_presets(m.get("levels")),
        )

    zones: dict[str, Zone] = {}
    for zid, z in (raw.get("zones") or {}).items():
        player = z["player"]
        mv = {str(k): float(v) for k, v in (z.get("mixer_volume") or {}).items()}
        for mid in mv:
            if mid not in mixers:
                raise TopologyError(f"Zone {zid}: unknown mixer {mid}")
        zones[zid] = Zone(
            id=zid,
            player=player,
            uid=uid_for(player),
            wireless=bool(z.get("wireless", False)),
            mixer_volume=mv,
            radio_volume=_presets(z.get("radio_volume")),
        )
    if not zones:
        raise TopologyError("At least one zone is required")

    interfaces: dict[str, Interface] = {}
    for iid, i in (raw.get("interfaces") or {}).items():
        mixer = i.get("mixer")
        if mixer and mixer not in mixers:
            raise TopologyError(f"Interface {iid}: unknown mixer {mixer}")
        uid = str(i.get("uid") or uid_for(i["player"]))
        if not uid.startswith("RINCON_"):
            raise TopologyError(f"Interface {iid}: uid must start with RINCON_")
        interfaces[iid] = Interface(
            id=iid,
            player=i["player"],
            # Stereo pairs: HA's entity belongs to one speaker, the input may be on the other
            uid=uid,
            kind=InterfaceKind(i["kind"]),
            mixer=mixer,
        )

    for z in zones.values():
        for v in [*z.mixer_volume.values(), *z.radio_volume.values()]:
            if not 0.0 <= v <= 1.0:
                raise TopologyError(f"Zone {z.id}: volumes are 0..1, got {v}")

    favorites = {str(k): str(v) for k, v in (raw.get("favorites") or {}).items()}

    def check_source(where: str, source: str) -> None:
        kind, _, ref = source.partition(":")
        if kind == "mixer" and ref not in interfaces:
            raise TopologyError(f"{where}: unknown interface {ref}")
        if kind == "radio" and not ref:
            raise TopologyError(f"{where}: radio needs a favourite")
        if kind not in ("mixer", "radio", "none"):
            raise TopologyError(f"{where}: unknown source {source}")

    quick: list[QuickAction] = []
    for i, q in enumerate(raw.get("quick_actions") or []):
        qid = str(q.get("id") or f"qa{i + 1}")
        qz = tuple(str(z) for z in q.get("zones") or [])
        if not qz or any(z not in zones for z in qz):
            raise TopologyError(f"Quick action {qid}: unknown or missing zones {list(qz)}")
        source = str(q.get("source") or "")
        check_source(f"Quick action {qid}", source)
        quick.append(
            QuickAction(
                id=qid,
                name=str(q.get("name") or qid),
                zones=qz,
                source=source,
                area=str(q.get("area") or ""),
                icon=str(q.get("icon") or ""),
                input=None if q.get("input") in (None, "") else str(q["input"]),
                preset=str(q.get("preset") or "normal"),
                mic=bool(q.get("mic", True)),
            )
        )

    follow: list[FollowAp] = []
    for zid, z in (raw.get("zones") or {}).items():
        fa = z.get("follow_ap")
        if not fa:
            continue
        aps = {str(k).lower(): str(v) for k, v in (fa.get("aps") or {}).items()}
        for target in aps.values():
            if target not in zones or target == zid:
                raise TopologyError(f"Zone {zid}: follow_ap target {target} is not another zone")
        if not fa.get("tracker"):
            raise TopologyError(f"Zone {zid}: follow_ap needs a tracker")
        follow.append(FollowAp(zone=zid, tracker=str(fa["tracker"]), aps=aps, auto=bool(fa.get("auto", True))))

    zones_raw = raw.get("zones") or {}
    return Topology(
        zones=zones,
        interfaces=interfaces,
        mixers=mixers,
        favorites=favorites,
        max_radio_volume=float(raw.get("max_radio_volume", 0.5)),
        quick_actions=tuple(quick),
        follow_ap=tuple(follow),
        names={zid: str(z.get("name") or zid) for zid, z in zones_raw.items()},
        areas={zid: str(z.get("area") or "") for zid, z in zones_raw.items()},
        raw=raw,
    )
