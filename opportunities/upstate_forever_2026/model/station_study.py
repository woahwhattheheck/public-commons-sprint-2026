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

from .common import atomic_bytes, atomic_json, canonical, digest, file_digest

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
PUBLISHED_WQP_TWO_SHA = "5588a64fbae5229687aef7063948083f05b5f0639dfd108ae0c3db40614677cd"
PUBLISHED_STUDY_ID = "upper-savannah-published-assessments-2024-2026-159"
PUBLISHED_TITLE = "Upper Savannah published assessments — 159 monitoring stations"
ALL_STUDY_ID = "upper-savannah-assessments-all-editions-164"
ALL_TITLE = "Upper Savannah assessment editions — 164 monitoring stations"
PUBLISHED_ASSESSMENT_SHA = "01f1a0262bb719f39d4b6c8b6e690bbf670d9aea83cbe0f532daf81b0c6a09f7"
PUBLISHED_ASSESSMENT_URI = "https://www.des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/303dList2024.pdf"
TMDL_URI = "https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/TMDLAttainmentStatus.pdf"



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



def _published_study(workspace, rows, atlas, wqp, domain, domain_count, problems, *,
                     with_inventory=False):
    """Reuse the original station sources for the complete published 159-site study."""
    from .station_inventory import published_inventory
    inventory_item = _by_hash(rows, [PUBLISHED_ASSESSMENT_SHA], {"table"})
    native_inventory=None
    native_error=None
    try:
        native_inventory=published_inventory(workspace,rows,domain)
    except (OSError,ValueError,TypeError,KeyError) as problem:
        native_error="Original normalized assessment inventory: "+str(problem)
    selection = {"title": PUBLISHED_TITLE, "sources": [], "site_tables": [], "watersheds": [],
                 "observation_ids": [], "observation_tables": [], "sites": [],
                 "aliases": {}, "choices": {}}
    missing, inventory = list(problems), []
    if native_error:
        missing.append(native_error)
    if atlas is None:
        missing.append("Import the retained original 705-station monitoring layer.")
    else:
        selection["sources"].append(_ref(atlas, station_id_field="STAT", native_id_field="OBJECTID"))
    if wqp is None:
        missing.append("Import the retained original eight-station WQP supplement.")
    else:
        reference = _ref(wqp, station_id_field="MonitoringLocationName",
                         native_id_field="MonitoringLocationIdentifier")
        if wqp[1]["body"]["sha256"] == WQP_CSV_SHA:
            reference.update(x_field="LongitudeMeasure", y_field="LatitudeMeasure",
                             source_crs="EPSG:4326", format="csv")
        selection["sources"].append(reference)
    additional=_by_hash(rows,[PUBLISHED_WQP_TWO_SHA],{"vector"})
    if additional is None:
        missing.append("Import the original WQP station-page points for RS-21038 and RS-22075.")
    else:
        selection["sources"].append(_ref(additional,station_id_field="MonitoringLocationName",
            native_id_field="MonitoringLocationIdentifier",source_crs="EPSG:4326"))
    if domain is None:
        missing.append("Import the retained original 217-HUC upstream domain.")
    else:
        selection["watersheds"].append(domain)
    if native_inventory is not None:
        inventory=native_inventory["records"]
        selection["site_tables"]=native_inventory["references"]
    elif inventory_item is None:
        missing.append("Import both original normalized published assessment banks, or the existing completed 192-record inventory for 159 sites.")
    else:
        try:
            reference = _ref(inventory_item, station_id_field="site")
            path, unused = workspace.source_file(reference["collection_id"], reference["source_id"])
            body = Path(path).read_bytes()
            if hashlib.sha256(body).hexdigest() != PUBLISHED_ASSESSMENT_SHA:
                raise ValueError("The published assessment inventory differs from its retained identity")
            reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig"), newline=""))
            required = {"id", "site", "huc12", "source_id", "source_vintage",
                        "evidence_kind", "cause_raw", "cause_label", "source_sha256", "source_uri"}
            if not reader.fieldnames or not required <= set(reader.fieldnames):
                raise ValueError("The assessment inventory lacks its edition-specific source fields")
            inventory = list(reader)
            if any(None in record or not record.get("site") for record in inventory):
                raise ValueError("An original assessment inventory row is incomplete")
            ids = {record["site"] for record in inventory}
            if len(inventory) != 192 or len(ids) != 159:
                raise ValueError("The completed published assessment study requires 192 records at 159 sites")
            if {record["source_vintage"] for record in inventory} != {"2024", "2026-07-28"}:
                raise ValueError("The selected inventory does not contain the two published assessment editions")
            selection["site_tables"].append(reference)
        except (OSError, ValueError, TypeError, KeyError) as problem:
            missing.append("Retained published assessment inventory: " + str(problem))
    editions = []
    for vintage in sorted({record["source_vintage"] for record in inventory}):
        records = [record for record in inventory if record["source_vintage"] == vintage]
        editions.append({"source_vintage": vintage, "record_count": len(records),
                         "station_count": len({record["site"] for record in records})})
    study = {"id": PUBLISHED_STUDY_ID, "title": PUBLISHED_TITLE, "ready": not missing,
            "missing": missing, "selection": selection,
            "source_summary": {"assessment_rows": len(inventory),
                               "station_count": len({record["site"] for record in inventory}),
                               "watershed_count": domain_count, "assessment_editions": editions,
                               "inventory_format":native_inventory["format"] if native_inventory else "retained_published_csv",
                               "additional_location_sites":["RS-21038","RS-22075"],
                               "additional_location_source_available":additional is not None},
            "source_links": ([{"title":"Original two-station WQP source","uri":additional[1].get("uri")}] if additional else []) +
                            [{"title": "Retained original monitoring layer", "uri": ATLAS_URI},
                             {"title": "Retained WQP point supplement", "uri": SUPPLEMENT_URI},
                             {"title": "Published 2024 assessment", "uri": PUBLISHED_ASSESSMENT_URI},
                             {"title": "TMDL status July 28, 2026", "uri": TMDL_URI}]}
    return (study, inventory) if with_inventory else study


