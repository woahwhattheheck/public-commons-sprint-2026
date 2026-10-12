#!/usr/bin/env python3
"""Run the complete native vector journey on original selected files and source hashes."""
from __future__ import annotations
import argparse
import importlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
import traceback
import types

HERE = Path(__file__).resolve().parents[1]
PACKAGE = "_starforge_vector_journey"
spec = importlib.util.spec_from_file_location(PACKAGE, HERE / "__init__.py",
    submodule_search_locations=[str(HERE)])
api = importlib.util.module_from_spec(spec)
sys.modules[PACKAGE] = api
spec.loader.exec_module(api)
common = importlib.import_module(PACKAGE + ".common")
materialize = importlib.import_module(PACKAGE + ".materialize")

def source_inventory():
    return [common.file_record(path, path.relative_to(HERE).as_posix())
            for path in sorted(HERE.rglob("*.py")) if "__pycache__" not in path.parts]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--profile")
    parser.add_argument("--successor-selection")
    parser.add_argument("--successor-source-root")
    parser.add_argument("--qgis-source", help="Exact maintained QGIS package containing vector_source.py and model.py")
    parser.add_argument("--qgis-reader-sha256")
    args = parser.parse_args()
    os.environ["PROJ_NETWORK"] = "OFF"
    root = common.private_directory(args.out)
    selection = common.read_json(args.selection)
    profile = common.read_json(args.profile) if args.profile else {
        "schema": "starforge.vector-export-profile.v1",
        "formats": ["GPKG", "ESRI Shapefile"], "layers": {},
        "shapefile": {"longValues": "reference", "collections": "split"}}
    common.need(set(profile.get("formats", [])) == {"GPKG", "ESRI Shapefile"},
                "JOURNEY_REQUIRES_BOTH_NATIVE_FORMATS")
    source = common.file_record(args.selection)
    identity = {"schema": "starforge.vector-journey-request.v1",
                "selectionSha256": source["sha256"], "profile": profile,
                "sourceRoot": str(Path(args.source_root).resolve())}
    original_request = root / "journey-request.json"
    if original_request.exists():
        common.need(common.read_json(original_request) == identity, "JOURNEY_ORIGINAL_REQUEST_CONFLICT")
    else:
        common.atomic_json(original_request, identity)
    result = {"schema": "starforge.vector-native-journey.v1", "ok": False,
              "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "sourceSelection": source, "sourceCode": source_inventory(),
              "directory": str(root), "steps": []}
    phase = None
    def save():
        common.atomic_json(root / "native-result.json", result)
    def step(name, fn):
        nonlocal phase
        phase = name
        value = fn()
        result["steps"].append({"name": name, "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "result": value})
        save()
        return value
    try:
        result["engine"] = step("native-runtime", api.capabilities)
        captured = step("capture-original-selection", lambda:
            api.capture_selection(selection, args.source_root, root / "capture"))
        inspected = step("inspect-all-original-layers", lambda: api.open_capture(root / "capture",
            captured["manifestFile"]["sha256"]))
        exported_directory = root / "native-export"
        class ResponseBoundary(Exception): pass
        actual_atomic = materialize.atomic_json
        def interrupt_before_response(path, value):
            if Path(path) == exported_directory / "vector-export.json":
                raise ResponseBoundary("Native files are committed; original export manifest response is interrupted.")
            return actual_atomic(path, value)
        phase = "native-export-interrupted-publication"
        if not (exported_directory / "vector-export.json").exists():
            materialize.atomic_json = interrupt_before_response
            try:
                api.export_capture(root / "capture", exported_directory, profile, "original-native-export")
                raise AssertionError("The original manifest publication boundary did not occur.")
            except ResponseBoundary:
                common.need((exported_directory / "native" / "complete.json").is_file(),
                            "JOURNEY_NATIVE_CHECKPOINT_REQUIRED")
            finally:
                materialize.atomic_json = actual_atomic
        before_files = common.all_files(exported_directory / "native")
        exported = step("resume-original-native-publication", lambda:
            api.export_capture(root / "capture", exported_directory, profile, "original-native-export"))
        common.need(before_files == common.all_files(exported_directory / "native"),
                    "JOURNEY_REPLAY_REWROTE_NATIVE_FILES")
        result["originalNativeFilesReused"] = True
        opened = step("reopen-every-native-feature", lambda: api.open_vector_export(
            exported_directory, exported["manifestFile"]["sha256"]))
        packed = step("complete-native-zip", lambda:
            api.create_bundle(exported_directory, root / "vector-delivery.zip",
                              exported["manifestFile"]["sha256"]))
        received = step("receive-complete-zip-and-reopen", lambda:
            api.receive_bundle(root / "vector-delivery.zip", root / "received",
                packed["file"]["sha256"], exported["manifestFile"]["sha256"]))
        common.need(received["manifestFile"] == exported["manifestFile"], "JOURNEY_RECEIVED_MANIFEST_CHANGED")
        comparison = step("compare-original-with-received-source", lambda:
            api.compare_captures(root / "capture", root / "received", root / "comparison", "original-receiving-comparison"))
        counts = comparison["manifest"]["counts"]
        common.need(counts["added"] == counts["removed"] == counts["changed"] == 0 and
                    counts["unchanged"] == inspected["inspection"]["counts"]["features"],
                    "JOURNEY_RECEIVED_SOURCE_CHANGED")
        step("page-complete-source-comparison", lambda: api.comparison_page(root / "comparison", limit=100))
        comparison_zip = step("complete-comparison-zip", lambda:
            api.create_bundle(root / "comparison", root / "comparison-delivery.zip",
                              comparison["manifestFile"]["sha256"]))
        step("receive-complete-comparison", lambda: api.receive_bundle(
            root / "comparison-delivery.zip", root / "received-comparison",
            comparison_zip["file"]["sha256"], comparison["manifestFile"]["sha256"]))
        replayed = step("repeat-original-export-request", lambda:
            api.export_capture(root / "capture", exported_directory, profile, "original-native-export"))
        common.need(replayed["replayed"] is True and replayed["manifestFile"] == exported["manifestFile"],
                    "JOURNEY_ORIGINAL_REQUEST_CHANGED")
        if args.successor_selection:
            common.need(args.successor_source_root, "JOURNEY_SUCCESSOR_SOURCE_ROOT_REQUIRED")
            successor_selection = common.read_json(args.successor_selection)
            successor = step("capture-original-successor-selection", lambda:
                api.capture_selection(successor_selection, args.successor_source_root, root / "successor-capture"))
            changed = step("compare-original-successor-edition", lambda:
                api.compare_captures(root / "capture", root / "successor-capture",
                    root / "successor-comparison", "original-successor-comparison"))
            step("page-original-successor-changes", lambda:
                api.comparison_page(root / "successor-comparison", limit=100))
            result["successorCounts"] = changed["manifest"]["counts"]
        if args.qgis_source:
            qgis_root = Path(args.qgis_source).resolve()
            reader_file = common.file_record(qgis_root / "vector_source.py")
            common.need(args.qgis_reader_sha256 is None or reader_file["sha256"] == args.qgis_reader_sha256,
                        "JOURNEY_QGIS_READER_CHANGED")
            package = types.ModuleType("_starforge_original_qgis_receiving")
            package.__path__ = [str(qgis_root)]
            sys.modules[package.__name__] = package
            reader = importlib.import_module(package.__name__ + ".vector_source")
            def qgis_adoption():
                native = reader.VectorReceivingSource(root / "received", exported["manifestFile"]["sha256"])
                inventory = native.native_inventory()
                common.need(len(inventory["layers"]) == len(exported["manifest"]["native"]["layers"]),
                            "JOURNEY_QGIS_LAYER_INVENTORY_CHANGED")
                for layer in inventory["layers"]:
                    native.path(layer["file"]["path"], verify=True)
                    native.layer_definition(layer["sourceId"], layer["sourceLayerId"], layer["layerId"])
                return {"sourceReader": reader_file, "sourceModel": common.file_record(qgis_root / "model.py"),
                        "sourceId": native.id, "sourceKind": native.sourceKind,
                        "selectionId": selection["id"], "inventory": inventory}
            step("maintained-qgis-source-receiving", qgis_adoption)
        result.update(ok=True, completedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            sourceFeatures=inspected["inspection"]["counts"]["features"],
            nativeFeatures=opened["receiving"]["nativeFeatures"],
            nativeLayers=len(opened["receiving"]["layers"]),
            exportManifest=exported["manifestFile"],
            receivingManifest=received["manifestFile"],
            package=packed["file"], comparison=comparison["manifestFile"])
        save()
        print(common.canonical({"ok": True, "resultFile": str(root / "native-result.json"),
            "sourceFeatures": result["sourceFeatures"], "nativeFeatures": result["nativeFeatures"],
            "nativeLayers": result["nativeLayers"], "package": packed["file"],
            "exportManifest": exported["manifestFile"]}))
        return 0
    except Exception as exc:
        result.update(failedPhase=phase, error={"code": getattr(exc, "code", type(exc).__name__),
            "detail": getattr(exc, "detail", str(exc))}, traceback=traceback.format_exc())
        save()
        print(common.canonical({"ok": False, "resultFile": str(root / "native-result.json"),
            "phase": phase, "error": result["error"]}))
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
