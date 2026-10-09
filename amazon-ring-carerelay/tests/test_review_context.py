"""Source-attached human-review context regressions; no Ring provider or network."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from carerelay.review_page import render_review
from carerelay.workspace import import_events


def event(eid: str, kind: str, classification: str, health=None) -> dict:
    return {
        "schema": "ring-simulator-event/v1",
        "event_id": eid,
        "device_id": "front-door-sim",
        "occurred_at": "2026-10-09T15:00:00Z",
        "event_type": kind,
        "classification": classification,
        "zone": "porch",
        "device_health": health,
    }


class ReviewEventContext(unittest.TestCase):
    def render(self, *rows):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            workspace = import_events(path, source="offline-simulator")
            before = json.dumps(workspace, sort_keys=True)
            report = render_review(workspace).decode("utf-8")
            self.assertEqual(json.dumps(workspace, sort_keys=True), before)
            self.assertFalse(workspace["state"]["authority"]["external_action_executed"])
            return report

    def test_proposal_shows_exact_event_classification_and_escaped_health(self):
        html = self.render(event("health-review", "device_status", "unknown",
                                 "battery <red> & offline"))
        self.assertIn("<dt>Event type</dt><dd>device_status</dd>", html)
        self.assertIn("<dt>Classification</dt><dd>unknown</dd>", html)
        self.assertIn("<dt>Device health</dt><dd>battery &lt;red&gt; &amp; offline</dd>", html)
        self.assertNotIn("<red>", html)
        self.assertIn("Device health review", html)

    def test_quiet_event_keeps_health_context_visible_but_not_actionable(self):
        html = self.render(event("no-proposal", "motion", "animal",
                                 "signal <weak> & unstable"))
        self.assertIn("Events without a proposal", html)
        self.assertIn("<dt>Classification</dt><dd>animal</dd>", html)
        self.assertIn("<dt>Device health</dt><dd>signal &lt;weak&gt; &amp; unstable</dd>", html)
        self.assertIn("No proposal generated", html)
        self.assertNotIn("<weak>", html)

    def test_optional_health_field_placeholder(self):
        html = self.render(event("quiet-default", "doorbell", "unknown"))
        self.assertIn("<dt>Device health</dt><dd>Not supplied</dd>", html)
        self.assertIn("No proposals require review", html)


if __name__ == "__main__":
    unittest.main()
