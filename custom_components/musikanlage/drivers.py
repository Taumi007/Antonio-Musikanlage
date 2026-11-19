"""Device drivers: Sonos (via HA media_player services) and mixers."""

from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod

from homeassistant.core import HomeAssistant, State

from .const import (
    RAMP_STEP_SECONDS,
    TIMEOUT_GROUP,
    TIMEOUT_MIXER,
    TIMEOUT_TRANSPORT,
    TIMEOUT_VOLUME,
    VOLUME_TOLERANCE,
)
from .feedback import FeedbackTimeout, wait_for_state
from .topology import MixerConfig
from .xair import MIN_DB, db_to_pos, pos_to_db, ramp_db

_LOGGER = logging.getLogger(__name__)
MP = "media_player"


# --------------------------------------------------------------------------- Sonos


class SonosDriver:
    """Controls one Sonos player through HA's media_player services."""

    def __init__(self, hass: HomeAssistant, entity_id: str) -> None:
        self.hass = hass
        self.entity_id = entity_id

    def _state(self) -> State | None:
        return self.hass.states.get(self.entity_id)

    @property
    def volume(self) -> float:
        st = self._state()
        return float(st.attributes.get("volume_level") or 0.0) if st else 0.0

    async def _call(self, service: str, **data) -> None:
        await self.hass.services.async_call(
            MP, service, {"entity_id": self.entity_id, **data}, blocking=True
        )

    async def set_volume(self, volume: float) -> None:
        if abs(self.volume - volume) < VOLUME_TOLERANCE:
            return
        await self._call("volume_set", volume_level=round(volume, 2))
        await wait_for_state(
            self.hass,
            self.entity_id,
            lambda s: abs(float(s.attributes.get("volume_level") or 0) - volume) < VOLUME_TOLERANCE,
            TIMEOUT_VOLUME,
            f"volume {volume:.2f}",
        )

    async def ramp_volume(self, target: float, seconds: float) -> None:
        start = self.volume
        steps = max(1, round(seconds / RAMP_STEP_SECONDS))
        for i in range(1, steps + 1):
            t0 = time.monotonic()
            await self.set_volume(start + (target - start) * i / steps)
            # pacing of the fade itself; each step is still confirmed by the device
            rest = RAMP_STEP_SECONDS - (time.monotonic() - t0)
            if rest > 0 and i < steps:
                await asyncio.sleep(rest)

    async def pause(self) -> None:
        st = self._state()
        if st is None or st.state != "playing":
            return
        await self._call("media_pause")
        await wait_for_state(
            self.hass, self.entity_id, lambda s: s.state != "playing", TIMEOUT_TRANSPORT, "paused"
        )

    async def unjoin(self) -> None:
        await self._call("unjoin")
        await wait_for_state(
            self.hass,
            self.entity_id,
            lambda s: list(s.attributes.get("group_members") or [self.entity_id]) == [self.entity_id],
            TIMEOUT_GROUP,
            "ungrouped",
        )

    async def join(self, members: list[str]) -> None:
        await self._call("join", group_members=members)
        wanted = {self.entity_id, *members}
        await wait_for_state(
            self.hass,
            self.entity_id,
            lambda s: wanted <= set(s.attributes.get("group_members") or []),
            TIMEOUT_GROUP,
            f"group {sorted(wanted)}",
        )

    async def play_uri(self, uri: str, hdmi: bool = False) -> None:
        try:
            await self._call(
                "play_media", media={"media_content_id": uri, "media_content_type": "music"}
            )
            await wait_for_state(
                self.hass,
                self.entity_id,
                lambda s: s.state == "playing" and s.attributes.get("media_content_id") == uri,
                TIMEOUT_TRANSPORT,
                f"playing {uri}",
            )
        except Exception as err:  # noqa: BLE001 - Sonos refuses the HT stream in some cases
            if not hdmi:
                raise
            _LOGGER.info("%s: HT stream refused (%s), falling back to source TV", self.entity_id, err)
            await self._call("select_source", source="TV")
            await wait_for_state(
                self.hass,
                self.entity_id,
                lambda s: s.attributes.get("source") == "TV",
                TIMEOUT_TRANSPORT,
                "source TV",
            )

    async def play_favorite(self, favorite: str) -> None:
        await self._call(
            "play_media", media={"media_content_id": favorite, "media_content_type": "favorite_item_id"}
        )
        await wait_for_state(
            self.hass, self.entity_id, lambda s: s.state == "playing", TIMEOUT_TRANSPORT, "playing"
        )


