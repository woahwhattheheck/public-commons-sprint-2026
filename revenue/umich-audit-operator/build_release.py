#!/usr/bin/env python3
"""Build or verify the complete, enumerated public audit application source ZIP."""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import zipfile

FORMAT = "commons-audit-source-release/1"
REPOSITORY = "woahwhattheheck/public-commons-sprint-2026"
REPOSITORY_PREFIX = "revenue/umich-audit-operator"
SOURCE_FILES = (
    "LICENSE", "README.md", "DEMONSTRATION.md", "EXCHANGE.md",
    "SOURCE_ACQUISITION.md", "requirements.txt", "run.py", "build_release.py",
    "audit_operator/__init__.py", "audit_operator/store.py", "audit_operator/model.py",
    "audit_operator/archive.py", "audit_operator/service.py", "audit_operator/exchange.py",
    "audit_operator/reporting.py", "audit_operator/host.py",
    "ui/index.html", "ui/style.css", "ui/app.js",
    "examples/EXCHANGE_PRACTICE.py", "examples/OPERATOR_PRACTICE.py", "examples/UI_RECEIVING.mjs",
    "reference/audit-domain-contract.json", "reference/event-catalog.json",
    "tools/materialize_reference.py", "tools/extract_event_catalog.py",
)
MANIFEST = "SOURCE_MANIFEST.json"
MAX_SOURCE_FILE = 4 * 1024 * 1024
MAX_SOURCE_TOTAL = 16 * 1024 * 1024
MAX_ARCHIVE = 32 * 1024 * 1024
SHA = re.compile(r"^[0-9a-f]{64}$")
BLOB = re.compile(r"^[0-9a-f]{40}$")

def sha256(data):
    return hashlib.sha256(data).hexdigest()

def git_blob_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")

def read_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("The release manifest repeats a JSON field.")
            result[key] = value
        return result
    return json.loads(data.decode("utf-8"), object_pairs_hook=pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))

def source_identity(name, body):
    return {"path": name, "bytes": len(body), "sha256": sha256(body), "git_blob_sha": git_blob_sha(body)}

def collect_sources(source_root):
    root = Path(source_root).expanduser().absolute()
    if not root.is_dir():
        raise ValueError("Choose the complete application source directory.")
    root = root.resolve()
    bodies = {}
    total = 0
    for name in SOURCE_FILES:
        path = root / name
        # Resolve every parent so an external symlink cannot pull a private file
        # into an otherwise enumerated source path.
        if path.is_symlink() or path.resolve() != path or not path.is_file():
            raise ValueError("Required source is absent, symbolic, or non-regular: " + name)
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_SOURCE_FILE:
            raise ValueError("Source exceeds the regular-file limit: " + name)
        body = path.read_bytes()
        if len(body) != info.st_size:
            raise ValueError("Source changed while it was being read: " + name)
        # Public source entries are UTF-8 code, JSON, documentation and license.
        body.decode("utf-8")
        total += len(body)
        if total > MAX_SOURCE_TOTAL:
            raise ValueError("The enumerated source closure exceeds 16 MiB.")
        bodies[name] = body
    return bodies

def make_manifest(bodies, source_reference):
    if not isinstance(source_reference, str) or not source_reference.strip() or len(source_reference) > 200:
        raise ValueError("Record a source commit or meaningful release label of at most 200 characters.")
    if any(ord(char) < 32 for char in source_reference):
        raise ValueError("The source reference must be one printable line.")
    return {"format": FORMAT, "repository": REPOSITORY, "repository_prefix": REPOSITORY_PREFIX,
            "source_reference": source_reference,
            "source_reference_kind": "publisher_supplied_label",
            "contents": "Enumerated application sources and public reference contracts; no private operating workspace.",
            "source_files": len(bodies), "source_bytes": sum(len(body) for body in bodies.values()),
            "files": [source_identity(name, bodies[name]) for name in sorted(bodies)]}

def archive_bytes(bodies, manifest):
    files = dict(bodies)
    files[MANIFEST] = canonical(manifest) + b"\n"
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, body in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, body, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
    value = out.getvalue()
    if len(value) > MAX_ARCHIVE:
        raise ValueError("The complete source ZIP exceeds 32 MiB.")
    return value

