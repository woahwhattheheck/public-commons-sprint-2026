"""Run the complete Risk course under one original managed SF47 host owner.

Source and runtime are selected explicitly. The original domain and browser
companions own their requests. This module owns the inherited guard, original
host, child close, cold reopen and closed-case archive.
"""
from __future__ import annotations
import argparse
import ast
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import zipfile
import uuid

SCHEMA = "stellar-forge.sf47-risk-execution.v1"
STOP = None
CHILD = None


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(value, message):
    if not value:
        raise RuntimeError(message)


def stopped():
    if STOP is not None:
        raise InterruptedError("Original execution stopped by signal " + str(STOP))


def stop(signum, _frame):
    global STOP
    if STOP is None:
        STOP = signum
        if CHILD is not None and CHILD.poll() is None:
            try:
                CHILD.send_signal(signum)
            except ProcessLookupError:
                pass


def sync(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private(path):
    path = Path(path)
    require(path.is_absolute(), "Use an absolute private directory.")
    missing = []
    current = path
    while not current.exists():
        missing.append(current)
        current = current.parent
    require(current.is_dir() and not current.is_symlink(), "The selected parent is not a regular directory.")
    for item in reversed(missing):
        item.mkdir(mode=0o700)
        sync(item.parent)
    require(path.is_dir() and not path.is_symlink(), "Use an actual private directory.")
    require(stat.S_IMODE(path.stat().st_mode) & 0o077 == 0, "The receiving directory must be private.")
    return path


def read(path, maximum=128 * 1024 * 1024):
    path = Path(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= maximum, "Select a bounded regular file.")
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                and len(raw) == before.st_size, "The selected file changed during reading.")
        actual = path.lstat()
        require((actual.st_dev, actual.st_ino) == (before.st_dev, before.st_ino), "The selected path changed.")
        return raw, before


def checked(reference):
    raw, info = read(reference["path"])
    require(len(raw) == reference["bytes"] and sha(raw) == reference["sha256"], "A selected full file differs: " + reference["path"])
    return raw, info


def fingerprint(path, maximum=512 * 1024 * 1024):
    """Verify a complete regular file using a bounded hash window."""
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path,
            "Select an actual nonsymlink runtime or execution source.")
    descriptor = None
    first = None
    result = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= maximum,
                "Select a bounded regular runtime or source.")
        digest = hashlib.sha256()
        size = 0
        while True:
            chunk = os.read(descriptor, 128 * 1024)
            if not chunk:
                break
            size += len(chunk)
            require(size <= maximum, "The selected runtime exceeded its original bound.")
            digest.update(chunk)
        after = os.fstat(descriptor)
        current = path.lstat()
        identity = lambda value: (value.st_dev, value.st_ino, value.st_size,
                                  value.st_mtime_ns, value.st_ctime_ns, value.st_mode)
        require(identity(before) == identity(after) == identity(current) and size == before.st_size,
                "The selected complete runtime changed while hashing.")
        result = ({"path": str(path), "bytes": size, "sha256": digest.hexdigest(),
                   "mode": stat.S_IMODE(before.st_mode)}, before)
    except BaseException as error:
        first = error
    finally:
        if descriptor is not None:
            owned, descriptor = descriptor, None
            try:
                os.close(owned)
            except BaseException as error:
                first = first or error
    if first:
        raise first
    return result


def checked_fingerprint(reference):
    actual, info = fingerprint(reference["path"])
    require(actual["bytes"] == reference["bytes"] and actual["sha256"] == reference["sha256"],
            "The complete selected runtime identity differs: " + reference["path"])
    if "mode" in reference:
        mode = reference["mode"]
        mode = int(mode, 8) & 0o777 if isinstance(mode, str) else mode
        require(actual["mode"] == mode, "The selected runtime or correction mode differs.")
    return actual, info


def simple_reference(reference):
    return {key: reference[key] for key in ("path", "bytes", "sha256")}


def continuation_directory(config, reference):
    return Path(config["outputDirectory"]) / "execution-continuations" / reference["sha256"]


