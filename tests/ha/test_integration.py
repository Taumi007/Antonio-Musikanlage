"""Integration test in a real Home Assistant core with simulated Sonos players.

The fake players confirm every command asynchronously (like real devices),
so the test proves the router waits for feedback and keeps the safety order.
"""

from __future__ import annotations

import asyncio

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component

from custom_components.musikanlage.const import DOMAIN

ARC = "media_player.schlafzimmer_sonos"
ERA = "media_player.schlafzimmer_sonos_vorne"
UIDS = {ARC: "RINCON_ARC00001400", ERA: "RINCON_ERA00001400"}

TOPOLOGY = """
max_radio_volume: 0.4
mixers:
  test:
    type: virtual
    inputs: {pc: [5, 6]}
    levels: {normal: -24, lauter: -15, party: -6}
interfaces:
  arc_hdmi: {player: media_player.schlafzimmer_sonos, kind: hdmi, mixer: test}
  era_line_in: {player: media_player.schlafzimmer_sonos_vorne, kind: line_in, mixer: test}
zones:
  arc:
    player: media_player.schlafzimmer_sonos
    mixer_volume: {test: 0.30}
    radio_volume: {normal: 0.12, lauter: 0.2, party: 0.3}
  era:
    player: media_player.schlafzimmer_sonos_vorne
    mixer_volume: {test: 0.25}
    radio_volume: {normal: 0.10, lauter: 0.18, party: 0.25}
favorites:
  oe3: "FV:2/4"
"""


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


