"""Bounded, read-only discovery and retrieval of the original run artifacts.

Journal states are recorded progress, not verified completion. Opening a result
uses the existing verifier; neither this module nor that verifier authenticates
provider claims or resumes an operation.
"""
from __future__ import annotations

import os
import re
import stat
import io
import json
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .core import strict_json_loads,sha256_hex
from .focused_execution import verify_run

SCAN_LIMIT = 500
RESULT_LIMIT = 100
JOURNAL_BYTES = 16 * 1024
RUN_BYTES = 2 * 1024 * 1024
PROVIDER_BYTES = 4 * 1024 * 1024
BUNDLE_BYTES = 12 * 1024 * 1024
_ARTIFACT_NAMES = {"task-contract.json","policy.json","source-before.py","source-after.py",
                   "baseline.json","checks.json","receipt.json","change.patch","plan.json",
                   "provider-plan.json","provider-inventory.json","provider-api.json",
                   "checker/workloads.py","checker/restricted_runner.py","checker/core.py"}
_ID = re.compile(r"[A-Za-z0-9_-]{1,80}")
_STATES = {"PREPARING", "INFERENCE_DISPATCHING", "TERMINAL", "FAILED_OR_EFFECT_UNKNOWN"}
_DIR_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
_FILE_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
_FD_RELATIVE = (os.open in os.supports_dir_fd and os.stat in os.supports_dir_fd
                and os.scandir in os.supports_fd and bool(getattr(os, "O_NOFOLLOW", 0)))


def _identity(value):
    if not isinstance(value, str) or _ID.fullmatch(value) is None:
        raise ValueError("invalid operation ID")
    return value


def _linked(info):
    return (stat.S_ISLNK(info.st_mode) or
            bool(getattr(info, "st_file_attributes", 0) &
                 getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)))


def _signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def _checked_directory(path):
    # Platforms without fd-relative directory access still reject links and
    # reparse points in every path component and recheck identities after reads.
    for component in (*reversed(path.parents), path):
        info = component.lstat()
        if _linked(info) or not stat.S_ISDIR(info.st_mode):
            raise OSError("not a direct directory")
    return info


class _Directory:
    def __init__(self, path, fd=None):
        self.path = path
        self.fd = fd
        self.initial = None if fd is not None else _checked_directory(path)

    def info(self, name):
        if self.fd is not None:
            return os.stat(name, dir_fd=self.fd, follow_symlinks=False)
        self.check()
        return (self.path / name).lstat()

    def check(self):
        if self.fd is None:
            now = _checked_directory(self.path)
            if (now.st_dev, now.st_ino) != (self.initial.st_dev, self.initial.st_ino):
                raise OSError("directory changed")

    @contextmanager
    def child(self, name):
        if self.fd is not None:
            fd = os.open(name, _DIR_FLAGS, dir_fd=self.fd)
            try:
                if not stat.S_ISDIR(os.fstat(fd).st_mode):
                    raise OSError("not a directory")
                yield _Directory(self.path / name, fd)
            finally:
                os.close(fd)
        else:
            self.check()
            child = _Directory(self.path / name)
            yield child
            child.check()
            self.check()

    def read_bytes(self, name, maximum, *, allow_empty=False):
        before = self.info(name)
        if (_linked(before) or not stat.S_ISREG(before.st_mode) or before.st_size > maximum
                or before.st_size < (0 if allow_empty else 1)):
            raise ValueError("artifact is not a bounded regular file")
        if self.fd is not None:
            fd = os.open(name, _FILE_FLAGS, dir_fd=self.fd)
        else:
            fd = os.open(self.path / name, _FILE_FLAGS)
        with os.fdopen(fd, "rb") as stream:
            if _signature(os.fstat(stream.fileno())) != _signature(before):
                raise ValueError("artifact changed before reading")
            raw = stream.read(maximum + 1)
            if len(raw) > maximum or _signature(os.fstat(stream.fileno())) != _signature(before):
                raise ValueError("artifact changed while reading")
        if _signature(self.info(name)) != _signature(before):
            raise ValueError("artifact changed after reading")
        return raw

    def read_json(self, name, maximum):
        raw = self.read_bytes(name, maximum)
        value = strict_json_loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("artifact must contain an object")
        return value


