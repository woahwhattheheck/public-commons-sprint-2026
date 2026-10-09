"""Focused original-event-schema checks for immutable static CareRelay report bundles."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from carerelay.paged_review import build_report_pages, page_names
from carerelay.workspace import import_events


class PagedReportTest(unittest.TestCase):
    def source_workspace(self) -> dict:
        rows = []
        for n in range(110):
            human = n % 2 == 0
            rows.append({
                "schema": "ring-simulator-event/v1",
                "event_id": f"evt-{n:04d}", "device_id": "front-door-sim",
                "occurred_at": f"2026-10-09T12:{n // 60:02d}:{n % 60:02d}Z",
                "event_type": "doorbell" if human else "motion",
                "classification": "human" if human else "animal",
                "zone": "porch",
                "device_health": "signal <weak> & degraded" if n == 0 else "ok",
            })
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            return import_events(path, source="offline-simulator")

    def test_bundle_covers_every_proposal_and_quiet_event_with_real_links(self):
        workspace = self.source_workspace()
        before = json.dumps(workspace, sort_keys=True)
        pages = build_report_pages(workspace, filename="review.html", size=25)
        self.assertEqual(len(pages), 3)  # 55 proposals and 55 quiet events
        docs = [page.decode("utf-8") for page in pages]
        self.assertEqual(sum(doc.count("<dt>Proposal ID") for doc in docs), 55)
        self.assertEqual(sum(doc.count("No proposal generated") for doc in docs), 55)
        self.assertIn("review-p002.html", docs[0])
        self.assertIn("review-p003.html", docs[1])
        self.assertIn("review-p002.html", docs[2])
        self.assertNotIn("<weak>", "".join(docs))
        self.assertIn("signal &lt;weak&gt; &amp; degraded", docs[0])
        self.assertIn(workspace["receipt"]["state_sha256"], docs[2])
        self.assertEqual(page_names("review.html", 3),
                         ["review.html", "review-p002.html", "review-p003.html"])
        self.assertEqual(json.dumps(workspace, sort_keys=True), before)
        self.assertFalse(workspace["state"]["authority"]["external_action_executed"])

    def test_summary_status_and_event_filters_are_exact(self):
        workspace = self.source_workspace()
        summary = build_report_pages(workspace, filename="summary.html", size=100,
                                     status="pending", classification="human",
                                     kind="doorbell", summary=True)
        self.assertEqual(len(summary), 1)
        html = summary[0].decode("utf-8")
        self.assertIn("55 matching proposals", html)
        self.assertIn("0 matching quiet events", html)
        self.assertIn("<dt>Pending proposals</dt><dd>55</dd>", html)
        self.assertNotIn("<article>", html)
        rejected = build_report_pages(workspace, filename="empty.html", size=25,
                                      status="rejected", summary=False)
        self.assertEqual(len(rejected), 1)
        self.assertIn(b"No matching proposals", rejected[0])


if __name__ == "__main__":
    unittest.main()
