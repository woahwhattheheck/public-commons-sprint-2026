"""PalletGap focused ROI admission checks using real OpenCV geometry."""
from __future__ import annotations

import random
import unittest

import cv2
import numpy as np

from palletgap.vision import polygon_mask


SHAPE = (480, 720, 3)


def _opencv_mask(points: list[list[int]]) -> np.ndarray:
    result = np.zeros(SHAPE[:2], dtype=np.uint8)
    cv2.fillPoly(result, [np.asarray(points, dtype=np.int32)], 255)
    return result


class SimplePolygonAdmissionTests(unittest.TestCase):
    def test_existing_aisle_and_concave_masks_unchanged(self) -> None:
        valid = [
            [[175, 120], [545, 120], [525, 429], [185, 429]],
            [[170, 110], [530, 110], [530, 410], [400, 410], [400, 275], [170, 275]],
            [[175, 120], [300, 120], [545, 120], [525, 429], [185, 429]],
        ]
        for points in valid:
            with self.subTest(points=points):
                self.assertTrue(np.array_equal(polygon_mask(SHAPE, points), _opencv_mask(points)))

    def test_nonzero_area_self_crossing_rejected(self) -> None:
        # Original source accepts this as its signed OpenCV area is 2,525.5px².
        crossing = [[296, 98], [532, 397], [324, 183], [409, 204]]
        self.assertGreater(abs(cv2.contourArea(np.asarray(crossing, np.float32))), 1800)
        with self.assertRaisesRegex(ValueError, "simple"):
            polygon_mask(SHAPE, crossing)

    def test_edge_backtracking_and_repeated_site_vertices_rejected(self) -> None:
        invalid = [
            [[190, 140], [510, 140], [340, 140], [510, 400], [190, 400]],
            [[190, 140], [510, 140], [510, 400], [190, 140], [190, 400]],
        ]
        for points in invalid:
            with self.subTest(points=points), self.assertRaisesRegex(ValueError, "simple"):
                polygon_mask(SHAPE, points)

    def test_seeded_convex_aisles_keep_exact_opencv_masks(self) -> None:
        generator = random.Random(20261009)
        checked = 0
        for _ in range(1500):
            samples = np.asarray([[generator.randrange(35, 680), generator.randrange(35, 450)]
                                  for _ in range(generator.randrange(5, 10))], dtype=np.int32)
            hull = cv2.convexHull(samples).reshape(-1, 2).tolist()
            if not 3 <= len(hull) <= 12:
                continue
            area = abs(cv2.contourArea(np.asarray(hull, dtype=np.float32)))
            if not 1800 <= area <= 0.85 * SHAPE[0] * SHAPE[1]:
                continue
            self.assertTrue(np.array_equal(polygon_mask(SHAPE, hull), _opencv_mask(hull)))
            checked += 1
        self.assertGreater(checked, 1000)


if __name__ == "__main__":
    unittest.main()
