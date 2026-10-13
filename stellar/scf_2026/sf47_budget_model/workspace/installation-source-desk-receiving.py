#!/usr/bin/env python3
"""Receive complete original source workshares through the existing SF47 desk.

This programme requires an explicitly selected existing operating case and full
original source selection. It does not create a substitute commercial scenario,
configure customer credentials, or record commissioning/acceptance observations.
"""
from __future__ import annotations
import argparse
import base64
from copy import deepcopy
from decimal import Decimal
import ctypes
import errno
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import stat
import subprocess
import sys
import threading
import time
import uuid
import zipfile

HERE = Path(__file__).resolve().parent
SCHEMA = "stellar-forge.installation-source-desk-receiving.v1"
BROWSER_EDITION_PHASES = (
    "10-customer-edition-comparison-and-original-downloads",
    "11-explicit-successor-and-unfinished-working-reopen",
    "12-original-edition-apply-and-request-recovery",
    "13-successor-native-preparation-and-complete-downloads",
    "14-edition-history-and-final-working-reopen",
)
MAX_FILE = 192 * 1024 * 1024
CANCELLED = False
CHILDREN = {}
COMMAND_OUTPUTS = []
LEASE = None


def need(value, message):
    if not value:
        raise ValueError(message)


def complete_edition_browser(value):
    return (isinstance(value, dict) and value.get("state") == "COMPLETE" and
            value.get("lifetimes") == "CLOSED" and isinstance(value.get("phases"), dict) and
            all(isinstance(value["phases"].get(name), dict) for name in BROWSER_EDITION_PHASES))


def emit(value):
    try:
        print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)
    except (BrokenPipeError, OSError):
        pass


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def stable(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def value_sha(value):
    return sha(stable(value).encode())


def regular(path, maximum=MAX_FILE):
    path = Path(path).absolute()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= maximum, "Select one complete bounded regular file: " + str(path))
        out, size = [], 0
        while True:
            part = os.read(fd, min(262144, maximum - size + 1))
            if not part:
                break
            size += len(part)
            need(size <= maximum, "The complete original read exceeds its selected bound.")
            out.append(part)
        after, named = os.fstat(fd), os.lstat(path)
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) and
             (named.st_dev, named.st_ino) == (before.st_dev, before.st_ino) and size == before.st_size,
             "The complete original file changed during its read.")
        return b"".join(out)
    finally:
        os.close(fd)


def file_receipt(path, maximum=MAX_FILE):
    path = Path(path).absolute()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= maximum, "Select the complete original regular file.")
        digest, size = hashlib.sha256(), 0
        while True:
            raw = os.read(fd, 262144)
            if not raw:
                break
            digest.update(raw); size += len(raw)
            need(size <= maximum, "The original selected file exceeds its bound.")
        after, named = os.fstat(fd), os.lstat(path)
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) and
             (named.st_dev, named.st_ino) == (before.st_dev, before.st_ino) and size == before.st_size,
             "The selected complete file changed.")
        return {"path": str(path), "filename": path.name, "bytes": size, "sha256": digest.hexdigest()}
    finally:
        os.close(fd)


def directory(path, create=False):
    path = Path(path).expanduser().absolute()
    if create:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = os.lstat(path)
    need(stat.S_ISDIR(info.st_mode) and path.resolve() == path and info.st_uid == os.getuid(),
         "Keep the original canonical directory owned by the receiving operator.")
    return path


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def retain(path, raw):
    path = Path(path)
    try:
        need(regular(path) == raw, "The retained complete output differs: " + str(path))
        sync(path.parent)
        return file_receipt(path)
    except FileNotFoundError:
        pass
    temp = path.parent / ("." + path.name + "-" + uuid.uuid4().hex)
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        view = memoryview(raw)
        while view:
            count = os.write(fd, view)
            need(count > 0, "The complete output write did not advance.")
            view = view[count:]
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        try:
            os.link(temp, path, follow_symlinks=False)
        except FileExistsError:
            need(regular(path) == raw, "Keep the earlier complete output at its original path.")
        sync(path.parent)
    finally:
        os.unlink(temp); sync(path.parent)
    need(regular(path) == raw, "The published complete file did not reopen.")
    return file_receipt(path)


def replace_report(path, value):
    raw = encoded(value)
    temporary = path.parent / ("." + path.name + "-next-" + uuid.uuid4().hex)
    retain(temporary, raw)
    os.replace(temporary, path); sync(path.parent)
    need(regular(path) == raw, "The complete receiving report did not reopen.")


def object_file(path, maximum=MAX_FILE):
    value = json.loads(regular(path, maximum))
    need(isinstance(value, dict), "Keep the complete original JSON object.")
    return value


def stopped(_signum, _frame):
    global CANCELLED
    CANCELLED = True


def check_cancel():
    if CANCELLED:
        raise InterruptedError("The original receiving operation was stopped.")


def proc_status(path):
    result = {}
    for line in path.read_text().splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            result[key] = value.strip()
    return result


def child_identity(mounted_pid):
    text = (Path("/proc") / str(mounted_pid) / "stat").read_text()
    return text[text.rfind(")") + 2:].split()[19]


def tracked_popen(child):
    # Popen.pid is a syscall-namespace PID. Retain its actual Popen owner
    # before any procfs observation or optional pidfd acquisition can fail.
    need(child.pid not in CHILDREN, "Keep the original direct child identity.")
    owner = {"popen": child, "pidfd": None, "mountedPid": None, "identity": None}
    CHILDREN[child.pid] = owner
    if hasattr(os, "pidfd_open"):
        try:
            owner["pidfd"] = os.pidfd_open(child.pid)
        except ProcessLookupError:
            child.poll()
    return owner


def descendants():
    # The mounted procfs may use an outer PID namespace. Translate only our
    # actual direct children, then bind their mounted identity around pidfd_open.
    own = proc_status(Path("/proc/thread-self/status"))
    own_ids = [int(value) for value in own["NSpid"].split()]
    need(own_ids and own_ids[-1] == os.getpid(), "The original process namespace identity is unresolved.")
    depth, result = len(own_ids) - 1, []
    for value in Path("/proc/thread-self/children").read_text().split():
        mounted_pid = int(value)
        try:
            path = Path("/proc") / str(mounted_pid)
            entry = proc_status(path / "status")
            ids = [int(part) for part in entry["NSpid"].split()]
            need(int(entry["PPid"]) == own_ids[0] and len(ids) > depth and ids[0] == mounted_pid,
                 "The original direct-child namespace identity changed.")
            result.append({"pid": ids[depth], "mountedPid": mounted_pid,
                           "identity": child_identity(mounted_pid), "parent": own_ids[0], "ids": ids})
        except (FileNotFoundError, ProcessLookupError):
            # Exit is reconciled only by waitpid; an absent proc entry is not
            # evidence that all owned descendants have closed.
            continue
    return result


def tracked_descendant(selected):
    pid = selected["pid"]
    if pid in CHILDREN:
        return
    need(hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal"),
         "Use the original Linux pidfd facility for adopted child ownership.")
    fd = None
    try:
        fd = os.pidfd_open(pid)
        current = proc_status(Path("/proc") / str(selected["mountedPid"]) / "status")
        need([int(part) for part in current["NSpid"].split()] == selected["ids"] and
             int(current["PPid"]) == selected["parent"] and
             child_identity(selected["mountedPid"]) == selected["identity"],
             "The translated original child changed during pidfd acquisition.")
        CHILDREN[pid] = {"popen": None, "pidfd": fd, "mountedPid": selected["mountedPid"],
                         "identity": selected["identity"]}
        fd = None
    except (FileNotFoundError, ProcessLookupError):
        pass
    finally:
        if fd is not None:
            os.close(fd)


def signal_child(pid, signum):
    owner = CHILDREN.get(pid)
    if owner is None:
        return
    try:
        if owner["pidfd"] is not None and hasattr(signal, "pidfd_send_signal"):
            signal.pidfd_send_signal(owner["pidfd"], signum)
        elif owner["popen"] is not None:
            # The original Popen polls/reaps its own syscall PID before sending.
            # No PID taken directly from a mounted procfs reaches os.kill.
            owner["popen"].send_signal(signum)
        else:
            raise RuntimeError("Retain the original adopted child until pidfd signaling is available.")
    except ProcessLookupError:
        pass


