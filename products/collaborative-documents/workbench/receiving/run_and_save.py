#!/usr/bin/env python3
"""Run the original complete Node receiving programme and save its private case.

Python 3.10+ on POSIX owns this wrapper and unchanged Library helper; the
selected original Node 24 application owns all native and browser work.
The original Library workflow owns prepare, transfer and finalize. Its actual
ordinary result remains separate from diagnostic publication.
"""
from __future__ import annotations

import argparse
import copy
import fcntl
import hashlib
import importlib.util
import json
import os
import signal
import stat
import subprocess
import sys
import time
import uuid
from pathlib import Path

OPERATION = "TIPTAP-HOCUSPOCUS-APPLICATION-WORKSHARE-0C7A-20261012"
INPUT_SCHEMA = "document-workshop.run-and-save-input.v1"
RESULT_SCHEMA = "document-workshop.run-and-save-result.v1"
PURPOSE = "create_library_file"
CHUNK = 1024 * 1024
MAX_INPUT = 64 * 1024 * 1024
HELPERS = {
    "library_hosted_apps.py": (12576, "97d029b097ace62b744c82dfde20ef6921ed543a33a771ecf6452bd655d11b59"),
    "library_file_transfer.py": (11084, "5e1557817be17db06e2375f8c34ed83e948d520242e5ee4cb50a30c7a4c83378"),
    "library_upload.py": (44876, "5bc473dadefe1f68ee8797baaed19d6662642d0ea4bcba128fa12938faa0d767"),
}


class SaveError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def require(value, code, message):
    if not value:
        raise SaveError(code, message)


def diagnostic(error):
    try:
        name = type(error).__name__
        code = getattr(error, "code", None)
        message = str(error)
        return {"name": name, "code": code if isinstance(code, (str, int)) else None,
                "message": message}
    except BaseException:
        return {"name": "ObservationError", "code": None, "message": "The original error could not be rendered."}


def ordinary_json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def strict_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "JSON_DUPLICATE", "An original JSON input repeats a field.")
            result[key] = value
        return result
    return json.loads(raw.decode("utf-8"), object_pairs_hook=unique,
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          SaveError("JSON_NUMBER", "An original JSON number is not finite.")))


def original_path(value, *, directory=False, private=False):
    selected = Path(value)
    require(selected.is_absolute() and ".." not in selected.parts,
            "PATH", "Use the original absolute path without parent traversal.")
    for current in [*reversed(selected.parents), selected]:
        information = current.lstat()
        require(not stat.S_ISLNK(information.st_mode), "PATH_LINK",
                "The selected original path is linked: " + str(current))
        if current != selected or directory:
            require(stat.S_ISDIR(information.st_mode), "PATH_DIRECTORY",
                    "An original path parent is not a directory.")
    if private:
        information = selected.lstat()
        require(information.st_uid == os.getuid() and not information.st_mode & 0o077,
                "PATH_PRIVATE", "Keep the selected original path private: " + str(selected))
    return selected


def original_file(value, *, expected=None, capture=False, private=False, maximum=MAX_INPUT):
    selected = original_path(value)
    number = stream = None
    first = result = None
    try:
        number = os.open(selected, os.O_RDONLY | os.O_NOFOLLOW)
        before = os.fstat(number)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= maximum,
                "FILE_BOUND", "Select a complete bounded regular original file.")
        if private:
            require(before.st_uid == os.getuid() and not before.st_mode & 0o077,
                    "FILE_PRIVATE", "The original selected file must remain private.")
        stream = os.fdopen(number, "rb")
        number = None
        checksum = hashlib.sha256()
        chunks = [] if capture else None
        count = 0
        while True:
            chunk = stream.read(CHUNK)
            if not chunk:
                break
            count += len(chunk)
            require(count <= maximum, "FILE_BOUND", "The original file grew beyond its declared extent.")
            checksum.update(chunk)
            if capture:
                chunks.append(chunk)
        after, current = os.fstat(stream.fileno()), selected.lstat()
        def identity(info):
            return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
                    info.st_ctime_ns, stat.S_IMODE(info.st_mode))
        require(identity(before) == identity(after) == identity(current) and count == before.st_size,
                "FILE_CHANGED", "The selected original file changed while being read.")
        row = {"path": str(selected), "bytes": count, "sha256": checksum.hexdigest()}
        if expected is not None:
            require(type(expected.get("bytes")) is int and expected["bytes"] == count
                    and expected.get("sha256") == row["sha256"],
                    "FILE_CHANGED", "The complete original file differs from its selected bytes.")
        result = (row, b"".join(chunks)) if capture else row
    except BaseException as error:
        first = error
    finally:
        if stream is not None:
            closing, stream = stream, None
            try:
                closing.close()
            except BaseException as error:
                first = first or error
        if number is not None:
            closing, number = number, None
            try:
                os.close(closing)
            except BaseException as error:
                first = first or error
    if first:
        raise first
    return result


def selected_json(binding):
    require(isinstance(binding, dict) and isinstance(binding.get("path"), str),
            "INPUT_BINDING", "Supply the complete original file descriptor.")
    information, raw = original_file(binding["path"], expected=binding,
                                     private=True, capture=True)
    return strict_json(raw), information


def load_native(binding):
    information, raw = original_file(binding["path"], expected=binding, capture=True)
    path = Path(information["path"])
    spec = importlib.util.spec_from_file_location("_document_workshop_private_case", path)
    require(spec is not None and spec.loader is not None,
            "NATIVE_SOURCE", "The selected complete private case adapter is unavailable.")
    module = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        exec(compile(raw, str(path), "exec"), module.__dict__)
    finally:
        sys.dont_write_bytecode = previous
    require(module.OPERATION == OPERATION
            and module.INPUT_SCHEMA == "document-workshop.original-receiver-input.v1"
            and callable(module.package_completed) and callable(module.source_manifest),
            "NATIVE_SOURCE", "Select the original Node receiver's complete private save adapter.")
    return module

