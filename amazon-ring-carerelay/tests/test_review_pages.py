"""Focused original-source CareRelay static pages; mock only provider-free restore."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from carerelay.core import CareRelayError
from carerelay.review_page import export_page_bundle, render_paged


def fixture():
    events = [
        {"event_id": f"e{i}", "device_id": "d0", "occurred_at": "2026-10-09T10:00:00Z",
         "event_type": "doorbell" if i % 2 else "motion",
         "classification": "human" if i % 2 else "animal",
         "device_health": "<img src=x onerror=alert(1)>" if i == 1 else None,
         "zone": "<private>&" if i == 2 else None}
        for i in range(1, 10)
    ]
    proposals = [{"proposal_id": f"p{i}", "event_id": f"e{i}",
                  "action": "accessibility_notice", "rationale": "human review"}
                 for i in range(1, 5)]
    approvals = [{"proposal_id": "p1", "approver": "<reviewer>&",
                  "decision": "approved"}]
    return {"events": events, "proposals": proposals, "approvals": approvals}


class ReviewPagesFocused(unittest.TestCase):
    def setUp(self):
        self.state = fixture()
        self.original = deepcopy(self.state)
        self.workspace = {"receipt": {"state_sha256": "b" * 64}}
        self.restore = patch("carerelay.review_page.restore",
                             return_value=(SimpleNamespace(snapshot=lambda: self.state),
                                           "offline-simulator"))
        self.mock_restore = self.restore.start()
        self.addCleanup(self.restore.stop)

    def test_paging_reaches_every_real_proposal_and_quiet_event_once(self):
        # 4 proposals, 5 quiet events -> 3 pages at size 2.
        pages = [render_paged(self.workspace, page=n, size=2).decode("utf-8")
                 for n in (1, 2, 3)]
        self.assertIn("Page 1 of 3", pages[0])
        self.assertIn("Page 3 of 3", pages[2])
        for i in range(1, 5):
            self.assertEqual(sum(f"<dd>p{i}</dd>" in html for html in pages), 1)
        for i in range(5, 10):
            self.assertEqual(sum(f"<dd>e{i}</dd>" in html for html in pages), 1)
        self.assertIn("&lt;img src=x onerror=alert(1)&gt;", pages[0])
        self.assertNotIn("<img src=x", "".join(pages))
        self.assertNotIn("<script>", "".join(pages))
        self.assertIn("State SHA-256", pages[1])
        self.assertEqual(self.state, self.original)

    def test_status_kind_class_filters_and_empty_results(self):
        approved = render_paged(self.workspace, page=1, size=2,
                                status="approved", classification="human").decode()
        self.assertIn("<dd>p1</dd>", approved)
        self.assertNotIn("<dd>p2</dd>", approved)
        self.assertNotIn("Events without a proposal</h2>", approved)
        empty = render_paged(self.workspace, page=1, size=2,
                             status="rejected", kind="doorbell").decode()
        self.assertIn("No proposals match this view", empty)
        self.assertIn("Page 1 of 1", empty)
        for kw in ({"page": 4, "size": 2}, {"page": 0}, {"size": 1001},
                   {"classification": "<script>"}):
            with self.assertRaises(CareRelayError):
                render_paged(self.workspace, **kw)

    def test_filtered_summary_matches_selected_pages_and_cli_rejects_zero(self):
        import io
        from contextlib import redirect_stderr
        from carerelay.workbench import main as workbench_main

        filtered = render_paged(self.workspace, summary=True, status="approved",
                                classification="human", kind="doorbell").decode("utf-8")
        self.assertIn("1 matching proposals", filtered)
        self.assertIn("0 matching events without proposals", filtered)
        self.assertIn("<tr><th scope='row'>approved</th><td>1</td></tr>", filtered)
        self.assertNotIn(">pending</th>", filtered)
        self.assertIn("9 events · 4 proposals · 3 pending", filtered)  # Whole workspace.

        all_human = render_paged(self.workspace, summary=True, status="all",
                                 classification="human", kind="doorbell").decode("utf-8")
        self.assertIn("2 matching proposals", all_human)
        self.assertIn("3 matching events without proposals", all_human)
        self.assertNotIn(">animal</th>", all_human)

        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "filtered"
            export_page_bundle(self.workspace, directory, size=2, status="approved",
                               classification="human", kind="doorbell")
            summary = (directory / "summary.html").read_text()
            self.assertIn("1 matching proposals", summary)
            self.assertNotIn(">pending</th>", summary)
        with patch("carerelay.workbench.load_workspace", return_value=self.workspace), \
             patch("carerelay.workbench.publish_new") as published, \
             redirect_stderr(io.StringIO()) as err:
            status = workbench_main(["report", "dummy.json", "--out", "bad.html",
                                      "--page", "0"])
            self.assertEqual(status, 2)
            published.assert_not_called()
            self.assertIn("page must be positive", err.getvalue())
        self.assertEqual(self.state, self.original)

    def test_static_page_links_are_real_files_and_restore_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "export"
            count = export_page_bundle(self.workspace, target, size=2)
            self.assertEqual(count, 3)
            self.assertTrue((target / "page-0001.html").is_file())
            self.assertTrue((target / "page-0002.html").is_file())
            self.assertTrue((target / "page-0003.html").is_file())
            first = (target / "page-0001.html").read_text()
            middle = (target / "page-0002.html").read_text()
            last = (target / "page-0003.html").read_text()
            self.assertIn('href="page-0002.html"', first)
            self.assertIn('href="page-0001.html"', middle)
            self.assertIn('href="page-0003.html"', middle)
            self.assertNotIn('href="page-0004.html"', last)
            summary = (target / "summary.html").read_text()
            self.assertIn("workspace summary", summary)
            self.assertIn("Proposal decisions", summary)
            self.assertIn("No scripts, forms or external requests", summary)
            self.assertEqual(self.mock_restore.call_count, 1)
            with self.assertRaises(FileExistsError):
                export_page_bundle(self.workspace, target, size=2)


if __name__ == "__main__":
    unittest.main()