@contextmanager
def _root(root):
    path = Path(root).absolute()
    if _FD_RELATIVE:
        # Open each component relative to the preceding directory descriptor;
        # a linked ancestor cannot redirect the artifact lookup.
        fd = os.open(path.anchor, _DIR_FLAGS)
        try:
            for component in path.parts[1:]:
                next_fd = os.open(component, _DIR_FLAGS, dir_fd=fd)
                os.close(fd)
                fd = next_fd
            yield _Directory(path, fd)
        finally:
            os.close(fd)
    else:
        directory = _Directory(path)
        yield directory
        directory.check()


def _journal(directory, identity):
    value = directory.read_json("journal.json", JOURNAL_BYTES)
    if value.get("operation_id") != identity:
        raise ValueError("journal operation does not match directory")
    return value


def _mtime(value):
    try:
        return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")
    except (OverflowError, OSError, ValueError):
        return None


def _artifact_bytes(directory, run):
    """Read exact retained bytes and bind every new-run member to its envelope."""
    raw = directory.read_bytes("run.json", RUN_BYTES)
    if strict_json_loads(raw.decode("utf-8")) != run:
        raise ValueError("run changed while reading artifacts")
    files = {"run.json": raw}
    total = len(raw)
    for member in run.get("artifacts", []):
        name = member["name"]
        if name not in _ARTIFACT_NAMES:
            raise ValueError("unknown retained artifact")
        if member["bytes"] > PROVIDER_BYTES or total + member["bytes"] > BUNDLE_BYTES:
            raise ValueError("retained bundle exceeds byte limit")
        if "/" in name:
            folder, filename = name.split("/", 1)
            with directory.child(folder) as child:
                data = child.read_bytes(filename, PROVIDER_BYTES, allow_empty=True)
        else:
            data = directory.read_bytes(name, PROVIDER_BYTES, allow_empty=True)
        if len(data) != member["bytes"] or sha256_hex(data) != member["sha256"]:
            raise ValueError("retained artifact does not match the original result")
        files[name] = data
        total += len(data)
    if "artifacts" in run:
        required={"task-contract.json","policy.json","source-before.py","source-after.py",
                  "baseline.json","checks.json","receipt.json","change.patch","plan.json",
                  "checker/workloads.py","checker/restricted_runner.py","checker/core.py"}
        if not required.issubset(files):
            raise ValueError("retained native bundle is incomplete")
        if files["source-before.py"].decode("utf-8") != run["task_source"]["before"]:
            raise ValueError("retained baseline source differs")
        if files["source-after.py"].decode("utf-8") != run["task_source"]["after"]:
            raise ValueError("retained result source differs")
        for identity in run["task_contract"]["checker_files"]:
            name="checker/"+Path(identity["path"]).name
            if name not in files or sha256_hex(files[name])!=identity["sha256"]:
                raise ValueError("retained checker differs")
        if run["qualifying_nebius_runtime_observed"]:
            if not {"provider-inventory.json","provider-api.json","provider-plan.json"}.issubset(files):
                raise ValueError("retained provider records are missing")
            if sha256_hex(files["provider-api.json"])!=run["provider"]["api_record_sha256"]:
                raise ValueError("retained API record differs")
    else:
        # Legacy result downloads retain original files only when their content
        # matches the already-verified envelope. No new checker or source is inferred.
        for name,expected in (("receipt.json",run["receipt"]),("change.patch",run["patch"])):
            try:
                data=directory.read_bytes(name,RUN_BYTES,allow_empty=True)
                value=data.decode("utf-8") if name.endswith(".patch") else strict_json_loads(data.decode("utf-8"))
                if value==expected:files[name]=data
            except (OSError,ValueError):pass
    try:
        raw_journal=directory.read_bytes("journal.json",JOURNAL_BYTES)
        if strict_json_loads(raw_journal.decode("utf-8")).get("operation_id")==run["operation_id"]:
            files["journal.json"]=raw_journal
    except (OSError,ValueError,AttributeError):pass
    return files


