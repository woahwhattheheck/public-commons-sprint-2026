import copy
import unittest

from permitroute.cli import run_demo, synthetic_records, synthetic_replay
from permitroute.core import (
    PermitEvent,
    PermitRecord,
    PermitRouteError,
    ReplayLedger,
    compare_batches,
    compare_record,
    strict_json_loads,
)
from permitroute.receipt import FALSE_AUTHORITY, compile_receipt, verify_receipt


def record(**overrides):
    row = {
        "schema": "permitroute-record/v1",
        "permit_id": "HWP-1",
        "applicant_ref": "APP-1",
        "district": "1",
        "permit_type": "utility",
        "status": "district_review",
        "submitted_at": "2026-09-01T12:00:00Z",
        "updated_at": "2026-09-02T12:00:00Z",
        "route_agencies": ["DOT-D1", "UTILITY-A"],
        "reviews": [
            {"agency": "DOT-D1", "decision": "pending"},
            {"agency": "UTILITY-A", "decision": "approved", "decided_at": "2026-09-02T10:00:00Z"},
        ],
        "attachment_digests": ["a" * 64],
        "source_system": "legacy",
    }
    row.update(overrides)
    return row


def event(**overrides):
    row = {
        "schema": "permitroute-event/v1",
        "event_id": "EVT-1",
        "permit_id": "HWP-1",
        "occurred_at": "2026-09-01T13:00:00Z",
        "from_status": "draft",
        "to_status": "submitted",
        "actor_role": "applicant",
    }
    row.update(overrides)
    return row


class StrictJsonTests(unittest.TestCase):
    def test_duplicate_key_rejected(self):
        with self.assertRaises(PermitRouteError):
            strict_json_loads('{"a":1,"a":2}')

    def test_nan_rejected(self):
        with self.assertRaises(PermitRouteError):
            strict_json_loads('{"a":NaN}')

    def test_infinity_rejected(self):
        with self.assertRaises(PermitRouteError):
            strict_json_loads('{"a":Infinity}')

    def test_invalid_utf8_rejected(self):
        with self.assertRaises(PermitRouteError):
            strict_json_loads(b"\xff")

    def test_non_text_rejected(self):
        with self.assertRaises(PermitRouteError):
            strict_json_loads(123)

    def test_oversize_rejected(self):
        with self.assertRaises(PermitRouteError):
            strict_json_loads('"' + ("x" * 1_000_001) + '"')


class PermitRecordTests(unittest.TestCase):
    def test_valid_record_normalizes(self):
        r = PermitRecord.from_mapping(record())
        self.assertEqual(r.district, "1")
        self.assertEqual(r.route_agencies, ("DOT-D1", "UTILITY-A"))
        self.assertEqual(r.reviews[0].agency, "DOT-D1")

    def test_wrong_schema_rejected(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(schema="bad"))

    def test_unknown_field_rejected(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(mystery="x"))

    def test_sensitive_field_rejected(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(ssn="123"))

    def test_bad_district_rejected(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(district="12"))

    def test_bad_permit_type_rejected(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(permit_type="spaceship"))

    def test_bad_status_rejected(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(status="unknown"))

    def test_non_draft_requires_submitted_at(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(submitted_at=None))

    def test_draft_allows_no_submitted_at(self):
        r = PermitRecord.from_mapping(record(status="draft", submitted_at=None))
        self.assertIsNone(r.submitted_at)

    def test_timezone_required(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(updated_at="2026-09-02T12:00:00"))

    def test_updated_must_not_precede_submitted(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(updated_at="2026-08-31T12:00:00Z"))

    def test_route_agencies_no_duplicates(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(route_agencies=["DOT-D1", "DOT-D1"]))

    def test_review_must_be_routed_agency(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(reviews=[{"agency":"OTHER","decision":"pending"}]))

    def test_duplicate_agency_review_rejected(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(reviews=[
                {"agency":"DOT-D1","decision":"pending"},
                {"agency":"DOT-D1","decision":"pending"},
            ]))

    def test_pending_review_must_not_have_decided_at(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(reviews=[
                {"agency":"DOT-D1","decision":"pending","decided_at":"2026-09-02T10:00:00Z"}
            ], route_agencies=["DOT-D1"]))

    def test_completed_review_requires_decided_at(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(reviews=[
                {"agency":"DOT-D1","decision":"approved"}
            ], route_agencies=["DOT-D1"]))

    def test_bad_review_decision_rejected(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(reviews=[
                {"agency":"DOT-D1","decision":"maybe"}
            ], route_agencies=["DOT-D1"]))

    def test_attachment_digest_must_be_sha256(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(attachment_digests=["abc"]))

    def test_uppercase_attachment_digest_rejected(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(attachment_digests=["A"*64]))

    def test_unsafe_identifier_rejected(self):
        with self.assertRaises(PermitRouteError):
            PermitRecord.from_mapping(record(permit_id="../../bad"))

    def test_digest_stable_under_input_order(self):
        a = PermitRecord.from_mapping(record(route_agencies=["UTILITY-A","DOT-D1"]))
        b = PermitRecord.from_mapping(record(route_agencies=["DOT-D1","UTILITY-A"]))
        self.assertEqual(a.digest, b.digest)