class SaveGuard:
    def __init__(self, native, directory, *, create=True):
        self.native = native
        self.root = native.private_directory(directory) if create else original_path(directory, directory=True, private=True)
        self.path = self.root / "run-save.lock"
        self.number = None
        self.information = None
        try:
            self.number = os.open(self.path, os.O_RDWR | os.O_NOFOLLOW | (os.O_CREAT if create else 0), 0o600)
            if self.number < 3:
                moved = fcntl.fcntl(self.number, fcntl.F_DUPFD_CLOEXEC, 3)
                closing, self.number = self.number, moved
                os.close(closing)
            self.information = os.fstat(self.number)
            require(stat.S_ISREG(self.information.st_mode) and self.information.st_uid == os.getuid()
                    and not self.information.st_mode & 0o077,
                    "SAVE_GUARD", "Keep the original save guard private and regular.")
            try:
                fcntl.flock(self.number, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise SaveError("SAVE_ACTIVE", "The same original run/save owner remains active.")
            self.assert_owned()
            if create:
                native.sync_directory(self.root)
        except BaseException as error:
            if self.number is not None:
                closing, self.number = self.number, None
                try:
                    os.close(closing)
                except BaseException:
                    pass
            raise error

    def assert_owned(self):
        require(self.number is not None and self.native.same_inode(os.fstat(self.number), self.information)
                and self.native.same_inode(self.path.lstat(), self.information),
                "SAVE_GUARD_CHANGED", "The original run/save guard changed identity.")

    def close(self):
        first = None
        if self.number is None:
            return
        try:
            self.assert_owned()
        except BaseException as error:
            first = error
        closing, self.number = self.number, None
        try:
            os.close(closing)  # No LOCK_UN; never release another inherited owner.
        except BaseException as error:
            first = first or error
        if first:
            raise first


class Signals:
    def __init__(self, native):
        self.native = native
        self.first = None
        self.number = None
        self.handlers = {}
        self.output_error = None

    def fail(self, error):
        self.first = self.first or error

    def install(self):
        for number in (signal.SIGINT, signal.SIGTERM):
            self.handlers[number] = signal.getsignal(number)
            signal.signal(number, self.receive)

    def receive(self, number, frame):
        if self.number is None:
            self.number = number
        self.fail(SaveError("STOPPED", "The original run/save received " + signal.Signals(number).name + "."))

    def check(self):
        if self.first:
            raise self.first

    def event(self, event, **fields):
        try:
            print(json.dumps({"schema": "document-workshop.run-and-save-progress.v1",
                              "operation": OPERATION, "event": event, "at": self.native.now(), **fields},
                             ensure_ascii=False, separators=(",", ":"), allow_nan=False), flush=True)
        except (OSError, ValueError) as error:
            self.output_error = self.output_error or error
            self.fail(error)

    def restore(self):
        first = None
        for number, handler in self.handlers.items():
            try:
                signal.signal(number, handler)
            except BaseException as error:
                first = first or error
        self.handlers.clear()
        if first:
            raise first


def save_selection(native, native_input, helper_directory, directory):
    require(sys.version_info >= (3, 10), "HELPER_PYTHON",
            "The unchanged selected Library helper requires Python 3.10 or newer.")
    value, input_information = selected_json(native_input)
    native.native_input(value)
    application = original_path(value["source"], directory=True)
    receiving = original_path(value["receivingSource"], directory=True)
    source, source_information, _ = native.source_manifest(application, value["sourceManifest"])
    rows = {row["path"]: row for row in source["files"]}
    module_binding = original_file(application / "receiving" / "private_case.py",
                                   expected=rows["receiving/private_case.py"])
    receiver_binding = original_file(application / "receiving" / "receive.mjs",
                                     expected=rows["receiving/receive.mjs"])
    wrapper_binding = original_file(Path(__file__).resolve(), expected=rows["receiving/run_and_save.py"])
    require(Path(wrapper_binding["path"]) == application / "receiving" / "run_and_save.py",
            "WRAPPER_SOURCE", "Run this wrapper from the selected complete original application source.")
    python_path = original_path(Path(sys.executable).resolve())
    python_binding = original_file(python_path)
    case = original_path(value["directory"], directory=True, private=True)
    target = Path(directory)
    require(target.is_absolute() and ".." not in target.parts, "SAVE_PLACEMENT", "Use an absolute private save directory.")
    for other in (case, application, receiving):
        require(target != other and other not in target.parents and target not in other.parents,
                "SAVE_PLACEMENT", "Keep save state outside both installations and the original operation.")
    helpers = original_path(helper_directory, directory=True, private=True)
    for other in (case, target, application, receiving):
        require(helpers != other and other not in helpers.parents and helpers not in other.parents,
                "HELPER_PLACEMENT", "Keep unchanged helper sources separate from the case, save state and application.")
    helper_rows = []
    for name, expected in sorted(HELPERS.items()):
        row = original_file(helpers / name, private=True,
                            expected={"bytes": expected[0], "sha256": expected[1]})
        helper_rows.append({"path": name, "bytes": row["bytes"], "sha256": row["sha256"]})
    return {
        "schema": INPUT_SCHEMA, "operation": OPERATION, "nativeOperation": native.NATIVE_OPERATION,
        "caseId": value["caseId"], "directory": str(target), "nativeDirectory": str(case),
        "nativeInput": input_information, "nativeModule": module_binding, "receiver": receiver_binding,
        "sourceManifest": native.short_file(source_information), "wrapper": wrapper_binding,
        "pythonExecutable": str(python_path),
        "python": {"bytes": python_binding["bytes"], "sha256": python_binding["sha256"]},
        "helpers": {"directory": str(helpers), "files": helper_rows},
    }


def prepare(args):
    application = original_path(args.source, directory=True)
    manifest_information, manifest_raw = original_file(args.source_manifest, capture=True)
    manifest = strict_json(manifest_raw)
    selected_rows = [row for row in manifest.get("files", []) if row.get("path") == "receiving/private_case.py"]
    require(len(selected_rows) == 1, "NATIVE_SOURCE", "Retain the complete original private case adapter in its manifest.")
    binding = original_file(application / "receiving/private_case.py", expected=selected_rows[0])
    module = load_native(binding)
    module.source_manifest(application, manifest_information)
    # Preparation never installs runtimes or launches a browser.
    case = module.private_directory(args.operation_directory)
    selected_paths = {
        "schema": module.INPUT_SCHEMA, "operation": OPERATION, "nativeOperation": module.NATIVE_OPERATION,
        "source": str(application), "directory": str(case),
        "sourceManifest": manifest_information,
        "node": original_file(args.node, maximum=512 * 1024**2),
        "runtimeReady": original_file(args.runtime_ready),
        "playwright": original_file(args.playwright),
        "chromium": original_file(args.chromium, maximum=512 * 1024**2),
        "receivingSource": str(original_path(args.receiving_source, directory=True)),
        "receivingRuntimeReady": original_file(args.receiving_runtime_ready),
    }
    guard, first, result = None, None, None
    try:
        guard = SaveGuard(module, args.directory)
        input_path, path = guard.root / "NATIVE_INPUT.json", guard.root / "SAVE_INPUT.json"
        if input_path.exists() or input_path.is_symlink():
            existing, _ = module.read_json(input_path)
            require({k: v for k, v in existing.items() if k != "caseId"} == selected_paths,
                    "SAVE_SELECTION_CHANGED", "Continue the same exact original selection.")
            value = existing
        else:
            require({item.name for item in guard.root.iterdir()} <= {"run-save.lock"},
                    "SAVE_DESTINATION", "Select an empty original save directory.")
            value = {**selected_paths, "caseId": uuid.uuid4().hex}
        module.native_input(value)
        module.publish_json(input_path, value)
        input_information = module.short_file(module.inspect_file(input_path, private=True))
        selected = save_selection(module, input_information, args.helpers, args.directory)
        module.publish_json(path, selected)
        result = {"schema": "document-workshop.run-and-save-prepared.v1", "operation": OPERATION,
                  "caseId": selected["caseId"], "input": module.short_file(module.inspect_file(path, private=True))}
    except BaseException as error:
        first = error
    finally:
        if guard is not None:
            try:
                guard.close()
            except BaseException as error:
                first = first or error
    if first:
        raise first
    return result

class NativeChild:
    def __init__(self, owner, attempt, *, recover_completed=False):
        self.owner, self.attempt = owner, attempt
        self.recover_completed = recover_completed
        self.process = None
        self.stdout = self.stderr = None
        self.sent = None
        self.closed = False
        self.first = None
        self.record = None

    def open_log(self, path):
        number = None
        try:
            number = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            if number < 3:
                moved = fcntl.fcntl(number, fcntl.F_DUPFD_CLOEXEC, 3)
                closing, number = number, moved
                os.close(closing)
            stream = os.fdopen(number, "wb", buffering=0)
            number = None
            return stream
        finally:
            if number is not None:
                closing, number = number, None
                os.close(closing)

    def run(self):
        native, selected = self.owner.native, self.owner.value
        native_input, _ = selected_json(selected["nativeInput"])
        argv = [native_input["node"]["path"], selected["receiver"]["path"],
                "--source", native_input["source"],
                "--directory", native_input["directory"],
                "--runtime-ready", native_input["runtimeReady"]["path"],
                "--source-manifest", native_input["sourceManifest"]["path"],
                "--playwright", native_input["playwright"]["path"],
                "--chromium", native_input["chromium"]["path"],
                "--receiving-source", native_input["receivingSource"],
                "--receiving-runtime-ready", native_input["receivingRuntimeReady"]["path"]]
        if self.recover_completed:
            argv.append("--recover-completed")
        elif (Path(native_input["directory"]) / "receiving.json").exists():
            argv.append("--resume")
        native.publish_json(self.attempt / "COMMAND.json", {
            "schema": "document-workshop.run-and-save-command.v1", "operation": OPERATION,
            "caseId": selected["caseId"], "inputSha256": self.owner.input_information["sha256"],
            "argv": argv, "cwd": str(Path(selected["nativeModule"]["path"]).parent),
            "createdAt": native.now(),
        })
        try:
            self.stdout = self.open_log(self.attempt / "native.stdout")
            self.stderr = self.open_log(self.attempt / "native.stderr")
            self.owner.signals.check()
            environment = dict(os.environ)
            environment["PYTHONDONTWRITEBYTECODE"] = "1"
            self.process = subprocess.Popen(argv, stdin=subprocess.DEVNULL,
                stdout=self.stdout, stderr=self.stderr, cwd=Path(selected["nativeModule"]["path"]).parent,
                env=environment, start_new_session=True, close_fds=True)
            native.publish_json(self.attempt / "ACCEPTED.json", {
                "schema": "document-workshop.run-and-save-child.v1", "operation": OPERATION,
                "caseId": selected["caseId"], "pid": self.process.pid, "acceptedAt": native.now(),
                "command": native.short_file(native.inspect_file(self.attempt / "COMMAND.json", private=True)),
            })
            self.owner.signals.event("native_course_started", pid=self.process.pid,
                                     attempt=self.attempt.name, caseId=selected["caseId"])
            return self.wait()
        except BaseException as error:
            self.first = self.first or error
            self.owner.signals.fail(error)
            self.wait()
            raise self.first

    def wait(self):
        if self.closed:
            if self.first:
                raise self.first
            return self.record
        native = self.owner.native
        next_progress = time.monotonic()
        while self.process is not None and self.process.poll() is None:
            if (self.owner.signals.first is not None or self.first is not None) and self.sent is None:
                self.sent = self.owner.signals.number or signal.SIGTERM
                try:
                    self.process.send_signal(self.sent)
                except ProcessLookupError:
                    pass
                except BaseException as error:
                    self.first = self.first or error
            try:
                self.process.wait(timeout=0.25)
            except subprocess.TimeoutExpired:
                pass
            except BaseException as error:
                self.first = self.first or error
                self.owner.signals.fail(error)
            if time.monotonic() >= next_progress:
                self.owner.signals.event("native_course_owned", attempt=self.attempt.name,
                                         pid=self.process.pid, stopForwarded=self.sent is not None)
                next_progress = time.monotonic() + 15
        returncode = self.process.returncode if self.process is not None else None
        rows = {}
        for name in ("stdout", "stderr"):
            stream = getattr(self, name)
            if stream is None:
                continue
            try:
                os.fsync(stream.fileno())
            except BaseException as error:
                self.first = self.first or error
            closing = stream
            setattr(self, name, None)
            try:
                closing.close()
            except BaseException as error:
                self.first = self.first or error
            try:
                rows[name] = native.short_file(native.inspect_file(self.attempt / ("native." + name), private=True,
                                                                  maximum=native.MAX_CASE))
            except BaseException as error:
                self.first = self.first or error
        self.closed = True
        self.record = {"schema": "document-workshop.run-and-save-child-result.v1", "operation": OPERATION,
                       "caseId": self.owner.value["caseId"], "returncode": returncode,
                       "processAccepted": self.process is not None, "processClosed": True,
                       "logs": rows, "closedAt": native.now(),
                       "error": diagnostic(self.first) if self.first else None}
        try:
            native.publish_json(self.attempt / "CHILD_RESULT.json", self.record)
        except BaseException as error:
            self.first = self.first or error
        if returncode not in (None, 0):
            self.first = self.first or SaveError("NATIVE_INTERRUPTED",
                "The same original native course closed with exit status " + str(returncode) + ".")
        if self.first:
            raise self.first
        return self.record

def copy_observed_file(owner, source, destination):
    """Retain the full original closed transfer log in this private attempt."""
    native = owner.native
    native.private_directory(destination.parent)
    source_number = output_number = None
    first = result = None
    target_identity = None
    try:
        source = original_path(source)
        source_number = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
        before = os.fstat(source_number)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= native.MAX_CASE,
                "OBSERVATION_FILE", "The original transfer observation is not a bounded regular file.")
        output_number = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        target_identity = os.fstat(output_number)
        checksum = hashlib.sha256()
        count = 0
        while True:
            chunk = os.read(source_number, CHUNK)
            if not chunk:
                break
            count += len(chunk)
            require(count <= before.st_size, "OBSERVATION_CHANGED", "The original closed transfer log grew.")
            checksum.update(chunk)
            offset = 0
            while offset < len(chunk):
                written = os.write(output_number, chunk[offset:])
                require(written > 0, "OBSERVATION_WRITE", "The complete original transfer observation did not advance.")
                offset += written
        after, current = os.fstat(source_number), source.lstat()
        require(count == before.st_size and native.identity(before) == native.identity(after) == native.identity(current),
                "OBSERVATION_CHANGED", "The original transfer observation changed during its copy.")
        os.fsync(output_number)
        result = {"path": str(destination), "bytes": count, "sha256": checksum.hexdigest()}
    except BaseException as error:
        first = error
    finally:
        for number in (output_number, source_number):
            if number is not None:
                try:
                    os.close(number)
                except BaseException as error:
                    first = first or error
        output_number = source_number = None
    if first:
        # Preserve a partial owned diagnostic, labelled by its absent completed
        # descriptor. Never remove another native or provider-owned file.
        raise first
    native.sync_directory(destination.parent)
    original_file(destination, expected=result, private=True, maximum=native.MAX_CASE)
    return result


