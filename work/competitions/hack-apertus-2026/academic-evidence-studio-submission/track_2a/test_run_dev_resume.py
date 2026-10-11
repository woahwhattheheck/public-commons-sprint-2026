"""Focused offline checks for the development execution change only."""
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import main as solution
import run_dev


class ResumeExecution(unittest.TestCase):
    def test_successful_cases_survive_failure_and_are_not_requested_again(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            root = Path(directory)
            cases = [{"id": name, "vote": "vote", "claim": {"text": "claim", "language": "de"},
                      "reference": {"text": "source", "language": "fr"}} for name in ("a", "b", "c")]
            source, output, checkpoint = root / "cases.jsonl", root / "output.jsonl", root / "checkpoint"
            source.write_text("".join(json.dumps(row) + "\n" for row in cases))
            output.write_text("previous complete output\n")
            calls = []
            def predict(case, *_):
                calls.append(case["id"])
                if case["id"] == "b" and calls == ["a", "b"]:
                    raise RuntimeError("provider temporarily unavailable")
                return {"id": case["id"], "label": 1, "evidence": [], "metrics": {}}
            with patch.object(solution, "predict_case", side_effect=predict):
                with self.assertRaisesRegex(RuntimeError, "provider temporarily"):
                    run_dev.run(source, output, checkpoint, "full", 120000)
                self.assertEqual(output.read_text(), "previous complete output\n")
                self.assertEqual(json.loads((checkpoint / "predictions.partial.jsonl").read_text())["id"], "a")
                run_dev.run(source, output, checkpoint, "full", 120000)
                self.assertEqual(calls, ["a", "b", "b", "c"])
                self.assertEqual([json.loads(row)["id"] for row in output.read_text().splitlines()], ["a", "b", "c"])
                run_dev.run(source, output, checkpoint, "full", 120000)
                self.assertEqual(len(calls), 4)
                with self.assertRaisesRegex(ValueError, "configuration differs"):
                    run_dev.run(source, output, checkpoint, "selected", 120000)
                source.write_text(source.read_text().replace('"claim"', '"new claim"', 1))
                with self.assertRaises(ValueError):
                    run_dev.run(source, output, checkpoint, "full", 120000)

    def test_lowercase_provider_model_is_preserved_and_old_family_rejected(self):
        response = {"choices": [{"message": {"content": '{"label":1,"evidence":[]}'}}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5}}
        with patch.dict(os.environ, {"BASE_URL": "https://api.publicai.co/v1", "API_KEY": "test-only",
                                     "MODEL_NAME": "swiss-ai/apertus-v1.5-8b"}, clear=True):
            with patch.object(solution.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(response).encode())) as transport:
                solution.invoke_apertus({"claim": {"text": "x", "language": "de"}, "reference": {"language": "fr"}}, "B", "source")
                sent = json.loads(transport.call_args.args[0].data)
                self.assertEqual(sent["model"], "swiss-ai/apertus-v1.5-8b")
            os.environ["MODEL_NAME"] = "swiss-ai/apertus-v1.0-8b"
            with patch.object(solution.urllib.request, "urlopen") as transport:
                with self.assertRaisesRegex(RuntimeError, "v1.5"):
                    solution.invoke_apertus({}, "B", "source")
                transport.assert_not_called()


if __name__ == "__main__":
    unittest.main()
