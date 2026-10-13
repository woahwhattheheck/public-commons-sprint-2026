"""Native queued comparison/incorporation of complete returned Measurements editions.

The original returned_review_cli owns every scientific comparison and native edit.
This provider binds existing archive IDs to bytes, retains complete handoffs, and
uses the original operator queue, authorisation and download tickets.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import threading
import zipfile

from model.common import (atomic_json, canonical, describe_file, digest, held,
                          identifier, now, read_json)

FAMILY = "measurement-returned-reviews"
SCHEMA = "upstate.measurement-returned-review-operation/v1"
ACTIONS = ("measurements.returned-review.plan", "measurements.returned-review.apply")
ROLES = ("baseline", "returned", "current")
_CACHED = {}
_CACHE_LOCK = threading.RLock()


def ordinary(root, relative, *, existing=True):
    """Resolve only ordinary descendants, checking each existing ancestor."""
    root = Path(root).resolve(strict=True)
    relative = Path(relative)
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        raise ValueError("Choose a retained relative project member")
    current = root
    for part in relative.parts:
        current = current / part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            if existing:
                raise
            continue
        if stat.S_ISLNK(mode):
            raise ValueError("Returned-review members must not be symbolic links")
        if not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
            raise ValueError("Returned-review members must be ordinary files")
    return current


def identity(path, *, cached=False):
    path = Path(path)
    before = path.stat()
    stamp = (before.st_dev, before.st_ino, before.st_size,
             before.st_mtime_ns, before.st_ctime_ns)
    key = str(path)
    if cached:
        with _CACHE_LOCK:
            retained = _CACHED.get(key)
            if retained and retained[0] == stamp:
                return dict(retained[1])
    checksum, count = hashlib.sha256(), 0
    with path.open("rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Choose a retained regular archive")
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
            count += len(block)
    after = path.stat()
    state = (after.st_dev, after.st_ino, after.st_size,
             after.st_mtime_ns, after.st_ctime_ns)
    if state != stamp or count != before.st_size:
        raise ValueError("The selected archive changed while it was being read")
    result = {"bytes": count, "sha256": checksum.hexdigest()}
    if cached:
        with _CACHE_LOCK:
            if len(_CACHED) >= 128:
                _CACHED.pop(next(iter(_CACHED)))
            _CACHED[key] = (stamp, result)
    return result


def native_catalog(operator, workspace_key, path):
    response = operator.extensions.read("POST", "/api/measurements/rpc", workspace_key,
        {"workspace": workspace_key, "method": "GET", "path": path})
    value = json.loads(response["body"])
    if response["status"] >= 400:
        raise ValueError(value.get("error", "The original archive catalog is unavailable"))
    return value


def archive_path(workspace, kind, key):
    key = identifier(key)
    suffix = ("exports/" + key + "/files/project.zip" if kind == "edition" else
              "intakes/" + key + "/original" if kind == "intake" else None)
    if suffix is None:
        raise ValueError("Choose a saved edition or complete portable upload")
    return ordinary(workspace.root, "measurement-observations/.large/" + suffix)


def archives(operator, workspace_key):
    workspace = operator.ws(workspace_key)
    rows, issues = [], []
    editions = native_catalog(operator, workspace_key, "/large/editions").get("editions", [])
    intakes = native_catalog(operator, workspace_key, "/large/intakes").get("intakes", [])
    for kind, entries in (("edition", editions), ("intake", intakes)):
        for entry in entries:
            expected = None
            if kind == "edition":
                expected = next((f for f in entry.get("files", [])
                                 if f.get("path") == "project.zip"), None)
                if expected is None:
                    continue
            elif entry.get("kind") != "portable" or entry.get("offset") != entry.get("bytes"):
                continue
            try:
                path = archive_path(workspace, kind, entry["id"])
                actual = identity(path, cached=True)
                if kind == "edition" and any(actual[k] != expected[k] for k in actual):
                    raise ValueError("The complete edition differs from its native manifest")
                if kind == "intake" and actual["bytes"] != entry["bytes"]:
                    raise ValueError("The portable upload is incomplete")
                rows.append({"kind": kind, "id": entry["id"], **actual,
                    "title": entry.get("label") or
                        ("Saved edition " + str(entry.get("workspaceRevision", ""))),
                    "revision": entry.get("workspaceRevision"),
                    "created_at": entry.get("createdAt"), "records": entry.get("recordCount")})
            except (OSError, ValueError, KeyError) as error:
                issues.append({"kind": kind, "id": entry.get("id"), "message": str(error)})
    return rows, issues


def selected_archive(workspace, selection):
    if not isinstance(selection, dict) or set(selection) != {"kind", "id", "bytes", "sha256"}:
        raise ValueError("Select one exact catalog archive with its byte identity")
    identifier(selection["sha256"])
    if not isinstance(selection["bytes"], int) or isinstance(selection["bytes"], bool) or selection["bytes"] <= 0:
        raise ValueError("Select a complete nonempty native archive")
    path = archive_path(workspace, selection["kind"], selection["id"])
    base = "measurement-observations/.large/"
    if selection["kind"] == "edition":
        metadata = read_json(ordinary(workspace.root, base + "exports/" + selection["id"] + "/edition.json"))
        member = next((f for f in metadata.get("files", []) if f.get("path") == "project.zip"), None)
        if member is None or any(member[k] != selection[k] for k in ("bytes", "sha256")):
            raise ValueError("The selected native edition identity changed")
    else:
        metadata = read_json(ordinary(workspace.root, base + "intakes/" + selection["id"] + "/intake.json"))
        if metadata.get("kind") != "portable" or metadata.get("offset") != selection["bytes"] or metadata.get("bytes") != selection["bytes"]:
            raise ValueError("The selected portable upload is incomplete")
    if identity(path) != {k: selection[k] for k in ("bytes", "sha256")}:
        raise ValueError("The selected original archive changed; refresh the catalog")
    return path


def location(workspace, kind, key, *, existing=True):
    if kind not in {"plan", "result"}:
        raise ValueError("Choose a comparison or an incorporation")
    return ordinary(workspace.root, FAMILY + "/" + kind + "s/" + identifier(key), existing=existing)



def verified_member(workspace, member):
    path = ordinary(workspace.root, member["path"])
    actual = identity(path, cached=True)
    if actual != {k: member[k] for k in ("bytes", "sha256")}:
        raise ValueError("A retained returned-review file changed: " + member["path"])
    return path


def inspect(workspace, kind, key):
    directory = location(workspace, kind, key)
    record = read_json(ordinary(directory, "record.json"))
    if record.get("schema") != SCHEMA or record.get("id") != key or record.get("kind") != kind:
        raise ValueError("The saved returned-review operation identity changed")
    if digest(record["request"]) != key:
        raise ValueError("The saved returned-review request changed")
    for member in record["retained_files"]:
        verified_member(workspace, member)
    return record


def catalog_records(workspace, kind):
    base = ordinary(workspace.root, FAMILY + "/" + kind + "s", existing=False)
    if not base.exists():
        return []
    rows = []
    for directory in sorted(base.iterdir()):
        if not re.fullmatch(r"[0-9a-f]{64}", directory.name):
            continue
        path = ordinary(workspace.root, directory.relative_to(workspace.root) / "record.json", existing=False)
        if not path.is_file():
            continue
        record = read_json(path)
        if (record.get("schema") != SCHEMA or record.get("id") != directory.name
                or record.get("kind") != kind or digest(record["request"]) != directory.name):
            raise ValueError("A saved returned-review catalog record changed")
        rows.append({k: record[k] for k in ("id", "title", "created_at", "counts", "plan_id",
            "native_plan_id", "record_count", "edition_id") if k in record})
    return rows


def run_native(command, **options):
    node = shutil.which("node")
    if not node:
        raise RuntimeError("The original Measurements engine requires Node 22.16 or newer")
    cli = Path(__file__).resolve().parents[1] / "measurement_workspace" / "engine" / "returned_review_cli.mjs"
    arguments = [node, str(cli), command]
    for name, value in options.items():
        arguments += ["--" + name, str(value)]
    process = subprocess.run(arguments, capture_output=True, text=True,
        env={**os.environ, "MEASUREMENTS_PYTHON": sys.executable}, check=False)
    if process.returncode:
        lines = process.stderr.strip().splitlines()
        message = lines[-1] if lines else "The original returned-review engine failed"
        try:
            message = json.loads(message).get("error", message)
        except (ValueError, AttributeError):
            pass
        raise RuntimeError(message)
    return json.loads(process.stdout)


def tree_files(root):
    result = []
    for path in sorted(root.rglob("*")):
        ordinary(root, path.relative_to(root))
        if path.is_file() and not path.name.startswith("operation.lock.sqlite"):
            result.append(path)
    return result


def package(destination, entries):
    """Stream an independent complete ZIP; publish only after every file is copied."""
    pending = destination.with_suffix(".partial")
    pending.unlink(missing_ok=True)
    try:
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            names = set()
            for source, name in entries:
                if name in names:
                    raise ValueError("Repeated returned-review archive member")
                names.add(name)
                archive.write(source, name)
        with pending.open("rb") as stream:
            os.fsync(stream.fileno())
        os.replace(pending, destination)
    finally:
        pending.unlink(missing_ok=True)


def retained(workspace, path, label):
    return describe_file(workspace.root, path, label=label, filename=path.name)


def complete_record(workspace, directory, request, native, kind, files, downloads, **extra):
    record = {**{k: v for k, v in native.items() if k not in {"directory", "reused", "alreadyCompleted"}},
        "schema": SCHEMA, "id": digest(request), "kind": kind, "request": request,
        "created_at": native.get("createdAt") or native.get("completedAt") or now(),
        "retained_files": files, "download_paths": downloads, **extra}
    atomic_json(directory / "record.json", record, immutable=True)
    return record


def plan(operator, workspace_key, payload):
    if set(payload) != {"title", *ROLES}:
        raise ValueError("Choose a title and three complete native editions")
    title = payload["title"]
    if not isinstance(title, str) or not title.strip() or len(title) > 240 or title.startswith("--"):
        raise ValueError("Enter a comparison title of 1–240 characters")
    workspace = operator.ws(workspace_key)
    request = {"schema": SCHEMA, "kind": "plan", **payload}
    key = digest(request)
    directory = location(workspace, "plan", key, existing=False)
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / "operation.lock"):
        if (directory / "record.json").exists():
            return inspect(workspace, "plan", key)
        sources = {role: selected_archive(workspace, payload[role]) for role in ROLES}
        comparison = directory / "comparison"
        native = run_native("plan", **sources, output=comparison, title=title)
        # Bind the engine's retained copies to the admitted exact archive selection.
        if any(native["inputs"][role] != {k: payload[role][k] for k in ("bytes", "sha256")} for role in ROLES):
            raise ValueError("A source changed between selection and native comparison")
        members = tree_files(comparison)
        bundle = directory / "comparison.zip"
        package(bundle, [(p, p.relative_to(comparison).as_posix()) for p in members])
        files = [retained(workspace, p, p.name) for p in members]
        files.append(retained(workspace, bundle, "Complete comparison — extract and open review.html"))
        chosen = [bundle, comparison / "review.html", comparison / "decisions-template.json",
                  comparison / "changes.csv", comparison / "changes.jsonl", comparison / "plan.json"]
        return complete_record(workspace, directory, request, native, "plan", files,
            [p.relative_to(workspace.root).as_posix() for p in chosen if p.is_file()],
            native_plan_id=native["id"], title=title)


def apply(operator, workspace_key, payload):
    if set(payload) != {"plan_id", "decisions_upload_id"}:
        raise ValueError("Choose one saved comparison and its uploaded decisions")
    workspace = operator.ws(workspace_key)
    parent = inspect(workspace, "plan", identifier(payload["plan_id"]))
    upload = operator.upload(identifier(payload["decisions_upload_id"]))
    request = {"schema": SCHEMA, "kind": "result", "plan_id": parent["id"],
               "decisions": {k: upload[k] for k in ("bytes", "sha256")}}
    key = digest(request)
    directory = location(workspace, "result", key, existing=False)
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / "operation.lock"):
        if (directory / "record.json").exists():
            return inspect(workspace, "result", key)
        decision_path = directory / "submitted-decisions.json"
        if not decision_path.exists():
            pending = directory / "submitted-decisions.partial"
            with open(upload["path"], "rb") as source, pending.open("wb") as target:
                shutil.copyfileobj(source, target, 1024 * 1024)
                target.flush()
                os.fsync(target.fileno())
            if identity(pending) != request["decisions"]:
                raise ValueError("The submitted decisions changed")
            os.replace(pending, decision_path)
        if identity(decision_path) != request["decisions"]:
            raise ValueError("The retained submitted decisions changed")
        comparison = location(workspace, "plan", parent["id"]) / "comparison"
        output = directory / "result"
        native = run_native("apply", plan=comparison, decisions=decision_path, output=output)
        if native.get("planId") != parent["native_plan_id"]:
            raise ValueError("The native incorporation belongs to another comparison")
        # All frozen native edition members are retained; the editable SQLite is
        # deliberately outside this immutable inventory and can acquire later edits.
        fixed = tree_files(output / "edition")
        for name in ("incorporated.json", "RECEIVING.md", "native-actions.json",
                     "native-actions.jsonl", "decisions.json", "incorporation-request.json"):
            path = ordinary(output, name, existing=False)
            if path.is_file():
                fixed.append(path)
        entries = [(p, "comparison/" + p.relative_to(comparison).as_posix())
                   for p in tree_files(comparison)]
        entries += [(p, "result/" + p.relative_to(output).as_posix()) for p in fixed]
        entries.append((decision_path, "submitted-decisions.json"))
        bundle = directory / "returned-review-handoff.zip"
        package(bundle, entries)
        files = [retained(workspace, p, p.name) for p in [decision_path, *fixed]]
        files.append(retained(workspace, bundle, "Complete comparison and incorporation handoff"))
        chosen = [bundle, output / "edition" / "project.zip", output / "RECEIVING.md",
                  output / "incorporated.json", decision_path]
        return complete_record(workspace, directory, request, native, "result", files,
            [p.relative_to(workspace.root).as_posix() for p in chosen if p.is_file()],
            title=parent["title"], plan_id=parent["id"], native_plan_id=parent["native_plan_id"],
            record_count=native.get("recordCount"), edition_id=native.get("editionId"))


def decorated(operator, workspace_key, record):
    workspace = operator.ws(workspace_key)
    selected = {item["path"]: item for item in record["retained_files"]}
    downloads = []
    for path in record["download_paths"]:
        item = selected[path]
        downloads.append(operator._ticket(workspace_key, verified_member(workspace, item),
                                          item, item["label"]))
    public = {k: deepcopy(v) for k, v in record.items() if k not in
              {"retained_files", "download_paths", "request"}}
    return {"record": public, "downloads": downloads}


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    value = {k: v for k, v in payload.items() if k != "workspace"}
    if operation == "catalog":
        if value:
            raise ValueError("The archive catalog takes no additional parameters")
        choices, issues = archives(operator, workspace_key)
        return {"archives": choices, "archive_issues": issues,
                "plans": catalog_records(workspace, "plan"),
                "results": catalog_records(workspace, "result")}
    if operation == "inspect" and set(value) == {"kind", "id"}:
        return decorated(operator, workspace_key, inspect(workspace, value["kind"], value["id"]))
    raise ValueError("Choose a registered returned-review operation")


def perform(operator, task):
    if task["action"] == ACTIONS[0]:
        record = plan(operator, task["workspace"], task["payload"])
    elif task["action"] == ACTIONS[1]:
        record = apply(operator, task["workspace"], task["payload"])
    else:
        raise ValueError("Choose a registered returned-review task")
    return {k: record[k] for k in ("id", "kind", "title", "native_plan_id", "plan_id",
                                  "record_count", "edition_id") if k in record}


def decorate_task(operator, task):
    if task.get("action") not in ACTIONS or task.get("state") != "complete":
        return task
    public = deepcopy(task)
    result = task["result"]
    record = inspect(operator.ws(task["workspace"]), result["kind"], result["id"])
    public["_downloads"] = decorated(operator, task["workspace"], record)["downloads"]
    return public


def verify_workspace(workspace):
    counts = {}
    for kind in ("plan", "result"):
        rows = catalog_records(workspace, kind)
        for row in rows:
            inspect(workspace, kind, row["id"])
        counts[kind + "s"] = len(rows)
    return counts
