# MIT. Prepare one private semantic interpreter with original source and resolved wheel custody.
# Native catalogue operations remain in the unchanged semantic_operator worker.
from __future__ import annotations
import argparse
import base64
import ctypes
import email
import errno
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
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
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

def file_identity(path, maximum=MAX_FILE):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                (maximum is None or before.st_size <= maximum),
                "SEMANTIC_RUNTIME_REGULAR_FILE_REQUIRED")
        digest, length = hashlib.sha256(), 0
        while True:
            block = os.read(fd, 1048576)
            if not block:
                break
            length += len(block)
            require(maximum is None or length <= maximum, "SEMANTIC_RUNTIME_FILE_TOO_LARGE")
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
        durable_directory(path)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and
            not info.st_mode & 0o077 and path.resolve() == path and info.st_uid == os.getuid(),
            "SEMANTIC_RUNTIME_PRIVATE_DIRECTORY_REQUIRED")
    if create:
        sync_dir(path.parent)
    return path

def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def durable_directory(path):
    """Publish every missing directory entry before any dependent original file."""
    path = Path(path)
    require(path.is_absolute() and str(path) == os.path.normpath(path),
            "SEMANTIC_RUNTIME_ABSOLUTE_DIRECTORY_REQUIRED")
    try:
        info = path.lstat()
    except FileNotFoundError:
        parent = path.parent
        require(parent != path, "SEMANTIC_RUNTIME_DIRECTORY_PARENT_REQUIRED")
        durable_directory(parent)
        fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            before = os.fstat(fd)
            require(parent.resolve() == parent, "SEMANTIC_RUNTIME_DIRECTORY_PARENT_CHANGED")
            try:
                os.mkdir(path.name, mode=0o700, dir_fd=fd)
            except FileExistsError:
                pass
            info = path.lstat()
            current = parent.lstat()
            require((before.st_dev, before.st_ino) == (current.st_dev, current.st_ino),
                    "SEMANTIC_RUNTIME_DIRECTORY_PARENT_CHANGED")
            os.fsync(fd)
        finally:
            os.close(fd)
    require(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and path.resolve() == path,
            "SEMANTIC_RUNTIME_DIRECTORY_CHANGED")
    # Reentry can follow a stopped mkdir; its existing name also needs durability.
    if path.parent != path:
        sync_dir(path.parent)

def once(path, raw):
    """Retain complete original bytes through a fsynced, no-replace publication."""
    path = Path(path)
    require(isinstance(raw, bytes), "SEMANTIC_RUNTIME_ORIGINAL_BYTES_REQUIRED")
    private_directory(path.parent, True)
    if path.exists() or path.is_symlink():
        require(regular(path, max(len(raw), 1)) == raw,
                "SEMANTIC_RUNTIME_RETAINED_SOURCE_CHANGED", str(path))
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        sync_dir(path.parent)
        return
    # A content-bound stage is resumable byte-for-byte. An incomplete wheel
    # never becomes the final name and cannot leave an unrelated partial member
    # inside the exact wheel inventory after this original copy completes.
    temporary = path.parent / (".pending-" + sha(raw))
    fd = os.open(temporary, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
                info.st_uid == os.getuid() and not info.st_mode & 0o077 and info.st_size <= len(raw),
                "SEMANTIC_RUNTIME_PUBLICATION_STAGE_CHANGED")
        at = 0
        while at < info.st_size:
            block = os.pread(fd, min(1048576, info.st_size - at), at)
            require(block and block == raw[at:at + len(block)],
                    "SEMANTIC_RUNTIME_PUBLICATION_STAGE_CHANGED")
            at += len(block)
        while at < len(raw):
            written = os.pwrite(fd, raw[at:at + 1048576], at)
            require(written > 0, "SEMANTIC_RUNTIME_PUBLICATION_SHORT_WRITE")
            at += written
        os.fsync(fd)
    finally:
        os.close(fd)
    # Linux is the existing preparation contract. Atomic no-replace rename avoids
    # an interrupted hard-link publication leaving a two-link final file that the
    # original single-link custody reader would refuse on every subsequent retry.
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, "renameat2", None)
    require(rename is not None, "SEMANTIC_RUNTIME_NOREPLACE_UNAVAILABLE")
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(temporary), -100, os.fsencode(path), 1) != 0:
        code = ctypes.get_errno()
        if code != errno.EEXIST:
            raise OSError(code, os.strerror(code), str(path))
        require(regular(path, max(len(raw), 1)) == raw,
                "SEMANTIC_RUNTIME_RETAINED_SOURCE_CHANGED", str(path))
        os.unlink(temporary)
    sync_dir(path.parent)


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

