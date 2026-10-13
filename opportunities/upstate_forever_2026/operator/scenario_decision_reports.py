"""Watershed report adapter for the maintained operator task and download APIs."""
from __future__ import annotations

from model.common import identifier
from model import scenario_decisions, report_release

ACTIONS = frozenset({"scenario.decision.build"})
READS = frozenset({"catalog", "selection", "report", "release"})
PREVIEW_POLICY = ("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
                  "img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; "
                  "form-action 'none'; sandbox allow-scripts allow-downloads allow-modals")


class ScenarioDecisionReports:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _id(self, value, key):
        try:
            return identifier(value.get(key))
        except (ValueError, TypeError) as error:
            raise self.Fault("DECISION_SELECTION", "Choose the retained " + key.replace("_", " ") + ".") from error

    @staticmethod
    def preview_url(workspace, report_id):
        return "/api/file/scenario-report/" + workspace + "/" + report_id

    def read(self, workspace, operation, value=None):
        value = value or {}
        ws = self.operator.ws(workspace)
        if operation == "catalog":
            result = scenario_decisions.catalog(ws)
            result["workspace_key"] = workspace
            for report in result["reports"]:
                report["preview_url"] = self.preview_url(workspace, report["id"])
            return result
        if operation == "selection":
            baseline = self._id(value, "baseline_run_id")
            alternatives = value.get("alternative_run_ids")
            if isinstance(alternatives, str):
                alternatives = [item for item in alternatives.split(",") if item]
            pollutants = value.get("pollutants")
            if isinstance(pollutants, str):
                pollutants = [item for item in pollutants.split(",") if item]
            return scenario_decisions.select_cohort(
                ws, baseline, alternative_run_ids=alternatives, pollutants=pollutants,
                title=value.get("title"), zones=value.get("zones"))
        if operation == "release":
            report_id = self._id(value, "report_id")
            result = report_release.describe(ws, report_id)
            result["workspace_key"] = workspace
            return result
        if operation == "report":
            report_id = self._id(value, "report_id")
            packet = scenario_decisions.inspect(ws, report_id)
            packet["workspace_key"] = workspace
            packet["preview_url"] = self.preview_url(workspace, report_id)
            packet["_downloads"] = self.operator._files(
                workspace, packet["summary"], ws.root / "scenario-decisions" / report_id)
            try:
                packet["release"] = report_release.describe(ws, report_id, packet=packet)
            except (ValueError, OSError, KeyError, TypeError) as error:
                packet["release"] = {"ready": False, "selection": None, "releases": [],
                    "issues": [{"code": "release_selection", "message": str(error)}]}
            return packet
        raise self.Fault("DECISION_READ", "Choose a supported watershed report view.", 404)

    def invoke(self, task):
        if task["action"] not in ACTIONS:
            raise self.Fault("DECISION_ACTION", "Choose a supported watershed report action.", 404)
        ws = self.operator.ws(task["workspace"])
        payload = task["payload"]
        selected = payload.get("selection", payload)
        return scenario_decisions.build(ws, selected)

    def decorate_task(self, task):
        if task.get("action") in ACTIONS and task.get("state") == "complete":
            report_id = task["result"]["id"]
            packet = self.read(task["workspace"], "report", {"report_id": report_id})
            task["_downloads"] = packet["_downloads"]
            task["_scenario_report_url"] = packet["preview_url"]
        return task

    def preview(self, workspace, report_id):
        workspace, report_id = identifier(workspace), identifier(report_id)
        ws = self.operator.ws(workspace)
        result = scenario_decisions.inspect(ws, report_id, include_report=False)
        original = result["summary"]["files"]["html"]
        path = ws.root / "scenario-decisions" / report_id / original["path"]
        ticket = self.operator._ticket(workspace, path, original, "Watershed scenario report")
        return ticket, PREVIEW_POLICY


# Declarative extension-registry entry points; class API remains available to older operators.
def _bound(operator, fault):
    return ScenarioDecisionReports(operator, fault)

def read(operator, workspace_key, operation, payload, fault):
    value = dict(payload or {})
    if operation == "report" and "report_id" not in value and "id" in value:
        value["report_id"] = value["id"]
    return _bound(operator, fault).read(workspace_key, operation, value)

def invoke(operator, workspace_key, action, payload, fault):
    return _bound(operator, fault).invoke({"workspace": workspace_key, "action": action, "payload": payload})

def decorate_task(operator, task, fault):
    return _bound(operator, fault).decorate_task(task)

def overview(operator, workspace_key):
    from model.common import read_json
    workspace = operator.ws(workspace_key)
    rows = []
    for path in sorted((workspace.root / "scenario-decisions").glob("*/decision.json")):
        value = read_json(path)
        rows.append({name: value[name] for name in ("id", "title", "created_at", "baseline_run_id",
                     "selection", "zones", "runs", "pollutants", "report_kind") if name in value})
    return rows

def verify_all(workspace):
    verified = []
    for path in sorted((workspace.root / "scenario-decisions").glob("*/decision.json")):
        packet = scenario_decisions.inspect(workspace, path.parent.name, include_report=True)
        verified.append({"id": path.parent.name, "files": len(packet["summary"]["files"]),
                         "zones": len(packet["report"]["zones"]), "runs": len(packet["report"]["runs"])})
    return {"schema": "upstate.scenario-report-verification/v1", "reports": verified}

def preview(operator, workspace_key, report_id, fault):
    return _bound(operator, fault).preview(workspace_key, report_id)
