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


if __name__ == "__main__":
    unittest.main()
