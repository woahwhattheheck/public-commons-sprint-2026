from __future__ import annotations

import json
import unittest
from pathlib import Path

from repoatlas.core import (
    MAX_CHANGES,
    MAX_DOC_ROWS,
    MAX_ROW_REFS,
    RepoAtlasError,
    compile_packet,
    verify_bundle,
)

ROOT = Path(__file__).parents[1]


def fixture():
    return json.loads((ROOT / "fixtures" / "synthetic-repo.json").read_text())


def deleted_change(index: int) -> dict:
    return {
        "path": f"retired/path-{index:05d}.py",
        "change": "deleted",
        "before_sha256": "a" * 64,
        "after_sha256": None,
    }


def doc_row(prefix: str, index: int) -> dict:
    return {
        "id": f"{prefix}-{index:05d}",
        "covers": [],
        "sha256": "b" * 64,
    }


class ObjectModeCardinalityTests(unittest.TestCase):
    def test_every_repeated_structure_accepts_exact_limit(self):
        raw = fixture()
        raw["changes"] = [deleted_change(i) for i in range(MAX_CHANGES)]
        raw["adrs"] = [doc_row("ADR", i) for i in range(MAX_DOC_ROWS)]
        raw["runbooks"] = [doc_row("RUN", i) for i in range(MAX_DOC_ROWS)]
        raw["files"][0]["tests"] = ["tests/test_api.py"] * MAX_ROW_REFS
        raw["adrs"][0]["covers"] = ["src/api.py"] * MAX_ROW_REFS
        raw["runbooks"][0]["covers"] = ["src/api.py"] * MAX_ROW_REFS

        packet, receipt = compile_packet(raw)
        self.assertTrue(verify_bundle(raw, packet, receipt))
        self.assertEqual(len(raw["changes"]), MAX_CHANGES)
        self.assertEqual(len(raw["adrs"]), MAX_DOC_ROWS)
        self.assertEqual(len(raw["runbooks"]), MAX_DOC_ROWS)

    def test_top_level_repeated_structures_reject_over_limit_before_row_walk(self):
        cases = (
            ("changes", MAX_CHANGES, "changes:cardinality"),
            ("adrs", MAX_DOC_ROWS, "adrs:cardinality"),
            ("runbooks", MAX_DOC_ROWS, "runbooks:cardinality"),
        )
        for field, limit, error in cases:
            with self.subTest(field=field):
                raw = fixture()
                # Invalid row payloads are deliberate: the cardinality fence must
                # fire before any expensive or semantic per-row traversal.
                raw[field] = [None] * (limit + 1)
                with self.assertRaisesRegex(RepoAtlasError, error):
                    compile_packet(raw)

    def test_file_test_refs_reject_over_limit_before_reference_walk(self):
        raw = fixture()
        raw["files"][0]["tests"] = ["tests/test_api.py"] * (MAX_ROW_REFS + 1)
        with self.assertRaisesRegex(RepoAtlasError, r"files\[0\]\.tests:cardinality"):
            compile_packet(raw)

    def test_document_covers_reject_over_limit_before_reference_walk(self):
        for field in ("adrs", "runbooks"):
            with self.subTest(field=field):
                raw = fixture()
                raw[field] = [
                    {
                        "id": "BOUNDARY-DOC",
                        "covers": ["src/api.py"] * (MAX_ROW_REFS + 1),
                        "sha256": "c" * 64,
                    }
                ]
                with self.assertRaisesRegex(
                    RepoAtlasError,
                    rf"{field}\[0\]\.covers:cardinality",
                ):
                    compile_packet(raw)


if __name__ == "__main__":
    unittest.main()
