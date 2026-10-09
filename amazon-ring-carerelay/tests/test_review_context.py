"""Focused regression: source-observed Ring event context is escaped and visible."""
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from carerelay.review_page import render_review


class ReviewContextTest(TestCase):
    def test_proposal_and_quiet_event_context_is_visible_without_actions(self):
        state = {
            "events": [
                {"event_id": "health-event", "device_id": "front-door",
                 "occurred_at": "2026-10-09T05:00:00+00:00", "event_type": "device_status",
                 "classification": "none", "device_health": "battery <low>&", "zone": "<zone>"},
                {"event_id": "unknown-button", "device_id": "front-door",
                 "occurred_at": "2026-10-09T05:02:00+00:00", "event_type": "doorbell",
                 "classification": "unknown", "device_health": "<img src=x onerror=alert(1)>",
                 "zone": None},
                {"event_id": "unknown-no-health", "device_id": "front-door",
                 "occurred_at": "2026-10-09T05:04:00+00:00", "event_type": "motion",
                 "classification": "animal", "device_health": None, "zone": None},
            ],
            "proposals": [{"proposal_id": "p1", "event_id": "health-event",
                           "action": "device_health_review",
                           "rationale": "Human review of device condition"}],
            "approvals": [],
        }
        workspace = {"receipt": {"state_sha256": "a" * 64}}
        before = repr(state)
        fake = SimpleNamespace(snapshot=lambda: state)
        with patch("carerelay.review_page.restore", return_value=(fake, "offline-simulator")):
            html = render_review(workspace).decode("utf-8")
        cards, quiet = html.split("<section aria-labelledby='activity-title'>", 1)
        self.assertIn("<dt>Event type</dt><dd>device status</dd>", cards)
        self.assertIn("<dt>Classification</dt><dd>none</dd>", cards)
        self.assertIn("<dt>Device health</dt><dd>battery &lt;low&gt;&amp;</dd>", cards)
        self.assertIn("<dt>Device health</dt><dd>&lt;img src=x onerror=alert(1)&gt;</dd>", quiet)
        self.assertIn("<dt>Device health</dt><dd>Not reported</dd>", quiet)
        self.assertIn("<dt>Classification</dt><dd>unknown</dd>", quiet)
        self.assertNotIn("<img src=x", html)
        self.assertIn("no actions are executed", html)
        self.assertIn("State SHA-256", html)
        self.assertEqual(repr(state), before)


if __name__ == "__main__":
    import unittest
    unittest.main()