def inspect_release(data):
    if not isinstance(data, bytes) or len(data) > MAX_ARCHIVE:
        raise ValueError("Choose a complete source ZIP of at most 32 MiB.")
    files = {}
    expected_names = set(SOURCE_FILES) | {MANIFEST}
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) != len(expected_names):
                raise ValueError("The source ZIP does not contain the complete enumerated closure.")
            total = 0
            for item in entries:
                name = item.filename
                if name not in expected_names or name in files or item.is_dir():
                    raise ValueError("The source ZIP contains an unlisted or duplicate entry.")
                if item.flag_bits & 1 or stat.S_IFMT(item.external_attr >> 16) == stat.S_IFLNK:
                    raise ValueError("Encrypted or symbolic source members are not accepted.")
                if item.file_size < 0 or item.file_size > MAX_SOURCE_FILE:
                    raise ValueError("An expanded source entry exceeds 4 MiB.")
                total += item.file_size
                if total > MAX_SOURCE_TOTAL + MAX_SOURCE_FILE:
                    raise ValueError("The expanded source ZIP exceeds its bounded closure.")
                body = archive.read(item)
                if len(body) != item.file_size:
                    raise ValueError("An expanded source entry is incomplete.")
                body.decode("utf-8")
                files[name] = body
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
        raise ValueError("The source ZIP is incomplete or unsupported.") from exc
    if set(files) != expected_names:
        raise ValueError("A required source is missing.")
    manifest = read_json(files.pop(MANIFEST))
    if (not isinstance(manifest, dict) or manifest.get("format") != FORMAT
        or manifest.get("repository") != REPOSITORY or manifest.get("repository_prefix") != REPOSITORY_PREFIX):
        raise ValueError("This is not the supported audit source release.")
    entries = manifest.get("files")
    if not isinstance(entries, list) or len(entries) != len(SOURCE_FILES):
        raise ValueError("The manifest does not list every source.")
    identities = {}
    for entry in entries:
        if (not isinstance(entry, dict) or entry.get("path") not in files or entry["path"] in identities
            or type(entry.get("bytes")) is not int or entry["bytes"] < 0
            or not isinstance(entry.get("sha256"), str) or not SHA.fullmatch(entry["sha256"])
            or not isinstance(entry.get("git_blob_sha"), str) or not BLOB.fullmatch(entry["git_blob_sha"])):
            raise ValueError("A source identity in the manifest is malformed or repeated.")
        actual = source_identity(entry["path"], files[entry["path"]])
        if actual != entry:
            raise ValueError("The source does not match its original bytes: " + entry["path"])
        identities[entry["path"]] = entry
    expected_manifest = make_manifest(files, manifest.get("source_reference"))
    if manifest != expected_manifest:
        raise ValueError("The complete source totals or release metadata differ.")
    return manifest, files

def verify_release(archive_path):
    path = Path(archive_path).expanduser().absolute()
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_ARCHIVE or path.is_symlink():
        raise ValueError("Choose a regular source ZIP of at most 32 MiB.")
    value = path.read_bytes()
    manifest, _ = inspect_release(value)
    return {"archive": str(path), "bytes": len(value), "sha256": sha256(value),
            "source_files": manifest["source_files"], "source_bytes": manifest["source_bytes"],
            "source_reference": manifest["source_reference"], "verified": True}

def fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def build_release(source_root, output_path, source_reference):
    bodies = collect_sources(source_root)
    manifest = make_manifest(bodies, source_reference)
    output = Path(output_path).expanduser().absolute()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.is_symlink():
        raise ValueError("The output cannot be a symbolic link.")
    if output.exists():
        retained_summary = verify_release(output)
        existing, _ = inspect_release(output.read_bytes())
        if existing != manifest:
            raise FileExistsError("The existing source release has different original inputs; choose a new output.")
        return {**retained_summary, "reused": True}
    value = archive_bytes(bodies, manifest)
    inspected, _ = inspect_release(value)
    if inspected != manifest:
        raise ValueError("The built source release failed readback.")
    descriptor, temporary_name = tempfile.mkstemp(prefix=".audit-source-", suffix=".zip", dir=output.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as file:
            file.write(value)
            file.flush()
            os.fsync(file.fileno())
        # Atomic no-overwrite publication on the same filesystem.
        os.link(temporary, output)
        temporary.unlink()
        fsync_directory(output.parent)
        return {**verify_release(output), "reused": False}
    finally:
        if temporary.exists():
            temporary.unlink()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parent))
    parser.add_argument("--output")
    parser.add_argument("--source-reference")
    parser.add_argument("--verify")
    args = parser.parse_args()
    if args.verify:
        if args.output or args.source_reference:
            parser.error("--verify is separate from source-build arguments.")
        result = verify_release(args.verify)
    else:
        if not args.output or not args.source_reference:
            parser.error("--output and --source-reference are required for a source build.")
        result = build_release(args.source_root, args.output, args.source_reference)
    print(json.dumps(result, sort_keys=True))

if __name__ == "__main__":
    main()
