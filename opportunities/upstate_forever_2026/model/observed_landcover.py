"""Selected original HUC Annual NLCD comparisons and scientific-report sources.

Uses completed native cell counts; never resamples rasters or allocates model outputs.
"""
from __future__ import annotations
from copy import deepcopy
import csv
import html
import io
import json
import math
from pathlib import Path, PurePosixPath
import re

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, held, identifier, read_json, verify_file)
from .reuse import copy_verified
from . import observed_context
from . import observed_landcover_report

KIND = "observed-landcover-selections"
SCHEMA = "upstate.observed-landcover-selection/v1"
EDITION = "original-huc-nlcd-selection/1"
INPUT_ROLE = "LANDCOVER_OBSERVED_CONTEXT"
RUN_SCHEMA = "upstate.original-landcover-analysis-run/v1"
ANNUAL_SCHEMA = "upstate.landcover-zonal-summary/v1"
TRANSITION_SCHEMA = "upstate.annual-landcover-transitions/v1"
PUBLISHED = Path(__file__).resolve().parent.parent / "observations/landcover_2023_2025/model-sources.json"
CLASS_SOURCE = "https://pubs.usgs.gov/fs/2025/3001/fs20253001.pdf"
CLASSES = {
    11: "Open water", 12: "Perennial ice/snow", 21: "Developed, open space",
    22: "Developed, low intensity", 23: "Developed, medium intensity",
    24: "Developed, high intensity", 31: "Barren land, rock/sand/clay",
    41: "Deciduous forest", 42: "Evergreen forest", 43: "Mixed forest",
    52: "Shrub/scrub", 71: "Grasslands/herbaceous", 81: "Pasture/hay",
    82: "Cultivated crops", 90: "Woody wetlands", 95: "Emergent herbaceous wetlands",
}
CODES = tuple(CLASSES)
SUPPORT = ("selected_cells", "paired_valid_cells", "valid_before_only_cells",
           "valid_after_only_cells", "both_nodata_cells", "stable_class_cells",
           "changed_class_cells")
INTERPRETATION = (
    "Annual product class transitions. A changed classification alone does not identify "
    "cause, timing within the interval, or classification accuracy. Areas use the original "
    "native-cell centre inclusion rule. These are categorical observations, not estimates "
    "of pollutant export or fractional polygon-overlap areas."
)


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _integer(value, label):
    _require(isinstance(value, int) and not isinstance(value, bool) and value >= 0,
             label + " must be an original nonnegative integer count")
    return value


def _near(value, expected, label):
    _require(isinstance(value, (int, float)) and not isinstance(value, bool)
             and math.isfinite(value) and math.isclose(value, expected, rel_tol=1e-10, abs_tol=1e-7),
             label + " differs from its original cell count and affine area")


def _relative(value):
    _require(isinstance(value, str) and "\\" not in value and "\0" not in value,
             "Use an original relative source member")
    p = PurePosixPath(value)
    _require(not p.is_absolute() and p.parts and ".." not in p.parts
             and p.as_posix() == value, "Original member is not a canonical relative path")
    return value


def _indexed(rows, key, label):
    _require(isinstance(rows, list), label + " needs its original rows")
    result = {}
    for row in rows:
        _require(isinstance(row, dict) and key in row, label + " has an incomplete row")
        value = row[key]
        _require(isinstance(value, (str, int)) and not isinstance(value, bool)
                 and value not in result, label + " has a duplicate or invalid identifier")
        result[value] = row
    return result


def _annual(row, area):
    selected = _integer(row["selected_cells"], "Annual selected cells")
    nodata = _integer(row["nodata_cells"], "Annual NoData cells")
    _require(nodata <= selected, "Annual NoData exceeds original selected support")
    classes = _indexed(row["classes"], "class_code", "Annual classes")
    _require(set(classes) == set(CODES), "Annual class inventory differs from the original sixteen classes")
    counts = {}
    for code, value in classes.items():
        counts[code] = _integer(value["cells"], "Annual class")
        _near(value["area_m2"], counts[code] * area, "Annual class square metres")
        _near(value["area_ha"], counts[code] * area / 10000, "Annual class hectares")
    _require(sum(counts.values()) + nodata == selected, "Annual class margins do not cover original support")
    _near(row["area_m2"], selected * area, "Annual selected square metres")
    _near(row["valid_area_m2"], (selected - nodata) * area, "Annual valid square metres")
    return counts


