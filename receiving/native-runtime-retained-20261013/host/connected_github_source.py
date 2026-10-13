#!/usr/bin/env python3
"""Materialize exact GitHub source bytes in a cloud working copy."""
from __future__ import annotations

import argparse
import base64
import binascii
import errno
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile

CHUNK = 64 * 1024


class SourceImportError(ValueError):
    def __init__(self, code: str, detail: str, path: str | None = None):
        self.code, self.detail, self.path = code, detail, path
        super().__init__(detail)


class SourceImportIOError(OSError):
    """Keep source context without exposing a raw operating-system exception."""

    def __init__(self, cause: OSError, *, operation: str, path: str | None,
                 completed_files: list[dict]):
        super().__init__(cause.errno, cause.strerror)
        self.cause_type = type(cause).__name__
        self.operation = operation
        self.source_path = path
        self.completed_files = list(completed_files)


def _io_error_result(exc: OSError, *, operation: str, path: str | None,
                     completed_files: list[dict]) -> dict:
    # errno-derived text is safe to return; str(exc) may contain private paths.
    reason = os.strerror(exc.errno) if exc.errno is not None else "Operating-system I/O failure"
    result = {"ok": False, "error": "SOURCE_IMPORT_IO", "errno": exc.errno,
              "errno_name": errno.errorcode.get(exc.errno),
              "error_type": getattr(exc, "cause_type", type(exc).__name__),
              "operation": operation, "completed_files": completed_files,
              "detail": reason + ": import did not complete; rerun the same export after recovery."}
    if path is not None:
        result["path"] = path
    return result


def blob_sha(data: bytes) -> str:
    digest = hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0")
    digest.update(data)
    return digest.hexdigest()


def _open_regular_file(path: Path, *, encoding: str | None = None):
    """Reject special inputs before reading, including a FIFO swapped at open."""
    if not stat.S_ISREG(path.stat().st_mode):
        raise OSError(errno.EINVAL, os.strerror(errno.EINVAL))
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise OSError(errno.EINVAL, os.strerror(errno.EINVAL))
        if encoding is None:
            return os.fdopen(descriptor, "rb")
        return os.fdopen(descriptor, "r", encoding=encoding)
    except BaseException:
        os.close(descriptor)
        raise


def _file_payload(response: object, *, fallback_sha=None, fallback_encoding=None) -> dict:
    """Read native fetch_file/fetch_blob and GET-contents tool envelopes."""
    pending = [response]
    for _ in range(32):
        if not pending:
            break
        value = pending.pop(0)
        if not isinstance(value, dict):
            continue
        if value.get("isError") is True:
            raise SourceImportError("SOURCE_TOOL_ERROR", "The source tool reported an error.")
        if isinstance(value.get("sha"), str) and isinstance(value.get("encoding"), str):
            return value
        # Native fetch_blob returns only the decoded content. Its request SHA
        # and explicit text encoding must accompany that otherwise bare result.
        if (isinstance(value.get("content"), str)
                and not any(isinstance(value.get(key), dict) for key in ("structuredContent", "result", "data"))
                and isinstance(fallback_sha, str) and isinstance(fallback_encoding, str)):
            return {**value, "sha": fallback_sha, "encoding": fallback_encoding}
        for key in ("structuredContent", "result", "data"):
            if isinstance(value.get(key), dict):
                pending.append(value[key])
        content = value.get("content")
        texts = [content] if isinstance(content, str) else []
        if isinstance(content, list):
            texts.extend(block["text"] for block in content
                         if isinstance(block, dict) and block.get("type") == "text"
                         and isinstance(block.get("text"), str))
        for text in texts:
            try:
                decoded = json.loads(text)
            except (ValueError, RecursionError):
                continue
            if isinstance(decoded, dict):
                pending.append(decoded)
    raise SourceImportError("SOURCE_RESPONSE_SHAPE", "No encoded GitHub file/blob was found in the response.")


