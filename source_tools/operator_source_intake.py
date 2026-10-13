#!/usr/bin/env python3
"""Prepare and compose original regional sources through a running native operator."""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

SCHEMA = "upstate.operator-source-intake/v1"
MAX_RESPONSE = 32 * 1024 * 1024
ACTIVE = {"queued", "running"}
PINNED = {
    "prism": {
        "archive": {"bytes": 62685097, "sha256": "763f97b677711112ff7b1082c794476e2d9b7abe1f6e55dd4f1166e32523ccd3",
                    "file_id": "F0C8H2FGAUV"},
        "transfer": {"bytes": 3873, "sha256": "42ae6aa2a7d9fb987983c970ccc130b9045e330cd7e893f6dc92b67e01f68a53",
                     "path": "source/prism-precipitation-1991-2020/source-transfer.json"},
    },
    "erosivity": {
        "archive": {"bytes": 47143128, "sha256": "157bbcaa54b445f96506fb1caffda4bbaea6b28f71bc7199235705e69cd00596",
                    "file_id": "F0C9BC7MKME"},
        "transfer": {"bytes": 2741, "sha256": "2d35dd182aac3efc65287efe717846b88b43e993eb701d5e6e13b68c9c07ee88",
                     "path": "source/noaa-r-factor-conus-2013/source-transfer.json"},
        "metadata": {"bytes": 65357, "sha256": "71c5fdb6f6aa4285fe77c48331eb4cc35789bcfdab4be0ba3560df9f4798d5be",
                     "path": "source/noaa-r-factor-conus-2013/metadata.html"},
        "metadata_capture": {"bytes": 491, "sha256": "12b170be2ad60abaa048b6b3bdf3cffe6ce43d03a602eadac379e156cf871cb7",
                             "path": "source/noaa-r-factor-conus-2013/metadata.html.capture.json"},
    },
}


class IntakeError(Exception):
    pass


