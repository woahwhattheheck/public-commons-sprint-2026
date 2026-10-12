#!/usr/bin/env python3
"""Receive the complete pinned Research source envelope using the original
Research worker's ordinary-directory and atomic exact-byte receiving pattern.
The original document CLI and workflow own the customer operation.
"""
import argparse
import hashlib
import json
import os
import stat
import sys
import uuid
from pathlib import Path, PurePosixPath

EXPECTED = {
    "schema": "sf88.research-client.native-source.v1",
    "repository": "woahwhattheheck/public-commons-sprint-2026",
    "sourceMerge": "d60d878e9c7c042c58b26b9ec5aaee8e99ffd5a0",
    "releaseMerge": "d9c2e3e6f6b86883d76befb74cd252caacb0e698",
    "bytes": 3670230,
    "sha256": "4b15d21cf32ba2a0f082209c828f2ba4beca19e98ceb2f8af1eeea7c15268caa",
    "files": 283,
    "sourceBytes": 3527883,
}


def need(value, message):
    if not value:
        raise ValueError(message)


def digest(body):
    return hashlib.sha256(body).hexdigest()


def ordinary(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        need(stat.S_ISREG(os.fstat(stream.fileno()).st_mode),
             "Selected file must be ordinary.")
        return stream.read()


def directory(path):
    path = Path(path)
    need(path.is_absolute() and ".." not in path.parts,
         "Use an absolute canonical receiving directory.")
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        try:
            current.mkdir(mode=0o700)
        except FileExistsError:
            pass
        need(stat.S_ISDIR(current.lstat().st_mode),
             "Receiving directory components must be ordinary directories.")
    return path


def relative(value):
    need(isinstance(value, str) and value and "\\" not in value
         and not any(ord(char) < 32 or ord(char) == 127 for char in value),
         "Source member name is invalid.")
    path = PurePosixPath(value)
    need(not path.is_absolute() and str(path) == value
         and all(part not in ("", ".", "..") for part in path.parts),
         "Source member must be a canonical relative path.")
    return path


def retain(path, body, executable=False):
    directory(path.parent)
    try:
        need(ordinary(path) == body, "Existing selected source differs: " + str(path))
        return "reused"
    except FileNotFoundError:
        pass
    temporary = path.parent / (".receiving-" + uuid.uuid4().hex)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o700 if executable else 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
            outcome = "written"
        except FileExistsError:
            need(ordinary(path) == body, "Concurrent selected source differs.")
            outcome = "reused"
        dfd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
        return outcome
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-envelope", required=True, type=Path)
    parser.add_argument("--directory", required=True, type=Path)
    args = parser.parse_args()
    need(args.source_envelope.is_absolute(), "Use an absolute source envelope path.")
    raw = ordinary(args.source_envelope)
    need(len(raw) == EXPECTED["bytes"] and digest(raw) == EXPECTED["sha256"],
         "Complete selected source envelope identity differs.")
    envelope = json.loads(raw)
    for field in ("schema", "repository", "sourceMerge"):
        need(envelope.get(field) == EXPECTED[field], "Source " + field + " differs.")
    need(envelope.get("release", {}).get("merge") == EXPECTED["releaseMerge"],
         "Selected merged product release differs.")
    rows = envelope.get("files")
    need(isinstance(rows, list) and len(rows) == EXPECTED["files"],
         "Complete source closure is required.")
    selected, seen, total = [], set(), 0
    for row in rows:
        name = str(relative(row["path"]))
        need(name not in seen, "Duplicate source member.")
        seen.add(name)
        need(isinstance(row.get("content"), str), "UTF-8 source content is required.")
        body = row["content"].encode("utf-8")
        need(len(body) == row["bytes"] and digest(body) == row["sha256"],
             "Source length or SHA256 differs: " + name)
        git_blob = hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest()
        need(git_blob == row["gitBlobSha"], "Original Git blob differs: " + name)
        need(row.get("mode") in ("100644", "100755"), "Unsupported source member mode.")
        selected.append((name, body, row["mode"] == "100755"))
        total += len(body)
    need(total == EXPECTED["sourceBytes"] == envelope["sourceBytes"]
         and len(selected) == envelope["sourceFiles"], "Source totals differ.")
    need(envelope["entry"] in seen and envelope["inputs"]["builder"] in seen
         and envelope["inputs"]["provenance"] in seen, "Native entry/input is absent.")
    root = directory(args.directory)
    counts = {"written": 0, "reused": 0}
    for name, body, executable in selected:
        counts[retain(root / name, body, executable)] += 1
    manifest = {
        "schema": "sf88.citation-review.source-materialization.v1",
        "sourceEnvelope": {"bytes": len(raw), "sha256": digest(raw)},
        "repository": envelope["repository"], "sourceBase": envelope["sourceMerge"],
        "release": envelope["release"], "overlays": envelope["overlays"],
        "directory": str(root), "entry": str(root / envelope["entry"]),
        "inputs": envelope["inputs"], "files": [
            {key: row[key] for key in ("path", "mode", "bytes", "sha256", "gitBlobSha")}
            for row in rows
        ],
        "sourceFiles": len(selected), "sourceBytes": total,
    }
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    manifest_path = root / ".citation-source-materialization.json"
    retain(manifest_path, manifest_bytes)
    for name, body, _ in selected:
        need(ordinary(root / name) == body, "Final source readback differs: " + name)
    print(json.dumps({
        "schema": manifest["schema"], "state": "COMPLETE", **counts,
        "sourceFiles": len(selected), "sourceBytes": total,
        "sourceEnvelopeSha256": digest(raw), "releaseMerge": EXPECTED["releaseMerge"],
        "directory": str(root), "entry": manifest["entry"],
        "manifest": str(manifest_path), "manifestSha256": digest(manifest_bytes),
    }, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"error": "CITATION_SOURCE_RECEIVING_FAILED", "message": str(error)}),
              file=sys.stderr)
        sys.exit(1)
