#!/usr/bin/env python3
"""Complete transfer inspection using the maintained preservation profile engines."""
from __future__ import annotations
import argparse
import csv
import html
import io
import json
from pathlib import Path
import preservation as p
import collection_accession as collection

SCHEMA = "stellar-forge.preservation-transfer-desk.v1"
MAX_REPORT = 64 * 1024 * 1024
PROFILES = {p.PROFILE: "research", collection.PROFILE: "collection"}

def need(value, message):
    if not value:
        raise p.PreservationError(message)

def profile(source):
    reader = p.BagReader(source)
    try:
        value = reader.json(p.DOC + "profile.json")
        kind = PROFILES.get(value.get("profile")) if isinstance(value, dict) else None
        need(kind is not None, "Select a complete supported research or original-file collection BagIt ZIP.")
        return kind
    finally:
        reader.close()

def original_rows(source, kind):
    reader = p.BagReader(source)
    try:
        value = reader.json(p.DOC + "mapping.json")
        rows = value["records"] if kind == "research" else value
        need(isinstance(rows, list), "The verified original mapping has no complete rows.")
        return rows
    finally:
        reader.close()

def row_id(row, kind):
    return row["identifier"] if kind == "research" else row["path"]

def view_row(row, kind):
    return {"id": row_id(row, kind), "included": row["include"],
            "title": row["reviewedDc"].get("title", []) if kind == "research" else row["fields"].get("title", []),
            "original": row}

def encoded(value):
    body = p.canonical(value)
    need(len(body) <= MAX_REPORT, "The complete transfer report exceeds the 64 MiB report limit.")
    return body

def inspect(source, identity):
    kind = profile(source)
    receipt = p.verify(source) if kind == "research" else collection.verify_bag(source)
    rows = original_rows(source, kind)
    result = {"schema": SCHEMA + ".inspection", "kind": kind, "package": identity,
              "verification": receipt, "rows": [view_row(row, kind) for row in rows],
              "summary": {"records": len(rows), "included": sum(row["include"] for row in rows),
                          "excluded": sum(not row["include"] for row in rows)},
              "note": "Verified bytes and recorded review choices do not establish institutional acceptance or preservation action."}
    encoded(result)
    return result

def compare(previous, current, previous_identity, current_identity):
    left_kind, right_kind = profile(previous), profile(current)
    need(left_kind == right_kind, "Compare two editions of the same preservation profile.")
    # The actual original engine verifies both complete packages and determines every change.
    compared = p.compare(previous, current) if left_kind == "research" else collection.compare(previous, current)
    left, right = original_rows(previous, left_kind), original_rows(current, left_kind)
    old = {row_id(row, left_kind): row for row in left}
    new = {row_id(row, left_kind): row for row in right}
    changed = {row_id(row, left_kind): row for row in compared["changes"]}
    rows = []
    for key in sorted(set(old) | set(new)):
        before, after = old.get(key), new.get(key)
        delta = changed.get(key)
        if delta:
            need(delta["before"] == before and delta["after"] == after,
                 "Original comparison rows differ from their verified mapping.")
        rows.append({"id": key, "changes": delta["changes"] if delta else [],
                     "before": before, "after": after})
    result = {"schema": SCHEMA + ".comparison", "kind": left_kind,
              "previousPackage": previous_identity, "currentPackage": current_identity,
              "originalComparison": compared, "rows": rows,
              "summary": {"previousRecords": len(left), "currentRecords": len(right),
                          "rows": len(rows), "changed": len(changed), "unchanged": len(rows)-len(changed)},
              "note": compared.get("receivingNote", compared.get("note"))}
    encoded(result)
    return result

def cell(value):
    if isinstance(value, (list, dict)):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True)
    value = str(value)
    # This human review CSV is distinct from the original import-ready BagIt metadata.
    return "'" + value if value[:1] in {"=", "+", "-", "@", "\t", "\r"} else value

def report_csv(report):
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\n")
    if report["schema"] == SCHEMA + ".inspection":
        writer.writerow(["original_identifier_or_path", "included", "title", "complete_original_row_json"])
        for row in report["rows"]:
            writer.writerow([cell(row["id"]), str(row["included"]).lower(), cell(row["title"]), cell(row["original"])])
    else:
        writer.writerow(["original_identifier_or_path", "changes", "complete_before_json", "complete_after_json"])
        for row in report["rows"]:
            writer.writerow([cell(row["id"]), cell(row["changes"]), cell(row["before"]), cell(row["after"])])
    return out.getvalue().encode("utf-8")

