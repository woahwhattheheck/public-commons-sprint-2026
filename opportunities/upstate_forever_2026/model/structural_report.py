"""Human structural-study report from retained native results; no model recalculation."""
from __future__ import annotations

import base64
import csv
import html
import importlib.metadata
import io
import math
import os
import re
from pathlib import Path
import shutil
import tempfile
import zipfile

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, held, identifier, now, read_json, verify_file)
from .verified_files import verified_operation

SCHEMA = "upstate.structural-report/v1"
EDITION = 1
ATTRIBUTION = "TokenJunkie Labs"
LABELS = {"nitrogen_export": "Nitrogen export", "phosphorus_export": "Phosphorus export",
          "sediment_export": "Sediment export"}
CSS = """
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#eee;color:#171717;
font:16px/1.55 system-ui,sans-serif}main{max-width:1180px;margin:0 auto;padding:36px;background:#fff}
h1{font-size:30px;line-height:1.2}h2{border-top:2px solid #333;padding-top:18px;margin-top:36px}
h3{margin-top:25px}a{color:#111;text-decoration:underline}table{border-collapse:collapse;width:100%;
margin:16px 0;font-size:14px}th,td{padding:9px;border:1px solid #aaa;vertical-align:top;text-align:left;
overflow-wrap:anywhere}th{background:#eee}td.number{text-align:right;font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto}img{display:block;max-width:100%;height:auto}figure{margin:22px 0}
figcaption,.muted{color:#444;font-size:14px}.note{border-left:4px solid #666;padding:12px 18px;
background:#f3f3f3}.identity,pre{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere;white-space:pre-wrap}
section{scroll-margin-top:20px}nav ul{display:flex;gap:12px;flex-wrap:wrap;padding:0;list-style:none}
@media(max-width:600px){main{padding:16px}h1{font-size:25px}th,td{padding:7px}}
@media print{body{background:white}main{max-width:none;padding:0}a{color:black}h2,h3{break-after:avoid}
figure,tr{break-inside:avoid}.scroll{overflow:visible}nav{display:none}}
"""


def _directory(workspace, study_id):
    return workspace.root / "structural-studies" / identifier(study_id) / "report"


def _fmt(value):
    if value is None:
        return "Not defined"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise ValueError("A retained structural quantity is not finite")
        return format(value, ".6g")
    if isinstance(value, str):
        return value
    return canonical(value).decode("utf-8")


def _e(value):
    return html.escape(_fmt(value), quote=True)


def _version(package):
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return "unavailable"


def _implementation():
    dependencies = {name: _version(name) for name in ("rasterio", "numpy", "matplotlib", "reportlab")}
    missing = [name for name, version in dependencies.items() if version == "unavailable"]
    if missing:
        raise ImportError("Install the original report runtime before starting its retained intent: "
                          + ", ".join(missing))
    return {"edition": EDITION, "renderer_sha256": file_digest(Path(__file__)),
            "dependencies": dependencies}


@verified_operation
def read(workspace, study_id, *, result_sha256=None):
    """Read and verify the first completed receipt and every retained report member."""
    directory = _directory(workspace, study_id)
    receipt = read_json(directory / "report.json")
    if (receipt.get("schema") != SCHEMA or receipt.get("study_id") != study_id
            or receipt.get("project_id") != workspace.project["id"]):
        raise ValueError("Structural report belongs to another original project or study")
    actual = file_digest(directory.parent / "result.json")
    if receipt.get("result_sha256") != actual or result_sha256 not in (None, actual):
        raise ValueError("Structural report's original result changed")
    if receipt.get("source_binding", {}).get("plan_sha256") != file_digest(directory.parent / "plan.json"):
        raise ValueError("Structural report\'s original plan changed")
    intent = read_json(directory / "intent.json")
    if canonical(intent.get("source_binding")) != canonical(receipt.get("source_binding")):
        raise ValueError("Structural report differs from its original rendering intent")
    if receipt.get("id") != digest(receipt.get("source_binding")):
        raise ValueError("Structural report's original source binding changed")
    for descriptor in receipt["files"].values():
        verify_file(directory, descriptor)
    return receipt


def _csv_bytes(headers, rows):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(headers)
    for row in rows:
        writer.writerow("" if value is None else value if isinstance(value, (str, int, float))
                        else canonical(value).decode("utf-8") for value in row)
    return stream.getvalue().encode("utf-8")