# --------------------------------------------------------------------------- Mixer


class MixerDriver(ABC):
    """Mixer abstraction. Levels are in dB."""

    def __init__(self, cfg: MixerConfig) -> None:
        self.cfg = cfg

    def channels(self, inputs: tuple[str, ...]) -> list[int]:
        if "*" in inputs:
            return sorted({c for chs in self.cfg.inputs.values() for c in chs})
        out: list[int] = []
        for i in inputs:
            out.extend(self.cfg.inputs.get(i, (int(i),) if i.isdigit() else ()))
        return out

    @abstractmethod
    def get_db(self, channel: int) -> float: ...

    @abstractmethod
    async def set_db(self, channel: int, db: float) -> None: ...

    async def fade(self, inputs: tuple[str, ...], db: float, seconds: float) -> None:
        chans = self.channels(inputs)
        steps = max(1, round(seconds / RAMP_STEP_SECONDS))
        ramps = {c: ramp_db(self.get_db(c), db, steps) for c in chans if abs(self.get_db(c) - db) > 0.05}
        for i in range(steps):
            t0 = time.monotonic()
            await asyncio.gather(*(self.set_db(c, r[i]) for c, r in ramps.items()))
            rest = RAMP_STEP_SECONDS - (time.monotonic() - t0)
            if rest > 0 and i < steps - 1:
                await asyncio.sleep(rest)

    async def mic(self, on: bool) -> None:
        await self.fade((str(self.cfg.mic_channel),), self.cfg.mic_db if on else MIN_DB, 0.5)

    def snapshot(self) -> dict[int, float]:
        chans = sorted({c for chs in self.cfg.inputs.values() for c in chs} | {self.cfg.mic_channel})
        return {c: round(self.get_db(c), 1) for c in chans}


class VirtualMixer(MixerDriver):
    """In-memory mixer for tests without hardware."""

    def __init__(self, cfg: MixerConfig) -> None:
        super().__init__(cfg)
        self._db: dict[int, float] = {}

    def get_db(self, channel: int) -> float:
        return self._db.get(channel, MIN_DB)

    async def set_db(self, channel: int, db: float) -> None:
        self._db[channel] = db


class BehringerEntityMixer(MixerDriver):
    """Uses the number.<prefix>_channel_<n>_fader entities of ha_behringer_mixer.

    Fader entities are 0..100 (position); conversion to dB uses the X Air
    fader law. Every write is confirmed by the entity state coming back from
    the mixer.
    """

    def __init__(self, hass: HomeAssistant, cfg: MixerConfig) -> None:
        super().__init__(cfg)
        self.hass = hass

    def _entity(self, channel: int) -> str:
        return f"number.{self.cfg.prefix}_channel_{channel}_fader"

    def get_db(self, channel: int) -> float:
        st = self.hass.states.get(self._entity(channel))
        try:
            return pos_to_db(float(st.state) / 100.0)
        except (AttributeError, TypeError, ValueError):
            return MIN_DB

    async def set_db(self, channel: int, db: float) -> None:
        entity = self._entity(channel)
        value = round(db_to_pos(db) * 100.0, 3)
        await self.hass.services.async_call(
            "number", "set_value", {"entity_id": entity, "value": value}, blocking=True
        )
        try:
            await wait_for_state(
                self.hass,
                entity,
                lambda s: _close(s.state, value),
                TIMEOUT_MIXER,
                f"fader {value}",
            )
        except FeedbackTimeout:
            _LOGGER.warning("%s did not confirm %s", entity, value)
            raise


def _close(state: str, value: float) -> bool:
    try:
        return abs(float(state) - value) < 0.5
    except ValueError:
        return False


def make_mixer(hass: HomeAssistant, cfg: MixerConfig) -> MixerDriver:
    if cfg.type == "behringer_entities":
        return BehringerEntityMixer(hass, cfg)
    return VirtualMixer(cfg)