def _source_spec(entry: object) -> dict:
    if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
        raise SourceImportError("SOURCE_ENTRY_SHAPE", "Each file needs a repository path and a source.")
    name = entry["path"]
    pieces = name.split("/")
    if (not name or name.startswith("/") or "\\" in name or "\0" in name
            or any(part in ("", ".", "..") for part in pieces)
            or ":" in pieces[0]):
        raise SourceImportError("SOURCE_PATH", "Use a relative repository path without traversal.", name)
    mode = entry.get("mode")
    if mode is not None and mode not in ("100644", "100755"):
        raise SourceImportError("SOURCE_MODE", "File mode must be 100644 or 100755 when supplied.", name)
    source_file = entry.get("source_file")
    if "source_file" in entry:
        if not isinstance(source_file, str) or not source_file or "\0" in source_file:
            raise SourceImportError("SOURCE_ENTRY_SHAPE", "source_file must name a local file.", name)
        if "response" in entry or "encoding" in entry:
            raise SourceImportError("SOURCE_ENTRY_SHAPE", "Use either response or raw source_file bytes, not both.", name)
        payload = {}
        expected = entry.get("blob_sha")
    else:
        payload = _file_payload(entry.get("response"), fallback_sha=entry.get("blob_sha"),
                                fallback_encoding=entry.get("encoding"))
        expected = payload["sha"]
    if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", expected):
        raise SourceImportError("SOURCE_SHA", "The source needs a complete Git blob SHA.", name)
    if "blob_sha" in entry and (not isinstance(entry["blob_sha"], str)
            or entry["blob_sha"].lower() != expected.lower()):
        raise SourceImportError("SOURCE_SHA_MISMATCH", "The response differs from the supplied request blob SHA.", name)
    if source_file is None:
        if not isinstance(payload.get("content"), str):
            raise SourceImportError("SOURCE_CONTENT", "The response has no file content string.", name)
        if payload.get("path") is not None and payload["path"] != name:
            raise SourceImportError("SOURCE_PATH_MISMATCH", "The returned path differs from the requested file.", name)
    return {"path": name, "mode": mode, "blob_sha": expected.lower(),
            "source_file": source_file, "payload": payload,
            "source_url": payload.get("display_url") or payload.get("html_url") or payload.get("url")}


