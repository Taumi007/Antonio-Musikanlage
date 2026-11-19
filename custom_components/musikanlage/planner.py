"""Turn a desired Route into an ordered, safe transition plan.

Pure logic, no Home Assistant imports -> unit testable.

Safety rules the plan always follows:

1. Nothing audible changes source while it is loud:
   * mixer music is faded to -inf *before* any Sonos switches to a mixer feed,
   * a Sonos playing radio/anything else is ramped to 0 and paused first.
2. The high "mixer reference" volume (e.g. 80) is only set while the zone is
   silent (paused, or mixer at -inf), and the mixer fades up only after the
   Sonos confirmed source, group and volume.
3. A zone that leaves mixer mode is paused and set back to its radio volume
   *before* anything else is played, so no app/alarm/autoplay can ever start
   at the mixer reference volume.

The plan is a list of *stages*; the steps inside a stage are independent and
may run in parallel, stages run strictly one after another. Every step is
completed by device feedback (state change), never by a fixed delay.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .model import (
    Interface,
    InterfaceKind,
    Preset,
    Route,
    SourceKind,
    Zone,
    validate_route,
)
from .sonos_uri import interface_uri, is_input_stream, same_stream, stream_key, uid_from_uri

MIXER_OFF_DB = -90.0


@dataclass(frozen=True, slots=True)
class ZoneState:
    """What a zone is doing right now (from HA state)."""

    playing: bool = False
    uri: str | None = None
    volume: float = 0.0
    group: tuple[str, ...] = ()  # zone ids in the same Sonos group incl. itself


# --- steps -----------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Step:
    """Base step."""

    def describe(self) -> str:  # pragma: no cover - overridden
        return type(self).__name__


@dataclass(frozen=True, slots=True)
class MixerFade(Step):
    mixer: str
    inputs: tuple[str, ...]  # mixer channels; "*" = all music inputs
    db: float
    seconds: float

    def describe(self) -> str:
        return f"mixer {self.mixer}: fade {','.join(self.inputs)} -> {self.db:g} dB in {self.seconds:g}s"


@dataclass(frozen=True, slots=True)
class MixerMic(Step):
    mixer: str
    on: bool

    def describe(self) -> str:
        return f"mixer {self.mixer}: mic {'on' if self.on else 'off'}"


@dataclass(frozen=True, slots=True)
class VolumeRamp(Step):
    zone: str
    volume: float
    seconds: float

    def describe(self) -> str:
        return f"{self.zone}: ramp volume -> {self.volume:.2f} in {self.seconds:g}s"


@dataclass(frozen=True, slots=True)
class VolumeSet(Step):
    zone: str
    volume: float

    def describe(self) -> str:
        return f"{self.zone}: set volume {self.volume:.2f}"


@dataclass(frozen=True, slots=True)
class Pause(Step):
    zone: str

    def describe(self) -> str:
        return f"{self.zone}: pause"


@dataclass(frozen=True, slots=True)
class Unjoin(Step):
    zone: str

    def describe(self) -> str:
        return f"{self.zone}: unjoin"


@dataclass(frozen=True, slots=True)
class Join(Step):
    coordinator: str
    members: tuple[str, ...]

    def describe(self) -> str:
        return f"{self.coordinator}: join {','.join(self.members)}"


@dataclass(frozen=True, slots=True)
class PlayUri(Step):
    zone: str
    uri: str
    hdmi: bool = False

    def describe(self) -> str:
        return f"{self.zone}: play {self.uri}"


@dataclass(frozen=True, slots=True)
class PlayFavorite(Step):
    zone: str
    favorite: str

    def describe(self) -> str:
        return f"{self.zone}: play favourite {self.favorite}"


@dataclass(slots=True)
class Plan:
    stages: list[list[Step]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def add(self, *steps: Step) -> None:
        steps = tuple(s for s in steps if s is not None)
        if steps:
            self.stages.append(list(steps))

    def describe(self) -> list[str]:
        return [" | ".join(s.describe() for s in stage) for stage in self.stages]


@dataclass(frozen=True, slots=True)
class Timing:
    """Ramp durations."""

    zone_down: float = 1.5
    mixer_down: float = 1.0
    mixer_up: float = 3.0
    radio_up: float = 2.0


def _mixer_of_uri(uri: str | None, interfaces: dict[str, Interface]) -> str | None:
    uid = uid_from_uri(uri)
    if uid is None or not is_input_stream(uri):
        return None
    for iface in interfaces.values():
        if iface.uid == uid:
            return iface.mixer
    return None


def plan_route(
    route: Route,
    zones: dict[str, Zone],
    interfaces: dict[str, Interface],
    current: dict[str, ZoneState],
    *,
    mixer_level_db: dict[tuple[str, Preset], float] | None = None,
    timing: Timing = Timing(),
) -> Plan:
    """Build the transition plan for ``route``."""
    plan = Plan(warnings=validate_route(route, zones, interfaces))
    mixer_level_db = mixer_level_db or {}
    target = list(route.zones)
    state = {z: current.get(z, ZoneState()) for z in target}

    iface = interfaces.get(route.interface) if route.kind is SourceKind.MIXER else None
    target_uri = interface_uri(iface) if iface else None
    mixer = iface.mixer if iface else None

    # If the mixer is audible in a zone outside this route (e.g. Restaurant on
    # HDMI while Bar is switched to the same mixer's line-in), the mixer must
    # not be touched. Then the target zones are faded instead of the mixer.
    shared_mixer = bool(mixer) and any(
        z not in route.zones and s.playing and _mixer_of_uri(s.uri, interfaces) == mixer
        for z, s in current.items()
    )
    use_mixer_fade = bool(mixer) and not shared_mixer
    if shared_mixer:
        plan.warnings.append(
            f"Mixer {mixer} also feeds other zones; fading the Sonos volumes instead of the mixer"
        )

    # Zones that already play exactly the requested feed keep streaming and
    # stay in their group; only their level is adjusted (mixer fade, or a
    # Sonos ramp when the mixer is shared).
    keep_streaming = {
        z
        for z in target
        if target_uri and state[z].playing and same_stream(state[z].uri, target_uri)
    }

    # Stage 1: silence everything that is audible and about to change.
    stage: list[Step] = []
    if use_mixer_fade:
        stage.append(MixerFade(mixer, ("*",), MIXER_OFF_DB, timing.mixer_down))
    for z in target:
        s = state[z]
        if not s.playing or z in keep_streaming:
            continue
        if use_mixer_fade and _mixer_of_uri(s.uri, interfaces) == mixer:
            continue  # already silent through the mixer fade above
        stage.append(VolumeRamp(z, 0.0, timing.zone_down))
    plan.add(*stage)

    # Stage 2: leave groups that contain zones outside the route FIRST.
    # A pause on a Sonos group member pauses the whole group, which would
    # silence zones this route must not touch.
    coordinator = _pick_coordinator(target, zones, iface)
    members = tuple(z for z in target if z != coordinator)
    wanted = set(target)
    unjoin = [
        z for z in target if z not in keep_streaming and state[z].group and set(state[z].group) - wanted
    ]
    if route.kind is SourceKind.MIXER and iface and iface.kind is InterfaceKind.HDMI:
        # the HT stream must be started on its device while it is alone
        unjoin = [z for z in target if z not in keep_streaming and len(state[z].group) > 1]
    plan.add(*(Unjoin(z) for z in unjoin))

    # Stage 3: stop the old content (the driver skips zones that already stopped).
    # The TV/HDMI input cannot be paused (seen live on an Arc: it stays
    # "playing"), those zones are held at volume 0 until the new stream runs.
    unpausable = {
        z
        for z in target
        if state[z].playing and z not in keep_streaming and (stream_key(state[z].uri) or ("",))[0] == "hdmi"
    }
    plan.add(
        *(
            Pause(z)
            for z in target
            if state[z].playing and z not in keep_streaming and z not in unpausable
        )
    )

    if route.kind is SourceKind.NONE:
        # Leave every zone paused at its safe radio volume (HDMI zones at 0).
        plan.add(
            *(
                VolumeSet(z, 0.0 if z in unpausable else zones[z].radio_volume.get(Preset.NORMAL, 0.1))
                for z in target
            )
        )
        if unpausable:
            plan.warnings.append(f"HDMI input cannot be paused: {sorted(unpausable)} left at volume 0")
        return plan

    # Stage 4: set the final Sonos volumes while everything is silent.
    if route.kind is SourceKind.MIXER and use_mixer_fade:
        plan.add(
            *(
                VolumeSet(z, 0.0 if z in unpausable else zones[z].mixer_volume.get(mixer, 0.0))
                for z in target
            )
        )
    else:
        # Radio / shared mixer: start at 0 and ramp up after playback started.
        plan.add(*(VolumeSet(z, 0.0) for z in target if z not in keep_streaming))

    # Stage 5: start playback on the coordinator, then group the members.
    if route.kind is SourceKind.MIXER:
        if coordinator in keep_streaming:
            pass
        else:
            plan.add(PlayUri(coordinator, target_uri, hdmi=iface.kind is InterfaceKind.HDMI))
    else:
        plan.add(PlayFavorite(coordinator, route.favorite))
    current_group = set(state[coordinator].group) if coordinator in state else set()
    missing = tuple(
        m for m in members if coordinator in unjoin or m in unjoin or m not in current_group
    )
    if missing:
        plan.add(Join(coordinator, missing))

    # Stage 6: bring the level up.
    if route.kind is SourceKind.MIXER and use_mixer_fade:
        # HDMI zones held at 0: the new stream is confirmed and the mixer is
        # still at -inf, so the reference volume can be set silently now.
        plan.add(*(VolumeSet(z, zones[z].mixer_volume.get(mixer, 0.0)) for z in sorted(unpausable)))
        level = mixer_level_db.get((mixer, route.preset), -20.0)
        plan.add(MixerMic(mixer, route.mic))
        plan.add(MixerFade(mixer, (route.mixer_input,), level, timing.mixer_up))
    elif route.kind is SourceKind.MIXER:
        # Shared mixer: its level is owned by the other zone, ramp the Sonos.
        plan.add(
            *(VolumeRamp(z, zones[z].mixer_volume.get(mixer, 0.0), timing.mixer_up) for z in target)
        )
    else:
        plan.add(
            *(
                VolumeRamp(z, zones[z].radio_volume.get(route.preset, 0.1), timing.radio_up)
                for z in target
            )
        )
    return plan


def _pick_coordinator(target: list[str], zones: dict[str, Zone], iface: Interface | None) -> str:
    """Owner of the interface first (keeps its own input local), then wired, then first."""
    if iface:
        for z in target:
            if zones[z].player == iface.player:
                return z
    for z in target:
        if not zones[z].wireless:
            return z
    return target[0]
