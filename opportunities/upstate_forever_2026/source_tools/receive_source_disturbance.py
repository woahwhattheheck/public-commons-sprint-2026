#!/usr/bin/env python3
"""Receive one existing completed source-selected study through its original Workspace.

No new model execution or source acquisition occurs here. The caller keeps the
existing native owner, operation and browser; output must be outside the source.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
from html import escape
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import zipfile

APPLICATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION))
from model.common import atomic_json, canonical, describe_file, digest, held, identifier, read_json, verify_file
from model.workspace import Workspace
from model.source_disturbance import SourceDisturbanceStudies, verify_all
from model.portable import backup, inspect_archive, restore, resume_restore

SCHEMA = "upstate.source-disturbance-receiving/v1"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def ordinary(path, directory=False):
    path = Path(path).absolute()
    require(path.resolve(strict=True) == path and not path.is_symlink(),
            "Use an original canonical receiving path")
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode),
            "Use an ordinary retained receiving member")
    return path


def inspect_members(workspace, study_id):
    service = SourceDisturbanceStudies(workspace)
    study = service.inspect(study_id)
    require(study["state"] == "complete", "Create the completed original report before receiving")
    report = study["report"]
    root = workspace.root / "source-disturbance-studies" / study_id / "report"
    opened = []
    import rasterio
    import fiona
    from model import rasters
    for name, descriptor in report["files"].items():
        path = verify_file(root, descriptor)
        suffix = path.suffix.lower()
        details = {}
        if suffix == ".json":
            body = read_json(path)
            details = {"kind": "JSON", "schema": body.get("schema") if isinstance(body, dict) else None}
        elif suffix == ".csv":
            with path.open(encoding="utf-8-sig", newline="") as file:
                rows = csv.reader(file)
                headers = next(rows, [])
                count = sum(1 for _ in rows)
            details = {"kind": "CSV", "columns": headers, "rows": count}
        elif suffix in (".tif", ".tiff"):
            with rasterio.open(path) as raster:
                require(raster.count >= 1 and raster.width > 0 and raster.height > 0, "Native raster is empty")
                # Open every retained native band through its actual reader.
                blocks = 0
                for band in range(1, raster.count + 1):
                    for _, window in raster.block_windows(band):
                        raster.read(band, window=window, masked=True)
                        blocks += 1
                details = {"kind": "native raster", "width": raster.width, "height": raster.height,
                           "bands": raster.count, "crs": str(raster.crs), "native_blocks_opened": blocks}
        elif suffix == ".gpkg":
            layers = []
            with rasters.vector_environment():
                for layer in fiona.listlayers(path):
                    with fiona.open(path, layer=layer) as source:
                        count = sum(1 for _ in source)
                        layers.append({"name": layer, "features": count, "crs": source.crs_wkt})
            details = {"kind": "native GeoPackage", "layers": layers}
        elif suffix == ".png":
            from PIL import Image
            with Image.open(path) as image:
                image.load()
                details = {"kind": "PNG", "size": list(image.size)}
        elif suffix == ".html":
            html = path.read_text(encoding="utf-8")
            require("TokenJunkie Labs" in html and escape(study["title"]) in html, "Open the complete maintained report HTML")
            details = {"kind": "HTML source", "rendered": False}
        elif suffix == ".zip":
            manifest = read_json(root / "manifest.json")
            expected = {row["path"]: row for row in manifest["files"].values()}
            expected["manifest.json"] = describe_file(root, root / "manifest.json")
            with zipfile.ZipFile(path) as archive:
                names = archive.namelist()
                require(len(names) == len(set(names)) and set(names) == set(expected),
                        "Retained report ZIP does not contain its exact full member inventory")
                for member, wanted in expected.items():
                    h, size = hashlib.sha256(), 0
                    with archive.open(member) as stream:
                        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                            h.update(chunk); size += len(chunk)
                    require(size == wanted["bytes"] and h.hexdigest() == wanted["sha256"],
                            "Original report ZIP member changed: " + member)
            details = {"kind": "complete original report ZIP", "members": len(expected)}
        else:
            details = {"kind": "unchanged original source", "sha256_verified": True}
        opened.append({"role": name, "descriptor": descriptor, **details})
    return {"study_id": study_id, "project_id": workspace.project["id"],
            "plan_sha256": digest(study["plan"]), "result_sha256": report["result_sha256"],
            "report_sha256": digest(report), "cases": [
                {key: row[key] for key in ("case_id", "baseline_run_id", "run_id", "profile_id", "grid_id", "scenario_id", "footprint_id")}
                for row in study["cases"]], "members": opened}


def _child(command, cwd, output):
    """Own one ordinary source-native cold reader and preserve its primary error."""
    child = None
    original = {}
    def stop(signum, frame):
        raise KeyboardInterrupt("Original receiving reader interrupted by signal " + str(signum))
    for signum in (signal.SIGINT, signal.SIGTERM):
        original[signum] = signal.signal(signum, stop)
    primary = None
    try:
        with Path(output).open("xb") as file:
            child = subprocess.Popen(command, cwd=cwd, stdout=file, stderr=subprocess.STDOUT, start_new_session=True)
            code = child.wait()
        require(code == 0, "Original cold reader failed; inspect its retained complete output: " + str(output))
    except BaseException as error:
        primary = error
    finally:
        cleanup = []
        if child is not None and child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            except BaseException as error:
                cleanup.append(error)
        for signum, handler in original.items():
            signal.signal(signum, handler)
        if primary is not None and cleanup:
            raise BaseExceptionGroup("Original cold receiving failed and cleanup also failed", [primary, *cleanup])
        if primary is not None:
            raise primary
        if cleanup:
            raise BaseExceptionGroup("Original cold receiving cleanup failed", cleanup)



def inspect_selected_study(workspace, study_id, transfer_id):
    from model.study_transfer import verify_received_studies
    transfer_id = identifier(transfer_id)
    receipt = read_json(workspace.root / "study-transfers" / (transfer_id + ".json"))
    require(receipt.get("id") == transfer_id, "The received selected Study names another transfer")
    validations = [row for row in verify_received_studies(workspace) if row["id"] == transfer_id]
    require(len(validations) == 1 and validations[0]["identity"] == "MATCH",
            "The original selected Study did not reopen with its full retained dependency closure")
    selected = validations[0].get("source_disturbance_studies", [])
    require(any(row["study_id"] == study_id for row in selected),
            "The selected Study lost its original source-disturbance root")
    return {"report": inspect_members(workspace, study_id), "study": receipt,
            "validation": validations[0]}


def receive_selected_study(workspace, study_id, out, request, original):
    """Receive the actual maintained selected Study beside the whole Workspace."""
    from model.study_transfer import export_study, inspect_transfer_archive, normalise
    study = SourceDisturbanceStudies(workspace).inspect(study_id)
    chosen = normalise({"schema": "upstate.study-selection/v1", "title": study["title"],
                        "roots": [{"kind": "source-disturbance-studies", "id": study_id}],
                        "include_related_results": True})
    expected = {"schema": SCHEMA, "request": request, "selection": chosen,
                "report_sha256": original["report_sha256"]}
    atomic_json(out / "selected-study-intent.json", expected, immutable=True)
    result_file = out / "selected-study-receiving-result.json"
    saved = read_json(result_file) if result_file.exists() else None
    if saved is not None:
        require(canonical(saved["intent"]) == canonical(expected),
                "Resume the same first selected Study receiving generation")
        archive_path = verify_file(out, saved["archive"])
    else:
        archive_path = out / "selected-study.zip"
        if not archive_path.exists():
            export_study(workspace, archive_path, chosen)
        ordinary(archive_path)
    inspected = inspect_transfer_archive(archive_path, verify=True)
    manifest, transfer = inspected["manifest"], inspected["study"]
    require(manifest["project"]["id"] == workspace.project["id"]
            and canonical(transfer["identity"]["selection"]) == canonical(chosen),
            "The retained selected Study archive names another project or root selection")
    member = "workspace/source-disturbance-studies/" + study_id + "/report/report.json"
    expected_report = hashlib.sha256(canonical(study["report"]) + b"\n").hexdigest()
    require(manifest["members"].get(member, {}).get("sha256") == expected_report,
            "The selected Study archive lost the original complete report generation")
    archive = describe_file(out, archive_path)
    if saved is not None:
        require(canonical(archive) == canonical(saved["archive"])
                and canonical(transfer) == canonical(saved["transfer"]),
                "The first completed selected Study archive changed")
    target = out / "selected-received"
    received = (resume_restore(archive_path, target, expected_archive_sha256=archive["sha256"])
                if target.exists() else restore(archive_path, target))
    cold_workspace = Workspace(received["workspace"])
    cold = inspect_selected_study(cold_workspace, study_id, transfer["id"])
    require(canonical(cold["report"]) == canonical(original)
            and canonical(cold["study"]) == canonical(transfer),
            "The selected Study cold receiver changed original report, sources, runs or transfer lineage")
    # Replay the original report operation in this selected receiving copy.
    report = SourceDisturbanceStudies(cold_workspace).report(
        study_id, operation_id=request["operation_id"] + ":report")
    require(canonical(report) == canonical(study["report"]),
            "The selected Study did not preserve the original accepted report request")
    cold_result_file = out / "selected-cold-application-result.json"
    if not cold_result_file.exists():
        attempt = 0
        while (out / ("selected-cold-application-attempt-" + str(attempt) + ".log")).exists():
            attempt += 1
        helper = Path(received["application"]) / "source_tools/receive_source_disturbance.py"
        _child([sys.executable, str(helper), "--inspect-received", "--workspace", received["workspace"],
                "--study-id", study_id, "--study-transfer-id", transfer["id"],
                "--output", str(cold_result_file)], received["application"],
               out / ("selected-cold-application-attempt-" + str(attempt) + ".log"))
    require(canonical(read_json(cold_result_file)) == canonical(cold),
            "The actual copied application reopened another selected Study generation")
    result = {"schema": SCHEMA, "intent": expected, "archive": archive, "transfer": transfer,
              "cold": cold, "receiver": {key: received[key] for key in
                   ("directory", "application", "workspace", "archive_sha256")}}
    if saved is not None:
        require(canonical(result) == canonical(saved),
                "Original selected Study receiving receipt changed after reopening")
        return saved
    atomic_json(result_file, result, immutable=True)
    return result


def receive(args):
    source = ordinary(args.workspace, directory=True)
    workspace = Workspace(source)
    study_id = identifier(args.study_id)
    out = Path(args.output).absolute()
    require(not out.is_relative_to(source) and not out.is_relative_to(APPLICATION),
            "Receive outside both the original scientific workspace and application source")
    out.mkdir(parents=True, exist_ok=True)
    ordinary(out, directory=True)
    service = SourceDisturbanceStudies(workspace)
    # The original operation is a stable named receiving/report request, not a new run.
    request = {"schema": SCHEMA, "project_id": workspace.project["id"],
               "workspace": str(source), "study_id": study_id, "operation_id": args.operation_id}
    with held(out / ".source-disturbance-receiving.lock", blocking=False):
        intent = out / "receiving-intent.json"
        if intent.exists():
            require(canonical(read_json(intent)) == canonical(request), "Resume the same complete original receiving request")
        else:
            atomic_json(intent, request, immutable=True)
        result_file = out / "receiving-result.json"
        if result_file.exists():
            original = read_json(result_file)
            require(canonical(original["request"]) == canonical(request), "Original receiving result names another operation")
            verify_file(out, original["archive"])
            current = inspect_members(workspace, study_id)
            require(canonical(current) == canonical(original["original"]), "Original retained report or source changed")
            received = resume_restore(out / original["archive"]["path"], out / "received",
                                      expected_archive_sha256=original["archive"]["sha256"])
            cold = inspect_members(Workspace(received["workspace"]), study_id)
            require(canonical(cold) == canonical(original["cold"]), "Original received report or source changed")
            selected = receive_selected_study(workspace, study_id, out, request, current)
            require(canonical(selected) == canonical(original["selected_study"]),
                    "Original selected Study receiving generation changed")
            return original
        record = service.inspect(study_id)
        require(record["cases"] and all(row["state"] == "complete" for row in record["cases"]),
                "Use the original completed cases; this receiver never starts a model")
        result = service.report(study_id, operation_id=args.operation_id + ":report")
        replay = service.report(study_id, operation_id=args.operation_id + ":report")
        require(canonical(result) == canonical(replay), "Original report operation did not replay exactly")
        original = inspect_members(workspace, study_id)
        archive_path = out / "scientific-workspace.zip"
        archive_receipt = out / "archive-receipt.json"
        if archive_path.exists():
            manifest = inspect_archive(archive_path, verify=True)
            require(manifest["project"]["id"] == workspace.project["id"], "The retained archive belongs to another project")
            expected = manifest["members"].get("workspace/source-disturbance-studies/" + study_id + "/report/report.json")
            require(expected is not None and expected["sha256"] == hashlib.sha256(canonical(result) + b"\n").hexdigest(),
                    "The existing complete archive does not contain the original accepted report")
            archive = describe_file(out, archive_path)
        else:
            backup(workspace, archive_path, include_intermediates=True)
            archive = describe_file(out, archive_path)
        atomic_json(archive_receipt, archive, immutable=True)
        received = (resume_restore(archive_path, out / "received", expected_archive_sha256=archive["sha256"])
                    if (out / "received").exists() else restore(archive_path, out / "received"))
        cold_workspace = Workspace(received["workspace"])
        cold = inspect_members(cold_workspace, study_id)
        require(canonical(original) == canonical(cold), "Cold receiving changed the original case, source or report")
        cold_result = SourceDisturbanceStudies(cold_workspace).report(study_id, operation_id=args.operation_id + ":report")
        require(canonical(cold_result) == canonical(result), "Cold receiving did not replay the original report request")
        # The copied application's actual module imports validate its own closure.
        cold_result_file = out / "cold-application-result.json"
        if not cold_result_file.exists():
            attempt = 0
            while (out / ("cold-application-attempt-" + str(attempt) + ".log")).exists():
                attempt += 1
            helper = Path(received["application"]) / "source_tools/receive_source_disturbance.py"
            _child([sys.executable, str(helper), "--inspect-received", "--workspace", received["workspace"],
                    "--study-id", study_id, "--output", str(cold_result_file)], received["application"],
                   out / ("cold-application-attempt-" + str(attempt) + ".log"))
        require(canonical(read_json(cold_result_file)) == canonical(original),
                "Original copied application opened a different report generation")
        all_state = verify_all(cold_workspace)
        selected = receive_selected_study(workspace, study_id, out, request, original)
        completed = {"schema": SCHEMA, "state": "OPERATED_AWAITING_LITERAL_INSPECTION",
                     "request": request, "archive": archive, "original": original, "cold": cold,
                     "receiver": {key: received[key] for key in ("directory", "application", "workspace", "archive_sha256")},
                     "cold_validation": all_state, "selected_study": selected,
                     "literal_inspection": {
                         "required": True,
                         "instruction": "Use the same existing browser owner to open the original and received study at desktop and 390 px. Personally view the readable HTML, every retained PNG, GIS mask/native export and complete archive; operate downloads, original replay and full editable Study/project receiving. Record actual observations separately.",
                         "report": str(Path(received["workspace"]) / "source-disturbance-studies" / study_id / "report/report.html"),
                         "source_unchanged": True}}
        atomic_json(result_file, completed, immutable=True)
        return completed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--study-id", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--operation-id")
    parser.add_argument("--inspect-received", action="store_true")
    parser.add_argument("--study-transfer-id")
    args = parser.parse_args(argv)
    if args.inspect_received:
        workspace = Workspace(ordinary(args.workspace, directory=True))
        result = (inspect_selected_study(workspace, identifier(args.study_id), args.study_transfer_id)
                  if args.study_transfer_id else inspect_members(workspace, identifier(args.study_id)))
        atomic_json(args.output, result, immutable=True)
    else:
        require(isinstance(args.operation_id, str) and args.operation_id.strip() and len(args.operation_id) <= 150,
                "Retain the original receiving operation ID")
        result = receive(args)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
