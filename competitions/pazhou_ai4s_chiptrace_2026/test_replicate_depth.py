"""Full-pipeline synthetic ChipTrace replicate-depth controls (nonclinical).

Run from competition repository root:
    python -m unittest competitions.pazhou_ai4s_chiptrace_2026.test_replicate_depth -v
"""
import tempfile
import unittest
from pathlib import Path

from competitions.pazhou_ai4s_chiptrace_2026.chiptrace import (
    Observation,
    analyze,
    verify_report,
    write_csv,
)


def make_rows(run_id, counts, irregular_sparse_second=False):
    rows = []
    for rep_index, count in enumerate(counts):
        for step in range(count):
            time_s = float(step * 300)
            if irregular_sparse_second and rep_index == 1 and count == 2 and step == 1:
                # Almost full experiment duration, but an off-cadence gap that
                # the existing missingness inference cannot identify.
                time_s = 3200.0
            rows.append(Observation(
                run_id=run_id,
                replicate_id=f"r{rep_index + 1}",
                time_s=time_s,
                channel="barrier_index",
                value=(1.0, 1.01, 0.99)[step % 3],
                unit="relative_index",
                source="synthetic_nonclinical_control",
                modality="sensor_feature",
            ))
    return rows


class ReplicateDepthSufficiencyTests(unittest.TestCase):
    def report(self, baseline_counts, candidate_counts, irregular=False):
        with tempfile.TemporaryDirectory() as d:
            baseline = Path(d) / "baseline.csv"
            candidate = Path(d) / "candidate.csv"
            write_csv(baseline, make_rows("baseline", baseline_counts))
            write_csv(candidate, make_rows("candidate", candidate_counts, irregular))
            result = analyze(baseline, candidate)
            self.assertTrue(verify_report(result))
            return result

    def test_sparse_full_span_second_replicate_must_abstain(self):
        report = self.report([12, 12], [12, 2], irregular=True)
        self.assertEqual("INSUFFICIENT_EVIDENCE", report["overall_state"])
        ch = report["channel_assessments"][0]
        self.assertEqual(2, ch["replicate_evidence"]["candidate_independent_replicates"])
        self.assertEqual(1, ch["replicate_evidence"]["qualified_candidate_replicates"])
        self.assertEqual(3, ch["replicate_evidence"]["minimum_points_per_candidate_replicate"])
        self.assertLess(ch["metrics"]["missing_fraction"], 0.05)
        self.assertGreater(3200 / 3300, 0.75)

    def test_complete_two_replicates_still_supported(self):
        report = self.report([12, 12], [12, 12])
        self.assertEqual("SUPPORTED", report["overall_state"])
        self.assertNotIn("replicate_evidence", report["channel_assessments"][0])

    def test_single_replicate_reference_still_supported(self):
        report = self.report([12], [12])
        self.assertEqual("SUPPORTED", report["overall_state"])
        self.assertNotIn("replicate_evidence", report["channel_assessments"][0])


if __name__ == "__main__":
    unittest.main()