def _validate_row(row, before, after, area):
    values = {key: _integer(row[key], key) for key in SUPPORT}
    selected, paired = values["selected_cells"], values["paired_valid_cells"]
    _require(paired + values["valid_before_only_cells"] + values["valid_after_only_cells"]
             + values["both_nodata_cells"] == selected, "Original paired and missing-cell support does not close")
    _require(values["stable_class_cells"] + values["changed_class_cells"] == paired,
             "Stable and changed cells do not cover original paired support")
    a, b = _annual(before, area), _annual(after, area)
    _require(before["selected_cells"] == after["selected_cells"] == selected,
             "Annual and paired comparisons use different original cell selections")
    _require(before["nodata_cells"] == values["valid_after_only_cells"] + values["both_nodata_cells"]
             and after["nodata_cells"] == values["valid_before_only_cells"] + values["both_nodata_cells"],
             "Paired NoData does not match both independent annual inventories")
    matrix = {}
    for item in row["transitions"]:
        pair = (item.get("before_class"), item.get("after_class"))
        _require(pair[0] in CLASSES and pair[1] in CLASSES and pair not in matrix,
                 "Original transition pairs must occur once across all sixteen classes")
        matrix[pair] = _integer(item["cells"], "Transition cells")
        _near(item["area_ha"], matrix[pair] * area / 10000, "Transition hectares")
    _require(set(matrix) == {(x, y) for x in CODES for y in CODES},
             "Retain all 256 original transition pairs, including zero cells")
    _require(sum(matrix.values()) == paired and
             sum(matrix[x, x] for x in CODES) == values["stable_class_cells"],
             "Original directional matrix differs from paired/stable support")
    margins = _indexed(row["classes"], "class_code", "Paired classes")
    _require(set(margins) == set(CODES), "Paired class inventory differs")
    unmatched_before = unmatched_after = 0
    for code in CODES:
        left = sum(matrix[code, x] for x in CODES)
        right = sum(matrix[x, code] for x in CODES)
        value = margins[code]
        _require(value["before_cells"] == left and value["after_cells"] == right
                 and value["net_cells"] == right - left, "Original transition margins differ")
        _near(value["before_area_ha"], left * area / 10000, "Paired before hectares")
        _near(value["after_area_ha"], right * area / 10000, "Paired after hectares")
        _near(value["net_area_ha"], (right - left) * area / 10000, "Paired net hectares")
        _require(a[code] >= left and b[code] >= right, "Paired class support exceeds independent annual support")
        unmatched_before += a[code] - left
        unmatched_after += b[code] - right
    _require(unmatched_before == values["valid_before_only_cells"]
             and unmatched_after == values["valid_after_only_cells"],
             "Unmatched annual class margins do not equal the declared unpaired support")
    _near(row["paired_valid_area_ha"], paired * area / 10000, "Paired valid hectares")
    if paired:
        _near(row["changed_percent_of_paired_valid"], 100 * values["changed_class_cells"] / paired,
              "Changed percentage")
    else:
        _require(row["changed_percent_of_paired_valid"] is None, "Empty paired support must retain an unknown percentage")
    return matrix


def _source(workspace, collection, source_id):
    path, entry = workspace.source_file(collection["id"], source_id)
    _require(entry["kind"] in ("table", "document"), "Choose the original completed land-cover table documents")
    return read_json(path), {
        "source_collection_id": collection["id"], "source_id": source_id,
        "entry": deepcopy(entry), "path": path,
    }


