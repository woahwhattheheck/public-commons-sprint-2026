#!/usr/bin/env python3
"""Run a retained Upstate receiver using local/shared source and output files.

The maintained receiver is loaded unchanged. Its runtime, browser, workspace,
context, and restore arguments are forwarded after the wrapper options.
"""
from __future__ import annotations

import argparse
import base64
import fcntl
import gzip
import hashlib
import inspect
import io
import json
import os
from pathlib import Path
import re
import sys
import types
import uuid
import zipfile

EXPECTED_RECEIVER_SHA256 = "bb1060171e29298460027bc026671e505d5fe271a0cf37faed46fd15126caed9"
WRAPPER_OPERATION = "upstate-local-receiving"
CHUNK = 1024 * 1024


def sha256(body):
    return hashlib.sha256(body).hexdigest()


def blob_sha(body):
    return hashlib.sha1(b"blob " + str(len(body)).encode("ascii") + b"\0" + body).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def emit(stage, **fields):
    print(json.dumps({"operation": WRAPPER_OPERATION, "stage": stage, **fields}), flush=True)


def atomic(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex)
    try:
        with temporary.open("xb") as output:
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def file_fingerprint(path):
    checksum = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK), b""):
            checksum.update(chunk)
            size += len(chunk)
    return {"bytes": size, "sha256": checksum.hexdigest()}


class LocalSources:
    """Supply retained bytes in the original loader's blob response format."""

    def __init__(self, source_zip, cache_directories, bundles, expected_hash=None, expected_bytes=None):
        self.source_zip = source_zip
        self.cache_directories = cache_directories
        self.bundles = bundles
        self.entries = {}
        self.used = {}
        self.indexed = False
        self.zip_body = source_zip.read_bytes()
        if expected_hash and sha256(self.zip_body) != expected_hash:
            raise ValueError("The source ZIP differs from the maintained receiver's pinned archive")
        if expected_bytes is not None and len(self.zip_body) != expected_bytes:
            raise ValueError("The source ZIP byte count differs from the maintained receiver")
        self.zip_metadata = {"path": str(source_zip), "bytes": len(self.zip_body),
                             "sha256": sha256(self.zip_body), "git_blob": blob_sha(self.zip_body)}
        self._add_bytes(self.zip_body, str(source_zip))
        with zipfile.ZipFile(io.BytesIO(self.zip_body)) as archive:
            for member in archive.infolist():
                if not member.is_dir():
                    self._add_bytes(archive.read(member), str(source_zip) + "!" + member.filename)

    def _add_bytes(self, body, origin):
        key = blob_sha(body)
        metadata = {"bytes": len(body), "sha256": sha256(body), "origin": origin}
        previous = self.entries.get(key)
        if previous is not None and previous["sha256"] != metadata["sha256"]:
            raise ValueError("Retained sources disagree for blob " + key)
        self.entries.setdefault(key, {**metadata, "body": body})
        return key

    def _add_file(self, path):
        size = path.stat().st_size
        blob = hashlib.sha1(b"blob " + str(size).encode("ascii") + b"\0")
        checksum = hashlib.sha256()
        actual_size = 0
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(CHUNK), b""):
                blob.update(chunk)
                checksum.update(chunk)
                actual_size += len(chunk)
        if actual_size != size:
            raise ValueError("A retained source changed while being read: " + str(path))
        key = blob.hexdigest()
        metadata = {"bytes": size, "sha256": checksum.hexdigest(), "origin": str(path), "path": path}
        previous = self.entries.get(key)
        if previous is not None and previous["sha256"] != metadata["sha256"]:
            raise ValueError("Retained sources disagree for blob " + key)
        self.entries.setdefault(key, metadata)

    def _add_bundle(self, path):
        body = path.read_bytes()
        if body.startswith(b"\x1f\x8b"):
            body = gzip.decompress(body)
        document = json.loads(body)
        count = 0

        def visit(value):
            nonlocal count
            if isinstance(value, dict):
                if "content_base64" in value:
                    content = base64.b64decode(value["content_base64"], validate=True)
                    expected_hash = value.get("sha256")
                    if not isinstance(expected_hash, str) or sha256(content) != expected_hash.lower():
                        raise ValueError("A source bundle entry has a different or missing SHA-256")
                    if "bytes" in value and len(content) != value["bytes"]:
                        raise ValueError("A source bundle entry has a different byte count")
                    expected_blob = value.get("git_blob")
                    if expected_blob and blob_sha(content) != expected_blob:
                        raise ValueError("A source bundle entry has a different Git blob identifier")
                    self._add_bytes(content, str(path) + "!" + str(value.get("path", count)))
                    count += 1
                else:
                    for nested in value.values():
                        visit(nested)
            elif isinstance(value, list):
                for nested in value:
                    visit(nested)

        visit(document)
        if not count:
            raise ValueError("No content_base64 source entries found in " + str(path))

    def _index_remaining(self):
        if self.indexed:
            return
        for path in self.bundles:
            self._add_bundle(path)
        skip = {".git", "node_modules", ".venv", "venv", "__pycache__", "private"}
        for directory in self.cache_directories:
            for current, directories, files in os.walk(directory, followlinks=False):
                directories[:] = sorted(name for name in directories
                                         if name not in skip and not (Path(current) / name).is_symlink())
                for name in sorted(files):
                    path = Path(current) / name
                    if path.is_file() and not path.is_symlink():
                        self._add_file(path)
        self.indexed = True

    def api(self, path, method="GET", data=None):
        if method != "GET" or data is not None:
            raise ValueError("Local source loading received a write request: " + method + " " + path)
        match = re.fullmatch(r"/repos/[^/]+/[^/]+/git/blobs/([0-9a-f]{40})", path)
        if not match:
            raise ValueError("The retained receiver requested an unsupported local source operation: " + path)
        key = match.group(1)
        if key not in self.entries:
            self._index_remaining()
        entry = self.entries.get(key)
        if entry is None:
            raise FileNotFoundError("Retained source blob " + key + " is missing. Supply its existing "
                                    "files with --source-cache-directory or --source-bundle.")
        body = entry.get("body")
        if body is None:
            body = entry["path"].read_bytes()
        if (len(body) != entry["bytes"] or sha256(body) != entry["sha256"] or blob_sha(body) != key):
            raise ValueError("A retained source changed: " + entry["origin"])
        self.used[key] = {field: entry[field] for field in ("origin", "bytes", "sha256")}
        return {"sha": key, "size": len(body), "encoding": "base64",
                "content": base64.b64encode(body).decode("ascii")}