def _quantity_rows(result):
    rows = []
    for case in result["cases"]:
        for pollutant in result["pollutants"]:
            comparison = case["comparisons"][pollutant]
            for side in ("reference", "case"):
                own = comparison[side]
                rows.append({"case_id": case["id"], "case_label": case["label"],
                    "pollutant": pollutant, "side": side, "mass_units": comparison["mass_units"],
                    "valid_cells": own["valid_cells"], "own_valid_area_m2": own["valid_area_m2"],
                    "own_mass": own["mass"], "shared_valid_area_m2": own["shared_area_m2"],
                    "shared_mass": own["shared_mass"], "omitted_valid_area_m2": own["omitted_valid_area_m2"],
                    "omitted_mass": own["omitted_mass"],
                    "shared_fraction_of_own_area": own["shared_fraction_of_own_area"],
                    "case_minus_reference_shared_mass": comparison["change_shared_mass"],
                    "percent_change_shared": comparison["percent_change_shared"]})
    return rows


def _production_text(result):
    value = result["production_designation"]
    resolution = value["reference_resolution_m"]
    return ("RFP production cell size: " + _fmt(value["rfp_resolution_m"]) + " m. "
            "Actual reference cell dimensions: " + _fmt(resolution[0]) + " × " + _fmt(resolution[1])
            + " m. Meets the 30 m grid designation: " + ("Yes" if value["reference_is_30m"] else "No")
            + ". " + value["meaning"])


def _summary(result):
    return {"cases": len(result["cases"]),
            "comparisons": sum(len(case["comparisons"]) for case in result["cases"]),
            "direction": result["direction"],
            "reference_run_id": result["reference"]["run"]["id"],
            "native_models": result["models"],
            "production_designation": result["production_designation"],
            "common_support_comparisons": sum(
                comparison["shared_valid_area_m2"] > 0
                for case in result["cases"] for comparison in case["comparisons"].values()),
            "interpretation": result["interpretation"]}


