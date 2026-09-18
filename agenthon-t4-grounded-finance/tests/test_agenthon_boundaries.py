"""Synthetic regression donor for PR #130. Never calls a model/provider."""
from __future__ import annotations

import copy
import json
import math
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from agenthon_t4 import agent, cli, house


def task() -> dict:
    return {
        "task_id": "synthetic-custody-regression", "schema_version": "3",
        "target": {"name": "eps", "type": "regression"},
        "cutoff_date": "2024-03-15", "interval_level": 0.9,
        "entities": [{"entity_id": "SYNTH", "consensus_eps": 1.5}],
    }


DOC = {
    "doc_id": "D1", "doc_date": "2024-02-01", "ticker": "SYNTH",
    "text": "SYNTH original retained evidence reports revenue growth and cash flow of 100 units during this synthetic quarter.",
}


def fixture(root: Path, value: dict | None = None) -> tuple[Path, Path]:
    task_path = root / "task.json"
    corpus = root / "corpus"
    corpus.mkdir()
    task_path.write_text(json.dumps(value if value is not None else task()), encoding="utf-8")
    (corpus / "D1.json").write_text(json.dumps(DOC), encoding="utf-8")
    return task_path, corpus


class AgenthonBoundaryTests(unittest.TestCase):
    def test_task_json_rejects_nonfinite_constants_and_float_overflow(self) -> None:
        for token in ("NaN", "Infinity", "-Infinity", "1e400"):
            with self.subTest(token=token), tempfile.TemporaryDirectory() as td:
                path = Path(td) / "bad.json"
                path.write_text('{"value":' + token + '}', encoding="utf-8")
                with self.assertRaises(agent.ContractError):
                    agent.load_json(path)

    def test_huge_interval_level_is_controlled_contract_error(self) -> None:
        value = task()
        value["interval_level"] = 10 ** 400
        with self.assertRaises(agent.ContractError):
            agent.validate_task(value)

    def test_finite_extreme_anchor_never_publishes_nonfinite_interval(self) -> None:
        for anchor in (1.7e308, -1.7e308):
            with self.subTest(anchor=anchor), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                value = task()
                value["entities"][0]["consensus_eps"] = anchor
                task_path, corpus = fixture(root, value)
                out = root / "answer.json"
                try:
                    answer = agent.run(task_path, corpus, out)
                except agent.ContractError:
                    self.assertFalse(out.exists(), "controlled rejection must not publish")
                    continue
                row = answer["entity_predictions"][0]
                for number in (row["point_forecast"], row["interval"]["lo"], row["interval"]["hi"]):
                    self.assertTrue(math.isfinite(number))
                json.dumps(answer, allow_nan=False)

    def test_huge_anchor_is_finite_or_controlled_not_overflowerror(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            value = task()
            value["entities"][0]["consensus_eps"] = 10 ** 400
            task_path, corpus = fixture(root, value)
            out = root / "answer.json"
            try:
                answer = agent.run(task_path, corpus, out)
            except agent.ContractError:
                self.assertFalse(out.exists())
            else:
                json.dumps(answer, allow_nan=False)

    def test_invalid_huge_model_number_falls_back(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            task_path, corpus = fixture(root)
            model = {"SYNTH": {"entity_id": "SYNTH", "point_forecast": 10 ** 400, "lo": 1, "hi": 2}}
            answer = agent.run(task_path, corpus, root / "answer.json", model_candidates=model)
            self.assertEqual(answer["entity_predictions"][0]["point_forecast"], 1.5)

    def test_model_parser_rejects_duplicate_root_and_row_keys(self) -> None:
        examples = [
            '{"entity_predictions":[],"entity_predictions":[{"entity_id":"SYNTH"}]}',
            '{"entity_predictions":[{"entity_id":"SYNTH","point_forecast":1,"point_forecast":9}]}',
        ]
        for text in examples:
            with self.subTest(text=text):
                self.assertIsNone(house._parse_content(text))

    def test_model_parser_rejects_nonfinite_numbers(self) -> None:
        for token in ("NaN", "Infinity", "-Infinity", "1e400"):
            with self.subTest(token=token):
                text = '{"entity_predictions":[{"entity_id":"SYNTH","point_forecast":' + token + '}]}'
                self.assertIsNone(house._parse_content(text))

    def test_model_parser_deep_json_falls_back_without_recursionerror(self) -> None:
        text = '{"entity_predictions":[],"extra":' + '[' * 2000 + '0' + ']' * 2000 + '}'
        self.assertIsNone(house._parse_content(text))

    def test_writer_rejects_nonfinite_without_replacing_existing_output(self) -> None:
        for value in (float("nan"), float("inf"), -float("inf")):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as td:
                out = Path(td) / "answer.json"
                out.write_text("retained-output", encoding="utf-8")
                with self.assertRaises((agent.ContractError, ValueError)):
                    agent.atomic_write_json(out, {"value": value})
                self.assertEqual(out.read_text(encoding="utf-8"), "retained-output")

    def test_cli_uses_same_evidence_generation_for_model_and_final_claims(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            task_path, corpus = fixture(root)
            out = root / "answer.json"
            planner_saw: list[str] = []

            def replace_after_read(validated: dict, docs: list) -> dict:
                planner_saw.extend(doc.text for doc in docs)
                replacement = copy.deepcopy(DOC)
                replacement["text"] = "SYNTH replacement evidence reports cash flow of 999 units, unavailable to the earlier planner and its forecast."
                (corpus / "D1.json").write_text(json.dumps(replacement), encoding="utf-8")
                return {"SYNTH": {"entity_id": "SYNTH", "point_forecast": 123, "lo": 122, "hi": 124}}

            argv = ["test", "analyze", "--task", str(task_path), "--corpus", str(corpus), "--out", str(out)]
            with patch.object(cli, "plan", replace_after_read), patch.object(sys, "argv", argv):
                self.assertEqual(cli.main(), 0)
            self.assertEqual(planner_saw, [DOC["text"]])
            answer = json.loads(out.read_text(encoding="utf-8"))
            row = answer["entity_predictions"][0]
            self.assertEqual(row["point_forecast"], 123)
            for claim in row["claims"]:
                self.assertEqual(claim["claim"], DOC["text"][claim["span_start"]:claim["span_end"]])

    def test_model_parser_keeps_valid_fenced_json(self) -> None:
        value = '```json\n{"entity_predictions":[{"entity_id":"SYNTH","point_forecast":1.5,"lo":1,"hi":2}]}\n```'
        self.assertEqual(house._parse_content(value)["SYNTH"]["point_forecast"], 1.5)

    def test_normal_fallback_keeps_exact_claims_and_finite_interval(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            task_path, corpus = fixture(root)
            answer = agent.run(task_path, corpus, root / "answer.json")
            row = answer["entity_predictions"][0]
            self.assertEqual(row["point_forecast"], 1.5)
            self.assertLessEqual(row["interval"]["lo"], row["interval"]["hi"])
            json.dumps(answer, allow_nan=False)
            for claim in row["claims"]:
                self.assertEqual(claim["claim"], DOC["text"][claim["span_start"]:claim["span_end"]])

    def test_house_transport_uses_no_redirect_handler_and_bounded_read(self) -> None:
        observed_sizes: list[int] = []

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, size=-1):
                observed_sizes.append(size)
                return b'{"choices":[{"message":{"content":"{\\\"entity_predictions\\\":[]}"}}]}'

        class Opener:
            def open(self, _request, timeout=None):
                self.timeout = timeout
                return Response()

        validated = agent.validate_task(task())
        docs = [agent.CorpusDoc("D1", DOC["doc_date"], DOC["text"], "", DOC["ticker"], "D1.json")]
        with patch.dict(
            os.environ,
            {"MODEL_ENDPOINT": "https://organizer.invalid", "MODEL_TOKEN": "token", "MODEL_NAME": "house"},
            clear=True,
        ), patch.object(house.urllib.request, "build_opener", return_value=Opener()) as built:
            result = house.plan(validated, docs)
        self.assertEqual(result, {})
        self.assertEqual(observed_sizes, [house.MAX_HOUSE_RESPONSE_BYTES + 1])
        self.assertIsInstance(built.call_args.args[0], house._NoRedirect)

    def test_house_transport_rejects_oversized_response_and_redirects(self) -> None:
        class OversizedResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, size=-1):
                self.size = size
                return b"x" * (house.MAX_HOUSE_RESPONSE_BYTES + 1)

        class Opener:
            def open(self, _request, timeout=None):
                return OversizedResponse()

        validated = agent.validate_task(task())
        docs = [agent.CorpusDoc("D1", DOC["doc_date"], DOC["text"], "", DOC["ticker"], "D1.json")]
        with patch.dict(
            os.environ,
            {"MODEL_ENDPOINT": "https://organizer.invalid", "MODEL_TOKEN": "token", "MODEL_NAME": "house"},
            clear=True,
        ), patch.object(house.urllib.request, "build_opener", return_value=Opener()):
            self.assertIsNone(house.plan(validated, docs))
        self.assertIsNone(house._NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://other.invalid"))

    def test_house_endpoint_rejects_non_https_and_embedded_credentials(self) -> None:
        for endpoint in ("http://organizer.invalid", "https://user:pass@organizer.invalid", "https://organizer.invalid?x=1"):
            with self.subTest(endpoint=endpoint), patch.dict(
                os.environ,
                {"MODEL_ENDPOINT": endpoint, "MODEL_TOKEN": "token", "MODEL_NAME": "house"},
                clear=True,
            ):
                self.assertIsNone(house._endpoint())


if __name__ == "__main__":
    unittest.main(verbosity=2)
