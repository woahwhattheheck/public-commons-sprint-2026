#!/usr/bin/env python3
"""Open a completed structural report and cold-receive its full editable Workspace."""
from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import io
import json
import os
import shutil
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import zipfile

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))
from model.common import atomic_json, digest, file_digest, held, now, read_json, verify_file
from model.structural_studies import StructuralStudies
from model import portable, structural_report
from model.workspace import Workspace
from model.verified_files import verified_operation

SCHEMA = "upstate.structural-study-receiving/v1"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def ordinary(path):
    path = Path(path)
    require(not path.is_symlink() and stat.S_ISREG(path.lstat().st_mode),
            "Use the retained ordinary file: " + str(path))
    return path


def selected(workspace, study_id, report_operation_id):
    service = StructuralStudies(workspace)
    study = service.inspect(study_id)
    operation = service.operation(report_operation_id)
    require(operation.get("status") == "COMPLETE" and operation.get("action") == "structural-study.report"
            and operation.get("study_id") == study_id and operation.get("request") == {"study_id": study_id},
            "Receive the original completed structural report operation")
    report = structural_report.read(workspace, study_id)
    require(digest(operation["result"]) == digest(report),
            "The original report operation and retained report differ")
    require(study["state"] == "complete", "Retain the completed original native study")
    return study, operation, report


def cold_command(application, workspace, command):
    entry = ordinary(application / "model" / "cli.py")
    completed = subprocess.run([sys.executable, str(entry), "--workspace", str(workspace), *command],
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               check=False, cwd=application)
    if completed.returncode:
        raise RuntimeError("Received application " + command[0] + " failed: "
                           + completed.stderr.decode("utf-8", errors="replace"))
    try:
        return json.loads(completed.stdout)
    except (ValueError, UnicodeError) as error:
        raise ValueError("Received application did not return complete native JSON") from error


def inspect_received(receiver, request, render_output):
    application, workspace_path = Path(receiver["application"]), Path(receiver["workspace"])
    study = cold_command(application, workspace_path, ["structural-study-inspect", request["study_id"]])
    operation = cold_command(application, workspace_path, [
        "structural-study-operation", request["report_operation_id"]])
    require(study["project_id"] == request["project_id"] and study["id"] == request["study_id"]
            and digest(study["plan"]) == request["plan_digest"],
            "Cold receiving changed the original structural plan")
    require(operation.get("status") == "COMPLETE" and operation.get("action") == "structural-study.report"
            and operation.get("request") == {"study_id": request["study_id"]}
            and digest(operation["result"]) == request["report_sha256"],
            "Cold receiving changed the original completed report operation")
    report = operation["result"]
    require(report["result_sha256"] == request["result_sha256"],
            "Cold receiving changed the original structural comparison")
    # Invoke the actual received application to inspect its own complete files.
    script = ordinary(application / "operator" / "structural_study_receiving.py")
    completed = subprocess.run([
        sys.executable, str(script), "--workspace", str(workspace_path), "--study-id", request["study_id"],
        "--report-operation-id", request["report_operation_id"], "--inspect-attachments",
        "--render-output", str(render_output)],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        check=False, cwd=application)
    if completed.returncode:
        raise RuntimeError("Received application's attachment opening failed: "
                           + completed.stderr.decode("utf-8", errors="replace"))
    attachments = json.loads(completed.stdout)
    require(attachments["project_id"] == request["project_id"]
            and attachments["study_id"] == request["study_id"]
            and attachments["report_sha256"] == request["report_sha256"],
            "Received attachment inspection belongs to another original report")
    return {"project_id": request["project_id"], "study_id": study["id"],
            "report_operation_id": request["report_operation_id"],
            "plan_digest": digest(study["plan"]), "result_sha256": report["result_sha256"],
            "report_sha256": digest(report), "report_id": report["id"], "files": report["files"],
            "cases": [{"id": row["id"], "run_id": row["run_id"], "grid_id": row["grid_id"],
                       "profile_id": row["profile_id"], "state": row["state"]} for row in study["cases"]],
            "attachments": attachments}


