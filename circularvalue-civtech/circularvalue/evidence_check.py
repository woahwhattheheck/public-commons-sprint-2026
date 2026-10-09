"""Compare explicitly retained local files with evidence hashes; never fetch URLs."""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import stat
import sys
from typing import Any

from .core import CircularValueError, canonical_json, compile_case, digest_json
from .intake import read_object, write_new

MAX_EVIDENCE_BYTES = 64 * 1024 * 1024


def _parts(relative: str) -> list[str]:
    if not relative or "\\" in relative or "\0" in relative:
        raise CircularValueError("unsafe relative path")
    parts = relative.split("/")
    if any(part in ("", ".", "..") for part in parts) or ":" in parts[0]:
        raise CircularValueError("unsafe relative path")
    return parts


def _hash_beneath(root_fd: int, relative: str) -> tuple[str, str | None, int | None]:
    """Use descriptor-relative opens so symlink substitution cannot escape root."""
    directory = os.dup(root_fd)
    try:
        parts = _parts(relative)
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode):
                return "unsafe_or_unreadable", None, None
            if before.st_size > MAX_EVIDENCE_BYTES:
                return "oversized", None, None
            digest = hashlib.sha256()
            total = 0
            while total <= MAX_EVIDENCE_BYTES:
                chunk = os.read(fd, min(65536, MAX_EVIDENCE_BYTES + 1 - total))
                if not chunk:
                    break
                total += len(chunk)
                digest.update(chunk)
            if total > MAX_EVIDENCE_BYTES:
                return "oversized", None, None
            after = os.fstat(fd)
            if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_size, after.st_mtime_ns, after.st_ctime_ns
            ) or total != after.st_size:
                return "changed_during_read", None, None
            return "read", digest.hexdigest(), total
        finally:
            os.close(fd)
    except FileNotFoundError:
        return "missing", None, None
    except (OSError, CircularValueError):
        return "unsafe_or_unreadable", None, None
    finally:
        os.close(directory)


def audit_evidence(case: dict[str, Any], root: Path, mapping: dict[str, str]) -> dict[str, Any]:
    """Return a case/mapping-bound report, including every unmapped evidence ID.

    ``mapping`` explicitly maps evidence IDs to slash-separated relative files.
    Case locators are informational and never interpreted as paths or fetched.
    This POSIX implementation refuses unsupported no-follow/openat primitives.
    """
    packet = compile_case(case)
    evidence_ids = {row["id"] for row in case["evidence"]}
    if type(mapping) is not dict or any(type(k) is not str or type(v) is not str for k, v in mapping.items()):
        raise CircularValueError("mapping must be an object of evidence IDs to relative path strings")
    if set(mapping) - evidence_ids:
        raise CircularValueError("mapping contains unknown evidence IDs")
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY") or os.open not in os.supports_dir_fd:
        raise CircularValueError("evidence verification requires POSIX no-follow descriptor-relative file access")
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    results = []
    try:
        for evidence in sorted(case["evidence"], key=lambda row: row["id"]):
            eid = evidence["id"]
            actual, size = None, None
            status = "unmapped"
            if eid in mapping:
                status, actual, size = _hash_beneath(root_fd, mapping[eid])
                if status == "read":
                    status = "matched" if actual == evidence["sha256"] else "mismatch"
            results.append({
                "evidenceId": eid, "status": status,
                "expectedSha256": evidence["sha256"], "actualSha256": actual, "bytes": size,
            })
    finally:
        os.close(root_fd)
    report = {
        "schema": "circularvalue.evidence-check/v1",
        "sourceCaseSha256": packet["sourceCaseSha256"],
        "mappingSha256": digest_json(mapping),
        "allMatched": all(row["status"] == "matched" for row in results),
        "results": results,
        "limits": {"maxFileBytes": MAX_EVIDENCE_BYTES},
        "sourceAuthenticated": False,
        "note": "Byte matches only; no source authenticity, factual accuracy, freshness, or financial conclusion is established.",
    }
    return {**report, "reportSha256": digest_json(report)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case", type=Path)
    parser.add_argument("mapping", type=Path, help="JSON object mapping evidence IDs to relative files")
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        report = audit_evidence(read_object(args.case), args.root, read_object(args.mapping))
        write_new(args.out, canonical_json(report) + "\n")
        matched = sum(row["status"] == "matched" for row in report["results"])
        print(f"MATCHED {matched}/{len(report['results'])} {report['reportSha256']}")
        return 0 if report["allMatched"] else 1
    except (OSError, CircularValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
