import csv
import importlib.util
import json
import tempfile
import unittest
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("chiptrace", HERE / "chiptrace.py")
ct = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules["chiptrace"] = ct
SPEC.loader.exec_module(ct)


class ChipTraceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_demo_is_deterministic_and_detects_review(self):
        a = self.root / "a"
        b = self.root / "b"
        ba, ra = ct.generate_demo(a)
        bb, rb = ct.generate_demo(b)
        self.assertEqual(ba.read_bytes(), bb.read_bytes())
        self.assertEqual(ra.read_bytes(), rb.read_bytes())
        report1 = ct.analyze(ba, ra)
        report2 = ct.analyze(ba, ra)
        self.assertEqual(report1, report2)
        self.assertEqual(report1["overall_state"], "REVIEW")
        states = {x["channel"]: x["state"] for x in report1["channel_assessments"]}
        self.assertEqual(states["barrier_index"], "REVIEW")
        self.assertEqual(states["oxygen_index"], "REVIEW")
        self.assertTrue(ct.verify_report(report1))

    def test_receipt_detects_tamper(self):
        b, r = ct.generate_demo(self.root)
        report = ct.analyze(b, r)
        self.assertTrue(ct.verify_report(report))
        report["overall_state"] = "SUPPORTED"
        self.assertFalse(ct.verify_report(report))

    def test_html_carries_scope_disclaimer_and_receipt(self):
        b, r = ct.generate_demo(self.root)
        report = ct.analyze(b, r)
        page = ct.render_html(report)
        self.assertIn("Research QC only", page)
        self.assertIn(report["receipt_sha256"], page)
        self.assertIn("does not establish biological efficacy", page)

    def test_unknown_or_identity_column_is_fail_closed(self):
        p = self.root / "bad.csv"
        p.write_text(
            "run_id,replicate_id,time_s,channel,value,unit,source,modality,patient_id\n"
            "r,x,0,c,1,u,s,m,P123\n",
            encoding="utf-8",
        )
        with self.assertRaises(ct.ContractError):
            ct.load_csv(p)

    def test_duplicate_observation_is_rejected(self):
        p = self.root / "dup.csv"
        header = ",".join(ct.REQUIRED_COLUMNS)
        row = "r,x,0,c,1,u,s,m"
        p.write_text(header + "\n" + row + "\n" + row + "\n", encoding="utf-8")
        with self.assertRaises(ct.ContractError):
            ct.load_csv(p)

    def test_unit_mismatch_is_rejected(self):
        b, r = ct.generate_demo(self.root)
        rows = list(csv.reader(r.read_text(encoding="utf-8").splitlines()))
        rows[1][5] = "wrong_unit"
        bad = self.root / "bad_run.csv"
        with bad.open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerows(rows)
        with self.assertRaises(ct.ContractError):
            ct.analyze(b, bad)

    def test_small_run_is_insufficient_evidence(self):
        b, r = ct.generate_demo(self.root)
        obs = ct.load_csv(r)
        one_channel = [x for x in obs if x.channel == "flow_index"][:3]
        small = self.root / "small.csv"
        ct.write_csv(small, one_channel)
        report = ct.analyze(b, small)
        self.assertEqual(report["overall_state"], "INSUFFICIENT_EVIDENCE")
        self.assertEqual(report["channel_assessments"][0]["state"], "INSUFFICIENT_EVIDENCE")

    def test_missing_entire_baseline_channel_abstains_instead_of_false_support(self):
        baseline_path, _ = ct.generate_demo(self.root)
        baseline_obs = ct.load_csv(baseline_path)
        # A clean copy of two sensors must not conceal a third missing sensor.
        clean_without_oxygen = [
            ct.Observation(
                run_id="candidate_clean",
                replicate_id=o.replicate_id,
                time_s=o.time_s,
                channel=o.channel,
                value=o.value,
                unit=o.unit,
                source=o.source,
                modality=o.modality,
            )
            for o in baseline_obs
            if o.channel != "oxygen_index"
        ]
        candidate_path = self.root / "candidate_without_oxygen.csv"
        ct.write_csv(candidate_path, clean_without_oxygen)
        report = ct.analyze(baseline_path, candidate_path)
        self.assertEqual(report["overall_state"], "INSUFFICIENT_EVIDENCE")
        oxygen = next(x for x in report["channel_assessments"] if x["channel"] == "oxygen_index")
        self.assertEqual(oxygen["state"], "INSUFFICIENT_EVIDENCE")
        self.assertEqual(oxygen["run_n"], 0)
        self.assertIsNone(oxygen["quality_risk_score"])
        self.assertEqual(oxygen["uncertainty"], 1.0)
        self.assertIn("n/a", ct.render_html(report))
        self.assertTrue(ct.verify_report(report))

    def test_nonfinite_value_is_rejected(self):
        p = self.root / "nan.csv"
        p.write_text(
            ",".join(ct.REQUIRED_COLUMNS) + "\n" + "r,x,0,c,nan,u,s,m\n",
            encoding="utf-8",
        )
        with self.assertRaises(ct.ContractError):
            ct.load_csv(p)

    def test_missingness_signal_is_observable(self):
        b, r = ct.generate_demo(self.root)
        report = ct.analyze(b, r)
        missing = [x["metrics"]["missing_fraction"] for x in report["channel_assessments"]]
        self.assertGreater(max(missing), 0.0)

    def test_report_roundtrip_json_verifies(self):
        b, r = ct.generate_demo(self.root)
        report = ct.analyze(b, r)
        encoded = json.dumps(report, sort_keys=True)
        decoded = json.loads(encoded)
        self.assertTrue(ct.verify_report(decoded))

    def test_theil_sen_preserves_late_drift_across_sampling_boundary(self):
        # A centered hinge has slopes paired as s and 1-s under reflection,
        # so its full-trace Theil-Sen median is exactly 0.5. For 159 points,
        # 80 uniformly spaced observations retain this symmetry; taking only
        # the first 80 observations instead hides the entire late drift.
        for count in (79, 80, 159):
            with self.subTest(count=count):
                midpoint = (count - 1) / 2
                points = [(float(i), max(0.0, i - midpoint)) for i in range(count)]
                self.assertAlmostEqual(ct.theil_sen_slope(points), 0.5)


if __name__ == "__main__":
    unittest.main()
