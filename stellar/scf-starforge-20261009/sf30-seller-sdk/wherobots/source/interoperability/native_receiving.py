"""Operate complete original GeoParquet examples through the Wherobots receiving application."""
from __future__ import annotations
import argparse
import csv
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys
from datetime import datetime, timezone

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE))
from wherobots_operator.storage import Workspace, OperationError
from wherobots_operator.editions import (
    create_edition, compare_editions, edition_rows, _part, _lossless_json,
    _geometry_stats, _geometry_observe, _geometry_result, ExactNumber,
    _file_hash, _canonical, _digest, _record_body,
)
from wherobots_operator.portable import (
    export_handover, import_handover, export_dataset_handover, _private_write,
)

def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2).encode() + b"\n"

def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def retained_record(workspace, kind, identifier, body):
    try:
        return workspace.get_record(kind, identifier)
    except OperationError as error:
        if error.status != 404:
            raise
    return workspace.save_record(kind, identifier, body)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    out = args.out.absolute()
    out.mkdir(mode=0o700, parents=True, exist_ok=True)
    fixture_root = Path(__file__).parent / "fixtures"
    manifest_bytes = (fixture_root / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    input_receipts = {}
    for item in manifest["files"]:
        path = fixture_root / item["path"]
        content = path.read_bytes()
        git_blob = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
        if git_blob != item["gitBlobSha"] or len(content) != item["bytes"]:
            raise RuntimeError("Original public fixture changed: " + item["path"])
        input_receipts[item["id"]] = {**item, **_file_hash(path), "path": str(path)}
    import pyarrow
    try:
        sdk_version = importlib.metadata.version("wherobots-python-sdk")
    except importlib.metadata.PackageNotFoundError:
        sdk_version = None
    result_path = out / "operation.json"
    workflow_id = "geoparquet-original-source-receiving"
    source_directory = out / "source-workspace"
    customer_directory = out / "customer-workspace"
    with Workspace(source_directory, create=True, title="Original GeoParquet source editions") as workspace:
        fixture_objects = {key: workspace.put_object(Path(item["path"])) for key, item in input_receipts.items()}
        manifest_object = workspace.put_object(manifest_bytes)
        script_object = workspace.put_object(Path(__file__))
        definitions = [
            {"id": "countries", "title": "Original versioned GeoParquet countries",
             "format": "geoparquet", "primary_key": ["name"]},
            {"id": "countries-csv", "title": "Original GeoParquet project CSV",
             "format": "csv", "csv": {"header": True}, "primary_key": ["name"],
             "geometry_column": "geometry", "geometry_encoding": "WKT",
             "crs": "OGC:CRS84", "axis_order": "longitude,latitude"},
            {"id": "attributes-json", "title": "Exact JSON view of original Parquet attributes",
             "format": "ndjson", "primary_key": ["name"]},
            {"id": "coordinate-envelopes", "title": "Original-coordinate feature envelopes",
             "format": "geojson-seq", "primary_key": ["/properties/name"]},
        ]
        definition = {"schema": "starforge.wherobots.source-interoperability.v1",
                      "id": workflow_id, "title": "GeoParquet source interoperability",
                      "outputs": definitions, "sources": [
                          {"id": key, "uri": item["url"], "git_blob_sha": item["gitBlobSha"],
                           "object": fixture_objects[key]} for key, item in input_receipts.items()],
                      "job": {"name": "public-source-receiving", "script": {"filename": Path(__file__).name,
                              "object": script_object}},
                      "account": {"organization_id": None, "region": None, "runtime": None},
                      "input_manifest": {"object": manifest_object}}
        workflow = retained_record(workspace, "workflow", workflow_id, {
            "id": workflow_id, "workflow_id": workflow_id, "definition": definition,
            "schema": "starforge.wherobots.source-interoperability.v1",
            "created_at": now(), "updated_at": now(),
        })
        if _digest(workflow["definition"]) != _digest(definition):
            raise RuntimeError("This operation directory belongs to another reviewed source collection")

        def stage(name, build):
            path = out / (name + ".json")
            if path.exists():
                saved = json.loads(path.read_text())
                if saved["input_manifest_sha256"] != hashlib.sha256(manifest_bytes).hexdigest():
                    raise RuntimeError("A retained stage belongs to another source manifest")
                value = saved["result"]
                if isinstance(value, dict) and value.get("path") and value.get("sha256"):
                    if _file_hash(Path(value["path"])) != {key: value[key] for key in ("sha256", "bytes")}:
                        raise RuntimeError("A retained stage artifact changed")
                return value
            result = build()
            _private_write(path, json_bytes({"input_manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
                                           "result": result}))
            return result

        # Both complete derived views are created by this published source transform.
        # The original public files and their names remain separate retained objects.
        generated = out / "derived"
        generated.mkdir(mode=0o700, exist_ok=True)
        generated_paths = [generated / "part-00000.ndjson", generated / "part-00001.ndjson"]
        feature_path = generated / "envelopes.geojson-seq"
        parquet_path = Path(input_receipts["parquet-1.1.0"]["path"])
        information, original_rows = _part(parquet_path, definitions[0])
        original_metadata = information["geometry"]["geometry"]
        crs = original_metadata["crs"]
        declared = json.loads(crs["projjson"]) if crs.get("projjson") else None
        known_wgs84 = crs.get("value") == "OGC:CRS84" or (
            isinstance(declared, dict) and declared.get("id", {}).get("authority") == "OGC" and
            declared.get("id", {}).get("code") == "CRS84")
        if not known_wgs84:
            raise RuntimeError("The original fixture must declare OGC:CRS84 for its GeoJSON envelope view")
        split = (information["metadata_rows"] + 1) // 2
        generated_count = 0
        streams = [open(path, "wb") for path in generated_paths]
        features = open(feature_path, "wb")
        try:
            for row_number, row, _, _ in original_rows:
                streams[int(row_number >= split)].write(_lossless_json(row).encode("utf-8") + b"\n")
                stats = _geometry_stats()
                _geometry_observe(stats, row["geometry"], original_metadata)
                envelope = _geometry_result(stats)["coordinate_envelope"]
                geometry = None
                if envelope:
                    if len(envelope) != 4:
                        raise RuntimeError("The original sample has a non-XY envelope")
                    low_x, low_y, high_x, high_y = map(ExactNumber, envelope)
                    geometry = {"type": "Polygon", "coordinates": [[
                        [low_x, low_y], [high_x, low_y], [high_x, high_y],
                        [low_x, high_y], [low_x, low_y]]]}
                feature = {"type": "Feature", "properties": {
                    **{key: value for key, value in row.items() if key != "geometry"},
                    "source_geometry_object": fixture_objects["parquet-1.1.0"]["sha256"],
                    "operation": "coordinate-envelope-in-original-CRS",
                }, "geometry": geometry}
                features.write(b"\x1e" + _lossless_json(feature).encode("utf-8") + b"\n")
                generated_count += 1
        finally:
            original_rows.close()
            for stream in [*streams, features]:
                stream.close()
        if generated_count != information["metadata_rows"]:
            raise RuntimeError("Original Parquet row-group count changed during derivation")
        derived_objects = [workspace.put_object(path) for path in generated_paths]
        feature_object = workspace.put_object(feature_path)
        marker = workspace.put_object(b"")
        derivation_object = workspace.put_object(_canonical({
            "schema": "starforge.wherobots.object-references.v1",
            "source_objects": [fixture_objects["parquet-1.1.0"], script_object],
            "operation": "lossless-json-and-original-coordinate-envelope",
            "rows": generated_count,
        }))
        csv_path = Path(input_receipts["csv"]["path"])
        with open(csv_path, newline="", encoding="utf-8") as stream:
            csv_rows = sum(1 for _ in csv.DictReader(stream))

        def captured_edition(version):
            operation_id = "original-geoparquet-" + version
            operation = retained_record(workspace, "operation", operation_id, {
                "id": operation_id, "operation_id": operation_id, "workflow_id": workflow_id,
                "schema": "starforge.wherobots.source-interoperability-operation.v1",
                "mode": "retained-public-source", "state": "SOURCE_FILES_RETAINED",
                "reviewed_definition": definition, "review_sha256": _digest(definition),
                "native_run_id": None, "native_status": None, "native_payload": None,
                "run_objects": [], "log_captures": [], "source_objects": [manifest_object],
                "created_at": now(), "updated_at": now(),
            })
            capture_id = "source-capture-" + version
            try:
                capture = workspace.get_record("capture", capture_id)
            except OperationError as error:
                if error.status != 404:
                    raise
                datasets = []
                parts = [
                    [{"relative_path": "example.parquet", "object": fixture_objects["parquet-" + version],
                      "provider": {"source": input_receipts["parquet-" + version]["url"]}},
                     {"relative_path": "source-metadata.json", "object": fixture_objects["metadata-" + version],
                      "role": "metadata", "provider": {"scope": "matching original versioned source companion"}}],
                    [{"relative_path": "example.csv", "object": fixture_objects["csv"],
                      "provider": {"source": input_receipts["csv"]["url"]}}],
                    [{"relative_path": path.name, "object": obj, "provider": {"derivation": "lossless-json"}}
                     for path, obj in zip(generated_paths, derived_objects)] +
                    [{"relative_path": "_SUCCESS", "object": marker, "role": "marker",
                      "provider": {"derivation": "completed local source transform"}}],
                    [{"relative_path": "envelopes.geojson-seq", "object": feature_object,
                      "provider": {"derivation": "coordinate-envelope-in-original-CRS"}}],
                ]
                for output, files in zip(definitions, parts):
                    listing = workspace.put_object(_canonical({
                        "schema": "starforge.wherobots.output-listing.v1",
                        "source_objects": [manifest_object, derivation_object],
                        "definition": output, "files": files, "complete": True,
                    }))
                    datasets.append({"dataset_id": output["id"], "definition": output, "complete": True,
                                     "listing_object": listing, "source_objects": [manifest_object, derivation_object],
                                     "files": files})
                capture = workspace.save_record("capture", capture_id, {
                    "id": capture_id, "workflow_id": workflow_id, "operation_id": operation_id,
                    "native_run_id": None, "state": "COMPLETE", "datasets": datasets,
                    "created_at": now(),
                })
            edition = create_edition(workspace, operation_id, capture["datasets"])
            repeated = create_edition(workspace, operation_id, capture["datasets"])
            if repeated["id"] != edition["id"]:
                raise RuntimeError("The exact repeated source input created another edition")
            for dataset in edition["datasets"]:
                if dataset["id"] == "countries-csv" and dataset["row_count"] != csv_rows:
                    raise RuntimeError("The original CSV source count changed")
                if dataset["id"] in {"attributes-json", "coordinate-envelopes"} and dataset["row_count"] != generated_count:
                    raise RuntimeError("A complete source-derived multipart dataset lost rows")
                preview = edition_rows(workspace, edition["id"], dataset["id"], 0, 10000)
                if len(preview["rows"]) != dataset["row_count"]:
                    raise RuntimeError("The original small fixture preview did not retain every indexed row")
            return edition

        before = captured_edition("1.0.0")
        first_archive = stage("first-handover", lambda: export_handover(workspace, workflow_id, out / "first-handover.zip"))
        with Workspace(customer_directory, create=True, title="Independent customer receiving") as customer:
            def receive_first():
                result = import_handover(customer, Path(first_archive["path"]))
                repeated = import_handover(customer, Path(first_archive["path"]))
                if repeated["created"] or repeated["advanced"] or result["package_id"] != repeated["package_id"]:
                    raise RuntimeError("The original receiving operation did not reuse its first archive")
                return {"first": result, "repeat": repeated}
            first_receive = stage("first-receive", receive_first)
        after = captured_edition("1.1.0")
        comparison = compare_editions(workspace, before["id"], after["id"])
        current = workspace.get_record("workflow", workflow_id)
        if current.get("current_edition_id") != after["id"]:
            workspace.save_record("workflow", workflow_id, {
                **_record_body(current), "current_edition_id": after["id"], "updated_at": now(),
            }, current["revision_sha256"])
        sf30 = stage("sf30-package", lambda: export_dataset_handover(
            workspace, after["id"], "countries-csv", out / "sf30-dataset"))
        final_archive = stage("complete-handover", lambda: export_handover(workspace, workflow_id, out / "complete-handover.zip"))
        with Workspace(customer_directory) as customer:
            final_receive = stage("complete-receive", lambda: import_handover(customer, Path(final_archive["path"])))
            repeated = import_handover(customer, Path(final_archive["path"]))
            if repeated["created"] or repeated["advanced"]:
                raise RuntimeError("An identical corrected handover altered retained record identities")
            original_customer_id = customer.workspace_id
            received_after = customer.get_record("edition", after["id"])
            for dataset in received_after["datasets"]:
                expected = edition_rows(workspace, after["id"], dataset["id"], 0, 10000)
                actual = edition_rows(customer, after["id"], dataset["id"], 0, 10000)
                if _canonical(expected) != _canonical(actual):
                    raise RuntimeError("An independently received original dataset changed")
        with Workspace(customer_directory) as reopened:
            if reopened.workspace_id != original_customer_id:
                raise RuntimeError("Reopen changed the original receiving workspace")
            for edition in (before, after):
                saved = reopened.get_record("edition", edition["id"])
                if saved["source_binding_sha256"] != edition["source_binding_sha256"]:
                    raise RuntimeError("Reopen changed an original source edition")
            reopened_comparison = compare_editions(reopened, before["id"], after["id"])
            if reopened_comparison["id"] != comparison["id"]:
                raise RuntimeError("The corrected-edition comparison changed through receiving")
        result = {"schema": "starforge.wherobots.source-interoperability-result.v1",
                  "completed_at": now(), "scope": manifest["scope"],
                  "pyarrow_version": pyarrow.__version__, "installed_sdk_version": sdk_version,
                  "source_workspace_id": workspace.workspace_id, "customer_workspace_id": original_customer_id,
                  "workflow_id": workflow_id, "inputs": input_receipts,
                  "input_manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
                  "before_edition_id": before["id"], "after_edition_id": after["id"],
                  "datasets": [{"id": item["id"], "rows": item["row_count"], "columns": item["columns"],
                                "geometry": item["geometry"], "files": item["files"]}
                               for item in after["datasets"]],
                  "comparison": comparison, "first_archive": first_archive, "first_receive": first_receive,
                  "complete_archive": final_archive, "complete_receive": final_receive,
                  "repeat_receive": repeated, "sf30_package": sf30, "reopened": True}
        _private_write(result_path, json_bytes(result))
        print(json.dumps({"result": str(result_path), "pyarrow": pyarrow.__version__,
                          "before": before["id"], "after": after["id"], "reopened": True,
                          "datasets": {item["id"]: item["row_count"] for item in after["datasets"]},
                          "handover": final_archive}, ensure_ascii=False))

if __name__ == "__main__":
    main()
