"""Sidebar panel "Musikanlage"."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN

PANEL_URL = "musikanlage"
STATIC_URL = f"/{DOMAIN}_static"
_REGISTERED = f"{DOMAIN}_panel_registered"
_STATIC = f"{DOMAIN}_static_registered"


async def async_register_panel(hass: HomeAssistant) -> None:
    if hass.data.get(_REGISTERED):
        return
    if not hass.data.get(_STATIC):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(Path(__file__).parent / "frontend"), False)]
        )
        hass.data[_STATIC] = True
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="musikanlage-panel",
        frontend_url_path=PANEL_URL,
        module_url=f"{STATIC_URL}/musikanlage-panel.js?v=0.1.2",
        sidebar_title="Musikanlage",
        sidebar_icon="mdi:speaker-multiple",
        require_admin=False,
        config={"domain": DOMAIN},
    )
    hass.data[_REGISTERED] = True


@callback
def async_remove_panel(hass: HomeAssistant) -> None:
    if hass.data.pop(_REGISTERED, False):
        frontend.async_remove_panel(hass, PANEL_URL)