def _source_chunks(spec: dict):
    """Decode at most one small block; the caller owns the resulting snapshot."""
    name, source_file, payload = spec["path"], spec["source_file"], spec["payload"]
    if source_file is not None:
        try:
            with _open_regular_file(Path(source_file).expanduser()) as stream:
                # Read the observed file length plus one byte. A growing source
                # cannot keep this operation alive or exhaust its staging disk.
                remaining = os.fstat(stream.fileno()).st_size
                while remaining:
                    chunk = stream.read(min(CHUNK, remaining))
                    if not chunk:
                        raise SourceImportError("SOURCE_BLOB_MISMATCH", "Source file changed during reading.", name)
                    remaining -= len(chunk)
                    yield chunk
                if stream.read(1):
                    raise SourceImportError("SOURCE_BLOB_MISMATCH", "Source file changed during reading.", name)
        except OSError as exc:
            raise SourceImportIOError(exc, operation="read_source_file", path=name,
                                      completed_files=[]) from exc
        return
    content, encoding = payload["content"], payload["encoding"].lower()
    try:
        if encoding in ("utf-8", "utf8"):
            for offset in range(0, len(content), CHUNK // 4):
                yield content[offset:offset + CHUNK // 4].encode("utf-8")
        elif encoding == "base64":
            carry, finished = "", False
            for offset in range(0, len(content), CHUNK):
                block = "".join(content[offset:offset + CHUNK].split())
                if finished and block:
                    raise binascii.Error("Excess data after padding")
                carry += block
                width = len(carry) // 4 * 4
                if width:
                    block, carry = carry[:width], carry[width:]
                    decoded = base64.b64decode(block, validate=True)
                    if "=" in block:
                        finished = True
                        if carry:
                            raise binascii.Error("Excess data after padding")
                    yield decoded
            if carry:
                yield base64.b64decode(carry, validate=True)
        else:
            raise SourceImportError("SOURCE_ENCODING", "Request full UTF-8 or base64 content.", name)
    except (UnicodeError, binascii.Error, ValueError) as exc:
        if isinstance(exc, SourceImportError):
            raise
        raise SourceImportError("SOURCE_ENCODING", "The encoded file content is invalid.", name) from None


def _validate_source(spec: dict, actual: str, size: int) -> None:
    if actual != spec["blob_sha"]:
        raise SourceImportError("SOURCE_BLOB_MISMATCH", "Content does not match its Git blob; fetch the complete file/blob again.", spec["path"])
    payload = spec["payload"]
    if "size" in payload and (type(payload["size"]) is not int or payload["size"] != size):
        raise SourceImportError("SOURCE_SIZE_MISMATCH", "Content does not match the returned byte count.", spec["path"])


def _source(entry: object) -> dict:
    """Keep the existing single-blob byte API for captured-source consumers."""
    spec = _source_spec(entry)
    with io.BytesIO() as output:
        for chunk in _source_chunks(spec):
            output.write(chunk)
        data = output.getvalue()
    _validate_source(spec, blob_sha(data), len(data))
    return {key: spec[key] for key in ("path", "blob_sha", "mode", "source_url")} | {"data": data}


def _spool_chunks(spool, offset: int, size: int):
    spool.seek(offset)
    remaining = size
    while remaining:
        chunk = spool.read(min(CHUNK, remaining))
        if not chunk:
            raise OSError(errno.EIO, os.strerror(errno.EIO))
        remaining -= len(chunk)
        yield chunk


def _stage_source(entry: object, spool) -> dict:
    spec = _source_spec(entry)
    operation = "write_source_snapshot"
    try:
        offset, size = spool.seek(0, os.SEEK_END), 0
        for chunk in _source_chunks(spec):
            spool.write(chunk)
            size += len(chunk)
        operation = "verify_source_snapshot"
        digest = hashlib.sha1(b"blob " + str(size).encode("ascii") + b"\0")
        for chunk in _spool_chunks(spool, offset, size):
            digest.update(chunk)
        _validate_source(spec, digest.hexdigest(), size)
    except SourceImportIOError:
        raise
    except OSError as exc:
        raise SourceImportIOError(exc, operation=operation, path=spec["path"],
                                  completed_files=[]) from exc
    return {key: spec[key] for key in ("path", "blob_sha", "mode", "source_url")} | {"offset": offset, "bytes": size}


def _same_spooled_file(path: Path, item: dict, spool) -> bool:
    with _open_regular_file(path) as stream:
        for chunk in _spool_chunks(spool, item["offset"], item["bytes"]):
            if stream.read(len(chunk)) != chunk:
                return False
        return not stream.read(1)


def _same_spooled_items(left: dict, right: dict, spool) -> bool:
    if left["bytes"] != right["bytes"]:
        return False
    for offset in range(0, left["bytes"], CHUNK):
        size = min(CHUNK, left["bytes"] - offset)
        spool.seek(left["offset"] + offset)
        first = spool.read(size)
        spool.seek(right["offset"] + offset)
        if len(first) != size or first != spool.read(size):
            return False
    return True


def _same_file_bytes(path: Path, data: bytes) -> bool:
    offset = 0
    with path.open("rb") as stream:
        while offset < len(data):
            chunk = stream.read(min(64 * 1024, len(data) - offset))
            if not chunk or chunk != data[offset:offset + len(chunk)]:
                return False
            offset += len(chunk)
        return not stream.read(1)


def _destination(root: Path, item: dict, spool=None) -> Path:
    destination = root.joinpath(*PurePosixPath(item["path"]).parts)
    current = root
    for part in PurePosixPath(item["path"]).parts[:-1]:
        current = current / part
        if current.is_symlink() or (current.exists() and not current.is_dir()):
            raise SourceImportError("DESTINATION_CONFLICT", "A parent path is not an ordinary directory.", item["path"])
    if destination.is_symlink():
        raise SourceImportError("DESTINATION_CONFLICT", "An existing symlink is preserved.", item["path"])
    if destination.exists():
        size = item["bytes"] if spool is not None else len(item["data"])
        if (not destination.is_file() or destination.stat().st_size != size
                or not (_same_spooled_file(destination, item, spool) if spool is not None
                        else _same_file_bytes(destination, item["data"]))):
            raise SourceImportError("DESTINATION_CONFLICT", "An existing destination differs and is preserved.", item["path"])
        if item["mode"] is not None and stat.S_IMODE(destination.stat().st_mode) != int(item["mode"][-3:], 8):
            raise SourceImportError("DESTINATION_CONFLICT", "Existing file permissions differ and are preserved.", item["path"])
    return destination


def _resolve_output(output_directory: str | Path) -> Path:
    try:
        root = Path(output_directory).expanduser().resolve()
        try:
            # Python 3.13 resolve(strict=False) can retain a cyclic link. stat
            # distinguishes that cycle from an ordinary missing destination.
            root.stat()
        except FileNotFoundError:
            pass
        return root
    except RuntimeError as exc:
        raise OSError(errno.ELOOP, os.strerror(errno.ELOOP)) from exc


def materialization_options(value=None) -> dict:
    """Bind an explicit immutable-source choice to the original source request."""
    if value is None:
        return {}
    if not isinstance(value, dict) or set(value) - {"immutable_links", "link_fallback", "link_anchors"}:
        raise SourceImportError("SOURCE_LINK_MODE", "Use immutable_links, link_fallback and link_anchors.")
    immutable = value.get("immutable_links", False)
    fallback = value.get("link_fallback", "copy")
    anchors = value.get("link_anchors", [])
    if type(immutable) is not bool or fallback not in ("copy", "symlink"):
        raise SourceImportError("SOURCE_LINK_MODE", "Select immutable_links and a copy or symlink fallback.")
    if not isinstance(anchors, (list, tuple)) or any(not isinstance(p, str) or not p or "\0" in p for p in anchors):
        raise SourceImportError("SOURCE_LINK_ANCHOR", "Supply existing immutable link-anchor directories.")
    if not immutable:
        if fallback != "copy" or anchors:
            raise SourceImportError("SOURCE_LINK_MODE", "Link options require immutable_links.")
        return {}
    return {"immutable_links": True, "link_fallback": fallback, "link_anchors": list(dict.fromkeys(anchors))}


def materialization_arguments(parser):
    parser.add_argument("--immutable-links", action="store_true",
                        help="reuse immutable source inodes; edits must replace files, never write through links")
    parser.add_argument("--link-fallback", choices=("copy", "symlink"), default="copy",
                        help="cross-device source handling in immutable mode")
    parser.add_argument("--link-anchor", action="append", default=[],
                        help="existing immutable directory for shorter cross-device references; repeatable")


def materialization_from_args(args) -> dict:
    return materialization_options({"immutable_links": args.immutable_links,
                                    "link_fallback": args.link_fallback, "link_anchors": args.link_anchor})


def _links_module():
    if __name__ == "__main__":
        # Keep CLI errors in this module's established exception hierarchy.
        sys.modules["connected_github_source"] = sys.modules[__name__]
    if __package__:
        from . import connected_github_source_links
    else:
        import connected_github_source_links
    return connected_github_source_links


def inspect_source(entry) -> dict:
    """Verify a supplied blob in bounded chunks without retaining its full body."""
    spec = _source_spec(entry)
    observed = _links_module()._describe(spec)
    return {key: spec[key] for key in ("path", "blob_sha", "mode", "source_url")} | {
        "bytes": observed["bytes"], **({"source_file": observed["source_file"]}
                                     if "source_file" in observed else {})}


def inspect_materialized(manifest, output_directory, *, allow_references=False) -> dict:
    """Read back the selected paths and exact blobs without materializing again."""
    return _links_module().inspect_materialized(manifest, output_directory,
                                                allow_references=allow_references)


def materialize(manifest: object, output_directory: str | Path, *, staging_directory=None,
                immutable_links=False, link_fallback="copy", link_anchors=()) -> dict:
    """Validate all source bytes before writing; never replace existing files."""
    if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), list) or not manifest["files"]:
        raise SourceImportError("SOURCE_MANIFEST", "Input must contain a nonempty files array.")
    return materialize_entries(iter(manifest["files"]), output_directory,
                               staging_directory=staging_directory, immutable_links=immutable_links,
                               link_fallback=link_fallback, link_anchors=link_anchors)


