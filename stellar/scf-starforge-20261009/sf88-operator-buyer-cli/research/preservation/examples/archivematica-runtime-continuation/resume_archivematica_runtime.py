#!/usr/bin/env python3
"""Continue the original saved Archivematica receiving with an explicitly selected runtime.

This program reads an already-authorized local checkpoint. It neither downloads
nor shares it. Product files, original requests and entered provider effects are
retained. Actual executable bindings and artifact-return readiness are separate
receipts. The original canonical workspace path must be available on this host.
"""
from __future__ import annotations
import argparse
import ast
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid

OP = "ARCHIVEMATICA-RESEARCH-RECEIVING-6BA15-20261012"
SCHEMA = "commons.archivematica-receiving-runtime.v1"
ROOT = Path("/dev/archivematica-complete-final-receiving-2-6ba15")
ORIGINAL_PYTHON = "/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3"
ORIGINAL_PATHS = {
    "python": ORIGINAL_PYTHON,
    "node": "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node",
    "playwrightModule": "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
    "browserExecutable": "/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell",
}
BOOTSTRAP = {"bytes": 87017, "sha256": "4a1b15432d7b968523ece0c2f19d519751a95d297e996d971ec2e7134e78e2f8"}
CHECKPOINT = {"bytes": 18228351, "sha256": "eb23c0d4f7c7d6ec3c6fe9d5148bd4aab7107f0c7bee93b6c609c26ae4865441"}
HISTORY = {"bytes": 47308, "sha256": "4687f311d3c799778934d5be478c682d7d66573d6e73493ab993f9b60123fe9c"}
RUNNER = {"bytes": 142667, "sha256": "2ea6c17ed1700a494abcd4014c27e4781e3abc2d19a898c18da7d7522bd20d30"}
W = {}
R = None
CONFIG = {}
BINDING = {}
BINDING_SHA = ""
RETURN_ROOT = None
RUNTIME_ROOT = None
OWNED = {}
SOURCE_RAW = b""
HISTORY_RAW = b""

def need(value, message):
    if not value:
        raise RuntimeError(message)

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def identity(path):
    path = Path(path)
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode), "A selected runtime or artifact is not a regular file")
        digest, count = hashlib.sha256(), 0
        for block in iter(lambda: stream.read(262144), b""):
            digest.update(block)
            count += len(block)
        after = os.fstat(stream.fileno())
    fields = lambda row: (row.st_dev, row.st_ino, row.st_size, row.st_mtime_ns, row.st_ctime_ns)
    need(fields(before) == fields(after) and count == before.st_size, "A selected file changed during its complete read")
    return {"bytes": count, "sha256": digest.hexdigest()}

def check(path, expected):
    need(identity(path) == {key: expected[key] for key in ("bytes", "sha256")}, "Exact selected file bytes differ: " + str(path))

def regular_source(path, expected):
    path = Path(path)
    check(path, expected)
    raw = path.read_bytes()
    need({"bytes": len(raw), "sha256": sha(raw)} == expected, "A retained source changed while loading")
    return raw

