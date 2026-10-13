#!/usr/bin/env python3
"""Continue the retained installed Datasette workspace through complete Conapi delivery.

Run on the same original receiver after installed-browser-journey.json reaches
COMPLETE. All native child work, complete archive capture and canonical saves
finish within this receiving process.
"""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import traceback

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
from preserve_delivery import atomic_json, save_complete_delivery
from workbook_following import run_workbook_following

SOURCE_REF = "e5520a2a962ccebc461d478edf6aebb4b6c7fb20"
ORIGINAL_OPERATION = "SCF-DATASETTE-SOURCE-EDITIONS-07476-20261012"
PRODUCT_OPERATION = "CONAPI-WORKFLOW-RECEIVING-DSCEB3-20261012"


def read(path):
    return json.loads(Path(path).read_bytes())


_observer_closed = False


def emit(value):
    global _observer_closed
    if _observer_closed:
        return
    try:
        print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)
    except BrokenPipeError:
        # The same native work and canonical saves outlive a lost observer.
        _observer_closed = True


def observe_capacity():
    result = {"at": time.time(), "filesystems": {}, "cgroup": {}}
    for name in ("memory.current", "memory.max", "memory.stat", "memory.events"):
        path = Path("/sys/fs/cgroup") / name
        try:
            result["cgroup"][name] = path.read_text().strip()
        except OSError as error:
            result["cgroup"][name] = {"errno": error.errno}
    for path in ("/workspace", "/tmp", "/dev", "/dev/shm", "/mnt/data"):
        try:
            state = os.statvfs(path)
            result["filesystems"][path] = {"available_bytes": state.f_bavail * state.f_frsize,
                                          "free_bytes": state.f_bfree * state.f_frsize,
                                          "free_inodes": state.f_favail}
        except OSError as error:
            result["filesystems"][path] = {"errno": error.errno}
    return result


