"""One loopback-only test: authenticated API requests must not follow redirects."""
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import ServiceError, api_json


class OutboundRedirectBoundary(unittest.TestCase):
    def test_refuses_redirect_without_forwarding_auth_and_allows_direct_json(self):
        leaked = []

        class FixtureHandler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path == "/redirect":
                    self.send_response(302)
                    self.send_header("Location", "/sink")
                    self.end_headers()
                elif self.path == "/sink":
                    leaked.append(self.headers.get("Authorization"))
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"unexpected":true}')
                elif self.path == "/direct":
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"ok":true}')
                else:
                    self.send_error(404)

        service = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        thread = threading.Thread(target=service.serve_forever, daemon=True)
        thread.start()
        try:
            origin = f"http://127.0.0.1:{service.server_port}"
            with self.assertRaises(ServiceError) as error:
                api_json(origin + "/redirect", auth="Bearer SYNTHETIC_TEST_ONLY")
            self.assertEqual(error.exception.status, 502)
            self.assertEqual(leaked, [], "Redirect target must never see Authorization")
            self.assertEqual(api_json(origin + "/direct", auth="Bearer SYNTHETIC_TEST_ONLY"),
                             {"ok": True})
        finally:
            service.shutdown()
            service.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