def _all_editions_study(draft, published, draft_records, published_records):
    """Join retained source selections; never collapse distinct cause/use editions."""
    missing = list(dict.fromkeys([*draft["missing"], *published["missing"]]))
    draft_sites = {record["site"] for record in draft_records}
    published_sites = {record["site"] for record in published_records}
    sites = sorted(draft_sites | published_sites)
    records = [*published_records, *draft_records]
    selection = json.loads(json.dumps(published["selection"]))
    selection["title"] = ALL_TITLE
    selection["sites"] = sites
    for field in ("sources", "site_tables", "watersheds"):
        merged = {}
        for reference in [*published["selection"][field], *draft["selection"][field]]:
            merged.setdefault(canonical(reference), reference)
        selection[field] = json.loads(json.dumps(list(merged.values())))
    if not missing and (len(records) != 293 or len(sites) != 164):
        missing.append("The retained all-editions study requires 293 records at 164 original stations.")
    editions = [*published["source_summary"]["assessment_editions"],
                {"source_vintage": "2026 draft", "record_count": len(draft_records),
                 "station_count": len(draft_sites)}]
    publisher_hucs = {record.get("huc12") for record in records if record.get("huc12")}
    links = {}
    for reference in [*published["source_links"], *draft["source_links"]]:
        links.setdefault(reference["uri"], reference)
    return {
        "id": ALL_STUDY_ID, "title": ALL_TITLE, "ready": not missing,
        "missing": missing, "selection": selection,
        "source_summary": {
            "assessment_rows": len(records), "station_count": len(sites),
            "watershed_count": published["source_summary"]["watershed_count"],
            "publisher_huc12_count": len(publisher_hucs), "assessment_editions": editions,
            "shared_draft_published_stations": len(draft_sites & published_sites),
            "draft_only_sites": sorted(draft_sites - published_sites),
            "inventory_format": "retained_published_and_draft_inventories",
            "source_study_ids": [PUBLISHED_STUDY_ID, STUDY_ID],
        },
        "source_links": list(links.values()),
    }


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
    inventory = []
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
    draft = {"id": STUDY_ID, "title": TITLE, "ready": not missing, "missing": missing,
             "selection": selection,
             "source_summary": {"assessment_rows": assessment_count, "station_count": station_count,
                                "watershed_count": domain_count},
             "source_links": [{"title": "Original monitoring layer", "uri": ATLAS_URI},
                              {"title": "Original WQP eight-station CSV", "uri": SUPPLEMENT_URI},
                              {"title": "Original assessment source", "uri": ASSESSMENT_URI}]}
    published, published_records = _published_study(
        workspace, rows, atlas, wqp, domain, domain_count, problems, with_inventory=True)
    combined = _all_editions_study(draft, published, inventory, published_records)
    return [draft, published, combined]


def _import_once(workspace, manifest):
    manifest = Path(manifest).resolve(strict=True)
    sha = file_digest(manifest)
    for collection in workspace._list("sources"):
        if collection.get("original_manifest", {}).get("sha256") == sha:
            for entry in collection["entries"]:
                workspace.source_file(collection["id"], entry["id"])
            return collection
    return workspace.import_sources(manifest)


def prepare(workspace, manifests=(), assessment_csv=None, study_id=STUDY_ID):
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
    studies = {study["id"]: study for study in prepared_studies(workspace)}
    if study_id not in studies:
        raise ValueError("Choose a retained prepared station study")
    study = studies[study_id]
    result = {"schema": "upstate.prepared-station-study/v1", "study": study,
              "imported_collection_ids": imported}
    if study["ready"]:
        selection = study["selection"]
        operation_id = digest({"study_id": study_id, "selection": selection})
        folder = workspace.root / "station-study-selections" / operation_id
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "selection.json"
        atomic_json(path, selection, immutable=True)
        result.update(selection_path=str(path), operation_id=operation_id,
                      action="station.geography.build", payload={"selection": selection})
    return result