def preparation_child_lifecycle():
    parent_lifecycle()
    # The parent blocks cancellation only across Popen/handle assignment.
    # The original executed child must receive the normal TERM/INT signals.
    signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGINT, signal.SIGTERM})

def group_members(group):
    """Inspect only the original setsid process group, excluding inert zombies."""
    live = []
    for item in os.scandir("/proc"):
        if not item.name.isdigit():
            continue
        try:
            raw = (Path(item.path) / "stat").read_text()
        except (FileNotFoundError, ProcessLookupError):
            continue
        except PermissionError:
            # An unrelated user's hidden process cannot be in this owned
            # unprivileged preparation group; do not reject the whole census.
            try:
                if item.stat(follow_symlinks=False).st_uid != os.getuid():
                    continue
            except FileNotFoundError:
                continue
            raise
        closing = raw.rfind(")")
        require(closing >= 0, "SEMANTIC_RUNTIME_PROCESS_IDENTITY_INVALID")
        fields = raw[closing + 2:].split()
        require(len(fields) >= 20, "SEMANTIC_RUNTIME_PROCESS_IDENTITY_INVALID")
        if int(fields[2]) == group and int(fields[3]) == group and fields[0] not in ("Z", "X"):
            live.append(int(item.name))
    return live

def stop_child(child):
    """Drain the one original group even after its leader has already exited."""
    if child is None:
        return
    # command() keeps TERM/INT blocked through this complete cleanup. The same
    # original signals are consumed or restored only after every writer drains.
    deadline = time.monotonic() + 5
    escalated, census_error = False, None
    while True:
        child.poll()
        try:
            os.killpg(child.pid, 0)
        except ProcessLookupError:
            child.wait()
            if census_error is not None:
                raise RuntimeError("SEMANTIC_RUNTIME_CHILD_CENSUS_FAILED") from census_error
            return
        try:
            live = group_members(child.pid)
        except Exception as error:
            census_error = error
            live = [child.pid]
            escalated = True
        if not live:
            child.wait()
            if census_error is not None:
                raise RuntimeError("SEMANTIC_RUNTIME_CHILD_CENSUS_FAILED") from census_error
            return
        try:
            os.killpg(child.pid, signal.SIGKILL if escalated else signal.SIGTERM)
        except ProcessLookupError:
            pass
        if not escalated and time.monotonic() >= deadline:
            escalated = True
        # Keep this same owner/lock until every non-zombie group member is gone,
        # including a still-exiting writer after KILL. Never publish completion
        # or return custody merely because a fixed cleanup timer has expired.
        time.sleep(0.05)

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
    private_directory(root, True)
    root_identity = root.lstat()
    def check_root():
        current = root.lstat()
        require(stat.S_ISDIR(current.st_mode) and root.resolve() == root and
                (current.st_dev, current.st_ino) == (root_identity.st_dev, root_identity.st_ino) and
                current.st_uid == os.getuid() and not current.st_mode & 0o077,
                "SEMANTIC_RUNTIME_PREPARATION_DIRECTORY_CHANGED")
        current_lock = (root / "preparation.lock").lstat()
        held_lock = os.fstat(lock_fd)
        require((current_lock.st_dev, current_lock.st_ino) == (held_lock.st_dev, held_lock.st_ino) and
                stat.S_ISREG(current_lock.st_mode) and current_lock.st_nlink == 1 and
                not current_lock.st_mode & 0o077 and current_lock.st_uid == os.getuid(),
                "SEMANTIC_RUNTIME_LOCK_CHANGED")
    lock_fd = os.open(root / "preparation.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lock_fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
                not info.st_mode & 0o077 and info.st_uid == os.getuid(),
                "SEMANTIC_RUNTIME_LOCK_INVALID")
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.fsync(lock_fd)
        sync_dir(root)
        check_root()
        selected_path = root / "selection.json"
        if not selected_path.exists():
            # Failure before the complete source selection is not an unrelated
            # populated runtime. Only this original lock/request/progress and its
            # own unpublished stages may exist before source dispatch.
            for retained in root.iterdir():
                require(retained.name in ("preparation.lock", "preparation-request.json", "progress.json") or
                        re.fullmatch(r"\.pending-(?:[a-f0-9]{32}|[a-f0-9]{64})", retained.name),
                        "SEMANTIC_RUNTIME_NEW_DIRECTORY_REQUIRED")
                st = retained.lstat()
                require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_uid == os.getuid() and
                        not st.st_mode & 0o077, "SEMANTIC_RUNTIME_PRESELECTION_CUSTODY_CHANGED")
            if (root / "progress.json").exists():
                prior = json.loads(regular(root / "progress.json", 1048576))
                require(prior.get("schema") == "stellar-forge.dcat-semantic-runtime-progress.v1" and
                        prior.get("phase") in ("SELECTING", "FAILED", "INTERRUPTED"),
                        "SEMANTIC_RUNTIME_PRESELECTION_PROGRESS_CHANGED")
        request = {"schema": "stellar-forge.dcat-semantic-runtime-preparation-request.v1",
                   "directory": str(root), "python": args.python, "vendor": args.vendor,
                   "wheelhouse": args.wheelhouse,
                   "transferDirectory": getattr(args, "transfer_directory", None),
                   "transferSha256": getattr(args, "transfer_sha256", None)}
        # Old fully selected runtimes bind through their exact selection below.
        # New and lock-only original attempts retain caller input before reading it.
        if not selected_path.exists() or (root / "preparation-request.json").exists():
            once(root / "preparation-request.json", encoded(request))
    except BaseException as error:
        os.close(lock_fd)
        if isinstance(error, BlockingIOError):
            raise RuntimeError("SEMANTIC_RUNTIME_PREPARATION_ACTIVE") from error
        raise
    state = {"schema": "stellar-forge.dcat-semantic-runtime-progress.v1", "phase": "SELECTING", "updatedAt": now()}
    def update(phase, **values):
        check_root()
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
        check_root()
        once(root / "selection.json", encoded(selection))
        once(root / "preparation-request.json", encoded(request))
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
            check_root()
            log = attempt / (name + ".log")
            raw_argv = [str(value) for value in argv]
            once(attempt / (name + "-command.json"), encoded({"argv": raw_argv, "startedAt": now()}))
            with log.open("xb") as stream:
                os.chmod(log, 0o600)
                stream.flush()
                os.fsync(stream.fileno())
                sync_dir(attempt)
                child, cause, previous_mask = None, None, None
                overflow_after_drain = False
                cancellation = {signal.SIGINT, signal.SIGTERM}
                try:
                    # Keep cancellation blocked in this one owner until its child
                    # group and receipt are finished. Poll those original signals
                    # while the command is running; repeated delivery cannot cut
                    # through cleanup or the Popen-handle assignment boundary.
                    previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, cancellation)
                    check_root()
                    child = subprocess.Popen(raw_argv, stdout=stream, stderr=subprocess.STDOUT, env=environment,
                                             cwd=root, start_new_session=True, pass_fds=(lock_fd,),
                                             preexec_fn=preparation_child_lifecycle)
                    update(name, childPid=child.pid, attempt=attempt.name)
                    deadline = time.monotonic() + timeout
                    while child.poll() is None:
                        waiting = signal.sigpending() & cancellation
                        if waiting:
                            signal.sigwait(waiting)
                            raise KeyboardInterrupt("Original preparation owner stopped")
                        require(os.fstat(stream.fileno()).st_size <= MAX_FILE,
                                "SEMANTIC_RUNTIME_COMMAND_OUTPUT_LIMIT")
                        if time.monotonic() >= deadline:
                            raise subprocess.TimeoutExpired(raw_argv, timeout)
                        time.sleep(0.05)
                    require(os.fstat(stream.fileno()).st_size <= MAX_FILE,
                            "SEMANTIC_RUNTIME_COMMAND_OUTPUT_LIMIT")
                except BaseException as error:
                    cause = {"code": "TIMEOUT" if isinstance(error, subprocess.TimeoutExpired) else
                             "CANCELLED" if isinstance(error, KeyboardInterrupt) else
                             getattr(error, "code", type(error).__name__),
                             "message": str(error)[:4000]}
                    raise
                finally:
                    try:
                        stop_child(child)
                        check_root()
                        overflow_after_drain = os.fstat(stream.fileno()).st_size > MAX_FILE
                        if overflow_after_drain and cause is None:
                            cause = {"code": "SEMANTIC_RUNTIME_COMMAND_OUTPUT_LIMIT",
                                     "message": "Original command log exceeded its limit before the complete group drained."}
                        stream.flush()
                        os.fsync(stream.fileno())
                        code = None if child is None else child.returncode
                        receipt = {"exitCode": code if code is None or code >= 0 else None,
                                   "signal": -code if code is not None and code < 0 else None,
                                   "cause": cause, "completedAt": now(), "log": file_identity(log, maximum=None)}
                        once(attempt / (name + "-result.json"), encoded(receipt))
                    finally:
                        if previous_mask is not None:
                            # Preserve the first command failure when repeated
                            # cancellation arrives during its original drain.
                            if cause is not None:
                                waiting = signal.sigpending() & cancellation
                                while waiting:
                                    signal.sigwait(waiting)
                                    waiting = signal.sigpending() & cancellation
                            signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
                require(not overflow_after_drain, "SEMANTIC_RUNTIME_COMMAND_OUTPUT_LIMIT")
                require(child is not None and child.returncode == 0, "SEMANTIC_RUNTIME_COMMAND_FAILED",
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
                handle = os.open(payload / "wheels" / member(row["file"]), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
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
            resolution_path = root / "wheel-resolution.json"
            if resolution_path.exists():
                resolution = json.loads(regular(resolution_path, 16777216))
                require(resolution.get("schema") == "stellar-forge.dcat-semantic-wheel-resolution.v1" and
                        resolution.get("selectionSha256") == sha(regular(root / "selection.json", 16777216)),
                        "SEMANTIC_RUNTIME_ORIGINAL_RESOLUTION_CHANGED")
                downloaded = Path(resolution["directory"])
                require(downloaded.is_absolute() and downloaded.parent.parent == root / "attempts" and
                        re.fullmatch(r"[a-f0-9]{32}", downloaded.parent.name) and downloaded.name == "downloaded",
                        "SEMANTIC_RUNTIME_RESOLUTION_DIRECTORY_CHANGED")
                private_directory(downloaded)
                wheel_selection = resolution["wheelSelection"]
                lock_raw = resolution["lock"].encode("utf-8")
                require(wheel_selection.get("schema") == "stellar-forge.dcat-semantic-wheel-selection.v1" and
                        wheel_selection["requirementsSha256"] == source["requirementsSha256"] and
                        wheel_selection["lockSha256"] == sha(lock_raw) and
                        wheel_selection["source"] == {"kind": "wheelhouse" if wheelhouse else "pypi", "path": wheelhouse},
                        "SEMANTIC_RUNTIME_ORIGINAL_RESOLUTION_CHANGED")
                wheels = wheel_selection["packages"]
                require(inventory(downloaded) == resolution["downloadedInventory"],
                        "SEMANTIC_RUNTIME_ORIGINAL_WHEELS_CHANGED")
            else:
                # A legacy partial publication without an original resolution
                # pointer is preserved for explicit recovery, never combined with
                # a newly resolved dependency set.
                require(not lock_path.exists() and
                        (not wheel_path.exists() or not list(wheel_path.iterdir())),
                        "SEMANTIC_RUNTIME_ORIGINAL_RESOLUTION_REQUIRED",
                        "Retain the original downloaded wheels and lock; no original resolution receipt identifies this partial legacy publication.")
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
                lock_raw = ("# Complete original dependency resolution; every selected wheel is retained.\n" +
                            "".join(row["name"] + "==" + row["version"] + " --hash=sha256:" + row["sha256"] + "\n"
                                    for row in sorted(wheels, key=lambda value: value["name"]))).encode("utf-8")
                wheel_selection = {"schema": "stellar-forge.dcat-semantic-wheel-selection.v1",
                                   "requirementsSha256": source["requirementsSha256"], "lockSha256": sha(lock_raw),
                                   "packages": wheels,
                                   "inventory": sorted([{"path": row["file"], "kind": "file", "bytes": row["bytes"],
                                                         "sha256": row["sha256"], "mode": 0o600} for row in wheels],
                                                       key=lambda row: row["path"]),
                                   "resolvedAt": now(),
                                   "source": {"kind": "wheelhouse" if wheelhouse else "pypi", "path": wheelhouse}}
                resolution = {"schema": "stellar-forge.dcat-semantic-wheel-resolution.v1",
                              "selectionSha256": sha(regular(root / "selection.json", 16777216)),
                              "directory": str(downloaded), "wheelSelection": wheel_selection,
                              "downloadedInventory": inventory(downloaded), "lock": lock_raw.decode("utf-8")}
                # The complete selected attempt and exact lock precede the first
                # root wheel/lock copy. Restart uses this same attempt, never pip.
                once(resolution_path, encoded(resolution))
            private_directory(wheel_path, True)
            require(wheels and len({row["file"] for row in wheels}) == len(wheels),
                    "SEMANTIC_RUNTIME_WHEEL_SELECTION_AMBIGUOUS")
            for row in wheels:
                name = member(row["file"])
                require("/" not in name and name.endswith(".whl"), "SEMANTIC_RUNTIME_WHEEL_REQUIRED")
                raw = regular(downloaded / name)
                require(len(raw) == row["bytes"] and sha(raw) == row["sha256"],
                        "SEMANTIC_RUNTIME_ORIGINAL_WHEELS_CHANGED")
                once(wheel_path / name, raw)
            once(lock_path, lock_raw)
            verify_inventory(wheel_path, wheel_selection["inventory"])
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
        selected_records = ["selection.json", "preparation-request.json", "requirements.lock", "wheel-selection.json",
                            (attempt / "base-python.json").relative_to(root).as_posix(),
                            (attempt / "original-imports.json").relative_to(root).as_posix()]
        if (root / "wheel-resolution.json").exists():
            selected_records.append("wheel-resolution.json")
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
        check_root()
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
