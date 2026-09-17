from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from repoatlas.core import RepoAtlasError, compile_packet, verify_bundle

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

    def test_all_false_source_generation_remains_deterministic(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        self.assertEqual(packet["competition_state"], "PROVIDER_GATE_HOLD")
        self.assertTrue(verify_bundle(copy.deepcopy(raw), packet, receipt))
        self.assertFalse(packet["authority"]["competition_submit"])
        self.assertFalse(packet["authority"]["award_or_payment"])


if __name__ == "__main__":
    unittest.main()
