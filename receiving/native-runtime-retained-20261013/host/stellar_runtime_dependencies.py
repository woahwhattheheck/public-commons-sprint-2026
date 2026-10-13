#!/usr/bin/env python3
"""Receive a complete retained peer graph into a source-selected Starforge runtime.

The original Node borrower selects the complete lock graph, the original
materializer preserves its layout, and the original installer alone writes READY.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
from datetime import datetime, timezone

import node_dependency_borrow as borrow
import node_dependency_materialize as materializer

SCHEMA = "commons.stellar_runtime_dependencies/v1"
BRIDGE = Path(__file__).with_suffix(".mjs")
MAX_JSON = 16 * 1024 * 1024


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def digest(value):
    return materializer.digest(value)


def regular(path, maximum=MAX_JSON):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            raise ValueError("Select the original regular file: " + str(path))
        data = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        if len(data) != before.st_size or materializer.stable(before) != materializer.stable(after):
            raise ValueError("Original file changed while reading: " + str(path))
    if materializer.stable(Path(path).lstat()) != materializer.stable(after):
        raise ValueError("Original file path changed while reading: " + str(path))
    return data


def read_json(path):
    return json.loads(regular(path))


def private_directory(path, *, create=False):
    path = Path(path).absolute()
    if create:
        path.mkdir(mode=0o700, parents=False, exist_ok=True)
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or path.resolve(strict=True) != path
            or info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise ValueError("Use the original private directory owned by this operator: " + str(path))
    return path


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_bytes(path, data, *, replace=False):
    path = Path(path)
    private_directory(path.parent)
    fd, name = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    pending = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            os.replace(pending, path)
        else:
            try:
                os.link(pending, path)
            except FileExistsError:
                if regular(path) != data:
                    raise ValueError("An existing original file differs: " + str(path))
        sync_directory(path.parent)
    finally:
        pending.unlink(missing_ok=True)


def save(path, value, *, replace=False):
    write_bytes(path, (json.dumps(value, sort_keys=True, ensure_ascii=True,
        separators=(",", ":")) + "\n").encode(), replace=replace)


@contextmanager
def lease(path):
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        opened, named = os.fstat(fd), Path(path).lstat()
        if (not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1
                or opened.st_uid != os.getuid() or opened.st_mode & 0o077
                or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)):
            raise ValueError("Use the original private lease inode: " + str(path))
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield fd
    finally:
        os.close(fd)


def code_identity():
    return {name: sha(regular(path)) for name, path in (
        ("receiver", Path(__file__)), ("bridge", BRIDGE),
        ("borrower", Path(borrow.__file__)), ("materializer", Path(materializer.__file__)))}


def bridge(command, runtime, node, *, source=None, pass_fds=(), retained=None):
    argv = [node, str(BRIDGE.resolve()), command, str(runtime)]
    if source is not None:
        argv.append(str(source))
    result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, pass_fds=tuple(pass_fds), timeout=120, check=False)
    if retained is not None:
        save(retained, {"argv": argv, "exitCode": result.returncode,
            "stdout": result.stdout.decode("utf-8", "replace"),
            "stderr": result.stderr.decode("utf-8", "replace")}, replace=True)
    if len(result.stdout) > MAX_JSON:
        raise ValueError("The original installer returned an oversized response.")
    try:
        value = json.loads(result.stdout)
    except (ValueError, UnicodeError) as exc:
        raise ValueError("Original installer response is unavailable: " +
                         result.stderr.decode("utf-8", "replace")[-2000:]) from exc
    if result.returncode or value.get("ok") is not True:
        error = value.get("error", {})
        failure = RuntimeError(error.get("message", "Original installer did not complete."))
        failure.code = error.get("code", "ORIGINAL_INSTALLER")
        failure.result = value
        raise failure
    return value


def original_graph(source, lockfile):
    options = SimpleNamespace(borrow_node_modules=str(source), omit=[],
        target_os=None, target_cpu=None, target_libc=None, materialize_borrowed=False,
        reuse_node_modules=[], immutable_source_reference=None)
    report = borrow.build_plan(options, lockfile, source.parent)
    if report["outcome"] != "planned":
        raise ValueError("The retained full lock graph differs: " +
                         json.dumps(report["errors"], ensure_ascii=True))
    return report


def selected_tree(source):
    tree = materializer.tree(source)
    counts = {"files": 0, "directories": 0, "symlinks": 0, "logicalBytes": 0}
    outside = set()
    for row in tree["entries"]:
        key = {"file": "files", "directory": "directories", "symlink": "symlinks"}[row["kind"]]
        counts[key] += 1
        if row["kind"] == "file":
            counts["logicalBytes"] += row["bytes"]
        elif row["kind"] == "symlink" and os.path.isabs(row["target"]):
            target = Path(row["target"]).resolve(strict=True)
            if not target.is_relative_to(source):
                outside.add(str(target))
    return tree["tree_sha256"], counts, sorted(outside)


def checked_selection(path):
    value = read_json(path)
    body = {key: item for key, item in value.items() if key not in ("selectionSha256", "createdAt")}
    if value.get("schema") != SCHEMA or value.get("selectionSha256") != digest(body):
        raise ValueError("Use the complete original dependency selection.")
    return value


def operation_root(selection, *, create=False):
    runtime = private_directory(selection["runtime"]["directory"])
    parent = runtime / "dependency-receiving"
    if create:
        private_directory(parent, create=True)
    root = parent / sha(selection["operationId"].encode())
    return private_directory(root, create=create)


def plan(args):
    if (not args.operation_id or len(args.operation_id) > 512
            or any(ord(char) < 32 for char in args.operation_id)):
        raise ValueError("Use the existing printable operation ID.")
    runtime = private_directory(args.runtime)
    node_path = shutil.which(args.node_executable)
    if not node_path:
        raise ValueError("Select the existing Node executable.")
    node = str(Path(node_path).resolve(strict=True))
    observed = bridge("inspect", runtime, node)
    if not observed["adoptionAvailable"]:
        raise ValueError("This source edition predates explicit dependency adoption; prepare the updated original release.")
    source = Path(args.source_node_modules).absolute().resolve(strict=True)
    if source.name != "node_modules" or not source.is_dir() or source.is_relative_to(runtime):
        raise ValueError("Select the complete original external node_modules installation.")
    lockfile = Path(args.lockfile).absolute().resolve(strict=True)
    lock_bytes = regular(lockfile)
    lock_sha = sha(lock_bytes)
    if args.expected_lock_sha256 and lock_sha != args.expected_lock_sha256:
        raise ValueError("The original owner-selected lock hash differs.")
    graph = original_graph(source, lockfile)
    tree_sha, counts, outside = selected_tree(source)
    if args.expected_tree_sha256 and tree_sha != args.expected_tree_sha256:
        raise ValueError("The original owner-selected installed tree hash differs.")
    donor_check = bridge("probe", runtime, node, source=source.parent)
    if donor_check["inspection"].get("ready") is not True:
        raise ValueError("The original graph does not satisfy the selected profile on this host: " +
                         json.dumps(donor_check["inspection"], ensure_ascii=True))
    reuse = list(dict.fromkeys(str(Path(path).absolute().resolve(strict=True))
                              for path in args.reuse_node_modules))
    if any(Path(path).is_relative_to(runtime) for path in reuse):
        raise ValueError("Select retained reuse sources outside the receiving runtime.")
    if not args.reference.strip():
        raise ValueError("Supply the original immutable graph ownership reference.")
    value = {"schema": SCHEMA, "operationId": args.operation_id,
        "runtime": observed["runtime"], "nodeExecutable": node,
        "receiverCode": code_identity(), "host": observed["host"],
        "source": {"directory": str(source), "lockfile": str(lockfile),
            "lockSha256": lock_sha, "lockBytes": len(lock_bytes),
            "inventorySha256": graph["inventory_sha256"], "treeSha256": tree_sha,
            "immutableReference": args.reference.strip(), "counts": counts,
            "packageCount": graph["counts"]["matched"], "externalPaths": outside},
        "reuseNodeModules": reuse}
    value = {**value, "selectionSha256": digest(value), "createdAt": now()}
    output = Path(args.out).absolute()
    if output.exists():
        previous = checked_selection(output)
        if previous["selectionSha256"] != value["selectionSha256"]:
            raise ValueError("The existing receiving selection differs; retain its original file.")
        value = previous
    else:
        save(output, value)
    state_path = runtime / "dependency-receiving" / sha(args.operation_id.encode()) / "state.json"
    return {"selection": str(output), "selectionSha256": value["selectionSha256"],
        "runtime": value["runtime"], "source": value["source"],
        "operationState": str(state_path)}


def original_runtime_matches(selection, result):
    if result.get("runtime") != selection["runtime"]:
        raise ValueError("The original runtime/profile/source selection changed.")
    if result.get("host") != selection["host"]:
        raise ValueError("The selected receiving Node version/platform/architecture changed.")


def matching_materialization(selection, destination):
    path = destination / materializer.RECEIPT
    if not path.exists():
        return None
    value = read_json(path)
    source = selection["source"]
    if (value.get("schema") != materializer.SCHEMA or value.get("outcome") != "materialized"
            or value.get("destination") != str(destination)
            or value.get("source_tree_sha256") != source["treeSha256"]
            or value.get("immutable_reference") != source["immutableReference"]
            or not any(row.get("path") == source["directory"] for row in value.get("sources", []))):
        return None
    if materializer.tree(destination)["tree_sha256"] != source["treeSha256"]:
        raise ValueError("The published received graph changed from its selected original.")
    return value


def retained_identity(path):
    info = path.lstat()
    value = {"device": info.st_dev, "inode": info.st_ino, "mode": info.st_mode}
    if stat.S_ISREG(info.st_mode):
        value["sha256"] = sha(regular(path))
    elif stat.S_ISLNK(info.st_mode):
        value["target"] = os.readlink(path)
    return value


def retain_previous(root, runtime, name, state):
    backup_root = private_directory(root / "previous-install", create=True)
    source, destination = runtime / name, backup_root / name
    recorded = state.setdefault("previous", {}).get(name)
    if destination.exists() or destination.is_symlink():
        if not recorded or retained_identity(destination) != recorded:
            raise ValueError("Retained original installation entry differs: " + name)
        if source.exists() or source.is_symlink():
            raise ValueError("Another installation entry now occupies " + name)
        return
    if not (source.exists() or source.is_symlink()):
        return
    actual = retained_identity(source)
    if recorded and recorded != actual:
        raise ValueError("Original entry changed after its retention intent: " + name)
    state["previous"][name] = actual
    save(root / "state.json", state, replace=True)
    materializer._publish(source, destination)
    sync_directory(runtime)
    sync_directory(backup_root)


def materialization_stage(root, public, state):
    path = root / "installed-stage"
    recorded = state.get("materializationStage")
    if recorded is not None:
        if (recorded.get("path") != str(path)
                or recorded.get("identity", {}).get("selection_sha256") != public["selection_sha256"]):
            raise ValueError("The recorded receiving stage belongs to another source selection.")
        return path, recorded["identity"]
    stage = private_directory(path, create=True)
    if any(stage.iterdir()):
        raise ValueError("An unrecorded receiving stage is not empty: " + str(stage))
    info = stage.lstat()
    identity = {"device": info.st_dev, "inode": info.st_ino,
        "selection_sha256": public["selection_sha256"]}
    state["materializationStage"] = {"path": str(stage), "identity": identity}
    sync_directory(root)
    save(root / "state.json", state, replace=True)
    return stage, identity


def dependency_lifetimes(selection):
    # Physical hardlinks retain their inodes after a donor path is retired.
    # Absolute links retain path dependencies, which following jobs must declare.
    return list(dict.fromkeys([selection["runtime"]["directory"],
        *selection["source"]["externalPaths"]]))


def refresh_original_native():
    record = os.environ.get("SWARM_NATIVE_RECORD")
    if not record:
        return None
    from runtime_consumers import refresh
    result = refresh(Path(record))
    if result is None:
        return None
    return {"record": record, "operationId": os.environ.get("SWARM_NATIVE_OPERATION_ID"),
        "registration": result.get("registration")}


def receive(selection_path):
    selection = checked_selection(selection_path)
    root = operation_root(selection, create=True)
    runtime = Path(selection["runtime"]["directory"])
    node = selection["nodeExecutable"]
    with lease(root / "receiver.lock") as receiver_fd:
        save(root / "selection.json", selection)
        state_path = root / "state.json"
        state = read_json(state_path) if state_path.exists() else {
            "schema": SCHEMA, "operationId": selection["operationId"],
            "selectionSha256": selection["selectionSha256"], "phase": "SELECTED", "createdAt": now()}
        if state.get("selectionSha256") != selection["selectionSha256"]:
            raise ValueError("This runtime operation already holds another selection.")
        if code_identity() != selection["receiverCode"]:
            raise ValueError("The selected receiver source changed; use the original source closure.")
        try:
            with lease(runtime / "install.lock") as install_fd:
                observed = bridge("inspect", runtime, node, pass_fds=(receiver_fd, install_fd),
                                  retained=root / "original-inspection.json")
                original_runtime_matches(selection, observed)
                destination = runtime / "node_modules"
                materialized = matching_materialization(selection, destination)
                lock_target = runtime / "package-lock.json"
                target_lock = sha(regular(lock_target)) if lock_target.exists() else None
                if observed["inspection"]["status"] == "READY":
                    if (materialized is None or target_lock != selection["source"]["lockSha256"]
                            or observed["inspection"].get("ready") is not True):
                        raise ValueError("Preserve this READY runtime; its original received graph differs.")
                else:
                    source = Path(selection["source"]["directory"])
                    if materialized is None:
                        lockfile = Path(selection["source"]["lockfile"])
                        lock_bytes = regular(lockfile)
                        if sha(lock_bytes) != selection["source"]["lockSha256"]:
                            raise ValueError("The original full lock changed after selection.")
                        graph = original_graph(source, lockfile)
                        if graph["inventory_sha256"] != selection["source"]["inventorySha256"]:
                            raise ValueError("The installed source identity changed after selection.")
                        donor_check = bridge("probe", runtime, node, source=source.parent,
                            pass_fds=(receiver_fd, install_fd), retained=root / "original-source-check.json")
                        if donor_check["inspection"].get("ready") is not True:
                            raise ValueError("The selected original graph no longer loads on this host.")
                        if selected_tree(source)[0] != selection["source"]["treeSha256"]:
                            raise ValueError("The complete original installed source bytes changed.")
                        state.update(phase="RECEIVING", updatedAt=now())
                        save(state_path, state, replace=True)
                        retain_previous(root, runtime, "node_modules", state)
                        public, private = materializer.build(source, destination,
                            reuse_roots=selection["reuseNodeModules"],
                            reference=selection["source"]["immutableReference"])
                        if public["source_tree_sha256"] != selection["source"]["treeSha256"]:
                            raise ValueError("The original installed graph changed during selection.")
                        stage_path, stage_identity = materialization_stage(root, public, state)
                        materialized = materializer.materialize(public, private,
                            stage_path=stage_path, stage_identity=stage_identity)
                    if target_lock != selection["source"]["lockSha256"]:
                        lock_bytes = regular(Path(selection["source"]["lockfile"]))
                        if sha(lock_bytes) != selection["source"]["lockSha256"]:
                            raise ValueError("The original lock changed before receiving.")
                        retain_previous(root, runtime, "package-lock.json", state)
                        write_bytes(lock_target, lock_bytes)
                    state.update(phase="RECEIVED", materialization=materialized, updatedAt=now())
                    save(state_path, state, replace=True)
                state.update(phase="ADOPTING", materialization=materialized, updatedAt=now())
                native_use = refresh_original_native()
                if native_use is not None:
                    state["nativeRuntimeUse"] = native_use
                save(state_path, state, replace=True)
            # The original installer now takes its own lease. A competing writer
            # returns its original busy result, and this same selection can resume.
            adoption = bridge("adopt", runtime, node, pass_fds=(receiver_fd,),
                              retained=root / "original-adoption.json")
            if adoption["result"].get("status") != "READY":
                raise ValueError("The original installer did not return READY.")
            state.update(phase="COMPLETE", result=adoption["result"],
                requiredRuntimePaths=dependency_lifetimes(selection), completedAt=now(), updatedAt=now())
            state.pop("error", None)
            save(state_path, state, replace=True)
            return {"operationId": selection["operationId"], "phase": state["phase"],
                "selectionSha256": selection["selectionSha256"], "state": str(state_path),
                "materialization": materialized, "runtime": adoption["result"],
                "requiredRuntimePaths": dependency_lifetimes(selection)}
        except Exception as exc:
            state.update(updatedAt=now(), error={"code": getattr(exc, "code", type(exc).__name__),
                "message": str(exc), "at": now()})
            try:
                save(state_path, state, replace=True)
            except OSError as retention_error:
                print(json.dumps({"errorRetention": str(retention_error),
                    "originalError": str(exc), "state": str(state_path)}), file=sys.stderr)
            raise


def native(args):
    from swarm_cloud_job import launch_selected
    selection_path = Path(args.selection).absolute().resolve(strict=True)
    selection = checked_selection(selection_path)
    if args.operation_id != selection["operationId"]:
        raise ValueError("Continue the original selected operation ID.")
    runtime = Path(selection["runtime"]["directory"])
    project = Path(args.project).absolute().resolve(strict=True)
    if not runtime.is_relative_to(project):
        raise ValueError("The original native project must contain this selected runtime.")
    source = selection["source"]
    paths = [str(Path(__file__).resolve().parent), str(selection_path), str(runtime),
        selection["nodeExecutable"], source["directory"], source["lockfile"],
        *source["externalPaths"], *selection["reuseNodeModules"]]
    argv = [sys.executable, "-B", str(Path(__file__).resolve()), "receive", "--selection", str(selection_path)]
    state_path = runtime / "dependency-receiving" / sha(selection["operationId"].encode()) / "state.json"
    selected = SimpleNamespace(**{**vars(args), "action": "start" if args.detach else "run",
        "command": argv, "runtime_path": list(dict.fromkeys([*(args.runtime_path or []), *paths])),
        "artifact_on_success": list(dict.fromkeys([*(args.artifact_on_success or []),
            state_path.relative_to(project).as_posix()]))})
    return launch_selected(selected)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command_name", required=True)
    prepare = sub.add_parser("plan", help="select the actual runtime, original lock and complete installed graph")
    prepare.add_argument("--operation-id", required=True)
    prepare.add_argument("--runtime", required=True)
    prepare.add_argument("--source-node-modules", required=True)
    prepare.add_argument("--lockfile", required=True)
    prepare.add_argument("--reference", required=True)
    prepare.add_argument("--reuse-node-modules", action="append", default=[])
    prepare.add_argument("--expected-lock-sha256")
    prepare.add_argument("--expected-tree-sha256")
    prepare.add_argument("--node-executable", default="node")
    prepare.add_argument("--out", required=True)
    for action in ("receive", "status"):
        child = sub.add_parser(action)
        child.add_argument("--selection", required=True)
    guarded = sub.add_parser("native", help="receive through the original native worker and capacity lifecycle")
    if argv and argv[0] == "native":
        from swarm_cloud_job import launch_options
        launch_options(guarded)
        guarded.add_argument("--selection", required=True)
        guarded.add_argument("--detach", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command_name == "native":
            return native(args)
        if args.command_name == "plan":
            result = plan(args)
        elif args.command_name == "receive":
            result = receive(args.selection)
        else:
            selected = checked_selection(args.selection)
            result = read_json(operation_root(selected) / "state.json")
        print(json.dumps(result, ensure_ascii=True))
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        print(json.dumps({"error": {"code": getattr(exc, "code", type(exc).__name__),
            "message": str(exc)}, "selection": getattr(args, "selection", None)}), file=sys.stderr)
        return 75 if isinstance(exc, BlockingIOError) or getattr(exc, "code", None) == "RUNTIME_INSTALL_ALREADY_RUNNING" else 1


if __name__ == "__main__":
    raise SystemExit(main())