def validate_execution_continuation(config, manifest, reference):
    require(isinstance(reference, dict), "Select the complete execution continuation descriptor.")
    raw, _ = checked(reference)
    document = json.loads(raw)
    require(document.get("schema") == "stellar-forge.sf47-risk-execution-continuation.v1"
            and document.get("operationId") == config["operationId"]
            and isinstance(document.get("reason"), str) and document["reason"].strip(),
            "Use the explicit same-operation execution continuation.")
    original = document["original"]
    require(simple_reference(original["sourceManifest"]) == simple_reference(config["sourceManifest"]),
            "Retain the original complete application selection.")
    checked(original["sourceManifest"])
    original_input, _ = checked(original["executionInput"])
    require(json.loads(original_input) == config, "The original frozen execution input changed.")
    output = Path(config["outputDirectory"])
    expected_paths = {"executionSelection": output / "EXECUTION_SELECTION.json",
                      "executionJournal": output / "EXECUTION_JOURNAL.json",
                      "browserSelection": output / "browser/SELECTION.json",
                      "browserJournal": output / "browser/risk-browser-journal.json"}
    for key, expected in expected_paths.items():
        require(Path(original[key]["path"]) == expected and expected.resolve(strict=True) == expected,
                "The continuation selects another original case member: " + key)
    execution_selection, _ = checked(original["executionSelection"])
    require(json.loads(execution_selection) == {"schema": SCHEMA, "config": config},
            "The original execution selection differs.")
    browser_selection, _ = checked(original["browserSelection"])
    browser = json.loads(browser_selection)
    native_path = output / "course/risk-course-browser.json"
    require(Path(browser["native"]["path"]) == native_path,
            "The browser must retain its original native course handover.")
    native = json.loads(checked(browser["native"])[0])
    require(native.get("schema") == "stellar-forge.sf47-delivery-risks-course.v1.result"
            and native.get("status") == "PASS" and browser["operationId"] == native["operationId"]
            and browser["repositoryRoot"] == config["repositoryRoot"]
            and simple_reference(browser["sourceManifest"]) == simple_reference(config["sourceManifest"])
            and browser["outputDirectory"] == str(output / "browser"),
            "Retain the same original browser operation and source selection.")
    root = Path(config["repositoryRoot"]).resolve(strict=True)
    selected = {row["path"]: row for row in manifest["files"]}
    expected_names = {"python": "operations_risks_execution.py", "node": config["browserScript"]}
    require(set(document["corrections"]) == set(expected_names), "Select the two complete execution corrections.")
    prefix = "stellar/scf_2026/sf47_budget_model/workspace/"
    for language, name in expected_names.items():
        correction = document["corrections"][language]
        relative = prefix + name
        require(correction["repositoryPath"] == relative and relative in selected,
                "The correction changed the selected original execution leaf.")
        before = correction["original"]
        row = selected[relative]
        require(Path(before["path"]) == root / relative
                and before["bytes"] == row["bytes"] and before["sha256"] == row["sha256"],
                "The correction does not bind its complete original source.")
        checked_fingerprint(before)
        current = correction["current"]
        target = Path(current["path"])
        require(target.is_absolute() and target.resolve(strict=True) == target
                and target.name == name and not target.is_relative_to(root)
                and not target.is_relative_to(output),
                "Keep the complete corrected execution source separate from original source and case.")
        require(current.get("mode") in (0o600, 0o644, 0o700, 0o755),
                "Bind the complete corrected source mode.")
        checked_fingerprint(current)
    require(Path(__file__).resolve(strict=True) == Path(document["corrections"]["python"]["current"]["path"]),
            "Run the explicitly selected complete Python correction.")
    record = {"reference": simple_reference(reference), "document": document}
    directory = continuation_directory(config, reference)
    retained = directory / "ADOPTED.json"
    if retained.exists():
        adopted, _ = read(retained)
        require(json.loads(adopted) == {
            "schema": "stellar-forge.sf47-risk-execution-continuation-adopted.v1",
            "executionContinuation": record}, "The retained execution adoption differs.")
    for key, filename in (("browserJournal", "prior-browser-journal.json"),
                          ("executionJournal", "prior-execution-journal.json")):
        snapshot = directory / filename
        source = snapshot if snapshot.exists() else Path(original[key]["path"])
        require(source.resolve(strict=True) == source, "The prior journal snapshot traverses a symlink.")
        checked({**original[key], "path": str(source)})
    return record


def retain_execution_continuation(config, manifest, reference):
    # No receiving journal is changed until both exact predecessors and the
    # complete sidecar have been published and verified under the original guard.
    record = validate_execution_continuation(config, manifest, reference)
    directory = private(continuation_directory(config, reference))
    original = record["document"]["original"]
    for key, filename in (("browserJournal", "prior-browser-journal.json"),
                          ("executionJournal", "prior-execution-journal.json")):
        target = directory / filename
        source = target if target.exists() else Path(original[key]["path"])
        raw, _ = checked({**original[key], "path": str(source)})
        publish(target, raw)
    raw, _ = checked(reference)
    publish(directory / "execution-continuation.json", raw)
    publish(directory / "ADOPTED.json", encoded({
        "schema": "stellar-forge.sf47-risk-execution-continuation-adopted.v1",
        "executionContinuation": record}))
    sync(directory)
    sync(directory.parent)
    sync(directory.parent.parent)
    validate_execution_continuation(config, manifest, reference)
    return record


def publish(path, raw, *, replace=False):
    path = Path(path)
    private(path.parent)
    if not replace and path.exists():
        actual, _info = read(path)
        require(actual == raw, "A retained immutable file differs: " + str(path))
        sync(path.parent)
        return
    descriptor = None
    temporary = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
        owned, descriptor = descriptor, None
        with os.fdopen(owned, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            os.replace(temporary, path)
        else:
            os.link(temporary, path)
            os.unlink(temporary)
        temporary = None
        sync(path.parent)
    finally:
        if descriptor is not None:
            owned, descriptor = descriptor, None
            os.close(owned)
        if temporary is not None and os.path.exists(temporary):
            os.unlink(temporary)


def descriptor(path):
    raw, info = read(path)
    return {"path": str(Path(path).resolve()), "bytes": len(raw), "sha256": sha(raw), "mode": stat.S_IMODE(info.st_mode)}


class Guard:
    def __init__(self, path):
        self.path, self.fd = Path(path), None
        try:
            self.fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            info = os.fstat(self.fd)
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "Use one original regular execution guard.")
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.identity = (info.st_dev, info.st_ino)
            self.assert_owned()
        except BaseException:
            try:
                self.close()
            except BaseException:
                pass
            raise

    def assert_owned(self):
        require(self.fd is not None, "The original guard is closed.")
        info = self.path.lstat()
        require((info.st_dev, info.st_ino) == self.identity, "The original guard path changed.")

    def wire(self):
        self.assert_owned()
        return {"path": str(self.path), "fd": self.fd,
                "device": str(self.identity[0]), "inode": str(self.identity[1])}

    def close(self):
        if self.fd is None:
            return
        failure = None
        try:
            if hasattr(self, "identity"):
                self.assert_owned()
        except BaseException as error:
            failure = error
        owned, self.fd = self.fd, None
        try:
            os.close(owned)
        except BaseException as error:
            failure = failure or error
        if failure:
            raise failure


