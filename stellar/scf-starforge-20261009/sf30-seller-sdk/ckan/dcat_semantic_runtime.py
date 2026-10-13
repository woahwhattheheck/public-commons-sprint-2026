# MIT. Prepare one private semantic interpreter with original source and resolved wheel custody.
# Native catalogue operations remain in the unchanged semantic_operator worker.
from __future__ import annotations
import argparse
import base64
import ctypes
import email
import fcntl
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
import uuid
import zipfile

SCHEMA = "stellar-forge.dcat-semantic-prepared-runtime.v1"
SELECTION = "stellar-forge.dcat-semantic-runtime-selection.v1"
VENDOR_SHA = "2fff66af17de2e0c5f4c35ba0e765a3bf0ea44f8347b78f72e14c54d973286b0"
RUNTIME_SHA = "8f148b0b6a3c0ae2660d55b4c300fba76ac1f7805e4e693ff76c3b3297b0cb04"
PINNED = {"rdflib": "7.6.0", "pyshacl": "0.40.1", "cryptography": "50.0.1", "pyld": "3.3.0"}
MAX_FILE = 536870912
MAX_TOTAL = 2147483648

def require(value, code, message=None):
    if not value:
        error = ValueError(message or code)
        error.code = code
        raise error

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

def regular(path, maximum=MAX_FILE):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= maximum,
                "SEMANTIC_RUNTIME_REGULAR_FILE_REQUIRED")
        parts, length = [], 0
        while True:
            block = os.read(fd, min(1048576, maximum + 1 - length))
            if not block:
                break
            parts.append(block)
            length += len(block)
            require(length <= maximum, "SEMANTIC_RUNTIME_FILE_TOO_LARGE")
        after = os.fstat(fd)
        require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_size, after.st_mtime_ns, after.st_ctime_ns) and length == before.st_size,
                "SEMANTIC_RUNTIME_SOURCE_CHANGED")
        return b"".join(parts)
    finally:
        os.close(fd)

def file_identity(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= MAX_FILE,
                "SEMANTIC_RUNTIME_REGULAR_FILE_REQUIRED")
        digest, length = hashlib.sha256(), 0
        while True:
            block = os.read(fd, 1048576)
            if not block:
                break
            length += len(block)
            require(length <= MAX_FILE, "SEMANTIC_RUNTIME_FILE_TOO_LARGE")
            digest.update(block)
        after = os.fstat(fd)
        require(length == before.st_size and
                (before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_size, after.st_mtime_ns, after.st_ctime_ns), "SEMANTIC_RUNTIME_SOURCE_CHANGED")
        return {"bytes": length, "sha256": digest.hexdigest(), "mode": stat.S_IMODE(before.st_mode)}
    finally:
        os.close(fd)

def private_directory(path, create=False):
    path = Path(path)
    require(path.is_absolute() and str(path) != "/" and str(path) == os.path.normpath(path),
            "SEMANTIC_RUNTIME_ABSOLUTE_DIRECTORY_REQUIRED")
    if create:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and
            not info.st_mode & 0o077 and path.resolve() == path and info.st_uid == os.getuid(),
            "SEMANTIC_RUNTIME_PRIVATE_DIRECTORY_REQUIRED")
    return path

def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def once(path, raw):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        require(regular(path, max(len(raw), 1)) == raw, "SEMANTIC_RUNTIME_RETAINED_SOURCE_CHANGED", str(path))
        return
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        sync_dir(path.parent)
    except BaseException:
        # A partial write remains owned evidence and is never silently replaced.
        raise

def atomic(path, value):
    temp = path.parent / (".pending-" + uuid.uuid4().hex)
    once(temp, encoded(value))
    os.replace(temp, path)
    sync_dir(path.parent)

def member(value):
    require(isinstance(value, str) and value and "\\" not in value and "\0" not in value and
            not value.startswith("/") and all(part not in ("", ".", "..") for part in value.split("/")),
            "SEMANTIC_RUNTIME_MEMBER_INVALID")
    return value

def normalized_name(value):
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", value),
            "SEMANTIC_RUNTIME_PACKAGE_NAME_INVALID")
    return re.sub(r"[-_.]+", "-", value).lower()