def _retain_diagnostic(workspace, directory, descriptor, relative):
    source = verify_file(workspace.root, descriptor)
    target = directory / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    expected = {**descriptor, "path": relative}
    if target.exists():
        verify_file(directory, expected)
        return target
    # Independent copy: later edits to a working native file cannot mutate the report.
    pending = target.with_name("." + target.name + ".partial")
    pending.unlink(missing_ok=True)
    try:
        with source.open("rb") as inp, pending.open("xb") as out:
            shutil.copyfileobj(inp, out, 1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        verify_file(directory, {**expected, "path": pending.relative_to(directory).as_posix()})
        os.replace(pending, target)
        verify_file(workspace.root, descriptor)
    finally:
        pending.unlink(missing_ok=True)
    return target


def _figure(path, destination, comparison, case_label, pollutant):
    """Display original diagnostic bands. Sampling here never supplies report totals."""
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    import matplotlib
    matplotlib.use("Agg", force=True)
    from matplotlib import pyplot as plt
    from matplotlib.colors import Normalize

    with rasterio.open(path) as src:
        if src.count != 5 or src.crs is None:
            raise ValueError("Select the original five-band structural diagnostic")
        scale = min(1.0, 700.0 / max(src.width, src.height))
        width, height = max(1, round(src.width * scale)), max(1, round(src.height * scale))
        bands = src.read([1, 2, 3, 5], out_shape=(4, height, width),
                         masked=True, resampling=Resampling.nearest)
        bounds = src.bounds
        extent = [bounds.left, bounds.right, bounds.bottom, bounds.top]
        crs = src.crs.to_string()
        source_shape = [src.height, src.width]
    finite = [array.compressed() for array in bands]
    positive = [a[np.isfinite(a)] for a in finite[:2] if a.size]
    upper = max([float(np.max(a)) for a in positive if a.size] + [0.0])
    difference = finite[2]
    difference = difference[np.isfinite(difference)]
    magnitude = float(np.max(np.abs(difference))) if difference.size else 0.0
    fig, axes = plt.subplots(2, 2, figsize=(10, 7.8), constrained_layout=True)
    specs = [
        ("Reference mass on shared support", bands[0], Normalize(0, upper or 1), comparison["mass_units"]),
        ("Case mass on shared support", bands[1], Normalize(0, upper or 1), comparison["mass_units"]),
        ("Case minus reference", bands[2], Normalize(-(magnitude or 1), magnitude or 1), comparison["mass_units"]),
        ("Shared fraction of reference cell", bands[3], Normalize(0, 1), "Fraction (0–1)"),
    ]
    cmap = plt.get_cmap("Greys").copy()
    cmap.set_bad("#eeeeee")
    for ax, (title, array, norm, units) in zip(axes.flat, specs):
        ax.set_title(title, fontsize=10)
        ax.set_facecolor("#eeeeee")
        if np.ma.count(array):
            artist = ax.imshow(array, extent=extent, origin="upper", interpolation="nearest",
                               cmap=cmap, norm=norm)
            colorbar = fig.colorbar(artist, ax=ax, shrink=.8)
            colorbar.set_label(units, fontsize=8)
            colorbar.ax.tick_params(labelsize=8)
        else:
            ax.text(.5, .5, "No shared support in this display sample", ha="center", va="center",
                    wrap=True, transform=ax.transAxes, fontsize=9)
            ax.set_xlim(extent[0], extent[1])
            ax.set_ylim(extent[2], extent[3])
        ax.set_xlabel("Easting (m)", fontsize=8)
        ax.set_ylabel("Northing (m)", fontsize=8)
        ax.tick_params(labelsize=7)
        ax.ticklabel_format(axis="both", style="plain", useOffset=False)
        ax.set_aspect("equal")
    fig.suptitle(case_label + " — " + LABELS[pollutant], fontsize=12)
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        buffer = io.BytesIO()
        fig.savefig(buffer, format="png", dpi=150, metadata={"Software": SCHEMA})
        atomic_bytes(destination, buffer.getvalue())
    finally:
        plt.close(fig)
    return {"source_shape": source_shape, "display_shape": [height, width], "crs": crs,
            "bounds": extent, "resampling": "nearest; display only",
            "caption": (
                "Original five-band diagnostic, displayed on the reference grid in " + crs + ". "
                "The first two panels use the same display scale; the difference scale is symmetric about zero. "
                "Each mass value is allocated mass on the shared part of its reference cell, not a concentration "
                "or a per-hectare rate. Pale gray outside the shared mask is missing support, not zero mass. "
                "The preview uses nearest-neighbour samples and sample-derived display ranges; all table totals "
                "come from the complete native comparison. The accompanying GeoTIFF retains every original "
                "diagnostic cell and its fifth band records shared reference-cell fraction.")}


def _footprints(workspace, reference, case, pollutant, destination):
    """Show both original valid footprints, including case-only area beyond reference extent."""
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    import matplotlib
    matplotlib.use("Agg", force=True)
    from matplotlib import pyplot as plt
    from matplotlib.colors import ListedColormap
    sources, observed = [], []
    for label, run in (("Reference", reference), ("Case", case)):
        root = workspace.root / "runs" / identifier(run["id"])
        descriptor = run["artifacts"][pollutant]
        path = verify_file(root, descriptor)
        with rasterio.open(path) as dataset:
            scale = min(1.0, 700.0 / max(dataset.width, dataset.height))
            shape = (max(1, round(dataset.height * scale)), max(1, round(dataset.width * scale)))
            values = dataset.read(1, out_shape=shape, masked=True, resampling=Resampling.nearest)
            valid = ~np.ma.getmaskarray(values) & np.isfinite(values.filled(np.nan))
            bounds = dataset.bounds
            sources.append((label, valid, [bounds.left, bounds.right, bounds.bottom, bounds.top]))
            observed.append({"side": label.lower(), "run_id": run["id"], "file": descriptor,
                             "crs": dataset.crs.to_string(), "source_shape": [dataset.height, dataset.width],
                             "display_shape": list(shape)})
        verify_file(root, descriptor)
    common = [min(row[2][0] for row in sources), max(row[2][1] for row in sources),
              min(row[2][2] for row in sources), max(row[2][3] for row in sources)]
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.8), constrained_layout=True)
    for ax, (label, valid, extent) in zip(axes, sources):
        ax.set_facecolor("#eeeeee")
        masked = np.ma.masked_where(~valid, np.ones(valid.shape))
        ax.imshow(masked, extent=extent, origin="upper", interpolation="nearest",
                  cmap=ListedColormap(["#444444"]), vmin=0, vmax=1)
        ax.set_xlim(common[0], common[1])
        ax.set_ylim(common[2], common[3])
        ax.set_title(label + " original valid footprint", fontsize=11)
        ax.set_xlabel("Easting (m)", fontsize=9)
        ax.set_ylabel("Northing (m)", fontsize=9)
        ax.tick_params(labelsize=7)
        ax.ticklabel_format(axis="both", style="plain", useOffset=False)
        ax.set_aspect("equal")
    try:
        buffer = io.BytesIO()
        fig.savefig(buffer, format="png", dpi=150, metadata={"Software": SCHEMA})
        atomic_bytes(destination, buffer.getvalue())
    finally:
        plt.close(fig)
    return {"sources": observed, "bounds": common, "caption":
            "Both original native valid footprints use the same geographic extent. Dark gray marks sampled valid "
            "output, including valid zero mass; pale gray denotes missing support. Case-only area outside the "
            "reference grid remains visible here. Nearest-neighbour display samples may omit small features. "
            "Complete own/shared/omitted areas and masses are retained in the tables; the original rasters remain "
            "in the full editable Workspace. These footprint maps do not calculate common-support quantities."}


