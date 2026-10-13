"""Decision studies on the original operator queue, experiments and file transport.

The OPT12 engine, physical-metric receiver and report formats remain native.
Optional operation identities bind original queue retries to native SQL records.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import sqlite3

from model import experiments, experiment_diagnostics
from model.common import (atomic_bytes, atomic_json, canonical,
                          digest, held, identifier, now, read_json, verify_file)
from model.robust_decisions.eco_robust.engine import canonical_hash
from model.robust_decisions.eco_robust.integration import ACTION_NAMES, dispatch
from model.robust_decisions.eco_robust.operations import DecisionWorkspace
from model.robust_decisions.eco_robust.schema import Study

READS = frozenset({"catalog", "study", "run", "methods", "experiment", "diagnostic",
                   "delivery-options", "delivery-release"})
RECEIPT_SCHEMA = "upstate.robust-operator-operation/v1"


def _revision(value, *, optional=False):
    if optional and value in (None, ""):
        return None
    if isinstance(value, str) and re.fullmatch(r"[1-9][0-9]*", value):
        value = int(value)
    if type(value) is not int or value < 1:
        raise ValueError("Select a positive retained study revision")
    return value


def _point_index(value):
    """A frontier choice is explicit and zero based; no implicit first point."""
    if value in (None, ""):
        return None
    if isinstance(value, str) and re.fullmatch(r"0|[1-9][0-9]*", value):
        value = int(value)
    if type(value) is not int or value < 0:
        raise ValueError("Select a nonnegative retained frontier point index")
    return value


def _native_id(value, family):
    if not isinstance(value, str) or not re.fullmatch(family + r"_[0-9a-f]{32}", value):
        raise ValueError("Select an original decision " + family + " ID")
    return value


def _json_file(path):
    def invalid(value):
        raise ValueError("JSON contains a nonfinite number: " + value)
    value = json.loads(Path(path).read_text(encoding="utf-8-sig"), parse_constant=invalid)
    if not isinstance(value, dict):
        raise ValueError("Select a complete JSON document")
    canonical(value)
    return value


def _receipt_path(ws, operation_id):
    return ws.root / "robust-operator-operations" / identifier(operation_id) / "operation.json"


def _receipt(ws, operation_id):
    path = _receipt_path(ws, operation_id)
    if not path.exists():
        return None
    value = read_json(path)
    if (value.get("schema") != RECEIPT_SCHEMA or value.get("id") != operation_id
            or value.get("workspace_id") != ws.project["id"]
            or value.get("result_sha256") != digest(value.get("result"))):
        raise ValueError("The retained decision operation identity differs")
    return value


def _export_body(action, result):
    if action == "robust.report.export":
        filename = result.get("filename")
        if filename not in {"decision-report.html", "decision-report.csv"}:
            raise ValueError("The native report returned an unsupported filename")
        return filename, result["content"].encode("utf-8"), "Decision report"
    if action == "robust.project.export":
        return "decision-project.json", canonical(result) + b"\n", "Complete decision study"
    if action == "robust.selection.export":
        return "implementation-selection.json", canonical(result) + b"\n", "Implementation selection"
    return None


class RobustWorkbench:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _configuration(self, ws, experiment_id, summary):
        rows = [row for row in summary.get("rows", summary.get("cases", []))
                if row.get("kind") == "landcover"]
        if not rows:
            raise ValueError("The retained experiment has no land-cover alternatives")
        candidates, profiles, metrics = {}, {}, {}
        # A summary contains persisted cases, not necessarily every planned
        # case. Page the original native index so unstarted alternatives and
        # derived profiles remain explicit choices in a partial experiment.
        planned, offset = [], 0
        while True:
            page = experiments.inspect(ws, experiment_id, offset=offset, limit=256)
            planned.extend(row for row in page["cases"] if row.get("kind") == "landcover")
            following = page["next_offset"]
            if following is None:
                break
            if type(following) is not int or following <= offset:
                raise ValueError("The original experiment case index did not advance")
            offset = following
        for row in planned:
            sid, pid = row.get("scenario_id"), row.get("profile_id")
            if not isinstance(sid, str) or not isinstance(pid, str):
                raise ValueError("The retained experiment row lacks native scenario/profile identities")
            candidates.setdefault(sid, {
                "id": sid, "label": row.get("scenario_title") or sid,
                "cost": None, "capacity": None, "group": None,
                "required": False, "excluded": False, "source": {"scenario_id": sid}})
            profiles.setdefault(pid, {
                "id": pid, "label": row.get("profile_title") or pid,
                "probability": None, "source": {"profile_id": pid}})
        # Physical units come only from retained native output metrics.
        for row in rows:
            for name, value in row.get("metrics", {}).items():
                units = value.get("units") if isinstance(value, dict) else None
                if not isinstance(units, str) or not units:
                    raise ValueError("The original physical metric has no units: " + name)
                if name in metrics and metrics[name]["units"] != units:
                    raise ValueError("The original experiment mixes units for " + name)
                metrics.setdefault(name, {
                    "id": name, "label": name.replace("_", " "),
                    "units": units, "scale": None, "weight": None, "guaranteed_gain": None})
        if not candidates or not profiles:
            raise ValueError("The original experiment plan has no land-cover decision alternatives")
        if not metrics:
            raise ValueError("The selected experiment has no retained physical metrics yet")
        # Saved native labels supplement, never replace, the exact source IDs.
        for values, kind in ((candidates, "scenarios"), (profiles, "profiles")):
            for key, row in values.items():
                path = ws.root / kind / (key + ".json")
                if re.fullmatch(r"[0-9a-f]{64}", key) and path.is_file():
                    row["label"] = ws._get(kind, key).get("title") or row["label"]
        return {
            "schema_version": "ecosci.robust-study/1",
            "title": summary.get("title") or "Decision study: " + experiment_id,
            "mode": "native_packages", "additive_basis": None,
            "metrics": list(metrics.values()), "candidates": list(candidates.values()),
            "profiles": list(profiles.values()), "budget": None, "cost_units": "",
            "capacity": None, "group_limits": {},
            "source": {"experiment_id": experiment_id, "workspace_id": ws.project["id"],
                       "grid_id": summary.get("grid_id") or summary.get("summary", {}).get("grid_id")},
            "notes": "",
        }

    def _read(self, ws, workspace_key, operation, value):
        if operation == "methods":
            return {"study_schema": Study.model_json_schema(),
                    "modes": ["native_packages", "additive_actions"],
                    "objectives": ["worst_case", "minimax_regret", "expected"],
                    "actions": sorted(ACTION_NAMES),
                    "configuration_fields": {
                        "metric": ["scale", "weight", "guaranteed_gain"],
                        "candidate": ["cost", "capacity", "group", "required", "excluded"],
                        "profile": ["probability"],
                        "study": ["title", "budget", "cost_units", "capacity", "group_limits", "notes"]}}
        if operation in {"delivery-options", "delivery-release"}:
            # The original saved calculation is authoritative. Read its bound
            # revision directly, without Store construction or a SQL migration.
            from model.robust_decisions.eco_robust.decision_delivery import describe
            profile_id = None
            if operation == "delivery-release":
                profile_id = identifier(value.get("profile_id"))
            result = describe(
                ws, _native_id(value.get("study_id"), "study"),
                _native_id(value.get("run_id"), "run"), profile_id,
                point_index=_point_index(value.get("point_index")))
            if operation == "delivery-release":
                if not result.get("ready") or not isinstance(result.get("selection"), dict):
                    issues = result.get("issues") or ["The selected native profile is not ready for delivery"]
                    raise self.Fault("DECISION_DELIVERY_UNAVAILABLE",
                                     "; ".join(str(item.get("message") or item.get("code") or
                                                   "Unavailable native profile")
                                               if isinstance(item, dict) else str(item)
                                               for item in issues), 409)
                return {"kind": "native_delivery", **result}
            return result
        native = DecisionWorkspace(ws)
        native.recover()
        if operation == "catalog":
            catalogue = []
            for item in experiments.list_experiments(ws):
                key = identifier(item["id"])
                catalogue.append({**item, "summary_available":
                                  (ws.root / "experiments" / key / "summary.json").is_file()})
            return {"studies": native.store.list(), "experiments": catalogue,
                    "diagnostics": experiment_diagnostics.listing(ws)}
        if operation == "study":
            result = native.store.read(_native_id(value.get("study_id"), "study"),
                                       _revision(value.get("revision"), optional=True))
            result["operations"] = self._study_operations(ws, workspace_key, result["id"])
            result["_downloads"] = [ticket for item in result["operations"]
                                    for ticket in item["_downloads"]]
            return result
        if operation == "run":
            return native.store.read_run(_native_id(value.get("study_id"), "study"),
                                         _native_id(value.get("run_id"), "run"))
        if operation == "diagnostic":
            from model.robust_decisions.eco_robust.diagnostics import preview
            return preview(ws, identifier(value.get("diagnostic_id")))
        if operation == "experiment":
            key = identifier(value.get("experiment_id"))
            summary = experiments.read_summary(ws, key)
            if summary is None:
                raise ValueError("This experiment has no retained summary yet")
            return {"experiment_id": key, "summary": summary,
                    "configuration": self._configuration(ws, key, summary)}
        raise self.Fault("ROBUST_READ", "Choose a supported decision study view.", 404)

    def _study_operations(self, ws, workspace_key, study_id):
        result = []
        for path in (ws.root / "robust-operator-operations").glob("*/operation.json"):
            record = _receipt(ws, path.parent.name)
            selection = record.get("selection", {})
            if selection.get("study_id") != study_id:
                continue
            downloads = []
            for file in record["files"].values():
                original = verify_file(ws.root, file)
                downloads.append(self.operator._ticket(
                    workspace_key,
                    original, file, file["label"] + " — " + record["completed_at"]))
            result.append({"id": record["id"], "action": record["action"],
                           "completed_at": record["completed_at"],
                           "selection": selection, "_downloads": downloads})
        return sorted(result, key=lambda row: (row["completed_at"], row["id"]), reverse=True)

    def read(self, workspace_key, operation, payload=None):
        ws = self.operator.ws(workspace_key)
        value = payload or {}
        if operation not in READS or not isinstance(value, dict):
            raise self.Fault("ROBUST_REQUEST", "Choose a decision study read and selection object.")
        try:
            with held(ws.root / ".workspace.lock", blocking=False):
                result = self._read(ws, workspace_key, operation, value)
        except BlockingIOError:
            raise self.Fault("WORKSPACE_ACTIVE",
                             "The workspace is finishing an active operation; reopen this decision view when it completes.", 409)
        return {"workspace_key": workspace_key, **result}

    def _uploaded(self, key):
        record = self.operator.upload(key)
        return _json_file(record["path"])

    def _payload(self, action, value):
        value = deepcopy(value)
        if "upload_id" in value:
            field = {"robust.study.create": "study", "robust.project.receive": "project"}.get(action)
            if field is None or field in value:
                raise ValueError("Select one original uploaded or inline decision document")
            value[field] = self._uploaded(value.pop("upload_id"))
        if action == "robust.summary.prepare" and "summary_upload_id" in value:
            if "summary" in value:
                raise ValueError("Select one original experiment summary")
            value["summary"] = self._uploaded(value.pop("summary_upload_id"))
        if action in {"robust.summary.prepare", "robust.experiment.prepare", "robust.diagnostic.prepare"} and "configuration_upload_id" in value:
            if "configuration" in value:
                raise ValueError("Select one decision configuration")
            value["configuration"] = self._uploaded(value.pop("configuration_upload_id"))
        if action == "robust.diagnostic.prepare":
            identifier(value.get("diagnostic_id"))
            identifier(value.get("report_sha256"))
        if "study_id" in value:
            _native_id(value["study_id"], "study")
        if "run_id" in value:
            _native_id(value["run_id"], "run")
        for key in ("revision", "expected_revision"):
            if key in value:
                value[key] = _revision(value[key], optional=(action == "robust.study.read" and key == "revision"))
        if action in {"robust.solve", "robust.frontier"} and "revision" not in value:
            raise ValueError("Bind the calculation to the selected saved revision")
        canonical(value)
        return value

    def invoke(self, task):
        action, operation_id = task["action"], identifier(task["id"])
        if action not in ACTION_NAMES:
            raise self.Fault("ROBUST_ACTION", "Choose an original decision operation.", 404)
        ws = self.operator.ws(task["workspace"])
        with held(ws.root / ".workspace.lock"):
            previous = _receipt(ws, operation_id)
            if previous is not None:
                if (previous["action"] != action
                        or previous["request_sha256"] != task["request_sha256"]):
                    raise ValueError("The original operator request identity differs")
                result = previous["result"]
            else:
                payload = self._payload(action, task["payload"])
                result = dispatch(ws, action, payload, operation_id=operation_id)
                selection = {key: payload[key] for key in ("study_id", "revision", "run_id")
                             if key in payload}
                if isinstance(result, dict) and isinstance(result.get("id"), str) and result["id"].startswith("study_"):
                    selection = {**selection, "study_id": result["id"], "revision": result["revision"]}
                if isinstance(result, dict) and result.get("run_id"):
                    selection.update(run_id=result["run_id"], revision=result["revision"])
                previous = {"schema": RECEIPT_SCHEMA, "id": operation_id,
                            "workspace_id": ws.project["id"], "action": action,
                            "request_sha256": task["request_sha256"],
                            "resolved_payload_sha256": digest(payload),
                            "result_sha256": digest(result), "result": result,
                            "completed_at": now(), "selection": selection, "files": {}}
                export = _export_body(action, result)
                if export is not None:
                    name, body, label = export
                    relative = (_receipt_path(ws, operation_id).parent / name).relative_to(ws.root).as_posix()
                    previous["files"]["export"] = {
                        "path": relative, "sha256": hashlib.sha256(body).hexdigest(),
                        "bytes": len(body), "label": label}
                # Commit the first native answer before publishing artifacts. A
                # resumed operation returns this same answer and repairs only an
                # interrupted file write from its retained original bytes.
                atomic_json(_receipt_path(ws, operation_id), previous, immutable=True)
            export = _export_body(action, result)
            if export is not None:
                name, body, _ = export
                atomic_bytes(_receipt_path(ws, operation_id).parent / name, body, immutable=True)
            return result

    def decorate_task(self, task):
        if task.get("action") not in ACTION_NAMES or task.get("state") != "complete":
            return task
        ws = self.operator.ws(task["workspace"])
        record = _receipt(ws, identifier(task["id"]))
        if record is None:
            return task
        if (record["action"] != task["action"]
                or record["request_sha256"] != task["request_sha256"]
                or record["result_sha256"] != digest(task.get("result"))):
            raise ValueError("The completed decision task differs from its retained original answer")
        value = deepcopy(task)
        downloads = list(value.get("_downloads") or [])
        for file in record["files"].values():
            path = verify_file(ws.root, file)
            downloads.append(self.operator._ticket(task["workspace"], path, file, file["label"]))
        value["_downloads"] = downloads
        return value

    def verify_all(self, workspace):
        """Read restored SQL without migrating or changing any archived database byte."""
        path = workspace.root / "robust_decisions" / "robust_decisions.sqlite3"
        counts = {"studies": 0, "revisions": 0, "runs": 0, "operations": 0}
        if not path.exists():
            if any((workspace.root / "robust-operator-operations").glob("*/operation.json")):
                raise ValueError("The restored decision operations lack their original database")
            return counts
        # The original workspace.restore retry compares the received bytes with
        # ARCHIVE.json. Store construction would run schema/WAL setup, so restore
        # verification opens read-only and leaves migration to normal desk use.
        db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        try:
            db.execute("BEGIN")
            if [row[0] for row in db.execute("PRAGMA quick_check")] != ["ok"]:
                raise ValueError("The restored native decision store is unreadable")
            studies = db.execute("SELECT * FROM studies ORDER BY created").fetchall()
            for study in studies:
                revisions = db.execute("SELECT * FROM revisions WHERE study_id=? ORDER BY revision",
                                       (study["id"],)).fetchall()
                if [row["revision"] for row in revisions] != list(range(1, study["head"] + 1)):
                    raise ValueError("The retained decision revision history is incomplete")
                identities = {}
                for row in revisions:
                    value = json.loads(row["input"])
                    Study.model_validate(value)
                    from model.robust_decisions.eco_robust.diagnostics import verify_binding
                    verify_binding(workspace, value.get("source", {}))
                    if canonical_hash(value) != row["sha256"]:
                        raise ValueError("The retained study revision identity differs")
                    identities[row["revision"]] = row["sha256"]
                runs = db.execute("SELECT * FROM runs WHERE study_id=?", (study["id"],)).fetchall()
                for run in runs:
                    if run["revision"] not in identities:
                        raise ValueError("The retained calculation belongs to another study revision")
                    answer = None if run["result"] is None else json.loads(run["result"])
                    if answer is not None and answer.get("study_sha256") != identities[run["revision"]]:
                        raise ValueError("The retained calculation differs from its original study")
                counts["studies"] += 1
                counts["revisions"] += len(revisions)
                counts["runs"] += len(runs)
            # Older native projects are valid without our additive operation map.
            if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='operator_operations'").fetchone():
                for row in db.execute("SELECT * FROM operator_operations").fetchall():
                    if row["kind"] == "calculation":
                        original = db.execute("SELECT revision FROM runs WHERE id=?", (row["result_id"],)).fetchone()
                    elif row["kind"] in {"create", "revise", "receive"}:
                        original = db.execute("SELECT revision FROM revisions WHERE study_id=? AND revision=?",
                                              (row["result_id"], row["result_revision"])).fetchone()
                    else:
                        raise ValueError("A retained operator identity has an unknown native operation")
                    if original is None or original["revision"] != row["result_revision"]:
                        raise ValueError("A retained operator identity lost its native decision record")
        finally:
            db.close()
        for path in (workspace.root / "robust-operator-operations").glob("*/operation.json"):
            record = _receipt(workspace, path.parent.name)
            for file in record["files"].values():
                verify_file(workspace.root, file)
            counts["operations"] += 1
        return counts
