#!/usr/bin/env python3
"""Receive complete original Studies through the existing local operator.

The original operator owns uploads, Workspace restoration, authentication and
scientific tasks. This client only retains request IDs and joins original results.
"""
from __future__ import annotations

import argparse
import contextlib
import csv
from datetime import datetime, timezone
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
import time
import urllib.parse
import zipfile

PLAN_SCHEMA = "upstate.received-study-set/v1"
ARCHIVE_SCHEMA = "upstate.scientific-workspace-archive/v1"
CHECKPOINT_SCHEMA = "upstate.study-set-receiving/v1"
INDEX_SCHEMA = "upstate.joined-native-studies/v1"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
RUN_MEMBER = re.compile(r"workspace/runs/([0-9a-f]{64})/")
CHUNK = 1024 * 1024
MAX_MANIFEST = 64 * 1024 * 1024
ARTIFACT_FIELDS = ("files", "artifacts", "stages", "alternatives", "maps")


class ReceivingError(RuntimeError):
    def __init__(self, code: str, message: str, status: int | None = None):
        super().__init__(message)
        self.code, self.status = code, status


ITEM_ERRORS = (OSError, ValueError, ReceivingError, http.client.HTTPException,
               zipfile.BadZipFile, KeyError, TypeError)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def parse_json(body: bytes):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("JSON repeats a field")
            result[key] = value
        return result
    def invalid(_):
        raise ValueError("JSON contains a non-finite number")
    return json.loads(body.decode("utf-8"), object_pairs_hook=pairs,
                      parse_constant=invalid)


def error_detail(error: Exception) -> dict:
    return {"code": getattr(error, "code", type(error).__name__), "message": str(error)}


