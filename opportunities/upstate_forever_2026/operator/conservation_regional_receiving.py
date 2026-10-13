#!/usr/bin/env python3
"""Operate the retained Upper Savannah conservation studies and receiving journey.

Run from the complete product root:
  python -B operator/conservation_regional_receiving.py --workspace EXISTING_WORKSPACE \
    --domain-manifest ORIGINAL_DOMAIN/sources.json \
    --geography-manifest ORIGINAL_GEOGRAPHY/sources.json

Already imported originals are reused by exact original byte identity, preserving
their actual received source collection and source ID. The geography argument is optional when
its real entries are already imported. Missing reporting files are received from
the exact pinned public source after the upstream journey. A four-HUC companion can supply
the exact original utility-focus source. If that separate capture is absent, the
same four unchanged HUC12 features are selected from the verified original domain
under a distinct derived source identity with its full original parent retained.
The South Carolina reporting study
uses the original PlanningBasins2023 feature when available. The complete
upstream-domain journey runs first and is retained independently.

When the published protection polygons are imported, this same workflow also
builds the upstream and reporting source-water priority studies, operates the
source-context optimizer, saves its original conservation plans, exports their
packets and reopens each plan and analysis. Pass the already prepared native
--public-water-manifest and --public-water-preparation when receiving those
sources in another Workspace. Their actual imported collection ID is retained.

Add --prepare-catalog to operate the same completed original study through the
source-bound candidate index, paged records, retained eligible cohort, original
plan save and complete row/decision exports. --catalog-study selects one actual
regional study. The default uses protection_upstream when its originals are
present, otherwise upstream. Receiving retains every original ID and explicitly
records its deterministic manual cohort edit before independent reopening.

Land-cover scenario creation additionally requires explicit --from-codes,
--to-code and --scenario-reason. Original grid/profile IDs can be passed together
to prepare the native run through the existing scenario adapter. Add --models
for an explicit NDR/SDR scope. --prepare-experiment retains the native paired
study; --execute-experiment executes that same study and reopens its complete
summary in the original Workspace. Additional original profile IDs and explicit
one-at-a-time or factorial axes are passed to the maintained experiment engine.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import platform
import shutil
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
if str(PRODUCT_ROOT) not in sys.path:
    sys.path.insert(0, str(PRODUCT_ROOT))

from model.workspace import Workspace
from model.common import relative_file
from model import conservation

ORIGINALS = {
    "domain": {
        "id": "upstate-wbd-upstream-domain-20261012",
        "sha256": "6f49c2f1dc10709d7957e38e92642a1de4cda44e67e4d70a8bc2ff51388e6af9",
        "bytes": 3732669,
        "decoded_bytes": 11220042,
        "decoded_sha256": "2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af",
        "label": "Retained upstream model domain: 217 WBD HUC12 units",
    },
    "reporting": {
        "id": "planning-basins2023",
        "sha256": "133bc5369bd0d68bfdb53c61e3df24f9445f799b0d68b301f321d2c49d71eab6",
        "label": "South Carolina Upper Savannah reporting basin",
    },
    "protection_areas": {
        "id": "scdes-arjws-prwd-swpa-20261012",
        "sha256": "ddac0feb1c704ca5e95336e21961e08beede1f83b6b820423dffa5a63bd8e285",
        "bytes": 2389556,
        "label": "Published ARJWS and PRWD source-water protection polygons",
    },
    "focus": {
        "id": "usgs-wbd-focus-huc12-20261012",
        "sha256": "c5e0af7bd6fb8aa72ebb7283ceae6bb694bc203ce98ef0a0e33ce200800c6806",
        "label": "Four original utility-focus HUC12 watersheds",
    },
}
FOCUS_IDS = ("030601010703", "030601010704", "030601020502", "030601020507")
PROTECTION_OBJECT_IDS = (11, 12, 131, 132)
PROTECTION_URI = (
    "https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/2/query"
    "?objectIds=11,12,131,132&outFields=*&returnGeometry=true&orderByFields=OBJECTID&f=pjson"
)
FOCUS_URI = (
    "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6/query"
    "?f=json&objectIds=41225%2C41226%2C55299%2C55534&outFields=%2A"
    "&returnGeometry=true&returnTrueCurves=true"
)
PROJECT_THREAD = "https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791724121853269"
RFP_URI = "https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf"
GEOGRAPHY_BASE = (
    "https://raw.githubusercontent.com/capellett/scsf/"
    "45f7ea3ca968c96e2fc6188d7f55c3b0ce60da95/data-raw/planning_basins2023/"
)
GEOGRAPHY_FILES = {
    "PlanningBasins2023.shp": (1600228, ORIGINALS["reporting"]["sha256"]),
    "PlanningBasins2023.shx": (164, "60572d5c75694110fceab00c24ba9b3607756838585f2b315c5abcbeac0034c6"),
    "PlanningBasins2023.dbf": (874, "0c792056dcaff94eaa9fb5a22d576a6c42bcce763a885a289f4cdd15434b4dba"),
    "PlanningBasins2023.prj": (424, "16375a22022b8b34455292d576c5ebb590083e406d754a9abbcca6994c3e3261"),
    "PlanningBasins2023.shp.xml": (12530, "95776aa0ff34820f077e04695975af1eb73a3f21d03642c827623324e47a73ec"),
}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def file_fact(path):
    path = Path(path)
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"bytes": path.stat().st_size, "sha256": digest.hexdigest()}


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp-" + str(os.getpid()))
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


class Receiving:
    def __init__(self, path, workspace):
        self.path = Path(path)
        self.started = time.perf_counter()
        self.result = {
            "schema": "upstate.conservation-regional-receiving/v1",
            "operation": "UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012-E7A1",
            "started_at": utc_now(),
            "state": "running",
            "workspace": str(workspace),
            "product_root": str(PRODUCT_ROOT),
            "python": sys.executable,
            "python_version": platform.python_version(),
            "host": platform.node(),
            "source_file": file_fact(__file__),
            "project_thread": PROJECT_THREAD,
            "stages": [],
            "studies": {},
        }
        self.persist()

    def persist(self):
        self.result["elapsed_seconds"] = round(time.perf_counter() - self.started, 6)
        save_json(self.path, self.result)

    def run(self, name, function):
        row = {"name": name, "started_at": utc_now(), "state": "running"}
        self.result["stages"].append(row)
        self.persist()
        start = time.perf_counter()
        try:
            value = function()
        except Exception as exc:
            row.update(state="failed", error_type=type(exc).__name__, error=str(exc))
            row["elapsed_seconds"] = round(time.perf_counter() - start, 6)
            self.result["state"] = "failed"
            self.persist()
            raise
        row.update(state="complete", elapsed_seconds=round(time.perf_counter() - start, 6))
        self.persist()
        print(json.dumps({"stage": name, "state": row["state"], "elapsed_seconds": row["elapsed_seconds"]}), flush=True)
        return value


def resolve_original(workspace, name, collection_id=None):
    """Resolve exact original bytes while preserving the received source identity."""
    expected = ORIGINALS[name]
    matches = []
    for collection in workspace.sources():
        if collection_id is not None and str(collection["id"]) != str(collection_id):
            continue
        for entry in collection.get("entries", []):
            if (entry.get("kind") == "vector"
                    and entry.get("body", {}).get("sha256") == expected["sha256"]):
                matches.append((str(collection["id"]), entry))
    if not matches:
        return None
    # Prefer the original declared ID when present, then choose deterministically.
    # The receiving source may legitimately have another ID for identical bytes.
    collection_id, retained = sorted(
        matches, key=lambda row: (
            row[1].get("id") != expected["id"], row[0], str(row[1].get("id")),
        ),
    )[0]
    source_id = retained["id"]
    path, entry = workspace.source_file(collection_id, source_id)
    actual = file_fact(path)
    if actual["sha256"] != expected["sha256"]:
        raise ValueError("Original source hash mismatch for " + str(source_id))
    if expected.get("bytes") is not None and actual["bytes"] != expected["bytes"]:
        raise ValueError("Original source byte length mismatch for " + str(source_id))
    result = {
        "source_collection_id": collection_id,
        "source_id": source_id,
        "path": str(path),
        "body": actual,
        "label": expected["label"],
        "original_declared_source_id": expected["id"],
        "equivalent_collection_ids": sorted({row[0] for row in matches}),
        "equivalent_sources": sorted(
            [{"source_collection_id": row[0], "source_id": row[1]["id"]}
             for row in matches],
            key=lambda row: (row["source_collection_id"], row["source_id"]),
        ),
        "entry": entry,
    }
    if name == "domain":
        original_domain_document(result)
    return result


def original_domain_document(domain):
    """Read the byte-pinned original domain and validate its native feature keys."""
    expected = ORIGINALS["domain"]
    path = Path(domain["path"])
    stored = path.read_bytes()
    if (len(stored) != expected["bytes"]
            or hashlib.sha256(stored).hexdigest() != expected["sha256"]):
        raise ValueError("The retained original domain bytes changed")
    decoded = gzip.decompress(stored)
    if (len(decoded) != expected["decoded_bytes"]
            or hashlib.sha256(decoded).hexdigest() != expected["decoded_sha256"]):
        raise ValueError("The original decoded domain identity changed")
    document = json.loads(decoded.decode("utf-8-sig"))
    reference = document.get("spatialReference") or {}
    features = document.get("features")
    if (document.get("geometryType") != "esriGeometryPolygon"
            or not isinstance(features, list) or len(features) != 217
            or (reference.get("latestWkid") or reference.get("wkid")) not in (3857, 102100, 102113)):
        raise ValueError("Retain the original 217 polygon features and native domain CRS")
    ids = [feature.get("attributes", {}).get("huc12") for feature in features]
    if (any(not isinstance(value, str) or len(value) != 12 or not value.isdigit() for value in ids)
            or len(set(ids)) != 217):
        raise ValueError("The original domain needs 217 unique native huc12 identifiers")
    if any(not (feature.get("geometry") or {}).get("rings") for feature in features):
        raise ValueError("Retain the complete original domain polygon rings")
    if not set(FOCUS_IDS).issubset(ids):
        raise ValueError("The original domain must contain all four selected utility-focus HUC12s")
    return document


def resolve_public_water(workspace, preparation=None):
    """Bind the published polygons to the actual retained Workspace collection."""
    collection_id = None
    original_preparation = None
    if preparation is not None:
        path = Path(preparation).expanduser().resolve()
        original_preparation = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(original_preparation, dict):
            raise ValueError("The public-water preparation must contain an object")
        collection_id = original_preparation.get("source_collection_id")
        if not isinstance(collection_id, str) or not collection_id:
            raise ValueError("The original public-water preparation needs its actual source_collection_id")
        if original_preparation.get("original_protection_sha256") != ORIGINALS["protection_areas"]["sha256"]:
            raise ValueError("The public-water preparation refers to different original protection polygons")
        # Both maintained preparers retain the same original polygon bytes.
        # Current source-water preparation records each source in source_records;
        # the earlier preparer declared its protection count at the top level.
        source_records = original_preparation.get("source_records")
        protection_record = None
        if source_records is not None:
            if not isinstance(source_records, list):
                raise ValueError("The prepared source_records must be the original source list")
            matches = [
                row for row in source_records if isinstance(row, dict)
                and row.get("id") == ORIGINALS["protection_areas"]["id"]
            ]
            if len(matches) != 1:
                raise ValueError("The preparation must retain one original protection source record")
            protection_record = matches[0]
            for key in ("sha256", "bytes"):
                if protection_record.get(key) != ORIGINALS["protection_areas"][key]:
                    raise ValueError("The prepared protection source " + key + " changed")
        counts = [
            value for value in (
                original_preparation.get("original_protection_features"),
                protection_record.get("features") if protection_record else None,
            ) if value is not None
        ]
        if not counts or any(type(value) is not int or value != len(PROTECTION_OBJECT_IDS)
                             for value in counts):
            raise ValueError("The public-water preparation must retain all four original protection records")
    binding = resolve_original(workspace, "protection_areas", collection_id)
    if binding is None and preparation is not None:
        raise ValueError(
            "The prepared source collection is absent from this Workspace. Import its original "
            "sources.json with --public-water-manifest and keep this same --public-water-preparation."
        )
    if binding is not None:
        binding["object_ids"] = list(PROTECTION_OBJECT_IDS)
        binding["reference"] = binding["entry"].get("uri") or PROTECTION_URI
        binding["source_crs"] = binding["entry"].get("source_crs", "EPSG:26917")
        binding["meaning"] = "Original published ARJWS and PRWD source-water protection areas"
        binding["relation"] = (
            "Polygon intersection with the union of original protection records 11, 12, 131 and 132; "
            "the published 200-foot and 1500-foot polygons are retained, with overlapping area counted once"
        )
        if original_preparation is not None:
            binding["preparation"] = {
                "path": str(path),
                **file_fact(path),
                "original_workspace": original_preparation.get("workspace"),
                "current_workspace": str(workspace.root),
                "source_collection_id": collection_id,
                "receiving_water_plan_id": original_preparation.get("plan_id"),
                "native_manifest": original_preparation.get("native_manifest"),
                "source_records": original_preparation.get("source_records"),
            }
    return binding


def selection(binding):
    return {key: binding[key] for key in ("source_collection_id", "source_id")}


def derive_original_focus(workspace, domain):
    """Select four unchanged native features when no standalone focus is retained."""
    document = original_domain_document(domain)
    selected = [
        (index, feature) for index, feature in enumerate(document["features"])
        if feature["attributes"]["huc12"] in FOCUS_IDS
    ]
    if len(selected) != 4:
        raise ValueError("Select exactly four original domain features for geographic focus")
    # Keep original feature order and every publisher coordinate/property/type.
    derived = {**document, "features": [feature for _, feature in selected]}
    body = (json.dumps(derived, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    fact = {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    source_id = "upstate-domain-focus-huc12-" + fact["sha256"][:20]
    origin = {
        **selection(domain),
        "body": domain["body"],
        "source_feature_indices": [index for index, _ in selected],
        "selected_huc12": [feature["attributes"]["huc12"] for _, feature in selected],
        "method": "Select unchanged features from the verified original 217-HUC document in original order.",
    }
    reference = domain["entry"].get("uri") or (
        "workspace-source:" + domain["source_collection_id"] + "/" + domain["source_id"]
    )
    meaning = "Four utility-focus HUC12 features selected from the original 217-HUC domain"
    destination = workspace.root / "conservation-receiving" / "domain-focus" / fact["sha256"]
    destination.mkdir(parents=True, exist_ok=True)
    derived_path = destination / "selected-domain-focus.esri.json"
    if not derived_path.is_file() or file_fact(derived_path) != fact:
        derived_path.write_bytes(body)
    parent_path = destination / "original-model-domain.esri.json.gz"
    parent_fact = {"bytes": ORIGINALS["domain"]["bytes"], "sha256": ORIGINALS["domain"]["sha256"]}
    if not parent_path.is_file() or file_fact(parent_path) != parent_fact:
        shutil.copyfile(domain["path"], parent_path)
    if file_fact(parent_path) != parent_fact:
        raise ValueError("The retained focus parent differs from the original domain")
    manifest = {
        "schema": "upstate.sources/v1",
        "title": meaning,
        "entries": [{
            "id": source_id, "title": meaning, "kind": "vector",
            "path": derived_path.name, **fact,
            "uri": reference, "vintage": domain["entry"]["vintage"],
            "source_format": "Esri JSON", "source_crs": "EPSG:3857",
            "id_field": "huc12", "role": "FOCUS_CATCHMENTS",
            "selected_huc12": list(FOCUS_IDS), "retained_origin": origin,
            "metadata": {"derivation": origin, "source_meaning": meaning},
            "scope": "Geographic subset of the retained original domain; full selected features are unchanged.",
            "companions": [{"path": parent_path.name, **parent_fact}],
        }],
    }
    manifest_path = destination / "sources.json"
    save_json(manifest_path, manifest)
    collection = workspace.import_sources(manifest_path)
    path, entry = workspace.source_file(collection["id"], source_id)
    if file_fact(path) != fact:
        raise ValueError("The received focus subset differs from its original feature selection")
    return {
        "source_collection_id": collection["id"], "source_id": source_id,
        "path": str(path), "body": fact, "label": meaning,
        "reference": reference, "meaning": meaning, "retained_origin": origin,
        "relation": "Polygon intersection with four unchanged utility-focus HUC12 features selected from the original domain.",
        "entry": entry,
    }


def promote_original_focus(workspace, domain):
    """Reuse exact imported companion objects and the original source definition."""
    entry = domain["entry"]
    candidates = [
        item for item in entry.get("companions", [])
        if item.get("sha256") == ORIGINALS["focus"]["sha256"]
        and str(item.get("source_path", item.get("filename", ""))).endswith("selected-four-huc12.json.gz")
    ]
    if not candidates:
        return None
    companion = candidates[0]
    original_path = relative_file(workspace.root, companion["object"])
    actual = file_fact(original_path)
    if actual["sha256"] != companion["sha256"] or actual["bytes"] != companion["bytes"]:
        raise ValueError("Retained utility-focus companion bytes changed")
    destination = workspace.root / "conservation-receiving" / "original-focus"
    destination.mkdir(parents=True, exist_ok=True)
    body = destination / "selected-four-huc12.json.gz"
    shutil.copyfile(original_path, body)
    retained = []
    for index, item in enumerate(entry.get("companions", [])):
        if str(item.get("filename", "")).endswith("selected-four-huc12.receipt.json"):
            path = relative_file(workspace.root, item["object"])
            fact = file_fact(path)
            if fact["sha256"] != item["sha256"] or fact["bytes"] != item["bytes"]:
                raise ValueError("Original utility-focus receipt changed")
            filename = "original-focus-receipt-" + str(index) + ".json"
            shutil.copyfile(path, destination / filename)
            retained.append({"path": filename, **fact})
    manifest = {
        "schema": "upstate.sources/v1",
        "title": "Original four utility-focus HUC12s recovered from the retained regional source",
        "entries": [{
            "id": ORIGINALS["focus"]["id"],
            "title": ORIGINALS["focus"]["label"],
            "kind": "vector",
            "path": body.name,
            "uri": FOCUS_URI,
            **actual,
            "encoding": "gzip",
            "source_format": "Esri JSON",
            "source_crs": "EPSG:3857",
            "role": "FOCUS_CATCHMENTS",
            "vintage": "2026-10-12T03:29:34.707920+00:00",
            "observed_at": "2026-10-12T03:29:34.707920+00:00",
            "decoded_sha256": "630b3da30804aacf7e5018abcfaa22b135af7e6cae07cc30d59cf558d9b136bd",
            "decoded_bytes": 249773,
            "selected_huc12": list(FOCUS_IDS),
            "scope": "Original utility-focus geographic context from the four retained USGS polygons.",
            "retained_origin": {
                **selection(domain),
                "companion": companion,
            },
            "companions": retained,
        }],
    }
    path = destination / "sources.json"
    save_json(path, manifest)
    workspace.import_sources(path)
    return resolve_original(workspace, "focus")


def receive_original_reporting(workspace):
    """Receive only missing, exact public originals from their pinned commit."""
    destination = workspace.root / "conservation-receiving" / "original-reporting"
    destination.mkdir(parents=True, exist_ok=True)
    companions = []
    for filename, (expected_bytes, expected_sha) in GEOGRAPHY_FILES.items():
        path = destination / filename
        uri = GEOGRAPHY_BASE + filename
        complete = (
            path.is_file()
            and path.stat().st_size == expected_bytes
            and file_fact(path)["sha256"] == expected_sha
        )
        receipt_path = destination / (filename + ".capture.json")
        if not complete:
            pending = destination / (filename + ".partial")
            request = urllib.request.Request(
                uri, headers={"User-Agent": "UpperSavannahOriginalSourceReceiver/1.0"},
            )
            started = time.perf_counter()
            observed_at = utc_now()
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    capture = {
                        "requested_url": uri,
                        "final_url": response.geturl(),
                        "status": response.status,
                        "headers": list(response.headers.items()),
                        "observed_at": observed_at,
                    }
                    with pending.open("wb") as handle:
                        shutil.copyfileobj(response, handle, length=1024 * 1024)
                actual = file_fact(pending)
                capture.update(**actual, elapsed_seconds=round(time.perf_counter() - started, 6))
                save_json(receipt_path, capture)
                if actual["bytes"] != expected_bytes or actual["sha256"] != expected_sha:
                    raise ValueError("Pinned public original identity mismatch for " + filename)
                pending.replace(path)
            except Exception as exc:
                save_json(destination / (filename + ".attempt.json"), {
                    "requested_url": uri,
                    "observed_at": observed_at,
                    "elapsed_seconds": round(time.perf_counter() - started, 6),
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                    "expected_bytes": expected_bytes,
                    "expected_sha256": expected_sha,
                })
                raise
        body_fact = file_fact(path)
        if filename != "PlanningBasins2023.shp":
            companions.append({"path": filename, **body_fact})
        if receipt_path.is_file():
            receipt_fact = file_fact(receipt_path)
            companions.append({"path": receipt_path.name, **receipt_fact})
        print(json.dumps({
            "stage": "receive_original_reporting.file",
            "file": filename,
            "reused": complete,
            **body_fact,
        }), flush=True)
    manifest = {
        "schema": "upstate.sources/v1",
        "title": "Original South Carolina PlanningBasins2023 public source edition",
        "captured_at": utc_now(),
        "entries": [{
            "id": ORIGINALS["reporting"]["id"],
            "title": "South Carolina PlanningBasins2023 - original eight-basin shapefile",
            "kind": "vector",
            "path": "PlanningBasins2023.shp",
            "uri": GEOGRAPHY_BASE + "PlanningBasins2023.shp",
            "bytes": GEOGRAPHY_FILES["PlanningBasins2023.shp"][0],
            "sha256": ORIGINALS["reporting"]["sha256"],
            "source_crs": "EPSG:26917",
            "layer": "PlanningBasins2023",
            "role": "REPORTING_BOUNDARY",
            "vintage": "2023 published edition, with retained DHEC 2007/2008 lineage",
            "observed_at": utc_now(),
            "selection": {
                "field": "Basin", "operator": "eq", "value": "Upper Savannah",
                "native_record_number": 5,
            },
            "scope": "Complete original eight-feature source; select the whole Upper Savannah reporting polygon.",
            "original_source_definition": {
                "canvas_id": "F0C8H9DLRB7",
                "path": "source/sources.json",
                "public_commit": "45f7ea3ca968c96e2fc6188d7f55c3b0ce60da95",
                "original_observed_at": "2026-10-12T03:54:48.700566+00:00",
            },
            "companions": companions,
        }],
    }
    manifest_path = destination / "sources.json"
    save_json(manifest_path, manifest)
    workspace.import_sources(manifest_path)
    return resolve_original(workspace, "reporting")


def study_spec(kind, domain, focus, reporting=None):
    entire_domain = kind == "upstream"
    report_selection = selection(domain if entire_domain else reporting)
    if not entire_domain:
        report_selection.update(layer="PlanningBasins2023", where={"Basin": "Upper Savannah"})
    return {
        "title": (
            "Upper Savannah upstream model domain - watershed conservation scoping"
            if entire_domain else
            "South Carolina Upper Savannah reporting basin - watershed conservation scoping"
        ),
        "mode": "source_context",
        "purpose": "screening",
        "unit_type": "watershed",
        "planning_unit_label": "WBD HUC12 watershed units",
        "analysis_crs": "EPSG:5070",
        "baseline_run_id": None,
        "alternative_run_ids": [],
        "parcels": {
            **selection(domain),
            "id_field": "huc12",
            "label_field": "name",
        },
        "reporting_area": report_selection,
        "contexts": {
            "drinking_water": {
                **selection(focus),
                "relation": focus.get("relation", "Polygon intersection with the four original utility-focus HUC12 watersheds"),
                "meaning": focus.get("meaning", "Utility-focus watershed geographic context"),
                "reference": focus.get("reference", FOCUS_URI),
            }
        },
        "rules": {
            "minimum_source_water_fraction": 0,
            "minimum_area_ha": 0,
            "maximum_protected_fraction": 1,
        },
        "score": {
            "basis": "context",
            "scale": "total",
            "context_weights": {
                "source_water_fraction": 1,
                "unprotected_fraction": 0,
                "high_quality_context": 0,
            },
        },
    }


def run_study(workspace, receiving, kind, spec):
    state = receiving.run(kind + ".prepare", lambda: conservation.prepare(workspace, spec))
    study = receiving.run(kind + ".build", lambda: conservation.build(workspace, state["id"]))
    inspected = receiving.run(
        kind + ".inspect",
        lambda: conservation.inspect(workspace, study["id"], include_candidates=True),
    )
    rows = {str(row["id"]): row for row in inspected["candidates"]}
    if len(rows) != len(inspected["candidates"]):
        raise ValueError("Study contains duplicate native watershed identifiers")
    selected = [
        identifier for identifier in FOCUS_IDS
        if identifier in rows and rows[identifier].get("eligible", False)
    ]
    if not selected:
        raise ValueError("The actual study has no eligible original utility-focus watershed")
    plan = receiving.run(
        kind + ".save_plan",
        lambda: conservation.save_plan(workspace, {
            "title": str(len(selected)) + " utility-focus watersheds - " + kind,
            "study_id": study["id"],
            "mode": "manual",
            "selected_ids": selected,
            "limits": {"area_basis": "whole_units"},
            "objective": "area",
            "include_ineligible": False,
        }),
    )
    packet = receiving.run(
        kind + ".export_packet",
        lambda: conservation.export_packet(workspace, study["id"], plan["id"]),
    )
    packet_path = relative_file(workspace.root, packet["path"])
    packet_fact = file_fact(packet_path)
    if packet_fact["sha256"] != packet["sha256"] or packet_fact["bytes"] != packet["bytes"]:
        raise ValueError("The exported packet differs from its returned original identity")

    def reopen_plan():
        reopened_workspace = Workspace(workspace.root)
        reopened = conservation.get_plan(reopened_workspace, plan["id"])
        for key in ("id", "study_id", "selected_ids", "selection", "files", "summary", "limits", "objective"):
            if key in plan and reopened.get(key) != plan[key]:
                raise ValueError("Reopened plan changed field " + key)
        return reopened

    reopened = receiving.run(kind + ".reopen_plan", reopen_plan)
    result = {
        "study_id": study["id"],
        "title": spec["title"],
        "mode": study.get("mode", "source_context"),
        "metric_state": study.get("metric_state"),
        "selection": spec,
        "summary": study["summary"],
        "actual_candidate_count": len(rows),
        "selected_original_huc12": selected,
        "focus_huc12_outside_this_selection": [value for value in FOCUS_IDS if value not in rows],
        "plan_id": plan["id"],
        "plan_summary": plan["summary"],
        "packet": packet,
        "packet_absolute_path": str(packet_path),
        "reopened_plan_id": reopened["id"],
        "reopened_selection_matches": True,
    }
    receiving.result["studies"][kind] = result
    receiving.persist()
    return result


def protection_study_spec(kind, domain, protection, reporting=None):
    """Keep the original watershed units and reporting mask; select actual SWPA context."""
    spec = study_spec(kind, domain, protection, reporting)
    scope = "Upper Savannah upstream model domain" if kind == "upstream" else "South Carolina Upper Savannah reporting basin"
    spec["title"] = scope + " - published source-water protection priority"
    spec["contexts"]["drinking_water"] = {
        **selection(protection),
        "relation": protection["relation"],
        "meaning": protection["meaning"],
        "reference": protection["reference"],
    }
    return spec


def run_protection_study(workspace, receiving, kind, spec):
    """Operate the source-context optimizer against retained original polygon geometry."""
    from model import conservation_optimization as optimization

    state = receiving.run(kind + ".prepare", lambda: conservation.prepare(workspace, spec))
    study = receiving.run(kind + ".build", lambda: conservation.build(workspace, state["id"]))
    inspected = receiving.run(
        kind + ".inspect",
        lambda: conservation.inspect(workspace, study["id"], include_candidates=True),
    )
    candidates = inspected["candidates"]
    rows = {str(row["id"]): row for row in candidates}
    if len(rows) != len(candidates):
        raise ValueError("Protection study contains duplicate native watershed identifiers")
    positive_ids = []
    for identifier, row in rows.items():
        area = row.get("source_water_area_ha")
        if not isinstance(area, (int, float)) or not math.isfinite(area) or area < 0:
            raise ValueError("The retained protection study needs a finite source-water area for " + identifier)
        if row.get("eligible", False) and area > 0:
            positive_ids.append(identifier)
    positive_ids.sort()
    if not positive_ids:
        raise ValueError("The actual reporting selection has no eligible watershed intersecting the published protection polygons")

    request = {
        "study_id": study["id"],
        "title": "Watersheds intersecting published source-water protection areas - " + kind,
        "objective": {"kind": "source-context", "basis": "total"},
        "weights": {"source_water_area_ha": 1},
        "constraints": {"area_basis": "reporting"},
        "stability": True,
    }
    preview = receiving.run(kind + ".optimization_preview", lambda: optimization.preview(workspace, request))
    saved = receiving.run(
        kind + ".optimization_save",
        lambda: optimization.save(workspace, preview["request"], retained_analysis=preview),
    )
    plan = saved["plan"]
    selected = [str(value) for value in saved["selected_ids"]]
    if not selected or len(set(selected)) != len(selected):
        raise ValueError("The source-water optimizer must retain a nonempty unique native selection")
    if set(selected) != {str(value) for value in plan["selected_ids"]}:
        raise ValueError("Saved optimizer result and original conservation plan disagree")
    if sorted(selected) != sorted(str(value) for value in preview["selected_ids"]):
        raise ValueError("The immutable source study changed between optimizer preview and save")
    if not set(selected).issubset(positive_ids):
        raise ValueError("The source-water plan selected an ineligible or zero-overlap watershed")
    if saved["union_summary"] != plan["summary"]:
        raise ValueError("The optimizer union summary differs from its original saved conservation plan")
    union_source_water = plan["summary"].get("source_water_area_ha")
    if not isinstance(union_source_water, (int, float)) or not math.isfinite(union_source_water) or union_source_water <= 0:
        raise ValueError("The selected reporting union must retain positive measured source-water overlap")

    packet = receiving.run(
        kind + ".optimization_export",
        lambda: optimization.export(workspace, plan["id"]),
    )
    packet_path = relative_file(workspace.root, packet["path"])
    packet_fact = file_fact(packet_path)
    if packet_fact["sha256"] != packet["sha256"] or packet_fact["bytes"] != packet["bytes"]:
        raise ValueError("The protection plan packet differs from its returned identity")

    def reopen():
        reopened_workspace = Workspace(workspace.root)
        reopened_plan = conservation.get_plan(reopened_workspace, plan["id"])
        for key in ("id", "study_id", "selected_ids", "selection", "files", "summary"):
            if key in plan and reopened_plan.get(key) != plan[key]:
                raise ValueError("The reopened protection plan changed field " + key)
        reopened_analysis = optimization.get_analysis(
            reopened_workspace, study["id"], saved["analysis"]["id"],
        )
        if reopened_analysis["state"] != saved["analysis"]:
            raise ValueError("The reopened optimizer analysis changed its retained identity or files")
        if sorted(str(value) for value in reopened_analysis["analysis"]["selected_ids"]) != sorted(selected):
            raise ValueError("The reopened optimizer analysis changed the original selected watershed IDs")
        return {"plan": reopened_plan, "analysis": reopened_analysis["state"]}

    reopened = receiving.run(kind + ".reopen_plan_and_analysis", reopen)
    result = {
        "study_id": study["id"],
        "title": spec["title"],
        "mode": study.get("mode", "source_context"),
        "metric_state": study.get("metric_state"),
        "selection": spec,
        "summary": study["summary"],
        "actual_candidate_count": len(candidates),
        "eligible_positive_protection_overlap_count": len(positive_ids),
        "eligible_positive_protection_overlap_huc12": positive_ids,
        "selected_original_huc12": selected,
        "selected_watershed_context": [
            {
                key: rows[identifier].get(key)
                for key in (
                    "id", "label", "source_identity", "area_ha", "reporting_area_ha",
                    "source_water_area_ha", "source_water_fraction", "eligible",
                )
            }
            for identifier in selected
        ],
        "plan_id": plan["id"],
        "plan_summary": plan["summary"],
        "optimization": {
            "request": request,
            "analysis": saved["analysis"],
            "preview_counts": preview.get("counts"),
            "preview_selection": preview.get("selection"),
            "saved_union_summary": saved["union_summary"],
            "reopened_analysis": reopened["analysis"],
            "reopened_analysis_selection_matches": True,
            "source_water_reporting_union_area_ha": union_source_water,
        },
        "packet": packet,
        "packet_absolute_path": str(packet_path),
        "reopened_plan_id": reopened["plan"]["id"],
        "reopened_selection_matches": True,
        "interpretation": {
            "study_score": "Fraction of each reporting watershed unit intersecting the published protection polygons",
            "plan_objective": "Total source-water protection overlap in hectares from eligible reporting watershed units",
            "plan_constraints": "Reporting-area basis; the selection includes the feasible positive geographic objective",
            "whole_unit_footprint": "Original selected WBD HUC12 geometries retained separately from reporting intersections",
            "protection_overlap": "Original 200-foot and 1500-foot protection polygons are unioned before intersection",
        },
    }
    receiving.result["studies"][kind] = result
    receiving.persist()
    return result



def run_catalog_study(workspace, receiving, kind):
    """Operate the source-bound candidate catalog on an existing regional study."""
    from model import conservation_catalog as catalog

    record = receiving.result["studies"][kind]
    study_id = record["study_id"]
    inspected = receiving.run(
        kind + ".catalog.original_inventory",
        lambda: conservation.inspect(workspace, study_id, include_candidates=True),
    )
    originals = inspected["candidates"]
    original_rows = {row["id"]: row for row in originals}
    if len(original_rows) != len(originals) or not all(isinstance(key, str) for key in original_rows):
        raise ValueError("The original catalog inventory needs unique native text IDs")
    prepared = receiving.run(kind + ".catalog.prepare", lambda: catalog.prepare(workspace, study_id))
    if prepared.get("state") != "complete" or prepared["counts"]["total"] != len(originals):
        raise ValueError("The completed catalog differs from the original candidate count")

    def verified_file(descriptor):
        path = relative_file(workspace.root, descriptor["path"])
        actual = file_fact(path)
        if actual["bytes"] != descriptor["bytes"] or actual["sha256"] != descriptor["sha256"]:
            raise ValueError("Catalog receiving file differs from its original descriptor: " + descriptor["path"])
        return path

    verified_file(prepared["files"]["index"])

    def pages(selection, retained=None):
        offset, rows, pages_seen = 0, [], []
        total = None
        seen = set()
        while True:
            request = {**selection, "offset": offset, "limit": 100}
            page = catalog.query(workspace, study_id, request, retained)
            if page["study_id"] != study_id or page["index_id"] != prepared["id"]:
                raise ValueError("A candidate page changed the original study or index")
            if total is None:
                total = page["total"]
            if page["total"] != total or page["original_count"] != len(originals):
                raise ValueError("The candidate count changed while paging the original inventory")
            for row in page["candidates"]:
                key = row["id"]
                if key in seen or key not in original_rows or row != original_rows[key]:
                    raise ValueError("A paged record differs from its original candidate: " + key)
                seen.add(key)
                rows.append(row)
            if retained is not None and retained.get("selected_only"):
                if set(page["selected_ids_on_page"]) != {row["id"] for row in page["candidates"]}:
                    raise ValueError("Selected-only page membership differs from its native candidate rows")
            pages_seen.append({
                "offset": page["offset"], "count": len(page["candidates"]),
                "total": page["total"], "next_offset": page["next_offset"],
                "selected_ids_on_page": page["selected_ids_on_page"],
            })
            following = page["next_offset"]
            if following is None:
                break
            if not isinstance(following, int) or following <= offset:
                raise ValueError("The candidate page did not advance its original offset")
            offset = following
        if len(rows) != total:
            raise ValueError("The complete paged inventory differs from its declared count")
        return {"rows": rows, "pages": pages_seen, "total": total}

    original_pages = receiving.run(
        kind + ".catalog.page_originals",
        lambda: pages({"filters": {}, "sort": "id", "direction": "asc"}),
    )
    if {row["id"] for row in original_pages["rows"]} != set(original_rows):
        raise ValueError("The complete catalog omitted an original candidate")

    filters = {"eligible": "yes"}
    expected = sorted(row["id"] for row in originals if row.get("eligible", False))
    threshold = None
    if kind.startswith("protection_"):
        positive = [
            row for row in originals if row.get("eligible", False)
            and isinstance(row.get("source_water_fraction"), (int, float))
            and math.isfinite(row["source_water_fraction"]) and row["source_water_fraction"] > 0
        ]
        if not positive:
            raise ValueError("The original protection study has no eligible positive-overlap catalog cohort")
        threshold = min(row["source_water_fraction"] for row in positive)
        filters["source_water_fraction"] = {"min": threshold}
        expected = sorted(row["id"] for row in positive)
    if not expected:
        raise ValueError("The original candidate study has no eligible retained selection")
    selection = {"filters": filters, "sort": "rank", "direction": "asc"}
    retained = receiving.run(
        kind + ".catalog.retain_cohort", lambda: catalog.select(workspace, study_id, selection),
    )
    if retained["count"] != len(expected):
        raise ValueError("The retained catalog cohort differs from the original eligible source selection")
    selection_path = verified_file(retained["files"]["selected_ids"])
    retained_file = json.loads(selection_path.read_text(encoding="utf-8"))
    if retained_file["selected_ids"] != expected:
        raise ValueError("The retained full catalog ID file differs from the original selection")

    # Exercise a retained-cohort edit with a stated deterministic original ID.
    excluded = expected[-1:] if len(expected) > 1 else []
    selected_ids = [key for key in expected if key not in excluded]
    membership = {
        "selection_id": retained["selection_id"], "include_ids": [],
        "exclude_ids": excluded, "selected_only": True,
    }
    selected_pages = receiving.run(
        kind + ".catalog.page_retained",
        lambda: pages({"filters": {}, "sort": "id", "direction": "asc"}, membership),
    )
    if [row["id"] for row in selected_pages["rows"]] != selected_ids:
        raise ValueError("The edited catalog cohort does not retain the original native membership")
    plan_request = {
        "study_id": study_id, "selection_id": retained["selection_id"],
        "include_ids": [], "exclude_ids": excluded,
        "plan": {
            "title": "Catalog receiving selection - " + kind,
            "mode": "manual", "include_ineligible": False,
            "limits": {"area_basis": "whole_units"},
        },
    }
    saved = receiving.run(
        kind + ".catalog.save_original_plan",
        lambda: catalog.save_selected_plan(workspace, plan_request),
    )
    plan = saved["plan"]
    if (saved["resolved_count"] != len(selected_ids)
            or saved["plan_id"] != plan["id"]
            or sorted(plan["selected_ids"]) != selected_ids):
        raise ValueError("The catalog plan changed its resolved original selection")
    plan_binding = plan["selection"]["catalog_selection"]
    if (plan_binding["selection_id"] != retained["selection_id"]
            or plan_binding["source_inventory"] != retained["source_inventory"]
            or plan_binding["exclude_ids"] != excluded
            or plan_binding["resolved_count"] != len(selected_ids)):
        raise ValueError("The saved original plan lost its retained catalog binding")
    exported = receiving.run(
        kind + ".catalog.export_rows",
        lambda: catalog.export_rows(
            workspace, study_id, {"filters": {}, "sort": "id", "direction": "asc"}, membership,
        ),
    )
    if exported["count"] != len(selected_ids):
        raise ValueError("The full catalog export differs from its resolved native cohort")
    export_paths = {key: verified_file(value) for key, value in exported["files"].items()}
    exported_originals = json.loads(export_paths["json"].read_text(encoding="utf-8"))["candidates"]
    if exported_originals != selected_pages["rows"]:
        raise ValueError("The full JSON export differs from the original selected candidate records")
    import csv
    with export_paths["csv"].open(encoding="utf-8-sig", newline="") as handle:
        exported_csv = list(csv.DictReader(handle))
    if [row["id"] for row in exported_csv] != selected_ids:
        raise ValueError("The CSV export does not retain the complete original HUC12 IDs")
    packet = receiving.run(
        kind + ".catalog.export_original_plan",
        lambda: conservation.export_packet(workspace, study_id, plan["id"]),
    )
    packet_path = verified_file(packet)

    def reopen():
        fresh = Workspace(workspace.root)
        restored_selection = catalog.get_selection(
            fresh, study_id, retained["selection_id"], include_ids=True,
        )
        if restored_selection["selected_ids"] != expected:
            raise ValueError("The independently reopened retained cohort changed its original IDs")
        restored_plan = conservation.get_plan(fresh, plan["id"])
        for key in ("id", "study_id", "selected_ids", "selection", "summary", "files"):
            if restored_plan.get(key) != plan.get(key):
                raise ValueError("The independently reopened catalog plan changed " + key)
        restored_export = catalog.export_rows(
            fresh, study_id, {"filters": {}, "sort": "id", "direction": "asc"}, membership,
        )
        if (restored_export["id"] != exported["id"]
                or restored_export["reference"] != exported["reference"]
                or restored_export["files"] != exported["files"]):
            raise ValueError("The independently reopened catalog export changed its source or files")
        for item in restored_export["files"].values():
            verified_file(item)
        return {
            "selection_id": restored_selection["selection_id"], "plan_id": restored_plan["id"],
            "selected_original_huc12": sorted(restored_plan["selected_ids"]),
            "export_id": restored_export["id"], "source_inventory": restored_selection["source_inventory"],
        }

    reopened = receiving.run(kind + ".catalog.reopen_originals", reopen)
    result = {
        "study_key": kind, "study_id": study_id, "index": prepared,
        "original_candidate_count": len(originals),
        "original_pages": original_pages["pages"],
        "cohort_selection": selection,
        "minimum_actual_positive_source_water_fraction": threshold,
        "retained": retained,
        "retained_original_huc12": expected,
        "manual_adjustment": {
            "rule": "Remove the lexicographically last original HUC12 when the receiving cohort has multiple units",
            "include_ids": [], "exclude_ids": excluded,
        },
        "selected_original_huc12": selected_ids,
        "selected_pages": selected_pages["pages"], "plan_id": plan["id"],
        "plan_selection": plan["selection"], "plan_summary": plan["summary"],
        "row_export": exported, "packet": packet, "packet_absolute_path": str(packet_path),
        "reopened": reopened,
        "reopened_selection_matches": True,
    }
    receiving.result["candidate_catalog"] = result
    receiving.persist()
    return result


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--domain-manifest", type=Path)
    parser.add_argument("--geography-manifest", type=Path)
    parser.add_argument("--public-water-manifest", type=Path,
                        help="Existing prepare_public_water native sources.json to import into this Workspace.")
    parser.add_argument("--public-water-preparation", type=Path,
                        help="Existing public-water-preparation.json; use its actual imported collection identity.")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--prepare-catalog", action="store_true",
                        help="Operate candidate paging, retained selection and original plan/export on this same regional study.")
    parser.add_argument("--catalog-study", choices=(
        "upstream", "reporting", "protection_upstream", "protection_reporting",
    ), help="Default to protection_upstream when present, otherwise upstream.")
    parser.add_argument("--from-codes", nargs="+", type=int)
    parser.add_argument("--to-code", type=int)
    parser.add_argument("--scenario-reason")
    parser.add_argument("--scenario-title")
    parser.add_argument("--scenario-study", choices=(
        "upstream", "reporting", "protection_upstream", "protection_reporting",
    ), default="upstream")
    parser.add_argument("--grid-id")
    parser.add_argument("--profile-id")
    parser.add_argument("--models", nargs="+", choices=("ndr", "sdr"))
    parser.add_argument("--prepare-experiment", action="store_true")
    parser.add_argument("--execute-experiment", action="store_true")
    parser.add_argument("--experiment-title")
    parser.add_argument("--experiment-profile-id", action="append", default=[])
    parser.add_argument("--experiment-axes", type=Path)
    parser.add_argument("--experiment-design", choices=("one_at_a_time", "factorial"), default="one_at_a_time")
    args = parser.parse_args(argv)
    if args.catalog_study and not args.prepare_catalog:
        parser.error("--catalog-study requires --prepare-catalog")
    scenario_values = (args.from_codes, args.to_code is not None, args.scenario_reason)
    if any(scenario_values) and not all(scenario_values):
        parser.error("--from-codes, --to-code and --scenario-reason are required together")
    if bool(args.grid_id) != bool(args.profile_id):
        parser.error("--grid-id and --profile-id are required together")
    if args.grid_id and not args.from_codes:
        parser.error("Native run preparation requires the explicit land-cover scenario arguments")
    if args.models and not args.grid_id:
        parser.error("--models requires the selected --grid-id and --profile-id")
    if (args.prepare_experiment or args.execute_experiment) and not args.grid_id:
        parser.error("Paired experiments require the selected grid, profile and land-cover change")
    if (args.experiment_title or args.experiment_profile_id or args.experiment_axes
            or args.experiment_design != "one_at_a_time") and not (args.prepare_experiment or args.execute_experiment):
        parser.error("Choose --prepare-experiment or --execute-experiment with experiment settings")
    if args.models and len(args.models) != len(set(args.models)):
        parser.error("Select each native model once")
    return args


def main(argv=None):
    args = arguments(argv)
    workspace_path = args.workspace.expanduser().resolve()
    output = args.output or workspace_path / "conservation-receiving" / "regional-receiving.json"
    receiving = Receiving(output, workspace_path)
    try:
        workspace = receiving.run("open_workspace", lambda: Workspace(workspace_path))
        receiving.result["opening_source_collection_ids"] = [row["id"] for row in workspace.sources()]
        for name, manifest in (
            ("domain", args.domain_manifest), ("geography", args.geography_manifest),
            ("public_water", args.public_water_manifest),
        ):
            if manifest is not None:
                receiving.run("import_" + name, lambda path=manifest: workspace.import_sources(path.expanduser().resolve()))
        domain = receiving.run("resolve_domain", lambda: resolve_original(workspace, "domain"))
        if domain is None:
            raise ValueError("Import the original 217-HUC model-domain sources.json with --domain-manifest")
        focus = receiving.run("resolve_focus", lambda: resolve_original(workspace, "focus"))
        if focus is None:
            focus = receiving.run("receive_retained_focus", lambda: promote_original_focus(workspace, domain))
        if focus is None:
            focus = receiving.run("select_original_domain_focus", lambda: derive_original_focus(workspace, domain))
        reporting = receiving.run("resolve_reporting", lambda: resolve_original(workspace, "reporting"))
        receiving.result["sources"] = {
            name: {key: value for key, value in binding.items() if key != "entry"}
            for name, binding in (("domain", domain), ("focus", focus), ("reporting", reporting))
            if binding is not None
        }
        receiving.persist()
        run_study(workspace, receiving, "upstream", study_spec("upstream", domain, focus))
        if reporting is None:
            try:
                reporting = receiving.run(
                    "receive_original_reporting", lambda: receive_original_reporting(workspace),
                )
                if reporting is not None:
                    receiving.result["sources"]["reporting"] = {
                        key: value for key, value in reporting.items() if key != "entry"
                    }
            except Exception as exc:
                receiving.result["reporting_source_receive"] = {
                    "state": "source_attempt_failed",
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                    "original_base_url": GEOGRAPHY_BASE,
                }
                receiving.result["state"] = "running"
                receiving.persist()
        if reporting is not None:
            run_study(workspace, receiving, "reporting", study_spec("reporting", domain, focus, reporting))
            receiving.result["reporting_source_status"] = "received_and_operated"
        else:
            receiving.result["reporting_source_status"] = "original_geography_required"
            receiving.result["reporting_source_required"] = {
                "source_id": ORIGINALS["reporting"]["id"],
                "sha256": ORIGINALS["reporting"]["sha256"],
                "layer": "PlanningBasins2023",
                "where": {"Basin": "Upper Savannah"},
                "required_original_members": [
                    "PlanningBasins2023.shp", "PlanningBasins2023.shx",
                    "PlanningBasins2023.dbf", "PlanningBasins2023.prj",
                ],
                "receive": "Pass the original complete geography sources.json to --geography-manifest and resume this same command.",
            }
        protection = receiving.run(
            "resolve_published_protection",
            lambda: resolve_public_water(workspace, args.public_water_preparation),
        )
        if protection is not None:
            receiving.result["sources"]["protection_areas"] = {
                key: value for key, value in protection.items() if key != "entry"
            }
            receiving.persist()
            run_protection_study(
                workspace, receiving, "protection_upstream",
                protection_study_spec("upstream", domain, protection),
            )
            if reporting is not None:
                run_protection_study(
                    workspace, receiving, "protection_reporting",
                    protection_study_spec("reporting", domain, protection, reporting),
                )
            receiving.result["source_water_protection_status"] = "received_and_operated"
        else:
            if args.public_water_manifest is not None:
                raise ValueError("The supplied public-water manifest must import the retained original protection polygon entry")
            receiving.result["source_water_protection_status"] = "source_not_in_this_workspace"
            receiving.result["source_water_protection_original"] = {
                "source_id": ORIGINALS["protection_areas"]["id"],
                "sha256": ORIGINALS["protection_areas"]["sha256"],
                "bytes": ORIGINALS["protection_areas"]["bytes"],
                "object_ids": list(PROTECTION_OBJECT_IDS),
                "reference": PROTECTION_URI,
                "receive": (
                    "Reuse prepare_public_water's existing native sources.json through --public-water-manifest "
                    "and its public-water-preparation.json through --public-water-preparation."
                ),
            }
        if args.prepare_catalog:
            catalog_key = args.catalog_study or (
                "protection_upstream" if "protection_upstream" in receiving.result["studies"] else "upstream"
            )
            if catalog_key not in receiving.result["studies"]:
                raise ValueError("The selected catalog study needs its original source and completed study")
            run_catalog_study(workspace, receiving, catalog_key)
        if args.from_codes:
            if args.scenario_study not in receiving.result["studies"]:
                raise ValueError("The selected scenario study needs its original reporting source first")
            from model.conservation_scenarios import create_scenario
            selected_study = receiving.result["studies"][args.scenario_study]
            request = {
                "plan_id": selected_study["plan_id"],
                "title": args.scenario_title or "Selected watershed plan - explicit land-cover alternative",
                "reason": args.scenario_reason,
                "from_codes": args.from_codes,
                "to_code": args.to_code,
            }
            if args.grid_id:
                request["prepare_run"] = {"grid_id": args.grid_id, "profile_id": args.profile_id}
                if args.models and set(args.models) != {"ndr", "sdr"}:
                    request["prepare_run"]["models"] = args.models
            if args.prepare_experiment or args.execute_experiment:
                request["prepare_experiment"] = {
                    "title": args.experiment_title or request["title"] + " - paired experiment",
                    "reason": args.scenario_reason,
                    "profile_ids": args.experiment_profile_id,
                    "design": args.experiment_design,
                }
                if args.experiment_axes:
                    request["prepare_experiment"]["axes"] = json.loads(
                        args.experiment_axes.expanduser().read_text(encoding="utf-8"),
                    )
            receiving.result["scenario"] = receiving.run(
                "create_landcover_scenario", lambda: create_scenario(workspace, request),
            )
            receiving.persist()
            if args.execute_experiment:
                from model import experiments
                experiment_id = receiving.result["scenario"]["experiment_id"]
                receiving.result["experiment"] = receiving.run(
                    "execute_native_paired_experiment",
                    lambda: experiments.execute(workspace, experiment_id),
                )
                reopened_workspace = Workspace(workspace_path)
                receiving.result["experiment_reopened"] = receiving.run(
                    "reopen_native_paired_experiment",
                    lambda: experiments.read_summary(reopened_workspace, experiment_id),
                )
                if (receiving.result["experiment_reopened"] or {}).get("state") != "complete":
                    raise ValueError("Reopen the completed native experiment summary in its original workspace")
                receiving.persist()
        receiving.result.update(
            state="complete" if reporting is not None else "upstream_complete",
            completed_at=utc_now(),
            completed_studies=list(receiving.result["studies"]),
            interpretation={
                "planning_units": "Original WBD HUC12 watershed polygons",
                "context": "Geographic overlap with four retained utility-focus watersheds",
                "ranking": "Declared utility-focus polygon overlap score",
                "source_water_protection": (
                    "Additional studies optimize actual published protection overlap in hectares"
                    if protection is not None else receiving.result["source_water_protection_status"]
                ),
                "reporting_boundary": "Original PlanningBasins2023 Upper Savannah feature when present",
                "rfp": RFP_URI,
            },
        )
        receiving.persist()
        print(json.dumps({
            "state": receiving.result["state"],
            "receiving": str(Path(output).resolve()),
            "completed_studies": receiving.result["completed_studies"],
            "scenario_id": receiving.result.get("scenario", {}).get("scenario_id"),
            "experiment_id": receiving.result.get("scenario", {}).get("experiment_id"),
            "experiment_state": receiving.result.get("experiment", {}).get("state"),
            "catalog_plan_id": receiving.result.get("candidate_catalog", {}).get("plan_id"),
            "studies": {
                name: {key: row[key] for key in ("study_id", "plan_id", "selected_original_huc12", "packet_absolute_path")}
                for name, row in receiving.result["studies"].items()
            },
            "elapsed_seconds": receiving.result["elapsed_seconds"],
        }, indent=2), flush=True)
        return 0
    except Exception as exc:
        receiving.result.update(state="failed", error_type=type(exc).__name__, error=str(exc))
        receiving.persist()
        raise


if __name__ == "__main__":
    raise SystemExit(main())