class ObservedUploader:
    """Keep original native transfer evidence before its own temporary cleanup."""

    def __init__(self, owner, delegate, directory):
        self.owner, self.delegate, self.directory = owner, delegate, directory

    def upload(self, uploads, state_directory):
        observed_input = None
        result = None
        primary = None
        # Every optional discovery step remains inside its observation try.
        try:
            import shutil
            modes = [{"index": item.request.index, "bytes": item.request.size_bytes,
                      "mode": "estuary" if self.delegate._is_estuary_upload(item) else "signed-url"}
                     for item in uploads]
            executable = None
            if any(row["mode"] == "signed-url" for row in modes):
                found = shutil.which("azcopy")
                if found is None and Path("/usr/local/bin/azcopy").is_file():
                    found = "/usr/local/bin/azcopy"
                if found is not None:
                    actual = Path(found).resolve(strict=True)
                    executable = original_file(actual, maximum=512 * 1024 * 1024)
            observed_input = {"schema": "document-workshop.original-transfer-observation.v1",
                              "operation": OPERATION, "uploads": modes, "executable": executable,
                              "observationAvailable": True}
            self.owner.native.publish_json(self.directory / "INPUT.json", observed_input)
        except BaseException as error:
            self.owner.observe_error("transfer_initial_observation", error)
        try:
            result = self.delegate.upload(uploads, state_directory)
            return result
        except BaseException as error:
            primary = error
            raise
        finally:
            # ThreadPoolExecutor and each original subprocess have already
            # returned through the unchanged delegate. Its surrounding original
            # TemporaryDirectory has not yet removed the native logs/jobs.
            try:
                records = []
                try:
                    sources = self.owner.native.owned_tree_files(state_directory)
                except BaseException as error:
                    self.owner.observe_error("transfer_directory_observation", error)
                    sources = []
                for name, filename in sources:
                    try:
                        records.append(copy_observed_file(self.owner, filename,
                                                          self.directory / "native" / name))
                    except BaseException as error:
                        self.owner.observe_error("transfer_file_observation:" + name, error)
                report = {**(observed_input if observed_input is not None else {
                    "schema": "document-workshop.original-transfer-observation.v1",
                    "operation": OPERATION, "uploads": [], "executable": None, "observationAvailable": False}),
                    "returnedIndices": sorted(result) if result is not None else None,
                    "originalError": diagnostic(primary) if primary is not None else None,
                    "files": records, "observedAt": self.owner.native.now()}
                self.owner.native.publish_json(self.directory / "OUTCOME.json", report)
            except BaseException as error:
                self.owner.observe_error("transfer_final_observation", error)

