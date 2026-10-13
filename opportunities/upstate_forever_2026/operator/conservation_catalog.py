"""Queued preparation and passive pages for original Conservation candidates."""
from __future__ import annotations

import json

from model import conservation_catalog as model
from model import conservation
from model.common import identifier, relative_file

ACTIONS = frozenset({
    "conservation.catalog.prepare", "conservation.catalog.select",
    "conservation.catalog.plan.save", "conservation.catalog.export",
})
READS = frozenset({"study", "status", "query", "candidate", "selection"})


class ConservationCatalog:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def _value(self, value):
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise self.Fault("CONSERVATION_CATALOG_INPUT", "Supply a candidate source selection.")
        return value

    @staticmethod
    def _one(value, name, default=None):
        item = value.get(name, default)
        if isinstance(item, list):
            if len(item) != 1:
                raise ValueError("Choose one " + name.replace("_", " "))
            return item[0]
        return item

    def _study(self, value):
        return identifier(self._one(value, "study_id"))

    def _selection(self, value):
        selection = self._one(value, "selection", {})
        if isinstance(selection, str):
            selection = json.loads(selection)
        if not isinstance(selection, dict):
            raise ValueError("Candidate filters and the result page must be an object")
        return selection

    def _retained(self, value):
        retained = self._one(value, "retained")
        if isinstance(retained, str):
            retained = json.loads(retained)
        if retained is not None and not isinstance(retained, dict):
            raise ValueError("Retained selection must be an object")
        return retained

    def _call(self, function, *args, **kwargs):
        try:
            return function(*args, **kwargs)
        except FileNotFoundError as error:
            raise self.Fault("CONSERVATION_CATALOG_MISSING", str(error), 404) from error
        except (ValueError, KeyError, TypeError) as error:
            raise self.Fault("CONSERVATION_CATALOG_SELECTION", str(error)) from error

    def read(self, workspace_key, operation, payload=None):
        value = self._value(payload)
        ws = self.operator.ws(workspace_key)
        study_id = self._call(self._study, value)
        if operation == "study":
            return self._call(conservation.inspect, ws, study_id, include_candidates=False)
        if operation == "status":
            return self._call(model.status, ws, study_id)
        if operation == "candidate":
            key = self._one(value, "candidate_id")
            return self._call(model.candidate, ws, study_id, key)
        selection = self._call(self._selection, value)
        if operation == "query":
            return self._call(model.query, ws, study_id, selection, self._retained(value))
        if operation == "selection":
            return self._call(model.get_selection, ws, study_id, self._one(value, "selection_id"))
        raise self.Fault("CONSERVATION_CATALOG_ROUTE", "Choose a supported candidate view.", 404)

    def invoke(self, task):
        value = self._value(task.get("payload"))
        ws = self.operator.ws(task["workspace"])
        study_id = self._call(self._study, value)
        if task["action"] == "conservation.catalog.prepare":
            return self._call(model.prepare, ws, study_id)
        if task["action"] == "conservation.catalog.select":
            return self._call(model.select, ws, study_id, self._selection(value))
        if task["action"] == "conservation.catalog.plan.save":
            return self._call(model.save_selected_plan, ws, value)
        if task["action"] == "conservation.catalog.export":
            return self._call(model.export_rows, ws, study_id, self._selection(value), self._retained(value))
        raise self.Fault("CONSERVATION_CATALOG_ACTION", "Choose a supported candidate operation.", 404)

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or not isinstance(task.get("result"), dict):
            return task
        result = task["result"]
        value = dict(task)
        value["_conservation"] = {
            **(task.get("_conservation") or {}),
            "study_id": result.get("study_id") or task.get("payload", {}).get("study_id"),
            "plan_id": result.get("plan_id") or result.get("plan", {}).get("id"),
        }
        value["_conservation_catalog"] = {
            "study_id": value["_conservation"]["study_id"],
            "catalog_id": result.get("id") if task["action"] == "conservation.catalog.prepare" else None,
            "count": result.get("count", result.get("counts", {}).get("total")),
            "state": result.get("state") or result.get("plan", {}).get("state"),
            "selection_id": result.get("selection_id") or result.get("selection", {}).get("id"),
            "plan_id": result.get("plan_id"),
        }
        files = list(task.get("_downloads") or [])
        seen = {row.get("id") for row in files if isinstance(row, dict)}
        ws = self.operator.ws(task["workspace"])
        groups = [result.get("files", {})]
        groups += [result.get(key, {}).get("files", {}) for key in ("plan", "selection")]
        for name, descriptor in ((name, descriptor) for group in groups for name, descriptor in group.items()):
            path = relative_file(ws.root, descriptor["path"])
            label = {"index": "Original candidate reading index",
                     "json": "All filtered original candidates",
                     "csv": "All filtered candidate quantities",
                     "selected_ids": "All retained original candidate IDs"}.get(name, name)
            ticket = self.operator._ticket(task["workspace"], path, descriptor, label)
            if ticket["id"] not in seen:
                files.append(ticket)
                seen.add(ticket["id"])
        value["_downloads"] = files
        return value
