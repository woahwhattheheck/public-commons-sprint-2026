"""Turn an original saved utility footprint into a retained monitoring network.

The maintained receiving-water and Monitoring engines own geometry, graph,
candidate weights and design. This adapter binds the existing source report,
whole original HUC polygons and original WQP station coordinates to that course.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import tempfile

from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     held, identifier, now, read_json, relative_file, verify_file)
from . import receiving_waters as water, receiving_water_monitoring as monitoring
from . import utility_microbial_study as microbial
from .monitoring_sources import read_source
from . import monitoring_sources

SCHEMA = "upstate.utility-monitoring/v1"
VERSION = "utility-source-monitoring/1"
FOLDER = "utility-monitoring"
FOOTPRINT_ID = "utility-whole-huc-monitoring-footprint"
STATIONS_ID = "utility-original-microbial-stations"
METHOD = (
    "Selected original whole HUC12 polygons form the utility planning footprint. "
    "Each candidate's weight is its EPSG:5070 overlap hectares with that union. "
    "The complete original model-domain HUC/ToHUC graph remains in the network. "
    "Original sampled station coordinates are transformed from their declared datum; "
    "publisher utility membership and native polygon assignment remain separate."
)


def _copy_file(source, directory, member, descriptor):
    """Retain one complete original in bounded memory and fsync before publishing."""
    member = PurePosixPath(member)
    if member.is_absolute() or ".." in member.parts or "\\" in str(member):
        raise ValueError("Retain a portable original source path")
    target = directory / member
    expected = {"path": str(member), "bytes": descriptor["bytes"], "sha256": descriptor["sha256"]}
    if target.exists():
        verify_file(directory, expected)
        return expected
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".utility-source-", dir=target.parent)
    path = Path(temporary)
    try:
        size, checksum = 0, hashlib.sha256()
        with Path(source).open("rb") as original, os.fdopen(fd, "wb") as output:
            for chunk in iter(lambda: original.read(1024 * 1024), b""):
                output.write(chunk); size += len(chunk); checksum.update(chunk)
            output.flush(); os.fsync(output.fileno())
        if size != expected["bytes"] or checksum.hexdigest() != expected["sha256"]:
            raise ValueError("An original utility monitoring source changed")
        os.replace(path, target)
        parent = os.open(target.parent, os.O_RDONLY)
        try: os.fsync(parent)
        finally: os.close(parent)
    finally:
        path.unlink(missing_ok=True)
    return expected


def _source_files(workspace, choice, directory, label):
    """Copy full retained originals with their native source manifest and sidecars."""
    collection = workspace._get("sources", choice["source_collection_id"])
    entry = next(row for row in collection["entries"] if row["id"] == choice["source_id"])
    prefix = "original/" + label + "/"
    records, seen = [], set()
    for body in [entry["body"], *entry.get("companions", [])]:
        name = body.get("view_path", body["filename"])
        if name in seen:
            continue
        seen.add(name)
        original = relative_file(workspace.root, body["object"])
        records.append(_copy_file(original, directory, prefix + name, body))
    for name, value in (("source-edition.json", collection), ("source-choice.json", choice)):
        path = directory / (prefix + name)
        atomic_json(path, value, immutable=True)
        records.append(describe_file(directory, path))
    original_manifest = collection["original_manifest"]
    records.append(_copy_file(relative_file(workspace.root, original_manifest["object"]),
                              directory, prefix + "original-manifest.json", original_manifest))
    return records


def export_selection(workspace, export_id):
    """Verify the existing saved utility report and its original profile selection."""
    key = identifier(export_id)
    directory = workspace.root / "watershed-context-exports" / key
    record = read_json(directory / "export.json")
    if (record.get("schema") != "upstate.watershed-context-export/v1"
            or record.get("id") != key or record.get("state") != "complete"):
        raise ValueError("Choose a completed original utility watershed export")
    selection_path = verify_file(directory, record["files"]["selected-watersheds.json"])
    selection = read_json(selection_path)
    utility = selection.get("utility_selection")
    if (selection.get("schema") != "upstate.selected-watersheds/v1"
            or selection.get("export_id") != key
            or not isinstance(utility, dict) or not utility.get("available")
            or utility != record.get("utility_selection")
            or utility.get("key") != record.get("utility_selection_sha256")
            or digest({k: v for k, v in utility.items() if k != "key"}) != utility["key"]):
        raise ValueError("The saved report must retain its complete original utility choice")
    hucs = utility["huc12s"]
    if (hucs != sorted(set(hucs)) or not hucs
            or selection.get("selected_huc12s") != hucs or record.get("huc12s") != hucs):
        raise ValueError("The saved utility HUC membership differs")
    report_id = record.get("report_id")
    if not isinstance(report_id, str) or not re.fullmatch(r"watershed-[0-9a-f]{20}", report_id):
        raise ValueError("Retain the original regional report identity")
    parent_root = workspace.root / "watershed-context" / report_id
    parent = read_json(parent_root / "operator-report.json")
    if parent.get("id") != report_id or parent.get("schema") != "upstate.operator-watershed-context/v1":
        raise ValueError("The original regional report edition changed")
    parent_path = verify_file(parent_root, parent["files"]["watershed-context.json"])
    parent_report = read_json(parent_path)
    if (file_digest(parent_path) != record["report_sha256"]
            or parent_report.get("id") != report_id
            or digest(parent_report) != utility["report_canonical_sha256"]
            or selection.get("context_canonical_sha256") != digest(parent_report)):
        raise ValueError("The utility selection differs from its complete original regional report")
    profile = verify_file(directory, record["files"]["original-utility-profile.json"])
    if file_digest(profile) != utility["profile_source"]["sha256"]:
        raise ValueError("The original utility profile changed")
    # Existing export ZIP retains the original observations, their methods/units,
    # source comments, geographic interpretation and all relative source links.
    packet = verify_file(directory, record["files"]["utility-watershed-packet.zip"])
    return directory, record, selection, utility, packet


def _domain(workspace, requested):
    reference, notes = microbial._choose_domain(workspace, requested, "required")
    choice = {"source_collection_id": reference["collection_id"],
              "source_id": reference["source_id"]}
    rows, source = water._source(workspace, choice, "EPSG:5070")
    fields = list(rows[0]["properties"])
    downstream = [name for name in fields if name.casefold() == "tohuc"]
    if len(downstream) != 1:
        raise ValueError("Select the original unambiguous ToHUC field")
    choice.update(id_field=reference["id_field"], downstream_field=downstream[0])
    graph = water.huc_graph(rows, id_field=choice["id_field"],
                            downstream_field=choice["downstream_field"])
    return choice, reference, rows, source, graph, notes


def _stations(workspace, utility, domain_reference, include):
    if not include:
        return None
    manifest = microbial.SOURCE_DIRECTORY / "source-manifest.json"
    prepared = microbial.prepare(
        workspace, manifest=manifest if manifest.is_file() else None,
        domain_reference=domain_reference, domain_mode="required")
    features, sources = [], []
    for reference in prepared["selection"]["sources"]:
        native, binding = read_source(workspace, reference["source_id"],
                                      collection_id=reference["collection_id"])
        # The existing native vector reader honors the WGS84/NAD83 source datum.
        selected = [feature for feature in native["features"]
                    if feature["properties"].get("utility_id") == utility["utility_id"]]
        features.extend(selected)
        sources.append({"source_collection_id": reference["collection_id"],
                        "source_id": reference["source_id"], "binding": binding,
                        "selected_station_ids": [
                            row["properties"]["MonitoringLocationIdentifier"] for row in selected]})
    ids = [row["properties"]["MonitoringLocationIdentifier"] for row in features]
    expected = microbial.EXPECTED_COUNTS[utility["utility_id"]]["stations"]
    if len(ids) != expected or len(set(ids)) != expected:
        raise ValueError("Retain every original station in the utility's published source group")
    return {"features": features, "sources": sources, "preparation_id": prepared["id"],
            "source_collection_id": prepared["source_collection_id"],
            "source_counts": prepared["source_counts"][utility["utility_id"]]}


def prepare(workspace, value, *, progress=None):
    """Prepare one source-only network; its native design remains an explicit choice."""
    if not isinstance(value, dict) or set(value) - {"export_id", "domain", "include_microbial"}:
        raise ValueError("Select a saved utility export, original domain and station option")
    include = value.get("include_microbial", True)
    if type(include) is not bool:
        raise ValueError("Choose whether to include the original microbial station locations")
    with held(workspace.root / ".utility-monitoring.lock", blocking=False):
        return _prepare(workspace, value, include, progress)


def _prepare(workspace, value, include, progress):
    from shapely.geometry import mapping

    source_root, export, selected, utility, packet = export_selection(workspace, value.get("export_id"))
    catchments, domain, rows, original, graph, notes = _domain(workspace, value.get("domain"))
    chosen = set(utility["huc12s"])
    by_huc = {str(row["properties"][catchments["id_field"]]): row for row in rows}
    if len(by_huc) != 217 or chosen - by_huc.keys():
        raise ValueError("The original utility footprint must belong to the retained 217-HUC domain")
    stations = _stations(workspace, utility, domain, include)
    identity = {"version": VERSION, "implementation_sha256": file_digest(__file__),
                "pipeline_sources": {module.__name__: file_digest(module.__file__)
                                     for module in (water, monitoring, microbial, monitoring_sources)},
                "selected_geometry_sha256": {huc: hashlib.sha256(by_huc[huc]["geometry"].wkb).hexdigest()
                                            for huc in sorted(chosen)},
                "transformed_station_sha256": digest(stations["features"]) if stations else None,
                "workspace_id": workspace.project["id"], "export_id": export["id"],
                "utility_key": utility["key"],
                "selection_file": export["files"]["selected-watersheds.json"],
                "source_packet": export["files"]["utility-watershed-packet.zip"],
                "domain": domain, "catchments": catchments, "original_domain": original,
                "include_microbial": include,
                "station_sources": stations["sources"] if stations else [],
                "station_preparation_id": stations["preparation_id"] if stations else None}
    key = digest(identity)
    directory = workspace.root / FOLDER / key
    with held(directory / ".operation.lock", blocking=False):
        if (directory / "operation.json").exists():
            return {**inspect(workspace, key), "reused": True}
        intent_path = directory / "intent.json"
        if intent_path.exists():
            intent = read_json(intent_path)
            if intent["identity"] != identity or intent["id"] != key:
                raise ValueError("The retained utility monitoring intent changed")
        else:
            intent = {"schema": SCHEMA, "id": key, "identity": identity, "created_at": now()}
            atomic_json(intent_path, intent, immutable=True)
        if progress:
            progress({"phase": "utility_monitoring_sources", "utility_id": utility["utility_id"]})
        companions = _source_files(workspace, catchments, directory, "domain")
        companions.append(_copy_file(
            packet, directory, "original/utility-watershed-packet.zip",
            export["files"]["utility-watershed-packet.zip"]))
        companions.append(_copy_file(
            verify_file(source_root, export["files"]["selected-watersheds.json"]),
            directory, "original/selected-watersheds.json",
            export["files"]["selected-watersheds.json"]))
        companions.append(_copy_file(
            verify_file(source_root, export["files"]["original-utility-profile.json"]),
            directory, "original/original-utility-profile.json",
            export["files"]["original-utility-profile.json"]))
        atomic_json(directory / "original/export.json", export, immutable=True)
        companions.append(describe_file(directory, directory / "original/export.json"))
        footprint = {"type": "FeatureCollection",
                     "crs": {"type": "name", "properties": {"name": "EPSG:5070"}}, "features": [
            {"type": "Feature", "id": by_huc[huc]["id"],
             "properties": {**by_huc[huc]["properties"], "utility_id": utility["utility_id"],
                            "original_native_id": by_huc[huc]["id"]},
             "geometry": mapping(by_huc[huc]["geometry"])}
            for huc in sorted(chosen)]}
        atomic_json(directory / "utility-footprint.geojson", footprint, immutable=True)
        reachable = set(water.upstream_hucs(graph, utility["anchor_huc12s"]))
        method = {"schema": SCHEMA, "version": VERSION, "description": METHOD,
                  "utility": copy.deepcopy(utility), "selected_huc12s": sorted(chosen),
                  "geographic_basis": "Whole original selected HUC12 polygons",
                  "target_quantity": "EPSG:5070 vector overlap hectares",
                  "target_units": "ha", "costs_and_calendar": "Explicit choices in the original Monitoring design",
                  "station_basis": "Original WQP datum-aware coordinates and utility-source membership" if stations else "No station source selected",
                  "station_source_counts": stations["source_counts"] if stations else None,
                  "graph_upstream_huc12s": sorted(reachable),
                  "selected_not_reachable_in_retained_graph": sorted(chosen - reachable),
                  "reachable_outside_selected_utility": sorted(reachable - chosen),
                  "known_external_upstream_huc12s": utility.get("known_external_upstream_huc12s", []),
                  "interpretation": [
                      utility["interpretation"],
                      "The target weight is planning area, not microbial concentration, annual pollutant mass, removal or detection probability.",
                      "Historical sampled stations are candidate source locations, not assumed operational coverage or verified outlets.",
                      "The source report uses its original 303-record topology; Monitoring retains the supplied 217-polygon graph and its explicit external edges.",
                      "Review upstream coverage if the retained graph and saved utility membership differ; local coverage keeps the exact selected planning units."]}
        atomic_json(directory / "method.json", method, immutable=True)
        companions.append(describe_file(directory, directory / "method.json"))
        entries = [{"id": FOOTPRINT_ID, "title": utility["title"] + " — whole-HUC planning footprint",
                    "kind": "vector", "role": "UTILITY_MONITORING_FOOTPRINT",
                    "path": "utility-footprint.geojson", "sha256": file_digest(directory / "utility-footprint.geojson"),
                    "uri": original["uri"], "vintage": original["vintage"],
                    "source_crs": "EPSG:5070", "units": "original whole HUC12 polygons",
                    "scope": {"utility_export_id": export["id"], "utility_id": utility["utility_id"],
                              "huc12s": sorted(chosen), "method": method},
                    "companions": []}]
        if stations:
            for index, source in enumerate(stations["sources"]):
                companions.extend(_source_files(workspace, source, directory, "stations-" + str(index)))
            atomic_json(directory / "original-stations.geojson",
                        {"type": "FeatureCollection", "features": stations["features"]}, immutable=True)
            entries.append({"id": STATIONS_ID, "title": utility["title"] + " — original microbial stations",
                            "kind": "vector", "role": "MONITORING_STATIONS",
                            "path": "original-stations.geojson",
                            "sha256": file_digest(directory / "original-stations.geojson"),
                            "uri": "https://www.waterqualitydata.us/", "vintage": "2021–2025 original source query",
                            "station_id_field": "MonitoringLocationIdentifier",
                            "source_crs": "EPSG:4326", "scope": {"utility_id": utility["utility_id"],
                            "original_source_counts": stations["source_counts"],
                            "coordinate_sources": stations["sources"]}, "companions": []})
        # Every entry carries the full original scope and the same method.
        unique = {row["path"]: row for row in companions}
        for entry in entries:
            entry["companions"] = [{"path": row["path"], "sha256": row["sha256"]}
                                   for row in unique.values()]
        manifest = {"schema": "upstate.sources/v1", "title": utility["title"] + " — monitoring preparation",
                    "captured_at": intent["created_at"], "scope": identity, "notes": method["interpretation"],
                    "entries": entries}
        atomic_json(directory / "sources.json", manifest, immutable=True)
        collection = workspace.import_sources(directory / "sources.json")
        receptor_id = "utility-" + utility["utility_id"].lower()
        plan_selection = {"title": utility["title"] + " — whole-HUC monitoring footprint",
                          "analysis_crs": "EPSG:5070", "receptors": [{
                              "id": receptor_id, "title": utility["title"],
                              "family": "critical_drinking_water",
                              "source": {"source_collection_id": collection["id"], "source_id": FOOTPRINT_ID},
                              "relation": {"method": "source_area", "rationale": utility["interpretation"]},
                              "classification": {"designation": "Utility whole-HUC planning footprint",
                                                 "source_profile": utility["profile_source"]},
                              "metadata": {"utility_export_id": export["id"], "method": method}}]}
        plan = water.prepare(workspace, plan_selection)
        selection = {"title": utility["title"] + " — source-area monitoring",
                     "mode": "contribution_area", "plan_id": plan["id"], "receptor_ids": [receptor_id],
                     "catchments": catchments}
        if stations:
            selection["stations"] = {"source_collection_id": collection["id"], "source_id": STATIONS_ID,
                                     "id_field": "MonitoringLocationIdentifier"}
        bridge = monitoring.prepare(workspace, selection, progress=progress)
        expected_excluded = sorted(set(by_huc) - chosen)
        if sorted(bridge["method"]["recommended_excluded_ids"]) != expected_excluded:
            raise ValueError("The native monitoring candidate footprint differs from the exact selected HUCs")
        result = {"schema": SCHEMA, "id": key, "state": "complete",
                  "identity": identity, "created_at": intent["created_at"], "title": utility["title"],
                  "export_id": export["id"], "utility_id": utility["utility_id"],
                  "source_collection_id": collection["id"], "source_id": FOOTPRINT_ID,
                  "receiving_plan_id": plan["id"], "monitoring_id": bridge["id"],
                  "network_id": bridge["network_id"], "method": method,
                  "summary": bridge["summary"], "network_summary": bridge["network_summary"],
                  "station_assignment_issues": bridge["station_assignment_issues"],
                  "recommended_excluded_ids": expected_excluded,
                  "original_domain_notes": notes,
                  "files": {name: describe_file(directory, directory / name)
                            for name in ("intent.json", "method.json", "sources.json", "utility-footprint.geojson",
                                         "original/utility-watershed-packet.zip",
                                         "original/selected-watersheds.json", "original/original-utility-profile.json",
                                         "original/export.json")}}
        if stations:
            result["files"]["original-stations.geojson"] = describe_file(directory, directory / "original-stations.geojson")
        result["record_sha256"] = digest(result)
        atomic_json(directory / "operation.json", result, immutable=True)
        return result


def inspect(workspace, operation_id, *, verify=True):
    key = identifier(operation_id)
    directory = workspace.root / FOLDER / key
    result = read_json(directory / "operation.json")
    if (result.get("schema") != SCHEMA or result.get("id") != key
            or result.get("state") != "complete" or digest(result["identity"]) != key
            or result["identity"]["workspace_id"] != workspace.project["id"]
            or digest({k: v for k, v in result.items() if k != "record_sha256"}) != result.get("record_sha256")):
        raise ValueError("Choose this Workspace's unchanged complete utility monitoring preparation")
    if verify:
        export_selection(workspace, result["export_id"])
        for row in result["files"].values():
            verify_file(directory, row)
        workspace.source_file(result["source_collection_id"], result["source_id"])
        plan = water.inspect_plan(workspace, result["receiving_plan_id"])
        bridge = monitoring.inspect(workspace, result["monitoring_id"])
        if (bridge["plan_id"] != plan["id"] or bridge["network_id"] != result["network_id"]
                or bridge["identity"]["selection"]["catchments"] != result["identity"]["catchments"]):
            raise ValueError("The utility preparation and retained native monitoring network differ")
    return result


def catalog(workspace):
    return [{name: row.get(name) for name in (
        "id", "title", "created_at", "export_id", "utility_id", "network_id",
        "monitoring_id", "summary", "network_summary", "station_assignment_issues",
        "recommended_excluded_ids")}
        for path in sorted((workspace.root / FOLDER).glob("*/operation.json"))
        for row in [inspect(workspace, path.parent.name, verify=False)]]


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("prepare")
    make.add_argument("--export-id", required=True)
    make.add_argument("--without-microbial", action="store_true")
    show = commands.add_parser("inspect")
    show.add_argument("--operation-id", required=True)
    commands.add_parser("list")
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    result = (prepare(workspace, {"export_id": args.export_id,
                                 "include_microbial": not args.without_microbial})
              if args.command == "prepare" else
              inspect(workspace, args.operation_id) if args.command == "inspect" else catalog(workspace))
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
