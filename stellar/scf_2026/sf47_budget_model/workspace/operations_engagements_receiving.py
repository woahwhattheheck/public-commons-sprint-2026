"""Complete source-bound Contributor Engagements receiving over the original host.

The supplied SF47 server owns the workspace, journal and all native engines.
This caller starts no server, writes no planning database and makes no external
payment or send. Its own private journal retains exact original HTTP requests.
"""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
from datetime import date, datetime, timezone
from decimal import Decimal
import fcntl
import hashlib
import http.client
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote, urlencode, urlsplit
import zipfile

SCHEMA = "stellar-forge.sf47-engagement-native-receiving.v1"
STATE_SCHEMA = SCHEMA + ".journal"
SOURCE_SCHEMA = "stellar-forge.sf47-engagement-native-source.v1"
AGENT_SCHEMA = "stellar-forge.sf47-engagement-agent-receiving.v1"
AGENT_SOURCE_SCHEMA = "stellar-forge.sf47-engagement-agent-source.v1"
EXAMPLE_SCHEMA = "stellar-forge.sf47-engagement-walkthrough.v1"
BOOK_SCHEMA = "stellar-forge.sf47-contributor-engagements.v1"
CASE_SCHEMA = "stellar-forge.sf47-operations.v1"
MAX_BUNDLE = 32 * 1024 * 1024
MAX_SOURCE = 128 * 1024 * 1024
MAX_DELIVERY = 256 * 1024 * 1024
CHUNK = 64 * 1024
SHA = re.compile(r"[a-f0-9]{64}")
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}")
STOP = None
ACTIVE_HTTP = None
ACTIVE_HTTP_SOCKET = None
ACTIVE_AGENT = None


class ReceivingError(RuntimeError):
    def __init__(self, code, message, data=None):
        super().__init__(message)
        self.code, self.data = code, data or {}


def need(value, code, message, data=None):
    if not value:
        raise ReceivingError(code, message, data)


def check():
    if STOP is not None:
        raise STOP


def stopped(signum, _frame):
    global STOP
    if STOP is None:
        STOP = ReceivingError("INTERRUPTED", "The original receiving was interrupted.",
                              {"signal": signum})
    forward_agent(signum)
    connection = ACTIVE_HTTP
    active_socket = ACTIVE_HTTP_SOCKET
    if active_socket is None and connection is not None:
        active_socket = connection.sock
    if active_socket is not None:
        try:
            # HTTPResponse can retain its makefile after HTTPConnection has
            # detached the socket for Connection: close. Interrupt that same
            # accepted read; its original owners still perform final cleanup.
            active_socket.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
    if connection is not None:
        try:
            connection.close()
        except BaseException as error:
            STOP.data.setdefault("httpCloseError", failure(error))


def canonical(value):
    # This is the original model.canonical JSON representation.
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def encoded(value):
    return (canonical(value) + "\n").encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def request_id(operation, step):
    """Bounded native short_id; the complete operation remains in the selection."""
    return "engrecv-" + digest([operation, step])


def stamp():
    return datetime.now(timezone.utc).isoformat()


def failure(error):
    return {"name": type(error).__name__,
            "code": str(getattr(error, "code", "RECEIVING_FAILED")),
            "message": str(error)[:12000],
            "data": getattr(error, "data", {})}


def no_duplicates(items):
    value = {}
    for key, entry in items:
        need(key not in value, "DUPLICATE_JSON", "Retain one original value per JSON key.")
        value[key] = entry
    return value


def parse(raw):
    return json.loads(raw.decode("utf-8"), object_pairs_hook=no_duplicates,
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          ReceivingError("INVALID_JSON", "Non-finite JSON value: " + value)))


def safe_id(value, label):
    need(isinstance(value, str) and ID.fullmatch(value), "IDENTITY", "Retain " + label + ".")
    return value


def relative(value):
    need(isinstance(value, str) and 0 < len(value) <= 1000 and
         "\\" not in value and "\0" not in value, "PATH", "Use a complete relative member path.")
    path = PurePosixPath(value)
    need(not path.is_absolute() and all(p not in ("", ".", "..") for p in value.split("/"))
         and path.as_posix() == value, "PATH", "Keep the original canonical relative member.")
    return value


def absolute(value, *, directory=False, exists=True):
    need(isinstance(value, (str, Path)), "PATH", "Select an absolute original path.")
    path = Path(value)
    need(path.is_absolute() and str(path) == os.path.normpath(str(path)), "PATH",
         "Use an absolute normalized original path.")
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            need(not exists and current == path, "PATH_MISSING", "An original parent is unavailable.")
            break
        need(not stat.S_ISLNK(mode), "SYMLINK", "Keep the selected original path free of symlinks.")
        if current != path or directory:
            need(stat.S_ISDIR(mode), "DIRECTORY", "An original directory is unavailable.")
    return path


def separate(left, right):
    return left != right and left not in right.parents and right not in left.parents


def source_layout(product_directory, repository_directory=None, manifest=None):
    """Keep the original product imports and its complete repository selection."""
    product = absolute(product_directory, directory=True)
    root = absolute(repository_directory, directory=True) if repository_directory is not None else product
    need(root == product or root in product.parents, "SOURCE_BOUNDARY",
         "Select the original repository containing the complete grant product.")
    product_path = "" if product == root else relative(product.relative_to(root).as_posix())
    prefix = product_path + "/" if product_path else ""
    if manifest is not None:
        need(manifest.get("pathBase", "product") ==
             ("repository" if repository_directory is not None else "product")
             and manifest.get("productPath", "") == product_path,
             "SOURCE_ROOT_CHANGED",
             "Keep the original manifest path base and selected product within that repository.")
    return root, prefix


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private_directory(path):
    path = Path(path)
    if path.exists():
        absolute(path, directory=True)
        need(stat.S_IMODE(path.lstat().st_mode) & 0o077 == 0, "PRIVATE_DIRECTORY",
             "Retain the selected private receiving directory.")
        return path
    private_directory(path.parent)
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        absolute(path, directory=True)
        need(stat.S_IMODE(path.lstat().st_mode) & 0o077 == 0, "PRIVATE_DIRECTORY",
             "The receiving directory belongs to a different selection.")
    sync_dir(path.parent)
    return path


def stat_identity(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
            value.st_ctime_ns, stat.S_IMODE(value.st_mode))


def descriptor(path, *, maximum=MAX_DELIVERY, capture=False, allow_stop=False):
    path = absolute(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and 0 <= before.st_size <= maximum,
             "FILE_SIZE", "Retain a complete regular source within its declared bound.",
             {"path": str(path), "bytes": before.st_size})
        output, total, hashed = [], 0, hashlib.sha256()
        while True:
            if not allow_stop:
                check()
            block = os.read(fd, CHUNK)
            if not block:
                break
            total += len(block)
            need(total <= maximum, "FILE_SIZE", "The selected original source grew.")
            hashed.update(block)
            if capture:
                output.append(block)
        after = os.fstat(fd)
        live = path.lstat()
        need(stat_identity(before) == stat_identity(after) == stat_identity(live)
             and total == before.st_size, "SOURCE_CHANGED", "The selected file changed during its complete read.",
             {"path": str(path)})
        result = {"bytes": total, "sha256": hashed.hexdigest(), "mode": stat.S_IMODE(before.st_mode)}
        return (result, b"".join(output)) if capture else result
    finally:
        os.close(fd)


def selected_file(value, *, maximum=MAX_BUNDLE):
    need(isinstance(value, dict) and isinstance(value.get("bytes"), int)
         and not isinstance(value["bytes"], bool) and 0 <= value["bytes"] <= maximum
         and isinstance(value.get("sha256"), str) and SHA.fullmatch(value["sha256"]),
         "FILE_SELECTION", "Retain the original file size and complete SHA-256.")
    path = absolute(value.get("path"))
    info, raw = descriptor(path, maximum=maximum, capture=True)
    need(info["bytes"] == value["bytes"] and info["sha256"] == value["sha256"],
         "FILE_CHANGED", "The selected complete file differs from its original identity.",
         {"path": str(path)})
    return path, raw


def cleanup_files(primary, descriptors=(), temporary=None):
    """Release every original acquisition once, preserving its first failure."""
    cleanup_error = None
    for fd in descriptors:
        if fd is not None:
            try:
                os.close(fd)
            except BaseException as error:
                if cleanup_error is None:
                    cleanup_error = error
    if temporary is not None:
        try:
            temporary.unlink(missing_ok=True)
        except BaseException as error:
            if cleanup_error is None:
                cleanup_error = error
    if cleanup_error is not None:
        if primary is None:
            raise cleanup_error
        primary.receiving_cleanup_error = failure(cleanup_error)


def atomic(path, raw, *, replace=False, expected_sha=None):
    """Publish one complete private file while its original outer guard is held."""
    path = Path(path)
    private_directory(path.parent)
    if path.exists():
        info = descriptor(path, maximum=MAX_DELIVERY, allow_stop=True)
        if not replace:
            need(info["bytes"] == len(raw) and info["sha256"] == sha(raw),
                 "OUTPUT_CONFLICT", "Preserve the existing different output.", {"path": str(path)})
            sync_dir(path.parent)
            return {"path": str(path), "bytes": info["bytes"], "sha256": info["sha256"]}
        need(expected_sha is not None and info["sha256"] == expected_sha,
             "JOURNAL_CHANGED", "The original guarded journal changed.")
    else:
        need(expected_sha is None, "JOURNAL_MISSING", "The retained journal is unavailable.")
    fd, temporary, original_error = None, None, None
    try:
        fd, temporary_name = tempfile.mkstemp(prefix=".receiving-", dir=path.parent)
        temporary = Path(temporary_name)
        os.fchmod(fd, 0o600)
        position = 0
        while position < len(raw):
            written = os.write(fd, raw[position:position + CHUNK])
            need(written > 0, "WRITE_STOPPED", "The complete private publication stopped before its final bytes.")
            position += written
        os.fsync(fd)
        owned, fd = fd, None
        os.close(owned)
        if replace:
            os.replace(temporary, path)
        else:
            try:
                os.link(temporary, path, follow_symlinks=False)
            except FileExistsError:
                info = descriptor(path, maximum=MAX_DELIVERY, allow_stop=True)
                need(info["bytes"] == len(raw) and info["sha256"] == sha(raw),
                     "OUTPUT_CONFLICT", "Preserve the existing different output.")
            temporary.unlink()
        sync_dir(path.parent)
        return {"path": str(path), "bytes": len(raw), "sha256": sha(raw)}
    except BaseException as error:
        original_error = error
        raise
    finally:
        cleanup_files(original_error, (fd,), temporary)

def copy_exact(source, target, selected):
    """Copy one original source member with all acquisitions retained until close."""
    source, target = Path(source), Path(target)
    private_directory(target.parent)
    wanted = {"bytes": selected["bytes"], "sha256": selected["sha256"]}
    if target.exists():
        info = descriptor(target, maximum=MAX_SOURCE)
        need(all(info[k] == wanted[k] for k in wanted) and info["mode"] == selected["mode"], "OUTPUT_CONFLICT",
             "An existing received source member differs.", {"path": str(target)})
        sync_dir(target.parent)
        return
    source_fd, fd, temporary, original_error = None, None, None, None
    try:
        source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
        fd, temporary_name = tempfile.mkstemp(prefix=".source-", dir=target.parent)
        temporary = Path(temporary_name)
        before = os.fstat(source_fd)
        need(stat.S_ISREG(before.st_mode) and stat.S_IMODE(before.st_mode) == selected["mode"],
             "SOURCE_KIND", "Retain the original regular source member and mode.")
        os.fchmod(fd, selected["mode"])
        total, hashed = 0, hashlib.sha256()
        while True:
            check()
            block = os.read(source_fd, CHUNK)
            if not block:
                break
            total += len(block)
            need(total <= wanted["bytes"], "SOURCE_CHANGED", "A source member grew.")
            hashed.update(block)
            offset = 0
            while offset < len(block):
                written = os.write(fd, block[offset:])
                need(written > 0, "WRITE_STOPPED", "The complete source copy stopped before its final bytes.")
                offset += written
        need(total == wanted["bytes"] and hashed.hexdigest() == wanted["sha256"]
             and stat_identity(before) == stat_identity(os.fstat(source_fd)) == stat_identity(source.lstat()),
             "SOURCE_CHANGED", "The complete original source member changed.")
        os.fsync(fd)
        owned, fd = fd, None
        os.close(owned)
        try:
            os.link(temporary, target, follow_symlinks=False)
        except FileExistsError:
            info = descriptor(target, maximum=MAX_SOURCE)
            need(all(info[k] == wanted[k] for k in wanted) and info["mode"] == selected["mode"], "OUTPUT_CONFLICT",
                 "Preserve the different received source member.")
        temporary.unlink()
        sync_dir(target.parent)
    except BaseException as error:
        original_error = error
        raise
    finally:
        cleanup_files(original_error, (fd, source_fd), temporary)

class Guard:
    def __init__(self, directory):
        self.path = directory / "engagement-native.lock"
        self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            need(stat.S_ISREG(os.fstat(self.fd).st_mode), "GUARD", "Use the original regular receiving guard.")
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.identity = (os.fstat(self.fd).st_dev, os.fstat(self.fd).st_ino)
            self.assert_owned()
            sync_dir(directory)
        except BaseException as error:
            owned, self.fd = self.fd, None
            cleanup_files(error, (owned,))
            raise

    def assert_owned(self):
        need(self.fd is not None, "GUARD_CLOSED", "The original receiving guard is closed.")
        current, retained = self.path.lstat(), os.fstat(self.fd)
        need((current.st_dev, current.st_ino) == (retained.st_dev, retained.st_ino) == self.identity,
             "GUARD_CHANGED", "Retain the original receiving guard.")

    def close(self):
        if self.fd is not None:
            diagnostic = None
            try:
                self.assert_owned()
            except BaseException as error:
                diagnostic = error
            owned, self.fd = self.fd, None
            cleanup_files(diagnostic, (owned,))
            if diagnostic is not None:
                raise diagnostic
        # The regular guard remains; its original raw descriptor is always released.


