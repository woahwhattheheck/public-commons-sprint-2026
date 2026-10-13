"""Private transport and source/scope binding for the original native queue."""
from __future__ import annotations

import array
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import stat
import struct
import sys

SCHEMA = "commons.native-shared-queue/v1"
MAX_PACKET = 2 * 1024 * 1024
MAX_DESCRIPTORS = 4
DISPATCH_FILES = ("process.json", "output.log", "command-completion.dat")
QUEUE_FILES = ("native_queue.py", "native_queue_protocol.py")


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def private_directory(value, *, create=False):
    path = Path(value).expanduser()
    if not path.is_absolute() or path != path.resolve():
        raise ValueError("Select a canonical absolute private queue directory")
    if create:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.stat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) & 0o077):
        raise ValueError("The queue directory must be owned by this user and mode0700")
    if len(os.fsencode(path / "control.sock")) >= 104:
        raise ValueError("Use a shorter private queue path for the native Unix socket")
    return path


def close_descriptors(descriptors):
    for descriptor in descriptors:
        try:
            os.close(descriptor)
        except OSError:
            pass


def read_exact(connection, size):
    result = bytearray()
    while len(result) < size:
        block = connection.recv(min(65536, size - len(result)))
        if not block:
            raise EOFError("The original queue connection ended before its response")
        result.extend(block)
    return bytes(result)


def receive(connection):
    descriptors = []
    try:
        # Atomic close-on-exec avoids leaking received locks into another
        # controller thread's child before explicit pass_fds selection.
        header, ancillary, flags, _ = connection.recvmsg(
            4, socket.CMSG_SPACE(array.array("i").itemsize * MAX_DESCRIPTORS),
            getattr(socket, "MSG_CMSG_CLOEXEC", 0))
        for level, kind, data in ancillary:
            if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                saved = array.array("i")
                saved.frombytes(data[:len(data) - len(data) % saved.itemsize])
                descriptors.extend(saved)
        for descriptor in descriptors:
            os.set_inheritable(descriptor, False)
        if len(descriptors) > MAX_DESCRIPTORS:
            raise ValueError("The queue message carries too many native lock descriptors")
        if flags & socket.MSG_CTRUNC:
            raise ValueError("The queue lock descriptor was truncated")
        if len(header) < 4:
            header += read_exact(connection, 4 - len(header))
        length = struct.unpack("!I", header)[0]
        if not 1 <= length <= MAX_PACKET:
            raise ValueError("The queue message exceeds its native transport limit")
        value = json.loads(read_exact(connection, length))
        if not isinstance(value, dict):
            raise ValueError("The queue message must be an object")
        return value, descriptors
    except BaseException:
        close_descriptors(descriptors)
        raise


