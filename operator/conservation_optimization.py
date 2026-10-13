"""Original-operator queue and retained files for conservation optimization.

The existing model owns scoring, native support, geometry, solver choices and
plan persistence. This registered provider adds no second analysis/plan store.
"""
from __future__ import annotations

from pathlib import Path
import re

from model import conservation
from model import conservation_optimization as optimization
from model.common import identifier, read_json


ACTIONS = frozenset({
    "conservation.optimization.preview",
    "conservation.optimization.save",
    "conservation.optimization.export",
})
READS = frozenset({"catalog", "analysis", "plan"})
ITEM_KIND = "conservation-optimized-plans"
CATALOG_SCHEMA = "upstate.conservation-optimization-catalog/v1"


class ConservationOptimization:
    ACTIONS = ACTIONS
    READS = READS

    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _mapping(self, value, label="Request"):
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise self.Fault("CONSERVATION_OPTIMIZATION_INPUT",
                             label + " must be a JSON object.")
        return value

    def _id(self, value, name, *, alias=None, optional=False):
        item = value.get(name)
        if item is None and alias:
            item = value.get(alias)
        if item is None and optional:
            return None
        if isinstance(item, list):
            item = item[0] if len(item) == 1 else None
        try:
            return identifier(item)
        except (TypeError, ValueError) as error:
            raise self.Fault("CONSERVATION_OPTIMIZATION_ID",
                             "Choose one original " + name.replace("_", " ") + ".") from error

    def _call(self, function, *args, **kwargs):
        try:
            return function(*args, **kwargs)
        except FileNotFoundError as error:
            raise self.Fault(
                "CONSERVATION_OPTIMIZATION_MISSING",
                "An original study, plan or retained analysis file is unavailable: " + str(error),
                404,
            ) from error
        except ValueError as error:
            raise self.Fault("CONSERVATION_OPTIMIZATION_SELECTION", str(error)) from error

    def _catalog(self, workspace, value):
        ws = self.operator.ws(workspace)
        study_id = self._id(value, "study_id", optional=True)
        catalog = conservation.overview(ws)
        studies = catalog["studies"]
        plans = catalog["plans"]
        if study_id is not None:
            # Resolve the requested identity through the original model first.
            conservation.inspect(ws, study_id, include_candidates=False)
            studies = [row for row in studies if row["id"] == study_id]
            plans = [row for row in plans if row.get("study_id") == study_id]
        analyses, issues = [], []
        for study in studies:
            directory = ws.root / "conservation" / identifier(study["id"]) / "optimization"
            for path in sorted(directory.glob("*/analysis-state.json")):
                try:
                    path.resolve().relative_to(Path(ws.root).resolve())
                    record = read_json(path)
                    if (record.get("schema") != optimization.REFERENCE_SCHEMA
                            or record.get("study_id") != study["id"]
                            or record.get("id") != path.parent.name):
                        raise ValueError("The analysis reference differs from its original study/path.")
                    identifier(record["id"])
                    analyses.append({
                        **{key: record.get(key) for key in
                           ("id", "study_id", "state", "created_at", "files")},
                        "study_title": study["title"],
                        "analysis_route": "/api/conservation-optimization/analysis",
                    })
                except (OSError, TypeError, ValueError, KeyError) as error:
                    issues.append({
                        "study_id": study["id"], "analysis_id": path.parent.name,
                        "message": str(error),
                    })
        return {
            "schema": CATALOG_SCHEMA,
            "studies": studies, "plans": plans, "analyses": analyses,
            "issues": issues,
            "actions": sorted(self.ACTIONS),
            "item_kind": ITEM_KIND,
            "reads": {
                name: "/api/conservation-optimization/" + name
                for name in sorted(self.READS)
            },
            "context_axes": list(optimization.CONTEXT_AXES),
            "physical_axes": list(optimization.PHYSICAL_AXES),
            "published_axes": list(optimization.PUBLISHED_AXES),
            "axis_availability": (
                "Use the queued preview's request.available_axes and complete candidate support. "
                "Catalog axis names identify supported measurements, not available study outputs."
            ),
        }

    def _downloads(self, workspace, groups):
        """Ticket declared model files only, within this original workspace."""
        root = Path(self.operator.ws(workspace).root).resolve()
        tickets = {}

        def visit(value, label):
            if isinstance(value, dict):
                if {"path", "bytes", "sha256"} <= value.keys():
                    relative = value["path"]
                    size, checksum = value["bytes"], value["sha256"]
                    if (not isinstance(relative, str) or not relative
                            or Path(relative).is_absolute() or "\\" in relative
                            or any(part in {"", ".", ".."} for part in relative.split("/"))
                            or isinstance(size, bool) or not isinstance(size, int) or size < 0
                            or not isinstance(checksum, str)
                            or re.fullmatch(r"[0-9a-f]{64}", checksum) is None):
                        raise self.Fault("CONSERVATION_OPTIMIZATION_FILE",
                                         "The retained output descriptor is invalid.", 409)
                    path = (root / relative).resolve()
                    try:
                        path.relative_to(root)
                    except ValueError as error:
                        raise self.Fault("CONSERVATION_OPTIMIZATION_FILE",
                                         "The retained output leaves its original workspace.", 409) from error
                    if not path.is_file():
                        raise self.Fault("CONSERVATION_OPTIMIZATION_FILE",
                                         "The retained output is unavailable: " + relative, 404)
                    ticket = self.operator._ticket(workspace, path, value, label)
                    tickets.setdefault(ticket["id"], ticket)
                    return
                for name, child in value.items():
                    if isinstance(child, (dict, list)):
                        visit(child, label + " / " + str(name).replace("_", " "))
            elif isinstance(value, list):
                for index, child in enumerate(value, 1):
                    visit(child, label + " / " + str(index))

        for label, values in groups:
            visit(values, label)
        return list(tickets.values())

    def read(self, workspace, operation, value=None):
        value = self._mapping(value)
        if operation not in self.READS:
            raise self.Fault("CONSERVATION_OPTIMIZATION_READ",
                             "Unknown conservation optimization view.", 404)
        if operation == "catalog":
            return self._call(self._catalog, workspace, value)
        ws = self.operator.ws(workspace)
        if operation == "analysis":
            result = self._call(
                optimization.get_analysis, ws,
                self._id(value, "study_id"), self._id(value, "analysis_id", alias="id"),
            )
            return {
                **result,
                "_downloads": self._downloads(workspace, [
                    ("Decision analysis", result["state"]["files"]),
                ]),
                "_conservation": {"study_id": result["state"]["study_id"]},
            }
        plan = self._call(conservation.get_plan, ws, self._id(value, "plan_id", alias="id"))
        reference = plan.get("selection", {}).get("optimization")
        if not isinstance(reference, dict) or reference.get("schema") != optimization.REFERENCE_SCHEMA:
            raise self.Fault("CONSERVATION_OPTIMIZATION_PLAN",
                             "Choose an original plan saved from this decision analysis.")
        result = self._call(optimization.get_analysis, ws, plan["study_id"], reference["analysis_id"])
        if result["state"]["files"] != reference["files"]:
            raise self.Fault("CONSERVATION_OPTIMIZATION_REFERENCE",
                             "The saved plan and decision analysis identify different files.", 409)
        return {
            **plan, "optimization_analysis": result["state"],
            "_downloads": self._downloads(workspace, [
                ("Saved portfolio", plan.get("files", {})),
                ("Decision analysis", result["state"]["files"]),
            ]),
            "_conservation": {"study_id": plan["study_id"], "plan_id": plan["id"]},
        }

    def invoke(self, task):
        action = task.get("action")
        if action not in self.ACTIONS:
            raise self.Fault("CONSERVATION_OPTIMIZATION_ACTION",
                             "Unknown conservation optimization action.", 404)
        ws = self.operator.ws(task["workspace"])
        payload = self._mapping(task.get("payload"))
        if action == "conservation.optimization.export":
            return self._call(optimization.export, ws, self._id(payload, "plan_id"))
        if action == "conservation.optimization.save" and payload.get("preview_task_id"):
            if set(payload) != {"preview_task_id"}:
                raise self.Fault("CONSERVATION_OPTIMIZATION_PREVIEW",
                                 "Save the original preview or submit a new decision selection.")
            original = self.operator.task_view(self._id(payload, "preview_task_id"))
            if (original.get("workspace") != task["workspace"]
                    or original.get("action") != "conservation.optimization.preview"
                    or original.get("state") != "complete"
                    or not isinstance(original.get("result"), dict)):
                raise self.Fault("CONSERVATION_OPTIMIZATION_PREVIEW",
                                 "Choose a completed original portfolio preview in this workspace.")
            analysis = original["result"]
            request = self._mapping(analysis.get("request"), "Original preview selection")
            result = self._call(optimization.save, ws, request, retained_analysis=analysis)
            return {**result, "preview_task_id": original["id"]}
        selection = self._mapping(payload.get("spec", payload), "Optimization selection")
        function = (optimization.preview if action == "conservation.optimization.preview"
                    else optimization.save)
        return self._call(function, ws, selection)

    def decorate_task(self, task):
        if task.get("action") not in self.ACTIONS:
            return task
        result = task.get("result")
        if not isinstance(result, dict):
            return task
        action = task["action"]
        value = dict(task)
        groups = []
        if action == "conservation.optimization.preview":
            study_id = result.get("input", {}).get("study_id")
            analysis_id, plan_id = result.get("id"), None
            retained_in = "original_operator_task"
        elif action == "conservation.optimization.save":
            plan, analysis = result.get("plan", {}), result.get("analysis", {})
            study_id = plan.get("study_id") or analysis.get("study_id")
            plan_id, analysis_id = plan.get("id"), analysis.get("id")
            retained_in = "original_conservation_study"
            groups = [
                ("Saved portfolio", plan.get("files", {})),
                ("Decision analysis", analysis.get("files", {})),
            ]
        else:
            study_id, plan_id = result.get("study_id"), result.get("plan_id")
            analysis_id = result.get("analysis_id")
            retained_in = "original_conservation_study"
            groups = [("Conservation decision packet", result)]
        value["_conservation"] = {
            **(task.get("_conservation") or {}),
            "study_id": study_id, "plan_id": plan_id,
        }
        value["_conservation_optimization"] = {
            "study_id": study_id, "plan_id": plan_id, "analysis_id": analysis_id,
            "retained_in": retained_in, "task_id": task.get("id"),
            "item_kind": ITEM_KIND if plan_id else None,
        }
        existing = [row for row in (task.get("_downloads") or [])
                    if isinstance(row, dict)]
        downloads = self._downloads(task["workspace"], groups)
        unique = {}
        for row in [*existing, *downloads]:
            key = row.get("id") or row.get("url")
            if key:
                unique.setdefault(key, row)
        value["_downloads"] = list(unique.values())
        return value
