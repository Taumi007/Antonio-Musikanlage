"""Sonos transport URIs (RINCON streams)."""

from __future__ import annotations

from .model import Interface, InterfaceKind

LINE_IN_PREFIX = "x-rincon-stream:"
HDMI_PREFIX = "x-sonos-htastream:"
JOIN_PREFIX = "x-rincon:"


def interface_uri(iface: Interface) -> str:
    """URI a player has to play to receive this interface."""
    if iface.kind is InterfaceKind.HDMI:
        return f"{HDMI_PREFIX}{iface.uid}:spdif"
    return f"{LINE_IN_PREFIX}{iface.uid}"


def is_input_stream(uri: str | None) -> bool:
    """True if the URI is a line-in or HDMI input (i.e. a mixer feed)."""
    return bool(uri) and uri.startswith((LINE_IN_PREFIX, HDMI_PREFIX))


def uid_from_uri(uri: str | None) -> str | None:
    """Extract the RINCON uid of the device whose input is played."""
    if not uri:
        return None
    for prefix in (LINE_IN_PREFIX, HDMI_PREFIX, JOIN_PREFIX):
        if uri.startswith(prefix):
            return uri[len(prefix) :].split(":", 1)[0]
    return None
