"""Focused temporal-window abstention regression for ChipTrace (no broad suite)."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from chiptrace import Observation, analyze, verify_report, write_csv


class TemporalWindowCoverageTest(unittest.TestCase):
    def test_first_and_last_window_censoring_abstains_without_changing_complete_runs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            baseline = root / 'baseline.csv'
            candidate = root / 'candidate.csv'
            ref = [
                Observation('baseline', str(rep), float(step), 'oxygen',
                            1.0, 'index', 'synthetic', 'sensor')
                for rep in (1, 2) for step in range(20)
            ]
            write_csv(baseline, ref)

            for samples, expected in [
                (range(20), 'SUPPORTED'),
                (range(18), 'SUPPORTED'),  # 17/19 of reference duration
                (range(6), 'INSUFFICIENT_EVIDENCE'),  # early truncation: 5/19
                (range(14, 20), 'INSUFFICIENT_EVIDENCE'),  # late-only: 5/19
            ]:
                run = [
                    Observation('run', str(rep), float(step), 'oxygen',
                                1.0, 'index', 'synthetic', 'sensor')
                    for rep in (1, 2) for step in samples
                ]
                write_csv(candidate, run)
                report = analyze(baseline, candidate)
                self.assertEqual(report['overall_state'], expected)
                self.assertTrue(verify_report(report))
                row = report['channel_assessments'][0]
                if expected == 'INSUFFICIENT_EVIDENCE':
                    self.assertIsNone(row['quality_risk_score'])
                    self.assertLess(row['metrics']['reference_window_coverage'], 0.75)
                    self.assertTrue(any('75%' in reason for reason in row['reasons']))
                else:
                    self.assertNotIn('reference_window_coverage', row['metrics'])


if __name__ == '__main__':
    unittest.main()