def verify_source(config, execution_continuation=None):
    raw, _ = checked(config["sourceManifest"])
    manifest = json.loads(raw)
    root = Path(config["repositoryRoot"]).resolve(strict=True)
    require(root.is_dir(), "Use the selected complete repository root.")
    actual = {}
    for row in manifest["files"]:
        relative = Path(row["path"])
        require(not relative.is_absolute() and ".." not in relative.parts and str(relative) == row["path"],
                "Use canonical repository-relative source paths.")
        target = root / relative
        require(target.resolve(strict=True) == target, "Source selection may not traverse a symlink.")
        data, info = read(target)
        require(len(data) == row["bytes"] and sha(data) == row["sha256"], "The complete source member differs: " + row["path"])
        if "mode" in row:
            mode = row["mode"]
            mode = int(mode, 8) & 0o777 if isinstance(mode, str) else mode
            require(stat.S_IMODE(info.st_mode) == mode, "The source mode differs.")
        require(row["path"] not in actual, "The source manifest repeats a member.")
        actual[row["path"]] = row
    workspace_path = "stellar/scf_2026/sf47_budget_model/workspace"
    workspace = root / workspace_path
    source = read(workspace / "managed_launch.py")[0]
    module = ast.parse(source)
    values = [node.value for node in module.body if isinstance(node, ast.Assign)
              and any(isinstance(target, ast.Name) and target.id == "BOOT_FILES" for target in node.targets)]
    if values:
        require(len(values) == 1, "Use the original literal managed source selection.")
        boot = ast.literal_eval(values[0])
    else:
        from managed_source import manifest_selector
        def selected_manifest():
            name = workspace_path + "/managed-source.json"
            raw = read(root / name)[0]
            require(name in actual and len(raw) == actual[name]["bytes"] and
                    sha(raw) == actual[name]["sha256"], "The selected managed manifest changed.")
            return raw
        boot, _manifest_raw = manifest_selector(source, selected_manifest)
    for name in boot:
        selected = (workspace / name).resolve(strict=True)
        require(selected.is_relative_to(root), "Managed source lies outside the selected repository.")
        require(selected.relative_to(root).as_posix() in actual, "The manifest omits an original managed source member.")
    require(Path(config["browserScript"]).name == config["browserScript"] and config["browserScript"].endswith(".mjs"),
            "Use the selected workspace browser companion filename.")
    required = ["operations_walkthrough.py", "operations_risks_walkthrough.py",
                "RISK_REGISTER_RECEIVING.md", "operations_risks_execution.py",
                config["browserScript"]]
    for name in required:
        require((workspace / name).relative_to(root).as_posix() in actual, "The manifest omits receiving source: " + name)
    if execution_continuation is None:
        require(Path(__file__).resolve() == workspace / "operations_risks_execution.py", "Run the selected execution source.")
    else:
        validate_execution_continuation(config, manifest, execution_continuation)
    checked(config["scenario"])
    for key in ("node", "python"):
        _identity, info = checked_fingerprint(config[key])
        require(stat.S_IMODE(info.st_mode) & 0o111, "Use an executable selected runtime.")
    require(Path(sys.executable).resolve() == Path(config["python"]["path"]).resolve(),
            "The selected Python executable differs from this process.")
    browser = config["browser"]
    for key, digest_key in (("playwrightModule", "playwrightSha256"), ("executablePath", "executableSha256")):
        identity, _ = fingerprint(browser[key])
        require(identity["sha256"] == browser[digest_key], "The selected browser runtime differs.")
    library = config.get("library")
    if library is not None:
        helper_root = Path(library["helperDirectory"]).resolve(strict=True)
        expected_names = {"library_upload.py", "library_hosted_apps.py", "library_file_transfer.py"}
        require({Path(row["path"]).name for row in library["files"]} == expected_names,
                "Use all three unchanged current Library helpers.")
        for row in library["files"]:
            require(Path(row["path"]).resolve().parent == helper_root, "Keep the complete helper cohort together.")
            checked(row)
    return root, workspace, manifest


