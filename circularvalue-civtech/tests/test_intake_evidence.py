"""Focused integration checks; all inputs are synthetic and all I/O is local."""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from circularvalue.core import CircularValueError, SCHEMA, compile_case, verify_packet
from circularvalue.evidence_check import audit_evidence
from circularvalue.intake import export_tables, import_tables, read_text, write_new


def sample_case() -> dict:
    return {
        "schema": SCHEMA, "caseId": "synthetic-csv-intake", "evaluatedOn": "2026-10-09",
        "currency": "JPY", "horizonYears": 3, "discountRateBps": 500,
        "maxEvidenceAgeDays": 365, "oneOffCostMinor": 500, "annualRecurringCostMinor": 20,
        "evidence": [
            {"id": "ev,; café", "sourceType": "synthetic", "locator": "synthetic://baseline",
             "sha256": hashlib.sha256(b"synthetic baseline\n").hexdigest(), "observedOn": "2026-10-01",
             "note": "=formula-like text, not an executable formula"},
            {"id": "ev-second", "sourceType": "synthetic", "locator": "synthetic://second",
             "sha256": hashlib.sha256(b"synthetic second\n").hexdigest(), "observedOn": "2024-01-01",
             "note": "'quoted\nmultiline synthetic evidence"},
        ],
        "levers": [
            {"id": "lever-1", "label": "@Keep literal", "category": "direct_cash", "confidence": "observed",
             "lowMinor": -100, "centralMinor": 500, "highMinor": 1000, "evidenceIds": ["ev,; café"]},
            {"id": "lever-2", "label": "Retention estimate", "category": "customer_retention", "confidence": "hypothesis",
             "lowMinor": 0, "centralMinor": 100, "highMinor": 500, "evidenceIds": ["ev-second", "ev,; café"]},
        ],
    }


class IntakeEvidenceTests(unittest.TestCase):
    def test_csv_roundtrip_preserves_compiler_packet_and_literal_text(self):
        case = sample_case()
        tables = export_tables(case)
        imported = import_tables(tables["case.csv"], tables["evidence.csv"], tables["levers.csv"])
        self.assertEqual(case, imported)
        self.assertEqual(tables, export_tables(imported))
        self.assertTrue(verify_packet(imported, compile_case(case)))
        self.assertEqual(compile_case(imported)["quality"]["hypothesisLeverIds"], ["lever-2"])
        self.assertIn("'=formula", tables["evidence.csv"])
        self.assertIn("'@Keep", tables["levers.csv"])
        self.assertEqual(imported["currency"], "JPY")

    def test_malformed_tables_and_lossy_numbers_fail_without_coercion(self):
        tables = export_tables(sample_case())
        original = [tables[name] for name in ("case.csv", "evidence.csv", "levers.csv")]
        mutations = []
        bad = original.copy(); bad[0] = bad[0].replace("schema,caseId", "schema,schema"); mutations.append(bad)
        bad = original.copy(); bad[0] = bad[0].rstrip("\n") + ",extra\n"; mutations.append(bad)
        bad = original.copy(); bad[0] = bad[0].replace(",3,500,", ",3,5e2,"); mutations.append(bad)
        bad = original.copy(); bad[0] = bad[0].replace(",3,500,", ",３,500,"); mutations.append(bad)
        bad = original.copy(); bad[1] = bad[1].replace("ev-second", "ev-absent"); mutations.append(bad)
        bad = original.copy(); bad[2] += '"unterminated'; mutations.append(bad)
        for inputs in mutations:
            with self.subTest(table=inputs):
                with self.assertRaises(CircularValueError):
                    import_tables(*inputs)

    def test_evidence_match_mismatch_missing_and_unmapped_are_distinct(self):
        case = sample_case()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "baseline.txt").write_bytes(b"synthetic baseline\n")
            (root / "second.txt").write_bytes(b"synthetic second\n")
            mapping = {"ev,; café": "baseline.txt", "ev-second": "second.txt"}
            report = audit_evidence(case, root, mapping)
            self.assertTrue(report["allMatched"])
            self.assertFalse(report["sourceAuthenticated"])
            self.assertEqual(report, audit_evidence(case, root, mapping))
            (root / "second.txt").write_bytes(b"changed")
            report = audit_evidence(case, root, mapping)
            self.assertFalse(report["allMatched"])
            self.assertEqual(report["results"][1]["status"], "mismatch")
            (root / "second.txt").unlink()
            self.assertEqual(audit_evidence(case, root, mapping)["results"][1]["status"], "missing")
            del mapping["ev-second"]
            self.assertEqual(audit_evidence(case, root, mapping)["results"][1]["status"], "unmapped")
            with self.assertRaises(CircularValueError):
                audit_evidence(case, root, {"not-an-evidence-id": "baseline.txt"})

    def test_evidence_traversal_symlinks_and_nonregular_files_are_not_read(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "evidence"; root.mkdir()
            (Path(directory) / "outside").write_bytes(b"synthetic baseline\n")
            (root / "link").symlink_to(Path(directory) / "outside")
            (root / "dirlink").symlink_to(Path(directory), target_is_directory=True)
            (root / "folder").mkdir()
            paths = ["../outside", str(Path(directory) / "outside"), "link", "dirlink/outside", "folder", "./file", "a//b"]
            for path in paths:
                with self.subTest(path=path):
                    report = audit_evidence(sample_case(), root, {"ev,; café": path})
                    self.assertEqual(report["results"][0]["status"], "unsafe_or_unreadable")
                    self.assertIsNone(report["results"][0]["actualSha256"])

    def test_create_only_outputs_and_symlink_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "case.json"
            write_new(path, "preserve")
            with self.assertRaises(FileExistsError):
                write_new(path, "overwrite")
            self.assertEqual(path.read_text(), "preserve")
            link = Path(directory) / "linked.json"; link.symlink_to(path)
            with self.assertRaises(CircularValueError):
                read_text(link)

    def test_real_cli_export_import_and_evidence_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.json"; source.write_text(json.dumps(sample_case()))
            commands = [
                ["circularvalue.intake", "export", str(source), "--out-dir", str(root / "tables")],
                ["circularvalue.intake", "import", str(root / "tables"), "--out", str(root / "case.json")],
            ]
            for args in commands:
                result = subprocess.run([sys.executable, "-m", *args], capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
            rebuilt = json.loads((root / "case.json").read_text())
            self.assertEqual(rebuilt, sample_case())
            (root / "baseline.txt").write_bytes(b"synthetic baseline\n")
            (root / "mapping.json").write_text(json.dumps({"ev,; café": "baseline.txt"}))
            args = [sys.executable, "-m", "circularvalue.evidence_check", str(root / "case.json"),
                    str(root / "mapping.json"), "--root", str(root), "--out", str(root / "audit.json")]
            result = subprocess.run(args, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn("MATCHED 1/2", result.stdout)
            self.assertFalse(json.loads((root / "audit.json").read_text())["allMatched"])


if __name__ == "__main__":
    unittest.main()
