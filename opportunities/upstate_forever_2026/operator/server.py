"""Local operator over the original retained scientific Workspace."""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import contextlib
import gzip
import hashlib
import hmac
import importlib.metadata
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import signal
import stat
import sys
import tempfile
import threading
import traceback
import urllib.parse
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import zipfile

APPLICATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION))
from model.common import atomic_json, canonical, digest, file_digest, held, now, read_json
from model.workspace import Workspace
from model.record_catalog import ProjectedFileCache, task_summary
from model import portable
sys.path.insert(0, str(Path(__file__).resolve().parent))
# ES-SUPERVISION-20261012
from native_jobs import NativeJobs, NativeJobError, NativeJobCancelled, NativeJobDetached
sys.path.insert(0, str(Path(__file__).resolve().parent))
from rehearsal import Rehearsals, ACTIONS as REHEARSAL_ACTIONS, READS as REHEARSAL_READS
from model.spatial import SpatialReview
sys.path.insert(0, str(Path(__file__).resolve().parent))
from customer_reviews import CustomerReviews, ACTIONS as CUSTOMER_REVIEW_ACTIONS, READS as CUSTOMER_REVIEW_READS
from experiment_operator import ExperimentOperator, ACTIONS as EXPERIMENT_ACTIONS, READS as EXPERIMENT_READS
from parameter_study_api import ParameterStudyAPI, ACTIONS as PARAMETER_STUDY_ACTIONS, READS as PARAMETER_STUDY_READS
from model.spatial_exports import SpatialExports
from implementation_operator import implementation_error
from delivery_review import read as read_delivery_report, send_preview as send_delivery_report_preview, REPORT_EDITION as CLIENT_REPORT_EDITION
from extension_registry import ExtensionRegistry
from programmes import Programmes, ACTIONS as PROGRAMME_ACTIONS, READS as PROGRAMME_READS
from task_requests import TaskRequests
from team_access import TeamAccess, CONTEXT
from study_catalogues import StudyCatalogues
from programme_activity import ProgrammeActivity

JSON_GZIP_MIN_BYTES = 32 * 1024
JSON_ENCODING_QUALITY = re.compile(r"(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)\Z")


def _json_encoding_qualities(header: str | None) -> tuple[float, float]:
    """Return gzip/identity preferences; absent or empty headers use identity."""
    if not header or not header.strip():
        return 0.0, 1.0
    choices: dict[str, float] = {}
    for item in header.split(","):
        fields = [field.strip() for field in item.split(";")]
        coding = fields[0].lower()
        if not coding:
            continue
        weight = 1.0
        if len(fields) > 1:
            parameter = fields[1].split("=", 1)
            if (len(fields) != 2 or len(parameter) != 2
                    or parameter[0].strip().lower() != "q"
                    or not JSON_ENCODING_QUALITY.fullmatch(parameter[1].strip())):
                weight = 0.0
            else:
                weight = float(parameter[1].strip())
        # A repeated explicit refusal must not be undone by a later duplicate.
        choices[coding] = min(choices.get(coding, 1.0), weight)
    wildcard = choices.get("*")
    gzip_weight = choices.get("gzip", wildcard if wildcard is not None else 0.0)
    identity_weight = choices.get("identity", 0.0 if wildcard == 0.0 else 1.0)
    return gzip_weight, identity_weight


def _encode_json_response(body: bytes, accept_encoding: str | None) -> tuple[bytes, str | None] | None:
    """Return wire bytes and coding, or None when both supported forms are refused.

    JSON serialization stays with the original caller. Gzip is chosen only when
    accepted and at least as preferred as identity, and normally only when it
    reduces a response of 32 KiB or more. An explicit identity refusal permits
    gzip at any size. No archive, source file, range, or original digest changes.
    """
    gzip_weight, identity_weight = _json_encoding_qualities(accept_encoding)
    if gzip_weight <= 0.0:
        return (body, None) if identity_weight > 0.0 else None
    if identity_weight > gzip_weight:
        return body, None
    if len(body) < JSON_GZIP_MIN_BYTES and identity_weight > 0.0:
        return body, None
    compressed = gzip.compress(body, compresslevel=1, mtime=0)
    if len(compressed) >= len(body) and identity_weight > 0.0:
        return body, None
    return compressed, "gzip"

JSON_LIMIT = 4 * 1024 * 1024
ACTIVE = {"queued", "running"}
KINDS = {"sources", "profiles", "scenarios", "grids", "runs", "observations",
         "comparisons", "observation_comparisons", "deliveries", "spatial_reviews", "spatial_exports",
         "community_tables", "community_plans", "community_reports",
         "planning_inventories", "portfolios", "portfolio_reports", "parameter-studies"}
ACTIONS = {"source.import", "profile.save", "scenario.save", "grid.prepare",
           "run.prepare", "run.start", "run.compare", "observation.import",
           "observation.compare", "delivery.build", "workspace.backup", "workspace.restore",
           "spatial.review.save", "spatial.review.export", "community.table.import", "community.plan.save",
           "community.report.build", "portfolio.inventory.build", "portfolio.preview", "portfolio.save",
           "portfolio.scenario.prepare", "portfolio.report.build", "portfolio.decision.build",
           "portfolio.run.prepare", "portfolio.run.start"}
ACTIONS.update(REHEARSAL_ACTIONS)
ACTIONS.update(CUSTOMER_REVIEW_ACTIONS)
ACTIONS.update(EXPERIMENT_ACTIONS)
ACTIONS.update(PARAMETER_STUDY_ACTIONS)
ACTIONS.update(PROGRAMME_ACTIONS)

class Fault(Exception):
    def __init__(self, code, message, status=422):
        super().__init__(message)
        self.code, self.status = code, status

def required(value, name):
    result = value.get(name)
    if not isinstance(result, str) or not result:
        raise Fault("INPUT_REQUIRED", "Choose " + name.replace("_", " ") + ".")
    return result

