"""Shared operator bindings for complete native paired-raster analyses.

The existing Operator supplies authorization, uploads, verified file tickets and
its durable task queue. Scientific execution stays in model.paired_ensemble.
Copyright 2026 TokenJunkieLabs.
"""
from __future__ import annotations
import math
import zipfile

from model.common import atomic_json, held, now

from model.paired_ensemble.ensemble_workspace import EnsembleWorkspace
from model.paired_ensemble.designs import available_outputs, design_cohort
from model.paired_ensemble.ensemble_rasters import UNITS, SUPPORT, checked_quantiles
from model.paired_ensemble.ensemble_store import digest, fingerprint, identifier, member, read, verify
from model.paired_ensemble.ensemble_portable import _manifest, receive_project

ACTIONS = frozenset({
    "paired_ensemble.build", "paired_ensemble.resume",
    "paired_ensemble.export", "paired_ensemble.receive",
})
REPORT_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; sandbox allow-same-origin allow-downloads; base-uri 'none'; form-action 'none'"
POLLUTANTS = tuple(UNITS)


def checked_selection(selection):
    """Validate scalar controls before the original source-binding preview."""
    if not isinstance(selection, dict):
        raise ValueError("Choose a paired-raster selection object.")
    for field in ("title", "purpose"):
        if not isinstance(selection.get(field), str) or not selection[field].strip():
            raise ValueError("Describe the analysis " + field + ".")
    pairs = selection.get("pairs")
    if not isinstance(pairs, list) or not pairs:
        raise ValueError("Select at least one completed same-profile native pair.")
    pollutants = selection.get("pollutants", list(POLLUTANTS))
    if (not isinstance(pollutants, list) or not pollutants
            or any(not isinstance(name, str) or name not in POLLUTANTS for name in pollutants)
            or len(set(pollutants)) != len(pollutants)):
        raise ValueError("Select distinct original physical pollutant outputs.")
    checked_quantiles(selection.get("quantiles", [0.1, 0.5, 0.9]))
    if selection.get("support", "all_pairs") not in SUPPORT:
        raise ValueError("Select an existing quantitative support rule.")
    planned = selection.get("planned_member_count", len(pairs))
    if isinstance(planned, bool) or not isinstance(planned, int) or planned < len(pairs):
        raise ValueError("The planned member count must include every selected pair.")
    memory = selection.get("memory_mb", 256)
    if isinstance(memory, bool) or not isinstance(memory, (int, float)) or not math.isfinite(memory) or memory <= 0:
        raise ValueError("Select a positive tile-array memory budget in MiB.")
    tile = selection.get("tile_size", 256)
    if isinstance(tile, bool) or not isinstance(tile, int) or not 1 <= tile <= 2048:
        raise ValueError("Select a tile edge from 1 to 2048 pixels.")
    handles = selection.get("max_open_datasets", 48)
    if isinstance(handles, bool) or not isinstance(handles, int) or handles < 2:
        raise ValueError("Allow at least two open raster handles.")
    thresholds = selection.get("improvement_thresholds", {})
    if not isinstance(thresholds, dict) or any(name not in pollutants for name in thresholds):
        raise ValueError("Improvement thresholds must name a selected pollutant.")
    for value in thresholds.values():
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            raise ValueError("Improvement thresholds must be finite nonnegative pixel-mass quantities.")
    return selection


