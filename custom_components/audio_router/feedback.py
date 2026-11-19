"""Wait for device feedback instead of fixed delays."""

from __future__ import annotations

import asyncio
from collections.abc import Callable

from homeassistant.core import Event, EventStateChangedData, HomeAssistant, State, callback
from homeassistant.helpers.event import async_track_state_change_event


class FeedbackTimeout(TimeoutError):
    """Device did not confirm in time."""


async def wait_for_state(
    hass: HomeAssistant,
    entity_id: str,
    predicate: Callable[[State], bool],
    timeout: float,
    what: str,
) -> State:
    """Return as soon as ``predicate(state)`` holds (checked now and on every change).

    The timeout is a safety net only; it raises so a transition never
    continues on an unconfirmed step.
    """
    current = hass.states.get(entity_id)
    if current is not None and predicate(current):
        return current

    loop = asyncio.get_running_loop()
    fut: asyncio.Future[State] = loop.create_future()

    @callback
    def _changed(event: Event[EventStateChangedData]) -> None:
        new = event.data["new_state"]
        if new is not None and not fut.done() and predicate(new):
            fut.set_result(new)

    unsub = async_track_state_change_event(hass, [entity_id], _changed)
    try:
        # re-check: the state may have changed between the first check and subscribing
        current = hass.states.get(entity_id)
        if current is not None and predicate(current):
            return current
        async with asyncio.timeout(timeout):
            return await fut
    except TimeoutError as err:
        raise FeedbackTimeout(f"{entity_id}: no confirmation for '{what}' within {timeout:g}s") from err
    finally:
        unsub()
