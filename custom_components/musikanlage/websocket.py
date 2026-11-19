"""Websocket API for the Musikanlage panel."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

import voluptuous as vol
import yaml

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError

from .const import CONF_TOPOLOGY, DOMAIN
from .topology import TopologyError, parse_topology


def _entry(hass: HomeAssistant, entry_id: str | None):
    entries = hass.config_entries.async_loaded_entries(DOMAIN)
    if entry_id:
        entries = [e for e in entries if e.entry_id == entry_id]
    if not entries:
        raise HomeAssistantError("Keine Musikanlage geladen")
    return entries[0]


def _players(hass: HomeAssistant) -> list[dict[str, Any]]:
    from homeassistant.helpers import device_registry as dr
    from homeassistant.helpers import entity_registry as er

    from . import sonos_uids  # local import: avoids import cycle

    ent_reg, dev_reg = er.async_get(hass), dr.async_get(hass)
    out = []
    for entity_id, uid in sorted(sonos_uids(hass).items()):
        st = hass.states.get(entity_id)
        ent = ent_reg.async_get(entity_id)
        dev = dev_reg.async_get(ent.device_id) if ent and ent.device_id else None
        mac = next((c[1].lower() for c in (dev.connections if dev else ()) if c[0] == dr.CONNECTION_NETWORK_MAC), None)
        out.append({
            "entity_id": entity_id,
            "uid": uid,
            "mac": mac,
            "model": dev.model if dev else None,
            "name": st.attributes.get("friendly_name") if st else entity_id,
        })
    return out


def _trackers(hass: HomeAssistant) -> list[dict[str, Any]]:
    """UniFi-style device trackers (with mac); access points are those clients connect to."""
    states = [st for st in hass.states.async_all("device_tracker") if "mac" in st.attributes]
    ap_macs = {(st.attributes.get("ap_mac") or "").lower() for st in states} - {""}
    out = []
    for st in states:
        a = st.attributes
        mac = (a.get("mac") or "").lower()
        out.append({
            "entity_id": st.entity_id,
            "name": a.get("friendly_name"),
            "mac": mac,
            "ap_mac": (a.get("ap_mac") or "").lower() or None,
            "essid": a.get("essid"),
            "state": st.state,
            "is_ap": mac in ap_macs or st.entity_id.endswith("_ap"),
        })
    return out


def _snapshot(hass: HomeAssistant, entry) -> dict[str, Any]:
    router = entry.runtime_data
    topo = router.topo
    s = router.status
    return {
        "entry_id": entry.entry_id,
        "topology": topo.raw,
        "names": topo.names,
        "areas": topo.areas,
        "quick_actions": [asdict(q) for q in topo.quick_actions],
        "graph": router.graph(),
        "options": router.options(),
        "follow_ap": router.ap_info(),
        "status": {
            "busy": s.busy,
            "last_route": s.last_route,
            "last_plan": s.last_plan,
            "last_warnings": s.last_warnings,
            "last_error": s.last_error,
            "guard_events": s.guard_events,
        },
    }


@callback
def async_register(hass: HomeAssistant) -> None:
    if hass.data.get(f"{DOMAIN}_ws"):
        return
    hass.data[f"{DOMAIN}_ws"] = True
    for handler in (ws_get, ws_validate, ws_save, ws_quick_action, ws_follow):
        websocket_api.async_register_command(hass, handler)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get", vol.Optional("entry_id"): str})
@callback
def ws_get(hass, connection, msg):
    try:
        entry = _entry(hass, msg.get("entry_id"))
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "not_loaded", str(err))
        return
    data = _snapshot(hass, entry)
    data["players"] = _players(hass)
    data["trackers"] = _trackers(hass)
    connection.send_result(msg["id"], data)


def _check(hass: HomeAssistant, topology: dict[str, Any]) -> list[str]:
    from . import sonos_uids

    try:
        parse_topology(topology, sonos_uids(hass))
    except (TopologyError, KeyError, ValueError, TypeError, AttributeError) as err:
        return [str(err)]
    return []


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/validate", vol.Optional("entry_id"): str, vol.Required("topology"): dict,
})
@callback
def ws_validate(hass, connection, msg):
    connection.send_result(msg["id"], {"errors": _check(hass, msg["topology"])})


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/save", vol.Optional("entry_id"): str, vol.Required("topology"): dict,
})
@websocket_api.require_admin
@callback
def ws_save(hass, connection, msg):
    errors = _check(hass, msg["topology"])
    if errors:
        connection.send_result(msg["id"], {"saved": False, "errors": errors})
        return
    entry = _entry(hass, msg.get("entry_id"))
    text = yaml.safe_dump(msg["topology"], allow_unicode=True, sort_keys=False)
    # The update listener reloads the entry with the new topology.
    hass.config_entries.async_update_entry(entry, options={**entry.options, CONF_TOPOLOGY: text})
    connection.send_result(msg["id"], {"saved": True, "errors": []})


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/quick_action", vol.Optional("entry_id"): str,
    vol.Required("action"): str, vol.Optional("dry_run", default=False): bool,
})
@websocket_api.async_response
async def ws_quick_action(hass, connection, msg):
    try:
        router = _entry(hass, msg.get("entry_id")).runtime_data
        plan = await router.async_quick_action(msg["action"], dry_run=msg["dry_run"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "failed", str(err))
        return
    connection.send_result(msg["id"], {"plan": plan.describe(), "warnings": plan.warnings})


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/follow", vol.Optional("entry_id"): str,
    vol.Required("zone"): str, vol.Required("target"): str,
})
@websocket_api.async_response
async def ws_follow(hass, connection, msg):
    try:
        router = _entry(hass, msg.get("entry_id")).runtime_data
        steps = await router.async_follow(msg["zone"], msg["target"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "failed", str(err))
        return
    connection.send_result(msg["id"], {"plan": steps})
