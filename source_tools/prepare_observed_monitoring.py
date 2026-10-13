#!/usr/bin/env python3
"""Open a complete original observation cohort in native Monitoring.

Uses the retained native station/domain editions and the existing network,
observed-context, selected-study export and Workspace receiving implementations.
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import sys
from datetime import datetime, timezone

APPLICATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION))

from model.common import atomic_json, digest, file_digest, held, read_json
from model.workspace import Workspace
from model.monitoring_network import build_network
from model.monitoring_sources import read_source, verify_retained_binding
from model.monitoring_workspace import MonitoringWorkspace
from model import monitoring_observed_context as observed, study_transfer, portable
from source_tools.prepare_regional_monitoring import (
    DOMAIN_ID, DOMAIN_DECODED_SHA256, entry_for, native_domain_fields,
    retain_collection, verify_declared_crs,
)

SCHEMA = "upstate.observed-monitoring-opening/v1"
SELECTION_SCHEMA = "upstate.observed-monitoring-selection/v1"


def required_string(value, label):
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError(label + " must be an exact nonempty string")
    return value


def normalize_selection(value):
    if not isinstance(value, dict) or value.get("schema") != SELECTION_SCHEMA:
        raise ValueError("Select " + SELECTION_SCHEMA)
    allowed = {"schema", "title", "domain", "observations", "station_sources", "expected_domain_count"}
    if set(value) - allowed:
        raise ValueError("Unknown observed-network selection fields")
    result = copy.deepcopy(value)
    required_string(result.get("title"), "title")
    for name in ("domain", "observations"):
        item = result.get(name)
        if not isinstance(item, dict) or set(item) - {"collection_id", "source_id", "id_field", "downstream_field"}:
            raise ValueError(name + " must name one retained edition and entry")
        for field in ("collection_id", "source_id"):
            required_string(item.get(field), name + "." + field)
        if name == "observations" and set(item) != {"collection_id", "source_id"}:
            raise ValueError("Observation selection takes only its retained edition and entry")
    rows = result.get("station_sources")
    if not isinstance(rows, list) or not rows:
        raise ValueError("Name at least one original CRS-specific station source")
    seen = set()
    for item in rows:
        if not isinstance(item, dict) or set(item) != {"collection_id", "source_id", "station_id_field"}:
            raise ValueError("Each station source needs collection_id, source_id and station_id_field")
        for field in item:
            required_string(item[field], "station source " + field)
        key = (item["collection_id"], item["source_id"])
        if key in seen:
            raise ValueError("Do not repeat a selected original station entry")
        seen.add(key)
    expected = result.get("expected_domain_count")
    if expected is not None and (type(expected) is not int or expected < 1):
        raise ValueError("expected_domain_count must be a positive integer")
    return result


def checked_artifact(path, root):
    path = Path(path)
    return {"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size,
            "sha256": file_digest(path)}


def verify_artifacts(root, artifacts):
    for item in artifacts.values():
        path = root / item["path"]
        if path.stat().st_size != item["bytes"] or file_digest(path) != item["sha256"]:
            raise ValueError("A retained observed-network artifact changed: " + item["path"])


def prepare(workspace, output, selection, *, receive=True):
    selection = normalize_selection(selection)
    output = Path(output).resolve()
    if output == workspace.root or output.is_relative_to(workspace.root):
        raise ValueError("Use an output directory outside the original Workspace")
    request = {"project_id": workspace.project["id"], "workspace": str(workspace.root),
               "selection": selection}
    operation_id = digest(request)
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".observed-monitoring.lock", blocking=False):
        atomic_json(output / "request.json", request, immutable=True)
        state_path = output / "operation.json"
        state = read_json(state_path) if state_path.exists() else {
            "schema": SCHEMA, "operation_id": operation_id,
            "created_at": datetime.now(timezone.utc).isoformat(), "artifacts": {}}
        if state.get("operation_id") != operation_id:
            raise ValueError("Output directory belongs to a different original observation selection")
        atomic_json(state_path, state)
        verify_artifacts(output, state["artifacts"])

        original, observation_binding = observed._source(
            workspace, selection["observations"]["collection_id"],
            selection["observations"]["source_id"])
        original_stations = {row["station_id"]: row for row in original["stations"]}
        if not original_stations:
            raise ValueError("Original observed source has no stations")

        domain_selection = selection["domain"]
        domain_collection = workspace._get("sources", domain_selection["collection_id"])
        domain_entry = entry_for(domain_collection, domain_selection["source_id"])
        if domain_entry["id"] == DOMAIN_ID and domain_entry.get("decoded_sha256") != DOMAIN_DECODED_SHA256:
            raise ValueError("The original Upper Savannah domain changed its retained edition")
        if "network_id" not in state:
            domain, domain_binding = read_source(
                workspace, domain_entry["id"], collection_id=domain_collection["id"])
            verify_declared_crs(domain_entry, domain_binding)
            def selected_field(option, native_name):
                if domain_selection.get(option):
                    return domain_selection[option]
                matches = [field for field in domain_binding["native_fields"] if field.lower() == native_name]
                if len(matches) != 1:
                    raise ValueError("Select the exact retained native domain " + option)
                return matches[0]
            id_field, downstream_field, domain_metadata = native_domain_fields(
                workspace, domain_collection, domain_entry,
                id_field=selected_field("id_field", "huc12"),
                downstream_field=selected_field("downstream_field", "tohuc"))
            selected, excluded, bindings, collections = {}, [], [], {}
            for source_selection in selection["station_sources"]:
                collection = workspace._get("sources", source_selection["collection_id"])
                entry = entry_for(collection, source_selection["source_id"])
                view, binding = read_source(workspace, entry["id"], collection_id=collection["id"])
                verify_declared_crs(entry, binding)
                field = source_selection["station_id_field"]
                if field not in binding["native_fields"]:
                    raise ValueError("Station identity field is absent from the original native schema: " + field)
                collections[collection["id"]] = collection
                bindings.append(binding)
                for index, feature in enumerate(view["features"]):
                    properties = feature.get("properties") or {}
                    station_id = required_string(properties.get(field), "Original station identity")
                    identity = {"source_collection_id": collection["id"], "source_id": entry["id"],
                                "native_source_sha256": binding["object_sha256"],
                                "source_feature_id": feature.get("id"), "source_feature_index": index,
                                "source_station_id_field": field, "source_station_id": station_id}
                    if station_id not in original_stations:
                        excluded.append(identity)
                        continue
                    if station_id in selected:
                        raise ValueError("Original station appears in multiple selected native features: " + station_id)
                    if (feature.get("geometry") or {}).get("type") != "Point":
                        raise ValueError("Original observed station needs a native Point: " + station_id)
                    extra = {"observed_station_id": station_id,
                             "observed_source_feature": json.dumps(identity, ensure_ascii=False, sort_keys=True)}
                    if set(extra) & set(properties):
                        raise ValueError("Native station properties conflict with explicit planning metadata")
                    selected[station_id] = {
                        "type": "Feature", "id": station_id, "geometry": feature["geometry"],
                        "properties": {**properties, **extra}}
            missing = sorted(set(original_stations) - set(selected))
            if missing:
                raise ValueError("Selected original geometry lacks observed station IDs: " + ", ".join(missing))
            staged = output / "station-edition"
            staged.mkdir(exist_ok=True)
            view = {"type": "FeatureCollection", "name": selection["title"],
                    "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
                    "features": [selected[key] for key in original_stations]}
            atomic_json(staged / "stations-wgs84.geojson", view, immutable=True)
            companions, native_editions = [], []
            for key, collection in sorted(collections.items()):
                members, index = retain_collection(workspace, collection, staged, "originals/" + key)
                companions.extend(members)
                native_editions.append(index)
            lineage = {"schema": "upstate.observed-monitoring-stations/v1",
                       "operation_id": operation_id, "selection": selection,
                       "observation_binding": observation_binding,
                       "original_station_declarations": original["stations"],
                       "native_station_bindings": bindings,
                       "station_ids": list(original_stations), "excluded_native_features": excluded,
                       "native_editions": native_editions,
                       "method": "Original monitoring_sources.read_source projects declared native CRS through Fiona/pyproj always_xy to WGS84. Exact selected source IDs bind observations. Original attributes, datum declarations and complete source editions are retained."}
            atomic_json(staged / "lineage.json", lineage, immutable=True)
            companions.append(checked_artifact(staged / "lineage.json", staged))
            derived_id = "observed-monitoring-stations-" + operation_id[:20]
            manifest = {"schema": "upstate.sources/v1", "title": selection["title"],
                        "captured_at": state["created_at"],
                        "entries": [{"id": derived_id, "title": selection["title"],
                                     "kind": "vector", "role": "MONITORING_STATIONS",
                                     "uri": "urn:upstate:observed-monitoring:" + operation_id,
                                     "vintage": original["source_period"]["start_inclusive"] + " through " + original["source_period"]["end_inclusive"],
                                     **checked_artifact(staged / "stations-wgs84.geojson", staged),
                                     "source_crs": "EPSG:4326", "source_format": "GeoJSON",
                                     "metadata": {"station_id_field": "observed_station_id",
                                                  "lineage_file": "lineage.json",
                                                  "station_count": len(selected)},
                                     "companions": companions}]}
            atomic_json(staged / "sources.json", manifest, immutable=True)
            station_collection = workspace.import_sources(staged / "sources.json")
            station_view, station_binding = read_source(
                workspace, derived_id, collection_id=station_collection["id"])
            network = build_network(domain, station_view,
                source_bindings={"domain": domain_binding, "stations": station_binding},
                id_field=id_field, downstream_field=downstream_field,
                station_id_field="observed_station_id", title=selection["title"])
            if selection.get("expected_domain_count") is not None and len(network["nodes"]) != selection["expected_domain_count"]:
                raise ValueError("Native domain count differs from the selected complete source")
            if domain_metadata.get("selected_huc12") and set(network["nodes"]) != set(domain_metadata["selected_huc12"]):
                raise ValueError("Native domain differs from its original selected HUC identities")
            network["created_at"] = state["created_at"]
            service = MonitoringWorkspace(workspace)
            network = service.save("networks", network)
            state.update(network_id=network["id"], station_collection_id=station_collection["id"],
                         station_source_id=derived_id, station_count=len(selected),
                         excluded_native_features=len(excluded), network_summary=network["summary"],
                         station_assignment_issues=network["station_assignment_issues"])
            for label, path in (("station_manifest", staged / "sources.json"),
                                ("station_lineage", staged / "lineage.json"),
                                ("station_view", staged / "stations-wgs84.geojson")):
                state["artifacts"][label] = checked_artifact(path, output)
            atomic_json(state_path, state)

        service = MonitoringWorkspace(workspace)
        network = service.get("networks", state["network_id"])
        service.verify_sources(network)
        for binding in network["source_bindings"].values():
            if binding:
                verify_retained_binding(workspace, binding)
        context = observed.prepare(workspace,
            source_collection_id=selection["observations"]["collection_id"],
            source_id=selection["observations"]["source_id"], network_id=network["id"],
            title=selection["title"] + " — original sampled observations")
        summary = context["summary"]
        if (summary["matched_stations"] != len(original_stations)
                or summary["matched_station_activities"] != len(original["activities"])
                or summary["matched_station_observations"] != len(original.get("observations", []))):
            raise ValueError("Native observed context did not retain the complete selected cohort")
        if context["plan_id"] is not None or context["campaign_id"] is not None or context["calendar"]:
            raise ValueError("Original observation opening unexpectedly acquired a planning calendar")
        if state.get("context_id") and state["context_id"] != context["id"]:
            raise ValueError("Original observed context changed during continuation")
        state.update(context_id=context["id"], context_summary=summary)
        atomic_json(output / "observed-context.json", context, immutable=True)
        state["artifacts"]["observed_context"] = checked_artifact(output / "observed-context.json", output)
        atomic_json(state_path, state)

        if "context_export" not in state:
            state["context_export"] = observed.export_context(
                workspace, context_id=context["id"], export_root=output / "exports")
            state["artifacts"]["observed_context_zip"] = checked_artifact(
                Path(state["context_export"]["path"]), output)
            atomic_json(state_path, state)

        if receive:
            archive = output / "observed-monitoring-study.zip"
            selected_study = {"schema": "upstate.study-selection/v1", "title": selection["title"],
                              "roots": [{"kind": "monitoring_observed_contexts", "id": context["id"]}],
                              "include_related_results": False}
            state["study_export"] = study_transfer.export_study(workspace, archive, selected_study)
            state["artifacts"]["study_archive"] = checked_artifact(archive, output)
            atomic_json(state_path, state)
            destination = output / "received"
            if destination.exists():
                manifest = portable.inspect_archive(archive, verify=True)
                for name, body in manifest["members"].items():
                    path = destination / name
                    if not path.is_file() or path.stat().st_size != body["bytes"] or file_digest(path) != body["sha256"]:
                        raise ValueError("Retained receiving directory differs from its original archive: " + name)
            else:
                portable.restore(archive, destination)
            recipient = Workspace(destination / "workspace")
            received = observed.inspect(recipient, context["id"])
            if received != context or MonitoringWorkspace(recipient).get("networks", network["id"]) != network:
                raise ValueError("Independent receiving changed the original network or observed context")
            state["received"] = {"workspace": str(destination / "workspace"),
                                 "application": str(destination / "application"),
                                 "context_id": received["id"], "network_id": network["id"]}
        state["complete"] = True
        state["phase"] = "received" if state.get("received") else "prepared"
        atomic_json(state_path, state)
        return state


def selection_from_geography(workspace, geography_id, observed_collection, observed_source):
    """Use the completed Station geography selection, including native datum groups."""
    from model import station_geography
    native = station_geography.inspect(workspace, geography_id, verify=True)
    original = native["selection"]
    watersheds = original.get("watersheds", [])
    if len(watersheds) != 1:
        raise ValueError("Select a completed geography edition with its one original watershed domain")
    domain = watersheds[0]
    station_sources = []
    for source in original["sources"]:
        station_sources.append({
            "collection_id": source["collection_id"], "source_id": source["source_id"],
            "station_id_field": source["station_id_field"]})
    selection = {"schema": SELECTION_SCHEMA,
        "title": original["title"] + " — complete observed Monitoring network",
        "domain": {"collection_id": domain["collection_id"], "source_id": domain["source_id"],
                   "id_field": domain["id_field"]},
        "observations": {"collection_id": observed_collection, "source_id": observed_source},
        "station_sources": station_sources}
    return normalize_selection(selection)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--selection", type=Path)
    inputs.add_argument("--geography-id")
    parser.add_argument("--observed-collection")
    parser.add_argument("--observed-source", default="utility-microbial-monitoring-observed-context-20261013")
    parser.add_argument("--observed-manifest", type=Path,
                        default=APPLICATION / "microbial_monitoring_context.sources.json")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    workspace = Workspace(args.workspace)
    if args.selection:
        selection = read_json(args.selection)
    else:
        collection = (workspace._get("sources", args.observed_collection)
                      if args.observed_collection else workspace.import_sources(args.observed_manifest))
        selection = selection_from_geography(
            workspace, args.geography_id, collection["id"], args.observed_source)
    result = prepare(workspace, args.output, selection, receive=not args.prepare_only)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