def run_native(command, root, *, lease, interruption, label="conapi-native",
               operation=PRODUCT_OPERATION, source_ref=SOURCE_REF):
    """Keep full output and the original lock with the accepted native child."""
    output, error = root / (label + ".stdout"), root / (label + ".stderr")
    if interruption:
        return {"returncode": 128 + interruption["number"], "started": False,
                "stdout": str(output), "stderr": str(error)}
    with output.open("ab", buffering=0) as out, error.open("ab", buffering=0) as err:
        offsets = {"stdout": out.tell(), "stderr": err.tell()}
        # Closing this wrapper must not revoke the child's flock or break its
        # stdout/stderr pipes. The child owns the same open file description;
        # its complete logs go directly to the original append-only files.
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=out,
                                   stderr=err, cwd=root, start_new_session=True,
                                   pass_fds=(lease.fileno(),))
        pending = {"stdout": b"", "stderr": b""}
        dropping = {"stdout": False, "stderr": False}
        interruption_reported = False
        receipt_path = root / "conapi-native-invocations" / (str(time.time_ns()) + "-" + str(process.pid) + ".json")
        receipt = {"schema": "commons.conapi-native-invocation.v1", "operation": operation,
                   "sourceRef": source_ref, "state": "ACCEPTED", "pid": process.pid,
                   "command": list(command), "startedAt": time.time(),
                   "stdout": str(output), "stderr": str(error)}

        def progress(kind, block):
            pieces = block.split(b"\n")
            for index, piece in enumerate(pieces):
                if not dropping[kind]:
                    if len(pending[kind]) + len(piece) > 20000:
                        pending[kind] = b""
                        dropping[kind] = True
                    else:
                        pending[kind] += piece
                if index != len(pieces) - 1:
                    line = pending[kind]
                    if not dropping[kind] and line.startswith(b"{"):
                        try:
                            parsed = json.loads(line)
                            if isinstance(parsed, dict) and any(name in parsed for name in ("stage", "phase", "state")):
                                emit({"stage": "conapi_native_progress", "channel": kind, "event": parsed})
                        except ValueError:
                            pass
                    pending[kind] = b""
                    dropping[kind] = False

        try:
            atomic_json(receipt_path, receipt)
            emit({"stage": "conapi_native_accepted", "pid": process.pid, "root": str(root),
                  "source_ref": source_ref, "operation": operation,
                  "lease": "inherited-original-open-file-description", "receipt": str(receipt_path),
                  "stdout": str(output), "stderr": str(error)})
            with output.open("rb") as observed_out, error.open("rb") as observed_err:
                observed_out.seek(offsets["stdout"])
                observed_err.seek(offsets["stderr"])
                while True:
                    advanced = False
                    for kind, observed in (("stdout", observed_out), ("stderr", observed_err)):
                        block = observed.read(65536)
                        if block:
                            advanced = True
                            progress(kind, block)
                    if interruption and not interruption_reported:
                        emit({"stage": "conapi_native_shutdown_deferred", **interruption,
                              "pid": process.pid, "action": "complete-original-child-then-save"})
                        interruption_reported = True
                    if process.poll() is not None and not advanced:
                        break
                    if not advanced:
                        time.sleep(0.2)
        finally:
            # Observer, output or wrapper errors still wait for the exact
            # accepted process. Capture cannot run while it is writing.
            code = process.wait()
            os.fsync(out.fileno())
            os.fsync(err.fileno())
            receipt.update({"state": "CLOSED", "returncode": code, "completedAt": time.time(),
                            "interruption": dict(interruption) or None})
            atomic_json(receipt_path, receipt)
    return {"returncode": code, "started": True, "pid": process.pid, "receipt": str(receipt_path),
            "stdout": str(output), "stderr": str(error),
            "completedAt": time.time(), "interruption": dict(interruption) or None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--transfer-directory", type=Path)
    parser.add_argument("--transport-programme", type=Path)
    parser.add_argument("--transport-metadata", type=Path)
    parser.add_argument("--flow-delivery", type=Path)
    parser.add_argument("--workbook-source-root", type=Path,
                        help="Existing complete checkout with the merged workbook PR883 source.")
    parser.add_argument("--workbook-output", type=Path,
                        help="Original workbook output directory when continuing an already selected run.")
    args = parser.parse_args()
    root = args.root
    if not root.is_absolute() or root.resolve() != root:
        raise ValueError("Use the complete original canonical Datasette workspace.")
    source_identity = read(root / "delivery-input.json")
    if source_identity["operation"] != ORIGINAL_OPERATION:
        raise ValueError("The retained workspace belongs to another operation.")
    installed = read(root / "installed/installed-browser-journey.json")
    if installed.get("phase") != "COMPLETE":
        raise ValueError("Continue the original installed Datasette programme before joining Conapi.")
    original_input = read(root / "installed-input.json")
    os.umask(0o077)
    sys.dont_write_bytecode = True
    helpers = root / "helpers"
    for name in ("library_upload.py", "library_hosted_apps.py", "library_file_transfer.py", "library_private_upload.py"):
        if not (helpers / name).is_file():
            raise ValueError("Retain the original unchanged canonical helper: " + name)
    transfer = (args.transfer_directory or Path(os.environ.get("DATASETTE_TRANSFER_DIRECTORY", str(root))))
    if not transfer.is_absolute() or transfer.resolve() != transfer:
        raise ValueError("Use the actual original canonical transfer directory.")
    transfer.mkdir(mode=0o700, parents=True, exist_ok=True)
    private_state = transfer / "conapi-upload-state"
    private_state.mkdir(mode=0o700, exist_ok=True)
    os.environ["TMPDIR"] = str(private_state)
    os.environ.setdefault("AZCOPY_CONCURRENCY_VALUE", "4")
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    os.environ["GIT_TERMINAL_PROMPT"] = "0"
    node = Path(os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or
                "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node")
    os.environ["PATH"] = str(node.parent) + os.pathsep + os.environ.get("PATH", "")
    os.environ["npm_config_update_notifier"] = "false"
    cache = Path(original_input["npmCache"])
    if not cache.is_dir():
        cache = private_state / "npm-cache"
        cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.environ["npm_config_cache"] = str(cache)
    output = root / "conapi-native"
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = (root / "conapi-native-continuation.lock").open("a+b")
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    interruption = {}
    previous_signals = {}

    def retain_shutdown(number, _frame):
        if not interruption:
            interruption.update({"number": number, "signal": signal.Signals(number).name,
                                 "requestedAt": time.time(),
                                 "policy": "complete-original-child-and-save"})

    try:
        for number in (signal.SIGINT, signal.SIGTERM):
            previous_signals[number] = signal.signal(number, retain_shutdown)
        selected = {
            "repository": str(root / "canonical-repository"), "outputDirectory": str(output),
            "publisherProgrammeDirectory": str(root / "journey"),
            "completedDatasetteReport": str(root / "installed/installed-browser-journey.json"),
            "supplierProgramme": str(HERE / "supplier_programme.py"),
            "python": original_input["python"], "npm": original_input.get("npm", str(node.parent / "npm")),
            "npmCache": str(cache), "browserExecutable": original_input["browserExecutable"],
            "playwrightModule": original_input["playwrightModule"],
        }
        if args.transport_programme:
            selected["transportProgramme"] = str(args.transport_programme.resolve(strict=True))
        if args.transport_metadata:
            metadata_path = args.transport_metadata.resolve(strict=True)
            selected["transportMetadata"] = read(metadata_path)
        if args.flow_delivery:
            selected["flowDelivery"] = str(args.flow_delivery.resolve(strict=True))
        input_path = root / "conapi-installed-input.json"
        atomic_json(input_path, selected)
        capacity = observe_capacity()
        atomic_json(root / "conapi-capacity-before.json", capacity)
        emit({"stage": "conapi_original_programme_joined", "operation": PRODUCT_OPERATION,
              "original_operation": ORIGINAL_OPERATION, "root": str(root), "source_ref": SOURCE_REF,
              "procfs_pid": os.readlink("/proc/self"), "capacity": capacity})
        result = {"schema": "commons.conapi-complete-delivery.v1", "operation": PRODUCT_OPERATION,
                  "originalOperation": ORIGINAL_OPERATION, "sourceRef": SOURCE_REF,
                  "startedAt": time.time(), "state": "PRESERVED_FOR_CONTINUATION"}
        try:
            result["native"] = run_native([str(node), str(HERE / "run_conapi.mjs"), "--input", str(input_path)],
                                         root, lease=lock, interruption=interruption)
            state_file = output / "conapi-operating-programme.json"
            if state_file.is_file():
                result["programme"] = read(state_file)
                if result["native"]["returncode"] == 0:
                    result["state"] = result["programme"]["phase"]
            if result["native"]["returncode"] != 0:
                result["error"] = {"message": "The original native programme returned " + str(result["native"]["returncode"]),
                                   "stderr": result["native"]["stderr"]}
            if result["native"]["returncode"] == 0 and result["state"] in ("COMPLETE", "SUPPLIER_RECEIVING_COMPLETE"):
                original_phase = result["state"]
                result["state"] = "WORKBOOK_CONTINUATION"
                result["workbook"] = run_workbook_following(
                    root=root, node=node, original_input=original_input, programme=result["programme"],
                    source_root=args.workbook_source_root, output_directory=args.workbook_output, emit=emit,
                    run_native=lambda command: run_native(
                        command, root, lease=lock, interruption=interruption,
                        label="conapi-workbook-native",
                        operation="CONAPI-SUPPLIER-WORKBOOK-RECEIVING-7A2F-20261012",
                        source_ref=command[command.index("--source-commit") + 1]))
                result["state"] = original_phase
            result["finishedAt"] = time.time()
            result["capacityAfter"] = observe_capacity()
        except BaseException as error:
            result["error"] = {"type": type(error).__name__, "message": str(error),
                               "traceback": traceback.format_exc()}
        finally:
            result["interruption"] = dict(interruption) or None
            report = root / "Conapi_Complete_Operating_Result.json"
            atomic_json(report, result)
            excluded = [root / "private-temp", root / "export", cache]
            saved = save_complete_delivery(root=root, export=transfer / "conapi-export", helpers=helpers,
                helper_state=private_state, report=report, operation=ORIGINAL_OPERATION,
                source_identity={**source_identity, "conapi_source_ref": SOURCE_REF},
                filename="Conapi_Complete_Operating_Checkpoint.zip", excluded=excluded, emit=emit)
            atomic_json(root / "Conapi_Complete_Delivery_Saved.json", saved)
            emit({"stage": "conapi_complete_delivery_saved", "operation": PRODUCT_OPERATION, **saved})
        if interruption:
            return 128 + interruption["number"]
        return 0 if result["state"] in ("COMPLETE", "SUPPLIER_RECEIVING_COMPLETE") else 1

    finally:
        # Close our reference only. LOCK_UN would release the shared lease
        # even if an abruptly surviving native child still held its fd.
        lock.close()
        for number, previous in previous_signals.items():
            signal.signal(number, previous)


if __name__ == "__main__":
    raise SystemExit(main())
