"""Receive the original utility E. coli edition into the existing Station geography desk."""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath

from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest, finite, held,
                     identifier, read_json, relative_file, verify_file)

SCHEMA = "upstate.utility-microbial-study/v1"
FOLDER = "utility-microbial-studies"
TITLE = "Utility-focus E. coli observations — 2021–2025"
MANIFEST_SHA256 = "7dbcc1b0d4d6f48f8a9d43fdbfd6ad3308b8435f4085e57aceb9e774b4c3e37e"
SOURCE_EDITIONS = {
    MANIFEST_SHA256: "cde833111bc9848a6070a0c3be3d8bc642c54d92e909c56b2d7d97bbf8d65eff",
    "ee6d5cc19e2a98b799db33df08026c6020a9a122f5cfb4ab83f1e415476dee23": "1fb6f51d95109b2a146f344175c27364573eb9529c748645d9df9505e78cca26",
}
DOMAIN_SHA256 = "2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af"
SOURCE_DIRECTORY = Path(__file__).resolve().parents[1] / "source/ecoli_utility_context/20261013"
EXPECTED = {
    "utility-ecoli-observations": ("table", "b6cf7d334c6b8bb1a174374c30e8ea3081dd1f05be2418040272c581a49264a8"),
    "utility-ecoli-stations": ("vector", "533e91201e09aa1103289722f0077edb496f4ed319deb6a4b58771fb7073a907"),
}
EXPECTED_COUNTS = {"ARJWS": {"stations": 5, "records": 142},
                   "PRWD": {"stations": 31, "records": 588}}
MAX_DOMAIN_BYTES = 64 * 1024 * 1024


def _collection(workspace, manifest):
    """Reuse one complete current or retained predecessor presentation edition."""
    requested = None
    if manifest is not None:
        manifest = Path(manifest).resolve(strict=True)
        requested = file_digest(manifest)
        if requested not in SOURCE_EDITIONS:
            raise ValueError("Choose a complete retained utility E. coli source-manifest.json")
    candidates = [row for row in workspace._list("sources")
                  if row.get("original_manifest", {}).get("sha256") in SOURCE_EDITIONS
                  and (requested is None or row["original_manifest"]["sha256"] == requested)]
    if candidates:
        collection = sorted(candidates, key=lambda row: (
            row["original_manifest"]["sha256"] != MANIFEST_SHA256, row["id"]))[0]
    elif manifest is not None:
        collection = workspace.import_sources(manifest)
    else:
        raise ValueError("Import the original utility microbial source or select its complete manifest")
    edition = collection["original_manifest"]["sha256"]
    if edition not in SOURCE_EDITIONS:
        raise ValueError("Choose a complete retained microbial presentation edition")
    expected_entries = {**EXPECTED, "utility-ecoli-offline-explorer": (
        "document", SOURCE_EDITIONS[edition])}
    entries = {entry["id"]: entry for entry in collection["entries"]}
    for source_id, (kind, expected) in expected_entries.items():
        entry = entries.get(source_id)
        if entry is None or entry["kind"] != kind or entry["body"]["sha256"] != expected:
            raise ValueError("The retained microbial source differs: " + source_id)
        workspace.source_file(collection["id"], source_id)
    return collection, entries


def _reference(collection, entry, **fields):
    return {"collection_id": collection["id"], "source_id": entry["id"],
            "source_sha256": entry["body"]["sha256"], **fields}


def _domain(workspace, reference):
    """Read an exact original 217-HUC source; display outlines are never selected."""
    if not isinstance(reference, dict):
        raise ValueError("Select the original domain collection and source IDs")
    collection_id = identifier(reference.get("collection_id"))
    path, entry = workspace.source_file(collection_id, reference.get("source_id"))
    if entry["kind"] != "vector":
        raise ValueError("Choose the retained original watershed polygon source")
    expected = reference.get("source_sha256")
    if expected and entry["body"]["sha256"] != expected:
        raise ValueError("The selected domain source body changed")
    raw = Path(path).read_bytes()
    if raw[:2] == b"\x1f\x8b":
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
            decoded = stream.read(MAX_DOMAIN_BYTES + 1)
    else:
        decoded = raw
    if len(decoded) > MAX_DOMAIN_BYTES or hashlib.sha256(decoded).hexdigest() != DOMAIN_SHA256:
        raise ValueError("Choose the original decoded 217-HUC model domain")
    body = json.loads(decoded.decode("utf-8-sig"))
    features = body.get("features", [])
    if len(features) != 217:
        raise ValueError("Retain all 217 original HUC12 polygons")
    fields = [name for name in features[0].get("attributes", {}) if name.lower() == "huc12"]
    if len(fields) != 1:
        raise ValueError("The original domain needs its unique HUC12 field")
    field = fields[0]
    ids = [feature.get("attributes", {}).get(field) for feature in features]
    if len(set(ids)) != 217 or any(not isinstance(value, str) or
                                  len(value) != 12 or not value.isdigit() for value in ids):
        raise ValueError("Retain the original twelve-character HUC12 identities")
    return {"collection_id": collection_id, "source_id": entry["id"],
            "source_sha256": entry["body"]["sha256"], "id_field": field}


