#!/usr/bin/env python3
"""Original Climate receiving: authenticate copied products and inspect real attachments.
TokenJunkieLabs. This helper does not prepare grids, run models or build reports.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import threading
import xml.etree.ElementTree as ET
import zipfile

def require(ok, message):
    if not ok:
        raise ValueError(message)

def regular(value):
    path = Path(value).expanduser().absolute()
    require(path.resolve(strict=True) == path and path.is_file(), "Use a regular original file without path aliases: " + str(path))
    return path

def identity(path):
    path = regular(path)
    digest = hashlib.sha256()
    count = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
            count += len(block)
    return {"bytes": count, "sha256": digest.hexdigest()}

def read(path):
    return json.loads(regular(path).read_text("utf-8"))

def verify(path, expected):
    got = identity(path)
    require(got == {key: expected[key] for key in ("bytes", "sha256")}, "Original bytes changed: " + str(path))
    return got

def write(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".pending")
    require(not temporary.exists() and not temporary.is_symlink(), "A prior incomplete inspection exists: " + str(temporary))
    with temporary.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, allow_nan=False, indent=2)
        stream.write("\n")
    temporary.replace(path)

def serve(args):
    import sys
    application = Path(args.application).resolve(strict=True)
    workspace = Path(args.workspace).resolve(strict=True)
    state = Path(args.operator_state).resolve()
    require(not state.is_relative_to(application) and not state.is_relative_to(workspace), "Keep browser operator state outside original sources")
    result = read(args.native_result)
    journal = read(args.journal)
    require(result.get("schema") == "upstate.climate-management-receiving/v1" and result.get("native_course_complete") is True
            and result.get("status") == "native-course-complete", "Finish the same original native receiving course first")
    expected = journal["products"]
    require(expected["project"]["id"] == result["project_id"] and expected["management"]["id"] == result["management_report_id"]
            and expected["scientific"]["id"] == result["scientific_report_edition_id"], "The original result and product journal differ")
    for role, selected in expected["studies"].items():
        require(result["studies"].get(role) == selected["id"], "The selected original forcing study differs")
    for name, descriptor in result["receiving"][args.archive]["application_sources"].items():
        verify(application / name, descriptor)
    sys.path[:0] = [str(application / "operator"), str(application)]
    from server import start_server
    from source_tools.receive_climate_management import verify_products
    from model import study_transfer
    server, receipt = start_server(workspace, state_directory=state, create=False, port=0)
    try:
        verified = verify_products(server.operator, receipt["workspace_key"], expected)
        require(verified["downloads"] == result["receiving"][args.archive]["verification"]["downloads"],
                "The copied application's original download membership changed")
        if args.archive == "selected-study":
            study_transfer.verify_received_studies(server.operator.ws(receipt["workspace_key"]))
        receipt["verification"] = verified
        receipt["read_only_course"] = True
        print(json.dumps(receipt, ensure_ascii=False), flush=True)
        def stop(*unused):
            threading.Thread(target=server.shutdown, daemon=True).start()
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        server.serve_forever(poll_interval=.3)
    finally:
        server.server_close()
        server.operator.close()

def archive_members(path):
    rows = []
    with zipfile.ZipFile(path) as archive:
        names = set()
        for member in archive.infolist():
            parts = member.filename.rstrip("/").split("/")
            require(member.filename and not member.filename.startswith(("/", "\\")) and "\\" not in member.filename
                    and all(part not in ("", ".", "..") for part in parts)
                    and member.filename not in names, "Unsafe or duplicate original archive member")
            names.add(member.filename)
            require((member.external_attr >> 16) & 0o170000 != 0o120000, "Original archive contains a symbolic link")
            if member.is_dir():
                continue
            digest = hashlib.sha256()
            total = 0
            with archive.open(member) as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(block)
                    total += len(block)
            require(total == member.file_size, "An original archive member is incomplete")
            rows.append({"path": member.filename, "bytes": total, "sha256": digest.hexdigest(), "crc32": "%08x" % member.CRC})
    return rows

def pdf_pages(path, target, executable=None):
    target.mkdir()
    try:
        import fitz
    except ImportError:
        fitz = None
    if fitz is not None:
        with fitz.open(path) as document:
            require(not document.needs_pass and document.page_count > 0, "Open the complete readable original PDF")
            rows = []
            for index, page in enumerate(document):
                destination = target / ("page-%04d.png" % (index + 1))
                page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(destination)
                rows.append({"path": str(destination), "page": index + 1, **identity(destination)})
        return {"renderer": "PyMuPDF", "pages": rows}
    require(executable, "PDF inspection needs installed PyMuPDF or an explicit --pdftoppm executable")
    executable = Path(executable).absolute()
    require(executable.resolve(strict=True).is_file(), "Select an installed PDF renderer")
    completed = subprocess.run([str(executable), "-png", "-r", "108", str(path), str(target / "page")],
                               capture_output=True, text=True, check=False)
    require(completed.returncode == 0, "Original PDF renderer failed: " + completed.stderr[-3000:])
    files = sorted(target.glob("page-*.png"), key=lambda p: int(p.stem.split("-")[-1]))
    require(files, "The original PDF rendered no pages")
    return {"renderer": str(executable), "pages": [{"path": str(file), "page": index + 1, **identity(file)}
                                                  for index, file in enumerate(files)]}

def raster_preview(path, target):
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    import matplotlib
    matplotlib.use("Agg")
    from matplotlib import pyplot as plt
    with rasterio.open(path) as dataset:
        require(dataset.count >= 1, "Open the retained original raster bands")
        # Only the display is sampled. No scientific result is recalculated or saved.
        scale = min(1.0, 900 / max(dataset.width, dataset.height))
        height, width = max(1, round(dataset.height * scale)), max(1, round(dataset.width * scale))
        data = dataset.read(1, out_shape=(height, width), masked=True, resampling=Resampling.nearest)
        data = np.ma.masked_invalid(data)
        tags = dataset.tags()
        figure, axis = plt.subplots(figsize=(9, 7))
        image = axis.imshow(data, interpolation="nearest", cmap="viridis")
        axis.set_title(path.name + "\nDisplay of original band 1; nearest-neighbour preview")
        axis.set_xlabel("Display column"); axis.set_ylabel("Display row")
        if data.count():
            figure.colorbar(image, ax=axis, label=tags.get("units", "Original raster units: see source metadata"))
        else:
            axis.text(.5, .5, "No finite values in this display", ha="center", transform=axis.transAxes)
        figure.tight_layout()
        figure.savefig(target, dpi=120); plt.close(figure)
        return {"driver": dataset.driver, "width": dataset.width, "height": dataset.height, "count": dataset.count,
                "crs": str(dataset.crs), "transform": list(dataset.transform), "units": tags.get("units"),
                "tags": tags, "preview_method": "Nearest-neighbour display of band 1; no model statistics or area conversion",
                "preview": {"path": str(target), **identity(target)}}

def inspect(args):
    manifest = read(args.manifest)
    output = Path(args.output).absolute()
    output.mkdir(parents=True, exist_ok=False)
    require(output.resolve() == output, "Keep inspection output on its real original path")
    rows = []
    for index, selected in enumerate(manifest["files"]):
        path = regular(selected["path"])
        require(not path.is_relative_to(output), "Inspection inputs must remain outside generated previews")
        original = verify(path, selected)
        suffix = path.suffix.lower()
        row = {**selected, **original, "opened": True, "kind": suffix.lstrip(".") or "binary"}
        if suffix == ".pdf":
            row["rendered"] = pdf_pages(path, output / ("pdf-%05d" % index), args.pdftoppm)
        elif suffix in (".tif", ".tiff"):
            row["raster"] = raster_preview(path, output / ("raster-%05d.png" % index))
        elif suffix in (".zip", ".odt", ".xlsx"):
            row["members"] = archive_members(path)
            row["interpretation"] = "Complete ZIP container and every original member read/CRC/SHA verified; open editable documents in their normal application"
        elif suffix in (".csv", ".tsv"):
            with path.open("r", encoding="utf-8-sig", newline="") as source:
                reader = csv.reader(source, delimiter="\t" if suffix == ".tsv" else ",")
                header = next(reader, [])
                count = sum(1 for unused in reader)
            row["columns"], row["rows"] = header, count
        elif suffix in (".json", ".geojson"):
            value = json.loads(path.read_text("utf-8-sig"))
            row["top_level"] = type(value).__name__
            row["top_level_members"] = len(value) if isinstance(value, (list, dict)) else None
        elif suffix in (".xml", ".svg"):
            tree = ET.parse(path)
            row["root_element"] = tree.getroot().tag
        elif suffix == ".gpkg":
            import fiona
            row["layers"] = []
            for layer in fiona.listlayers(path):
                with fiona.open(path, layer=layer) as source:
                    count = sum(1 for unused in source)
                    row["layers"].append({"name": layer, "features": count, "crs_wkt": source.crs_wkt,
                                          "schema": dict(source.schema)})
        elif suffix in (".html", ".htm", ".txt", ".md", ".prj", ".cpg"):
            row["text_characters"] = len(path.read_text("utf-8-sig"))
        else:
            row["interpretation"] = "Original bytes fully read; use the original format's application for human review"
        rows.append(row)
    value = {"schema": "upstate.climate-browser-attachments/v1", "files": rows,
             "human_review": "Required; successful reading/rendering does not claim that a person inspected these views"}
    write(output / "attachments.json", value)
    print(json.dumps({"path": str(output / "attachments.json"), **identity(output / "attachments.json")}), flush=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    server = commands.add_parser("serve")
    for field in ("application", "workspace", "operator-state", "native-result", "journal"):
        server.add_argument("--" + field, required=True)
    server.add_argument("--archive", choices=("selected-study", "complete-workspace"), required=True)
    scanner = commands.add_parser("inspect")
    scanner.add_argument("--manifest", required=True)
    scanner.add_argument("--output", required=True)
    scanner.add_argument("--pdftoppm")
    args = parser.parse_args()
    serve(args) if args.command == "serve" else inspect(args)

if __name__ == "__main__":
    main()