def syncdir(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def publish(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    need(path.parent.resolve() == path.parent.absolute(), "A runtime receipt directory is not canonical")
    expected = {"bytes": len(raw), "sha256": sha(raw)}
    if path.exists():
        check(path, expected)
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".runtime-publication-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            check(path, expected)
        syncdir(path.parent)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)

def publish_json(path, value):
    publish(path, encoded(value))

def read_json(path):
    return json.loads(Path(path).read_bytes())

def canonical_absolute(value):
    need(isinstance(value, str) and value.startswith("/") and not any(ord(x) < 32 for x in value),
         "Select an absolute runtime path without control characters")
    path = Path(value)
    need(str(path) == value, "A selected runtime path is not canonical")
    return path

def select_runtime(path):
    raw = Path(path).read_bytes()
    value = json.loads(raw)
    need(isinstance(value, dict) and set(value) == {"schema", "operationId", "paths", "returnDirectory", "note"},
         "Runtime selection has unknown or missing fields")
    need(value["schema"] == SCHEMA and value["operationId"] == OP, "Select the original receiving runtime schema and operation")
    need(isinstance(value["note"], str) and value["note"].strip(), "Retain the actual receiving host selection")
    need(isinstance(value["paths"], dict) and set(value["paths"]) == set(ORIGINAL_PATHS),
         "Select all four actual runtime paths")
    observations, paths = {}, {}
    for name, selected in value["paths"].items():
        need(isinstance(selected, dict) and set(selected) == {"path", "bytes", "sha256"},
             "Each runtime selection needs its actual path and exact bytes/SHA")
        need(type(selected["bytes"]) is int and selected["bytes"] > 0
             and isinstance(selected["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", selected["sha256"]),
             "A selected runtime file identity is incomplete")
        requested = canonical_absolute(selected["path"])
        actual = requested.resolve(strict=True)
        check(actual, selected)
        if name != "playwrightModule":
            need(os.access(actual, os.X_OK), "A selected runtime executable cannot be executed")
        paths[name] = str(requested)
        observations[name] = {"selectedPath": str(requested), "resolvedPath": str(actual), **identity(actual)}
    need(Path(sys.executable).resolve(strict=True) == Path(observations["python"]["resolvedPath"])
         and sys.version_info >= (3, 11), "Invoke this program with the selected Python 3.11 or newer")
    target = canonical_absolute(value["returnDirectory"])
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    need(target.resolve() == target and not target.is_relative_to(ROOT) and not ROOT.is_relative_to(target),
         "The native return directory must be canonical and outside the original receiving workspace")
    module_package = Path(observations["playwrightModule"]["resolvedPath"]).parent / "package.json"
    need(module_package.is_file(), "The selected Playwright entry lacks its installed package metadata")
    metadata = read_json(module_package)
    need(metadata.get("name") in {"playwright", "playwright-core"} and isinstance(metadata.get("version"), str),
         "The selected module is not an installed Playwright package")
    binding = {
        "schema": SCHEMA + ".binding", "operationId": OP,
        "configuration": {"path": str(Path(path).absolute()), "bytes": len(raw), "sha256": sha(raw)},
        "originalCheckpoint": CHECKPOINT, "originalBootstrap": BOOTSTRAP,
        "runner": RUNNER, "originalWorkspace": str(ROOT),
        "originalPaths": ORIGINAL_PATHS, "actualPaths": observations,
        "python": {"invokedExecutable": sys.executable, "version": sys.version},
        "playwright": {"package": str(module_package), **identity(module_package), "version": metadata["version"]},
        "returnDirectory": str(target), "artifactTransport": "existing-owner-native-return",
        "artifactUploadInvoked": False, "note": value["note"],
    }
    return value | {"selectedPaths": paths}, binding, target

def requested_argv(arguments):
    values = [str(item) for item in arguments]
    need(values, "An original receiving command is empty")
    replacements = {CONFIG["selectedPaths"][key]: ORIGINAL_PATHS[key] for key in ORIGINAL_PATHS}
    replacements[sys.executable] = ORIGINAL_PYTHON
    if values[0] in replacements:
        values[0] = replacements[values[0]]
    for index, item in enumerate(values[:-1]):
        name = {"--python": "python", "--playwright-module": "playwrightModule", "--browser": "browserExecutable"}.get(item)
        if name is not None:
            need(values[index + 1] in {CONFIG["selectedPaths"][name], ORIGINAL_PATHS[name], sys.executable if name == "python" else ""},
                 "An original browser command contains an undeclared runtime")
            values[index + 1] = ORIGINAL_PATHS[name]
    return values

def execution_receipt(folder, label, original_request, arguments):
    value = {
        "schema": SCHEMA + ".execution-request", "operationId": OP, "label": label,
        "originalRequest": {"path": str(original_request), **identity(original_request)},
        "runtimeBinding": {"path": str(RUNTIME_ROOT / "runtime-binding.json"), "bytes": len(encoded(BINDING)), "sha256": BINDING_SHA},
        "requestedArgv": read_json(original_request)["argv"],
        "actualArgv": [str(item) for item in arguments], "workingDirectory": str(ROOT),
        "providerOperationReplaced": False,
    }
    target = ROOT / "native-receiving/receiving-source/runtime-executions" / label / ("execution-" + sha(encoded(value)) + ".json")
    publish_json(target, value)
    return {"path": str(target), **identity(target)}

def actual_inactive(process, terminal=None):
    if terminal is not None and terminal.get("process") == process and terminal.get("processExitObserved") is True:
        need(type(terminal.get("exitCode")) is int, "An original terminal process receipt has no exit code")
        return True
    key = sha(encoded(process))
    if key in OWNED:
        return OWNED[key].poll() is not None
    need(process.get("identitySource") == "inherited-self-proc",
         "An original unresolved command lacks an actual host-process proof; retain it without dispatch")
    return R.original_process_inactive({key: process[key] for key in ("pid", "bootId", "startTicks")})

def stop_owned(child):
    if child is None or child.poll() is not None:
        return
    with contextlib.suppress(OSError):
        if child.stdin:
            child.stdin.close()
    with contextlib.suppress(ProcessLookupError):
        if getattr(child, "_archivematica_group_leader", False):
            os.killpg(child.pid, signal.SIGTERM)
        else:
            child.terminate()
    try:
        child.wait(timeout=10)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(ProcessLookupError):
            if getattr(child, "_archivematica_group_leader", False):
                os.killpg(child.pid, signal.SIGKILL)
            else:
                child.kill()
        child.wait(timeout=10)

def spawn_owned(arguments, original_sha, output, errors, *, cold):
    parent = R.process_identity()
    read_end, write_end = os.pipe()
    child = None
    try:
        environment = dict(W["ENV"])
        environment["ARCHIVEMATICA_RECEIVING_IDENTITY_FD"] = str(write_end)
        environment["ARCHIVEMATICA_RECEIVING_IDENTITY_REQUEST"] = original_sha
        argv = [str(item) for item in arguments]
        if not cold:
            argv = [CONFIG["selectedPaths"]["python"], "-B", str(RUNTIME_ROOT / "runtime-gate.py"),
                    str(ROOT / "receiving/run-archivematica-receiving.py"), *argv]
        child = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=output, stderr=errors,
                                 cwd=ROOT, env=environment, close_fds=True, pass_fds=(write_end,),
                                 start_new_session=not cold)
        child._archivematica_group_leader = not cold
        os.close(write_end)
        write_end = None
        selected, observation = R.receive_child_identity(read_end, child, parent, original_sha, argv)
        selected = {**selected, "identitySource": "inherited-self-proc", "namespacePid": child.pid}
        OWNED[sha(encoded(selected))] = child
        return child, selected, {"parentProcess": parent, "identityObservation": observation, "launchedArgv": argv}
    except BaseException:
        stop_owned(child)
        raise
    finally:
        for descriptor in (read_end, write_end):
            if descriptor is not None:
                with contextlib.suppress(OSError):
                    os.close(descriptor)

def run_command(name, arguments, timeout=900):
    folder = ROOT / "commands" / name
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    actual = [str(item) for item in arguments]
    if name == "original169":
        actual[0] = CONFIG["selectedPaths"]["python"]
    request = {"operationId": OP, "name": name, "argv": requested_argv(actual),
               "cwd": str(ROOT), "timeoutSeconds": timeout}
    request_path = folder / "request.json"
    publish_json(request_path, request)
    result_path = folder / "result.json"
    if result_path.exists():
        previous = read_json(result_path)
        need(previous["request"] == request and previous["exitCode"] == 0, "The original command result changed")
        for key in ("stdout", "stderr"):
            check(previous[key]["path"], previous[key])
        need(actual_inactive(previous["process"], previous), "The original command is still active")
        W["emit"]("COMMAND_REUSED", name=name)
        return previous
    successful = []
    for candidate in sorted(folder.glob("attempt-*.json")):
        prior = read_json(candidate)
        need(prior["request"] == request, "An original command attempt changed its request")
        terminal = prior if prior.get("processExitObserved") is True else None
        if terminal is None and not candidate.name.startswith("attempt-result-"):
            terminal_path = folder / ("attempt-result-" + candidate.name.removeprefix("attempt-"))
            if terminal_path.exists():
                terminal = read_json(terminal_path)
                need(terminal["request"] == request and terminal["process"] == prior["process"],
                     "An original completion is bound to another command")
        need(actual_inactive(prior["process"], terminal), "The original command is still active")
        if terminal is not None and terminal["exitCode"] == 0:
            for key in ("stdout", "stderr"):
                check(terminal[key]["path"], terminal[key])
            successful.append(terminal)
    if successful:
        terminal = successful[0]
        publish_json(result_path, terminal)
        W["emit"]("COMMAND_RECONCILED", name=name, originalResultReused=True)
        return terminal
    if name == "original169":
        actual = [CONFIG["selectedPaths"]["python"], "-B", str(RUNTIME_ROOT / "resume_archivematica_runtime.py"),
                  "--receiver-mode", "--binding", str(RUNTIME_ROOT / "runtime-binding.json"), "--", *actual[2:]]
    execution = execution_receipt(folder, name, request_path, actual)
    attempt = str(uuid.uuid4())
    stdout_path, stderr_path = folder / (attempt + ".stdout"), folder / (attempt + ".stderr")
    started, beginning = W["now"](), time.monotonic()
    child = None
    with open(stdout_path, "xb", buffering=0) as output, open(stderr_path, "xb", buffering=0) as errors:
        try:
            child, process, observation = spawn_owned(actual, identity(request_path)["sha256"], output, errors, cold=False)
            publish_json(folder / ("attempt-" + attempt + ".json"),
                         {"request": request, "process": process, "startedAt": started,
                          "execution": execution, **observation})
            child.stdin.write(b"START\n")
            child.stdin.flush()
            child.stdin.close()
            W["emit"]("COMMAND_STARTED", name=name, process=process, execution=execution)
            offsets = {"stdout": 0, "stderr": 0}
            while True:
                remaining = timeout - (time.monotonic() - beginning)
                need(remaining > 0, "The original command reached its retained timeout")
                try:
                    code = child.wait(timeout=min(5, remaining))
                    break
                except subprocess.TimeoutExpired:
                    tails = {}
                    for label, path in (("stdout", stdout_path), ("stderr", stderr_path)):
                        with open(path, "rb") as stream:
                            stream.seek(offsets[label])
                            block = stream.read(8192)
                        offsets[label] += len(block)
                        if block:
                            tails[label] = block.decode("utf-8", errors="replace")
                    W["emit"]("ORIGINAL_COMMAND_PROGRESS", name=name,
                              elapsedSeconds=round(time.monotonic() - beginning, 3), **tails)
        except BaseException:
            stop_owned(child)
            raise
        finally:
            for stream in (output, errors):
                stream.flush()
                os.fsync(stream.fileno())
    result = {"request": request, "process": process, "startedAt": started, "completedAt": W["now"](),
              "seconds": time.monotonic() - beginning, "exitCode": code, "processExitObserved": True,
              "execution": execution, "stdout": W["descriptor"](stdout_path), "stderr": W["descriptor"](stderr_path)}
    publish_json(folder / ("attempt-result-" + attempt + ".json"), result)
    W["emit"]("COMMAND_DRAINED", name=name, exitCode=code, stdout=result["stdout"], stderr=result["stderr"],
              stdoutTail=stdout_path.read_text("utf-8", errors="replace")[-5000:],
              stderrTail=stderr_path.read_text("utf-8", errors="replace")[-7000:])
    need(code == 0, "The original command stopped; its exact result and output remain retained")
    publish_json(result_path, result)
    return result

def cold_subprocess(out, label, arguments, final_receipt):
    out = Path(out)
    original = {"schema": R.SCHEMA + ".process-request", "operationId": OP, "label": label,
                "argv": requested_argv(arguments), "receipt": str(final_receipt)}
    request_path, process_path = out / (label + ".process-request.json"), out / (label + ".process.json")
    R.publish_json(request_path, original)
    request_sha = identity(request_path)["sha256"]
    if process_path.exists():
        prior = R.read_json(process_path)
        need(prior["requestSha256"] == request_sha, "The original cold request changed")
        if prior.get("exitCode") == 0:
            need(identity(final_receipt) == prior["receipt"], "The original completed cold receipt changed")
            return prior
        need(R.original_process_inactive(prior["process"]), "The original cold child is still active")
    for path in sorted(out.glob(label + ".attempt-*.json")):
        previous = R.read_json(path)
        need(previous["requestSha256"] == request_sha, "The original cold attempt changed")
        need(R.original_process_inactive(previous["process"]), "The original cold child is still active")
    actual = [str(item) for item in arguments]
    actual[0] = CONFIG["selectedPaths"]["python"]
    execution = execution_receipt(out, label, request_path, actual)
    stdout_path, stderr_path = out / (label + ".stdout.log"), out / (label + ".stderr.log")
    attempt = len(list(out.glob(label + ".attempt-*.json"))) + 1
    child, started = None, R.now()
    with open(stdout_path, "ab", buffering=0) as output, open(stderr_path, "ab", buffering=0) as errors:
        try:
            child, observed, observation = spawn_owned(actual, request_sha, output, errors, cold=True)
            process = {key: observed[key] for key in ("pid", "bootId", "startTicks")}
            R.publish_json(out / f"{label}.attempt-{attempt:04d}.json",
                           {"schema": R.SCHEMA + ".process-attempt", "requestSha256": request_sha,
                            "process": process, "startedAt": started, "execution": execution, **observation})
            child.stdin.write(b"START\n")
            child.stdin.flush()
            child.stdin.close()
            code = child.wait(timeout=900)
        except BaseException:
            stop_owned(child)
            raise
        finally:
            for stream in (output, errors):
                stream.flush()
                os.fsync(stream.fileno())
    result = {"schema": R.SCHEMA + ".process-result", "requestSha256": request_sha,
              "process": process, "exitCode": code, "startedAt": started, "finishedAt": R.now(),
              "stdout": identity(stdout_path), "stderr": identity(stderr_path),
              "receipt": identity(final_receipt) if Path(final_receipt).exists() else None,
              "execution": execution}
    R.replace_json(process_path, result)
    need(code == 0 and result["receipt"] is not None, "The original cold receiving child did not complete")
    return result

def install_receiver(runner):
    global R
    R = runner
    R.subprocess_phase = cold_subprocess

def retain_runtime():
    folder = RUNTIME_ROOT
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    publish(folder / "resume_archivematica_runtime.py", SOURCE_RAW)
    publish(folder / "original-continuation.py", regular_source(CONFIG["continuation"], BOOTSTRAP))
    publish(folder / "runtime-selection.json", Path(CONFIG["selection"]).read_bytes())
    publish_json(folder / "runtime-binding.json", BINDING)
    history_path = ROOT / "native-receiving/receiving-source/recovery/44502-35206-57433-history.json"
    publish(history_path, HISTORY_RAW)
    runner_path = ROOT / "receiving/run-archivematica-receiving.py"
    check(runner_path, RUNNER)
    spec = importlib.util.spec_from_file_location("archivematica_original_runtime_receiver", runner_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    install_receiver(module)
    gate = (
        "import importlib.util,os,sys\n"
        "p=sys.argv[1]\n"
        "s=importlib.util.spec_from_file_location('original_runtime_gate_receiver',p)\n"
        "m=importlib.util.module_from_spec(s)\n"
        "sys.modules[s.name]=m\n"
        "s.loader.exec_module(m)\n"
        "m.publish_child_identity()\n"
        "if sys.stdin.buffer.readline(16)!=b'START\\n':raise RuntimeError('Original runtime gate not released')\n"
        "a=sys.argv[2:]\n"
        "os.execvpe(a[0],a,os.environ)\n"
    ).encode()
    publish(folder / "runtime-gate.py", gate)
    native_sources = ROOT / "native-receiving/receiving-source/receiving-runtime" / BINDING_SHA
    for name in ("resume_archivematica_runtime.py", "original-continuation.py",
                 "runtime-selection.json", "runtime-binding.json", "runtime-gate.py"):
        publish(native_sources / name, (folder / name).read_bytes())
    W["emit"]("RUNTIME_SELECTION_RETAINED", binding={"path": str(folder / "runtime-binding.json"), **identity(folder / "runtime-binding.json")},
              artifactMode="existing-owner-native-return", providerDispatch=0)

def copy_for_return(source, target):
    source, target = Path(source), Path(target)
    expected = identity(source)
    if target.exists():
        check(target, expected)
        return
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=".native-return-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as output, open(source, "rb") as incoming:
            os.fchmod(output.fileno(), 0o600)
            for block in iter(lambda: incoming.read(262144), b""):
                output.write(block)
            output.flush()
            os.fsync(output.fileno())
        check(temporary, expected)
        check(source, expected)
        try:
            os.link(temporary, target)
        except FileExistsError:
            check(target, expected)
        syncdir(target.parent)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)

def prepare_native_return(path, *, retain_stage=False):
    path = Path(path)
    selected = W["descriptor"](path)
    target = RETURN_ROOT / "artifacts" / path.name
    copy_for_return(path, target)
    receipt_path = ROOT / "native-return-receipts" / sha(str(RETURN_ROOT).encode()) / (path.name + ".json")
    result = {"local_path": str(target), "purpose": "native-artifact-return",
              "status": "READY_FOR_EXISTING_CONNECTOR", "file_name": path.name,
              "file_id": None, "library_file_id": None}
    value = {"schema": SCHEMA + ".native-return", "operationId": OP,
             "status": "READY_FOR_NATIVE_RETURN", "source": selected,
             "staged": {"path": str(target), **identity(target)}, "result": result,
             "uploadInvoked": False, "runtimeBindingSha256": BINDING_SHA}
    publish_json(receipt_path, value)
    publish_json(RETURN_ROOT / "receipts" / receipt_path.name, value)
    W["emit"]("ARTIFACT_READY_FOR_NATIVE_RETURN", **value)
    return value

def retain_failure(failure, failure_path):
    need(not any(child.poll() is None for child in OWNED.values()),
         "An owned receiving child remains active before checkpoint publication")
    checkpoint = ROOT / "checkpoints" / ("Archivematica_Interrupted_Checkpoint_" + identity(failure_path)["sha256"][:16] + ".zip")
    metadata = {"kind": "interrupted-workspace-checkpoint", "status": "INTERRUPTED_UNVERIFIED",
                "root": str(ROOT), "sourceCommit": W["PACKET"]["sourceCommit"],
                "sourcePacketSha256": sha(W["PAYLOAD"]["sourcePacket"].encode()),
                "failure": W["descriptor"](failure_path), "runtimeBindingSha256": BINDING_SHA}
    selected = W["regular_inventory"](ROOT, exclude_prefixes=("checkpoints", "tmp", "library-state"), exclude_gallery=True)
    W["create_archive"](checkpoint, selected, metadata)
    prepared = prepare_native_return(checkpoint)
    W["emit"]("INTERRUPTED_CHECKPOINT_READY_FOR_NATIVE_RETURN", checkpoint=prepared,
              nativeOrBrowserPassAdded=False, uploadInvoked=False)

def load_payload(continuation, checkpoint):
    raw = regular_source(continuation, BOOTSTRAP)
    text = raw.decode("utf-8")
    before = '    exec(compile(program, "complete_archivematica_delivery.py", "exec"),\n         {"__name__": "__main__", "PAYLOAD": payload})'
    need(text.count(before) == 1, "The original continuation source boundary changed")
    projected = text.replace(before, "    return payload", 1)
    ast.parse(projected, filename="original_checkpoint_source_loader.py")
    namespace = {"__name__": "original_checkpoint_source_loader"}
    exec(compile(projected, "original_checkpoint_source_loader.py", "exec"), namespace)
    namespace["ARCHIVE"] = Path(checkpoint)
    return namespace["main"]()

def adapt_program(program):
    changes = [
        ('    runtime = PACKET["runtime"]\n', '    runtime = RECEIVING_RUNTIME["paths"]\n'),
        ('    spec.loader.exec_module(RUNNER)\n', '    spec.loader.exec_module(RUNNER)\n    INSTALL_RECEIVER_RUNTIME(RUNNER)\n'),
        ('    adopt_original_namespace_runner()\n', '    adopt_original_namespace_runner()\n    RETAIN_RUNTIME_CONTEXT()\n'),
        ('    emit("NATIVE_CHECKPOINT_SAVED", recordCount=169, nativeState="VERIFIED",\n',
         '    emit("NATIVE_CHECKPOINT_READY_FOR_NATIVE_RETURN", recordCount=169, nativeState="VERIFIED",\n'),
        ('"operationId": OP, "status": "SAVED", "completedAt": now(),\n',
         '"operationId": OP, "status": "READY_FOR_NATIVE_RETURN", "completedAt": now(),\n'),
        ('    final = {"schema": SCHEMA + ".saved",', '    final = {"schema": SCHEMA + ".native-return-ready",'),
        ('"scope": native["scope"], "recordCount": 169, "nativeState": "VERIFIED",',
         '"scope": native["scope"], "recordCount": 169, "nativeState": "VERIFIED",\n'
         '        "artifactDelivery": "READY_FOR_NATIVE_RETURN", "uploadInvoked": False,'),
        ('    emit("COMPLETE", **{key: value for key, value in final.items() if key not in {"schema", "operationId"}})\n',
         '    emit("COMPLETE_RECEIVING_READY_FOR_NATIVE_RETURN", **{key: value for key, value in final.items() if key not in {"schema", "operationId"}})\n'),
        ('    selected["receiving-attempt.json"] = ROOT / "receiving-attempt.json"\n',
         '    selected["receiving-attempt.json"] = ROOT / "receiving-attempt.json"\n'
         '    for prefix, directory in (("receiving-runtime", ROOT / "recovery/portable"),\n'
         '                              ("receiving-commands", ROOT / "commands"),\n'
         '                              ("receiving-runtime-executions", OUT / "receiving-source/runtime-executions")):\n'
         '        for name, item in regular_inventory(directory).items():\n'
         '            key = prefix + "/" + name\n'
         '            need(key not in selected or selected[key] == item, "Receiving runtime evidence collides with another member")\n'
         '            selected[key] = item\n'),
        ('using the same169 input and corrected af04 harness.',
         'using the same169 input, the retained af04 correction and its exact reviewed namespace successor.'),
        ('The native checkpoint was preserved before the browser continuation;',
         'The native checkpoint was copied and verified in the selected native return directory before the browser continuation;'),
        ('## Exact source and evidence\n\nSource commit:',
         '## Artifact delivery\n\nThese files are prepared for the receiving worker\'s existing authorized connector. '
         'READY_FOR_NATIVE_RETURN is not an upload receipt. This continuation makes no sharing change or external file transfer.\n\n'
         '## Exact source and evidence\n\nSource commit:'),
    ]
    for old, new in changes:
        need(program.count(old) == 1, "The retained runtime-adaptation source seam is not unique")
        program = program.replace(old, new, 1)
    ast.parse(program, filename="complete_archivematica_delivery_runtime.py")
    return program

def main():
    global W, CONFIG, BINDING, BINDING_SHA, RETURN_ROOT, RUNTIME_ROOT, SOURCE_RAW, HISTORY_RAW
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--continuation", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--runtime", required=True)
    parser.add_argument("--history", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    SOURCE_RAW = Path(__file__).read_bytes()
    ast.parse(SOURCE_RAW, filename=__file__)
    HISTORY_RAW = regular_source(args.history, HISTORY)
    selected, BINDING, RETURN_ROOT = select_runtime(args.runtime)
    CONFIG = selected | {"continuation": str(Path(args.continuation).absolute()), "selection": str(Path(args.runtime).absolute())}
    BINDING["adapter"] = {"bytes": len(SOURCE_RAW), "sha256": sha(SOURCE_RAW)}
    BINDING["history"] = HISTORY
    BINDING_SHA = sha(encoded(BINDING))
    RUNTIME_ROOT = ROOT / "recovery/portable" / BINDING_SHA
    need(not ROOT.is_symlink(), "Do not relocate the original absolute workspace with a symlink")
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    need(ROOT.resolve() == ROOT, "The original canonical workspace path must be available on the receiving host")
    payload = load_payload(args.continuation, args.checkpoint)
    original_program = payload["program"]
    payload["program"] = adapt_program(original_program)
    W = {"__name__": "archivematica_runtime_delivery", "PAYLOAD": payload,
         "RECEIVING_RUNTIME": {"paths": CONFIG["selectedPaths"]},
         "INSTALL_RECEIVER_RUNTIME": install_receiver, "RETAIN_RUNTIME_CONTEXT": retain_runtime}
    exec(compile(payload["program"], "complete_archivematica_delivery_runtime.py", "exec"), W)
    W["SHARED"] = RETURN_ROOT / "operator-control"
    W["run_command"] = run_command
    W["save_artifact"] = prepare_native_return
    W["preserve_interrupted_context"] = retain_failure
    try:
        W["main"]()
        final = ROOT / "complete-delivery-receipt.json"
        copy_for_return(final, RETURN_ROOT / final.name)
        print(json.dumps({"status": "READY_FOR_NATIVE_RETURN", "operationId": OP,
                          "receivingReceipt": {"path": str(RETURN_ROOT / final.name), **identity(final)},
                          "uploadInvoked": False, "directory": str(RETURN_ROOT)}, separators=(",", ":")), flush=True)
    except BaseException as error:
        for child in list(OWNED.values()):
            stop_owned(child)
        import traceback
        failure = {"schema": SCHEMA + ".failure", "operationId": OP, "at": W["now"](),
                   "type": type(error).__name__, "message": str(error), "traceback": traceback.format_exc(),
                   "runtimeBindingSha256": BINDING_SHA, "root": str(ROOT)}
        failure_path = ROOT / "failures" / (str(uuid.uuid4()) + ".json")
        publish_json(failure_path, failure)
        if (ROOT / "native-receiving").is_dir() and W.get("PACKET") and W.get("ENV"):
            try:
                retain_failure(failure, failure_path)
            except BaseException as preservation_error:
                print(json.dumps({"status": "INTERRUPTED_RETURN_UNAVAILABLE", "operationId": OP,
                                  "failure": str(failure_path), "message": str(preservation_error)}, separators=(",", ":")), flush=True)
        raise

def receiver_mode(arguments):
    global W, CONFIG, BINDING, BINDING_SHA, RETURN_ROOT, RUNTIME_ROOT, SOURCE_RAW
    need(len(arguments) >= 4 and arguments[0] == "--binding" and arguments[2] == "--",
         "Select the exact inherited receiving runtime binding")
    binding_path = Path(arguments[1]).absolute()
    SOURCE_RAW = Path(__file__).read_bytes()
    BINDING = read_json(binding_path)
    BINDING_SHA = sha(encoded(BINDING))
    RUNTIME_ROOT = ROOT / "recovery/portable" / BINDING_SHA
    need(binding_path == RUNTIME_ROOT / "runtime-binding.json"
         and BINDING["schema"] == SCHEMA + ".binding" and BINDING["operationId"] == OP
         and BINDING["originalCheckpoint"] == CHECKPOINT
         and BINDING["originalBootstrap"] == BOOTSTRAP and BINDING["runner"] == RUNNER
         and BINDING["adapter"] == {"bytes": len(SOURCE_RAW), "sha256": sha(SOURCE_RAW)},
         "The inherited runtime changed its source, operation or original checkpoint")
    selection_path = RUNTIME_ROOT / "runtime-selection.json"
    check(selection_path, BINDING["configuration"])
    selection = read_json(selection_path)
    CONFIG = selection | {"selectedPaths": {key: row["selectedPath"] for key, row in BINDING["actualPaths"].items()}}
    RETURN_ROOT = Path(BINDING["returnDirectory"])
    for key, row in BINDING["actualPaths"].items():
        selected = Path(row["selectedPath"]).resolve(strict=True)
        need(str(selected) == row["resolvedPath"], "A selected receiving runtime changed its target")
        check(selected, row)
    need(Path(sys.executable).resolve(strict=True) == Path(BINDING["actualPaths"]["python"]["resolvedPath"]),
         "The cold continuation entered another Python runtime")
    argv = arguments[3:]
    runner_path = ROOT / "receiving/run-archivematica-receiving.py"
    need(argv and Path(argv[0]).absolute() == runner_path, "The runtime changed the original receiving entrypoint")
    check(runner_path, RUNNER)
    spec = importlib.util.spec_from_file_location("archivematica_original_portable_receiver", runner_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    W = {"ENV": dict(os.environ)}
    install_receiver(module)
    sys.argv = argv
    return module.main()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--receiver-mode":
        receiver_mode(sys.argv[2:])
    else:
        main()
