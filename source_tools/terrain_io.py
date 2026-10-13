"""Durable, resumable public terrain sources and portable packet primitives.

This module does not contact customer systems. It retains the original public
HTTP entity; partial entities are never admitted as scientific raster inputs.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Iterator

BLOCK = 1024 * 1024
SCHEMA = "upstate.terrain-http/v1"
HEADERS = ("ETag", "Last-Modified", "Content-Length", "Content-Type",
           "Content-Range", "Accept-Ranges", "Content-Encoding", "Date")


class TerrainError(ValueError):
    """A terrain operation cannot safely use the supplied source or selection."""


class SourceChanged(TerrainError):
    """A mutable publisher object changed during the selected source edition."""


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def canonical(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
                       allow_nan=False) + "\n").encode("utf-8")


def identity(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def file_sha(path: Path | str) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(BLOCK), b""):
            h.update(block)
    return h.hexdigest()


def sync_directory(path: Path) -> None:
    if os.name != "nt":
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def atomic_bytes(path: Path | str, data: bytes, *, immutable: bool = False) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if immutable and path.exists():
        if path.read_bytes() != data:
            raise TerrainError(f"Existing immutable record differs: {path.name}")
        return
    fd, name = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    pending = Path(name)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        if immutable:
            # link is create-only, including when another process won the race.
            try:
                os.link(pending, path)
            except FileExistsError:
                if path.read_bytes() != data:
                    raise TerrainError(f"Concurrent immutable record differs: {path.name}")
        else:
            os.replace(pending, path)
        sync_directory(path.parent)
    finally:
        pending.unlink(missing_ok=True)


def atomic_json(path: Path | str, value: Any, *, immutable: bool = False) -> None:
    atomic_bytes(path, canonical(value), immutable=immutable)


def read_json(path: Path | str) -> dict[str, Any]:
    value = json.loads(Path(path).read_text("utf-8"))
    if not isinstance(value, dict):
        raise TerrainError("Expected a JSON object")
    return value


def relative_path(root: Path | str, name: str, *, exists: bool = True) -> Path:
    root = Path(root).resolve()
    pure = PurePosixPath(name)
    if (not name or pure.is_absolute() or ".." in pure.parts or "\\" in name
            or "\0" in name or pure.as_posix() != name or ":" in pure.parts[0]):
        raise TerrainError("Expected a portable relative terrain member path")
    path = root.joinpath(*pure.parts)
    if not path.resolve(strict=exists).is_relative_to(root):
        raise TerrainError("Terrain member escapes its selected packet")
    if path.is_symlink():
        raise TerrainError("Terrain packet members must be regular files")
    return path


def describe(root: Path | str, path: Path | str) -> dict[str, Any]:
    root, path = Path(root).resolve(), Path(path).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise TerrainError("File must be inside its terrain packet")
    return {"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size,
            "sha256": file_sha(path)}


def verify(root: Path | str, record: dict[str, Any]) -> Path:
    path = relative_path(root, record["path"])
    if (not path.is_file() or path.stat().st_size != record["bytes"]
            or file_sha(path) != record["sha256"]):
        raise TerrainError("Retained terrain member changed: " + record["path"])
    return path


def copy_original(source: Path | str, target: Path | str) -> dict[str, Any]:
    source, target = Path(source).resolve(strict=True), Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    expected = file_sha(source)
    if target.exists():
        if file_sha(target) != expected or target.stat().st_size != source.stat().st_size:
            raise TerrainError("Destination contains a different original source")
    else:
        fd, name = tempfile.mkstemp(prefix=".terrain-copy-", dir=target.parent)
        pending = Path(name)
        try:
            with source.open("rb") as inp, os.fdopen(fd, "wb") as out:
                shutil.copyfileobj(inp, out, BLOCK)
                out.flush()
                os.fsync(out.fileno())
            if file_sha(pending) != expected:
                raise SourceChanged("Source changed while it was being retained")
            try:
                os.link(pending, target)
            except FileExistsError:
                if file_sha(target) != expected:
                    raise TerrainError("Concurrent source retention differs")
            sync_directory(target.parent)
        finally:
            pending.unlink(missing_ok=True)
    return {"bytes": target.stat().st_size, "sha256": expected}


@contextmanager
def locked(path: Path | str) -> Iterator[None]:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        if os.name == "nt":
            import msvcrt
            stream.seek(0)
            if stream.read(1) == b"":
                stream.write(b"\0")
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def public_usgs_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    host = (parsed.hostname or "").lower()
    approved = (host.endswith(".usgs.gov") or host == "usgs.gov"
                or host.endswith(".nationalmap.gov") or host == "nationalmap.gov"
                or host == "prd-tnm.s3.amazonaws.com")
    if (parsed.scheme != "https" or not approved or parsed.username or parsed.password
            or parsed.fragment or parsed.port not in (None, 443)):
        raise TerrainError("Terrain acquisition expects an original public USGS HTTPS URL")
    for key, _ in urllib.parse.parse_qsl(parsed.query):
        if any(word in key.lower() for word in ("token", "signature", "credential", "secret", "key")):
            raise TerrainError("Credential-bearing links are not terrain source identifiers")
    return url


class _PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_usgs_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _validator(headers: dict[str, str]) -> str | None:
    etag = headers.get("ETag")
    if etag and not etag.startswith("W/"):
        return etag
    return headers.get("Last-Modified")


def capture(url: str, destination: Path | str, *, maximum_bytes: int | None = None,
            timeout: float = 90, opener=None) -> dict[str, Any]:
    """Receive one original HTTP entity, with validator-bound prefix recovery.

    `opener` is a dependency injection point for an existing provider transport or
    protocol tests. URL validation remains active. A changed source requires a new
    source edition; this operation will not silently combine different editions.
    """
    public_usgs_url(url)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    receipt = destination.with_name(destination.name + ".http.json")
    partial = destination.with_name(destination.name + ".partial")
    opener = opener or urllib.request.build_opener(_PublicRedirect()).open
    with locked(destination.with_name(destination.name + ".lock")):
        state = read_json(receipt) if receipt.exists() else {}
        if state and (state.get("schema") != SCHEMA or state.get("url") != url):
            raise TerrainError("Source location is already assigned to a different request")
        if state.get("state") in ("received", "complete"):
            actual = destination if destination.exists() else partial
            if (not actual.is_file() or actual.stat().st_size != state["bytes"]
                    or file_sha(actual) != state["sha256"]):
                raise TerrainError("Completed original HTTP entity differs")
            if actual == partial:
                os.replace(partial, destination)
                sync_directory(destination.parent)
            if state["state"] != "complete":
                state.update(state="complete", completed_at=now())
                atomic_json(receipt, state)
            return state
        if destination.exists():
            raise TerrainError("A body exists without its complete source record")
        offset = 0
        h = hashlib.sha256()
        prior_headers = state.get("headers", {})
        validator = _validator(prior_headers)
        if partial.exists() and validator:
            offset = int(state.get("received_bytes", 0))
            if offset > partial.stat().st_size:
                raise TerrainError("Received terrain prefix is shorter than its journal")
            with partial.open("r+b") as stream:
                stream.truncate(offset)
                for block in iter(lambda: stream.read(BLOCK), b""):
                    h.update(block)
            if offset and h.hexdigest() != state.get("prefix_sha256"):
                raise TerrainError("Received terrain prefix differs from its checkpoint")
        elif partial.exists():
            partial.unlink()
        # Recover a crash after the complete body was fsynced but before final
        # receipt publication. The prefix hash and original declared entity size
        # establish completion without an invalid bytes=total- range request.
        if offset and state.get("expected_bytes") == offset:
            state.update(state="received", bytes=offset, sha256=h.hexdigest(), updated_at=now())
            atomic_json(receipt, state)
            os.replace(partial, destination)
            sync_directory(destination.parent)
            state.update(state="complete", completed_at=now())
            atomic_json(receipt, state)
            return state
        headers = {"User-Agent": "Upper-Savannah-Terrain/1.0", "Accept-Encoding": "identity"}
        if offset:
            headers.update(Range=f"bytes={offset}-", **{"If-Range": validator})
        request = urllib.request.Request(url, headers=headers)
        previous = {key: state[key] for key in ("state", "attempt", "received_bytes", "error", "updated_at")
                    if key in state}
        state = {**state, "schema": SCHEMA, "url": url, "state": "receiving",
                 "attempt": int(state.get("attempt", 0)) + 1, "updated_at": now(),
                 "received_bytes": offset, "resumed_from": offset,
                 "previous_attempt": previous or None}
        atomic_json(receipt, state)
        try:
            with opener(request, timeout=timeout) as response:
                public_usgs_url(response.geturl())
                status = response.status
                observed = {name: response.headers[name] for name in HEADERS if name in response.headers}
                if response.headers.get("Content-Encoding", "identity").lower() not in ("identity", ""):
                    raise TerrainError("Terrain sources must be transferred without content encoding")
                if offset and _validator(observed) != validator:
                    raise SourceChanged("Publisher elevation object changed during receiving")
                if status not in (200, 206):
                    raise TerrainError(f"Unexpected original-source HTTP status {status}")
                expected_total = None
                expected_response = None
                if status == 206:
                    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", observed.get("Content-Range", ""))
                    if not match:
                        raise TerrainError("Missing exact Content-Range for terrain resume")
                    start, end, total = map(int, match.groups())
                    if start != offset or end < start or end != total - 1:
                        raise TerrainError("Terrain response is not the exact requested suffix")
                    expected_total, expected_response = total, end-start+1
                else:
                    # A server may ignore Range while keeping the selected validator.
                    offset = 0
                    h = hashlib.sha256()
                    if "Content-Length" in observed:
                        expected_total = expected_response = int(observed["Content-Length"])
                if expected_total is not None:
                    if expected_total <= 0 or (maximum_bytes is not None and expected_total > maximum_bytes):
                        raise TerrainError("Original terrain source exceeds the declared intake")
                    if shutil.disk_usage(destination.parent).free < expected_total-offset + 64*BLOCK:
                        raise OSError("Insufficient disk space for the selected original terrain source")
                if "Content-Length" in observed and expected_response is not None:
                    if int(observed["Content-Length"]) != expected_response:
                        raise TerrainError("Terrain HTTP length and range disagree")
                state.update(status=status, headers=observed, final_url=response.geturl(),
                             expected_bytes=expected_total, received_bytes=offset,
                             prefix_sha256=h.hexdigest())
                atomic_json(receipt, state)
                with partial.open("ab" if offset else "wb") as out:
                    current, checkpoint = offset, offset
                    try:
                        for block in iter(lambda: response.read(BLOCK), b""):
                            current += len(block)
                            if ((maximum_bytes is not None and current > maximum_bytes)
                                    or (expected_total is not None and current > expected_total)):
                                raise TerrainError("Terrain body exceeds its declared complete size")
                            out.write(block)
                            h.update(block)
                            if current-checkpoint >= 8*BLOCK:
                                out.flush()
                                os.fsync(out.fileno())
                                state.update(received_bytes=current, prefix_sha256=h.hexdigest(), updated_at=now())
                                atomic_json(receipt, state)
                                checkpoint = current
                    finally:
                        out.flush()
                        os.fsync(out.fileno())
                        # out.tell is the committed prefix, not an rejected oversized block.
                        state.update(received_bytes=out.tell(), prefix_sha256=h.hexdigest(), updated_at=now())
                        atomic_json(receipt, state)
                if expected_total is not None and current != expected_total:
                    raise TerrainError("Original terrain entity ended before its declared length")
                if current == 0:
                    raise TerrainError("Publisher returned an empty original terrain entity")
                state.update(state="received", bytes=current, sha256=h.hexdigest(), updated_at=now())
                atomic_json(receipt, state)
            os.replace(partial, destination)
            sync_directory(destination.parent)
            state.update(state="complete", completed_at=now())
            atomic_json(receipt, state)
            return state
        except BaseException as error:
            if state.get("state") not in ("received", "complete"):
                state.update(state="source_changed" if isinstance(error, SourceChanged) else "interrupted",
                             error=type(error).__name__ + ": " + str(error), updated_at=now())
                atomic_json(receipt, state)
            raise


def publish_directory(staging: Path, destination: Path) -> None:
    """Atomically publish a new tree without replacing a concurrent destination."""
    import errno
    import sys
    if sys.platform.startswith("linux"):
        import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
        rename = getattr(libc, "renameat2", None)
        if rename is not None:
            rename.argtypes = [ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
            rename.restype = ctypes.c_int
            result = rename(-100,os.fsencode(staging),-100,os.fsencode(destination),1)
            if result == 0:
                sync_directory(destination.parent)
                return
            error = ctypes.get_errno()
            if error not in (errno.ENOSYS, errno.EINVAL):
                raise OSError(error,os.strerror(error),str(destination))
    # Windows rename is create-only. Other POSIX systems serialize cooperating
    # receivers and verify the destination under that lock before one rename.
    with locked(destination.parent/("."+destination.name+".receive.lock")):
        if destination.exists():
            raise FileExistsError("Terrain receiving directory already exists")
        os.rename(staging,destination)
        sync_directory(destination.parent)
