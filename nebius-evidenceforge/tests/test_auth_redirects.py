from __future__ import annotations

import unittest
import urllib.request
from unittest.mock import patch

from evidenceforge import provider, panta
from evidenceforge.core import EvidenceError


class _Response:
    def __init__(self, payload: bytes):
        self.payload = payload
        self.headers = {"Content-Length": str(len(payload))}

    def read(self, limit: int) -> bytes:
        return self.payload[:limit]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class AuthenticationRedirectTests(unittest.TestCase):
    """Exercise both real transport entry points with no network or credentials."""

    def test_token_factory_transport_installs_no_redirect_handler(self):
        with patch.object(urllib.request, "build_opener") as factory:
            factory.return_value.open.return_value = _Response(b'{"data":[]}')
            parsed = provider._request_json(
                "https://api.tokenfactory.nebius.com/v1/models", "fake-key",
            )
            self.assertEqual(parsed, {"data": []})
            request = factory.return_value.open.call_args.args[0]
            self.assertEqual(request.get_header("Authorization"), "Bearer fake-key")
            handler = factory.call_args.args[0]
            self.assertIsInstance(handler, urllib.request.HTTPRedirectHandler)
            for status in (301, 302, 303, 307, 308):
                with self.subTest(status=status):
                    with self.assertRaisesRegex(EvidenceError, "redirect rejected"):
                        handler.redirect_request(request, None, status, "redirect", {},
                                                 "https://redirected.invalid/collect")

    def test_panta_transport_installs_no_redirect_handler(self):
        with patch.object(urllib.request, "build_opener") as factory:
            factory.return_value.open.return_value = _Response(b'{"items":[]}')
            snapshot = panta.fetch_market_snapshot("fake-key")
            self.assertEqual(snapshot["items"], [])
            request = factory.return_value.open.call_args.args[0]
            self.assertEqual(request.get_header("X-api-key"), "fake-key")
            handler = factory.call_args.args[0]
            self.assertIsInstance(handler, urllib.request.HTTPRedirectHandler)
            for status in (301, 302, 303, 307, 308):
                with self.subTest(status=status):
                    with self.assertRaisesRegex(panta.PantaError, "redirect rejected"):
                        handler.redirect_request(request, None, status, "redirect", {},
                                                 "https://redirected.invalid/collect")


if __name__ == "__main__":
    unittest.main()
