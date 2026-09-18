from __future__ import annotations

import json
import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from marketledger_openmarkets.cli import _read_json, _write_json
from marketledger_openmarkets.engine import MarketLedgerError, compare_reports, evaluate_snapshot, stage_action
from marketledger_openmarkets.openmarkets import _NoRedirectHandler, _validate_base_url, fetch_contest_liquidity, normalize_liquidity_envelope


DOC_PAYLOAD = {
    "data": [{
        "position_hash": "pos-1",
        "contest_id": "contest-1",
        "title": "Home — Moneyline",
        "market_key": "moneyline",
        "side_key": "home",
        "participant_id": "home",
        "consensus_price": 0.52,
        "partner_liquidities": [
            {"partner_id": "a", "partner_name": "A", "price": 0.49, "available": 5400.0, "liquidity_hash": "a1"},
            {"partner_id": "b", "partner_name": "B", "price": 0.52, "available": 2300.0, "liquidity_hash": "b1"},
        ],
    }],
    "meta": {"timestamp": "2026-09-18T06:20:00Z", "api_version": "v1"},
}


def report(payload=None, **kwargs):
    snap = normalize_liquidity_envelope(payload or DOC_PAYLOAD, fee_bps_by_partner=kwargs.pop("fees", None))
    return evaluate_snapshot(snap, as_of="2026-09-18T06:20:30Z", **kwargs)


class NormalizeTests(unittest.TestCase):
    def test_documented_shape_normalizes(self):
        snap = normalize_liquidity_envelope(DOC_PAYLOAD, fee_bps_by_partner={"a": 10})
        self.assertEqual(snap["schema"], "marketledger.snapshot.v1")
        self.assertEqual(snap["positions"][0]["quotes"][0]["fee_bps"], "10")

    def test_object_positions_shape_normalizes(self):
        payload = deepcopy(DOC_PAYLOAD)
        payload["data"] = {"positions": payload["data"]}
        self.assertEqual(len(normalize_liquidity_envelope(payload)["positions"]), 1)

    def test_missing_positions_fails(self):
        with self.assertRaises(MarketLedgerError):
            normalize_liquidity_envelope({"data": {}})

    def test_negative_fee_fails(self):
        with self.assertRaises(MarketLedgerError):
            normalize_liquidity_envelope(DOC_PAYLOAD, fee_bps_by_partner={"a": -1})

    def test_duplicate_partner_fails_during_evaluation(self):
        payload = deepcopy(DOC_PAYLOAD)
        payload["data"][0]["partner_liquidities"].append(deepcopy(payload["data"][0]["partner_liquidities"][0]))
        snap = normalize_liquidity_envelope(payload)
        with self.assertRaises(MarketLedgerError):
            evaluate_snapshot(snap, as_of="2026-09-18T06:20:30Z")


class EngineTests(unittest.TestCase):
    def test_deterministic_receipt(self):
        self.assertEqual(report()["report_sha256"], report()["report_sha256"])

    def test_stale_fails(self):
        snap = normalize_liquidity_envelope(DOC_PAYLOAD)
        with self.assertRaises(MarketLedgerError):
            evaluate_snapshot(snap, as_of="2026-09-18T06:25:00Z", max_age_seconds=120)

    def test_future_observation_fails(self):
        snap = normalize_liquidity_envelope(DOC_PAYLOAD)
        with self.assertRaises(MarketLedgerError):
            evaluate_snapshot(snap, as_of="2026-09-18T06:19:59Z")

    def test_invalid_price_fails(self):
        payload = deepcopy(DOC_PAYLOAD)
        payload["data"][0]["partner_liquidities"][0]["price"] = 1.5
        with self.assertRaises(MarketLedgerError):
            report(payload)

    def test_negative_liquidity_fails(self):
        payload = deepcopy(DOC_PAYLOAD)
        payload["data"][0]["partner_liquidities"][0]["available"] = -1
        with self.assertRaises(MarketLedgerError):
            report(payload)

    def test_dispersion_alert(self):
        row = report(dispersion_threshold_bps=100)["positions"][0]
        self.assertTrue(row["alert"])
        self.assertEqual(row["best_partner_id"], "a")

    def test_fee_can_change_best_partner(self):
        row = report(fees={"a": 1000, "b": 0})["positions"][0]
        self.assertEqual(row["best_partner_id"], "b")

    def test_min_liquidity_filters_partner(self):
        row = report(min_available_usd=5000)["positions"][0]
        self.assertEqual(row["best_partner_id"], "a")
        self.assertFalse(next(q for q in row["quotes"] if q["partner_id"] == "b")["eligible"])

    def test_insufficient_liquidity(self):
        row = report(min_available_usd=999999)["positions"][0]
        self.assertEqual(row["status"], "insufficient_liquidity")
        self.assertFalse(row["alert"])

    def test_tie_breaks_by_partner_id(self):
        payload = deepcopy(DOC_PAYLOAD)
        payload["data"][0]["partner_liquidities"][1]["price"] = 0.49
        row = report(payload)["positions"][0]
        self.assertEqual(row["best_partner_id"], "a")

    def test_duplicate_position_fails(self):
        snap = normalize_liquidity_envelope(DOC_PAYLOAD)
        snap["positions"].append(deepcopy(snap["positions"][0]))
        with self.assertRaises(MarketLedgerError):
            evaluate_snapshot(snap, as_of="2026-09-18T06:20:30Z")

    def test_move_detection(self):
        old = report()
        payload = deepcopy(DOC_PAYLOAD)
        payload["data"][0]["partner_liquidities"][0]["price"] = 0.55
        payload["data"][0]["partner_liquidities"][1]["price"] = 0.50
        new = report(payload)
        events = compare_reports(old, new, move_threshold_bps=50)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["to_partner_id"], "b")

    def test_no_move_below_threshold(self):
        self.assertEqual(compare_reports(report(), report(), move_threshold_bps=1), [])

    def test_compare_rejects_tampered_report(self):
        old = report()
        tampered = deepcopy(old)
        tampered["positions"][0]["best_fee_adjusted_price"] = "0.01000000"
        with self.assertRaises(MarketLedgerError):
            compare_reports(old, tampered)

    def test_stage_requires_token(self):
        row = report()["positions"][0]
        with self.assertRaises(MarketLedgerError):
            stage_action(report(), position_hash=row["position_hash"], partner_id="a", confirmation_token="tiny")

    def test_stage_is_data_only(self):
        rep = report()
        row = rep["positions"][0]
        staged = stage_action(rep, position_hash=row["position_hash"], partner_id="a", confirmation_token="confirmed-123")
        self.assertFalse(staged["provider_mutation_allowed"])
        self.assertEqual(staged["authority"], "data_only_human_confirmed_stage")
        self.assertNotIn("url", staged)
        self.assertNotIn("execute", staged)

    def test_stage_unknown_partner_fails(self):
        rep = report()
        with self.assertRaises(MarketLedgerError):
            stage_action(rep, position_hash="pos-1", partner_id="missing", confirmation_token="confirmed-123")

    def test_stage_rejects_tampered_report_with_old_receipt(self):
        rep = report()
        rep["positions"][0]["quotes"][0]["price"] = "0.01000000"
        with self.assertRaises(MarketLedgerError):
            stage_action(rep, position_hash="pos-1", partner_id="a", confirmation_token="confirmed-123")

    def test_stage_rejects_below_liquidity_policy(self):
        rep = report(min_available_usd=5000)
        with self.assertRaises(MarketLedgerError):
            stage_action(rep, position_hash="pos-1", partner_id="b", confirmation_token="confirmed-123")


