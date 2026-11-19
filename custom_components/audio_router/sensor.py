"""Route sensor: current routing graph + last transition, for dashboards."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event

from . import AudioRouterConfigEntry
from .const import DOMAIN, SIGNAL_ROUTE_UPDATED
from .router import AudioRouter


async def async_setup_entry(
    hass: HomeAssistant, entry: AudioRouterConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    async_add_entities([RouteSensor(entry.runtime_data, entry.entry_id)])


class RouteSensor(SensorEntity):
    _attr_has_entity_name = True
    _attr_translation_key = "route"
    _attr_should_poll = False

    def __init__(self, router: AudioRouter, entry_id: str) -> None:
        self.router = router
        self._attr_unique_id = f"{entry_id}_route"
        self._attr_device_info = {"identifiers": {(DOMAIN, entry_id)}, "name": "Audio Router"}

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_ROUTE_UPDATED, self._update)
        )
        players = [z.player for z in self.router.topo.zones.values()]
        self.async_on_remove(
            async_track_state_change_event(self.hass, players, self._player_changed)
        )

    @callback
    def _player_changed(self, _event) -> None:
        self.async_write_ha_state()

    @callback
    def _update(self) -> None:
        self.async_write_ha_state()

    @property
    def native_value(self) -> str:
        if self.router.status.busy:
            return "transition"
        if self.router.status.last_error:
            return "error"
        return "idle"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        s = self.router.status
        return {
            "graph": self.router.graph(),
            "last_route": s.last_route,
            "last_plan": s.last_plan,
            "last_warnings": s.last_warnings,
            "last_error": s.last_error,
            "guard_events": s.guard_events,
        }