def load_inputs(workspace, selection):
    """Read only the chosen complete native result family and its original identities."""
    _require(isinstance(selection, dict) and not set(selection) - {"source_collection_id", "analysis_source_id", "analysis_sha256", "title", "huc12s", "vintage"},
             "Select only the retained original analysis, title and HUC12 identifiers")
    collection = workspace._get("sources", identifier(selection.get("source_collection_id")))
    run_id = selection.get("analysis_source_id")
    _require(isinstance(run_id, str) and bool(run_id), "Select the original analysis-run source")
    run, original = _source(workspace, collection, run_id)
    _require(run.get("schema") == RUN_SCHEMA, "Choose the completed original Annual NLCD analysis-run document")
    expected = selection.get("analysis_sha256")
    if expected is not None:
        _require(expected == original["entry"]["body"]["sha256"], "The selected analysis source edition changed")
    transition_pair = run["rasters"]
    before_year, after_year = transition_pair["before"]["year"], transition_pair["after"]["year"]
    _require(isinstance(before_year, int) and isinstance(after_year, int) and before_year < after_year,
             "Original comparison needs two increasing annual product years")
    results = _indexed(run["results"], "path", "Original analysis results")
    names = [f"annual-{before_year}.json", f"annual-{after_year}.json",
             f"transitions-{before_year}-{after_year}.json"]
    documents, originals = [], [original]
    for name in names:
        declared = results.get(name)
        _require(isinstance(declared, dict), "Original analysis does not bind " + name)
        matches = [entry for entry in collection["entries"]
                   if entry["body"]["sha256"] == declared["sha256"]
                   and entry["body"]["bytes"] == declared["bytes"]]
        _require(len(matches) == 1, "Choose the unique retained original result for " + name)
        doc, source = _source(workspace, collection, matches[0]["id"])
        documents.append(doc)
        originals.append(source)
    before, after, transitions = documents
    _require(before.get("schema") == after.get("schema") == ANNUAL_SCHEMA
             and transitions.get("schema") == TRANSITION_SCHEMA, "Original land-cover result schemas differ")
    grid = run["grid"]
    _require(all(doc["grid"] == grid for doc in documents), "Completed annual results do not share one original grid")
    affine = grid["affine"]
    _require(len(affine) == 6 and all(isinstance(x, (int, float)) and math.isfinite(x) for x in affine),
             "Original grid needs its finite six-term affine transform")
    area = abs(affine[0] * affine[4] - affine[1] * affine[3])
    _require(area > 0, "Original native cells have no positive projected area")
    for doc in documents:
        _near(doc["method"]["cell_area_m2"], area, "Original method cell area")
        _require(doc["method"]["pixel_rule"] == transitions["method"]["pixel_rule"],
                 "Annual and transition results use different pixel attribution")
    _require(transitions["method"]["matrix_classes"] == list(CODES), "Original transition class ordering differs")
    domain_sha = run["source_domain_sha256"]
    _require(all(doc["metadata"]["domain_sha256"] == domain_sha for doc in documents),
             "Annual and transition results select different original reporting geometry")
    for side, annual in (("before", before), ("after", after)):
        raster = transition_pair[side]
        _require(transitions["metadata"][side] == raster and raster["epsg"] == 5070,
                 "Original transition raster bindings differ")
        _require(annual["metadata"]["year"] == raster["year"]
                 and annual["metadata"]["raster_sha256"] == raster["sha256"]
                 and annual["metadata"]["raster_bytes"] == raster["bytes"]
                 and annual["metadata"]["epsg"] == raster["epsg"]
                 and annual["metadata"]["nodata"] == raster["nodata"],
                 "Independent annual inventory binds a different original raster")
    a = _indexed(before["watersheds"], "huc12", "Original earlier watersheds")
    b = _indexed(after["watersheds"], "huc12", "Original later watersheds")
    paired = _indexed(transitions["watersheds"], "huc12", "Original paired watersheds")
    _require(set(a) == set(b) == set(paired) and paired, "Original watershed inventories differ")
    _require(transitions["domain"]["overlap_cells"] == before["domain"]["overlap_cells"]
             == after["domain"]["overlap_cells"] == 0,
             "Selected-HUC sums require the original analysis to have zero overlapping selected cells")
    matrices = {}
    for key, row in paired.items():
        _require(isinstance(key, str) and re.fullmatch(r"\d{12}", key), "Retain original twelve-character HUC12 identifiers")
        _require(row["properties"] == a[key]["properties"] == b[key]["properties"],
                 "Original watershed attributes differ between annual inventories")
        matrices[key] = _validate_row(row, a[key], b[key], area)
    for counter in SUPPORT:
        _require(sum(row[counter] for row in paired.values()) == transitions["domain"][counter],
                 "Original watershed support does not sum to the declared non-overlapping domain")
    domain_matrix = {(row["before_class"], row["after_class"]): row["cells"]
                     for row in transitions["domain"]["transitions"]}
    _require(len(transitions["domain"]["transitions"]) == 256 and
             set(domain_matrix) == {(x, y) for x in CODES for y in CODES},
             "Original domain directional matrix is incomplete")
    _require(all(sum(matrix[pair] for matrix in matrices.values()) == domain_matrix[pair]
                 for pair in domain_matrix), "Original watershed matrices differ from the domain union")
    binding = {
        "source_collection_id": collection["id"], "analysis_source_id": run_id,
        "analysis_sha256": original["entry"]["body"]["sha256"],
        "source_domain_sha256": domain_sha, "rasters": deepcopy(transition_pair),
        "inputs": [{"source_collection_id": item["source_collection_id"],
                    "source_id": item["source_id"], "entry": item["entry"]} for item in originals],
        "grid": deepcopy(grid), "coordinate_operation": deepcopy(run["coordinate_operation"]),
        "method": deepcopy(transitions["method"]), "original_huc_count": len(paired),
        "original_overlap_cells": 0,
    }
    return {"binding": binding, "originals": originals, "before": a, "after": b,
            "paired": paired, "matrices": matrices, "area": area}