class AdapterTests(unittest.TestCase):
    def test_base_url_is_host_locked(self):
        self.assertEqual(_validate_base_url("https://api.openmarkets.ai/flow/v1"), "https://api.openmarkets.ai/flow/v1")
        for bad in [
            "http://api.openmarkets.ai/flow/v1",
            "https://evil.example/flow/v1",
            "https://api.openmarkets.ai.evil.example/flow/v1",
            "https://api.openmarkets.ai:4443/flow/v1",
            "https://user@api.openmarkets.ai/flow/v1",
            "https://api.openmarkets.ai/auth",
        ]:
            with self.assertRaises(MarketLedgerError):
                _validate_base_url(bad)

    def test_redirects_fail_closed_before_key_forwarding(self):
        with self.assertRaises(MarketLedgerError):
            _NoRedirectHandler().redirect_request(None, None, 302, "Found", {}, "https://evil.example/steal")

    def test_fetch_requires_key(self):
        with self.assertRaises(MarketLedgerError):
            fetch_contest_liquidity("contest-1", "")

    def test_fetch_uses_get_and_key_header(self):
        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, n): return json.dumps(DOC_PAYLOAD).encode("utf-8")
        seen = {}
        def fake_urlopen(req, timeout):
            seen["url"] = req.full_url
            seen["method"] = req.get_method()
            seen["key"] = req.headers.get("X-api-key")
            seen["timeout"] = timeout
            return FakeResponse()
        with patch("marketledger_openmarkets.openmarkets._open_request", fake_urlopen):
            out = fetch_contest_liquidity("contest / weird", "abcdefgh", timeout_seconds=3)
        self.assertEqual(seen["method"], "GET")
        self.assertEqual(seen["key"], "abcdefgh")
        self.assertIn("contest%20%2F%20weird", seen["url"])
        self.assertEqual(out["meta"]["api_version"], "v1")


class FileBoundaryTests(unittest.TestCase):
    def test_write_refuses_existing_file(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "out.json"
            path.write_text("existing", encoding="utf-8")
            with self.assertRaises(MarketLedgerError):
                _write_json(str(path), {"x": 1})
            self.assertEqual(path.read_text(encoding="utf-8"), "existing")

    def test_read_regular_json(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "in.json"
            path.write_text('{"x": 1}', encoding="utf-8")
            self.assertEqual(_read_json(str(path))["x"], 1)

    @unittest.skipIf(os.name == "nt", "symlink creation is not uniformly available on Windows")
    def test_read_refuses_symlink(self):
        with tempfile.TemporaryDirectory() as td:
            target = Path(td) / "real.json"
            target.write_text('{"x": 1}', encoding="utf-8")
            link = Path(td) / "link.json"
            link.symlink_to(target)
            with self.assertRaises(MarketLedgerError):
                _read_json(str(link))


if __name__ == "__main__":
    unittest.main()
