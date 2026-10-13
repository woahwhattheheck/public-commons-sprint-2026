"""Resume retained original NHDPlus HR responses through native source import.

Uses existing capture_water_sources for missing tile inventories and HTTP retries.
No ArcGIS response is reconstructed from derived features.
"""
from __future__ import annotations
import argparse
import base64
import datetime
import hashlib
import json
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath

from source_tools.capture_water_sources import (
    DOMAIN_HASH, LAYERS, OPERATION, OriginalSource, capture_layer, dump,
    encode, json_file, load_domain, sha, subdivision_candidate, write,
)
from source_tools.water_context_geometry import select_domain_objects
from source_tools.water_context_intake import (
    assemble, bind_workspace, export_edition, water_context_spec,
)

BANK_SCHEMA = "upstate.source-files/v1"
PROGRESS_SCHEMA = "upstate.nhd-source-progress/v1"
URI = LAYERS["stream_order"]
RELATIONS = {
    "esriSpatialRelIntersects", "esriSpatialRelEnvelopeIntersects",
    "esriSpatialRelIndexIntersects",
}


def member(root, name):
    relative = PurePosixPath(name)
    if not name or relative.is_absolute() or any(p in ("..", "") for p in relative.parts):
        raise ValueError("Source member must be a safe relative path")
    resolved = (root / relative).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError("Source member escapes its capture root")
    return resolved


def retain(path, raw):
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError("Retained original bytes changed: " + str(path))
    else:
        write(path, raw)


def unpack_bank(bank_path, expected_sha, root):
    raw = Path(bank_path).read_bytes()
    if sha(raw) != expected_sha:
        raise ValueError("Source-bank SHA256 differs from the published bank")
    bank = json.loads(raw)
    if bank.get("schema") != BANK_SCHEMA:
        raise ValueError("Unsupported source bank")
    seen = set()
    for entry in bank["files"]:
        name = entry["path"]
        if name in seen:
            raise ValueError("Duplicate source-bank member")
        seen.add(name)
        body = base64.b64decode(entry["content_base64"], validate=True)
        if len(body) != entry["bytes"] or sha(body) != entry["sha256"]:
            raise ValueError("Source-bank member hash or byte count differs")
        retain(member(root, name), body)
    manifest = json_file(root / "inventory-progress.json")
    if manifest.get("schema") != PROGRESS_SCHEMA:
        raise ValueError("Unsupported NHD original-source inventory")
    if manifest["source_uri"] != URI or manifest["target"]["domain_huc12_sha256"] != DOMAIN_HASH:
        raise ValueError("Choose the original NHD source and exact 217-HUC domain")
    return manifest


def bounds(envelope):
    if isinstance(envelope, str):
        try:
            envelope = json.loads(envelope)
        except json.JSONDecodeError:
            envelope = [float(x) for x in envelope.split(",")]
    if isinstance(envelope, list):
        result = tuple(envelope)
    else:
        if envelope.get("spatialReference", {}).get("wkid", 3857) != 3857:
            raise ValueError("Retained tile must use native EPSG:3857")
        result = tuple(envelope[key] for key in ("xmin", "ymin", "xmax", "ymax"))
    if len(result) != 4 or not result[0] < result[2] or not result[1] < result[3]:
        raise ValueError("Invalid native envelope")
    return result


def relative(root, path):
    return Path(path).resolve().relative_to(root.resolve()).as_posix()


def valid_ids(value):
    if not isinstance(value, list) or any(type(x) is not int or x < 0 for x in value):
        raise ValueError("Native OBJECTIDs must be an array of nonnegative integers")
    if len(value) != len(set(value)):
        raise ValueError("Native OBJECTIDs must be unique")
    return set(value)