class Host:
    def __init__(self, selected, override_url=None):
        need(isinstance(selected, dict), "HOST", "Select the existing original SF47 host.")
        actual_url = override_url or selected.get("url", "")
        parsed = urlsplit(actual_url)
        need(parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "::1", "localhost")
             and not parsed.username and not parsed.password and parsed.path in ("", "/")
             and not parsed.query and not parsed.fragment and parsed.port is not None,
             "HOST", "Use the supplied original loopback origin and actual port.")
        self.origin, self.address = actual_url.rstrip("/"), parsed
        self.workspace = absolute(selected.get("workspaceDirectory"), directory=True)
        self.key_file = absolute(selected.get("keyFile"))
        info, key = descriptor(self.key_file, maximum=16384, capture=True)
        need(SHA.fullmatch(selected.get("keySha256", "")) and info["sha256"] == selected["keySha256"]
             and info["mode"] & 0o077 == 0, "HOST_KEY", "Use the original private access-key file.")
        need(self.key_file.parent == self.workspace, "HOST_KEY", "Keep the key in its selected original workspace.")
        self.token = key.decode("utf-8").strip()
        need(bool(self.token) and not re.search(r"[\s\r\n]", self.token), "HOST_KEY", "Use the complete original access key.")
        self.selection = {"workspaceDirectory": str(self.workspace),
                          "keyFile": str(self.key_file), "keySha256": info["sha256"]}

    def request(self, method, path, *, raw=None, headers=None, timeout=30):
        global ACTIVE_HTTP, ACTIVE_HTTP_SOCKET
        check()
        need(method in ("GET", "POST") and path.startswith("/api/") and not path.startswith("//")
             and "\r" not in path and "\n" not in path, "HTTP_PATH", "Use the original native API path.")
        need(raw is None or isinstance(raw, bytes) and len(raw) <= MAX_BUNDLE,
             "HTTP_SIZE", "Retain the complete original request within 32 MiB.")
        supplied = {"Authorization": "Bearer " + self.token, "Origin": self.origin,
                    "Accept": "application/json, application/zip, application/octet-stream",
                    "Connection": "close"}
        for key, value in (headers or {}).items():
            need(key in ("Content-Type", "X-Request-ID", "X-Recorded-By"), "HTTP_HEADERS",
                 "Use only the original native request headers.")
            supplied[key] = value
        if raw is not None:
            supplied["Content-Length"] = str(len(raw))
        connection = http.client.HTTPConnection(self.address.hostname, self.address.port, timeout=timeout)
        ACTIVE_HTTP = connection
        ACTIVE_HTTP_SOCKET = None
        response = None
        original_error = None
        request_deadline = time.monotonic() + timeout
        try:
            connection.request(method, path, body=raw, headers=supplied)
            ACTIVE_HTTP_SOCKET = connection.sock
            check()
            remaining = request_deadline - time.monotonic()
            need(remaining > 0, "HTTP_DEADLINE", "The original native request reached its retained response deadline.")
            if ACTIVE_HTTP_SOCKET is not None and ACTIVE_HTTP_SOCKET.fileno() >= 0:
                ACTIVE_HTTP_SOCKET.settimeout(remaining)
            response = connection.getresponse()
            length = response.getheader("Content-Length")
            expected = int(length) if length is not None and length.isdigit() else None
            need(expected is None or expected <= MAX_BUNDLE, "HTTP_SIZE", "The complete native response exceeds 32 MiB.")
            blocks, total = [], 0
            while True:
                check()
                remaining = request_deadline - time.monotonic()
                need(remaining > 0, "HTTP_DEADLINE", "The original native request reached its retained response deadline.")
                if ACTIVE_HTTP_SOCKET is not None and ACTIVE_HTTP_SOCKET.fileno() >= 0:
                    ACTIVE_HTTP_SOCKET.settimeout(remaining)
                block = response.read(CHUNK)
                if not block:
                    break
                total += len(block)
                need(total <= MAX_BUNDLE, "HTTP_SIZE", "The complete native response exceeds 32 MiB.")
                blocks.append(block)
            need(expected is None or total == expected, "HTTP_TRUNCATED",
                 "The original native response ended before its declared complete bytes.")
            check()
            return response.status, dict(response.getheaders()), b"".join(blocks)
        except BaseException as error:
            original_error = STOP if STOP is not None else error
            if STOP is not None and error is not STOP:
                raise STOP from error
            raise
        finally:
            cleanup_error = None
            for owner in (response, connection):
                if owner is not None:
                    try:
                        owner.close()
                    except BaseException as error:
                        if cleanup_error is None:
                            cleanup_error = error
            if ACTIVE_HTTP is connection:
                ACTIVE_HTTP = None
                ACTIVE_HTTP_SOCKET = None
            if cleanup_error is not None:
                if original_error is not None:
                    original_error.receiving_cleanup_error = failure(cleanup_error)
                else:
                    raise cleanup_error


class Receiving:
    def __init__(self, config, *, host_url=None, receiving_url=None, agent_execution_continuation=None):
        need(isinstance(config, dict) and config.get("schema") == SCHEMA, "INPUT_SCHEMA",
             "Use the complete original contributor receiving input.")
        self.config = deepcopy(config)
        self.operation = safe_id(config.get("operationId"), "the stable original receiving operation")
        need(config.get("mode") in ("ACTUAL", "WALKTHROUGH"), "MODE",
             "Choose supplied original case data or the explicitly designated walkthrough.")
        need(isinstance(config.get("actor"), str) and config["actor"].strip(), "ACTOR",
             "Retain the actual original recording operator.")
        self.actor = config["actor"]
        self.source = absolute(config.get("sourceDirectory"), directory=True)
        self.source_root, self.source_prefix = source_layout(self.source, config.get("repositoryRoot"))
        self.output = absolute(config.get("outputDirectory"), directory=True, exists=False)
        parent = absolute(self.output.parent, directory=True)
        need(stat.S_IMODE(parent.lstat().st_mode) & 0o077 == 0, "PRIVATE_DIRECTORY",
             "Use an existing owned private output parent.")
        self.host = Host(config.get("host"), host_url)
        self.receiving_host = Host(config["receivingHost"], receiving_url) if "receivingHost" in config else self.host
        need("receivingHost" in config or receiving_url is None, "RECEIVING_HOST",
             "Override only a separately selected original receiving host.")
        seconds = config.get("deadlineSeconds", 3600)
        need(isinstance(seconds, int) and not isinstance(seconds, bool) and 1 <= seconds <= 86400,
             "DEADLINE", "Choose a receiving deadline from one second through one day.")
        need(all(separate(self.output, root) for root in
                 (self.source_root, self.host.workspace, self.receiving_host.workspace)), "PATH_OVERLAP",
             "Keep output outside the original source and both native workspaces.")
        private_directory(self.output)
        self.guard = Guard(self.output)
        self.journal_path = self.output / "ENGAGEMENT_NATIVE_JOURNAL.json"
        self.journal_sha = None
        self.deadline = time.monotonic() + seconds
        self.case_id, self.case_version = None, None
        self.state = None
        try:
            manifest_path, manifest_raw = selected_file(config.get("sourceManifest"), maximum=16 * 1024 * 1024)
            need(separate(self.output, manifest_path), "PATH_OVERLAP", "Keep the original manifest outside receiving output.")
            self.manifest = parse(manifest_raw)
            need(self.manifest.get("schema") == SOURCE_SCHEMA and isinstance(self.manifest.get("files"), list)
                 and 1 <= len(self.manifest["files"]) <= 8192, "SOURCE_MANIFEST",
                 "Supply the complete selected native source manifest.")
            source_layout(self.source, config.get("repositoryRoot"), self.manifest)
            paths, total = set(), 0
            for item in self.manifest["files"]:
                name = relative(item.get("path"))
                need(name not in paths and isinstance(item.get("bytes"), int) and
                     not isinstance(item["bytes"], bool) and item["bytes"] >= 0
                     and isinstance(item.get("mode"), int) and not isinstance(item["mode"], bool)
                     and 0 <= item["mode"] <= 0o777
                     and SHA.fullmatch(item.get("sha256", "")), "SOURCE_MANIFEST",
                     "Keep distinct complete original source members.")
                paths.add(name)
                total += item["bytes"]
                need(total <= MAX_SOURCE, "SOURCE_SIZE", "The complete selected native source exceeds 128 MiB.")
                actual = descriptor(self.source_root / name, maximum=MAX_SOURCE)
                need(actual["bytes"] == item["bytes"] and actual["sha256"] == item["sha256"]
                     and actual["mode"] == item["mode"],
                     "SOURCE_CHANGED", "The installed native source differs from its original selection.", {"path": name})
            required_source = {"budget.py", "workspace/operations.py", "workspace/operations_http.py",
                               "workspace/operations_engagements.py", "workspace/engagement_handover.py",
                               "workspace/forecast.py", "workspace/portfolio.py", "workspace/model.py",
                               "workspace/operations_engagements_receiving.py"}
            need({self.source_prefix + name for name in required_source}.issubset(paths),
                 "SOURCE_CLOSURE", "Retain the complete original Operations, native engines and receiving caller.")
            original_caller = next(row for row in self.manifest["files"]
                                   if row["path"] == self.source_prefix + "workspace/operations_engagements_receiving.py")
            executed_caller = descriptor(Path(__file__).absolute(), maximum=MAX_SOURCE)
            if agent_execution_continuation is None:
                need(all(executed_caller[key] == original_caller[key] for key in ("bytes", "sha256")),
                     "EXECUTED_SOURCE_CHANGED", "Execute the complete caller from the selected original source edition.")
            self.selection = {"schema": SCHEMA + ".selection", "operationId": self.operation,
                "inputSha256": digest(config), "mode": config["mode"], "actor": self.actor,
                "sourceDirectory": str(self.source), "sourceManifest": deepcopy(config["sourceManifest"]),
                **({"repositoryRoot": str(self.source_root)} if "repositoryRoot" in config else {}),
                "host": self.host.selection, "receivingHost": self.receiving_host.selection}
            self.agent_execution_continuation = (bind_agent_execution_continuation(self, agent_execution_continuation)
                                                 if agent_execution_continuation is not None else None)
            self.agent = bind_agent(self) if "agent" in config else None
            atomic(self.output / "receiving-input.json", encoded(config))
            atomic(self.output / "SOURCE_SELECTION.json", manifest_raw)
            atomic(self.output / "RECEIVING_SELECTION.json", encoded(self.selection))
            if self.journal_path.exists():
                info, raw = descriptor(self.journal_path, maximum=16 * 1024 * 1024, capture=True)
                self.state = parse(raw)
                self.journal_sha = info["sha256"]
                need(self.state.get("schema") == STATE_SCHEMA and self.state.get("selection") == self.selection,
                     "SELECTION_CHANGED", "Resume the original complete receiving input and source edition.")
            else:
                self.state = {"schema": STATE_SCHEMA, "selection": self.selection, "createdAt": stamp(),
                              "state": "PREPARED", "steps": {}, "artifacts": {}, "attempts": []}
                self.save()
            if "preparationSource" in config:
                _, prepared_raw = selected_file(config["preparationSource"], maximum=16 * 1024 * 1024)
                self.artifact("original-preparation-input", "original-inputs/preparation-selection.json", prepared_raw)
            self.state["attempts"].append({"startedAt": stamp(), "state": "RUNNING",
                "hostOrigin": self.host.origin, "receivingOrigin": self.receiving_host.origin})
            self.save()
        except BaseException as error:
            try:
                self.guard.close()
            except BaseException as cleanup_error:
                error.receiving_cleanup_error = failure(cleanup_error)
            raise

    def close(self):
        self.guard.close()

    def save(self):
        self.guard.assert_owned()
        raw = encoded(self.state)
        atomic(self.journal_path, raw, replace=True, expected_sha=self.journal_sha)
        self.journal_sha = sha(raw)

    def tick(self):
        check()
        need(time.monotonic() < self.deadline, "DEADLINE",
             "The retained native receiving reached its selected deadline.")

    def artifact(self, key, path, raw):
        self.guard.assert_owned()
        target = self.output / relative(path)
        info = atomic(target, raw)
        row = {"path": target.relative_to(self.output).as_posix(),
               "bytes": info["bytes"], "sha256": info["sha256"]}
        previous = self.state["artifacts"].get(key)
        need(previous is None or previous == row, "ARTIFACT_CHANGED",
             "The retained receiving artifact changed.")
        self.state["artifacts"][key] = row
        self.save()
        return row

    def retained(self, row):
        info, raw = descriptor(self.output / relative(row["path"]), capture=True)
        need(info["bytes"] == row["bytes"] and info["sha256"] == row["sha256"],
             "ARTIFACT_CHANGED", "A retained complete response or source file changed.")
        return raw

    def read(self, path, host=None):
        self.tick()
        status, headers, raw = (host or self.host).request("GET", path,
            timeout=max(1, min(30, int(self.deadline - time.monotonic()))))
        value = parse(raw) if "application/json" in headers.get("Content-Type", headers.get("content-type", "")) else None
        need(status == 200 and isinstance(value, dict), "NATIVE_READ", "The original native read did not complete.",
             {"path": path, "status": status, "nativeError": value})
        return value

    def json_step(self, key, path, build=None, *, host=None, mutation=False):
        """Freeze first input and exact version before any original POST."""
        safe_id(key, "the original step identity")
        selected_host = host or self.host
        step = self.state["steps"].get(key)
        if step is None:
            self.tick()
            body = build() if build is not None else None
            request = {"method": "POST" if build is not None else "GET", "path": path,
                       "host": selected_host.selection, "body": body, "mutation": mutation}
            request_file = self.artifact("request-" + key, "requests/" + key + ".json", encoded(request))
            step = {"request": request_file, "requestSha256": digest(request),
                    "state": "PREPARED", "attempts": 0}
            self.state["steps"][key] = step
            self.save()
        request = parse(self.retained(step["request"]))
        need(digest(request) == step["requestSha256"] and request["path"] == path
             and request["host"] == selected_host.selection and request["mutation"] == mutation, "REQUEST_CHANGED",
             "Resume the same original native request.")
        if step["state"] == "COMPLETE":
            value = parse(self.retained(step["response"]))
            need(digest(value) == step["resultSha256"], "RESULT_CHANGED", "Retain the complete original native result.")
            return value
        published = self.output / "responses" / (key + ".json")
        if published.exists():
            # This private create-only file is published only after a complete HTTP 200.
            info, response = descriptor(published, maximum=MAX_BUNDLE, capture=True)
            value = parse(response)
            need(isinstance(value, dict), "RESULT_CHANGED", "The original published native response is incomplete.")
            file = self.artifact("response-" + key, "responses/" + key + ".json", response)
            step.update(state="COMPLETE", response=file, resultSha256=digest(value), error=None)
            self.save()
            return value
        self.tick()
        step["state"], step["attempts"] = "SENDING", step["attempts"] + 1
        self.save()
        try:
            raw = None if request["method"] == "GET" else encoded(request["body"])
            timeout = max(1, min(30, int(self.deadline - time.monotonic())))
            if (request["mutation"] and isinstance(request["body"], dict)
                    and request["body"].get("action") == "engagement.receiving"):
                # This original transaction validates full saved Forecast and
                # Portfolio outputs. Its accepted request owns the remaining
                # receiving budget, rather than an unrelated 30-second cap.
                timeout = self.deadline - time.monotonic()
                need(timeout > 0, "DEADLINE", "The original receiving reached its selected deadline.")
            status, _, response = selected_host.request(request["method"], path, raw=raw,
                headers={"Content-Type": "application/json"} if raw is not None else {},
                timeout=timeout)
            value = parse(response)
            need(status == 200 and isinstance(value, dict), "NATIVE_REQUEST",
                 "The original native request did not complete.",
                 {"path": path, "status": status, "nativeError": value})
            # Retain the actual original response bytes before recording COMPLETE.
            filename = "responses/" + key + ".json"
            file = self.artifact("response-" + key, filename, response)
            step.update(state="COMPLETE", response=file, resultSha256=digest(value), error=None)
            self.save()
            return value
        except BaseException as error:
            step.update(state="UNKNOWN" if mutation else "INCOMPLETE", error=failure(error))
            try:
                self.save()
            except BaseException as save_error:
                error.receiving_save_error = failure(save_error)
            raise

    def local_step(self, key, build):
        previous = self.state["steps"].get(key)
        if previous:
            need(previous.get("kind") == "LOCAL" and previous.get("state") == "COMPLETE",
                 "LOCAL_STEP", "Preserve the complete original derived selection.")
            value = parse(self.retained(previous["response"]))
            need(digest(value) == previous["resultSha256"], "LOCAL_STEP", "The complete original local selection differs.")
            return value
        self.tick()
        published = self.output / "selections" / (key + ".json")
        if published.exists():
            _, raw = descriptor(published, maximum=MAX_BUNDLE, capture=True)
            value = parse(raw)
        else:
            value = build()
            raw = encoded(value)
        file = self.artifact("local-" + key, "selections/" + key + ".json", raw)
        self.state["steps"][key] = {"kind": "LOCAL", "state": "COMPLETE", "response": file,
                                   "resultSha256": digest(value)}
        self.save()
        return value

    def command(self, key, action, data, *, expected=None, note=None):
        version = self.case_version if expected is None else expected
        def body():
            return {"expectedVersion": version, "requestId": request_id(self.operation, key),
                    "actor": self.actor, "note": note or self.config["reviewNote"],
                    "action": action, "data": deepcopy(data)}
        value = self.json_step(key, "/api/operations/" + self.case_id + "/command",
                               body, mutation=True)
        need(value.get("id") == self.case_id and value.get("action") == action
             and isinstance(value.get("version"), int) and value["version"] == version + 1,
             "NATIVE_RECEIPT", "The original command returned another native operation.")
        self.case_version = value["version"]
        return value

    def preview(self, key, endpoint, field, value):
        return self.json_step(key, "/api/operations/" + self.case_id + "/" + endpoint,
            lambda: {"expectedVersion": self.case_version, field: deepcopy(value)})

    def download(self, key, path, filename, host=None):
        selected_host = host or self.host
        step = self.state["steps"].get(key)
        binding = {"path": path, "host": selected_host.selection}
        if step:
            need(step.get("kind") == "DOWNLOAD" and step.get("binding") == binding,
                 "DOWNLOAD_CHANGED", "Resume the original complete native download.")
            if step.get("state") == "COMPLETE":
                self.retained(step["response"])
                return step["response"]
        else:
            step = {"kind": "DOWNLOAD", "binding": binding, "state": "PREPARED"}
            self.state["steps"][key] = step
            self.save()
        published = self.output / relative(filename)
        if published.exists():
            _, raw = descriptor(published, maximum=MAX_BUNDLE, capture=True)
            file = self.artifact("download-" + key, filename, raw)
            step.update(state="COMPLETE", response=file)
            self.save()
            return file
        self.tick()
        status, _, raw = selected_host.request("GET", path,
            timeout=max(1, min(30, int(self.deadline - time.monotonic()))))
        need(status == 200, "NATIVE_DOWNLOAD", "The original complete download did not finish.",
             {"path": path, "status": status})
        file = self.artifact("download-" + key, filename, raw)
        step.update(state="COMPLETE", response=file)
        self.save()
        return file

    def import_case(self, file, name):
        key = "receive-complete-case"
        host = self.receiving_host
        raw = self.retained(file)
        need(len(raw) <= MAX_BUNDLE, "CASE_SIZE", "Use the original complete case ZIP within 32 MiB.")
        request = {"path": "/api/operations/import?" + urlencode({"name": name}),
                   "host": host.selection, "archive": file, "name": name,
                   "requestId": request_id(self.operation, "receive-complete-case"), "actor": self.actor}
        step = self.state["steps"].get(key)
        if not step:
            selected = self.artifact("request-" + key, "requests/" + key + ".json", encoded(request))
            step = {"kind": "IMPORT", "request": selected, "state": "PREPARED", "attempts": 0}
            self.state["steps"][key] = step
            self.save()
        need(parse(self.retained(step["request"])) == request, "IMPORT_CHANGED",
             "Keep the original complete receiving bytes, name, actor and request key.")
        if step["state"] == "COMPLETE":
            value = parse(self.retained(step["response"]))
            need(value.get("action") == "import", "IMPORT_RESULT", "Retain the complete original import result.")
            return value
        published = self.output / "responses" / (key + ".json")
        if published.exists():
            _, raw_result = descriptor(published, maximum=MAX_BUNDLE, capture=True)
            value = parse(raw_result)
            need(value.get("action") == "import", "IMPORT_RESULT", "Retain the original published import result.")
            response = self.artifact("response-" + key, "responses/" + key + ".json", raw_result)
            step.update(state="COMPLETE", response=response, error=None)
            self.save()
            return value
        self.tick()
        step.update(state="SENDING", attempts=step["attempts"] + 1)
        self.save()
        try:
            status, _, result_raw = host.request("POST", request["path"], raw=raw,
                headers={"Content-Type": "application/zip", "X-Request-ID": request["requestId"],
                         "X-Recorded-By": quote(self.actor, safe="")},
                timeout=max(1, min(30, int(self.deadline - time.monotonic()))))
            value = parse(result_raw)
            need(status == 200 and value.get("action") == "import", "NATIVE_IMPORT",
                 "The original native importer did not complete.", {"status": status, "nativeError": value})
            response = self.artifact("response-" + key, "responses/" + key + ".json", result_raw)
            step.update(state="COMPLETE", response=response, error=None)
            self.save()
            return value
        except BaseException as error:
            step.update(state="UNKNOWN", error=failure(error))
            try:
                self.save()
            except BaseException as save_error:
                error.receiving_save_error = failure(save_error)
            raise


