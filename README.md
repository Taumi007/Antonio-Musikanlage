# Musikanlage (Home Assistant custom integration)

Routes audio between Sonos players and mixers (Behringer X Air) **without
volume jumps**:

* Every transition is planned in stages; each step completes on **device
  feedback** (state change), never on a fixed delay. Timeouts are only a safety
  net and abort the transition (zones are then paused and set to their safe
  radio volume).
* Mixer music is faded to -inf **before** a Sonos switches to a mixer feed; the
  mixer fades up only after source, group and Sonos volume are confirmed.
* A zone playing radio/anything else is ramped to 0 and paused before it
  changes; radio starts at volume 0 and ramps up to its preset.
* If a mixer also feeds a zone outside the route (e.g. Restaurant on HDMI while
  Bar takes the Amp's cinch line-in), the mixer is left alone and the Sonos
  volumes are faded instead.
* HDMI inputs are started on their own device alone (other players refuse the
  HT stream with UPnP 402); other zones then join its group. Measured with an
  Arc: the HDMI device keeps its low latency as group coordinator (116 ms solo
  and grouped), members play ~43 ms later and are in sync with each other.
* Zones on the TV/HDMI input cannot be paused; they are held at volume 0 until
  the new stream is confirmed.
* Wireless zones (Move 2) are refused while the microphone is in use.
* **Guard:** if anything outside the router (Sonos app, alarm, TV autoplay,
  `sonos.restore`, buttons) starts non-mixer content above
  `max_radio_volume`, the volume is clamped immediately.

## Services

| Service | Purpose |
|---|---|
| `musikanlage.route` | `zones`, `source` (`mixer:<interface>`, `radio:<favourite>`, `none`), `input`, `preset`, `mic`, `dry_run` |
| `musikanlage.plan` | Same fields; returns the plan only |
| `musikanlage.stop` | Fade out, pause, reset to radio-normal volume |

`sensor.musikanlage_route` carries the routing graph (`graph` attribute) for
the flow diagram, the last plan, warnings, errors and guard events.

## Topology (config flow, YAML)

```yaml
max_radio_volume: 0.5
mixers:
  restaurant:
    type: behringer_entities        # or: virtual (tests without hardware)
    prefix: restaurant_mixer        # number.<prefix>_channel_<n>_fader
    inputs: {ext: [3, 4], pc: [5, 6], aux1: [7, 8], aux2: [9, 10], aux3: [11, 12]}
    mic_channel: 1
    mic_db: 0
    levels: {normal: -24, lauter: -15, party: -6}   # dB at the mixer per preset
interfaces:
  restaurant_hdmi:  {player: media_player.restaurant_sonos, kind: hdmi,    mixer: restaurant}
  restaurant_cinch: {player: media_player.restaurant_sonos, kind: line_in, mixer: restaurant}
  bar_line_in:      {player: media_player.bar_sonos,        kind: line_in, mixer: bar}
zones:
  bar:
    player: media_player.bar_sonos
    mixer_volume: {restaurant: 0.80, bar: 0.80}      # Sonos volume for mixer feeds
    radio_volume: {normal: 0.35, lauter: 0.55, party: 0.80}
  garten:
    player: media_player.move_2
    wireless: true
favorites:
  antenne: "FV:2/5"
```

RINCON uids are read from the Sonos device registry.

## Development

```bash
pytest tests/test_*.py          # pure logic, no HA needed
pytest                          # incl. tests/ha (needs pytest-homeassistant-custom-component)
```
