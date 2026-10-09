"""Focused source-bound PayPal create retry behavior (no keys, no network)."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class StableCreateRequest(unittest.TestCase):
    def test_retry_reuses_one_purchase_id_but_new_plan_mints_another(self):
        item = server.CATALOG_BY_SKU["trail-repair"]
        handler = object.__new__(server.Handler)
        state = {"csrf": "csrf", "generation": "generation", "phase": "idle",
                 "audit": [], "revision": 0}
        attempts = []

        def sandbox(endpoint, *, method, payload, request_id):
            self.assertEqual(endpoint, "/v2/checkout/orders")
            self.assertEqual(method, "POST")
            self.assertEqual(payload["purchase_units"][0]["reference_id"], item["sku"])
            self.assertEqual(payload["purchase_units"][0]["amount"],
                             {"currency_code": "USD", "value": server.money(item["cents"])})
            attempts.append(request_id)
            if len(attempts) == 1:
                # A response lost *after* PayPal accepts a create-order request.
                raise server.ServiceError(502, "Remote provider unavailable.")
            return {"id": "9ZYX123456ABCDEF", "links": [
                {"rel": "approve", "href": "https://www.sandbox.paypal.com/checkoutnow"}]}

        with patch.object(server, "FIXTURE", False), patch.object(
                server, "ai_selection", return_value=(item, item["why"], "ai-model")
        ), patch.object(server, "paypal", side_effect=sandbox):
            handler.action("/api/plan",
                           {"prompt": "A trail repair kit for outdoor trips", "budget": "60"}, state)
            first_id = state["order_request_id"]
            with self.assertRaises(server.ServiceError):
                handler.action("/api/order", {"approved": True}, state)
            self.assertEqual(state["phase"], "planned")
            self.assertEqual(state["order_request_id"], first_id)
            result = handler.action("/api/order", {"approved": True}, state)
            self.assertEqual(result["phase"], "approval_pending")
            self.assertEqual(attempts, [first_id, first_id])
            handler.action("/api/order", {"approved": True}, state)
            self.assertEqual(len(attempts), 2)

            # A fresh buyer decision has an independent PayPal create identifier.
            handler.action("/api/reset", {}, state)
            handler.action("/api/plan",
                           {"prompt": "A trail repair kit for outdoor trips", "budget": "60"}, state)
            self.assertNotEqual(state["order_request_id"], first_id)

    def test_malformed_approval_links_fail_closed(self):
        for malformed in ({"links": [None]}, {"links": "not links"},
                          {"links": [{"rel": "approve", "href": 9}]}):
            with self.subTest(malformed=malformed):
                with self.assertRaises(server.ServiceError):
                    server.approval_url(malformed)


if __name__ == "__main__":
    unittest.main()
