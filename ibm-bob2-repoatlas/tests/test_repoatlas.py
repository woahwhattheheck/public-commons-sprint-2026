from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from repoatlas.core import RepoAtlasError, compile_packet, parse_json_bytes, verify_bundle

ROOT = Path(__file__).parents[1]


def fixture():
    return json.loads((ROOT / "fixtures" / "synthetic-repo.json").read_text())


class RepoAtlasTests(unittest.TestCase):
    def test_demo_is_deterministic_and_bounded(self):
        raw = fixture()
        a = compile_packet(raw)
        b = compile_packet(copy.deepcopy(raw))
        self.assertEqual(a, b)
        packet, receipt = a
        self.assertEqual(packet["state"], "HOLD_EVIDENCE_GAPS")
        self.assertEqual(packet["competition_state"], "PROVIDER_GATE_HOLD")
        self.assertFalse(packet["authority"]["auto_merge"])
        self.assertFalse(packet["authority"]["competition_submit"])
        self.assertTrue(verify_bundle(raw, packet, receipt))

    def test_detects_unowned_untested_changed_source(self):
        packet, _ = compile_packet(fixture())
        codes = {(x["path"], x["code"]) for x in packet["findings"]}
        self.assertIn(("src/worker.py", "OWNERSHIP_GAP"), codes)
        self.assertIn(("src/worker.py", "NO_TEST_EVIDENCE"), codes)

    def test_public_api_adr_coverage_removes_high_finding(self):
        packet, _ = compile_packet(fixture())
        self.assertNotIn(("src/api.py", "PUBLIC_API_WITHOUT_ADR_COVERAGE"), {(x["path"], x["code"]) for x in packet["findings"]})

    def test_provider_flags_require_bound_successor(self):
        raw = fixture()
        raw["provider"] = {"bob_execution_verified": True, "registration_verified": True, "submission_verified": True, "tracks_published": True}
        with self.assertRaisesRegex(RepoAtlasError, "external_evidence_requires_bound_successor"):
            compile_packet(raw)

    def test_unknown_fields_fail_closed(self):
        raw = fixture()
        # Preserve the strict root mapping cardinality while replacing one
        # admitted field, so this predecessor reaches unknown-field semantics
        # instead of intentionally tripping the earlier cardinality fence.
        raw["surprise"] = raw.pop("runbooks")
        with self.assertRaisesRegex(RepoAtlasError, "unknown_fields"):
            compile_packet(raw)

    def test_duplicate_json_keys_fail_closed(self):
        data = b'{"schema":"repoatlas-input/v1","schema":"x"}'
        with self.assertRaisesRegex(RepoAtlasError, "duplicate_key:schema"):
            parse_json_bytes(data)

    def test_path_traversal_fails_closed(self):
        raw = fixture()
        raw["files"][0]["path"] = "../secret"
        with self.assertRaisesRegex(RepoAtlasError, "unsafe_path"):
            compile_packet(raw)

    def test_dependency_unknown_path_fails(self):
        raw = fixture()
        raw["dependencies"].append({"from":"src/api.py","to":"src/missing.py","kind":"import"})
        with self.assertRaisesRegex(RepoAtlasError, "unknown_path"):
            compile_packet(raw)

    def test_change_noop_fails(self):
        raw = fixture()
        raw["changes"][0]["before_sha256"] = raw["changes"][0]["after_sha256"]
        with self.assertRaisesRegex(RepoAtlasError, "no_op"):
            compile_packet(raw)

    def test_packet_tamper_fails(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        packet = copy.deepcopy(packet)
        packet["state"] = "READY_FOR_HUMAN_REVIEW"
        with self.assertRaisesRegex(RepoAtlasError, "packet_mismatch"):
            verify_bundle(raw, packet, receipt)

    def test_receipt_tamper_fails(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        receipt = copy.deepcopy(receipt)
        receipt["authority_external_action"] = True
        with self.assertRaisesRegex(RepoAtlasError, "receipt_mismatch"):
            verify_bundle(raw, packet, receipt)

    def test_deleted_path_with_dependents_high(self):
        raw = fixture()
        raw["changes"] = [{"path":"src/store.py","change":"deleted","before_sha256":raw["files"][1]["sha256"],"after_sha256":None}]
        packet, _ = compile_packet(raw)
        self.assertIn(("src/store.py", "DELETED_WITH_DEPENDENTS"), {(x["path"], x["code"]) for x in packet["findings"]})

    def test_finding_order_is_stable(self):
        packet, _ = compile_packet(fixture())
        ranks = {"CRITICAL":0,"HIGH":1,"MEDIUM":2,"LOW":3,"INFO":4}
        keys = [(ranks[x["risk"]], x["path"], x["code"], x["detail"]) for x in packet["findings"]]
        self.assertEqual(keys, sorted(keys))


if __name__ == "__main__":
    unittest.main()
