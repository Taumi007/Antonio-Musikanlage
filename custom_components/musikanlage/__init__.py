"""Musikanlage: safe source routing between Sonos players and mixers."""

from __future__ import annotations

import logging

import voluptuous as vol
import yaml

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import ConfigEntryError, HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .const import (
    ATTR_DRY_RUN,
    ATTR_INPUT,
    ATTR_MIC,
    ATTR_PRESET,
    ATTR_SOURCE,
    ATTR_ZONES,
    CONF_TOPOLOGY,
    DOMAIN,
    SERVICE_PLAN,
    SERVICE_ROUTE,
    SERVICE_STOP,
)
from .panel import async_register_panel, async_remove_panel
from .model import Route, RouteError, SourceKind
from .router import AudioRouter
from .topology import TopologyError, parse_topology

_LOGGER = logging.getLogger(__name__)
PLATFORMS = [Platform.SENSOR]

type MusikanlageConfigEntry = ConfigEntry[AudioRouter]

ROUTE_SCHEMA = vol.Schema(
    {
        vol.Optional("entry_id"): cv.string,
        vol.Required(ATTR_ZONES): vol.All(cv.ensure_list, [cv.string]),
        vol.Required(ATTR_SOURCE): cv.string,
        vol.Optional(ATTR_INPUT): cv.string,
        vol.Optional(ATTR_PRESET, default="normal"): vol.In(["normal", "lauter", "party"]),
        vol.Optional(ATTR_MIC, default=True): cv.boolean,
        vol.Optional(ATTR_DRY_RUN, default=False): cv.boolean,
    }
)
STOP_SCHEMA = vol.Schema(
    {vol.Optional("entry_id"): cv.string, vol.Required(ATTR_ZONES): vol.All(cv.ensure_list, [cv.string])}
)


def sonos_uids(hass: HomeAssistant) -> dict[str, str]:
    """media_player entity_id -> RINCON uid, from the Sonos device registry."""
    ent_reg = er.async_get(hass)
    dev_reg = dr.async_get(hass)
    out: dict[str, str] = {}
    for ent in ent_reg.entities.values():
        if ent.domain != "media_player" or ent.platform != "sonos" or not ent.device_id:
            continue
        dev = dev_reg.async_get(ent.device_id)
        if dev is None:
            continue
        for domain, ident in dev.identifiers:
            if domain == "sonos" and ident.startswith("RINCON_"):
                out[ent.entity_id] = ident
    return out


async def async_setup_entry(hass: HomeAssistant, entry: MusikanlageConfigEntry) -> bool:
    try:
        raw = yaml.safe_load(entry.options.get(CONF_TOPOLOGY, entry.data.get(CONF_TOPOLOGY, "")))
        topology = parse_topology(raw, sonos_uids(hass))
    except (yaml.YAMLError, TopologyError, KeyError, ValueError) as err:
        raise ConfigEntryError(f"Invalid topology: {err}") from err

    router = AudioRouter(hass, topology)
    router.async_start()
    entry.runtime_data = router
    entry.async_on_unload(router.async_stop)
    entry.async_on_unload(entry.add_update_listener(_reload))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _register_services(hass)
    await async_register_panel(hass)
    return True


async def _reload(hass: HomeAssistant, entry: MusikanlageConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: MusikanlageConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded and not [
        e for e in hass.config_entries.async_loaded_entries(DOMAIN) if e.entry_id != entry.entry_id
    ]:
        async_remove_panel(hass)
    return unloaded


def _router(hass: HomeAssistant, call: ServiceCall) -> AudioRouter:
    entries = [e for e in hass.config_entries.async_loaded_entries(DOMAIN)]
    if entry_id := call.data.get("entry_id"):
        entries = [e for e in entries if e.entry_id == entry_id]
    if len(entries) != 1:
        raise HomeAssistantError("Specify entry_id (none or several musikanlage entries loaded)")
    return entries[0].runtime_data


def _register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_ROUTE):
        return

    def _route_from_call(router: AudioRouter, call: ServiceCall) -> Route:
        try:
            return router.build_route(
                call.data[ATTR_ZONES],
                call.data[ATTR_SOURCE],
                call.data.get(ATTR_INPUT),
                call.data[ATTR_PRESET],
                call.data[ATTR_MIC],
            )
        except (RouteError, ValueError) as err:
            raise HomeAssistantError(str(err)) from err

    async def handle_route(call: ServiceCall) -> ServiceResponse:
        router = _router(hass, call)
        plan = await router.async_route(_route_from_call(router, call), dry_run=call.data[ATTR_DRY_RUN])
        return {"plan": plan.describe(), "warnings": plan.warnings}

    async def handle_plan(call: ServiceCall) -> ServiceResponse:
        router = _router(hass, call)
        plan = await router.async_route(_route_from_call(router, call), dry_run=True)
        return {"plan": plan.describe(), "warnings": plan.warnings}

    async def handle_stop(call: ServiceCall) -> ServiceResponse:
        router = _router(hass, call)
        plan = await router.async_route(Route(tuple(call.data[ATTR_ZONES]), SourceKind.NONE))
        return {"plan": plan.describe(), "warnings": plan.warnings}

    hass.services.async_register(DOMAIN, SERVICE_ROUTE, handle_route, ROUTE_SCHEMA,
                                 supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, SERVICE_PLAN, handle_plan, ROUTE_SCHEMA,
                                 supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, SERVICE_STOP, handle_stop, STOP_SCHEMA,
                                 supports_response=SupportsResponse.OPTIONAL)