@contextlib.contextmanager
def original_file(path: Path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
                 | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Select an original regular file")
        yield stream


def identity(stream):
    value = os.fstat(stream.fileno())
    return (value.st_dev, value.st_ino, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns)


def file_hash(path: Path) -> tuple[int, str]:
    with original_file(path) as stream:
        before = identity(stream)
        hashed = hashlib.sha256()
        for block in iter(lambda: stream.read(CHUNK), b""):
            hashed.update(block)
        if identity(stream) != before:
            raise ValueError("The original file changed while being read")
        return before[2], hashed.hexdigest()


def read_json(path: Path, limit: int = MAX_MANIFEST):
    with original_file(path) as stream:
        before = identity(stream)
        if before[2] > limit:
            raise ValueError("The selected JSON exceeds the original manifest capacity")
        body = stream.read(limit + 1)
        if identity(stream) != before or len(body) != before[2]:
            raise ValueError("The original JSON changed while being read")
        return parse_json(body)


def atomic_json(path: Path, value, *, exclusive=False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("A receiving output cannot replace a symbolic link")
    fd, pending = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(canonical(value) + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
        if exclusive:
            os.link(pending, path)
        else:
            os.replace(pending, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(pending)


@contextlib.contextmanager
def receiving_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError("Use a regular receiving lock file")
        if os.name == "nt":
            import msvcrt
            if os.fstat(fd).st_size == 0:
                os.write(fd, b"0")
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def relative_path(value: str) -> PurePosixPath:
    if (not isinstance(value, str) or not value or "\\" in value or ":" in value
            or any(ord(char) < 32 for char in value)):
        raise ValueError("Use an ordinary relative file path")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or str(path) != value
            or any(part in (".", "..") for part in path.parts)):
        raise ValueError("Keep files inside their selected receiving directory")
    return path


def archive_path(root: Path, relative: str) -> Path:
    path = root.joinpath(*relative_path(relative).parts)
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(root.resolve(strict=True)) or path.is_symlink():
        raise ValueError("Select an original archive inside its Study-set directory")
    return path


def output_path(root: Path, relative: str) -> Path:
    root = root.resolve(strict=True)
    current = root
    parts = relative_path(relative).parts
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("A receiving result path contains a symbolic link")
    if not current.resolve(strict=False).is_relative_to(root):
        raise ValueError("The receiving result leaves its selected directory")
    return current


def archive_info(path: Path) -> dict:
    # Selection reads one descriptor. The original portable receiver owns full
    # member validation and restoration, including its immutable project identity.
    with original_file(path) as stream:
        before = identity(stream)
        hashed = hashlib.sha256()
        for block in iter(lambda: stream.read(CHUNK), b""):
            hashed.update(block)
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive:
            names = archive.namelist()
            if names.count("ARCHIVE.json") != 1 or names.count("workspace/workspace.json") != 1:
                raise ValueError("Select a complete original Workspace ZIP, not a report-only or outer handoff ZIP")
            member = archive.getinfo("ARCHIVE.json")
            if member.file_size > MAX_MANIFEST:
                raise ValueError("The archive exceeds the original manifest capacity")
            manifest = parse_json(archive.read(member))
            project_member = archive.getinfo("workspace/workspace.json")
            if project_member.file_size > 256 * 1024:
                raise ValueError("The archived project identity is unexpectedly large")
            project = parse_json(archive.read(project_member))
            if (not isinstance(manifest, dict) or manifest.get("schema") != ARCHIVE_SCHEMA
                    or not isinstance(project, dict)
                    or project.get("schema") != "upstate.scientific-workbench/v1"
                    or not isinstance(project.get("id"), str)
                    or manifest.get("project") != project
                    or not isinstance(manifest.get("members"), dict)):
                raise ValueError("The archive and Workspace project identities disagree")
            runs = sorted({match.group(1) for name in manifest["members"]
                           if (match := RUN_MEMBER.match(name))})
        if identity(stream) != before:
            raise ValueError("The original archive changed while being selected")
        return {"bytes": before[2], "sha256": hashed.hexdigest(),
                "project": project, "retained_run_ids": runs}


def plan_id(studies: list[dict], unavailable=None) -> str:
    value = {"schema": PLAN_SCHEMA, "studies": studies}
    if unavailable:
        value["unavailable"] = unavailable
    return digest(value)


def make_plan(specifications: list[str], destination: Path) -> dict:
    root = destination.absolute().parent.resolve(strict=True)
    studies, unavailable, seen = [], [], set()
    for specification in specifications:
        try:
            family, separator, filename = specification.partition("=")
            if not separator or not family.strip() or not filename:
                raise ValueError("Use --study FAMILY=ARCHIVE for each complete original Study")
            path = Path(filename).expanduser().absolute()
            relative = path.relative_to(root).as_posix()
            info = archive_info(archive_path(root, relative))
            if info["sha256"] in seen:
                raise ValueError("This original archive was selected more than once")
            seen.add(info["sha256"])
            studies.append({"family": family.strip(), "archive": relative, **info})
        except ITEM_ERRORS as error:
            unavailable.append({"requested": specification, **error_detail(error)})
    if not studies and not unavailable:
        raise ValueError("Select at least one original Study")
    value = {"schema": PLAN_SCHEMA, "id": plan_id(studies, unavailable),
             "created_at": now(), "studies": studies, "unavailable": unavailable}
    atomic_json(destination, value, exclusive=True)
    return value


def load_plan(path: Path) -> dict:
    value = read_json(path)
    if (not isinstance(value, dict) or value.get("schema") != PLAN_SCHEMA
            or not isinstance(value.get("studies"), list)
            or not isinstance(value.get("unavailable", []), list)
            or not (value["studies"] or value.get("unavailable"))
            or value.get("id") != plan_id(value["studies"], value.get("unavailable"))):
        raise ValueError("Select an unchanged original Study-set selection")
    seen = set()
    for row in value["studies"]:
        if (not isinstance(row, dict) or not isinstance(row.get("family"), str)
                or not row["family"].strip() or not isinstance(row.get("sha256"), str)
                or not HEX64.fullmatch(row["sha256"])
                or type(row.get("bytes")) is not int or row["bytes"] < 0
                or not isinstance(row.get("project"), dict)
                or not isinstance(row["project"].get("id"), str)
                or not isinstance(row.get("retained_run_ids"), list)
                or any(not isinstance(key, str) or not HEX64.fullmatch(key)
                       for key in row["retained_run_ids"])):
            raise ValueError("A selected Study has an invalid original identity")
        relative_path(row["archive"])
        if row["sha256"] in seen:
            raise ValueError("The selection repeats an original archive")
        seen.add(row["sha256"])
    return value


class LocalOperator:
    """Direct loopback API client; private access stays on the receiving machine."""
    def __init__(self, session_file: Path, timeout: float = 120):
        try:
            value = read_json(session_file, 256 * 1024)
            url = value.get("operator_url") or value.get("url")
            if not isinstance(url, str):
                raise ValueError()
            parts = urllib.parse.urlsplit(url)
            fragments = urllib.parse.parse_qs(parts.fragment, strict_parsing=True)
            selected = fragments.get("token", [])
            if (parts.scheme != "http" or parts.hostname != "127.0.0.1"
                    or parts.username or parts.password or parts.path != "/" or parts.query
                    or not parts.port or set(fragments) != {"token"} or len(selected) != 1
                    or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", selected[0])):
                raise ValueError()
            self.port, self._token, self.timeout = parts.port, selected[0], timeout
        except (ValueError, TypeError, AttributeError) as error:
            raise ValueError("Select the launcher's original private loopback session JSON") from None

    def clean_error(self, error: Exception) -> dict:
        return {key: str(value).replace(self._token, "[local session]")
                for key, value in error_detail(error).items()}

    def connection(self):
        return http.client.HTTPConnection("127.0.0.1", self.port, timeout=self.timeout)

    def headers(self, workspace: str | None = None) -> dict:
        value = {"Authorization": "Bearer " + self._token,
                 "Accept": "application/json", "Connection": "close"}
        if workspace:
            value["X-Workspace"] = workspace
        return value

    @staticmethod
    def response(response):
        body = response.read()
        try:
            value = parse_json(body)
        except (ValueError, UnicodeError) as error:
            raise ReceivingError("RESPONSE_JSON", "The local operator returned unreadable JSON", response.status) from error
        if not 200 <= response.status < 300:
            detail = value.get("error", value) if isinstance(value, dict) else {}
            if not isinstance(detail, dict):
                detail = {}
            raise ReceivingError(str(detail.get("code", "HTTP_" + str(response.status))),
                                 str(detail.get("message", "The local operator rejected this request")),
                                 response.status)
        if not isinstance(value, dict):
            raise ReceivingError("RESPONSE_SHAPE", "The local operator returned an unexpected JSON shape")
        return value

    def request(self, route: str, value=None):
        if not route.startswith("/api/") or "#" in route:
            raise ValueError("Use an original relative operator API route")
        connection = self.connection()
        try:
            headers = self.headers()
            body = None if value is None else canonical(value)
            if body is not None:
                headers["Content-Type"] = "application/json"
            connection.request("GET" if value is None else "POST", route, body=body, headers=headers)
            return self.response(connection.getresponse())
        finally:
            connection.close()

    def upload(self, path: Path, expected: dict, workspace: str) -> dict:
        connection = self.connection()
        try:
            with original_file(path) as stream:
                before = identity(stream)
                if before[2] != expected["bytes"]:
                    raise ValueError("The selected original archive changed length")
                headers = self.headers(workspace)
                headers.update({"Content-Type": "application/zip", "Content-Length": str(before[2]),
                                "X-Upload-Filename": urllib.parse.quote(path.name, safe="")})
                connection.putrequest("POST", "/api/upload")
                for key, value in headers.items():
                    connection.putheader(key, value)
                connection.endheaders()
                hashed = hashlib.sha256()
                for block in iter(lambda: stream.read(CHUNK), b""):
                    hashed.update(block)
                    connection.send(block)
                if identity(stream) != before or hashed.hexdigest() != expected["sha256"]:
                    raise ValueError("The original archive changed during upload")
                result = self.response(connection.getresponse())
                if any(result.get(key) != expected[key] for key in ("bytes", "sha256")):
                    raise ValueError("The retained upload differs from the selected archive")
                return result
        finally:
            connection.close()

    def download(self, ticket: dict, destination: Path) -> dict:
        wanted = {key: ticket[key] for key in ("bytes", "sha256")}
        if destination.exists():
            if file_hash(destination) != (wanted["bytes"], wanted["sha256"]):
                raise ValueError("A receiving result already contains different bytes: " + destination.name)
            return wanted
        route = ticket.get("url")
        if not isinstance(route, str) or not re.fullmatch(r"/api/file/[0-9a-f]{64}", route):
            raise ValueError("Select an original retained-file ticket")
        destination.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".result-", dir=destination.parent)
        connection = self.connection()
        try:
            connection.request("GET", route, headers=self.headers())
            response = connection.getresponse()
            if response.status != 200:
                self.response(response)
                raise ReceivingError("FILE_RESPONSE", "The original file was not returned in full", response.status)
            hashed, size = hashlib.sha256(), 0
            with os.fdopen(fd, "wb") as output:
                fd = -1
                for block in iter(lambda: response.read(CHUNK), b""):
                    output.write(block)
                    hashed.update(block)
                    size += len(block)
                output.flush()
                os.fsync(output.fileno())
            if (size, hashed.hexdigest()) != (wanted["bytes"], wanted["sha256"]):
                raise ValueError("The downloaded result differs from its original byte identity")
            os.link(temporary, destination)
            return wanted
        finally:
            if fd != -1:
                os.close(fd)
            connection.close()
            with contextlib.suppress(FileNotFoundError):
                os.unlink(temporary)


def task_until_complete(client: LocalOperator, task: dict, *, retry_failed=False) -> dict:
    resumed = False
    while True:
        state = task.get("state")
        if state == "complete":
            return task
        if state == "interrupted" or (state == "failed" and retry_failed and not resumed):
            if resumed:
                raise ReceivingError("RESTORE_INTERRUPTED", "The original restore was interrupted again; reconnect its retained request")
            task = client.request("/api/task/resume", {"id": task["id"]})
            resumed = True
            continue
        if state not in {"queued", "running"}:
            detail = task.get("error") or {}
            raise ReceivingError(str(detail.get("code", "RESTORE_" + str(state).upper())),
                                 str(detail.get("message", "The original restore task is " + str(state))))
        time.sleep(0.75)
        task = client.request("/api/task?" + urllib.parse.urlencode({"id": task["id"]}))


def received_workspace(client, selected, entry, explicit=None):
    rows = client.request("/api/whoami").get("workspaces", [])
    matches = [row for row in rows if row.get("available")
               and row.get("project_id") == selected["project"]["id"]
               and (row.get("received") or {}).get("archive_sha256") == selected["sha256"]]
    preferred = explicit or entry.get("workspace_key")
    chosen = next((row for row in matches if row.get("id") == preferred), None)
    if chosen:
        return chosen["id"]
    if explicit:
        raise ReceivingError("WORKSPACE_SELECTION", "The selected Workspace does not retain this exact original archive")
    if len(matches) > 1:
        raise ReceivingError("WORKSPACE_SELECTION", "Several existing copies retain this archive; choose one with --use-workspace ARCHIVE_SHA=WORKSPACE_KEY: "
                             + ", ".join(row["id"] for row in matches))
    return matches[0]["id"] if matches else None


def restore_selected(client, selected, entry, primary, source_root, save, *, retry_failed=False, explicit=None):
    task = None
    if entry.get("task_id"):
        try:
            task = client.request("/api/task?" + urllib.parse.urlencode({"id": entry["task_id"]}))
            if task.get("workspace") != primary or task.get("action") != "workspace.restore":
                raise ReceivingError("RESTORE_IDENTITY", "The retained task belongs to another original operation")
        except ReceivingError as error:
            if error.status != 404:
                raise
            entry.pop("task_id", None)
            entry.pop("upload", None)
    if task is None:
        existing = received_workspace(client, selected, entry, explicit)
        if existing:
            entry.update(workspace_key=existing, state="restored", receiving="existing-original-workspace")
            save()
            return existing
        path = archive_path(source_root, selected["archive"])
        actual = archive_info(path)
        if any(actual[key] != selected[key] for key in ("bytes", "sha256", "project", "retained_run_ids")):
            raise ValueError("The original archive no longer matches its saved selection")
        if not entry.get("upload"):
            entry["upload"] = client.upload(path, selected, primary)
            save()
        request = {"workspace": primary, "action": "workspace.restore", "operation_id": entry["operation_id"],
                   "payload": {"upload_id": entry["upload"]["id"]}}
        save()
        task = client.request("/api/actions", request)
        entry["task_id"] = task["id"]
        save()
    task = task_until_complete(client, task, retry_failed=retry_failed)
    restored = task.get("result") or {}
    if restored.get("archive_sha256") != selected["sha256"]:
        raise ValueError("The completed original restore names another archive")
    workspace = restored.get("workspace_key")
    if not isinstance(workspace, str) or not HEX64.fullmatch(workspace):
        raise ValueError("The original restore did not register its Workspace")
    if explicit and workspace != explicit:
        raise ReceivingError("WORKSPACE_SELECTION", "The retained restore already belongs to another Workspace; preserve that task or use a separate checkpoint")
    entry.update(workspace_key=workspace, state="restored", receiving="original-restore-task",
                 restored_at=task.get("ended_at"))
    save()
    return workspace


def declared_files(record):
    """Use the same original artifact families traversed by Operator._files."""
    found = {}
    def visit(value):
        if isinstance(value, dict):
            if {"path", "bytes", "sha256"} <= set(value):
                relative = relative_path(value["path"]).as_posix()
                filename = value.get("filename") or PurePosixPath(relative).name
                key = (value["sha256"], value["bytes"], filename)
                found.setdefault(key, set()).add(relative)
            for key, child in value.items():
                if key != "_downloads":
                    visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    for field in ARTIFACT_FIELDS:
        if field in record:
            visit(record[field])
    return found


def collect_run(client, selected, workspace, row, destination, suffixes):
    run_id = row.get("id")
    if not isinstance(run_id, str) or not HEX64.fullmatch(run_id):
        raise ValueError("The native catalogue contains an invalid run identity")
    entry = {"id": run_id, "catalogue": row, "observed_at": now(), "files": [], "errors": [], "omitted": []}
    try:
        record = client.request("/api/item?" + urllib.parse.urlencode(
            {"workspace": workspace, "kind": "runs", "id": run_id}))
        if record.get("id") != run_id:
            raise ValueError("The original run response names another case")
        entry["record"] = {key: value for key, value in record.items() if key != "_downloads"}
        declared = declared_files(record)
        copied = set()
        for ticket in record.get("_downloads", []):
            filename = ticket.get("filename", "")
            try:
                if len(relative_path(filename).parts) != 1:
                    raise ValueError("An original result has an invalid download filename")
                sha, size = ticket.get("sha256"), ticket.get("bytes")
                if not isinstance(sha, str) or not HEX64.fullmatch(sha) or type(size) is not int or size < 0:
                    raise ValueError("An original result has an invalid body identity")
                if suffixes is not None and Path(filename).suffix.lower() not in suffixes:
                    entry["omitted"].append({"filename": filename, "bytes": size, "sha256": sha})
                    continue
                paths = declared.get((sha, size, filename))
                if not paths:
                    raise ValueError("The original ticket has no declared run-relative artifact path")
                for original in sorted(paths):
                    relative = (PurePosixPath("results") / selected["sha256"] / "workspace" / "runs" / run_id / original).as_posix()
                    if (relative, sha, size) in copied:
                        continue
                    try:
                        body = client.download(ticket, output_path(destination, relative))
                        entry["files"].append({"filename": filename, "path": relative, "original_path": original,
                                               "label": ticket.get("label", filename), **body})
                        copied.add((relative, sha, size))
                    except ITEM_ERRORS as error:
                        entry["errors"].append({"filename": filename, "original_path": original, **client.clean_error(error)})
            except ITEM_ERRORS as error:
                entry["errors"].append({"filename": filename, **client.clean_error(error)})
    except ITEM_ERRORS as error:
        entry["errors"].append(client.clean_error(error))
    return entry


def original_catalogue(client, selected, workspace, destination, suffixes):
    state = client.request("/api/state?" + urllib.parse.urlencode({"workspace": workspace, "compact": "1"}))
    registered = next((row for row in state.get("workspaces", []) if row.get("id") == workspace), None)
    if not registered or not registered.get("available") or registered.get("project_id") != selected["project"]["id"]:
        raise ValueError("The selected operator Workspace is unavailable or names another project")
    data = state.get("data") or {}
    rows = data.get("runs", [])
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("The operator did not return its original run catalogue")
    missing = set(selected["retained_run_ids"]) - {row.get("id") for row in rows}
    if missing:
        raise ValueError("The restored catalogue lacks original run IDs: " + ", ".join(sorted(missing)))
    result = {"workspace_key": workspace, "project": selected["project"],
              "catalogues": {name: data.get(name, []) for name in
                  ("runs", "profiles", "scenarios", "grids", "observations", "comparisons", "parameter-studies")},
              "original_runs": [], "errors": []}
    for row in rows:
        try:
            entry = collect_run(client, selected, workspace, row, destination, suffixes)
            result["original_runs"].append(entry)
            if entry["errors"]:
                result["errors"].append({"run_id": entry["id"], "errors": entry["errors"]})
        except ITEM_ERRORS as error:
            result["errors"].append({"run_id": row.get("id"), **client.clean_error(error)})
    return result


def write_csv(destination: Path, studies: list[dict]) -> None:
    fields = ["family", "project_id", "title", "archive_sha256", "workspace_key",
              "run_id", "state", "profile_id", "scenario_id", "grid_id"]
    fd, temporary = tempfile.mkstemp(prefix=".joined-runs-", dir=destination)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as output:
            writer = csv.DictWriter(output, fieldnames=fields)
            writer.writeheader()
            for study in studies:
                for entry in study.get("original_runs", []):
                    row = entry["record"] if "record" in entry else entry["catalogue"]
                    writer.writerow({"family": study["family"], "project_id": study["project"]["id"],
                        "title": study["project"].get("title", ""), "archive_sha256": study["sha256"],
                        "workspace_key": study["workspace_key"], "run_id": entry["id"],
                        "state": row.get("state", row.get("status", "")),
                        **{key: row.get(key, "") for key in ("profile_id", "scenario_id", "grid_id")}})
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, output_path(destination, "joined-runs.csv"))
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def receive(plan_path: Path, session_file: Path, checkpoint_path: Path, destination: Path,
            *, retry_failed=False, suffixes=None, use_workspaces=None) -> dict:
    plan = load_plan(plan_path)
    source_root = plan_path.absolute().parent.resolve(strict=True)
    destination.mkdir(parents=True, exist_ok=True)
    destination = destination.resolve(strict=True)
    index_path = output_path(destination, "joined-studies.json")
    if index_path.exists() and read_json(index_path).get("selection_id") != plan["id"]:
        raise ValueError("Choose a new result directory for this different Study set")
    use_workspaces = use_workspaces or {}
    if set(use_workspaces) - {row["sha256"] for row in plan["studies"]}:
        raise ValueError("A requested Workspace binding names an archive outside the selection")
    with receiving_lock(checkpoint_path.with_suffix(checkpoint_path.suffix + ".lock")), receiving_lock(destination / ".receiving.lock"):
        checkpoint = read_json(checkpoint_path) if checkpoint_path.exists() else {
            "schema": CHECKPOINT_SCHEMA, "selection_id": plan["id"], "receivers": {}}
        if checkpoint.get("schema") != CHECKPOINT_SCHEMA or checkpoint.get("selection_id") != plan["id"]:
            raise ValueError("This checkpoint belongs to a different Study-set selection")
        result = {"schema": INDEX_SCHEMA, "selection_id": plan["id"], "observed_at": now(),
                  "result_selection": {"suffixes": sorted(suffixes) if suffixes is not None else None,
                                       "scope": "original run artifact tickets"},
                  "unavailable": plan.get("unavailable", []), "studies": []}
        if not plan["studies"]:
            atomic_json(index_path, result)
            write_csv(destination, [])
            return result
        client = LocalOperator(session_file)
        initial = client.request("/api/whoami")
        primary = initial.get("default_workspace")
        if not isinstance(primary, str) or not HEX64.fullmatch(primary):
            raise ValueError("The original operator did not return its selected Workspace")
        receiver = checkpoint.setdefault("receivers", {}).setdefault(primary, {"studies": {}})
        save = lambda: atomic_json(checkpoint_path, checkpoint)
        try:
            result["runtime"] = client.request("/api/runtime")
        except ITEM_ERRORS as error:
            result["runtime_error"] = client.clean_error(error)
        for selected in plan["studies"]:
            entry = receiver["studies"].setdefault(selected["sha256"], {
                "operation_id": "receive-study-" + selected["sha256"], "project_id": selected["project"]["id"]})
            view = {"family": selected["family"], "project": selected["project"], "sha256": selected["sha256"],
                    "bytes": selected["bytes"], "archive": selected["archive"], "state": "receiving", "errors": []}
            result["studies"].append(view)
            try:
                workspace = restore_selected(client, selected, entry, primary, source_root, save,
                    retry_failed=retry_failed, explicit=use_workspaces.get(selected["sha256"]))
                entry.pop("error", None)
                view.update(workspace_key=workspace, receiving=entry["receiving"], task_id=entry.get("task_id"))
                view.update(original_catalogue(client, selected, workspace, destination, suffixes))
                view["state"] = "complete" if not view["errors"] else "results_incomplete"
                entry["state"] = view["state"]
            except ITEM_ERRORS as error:
                detail = client.clean_error(error)
                entry.update(state="interrupted", error=detail)
                view.update(state="interrupted", errors=[detail])
            finally:
                entry["updated_at"] = now()
                save()
                atomic_json(index_path, result)
                write_csv(destination, result["studies"])
            print(json.dumps({"family": selected["family"], "project_id": selected["project"]["id"],
                              "state": view["state"], "run_rows": len(view.get("original_runs", [])),
                              "errors": view["errors"]}, ensure_ascii=False), flush=True)
        return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("plan", help="Select complete original archives without changing a Workspace")
    plan.add_argument("--study", action="append", required=True, metavar="FAMILY=ARCHIVE")
    plan.add_argument("--output", type=Path, required=True)
    take = commands.add_parser("receive", help="Receive through the running original operator")
    take.add_argument("selection", type=Path)
    take.add_argument("--session-file", type=Path, required=True)
    take.add_argument("--checkpoint", type=Path)
    take.add_argument("--destination", type=Path, required=True)
    take.add_argument("--retry-failed", action="store_true", help="Resume the same failed restore after repairing its input/runtime fault")
    take.add_argument("--result-suffix", action="append", help="Limit copied original result extensions. Omit to retain every original run artifact ticket")
    take.add_argument("--use-workspace", action="append", default=[], metavar="ARCHIVE_SHA=WORKSPACE_KEY")
    args = parser.parse_args(argv)
    try:
        if args.command == "plan":
            value = make_plan(args.study, args.output)
            print(json.dumps({"selection_id": value["id"], "studies": len(value["studies"]),
                              "selection": str(args.output), "unavailable": value["unavailable"]}, ensure_ascii=False))
            return 2 if value["unavailable"] else 0
        selected = load_plan(args.selection)
        private = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_STATE_HOME")
                       or (Path.home() / ".local/state")) / "ecosystem-workbench" / "study-sets"
        checkpoint = args.checkpoint or private / (selected["id"] + ".json")
        suffixes = None
        if args.result_suffix is not None:
            suffixes = {value.lower() for value in args.result_suffix}
            if any(not re.fullmatch(r"\.[a-z0-9]+", value) for value in suffixes):
                raise ValueError("Use ordinary result extensions such as .json or .tif")
        bindings = {}
        for value in args.use_workspace:
            archive, separator, workspace = value.partition("=")
            if not separator or not HEX64.fullmatch(archive) or not HEX64.fullmatch(workspace) or archive in bindings:
                raise ValueError("Use one --use-workspace ARCHIVE_SHA=WORKSPACE_KEY for each explicit selection")
            bindings[archive] = workspace
        result = receive(args.selection, args.session_file, checkpoint, args.destination,
                         retry_failed=args.retry_failed, suffixes=suffixes, use_workspaces=bindings)
        return 0 if (not result["unavailable"] and result["studies"]
                     and all(row["state"] == "complete" for row in result["studies"])) else 2
    except KeyboardInterrupt:
        print("Receiving checkpoint retained. The original operator keeps ownership of accepted tasks.", file=sys.stderr)
        return 130
    except ITEM_ERRORS as error:
        print(type(error).__name__ + ": " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
