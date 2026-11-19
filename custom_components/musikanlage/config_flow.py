"""Config flow: name + topology (YAML text) for the first iteration."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
import yaml

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import TextSelector, TextSelectorConfig

from .const import CONF_TOPOLOGY, DOMAIN
from .topology import TopologyError, parse_topology

EXAMPLE = """\
max_radio_volume: 0.5
mixers:
  test:
    type: virtual          # or behringer_entities + prefix: restaurant_mixer
    inputs: {pc: [5, 6], aux: [7, 8]}
    mic_channel: 1
    mic_db: 0
    levels: {normal: -24, lauter: -15, party: -6}
interfaces:
  arc_hdmi: {player: media_player.example_arc, kind: hdmi, mixer: test}
zones:
  arc:
    player: media_player.example_arc
    mixer_volume: {test: 0.3}
    radio_volume: {normal: 0.15, lauter: 0.25, party: 0.35}
favorites: {}
"""


def _validate(hass, text: str) -> dict[str, str]:
    from . import sonos_uids  # local import: avoids import cycle

    try:
        parse_topology(yaml.safe_load(text), sonos_uids(hass))
    except (yaml.YAMLError, TopologyError, KeyError, ValueError, TypeError) as err:
        return {"base": "invalid_topology", "_detail": str(err)}
    return {}


def _schema(default: str) -> vol.Schema:
    return vol.Schema(
        {vol.Required(CONF_TOPOLOGY, default=default): TextSelector(TextSelectorConfig(multiline=True))}
    )


class MusikanlageConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        detail = ""
        if user_input is not None:
            errors = _validate(self.hass, user_input[CONF_TOPOLOGY])
            detail = errors.pop("_detail", "")
            if not errors:
                return self.async_create_entry(title="Musikanlage", data=user_input)
        return self.async_show_form(
            step_id="user",
            data_schema=_schema(user_input[CONF_TOPOLOGY] if user_input else EXAMPLE),
            errors=errors,
            description_placeholders={"detail": detail},
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return MusikanlageOptionsFlow()


class MusikanlageOptionsFlow(OptionsFlow):
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        detail = ""
        current = self.config_entry.options.get(
            CONF_TOPOLOGY, self.config_entry.data.get(CONF_TOPOLOGY, EXAMPLE)
        )
        if user_input is not None:
            errors = _validate(self.hass, user_input[CONF_TOPOLOGY])
            detail = errors.pop("_detail", "")
            if not errors:
                return self.async_create_entry(data=user_input)
            current = user_input[CONF_TOPOLOGY]
        return self.async_show_form(
            step_id="init",
            data_schema=_schema(current),
            errors=errors,
            description_placeholders={"detail": detail},
        )
