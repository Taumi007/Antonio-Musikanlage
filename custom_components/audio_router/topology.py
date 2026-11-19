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
class Topology:
    zones: dict[str, Zone]
    interfaces: dict[str, Interface]
    mixers: dict[str, MixerConfig]
    favorites: dict[str, str]
    max_radio_volume: float

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
        interfaces[iid] = Interface(
            id=iid,
            player=i["player"],
            uid=uid_for(i["player"]),
            kind=InterfaceKind(i["kind"]),
            mixer=mixer,
        )

    for z in zones.values():
        for v in [*z.mixer_volume.values(), *z.radio_volume.values()]:
            if not 0.0 <= v <= 1.0:
                raise TopologyError(f"Zone {z.id}: volumes are 0..1, got {v}")

    return Topology(
        zones=zones,
        interfaces=interfaces,
        mixers=mixers,
        favorites={str(k): str(v) for k, v in (raw.get("favorites") or {}).items()},
        max_radio_volume=float(raw.get("max_radio_volume", 0.5)),
    )
