"""Focused regressions for prepared, non-redundant exact-span retrieval."""
from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from agenthon_t4 import agent, house


def task(entities=None):
    return agent.validate_task({
        "task_id": "retrieval-fixture", "cutoff_date": "2026-09-30",
        "interval_level": 0.9, "target_type": "regression",
        "target": {"name": "earnings"}, "prompt": "Forecast earnings",
        "entities": entities or [{"entity_id": "ACME", "name": "Acme"}],
    })


def doc(name, text, *, ticker="ACME", day="2026-09-29"):
    return agent.CorpusDoc(name, day, text, "", ticker, name + ".json")


class RetrievalIndexTests(unittest.TestCase):
    def test_long_sentence_suffix_remains_retrievable_with_exact_unicode_offsets(self):
        text = ("Résumé λ " + "ordinary commentary " * 90
                + "ACME earnings revenue margin guidance forecast consensus estimate "
                + "cash flow debt credit increased to 123 million at the latest update.")
        source = doc("long", text)
        windows = list(agent._evidence_windows(source))
        covered = set()
        for start, end, passage in windows:
            self.assertEqual(text[start:end], passage)
            self.assertLessEqual(len(passage), agent.MAX_SPAN_CHARS)
            covered.update(range(start, end))
        self.assertTrue(all(i in covered for i, char in enumerate(text) if not char.isspace()))
        query = task()
        chosen = agent.retrieve(query, query["entities"][0], [source])
        self.assertIn("increased to 123 million", chosen[0].text)
        self.assertGreater(chosen[0].span_start, agent.MAX_SPAN_CHARS)
        for evidence in chosen:
            self.assertEqual(text[evidence.span_start:evidence.span_end], evidence.text)

    def test_repeated_documents_and_overlapping_tail_do_not_fill_evidence_slots(self):
        repeated = ("ACME earnings revenue margin guidance forecast consensus estimate "
                    "cash flow debt credit increased to 123 million during this reporting period.")
        distinct = ("ACME disclosed a new long-term contract with customer payments beginning "
                    "next quarter and a previously unreported expansion in operating capacity.")
        documents = [doc(str(i), repeated) for i in range(4)] + [doc("distinct", distinct)]
        query = task()
        chosen = agent.retrieve(query, query["entities"][0], documents)
        self.assertEqual(len(chosen), 2)
        self.assertEqual([item.text for item in chosen], [repeated, distinct])
        self.assertEqual(chosen, agent.retrieve(query, query["entities"][0], list(reversed(documents))))
        # The final window is mostly a repeat of the first when a sentence is just >900 chars.
        source = doc("overlap", "ACME earnings " + "x" * 900 + ".")
        chosen = agent.retrieve(query, query["entities"][0], [source])
        self.assertEqual(len(chosen), 1)

    def test_index_respects_each_query_cutoff_and_matches_single_entity_api(self):
        old = doc("old", "ACME reported stable earnings and cash generation from its existing "
                  "operations, with no material change to the prior financial guidance.")
        future = doc("future", "ACME earnings revenue margin guidance forecast consensus estimate "
                     "cash flow debt credit grew to 999 million during the next reporting period.",
                     day="2026-10-01")
        query = task()
        index = agent.RetrievalIndex([old, future])
        chosen = index.retrieve(query, query["entities"][0])
        self.assertEqual([item.doc_id for item in chosen], ["old"])
        self.assertEqual(chosen, agent.retrieve(query, query["entities"][0], [old]))
        earlier = dict(query, cutoff_date="2026-09-01")
        self.assertEqual(index.retrieve(earlier, query["entities"][0])[0].doc_id,
                         "NO_ELIGIBLE_EVIDENCE")
        self.assertEqual(index.retrieve(query, query["entities"][0]), chosen)

    def test_roster_tokenizes_once_per_phase_and_house_uses_identical_evidence(self):
        query = task([{"entity_id": "ACME"}, {"entity_id": "BETA"}, {"entity_id": "GAMMA"}])
        documents = [doc("a", "ACME reported an increase in recurring revenue and operating "
                         "margin while maintaining its previously disclosed earnings guidance."),
                     doc("b", "BETA disclosed stable revenue and higher cash generation from "
                         "its existing contracts with no revision to its quarterly earnings estimate.", ticker="BETA")]
        expected_token_calls = len(documents) + 2 * len(query["entities"])
        with patch.object(agent, "_tokens", wraps=agent._tokens) as tokens:
            answer = agent.build_answer(query, documents)
        self.assertEqual(tokens.call_count, expected_token_calls)
        captured = []

        class Response:
            status = 200
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self, limit):
                return json.dumps({"choices": [{"message": {
                    "content": '{"entity_predictions": []}'}}]}).encode()

        def transport(request, *, timeout):
            captured.append(json.loads(request.data))
            return Response()

        with patch.object(house, "_endpoint", return_value=(
                "https://house.invalid/v1/chat/completions", "test-only-token", "test-only-model")), \
                patch.object(agent, "_tokens", wraps=agent._tokens) as tokens:
            self.assertEqual(house.plan(query, documents, transport=transport), {})
        self.assertEqual(len(captured), 1)
        self.assertEqual(tokens.call_count, expected_token_calls)
        evidence = json.loads(captured[0]["messages"][1]["content"])["evidence"]
        for row in answer["entity_predictions"]:
            self.assertEqual(evidence[row["entity_id"]], [
                {"doc_id": c["doc_id"], "span_start": c["span_start"],
                 "span_end": c["span_end"], "text": c["claim"]}
                for c in row["claims"]])


if __name__ == "__main__":
    unittest.main()
