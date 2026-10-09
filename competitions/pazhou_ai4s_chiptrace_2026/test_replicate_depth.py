"""Focused nonclinical ChipTrace replicate-depth sufficiency controls.

Run from the competition repository root:
    python -m unittest competitions.pazhou_ai4s_chiptrace_2026.test_replicate_depth -v
"""
import unittest

from competitions.pazhou_ai4s_chiptrace_2026.chiptrace import (
    Observation,
    assess_channel,
    build_baselines,
)


def make_rows(run_id, counts):
    rows = []
    for rep_index, count in enumerate(counts):
        for step in range(count):
            rows.append(Observation(
                run_id=run_id,
                replicate_id=f"r{rep_index + 1}",
                time_s=float(step * 300),
                channel="barrier_index",
                value=(1.0, 1.01, 0.99)[step % 3],
                unit="relative_index",
                source="synthetic_nonclinical_control",
                modality="sensor_feature",
            ))
    return rows


class ReplicateDepthSufficiencyTests(unittest.TestCase):
    def assessment(self, baseline_counts, candidate_counts):
        baseline_rows = make_rows("baseline", baseline_counts)
        return assess_channel(
            "barrier_index",
            make_rows("candidate", candidate_counts),
            build_baselines(baseline_rows)["barrier_index"],
            0.0, 6, 12,
        )

    def test_token_replicate_cannot_claim_independent_coverage(self):
        row = self.assessment([12, 12], [12, 1])
        self.assertEqual("INSUFFICIENT_EVIDENCE", row["state"])
        self.assertEqual(2, row["replicate_evidence"]["candidate_independent_replicates"])
        self.assertEqual(1, row["replicate_evidence"]["qualified_candidate_replicates"])
        self.assertEqual(3, row["replicate_evidence"]["minimum_points_per_candidate_replicate"])

    def test_both_replicates_have_minimum_depth(self):
        row = self.assessment([12, 12], [12, 3])
        self.assertEqual("SUPPORTED", row["state"])
        self.assertNotIn("replicate_evidence", row)

    def test_single_replicate_reference_remains_supported(self):
        row = self.assessment([24], [12])
        self.assertEqual("SUPPORTED", row["state"])
        self.assertNotIn("replicate_evidence", row)


if __name__ == "__main__":
    unittest.main()
