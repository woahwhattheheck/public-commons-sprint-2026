#!/usr/bin/env python3
"""Receive complete original Studies into one existing local operator.

Uses the maintained upload, workspace.restore, task/resume and item/file APIs.
The receiver retains an ordinary request checkpoint, not a scientific store or
another queue. Original Workspace identities, runs and result bytes stay intact.
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


class ReceivingError(RuntimeError):
    def __init__(self, code: str, message: str, status: int | None = None):
        super().__init__(message)
        self.code, self.status = code, status


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
                raise ValueError("JSON repeats a field: " + key)
            result[key] = value
        return result
    def invalid(_):
        raise ValueError("JSON contains a non-finite number")
    return json.loads(body.decode("utf-8"), object_pairs_hook=pairs,
                      parse_constant=invalid)


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


def atomic_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("A receiving output cannot replace a symbolic link")
    fd, pending = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(canonical(value) + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
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
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Use an ordinary relative archive path")
    path = PurePosixPath(value)
    if path.is_absolute() or str(path) != value or any(p in (".", "..") for p in path.parts):
        raise ValueError("Keep each archive inside the selected Study-set directory")
    return path


def archive_path(root: Path, relative: str) -> Path:
    path = root.joinpath(*relative_path(relative).parts)
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(root.resolve(strict=True)):
        raise ValueError("The selected archive leaves its Study-set directory")
    if path.is_symlink():
        raise ValueError("Select the original archive rather than a file alias")
    return path


def archive_info(path: Path) -> dict:
    # Read the same descriptor for body identity and the original embedded project.
    # The existing server receiver remains responsible for full member receiving.
    with original_file(path) as stream:
        before = identity(stream)
        hashed = hashlib.sha256()
        for block in iter(lambda: stream.read(CHUNK), b""):
            hashed.update(block)
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive:
            names = archive.namelist()
            if names.count("ARCHIVE.json") != 1 or names.count("workspace/workspace.json") != 1:
                raise ValueError("Select a complete original Workspace archive, not a report-only or outer handoff ZIP")
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
                raise ValueError("The original archive and Workspace project identities disagree")
            runs = sorted({match.group(1) for name in manifest["members"]
                           if (match := RUN_MEMBER.match(name))})
        if identity(stream) != before:
            raise ValueError("The original archive changed while being selected")
        return {"bytes": before[2], "sha256": hashed.hexdigest(),
                "project": project, "retained_run_ids": runs}


def plan_id(studies: list[dict]) -> str:
    return digest({"schema": PLAN_SCHEMA, "studies": studies})


def make_plan(specifications: list[str], destination: Path) -> dict:
    root = destination.absolute().parent.resolve(strict=True)
    if destination.exists():
        raise ValueError("Choose a new selection filename; retain the existing selection")
    studies, seen = [], set()
    for specification in specifications:
        family, separator, filename = specification.partition("=")
        if not separator or not family.strip() or not filename:
            raise ValueError("Use --study FAMILY=ARCHIVE for each complete original Study")
        path = Path(filename).expanduser().absolute()
        relative = path.relative_to(root).as_posix()
        path = archive_path(root, relative)
        info = archive_info(path)
        if info["sha256"] in seen:
            raise ValueError("The same original archive was selected more than once")
        seen.add(info["sha256"])
        studies.append({"family": family.strip(), "archive": relative, **info})
    if not studies:
        raise ValueError("Select at least one original Study")
    value = {"schema": PLAN_SCHEMA, "id": plan_id(studies),
             "created_at": now(), "studies": studies}
    atomic_json(destination, value)
    return value


def load_plan(path: Path) -> dict:
    value = read_json(path)
    if (not isinstance(value, dict) or value.get("schema") != PLAN_SCHEMA
            or not isinstance(value.get("studies"), list) or not value["studies"]
            or value.get("id") != plan_id(value["studies"])):
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
    """Direct loopback API client; credentials never enter a result or checkpoint."""
    def __init__(self, session_file: Path, timeout: float = 120):
        value = read_json(session_file, 256 * 1024)
        if not isinstance(value, dict):
            raise ValueError("Select the launcher's private local-session JSON")
        url = value.get("operator_url") or value.get("url")
        if not isinstance(url, str):
            raise ValueError("The private session file needs its original operator_url or url")
        parts = urllib.parse.urlsplit(url)
        fragments = urllib.parse.parse_qs(parts.fragment, strict_parsing=True)
        selected = fragments.get("token", [])
        if (parts.scheme != "http" or parts.hostname != "127.0.0.1"
                or parts.username or parts.password or parts.path != "/" or parts.query
                or not parts.port or set(fragments) != {"token"} or len(selected) != 1
                or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", selected[0])):
            raise ValueError("Use the original loopback operator session")
        self.port, self._token, self.timeout = parts.port, selected[0], timeout

    def clean_error(self, error: Exception) -> dict:
        return {"code": getattr(error, "code", type(error).__name__),
                "message": str(error).replace(self._token, "[local session]")}

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
                headers.update({"Content-Type": "application/zip",
                                "Content-Length": str(before[2]),
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
                    raise ValueError("The selected original archive changed during upload")
                result = self.response(connection.getresponse())
                if any(result.get(key) != expected[key] for key in ("bytes", "sha256")):
                    raise ValueError("The retained upload differs from the selected archive")
                return result
        finally:
            connection.close()

    def download(self, ticket: dict, destination: Path) -> dict:
        wanted = {key: ticket[key] for key in ("bytes", "sha256")}
        if destination.exists():
            size, sha = file_hash(destination)
            if (size, sha) != (wanted["bytes"], wanted["sha256"]):
                raise ValueError("A receiving result already contains different bytes: " + destination.name)
            return wanted
        route = ticket.get("url")
        if not isinstance(route, str) or not re.fullmatch(r"/api/file/[0-9a-f]{64}", route):
            raise ValueError("Select the original retained-file ticket")
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
                raise ValueError("The downloaded original result failed its byte identity")
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
                raise ReceivingError("RESTORE_INTERRUPTED", "The retained restore was interrupted again; its request remains resumable")
            task = client.request("/api/task/resume", {"id": task["id"]})
            resumed = True
            continue
        if state not in {"queued", "running"}:
            detail = task.get("error") or {}
            raise ReceivingError(str(detail.get("code", "RESTORE_" + str(state).upper())),
                                 str(detail.get("message", "The original restore task is " + str(state))))
        time.sleep(0.75)
        task = client.request("/api/task?" + urllib.parse.urlencode({"id": task["id"]}))


def original_catalogue(client: LocalOperator, selected: dict, workspace: str,
                       destination: Path, suffixes: set[str]) -> dict:
    state = client.request("/api/state?" + urllib.parse.urlencode({"workspace": workspace}))
    registered = next((row for row in state.get("workspaces", []) if row.get("id") == workspace), None)
    if not registered or registered.get("project_id") != selected["project"]["id"]:
        raise ValueError("The restored operator selection names another original project")
    data = state.get("data") or {}
    rows = data.get("runs", [])
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("The original operator did not return its retained run catalogue")
    run_ids = {row.get("id") for row in rows}
    missing = set(selected["retained_run_ids"]) - run_ids
    if missing:
        raise ValueError("The restored catalogue lacks original run IDs: " + ", ".join(sorted(missing)))
    result = {"workspace_key": workspace, "project": selected["project"],
              "catalogues": {name: data.get(name, []) for name in
                  ("runs", "profiles", "scenarios", "grids", "observations", "comparisons", "parameter-studies")},
              "original_runs": [], "errors": []}
    for row in rows:
        run_id = row.get("id")
        if not isinstance(run_id, str) or not HEX64.fullmatch(run_id):
            raise ValueError("The native catalogue contains an invalid run identity")
        entry = {"id": run_id, "catalogue": row, "files": [], "errors": []}
        result["original_runs"].append(entry)
        try:
            record = client.request("/api/item?" + urllib.parse.urlencode(
                {"workspace": workspace, "kind": "runs", "id": run_id}))
            entry["record"] = {key: value for key, value in record.items() if key != "_downloads"}
            for ticket in record.get("_downloads", []):
                filename = ticket.get("filename", "")
                if Path(filename).suffix.lower() not in suffixes:
                    continue
                if not filename or Path(filename).name != filename or "/" in filename or "\\" in filename:
                    raise ValueError("An original result has an invalid download filename")
                sha = ticket.get("sha256", "")
                if not isinstance(sha, str) or not HEX64.fullmatch(sha):
                    raise ValueError("An original result has an invalid body identity")
                relative = (Path("results") / selected["sha256"] / run_id / (sha[:16] + "-" + filename))
                try:
                    body = client.download(ticket, destination / relative)
                    entry["files"].append({"filename": filename, "path": relative.as_posix(),
                                           "label": ticket.get("label", filename), **body})
                except (OSError, ValueError, ReceivingError, http.client.HTTPException) as error:
                    entry["errors"].append({"filename": filename, **client.clean_error(error)})
        except (OSError, ValueError, ReceivingError, http.client.HTTPException) as error:
            entry["errors"].append(client.clean_error(error))
        if entry["errors"]:
            result["errors"].append({"run_id": run_id, "errors": entry["errors"]})
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
                    row = entry["catalogue"]
                    writer.writerow({"family": study["family"], "project_id": study["project"]["id"],
                        "title": study["project"].get("title", ""), "archive_sha256": study["sha256"],
                        "workspace_key": study["workspace_key"], "run_id": entry["id"],
                        "state": row.get("state", row.get("status", "")),
                        **{key: row.get(key, "") for key in ("profile_id", "scenario_id", "grid_id")}})
            output.flush()
            os.fsync(output.fileno())
        target = destination / "joined-runs.csv"
        if target.is_symlink():
            raise ValueError("The joined result cannot replace a symbolic link")
        os.replace(temporary, target)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def receive(plan_path: Path, session_file: Path, checkpoint_path: Path,
            destination: Path, *, retry_failed=False, suffixes=None) -> dict:
    plan = load_plan(plan_path)
    source_root = plan_path.absolute().parent.resolve(strict=True)
    client = LocalOperator(session_file)
    initial = client.request("/api/state")
    primary = initial.get("workspace_key")
    if not isinstance(primary, str) or not HEX64.fullmatch(primary):
        raise ValueError("The original operator did not return its selected Workspace")
    suffixes = {".json", ".csv", ".html"} if suffixes is None else suffixes
    destination.mkdir(parents=True, exist_ok=True)
    index_path = destination / "joined-studies.json"
    if index_path.exists() and read_json(index_path).get("selection_id") != plan["id"]:
        raise ValueError("Choose a new result directory for this different Study set")
    with receiving_lock(checkpoint_path.with_suffix(checkpoint_path.suffix + ".lock")):
        checkpoint = read_json(checkpoint_path) if checkpoint_path.exists() else {
            "schema": CHECKPOINT_SCHEMA, "selection_id": plan["id"], "receivers": {}}
        if checkpoint.get("schema") != CHECKPOINT_SCHEMA or checkpoint.get("selection_id") != plan["id"]:
            raise ValueError("This checkpoint belongs to a different Study-set selection")
        receiver = checkpoint.setdefault("receivers", {}).setdefault(primary, {"studies": {}})
        result = {"schema": INDEX_SCHEMA, "selection_id": plan["id"],
                  "observed_at": now(), "studies": []}
        try:
            result["runtime"] = client.request("/api/runtime")
        except (OSError, ValueError, ReceivingError, http.client.HTTPException) as error:
            result["runtime_error"] = client.clean_error(error)
        for selected in plan["studies"]:
            entry = receiver["studies"].setdefault(selected["sha256"], {
                "operation_id": "receive-study-" + selected["sha256"], "project_id": selected["project"]["id"]})
            view = {"family": selected["family"], "project": selected["project"],
                    "sha256": selected["sha256"], "bytes": selected["bytes"],
                    "archive": selected["archive"], "errors": []}
            result["studies"].append(view)
            try:
                path = archive_path(source_root, selected["archive"])
                actual = archive_info(path)
                if any(actual[key] != selected[key] for key in ("bytes", "sha256", "project", "retained_run_ids")):
                    raise ValueError("The selected original archive no longer matches its saved identity")
                task = None
                if entry.get("task_id"):
                    try:
                        task = client.request("/api/task?" + urllib.parse.urlencode({"id": entry["task_id"]}))
                    except ReceivingError as error:
                        if error.status != 404:
                            raise
                        entry.pop("task_id", None)
                        entry.pop("upload", None)
                if task is None:
                    if not entry.get("upload"):
                        entry["upload"] = client.upload(path, selected, primary)
                        atomic_json(checkpoint_path, checkpoint)
                    request = {"workspace": primary, "action": "workspace.restore",
                               "operation_id": entry["operation_id"],
                               "payload": {"upload_id": entry["upload"]["id"]}}
                    atomic_json(checkpoint_path, checkpoint)
                    task = client.request("/api/actions", request)
                    entry["task_id"] = task["id"]
                    atomic_json(checkpoint_path, checkpoint)
                task = task_until_complete(client, task, retry_failed=retry_failed)
                restored = task.get("result") or {}
                if restored.get("archive_sha256") != selected["sha256"]:
                    raise ValueError("The completed original restore names another archive")
                workspace = restored.get("workspace_key")
                if not isinstance(workspace, str) or not HEX64.fullmatch(workspace):
                    raise ValueError("The original restore did not register its Workspace")
                entry.update(state="restored", workspace_key=workspace, restored_at=task.get("ended_at"))
                entry.pop("error", None)
                atomic_json(checkpoint_path, checkpoint)
                view.update(original_catalogue(client, selected, workspace, destination, suffixes))
                view.update(task_id=task["id"], state="complete" if not view["errors"] else "results_incomplete")
                entry["state"] = view["state"]
            except (OSError, ValueError, ReceivingError, http.client.HTTPException, zipfile.BadZipFile) as error:
                detail = client.clean_error(error)
                entry.update(state="interrupted", error=detail)
                view.update(state="interrupted", errors=[detail])
            finally:
                entry["updated_at"] = now()
                atomic_json(checkpoint_path, checkpoint)
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
    take = commands.add_parser("receive", help="Restore the selection through the already running original operator")
    take.add_argument("selection", type=Path)
    take.add_argument("--session-file", type=Path, required=True)
    take.add_argument("--checkpoint", type=Path)
    take.add_argument("--destination", type=Path, required=True)
    take.add_argument("--retry-failed", action="store_true", help="Resume an existing failed restore after its input/runtime fault was repaired")
    take.add_argument("--result-suffix", action="append", help="Original result file extension to copy; repeat as needed. Default: .json, .csv, .html")
    args = parser.parse_args(argv)
    try:
        if args.command == "plan":
            value = make_plan(args.study, args.output)
            print(json.dumps({"selection_id": value["id"], "studies": len(value["studies"]),
                              "selection": str(args.output)}, ensure_ascii=False))
            return 0
        selected = load_plan(args.selection)
        private = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_STATE_HOME")
                       or (Path.home() / ".local/state")) / "ecosystem-workbench" / "study-sets"
        checkpoint = args.checkpoint or private / (selected["id"] + ".json")
        suffixes = None
        if args.result_suffix is not None:
            suffixes = {value.lower() for value in args.result_suffix}
            if any(not re.fullmatch(r"\.[a-z0-9]+", value) for value in suffixes):
                raise ValueError("Use ordinary result extensions such as .json or .tif")
        result = receive(args.selection, args.session_file, checkpoint, args.destination,
                         retry_failed=args.retry_failed, suffixes=suffixes)
        return 0 if all(row["state"] == "complete" for row in result["studies"]) else 2
    except KeyboardInterrupt:
        print("Receiving checkpoint retained. The original operator keeps ownership of its accepted tasks.", file=sys.stderr)
        return 130
    except (OSError, ValueError, ReceivingError, http.client.HTTPException, zipfile.BadZipFile) as error:
        print(type(error).__name__ + ": " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
