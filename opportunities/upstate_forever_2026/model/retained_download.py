"""Restartable receiving for original local-operator file tickets.

The destination is published only after the complete retained checksum matches.
Partial bytes and their durable prefix checkpoint stay private beside it. There
is no second server, retry loop, scientific task, or credential in saved state.
"""
from __future__ import annotations

import contextlib
from datetime import datetime, timezone
from dataclasses import dataclass, field
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import time
import urllib.parse
from typing import Callable, Mapping

from . import portable_fs as _fs

SCHEMA = "upstate.retained-download/v1"
COHORT_SCHEMA = "upstate.retained-download-cohort/v1"
BLOCK = 1024 * 1024
CHECKPOINT_BYTES = 8 * BLOCK
Progress = Callable[[dict], None]


def canonical_https_origin(value: str) -> str:
    """Admit one explicitly trusted DNS origin on normal HTTPS port 443."""
    if (not isinstance(value, str) or not value or len(value) > 261
            or any(ord(c) <= 32 or ord(c) >= 127 for c in value)):
        raise ValueError("Choose the exact canonical HTTPS recipient origin.")
    parsed = urllib.parse.urlsplit(value)
    host = parsed.hostname or ""
    label = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    if (parsed.scheme != "https" or parsed.username is not None
            or parsed.password is not None or parsed.path or parsed.query
            or parsed.fragment or parsed.port is not None or len(host) > 253
            or not re.fullmatch(label + r"(?:\." + label + r")+", host)
            or value != "https://" + host):
        raise ValueError("Use one canonical https://host origin on port 443, without a path or credential.")
    return value


@dataclass(frozen=True)
class OperatorTransport:
    """One credential is bound to exactly one admitted original transport.

    Remote credentials belong to the recipient boundary, never to the native
    operator. This class neither follows redirects nor reads proxy settings.
    """
    origin: str
    credential: str = field(repr=False)
    credential_kind: str
    trusted_origin: str | None = None

    def __post_init__(self):
        if (not isinstance(self.credential, str) or not self.credential
                or "\r" in self.credential or "\n" in self.credential):
            raise ValueError("Select the original private transport credential.")
        if self.credential_kind == "local-operator":
            parsed = urllib.parse.urlsplit(self.origin)
            if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1"
                    or type(parsed.port) is not int or not 1 <= parsed.port <= 65535
                    or self.origin != "http://127.0.0.1:" + str(parsed.port)
                    or self.trusted_origin is not None):
                raise ValueError("Select the original loopback operator.")
        elif self.credential_kind == "recipient":
            selected = canonical_https_origin(self.origin)
            if selected != canonical_https_origin(self.trusted_origin):
                raise ValueError("The recipient origin differs from the explicitly trusted origin.")
            if (len(self.credential) > 4096
                    or any(ord(c) <= 32 or ord(c) >= 127 for c in self.credential)):
                raise ValueError("Use the separately issued recipient credential.")
        else:
            raise ValueError("Choose the original local or explicit recipient credential type.")

    @classmethod
    def loopback(cls, port: int, token: str):
        if type(port) is not int or not 1 <= port <= 65535:
            raise ValueError("Select the existing loopback operator port.")
        return cls("http://127.0.0.1:" + str(port), token, "local-operator")

    @classmethod
    def recipient(cls, origin: str, token: str, trusted_origin: str):
        return cls(origin, token, "recipient", trusted_origin)

    @property
    def port(self):
        return 443 if self.credential_kind == "recipient" else urllib.parse.urlsplit(self.origin).port

    def connection(self, *, timeout=60):
        # HTTPSConnection's ordinary default context verifies certificate and
        # hostname. No custom trust roots, unverified context or redirect handler.
        if self.credential_kind == "recipient":
            return http.client.HTTPSConnection(
                urllib.parse.urlsplit(self.origin).hostname, 443, timeout=timeout)
        return http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)

    def headers(self):
        result = {"Authorization": "Bearer " + self.credential}
        if self.credential_kind == "recipient":
            result["Origin"] = self.origin
            result["User-Agent"] = "TJLabs-Workbench-Recipient/1.0"
        return result


def _transport(port, token, selected):
    if selected is None:
        return OperatorTransport.loopback(port, token)
    if (not isinstance(selected, OperatorTransport)
            or selected.port != port or selected.credential != token):
        raise ValueError("Keep the selected original transport and credential together.")
    return selected