class Owner:
    def __init__(self, config, output, guard, execution_continuation=None):
        self.config, self.output, self.guard = config, output, guard
        self.execution_continuation = execution_continuation
        self.state_path = output / "EXECUTION_JOURNAL.json"
        self.selection = {"schema": SCHEMA, "config": config}
        publish(output / "EXECUTION_SELECTION.json", encoded(self.selection))
        self.state = json.loads(read(self.state_path)[0]) if self.state_path.exists() else {
            "schema": SCHEMA, "operationId": config["operationId"], "selectionSha256": sha(encoded(self.selection)),
            "attempts": [], "hostLifetimes": []}
        require(self.state["selectionSha256"] == sha(encoded(self.selection)), "Resume this exact original execution.")
        self.host = self.workspace_owner = self.thread = None
        self.thread_error = None
        retained_execution = self.state.get("executionContinuation")
        require(retained_execution is None or retained_execution == execution_continuation,
                "Resume the same declared execution correction.")
        if execution_continuation is not None:
            self.state["executionContinuation"] = execution_continuation
        self.save()

    def save(self):
        self.guard.assert_owned()
        publish(self.state_path, encoded(self.state), replace=True)

    def host_start(self, workspace_source):
        stopped()
        require(self.host is None and self.workspace_owner is None, "Close the original host before reopening.")
        sys.path.insert(0, str(workspace_source))
        import server
        import managed_launch
        self.server_module, self.launch_module = server, managed_launch
        scenario = self.config["scenario"]["path"]
        workspace_dir = self.output / "workspace"
        selected, source_sha = managed_launch.selection(workspace_dir, scenario, workspace_source)
        selected, source_sha, execution = managed_launch.require_selection(
            workspace_dir, scenario, source_sha, workspace_dir / "open-workspace.html", workspace_source)
        def retain_workspace(value):
            self.workspace_owner = value
        def retain_host(value):
            self.host = value
        try:
            host = server.create_server(workspace_dir, scenario, self.state.get("port", 0),
                workspace_dir / "open-workspace.html", on_workspace=retain_workspace, on_created=retain_host)
            self.host = host
            if "origin" in self.state:
                require(host.origin == self.state["origin"], "The cold reopen must retain the original origin.")
            else:
                self.state["origin"], self.state["port"] = host.origin, host.server_port
                self.save()
            announcement = managed_launch.retain_launch(host, selected, source_sha, execution, server.atomic_private)
            lifetime = {"instanceId": host.managed_launch["instanceId"], "origin": host.origin,
                        "selectionSha256": source_sha, "state": "LISTENING", "pid": os.getpid()}
            self.state["hostLifetimes"].append(lifetime)
            self.save()
            def serve():
                try:
                    host.serve_forever(poll_interval=0.1)
                except BaseException as error:
                    self.thread_error = error
            self.thread = threading.Thread(target=serve, name="risk-original-host", daemon=False)
            self.thread.start()
            return host
        except BaseException:
            try:
                self.host_close()
            except BaseException:
                pass
            raise

    def host_close(self):
        errors = []
        host, thread, workspace = self.host, self.thread, self.workspace_owner
        server_closed = host is None
        if host is not None:
            host.managed_stopping = True
            try:
                if thread is not None and thread.is_alive():
                    host.shutdown()
                if thread is not None and thread.ident is not None:
                    thread.join()
            except BaseException as error:
                errors.append(error)
            try:
                host.server_close()
                server_closed = True
            except BaseException as error:
                errors.append(error)
            try:
                if getattr(host, "managed_launch", None) is not None:
                    self.launch_module.retire_launch(host, self.server_module.atomic_private)
            except BaseException as error:
                errors.append(error)
        if workspace is not None and server_closed:
            try:
                workspace.close()
            except BaseException as error:
                errors.append(error)
        # Original server_close joins every non-daemon handler; before any
        # request its _NoThreads sentinel is deliberately not iterable.
        socket_closed = host is None or host.socket.fileno() < 0
        closed = (server_closed and socket_closed and (thread is None or not thread.is_alive())
                  and (workspace is None or workspace.db is None and workspace.lock_handle is None))
        if closed:
            self.host = self.thread = self.workspace_owner = None
            if self.state["hostLifetimes"] and self.state["hostLifetimes"][-1]["state"] == "LISTENING":
                self.state["hostLifetimes"][-1]["state"] = "CLOSED"
                try:
                    self.save()
                except BaseException as error:
                    errors.append(error)
        if self.thread_error is not None:
            errors.insert(0, self.thread_error)
            self.thread_error = None
        if errors:
            raise errors[0]
        require(closed, "The original host or workspace owner remains live.")

    def child(self, name, argv, *, input_value=None):
        global CHILD
        stopped()
        self.guard.assert_owned()
        index = len(self.state["attempts"]) + 1
        folder = private(self.output / "attempts" / ("%04d-" % index + name))
        if input_value is not None:
            publish(folder / "input.json", encoded(input_value))
            argv = [*argv, "--input", str(folder / "input.json")]
        row = {"phase": name, "directory": str(folder.relative_to(self.output)),
               "argv": argv, "state": "PREPARED"}
        self.state["attempts"].append(row)
        self.save()
        child = None
        first = None
        try:
            with open(folder / "stdout.log", "xb", buffering=0) as out, open(folder / "stderr.log", "xb", buffering=0) as err:
                os.chmod(folder / "stdout.log", 0o600); os.chmod(folder / "stderr.log", 0o600)
                child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                    pass_fds=(self.guard.fd,), env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1",
                    "SF47_SUPPORT_NODE": self.config["node"]["path"], "SF47_BUYER_NODE": self.config["node"]["path"]})
                CHILD = child
                if STOP is not None:
                    child.send_signal(STOP)
                row.update(state="RUNNING", pid=child.pid)
                self.save()
                code = child.wait()
                os.fsync(out.fileno()); os.fsync(err.fileno())
                row.update(state="CLOSED", exitCode=code)
                self.save()
                stopped()
                require(code == 0, "Original " + name + " exited " + str(code) + "; retain its complete attempt logs.")
        except BaseException as error:
            first = error
        finally:
            if child is not None and child.poll() is None:
                try:
                    child.send_signal(STOP or signal.SIGTERM)
                    # The browser owns Chromium and downloads. Retain it through
                    # its actual close; do not kill this nested owner on a timer.
                    child.wait()
                except BaseException as error:
                    first = first or error
            CHILD = None
            if child is not None and row.get("state") != "CLOSED":
                row.update(state="CLOSED", exitCode=child.returncode)
                try:
                    self.save()
                except BaseException as error:
                    first = first or error
        if first:
            raise first
        return folder

    def course(self, workspace_source, *, verify=False):
        require(self.host is not None, "Use the original live host.")
        course_output = private(self.output / "course")
        plans = self.host.workspace.list()
        if "planId" not in self.state:
            supplied = self.config.get("planId")
            require(supplied in {p["id"] for p in plans} if supplied else len(plans) == 1,
                    "Select the actual original plan explicitly when there is more than one.")
            self.state["planId"] = supplied or plans[0]["id"]
            self.save()
        argv = [self.config["python"]["path"], "-B", str(workspace_source / "operations_risks_walkthrough.py"),
            "--url", self.host.origin, "--access-key-file", str(self.output / "workspace/access.key"),
            "--plan", self.state["planId"], "--output", str(course_output),
            "--source-manifest", self.config["sourceManifest"]["path"]]
        if verify:
            argv.append("--verify")
        self.child("cold-reopen" if verify else "native-course", argv)
        return course_output

    def browser(self, workspace_source, course_output):
        input_value = {"schema": "stellar-forge.sf47-delivery-risks-browser.v1.input",
            "node": self.config["node"], "repositoryRoot": self.config["repositoryRoot"],
            "sourceManifest": self.config["sourceManifest"], "native": descriptor(course_output / "risk-course-browser.json"),
            "outputDirectory": str(private(self.output / "browser")), "browser": self.config["browser"],
            "ownerKeyFile": str(self.output / "workspace/access.key"), "parentGuard": self.guard.wire()}
        script = workspace_source / self.config["browserScript"]
        if self.execution_continuation is not None:
            input_value["executionContinuation"] = self.execution_continuation["reference"]
            script = Path(self.execution_continuation["document"]["corrections"]["node"]["current"]["path"])
        self.child("browser", [self.config["node"]["path"], str(script), "run"], input_value=input_value)
        return self.verify_browser(workspace_source, course_output)

    def verify_browser(self, workspace_source, course_output):
        from operations_risks_walkthrough import verified_archive
        import operations_risks
        root = self.output / "browser"
        result = json.loads(read(root / "risk-browser-result.json")[0])
        native = json.loads(read(course_output / "risk-course-browser.json")[0])
        require(result.get("executionContinuation") == self.execution_continuation,
                "The completed browser result changed its explicit execution source.")
        journal = json.loads(read(root / "risk-browser-journal.json")[0])
        require(journal.get("executionContinuation") == self.execution_continuation,
                "The retained browser journal changed its explicit execution source.")
        require(result.get("schema") == "stellar-forge.sf47-delivery-risks-browser.v1.result"
                and result.get("status") == "COMPLETED", "Complete the original browser course.")
        for key in ("operationId", "installationId", "originalCaseId", "receivedCaseId",
                    "reorderedReceivedCaseId", "firstReviewId", "secondReviewId"):
            require(result[key] == native[key], "The browser changed the original native selection: " + key)
        simple = lambda row: {key: row[key] for key in ("path", "bytes", "sha256")}
        require(result["source"] == simple(self.config["sourceManifest"])
                and result["native"] == simple(descriptor(course_output / "risk-course-browser.json")),
                "The browser changed its source/native descriptors.")
        selection = read(root / "SELECTION.json")[0]
        require(sha(selection) == result["selectionSha256"], "The browser selection hash differs.")
        seen = {}
        def member(row):
            name = Path(row["path"])
            require(not name.is_absolute() and ".." not in name.parts and name.as_posix() == row["path"],
                    "Use original output-relative browser members.")
            path = root / name
            require(path.resolve(strict=True) == path, "Browser output traverses a symlink.")
            return checked({**row, "path": str(path)})[0]
        for row in result["files"]:
            require(row["path"] not in seen, "The browser result repeats a member.")
            member(row)
            seen[row["path"]] = row
        closed = json.loads(member(result["closure"]))
        require(closed["schema"] == "stellar-forge.sf47-delivery-risks-browser.v1.closed"
                and closed["status"] == "CLOSED" and closed["outcome"] == "COMPLETED"
                and closed["selectionSha256"] == result["selectionSha256"]
                and closed["attemptId"] == result["attemptId"]
                and all(closed["owners"].get(key) is True for key in
                        ("browser", "contexts", "downloads", "tasks", "files", "guard")),
                "The actual browser owners have not all closed.")
        require(closed.get("executionContinuation") == self.execution_continuation,
                "The closed browser owner changed its execution continuation.")
        candidate = json.loads(checked(closed["candidate"])[0])
        require(candidate == {k: v for k, v in result.items() if k not in ("closure", "attemptId")},
                "The browser result differs from its closed immutable candidate.")
        original_files = verified_archive(read(course_output / "risk-course-original.zip")[0])
        originals = {row["id"]: row for row in json.loads(original_files["operations.json"])["reviews"]}
        second = originals[native["secondReviewId"]]
        expected = {native["originalCaseId"]: result["thirdReviewId"],
                    native["receivedCaseId"]: native["secondReviewId"],
                    native["reorderedReceivedCaseId"]: native["secondReviewId"]}
        observed = {}
        for row in result["exports"]:
            path = Path(row["path"])
            require(path.is_relative_to(root) and path.resolve(strict=True) == path,
                    "An original browser export left its owned result root.")
            name = path.relative_to(root).as_posix()
            require(name in seen and simple({**row, "path": name}) == simple(seen[name]),
                    "An original browser export is not in its complete file manifest.")
            files = verified_archive(checked(row)[0])
            document = json.loads(files["operations.json"])
            case_id = document["program"]["id"]
            require(case_id in expected and case_id not in observed, "Unexpected or repeated browser case export.")
            review_id = expected[case_id]
            reviews = {review["id"]: review for review in document["reviews"]}
            for rid in (native["firstReviewId"], native["secondReviewId"]):
                require(reviews.get(rid) == originals[rid], "A browser export changed an original native edition.")
            selected = reviews[review_id]
            operations_risks.validate_review(selected)
            choice = json.loads(files["risk-register-selection.json"])
            require(choice["reviewId"] == review_id and choice["reviewSha256"] == selected["sha256"]
                    and choice["originalProgramId"] == selected["riskRegister"]["source"]["programId"]
                    and json.loads(files["risk-register.json"]) == selected["riskRegister"],
                    "The browser selected risk document differs from its original review.")
            if case_id == native["originalCaseId"]:
                require(selected["riskRegister"]["document"]["supersedes"] ==
                        {"reviewId": second["id"], "reviewSha256": second["sha256"]},
                        "The browser's third edition changed its original predecessor.")
                events = [event for event in document["events"] if event["requestId"] == result["thirdRequestId"]]
                require(len(events) == 1 and events[0]["recordId"] == review_id
                        and events[0]["action"] == "risk-register.save"
                        and result["steps"]["lead"]["receipt"]["recordId"] == review_id
                        and result["steps"]["lead"]["receipt"]["reviewSha256"] == selected["sha256"],
                        "The browser's third edition differs from its original accepted request.")
            else:
                require(selected == second, "Independent receiving changed the immutable second edition.")
            observed[case_id] = {"reviewId": review_id, "reviewSha256": selected["sha256"], "archive": simple(row)}
        require(set(observed) == set(expected), "Retain all three complete native browser exports.")
        receipt = {"schema": SCHEMA + ".browser-archives", "result": descriptor(root / "risk-browser-result.json"),
                   "selectionSha256": result["selectionSha256"], "cases": observed}
        publish(root / "NATIVE_ARCHIVE_VERIFICATION.json", encoded(receipt))
        return descriptor(root / "NATIVE_ARCHIVE_VERIFICATION.json")

    def archive(self, outcome):
        require(self.host is None and self.workspace_owner is None and self.thread is None, "Close original owners before archiving.")
        files = []
        for category in ("workspace", "course", "browser", "attempts", "execution-continuations"):
            root = self.output / category
            if not root.exists():
                continue
            for path in sorted(root.rglob("*")):
                # The actual companion uses chromium-profile beneath attempts.
                if category == "browser" and "chromium-profile" in path.relative_to(root).parts:
                    continue
                if path.is_symlink():
                    raise RuntimeError("A private case member is a symlink.")
                if path.is_dir():
                    continue
                # Browser profiles and screenshots are operational scratch.
                relative = path.relative_to(self.output).as_posix()
                if category == "browser" and any(p in {"profile", "profiles", "screenshots", "cache"} for p in path.relative_to(root).parts):
                    continue
                raw, info = read(path)
                files.append((relative, raw, stat.S_IMODE(info.st_mode)))
        for name in ("EXECUTION_SELECTION.json", "EXECUTION_JOURNAL.json"):
            raw, info = read(self.output / name)
            files.append((name, raw, stat.S_IMODE(info.st_mode)))
        index = {"schema": SCHEMA + ".closed-case", "operationId": self.config["operationId"], "outcome": outcome,
            "source": self.config["sourceManifest"], "repositoryRoot": self.config["repositoryRoot"],
            "codeStorage": "Repository-backed source is retained in Git; only source selection and case artifacts are included.",
            "files": [{"path": name, "bytes": len(raw), "sha256": sha(raw), "mode": mode} for name, raw, mode in files]}
        sequence = 1
        while (self.output / ("Delivery_Risks_Closed_Case_%04d.zip" % sequence)).exists():
            sequence += 1
        target = self.output / ("Delivery_Risks_Closed_Case_%04d.zip" % sequence)
        members = [*files, ("CLOSED_CASE.json", encoded(index), 0o600)]
        if target.exists():
            self.verify_archive(target, members)
            return descriptor(target)
        fd = temporary = None
        try:
            fd, temporary = tempfile.mkstemp(prefix=".closed-case-", dir=self.output)
            owned, fd = fd, None
            with os.fdopen(owned, "w+b") as stream:
                os.fchmod(stream.fileno(), 0o600)
                with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    for name, raw, mode in members:
                        item = zipfile.ZipInfo(name)
                        item.external_attr = (stat.S_IFREG | mode) << 16
                        item.compress_type = zipfile.ZIP_DEFLATED
                        archive.writestr(item, raw)
                stream.flush(); os.fsync(stream.fileno())
            self.verify_archive(Path(temporary), members)
            os.link(temporary, target)
            os.unlink(temporary); temporary = None
            sync(self.output)
            return descriptor(target)
        finally:
            if fd is not None:
                owned, fd = fd, None
                os.close(owned)
            if temporary is not None and os.path.exists(temporary):
                os.unlink(temporary)

    def save_archive(self, archive):
        library = self.config.get("library")
        if library is None:
            return {"state": "LOCAL_CLOSED_ARTIFACT", "archive": archive}
        saved_path = self.output / (Path(archive["path"]).stem + "-saved.json")
        if saved_path.exists():
            saved = json.loads(read(saved_path)[0])
            require(saved["archive"] == archive, "The saved result belongs to another closed archive.")
            return saved
        root = private(self.output / "upload-state")
        completed = []
        for folder in sorted(root.iterdir()):
            if not folder.is_dir():
                continue
            request_file, result_file = folder / "request.json", folder / "result.json"
            if request_file.exists() and not result_file.exists():
                raise RuntimeError("Reconcile the retained original upload attempt before another save: " + str(request_file))
            if result_file.exists():
                prior = json.loads(read(result_file)[0])
                retained_archive = json.loads(read(folder / "archive.json")[0])
                if retained_archive == archive:
                    rows = prior.get("results", [])
                    if len(rows) == 1 and rows[0].get("status") == "succeeded" and rows[0].get("library_file_id"):
                        receipt = {"schema": SCHEMA + ".saved", "archive": archive, "result": prior}
                        publish(saved_path, encoded(receipt))
                        return receipt
                for row in prior.get("results", []):
                    if row.get("status") == "succeeded" and row.get("library_file_id"):
                        completed.append(row)
        folder = private(root / ("%04d" % (len(list(root.iterdir())) + 1)))
        item = {"local_path": archive["path"], "purpose": "create_library_file"}
        target = library.get("target")
        if completed:
            last = completed[-1]
            target = {"library_file_id": last["library_file_id"],
                      "expected_current_version": last.get("current_version_number")}
        if target:
            item.update(purpose="replace_library_file", library_file_id=target["library_file_id"],
                        version_reason="Continue the same complete Delivery Risk operator case")
            version = target.get("expected_current_version")
            if version is not None:
                require(type(version) is int and version >= 0, "Retain the actual saved version.")
                item["expected_current_version"] = version
        else:
            item["library_artifact_type"] = "other"
        request = {"uploads": [item]}
        publish(folder / "archive.json", encoded(archive))
        publish(folder / "request.json", encoded(request))
        sys.path.insert(0, str(Path(library["helperDirectory"]).resolve()))
        from library_upload import LibraryUploadWorkflow, SignedUrlUploader
        from library_hosted_apps import HostedAppsClient
        from library_file_transfer import LibraryFileMaterializer
        class ObservedApps:
            def __init__(self):
                self.delegate = HostedAppsClient()
                self.ordinal = 0
                self.errors = []

            def observe(self, name, value):
                try:
                    publish(folder / name, encoded(value))
                except BaseException as error:
                    self.errors.append({"name": type(error).__name__, "message": str(error)})

            def call_tool(self, connector_id, tool_name, arguments):
                self.ordinal += 1
                prefix = "%04d" % self.ordinal
                self.observe(prefix + "-request.json", {"connectorId": connector_id,
                    "toolName": tool_name, "arguments": arguments})
                try:
                    returned = self.delegate.call_tool(connector_id, tool_name, arguments)
                except BaseException as error:
                    self.observe(prefix + "-error.json", {"name": type(error).__name__,
                        "message": str(error), "result": getattr(error, "result", None)})
                    raise
                self.observe(prefix + "-response.json", returned)
                return returned
        apps = ObservedApps()
        result = LibraryUploadWorkflow(apps_client=apps, materializer=LibraryFileMaterializer(),
            uploader=SignedUrlUploader(), state_parent=folder).run(request)
        publication_error = None
        try:
            publish(folder / "result.json", encoded(result))
        except BaseException as error:
            publication_error = error
        # Emit the actual ordered result even if its local publication failed.
        try:
            print(json.dumps({"schema": SCHEMA + ".save", "orderedResult": result}, ensure_ascii=False), flush=True)
        except BaseException as error:
            publication_error = publication_error or error
        if publication_error:
            raise publication_error
        rows = result.get("results")
        require(isinstance(rows, list) and len(rows) == 1, "The original save result has no single ordered item.")
        row = rows[0]
        require(row.get("status") == "succeeded" and isinstance(row.get("library_file_id"), str)
                and bool(row["library_file_id"]), "The original full case save did not complete.")
        receipt = {"schema": SCHEMA + ".saved", "archive": archive, "result": result}
        publish(self.output / (Path(archive["path"]).stem + "-saved.json"), encoded(receipt))
        return receipt

    @staticmethod
    def verify_archive(path, members):
        with zipfile.ZipFile(path) as archive:
            expected = {name: (raw, mode) for name, raw, mode in members}
            require(len(archive.infolist()) == len(expected) and set(archive.namelist()) == set(expected),
                    "The closed-case archive inventory differs.")
            for item in archive.infolist():
                raw, mode = expected[item.filename]
                require(archive.read(item) == raw and (item.external_attr >> 16) & 0o777 == mode,
                        "A complete closed-case member differs.")


