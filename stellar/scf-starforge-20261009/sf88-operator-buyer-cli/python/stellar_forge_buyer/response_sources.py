"""Retain original stream and MCP source files inside an Analysis workspace.

The content address is the existing response identity. Original registrations,
payment observations, raw bytes and stream completion remain unchanged. The
normal native readers verify a relocated copy; this module never acquires data.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat

from .errors import StateError
from .storage import digest, parse, private_directory, read, sync_directory

SCHEMA = "stellar-forge.analysis-retained-response.v1"
ROOT = "analysis-response-sources"
_HASH = re.compile(r"[a-f0-9]{64}")
_QUOTE = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
_MAX_BYTES = 256 * 1024 * 1024
_MAX_BINDING = 4 * 1024 * 1024


def _need(ok, code):
    if not ok:
        raise StateError(code)


def _json(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                       separators=(",", ":")) + "\n").encode()


def _identity(source):
    value = source.get("identity")
    identifier = source.get("source_sha256")
    _need(source.get("kind") == "response" and source.get("input_kind") in {"stream", "mcp"}
          and isinstance(value, dict) and isinstance(identifier, str) and _HASH.fullmatch(identifier)
          and value.get("schema") == "stellar-forge.analysis-response-source.v1"
          and value.get("format") == source.get("format")
          and digest(_json(value).rstrip(b"\n")) == identifier,
          "ANALYSIS_RETAINED_RESPONSE_IDENTITY_INVALID")
    return identifier


def _row(role, path, value):
    _need(isinstance(value, dict) and type(value.get("bytes")) is int
          and 0 <= value["bytes"] <= _MAX_BYTES
          and isinstance(value.get("sha256"), str) and _HASH.fullmatch(value["sha256"]),
          "ANALYSIS_RETAINED_RESPONSE_FILE_IDENTITY_INVALID")
    return {"role": role, "path": path, "bytes": value["bytes"], "sha256": value["sha256"]}


def expected_files(source):
    _identity(source)
    identity = source["identity"]
    inputs = identity.get("inputFiles")
    _need(isinstance(inputs, list) and all(isinstance(x, dict) for x in inputs),
          "ANALYSIS_RETAINED_RESPONSE_INPUTS_INVALID")
    by_role = {x.get("role"): x for x in inputs}
    _need(len(by_role) == len(inputs), "ANALYSIS_RETAINED_RESPONSE_INPUTS_INVALID")
    if source["input_kind"] == "stream":
        _need(set(by_role) == {"manifest", "request"} and source["format"] in {"sse", "ndjson"},
              "ANALYSIS_RETAINED_STREAM_INPUTS_INVALID")
        return sorted([
            _row("manifest", "manifest.json", by_role["manifest"]),
            _row("request", "source.json", by_role["request"]),
            _row("records", "records.jsonl", identity.get("retainedFile")),
            _row("response", "response.bin", {
                "bytes": identity.get("original", {}).get("sourceBytes"),
                "sha256": identity.get("original", {}).get("sourceSha256")}),
        ], key=lambda x: x["path"])
    quote = identity.get("original", {}).get("quoteId")
    _need(set(by_role) == {"manifest"} and isinstance(quote, str) and _QUOTE.fullmatch(quote)
          and source["format"] == "json", "ANALYSIS_RETAINED_MCP_INPUTS_INVALID")
    return sorted([
        _row("manifest", quote + ".meta.json", by_role["manifest"]),
        _row("response", quote + ".json", identity.get("retainedFile")),
    ], key=lambda x: x["path"])


def allowed_response_payload(path):
    if not isinstance(path, str):
        return False
    return bool(re.fullmatch(
        ROOT + r"/[a-f0-9]{64}/(?:capsule\.json|manifest\.json|source\.json|records\.jsonl|response\.bin|"
        r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?:\.meta)?\.json)", path))


def _stamp(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


@contextmanager
def _file(path):
    path = Path(path)
    _need(path.is_absolute() and path.resolve() == path, "ANALYSIS_RETAINED_RESPONSE_PATH_INVALID")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        _need(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077
              and info.st_uid == os.geteuid() and info.st_size <= _MAX_BYTES,
              "ANALYSIS_RETAINED_RESPONSE_PRIVATE_FILE_REQUIRED")
        yield stream


def _file_identity(path):
    with _file(path) as stream:
        before = os.fstat(stream.fileno())
        checksum, size = hashlib.sha256(), 0
        while block := stream.read(1024 * 1024):
            size += len(block)
            _need(size <= _MAX_BYTES, "ANALYSIS_RETAINED_RESPONSE_TOO_LARGE")
            checksum.update(block)
        _need(_stamp(before) == _stamp(os.fstat(stream.fileno())) and size == before.st_size,
              "ANALYSIS_RETAINED_RESPONSE_CHANGED")
    return {"bytes": size, "sha256": checksum.hexdigest()}


def _directory(path):
    path = Path(path).absolute()
    if not os.path.lexists(path):
        _directory(path.parent)
        try:
            path.mkdir(mode=0o700)
        except FileExistsError:
            pass
    info = path.lstat()
    _need(stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o077
          and info.st_uid == os.geteuid() and path.resolve() == path,
          "ANALYSIS_RETAINED_RESPONSE_PRIVATE_DIRECTORY_REQUIRED")
    # Complete a prior interrupted mkdir even when both entries now exist.
    sync_directory(path)
    sync_directory(path.parent)
    return path


def _folder(root, identifier):
    return Path(root).expanduser().absolute() / ROOT / identifier


def inspect_response(folder, source):
    identifier = _identity(source)
    selected = Path(folder).expanduser().absolute()
    _need(selected.resolve() == selected, "ANALYSIS_RETAINED_RESPONSE_PATH_INVALID")
    folder = private_directory(selected, create=False)
    path = folder / "capsule.json"
    capsule = parse(read(path, _MAX_BINDING))
    expected = expected_files(source)
    _need(isinstance(capsule, dict) and capsule.get("schema") == SCHEMA
          and capsule.get("source_sha256") == identifier
          and capsule.get("input_kind") == source["input_kind"]
          and capsule.get("format") == source["format"]
          and capsule.get("identity") == source["identity"]
          and capsule.get("files") == expected,
          "ANALYSIS_RETAINED_RESPONSE_CAPSULE_CHANGED")
    originals = capsule.get("original_paths")
    _need(isinstance(originals, dict) and set(originals) == {x["role"] for x in expected}
          and all(isinstance(x, str) and x.startswith("/") and "\0" not in x for x in originals.values()),
          "ANALYSIS_RETAINED_RESPONSE_ORIGIN_INVALID")
    _need({x.name for x in folder.iterdir()} == {"capsule.json", *(x["path"] for x in expected)},
          "ANALYSIS_RETAINED_RESPONSE_FILE_SET_CHANGED")
    files = []
    for row in expected:
        actual = _file_identity(folder / row["path"])
        _need(actual == {k: row[k] for k in ("bytes", "sha256")},
              "ANALYSIS_RETAINED_RESPONSE_FILE_CHANGED")
        files.append({"path": ROOT + "/" + identifier + "/" + row["path"], **actual})
    files.append({"path": ROOT + "/" + identifier + "/capsule.json", **_file_identity(path)})
    return capsule, sorted(files, key=lambda x: x["path"])


def _located(source, folder):
    if source["input_kind"] == "stream":
        paths = {"stream": str(folder), "manifest": str(folder / "manifest.json"),
                 "request": str(folder / "source.json")}
    else:
        quote = source["identity"]["original"]["quoteId"]
        paths = {"manifest": str(folder / (quote + ".meta.json")), "retained": str(folder)}
    return {**source, "paths": paths}


def locate_response(root, source):
    """Resolve a retained local copy without changing the original DB record."""
    if source.get("input_kind") not in {"stream", "mcp"} or not source.get("source_sha256"):
        return source
    folder = _folder(root, _identity(source))
    if not os.path.lexists(folder):
        return source
    inspect_response(folder, source)
    return _located(source, folder)


def _copy(original, destination, expected):
    if os.path.lexists(destination):
        _need(_file_identity(destination) == {k: expected[k] for k in ("bytes", "sha256")},
              "ANALYSIS_RETAINED_RESPONSE_STAGING_CHANGED")
        sync_directory(destination.parent)
        return
    part = destination.with_name("." + destination.name + ".partial")
    fd = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as target:
        info = os.fstat(target.fileno())
        _need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.geteuid()
              and not info.st_mode & 0o077, "ANALYSIS_RETAINED_RESPONSE_PART_INVALID")
        os.ftruncate(target.fileno(), 0)
        with _file(original) as source:
            before = os.fstat(source.fileno())
            checksum, size = hashlib.sha256(), 0
            while block := source.read(1024 * 1024):
                size += len(block)
                _need(size <= expected["bytes"], "ANALYSIS_RETAINED_RESPONSE_CHANGED")
                checksum.update(block)
                target.write(block)
            _need(size == expected["bytes"] and checksum.hexdigest() == expected["sha256"]
                  and _stamp(before) == _stamp(os.fstat(source.fileno())),
                  "ANALYSIS_RETAINED_RESPONSE_CHANGED")
        target.flush()
        os.fsync(target.fileno())
    os.replace(part, destination)
    sync_directory(destination.parent)


def retain_response(root, source, *, checkout=None, node="node"):
    """Copy one registered original source, then verify its native relocated view."""
    from .response_tables import open_source
    identifier = _identity(source)
    root = private_directory(Path(root), create=False)
    parent = _directory(root / ROOT)
    target, stage = parent / identifier, parent / ("." + identifier + ".receiving")
    fd = os.open(parent / ("." + identifier + ".lock"), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        _need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.geteuid()
              and not info.st_mode & 0o077, "ANALYSIS_RETAINED_RESPONSE_LOCK_INVALID")
        fcntl.flock(fd, fcntl.LOCK_EX)
        if os.path.lexists(target):
            capsule, files = inspect_response(target, source)
            opened = open_source(_located(source, target), checkout=checkout, node=node)
            with opened.file.open():
                pass
            opened.check_inputs()
            sync_directory(target)
            sync_directory(parent)
            return {"schema": SCHEMA, "source_sha256": identifier, "state": "RETAINED",
                    "directory": str(target), "files": files, "reused": True}
        stage = _directory(stage)
        expected = expected_files(source)
        opened = open_source(source, checkout=checkout, node=node)
        with opened.file.open():
            pass
        opened.check_inputs()
        originals = {x["role"]: x["path"] for x in opened.inputs}
        if source["input_kind"] == "stream":
            manifest = parse(read(Path(originals["manifest"]), 1_048_576))
            originals.update(records=str(opened.file.expected_destination), response=manifest["source"]["path"])
        else:
            originals["response"] = str(opened.file.expected_destination)
        for row in expected:
            _copy(Path(originals[row["role"]]), stage / row["path"], row)
        capsule = {"schema": SCHEMA, "source_sha256": identifier, "input_kind": source["input_kind"],
                   "format": source["format"], "identity": source["identity"], "files": expected,
                   "original_paths": originals}
        encoded = _json(capsule)
        binding = stage / "capsule.json"
        if os.path.lexists(binding):
            _need(read(binding, _MAX_BINDING) == encoded, "ANALYSIS_RETAINED_RESPONSE_STAGING_CHANGED")
        else:
            part = stage / ".capsule.json.partial"
            outfd = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            with os.fdopen(outfd, "wb") as output:
                info = os.fstat(output.fileno())
                _need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.geteuid()
                      and not info.st_mode & 0o077, "ANALYSIS_RETAINED_RESPONSE_PART_INVALID")
                os.ftruncate(output.fileno(), 0)
                output.write(encoded)
                output.flush()
                os.fsync(output.fileno())
            os.replace(part, binding)
            sync_directory(stage)
        inspect_response(stage, source)
        received = open_source(_located(source, stage), checkout=checkout, node=node)
        with received.file.open():
            pass
        received.check_inputs()
        sync_directory(stage)
        os.rename(stage, target)
        sync_directory(parent)
        capsule, files = inspect_response(target, source)
        return {"schema": SCHEMA, "source_sha256": identifier, "state": "RETAINED",
                "directory": str(target), "files": files, "reused": False}
    finally:
        os.close(fd)


def snapshot_response_files(root, db):
    """Select every retained source referenced by this exact SQLite snapshot."""
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "sf_analysis_response_sources" not in tables:
        return []
    selected = {}
    for (record,) in db.execute("SELECT record FROM sf_analysis_response_sources ORDER BY name,revision"):
        source = parse(record.encode())
        if source.get("input_kind") not in {"stream", "mcp"}:
            continue
        folder = _folder(root, _identity(source))
        if not os.path.lexists(folder):
            continue
        _, files = inspect_response(folder, source)
        for row in files:
            _need(row["path"] not in selected or selected[row["path"]] == row,
                  "ANALYSIS_RETAINED_RESPONSE_IDENTITY_CONFLICT")
            selected[row["path"]] = row
    return [selected[key] for key in sorted(selected)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--checkout")
    parser.add_argument("--node", default="node")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="Retain every registered stream and MCP revision")
    group.add_argument("--name", help="Original response registration name")
    parser.add_argument("--revision", type=int, help="Exact original revision; required with --name")
    args = parser.parse_args()
    _need((args.all and args.revision is None) or
          (args.name and type(args.revision) is int and args.revision > 0),
          "ANALYSIS_RETAINED_RESPONSE_SELECTION_REQUIRED")
    from .analysis_workspace import AnalysisWorkspace
    workspace = AnalysisWorkspace(args.database, checkout=args.checkout, node=args.node)
    try:
        with workspace.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            records = [parse(row[0].encode()) for row in db.execute(
                "SELECT record FROM sf_analysis_response_sources ORDER BY name,revision")]
        if args.name:
            records = [x for x in records if x["name"] == args.name and x["revision"] == args.revision]
            _need(len(records) == 1, "ANALYSIS_RESPONSE_SOURCE_NOT_FOUND")
        selected = [x for x in records if x.get("input_kind") in {"stream", "mcp"}]
        _need(args.all or len(selected) == 1, "ANALYSIS_RETAINED_RESPONSE_KIND_UNSUPPORTED")
        results = [{"name":x["name"], "revision":x["revision"],
                    **retain_response(workspace.database.directory, x, checkout=workspace.checkout, node=workspace.node)}
                   for x in selected]
        print(_json({"schema": SCHEMA, "sources": results,
                     "other_source_kinds": sorted({x.get("input_kind", x.get("kind", "unknown"))
                                                  for x in records if x not in selected})}).decode(), end="")
    finally:
        workspace.close()


if __name__ == "__main__":
    main()