def _table(headers, rows):
    return '<div class="scroll"><table><thead><tr>' + "".join(
        "<th>" + _e(x) + "</th>" for x in headers) + "</tr></thead><tbody>" + "".join(
        "<tr>" + "".join('<td class="number">' + _e(value) + "</td>" for value in row)
        + "</tr>" for row in rows) + "</tbody></table></div>"


def _support_rows(comparison):
    return [[label, comparison[side]["valid_area_m2"], comparison[side]["mass"],
             comparison[side]["shared_area_m2"], comparison[side]["shared_mass"],
             comparison[side]["omitted_valid_area_m2"], comparison[side]["omitted_mass"]]
            for side, label in (("reference", "Reference"), ("case", "Case"))]


SUPPORT_HEADERS = ["Original run", "Own area (m²)", "Own mass", "Shared area (m²)",
                   "Shared mass", "Omitted area (m²)", "Omitted mass"]


def _report_html(model, directory):
    result = model["result"]
    pieces = ['<!doctype html><html lang="en"><head><meta charset="utf-8">',
              '<meta name="viewport" content="width=device-width, initial-scale=1">',
              "<title>" + _e(result["title"]) + "</title><style>" + CSS + "</style></head><body><main>",
              "<p class=\"muted\">" + ATTRIBUTION + " · Eco scientific workspace</p>",
              "<h1>" + _e(result["title"]) + "</h1>",
              "<p>Structural and spatial sensitivity study · " + _e(result["family"]) + "</p>",
              "<p>" + _e(result["purpose"]) + "</p>",
              '<p class="identity">Project ' + _e(result["project_id"]) + "<br>Study " + _e(result["id"])
              + "<br>Original result SHA-256 " + _e(model["source_binding"]["result_sha256"]) + "</p>",
              '<nav aria-label="Report sections"><ul><li><a href="#design">Study design</a></li>'
              '<li><a href="#results">Results and maps</a></li><li><a href="#interpretation">Interpretation</a></li>'
              '<li><a href="#sources">Sources and downloads</a></li></ul></nav>',
              '<section id="design"><h2>Study design</h2>',
              "<p>Reference run: <span class=\"identity\">" + _e(result["reference"]["run"]["id"]) + "</span></p>",
              "<p>Native models: " + _e(", ".join(result["models"])) + ". Direction: "
              + _e(result["direction"]) + ".</p>",
              '<p class="note">Production grid designation: ' + _e(_production_text(result))
              + "</p><p>" + _e(result["support_policy"]) + "</p><p>" + _e(result["method"]) + "</p>",
              "<p>Physical stream-initiation areas and native pixel thresholds appear together below. "
              "The production designation records whether the reference meets the RFP's 30 m grid requirement.</p>",
              _table(["Native model", "Routing", "Stream area (m²)", "Pixel area (m²)", "Pixel threshold"],
                     [[name, values["flow_dir_algorithm"], values["stream_area_m2"], values["pixel_area_m2"],
                       values["threshold_flow_accumulation"]] for name, values in result["reference"]["models"].items()]),
              '</section><section id="results"><h2>Results and maps</h2>',
              "<p>Own-support quantities describe each original native output. Shared quantities use the same "
              "geographic area for a case/reference pair. Omitted quantities explain how much of each original "
              "footprint falls outside that pair's comparison. Annual mass units are stated separately for each pollutant.</p>"]
    for case in result["cases"]:
        pieces.extend(["<h3>" + _e(case["label"]) + "</h3><p>" + _e(case["reason"]) + "</p>",
                       '<p class="identity">Native run ' + _e(case["run"]["id"]) + "<br>Grid " + _e(case["grid"]["id"]) + "</p>",
                       _table(["Changed field", "Reference", "Case", "Meaning"],
                              [[x["field"], x["reference"], x["case"], x["meaning"]] for x in case["changes"]]),
                       _table(["Native model", "Routing", "Stream area (m²)", "Pixel area (m²)", "Pixel threshold"],
                              [[name, values["flow_dir_algorithm"], values["stream_area_m2"], values["pixel_area_m2"],
                                values["threshold_flow_accumulation"]] for name, values in case["models"].items()])])
        for pollutant in result["pollutants"]:
            comparison = case["comparisons"][pollutant]
            key = case["id"] + "__" + pollutant
            figure = model["figures"][key]
            png = base64.b64encode((directory / figure["path"]).read_bytes()).decode("ascii")
            footprint_png = base64.b64encode((directory / figure["footprint_path"]).read_bytes()).decode("ascii")
            pieces.extend(["<h4>" + _e(LABELS[pollutant]) + " · " + _e(comparison["mass_units"]) + "</h4>",
                           _table(SUPPORT_HEADERS, _support_rows(comparison)),
                           "<p>Change on shared support: <strong>" + _e(comparison["change_shared_mass"]) + " "
                           + _e(comparison["mass_units"]) + "</strong>; percent change: "
                           + _e(comparison["percent_change_shared"]) + ("" if comparison["percent_change_shared"] is None else "%")
                           + ".</p><p>Shared area: " + _e(comparison["shared_valid_area_m2"])
                           + " m². Percent change is undefined when reference shared mass is zero or no support overlaps.</p>",
                           '<figure><img alt="Original reference and case valid footprints" src="data:image/png;base64,'
                           + footprint_png + '"><figcaption>' + _e(figure["footprint"]["caption"]) + '</figcaption></figure>',
                           '<figure><img alt="' + _e(case["label"] + ": " + LABELS[pollutant] + " and geographic support")
                           + '" src="data:image/png;base64,' + png + '"><figcaption>' + _e(figure["caption"])
                           + '</figcaption></figure><p><a href="' + _e(figure["diagnostic_path"])
                           + '">Download full five-band comparison GeoTIFF</a></p>'])
        pieces.extend(["<p>" + _e(case["scientific_interpretation"]) + "</p>",
                       "<p>Case references: " + _e(case["references"]) + "</p>"])
    pieces.extend(['</section><section id="interpretation"><h2>Interpretation and geographic limits</h2>',
                   "<p>" + _e(result["interpretation"]) + "</p><ul>"])
    limits = list(dict.fromkeys(limit for case in result["cases"]
                               for comparison in case["comparisons"].values() for limit in comparison["limitations"]))
    pieces.extend("<li>" + _e(x) + "</li>" for x in limits)
    pieces.extend(["</ul><p>No single ranking is inferred across cases with different shared footprints. "
                   "The scientist's decision should identify which conclusions persist across relevant assumptions "
                   "and which depend on terrain, resolution, routing, domain, or stream definition.</p>",
                   '</section><section id="sources"><h2>Sources and downloads</h2>',
                   '<p><a href="report.pdf">PDF report</a> · <a href="report.md">Markdown report</a> · '
                   '<a href="quantities.csv">Complete quantities</a> · <a href="changes.csv">Changed assumptions</a> · '
                   '<a href="report-model.json">Full scientific result and source bindings</a> · '
                   '<a href="package-manifest.json">Package inventory</a></p>',
                   "<p>The complete human report package contains this report, maps, quantities, and diagnostic GIS. "
                   "Use the application's Project transfer to export the entire editable Workspace, original inputs, "
                   "native runs, and application after the report task completes.</p>",
                   "<h3>Study references</h3><pre>" + _e(result["references"]) + "</pre>",
                   "<h3>Native runtime provenance</h3><pre>" + _e(result["native_version_provenance"]) + "</pre>",
                   "<h3>Original source binding</h3><pre>" + _e(model["source_binding"]) + "</pre>",
                   "</section></main></body></html>"])
    return "\n".join(pieces).encode("utf-8")


