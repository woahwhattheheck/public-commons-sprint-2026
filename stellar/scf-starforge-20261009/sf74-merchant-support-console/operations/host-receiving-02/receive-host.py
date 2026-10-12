#!/usr/bin/env python3
"""Receive the original SF74 continuation on the current equipped host."""
from __future__ import annotations
import argparse, ast, datetime, fcntl, hashlib, importlib.util, json, os, stat, sys, uuid
from pathlib import Path

OP = "BC08-SF74-NATIVE06-COMMERCIAL-RECEIVING-20261012"
NATIVE_OP = OP + "-02"
SOURCE_SCHEMA = "stellar-forge.native06-host-receiving-source.v1"
SELECTION_SCHEMA = "stellar-forge.native06-host-selection.v1"
HISTORY_SCHEMA = "stellar-forge.native06-registration-observations.v1"
RUNTIME_SCHEMA = "stellar-forge.native06-equipped-runtime.v1"
SOURCE_NAMES = {"receive-host.py", "HOST-SELECTION.json", "REGISTRATION-HISTORY.json", "README.md"}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()

def absolute(value):
    if not isinstance(value, str) or not value or "\0" in value:
        raise ValueError("Use an explicit absolute path")
    path = Path(value)
    if not path.is_absolute() or str(path) != os.path.normpath(value):
        raise ValueError("Use normalized absolute paths")
    return path

def relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Invalid selected source path")
    if value.startswith("/") or any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError("Source paths must remain in the selected directory")
    return value

def regular(path, maximum=8 * 1024 * 1024):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            raise ValueError("Use a bounded original regular file: " + str(path))
        data = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns")
        if len(data) > maximum or any(getattr(before, k) != getattr(after, k) for k in fields):
            raise ValueError("Selected file changed while reading: " + str(path))
        return data