def token(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise Fault("ITEM_ID", "Choose an existing retained item.")
    return value

def safe_relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise Fault("SOURCE_PATH", "A source member has an invalid path.")
    p = PurePosixPath(value)
    if p.is_absolute() or not p.parts or any(x in (".", "..") for x in p.parts) or str(p) != value:
        raise Fault("SOURCE_PATH", "Source members must use canonical relative paths.")
    return p

def json_body(data):
    def invalid(value):
        raise Fault("JSON_NUMBER", "JSON numbers must be finite.")
    try:
        result = json.loads(data, parse_constant=invalid)
    except (ValueError, UnicodeError) as error:
        raise Fault("JSON_INVALID", "The submitted JSON could not be read.") from error
    if not isinstance(result, dict):
        raise Fault("JSON_OBJECT", "Submit a JSON object.")
    return result

def summary_error(error):
    if isinstance(error, NativeJobError):
        return {"code": error.code, "message": str(error)}, error.status
    implementation_detail = implementation_error(error)
    if implementation_detail is not None:
        return implementation_detail
    if isinstance(error, Fault):
        return {"code": error.code, "message": str(error)}, error.status
    if isinstance(error, FileNotFoundError):
        return {"code": "SOURCE_MISSING", "message": str(error)}, 404
    if isinstance(error, BlockingIOError):
        return {"code": "NATIVE_BUSY", "message": "The selected original workspace operation is still in use."}, 409
    if isinstance(error, (ValueError, KeyError, TypeError)):
        return {"code": "INPUT_INVALID", "message": str(error)}, 422
    return {"code": "NATIVE_ERROR", "message": str(error) or type(error).__name__}, 500

class Operator:
    def __init__(self, directory, state_directory, *, create=False, title=None,
                 source_manifests=(), source_roots=(), restore_directory=None, upload_limit=4*1024**3,
                 extraction_limit=64*1024**3):
        self.root = Path(state_directory).resolve()
        if self.root.is_relative_to(APPLICATION) or self.root.is_relative_to(Path(directory).resolve()):
            raise Fault("TEAM_STORAGE", "Keep the operator-state directory outside application source and scientific workspace directories.", 422)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.owner = held(self.root / ".operator.lock", blocking=False)
        self.owner.__enter__()
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="upstate-original")
        self.workspaces = {}
        self.spatial_reviews = {}
        self.spatial_exports = {}
        self.gates = {}
        self.downloads = {}
        self.task_catalog = ProjectedFileCache()
        self.task_requests = TaskRequests(self.root)
        self.study_catalogues = StudyCatalogues()
        self.rehearsals = Rehearsals(self, Fault)
        self.customer_reviews = CustomerReviews(self, Fault)
        self.experiments = ExperimentOperator(self, Fault)
        self.parameter_studies = ParameterStudyAPI(self, Fault)
        self.programmes = Programmes(self, Fault)
        self.programme_activity = ProgrammeActivity(self, Fault)
        self.verified = {}
        self.upload_limit = upload_limit
        self.extraction_limit = extraction_limit
        self.restore_root = Path(restore_directory or self.root / "received").resolve()
        self.capability = secrets.token_urlsafe(36)
        self.download_cookie = secrets.token_urlsafe(36)
        self.closing = False
        self.native_jobs = NativeJobs(self)
        self.origin = None
        self.registry_file = self.root / "workspaces.json"
        self.registry = read_json(self.registry_file) if self.registry_file.exists() else {}
        for folder in ("tasks", "uploads", "objects", "previews", "outputs", "staging", "registered"):
            (self.root / folder).mkdir(exist_ok=True, mode=0o700)
        for item in self.registry.values():
            try:
                self._open(item)
            except (OSError, ValueError) as error:
                item["available"] = False
                item["error"] = str(error)
        primary = Workspace(directory, create=create, title=title or "Upper Savannah scientific workspace")
        self.primary = self.register(primary)
        self.registered = {}
        for filename in source_manifests:
            p = Path(filename).resolve(strict=True)
            value = read_json(p)
            key = digest({"path": str(p), "sha256": file_digest(p)})
            self.registered[key] = {"id": key, "path": str(p), "sha256": file_digest(p),
                                    "title": value.get("title", p.name), "entries": len(value.get("entries", []))}
        self.team = TeamAccess(self.root, Fault, lambda: self.registry.keys())
        self.extensions = ExtensionRegistry(self, Fault,
            builtin_actions=ACTIONS, builtin_kinds=KINDS,
            builtin_routes=(('GET', '/api/team'), ('GET', '/api/whoami'), ('POST', '/api/team'), ('POST', '/api/logout'), ('GET', '/api/extensions'), ('GET', '/api/state'), ('GET', '/api/item'), ('GET', '/api/source-info'), ('GET', '/api/task'), ('GET', '/api/native-job'), ('GET', '/api/run-log'), ('GET', '/api/runtime'), ('POST', '/api/upload'), ('POST', '/api/session'), ('POST', '/api/operator-session'), ('POST', '/api/source-preview'), ('POST', '/api/actions'), ('POST', '/api/task/resume'), ('POST', '/api/task/cancel')),
            source_roots=source_roots).load()
        for path in (self.root / "tasks").glob("*.json"):
            task = read_json(path)
            if task["state"] in ACTIVE:
                task.update(state="interrupted", ended_at=now(),
                            error={"code": "OPERATOR_REOPENED", "message": "The operator reopened. Inspect the original model state, then resume this retained task."})
                atomic_json(path, task)

    def _open(self, item):
        if self.root.is_relative_to(Path(item["directory"]).resolve()):
            raise Fault("TEAM_STORAGE", "The operator-state directory must stay outside each scientific workspace.", 422)
        ws = Workspace(item["directory"])
        self.workspaces[item["id"]] = ws
        self.spatial_reviews[item["id"]] = SpatialReview(ws)
        self.spatial_exports[item["id"]] = SpatialExports(ws, spatial=self.spatial_reviews[item["id"]])
        self.gates[item["id"]] = threading.RLock()
        item.update(available=True, project_id=ws.project["id"], title=ws.project["title"])
        item.pop("error", None)
        return ws

    def register(self, workspace, *, received=None):
        if hasattr(self, "team") and self.team.current():
            self.team.require(self.team.current()["principal"], administrator=True)
        key = digest({"directory": str(workspace.root)})
        with self.lock:
            item = self.registry.get(key, {"id": key, "directory": str(workspace.root),
                                          "opened_at": now()})
            if received:
                item["received"] = received
            self._open(item)
            self.registry[key] = item
            atomic_json(self.registry_file, self.registry)
        return key

    def ws(self, key):
        key = token(key)
        if hasattr(self, "team"):
            self.team.check_workspace(key)
        if key not in self.workspaces:
            raise Fault("WORKSPACE_MISSING", "Select an available workspace.", 404)
        return self.workspaces[key]

    def spatial_read(self, workspace, operation, payload=None):
        self.ws(workspace)
        reviewer = self.spatial_reviews[workspace]
        if operation == "catalog":
            result = reviewer.catalog()
        elif operation in {"describe", "frame", "overlay", "point"}:
            result = getattr(reviewer, operation)(payload or {})
        else:
            raise Fault("SPATIAL_OPERATION", "Choose a supported native spatial read.")
        return {"workspace_key": workspace, **result}

    def operator_session(self, workspace):
        ws = self.ws(workspace)
        path = ws.root / "operator-session.json"
        if not path.exists():
            return None
        value = read_json(path)
        if not isinstance(value, dict) or value.get("schema") != "upstate.operator-session/v1" or value.get("project_id") != ws.project["id"]:
            raise Fault("JOURNEY_PROJECT", "The saved operator view belongs to a different project.", 409)
        return value

    def _validate_community_view(self, ws, view):
        if view is None:
            return
        if (not isinstance(view, dict)
                or view.get("schema") != "upstate.community-view/v1"
                or view.get("project_id") != ws.project["id"]):
            raise Fault("JOURNEY_COMMUNITY", "Save the community view in its original project.")
        values = {}
        defaults = {"table_id": "", "utility_id": "", "watershed_id": "", "query": "",
                    "plan_id": "", "report_id": "", "tab": "explore", "sort": "geoid"}
        for key, default in defaults.items():
            selected = view.get(key, default)
            if not isinstance(selected, str):
                raise Fault("JOURNEY_COMMUNITY", "The community " + key.replace("_", " ") + " must be text.")
            values[key] = selected
        if values["tab"] not in {"explore", "plans", "reports"}:
            raise Fault("JOURNEY_COMMUNITY", "Choose an existing Communities tab.")
        if values["sort"] not in {"geoid", "population_desc", "poverty_desc", "income_asc"}:
            raise Fault("JOURNEY_COMMUNITY", "Choose an existing community sort order.")
        selected_records = {}
        for key, collection in (("table_id", "community-tables"),
                                ("plan_id", "community-plans"),
                                ("report_id", "community-reports")):
            selected = values[key]
            if not selected and key != "table_id":
                selected_records[key] = None
                continue
            if not re.fullmatch(r"[0-9a-f]{64}", selected):
                raise Fault("JOURNEY_COMMUNITY", "Choose a retained community " + key.removesuffix("_id") + ".")
            try:
                selected_records[key] = ws._get(collection, selected)
            except FileNotFoundError as error:
                raise Fault("JOURNEY_COMMUNITY", "This workspace does not contain the selected community " + key.removesuffix("_id") + ".") from error
        table = selected_records["table_id"]
        members = [member for group in table["groups"] for member in group["memberships"]]
        utility_ids = {row["id"] for row in table.get("metadata", {}).get("utilities", [])}
        if not utility_ids:
            utility_ids = {member["utility_id"] for member in members}
        if values["utility_id"] and values["utility_id"] not in utility_ids:
            raise Fault("JOURNEY_COMMUNITY", "The selected utility is absent from this community table.")
        if values["watershed_id"] and not any(
                member["watershed_id"] == values["watershed_id"]
                and (not values["utility_id"] or member["utility_id"] == values["utility_id"])
                for member in members):
            raise Fault("JOURNEY_COMMUNITY", "The selected watershed is absent from this utility and table.")
        compared = view.get("compare_geoids", [])
        if (not isinstance(compared, list)
                or any(not isinstance(geoid, str) for geoid in compared)
                or len(compared) != len(set(compared))
                or set(compared) - {group["geoid"] for group in table["groups"]}):
            raise Fault("JOURNEY_COMMUNITY", "Compare unique original block-group GEOIDs from this table.")
        plan, report = selected_records["plan_id"], selected_records["report_id"]
        if any(record and record.get("table_id") != table["id"] for record in (plan, report)):
            raise Fault("JOURNEY_COMMUNITY", "The selected community plan and report must use this table.")
        if plan and report and report.get("plan_id") != plan["id"]:
            raise Fault("JOURNEY_COMMUNITY", "The selected community report belongs to a different plan.")

    def _save_operator_session(self, workspace, value):
        ws = self.ws(workspace)
        journey = value.get("journey")
        if not isinstance(journey, dict) or journey.get("schema") != "upstate.operating-journey/v1" or journey.get("project_id") != ws.project["id"]:
            raise Fault("JOURNEY_PROJECT", "Save the selected journey in its original project.")
        selection = journey.get("selection")
        if not isinstance(selection, dict) or not isinstance(journey.get("notes", ""), str):
            raise Fault("JOURNEY_SELECTION", "Save the selected scientific records and text notes.")
        fields = {"baseline_run_id": "runs", "grid_id": "grids", "profile_id": "profiles",
                  "scenario_id": "scenarios", "run_id": "runs", "comparison_id": "comparisons",
                  "spatial_review_id": "spatial_reviews", "spatial_export_id": "spatial_exports",
                  "delivery_id": "deliveries"}
        chosen = {}
        for key, collection in fields.items():
            selected = selection.get(key, "")
            if not isinstance(selected, str):
                raise Fault("JOURNEY_SELECTION", "Choose a saved " + key.replace("_", " ") + ".")
            chosen[key] = None
            if not selected:
                continue
            if not re.fullmatch(r"[0-9a-f]{64}", selected):
                raise Fault("JOURNEY_SELECTION", "This workspace does not contain the selected " + key.replace("_", " ") + ".")
            try:
                chosen[key] = ws.retained_item(collection, selected)
            except FileNotFoundError as error:
                raise Fault("JOURNEY_SELECTION", "This workspace does not contain the selected " + key.replace("_", " ") + ".") from error
        run, baseline = chosen["run_id"], chosen["baseline_run_id"]
        if run and any(run.get("selection", {}).get(key) != selection.get(key) for key in ("grid_id", "profile_id", "scenario_id")):
            raise Fault("JOURNEY_SELECTION", "The selected run uses a different grid, profile or scenario.")
        comparison = chosen["comparison_id"]
        if comparison and (comparison.get("baseline_run_id") != (baseline or {}).get("id") or not any(row.get("run_id") == (run or {}).get("id") for row in comparison.get("alternatives", []))):
            raise Fault("JOURNEY_SELECTION", "The selected comparison uses a different baseline or alternative.")
        delivery = chosen["delivery_id"]
        if delivery and (delivery.get("selection", {}).get("baseline_run_id") != (baseline or {}).get("id") or (run or {}).get("id") not in delivery.get("selection", {}).get("scenario_run_ids", [])):
            raise Fault("JOURNEY_SELECTION", "The selected delivery uses a different baseline or alternative.")
        pack = chosen["spatial_export_id"]
        if pack and selection.get("spatial_review_id") and pack.get("review_id") != selection["spatial_review_id"]:
            raise Fault("JOURNEY_SELECTION", "The map pack belongs to a different saved geographic view.")
        # Calibration review: retain the original dossier in a saved journey.
        review_id = selection.get("calibration_review_id", "")
        if not isinstance(review_id, str):
            raise Fault("JOURNEY_SELECTION", "Choose one saved calibration review.")
        if review_id:
            from calibration import validate_review_journey
            validate_review_journey(ws, journey)
        self._validate_community_view(ws, journey.get("community"))
        request_sha256 = digest(journey)
        current = self.operator_session(workspace)
        if current and (current.get("request_sha256") == request_sha256 or current.get("journey") == journey):
            return current
        if value.get("expected_revision") != (current or {}).get("revision"):
            raise Fault("JOURNEY_CHANGED", "Another browser saved this workspace view. Refresh to load its saved revision, then save your current view and notes.", 409)
        journey = json.loads(canonical(journey))
        versions = []
        previous = (current or {}).get("journey", {})
        candidates = [*previous.get("note_versions", []), *journey.get("note_versions", [])]
        if previous.get("notes") and previous["notes"] != journey.get("notes"):
            candidates.append({"text": previous["notes"], "recorded_at": current["saved_at"]})
        for item in candidates:
            if not isinstance(item, dict) or not isinstance(item.get("text"), str):
                raise Fault("JOURNEY_NOTES", "Each retained notes version needs its original text.")
            if not any(row["text"] == item["text"] for row in versions):
                versions.append({"text": item["text"], "recorded_at": item.get("recorded_at")})
        journey["note_versions"] = versions
        saved = {"schema": "upstate.operator-session/v1", "project_id": ws.project["id"],
                 "revision": digest(journey), "request_sha256": request_sha256,
                 "saved_at": now(), "journey": journey}
        atomic_json(ws.root / "operator-session.json", saved)
        return saved

    def save_operator_session(self, workspace, value):
        ws = self.ws(workspace)
        try:
            with held(ws.root / ".operator-session.lock", blocking=False):
                return self._save_operator_session(workspace, value)
        except BlockingIOError as error:
            raise Fault("JOURNEY_BUSY", "A workspace save is in progress. Save this view again when it finishes.", 409) from error

    def public_workspaces(self):
        rows = [{k: v for k, v in row.items() if k != "directory"} for row in self.registry.values()]
        context = self.team.current() if hasattr(self, "team") else None
        return self.team.workspaces(context["principal"], rows) if context else rows

    def task(self, key):
        task = read_json(self.root / "tasks" / (token(key) + ".json"))
        if hasattr(self, "team"):
            self.team.check_workspace(task["workspace"])
        return task

    def task_list(self, workspace=None, *, compact=False):
        paths = list((self.root / "tasks").glob("*.json"))
        if compact:
            self.task_catalog.retain_paths(paths)
            items = [self.task_catalog.read(path, task_summary) for path in paths]
        else:
            items = [read_json(path) for path in paths]
        if workspace:
            items = [x for x in items if x["workspace"] == workspace]
        context = self.team.current() if hasattr(self, "team") else None
        if context:
            items = [x for x in items if self.team.role(context["principal"], x["workspace"])]
        return sorted(items, key=lambda x: x["created_at"], reverse=True)

    def submit(self, workspace, action, payload, operation_id):
        self.ws(workspace)
        self.team.check_workspace(workspace, write=True)
        self.team.set_workspace(workspace)
        context = self.team.current()
        self.team.require_action(action, payload)
        if (action not in ACTIONS and not self.extensions.handles_action(action)) or not isinstance(payload, dict):
            raise Fault("ACTION_INVALID", "Choose a supported workspace operation.")
        if not isinstance(operation_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", operation_id):
            raise Fault("OPERATION_REQUIRED", "The operation needs its original request identity.")
        request = {"workspace": workspace, "action": action, "payload": payload}
        request_sha = digest(request)
        key = digest({"workspace": workspace, "operation_id": operation_id})
        file = self.root / "tasks" / (key + ".json")
        with self.lock:
            if self.closing:
                raise Fault("OPERATOR_DRAINING", "The operator is finishing its active task.", 409)
            if file.exists():
                task = read_json(file)
                if task["request_sha256"] != request_sha:
                    raise Fault("OPERATION_REUSED", "That operation identity already belongs to a different selection.", 409)
                return task
            for candidate in self.task_requests.matching(workspace, request_sha, ACTIVE):
                # Reopen the exact original record before returning it. Cached
                # metadata only narrows candidates; task state remains authoritative.
                try:
                    task = self.task(candidate["id"])
                except FileNotFoundError:
                    continue
                if (task["workspace"] == workspace and task["state"] in ACTIVE
                        and task["request_sha256"] == request_sha):
                    return task
            task = {"schema": "upstate.operator-task/v1", "id": key, "operation_id": operation_id,
                    **request, "request_sha256": request_sha, "created_at": now(),
                    "state": "queued", "attempts": []}
            actor = self.team.actor()
            if actor:
                task["requested_by"] = actor
            atomic_json(file, task, immutable=True)
            self.team.record("task.queued", workspace=workspace, task_id=key,
                             detail={"action": action, "operation_id": operation_id})
            self.pool.submit(self._perform, key)
            return task

    def resume(self, key):
        with self.lock:
            task = self.task(key)
            self.team.check_workspace(task["workspace"], write=True)
            if task["state"] in ACTIVE or task["state"] == "complete":
                return task
            if task["state"] not in {"interrupted", "failed", "cancelled"}:
                raise Fault("TASK_STATE", "This task cannot be resumed.", 409)
            if self.closing:
                raise Fault("OPERATOR_DRAINING", "The operator is draining.", 409)
            task.update(state="queued")
            actor = self.team.actor()
            if actor:
                task["execution_requested_by"] = actor
                task.setdefault("resumptions", []).append({"at": now(), "by": actor})
            task.pop("error", None)
            atomic_json(self.root / "tasks" / (key + ".json"), task)
            self.pool.submit(self._perform, key)
            return task

    def cancel(self, key):
        with self.lock:
            task = self.task(key)
            self.team.check_workspace(task["workspace"], write=True)
            if self.native_jobs.supports(task) and task["state"] != "queued":
                return self.native_jobs.request_stop(task)
            if task["state"] != "queued":
                raise Fault("TASK_RUNNING", "Only a task that has not started can be cancelled here.", 409)
            task.update(state="cancelled", ended_at=now(), cancelled_by=self.team.actor())
            atomic_json(self.root / "tasks" / (key + ".json"), task)
            return task

    def _perform(self, key):
        with self.lock:
            task = self.task(key)
            if task["state"] != "queued" or self.closing:
                return
            task.update(state="running", started_at=now())
            task.pop("error", None)
            attempt = {"number": len(task["attempts"]) + 1, "started_at": task["started_at"]}
            task["attempts"].append(attempt)
            atomic_json(self.root / "tasks" / (key + ".json"), task)
        try:
            principal = self.team.task_principal(task)
            with self.team.scope(principal, task["workspace"]):
                self.team.require_action(task["action"], task["payload"])
                attempt["executed_for"] = self.team.actor()
                with self.gates[task["workspace"]]:
                    result = self._invoke(task)
            task.update(state="complete", result=result, ended_at=now())
            attempt.update(state="complete", ended_at=task["ended_at"])
        except BaseException as error:
            detail, status = summary_error(error)
            final_state = ("interrupted" if isinstance(error, NativeJobDetached) else
                           "cancelled" if isinstance(error, NativeJobCancelled) else "failed")
            task.update(state=final_state, error=detail, ended_at=now())
            attempt.update(state=final_state, error=detail, ended_at=task["ended_at"])
            error_file = self.root / "tasks" / (key + ".attempt-" + str(attempt["number"]) + ".error.txt")
            with contextlib.suppress(OSError):
                error_file.write_text(traceback.format_exc(), encoding="utf-8")
        with self.lock:
            atomic_json(self.root / "tasks" / (key + ".json"), task)

    def _invoke(self, task):
        ws = self.ws(task["workspace"])
        value = task["payload"]
        action = task["action"]
        if action in REHEARSAL_ACTIONS:
            return self.rehearsals.invoke(task)
        if self.extensions.handles_action(action):
            return self.extensions.invoke(task)
        if action in PARAMETER_STUDY_ACTIONS:
            return self.parameter_studies.invoke(task)
        if action in EXPERIMENT_ACTIONS:
            return self.experiments.invoke(task)
        if action in PROGRAMME_ACTIONS:
            return self.programmes.invoke(task)
        if action in CUSTOMER_REVIEW_ACTIONS:
            return self.customer_reviews.invoke(task)
        if action == "source.import":
            preview = read_json(self.root / "previews" / (token(required(value, "preview_id")) + ".json"))
            manifest, cleanup = self.materialize_source(preview, task["id"])
            try:
                return ws.import_sources(manifest)
            finally:
                if cleanup:
                    shutil.rmtree(cleanup)
        if action == "portfolio.run.prepare":
            return ws.prepare_portfolio_run(value)
        if action == "portfolio.run.start":
            return ws.run_portfolio(value)
        if action.startswith("portfolio."):
            from model.portfolios import invoke
            return invoke(ws, action, value)
        if action.startswith("community."):
            from model.communities import invoke
            return invoke(ws, action, value)
        if action == "profile.save":
            return ws.save_profile(value)
        if action == "scenario.save":
            return ws.save_scenario(value)
        if action == "grid.prepare":
            return ws.prepare_grid(value)
        if action == "run.prepare":
            return ws.prepare_run(value)
        if action == "run.start":
            return self.native_jobs.execute_retained(task, ws)
        if action == "run.compare":
            return ws.compare_runs(value["run_ids"])
        if action == "observation.import":
            uploaded = self.upload(required(value, "upload_id"))
            return ws.import_observations(uploaded["path"], value["metadata"])
        if action == "observation.compare":
            return ws.compare_observations(required(value, "run_id"),
                                           required(value, "observation_id"), value["catchments"])
        if action == "spatial.review.save":
            return self.spatial_reviews[task["workspace"]].save(value)
        if action == "spatial.review.export":
            return self.spatial_exports[task["workspace"]].export(value)
        if action == "delivery.build":
            return ws.build_delivery(value)
        if action == "workspace.backup":
            destination = self.root / "outputs" / (task["id"] + ".zip")
            selection = bool(value.get("include_intermediates", True))
            if destination.exists():
                retained = portable.inspect_archive(destination, verify=True)
                if retained["project"] != ws.project or retained["selection"]["include_intermediates"] != selection:
                    raise Fault("BACKUP_CONFLICT", "The retained task output belongs to another backup selection.", 409)
                return {"project_id": ws.project["id"], "path": str(destination),
                        "bytes": destination.stat().st_size, "sha256": file_digest(destination),
                        "members": len(retained["members"]), "selection": retained["selection"],
                        "reused_completed_output": True}
            with held(ws.root / ".operator-session.lock", blocking=False):
                if value.get("journey") is not None:
                    self._save_operator_session(task["workspace"], {"journey": value["journey"], "expected_revision": value.get("journey_revision")})
                return ws.backup(destination, include_intermediates=selection)
        if action == "workspace.restore":
            uploaded = self.upload(required(value, "upload_id"))
            destination = self.restore_root / task["id"]
            if destination.exists():
                manifest = portable.inspect_archive(uploaded["path"], verify=True)
                for name, expected in manifest["members"].items():
                    path = destination.joinpath(*portable.member_name(name).parts)
                    if not path.is_file() or path.is_symlink() or path.stat().st_size != expected["bytes"] or file_digest(path) != expected["sha256"]:
                        raise Fault("RECEIVING_CHANGED", "The already-received task directory differs from its original archive.", 409)
                result = {"schema": "upstate.scientific-workspace-receiving/v1", "project": manifest["project"],
                          "directory": str(destination), "workspace": str(destination / "workspace"),
                          "application": str(destination / "application"), "archive_sha256": uploaded["sha256"],
                          "members": len(manifest["members"]), "selection": manifest["selection"],
                          "identity": "MATCH", "reused_completed_output": True}
            else:
                result = portable.restore(uploaded["path"], destination)
            restored_workspace = Workspace(result["workspace"])
            self.extensions.verify_workspace(restored_workspace)
            result["workspace_key"] = self.register(restored_workspace, received={
                "at": now(), "archive_sha256": result["archive_sha256"], "identity": result["identity"]})
            return result
        raise Fault("ACTION_INVALID", "The original operation is not supported.")

    def upload(self, key):
        self.team.check_resource("upload", key)
        record = read_json(self.root / "uploads" / (token(key) + ".json"))
        path = self.root / record["object"]
        if not path.is_file() or path.stat().st_size != record["bytes"] or file_digest(path) != record["sha256"]:
            raise Fault("UPLOAD_CHANGED", "The retained original upload changed.", 409)
        return {**record, "path": str(path)}

    def receive_upload(self, stream, length, filename, media_type):
        if length < 0 or length > self.upload_limit:
            raise Fault("UPLOAD_SIZE", "This file exceeds the operator's selected upload capacity.", 413)
        filename = urllib.parse.unquote(filename)
        if not filename or Path(filename).name != filename or "/" in filename or "\\" in filename or "\0" in filename or len(filename) > 240:
            raise Fault("UPLOAD_NAME", "Choose a file with an ordinary filename.")
        h = hashlib.sha256()
        pending = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.root / "objects", prefix=".upload-", delete=False) as out:
                pending = Path(out.name)
                remaining = length
                while remaining:
                    block = stream.read(min(1024*1024, remaining))
                    if not block:
                        raise Fault("UPLOAD_SHORT", "The upload ended before all original bytes arrived.", 400)
                    out.write(block)
                    h.update(block)
                    remaining -= len(block)
                out.flush()
                os.fsync(out.fileno())
            sha = h.hexdigest()
            target = self.root / "objects" / sha
            try:
                os.link(pending, target)
            except FileExistsError:
                if target.stat().st_size != length or file_digest(target) != sha:
                    raise Fault("UPLOAD_CHANGED", "The retained file identity differs.", 409)
            pending.unlink()
            pending = None
            key = digest({"sha256": sha, "filename": filename, "media_type": media_type})
            record = {"id": key, "filename": filename, "mime_type": media_type,
                      "bytes": length, "sha256": sha, "object": "objects/" + sha}
            atomic_json(self.root / "uploads" / (key + ".json"), record, immutable=True)
            context = self.team.current()
            if context:
                self.team.grant_resource("upload", key, context["workspace"])
            return record
        finally:
            if pending:
                pending.unlink(missing_ok=True)

    def _zip_entries(self, archive):
        entries = archive.infolist()
        if len(entries) > 20000 or sum(x.file_size for x in entries) > self.extraction_limit:
            raise Fault("SOURCE_CAPACITY", "The source archive exceeds the selected member or extraction capacity.", 413)
        files = {}
        for info in entries:
            name = info.filename.rstrip("/") if info.is_dir() else info.filename
            safe_relative(name)
            mode = info.external_attr >> 16
            if info.flag_bits & 1 or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                raise Fault("SOURCE_MEMBER", "Source archives contain ordinary, unencrypted files and directories.")
            if info.is_dir():
                continue
            if name in files:
                raise Fault("SOURCE_DUPLICATE", "The source archive repeats a member path.")
            files[name] = info
        return files

    def _manifest_summary(self, value):
        if value.get("schema") != "upstate.sources/v1" or not isinstance(value.get("entries"), list):
            raise Fault("SOURCE_SCHEMA", "Select the original upstate.sources/v1 source manifest.")
        seen = set()
        for row in value["entries"]:
            if not all(row.get(k) for k in ("id", "title", "uri", "vintage", "path")) or row["id"] in seen:
                raise Fault("SOURCE_METADATA", "Each original source needs a unique ID, title, URI, vintage and file.")
            if row.get("kind") not in {"raster", "vector", "table", "document"}:
                raise Fault("SOURCE_KIND", "A source kind must be raster, vector, table or document.")
            seen.add(row["id"])
            safe_relative(row["path"])
            for companion in row.get("companions", []):
                safe_relative(companion["path"])
        return {"title": value.get("title", "Source edition"), "captured_at": value.get("captured_at"),
                "scope": value.get("scope", {}), "entries": value["entries"], "notes": value.get("notes", [])}

    def preview_source(self, data):
        if data.get("registered_id"):
            context = self.team.current()
            if context:
                self.team.require(context["principal"], administrator=True)
            key = required(data, "registered_id")
            registered = self.registered.get(key)
            if not registered:
                raise Fault("SOURCE_SELECTION", "Choose a source manifest registered by this operator.", 404)
            path = Path(registered["path"])
            if file_digest(path) != registered["sha256"]:
                raise Fault("SOURCE_CHANGED", "That registered source manifest changed; reopen the operator with its new edition.", 409)
            value = read_json(path)
            preview = {"kind": "registered", "registered_id": key, "path": str(path),
                       "manifest_sha256": registered["sha256"], **self._manifest_summary(value)}
        elif data.get("file_metadata") is not None:
            upload = self.upload(required(data, "upload_id"))
            metadata = data["file_metadata"]
            row = {**metadata, "id": "source-" + upload["sha256"][:20],
                   "path": upload["filename"], "sha256": upload["sha256"]}
            value = {"schema": "upstate.sources/v1", "title": metadata.get("title", upload["filename"]),
                     "captured_at": now(), "entries": [row], "notes": data.get("notes", [])}
            preview = {"kind": "file", "upload_id": upload["id"], "manifest": value,
                       "manifest_sha256": digest(value), **self._manifest_summary(value)}
        else:
            upload = self.upload(required(data, "upload_id"))
            with zipfile.ZipFile(upload["path"]) as archive:
                files = self._zip_entries(archive)
                candidates = []
                for name, info in files.items():
                    if not name.lower().endswith(".json") or info.file_size > JSON_LIMIT:
                        continue
                    try:
                        value = json.loads(archive.read(info))
                    except (ValueError, UnicodeError):
                        continue
                    if isinstance(value, dict) and value.get("schema") == "upstate.sources/v1":
                        candidates.append((name, value))
                wanted = data.get("manifest_member")
                if wanted:
                    candidates = [item for item in candidates if item[0] == wanted]
                if len(candidates) != 1:
                    raise Fault("SOURCE_MANIFEST", "Select an archive with one source manifest, or choose its exact manifest entry.")
                name, value = candidates[0]
                parent = PurePosixPath(name).parent
                summary = self._manifest_summary(value)
                for row in value["entries"]:
                    paths = [row["path"]] + [x["path"] for x in row.get("companions", [])]
                    for relative in paths:
                        if str(parent / safe_relative(relative)) not in files:
                            raise Fault("SOURCE_MISSING", "A declared source file is absent: " + relative)
                preview = {"kind": "archive", "upload_id": upload["id"], "manifest_member": name,
                           "manifest_sha256": hashlib.sha256(archive.read(files[name])).hexdigest(),
                           "archive_sha256": upload["sha256"], **summary}
        key = digest(preview)
        preview = {"id": key, **preview}
        atomic_json(self.root / "previews" / (key + ".json"), preview, immutable=True)
        context = self.team.current()
        if context:
            self.team.grant_resource("preview", key, context["workspace"])
        return {k: v for k, v in preview.items() if k not in {"path", "manifest"}}

    def materialize_source(self, preview, task_id):
        self.team.check_resource("preview", preview["id"])
        if preview["kind"] == "registered":
            p = Path(preview["path"])
            if file_digest(p) != preview["manifest_sha256"]:
                raise Fault("SOURCE_CHANGED", "The original selected manifest changed.", 409)
            return p, None
        upload = self.upload(preview["upload_id"])
        root = Path(tempfile.mkdtemp(prefix=task_id[:12] + "-", dir=self.root / "staging"))
        try:
            if preview["kind"] == "file":
                target = root / upload["filename"]
                try:
                    os.link(upload["path"], target)
                except OSError:
                    shutil.copyfile(upload["path"], target)
                manifest = root / "source-manifest.json"
                atomic_json(manifest, preview["manifest"], immutable=True)
            else:
                with zipfile.ZipFile(upload["path"]) as archive:
                    files = self._zip_entries(archive)
                    for name, info in files.items():
                        target = root.joinpath(*safe_relative(name).parts)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with archive.open(info) as original, target.open("xb") as out:
                            shutil.copyfileobj(original, out, 1024*1024)
                    manifest = root.joinpath(*safe_relative(preview["manifest_member"]).parts)
                    if file_digest(manifest) != preview["manifest_sha256"]:
                        raise Fault("SOURCE_CHANGED", "The selected archived source manifest changed.", 409)
            return manifest, root
        except BaseException:
            shutil.rmtree(root)
            raise

    def _ticket(self, workspace, path, expected, label=None):
        self.team.check_workspace(workspace)
        path = Path(path).resolve()
        key = digest({"workspace": workspace, "path": str(path), "sha256": expected["sha256"], "bytes": expected["bytes"]})
        item = {"id": key, "workspace": workspace, "path": str(path), "filename": expected.get("filename") or path.name,
                "label": label or path.name, "bytes": expected["bytes"], "sha256": expected["sha256"]}
        with self.lock:
            self.downloads[key] = item
        return {k: v for k, v in item.items() if k != "path"} | {"url": "/api/file/" + key}

    def _files(self, workspace, record, scope):
        files = []
        def visit(value, label):
            if isinstance(value, dict):
                if {"path", "bytes", "sha256"} <= set(value) and isinstance(value["path"], str):
                    relative = safe_relative(value["path"])
                    path = (scope / relative).resolve()
                    if not path.is_relative_to(scope.resolve()):
                        raise Fault("OUTPUT_PATH", "A retained output leaves its original source scope.", 409)
                    files.append(self._ticket(workspace, path, value, label))
                for name, child in value.items():
                    if name != "_downloads":
                        visit(child, (label + " / " + name).strip(" /"))
            elif isinstance(value, list):
                for i, child in enumerate(value):
                    visit(child, label + " / " + str(i + 1))
        visit({k: record[k] for k in ("files", "artifacts", "stages", "alternatives", "maps") if k in record}, "")
        unique = {}
        for item in files:
            unique.setdefault(item["id"], item)
        return list(unique.values())

    def item(self, workspace, kind, key):
        self.ws(workspace)
        if self.extensions.has_item(kind):
            return self.extensions.item(workspace, kind, key)
        if kind not in KINDS:
            raise Fault("ITEM_KIND", "Choose a retained item type.")
        ws = self.ws(workspace)
        if kind == "parameter-studies":
            result = self.parameter_studies.inspect(workspace, key)
            result["_downloads"] = self._files(workspace, result, ws.root / "experiments" / token(key))
            return result
        key = token(key)
        try:
            result = ws.retained_item(kind, key)
        except FileNotFoundError as error:
            raise Fault("ITEM_MISSING", "The selected retained item is absent.", 404) from error
        if kind == "sources":
            downloads = []
            for row in result["entries"]:
                for body in [row["body"]] + row.get("companions", []):
                    downloads.append(self._ticket(workspace, ws.root / body["object"], body, row["title"] + " / " + body["filename"]))
            manifest = result["original_manifest"]
            downloads.append(self._ticket(workspace, ws.root / manifest["object"], manifest, "Original source manifest"))
        elif kind == "observations":
            original = result["original"]
            downloads = [self._ticket(workspace, ws.root / original["object"], original, "Original observation CSV")]
        elif kind == "spatial_reviews":
            path = ws.root / "spatial-reviews" / (key + ".json")
            expected = {"bytes": path.stat().st_size, "sha256": file_digest(path)}
            downloads = [self._ticket(workspace, path, expected, "Saved spatial review")]
        elif kind == "spatial_exports":
            result = self.spatial_exports[workspace].inspect(key)
            downloads = self._files(workspace, result, ws.root / "spatial-exports" / key)
        elif kind in {"community_tables", "community_plans"}:
            folder = "community-tables" if kind == "community_tables" else "community-plans"
            path = ws.root / folder / (key + ".json")
            downloads = [self._ticket(workspace, path,
                         {"bytes": path.stat().st_size, "sha256": file_digest(path)},
                         "Complete saved community " + ("table" if kind == "community_tables" else "plan"))]
            original, entry = ws.source_file(result["source"]["collection_id"], result["source"]["source_id"])
            downloads.append(self._ticket(workspace, original, entry["body"], "Original community CSV"))
        elif kind == "planning_inventories":
            from model.planning_inventory import inspect
            result = inspect(ws, key)
            downloads = self._files(workspace, result, ws.root)
        elif kind in {"community_reports", "portfolio_reports", "portfolios"}:
            downloads = self._files(workspace, result, ws.root)
            if kind == "portfolios":
                path = ws.root / "portfolios" / (key + ".json")
                downloads.insert(0, self._ticket(workspace, path,
                    {"bytes": path.stat().st_size, "sha256": file_digest(path)},
                    "Saved conservation portfolio"))
                from model.portfolios import get_portfolio
                result = get_portfolio(ws, key, details=True)
        elif kind in {"grids", "runs", "comparisons", "deliveries"}:
            downloads = self._files(workspace, result, ws.root / kind / key)
        else:
            downloads = []
        result["_downloads"] = downloads
        if kind == "deliveries":
            result["_current_report_edition"] = CLIENT_REPORT_EDITION
        return result

    def source_info(self, workspace, collection, source, layer=None):
        # Retained sources are immutable; inspection remains available during native execution.
        path, entry = self.ws(workspace).source_file(collection, source)
        result = {"source": entry, "download": self._ticket(workspace, path, entry["body"], entry["title"])}
        if entry["kind"] == "table":
            import csv
            with path.open(encoding="utf-8-sig", newline="") as original:
                reader = csv.DictReader(original)
                rows = []
                for row in reader:
                    rows.append(row)
                    if len(rows) == 30:
                        break
            result.update(columns=reader.fieldnames, sample=rows, sample_limit=30)
        elif entry["kind"] == "vector":
            import fiona
            from model.rasters import vector_environment, native_vector_path
            native_path = native_vector_path(path)
            with vector_environment():
                layers = list(fiona.listlayers(native_path))
                selected = layer or entry.get("layer") or (layers[0] if layers else None)
                if selected not in layers:
                    raise Fault("SOURCE_LAYER", "Select one of the original native vector layers.")
                with fiona.open(native_path, layer=selected) as original:
                    result.update(layers=layers, selected_layer=selected, feature_count=len(original),
                                  geometry_type=original.schema["geometry"], fields=dict(original.schema["properties"]),
                                  crs=original.crs_wkt or str(original.crs), bounds=list(original.bounds))
                    rows = []
                    for feature in original:
                        rows.append({"native_id": str(feature.id), **dict(feature.properties)})
                        if len(rows) == 20:
                            break
                    result.update(sample=rows, sample_limit=20)
        elif entry["kind"] == "raster":
            import math
            import rasterio
            from pyproj import CRS
            with rasterio.open(path) as original:
                reference = CRS.from_user_input(original.crs) if original.crs else None
                axes = reference.axis_info[:2] if reference else []
                metre_grid = bool(reference and reference.is_projected and len(axes) == 2
                                  and all(abs(axis.unit_conversion_factor - 1) <= 1e-12 for axis in axes))
                affine = original.transform
                native_cell = (float(affine.a) if metre_grid and affine.a > 0 and affine.e < 0
                               and abs(affine.b) <= 1e-12 and abs(affine.d) <= 1e-12
                               and math.isclose(affine.a, -affine.e, rel_tol=1e-9, abs_tol=1e-12)
                               and math.isfinite(affine.a) else None)
                result.update(width=original.width, height=original.height, count=original.count,
                              crs=str(original.crs), transform=list(original.transform)[:6],
                              resolution=list(original.res), native_resolution_m=native_cell,
                              projected_metre_grid=metre_grid, bounds=list(original.bounds),
                              dtypes=list(original.dtypes),
                              nodata=None if original.nodata is None or not __import__("math").isfinite(original.nodata) else original.nodata,
                              native_tags=original.tags())
        return result

    def state(self, workspace, *, compact=False):
        ws = self.ws(workspace)
        state = ws.operator_overview() if compact else ws.overview()
        try:
            state["operator_session"] = self.operator_session(workspace)
        except (Fault, OSError, ValueError) as error:
            state["operator_session"] = None
            state["operator_session_error"] = str(error)
        state = self.extensions.extend_state(workspace, state)
        catalogue = self.study_catalogues if compact else None
        state["experiments"] = self.experiments.catalog(workspace, catalogue=catalogue)
        state["parameter-studies"] = self.parameter_studies.list(workspace, catalogue=catalogue)
        if not compact:
            for study in state["parameter-studies"]:
                study["case_count"] = len(study.get("cases", []))
                study.pop("cases", None)
        state["compute_programmes"] = self.programme_activity.summaries(workspace, state["runs"])
        # Compact core readers already retain these exact summaries without
        # repeatedly reading the original rows and stage file inventories.
        if not compact:
            for row in state["observations"]:
                row["row_count"] = len(row["rows"])
                row.pop("rows")
        for row in state["runs"]:
            if not compact:
                row["stage_summary"] = {k: {x: v for x, v in stage.items() if x in {"started_at", "completed_at", "reused_from", "reused_at", "runtime"}}
                                        | {"file_count": len(stage.get("files", {}))}
                                        for k, stage in row.get("stages", {}).items()}
            row.pop("stages", None)
        return {"workspace_key": workspace, "workspaces": self.public_workspaces(), "data": state,
                "tasks": self.task_list(workspace, compact=compact), "registered_sources": [
                    {k: v for k, v in row.items() if k != "path"} for row in self.registered.values()
                    if not self.team.current() or self.team.current()["principal"]["administrator"]],
                "limits": {"upload_bytes": self.upload_limit, "source_extraction_bytes": self.extraction_limit},
                "closing": self.closing,
                "person": self.team.current()["principal"] if self.team.current() else self.team.owner()}

    def task_view(self, key):
        task = self.task(key)
        if self.native_jobs.supports(task):
            try:
                task["_native_job"] = self.native_jobs.snapshot(task)
            except NativeJobError as error:
                if error.code != "PROGRAMME_PREPARING":
                    raise
        result = task.get("result", {})
        core_results = {"source.import": "sources", "profile.save": "profiles", "scenario.save": "scenarios",
                        "grid.prepare": "grids", "run.prepare": "runs", "run.start": "runs",
                        "run.compare": "comparisons", "observation.import": "observations",
                        "observation.compare": "observation_comparisons", "delivery.build": "deliveries",
                        "portfolio.inventory.build": "planning_inventories", "portfolio.save": "portfolios",
                        "portfolio.report.build": "portfolio_reports", "portfolio.decision.build": "portfolio_reports",
                        "portfolio.scenario.prepare": "scenarios", "portfolio.run.prepare": "runs",
                        "portfolio.run.start": "runs"}
        if task["state"] == "complete" and task["action"] in core_results and result.get("id"):
            kind = core_results[task["action"]]
            task["_item"] = {"kind": kind, "id": result["id"]}
            task["_downloads"] = self.item(task["workspace"], kind, result["id"])["_downloads"]
        if task["action"] == "workspace.backup" and task["state"] == "complete":
            task["_downloads"] = [self._ticket(task["workspace"], result["path"], result, "Complete scientific workspace")]
        if task["action"] == "spatial.review.save" and task["state"] == "complete":
            task["_downloads"] = self.item(task["workspace"], "spatial_reviews", result["id"])["_downloads"]
        if task["action"] == "spatial.review.export" and task["state"] == "complete":
            task["_downloads"] = self.item(task["workspace"], "spatial_exports", result["id"])["_downloads"]
        if task["action"] in PARAMETER_STUDY_ACTIONS and task["state"] == "complete" and result.get("id"):
            task["_item"] = {"kind": "parameter-studies", "id": result["id"]}
            task["_downloads"] = self.item(task["workspace"], "parameter-studies", result["id"])["_downloads"]
        community_actions = {"community.table.import": "community_tables",
                             "community.plan.save": "community_plans",
                             "community.report.build": "community_reports"}
        if task["action"] in community_actions and task["state"] == "complete":
            task["_downloads"] = self.item(task["workspace"], community_actions[task["action"]], result["id"])["_downloads"]
        return self.rehearsals.decorate_task(self.extensions.decorate_task(self.experiments.decorate_task(self.programmes.decorate_task(self.customer_reviews.decorate_task(task)))))

    def open_download(self, key):
        with self.lock:
            item = self.downloads.get(token(key))
        if not item:
            raise Fault("DOWNLOAD_MISSING", "Reopen the retained item before downloading its file.", 404)
        self.team.check_workspace(item["workspace"])
        file = open(item["path"], "rb")
        try:
            st = os.fstat(file.fileno())
            signature = (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)
            if not stat.S_ISREG(st.st_mode) or st.st_size != item["bytes"]:
                raise Fault("OUTPUT_CHANGED", "The original retained output changed.", 409)
            if self.verified.get(key) != signature:
                h = hashlib.sha256()
                for block in iter(lambda: file.read(1024*1024), b""):
                    h.update(block)
                after = os.fstat(file.fileno())
                observed = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                if h.hexdigest() != item["sha256"] or observed != signature:
                    raise Fault("OUTPUT_CHANGED", "The original retained output changed.", 409)
                self.verified[key] = signature
                file.seek(0)
            return file, item
        except BaseException:
            file.close()
            raise

    def close(self):
        with self.lock:
            self.closing = True
            for task in self.task_list():
                if task["state"] == "queued":
                    task.update(state="interrupted", ended_at=now(),
                                error={"code": "OPERATOR_DRAINING", "message": "Resume this retained selection when the operator reopens."})
                    atomic_json(self.root / "tasks" / (task["id"] + ".json"), task)
        self.pool.shutdown(wait=True)
        self.owner.__exit__(None, None, None)