def _choose_domain(workspace, requested, mode):
    if mode not in ("auto", "none", "required"):
        raise ValueError("Choose auto, none or required original-domain receiving")
    if requested is not None:
        if mode == "none":
            raise ValueError("Choose the supplied original domain or the point-only edition")
        return _domain(workspace, requested), []
    if mode == "none":
        return None, []
    candidates = []
    for collection in sorted(workspace._list("sources"), key=lambda row: row["id"]):
        for entry in collection["entries"]:
            body = entry["body"]
            label = " ".join(str(entry.get(key, "")) for key in ("id", "title", "path"))
            label += " " + str(body.get("filename", ""))
            if entry["kind"] == "vector" and (body["sha256"] == DOMAIN_SHA256
                    or "model-domain" in label.lower() or "model domain" in label.lower()):
                candidates.append(_reference(collection, entry))
    notes = []
    for reference in candidates:
        try:
            return _domain(workspace, reference), notes
        except (OSError, ValueError, TypeError, KeyError) as error:
            notes.append({"source": reference, "message": str(error)})
    if mode == "required":
        raise ValueError("Import or explicitly select the original 217-HUC domain in this Workspace")
    return None, notes


def _coordinate_sources(workspace, collection, entry, points):
    """Retain native coordinate groups from original station CSV strings and datums."""
    records = [entry["body"], *entry.get("companions", [])]
    selected = [row for row in records
                if row.get("source_path") == "raw/stations-original.csv"]
    if len(selected) != 1:
        raise ValueError("Retain the original station CSV alongside the display points")
    original_csv = relative_file(workspace.root, selected[0]["object"])
    raw = original_csv.read_bytes()
    if (len(raw) != selected[0]["bytes"]
            or hashlib.sha256(raw).hexdigest() != selected[0]["sha256"]):
        raise ValueError("The original station coordinate CSV changed")
    table = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
    originals = {}
    for number, row in enumerate(table, 2):
        station = row.get("MonitoringLocationIdentifier")
        if None in row or not station or station in originals:
            raise ValueError("Original station coordinate rows need distinct native identifiers")
        originals[station] = (number, row)
    definitions = {"WGS84": ("wgs84", "EPSG:4326", 34),
                   "NAD83": ("nad83", "EPSG:4269", 2)}
    groups = {datum: [] for datum in definitions}
    source_rows = []
    for feature in points["features"]:
        properties = feature["properties"]
        station = properties["MonitoringLocationIdentifier"]
        if station not in originals:
            raise ValueError("Original station CSV does not contain " + station)
        number, row = originals[station]
        if any(properties.get(name) != value for name, value in row.items()):
            raise ValueError("The selected station attributes differ from the original CSV: " + station)
        datum = row.get("HorizontalCoordinateReferenceSystemDatumName")
        if datum not in definitions:
            raise ValueError("Retain an explicit supported original coordinate datum")
        x = finite(row["LongitudeMeasure"], "Original station longitude")
        y = finite(row["LatitudeMeasure"], "Original station latitude")
        if not -180 <= x <= 180 or not -90 <= y <= 90:
            raise ValueError("Original geographic coordinates are outside their native bounds")
        groups[datum].append({"type": "Feature", "id": station,
            "geometry": {"type": "Point", "coordinates": [x, y]},
            "properties": {**properties, "original_station_source_row": number,
                "native_coordinate_basis": "Original WQP CSV coordinate strings and declared datum"}})
        source_rows.append({"station_id": station, "source_row": number,
            "datum": datum, "source_crs": definitions[datum][1],
            "longitude_text": row["LongitudeMeasure"], "latitude_text": row["LatitudeMeasure"]})
    if any(len(groups[datum]) != expected
           for datum, (_, _, expected) in definitions.items()):
        raise ValueError("Retain all 34 WGS84 and two NAD83 original station positions")
    identity = {"schema": "upstate.utility-microbial-coordinates/v1",
        "source_collection_id": collection["id"],
        "display_source_sha256": entry["body"]["sha256"],
        "coordinate_source_sha256": selected[0]["sha256"],
        "coordinate_fields": ["LongitudeMeasure", "LatitudeMeasure",
                              "HorizontalCoordinateReferenceSystemDatumName"],
        "selected_stations": source_rows}
    key = digest(identity)
    directory = workspace.root / "utility-microbial-coordinate-sources" / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".coordinates.lock", blocking=False):
        companions, seen = [], set()
        for body in records:
            name = body.get("view_path", body["filename"])
            member = PurePosixPath(name)
            if (member.is_absolute() or not member.parts or ".." in member.parts
                    or member.as_posix() != name or "\\" in name or "\0" in name or name in seen):
                raise ValueError("Retain distinct portable original coordinate-source members")
            seen.add(name)
            source = relative_file(workspace.root, body["object"])
            content = source.read_bytes()
            if len(content) != body["bytes"] or hashlib.sha256(content).hexdigest() != body["sha256"]:
                raise ValueError("An original microbial source companion changed")
            target = directory / "original" / name
            atomic_bytes(target, content, immutable=True)
            companions.append({"path": "original/" + name, "sha256": body["sha256"]})
        atomic_json(directory / "coordinate-derivation.json", identity, immutable=True)
        companions.append({"path": "coordinate-derivation.json",
                           "sha256": file_digest(directory / "coordinate-derivation.json")})
        native_entries = []
        for datum, (code, crs, expected) in definitions.items():
            filename = "stations-" + code + ".geojson"
            native = {"type": "FeatureCollection",
                "name": "Original utility-focus station coordinates — " + datum,
                "crs": {"type": "name", "properties": {"name": crs}},
                "features": groups[datum]}
            atomic_json(directory / filename, native, immutable=True)
            native_entries.append({"id": "utility-ecoli-native-" + code,
                "title": "Original utility-focus station coordinates — " + datum,
                "kind": "vector", "format": "geojson", "path": filename,
                "sha256": file_digest(directory / filename),
                "uri": entry["uri"], "vintage": entry["vintage"],
                "source_crs": crs, "station_id_field": "MonitoringLocationIdentifier",
                "native_id_field": "MonitoringLocationIdentifier",
                "station_count": expected, "coordinate_datum": datum,
                "original_source_collection_id": collection["id"],
                "original_station_csv_sha256": selected[0]["sha256"],
                "coordinate_basis": "Unchanged original coordinate values, partitioned by declared datum",
                "companions": companions})
        manifest = {"schema": "upstate.sources/v1",
            "title": "Utility-focus microbial stations — original coordinate systems",
            "captured_at": collection.get("captured_at"),
            "scope": {"coordinate_derivation": identity},
            "notes": ["The original coordinate strings are retained in feature properties.",
                      "Native Station geography performs its ordinary CRS transformation.",
                      "The independent offline display and original source bodies remain preserved."],
            "entries": native_entries}
        manifest_path = directory / "sources.json"
        atomic_json(manifest_path, manifest, immutable=True)
        retained = workspace.import_sources(manifest_path)
        references = []
        for native_entry in retained["entries"]:
            workspace.source_file(retained["id"], native_entry["id"])
            references.append(_reference(retained, native_entry, format="geojson",
                station_id_field="MonitoringLocationIdentifier",
                native_id_field="MonitoringLocationIdentifier",
                source_crs=native_entry["source_crs"]))
        return retained, references


