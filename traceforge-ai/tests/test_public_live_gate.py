from __future__ import annotations

import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from traceforge.server import Handler


class PublicLiveGateTests(unittest.TestCase):
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

    def request_json(self, method: str, path: str, payload=None):
        data = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    def test_provider_configuration_alone_cannot_enable_public_live_http(self):
        with patch.dict(
            os.environ,
            {
                "TRACEFORGE_BASE_URL": "https://provider.example",
                "TRACEFORGE_MODEL": "paid-model",
                "TRACEFORGE_API_KEY": "secret-never-returned",
            },
            clear=True,
        ):
            status, config = self.request_json("GET", "/api/config")
            self.assertEqual(status, 200)
            self.assertTrue(config["providerConfigured"])
            self.assertFalse(config["liveConfigured"])
            self.assertEqual(config["liveModel"], "")
            self.assertTrue(config["publicLiveOptInRequired"])
            self.assertNotIn("secret-never-returned", json.dumps(config))

            status, rejected = self.request_json(
                "POST",
                "/api/analyze",
                {"text": "database timeout\n", "mode": "live"},
            )
            self.assertEqual(status, 422)
            self.assertEqual(rejected["error"], "analysis_rejected")
            self.assertIn("TRACEFORGE_ALLOW_PUBLIC_LIVE=1", rejected["detail"])

    def test_only_exact_one_enables_public_live_http(self):
        base = {
            "TRACEFORGE_BASE_URL": "https://provider.example",
            "TRACEFORGE_MODEL": "paid-model",
        }
        for value in ("true", "TRUE", "yes", "01", "on", " 1 "):
            with self.subTest(value=value), patch.dict(
                os.environ,
                {**base, "TRACEFORGE_ALLOW_PUBLIC_LIVE": value},
                clear=True,
            ):
                _, config = self.request_json("GET", "/api/config")
                self.assertFalse(config["liveConfigured"])
                self.assertEqual(config["liveModel"], "")

        with patch.dict(
            os.environ,
            {**base, "TRACEFORGE_ALLOW_PUBLIC_LIVE": "1"},
            clear=True,
        ):
            _, config = self.request_json("GET", "/api/config")
            self.assertTrue(config["liveConfigured"])
            self.assertEqual(config["liveModel"], "paid-model")

    def test_opt_in_without_provider_configuration_is_not_ready(self):
        with patch.dict(
            os.environ,
            {"TRACEFORGE_ALLOW_PUBLIC_LIVE": "1"},
            clear=True,
        ):
            _, config = self.request_json("GET", "/api/config")
            self.assertFalse(config["providerConfigured"])
            self.assertFalse(config["liveConfigured"])
            self.assertEqual(config["liveModel"], "")

    def test_demo_stays_available_when_provider_is_configured_but_public_live_is_off(self):
        with patch.dict(
            os.environ,
            {
                "TRACEFORGE_BASE_URL": "https://provider.example",
                "TRACEFORGE_MODEL": "paid-model",
                "TRACEFORGE_API_KEY": "secret-never-returned",
            },
            clear=True,
        ):
            status, result = self.request_json(
                "POST",
                "/api/analyze",
                {"text": "2026-09-14 api timeout observed\n", "mode": "demo"},
            )
            self.assertEqual(status, 200)
            self.assertEqual(result["model"], "traceforge-demo-rules/v1")
            self.assertEqual(result["receipt"]["schema"], "traceforge-receipt/v1")


if __name__ == "__main__":
    unittest.main()
