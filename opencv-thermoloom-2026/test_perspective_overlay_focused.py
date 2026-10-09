# SPDX-License-Identifier: MIT
"""Focused source-bound ThermoLoom perspective-overlay regression."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from thermoloom import ImageRejected, inspect, overlay

CORNERS = [[30, 29], [687, 18], [699, 452], [24, 460]]


def image():
    rng = np.random.default_rng(20261009)
    h, w = 480, 720
    noise = rng.integers(-4, 5, (h, w), dtype=np.int16)
    gradient = np.arange(w, dtype=np.int16)[None, :] // 90
    arr = np.clip(78 + noise + gradient, 0, 255).astype(np.uint8)
    cv2.ellipse(arr, (430, 180), (13, 10), 0, 0, 360, 190, -1)
    return arr


class PerspectiveOverlayTest(unittest.TestCase):
    def test_rectified_identity_and_legacy_input(self):
        source = image()
        report = inspect(source, corners=CORNERS)
        self.assertEqual(report["pixel_space"], "rectified")
        self.assertTrue(report["evidence"])
        drawn = overlay(source, report, corners=CORNERS)
        self.assertEqual(drawn.shape, (480, 720, 3))
        red = (drawn[:, :, 0] == 0) & (drawn[:, :, 1] == 0) & (drawn[:, :, 2] == 255)
        self.assertGreater(int(red.sum()), 50)
        with self.assertRaises(ImageRejected):
            overlay(source, report)
        moved = [list(c) for c in CORNERS]
        moved[0][0] += 7
        with self.assertRaises(ImageRejected):
            overlay(source, report, corners=moved)
        changed = source.copy()
        changed[200:240, 150:190] = 99
        with self.assertRaises(ImageRejected):
            overlay(changed, report, corners=CORNERS)
        original = inspect(source)
        self.assertEqual(overlay(source, original).shape, (480, 720, 3))
        with self.assertRaises(ImageRejected):
            overlay(source, original, corners=CORNERS)

    def test_cli_rectified_overlay_created(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(__file__).resolve().parent
            output = Path(td)
            self.assertTrue(cv2.imwrite(str(output / "in.png"), image()))
            (output / "corners.json").write_text(json.dumps(CORNERS), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(root / "thermoloom.py"), str(output / "in.png"),
                 "--corners-json", str(output / "corners.json"),
                 "--overlay", str(output / "evidence.png"),
                 "--out", str(output / "result.json")],
                cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            receipt = json.loads((output / "result.json").read_text(encoding="utf-8"))
            self.assertEqual(receipt["pixel_space"], "rectified")
            self.assertEqual(cv2.imread(str(output / "evidence.png")).shape, (480, 720, 3))


if __name__ == "__main__":
    unittest.main()
