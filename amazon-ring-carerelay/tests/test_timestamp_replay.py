"""Ring event-id replay semantics across equivalent ISO-8601 timestamp forms.

Focused offline checks only; never uses a Ring account, simulator, or provider.
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from carerelay.core import CareRelay, CareRelayError, RingEvent
from carerelay.receipt import compile_receipt, verify_receipt
from carerelay.workspace import import_events, load_workspace, save_workspace


def event(occurred_at: str, *, event_id: str = "ring-duplicate", zone: str = "entry") -> dict:
    return {
        "schema": "ring-simulator-event/v1",
        "event_id": event_id,
        "device_id": "front-door-sim",
        "occurred_at": occurred_at,
        "event_type": "doorbell",
        "classification": "human",
        "zone": zone,
    }


class EquivalentTimestampReplayTests(unittest.TestCase):
    def test_same_instant_different_offset_preserves_first_state_and_receipt(self):
        relay = CareRelay()
        first = relay.ingest(RingEvent.from_mapping(event("2026-10-09T08:00:00-04:00")))
        before = relay.snapshot()
        receipt = compile_receipt(before)
        replay = relay.ingest(RingEvent.from_mapping(event("2026-10-09T12:00:00Z")))
        self.assertEqual(replay, first)
        self.assertEqual(relay.event_count, 1)
        self.assertEqual(relay.snapshot(), before)
        self.assertTrue(verify_receipt(receipt, relay.snapshot()))
        self.assertEqual(before["events"][0]["occurred_at"], "2026-10-09T08:00:00-04:00")

    def test_fractional_precision_and_offset_variants_replay(self):
        relay = CareRelay()
        first = relay.ingest(RingEvent.from_mapping(event("2026-10-09T12:00:00.250000Z")))
        self.assertEqual(relay.ingest(RingEvent.from_mapping(
            event("2026-10-09T07:00:00.25-05:00"))), first)
        self.assertEqual(relay.event_count, 1)

    def test_changed_instant_and_changed_metadata_remain_hard_collisions(self):
        for changed in (
            event("2026-10-09T12:00:01Z"),
            event("2026-10-09T12:00:00Z", zone="another-door"),
        ):
            with self.subTest(changed=changed):
                relay = CareRelay()
                relay.ingest(RingEvent.from_mapping(event("2026-10-09T08:00:00-04:00")))
                before = relay.snapshot()
                with self.assertRaisesRegex(CareRelayError, "event_id collision"):
                    relay.ingest(RingEvent.from_mapping(changed))
                self.assertEqual(relay.snapshot(), before)

    def test_jsonl_batch_retry_and_resumed_legacy_offset_workspace(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            initial = root / "initial.jsonl"
            duplicate = root / "retry.jsonl"
            saved = root / "existing.json"
            initial.write_text(json.dumps(event("2026-10-09T08:00:00-04:00")) + "\n", encoding="utf-8")
            duplicate.write_text(
                json.dumps(event("2026-10-09T12:00:00Z")) + "\n"
                + json.dumps(event("2026-10-09T07:00:00-05:00")) + "\n",
                encoding="utf-8",
            )
            original = import_events(initial, source="offline-simulator")
            save_workspace(saved, original)
            self.assertEqual(load_workspace(saved), original)
            retried = import_events(duplicate, previous=load_workspace(saved))
            self.assertEqual(retried, original)
            self.assertEqual(len(retried["state"]["events"]), 1)
            self.assertEqual(len(retried["state"]["proposals"]), 1)
            self.assertEqual(len(retried["state"]["approvals"]), 0)
            self.assertTrue(all(flag is False for flag in retried["state"]["authority"].values()))


if __name__ == "__main__":
    unittest.main()