def _poppler_info(path):
    executable = shutil.which("pdfinfo")
    if executable is None:
        raise ImportError("Original PDF page reading requires pypdf, PyMuPDF, or Poppler pdfinfo")
    completed = subprocess.run([executable, str(path)], stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
                               env={**os.environ, "LC_ALL": "C"})
    require(completed.returncode == 0, "Original PDF metadata reader failed: "
            + completed.stderr.decode("utf-8", errors="replace"))
    fields = dict(line.split(":", 1) for line in completed.stdout.decode("utf-8").splitlines() if ":" in line)
    count = int(fields["Pages"].strip())
    require(count > 0, "The original report PDF has no pages")
    return count, {key: value.strip() for key, value in fields.items()}


def _render_pdf(path, output, page_count):
    from PIL import Image
    checksum = file_digest(path)
    directory = Path(output) / checksum
    directory.mkdir(parents=True, exist_ok=True)
    require(directory == directory.resolve(), "Keep page rendering in the original ordinary output directory")
    receipt_path = directory / "pages.json"
    with held(directory / ".render.lock", blocking=False):
        if receipt_path.exists():
            result = read_json(ordinary(receipt_path))
            require(result.get("source_sha256") == checksum and len(result.get("pages", [])) == page_count,
                    "Retained PDF page rendering belongs to another original attachment")
            for number, page in enumerate(result["pages"], 1):
                require(page.get("page") == number and page["image"]["path"] == "page-" + str(number).zfill(4) + ".png"
                        and page["image"].get("absolute_path") == str(directory / page["image"]["path"]),
                        "Retained PDF page order or original image path changed")
                verify_file(directory, page["image"])
            return result
        use_fitz = importlib.util.find_spec("fitz") is not None
        executable = None if use_fitz else shutil.which("pdftoppm")
        if not use_fitz and executable is None:
            raise ImportError("Full PDF visual receiving requires PyMuPDF or Poppler pdftoppm; parsing alone is incomplete")
        if use_fitz:
            import fitz
            renderer = {"name": "PyMuPDF", "version": fitz.VersionBind, "dpi": 144}
        else:
            version = subprocess.run([executable, "-v"], stdin=subprocess.DEVNULL,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            require(version.returncode == 0, "Cannot bind the installed original Poppler renderer")
            renderer = {"name": "Poppler pdftoppm", "version":
                        (version.stdout + version.stderr).decode("utf-8", errors="replace").strip(), "dpi": 144}
        binding = {"schema": "upstate.structural-pdf-pages/v1", "source_sha256": checksum,
                   "source_bytes": path.stat().st_size, "page_count": page_count, "renderer": renderer}
        intent_path = directory / "intent.json"
        if intent_path.exists():
            intent = read_json(ordinary(intent_path))
            require(intent.get("binding") == binding,
                    "Resume unfinished PDF page receiving with its original renderer edition")
        else:
            intent = {"binding": binding, "created_at": now()}
            atomic_json(intent_path, intent, immutable=True)
        pages = []
        document = fitz.open(path) if use_fitz else None
        try:
            if document is not None:
                require(document.page_count == page_count, "Original PDF readers disagree on page count")
            for number in range(1, page_count + 1):
                name = "page-" + str(number).zfill(4)
                page_receipt = directory / (name + ".json")
                if page_receipt.exists():
                    page = read_json(ordinary(page_receipt))
                    require(page.get("page") == number and page["image"]["path"] == name + ".png"
                            and page["image"].get("absolute_path") == str(directory / (name + ".png")),
                            "Retained PDF page order or image path changed")
                    verify_file(directory, page["image"])
                    pages.append(page)
                    continue
                destination = directory / (name + ".png")
                if document is not None:
                    rendered = document[number - 1].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                    from model.common import atomic_bytes
                    atomic_bytes(destination, rendered.tobytes("png"))
                else:
                    pending_prefix = directory / ("." + name + "-render")
                    pending_image = Path(str(pending_prefix) + ".png")
                    pending_image.unlink(missing_ok=True)
                    try:
                        completed = subprocess.run([
                            executable, "-f", str(number), "-l", str(number), "-singlefile",
                            "-r", "144", "-png", str(path), str(pending_prefix)],
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
                            env={**os.environ, "LC_ALL": "C"})
                        require(completed.returncode == 0, "Original PDF page " + str(number)
                                + " rendering failed: " + completed.stderr.decode("utf-8", errors="replace"))
                        ordinary(pending_image)
                        with pending_image.open("rb") as stream:
                            os.fsync(stream.fileno())
                        os.replace(pending_image, destination)
                    finally:
                        pending_image.unlink(missing_ok=True)
                with Image.open(ordinary(destination)) as picture:
                    picture.load()
                    require(picture.format == "PNG" and picture.width > 0 and picture.height > 0,
                            "Original PDF renderer did not produce a complete page image")
                    width, height = picture.width, picture.height
                from model.common import describe_file
                descriptor = describe_file(directory, destination, width=width, height=height,
                                           media_type="image/png", absolute_path=str(destination))
                page = {"page": number, "image": descriptor}
                atomic_json(page_receipt, page, immutable=True)
                pages.append(page)
        finally:
            if document is not None:
                document.close()
        require(file_digest(path) == checksum, "Original PDF changed during page rendering")
        result = {**binding, "state": "complete", "directory": str(directory), "pages": pages,
                  "created_at": intent["created_at"], "completed_at": now(),
                  "visual_receiving": "Open and inspect every exact retained page image in the original browser course"}
        atomic_json(receipt_path, result, immutable=True)
        return result


def _pdf(path, render_output=None):
    if importlib.util.find_spec("pypdf") is not None:
        from pypdf import PdfReader
        with path.open("rb") as stream:
            reader = PdfReader(stream)
            require(len(reader.pages) > 0, "The original report PDF has no pages")
            pages = [{"page": index + 1, "width": float(page.mediabox.width),
                      "height": float(page.mediabox.height), "text_characters": len(page.extract_text() or "")}
                     for index, page in enumerate(reader.pages)]
        result = {"reader": "pypdf", "pages": pages}
    elif importlib.util.find_spec("fitz") is not None:
        import fitz
        with fitz.open(path) as document:
            require(document.page_count > 0, "The original report PDF has no pages")
            pages = [{"page": index + 1, "width": page.rect.width, "height": page.rect.height,
                      "text_characters": len(page.get_text())} for index, page in enumerate(document)]
        result = {"reader": "PyMuPDF", "pages": pages}
    else:
        count, metadata = _poppler_info(path)
        result = {"reader": "Poppler pdfinfo", "metadata": metadata,
                  "pages": [{"page": number} for number in range(1, count + 1)]}
    result["render"] = (_render_pdf(path, render_output, len(result["pages"])) if render_output is not None
                        else {"state": "not_requested", "meaning": "Parsed PDF; full visual receiving is a separate step"})
    return result


def _raster(path):
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    with rasterio.open(path) as src:
        require(src.count == 5 and src.crs is not None, "Open the complete five-band structural diagnostic")
        counts, windows = [0] * src.count, 0
        for row in range(0, src.height, 512):
            for col in range(0, src.width, 512):
                data = src.read(window=Window(col, row, min(512, src.width - col),
                                             min(512, src.height - row)), masked=True)
                for band in range(src.count):
                    counts[band] += int(np.count_nonzero(~np.ma.getmaskarray(data[band])
                                                        & np.isfinite(data[band].filled(np.nan))))
                windows += 1
        return {"driver": src.driver, "width": src.width, "height": src.height, "bands": src.count,
                "band_descriptions": list(src.descriptions), "crs": src.crs.to_string(),
                "transform": list(src.transform)[:6], "windows_opened": windows,
                "finite_valid_cells_by_band": counts, "scope": "Complete raster values read; no recomputed science"}


def _archive(directory, path, report):
    manifest_path = verify_file(directory, report["files"]["package_manifest"])
    manifest = read_json(manifest_path)
    require(manifest["study_id"] == report["study_id"] and manifest["project_id"] == report["project_id"]
            and manifest["source_binding"] == report["source_binding"],
            "The report ZIP manifest belongs to another source")
    declared = manifest["members"] + [report["files"]["package_manifest"]]
    expected = {row["path"]: row for row in declared}
    require(len(expected) == len(declared), "The report package has duplicate member names")
    observations = []
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        require(len(infos) == len(expected) and {row.filename for row in infos} == set(expected),
                "The complete report ZIP membership differs from its inventory")
        for info in infos:
            name = PurePosixPath(info.filename)
            require(not name.is_absolute() and ".." not in name.parts
                    and not info.is_dir() and not (info.flag_bits & 1)
                    and stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG),
                    "The report archive member must be an ordinary retained file")
            descriptor = expected[info.filename]
            require(info.file_size == descriptor["bytes"], "The report ZIP member size changed")
            checksum, size = hashlib.sha256(), 0
            with archive.open(info) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    checksum.update(block)
                    size += len(block)
            require(size == descriptor["bytes"] and checksum.hexdigest() == descriptor["sha256"],
                    "The complete opened report ZIP member changed: " + info.filename)
            observations.append({"path": info.filename, "bytes": size, "sha256": checksum.hexdigest()})
    return {"members_opened": len(observations), "members": observations}


