"""Source-handler concurrency checks: controlled waits, no sockets or providers."""
import copy
import io
import json
import sys
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class SessionIsolation(unittest.TestCase):
    def setUp(self):
        self.threads = []
        self.release = threading.Event()
        self.provider_entered = threading.Event()
        self.errors = []
        self.fixture_patch = patch.object(server, "FIXTURE", False)
        self.fixture_patch.start()
        self.addCleanup(self.fixture_patch.stop)
        self.addCleanup(self.finish)
        self.buyers = []
        self.item = server.CATALOG_BY_SKU["trail-repair"]

    def finish(self):
        self.release.set()
        for thread in self.threads:
            thread.join(3)
        with server.LOCK:
            for sid, _ in self.buyers:
                server.SESSIONS.pop(sid, None)
                if hasattr(server, "SESSION_LOCKS"):
                    server.SESSION_LOCKS.pop(sid, None)
        self.assertFalse(any(t.is_alive() for t in self.threads))
        self.assertEqual(self.errors, [])

    def buyer(self):
        handler = SimpleNamespace(headers={})
        state = server.session_for(handler)
        result = handler.session_id, state
        self.buyers.append(result)
        return result

    def request(self, buyer, route="/api/state", body=None):
        sid, state = buyer
        handler = object.__new__(server.Handler)
        handler.path = route
        handler.headers = {"Cookie": "cw=" + sid}
        result = []
        handler.json_out = lambda status, data: result.append((status, copy.deepcopy(data)))
        handler.redirect = lambda destination: result.append((303, destination))
        if body is None:
            handler.do_GET()
        else:
            raw = json.dumps(body).encode()
            handler.headers.update({
                "Origin": server.ORIGIN, "X-CSRF": state["csrf"],
                "Content-Type": "application/json", "Content-Length": str(len(raw)),
            })
            handler.rfile = io.BytesIO(raw)
            handler.do_POST()
        return result[0]

    def background(self, fn):
        done = threading.Event()
        outcome = []
        def run():
            try:
                outcome.append(fn())
            except BaseException as error:
                self.errors.append(repr(error))
            finally:
                done.set()
        thread = threading.Thread(target=run, daemon=True)
        self.threads.append(thread)
        thread.start()
        return done, outcome

    def pause_provider(self):
        self.provider_entered.set()
        if not self.release.wait(3):
            raise AssertionError("test did not release controlled provider")

    def plan(self, buyer):
        return self.request(buyer, "/api/plan", {
            "prompt": "A trail repair kit for outdoor trips", "budget": "60",
        })

    def consent(self, buyer):
        state = buyer[1]
        return {
            "approved": True, "generation": state["generation"],
            "revision": state["revision"], "sku": self.item["sku"],
            "usd": server.money(self.item["cents"]),
        }

    def test_slow_ai_does_not_block_other_buyer_or_new_session(self):
        buyer_a, buyer_b = self.buyer(), self.buyer()
        def selection(prompt, budget, affordable):
            if threading.current_thread() is not threading.main_thread():
                self.pause_provider()
            return self.item, self.item["why"], "ai-model"
        with patch.object(server, "ai_selection", side_effect=selection):
            done_a, result_a = self.background(lambda: self.plan(buyer_a))
            self.assertTrue(self.provider_entered.wait(1))
            # Real do_GET plus real session_for must progress before A resumes.
            done_b, result_b = self.background(lambda: (
                self.request(buyer_b), self.request(self.buyer())))
            self.assertTrue(done_b.wait(1), "unrelated sessions blocked by buyer A")
            self.assertEqual([row[0] for row in result_b[0]], [200, 200])
            self.assertEqual(self.plan(buyer_b)[0], 200)
            self.assertFalse(done_a.is_set())
            self.release.set()
            self.assertTrue(done_a.wait(1))
            self.assertEqual(result_a[0][1]["phase"], "planned")

    def test_same_buyer_duplicate_order_and_stale_reset_wait(self):
        buyer_a, buyer_b = self.buyer(), self.buyer()
        with patch.object(server, "ai_selection",
                          return_value=(self.item, self.item["why"], "ai-model")):
            self.assertEqual(self.plan(buyer_a)[0], 200)
        consent = self.consent(buyer_a)
        reset = {k: consent[k] for k in ("generation", "revision")}
        calls = []
        def paypal(endpoint, *, method, payload, request_id):
            calls.append(request_id)
            self.pause_provider()
            return {"id": "TESTORDER123", "links": [{
                "rel": "approve",
                "href": "https://www.sandbox.paypal.com/checkoutnow",
            }]}
        with patch.object(server, "paypal", side_effect=paypal):
            first_done, first = self.background(
                lambda: self.request(buyer_a, "/api/order", consent))
            self.assertTrue(self.provider_entered.wait(1))
            duplicate_done, duplicate = self.background(
                lambda: self.request(buyer_a, "/api/order", consent))
            reset_done, reset_result = self.background(
                lambda: self.request(buyer_a, "/api/reset", reset))
            read_done, read_result = self.background(lambda: self.request(buyer_a))
            other_done, other = self.background(lambda: self.request(buyer_b))
            self.assertTrue(other_done.wait(1))
            self.assertEqual(other[0][0], 200)
            self.assertFalse(duplicate_done.wait(0.05))
            self.assertFalse(reset_done.is_set())
            self.assertFalse(read_done.is_set())
            self.release.set()
            for done in (first_done, duplicate_done, reset_done, read_done):
                self.assertTrue(done.wait(1))
            self.assertEqual(len(calls), 1, "duplicate created a second provider order")
            self.assertEqual(first[0][0], 200)
            self.assertEqual(duplicate[0][1]["order_id"], "TESTORDER123")
            self.assertEqual(reset_result[0][0], 409)
            self.assertEqual(read_result[0][1]["phase"], "approval_pending")
            self.assertEqual(buyer_a[1]["revision"], consent["revision"] + 1)

    def test_failed_provider_releases_lock_and_reset_preserves_it(self):
        buyer = self.buyer()
        sid, state = buyer
        before = SimpleNamespace(headers={"Cookie": "cw=" + sid})
        server.session_for(before)
        original_lock = before.session_lock
        with patch.object(server, "ai_selection",
                          side_effect=server.ServiceError(502, "Controlled provider failure")):
            self.assertEqual(self.plan(buyer)[0], 502)
        self.assertEqual(self.request(buyer)[1]["phase"], "idle")
        self.assertEqual(self.request(buyer, "/api/reset", {
            "generation": state["generation"], "revision": state["revision"],
        })[0], 200)
        after = SimpleNamespace(headers={"Cookie": "cw=" + sid})
        self.assertIs(server.session_for(after), state)
        self.assertIs(after.session_lock, original_lock)
        with patch.object(server, "ai_selection",
                          return_value=(self.item, self.item["why"], "ai-model")):
            self.assertEqual(self.plan(buyer)[0], 200)


if __name__ == "__main__":
    unittest.main()

