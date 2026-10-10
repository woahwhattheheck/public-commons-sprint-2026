"""Focused checkout revision contract, exercising the shipped handler functions."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler, record, session_for, summarize


class CheckoutRevision(unittest.TestCase):
    def test_mutations_reset_and_duplicate_reply(self):
        handler = SimpleNamespace(headers={"Cookie": ""})
        state = session_for(handler)
        original = summarize(state)
        self.assertIsInstance(original["generation"], str)
        self.assertTrue(original["generation"])
        self.assertEqual(original["revision"], 0)

        state["phase"] = "planned"
        record(state, "plan", "synthetic no-provider plan")
        planned = summarize(state)
        state["phase"] = "fixture_completed"
        record(state, "fixture-capture", "synthetic no-provider completion")
        completed = summarize(state)
        self.assertEqual([original["revision"], planned["revision"], completed["revision"]], [0, 1, 2])
        self.assertEqual({original["generation"], planned["generation"], completed["generation"]},
                         {original["generation"]})
        self.assertEqual(Handler.action(None, "/api/capture", {"confirmed": True}, state)["revision"], 2)

        reset = Handler.action(None, "/api/reset", {
            "generation": completed["generation"],
            "revision": completed["revision"],
        }, state)
        self.assertEqual(reset["phase"], "idle")
        self.assertEqual(reset["revision"], 3)
        self.assertEqual(reset["generation"], original["generation"])
        self.assertEqual(reset["audit"], [])
        self.assertEqual(reset["csrf"], original["csrf"])
        self.assertNotEqual(reset["revision"], original["revision"])


if __name__ == "__main__":
    unittest.main()