def materialize_entries(entries, output_directory: str | Path, *, staging_directory=None,
                        immutable_links=False, link_fallback="copy", link_anchors=()) -> dict:
    """Import an entry iterator using one anonymous, seekable disk snapshot.

    All entries are verified before any destination source is published. The
    snapshot closes on success/error and the OS releases it after process death.
    Only file metadata and the caller's current encoded input remain in memory.
    Immutable mode validates and aliases exact local sources without this spool.
    """
    options = materialization_options({"immutable_links": immutable_links,
                                       "link_fallback": link_fallback, "link_anchors": link_anchors})
    if options:
        options.pop("immutable_links")
        return _links_module().materialize_entries(entries, output_directory, **options)
    try:
        if staging_directory is None:
            # Place the snapshot with the destination, rather than accidentally
            # consuming a RAM-backed TMPDIR on an already memory-pressed host.
            parent = _resolve_output(output_directory).parent
            while not parent.exists():
                parent = parent.parent
        else:
            parent = Path(staging_directory).expanduser()
    except (OSError, RuntimeError) as exc:
        if isinstance(exc, RuntimeError):
            exc = OSError(errno.ELOOP, os.strerror(errno.ELOOP))
        raise SourceImportIOError(exc, operation="inspect_destination", path=None,
                                  completed_files=[]) from exc
    try:
        spool = tempfile.TemporaryFile(mode="w+b", prefix=".github-source-import-", dir=parent)
    except OSError as exc:
        raise SourceImportIOError(exc, operation="create_source_snapshot", path=None,
                                  completed_files=[]) from exc
    with spool:
        files = {}
        for entry in entries:
            item = _stage_source(entry, spool)
            previous = files.get(item["path"])
            if previous is not None:
                try:
                    same = previous["mode"] == item["mode"] and _same_spooled_items(previous, item, spool)
                    if not same:
                        raise SourceImportError("SOURCE_DUPLICATE_CONFLICT", "Two source entries disagree for the same path.", item["path"])
                    # Duplicate input adds neither a result nor another copy.
                    spool.truncate(item["offset"])
                except OSError as exc:
                    raise SourceImportIOError(exc, operation="compare_source_snapshot", path=item["path"],
                                              completed_files=[]) from exc
                continue
            files[item["path"]] = item
        if not files:
            raise SourceImportError("SOURCE_MANIFEST", "Input must contain a nonempty files array.")
        for name in files:
            if any(str(parent) in files for parent in PurePosixPath(name).parents if str(parent) != "."):
                raise SourceImportError("SOURCE_PATH_CONFLICT", "A source file is also another file's parent directory.", name)
        return _publish_sources(files, output_directory, spool)