def _aggregate(inputs, ids):
    paired = inputs["paired"]
    area_ha = inputs["area"] / 10000
    values = {key: sum(paired[huc][key] for huc in ids) for key in SUPPORT}
    matrix = {(x, y): sum(inputs["matrices"][huc][x, y] for huc in ids) for x in CODES for y in CODES}
    classes = []
    for code in CODES:
        before = sum(matrix[code, x] for x in CODES)
        after = sum(matrix[x, code] for x in CODES)
        stable = matrix[code, code]
        annual_before = sum(next(row["cells"] for row in inputs["before"][huc]["classes"]
                                 if row["class_code"] == code) for huc in ids)
        annual_after = sum(next(row["cells"] for row in inputs["after"][huc]["classes"]
                                if row["class_code"] == code) for huc in ids)
        counts = {"before_cells": before, "after_cells": after, "stable_cells": stable,
                  "gained_cells": after - stable, "lost_cells": before - stable, "net_cells": after - before,
                  "annual_before_cells": annual_before, "annual_after_cells": annual_after,
                  "before_only_cells": annual_before - before, "after_only_cells": annual_after - after}
        classes.append({"class_code": code, "label": CLASSES[code], **counts,
                        **{name[:-6] + "_ha": count * area_ha for name, count in counts.items()}})
    return {**values, "paired_valid_area_ha": values["paired_valid_cells"] * area_ha,
            "changed_area_ha": values["changed_class_cells"] * area_ha,
            "stable_area_ha": values["stable_class_cells"] * area_ha,
            "changed_percent_of_paired_valid": (100 * values["changed_class_cells"] / values["paired_valid_cells"]
                                               if values["paired_valid_cells"] else None),
            "classes": classes,
            "transitions": [{"before_class": x, "after_class": y, "cells": matrix[x, y],
                             "area_ha": matrix[x, y] * area_ha,
                             "percent_of_before_paired": (100 * matrix[x, y] / classes[CODES.index(x)]["before_cells"]
                                                          if classes[CODES.index(x)]["before_cells"] else None)}
                            for x in CODES for y in CODES]}


def summarize(inputs, selection):
    ids = selection.get("huc12s")
    _require(isinstance(ids, list) and ids and all(isinstance(x, str) for x in ids)
             and len(ids) == len(set(ids)) and set(ids) <= set(inputs["paired"]),
             "Select distinct original HUC12 identifiers from this analysis")
    title = selection.get("title") or "Selected watershed land-cover changes"
    _require(isinstance(title, str) and bool(title.strip()) and len(title.strip()) <= 240,
             "Name this selected watershed comparison in 240 characters or fewer")
    ids = sorted(ids)
    rows = [{"huc12": huc, "properties": deepcopy(inputs["paired"][huc]["properties"]),
             **_aggregate(inputs, [huc])} for huc in ids]
    return {"schema": SCHEMA, "edition": EDITION, "title": title.strip(),
            "selection": {"source_collection_id": inputs["binding"]["source_collection_id"],
                          "analysis_source_id": inputs["binding"]["analysis_source_id"],
                          "analysis_sha256": inputs["binding"]["analysis_sha256"], "huc12s": ids},
            "binding": deepcopy(inputs["binding"]), "classes": [{"code": c, "label": CLASSES[c]} for c in CODES],
            "class_label_source": CLASS_SOURCE, "interpretation": INTERPRETATION,
            "summary": _aggregate(inputs, ids), "watersheds": rows}


def preview(workspace, selection):
    inputs = load_inputs(workspace, selection)
    if "huc12s" in selection:
        return summarize(inputs, selection)
    return {"binding": inputs["binding"], "classes": [{"code": x, "label": CLASSES[x]} for x in CODES],
            "watersheds": [{"huc12": key, "properties": deepcopy(row["properties"]),
                            **{name: row[name] for name in SUPPORT},
                            "changed_percent_of_paired_valid": row["changed_percent_of_paired_valid"],
                            "paired_valid_area_ha": row["paired_valid_area_ha"]}
                           for key, row in inputs["paired"].items()]}