class FakeSonos:
    """Very small Sonos simulator on top of hass.states."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.log: list[tuple] = []  # (entity, attr, value, volume_at_that_time)
        for p in UIDS:
            self._set(p, "paused", volume_level=0.1, media_content_id=None, group_members=[p], source=None)

    def _attrs(self, p):
        return dict(self.hass.states.get(p).attributes)

    def _set(self, p, state=None, **attrs):
        st = self.hass.states.get(p)
        a = dict(st.attributes) if st else {}
        a.update(attrs)
        self.hass.states.async_set(p, state or st.state, a)

    async def _later(self, fn):
        await asyncio.sleep(0.02)  # device latency
        fn()

    def register(self) -> None:
        hass = self.hass

        def ents(call: ServiceCall):
            e = call.data["entity_id"]
            return [e] if isinstance(e, str) else list(e)

        async def volume_set(call):
            for p in ents(call):
                v = call.data["volume_level"]
                self.log.append((p, "volume", v))
                hass.async_create_task(self._later(lambda p=p, v=v: self._set(p, volume_level=v)))

        async def media_pause(call):
            for p in ents(call):
                self.log.append((p, "pause", None))
                hass.async_create_task(self._later(lambda p=p: self._set(p, "paused")))

        async def play_media(call):
            for p in ents(call):
                uri = call.data["media"]["media_content_id"]
                vol = self._attrs(p)["volume_level"]
                self.log.append((p, "play", uri, vol))
                hass.async_create_task(
                    self._later(lambda p=p, uri=uri: self._set(p, "playing", media_content_id=uri))
                )

        async def join(call):
            for p in ents(call):
                members = [p, *call.data["group_members"]]
                self.log.append((p, "join", tuple(members)))

                def apply(members=members):
                    for m in members:
                        self._set(m, group_members=members)

                hass.async_create_task(self._later(apply))

        async def unjoin(call):
            for p in ents(call):
                self.log.append((p, "unjoin", None))
                hass.async_create_task(self._later(lambda p=p: self._set(p, group_members=[p])))

        for name, fn in {
            "volume_set": volume_set,
            "media_pause": media_pause,
            "play_media": play_media,
            "join": join,
            "unjoin": unjoin,
        }.items():
            hass.services.async_register("media_player", name, fn)


async def _setup(hass: HomeAssistant) -> tuple[MockConfigEntry, FakeSonos]:
    sonos_entry = MockConfigEntry(domain="sonos")
    sonos_entry.add_to_hass(hass)
    dev_reg, ent_reg = dr.async_get(hass), er.async_get(hass)
    for player, uid in UIDS.items():
        dev = dev_reg.async_get_or_create(config_entry_id=sonos_entry.entry_id, identifiers={("sonos", uid)})
        ent_reg.async_get_or_create(
            "media_player", "sonos", uid, device_id=dev.id, suggested_object_id=player.split(".")[1]
        )
    fake = FakeSonos(hass)
    assert await async_setup_component(hass, "media_player", {})
    entry = MockConfigEntry(domain=DOMAIN, data={"topology": TOPOLOGY})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    fake.register()  # override the media_player services with the simulator
    return entry, fake


async def test_radio_to_line_in_waits_and_never_plays_loud(hass: HomeAssistant) -> None:
    entry, fake = await _setup(hass)
    router = entry.runtime_data
    # Era is playing radio loud-ish
    fake._set(ERA, "playing", media_content_id="x-sonosapi-stream:radio", volume_level=0.35)
    fake._set(ARC, "playing", media_content_id="x-sonosapi-stream:radio", volume_level=0.3)

    resp = await hass.services.async_call(
        DOMAIN, "route",
        {"zones": ["era", "arc"], "source": "mixer:era_line_in", "input": "pc", "preset": "normal", "mic": False},
        blocking=True, return_response=True,
    )
    await hass.async_block_till_done()

    # The line-in was started on the Era (owner of the input), not before everything was paused
    plays = [l for l in fake.log if l[1] == "play"]
    assert plays == [(ERA, "play", "x-rincon-stream:RINCON_ERA00001400", 0.25)]
    first_play = fake.log.index(plays[0])
    pauses = [i for i, l in enumerate(fake.log) if l[1] == "pause"]
    assert pauses and max(pauses) < first_play
    # Arc joined the Era after the stream started
    assert any(l[1] == "join" and l[0] == ERA for l in fake.log[first_play:])
    # Mixer faded up after everything was confirmed
    assert router.mixers["test"].get_db(5) == pytest.approx(-24)
    assert hass.states.get(ERA).attributes["volume_level"] == 0.25
    assert hass.states.get(ARC).attributes["volume_level"] == 0.30
    assert resp["warnings"] == []
    assert hass.states.get("sensor.musikanlage_route").state == "idle"


async def test_back_to_radio_starts_silent(hass: HomeAssistant) -> None:
    entry, fake = await _setup(hass)
    fake._set(ERA, "playing", media_content_id="x-rincon-stream:RINCON_ERA00001400", volume_level=0.25)

    await hass.services.async_call(
        DOMAIN, "route", {"zones": ["era"], "source": "radio:oe3", "preset": "normal"}, blocking=True
    )
    play = next(l for l in fake.log if l[1] == "play")
    assert play[2] == "FV:2/4"
    assert play[3] == 0.0  # favourite started at volume 0, then ramped up
    assert hass.states.get(ERA).attributes["volume_level"] == pytest.approx(0.10)


async def test_guard_clamps_foreign_loud_start(hass: HomeAssistant) -> None:
    entry, fake = await _setup(hass)
    fake._set(ERA, "paused", media_content_id="x-rincon-stream:RINCON_ERA00001400", volume_level=0.8)
    await hass.async_block_till_done()
    # someone starts radio in the Sonos app while the volume is still at the mixer level
    fake._set(ERA, "playing", media_content_id="x-sonosapi-stream:app", volume_level=0.8)
    await hass.async_block_till_done()
    await asyncio.sleep(0.05)
    await hass.async_block_till_done()
    assert (ERA, "volume", 0.1) in fake.log
    assert entry.runtime_data.status.guard_events


async def test_hdmi_with_two_zones_is_refused(hass: HomeAssistant) -> None:
    await _setup(hass)
    from homeassistant.exceptions import HomeAssistantError

    with pytest.raises(HomeAssistantError, match="line-in"):
        await hass.services.async_call(
            DOMAIN, "route", {"zones": ["arc", "era"], "source": "mixer:arc_hdmi", "input": "pc"}, blocking=True
        )


async def test_sidebar_panel_registered_and_removed(hass: HomeAssistant) -> None:
    entry, _ = await _setup(hass)
    panels = hass.data["frontend_panels"]
    assert panels["musikanlage"].sidebar_title == "Musikanlage"
    assert panels["musikanlage"].sidebar_icon == "mdi:speaker-multiple"
    attrs = hass.states.get("sensor.musikanlage_route").attributes
    assert {z["id"] for z in attrs["options"]["zones"]} == {"arc", "era"}
    assert attrs["options"]["favorites"] == ["oe3"]
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert "musikanlage" not in hass.data["frontend_panels"]