class PairedEnsembleService:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def _app(self, workspace_key):
        return EnsembleWorkspace(self.operator.ws(workspace_key))

    def saved_view(self, workspace_key):
        app = self._app(workspace_key)
        path = app.workspace.root / "paired-ensemble-view.json"
        if not path.is_file():
            return None
        value = read(path)
        if (not isinstance(value, dict) or value.get("schema") != "upstate.paired-ensemble-view/v1"
                or value.get("project_id") != app.workspace.project["id"]):
            raise self.Fault("PAIRED_VIEW", "Select a result to save a view for this scientific project.", 409)
        app.describe(identifier(value["ensemble_id"]))
        return value

    def save_view(self, workspace_key, payload):
        app = self._app(workspace_key)
        key = identifier(payload.get("ensemble_id"))
        app.describe(key)
        value = {"schema": "upstate.paired-ensemble-view/v1",
                 "project_id": app.workspace.project["id"],
                 "ensemble_id": key, "saved_at": now()}
        try:
            with held(app.workspace.root / ".operator-session.lock", blocking=False):
                atomic_json(app.workspace.root / "paired-ensemble-view.json", value)
        except BlockingIOError as error:
            raise self.Fault("PAIRED_VIEW_BUSY", "A project view or archive save is in progress. Reopen this result when that save finishes.", 409) from error
        return value

    def native_context(self, app, result):
        members = result.get("selection", {}).get("members", [])
        required = {row.get(side) for row in members
                    for side in ("baseline_run_id", "alternative_run_id") if row.get(side)}
        available = {row["id"] for row in app.workspace.overview().get("runs", [])}
        native = result.get("selection", {}).get("input_kind") == "original Workspace native run artifacts"
        return {"available_run_ids": sorted(required & available),
                "missing_run_ids": sorted(required - available),
                "can_resume": native and bool(required) and required <= available}

    def overview(self, workspace_key):
        from paired_ensemble_provider import overview
        return overview(self.operator, workspace_key)

    def _task(self, workspace_key, task_id, *, analysis_only=False):
        task = self.operator.task(identifier(task_id))
        allowed = {"paired_ensemble.build", "paired_ensemble.resume"} if analysis_only else ACTIONS
        if task.get("workspace") != workspace_key or task.get("action") not in allowed:
            raise self.Fault("PAIRED_TASK_SCOPE", "Choose a paired-raster task in this workspace.", 409)
        return task

    def catalog(self, workspace_key):
        ws = self.operator.ws(workspace_key)
        snapshot = ws.overview()
        runs = []
        for row in snapshot.get("runs", []):
            value = ws.inspect_run(identifier(row["id"]))
            runs.append({
                "id": value["id"], "state": value["state"], "selection": value["selection"],
                "available_pollutants": available_outputs(value),
                "error": value.get("error"), "completed_at": value.get("completed_at"),
            })
        from model.ensembles import Ensembles
        designs = []
        for plan in Ensembles(ws).list():
            designs.append({
                "id": plan["id"], "title": plan["title"], "state": plan["state"],
                "grid_id": plan["grid_id"], "baseline_scenario_id": plan["baseline_scenario_id"],
                "alternative_scenario_ids": plan.get("alternative_scenario_ids", []),
                "member_count": len(plan["members"]), "progress": plan["progress"],
                "model_scope": plan.get("model_scope"),
            })
        products = self.overview(workspace_key)
        try:
            view, view_error = self.saved_view(workspace_key), None
        except (KeyError, ValueError, OSError, self.Fault) as error:
            view, view_error = None, str(error)
        return {
            "schema": "upstate.paired-ensemble-catalog/v1",
            "workspace_id": ws.project["id"],
            "workspace_key": workspace_key, "runs": runs, "designs": designs,
            "saved_view": view, "saved_view_error": view_error,
            "grids": snapshot.get("grids", []), "profiles": snapshot.get("profiles", []),
            "scenarios": snapshot.get("scenarios", []), "products": products, "editions": products,
            "pollutants": [{"id": name, "units": UNITS[name]} for name in POLLUTANTS],
        }

    def _records(self, app, key, result):
        complete = result.get("state") == "complete"
        reports = result.get("reports", {}).get("files", []) if complete else []
        records = list(result.get("artifacts", {}).values()) + reports
        # JSON descriptions are small and their fingerprints are computed only
        # for an explicit item/member request, never on the state poll.
        for name in (("analysis.json", "reports.json") if complete else ("analysis.json",)):
            path = app.root / key / name
            if path.is_file():
                records.append({"path": name, **fingerprint(path)})
        return records

    def item(self, workspace_key, key):
        key = identifier(key)
        app = self._app(workspace_key)
        value = app.describe(key)
        records = self._records(app, key, value)
        result = {**value, "native_context": self.native_context(app, value),
                  "execution_settings": app.execution_settings(key),
                  "reports": value.get("reports", {}) if value.get("state") == "complete" else {}, "_downloads": [
            self.operator._ticket(workspace_key, member(app.root / key, row["path"]), row, row["path"])
            for row in records
        ]}
        if any(row["path"] == "index.html" for row in records):
            result["_report_url"] = "/api/file/paired-ensemble/" + workspace_key + "/" + key + "/index.html"
        return result

    def member(self, workspace_key, ensemble_id, member_path):
        key = identifier(ensemble_id)
        app = self._app(workspace_key)
        value = app.describe(key)
        row = next((item for item in self._records(app, key, value) if item["path"] == member_path), None)
        if row is None:
            raise self.Fault("PAIRED_MEMBER", "Select a retained quantitative or report file.", 404)
        path = verify(app.root / key, row)
        ticket = self.operator._ticket(workspace_key, path, row, path.name)
        return ticket, REPORT_POLICY if path.suffix == ".html" else None

    def retained_selection(self, workspace_key, ensemble_id):
        """Recover native pairs and accepted controls after browser loss."""
        app = self._app(workspace_key)
        result = app.describe(identifier(ensemble_id))
        if result["selection"].get("input_kind") != "original Workspace native run artifacts":
            raise self.Fault("PAIRED_NATIVE_SELECTION", "Choose an analysis bound to original Workspace native runs.", 409)
        selection = app.retained_selection(result["id"])
        return {"ensemble_id": result["id"], "state": result["state"],
                "selection": selection,
                "source_kernel_sha256": result["selection"]["kernel_sha256"]}

    def read(self, workspace_key, operation, payload=None):
        payload = payload or {}
        app = self._app(workspace_key)
        if operation == "catalog":
            return self.catalog(workspace_key)
        if operation == "view":
            return self.saved_view(workspace_key)
        if operation == "view.save":
            return self.save_view(workspace_key, payload)
        if operation == "edition":
            # Preserve the original shared-host report reader for earlier
            # installed views and experiment links.
            from paired_ensemble_provider import _files, _preview_document
            result = app.describe(identifier(payload.get("id") or payload.get("ensemble_id")))
            if result["state"] == "complete":
                tickets = _files(self.operator, workspace_key, result)
                result["_downloads"] = list(tickets.values())
                result["document"] = _preview_document(app, result, tickets)
            else:
                result["reports"] = {}
            return result
        if operation == "selection":
            return self.retained_selection(workspace_key, payload.get("ensemble_id"))
        if operation == "inspect":
            return self.item(workspace_key, payload.get("ensemble_id") or payload.get("id"))
        if operation == "cohort":
            return design_cohort(app.workspace, payload.get("design_id"), payload.get("scenario_id"))
        if operation == "preview":
            selection = checked_selection(payload.get("selection"))
            return {**app.preview(selection), "selection_id": digest(selection)}
        if operation == "progress":
            task = None
            if payload.get("task_id"):
                task = self._task(workspace_key, payload["task_id"], analysis_only=True)
                key = digest(task["payload"])
            else:
                key = identifier(payload.get("selection_id"))
            path = app.root / "controls" / (key + ".json")
            progress = read(path) if path.is_file() else {"state": "not_started"}
            if task is not None:
                progress = {**progress, "task_id": task["id"], "task_state": task["state"],
                            "task_error": task.get("error"), "selection_id": key}
            return progress
        if operation == "pause":
            if payload.get("task_id"):
                task = self._task(workspace_key, payload["task_id"], analysis_only=True)
                selection = task["payload"]
            else:
                selection = payload.get("selection")
                if not isinstance(selection, dict):
                    raise self.Fault("PAIRED_SELECTION", "Choose the retained running selection.")
            return app.cancel(selection)
        raise self.Fault("PAIRED_ROUTE", "Choose a registered paired-raster operation.", 404)

    def invoke(self, task):
        workspace_key = task["workspace"]
        action, payload = task["action"], task["payload"]
        app = self._app(workspace_key)
        if action in {"paired_ensemble.build", "paired_ensemble.resume"}:
            selection = checked_selection(payload)
            method = app.resume if action == "paired_ensemble.resume" else app.build
            return method(selection)
        if action == "paired_ensemble.export":
            key = identifier(payload["ensemble_id"])
            current = app.describe(key)
            if current["state"] != "complete" or not current.get("reports", {}).get("files"):
                raise self.Fault("PAIRED_INCOMPLETE", "Complete the analysis and report before exporting its project.", 409)
            # Retain every earlier export. A changed report has a distinct
            # destination, while retrying the same report reuses its archive.
            revision = digest(current["reports"])
            destination = self.operator.root / "outputs" / (task["id"] + "." + revision[:16] + ".ensemble.zip")
            if destination.exists():
                with zipfile.ZipFile(destination) as archive:
                    manifest, _ = _manifest(archive, None)
                if manifest.get("ensemble_id") != key:
                    raise ValueError("Retained export belongs to another analysis.")
                for name, expected in manifest["members"].items():
                    verify(app.root / key, {**expected, "path": name})
                return {"ensemble_id": key, "path": str(destination), **fingerprint(destination), "reused": True}
            return app.portable(key, destination)
        if action == "paired_ensemble.receive":
            uploaded = self.operator.upload(payload["upload_id"])
            with zipfile.ZipFile(uploaded["path"]) as archive:
                manifest, _ = _manifest(archive, self.operator.extraction_limit)
            key = identifier(manifest["ensemble_id"])
            destination = app.root / key
            if destination.exists():
                retained = app.describe(key)
                if retained["state"] != "complete":
                    raise self.Fault("PAIRED_RECEIVE_EXISTS", "Resume the existing analysis before receiving this complete result.", 409)
                for name, expected in manifest["members"].items():
                    verify(destination, {**expected, "path": name})
                return {"id": key, "state": retained["state"], "reused": True}
            received = receive_project(uploaded["path"], destination, max_bytes=self.operator.extraction_limit)
            return {"id": key, "state": "complete", "received": received}
        raise self.Fault("PAIRED_ACTION", "Choose a registered paired-raster action.", 404)

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or task.get("state") != "complete":
            return task
        result = task.get("result") or {}
        if task["action"] == "paired_ensemble.export":
            task["_downloads"] = [
                self.operator._ticket(task["workspace"], result["path"], result, "Complete paired-raster project")
            ]
        elif result.get("id"):
            value = self.item(task["workspace"], result["id"])
            task["_downloads"] = value["_downloads"]
            if value.get("_report_url"):
                task["_report_url"] = value["_report_url"]
            task["_analysis_state"] = value["state"]
            if value["state"] == "complete":
                task["_paired_ensemble_id"] = value["id"]
        return task


def verify_workspace(workspace):
    """Verify retained record relationships inside the original restore flow.

    Original workspace receiving already verifies archive file hashes. This
    hook validates product identities and declared membership without repeating
    full raster reads during workspace registration.
    """
    app = EnsembleWorkspace(workspace)
    complete = partial = 0
    for row in app.list():
        key = identifier(row["id"])
        value = app.describe(key)
        reports = value.get("reports", {})
        if reports and reports.get("ensemble_id") != key:
            raise ValueError("A retained raster report belongs to another analysis.")
        records = list(value.get("artifacts", {}).values()) + reports.get("files", [])
        for record in records:
            path = member(app.root / key, record["path"])
            identifier(record["sha256"])
            if path.stat().st_size != record["bytes"]:
                raise ValueError("Retained quantitative/report member length differs: " + record["path"])
        if value["state"] == "complete":
            complete += 1
        else:
            partial += 1
    return {"complete": complete, "partial": partial}
