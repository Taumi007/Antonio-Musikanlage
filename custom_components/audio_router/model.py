"""Pure data model of the audio routing graph (no Home Assistant imports).

Graph:  Source ──► Interface (physical input on a Sonos) ──► Zone (Sonos player / group)

* A *source* is something that produces audio: a mixer bus, a web radio
  favourite, a TV.
* An *interface* is the physical entry point of a mixer into the Sonos world
  (HDMI/optical on an Amp or Arc, analog line-in on a Five / Era / Amp).
  Each interface has a latency class.
* A *zone* is a Sonos player that should play something.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class InterfaceKind(StrEnum):
    """Physical input type of a Sonos device."""

    HDMI = "hdmi"  # x-sonos-htastream:<UID>:spdif  (~ low latency, only on the device itself)
    LINE_IN = "line_in"  # x-rincon-stream:<UID>  (~75 ms, can be shared to other players)


class SourceKind(StrEnum):
    """Kind of audio source."""

    MIXER = "mixer"  # mixer output: Sonos at fixed reference volume, mixer controls level
    RADIO = "radio"  # Sonos favourite / stream: Sonos volume controls level
    NONE = "none"  # silence / stopped


class Preset(StrEnum):
    """Loudness presets."""

    NORMAL = "normal"
    LAUTER = "lauter"
    PARTY = "party"


class Latency(StrEnum):
    """Latency class of a zone member or interface."""

    LOW = "low"  # wired, HDMI on the device itself
    MEDIUM = "medium"  # line-in (75 ms buffer)
    HIGH = "high"  # wireless speaker (Move 2) in the group


@dataclass(frozen=True, slots=True)
class Interface:
    """Physical input on a Sonos player."""

    id: str
    player: str  # media_player entity_id of the device that owns the input
    uid: str  # RINCON_... of that device
    kind: InterfaceKind
    mixer: str | None = None  # id of the mixer wired to this input

    @property
    def latency(self) -> Latency:
        return Latency.LOW if self.kind is InterfaceKind.HDMI else Latency.MEDIUM


@dataclass(frozen=True, slots=True)
class Zone:
    """A Sonos player the router controls."""

    id: str
    player: str  # media_player entity_id
    uid: str
    wireless: bool = False  # e.g. Move 2 on WiFi -> raises group latency
    # Calibrated Sonos volume (0..1) when it plays a mixer feed, per mixer id.
    mixer_volume: dict[str, float] = field(default_factory=dict)
    # Sonos volume (0..1) for radio per preset.
    radio_volume: dict[Preset, float] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Route:
    """Desired state for a set of zones."""

    zones: tuple[str, ...]
    kind: SourceKind
    # MIXER: interface id the mixer feed enters through
    interface: str | None = None
    # MIXER: mixer channel (input) to open, e.g. "5" for PC
    mixer_input: str | None = None
    # RADIO: Sonos favourite id (e.g. "FV:2/5")
    favorite: str | None = None
    preset: Preset = Preset.NORMAL
    mic: bool = True
    # Mic present -> latency is critical
    latency_critical: bool | None = None

    @property
    def is_latency_critical(self) -> bool:
        if self.latency_critical is not None:
            return self.latency_critical
        return self.kind is SourceKind.MIXER and self.mic


class RouteError(ValueError):
    """Route is not allowed."""


def validate_route(route: Route, zones: dict[str, Zone], interfaces: dict[str, Interface]) -> list[str]:
    """Raise RouteError for impossible routes, return warnings for questionable ones."""
    warnings: list[str] = []
    if not route.zones:
        raise RouteError("Route has no zones")
    unknown = [z for z in route.zones if z not in zones]
    if unknown:
        raise RouteError(f"Unknown zones: {unknown}")

    if route.kind is SourceKind.MIXER:
        if route.interface not in interfaces:
            raise RouteError(f"Unknown interface: {route.interface}")
        iface = interfaces[route.interface]
        if iface.kind is InterfaceKind.HDMI:
            others = [z for z in route.zones if zones[z].player != iface.player]
            if others:
                # Sonos refuses to play the HT stream on the HDMI device while
                # the command contains other players; and grouping raises latency.
                raise RouteError(
                    f"HDMI input {iface.id} can only be played on its own device; "
                    f"route the other zones {others} through a line-in instead"
                )
        if route.is_latency_critical:
            wireless = [z for z in route.zones if zones[z].wireless]
            if wireless:
                raise RouteError(f"Wireless zones {wireless} are not allowed while the microphone is in use")
            if iface.kind is InterfaceKind.LINE_IN:
                warnings.append(f"Microphone via line-in {iface.id}: ~75 ms Sonos latency")
        for z in route.zones:
            if iface.mixer and iface.mixer not in zones[z].mixer_volume:
                warnings.append(f"Zone {z} has no calibrated volume for mixer {iface.mixer}")
    elif route.kind is SourceKind.RADIO:
        if not route.favorite:
            raise RouteError("Radio route needs a favourite")
    return warnings
