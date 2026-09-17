from __future__ import annotations

import copy
import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer

import core
import mcp_server


def call(store: core.HomeOpsStore):
    store.create_issue({"issue_id": "hvac-1", "title": "Upstairs too warm", "description": "Temperature drifts after noon", "priority": "HIGH"})
    store.add_evidence({"issue_id": "hvac-1", "evidence_id": "e1", "kind": "SENSOR", "summary": "Thermostat shows 80F", "source": "manual-observation"})
    store.add_quote({"issue_id": "hvac-1", "quote_id": "q1", "vendor": "Example HVAC", "amount_cents": 15000, "currency": "USD", "scope": "diagnostic visit"})
    plan = store.propose_plan({"issue_id": "hvac-1", "plan_id": "p1", "summary": "Inspect airflow before replacement", "steps": ["Check filter", "Check supply vents", "Review quote"]})
    return plan


class CoreTests(unittest.TestCase):
    def test_full_flow_is_proposal_only(self):
        s = core.HomeOpsStore(); plan = call(s)
        self.assertEqual(plan["authority"], "PROPOSAL_ONLY")
        review = s.review_plan({"plan_id": "p1", "decision": "APPROVE", "reviewer": "owner-1", "note": "Proceed to request only"})
        req = s.request_side_effect({"plan_id": "p1", "action_id": "a1", "kind": "SCHEDULE_VISIT", "summary": "Request appointment"})
        self.assertFalse(req["execution_authorized"])
        self.assertTrue(req["requires_external_executor"])
        self.assertEqual(req["approval_digest"], review["approval_digest"])

    def test_duplicate_side_effect_request_id_fails(self):
        s = core.HomeOpsStore(); call(s)
        s.review_plan({"plan_id": "p1", "decision": "APPROVE", "reviewer": "owner-1", "note": "Yes"})
        first = s.request_side_effect({"plan_id": "p1", "action_id": "a1", "kind": "SEND_MESSAGE", "summary": "Request only"})
        self.assertFalse(first["execution_authorized"])
        with self.assertRaisesRegex(core.HomeOpsError, "duplicate action_id"):
            s.request_side_effect({"plan_id": "p1", "action_id": "a1", "kind": "SEND_MESSAGE", "summary": "Replay"})

    def test_plan_binds_current_issue_state_digest(self):
        s = core.HomeOpsStore(); plan = call(s)
        issue = s.issues["hvac-1"]
        self.assertEqual(issue["state"], "PLAN_PROPOSED")
        self.assertEqual(plan["issue_digest"], issue["record_digest"])

    def test_side_effect_without_approval_fails(self):
        s = core.HomeOpsStore(); call(s)
        with self.assertRaisesRegex(core.HomeOpsError, "approved exact plan"):
            s.request_side_effect({"plan_id": "p1", "action_id": "a1", "kind": "PLACE_ORDER", "summary": "Buy part"})

    def test_rejected_plan_cannot_request_effect(self):
        s = core.HomeOpsStore(); call(s)
        s.review_plan({"plan_id": "p1", "decision": "REJECT", "reviewer": "owner-1", "note": "No"})
        with self.assertRaisesRegex(core.HomeOpsError, "approved exact plan"):
            s.request_side_effect({"plan_id": "p1", "action_id": "a1", "kind": "SEND_MESSAGE", "summary": "Send"})

    def test_unsupported_side_effect_fails(self):
        s = core.HomeOpsStore(); call(s)
        s.review_plan({"plan_id": "p1", "decision": "APPROVE", "reviewer": "owner-1", "note": "Yes"})
        with self.assertRaisesRegex(core.HomeOpsError, "unsupported"):
            s.request_side_effect({"plan_id": "p1", "action_id": "a1", "kind": "UNLOCK_DOOR", "summary": "No"})

    def test_plan_binds_evidence_and_quotes(self):
        s = core.HomeOpsStore(); plan = call(s)
        self.assertEqual(plan["evidence_digests"], [s.evidence["hvac-1"][0]["record_digest"]])
        self.assertEqual(plan["quote_digests"], [s.quotes["hvac-1"][0]["record_digest"]])

    def test_event_chain_verifies(self):
        s = core.HomeOpsStore(); call(s)
        self.assertTrue(s.verify_event_chain()["valid"])

    def test_event_chain_detects_tamper(self):
        s = core.HomeOpsStore(); call(s); s.events[1]["body"]["evidence_id"] = "forged"
        out = s.verify_event_chain()
        self.assertFalse(out["valid"]); self.assertEqual(out["failed_seq"], 2)

    def test_duplicate_ids_fail(self):
        s = core.HomeOpsStore(); call(s)
        with self.assertRaises(core.HomeOpsError):
            s.create_issue({"issue_id": "hvac-1", "title": "x", "description": "x", "priority": "LOW"})
        with self.assertRaises(core.HomeOpsError):
            s.add_evidence({"issue_id": "hvac-1", "evidence_id": "e1", "kind": "x", "summary": "x", "source": "x"})

    def test_bool_not_amount(self):
        s = core.HomeOpsStore(); s.create_issue({"issue_id": "x", "title": "x", "description": "x", "priority": "LOW"})
        with self.assertRaisesRegex(core.HomeOpsError, "invalid integer"):
            s.add_quote({"issue_id": "x", "quote_id": "q", "vendor": "v", "amount_cents": True, "currency": "USD", "scope": "s"})

    def test_exact_fields_required(self):
        s = core.HomeOpsStore()
        with self.assertRaisesRegex(core.HomeOpsError, "exact fields"):
            s.create_issue({"issue_id": "x", "title": "x", "description": "x", "priority": "LOW", "extra": 1})

    def test_steps_bounded(self):
        s = core.HomeOpsStore(); s.create_issue({"issue_id": "x", "title": "x", "description": "x", "priority": "LOW"})
        with self.assertRaises(core.HomeOpsError):
            s.propose_plan({"issue_id": "x", "plan_id": "p", "summary": "x", "steps": []})

    def test_get_issue_contains_bound_records(self):
        s = core.HomeOpsStore(); call(s); out = s.get_issue({"issue_id": "hvac-1"})
        self.assertEqual(len(out["evidence"]), 1); self.assertEqual(len(out["quotes"]), 1); self.assertEqual(len(out["plans"]), 1)


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class FreshHandler(mcp_server.MCPHandler):
            app = mcp_server.MCPApplication()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), FreshHandler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.httpd.server_close(); cls.thread.join(timeout=2)

    def request(self, body, headers=None, method="POST", path="/mcp"):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        raw = None if body is None else json.dumps(body).encode()
        hdrs = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        if headers: hdrs.update(headers)
        conn.request(method, path, body=raw, headers=hdrs)
        res = conn.getresponse(); data = res.read(); out_headers = dict(res.getheaders()); conn.close()
        parsed = json.loads(data) if data else None
        return res.status, out_headers, parsed

    def initialize(self, *, ready=True):
        status, headers, body = self.request({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}}})
        session = headers["Mcp-Session-Id"]
        if ready:
            nstatus, _, nbody = self.request({"jsonrpc": "2.0", "method": "notifications/initialized"}, {"Mcp-Session-Id": session})
            self.assertEqual(nstatus, 202); self.assertIsNone(nbody)
        return status, session, body

    def test_initialize_negotiates_exact_version_and_session(self):
        status, session, body = self.initialize()
        self.assertEqual(status, 200); self.assertEqual(body["result"]["protocolVersion"], "2025-11-25"); self.assertTrue(session)

    def test_wrong_protocol_rejected(self):
        status, _, body = self.request({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2026-07-28", "capabilities": {}, "clientInfo": {}}})
        self.assertEqual(status, 400)

    def test_session_required_after_initialize(self):
        status, _, _ = self.request({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        self.assertEqual(status, 404)

    def test_initialized_notification_accepted(self):
        _, session, _ = self.initialize(ready=False)
        status, _, body = self.request({"jsonrpc": "2.0", "method": "notifications/initialized"}, {"Mcp-Session-Id": session})
        self.assertEqual(status, 202); self.assertIsNone(body)

    def test_tools_blocked_until_initialized_notification(self):
        _, session, _ = self.initialize(ready=False)
        status, _, body = self.request({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, {"Mcp-Session-Id": session})
        self.assertEqual(status, 200); self.assertEqual(body["error"]["code"], -32002)

    def test_duplicate_json_key_rejected(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        raw = b'{"jsonrpc":"2.0","id":1,"method":"initialize","method":"ping","params":{}}'
        conn.request("POST", "/mcp", body=raw, headers={"Host": f"127.0.0.1:{self.port}", "Content-Type": "application/json", "Accept": "application/json"})
        res = conn.getresponse(); body = json.loads(res.read()); conn.close()
        self.assertEqual(res.status, 400); self.assertEqual(body["error"]["code"], -32700)

    def test_float_and_nonfinite_json_rejected(self):
        for token in ("1.5", "NaN", "Infinity"):
            with self.subTest(token=token):
                conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
                raw = ('{"jsonrpc":"2.0","id":' + token + ',"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{}}}').encode()
                conn.request("POST", "/mcp", body=raw, headers={"Host": f"127.0.0.1:{self.port}", "Content-Type": "application/json", "Accept": "application/json"})
                res = conn.getresponse(); body = json.loads(res.read()); conn.close()
                self.assertEqual(res.status, 400); self.assertEqual(body["error"]["code"], -32700)

    def test_initialized_method_with_id_rejected(self):
        _, session, _ = self.initialize(ready=False)
        status, _, body = self.request({"jsonrpc": "2.0", "id": 7, "method": "notifications/initialized"}, {"Mcp-Session-Id": session})
        self.assertEqual(status, 200); self.assertEqual(body["error"]["code"], -32600)

    def test_tools_list_is_deterministic(self):
        _, session, _ = self.initialize()
        status, _, body = self.request({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, {"Mcp-Session-Id": session, "MCP-Protocol-Version": "2025-11-25"})
        names = [x["name"] for x in body["result"]["tools"]]
        self.assertEqual(status, 200); self.assertEqual(names, sorted(names)); self.assertIn("homeops.request_side_effect", names)

    def test_tool_error_is_in_band(self):
        _, session, _ = self.initialize()
        status, _, body = self.request({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "homeops.get_issue", "arguments": {"issue_id": "missing"}}}, {"Mcp-Session-Id": session})
        self.assertEqual(status, 200); self.assertTrue(body["result"]["isError"])

    def test_unknown_method_jsonrpc_error(self):
        _, session, _ = self.initialize()
        status, _, body = self.request({"jsonrpc": "2.0", "id": 4, "method": "nope", "params": {}}, {"Mcp-Session-Id": session})
        self.assertEqual(status, 200); self.assertEqual(body["error"]["code"], -32601)

    def test_origin_mismatch_rejected(self):
        status, _, _ = self.request({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {}}}, {"Origin": "https://evil.invalid"})
        self.assertEqual(status, 403)

    def test_protocol_header_mismatch_rejected(self):
        _, session, _ = self.initialize()
        status, _, _ = self.request({"jsonrpc": "2.0", "id": 4, "method": "tools/list", "params": {}}, {"Mcp-Session-Id": session, "MCP-Protocol-Version": "2026-07-28"})
        self.assertEqual(status, 400)

    def test_delete_terminates_session(self):
        _, session, _ = self.initialize()
        status, _, _ = self.request(None, {"Mcp-Session-Id": session}, method="DELETE")
        self.assertEqual(status, 204)
        status, _, _ = self.request({"jsonrpc": "2.0", "id": 5, "method": "tools/list", "params": {}}, {"Mcp-Session-Id": session})
        self.assertEqual(status, 404)

    def test_healthz_denies_execution_authority(self):
        status, _, body = self.request(None, method="GET", path="/healthz")
        self.assertEqual(status, 200); self.assertFalse(body["execution_authority"])

    def test_mcp_get_is_not_sse_emulation(self):
        status, _, _ = self.request(None, method="GET", path="/mcp")
        self.assertEqual(status, 405)


if __name__ == "__main__":
    unittest.main()
