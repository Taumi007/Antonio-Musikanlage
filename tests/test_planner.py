"""Planner tests modelled on the restaurant setup."""

import pytest

from musikanlage.model import Interface, InterfaceKind, Preset, Route, RouteError, SourceKind, Zone
from musikanlage.planner import (
    Join,
    MixerFade,
    MixerMic,
    Pause,
    PlayFavorite,
    PlayUri,
    Unjoin,
    VolumeRamp,
    VolumeSet,
    ZoneState,
    plan_route,
)

RADIO = {Preset.NORMAL: 0.20, Preset.LAUTER: 0.45, Preset.PARTY: 0.75}

ZONES = {
    "restaurant": Zone("restaurant", "media_player.restaurant_sonos", "RINCON_AMP",
                       mixer_volume={"restaurant": 0.75, "bar": 0.75}, radio_volume=RADIO),
    "bar": Zone("bar", "media_player.bar_sonos", "RINCON_FIVE_L",
                mixer_volume={"restaurant": 0.80, "bar": 0.80}, radio_volume=RADIO),
    "zimmer_1": Zone("zimmer_1", "media_player.zimmer_1_sonos", "RINCON_ERA",
                     mixer_volume={"restaurant": 0.49, "bar": 0.60}, radio_volume=RADIO),
    "garten": Zone("garten", "media_player.move_2", "RINCON_MOVE", wireless=True,
                   mixer_volume={"restaurant": 0.80, "bar": 0.80}, radio_volume=RADIO),
}
IFACES = {
    "restaurant_hdmi": Interface("restaurant_hdmi", "media_player.restaurant_sonos", "RINCON_AMP",
                                 InterfaceKind.HDMI, mixer="restaurant"),
    "restaurant_cinch": Interface("restaurant_cinch", "media_player.restaurant_sonos", "RINCON_AMP",
                                  InterfaceKind.LINE_IN, mixer="restaurant"),
    "bar_line_in": Interface("bar_line_in", "media_player.bar_sonos", "RINCON_FIVE_L",
                             InterfaceKind.LINE_IN, mixer="bar"),
}
LEVELS = {("bar", Preset.NORMAL): -23.6, ("restaurant", Preset.NORMAL): -18.7}


def flat(plan):
    return [s for stage in plan.stages for s in stage]


def index(plan, pred):
    for i, stage in enumerate(plan.stages):
        if any(pred(s) for s in stage):
            return i
    raise AssertionError("step not found")


def test_radio_to_bar_mixer_is_silent_until_sonos_confirmed():
    current = {
        "bar": ZoneState(playing=True, uri="x-sonosapi-stream:radio", volume=0.35, group=("bar", "zimmer_1")),
        "zimmer_1": ZoneState(playing=True, uri="x-sonosapi-stream:radio", volume=0.15, group=("bar", "zimmer_1")),
    }
    route = Route(("bar", "zimmer_1"), SourceKind.MIXER, interface="bar_line_in", mixer_input="5")
    plan = plan_route(route, ZONES, IFACES, current, mixer_level_db=LEVELS)

    mixer_down = index(plan, lambda s: isinstance(s, MixerFade) and s.db == -90)
    ramp_down = index(plan, lambda s: isinstance(s, VolumeRamp) and s.volume == 0)
    pause = index(plan, lambda s: isinstance(s, Pause))
    vol80 = index(plan, lambda s: isinstance(s, VolumeSet) and s.zone == "bar" and s.volume == 0.80)
    play = index(plan, lambda s: isinstance(s, PlayUri))
    mixer_up = index(plan, lambda s: isinstance(s, MixerFade) and s.inputs == ("5",))

    assert mixer_down == ramp_down < pause < vol80 < play < mixer_up
    assert any(isinstance(s, PlayUri) and s.uri == "x-rincon-stream:RINCON_FIVE_L" and s.zone == "bar"
               for s in flat(plan))
    # group bar+zimmer_1 already exists -> no regroup
    assert not any(isinstance(s, (Join, Unjoin)) for s in flat(plan))
    assert [s for s in flat(plan) if isinstance(s, MixerFade)][-1].db == -23.6