def release_child(pid, status=None):
    owner = CHILDREN.get(pid)
    if owner is None:
        return
    if status is not None and owner["popen"] is not None and owner["popen"].returncode is None:
        owner["popen"].returncode = os.waitstatus_to_exitcode(status)
    if owner["pidfd"] is not None:
        os.close(owner["pidfd"])
        owner["pidfd"] = None
    del CHILDREN[pid]


def drain_children():
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    for sig in previous:
        signal.signal(sig, signal.SIG_IGN)
    begun, reported = time.monotonic(), 0
    try:
        while True:
            failure = None
            empty = False
            try:
                while True:
                    try:
                        pid, status = os.waitpid(-1, os.WNOHANG)
                    except ChildProcessError:
                        empty = True
                        break
                    except InterruptedError:
                        continue
                    if not pid:
                        break
                    release_child(pid, status)
                if empty:
                    for pid in list(CHILDREN):
                        release_child(pid)
                    return
            except BaseException as error:
                failure = error
            # Direct Popen owners remain usable when procfs cannot be observed.
            try:
                for selected in descendants():
                    tracked_descendant(selected)
            except BaseException as error:
                failure = failure or error
            for pid in list(CHILDREN):
                try:
                    signal_child(pid, signal.SIGKILL if time.monotonic() - begun > 5 else signal.SIGTERM)
                except BaseException as error:
                    failure = failure or error
            if (failure or time.monotonic() - begun > 5) and time.monotonic() - reported > 2:
                emit({"state": "CLEANUP_PENDING", "ownedPids": list(CHILDREN),
                      "error": str(failure) if failure else None})
                reported = time.monotonic()
            time.sleep(0.1)
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def command(run, label, argv, extra_env=None):
    check_cancel()
    path = run / (label + "-attempt-" + uuid.uuid4().hex + ".log")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    COMMAND_OUTPUTS.append(path)
    child = None
    failure = None
    try:
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=fd, stderr=subprocess.STDOUT,
                                 cwd=HERE, env={**os.environ, **(extra_env or {})}, start_new_session=True,
                                 pass_fds=(LEASE,) if LEASE is not None else ())
        tracked_popen(child)
        while child.poll() is None:
            if CANCELLED:
                signal_child(child.pid, signal.SIGTERM)
                raise InterruptedError("The original owned child was stopped.")
            time.sleep(0.05)
        if child.returncode:
            raise RuntimeError("The complete original command failed with exit " + str(child.returncode) + ": " + label)
    except BaseException as error:
        failure = error
    finally:
        try:
            os.fsync(fd)
        except BaseException as error:
            failure = failure or error
        finally:
            os.close(fd)
        try:
            if child is not None and child.poll() is None:
                signal_child(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    signal_child(child.pid, signal.SIGKILL); child.wait()
        except BaseException as error:
            failure = failure or error
        finally:
            drain_children()
        receipt = file_receipt(path)
        emit({"phase": label, "output": receipt, "state": "FAILED" if failure else "COMPLETE"})
    if failure:
        raise failure
    return receipt


def load_sources():
    paths = sorted(path for path in HERE.rglob("*") if path.is_file() and
                   path.suffix in (".py", ".mjs", ".css", ".html", ".json", ".md", ".txt") and
                   "__pycache__" not in path.parts and ".git" not in path.parts)
    native_root = HERE.parents[1] / "sf49_data_commissioning" / "installation-workorders"
    paths += sorted(path for path in native_root.rglob("*") if path.is_file() and path.suffix in (".py", ".mjs", ".json"))
    paths += [HERE.parent / "budget.py"]
    result = []
    base = HERE.parents[2]
    for path in sorted(set(paths)):
        receipt = file_receipt(path, 12 * 1024 * 1024)
        result.append({**receipt, "sourcePath": str(path.relative_to(base))})
    return result


class Receiving:
    def __init__(self, args):
        self.args = args
        self.root = directory(args.directory, create=True)
        self.control = directory(self.root / "control", create=True)
        self.requests = directory(self.root / "requests", create=True)
        self.outputs = directory(self.root / "outputs", create=True)
        self.browser_root = directory(self.root / "browser", create=True)
        self.report_path = self.root / "report.json"
        self.workspace = None
        self.receivers = []
        self.connections = []
        self.server_workspace = None
        self.server = None
        self.thread = None
        self.closed = False
        self.case_id = args.case
        self.report = object_file(self.report_path) if self.report_path.exists() else {
            "schema": SCHEMA, "operationId": args.operation_id, "state": "RUNNING", "lifetimes": "OPEN",
            "phases": {}, "artifacts": {}, "requests": {}, "selections": {}, "installations": []}
        need(self.report["schema"] == SCHEMA and self.report["operationId"] == args.operation_id,
             "Keep the original receiving report and operation ID.")
        if self.report_path.exists():
            original = regular(self.report_path)
            retain(self.control / ("earlier-report-" + sha(original) + ".json"), original)
        self.save()

    def save(self):
        replace_report(self.report_path, self.report)

    def remember(self, path):
        receipt = file_receipt(path)
        key = str(Path(path).relative_to(self.root))
        prior = self.report["artifacts"].get(key)
        need(prior is None or prior == receipt, "An original receiving artifact changed.")
        self.report["artifacts"][key] = receipt
        return receipt

    def phase(self, name, action):
        check_cancel()
        if name in self.report["phases"]:
            return self.report["phases"][name]
        result = action()
        self.report["phases"][name] = deepcopy(result)
        self.save()
        emit({"phase": name, "state": "COMPLETE"})
        return result

    def freeze(self, name, value):
        path = self.control / name
        retain(path, encoded(value)); self.remember(path)
        return value

    def open(self):
        need(self.server is None and self.workspace is None, "Close the original owner before opening its next interface.")
        from model import Workspace
        self.workspace = Workspace(self.args.workspace, self.args.scenario, on_created=self.own_workspace)
        from operations import Operations
        from operations_installation_sources import SourceDesk
        self.ops = Operations(self.workspace)
        self.desk = SourceDesk(self.ops)
        return self

    def own_workspace(self, owner):
        self.workspace = owner

    def own_server_workspace(self, owner):
        self.server_workspace = owner

    def own_server(self, owner):
        self.server = owner

    def connection(self, *args, **kwargs):
        owner = sqlite3.connect(*args, **kwargs)
        self.connections.append(owner)
        return owner

    def close_connection(self, owner):
        owner.close()
        self.connections.remove(owner)

    def close_workspace(self):
        if self.workspace is not None:
            self.workspace.close()
            self.workspace = None

    def start_server(self):
        need(self.workspace is None and self.server is None, "Keep one original workspace owner.")
        from server import create_server
        selection_path = self.control / "browser-listener.json"
        selected = object_file(selection_path) if selection_path.exists() else None
        if selected is not None:
            need(selected.get("workspace") == str(self.args.workspace) and selected.get("caseId") == self.case_id and
                 isinstance(selected.get("port"), int) and 0 < selected["port"] <= 65535,
                 "Keep the original private browser origin and workspace selection.")
        self.server = create_server(self.args.workspace, self.args.scenario, port=selected["port"] if selected else 0,
                                    access_file=self.control / "open-original-workspace.html",
                                    on_workspace=self.own_server_workspace, on_created=self.own_server)
        retained = {"workspace": str(self.args.workspace), "caseId": self.case_id,
                    "origin": self.server.origin, "port": self.server.server_address[1]}
        retain(selection_path, encoded(retained)); self.remember(selection_path)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.1})
        self.thread.start()
        return {"url": self.server.origin, "token": self.server.token}

    def close_server(self):
        if self.server is not None:
            if self.thread is not None:
                if self.thread.ident is not None:
                    self.server.managed_stopping = True
                    self.server.shutdown()
                    self.thread.join()
                self.thread = None
            self.server.server_close()
            self.server = None
        if self.server_workspace is not None:
            self.server_workspace.close()
            self.server_workspace = None

    def close(self):
        errors = []
        for action in (self.close_server, self.close_workspace):
            try:
                action()
            except BaseException as error:
                errors.append(error)
        for receiver in list(self.receivers):
            try:
                receiver.close()
                self.receivers.remove(receiver)
            except BaseException as error:
                errors.append(error)
        for owner in list(self.connections):
            try:
                self.close_connection(owner)
            except BaseException as error:
                errors.append(error)
        if errors:
            raise RuntimeError("Original close remains pending: " + "; ".join(str(error) for error in errors))
        self.closed = True

    def request(self, label, target, factory):
        path = self.requests / (label + ".json")
        if path.exists():
            saved = object_file(path)
            need(saved["target"] == target, "Keep this exact request attached to its original native API.")
            body = saved["body"]
        else:
            body = factory()
            saved = {"target": target, "caseId": self.case_id, "body": body}
            retain(path, encoded(saved))
        need(saved["caseId"] == self.case_id, "Keep the original native case for request replay.")
        self.remember(path)
        if target == "desk":
            if body["action"] in ("commissioning.archive.receive", "commissioning.attach"):
                from installation_source_desk_client import InstallationSourceDeskClient
                client = InstallationSourceDeskClient(self.desk, self.case_id, self.draft_id,
                            workspace_directory=str(self.args.workspace))
                reviewed = object_file(self.control / (label + "-preview.json"))
                operation = client.prepare_review(reviewed, body["action"],
                            actor=body["actor"], request_id=body["requestId"], note=body.get("note", ""))
                need(operation["request"] == body,
                     "The durable native client must retain the unchanged original reviewed request.")
                operation_path = self.requests / (label + ".operation.json")
                retain(operation_path, encoded(operation)); self.remember(operation_path)
                retained_operation = object_file(operation_path)
                result = client.execute(retained_operation)
                observed = client.reconcile(retained_operation)
                need(observed["state"] == "RECORDED" and observed["result"] == result,
                     "The native client must reconcile the same complete original journal receipt.")
            else:
                result = self.desk.command(self.case_id, self.draft_id, body)
        else:
            result = self.ops.command(self.case_id, body)
        result_path = self.requests / (label + ".result.json")
        retain(result_path, encoded(result)); self.remember(result_path)
        self.report["requests"][label] = {"target": target, "requestId": body["requestId"],
                                          "requestSha256": value_sha(saved), "resultSha256": value_sha(result)}
        return result

    def desk_request(self, label, action, data):
        return self.request(label, "desk", lambda: {
            "requestId": "desk-" + hashlib.sha256((self.args.operation_id + ":" + label).encode()).hexdigest(),
            "expectedRevision": 0 if action == "create" else self.desk.get(self.case_id, self.draft_id)["revision"],
            "actor": self.args.actor, "note": self.args.operation_id + ": " + label,
            "action": action, "data": data() if callable(data) else data})

    def verify_requests(self):
        for label, summary in self.report["requests"].items():
            saved = object_file(self.requests / (label + ".json"))
            expected = object_file(self.requests / (label + ".result.json"))
            need(value_sha(saved) == summary["requestSha256"] and value_sha(expected) == summary["resultSha256"],
                 "The original full request or result differs.")
            if summary["target"] == "desk":
                status = self.desk.request(self.case_id, self.draft_id, summary["requestId"])
                need(status["state"] == "RECORDED" and status["result"] == expected,
                     "Reopen the exact original Source Desk receipt.")
            else:
                actual = self.ops.command(self.case_id, saved["body"])
                need(actual == expected, "Original native request replay changed its complete receipt.")


    def bind_commissioning(self):
        """Retain the exact saved merchant capture selected for this same run."""
        if self.args.commissioning_receiving is None:
            self.commissioning = None
            return None
        selected_path = self.args.commissioning_receiving.expanduser().absolute()
        selected = object_file(selected_path, 8 * 1024 * 1024)
        archive_mode = "archive" in selected
        required = {"schema", "sourceRoot", "projects", "archive" if archive_mode else "files"}
        need(set(selected) >= required and not set(selected) - required - ({"replaceFileIds"} if archive_mode else set()) and
             selected["schema"] == "stellar-forge.installation-commissioning-run.v1",
             "Select the complete commissioning receiving descriptor.")
        source_root = directory(selected["sourceRoot"])
        need(source_root != self.root and source_root not in self.root.parents and self.root not in source_root.parents,
             "Keep original capture inputs separate from this run's retained control files.")
        files, names = ([selected["archive"]] if archive_mode else selected["files"]), set()
        need(isinstance(files, list) and (len(files) == 1 if archive_mode else 5 <= len(files) <= 200),
             "Select every complete original capture identity and each requested report once.")
        retained_root = directory(self.control / "commissioning-original-files", create=True)
        retained = []
        for item in files:
            need(isinstance(item, dict) and set(item) == {
                "filename", "mediaType", "sourceUrl", "observedAt", "bytes", "sha256"},
                "Retain complete original file identity, MIME type, source and observation.")
            filename = item["filename"]
            need(isinstance(filename, str) and
                 re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,199}", filename) and filename not in names,
                 "Use each complete receiving filename once.")
            names.add(filename)
            raw = regular(source_root / filename, 8 * 1024 * 1024)
            need(len(raw) == item["bytes"] and sha(raw) == item["sha256"],
                 "The original commissioning source changed: " + filename)
            output = retained_root / filename
            retain(output, raw)
            retained.append({"selection": deepcopy(item), "receipt": self.remember(output)})
        need(archive_mode or {"commissioning-capture.json", "commissioning-manifest.json",
              "commissioning-review.json", "commissioning-source.json", "original-workshares.json"} <= names,
             "Select the complete original capture, review, manifest and Workshare source.")
        projects = selected["projects"]
        need(isinstance(projects, list) and 0 < len(projects) <= 200 and
             all(isinstance(row, dict) and set(row) == {
                 "projectId", "workshareCaseId", "milestonePhases", "includeAccountSnapshot"} for row in projects),
             "Retain explicit project, original Workshare case and milestone-to-phase mappings.")
        keys = [(row["projectId"], row["workshareCaseId"]) for row in projects]
        need(all(isinstance(first, str) and first and isinstance(second, str) and second for first, second in keys)
             and len(set(keys)) == len(keys), "Keep each original project / Workshare association once.")
        binding = {"descriptor": file_receipt(selected_path, 8 * 1024 * 1024),
                   "selection": selected, "files": retained}
        self.freeze("commissioning-receiving-selection.json", binding)
        self.commissioning = binding
        return binding

    def receive_commissioning(self):
        """Complete original source intake, reviewed attachment and journal replay."""
        selected = self.commissioning
        need(selected is not None, "Select the saved commissioning receiving descriptor.")
        files = []
        for index, original in enumerate(selected["files"]):
            metadata = original["selection"]
            state = self.desk.get(self.case_id, self.draft_id)
            existing = next((row for row in state["files"] if row["filename"] == metadata["filename"]), None)
            if existing is not None:
                need(all(existing.get(key) == value for key, value in metadata.items()),
                     "An existing original draft filename selects a different complete file.")
                _, raw = self.desk.file(self.case_id, self.draft_id, existing["id"], state["revision"])
                need(sha(raw) == metadata["sha256"] and len(raw) == metadata["bytes"],
                     "The retained original draft input changed.")
                files.append(existing)
                continue
            def body(original=original, metadata=metadata):
                raw = regular(original["receipt"]["path"], 8 * 1024 * 1024)
                need(sha(raw) == metadata["sha256"] and len(raw) == metadata["bytes"],
                     "The private complete commissioning input changed.")
                return {**metadata, "contentBase64": base64.b64encode(raw).decode("ascii")}
            result = self.desk_request("12c-file-" + str(index), "file.add", body)
            files.append(result["result"]["file"])
        archive_receipt = None
        if "archive" in selected["selection"]:
            need(len(files) == 1, "Retain the one complete selected merchant archive.")
            archive_file = files[0]
            label = "12c-archive"
            preview_path = self.control / (label + "-preview.json")
            if not (self.requests / (label + ".json")).exists():
                state = self.desk.get(self.case_id, self.draft_id)
                preview = self.desk.commissioning_archive_inspect(self.case_id, self.draft_id, {
                    "expectedRevision": state["revision"], "archiveFileId": archive_file["id"],
                    "replaceFileIds": selected["selection"].get("replaceFileIds", [])})
                need(preview["ready"], "Resolve the original archive's exact reviewed filename conflicts and source capacity.")
                self.freeze(preview_path.name, preview)
            preview = object_file(preview_path)
            archive_receipt = self.desk_request(label, "commissioning.archive.receive", lambda: {
                **preview["selection"], "expectedPreviewSha256": preview["previewSha256"]})
            returned = archive_receipt["result"]
            need(returned["state"] == "RECEIVED_COMMISSIONING_ARCHIVE" and
                 returned["archive"]["sha256"] == archive_file["sha256"] and
                 returned["previewSha256"] == preview["previewSha256"],
                 "The original archive receiving result differs from its reviewed complete source.")
            state = self.desk.get(self.case_id, self.draft_id)
            native_files = {row["id"]: row for row in state["files"]}
            files = [native_files[ident] for ident in returned["receivingSelection"]["fileIds"]]
            archive_snapshot = next((row for row in returned["files"] if
                row.get("originalMemberName", row["filename"]) == "commissioning-account-snapshot.json"), None)
            replay = self.desk.command(self.case_id, self.draft_id,
                                      object_file(self.requests / (label + ".json"))["body"])
            need(replay == archive_receipt and self.desk.get(self.case_id, self.draft_id) == state,
                 "Complete archive replay must preserve the current original draft and receipt.")
        else:
            archive_snapshot = None
        capture_file = next(row for row in files if row["filename"] == "commissioning-capture.json")
        results = []
        for index, mapping in enumerate(selected["selection"]["projects"]):
            project_files = list(files)
            if mapping["includeAccountSnapshot"] and archive_snapshot is not None:
                project_files.append(archive_snapshot)
            label = "12c-receive-" + str(index)
            before_path = self.control / (label + "-before.json")
            preview_path = self.control / (label + "-preview.json")
            # A request may already have committed before this process recorded
            # its phase result. Preserve its original input/review and replay.
            if not (self.requests / (label + ".json")).exists():
                state = self.desk.get(self.case_id, self.draft_id)
                inspected = self.desk.commissioning_inspect(self.case_id, self.draft_id, {
                    "expectedRevision": state["revision"], "captureFileId": capture_file["id"],
                    "fileIds": [row["id"] for row in reversed(project_files)]})
                project = next((row for row in inspected["projects"] if row["id"] == mapping["projectId"]), None)
                need(project is not None and project["caseId"] == mapping["workshareCaseId"],
                     "The saved project must name the exact original Workshare case.")
                candidates = [row for row in self.report["installations"] if row["caseId"] == mapping["workshareCaseId"]]
                need(len(candidates) == 1, "Select one original Installation created for this exact Workshare case.")
                target = self.ops.installation(self.case_id, candidates[0]["id"])
                selection = {"expectedRevision": state["revision"], "captureFileId": capture_file["id"],
                             "fileIds": [row["id"] for row in reversed(project_files)],
                             "expectedVersion": inspected["version"], "projectId": mapping["projectId"],
                             "installationId": target["id"], "expectedInstallationRevision": target["revision"],
                             "milestonePhases": deepcopy(mapping["milestonePhases"]),
                             "includeAccountSnapshot": mapping["includeAccountSnapshot"]}
                preview = self.desk.commissioning_preview(self.case_id, self.draft_id, selection)
                normalized = self.desk.commissioning_preview(self.case_id, self.draft_id, {
                    "expectedRevision": preview["draftRevision"], **preview["selection"]})
                need(normalized == preview, "The returned normalized selection must replay its complete native review exactly.")
                self.freeze(before_path.name, {key: value for key, value in target.items() if key != "current"})
                self.freeze(preview_path.name, preview)
            preview = object_file(preview_path)
            before = object_file(before_path)
            result = self.desk_request(label, "commissioning.attach", lambda: {
                **preview["selection"], "expectedPreviewSha256": preview["previewSha256"]})
            received = result["result"]
            need(received["state"] == "ATTACHED_COMMISSIONING" and
                 received["previewSha256"] == preview["previewSha256"] and
                 received["projectId"] == mapping["projectId"] and
                 received["workshare"]["caseId"] == mapping["workshareCaseId"],
                 "The original attachment receipt differs from the reviewed association.")
            after = self.ops.installation(self.case_id, received["installation"]["id"], received["installation"]["revision"])
            need(after["sha256"] == received["installation"]["sha256"],
                 "The selected saved Installation differs from its original receiving receipt.")
            original_document = before["preview"]["document"]
            document = deepcopy(after["preview"]["document"])
            attached_ids = {row["sourceId"] for row in received["sources"]}
            need(attached_ids <= set(document["receiving"]["sourceIds"]),
                 "The saved original receiving selection lost attached source identities.")
            target_checks = {row["checkId"] for row in preview["milestonePhases"]}
            original_checks = {row["id"]: row for row in original_document["checks"]}
            for check in document["checks"]:
                if check["id"] in target_checks:
                    need(attached_ids <= set(check["sourceIds"]), "An explicitly selected phase lost its source references.")
                else:
                    need(check["sourceIds"] == original_checks[check["id"]]["sourceIds"],
                         "An unselected original phase changed its source references.")
                check["sourceIds"] = deepcopy(original_checks[check["id"]]["sourceIds"])
            document["receiving"]["sourceIds"] = deepcopy(original_document["receiving"]["sourceIds"])
            need(document == original_document,
                 "The complete original acceptance, dates, payment, Workshare and other Installation fields must be unchanged.")
            generated = [row for row in received["sources"] if row.get("generated")]
            need(len(generated) == 1, "Retain one complete native capture-to-phase association in the original case.")
            for file in received["sources"]:
                metadata, raw = self.ops.source(self.case_id, file["sourceId"])
                need(sha(raw) == file["sha256"] and len(raw) == file["bytes"],
                     "An attached complete original source differs from its receipt.")
                if file.get("generated"):
                    link = json.loads(raw)
                    need(link["kind"] == "REVIEWED_CAPTURE_PHASE_BINDING" and
                         link["capture"]["id"] == received["capture"]["id"] and
                         link["milestonePhases"] == preview["milestonePhases"],
                         "The exported native association lost its exact saved capture or phase mapping.")
            current_version = self.ops.read(self.case_id)["program"]["version"]
            lookup = self.desk.request(self.case_id, self.draft_id, result["requestId"])
            saved_request = object_file(self.requests / (label + ".json"))
            replay = self.desk.command(self.case_id, self.draft_id, saved_request["body"])
            need(lookup["state"] == "RECORDED" and lookup["result"] == result and replay == result and
                 self.ops.read(self.case_id)["program"]["version"] == current_version,
                 "Receiving replay must return its original complete receipt without another source or Installation edition.")
            self.freeze(label + "-saved.json", {key: value for key, value in after.items() if key != "current"})
            results.append({"requestId": result["requestId"], "projectId": mapping["projectId"],
                            "captureId": received["capture"]["id"], "installation": received["installation"],
                            "sourceCount": len(received["sources"]), "generatedAssociation": generated[0],
                            "previewSha256": preview["previewSha256"], "receiptSha256": value_sha(result)})
        return {"schema": "stellar-forge.installation-commissioning-receiving.v1",
                "selections": len(results), "receipts": results,
                "archiveReceiving": ({"requestId": archive_receipt["requestId"],
                    "receiptSha256": value_sha(archive_receipt)} if archive_receipt else None),
                "originalObservationsPreserved": True, "originalReplayPreserved": True}

    def bind_inputs(self):
        self.args.workspace = directory(self.args.workspace)
        need((self.args.workspace / "planning.sqlite3").is_file(), "Select the original existing SF47 workspace.")
        self.args.source_root = directory(self.args.source_root)
        for first, second in ((self.root, self.args.workspace), (self.root, HERE), (self.root, self.args.source_root)):
            need(first != second and first not in second.parents and second not in first.parents,
                 "Keep receiving control files outside the original workspace and installed source.")
        selected_raw = regular(self.args.selection, 8 * 1024 * 1024)
        selected = json.loads(selected_raw)
        need(selected.get("schema") in ("stellar-forge.installation-source-selection.v1",
                                        "stellar-forge.installation-handover-selection.v1") and
             isinstance(selected.get("cases"), list) and selected["cases"],
             "Select the complete original source preparation input.")
        original_files = {}
        for case in selected["cases"]:
            source_key = "handover" if selected["schema"] == "stellar-forge.installation-handover-selection.v1" else "packet"
            for item in [case[source_key], *case["files"]]:
                need(item["path"] == item["filename"] and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,199}", item["filename"]),
                     "Keep the original selected receiving filename at the source root.")
                receipt = file_receipt(self.args.source_root / item["path"], 8 * 1024 * 1024)
                need(receipt["bytes"] == item["bytes"] and receipt["sha256"] == item["sha256"],
                     "The complete original input differs from its selected source.")
                if item["filename"] in original_files:
                    need(original_files[item["filename"]]["selection"] == item,
                         "Keep a repeated full source under one identical original identity.")
                original_files[item["filename"]] = {"receipt": receipt, "selection": item}
        runtime = {name: file_receipt(Path(value).resolve(), 300 * 1024 * 1024)
                   for name, value in (("node", self.args.node), ("playwright", self.args.browser_module),
                                       ("chromium", self.args.browser_executable))}
        self.args.node = Path(runtime["node"]["path"])
        self.args.browser_module = Path(runtime["playwright"]["path"])
        self.args.browser_executable = Path(runtime["chromium"]["path"])
        source = load_sources()
        selection = {"schema": SCHEMA, "operationId": self.args.operation_id, "caseId": self.case_id,
                     "workspace": str(self.args.workspace), "expectedOriginalVersion": self.args.expected_case_version,
                     "recordingActor": self.args.actor, "sourceSelection": file_receipt(self.args.selection, 8 * 1024 * 1024),
                     "originalFiles": original_files, "runtime": runtime, "installedSource": source,
                     "scenario": file_receipt(self.args.scenario, 16 * 1024 * 1024)}
        commissioning = self.bind_commissioning()
        if commissioning is not None:
            selection["commissioningReceiving"] = commissioning
        self.freeze("selection.json", selection)
        self.selected = selected
        self.original_files = original_files
        self.selection = selection
        self.runtime = runtime
        self.draft_id = "source-desk-" + hashlib.sha256((self.args.operation_id + ":desk").encode()).hexdigest()[:32]
        self.report["selections"] = {"caseId": self.case_id, "sourceDeskId": self.draft_id,
                                      "selectionSha256": value_sha(selection)}
        self.open()
        self.initial_path = self.control / "original-case.json"
        if self.initial_path.exists():
            initial = object_file(self.initial_path)
        else:
            initial = self.ops.read(self.case_id)
            need(initial["program"]["version"] == self.args.expected_case_version and initial["program"]["state"] == "OPEN",
                 "Review the actual existing open case version before this original receiving operation.")
            self.freeze("original-case.json", initial)
        if not (self.control / "original-installations.json").exists():
            self.freeze("original-installations.json", [
                {key: value for key, value in self.ops.installation(self.case_id, row["id"], row["revision"]).items()
                 if key != "current"} for row in initial["installations"]])
        need(initial["program"]["id"] == self.case_id, "Keep the exact original case identity.")
        self.initial = initial
        self.remember(self.initial_path)
        return {"sourceSelection": selection["sourceSelection"], "files": len(original_files),
                "originalCaseId": self.case_id, "originalVersion": initial["program"]["version"],
                "draftId": self.draft_id, "runtime": runtime}

    def retain_inputs(self):
        results = []
        for number, (name, item) in enumerate(self.original_files.items()):
            def data(item=item, name=name):
                raw = regular(item["receipt"]["path"], 8 * 1024 * 1024)
                source = item["selection"]
                return {"filename": name, "mediaType": source.get("mediaType", "application/json"),
                        "sourceUrl": source["sourceUrl"], "observedAt": source["observedAt"],
                        "bytes": len(raw), "sha256": sha(raw), "contentBase64": base64.b64encode(raw).decode()}
            receipt = self.desk_request("02-file-" + str(number), "file.add", data)
            row = receipt["result"]["file"]
            _, raw = self.desk.file(self.case_id, self.draft_id, row["id"], receipt["draft"]["revision"])
            need(sha(raw) == item["receipt"]["sha256"] and len(raw) == item["receipt"]["bytes"],
                 "The retained original file differs from its complete source.")
            results.append(row)
        return {"files": results, "revision": self.desk.get(self.case_id, self.draft_id)["revision"]}

    def inspect_cases(self):
        current = self.desk.get(self.case_id, self.draft_id)
        files = {item["filename"]: item for item in current["files"]}
        results = []
        for case in self.selected["cases"]:
            source_key = "handover" if self.selected["schema"] == "stellar-forge.installation-handover-selection.v1" else "packet"
            file = files[case[source_key]["filename"]]
            value = self.desk.inspect(self.case_id, self.draft_id, file["id"], current["revision"], case.get("phaseIdAmendment"))
            need(value["packet"]["caseId"] == case["caseId"] and
                 value["packet"]["planSha256"] == case["planSha256"] and
                 sha(value["jsonText"].encode()) == file["sha256"],
                 "The native packet inspection changed complete original scope.")
            if case.get("phaseIdAmendment"):
                need(value["phaseAmendmentReceipt"]["mapping"] == case["phaseIdAmendment"]["mapping"],
                     "The original phase amendment differs.")
            path = self.outputs / ("inspection-" + str(len(results)) + ".json")
            retain(path, encoded(value)); self.remember(path)
            results.append({"caseId": case["caseId"], "planSha256": case["planSha256"],
                            "phases": len(value["packet"]["plan"]["phases"]), "fileId": file["id"]})
        return results

    def prepare(self):
        def pins():
            catalogue = self.desk.profiles()
            profiles = {row["id"]: row["sha256"] for row in catalogue["profiles"]}
            engine = next((row["engine"] for row in catalogue.get("sourceFormats", [])
                           if row["schema"] == self.selected["schema"]), None)
            if engine is None and self.selected["schema"] == "stellar-forge.installation-source-selection.v1":
                engine = catalogue["engine"]
            need(engine is not None, "Retain the installed complete original source-format engine.")
            return {"expectedEngineSha256": engine["sha256"],
                    "expectedSelectionSha256": value_sha(self.selected),
                    "expectedProfiles": {row["profile"]: profiles[row["profile"]] for row in self.selected["cases"]}}
        result = self.desk_request("05-prepare", "prepare", pins)
        value = result["result"]
        need(value["state"] == "PREPARED_SOURCE" and
             [row["caseId"] for row in value["report"]["cases"]] == [row["caseId"] for row in self.selected["cases"]],
             "The complete native preparation differs from the original selected cohort.")
        for expected, received in zip(self.selected["cases"], value["report"]["nativeWorkshares"]):
            need(received["planSha256"] == expected["planSha256"] and
                 Decimal(received["hours"]) == Decimal(expected["effortTotal"]["hours"]) and
                 received["packetPresent"] == (self.selected["schema"] != "stellar-forge.installation-handover-selection.v1"),
                 "The original complete effort or packet changed.")
        self.freeze("native-preparation.json", value)
        return value

    def prepared(self):
        return object_file(self.control / "native-preparation.json")

    def outputs_complete(self):
        prepared = self.prepared()
        for item in prepared["files"]:
            metadata, raw = self.desk.output(self.case_id, self.draft_id, prepared["id"], item["filename"])
            need(metadata == item and sha(raw) == item["sha256"] and len(raw) == item["bytes"],
                 "The complete native prepared file differs.")
            retain(self.outputs / item["filename"], raw); self.remember(self.outputs / item["filename"])
        archive_path = self.outputs / "complete-source-preparation.zip"
        raw = self.desk.export(self.case_id, self.draft_id, prepared["id"])
        retain(archive_path, raw); receipt = self.remember(archive_path)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = archive.namelist()
            need(len(names) == len(set(names)) and all("/" not in name and "\\" not in name for name in names),
                 "Keep every complete original archive member under its declared receiving filename.")
            expected_names = {item["filename"] for item in prepared["files"]} | {"INSTALLATION_SOURCE_DESK_PREPARATION.json"}
            need(set(names) == expected_names, "The whole original prepared archive has missing or extra members.")
            for item in prepared["files"]:
                data = archive.read(item["filename"])
                need(len(data) == item["bytes"] and sha(data) == item["sha256"], "A complete ZIP member differs.")
            manifest = json.loads(archive.read("INSTALLATION_SOURCE_DESK_PREPARATION.json"))
            need(manifest == prepared, "The complete desk manifest differs from its original preparation.")
        return {"files": len(prepared["files"]), "archive": receipt}

    def attach(self):
        prepared = self.prepared()
        result = self.desk_request("07-attach", "attach", lambda: {
            "preparationId": prepared["id"], "expectedSelectionSha256": prepared["selectionSha256"],
            "expectedVersion": self.ops.read(self.case_id)["program"]["version"]})
        attached = result["result"]
        need(attached["state"] == "ATTACHED_SOURCES" and len(attached["sources"]) == len(prepared["files"]),
             "Keep the original complete attachment in one accepted case transaction.")
        self.freeze("native-attachment.json", attached)
        return attached

    def replay_earlier(self):
        before = self.desk.get(self.case_id, self.draft_id)
        replay = self.request("05-prepare", "desk", lambda: None)
        need(replay["result"] == self.prepared() and self.desk.get(self.case_id, self.draft_id) == before,
             "An older original preparation replay changed the current source draft.")
        return {"preparedRevision": replay["draft"]["revision"], "currentRevision": before["revision"],
                "sameOriginalReceipt": True}

    def cli_download(self):
        prepared = self.prepared()
        item = next(row for row in prepared["files"] if row["filename"] == "SUPPLIER_RECEIVING.json")
        output = self.outputs / "terminal-SUPPLIER_RECEIVING.json"
        self.close_workspace()
        command(self.control, "09-terminal-complete-output", [
            sys.executable, str(HERE / "installation-source-desk.py"),
            "--workspace", str(self.args.workspace), "--scenario", str(self.args.scenario),
            "--case", self.case_id, "--out", str(output), "output", "--draft", self.draft_id,
            "--preparation", prepared["id"], "--filename", item["filename"], "--expected-sha256", item["sha256"]])
        receipt = self.remember(output)
        need(receipt["sha256"] == item["sha256"] and receipt["bytes"] == item["bytes"],
             "The actual terminal output differs from the full native receipt.")
        self.open()
        return receipt

    def installations(self):
        attached = object_file(self.control / "native-attachment.json")
        results = []
        for index, selected in enumerate(self.selected["cases"]):
            label = "10-installation-" + str(index)
            source_path = self.control / (label + "-input.json")
            prepared_path = self.outputs / (label + "-prepared.json")
            if source_path.exists():
                source = object_file(source_path)
            else:
                selection = {**attached["selection"], "expectedVersion": self.ops.read(self.case_id)["program"]["version"]}
                seed = self.ops.seed_workshare_installation(self.case_id, {
                    **selection, "workshareCaseId": selected["caseId"], "installationId": None, "expectedRevision": 0})
                profiles = self.desk.profiles()
                profile = next(row for row in profiles["profiles"] if row["id"] == selected["profile"])
                source = {"mode": "prepare-profile", "seed": seed, "profile": profile,
                          "bindings": selected.get("bindings"), "output": str(prepared_path)}
                if selected.get("programme") is not None:
                    preparation = self.prepared()
                    mapping = selected["programme"]
                    def original_output(name):
                        metadata, raw = self.desk.output(self.case_id, self.draft_id, preparation["id"], name)
                        need(len(raw) == metadata["bytes"] and sha(raw) == metadata["sha256"],
                             "The original programme source differs from its complete preparation.")
                        value = json.loads(raw)
                        need(isinstance(value, dict), "Select the complete original programme JSON object.")
                        return value
                    roles = preparation.get("sourceRoles", {"commissioning": "Supplier_Workshare_Commissioning.json"})
                    programme = {"commissioning": original_output(roles["commissioning"]),
                                 "calendarInput": original_output(mapping["calendarFile"])}
                    for key, target in (("selectionFile", "selection"), ("taskBudgetFile", "taskBudget"),
                                        ("nativeChangeFile", "nativeChange")):
                        if key in mapping:
                            programme[target] = original_output(mapping[key])
                    source["programmeInputs"] = programme
                self.freeze(source_path.name, source)
            command(self.control, label + "-profile", [str(self.args.node), str(HERE / "installation-source-desk-receiving.mjs"), str(source_path)])
            prepared = object_file(prepared_path)
            self.remember(prepared_path)
            need(prepared["workshareCaseId"] == selected["caseId"] and
                 prepared["document"]["workshare"]["planSha256"] == selected["planSha256"],
                 "The original prepared Installation changed its Workshare selection.")
            def body(prepared=prepared, label=label):
                preview = self.ops.preview_installation(self.case_id, prepared["preview"])
                need(preview["document"] == prepared["document"], "The native Installation preview differs from the full prepared document.")
                self.freeze(label + "-preview.json", preview)
                return {"requestId": "installation-" + hashlib.sha256((self.args.operation_id + ":" + label).encode()).hexdigest(),
                        "expectedVersion": preview["source"]["version"], "actor": self.args.actor,
                        "note": "Receive complete original scope with outstanding customer selections retained: " + self.args.operation_id,
                        "action": "installation.save", "data": {
                            "installationId": None, "expectedRevision": 0, "document": preview["document"],
                            "expectedPreviewSha256": preview["previewSha256"]}}
            receipt = self.request(label, "operations", body)
            row = self.ops.installation(self.case_id, receipt["recordId"], receipt["revision"])
            need(row["sha256"] == receipt["sha256"] and row["preview"]["document"] == prepared["document"],
                 "The complete saved native Installation differs.")
            native_path = self.outputs / (label + "-saved.json")
            retained = {key: value for key, value in row.items() if key != "current"}
            retain(native_path, encoded(retained)); self.remember(native_path)
            results.append({"id": row["id"], "revision": row["revision"], "sha256": row["sha256"],
                            "caseId": selected["caseId"], "planSha256": selected["planSha256"],
                            "outstandingSelections": prepared["selections"], "path": str(native_path)})
        self.report["installations"] = results
        return results

    def browser(self):
        self.close_workspace()
        input_path = self.browser_root / "input.json"
        output_path = self.browser_root / "report.json"
        # Runtime and original source are bound before a completed child result
        # can be adopted after an interrupted parent.
        frozen = {"schema": SCHEMA, "mode": "browser", "operationId": self.args.operation_id,
                  "caseId": self.case_id, "draftId": self.draft_id, "planId": self.initial["program"]["planId"],
                  "selectionSha256": value_sha(self.selection), "sourceSelection": deepcopy(self.selected),
                  "runtime": self.runtime, "workspace": str(self.args.workspace), "actor": self.args.actor,
                  "preparation": self.prepared(), "installations": self.report["installations"],
                  "directory": str(self.browser_root), "output": str(output_path),
                  "originalFiles": self.original_files}
        retain(input_path, encoded(frozen)); self.remember(input_path)
        if not output_path.exists() or not complete_edition_browser(object_file(output_path)):
            service = self.start_server()
            access_path = self.browser_root / ("access-" + uuid.uuid4().hex + ".json")
            retain(access_path, encoded(service))
            try:
                command(self.control, "11-browser-native", [
                    str(self.args.node), str(HERE / "installation-source-desk-receiving.mjs"), str(input_path), str(access_path)],
                    {"TMPDIR": str(directory(self.browser_root / "tmp", create=True))})
            finally:
                self.close_server()
        self.open()
        result = object_file(output_path)
        need(result.get("schema") == SCHEMA and complete_edition_browser(result) and
             result.get("operationId") == self.args.operation_id and result.get("caseId") == self.case_id and
             result.get("selectionSha256") == value_sha(self.selection) and
             result.get("inputSha256") == file_receipt(input_path)["sha256"],
             "Keep the completed browser bound to this exact original source, runtime and operation.")
        for value in result["artifacts"].values():
            need(file_receipt(value["path"]) == value, "A complete original browser artifact differs.")
            self.remember(value["path"])
        for row in result["installations"]:
            current = self.ops.installation(self.case_id, row["id"], row["revision"])
            need(current["sha256"] == row["sha256"], "The browser's complete original Installation postimage differs.")
        current = self.desk.get(self.case_id, result["browserDraftId"])
        need(value_sha(current) == result["sourceDraftSha256"], "The browser's complete saved source draft differs.")
        # Bind the actual child report on both ordinary and interrupted-parent adoption.
        self.remember(output_path)
        return result

    def verify_original(self):
        current = self.ops.read(self.case_id)
        need(current["program"]["id"] == self.initial["program"]["id"] and
             current["program"]["planId"] == self.initial["program"]["planId"] and
             current["program"]["createdAt"] == self.initial["program"]["createdAt"] and
             current["program"]["state"] == self.initial["program"]["state"] and
             current["plan"] == self.initial["plan"] and current["records"] == self.initial["records"],
             "The original case, complete plan or recorded business work changed.")
        for selected in self.initial["sources"]:
            metadata, raw = self.ops.source(self.case_id, selected["id"])
            need(metadata == selected and sha(raw) == selected["sha256"] and len(raw) == selected["bytes"],
                 "An earlier complete original case source changed.")
        for row in object_file_list(self.control / "original-installations.json"):
            current_row = self.ops.installation(self.case_id, row["id"], row["revision"])
            need({key: value for key, value in current_row.items() if key != "current"} == row,
                 "An earlier original Installation edition changed.")
        self.verify_requests()
        browser = self.report["phases"].get("12-actual-desktop-and-phone-operator")
        if browser is not None:
            actual = object_file(self.browser_root / "report.json")
            need(actual == browser and complete_edition_browser(actual) and
                 actual.get("selectionSha256") == value_sha(self.selection) and
                 actual.get("inputSha256") == file_receipt(self.browser_root / "input.json")["sha256"] and
                 actual.get("operationId") == self.args.operation_id and actual.get("caseId") == self.case_id,
                 "The completed original browser report changed source, runtime or operation.")
            need(value_sha(self.desk.get(self.case_id, actual["browserDraftId"])) == actual["sourceDraftSha256"],
                 "The completed browser source draft changed.")
            for row in actual["installations"]:
                need(self.ops.installation(self.case_id, row["id"], row["revision"])["sha256"] == row["sha256"],
                     "The completed browser Installation changed its full original postimage.")
        return current

    def final_export(self):
        path = self.outputs / "complete-native-operations.zip"
        if path.exists():
            raw = regular(path)
            document, files = self.ops._unpack(raw)
            need(document["program"]["id"] == self.case_id and
                 document["program"]["version"] == self.ops.read(self.case_id)["program"]["version"],
                 "Keep the existing whole Operations export bound to its actual saved edition.")
        else:
            raw = self.ops.export(self.case_id)
            retain(path, raw)
        receipt = self.remember(path)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            need(len(archive.namelist()) == len(set(archive.namelist())), "The native export repeats an original member.")
            for row in self.ops.read(self.case_id)["sources"]:
                need(sha(archive.read("sources/" + row["id"])) == row["sha256"], "The native export lost a complete attached source.")
        return receipt

    def backup(self):
        expected = logical_database(self.workspace.db)
        source = self.outputs / "complete-workspace.sqlite3"
        if source.exists():
            other = self.connection(source.as_uri() + "?mode=ro", uri=True)
            try:
                need(logical_database(other) == expected, "The actual retained full backup differs from the original current workspace.")
            finally:
                self.close_connection(other)
        else:
            temp = self.outputs / (".backup-" + uuid.uuid4().hex + ".sqlite3")
            fd = os.open(temp, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            os.close(fd)
            target = self.connection(temp)
            try:
                with self.workspace.mutex:
                    self.workspace.db.backup(target)
                need(logical_database(target) == expected, "The complete SQLite backup differs from the original held workspace.")
            finally:
                self.close_connection(target)
            fd = os.open(temp, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
            receipt = file_receipt(temp)
            os.link(temp, source, follow_symlinks=False); sync(source.parent); os.unlink(temp); sync(source.parent)
            need(file_receipt(source)["sha256"] == receipt["sha256"], "The full retained database bytes changed.")
        receipt = self.remember(source)
        expected_path = self.control / "database-logical-identity.json"
        retain(expected_path, encoded(expected)); self.remember(expected_path)
        restored = directory(self.root / "restored", create=True)
        destination = restored / "planning.sqlite3"
        if not destination.exists():
            retain(destination, regular(source))
        from model import Workspace
        from operations import Operations
        from operations_installation_sources import SourceDesk
        receiver = None
        try:
            receiver = Workspace(restored, self.args.scenario, on_created=self.receivers.append)
            need(logical_database(receiver.db) == expected, "The complete independently reopened workspace differs.")
            operations = Operations(receiver); desk = SourceDesk(operations)
            need(desk.get(self.case_id, self.draft_id) == self.desk.get(self.case_id, self.draft_id),
                 "The full source draft/history did not reopen in the received workspace.")
            need(operations.read(self.case_id) == self.ops.read(self.case_id),
                 "The original complete native case did not reopen.")
            commissioning = self.report["phases"].get("12c-original-commissioning-capture-receiving")
            if commissioning is not None:
                retained_receipts = list(commissioning["receipts"])
                if commissioning.get("archiveReceiving"):
                    retained_receipts.append(commissioning["archiveReceiving"])
                for received in retained_receipts:
                    lookup = desk.request(self.case_id, self.draft_id, received["requestId"])
                    need(lookup["state"] == "RECORDED" and
                         value_sha(lookup["result"]) == received["receiptSha256"],
                         "The complete original commissioning receipt, sources and Installation edition did not reopen.")
            for row in self.prepared()["files"]:
                _, raw = desk.output(self.case_id, self.draft_id, self.prepared()["id"], row["filename"])
                need(sha(raw) == row["sha256"], "A complete prepared output failed independent reopening.")
        finally:
            if receiver is not None:
                receiver.close()
                self.receivers.remove(receiver)
        return {"backup": receipt, "logicalIdentity": expected, "restoredDirectory": str(restored)}


def object_file_list(path):
    value = json.loads(regular(path))
    need(isinstance(value, list), "Keep the complete original object list.")
    return value


def logical_database(db):
    result = []
    for name, sql in db.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        quoted = '"' + name.replace('"', '""') + '"'
        columns = list(db.execute("PRAGMA table_info(" + quoted + ")"))
        keys = [row[1] for row in sorted(columns, key=lambda row: row[5]) if row[5]]
        order = ",".join('"' + key.replace('"', '""') + '"' for key in keys) if keys else "rowid"
        digest, count = hashlib.sha256(), 0
        for row in db.execute("SELECT * FROM " + quoted + " ORDER BY " + order):
            digest.update(b"row\0")
            for value in row:
                if value is None:
                    raw, kind = b"", b"null"
                elif isinstance(value, bytes):
                    raw, kind = value, b"blob"
                elif isinstance(value, str):
                    raw, kind = value.encode(), b"text"
                else:
                    raw, kind = repr(value).encode(), b"number"
                digest.update(kind + b":" + str(len(raw)).encode() + b":" + raw + b"\0")
            count += 1
        result.append({"table": name, "sql": sql, "rows": count, "sha256": digest.hexdigest()})
    return {"tables": result, "sha256": value_sha(result)}


def run_program(args):
    run = Receiving(args)
    failure = None
    try:
        binding = run.bind_inputs()
        run.phase("01-original-case-source-and-runtime", lambda: binding)
        if run.report.get("state") == "PASS":
            need(run.report.get("lifetimes") == "CLOSED", "Keep the previous original close receipt.")
            run.verify_original()
            for receipt in run.report["artifacts"].values():
                need(file_receipt(receipt["path"]) == receipt, "A completed original artifact no longer matches.")
            current = run.report["current"]
            need(run.ops.read(run.case_id)["program"]["version"] == current["caseVersion"] and
                 value_sha(run.desk.get(run.case_id, run.draft_id)) == current["sourceDraftSha256"],
                 "The completed receiving case or original source draft changed.")
            run.backup()
            emit({"state": "ORIGINAL_COMPLETE_REOPENED", "operationId": args.operation_id})
        else:
            run.report["state"] = "RUNNING"; run.report["lifetimes"] = "OPEN"; run.save()
            run.phase("02-create-source-draft", lambda: run.desk_request("01-create", "create", {
                "title": "Complete original source preparation · " + args.operation_id}))
            run.phase("03-retain-every-original-file", run.retain_inputs)
            run.phase("04-inspect-complete-original-phases", run.inspect_cases)
            run.phase("05-save-complete-source-mapping", lambda: run.desk_request(
                "04-selection", "selection.save", {"selection": run.selected}))
            run.phase("06-native-complete-preparation", run.prepare)
            run.phase("07-full-output-and-archive-reopening", run.outputs_complete)
            run.phase("08-atomic-original-case-attachment", run.attach)
            run.phase("09-original-preparation-replay-after-attachment", run.replay_earlier)
            run.phase("10-terminal-complete-file-delivery", run.cli_download)
            run.phase("11-every-native-customer-installation", run.installations)
            run.phase("12-actual-desktop-and-phone-operator", run.browser)
            if args.commissioning_receiving is not None:
                run.phase("12c-original-commissioning-capture-receiving", run.receive_commissioning)
            run.phase("13-earlier-business-and-request-preservation", lambda: {
                "caseVersion": run.verify_original()["program"]["version"], "originalRecordsPreserved": True})
            run.phase("14-complete-native-operations-export", run.final_export)
            run.phase("15-complete-SQLite-backup-and-independent-reopen", run.backup)
            current_case = run.ops.read(run.case_id)
            current_draft = run.desk.get(run.case_id, run.draft_id)
            run.freeze("final-native-case.json", current_case)
            run.freeze("final-source-draft.json", current_draft)
            run.report["current"] = {"caseId": run.case_id, "caseVersion": current_case["program"]["version"],
                                     "sourceDraftId": run.draft_id, "sourceDraftRevision": current_draft["revision"],
                                     "sourceDraftSha256": value_sha(current_draft)}
            for receipt in run.report["artifacts"].values():
                need(file_receipt(receipt["path"]) == receipt, "An original complete output changed before closure.")
            run.report["state"] = "PASS"
            run.report["resultScope"] = "Complete original-source preparation, native planned Installations, customer-edition comparison and apply, successor preparation, browser receiving and full workspace reopen."
            run.report["commissioning"] = "Original customer acceptance, payment, funding and commissioning state remain unchanged."
            if args.commissioning_receiving is not None:
                run.report["resultScope"] += " Saved merchant capture, explicit original phase receiving and full receipt replay."
    except BaseException as error:
        failure = error
        run.report["state"] = "INTERRUPTED"
        run.report["error"] = {"type": type(error).__name__, "code": getattr(error, "code", None),
                               "status": getattr(error, "status", None), "message": str(error)}
    finally:
        while not run.closed:
            try:
                run.close()
            except BaseException as error:
                failure = failure or error
                run.report["state"] = "INTERRUPTED"
                run.report["closeError"] = {"type": type(error).__name__, "message": str(error)}
                emit({"state": "CLEANUP_PENDING", "error": str(error)})
                time.sleep(0.1)
        # The kernel receiving lease belongs to the outer caller until all
        # descendants have actually left. Diagnostic errors never release it.
        while True:
            try:
                drain_children(); break
            except BaseException as error:
                emit({"state": "CLEANUP_PENDING", "error": str(error)})
                time.sleep(0.1)
        for path in COMMAND_OUTPUTS:
            try:
                run.remember(path)
            except BaseException as error:
                failure = failure or error
                run.report["state"] = "INTERRUPTED"
                run.report["outputError"] = {"path": str(path), "message": str(error)}
        run.report["lifetimes"] = "CLOSED" if run.closed else "UNCONFIRMED"
        try:
            run.save()
        except BaseException as error:
            failure = failure or error
            emit({"state": "REPORT_PUBLICATION_FAILED", "operationId": args.operation_id, "error": str(error)})
    if failure:
        raise failure
    return run.report, file_receipt(run.report_path)


def main(argv=None):
    global LEASE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=Path, help="Distinct private original receiving control/output directory")
    parser.add_argument("--workspace", required=True, type=Path, help="Existing original operating workspace, with its server stopped")
    parser.add_argument("--case", required=True)
    parser.add_argument("--expected-case-version", required=True, type=int)
    parser.add_argument("--selection", required=True, type=Path, help="Complete original native source selection JSON")
    parser.add_argument("--source-root", required=True, type=Path, help="Every exact original selected input at its receiving filename")
    parser.add_argument("--commissioning-receiving", type=Path,
                        help="Optional complete saved merchant capture files and explicit project/Workshare phase mapping")
    parser.add_argument("--scenario", type=Path, default=HERE.parent / "sf10_current_candidate.json")
    parser.add_argument("--actor", required=True)
    parser.add_argument("--operation-id", default="SCF-INSTALLATION-SOURCE-DESK-2769-20261012")
    parser.add_argument("--node", required=True, type=Path)
    parser.add_argument("--browser-module", required=True, type=Path)
    parser.add_argument("--browser-executable", required=True, type=Path)
    args = parser.parse_args(argv)
    need(re.fullmatch(r"operation-[a-f0-9]{32}", args.case) and
         re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", args.operation_id) and args.actor.strip(),
         "Select the original case, bounded receiving identity and actual recording operator.")
    for key in ("selection", "scenario", "node", "browser_module", "browser_executable"):
        setattr(args, key, Path(getattr(args, key)).expanduser().absolute())
    root = directory(args.directory, create=True)
    need(not os.lstat(root).st_mode & 0o077, "Keep the receiving directory private.")
    fd = os.open(root / "receiving.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    prior_handlers = {}
    try:
        info, named = os.fstat(fd), os.lstat(root / "receiving.lock")
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o077 and
             (info.st_dev, info.st_ino) == (named.st_dev, named.st_ino), "Keep the original private receiving lease.")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); LEASE = fd
        if sys.platform.startswith("linux"):
            need(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0,
                 "The receiving owner must retain orphaned native/browser children through closure.")
        for sig in (signal.SIGINT, signal.SIGTERM):
            prior_handlers[sig] = signal.getsignal(sig); signal.signal(sig, stopped)
        report, receipt = run_program(args)
        emit({"schema": SCHEMA, "state": report["state"], "lifetimes": report["lifetimes"],
              "operationId": args.operation_id, "phases": len(report["phases"]),
              "artifacts": len(report["artifacts"]), "report": receipt})
        return 0
    finally:
        while True:
            try:
                drain_children(); break
            except BaseException as error:
                emit({"state": "CLEANUP_PENDING", "error": str(error)})
                time.sleep(0.1)
        for sig, handler in prior_handlers.items():
            signal.signal(sig, handler)
        LEASE = None
        os.close(fd)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BaseException as error:
        if isinstance(error, SystemExit):
            raise
        emit({"schema": SCHEMA, "state": "INTERRUPTED",
              "error": {"type": type(error).__name__, "code": getattr(error, "code", None), "message": str(error)}})
        raise SystemExit(1)