def original_inventory(root, retained, entry):
    count_path = member(retained, entry["count"]["path"])
    ids_path = member(retained, entry["ids"]["path"])
    count, ids = json_file(count_path), json_file(ids_path)
    selected = valid_ids(ids.get("objectIds") or [])
    if count.get("error") or ids.get("error") or ids.get("exceededTransferLimit"):
        raise ValueError("Original inventory response is an error or truncated")
    if len(selected) != count.get("count") or len(selected) != entry["native_count"]:
        raise ValueError("Original count and complete native IDs differ")
    if ids.get("objectIdFieldName", "OBJECTID") != "OBJECTID":
        raise ValueError("Unexpected NHD native object-ID field")
    requests = []
    observed_scope = None
    observed_relation = None
    for kind in ("count", "ids"):
        record = entry[kind]
        path = member(retained, record["path"])
        raw = path.read_bytes()
        if len(raw) != record["bytes"] or sha(raw) != record["sha256"]:
            raise ValueError("Original inventory bytes differ")
        request_path = member(retained, record["request_file"]["path"])
        request = json_file(request_path)
        parsed_url = urllib.parse.urlsplit(request["url"])
        if urllib.parse.urlunsplit(parsed_url._replace(query="", fragment="")) != URI + "/query":
            raise ValueError("Inventory request is not the original publisher layer")
        parameters = request["params"]
        if parameters.get("where") != "1=1" or parameters.get("spatialRel") not in RELATIONS:
            raise ValueError("A restricted attribute query cannot cover a whole grid tile")
        if parameters.get("geometryType") != "esriGeometryEnvelope" or str(parameters.get("inSR")) != "3857":
            raise ValueError("Inventory request has incompatible native geometry")
        scope = bounds(parameters["geometry"])
        if scope != bounds(entry["envelope"]) or (observed_scope and scope != observed_scope):
            raise ValueError("Inventory metadata differs from its exact query envelope")
        if observed_relation is not None and parameters["spatialRel"] != observed_relation:
            raise ValueError("Original count and ID requests use different spatial relations")
        observed_scope = scope
        observed_relation = parameters["spatialRel"]
        query_key = "returnCountOnly" if kind == "count" else "returnIdsOnly"
        if str(parameters.get(query_key)).lower() != "true":
            raise ValueError("Inventory request has the wrong response type")
        requests.append(relative(root, request_path))
    return selected, {
        "count": relative(root, count_path),
        "ids": relative(root, ids_path),
        "request": requests[1],
    }, requests, observed_scope


def verify_page(path, expected_ids, metadata):
    raw = Path(path).read_bytes()
    value = json_file(path)
    if value.get("error") or value.get("exceededTransferLimit"):
        raise ValueError("Original geometry response is an error or truncated")
    rows = value.get("features")
    if not isinstance(rows, list):
        raise ValueError("Original response contains no feature array")
    actual = valid_ids([row["attributes"]["OBJECTID"] for row in rows])
    if actual != set(expected_ids):
        raise ValueError("Original geometry response differs from its requested native IDs")
    for key in ("hasZ", "hasM"):
        if bool(value.get(key)) != bool(metadata.get(key)):
            raise ValueError("Original geometry response lost native " + key)
    sr = value.get("spatialReference", {})
    if sr.get("latestWkid", sr.get("wkid")) not in (3857, 102100):
        raise ValueError("Original geometry response has an unexpected native CRS")
    fields = {field["name"] for field in metadata["fields"]
              if field["type"] != "esriFieldTypeGeometry"}
    dimensions = 2 + bool(metadata.get("hasZ")) + bool(metadata.get("hasM"))
    for row in rows:
        if not fields.issubset(row["attributes"]):
            raise ValueError("Original geometry response dropped publisher fields")
        paths = (row.get("geometry") or {}).get("paths")
        if not isinstance(paths, list) or not paths or any(not path for path in paths):
            raise ValueError("Original feature has no native flowline geometry")
        if any(len(point) < dimensions for path in paths for point in path):
            raise ValueError("Original coordinates dropped native dimensions")
    return {"bytes": len(raw), "sha256": sha(raw), "ids": sorted(actual)}


