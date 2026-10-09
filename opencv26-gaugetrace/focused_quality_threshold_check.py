"""Focused synthetic validation of GaugeTrace's operator-configured quality gates.

No camera calibration, OpenCV 5, Lambda, cloud usage, or contest score is
implied by these checks.
"""
from __future__ import annotations

import numpy as np

from gaugetrace import _quality_thresholds, analyze_image


def check() -> None:
    assert _quality_thresholds({}) == (25.0, 0.25, 1.18)
    assert _quality_thresholds({
        "min_blur_variance": "7.5",
        "max_near_white_fraction": "0.2",
        "min_dominance": "1.6",
    }) == (7.5, 0.2, 1.6)

    invalid = []
    for field in ("min_blur_variance", "max_near_white_fraction", "min_dominance"):
        for value in (float("nan"), float("inf"), -float("inf"), None, True, "bad"):
            invalid.append((field, value))
    invalid.extend((
        ("min_blur_variance", 0),
        ("min_blur_variance", -1),
        ("max_near_white_fraction", -0.1),
        ("max_near_white_fraction", 1),
        ("max_near_white_fraction", 1.4),
        ("min_dominance", 1),
        ("min_dominance", 0.1),
    ))
    calibration = {
        "start_deg": 135, "end_deg": 405,
        "min_value": 0, "max_value": 100,
        "center_px": [80, 80], "radius_px": 60,
    }
    synthetic = np.zeros((160, 160), dtype=np.uint8)
    for key, value in invalid:
        try:
            _quality_thresholds({key: value})
        except ValueError as error:
            assert key in str(error)
        else:
            raise AssertionError(f"unsafe threshold accepted: {key}={value!r}")
        try:
            analyze_image(synthetic, {**calibration, key: value})
        except ValueError as error:
            assert key in str(error)
        else:
            raise AssertionError(f"analyze_image reached image gates with unsafe {key}")

    valid_result, _ = analyze_image(synthetic, calibration)
    assert valid_result["decision"] == "RETAKE_OR_REVIEW"
    assert valid_result["reason"] == "blur_or_low_detail"
    print(f"PASS: defaults, explicit finite overrides, {len(invalid)} invalid configurations blocked before image scoring, and a blank-image abstention")


if __name__ == "__main__":
    check()