def _markdown(model):
    result = model["result"]
    lines = ["# " + result["title"], "", ATTRIBUTION + " · Eco scientific workspace", "", result["purpose"], "",
             "Family: " + result["family"], "", "Project: " + result["project_id"],
             "", "Study: " + result["id"], "",
             "Reference run: " + result["reference"]["run"]["id"], "",
             "Original result SHA-256: " + model["source_binding"]["result_sha256"], "",
             "## Study design", "", _production_text(result), "",
             _fmt(result["support_policy"]), "", _fmt(result["method"]), "",
             "Direction: " + result["direction"], "",
             "All quantities below come from complete retained native comparisons. "
             "Map previews sample original diagnostics only for display.", ""]
    def table(headers, rows):
        def cell(value):
            return _fmt(value).replace("|", "\\|").replace("\n", " ")
        return ["| " + " | ".join(map(cell, headers)) + " |",
                "| " + " | ".join("---" for _ in headers) + " |"] + [
                    "| " + " | ".join(map(cell, row)) + " |" for row in rows]
    for case in result["cases"]:
        lines += ["## " + case["label"], "", case["reason"], "",
                  "Native run: " + case["run"]["id"], "", "Grid: " + case["grid"]["id"], ""]
        lines += table(["Field", "Reference", "Case", "Meaning"],
                       [[x["field"], x["reference"], x["case"], x["meaning"]] for x in case["changes"]]) + [""]
        lines += table(["Model", "Routing", "Stream area m2", "Pixel area m2", "Pixel threshold"],
                       [[name, values["flow_dir_algorithm"], values["stream_area_m2"],
                         values["pixel_area_m2"], values["threshold_flow_accumulation"]]
                        for name, values in case["models"].items()]) + [""]
        for pollutant in result["pollutants"]:
            comparison = case["comparisons"][pollutant]
            figure = model["figures"][case["id"] + "__" + pollutant]
            lines += ["### " + LABELS[pollutant] + " (" + comparison["mass_units"] + ")", ""]
            lines += table(SUPPORT_HEADERS, _support_rows(comparison)) + [""]
            lines += ["Case minus reference on shared support: " + _fmt(comparison["change_shared_mass"])
                      + " " + comparison["mass_units"] + "; percent change: "
                      + _fmt(comparison["percent_change_shared"]), "",
                      "![Original native footprints](" + figure["footprint_path"] + ")", "",
                      figure["footprint"]["caption"], "",
                      "![Native comparison map](" + figure["path"] + ")", "", figure["caption"], "",
                      "[Full diagnostic GeoTIFF](" + figure["diagnostic_path"] + ")", ""]
        lines += [case["scientific_interpretation"], "", "References: " + _fmt(case["references"]), ""]
    lines += ["## Interpretation", "", result["interpretation"], ""]
    limits = dict.fromkeys(limit for case in result["cases"] for comparison in case["comparisons"].values()
                          for limit in comparison["limitations"])
    lines += ["- " + x for x in limits] + ["", "## Sources", "", _fmt(result["references"]), "",
             "Native runtime provenance: " + _fmt(result["native_version_provenance"]), "",
             "Complete source and result records: [report-model.json](report-model.json).",
             "", "Use Project transfer after this task completes for the full editable Workspace and application.", ""]
    return "\n".join(lines).encode("utf-8")


