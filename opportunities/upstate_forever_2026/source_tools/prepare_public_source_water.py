#!/usr/bin/env python3
"""Prepare four published source-water areas in an existing native Workspace.

Inputs are original public SCDES records plus an explicit receptor specification.
The installed application supplies Workspace and the receiving-water GIS engine.
"""
from __future__ import annotations

import argparse
import base64
import copy
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def save_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(text)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)



ORIGINAL_POLYGON_PATH = (
    "source/water_context/20261012/public-water/raw/"
    "scdes-arjws-prwd-source-water-protection-original.json"
)
ORIGINAL_POLYGON_BYTES = 2389556
ORIGINAL_POLYGON_SHA256 = "ddac0feb1c704ca5e95336e21961e08beede1f83b6b820423dffa5a63bd8e285"
CARRIER_LIMIT = 16 * 1024 * 1024


def unique_json_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate source-carrier JSON key: " + str(key))
        result[key] = value
    return result


def carrier_json(data):
    return json.loads(data.decode("utf-8-sig"), object_pairs_hook=unique_json_pairs)


def limited_gunzip(data):
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
        result = stream.read(CARRIER_LIMIT + 1)
    if len(result) > CARRIER_LIMIT:
        raise ValueError("Decoded public-water carrier exceeds 16 MiB")
    return result


def decode_original_polygon(carrier: Path):
    """Read the retained original response or its complete published carrier."""
    if carrier.stat().st_size > CARRIER_LIMIT:
        raise ValueError("Public-water carrier exceeds 16 MiB")
    data = carrier.read_bytes()
    if data.startswith(b"\x1f\x8b"):
        data = limited_gunzip(data)
    text = data.decode("utf-8-sig")
    if text.lstrip().startswith("{"):
        value = carrier_json(data)
    else:
        parts = []
        pattern = r"^[ \t]*\x60{3}json[ \t]*\r?\n(.*?)^[ \t]*\x60{3}[ \t]*(?:\r?\n|$)"
        for body in re.findall(pattern, text, flags=re.MULTILINE | re.DOTALL):
            item = json.loads(body, object_pairs_hook=unique_json_pairs)
            if isinstance(item, dict) and item.get("schema") == "upstate.application-source-part/v1":
                parts.append(item)
        if not parts:
            raise ValueError("The original public-water source parts were not found")
        first = parts[0]
        count = first.get("parts")
        if type(count) is not int or not 1 <= count <= 128 or len(parts) != count:
            raise ValueError("The original public-water source part inventory is incomplete")
        if any(type(part.get("part")) is not int for part in parts):
            raise ValueError("Invalid original public-water source part number")
        parts.sort(key=lambda part: part["part"])
        if [part["part"] for part in parts] != list(range(1, count + 1)):
            raise ValueError("Missing or duplicate original public-water source part")
        fields = (
            "schema", "edition", "parts", "encoding", "payload_bytes",
            "payload_sha256", "compressed_bytes", "compressed_sha256",
        )
        if any(any(part.get(key) != first.get(key) for key in fields) for part in parts):
            raise ValueError("Public-water source parts belong to different carriers")
        if first.get("encoding") != "gzip+base64":
            raise ValueError("Unsupported original public-water source encoding")
        for field in ("compressed_bytes", "payload_bytes"):
            if type(first.get(field)) is not int or not 0 < first[field] <= CARRIER_LIMIT:
                raise ValueError("Invalid public-water carrier size: " + field)
        compressed = base64.b64decode("".join(part["data"] for part in parts), validate=True)
        if (len(compressed) != first["compressed_bytes"]
                or hashlib.sha256(compressed).hexdigest() != first["compressed_sha256"]):
            raise ValueError("Original public-water compressed carrier identity differs")
        data = limited_gunzip(compressed)
        if (len(data) != first["payload_bytes"]
                or hashlib.sha256(data).hexdigest() != first["payload_sha256"]):
            raise ValueError("Original public-water source carrier identity differs")
        value = carrier_json(data)
    if isinstance(value, dict) and value.get("schema") == "commons.source-bank/v1":
        files = value.get("files")
        if not isinstance(files, list) or len(files) != 1:
            raise ValueError("Use the one-file original public-water geometry bank")
        entry = files[0]
        if (not isinstance(entry, dict) or entry.get("path") != ORIGINAL_POLYGON_PATH
                or entry.get("bytes") != ORIGINAL_POLYGON_BYTES
                or entry.get("sha256") != ORIGINAL_POLYGON_SHA256
                or not isinstance(entry.get("content"), str)):
            raise ValueError("The geometry bank is not the original public-water source")
        data = entry["content"].encode("utf-8")
    elif not isinstance(value, dict) or not isinstance(value.get("features"), list):
        raise ValueError("Use the original public-water response or its retained geometry bank")
    if (len(data) != ORIGINAL_POLYGON_BYTES
            or hashlib.sha256(data).hexdigest() != ORIGINAL_POLYGON_SHA256):
        raise ValueError("Original public-water polygon byte identity differs")
    return data


