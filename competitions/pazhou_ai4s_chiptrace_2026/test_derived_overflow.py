"""Original ChipTrace module checks for finite-input derived arithmetic overflow."""
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

try:
    from . import chiptrace as qc
except ImportError:
    import chiptrace as qc


class DerivedOverflowRegression(unittest.TestCase):
    def test_finite_input_overflow_abstains_with_strict_json_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            baseline, candidate = qc.generate_demo(Path(directory))
            nominal = qc.analyze(baseline, candidate)
            self.assertTrue(qc.verify_report(nominal))
            json.dumps(nominal, allow_nan=False)

            readings = qc.load_csv(candidate)
            extreme = [replace(row, value=1e308) if row.channel == 'barrier_index'
                       else row for row in readings]
            qc.write_csv(candidate, extreme)
            report = qc.analyze(baseline, candidate)
            barrier = next(row for row in report['channel_assessments']
                           if row['channel'] == 'barrier_index')
            self.assertEqual(report['overall_state'], 'INSUFFICIENT_EVIDENCE')
            self.assertEqual(barrier['state'], 'INSUFFICIENT_EVIDENCE')
            self.assertIsNone(barrier['quality_risk_score'])
            self.assertEqual(barrier['uncertainty'], 1.0)
            self.assertIsNone(barrier['metrics']['level_z'])
            self.assertIn('metrics.level_z', barrier['derived_overflow_abstention'])
            self.assertEqual(barrier['score_components'], {})
            json.dumps(report, allow_nan=False)
            self.assertTrue(qc.verify_report(report))

    def test_nonfinite_receipt_is_rejected(self):
        with self.assertRaises(qc.ContractError):
            qc.canonical_bytes({'derived': float('inf')})

    def test_finite_input_cannot_overflow_reference_model(self):
        with tempfile.TemporaryDirectory() as directory:
            baseline, candidate = qc.generate_demo(Path(directory))
            rows = qc.load_csv(baseline)
            rewritten = [replace(row, value=1e308) if row.channel == 'barrier_index'
                         else row for row in rows]
            qc.write_csv(baseline, rewritten)
            with self.assertRaises(qc.ContractError):
                qc.analyze(baseline, candidate)


if __name__ == '__main__':
    unittest.main()
