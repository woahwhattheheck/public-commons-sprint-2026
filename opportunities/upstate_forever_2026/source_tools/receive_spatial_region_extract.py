"""Receive an original saved Area's native-grid editable GIS package.

Uses the maintained SpatialRegions and GIS APIs. No model is executed.
Run from an installed original application, with its scientific Python runtime.
"""
from __future__ import annotations
import argparse
import csv
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import traceback

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
from model.common import atomic_bytes, atomic_json, describe_file, digest, file_digest, read_json, verify_file, _sync_directory
from model.workspace import Workspace
from model.spatial_regions import SpatialRegions
from model.spatial_region_extract import RegionExtracts, producers
from model import gis_project as gis

SCHEMA = "upstate.spatial-region-extraction-receiving/v1"


def _receipt(path, value):
    atomic_json(path, value, immutable=path.exists())


def _documents(directory):
    """Open every original table/document attachment with its declared parser."""
    manifest = gis.load(directory / "project.json")
    observations = []
    descriptors = [descriptor for item in manifest.get("attachments", [])
                   for descriptor in item["files"]]
    for descriptor in descriptors:
        path = gis.checked(directory, descriptor)
        suffix = path.suffix.lower()
        if suffix == ".json":
            with path.open(encoding="utf-8") as stream:
                json.load(stream, parse_constant=lambda text: (_ for _ in ()).throw(ValueError(text)))
            opened = "JSON"
        elif suffix == ".csv":
            with path.open(encoding="utf-8", newline="") as stream:
                list(csv.reader(stream))
            opened = "CSV"
        else:
            path.read_text(encoding="utf-8")
            opened = "UTF-8 original document"
        observations.append({"path": descriptor["path"], "sha256": descriptor["sha256"],
                             "opened_as": opened})
    return observations


def cold_check(workspace, output, analysis_id, extraction_id):
    ws = Workspace(workspace)
    analysis = SpatialRegions(ws).inspect(analysis_id)
    extraction = RegionExtracts(ws).inspect(extraction_id)
    if extraction["analysis_id"] != analysis["id"] or extraction["identity"]["analysis_sha256"] != digest(analysis):
        raise ValueError("Cold receiving selected another saved Area")
    original = ws.root / "spatial-region-extractions" / extraction_id
    received = output / "received-gis"
    result = gis.verify(received)
    if result["selection_id"] != extraction["gis"]["selection_id"]:
        raise ValueError("Cold GIS receiver changed the original selection")
    if gis.load(received / "project.json")["source_request"] != gis.load(original / "gis-project" / "project.json")["source_request"]:
        raise ValueError("Cold GIS source selection changed")
    return {"schema": SCHEMA, "project_id": ws.project["id"], "analysis_id": analysis_id,
            "extraction_id": extraction_id, "original_record_sha256": extraction["record_sha256"],
            "gis": result, "opened_attachments": _documents(received),
            "python": sys.version, "fresh_process": True,
            "source": {name: {"path": str(APP / name), **identity} for name, identity in producers().items()}}


