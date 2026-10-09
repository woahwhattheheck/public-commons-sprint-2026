#!/usr/bin/env python3
"""Export one tracked public source directory without executing repository code."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

MAX_BYTES = 100 * 1024 * 1024
MAX_FILES = 20_000


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], stderr=subprocess.PIPE)


def export_source(source_path: str, destination: Path) -> dict:
    """Copy regular Git blobs from the checked-out commit, preserving paths/modes."""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./-]*", source_path):
        raise ValueError("source path must be a relative, literal directory name")
    if any(part in ("", ".", "..") for part in source_path.split("/")):
        raise ValueError("empty, dot and parent path segments are forbidden")
    commit = git("rev-parse", "HEAD").decode().strip()
    tree = git("rev-parse", f"{commit}:{source_path}").decode().strip()
    if git("cat-file", "-t", tree).strip() != b"tree":
        raise ValueError("source path must identify a tracked directory")
    entries = git("ls-tree", "-r", "-z", "--full-tree", commit, "--", source_path + "/")
    rows = []
    total = 0
    for record in entries.split(b"\0"):
        if not record:
            continue
        meta, raw_path = record.split(b"\t", 1)
        mode, kind, blob = meta.decode("ascii").split()
        name = raw_path.decode("utf-8")
        if kind != "blob" or mode not in ("100644", "100755"):
            raise ValueError(f"symlinks, submodules and non-regular entries are unsupported: {name!r}")
        parts = PurePosixPath(name).parts
        if not name.startswith(source_path + "/") or any(p in (".", "..") for p in parts):
            raise ValueError("archive entry escaped its selected source directory")
        if "\\" in name or any(ord(c) < 32 for c in name):
            raise ValueError(f"unsafe archive filename: {name!r}")
        size = int(git("cat-file", "-s", blob))
        total += size
        rows.append((name, mode, blob, size))
        if total > MAX_BYTES or len(rows) > MAX_FILES:
            raise ValueError("source export exceeds the 100 MiB / 20,000 file bound")
    if not rows:
        raise ValueError("selected directory has no regular tracked files")
    destination.mkdir(parents=True, exist_ok=False)
    archive = destination / "source.zip"
    manifest = {"schema_version": 1, "source_commit": commit, "source_tree": tree,
                "source_path": source_path, "files": [], "total_bytes": total}
    try:
        with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
            for name, mode, blob, size in rows:
                data = git("cat-file", "blob", blob)
                if len(data) != size:
                    raise ValueError("Git blob size changed during export")
                actual = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
                if actual != blob:
                    raise ValueError("Git blob identity mismatch")
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = int(mode, 8) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                output.writestr(info, data)
                manifest["files"].append({"path": name, "mode": mode, "git_blob": blob,
                                          "size": size, "sha256": hashlib.sha256(data).hexdigest()})
        manifest["archive_sha256"] = hashlib.sha256(archive.read_bytes()).hexdigest()
        manifest["file_count"] = len(rows)
        (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    except BaseException:
        archive.unlink(missing_ok=True)
        raise
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_path")
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    try:
        result = export_source(args.source_path, args.destination)
    except (ValueError, OSError, subprocess.CalledProcessError, UnicodeError) as exc:
        parser.exit(1, f"source export failed: {exc}\n")
    print(json.dumps({key: result[key] for key in ("source_commit", "source_path", "file_count", "total_bytes", "archive_sha256")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