@verified_operation
def inspect_attachments(workspace, study_id, report_operation_id, render_output=None):
    study, operation, report = selected(workspace, study_id, report_operation_id)
    directory = workspace.root / "structural-studies" / study_id / "report"
    if render_output is not None:
        render_output = Path(render_output).absolute()
        require(render_output == render_output.resolve()
                and not render_output.is_relative_to(workspace.root)
                and not render_output.is_relative_to(APPLICATION),
                "Keep derived PDF page images outside the original Workspace and application")
    observations = {}
    for key, descriptor in report["files"].items():
        path = ordinary(verify_file(directory, descriptor))
        media = descriptor["media_type"].split(";")[0]
        observed = {"path": descriptor["path"], "bytes": descriptor["bytes"], "sha256": descriptor["sha256"]}
        if media == "image/tiff":
            observed["opened"] = _raster(path)
        elif media == "image/png":
            from PIL import Image
            with Image.open(path) as picture:
                picture.load()
                observed["opened"] = {"format": picture.format, "width": picture.width,
                                      "height": picture.height, "mode": picture.mode}
        elif media == "application/pdf":
            observed["opened"] = _pdf(path, render_output)
        elif media == "application/zip":
            observed["opened"] = _archive(directory, path, report)
        elif media == "application/json":
            value = read_json(path)
            observed["opened"] = {"schema": value.get("schema"), "keys": sorted(value)}
        elif media == "text/csv":
            with path.open("r", encoding="utf-8", newline="") as stream:
                reader = csv.reader(stream)
                headers = next(reader)
                count = 0
                for row in reader:
                    require(len(row) == len(headers), "Original report CSV row width changed")
                    count += 1
            observed["opened"] = {"headers": headers, "rows": count}
        elif media in ("text/html", "text/markdown"):
            value = path.read_text(encoding="utf-8")
            observed["opened"] = {"characters": len(value),
                                  "visual_receiving": "Original authenticated browser chapter"}
        else:
            raise ValueError("Add an actual attachment reader for the retained report media type: " + media)
        verify_file(directory, descriptor)
        observations[key] = observed
    study_files = {}
    for key, descriptor in study["files"].items():
        path = ordinary(verify_file(directory.parent, descriptor))
        if path.suffix.lower() == ".tif":
            opened = _raster(path)
        elif path.suffix.lower() == ".json":
            value = read_json(path)
            opened = {"schema": value.get("schema"), "keys": sorted(value)}
        else:
            raise ValueError("Add an original structural-study attachment reader for " + path.name)
        verify_file(directory.parent, descriptor)
        study_files[key] = {"path": descriptor["path"], "bytes": descriptor["bytes"],
                            "sha256": descriptor["sha256"], "opened": opened}
    return {"schema": "upstate.structural-study-attachments/v1", "project_id": workspace.project["id"],
            "study_id": study_id, "report_operation_id": report_operation_id, "report_sha256": digest(report),
            "files": observations, "study_files": study_files, "opened_at": now()}