class EventReplayTests(unittest.TestCase):
    def test_legal_transition(self):
        e = PermitEvent.from_mapping(event())
        self.assertEqual(e.to_status, "submitted")

    def test_illegal_transition_rejected(self):
        with self.assertRaises(PermitRouteError):
            PermitEvent.from_mapping(event(from_status="draft", to_status="issued"))

    def test_event_timezone_required(self):
        with self.assertRaises(PermitRouteError):
            PermitEvent.from_mapping(event(occurred_at="2026-09-01T13:00:00"))

    def test_unseeded_permit_rejected(self):
        ledger = ReplayLedger()
        with self.assertRaises(PermitRouteError):
            ledger.apply(PermitEvent.from_mapping(event()))

    def test_seed_duplicate_rejected(self):
        ledger = ReplayLedger()
        ledger.seed("HWP-1")
        with self.assertRaises(PermitRouteError):
            ledger.seed("HWP-1")

    def test_replay_status_mismatch_rejected(self):
        ledger = ReplayLedger()
        ledger.seed("HWP-1", "submitted")
        with self.assertRaises(PermitRouteError):
            ledger.apply(PermitEvent.from_mapping(event()))

    def test_exact_duplicate_event_idempotent(self):
        ledger = ReplayLedger()
        ledger.seed("HWP-1")
        e = PermitEvent.from_mapping(event())
        self.assertTrue(ledger.apply(e))
        self.assertFalse(ledger.apply(e))
        self.assertEqual(len(ledger.snapshot()["events"]), 1)

    def test_event_id_collision_rejected(self):
        ledger = ReplayLedger()
        ledger.seed("HWP-1")
        ledger.apply(PermitEvent.from_mapping(event()))
        with self.assertRaises(PermitRouteError):
            ledger.apply(PermitEvent.from_mapping(event(to_status="withdrawn")))

    def test_time_regression_rejected(self):
        ledger = ReplayLedger()
        ledger.seed("HWP-1")
        ledger.apply(PermitEvent.from_mapping(event()))
        e2 = PermitEvent.from_mapping(event(
            event_id="EVT-2",
            occurred_at="2026-09-01T12:00:00Z",
            from_status="submitted",
            to_status="triage",
        ))
        with self.assertRaises(PermitRouteError):
            ledger.apply(e2)

    def test_legal_chain_replays(self):
        ledger = ReplayLedger()
        ledger.seed("HWP-1")
        events = [
            PermitEvent.from_mapping(event()),
            PermitEvent.from_mapping(event(
                event_id="EVT-2", occurred_at="2026-09-01T14:00:00Z",
                from_status="submitted", to_status="triage", actor_role="intake"
            )),
            PermitEvent.from_mapping(event(
                event_id="EVT-3", occurred_at="2026-09-01T15:00:00Z",
                from_status="triage", to_status="district_review", actor_role="router"
            )),
            PermitEvent.from_mapping(event(
                event_id="EVT-4", occurred_at="2026-09-01T16:00:00Z",
                from_status="district_review", to_status="approved", actor_role="reviewer"
            )),
            PermitEvent.from_mapping(event(
                event_id="EVT-5", occurred_at="2026-09-01T17:00:00Z",
                from_status="approved", to_status="issued", actor_role="issuer"
            )),
            PermitEvent.from_mapping(event(
                event_id="EVT-6", occurred_at="2026-09-01T18:00:00Z",
                from_status="issued", to_status="closed", actor_role="closer"
            )),
        ]
        state = ledger.replay(events)
        self.assertEqual(state["HWP-1"], "closed")
        self.assertEqual(len(ledger.snapshot()["events"]), 6)


