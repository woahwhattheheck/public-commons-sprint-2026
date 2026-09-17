from __future__ import annotations

import contextlib
import copy
import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from repoatlas.cli import main as cli_main
from repoatlas.core import RepoAtlasError, compile_packet, parse_json_bytes, verify_bundle

ROOT = Path(__file__).parents[1]


def fixture():
    return json.loads((ROOT / "fixtures" / "synthetic-repo.json").read_text())


class ProviderAuthorityTests(unittest.TestCase):
    def test_caller_cannot_self_attest_external_provider_state(self):
        for field in (
            "bob_execution_verified",
            "registration_verified",
            "submission_verified",
            "tracks_published",
        ):
            with self.subTest(field=field):
                raw = fixture()
                raw["provider"][field] = True
                with self.assertRaisesRegex(
                    RepoAtlasError, "external_evidence_requires_bound_successor"
                ):
                    compile_packet(raw)

    def test_private_legacy_compiler_surface_is_sealed(self):
        legacy = importlib.import_module("repoatlas._core_source_v1")
        self.assertFalse(hasattr(legacy, "compile_packet"))
        self.assertFalse(hasattr(legacy, "verify_bundle"))

    def test_file_manifest_must_match_modified_postimage(self):
        raw = fixture()
        raw["changes"][0]["after_sha256"] = "c" * 64
        with self.assertRaisesRegex(RepoAtlasError, "file_manifest_sha_mismatch"):
            compile_packet(raw)

    def test_file_manifest_must_match_deleted_preimage(self):
        raw = fixture()
        raw["changes"] = [
            {
                "path": "src/store.py",
                "change": "deleted",
                "before_sha256": "c" * 64,
                "after_sha256": None,
            }
        ]
        with self.assertRaisesRegex(RepoAtlasError, "file_manifest_sha_mismatch"):
            compile_packet(raw)

    def test_file_manifest_must_match_added_postimage(self):
        raw = fixture()
        raw["files"].append(
            {
                "path": "src/new.py",
                "kind": "source",
                "owner": "platform",
                "sha256": "d" * 64,
                "public_api": False,
                "tests": [],
                "module": "new",
            }
        )
        raw["changes"] = [
            {
                "path": "src/new.py",
                "change": "added",
                "before_sha256": None,
                "after_sha256": "e" * 64,
            }
        ]
        with self.assertRaisesRegex(RepoAtlasError, "file_manifest_sha_mismatch"):
            compile_packet(raw)

    def test_surrogate_text_fails_as_repoatlas_error(self):
        raw = fixture()
        raw["repository"] = "bad\ud800repo"
        with self.assertRaisesRegex(RepoAtlasError, "invalid_unicode_scalar"):
            compile_packet(raw)

    def test_deep_json_fails_closed_without_recursion_escape(self):
        data = b"[" * 1500 + b"0" + b"]" * 1500
        with self.assertRaisesRegex(RepoAtlasError, "json_too_deep|invalid_json"):
            parse_json_bytes(data)

    def test_huge_integer_parser_limit_fails_as_repoatlas_error(self):
        data = b'{"n":' + (b"9" * 5000) + b"}"
        with self.assertRaisesRegex(RepoAtlasError, "invalid_json"):
            parse_json_bytes(data)

    def test_huge_integer_cli_fails_closed_without_traceback(self):
        data = b'{"n":' + (b"9" * 5000) + b"}"
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / "input.json"
            packet = root / "packet.json"
            receipt = root / "receipt.json"
            source.write_bytes(data)
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                rc = cli_main(
                    [
                        "compile",
                        "--input",
                        str(source),
                        "--packet",
                        str(packet),
                        "--receipt",
                        str(receipt),
                    ]
                )
            rendered = stdout.getvalue()
            self.assertEqual(rc, 2)
            self.assertIn("ERROR:invalid_json", rendered)
            self.assertNotIn("Traceback", rendered)
            self.assertFalse(packet.exists())
            self.assertFalse(receipt.exists())

    def test_all_false_source_generation_remains_deterministic(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        self.assertEqual(packet["competition_state"], "PROVIDER_GATE_HOLD")
        self.assertTrue(verify_bundle(copy.deepcopy(raw), packet, receipt))
        self.assertFalse(packet["authority"]["competition_submit"])
        self.assertFalse(packet["authority"]["award_or_payment"])


if __name__ == "__main__":
    unittest.main()
