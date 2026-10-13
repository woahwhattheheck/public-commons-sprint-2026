"""Operator integration for retained native computation programmes.

The existing Operator owns authorization, task identities, native execution
serialization and authenticated downloads. This adapter shares those services.
"""
from __future__ import annotations

import json
import re

from model.compute_programme import ComputeProgrammes
from model.programme_views import DEFAULT_VIEWS

ACTIONS = {
    "compute.programme.save",
    "compute.programme.experiment",
    "compute.programme.interaction",
    "compute.programme.attach-interaction",
    "compute.programme.sync-interaction",
    "compute.programme.pair-completion",
    "compute.programme.run",
    "compute.programme.report",
    "compute.programme.delivery",
}
READS = {"catalog", "detail", "report", "pair-completion-preview", "execution", "page", "selection", "paired", "keys"}


class Programmes:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _manager(self, workspace):
        return ComputeProgrammes(self.operator.ws(workspace))

    def _id(self, payload):
        key = payload.get("programme_id")
        if not isinstance(key, str) or not re.fullmatch(r"[0-9a-f]{64}", key):
            raise self.Fault("PROGRAMME_REQUIRED", "Choose a saved run programme.")
        return key

    def catalogue(self, workspace, *, include_completed_sources=False):
        from model.programme_experiments import catalog
        from model.programme_interactions import catalog as interaction_catalog
        ws = self.operator.ws(workspace)
        return {**DEFAULT_VIEWS.catalog(ws, include_completed_sources=include_completed_sources),
                **catalog(ws), **interaction_catalog(ws)}

    def _decorate(self, workspace, result):
        result = json.loads(json.dumps(result))
        ws = self.operator.ws(workspace)
        if isinstance(result, dict):
            result["_downloads"] = self.operator._files(workspace, result, ws.root)
            latest = result.get("latest_report")
            if isinstance(latest, dict):
                more = self.operator._files(workspace, latest, ws.root)
                known = {row["id"] for row in result["_downloads"]}
                result["_downloads"].extend(row for row in more if row["id"] not in known)
        return result

    def read(self, workspace, operation, payload):
        manager = self._manager(workspace)
        if operation == "catalog":
            include_sources = payload.get("include_sources") in (True, 1, "1", "true")
            return {"workspace_key": workspace, **self.catalogue(workspace, include_completed_sources=include_sources)}
        key = self._id(payload)
        if operation == "execution":
            from model.programme_case_status import read
            return {"workspace_key": workspace, **read(manager.workspace, key, payload.get("run_id"),
                    **{name: payload[name] for name in (
                        "attempt_id", "stream", "log_offset", "expected_attempt_id",
                        "history_offset", "limit") if payload.get(name) not in (None, "")})}
        if operation == "page":
            return {"workspace_key": workspace, **self._decorate(workspace,
                    DEFAULT_VIEWS.read(manager.workspace, key,
                        offset=payload.get("offset"), limit=payload.get("limit"),
                        case_filter=payload.get("case_filter") or "all",
                        query=payload.get("query") or ""))}
        if operation == "selection":
            return {"workspace_key": workspace, "programme_id": key,
                    "selection": manager._load(key)["selection"]}
        if operation == "keys":
            return {"workspace_key": workspace, **DEFAULT_VIEWS.keys(manager.workspace, key,
                    case_filter=payload.get("case_filter") or "unfinished")}
        if operation == "paired":
            current = manager.status(key)
            return {"workspace_key": workspace, "programme_id": key,
                    **{name: current[name] for name in
                       ("ensemble_candidates", "ensemble_candidate_issues", "pair_completion", "pair_completions")}}
        if operation == "pair-completion-preview":
            return {"workspace_key": workspace, **manager.pair_completion_preview(key)}
        if operation == "detail":
            return {"workspace_key": workspace, **self._decorate(workspace, manager.status(key))}
        if operation == "report":
            return {"workspace_key": workspace, **self._decorate(workspace, manager.read_report(key))}
        raise self.Fault("PROGRAMME_READ", "Choose a supported programme view.", 404)

    def preview(self, workspace, payload):
        selection = payload.get("selection")
        if not isinstance(selection, dict):
            raise self.Fault("PROGRAMME_SELECTION", "Import or create a programme selection.")
        return {"workspace_key": workspace, **self._manager(workspace).preview(selection)}

    def experiment_preview(self, workspace, payload):
        from model.programme_experiments import preview
        return {"workspace_key": workspace, **preview(self.operator.ws(workspace),
            payload.get("experiment_id"), payload.get("offset", 0), payload.get("limit", 100))}

    def interaction_preview(self, workspace, payload):
        from model.programme_interactions import preview
        return {"workspace_key": workspace, **preview(self.operator.ws(workspace), payload.get("plan_id"))}

    def pause(self, workspace, payload):
        # This signal deliberately runs on the request thread. Enqueueing it in
        # the native worker would put it behind the calculation it should pause.
        return {"workspace_key": workspace, **self._manager(workspace).pause(self._id(payload))}

    def delivery_preview(self, workspace, payload):
        selection = payload.get("selection")
        if not isinstance(selection, dict):
            raise self.Fault("DELIVERY_SELECTION", "Choose the saved release selections.")
        return {"workspace_key": workspace, **self._manager(workspace).delivery_preview(
            self._id(payload), selection)}

    def invoke(self, task):
        workspace = task["workspace"]
        manager = self._manager(workspace)
        payload = task["payload"]
        action = task["action"]
        if action == "compute.programme.experiment":
            from model.programme_experiments import create
            return create(self.operator.ws(workspace), payload.get("experiment_id"))
        if action == "compute.programme.interaction":
            from model.programme_interactions import create
            return create(self.operator.ws(workspace), payload.get("plan_id"))
        if action == "compute.programme.save":
            selection = payload.get("selection")
            if not isinstance(selection, dict):
                raise self.Fault("PROGRAMME_SELECTION", "Create or import a programme selection.")
            return manager.create(selection, source_reference=payload.get("source_reference"))
        key = self._id(payload)
        if action == "compute.programme.attach-interaction":
            from model.programme_interactions import attach
            return self._decorate(workspace, attach(self.operator.ws(workspace), key, payload.get("result_id")))
        if action == "compute.programme.sync-interaction":
            from model.programme_interactions import sync_completed
            status = manager.status(key, include_ensemble_candidates=False)
            result = sync_completed(self.operator.ws(workspace), status)
            if result is None:
                raise self.Fault("INTERACTION_PROGRAMME_REQUIRED",
                                 "Choose a programme created from a conservation study.")
            return self._decorate(workspace, result)
        if action == "compute.programme.pair-completion":
            result = self.operator.native_jobs.create_pair_completion(
                task, manager, key, expected_preview_id=payload.get("expected_preview_id"))
            if payload.get("run") is not True:
                return result
            key = result["id"]
            action = "compute.programme.run"
        if action == "compute.programme.run":
            # ES-SUPERVISION-20261012 programme execution
            result = self.operator.native_jobs.execute_programme(
                task, manager, key, only_runs=payload.get("only_runs"))
            # Preserve completed and partial native results if later summary
            # or report publication fails in this same queued task.
            task["result"] = result
            if result.get("state") == "failed" or result.get("counts", {}).get("failed", 0):
                counts = result.get("counts", {})
                raise self.Fault(
                    "PROGRAMME_INCOMPLETE",
                    "Programme retained with " + str(counts.get("complete", 0)) +
                    " completed runs and " + str(counts.get("failed", 0)) +
                    " failed runs. Open the programme to inspect each cause and resume.")
            if result.get("state") == "complete":
                from model.programme_experiments import sync_completed
                try:
                    synchronized = sync_completed(self.operator.ws(workspace), result)
                except Exception as exc:
                    raise self.Fault(
                        "EXPERIMENT_SUMMARY_INCOMPLETE",
                        "Native programme completed; experiment result synchronization needs correction: " + str(exc)) from exc
                if synchronized is not None:
                    result = {**result, "experiment_sync": synchronized}
                from model.programme_interactions import sync_completed as sync_interactions
                try:
                    interactions = sync_interactions(self.operator.ws(workspace), result)
                except Exception as exc:
                    raise self.Fault(
                        "INTERACTION_SUMMARY_INCOMPLETE",
                        "Native programme completed; conservation attribution needs correction: " + str(exc) +
                        ". Open the programme and reconcile attribution to continue from its retained runs.") from exc
                if interactions is not None:
                    result = {**result, "interaction_sync": interactions}
            return self._decorate(workspace, result)
        if action == "compute.programme.report":
            result = manager.report(key)
            task["result"] = result
            status = manager.status(key, include_ensemble_candidates=False)
            if status.get("state") == "complete":
                from model.programme_experiments import sync_completed
                try:
                    synchronized = sync_completed(self.operator.ws(workspace), status)
                except Exception as exc:
                    raise self.Fault(
                        "EXPERIMENT_REPORT_INCOMPLETE",
                        "The native programme and result catalogue are retained; "
                        "experiment reporting needs correction: " + str(exc)) from exc
                if synchronized is not None:
                    result = {**result, "experiment_sync": synchronized}
            return self._decorate(workspace, result)
        if action == "compute.programme.delivery":
            selection = payload.get("selection")
            if not isinstance(selection, dict):
                raise self.Fault("DELIVERY_SELECTION", "Choose the release selections.")
            return manager.prepare_delivery(key, selection)
        raise self.Fault("PROGRAMME_ACTION", "Choose a supported programme operation.")

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS:
            return task
        task = json.loads(json.dumps(task))
        payload = task.get("payload", {})
        result = task.get("result", {})
        key = payload.get("programme_id")
        manager = self._manager(task["workspace"])
        if task["action"] == "compute.programme.pair-completion":
            key = result.get("id") or key
            if not result.get("id") and key and payload.get("expected_preview_id"):
                try:
                    parent = manager.status(key, include_ensemble_candidates=False)
                    continuation = parent.get("pair_completions", {}).get(payload["expected_preview_id"], {})
                    key = continuation.get("programme_id") or key
                except (FileNotFoundError, KeyError, ValueError):
                    pass
        if not key and task["action"] in ("compute.programme.save", "compute.programme.experiment", "compute.programme.interaction"):
            key = result.get("id")
        downloads = list(task.get("_downloads") or [])
        if key:
            try:
                row = DEFAULT_VIEWS.read(manager.workspace, key, limit=0, include_cases=False)
                task["programme"] = {
                    "id": row["id"], "title": row.get("title"),
                    "state": row.get("state"), "phase": row.get("phase"),
                    "counts": row.get("counts", {}), "pause_requested": row.get("pause_requested", False),
                }
                downloads.extend(self._decorate(task["workspace"], row)["_downloads"])
                from model.programme_experiments import experiment_origin
                origin = experiment_origin(self.operator.ws(task["workspace"]), row)
                if origin is not None:
                    task["experiment"] = origin
                    provider = getattr(self.operator, "experiments", None)
                    if provider is not None:
                        retained = provider.retained_result(task["workspace"], origin["experiment_id"])
                        if retained is not None:
                            task["experiment"].update(
                                {name: retained[name] for name in
                                 ("title", "state", "progress", "study_report") if name in retained})
                            if retained.get("_report_error"):
                                task["experiment"]["report_error"] = retained["_report_error"]
                            downloads.extend(retained["_downloads"])
            except (OSError, KeyError, ValueError) as error:
                task["programme_report_error"] = str(error)
        if task.get("state") == "complete" and isinstance(result, dict):
            downloads.extend(self.operator._files(task["workspace"], result,
                                                  self.operator.ws(task["workspace"]).root))
        if downloads:
            task["_downloads"] = list({item["id"]: item for item in downloads}.values())
        return task
