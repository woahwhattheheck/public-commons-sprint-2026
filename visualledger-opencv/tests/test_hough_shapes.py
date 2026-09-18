"""Native execution plus Hough return-shape contracts, not a fake cv2-5 runtime.

The adapter changes ONLY HoughLinesP's array dimensions. Version metadata and
all image processing still come from the actually installed OpenCV module.
"""
from __future__ import annotations

import unittest

import cv2
import numpy as np

from visualledger.agent import canonical, compile_trace, verify_trace
from visualledger.synth import benchmark_cases, make_case
from visualledger.vision import VisionError, _text_lines, analyze_image


class FixedLines:
    def __init__(self, lines):
        self.lines = lines
        self.calls = 0

    def Canny(self, gray, *_args):
        return np.zeros_like(gray)

    def HoughLinesP(self, *_args, **_kwargs):
        self.calls += 1
        return self.lines


class NativeShape:
    """Adapt the array layout without changing the actual runtime version."""

    def __init__(self, flat: bool):
        self.flat = flat

    def __getattr__(self, name):
        return getattr(cv2, name)

    def HoughLinesP(self, *args, **kwargs):
        result = cv2.HoughLinesP(*args, **kwargs)
        if result is None:
            return None
        rows = result.reshape(-1, 4)
        return rows if self.flat else rows[:, None, :]


class HoughShapeTests(unittest.TestCase):
    def setUp(self):
        self.gray = np.zeros((400, 400), dtype=np.uint8)
        self.rows = np.array([
            [60, 80, 320, 80],
            [60, 83, 320, 83],  # duplicate y within six pixels
            [60, 150, 320, 150],
            [60, 240, 320, 240],
            [60, 5, 320, 5],    # top border
            [60, 390, 320, 390],  # bottom border
            [60, 300, 80, 300],  # too short
            [60, 40, 65, 340],   # vertical
            [60, 330, 320, 360],  # too steep
        ], dtype=np.int32)

    def test_flat_n_by_four(self):
        self.assertEqual(_text_lines(self.gray, FixedLines(self.rows)), 3)

    def test_legacy_n_by_one_by_four(self):
        self.assertEqual(_text_lines(self.gray, FixedLines(self.rows[:, None, :])), 3)

    def test_single_line_both_layouts(self):
        for rows in (self.rows[:1], self.rows[:1, None, :]):
            with self.subTest(shape=rows.shape):
                self.assertEqual(_text_lines(self.gray, FixedLines(rows)), 1)

    def test_none_is_zero(self):
        self.assertEqual(_text_lines(self.gray, FixedLines(None)), 0)

    def test_empty_supported_layouts_are_zero(self):
        for shape in ((0, 4), (0, 1, 4)):
            with self.subTest(shape=shape):
                self.assertEqual(_text_lines(self.gray, FixedLines(np.empty(shape, dtype=np.int32))), 0)

    def test_unsupported_layouts_raise_vision_error(self):
        for shape in ((), (0,), (4,), (1, 2), (1, 2, 2), (1, 4, 1), (1, 1, 1, 4), (0, 2, 2)):
            with self.subTest(shape=shape):
                with self.assertRaisesRegex(VisionError, "Hough"):
                    _text_lines(self.gray, FixedLines(np.zeros(shape, dtype=np.int32)))
        with self.assertRaisesRegex(VisionError, "Hough"):
            _text_lines(self.gray, FixedLines([[60, 80, 320, 80]]))

    def test_small_image_skips_hough(self):
        adapter = FixedLines(self.rows)
        for shape in ((63, 400), (400, 63)):
            self.assertEqual(_text_lines(np.zeros(shape, dtype=np.uint8), adapter), 0)
        self.assertEqual(adapter.calls, 0)

    def test_noncontiguous_flat_layout(self):
        storage = np.zeros((len(self.rows), 8), dtype=np.int32)
        storage[:, ::2] = self.rows
        view = storage[:, ::2]
        self.assertFalse(view.flags.c_contiguous)
        self.assertEqual(_text_lines(self.gray, FixedLines(view)), 3)

    def test_noncontiguous_legacy_layout(self):
        storage = np.zeros((len(self.rows), 1, 8), dtype=np.int32)
        storage[:, 0, ::2] = self.rows
        view = storage[:, :, ::2]
        self.assertFalse(view.flags.c_contiguous)
        self.assertEqual(_text_lines(self.gray, FixedLines(view)), 3)

    def test_input_arrays_are_not_modified(self):
        for rows in (self.rows.copy(), self.rows[:, None, :].copy()):
            before = rows.copy()
            _text_lines(self.gray, FixedLines(rows))
            np.testing.assert_array_equal(rows, before)

    def test_y_dedup_threshold_is_preserved(self):
        rows = np.array([[50, y, 300, y] for y in (100, 106, 107, 113, 114)], dtype=np.int32)
        for value in (rows, rows[:, None, :]):
            self.assertEqual(_text_lines(self.gray, FixedLines(value)), 3)

    def test_length_slope_and_border_thresholds_are_preserved(self):
        rows = np.array([
            [50, 16, 100, 16],    # minimum dx and top boundary included
            [50, 384, 100, 384],  # bottom boundary included
            [50, 100, 99, 100],   # dx=49 below minimum
            [50, 200, 150, 206],  # dy=6 above dx/20
            [50, 240, 150, 245],  # dy=5 accepted
        ], dtype=np.int32)
        for value in (rows, rows[:, None, :]):
            self.assertEqual(_text_lines(self.gray, FixedLines(value)), 3)

    def test_many_known_lines_match_in_both_layouts(self):
        for count in range(1, 41):
            rows = np.array([[50, 25 + 8 * i, 340, 25 + 8 * i] for i in range(count)], dtype=np.int32)
            with self.subTest(count=count):
                self.assertEqual(_text_lines(self.gray, FixedLines(rows)), count)
                self.assertEqual(_text_lines(self.gray, FixedLines(rows[:, None, :])), count)


class ImageAndTraceShapeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = {row['kind']: (make_case(row['kind']), row['expected_action']) for row in benchmark_cases()}
        cls.flat = NativeShape(True)
        cls.legacy = NativeShape(False)
        cls.allow_dev = int(cv2.__version__.split('.', 1)[0]) < 5

    def test_native_runtime_clear_document_has_text_lines(self):
        raw, _ = self.cases['clear']
        perception = analyze_image(raw, allow_opencv4_dev=self.allow_dev)
        self.assertGreaterEqual(perception['text_line_count'], 12)
        self.assertEqual(perception['opencv_version'], cv2.__version__)
        self.assertEqual(perception['competition_opencv5_runtime'], not self.allow_dev)
        self.assertEqual(perception['development_compatibility_used'], self.allow_dev)

    def test_all_five_perception_results_are_layout_identical(self):
        for kind, (raw, _) in self.cases.items():
            with self.subTest(kind=kind):
                flat = analyze_image(raw, allow_opencv4_dev=self.allow_dev, cv2_module=self.flat)
                legacy = analyze_image(raw, allow_opencv4_dev=self.allow_dev, cv2_module=self.legacy)
                self.assertEqual(flat, legacy)
                self.assertEqual(flat['opencv_version'], cv2.__version__)

    def test_all_five_actions_receipts_and_replays_are_layout_identical(self):
        for kind, (raw, action) in self.cases.items():
            with self.subTest(kind=kind):
                flat = compile_trace(raw, evidence_id=kind, allow_opencv4_dev=self.allow_dev, cv2_module=self.flat)
                legacy = compile_trace(raw, evidence_id=kind, allow_opencv4_dev=self.allow_dev, cv2_module=self.legacy)
                self.assertEqual(canonical(flat), canonical(legacy))
                self.assertEqual(flat['decision']['action'], action)
                self.assertIs(flat['decision']['human_review_required'], True)
                self.assertTrue(all(value is False for value in flat['authority'].values()))
                self.assertTrue(all(value is False for value in flat['truth'].values()))
                replay = verify_trace(flat, raw, allow_opencv4_dev=self.allow_dev, cv2_module=self.legacy)
                self.assertEqual(replay, flat)

    def test_duplicate_route_and_replay_are_layout_identical(self):
        raw, _ = self.cases['clear']
        first = analyze_image(raw, allow_opencv4_dev=self.allow_dev)
        prior = [{'evidence_id': 'prior', 'fingerprint': first['fingerprint_dhash64']}]
        flat = compile_trace(raw, evidence_id='replay', prior_fingerprints=prior, allow_opencv4_dev=self.allow_dev, cv2_module=self.flat)
        self.assertEqual(flat['decision']['action'], 'QUARANTINE_DUPLICATE_REVIEW')
        self.assertEqual(verify_trace(flat, raw, prior_fingerprints=prior, allow_opencv4_dev=self.allow_dev, cv2_module=self.legacy), flat)

    def test_native_shape_adapter_never_spoofs_version(self):
        self.assertEqual(self.flat.__version__, cv2.__version__)
        self.assertEqual(self.legacy.__version__, cv2.__version__)
        if self.allow_dev:
            raw, _ = self.cases['clear']
            with self.assertRaisesRegex(VisionError, 'requires OpenCV 5'):
                analyze_image(raw, cv2_module=self.flat)


if __name__ == '__main__':
    unittest.main()