def require_hook(module, name, parameters):
    hook = getattr(module, name, None)
    if not callable(hook):
        raise ValueError("The retained receiver is missing callable " + name)
    signature = inspect.signature(hook)
    actual = tuple(signature.parameters)
    if actual != parameters or any(
            parameter.kind not in (inspect.Parameter.POSITIONAL_ONLY,
                                   inspect.Parameter.POSITIONAL_OR_KEYWORD)
            for parameter in signature.parameters.values()):
        raise ValueError("Receiver hook " + name + str(signature) + " differs from the retained "
                         "contract " + name + "(" + ", ".join(parameters) + ")")
    return hook


def copy_exact(source, target, expected):
    """The caller holds the bundle lock while installing or reusing each file."""
    if target.exists() or target.is_symlink():
        if target.is_symlink() or not target.is_file() or file_fingerprint(target) != expected:
            raise ValueError("Existing preserved output differs: " + str(target))
        return
    temporary = target.with_name("." + target.name + "." + uuid.uuid4().hex)
    try:
        with source.open("rb") as input_file, temporary.open("xb") as output_file:
            for chunk in iter(lambda: input_file.read(CHUNK), b""):
                output_file.write(chunk)
            output_file.flush()
            os.fsync(output_file.fileno())
        if file_fingerprint(temporary) != expected:
            raise ValueError("Preserved output copy differs: " + str(target))
        os.replace(temporary, target)
        if file_fingerprint(target) != expected:
            raise ValueError("Preserved output readback differs: " + str(target))
    finally:
        temporary.unlink(missing_ok=True)


