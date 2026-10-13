"""Regional decision reports on the original operator services."""
from __future__ import annotations

import json
import re

from model.decision_context import DecisionContexts

ACTIONS = frozenset({"decision.context.build", "decision.context.delivery"})


class DecisionContextOperator:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def manager(self, workspace):
        return DecisionContexts(self.operator.ws(workspace))

    def _id(self, payload):
        key = payload.get("decision_id") or payload.get("id")
        if not isinstance(key, str) or not re.fullmatch(r"[0-9a-f]{64}", key):
            raise self.Fault("DECISION_REPORT_REQUIRED", "Choose a saved decision report.")
        return key

    @staticmethod
    def _summary(record):
        return {key: record.get(key) for key in (
            "id", "title", "state", "created_at", "plan_id", "analysis_id",
            "baseline_run_id", "alternative_run_ids", "quantity_scope",
            "source_roles", "counts", "record_sha256"
        )}

    def catalog(self, workspace):
        from model import receiving_waters

        ws = self.operator.ws(workspace)
        plans = sorted(receiving_waters.list_plans(ws), key=lambda row: row.get("created_at", ""), reverse=True)
        analyses = sorted(receiving_waters.list_analyses(ws), key=lambda row: row.get("created_at", ""), reverse=True)
        source_water, classified = [], []
        for collection in ws.sources():
            for entry in collection.get("entries", []):
                role = entry.get("role")
                source_id = entry["id"]
                row = {
                    "source_collection_id": collection["id"],
                    "source_id": source_id, "title": entry["title"],
                    "vintage": entry["vintage"], "uri": entry["uri"],
                    "role": role, "sha256": entry["body"]["sha256"],
                    "collection_title": collection.get("title") or collection.get("scope"),
                }
                if role == "SOURCE_WATER_CONTEXT":
                    source_water.append(row)
                if (source_id == "classified-water-crosswalk" or
                        role == "CLASSIFIED_WATER_CROSSWALK"):
                    classified.append(row)
        return {
            "workspace_key": workspace,
            "plans": [{
                "id": row["id"], "title": row["title"], "state": row["state"],
                "receptor_count": len(row.get("receptors", [])),
            } for row in plans if row.get("state") == "complete"],
            "analyses": [{
                "id": row["id"], "title": row.get("title") or next(
                    (plan["title"] for plan in plans if plan["id"] == row["plan_id"]),
                    "Receiving-water analysis"),
                "plan_id": row["plan_id"], "quantity_scope": row["quantity_scope"],
                "baseline_run_id": row["baseline_run_id"],
                "alternative_run_ids": row.get("alternative_run_ids", []),
                "pollutants": row.get("pollutants", []),
            } for row in analyses if row.get("state") == "complete"],
            "source_water_contexts": source_water,
            "classified_crosswalks": classified,
            "reports": self.state(workspace),
        }

    def _decorate(self, workspace, result):
        result = json.loads(json.dumps(result))
        result["_downloads"] = self.operator._files(
            workspace, result, self.operator.ws(workspace).root)
        return result

    def state(self, workspace):
        return [self._summary(row) for row in sorted(
            self.manager(workspace).list(), key=lambda row: row.get("created_at", ""), reverse=True)]

    def item(self, workspace, payload):
        manager = self.manager(workspace)
        key = self._id(payload)
        result = self._decorate(workspace, manager.inspect(key))
        result["compatible_deliveries"] = manager.compatible_deliveries(key)
        result["delivery_links"] = [
            self._decorate(workspace, row)
            for row in self.operator.ws(workspace)._list("decision-delivery-links")
            if row.get("decision_id") == key
        ]
        return result

    def read(self, workspace, operation, payload):
        if operation == "catalog":
            return self.catalog(workspace)
        if operation == "detail":
            return {"workspace_key": workspace, **self.item(workspace, payload)}
        raise self.Fault("DECISION_READ", "Choose a decision-report view.", 404)

    def invoke(self, task):
        manager = self.manager(task["workspace"])
        payload = task.get("payload", {})
        if task["action"] == "decision.context.build":
            selection = payload.get("selection")
            if not isinstance(selection, dict):
                raise self.Fault(
                    "DECISION_SELECTION",
                    "Choose a receiving-water analysis or plan and a retained context source.")
            return manager.build(selection)
        if task["action"] == "decision.context.delivery":
            return manager.link_delivery(self._id(payload), payload.get("delivery_id"))
        raise self.Fault("DECISION_ACTION", "Choose a decision-report operation.")

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS:
            return task
        result = json.loads(json.dumps(task))
        if result.get("state") == "complete" and isinstance(result.get("result"), dict):
            result["_downloads"] = self.operator._files(
                result["workspace"], result["result"],
                self.operator.ws(result["workspace"]).root)
            record = result["result"]
            result["decision_context"] = {
                "id": record.get("decision_id") or record.get("id"),
                "title": record.get("title"), "state": record.get("state"),
            }
        return result

    def verify_workspace(self, workspace):
        return DecisionContexts(workspace).verify_workspace()