def inventory(root):
    output, total = [], 0
    for directory, directories, names in os.walk(root, followlinks=False):
        for name in sorted(list(directories) + list(names)):
            path = Path(directory) / name
            relative = member(path.relative_to(root).as_posix())
            info = path.lstat()
            if stat.S_ISDIR(info.st_mode):
                continue
            if path.is_symlink():
                target = os.readlink(path)
                output.append({"path": relative, "kind": "symlink", "target": target})
                if name in directories:
                    directories.remove(name)
            else:
                record = file_identity(path)
                total += record["bytes"]
                require(total <= MAX_TOTAL and len(output) < 20000, "SEMANTIC_RUNTIME_INVENTORY_LIMIT")
                output.append({"path": relative, "kind": "file", **record})
    return sorted(output, key=lambda value: value["path"])

def verify_inventory(root, expected):
    require(inventory(root) == expected, "SEMANTIC_RUNTIME_INSTALLED_FILES_CHANGED")

def source_selection(vendor):
    vendor = Path(vendor)
    require(vendor.is_absolute() and vendor.resolve() == vendor, "SEMANTIC_RUNTIME_VENDOR_PATH_INVALID")
    raw_manifest = regular(vendor / "source-manifest.json", 16777216)
    raw_selected = regular(vendor / "selected-runtime.json", 16777216)
    require(sha(raw_manifest) == VENDOR_SHA and sha(raw_selected) == RUNTIME_SHA,
            "SEMANTIC_RUNTIME_ORIGINAL_SOURCE_CHANGED")
    manifest, selected = json.loads(raw_manifest), json.loads(raw_selected)
    require(selected["original_manifest_sha256"] == VENDOR_SHA, "SEMANTIC_RUNTIME_ORIGINAL_SOURCE_CHANGED")
    originals = {row["path"]: row for row in manifest["files"]}
    files = {}
    for row in selected["files"]:
        path = member(row["path"])
        require(path in originals and all(originals[path][key] == row[key] for key in ("bytes", "sha256", "git_blob")),
                "SEMANTIC_RUNTIME_SELECTION_CHANGED")
        raw = regular(vendor / path)
        require(len(raw) == row["bytes"] and sha(raw) == row["sha256"], "SEMANTIC_RUNTIME_ORIGINAL_SOURCE_CHANGED")
        files[path] = raw
    files["source-manifest.json"] = raw_manifest
    files["selected-runtime.json"] = raw_selected
    return {"manifestSha256": VENDOR_SHA, "runtimeManifestSha256": RUNTIME_SHA,
            "requirementsSha256": sha(files["requirements.txt"]),
            "repository": selected["repository"], "commit": selected["commit"],
            "files": [{"path": path, "bytes": len(raw), "sha256": sha(raw)}
                      for path, raw in sorted(files.items())]}, files

def parent_lifecycle():
    # Same Linux parent-death binding as the retained semantic_operator.worker.
    parent = os.getppid()
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "Cannot bind preparation child to its owner")
    if os.getppid() != parent or parent == 1:
        os.kill(os.getpid(), signal.SIGTERM)

def stop_child(child):
    if child.poll() is not None:
        return
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()

def probe(output, vendor=None):
    require(sys.version_info >= (3, 11), "SEMANTIC_RUNTIME_PYTHON_VERSION",
            "The original semantic operator requires Python 3.11 or later.")
    result = {"schema": "stellar-forge.dcat-semantic-python-probe.v1",
              "version": sys.version, "versionInfo": list(sys.version_info[:3]),
              "executable": sys.executable, "prefix": sys.prefix, "basePrefix": sys.base_prefix,
              "platform": sys.platform, "implementation": sys.implementation.name}
    if vendor:
        sys.path.insert(0, str(Path(vendor)))
        from semantic_operator import rdf_engine
        import rdflib
        import pyshacl
        import cryptography
        from pyld import jsonld
        packages = sorted([{"name": normalized_name(dist.metadata["Name"]), "version": dist.version}
                           for dist in importlib.metadata.distributions()], key=lambda row: row["name"])
        require(len({row["name"] for row in packages}) == len(packages), "SEMANTIC_RUNTIME_DUPLICATE_PACKAGE")
        actual = {row["name"]: row["version"] for row in packages}
        require(all(actual.get(name) == version for name, version in PINNED.items()),
                "SEMANTIC_RUNTIME_DEPENDENCY_VERSION_CHANGED")
        result.update({"packages": packages, "nativeVersions": rdf_engine.native_versions(),
                       "engineSource": rdf_engine.ENGINE_SOURCE,
                       "imports": ["rdflib", "pyshacl", "cryptography", "pyld", "semantic_operator.rdf_engine"]})
    once(Path(output), encoded(result))