def catalog(workspace):
    candidates = []
    for collection in workspace.sources():
        for entry in collection["entries"]:
            filename = entry["body"].get("filename", "")
            if entry.get("role") == INPUT_ROLE and filename == "analysis-run.json":
                candidates.append({"source_collection_id": collection["id"], "analysis_source_id": entry["id"],
                                   "analysis_sha256": entry["body"]["sha256"], "title": collection["title"],
                                   "vintage": entry.get("vintage", "")})
    return {"sources": candidates, "selections": overview(workspace),
            "published_source_available": PUBLISHED.is_file()}


def import_published(workspace):
    _require(PUBLISHED.is_file(), "The installed application does not contain the original completed land-cover sources")
    value = read_json(PUBLISHED)
    _require(value.get("schema") == "upstate.sources/v1", "Published land-cover source manifest differs")
    collection = workspace.import_sources(PUBLISHED)
    entries = [entry for entry in collection["entries"] if entry.get("role") == INPUT_ROLE
               and entry["body"]["filename"] == "analysis-run.json"]
    _require(len(entries) == 1, "Published sources need their unique original analysis-run document")
    choice = {"source_collection_id": collection["id"], "analysis_source_id": entries[0]["id"],
              "analysis_sha256": entries[0]["body"]["sha256"]}
    load_inputs(workspace, choice)
    return choice


def _csv(columns, rows):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        # Prefix formula-like string cells for spreadsheet opening; exact originals remain in JSON.
        writer.writerow([("'" + value) if isinstance(value, str) and value.startswith(("=", "+", "-", "@"))
                         else value for value in row])
    return stream.getvalue().encode("utf-8")


def _table(columns, rows):
    return {"kind": "table", "columns": columns,
            "rows": [["Not available" if value is None else str(value) for value in row] for row in rows]}


def report_sections(report):
    years = report["binding"]["rasters"]
    summary = report["summary"]
    support = [[name.replace("_", " "), summary[name]] for name in SUPPORT]
    areas = [[row["huc12"], row["properties"].get("name", ""), row["paired_valid_cells"],
              row["changed_class_cells"], row["changed_percent_of_paired_valid"],
              row["valid_before_only_cells"], row["valid_after_only_cells"], row["both_nodata_cells"]]
             for row in report["watersheds"]]
    return [
        ["Selected watershed annual land-cover changes", [report["interpretation"],
         "Original product years: " + str(years["before"]["year"]) + " to " + str(years["after"]["year"]) + ".",
         "Selected HUC12s: " + ", ".join(report["selection"]["huc12s"]) + ".",
         _table(["Original native support", "Cells"], support),
         ("Changed share of paired-valid cells: " + str(summary["changed_percent_of_paired_valid"]) + "%."
          if summary["paired_valid_cells"] else "Changed share is unavailable: there are zero paired-valid cells.") +
         " Denominator: " + str(summary["paired_valid_cells"]) + " paired-valid cells. Cell area is " +
         str(report["binding"]["method"]["cell_area_m2"]) + " square metres.",
         "Selected non-overlapping watershed counts are added before percentages are computed. "
         "The selection keeps cells valid in only one year separate from the paired directional matrix."]],
        ["Each selected original watershed", [_table(
            ["HUC12", "Original name", "Paired-valid cells", "Changed cells", "Changed (%)",
             "Earlier-only valid", "Later-only valid", "Both NoData"], areas)]],
        ["Directional class gains and losses on paired support", [_table(
            ["Class", "Description", "Earlier (ha)", "Later (ha)", "Gained (ha)", "Lost (ha)", "Net (ha)"],
            [[row["class_code"], row["label"], row["before_ha"], row["after_ha"],
              row["gained_ha"], row["lost_ha"], row["net_ha"]] for row in summary["classes"]]),
         "Gains and losses exclude the unchanged diagonal. Net equals later minus earlier; "
         "independent annual class inventories, including unpaired valid cells, remain in the attached tables."]],
        ["Complete directional matrix (cells)", [_table(
            ["Earlier class / later class"] + [str(code) for code in CODES],
            [[str(x) + " " + CLASSES[x]] + [next(row["cells"] for row in summary["transitions"]
                                                     if row["before_class"] == x and row["after_class"] == y)
                                            for y in CODES] for x in CODES])]],
        ["Original method and reusable data", [
            report["binding"]["method"]["pixel_rule"],
            "Raster coordinate system: EPSG:5070. Original boundary and raster hashes, affine grid, "
            "coordinate operation and source entries are retained in selection.json and original-inputs.json.",
            "Class labels: " + CLASS_SOURCE,
            {"kind": "links", "items": [
                {"title": title, "path": path} for title, path in (
                    ("Complete selected comparison", "selection.json"),
                    ("Every selected HUC transition", "huc-transitions.csv"),
                    ("Independent annual and paired class margins", "huc-classes.csv"),
                    ("Original support and watershed attributes", "huc-summary.csv"),
                    ("Full selected directional matrix", "selected-transitions.csv"),
                    ("Complete union and watershed group values", "landcover-groups.csv"),
                    ("Original group values and support", observed_landcover_report.DATA),
                    ("Retained group figure specification", observed_landcover_report.SPEC),
                    ("Original source bindings", "original-inputs.json"),
                    ("Readable offline report", "report.html"),
                )]},
        ]],
    ]