def send(connection, value, *, descriptor=None, descriptors=None):
    # Keep the existing single-descriptor API for compatible transport users.
    # Native acceptance selects the ordered record + supervisor lock pair.
    if descriptor is not None and descriptors is not None:
        raise ValueError("Select either one descriptor or the original lock pair")
    selected = ([descriptor] if descriptor is not None else
                list(descriptors) if descriptors is not None else [])
    if (len(selected) > MAX_DESCRIPTORS
            or any(type(item) is not int or item < 0 for item in selected)):
        raise ValueError("Select the original open native lock descriptors")
    body = canonical(value)
    if len(body) > MAX_PACKET:
        raise ValueError("The queue message exceeds its native transport limit")
    packet = struct.pack("!I", len(body)) + body
    ancillary = [] if not selected else [
        (socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", selected))]
    written = connection.sendmsg([packet], ancillary)
    if written < len(packet):
        # SCM_RIGHTS is attached only to the first send; a short stream write
        # continues the same frame without sending another set of descriptors.
        connection.sendall(packet[written:])


def environment(value):
    if not isinstance(value, dict) or len(value) > 8192:
        raise ValueError("The original native environment must be a string mapping")
    for key, item in value.items():
        if (not isinstance(key, str) or not key or "=" in key or "\0" in key
                or not isinstance(item, str) or "\0" in item):
            raise ValueError("The original native environment has an invalid entry")
    if len(canonical(value)) > 1024 * 1024:
        raise ValueError("The original native environment exceeds the IPC limit")
    return dict(value)


def runtime_identity(native):
    from native_runtime_handoff import runtime_identity as original_identity
    original = original_identity(native)
    root = Path(native.__file__).resolve().parent
    files = {name: digest((root / name).read_bytes()) for name in QUEUE_FILES}
    value = {"original_runtime": original["sha256"], "queue_files": files,
             "python": {"executable": str(Path(sys.executable).resolve()),
                        "version": sys.version, "implementation": sys.implementation.cache_tag}}
    return {**value, "host_root": str(root), "sha256": digest(canonical(value))}


def original_request(native, root):
    root = Path(root)
    if not root.is_absolute() or root != root.resolve(strict=True):
        raise ValueError("Select the canonical original native record")
    raw = (root / "request.json").read_bytes()
    request = json.loads(raw)
    if (request.get("schema") != native.SCHEMA
            or native.run_path(request["intent"]["operation_id"], root.parent) != root):
        raise ValueError("The queue must select the original native request and record")
    if not (request["intent"].get("memory") or request["intent"].get("disk")):
        raise ValueError("The shared queue requires an original capacity declaration")
    return request, digest(raw)


def _path_identity(value):
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ValueError("A selected native scope path is not absolute")
    lexical = str(path)
    resolved = path.resolve()
    selected = resolved
    while not selected.exists():
        parent = selected.parent
        if parent == selected:
            raise ValueError("The selected native path has no accessible filesystem")
        selected = parent
    info = selected.stat()
    return {"path": lexical, "resolved": str(resolved),
            "observed_path": str(selected), "exists": resolved.exists(),
            "device": info.st_dev, "inode": info.st_ino,
            "kind": stat.S_IFMT(info.st_mode)}


def execution_scope(native, root, request, supplied_environment):
    """Bind selected objects and actual visible cgroups, not namespace labels.

    Separate cloud callers may have different mount namespace IDs while using
    the same shared files. A private /dev source or another cgroup remains
    distinguishable by its selected objects and actual cgroup inode.
    """
    from worker_capacity import snapshot
    intent = request["intent"]
    storage = request.get("storage", {})
    paths = {str(root), intent["project"], str(Path(native.__file__).resolve()),
             str(Path(sys.executable).resolve())}
    for name in ("worker_root", "temporary_root", "records_root"):
        if storage.get(name):
            paths.add(storage[name])
    for row in intent.get("disk", {}).get("paths", []):
        paths.add(row["path"])
    paths.update(intent.get("runtime_paths", []))
    usage = native.read_json(root / "runtime-use.json") or {}
    for row in usage.get("paths", []):
        if isinstance(row, dict):
            for key in ("path", "resolved"):
                if isinstance(row.get(key), str):
                    paths.add(row[key])
    command = intent.get("command", [])
    for argument in command:
        if isinstance(argument, str) and argument.startswith("/"):
            paths.add(argument)
    if command:
        executable = command[0]
        if not os.path.isabs(executable):
            executable = shutil.which(executable, path=supplied_environment.get("PATH"))
            if not executable:
                raise ValueError("The original executable is unavailable in this queue scope")
        paths.add(executable)
    if len(paths) > 4096:
        raise ValueError("The declared native scope exceeds the shared queue limit")
    observed = snapshot([], nearest_existing=True)
    cgroup = observed.get("cgroup_memory") or {}
    levels = cgroup.get("levels") or []
    if not levels:
        raise ValueError("The native cgroup scope cannot be established")
    scopes = []
    for row in levels:
        if not row.get("directory") or row.get("max_status") == "unavailable":
            raise ValueError("The native cgroup scope is unavailable")
        selected = Path(row["directory"])
        info = selected.stat()
        scopes.append({"directory": str(selected.resolve()),
                       "device": info.st_dev, "inode": info.st_ino})
    return {"boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
            "cgroups": scopes, "paths": [_path_identity(path) for path in sorted(paths)]}


def request(directory, value, *, descriptor=None, descriptors=None, timeout=30):
    directory = private_directory(directory)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(timeout)
        connection.connect(str(directory / "control.sock"))
        send(connection, value, descriptor=descriptor, descriptors=descriptors)
        response, received = receive(connection)
        close_descriptors(received)
    if response.get("schema") != SCHEMA:
        raise ValueError("The original queue returned an unsupported response")
    if not response.get("ok"):
        raise ValueError(response.get("message", "The original queue declined this request"))
    return response
