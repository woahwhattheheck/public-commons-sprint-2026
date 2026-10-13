"""Queued ECO13 receiving and immutable report editions in the original operator.

The installed scenario workbench owns comparison, costs, ranking and portable
receiving. This provider composes those operations with the existing Workspace,
serial queue, operation identity and verified file tickets.
"""
from __future__ import annotations

from collections import OrderedDict
import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import threading
import zipfile

from model.common import atomic_json, digest, file_digest, held, now, read_json
from model import comparison_review

APPLICATION = Path(__file__).resolve().parents[1]
PACKAGE = APPLICATION / "integrations" / "eco13_scenario_lab"
if str(PACKAGE) not in sys.path:
    sys.path.insert(0, str(PACKAGE))
from eco_scenario_lab import __version__ as SCENARIO_VERSION
from eco_scenario_lab import results, store, upstate_intake
from eco_scenario_lab.cli import _status
from eco_scenario_lab.engine import verify_plan

if Path(store.__file__).resolve().parent != (PACKAGE / "eco_scenario_lab").resolve():
    raise ImportError("ECO13 must use its installed original application package.")
if tuple(int(value) for value in SCENARIO_VERSION.split(".")[:3]) < (0, 1, 2):
    raise ImportError("Install ECO13 native experiment receiving 0.1.2 or newer.")

REVISION = "eco13-operator/1"
RECORD_SCHEMA = "upstate.eco13-record/v1"
ACTIONS = frozenset({
    "eco13.experiment.receive", "eco13.report.save",
    "eco13.comparison.export", "eco13.archive.receive",
    "eco13.review.create", "eco13.review.receive",
})
MAX_PAGE = 250
MONEY_LIMIT = 9007199254740991
_ALLOWED = {
    "eco13.experiment.receive": {
        "experiment_id", "title", "project_id", "setup_id",
        "currency", "scenario_costs", "page_size",
    },
    "eco13.report.save": {
        "record_id", "title", "scenario_costs", "objectives",
        "budget_cents", "clear_budget", "reset_report_options",
    },
    "eco13.comparison.export": {"record_id"},
    "eco13.archive.receive": {"upload_id", "title"},
    "eco13.review.create": {"record_id", "title", "purpose", "notes"},
    "eco13.review.receive": {"review_id", "source_collection_id", "title"},
}


def _id(value, label="record"):
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise ValueError("Choose the complete original " + label + " ID.")
    return value


def _integer(value, default, *, minimum=0, maximum=None):
    if value is None:
        return default
    if isinstance(value, bool) or re.fullmatch(r"[0-9]+", str(value)) is None:
        raise ValueError("Use a nonnegative whole number.")
    number = int(value)
    if number < minimum or (maximum is not None and number > maximum):
        raise ValueError("The selected number is outside the supported range.")
    return number


def _title(value, fallback):
    if value is None:
        value = fallback
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 200:
        raise ValueError("Use a report title from 1 to 200 characters.")
    if any(ord(char) < 32 and char not in "\n\t" for char in value):
        raise ValueError("The report title contains a control character.")
    return value.strip()


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Use a retained relative file path.")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or str(path) != value
            or any(part in ("", ".", "..") for part in path.parts)):
        raise ValueError("A retained path must stay inside its original record.")
    return path


def _inside(root, relative):
    root = Path(root).resolve()
    item = _relative(relative)
    path = root.joinpath(*item.parts)
    current = root
    for part in item.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("A retained record cannot use a symbolic link.")
    if not path.resolve().is_relative_to(root):
        raise ValueError("A retained file left its original record.")
    return path


def _regular(path):
    if path.is_symlink() or not stat.S_ISREG(path.stat().st_mode):
        raise ValueError("A retained output must be a regular file.")
    return path


def _descriptor(root, path, label=None):
    path = _regular(Path(path))
    return {"path": path.relative_to(root).as_posix(),
            "filename": path.name, "bytes": path.stat().st_size,
            "sha256": file_digest(path), "label": label or path.name}


def _verified(root, descriptor):
    path = _inside(root, descriptor["path"])
    _regular(path)
    if path.stat().st_size != descriptor["bytes"] or file_digest(path) != descriptor["sha256"]:
        raise ValueError("A retained ECO13 file changed: " + descriptor["path"])
    return path


def _tree(root):
    root = Path(root)
    def unreadable(error):
        raise ValueError(
            "A retained comparison directory could not be read: " + str(error)
        ) from error
    for directory, directories, filenames in os.walk(
            root, followlinks=False, onerror=unreadable):
        current = Path(directory)
        for name in directories:
            if (current / name).is_symlink():
                raise ValueError("A comparison directory contains a symbolic link.")
        for name in filenames:
            path = current / name
            if path == root / ".workspace.lock":
                continue
            yield _regular(path)


