#!/usr/bin/env python3
# MIT.
"""Prepare and resume the original 8F43 managed customers in one foreground.

The exact original source, request, capacity declaration and native record are
retained. The maintained runtime handoff owns the previous undispatched owner;
resume_foreground retains this process through the complete installer and both
customer Applications lifecycles.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import time

OPERATION = "SCF-MANAGED-CUSTOMERS-INSTALL-8F43-DB4D-20261012-C287-CHECKPOINT-CONTINUATION"
RECORD = Path("/workspace/scratch/8f4370a17e6f/managed-native-records/6dd60f991d2878a6d19125003f181a33ba70bfefee05db9cb576bc184964595b")
REQUEST_SHA256 = "da41e1621f60dbd2da5c1353f902a40947fab00d167cd2129d0469105a24a407"
PROJECT = Path("/dev/commons-8f43-managed-db4d")
SOURCE_COMMIT = "75dd7badd76f6cd1a3cad97866184c5a1e4922d2"
PREPARATION_BLOB = "cebb7a18f91aa6b8ae0b292f5cf530f6559bb7df"
PREPARATION_BYTES = 243014
PYTHON = "/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3"
NODE = "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node"
HANDOFF_ID = OPERATION + ":maintained-foreground-v1"
SCHEMA = "starforge.original-managed-customer-foreground.v1"


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def retain(path, data):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.path.lexists(path):
        if not stat.S_ISREG(path.lstat().st_mode) or path.read_bytes() != data:
            raise ValueError("Preserve the existing original continuation: " + str(path))
        return
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if not stat.S_ISREG(path.lstat().st_mode) or path.read_bytes() != data:
                raise ValueError("A different continuation owns the selected source path")
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        os.unlink(temporary)


def request(native):
    raw = (RECORD / "request.json").read_bytes()
    value = json.loads(raw)
    intent = value["intent"]
    expected_command = [PYTHON, "-B", str(PROJECT / "run-customers.py"),
                        str(PROJECT / "intent-checkpoint.json")]
    if (sha256(raw) != REQUEST_SHA256 or value.get("schema") != native.SCHEMA or
            native.run_path(OPERATION, RECORD.parent) != RECORD or
            intent["operation_id"] != OPERATION or intent["project"] != str(PROJECT) or
            intent["command"] != expected_command):
        raise ValueError("Retain the exact original 6dd request and whole lifetime declaration")
    return value


def active_handoff(native, handoff):
    value = handoff.active(native, RECORD)
    if value and (value.get("operation_id") != OPERATION or
            value.get("selection", {}).get("expected_request_sha256") != REQUEST_SHA256 or
            value.get("selection", {}).get("capacity_amendments") is not None):
        raise ValueError("Preserve the original runtime handoff and unchanged source/declaration")
    return value


def has_dispatch(native):
    state = native.read_json(RECORD / "state.json") or {}
    return bool(state.get("process") or any((RECORD / name).exists()
        for name in ("process.json", "output.log", "command-completion.dat")))


def must_follow(native, handoff):
    active = active_handoff(native, handoff)
    if has_dispatch(native) or active and active.get("phase") == "cancelled":
        return True
    if active is None:
        return any((RECORD / name).exists() for name in ("result.json", "stop-request.json"))
    if active.get("phase") in ("resumed", "resumed_elsewhere"):
        state = native.read_json(RECORD / "state.json") or {}
        return native.alive(state.get("supervisor")) or (RECORD / "result.json").exists()
    return False


def follow(native):
    print(json.dumps({"schema": SCHEMA, "phase": "FOLLOWING_ORIGINAL_CUSTOMERS",
        "operationId": OPERATION, "record": str(RECORD),
        "native": native.report_value(native.inspect(RECORD), "summary")}), flush=True)
    outcome, offset = native.stream_log(RECORD, follow=True)
    print(json.dumps({"schema": SCHEMA, "operationId": OPERATION,
        "record": str(RECORD), "nextLogOffset": offset,
        "native": native.report_value(outcome, "summary")}), flush=True)
    return native.exit_status(outcome)


def load_preparation(path):
    selected = Path(path).resolve(strict=True)
    data = selected.read_bytes()
    if (not stat.S_ISREG(selected.lstat().st_mode) or len(data) != PREPARATION_BYTES or
            git_blob(data) != PREPARATION_BLOB):
        raise ValueError("Select the complete original source-preparation Git bytes")
    spec = importlib.util.spec_from_file_location("_original_8f43_preparation", selected)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if (module.ORIGINAL_BOOTSTRAP_BLOB != "9adadbb5a8ac4bf7cf94a686c2b4f871caec1d57" or
            module.ORIGINAL_LAUNCHER_BLOB != "af25db37758fe890fe3177b7f7cc63fb9b409365"):
        raise ValueError("Retain both original materialization callers")
    return module, data


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host-root", required=True, type=Path)
    parser.add_argument("--runtime-sha256", required=True,
                        help="native_runtime_handoff.runtime_identity from this complete installed host")
    parser.add_argument("--source-preparation", required=True, type=Path)
    args = parser.parse_args(argv)
    sys.dont_write_bytecode = True
    host = args.host_root.expanduser().resolve(strict=True)
    sys.path.insert(0, str(host))
    import native_foreground as foreground
    native = foreground.load_native(str(host))
    import native_runtime_handoff as handoff
    import native_artifact_checkpoints as checkpoints
    for module in (native, foreground, handoff, checkpoints):
        if Path(module.__file__).resolve().parent != host:
            raise ValueError("Use the complete installed native host as one selected source closure")
    runtime = handoff.runtime_identity(native)
    if (runtime["sha256"] != args.runtime_sha256 or
            getattr(native, "NATIVE_ARTIFACT_CHECKPOINT_SCHEMA", None) != checkpoints.SCHEMA or
            checkpoints.SCHEMA != "commons.native-artifact-checkpoint/v1"):
        raise ValueError("The selected complete checkpoint/handoff runtime differs")
    os.environ["SWARM_NODE24_BIN"] = str(Path(NODE).parent)
    preparation, preparation_bytes = load_preparation(args.source_preparation)
    selected = RECORD / "foreground-continuations" / sha256(HANDOFF_ID.encode())
    preserve = False
    with native.run_lock(RECORD):
        request(native)
        preserve = must_follow(native, handoff)
        retain(selected / "source-preparation.py", preparation_bytes)
        retain(selected / "foreground-continuation.py", Path(__file__).read_bytes())
        if not preserve:
            prepared = preparation.prepare_original_source()
            if (prepared["project"] != str(PROJECT) or prepared["records"] != str(RECORD.parent) or
                    prepared["sourceCommit"] != SOURCE_COMMIT or
                    prepared["intent"]["operationId"] != OPERATION):
                raise ValueError("The original prepared customer selection changed")
            current = active_handoff(native, handoff)
            selection = {"schema": SCHEMA, "operationId": OPERATION, "record": str(RECORD),
                "requestSha256": REQUEST_SHA256, "sourceCommit": SOURCE_COMMIT,
                "sourcePreparationBlob": PREPARATION_BLOB,
                "intentSha256": prepared["intentSha256"], "runtime": runtime,
                "handoffId": current["handoff_id"] if current else HANDOFF_ID,
                "launcher": "commons.native-cloud-foreground/v1"}
            retain(selected / "selection.json", canonical(selection))
    if preserve:
        return follow(native)
    current = active_handoff(native, handoff)
    if current is None:
        try:
            inspected = handoff.inspect(native, RECORD, HANDOFF_ID)
            if inspected["handoff"]["expected_request_sha256"] != REQUEST_SHA256:
                raise ValueError("The original request changed before its runtime handoff")
            handoff.prepare(native, RECORD, inspected["handoff"])
        except (OSError, ValueError):
            if must_follow(native, handoff):
                return follow(native)
            raise
    while True:
        request(native)
        if must_follow(native, handoff):
            return follow(native)
        # The maintained function performs acquisition AND finally-bound exec.
        # Even a lost acknowledgement or later journal-write failure retains
        # the newly acquired original supervisor in this exact private scope.
        outcome = foreground.resume_foreground(native, OPERATION, str(RECORD.parent),
            action="resume-capacity", report_format="summary")
        print(json.dumps({"schema": SCHEMA, "phase": "ORIGINAL_RUNTIME_HANDOFF",
            "operationId": OPERATION, "record": str(RECORD),
            "native": native.report_value(outcome, "summary")}), flush=True)
        if must_follow(native, handoff):
            return follow(native)
        time.sleep(2)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print(json.dumps({"schema": SCHEMA, "operationId": OPERATION, "record": str(RECORD),
            "state": "ORIGINAL_RECORD_RETAINED"}), file=sys.stderr, flush=True)
        raise SystemExit(130)
    except (OSError, EOFError, ValueError, KeyError, TypeError, ImportError, RuntimeError) as error:
        print(json.dumps({"schema": SCHEMA, "operationId": OPERATION, "record": str(RECORD),
            "state": "ORIGINAL_CONTINUATION_RETAINED",
            "error": type(error).__name__, "message": str(error)}), file=sys.stderr, flush=True)
        raise SystemExit(2)
