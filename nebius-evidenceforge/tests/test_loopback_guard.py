"""Focused local-origin contract, no HTTP/network/provider calls."""
import unittest
from email.message import Message
from evidenceforge.loopback_guard import allowed_request


def headers(*pairs):
    result = Message()
    for key, value in pairs:
        result[key] = value
    return result


class LoopbackGuardTests(unittest.TestCase):
    def test_local_browser_and_cli_allowed(self):
        for host in ("localhost:8081", "127.0.0.1:8081", "LOCALHOST:8081"):
            with self.subTest(host=host):
                self.assertTrue(allowed_request(headers(("Host", host)), 8081))
                self.assertTrue(allowed_request(headers(("Host", host),
                    ("Origin", "http://" + host.lower()),
                    ("Sec-Fetch-Site", "same-origin")), 8081, mutation=True))
                self.assertTrue(allowed_request(headers(("Host", host)), 8081, mutation=True))

    def test_nonlocal_and_ambiguous_host_denied(self):
        for host in ("example.test:8081", "127.0.0.2:8081", "localhost.:8081",
                     "localhost:8082", "localhost:bad", "http://localhost:8081",
                     "localhost:8081@other.test", "localhost:8081/extra", " localhost:8081"):
            with self.subTest(host=host):
                self.assertFalse(allowed_request(headers(("Host", host)), 8081))
        self.assertFalse(allowed_request(headers(), 8081))
        self.assertFalse(allowed_request(headers(("Host", "localhost:8081"),
                                                 ("Host", "127.0.0.1:8081")), 8081))

    def test_browser_cross_origin_denied(self):
        for origin in ("null", "http://other.test:8081", "http://localhost:8082",
                       "https://localhost:8081", "http://127.0.0.1:8081"):
            with self.subTest(origin=origin):
                self.assertFalse(allowed_request(headers(("Host", "localhost:8081"),
                                      ("Origin", origin)), 8081, mutation=True))
        for site in ("cross-site", "same-site", "invalid"):
            self.assertFalse(allowed_request(headers(("Host", "localhost:8081"),
                                  ("Sec-Fetch-Site", site)), 8081))
        self.assertFalse(allowed_request(headers(("Host", "localhost:8081"),
                                   ("Origin", "http://localhost:8081"),
                                   ("Origin", "http://localhost:8081")), 8081))


if __name__ == "__main__":
    unittest.main()