def _clone_comparison(source, destination):
    """Reuse immutable native bytes; give every report file an independent copy."""
    source, destination = Path(source), Path(destination)
    if destination.exists():
        return
    pending = Path(tempfile.mkdtemp(prefix=".eco13-clone-", dir=destination.parent))
    try:
        for path in _tree(source):
            relative = path.relative_to(source)
            target = pending / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if relative.parts[0] != "reports" and relative.name != "eco13-context.json":
                try:
                    os.link(path, target)
                    continue
                except OSError:
                    pass
            shutil.copy2(path, target)
        pending.rename(destination)
    finally:
        if pending.exists():
            shutil.rmtree(pending)



def _recover_task_staging(root, identity):
    """Remove only this retained task's interrupted private receiving trees.

    The original operator lock is held before this function is called. All three
    writers run in that same process and create their candidates with mkdtemp in
    the task-owned directory. The published comparison and unrelated names stay.
    """
    root = Path(root)
    marker = root / "operation.json"
    if marker.is_symlink() or not marker.is_file() or read_json(marker) != identity:
        raise ValueError("Staging recovery needs its original retained operation.")
    candidates = []
    for path in root.iterdir():
        if re.fullmatch(r"\.(?:eco13-clone|upstate-receiving|receiving)-[a-z0-9_]{8}",
                        path.name) is None:
            continue
        if path.is_symlink() or not path.is_dir():
            raise ValueError("An interrupted receiving candidate is not its original directory.")
        candidates.append(path)
    for path in candidates:
        shutil.rmtree(path)


def _record_scope(workspace, record_id):
    return _inside(workspace.root, "eco13/records/" + _id(record_id))


def _read_record(workspace, record_id):
    scope = _record_scope(workspace, record_id)
    value = read_json(scope / "record.json")
    if (value.get("schema") != RECORD_SCHEMA or value.get("id") != record_id
            or digest({key: item for key, item in value.items() if key != "record_sha256"})
            != value.get("record_sha256")):
        raise ValueError("The saved ECO13 record differs from its original edition.")
    _id(value.get("original_experiment_id"), "experiment")
    if (not isinstance(value.get("source_workspace_id"), str)
            or not value["source_workspace_id"] or len(value["source_workspace_id"]) > 200
            or any(ord(char) < 32 for char in value["source_workspace_id"])):
        raise ValueError("The original source Workspace identity is unavailable.")
    if value.get("kind") not in {"experiment", "report", "received"}:
        raise ValueError("The saved ECO13 record kind is unsupported.")
    if value.get("status") not in {"complete", "partial"}:
        raise ValueError("The saved ECO13 report status is unsupported.")
    if value.get("plan_sha256") != value.get("files", {}).get("plan", {}).get("plan_sha256"):
        raise ValueError("The saved ECO13 plan reference differs.")
    return scope, value


def _summary(record):
    fields = (
        "id", "kind", "title", "created_at", "status", "source_record_id",
        "original_experiment_id", "source_workspace_id", "currency",
        "selected_models", "counts", "plan_sha256", "project_id", "setup_id",
        "source_kind", "snapshot_started_at", "snapshot_completed_at",
    )
    return {name: copy.deepcopy(record.get(name)) for name in fields}


def _transfer_identities(task, action, payload):
    """Bind each retained transfer origin to this exact original request."""
    origin = task.get("transfer_origin")
    if origin is None:
        return []
    operation_id = task.get("operation_id")
    if not isinstance(operation_id, str) or not operation_id:
        raise ValueError("The received task has no original operation identity.")
    current = {"workspace": task["workspace"], "action": action, "payload": payload}
    if (task.get("request_sha256") != digest(current)
            or task.get("id") != digest({"workspace": task["workspace"],
                                        "operation_id": operation_id})):
        raise ValueError("The received task differs from its retained request.")
    identities = []
    while origin is not None:
        if not isinstance(origin, dict):
            raise ValueError("The received task has an invalid transfer history.")
        _id(origin.get("transfer_id"), "transfer")
        workspace_key = _id(origin.get("workspace_key"), "original workspace")
        task_id = _id(origin.get("task_id"), "original task")
        original_sha = digest({"workspace": workspace_key,
                               "action": action, "payload": payload})
        if (origin.get("request_sha256") != original_sha
                or task_id != digest({"workspace": workspace_key,
                                      "operation_id": operation_id})):
            raise ValueError("The received task differs from its original transferred selection.")
        identities.append({"id": task_id, "request_sha256": original_sha,
                           "action": action, "workspace": workspace_key})
        origin = origin.get("previous")
    return identities


