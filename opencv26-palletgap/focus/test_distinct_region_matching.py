"""Bound persistent-region evidence to independent frame correspondences."""
from __future__ import annotations

import unittest
from unittest.mock import patch

import numpy as np

from palletgap.vision import orchestrate


class DistinctConfirmationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.reference = np.zeros((480, 720, 3), dtype=np.uint8)
        self.initial = self.reference.copy()
        self.confirmation = self.reference.copy()
        self.confirmation[0, 0, 0] = 1
        self.aisle = [[175, 120], [545, 120], [525, 429], [185, 429]]

    def decide(self, first_boxes: list[list[int]], second_boxes: list[list[int]]) -> dict:
        first = {"status": "CANDIDATE", "regions": [
            {"box_xywh": rect, "area_px": rect[2] * rect[3]} for rect in first_boxes]}
        follow = {"status": "CANDIDATE", "regions": [
            {"box_xywh": rect, "area_px": rect[2] * rect[3]} for rect in second_boxes]}
        with patch("palletgap.vision.inspect", side_effect=[first, follow]) as inspector:
            decision = orchestrate(self.reference, self.initial, self.aisle, self.confirmation)
        self.assertEqual(inspector.call_count, 2)
        return decision

    def test_one_followup_region_is_only_one_distinct_corroboration(self) -> None:
        first = [[100, 100, 50, 50], [155, 100, 50, 50]]
        second = [[100, 100, 105, 50]]
        result = self.decide(first, second)
        self.assertEqual(result["decision"], "HUMAN_REVIEW_REQUIRED")
        self.assertEqual(result["persistent_regions"], 1)

    def test_augmenting_path_preserves_maximum_distinct_matching(self) -> None:
        # First A matches either followup B; first C only matches the wide B.
        first = [[100, 100, 50, 50], [155, 100, 50, 50]]
        second = [[100, 100, 105, 50], [100, 100, 50, 50]]
        result = self.decide(first, second)
        self.assertEqual(result["persistent_regions"], 2)
        self.assertEqual(result["decision"], "HUMAN_REVIEW_REQUIRED")

    def test_no_overlap_still_requests_disagreement_review(self) -> None:
        result = self.decide([[100, 100, 50, 50]], [[400, 280, 50, 50]])
        self.assertEqual(result["persistent_regions"], 0)
        self.assertEqual(result["decision"], "DISAGREEMENT_REVIEW")

    def test_unchanged_unambiguous_pair(self) -> None:
        result = self.decide([[100, 100, 50, 50]], [[105, 105, 50, 50]])
        self.assertEqual(result["persistent_regions"], 1)

    def test_replayed_confirmation_still_requires_retake(self) -> None:
        first = {"status": "CANDIDATE", "regions": [{"box_xywh": [100, 100, 50, 50], "area_px": 2500}]}
        with patch("palletgap.vision.inspect", return_value=first) as inspector:
            result = orchestrate(self.reference, self.initial, self.aisle, self.initial.copy())
        self.assertEqual(result["decision"], "RETAKE_REQUIRED")
        self.assertEqual(result["reason"], "confirmation_frame_identical")
        self.assertEqual(inspector.call_count, 1)


if __name__ == "__main__":
    unittest.main()
