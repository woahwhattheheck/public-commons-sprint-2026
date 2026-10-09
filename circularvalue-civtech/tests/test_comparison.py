"""Focused contracts for option comparison, not a full-project suite."""
import contextlib
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path

from circularvalue.comparison import compare_cases, main, verify_comparison
from circularvalue.comparison_report import render_comparison_html
from circularvalue.core import CircularValueError, digest_json


def source():
    return {
        "schema": "circularvalue.case/v1", "caseId": "synthetic-baseline", "evaluatedOn": "2026-10-09",
        "currency": "GBP", "horizonYears": 1, "discountRateBps": 0, "maxEvidenceAgeDays": 30,
        "oneOffCostMinor": 0, "annualRecurringCostMinor": 0,
        "evidence": [{"id": "e1", "sourceType": "synthetic", "locator": "synthetic://baseline",
                      "sha256": "a" * 64, "observedOn": "2026-10-01", "note": "Synthetic fixture, not company data"}],
        "levers": [{"id": "l1", "label": "Synthetic avoided costs", "category": "direct_cash",
                    "confidence": "modeled", "lowMinor": 100, "centralMinor": 200, "highMinor": 400,
                    "evidenceIds": ["e1"]}],
    }


class ComparisonContracts(unittest.TestCase):
    def test_conservative_envelope_and_common_basis(self):
        baseline, option = source(), source()
        option["caseId"] = "synthetic-option"
        option["levers"][0].update(lowMinor=150, centralMinor=300, highMinor=500)
        option["oneOffCostMinor"] = 20
        result = compare_cases(baseline, option)
        self.assertEqual(result["annualValueDelta"], {"lowMinor": -250, "centralMinor": 100, "highMinor": 400})
        self.assertEqual(result["npvDelta"], {"lowMinor": -270, "centralMinor": 80, "highMinor": 380})
        self.assertEqual(result["npvRangeRelation"], "RANGES_OVERLAP_OR_TOUCH")
        self.assertEqual(result["option"]["quality"]["modeledLeverIds"], ["l1"])
        for field, value in (("currency", "USD"), ("horizonYears", 2), ("discountRateBps", 20), ("evaluatedOn", "2026-10-10")):
            changed = copy.deepcopy(option)
            changed[field] = value
            with self.assertRaisesRegex(CircularValueError, field):
                compare_cases(baseline, changed)

    def test_reused_evidence_identity_and_source_replay(self):
        baseline, option = source(), source()
        option["evidence"][0]["sha256"] = "b" * 64
        option["evidence"][0]["observedOn"] = "2026-01-01"
        result = compare_cases(baseline, option)
        self.assertEqual(result["evidenceChanges"][0]["change"], "modified")
        self.assertEqual(result["leverChanges"][0]["change"], "evidence_only")
        self.assertEqual(result["leverChanges"][0]["changedEvidenceIds"], ["e1"])
        self.assertEqual(result["option"]["quality"]["staleEvidenceIds"], ["e1"])
        self.assertTrue(verify_comparison(baseline, option, result))
        tampered = copy.deepcopy(result)
        tampered["npvDelta"]["centralMinor"] += 1
        tampered["comparisonSha256"] = digest_json({k: v for k, v in tampered.items() if k != "comparisonSha256"})
        self.assertFalse(verify_comparison(baseline, option, tampered))
        self.assertFalse(verify_comparison(baseline, baseline, result))

    def test_html_cli_and_create_only_output(self):
        baseline, option = source(), source()
        option["caseId"] = "synthetic-<script>alert(1)</script>"
        option["levers"][0]["label"] = '<img src=x onerror="alert(1)">'
        html = render_comparison_html(baseline, option)
        self.assertNotIn("<script>", html)
        self.assertNotIn("<img", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("Needs expert review", html)
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            root = Path(directory)
            before, after, out = root / "baseline.json", root / "option.json", root / "comparison.json"
            before.write_text(json.dumps(baseline), encoding="utf-8")
            after.write_text(json.dumps(option), encoding="utf-8")
            self.assertEqual(main(["compile", str(before), str(after), "--out", str(out)]), 0)
            original = out.read_bytes()
            self.assertEqual(main(["verify", str(before), str(after), str(out)]), 0)
            self.assertEqual(main(["compile", str(before), str(after), "--out", str(out)]), 2)
            self.assertEqual(out.read_bytes(), original)
            report = root / "comparison.html"
            self.assertEqual(main(["report", str(before), str(after), "--out", str(report)]), 0)
            self.assertEqual(report.read_text(encoding="utf-8"), html)
            link = root / "case-link.json"
            link.symlink_to(before)
            self.assertEqual(main(["compile", str(link), str(after), "--out", str(root / "absent.json")]), 2)
            self.assertFalse((root / "absent.json").exists())


if __name__ == "__main__":
    unittest.main()
