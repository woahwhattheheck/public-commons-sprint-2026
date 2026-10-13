"""Bind original trace-metal observations to the maintained station-geography engine.

The selected table keeps each publisher cell and original record identity.  This
adapter does not estimate concentrations, infer risk, or implement spatial tests.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from pathlib import Path

from .common import atomic_json, canonical, digest, held, identifier, read_json, verify_file
from . import station_geography as geography
from .station_study import _domain as original_domain
from measurement_workspace.published_studies import PublishedStudyStore
from measurement_workspace import trace_metal_observations as trace

VERSION = 1
FOLDER = "trace-metal-geography-preparations"
SCHEMA = "upstate.trace-metal-geography-preparation/v1"
POINTS = "native/stations-wgs84.geojson"
RESULTS = "selected/metals-and-chemistry.csv"
DOMAIN_MODES = ("none", "auto", "required")
TITLE = "Eighteenmile 2023 — original trace-metal station geography"
STATIONS = ("SV-245", "SV-268", "SV-374", "SV-375", "SV-376")


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _sha(body):
    return hashlib.sha256(body).hexdigest()


def _rows(body):
    reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig"), newline=""))
    _require(reader.fieldnames and len(reader.fieldnames) == len(set(reader.fieldnames)),
             "Keep the original distinct source column names.")
    result = list(reader)
    _require(all(None not in row and all(value is not None for value in row.values()) for row in result),
             "Keep every original source cell and row width.")
    return result


def _store(workspace):
    return PublishedStudyStore(workspace, workspace.root / "published_studies")


def _capture(workspace, version_id=None):
    """Read and verify one original imported edition, independent of installed data."""
    store = _store(workspace)
    record = store._record(trace.BUILTIN_ID, version_id)
    version = record["version_id"]
    def original(name):
        path, entry = store.source_file(trace.BUILTIN_ID, name, version)
        return Path(path).read_bytes(), entry
    inventory_body, unused = original("trace/inventory.json")
    inventory = json.loads(inventory_body)
    originals = {"inventory.json": inventory_body}
    for item in inventory["members"]:
        name = trace._path(item["path"])
        originals[name] = original("trace/" + name)[0]
    station_body = original("original/stations-original.csv")[0]
    expected = trace.build_retained_files(originals, station_body)
    descriptors = []
    for name, body in sorted(expected.items()):
        actual, unused = original(name)
        _require(actual == body, "The imported trace source differs from its exact original edition: " + name)
        descriptors.append({"path": name, "bytes": len(body), "sha256": _sha(body)})
    collection = record["source_collection_id"]
    def reference(name, **fields):
        source_id = record["source_entries"][name]
        path, entry = workspace.source_file(collection, source_id)
        _require(Path(path).read_bytes() == expected[name], "The retained native source body changed: " + name)
        return {"collection_id": collection, "source_id": source_id,
                "source_sha256": entry["body"]["sha256"], **fields}
    point_ref = reference(POINTS, station_id_field="site_id",
                          native_id_field="MonitoringLocationIdentifier", source_crs="EPSG:4326")
    table_ref = reference(RESULTS, station_id_field="MonitoringLocationIdentifier",
                          record_id_field="TraceRecordIdentity")
    points = json.loads(expected[POINTS])
    _require(points.get("crs", {}).get("properties", {}).get("name") == "EPSG:4326",
             "Preserve the original WGS84 point coordinate reference system.")
    features = points["features"]
    sites, aliases = [], {}
    for feature in features:
        properties = feature["properties"]
        site = properties["site_id"]
        native = properties["MonitoringLocationIdentifier"]
        _require(feature["id"] == native and feature["geometry"]["type"] == "Point",
                 "Preserve each original native monitoring-location identity.")
        sites.append({"station_id": site, "label": properties["MonitoringLocationName"]})
        aliases[site] = [native]
    _require(sorted(aliases) == list(STATIONS), "Retain the original five trace monitoring stations.")
    rows = _rows(expected[RESULTS])
    _require(len(rows) == 204 and len({r["TraceRecordIdentity"] for r in rows}) == 204,
             "Retain all 204 original result selectors.")
    binding = {key: record[key] for key in ("study_id", "version_id", "bundle_sha256", "source_collection_id")}
    binding.update(source_manifest_sha256=record["source_manifest"]["sha256"],
                   original_trace_package_id=inventory["id"],
                   original_trace_input_sha256=trace.INPUT_SHA256,
                   original_station_response_sha256=trace.STATION_SHA256,
                   source_files=descriptors)
    return {"record": record, "binding": binding, "points": points, "rows": rows,
            "point_reference": point_ref, "table_reference": table_ref,
            "sites": sites, "aliases": aliases}


def _domain(workspace, mode, reference=None):
    _require(mode in DOMAIN_MODES, "Choose domain mode none, auto or required.")
    _require(reference is None or isinstance(reference, dict), "Select the original domain by its native source identifiers.")
    _require(mode != "none" or reference is None, "A point-only selection cannot name a watershed source.")
    if mode == "none":
        return None, []
    entries = [(collection, entry) for collection in workspace._list("sources")
               for entry in collection["entries"]]
    if reference is not None:
        collection_id = identifier(reference.get("collection_id"))
        source_id = reference.get("source_id")
        _require(isinstance(source_id, str) and source_id, "Choose an original domain source ID.")
        entries = [(c, e) for c, e in entries if c["id"] == collection_id and e["id"] == source_id]
        _require(len(entries) == 1, "The selected original domain source is absent.")
        if reference.get("source_sha256"):
            _require(entries[0][1]["body"]["sha256"] == reference["source_sha256"],
                     "The requested original domain body changed.")
    domain, count, problems = original_domain(workspace, entries)
    if domain is not None:
        _require(count == 217, "Choose the complete original 217-HUC12 model domain.")
    if domain is None and (mode == "required" or reference is not None):
        raise ValueError("Import the retained original 217-HUC12 model-domain source. " + "; ".join(problems))
    return domain, problems


def preview(workspace, *, version_id=None, domain_mode="auto", domain=None):
    captured = _capture(workspace, version_id)
    watershed, problems = _domain(workspace, domain_mode, domain)
    scope = "original 217-HUC12 domain" if watershed else "original monitoring points"
    selection = {"title": TITLE + " — " + scope,
        "sources": [captured["point_reference"]], "observation_tables": [captured["table_reference"]],
        "watersheds": [watershed] if watershed else [], "observation_ids": [], "site_tables": [],
        "sites": captured["sites"], "aliases": captured["aliases"], "choices": {},
        "trace_metal_source": captured["binding"],
        "study_context": {"study_id": trace.BUILTIN_ID, "version_id": captured["record"]["version_id"],
                          "source_study_ids": [trace.BUILTIN_ID]},
        "trace_metal_scope": {"domain_mode": domain_mode, "counts": trace.COUNTS,
            "support": "Original sampling locations; spatial membership is independent of result values.",
            "source_basis": "Five original WGS84 stations, exact original result cells and explicitly retained source identifiers."}}
    identity = {"schema": SCHEMA, "version": VERSION, "project_id": workspace.project["id"],
                "selection": selection}
    return {"schema": SCHEMA, "id": digest(identity), "identity": identity,
            "title": selection["title"], "study_id": trace.BUILTIN_ID,
            "version_id": captured["record"]["version_id"], "selection": selection,
            "counts": {**trace.COUNTS, "watershed_features": 217 if watershed else 0},
            "domain_notes": problems}


def retain(workspace, prepared):
    _require(prepared.get("schema") == SCHEMA and digest(prepared["identity"]) == prepared.get("id")
             and prepared["identity"]["project_id"] == workspace.project["id"]
             and prepared["selection"] == prepared["identity"]["selection"],
             "Retain the exact original preparation in its scientific Workspace.")
    directory = workspace.root / FOLDER / identifier(prepared["id"])
    directory.mkdir(parents=True, exist_ok=True)
    # Availability notes are intentionally outside the immutable scientific identity.
    value = {key: value for key, value in prepared.items() if key != "domain_notes"}
    atomic_json(directory / "preparation.json", value, immutable=True)
    atomic_json(directory / "selection.json", value["selection"], immutable=True)
    return value


def inspect_preparation(workspace, preparation_id):
    path = workspace.root / FOLDER / identifier(preparation_id) / "preparation.json"
    result = read_json(path)
    _require(result.get("id") == preparation_id and digest(result["identity"]) == preparation_id
             and result["identity"]["project_id"] == workspace.project["id"]
             and result["selection"] == result["identity"]["selection"],
             "The retained original geography preparation changed.")
    return result


def _snapshot(result):
    """Compare source science across native collection/project remapping."""
    analysis = result["result"]
    stations = []
    for row in analysis["stations"]:
        memberships = [{"watershed_id": item["watershed_id"], "relation": item["relation"],
                        "source_sha256": item["source_ref"]["source_sha256"]}
                       for item in row["watersheds"]]
        stations.append({"station_id": row["station_id"], "status": row["status"],
                         "coordinates": row["coordinates"],
                         "point_source_sha256": row["selected_source_ref"]["source_sha256"],
                         "watershed_status": row["watershed_status"],
                         "watersheds": sorted(memberships, key=lambda item: canonical(item)),
                         "observation_count": row["observation_count"]})
    observations = [{"record_id": row["record_id"], "station_id": row["station_id"],
                     "original": row["original"]} for row in analysis["observation_links"]]
    return {"schema": "upstate.trace-metal-geography-science/v1",
            "summary": {key: analysis["summary"][key] for key in (
                "station_count", "located_count", "unresolved_count", "observation_count",
                "unassigned_observation_count", "watershed_feature_count", "outside_watersheds_count")},
            "stations": sorted(stations, key=lambda item: item["station_id"]),
            "observations": sorted(observations, key=lambda item: item["record_id"]),
            "unassigned_observations": analysis["unassigned_observations"]}


def verify_edition(workspace, edition_id, *, expected=None):
    result = geography.inspect(workspace, edition_id, verify=True, include_result=True)
    selection = result["selection"]
    binding = selection.get("trace_metal_source") or {}
    _require(binding.get("study_id") == trace.BUILTIN_ID
             and binding.get("original_trace_input_sha256") == trace.INPUT_SHA256
             and binding.get("original_station_response_sha256") == trace.STATION_SHA256,
             "Choose a geography edition bound to the original trace source.")
    _require(len(selection["sources"]) == 1 and len(selection["observation_tables"]) == 1,
             "Retain the original single point source and complete result table.")
    point_path, point_entry = workspace.source_file(selection["sources"][0]["collection_id"],
                                                    selection["sources"][0]["source_id"])
    table_path, table_entry = workspace.source_file(selection["observation_tables"][0]["collection_id"],
                                                    selection["observation_tables"][0]["source_id"])
    _require(point_entry["body"]["sha256"] == selection["sources"][0]["source_sha256"]
             and table_entry["body"]["sha256"] == selection["observation_tables"][0]["source_sha256"],
             "The selected original native source bytes changed.")
    points = json.loads(Path(point_path).read_text(encoding="utf-8-sig"))
    original_rows = _rows(Path(table_path).read_bytes())
    originals = {row["TraceRecordIdentity"]: row for row in original_rows}
    _require(len(original_rows) == len(originals) == 204,
             "Retain each of the 204 distinct original measurement selectors.")
    snapshot = _snapshot(result)
    summary = snapshot["summary"]
    _require(summary["station_count"] == summary["located_count"] == 5
             and summary["unresolved_count"] == 0 and summary["observation_count"] == 204
             and summary["unassigned_observation_count"] == 0,
             "Resolve all five original stations and all 204 original records.")
    coordinates = {feature["properties"]["site_id"]: feature["geometry"]["coordinates"]
                   for feature in points["features"]}
    _require(sorted(coordinates) == list(STATIONS), "Retain the original five native station identities.")
    _require(all(row["coordinates"] == coordinates[row["station_id"]]
                 for row in snapshot["stations"]), "The mapped station coordinates differ from the original WGS84 points.")
    _require({row["record_id"]: row["original"] for row in snapshot["observations"]} == originals,
             "The spatial result changed original measured, limit, method or comment cells.")
    _require(sum(row["TraceCohort"] == "trace_metal" for row in originals.values()) == 153
             and sum(row["TraceCohort"] == "same_activity_chemistry" for row in originals.values()) == 51,
             "Keep the original metal and same-activity chemistry cohorts distinct.")
    below = [row for row in originals.values() if row["TraceCohort"] == "trace_metal"
             and row["ResultDetectionConditionText"] == "Present Below Quantification Limit"]
    _require(len(below) == 115 and all(not row["ResultMeasureValue"]
             and not row["ResultMeasure/MeasureUnitCode"] for row in below),
             "Keep the original 115 censored measured cells blank.")
    expected_watersheds = 217 if selection.get("watersheds") else 0
    _require(summary["watershed_feature_count"] == expected_watersheds,
             "Preserve the explicit original-domain or point-only support.")
    if expected is not None:
        _require(snapshot == expected, "Native receiving changed the original station/result/membership science.")
    return result, snapshot


def build(workspace, *, version_id=None, domain_mode="auto", domain=None,
          preparation_id=None, expected_preview_id=None):
    prepared = (inspect_preparation(workspace, preparation_id) if preparation_id
                else preview(workspace, version_id=version_id, domain_mode=domain_mode, domain=domain))
    if expected_preview_id is not None:
        _require(prepared["id"] == expected_preview_id, "Reopen the exact source selection before building.")
    directory = workspace.root / FOLDER / prepared["id"]
    with held(workspace.root / ".trace-metal-geography.lock", blocking=False):
        prepared = retain(workspace, prepared)
        result = geography.build(workspace, prepared["selection"])
        result, snapshot = verify_edition(workspace, result["id"])
        receipt = {"schema": "upstate.trace-metal-geography-operation/v1",
            "preparation_id": prepared["id"], "station_geography_id": result["id"],
            "build_id": result["build_id"], "study_id": prepared["study_id"],
            "version_id": prepared["version_id"], "source_binding": prepared["selection"]["trace_metal_source"],
            "summary": result["summary"], "snapshot_sha256": digest(snapshot),
            "files": result["files"]}
        atomic_json(directory / "science.json", snapshot, immutable=True)
        atomic_json(directory / "operation.json", receipt, immutable=True)
    return receipt


def prepared_studies(workspace):
    """Expose existing normal prepared-study controls without a second task API."""
    records = [record for record in _store(workspace).list_studies()["studies"]
               if record["study_id"] == trace.BUILTIN_ID]
    studies = []
    for record in records:
        version = record["version_id"]
        try:
            point = preview(workspace, version_id=version, domain_mode="none")
        except (ValueError, OSError, KeyError, TypeError) as error:
            studies.append({"id": "trace-metal-" + version, "title": TITLE,
                "ready": False, "missing": [str(error)], "selection": None})
            continue
        studies.append({"id": "trace-metal-points-" + version, "title": point["title"],
            "ready": True, "missing": [], "selection": point["selection"], "counts": point["counts"],
            "description": "Five original WGS84 monitoring points and 204 original metal/chemistry results; watershed membership is not selected."})
        domain, problems = _domain(workspace, "auto")
        if domain is not None:
            selected = dict(point["selection"])
            selected["title"] = TITLE + " — original 217-HUC12 domain"
            selected["watersheds"] = [domain]
            selected["trace_metal_scope"] = {**selected["trace_metal_scope"], "domain_mode": "required"}
            studies.append({"id": "trace-metal-domain-" + version, "title": selected["title"],
                "ready": True, "missing": [], "selection": selected,
                "counts": {**point["counts"], "watershed_features": 217},
                "description": "The same five original points and 204 original results, with native membership against all 217 retained HUC12 polygons."})
    return studies


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--version-id")
    parser.add_argument("--domain-mode", choices=DOMAIN_MODES, default="auto")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("preview")
    commands.add_parser("build")
    show = commands.add_parser("inspect")
    show.add_argument("id")
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    if args.command == "preview":
        result = preview(workspace, version_id=args.version_id, domain_mode=args.domain_mode)
    elif args.command == "build":
        with held(workspace.root / ".workspace.lock", blocking=False):
            result = build(workspace, version_id=args.version_id, domain_mode=args.domain_mode)
    else:
        edition, snapshot = verify_edition(workspace, args.id)
        result = {"edition": edition, "science": snapshot, "snapshot_sha256": digest(snapshot)}
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