def _html(report, figure_product=None):
    def escaped(value):
        return html.escape("Not available" if value is None else str(value), quote=True)
    chunks = ['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
              "<title>" + escaped(report["title"]) + "</title>",
              "<style>body{font:16px system-ui;max-width:1200px;margin:32px auto;padding:0 24px;color:#202020;background:#fff}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{border:1px solid #ccc;padding:8px;text-align:right}th:first-child,td:first-child{text-align:left}section{margin:28px 0}.scroll{overflow:auto}.scroll:focus{outline:2px solid #333;outline-offset:3px}h1{font-size:28px}a{color:inherit;overflow-wrap:anywhere}li a{display:inline-block;min-height:28px;padding:8px 0}p{line-height:1.5}figure{margin:24px 0}figure svg{display:block;width:100%;min-width:840px;height:auto}figcaption{line-height:1.5;margin:12px 0}caption{text-align:left;padding:8px 0}table th{font-weight:600}@media(max-width:700px){body{margin:16px auto;padding:0 12px}h1{font-size:24px}table{min-width:620px}}@media print{body{max-width:none;padding:0;margin:0;font-size:10pt}.scroll{overflow:visible}figure svg{min-width:0;width:100%;break-inside:avoid}thead{display:table-header-group}th,td{padding:4px;overflow-wrap:anywhere}table{min-width:0;font-size:8pt}h2,h3{break-after:avoid}}</style>",
              "<h1>" + escaped(report["title"]) + "</h1>",
              "<p>" + escaped(report["interpretation"]) + "</p>",
              "<p>Figures are embedded in this file. Extract selected-huc-landcover.zip to use every linked original data file.</p>"]
    def table(block):
        return ('<div class="scroll" tabindex="0" role="region" aria-label="Original data table; scroll horizontally"><table>' +
                ("<caption>" + escaped(block["caption"]) + "</caption>" if block.get("caption") else "") +
                "<thead><tr>" + "".join('<th scope="col">' + escaped(x) + "</th>" for x in block["columns"]) +
                "</tr></thead><tbody>" + "".join("<tr>" + "".join(
                    ("<th scope=\"row\">" + escaped(x) + "</th>") if index == 0 else "<td>" + escaped(x) + "</td>"
                    for index, x in enumerate(row)) + "</tr>" for row in block["rows"]) + "</tbody></table></div>")
    if figure_product:
        indexed = {row["id"]: row for row in figure_product["spec"]["figures"]}
        chunks.append("<section><h2>Selected watershed group figures</h2>")
        for choice in figure_product["figures"]:
            figure = indexed[choice["id"]]
            chunks.append("<figure><h3>" + escaped(figure["title"]) + "</h3>" +
                '<div class="scroll" tabindex="0" role="region" aria-label="Original group figure; scroll horizontally">' +
                '<div role="img" aria-label="' + escaped(figure["caption"]) + '">' +
                "<svg" + figure_product["svg"][choice["id"]].split("<svg", 1)[1] + "</div></div>" +
                "<figcaption>" + escaped(figure["caption"]) + "</figcaption></figure>")
            chunks.extend(table(block) for block in figure.get("detail_tables", []))
        chunks.append("</section>")
    for heading, blocks in report_sections(report):
        chunks.append("<section><h2>" + escaped(heading) + "</h2>")
        for block in blocks:
            if isinstance(block, str):
                chunks.append("<p>" + escaped(block) + "</p>")
            elif block["kind"] == "table":
                chunks.append(table(block))
            else:
                chunks.append("<ul>" + "".join('<li><a href="' + escaped(x["path"]) + '">' +
                              escaped(x["title"]) + "</a></li>" for x in block["items"]) + "</ul>")
        chunks.append("</section>")
    return ("\n".join(chunks) + "</html>\n").encode("utf-8")


