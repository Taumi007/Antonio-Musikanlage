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


def stream_key(uri: str | None) -> tuple[str, str] | None:
    """(kind, uid) of an input stream, ignoring device-specific suffixes.

    Players report the same input differently, e.g.
    ``x-rincon-stream:RINCON_X`` vs. ``x-rincon-stream:RINCON_X:0``.
    """
    if not is_input_stream(uri):
        return None
    kind = "hdmi" if uri.startswith(HDMI_PREFIX) else "line_in"
    return kind, uid_from_uri(uri)


def same_stream(a: str | None, b: str | None) -> bool:
    """True if both URIs are the same input stream (or literally equal)."""
    if a == b:
        return a is not None
    ka = stream_key(a)
    return ka is not None and ka == stream_key(b)


def uid_from_uri(uri: str | None) -> str | None:
    """Extract the RINCON uid of the device whose input is played."""
    if not uri:
        return None
    for prefix in (LINE_IN_PREFIX, HDMI_PREFIX, JOIN_PREFIX):
        if uri.startswith(prefix):
            return uri[len(prefix) :].split(":", 1)[0]
    return None
