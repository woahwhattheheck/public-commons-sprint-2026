#!/usr/bin/env python3
"""Retain the original RL-18151 WQP responses for the existing scientific study."""
from __future__ import annotations
import argparse
import base64
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request

PLAN = json.loads(r'''{
  "schema": "upstate.station-acquisition/v1",
  "operation": "A73C-RL18151-PHOSPHORUS-20261013",
  "station": {
    "site_id": "RL-18151",
    "monitoring_location_identifier": "21SC60WQ_WQX-RL-18151",
    "station_publisher_huc12": "030601010204",
    "station_publisher_huc8": "03060101",
    "assessment_records": [
      {
        "id": "5d50e961f2d6ea86619791dc",
        "source_id": "scdes-303d-published-2024-pdf-table-text",
        "source_vintage": "2024",
        "cause_raw": "TP",
        "cause_label": "Total phosphorus",
        "huc12": "030601010204",
        "original_record_locator": {
          "path": "inputs/303d-2024-pdf-table-normalized.json",
          "sha256": "69e6894001fdcfa0130d8be532a31655eda22486a4044079665e8ee614eb5b0c",
          "record_pointer": "/records/1361",
          "record_index": 1361,
          "record_id": "5d50e961f2d6ea86619791dc",
          "original_source_row": 1124,
          "original_source_page": 61
        }
      }
    ],
    "source_uri": "https://www.waterqualitydata.us/provider/STORET/21SC60WQ_WQX/21SC60WQ_WQX-RL-18151/",
    "page_text_sha256": "0e184277dd9716a11de74b5467def12ae0643c234c427b8d68295e678f799ad6",
    "periods": [
      {
        "characteristic_group": "Biological, Algae, Phytoplankton",
        "first_year": 2018,
        "last_year": 2025,
        "original_row": "Biological, Algae, Phytoplankton  | 2018 - 2025"
      },
      {
        "characteristic_group": "Cyanotoxins, Phytotoxins",
        "first_year": 2018,
        "last_year": 2018,
        "original_row": "Cyanotoxins, Phytotoxins  | 2018 - 2018"
      },
      {
        "characteristic_group": "Information",
        "first_year": 2018,
        "last_year": 2026,
        "original_row": "Information  | 2018 - 2026"
      },
      {
        "characteristic_group": "Inorganics, Major, Metals",
        "first_year": 2018,
        "last_year": 2026,
        "original_row": "Inorganics, Major, Metals  | 2018 - 2026"
      },
      {
        "characteristic_group": "Inorganics, Minor, Metals",
        "first_year": 2018,
        "last_year": 2026,
        "original_row": "Inorganics, Minor, Metals  | 2018 - 2026"
      },
      {
        "characteristic_group": "Microbiological",
        "first_year": 2018,
        "last_year": 2026,
        "original_row": "Microbiological  | 2018 - 2026"
      },
      {
        "characteristic_group": "Nutrient",
        "first_year": 2018,
        "last_year": 2026,
        "original_row": "Nutrient  | 2018 - 2026"
      },
      {
        "characteristic_group": "Physical",
        "first_year": 2018,
        "last_year": 2026,
        "original_row": "Physical  | 2018 - 2026"
      }
    ]
  },
  "start_date": "2018-01-01",
  "end_date": "2026-10-13",
  "requests": [
    {
      "site_id": "RL-18151",
      "monitoring_location_identifier": "21SC60WQ_WQX-RL-18151",
      "characteristic_group": "Microbiological",
      "publisher_first_year": 2018,
      "publisher_last_year": 2026,
      "source_uri": "https://www.waterqualitydata.us/provider/STORET/21SC60WQ_WQX/21SC60WQ_WQX-RL-18151/",
      "page_text_sha256": "0e184277dd9716a11de74b5467def12ae0643c234c427b8d68295e678f799ad6",
      "assessment_records": [
        {
          "id": "5d50e961f2d6ea86619791dc",
          "source_id": "scdes-303d-published-2024-pdf-table-text",
          "source_vintage": "2024",
          "cause_raw": "TP",
          "cause_label": "Total phosphorus",
          "huc12": "030601010204",
          "original_record_locator": {
            "path": "inputs/303d-2024-pdf-table-normalized.json",
            "sha256": "69e6894001fdcfa0130d8be532a31655eda22486a4044079665e8ee614eb5b0c",
            "record_pointer": "/records/1361",
            "record_index": 1361,
            "record_id": "5d50e961f2d6ea86619791dc",
            "original_source_row": 1124,
            "original_source_page": 61
          }
        }
      ],
      "summary": {
        "method": "GET",
        "uri": "https://waterqualitydata.us/data/summary/monitoringLocation/search?siteid=21SC60WQ_WQX-RL-18151&characteristicType=Microbiological&mimeType=csv&dataProfile=periodOfRecord&summaryYears=all"
      },
      "results": {
        "method": "GET",
        "uri": "https://waterqualitydata.us/data/Result/search?siteid=21SC60WQ_WQX-RL-18151&characteristicType=Microbiological&mimeType=csv&sorted=no"
      },
      "activities": {
        "method": "GET",
        "uri": "https://waterqualitydata.us/data/Activity/search?siteid=21SC60WQ_WQX-RL-18151&characteristicType=Microbiological&mimeType=csv&sorted=no"
      },
      "detection_limits": {
        "method": "GET",
        "uri": "https://waterqualitydata.us/data/ResultDetectionQuantitationLimit/search?siteid=21SC60WQ_WQX-RL-18151&characteristicType=Microbiological&mimeType=csv&sorted=no"
      }
    },
    {
      "site_id": "RL-18151",
      "monitoring_location_identifier": "21SC60WQ_WQX-RL-18151",
      "characteristic_group": "Nutrient",
      "publisher_first_year": 2018,
      "publisher_last_year": 2026,
      "source_uri": "https://www.waterqualitydata.us/provider/STORET/21SC60WQ_WQX/21SC60WQ_WQX-RL-18151/",
      "page_text_sha256": "0e184277dd9716a11de74b5467def12ae0643c234c427b8d68295e678f799ad6",
      "assessment_records": [
        {
          "id": "5d50e961f2d6ea86619791dc",
          "source_id": "scdes-303d-published-2024-pdf-table-text",
          "source_vintage": "2024",
          "cause_raw": "TP",
          "cause_label": "Total phosphorus",
          "huc12": "030601010204",
          "original_record_locator": {
            "path": "inputs/303d-2024-pdf-table-normalized.json",
            "sha256": "69e6894001fdcfa0130d8be532a31655eda22486a4044079665e8ee614eb5b0c",
            "record_pointer": "/records/1361",
            "record_index": 1361,
            "record_id": "5d50e961f2d6ea86619791dc",
            "original_source_row": 1124,
            "original_source_page": 61
          }
        }
      ],
      "summary": {
        "method": "GET",
        "uri": "https://waterqualitydata.us/data/summary/monitoringLocation/search?siteid=21SC60WQ_WQX-RL-18151&characteristicType=Nutrient&mimeType=csv&dataProfile=periodOfRecord&summaryYears=all"
      },
      "results": {
        "method": "GET",
        "uri": "https://waterqualitydata.us/data/Result/search?siteid=21SC60WQ_WQX-RL-18151&characteristicType=Nutrient&mimeType=csv&sorted=no"
      },
      "activities": {
        "method": "GET",
        "uri": "https://waterqualitydata.us/data/Activity/search?siteid=21SC60WQ_WQX-RL-18151&characteristicType=Nutrient&mimeType=csv&sorted=no"
      },
      "detection_limits": {
        "method": "GET",
        "uri": "https://waterqualitydata.us/data/ResultDetectionQuantitationLimit/search?siteid=21SC60WQ_WQX-RL-18151&characteristicType=Nutrient&mimeType=csv&sorted=no"
      }
    },
    {
      "site_id": "RL-18151",
      "monitoring_location_identifier": "21SC60WQ_WQX-RL-18151",
      "characteristic_group": "Physical",
      "publisher_first_year": 2018,
      "publisher_last_year": 2026,
      "source_uri": "https://www.waterqualitydata.us/provider/STORET/21SC60WQ_WQX/21SC60WQ_WQX-RL-18151/",
      "page_text_sha256": "0e184277dd9716a11de74b5467def12ae0643c234c427b8d68295e678f799ad6",
      "assessment_records": [
        {
          "id": "5d50e961f2d6ea86619791dc",
          "source_id": "scdes-303d-published-2024-pdf-table-text",
          "source_vintage": "2024",
          "cause_raw": "TP",
          "cause_label": "Total phosphorus",
          "huc12": "030601010204",
          "original_record_locator": {
            "path": "inputs/303d-2024-pdf-table-normalized.json",
            "sha256": "69e6894001fdcfa0130d8be532a31655eda22486a4044079665e8ee614eb5b0c",
            "record_pointer": "/records/1361",
            "record_index": 1361,
            "record_id": "5d50e961f2d6ea86619791dc",
            "original_source_row": 1124,
            "original_source_page": 61
          }
        }
      ],
      "summary": {
        "method": "GET",
        "uri": "https://waterqualitydata.us/data/summary/monitoringLocation/search?siteid=21SC60WQ_WQX-RL-18151&characteristicType=Physical&mimeType=csv&dataProfile=periodOfRecord&summaryYears=all"
      },
      "results": {
        "method": "GET",
        "uri": "https://waterqualitydata.us/data/Result/search?siteid=21SC60WQ_WQX-RL-18151&characteristicType=Physical&mimeType=csv&sorted=no"
      },
      "activities": {
        "method": "GET",
        "uri": "https://waterqualitydata.us/data/Activity/search?siteid=21SC60WQ_WQX-RL-18151&characteristicType=Physical&mimeType=csv&sorted=no"
      },
      "detection_limits": {
        "method": "GET",
        "uri": "https://waterqualitydata.us/data/ResultDetectionQuantitationLimit/search?siteid=21SC60WQ_WQX-RL-18151&characteristicType=Physical&mimeType=csv&sorted=no"
      }
    }
  ],
  "parent": {
    "file": "acquisition-plan.json",
    "sha256": "d96c3e9340e66db4ddd93798ca50c8d9c0f0acac6a05c6bc248897cf0e9402cd",
    "bank_sha256": "c8e07035ae9ac68ff619ee3f48e128191eea2927d8055f34a76e1d2db2ce9836",
    "slack_file_id": "F0C8TAWUZJ5"
  }
}''')
AGENT = "Upper-Savannah-Scientific-Source-Intake/1.0"
HEADER_KEYS = ("Content-Type", "Content-Length", "ETag", "Last-Modified", "Date",
               "Warning", "Total-Result-Count", "Total-Activity-Count",
               "Total-Site-Count", "Retry-After")

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def write_new(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError("Retained file differs; select another output directory: " + str(path))
        return
    with path.open("xb") as stream:
        stream.write(raw)

def requests():
    result = []
    for request in PLAN["requests"]:
        group = request["characteristic_group"].lower()
        for kind in ("summary", "results", "activities", "detection_limits"):
            uri = request[kind]["uri"]
            if kind != "summary":
                uri += "&startDateLo=01-01-2018&startDateHi=10-13-2026"
            result.append({"id": group + "-" + kind,
                           "path": "original/" + group + "-" + kind + ".csv",
                           "kind": kind, "group": request["characteristic_group"], "uri": uri})
    result.append({"id": "station", "path": "original/station.csv", "kind": "station",
                   "uri": "https://waterqualitydata.us/data/Station/search?"
                          "siteid=21SC60WQ_WQX-RL-18151&mimeType=csv&sorted=no"})
    return result

def inspect_csv(raw, request, status=200):
    if status == 204 and not raw:
        return {"records": 0, "fields": [], "empty_response": True}
    text = raw.decode("utf-8-sig")
    if text.lstrip().startswith(("<html", "<!DOCTYPE", "<!doctype")):
        raise ValueError("Publisher returned an HTML page instead of original CSV")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    fields = reader.fieldnames
    if not fields or len(fields) != len(set(fields)):
        raise ValueError("Original CSV has missing or repeated headers")
    rows = list(reader)
    if any(None in row or any(value is None for value in row.values()) for row in rows):
        raise ValueError("Original CSV has an incomplete record or extra field")
    station_fields = [name for name in fields if name.lower().replace("_", "") in
                      ("monitoringlocationidentifier", "monitoringlocationid")]
    if station_fields:
        found = {row[station_fields[0]] for row in rows if row[station_fields[0]]}
        if found - {"21SC60WQ_WQX-RL-18151"}:
            raise ValueError("Original request returned another monitoring station")
    if request["kind"] == "results" and "ActivityStartDate" in fields:
        dates = [row["ActivityStartDate"] for row in rows]
        if any(value and not ("2018-01-01" <= value <= "2026-10-13") for value in dates):
            raise ValueError("Original result falls outside selected source query dates")
    return {"records": len(rows), "fields": fields}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="new or resumable source-edition directory")
    parser.add_argument("--timeout", type=float, default=120,
                        help="per-request seconds; completed originals are reused")
    args = parser.parse_args()
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=True)
    plan_bytes = (json.dumps(PLAN, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    write_new(root / "acquisition-plan.json", plan_bytes)
    manifest_path = root / "capture-manifest.json"
    prior = json.loads(manifest_path.read_text("utf-8")) if manifest_path.exists() else {}
    if prior and prior.get("operation") != PLAN["operation"]:
        raise ValueError("Output belongs to another original acquisition")
    originals = {item["id"]: item for item in prior.get("originals", [])}
    attempts = list(prior.get("attempts", []))
    all_requests = requests()
    for request in all_requests:
        target = root / request["path"]
        retained = originals.get(request["id"])
        if retained:
            raw = target.read_bytes()
            if retained["uri"] != request["uri"] or len(raw) != retained["bytes"] or sha(raw) != retained["sha256"]:
                raise ValueError("Retained original/selection changed: " + request["id"])
            inspect_csv(raw, request, retained["status"])
            continue
        instant = dt.datetime.now(dt.timezone.utc).isoformat()
        record = {"id": request["id"], "uri": request["uri"], "requested_at": instant}
        stop = False
        try:
            req = urllib.request.Request(request["uri"], headers={
                "User-Agent": AGENT, "Accept": "text/csv", "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=args.timeout) as response:
                raw = response.read()
                record.update(status=response.status, final_uri=response.geturl(),
                              headers={key: response.headers[key] for key in HEADER_KEYS if key in response.headers})
            if record["status"] not in (200, 204):
                raise ValueError("Original response is neither HTTP 200 nor HTTP 204")
            detail = inspect_csv(raw, request, record["status"])
            write_new(target, raw)
            retained = {**request, "retrieved_at": instant, "bytes": len(raw),
                        "sha256": sha(raw), "status": record["status"],
                        "final_uri": record["final_uri"], "headers": record["headers"], **detail}
            originals[request["id"]] = retained
            record.update(state="retained", bytes=len(raw), sha256=retained["sha256"], records=detail["records"])
        except urllib.error.HTTPError as error:
            body = error.read()
            error_path = "responses/" + request["id"] + "-" + instant.replace(":", "-") + ".bin"
            write_new(root / error_path, body)
            record.update(state="http_error", status=error.code, error=str(error),
                          response_path=error_path, bytes=len(body), sha256=sha(body),
                          headers={key: error.headers[key] for key in HEADER_KEYS if key in error.headers})
            stop = error.code in (401, 403, 429)
        except Exception as error:
            record.update(state="error", error=type(error).__name__ + ": " + str(error))
        attempts.append(record)
        current = {"schema": "upstate.original-station-source/v1", "operation": PLAN["operation"],
                   "station_id": "21SC60WQ_WQX-RL-18151", "selected_start": "2018-01-01",
                   "selected_end": "2026-10-13", "plan_sha256": sha(plan_bytes),
                   "originals": [originals[item["id"]] for item in all_requests if item["id"] in originals],
                   "attempts": attempts, "complete": len(originals) == len(all_requests),
                   "pending": [item["id"] for item in all_requests if item["id"] not in originals]}
        temporary = root / ".capture-manifest.tmp"
        temporary.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", "utf-8")
        temporary.replace(manifest_path)
        print(json.dumps(record, ensure_ascii=False), flush=True)
        if stop:
            break
    manifest = json.loads(manifest_path.read_text("utf-8"))
    source = Path(__file__).read_bytes()
    write_new(root / "capture_rl18151.py", source)
    paths = ["acquisition-plan.json", "capture-manifest.json", "capture_rl18151.py"]
    paths += [item["path"] for item in manifest["originals"]]
    paths += [item["response_path"] for item in manifest["attempts"] if item.get("response_path")]
    files = []
    for name in sorted(set(paths)):
        raw = (root / name).read_bytes()
        files.append({"path": name, "bytes": len(raw), "sha256": sha(raw),
                      "encoding": "base64", "content_base64": base64.b64encode(raw).decode("ascii")})
    packet = (json.dumps({"schema": "commons.source-bank/v1", "operation": PLAN["operation"],
                          "complete": manifest["complete"], "files": files},
                         ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    compressed = gzip.compress(packet, mtime=0)
    transport = {"schema": "commons.gzip-source-bank/v1", "encoding": "gzip+base64",
                 "decoded_bytes": len(packet), "decoded_sha256": sha(packet),
                 "compressed_bytes": len(compressed), "compressed_sha256": sha(compressed),
                 "chunks": [{"index": i // 12000, "content_base64": base64.b64encode(compressed).decode("ascii")[i:i+12000]}
                            for i in range(0, len(base64.b64encode(compressed)), 12000)]}
    (root / "source-transfer.json").write_text(json.dumps(transport, indent=2) + "\n", "utf-8")
    print(json.dumps({"complete": manifest["complete"], "originals": len(manifest["originals"]),
                      "pending": manifest["pending"], "transfer": str(root / "source-transfer.json"),
                      "decoded_bytes": len(packet), "decoded_sha256": sha(packet)}), flush=True)
    return 0 if manifest["complete"] else 2

if __name__ == "__main__":
    raise SystemExit(main())