def book_reference(value):
    return {"reviewId": value["review"]["id"], "reviewSha256": value["review"]["sha256"]}


def immutable_saved(value):
    return {key: deepcopy(item) for key, item in value.items() if key != "current"}


def complete_hash(value, label):
    need(isinstance(value, dict) and SHA.fullmatch(value.get("sha256", "")) and
         digest({key: entry for key, entry in value.items() if key != "sha256"}) == value["sha256"],
         "NATIVE_IDENTITY", "The complete original " + label + " differs from its saved SHA-256.")
    return value


def read_archive(raw):
    """Verify every original member without extracting paths or recalculating engines."""
    need(len(raw) <= MAX_BUNDLE, "ARCHIVE_SIZE", "The native case ZIP exceeds 32 MiB.")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        members = archive.infolist()
        names = [item.filename for item in members]
        need(len(names) == len(set(names)) and len(names) <= 220 and
             sum(item.file_size for item in members) <= MAX_BUNDLE,
             "ARCHIVE_MEMBERS", "Retain the complete bounded original case archive.")
        for item in members:
            relative(item.filename)
            need(not item.is_dir() and not stat.S_ISLNK(item.external_attr >> 16),
                 "ARCHIVE_MEMBERS", "Retain regular original case members.")
        manifest_raw = archive.read("MANIFEST.json")
        manifest = parse(manifest_raw)
        need(manifest.get("schema") == CASE_SCHEMA + ".bundle" and isinstance(manifest.get("files"), list),
             "ARCHIVE_MANIFEST", "Use the original complete case manifest.")
        rows = manifest["files"]
        need(len(rows) == len(names) - 1 and {row["path"] for row in rows} == set(names) - {"MANIFEST.json"},
             "ARCHIVE_MANIFEST", "The native manifest must name its complete exact payload.")
        files = {}
        for row in rows:
            value = archive.read(relative(row["path"]))
            need(len(value) == row["bytes"] and sha(value) == row["sha256"],
                 "ARCHIVE_HASH", "An original native archive member differs.")
            files[row["path"]] = value
        document = parse(files["operations.json"])
        need(document.get("schema") == CASE_SCHEMA, "CASE_SCHEMA", "Use the complete original case document.")
        for row in document["sources"]:
            value = files.get("sources/" + row["id"])
            need(value is not None and len(value) == row["bytes"] and sha(value) == row["sha256"],
                 "SOURCE_HASH", "An original native source attachment is missing or changed.")
        need("planning.zip" in files, "PLANNING_MISSING", "Retain the complete original planning archive.")
        return {"manifest": manifest, "manifestRaw": manifest_raw, "document": document, "files": files}


def planning_archive(raw):
    """Read the original planning export solely for complete received-byte comparison."""
    need(len(raw) <= MAX_BUNDLE, "PLANNING_SIZE", "Retain the original bounded planning archive.")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        names = [row.filename for row in entries]
        need(len(names) == len(set(names)) and len(names) <= 20
             and sum(row.file_size for row in entries) <= MAX_BUNDLE,
             "PLANNING_MEMBERS", "Retain all original planning members once.")
        for row in entries:
            relative(row.filename)
            need(not row.is_dir() and not stat.S_ISLNK(row.external_attr >> 16),
                 "PLANNING_MEMBERS", "The planning export must contain only its original files.")
        manifest = parse(archive.read("MANIFEST.json"))
        rows = manifest.get("files")
        need(manifest.get("schema") == "stellar-forge.sf47-planning.v1.bundle"
             and isinstance(rows, list) and len(rows) == len(names) - 1
             and {row["path"] for row in rows} == set(names) - {"MANIFEST.json"},
             "PLANNING_MANIFEST", "Retain the whole native planning member manifest.")
        files = {}
        for row in rows:
            value = archive.read(relative(row["path"]))
            need(len(value) == row["bytes"] and sha(value) == row["sha256"],
                 "PLANNING_HASH", "An original planning member differs from its retained hash.")
            files[row["path"]] = value
        document = parse(files["workspace.json"])
        need(document.get("schema") == "stellar-forge.sf47-planning.v1"
             and sha(files["original-source.json"]) == document["plan"]["source"]["sha256"],
             "PLANNING_SOURCE", "Keep the exact complete original planning source bytes.")
        return document, files


def actual_input(client):
    selected = client.config.get("actual")
    need(isinstance(selected, dict) and "walkthrough" not in client.config, "ACTUAL_INPUT",
         "Supply only the original selected case, agreement and source data in ACTUAL mode.")
    case_id = selected.get("caseId")
    need(isinstance(case_id, str) and re.fullmatch(r"operation-[a-f0-9]{32}", case_id), "CASE",
         "Select the original native Operations case.")
    original = client.json_step("selected-original-case", "/api/operations/" + case_id)
    need(original["program"]["version"] == selected.get("expectedVersion")
         and original["program"]["state"] == "OPEN"
         and original["plan"]["contentSha256"] == selected.get("planContentSha256")
         and original["plan"]["source"]["sha256"] == selected.get("planSourceSha256"),
         "CASE_SELECTION", "The original reviewed case version or pinned source differs.")
    client.case_id, client.case_version = case_id, original["program"]["version"]
    need(("document" in selected) != ("reviewId" in selected), "AGREEMENT_INPUT",
         "Select either the complete original agreement document or an existing reviewed edition.")
    if "document" in selected:
        _, raw = selected_file(selected["document"], maximum=MAX_BUNDLE)
        document = parse(raw)
        client.artifact("actual-document", "original-inputs/engagement-document.json", raw)
    else:
        document = None
    need(isinstance(selected.get("agreementIds"), list) and selected["agreementIds"],
         "AGREEMENT_SELECTION", "Select the actual confirmed original agreements explicitly.")
    return original, selected, document


