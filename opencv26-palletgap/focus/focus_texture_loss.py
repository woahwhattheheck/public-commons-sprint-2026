#!/usr/bin/env python3
"""One small deterministic PalletGap texture-loss regression, never a field score.

Run from opencv26-palletgap: python focus/focus_texture_loss.py
Requires existing OpenCV and NumPy from requirements.txt. No camera/AWS/network.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from palletgap import vision


AISLE = [[100, 100], [540, 100], [540, 440], [100, 440]]
POS = [(180, 200), (330, 270), (460, 350)]
SIZE = 48


def reference_frame() -> np.ndarray:
    """Seeded dense texture plus separated reference anchors for ORB."""
    rng = np.random.default_rng(20261009)
    noise = rng.integers(-22, 23, (480, 640), dtype=np.int16)
    gray = np.clip(137 + noise, 0, 255).astype(np.uint8)
    frame = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    for x in range(22, 610, 85):
        for y in range(25, 460, 81):
            cv2.rectangle(frame, (x, y), (x + 17, y + 12), (105, 180, 110), 1)
    return frame


def overlay(frame: np.ndarray, x: int, y: int, style: str) -> np.ndarray:
    out = frame.copy()
    if style == "flat_matched":
        out[y:y+SIZE, x:x+SIZE] = (137, 137, 137)
    elif style == "blur_same_color":
        patch = out[y:y+SIZE, x:x+SIZE]
        out[y:y+SIZE, x:x+SIZE] = cv2.GaussianBlur(patch, (15, 15), 5)
    else:
        raise ValueError(style)
    return out


def original_color_only_candidate(reference: np.ndarray, live: np.ndarray) -> bool:
    """Replays pre-change Lab mask with same registration/area rules."""
    params = vision.Parameters()
    roi = vision.polygon_mask(reference.shape, AISLE)
    aligned, diag = vision.register(reference, live, params)
    if aligned is None:
        raise AssertionError(f"Synthetic registration not usable: {diag}")
    ref_lab = cv2.cvtColor(reference, cv2.COLOR_BGR2LAB).astype(np.float32)
    live_lab = cv2.cvtColor(aligned, cv2.COLOR_BGR2LAB).astype(np.float32)
    whole = cv2.erode(roi, np.ones((7, 7), np.uint8)) > 0
    shifts = np.median((live_lab - ref_lab)[whole], axis=0)
    difference = np.abs(live_lab - ref_lab - shifts)
    changed = (np.sqrt(np.mean(difference ** 2, axis=2)) > params.pixel_change_threshold).astype(np.uint8) * 255
    changed[roi == 0] = 0
    changed = cv2.morphologyEx(changed, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    changed = cv2.morphologyEx(changed, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    changed[roi == 0] = 0
    count, _, stats, _ = cv2.connectedComponentsWithStats(changed)
    min_area = max(params.min_area_pixels, int(np.count_nonzero(roi) * params.min_fraction))
    return any(int(row[4]) >= min_area for row in stats[1:count])


def main() -> None:
    reference = reference_frame()
    clean = [
        ("unchanged", reference.copy()),
        ("slightly_brighter", cv2.convertScaleAbs(reference, alpha=1.04, beta=2)),
        ("slightly_dimmer", cv2.convertScaleAbs(reference, alpha=0.96, beta=-2)),
    ]
    adversarial = [(f"{style}_{i}", overlay(reference, x, y, style))
                   for style in ("flat_matched", "blur_same_color")
                   for i, (x, y) in enumerate(POS)]
    results = []
    for kind, group, wanted in (("clean", clean, "OBSERVED_NO_CHANGE"),
                                ("obstruction", adversarial, "SECOND_VIEW_REQUIRED")):
        for name, frame in group:
            actual = vision.orchestrate(reference, frame, AISLE)["decision"]
            previous_detected = original_color_only_candidate(reference, frame)
            results.append({"kind": kind, "name": name, "old_color_only": previous_detected,
                            "new_decision": actual, "passed": actual == wanted})
    report = {"schema": "palletgap.texture-focused.v1", "synthetic_only": True,
              "color_threshold_unchanged": vision.Parameters().pixel_change_threshold == 24.0,
              "cases": results, "passed": sum(row["passed"] for row in results), "total": len(results)}
    print(json.dumps(report, indent=2))
    assert report["color_threshold_unchanged"], "Original color threshold changed"
    assert report["passed"] == report["total"], "Focused synthetic evidence regression"
    assert any(not row["old_color_only"] for row in results if row["kind"] == "obstruction"), "No demonstrated original gap"


if __name__ == "__main__":
    main()
