from __future__ import annotations

import copy
import json
import unittest
from unittest import mock

from evidenceforge import core
from evidenceforge.core import EvidenceError, MemorySandbox, compile_change, verify_receipt
from evidenceforge import provider


def request(**overrides):
    value = {
        "request_id": "chg-001",
        "goal": "Harden parser and run declared tests.",
        "allowed_paths": ["src/parser.py"],
        "required_tests": ["unit"],
        "max_writes": 1,
    }
    value.update(overrides)
    return value


def plan(**overrides):
    value = {
        "summary": "Patch parser and test it.",
        "operations": [
            {"kind": "read", "path": "src/parser.py"},
            {"kind": "write", "path": "src/parser.py", "content": "SAFE = True\n"},
            {"kind": "test", "name": "unit"},
        ],
    }
    value.update(overrides)
    return value


def run(req=None, pl=None, tests=None):
    sb = MemorySandbox(
        files={"src/parser.py": "SAFE = False\n"},
        tests=tests or {"unit": (0, "1 passed\n")},
    )
    return compile_change(
        json.dumps(req or request()),
        json.dumps(pl or plan()),
        sb,
        provider_evidence={"provider": "offline-replay"},
    )


class EvidenceForgeTests(unittest.TestCase):
    def test_full_flow_green_and_verifies(self):
        receipt = run()
        self.assertTrue(receipt["required_tests_green"])
        self.assertTrue(verify_receipt(receipt))
        self.assertFalse(receipt["authority"]["real_repository_mutation"])
        self.assertTrue(receipt["authority"]["human_approval_required"])

    def test_failed_test_is_evidence_not_approval(self):
        receipt = run(tests={"unit": (1, "boom")})
        self.assertFalse(receipt["required_tests_green"])
        self.assertTrue(verify_receipt(receipt))
        self.assertFalse(receipt["authority"]["real_repository_mutation"])

    def test_duplicate_request_key_rejected(self):
        raw = '{"request_id":"a","request_id":"b","goal":"g","allowed_paths":["x"],"required_tests":[],"max_writes":0}'
        with self.assertRaisesRegex(EvidenceError, "duplicate"):
            compile_change(raw, json.dumps({"summary":"s","operations":[]}), MemorySandbox())

    def test_nonfinite_rejected(self):
        with self.assertRaises(EvidenceError):
            core.strict_json_loads('{"x":NaN}')

    def test_path_traversal_request_rejected(self):
        with self.assertRaisesRegex(EvidenceError, "escapes"):
            run(req=request(allowed_paths=["../secret"]))

    def test_non_normalized_path_rejected(self):
        with self.assertRaises(EvidenceError):
            run(req=request(allowed_paths=["src/../secret"]))

    def test_write_outside_allowlist_rejected(self):
        bad = plan(operations=[
            {"kind":"write","path":"README.md","content":"oops"},
            {"kind":"test","name":"unit"},
        ])
        with self.assertRaisesRegex(EvidenceError, "outside allowed_paths"):
            run(pl=bad)

    def test_undeclared_test_rejected(self):
        bad = plan(operations=[{"kind":"test","name":"shell:anything"}])
        with self.assertRaisesRegex(EvidenceError, "outside required_tests"):
            run(pl=bad)

    def test_required_test_cannot_be_omitted(self):
        bad = plan(operations=[{"kind":"read","path":"src/parser.py"}])
        with self.assertRaisesRegex(EvidenceError, "every required test"):
            run(pl=bad)

    def test_required_test_cannot_be_reordered(self):
        req = request(required_tests=["lint", "unit"], max_writes=0)
        bad = {"summary":"s","operations":[
            {"kind":"test","name":"unit"},
            {"kind":"test","name":"lint"},
        ]}
        sb = MemorySandbox(tests={"unit":(0,""),"lint":(0,"")})
        with self.assertRaisesRegex(EvidenceError, "human-declared order"):
            compile_change(json.dumps(req), json.dumps(bad), sb)

    def test_max_writes_enforced(self):
        req = request(max_writes=0)
        with self.assertRaisesRegex(EvidenceError, "max_writes"):
            run(req=req)

    def test_unknown_operation_rejected(self):
        bad = plan(operations=[{"kind":"deploy","target":"prod"}])
        with self.assertRaisesRegex(EvidenceError, "unsupported"):
            run(pl=bad)

    def test_extra_authority_field_rejected_in_plan(self):
        bad = {"summary":"s","operations":[{"kind":"test","name":"unit"}],"approved":True}
        with self.assertRaisesRegex(EvidenceError, "keys mismatch"):
            run(pl=bad)

    def test_receipt_tamper_detected(self):
        receipt = run()
        tampered = copy.deepcopy(receipt)
        tampered["events"][0]["content_sha256"] = "0" * 64
        self.assertFalse(verify_receipt(tampered))

    def test_authority_tamper_detected_even_with_rehashed_receipt(self):
        receipt = run()
        tampered = copy.deepcopy(receipt)
        tampered["authority"]["real_repository_mutation"] = True
        body = dict(tampered)
        body.pop("receipt_sha256")
        tampered["receipt_sha256"] = core.sha256_hex(core.canonical_bytes(body))
        self.assertFalse(verify_receipt(tampered))

    def test_request_tamper_detected_even_with_rehashed_receipt(self):
        receipt = run()
        tampered = copy.deepcopy(receipt)
        tampered["request"]["allowed_paths"].append("prod.txt")
        body = dict(tampered)
        body.pop("receipt_sha256")
        tampered["receipt_sha256"] = core.sha256_hex(core.canonical_bytes(body))
        self.assertFalse(verify_receipt(tampered))

    def test_deterministic_receipt(self):
        self.assertEqual(run()["receipt_sha256"], run()["receipt_sha256"])

    def test_memory_sandbox_never_executes_shell(self):
        sb = MemorySandbox(tests={"pytest": (0, "synthetic")})
        self.assertEqual(sb.run_test("pytest"), (0, "synthetic"))
        with self.assertRaises(EvidenceError):
            sb.run_test("rm -rf /")

    def test_provider_requires_nvidia_model_in_live_inventory(self):
        payload = {"data":[{"id":"nvidia/current-nemotron","object":"model"}]}
        self.assertTrue(provider._nvidia_model_present(payload, "nvidia/current-nemotron"))
        with self.assertRaises(EvidenceError):
            provider._nvidia_model_present(payload, "other/model")

    def test_provider_missing_model_is_rejected(self):
        payload = {"data":[{"id":"nvidia/current-nemotron"}]}
        with self.assertRaisesRegex(EvidenceError, "not in live"):
            provider._nvidia_model_present(payload, "nvidia/missing")

    def test_provider_mode_requires_credentials(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(EvidenceError, "NEBIUS_API_KEY"):
                provider.generate_plan(json.dumps(request()))

    def test_provider_mode_requires_explicit_current_model(self):
        with mock.patch.dict("os.environ", {"NEBIUS_API_KEY":"x"}, clear=True):
            with self.assertRaisesRegex(EvidenceError, "NEBIUS_MODEL"):
                provider.generate_plan(json.dumps(request()))


if __name__ == "__main__":
    unittest.main()
