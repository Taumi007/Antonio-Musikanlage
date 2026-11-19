"""Behringer X Air (XR12/XR16/XR18) fader math.

The mixer transmits fader positions as float 0..1 (the HA Behringer
integration exposes them as 0..100). The X Air fader law is piecewise linear
in dB, so ramps must be calculated in dB, not in fader position.
"""

from __future__ import annotations

MIN_DB = -90.0  # treated as -inf
MAX_DB = 10.0


def pos_to_db(pos: float) -> float:
    """Fader position 0..1 -> dB."""
    pos = min(max(pos, 0.0), 1.0)
    if pos >= 0.5:
        return pos * 40.0 - 30.0
    if pos >= 0.25:
        return pos * 80.0 - 50.0
    if pos >= 0.0625:
        return pos * 160.0 - 70.0
    return pos * 480.0 - 90.0


def db_to_pos(db: float) -> float:
    """dB -> fader position 0..1."""
    db = min(max(db, MIN_DB), MAX_DB)
    if db >= -10.0:
        return (db + 30.0) / 40.0
    if db >= -30.0:
        return (db + 50.0) / 80.0
    if db >= -60.0:
        return (db + 70.0) / 160.0
    return (db + 90.0) / 480.0


def ramp_db(start_db: float, end_db: float, steps: int) -> list[float]:
    """Linear-in-dB ramp, excluding the start value, ending exactly at end_db.

    Fading from/to -inf uses -60 dB as the audible floor so the ramp does not
    spend half its time in the inaudible range.
    """
    if steps < 1:
        return [end_db]
    floor = -60.0
    a = max(start_db, floor)
    b = max(end_db, floor)
    values = [a + (b - a) * i / steps for i in range(1, steps + 1)]
    values[-1] = end_db
    return values
