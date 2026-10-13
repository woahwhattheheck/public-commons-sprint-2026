#!/usr/bin/env python3
"""Inspect original SF47 Installation archives; the original importer owns validation and writes."""
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

SCHEMA = "stellar-forge.flowable-installation-complete-receiving.v1"
def need(value, message):
    if not value:
        raise ValueError(message)

def read(path, maximum):
    path = Path(path)
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
         not (before.st_mode & 0o077) and before.st_size <= maximum,
         "Select the complete private original regular file")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        opened = os.fstat(fd)
        need((opened.st_dev, opened.st_ino) == (before.st_dev, before.st_ino),
             "The original file selection changed")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            raw = stream.read(maximum + 1)
        after = os.fstat(fd)
        signature = lambda x: (x.st_dev, x.st_ino, x.st_size, x.st_mtime_ns, x.st_ctime_ns)
        need(signature(before) == signature(after) and len(raw) == before.st_size,
             "The selected complete file changed while reading")
        return raw
    finally:
        os.close(fd)

def identity(raw):
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}

def selected(document, files, expected, case_id):
    need(document["program"]["id"] == case_id, "The archive belongs to another original case")
    actual = installations.selection_from_files(document, files)
    need(actual == expected["installation"], "The archive selected another Installation edition")
    row = next(x for x in document["installations"]
               if x["id"] == actual["id"] and x["revision"] == actual["revision"])
    need(row["preview"]["document"] == expected["document"],
         "The complete original Installation document differs")
    following = expected.get("following")
    if following is not None:
        need(isinstance(following, dict) and set(following) == {"baseline", "current"},
             "Retain the complete original following Installation selection")
        current = following["current"]
        for label in ("baseline", "current"):
            reference = following[label]
            need(isinstance(reference, dict) and set(reference) == {"id", "revision", "sha256"}
                 and reference["id"] == actual["id"], "Keep one original Installation history")
            historical = next((r for r in document["installations"]
                               if r["id"] == reference["id"] and r["revision"] == reference["revision"]), None)
            need(historical is not None and historical["sha256"] == reference["sha256"],
                 "The complete case lost its exact " + label + " Installation edition")
        need(current["revision"] + 1 == actual["revision"] and
             following["baseline"]["revision"] <= current["revision"] and
             row["preview"]["previous"] == current,
             "The selected following edition must append to its original current Installation")
    for source in expected["sources"]:
        body = files.get("sources/" + source["id"])
        need(body is not None and identity(body) == {"bytes": source["bytes"], "sha256": source["sha256"]},
             "The complete original selected source differs: " + source["id"])
    return actual

def compare(original, original_files, received, received_files):
    # The native importer intentionally gives the receiving case and plan new IDs.
    # Immutable original event and source identities remain unchanged.
    events, later = original["events"], received["events"]
    need(len(later) >= len(events) and later[:len(events)] == events,
         "The receiving case lost or changed original native history")
    sources = {x["id"]: x for x in received["sources"]}
    for item in original["sources"]:
        need(sources.get(item["id"]) == item, "An original case source identity changed")
        name = "sources/" + item["id"]
        need(received_files.get(name) == original_files.get(name),
             "An original complete case source changed")
    # These are native immutable saved editions; later editions are allowed.
    totals = {}
    for key in ("reviews", "installations", "forecasts", "portfolios", "completionPlans",
                "amendments", "workIntakes"):
        before = original.get(key, [])
        after = received.get(key, [])
        if not isinstance(before, list):
            continue
        need(isinstance(after, list), "A native saved-edition collection is missing: " + key)
        for row in before:
            need(row in after, "An original native saved edition changed: " + key)
        totals[key] = {"original": len(before), "received": len(after)}
    changes = []
    for kind, rows in original["records"].items():
        later_rows = {x["id"]: x for x in received["records"][kind]}
        for row in rows:
            current = later_rows.get(row["id"])
            need(current is not None, "The receiving case lost an original native record")
            if current != row:
                need(len(later) > len(events), "A native record changed without later case history")
                changes.append({"kind": kind, "id": row["id"], "originalVersion": row.get("version"),
                                "receivedVersion": current.get("version")})
    return {"originalEvents": len(events), "receivedEvents": len(later),
            "originalSources": len(original["sources"]), "receivedSources": len(received["sources"]),
            "savedEditions": totals, "laterRecordChanges": changes}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--received", type=Path)
    parser.add_argument("--received-case")
    args = parser.parse_args()
    need(bool(args.received) == bool(args.received_case), "Select both receiving archive and native case identity")
    raw = read(args.archive, 320 * 1024 * 1024)
    expected = json.loads(read(args.selection, 8 * 1024 * 1024))
    need(expected.get("schema") == SCHEMA + ".archive-selection", "Use the original complete Flowable Installation selection")
    document, files = Operations._unpack(raw)
    installation = selected(document, files, expected, expected["caseId"])
    result = {"schema": SCHEMA + ".archive-inspection", "archive": identity(raw),
              "caseId": expected["caseId"], "installation": installation,
              "sources": expected["sources"], "completeOriginalArchiveVerified": True}
    if args.received:
        received_raw = read(args.received, 320 * 1024 * 1024)
        received, received_files = Operations._unpack(received_raw)
        selected(received, received_files, expected, args.received_case)
        result.update({"received": identity(received_raw), "receivedCaseId": args.received_case,
                       "history": compare(document, files, received, received_files)})
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
