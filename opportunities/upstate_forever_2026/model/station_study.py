"""Prepare the actual Upper Savannah assessment study from retained original inputs.

This module resolves original source identities into an editable study selection.
It performs no remote acquisition and does not change a workspace when catalogued.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path

from .common import atomic_bytes, atomic_json, digest, file_digest

STUDY_ID = "upper-savannah-assessment-2026-87"
TITLE = "Upper Savannah assessment — 87 monitoring stations"
ATLAS_SHA = "14b1a945ee8d5f172f63435b4fd955e9dada6894fcbca2964160c6e2e52d79f0"
WQP_GEOJSON_SHA = "d7322856d96cdd6898a5cef555e97529f99ec4d6dad7ab45d18f4d53f3b646e6"
WQP_CSV_SHA = "21022c3f3b46fb0bae6e341cde74880ec2e395528592f9168742f53af60b533e"
ASSESSMENT_SHA = "545a4e1413012b8f17c81c8afe815dd1e225ade5f5b9792ca22e83ef8723307f"
DOMAIN_SHA = "2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af"
ASSESSMENT_URI = "https://apps.des.sc.gov/PublicNotices/SearchAndDisplay/PDF/302110"
SUPPLEMENT_URI = "https://www.waterqualitydata.us/data/Station/search?siteid=21SC60WQ_WQX-SV-376%3B21SC60WQ_WQX-RS-24163%3B21SC60WQ_WQX-RS-21014%3B21SC60WQ_WQX-RL-21217%3B21SC60WQ_WQX-RL-24073%3B21SC60WQ_WQX-RL-21209%3B21SC60WQ_WQX-RS-22078%3B21SC60WQ_WQX-RL-21225&mimeType=csv"
ATLAS_URI = "https://gis.des.sc.gov/gisserver/rest/services/water/BW_Monitoring_Stations/MapServer/9"


def _entries(workspace):
    rows = []
    for collection in sorted(workspace._list("sources"), key=lambda item: item["id"]):
        for entry in collection["entries"]:
            rows.append((collection, entry))
    return rows


def _by_hash(rows, accepted, kind=None):
    accepted = set(accepted)
    candidates = [(collection, entry) for collection, entry in rows
                  if entry["body"]["sha256"] in accepted and (kind is None or entry["kind"] in kind)]
    return candidates[0] if candidates else None


def _ref(item, **fields):
    collection, entry = item
    return {"collection_id": collection["id"], "source_id": entry["id"],
            "source_sha256": entry["body"]["sha256"], **fields}


def _assessment_rows(workspace, item):
    reference = _ref(item)
    path, unused_entry = workspace.source_file(reference["collection_id"], reference["source_id"])
    raw = Path(path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != ASSESSMENT_SHA:
        raise ValueError("The retained 2026 assessment inventory differs from the selected original edition")
    table = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
    if not table.fieldnames or not {"site", "huc12", "cause"} <= set(table.fieldnames):
        raise ValueError("The retained assessment inventory lacks its original site, HUC12 or cause fields")
    rows = list(table)
    if any(None in row or not row.get("site") for row in rows):
        raise ValueError("The retained assessment inventory has an incomplete native row")
    return rows


def _domain(workspace, rows):
    """Find the actual retained domain, checking its decoded original byte identity."""
    candidates = []
    for collection, entry in rows:
        body = entry["body"]
        label = " ".join(str(entry.get(key, "")) for key in ("id", "title", "path"))
        label += " " + str(body.get("filename", ""))
        if entry["kind"] != "vector":
            continue
        if body["sha256"] == DOMAIN_SHA or "model-domain" in label.lower() or "model domain" in label.lower():
            candidates.append((collection, entry))
    problems = []
    for item in candidates:
        reference = _ref(item)
        try:
            path, unused_entry = workspace.source_file(reference["collection_id"], reference["source_id"])
            raw = Path(path).read_bytes()
            if raw[:2] == b"\x1f\x8b":
                with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
                    raw = stream.read(16 * 1024 * 1024 + 1)
            if len(raw) > 16 * 1024 * 1024:
                continue
            if hashlib.sha256(raw).hexdigest() != DOMAIN_SHA:
                continue
            original = json.loads(raw.decode("utf-8-sig"))
            features = original.get("features", [])
            fields = [field["name"] for field in original.get("fields", [])
                      if str(field.get("name", "")).lower() == "huc12"]
            if not fields and features:
                fields = [field for field in features[0].get("attributes", {}) if field.lower() == "huc12"]
            if len(fields) != 1 or not features:
                raise ValueError("The retained upstream domain has no unique native HUC12 field")
            field = fields[0]
            ids = [feature.get("attributes", {}).get(field) for feature in features]
            if any(not isinstance(value, str) or len(value) != 12 or not value.isdigit() for value in ids):
                raise ValueError("Preserve the upstream domain's original twelve-character HUC12 identifiers")
            if len(set(ids)) != len(ids):
                raise ValueError("The retained upstream domain repeats a native HUC12 identifier")
            return _ref(item, id_field=field), len(features), []
        except (OSError, ValueError, TypeError, KeyError) as problem:
            problems.append("Retained upstream domain: " + str(problem))
    return None, 0, problems


def prepared_studies(workspace):
    """Return a one-click original-data study for the existing operator catalogue."""
    rows = _entries(workspace)
    atlas = _by_hash(rows, [ATLAS_SHA], {"vector"})
    wqp = _by_hash(rows, [WQP_GEOJSON_SHA], {"vector"})
    if wqp is None:
        wqp = _by_hash(rows, [WQP_CSV_SHA], {"vector", "table"})
    assessment = _by_hash(rows, [ASSESSMENT_SHA], {"table"})
    domain, domain_count, problems = _domain(workspace, rows)
    missing = []
    if atlas is None:
        missing.append("Import the original 705-station SCDES Savannah monitoring layer.")
    if wqp is None:
        missing.append("Import the eight-station WQP supplement from the corrected complete source package.")
    if assessment is None:
        missing.append("Import the original 2026 assessment inventory with 101 rows at 87 sites.")
    if domain is None:
        missing.append("Import the retained 217-HUC12 upstream model-domain source and its original manifest.")
    missing.extend(problems)
    selection = {"title": TITLE, "sources": [], "site_tables": [], "watersheds": [],
                 "observation_ids": [], "observation_tables": [], "sites": [],
                 "aliases": {}, "choices": {}}
    if atlas is not None:
        selection["sources"].append(_ref(atlas, station_id_field="STAT", native_id_field="OBJECTID"))
    if wqp is not None:
        reference = _ref(wqp, station_id_field="MonitoringLocationName",
                         native_id_field="MonitoringLocationIdentifier")
        if wqp[1]["body"]["sha256"] == WQP_CSV_SHA:
            reference.update(x_field="LongitudeMeasure", y_field="LatitudeMeasure",
                             source_crs="EPSG:4326", format="csv")
        selection["sources"].append(reference)
    assessment_count = station_count = 0
    if assessment is not None:
        try:
            inventory = _assessment_rows(workspace, assessment)
            assessment_count = len(inventory)
            station_count = len({row["site"] for row in inventory})
            selection["site_tables"].append(_ref(assessment, station_id_field="site"))
        except (OSError, ValueError, TypeError, KeyError) as problem:
            missing.append("Retained assessment inventory: " + str(problem))
    if domain is not None:
        selection["watersheds"].append(domain)
    return [{"id": STUDY_ID, "title": TITLE, "ready": not missing, "missing": missing,
             "selection": selection,
             "source_summary": {"assessment_rows": assessment_count, "station_count": station_count,
                                "watershed_count": domain_count},
             "source_links": [{"title": "Original monitoring layer", "uri": ATLAS_URI},
                              {"title": "Original WQP eight-station CSV", "uri": SUPPLEMENT_URI},
                              {"title": "Original assessment source", "uri": ASSESSMENT_URI}]}]


def _import_once(workspace, manifest):
    manifest = Path(manifest).resolve(strict=True)
    sha = file_digest(manifest)
    for collection in workspace._list("sources"):
        if collection.get("original_manifest", {}).get("sha256") == sha:
            for entry in collection["entries"]:
                workspace.source_file(collection["id"], entry["id"])
            return collection
    return workspace.import_sources(manifest)


def prepare(workspace, manifests=(), assessment_csv=None):
    """Import retained original manifests and create the editable prepared selection."""
    imported = []
    for manifest in manifests:
        imported.append(_import_once(workspace, manifest)["id"])
    if assessment_csv is not None:
        original = Path(assessment_csv).resolve(strict=True)
        raw = original.read_bytes()
        if hashlib.sha256(raw).hexdigest() != ASSESSMENT_SHA:
            raise ValueError("Choose the exact retained original 2026 assessment CSV")
        folder = workspace.root / "station-study-inputs" / ASSESSMENT_SHA
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / "assessment_listed_causes_2026_draft_original.csv"
        atomic_bytes(target, raw, immutable=True)
        manifest = folder / "sources.json"
        atomic_json(manifest, {
            "schema": "upstate.sources/v1",
            "title": "Upper Savannah original 2026 assessment station inventory",
            "entries": [{"id": "scdes-draft-ir-2026-assessment-station-inventory",
                         "title": "Original 101 assessment rows at 87 Upper Savannah monitoring sites",
                         "uri": ASSESSMENT_URI, "vintage": "2026 draft integrated report",
                         "kind": "table", "path": target.name, "sha256": ASSESSMENT_SHA,
                         "station_id_field": "site", "role": "STUDY_STATION_INVENTORY",
                         "notes": ["Retained original source_id scdes-draft-ir-2026 and page/section fields.",
                                   "Listed causes define the study inventory; measurement values remain separate."]}]
        }, immutable=True)
        imported.append(_import_once(workspace, manifest)["id"])
    study = prepared_studies(workspace)[0]
    result = {"schema": "upstate.prepared-station-study/v1", "study": study,
              "imported_collection_ids": imported}
    if study["ready"]:
        selection = study["selection"]
        operation_id = digest({"study_id": STUDY_ID, "selection": selection})
        folder = workspace.root / "station-study-selections" / operation_id
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "selection.json"
        atomic_json(path, selection, immutable=True)
        result.update(selection_path=str(path), operation_id=operation_id,
                      action="station.geography.build", payload={"selection": selection})
    return result


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--source-manifest", action="append", default=[],
                        help="Existing original sources.json; repeat for monitoring, WQP and domain sources")
    parser.add_argument("--assessment-csv", help="The retained original 101-row assessment inventory")
    args = parser.parse_args(argv)
    result = prepare(Workspace(args.workspace), args.source_manifest, args.assessment_csv)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0 if result["study"]["ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
