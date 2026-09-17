from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from repoatlas.core import MAX_JSON_DEPTH, RepoAtlasError, compile_packet, verify_bundle

ROOT = Path(__file__).parents[1]


def fixture():
    return json.loads((ROOT / "fixtures" / "synthetic-repo.json").read_text())


def canonical_size(value):
    return len(
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8", "strict")
    )


def deeply_nested_array():
    value = False
    for _ in range(MAX_JSON_DEPTH + 1):
        value = [value]
    return value


class RepoAtlasArtifactIdentityTests(unittest.TestCase):
    def test_packet_bool_int_alias_is_not_the_same_artifact(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        aliased_packet = copy.deepcopy(packet)
        self.assertIs(aliased_packet["authority"]["auto_merge"], False)
        aliased_packet["authority"]["auto_merge"] = 0
        self.assertEqual(aliased_packet, packet)  # proves the Python-equality predecessor
        with self.assertRaisesRegex(RepoAtlasError, "verify:packet_mismatch"):
            verify_bundle(raw, aliased_packet, receipt)

    def test_receipt_bool_int_alias_is_not_the_same_artifact(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        aliased_receipt = copy.deepcopy(receipt)
        self.assertIs(aliased_receipt["authority_external_action"], False)
        aliased_receipt["authority_external_action"] = 0
        self.assertEqual(aliased_receipt, receipt)  # proves the Python-equality predecessor
        with self.assertRaisesRegex(RepoAtlasError, "verify:receipt_mismatch"):
            verify_bundle(raw, packet, aliased_receipt)

    def test_deep_packet_is_stable_fail_closed_not_raw_recursion(self):
        raw = fixture()
        _, receipt = compile_packet(raw)
        with self.assertRaisesRegex(RepoAtlasError, "verify:packet_too_deep"):
            verify_bundle(raw, deeply_nested_array(), receipt)

    def test_deep_receipt_is_stable_fail_closed_not_raw_recursion(self):
        raw = fixture()
        packet, _ = compile_packet(raw)
        with self.assertRaisesRegex(RepoAtlasError, "verify:receipt_too_deep"):
            verify_bundle(raw, packet, deeply_nested_array())

    def test_over_budget_scalar_fails_before_candidate_serialization(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        expected_bytes = canonical_size(packet)
        oversized_packet = {"x": "A" * (expected_bytes + 1)}
        with self.assertRaisesRegex(RepoAtlasError, "verify:packet_too_complex"):
            verify_bundle(raw, oversized_packet, receipt)

    def test_shared_scalar_alias_amplification_is_charged_per_occurrence(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        expected_bytes = canonical_size(packet)
        shared = "A" * 1024
        repeats = max(2, expected_bytes // len(shared) + 2)
        amplified_packet = {"x": [shared] * repeats}
        self.assertIs(amplified_packet["x"][0], amplified_packet["x"][1])
        self.assertGreater(canonical_size(amplified_packet), expected_bytes)
        with self.assertRaisesRegex(RepoAtlasError, "verify:packet_too_complex"):
            verify_bundle(raw, amplified_packet, receipt)


if __name__ == "__main__":
    unittest.main()