def _selection(workspace, collection, entries, domain, title):
    path, unused = workspace.source_file(collection["id"], "utility-ecoli-stations")
    points = read_json(path)
    stations = {}
    for feature in points["features"]:
        properties = feature["properties"]
        station_id = properties["MonitoringLocationIdentifier"]
        if station_id in stations or feature["geometry"]["type"] != "Point":
            raise ValueError("Retain the 36 distinct original station points")
        utility = properties["utility_id"]
        if utility not in EXPECTED_COUNTS:
            raise ValueError("Retain the original utility-focus assignment")
        stations[station_id] = {
            "station_id": station_id, "label": properties["MonitoringLocationName"],
            "utility_id": utility, "publisher_huc8": properties["HUCEightDigitCode"],
            "utility_membership_basis": properties["source_membership_basis"],
            "original_matched_huc12": properties.get("matched_huc12"),
            "source_references": [{"collection_id": collection["id"],
                "source_id": "utility-ecoli-stations",
                "source_sha256": entries["utility-ecoli-stations"]["body"]["sha256"],
                "station_id_field": "MonitoringLocationIdentifier", "station_id": station_id}],
        }
    path, unused = workspace.source_file(collection["id"], "utility-ecoli-observations")
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        records = list(reader)
    required = {"MonitoringLocationIdentifier", "ActivityIdentifier", "CharacteristicName",
                "ResultMeasureValue", "ResultMeasure/MeasureUnitCode", "ResultDetectionConditionText",
                "ActivityStartDate", "utility_id", "source_file", "source_row"}
    if not reader.fieldnames or not required <= set(reader.fieldnames):
        raise ValueError("Retain the original microbial result columns")
    seen = set()
    for row in records:
        station_id, activity = row["MonitoringLocationIdentifier"], row["ActivityIdentifier"]
        if (None in row or station_id not in stations or not activity or activity in seen
                or row["CharacteristicName"] != "Escherichia coli"
                or row["utility_id"] != stations[station_id]["utility_id"]):
            raise ValueError("An original microbial activity or station binding differs")
        seen.add(activity)
    counts = {utility: {"stations": sum(row["utility_id"] == utility for row in stations.values()),
                        "records": sum(row["utility_id"] == utility for row in records)}
              for utility in EXPECTED_COUNTS}
    if counts != EXPECTED_COUNTS or len(seen) != 730 or len(stations) != 36:
        raise ValueError("Retain the complete 730-result, 36-station utility source edition")
    coordinate_collection, coordinate_sources = _coordinate_sources(
        workspace, collection, entries["utility-ecoli-stations"], points)
    table_entry = entries["utility-ecoli-observations"]
    selection = {
        "title": title,
        "sources": coordinate_sources,
        "observation_tables": [_reference(collection, table_entry,
                    station_id_field="MonitoringLocationIdentifier",
                    record_id_field="ActivityIdentifier")],
        "observation_ids": [], "site_tables": [], "sites": list(stations.values()),
        "watersheds": [domain] if domain is not None else [],
        "aliases": {}, "choices": {},
        "microbial_context": {
            "source_manifest_sha256": collection["original_manifest"]["sha256"],
            "period": {"start": "2021-01-01", "end": "2025-12-31"},
            "quantity": "Original sampled E. coli concentration and detection/quantitation condition",
            "utility_source_counts": counts,
            "geographic_basis": "Original WQP CSV coordinates and declared WGS84/NAD83 datums",
            "coordinate_source_collection_id": coordinate_collection["id"],
            "coordinate_source_counts": {"EPSG:4326": 34, "EPSG:4269": 2},
            "watershed_basis": "Original 217-HUC polygon membership" if domain else
                               "Point and utility-source context; watershed overlay not selected",
            "original_report_source_id": "utility-ecoli-offline-explorer",
        },
    }
    return selection, counts


