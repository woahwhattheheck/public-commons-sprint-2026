"""One focused check of observation boundary: unknown must stay unknown."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import market_normalize, maybe_decimal, alerts

class MarketBoundary(unittest.TestCase):
    def test_valid_unknown_and_bad_quotes(self):
        ok = market_normalize({'id':'x','question':'Example','yes_price':'0.74','liquidity_usd':'900','volume_usd':'123'})
        self.assertEqual(ok['yes_probability_pct'],'74.00')
        self.assertEqual(ok['liquidity_usd'],'900')
        self.assertTrue(any(a['severity']=='caution' for a in alerts([ok])))
        bad = market_normalize({'id':'y','question':'Unknown price','yes_price':'1e309'})
        self.assertIsNone(bad['yes_probability_pct'])
        self.assertFalse(bad['price_proven'])
        self.assertTrue(any(a['severity']=='unknown' for a in alerts([bad])))
        self.assertIsNone(maybe_decimal(float('nan')))
        self.assertIsNone(market_normalize({'id':'z'}))

if __name__ == '__main__': unittest.main()