def acquire_external_page(record, retained, download_directory, downloads, timeout):
    path = member(retained, record["path"])
    if path.exists():
        raw = path.read_bytes()
    else:
        source = downloads.get(record["filename"])
        if source is None:
            source = str(Path(download_directory) / record["filename"])
        if source.startswith("https://"):
            request = urllib.request.Request(source, headers={"Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
        else:
            raw = Path(source).read_bytes()
        if len(raw) != record["bytes"]:
            raise ValueError("Downloaded original byte count differs: " + record["filename"])
        retain(path, raw)
    if len(raw) != record["bytes"]:
        raise ValueError("Retained original byte count differs: " + record["filename"])
    return path


def resume(args):
    root = Path(args.output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    retained = root / "retained"
    retained.mkdir(exist_ok=True)
    manifest = unpack_bank(args.bank, args.bank_sha256, retained)
    summary, hucs = load_domain(args.domain_archive, root)
    if tuple(summary["native_bounds"]) != tuple(manifest["target"]["native_bounds_3857"]):
        raise ValueError("Actual original domain bounds differ from this acquisition")
    metadata_path = member(retained, manifest["metadata"]["path"])
    metadata = json_file(metadata_path)
    if not metadata.get("hasZ") or not metadata.get("hasM"):
        raise ValueError("Choose the complete retained native NHD Z/M metadata")
    metadata_oids = [f["name"] for f in metadata["fields"] if f["type"] == "esriFieldTypeOID"]
    if metadata_oids != ["OBJECTID"]:
        raise ValueError("Unexpected publisher native object-ID field")
    grid = manifest["coverage_grid"]
    target = tuple(summary["native_bounds"])
    expected_grid = []
    for row in range(4):
        for column in range(4):
            expected_grid.append((
                target[0] + (target[2] - target[0]) * column / 4,
                target[1] + (target[3] - target[1]) * row / 4,
                target[2] if column == 3 else target[0] + (target[2] - target[0]) * (column + 1) / 4,
                target[3] if row == 3 else target[1] + (target[3] - target[1]) * (row + 1) / 4,
            ))
    if [bounds(tile["envelope"]) for tile in grid] != expected_grid:
        raise ValueError("Coverage grid must exactly cover the retained model-domain envelope")
    record_path = root / "resume-operation.json"
    operation = {
        "schema": "upstate.nhd-original-resume/v1", "operation_id": OPERATION,
        "source_uri": URI, "domain_huc12_sha256": DOMAIN_HASH,
        "source_bank_sha256": args.bank_sha256,
        "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    if record_path.exists():
        existing = json_file(record_path)
        if any(existing.get(k) != v for k, v in operation.items() if k != "started_at"):
            raise ValueError("Output directory belongs to a different operation")
        operation = existing
    else:
        dump(record_path, operation)
    selected, queries, companions, covered = set(), [], [
        relative(root, retained / "inventory-progress.json"), relative(root, record_path),
    ], set()
    for entry in manifest["completed_inventory"]:
        ids, query, receipts, envelope = original_inventory(root, retained, entry)
        if not (target[0] <= envelope[0] < envelope[2] <= target[2]
                and target[1] <= envelope[1] < envelope[3] <= target[3]):
            raise ValueError("Retained candidate scope is outside the declared domain envelope")
        selected.update(ids)
        queries.append(query)
        companions.extend(receipts)
        covered.add(envelope)
    descriptor = {
        "kind": "stream_order", "uri": URI,
        "metadata": relative(root, metadata_path), "queries": queries, "pages": [],
        "companions": companions,
        "scope": {
            "selection": "Complete union of retained and resumed native envelope candidates",
            "domain_bounds_3857": list(target), "tile_rows": 4, "tile_columns": 4,
            "exact_domain_membership": "water_context_geometry.select_domain_objects",
        },
    }
    packet = {
        "schema": "upstate.water-context-capture/v1", "operation_id": OPERATION,
        "captured_at": operation["started_at"], "complete_geometry": False,
        "scope": {"domain_source_id": summary["source_id"], "huc_ids": "domain-huc12s.json",
                  "domain_summary": "domain-summary.json"},
        "layers": [descriptor],
    }
    received, page_records = set(), []
    page_progress = root / "received-geometry.json"
    downloads = json_file(args.downloads) if args.downloads else {}
    if not isinstance(downloads, dict):
        raise ValueError("Download mapping must map original filename to local path or fresh HTTPS URL")
    def accept(path, expected_ids, request_path=None, expected_hash=None):
        checked = verify_page(path, expected_ids, metadata)
        if expected_hash and checked["sha256"] != expected_hash:
            raise ValueError("Previously received original bytes changed")
        if received & set(checked["ids"]):
            raise ValueError("Retained native geometry pages overlap")
        received.update(checked["ids"])
        rel = relative(root, path)
        descriptor["pages"].append(rel)
        if request_path:
            descriptor["companions"].append(request_path)
        page_records.append({**checked, "path": rel, "request": request_path})
    for record in manifest["native_geometry_pages"]:
        path = acquire_external_page(record, retained, args.download_directory, downloads, args.timeout)
        request_path = member(retained, record["request_file"]["path"])
        request = json_file(request_path)
        if request["ids"] != record["requested_ids"]:
            raise ValueError("Original native page request differs from the saved inventory")
        params = request["params"]
        original_url = urllib.parse.urlsplit(request["url"])
        if urllib.parse.urlunsplit(original_url._replace(query="", fragment="")) != URI + "/query":
            raise ValueError("Native geometry request uses another source layer")
        if (params.get("objectIds") != ",".join(map(str, record["requested_ids"]))
                or params.get("outFields") != "*"
                or any(str(params.get(k)).lower() != "true" for k in ("returnGeometry", "returnZ", "returnM"))):
            raise ValueError("Original native page request omitted fields or geometry dimensions")
        accept(path, record["requested_ids"], relative(root, request_path), record.get("sha256"))
    if page_progress.exists():
        for record in json_file(page_progress)["pages"]:
            if record["path"] in descriptor["pages"]:
                if sha(member(root, record["path"]).read_bytes()) != record["sha256"]:
                    raise ValueError("Previously accepted original bytes changed")
                continue
            accept(member(root, record["path"]), record["ids"], record.get("request"), record["sha256"])
    def checkpoint():
        dump(page_progress, {"schema": "upstate.nhd-received-geometry/v1", "pages": page_records})
        dump(root / "capture.json", packet)
    descriptor["companions"].append(relative(root, page_progress))
    checkpoint()
    for index, tile in enumerate(grid):
        envelope = bounds(tile["envelope"])
        if envelope in covered:
            continue
        tile_root = root / "query-tiles" / tile["id"]
        reader = OriginalSource(tile_root, args.timeout)
        local_summary = dict(summary, native_bounds=list(envelope))
        result = capture_layer(reader, "stream_order", local_summary, hucs, args.chunk,
                               counts_only=True, stream_grid=1,
                               stream_max_depth=args.stream_max_depth,
                               stream_spatial_relation="index")
        current_metadata = json_file(member(tile_root, result["metadata"]))
        for key in ("fields", "hasZ", "hasM", "geometryType", "sourceSpatialReference"):
            if current_metadata.get(key) != metadata.get(key):
                raise ValueError("Publisher native schema changed during acquisition")
        for query in result["queries"]:
            new_query = {key: relative(root, member(tile_root, value)) for key, value in query.items()}
            count, ids = json_file(member(root, new_query["count"])), json_file(member(root, new_query["ids"]))
            native = valid_ids(ids.get("objectIds") or [])
            if count.get("count") != len(native) or ids.get("exceededTransferLimit"):
                raise ValueError("Resumed tile count/ID response differs")
            selected.update(native)
            descriptor["queries"].append(new_query)
        descriptor["companions"].extend(relative(root, member(tile_root, p)) for p in result["companions"])
        descriptor["companions"].append(relative(root, member(tile_root, result["metadata"])))
        covered.add(envelope)
        checkpoint()
        print(json.dumps({"tile": index + 1, "tiles": 16, "candidate_ids": len(selected)}), flush=True)
    if not received.issubset(selected):
        raise ValueError("Retained native geometry contains IDs outside the complete candidate inventory")
    packet["complete_inventory"] = True
    checkpoint()
    if args.counts_only:
        return {"capture": str(root / "capture.json"), "candidate_ids": len(selected),
                "retained_geometry_ids": len(received), "complete_inventory": True}
    reader = OriginalSource(root, args.timeout)
    def capture_batch(batch):
        label = "resumed-native-" + sha(encode(batch))[:20]
        query = {
            "f": "json", "objectIds": ",".join(map(str, batch)), "outFields": "*",
            "returnGeometry": "true", "returnTrueCurves": "false",
            "returnZ": "true", "returnM": "true",
        }
        try:
            _, page, receipt = reader.read(label, URI + "/query", query, split_timeouts=len(batch) > 1)
        except (OSError, TimeoutError) as error:
            if len(batch) < 2 or not subdivision_candidate(error):
                raise
            middle = len(batch) // 2
            capture_batch(batch[:middle])
            capture_batch(batch[middle:])
            return
        accept(member(root, page), batch, receipt)
        checkpoint()
        print(json.dumps({"received": len(received), "candidate_ids": len(selected)}), flush=True)
    missing = sorted(selected - received)
    size = min(args.chunk, int(metadata.get("maxRecordCount", 2000)))
    for start in range(0, len(missing), size):
        capture_batch(missing[start:start + size])
    if received != selected:
        raise ValueError("Complete original geometry union differs from its native-ID inventory")
    selection = select_domain_objects(
        args.domain_archive, [member(root, p) for p in descriptor["pages"]],
        root / "exact-domain-selection", metadata=metadata_path, capture_root=root,
    )
    descriptor.update({key: value for key, value in selection.items() if key != "companions"})
    descriptor["companions"].extend(selection["companions"])
    descriptor["companions"] = list(dict.fromkeys(descriptor["companions"]))
    packet["complete_geometry"] = True
    checkpoint()
    result = assemble(root / "capture.json", args.edition)
    if args.archive_output:
        result["transfer"] = export_edition(args.edition, args.archive_output)
    if args.workspace:
        from model.workspace import Workspace
        workspace = Workspace(args.workspace)
        bindings = bind_workspace(workspace, args.edition)
        dump(root / "workspace-bindings.json", bindings)
        result["workspace_bindings"] = bindings
        if args.boundary:
            spec = water_context_spec(bindings, json_file(args.boundary))
            dump(root / "water-context-selection.json", spec)
            from model.water_context import build
            assessment = build(workspace, spec)
            dump(root / "water-context-assessment.json", assessment)
            result["assessment"] = assessment
    return {key: value for key, value in result.items() if key != "files"}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bank", required=True, help="Decoded exact source-bank JSON from F0C8UD4L25S revision2 or later")
    parser.add_argument("--bank-sha256", required=True)
    parser.add_argument("--domain-archive", required=True)
    parser.add_argument("--download-directory", default=".", help="Directory containing large original geometry filenames")
    parser.add_argument("--downloads", help="Optional JSON mapping original filename to path or fresh HTTPS download URL")
    parser.add_argument("--output", required=True, help="Resumable original capture directory")
    parser.add_argument("--edition", required=True, help="Immutable prepared source-edition directory")
    parser.add_argument("--archive-output", help="Complete source-edition transfer ZIP")
    parser.add_argument("--workspace", help="Existing native Workspace path")
    parser.add_argument("--boundary", help="Existing native WaterContext boundary selector JSON; runs the real model")
    parser.add_argument("--chunk", type=int, default=500)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--stream-max-depth", type=int, default=4)
    parser.add_argument("--counts-only", action="store_true")
    args = parser.parse_args(argv)
    if not 1 <= args.chunk <= 2000 or not 0 <= args.stream_max_depth <= 8 or args.timeout < 1:
        parser.error("Choose chunk 1..2000, subdivision depth 0..8 and a positive timeout")
    if args.boundary and not args.workspace:
        parser.error("--boundary requires --workspace")
    print(json.dumps(resume(args), ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