def _provider_observation(directory):
    try:
        raw=directory.read_bytes("provider-api.json",PROVIDER_BYTES)
        record=strict_json_loads(raw.decode("utf-8"))
        if not isinstance(record,dict) or record.get("schema")!="evidenceforge-provider-http/v1":
            return None
        response={}
        if isinstance(record.get("response_body"),str):
            try:
                response=strict_json_loads(record["response_body"])
                if not isinstance(response,dict):response={}
            except ValueError:pass
        choices=response.get("choices")
        first=choices[0] if isinstance(choices,list) and choices and isinstance(choices[0],dict) else {}
        headers=record.get("headers",{})
        return {"state":record.get("state"),"http_status":record.get("status"),
                "started_at":record.get("started_at"),"finished_at":record.get("finished_at"),
                "response_received":isinstance(record.get("response_body"),str),
                "model":response.get("model"),"response_id":response.get("id"),
                "request_id":headers.get("request-id") or headers.get("x-request-id"),
                "usage":response.get("usage"),"finish_reason":first.get("finish_reason"),
                "record_sha256":sha256_hex(raw),"response_body_sha256":record.get("response_body_sha256"),
                "error":record.get("error"),"download_available":True}
    except (OSError,ValueError,TypeError,AttributeError):
        return None


def list_operations(root: Path) -> dict:
    """Return recent operations among at most 500 inspected directory entries.

    ``truncated`` also covers an exhausted scan bound or an unreadable listing.
    It never promises that a partial scan found the root's globally newest runs.
    Result files are stat'ed for presence, never parsed or verified by this index.
    """
    operations = []
    truncated = False
    try:
        with _root(root) as directory:
            with os.scandir(directory.fd if directory.fd is not None else directory.path) as entries:
                scanned = 0
                for entry in entries:
                    scanned += 1
                    if _ID.fullmatch(entry.name):
                        try:
                            info = entry.stat(follow_symlinks=False)
                            if not _linked(info) and stat.S_ISDIR(info.st_mode):
                                state, task, result = "UNREADABLE", None, False
                                retained_metadata={}
                                modified = info.st_mtime
                                try:
                                    with directory.child(entry.name) as operation:
                                        for filename in ("journal.json", "run.json"):
                                            try:
                                                file_info = operation.info(filename)
                                                if not _linked(file_info) and stat.S_ISREG(file_info.st_mode):
                                                    modified = max(modified, file_info.st_mtime)
                                                    if filename == "run.json":
                                                        result = True
                                            except OSError:
                                                pass
                                        try:
                                            journal = _journal(operation, entry.name)
                                            recorded = journal.get("state")
                                            state = recorded if isinstance(recorded, str) and recorded in _STATES else "UNREADABLE"
                                            task = journal.get("task") if isinstance(journal.get("task"), str) else None
                                            retained_metadata={key:journal.get(key) for key in
                                                ("execution_mode","model","created_at","finished_at","phase")}
                                        except (OSError, ValueError, TypeError, RecursionError):
                                            pass
                                except OSError:
                                    state, task, result = "UNREADABLE", None, False
                                operations.append({"operation_id": entry.name, "state": state,
                                                   "task": task, "has_result_file": result,
                                                   **retained_metadata,
                                                   "modified_at": _mtime(modified), "_mtime": modified})
                        except OSError:
                            truncated = True
                    if scanned >= SCAN_LIMIT:
                        truncated = True
                        break
    except FileNotFoundError:
        # A server with no retained root has no operations yet.
        pass
    except OSError:
        truncated = True
    operations.sort(key=lambda row: (row["_mtime"], row["operation_id"]), reverse=True)
    truncated = truncated or len(operations) > RESULT_LIMIT
    visible = operations[:RESULT_LIMIT]
    for row in visible:
        row.pop("_mtime")
    return {"operations": visible, "truncated": truncated, "limit": RESULT_LIMIT}