class ObservedApps:
    """Observe original call_tool objects without changing a delegated outcome."""

    def __init__(self, owner, original, directory):
        self.owner, self.original, self.directory = owner, original, directory
        self.counter = 0

    def retain(self, filename, value):
        try:
            self.owner.native.publish_json(filename, value)
        except BaseException as error:
            self.owner.observe_error("provider_call_publication", error)

    def call_tool(self, connector_id, tool_name, arguments):
        self.counter += 1
        prefix = self.directory / ("%06d" % self.counter)
        # Every observation is best-effort, including construction/serialization
        # of its complete private request. The delegate is still called once.
        try:
            self.retain(Path(str(prefix) + ".REQUEST.json"), {
                "connectorId": connector_id, "toolName": tool_name, "arguments": arguments,
                "observedAt": self.owner.native.now(),
            })
        except BaseException as error:
            self.owner.observe_error("provider_request_observation", error)
        try:
            value = self.original.call_tool(connector_id, tool_name, arguments)
        except BaseException as error:
            try:
                observed = {"kind": "RAISED", "error": diagnostic(error),
                            "observedAt": self.owner.native.now()}
                if hasattr(error, "result"):
                    observed["originalResult"] = error.result
                self.retain(Path(str(prefix) + ".RESPONSE.json"), observed)
            except BaseException as observation_error:
                self.owner.observe_error("provider_exception_observation", observation_error)
            raise
        try:
            self.retain(Path(str(prefix) + ".RESPONSE.json"), {
                "kind": "RETURNED", "value": value, "observedAt": self.owner.native.now()})
        except BaseException as error:
            self.owner.observe_error("provider_response_observation", error)
        return value


