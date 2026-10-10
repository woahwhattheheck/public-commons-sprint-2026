"""One focused check of observation boundary: unknown must stay unknown."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import alerts, market_collection, market_normalize, maybe_decimal

class MarketBoundary(unittest.TestCase):
    def test_valid_unknown_and_bad_quotes(self):
        ok = market_normalize({'id':'x','question':'Example','yes_price':'0.74','liquidity_usd':'900','volume_usd':'123'})
        self.assertEqual(ok['yes_probability_pct'],'74.00')
        self.assertEqual(ok['liquidity_usd'],'900')
        self.assertTrue(any(a['severity']=='caution' for a in alerts([ok])))
        bad = market_normalize({'id':'y','question':'Unknown price','yes_price':'1e309'})
        self.assertIsNone(bad['yes_probability_pct'])
        self.assertFalse(bad['price_proven'])
        self.assertEqual([(a['market'], a['severity']) for a in alerts([bad])],
                         [('y', 'caution')])  # Malformed non-null quote is a source alert.
        self.assertIsNone(maybe_decimal(float('nan')))
        self.assertIsNone(market_normalize({'id':'z'}))

    def test_documented_list_contract_stays_explicit(self):
        payload = {'items': [{
            'marketId': 'market-17', 'title': 'Documented market',
            'volumeUsdc': '42.5', 'yesPrice': None, 'phase': 'secondary'
        }], 'nextCursor': 'opaque-next'}
        items = market_collection(payload)
        self.assertEqual(len(items), 1)
        row = market_normalize(items[0])
        self.assertEqual(row['id'], 'market-17')
        self.assertEqual(row['volume_usd'], '42.5')
        self.assertEqual(row['status'], 'secondary')
        self.assertIsNone(row['yes_probability_pct'])
        self.assertIsNone(row['liquidity_usd'])
        self.assertFalse(row['price_proven'])
        self.assertEqual(alerts([row]), [])  # Sponsor's documented explicit list null stays quiet.
        primary = market_normalize({'marketId': 'primary-only', 'title': 'Original sponsor',
                                    'yesPrice': None, 'primaryYesPrice': '0.33'})
        self.assertEqual(primary['yes_probability_pct'], '33.00')
        self.assertEqual(primary['price_state'], 'verified')
        self.assertEqual(primary['quote_source'], 'list')
        malformed = market_normalize({'marketId': 'bad-source', 'title': 'Invalid source',
                                      'yesPrice': '1.2'})
        self.assertEqual(malformed['price_state'], 'malformed')
        self.assertEqual([a['severity'] for a in alerts([malformed])], ['caution'])
        unknown = market_normalize({'marketId': 'unknown-source', 'title': 'Unknown schema',
                                    'yesPriceUsd': '0.5'})
        absent = market_normalize({'marketId': 'absent-source', 'title': 'Absent schema'})
        self.assertEqual(unknown['price_state'], 'schema_unknown')
        self.assertEqual(absent['price_state'], 'schema_unknown')
        self.assertEqual([a['severity'] for a in alerts([unknown])], ['unknown'])
        self.assertEqual([a['severity'] for a in alerts([absent])], ['unknown'])
        self.assertEqual(market_collection({'results': []}), [])
        self.assertIsNone(market_collection({'items': {'not': 'a list'}}))

    def test_muse_opt3_20_low_noise_preserves_real_warnings(self):
        """Documented null list quotes are quiet; genuine risk signals remain."""
        inputs = [
            {'marketId': 'list-1', 'title': 'Documented list', 'yesPrice': None, 'volumeUsdc': '13'},
            {'id': 'low', 'question': 'Low liquidity', 'yes_price': '0.44', 'liquidity_usd': '900'},
            {'id': 'extreme', 'question': 'Extreme price', 'yes_price': '0.97', 'liquidity_usd': '2000'},
            {'id': 'missing-liq', 'question': 'Unverified liquidity', 'yes_price': '0.45'},
            {'marketId': 'unpriced-low', 'title': 'Known low liquidity', 'yesPrice': None, 'liquidityUsd': 100}
        ]
        rows = [market_normalize(row) for row in inputs]
        self.assertTrue(all(rows))
        self.assertIsNone(rows[0]['yes_probability_pct'])
        self.assertFalse(rows[0]['price_proven'])
        signals = alerts(rows)
        self.assertEqual([(a['market'], a['severity']) for a in signals], [
            ('low', 'caution'), ('extreme', 'caution'),
            ('missing-liq', 'unknown'), ('unpriced-low', 'caution')
        ])
        self.assertFalse(any(a['market'] == 'list-1' for a in signals))

if __name__ == '__main__': unittest.main()
