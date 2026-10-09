"""Actual CartWitness Handler.action reset CAS regression (no provider calls)."""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def initial():
    return {"csrf": "session-csrf", "generation": "session-generation",
            "revision": 8, "phase": "approval_pending",
            "plan": {"sku": "desk-focus", "usd": "34.90"},
            "order_id": "FIXTURE-existing", "cancel_nonce": "unique-for-checkout",
            "audit": [{"step": 1, "event": "order", "detail": "approval pending"}]}


def reviewed(state):
    return {"generation": state["generation"], "revision": state["revision"]}


class StaleReset(unittest.TestCase):
    def test_stale_tab_does_not_erase_newer_checkout(self):
        state = initial()
        old_tab = {**reviewed(state), "revision": 7}
        before = copy.deepcopy(state)
        with self.assertRaisesRegex(server.ServiceError, "Checkout changed"):
            server.Handler.action(None, "/api/reset", old_tab, state)
        self.assertEqual(state, before)

        for payload in ({}, {"generation": "another-session", "revision": 8},
                        {"generation": state["generation"], "revision": True}):
            with self.subTest(payload=payload):
                with self.assertRaises(server.ServiceError):
                    server.Handler.action(None, "/api/reset", payload, state)
                self.assertEqual(state, before)

        fresh = reviewed(state)
        cleared = server.Handler.action(None, "/api/reset", fresh, state)
        self.assertEqual(cleared["phase"], "idle")
        self.assertEqual(cleared["revision"], 9)
        self.assertEqual(cleared["generation"], "session-generation")
        self.assertEqual(state["audit"], [])
        self.assertNotIn("order_id", state)
        self.assertNotIn("cancel_nonce", state)

        # A delayed duplicate reset from the previous UI snapshot cannot
        # silently clear a subsequent plan or make revisions go backwards.
        state.update({"phase": "planned", "plan": {"sku": "trail-repair", "usd": "42.95"}})
        new_plan = copy.deepcopy(state)
        with self.assertRaisesRegex(server.ServiceError, "Checkout changed"):
            server.Handler.action(None, "/api/reset", fresh, state)
        self.assertEqual(state, new_plan)

        current = server.Handler.action(None, "/api/reset", reviewed(state), state)
        self.assertEqual(current["phase"], "idle")
        self.assertEqual(current["revision"], 10)


if __name__ == "__main__":
    unittest.main()