def read_operation(root: Path, identity: str) -> dict:
    """Open one existing operation without executing, retrying, or writing it."""
    identity = _identity(identity)
    view = {"operation_id": identity, "journal": None, "run": None,
            "result_verified": False, "artifacts_verified":False,"provider_observation":None,
            "message": "Retained artifacts could not be read."}
    try:
        with _root(root) as directory:
            # Distinguish a missing operation from an existing unreadable one.
            info = directory.info(identity)
            if _linked(info) or not stat.S_ISDIR(info.st_mode):
                view["message"] = "The retained operation is not a direct readable directory."
                return view
            with directory.child(identity) as operation:
                view["provider_observation"]=_provider_observation(operation)
                try:
                    view["journal"] = _journal(operation, identity)
                except (OSError, ValueError, TypeError, RecursionError):
                    pass
                try:
                    run = operation.read_json("run.json", RUN_BYTES)
                    verified = (run.get("schema") == "evidenceforge-focused-run/v1"
                                and run.get("operation_id") == identity and verify_run(run))
                except FileNotFoundError:
                    view["message"] = "No retained result file is available. The original journal records progress only."
                    return view
                except (OSError, ValueError, TypeError, KeyError, AttributeError, OverflowError, RecursionError):
                    verified = False
                if not verified:
                    view["message"] = "The retained result is unreadable, incomplete, or does not verify. Journal state does not establish completion."
                    return view
                view["run"] = run
                view["result_verified"] = True
                view["message"] = "Run envelope hash and receipt consistency verified; provider claims are not authenticated."
                try:
                    _artifact_bytes(operation,run)
                    view["artifacts_verified"]=True
                except (OSError,ValueError,TypeError,KeyError,AttributeError):
                    view["message"]+=" Some original bundle files are unavailable or differ; bundle download is unavailable."
                if view["journal"] is None:
                    view["message"] += " The original journal could not be read."
                return view
    except FileNotFoundError:
        raise FileNotFoundError("retained operation not found") from None
    except OSError:
        view.update(journal=None, run=None, result_verified=False,
                    message="Retained artifacts could not be read from a stable direct directory.")
        return view


def read_artifacts(root,identity):
    identity=_identity(identity)
    with _root(root) as directory:
        with directory.child(identity) as operation:
            run=operation.read_json("run.json",RUN_BYTES)
            if run.get("operation_id")!=identity or not verify_run(run):
                raise ValueError("original run does not verify")
            files=_artifact_bytes(operation,run)
            source=run.get("task_source")
            return {"operation_id":identity,"run_sha256":run["run_sha256"],
                    "source_before":({"path":source["path"],"content":source["before"],
                                      "sha256":run["source_before_sha256"]} if source else None),
                    "source_after":({"path":source["path"],"content":source["after"],
                                     "sha256":run["source_after_sha256"]} if source else None),
                    "plan":run["receipt"]["plan"],
                    "available":[{"name":name,"bytes":len(data),"sha256":sha256_hex(data)}
                                 for name,data in sorted(files.items())]}


def download_bundle(root,identity):
    identity=_identity(identity)
    with _root(root) as directory:
        with directory.child(identity) as operation:
            run=operation.read_json("run.json",RUN_BYTES)
            if run.get("operation_id")!=identity or not verify_run(run):
                raise ValueError("original run does not verify")
            files=_artifact_bytes(operation,run)
    destination=io.BytesIO()
    with zipfile.ZipFile(destination,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for name,data in sorted(files.items()):
            archive.writestr(identity+"/"+name,data)
        manifest={"schema":"evidenceforge-operation-delivery/v1","operation_id":identity,
                  "run_sha256":run["run_sha256"],"members":[
                      {"name":identity+"/"+name,"bytes":len(data),"sha256":sha256_hex(data)}
                      for name,data in sorted(files.items())]}
        archive.writestr("delivery.json",json.dumps(manifest,indent=2)+"\n")
        archive.writestr("OPEN.md","# Reopen this EvidenceForge operation\n\n"
            "Extract into a new private directory, preserving the operation folder. "
            "Run the original EvidenceForge source with:\n\n"
            "    python -B -m evidenceforge.web_runtime --runs /absolute/path/to/extracted-directory\n\n"
            "Open the local interface and inspect operation `"+identity+"`. "
            "Opening performs no inference or execution. The original source, receipt and "
            "API records remain distinct from provider account billing. No credential is included.\n")
    return destination.getvalue()


def read_provider_record(root,identity):
    identity=_identity(identity)
    with _root(root) as directory:
        with directory.child(identity) as operation:
            raw=operation.read_bytes("provider-api.json",PROVIDER_BYTES)
            record=strict_json_loads(raw.decode("utf-8"))
            if not isinstance(record,dict) or record.get("schema")!="evidenceforge-provider-http/v1":
                raise ValueError("provider record is invalid")
            return raw
