"""Focused synthetic marker-scale reliability check, no actual orchard data."""
import unittest
from unittest.mock import patch

import cv2
import numpy as np

from engine import _scale_edge_px, analyze


class MarkerGeometryFocused(unittest.TestCase):
    def test_square_and_rotation_keep_scale(self):
        base = np.array([[0, 0], [120, 0], [120, 120], [0, 120]], dtype=np.float32)
        angle = np.deg2rad(32)
        rot = np.array([[np.cos(angle), -np.sin(angle)],
                        [np.sin(angle), np.cos(angle)]])
        quad = base @ rot.T + np.array([200, 100])
        self.assertAlmostEqual(_scale_edge_px(quad), 120, places=4)

    def test_foreshortened_sheared_bowtie_and_tiny_reject(self):
        cases = [
            [[100, 100], [240, 100], [185, 155], [110, 155]],
            [[100, 100], [210, 100], [290, 180], [180, 180]],
            [[100, 100], [220, 220], [100, 220], [220, 100]],
            [[0, 0], [20, 0], [20, 20], [0, 20]],
            [[0, 0], [np.nan, 0], [40, 40], [0, 40]],
        ]
        for corners in cases:
            with self.subTest(corners=corners):
                self.assertIsNone(_scale_edge_px(np.array(corners, dtype=np.float32)))

    def test_invalid_marker_suppresses_physical_units_but_keeps_candidates(self):
        image = np.full((640, 960, 3), (39, 91, 44), dtype=np.uint8)
        # Mild pixel-level foliage texture prevents an unrelated global blur gate.
        jitter = np.random.default_rng(19).integers(-6, 7, size=image.shape)
        image = np.clip(image.astype(np.int16) + jitter, 0, 255).astype(np.uint8)
        cv2.circle(image, (300, 320), 45, (28, 31, 203), -1, cv2.LINE_AA)

        class Detector:
            def __init__(self, corners):
                self.corners = corners

            def detectMarkers(self, _):
                return [np.array([self.corners], dtype=np.float32)], np.array([[23]], np.int32), []

        good = [[100, 100], [220, 100], [220, 220], [100, 220]]
        bad = [[100, 100], [240, 100], [185, 155], [110, 155]]
        with patch.object(cv2.aruco, "ArucoDetector", return_value=Detector(good)):
            baseline, _ = analyze(image, raw_sha256="synthetic")
        self.assertEqual(baseline["candidate_count"], 1)
        self.assertIn("approx_diameter_mm", baseline["red_candidates"][0])
        with patch.object(cv2.aruco, "ArucoDetector", return_value=Detector(bad)):
            gated, _ = analyze(image, raw_sha256="synthetic")
        self.assertEqual(gated["candidate_count"], 1)
        self.assertIsNone(gated["reference_marker"])
        self.assertNotIn("approx_diameter_mm", gated["red_candidates"][0])
        self.assertIn("SCALE_MARKER_GEOMETRY_UNRELIABLE", gated["decision"]["reason_codes"])
        self.assertEqual(gated["decision"]["action"], "HUMAN_REVIEW_REQUIRED")
        self.assertTrue(gated["decision"]["human_confirmation_required"])


if __name__ == "__main__":
    unittest.main()