def receive_original_polygon(carrier: Path, source_dir: Path):
    """Retain exact original bytes; reuse an identical received source."""
    body = decode_original_polygon(carrier)
    destination = source_dir / "raw" / Path(ORIGINAL_POLYGON_PATH).name
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink():
        raise ValueError("Original public-water destination must be a regular file")
    reused = destination.exists()
    if reused:
        if not destination.is_file() or destination.read_bytes() != body:
            raise ValueError("Existing public-water source differs: " + str(destination))
    else:
        fd, temporary = tempfile.mkstemp(prefix=".public-water-original-", dir=destination.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(body)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, destination)
            except FileExistsError:
                if destination.is_symlink() or not destination.is_file() or destination.read_bytes() != body:
                    raise ValueError("Concurrent public-water source differs: " + str(destination))
                reused = True
        finally:
            os.unlink(temporary)
        directory_fd = os.open(destination.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    return {
        "carrier": str(carrier),
        "path": str(destination),
        "bytes": len(body),
        "sha256": ORIGINAL_POLYGON_SHA256,
        "reused": reused,
    }



def validate_original_selection(source_dir: Path, receptors):
    path = source_dir / "raw" / Path(ORIGINAL_POLYGON_PATH).name
    body = path.read_bytes()
    if (len(body) != ORIGINAL_POLYGON_BYTES
            or hashlib.sha256(body).hexdigest() != ORIGINAL_POLYGON_SHA256):
        raise ValueError("Prepared public-water input is not the retained original polygon response")
    original = carrier_json(body)
    reference = original.get("spatialReference", {})
    if (reference.get("latestWkid") or reference.get("wkid")) != 26917:
        raise ValueError("Original public-water geometry must retain EPSG:26917")
    features = original.get("features", [])
    if len(features) != 4 or {feature.get("attributes", {}).get("OBJECTID") for feature in features} != {11, 12, 131, 132}:
        raise ValueError("Original public-water geometry must retain all four published records")
    selected = set()
    for receptor in receptors:
        selector = receptor["source"]
        where = selector.get("where")
        if (selector.get("source_id") != "scdes-arjws-prwd-swpa-20261012"
                or not isinstance(where, dict)
                or set(where) != {"OBJECTID", "INTAKE", "BUFFER_FT"}):
            raise ValueError("Use each original typed public-water record selector")
        matches = [
            feature for feature in features
            if all(type(feature["attributes"].get(key)) is type(value)
                   and feature["attributes"].get(key) == value
                   for key, value in where.items())
        ]
        if len(matches) != 1:
            raise ValueError("Public-water receptor does not select one original typed record: " + receptor["id"])
        selected.add(matches[0]["attributes"]["OBJECTID"])
    if selected != {11, 12, 131, 132}:
        raise ValueError("Public-water receptors must preserve the four distinct original records")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-root", required=True, type=Path,
                        help="Existing application directory containing model/workspace.py.")
    parser.add_argument("--workspace", required=True, type=Path,
                        help="Existing native Workspace to receive the original sources.")
    parser.add_argument("--source-dir", type=Path,
                        default=Path(__file__).resolve().parents[1] /
                        "source/water_context/20261012/public-water")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--geometry-carrier", type=Path,
                        help="Original polygon JSON or the complete retained 26-part Markdown carrier.")
    args = parser.parse_args()
    model_root = args.model_root.resolve()
    source_dir = args.source_dir.resolve()
    output = args.out.resolve()
    if not (model_root / "model/workspace.py").is_file():
        parser.error("--model-root must contain the installed model/workspace.py.")
    manifest_path = source_dir / "sources.public-native.json"
    spec = copy.deepcopy(read_json(source_dir / "receiving-waters.public-spec.json"))
    expected = {"arjws-swpa-1500", "arjws-swpa-200",
                "prwd-swpa-1500", "prwd-swpa-200"}
    receptors = spec.get("receptors", [])
    if len(receptors) != 4 or {item.get("id") for item in receptors} != expected:
        raise ValueError("The public source-water specification must contain its four distinct receptors.")
    if spec.get("analysis_crs") != "EPSG:26917":
        raise ValueError("The source-area operation uses the original EPSG:26917 analytical CRS.")
    for receptor in receptors:
        if receptor.get("relation", {}).get("method") != "source_area":
            raise ValueError("Use the published polygon through the source_area relation.")
        if receptor.get("source", {}).get("source_collection_id") is not None:
            raise ValueError("The input specification must bind to this actual native import.")

    received_geometry = None
    if args.geometry_carrier is not None:
        received_geometry = receive_original_polygon(args.geometry_carrier.resolve(strict=True), source_dir)
    validate_original_selection(source_dir, receptors)

    sys.path.insert(0, str(model_root))
    from model.workspace import Workspace
    from model.receiving_waters import prepare

    workspace = Workspace(args.workspace.resolve(), create=False)
    # The importer checks original byte hashes, including both metadata companions.
    collection = workspace.import_sources(str(manifest_path))
    entries = {entry["id"]: entry for entry in collection["entries"]}
    required_sources = {"scdes-public-surface-intakes-20261012",
                        "scdes-arjws-prwd-swpa-20261012"}
    if not required_sources.issubset(entries):
        raise ValueError("Native import did not retain the required original sources.")
    for receptor in receptors:
        receptor["source"]["source_collection_id"] = collection["id"]
        receptor["metadata"]["intake_reference"]["source_collection_id"] = collection["id"]
    save_json(output / "receiving-waters-spec.json", spec)
    plan = prepare(workspace, spec)
    outcome = {
        "schema": "upstate.public-water-preparation/v1",
        "workspace": str(workspace.root),
        "application_root": str(model_root),
        "python_version": sys.version.split()[0],
        "source_collection_id": collection["id"],
        "original_protection_sha256": entries["scdes-arjws-prwd-swpa-20261012"]["body"]["sha256"],
        "plan_id": plan["id"],
        "plan_state": plan["state"],
        "analysis_crs": spec["analysis_crs"],
        "receptor_ids": [item["id"] for item in receptors],
        "source_records": [
            {
                "id": source_id,
                "uri": entries[source_id]["uri"],
                "sha256": entries[source_id]["body"]["sha256"],
                "bytes": entries[source_id]["body"]["bytes"],
                "features": entries[source_id]["features"],
            }
            for source_id in sorted(required_sources)
        ],
        "native_manifest": str(manifest_path),
        "native_selection": str(output / "receiving-waters-spec.json"),
    }
    if received_geometry is not None:
        outcome["received_original_geometry"] = received_geometry
    # Retain the exact source-area choices for the existing scenario analysis desk.
    # Model totals remain clipped to that desk's selected baseline reporting area.
    zones = []
    for receptor in receptors:
        metadata = copy.deepcopy(receptor.get("metadata", {}))
        metadata.update({
            "source_plan_id": plan["id"],
            "receptor_ids": [receptor["id"]],
            "source_relation_method": receptor["relation"]["method"],
            "source_geometry_scope": "published_polygon",
            "source_classification": copy.deepcopy(receptor.get("classification", {})),
        })
        zones.append({
            **copy.deepcopy(receptor["source"]),
            "id": receptor["id"],
            "title": receptor["title"],
            "map_family": receptor["family"],
            "metadata": metadata,
        })
    source_areas_path = output / "scenario-source-areas.json"
    source_areas = {
        "schema": "upstate.scenario-source-areas/v1",
        "selection": {
            "title": "Published source-water planning areas",
            "zones": zones,
        },
        "origin": {
            "source_plan_id": plan["id"],
            "workspace": str(workspace.root),
            "analysis_crs": spec["analysis_crs"],
            "source_collection_id": collection["id"],
            "original_protection_sha256": outcome["original_protection_sha256"],
            "source_records": copy.deepcopy(outcome["source_records"]),
            "native_preparation": str(output / "public-water-preparation.json"),
            "native_selection": str(output / "receiving-waters-spec.json"),
        },
    }
    save_json(source_areas_path, source_areas)
    outcome["native_source_areas"] = str(source_areas_path)
    save_json(output / "public-water-preparation.json", outcome)
    print(json.dumps(outcome, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
