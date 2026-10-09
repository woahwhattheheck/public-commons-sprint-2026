"""Focused sponsor-source-shaped read-only detail contract: market ID, quote provenance, pacing."""
import io
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from detail_fetch import enrich_market_list, rank_unpriced, valid_yes_price
from server import market_normalize


class Response(io.BytesIO):
    status = 200


class SponsorShapeOpener:
    def __init__(self):
        self.paths = []

    def open(self, req, timeout=None):
        self.paths.append((req.full_url, req.get_header('X-api-key'), timeout))
        mid = req.full_url.rsplit('/markets/', 1)[-1].rstrip('/')
        names = {'top%20space': 'top space', 'second': 'second'}
        identifier = names[mid]
        value = ({'marketId': identifier, 'title': identifier,
                  'yesPrice': '0.71'} if identifier == 'top space'
                 else {'marketId': identifier, 'title': identifier,
                       'yesPrice': None, 'primaryYesPrice': '0.23'})
        return Response(json.dumps(value).encode())


class DetailSourceContract(unittest.TestCase):
    def test_sponsor_route_stable_volume_top_two_and_quote_provenance(self):
        source_rows = [
            {'marketId':'low', 'title':'Low', 'volumeUsdc':'2', 'yesPrice':None},
            {'marketId':'top space', 'title':'Top', 'volumeUsdc':'80', 'yesPrice':None},
            {'marketId':'priced', 'title':'Priced', 'volumeUsdc':'120', 'yesPrice':'0.44'},
            {'marketId':'second', 'title':'Second', 'volumeUsdc':'30', 'yesPrice':None},
        ]
        ranked = rank_unpriced(source_rows, market_normalize, 2)
        self.assertEqual([item[1] for item in ranked], ['top space', 'second'])
        t = [100.0]
        def clock(): return t[0]
        def sleep(n): t[0] += n
        opener = SponsorShapeOpener()
        enriched, receipts = enrich_market_list(
            source_rows, 'https://live-api.panta.market/api/v1', 'fake-test-key',
            market_normalize, 2, opener=opener, clock=clock, sleep=sleep)
        normalized = [market_normalize(raw) for raw in enriched]
        self.assertEqual([(row['id'], row['yes_probability_pct'], row['quote_source'])
                          for row in normalized],
                         [('low', None, 'unverified'), ('top space', '71.00', 'detail'),
                          ('priced', '44.00', 'list'), ('second', '23.00', 'detail')])
        self.assertTrue(all(row['liquidity_usd'] is None for row in normalized))
        self.assertEqual(len(opener.paths), 2)
        self.assertIn('/markets/top%20space/', opener.paths[0][0])
        self.assertIn('/markets/second/', opener.paths[1][0])
        self.assertTrue(all(p[1] == 'fake-test-key' and p[2] == 9 for p in opener.paths))
        self.assertGreaterEqual(t[0] - 100, 2 * 60.0 / 110.0 - 0.0001)
        self.assertIn('2 verified YES quote(s)', ' '.join(receipts))
        self.assertEqual(source_rows[1]['yesPrice'], None)  # no mutation of provider list

    def test_bad_quote_rejected_and_unknown_ranking(self):
        self.assertIsNone(valid_yes_price('1.1'))
        self.assertIsNone(valid_yes_price('nan'))
        self.assertIsNone(valid_yes_price(True))
        self.assertEqual(valid_yes_price('0'), '0')
        source_rows = [
            {'marketId':'no-volume', 'title':'No volume', 'yesPrice':None},
            {'marketId':'one-volume', 'title':'One volume', 'volumeUsdc':'1', 'yesPrice':None},
            {'marketId':'one-volume', 'title':'Same ID repeated', 'volumeUsdc':'100', 'yesPrice':None}
        ]
        self.assertEqual([r[1] for r in rank_unpriced(source_rows, market_normalize, 3)],
                         ['one-volume','no-volume'])


if __name__ == '__main__':
    unittest.main()
