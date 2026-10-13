#!/usr/bin/env python3
"""Verify an actual original Installation export before independent case import."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROOT = Path(__file__).resolve().parents[2] / "sf47_budget_model" / "workspace"
sys.path.insert(0, str(ROOT))
from operations import Operations
import operations_installations as installations

def need(value, message):
    if not value:
        raise ValueError(message)

def read(path, maximum):
    path = Path(path)
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
         not (before.st_mode & 0o077) and before.st_size <= maximum,
         "Select the complete private original regular file")
    handle = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        opened = os.fstat(handle)
        need((opened.st_dev, opened.st_ino) == (before.st_dev, before.st_ino),
             "The original file selection changed")
        with os.fdopen(handle, "rb", closefd=False) as stream:
            raw = stream.read(maximum + 1)
        after = os.fstat(handle)
        signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        need(signature(before) == signature(after) and len(raw) == before.st_size,
             "The complete selected file changed while reading")
        return raw
    finally:
        os.close(handle)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    args = parser.parse_args()
    raw = read(args.archive, 320 * 1024 * 1024)
    expected = json.loads(read(args.selection, 8 * 1024 * 1024))
    need(expected.get("schema") == "stellar-forge.dcat-installation-archive-selection.v1",
         "Use the original complete DCAT Installation selection")
    document, files = Operations._unpack(raw)
    selected = installations.selection_from_files(document, files)
    need(document["program"]["id"] == expected["caseId"] and
         selected == expected["installation"],
         "The original archive belongs to another case or selected Installation")
    actual = next(row for row in document["installations"]
                  if row["id"] == selected["id"] and row["revision"] == selected["revision"])
    need(actual["preview"]["document"] == expected["document"],
         "The selected original Installation document differs")
    sources = []
    for source in expected["sources"]:
        body = files.get("sources/" + source["id"])
        need(body is not None and len(body) == source["bytes"] and
             hashlib.sha256(body).hexdigest() == source["sha256"],
             "The complete original source differs: " + source["id"])
        sources.append(source)
    print(json.dumps({
        "schema": "stellar-forge.dcat-installation-archive-inspection.v1",
        "archive": {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()},
        "caseId": document["program"]["id"], "installation": selected,
        "sources": sources, "completeOriginalArchiveVerified": True
    }, ensure_ascii=False, allow_nan=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
