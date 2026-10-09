#!/usr/bin/env python3
"""One synthetic-only report contract check; zero real model/network calls."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import app
from report import inspect_workspace, fp


class ReportFocused(unittest.TestCase):
    def test_local_receipt_chain_redaction_and_alias_gate(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            app, "DB", Path(tmp) / "workspace.json"
        ), patch.object(app, "call_apertus", return_value="Confidential fictional answer"):
            def new_case(locale, human=False):
                item = app.submit_case({
                    "locale": locale, "prompt": "Sensitive fictional prompt",
                    "context": "Private fictional context",
                    "source_kind": "consented_person" if human else "synthetic",
                    "attribution": "Private author alias", "human_attested": human,
                })
                app.approve_case({"id": item["id"], "reference": "Fictional reference",
                                  "reviewer": "Alice"})
                run = app.generate({"id": item["id"]})
                app.review_run({"id": item["id"], "run_id": run["id"],
                                "reviewer": "Bob", "notes": "Private synthetic feedback",
                                "scores": {key: 4 for key in app.RUBRIC}})
            new_case("de-CH")
            new_case("fr-CH", True)
            raw = app.load()
            report = inspect_workspace(raw)
            self.assertEqual(report["official_submission_status"], "NOT_VERIFIED")
            self.assertEqual(report["totals"]["reviewed_runs"], 2)
            self.assertEqual(report["source_kind_counts"]["consented_person"], 1)
            self.assertEqual(report["data_status"],
                             "NON_SYNTHETIC_REVIEWED_RECORDS_UNVERIFIED")
            self.assertTrue(all(v["suppressed"] for v in report["locale_counts"].values()))
            rendered = json.dumps(report)
            for secret in ("Sensitive fictional prompt", "Confidential fictional answer",
                           "Private author alias", "Alice", "Bob",
                           "Fictional reference", "Private synthetic feedback"):
                self.assertNotIn(secret, rendered)
            mutated = copy.deepcopy(raw)
            mutated["cases"][0]["runs"][0]["reviews"][0]["notes"] = "changed"
            with self.assertRaisesRegex(ValueError, "review hash mismatch"):
                inspect_workspace(mutated)
            mutated = copy.deepcopy(raw)
            dup = copy.deepcopy(mutated["cases"][0]["runs"][0]["reviews"][0])
            dup["reviewer"] = "BOB"
            dup["sha256"] = fp({key: dup[key] for key in
                                 ("reviewer", "scores", "notes", "answer_sha256")})
            mutated["cases"][0]["runs"][0]["reviews"].append(dup)
            with self.assertRaisesRegex(ValueError, "duplicate/nonindependent"):
                inspect_workspace(mutated)


if __name__ == "__main__":
    unittest.main()
