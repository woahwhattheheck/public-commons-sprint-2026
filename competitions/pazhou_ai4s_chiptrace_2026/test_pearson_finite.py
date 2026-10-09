"""Focused non-clinical numeric-contract regressions for ChipTrace Pearson."""
import json
import math
import unittest

try:
    from .chiptrace import pearson
except ImportError:
    from chiptrace import pearson


class PearsonFiniteTests(unittest.TestCase):
    def test_finite_extremes_do_not_emit_nan(self):
        series = [1e200, 2e200, 3e200]
        correlation = pearson(series, series)
        self.assertIsNotNone(correlation)
        self.assertAlmostEqual(correlation, 1.0)
        json.dumps({"correlation": correlation}, allow_nan=False)
        self.assertAlmostEqual(pearson(series, list(reversed(series))), -1.0)

    def test_ordinary_correlation_still_matches(self):
        self.assertAlmostEqual(pearson([1., 2., 3.], [2., 4., 6.]), 1.0)

    def test_original_variance_floor_and_constant_trace(self):
        self.assertIsNone(pearson([1e-20, 2e-20, 3e-20],
                                  [1e-20, 2e-20, 3e-20]))
        self.assertIsNone(pearson([1., 1., 1.], [1., 2., 3.]))


if __name__ == "__main__":
    unittest.main()
