"""Focused, no-network judge presentation checks for saved Panta comparisons."""
import os
import unittest
from unittest.mock import patch

from evidenceforge.panta_compare_view import render_comparison_page
from evidenceforge.webapp import Handler


RECEIPT = {
    "source": "https://live-api.panta.market/api/v1/markets/",
    "beforeSnapshotSha256": "a" * 64,
    "afterSnapshotSha256": "b" * 64,
    "comparisonSha256": "c" * 64,
    "paginationMayHideMarkets": True,
    "matchedMarkets": 1,
    "changedMarkets": [{
        "marketId": '<svg/onload="alert(1)">',
        "fields": {"title": {"before": "<img src=x>", "after": "<script>"}},
    }],
    "appearedInAfterPage": ['<img src=x onerror="x">'],
    "absentFromAfterPage": ['<script>'],
}


class PantaComparisonViewTests(unittest.TestCase):
    def test_hostile_fields_are_escaped_and_provenance_is_explicit(self):
        html = render_comparison_page(RECEIPT)
        self.assertNotIn('<svg/onload=', html)
        self.assertNotIn("<script>", html)
        self.assertNotIn("<img src=x", html)
        self.assertIn("&lt;svg/onload=", html)
        self.assertIn("NOT", html.upper())
        self.assertIn("capture timestamps", html)
        self.assertIn("Pagination:", html)
        self.assertIn('href="/api/panta-compare"', html)

    def test_browser_requires_both_explicit_capture_files(self):
        handler = Handler.__new__(Handler)
        responses = []
        handler._send = lambda code, mime, data: responses.append((code, mime, data))
        with patch.dict(os.environ, {"PANTA_BEFORE_FILE": "", "PANTA_AFTER_FILE": ""}):
            handler._panta_compare_response("/api/panta-compare", "")
        self.assertEqual(int(responses[0][0]), 503)
        self.assertIn(b"PANTA_BEFORE_FILE", responses[0][2])
        self.assertIn(b"synthetic", responses[0][2])


if __name__ == "__main__":
    unittest.main()