def descriptor(ticket: Mapping) -> dict:
    """Select only the original immutable body identity and relative API route."""
    if (not isinstance(ticket, Mapping)
            or not isinstance(ticket.get("url"), str)
            or not re.fullmatch(r"/api/file/[0-9a-f]{64}", ticket["url"])
            or not isinstance(ticket.get("sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", ticket["sha256"])
            or type(ticket.get("bytes")) is not int or ticket["bytes"] < 0):
        raise ValueError("Select an exact original retained-file ticket")
    return {key: ticket[key] for key in ("url", "bytes", "sha256")}


def _open(path: Path, flags: int, mode: str):
    if _fs.native_path(path).is_symlink():
        raise ValueError("A receiving member was replaced by a symbolic link: " + path.name)
    fd = _fs.open_file(path, flags | getattr(os, "O_BINARY", 0), 0o600)
    try:
        if not stat.S_ISREG(_fs.fd_stat(fd).st_mode):
            raise ValueError("A receiving member is not a regular file: " + path.name)
        return os.fdopen(fd, mode)
    except BaseException:
        os.close(fd)
        raise


def _sync_directory(path: Path):
    _fs.sync_directory(path)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def read_json(path: Path):
    with _open(path, os.O_RDONLY, "rb") as source:
        return json.load(source)


def atomic_json(path: Path, value, *, immutable=False):
    body = canonical(value) + b"\n"
    _fs.native_path(path.parent).mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".write-", dir=_fs.native_path(path.parent))
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        if immutable:
            try:
                _fs.publish_file(temporary, path)
            except FileExistsError:
                with _open(path, os.O_RDONLY, "rb") as source:
                    if source.read() != body:
                        raise ValueError("The immutable receiving plan differs")
        else:
            _fs.replace(temporary, path)
        _sync_directory(path.parent)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


@contextlib.contextmanager
def held(path: Path, *, blocking=True):
    # Use the same lock and handle ownership as the native application. Old
    # Windows one-byte locks overlap this whole-file lock during upgrades.
    with _fs.locked(path, blocking=blocking):
        yield


def _matches(path: Path, selected: dict) -> bool:
    """Verify an existing final file without following a replaced symlink."""
    try:
        with _open(path, os.O_RDONLY, "rb") as source:
            before = _fs.fd_stat(source.fileno())
            if before.st_size != selected["bytes"]:
                return False
            h = hashlib.sha256()
            for block in iter(lambda: source.read(BLOCK), b""):
                h.update(block)
            after = _fs.fd_stat(source.fileno())
            signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
            return (h.hexdigest() == selected["sha256"]
                    and signature(before) == signature(after))
    except FileNotFoundError:
        return False


def _checkpoint(path: Path, binding: dict, count: int, h) -> dict:
    value = {**binding, "committed_bytes": count,
             "prefix_sha256": h.hexdigest(), "updated_at": now()}
    atomic_json(path, value)
    return value