def preserve_outputs(module, wrapper_args, sources, receiver_metadata, root, result):
    root = Path(root).resolve()
    if not isinstance(result, dict):
        raise ValueError("The retained receiver returned another native result format")
    result_body = encoded(result)
    atomic(root / "NATIVE_RESULT.json", result_body)
    # Keep any current source/overlay manifest alongside the original manifest.
    lineage = {}
    for pattern in ("SOURCE*.json", "*SOURCE*MANIFEST*.json", "OVERLAY*.json"):
        for path in root.glob(pattern):
            if path.is_symlink() or not path.is_file():
                raise ValueError("A source manifest must be a regular file: " + str(path))
            lineage[path.name] = path
    if "SOURCE_FILES.json" not in lineage:
        raise FileNotFoundError("The retained receiver did not produce SOURCE_FILES.json")
    receipt_path = root / "LOCAL_RECEIVING_SOURCE.json"
    atomic(receipt_path, encoded({
        "operation": WRAPPER_OPERATION, "receiver": receiver_metadata,
        "source_zip": sources.zip_metadata, "locally_resolved_blobs": sources.used,
        "source_revision": getattr(module, "SOURCE_REVISION", None)
    }))
    lineage[receipt_path.name] = receipt_path
    archive_path = root / "Upstate_Communities_Native_Workspace.zip"
    temporary = archive_path.with_name("." + archive_path.name + "." + uuid.uuid4().hex)
    native_members = []
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                             compresslevel=6, allowZip64=True) as archive:
            archive.writestr("NATIVE_RESULT.json", result_body)
            for name, path in sorted(lineage.items()):
                archive.write(path, name)
            for path in sorted((root / "native").rglob("*")):
                relative = path.relative_to(root)
                if {"private", "__pycache__"} & set(relative.parts) or path.name.endswith(".lock"):
                    continue
                if path.is_symlink():
                    raise ValueError("A native result alias must be received separately: " + str(relative))
                if not path.is_file():
                    continue
                checksum = hashlib.sha256()
                size = 0
                with path.open("rb") as input_file, archive.open(
                        relative.as_posix(), "w", force_zip64=True) as output_file:
                    for chunk in iter(lambda: input_file.read(CHUNK), b""):
                        output_file.write(chunk)
                        checksum.update(chunk)
                        size += len(chunk)
                native_members.append({"path": relative.as_posix(), "bytes": size,
                                       "sha256": checksum.hexdigest()})
            archive.writestr("NATIVE_FILES.json", encoded(native_members))
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        os.replace(temporary, archive_path)
    finally:
        temporary.unlink(missing_ok=True)
    native_manifest = root / "NATIVE_FILES.json"
    atomic(native_manifest, encoded(native_members))
    archive_metadata = file_fingerprint(archive_path)
    summary = {
        "operation": getattr(module, "OPERATION", WRAPPER_OPERATION),
        "receiver_operation": WRAPPER_OPERATION,
        "complete": bool(result.get("complete")),
        "source_revision": getattr(module, "SOURCE_REVISION", None),
        "source_zip": sources.zip_metadata,
        "receiver": receiver_metadata,
        "native_archive": {"filename": archive_path.name, **archive_metadata},
        "original_result": result,
        "preservation": {"mode": "local", "directory": str(root),
                         "archive": str(archive_path), "native_files": len(native_members)}
    }
    summary_path = root / "PRESERVED_RESULT.json"
    atomic(summary_path, encoded(summary))
    emit("native_outputs_preserved", complete=summary["complete"], mode="local",
         archive=summary["native_archive"], directory=str(root))

    if wrapper_args.preserve_directory:
        destination = wrapper_args.preserve_directory / archive_metadata["sha256"]
        if destination.is_symlink():
            raise ValueError("The shared bundle directory must not be a file alias")
        destination.mkdir(parents=True, exist_ok=True)
        lock_path = destination / ".preservation.lock"
        if lock_path.is_symlink():
            raise ValueError("The shared preservation lock must be a regular file")
        with lock_path.open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            paths = {archive_path.name: archive_path, "NATIVE_RESULT.json": root / "NATIVE_RESULT.json",
                     native_manifest.name: native_manifest, **lineage}
            saved = []
            for name, path in sorted(paths.items()):
                metadata = file_fingerprint(path)
                copy_exact(path, destination / name, metadata)
                saved.append({"filename": name, **metadata})
            shared_manifest = destination / "PRESERVED_RESULT.json"
            shared = {**summary, "preservation": {
                "mode": "shared-directory", "directory": str(destination),
                "archive": str(destination / archive_path.name),
                "files": saved, "local_directory": str(root)
            }}
            if shared_manifest.exists() or shared_manifest.is_symlink():
                if shared_manifest.is_symlink() or not shared_manifest.is_file():
                    raise ValueError("The shared result manifest must be a regular file")
                previous = json.loads(shared_manifest.read_text())
                if (previous.get("native_archive") != shared["native_archive"]
                        or previous.get("preservation", {}).get("files") != saved):
                    raise ValueError("The shared result manifest differs from the preserved files")
            else:
                atomic(shared_manifest, encoded(shared))
            # The manifest is installed last, after complete artifact readback.
            summary["preservation"]["shared_directory"] = str(destination)
            summary["preservation"]["shared_manifest"] = str(shared_manifest)
            atomic(summary_path, encoded(summary))
        emit("native_outputs_preserved", complete=summary["complete"], mode="shared-directory",
             archive=summary["native_archive"], directory=str(destination))
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, allow_abbrev=False,
        epilog="Forward the maintained receiver's arguments after --, for example: "
               "-- --node /usr/bin/node --node-modules /opt/node_modules "
               "--chromium /usr/bin/chromium --output-root /mnt/data/upstate-run")
    parser.add_argument("--receiver", type=Path, required=True,
                        help="Existing maintained receive_upstate_communities.py")
    parser.add_argument("--receiver-sha256", default=EXPECTED_RECEIVER_SHA256,
                        help="SHA-256 of the retained receiver; defaults to the 24,364-byte edition")
    parser.add_argument("--source-zip", type=Path, required=True,
                        help="Complete retained source archive on local disk or a shared mount")
    parser.add_argument("--source-cache-directory", type=Path, action="append", default=[],
                        help="Existing source files for any maintained overlays; repeatable")
    parser.add_argument("--source-bundle", type=Path, action="append", default=[],
                        help="Retained JSON or gzip JSON containing content_base64/SHA-256 source rows")
    parser.add_argument("--preserve-directory", type=Path,
                        help="Optional local/shared directory for a complete content-addressed copy")
    wrapper_args, forwarded = parser.parse_known_args(argv)
    if forwarded and forwarded[0] == "--":
        forwarded = forwarded[1:]
    if any(value == "--source-zip" or value.startswith("--source-zip=") for value in forwarded):
        parser.error("Pass --source-zip once as a wrapper option before --")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", wrapper_args.receiver_sha256):
        parser.error("--receiver-sha256 must contain 64 hexadecimal characters")
    wrapper_args.receiver = wrapper_args.receiver.expanduser().resolve(strict=True)
    wrapper_args.source_zip = wrapper_args.source_zip.expanduser().resolve(strict=True)
    wrapper_args.source_cache_directory = [
        path.expanduser().resolve(strict=True) for path in wrapper_args.source_cache_directory]
    wrapper_args.source_bundle = [path.expanduser().resolve(strict=True) for path in wrapper_args.source_bundle]
    if any(not path.is_dir() for path in wrapper_args.source_cache_directory):
        parser.error("--source-cache-directory must select an existing directory")
    if wrapper_args.preserve_directory:
        wrapper_args.preserve_directory = wrapper_args.preserve_directory.expanduser().resolve()
    body = wrapper_args.receiver.read_bytes()
    if sha256(body) != wrapper_args.receiver_sha256.lower():
        raise ValueError("The retained receiver differs from --receiver-sha256")
    receiver_metadata = {"path": str(wrapper_args.receiver), "bytes": len(body), "sha256": sha256(body)}
    module = types.ModuleType("upstate_retained_receiver")
    module.__file__ = str(wrapper_args.receiver)
    sys.modules[module.__name__] = module
    old_argv = sys.argv[:]
    old_path = sys.path[:]
    try:
        sys.path.insert(0, str(wrapper_args.receiver.parent))
        exec(compile(body, str(wrapper_args.receiver), "exec"), module.__dict__)
        require_hook(module, "original_git", ("args",))
        original_source_zip = require_hook(module, "source_zip", ("args", "api"))
        require_hook(module, "preserve", ("api", "root", "result"))
        require_hook(module, "main", ())
        sources = LocalSources(wrapper_args.source_zip, wrapper_args.source_cache_directory,
                               wrapper_args.source_bundle, getattr(module, "SOURCE_SHA256", None),
                               getattr(module, "SOURCE_BYTES", None))

        def local_git(args):
            emit("local_sources_ready", receiver=receiver_metadata, source_zip=sources.zip_metadata)
            return sources.api

        def local_source_zip(args, api):
            if Path(args.source_zip).resolve() != wrapper_args.source_zip:
                raise ValueError("The original receiver selected another source archive")
            # Retain its exact source revision, byte, manifest, and hash checks.
            return original_source_zip(args, sources.api)

        def local_preserve(api, root, result):
            return preserve_outputs(module, wrapper_args, sources, receiver_metadata, root, result)

        module.original_git = local_git
        module.source_zip = local_source_zip
        module.preserve = local_preserve
        sys.argv = [str(wrapper_args.receiver), *forwarded,
                    "--source-zip", str(wrapper_args.source_zip)]
        return module.main()
    finally:
        sys.argv = old_argv
        sys.path[:] = old_path
        sys.modules.pop(module.__name__, None)


if __name__ == "__main__":
    raise SystemExit(main())