def report_html(report):
    e = lambda value: html.escape(str(value), quote=True)
    detail = lambda value: "<pre>" + e(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)) + "</pre>"
    comparison = report["schema"] == SCHEMA + ".comparison"
    heading = "Preservation transfer comparison" if comparison else "Preservation transfer inspection"
    selection = {key: value for key, value in report.items() if key != "rows"}
    parts = ['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
             "<title>" + heading + "</title>",
             "<style>body{font:16px/1.5 system-ui,sans-serif;color:#18232d;background:#fff;margin:0}main{max-width:1200px;margin:auto;padding:24px}h1{font-size:1.7rem}h2{font-size:1.2rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #cbd3db;padding:10px;vertical-align:top;text-align:left}th{background:#edf1f4}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 monospace}summary{cursor:pointer}.table{overflow:auto}td:first-child{overflow-wrap:anywhere;min-width:160px}@media(max-width:600px){main{padding:12px}td,th{padding:8px}}</style><main>",
             "<h1>" + heading + "</h1><p>" + e(report["note"]) + "</p><h2>Complete original selection</h2>",
             detail(selection), '<h2>Every original row</h2><div class="table"><table><thead><tr><th>Original identifier or path</th>',
             "<th>Changes</th><th>Previous complete row</th><th>Current complete row</th>" if comparison else "<th>Selection</th><th>Complete recorded row</th>",
             "</tr></thead><tbody>"]
    for row in report["rows"]:
        parts.append("<tr><td>" + e(row["id"]) + "</td>")
        if comparison:
            parts.extend(["<td>" + e(", ".join(row["changes"]) or "UNCHANGED") + "</td>",
                          "<td>" + detail(row["before"]) + "</td><td>" + detail(row["after"]) + "</td>"])
        else:
            parts.extend(["<td>" + ("Included" if row["included"] else "Excluded") + "</td><td>" + detail(row["original"]) + "</td>"])
        parts.append("</tr>")
    parts.append("</tbody></table></div></main></html>")
    body = "".join(parts).encode("utf-8")
    need(len(body) <= MAX_REPORT, "The complete readable transfer report exceeds 64 MiB.")
    return body

def page(report, *, offset=0, query="", changed_only=False):
    need(report.get("schema") in {SCHEMA+".inspection", SCHEMA+".comparison"}, "Choose a retained transfer report.")
    need(type(offset) is int and offset >= 0 and isinstance(query, str) and len(query) <= 500,
         "Use a nonnegative page offset and a bounded search value.")
    comparison = report["schema"].endswith(".comparison")
    query = query.casefold()
    rows = [row for row in report["rows"] if (not changed_only or not comparison or row["changes"])
            and (not query or query in json.dumps(row, ensure_ascii=False).casefold())]
    offset = min(offset, max(0, ((len(rows)-1)//50)*50))
    return {"schema": report["schema"], "kind": report["kind"], "summary": report["summary"],
            "note": report["note"], "selection": {key: report[key] for key in
                ("package", "previousPackage", "currentPackage", "verification") if key in report},
            "offset": offset, "total": len(rows), "rows": rows[offset:offset+50]}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    one = sub.add_parser("inspect")
    one.add_argument("--source", required=True)
    two = sub.add_parser("compare")
    two.add_argument("--previous", required=True); two.add_argument("--current", required=True)
    args = parser.parse_args(argv)
    def identity(filename):
        path = Path(filename)
        need(not path.is_symlink() and path.is_file(), "Select the complete original regular ZIP.")
        # CLI is an observation: it does not retain or alter the selected package.
        import hashlib
        before = path.stat(); digest = hashlib.sha256(); size = 0
        with path.open("rb") as stream:
            for body in iter(lambda: stream.read(1024*1024), b""):
                size += len(body); digest.update(body)
                need(size <= p.MAX_TOTAL, "Package exceeds the 2 GiB profile limit.")
        after = path.stat()
        need((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns) ==
             (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns), "Selected package changed.")
        return {"name": path.name, "bytes": size, "sha256": digest.hexdigest()}
    names = [args.source] if args.command == "inspect" else [args.previous,args.current]
    identities = [identity(name) for name in names]
    result = inspect(names[0],identities[0]) if len(names)==1 else compare(*names,*identities)
    need([identity(name) for name in names] == identities, "The selected packages changed during inspection.")
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (p.PreservationError, OSError, ValueError, KeyError) as error:
        print(json.dumps({"error":type(error).__name__,"message":str(error)}), file=__import__("sys").stderr)
        raise SystemExit(2)