class Handler(BaseHTTPRequestHandler):
    server_version = "UpstateOperator/1"
    protocol_version = "HTTP/1.1"
    def log_message(self, *_):
        pass

    @property
    def app(self):
        return self.server.operator

    def check_host(self):
        if self.headers.get("Host") != urllib.parse.urlsplit(self.app.origin).netloc:
            raise Fault("HOST_INVALID", "Open the original local operator URL.", 403)
        origin = self.headers.get("Origin")
        if origin and origin != self.app.origin:
            raise Fault("ORIGIN_INVALID", "Use the original local operator page.", 403)

    def team_cookie(self):
        jar = cookies.SimpleCookie()
        with contextlib.suppress(cookies.CookieError):
            jar.load(self.headers.get("Cookie", ""))
        selected = jar.get(self.app.team.cookie_name)
        return selected.value if selected else None

    def authorized(self, *, file=False):
        self.check_host()
        self.principal = self.app.team.authenticate(
            self.headers.get("Authorization", ""), self.app.capability,
            self.team_cookie() if file else None)
        self.app.team.set_request(self.principal)
        return self.principal

    def selected_workspace(self, supplied=None, *, write=False):
        workspace = supplied or self.app.team.default_workspace(self.principal, self.app.primary)
        self.app.team.require(self.principal, workspace, write=write)
        self.app.ws(workspace)
        self.app.team.set_workspace(workspace)
        return workspace

    def finish(self):
        try:
            super().finish()
        finally:
            CONTEXT.set(None)

    def send_json(self, status, value, *, cookie=False):
        self.close_connection = True
        body = canonical(value) + b"\n"
        prepared = _encode_json_response(body, ", ".join(self.headers.get_all("Accept-Encoding", [])))
        if prepared is None:
            status, body, encoding = 406, b"", None
        else:
            body, encoding = prepared
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Vary", "Accept-Encoding")
        if encoding:
            self.send_header("Content-Encoding", encoding)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cookie:
            value = self.app.team.session(self.principal)
            self.send_header("Set-Cookie", self.app.team.cookie_name + "=" + value + "; HttpOnly; SameSite=Strict; Path=/api/; Max-Age=28800")
        if getattr(self, "clear_team_cookie", False):
            self.send_header("Set-Cookie", self.app.team.cookie_name + "=; HttpOnly; SameSite=Strict; Path=/api/; Max-Age=0")
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        try:
            count = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            raise Fault("BODY_LENGTH", "Supply the original request length.", 411)
        if not 0 <= count <= JSON_LIMIT:
            raise Fault("BODY_SIZE", "The JSON request exceeds 4 MiB.", 413)
        data = self.rfile.read(count)
        if len(data) != count:
            raise Fault("BODY_SHORT", "The request ended before all bytes arrived.", 400)
        return json_body(data)

    def fail(self, error):
        self.close_connection = True
        value, status = summary_error(error)
        self.send_json(status, {"error": value})

    def do_GET(self):
        try:
            self.check_host()
            url = urllib.parse.urlsplit(self.path)
            query = urllib.parse.parse_qs(url.query)
            one = lambda name, default=None: query.get(name, [default])[0]
            if url.path == "/health":
                return self.send_json(200, {"ready": not self.app.closing})
            if url.path.startswith("/api/file/review-desk/"):
                self.authorized(file=True)
                selected = url.path.removeprefix("/api/file/review-desk/").split("/", 1)
                if len(selected) != 2:
                    raise Fault("REVIEW_MEMBER", "Choose an original review package member.", 404)
                ticket, policy = self.app.customer_reviews.desk_member(selected[0], urllib.parse.unquote(selected[1]))
                return self.send_file(ticket["id"], download=one("download") == "1", content_security_policy=policy)
            if self.app.extensions.has_file_route(url.path):
                self.authorized(file=True)
                reply = self.app.extensions.file_reply(url.path)
                return self.send_file(reply["ticket_id"], download=one("download") == "1",
                                      content_security_policy=reply["content_security_policy"])
            if url.path == "/api/file/delivery-report":
                self.authorized(file=True)
                workspace = self.selected_workspace(one("workspace"))
                return send_delivery_report_preview(self, workspace, one("id"),
                                                    report=one("report", "scientific"))
            if url.path.startswith("/api/file/"):
                self.authorized(file=True)
                return self.send_file(url.path.rsplit("/", 1)[1], download=one("download") == "1")
            if url.path.startswith("/api/"):
                self.authorized()
                if url.path == "/api/team":
                    return self.send_json(200, self.app.team.state(self.principal, self.app.public_workspaces()))
                if url.path == "/api/whoami":
                    return self.send_json(200, {"person": self.principal, "workspaces": self.app.public_workspaces(),
                                               "default_workspace": self.app.team.default_workspace(self.principal, self.app.primary)})
                if url.path == "/api/task":
                    task = self.app.task(one("id"))
                    self.selected_workspace(task["workspace"])
                    return self.send_json(200, self.app.task_view(one("id")))
                workspace = self.selected_workspace(one("workspace"))
                rehearsal_reads = {"/api/rehearsals/" + name: name for name in REHEARSAL_READS}
                if url.path in rehearsal_reads:
                    return self.send_json(200, self.app.rehearsals.read(workspace,
                        rehearsal_reads[url.path], {name: one(name) for name in ("id", "revision")}))
                if url.path == "/api/extensions":
                    return self.send_json(200, self.app.extensions.manifest())
                parameter_study_reads = {"/api/parameter-studies/" + name: name for name in PARAMETER_STUDY_READS}
                if url.path in parameter_study_reads:
                    return self.send_json(200, self.app.parameter_studies.read(workspace, parameter_study_reads[url.path],
                        {name: one(name) for name in ("baseline_run_id", "id", "area_id", "pollutant", "offset", "limit")}))
                experiment_reads = {"/api/experiments/" + name: name for name in EXPERIMENT_READS}
                if url.path in experiment_reads:
                    return self.send_json(200, self.app.experiments.read(workspace, experiment_reads[url.path],
                        {name: one(name) for name in ("experiment_id", "offset", "limit", "case_ids")}))
                if url.path == "/api/state":
                    return self.send_json(200, self.app.state(workspace, compact=one("compact") == "1"))
                programme_reads = {"/api/programmes/" + name: name for name in PROGRAMME_READS}
                if url.path in programme_reads:
                    return self.send_json(200, self.app.programmes.read(workspace, programme_reads[url.path],
                        {"programme_id": one("programme_id"), "include_sources": one("include_sources")}))
                review_reads = {"/api/reviews/" + name: name for name in CUSTOMER_REVIEW_READS}
                if url.path in review_reads:
                    return self.send_json(200, self.app.customer_reviews.read(workspace, review_reads[url.path],
                        {name: one(name) for name in ("review_id", "before_id", "after_id", "export_id",
                                                   "response_id", "handback_id", "revised_review_id", "receipt_id",
                                                   "q", "owner", "owner_state", "requested_assignee", "disposition",
                                                   "priority", "offset", "limit", "snapshot_id", "request_id")}))
                if url.path == "/api/spatial/catalog":
                    return self.send_json(200, self.app.spatial_read(workspace, "catalog"))
                if url.path == "/api/deliveries/report":
                    return self.send_json(200, read_delivery_report(self.app, workspace, one("id"),
                                                                  report=one("report", "scientific")))
                if url.path == "/api/item":
                    return self.send_json(200, self.app.item(workspace, one("kind"), one("id")))
                if url.path == "/api/source-info":
                    return self.send_json(200, self.app.source_info(workspace, one("collection"), one("source"), one("layer")))
                if url.path == "/api/native-job":
                    return self.send_json(200, self.app.native_jobs.view(one("id"), workspace,
                        stream=one("stream", "native"), offset=one("offset", "0"),
                        expected_run=one("run_id", ""), expected_execution=one("execution_id", "")))
                if url.path == "/api/task":
                    return self.send_json(200, self.app.task_view(one("id")))
                if url.path == "/api/run-log":
                    ws = self.app.ws(workspace)
                    key = token(one("id"))
                    ws.inspect_run(key)
                    path = ws.root / "runs" / key / "native.log"
                    offset = max(0, int(one("offset", "0")))
                    if not path.exists():
                        return self.send_json(200, {"offset": 0, "text": "", "bytes": 0})
                    with path.open("rb") as file:
                        size = os.fstat(file.fileno()).st_size
                        offset = min(offset, size)
                        file.seek(offset)
                        data = file.read(65536)
                    return self.send_json(200, {"offset": offset + len(data), "text": data.decode("utf-8", "replace"), "bytes": size})
                if url.path == "/api/runtime":
                    versions = {}
                    for name in ("natcap.invest", "rasterio", "fiona", "pyproj", "shapely", "numpy"):
                        try:
                            versions[name] = importlib.metadata.version(name)
                        except importlib.metadata.PackageNotFoundError:
                            versions[name] = None
                    return self.send_json(200, {"python": sys.version.split()[0], "packages": versions,
                                               "selected_invest_version": "3.20.0"})
                if self.app.extensions.has_route("GET", url.path):
                    return self.send_json(200, self.app.extensions.read("GET", url.path, workspace,
                        {name: values[0] for name, values in query.items()}))
                raise Fault("ROUTE_MISSING", "This operator route does not exist.", 404)
            selected = "index.html" if url.path == "/" else url.path.removeprefix("/web/")
            if selected not in (({'app.mjs', 'community.css', 'community.mjs', 'conservation.css', 'conservation.mjs', 'conservation_optimization.css', 'conservation_optimization.mjs', 'conservation_optimization_bridge.mjs', 'experiments.css', 'experiments.mjs', 'index.html', 'jobs.css', 'jobs.mjs', 'observed_series.mjs', 'parameter_studies.css', 'parameter_studies.mjs', 'portfolio.css', 'portfolio.mjs', 'programmes.css', 'programmes.mjs', 'receiving_water_spatial.mjs', 'receiving_waters.css', 'receiving_waters.mjs', 'reviews.css', 'reviews.mjs', 'spatial.mjs', 'style.css', 'observation_support.mjs', 'observed_reports.mjs'} | self.app.extensions.web_assets | {"delivery_review.mjs", "delivery_review.css"} | {"rehearsal.mjs", "rehearsal.css", "team.html", "team.mjs", "team.css"})):
                raise Fault("PAGE_MISSING", "This operator page does not exist.", 404)
            data = (Path(__file__).parent / "web" / selected).read_bytes()
            self.close_connection = True
            self.send_response(200)
            mime = {"html": "text/html; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
                    "css": "text/css; charset=utf-8"}[selected.rsplit(".", 1)[1]]
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except BaseException as error:
            self.fail(error)

    def do_POST(self):
        try:
            self.authorized()
            url = urllib.parse.urlsplit(self.path)
            if url.path == "/api/upload":
                self.selected_workspace(self.headers.get("X-Workspace"), write=True)
                length = int(self.headers.get("Content-Length", "-1"))
                result = self.app.receive_upload(self.rfile, length,
                                                self.headers.get("X-Upload-Filename", ""),
                                                self.headers.get("Content-Type", "application/octet-stream"))
                return self.send_json(201, result)
            value = self.body()
            if url.path == "/api/team":
                result = self.app.team.change(self.principal, value)
                if result.get("access_token"):
                    result["access_url"] = self.app.origin + "/#token=" + result.pop("access_token")
                return self.send_json(201 if value.get("operation") == "create" else 200, result)
            if url.path == "/api/session":
                return self.send_json(200, {"connected": True, "person": self.principal,
                    "workspaces": self.app.public_workspaces(),
                    "default_workspace": self.app.team.default_workspace(self.principal, self.app.primary)}, cookie=True)
            if url.path == "/api/logout":
                self.app.team.logout(self.team_cookie())
                self.clear_team_cookie = True
                return self.send_json(200, {"connected": False})
            readonly = {"/api/spatial/describe", "/api/spatial/frame", "/api/spatial/overlay", "/api/spatial/point",
                        "/api/parameter-studies/preview", "/api/experiments/preview",
                        "/api/programmes/preview", "/api/programmes/experiment-preview", "/api/programmes/delivery-preview", "/api/programmes/interaction-preview"}
            if url.path in {"/api/task/resume", "/api/task/cancel"}:
                task = self.app.task(required(value, "id"))
                self.selected_workspace(task["workspace"], write=True)
            else:
                workspace = self.selected_workspace(value.get("workspace") or self.headers.get("X-Workspace"),
                                                    write=url.path not in readonly and not self.app.team.viewer_post(url.path))
                value = {**value, "workspace": workspace}
            self.app.team.require_route(url.path)
            self.app.team.require_payload(value)
            if url.path == "/api/parameter-studies/preview":
                return self.send_json(200, self.app.parameter_studies.preview(
                    value.get("workspace", self.app.primary), value["selection"]))
            if url.path == "/api/experiments/preview":
                return self.send_json(200, self.app.experiments.preview(value))
            if url.path == "/api/programmes/preview":
                return self.send_json(200, self.app.programmes.preview(value.get("workspace", self.app.primary), value))
            if url.path == "/api/programmes/experiment-preview":
                return self.send_json(200, self.app.programmes.experiment_preview(value.get("workspace", self.app.primary), value))
            if url.path == "/api/programmes/interaction-preview":
                return self.send_json(200, self.app.programmes.interaction_preview(value.get("workspace", self.app.primary), value))
            if url.path == "/api/programmes/pause":
                return self.send_json(200, self.app.programmes.pause(value.get("workspace", self.app.primary), value))
            if url.path == "/api/programmes/delivery-preview":
                return self.send_json(200, self.app.programmes.delivery_preview(value.get("workspace", self.app.primary), value))
            if url.path == "/api/operator-session":
                return self.send_json(200, self.app.save_operator_session(value.get("workspace", self.app.primary), value))
            if url.path == "/api/source-preview":
                return self.send_json(200, self.app.preview_source(value))
            spatial_reads = {"/api/spatial/" + name: name for name in ("describe", "frame", "overlay", "point")}
            if url.path in spatial_reads:
                return self.send_json(200, self.app.spatial_read(
                    value.get("workspace", self.app.primary), spatial_reads[url.path], value))
            if url.path == "/api/actions":
                task = self.app.submit(value.get("workspace", self.app.primary),
                                       required(value, "action"), value.get("payload", {}),
                                       required(value, "operation_id"))
                return self.send_json(202, task)
            if url.path == "/api/task/resume":
                return self.send_json(202, self.app.resume(required(value, "id")))
            if url.path == "/api/task/cancel":
                return self.send_json(200, self.app.cancel(required(value, "id")))
            if self.app.extensions.has_route("POST", url.path):
                return self.send_json(200, self.app.extensions.read("POST", url.path,
                    value.get("workspace", self.app.primary), value))
            raise Fault("ROUTE_MISSING", "This operator action does not exist.", 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except BaseException as error:
            self.fail(error)

    def send_file(self, key, *, download=False, content_security_policy=None):
        self.close_connection = True
        file, item = self.app.open_download(key)
        try:
            start, end, status = 0, item["bytes"] - 1, 200
            if self.headers.get("Range"):
                match = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers["Range"])
                if not match:
                    raise Fault("RANGE_INVALID", "Select one byte range.", 416)
                start = int(match[1])
                end = min(end, int(match[2])) if match[2] else end
                if start > end or start >= item["bytes"]:
                    raise Fault("RANGE_INVALID", "The byte range is outside this retained file.", 416)
                status = 206
            filename = item["filename"].replace("\r", "").replace("\n", "")
            mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            inline = not download and mime in {"application/pdf", "image/png", "image/jpeg", "image/webp", "image/svg+xml", "text/plain", "text/html"}
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(max(0, end - start + 1)))
            self.send_header("Connection", "close")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("ETag", '"' + item["sha256"] + '"')
            self.send_header("Content-Disposition", ("inline" if inline else "attachment") + "; filename*=UTF-8''" + urllib.parse.quote(filename))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy",
                             content_security_policy or ("default-src 'none'; style-src 'unsafe-inline'; sandbox"
                             if mime == "text/html" else "default-src 'none'; sandbox"))
            self.send_header("Cache-Control", "private, no-store")
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{item['bytes']}")
            self.end_headers()
            file.seek(start)
            left = max(0, end - start + 1)
            while left:
                block = file.read(min(left, 1024*1024))
                if not block:
                    raise OSError("Retained file ended during download")
                self.wfile.write(block)
                left -= len(block)
        finally:
            file.close()

