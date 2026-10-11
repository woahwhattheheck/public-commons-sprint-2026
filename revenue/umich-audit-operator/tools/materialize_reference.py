#!/usr/bin/env python3
"""Materialize the reviewed U-M public references and an existing original event catalog."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen
from uuid import uuid4

SCHEMA = "umich.audit-reference-acquisition/v1"
OBSERVED_ON = "2026-10-11"
MAX_BYTES = 8 * 1024 * 1024
PUBLIC = [
    {"id": "audit-process", "filename": "audit-process.html",
     "url": "https://audits.umich.edu/the-audit-process/steps-of-the-process/",
     "sha256": "e45cb60a2ed00907073a5aa138401124103bf4f629c60d53d3c0891a13c748d2",
     "bytes": 18224, "media_type": "text/html"},
    {"id": "follow-up", "filename": "reporting-follow-up.html",
     "url": "https://audits.umich.edu/the-audit-process/reporting-follow-up/",
     "sha256": "deb0b24b537fa9ded0a563a8152d74ae2408e519b59acac86e36d44477f3fdea",
     "bytes": 16341, "media_type": "text/html"},
    {"id": "sample-report", "filename": "sample-audit-report-2024.pdf",
     "url": "https://audits.umich.edu/uploads/reports-and-advisories-sample-report-9-2024.pdf",
     "sha256": "2bae67bd384393412c2b8517aed4c239ac42ffbd2707fb133b0c4c949512368d",
     "bytes": 267998, "media_type": "application/pdf"}
]
CONTRACT = {"id": "audit-domain-contract", "filename": "audit-domain-contract.json",
            "sha256": "ad9abc7677917d3cf7072a5ec52d9be976b165949d6060afc7bc375c9f7b91fc"}
NOTICE = [
    {"id": "rfp-notice", "filename": "1442341-event.pdf", "bytes": 865149,
     "sha256": "31ad185f5770c3c4a3d341df260ef8c7bf0027fec6b04b115fdfb59fe2ed4c32"},
    {"id": "event-catalog", "filename": "event-catalog.json", "bytes": 40167,
     "sha256": "819a01647a939e867e344abc94e24db04df290687463cb43771944ec13099bac"}
]
LISTING = "https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=UMich"

def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

def sha(data):
    return hashlib.sha256(data).hexdigest()

def exact(data, spec):
    return sha(data) == spec["sha256"] and ("bytes" not in spec or len(data) == spec["bytes"])

def read_regular(path):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    with os.fdopen(fd, "rb") as stream:
        s = os.fstat(stream.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_size > MAX_BYTES:
            raise ValueError("Expected a regular source file within the 8 MiB limit")
        data = stream.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError("Source exceeds the 8 MiB limit")
        return data

def write_exact(path, data):
    """Install a new immutable member; never replace a different existing source."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if read_regular(path) != data:
            raise ValueError("Existing selected source has different bytes: " + path.name)
        return
    fd, temporary = tempfile.mkstemp(prefix=".source-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if read_regular(path) != data:
                raise ValueError("Concurrent selected-source conflict: " + path.name)
    finally:
        Path(temporary).unlink(missing_ok=True)

def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")

def sanitized_url(value):
    p = urlsplit(value)
    return urlunsplit((p.scheme, p.netloc.split("@")[-1], p.path, "", ""))

def fetch(spec, timeout):
    request = Request(spec["url"], headers={"User-Agent": "TokenJunkieLabs-U-M-Reference/1.0"})
    with urlopen(request, timeout=timeout) as response:
        fetched_at = now()
        final = urlsplit(response.geturl())
        if final.scheme != "https" or final.hostname not in {"audits.umich.edu", "www.audits.umich.edu"}:
            raise ValueError("Unexpected public-source redirect host")
        body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise ValueError("Public source exceeds the 8 MiB limit")
        return body, {"method": "public_https", "retrieved_at": fetched_at,
                      "http_status": response.status,
                      "resolved_url_without_query": sanitized_url(response.geturl()),
                      "redirect_query_omitted": bool(final.query),
                      "content_type": response.headers.get_content_type(),
                      "etag": response.headers.get("ETag"),
                      "last_modified": response.headers.get("Last-Modified")}

def materialize(reference, retained=None, notice_directory=None, contract_file=None,
                refresh_public=False, timeout=30):
    reference = Path(reference).resolve()
    reference.mkdir(parents=True, exist_ok=True)
    acquisition_id = "capture-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:12]
    history = reference / "acquisitions" / acquisition_id
    history.mkdir(parents=True, exist_ok=False)
    receipt = {"schema": SCHEMA, "id": acquisition_id, "started_at": now(),
               "reference_observed_on": OBSERVED_ON, "observed_date_precision": "day",
               "records": [], "errors": []}
    selected = []
    all_specs = [*PUBLIC, CONTRACT, *(NOTICE if notice_directory else [])]
    for spec in all_specs:
        record = {"id": spec["id"], "filename": spec["filename"],
                  "expected_sha256": spec["sha256"], "reference_observed_on": OBSERVED_ON}
        try:
            target = reference / spec["filename"]
            source = None
            if spec in PUBLIC and refresh_public:
                data, provenance = fetch(spec, timeout)
            else:
                candidates = [target]
                if spec == CONTRACT:
                    candidates += [Path(contract_file)] if contract_file else [Path(__file__).with_name(CONTRACT["filename"])]
                elif spec in NOTICE:
                    candidates += [Path(notice_directory) / spec["filename"]]
                elif retained:
                    candidates += [Path(retained) / spec["filename"]]
                for candidate in candidates:
                    if candidate.is_file():
                        source = candidate
                        break
                if source is None and spec in PUBLIC:
                    data, provenance = fetch(spec, timeout)
                elif source is None:
                    raise FileNotFoundError("Original retained source is required: " + spec["filename"])
                else:
                    data = read_regular(source)
                    provenance = {"method": "retained_exact_source",
                                  "materialized_at": now(), "retrieved_at": None,
                                  "note": "This operation did not retrieve the retained source from its publisher."}
            record.update(provenance)
            record.update({"actual_sha256": sha(data), "actual_bytes": len(data)})
            if not exact(data, spec):
                if provenance["method"] == "public_https":
                    relative = Path("unreviewed") / spec["id"] / sha(data) / spec["filename"]
                    write_exact(reference / relative, data)
                    record["captured_path"] = relative.as_posix()
                    record["status"] = "CHANGED_PUBLIC_EDITION_UNREVIEWED"
                else:
                    record["status"] = "RETAINED_SOURCE_PIN_MISMATCH"
                record["domain_contract_binding"] = False
                receipt["errors"].append({"id": spec["id"], "reason": record["status"]})
            else:
                write_exact(target, data)
                record["status"] = "SELECTED_ORIGINAL"
                record["selected_path"] = spec["filename"]
                record["domain_contract_binding"] = True
                selected.append({"id": spec["id"], "path": spec["filename"],
                                 "sha256": spec["sha256"], "bytes": len(data),
                                 "reference_observed_on": OBSERVED_ON})
        except Exception as error:
            record["status"] = "ACQUISITION_ERROR"
            record["error_type"] = type(error).__name__
            receipt["errors"].append({"id": spec["id"], "reason": type(error).__name__})
        receipt["records"].append(record)
    receipt["finished_at"] = now()
    receipt["state"] = "COMPLETE" if not receipt["errors"] else "REVIEW_REQUIRED"
    receipt["notice_source"] = {"public_listing": LISTING, "event_id": "1442341",
                               "rfp": "RFP-0012413-TECH-2026",
                               "catalog_copied_unchanged": bool(notice_directory) and not any(
                                   e["id"] in {"rfp-notice", "event-catalog"} for e in receipt["errors"]),
                               "buyer_attachments": "Join the original source owner's separately acquired issued files."}
    if not receipt["errors"]:
        pins = {"schema": "umich.audit-reference-pins/v1", "reference_observed_on": OBSERVED_ON,
                "source_authenticity": "Observed public/retained bytes; not a publisher digital signature.",
                "files": selected, "domain_contract": CONTRACT["sha256"]}
        pins_data = encode(pins)
        write_exact(history / "SOURCE_PINS.json", pins_data)
        current = reference / "SOURCE_PINS.json"
        if current.exists():
            write_exact(history / "previous-SOURCE_PINS.json", read_regular(current))
        fd, tmp = tempfile.mkstemp(prefix=".pins-", dir=reference)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(pins_data); stream.flush(); os.fsync(stream.fileno())
            os.replace(tmp, current)
        finally:
            Path(tmp).unlink(missing_ok=True)
        receipt["source_pins_sha256"] = sha(pins_data)
    write_exact(history / "ACQUISITION.json", encode(receipt))
    return {"state": receipt["state"], "acquisition_id": acquisition_id,
            "receipt": str(history / "ACQUISITION.json"), "selected_count": len(selected),
            "errors": receipt["errors"]}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", required=True, help="Receiving reference directory")
    parser.add_argument("--retained", help="Existing exact public source directory; avoids another download")
    parser.add_argument("--notice-directory", help="Original 7A2F directory containing PDF and event-catalog.json")
    parser.add_argument("--contract", dest="contract_file", help="Existing unchanged audit-domain-contract.json")
    parser.add_argument("--refresh-public", action="store_true", help="Retrieve current public pages; changed bodies remain unreviewed")
    parser.add_argument("--timeout", type=float, default=30)
    args = parser.parse_args(argv)
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    result = materialize(**vars(args))
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["state"] == "COMPLETE" else 2

if __name__ == "__main__":
    sys.exit(main())