def execute(config, *, execution_continuation=None):
    require(config.get("schema") == SCHEMA, "Use the complete original risk execution input.")
    repository, workspace_source, _manifest = verify_source(config, execution_continuation)
    output = private(Path(config["outputDirectory"]))
    require(not output.is_relative_to(repository) and not repository.is_relative_to(output),
            "Separate source and the private receiving case.")
    guard = Guard(output / "execution.guard")
    owner = None
    first = None
    result = None
    outcome = None
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        for sig in previous:
            signal.signal(sig, stop)
        continuation_record = (retain_execution_continuation(config, _manifest, execution_continuation)
                               if execution_continuation is not None else None)
        owner = Owner(config, output, guard, continuation_record)
        native_path = output / "NATIVE_OUTCOME.json"
        if native_path.exists():
            result = json.loads(read(native_path)[0])
            require(result["operationId"] == config["operationId"] and result["state"] == "COMPLETED"
                    and result["sourceManifest"] == config["sourceManifest"],
                    "Resume the original closed native outcome.")
            require(result.get("executionContinuation") == owner.execution_continuation,
                    "Retain the declared execution source on native-outcome recovery.")
            for key in ("native", "reopen", "browser"):
                checked(result[key])
        else:
            owner.host_start(workspace_source)
            course_output = owner.course(workspace_source)
            browser_receipt = owner.browser(workspace_source, course_output)
            owner.host_close()
            stopped()
            owner.host_start(workspace_source)
            owner.course(workspace_source, verify=True)
            owner.host_close()
            result = {"schema": SCHEMA + ".result", "operationId": config["operationId"], "state": "COMPLETED",
                      "sourceManifest": config["sourceManifest"], "hostLifetimes": owner.state["hostLifetimes"],
                      "native": descriptor(course_output / "risk-course-result.json"),
                      "browser": browser_receipt, "reopen": descriptor(course_output / "risk-course-reopen.json")}
            if owner.execution_continuation is not None:
                result["executionContinuation"] = owner.execution_continuation
            publish(native_path, encoded(result))
    except BaseException as error:
        first = error
    finally:
        if owner is not None:
            while owner.host is not None or owner.workspace_owner is not None or owner.thread is not None:
                try:
                    owner.host_close()
                except BaseException as error:
                    first = first or error
                if owner.host is not None or owner.workspace_owner is not None or owner.thread is not None:
                    time.sleep(0.1)
            if owner.host is None and owner.workspace_owner is None and owner.thread is None:
                outcome = result if first is None else {"schema": SCHEMA + ".result",
                    "operationId": config["operationId"], "state": "INTERRUPTED",
                    "error": {"name": type(first).__name__, "message": str(first)}}
                if owner.execution_continuation is not None:
                    outcome["executionContinuation"] = owner.execution_continuation
                try:
                    if "pendingArchive" in owner.state and owner.state["pendingArchive"]["outcome"] == outcome:
                        archive = owner.state["pendingArchive"]["archive"]
                        checked(archive)
                    else:
                        archive = owner.archive(outcome)
                        owner.state["pendingArchive"] = {"outcome": json.loads(encoded(outcome)), "archive": archive}
                        owner.save()
                    outcome["archive"] = archive
                    outcome["saved"] = owner.save_archive(archive)
                    publish(output / "EXECUTION_RESULT.json", encoded(outcome), replace=True)
                except BaseException as error:
                    first = first or error
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        try:
            guard.close()
        except BaseException as error:
            first = first or error
    if outcome is not None:
        closure = {**outcome, "guardClosed": guard.fd is None}
        if first is not None and closure.get("state") == "COMPLETED":
            closure.update(state="INTERRUPTED", error={"name": type(first).__name__, "message": str(first)})
        name = Path(outcome.get("archive", {}).get("path", "unpublished")).stem + "-closure-" + uuid.uuid4().hex + ".json"
        publish(output / name, encoded(closure))
        print(json.dumps(closure, ensure_ascii=False), flush=True)
    if first:
        raise first
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--execution-continuation", help="Absolute JSON descriptor of the explicit complete same-case execution correction.")
    args = parser.parse_args()
    continuation = json.loads(read(args.execution_continuation)[0]) if args.execution_continuation else None
    execute(json.loads(read(args.input)[0]), execution_continuation=continuation)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)
