"""Operator actions and fast reads for source-bound scenario ensembles."""
from __future__ import annotations
from model.common import identifier, read_json, relative_file
from model.ensembles import Ensembles, parameter_catalog
from model import ensemble_report

ACTIONS = frozenset({"ensemble.create", "ensemble.run", "ensemble.report"})
READS = frozenset({"catalog", "inspect", "report"})
WRITES = frozenset({"preview"})

class EnsembleService:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _ensemble_id(self, value):
        try:
            return identifier(value.get("ensemble_id"))
        except (TypeError, ValueError) as error:
            raise self.Fault("ENSEMBLE_REQUIRED", "Choose a retained scenario ensemble.") from error

    def _downloads(self, workspace, report):
        if report is None:
            return []
        ws = self.operator.ws(workspace)
        directory = ws.root / "ensemble_reports" / identifier(report["id"])
        labels = {"report.html": "Printable comparison report", "pairs.csv": "All paired quantities",
                  "robustness.csv": "Direction and parameter ranges", "sensitivity.csv": "Baseline parameter sensitivity",
                  "report.json": "Complete report data",
                  "METHODS.md": "Comparison method", "ensemble-report.zip": "Complete report package"}
        return [self.operator._ticket(workspace, relative_file(directory, item["path"]),
                    item, labels.get(name, name)) for name, item in report["files"].items()]

    def overview(self, workspace):
        """Small JSON-only rows for the existing operator polling response."""
        ws = self.operator.ws(workspace)
        manager = Ensembles(ws)
        rows = []
        for plan in manager.list():
            key = plan["id"]
            value = plan
            members = value.get("members", [])
            runs = [r for m in members for r in m.get("runs", [])]
            progress = value.get("progress", {})
            rows.append({"id": key, "title": value.get("title", key[:12]),
                         "reason": value.get("reason", ""), "state": value.get("state", "prepared"),
                         "grid_id": value.get("grid_id"), "model_scope": value.get("model_scope"),
                         "baseline_scenario_id": value.get("baseline_scenario_id"),
                         "member_count": len(members), "run_count": len(runs),
                         "alternative_count": len(value.get("alternative_scenario_ids", [])),
                         "completed_runs": progress.get("complete", sum(r.get("state") == "complete" for r in runs)),
                         "progress": progress,
                         "created_at": value.get("created_at")})
        return rows

    def read(self, workspace, operation, payload=None):
        payload = payload or {}
        ws = self.operator.ws(workspace)
        manager = Ensembles(ws)
        if operation == "catalog":
            state = ws.overview()
            return {"workspace_key": workspace, "parameters": parameter_catalog(),
                    "ensembles": self.overview(workspace),
                    "profiles": state["profiles"], "scenarios": state["scenarios"],
                    "grids": state["grids"]}
        if operation == "preview":
            spec = payload.get("spec")
            if not isinstance(spec, dict):
                raise self.Fault("ENSEMBLE_SPEC", "Select the grid, scenarios and parameter profiles.")
            return {"workspace_key": workspace, "preview": manager.preview(spec)}
        if operation in {"inspect", "report"}:
            key = self._ensemble_id(payload)
            ensemble = manager.inspect(key)
            data = manager.report_data(key, refresh=False)
            report = ensemble_report.latest(ws, key)
            return {"workspace_key": workspace, "ensemble": ensemble,
                    "summary": data, "report": report,
                    "export_state": ensemble_report.export_state(report, data),
                    "downloads": self._downloads(workspace, report)}
        raise self.Fault("ENSEMBLE_READ", "Choose a supported ensemble operation.")

    def decorate_task(self, task):
        """Refresh report tickets when an original queued task is reopened."""
        if task.get("action") != "ensemble.report" or task.get("state") != "complete":
            return task
        result = task.get("result") or {}
        report_id = identifier(result["report_id"])
        ensemble_id = identifier(result["ensemble_id"])
        workspace = task["workspace"]
        ws = self.operator.ws(workspace)
        report = read_json(ws.root / "ensemble_reports" / report_id / "release.json")
        if report.get("id") != report_id or report.get("ensemble_id") != ensemble_id:
            raise self.Fault("ENSEMBLE_REPORT", "The retained report belongs to a different comparison.", 409)
        task["_downloads"] = self._downloads(workspace, report)
        return task

    def invoke(self, task):
        workspace = task["workspace"]
        ws = self.operator.ws(workspace)
        manager = Ensembles(ws)
        action, payload = task["action"], task["payload"]
        if action == "ensemble.create":
            spec = payload.get("spec")
            if not isinstance(spec, dict):
                raise self.Fault("ENSEMBLE_SPEC", "Select the grid, scenarios and parameter profiles.")
            return manager.prepare(spec)
        if action == "ensemble.run":
            key = self._ensemble_id(payload)
            keep_going = payload.get("continue_on_error", True)
            if not isinstance(keep_going, bool):
                raise self.Fault("ENSEMBLE_OPTION", "Continue-on-error must be true or false.")
            result = manager.run(key, continue_on_error=keep_going)
            if result.get("state") in {"failed", "partial"}:
                raise self.Fault("ENSEMBLE_INCOMPLETE",
                    "The ensemble retained its completed runs. Open the ensemble to inspect "
                    "the failed or unfinished cases and resume the same saved design.", 409)
            return result
        if action == "ensemble.report":
            key = self._ensemble_id(payload)
            report = ensemble_report.build(ws, key)
            return {"ensemble_id": key, "report_id": report["id"],
                    "state": report["state"], "paired_results": report["paired_results"],
                    "parameter_results": report.get("parameter_results", 0),
                    "downloads": self._downloads(workspace, report)}
        raise self.Fault("ENSEMBLE_ACTION", "Choose a supported ensemble action.")
