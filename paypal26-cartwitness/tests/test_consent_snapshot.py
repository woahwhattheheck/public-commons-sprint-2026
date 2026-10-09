"""Focused original handler regression: cross-tab consent must match server state."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def order_review(state):
    product = state["chosen"]
    return {"approved": True, "generation": state["generation"],
            "revision": state["revision"], "sku": product["sku"],
            "usd": server.money(product["cents"])}


def capture_review(state):
    return {"confirmed": True, "generation": state["generation"],
            "revision": state["revision"], "order_id": state["order_id"]}


class ConsentSnapshot(unittest.TestCase):
    def test_stale_tab_cannot_pay_for_new_selection_or_capture_new_order(self):
        state = {"phase": "planned", "generation": "session",
                 "revision": 1, "csrf": "csrf", "audit": [],
                 "chosen": server.CATALOG[0]}
        old_tab_consent = order_review(state)
        # A second tab changes the plan; the first still displays the old SKU.
        state["chosen"] = server.CATALOG[1]
        server.record(state, "plan", "another tab changed plan")
        with self.assertRaisesRegex(server.ServiceError, "Checkout changed"):
            server.Handler.action(None, "/api/order", old_tab_consent, state)
        self.assertEqual(state["phase"], "planned")
        self.assertNotIn("order_id", state)

        # Revision alone is not sufficient: the exact reviewed product and price matter.
        fake_current_revision = {**old_tab_consent, "revision": state["revision"]}
        with self.assertRaisesRegex(server.ServiceError, "Reviewed product or price"):
            server.Handler.action(None, "/api/order", fake_current_revision, state)

        with patch.object(server, "FIXTURE", True), patch.object(server, "PAYPAL_READY", False):
            created = server.Handler.action(None, "/api/order", order_review(state), state)
            self.assertEqual(created["phase"], "approval_pending")
            self.assertTrue(created["order_id"].startswith("FIXTURE-"))
            old_capture = capture_review(state)
            state["phase"] = "payer_returned"
            server.record(state, "fixture-return", "offline return")
            with self.assertRaisesRegex(server.ServiceError, "Checkout changed"):
                server.Handler.action(None, "/api/capture", old_capture, state)
            wrong_order = {**capture_review(state), "order_id": "FIXTURE-wrong"}
            with self.assertRaisesRegex(server.ServiceError, "Approved order changed"):
                server.Handler.action(None, "/api/capture", wrong_order, state)
            completed = server.Handler.action(None, "/api/capture", capture_review(state), state)
            self.assertEqual(completed["phase"], "fixture_completed")
            self.assertEqual(server.Handler.action(None, "/api/capture", old_capture, state)["revision"],
                             completed["revision"])


if __name__ == "__main__":
    unittest.main()
