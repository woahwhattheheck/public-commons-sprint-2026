#!/usr/bin/env python3
"""Read explicitly supplied config files as data; never import or execute them."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from typing import Any

MAX_BYTES = 1_048_576
MAX_FILES = 64
KNOWN_RISK_BLOBS = {
    "7da565bcb57517fa1c3adc1c824b7e105dae2699":
        "sampled-eslint-config-08a2d1d-remote-loader",
}
HEX_LITERAL = re.compile(r"['\"][0-9a-fA-F]{6,}['\"]")
DYNAMIC = re.compile(r"\beval\s*\(|\bspawn\s*\(|(?:node:)?child_process")
MIN_LONG_LINE = 2_000
MIN_ENCODED_LITERALS = 16
LIMITATION = (
    "Selected static patterns only. NO_MATCH is not a security clearance. "
    "Comments and string literals can trigger REVIEW. No finding is executed, "
    "decoded, followed over a network, or automatically removed."
)


def git_blob_sha1(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def inspect_bytes(data: bytes, path: str) -> dict[str, Any]:
    if len(data) > MAX_BYTES:
        raise ValueError("input exceeds 1 MiB")
    digest = git_blob_sha1(data)
    findings: list[dict[str, Any]] = []
    known = KNOWN_RISK_BLOBS.get(digest)
    if known:
        findings.append({"code": "KNOWN_RISK_BLOB", "reference": known})
    text = data.decode("utf-8")
    if "\0" in text:
        raise ValueError("input is not a UTF-8 text configuration")
    for number, line in enumerate(text.splitlines(), 1):
        if len(line) < MIN_LONG_LINE:
            continue
        encoded = len(HEX_LITERAL.findall(line))
        dynamic = bool(DYNAMIC.search(line))
        if encoded >= MIN_ENCODED_LITERALS and dynamic:
            findings.append({
                "code": "LONG_ENCODED_DYNAMIC_LINE", "line": number,
                "characters": len(line), "encoded_literal_count": encoded,
            })
    state = "KNOWN_RISK" if known else "REVIEW" if findings else "NO_MATCH"
    return {"path": path, "bytes": len(data), "git_blob_sha1": digest,
            "sha256": hashlib.sha256(data).hexdigest(), "state": state,
            "findings": findings}


def inspect_file(path: str) -> dict[str, Any]:
    # Refuse special files and final-component symlinks; no imported repo code.
    target = Path(path)
    initial = target.lstat()
    if stat.S_ISLNK(initial.st_mode):
        raise ValueError("symbolic-link input is not inspected")
    if not stat.S_ISREG(initial.st_mode):
        raise ValueError("input must be a regular file")
    flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(target, flags)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("input must be a regular file")
        if info.st_size > MAX_BYTES:
            raise ValueError("input exceeds 1 MiB")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            return inspect_bytes(stream.read(MAX_BYTES + 1), path)
    finally:
        os.close(descriptor)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", help="explicit UTF-8 source files, not executables to run")
    args = parser.parse_args(argv)
    if len(args.paths) > MAX_FILES:
        parser.error(f"at most {MAX_FILES} explicit files are allowed")
    reports = []
    status = 0
    for path in args.paths:
        try:
            item = inspect_file(path)
            status = max(status, 1 if item["state"] != "NO_MATCH" else 0)
        except (OSError, ValueError, UnicodeError) as exc:
            item = {"path": path, "state": "ERROR", "error_type": type(exc).__name__,
                    "message": str(exc)[:250]}
            status = 2
        reports.append(item)
    state = "ERROR" if status == 2 else "REVIEW_REQUIRED" if status == 1 else "NO_MATCH"
    print(json.dumps({"schema": 1, "state": state, "files": reports,
                      "limitation": LIMITATION}, indent=2, sort_keys=True))
    return status


if __name__ == "__main__":
    sys.exit(main())
