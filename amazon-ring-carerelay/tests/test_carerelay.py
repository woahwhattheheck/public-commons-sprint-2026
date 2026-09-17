import copy
import unittest
from urllib.request import Request

from carerelay.cli import run_demo
from carerelay.core import CareRelay, CareRelayError, RingEvent, strict_json_loads
from carerelay.receipt import compile_receipt, verify_receipt
from carerelay.ring import WHEP_TEMPLATE, RingWhepClient, build_whep_request


def event(**overrides):
    base = {
        "schema": "ring-simulator-event/v1",
        "event_id": "evt-1",
        "device_id": "dev-1",
        "occurred_at": "2026-09-17T05:00:00Z",
        "event_type": "doorbell",
        "classification": "human",
        "zone": "entry",
    }
    base.update(overrides)
    return base


class StrictIngressTests(unittest.TestCase):
    def test_duplicate_json_key_rejected(self):
        with self.assertRaises(CareRelayError):
            strict_json_loads('{"a":1,"a":2}')

    def test_nonfinite_json_rejected(self):
        with self.assertRaises(CareRelayError):
            strict_json_loads('{"a":NaN}')

    def test_unknown_field_rejected(self):
        with self.assertRaises(CareRelayError):
            RingEvent.from_mapping(event(extra="x"))

    def test_privacy_name_rejected(self):
        with self.assertRaises(CareRelayError):
            RingEvent.from_mapping(event(person_name="Alice"))

    def test_privacy_video_url_rejected(self):
        with self.assertRaises(CareRelayError):
            RingEvent.from_mapping(event(video_url="https://example.invalid/v"))

    def test_timezone_required(self):
        with self.assertRaises(CareRelayError):
            RingEvent.from_mapping(event(occurred_at="2026-09-17T05:00:00"))

    def test_unsafe_identifier_rejected(self):
        with self.assertRaises(CareRelayError):
            RingEvent.from_mapping(event(device_id="../../etc/passwd"))

    def test_bad_classification_rejected(self):
        with self.assertRaises(CareRelayError):
            RingEvent.from_mapping(event(classification="named-person"))

    def test_control_character_rejected(self):
        with self.assertRaises(CareRelayError):
            RingEvent.from_mapping(event(zone="front\nentry"))


class ReducerTests(unittest.TestCase):
    def test_human_doorbell_proposes_accessibility_notice(self):
        relay = CareRelay()
        props = relay.ingest(RingEvent.from_mapping(event()))
        self.assertEqual([p.action for p in props], ["accessibility_notice"])
        self.assertTrue(props[0].requires_human_approval)
        self.assertFalse(props[0].external_action_executed)

    def test_animal_motion_does_not_emit_care_alert(self):
        relay = CareRelay()
        props = relay.ingest(RingEvent.from_mapping(event(event_type="motion", classification="animal")))
        self.assertEqual(props, ())

    def test_human_motion_proposes_check_in(self):
        relay = CareRelay()
        props = relay.ingest(RingEvent.from_mapping(event(event_type="motion")))
        self.assertEqual(props[0].action, "caretaking_check_in")

    def test_degraded_status_proposes_review(self):
        relay = CareRelay()
        props = relay.ingest(RingEvent.from_mapping(event(event_type="device_status", classification="none", device_health="degraded")))
        self.assertEqual(props[0].action, "device_health_review")

    def test_ok_status_is_quiet(self):
        relay = CareRelay()
        props = relay.ingest(RingEvent.from_mapping(event(event_type="device_status", classification="none", device_health="ok")))
        self.assertEqual(props, ())

    def test_exact_duplicate_event_is_idempotent(self):
        relay = CareRelay()
        ev = RingEvent.from_mapping(event())
        first = relay.ingest(ev)
        second = relay.ingest(ev)
        self.assertEqual(first, second)
        self.assertEqual(relay.event_count, 1)

    def test_same_id_different_content_rejected(self):
        relay = CareRelay()
        relay.ingest(RingEvent.from_mapping(event()))
        with self.assertRaises(CareRelayError):
            relay.ingest(RingEvent.from_mapping(event(zone="side")))

    def test_unknown_proposal_cannot_be_approved(self):
        with self.assertRaises(CareRelayError):
            CareRelay().approve("deadbeef", "human")

    def test_approval_never_claims_external_execution(self):
        relay = CareRelay()
        proposal = relay.ingest(RingEvent.from_mapping(event()))[0]
        record = relay.approve(proposal.proposal_id, "human-1")
        self.assertFalse(record.external_action_executed)
        self.assertFalse(relay.snapshot()["authority"]["external_action_executed"])

    def test_conflicting_second_decision_rejected(self):
        relay = CareRelay()
        proposal = relay.ingest(RingEvent.from_mapping(event()))[0]
        relay.approve(proposal.proposal_id, "human-1", "approved")
        with self.assertRaises(CareRelayError):
            relay.approve(proposal.proposal_id, "human-1", "rejected")

    def test_snapshot_order_is_deterministic(self):
        a = CareRelay(); b = CareRelay()
        e1 = RingEvent.from_mapping(event(event_id="b"))
        e2 = RingEvent.from_mapping(event(event_id="a", zone="side"))
        for ev in (e1, e2): a.ingest(ev)
        for ev in (e2, e1): b.ingest(ev)
        self.assertEqual(a.snapshot(), b.snapshot())


