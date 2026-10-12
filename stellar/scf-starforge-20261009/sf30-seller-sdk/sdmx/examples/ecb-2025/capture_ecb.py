#!/usr/bin/env python3
"""Capture one public ECB source edition, or verify these retained original bytes."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://data-api.ecb.europa.eu/service/"
STRUCTURE = "application/vnd.sdmx.structure+xml;version=2.1"
GENERIC = "application/vnd.sdmx.genericdata+xml;version=2.1"
SPECIFIC = "application/vnd.sdmx.structurespecificdata+xml;version=2.1"
QUERY = "data/ECB,EXR,1.0/A+D+M+Q.GBP+USD.EUR.SP00.A?startPeriod=2025-01-01&endPeriod=2025-12-31&detail=full"
REQUESTS = [
    ("ecb-dataflows.xml", BASE + "dataflow/ECB/all/latest?detail=allstubs&references=none", STRUCTURE),
    ("ecb-exr-dataflow.xml", BASE + "dataflow/ECB/EXR/latest?references=all", STRUCTURE),
    ("ecb-exr-dsd.xml", BASE + "datastructure/ECB/ECB_EXR1/1.0?references=none", STRUCTURE),
    ("ecb-frequency-codelist.xml", BASE + "codelist/ECB/CL_FREQ/1.0?references=none", STRUCTURE),
    ("ecb-exr-2025-generic.xml", BASE + QUERY, GENERIC),
    ("ecb-exr-2025-specific.xml", BASE + QUERY, SPECIFIC),
    ("ecb-exr-2025.csv", BASE + QUERY, "text/csv"),
    ("ecb-exr-selected-series.xml", BASE + QUERY.replace("detail=full", "detail=nodata"), GENERIC),
    ("ecb-exr-2025-history.xml", BASE + QUERY + "&includeHistory=true", GENERIC),
]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    part = path.with_name(path.name + ".part")
    part.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    part.replace(path)


def capture(root, name, url, accept):
    target, receipt_path = root / name, root / (name + ".receipt.json")
    if receipt_path.exists():
        saved = json.loads(receipt_path.read_text(encoding="utf-8"))
        if saved["url"] != url or saved["request_headers"]["Accept"] != accept:
            raise ValueError("A different request owns " + name)
        raw = target.read_bytes()
        if digest(raw) != saved["sha256"] or len(raw) != saved["bytes"]:
            raise ValueError("The retained response changed: " + name)
        return saved
    if target.exists():
        raise ValueError("A response without its receipt already exists: " + name)
    headers = {"Accept": accept, "Accept-Encoding": "identity", "User-Agent": "Commons-SDMX-source-capture/1.0"}
    try:
        response = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=45)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read()
        receipt = {"url": url, "final_url": response.url, "request_headers": headers,
                   "status": response.code, "response_headers": dict(response.headers.items()),
                   "retrieved_at": datetime.now(timezone.utc).isoformat(), "path": name,
                   "bytes": len(raw), "sha256": digest(raw)}
    part = target.with_name(target.name + ".part")
    part.write_bytes(raw)
    part.replace(target)
    write_json(receipt_path, receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    verify = commands.add_parser("verify", help="Verify this retained manifest without contacting ECB")
    verify.add_argument("directory", type=Path, nargs="?", default=Path(__file__).resolve().parent)
    fetch = commands.add_parser("capture", help="Capture a separate response edition with native receipts")
    fetch.add_argument("directory", type=Path)
    args = parser.parse_args()
    root = args.directory.resolve()
    if args.command == "verify":
        manifest = json.loads((root / "sources.json").read_text(encoding="utf-8"))
        for source in manifest["sources"]:
            raw = (root / source["path"]).read_bytes()
            receipt = json.loads((root / source["receipt"]).read_text(encoding="utf-8"))
            if digest(raw) != source["sha256"] or len(raw) != source["bytes"]:
                raise ValueError("Source bytes differ: " + source["path"])
            if receipt["sha256"] != source["sha256"] or receipt["url"] != source["url"]:
                raise ValueError("Source receipt differs: " + source["path"])
        print(json.dumps({"verified_sources": len(manifest["sources"]), "manifest": str(root / "sources.json")}))
        return
    root.mkdir(parents=True, exist_ok=True)
    if (root / "sources.json").exists():
        raise ValueError("Use a separate directory; this directory already holds a retained source edition")
    records = []
    for request in REQUESTS:
        record = capture(root, *request)
        records.append(record)
        print(json.dumps({"path": record["path"], "status": record["status"], "bytes": record["bytes"], "sha256": record["sha256"]}), flush=True)
    baseline = next(row for row in records if row["path"] == "ecb-exr-2025-generic.xml")
    if baseline["status"] == 200:
        stamp = urllib.parse.quote(baseline["retrieved_at"], safe="")
        records.append(capture(root, "ecb-exr-2025-after-capture.xml", BASE + QUERY + "&updatedAfter=" + stamp, GENERIC))
    sources = []
    for record in records:
        response_headers = {key.lower(): value for key, value in record["response_headers"].items()}
        sources.append({"scope": "public", "provider": "European Central Bank",
                        "path": record["path"], "receipt": record["path"] + ".receipt.json",
                        "url": record["url"], "final_url": record["final_url"],
                        "request_accept": record["request_headers"]["Accept"],
                        "status": record["status"], "media_type": response_headers.get("content-type"),
                        "retrieved_at": record["retrieved_at"], "bytes": record["bytes"],
                        "sha256": record["sha256"]})
    write_json(root / "sources.json", {"format": "commons-public-source-bundle@1",
                                      "title": "ECB EXR selected 2025 source edition",
                                      "scope": "public", "sources": sources})


if __name__ == "__main__":
    main()
