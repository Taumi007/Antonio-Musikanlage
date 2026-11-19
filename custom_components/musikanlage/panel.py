"""Sidebar panel "Musikanlage"."""

from __future__ import annotations

import hashlib
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN

PANEL_URL = "musikanlage"
STATIC_URL = f"/{DOMAIN}_static"
FRONTEND_DIR = Path(__file__).parent / "frontend"
_REGISTERED = f"{DOMAIN}_panel_registered"
_STATIC = f"{DOMAIN}_static_base"


def _content_hash() -> str:
    """Hash over all frontend files: a new URL per version, so no module comes from the browser cache."""
    digest = hashlib.sha1()
    for f in sorted(FRONTEND_DIR.glob("*.js")):
        digest.update(f.name.encode())
        digest.update(f.read_bytes())
    return digest.hexdigest()[:10]


async def async_register_panel(hass: HomeAssistant) -> None:
    if hass.data.get(_REGISTERED):
        return
    base = hass.data.get(_STATIC)
    if not base:
        base = f"{STATIC_URL}/{await hass.async_add_executor_job(_content_hash)}"
        await hass.http.async_register_static_paths([StaticPathConfig(base, str(FRONTEND_DIR), False)])
        hass.data[_STATIC] = base
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="musikanlage-panel",
        frontend_url_path=PANEL_URL,
        module_url=f"{base}/musikanlage-panel.js",
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
