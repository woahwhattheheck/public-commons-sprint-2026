#!/usr/bin/env python3
"""Receive the retained ten-county Web Map using the current native application."""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import importlib.util
import json
from pathlib import Path
import sys
import time


def receive(application, workspace, state_directory, timeout=240, *,
            collection_receiver=None, collection_state_directory=None,
            gis_state_directory=None):
    application, workspace = Path(application).resolve(), Path(workspace).resolve()
    state_directory = Path(state_directory).resolve()
    state_directory.mkdir(parents=True, exist_ok=True)
    sys.path[:0] = [str(application / "operator"), str(application)]
    from server import Operator, Fault
    from webmap_sources import WebmapSources
    from model import webmap_sources as model
    from model.landcover_workspace import _zones

    operator = Operator(workspace, state_directory)
    try:
        key = operator.primary
        native = operator.ws(key)
        feature = WebmapSources(operator, Fault)
        parent_collection = "9d00453f8ade3b8f5ec1cdf4effc77c053aaed9a5f8fc555901459693fa1f4c3"
        original_source = "UF-DRINKING-WATER-DATA"
        path, original = native.source_file(parent_collection, original_source)
        if original["body"]["sha256"] != model.CONTEXT_PARENT_SHA256:
            raise ValueError("Receive the exact retained publisher source edition for this procedure.")
        if hashlib.sha256(path.read_bytes()).hexdigest() != model.CONTEXT_PARENT_SHA256:
            raise ValueError("Original publisher bytes changed.")
        chosen = {"source_collection_id": parent_collection, "source_id": original_source}
        before = feature.read(key, "catalog", chosen)
        layers = [row for row in before["layers"] if row["eligible"] and
                  row["feature_count"] == 10 and row["suggested_id_field"] == "CNTYNAME"]
        if len(layers) != 1:
            raise ValueError("Expected exactly one retained original ten-county polygon layer.")
        payload = {**chosen, "layer_paths": [layers[0]["layer_path"]], "context_id": model.CONTEXT_ID}
        operation = "eco264b_original_county_admission_v2"
        task = operator.submit(key, "webmap.source.admit", payload, operation)
        deadline = time.monotonic() + timeout
        while task["state"] in {"queued", "running"}:
            if time.monotonic() >= deadline:
                raise TimeoutError("Original admission is still active: " + task["id"])
            time.sleep(0.1)
            task = operator.task(task["id"])
        if task["state"] != "complete":
            raise RuntimeError(json.dumps(task, ensure_ascii=False))
        result = task["result"]
        replay = operator.submit(key, "webmap.source.admit", payload, operation)
        if replay["id"] != task["id"]:
            raise AssertionError("The same original operation created a second task.")
        direct_replay = model.admit(native, payload)
        if direct_replay["source_collection_id"] != result["source_collection_id"]:
            raise AssertionError("Original immutable source admission did not replay.")
        vector = next(row for row in result["admitted_sources"] if row["kind"] == "vector")
        admitted_path, admitted_entry = native.source_file(result["source_collection_id"], vector["source_id"])
        geo = json.loads(admitted_path.read_text(encoding="utf-8"))
        original_document = json.loads(path.read_text(encoding="utf-8"))
        selected_layer = next(item[1] for item in model._walk(original_document)[0]
                              if item[0] == layers[0]["layer_path"])
        source_features = selected_layer["featureSet"]["features"]
        if len(geo["features"]) != len(source_features):
            raise AssertionError("An original county disappeared during admission.")
        for old, new in zip(source_features, geo["features"]):
            if old["attributes"] != new["properties"]:
                raise AssertionError("Original feature order or attributes changed.")
        # This is the actual native reporting-region reader, not a replacement parser.
        zones, zone_binding = _zones(native, vector["region_selector"])
        zone_count = len(zones["features"])
        if zone_count != 10:
            raise AssertionError("The original native reporting-region reader lost counties.")
        if zone_binding["source_collection_id"] != result["source_collection_id"]:
            raise AssertionError("The native region reader used another source collection.")
        if [row["properties"]["_source_properties"] for row in zones["features"]] != [
                row["attributes"] for row in source_features]:
            raise AssertionError("Native reporting region properties differ from the original counties.")
        declared_companions = []
        for row in admitted_entry.get("companions", []):
            member = (native.root / row["object"]).resolve(strict=True)
            if hashlib.sha256(member.read_bytes()).hexdigest() != row["sha256"]:
                raise AssertionError("An original declared companion differs.")
            declared_companions.append({"filename": row["filename"], "bytes": row["bytes"],
                                        "sha256": row["sha256"]})
        full_parent_companion = next(
            (row for row in declared_companions if row["filename"] == "original-webmap.raw.json"), None)
        if (full_parent_companion is None or
                full_parent_companion["sha256"] != model.CONTEXT_PARENT_SHA256 or
                full_parent_companion["bytes"] != original["body"]["bytes"]):
            raise AssertionError("The selected vector does not carry its exact original Web Map parent.")
        context_row = next(row for row in result["admitted_sources"]
                           if row["role"] == "dated_county_context")
        table_path, table_entry = native.source_file(result["source_collection_id"], context_row["source_id"])
        county_rows = list(csv.DictReader(io.StringIO(table_path.read_text(encoding="utf-8"))))
        if any(len(row["GEOID"]) != 5 or len(row["COUNTY"]) != 3 or row["STATE"] != "45"
               for row in county_rows):
            raise AssertionError("An exact county identifier lost its string representation.")
        if sum(int(row["pop_est_2025_v2025"]) for row in county_rows) != 1659022:
            raise AssertionError("The dated original county total changed.")
        report_descriptor = next(row for row in table_entry["companions"]
                                 if row["filename"] == "county-population-context.html")
        report_path = native.root / report_descriptor["object"]
        if b"1,659,022" not in report_path.read_bytes():
            raise AssertionError("The human-readable county report is incomplete.")
        refreshed = feature.read(key, "catalog", chosen)
        saved = next(row for row in refreshed["admissions"]
                     if row["admission_id"] == result["admission_id"])
        if saved["source_collection_id"] != result["source_collection_id"] or not saved["files"]:
            raise AssertionError("Saved admission did not recreate original download tickets.")
        for ticket in saved["files"]:
            stream, _ = operator.open_download(ticket["id"])
            try:
                hasher, size = hashlib.sha256(), 0
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    hasher.update(chunk)
                    size += len(chunk)
            finally:
                stream.close()
            if size != ticket["bytes"] or hasher.hexdigest() != ticket["sha256"]:
                raise AssertionError("A native retained source download changed.")
        proof = {"status": "passed", "scope": "native_webmap_admission", "project_id": native.project["id"], "workspace_key": key,
                 "parent_source_collection_id": parent_collection, "parent_source_id": original_source,
                 "parent_sha256": model.CONTEXT_PARENT_SHA256, "task_id": task["id"],
                 "admission_id": result["admission_id"],
                 "source_collection_id": result["source_collection_id"],
                 "original_counties": [f["properties"]["CNTYNAME"] for f in geo["features"]],
                 "native_region_selector": vector["region_selector"],
                 "native_region_reader_completed": True, "native_region_result_length": zone_count,
                 "original_attributes_and_order_preserved": True,
                 "declared_vector_companions": declared_companions,
                 "exact_original_parent_companion": full_parent_companion,
                 "county_population_2025": 1659022, "same_task_replay": True,
                 "same_source_collection_replay": True, "native_download_count": len(saved["files"]),
                 "admitted_sources": result["admitted_sources"]}
    finally:
        operator.close()

    operator = Operator(workspace, state_directory)
    try:
        key = operator.primary
        feature = WebmapSources(operator, Fault)
        reopened = next(row for row in feature.read(key, "catalog", chosen)["admissions"]
                        if row["admission_id"] == proof["admission_id"])
        if reopened["source_collection_id"] != proof["source_collection_id"]:
            raise AssertionError("Restart changed the retained scientific sources.")
        replay = operator.submit(key, "webmap.source.admit", payload, operation)
        if replay["id"] != proof["task_id"]:
            raise AssertionError("Restart changed the original queued operation.")
        proof["restart_reopened"] = True
        proof["files"] = reopened["files"]
        selected_refs = None
        if collection_receiver is not None:
            from intelligence import IntelligenceFeature
            choices = IntelligenceFeature(operator, Fault).read(
                key, "collection_sources", {})["sources"]
            targets = [vector["source_id"], context_row["source_id"]]
            selected_refs = []
            for target_source in targets:
                matches = [row for row in choices
                           if (row.get("metadata") or {}).get("native_kind") == "retained_source"
                           and ((row.get("metadata") or {}).get("source_binding") or {}).get(
                               "collection_id") == proof["source_collection_id"]
                           and ((row.get("metadata") or {}).get("source_binding") or {}).get(
                               "source_id") == target_source
                           and ((row.get("metadata") or {}).get("source_binding") or {}).get(
                               "role") == "primary"]
                if len(matches) != 1:
                    raise ValueError("The original collection browser did not expose exactly one admitted primary: " +
                                     target_source)
                selected_refs.append(matches[0]["ref"])
            refs_path = state_directory / "selected-original-collection-refs.json"
            refs_path.write_text(json.dumps(selected_refs, ensure_ascii=False, indent=2) + "\n",
                                 encoding="utf-8")
            proof["selected_collection_refs"] = selected_refs
            proof["selected_collection_refs_file"] = str(refs_path)
    finally:
        operator.close()
    target = state_directory / "original-county-admission-result.json"
    target.write_text(json.dumps(proof, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if collection_receiver is not None:
        receiver_path = Path(collection_receiver).resolve(strict=True)
        receiver_sha = hashlib.sha256(receiver_path.read_bytes()).hexdigest()
        expected_receiver_sha = "1a09feb60341acec44079e85908d2335a6c5dc34a99badbcf46fe7b019a9e665"
        if receiver_sha != expected_receiver_sha:
            raise ValueError("Use the complete companion-aware receiving source from F0C89BW08CX.")
        specification = importlib.util.spec_from_file_location("eco264b_original_collection_receiver", receiver_path)
        receiver = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(receiver)
        collection_state = Path(collection_state_directory).resolve() if collection_state_directory else (
            state_directory / "selected-collection-receiving")
        if collection_state == state_directory:
            raise ValueError("Use a separate state directory for the collection receiving operation.")
        proof["collection_receiving"] = receiver.run(
            application, workspace, collection_state, selected_refs=selected_refs,
            timeout=timeout, require_declared_companions=True)
        proof["scope"] = "native_webmap_admission_and_selected_original_collection"
        target.write_text(json.dumps(proof, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if gis_state_directory is not None:
        gis_state = Path(gis_state_directory).resolve()
        collection_state = Path(collection_state_directory).resolve() if collection_state_directory else (
            state_directory / "selected-collection-receiving")
        if gis_state in (state_directory, collection_state):
            raise ValueError("Use a separate state directory for native GIS receiving.")
        sys.path.insert(0, str(application / "source_tools"))
        from receive_webmap_gis import receive as receive_gis
        proof["gis_receiving"] = receive_gis(
            application, workspace, proof["source_collection_id"], gis_state, timeout)
        proof["scope"] += "_and_native_gis_handover"
        target.write_text(json.dumps(proof, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return proof


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--state-directory", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=240)
    parser.add_argument("--collection-receiver", type=Path)
    parser.add_argument("--collection-state-directory", type=Path)
    parser.add_argument("--gis-state-directory", type=Path)
    args = parser.parse_args()
    print(json.dumps(receive(args.application, args.workspace, args.state_directory, args.timeout,
                             collection_receiver=args.collection_receiver,
                             collection_state_directory=args.collection_state_directory,
                             gis_state_directory=args.gis_state_directory),
                     ensure_ascii=False, indent=2))
