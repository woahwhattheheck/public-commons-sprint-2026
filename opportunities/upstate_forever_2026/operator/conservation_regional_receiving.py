#!/usr/bin/env python3
"""Operate the retained Upper Savannah conservation studies and receiving journey.

Run from the complete product root:
  python -B operator/conservation_regional_receiving.py --workspace EXISTING_WORKSPACE \
    --domain-manifest ORIGINAL_DOMAIN/sources.json \
    --geography-manifest ORIGINAL_GEOGRAPHY/sources.json

Already imported originals are reused. The geography argument is optional when
its real entries are already imported. Missing reporting files are received from
the exact pinned public source after the upstream journey. A four-HUC companion can supply
the exact original utility-focus source. The South Carolina reporting study
uses the original PlanningBasins2023 feature when available. The complete
upstream-domain journey runs first and is retained independently.

When the published protection polygons are imported, this same workflow also
builds the upstream and reporting source-water priority studies, operates the
source-context optimizer, saves its original conservation plans, exports their
packets and reopens each plan and analysis. Pass the already prepared native
--public-water-manifest and --public-water-preparation when receiving those
sources in another Workspace. Their actual imported collection ID is retained.

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
    expected = ORIGINALS[name]
    matches = []
    for collection in workspace.sources():
        if collection_id is not None and str(collection["id"]) != str(collection_id):
            continue
        for entry in collection.get("entries", []):
            if entry.get("id") == expected["id"] and entry.get("body", {}).get("sha256") == expected["sha256"]:
                matches.append((str(collection["id"]), entry))
    if not matches:
        return None
    collection_id, _ = sorted(matches, key=lambda row: row[0])[0]
    path, entry = workspace.source_file(collection_id, expected["id"])
    actual = file_fact(path)
    if actual["sha256"] != expected["sha256"]:
        raise ValueError("Original source hash mismatch for " + expected["id"])
    if expected.get("bytes") is not None and actual["bytes"] != expected["bytes"]:
        raise ValueError("Original source byte length mismatch for " + expected["id"])
    return {
        "source_collection_id": collection_id,
        "source_id": expected["id"],
        "path": str(path),
        "body": actual,
        "label": expected["label"],
        "equivalent_collection_ids": sorted({row[0] for row in matches}),
        "entry": entry,
    }


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
        if original_preparation.get("original_protection_features") != len(PROTECTION_OBJECT_IDS):
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
            }
    return binding


def selection(binding):
    return {key: binding[key] for key in ("source_collection_id", "source_id")}


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
                "relation": "Polygon intersection with the four original utility-focus HUC12 watersheds",
                "meaning": "Utility-focus watershed geographic context",
                "reference": FOCUS_URI,
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
    saved = receiving.run(kind + ".optimization_save", lambda: optimization.save(workspace, request))
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
            raise ValueError("Import the retained original geography sources.json with --geography-manifest")
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
                if args.models:
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
