from __future__ import annotations

import json
import math
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from agenthon_t4 import agent, house


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")


def base_task(*, target_type: str = "classification") -> dict:
    target = {"name": "eps_outcome", "type": target_type}
    if target_type == "classification":
        target["labels"] = ["beat", "miss", "inline"]
    return {
        "task_id": "public-fixture",
        "schema_version": "3",
        "target": target,
        "prompt": "Predict the finance outcome from the frozen evidence corpus.",
        "cutoff_date": "2024-03-15",
        "interval_level": 0.90,
        "entities": [{"entity_id": "AAPL", "name": "Apple Inc.", "sector": "Information Technology", "consensus_eps": 1.50}],
    }


def docs() -> list[dict]:
    return [
        {"doc_id": "D1", "doc_date": "2024-02-01", "ticker": "AAPL", "title": "Quarterly update", "text": "Apple reported diluted earnings per share of $2.18. Management guided second-quarter gross margin between 46 and 47 percent. Services revenue is expected to grow double digits."},
        {"doc_id": "D2", "doc_date": "2024-03-01", "ticker": "AAPL", "title": "Pre-cutoff note", "text": "Apple consensus expectations remained stable before the cutoff date."},
    ]


class AgenthonT4Tests(unittest.TestCase):
    def make_unit(self, root: Path, *, task: dict | None = None, corpus: list[dict] | None = None) -> tuple[Path, Path]:
        task_path = root / "task.json"
        corpus_dir = root / "corpus"
        corpus_dir.mkdir()
        write_json(task_path, task or base_task())
        for doc in corpus or docs():
            write_json(corpus_dir / f"{doc['doc_id']}.json", doc)
        return task_path, corpus_dir

    def test_offline_answer_is_deterministic_and_exact_span_bound(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            task_path, corpus_dir = self.make_unit(root)
            a = agent.run(task_path, corpus_dir, root / "a.json")
            b = agent.run(task_path, corpus_dir, root / "b.json")
            self.assertEqual(a, b)
            self.assertEqual((root / "a.json").read_bytes(), (root / "b.json").read_bytes())
            self.assertEqual(a["target_type"], "classification")
            row = a["entity_predictions"][0]
            self.assertIn(row["label"], {"beat", "miss", "inline"})
            self.assertEqual(row["interval"]["level"], 0.90)
            corpus_by_id = {d["doc_id"]: d for d in docs()}
            for claim in row["claims"]:
                source = corpus_by_id[claim["doc_id"]]["text"]
                self.assertEqual(claim["claim"], source[claim["span_start"]:claim["span_end"]])

    def test_post_cutoff_document_is_never_cited(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            corpus = docs() + [{"doc_id": "FUTURE", "doc_date": "2024-04-01", "ticker": "AAPL", "title": "Future result", "text": "Apple definitively reported the future resolved EPS outcome."}]
            task_path, corpus_dir = self.make_unit(root, corpus=corpus)
            out = agent.run(task_path, corpus_dir, root / "answer.json")
            self.assertNotIn("FUTURE", {c["doc_id"] for c in out["entity_predictions"][0]["claims"]})

    def test_no_eligible_document_never_cites_future_and_still_writes(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            task_path, corpus_dir = self.make_unit(root, corpus=[{"doc_id": "FUTURE", "doc_date": "2024-04-01", "ticker": "AAPL", "title": "Future result", "text": "Post-cutoff only."}])
            out = agent.run(task_path, corpus_dir, root / "answer.json")
            claim = out["entity_predictions"][0]["claims"][0]
            self.assertEqual(claim["doc_id"], "NO_ELIGIBLE_EVIDENCE")
            self.assertNotEqual(claim["doc_id"], "FUTURE")
            self.assertTrue((root / "answer.json").is_file())


    def test_manifest_index_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            task_path, corpus_dir = self.make_unit(root)
            # This is intentionally not document-shaped; loading it as a corpus document would fail.
            write_json(corpus_dir / "manifest.json", {"manifest_version": "2.0", "files": []})
            out = agent.run(task_path, corpus_dir, root / "answer.json")
            cited = {c["doc_id"] for c in out["entity_predictions"][0]["claims"]}
            self.assertNotIn("manifest", cited)

    def test_spans_fallback_joins_with_single_spaces_and_preserves_offsets(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            corpus = [{
                "doc_id": "SPAN_DOC",
                "doc_date": "2024-02-01",
                "ticker": "AAPL",
                "title": "Span representation",
                "spans": [
                    {"text": "Apple reported diluted earnings per share of $2.18."},
                    {"text": "Management guided gross margin between 46 and 47 percent."},
                ],
            }]
            task_path, corpus_dir = self.make_unit(root, corpus=corpus)
            out = agent.run(task_path, corpus_dir, root / "answer.json")
            resolved = "Apple reported diluted earnings per share of $2.18. Management guided gross margin between 46 and 47 percent."
            for claim in out["entity_predictions"][0]["claims"]:
                self.assertEqual(claim["doc_id"], "SPAN_DOC")
                self.assertEqual(claim["claim"], resolved[claim["span_start"]:claim["span_end"]])

    def test_duplicate_entity_and_document_ids_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            task = base_task()
            task["entities"].append(dict(task["entities"][0]))
            task_path, corpus_dir = self.make_unit(root, task=task)
            with self.assertRaisesRegex(agent.ContractError, "duplicate entity_id"):
                agent.run(task_path, corpus_dir, root / "answer.json")
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            task_path, corpus_dir = self.make_unit(root)
            original = corpus_dir / "D1.json"
            aliased = corpus_dir / "AUTHORITATIVE_STEM.json"
            aliased.write_bytes(original.read_bytes())
            original.unlink()
            out = agent.run(task_path, corpus_dir, root / "answer.json")
            cited = {c["doc_id"] for c in out["entity_predictions"][0]["claims"]}
            self.assertIn("AUTHORITATIVE_STEM", cited)
            self.assertNotIn("D1", cited)

    def test_duplicate_json_key_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "bad.json"
            p.write_text('{"task_id":"a","task_id":"b"}', encoding="utf-8")
            with self.assertRaisesRegex(agent.ContractError, "duplicate JSON key"):
                agent.load_json(p)

    def test_regression_and_ranking_emit_finite_ordered_intervals_without_labels(self) -> None:
        for target_type in ("regression", "ranking"):
            with self.subTest(target_type=target_type), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                task_path, corpus_dir = self.make_unit(root, task=base_task(target_type=target_type))
                out = agent.run(task_path, corpus_dir, root / "answer.json")
                row = out["entity_predictions"][0]
                self.assertNotIn("label", row)
                self.assertTrue(math.isfinite(row["point_forecast"]))
                self.assertLessEqual(row["interval"]["lo"], row["interval"]["hi"])

    def test_contract_valid_model_candidate_overrides_prediction_not_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            task_path, corpus_dir = self.make_unit(root)
            model = {"AAPL": {"entity_id": "AAPL", "label": "beat", "point_forecast": 1.77, "lo": 1.50, "hi": 1.90, "claims": [{"doc_id": "FAKE", "span_start": 0, "span_end": 4}]}}
            out = agent.run(task_path, corpus_dir, root / "answer.json", model_candidates=model)
            row = out["entity_predictions"][0]
            self.assertEqual((row["label"], row["point_forecast"]), ("beat", 1.77))
            self.assertNotIn("FAKE", {c["doc_id"] for c in row["claims"]})

    def test_invalid_model_candidate_falls_back(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            task_path, corpus_dir = self.make_unit(root)
            model = {"AAPL": {"entity_id": "AAPL", "label": "invented", "point_forecast": float("nan"), "lo": 2, "hi": 1}}
            out = agent.run(task_path, corpus_dir, root / "answer.json", model_candidates=model)
            row = out["entity_predictions"][0]
            self.assertEqual(row["label"], "inline")
            self.assertEqual(row["point_forecast"], 1.50)

    def test_house_parser_accepts_json_fence_and_rejects_duplicate_entities(self) -> None:
        good = '```json\n{"entity_predictions":[{"entity_id":"AAPL","label":"beat","point_forecast":1.7,"lo":1.5,"hi":1.9}]}\n```'
        self.assertEqual(house._parse_content(good)["AAPL"]["label"], "beat")
        bad = '{"entity_predictions":[{"entity_id":"AAPL"},{"entity_id":"AAPL"}]}'
        self.assertIsNone(house._parse_content(bad))

    def test_house_plan_is_disabled_without_all_organizer_environment_fields(self) -> None:
        task = agent.validate_task(base_task())
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _, corpus_dir = self.make_unit(root)
            eligible = agent.load_corpus(corpus_dir, task["cutoff_date"])
            with patch.dict(os.environ, {}, clear=True):
                self.assertIsNone(house.plan(task, eligible))

    def test_corpus_symlink_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            task_path, corpus_dir = self.make_unit(root)
            try:
                (corpus_dir / "99.json").symlink_to(corpus_dir / "D1.json")
            except (OSError, NotImplementedError):
                self.skipTest("symlink unavailable")
            with self.assertRaisesRegex(agent.ContractError, "symlink corpus file refused"):
                agent.run(task_path, corpus_dir, root / "answer.json")

    def test_output_symlink_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            task_path, corpus_dir = self.make_unit(root)
            victim = root / "victim.json"
            victim.write_text("do-not-touch", encoding="utf-8")
            out = root / "answer.json"
            try:
                out.symlink_to(victim)
            except (OSError, NotImplementedError):
                self.skipTest("symlink unavailable")
            with self.assertRaisesRegex(agent.ContractError, "output symlink refused"):
                agent.run(task_path, corpus_dir, out)
            self.assertEqual(victim.read_text(encoding="utf-8"), "do-not-touch")


if __name__ == "__main__":
    unittest.main(verbosity=2)
