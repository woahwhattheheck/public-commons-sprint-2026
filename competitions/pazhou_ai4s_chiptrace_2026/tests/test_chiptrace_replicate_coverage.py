"""One focused synthetic ChipTrace regression, not an official scientific assay."""
from pathlib import Path
import importlib.util
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('chiptrace_replicate_focus', HERE / 'chiptrace.py')
assert SPEC and SPEC.loader
ct = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ct
SPEC.loader.exec_module(ct)


class ReplicateEvidenceCoverage(unittest.TestCase):
    def test_candidate_replicate_attrition_abstains_without_changing_clean_controls(self):
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            baseline_path, _ = ct.generate_demo(root)
            baseline = ct.load_csv(baseline_path)
            clean = [ct.Observation(
                'clean_candidate', o.replicate_id, o.time_s, o.channel,
                o.value, o.unit, o.source, o.modality
            ) for o in baseline]
            all_path = root / 'all_replicates.csv'
            ct.write_csv(all_path, clean)
            complete = ct.analyze(baseline_path, all_path)
            self.assertEqual(complete['overall_state'], 'SUPPORTED')
            self.assertTrue(ct.verify_report(complete))
            self.assertFalse(any('replicate_evidence' in row for row in complete['channel_assessments']))

            one_path = root / 'one_replicate.csv'
            ct.write_csv(one_path, [o for o in clean if o.replicate_id == 'b1'])
            missing = ct.analyze(baseline_path, one_path)
            self.assertEqual(missing['overall_state'], 'INSUFFICIENT_EVIDENCE')
            self.assertTrue(ct.verify_report(missing))
            for row in missing['channel_assessments']:
                self.assertEqual(row['state'], 'INSUFFICIENT_EVIDENCE')
                self.assertEqual(row['replicate_evidence']['baseline_independent_replicates'], 3)
                self.assertEqual(row['replicate_evidence']['candidate_independent_replicates'], 1)
                self.assertEqual(row['replicate_evidence']['minimum_candidate_replicates'], 2)
                self.assertGreaterEqual(row['uncertainty'], 0.75)

            baseline_one = root / 'baseline_one.csv'
            ct.write_csv(baseline_one, [o for o in baseline if o.replicate_id == 'b1'])
            legacy = ct.analyze(baseline_one, one_path)
            self.assertEqual(legacy['overall_state'], 'SUPPORTED')
            self.assertTrue(ct.verify_report(legacy))


if __name__ == '__main__':
    unittest.main()