def _publish_sources(files: dict, output_directory: str | Path, spool) -> dict:
    source_path = None
    try:
        root = _resolve_output(output_directory)
        if root.exists() and not root.is_dir():
            raise SourceImportError("DESTINATION_CONFLICT", "Output must be a directory.")
        for item in files.values():
            source_path = item["path"]
            _destination(root, item, spool)
    except OSError as exc:
        raise SourceImportIOError(exc, operation="inspect_destination", path=source_path,
                                  completed_files=[]) from exc
    results = []
    for item in files.values():
        operation = "inspect_destination"
        try:
            destination = _destination(root, item, spool)
            outcome = "unchanged"
            if not destination.exists():
                operation = "create_parent"
                destination.parent.mkdir(parents=True, exist_ok=True)
                operation = "inspect_destination"
                _destination(root, item, spool)
                operation = "create_staging"
                descriptor, staging = tempfile.mkstemp(prefix=".github-source-", dir=destination.parent)
                try:
                    operation = "write_staging"
                    with os.fdopen(descriptor, "wb") as stream:
                        for chunk in _spool_chunks(spool, item["offset"], item["bytes"]):
                            stream.write(chunk)
                        stream.flush()
                        operation = "sync_staging"
                        os.fsync(stream.fileno())
                        operation = "set_mode"
                        os.fchmod(stream.fileno(), int((item["mode"] or "100644")[-3:], 8))
                        operation = "close_staging"
                    operation = "publish_file"
                    try:
                        # Atomic create-only publication preserves a concurrent edit.
                        os.link(staging, destination)
                        outcome = "written"
                    except FileExistsError:
                        operation = "inspect_destination"
                        _destination(root, item, spool)
                finally:
                    # Preserve the failed operation label when cleanup succeeds.
                    try:
                        Path(staging).unlink(missing_ok=True)
                    except OSError:
                        operation = "remove_staging"
                        raise
        except OSError as exc:
            raise SourceImportIOError(exc, operation=operation, path=item["path"],
                                      completed_files=results) from exc
        result = {"path": item["path"], "blob_sha": item["blob_sha"],
                  "bytes": item["bytes"], "state": outcome}
        if item["mode"] is not None:
            result["mode"] = item["mode"]
        if isinstance(item["source_url"], str):
            result["source_url"] = item["source_url"]
        results.append(result)
    return {"ok": True, "output_directory": str(root), "files": results,
            "written": sum(row["state"] == "written" for row in results),
            "unchanged": sum(row["state"] == "unchanged" for row in results)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", help="JSON files array with response or source_file/blob_sha entries")
    parser.add_argument("output_directory", help="Cloud working directory for exact source files")
    parser.add_argument("--manifest-format", choices=("json", "ndjson"), default="json",
                        help="Original JSON object, or one original source entry per nonblank line")
    parser.add_argument("--staging-directory", help="Existing disk-backed snapshot parent; defaults beside the destination")
    materialization_arguments(parser)
    args = parser.parse_args(argv)
    try:
        options = materialization_from_args(args)
        with _open_regular_file(Path(args.manifest), encoding="utf-8") as stream:
            if args.manifest_format == "ndjson":
                result = materialize_entries((json.loads(line) for line in stream if line.strip()),
                                             args.output_directory, staging_directory=args.staging_directory,
                                             **options)
            else:
                manifest = json.load(stream)
                result = materialize(manifest, args.output_directory, staging_directory=args.staging_directory,
                                     **options)
    except SourceImportError as exc:
        result = {"ok": False, "error": exc.code, "detail": exc.detail}
        if exc.path is not None:
            result["path"] = exc.path
    except SourceImportIOError as exc:
        result = _io_error_result(exc, operation=exc.operation, path=exc.source_path,
                                  completed_files=exc.completed_files)
    except OSError as exc:
        result = _io_error_result(exc, operation="read_manifest", path=args.manifest,
                                  completed_files=[])
    except (UnicodeError, ValueError, RecursionError) as exc:
        result = {"ok": False, "error": "SOURCE_IMPORT_JSON",
                  "detail": type(exc).__name__ + ": import did not complete; existing files were preserved."}
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