def inspect(root):
    root = private_directory(root)
    record = json.loads(regular(root / "runtime.json", 16777216))
    require(record.get("schema") == SCHEMA and record.get("directory") == str(root) and record.get("status") == "READY",
            "SEMANTIC_RUNTIME_RECEIPT_INVALID")
    for section in ("source", "wheels", "environment"):
        verify_inventory(root / section, record["inventories"][section])
    for descriptor in record["files"]:
        path = root / member(descriptor["path"])
        actual = file_identity(path)
        require(actual["bytes"] == descriptor["bytes"] and actual["sha256"] == descriptor["sha256"],
                "SEMANTIC_RUNTIME_RECEIPT_FILE_CHANGED")
    executable = Path(record["python"]["executable"])
    require(executable == root / "environment" / "bin" / "python" and executable.resolve() == Path(record["python"]["target"]),
            "SEMANTIC_RUNTIME_INTERPRETER_CHANGED")
    require(file_identity(executable.resolve())["sha256"] == record["python"]["targetSha256"],
            "SEMANTIC_RUNTIME_INTERPRETER_CHANGED")
    return {**record, "receiptSha256": sha(regular(root / "runtime.json", 16777216)),
            "receiptBytes": (root / "runtime.json").stat().st_size}

def prepare(args):
    require(sys.platform == "linux", "SEMANTIC_RUNTIME_LINUX_REQUIRED")
    root = Path(args.directory)
    require(root.is_absolute(), "SEMANTIC_RUNTIME_ABSOLUTE_DIRECTORY_REQUIRED")
    root = Path(os.path.normpath(root))
    for parent in (root, *root.parents):
        require(not (parent / "workbench.json").exists(), "SEMANTIC_RUNTIME_OUTSIDE_PROJECT_REQUIRED",
                "Prepare the interpreter outside the portable catalogue project.")
    if getattr(args, "transfer_directory", None):
        transferred = Path(args.transfer_directory)
        require(transferred.is_absolute() and root != transferred and
                not root.is_relative_to(transferred) and not transferred.is_relative_to(root),
                "SEMANTIC_RUNTIME_TRANSFER_SEPARATE_DIRECTORIES_REQUIRED")
    existed = root.exists()
    if existed:
        private_directory(root)
        require(not list(root.iterdir()) or (root / "selection.json").is_file(),
                "SEMANTIC_RUNTIME_NEW_DIRECTORY_REQUIRED")
    private_directory(root, True)
    lock_fd = os.open(root / "preparation.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    require(stat.S_ISREG(os.fstat(lock_fd).st_mode) and os.fstat(lock_fd).st_nlink == 1,
            "SEMANTIC_RUNTIME_LOCK_INVALID")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(lock_fd)
        raise RuntimeError("SEMANTIC_RUNTIME_PREPARATION_ACTIVE")
    state = {"schema": "stellar-forge.dcat-semantic-runtime-progress.v1", "phase": "SELECTING", "updatedAt": now()}
    def update(phase, **values):
        state.update({"phase": phase, "updatedAt": now(), **values})
        atomic(root / "progress.json", state)
    try:
        source, bodies = source_selection(args.vendor)
        base = Path(args.python)
        require(base.is_absolute() and os.access(base, os.X_OK), "SEMANTIC_RUNTIME_PYTHON_REQUIRED")
        target = base.resolve()
        base_identity = file_identity(target)
        transfer = None
        if getattr(args, "transfer_directory", None):
            from dcat_semantic_runtime_transfer import inspect_received
            require(not args.wheelhouse and isinstance(args.transfer_sha256, str) and
                    re.fullmatch(r"[a-f0-9]{64}", args.transfer_sha256),
                    "SEMANTIC_RUNTIME_TRANSFER_SELECTION_REQUIRED")
            received = inspect_received(args.transfer_directory, args.transfer_sha256)
            require(received["source"] == source, "SEMANTIC_RUNTIME_TRANSFER_ORIGINAL_SOURCE_CHANGED")
            transfer = {"directory": received["directory"], "receiptSha256": received["receiptSha256"],
                        "bundleSha256": received["bundle"]["sha256"],
                        "sourceRuntimeReceiptSha256": received["sourceRuntimeReceiptSha256"],
                        "lockSha256": received["lockSha256"]}
        else:
            require(not getattr(args, "transfer_sha256", None), "SEMANTIC_RUNTIME_TRANSFER_SELECTION_REQUIRED")
        wheelhouse = str(Path(args.wheelhouse).resolve()) if args.wheelhouse else None
        if wheelhouse:
            require(Path(args.wheelhouse).is_absolute() and Path(wheelhouse).is_dir(),
                    "SEMANTIC_RUNTIME_WHEELHOUSE_REQUIRED")
        selection = {"schema": SELECTION, "directory": str(root), "source": source,
                     "basePython": {"executable": str(base), "target": str(target), **base_identity},
                     "wheelhouse": wheelhouse, "index": None if wheelhouse or transfer else "https://pypi.org/simple",
                     "onlyBinary": True}
        if transfer:
            selection["transfer"] = transfer
        once(root / "selection.json", encoded(selection))
        if (root / "runtime.json").exists():
            return inspect(root)
        for path, raw in bodies.items():
            once(root / "source" / path, raw)
        attempt = root / "attempts" / uuid.uuid4().hex
        private_directory(attempt, True)
        environment = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY")
                       if key in os.environ}
        environment.update({"PYTHONDONTWRITEBYTECODE": "1", "PYTHONUNBUFFERED": "1",
                            "TMPDIR": str(attempt / "temporary"), "PIP_DISABLE_PIP_VERSION_CHECK": "1",
                            "PIP_CONFIG_FILE": os.devnull})
        private_directory(attempt / "temporary", True)
        def command(name, argv, timeout=1200):
            log = attempt / (name + ".log")
            raw_argv = [str(value) for value in argv]
            once(attempt / (name + "-command.json"), encoded({"argv": raw_argv, "startedAt": now()}))
            with log.open("xb") as stream:
                os.chmod(log, 0o600)
                child = subprocess.Popen(raw_argv, stdout=stream, stderr=subprocess.STDOUT, env=environment,
                                         cwd=root, start_new_session=True, pass_fds=(lock_fd,), preexec_fn=parent_lifecycle)
                cause = None
                try:
                    update(name, childPid=child.pid, attempt=attempt.name)
                    child.wait(timeout=timeout)
                except BaseException as error:
                    cause = {"code": "TIMEOUT" if isinstance(error, subprocess.TimeoutExpired) else
                             "CANCELLED" if isinstance(error, KeyboardInterrupt) else type(error).__name__,
                             "message": str(error)[:4000]}
                    raise
                finally:
                    stop_child(child)
                    stream.flush()
                    os.fsync(stream.fileno())
                    code = child.returncode
                    receipt = {"exitCode": code if code is None or code >= 0 else None,
                               "signal": -code if code is not None and code < 0 else None,
                               "cause": cause, "completedAt": now(), "log": file_identity(log)}
                    once(attempt / (name + "-result.json"), encoded(receipt))
                require(child.returncode == 0, "SEMANTIC_RUNTIME_COMMAND_FAILED",
                        name + " failed; inspect the retained private log.")
        helper = Path(__file__).resolve()
        command("base-python", [base, "-B", helper, "probe", "--out", attempt / "base-python.json"], 30)
        base_probe = json.loads(regular(attempt / "base-python.json", 1048576))
        require(base_probe["versionInfo"] >= [3, 11, 0], "SEMANTIC_RUNTIME_PYTHON_VERSION")
        venv = root / "environment"
        command("venv", [base, "-B", "-m", "venv", venv], 180)
        python = venv / "bin" / "python"
        require(python.is_file() and python.resolve() == target, "SEMANTIC_RUNTIME_VENV_INTERPRETER_CHANGED")
        lock_path, wheel_path = root / "requirements.lock", root / "wheels"
        if transfer:
            # The original receiving operation verified every wheel and the complete exact lock.
            # Recheck its immutable receipt before copying, then use the original offline installer.
            from dcat_semantic_runtime_transfer import inspect_received, write_owned, write_bytes, chunks
            received = inspect_received(transfer["directory"], transfer["receiptSha256"])
            payload = Path(received["directory"]) / "payload"
            original_wheels = json.loads(regular(payload / "records/wheel-selection.json", 16777216))
            private_directory(wheel_path, True)
            for row in original_wheels["packages"]:
                handle = os.open(payload / "wheels" / member(row["file"]), os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(handle, "rb") as source_wheel:
                    write_owned(root, "wheels/" + row["file"], chunks(source_wheel), row)
            write_bytes(root, "requirements.lock", regular(payload / "records/requirements.lock", 1048576))
            write_bytes(root, "wheel-selection.json", regular(payload / "records/wheel-selection.json", 16777216))
            require(original_wheels["lockSha256"] == transfer["lockSha256"],
                    "SEMANTIC_RUNTIME_TRANSFER_LOCK_CHANGED")
        if (root / "wheel-selection.json").exists():
            wheel_selection = json.loads(regular(root / "wheel-selection.json", 16777216))
            verify_inventory(wheel_path, wheel_selection["inventory"])
            require(sha(regular(lock_path, 1048576)) == wheel_selection["lockSha256"],
                    "SEMANTIC_RUNTIME_RESOLVED_LOCK_CHANGED")
        else:
            downloaded = attempt / "downloaded"
            private_directory(downloaded, True)
            argv = [python, "-B", "-m", "pip", "--isolated", "download", "--disable-pip-version-check",
                    "--no-cache-dir", "--only-binary=:all:", "--dest", downloaded,
                    "--requirement", root / "source" / "requirements.txt"]
            argv += ["--no-index", "--find-links", wheelhouse] if wheelhouse else ["--index-url", "https://pypi.org/simple"]
            command("resolve-wheels", argv)
            wheels, seen = [], set()
            for path in sorted(downloaded.iterdir()):
                require(path.is_file() and not path.is_symlink() and path.name.endswith(".whl"),
                        "SEMANTIC_RUNTIME_WHEEL_REQUIRED")
                with zipfile.ZipFile(path) as archive:
                    names = [name for name in archive.namelist() if name.endswith(".dist-info/METADATA") and name.count("/") == 1]
                    require(len(names) == 1, "SEMANTIC_RUNTIME_WHEEL_METADATA_INVALID")
                    info = archive.getinfo(names[0])
                    require(info.file_size <= 1048576, "SEMANTIC_RUNTIME_WHEEL_METADATA_TOO_LARGE")
                    metadata = email.message_from_bytes(archive.read(names[0]))
                name, version = normalized_name(metadata["Name"]), metadata["Version"]
                require(isinstance(version, str) and re.fullmatch(r"[A-Za-z0-9.!+_-]+", version) and name not in seen,
                        "SEMANTIC_RUNTIME_WHEEL_SELECTION_AMBIGUOUS")
                seen.add(name)
                identity = file_identity(path)
                wheels.append({"name": name, "version": version, "file": path.name, **identity})
            require(wheels and all(any(row["name"] == name and row["version"] == version for row in wheels)
                                  for name, version in PINNED.items()), "SEMANTIC_RUNTIME_PINNED_WHEELS_REQUIRED")
            private_directory(wheel_path, True)
            for row in wheels:
                once(wheel_path / row["file"], regular(downloaded / row["file"]))
            lock_raw = ("# Complete original dependency resolution; every selected wheel is retained.\n" +
                        "".join(row["name"] + "==" + row["version"] + " --hash=sha256:" + row["sha256"] + "\n"
                                for row in sorted(wheels, key=lambda value: value["name"]))).encode("utf-8")
            once(lock_path, lock_raw)
            wheel_selection = {"schema": "stellar-forge.dcat-semantic-wheel-selection.v1",
                               "requirementsSha256": source["requirementsSha256"], "lockSha256": sha(lock_raw),
                               "packages": wheels, "inventory": inventory(wheel_path), "resolvedAt": now(),
                               "source": {"kind": "wheelhouse" if wheelhouse else "pypi", "path": wheelhouse}}
            once(root / "wheel-selection.json", encoded(wheel_selection))
        command("install-locked", [python, "-B", "-m", "pip", "--isolated", "install", "--no-index",
                "--no-cache-dir", "--no-compile", "--require-hashes", "--find-links", wheel_path,
                "--requirement", lock_path])
        command("dependency-check", [python, "-B", "-m", "pip", "--isolated", "check"], 120)
        command("original-imports", [python, "-B", helper, "probe", "--vendor", root / "source",
                "--out", attempt / "original-imports.json"], 120)
        imported = json.loads(regular(attempt / "original-imports.json", 16777216))
        actual_packages = {row["name"]: row["version"] for row in imported["packages"]}
        require(all(actual_packages.get(row["name"]) == row["version"] for row in wheel_selection["packages"]),
                "SEMANTIC_RUNTIME_INSTALLED_RESOLUTION_CHANGED")
        selected_records = ["selection.json", "requirements.lock", "wheel-selection.json",
                            (attempt / "base-python.json").relative_to(root).as_posix(),
                            (attempt / "original-imports.json").relative_to(root).as_posix()]
        for path in sorted(attempt.iterdir()):
            if path.is_file() and path.name.endswith((".log", "-command.json", "-result.json")):
                selected_records.append(path.relative_to(root).as_posix())
        record = {"schema": SCHEMA, "directory": str(root), "status": "READY", "createdAt": now(),
                  "selectionSha256": sha(regular(root / "selection.json", 16777216)), "source": source,
                  "python": {"executable": str(python), "target": str(target), "targetSha256": base_identity["sha256"],
                             "version": imported["version"], "versionInfo": imported["versionInfo"],
                             "platform": imported["platform"], "basePrefix": imported["basePrefix"]},
                  "packages": imported["packages"], "nativeVersions": imported["nativeVersions"],
                  "engineSource": imported["engineSource"], "lockSha256": wheel_selection["lockSha256"],
                  "inventories": {name: inventory(root / name) for name in ("source", "wheels", "environment")},
                  "files": [{"path": name, **file_identity(root / name)} for name in sorted(set(selected_records))],
                  "scope": "Selected base executable, original engine source, all resolved wheels and installed environment files; host OS and base standard library remain host prerequisites."}
        if transfer:
            record["transfer"] = transfer
        once(root / "runtime.json", encoded(record))
        update("READY", childPid=None, receiptSha256=sha(encoded(record)))
        return inspect(root)
    except BaseException as error:
        update("INTERRUPTED" if isinstance(error, KeyboardInterrupt) else "FAILED", childPid=None,
               error={"code": getattr(error, "code", type(error).__name__), "message": str(error)[:4000]})
        raise
    finally:
        os.close(lock_fd)

def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description="Prepare the original DCAT semantic dependencies in a new private environment.")
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("prepare")
    for name in ("directory", "python", "vendor"):
        create.add_argument("--" + name, required=True)
    create.add_argument("--wheelhouse")
    create.add_argument("--transfer-directory")
    create.add_argument("--transfer-sha256")
    check = sub.add_parser("inspect")
    check.add_argument("--directory", required=True)
    selected = sub.add_parser("probe")
    selected.add_argument("--out", required=True)
    selected.add_argument("--vendor")
    args = parser.parse_args()
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt("Original preparation owner stopped")
    signal.signal(signal.SIGTERM, interrupted)
    parent_lifecycle()
    try:
        if args.command == "probe":
            probe(args.out, args.vendor)
            return 0
        result = prepare(args) if args.command == "prepare" else inspect(args.directory)
        print(json.dumps({"schema": result["schema"], "directory": result["directory"], "status": result["status"],
                          "python": result["python"], "receiptSha256": result["receiptSha256"],
                          "receiptBytes": result["receiptBytes"], "packages": len(result["packages"])}), flush=True)
        return 0
    except BaseException as error:
        print(json.dumps({"error": getattr(error, "code", type(error).__name__), "message": str(error)[:4000]}),
              file=sys.stderr, flush=True)
        return 130 if isinstance(error, KeyboardInterrupt) else 1

if __name__ == "__main__":
    raise SystemExit(main())
