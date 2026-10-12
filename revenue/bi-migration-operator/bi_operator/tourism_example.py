"""Open the published Overland Park example through the original action journal."""
from __future__ import annotations

import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "examples" / "overland-park"


def example_configuration():
    value = json.loads((ROOT / "operating-input.json").read_text(encoding="utf-8"))
    if value.get("schema") != "commons.tourism-operating-example.v1":
        raise ValueError("The original tourism example configuration is invalid.")
    return value


def load_tourism_example(service):
    value = example_configuration()
    def action(name, step, body):
        return service.dispatch(name, {**body, "actor": value["actor"],
            "operation_id": value["operation_prefix"] + "-" + step})["record"]
    source = action("tourism.example", "source", {})
    source = action("tourism.source.accept", "accept", {"id": source["id"],
        "expected": source["revision"], "note": value["source_review_note"]})
    fund = action("tourism.fund.save", "fund", {"fund": value["fund"]})
    plan = action("tourism.plan.save", "plan", {"plan": {**copy.deepcopy(value["plan"]),
        "fund": service.reference(fund), "sources": [service.reference(source)],
        "annual_plan": value["fund"]["annual_plan"]}})
    period = action("tourism.period.prepare", "period", {"plan": service.reference(plan)})
    # Reopen the current edition if staff already reviewed or finalized this report.
    return service.store.get("tourism_period", period["id"])
