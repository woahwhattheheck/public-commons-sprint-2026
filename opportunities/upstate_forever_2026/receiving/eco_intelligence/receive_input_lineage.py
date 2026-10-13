#!/usr/bin/env python3
"""Receive one original run/grid input lineage and its complete portable files.

Uses actual saved workspace records and the maintained collection queue.
It never starts a scientific model or fabricates a run/source record.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile


def sha(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def immutable(path, value):
    body = (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("The original receiving file has a different selection: " + str(path))
        return
    fd, temporary = tempfile.mkstemp(prefix=".lineage-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != body:
                raise ValueError("A concurrent receiving file has a different selection")
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def run(application, workspace, directory, *, run_id=None, grid_id=None,
        require_multiple_collections=False, require_companions=False, timeout=180):
    application = Path(application).resolve(strict=True)
    workspace = Path(workspace).resolve(strict=True)
    directory = Path(directory).resolve()
    if directory == workspace or directory.is_relative_to(workspace):
        raise ValueError("Keep receiving control and independent files outside the original Workspace")
    directory.mkdir(parents=True, exist_ok=True)
    sys.path[:0] = [str(application / "operator"), str(application)]
    from server import Operator, Fault
    from intelligence import IntelligenceFeature
    from model.common import read_json
    from model.scenario_mask_sources import mask_pair

    owned = ("operator/science_catalog.py", "operator/intelligence_lineage.py",
             "operator/intelligence.py", "operator/extensions/investigations.json",
             "operator/web/investigations.mjs", "operator/web/investigation_lineage.mjs",
             "model/scenario_mask_sources.py", "science_catalog_delivery.py",
             "eco_intelligence/upstate.py",
             "receiving/eco_intelligence/receive_original_collection.py",
             "receiving/eco_intelligence/receive_input_lineage.py")
    sources = {name: {"bytes": (application / name).stat().st_size,
                      "sha256": sha(application / name)} for name in owned}
    request = {"schema": "upstate.input-lineage-receiving/v1",
               "operation": "ECO-INPUT-LINEAGE-E258-20261013",
               "application": str(application), "workspace": str(workspace),
               "run_id": run_id, "grid_id": grid_id,
               "require_multiple_collections": require_multiple_collections,
               "require_companions": require_companions, "software": sources}
    immutable(directory / "input.json", request)
    # The same original Operator owns request replay and selected collection state.
    state = directory / "operator"
    operator = Operator(workspace, state)
    try:
        key = operator.primary
        feature = IntelligenceFeature(operator, Fault)
        selection = {name: value for name, value in (("run_id", run_id), ("grid_id", grid_id))
                     if value is not None}
        graph = feature.read(key, "lineage", selection)
        if graph["issues"] or graph["registry_issues"] or not graph["export_complete"]:
            raise ValueError("Receive the complete selected originals first: " +
                             json.dumps(graph["issues"] + graph["registry_issues"]))
        immutable(directory / "lineage.json", graph)
        masks = [row for row in graph["dependencies"] if row["kind"] == "scenario_mask"]
        scenarios = {row["id"]: row for row in graph["scenarios"]}
        for edge in masks:
            scenario = scenarios[edge["scenario_id"]]
            if (edge["collection_id"], edge["source_id"]) != mask_pair(
                    scenario, scenario["patches"][edge["patch_index"]]):
                raise AssertionError("Lineage changed the native ordered mask selection")
        if require_multiple_collections and len({row["collection_id"] for row in masks}) < 2:
            raise ValueError("Select an actual run with masks from at least two original collections")
        if require_companions and not any(row["companions"] for row in graph["sources"]):
            raise ValueError("Select actual source data with declared companions")
        checked = []
        for source in graph["sources"]:
            value = feature.read(key, "lineage-source", {
                **selection, "lineage_sha256": graph["lineage_sha256"],
                "collection_id": source["collection_id"], "source_id": source["id"]})
            if not value["verified"] or value["source"]["key"] != source["key"]:
                raise AssertionError("Original source detail differs from selected lineage")
            for file in value["source"]["files"]:
                ticket = file["download"]
                stream, retained = operator.open_download(ticket["id"])
                h, count = hashlib.sha256(), 0
                try:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        h.update(block)
                        count += len(block)
                finally:
                    stream.close()
                if count != file["bytes"] or h.hexdigest() != file["sha256"]:
                    raise AssertionError("Original source/companion download changed")
                checked.append({"source_key": source["key"], "ref": file["ref"],
                                "member": file["member"], "bytes": count, "sha256": h.hexdigest()})
        for item in graph["prepared_files"]:
            value = feature.read(key, "lineage-file", {
                **selection, "lineage_sha256": graph["lineage_sha256"],
                "dataset_id": item["ref"]["id"]})
            if not value["verified"] or value["file"]["sha256"] != item["sha256"]:
                raise AssertionError("Prepared input verification changed its original descriptor")
    finally:
        operator.close()
    # Invoke the actual maintained original collection continuation. It performs
    # queued export, streamed ZIP download, independent catalog receive, complete
    # companion checking/reexport, original Operator restart and exact task replay.
    path = application / "receiving/eco_intelligence/receive_original_collection.py"
    spec = importlib.util.spec_from_file_location("original_collection_receiving", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    collection = module.run(application, workspace, state, graph["original_refs"],
                            timeout, require_companions)
    operator = Operator(workspace, state)
    try:
        feature = IntelligenceFeature(operator, Fault)
        reopened = feature.read(operator.primary, "lineage", {
            **selection, "lineage_sha256": graph["lineage_sha256"]})
        if reopened != graph:
            raise AssertionError("Cold original lineage differs from the selected complete source")
    finally:
        operator.close()
    for name, item in sources.items():
        if (application / name).stat().st_size != item["bytes"] or sha(application / name) != item["sha256"]:
            raise AssertionError("The selected application changed during receiving")
    result = {"schema": request["schema"], "state": "COMPLETE",
              "operation": request["operation"], "project_id": graph["project"]["id"],
              "workspace_key": graph["workspace_key"], "selection": graph["selected"],
              "lineage_sha256": graph["lineage_sha256"],
              "ordered_mask_pairs": [[edge["collection_id"], edge["source_id"]] for edge in masks],
              "source_members": checked, "original_collection": collection,
              "software": sources, "browser_receiving": "pending actual original operator/browser"}
    immutable(directory / "receiving.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--directory", required=True, type=Path)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--run")
    choice.add_argument("--grid")
    parser.add_argument("--require-multiple-collections", action="store_true")
    parser.add_argument("--require-companions", action="store_true")
    parser.add_argument("--timeout", type=float, default=180)
    args = parser.parse_args()
    print(json.dumps(run(args.application, args.workspace, args.directory,
                         run_id=args.run, grid_id=args.grid,
                         require_multiple_collections=args.require_multiple_collections,
                         require_companions=args.require_companions, timeout=args.timeout),
                     ensure_ascii=False, indent=2, allow_nan=False))