class APIError(IntakeError):
    def __init__(self, status, code, message):
        self.status, self.code = status, code
        super().__init__(f"Operator HTTP {status} [{code}]: {message}")


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def identity(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def checked_id(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise IntakeError(f"{label} must be an exact retained 64-character identifier.")
    return value


def operation(prefix, suffix):
    value = prefix + "-" + suffix
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", value):
        raise IntakeError("Each derived operation ID must contain 16–100 letters, digits, underscores or hyphens.")
    return value


def secret(args):
    if args.capability_file:
        flags = os.O_RDONLY | os.O_CLOEXEC | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(args.capability_file, flags)
        with os.fdopen(fd, "rb") as handle:
            info = os.fstat(handle.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                    or stat.S_IMODE(info.st_mode) & 0o077):
                raise IntakeError("The capability file must be an ordinary file owned by this user with mode 0600 or 0400.")
            raw = handle.read(4097)
            if len(raw) > 4096:
                raise IntakeError("The capability file must contain only the current operator capability.")
        try:
            value = raw.decode("utf-8").strip()
        except UnicodeError as error:
            raise IntakeError("The capability file must contain UTF-8 text.") from error
    else:
        value = os.environ.get(args.capability_env or "UPSTATE_OPERATOR_CAPABILITY", "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,512}", value):
        raise IntakeError("Set the selected environment variable or owner-only file to the current operator capability.")
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, origin, capability, timeout):
        url = urllib.parse.urlsplit(origin)
        if (url.scheme not in {"http", "https"} or not url.hostname or url.username is not None
                or url.password is not None or url.query or url.fragment or url.path not in {"", "/"}):
            raise IntakeError("Use the operator origin, such as http://127.0.0.1:8765, without a token or path.")
        try:
            url.port
        except ValueError as error:
            raise IntakeError("Use the active operator's valid port.") from error
        try:
            loopback = url.hostname == "localhost" or ipaddress.ip_address(url.hostname).is_loopback
        except ValueError:
            loopback = url.hostname == "localhost"
        if url.scheme == "http" and not loopback:
            raise IntakeError("Use the local HTTP operator origin or an HTTPS operator origin.")
        self.origin = urllib.parse.urlunsplit((url.scheme, url.netloc, "", "", ""))
        self.capability, self.timeout = capability, timeout
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def redact(self, value):
        if isinstance(value, str):
            return value.replace(self.capability, "[redacted]")
        if isinstance(value, dict):
            return {key: self.redact(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self.redact(item) for item in value]
        return value

    def request(self, path, *, query=None, body=None, raw=False):
        if not path.startswith("/api/") or "?" in path or "#" in path:
            raise IntakeError("Choose an original operator API route.")
        url = self.origin + path
        if query:
            url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
        data = canonical(body) if body is not None else None
        request = urllib.request.Request(url, data=data, method="POST" if data is not None else "GET",
            headers={"Authorization": "Bearer " + self.capability, "Accept": "application/json",
                     "Content-Type": "application/json", "Cache-Control": "no-store"})
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                if response.geturl() != url:
                    raise IntakeError("The operator unexpectedly redirected the authenticated request.")
                result = response.read(MAX_RESPONSE + 1)
        except urllib.error.HTTPError as error:
            payload = error.read(65537)
            try:
                detail = json.loads(payload).get("error", {})
            except (ValueError, UnicodeError, AttributeError):
                detail = {}
            if not isinstance(detail, dict):
                detail = {}
            raise APIError(error.code, detail.get("code", "HTTP_ERROR"),
                           self.redact(str(detail.get("message", error.reason)))) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
            raise IntakeError("The current operator request did not finish. Rerun the same command to reconcile its retained task. "
                              + self.redact(str(error))) from None
        if len(result) > MAX_RESPONSE:
            raise IntakeError("The operator response exceeds the 32 MiB intake response capacity.")
        if raw:
            return result
        try:
            value = json.loads(result)
        except (ValueError, UnicodeError) as error:
            raise IntakeError("The operator returned an unreadable JSON response.") from error
        if not isinstance(value, dict):
            raise IntakeError("The operator returned an unexpected JSON response.")
        return value

    def get(self, path, **query):
        return self.request(path, query=query)

    def post(self, path, body):
        return self.request(path, body=body)

    def task(self, task_id, *, missing=False):
        try:
            return self.get("/api/task", id=task_id)
        except APIError as error:
            if missing and error.status == 404:
                return None
            raise

    def document(self, task, label):
        found = [item for item in task.get("_downloads", []) if item.get("label") == label]
        if len(found) != 1:
            raise IntakeError(f"Task {task['id']} must expose one original '{label}' document.")
        ticket = found[0]
        if not re.fullmatch(r"/api/file/[0-9a-f]{64}", str(ticket.get("url", ""))):
            raise IntakeError("The retained document ticket is outside the original operator file route.")
        data = self.request(ticket["url"], raw=True)
        if len(data) != ticket.get("bytes") or hashlib.sha256(data).hexdigest() != ticket.get("sha256"):
            raise IntakeError("The original retained source document changed during delivery.")
        value = json.loads(data)
        if not isinstance(value, dict):
            raise IntakeError("The retained source document is not an object.")
        return value, {key: ticket[key] for key in ("filename", "bytes", "sha256", "label")}


def choose_workspace(client, args):
    state = client.get("/api/state", workspace=args.workspace)
    if args.study_title:
        matches = [row for row in state.get("workspaces", [])
                   if row.get("title") == args.study_title and row.get("available")]
        if len(matches) != 1:
            raise IntakeError("The exact study title must identify one available Workspace; use its key if titles repeat.")
        key = checked_id(matches[0]["id"], "Workspace key")
        if key != state.get("workspace_key"):
            state = client.get("/api/state", workspace=key)
    else:
        key = checked_id(state.get("workspace_key"), "Workspace key")
        if args.workspace and key != args.workspace:
            raise IntakeError("The operator returned a different Workspace.")
    project = state.get("data", {}).get("project", {})
    if not project.get("id") or not project.get("title"):
        raise IntakeError("The original Workspace project identity is absent.")
    return state, {"workspace_key": key, "project_id": project["id"], "title": project["title"]}


def root(catalog, selected):
    found = [row for row in catalog.get("roots", [])
             if selected in (row.get("id"), row.get("label"))]
    if len(found) != 1:
        raise IntakeError("Select one exact registered source-root ID or path from the catalogue: " + str(selected))
    return found[0]


def file_selector(selected_root, path):
    if not isinstance(path, str) or not path or "\\" in path or "\0" in path:
        raise IntakeError("Choose an ordinary original source filename.")
    supplied = PurePosixPath(path)
    if str(supplied) != path or ".." in supplied.parts:
        raise IntakeError("Use the exact canonical source path.")
    if supplied.is_absolute():
        try:
            supplied = supplied.relative_to(PurePosixPath(selected_root["label"]))
        except ValueError as error:
            raise IntakeError("The original file is outside its selected registered source root.") from error
    if not supplied.parts or str(supplied) == ".":
        raise IntakeError("Choose a file beneath the selected source root.")
    return {"root_id": selected_root["id"], "path": supplied.as_posix()}


def check_files(client, workspace, specs):
    groups = {}
    for label, selector, expected in specs:
        parent = PurePosixPath(selector["path"]).parent.as_posix()
        parent = "" if parent == "." else parent
        groups.setdefault((selector["root_id"], parent), []).append((label, selector, expected))
    for (root_id, parent), selected in groups.items():
        needed = {selector["path"]: (label, expected) for label, selector, expected in selected}
        offset, visited = 0, set()
        while needed:
            if offset in visited:
                raise IntakeError("The original source-directory page repeated.")
            visited.add(offset)
            page = client.get("/api/source-preparation/files", workspace=workspace,
                              root_id=root_id, path=parent, offset=offset, limit=200)
            for item in page.get("entries", []):
                if item.get("path") not in needed:
                    continue
                label, expected = needed.pop(item["path"])
                if item.get("is_dir") or item.get("bytes") != expected["bytes"]:
                    raise IntakeError(f"{label} differs from its retained original byte count ({expected['bytes']}).")
            offset = page.get("next_offset")
            if offset is None:
                break
        if needed:
            raise IntakeError("The registered source directory is missing: " + ", ".join(sorted(needed)))


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink():
        raise IntakeError("Choose an ordinary intake-result path.")
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".intake-", delete=False) as handle:
            pending = Path(handle.name)
            handle.write(canonical(value) + b"\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(pending, path)
        pending = None
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def task_summary(task):
    progress = task.get("_source_preparation") or {}
    return {"task_id": task["id"], "operation_id": task["operation_id"], "action": task["action"],
            "state": task["state"], "stage": progress.get("stage", task["state"]),
            "elapsed_seconds": progress.get("elapsed_seconds"),
            "error": task.get("error") or progress.get("error"), "result": task.get("result"),
            "attempts": task.get("attempts", []), "native_progress": progress.get("native_progress"),
            "log_tail": progress.get("log_tail", [])}


def existing_task(client, definition, ledger, known_tasks=()):
    request = definition["request"]
    expected = identity({name: request[name] for name in ("workspace", "action", "payload")})
    retained = ledger.get("tasks", {}).get(definition["name"], {}).get("task_id")
    key = retained or identity({"workspace": request["workspace"], "operation_id": request["operation_id"]})
    task = client.task(key, missing=True)
    if task is not None:
        return task
    if retained:
        raise IntakeError("The recorded original intake task is absent from this operator; reopen its retained state directory.")
    # Reconcile an accepted request whose response was lost, including the
    # operator's existing same-request active-task reuse. Prefer a completed
    # exact request over submitting the same native work again.
    matches = [item for item in known_tasks if item.get("workspace") == request["workspace"]
               and item.get("request_sha256") == expected and item.get("state") in ACTIVE | {"complete"}]
    matches.sort(key=lambda item: (item["state"] != "complete", item.get("created_at", ""), item["id"]))
    return client.task(matches[0]["id"]) if matches else None


def ensure_task(client, definition, *, existing, ledger, persist, resume_cancelled):
    payload = definition["request"]
    key = identity({"workspace": payload["workspace"], "operation_id": payload["operation_id"]})
    request = {name: payload[name] for name in ("workspace", "action", "payload")}
    task = existing
    if task is not None:
        if task.get("workspace") != payload["workspace"] or task.get("request_sha256") != identity(request):
            raise IntakeError("The original operation ID belongs to a different source selection.")
        if task.get("state") == "cancelled" and not resume_cancelled:
            raise IntakeError("The retained task was cancelled; use --resume-cancelled to explicitly resume this selection.")
        if task.get("state") in {"failed", "interrupted", "cancelled"}:
            ledger["intent"] = {"action": "resume", "task_id": task["id"], "at": now()}
            persist()
            task = client.post("/api/task/resume", {"id": task["id"]})
    else:
        ledger["intent"] = {"action": "submit", "task_id": key,
                            "operation_id": payload["operation_id"], "at": now()}
        persist()
        task = client.post("/api/actions", payload)
    # submit may reuse an already-active identical request with its existing ID.
    if task.get("workspace") != payload["workspace"] or task.get("request_sha256") != identity(request):
        raise IntakeError("The operator returned a task for another source selection.")
    ledger["tasks"][definition["name"]] = task_summary(task)
    ledger.pop("intent", None)
    persist()
    return task


def wait_tasks(client, tasks, ledger, persist, deadline, interval):
    pending = {name for name, task in tasks.items() if task["state"] in ACTIVE}
    previous = {}
    while pending:
        fetched = {}
        for name in list(pending):
            task_id = tasks[name]["id"]
            if task_id not in fetched:
                fetched[task_id] = client.task(task_id)
            task = fetched[task_id]
            tasks[name] = task
            summary = task_summary(task)
            ledger["tasks"][name] = summary
            marker = (summary["state"], summary["stage"], json.dumps(summary["error"], sort_keys=True))
            if previous.get(name) != marker:
                previous[name] = marker
                print(client.redact(f"{name}: {summary['state']} — {summary['stage']}"), file=sys.stderr, flush=True)
            if task["state"] not in ACTIVE:
                pending.remove(name)
        # Retain native counters and log progress even while the stage label is unchanged.
        persist()
        if pending:
            if deadline is not None and time.monotonic() >= deadline:
                ledger["state"] = "pending"
                persist()
                raise IntakeError("The selected wait time elapsed. The native tasks continue; rerun the same command to collect them.")
            time.sleep(min(interval, max(0.05, deadline - time.monotonic())) if deadline else interval)
    persist()
    failed = [name for name, task in tasks.items() if task["state"] != "complete"]
    if failed:
        raise IntakeError("Native source preparation needs its retained error resolved: "
                          + ", ".join(name + "=" + tasks[name]["state"] for name in failed))
    return tasks


def verify_preparation(client, name, task, project):
    result = task.get("result", {})
    if (result.get("schema") != "upstate.source-preparation-result/v1"
            or result.get("project_id") != project["project_id"] or result.get("method") != name):
        raise IntakeError("The completed preparation belongs to another source operation or project.")
    selection, document = client.document(task, "Source preparation selection")
    if selection.get("method") != name or selection.get("request_sha256") != task.get("request_sha256"):
        raise IntakeError("The source selection document belongs to a different retained request.")
    verified = {}
    for field, expected in PINNED[name].items():
        snapshot = selection.get("inputs", {}).get(field, {})
        rows = [row for row in snapshot.get("files", []) if row.get("path") == snapshot.get("main")]
        if (len(rows) != 1 or rows[0].get("bytes") != expected["bytes"]
                or rows[0].get("sha256") != expected["sha256"]):
            raise IntakeError(f"The retained {name} {field} differs from the original pinned source.")
        verified[field] = {"bytes": rows[0]["bytes"], "sha256": rows[0]["sha256"],
                           "filename": rows[0].get("filename"), "selector": snapshot["selector"]}
    native, native_document = client.document(task, "Native prepared source entry")
    expected_role = "PRECIPITATION" if name == "prism" else "R_FACTOR"
    if (native.get("id") != result.get("source_id") or native.get("role") != expected_role
            or native.get("kind") != "raster" or native.get("bytes", 0) <= 0):
        raise IntakeError("The native source entry does not match the completed numeric preparation.")
    if name == "prism" and native.get("original_archive_sha256") != PINNED[name]["archive"]["sha256"]:
        raise IntakeError("The native precipitation entry points to a different original archive.")
    return {"task_id": task["id"], "source_id": native["id"], "role": native["role"],
            "body": {key: native[key] for key in ("path", "bytes", "sha256")},
            "units": native.get("units"), "vintage": native.get("vintage"),
            "native_grid": native.get("native_grid"), "conversion": native.get("conversion"),
            "source_contract": native.get("source_contract"), "inputs": verified,
            "selection_document": document, "native_entry_document": native_document}


def run(client, args, state, project, catalog):
    archive_root = root(catalog, args.archive_root)
    reference_root = root(catalog, args.reference_root)
    selected_roots = {"prism": root(catalog, args.prism_root) if args.prism_root else archive_root,
                      "erosivity": root(catalog, args.noaa_root) if args.noaa_root else archive_root}
    archives = {"prism": args.prism_archive, "erosivity": args.noaa_archive}
    methods = {item["id"] for item in catalog.get("methods", [])}
    if not {"prism", "erosivity"} <= methods:
        raise IntakeError("Install the completed source preparation backend and operator routes before intake.")
    definitions = []
    for name in ("prism", "erosivity"):
        inputs = {"archive": file_selector(selected_roots[name], archives[name])}
        for field, pin in PINNED[name].items():
            if field != "archive":
                inputs[field] = file_selector(reference_root, pin["path"])
        payload = {"method": name, "inputs": inputs, "options": {"source_mode": "received"},
                   "title": "Original PRISM annual precipitation" if name == "prism" else "Original NOAA rainfall erosivity",
                   "import_sources": False}
        definitions.append({"name": name, "request": {"workspace": project["workspace_key"],
                            "action": "source.prepare", "payload": payload,
                            "operation_id": operation(args.operation_id, name)}})
    collections = sorted(set(checked_id(value, "Source collection") for value in args.include_collection))
    manifests = sorted(set(checked_id(value, "Registered source manifest") for value in args.include_manifest))
    actual_collections = {row["id"] for row in state.get("data", {}).get("sources", [])}
    actual_manifests = {row["id"] for row in catalog.get("registered", [])}
    if set(collections) - actual_collections or set(manifests) - actual_manifests:
        raise IntakeError("Select current source collection and registered manifest IDs from this Workspace catalogue.")
    selection = {"project": project, "preparations": definitions, "source_collection_ids": collections,
                 "registered_ids": manifests, "composition_operation_id": operation(args.operation_id, "compose"),
                 "title": args.title}
    output = Path(os.path.abspath(args.output))
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_path = output.with_name(output.name + ".lock")
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_CLOEXEC | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if output.is_symlink():
            raise IntakeError("Choose an ordinary intake result file.")
        if output.exists():
            ledger = json.loads(output.read_bytes())
            if ledger.get("schema") != SCHEMA or ledger.get("selection_sha256") != identity(selection):
                raise IntakeError("The intake result already belongs to a different selection; preserve it and choose a new output.")
        else:
            ledger = {"schema": SCHEMA, "created_at": now(), "selection": selection,
                      "selection_sha256": identity(selection), "tasks": {}, "verified_sources": {}}
        def persist():
            ledger["updated_at"] = now()
            save(output, client.redact(ledger))
        ledger.update(state="preparing", operator_origin=client.origin)
        ledger.pop("error", None)
        persist()
        deadline = time.monotonic() + args.wait_seconds if args.wait_seconds else None
        try:
            tasks = {}
            for definition in definitions:
                request = definition["request"]
                existing = existing_task(client, definition, ledger, state.get("tasks", []))
                if existing is None:
                    specs = [(definition["name"] + " " + field, selector, PINNED[definition["name"]][field])
                             for field, selector in request["payload"]["inputs"].items()]
                    check_files(client, project["workspace_key"], specs)
                tasks[definition["name"]] = ensure_task(client, definition, existing=existing,
                    ledger=ledger, persist=persist, resume_cancelled=args.resume_cancelled)
            tasks = wait_tasks(client, tasks, ledger, persist, deadline, args.poll_seconds)
            for name, task in tasks.items():
                ledger["verified_sources"][name] = verify_preparation(client, name, task, project)
                persist()
            compose_payload = {"prepared_task_ids": sorted(task["id"] for task in tasks.values()),
                               "source_collection_ids": collections, "registered_ids": manifests,
                               "title": args.title, "import_sources": True}
            definition = {"name": "composition", "request": {"workspace": project["workspace_key"],
                "action": "source.compose", "payload": compose_payload,
                "operation_id": selection["composition_operation_id"]}}
            ledger["state"] = "composing"
            persist()
            composed = ensure_task(client, definition, existing=existing_task(client, definition, ledger, state.get("tasks", [])),
                ledger=ledger, persist=persist, resume_cancelled=args.resume_cancelled)
            composed = wait_tasks(client, {"composition": composed}, ledger, persist,
                                  deadline, args.poll_seconds)["composition"]
            result = composed.get("result", {})
            collection_id = checked_id(result.get("source_collection_id"), "Completed source collection")
            collection = client.get("/api/item", workspace=project["workspace_key"],
                                    kind="sources", id=collection_id)
            entries = {entry["id"]: entry for entry in collection.get("entries", [])}
            for prepared in ledger["verified_sources"].values():
                entry = entries.get(prepared["source_id"], {})
                if (entry.get("role") != prepared["role"] or entry.get("body", {}).get("bytes") != prepared["body"]["bytes"]
                        or entry.get("body", {}).get("sha256") != prepared["body"]["sha256"]):
                    raise IntakeError("The imported composition differs from its verified original numeric source.")
            ledger.update(state="complete", completed_at=now(), source_collection_id=collection_id,
                          composition_task_id=composed["id"], source_count=len(entries),
                          physical_source_count=sum(row.get("kind") != "document" for row in entries.values()),
                          roles=sorted({row["role"] for row in entries.values() if row.get("role")}),
                          composition_result=result)
            persist()
            print(json.dumps(client.redact({"state": "complete", **project,
                "source_collection_id": collection_id, "composition_task_id": composed["id"],
                "preparation_task_ids": {name: task["id"] for name, task in tasks.items()},
                "source_count": ledger["source_count"], "roles": ledger["roles"],
                "result_file": str(output)}), ensure_ascii=False, indent=2))
            return 0
        except BaseException as error:
            ledger["state"] = "pending" if ledger.get("state") == "pending" else "interrupted" if isinstance(error, KeyboardInterrupt) else "failed"
            ledger["error"] = {"type": type(error).__name__, "message": client.redact(str(error))}
            persist()
            raise
    finally:
        os.close(fd)



PLAN_SCHEMA = "upstate.operator-source-plan/v1"
PLAN_RUN_SCHEMA = "upstate.operator-source-plan-run/v1"


def read_source_plan(path, overrides=()):
    plan = json.loads(Path(path).read_bytes())
    if not isinstance(plan, dict) or plan.get("schema") != PLAN_SCHEMA:
        raise IntakeError("Choose an upstate.operator-source-plan/v1 JSON plan.")
    allowed = {"schema", "title", "description", "roots", "steps",
               "source_collection_ids", "registered_ids"}
    if set(plan) - allowed:
        raise IntakeError("Unsupported source-plan fields: " + ", ".join(sorted(set(plan) - allowed)))
    roots = plan.setdefault("roots", {})
    if not isinstance(roots, dict) or any(not isinstance(k, str) or not k
                                         or not isinstance(v, str) or not v for k, v in roots.items()):
        raise IntakeError("Plan roots must map names to exact registered source-root IDs or paths.")
    for item in overrides:
        name, separator, value = item.partition("=")
        if not separator or not name or not value or name not in roots:
            raise IntakeError("Use --plan-root NAME=REGISTERED_ROOT for an existing plan root.")
        roots[name] = value
    for name in ("source_collection_ids", "registered_ids"):
        if not isinstance(plan.get(name, []), list):
            raise IntakeError(name + " must be a list of retained identifiers.")
    canonical(plan)
    return plan


def source_plan_graph(plan, catalog, prefix):
    methods = {item["id"]: item for item in catalog.get("methods", [])}
    steps = plan.get("steps", [])
    if not isinstance(steps, list):
        raise IntakeError("Source-plan steps must be a list.")
    by_id, dependencies = {}, {}
    for step in steps:
        if not isinstance(step, dict):
            raise IntakeError("Each source-plan step must be an object.")
        allowed = {"id", "method", "title", "inputs", "options", "reuse_task_id", "expected_inputs"}
        if set(step) - allowed:
            raise IntakeError("Unsupported source step fields: " + ", ".join(sorted(set(step) - allowed)))
        key = step.get("id")
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,47}", key):
            raise IntakeError("Each source step needs a 1–48 character name using letters, digits, underscores or hyphens.")
        if key in by_id:
            raise IntakeError("Source step names must be unique: " + key)
        if step.get("method") not in methods:
            raise IntakeError("Choose an installed preparation method for source step " + key + ".")
        operation(prefix, "prepare-" + key)
        operation(prefix, "import-" + key)
        inputs, options, expected = (step.get(name, {}) for name in ("inputs", "options", "expected_inputs"))
        if not all(isinstance(value, dict) for value in (inputs, options, expected)):
            raise IntakeError("Step inputs, options and expected_inputs must be objects.")
        if "reuse_task_id" in step:
            checked_id(step["reuse_task_id"], "Retained preparation task")
            if inputs or options:
                raise IntakeError("A reused preparation keeps its original inputs and options; omit those fields.")
        input_names = {item["name"] for item in methods[step["method"]].get("inputs", [])}
        if set(inputs) - input_names or set(expected) - input_names:
            raise IntakeError("A source step names an input outside its installed preparation method: " + key)
        dependencies[key] = set()
        for name, selector in inputs.items():
            if not isinstance(selector, dict) or not selector:
                raise IntakeError("Choose one source selector for " + key + "." + name + ".")
            choices = [field for field in ("root", "root_id", "collection_id", "upload_id", "builtin_id", "from_step")
                       if selector.get(field)]
            if len(choices) != 1:
                raise IntakeError("Each plan input needs exactly one root, collection, upload, builtin or from_step selection.")
            choice = choices[0]
            allowed_selector = {
                "root": {"root", "path"}, "root_id": {"root_id", "path"},
                "collection_id": {"collection_id", "source_id", "companion_path"},
                "upload_id": {"upload_id"}, "builtin_id": {"builtin_id"},
                "from_step": {"from_step", "source_id", "companion_path"},
            }[choice]
            if set(selector) - allowed_selector:
                raise IntakeError("Unsupported fields in source selector " + key + "." + name + ".")
            if choice == "from_step":
                dependency = selector["from_step"]
                if not isinstance(dependency, str):
                    raise IntakeError("from_step must name a preparation step.")
                dependencies[key].add(dependency)
            elif choice == "root" and selector["root"] not in plan.get("roots", {}):
                raise IntakeError("The source selector names an absent plan root: " + str(selector["root"]))
            elif choice in {"collection_id", "upload_id"}:
                checked_id(selector[choice], "Selected source")
            if choice == "collection_id" and (not isinstance(selector.get("source_id"), str) or not selector["source_id"]):
                raise IntakeError("A collection selector needs its exact source_id.")
        for name, pin in expected.items():
            if (not isinstance(pin, dict) or set(pin) != {"bytes", "sha256"}
                    or isinstance(pin["bytes"], bool) or not isinstance(pin["bytes"], int) or pin["bytes"] < 0
                    or not isinstance(pin["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", pin["sha256"])):
                raise IntakeError("Expected inputs need the original bytes and SHA256: " + key + "." + name)
        by_id[key] = step
    unknown = set().union(*dependencies.values()) - set(by_id) if dependencies else set()
    if unknown:
        raise IntakeError("Unknown source dependency: " + ", ".join(sorted(unknown)))
    remaining, completed, levels = set(by_id), set(), []
    while remaining:
        ready = [step["id"] for step in steps
                 if step["id"] in remaining and dependencies[step["id"]] <= completed]
        if not ready:
            raise IntakeError("The source plan contains a dependency cycle: " + ", ".join(sorted(remaining)))
        levels.append(ready)
        remaining.difference_update(ready)
        completed.update(ready)
    operation(prefix, "compose")
    required = set().union(*dependencies.values()) if dependencies else set()
    return by_id, levels, required, methods


def resolve_plan_selector(selector, plan, catalog, prepared):
    if "from_step" in selector:
        result = prepared[selector["from_step"]]
        collection_id = checked_id(result.get("source_collection_id"), "Imported prerequisite source collection")
        source_id = selector.get("source_id") or result["source_id"]
        entries = result.get("collection_entries", {})
        if source_id not in entries:
            raise IntakeError("The prerequisite collection does not contain the selected source: " + str(source_id))
        value = {"collection_id": collection_id, "source_id": source_id}
        if selector.get("companion_path"):
            value["companion_path"] = selector["companion_path"]
        return value
    if "root" in selector or "root_id" in selector:
        selected = plan["roots"][selector["root"]] if "root" in selector else selector["root_id"]
        return file_selector(root(catalog, selected), selector.get("path"))
    return dict(selector)


def restored_preparation(client, project, task_id, method):
    try:
        value = client.get("/api/source-preparation/result",
                           workspace=project["workspace_key"], task_id=task_id)
    except APIError as error:
        if error.status == 404:
            return None
        raise
    result = value.get("result") or {}
    if (value.get("task_id") != task_id or value.get("workspace_key") != project["workspace_key"]
            or result.get("project_id") != project["project_id"] or result.get("method") != method):
        raise IntakeError("The retained preparation belongs to a different source method or project.")
    if value.get("progress", {}).get("state") != "complete":
        raise IntakeError("The original preparation is incomplete and its queue task is absent; reconnect its existing operator state.")
    # This is a retained preparation result, not a newly created queue task.
    return {"id": task_id, "state": "complete", "result": result,
            "_restored_preparation": True, "_downloads": value.get("_downloads", [])}


def inspect_plan_preparation(client, step, task, project, method):
    result = task.get("result") or {}
    if (task.get("state") != "complete" or result.get("schema") != "upstate.source-preparation-result/v1"
            or result.get("task_id") != task["id"] or result.get("project_id") != project["project_id"]
            or result.get("method") != step["method"]):
        raise IntakeError("The completed step does not identify this project's original preparation: " + step["id"])
    expected = step.get("expected_inputs", {})
    verified_inputs, selection_document = {}, None
    labels = {item.get("label") for item in task.get("_downloads", [])}
    if "Source preparation selection" in labels:
        selection, selection_document = client.document(task, "Source preparation selection")
        if selection.get("method") != step["method"] or selection.get("project_id") != project["project_id"]:
            raise IntakeError("The retained source selection differs from its preparation.")
        if not task.get("_restored_preparation") and selection.get("request_sha256") != task.get("request_sha256"):
            raise IntakeError("The retained source selection differs from the original queue request.")
        for name, pin in expected.items():
            snapshot = selection.get("inputs", {}).get(name, {})
            rows = [row for row in snapshot.get("files", []) if row.get("path") == snapshot.get("main")]
            if len(rows) != 1 or any(rows[0].get(key) != pin[key] for key in ("bytes", "sha256")):
                raise IntakeError("A retained source input differs from the selected original: " + step["id"] + "." + name)
            verified_inputs[name] = {key: rows[0][key] for key in ("bytes", "sha256")}
    elif expected:
        raise IntakeError("This restored preparation needs its original selection document to check the plan's input identities.")
    native_document = None
    if "Native prepared source entry" in labels:
        native, native_document = client.document(task, "Native prepared source entry")
    else:
        native = result.get("source_entry") or {}
    if (native.get("id") != result.get("source_id") or native.get("role") != method.get("role")
            or native.get("kind") != "raster"):
        raise IntakeError("The native preparation does not identify the selected numeric source: " + step["id"])
    body = ({key: native[key] for key in ("bytes", "sha256")} if all(key in native for key in ("bytes", "sha256")) else None)
    return {"task_id": task["id"], "method": step["method"], "source_id": native["id"],
            "role": native["role"], "body": body, "units": native.get("units"), "vintage": native.get("vintage"),
            "source_collection_id": result.get("source_collection_id"), "verified_inputs": verified_inputs,
            "selection_document": selection_document, "native_entry_document": native_document,
            "restored_preparation": bool(task.get("_restored_preparation"))}


def imported_plan_source(client, project, prepared):
    collection = client.get("/api/item", workspace=project["workspace_key"],
                            kind="sources", id=checked_id(prepared["source_collection_id"], "Source collection"))
    entries = {entry["id"]: entry for entry in collection.get("entries", [])}
    entry = entries.get(prepared["source_id"], {})
    if entry.get("role") != prepared["role"] or entry.get("kind") != "raster":
        raise IntakeError("The imported prerequisite differs from its prepared numeric source.")
    body = {key: entry.get("body", {}).get(key) for key in ("bytes", "sha256")}
    if (not isinstance(body["bytes"], int) or body["bytes"] <= 0
            or not isinstance(body["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", body["sha256"])):
        raise IntakeError("The imported prerequisite has no complete original raster body.")
    if prepared.get("body") and prepared["body"] != body:
        raise IntakeError("The imported prerequisite raster differs from its native preparation.")
    prepared["body"] = body
    prepared["collection_entries"] = entries
    return prepared



def ensure_plan_task(client, definition, project, *, ledger, persist, known_tasks=(), resume_cancelled=False):
    retained = ledger.get("tasks", {}).get(definition["name"], {}).get("task_id")
    existing = client.task(retained, missing=True) if retained else None
    if retained and existing is None:
        request = definition["request"]
        result = restored_preparation(client, project, retained, request["payload"].get("method"))
        if result is not None:
            selection, _ = client.document(result, "Source preparation selection")
            expected = identity({field: request[field] for field in ("workspace", "action", "payload")})
            if selection.get("request_sha256") != expected:
                raise IntakeError("The restored preparation or composition belongs to a different original request.")
            return result
    if existing is None:
        existing = existing_task(client, definition, ledger, known_tasks)
    return ensure_task(client, definition, existing=existing, ledger=ledger,
                       persist=persist, resume_cancelled=resume_cancelled)


def run_source_plan(client, args, state, project, catalog):
    plan = read_source_plan(args.plan, args.plan_root)
    steps, levels, needed, methods = source_plan_graph(plan, catalog, args.operation_id)
    collections = sorted(set(checked_id(value, "Source collection") for value in
                             [*plan.get("source_collection_ids", []), *args.include_collection]))
    manifests = sorted(set(checked_id(value, "Registered source manifest") for value in
                           [*plan.get("registered_ids", []), *args.include_manifest]))
    if (set(collections) - {row["id"] for row in state.get("data", {}).get("sources", [])}
            or set(manifests) - {row["id"] for row in catalog.get("registered", [])}):
        raise IntakeError("Select existing collections and registered manifests from this Workspace's catalogue.")
    if not (steps or collections or manifests):
        raise IntakeError("Choose prepared sources, existing collections or registered manifests for the source plan.")
    title = args.title or plan.get("title") or "Original regional source edition"
    selection = {"project": project, "plan": plan, "source_collection_ids": collections,
                 "registered_ids": manifests, "operation_id": args.operation_id, "title": title}
    output = Path(os.path.abspath(args.output))
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(output.with_name(output.name + ".lock"),
                 os.O_CREAT | os.O_RDWR | os.O_CLOEXEC | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if output.is_symlink():
            raise IntakeError("Choose an ordinary intake result file.")
        if output.exists():
            ledger = json.loads(output.read_bytes())
            if ledger.get("schema") != PLAN_RUN_SCHEMA or ledger.get("selection_sha256") != identity(selection):
                raise IntakeError("This result belongs to a different source plan; preserve it and choose a new output.")
        else:
            ledger = {"schema": PLAN_RUN_SCHEMA, "created_at": now(), "selection": selection,
                      "selection_sha256": identity(selection), "tasks": {}, "definitions": {}, "steps": {}}
        def persist():
            ledger["updated_at"] = now()
            save(output, client.redact(ledger))
        ledger.update(state="preparing", operator_origin=client.origin)
        ledger.pop("error", None)
        persist()
        deadline = time.monotonic() + args.wait_seconds if args.wait_seconds else None
        prepared, finished_tasks = {}, {}
        known_tasks = {task["id"]: task for task in state.get("tasks", [])}
        try:
            for level in levels:
                current, waiting = {}, {}
                for key in level:
                    step, name = steps[key], "prepare:" + key
                    reuse_id = step.get("reuse_task_id")
                    retained_id = reuse_id or ledger.get("tasks", {}).get(name, {}).get("task_id")
                    existing = client.task(retained_id, missing=True) if retained_id else None
                    if retained_id and existing is None:
                        restored = restored_preparation(client, project, retained_id, step["method"])
                        if restored is not None:
                            current[key] = restored
                            ledger["steps"][key] = {"task_id": retained_id, "state": "complete",
                                                    "restored_preparation": True}
                            persist()
                            continue
                        raise IntakeError("The selected retained preparation is absent from this Workspace: " + key)
                    if reuse_id:
                        if (existing.get("workspace") != project["workspace_key"] or existing.get("action") != "source.prepare"
                                or existing.get("payload", {}).get("method") != step["method"]):
                            raise IntakeError("The reused task belongs to a different Workspace or source method.")
                        request = {field: existing[field] for field in ("workspace", "action", "payload", "operation_id")}
                        definition = {"name": name, "request": request}
                    else:
                        definition = ledger["definitions"].get(key)
                        if definition is None:
                            payload = {"method": step["method"],
                                       "inputs": {field: resolve_plan_selector(value, plan, catalog, prepared)
                                                  for field, value in step.get("inputs", {}).items()},
                                       "options": step.get("options", {}),
                                       "title": step.get("title") or methods[step["method"]]["title"],
                                       "import_sources": key in needed}
                            definition = {"name": name, "request": {"workspace": project["workspace_key"],
                                "action": "source.prepare", "payload": payload,
                                "operation_id": operation(args.operation_id, "prepare-" + key)}}
                        if existing is None:
                            existing = existing_task(client, definition, ledger, known_tasks.values())
                    ledger["definitions"][key] = definition
                    persist()
                    waiting[key] = ensure_task(client, definition, existing=existing,
                        ledger=ledger, persist=persist, resume_cancelled=args.resume_cancelled)
                    known_tasks[waiting[key]["id"]] = waiting[key]
                # Follow the original queue with its canonical ledger names.
                observed = wait_tasks(client, {"prepare:" + key: task for key, task in waiting.items()},
                                      ledger, persist, deadline, args.poll_seconds)
                current.update({key: observed["prepare:" + key] for key in waiting})
                known_tasks.update({task["id"]: task for task in observed.values()})
                for key in level:
                    step, task = steps[key], current[key]
                    value = inspect_plan_preparation(client, step, task, project, methods[step["method"]])
                    if key in needed:
                        if not value.get("source_collection_id"):
                            definition = {"name": "import:" + key, "request": {"workspace": project["workspace_key"],
                                "action": "source.compose", "payload": {"prepared_task_ids": [task["id"]],
                                    "source_collection_ids": [], "registered_ids": [],
                                    "title": task["result"]["title"], "import_sources": True},
                                "operation_id": operation(args.operation_id, "import-" + key)}}
                            imported = ensure_plan_task(client, definition, project,
                                known_tasks=known_tasks.values(), ledger=ledger,
                                persist=persist, resume_cancelled=args.resume_cancelled)
                            imported = wait_tasks(client, {definition["name"]: imported},
                                ledger, persist, deadline, args.poll_seconds)[definition["name"]]
                            if not imported.get("_restored_preparation"):
                                known_tasks[imported["id"]] = imported
                            value["source_collection_id"] = checked_id(
                                imported.get("result", {}).get("source_collection_id"), "Imported prerequisite collection")
                        imported_plan_source(client, project, value)
                    prepared[key], finished_tasks[key] = value, task
                    ledger["steps"][key] = {field: item for field, item in value.items() if field != "collection_entries"}
                    persist()
            definition = {"name": "composition", "request": {"workspace": project["workspace_key"],
                "action": "source.compose", "payload": {
                    "prepared_task_ids": sorted({task["id"] for task in finished_tasks.values()}),
                    "source_collection_ids": collections, "registered_ids": manifests,
                    "title": title, "import_sources": True},
                "operation_id": operation(args.operation_id, "compose")}}
            ledger["state"] = "composing"
            persist()
            composed = ensure_plan_task(client, definition, project,
                known_tasks=known_tasks.values(), ledger=ledger,
                persist=persist, resume_cancelled=args.resume_cancelled)
            composed = wait_tasks(client, {"composition": composed},
                ledger, persist, deadline, args.poll_seconds)["composition"]
            result = composed.get("result") or {}
            if result.get("project_id") != project["project_id"]:
                raise IntakeError("The completed source edition belongs to another project.")
            collection_id = checked_id(result.get("source_collection_id"), "Completed source collection")
            collection = client.get("/api/item", workspace=project["workspace_key"], kind="sources", id=collection_id)
            entries = {entry["id"]: entry for entry in collection.get("entries", [])}
            for key, value in prepared.items():
                entry = entries.get(value["source_id"], {})
                if entry.get("role") != value["role"] or entry.get("kind") != "raster":
                    raise IntakeError("The final edition is missing its prepared numeric source: " + key)
                body = {field: entry.get("body", {}).get(field) for field in ("bytes", "sha256")}
                if value.get("body") and body != value["body"]:
                    raise IntakeError("The composed source differs from its original native preparation: " + key)
                ledger["steps"][key]["body"] = body
            ledger.update(state="complete", completed_at=now(), source_collection_id=collection_id,
                composition_task_id=composed["id"], source_count=len(entries),
                roles=sorted({entry["role"] for entry in entries.values() if entry.get("role")}),
                composition_result=result)
            persist()
            print(json.dumps(client.redact({"state": "complete", **project,
                "source_collection_id": collection_id, "composition_task_id": composed["id"],
                "preparation_task_ids": {key: task["id"] for key, task in finished_tasks.items()},
                "source_count": len(entries), "roles": ledger["roles"], "result_file": str(output)}),
                ensure_ascii=False, indent=2))
            return 0
        except BaseException as error:
            ledger["state"] = ("pending" if ledger.get("state") == "pending" else
                               "interrupted" if isinstance(error, KeyboardInterrupt) else "failed")
            ledger["error"] = {"type": type(error).__name__, "message": client.redact(str(error))}
            persist()
            raise
    finally:
        os.close(fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("catalog", "run", "plan"))
    parser.add_argument("--operator-url", required=True, help="The active operator origin, without its capability.")
    auth = parser.add_mutually_exclusive_group()
    auth.add_argument("--capability-env", help="Environment variable containing the current operator capability; default UPSTATE_OPERATOR_CAPABILITY.")
    auth.add_argument("--capability-file", help="Owner-only file containing the current capability.")
    study = parser.add_mutually_exclusive_group()
    study.add_argument("--workspace", help="Exact Workspace key from the active operator.")
    study.add_argument("--study-title", help="Exact unique title of the intended existing study.")
    parser.add_argument("--archive-root", help="Exact registered source-root ID or absolute path.")
    parser.add_argument("--prism-root", help="Optional separate registered root for the existing PRISM archive.")
    parser.add_argument("--noaa-root", help="Optional separate registered root for the existing NOAA archive.")
    parser.add_argument("--reference-root", help="Registered application root containing the nine retained reference files.")
    parser.add_argument("--prism-archive", help="Original PRISM archive path relative to its registered root, or exact absolute path.")
    parser.add_argument("--noaa-archive", help="Original NOAA archive path relative to its registered root, or exact absolute path.")
    parser.add_argument("--include-collection", action="append", default=[], help="Existing source collection ID to compose; repeat as needed.")
    parser.add_argument("--include-manifest", action="append", default=[], help="Existing registered source manifest ID to compose; repeat as needed.")
    parser.add_argument("--operation-id", help="Stable original operation prefix; reused when following an interrupted plan.")
    parser.add_argument("--plan", help="Plan mode: original source plan JSON file.")
    parser.add_argument("--plan-root", action="append", default=[], help="Plan mode: override one named registered root as NAME=ROOT.")
    parser.add_argument("--title", help="Title of the composed source edition; plan mode otherwise uses its saved title.")
    parser.add_argument("--output", help="Durable local JSON result and restart record.")
    parser.add_argument("--resume-cancelled", action="store_true", help="Explicitly resume a previously cancelled retained selection.")
    parser.add_argument("--wait-seconds", type=float, default=0, help="Optional waiting limit; zero follows the native tasks to completion.")
    parser.add_argument("--poll-seconds", type=float, default=5, help="Native task progress interval; default five seconds.")
    parser.add_argument("--request-timeout", type=float, default=30)
    parser.add_argument("--list-root", help="Catalogue mode: list an exact source root ID or path.")
    parser.add_argument("--path", default="", help="Catalogue mode: relative directory.")
    parser.add_argument("--offset", type=int, default=0, help="Catalogue mode: returned directory page offset.")
    args = parser.parse_args(argv)
    client = None
    try:
        if args.workspace:
            checked_id(args.workspace, "Workspace key")
        if (not all(math.isfinite(value) for value in (args.wait_seconds, args.poll_seconds, args.request_timeout))
                or args.wait_seconds < 0 or args.poll_seconds < 0.25 or args.request_timeout <= 0):
            raise IntakeError("Use finite nonnegative waiting time, polling of at least 0.25 seconds and a positive request timeout.")
        if args.command in {"run", "plan"}:
            if not (args.workspace or args.study_title):
                raise IntakeError("Select the exact Workspace key or an explicitly named existing study.")
            required = ("plan", "output") if args.command == "plan" else ("archive_root", "reference_root", "prism_archive", "noaa_archive", "output")
            missing = [name for name in required if not getattr(args, name)]
            if missing:
                raise IntakeError("Supply " + ", ".join("--" + name.replace("_", "-") for name in missing) + ".")
        args.operation_id = args.operation_id or ("ECO12-ORIGINAL-SOURCE-PLAN-20261013" if args.command == "plan"
                                                   else "ECO12-ORIGINAL-CLIMATE-INTAKE-20261012")
        if args.command == "run":
            args.title = args.title or "Upper Savannah original climate-source edition"
        if args.command != "plan" and (args.plan or args.plan_root):
            raise IntakeError("Use the plan command with --plan and --plan-root.")
        client = Client(args.operator_url, secret(args), args.request_timeout)
        state, project = choose_workspace(client, args)
        catalog = client.get("/api/source-preparation/catalog", workspace=project["workspace_key"])
        if args.command == "catalog":
            result = {"project": project, "workspaces": state.get("workspaces", []),
                      "roots": catalog.get("roots", []), "bundled": catalog.get("bundled", []),
                      "methods": catalog.get("methods", []), "sources": catalog.get("sources", []),
                      "registered": catalog.get("registered", []), "prepared": catalog.get("prepared", []),
                      "collections": [{"id": row["id"], "title": row["title"], "source_count": len(row["entries"]),
                                       "roles": sorted({entry["role"] for entry in row["entries"] if entry.get("role")})}
                                      for row in state.get("data", {}).get("sources", [])]}
            if args.list_root:
                selected = root(catalog, args.list_root)
                result["files"] = client.get("/api/source-preparation/files", workspace=project["workspace_key"],
                    root_id=selected["id"], path=args.path, offset=args.offset, limit=200)
            print(json.dumps(client.redact(result), ensure_ascii=False, indent=2))
            return 0
        if args.command == "plan":
            return run_source_plan(client, args, state, project, catalog)
        return run(client, args, state, project, catalog)
    except KeyboardInterrupt:
        print("Intake observation interrupted; the original operator retains its native tasks. Rerun the same command to resume observation.",
              file=sys.stderr)
        return 130
    except (IntakeError, OSError, ValueError, KeyError, TypeError) as error:
        message = client.redact(str(error)) if client else " ".join(str(error).splitlines())
        print(message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
