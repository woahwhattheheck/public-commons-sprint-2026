"""Load the complete authored agency billing example through original actions."""
from __future__ import annotations

import base64
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "examples" / "billing"


def load_billing_example(service):
    def action(name, operation, body):
        return service.dispatch(name, {**body, "operation_id": "billing-example-" + operation,
            "actor": "Commons authored operating example"})["record"]

    agencies = json.loads((ROOT / "agencies.json").read_text(encoding="utf-8"))
    for agency in agencies:
        action("billing.agency.save", "agency-" + agency["code"].lower(), agency)
    policy = action("billing.policy.save", "policy",
        json.loads((ROOT / "policy.json").read_text(encoding="utf-8")))
    cost = action("billing.cost.import", "cost-import", {
        "filename": "costs.csv", "base64": base64.b64encode((ROOT / "costs.csv").read_bytes()).decode(),
        "label": "Commons authored September cost example", "period": "2026-09",
        "basis": "actual", "allocation_view": "supplier", "invoice_status": "closed",
        "invoice_id": "EXAMPLE-2026-09"})
    usage = action("billing.usage.import", "usage-import", {
        "filename": "usage.csv", "base64": base64.b64encode((ROOT / "usage.csv").read_bytes()).decode(),
        "label": "Commons authored September usage example", "period": "2026-09"})
    period = action("billing.period.prepare", "monthly-period", {
        "label": "Commons authored 12-agency allocation", "period": "2026-09",
        "policy_id": policy["id"], "policy_revision": policy["revision"],
        "cost_import_ids": [cost["id"]], "usage_import_ids": [usage["id"]],
        "minor_units": 2, "adjustments": [],
        "notes": "Commons-authored software operating example. Agency identities, usage and costs are example inputs."})
    # A repeated example load reopens the user's current period revision, which
    # may already contain a review, final statement or subsequent correction.
    return service.store.get("billing_period", period["id"])
