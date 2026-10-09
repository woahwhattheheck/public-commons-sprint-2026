"""A stale cancel redirect cannot revoke another checkout."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

class CancelIntent(unittest.TestCase):
    def test_old_missing_and_valid_links(self):
        sid = "cancel-intent-test"
        state = {"csrf": "c", "generation": "g", "revision": 1, "phase": "approval_pending",
                 "cancel_nonce": "current", "order_id": "ORDER123", "audit": []}
        def request(path):
            fake = SimpleNamespace(path=path, headers={"Cookie": "cw=" + sid},
                                   json_out=Mock(), redirect=Mock())
            with patch.dict(server.SESSIONS, {sid: state}, clear=True):
                server.Handler.do_GET(fake)
            return fake
        for path in ("/api/cancel", "/api/cancel?intent=old"):
            with self.subTest(path=path):
                fake = request(path)
                fake.json_out.assert_called_once()
                self.assertEqual(state["phase"], "approval_pending")
                self.assertEqual(state["revision"], 1)
        good = request("/api/cancel?intent=current")
        good.redirect.assert_called_once_with("/")
        self.assertEqual(state["phase"], "cancelled")
        self.assertEqual(state["revision"], 2)

if __name__ == "__main__":
    unittest.main()
