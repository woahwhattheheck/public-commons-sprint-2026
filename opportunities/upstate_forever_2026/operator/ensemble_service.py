"""Operator actions and fast reads for source-bound scenario ensembles."""
from __future__ import annotations
from model.common import identifier, read_json, relative_file, describe_file
from model.ensembles import Ensembles, parameter_catalog
from model import ensemble_report, ensemble_consumers, ensemble_references, ensemble_flow_support

ACTIONS = frozenset({"ensemble.create", "ensemble.run", "ensemble.report",
                     "ensemble.decision", "ensemble.calibration", "ensemble.consumer.resume", "ensemble.flow-support"})
READS = frozenset({"catalog", "inspect", "report", "consumers", "consumer", "annual-references"})
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

    def _consumer(self, workspace, key):
        ws = self.operator.ws(workspace)
        plan = ws._get(ensemble_consumers.KIND, identifier(key))
        if plan.get("workspace_id") != ws.project["id"]:
            raise self.Fault("ENSEMBLE_CONSUMER", "The saved scientific handoff belongs to another workspace.", 409)
        path = ws.root / "ensemble-consumer-results" / plan["id"] / "state.json"
        result = read_json(path) if path.exists() else {"state": "prepared"}
        if path.exists() and (result.get("consumer_id") != plan["id"] or
                              result.get("workspace_id") != ws.project["id"]):
            raise self.Fault("ENSEMBLE_CONSUMER", "The retained consumer result has another identity.", 409)
        files = {**dict(result.get("files", {})), **((plan.get("flow_support") or {}).get("files", {}))}
        files["handoff"] = describe_file(ws.root, ws.root / ensemble_consumers.KIND / (plan["id"] + ".json"))
        if plan["mode"] == "calibration":
            for name, kind, key_field in (("calibration", "calibrations", "calibration_id"),
                                         ("uncertainty", "calibration-uncertainties", "uncertainty_id")):
                key = result.get(key_field)
                if key:
                    ws._get(kind, identifier(key))
                    files[name] = describe_file(ws.root, ws.root / kind / (key + ".json"))
        labels = {"html": "Open physical decision report", "archive": "Complete decision ZIP",
                  "physical_input": "Original physical input", "report": "Complete decision JSON",
                  "manifest": "Decision file manifest", "handoff": "Saved scientific handoff",
                  "calibration": "Original annual-load calibration", "uncertainty": "Published-source sensitivity",
                  "flow_support_report": "Open original flow-period context",
                  "flow_support_json": "Complete original flow-period support",
                  "flow_support_csv": "Original flow-period table",
                  "flow_reference_binding": "Original reference binding",
                  "flow_date_support": "Original station date availability"}
        downloads = [self.operator._ticket(workspace, relative_file(ws.root, item["path"]),
                                          item, labels.get(name, name))
                     for name, item in files.items()]
        return {"workspace_key": workspace, "plan": plan, "result": result, "downloads": downloads}

    def _consumer_rows(self, ws, ensemble_id):
        rows = []
        for plan in ws._list(ensemble_consumers.KIND):
            if plan.get("ensemble_id") != ensemble_id:
                continue
            path = ws.root / "ensemble-consumer-results" / plan["id"] / "state.json"
            result = read_json(path) if path.exists() else {"state": "prepared"}
            rows.append({"id": plan["id"], "mode": plan["mode"],
                         "title": plan["selection"].get("title", plan["mode"]),
                         "state": result.get("state", "prepared"),
                         "selected_member_count": plan["selected_member_count"],
                         "planned_member_count": plan["catalog"]["planned_member_count"],
                         "pollutants": plan["pollutants"], "updated_at": result.get("completed_at") or result.get("updated_at"),
                         "calibration_id": result.get("calibration_id"),
                         "uncertainty_id": result.get("uncertainty_id")})
        return rows

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
        if operation == "annual-references":
            return {"workspace_key": workspace, **ensemble_references.catalog(ws),
                    "ensembles": self.overview(workspace)}
        if operation == "consumer":
            return self._consumer(workspace, payload.get("consumer_id"))
        if operation == "consumers":
            key = self._ensemble_id(payload)
            selected = ensemble_consumers.inspect(ws, key)
            observed = [{"id": row["id"], "title": row["metadata"]["title"],
                         "parameters": sorted({item["parameter"] for item in row["rows"] if item.get("admitted")}),
                         "admitted_count": row["admitted_count"]}
                        for row in ws._list("observations")]
            sources = [{"collection_id": collection["id"], "id": entry["id"],
                        "title": entry.get("title", entry["id"]), "layer": entry.get("layer")}
                       for collection in ws._list("sources") for entry in collection.get("entries", [])
                       if entry.get("kind") == "vector"]
            references = [{"id": row["id"], "title": row["selection"]["title"],
                           "selection": {name: value for name, value in row["selection"].items()
                                         if name not in {"candidate_run_ids", "reference_run_id"}}}
                          for row in ws._list("calibration-plans")]
            return {"workspace_key": workspace, "catalog": selected, "observations": observed,
                    "catchment_sources": sources, "reference_selections": references,
                    "annual_references": ensemble_references.catalog(ws),
                    "flow_support": ensemble_flow_support.catalog(ws),
                    "scenarios": ws._list("scenarios"), "consumers": self._consumer_rows(ws, key)}
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
                    "downloads": self._downloads(workspace, report),
                    "consumers": self._consumer_rows(ws, key)}
        raise self.Fault("ENSEMBLE_READ", "Choose a supported ensemble operation.")

    def decorate_task(self, task):
        """Refresh report tickets when an original queued task is reopened."""
        if task.get("action") == "ensemble.flow-support":
            result = task.get("result") or {}
            ws = self.operator.ws(task["workspace"])
            task["_downloads"] = [
                self.operator._ticket(task["workspace"], relative_file(ws.root, item["path"]), item, name.replace("_", " "))
                for name, item in result.get("files", {}).items()]
            return task
        if task.get("action") in {"ensemble.decision", "ensemble.calibration", "ensemble.consumer.resume"}:
            result = task.get("result") or {}
            if result.get("consumer_id"):
                task["_downloads"] = self._consumer(task["workspace"], result["consumer_id"])["downloads"]
            return task
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
        if action == "ensemble.flow-support":
            result = ensemble_flow_support.prepare(ws, identifier(payload.get("reference_import_id")))
            return {**result, "downloads": [
                self.operator._ticket(workspace, relative_file(ws.root, item["path"]), item, name.replace("_", " "))
                for name, item in result.get("files", {}).items()]}
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
        if action in {"ensemble.decision", "ensemble.calibration", "ensemble.consumer.resume"}:
            if action == "ensemble.consumer.resume":
                plan = ws._get(ensemble_consumers.KIND, identifier(payload.get("consumer_id")))
            elif action == "ensemble.decision":
                plan = ensemble_consumers.prepare_decision(
                    ws, self._ensemble_id(payload), profile_ids=payload.get("profile_ids"),
                    scenario_ids=payload.get("scenario_ids"),
                    reference_profile_id=payload.get("reference_profile_id"),
                    pollutants=payload.get("pollutants"), criteria=payload.get("criteria"))
            else:
                plan = ensemble_consumers.prepare_calibration(
                    ws, self._ensemble_id(payload), payload.get("reference_selection"),
                    profile_ids=payload.get("profile_ids"), pollutants=payload.get("pollutants"),
                    reference_import_id=payload.get("reference_import_id"),
                    reference_options=payload.get("reference_options"),
                    flow_support_source=payload.get("flow_support_source"),
                    prepare_flow_support=payload.get("prepare_flow_support", False))
            if plan["mode"] == "decision":
                result = ensemble_consumers.build_decision(ws, plan["id"])
            else:
                result = ensemble_consumers.run_calibration(
                    ws, plan["id"], standard_errors=payload.get("standard_errors"))
            return {"consumer_id": plan["id"], "ensemble_id": plan["ensemble_id"],
                    "mode": plan["mode"], "state": result["state"],
                    "result": result, "downloads": self._consumer(workspace, plan["id"])["downloads"]}
        raise self.Fault("ENSEMBLE_ACTION", "Choose a supported ensemble action.")
