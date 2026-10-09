"""Focused isolated comparison checks; no API key, network or broad suites."""
import hashlib
import json
import unittest
from copy import deepcopy

from evidenceforge.panta_compare import PantaComparisonError, compare_snapshots, render_summary
from evidenceforge.panta_view import verify_snapshot


AUTHORITY = {
    "read_only": True, "transaction_built": False, "wallet_used": False,
    "trade_or_claim": False, "submission_or_award": False,
}
MARKET = {
    "marketId": "m1", "title": "Question?", "category": "tech",
    "phase": "primary", "yesPrice": "0.5", "noPrice": "0.5",
    "volumeUsdc": "10", "totalVolumeUsdc": "20",
    "createdByPartner": False,
}


def snapshot(rows=None, *, filters=None, cursor=None, source=None):
    body = {
        "schema": "evidenceforge-panta-market-snapshot/v1",
        "source": source or "https://live-api.panta.market/api/v1/markets/",
        "filters": filters or {"category": "tech", "phase": "primary", "limit": 20},
        "items": deepcopy([MARKET] if rows is None else rows),
        "nextCursor": cursor,
        "authority": deepcopy(AUTHORITY),
    }
    raw = json.dumps(body, sort_keys=True, ensure_ascii=False,
                     separators=(",", ":")).encode("utf-8")
    body["snapshotSha256"] = hashlib.sha256(raw).hexdigest()
    return verify_snapshot(json.dumps(body).encode("utf-8"))


class PantaCompareTests(unittest.TestCase):
    def test_exact_price_volume_phase_change_and_deterministic_receipt(self):
        earlier = snapshot()
        later = snapshot([{**MARKET, "yesPrice": "0.625",
                           "noPrice": "0.375", "totalVolumeUsdc": "25.75",
                           "phase": "secondary"}])
        a = compare_snapshots(earlier, later)
        self.assertEqual(a, compare_snapshots(earlier, later))
        self.assertEqual(a["matchedMarkets"], 1)
        self.assertEqual(a["changedMarkets"][0]["fields"]["yesPrice"]["delta"], "0.125")
        self.assertEqual(a["changedMarkets"][0]["fields"]["noPrice"]["delta"], "-0.125")
        self.assertEqual(a["changedMarkets"][0]["fields"]["totalVolumeUsdc"]["delta"], "5.75")
        self.assertEqual(a["changedMarkets"][0]["fields"]["phase"]["after"], "secondary")
        self.assertFalse(a["originAuthenticated"])
        self.assertFalse(a["authority"]["trade_or_claim"])
        self.assertIn("NOT a live authenticated feed", render_summary(a))

    def test_missing_in_captured_page_does_not_claim_delisting(self):
        first = snapshot([MARKET, {**MARKET, "marketId": "m2"}], cursor="more")
        second = snapshot([{**MARKET, "marketId": "m2"}, {**MARKET, "marketId": "m3"}])
        result = compare_snapshots(first, second)
        self.assertEqual(result["absentFromAfterPage"], ["m1"])
        self.assertEqual(result["appearedInAfterPage"], ["m3"])
        self.assertTrue(result["paginationMayHideMarkets"])
        self.assertIn("NOT delisted", render_summary(result))

    def test_conflicting_source_or_filters_are_not_equivalent(self):
        a = snapshot()
        with self.assertRaisesRegex(PantaComparisonError, "different API sources"):
            compare_snapshots(a, snapshot(source="https://staging-api.panta.market/api/v1/markets/"))
        with self.assertRaisesRegex(PantaComparisonError, "different category/phase/limit"):
            compare_snapshots(a, snapshot(filters={"category": None, "phase": "primary", "limit": 20}))

    def test_forged_hash_and_authority_never_gain_comparison_trust(self):
        good = snapshot()
        bad = deepcopy(good)
        bad["items"][0]["yesPrice"] = "0.99"
        with self.assertRaisesRegex(PantaComparisonError, "digest mismatch"):
            compare_snapshots(good, bad)
        forged = deepcopy(good)
        forged["authority"]["trade_or_claim"] = True
        with self.assertRaisesRegex(PantaComparisonError, "unexpected authority"):
            compare_snapshots(good, forged)


if __name__ == "__main__":
    unittest.main()