class RunAndSave:
    def __init__(self, input_path):
        self.input_information, raw = original_file(input_path, capture=True, private=True)
        self.value = strict_json(raw)
        require(self.value.get("schema") == INPUT_SCHEMA and self.value.get("operation") == OPERATION,
                "SAVE_INPUT", "Select the original complete run/save input.")
        self.native = load_native(self.value["nativeModule"])
        self.signals = Signals(self.native)
        self.guard = None
        self.child = None
        self.provider = self.workflow = None
        self.errors = []
        self.last_result = None
        self.native_result = None

    def observe_error(self, stage, error):
        try:
            self.errors.append({"stage": stage, "error": diagnostic(error), "at": self.native.now()})
        except BaseException:
            pass

    def validate(self, *, create=True):
        selected = save_selection(self.native, self.value["nativeInput"],
                                  self.value["helpers"]["directory"], self.value["directory"])
        require(selected == self.value, "SAVE_SELECTION_CHANGED",
                "The original source, helper, Python, case or save selection changed.")
        require(Path(self.input_information["path"]) == Path(selected["directory"]) / "SAVE_INPUT.json",
                "SAVE_INPUT_PATH", "Use the original retained SAVE_INPUT.json in its selected save directory.")
        self.guard = SaveGuard(self.native, selected["directory"], create=create)
        return selected

    def current_native_result(self):
        value, information = selected_json(self.value["nativeInput"])
        return self.native.package_completed(value, information, self.guard.root, self.guard)

    def run_native(self):
        value, _ = selected_json(self.value["nativeInput"])
        completed = Path(value["directory"]) / "result.json"
        recover_completed = False
        if completed.exists() or completed.is_symlink():
            # Fully validate unchanged original result/input/files before
            # considering the narrowly selected local publication recovery.
            lease = self.native.DirectoryLease(value["directory"])
            first = None
            try:
                self.native.completed_result(value, require_closures=False)
            except BaseException as error:
                first = error
            finally:
                try:
                    lease.close()
                except BaseException as error:
                    first = first or error
            if first:
                raise first
            try:
                self.native_result = self.current_native_result()
            except self.native.CourseError as error:
                if error.code not in ("OWNER_CLOSURE_MISSING", "NATIVE_LOCAL_PUBLICATION_PENDING"):
                    raise
                recover_completed = True
                self.signals.event("closed_native_publication_recovery", caseId=self.value["caseId"],
                                   cause=error.code)
            else:
                self.signals.event("closed_native_course_reused", caseId=self.value["caseId"],
                                   result=self.native_result["file"])
                return None
        directory = self.native.private_directory(self.guard.root / "native-attempts" / uuid.uuid4().hex)
        self.child = NativeChild(self, directory, recover_completed=recover_completed)
        first = None
        try:
            self.child.run()
        except BaseException as error:
            first = error
        finally:
            try:
                self.child.wait()
            except BaseException as error:
                first = first or error
        try:
            self.native_result = self.current_native_result()
        except BaseException as error:
            first = first or error
        if first:
            raise first
        return self.child.record


    def helper_modules(self):
        directory = original_path(self.value["helpers"]["directory"], directory=True, private=True)
        for row in self.value["helpers"]["files"]:
            original_file(directory / row["path"], expected=row, private=True)
        selected_path = str(directory)
        if selected_path not in sys.path:
            sys.path.insert(0, selected_path)
        # These are the original three complete helper sources. Do not adopt a
        # previously loaded same-named module from another source directory.
        for filename in HELPERS:
            name = filename[:-3]
            previous = sys.modules.get(name)
            if previous is not None:
                require(Path(previous.__file__).resolve() == directory / filename,
                        "HELPER_MODULE_CHANGED", "Another source owns the selected helper module: " + name)
        from library_hosted_apps import HostedAppsClient
        from library_file_transfer import LibraryFileMaterializer
        from library_upload import LibraryUploadWorkflow, SignedUrlUploader
        for filename in HELPERS:
            module = sys.modules.get(filename[:-3])
            require(module is not None and Path(module.__file__).resolve() == directory / filename,
                    "HELPER_MODULE_CHANGED", "The original helper import changed its source.")
        return HostedAppsClient, LibraryFileMaterializer, LibraryUploadWorkflow, SignedUrlUploader

    def upload_paths(self, archive):
        root = self.native.private_directory(self.guard.root / "saves" / archive["sha256"])
        binding = {"schema": "document-workshop.private-case-save.v1", "operation": OPERATION,
                   "caseId": self.value["caseId"], "saveInputSha256": self.input_information["sha256"],
                   "nativeInput": self.value["nativeInput"], "archive": archive, "purpose": PURPOSE,
                   "libraryArtifactType": "other"}
        self.native.publish_json(root / "ARCHIVE.json", binding)
        attempts = self.native.private_directory(root / "attempts")
        return root, attempts, binding

    def previous_upload(self, attempts, binding):
        result = None
        paths = sorted(attempts.iterdir(), key=lambda item: item.name)
        for index, path in enumerate(paths, 1):
            require(self.native.re.fullmatch(r"\d{6}-[0-9a-f]{32}", path.name) is not None
                    and int(path.name.split("-", 1)[0]) == index,
                    "SAVE_ATTEMPTS", "Retain the complete ordered original upload attempt set.")
            original_path(path, directory=True, private=True)
            intent_path = path / "INTENT.json"
            if not intent_path.exists():
                require(index == len(paths) and not (path / "ENTERED.json").exists()
                        and not (path / "OUTCOME.json").exists(),
                        "SAVE_ATTEMPT_CHANGED", "An original attempted transfer lost its retained intent.")
                result = {"directory": path, "intent": None, "outcome": None, "entered": False, "sourceClosed": None}
                continue
            intent, _ = self.native.read_json(intent_path)
            require(intent.get("schema") == "document-workshop.private-save-attempt.v1"
                    and intent.get("binding") == binding and intent.get("ordinal") == index
                    and intent.get("attemptId") == path.name,
                    "SAVE_ATTEMPT_CHANGED", "The original transfer attempt belongs to another exact private archive.")
            outcome_path, entered_path = path / "OUTCOME.json", path / "ENTERED.json"
            outcome = None
            if entered_path.exists():
                entered, _ = self.native.read_json(entered_path)
                require(entered.get("schema") == "document-workshop.private-save-entered.v1"
                        and entered.get("attemptId") == path.name
                        and entered.get("intent") == self.native.short_file(self.native.inspect_file(intent_path, private=True)),
                        "SAVE_ATTEMPT_CHANGED", "The original transfer admission record changed.")
            if outcome_path.exists():
                value, information = self.native.read_json(outcome_path)
                require(entered_path.exists() and value.get("schema") == "document-workshop.private-save-outcome.v1"
                        and value.get("attemptId") == path.name and value.get("binding") == binding
                        and value.get("kind") in ("RETURNED", "RAISED"),
                        "SAVE_OUTCOME_CHANGED", "The original ordinary upload outcome changed its exact selection.")
                outcome = {"value": value, "file": self.native.short_file(information)}
            source_closed = self.read_source_closed(path, binding, outcome) if outcome is not None else None
            require(index == len(paths) or (outcome is not None and
                    self.save_result(binding["archive"], outcome, source_closed=source_closed)["state"] == "FAILED"),
                    "SAVE_OUTCOME_UNKNOWN", "A prior original upload is saved or uncertain; reconcile it before another upload.")
            result = {"directory": path, "intent": intent, "outcome": outcome,
                      "entered": entered_path.exists(), "sourceClosed": source_closed}
        return result, len(paths)

    def read_source_closed(self, attempt, binding, outcome):
        filename = attempt / "SOURCE_CLOSED.json"
        if not filename.exists():
            return None
        value, information = self.native.read_json(filename, private=True)
        require(value.get("schema") == "document-workshop.private-save-source-closed.v1"
                and value.get("attemptId") == attempt.name and value.get("binding") == binding
                and value.get("archive") == binding["archive"]
                and value.get("sourceExtentVerified") is True and value.get("fileClosed") is True
                and value.get("outcomeSha256") == hashlib.sha256(ordinary_json(outcome["value"])).hexdigest(),
                "SAVE_SOURCE_CLOSED_CHANGED",
                "The original source-closure receipt differs from its exact archive and delegated outcome.")
        return {"value": value, "file": self.native.short_file(information)}

    @staticmethod
    def succeeded_row(value, archive):
        require(isinstance(value, dict) and isinstance(value.get("results"), list)
                and len(value["results"]) == 1 and isinstance(value["results"][0], dict),
                "HELPER_RESULT", "Retain the unchanged complete one-file Library workflow result.")
        row = value["results"][0]
        require(row.get("local_path") == archive["path"] and row.get("purpose") == PURPOSE,
                "HELPER_RESULT_BINDING", "The original upload result names another local file or purpose.")
        require(row.get("status") in ("succeeded", "failed"), "HELPER_RESULT_STATUS",
                "Keep the original terminal per-item status; an unrecognized result requires reconciliation.")
        if row["status"] == "failed":
            return None
        require(all(isinstance(row.get(key), str) and row[key] for key in ("file_id", "library_file_id", "file_name"))
                and type(row.get("local_metadata_applied")) is bool,
                "HELPER_RESULT_IDENTITY", "The succeeded original upload result has incomplete native file identity.")
        if "current_version_number" in row:
            require(type(row["current_version_number"]) is int and row["current_version_number"] >= 0,
                    "HELPER_RESULT_IDENTITY", "The original saved version identity is invalid.")
        if "warnings" in row:
            require(isinstance(row["warnings"], list) and all(isinstance(item, str) for item in row["warnings"]),
                    "HELPER_RESULT_IDENTITY", "Retain the original helper warning array unchanged.")
        return row

    def save_result(self, archive, outcome, *, reused=False, source_closed=None):
        value = outcome["value"]
        returned = value.get("value") if value["kind"] == "RETURNED" else None
        row = self.succeeded_row(returned, archive) if value["kind"] == "RETURNED" else None
        if source_closed is not None:
            proof = source_closed["value"]
            require(isinstance(source_closed.get("file"), dict)
                    and proof.get("schema") == "document-workshop.private-save-source-closed.v1"
                    and proof.get("attemptId") == value["attemptId"] and proof.get("binding") == value["binding"]
                    and proof.get("archive") == archive and proof.get("sourceExtentVerified") is True
                    and proof.get("fileClosed") is True
                    and proof.get("outcomeSha256") == hashlib.sha256(ordinary_json(value)).hexdigest(),
                    "SAVE_SOURCE_CLOSED_CHANGED", "Keep the actual same-attempt source closure proof.")
        state = "UNKNOWN"
        if row is not None:
            state = "SUCCEEDED" if source_closed is not None else "UNKNOWN"
        elif returned is not None and returned["results"][0].get("error_code") != "commit_unknown":
            state = "FAILED"
        return {"state": state, "archive": archive, "outcome": outcome.get("file"), "reused": reused,
                "ordinaryResult": returned, "originalOutcome": copy.deepcopy(value),
                "raised": value.get("error"), "originalRaisedResult": value.get("originalResult"),
                "sourceClosed": source_closed.get("file") if source_closed is not None else None,
                "sourceVerificationPending": row is not None and source_closed is None,
                "library": copy.deepcopy(row) if row is not None else None}

    def save_archive(self, *, previous_outcome=None, retry_reason=None):
        require(self.native_result is not None, "CLOSED_CASE_UNAVAILABLE",
                "Finish the original native close/packaging before saving its private case.")
        archive = self.native_result["archive"]
        self.guard.assert_owned()
        root, attempts, binding = self.upload_paths(archive)
        prior, count = self.previous_upload(attempts, binding)
        if prior and prior["outcome"]:
            reused = self.save_result(archive, prior["outcome"], reused=True, source_closed=prior["sourceClosed"])
            if reused["state"] == "SUCCEEDED":
                require(previous_outcome is None, "SAVE_ALREADY_SUCCEEDED",
                        "This exact original private archive is already saved; keep its native file identity.")
                return reused
            if previous_outcome is None:
                return reused
            require(prior["outcome"]["file"]["sha256"] == previous_outcome
                    and prior["outcome"]["value"]["kind"] == "RETURNED" and reused["state"] == "FAILED"
                    and isinstance(retry_reason, str) and 8 <= len(retry_reason) <= 4096,
                    "RETRY_SELECTION", "Select the exact known returned failure and record the actual resolved cause or elapsed provider interval.")
            # An operator-selected retry retains the full previous outcome and
            # reason. No returned status, token or diagnostic auto-schedules it.
            prior = None
        elif prior and prior["entered"]:
            raise SaveError("SAVE_OUTCOME_UNKNOWN",
                "The original helper was admitted without a retained full outcome. Reconcile its same private provider calls/state; do not start another upload.")
        else:
            require(previous_outcome is None, "RETRY_SELECTION",
                    "An explicit retry requires the exact previous returned failure.")
        if prior is None:
            attempt = self.native.private_directory(attempts / ("%06d-" % (count + 1) + uuid.uuid4().hex))
            ordinal = count + 1
            intent = None
        else:
            attempt, ordinal, intent = prior["directory"], count, prior["intent"]
        arguments = {"uploads": [{"local_path": archive["path"], "purpose": PURPOSE,
                                  "library_artifact_type": "other"}]}
        if intent is None:
            intent = {"schema": "document-workshop.private-save-attempt.v1", "binding": binding,
                      "attemptId": attempt.name, "ordinal": ordinal, "createdAt": self.native.now(),
                      "arguments": arguments,
                      "retry": {"previousOutcomeSha256": previous_outcome, "reason": retry_reason}
                               if previous_outcome is not None else None}
            self.native.publish_json(attempt / "INTENT.json", intent)
        require(intent.get("arguments") == arguments, "SAVE_ARGUMENTS",
                "Retain the original unchanged one-file workflow input.")
        state_parent = self.native.private_directory(attempt / "helper-state")
        provider_calls = self.native.private_directory(attempt / "provider-calls")
        HostedAppsClient, LibraryFileMaterializer, LibraryUploadWorkflow, SignedUrlUploader = self.helper_modules()
        self.provider = ObservedApps(self, HostedAppsClient(), provider_calls)
        self.workflow = LibraryUploadWorkflow(apps_client=self.provider, materializer=LibraryFileMaterializer(),
            uploader=ObservedUploader(self, SignedUrlUploader(), attempt / "transfer-observation"),
            state_parent=state_parent)
        file_number = None
        first = ordinary = outcome_file = None
        helper_entered = False
        outcome = source_closed = None
        source_extent_verified = file_closed = False
        source_identity = None
        try:
            original_file(archive["path"], expected=archive, private=True, maximum=self.native.MAX_CASE + 128 * 1024 * 1024)
            file_number = os.open(archive["path"], os.O_RDONLY | os.O_NOFOLLOW)
            if file_number < 3:
                moved = fcntl.fcntl(file_number, fcntl.F_DUPFD_CLOEXEC, 3)
                closing, file_number = file_number, moved
                os.close(closing)
            held = os.fstat(file_number)
            require(stat.S_ISREG(held.st_mode), "PRIVATE_CASE_FILE", "Keep the original private ZIP regular.")
            self.guard.assert_owned()
            entered = {"schema": "document-workshop.private-save-entered.v1", "attemptId": attempt.name,
                       "intent": self.native.short_file(self.native.inspect_file(attempt / "INTENT.json", private=True)),
                       "enteredAt": self.native.now()}
            self.native.publish_json(attempt / "ENTERED.json", entered)
            helper_entered = True
            self.signals.event("original_helper_entered", caseId=self.value["caseId"],
                               archiveSha256=archive["sha256"], archiveBytes=archive["bytes"], attempt=attempt.name)
            # The exact original workflow executes once. Signals remain recorded
            # by this wrapper while that owner completes its actual transfer.
            try:
                ordinary = self.workflow.run(arguments)
            except BaseException as error:
                first = error
                outcome = {"schema": "document-workshop.private-save-outcome.v1", "binding": binding,
                           "attemptId": attempt.name, "kind": "RAISED", "error": diagnostic(error),
                           "returnedAt": self.native.now()}
                try:
                    if hasattr(error, "result"):
                        outcome["originalResult"] = error.result
                except BaseException as observation_error:
                    self.observe_error("helper_exception_result", observation_error)
                self.signals.event("original_helper_raised", archiveSha256=archive["sha256"],
                                   attempt=attempt.name, error=diagnostic(error))
            else:
                outcome = {"schema": "document-workshop.private-save-outcome.v1", "binding": binding,
                           "attemptId": attempt.name, "kind": "RETURNED", "value": ordinary,
                           "returnedAt": self.native.now()}
                # Report the actual delegated return before any receipt write.
                # Complete ordinary/private provider objects stay in the private
                # outcome; progress exposes no signed URL, token or account key.
                try:
                    rows = ordinary.get("results", []) if isinstance(ordinary, dict) else []
                    statuses = [row.get("status") if isinstance(row, dict) else None for row in rows]
                    self.signals.event("original_helper_returned", archiveSha256=archive["sha256"],
                                       attempt=attempt.name, statuses=statuses)
                except BaseException as observation_error:
                    self.observe_error("helper_return_observation", observation_error)
            if outcome is not None:
                try:
                    information = self.native.publish_json(attempt / "OUTCOME.json", outcome)
                    outcome_file = self.native.short_file(information)
                except BaseException as observation_error:
                    self.observe_error("helper_outcome_publication", observation_error)
            # Original helper xattrs may legitimately update ctime. Recheck the
            # held inode, mode, size, mtime and complete file bytes independently.
            after, current = os.fstat(file_number), Path(archive["path"]).lstat()
            def same_extent(left, right):
                return (left.st_dev, left.st_ino, left.st_size, left.st_mtime_ns, stat.S_IMODE(left.st_mode)) == (
                        right.st_dev, right.st_ino, right.st_size, right.st_mtime_ns, stat.S_IMODE(right.st_mode))
            require(same_extent(held, after) and same_extent(after, current),
                    "PRIVATE_CASE_CHANGED", "The original private ZIP changed during its delegated upload.")
            original_file(archive["path"], expected=archive, private=True,
                          maximum=self.native.MAX_CASE + 128 * 1024 * 1024)
            after, current = os.fstat(file_number), Path(archive["path"]).lstat()
            require(same_extent(held, after) and same_extent(after, current),
                    "PRIVATE_CASE_CHANGED", "The complete source extent changed before its original descriptor closed.")
            source_identity = {"device": str(after.st_dev), "inode": str(after.st_ino),
                               "bytes": after.st_size, "mtimeNs": str(after.st_mtime_ns),
                               "mode": stat.S_IMODE(after.st_mode)}
            source_extent_verified = True
        except BaseException as error:
            first = first or error
        finally:
            if file_number is not None:
                closing, file_number = file_number, None
                try:
                    os.close(closing)
                    file_closed = True
                except BaseException as error:
                    first = first or error
        if outcome is not None and source_extent_verified and file_closed:
            try:
                self.guard.assert_owned()
                proof = {"schema": "document-workshop.private-save-source-closed.v1",
                         "attemptId": attempt.name, "binding": binding, "archive": archive,
                         "outcomeSha256": hashlib.sha256(ordinary_json(outcome)).hexdigest(),
                         "sourceExtentVerified": True, "fileClosed": True,
                         "identity": source_identity, "verifiedAt": self.native.now()}
                information = self.native.publish_json(attempt / "SOURCE_CLOSED.json", proof)
                source_closed = {"value": proof, "file": self.native.short_file(information)}
            except BaseException as observation_error:
                self.observe_error("source_closure_publication", observation_error)
        if outcome is None:
            if first:
                raise first
            raise SaveError("SAVE_OUTCOME_UNKNOWN", "The original admitted helper has no complete outcome.")
        result = self.save_result(archive, {"value": outcome, "file": outcome_file}, source_closed=source_closed)
        result["attempt"] = str(attempt)
        result["helperEntered"] = helper_entered
        if first is not None:
            result["inspectionError"] = diagnostic(first)
        self.last_result = result
        # A real helper return remains authoritative even if observation or
        # local xattr/receipt inspection fails. Never replace it with an
        # observer-thrown uploader error or silently invoke the helper again.
        return result

