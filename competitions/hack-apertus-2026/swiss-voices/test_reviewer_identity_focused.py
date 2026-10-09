#!/usr/bin/env python3
"""Focused synthetic-only Swiss Voices reviewer-alias integrity regression.

No model credentials, live inference, personal data, contest submission or web calls.
"""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import app


class ReviewerIdentityFocused(unittest.TestCase):
    def test_reviewer_alias_independence_and_duplicate_gate(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            app, "DB", Path(directory) / "synthetic-workspace.json"
        ), patch.object(app, "call_apertus", return_value="synthetic response") as provider:
            item = app.submit_case({
                "locale": "de-CH", "source_kind": "synthetic", "prompt": "synthetic question",
                "context": "offline fixture", "attribution": "synthetic author",
                "human_attested": False,
            })
            app.approve_case({
                "id": item["id"], "reference": "synthetic reference", "reviewer": "Alice"
            })
            run = app.generate({"id": item["id"]})
            provider.assert_called_once()
            request = {
                "id": item["id"], "run_id": run["id"],
                "scores": {rubric: 4 for rubric in app.RUBRIC},
                "notes": "Synthetic reviewer rationale",
            }
            for alias in ("ALICE", "Ａｌｉｃｅ", "aLiCe"):
                with self.subTest(approver_alias=alias), self.assertRaisesRegex(
                    ValueError, "independent reviewer"
                ):
                    app.review_run({**request, "reviewer": alias})
            first = app.review_run({**request, "reviewer": "Bob"})
            self.assertEqual(first["reviewer"], "Bob")
            for alias in ("BOB", "Ｂｏｂ", "bOb"):
                with self.subTest(reviewer_alias=alias), self.assertRaisesRegex(
                    ValueError, "already scored"
                ):
                    app.review_run({**request, "reviewer": alias})
            second = app.review_run({**request, "reviewer": "Carol"})
            self.assertEqual(second["reviewer"], "Carol")
            recorded = app.load()["cases"][0]["runs"][0]["reviews"]
            self.assertEqual([r["reviewer"] for r in recorded], ["Bob", "Carol"])
            self.assertEqual(len({r["sha256"] for r in recorded}), 2)
            self.assertEqual(app.load()["cases"][0]["approved_by"], "Alice")


if __name__ == "__main__":
    unittest.main()
