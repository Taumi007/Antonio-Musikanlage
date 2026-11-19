import pytest

from musikanlage.xair import db_to_pos, pos_to_db, ramp_db


@pytest.mark.parametrize(
    ("pos", "db"),
    [
        # values observed on the restaurant mixers (HA shows pos*100 and the dB sensor)
        (0.749755620956421, 0.0),
        (0.329423278570175, -23.6),
        (0.391006857156754, -18.7),
        (0.0, -90.0),
        (1.0, 10.0),
    ],
)
def test_pos_to_db_matches_mixer(pos, db):
    assert pos_to_db(pos) == pytest.approx(db, abs=0.06)


@pytest.mark.parametrize("db", [-90, -75, -60, -45, -30, -20, -10, -3, 0, 5, 10])
def test_roundtrip(db):
    assert pos_to_db(db_to_pos(db)) == pytest.approx(db, abs=1e-9)


def test_ramp_ends_exactly_and_is_monotonic():
    r = ramp_db(-90, -10, 10)
    assert r[-1] == -10
    assert r[0] > -60  # starts at the audible floor, not at -90
    assert all(b > a for a, b in zip(r, r[1:]))
    down = ramp_db(-10, -90, 5)
    assert down[-1] == -90