def _missing_transferred_export(task, descriptor, identities):
    """Recognize only the sender-local archive of an exact transferred task."""
    if task.get("action") != "eco13.comparison.export" or not identities:
        return False
    expected = {"outputs/eco13-" + identity["id"] + ".zip" for identity in identities}
    if descriptor.get("path") not in expected:
        return False
    if (type(descriptor.get("bytes")) is not int or descriptor["bytes"] < 0
            or not isinstance(descriptor.get("sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", descriptor["sha256"])):
        raise ValueError("The original exported archive has an invalid retained identity.")
    return True


def _settings(root, plan, payload=None):
    payload = payload or {}
    for flag in ("clear_budget", "reset_report_options"):
        if flag in payload and type(payload[flag]) is not bool:
            raise ValueError(flag.replace("_", " ").capitalize() + " must be true or false.")
    saved = {}
    path = root / "reports" / "report-selection.json"
    if path.is_file() and not payload.get("reset_report_options", False):
        saved = read_json(path)
        if (not isinstance(saved, dict) or saved.get("schema") != 1
                or saved.get("plan_sha256") != plan["plan_sha256"]):
            raise ValueError("Saved report choices differ from this comparison edition.")
    selected = {
        "schema": 1, "plan_sha256": plan["plan_sha256"],
        "scenario_costs": payload.get("scenario_costs", saved.get("scenario_costs")),
        "objectives": payload.get("objectives", saved.get("objectives")),
        "budget_cents": (None if payload.get("clear_budget", False)
                         else payload.get("budget_cents", saved.get("budget_cents"))),
    }
    if selected["scenario_costs"] is not None:
        if not isinstance(selected["scenario_costs"], dict):
            raise ValueError("Costs must map the original alternative IDs to integer cents.")
        for key, value in selected["scenario_costs"].items():
            _id(key, "alternative")
            if type(value) is not int or not 0 <= value <= MONEY_LIMIT:
                raise ValueError("Use safely representable nonnegative integer cents.")
    if selected["budget_cents"] is not None:
        if (type(selected["budget_cents"]) is not int
                or not 0 <= selected["budget_cents"] <= MONEY_LIMIT):
            raise ValueError("Use safely representable nonnegative integer budget cents.")
        if selected["objectives"] is None:
            raise ValueError("Choose explicit objectives before applying a budget.")
    return selected


def _render(root, payload=None):
    """Build using the exact installed workbench science and ranking operations."""
    with store.exclusive(root):
        plan, state = verify_plan(root)
        if plan.get("mode") != upstate_intake.MODE:
            raise ValueError("Choose an original native experiment comparison.")
        selected = _settings(root, plan, payload)
        comparison = results.build_comparison(root)
        if comparison.get("source_kind") != upstate_intake.SOURCE_FORMAT:
            raise ValueError("The comparison does not contain the original native experiment.")
        if selected["scenario_costs"] is not None:
            comparison = results.apply_scenario_costs(root, comparison, selected["scenario_costs"])
        else:
            (root / "reports" / "scenario-costs.json").unlink(missing_ok=True)
        ranking = (results.rank(comparison, selected["objectives"], selected["budget_cents"])
                   if selected["objectives"] is not None else None)
        if ranking is None:
            (root / "reports" / "ranking.json").unlink(missing_ok=True)
        else:
            store.atomic_json(root / "reports" / "ranking.json", ranking)
        store.atomic_json(root / "reports" / "report-selection.json", selected)
        results.render_report(root, comparison, ranking)
    return plan, state, comparison, selected, ranking


def _archive_matches(archive, comparison):
    """Recover a ZIP created before its operation receipt was saved."""
    expected = {
        path.relative_to(comparison).as_posix():
            {"path": path.relative_to(comparison).as_posix(),
             "bytes": path.stat().st_size, "sha256": file_digest(path)}
        for path in _tree(comparison)
    }
    with zipfile.ZipFile(archive) as source:
        names = source.namelist()
        manifest = json.loads(source.read("PORTABLE-MANIFEST.json"))
        retained = {item["path"]: item for item in manifest["files"]}
        if (len(names) != len(set(names)) or manifest.get("schema") != 1
                or len(retained) != len(manifest["files"]) or retained != expected
                or set(names) != set(expected) | {"PORTABLE-MANIFEST.json"}):
            raise ValueError("The retained portable archive differs from its selected comparison.")
        for relative, item in expected.items():
            digestor = hashlib.sha256()
            count = 0
            with source.open(relative) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digestor.update(block)
                    count += len(block)
            if count != item["bytes"] or digestor.hexdigest() != item["sha256"]:
                raise ValueError("The retained portable archive member changed: " + relative)
    return len(expected)


class Eco13Operator:
    def __init__(self, operator, fault):
        self.app = operator
        self.Fault = fault
        self._cache = OrderedDict()
        self._cache_lock = threading.RLock()

    def _fail(self, code, error, status=422):
        raise self.Fault(code, str(error), status) from error

    def _json(self, root, descriptor):
        path = _inside(root, descriptor["path"])
        before = _regular(path).stat()
        signature = (str(path), descriptor["sha256"], descriptor["bytes"],
                     before.st_dev, before.st_ino, before.st_size,
                     before.st_mtime_ns, before.st_ctime_ns)
        with self._cache_lock:
            found = self._cache.get(signature)
            if found is not None:
                self._cache.move_to_end(signature)
                return found
        if before.st_size != descriptor["bytes"]:
            raise ValueError("A saved report file changed.")
        raw = path.read_bytes()
        after = path.stat()
        if (hashlib.sha256(raw).hexdigest() != descriptor["sha256"]
                or (after.st_dev, after.st_ino, after.st_size,
                    after.st_mtime_ns, after.st_ctime_ns) != signature[3:]):
            raise ValueError("A saved report file changed while it was opened.")
        value = json.loads(raw)
        with self._cache_lock:
            self._cache[signature] = value
            self._cache.move_to_end(signature)
            while len(self._cache) > 2:
                self._cache.popitem(last=False)
        return value

    def _entries(self, workspace):
        rows, issues = [], []
        root = _inside(workspace.root, "eco13/records")
        if root.exists():
            for path in root.glob("*/record.json"):
                try:
                    _, value = _read_record(workspace, path.parent.name)
                    rows.append(_summary(value))
                except (OSError, ValueError, KeyError) as error:
                    issues.append({"record_id": path.parent.name, "message": str(error)})
        rows.sort(key=lambda item: (item["created_at"], item["id"]), reverse=True)
        return rows, issues

    def overview(self, workspace_key):
        rows, issues = self._entries(self.app.ws(workspace_key))
        return {"records": rows, "issues": issues}

    def _downloads(self, workspace_key, scope, record):
        return self.app._files(workspace_key, {"files": record["files"]}, scope)

    def _view(self, workspace_key, record_id):
        ws = self.app.ws(workspace_key)
        scope, record = _read_record(ws, _id(record_id))
        comparison = self._json(scope, record["files"]["comparisons"])
        if comparison.get("plan_sha256") != record["plan_sha256"]:
            raise ValueError("The saved comparison belongs to another report edition.")
        selected = self._json(scope, record["files"]["selection"])
        if selected.get("plan_sha256") != record["plan_sha256"]:
            raise ValueError("The saved planning choices belong to another report edition.")
        ranking = (self._json(scope, record["files"]["ranking"])
                   if record["files"].get("ranking") else None)
        objectives = {}
        for row in comparison["rows"]:
            key = (str(row["watershed_id"]), row["metric"], row["unit"])
            objectives.setdefault(key, {
                "spatial_unit_id": row["watershed_id"], "metric": row["metric"],
                "unit": row["unit"],
                "label": row["metric"].replace("_", " ").capitalize() + " · " + row["unit"],
            })
        scenarios = [
            {"id": item["id"],
             "label": comparison.get("scenario_labels", {}).get(
                 item["id"], item.get("title") or item["id"]),
             "cost_cents": item.get("cost_cents")}
            for item in comparison["scenarios"]
        ]
        original = ws.root / "experiments" / record["original_experiment_id"] / "plan.json"
        available = (
            ws.project["id"] == record["source_workspace_id"] and original.is_file()
            and not original.is_symlink()
            and digest(read_json(original)) == record["original_experiment_id"]
        )
        return {
            "schema": "upstate.eco13-view/v1", "workspace_key": workspace_key,
            "record": _summary(record), "scenarios": scenarios,
            "objectives": list(objectives.values()),
            "settings": {key: copy.deepcopy(selected.get(key))
                         for key in ("objectives", "scenario_costs", "budget_cents")},
            "ranking": copy.deepcopy(ranking),
            "_downloads": self._downloads(workspace_key, scope, record),
            "original_experiment": {
                "id": record["original_experiment_id"], "available": bool(available),
                "action": "experiment-show", "view": "experiments",
            },
            "native_status": copy.deepcopy(record["native_status"]),
            "interpretation": comparison.get("interpretation"),
            "customer_reviews": comparison_review.catalog(ws, record_id=record_id),
        }

    def read(self, workspace_key, operation, payload=None):
        payload = payload or {}
        try:
            ws = self.app.ws(workspace_key)
            if operation == "catalog":
                from model import experiments
                records, issues = self._entries(ws)
                native = []
                try:
                    for item in experiments.list_experiments(ws):
                        row = {key: item[key] for key in
                               ("id", "title", "state", "counts", "models", "updated_at")
                               if key in item}
                        row["counts_exact"] = {key: str(value) for key, value in item.get("counts", {}).items()
                                               if type(value) is int}
                        native.append(row)
                except (OSError, ValueError, KeyError) as error:
                    issues.append({"source": "original_experiments", "message": str(error)})
                return {
                    "schema": "upstate.eco13-catalog/v1", "workspace_key": workspace_key,
                    "experiments": native, "records": records, "issues": issues,
                    "comparison_reviews": comparison_review.catalog(ws),
                    "limits": {"page_size": MAX_PAGE},
                }
            record_id = _id(payload.get("record_id", payload.get("id")))
            if operation == "record":
                return self._view(workspace_key, record_id)
            if operation == "economic-sources":
                from eco13_economics import CatalogueChanged, catalog as economic_sources
                scope, record = _read_record(ws, record_id)
                comparison = self._json(scope, record["files"]["comparisons"])
                try:
                    value = economic_sources(
                        ws, record, comparison,
                        offset=_integer(payload.get("offset"), 0),
                        limit=_integer(payload.get("limit"), 25, minimum=1, maximum=100),
                        listing_sha256=payload.get("listing_sha256") or None,
                    )
                except CatalogueChanged as error:
                    self._fail("ECO13_SOURCE_COLLECTION_CHANGED", error, 409)
                value["workspace_key"] = workspace_key
                return value
            if operation == "rows":
                scope, record = _read_record(ws, record_id)
                comparison = self._json(scope, record["files"]["comparisons"])
                kind = payload.get("kind", "outcomes")
                field = {"outcomes": "rows", "parameters": "parameter_rows", "incomplete": "incomplete"}.get(kind)
                if field is None:
                    raise ValueError("Choose outcomes, parameters or incomplete results.")
                offset = _integer(payload.get("offset"), 0)
                limit = _integer(payload.get("limit"), 100, minimum=1, maximum=MAX_PAGE)
                needle = str(payload.get("q") or "").strip().casefold()
                if len(needle) > 240:
                    raise ValueError("Use at most 240 characters in a report search.")
                selected = []
                for row in comparison.get(field, []):
                    if any(payload.get(key) and str(row.get(key, "")) != str(payload[key])
                           for key in ("scenario_id", "case_id")):
                        continue
                    if (payload.get("metric") and row.get("metric") != payload["metric"]
                            and not (kind == "incomplete" and not row.get("metric"))):
                        continue
                    if needle and needle not in " ".join(str(row.get(key) or "") for key in
                           ("case_label", "scenario_label", "metric", "unit",
                            "original_case_id", "original_run_id", "reason", "detail")).casefold():
                        continue
                    selected.append(row)
                end = min(len(selected), offset + limit)
                return {
                    "record_id": record_id, "kind": kind, "offset": offset, "limit": limit,
                    "total": len(selected), "next_offset": end if end < len(selected) else None,
                    "rows": copy.deepcopy(selected[offset:end]),
                }
            raise ValueError("Choose a supported ECO13 read operation.")
        except (OSError, ValueError, KeyError) as error:
            self._fail("ECO13_READ", error, 404 if isinstance(error, FileNotFoundError) else 422)

    def _task_input(self, task):
        action = task.get("action")
        payload = task.get("payload")
        if action not in ACTIONS or not isinstance(payload, dict):
            raise ValueError("Choose a supported queued ECO13 operation.")
        extra = set(payload) - _ALLOWED[action]
        if extra:
            raise ValueError("Unknown ECO13 selection fields: " + ", ".join(sorted(extra)))
        request = {"workspace": task["workspace"], "action": action, "payload": payload}
        original_sha = task.get("request_sha256") or digest(request)
        if original_sha != digest(request):
            raise ValueError("The task differs from its original retained request.")
        return action, payload, {"id": _id(task["id"], "task"), "request_sha256": original_sha,
                                 "action": action, "workspace": task["workspace"]}

    def _staging(self, ws, identity):
        # Native receiving explicitly requires a destination outside its source.
        # This task-owned sibling is promoted into Workspace/eco13 only after the
        # original receiver has completed its independent source snapshot.
        root = ws.root.resolve().parent / (".eco13-receiving-" + identity["id"])
        if root.is_symlink() or root.resolve().is_relative_to(ws.root.resolve()):
            raise ValueError("Choose a writable sibling for original experiment receiving.")
        root.mkdir(parents=False, exist_ok=True, mode=0o700)
        selection = root / "operation.json"
        if selection.exists():
            if selection.is_symlink() or read_json(selection) != identity:
                raise ValueError("The unfinished receiver belongs to another retained operation.")
            _recover_task_staging(root, identity)
        else:
            atomic_json(selection, identity, immutable=True)
        return root

    def _completed(self, ws, identity):
        scope = _record_scope(ws, identity["id"])
        if not scope.exists():
            return None
        scope, value = _read_record(ws, identity["id"])
        if value.get("operation") != identity:
            raise ValueError("The completed report belongs to another original operation.")
        for descriptor in value["files"].values():
            _verified(scope, descriptor)
        return value

    def _finalize(self, ws, workspace_key, stage, identity, kind, title,
                  source_record_id=None, archive_source=None):
        comparison_root = stage / "comparison"
        plan, state = verify_plan(comparison_root)
        comparison = read_json(comparison_root / "reports" / "comparisons.json")
        if (plan.get("mode") != upstate_intake.MODE
                or comparison.get("source_kind") != upstate_intake.SOURCE_FORMAT
                or comparison.get("plan_sha256") != plan["plan_sha256"]):
            raise ValueError("The received comparison differs from its original native plan.")
        status = _status(plan, state)
        status.pop("jobs", None)
        record = {
            "schema": RECORD_SCHEMA, "revision": REVISION, "id": identity["id"],
            "kind": kind, "title": title, "created_at": now(),
            "status": "partial" if comparison["incomplete"] else "complete",
            "source_record_id": source_record_id,
            "original_experiment_id": plan["source_manifest"]["original_experiment_id"],
            "source_workspace_id": plan["source_manifest"]["original_workspace_id"],
            "currency": plan["currency"], "selected_models": list(plan["models"]),
            "plan_sha256": plan["plan_sha256"], "project_id": plan["project_id"],
            "setup_id": plan["setup_id"], "source_kind": comparison["source_kind"],
            "snapshot_started_at": comparison.get("snapshot_started_at"),
            "snapshot_completed_at": comparison.get("snapshot_completed_at"),
            "counts": {
                "original_cases": plan["original_counts"]["cases"],
                "planned_native_runs": plan["original_counts"]["runs"],
                "case_model_slots": plan["adopted_case_model_slots"],
                "paired_records": len(comparison["rows"]),
                "parameter_records": len(comparison.get("parameter_rows", [])),
                "incomplete_records": len(comparison["incomplete"]),
            },
            "native_status": status, "operation": identity, "archive_source": archive_source,
        }
        portable_context = {
            "schema": "upstate.eco13-portable-context/v1",
            **{key: record[key] for key in (
                "id", "title", "kind", "created_at", "source_record_id",
                "original_experiment_id", "source_workspace_id", "plan_sha256")},
        }
        store.atomic_json(comparison_root / "eco13-context.json", portable_context)
        labels = {
            "index.html": "Complete offline comparison report",
            "comparisons.json": "Every retained paired outcome and source context",
            "comparisons.csv": "All paired alternative outcomes",
            "parameter-effects.csv": "Original reference and parameter outcomes",
            "incomplete.csv": "Unfinished native case and model availability",
            "ranking.json": "Original cost and compatible-support screening",
            "report-selection.json": "Saved objectives, costs and budget",
            "scenario-costs.json": "Explicit intervention cost edition",
        }
        files = {}
        for name, key in (
                ("index.html", "html"), ("comparisons.json", "comparisons"),
                ("comparisons.csv", "csv"), ("parameter-effects.csv", "parameters"),
                ("incomplete.csv", "incomplete"), ("ranking.json", "ranking"),
                ("report-selection.json", "selection"), ("scenario-costs.json", "costs")):
            path = comparison_root / "reports" / name
            if path.is_file():
                files[key] = _descriptor(stage, path, labels[name])
        for key, name, label in (
                ("plan", "plan.json", "Original immutable receiving plan"),
                ("state", "state.json", "Received native case and model states"),
                ("context", "eco13-context.json", "Portable report edition context")):
            files[key] = _descriptor(stage, comparison_root / name, label)
        files["plan"]["plan_sha256"] = plan["plan_sha256"]
        record["files"] = files
        record["record_sha256"] = digest(record)
        atomic_json(stage / "record.json", record, immutable=True)
        self._promote(ws, stage, identity, record)
        return record

    def _promote(self, ws, stage, identity, record):
        destination = _record_scope(ws, identity["id"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            raise ValueError("A different receiving directory already uses this operation ID.")
        try:
            stage.rename(destination)
        except OSError as error:
            if getattr(error, "errno", None) != 18:
                raise
            # A Workspace may itself be a mounted volume. Prepare the complete
            # receiving directory on that volume before the atomic promotion.
            copy_root = destination.parent / (".receiving-" + identity["id"])
            if copy_root.is_symlink():
                raise ValueError("The receiving staging directory is an alias.")
            if copy_root.exists():
                marker = copy_root / "operation.json"
                if not marker.is_file() or read_json(marker) != identity:
                    raise ValueError("An existing staging directory belongs to another operation.")
                shutil.rmtree(copy_root)
            copy_root.mkdir(mode=0o700)
            atomic_json(copy_root / "operation.json", identity, immutable=True)
            for path in _tree(stage):
                relative = path.relative_to(stage)
                if relative.as_posix() == "operation.json":
                    continue
                target = copy_root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
            for descriptor in record["files"].values():
                _verified(copy_root, descriptor)
            verify_plan(copy_root / "comparison")
            copy_root.rename(destination)
            shutil.rmtree(stage)

    def _export(self, ws, workspace_key, task, identity, payload):
        scope, record = _read_record(ws, _id(payload.get("record_id")))
        comparison = scope / "comparison"
        for descriptor in record["files"].values():
            _verified(scope, descriptor)
        verify_plan(comparison)
        output = self.app.root / "outputs"
        output.mkdir(parents=True, exist_ok=True)
        archive = output / ("eco13-" + identity["id"] + ".zip")
        receipt_path = output / ("eco13-" + identity["id"] + ".json")
        if receipt_path.exists():
            receipt = read_json(receipt_path)
            if (receipt.get("operation") != identity
                    or receipt.get("record_sha256") != record["record_sha256"]):
                raise ValueError("The completed export belongs to another retained selection.")
            _verified(self.app.root, receipt["archive"])
        else:
            if archive.exists():
                _archive_matches(archive, comparison)
            else:
                store.export_workspace(comparison, archive)
            descriptor = _descriptor(self.app.root, archive, "Portable comparison and retained original native files")
            receipt = {
                "schema": "upstate.eco13-export/v1", "operation": identity,
                "record_id": record["id"], "record_sha256": record["record_sha256"],
                "archive": descriptor, "created_at": now(),
            }
            atomic_json(receipt_path, receipt, immutable=True)
        return {
            "record_id": record["id"], "report_status": record["status"],
            "summary": _summary(record), "archive": receipt["archive"],
        }

    def invoke(self, task):
        try:
            action, payload, identity = self._task_input(task)
            ws = self.app.ws(task["workspace"])
            lock_root = _inside(ws.root, "eco13")
            lock_root.mkdir(parents=True, exist_ok=True)
            with held(lock_root / ".operator.lock", blocking=False):
                if action == "eco13.comparison.export":
                    return self._export(ws, task["workspace"], task, identity, payload)
                if action == "eco13.review.create":
                    selection = {"schema": comparison_review.SELECTION_SCHEMA, **payload}
                    for original in _transfer_identities(task, action, payload):
                        captured = comparison_review.completed(ws, selection, original["id"])
                        if captured is not None:
                            return {**captured, "reused_completed_output": True}
                    return comparison_review.create(
                        ws, selection, operation_id=identity["id"], created_at=task["created_at"])
                completed = self._completed(ws, identity)
                if completed is None:
                    for original in _transfer_identities(task, action, payload):
                        completed = self._completed(ws, original)
                        if completed is not None:
                            break
                if completed is not None:
                    return {"record_id": completed["id"], "report_status": completed["status"],
                            "summary": _summary(completed), "reused_completed_output": True,
                            "retained_task_id": completed["operation"]["id"]}
                stage = self._staging(ws, identity)
                # After a crash between writing the immutable record and moving
                # its directory, promote that same complete edition directly.
                ready = stage / "record.json"
                if ready.is_file():
                    value = read_json(ready)
                    if (value.get("operation") != identity
                            or digest({key: item for key, item in value.items()
                                       if key != "record_sha256"}) != value.get("record_sha256")):
                        raise ValueError("The prepared report edition differs from its retained operation.")
                    for descriptor in value["files"].values():
                        _verified(stage, descriptor)
                    verify_plan(stage / "comparison")
                    self._promote(ws, stage, identity, value)
                    return {"record_id": value["id"], "report_status": value["status"],
                            "summary": _summary(value), "reused_completed_output": True}
                root = stage / "comparison"
                source_record_id, archive_source = None, None
                if action == "eco13.experiment.receive":
                    experiment_id = _id(payload.get("experiment_id"), "experiment")
                    title = _title(payload.get("title"), "Native experiment " + experiment_id[:12])
                    if not root.exists():
                        upstate_intake.adopt_workspace(
                            ws, experiment_id, root,
                            project_id=payload.get("project_id"),
                            setup_id=payload.get("setup_id"),
                            currency=payload.get("currency"),
                            scenario_costs=payload.get("scenario_costs"),
                            page_size=_integer(payload.get("page_size"), MAX_PAGE,
                                               minimum=1, maximum=MAX_PAGE))
                    plan, _ = verify_plan(root)
                    if (plan["source_manifest"]["original_experiment_id"] != experiment_id
                            or plan["project_id"] != payload.get("project_id")
                            or plan["setup_id"] != payload.get("setup_id")
                            or plan["currency"] != payload.get("currency")):
                        raise ValueError("The completed native snapshot differs from this receiving selection.")
                    _render(root)
                    kind = "experiment"
                elif action == "eco13.report.save":
                    source_record_id = _id(payload.get("record_id"))
                    source_scope, source = _read_record(ws, source_record_id)
                    title = _title(payload.get("title"), source["title"])
                    if not root.exists():
                        for descriptor in source["files"].values():
                            _verified(source_scope, descriptor)
                        verify_plan(source_scope / "comparison")
                        _clone_comparison(source_scope / "comparison", root)
                    _render(root, payload)
                    kind = "report"
                else:
                    if action == "eco13.review.receive":
                        archive_path, original_archive = comparison_review.archive_for_review(
                            ws, _id(payload.get("review_id"), "review"),
                            _id(payload.get("source_collection_id"), "source collection"))
                        archive_source = {"kind": "comparison-review", **original_archive}
                    else:
                        upload = self.app.upload(_id(payload.get("upload_id"), "upload"))
                        archive_path = Path(upload["path"])
                        archive_source = {key: upload[key] for key in ("id", "filename", "bytes", "sha256")}
                    if not root.exists():
                        store.receive_workspace(archive_path, root)
                    plan, _ = verify_plan(root)
                    if plan.get("mode") != upstate_intake.MODE:
                        raise ValueError("Choose a portable original experiment comparison.")
                    context = root / "eco13-context.json"
                    original_context_path = stage / "received-context.json"
                    if original_context_path.is_file():
                        original_context = read_json(original_context_path)
                    else:
                        original_context = read_json(context) if context.is_file() else {}
                        atomic_json(original_context_path, original_context, immutable=True)
                    if original_context:
                        if (original_context.get("schema") != "upstate.eco13-portable-context/v1"
                                or original_context.get("plan_sha256") != plan["plan_sha256"]):
                            raise ValueError("The portable report context differs from its native plan.")
                        source_record_id = _id(original_context.get("id"), "source report")
                    title = _title(payload.get("title"),
                                   original_context.get("title") or
                                   "Received " + plan["project_id"] + " / " + plan["setup_id"])
                    _render(root)
                    kind = "received"
                value = self._finalize(ws, task["workspace"], stage, identity, kind, title,
                                       source_record_id=source_record_id, archive_source=archive_source)
                return {"record_id": value["id"], "report_status": value["status"],
                        "summary": _summary(value)}
        except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
            self._fail("ECO13_ACTION", error)

    def decorate_task(self, task):
        if task.get("action") in ACTIONS and task.get("state") == "complete":
            result = task.get("result", {})
            record_id = _id(result.get("record_id"))
            ws = self.app.ws(task["workspace"])
            scope, record = _read_record(ws, record_id)
            task["_eco13"] = {"record_id": record_id, "title": record["title"], "status": record["status"]}
            task["_item"] = {"kind": "eco13-records", "id": record_id}
            if task["action"] == "eco13.review.create":
                capture = comparison_review.summary(ws, _id(result.get("capture_id"), "comparison capture"))
                if capture["record_id"] != record_id or capture["review_id"] != result.get("review_id"):
                    raise ValueError("The retained review task differs from its original comparison capture.")
                task["_review"] = {"review_id": capture["review_id"], "kind": "comparison-review"}
                task["_eco13"]["review_id"] = capture["review_id"]
            task["_downloads"] = self._downloads(task["workspace"], scope, record)
            if result.get("archive"):
                original = result["archive"]
                try:
                    path = _verified(self.app.root, original)
                except FileNotFoundError:
                    action, payload, _ = self._task_input(task)
                    identities = _transfer_identities(task, action, payload)
                    if not _missing_transferred_export(task, original, identities):
                        raise
                    task["_eco13"]["archive_status"] = "export_from_saved_record"
                    task["_eco13"]["archive_message"] = (
                        "This received project retains the complete comparison. "
                        "Open comparison and choose Export editable comparison "
                        "to create its archive on this computer.")
                else:
                    task["_downloads"].append(
                        self.app._ticket(task["workspace"], path, original, original.get("label")))
        return task

    def verify_workspace(self, workspace):
        records = []
        root = _inside(workspace.root, "eco13/records")
        for path in sorted(root.glob("*/record.json")):
            scope, record = _read_record(workspace, path.parent.name)
            plan = self._json(scope, record["files"]["plan"])
            if (digest({key: value for key, value in plan.items() if key != "plan_sha256"})
                    != record["plan_sha256"] or plan.get("mode") != upstate_intake.MODE):
                raise ValueError("A restored ECO13 plan differs from its original experiment.")
            for descriptor in record["files"].values():
                _verified(scope, descriptor)
            comparison = self._json(scope, record["files"]["comparisons"])
            if comparison.get("plan_sha256") != record["plan_sha256"]:
                raise ValueError("A restored ECO13 report belongs to another native plan.")
            records.append({"id": record["id"], "status": record["status"],
                            "files": len(record["files"]), "plan_sha256": record["plan_sha256"]})
        return {"schema": "upstate.eco13-workspace-verification/v1", "records": records,
                **comparison_review.verify_all(workspace)}
