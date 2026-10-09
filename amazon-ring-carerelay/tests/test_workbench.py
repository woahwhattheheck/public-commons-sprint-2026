"""Focused acceptance checks for the file-based workflow only."""
from __future__ import annotations

import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from carerelay.core import CareRelayError, canonical_json
from carerelay.receipt import compile_receipt
from carerelay.review_page import render_review
from carerelay.workbench import main
from carerelay.workspace import (MAX_EVENT_BYTES, apply_reviews, import_events,
                                 load_workspace, restore, save_workspace)


def event(event_id="evt-001", **fields):
    return {"schema": "ring-simulator-event/v1", "event_id": event_id,
            "device_id": "front-door-sim", "occurred_at": "2026-10-09T05:00:00Z",
            "event_type": "doorbell", "classification": "human", **fields}


class WorkbenchAcceptance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def rows(self, name, *rows):
        path = self.root / name
        path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
        return path

    def call(self, *args):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            status = main([str(arg) for arg in args])
        return status, stdout.getvalue(), stderr.getvalue()

    def test_import_resume_review_and_report_end_to_end(self):
        source = self.rows("events.jsonl", event(), event("evt-002", classification="animal"))
        original, reviewed, resumed = (self.root / name for name in ("one.json", "two.json", "three.json"))
        status, out, _ = self.call("import", source, "--source", "offline-simulator", "--out", original)
        self.assertEqual(status, 0)
        pending = json.loads(out)["pending"]
        self.assertEqual(len(pending), 1)
        decisions = self.rows("reviews.jsonl", {"proposal_id": pending[0]["proposal_id"],
                             "approver": "test-operator", "decision": "rejected"})
        self.assertEqual(self.call("review", original, decisions, "--out", reviewed)[0], 0)
        additional = self.rows("more.jsonl", event("evt-003", event_type="motion"))
        self.assertEqual(self.call("import", additional, "--resume", reviewed, "--out", resumed)[0], 0)
        saved = load_workspace(resumed)
        self.assertEqual(saved["receipt"]["source"], "offline-simulator")
        self.assertEqual([len(saved["state"][k]) for k in ("events", "proposals", "approvals")], [3, 2, 1])
        self.assertTrue(all(v is False for v in saved["state"]["authority"].values()))
        self.assertEqual(self.call("inspect", resumed)[0], 0)
        report = self.root / "review.html"
        self.assertEqual(self.call("report", resumed, "--out", report)[0], 0)
        self.assertIn("1 pending", report.read_text())
        self.assertEqual(load_workspace(original)["receipt"]["approval_count"], 0)

    def test_exact_retry_is_idempotent_and_late_collision_is_transactional(self):
        events = self.rows("events.jsonl", event())
        before = import_events(events)
        self.assertEqual(before["receipt"]["source"], "provider-candidate")
        self.assertEqual(import_events(events, previous=before), before)
        saved = canonical_json(before)
        collision = self.rows("collision.jsonl", event("new"), event(classification="animal"))
        with self.assertRaisesRegex(CareRelayError, "line 2"):
            import_events(collision, previous=before)
        self.assertEqual(canonical_json(before), saved)
        with self.assertRaisesRegex(CareRelayError, "source labels"):
            import_events(events, previous=before, source="offline-simulator")

    def test_replay_rejects_self_rehashed_forged_state_and_changed_decision(self):
        clean = import_events(self.rows("events.jsonl", event()))
        forged = copy.deepcopy(clean)
        forged["state"]["proposals"][0]["action"] = "invented_action"
        forged["receipt"] = compile_receipt(forged["state"], source="provider-candidate")
        with self.assertRaisesRegex(CareRelayError, "deterministic replay"):
            restore(forged)
        pid = clean["state"]["proposals"][0]["proposal_id"]
        reviewed = apply_reviews(clean, self.rows("yes.jsonl", {"proposal_id": pid,
                    "approver": "test-operator", "decision": "approved"}))
        before = canonical_json(reviewed)
        with self.assertRaisesRegex(CareRelayError, "review rejected"):
            apply_reviews(reviewed, self.rows("no.jsonl", {"proposal_id": pid,
                          "approver": "test-operator", "decision": "rejected"}))
        self.assertEqual(canonical_json(reviewed), before)

    def test_bounded_privacy_preserving_input_errors_do_not_publish(self):
        invalid = self.root / "bad.jsonl"
        output = self.root / "not-created.json"
        for raw in (b'{"schema":1,"schema":2}\n', b'{"number":1e400}\n',
                    b'x' * (MAX_EVENT_BYTES + 1), b'"\\ud800"\n',
                    json.dumps(event(person_name="PRIVATE_SENTINEL")).encode()):
            invalid.write_bytes(raw)
            status, stdout, stderr = self.call("import", invalid, "--out", output)
            self.assertEqual(status, 2)
            self.assertFalse(output.exists())
            self.assertNotIn("PRIVATE_SENTINEL", stdout + stderr)

    def test_output_is_no_clobber_and_workspace_can_exceed_one_event_limit(self):
        source = self.rows("batch.jsonl", *(event(f"event-{i}") for i in range(80)))
        workspace = import_events(source)
        out = self.root / "batch.json"
        save_workspace(out, workspace)
        baseline = out.read_bytes()
        self.assertGreater(len(baseline), MAX_EVENT_BYTES)
        self.assertEqual(load_workspace(out), workspace)
        with self.assertRaisesRegex(CareRelayError, "already exists"):
            save_workspace(out, workspace)
        self.assertEqual(out.read_bytes(), baseline)
        self.assertFalse(list(self.root.glob(".carerelay-*")))

    def test_html_escapes_operator_text_and_handles_empty_queue(self):
        workspace = import_events(self.rows("events.jsonl", event(zone="<script>alert(1)</script>")))
        html = render_review(workspace).decode()
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html)
        self.assertNotIn("<script>", html)
        self.assertNotIn("<form", html)
        self.assertIn("default-src 'none'", html)
        empty = import_events(self.rows("quiet.jsonl", event(classification="animal")))
        self.assertIn(b"No proposals require review", render_review(empty))


if __name__ == "__main__":
    unittest.main()