class ComparisonTests(unittest.TestCase):
    def test_equal_records_equivalent(self):
        a = PermitRecord.from_mapping(record())
        b = PermitRecord.from_mapping(record())
        diff = compare_record(a, b)
        self.assertTrue(diff["equivalent"])
        self.assertEqual(diff["critical_difference_count"], 0)

    def test_source_system_difference_not_critical(self):
        a = PermitRecord.from_mapping(record(source_system="legacy"))
        b = PermitRecord.from_mapping(record(source_system="target"))
        diff = compare_record(a, b)
        self.assertFalse(diff["equivalent"])
        self.assertEqual(diff["critical_difference_count"], 0)

    def test_district_difference_critical(self):
        a = PermitRecord.from_mapping(record(district="1"))
        b = PermitRecord.from_mapping(record(district="2"))
        diff = compare_record(a, b)
        self.assertEqual(diff["critical_difference_count"], 1)

    def test_different_ids_rejected(self):
        a = PermitRecord.from_mapping(record(permit_id="HWP-1"))
        b = PermitRecord.from_mapping(record(permit_id="HWP-2"))
        with self.assertRaises(PermitRouteError):
            compare_record(a, b)

    def test_batch_counts(self):
        a = PermitRecord.from_mapping(record(permit_id="HWP-1"))
        b = PermitRecord.from_mapping(record(permit_id="HWP-2"))
        c = PermitRecord.from_mapping(record(permit_id="HWP-3"))
        result = compare_batches([a,b], [a,c])
        self.assertEqual(result["equivalent_count"], 1)
        self.assertEqual(result["legacy_only_count"], 1)
        self.assertEqual(result["target_only_count"], 1)

    def test_duplicate_legacy_ids_rejected(self):
        a = PermitRecord.from_mapping(record())
        with self.assertRaises(PermitRouteError):
            compare_batches([a,a], [a])

    def test_duplicate_target_ids_rejected(self):
        a = PermitRecord.from_mapping(record())
        with self.assertRaises(PermitRouteError):
            compare_batches([a], [a,a])

    def test_batch_order_deterministic(self):
        a = PermitRecord.from_mapping(record(permit_id="HWP-1"))
        b = PermitRecord.from_mapping(record(permit_id="HWP-2"))
        self.assertEqual(compare_batches([a,b],[a,b]), compare_batches([b,a],[b,a]))


class ReceiptTests(unittest.TestCase):
    def _evidence(self):
        legacy, target = synthetic_records()
        return compare_batches(legacy, target), synthetic_replay()

    def test_receipt_roundtrip(self):
        diff, replay = self._evidence()
        receipt = compile_receipt(batch_diff=diff, replay=replay)
        self.assertTrue(verify_receipt(receipt, batch_diff=diff, replay=replay))

    def test_receipt_all_authority_false(self):
        diff, replay = self._evidence()
        receipt = compile_receipt(batch_diff=diff, replay=replay)
        self.assertEqual(receipt["authority"], FALSE_AUTHORITY)
        self.assertTrue(all(value is False for value in receipt["authority"].values()))

    def test_receipt_tamper_rejected(self):
        diff, replay = self._evidence()
        receipt = compile_receipt(batch_diff=diff, replay=replay)
        receipt["different_count"] += 1
        self.assertFalse(verify_receipt(receipt, batch_diff=diff, replay=replay))

    def test_diff_tamper_rejected(self):
        diff, replay = self._evidence()
        receipt = compile_receipt(batch_diff=diff, replay=replay)
        bad = copy.deepcopy(diff)
        bad["different_count"] += 1
        self.assertFalse(verify_receipt(receipt, batch_diff=bad, replay=replay))

    def test_replay_tamper_rejected(self):
        diff, replay = self._evidence()
        receipt = compile_receipt(batch_diff=diff, replay=replay)
        bad = copy.deepcopy(replay)
        bad["statuses"]["HWP-0003"] = "issued"
        self.assertFalse(verify_receipt(receipt, batch_diff=diff, replay=bad))

    def test_authority_promotion_rejected(self):
        diff, replay = self._evidence()
        receipt = compile_receipt(batch_diff=diff, replay=replay)
        receipt["authority"]["contract_awarded"] = True
        self.assertFalse(verify_receipt(receipt, batch_diff=diff, replay=replay))

    def test_extra_receipt_key_rejected(self):
        diff, replay = self._evidence()
        receipt = compile_receipt(batch_diff=diff, replay=replay)
        receipt["trust_me"] = True
        self.assertFalse(verify_receipt(receipt, batch_diff=diff, replay=replay))

    def test_bad_source_rejected(self):
        diff, replay = self._evidence()
        with self.assertRaises(PermitRouteError):
            compile_receipt(batch_diff=diff, replay=replay, source="customer-production")

    def test_demo_is_deterministic(self):
        self.assertEqual(run_demo(), run_demo())

    def test_demo_exposes_one_critical_difference(self):
        bundle = run_demo()
        self.assertEqual(bundle["batch_diff"]["different_count"], 2)
        row = [x for x in bundle["batch_diff"]["rows"] if x["permit_id"] == "HWP-0002"][0]
        self.assertEqual(row["critical_difference_count"], 1)


if __name__ == "__main__":
    unittest.main()