def _pdf(model, directory):
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_LEFT
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                   Image, PageBreak, KeepTogether)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="ReportBody", parent=styles["BodyText"], fontName="Helvetica",
                              fontSize=9, leading=13, spaceAfter=8, alignment=TA_LEFT, splitLongWords=True))
    styles.add(ParagraphStyle(name="ReportSmall", parent=styles["ReportBody"], fontSize=7, leading=10))
    styles["Heading1"].textColor = colors.black
    styles["Heading2"].textColor = colors.black
    styles["Heading3"].textColor = colors.black
    def p(value, style="ReportBody"):
        return Paragraph(_e(value).replace("\n", "<br/>"), styles[style])
    def table(headers, rows, widths=None):
        cells = [[p(value, "ReportSmall") for value in row] for row in [headers, *rows]]
        item = Table(cells, colWidths=widths or [532 / len(headers)] * len(headers), repeatRows=1,
                     hAlign="LEFT")
        item.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
                                  ("GRID", (0, 0), (-1, -1), .35, colors.HexColor("#888888")),
                                  ("VALIGN", (0, 0), (-1, -1), "TOP"),
                                  ("LEFTPADDING", (0, 0), (-1, -1), 5),
                                  ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                                  ("TOPPADDING", (0, 0), (-1, -1), 6),
                                  ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
        return item
    result = model["result"]
    flow = [p(ATTRIBUTION + " · Eco scientific workspace", "ReportSmall"), p(result["title"], "Title"), p("Structural and spatial sensitivity · " + result["family"]),
            p(result["purpose"]), p("Study " + result["id"], "ReportSmall"),
            p("Original result SHA-256 " + model["source_binding"]["result_sha256"], "ReportSmall"),
            p("Study design", "Heading1"), p(_production_text(result)),
            p(result["support_policy"]), p(result["method"]), p("Direction: " + result["direction"]),
            p("Reference run " + result["reference"]["run"]["id"], "ReportSmall"),
            table(["Model", "Routing", "Stream area m²", "Pixel area m²", "Pixel threshold"],
                  [[name, values["flow_dir_algorithm"], values["stream_area_m2"],
                    values["pixel_area_m2"], values["threshold_flow_accumulation"]]
                   for name, values in result["reference"]["models"].items()]),
            Spacer(1, 12), p(result["interpretation"])]
    for case in result["cases"]:
        flow.extend([PageBreak(), p(case["label"], "Heading1"), p(case["reason"]),
                     p("Native run " + case["run"]["id"] + "\nGrid " + case["grid"]["id"], "ReportSmall"),
                     p("Changed assumptions", "Heading2")])
        # Each potentially long source identity is a flowing paragraph, avoiding
        # an unbreakable table row for scientific source/reference metadata.
        for change in case["changes"]:
            flow.extend([p(change["field"], "Heading3"),
                         p("Reference: " + _fmt(change["reference"]), "ReportSmall"),
                         p("Case: " + _fmt(change["case"]), "ReportSmall"), p(change["meaning"])])
        flow.extend([table(["Model", "Routing", "Stream area m²", "Pixel area m²", "Pixel threshold"],
                          [[name, values["flow_dir_algorithm"], values["stream_area_m2"],
                            values["pixel_area_m2"], values["threshold_flow_accumulation"]]
                           for name, values in case["models"].items()]), Spacer(1, 12)])
        for pollutant in result["pollutants"]:
            comparison = case["comparisons"][pollutant]
            figure = model["figures"][case["id"] + "__" + pollutant]
            flow.extend([PageBreak(), p(case["label"] + " — " + LABELS[pollutant], "Heading2"),
                         p("Annual mass units: " + comparison["mass_units"]),
                         table(SUPPORT_HEADERS, _support_rows(comparison)),
                         Spacer(1, 10),
                         p("Case minus reference on shared support: " + _fmt(comparison["change_shared_mass"])
                           + " " + comparison["mass_units"] + ". Percent change: "
                           + _fmt(comparison["percent_change_shared"]) + "."),
                         Image(str(directory / figure["footprint_path"]), width=510, height=244.8),
                         p(figure["footprint"]["caption"], "ReportSmall"),
                         PageBreak(), p(case["label"] + " — " + LABELS[pollutant] + " comparison map", "Heading2"),
                         Image(str(directory / figure["path"]), width=510, height=397.8),
                         p(figure["caption"], "ReportSmall")])
        flow.extend([p(case["scientific_interpretation"]), p("Case references: " + _fmt(case["references"]))])
    flow.extend([PageBreak(), p("Interpretation and source records", "Heading1"), p(result["interpretation"])])
    limits = dict.fromkeys(limit for case in result["cases"] for comparison in case["comparisons"].values()
                          for limit in comparison["limitations"])
    flow.extend(p(x) for x in limits)
    flow.extend([p("Study references", "Heading2"), p(result["references"]),
                 p("Native runtime provenance", "Heading2"), p(result["native_version_provenance"], "ReportSmall"),
                 p("Complete original grid/source/profile/run and numeric records are included in report-model.json. "
                   "The package includes machine-readable quantities, changed assumptions, map figures and full "
                   "five-band diagnostic GeoTIFFs. Full editable Workspace export is available through Project transfer "
                   "after the report task completes."),
                 p("Report source binding", "Heading2"), p(model["source_binding"], "ReportSmall")])
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=(612, 792), leftMargin=40, rightMargin=40,
                                 topMargin=38, bottomMargin=40, title=result["title"],
                                 author=ATTRIBUTION, invariant=1)
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#444444"))
        canvas.drawString(40, 22, ATTRIBUTION + " · Structural study · " + result["id"][:16])
        canvas.drawRightString(572, 22, str(doc.page))
        canvas.restoreState()
    document.build(flow, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()


def _zip(directory, descriptors, manifest_descriptor):
    target = directory / "report-package.zip"
    pending = directory / ".report-package.zip.partial"
    pending.unlink(missing_ok=True)
    try:
        with zipfile.ZipFile(pending, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6,
                             allowZip64=True) as archive:
            members = [*descriptors.values(), manifest_descriptor]
            for item in sorted(members, key=lambda row: row["path"]):
                path = verify_file(directory, item)
                info = zipfile.ZipInfo(item["path"], date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = (zipfile.ZIP_STORED if path.suffix.lower() in (".png", ".tif", ".pdf")
                                      else zipfile.ZIP_DEFLATED)
                info.external_attr = 0o100644 << 16
                with path.open("rb") as source, archive.open(info, "w", force_zip64=True) as out:
                    shutil.copyfileobj(source, out, 1024 * 1024)
        with pending.open("rb") as stream:
            os.fsync(stream.fileno())
        os.replace(pending, target)
    finally:
        pending.unlink(missing_ok=True)
    return target


@verified_operation
def build(workspace, study, result):
    """Create or recover one complete report from the original immutable study result."""
    study_id = identifier(study["id"])
    directory = _directory(workspace, study_id)
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".report.lock", blocking=False):
        original = directory.parent / "result.json"
        result_hash = file_digest(original)
        if (result.get("id") != study_id or result.get("project_id") != workspace.project["id"]
                or canonical(read_json(original)) != canonical(result) or study.get("state") != "complete"):
            raise ValueError("Report requires this completed study's original immutable native result")
        if (directory / "report.json").exists():
            return read(workspace, study_id, result_sha256=result_hash)
        binding = {"schema": SCHEMA, "edition": EDITION, "project_id": workspace.project["id"],
                   "study_id": study_id, "result_sha256": result_hash,
                   "plan_sha256": file_digest(directory.parent / "plan.json"),
                   "renderer": _implementation()}
        intent_path = directory / "intent.json"
        if intent_path.exists():
            intent = read_json(intent_path)
            if canonical(intent["source_binding"]) != canonical(binding):
                raise ValueError("Resume this unfinished report with its retained result and renderer edition")
        else:
            intent = {"schema": SCHEMA, "id": digest(binding), "created_at": now(), "source_binding": binding}
            atomic_json(intent_path, intent, immutable=True)
        files, figures = {}, {}
        def register(key, path, title, media_type):
            files[key] = describe_file(directory, path, title=title, media_type=media_type)
        for case in result["cases"]:
            if not isinstance(case["id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", case["id"]):
                raise ValueError("Select the original structural case ID")
            for pollutant in result["pollutants"]:
                if pollutant not in LABELS:
                    raise ValueError("Unknown original native pollutant")
                comparison = case["comparisons"][pollutant]
                key = case["id"] + "__" + pollutant
                diagnostic_path = "gis/" + key + ".tif"
                source = _retain_diagnostic(workspace, directory, comparison["diagnostic_file"], diagnostic_path)
                register("diagnostic__" + key, source, case["label"] + " — " + LABELS[pollutant]
                         + " complete five-band diagnostic", "image/tiff; application=geotiff")
                figure_path = "figures/" + key + ".png"
                display = _figure(source, directory / figure_path, comparison, case["label"], pollutant)
                footprint_path = "figures/" + key + "__footprints.png"
                footprint = _footprints(workspace, result["reference"]["run"], case["run"], pollutant,
                                        directory / footprint_path)
                register("footprint__" + key, directory / footprint_path,
                         case["label"] + " — " + LABELS[pollutant] + " original footprints", "image/png")
                figures[key] = {**display, "footprint_path": footprint_path, "footprint": footprint, "path": figure_path, "diagnostic_path": diagnostic_path,
                                "title": case["label"] + " — " + LABELS[pollutant]}
                register("figure__" + key, directory / figure_path, figures[key]["title"], "image/png")
        model = {"schema": SCHEMA, "attribution": ATTRIBUTION, "edition": EDITION, "id": intent["id"], "created_at": intent["created_at"],
                 "source_binding": binding, "summary": _summary(result), "result": result, "figures": figures,
                 "display_policy": "Six significant digits in human tables; original numeric precision in CSV and JSON"}
        atomic_json(directory / "report-model.json", model)
        register("report_model", directory / "report-model.json", "Complete scientific report model", "application/json")
        rows = _quantity_rows(result)
        headers = list(rows[0]) if rows else ["case_id", "pollutant", "side"]
        atomic_bytes(directory / "quantities.csv", _csv_bytes(headers, [[row[key] for key in headers] for row in rows]))
        register("quantities_csv", directory / "quantities.csv", "Own/shared/omitted mass and area", "text/csv")
        change_headers = ["case_id", "case_label", "field", "reference", "case", "meaning"]
        changes = [[case["id"], case["label"], row["field"], row["reference"], row["case"], row["meaning"]]
                   for case in result["cases"] for row in case["changes"]]
        atomic_bytes(directory / "changes.csv", _csv_bytes(change_headers, changes))
        register("changes_csv", directory / "changes.csv", "Changed assumptions and sources", "text/csv")
        atomic_bytes(directory / "report.html", _report_html(model, directory))
        register("html", directory / "report.html", "Structural sensitivity report", "text/html")
        atomic_bytes(directory / "report.md", _markdown(model))
        register("markdown", directory / "report.md", "Structural sensitivity report (Markdown)", "text/markdown")
        atomic_bytes(directory / "report.pdf", _pdf(model, directory))
        register("pdf", directory / "report.pdf", "Structural sensitivity report (PDF)", "application/pdf")
        manifest = {"schema": "upstate.structural-report-package/v1", "attribution": ATTRIBUTION, "id": intent["id"],
                    "project_id": workspace.project["id"], "study_id": study_id,
                    "created_at": intent["created_at"], "source_binding": binding,
                    "scope": "Human report, original result/source metadata, tables, figures and full comparison GIS",
                    "editable_project": "Export the entire Workspace through Project transfer after this report completes",
                    "members": sorted(files.values(), key=lambda value: value["path"])}
        atomic_json(directory / "package-manifest.json", manifest)
        package_manifest = describe_file(directory, directory / "package-manifest.json",
                                         title="Report package inventory", media_type="application/json")
        package = _zip(directory, files, package_manifest)
        files["package_manifest"] = package_manifest
        register("package_zip", package, "Complete human report and diagnostic GIS", "application/zip")
        receipt = {"schema": SCHEMA, "attribution": ATTRIBUTION, "id": intent["id"], "edition": EDITION,
                   "project_id": workspace.project["id"], "study_id": study_id,
                   "result_sha256": result_hash, "title": result["title"], "family": result["family"],
                   "created_at": intent["created_at"], "completed_at": now(), "source_binding": binding,
                   "summary": model["summary"], "files": files}
        # Recheck the original result and every output before the immutable finish.
        if file_digest(original) != result_hash:
            raise ValueError("Original structural result changed while rendering")
        for descriptor in files.values():
            verify_file(directory, descriptor)
        atomic_json(directory / "report.json", receipt, immutable=True)
        return read(workspace, study_id, result_sha256=result_hash)