def operate(workspace, manifests=(), assessment_csv=None, receiving_workspace=None, study_id=STUDY_ID):
    """Prepare, build and optionally reopen the original-data station study."""
    from . import station_geography
    result = prepare(workspace, manifests, assessment_csv, study_id)
    result["workspace"] = {"root": str(workspace.root), "project_id": workspace.project["id"]}
    if not result["study"]["ready"]:
        return result
    edition = station_geography.build(workspace, result["study"]["selection"])
    edition = station_geography.inspect(workspace, edition["id"], verify=True, include_result=True)
    archives = [item for item in edition["files"] if Path(item["path"]).name == "station-geography.zip"]
    if len(archives) != 1:
        raise ValueError("The saved station study has no unique original geography archive")
    from .common import verify_file
    archive_path = verify_file(workspace.root, archives[0])
    result["edition"] = {key: edition[key] for key in ("id", "title", "build_id", "summary", "files")}
    result["archive"] = {**archives[0], "absolute_path": str(archive_path)}
    if receiving_workspace is not None:
        if receiving_workspace.root == workspace.root:
            raise ValueError("Choose a second Workspace directory for portable receiving")
        reopened = station_geography.receive(receiving_workspace, archive_path)
        reopened = station_geography.inspect(receiving_workspace, reopened["id"], verify=True, include_result=True)
        def source_identity(reference):
            reference = reference or {}
            return {key: reference.get(key) for key in
                    ("source_id", "source_sha256", "native_feature_id", "source_feature_index")}
        def membership_identity(row):
            return {"watershed_id": row["watershed_id"], "relation": row["relation"],
                    "source": source_identity(row.get("source_ref"))}
        def station_identity(row):
            return {"station_id": row["station_id"], "status": row["status"],
                    "coordinates": row["coordinates"], "watershed_status": row["watershed_status"],
                    "observation_count": row["observation_count"],
                    "selected_source": source_identity(row.get("selected_source_ref")),
                    "memberships": sorted((membership_identity(item) for item in row["watersheds"]), key=canonical),
                    "assessment_records": sorted(({key: record.get(key) for key in (
                        "assessment_record_id", "source_id", "source_vintage", "source_sha256",
                        "publisher_huc12", "cause_code", "cause_label", "use", "use_support",
                        "geographic_huc12s", "publisher_huc_relation", "original")}
                        for record in row.get("assessment_records", [])), key=canonical)}
        original_rows = sorted((station_identity(row) for row in edition["result"]["stations"]), key=canonical)
        received_rows = sorted((station_identity(row) for row in reopened["result"]["stations"]), key=canonical)
        if original_rows != received_rows or edition["summary"] != reopened["summary"]:
            raise ValueError("The reopened study differs in its original station identities or geographic memberships")
        result["received"] = {
            "workspace": {"root": str(receiving_workspace.root), "project_id": receiving_workspace.project["id"]},
            "edition": {key: reopened[key] for key in ("id", "title", "build_id", "summary", "files")},
            "original_station_memberships_preserved": True,
        }
    return result


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--create-workspace", action="store_true",
                        help="Create the original source-study Workspace if it does not yet exist")
    parser.add_argument("--build", action="store_true",
                        help="Build and verify the complete native station geography edition after preparation")
    parser.add_argument("--receive-workspace",
                        help="Reopen the completed portable archive in this second Workspace; implies --build")
    parser.add_argument("--create-receiving-workspace", action="store_true",
                        help="Create the selected second Workspace if it does not yet exist")
    parser.add_argument("--source-manifest", action="append", default=[],
                        help="Existing original sources.json; repeat for monitoring, WQP and domain sources")
    parser.add_argument("--assessment-csv", help="The retained original 101-row assessment inventory")
    parser.add_argument("--study-id", choices=(STUDY_ID, PUBLISHED_STUDY_ID, ALL_STUDY_ID), default=STUDY_ID,
                        help="Choose the original draft, published159 or complete all-editions164 study")
    args = parser.parse_args(argv)
    if args.create_receiving_workspace and not args.receive_workspace:
        parser.error("--create-receiving-workspace requires --receive-workspace")
    if args.receive_workspace and Path(args.workspace).resolve() == Path(args.receive_workspace).resolve():
        parser.error("--receive-workspace must select a second Workspace directory")
    workspace = Workspace(args.workspace, create=args.create_workspace,
                          title="Upper Savannah original assessment geography")
    receiving_workspace = (
        Workspace(args.receive_workspace, create=args.create_receiving_workspace,
                  title="Upper Savannah received original assessment geography")
        if args.receive_workspace else None
    )
    if args.build or receiving_workspace is not None:
        result = operate(workspace, args.source_manifest, args.assessment_csv, receiving_workspace, args.study_id)
    else:
        result = prepare(workspace, args.source_manifest, args.assessment_csv, args.study_id)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0 if result["study"]["ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