def prepare(workspace, *, manifest=None, title=TITLE, domain_reference=None, domain_mode="auto"):
    """Import/reuse the actual original source and retain an ordinary native selection."""
    title = str(title).strip()
    if not title:
        raise ValueError("Name the saved original observation study")
    collection, entries = _collection(workspace, manifest)
    domain, source_notes = _choose_domain(workspace, domain_reference, domain_mode)
    selection, counts = _selection(workspace, collection, entries, domain, title)
    identity = {"schema": SCHEMA, "workspace_id": workspace.project["id"],
                "source_collection_id": collection["id"], "selection": selection}
    key = digest(identity)
    directory = workspace.root / FOLDER / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".selection.lock", blocking=False):
        atomic_json(directory / "selection.json", selection, immutable=True)
        value = {"schema": SCHEMA, "id": key, "identity": identity, "title": title,
                 "workspace_id": workspace.project["id"], "source_collection_id": collection["id"],
                 "selection": selection, "source_counts": counts,
                 "domain": domain, "source_notes": source_notes,
                 "action": "station.geography.build", "payload": {"selection": selection},
                 "files": {"selection": describe_file(directory, directory / "selection.json")}}
        # Availability notes describe this preparation; immutable selection carries source identity.
        atomic_json(directory / "preparation.json", value)
        return {**value, "directory": str(directory),
                "files": {**value["files"],
                          "preparation": describe_file(directory, directory / "preparation.json")}}