def inspection(owner):
    filename = owner.guard.root / "RUN_AND_SAVE_RESULT.json"
    value, information = owner.native.read_json(filename, private=True)
    require(value.get("schema") == RESULT_SCHEMA and value.get("operation") == OPERATION
            and value.get("caseId") == owner.value["caseId"]
            and value.get("input") == owner.input_information,
            "RUN_SAVE_RESULT", "The retained run/save report belongs to another original input.")
    if value.get("native") is not None:
        selected = value["native"]
        owner.native.descriptor(selected["file"], private=True)
        actual = owner.native.inspect_case_archive(selected["archive"]["path"], selected["archive"])
        require(actual == selected["archive"] and actual["caseId"] == owner.value["caseId"]
                and actual["inputSha256"] == owner.value["nativeInput"]["sha256"],
                "RUN_SAVE_ARCHIVE", "The saved report's complete original private ZIP changed.")
    saved = value.get("save")
    if saved and saved.get("outcome"):
        outcome, _, _ = owner.native.selected_file(saved["outcome"], private=True)
        require(outcome.get("schema") == "document-workshop.private-save-outcome.v1"
                and outcome.get("binding", {}).get("archive") == saved["archive"]
                and outcome["binding"].get("saveInputSha256") == owner.input_information["sha256"],
                "SAVE_OUTCOME_CHANGED", "The original saved outcome no longer matches its complete input and archive.")
        proof = owner.read_source_closed(Path(saved["outcome"]["path"]).parent, outcome["binding"],
                                         {"value": outcome, "file": saved["outcome"]})
        actual_saved = owner.save_result(saved["archive"], {"value": outcome, "file": saved["outcome"]},
                                        reused=saved.get("reused", False), source_closed=proof)
        for key in ("state", "archive", "outcome", "ordinaryResult", "originalOutcome", "raised",
                    "originalRaisedResult", "library", "sourceClosed", "sourceVerificationPending"):
            require(actual_saved.get(key) == saved.get(key), "SAVE_OUTCOME_CHANGED",
                    "The original report changed its retained helper " + key + ".")
    require(not (saved and saved.get("state") == "SUCCEEDED") or saved.get("outcome") is not None,
            "SAVE_RECEIPT_PENDING", "The known original save needs its exact outcome receipt reconciled before local completed inspection.")
    return {"result": value, "file": owner.native.short_file(information)}