def start_server(directory, *, state_directory=None, create=False, title=None,
                 source_manifests=(), source_roots=(), port=0, restore_directory=None,
                 upload_limit=4*1024**3, extraction_limit=64*1024**3):
    directory = Path(directory).resolve()
    operator = Operator(directory, state_directory or directory.with_name(directory.name + "-operator"),
                        create=create, title=title, source_manifests=source_manifests, source_roots=source_roots,
                        restore_directory=restore_directory, upload_limit=upload_limit,
                        extraction_limit=extraction_limit)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except BaseException:
        operator.close()
        raise
    server.daemon_threads = True
    server.operator = operator
    operator.origin = "http://127.0.0.1:" + str(server.server_address[1])
    return server, {"origin": operator.origin, "operator_url": operator.origin + "/#token=" + operator.capability,
                    "workspace_key": operator.primary, "project": operator.ws(operator.primary).project}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--operator-state")
    parser.add_argument("--create", action="store_true")
    parser.add_argument("--title")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--source-manifest", action="append", default=[])
    parser.add_argument("--source-root", action="append", default=[], help="Original source directory available to registered preparation desks")
    parser.add_argument("--restore-directory")
    parser.add_argument("--upload-limit-mib", type=int, default=4096)
    parser.add_argument("--source-extraction-limit-mib", type=int, default=65536)
    args = parser.parse_args()
    if not 1 <= args.upload_limit_mib <= 65536 or not 1 <= args.source_extraction_limit_mib <= 1048576:
        parser.error("Choose positive explicit upload and source extraction capacities.")
    server, receipt = start_server(args.workspace, state_directory=args.operator_state, create=args.create,
                                   title=args.title, source_manifests=args.source_manifest, source_roots=args.source_root, port=args.port,
                                   restore_directory=args.restore_directory,
                                   upload_limit=args.upload_limit_mib*1024**2,
                                   extraction_limit=args.source_extraction_limit_mib*1024**2)
    print(json.dumps(receipt), flush=True)
    def drain(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, drain)
    signal.signal(signal.SIGINT, drain)
    try:
        server.serve_forever(poll_interval=.3)
    finally:
        server.server_close()
        server.operator.close()


# Native source-refresh registration. Preserve the original server and queue.
from source_refresh_native import install as _install_source_refresh
_install_source_refresh(globals())

if __name__ == "__main__":
    main()