def _write_outputs(directory, report, report_implementation):
    atomic_json(directory / "selection.json", report, immutable=True)
    atomic_json(directory / "original-inputs.json", report["binding"], immutable=True)
    figure_product = observed_landcover_report.prepare(directory, report, report_implementation)
    atomic_bytes(directory / "report.html", _html(report, figure_product), immutable=True)
    rows = report["watersheds"]
    atomic_bytes(directory / "huc-summary.csv", _csv(
        ["huc12", "name", "states", *SUPPORT, "paired_valid_area_ha", "changed_area_ha",
         "changed_percent_of_paired_valid", "original_properties_json"],
        [[row["huc12"], row["properties"].get("name", ""), row["properties"].get("states", ""),
          *[row[key] for key in SUPPORT], row["paired_valid_area_ha"], row["changed_area_ha"],
          row["changed_percent_of_paired_valid"], canonical(row["properties"]).decode("utf-8")] for row in rows]), immutable=True)
    class_fields = list(report["summary"]["classes"][0])
    atomic_bytes(directory / "huc-classes.csv", _csv(["huc12", *class_fields],
        [[row["huc12"], *[item[key] for key in class_fields]] for row in rows for item in row["classes"]]), immutable=True)
    transition_fields = list(report["summary"]["transitions"][0])
    atomic_bytes(directory / "huc-transitions.csv", _csv(["huc12", *transition_fields],
        [[row["huc12"], *[item[key] for key in transition_fields]] for row in rows for item in row["transitions"]]), immutable=True)
    atomic_bytes(directory / "selected-transitions.csv", _csv(transition_fields,
        [[item[key] for key in transition_fields] for item in report["summary"]["transitions"]]), immutable=True)
    files = {name: describe_file(directory, directory / name) for name in
            ("selection.json", "original-inputs.json", "report.html", "huc-summary.csv",
             "huc-classes.csv", "huc-transitions.csv", "selected-transitions.csv")}
    files.update(figure_product["files"])
    return files, figure_product


def build(workspace, selection):
    inputs = load_inputs(workspace, selection)
    report = summarize(inputs, selection)
    report_implementation = observed_landcover_report.implementation()
    identity = {"edition": EDITION, "producer_sha256": file_digest(__file__),
                "report_implementation": report_implementation,
                "project_id": workspace.project["id"], "title": report["title"],
                "selection": report["selection"], "binding": report["binding"]}
    key = digest(identity)
    directory = workspace.root / KIND / key
    with held(directory / ".build.lock", blocking=False):
        if (directory / "receipt.json").exists():
            return inspect(workspace, key)["edition"]
        files, figure_product = _write_outputs(directory, report, report_implementation)
        for index, original in enumerate(inputs["originals"]):
            for body in [original["entry"]["body"], *original["entry"].get("companions", [])]:
                name = "originals/" + str(index) + "/" + _relative(body.get("view_path", body["filename"]))
                _require(name not in files, "Original input member paths collide")
                copied = copy_verified(workspace.root,
                    {"path": body["object"], "bytes": body["bytes"], "sha256": body["sha256"]},
                    directory, path=name)
                files[name] = describe_file(directory, directory / copied["path"])
        recipe = {"schema": observed_context.SCHEMA, "edition": EDITION, "title": report["title"],
                  "origin": {"kind": KIND, "id": key, "project_id": workspace.project["id"],
                             "huc12s": report["selection"]["huc12s"],
                             "area_method": "original_native_cell_centre"},
                  "inputs": [files[name] for name in sorted(files)],
                  "sections": report_sections(report),
                  "figure_spec": figure_product["figure_spec"], "figures": figure_product["figures"],
                  "source_links": sorted(name for name in files if name.startswith("originals/"))}
        atomic_json(directory / "observed-report.json", recipe, immutable=True)
        recipe_file = describe_file(directory, directory / "observed-report.json")
        source_id = "selected-huc-landcover-" + key
        years = report["binding"]["rasters"]
        manifest = {"schema": "upstate.sources/v1", "title": report["title"],
                    "scope": {"selected_huc12s": report["selection"]["huc12s"], "method": recipe["origin"]["area_method"]},
                    "entries": [{"id": source_id, "kind": "document", "role": observed_context.ROLE,
                                 "title": report["title"], "uri": "workspace://" + workspace.project["id"] + "/" + KIND + "/" + key,
                                 "vintage": "Original Annual NLCD " + str(years["before"]["year"]) + " to " + str(years["after"]["year"]),
                                 **recipe_file, "companions": [files[name] for name in sorted(files)],
                                 "metadata": {"origin": recipe["origin"], "source_kind": KIND}}]}
        atomic_json(directory / "sources.json", manifest, immutable=True)
        files["observed-report.json"] = recipe_file
        files["sources.json"] = describe_file(directory, directory / "sources.json")
        from .landcover_report_source import _write_bundle
        _write_bundle(directory, files, directory / "selected-huc-landcover.zip")
        files["selected-huc-landcover.zip"] = describe_file(directory, directory / "selected-huc-landcover.zip")
        collection = workspace.import_sources(directory / "sources.json")
        source = {"source_collection_id": collection["id"], "source_id": source_id}
        bound = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: source}})
        receipt = {"schema": SCHEMA, "id": key, "state": "complete", "title": report["title"],
                   "project_id": workspace.project["id"], "identity": identity,
                   "huc12s": report["selection"]["huc12s"], "summary": report["summary"],
                   "source": source, "observed_binding": bound,
                   "files": {name: describe_file(workspace.root, directory / item["path"]) for name, item in files.items()}}
        atomic_json(directory / "receipt.json", receipt, immutable=True)
        return receipt