def download(port: int, token: str, ticket: Mapping, destination,
             *, progress: Progress | None = None,
             transport: OperatorTransport | None = None) -> dict:
    """Receive or resume one file from the same authenticated loopback operator.

    Re-invoke with the current original ticket after an interruption. A new port,
    session capability, or ticket path can receive the same checksum-bound body.
    The receiver performs no redirects and no automatic task/action retries.
    """
    selected = descriptor(ticket)
    selected_transport = _transport(port, token, transport)
    destination = Path(destination).absolute()
    _fs.native_path(destination.parent).mkdir(parents=True, exist_ok=True)
    destination = _fs.native_path(destination.parent).resolve(strict=True) / destination.name
    name_key = hashlib.sha256(destination.name.encode("utf-8")).hexdigest()[:24]
    bank = destination.parent / (".upstate-download-" + name_key)
    lock = destination.parent / (".upstate-download-" + name_key + ".lock")
    binding = {"schema": SCHEMA, "filename": destination.name,
               "bytes": selected["bytes"], "sha256": selected["sha256"]}
    started = time.monotonic()
    report = progress or (lambda value: None)
    with held(lock, blocking=False):
        if destination.exists() or destination.is_symlink():
            if not _matches(destination, selected):
                raise FileExistsError("The existing receiving file differs from the selected original download")
            result = {"path": str(destination), "bytes": selected["bytes"],
                      "sha256": selected["sha256"], "reused": True,
                      "resumed_bytes": 0, "received_bytes": 0,
                      "elapsed_seconds": time.monotonic() - started}
            report({"state": "complete", **result})
            return result
        try:
            bank.mkdir(mode=0o700)
            _sync_directory(destination.parent)
        except FileExistsError:
            if bank.is_symlink() or not bank.is_dir():
                raise ValueError("The receiving checkpoint directory was replaced")
        checkpoint, partial = bank / "checkpoint.json", bank / "body.part"
        h = hashlib.sha256()
        if checkpoint.exists() or checkpoint.is_symlink():
            with _open(checkpoint, os.O_RDONLY, "rb") as source:
                raw = source.read(16 * 1024 + 1)
            if len(raw) > 16 * 1024:
                raise ValueError("The receiving checkpoint exceeds its schema")
            saved = json.loads(raw)
            if not isinstance(saved, dict) or any(saved.get(k) != v for k, v in binding.items()):
                raise ValueError("The retained receiving checkpoint belongs to another original file")
            count = saved.get("committed_bytes")
            if (type(count) is not int or not 0 <= count <= selected["bytes"]
                    or not isinstance(saved.get("prefix_sha256"), str)
                    or not re.fullmatch(r"[0-9a-f]{64}", saved["prefix_sha256"])):
                raise ValueError("The retained receiving checkpoint is invalid")
        else:
            if partial.exists() or partial.is_symlink():
                raise ValueError("Retained receiving bytes have no original checkpoint; preserve them for inspection")
            count = 0
            saved = _checkpoint(checkpoint, binding, count, h)
        flags = os.O_RDWR | (os.O_CREAT if count == 0 else 0)
        with _open(partial, flags, "r+b") as output:
            if _fs.fd_stat(output.fileno()).st_size < count:
                raise ValueError("The retained receiving prefix is shorter than its durable checkpoint")
            remaining = count
            while remaining:
                block = output.read(min(BLOCK, remaining))
                if not block:
                    raise ValueError("The retained receiving prefix ended early")
                h.update(block)
                remaining -= len(block)
            if h.hexdigest() != saved["prefix_sha256"]:
                raise ValueError("The retained receiving prefix changed; its bytes have been preserved")
            # Bytes beyond the durable checkpoint came from this receiver's
            # interrupted write. Only that uncommitted private tail is removed.
            output.truncate(count)
            output.seek(count)
            resumed, committed = count, count
            report({"state": "resuming" if count else "starting",
                    "path": str(destination), "bytes": selected["bytes"],
                    "committed_bytes": count, "resumed_bytes": resumed})
            connection = None
            try:
                if count < selected["bytes"] or selected["bytes"] == 0:
                    headers = {**selected_transport.headers(),
                               "Accept-Encoding": "identity"}
                    if count:
                        headers.update({"Range": f"bytes={count}-",
                                        "If-Range": '"' + selected["sha256"] + '"'})
                    connection = selected_transport.connection(timeout=60)
                    connection.request("GET", selected["url"] + "?download=1", headers=headers)
                    response = connection.getresponse()
                    expected_status = 206 if count else 200
                    valid = (response.status == expected_status
                             and response.getheader("Content-Length") == str(selected["bytes"] - count)
                             and response.getheader("ETag") == '"' + selected["sha256"] + '"'
                             and response.getheader("Content-Encoding", "identity") == "identity"
                             and response.getheader("Transfer-Encoding") is None)
                    if count:
                        valid = valid and response.getheader("Content-Range") == (
                            f"bytes {count}-{selected['bytes'] - 1}/{selected['bytes']}")
                    else:
                        valid = valid and response.getheader("Content-Range") is None
                    if not valid:
                        raise ValueError(f"Original download headers differ (HTTP {response.status}); retained prefix preserved")
                    while count < selected["bytes"]:
                        block = response.read(min(BLOCK, selected["bytes"] - count))
                        if not block:
                            raise EOFError("The original download ended early; resume this same receiving file")
                        output.write(block)
                        h.update(block)
                        count += len(block)
                        if count - committed >= CHECKPOINT_BYTES or count == selected["bytes"]:
                            output.flush()
                            os.fsync(output.fileno())
                            _checkpoint(checkpoint, binding, count, h)
                            committed = count
                            elapsed = max(time.monotonic() - started, 1e-9)
                            report({"state": "receiving", "path": str(destination),
                                    "bytes": selected["bytes"], "committed_bytes": count,
                                    "resumed_bytes": resumed, "received_bytes": count - resumed,
                                    "bytes_per_second": (count - resumed) / elapsed})
                    if response.read(1):
                        raise ValueError("The original download exceeded its descriptor")
            finally:
                if connection is not None:
                    connection.close()
                if count != committed:
                    output.flush()
                    os.fsync(output.fileno())
                    _checkpoint(checkpoint, binding, count, h)
                # For empty files and a checkpoint recovered at full length.
                output.flush()
                os.fsync(output.fileno())
            if count != selected["bytes"] or h.hexdigest() != selected["sha256"]:
                raise ValueError("The complete original download differs; receiving bytes preserved")
        if not _matches(partial, selected):
            raise ValueError("The complete receiving file changed before publication")
        try:
            _fs.publish_file(partial, destination)
        except FileExistsError:
            if not _matches(destination, selected):
                raise FileExistsError("A different output appeared during the original download")
        _sync_directory(destination.parent)
        partial.unlink()
        checkpoint.unlink()
        bank.rmdir()
        _sync_directory(destination.parent)
        result = {"path": str(destination), "bytes": count, "sha256": selected["sha256"],
                  "reused": False, "resumed_bytes": resumed, "received_bytes": count - resumed,
                  "elapsed_seconds": time.monotonic() - started}
        report({"state": "complete", **result})
        return result


