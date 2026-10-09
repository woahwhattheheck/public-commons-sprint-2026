"""Five focused offline checks for ChipTrace raw-input receipt matching."""
from __future__ import annotations
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from verify_sources import VerificationError, main, verify_sources


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


class RawInputReceiptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.baseline = self.root / "baseline.csv"
        self.run = self.root / "candidate.csv"
        self.report = self.root / "report.json"
        self.baseline.write_bytes(b"run_id,replicate_id,time_s,channel,value,unit,source,modality\nbase,1,0,a,1,u,s,m\n")
        self.run.write_bytes(b"run_id,replicate_id,time_s,channel,value,unit,source,modality\nrun,1,0,a,1,u,s,m\n")
        body = {"schema": "chiptrace.report.v1", "overall_state": "SUPPORTED",
                "inputs": {"baseline_file": "untrusted-do-not-open.csv", "run_file": "also-not-a-path.csv",
                           "baseline_sha256": sha(self.baseline.read_bytes()),
                           "run_sha256": sha(self.run.read_bytes())}}
        receipt = sha(json.dumps(body, sort_keys=True, separators=(",", ":"),
                                 ensure_ascii=False).encode("utf-8"))
        body["receipt_sha256"] = receipt
        self.report.write_text(json.dumps(body), encoding="utf-8")

    def test_original_bytes_match(self):
        self.assertEqual(verify_sources(self.report, self.baseline, self.run),
                         {"status": "PASS", "report_receipt_valid": True,
                          "baseline_bytes_match": True, "run_bytes_match": True})

    def test_changed_csv_does_not_pass_unchanged_report(self):
        self.run.write_bytes(self.run.read_bytes() + b"\n")
        r = verify_sources(self.report, self.baseline, self.run)
        self.assertEqual(r["status"], "FAIL")
        self.assertTrue(r["baseline_bytes_match"])
        self.assertFalse(r["run_bytes_match"])

    def test_swapped_inputs_fail_both_matches(self):
        r = verify_sources(self.report, self.run, self.baseline)
        self.assertEqual(r["status"], "FAIL")
        self.assertFalse(r["baseline_bytes_match"])
        self.assertFalse(r["run_bytes_match"])

    def test_edited_report_refused_before_opening_sources(self):
        doc = json.loads(self.report.read_text())
        doc["overall_state"] = "REVIEW"
        self.report.write_text(json.dumps(doc))
        with self.assertRaisesRegex(VerificationError, "canonical receipt"):
            verify_sources(self.report, self.root / "not-present.csv", self.root / "not-present2.csv")

    def test_missing_source_cli_returns_failed_receipt(self):
        self.assertEqual(main([str(self.report), "--baseline", str(self.baseline),
                               "--run", str(self.root / "missing.csv")]), 2)


if __name__ == "__main__":
    unittest.main()