def _receipt(workspace, path):
    value = read_json(path)
    _require(value.get("schema") == SCHEMA and value.get("state") == "complete"
             and value.get("project_id") == workspace.project["id"]
             and path.parent.name == value.get("id") == digest(value.get("identity"))
             and value.get("title") == value["identity"].get("title")
             and value.get("huc12s") == value["identity"].get("selection", {}).get("huc12s"),
             "Original selected-HUC comparison identity differs")
    return value


def overview(workspace):
    return [{**{name: row[name] for name in ("id", "title", "huc12s", "source")},
             "summary": {name: row["summary"][name] for name in (*SUPPORT, "paired_valid_area_ha",
                         "changed_area_ha", "changed_percent_of_paired_valid")}}
            for row in (_receipt(workspace, path) for path in sorted((workspace.root / KIND).glob("*/receipt.json")))]


def inspect(workspace, key):
    directory = workspace.root / KIND / identifier(key)
    receipt = _receipt(workspace, directory / "receipt.json")
    for item in receipt["files"].values():
        verify_file(workspace.root, item)
    report = read_json(verify_file(workspace.root, receipt["files"]["selection.json"]))
    _require(report["binding"] == receipt["identity"]["binding"]
             and report["selection"] == receipt["identity"]["selection"]
             and report["summary"] == receipt["summary"], "Saved selected report differs from its original identity")
    source_path, entry = workspace.source_file(receipt["source"]["source_collection_id"], receipt["source"]["source_id"])
    recipe_file = receipt["files"]["observed-report.json"]
    _require(entry.get("role") == observed_context.ROLE
             and entry["body"]["sha256"] == recipe_file["sha256"]
             and entry["body"]["bytes"] == recipe_file["bytes"], "Retained report recipe source differs")
    recipe = read_json(source_path)
    _require(recipe.get("origin", {}).get("id") == key
             and recipe.get("origin", {}).get("project_id") == workspace.project["id"],
             "Retained report recipe belongs to another original selection")
    expected_members = {name: row for name, row in receipt["files"].items()
                        if name not in ("observed-report.json", "sources.json", "selected-huc-landcover.zip")}
    actual_members = {body.get("view_path", body["filename"]): body for body in entry.get("companions", [])}
    _require(len(actual_members) == len(entry.get("companions", []))
             and set(actual_members) == set(expected_members)
             and all(actual_members[name]["sha256"] == row["sha256"]
                     and actual_members[name]["bytes"] == row["bytes"]
                     for name, row in expected_members.items()), "Original report companion membership differs")
    current = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: receipt["source"]}})
    _require(current == receipt["observed_binding"], "Original selected-HUC report source changed")
    return {"edition": receipt, "report": report}


def verify_all(workspace):
    for row in overview(workspace):
        inspect(workspace, row["id"])
