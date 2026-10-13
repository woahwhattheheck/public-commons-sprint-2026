#!/usr/bin/env python3
"""Read the exact original Operations archive selection before its native import."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

OPERATIONS_ROOT = Path(__file__).resolve().parents[2] / "sf47_budget_model/workspace"
sys.path.insert(0, str(OPERATIONS_ROOT))
from operations import Operations
import operations_installations as installations

def need(value, message):
    if not value: raise ValueError(message)
def read(path, maximum):
    path = Path(path)
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= maximum,
         "Select a complete regular original archive or selection file")
    with path.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        need((before.st_dev, before.st_ino) == (opened.st_dev, opened.st_ino), "The original selected file changed")
        raw = stream.read(maximum + 1)
        final = os.fstat(stream.fileno())
    after = path.lstat()
    signature = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
    need(signature(before) == signature(final) == signature(after) and len(raw) == before.st_size,
         "The original selected file changed during its complete read")
    return raw
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    args = parser.parse_args()
    raw = read(args.archive, 32*1024*1024)
    expected = json.loads(read(args.selection, 8*1024*1024))
    need(expected.get("schema") == "stellar-forge.municipal-installation-archive-selection.v1",
         "Use the retained original municipal Installation selection")
    document, files = Operations._unpack(raw)
    selected = installations.selection_from_files(document, files)
    need(document["program"]["id"] == expected["caseId"] and selected == expected["installation"],
         "The complete archive belongs to a different original case or saved Installation")
    actual = next(row for row in document["installations"]
                  if row["id"] == selected["id"] and row["revision"] == selected["revision"])
    need(actual["preview"]["document"] == expected["document"],
         "The complete archive changed the selected original Installation document")
    sources = []
    for source in expected["sources"]:
        body = files.get("sources/"+source["id"])
        need(body is not None and len(body) == source["bytes"] and
             hashlib.sha256(body).hexdigest() == source["sha256"],
             "The complete archive changed an original selected source: "+source["id"])
        sources.append(source)
    print(json.dumps({"schema":"stellar-forge.municipal-installation-archive-receiving.v1",
        "archive":{"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()},
        "caseId":document["program"]["id"],"installation":selected,"sources":sources},
        ensure_ascii=False, allow_nan=False))
if __name__ == "__main__":
    try: main()
    except Exception as error:
        print(str(error), file=sys.stderr); raise SystemExit(1)
