#!/usr/bin/env python3
"""Capture one bounded official WQP source edition; never infer measurements.

The immutable query and successful original response bytes are retained together.
A failed endpoint remains an explicit failed attempt and prevents completion.
"""
from __future__ import annotations
import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import urllib.error
import urllib.parse
import urllib.request

SCHEMA = "upstate.wqp-source-capture/v1"
KINDS = ("Station", "Activity", "Result", "ResultDetectionQuantitationLimit")
MAX_BYTES = 128 * 1024 * 1024
BASE = "https://www.waterqualitydata.us/data/"

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

def ordinary_directory(value):
    directory = Path(value).absolute()
    for parent in [*reversed(directory.parents), directory]:
        if parent.is_symlink():
            raise ValueError("Use ordinary source directories, not symlinks")
    directory.mkdir(parents=True, exist_ok=True)
    if not directory.is_dir():
        raise ValueError("Source destination is not a directory")
    return directory

def retain(path, raw):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Retained source cannot be a symlink")
    if path.exists():
        if not path.is_file() or path.read_bytes() != raw:
            raise ValueError("Existing source differs: " + str(path))
        return
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".wqp-", delete=False) as handle:
            pending = Path(handle.name)
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(pending, path)
        except FileExistsError:
            if path.is_symlink() or path.read_bytes() != raw:
                raise ValueError("Concurrent source differs: " + str(path))
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)
        if os.name != "nt":
            fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)

def csv_rows(raw):
    text = raw.decode("utf-8-sig", errors="strict")
    if "\x00" in text or text.lstrip().lower().startswith(("<html", "<!doctype")):
        raise ValueError("Expected original UTF-8 CSV, not a provider error page")
    reader = csv.reader(io.StringIO(text, newline=""), strict=True)
    headers = next(reader, None)
    if not headers or any(not h for h in headers) or len(set(headers)) != len(headers):
        raise ValueError("Original CSV headers are missing or duplicated")
    count = 0
    for row in reader:
        if not row:
            continue
        if len(row) != len(headers):
            raise ValueError("Original CSV row has a different field count")
        count += 1
    return headers, count

def capture(destination, station, start, end):
    start_day, end_day = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    if start_day > end_day or not station or any(c.isspace() for c in station):
        raise ValueError("Choose one exact station and an ordered original date range")
    root = ordinary_directory(destination)
    query = {"schema": SCHEMA, "station_id": station, "from": start, "to": end,
             "profile": "WQX2.2", "data_profiles": {"Result": "resultPhysChem", "Activity": "activityAll"}, "publisher": "https://www.waterqualitydata.us/",
             "interpretation": "Original observations only; no annualization or native model output."}
    existing = set(root.iterdir())
    if existing and root / "query.json" not in existing:
        raise ValueError("Refuse a nonempty unbound source directory")
    retain(root / "query.json", json_bytes(query))
    if (root / "capture.json").exists():
        saved = json.loads((root / "capture.json").read_text())
        if saved.get("schema") != SCHEMA or saved.get("query") != query or saved.get("state") != "complete" or len(saved.get("files", [])) != len(KINDS) or {f.get("kind") for f in saved["files"]} != set(KINDS):
            raise ValueError("Existing capture binding differs")
        for file in saved["files"]:
            if file.get('kind') not in KINDS or file.get('path') != file['kind'].lower() + '.csv' or (root / file['path']).is_symlink():
                raise ValueError('Retained original response path differs')
            raw = (root / file["path"]).read_bytes()
            if len(raw) != file["bytes"] or sha(raw) != file["sha256"]:
                raise ValueError("An original response changed")
        return saved
    files = []
    for kind in KINDS:
        name = kind.lower() + ".csv"
        response_path = root / (kind.lower() + "-response.json")
        if response_path.exists():
            if response_path.is_symlink() or (root / name).is_symlink():
                raise ValueError('Retained response cannot be a symlink')
            descriptor = json.loads(response_path.read_text())
            raw = (root / name).read_bytes()
            if descriptor.get("kind") != kind or descriptor.get("path") != name or len(raw) != descriptor["bytes"] or sha(raw) != descriptor["sha256"]:
                raise ValueError("Retained response binding differs")
            files.append(descriptor)
            continue
        params = {"siteid": station, "mimeType": "csv", "zip": "no"}
        if kind in query["data_profiles"]:
            params["dataProfile"] = query["data_profiles"][kind]
        if kind != "Station":
            params.update(startDateLo=start_day.strftime("%m-%d-%Y"), startDateHi=end_day.strftime("%m-%d-%Y"))
        url = BASE + kind + "/search?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers={"Accept": "text/csv", "User-Agent": "TJLabs-Upstate-Official-Source-Capture/1"})
        started = utc()
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                final_url = response.geturl()
                parsed = urllib.parse.urlsplit(final_url)
                if parsed.scheme != "https" or parsed.hostname not in ("www.waterqualitydata.us", "waterqualitydata.us"):
                    raise ValueError("Provider redirected outside the original WQP service")
                raw = response.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise ValueError("Complete provider response exceeds the declared 128 MiB per-file limit")
                headers, rows = csv_rows(raw)
                descriptor = {"kind": kind, "path": name, "bytes": len(raw), "sha256": sha(raw),
                              "requested_url": url, "response_url": final_url,
                              "started_at": started, "retrieved_at": utc(), "status": response.status,
                              "response_headers": dict(response.headers.items()), "columns": headers,
                              "rows": rows, "empty": rows == 0}
        except Exception as error:
            failure = {"schema": SCHEMA, "state": "failed", "kind": kind, "url": url,
                       "started_at": started, "finished_at": utc(), "error": str(error)}
            if isinstance(error, urllib.error.HTTPError):
                body = error.read(MAX_BYTES + 1)
                failure.update(status=error.code, response_headers=dict(error.headers.items()),
                               response_body_bytes=len(body), response_body_sha256=sha(body))
                retain(root / (kind.lower() + "-http-error-" + sha(body)[:16] + ".bin"), body)
            retain(root / (kind.lower() + "-failure-" + sha(json_bytes(failure))[:16] + ".json"), json_bytes(failure))
            raise
        retain(root / name, raw)
        retain(response_path, json_bytes(descriptor))
        files.append(descriptor)
        print(json.dumps({"captured": kind, "bytes": descriptor["bytes"], "rows": descriptor["rows"], "sha256": descriptor["sha256"]}), flush=True)
    document = {"schema": SCHEMA, "state": "complete", "query": query,
                "completed_at": utc(), "files": files}
    retain(root / "capture.json", json_bytes(document))
    return document

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--station", required=True)
    parser.add_argument("--from-date", required=True)
    parser.add_argument("--to-date", required=True)
    args = parser.parse_args()
    print(json.dumps(capture(args.output, args.station, args.from_date, args.to_date), indent=2))

if __name__ == "__main__":
    main()
