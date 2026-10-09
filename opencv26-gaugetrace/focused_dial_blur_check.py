"""Focused synthetic dial-local blur regression; not real-gauge validation.

Run from opencv26-gaugetrace: python focused_dial_blur_check.py
"""
from __future__ import annotations

import cv2
import numpy as np

from demo_fixture import CALIBRATION, synthetic_dial
from gaugetrace import analyze_image


def _busy_outside(gray: np.ndarray) -> np.ndarray:
    """Artificial high-frequency background beyond the fixed gauge circle."""
    yy, xx = np.indices(gray.shape)
    cx, cy = CALIBRATION["center_px"]
    radius = CALIBRATION["radius_px"]
    outside = (xx - cx) ** 2 + (yy - cy) ** 2 > (radius * 1.05) ** 2
    checker = np.where((xx + yy) % 2, 255, 0).astype(np.uint8)
    result = gray.copy()
    result[outside] = checker[outside]
    return result


def run() -> None:
    gray = cv2.cvtColor(synthetic_dial(62), cv2.COLOR_BGR2GRAY)
    cases = (
        ("clear", gray, "OPERATOR_CONFIRMATION_REQUIRED"),
        ("clear_busy_background", _busy_outside(gray), "OPERATOR_CONFIRMATION_REQUIRED"),
        ("blurred_busy_background",
         _busy_outside(cv2.GaussianBlur(gray, (0, 0), 2.0)), "RETAKE_OR_REVIEW"),
    )
    for label, frame, decision in cases:
        got, _ = analyze_image(frame, CALIBRATION)
        assert got["decision"] == decision, (label, got)
        diagnostics = got["diagnostics"]
        if label == "blurred_busy_background":
            assert got["reason"] == "blur_or_low_detail", got
            assert diagnostics["blur_laplacian_variance"] > 25, diagnostics
            assert diagnostics["dial_blur_laplacian_variance"] < 25, diagnostics
            assert got["reading"] is None, got
        else:
            assert abs(got["reading"] - 62) < 3, (label, got)
            assert not got["calibration_verified"], got
        print(label, got["decision"],
              "global", diagnostics["blur_laplacian_variance"],
              "dial", diagnostics["dial_blur_laplacian_variance"])
    print("3/3 focused synthetic cases passed (not instrument or OpenCV5 validation)")


if __name__ == "__main__":
    run()
