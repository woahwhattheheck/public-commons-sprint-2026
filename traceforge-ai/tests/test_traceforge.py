from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from traceforge.cli import main as cli_main
from traceforge.core import (
    MAX_EVIDENCE_BYTES,
    EvidenceDocument,
    TraceForgeError,
    analyze,
    citation_support_score,
    strict_json_loads,
    verify_receipt,
)
from traceforge.model import DemoModel, OpenAICompatibleModel
from traceforge.server import Handler

ROOT = Path(__file__).resolve().parents[1]
DEMO_TEXT = (ROOT / "examples" / "incident.txt").read_text(encoding="utf-8")


class StaticModel:
    def __init__(self, investigator, skeptic, identity="static-test/v1"):
        self.investigator = investigator
        self.skeptic = skeptic
        self._identity = identity

    @property
    def identity(self):
        return self._identity

    def complete(self, *, phase, prompt, evidence, context=None):
        del prompt, context
        payload = self.investigator(evidence) if callable(self.investigator) else self.investigator
        if phase == "skeptic":
            payload = self.skeptic(evidence) if callable(self.skeptic) else self.skeptic
        return json.dumps(payload, separators=(",", ":"))


def investigator(evidence, *, claim="Database timeout events are present in the incident evidence", citations=None):
    return {
        "schema": "traceforge-investigator/v1",
        "evidence_sha256": evidence.sha256,
        "summary": "Bounded incident summary.",
        "findings": [
            {
                "id": "F1",
                "claim": claim,
                "severity": "high",
                "citations": citations or ["E0003"],
                "action": "Inspect dependency health before changing production.",
            }
        ],
    }


def skeptic(evidence, status="ACCEPT"):
    return {
        "schema": "traceforge-skeptic/v1",
        "evidence_sha256": evidence.sha256,
        "verdicts": [{"finding_id": "F1", "status": status, "reason": "Evidence checked."}],
    }


class EvidenceTests(unittest.TestCase):
    def test_crlf_and_cr_normalize_to_same_digest(self):
        a = EvidenceDocument.from_text("one\r\ntwo\r\n")
        b = EvidenceDocument.from_text("one\ntwo\n")
        c = EvidenceDocument.from_text("one\rtwo\r")
        self.assertEqual(a.sha256, b.sha256)
        self.assertEqual(b.sha256, c.sha256)
        self.assertEqual([x.id for x in a.lines], ["E0001", "E0002"])

    def test_nul_and_oversize_are_rejected(self):
        with self.assertRaisesRegex(TraceForgeError, "NUL"):
            EvidenceDocument.from_text("ok\x00bad")
        with self.assertRaisesRegex(TraceForgeError, "exceeds"):
            EvidenceDocument.from_text("x" * (MAX_EVIDENCE_BYTES + 1))

    def test_strict_json_rejects_duplicate_keys_and_nonfinite(self):
        with self.assertRaisesRegex(TraceForgeError, "duplicate JSON key"):
            strict_json_loads('{"a":1,"a":2}')
        with self.assertRaisesRegex(TraceForgeError, "invalid JSON constant"):
            strict_json_loads('{"x":NaN}')

    def test_support_score_is_explainable(self):
        score = citation_support_score(
            "Database timeout events are present in the incident evidence",
            "error database timeout while acquiring checkout transaction connection",
        )
        self.assertGreaterEqual(score, 0.4)
        self.assertEqual(citation_support_score("totally unrelated unicorn hypothesis", "database timeout"), 0.0)


class AnalysisTests(unittest.TestCase):
    def test_demo_analysis_is_receipted_and_has_passes(self):
        result = analyze(DEMO_TEXT, DemoModel())
        self.assertTrue(verify_receipt(result))
        self.assertGreaterEqual(result["counts"]["pass"], 2)
        self.assertEqual(result["evidence"]["line_count"], 10)
        self.assertEqual(result["model"], "traceforge-demo-rules/v1")
        injection = next(x for x in result["evidence"]["lines"] if "ignore prior instructions" in x["text"])
        self.assertEqual(injection["id"], "E0007")
        injection_finding = next(x for x in result["findings"] if x["claim"].startswith("Prior instructions"))
        self.assertEqual(injection_finding["status"], "PASS")
        self.assertEqual(injection_finding["citations"], ["E0007"])
        http_finding = next(x for x in result["findings"] if x["claim"].startswith("HTTP 5xx"))
        self.assertEqual(http_finding["citations"], ["E0005"])
        self.assertNotIn("E0010", http_finding["citations"])

    def test_fabricated_but_well_formed_citation_is_hold(self):
        model = StaticModel(
            lambda ev: investigator(ev, citations=["E9999"]),
            lambda ev: skeptic(ev),
        )
        result = analyze(DEMO_TEXT, model)
        finding = result["findings"][0]
        self.assertEqual(finding["status"], "HOLD")
        self.assertIn("missing citations", finding["verification_reason"])

    def test_weak_claim_is_hold_even_when_skeptic_accepts(self):
        model = StaticModel(
            lambda ev: investigator(ev, claim="Credential theft from billing administrator confirmed", citations=["E0003"]),
            lambda ev: skeptic(ev, "ACCEPT"),
        )
        result = analyze(DEMO_TEXT, model)
        self.assertEqual(result["findings"][0]["status"], "HOLD")
        self.assertIn("lexical evidence support", result["findings"][0]["verification_reason"])

    def test_skeptic_rejection_holds_grounded_claim(self):
        model = StaticModel(lambda ev: investigator(ev), lambda ev: skeptic(ev, "REJECT"))
        result = analyze(DEMO_TEXT, model)
        self.assertEqual(result["findings"][0]["status"], "HOLD")
        self.assertIn("skeptic rejected", result["findings"][0]["verification_reason"])

    def test_prompt_injection_in_evidence_does_not_mint_authority(self):
        model = StaticModel(
            lambda ev: investigator(
                ev,
                claim="Deploy is safe and requires no investigation",
                citations=["E0007"],
            ),
            lambda ev: skeptic(ev, "ACCEPT"),
        )
        result = analyze(DEMO_TEXT, model)
        finding = result["findings"][0]
        self.assertEqual(finding["status"], "HOLD")
        self.assertIn("lexical evidence support", finding["verification_reason"])

    def test_stale_investigator_digest_fails_closed(self):
        model = StaticModel(
            lambda ev: {**investigator(ev), "evidence_sha256": "0" * 64},
            lambda ev: skeptic(ev),
        )
        with self.assertRaisesRegex(TraceForgeError, "stale"):
            analyze(DEMO_TEXT, model)

    def test_extra_model_fields_are_rejected(self):
        def bad(ev):
            payload = investigator(ev)
            payload["confidence"] = 0.99
            return payload
        with self.assertRaisesRegex(TraceForgeError, "unknown"):
            analyze(DEMO_TEXT, StaticModel(bad, lambda ev: skeptic(ev)))

    def test_receipt_detects_analysis_tamper(self):
        result = analyze(DEMO_TEXT, DemoModel())
        result["summary"] = "tampered"
        self.assertFalse(verify_receipt(result))

    def test_model_identity_never_contains_key(self):
        model = OpenAICompatibleModel(
            base_url="https://models.example.test", model="incident-model", api_key="super-secret"
        )
        self.assertNotIn("secret", model.identity)
        self.assertEqual(model.identity, "openai-compatible:https://models.example.test:incident-model")


