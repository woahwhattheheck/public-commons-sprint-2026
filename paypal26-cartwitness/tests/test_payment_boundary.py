"""Only focused safety predicates for the CartWitness sandbox approval/capture boundary."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import valid_approved_order, valid_capture, CATALOG_BY_SKU, money


class ApprovalBoundary(unittest.TestCase):
    def test_exact_price_state_and_capture(self):
        item = CATALOG_BY_SKU["trail-repair"]
        unit = {"reference_id": item["sku"],
                "amount": {"currency_code": "USD", "value": money(item["cents"])}}
        approved = {"id": "ORDER1", "status": "APPROVED", "purchase_units": [unit]}
        self.assertTrue(valid_approved_order(approved, item, "ORDER1"))
        self.assertFalse(valid_approved_order({**approved, "status": "CREATED"}, item, "ORDER1"))
        self.assertFalse(valid_approved_order({**approved, "purchase_units": [
            {**unit, "amount": {"currency_code": "USD", "value": "0.01"}}]}, item, "ORDER1"))
        self.assertFalse(valid_approved_order(approved, item, "OTHER"))
        capture_unit = {**unit, "payments": {"captures": [{
            "status": "COMPLETED", "amount": unit["amount"]}]}}
        done = {"id": "ORDER1", "status": "COMPLETED", "purchase_units": [capture_unit]}
        self.assertTrue(valid_capture(done, item, "ORDER1"))
        self.assertFalse(valid_capture({**done, "purchase_units": [unit]}, item, "ORDER1"))
        self.assertFalse(valid_capture({**done, "purchase_units": [{
            **capture_unit, "payments": {"captures": [{
                "status": "PENDING", "amount": unit["amount"]}]}}]}, item, "ORDER1"))


    def test_rejects_duplicate_full_amount_and_malformed_capture_records(self):
        item = CATALOG_BY_SKU["trail-repair"]
        amount = {"currency_code": "USD", "value": money(item["cents"])}
        unit = {"reference_id": item["sku"], "amount": amount}
        capture = {"status": "COMPLETED", "amount": amount}

        def result(payments):
            return {"id": "ORDER1", "status": "COMPLETED",
                    "purchase_units": [{**unit, "payments": payments}]}

        self.assertTrue(valid_capture(result({"captures": [capture]}), item, "ORDER1"))
        self.assertFalse(valid_capture(result({"captures": [capture, dict(capture)]}),
                                       item, "ORDER1"))
        self.assertFalse(valid_capture(result({"captures": []}), item, "ORDER1"))
        self.assertFalse(valid_capture(result({"captures": {"0": capture}}),
                                       item, "ORDER1"))
        self.assertFalse(valid_capture(result({"captures": None}), item, "ORDER1"))
        self.assertFalse(valid_capture(result({"captures": [None]}), item, "ORDER1"))
        self.assertFalse(valid_capture(result({"captures": [{"status": "COMPLETED",
                                                             "amount": None}]}),
                                       item, "ORDER1"))
        self.assertFalse(valid_capture(result(None), item, "ORDER1"))


    def test_malformed_order_envelopes_fail_closed(self):
        item = CATALOG_BY_SKU["trail-repair"]
        amount = {"currency_code": "USD", "value": money(item["cents"])}
        valid_unit = {"reference_id": item["sku"], "amount": amount}
        for envelope in (None, [], "not-a-provider-object", 17):
            with self.subTest(envelope=envelope):
                self.assertFalse(valid_approved_order(envelope, item, "ORDER1"))
                self.assertFalse(valid_capture(envelope, item, "ORDER1"))

        malformed_units = (
            None, "unit", [], 42,
            {"reference_id": item["sku"], "amount": None},
            {"reference_id": item["sku"], "amount": []},
            {"reference_id": item["sku"], "amount": "42.95"},
        )
        for unit in malformed_units:
            with self.subTest(unit=unit):
                self.assertFalse(valid_approved_order({
                    "id": "ORDER1", "status": "APPROVED",
                    "purchase_units": [unit]}, item, "ORDER1"))
                self.assertFalse(valid_capture({
                    "id": "ORDER1", "status": "COMPLETED",
                    "purchase_units": [unit]}, item, "ORDER1"))

        self.assertTrue(valid_approved_order({
            "id": "ORDER1", "status": "APPROVED",
            "purchase_units": [valid_unit]}, item, "ORDER1"))


if __name__ == "__main__":
    unittest.main()
