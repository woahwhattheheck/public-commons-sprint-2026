"""Focused regression for the Panta snapshot evidence viewer."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from evidenceforge.panta_view import (
    PantaViewError, load_snapshot, render_page, selected_context, verify_snapshot,
)


MARKET = {
    "marketId": "test-market", "title": '<img src=x onerror="alert(1)">',
    "category": "tech", "phase": "primary", "yesPrice": "0.7",
    "noPrice": "0.3", "volumeUsdc": "15", "totalVolumeUsdc": "30",
    "createdByPartner": False,
}


def fixture(**changes):
    data = {
        "schema": "evidenceforge-panta-market-snapshot/v1",
        "source": "https://live-api.panta.market/api/v1/markets/",
        "filters": {"category": "tech", "phase": "primary", "limit": 20},
        "items": [MARKET], "nextCursor": None,
        "authority": {
            "read_only": True, "transaction_built": False, "wallet_used": False,
            "trade_or_claim": False, "submission_or_award": False,
        },
    }
    data.update(changes)
    encoded = json.dumps(data, sort_keys=True, ensure_ascii=False,
                         separators=(",", ":")).encode()
    data["snapshotSha256"] = hashlib.sha256(encoded).hexdigest()
    return json.dumps(data).encode()


class PantaViewTests(unittest.TestCase):
    def test_verified_market_selection_yields_bound_review_only_packet(self):
        source = verify_snapshot(fixture())
        selected = selected_context(source, "test-market")
        self.assertEqual(selected["snapshotSha256"], source["snapshotSha256"])
        self.assertEqual(len(selected["selectionSha256"]), 64)
        self.assertFalse(selected["originAuthenticated"])
        self.assertFalse(selected["authority"]["trade_or_claim"])

    def test_html_escapes_hostile_market_titles_and_labels_provenance(self):
        page = render_page(verify_snapshot(fixture()), "test-market")
        self.assertNotIn('<img src=x', page)
        self.assertIn('&lt;img src=x', page)
        self.assertIn("not independently verified", page)

    def test_rejects_tampering_even_if_data_remains_valid_json(self):
        data = json.loads(fixture())
        data["items"][0]["yesPrice"] = "1"
        with self.assertRaisesRegex(PantaViewError, "digest mismatch"):
            verify_snapshot(json.dumps(data).encode())

    def test_rejects_forged_authority_and_untrusted_source(self):
        with self.assertRaisesRegex(PantaViewError, "authority"):
            verify_snapshot(fixture(authority={"read_only": True}))
        with self.assertRaisesRegex(PantaViewError, "API source"):
            verify_snapshot(fixture(source="https://attacker.invalid/markets/"))

    def test_rejects_unknown_market_and_price_out_of_range(self):
        data = verify_snapshot(fixture())
        with self.assertRaisesRegex(PantaViewError, "does not occur"):
            selected_context(data, "unknown-market")
        with self.assertRaisesRegex(PantaViewError, "out-of-range yesPrice"):
            verify_snapshot(fixture(items=[{**MARKET, "yesPrice": "1.1"}]))

    def test_file_load_is_bounded(self):
        with tempfile.TemporaryDirectory() as root:
            p = Path(root) / "snapshot.json"
            p.write_bytes(fixture())
            self.assertEqual(load_snapshot(p)["items"][0]["marketId"], "test-market")
            p.write_bytes(b"X" * 1_000_001)
            with self.assertRaisesRegex(PantaViewError, "1 MB"):
                load_snapshot(p)


if __name__ == "__main__":
    unittest.main()