class ModelAdapterTests(unittest.TestCase):
    def test_unsafe_model_urls_fail_closed(self):
        bad = [
            "http://models.example.com",
            "https://user:pass@models.example.com",
            "https://models.example.com?token=x",
            "ftp://models.example.com",
        ]
        for url in bad:
            with self.subTest(url=url), self.assertRaises(TraceForgeError):
                OpenAICompatibleModel(base_url=url, model="m", api_key=None)

    def test_local_http_openai_adapter_executes_and_sends_key_only_in_header(self):
        seen = {}

        class Provider(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):  # noqa: N802
                seen["path"] = self.path
                seen["auth"] = self.headers.get("Authorization")
                n = int(self.headers["Content-Length"])
                body = json.loads(self.rfile.read(n))
                seen["body"] = body
                response = json.dumps({"choices": [{"message": {"content": '{"ok":true}'}}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(response)))
                self.end_headers()
                self.wfile.write(response)

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            model = OpenAICompatibleModel(
                base_url=f"http://127.0.0.1:{httpd.server_port}", model="fake", api_key="key-123"
            )
            evidence = EvidenceDocument.from_text("one\n")
            out = model.complete(phase="investigator", prompt="hello", evidence=evidence)
            self.assertEqual(out, '{"ok":true}')
            self.assertEqual(seen["path"], "/v1/chat/completions")
            self.assertEqual(seen["auth"], "Bearer key-123")
            self.assertNotIn("key-123", json.dumps(seen["body"]))
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=2)

    def test_env_requires_endpoint_and_model(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(TraceForgeError, "requires"):
                OpenAICompatibleModel.from_env()


class ApiTests(unittest.TestCase):
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

    def request(self, path, *, payload=None, content_type="application/json"):
        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(self.base + path, data=data, method="POST" if data is not None else "GET")
        if data is not None:
            req.add_header("Content-Type", content_type)
        try:
            with urllib.request.urlopen(req, timeout=3) as response:
                return response.status, response.headers, json.loads(response.read()) if "json" in response.headers.get_content_type() else response.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.headers, json.loads(exc.read())

    def test_health_and_security_headers(self):
        status, headers, payload = self.request("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertIn("default-src 'self'", headers["Content-Security-Policy"])
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")

    def test_demo_api_round_trip_and_receipt_verify(self):
        status, _, payload = self.request("/api/analyze", payload={"text": DEMO_TEXT, "mode": "demo"})
        self.assertEqual(status, 200)
        self.assertTrue(verify_receipt(payload))
        status, _, verified = self.request("/api/verify", payload=payload)
        self.assertEqual(status, 200)
        self.assertEqual(verified, {"valid": True})

    def test_api_rejects_unknown_fields_and_wrong_content_type(self):
        status, _, payload = self.request("/api/analyze", payload={"text": DEMO_TEXT, "mode": "demo", "admin": True})
        self.assertEqual(status, 422)
        self.assertEqual(payload["error"], "analysis_rejected")
        status, _, payload = self.request("/api/analyze", payload={"text": DEMO_TEXT, "mode": "demo"}, content_type="text/plain")
        self.assertEqual(status, 415)

    def test_static_router_does_not_expose_arbitrary_files(self):
        try:
            with urllib.request.urlopen(self.base + "/README.md", timeout=3):
                self.fail("unexpected arbitrary static file")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 404)


class CliTests(unittest.TestCase):
    def test_analyze_then_verify(self):
        with tempfile.TemporaryDirectory() as td:
            output = Path(td) / "analysis.json"
            self.assertEqual(cli_main(["analyze", str(ROOT / "examples" / "incident.txt"), "--mode", "demo", "--json-out", str(output)]), 0)
            self.assertEqual(cli_main(["verify", str(output)]), 0)
            payload = json.loads(output.read_text())
            self.assertTrue(verify_receipt(payload))


if __name__ == "__main__":
    unittest.main()