def receive_cohort(port: int, token: str, tickets: list, directory,
                   *, source: dict | None = None, progress: Progress | None = None,
                   transport: OperatorTransport | None = None) -> dict:
    """Receive every selected ticket with an immutable plan and restart progress.

    Exact repeated ticket identities share one member. Numbered native filenames
    prevent collisions while the plan preserves every original label and ticket.
    All URLs in the saved plan are relative; no capability or connection is saved.
    """
    selected_transport = _transport(port, token, transport)
    if not isinstance(tickets, list) or not tickets:
        raise ValueError("Select a nonempty complete download cohort")
    directory = _fs.native_path(Path(directory).absolute())
    _fs.native_path(directory).mkdir(parents=True, exist_ok=True)
    if directory.is_symlink():
        raise ValueError("Select an ordinary receiving directory")
    directory = directory.resolve(strict=True)
    rows, indexed = [], {}
    for ticket in tickets:
        selected = descriptor(ticket)
        filename = ticket.get("filename", "retained-file")
        if (not isinstance(filename, str) or not filename or filename in (".", "..")
                or any(c in filename for c in ("/", "\\", "\x00", "\r", "\n"))
                or len(filename.encode("utf-8")) > 220):
            raise ValueError("A cohort member needs its original plain filename")
        key = tuple(selected[k] for k in ("url", "bytes", "sha256"))
        alias = {"filename": filename, "label": str(ticket.get("label", filename))}
        if key in indexed:
            indexed[key]["originals"].append(alias)
        else:
            row = {**selected, "path": f"{len(rows) + 1:04d}__{filename}", "originals": [alias]}
            rows.append(row)
            indexed[key] = row
    # Only non-secret original task/workspace identifiers are admitted here.
    source = {} if source is None else source
    if (not isinstance(source, dict) or set(source) - {"task", "workspace"}
            or any(not isinstance(v, str) or not re.fullmatch(r"[0-9a-f]{64}", v)
                   for v in source.values())):
        raise ValueError("Use only original task/workspace identifiers in the cohort source")
    plan = {"schema": COHORT_SCHEMA, "source": source, "members": rows,
            "selected_ticket_count": len(tickets), "total_bytes": sum(row["bytes"] for row in rows)}
    with held(directory / ".receiving-cohort.lock", blocking=False):
        plan_path, status_path = directory / "COHORT.json", directory / "RECEIVING.json"
        if plan_path.is_symlink() or status_path.is_symlink():
            raise ValueError("A saved cohort record was replaced by a link")
        if plan_path.exists():
            if read_json(plan_path) != plan:
                raise ValueError("This receiving directory already belongs to another complete cohort")
        else:
            atomic_json(plan_path, plan, immutable=True)
        results = []
        status = {"schema": COHORT_SCHEMA, "plan_sha256": hashlib.sha256(canonical(plan)).hexdigest(),
                  "state": "receiving", "members": results, "total_bytes": plan["total_bytes"]}
        def save():
            atomic_json(status_path, {**status, "updated_at": now()})
        save()
        for index, row in enumerate(rows, 1):
            def report(value):
                status["current"] = {"member": index, "of": len(rows), "filename": row["path"],
                                     **{k: v for k, v in value.items() if k != "path"}}
                save()
                if progress:
                    progress(status["current"])
            try:
                value = download(port, token, row, directory / row["path"], progress=report,
                                 transport=selected_transport)
                results.append({**value, "path": row["path"]})
                save()
            except BaseException as error:
                status.update(state="interrupted", interrupted_member=index,
                              error_type=type(error).__name__)
                save()
                raise
        status.pop("current", None)
        status.update(state="complete", completed_members=len(results))
        save()
        return {**status, "directory": str(directory), "plan": str(plan_path),
                "status": str(status_path)}