def walkthrough_input(client):
    chosen = client.config.get("walkthrough")
    need(isinstance(chosen, dict) and "actual" not in client.config, "WALKTHROUGH_INPUT",
         "Select the immutable original plan for an explicit walkthrough case.")
    revision = chosen.get("revision")
    need(isinstance(revision, int) and revision > 0, "PLAN_REVISION", "Select the original saved plan revision.")
    plan = client.json_step("selected-original-plan",
        "/api/plans/" + safe_id(chosen.get("planId"), "the original plan") + "/revision/" + str(revision))
    need(plan["id"] == chosen["planId"] and plan["revision"] == revision
         and plan["contentSha256"] == chosen.get("planContentSha256")
         and plan["source"]["sha256"] == chosen.get("planSourceSha256"),
         "PLAN_SELECTION", "The selected immutable original plan differs.")
    date.fromisoformat(chosen["asOfDate"])
    date.fromisoformat(chosen["calendarStart"])
    confirmed = datetime.fromisoformat(chosen["confirmedAt"].replace("Z", "+00:00"))
    need(confirmed.tzinfo is not None and confirmed.astimezone(timezone.utc).date().isoformat() <= chosen["asOfDate"],
         "EXAMPLE_DATE", "Retain the explicitly selected example confirmation through its as-of date.")
    path, source_raw = selected_file(chosen.get("exampleSource"), maximum=8 * 1024 * 1024)
    example = parse(source_raw)
    need(example.get("schema") == EXAMPLE_SCHEMA and example.get("fictional") is True
         and isinstance(example.get("people"), list) and len(example["people"]) == 2
         and {row.get("key") for row in example["people"]} == {"confirmed", "proposed"},
         "EXAMPLE_SOURCE", "Use the complete two-person explicitly fictional source card.")
    for row in example["people"]:
        need(row.get("fictional") is True and isinstance(row.get("name"), str) and row["name"].startswith("Example "),
             "EXAMPLE_SOURCE", "Keep the example people explicitly named as examples.")
    client.artifact("example-source", "original-inputs/" + path.name, source_raw)
    created = client.json_step("create-walkthrough", "/api/operations", lambda: {
        "planId": chosen["planId"], "selectedRevision": revision,
        "expectedContentSha256": chosen["planContentSha256"],
        "name": "WALKTHROUGH — " + chosen["name"], "mode": "WALKTHROUGH",
        "calendarStart": chosen["calendarStart"], "actor": client.actor,
        "requestId": request_id(client.operation, "create-walkthrough")}, mutation=True)
    need(created.get("action") == "create" and created.get("version") == 1,
         "CREATE_RECEIPT", "The original walkthrough create returned another operation.")
    client.case_id, client.case_version = created["id"], 1
    case = client.json_step("created-walkthrough", "/api/operations/" + client.case_id)
    need(case["program"]["mode"] == "WALKTHROUGH" and case["plan"]["contentSha256"] == plan["contentSha256"],
         "WALKTHROUGH_CASE", "Only the original newly created walkthrough may receive examples.")
    source = client.command("example-source-add", "source.add", {
        "filename": path.name, "contentBase64": base64.b64encode(source_raw).decode("ascii"),
        "mediaType": "application/json", "kind": "other", "sourceUrl": "",
        "observedAt": chosen["confirmedAt"]},
        note="Attach the complete fictional receiving source; no real commitment.")
    people = {}
    for row in example["people"]:
        receipt = client.command("example-person-" + row["key"], "contributor.save", {
            "name": row["name"], "kind": "PERSON", "contact": "",
            "note": row["scope"], "sourceIds": [source["recordId"]],
            "sourceNote": "Explicit fictional walkthrough source. No real contributor was added to a live case."},
            note="Create this example only in the selected WALKTHROUGH case.")
        people[row["key"]] = receipt["recordId"]
    return chosen, example, source["recordId"], people


def save_book(client, key, document):
    preview = client.preview(key + "-preview", "engagement-preview", "document", document)
    saved = client.command(key + "-save", "engagement.prepare",
        {"document": preview["document"], "expectedPreviewSha256": preview["previewSha256"]},
        expected=preview["source"]["version"])
    book = client.json_step(key + "-reopen",
        "/api/operations/" + client.case_id + "/engagements/" + saved["recordId"])
    complete_hash(book["review"], "engagement review")
    need(book["review"]["sha256"] == saved["reviewSha256"] and book["document"] == preview["document"]
         and book["previewSha256"] == preview["previewSha256"], "BOOK_REOPEN",
         "The original saved engagement differs from its reviewed edition.")
    return book


def baseline(client, raw=None, forecast_id=None):
    if raw is not None:
        preview = client.preview("baseline-preview", "forecast-preview", "inputs", raw)
        saved = client.command("baseline-save", "forecast.save",
            {"inputs": preview["inputs"], "expectedPreviewSha256": preview["previewSha256"]},
            expected=preview["source"]["version"])
        forecast_id = saved["recordId"]
    value = client.json_step("baseline-reopen",
        "/api/operations/" + client.case_id + "/forecasts/" + safe_id(forecast_id, "the original baseline forecast"))
    native = immutable_saved(value)
    complete_hash(native, "baseline Forecast")
    need(value["current"]["sourceChanged"] is False, "BASELINE_SOURCE",
         "The supplied baseline must retain the selected current native case facts.")
    return native


def example_document(client, chosen, example, source_id, people, saved, *, confirmed, previous=None):
    packages = saved["report"]["packages"]
    need(packages, "EXAMPLE_PACKAGES", "The selected original plan has no grant packages for this course.")
    start = saved["report"]["firstForecastDate"]
    end = max(start, max(row["endDate"] for row in packages))
    agreements = []
    for person in example["people"]:
        key = person["key"]
        allocations = [{"costId": row["id"], "remainingHours": row["remainingHours"],
            "remainingCostUsd": row["remainingCostUsd"],
            "note": "Fictional course allocation of this original native remaining package estimate."}
            for row in packages] if key == "confirmed" else []
        total = format(sum((Decimal(row["remainingCostUsd"]) for row in allocations), Decimal("0")), ".2f")
        source = {"sourceIds": [source_id], "sourceNote": example["sourceNote"]}
        accepted = confirmed and key == "confirmed"
        agreements.append({"id": "engagement-" + digest([client.operation, key])[:32],
            "contributorId": people[key], "role": person["role"], "scope": person["scope"],
            "startDate": start, "endDate": end,
            "availability": {"hoursByWeekday": deepcopy(person["hoursByWeekday"]),
                "hoursByDate": {}, "note": "Explicit example availability for this receiving case.", **source},
            "compensation": {"basis": "FIXED" if allocations else "UNSPECIFIED", "rateUsd": None,
                "totalUsd": total if allocations else None, "paymentTerms": person["paymentTerms"],
                "paymentMode": person["paymentMode"], "note": "Example only: the native remaining allocation is retained without recording payment.",
                **source},
            "acceptance": {"status": "CONFIRMED" if accepted else "PROPOSED",
                "by": person["name"] if accepted else "", "at": chosen["confirmedAt"] if accepted else None,
                "note": "Explicit fictional status inside the WALKTHROUGH case.", **source},
            "allocations": allocations, **source})
    return {"schema": BOOK_SCHEMA, "name": "Example confirmed edition" if confirmed else "Example proposed edition",
            "asOfDate": chosen["asOfDate"], "agreements": agreements,
            "supersedes": book_reference(previous) if previous else None,
            "note": "Complete receiving course; example people and terms are confined to this original WALKTHROUGH case."}


def select_books(client):
    mode = client.config["mode"]
    need(isinstance(client.config.get("reviewNote"), str) and client.config["reviewNote"].strip(),
         "REVIEW_NOTE", "Retain the original nonempty native review note.")
    if mode == "ACTUAL":
        original, chosen, document = actual_input(client)
        saved = baseline(client, forecast_id=chosen.get("baseForecastId"))
        need(saved["sha256"] == chosen.get("baseForecastSha256"), "BASELINE_SELECTION",
             "Retain the supplied complete original baseline Forecast SHA-256.")
        if document is not None:
            book = save_book(client, "actual-book", document)
        else:
            book = client.json_step("actual-book-reopen",
                "/api/operations/" + client.case_id + "/engagements/" + safe_id(chosen["reviewId"], "the original engagement review"))
            need(book["review"]["sha256"] == chosen.get("reviewSha256"),
                 "BOOK_SELECTION", "Retain the supplied original complete engagement edition.")
            complete_hash(book["review"], "engagement review")
        need(all(agreement in {row["id"] for row in book["document"]["agreements"]}
                 for agreement in chosen["agreementIds"]), "AGREEMENT_SELECTION",
             "Use the supplied original agreement IDs.")
        finance = deepcopy(chosen.get("forecastSelection", {}))
        finance.update(**book_reference(book), forecastId=saved["id"], agreementIds=chosen["agreementIds"])
        portfolio = deepcopy(chosen.get("portfolioSelection", {}))
        need(isinstance(portfolio.get("resourceMap"), list), "RESOURCE_SELECTION",
             "Supply the original reviewed contributor/resource mapping.")
        if "portfolioInputs" in chosen:
            _, raw = selected_file(chosen["portfolioInputs"])
            client.artifact("actual-portfolio-inputs", "original-inputs/portfolio-inputs.json", raw)
            portfolio["inputs"] = parse(raw)
        return book, saved, finance, portfolio

    chosen, example, source_id, people = walkthrough_input(client)
    saved = baseline(client, raw={"name": "WALKTHROUGH original remaining-work baseline",
        "asOfDate": chosen["asOfDate"], "calendarStart": chosen["calendarStart"],
        "openingCash": {"amountUsd": None, "basis": "NOT_ENTERED", "sourceIds": [], "note": ""},
        "packageOverrides": [], "invoiceOverrides": [], "grantReceipts": [], "commercial": [],
        "capacity": {"weeklyHours": None, "note": ""},
        "note": "Native baseline from the selected immutable plan; no actual cash or commercial promise."})
    proposed_doc = client.local_step("example-proposed-document",
        lambda: example_document(client, chosen, example, source_id, people, saved, confirmed=False))
    proposed = save_book(client, "example-proposed-book", proposed_doc)
    confirmed_doc = client.local_step("example-confirmed-document",
        lambda: example_document(client, chosen, example, source_id, people, saved, confirmed=True, previous=proposed))
    book = save_book(client, "example-confirmed-book", confirmed_doc)
    agreement_id = next(row["id"] for row in book["document"]["agreements"] if row["acceptance"]["status"] == "CONFIRMED")
    finance = {**book_reference(book), "forecastId": saved["id"], "agreementIds": [agreement_id],
        "name": "WALKTHROUGH sourced contributor Forecast",
        "note": "Receive the one explicitly fictional confirmed contributor through the original native Forecast."}
    portfolio = {"agreementIds": [agreement_id],
        "resourceMap": [{"engagementId": agreement_id, "resourceId": "example-contributor"}],
        "name": "WALKTHROUGH original contributor allocation",
        "note": "Named example availability and package allocation, calculated by the original Portfolio engine."}
    return book, saved, finance, portfolio


def run_handover(client, book, baseline_value, finance_selection, portfolio_selection):
    finance = client.preview("engagement-forecast-preview", "engagement-forecast", "selection", finance_selection)
    saved = client.command("engagement-forecast-save", "forecast.save",
        {"inputs": finance["inputs"], "expectedPreviewSha256": finance["forecast"]["previewSha256"]},
        expected=finance["forecast"]["source"]["version"])
    forecast = immutable_saved(client.json_step("engagement-forecast-reopen",
        "/api/operations/" + client.case_id + "/forecasts/" + saved["recordId"]))
    complete_hash(forecast, "received native Forecast")
    need(forecast["inputs"] == finance["inputs"] and forecast["report"] == finance["forecast"]["report"],
         "FORECAST_REOPEN", "Retain the complete original native Forecast output.")

    if client.config["mode"] == "WALKTHROUGH":
        seed = client.preview("example-portfolio-seed", "portfolio-seed", "forecastId", forecast["id"])
        def selected():
            inputs = deepcopy(seed["inputs"])
            inputs["resources"] = []
            for task in inputs["tasks"]:
                need(task["id"].startswith("package/"), "EXAMPLE_TASK",
                     "This new walkthrough may only replace its original grant-package example assignments.")
                task["effortHours"] = {}
                task["note"] = "Explicit WALKTHROUGH choice: assign this package to the one example contributor."
            inputs["note"] = "Whole native seed retained, with one clearly selected example staffing choice."
            # Preserve an unfinished exploratory alternative as an actual native result.
            calendar = deepcopy(inputs["calendar"])
            calendar["horizonDays"] = 1
            inputs["alternatives"] = [{"id": "example-short-window", "name": "Example one-day exploratory window",
                "note": "Deliberately narrow example calendar; retain its actual status and findings.", "calendar": calendar}]
            return inputs
        portfolio_selection["inputs"] = client.local_step("example-portfolio-selection", selected)
    portfolio_selection.update(**book_reference(book), forecastId=forecast["id"],
                               agreementIds=finance["selection"]["agreementIds"])
    allocation = client.preview("engagement-portfolio-preview", "engagement-portfolio", "selection", portfolio_selection)
    saved_allocation = client.command("engagement-portfolio-save", "portfolio.save",
        {"inputs": allocation["inputs"], "expectedPreviewSha256": allocation["portfolio"]["previewSha256"]},
        expected=allocation["portfolio"]["source"]["version"])
    portfolio = immutable_saved(client.json_step("engagement-portfolio-reopen",
        "/api/operations/" + client.case_id + "/portfolios/" + saved_allocation["recordId"]))
    complete_hash(portfolio, "received native Portfolio")
    need(portfolio["inputs"] == allocation["inputs"] and portfolio["report"] == allocation["portfolio"]["report"]
         and portfolio["baseForecastSnapshot"] == forecast, "PORTFOLIO_REOPEN",
         "Retain the complete original native allocation, alternatives and baseline.")

    receipt = client.command("engagement-receiving", "engagement.receiving",
        {**book_reference(book), "forecastId": forecast["id"], "portfolioId": portfolio["id"],
         "forecastSelection": finance["selection"], "portfolioSelection": allocation["selection"]})
    review = client.json_step("engagement-receiving-reopen",
        "/api/operations/" + client.case_id + "/reviews/" + receipt["recordId"])
    complete_hash(review, "contributor receiving review")
    value = review["engagementReceiving"]
    alternatives = portfolio["report"]["alternatives"]
    need(review["sha256"] == receipt["reviewSha256"]
         and value["book"] == {"id": book["review"]["id"], "sha256": book["review"]["sha256"]}
         and value["baseForecast"] == {"id": baseline_value["id"], "sha256": baseline_value["sha256"]}
         and value["forecast"] == {"id": forecast["id"], "sha256": forecast["sha256"]}
         and value["portfolio"] == {"id": portfolio["id"], "sha256": portfolio["sha256"]}
         and value["allocationStatus"] == alternatives[0]["status"]
         and value["readyAlternativeIds"] == [row["id"] for row in alternatives if row["status"] == "READY"],
         "RECEIVING_JOIN", "The native receiving must retain each exact original component and actual allocation outcome.")
    return forecast, portfolio, review


