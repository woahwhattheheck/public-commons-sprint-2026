"""Import original RL-18151 source/report and discrete observations into a Workspace."""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
from pathlib import Path


STATION_ID = "21SC60WQ_WQX-RL-18151"
REPORT_ID = "rl18151-phosphorus-observed-report-2018-20261013"
STATION_SOURCE_ID = "rl18151-original-station"


def station_selection(workspace, collection_id, editions):
    """Bind the retained original geometry to the actual imported observations."""
    path, entry = workspace.source_file(collection_id, STATION_SOURCE_ID)
    geometry = json.loads(path.read_bytes())
    features = geometry.get("features", [])
    if geometry.get("type") != "FeatureCollection" or len(features) != 1:
        raise ValueError("The retained RL-18151 station must contain its one original point")
    properties = features[0].get("properties", {})
    if properties.get("MonitoringLocationIdentifier") != STATION_ID:
        raise ValueError("The original geographic point belongs to another station")
    reference = {
        "collection_id": collection_id, "source_id": STATION_SOURCE_ID,
        "source_sha256": entry["body"]["sha256"],
        "station_id_field": "MonitoringLocationIdentifier",
    }
    return {
        "title": "RL-18151 original Lake Keowee station and observations",
        "sources": [reference],
        "sites": [{"station_id": "RL-18151", "aliases": [STATION_ID],
                   "label": properties.get("MonitoringLocationName") or "RL-18151",
                   "role": "receiving_water_observation"}],
        "observation_ids": [edition["id"] for edition in editions
                            if edition.get("state") != "original_empty_response"],
    }


def compose_delivery(workspace, original, report_choice):
    """Update this report in place while preserving the other selected studies."""
    from model.observed_context import bind, source_choices
    selection = json.loads(json.dumps(original))
    choices = source_choices(selection)
    supplied = selection.get("observed_context_sources")
    preserved = list(supplied) if supplied is not None else list(choices)
    matching = [index for index, choice in enumerate(choices)
                if choice["source_id"] == REPORT_ID]
    if len(matching) > 1:
        raise ValueError("Select one prior RL-18151 report edition before updating this delivery")
    if matching:
        index = matching[0]
        preserved[index] = dict(report_choice)
    else:
        preserved.append(dict(report_choice))
    selection["observed_context_sources"] = preserved
    roles = selection.get("source_roles")
    if roles is not None and roles.get("OBSERVED_CONTEXT") is not None:
        roles["OBSERVED_CONTEXT"] = {
            "source_collection_id": preserved[0]["source_collection_id"],
            "source_id": preserved[0]["source_id"],
        }
    selection["observed_context_binding"] = bind(workspace, selection)
    return selection