def test_mixer_to_radio_never_starts_at_reference_volume():
    current = {"bar": ZoneState(playing=True, uri="x-rincon-stream:RINCON_FIVE_L", volume=0.8, group=("bar",))}
    route = Route(("bar",), SourceKind.RADIO, favorite="FV:2/5", preset=Preset.NORMAL)
    plan = plan_route(route, ZONES, IFACES, current)
    steps = flat(plan)
    play = index(plan, lambda s: isinstance(s, PlayFavorite))
    zero = index(plan, lambda s: isinstance(s, VolumeSet) and s.volume == 0.0)
    pause = index(plan, lambda s: isinstance(s, Pause))
    assert pause < zero < play
    assert isinstance(steps[-1], VolumeRamp) and steps[-1].volume == 0.20
    assert not any(isinstance(s, MixerFade) for s in steps)


def test_hdmi_with_other_zones_is_rejected():
    route = Route(("restaurant", "bar"), SourceKind.MIXER, interface="restaurant_hdmi", mixer_input="5")
    with pytest.raises(RouteError, match="line-in"):
        plan_route(route, ZONES, IFACES, {})


def test_wireless_zone_rejected_with_microphone():
    route = Route(("bar", "garten"), SourceKind.MIXER, interface="bar_line_in", mixer_input="5", mic=True)
    with pytest.raises(RouteError, match="Wireless"):
        plan_route(route, ZONES, IFACES, {})
    ok = Route(("bar", "garten"), SourceKind.MIXER, interface="bar_line_in", mixer_input="5", mic=False)
    plan_route(ok, ZONES, IFACES, {})


def test_hdmi_alone_unjoins_and_plays_ht_stream():
    current = {"restaurant": ZoneState(playing=True, uri="x-sonosapi-stream:radio",
                                       group=("restaurant", "garten"))}
    route = Route(("restaurant",), SourceKind.MIXER, interface="restaurant_hdmi", mixer_input="5")
    plan = plan_route(route, ZONES, IFACES, current, mixer_level_db=LEVELS)
    steps = flat(plan)
    assert Unjoin("restaurant") in steps
    play = next(s for s in steps if isinstance(s, PlayUri))
    assert play.hdmi and play.uri == "x-sonos-htastream:RINCON_AMP:spdif"
    assert MixerMic("restaurant", True) in steps


def test_shared_mixer_fades_sonos_not_mixer():
    """Restaurant plays HDMI, bar+zimmer get the same mixer via the Amp's cinch input."""
    current = {
        "restaurant": ZoneState(playing=True, uri="x-sonos-htastream:RINCON_AMP:spdif", volume=0.75,
                                group=("restaurant",)),
        "bar": ZoneState(playing=True, uri="x-sonosapi-stream:radio", volume=0.35, group=("bar",)),
    }
    route = Route(("bar", "zimmer_1"), SourceKind.MIXER, interface="restaurant_cinch", mixer_input="5")
    plan = plan_route(route, ZONES, IFACES, current, mixer_level_db=LEVELS)
    steps = flat(plan)
    assert not any(isinstance(s, (MixerFade, MixerMic)) for s in steps)
    assert PlayUri("bar", "x-rincon-stream:RINCON_AMP") in steps
    assert Join("bar", ("zimmer_1",)) in steps
    assert VolumeSet("bar", 0.0) in steps
    assert VolumeRamp("bar", 0.80, 3.0) in steps
    assert any("feeds other zones" in w for w in plan.warnings)


def test_same_feed_keeps_streaming_and_only_mixer_moves():
    current = {"bar": ZoneState(playing=True, uri="x-rincon-stream:RINCON_FIVE_L", volume=0.8, group=("bar",))}
    route = Route(("bar",), SourceKind.MIXER, interface="bar_line_in", mixer_input="7", preset=Preset.NORMAL)
    plan = plan_route(route, ZONES, IFACES, current, mixer_level_db=LEVELS)
    steps = flat(plan)
    assert not any(isinstance(s, (Pause, PlayUri)) for s in steps)
    assert isinstance(steps[0], MixerFade) and steps[0].db == -90