def verify_case(client, archive, imported, book, forecast, portfolio, receiving):
    document, files = archive["document"], archive["files"]
    target = imported["id"]
    need(target != client.case_id and imported.get("version") == document["program"]["version"],
         "IMPORT_IDENTITY", "The original importer must return its distinct retained receiving case.")
    expected_selection = {"schema": BOOK_SCHEMA + ".selection", **book_reference(book),
                          "originalProgramId": book["source"]["programId"]}
    need(imported.get("selectedEngagement") == expected_selection
         and parse(files["engagement-selection.json"]) == expected_selection,
         "IMPORT_SELECTION", "The native importer did not retain the original selected engagement edition.")
    observed = client.read("/api/operations/" + target, client.receiving_host)
    need(observed["program"]["origin"]["programId"] == document["program"]["id"]
         and observed["program"]["origin"]["archiveSha256"] == client.state["artifacts"]["download-complete-case"]["sha256"]
         and observed["program"]["mode"] == document["program"]["mode"]
         and observed["program"]["version"] == document["program"]["version"],
         "IMPORT_ORIGIN", "The received case differs from its original exported case identity.")
    need(observed["records"] == document["records"] and observed["sources"] == document["sources"]
         and observed["plan"]["contentSha256"] == document["plan"]["contentSha256"]
         and observed["plan"]["source"] == document["plan"]["source"]
         and observed.get("completionPlans", []) == document.get("completionPlans", [])
         and observed.get("installationRefs", []) == document.get("installationRefs", []),
         "IMPORTED_CASE", "The complete original native case records, sources or original installation selection differ.")
    history, after = [], 0
    while True:
        page = client.read("/api/operations/" + target + "/history?" + urlencode({"after": after, "limit": 200}),
                           client.receiving_host)
        need(page["currentVersion"] == document["program"]["version"], "RECEIVING_CHANGED",
             "The received case changed during full history verification.")
        history.extend(page["events"])
        if page["nextAfter"] is None:
            break
        need(page["nextAfter"] > after, "HISTORY_CURSOR", "The native history did not advance.")
        after = page["nextAfter"]
    need(history == document["events"], "IMPORTED_HISTORY", "The complete original event history differs.")
    summaries = client.read("/api/operations/" + target + "/engagements", client.receiving_host)
    need(any(row["id"] == book["review"]["id"] and row["sha256"] == book["review"]["sha256"]
             for row in summaries["engagements"]) and
         any(row["id"] == receiving["id"] and row["sha256"] == receiving["sha256"]
             for row in summaries["receivings"]), "IMPORTED_REVIEWS", "The full original contributor editions are absent.")
    received_book = client.read("/api/operations/" + target + "/engagements/" + book["review"]["id"],
                                client.receiving_host)
    need(received_book["review"] == book["review"] and received_book["current"]["sourceChanged"] is False
         and received_book["current"]["retainedOriginalProgramId"] == document["program"]["id"],
         "IMPORTED_BOOK", "The received original engagement edition changed.")
    for kind, selected in (("forecasts", forecast), ("portfolios", portfolio), ("reviews", receiving)):
        actual = client.read("/api/operations/" + target + "/" + kind + "/" + selected["id"], client.receiving_host)
        need(immutable_saved(actual) == selected, "IMPORTED_COMPONENT",
             "The received complete original " + kind + " changed.")
    source_rows = []
    for source in document["sources"]:
        output = client.download("received-source-" + source["id"],
            "/api/operations/" + target + "/sources/" + source["id"],
            "received-sources/" + source["id"], client.receiving_host)
        need(output["bytes"] == source["bytes"] and output["sha256"] == source["sha256"],
             "IMPORTED_SOURCE", "A received original source attachment differs.")
        source_rows.append({"id": source["id"], **output})
    # A second complete original export verifies every retained collection,
    # not merely the selected book/Forecast/Portfolio shown above.
    reexport = client.download("received-complete-case",
        "/api/operations/" + target + "/engagements/" + book["review"]["id"] + "/export.zip",
        "received/Contributor_Engagements_Received_Case.zip", client.receiving_host)
    received_archive = read_archive(client.retained(reexport))
    received_document = received_archive["document"]
    need(received_document["program"]["id"] == target
         and received_document["program"]["version"] == document["program"]["version"]
         and received_document["program"]["origin"] == observed["program"]["origin"],
         "RECEIVED_EXPORT_IDENTITY", "The full receiving export no longer identifies the same original import.")
    preserved = set(document) - {"program", "plan", "exportedAt"}
    need(preserved == set(received_document) - {"program", "plan", "exportedAt"}
         and all(received_document[key] == document[key] for key in preserved),
         "RECEIVED_EXPORT_ROWS", "All native records, reviews, saved outputs, installations and events must remain complete.")
    need(parse(received_archive["files"]["engagement-selection.json"]) == expected_selection,
         "RECEIVED_EXPORT_SELECTION", "The complete receiving export lost its selected original engagement.")
    for source in document["sources"]:
        name = "sources/" + source["id"]
        need(received_archive["files"].get(name) == files[name],
             "RECEIVED_EXPORT_SOURCE", "The received complete original source bytes differ.")
    original_plan, original_plan_files = planning_archive(files["planning.zip"])
    received_plan, received_plan_files = planning_archive(received_archive["files"]["planning.zip"])
    need(original_plan["plan"]["id"] == document["program"]["planId"]
         and received_plan["plan"]["id"] == imported["planId"]
         and original_plan["plan"]["source"] == received_plan["plan"]["source"]
         and original_plan["plan"]["originalScenario"] == received_plan["plan"]["originalScenario"]
         and len(original_plan["revisions"]) == len(received_plan["revisions"]),
         "RECEIVED_PLAN_IDENTITY", "The complete original plan and retained revision count differ.")
    for first, second in zip(original_plan["revisions"], received_plan["revisions"]):
        # The native importer creates only its new plan identity/name/time.
        native_keys = set(first) - {"id", "name", "createdAt"}
        need(native_keys == set(second) - {"id", "name", "createdAt"}
             and all(first[key] == second[key] for key in native_keys),
             "RECEIVED_PLAN_REVISION", "An original saved planning revision or complete retained report differs.")
    need(set(original_plan_files) == set(received_plan_files)
         and all(original_plan_files[name] == received_plan_files[name]
                 for name in original_plan_files if name != "workspace.json"),
         "RECEIVED_PLAN_FILES", "The original planning source, calculations or complete native reports differ.")
    # Reentry keeps the first verified native view bytes. Current source identity,
    # version and complete re-export are checked afresh before this point.
    def snapshot(key, filename, value):
        previous = client.state["artifacts"].get(key)
        if previous is not None:
            client.retained(previous)
            return previous
        return client.artifact(key, filename, encoded(value))
    snapshot("received-case-view", "received/native-case.json", observed)
    snapshot("received-history", "received/native-history.json", history)
    snapshot("received-engagements", "received/native-engagements.json", summaries)
    return {"caseId": target, "version": observed["program"]["version"],
            "origin": observed["program"]["origin"], "recordCounts": {k: len(v) for k, v in observed["records"].items()},
            "events": len(history), "sources": source_rows, "completeArchive": reexport,
            "planningRevisions": len(received_plan["revisions"]),
            "completeCollections": sorted(preserved),
            "bookSha256": book["review"]["sha256"], "forecastSha256": forecast["sha256"],
            "portfolioSha256": portfolio["sha256"], "receivingSha256": receiving["sha256"],
            "allocationStatus": receiving["engagementReceiving"]["allocationStatus"],
            "readyAlternativeIds": receiving["engagementReceiving"]["readyAlternativeIds"]}



def bind_agent_execution_continuation(client, reference):
    """Validate a declared execution correction without changing original source."""
    code = "AGENT_EXECUTION_CONTINUATION"
    need(isinstance(reference, dict) and set(reference) == {"path", "bytes", "sha256"},
         code, "Select the complete explicit agent execution continuation file.")
    path, raw = selected_file(reference, maximum=256 * 1024)
    need(reference == {"path": str(path), "bytes": len(raw), "sha256": sha(raw)}
         and descriptor(path, maximum=256 * 1024)["mode"] & 0o077 == 0,
         code, "Retain the exact private execution continuation reference.")
    document = parse(raw)
    need(isinstance(document, dict) and set(document) == {
             "schema", "operationId", "reason", "original", "corrections"}
         and document.get("schema") == "stellar-forge.sf47-engagement-agent-execution-continuation.v1"
         and document.get("operationId") == client.operation
         and isinstance(document.get("reason"), str) and document["reason"].strip()
         and len(document["reason"]) <= 4000,
         code, "Bind the declared correction to this original operation and reason.")
    original, corrections = document.get("original"), document.get("corrections")
    need("agent" in client.config and isinstance(original, dict)
         and set(original) == {"sourceManifest", "agentSourceManifest",
             "nativeSelectionSha256", "agentSelectionSha256", "native", "agentJournal"}
         and original.get("sourceManifest") == client.config["sourceManifest"]
         and original.get("agentSourceManifest") == client.config["agent"]["sourceManifest"]
         and original.get("nativeSelectionSha256") == digest(client.selection)
         and isinstance(original.get("agentSelectionSha256"), str)
         and SHA.fullmatch(original["agentSelectionSha256"])
         and isinstance(corrections, dict) and set(corrections) == {"python", "node"},
         code, "Preserve the complete original source and native selections.")
    rows = {row["path"]: row for row in client.manifest["files"]}
    members = {"python": client.source_prefix + "workspace/operations_engagements_receiving.py",
               "node": client.source_prefix + "workspace/engagement-agent-receiving.mjs"}
    for name, member in members.items():
        correction = corrections[name]
        need(isinstance(correction, dict) and set(correction) == {"prior", "current"}
             and member in rows, code, "Select both complete execution preimages.")
        expected = {"path": str(client.source_root / member),
                    **{key: rows[member][key] for key in ("bytes", "sha256", "mode")}}
        need(correction["prior"] == expected, code,
             "The declared execution preimage differs from the original source.")
        current = correction["current"]
        need(isinstance(current, dict) and set(current) == {"path", "bytes", "sha256", "mode"}
             and isinstance(current.get("mode"), int) and not isinstance(current["mode"], bool)
             and 0 <= current["mode"] <= 0o777, code,
             "Retain the complete current execution file and mode.")
        current_path, _ = selected_file(current, maximum=MAX_SOURCE)
        need(current["path"] == str(current_path)
             and separate(client.source_root, current_path)
             and descriptor(current_path, maximum=MAX_SOURCE)["mode"] == current["mode"],
             code, "Stage the selected correction outside the unchanged source tree.")
        if name == "python":
            need(Path(__file__).absolute() == current_path, code,
                 "Execute the exact Python caller selected by this continuation.")
    need(corrections["python"]["current"]["path"] != corrections["node"]["current"]["path"],
         code, "Select distinct complete Python and Node corrections.")
    native = original.get("native")
    need(isinstance(native, dict) and set(native) == {"outcome", "journal"}, code,
         "Bind the original completed native outcome and frozen journal.")
    native_values = {}
    for name, filename in (("outcome", "ENGAGEMENT_NATIVE_RECEIVING.json"),
                           ("journal", "ENGAGEMENT_AGENT_ORIGINAL_JOURNAL.json")):
        selected_path, body = selected_file(native[name], maximum=16 * 1024 * 1024)
        need(selected_path == client.output / filename, code,
             "Use the original completed native file in this receiving directory.")
        native_values[name] = parse(body)
    need(native_values["journal"].get("schema") == STATE_SCHEMA
         and native_values["journal"].get("state") == "NATIVE_COMPLETE"
         and native_values["journal"].get("selection") == client.selection
         and native_values["outcome"].get("schema") == SCHEMA + ".native"
         and native_values["outcome"].get("operationId") == client.operation,
         code, "Keep the original completed native phase.")
    prior = original.get("agentJournal")
    need(isinstance(prior, dict) and set(prior) == {"path", "bytes", "sha256"}
         and prior.get("path") == str(client.output / "agent" / "JOURNAL.json"),
         code, "Select the original interrupted agent journal.")
    prefix = client.output / "agent" / "execution-continuations" / reference["sha256"]
    retained_prior = prefix / "prior-agent-journal.json"
    prior_reference = {**prior, "path": str(retained_prior)} if retained_prior.exists() else prior
    _, prior_raw = selected_file(prior_reference, maximum=16 * 1024 * 1024)
    predecessor = parse(prior_raw)
    need(predecessor.get("schema") == AGENT_SCHEMA + ".journal"
         and predecessor.get("state") == "INTERRUPTED"
         and predecessor.get("executionContinuation") is None
         and predecessor.get("steps") == {} and predecessor.get("downloads") == {}
         and isinstance(predecessor.get("attempts"), list) and predecessor["attempts"]
         and all(attempt.get("state") == "INTERRUPTED" for attempt in predecessor["attempts"])
         and predecessor.get("selectionSha256") == original["agentSelectionSha256"]
         and sha(encoded(predecessor.get("selection"))) == original["agentSelectionSha256"],
         code, "Continue the exact interrupted connection admission and its saved selection.")
    selection_path = client.output / "agent" / "SELECTION.json"
    _, selection_raw = descriptor(selection_path, maximum=16 * 1024 * 1024, capture=True)
    need(selection_raw == encoded(predecessor["selection"]), code,
         "Keep the original complete Node selection bytes.")
    record = {"reference": deepcopy(reference), "document": document}
    _, current_raw = descriptor(Path(prior["path"]), maximum=16 * 1024 * 1024, capture=True)
    current_journal = parse(current_raw)
    need(current_journal.get("executionContinuation") == record
         or (current_journal.get("executionContinuation") is None and current_raw == prior_raw),
         code, "Resume the same declared execution correction and retained predecessor.")
    retained_selection = prefix / "execution-continuation.json"
    if retained_selection.exists():
        _, retained_raw = descriptor(retained_selection, maximum=256 * 1024, capture=True)
        need(retained_raw == raw, code, "The retained execution correction differs.")
    return {"record": record, "raw": raw, "priorJournal": predecessor}