def fingerprint(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > 512 * 1024 * 1024:
            raise ValueError("Use a bounded existing runtime file: " + str(path))
        digest = hashlib.sha256()
        total = 0
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            total += len(block)
            digest.update(block)
        after = os.fstat(stream.fileno())
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns")
        if total != before.st_size or any(getattr(before, k) != getattr(after, k) for k in fields):
            raise ValueError("Runtime changed during receiving: " + str(path))
        return {"bytes": total, "sha256": digest.hexdigest()}

def check(data, row):
    if len(data) != row["bytes"] or sha(data) != row["sha256"]:
        raise ValueError("Selected source bytes differ: " + str(row.get("path", row.get("name", "input"))))
    if row.get("blob") and git_blob(data) != row["blob"]:
        raise ValueError("Selected Git source differs")

def private(path):
    if not path.is_absolute() or str(path) != os.path.normpath(str(path)):
        raise ValueError("Use normalized private paths")
    if path.exists() or path.is_symlink():
        entry = path.lstat()
        if not stat.S_ISDIR(entry.st_mode) or entry.st_uid != os.getuid() or entry.st_mode & 0o077:
            raise ValueError("Preserve a differently owned or nonprivate directory: " + str(path))
        return
    # Existing ancestors can be shared; this operation creates only its owned child.
    path.mkdir(parents=True, mode=0o700)
    if path.lstat().st_mode & 0o077:
        raise ValueError("Private directory mode differs")

def retain(path, data):
    if path.exists() or path.is_symlink():
        if regular(path, max(len(data), 1)) != data:
            raise ValueError("Preserve divergent retained bytes: " + str(path))
        return
    private(path.parent)
    temporary = path.with_name(path.name + ".writing-" + uuid.uuid4().hex)
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if regular(path, max(len(data), 1)) != data:
                raise ValueError("Concurrent retained bytes differ")
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

def source_bundle(expected_sha):
    root = Path(__file__).resolve().parent
    raw = regular(root / "SOURCE.json")
    if sha(raw) != expected_sha:
        raise ValueError("Select the exact published host receiving source")
    source = json.loads(raw)
    if source.get("schema") != SOURCE_SCHEMA or source.get("nativeOperation") != NATIVE_OP:
        raise ValueError("Host receiving source belongs to another operation")
    rows = source.get("files", [])
    if len(rows) != len(SOURCE_NAMES) or {r["path"] for r in rows} != SOURCE_NAMES:
        raise ValueError("The complete host receiving programme is required")
    bodies = {}
    for row in rows:
        name = relative(row["path"])
        body = regular(root / name)
        check(body, row)
        bodies[name] = body
    ast.parse(bodies["receive-host.py"], filename="receive-host.py")
    selection = json.loads(bodies["HOST-SELECTION.json"])
    history = json.loads(bodies["REGISTRATION-HISTORY.json"])
    if (selection.get("schema") != SELECTION_SCHEMA or selection.get("nativeOperation") != NATIVE_OP
            or selection.get("businessOperation") != OP):
        raise ValueError("Preserve the original business and native operation identities")
    if (history.get("schema") != HISTORY_SCHEMA or history.get("nativeOperation") != NATIVE_OP
            or history.get("interpretation", {}).get("requestCreated") is not False
            or history.get("interpretation", {}).get("applicationDispatched") is not False):
        raise ValueError("Use the exact original registration observations")
    # These are historical tool results, never synthetic native controller records.
    observed = history.get("observations", [])
    if [r.get("result", {}).get("chunk_id") for r in observed] != ["bc2dbc", "277fdd", "c78d88"]:
        raise ValueError("Original registration observation identities differ")
    last = observed[-1]["result"]
    lines = [json.loads(line) for line in last["output"].splitlines() if line.strip()]
    if last.get("exit_code") != 0 or lines[-1] != {"files": [{"name": ".lock", "bytes": 0}]}:
        raise ValueError("The original partial-record observation is not the selected one")
    return root, raw, bodies, selection

def verify_originals(selection):
    paths = {key: absolute(value) for key, value in selection["paths"].items()}
    native = selection["native"]
    for row in native["files"]:
        check(regular(paths["nativeRoot"] / relative(row["path"])), row)
    for row in selection["companion"]["files"]:
        check(regular(paths["companion"] / row["name"]), row)
    for row in selection["libraryHelpers"]:
        check(regular(paths["libraryHelpers"] / row["name"]), row)
    builder_path = paths["companion"] / "receive-correction.py"
    ast.parse(regular(builder_path), filename=str(builder_path))
    builder = module("sf74_original_correction_receiver", builder_path)
    declaration, carrier = builder.receive(argparse.Namespace(
        original_carrier_zip=None, original_carrier_directory=str(paths["originalCarrier"]),
        carrier=str(paths["correctedCarrier"])))
    if (declaration["nativeOperation"] != NATIVE_OP or declaration["businessOperation"] != OP
            or declaration["corrected"]["sourceManifestSha256"] != selection["sourceManifestSha256"]):
        raise ValueError("The corrected source belongs to another original operation")
    host = module("sf74_original_corrected_native_host", carrier / "native06-native-host-02.py")
    if host.OP != OP or host.NATIVE_OP != NATIVE_OP or host.SOURCE_SHA != selection["sourceManifestSha256"]:
        raise ValueError("The retained original host entrypoint differs")
    private(paths["work"])
    host.retain_predecessor(paths["predecessor"], paths["work"])
    return paths, host

def runtime_files(selection, paths):
    runtime = selection["runtime"]
    roots = [absolute(value) for value in runtime["directories"]]
    files = {}
    total = 0
    for selected_root in roots:
        root = selected_root.resolve(strict=True)
        if not root.is_dir():
            raise ValueError("Select the existing runtime directory: " + str(selected_root))
        for folder, directories, names in os.walk(root, followlinks=False):
            directories[:] = sorted(d for d in directories if d not in ("__pycache__", ".cache"))
            for name in directories:
                if (Path(folder) / name).is_symlink():
                    raise ValueError("Unselected linked runtime directory: " + str(Path(folder) / name))
            for name in sorted(names):
                path = Path(folder) / name
                if path.is_symlink():
                    # A selected runtime link must resolve inside this exact runtime.
                    resolved = path.resolve(strict=True)
                    if not resolved.is_relative_to(root) or not resolved.is_file():
                        raise ValueError("Runtime file link leaves its selected installation")
                    row = {"path": str(path), "target": str(resolved), **fingerprint(resolved)}
                else:
                    row = {"path": str(path), **fingerprint(path)}
                files[str(path)] = row
                total += row["bytes"]
                if len(files) > 4096 or total > 768 * 1024 * 1024:
                    raise ValueError("The selected runtime exceeds this bounded receiving contract")
    for name, value in runtime["executables"].items():
        path = absolute(value)
        resolved = path.resolve(strict=True)
        if not os.access(path, os.X_OK):
            raise ValueError("The selected existing executable is unavailable: " + name)
        files[str(path)] = {"path": str(path), "role": name,
                            **({"target": str(resolved)} if resolved != path else {}),
                            **fingerprint(resolved)}
    for name in ("playwright", "chromium", "node", "dependencies"):
        if not paths[name].exists():
            raise ValueError("The selected existing runtime path is absent: " + name)
    if not paths["dependencies"].is_dir():
        raise ValueError("Select the existing dependency directory")
    return [files[name] for name in sorted(files)]

def runtime_receipt(root, source_sha, selection, paths, required_sha=None):
    receipt_path = root / "received" / "RUNTIME.json"
    rows = runtime_files(selection, paths)
    binding = {"schema": RUNTIME_SCHEMA, "nativeOperation": NATIVE_OP,
               "hostReceivingSourceSha256": source_sha, "nativeSourceCommit": selection["native"]["commit"],
               "nodeModules": str(paths["dependencies"].resolve(strict=True)),
               "directoryTargets": [{"path": value, "resolved": str(absolute(value).resolve(strict=True))}
                                    for value in selection["runtime"]["directories"]],
               "files": rows}
    if receipt_path.exists() or receipt_path.is_symlink():
        raw = regular(receipt_path)
        value = json.loads(raw)
        if {k: v for k, v in value.items() if k != "receivedAt"} != binding:
            raise ValueError("Preserve the prior differently selected equipped runtime")
    else:
        if required_sha:
            raise ValueError("The original admitted runtime receipt is missing; restore it exactly")
        value = {**binding, "receivedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
        raw = encoded(value)
        retain(receipt_path, raw)
    if required_sha and sha(raw) != required_sha:
        raise ValueError("The original admitted runtime receipt differs")
    return raw

def retain_receiving_source(root, source_raw, bodies, paths, runtime_raw):
    target = paths["work"] / "predecessor" / "host-receiving"
    private(target)
    for name, data in bodies.items():
        retain(target / name, data)
    retain(target / "SOURCE.json", source_raw)
    retain(target / "RUNTIME.json", runtime_raw)

def browser_environment(selection, paths):
    target = paths["work"] / "predecessor" / "host-receiving" / "fonts"
    private(target)
    cache = paths["work"] / "browser-font-cache"
    private(cache)
    body = selection["runtime"]["fontconfig"].replace("@CACHE@", str(cache)).encode()
    retain(target / "fonts.conf", body)
    os.environ.update({
        "LD_LIBRARY_PATH": selection["runtime"]["libraryDirectory"],
        "FONTCONFIG_PATH": str(target), "FONTCONFIG_FILE": str(target / "fonts.conf"),
        "PYTHONDONTWRITEBYTECODE": "1"})
    # Launch arguments remain the unchanged original programme's explicit flags.

def native_command(root, source_sha, runtime_sha):
    return [sys.executable, "-B", str(root / "receive-host.py"), "execute",
            "--source-sha256", source_sha, "--runtime-sha256", runtime_sha]

def check_record_before_start(record):
    if not record.exists():
        return
    if not record.is_dir() or record.is_symlink():
        raise ValueError("Preserve the original native record path")
    if (record / "request.json").exists():
        return
    if any(path.name != ".lock" for path in record.iterdir()):
        raise ValueError("Unregistered native directory has other retained evidence; reconcile it first")
    if (record / ".lock").exists():
        entry = (record / ".lock").lstat()
        if not stat.S_ISREG(entry.st_mode) or entry.st_size != 0:
            raise ValueError("The native lock is not an empty original registration lock")

def execute_original(root, source_raw, bodies, selection, paths, host, runtime_raw, runtime_sha):
    sys.path.insert(0, str(paths["nativeRoot"] / "host"))
    from native_foreground import load_native
    native = load_native(paths["nativeRoot"] / "host")
    record = native.run_path(NATIVE_OP, paths["records"])
    request = native.read_json(record / "request.json")
    expected = native_command(root, sha(source_raw), runtime_sha)
    if (not request or request.get("intent", {}).get("operation_id") != NATIVE_OP
            or request["intent"].get("command") != expected
            or request["intent"].get("project") != str(root)):
        raise ValueError("Execute only the exact command retained by the original native controller")
    retain_receiving_source(root, source_raw, bodies, paths, runtime_raw)
    browser_environment(selection, paths)
    arguments = argparse.Namespace(
        carrier=str(paths["correctedCarrier"]), original=str(paths["work"] / "inputs"),
        output=str(paths["output"]), work=str(paths["work"]),
        predecessor_checkpoint=str(paths["predecessor"]), node=str(paths["node"]),
        dependencies=str(paths["dependencies"]), playwright=str(paths["playwright"]),
        chromium=str(paths["chromium"]), library_helpers=str(paths["libraryHelpers"]),
        resume_checkpoint=None, checkpoint_sha256=None)
    print(json.dumps({"event": "SF74_ORIGINAL_CORRECTED_HOST_EXECUTE", "nativeOperation": NATIVE_OP,
                      "businessOperation": OP, "sourceManifestSha256": selection["sourceManifestSha256"],
                      "runtimeSha256": runtime_sha}), flush=True)
    return host.run(arguments)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("receive", "start", "execute"))
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--runtime-sha256")
    args = parser.parse_args()
    if (args.action == "execute") != bool(args.runtime_sha256):
        raise ValueError("Only the exact admitted execute command supplies its runtime receipt SHA-256")
    root, source_raw, bodies, selection = source_bundle(args.source_sha256)
    os.umask(0o077)
    lock_fd = os.open(root / ".host-receiving.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, "a") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        paths, host = verify_originals(selection)
        runtime_raw = runtime_receipt(root, sha(source_raw), selection, paths, args.runtime_sha256)
        runtime_sha = sha(runtime_raw)
        retain_receiving_source(root, source_raw, bodies, paths, runtime_raw)
        print(json.dumps({"event": "SF74_HOST_RECEIVED", "sourceFiles": 156,
                          "nativeSourceFiles": len(selection["native"]["files"]),
                          "nativeSourceCommit": selection["native"]["commit"],
                          "hostReceivingSourceSha256": sha(source_raw),
                          "sourceManifestSha256": selection["sourceManifestSha256"],
                          "runtimeSha256": runtime_sha, "nativeOperation": NATIVE_OP,
                          "newPurchases": 0, "newProviderCalls": 0}), flush=True)
        if args.action == "receive":
            return 0
        if args.action == "execute":
            return execute_original(root, source_raw, bodies, selection, paths, host, runtime_raw, runtime_sha)
        # No historical result/memory/state file is written into the native record.
        sys.path.insert(0, str(paths["nativeRoot"] / "host"))
        from native_foreground import ForegroundLaunch, load_native
        native = load_native(paths["nativeRoot"] / "host")
        record = native.run_path(NATIVE_OP, paths["records"])
        check_record_before_start(record)
        for name in ("worker", "temporary", "output"):
            private(paths[name])
        command = native_command(root, sha(source_raw), runtime_sha)
        request = argparse.Namespace(
            peer="BC08", operation_id=NATIVE_OP, project=str(root), command=command,
            java=None, node=None, artifact=[], records_root=str(paths["records"]),
            worker_root=str(paths["worker"]), temp_root=str(paths["temporary"]),
            memory_mib=768, memory_reserve_mib=256, memory_reclaim="clean-cache",
            memory_reservations_root="/workspace/shared/swarm/capacity/memory",
            disk_space=[str(paths["work"]) + "=256", str(paths["worker"]) + "=16",
                        str(paths["temporary"]) + "=32", str(paths["output"]) + "=64",
                        str(paths["records"]) + "=16"],
            disk_reserve_mib=64, disk_reserve_inodes=128,
            disk_reservations_root="/workspace/shared/swarm/capacity/disk",
            runtime_path=[str(paths["nativeRoot"]), str(paths["correctedCarrier"]),
                          str(paths["predecessor"]), str(paths["libraryHelpers"]),
                          *selection["runtime"]["directories"],
                          *selection["runtime"]["executables"].values()])
        launch = ForegroundLaunch(native)
        try:
            result = native.start(request, launcher=launch)
            from native_result_view import select
            print(json.dumps(select(result, "summary"), default=str), flush=True)
        finally:
            if launch.root is not None:
                code = launch.handoff()
                if code is not None:
                    raise SystemExit(code)
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"event": "SF74_HOST_RECEIVING_INCOMPLETE",
                          "code": type(error).__name__, "message": str(error)}), file=sys.stderr, flush=True)
        raise SystemExit(1)