def run(args):
    ws = Workspace(args.workspace)
    regions = SpatialRegions(ws)
    if args.catalog_only:
        return {"project": ws.project, "areas": regions.catalog(),
                "meaning": "Actual saved Area IDs only; project and paired-review IDs are not Area IDs."}
    output = Path(args.output).resolve()
    if output == ws.root or output.is_relative_to(ws.root) or ws.root.is_relative_to(output):
        raise ValueError("Choose a receiving output directory outside the original Workspace")
    output.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    try:
        request, request_bytes, source_request = None, None, None
        if args.area_request:
            import hashlib
            request_path = Path(args.area_request).resolve(strict=True)
            request_bytes = request_path.read_bytes()
            request = json.loads(request_bytes, parse_constant=lambda text: (_ for _ in ()).throw(ValueError(text)))
            source_request = {"sha256": hashlib.sha256(request_bytes).hexdigest(), "bytes": len(request_bytes)}
        elif not args.analysis_id:
            raise ValueError("Select an actual saved --analysis-id, or explicitly supply --area-request. Use --catalog-only to list real Areas.")
        admission = {"analysis_id": args.analysis_id, "request_file": source_request,
                     "title": args.title, "notes": args.notes, "project_id": ws.project["id"],
                     "implementation": producers(), "receiver_sha256": file_digest(Path(__file__))}
        admission_path = output / "request.json"
        if admission_path.exists() and read_json(admission_path) != admission:
            raise ValueError("This receiving request already names another original selection or source edition; choose a new directory")
        _receipt(admission_path, admission)
        if request_bytes is not None:
            atomic_bytes(output / "authored-area-request.json", request_bytes, immutable=True)
            # Explicit authored input uses the original source/geometry validator.
            analysis = regions.analyze(request)
        else:
            analysis = regions.inspect(args.analysis_id)
        selection = {"schema": SCHEMA, "project_id": ws.project["id"],
                     "analysis_id": analysis["id"], "analysis_sha256": digest(analysis),
                     "request_file": source_request, "extract": {"analysis_id": analysis["id"]},
                     "implementation": producers(),
                     "receiver_sha256": file_digest(Path(__file__))}
        if args.title is not None:
            selection["extract"]["title"] = args.title
        if args.notes is not None:
            selection["extract"]["notes"] = args.notes
        retained = output / "selection.json"
        if retained.exists() and read_json(retained) != selection:
            raise ValueError("This receiving directory retains another original selection or source edition; choose a new directory")
        _receipt(retained, selection)
        _receipt(output / "original-area.json", analysis)
        extracts = RegionExtracts(ws)
        value = extracts.export(selection["extract"],
            progress=lambda item: atomic_json(output / "progress.json", item))
        replay = extracts.export(selection["extract"])
        if replay.get("reused") is not True or replay["id"] != value["id"]:
            raise ValueError("The original extraction did not replay as the same immutable edition")
        before = extracts.inspect(value["id"])
        _receipt(output / "extraction.json", before)
        original = ws.root / "spatial-region-extractions" / value["id"]
        archive = verify_file(original, value["files"]["editable_gis"])
        target_archive = output / "editable-area-gis.zip"
        expected_archive = value["files"]["editable_gis"]
        def check_archive(path):
            if (path.is_symlink() or not path.is_file()
                    or path.stat().st_size != expected_archive["bytes"]
                    or file_digest(path) != expected_archive["sha256"]):
                raise ValueError("The retained receiving archive differs; preserve it for review")
        if target_archive.exists():
            check_archive(target_archive)
        else:
            pending = None
            try:
                with tempfile.NamedTemporaryFile(prefix=".area-gis-", suffix=".part",
                                                 dir=output, delete=False) as stream:
                    pending = Path(stream.name)
                    with archive.open("rb") as source:
                        shutil.copyfileobj(source, stream, 1024 * 1024)
                    stream.flush()
                    os.fsync(stream.fileno())
                check_archive(pending)
                try:
                    os.link(pending, target_archive)
                except FileExistsError:
                    check_archive(target_archive)
                _sync_directory(output)
            finally:
                if pending is not None:
                    pending.unlink(missing_ok=True)
        received = output / "received-gis"
        if received.exists():
            observed = gis.verify(received)
            if observed["selection_id"] != value["gis"]["selection_id"]:
                raise ValueError("The receiving directory contains another GIS selection")
        else:
            gis.receive(target_archive, received)
        command = [sys.executable, "-I", "-B", str(Path(__file__).resolve()),
                   "--workspace", str(ws.root), "--output", str(output),
                   "--analysis-id", analysis["id"], "--cold-check", value["id"]]
        completed = subprocess.run(command, capture_output=True, text=True)
        atomic_json(output / "cold-process.json", {"command": command, "returncode": completed.returncode,
                    "stdout": completed.stdout, "stderr": completed.stderr})
        if completed.returncode:
            raise RuntimeError("Fresh original application receiving failed; see cold-process.json")
        cold = json.loads(completed.stdout)
        if not cold.get("fresh_process") or cold["original_record_sha256"] != value["record_sha256"]:
            raise ValueError("Cold result does not retain this original extraction")
        _receipt(output / "cold-readback.json", cold)
        native = {"status": "not executed", "instruction": "Use the retained QGIS receiver on an equipped host, then LOOK at its actual rendering."}
        if args.qgis_python:
            destination = output / "qgis-received"
            native_receipt = output / "qgis-process.json"
            if destination.exists():
                if not native_receipt.exists():
                    raise ValueError("QGIS receiving is incomplete; retain this directory and choose a new receiving output for another attempt")
                native = read_json(native_receipt)
                if native.get("returncode") != 0:
                    raise ValueError("The retained QGIS attempt failed; inspect its original error")
                gis.verify(destination, native=False)
            else:
                qgis_command = [str(Path(args.qgis_python).resolve(strict=True)),
                    str(received / "tools/model/gis_project_native.py"), str(received), str(destination)]
                process = subprocess.run(qgis_command, capture_output=True, text=True,
                    env={**os.environ, "QT_QPA_PLATFORM": "offscreen"})
                native = {"command": qgis_command, "returncode": process.returncode,
                          "stdout": process.stdout, "stderr": process.stderr}
                _receipt(native_receipt, native)
                if process.returncode:
                    raise RuntimeError("Original QGIS opening/render/save/reopen failed; see qgis-process.json")
        if extracts.inspect(value["id"]) != before:
            raise ValueError("The original saved extraction changed during receiving")
        result = {"schema": SCHEMA, "project_id": ws.project["id"],
                  "analysis_id": analysis["id"], "extraction_id": value["id"],
                  "source_unchanged": True, "original_request_reused": True,
                  "cold_readback": cold, "qgis": native,
                  "archive": describe_file(output, target_archive),
                  "browser_receiving": "Run receive_spatial_region_extract_browser.mjs against the authorized original Operator URL and LOOK at all returned images and downloaded attachments.",
                  "visual_acceptance": "pending producing owner inspection",
                  "elapsed_seconds": round(time.monotonic() - started, 6)}
        atomic_json(output / "result.json", result)
        return result
    except BaseException as error:
        try:
            atomic_json(output / "failure.json", {"schema": SCHEMA,
                "error_type": type(error).__name__, "message": str(error),
                "traceback": traceback.format_exc(), "elapsed_seconds": round(time.monotonic() - started, 6)})
        except BaseException:
            pass
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output")
    selected = parser.add_mutually_exclusive_group()
    selected.add_argument("--analysis-id")
    selected.add_argument("--area-request")
    parser.add_argument("--title")
    parser.add_argument("--notes")
    parser.add_argument("--catalog-only", action="store_true")
    parser.add_argument("--qgis-python")
    parser.add_argument("--cold-check", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not args.catalog_only and not args.output:
        parser.error("--output is required for receiving")
    if args.cold_check:
        result = cold_check(args.workspace, Path(args.output).resolve(), args.analysis_id, args.cold_check)
    else:
        result = run(args)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