@verified_operation
def receive(workspace_path, study_id, report_operation_id, output):
    workspace = Workspace(workspace_path)
    output = Path(output).absolute()
    require(output == output.resolve(), "Choose an ordinary receiving output path")
    require(not output.is_relative_to(workspace.root) and not output.is_relative_to(APPLICATION),
            "Keep the full receiving output outside the source Workspace and application")
    output.mkdir(parents=True, exist_ok=True)
    intent_path, archive_path = output / "intent.json", output / "scientific-workspace.zip"
    archive_record, destination, receipt_path = output / "archive.json", output / "received", output / "receiving.json"
    with held(output / ".receiving.lock", blocking=False):
        study, operation, report = selected(workspace, study_id, report_operation_id)
        request = {"project_id": workspace.project["id"], "study_id": study_id,
                   "report_operation_id": report_operation_id, "plan_digest": digest(study["plan"]),
                   "result_sha256": report["result_sha256"], "report_sha256": digest(report)}
        if intent_path.exists():
            intent = read_json(ordinary(intent_path))
            require(intent.get("schema") == SCHEMA and intent.get("request") == request,
                    "This receiving directory belongs to another original study/report")
        else:
            require(not any(path.name != ".receiving.lock" for path in output.iterdir()),
                    "Choose a new receiving directory or its original retained intent")
            intent = {"schema": SCHEMA, "request": request, "source_workspace": str(workspace.root),
                      "source_application": str(APPLICATION), "created_at": now()}
            atomic_json(intent_path, intent, immutable=True)
        if archive_record.exists():
            archive = read_json(ordinary(archive_record))
            require(archive.get("project_id") == request["project_id"] and archive.get("path") == str(archive_path)
                    and ordinary(archive_path).stat().st_size == archive.get("bytes")
                    and file_digest(archive_path) == archive.get("sha256"),
                    "The retained complete Workspace archive changed")
        else:
            if archive_path.exists():
                manifest = portable.inspect_archive(ordinary(archive_path), verify=True)
                require(manifest["project"]["id"] == request["project_id"]
                        and manifest["selection"].get("include_intermediates") is True
                        and manifest["selection"].get("include_deliveries") is True,
                        "Retain the original complete editable Workspace backup")
                archive = {"schema": portable.FORMAT, "project_id": request["project_id"],
                           "path": str(archive_path), "bytes": archive_path.stat().st_size,
                           "sha256": file_digest(archive_path), "members": len(manifest["members"]),
                           "selection": manifest["selection"]}
            else:
                archive = workspace.backup(archive_path, include_intermediates=True)
            atomic_json(archive_record, archive, immutable=True)
        receiver = (portable.resume_restore(archive_path, destination, expected_archive_sha256=archive["sha256"])
                    if destination.exists() else portable.restore(archive_path, destination))
        require(receiver["archive_sha256"] == archive["sha256"]
                and receiver["project"]["id"] == request["project_id"],
                "Cold receiver selected another original Workspace archive")
        observed = inspect_received(receiver, request, output / "rendered-attachments")
        if receipt_path.exists():
            receipt = read_json(ordinary(receipt_path))
            require(receipt.get("schema") == SCHEMA and receipt.get("request") == request
                    and receipt.get("archive") == archive
                    and receipt.get("received", {}).get("report_sha256") == request["report_sha256"]
                    and receipt.get("receiver", {}).get("archive_sha256") == archive["sha256"],
                    "The first receiving completion differs from this original operation")
            return {"schema": SCHEMA, "receipt": receipt, "current_received": observed,
                    "reused_completed_output": True}
        receiver = {key: value for key, value in receiver.items() if key != "reused_completed_output"}
        receipt = {"schema": SCHEMA, "request": request, "archive": archive, "receiver": receiver,
                   "received": observed, "attachments": observed["attachments"], "completed_at": now()}
        atomic_json(receipt_path, receipt, immutable=True)
        return {"schema": SCHEMA, "receipt": receipt, "current_received": observed,
                "reused_completed_output": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--study-id", required=True)
    parser.add_argument("--report-operation-id", required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--inspect-attachments", action="store_true")
    parser.add_argument("--render-output", type=Path,
                        help="Optional external derived page-image directory for full PDF visual receiving")
    args = parser.parse_args(argv)
    try:
        if args.inspect_attachments:
            result = inspect_attachments(Workspace(args.workspace), args.study_id, args.report_operation_id,
                                         args.render_output)
        else:
            require(args.output is not None, "Choose the original full receiving output directory")
            result = receive(args.workspace, args.study_id, args.report_operation_id, args.output)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except (ValueError, OSError, KeyError, RuntimeError, ImportError, zipfile.BadZipFile) as error:
        print(json.dumps({"state": "error", "type": type(error).__name__, "message": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