def run(args):
    owner = RunAndSave(args.input)
    owner.signals.install()
    previous_bytecode = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    first = result = report_file = None
    try:
        owner.validate(create=args.command != "inspect")
        if args.command == "inspect":
            observed = inspection(owner)
            result, report_file = observed["result"], observed["file"]
        else:
            owner.guard.assert_owned()
            invocation = owner.native.private_directory(owner.guard.root / "invocations" / uuid.uuid4().hex)
            owner.native.publish_json(invocation / "INVOCATION.json", {
                "schema": "document-workshop.run-and-save-invocation.v1", "operation": OPERATION,
                "caseId": owner.value["caseId"], "input": owner.input_information,
                "command": args.command, "startedAt": owner.native.now(),
                "retry": {"previousOutcomeSha256": args.previous_outcome, "reason": args.reason}
                         if args.command == "retry-save" else None,
            })
            try:
                if args.command == "run":
                    owner.run_native()
                else:
                    owner.native_result = owner.current_native_result()
            except BaseException as error:
                first = error
            # A stop can arrive after the original complete result was closed.
            # Save that actual completed case; incomplete operations retain
            # their native journal and resume through the original receiver.
            if owner.native_result is not None:
                try:
                    owner.last_result = owner.save_archive(
                        previous_outcome=args.previous_outcome if args.command == "retry-save" else None,
                        retry_reason=args.reason if args.command == "retry-save" else None)
                except BaseException as error:
                    first = first or error
                    owner.observe_error("private_case_save", error)
            status = "COMPLETED" if owner.native_result is not None and \
                owner.native_result["value"]["status"] == "COMPLETED" and \
                owner.last_result is not None and owner.last_result["state"] == "SUCCEEDED" else "INTERRUPTED"
            result = {
                "schema": RESULT_SCHEMA, "operation": OPERATION, "caseId": owner.value["caseId"],
                "status": status, "input": owner.input_information, "invocation": str(invocation),
                "native": owner.native_result, "save": owner.last_result,
                "nativeChild": owner.child.record if owner.child is not None else None,
                "error": diagnostic(first) if first is not None else None,
                "observationErrors": copy.deepcopy(owner.errors), "finishedAt": owner.native.now(),
            }
            try:
                owner.native.publish_json(invocation / "RESULT.json", result)
                published = owner.native.publish_json(owner.guard.root / "RUN_AND_SAVE_RESULT.json", result, replace=True)
                report_file = owner.native.short_file(published)
            except BaseException as error:
                # The original native/helper outcomes above remain unchanged.
                owner.observe_error("run_save_report_publication", error)
                result["observationErrors"] = copy.deepcopy(owner.errors)
            if owner.last_result is not None and owner.last_result["state"] != "SUCCEEDED":
                first = first or SaveError("PRIVATE_SAVE_PENDING",
                    "The original closed case is retained, but its save did not return one succeeded file.")
            if owner.native_result is None:
                first = first or SaveError("NATIVE_CASE_PENDING", "The original native case has not reached a fully closed private snapshot.")
            elif owner.native_result["value"]["status"] != "COMPLETED":
                first = first or SaveError("NATIVE_INTERRUPTED", "The saved original native case remains interrupted.")
    except BaseException as error:
        first = first or error
    finally:
        if owner.child is not None and not owner.child.closed:
            owner.signals.fail(first or SaveError("OWNER_DRAIN", "Retain the original native child through closure."))
            try:
                owner.child.wait()
            except BaseException as error:
                first = first or error
        if owner.guard is not None:
            try:
                owner.guard.close()
            except BaseException as error:
                first = first or error
        try:
            owner.signals.restore()
        except BaseException as error:
            first = first or error
        sys.dont_write_bytecode = previous_bytecode
    first = first or owner.signals.first
    return result, report_file, first


