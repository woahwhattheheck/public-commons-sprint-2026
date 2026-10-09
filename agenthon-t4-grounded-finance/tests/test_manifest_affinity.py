"""Focused regression: unit-root manifest controls cross-entity citations."""
import json
import tempfile
import unittest
from pathlib import Path
from agenthon_t4 import agent

class ManifestAffinityTest(unittest.TestCase):
    def test_manifest_restricts_each_entity_and_ignores_undeclared(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            corpus = root / "corpus"
            corpus.mkdir()
            task = {
                "task_id": "affinity", "target_type": "regression",
                "target": {"name": "earnings"}, "cutoff_date": "2024-10-10",
                "interval_level": 0.9,
                "entities": [{"entity_id": eid} for eid in ("ALPHA", "BETA", "OTHER")],
            }
            (root / "task.json").write_text(json.dumps(task))
            docs = {
                "alpha": ("BETA", "ALPHA"),
                "beta": ("ALPHA", "BETA"),
                "hidden": ("OTHER", "OTHER"),
            }
            for name, (ticker, subject) in docs.items():
                (corpus / (name + ".json")).write_text(json.dumps({
                    "doc_date": "2024-10-01", "ticker": ticker,
                    "text": subject + " disclosed revenue and operating margin in its quarterly filing.",
                }))
            (root / "manifest.json").write_text(json.dumps({
                "manifest_version": "2.0",
                "files": [
                    {"path": "corpus/alpha.json", "role": "corpus", "entity_ids": ["ALPHA"]},
                    {"path": "corpus/beta.json", "role": "corpus", "entity_ids": ["BETA"]},
                ],
            }))
            answer = agent.run(root / "task.json", corpus, root / "answer.json")
            cited = {
                row["entity_id"]: {claim["doc_id"] for claim in row["claims"]}
                for row in answer["entity_predictions"]
            }
            self.assertEqual(cited, {"ALPHA": {"alpha"}, "BETA": {"beta"}, "OTHER": set()})
            self.assertEqual([row["entity_id"] for row in answer["entity_predictions"]],
                             ["ALPHA", "BETA", "OTHER"])

if __name__ == "__main__":
    unittest.main()