def retain_agent_execution_continuation(client, outcome, directory):
    """Join the declared correction to the original complete agent selection."""
    selected = client.agent_execution_continuation
    if selected is None:
        need(client.state.get("agentExecutionContinuation") is None,
             "AGENT_EXECUTION_CONTINUATION", "Resume with the retained execution correction.")
        return
    record = selected["record"]
    expected = expected_agent_selection(client, outcome, directory)
    need(selected["priorJournal"]["selection"] == expected
         and record["document"]["original"]["agentSelectionSha256"] == sha(encoded(expected))
         and record["document"]["original"]["native"] == expected["native"],
         "AGENT_EXECUTION_CONTINUATION",
         "Preserve every accepted native request and the original agent selection.")
    previous = client.state.get("agentExecutionContinuation")
    need(previous is None or previous == record, "AGENT_EXECUTION_CONTINUATION",
         "Keep the same explicit execution correction in the original receiving.")
    reference = record["reference"]
    client.artifact("agent-execution-continuation-" + reference["sha256"],
                    "agent-execution-continuations/" + reference["sha256"] + ".json",
                    selected["raw"])
    client.state["agentExecutionContinuation"] = deepcopy(record)
    client.save()


def bind_agent(client):
    """Bind the existing Node runtime and the same complete native source."""
    chosen = client.config["agent"]
    need(isinstance(chosen, dict) and "repositoryRoot" in client.config,
         "AGENT_SELECTION", "Select the existing agent against the complete repository.")
    node = absolute(chosen.get("nodeExecutable"))
    identity = chosen.get("nodeIdentity")
    need(isinstance(identity, dict) and isinstance(identity.get("bytes"), int)
         and not isinstance(identity["bytes"], bool) and identity["bytes"] > 0
         and isinstance(identity.get("sha256"), str) and SHA.fullmatch(identity["sha256"])
         and isinstance(identity.get("mode"), int) and not isinstance(identity["mode"], bool),
         "AGENT_RUNTIME", "Retain the original complete Node executable identity.")
    actual = descriptor(node, maximum=MAX_DELIVERY)
    need(all(actual[key] == identity[key] for key in ("bytes", "sha256", "mode"))
         and actual["mode"] & 0o111, "AGENT_RUNTIME_CHANGED",
         "Use the original selected executable and its complete bytes.")
    need(isinstance(chosen.get("repository"), str) and chosen["repository"].strip()
         and isinstance(chosen.get("revision"), str) and re.fullmatch(r"[a-f0-9]{40}", chosen["revision"])
         and isinstance(chosen.get("workspace"), str) and chosen["workspace"].strip(),
         "AGENT_SOURCE", "Retain the original repository revision and existing workspace alias.")
    _, raw = selected_file(chosen.get("sourceManifest"), maximum=16 * 1024 * 1024)
    manifest = parse(raw)
    need(manifest.get("schema") == AGENT_SOURCE_SCHEMA
         and manifest.get("repository") == chosen["repository"]
         and manifest.get("revision") == chosen["revision"]
         and manifest.get("pathBase") == "repository"
         and manifest.get("productPath") == client.source_prefix.rstrip("/")
         and manifest.get("files") == client.manifest["files"], "AGENT_SOURCE_CHANGED",
         "Use the complete same native repository selection for the agent.")
    script = client.source / "workspace" / "engagement-agent-receiving.mjs"
    need(client.source_prefix + "workspace/engagement-agent-receiving.mjs"
         in {row["path"] for row in manifest["files"]},
         "AGENT_SOURCE_CLOSURE", "Retain the complete original same-case Node companion.")
    provider, _ = selected_file(chosen.get("providerConfiguration"), maximum=16 * 1024 * 1024)
    need(descriptor(provider, maximum=16 * 1024 * 1024)["mode"] & 0o077 == 0,
         "AGENT_PROVIDER", "Use the existing private provider configuration.")
    if client.agent_execution_continuation is not None:
        script = Path(client.agent_execution_continuation["record"]["document"]["corrections"]["node"]["current"]["path"])
    return {"config": deepcopy(chosen), "node": node, "script": script}


def forward_agent(signum):
    """Signal the one Node owner once; its clients and readers finish under it."""
    active = ACTIVE_AGENT
    if active is not None and active["signal"] is None:
        active["signal"] = signum
        try:
            active["process"].send_signal(signum)
        except ProcessLookupError:
            pass
        except BaseException as error:
            active["signalError"] = failure(error)


def freeze_agent_journal(client, outcome):
    """Freeze the first closed native journal before adding agent artifacts."""
    path = client.output / "ENGAGEMENT_AGENT_ORIGINAL_JOURNAL.json"
    if path.exists():
        info, raw = descriptor(path, maximum=16 * 1024 * 1024, capture=True)
    else:
        need(client.state.get("state") == "NATIVE_COMPLETE", "AGENT_NATIVE_PHASE",
             "Complete the original native receiving before opening its agent phase.")
        raw = encoded(client.state)
        info = atomic(path, raw)
    frozen = parse(raw)
    native_row = frozen.get("artifacts", {}).get("native-receiving")
    need(frozen.get("schema") == STATE_SCHEMA and frozen.get("selection") == client.selection
         and frozen.get("state") == "NATIVE_COMPLETE"
         and frozen.get("steps") == client.state["steps"]
         and native_row == client.state["artifacts"].get("native-receiving")
         and parse(client.retained(native_row)) == outcome,
         "AGENT_NATIVE_PHASE_CHANGED", "Keep the first complete original native phase and case outcome.")
    for key, row in frozen.get("artifacts", {}).items():
        need(client.state["artifacts"].get(key) == row, "AGENT_NATIVE_ARTIFACT_CHANGED",
             "Retain every original native artifact before the agent phase.")
        client.retained(row)
    client.artifact("agent-original-journal", path.name, raw)
    return {"path": str(path), "bytes": info["bytes"], "sha256": info["sha256"]}


def record_agent_logs(client, phase):
    for attempt in phase["attempts"]:
        for stream in ("stdout", "stderr"):
            name = relative(attempt[stream])
            path = client.output / name
            if path.exists():
                _, raw = descriptor(path, maximum=MAX_DELIVERY, capture=True, allow_stop=True)
                client.artifact("agent-" + stream + "-" + str(attempt["number"]), name, raw)