def test_stop_leaves_safe_volume():
    current = {"bar": ZoneState(playing=True, uri="x-rincon-stream:RINCON_FIVE_L", volume=0.8, group=("bar",))}
    plan = plan_route(Route(("bar",), SourceKind.NONE), ZONES, IFACES, current)
    steps = flat(plan)
    assert steps[-1] == VolumeSet("bar", 0.20)
    assert index(plan, lambda s: isinstance(s, Pause)) < len(plan.stages) - 1


def test_line_in_with_device_suffix_counts_as_same_stream():
    """Era 100 reports x-rincon-stream:<UID>:0 (seen live on Taumihause)."""
    current = {"bar": ZoneState(playing=True, uri="x-rincon-stream:RINCON_FIVE_L:0", volume=0.8, group=("bar",))}
    route = Route(("bar",), SourceKind.MIXER, interface="bar_line_in", mixer_input="5")
    steps = flat(plan_route(route, ZONES, IFACES, current, mixer_level_db=LEVELS))
    assert not any(isinstance(s, (Pause, PlayUri, VolumeRamp)) for s in steps)


def test_unjoin_from_foreign_group_before_pause():
    """Seen live: pausing a group member paused the whole group (other zone stopped)."""
    current = {
        "zimmer_1": ZoneState(playing=True, uri="x-rincon-stream:RINCON_FIVE_L", volume=0.6, group=("bar", "zimmer_1")),
        "bar": ZoneState(playing=True, uri="x-rincon-stream:RINCON_FIVE_L", volume=0.8, group=("bar", "zimmer_1")),
    }
    route = Route(("zimmer_1",), SourceKind.RADIO, favorite="FV:2/5")
    plan = plan_route(route, ZONES, IFACES, current)
    unjoin = index(plan, lambda s: s == Unjoin("zimmer_1"))
    pause = index(plan, lambda s: s == Pause("zimmer_1"))
    assert unjoin < pause
    assert not any(getattr(s, "zone", None) == "bar" for s in flat(plan))


def test_hdmi_zone_is_not_paused_but_held_at_zero():
    """Seen live: an Arc on its TV input ignores pause and stays 'playing'."""
    current = {
        "restaurant": ZoneState(playing=True, uri="x-sonos-htastream:RINCON_AMP:spdif", volume=0.25,
                                group=("restaurant",)),
        "bar": ZoneState(playing=True, uri="x-rincon-stream:RINCON_FIVE_L", volume=0.8, group=("bar",)),
    }
    route = Route(("bar", "restaurant"), SourceKind.MIXER, interface="bar_line_in", mixer_input="5", mic=False)
    plan = plan_route(route, ZONES, IFACES, current, mixer_level_db=LEVELS)
    steps = flat(plan)
    assert Pause("restaurant") not in steps
    assert VolumeSet("restaurant", 0.0) in steps
    zero = index(plan, lambda s: s == VolumeSet("restaurant", 0.0))
    join = index(plan, lambda s: isinstance(s, Join))
    ref = index(plan, lambda s: s == VolumeSet("restaurant", 0.75))
    up = index(plan, lambda s: isinstance(s, MixerFade) and s.inputs == ("5",))
    assert zero < join < ref < up


def test_stop_hdmi_zone_left_at_zero():
    current = {"restaurant": ZoneState(playing=True, uri="x-sonos-htastream:RINCON_AMP:spdif", volume=0.5,
                                       group=("restaurant",))}
    plan = plan_route(Route(("restaurant",), SourceKind.NONE), ZONES, IFACES, current)
    steps = flat(plan)
    assert Pause("restaurant") not in steps
    assert steps[-1] == VolumeSet("restaurant", 0.0)