def build(workspace, *, manifest=None, title=TITLE, domain_reference=None, domain_mode="auto"):
    """Use the maintained station engine, retaining its original report, map and archive."""
    from . import station_geography
    prepared = prepare(workspace, manifest=manifest, title=title,
                       domain_reference=domain_reference, domain_mode=domain_mode)
    directory = Path(prepared["directory"])
    with held(directory / ".build.lock", blocking=False):
        saved = station_geography.build(workspace, prepared["selection"])
        received = station_geography.inspect(workspace, saved["id"], verify=True, include_result=True)
        summary = received["summary"]
        expected = {"station_count": 36, "located_count": 36, "unresolved_count": 0,
                    "observation_count": 730, "unassigned_observation_count": 0}
        if any(summary.get(name) != count for name, count in expected.items()):
            raise ValueError("The native station study must retain all 36 points and 730 original activity links")
        report_path, report_entry = workspace.source_file(
            prepared["source_collection_id"], "utility-ecoli-offline-explorer")
        receipt = {
            "schema": SCHEMA, "id": prepared["id"], "state": "complete",
            "workspace_id": workspace.project["id"], "title": prepared["title"],
            "source_collection_id": prepared["source_collection_id"],
            "station_geography_id": received["id"],
            "station_geography_build_id": received["build_id"],
            "spatial_source_collection_id": received["source_collection_id"],
            "selection": prepared["selection"], "source_counts": prepared["source_counts"],
            "summary": summary, "domain": prepared["domain"],
            "original_report": {"source_id": report_entry["id"],
                                "source_sha256": report_entry["body"]["sha256"],
                                "local_path": str(report_path)},
            "station_geography_files": received["files"],
        }
        atomic_json(directory / "receiving.json", receipt)
        return {**receipt, "directory": str(directory),
                "receiving_file": describe_file(workspace.root, directory / "receiving.json")}


def inspect(workspace, operation_id):
    from . import station_geography
    directory = workspace.root / FOLDER / identifier(operation_id)
    preparation = read_json(directory / "preparation.json")
    if (preparation.get("schema") != SCHEMA or preparation.get("id") != operation_id
            or digest(preparation["identity"]) != operation_id
            or preparation.get("workspace_id") != workspace.project["id"]):
        raise ValueError("Choose this Workspace's original microbial study preparation")
    selection_path = verify_file(directory, preparation["files"]["selection"])
    if (preparation["selection"] != preparation["identity"]["selection"]
            or read_json(selection_path) != preparation["selection"]):
        raise ValueError("The retained microbial selection differs from its original identity")
    receipt = read_json(directory / "receiving.json")
    if (receipt.get("id") != operation_id or receipt.get("state") != "complete"
            or receipt["selection"] != preparation["selection"]):
        raise ValueError("Choose a completed original microbial study receiving")
    native = station_geography.inspect(workspace, receipt["station_geography_id"], verify=True)
    if native["selection"] != receipt["selection"]:
        raise ValueError("The saved native geography selection differs")
    report, unused = workspace.source_file(receipt["source_collection_id"],
                                          receipt["original_report"]["source_id"])
    return {**receipt, "original_report": {**receipt["original_report"], "local_path": str(report)},
            "station_geography_files": native["files"], "directory": str(directory),
            "receiving_file": describe_file(workspace.root, directory / "receiving.json")}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--manifest", type=Path, default=SOURCE_DIRECTORY / "source-manifest.json")
    parser.add_argument("--retained-only", action="store_true",
                        help="Use the already imported original source without a local manifest")
    parser.add_argument("--title", default=TITLE)
    parser.add_argument("--domain-mode", choices=("auto", "none", "required"), default="auto")
    parser.add_argument("--domain-collection")
    parser.add_argument("--domain-source")
    parser.add_argument("action", choices=("prepare", "build", "inspect"))
    parser.add_argument("--operation-id", help="Saved microbial study identity for inspect")
    args = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(args.workspace.resolve(strict=True))
    if bool(args.domain_collection) != bool(args.domain_source):
        parser.error("Supply the original domain collection and source together")
    if args.action == "inspect":
        if not args.operation_id:
            parser.error("Inspect requires the retained operation identity")
        result = inspect(workspace, args.operation_id)
    else:
        reference = ({"collection_id": args.domain_collection, "source_id": args.domain_source}
                     if args.domain_collection else None)
        result = (prepare if args.action == "prepare" else build)(
            workspace, manifest=None if args.retained_only else args.manifest,
            title=args.title, domain_reference=reference, domain_mode=args.domain_mode)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
