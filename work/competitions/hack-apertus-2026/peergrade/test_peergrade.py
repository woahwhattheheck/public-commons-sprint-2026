#!/usr/bin/env python3
"""Focused contract checks; intentionally does not call an external model."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from peergrade import InputError, assignment_contract, read_json, run, validate_prediction, main

ROOT = Path(__file__).parent
TASK = read_json(ROOT / "examples" / "assignment.json")
GOOD = read_json(ROOT / "examples" / "synthetic_model_response.json")["prediction"]


class PeerGradeContract(unittest.TestCase):
    def test_verified_synthetic_feedback_and_digests(self):
        task = assignment_contract(TASK)
        report = run(task, GOOD, "synthetic_fixture", "example")
        self.assertEqual(report["status"], "requires_human_review")
        self.assertEqual(report["proposed_total"], 8)
        self.assertIsNone(report["final_grade"])
        with tempfile.TemporaryDirectory() as t:
            target = Path(t) / "report.json"
            target.write_text(json.dumps(report), encoding="utf-8")
            self.assertEqual(main(["verify", "--assignment", str(ROOT / "examples" / "assignment.json"), "--report", str(target)]), 0)

    def test_hallucinated_quote_fails_closed(self):
        altered = copy.deepcopy(GOOD)
        altered["criteria"][0]["evidence"] = ["This quotation is not in the submission"]
        with self.assertRaises(InputError):
            validate_prediction(assignment_contract(TASK), altered)
        self.assertEqual(run(TASK, altered, "synthetic_fixture", "x")["status"], "invalid_model_output")

    def test_extra_duplicate_and_out_of_range_rejected(self):
        for edit in ("duplicate", "extra", "range"):
            altered = copy.deepcopy(GOOD)
            if edit == "duplicate":
                altered["criteria"][1]["id"] = altered["criteria"][0]["id"]
            elif edit == "extra":
                altered["criteria"].append(copy.deepcopy(altered["criteria"][0]))
            else:
                altered["criteria"][1]["proposed_points"] = 99
            with self.subTest(edit=edit), self.assertRaises(InputError):
                validate_prediction(assignment_contract(TASK), altered)

    def test_no_positive_points_without_evidence(self):
        altered = copy.deepcopy(GOOD)
        altered["criteria"][1]["evidence"] = []
        with self.assertRaises(InputError):
            validate_prediction(assignment_contract(TASK), altered)

    def test_invalid_assignment_and_bool_points_rejected(self):
        t = copy.deepcopy(TASK)
        t["rubric"][1]["id"] = t["rubric"][0]["id"]
        with self.assertRaises(InputError):
            assignment_contract(t)
        altered = copy.deepcopy(GOOD)
        altered["criteria"][1]["proposed_points"] = True
        with self.assertRaises(InputError):
            validate_prediction(assignment_contract(TASK), altered)


if __name__ == "__main__":
    unittest.main()