class ReceiptTests(unittest.TestCase):
    def test_receipt_roundtrip(self):
        relay = CareRelay(); relay.ingest(RingEvent.from_mapping(event()))
        state = relay.snapshot(); receipt = compile_receipt(state)
        self.assertTrue(verify_receipt(receipt, state))

    def test_receipt_tamper_rejected(self):
        relay = CareRelay(); relay.ingest(RingEvent.from_mapping(event()))
        state = relay.snapshot(); receipt = compile_receipt(state)
        receipt["event_count"] = 99
        self.assertFalse(verify_receipt(receipt, state))

    def test_state_tamper_rejected(self):
        relay = CareRelay(); relay.ingest(RingEvent.from_mapping(event()))
        state = relay.snapshot(); receipt = compile_receipt(state)
        bad = copy.deepcopy(state); bad["events"][0]["zone"] = "tampered"
        self.assertFalse(verify_receipt(receipt, bad))

    def test_authority_promotion_rejected(self):
        relay = CareRelay(); relay.ingest(RingEvent.from_mapping(event()))
        state = relay.snapshot(); receipt = compile_receipt(state)
        receipt["authority"]["award_verified"] = True
        self.assertFalse(verify_receipt(receipt, state))

    def test_extra_receipt_key_rejected(self):
        relay = CareRelay(); relay.ingest(RingEvent.from_mapping(event()))
        state = relay.snapshot(); receipt = compile_receipt(state)
        receipt["note"] = "trust me"
        self.assertFalse(verify_receipt(receipt, state))

    def test_demo_is_deterministic(self):
        self.assertEqual(run_demo(), run_demo())


class FakeResponse:
    def __init__(self, status=201, body=b"v=0\r\n", location="https://api.amazonvision.com/session/1"):
        self.status = status
        self._body = body
        self.headers = {"Location": location}
    def read(self, limit=-1):
        return self._body[:limit]


class RingRuntimeTests(unittest.TestCase):
    def test_whep_url_matches_official_runtime_endpoint(self):
        req = build_whep_request("device-123", "token123", "v=0\r\n")
        self.assertEqual(req.full_url, "https://api.amazonvision.com/v1/devices/device-123/media/streaming/whep/sessions")
        self.assertEqual(WHEP_TEMPLATE.count("{device_id}"), 1)

    def test_whep_request_is_post_sdp_bearer(self):
        req = build_whep_request("device-123", "token123", "v=0\r\n")
        self.assertIsInstance(req, Request)
        self.assertEqual(req.method, "POST")
        headers = {k.lower(): v for k, v in req.header_items()}
        self.assertEqual(headers["authorization"], "Bearer token123")
        self.assertEqual(headers["content-type"], "application/sdp")

    def test_whep_path_injection_rejected(self):
        with self.assertRaises(CareRelayError):
            build_whep_request("../devices/evil", "token", "v=0\r\n")

    def test_whitespace_token_rejected(self):
        with self.assertRaises(CareRelayError):
            build_whep_request("dev", "bad token", "v=0\r\n")

    def test_non_sdp_rejected(self):
        with self.assertRaises(CareRelayError):
            build_whep_request("dev", "token", "not-sdp")

    def test_client_accepts_only_201(self):
        client = RingWhepClient(opener=lambda req, timeout=10: FakeResponse(status=200))
        with self.assertRaises(CareRelayError):
            client.create_session("dev", "token", "v=0\r\n")

    def test_client_requires_location(self):
        client = RingWhepClient(opener=lambda req, timeout=10: FakeResponse(location=""))
        with self.assertRaises(CareRelayError):
            client.create_session("dev", "token", "v=0\r\n")

    def test_client_accepts_valid_sdp(self):
        client = RingWhepClient(opener=lambda req, timeout=10: FakeResponse())
        session = client.create_session("dev", "token", "v=0\r\n")
        self.assertTrue(session.sdp_answer.startswith("v=0"))
        self.assertTrue(session.location.startswith("https://"))

    def test_client_rejects_non_sdp_answer(self):
        client = RingWhepClient(opener=lambda req, timeout=10: FakeResponse(body=b"hello"))
        with self.assertRaises(CareRelayError):
            client.create_session("dev", "token", "v=0\r\n")


if __name__ == "__main__":
    unittest.main()
