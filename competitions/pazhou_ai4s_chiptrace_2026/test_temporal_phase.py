"""Focused synthetic ChipTrace full-duration, off-phase abstention regression."""
from __future__ import annotations
import tempfile
import unittest
from pathlib import Path
from chiptrace import Observation, analyze, verify_report, write_csv

class AbsoluteTimeOverlapTest(unittest.TestCase):
    def test_shifted_phase_abstains_without_regressing_aligned_runs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            baseline, candidate = root / 'baseline.csv', root / 'candidate.csv'
            write_csv(baseline, [
                Observation('baseline', str(rep), float(step), 'oxygen', 1.0, 'index', 'synthetic', 'sensor')
                for rep in (1, 2) for step in range(20)
            ])
            cases = [
                (range(20), 'SUPPORTED', None),
                (range(1, 21), 'SUPPORTED', None),
                (range(6, 26), 'INSUFFICIENT_EVIDENCE', 13 / 19),
                (range(100, 120), 'INSUFFICIENT_EVIDENCE', 0.0),
            ]
            for elapsed, expected, expected_overlap in cases:
                with self.subTest(first=min(elapsed), state=expected):
                    write_csv(candidate, [
                        Observation('candidate', str(rep), float(step), 'oxygen', 1.0, 'index', 'synthetic', 'sensor')
                        for rep in (1, 2) for step in elapsed
                    ])
                    report = analyze(baseline, candidate)
                    self.assertEqual(report['overall_state'], expected)
                    self.assertTrue(verify_report(report))
                    row = report['channel_assessments'][0]
                    if expected_overlap is None:
                        self.assertNotIn('reference_window_overlap_coverage', row['metrics'])
                    else:
                        self.assertIsNone(row['quality_risk_score'])
                        self.assertEqual(row['uncertainty'], 1.0)
                        self.assertAlmostEqual(row['metrics']['reference_window_overlap_coverage'], expected_overlap, places=6)
                        self.assertIn('75%', ' '.join(row['reasons']))
                        self.assertNotIn('reference_window_coverage', row['metrics'])

if __name__ == '__main__':
    unittest.main()
