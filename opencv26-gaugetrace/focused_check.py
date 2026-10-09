"""One focused offline acceptance pass: synthetic needle values and ambiguity."""
from __future__ import annotations
import json
from gaugetrace import analyze_image
from demo_fixture import CALIBRATION, synthetic_dial


def run() -> None:
    for wanted in (15, 62, 88):
        got, _ = analyze_image(synthetic_dial(wanted), CALIBRATION)
        assert got["decision"] == "OPERATOR_CONFIRMATION_REQUIRED", (wanted, got)
        assert abs(got["reading"] - wanted) <= 3.0, (wanted, got)
        assert not got["calibration_verified"]
    config = dict(CALIBRATION)
    config["min_dominance"] = 1.5
    got, _ = analyze_image(synthetic_dial(62, extra_needle=28), config)
    assert got["reading"] is None, json.dumps(got)
    assert got["decision"] == "RETAKE_OR_REVIEW", json.dumps(got)
    print("4 focused synthetic checks passed (NOT field validation)")


if __name__ == "__main__":
    run()