def run_agent_child(client, phase, node_input):
    """Keep the original Guard and both complete logs until actual child close."""
    global ACTIVE_AGENT
    client.tick()
    client.guard.assert_owned()
    number = len(phase["attempts"]) + 1
    directory = client.output / "agent-attempts" / ("%04d" % number)
    private_directory(directory)
    input_path = directory / "input.json"
    client.artifact("agent-input-" + str(number), input_path.relative_to(client.output).as_posix(),
                    encoded(node_input))
    attempt = {"number": number, "state": "STARTING", "startedAt": stamp(),
               "input": input_path.relative_to(client.output).as_posix(),
               "stdout": (directory / "stdout.log").relative_to(client.output).as_posix(),
               "stderr": (directory / "stderr.log").relative_to(client.output).as_posix()}
    if client.agent_execution_continuation is not None:
        attempt["agentExecutionContinuation"] = deepcopy(client.agent_execution_continuation["record"]["reference"])
    phase["attempts"].append(attempt)
    phase["state"] = "RUNNING"
    client.save()
    child, stdout_fd, stderr_fd, first_error = None, None, None, None
    active = None
    try:
        stdout_fd = os.open(client.output / attempt["stdout"],
                           os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        stderr_fd = os.open(client.output / attempt["stderr"],
                           os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        client.tick()
        child = subprocess.Popen([str(client.agent["node"]), str(client.agent["script"]),
                                  "run", "--input", str(input_path)],
                                 cwd=client.source_root, stdin=subprocess.DEVNULL,
                                 stdout=stdout_fd, stderr=stderr_fd, close_fds=True,
                                 pass_fds=(client.guard.fd,), start_new_session=True)
        active = {"process": child, "signal": None}
        ACTIVE_AGENT = active
        attempt.update(state="RUNNING", pid=child.pid)
        try:
            client.save()
        except BaseException as error:
            first_error = error
        while child.poll() is None:
            if first_error is None:
                if STOP is not None:
                    first_error = STOP
                elif time.monotonic() >= client.deadline:
                    first_error = ReceivingError("AGENT_DEADLINE",
                        "The same-case agent reached the original receiving deadline.")
            if first_error is not None:
                forwarded = getattr(first_error, "data", {}).get("signal", signal.SIGTERM)
                forward_agent(forwarded)
            try:
                child.wait(timeout=0.25)
            except subprocess.TimeoutExpired:
                pass
        if first_error is None and STOP is not None:
            first_error = STOP
        if first_error is None and child.returncode != 0:
            first_error = ReceivingError("AGENT_PROCESS",
                "The original same-case agent returned an incomplete result.",
                {"returncode": child.returncode, "stdout": attempt["stdout"], "stderr": attempt["stderr"]})
    except BaseException as error:
        if first_error is None:
            first_error = error
    finally:
        # A failure after Popen still belongs to that same child. Retain its
        # owner and shared descriptor while it drains; never kill a nested owner.
        if child is not None:
            if child.poll() is None:
                forward_agent(getattr(first_error, "data", {}).get("signal", signal.SIGTERM))
            while child.poll() is None:
                try:
                    child.wait(timeout=0.25)
                except (subprocess.TimeoutExpired, InterruptedError):
                    pass
            attempt["returncode"] = child.returncode
            attempt["closedAt"] = stamp()
        if ACTIVE_AGENT is active:
            ACTIVE_AGENT = None
        if active is not None and "signalError" in active:
            attempt["signalError"] = active["signalError"]
        for fd in (stdout_fd, stderr_fd):
            if fd is not None:
                try:
                    os.fsync(fd)
                except BaseException as error:
                    if first_error is None:
                        first_error = error
        try:
            cleanup_files(first_error, (stdout_fd, stderr_fd))
        except BaseException as error:
            if first_error is None:
                first_error = error
        attempt["state"] = "CLOSED" if child is not None else "NOT_STARTED"
        if first_error is not None:
            attempt["error"] = failure(first_error)
            phase["state"] = "INCOMPLETE"
        try:
            record_agent_logs(client, phase)
            client.save()
        except BaseException as error:
            if first_error is None:
                first_error = error
            else:
                first_error.receiving_save_error = failure(error)
    if first_error is not None:
        raise first_error
    return child.returncode



def expected_agent_selection(client, outcome, directory):
    """Bind the agent result to the original accepted native requests and source."""
    chosen = client.agent["config"]
    journal_row = client.state["artifacts"]["agent-original-journal"]
    journal = parse(client.retained(journal_row))
    native_row = client.state["artifacts"]["native-receiving"]
    native = {"outcome": {"path": str(client.output / native_row["path"]),
                         "bytes": native_row["bytes"], "sha256": native_row["sha256"]},
              "journal": {"path": str(client.output / journal_row["path"]),
                          "bytes": journal_row["bytes"], "sha256": journal_row["sha256"]}}
    book_key = "example-confirmed-book-reopen" if outcome["mode"] == "WALKTHROUGH" else "actual-book-reopen"
    book_step = journal["steps"].get(book_key)
    need(isinstance(book_step, dict) and book_step.get("state") == "COMPLETE",
         "AGENT_BOOK_READ", "Retain the original selected complete native book read.")
    book = parse(client.retained(book_step["response"]))
    need(digest(book) == book_step.get("resultSha256")
         and book.get("review", {}).get("id") == outcome["book"]["reviewId"]
         and book["review"].get("sha256") == outcome["book"]["reviewSha256"],
         "AGENT_BOOK_READ", "The admitted book must be the original selected native review.")

    def accepted(action, record_id, review_sha):
        matches = []
        for step in journal["steps"].values():
            if step.get("state") != "COMPLETE" or "request" not in step or "resultSha256" not in step:
                continue
            request = parse(client.retained(step["request"]))
            body = request.get("body")
            if not isinstance(body, dict) or body.get("action") != action:
                continue
            response = parse(client.retained(step["response"]))
            if response.get("recordId") != record_id or response.get("reviewSha256") != review_sha:
                continue
            need(request.get("method") == "POST" and request.get("mutation") is True
                 and request.get("path") == "/api/operations/" + outcome["sourceCaseId"] + "/command"
                 and response.get("id") == outcome["sourceCaseId"] and response.get("action") == action
                 and digest(request) == step.get("requestSha256")
                 and digest(response) == step.get("resultSha256"),
                 "AGENT_NATIVE_REQUEST", "Retain the exact accepted original native command and response.")
            matches.append({"action": action, "requestId": body["requestId"],
                            "requestSha256": step["requestSha256"],
                            "requestFile": deepcopy(step["request"]), "responseFile": deepcopy(step["response"]),
                            "resultSha256": step["resultSha256"], "recordId": response["recordId"],
                            "reviewSha256": response["reviewSha256"]})
        need(len(matches) <= 1, "AGENT_NATIVE_REQUEST", "Use the unique accepted original native request.")
        return matches[0] if matches else None

    prepare = accepted("engagement.prepare", outcome["book"]["reviewId"], outcome["book"]["reviewSha256"])
    receiving = accepted("engagement.receiving", outcome["receiving"]["id"], outcome["receiving"]["sha256"])
    need(receiving is not None, "AGENT_NATIVE_REQUEST", "Retain the accepted original contributor receiving.")
    admission = {"mode": "REPLAYED_ACCEPTED_PREPARE" if prepare is not None else "VERIFIED_EXISTING_BOOK",
                 "originalRead": deepcopy(book_step["response"]),
                 **({"requestId": prepare["requestId"]} if prepare is not None else {})}
    return {"schema": AGENT_SCHEMA + ".selection", "operationId": client.operation,
            "repositoryRoot": str(client.source_root), "repository": chosen["repository"],
            "revision": chosen["revision"], "pathBase": "repository",
            "productPath": client.source_prefix.rstrip("/"),
            "sourceManifest": deepcopy(chosen["sourceManifest"]),
            "providerConfiguration": deepcopy(chosen["providerConfiguration"]),
            "workspace": chosen["workspace"], "native": native, "outputDirectory": str(directory),
            "chunkBytes": CHUNK, "parentGuard": {"path": str(client.guard.path),
                "device": str(client.guard.identity[0]), "inode": str(client.guard.identity[1])},
            "caseId": outcome["sourceCaseId"], "caseVersion": outcome["sourceCaseVersion"],
            "mode": outcome["mode"], "book": deepcopy(outcome["book"]),
            "forecast": deepcopy(outcome["forecast"]), "portfolio": deepcopy(outcome["portfolio"]),
            "receiving": deepcopy(outcome["receiving"]), "bookAdmission": admission,
            "requests": ([prepare] if prepare is not None else []) + [receiving]}


def validate_agent_result(client, outcome, directory, selection_sha):
    """Read each complete transport ZIP with the unchanged native validators."""
    result_path = directory / "ENGAGEMENT_AGENT_RESULT.json"
    _, raw = descriptor(result_path, maximum=16 * 1024 * 1024, capture=True)
    result = parse(raw)
    need(result.get("schema") == AGENT_SCHEMA + ".result" and result.get("state") == "COMPLETED"
         and result.get("operationId") == client.operation and result.get("native") == outcome
         and result.get("outputDirectory") == str(directory)
         and result.get("resultFile") == str(result_path)
         and isinstance(result.get("selectionSha256"), str) and SHA.fullmatch(result["selectionSha256"]),
         "AGENT_RESULT", "Retain the closed original same-case agent result.")
    rows, retained, total = {}, {}, 0
    need(isinstance(result.get("files"), list) and 1 <= len(result["files"]) <= 8192,
         "AGENT_FILES", "Retain the complete original agent output inventory.")
    for row in result["files"]:
        name = relative(row.get("path"))
        need(name not in rows and name != result_path.name
             and isinstance(row.get("bytes"), int) and not isinstance(row["bytes"], bool)
             and 0 <= row["bytes"] <= MAX_DELIVERY
             and isinstance(row.get("sha256"), str) and SHA.fullmatch(row["sha256"])
             and isinstance(row.get("mode"), int) and not isinstance(row["mode"], bool)
             and 0 <= row["mode"] <= 0o777 and row["mode"] & 0o077 == 0,
             "AGENT_FILES", "Use each complete private agent output once.")
        total += row["bytes"]
        need(total <= MAX_DELIVERY, "AGENT_SIZE", "The complete retained agent output exceeds 256 MiB.")
        actual, body = descriptor(directory / name, maximum=MAX_DELIVERY, capture=True)
        need(all(actual[key] == row[key] for key in ("bytes", "sha256", "mode")),
             "AGENT_FILE_CHANGED", "A complete original agent output changed.", {"path": name})
        rows[name], retained[name] = row, body
    actual_names, pending = set(), [directory]
    while pending:
        for path in pending.pop().iterdir():
            check()
            mode = path.lstat().st_mode
            if stat.S_ISDIR(mode):
                pending.append(path)
            else:
                need(stat.S_ISREG(mode), "AGENT_FILE_KIND", "Retain only complete regular agent output files.")
                actual_names.add(path.relative_to(directory).as_posix())
    need(actual_names == set(rows) | {result_path.name}, "AGENT_FILE_INVENTORY",
         "The closed result must name every original agent output file.")
    expected_selection = expected_agent_selection(client, outcome, directory)
    need("SELECTION.json" in retained and parse(retained["SELECTION.json"]) == expected_selection
         and retained["SELECTION.json"] == encoded(expected_selection)
         and result["selectionSha256"] == sha(retained["SELECTION.json"]),
         "AGENT_SELECTION_CHANGED",
         "The closed agent result must retain the exact original native, source, provider and workspace selection.")
    chosen = client.agent["config"]
    need(result.get("source") == {"repository": chosen["repository"], "revision": chosen["revision"],
         "pathBase": "repository", "productPath": client.source_prefix.rstrip("/"),
         "manifest": chosen["sourceManifest"], "files": len(client.manifest["files"])},
         "AGENT_SOURCE_RESULT", "The closed agent result must name the same complete original source edition.")
    observed = result.get("observation")
    need(isinstance(observed, dict) and observed.get("path") == "ENGAGEMENT_AGENT_OBSERVATION.json"
         and observed["path"] in rows
         and all(observed.get(key) == rows[observed["path"]][key] for key in ("bytes", "sha256")),
         "AGENT_OBSERVATION", "Retain the complete closed original agent observation.")
    need("JOURNAL.json" in retained, "AGENT_JOURNAL",
         "Retain the original completed agent journal.")
    agent_journal = parse(retained["JOURNAL.json"])
    need(agent_journal.get("schema") == AGENT_SCHEMA + ".journal"
         and agent_journal.get("state") == "COMPLETED"
         and agent_journal.get("selection") == expected_selection
         and agent_journal.get("selectionSha256") == result["selectionSha256"],
         "AGENT_JOURNAL", "The completed agent journal must bind the same original selection.")
    closed = parse(retained[observed["path"]])
    execution = (client.agent_execution_continuation["record"]
                 if client.agent_execution_continuation is not None else None)
    need(all(value.get("executionContinuation") == execution
             for value in (result, agent_journal, closed, closed.get("observation", {}))),
         "AGENT_EXECUTION_RESULT", "Retain the same complete execution correction in every closed agent result.")
    basis_keys = ("schema", "selection", "selectionSha256", "steps", "downloads", "interruptions")
    if execution is not None:
        basis_keys += ("executionContinuation",)
    need(all(key in agent_journal for key in basis_keys)
         and closed.get("schema") == AGENT_SCHEMA + ".closed" and closed.get("state") == "DRAINED"
         and closed.get("operationId") == client.operation
         and closed.get("selectionSha256") == result["selectionSha256"]
         and closed.get("journalBasis") == {key: agent_journal[key] for key in basis_keys},
         "AGENT_CLOSED_PHASE", "Retain the original drained observation and its unchanged journal basis.")
    closed_files = [row for row in result["files"]
                    if row["path"] not in {"JOURNAL.json", observed["path"]}]
    need(closed.get("files") == closed_files
         and isinstance(closed.get("observation"), dict)
         and closed["observation"].get("exports") == result.get("exports")
         and result.get("requests") == expected_selection["requests"]
         and result.get("bookAdmission") == expected_selection["bookAdmission"]
         and result.get("custody") == {
             "managedHost": "BORROWED_ORIGINAL_SERVICE", "providerAndClient": "DRAINED",
             "fileReaders": "DRAINED", "parentGuard": expected_selection["parentGuard"],
             "inheritedDescriptor": "closed-on-return-without-unlock"},
         "AGENT_CLOSED_RESULT", "Keep the complete closed files, original request admission and export bindings.")
    exports = result.get("exports")
    need(isinstance(exports, list) and len(exports) == 2
         and {row.get("transport") for row in exports} == {"SDK", "MCP"},
         "AGENT_EXPORTS", "Retain both complete original agent transport archives.")
    original = read_archive(client.retained(outcome["nativeArchive"]))
    original_plan, original_plan_files = planning_archive(original["files"]["planning.zip"])
    preserved_case = {key: value for key, value in original["document"].items() if key != "exportedAt"}
    preserved_plan = {key: value for key, value in original_plan.items() if key != "exportedAt"}
    checked, paths = [], set()
    for row in exports:
        path = absolute(row.get("path"))
        need(directory in path.parents and path not in paths, "AGENT_EXPORT_PATH",
             "Retain the two distinct complete original transport files.")
        paths.add(path)
        name = relative(path.relative_to(directory).as_posix())
        need(name in rows and all(row.get(key) == rows[name][key] for key in ("bytes", "sha256")),
             "AGENT_EXPORT_CHANGED", "Retain each transport archive's actual complete size and SHA-256.")
        archive = read_archive(retained[name])
        document = archive["document"]
        need({key: value for key, value in document.items() if key != "exportedAt"} == preserved_case,
             "AGENT_CASE_CHANGED", "The agent export must preserve every original native case field.")
        need(set(archive["files"]) == set(original["files"])
             and archive["files"]["engagement-selection.json"] == original["files"]["engagement-selection.json"],
             "AGENT_CASE_MEMBERS", "Retain the full case member set and original selected engagement.")
        for source in original["document"]["sources"]:
            member = "sources/" + source["id"]
            need(archive["files"][member] == original["files"][member], "AGENT_SOURCE_CHANGED",
                 "Retain every original case attachment byte through both transports.")
        plan, plan_files = planning_archive(archive["files"]["planning.zip"])
        need({key: value for key, value in plan.items() if key != "exportedAt"} == preserved_plan
             and set(plan_files) == set(original_plan_files)
             and all(plan_files[name] == original_plan_files[name]
                     for name in plan_files if name != "workspace.json"),
             "AGENT_PLANNING_CHANGED", "The agent transport must preserve the whole original planning export.")
        checked.append({"transport": row["transport"],
                        "path": path.relative_to(client.output).as_posix(),
                        "bytes": row["bytes"], "sha256": row["sha256"],
                        "exportedAt": document.get("exportedAt"), "planningExportedAt": plan.get("exportedAt"),
                        **({"snapshotId": row["snapshotId"]} if "snapshotId" in row else {})})
    for name in sorted(retained):
        client.artifact("agent-file-" + digest(name)[:32],
                        (directory / name).relative_to(client.output).as_posix(), retained[name])
    result_row = client.artifact("agent-result", result_path.relative_to(client.output).as_posix(), raw)
    verified = {"schema": AGENT_SCHEMA + ".verified", "state": "COMPLETED",
                "operationId": client.operation, "selectionSha256": selection_sha,
                "agentSelectionSha256": result["selectionSha256"], "result": result_row,
                "nativeCaseId": outcome["sourceCaseId"], "nativeCaseVersion": outcome["sourceCaseVersion"],
                "exports": checked, "files": len(rows) + 1,
                **({"executionContinuation": deepcopy(execution)} if execution is not None else {})}
    client.artifact("agent-receiving", "ENGAGEMENT_AGENT_RECEIVING.json", encoded(verified))
    return verified


def receive_agent(client, outcome):
    if client.agent is None:
        return None
    client.guard.assert_owned()
    frozen = freeze_agent_journal(client, outcome)
    native_row = client.state["artifacts"]["native-receiving"]
    native = {"path": str(client.output / native_row["path"]),
              "bytes": native_row["bytes"], "sha256": native_row["sha256"]}
    directory = client.output / "agent"
    private_directory(directory)
    selected = {"operationId": client.operation, "repositoryRoot": str(client.source_root),
                "agent": deepcopy(client.agent["config"]), "native": {"outcome": native, "journal": frozen},
                "outputDirectory": str(directory), "parentGuard": {
                    "path": str(client.guard.path), "device": str(client.guard.identity[0]), "inode": str(client.guard.identity[1])}}
    selection_sha = digest(selected)
    retain_agent_execution_continuation(client, outcome, directory)
    client.artifact("agent-selection", "ENGAGEMENT_AGENT_SELECTION.json", encoded(selected))
    phase = client.state.get("agentPhase")
    if phase is None:
        phase = {"state": "PREPARED", "selectionSha256": selection_sha, "attempts": []}
        client.state["agentPhase"] = phase
        client.save()
    need(phase.get("selectionSha256") == selection_sha and isinstance(phase.get("attempts"), list),
         "AGENT_PHASE_CHANGED", "Resume the exact original agent phase and runtime selection.")
    result_path = directory / "ENGAGEMENT_AGENT_RESULT.json"
    if result_path.exists():
        verified = validate_agent_result(client, outcome, directory, selection_sha)
        record_agent_logs(client, phase)
    else:
        need(phase.get("state") != "COMPLETED", "AGENT_RESULT_MISSING",
             "The original completed agent result is unavailable.")
        record_agent_logs(client, phase)
        chosen = client.agent["config"]
        node_input = {"schema": AGENT_SCHEMA, "operationId": client.operation,
                      "repositoryRoot": str(client.source_root),
                      "sourceManifest": deepcopy(chosen["sourceManifest"]),
                      "providerConfiguration": deepcopy(chosen["providerConfiguration"]),
                      "workspace": chosen["workspace"], "native": {"outcome": native, "journal": frozen},
                      "outputDirectory": str(directory),
                      "parentGuard": {**selected["parentGuard"], "fd": client.guard.fd}}
        if client.agent_execution_continuation is not None:
            node_input["agentExecutionContinuation"] = deepcopy(client.agent_execution_continuation["record"]["reference"])
        run_agent_child(client, phase, node_input)
        verified = validate_agent_result(client, outcome, directory, selection_sha)
    phase.update(state="COMPLETED", result=deepcopy(verified))
    client.state["state"] = "NATIVE_COMPLETE"
    client.save()
    return verified


def preserve_source(client):
    for row in client.manifest["files"]:
        copy_exact(client.source_root / row["path"], client.output / "source" / row["path"], row)
    execution_sources = []
    selected = client.agent_execution_continuation
    if selected is not None:
        record = selected["record"]
        for name, filename in (("python", "operations_engagements_receiving.py"),
                               ("node", "engagement-agent-receiving.mjs")):
            current = record["document"]["corrections"][name]["current"]
            destination = ("source/execution-continuations/" +
                           record["reference"]["sha256"] + "/" + filename)
            copy_exact(Path(current["path"]), client.output / destination, current)
            execution_sources.append({"path": destination,
                **{key: current[key] for key in ("bytes", "sha256", "mode")}})
    directories = {client.output, client.output / "source"}
    source_paths = [client.output / "source" / row["path"] for row in client.manifest["files"]]
    source_paths.extend(client.output / row["path"] for row in execution_sources)
    for path in source_paths:
        current = path.parent
        while current != client.output:
            directories.add(current)
            current = current.parent
    for directory in sorted(directories, key=lambda p: (-len(p.parts), str(p))):
        sync_dir(directory)
    sync_dir(client.output.parent)
    return {"files": len(client.manifest["files"]),
            "bytes": sum(row["bytes"] for row in client.manifest["files"]),
            "manifestSha256": client.config["sourceManifest"]["sha256"],
            **({"executionContinuation": {"reference": deepcopy(selected["record"]["reference"]),
                 "files": execution_sources}} if selected is not None else {})}


def publish_delivery(client, outcome):
    """Freeze one closed native phase before publishing its complete private ZIP."""
    client.guard.assert_owned()
    source_receipt = preserve_source(client)
    native_raw = encoded(outcome)
    client.artifact("native-receiving", "ENGAGEMENT_NATIVE_RECEIVING.json", native_raw)

    # The live attempt journal can grow on a later reopen. The delivered journal
    # is the first complete, closed native phase and is never rewritten.
    frozen_path = client.output / "delivery" / "ENGAGEMENT_NATIVE_JOURNAL.json"
    if frozen_path.exists():
        _, frozen_raw = descriptor(frozen_path, maximum=16 * 1024 * 1024, capture=True)
        frozen = parse(frozen_raw)
        need(frozen.get("schema") == STATE_SCHEMA and frozen.get("selection") == client.selection
             and frozen.get("state") == "NATIVE_COMPLETE"
             and frozen.get("steps") == client.state["steps"]
             and frozen.get("artifacts") == client.state["artifacts"],
             "DELIVERY_PHASE_CHANGED", "Retain the original complete native phase and every original response.")
    else:
        need(client.state["state"] == "NATIVE_COMPLETE", "DELIVERY_PHASE",
             "Close the whole native receiving phase before freezing its delivery.")
        frozen = deepcopy(client.state)
        frozen_raw = encoded(frozen)
        atomic(frozen_path, frozen_raw)

    members = {}
    for row in frozen["artifacts"].values():
        name = relative(row["path"])
        members[name] = {"path": name, "bytes": row["bytes"], "sha256": row["sha256"], "mode": 0o600}
    for row in client.manifest["files"]:
        name = "source/" + row["path"]
        members[name] = {"path": name, "bytes": row["bytes"], "sha256": row["sha256"], "mode": row["mode"]}
    for row in source_receipt.get("executionContinuation", {}).get("files", []):
        need(row["path"] not in members, "EXECUTION_SOURCE_COLLISION",
             "Keep the declared execution source separate from the original source selection.")
        members[row["path"]] = deepcopy(row)
    for name in ("receiving-input.json", "SOURCE_SELECTION.json", "RECEIVING_SELECTION.json",
                 "delivery/ENGAGEMENT_NATIVE_JOURNAL.json"):
        info = descriptor(client.output / name)
        members[name] = {"path": name, **info}
    need(sum(row["bytes"] for row in members.values()) <= MAX_DELIVERY, "DELIVERY_SIZE",
         "The complete private delivery exceeds its retained 256 MiB bound.")
    manifest = {"schema": SCHEMA + ".delivery", "operationId": client.operation,
                "selectionSha256": digest(client.selection), "source": source_receipt,
                "nativeCaseId": client.case_id, "receivedCaseId": outcome["received"]["caseId"],
                "nativeReceivingSha256": sha(native_raw), "journalSha256": sha(frozen_raw),
                "files": [members[name] for name in sorted(members)]}
    manifest_raw = encoded(manifest)
    # Exact-byte create-only reuse also finishes an earlier failed directory sync.
    atomic(client.output / "DELIVERY_MANIFEST.json", manifest_raw)
    for name, row in members.items():
        actual = descriptor(client.output / name)
        need(all(actual[key] == row[key] for key in ("bytes", "sha256", "mode")),
             "DELIVERY_MEMBER_CHANGED", "Keep every complete frozen delivery member and original source mode.",
             {"path": name})
    directories = {client.output, client.output / "delivery"}
    for name in members:
        parent = (client.output / name).parent
        while parent != client.output:
            directories.add(parent)
            parent = parent.parent
    for directory in sorted(directories, key=lambda path: (-len(path.parts), str(path))):
        sync_dir(directory)
    sync_dir(client.output.parent)
    target = client.output / "Contributor_Engagements_Complete_Receiving.zip"

    def verify(path):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as original:
            before = os.fstat(original.fileno())
            need(stat.S_ISREG(before.st_mode) and before.st_size <= MAX_DELIVERY,
                 "DELIVERY_KIND", "Retain the complete original regular delivery ZIP.")
            with zipfile.ZipFile(original) as archive:
                need(len(archive.namelist()) == len(members) + 1 and
                     set(archive.namelist()) == set(members) | {"DELIVERY_MANIFEST.json"}
                     and archive.read("DELIVERY_MANIFEST.json") == manifest_raw,
                     "DELIVERY_CHANGED", "Keep the complete original receiving manifest and member set.")
                for name, row in members.items():
                    member = archive.getinfo(name)
                    need(stat.S_ISREG(member.external_attr >> 16)
                         and stat.S_IMODE(member.external_attr >> 16) == row["mode"],
                         "DELIVERY_MODE", "Retain the exact original source and private artifact modes.")
                    with archive.open(name) as stream:
                        count, hashed = 0, hashlib.sha256()
                        while True:
                            client.tick()
                            block = stream.read(CHUNK)
                            if not block:
                                break
                            count += len(block)
                            need(count <= row["bytes"], "DELIVERY_CHANGED", "A complete ZIP member grew.")
                            hashed.update(block)
                    need(count == row["bytes"] and hashed.hexdigest() == row["sha256"],
                         "DELIVERY_CHANGED", "A complete private receiving member differs.")
            need(stat_identity(before) == stat_identity(os.fstat(original.fileno())) == stat_identity(path.lstat()),
                 "DELIVERY_CHANGED", "The complete original delivery changed during its readback.")

    if not target.exists():
        fd, temporary, original_error = None, None, None
        try:
            fd, temporary_name = tempfile.mkstemp(prefix=".engagement-delivery-", dir=client.output)
            temporary = Path(temporary_name)
            os.fchmod(fd, 0o600)
            owned, fd = fd, None
            os.close(owned)
            with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                info = zipfile.ZipInfo("DELIVERY_MANIFEST.json", (2026, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, manifest_raw)
                for name, row in sorted(members.items()):
                    client.tick()
                    path = client.output / name
                    source_fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                    try:
                        before = os.fstat(source_fd)
                        need(stat.S_ISREG(before.st_mode) and stat.S_IMODE(before.st_mode) == row["mode"],
                             "DELIVERY_SOURCE_CHANGED", "A retained source kind or mode changed.")
                        info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
                        info.create_system = 3
                        info.external_attr = (stat.S_IFREG | row["mode"]) << 16
                        info.compress_type = zipfile.ZIP_STORED if name.endswith((".zip", ".png", ".pdf")) else zipfile.ZIP_DEFLATED
                        count, hashed = 0, hashlib.sha256()
                        with archive.open(info, "w") as output:
                            while True:
                                client.tick()
                                block = os.read(source_fd, CHUNK)
                                if not block:
                                    break
                                count += len(block)
                                need(count <= row["bytes"], "DELIVERY_SOURCE_CHANGED", "A retained source grew.")
                                output.write(block)
                                hashed.update(block)
                        need(count == row["bytes"] and hashed.hexdigest() == row["sha256"]
                             and stat_identity(before) == stat_identity(os.fstat(source_fd)) == stat_identity(path.lstat()),
                             "DELIVERY_SOURCE_CHANGED", "A closed complete receiving source changed during packaging.")
                    finally:
                        os.close(source_fd)
            verify(temporary)
            fd = os.open(temporary, os.O_RDONLY | os.O_NOFOLLOW)
            os.fsync(fd)
            owned, fd = fd, None
            os.close(owned)
            client.guard.assert_owned()
            try:
                os.link(temporary, target, follow_symlinks=False)
            except FileExistsError:
                verify(target)
            temporary.unlink()
            sync_dir(client.output)
        except BaseException as error:
            original_error = error
            raise
        finally:
            cleanup_files(original_error, (fd,), temporary)
    verify(target)
    sync_dir(client.output)
    info = descriptor(target)
    return {"path": str(target), "bytes": info["bytes"], "sha256": info["sha256"],
            "manifestSha256": sha(manifest_raw), "journalSha256": sha(frozen_raw), "members": len(members) + 1}

def receive(config, *, host_url=None, receiving_url=None, agent_execution_continuation=None):
    client = Receiving(config, host_url=host_url, receiving_url=receiving_url,
                       agent_execution_continuation=agent_execution_continuation)
    original_error = None
    result = None
    try:
        completed_path = client.output / "ENGAGEMENT_NATIVE_RESULT.json"
        if completed_path.exists():
            _, raw = descriptor(completed_path, capture=True)
            value = parse(raw)
            need(value.get("state") == "COMPLETED" and value.get("selectionSha256") == digest(client.selection),
                 "COMPLETION_SELECTION", "Keep the original complete receiving result.")
            expected_execution = (client.agent_execution_continuation["record"]
                                  if client.agent_execution_continuation is not None else None)
            need(value.get("agent", {}).get("executionContinuation") == expected_execution,
                 "COMPLETION_EXECUTION", "Reopen the same completed agent execution correction.")
            for row in client.state["artifacts"].values():
                client.retained(row)
            saved = value["delivery"]
            info = descriptor(saved["path"])
            need(info["bytes"] == saved["bytes"] and info["sha256"] == saved["sha256"],
                 "DELIVERY_CHANGED", "The original complete delivery changed.")
            client.state["state"] = "COMPLETED"
            client.state["attempts"][-1].update(state="REOPENED_COMPLETE", completedAt=stamp())
            client.save()
            return value

        closed_native = client.state["artifacts"].get("native-receiving")
        if closed_native is not None:
            outcome = parse(client.retained(closed_native))
            need(outcome.get("schema") == SCHEMA + ".native"
                 and outcome.get("operationId") == client.operation and outcome.get("mode") == config["mode"],
                 "NATIVE_PHASE_CHANGED", "Retain the original complete closed native receiving outcome.")
            marker = client.state.get("nativeComplete")
            need(marker is None or marker == {"artifact": closed_native,
                 "selectionSha256": digest(client.selection)}, "NATIVE_PHASE_CHANGED",
                 "Keep the original closed native phase and selected source.")
            client.case_id, client.case_version = outcome["sourceCaseId"], outcome["sourceCaseVersion"]
            for row in client.state["artifacts"].values():
                client.retained(row)
        else:
            book, base, finance_selection, portfolio_selection = select_books(client)
            forecast, portfolio, receiving = run_handover(client, book, base, finance_selection, portfolio_selection)
            selected = client.download("complete-case",
                "/api/operations/" + client.case_id + "/engagements/" + book["review"]["id"] + "/export.zip",
                "native/Contributor_Engagements_Case.zip")
            archive = read_archive(client.retained(selected))
            need(archive["document"]["program"]["id"] == client.case_id and
                 archive["document"]["program"]["version"] == client.case_version,
                 "CASE_EXPORT_CHANGED", "The original case changed before its complete selected export.")
            client.artifact("native-case-manifest", "native/MANIFEST.json", archive["manifestRaw"])
            client.artifact("native-engagement-html", "native/engagement.html", archive["files"]["engagement.html"])
            client.artifact("native-engagement-selection", "native/engagement-selection.json",
                            archive["files"]["engagement-selection.json"])
            imported = client.import_case(selected, config["importedCaseName"])
            verified = verify_case(client, archive, imported, book, forecast, portfolio, receiving)
            source_after = client.read("/api/operations/" + client.case_id)
            need(source_after["program"]["version"] == client.case_version
                 and source_after["records"] == archive["document"]["records"],
                 "ORIGINAL_CASE_CHANGED", "Receiving must preserve the selected original source case.")
            outcome = {"schema": SCHEMA + ".native", "operationId": client.operation,
                "mode": config["mode"], "sourceCaseId": client.case_id,
                "sourceCaseVersion": client.case_version, "book": book_reference(book),
                "forecast": {"id": forecast["id"], "sha256": forecast["sha256"]},
                "portfolio": {"id": portfolio["id"], "sha256": portfolio["sha256"]},
                "receiving": {"id": receiving["id"], "sha256": receiving["sha256"]},
                "nativeArchive": selected, "received": verified}
            closed_native = client.artifact("native-receiving", "ENGAGEMENT_NATIVE_RECEIVING.json", encoded(outcome))
        client.state["nativeComplete"] = {"artifact": closed_native,
                                         "selectionSha256": digest(client.selection)}
        client.state["state"] = "NATIVE_COMPLETE"
        client.save()
        agent = receive_agent(client, outcome)
        delivery = publish_delivery(client, outcome)
        result = {"schema": SCHEMA + ".result", "state": "COMPLETED",
                  "operationId": client.operation, "selectionSha256": digest(client.selection),
                  "native": outcome, **({"agent": agent} if agent is not None else {}),
                  "delivery": delivery, "completedAt": stamp()}
        atomic(completed_path, encoded(result))
        client.state["state"] = "COMPLETED"
        client.state["attempts"][-1].update(state="COMPLETED", completedAt=stamp())
        client.save()
        return result
    except BaseException as error:
        original_error = error
        try:
            client.state["state"] = "INTERRUPTED"
            client.state["attempts"][-1].update(state="INTERRUPTED", stoppedAt=stamp(), error=failure(error))
            client.save()
        except BaseException as save_error:
            error.receiving_save_error = failure(save_error)
        raise
    finally:
        try:
            client.close()
        except BaseException:
            if original_error is None:
                raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Original private complete receiving JSON.")
    parser.add_argument("--host-url", help="Current loopback placement of the same original host/key/workspace.")
    parser.add_argument("--receiving-url", help="Current placement of the separately selected receiving host.")
    args = parser.parse_args(argv)
    previous = {value: signal.signal(value, stopped) for value in (signal.SIGINT, signal.SIGTERM)}
    try:
        _, raw = descriptor(absolute(args.input), maximum=16 * 1024 * 1024, capture=True)
        result = receive(parse(raw), host_url=args.host_url, receiving_url=args.receiving_url)
        sys.stdout.write(canonical(result) + "\n")
        sys.stdout.flush()
        return 0
    except BaseException as error:
        try:
            sys.stderr.write(canonical({"state": "INTERRUPTED", "error": failure(error),
                **({"receivingSaveError": error.receiving_save_error} if hasattr(error, "receiving_save_error") else {})}) + "\n")
            sys.stderr.flush()
        except BaseException:
            pass
        return 130 if STOP is not None else 1
    finally:
        for value, handler in previous.items():
            signal.signal(value, handler)


if __name__ == "__main__":
    raise SystemExit(main())
