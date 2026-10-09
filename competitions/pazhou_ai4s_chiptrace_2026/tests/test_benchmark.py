import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("chiptrace_benchmark", HERE / "benchmark.py")
bench = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules["chiptrace_benchmark"] = bench
SPEC.loader.exec_module(bench)


class ChipTraceBenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_frozen_corpus_hits_expected_qc_states(self):
        corpus = bench.build_frozen_corpus(self.root)
        observed = {}
        for scenario in bench.SCENARIOS:
            baseline, candidate = corpus[scenario.name]
            observed[scenario.name] = bench.ct.analyze(baseline, candidate)["overall_state"]
        self.assertEqual(
            observed,
            {
                "clean": "SUPPORTED",
                "level_shift": "REVIEW",
                "cadence_gap": "REVIEW",
                "replicate_divergence": "REVIEW",
                "sparse": "INSUFFICIENT_EVIDENCE",
            },
        )

    def test_triage_citations_resolve_and_sparse_abstains(self):
        corpus = bench.build_frozen_corpus(self.root)
        baseline, candidate = corpus["sparse"]
        report = bench.ct.analyze(baseline, candidate)
        triage = bench.triage_report(report)
        self.assertEqual(triage["decision"], "ABSTAIN")
        check = bench.validate_citations(report, triage)
        self.assertEqual(check["valid"], check["total"])
        self.assertEqual(check["failures"], [])

    def test_benchmark_scores_classification_abstention_and_stability(self):
        result = bench.run_benchmark(self.root, repeats=2)
        self.assertEqual(result["qc_only"]["precision"], 1.0)
        self.assertEqual(result["qc_only"]["recall"], 1.0)
        self.assertEqual(result["qc_only"]["f1"], 1.0)
        self.assertEqual(result["qc_only"]["false_flag_rate"], 0.0)
        self.assertEqual(result["evidence_bound_triage"]["f1"], 1.0)
        self.assertEqual(result["evidence_bound_triage"]["abstention_accuracy"], 1.0)
        self.assertEqual(result["evidence_bound_triage"]["citation_validity"], 1.0)
        self.assertEqual(result["evidence_bound_triage"]["decision_churn_rate"], 0.0)
        self.assertGreaterEqual(result["latency_ms"]["median"], 0.0)
        self.assertGreaterEqual(result["latency_ms"]["p95"], result["latency_ms"]["median"])

    def test_labeled_abstention_reduces_coverage_and_exact_accuracy(self):
        # Historical binary coding counted abstention on a clean control as TN.
        rows = [
            {"expected_state": "SUPPORTED", "qc_state": "INSUFFICIENT_EVIDENCE"},
            {"expected_state": "SUPPORTED", "qc_state": "SUPPORTED"},
            {"expected_state": "REVIEW", "qc_state": "REVIEW"},
            {"expected_state": "REVIEW", "qc_state": "INSUFFICIENT_EVIDENCE"},
            {"expected_state": "INSUFFICIENT_EVIDENCE", "qc_state": "INSUFFICIENT_EVIDENCE"},
        ]
        result = bench._classification_metrics(rows, "qc_state")
        self.assertEqual(result["considered"], 4)
        self.assertEqual(result["classified"], 2)
        self.assertEqual(result["abstained_on_labeled"], 2)
        self.assertEqual(result["abstained_review"], 1)
        self.assertEqual(result["abstained_supported"], 1)
        self.assertEqual(result["tp"], 1)
        self.assertEqual(result["tn"], 1)
        self.assertEqual(result["fp"], 0)
        self.assertEqual(result["fn"], 0)
        self.assertEqual(result["coverage"], 0.5)
        self.assertEqual(result["labeled_exact_accuracy"], 0.5)
        self.assertEqual(result["recall"], 0.5)
        self.assertEqual(result["supported_recall"], 0.5)
        self.assertEqual(result["f1"], 0.666667)

    def test_classification_rejects_unknown_state_instead_of_silent_negative(self):
        with self.assertRaises(ValueError):
            bench._classification_metrics(
                [{"expected_state": "SUPPORTED", "qc_state": "UNEXPECTED"}], "qc_state"
            )
        with self.assertRaises(ValueError):
            bench._classification_metrics(
                [{"expected_state": "UNEXPECTED", "qc_state": "SUPPORTED"}], "qc_state"
            )

    def test_citation_validation_detects_tamper(self):
        corpus = bench.build_frozen_corpus(self.root)
        baseline, candidate = corpus["level_shift"]
        report = bench.ct.analyze(baseline, candidate)
        triage = bench.triage_report(report)
        triage["citations"][0]["value"] = "SUPPORTED"
        check = bench.validate_citations(report, triage)
        self.assertLess(check["valid"], check["total"])
        self.assertIn("/overall_state", check["failures"])


if __name__ == "__main__":
    unittest.main()
