"""Integration regression for normalized unclassified Ring button events."""
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from carerelay.review_page import render_review
from carerelay.workbench import main
from carerelay.workspace import import_events, load_workspace, save_workspace


class ActivityTimelineAcceptance(unittest.TestCase):
    def test_unclassified_button_is_visible_without_becoming_a_human_proposal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            events = root / "events.jsonl"
            rows = []
            for event_id, event_type, classification in (
                ("button-unknown", "doorbell", "unknown"),
                ("animal-motion", "motion", "animal"),
                ("human-motion", "motion", "human"),
            ):
                rows.append({"schema": "ring-simulator-event/v1", "event_id": event_id,
                             "device_id": "synthetic-device", "occurred_at": "2026-10-09T06:00:00Z",
                             "event_type": event_type, "classification": classification,
                             "zone": "<entry>"})
            events.write_text("".join(json.dumps(row) + "\n" for row in rows))
            workspace = import_events(events, source="offline-simulator")
            saved = root / "workspace.json"
            save_workspace(saved, workspace)
            before = saved.read_bytes()
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                result = main(["inspect", str(saved)])
            self.assertEqual(result, 0)
            summary = json.loads(stdout.getvalue())
            self.assertEqual(summary["proposals"], 1)
            self.assertEqual(len(summary["pending"]), 1)
            self.assertEqual({e["event_id"]: e["classification"] for e in summary["events_without_proposal"]},
                             {"button-unknown": "unknown", "animal-motion": "animal"})
            html = render_review(load_workspace(saved)).decode()
            timeline = html.split("<section aria-labelledby='activity-title'>", 1)[1].split("</section>", 1)[0]
            self.assertIn("button-unknown", timeline)
            self.assertIn("animal-motion", timeline)
            self.assertNotIn("human-motion", timeline)
            self.assertIn("&lt;entry&gt;", timeline)
            self.assertIn("<dd>unknown</dd>", timeline)
            self.assertEqual(saved.read_bytes(), before)
            self.assertEqual(workspace["state"]["approvals"], [])
            self.assertTrue(all(value is False for value in workspace["state"]["authority"].values()))


if __name__ == "__main__":
    unittest.main()
