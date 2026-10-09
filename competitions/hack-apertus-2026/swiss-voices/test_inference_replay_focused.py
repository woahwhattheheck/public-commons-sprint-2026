#!/usr/bin/env python3
"""Focused synthetic-only Swiss Voices inference-replay quota regression."""
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

import app


class InferenceReplayFocused(unittest.TestCase):
    def test_reuse_inflight_failure_retry_and_model_change(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            app, "DB", Path(directory) / "cases.json"
        ):
            def approved(label):
                item = app.submit_case({
                    "locale": "fr-CH", "source_kind": "synthetic",
                    "prompt": "Synthetic " + label, "context": "offline fixture",
                    "attribution": "synthetic creator", "human_attested": False,
                })
                app.approve_case({
                    "id": item["id"], "reviewer": "Human approver",
                    "reference": "Synthetic reference",
                })
                return item["id"]

            one = approved("repeat")
            provider = Mock(return_value="fictional answer")
            with patch.object(app, "call_apertus", provider):
                a = app.generate({"id": one})
                b = app.generate({"id": one})
                self.assertEqual(a, b)
                self.assertEqual(provider.call_count, 1)
                self.assertEqual(len(app.load()["cases"][0]["runs"]), 1)
                with patch.object(app, "MODEL", "offline-other-model"):
                    other = app.generate({"id": one})
                self.assertNotEqual(a["id"], other["id"])
                self.assertEqual(provider.call_count, 2)

            two = approved("simultaneous")
            started = threading.Event()
            release = threading.Event()
            completed = []

            def blocking_provider(_):
                started.set()
                if not release.wait(3):
                    raise RuntimeError("synthetic wait timed out")
                return "blocking fictional answer"

            with patch.object(app, "call_apertus", side_effect=blocking_provider) as provider:
                worker = threading.Thread(target=lambda: completed.append(app.generate({"id": two})))
                worker.start()
                try:
                    self.assertTrue(started.wait(2))
                    with self.assertRaisesRegex(ValueError, "already in progress"):
                        app.generate({"id": two})
                finally:
                    release.set()
                    worker.join(timeout=3)
                self.assertFalse(worker.is_alive())
                self.assertEqual(len(completed), 1)
                self.assertEqual(provider.call_count, 1)
                self.assertEqual(app.generate({"id": two}), completed[0])
                self.assertEqual(provider.call_count, 1)

            three = approved("failure")
            with patch.object(app, "call_apertus", side_effect=[
                RuntimeError("simulated provider failure"), "retry succeeded"
            ]) as provider:
                with self.assertRaisesRegex(RuntimeError, "simulated provider failure"):
                    app.generate({"id": three})
                self.assertEqual(app.generate({"id": three})["answer"], "retry succeeded")
                self.assertEqual(provider.call_count, 2)
            self.assertFalse(app.INFLIGHT)


if __name__ == "__main__":
    unittest.main()
