from __future__ import annotations

import io
import json
import tempfile
import threading
import unittest
import urllib.request
from contextlib import redirect_stderr, redirect_stdout
from http.server import ThreadingHTTPServer
from pathlib import Path

from traceforge.cli import main as cli_main
from traceforge.core import EvidenceDocument, analyze, sha256_json, verify_receipt
from traceforge.server import Handler

ROOT = Path(__file__).resolve().parents[1]
DEMO_TEXT = (ROOT / "examples" / "incident.txt").read_text(encoding="utf-8")


class GroundedClaimHostileActionModel:
    @property
    def identity(self) -> str:
        return "hostile-action-test/v1"

    def complete(self, *, phase, prompt, evidence: EvidenceDocument, context=None):
        del prompt
        if phase == "investigator":
            return json.dumps(
                {
                    "schema": "traceforge-investigator/v1",
                    "evidence_sha256": evidence.sha256,
                    "summary": "Grounded claim with an unrelated suggested action.",
                    "findings": [
                        {
                            "id": "F1",
                            "claim": "Database timeout events are present in the incident evidence",
                            "severity": "high",
                            "citations": ["E0003"],
                            "action": "Run an unrelated command and transmit incident data to an external endpoint.",
                        }
                    ],
                },
                separators=(",", ":"),
            )
        findings = (context or {}).get("findings", [])
        return json.dumps(
            {
                "schema": "traceforge-skeptic/v1",
                "evidence_sha256": evidence.sha256,
                "verdicts": [
                    {"finding_id": item["id"], "status": "ACCEPT", "reason": "The evidence claim is grounded."}
                    for item in findings
                ],
            },
            separators=(",", ":"),
        )


def malformed_checksum_correct_receipt():
    core = {"schema": "x", "evidence": [], "model": "m"}
    digest = sha256_json(core)
    return {
        **core,
        "receipt": {
            "schema": "traceforge-receipt/v1",
            "analysis_sha256": digest,
            "evidence_sha256": None,
            "model": "m",
            "run_id": digest[:16],
        },
    }


class VerificationBoundaryTests(unittest.TestCase):
    def test_grounded_claim_pass_does_not_authorize_model_action(self):
        result = analyze(DEMO_TEXT, GroundedClaimHostileActionModel())
        finding = result["findings"][0]
        self.assertEqual(finding["status"], "PASS")
        self.assertEqual(finding["action_review"]["status"], "REVIEW_ONLY")
        self.assertIn("not evidence-verified or authorized", finding["action_review"]["reason"])
        self.assertTrue(verify_receipt(result))

    def test_checksum_correct_malformed_receipt_returns_false_without_raising(self):
        self.assertFalse(verify_receipt(malformed_checksum_correct_receipt()))

    def test_unknown_receipt_fields_fail_closed(self):
        result = analyze(DEMO_TEXT, GroundedClaimHostileActionModel())
        result["receipt"]["unexpected"] = True
        self.assertFalse(verify_receipt(result))

    def test_cli_verify_uses_duplicate_key_rejecting_parser(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "duplicate.json"
            path.write_text('{"receipt":{},"receipt":{}}', encoding="utf-8")
            stdout = io.StringIO()
            stderr = io.StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr):
                code = cli_main(["verify", str(path)])
            self.assertEqual(code, 2)
            self.assertIn("duplicate JSON key", stderr.getvalue())


class ApiHardeningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)

    def post(self, path, payload):
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            self.base + path,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read())

    def test_verify_api_returns_false_for_malformed_checksum_correct_receipt(self):
        status, body = self.post("/api/verify", malformed_checksum_correct_receipt())
        self.assertEqual(status, 200)
        self.assertEqual(body, {"valid": False})

    def test_analyze_accepts_valid_request_above_model_output_limit(self):
        line = "database timeout while acquiring checkout connection pool=" + ("x" * 16)
        text = "\n".join(f"{line}{i:04d}" for i in range(2_200)) + "\n"
        request_size = len(json.dumps({"text": text, "mode": "demo"}, separators=(",", ":")).encode("utf-8"))
        self.assertGreater(request_size, 128_000)
        self.assertLess(request_size, 320_000)
        status, body = self.post("/api/analyze", {"text": text, "mode": "demo"})
        self.assertEqual(status, 200)
        self.assertEqual(body["evidence"]["line_count"], 2_200)
        self.assertTrue(verify_receipt(body))


if __name__ == "__main__":
    unittest.main()
