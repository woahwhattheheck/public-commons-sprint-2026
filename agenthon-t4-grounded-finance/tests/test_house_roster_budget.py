"""Focused synthetic contract for Track 4 House roster budgeting."""
from __future__ import annotations

import json
import os
import unittest
import urllib.error
from unittest.mock import patch

from agenthon_t4 import agent, house


def task_with_roster(count: int) -> dict:
    return agent.validate_task({
        "task_id": "synthetic-roster",
        "target": {"name": "eps", "type": "regression"},
        "cutoff_date": "2024-03-15",
        "interval_level": 0.90,
        "entities": [{"entity_id": f"ENTITY{i:03d}"} for i in range(count)],
    })


class FakeResponse:
    status = 200

    def __init__(self, rows: list[dict]):
        model_body = json.dumps({"entity_predictions": rows})
        self.body = json.dumps({
            "choices": [{"message": {"content": model_body}}],
        }).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, size: int) -> bytes:
        if size < 0:
            raise AssertionError("model response must be byte bounded")
        return self.body[:size]


class HouseRosterBudgetTests(unittest.TestCase):
    @staticmethod
    def fake_transport(calls: list[list[str]], fail_at: int = -1):
        def transport(request, *, timeout: float):
            assert timeout > 0
            payload = json.loads(request.data.decode("utf-8"))
            subset = json.loads(payload["messages"][1]["content"])["entities"]
            ids = [row["entity_id"] for row in subset]
            calls.append(ids)
            assert payload["max_tokens"] <= 4000
            assert len(ids) <= house.MAX_ENTITIES_PER_HOUSE_REQUEST
            if len(calls) == fail_at:
                raise urllib.error.URLError("synthetic quota failure")
            return FakeResponse([{
                "entity_id": eid, "label": None, "point_forecast": 1.0,
                "lo": 0.8, "hi": 1.2,
            } for eid in ids])
        return transport

    def setUp(self):
        self.env = patch.dict(os.environ, {
            "MODEL_ENDPOINT": "http://model:8443",
            "MODEL_TOKEN": "synthetic-unit-token",
            "MODEL_NAME": "organizer-test",
        })
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_large_roster_is_partitioned_without_repeating_entities(self):
        calls: list[list[str]] = []
        outcome = house.plan(task_with_roster(21), [], transport=self.fake_transport(calls))
        self.assertEqual([len(batch) for batch in calls], [10, 10, 1])
        self.assertEqual(len(outcome or {}), 21)
        self.assertEqual([eid for batch in calls for eid in batch], [f"ENTITY{i:03d}" for i in range(21)])

    def test_failure_keeps_prior_chunk_and_does_not_retry(self):
        calls: list[list[str]] = []
        outcome = house.plan(task_with_roster(21), [], transport=self.fake_transport(calls, fail_at=2))
        self.assertEqual(len(calls), 2)
        self.assertEqual(set(outcome or {}), set(calls[0]))

    def test_request_count_never_exceeds_official_per_unit_budget(self):
        calls: list[list[str]] = []
        outcome = house.plan(task_with_roster(251), [], transport=self.fake_transport(calls))
        self.assertEqual(len(calls), 25)
        self.assertEqual(len(outcome or {}), 250)
        self.assertNotIn("ENTITY250", outcome or {})


if __name__ == "__main__":
    unittest.main()
