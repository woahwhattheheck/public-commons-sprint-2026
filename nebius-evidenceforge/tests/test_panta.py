from __future__ import annotations

import json
import unittest

from evidenceforge.panta import PantaError, fetch_market_snapshot


def payload(items, **extra):
    return json.dumps({"items": items, **extra}).encode()


MARKET = {
    "marketId": "market-1",
    "title": "Will a bounded agent patch pass review?",
    "category": "technology",
    "phase": "primary",
    "yesPrice": "0.625",
    "noPrice": "0.375",
    "volumeUsdc": "12.50",
    "totalVolumeUsdc": "20.00",
    "createdByPartner": True,
}


class PantaSnapshotTests(unittest.TestCase):
    def test_snapshot_is_bounded_read_only_and_hashed(self):
        seen = {}

        def transport(url, headers):
            seen.update(url=url, headers=headers)
            return payload([MARKET], nextCursor="next")

        result = fetch_market_snapshot(
            "test-key", category="technology", phase="primary", limit=5,
            transport=transport,
        )
        self.assertIn("/markets/?", seen["url"])
        self.assertIn("category=technology", seen["url"])
        self.assertEqual(seen["headers"]["X-Api-Key"], "test-key")
        self.assertEqual(result["items"][0]["yesPrice"], "0.625")
        self.assertEqual(result["nextCursor"], "next")
        self.assertEqual(len(result["snapshotSha256"]), 64)
        self.assertEqual(result["authority"], {
            "read_only": True,
            "transaction_built": False,
            "wallet_used": False,
            "trade_or_claim": False,
            "submission_or_award": False,
        })

    def test_primary_price_alias_is_supported(self):
        row = {**MARKET, "yesPrice": None, "noPrice": None,
               "primaryYesPrice": "0.4", "primaryNoPrice": "0.6"}
        result = fetch_market_snapshot("k", transport=lambda *_: payload([row]))
        self.assertEqual(result["items"][0]["yesPrice"], "0.4")

    def test_key_is_required(self):
        with self.assertRaisesRegex(PantaError, "PANTA_API_KEY"):
            fetch_market_snapshot("")

    def test_only_https_base_is_allowed(self):
        with self.assertRaisesRegex(PantaError, "HTTPS"):
            fetch_market_snapshot("k", base_url="http://example.test/api")

    def test_bad_price_is_rejected(self):
        with self.assertRaisesRegex(PantaError, r"\[0, 1\]"):
            fetch_market_snapshot(
                "k", transport=lambda *_: payload([{**MARKET, "yesPrice": "1.2"}])
            )

    def test_duplicate_market_id_is_rejected(self):
        with self.assertRaisesRegex(PantaError, "duplicate"):
            fetch_market_snapshot("k", transport=lambda *_: payload([MARKET, MARKET]))

    def test_invalid_shape_is_rejected(self):
        with self.assertRaisesRegex(PantaError, r"items\[\]"):
            fetch_market_snapshot("k", transport=lambda *_: b'{"results":[]}')

    def test_response_cannot_exceed_requested_limit(self):
        with self.assertRaisesRegex(PantaError, "requested limit"):
            fetch_market_snapshot(
                "k", limit=1,
                transport=lambda *_: payload([MARKET, {**MARKET, "marketId": "market-2"}]),
            )


if __name__ == "__main__":
    unittest.main()
