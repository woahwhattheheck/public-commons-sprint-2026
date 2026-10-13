#!/usr/bin/env python3
"""Acquire a complete explicitly selected public CEDEN Safe-to-Swim API cohort.

Retains original JSON response bytes, API field order, original source IDs and
a CSV representation for the existing scientific observation importer. A retry
uses the same retained pages and refuses a changed total or field layout.
"""
import argparse
import csv
import datetime as dt
from decimal import Decimal
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

RESOURCE = "15a63495-8d9f-4a49-b43a-3092ef3106b9"
API = "https://publish.data.ca.gov/api/3/action/datastore_search"

def raw_sha(body):
    return hashlib.sha256(body).hexdigest()

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()

def write_once(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != body:
            raise RuntimeError("Original retained acquisition changed: " + str(path))
        return
    # Publish only a complete body. A stopped writer leaves a temporary file,
    # never an immutable final page that prevents continuation.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix="." + path.name + ".", suffix=".pending",
                                         dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != body:
                raise RuntimeError("Original retained acquisition changed: " + str(path))
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

def request_url(filters, offset, limit):
    return API + "?" + urllib.parse.urlencode({
        "resource_id": RESOURCE, "filters": json.dumps(filters, sort_keys=True, separators=(",", ":")),
        "sort": "_id asc", "offset": str(offset), "limit": str(limit)})

def get(url):
    # Recovery follows this public provider's response, never another account.
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "GWMA-Study-Source-Intake/1.0"})
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read(), {"status": response.status,
                       "content_type": response.headers.get("Content-Type"),
                       "etag": response.headers.get("ETag"), "last_modified": response.headers.get("Last-Modified")}
        except urllib.error.HTTPError as error:
            retry = error.headers.get("Retry-After", "")
            if error.code not in (429, 502, 503, 504) or attempt == 2:
                raise
            seconds = int(retry) if retry.isdigit() else 2 ** attempt
            if seconds > 60:
                raise RuntimeError("Provider requests later continuation after " + str(seconds) + " seconds") from error
            time.sleep(seconds)
    raise RuntimeError("Public source request did not complete")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--filters", required=True, help="Exact JSON field-value filters for the whole selected cohort")
    parser.add_argument("--page-size", type=int, default=1000)
    args = parser.parse_args()
    filters = json.loads(args.filters)
    if not isinstance(filters, dict) or not filters or any(not isinstance(k, str) or not isinstance(v, (str, int))
                                                        for k, v in filters.items()):
        parser.error("--filters requires a nonempty exact field/value object")
    if not 1 <= args.page_size <= 5000:
        parser.error("Provider page size must be between 1 and 5000; every page in the cohort is retained")
    root = Path(args.output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    specification = {"schema": "gwma.public-source-acquisition/v1", "resource_id": RESOURCE,
                     "api": API, "filters": filters, "sort": "_id asc", "page_size": args.page_size}
    write_once(root / "acquisition.json", json_bytes(specification))
    offset, total, fields, previous_id = 0, None, None, None
    all_rows, pages, source_ids = [], [], set()
    while total is None or offset < total:
        url = request_url(filters, offset, args.page_size)
        stem = "page-" + str(offset).zfill(10)
        body_path, receipt_path = root / "raw" / (stem + ".json"), root / "raw" / (stem + ".receipt.json")
        if receipt_path.exists():
            receipt = json.loads(receipt_path.read_text())
            body = body_path.read_bytes()
            if receipt["url"] != url or receipt["sha256"] != raw_sha(body) or receipt["bytes"] != len(body):
                raise RuntimeError("Retained source response identity changed")
        else:
            if body_path.exists():
                # A response without its receipt is reconciled locally, retaining
                # those original bytes instead of replaying an uncertain network read.
                body = body_path.read_bytes()
                transport = {"status": None, "receipt_reconciled_from_retained_body": True}
            else:
                body, transport = get(url)
                write_once(body_path, body)
            receipt = {"url": url, "retrieved_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                       "bytes": len(body), "sha256": raw_sha(body), **transport}
            write_once(receipt_path, json_bytes(receipt))
        document = json.loads(body, parse_float=Decimal)
        if document.get("success") is not True:
            raise RuntimeError("Public API did not return a successful original source page")
        result = document["result"]
        current_fields = [field["id"] for field in result["fields"]]
        current_total = int(result["total"])
        if total is None:
            fields, total = current_fields, current_total
            if not total:
                raise RuntimeError("The exact public source selection contains no observations")
            if "_id" not in fields or len(fields) != len(set(fields)):
                raise RuntimeError("The source does not provide distinct fields and original API row IDs")
        elif total != current_total or fields != current_fields:
            raise RuntimeError("Public cohort changed during capture; retained pages remain for explicit continuation")
        rows = result["records"]
        if not rows or len(rows) > args.page_size or offset + len(rows) > total:
            raise RuntimeError("The provider page does not close the stated cohort")
        for row in rows:
            if set(row) != set(fields):
                raise RuntimeError("An original provider row differs from its declared field layout")
            key = row["_id"]
            if not isinstance(key, int) or key in source_ids or (previous_id is not None and key <= previous_id):
                raise RuntimeError("Original API row order or uniqueness changed")
            source_ids.add(key)
            previous_id = key
            all_rows.append(row)
        pages.append({"offset": offset, "count": len(rows), "total": total,
                      "path": body_path.relative_to(root).as_posix(), **receipt})
        offset += len(rows)
        print(json.dumps({"retained_rows": offset, "cohort_total": total, "page_sha256": receipt["sha256"]}), flush=True)
    # Decimal preserves numeric token precision in the API's original JSON.
    # Null maps to an empty CSV cell; nested values remain explicit JSON strings.
    def cell(value):
        if value is None:
            return ""
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
        return str(value)
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows({key: cell(value) for key, value in row.items()} for row in all_rows)
    csv_body = output.getvalue().encode("utf-8")
    csv_path = root / "safe-to-swim-cohort.csv"
    write_once(csv_path, csv_body)
    final = {**specification, "status": "COMPLETE", "rows": total, "fields": fields, "pages": pages,
             "capture_started_at": pages[0]["retrieved_at"], "capture_ended_at": pages[-1]["retrieved_at"],
             "source_id_min": min(source_ids), "source_id_max": max(source_ids),
             "csv": {"path": csv_path.name, "bytes": len(csv_body), "sha256": raw_sha(csv_body),
                     "representation": "Derived CSV in the original API field order; all original JSON response bytes retained",
                     "null_policy": "Empty CSV cells; original JSON preserves null separately",
                     "numeric_policy": "Decimal lexical representation from original JSON numeric tokens"},
             "scope": "Every record in the stated exact source filter captured across the listed provider pages"}
    write_once(root / "cohort.json", json_bytes(final))
    entries = [{"id": "cohort-csv", "kind": "table", "path": csv_path.name,
                "uri": request_url(filters, 0, args.page_size),
                "title": "Complete selected California Safe-to-Swim API cohort",
                "vintage": final["capture_ended_at"], "sha256": raw_sha(csv_body)}]
    for path in sorted(root.rglob("*.json")):
        if path.name == "source-manifest.json":
            continue
        relative = path.relative_to(root).as_posix()
        entries.append({"id": "source-" + hashlib.sha256(relative.encode()).hexdigest()[:20],
                        "kind": "document", "path": relative,
                        "uri": request_url(filters, 0, args.page_size) + "#" + relative, "title": relative,
                        "vintage": final["capture_ended_at"], "sha256": raw_sha(path.read_bytes())})
    source_manifest = {"schema": "upstate.sources/v1",
                       "title": "Original California Safe-to-Swim cohort source and API pages",
                       "captured_at": final["capture_ended_at"],
                       "scope": {"source": API, "resource_id": RESOURCE, "filters": filters, "rows": total},
                       "entries": entries}
    write_once(root / "source-manifest.json", json_bytes(source_manifest))
    print(json.dumps({"status": "COMPLETE", "root": str(root), "rows": total, "pages": len(pages),
                      "csv": final["csv"], "source_manifest": str(root / "source-manifest.json")}, indent=2))

if __name__ == "__main__":
    main()