def summary(result, report, error):
    native = result.get("native") if isinstance(result, dict) else None
    saved = result.get("save") if isinstance(result, dict) else None
    row = saved.get("library") if isinstance(saved, dict) else None
    return {
        "schema": "document-workshop.run-and-save-summary.v1", "operation": OPERATION,
        "caseId": result.get("caseId") if isinstance(result, dict) else None,
        "status": result.get("status") if isinstance(result, dict) else "INTERRUPTED",
        "report": report,
        "nativeStatus": native["value"]["status"] if native else None,
        "privateCase": native["archive"] if native else None,
        "saveStatus": saved.get("state") if saved else None,
        "savedFile": {key: row[key] for key in ("file_id", "library_file_id", "file_name",
                       "path", "current_version_number", "local_metadata_applied") if key in row} if row else None,
        "saveOutcome": saved.get("outcome") if saved else None,
        "sourceClosure": saved.get("sourceClosed") if saved else None,
        "sourceVerificationPending": saved.get("sourceVerificationPending") if saved else None,
        "receiptPublicationPending": bool(saved and saved.get("state") == "SUCCEEDED" and
                                         (saved.get("outcome") is None or report is None)),
        "error": diagnostic(error) if error else None,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("prepare", help="Select the complete original installed source, receiving host and private save state")
    for name in ("source", "source-manifest", "operation-directory", "node", "runtime-ready",
                 "playwright", "chromium", "receiving-source", "receiving-runtime-ready", "helpers", "directory"):
        command.add_argument("--" + name, required=True)
    for name in ("run", "save", "inspect", "retry-save"):
        command = commands.add_parser(name, help={
            "run": "Run or continue the original course once, then save its actual closed private case",
            "save": "Save a previously closed original case without starting a native child",
            "inspect": "Verify the retained local report, original archive and helper outcome without network",
            "retry-save": "Explicitly retry one known returned failure after its actual cause or provider interval is resolved",
        }[name])
        command.add_argument("--input", required=True)
        if name == "retry-save":
            command.add_argument("--previous-outcome", required=True, help="Exact SHA-256 of the prior retained full OUTCOME.json")
            command.add_argument("--reason", required=True, help="Actual resolved failure or observed elapsed provider interval")
    args = parser.parse_args(argv)
    previous_umask = os.umask(0o077)
    result = report = first = None
    try:
        if args.command == "prepare":
            result = prepare(args)
            print(json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False), flush=True)
            return 0
        result, report, first = run(args)
        # Full provider responses and logs stay in the original private report;
        # this output is enough to recover the exact file and outcome identity.
        print(json.dumps(summary(result, report, first), ensure_ascii=False,
                         separators=(",", ":"), allow_nan=False), flush=True)
    except BaseException as error:
        first = first or error
        try:
            print(json.dumps({"schema": "document-workshop.run-and-save-error.v1",
                              "operation": OPERATION, "error": diagnostic(first)},
                             ensure_ascii=False, separators=(",", ":")), file=sys.stderr, flush=True)
        except (OSError, ValueError):
            pass
    finally:
        os.umask(previous_umask)
    return 1 if first is not None else 0


if __name__ == "__main__":
    raise SystemExit(main())