def receive(workspace, source_root, output, *, station_output=None, build_station=False,
            delivery_selection=None, delivery_output=None):
    from model.common import atomic_json
    from model.workspace import Workspace
    if bool(delivery_selection) != bool(delivery_output):
        raise ValueError("Supply both the existing delivery selection and a separate output path")
    original_delivery = None
    input_path = None
    if delivery_selection:
        from model.observed_context import source_choices
        input_path = Path(delivery_selection).resolve(strict=True)
        if input_path == Path(delivery_output).resolve():
            raise ValueError("Keep the original delivery selection and write a separate updated request")
        original_delivery = json.loads(input_path.read_bytes())
        if not isinstance(original_delivery, dict):
            raise ValueError("Select the existing delivery request object")
        source_choices(original_delivery)
    destinations = [Path(path).resolve() for path in (output, station_output, delivery_output) if path]
    if len(destinations) != len(set(destinations)):
        raise ValueError("Receiving, station selection and delivery outputs need separate paths")
    if input_path in destinations:
        raise ValueError("Keep the original delivery request separate from every receiving output")
    root = Path(source_root).resolve(strict=True)
    manifest_path = root / "sources.json"
    manifest_raw = manifest_path.read_bytes()
    manifest = json.loads(manifest_raw)
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Select the complete retained RL-18151 scientific source")
    capture = json.loads((root / "capture-manifest.json").read_bytes())
    if capture.get("station_id") != "21SC60WQ_WQX-RL-18151" or not capture.get("complete"):
        raise ValueError("The original station acquisition must be complete")
    protected = {manifest_path, root / "capture-manifest.json"}
    for entry in manifest["entries"]:
        protected.add((root / entry["path"]).resolve())
        protected.update((root / member["path"]).resolve() for member in entry.get("companions", []))
    if any(destination in protected for destination in destinations):
        raise ValueError("Write receiving outputs outside the retained scientific source files")
    ws = Workspace(workspace)
    collection = ws.import_sources(manifest_path)
    indexed = {entry["id"]: entry for entry in manifest["entries"]}
    editions = []
    for group in ("nutrient", "physical", "microbiological"):
        source_id = "rl18151-" + group + "-observations-2018-20261013"
        item = indexed[source_id]
        native_path, entry = ws.source_file(collection["id"], source_id)
        with native_path.open("r", encoding="utf-8-sig", newline="") as stream:
            records = list(csv.DictReader(stream))
        if not records:
            editions.append({"group": group, "source_id": source_id, "state": "original_empty_response",
                             "records": 0, "source_collection_id": collection["id"]})
            continue
        metadata = {
            "schema": "upstate.observation-support/v1",
            "title": "RL-18151 original " + group + " measurements, 2018–2026",
            "source_uri": item["uri"], "sha256": entry["body"]["sha256"],
            "source_collection_id": collection["id"], "source_id": source_id,
            "source_manifest_sha256": hashlib.sha256(manifest_raw).hexdigest(),
            "value_basis": "original_discrete_measurement",
            "observation_kind": "receiving_water_measurement" if group != "physical" else "physical_measurement",
            "measurement_support": "concentration" if group != "physical" else "other_context",
            "time_support": "original_sampling_instant", "period_end_inclusive": True,
            "quantity_basis": "original_discrete_measurement",
            "station_id": "21SC60WQ_WQX-RL-18151",
            "method": "Original WQP values with exact source row, species, fraction, depth, units, qualifiers and limits.",
            "interpretation": "Retained lake sampling observations. No annual catchment export or flow-derived load is inferred.",
        }
        edition = ws.import_observations(native_path, metadata)
        if edition["admitted_count"]:
            raise RuntimeError("Discrete source measurements unexpectedly entered annual catchment comparison")
        editions.append({"group": group, "id": edition["id"], "rows": len(edition["rows"]),
                         "context_count": edition["context_count"], "admitted_count": edition["admitted_count"],
                         "source_collection_id": collection["id"], "source_id": source_id})
    report_id = "rl18151-phosphorus-observed-report-2018-20261013"
    if report_id not in indexed:
        raise ValueError("The original scientific report recipe is absent")
    report_path, report_entry = ws.source_file(collection["id"], report_id)
    report = json.loads(report_path.read_bytes())
    if report.get("schema") != "upstate.observed-report/v1":
        raise ValueError("The retained report recipe has another schema")
    station = station_selection(ws, collection["id"], editions)
    result = {
        "schema": "upstate.rl18151-native-receiving/v1",
        "workspace": str(ws.root.resolve()), "project_id": ws.project["id"],
        "source_collection_id": collection["id"], "source_manifest_sha256": hashlib.sha256(manifest_raw).hexdigest(),
        "observations": editions,
        "observed_context_source": {"source_collection_id": collection["id"], "source_id": report_id},
        "report_recipe_sha256": report_entry["body"]["sha256"],
        "station_source": {"source_collection_id": collection["id"], **station["sources"][0]},
        "station_selection": station,
    }
    if station_output:
        atomic_json(Path(station_output), station)
        result["station_selection_file"] = str(Path(station_output).resolve())
    if build_station:
        from model.station_geography import build
        edition = build(ws, station)
        result["station_geography"] = {
            key: edition[key] for key in ("id", "build_id", "summary", "source_collection_id")
        }
    if original_delivery is not None:
        updated = compose_delivery(ws, original_delivery, result["observed_context_source"])
        atomic_json(Path(delivery_output), updated)
        result["delivery_selection"] = {
            "input": str(Path(delivery_selection).resolve()),
            "output": str(Path(delivery_output).resolve()),
            "observed_context_sources": updated["observed_context_sources"],
            "observed_context_binding": updated["observed_context_binding"],
        }
    atomic_json(Path(output), result)
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--station-output", help="Write the usable retained-station selection")
    parser.add_argument("--build-station", action="store_true",
                        help="Build the original station edition through the maintained geography API")
    parser.add_argument("--delivery-selection", help="Existing complete delivery request to update")
    parser.add_argument("--delivery-output", help="Separate updated complete delivery request")
    args = parser.parse_args()
    print(json.dumps(receive(args.workspace, args.source_root, args.output,
                             station_output=args.station_output, build_station=args.build_station,
                             delivery_selection=args.delivery_selection,
                             delivery_output=args.delivery_output), sort_keys=True))

if __name__ == "__main__":
    main()
