"""One retained review package for a completed calibration and chosen supplements.

No model run or parameter selection is performed here. The nominal report, its
original observations, and each explicitly selected supplement remain immutable.
"""
from __future__ import annotations

import argparse
import base64
import csv
import html
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import tempfile
from urllib.parse import quote
import zipfile

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     held, identifier, read_json, verify_file)
from . import calibration_uncertainty as uncertainty
from . import calibration_maps as maps
from . import observation_support

VERSION = 1
PRESENTATION_EDITION = "native-execution-reference-basis-v2"
KIND = "calibration-reviews"
DIRECTORY = "calibration-review-exports"
STYLE = """
:root{font-family:Arial,Helvetica,sans-serif;color:#202020;background:white;line-height:1.5}
body{max-width:1220px;margin:auto;padding:32px}h1{font-size:32px;line-height:1.15;max-width:900px}
h2{font-size:23px;margin-top:0}h3{font-size:17px}p{max-width:100ch}
a{color:inherit;text-decoration:underline;text-underline-offset:3px}
header{border-bottom:3px solid #222;padding-bottom:24px}.eyebrow{font-size:11px;letter-spacing:.1em}
nav{display:flex;gap:16px;flex-wrap:wrap;padding:20px 0;border-bottom:1px solid #aaa}
section{padding:28px 0;border-bottom:1px solid #aaa}.cards,.plots{display:grid;gap:18px;
grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}.card{border:1px solid #bbb;padding:16px}
.card strong{display:block;font-size:22px;line-height:1.3;overflow-wrap:anywhere}
small,.muted{color:#555}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}
td,th{padding:9px;text-align:left;vertical-align:top;border-bottom:1px solid #ddd}
th{background:#eee;position:sticky;top:0}td{font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
pre,.ids{white-space:pre-wrap;overflow-wrap:anywhere;font:11px ui-monospace,monospace}
figure{margin:16px 0}svg{width:100%;height:auto}figcaption{font-size:12px}img.atlas{width:100%}
details{margin-top:16px}summary{cursor:pointer;font-weight:bold}.callout{border-left:3px solid #333;padding:8px 16px}
.notes{white-space:pre-wrap}.metric{font-variant-numeric:tabular-nums}
@media print{body{padding:0;font-size:10pt;max-width:none}nav{display:none}h1{font-size:24pt}
section{break-before:auto}h2,h3,summary{break-after:avoid}figure,.card{break-inside:avoid}
.scroll{overflow:visible}table{font-size:8pt}thead{display:table-header-group}th{position:static}
a{color:#222}.cards{grid-template-columns:repeat(3,1fr)}details{display:block}}
"""
RANK_FIELDS = ("rank", "title", "selected_models", "profile_id", "run_id", "objective_score")
METRIC_FIELDS = ("partition", "run_id", "parameter", "units", "spatial_groups",
                 "catchments", "rmse", "mean_bias", "percent_bias",
                 "nash_sutcliffe_efficiency", "group_weighted_rmse", "normalized_mse")
REFERENCE_FIELDS = ("unit_id", "partition", "catchment_id", "group_id", "parameter", "units",
                    "observed_annual_mass", "native_annual_mass", "delivered_external_annual_mass",
                    "predicted_annual_mass", "residual", "included", "issues")
PAIR_FIELDS = ("title", "run_id", "nominal_gap", "minimum_gap", "maximum_gap", "state",
               "numerical_tolerance", "first_tie_standard_errors", "first_tie_state",
               "missing_record_ids")
SENSITIVITY = {
    "strictly_stable": "The original selection stays strictly preferred within the declared source ranges.",
    "tie_possible": "A tie with the original selection is possible within the declared source ranges.",
    "rank_reversal_possible": "A challenger can outperform the original selection within the declared source ranges.",
    "incomplete_uncertainty": "Missing published errors leave one or more comparisons unresolved.",
    "single_candidate": "One candidate is retained, so there is no challenger ranking comparison.",
}


def _name(value):
    name = str(value)
    path = PurePosixPath(name)
    if (not name or path.is_absolute() or ".." in path.parts or "\\" in name or "\0" in name
            or path.as_posix() != name or name in {".", ""}):
        raise ValueError("Choose a relative retained review member")
    return name


def _text(value):
    if value is None:
        return "—"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    if isinstance(value, float):
        return format(value, ".9g")
    return str(value)


def _escape(value):
    return html.escape(_text(value), quote=True)


def _csv(fields, rows):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        cells = {}
        for field in fields:
            value = row.get(field)
            text = "" if value is None else _text(value)
            # Preserve numeric negatives; protect only original textual formulas.
            if isinstance(value, str) and text.lstrip().startswith(("=", "+", "-", "@")):
                text = "'" + text
            cells[field] = text
        writer.writerow(cells)
    return stream.getvalue().encode("utf-8")


def _table(fields, rows):
    if not rows:
        return '<p class="muted">No rows in this retained selection.</p>'
    return ('<div class="scroll"><table><thead><tr>' +
            "".join("<th>" + _escape(key.replace("_", " ")) + "</th>" for key in fields) +
            "</tr></thead><tbody>" +
            "".join("<tr>" + "".join("<td>" + _escape(row.get(key)) + "</td>" for key in fields) +
                    "</tr>" for row in rows) + "</tbody></table></div>")


def _section(key, title, content):
    return '<section id="' + key + '"><h2>' + _escape(title) + "</h2>" + content + "</section>"


def _link(name, label):
    return '<a href="' + html.escape(quote(_name(name), safe="/"), quote=True) + '">' + _escape(label) + "</a>"


def _copy(root, source, target, expected):
    """Stream original bytes into an immutable independent package member."""
    name = _name(target)
    destination = root / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    check = {"path": name, "bytes": expected["bytes"], "sha256": expected["sha256"]}
    if destination.exists():
        verify_file(root, check)
        return check
    temporary = None
    try:
        with source.open("rb") as stream, tempfile.NamedTemporaryFile(
                dir=destination.parent, prefix=".review-copy-", delete=False) as out:
            temporary = Path(out.name)
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                out.write(block)
            out.flush()
            os.fsync(out.fileno())
        verify_file(temporary.parent, {**check, "path": temporary.name})
        try:
            os.link(temporary, destination)
        except FileExistsError:
            verify_file(root, check)
        verify_file(root, check)
        return check
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _basis(workspace, calibration_id, uncertainty_id, map_id):
    report, plan, observed = uncertainty._retained(workspace, identifier(calibration_id))
    detail = uncertainty.inspect(workspace, identifier(uncertainty_id)) if uncertainty_id else None
    atlas = maps.inspect(workspace, identifier(map_id)) if map_id else None
    for value in (detail, atlas):
        if value and value["calibration_id"] != report["id"]:
            raise ValueError("Every review supplement must belong to this exact calibration")
    if atlas and atlas.get("uncertainty_id") and (
            not detail or atlas["uncertainty_id"] != detail["id"]):
        raise ValueError("Include the exact source-error edition used by the chosen maps")
    selected = plan["selection"]["catchments"]
    _, entry = workspace.source_file(selected["source_collection_id"], selected["source_id"])
    if entry["body"]["sha256"] != plan["spatial_groups"]["source"]["sha256"]:
        raise ValueError("The original catchment source differs from the calibration plan")
    stamp = {"science": uncertainty._source_stamp(report, plan, observed),
             "calibration_sha256": digest(report), "plan_sha256": digest(plan),
             "observation_sha256": digest(observed), "catchment_entry_sha256": digest(entry),
             "uncertainty_sha256": digest(detail) if detail else None,
             "map_sha256": digest(atlas) if atlas else None}
    return report, plan, observed, detail, atlas, entry, stamp


NATIVE_EXECUTION_FIELDS = ("run_id", "profile_id", "model", "parameter", "output",
                           "comparison_version", "basis", "version_label",
                           "requested_version", "observed_stage_version", "observed_run_version",
                           "raster_units", "annual_units", "reduction", "unit_basis",
                           "stage_completed_at", "reused_from", "source_guide",
                           "export_sha256", "stream_sha256", "arguments_sha256")


def native_execution(report, plan):
    """Read the original execution snapshot without changing historical records."""
    value = report.get("native_execution") or plan.get("native_execution")
    if value is None:
        return {}
    if (not isinstance(value, dict)
            or value.get("schema") != "upstate.calibration-native-execution/v1"
            or not isinstance(value.get("rows"), list)):
        raise ValueError("Select the original calibration execution-provenance snapshot")
    return value


def _tables(report, plan, metadata=None):
    reference = {unit["id"]: unit for unit in report["reference_units"]}
    selected_rows = []
    for row in report["prediction_rows"]:
        if row["run_id"] == report["selected_run_id"]:
            unit = reference[row["unit_id"]]
            selected_rows.append({**unit, **row, "unit_id": unit["id"],
                                  "observed_annual_mass": unit["observed_annual_mass"]})
    metric_rows = []
    for candidate in report["ranked_candidates"]:
        for parameter, values in candidate["pollutant_metrics"].items():
            metric_rows.append({**values, "parameter": parameter, "partition": "calibration",
                                "run_id": candidate["run_id"], "profile_id": candidate["profile_id"]})
    for parameter, values in report["selected_validation"]["pollutant_metrics"].items():
        metric_rows.append({**values, "parameter": parameter, "partition": "validation",
                            "run_id": report["selected_run_id"], "profile_id": report["selected_profile_id"]})
    return {
        "reference-basis": (
            ("reference_id", "parameter", "catchment_id", "station_id", "observation_record_ids",
             "reference_label", "parameter_codes", "reference_status", "interpretation",
             "source_fields", "method_references"),
            observation_support.reference_basis_rows(report["reference_units"], metadata)),
        "candidate-ranking": (RANK_FIELDS, report["ranked_candidates"]),
        "native-execution": (NATIVE_EXECUTION_FIELDS, native_execution(report, plan).get("rows", [])),
        "physical-metrics": (METRIC_FIELDS, metric_rows),
        "selected-catchments": (REFERENCE_FIELDS, selected_rows),
        "candidate-predictions": (tuple(dict.fromkeys(
            ("run_id", "profile_id", "unit_id") +
            tuple(sorted({key for row in report["prediction_rows"] for key in row})))),
            report["prediction_rows"]),
        "reference-units": (tuple(sorted({key for row in report["reference_units"] for key in row})),
                            report["reference_units"]),
        "candidate-envelope": (tuple(sorted({key for row in report["candidate_envelope"] for key in row})),
                               report["candidate_envelope"]),
        "group-stability": (tuple(sorted({key for row in report["group_stability"].get("folds", []) for key in row})),
                            report["group_stability"].get("folds", [])),
        "candidate-failures": (tuple(sorted({key for row in report["candidate_failures"] for key in row})),
                              report["candidate_failures"]),
        "excluded-references": (tuple(sorted({key for row in report["excluded_reference_records"] for key in row})),
                                report["excluded_reference_records"]),
    }


def _scatter(rows, parameter, metadata=None):
    selected = [row for row in rows if row["parameter"] == parameter]
    usable = [row for row in selected if row.get("included") and
              all(isinstance(row.get(key), (int, float)) and math.isfinite(row[key])
                  for key in ("observed_annual_mass", "predicted_annual_mass"))]
    if not usable:
        return "<p>" + _escape(parameter) + ": no complete selected-model pairs.</p>"
    cap = max(max(row["observed_annual_mass"], row["predicted_annual_mass"]) for row in usable) or 1
    def x(value):
        return 54 + 280 * (value / cap)
    def y(value):
        return 314 - 280 * (value / cap)
    marks = []
    for row in usable:
        title = _escape({"catchment": row["catchment_id"], "partition": row["partition"],
                         "observed": row["observed_annual_mass"], "predicted": row["predicted_annual_mass"],
                         "units": row["units"]})
        px, py = x(row["observed_annual_mass"]), y(row["predicted_annual_mass"])
        if row["partition"] == "validation":
            marks.append(f'<rect x="{px-4:.3f}" y="{py-4:.3f}" width="8" height="8" fill="white" stroke="#222"><title>{title}</title></rect>')
        else:
            marks.append(f'<circle cx="{px:.3f}" cy="{py:.3f}" r="3.7" fill="#333"><title>{title}</title></circle>')
    svg = ('<svg viewBox="0 0 380 370" role="img" aria-label="' +
           _escape(parameter + " observed versus selected modeled load") +
           '"><path d="M54 34V314H334" fill="none" stroke="#555"/>'
           '<path d="M54 314L334 34" stroke="#888" stroke-dasharray="4 4"/>' +
           "".join(marks) + '<text x="54" y="333" font-size="11">0</text>'
           '<text x="334" y="333" text-anchor="end" font-size="11">' + _escape(cap) +
           '</text><text x="45" y="40" text-anchor="end" font-size="11">' + _escape(cap) +
           '</text><text x="192" y="358" text-anchor="middle" font-size="12">Observed annual load</text>'
           '<text x="15" y="176" transform="rotate(-90 15 176)" text-anchor="middle" font-size="12">'
           'Modeled annual load</text></svg>')
    return '<figure><h3>' + _escape(parameter.title()) + '</h3>' + svg + '<figcaption>' + _escape(
        usable[0]["units"]) + " · " + str(len(usable)) + " complete pairs; " + str(len(selected)-len(usable)) + \
        " incomplete pairs remain in the table. Filled circles: calibration. Open squares: held-out validation. " + \
        "Reference bases: " + _escape("; ".join(dict.fromkeys(
            observation_support.reference_basis(row, metadata)["label"] for row in selected))) + "</figcaption></figure>"


def _html(selection, report, plan, observed, detail, atlas, tables, directory, files):
    chosen = next(row for row in report["ranked_candidates"] if row["run_id"] == report["selected_run_id"])
    validation = report["selected_validation"]
    groups = plan["spatial_groups"]["groups"]
    calibration_groups = set(plan["selection"]["calibration_group_ids"])
    validation_groups = set(plan["selection"]["validation_group_ids"])
    cards = [("Selected profile", chosen["title"]), ("Nominal calibration loss", chosen["objective_score"]),
             ("Candidate runs", report.get("candidate_count", len(plan["candidates"]))),
             ("Distinct profiles", report.get("distinct_profile_count", len({row["profile_id"] for row in plan["candidates"]}))),
             ("Calibration groups", len(calibration_groups)), ("Held-out groups", len(validation_groups))]
    sections = []
    introduction = ('<div class="cards">' + "".join('<div class="card"><small>' + _escape(label) +
                    '</small><strong>' + _escape(value) + "</strong></div>" for label, value in cards) +
                    "</div><p>" + _escape(report["selection_method"]) + ".</p><p>" +
                    _escape(report["reference_interpretation"]) + "</p>")
    if selection["notes"]:
        introduction += '<h3>Review notes</h3><p class="notes">' + _escape(selection["notes"]) + "</p>"
    sections.append(_section("summary", "Selected model and review scope", introduction))
    objective = [{"parameter": key, "weight": value["weight"],
                  "normalization_scale": (report["normalization"].get(key, {}).get("value")
                      if isinstance(report["normalization"].get(key), dict) else report["normalization"].get(key)),
                  "normalization_basis": (report["normalization"].get(key, {}).get("basis")
                      if isinstance(report["normalization"].get(key), dict) else None),
                  "units": next((row["units"] for row in report["reference_units"] if row["parameter"] == key), None)}
                 for key, value in report["objective"].items()]
    sections.append(_section("design", "Original references and evaluation design",
        "<p>" + _escape(report["temporal_method"]) + "</p><h3>Declared objective</h3>" +
        _table(("parameter", "weight", "normalization_scale", "units", "normalization_basis"), objective) +
        "<h3>Catchment groups</h3>" + _table(("id", "partition", "catchment_ids", "station_ids", "observation_records"),
        [{**row, "partition": "validation" if row["id"] in validation_groups else "calibration"
          if row["id"] in calibration_groups else "unselected"} for row in groups]) +
        "<h3>Original constituent and analytical basis</h3>" +
        _table(("parameter", "catchment_id", "reference_label", "interpretation"),
               tables["reference-basis"][1]) +
        "<p>" + _link("tables/reference-basis.csv", "Complete original constituent and source-field CSV") +
        ". Existing annual values, admitted references and candidate scores retain their original identities.</p>" +
        "<details><summary>Original estimator, period, uncertainty and source metadata</summary><pre>" +
        _escape(observed["metadata"]) + "</pre></details>"))
    sections.append(_section("ranking", "Candidate selection",
        "<p>Lower calibration loss selects the original working candidate. Held-out values are excluded from this ranking.</p>" +
        _table(RANK_FIELDS, report["ranked_candidates"]) + "<p>" +
        _link("tables/candidate-ranking.csv", "Complete ranking CSV") + " · " +
        _link("tables/candidate-failures.csv", "All excluded candidate outcomes") + "</p>"))
    execution = native_execution(report, plan)
    execution_rows = tables["native-execution"][1]
    sections.append(_section("execution", "Native model versions and output quantities",
        ("<p>These are the original completed-model version sources and output-unit conventions "
         "retained with this calibration. Each parameter row names its original export, stream "
         "and arguments identities. The producing-stage version, observed run fallback and "
         "requested legacy declaration remain distinct.</p>" if execution else
         "<p>This historical calibration keeps its original native run records in the source inventory. "
         "It predates the retained per-output execution snapshot.</p>") +
        _table(("run_id", "model", "parameter", "version_label", "requested_version",
                "raster_units", "annual_units", "reduction"), execution_rows) +
        "<p>" + _link("tables/native-execution.csv", "Complete original execution and output-unit CSV") + "</p>" +
        ("<details><summary>Output identities, version sources and compatibility policy</summary><pre>" +
         _escape(execution) + "</pre></details>" if execution else "")))
    selected_metrics = [row for row in tables["physical-metrics"][1] if row["run_id"] == report["selected_run_id"]]
    sections.append(_section("validation", "Selected-model performance",
        "<p>Held-out assessment: <strong>" + _escape(validation["state"]) + "</strong>. " +
        ("Only the originally selected candidate is described on these reserved groups."
         if validation_groups else "All selected groups were used for calibration; there is no reserved group assessment.") +
        "</p>" + _table(METRIC_FIELDS, selected_metrics) +
        '<div class="plots">' + "".join(_scatter(tables["selected-catchments"][1], parameter, observed.get("metadata"))
                                         for parameter in report["objective"]) + "</div>" +
        "<details><summary>Complete held-out coverage and missing support</summary><pre>" + _escape(validation) +
        "</pre></details><p>" + _link("tables/physical-metrics.csv", "All candidate calibration metrics and selected-only validation") + "</p>"))
    stability = report["group_stability"]
    sections.append(_section("stability", "Spatial-group stability and candidate variation",
        "<p>" + _escape(stability.get("method", stability.get("state"))) + "</p>" +
        _table(("held_group_id", "state", "selected_run_id", "selected_profile_id", "training_objective_score"),
               stability.get("folds", [])) + "<p>" + _escape(report["envelope_meaning"]) + "</p><p>" +
        _link("tables/candidate-envelope.csv", "Complete retained candidate envelope") + " · " +
        _link("tables/group-stability.csv", "Full group stability rows") + "</p>"))
    if detail:
        coverage = detail["coverage"]
        sections.append(_section("uncertainty", "Published source-error sensitivity",
            "<p><strong>" + _escape(SENSITIVITY.get(detail["selection_sensitivity"]["state"],
                                                   detail["selection_sensitivity"]["state"])) +
            "</strong></p><p>Multiplier: " + _escape(detail["standard_errors"]) +
            " published standard errors. Published errors available for " +
            _escape(coverage["records_with_standard_error"]) + " of " + _escape(coverage["source_record_count"]) +
            " retained records; analysis state: " + _escape(detail["state"]) +
            ".</p><p>The gap is challenger loss minus original selected loss. Positive values favor the original "
            "selection. Weights, normalization and predictions stay fixed. These are marginal source ranges, "
            "not reversal probabilities or a replacement ranking.</p>" +
            _table(PAIR_FIELDS, detail["pairwise"]) +
            "<p>A missing first-tie value is explained by its retained first_tie_state. Exact cancellation or a "
            "zero multiplier may resolve a comparison even when a source standard error is absent.</p>"
            "<details><summary>Complete scientific interpretation and coverage</summary><pre>" +
            _escape({"interpretation": detail["interpretation"], "coverage": coverage,
                     "selected_validation": detail.get("selected_validation")}) + "</pre></details><p>" +
            _link("tables/source-error-pairs.csv", "All challenger comparisons") + " · " +
            _link("tables/source-error-records.csv", "Original error records") + "</p>"))
    else:
        sections.append(_section("uncertainty", "Published source-error sensitivity",
            "<p>This review selection includes the nominal calibration without a source-error supplement. "
            "The original observation uncertainty fields remain in the retained observation edition.</p>"))
    if atlas:
        content = "<p>" + _escape(atlas["interpretation"]) + "</p>"
        content += "<p>Map error edition: " + _escape(atlas.get("uncertainty_id") or "No error bands selected") + ".</p>"
        for layer in atlas["layers"]:
            links = [layer["pdf"], layer["csv"], layer["geojson"], *layer["svg_pages"]]
            content += "<h3>" + _escape(layer["title"]) + "</h3><p>" + _escape(layer["units"]) + \
                " · " + ("original selected model" if layer["run_id"] == report["selected_run_id"]
                          else "challenger, calibration catchments only") + " · absolute residual display cap " + \
                _escape(layer["absolute_residual_display_cap"]) + ".</p><p>" + " · ".join(
                    _link("maps/" + row["path"], Path(row["path"]).name) for row in links) + "</p>"
            if layer["svg_pages"]:
                first = layer["svg_pages"][0]
                data = verify_file(directory, files["maps/" + first["path"]]).read_bytes()
                content += '<figure><img class="atlas" alt="' + _escape(layer["title"]) + \
                    '" src="data:image/svg+xml;base64,' + base64.b64encode(data).decode("ascii") + \
                    '"><figcaption>First retained atlas page. All original pages and the complete PDF are linked above.</figcaption></figure>'
        sections.append(_section("maps", "Original catchment geography", content))
    else:
        sections.append(_section("maps", "Original catchment geography",
            "<p>This review selection includes original catchment source files without a rendered residual-map edition.</p>"))
    sections.append(_section("records", "Original selected-model catchment rows",
        "<p>Residual is adjusted modeled annual load minus the retained observed annual load. Native load and "
        "an explicitly selected external contribution remain separate. Incomplete native support remains visible.</p>" +
        _table(REFERENCE_FIELDS, tables["selected-catchments"][1]) + "<p>" +
        _link("tables/selected-catchments.csv", "Complete selected catchment CSV") + " · " +
        _link("tables/candidate-predictions.csv", "All original candidate prediction rows") + "</p>"))
    inventory = [{"member": name, "bytes": value["bytes"], "sha256": value["sha256"]}
                 for name, value in sorted(files.items())]
    sections.append(_section("sources", "Original sources and complete files",
        "<p>Every retained scientific record and copied source keeps its original byte identity. "
        "This package contains the analysis and its review inputs; the full native raster workspace remains "
        "available through the application's project transfer.</p><ul>" +
        "".join("<li>" + _link(name, name) + "</li>" for name in sorted(files)) + "</ul>" +
        "<details><summary>Member sizes and SHA-256 identities</summary>" +
        _table(("member", "bytes", "sha256"), inventory) + "</details><p>" +
        _link("manifest.json", "Complete package manifest") + "</p>"))
    navigation = "".join('<a href="#' + key + '">' + label + "</a>" for key, label in (
        ("summary", "Summary"), ("design", "Design"), ("ranking", "Selection"), ("execution", "Native outputs"),
        ("validation", "Performance"), ("stability", "Stability"), ("uncertainty", "Source errors"),
        ("maps", "Maps"), ("records", "Catchment rows"), ("sources", "Sources")))
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
            _escape(selection["title"]) + "</title><style>" + STYLE + "</style></head><body>"
            '<header><p class="eyebrow">UPPER SAVANNAH · CALIBRATION REVIEW</p><h1>' +
            _escape(selection["title"]) + "</h1><p>Original annual references, native parameter comparison, "
            "held-out evaluation and explicitly selected supplements.</p><p class=\"ids\">Calibration " +
            _escape(report["id"]) + "<br>Selected native run " + _escape(report["selected_run_id"]) +
            "</p></header><nav>" + navigation + "</nav>" + "".join(sections) +
            "<footer><p>Print this report using the browser's print command. Original data and complete machine-readable "
            "records remain linked throughout the package.</p></footer></body></html>").encode("utf-8")


def prepare(workspace, calibration_id, *, uncertainty_id=None, map_id=None, title=None, notes=""):
    report, plan, observed, detail, atlas, entry, stamp = _basis(workspace, calibration_id, uncertainty_id, map_id)
    title = (report["title"] + " — calibration review") if title is None else title
    if not isinstance(title, str) or not title.strip() or len(title) > 300:
        raise ValueError("Enter a review title of 1–300 characters")
    if not isinstance(notes, str) or len(notes) > 20000:
        raise ValueError("Review notes must contain at most 20,000 characters")
    selection = {"version": VERSION, "presentation_edition": PRESENTATION_EDITION,
                 "workspace_id": workspace.project["id"],
                 "calibration_id": report["id"], "plan_id": plan["id"],
                 "uncertainty_id": detail["id"] if detail else None, "map_id": atlas["id"] if atlas else None,
                 "title": title.strip(), "notes": notes, "source_stamp": stamp}
    selection_id = digest(selection)
    directory = workspace.root / DIRECTORY / selection_id
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".review.lock", blocking=False):
        result_path = directory / "result.json"
        if result_path.exists():
            previous = read_json(result_path)
            return inspect(workspace, previous["id"])
        files = {}
        def add_bytes(name, data):
            name = _name(name)
            atomic_bytes(directory / name, data, immutable=True)
            files[name] = describe_file(directory, directory / name)
        def add_record(name, value):
            add_bytes(name, canonical(value) + b"\n")
        def add_original(name, original):
            expected = {"path": original["object"], "bytes": original["bytes"], "sha256": original["sha256"]}
            path = verify_file(workspace.root, expected)
            files[name] = _copy(directory, path, name, expected)
        originals = {"calibrations": report, "calibration-plans": plan, "observations": observed}
        if detail:
            originals["calibration-uncertainties"] = detail
        if atlas:
            originals["calibration-maps"] = atlas
        for kind, value in originals.items():
            path = workspace.root / kind / (value["id"] + ".json")
            files["records/" + kind + ".json"] = _copy(directory, path, "records/" + kind + ".json",
                                                      describe_file(workspace.root, path))
        add_original("sources/original-observations.csv", observed["original"])
        add_record("sources/catchment-entry.json", entry)
        for body in [entry["body"], *entry.get("companions", [])]:
            name = "sources/catchments/" + _name(body.get("view_path", body["filename"]))
            add_original(name, body)
        for candidate in plan["candidates"]:
            run = workspace.inspect_run(candidate["run_id"])
            if digest(run["selection"]) != digest(candidate["selection"]):
                raise ValueError("A retained native candidate differs from the original calibration selection")
            add_record("records/native-runs/" + identifier(candidate["run_id"]) + ".json", run)
        for comparison_id in sorted(set(report["comparison_ids"].values())):
            value = workspace._get("observation-comparisons", identifier(comparison_id))
            add_record("records/observation-comparisons/" + comparison_id + ".json", value)
        tables = _tables(report, plan, observed.get("metadata"))
        if detail:
            tables["source-error-pairs"] = (PAIR_FIELDS, detail["pairwise"])
            for name in ("source_records", "reference_units", "selected_validation", "candidate_scores"):
                rows = detail.get(name, [])
                fields = tuple(sorted({key for row in rows for key in row}))
                tables["source-error-" + name.replace("_", "-")] = (fields, rows)
            tables["source-error-records"] = tables.pop("source-error-source-records")
        for name, (fields, rows) in tables.items():
            add_bytes("tables/" + name + ".csv", _csv(fields, rows))
        if atlas:
            source_root = workspace.root / atlas["directory"]
            for expected in atlas["files"]:
                path = verify_file(source_root, expected)
                name = "maps/" + _name(expected["path"])
                files[name] = _copy(directory, path, name, expected)
        add_record("review-selection.json", selection)
        add_bytes("index.html", _html(selection, report, plan, observed, detail, atlas, tables, directory, files))
        manifest = {"schema": "upstate.calibration-review/v1", "selection_id": selection_id,
                    "selection": selection, "files": files,
                    "reading": "Open index.html. Original records, tables and every selected map artifact are retained.",
                    "scientific_scope": "Original nominal selection; selected-only held-out evaluation; explicit supplements"}
        atomic_json(directory / "manifest.json", manifest, immutable=True)
        # A deterministic archive resumes to identical bytes after interruption.
        archive_path = directory / "calibration-review.zip"
        pending = directory / ".calibration-review.pending"
        pending.unlink(missing_ok=True)
        try:
            with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6,
                                 allowZip64=True) as archive:
                for name in sorted([*files, "manifest.json"]):
                    member = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                    member.compress_type = zipfile.ZIP_DEFLATED
                    member.external_attr = 0o100644 << 16
                    with (directory / name).open("rb") as source, archive.open(member, "w", force_zip64=True) as target:
                        for block in iter(lambda: source.read(1024 * 1024), b""):
                            target.write(block)
            with pending.open("rb") as stream:
                os.fsync(stream.fileno())
            if archive_path.exists():
                expected = describe_file(directory, pending)
                verify_file(directory, {**expected, "path": archive_path.name})
            else:
                os.link(pending, archive_path)
        finally:
            pending.unlink(missing_ok=True)
        # Reopen source dependencies before saving the completed retained edition.
        latest = _basis(workspace, calibration_id, uncertainty_id, map_id)[-1]
        if latest != stamp:
            raise ValueError("The original calibration dependencies changed during review packaging")
        result = workspace._save(KIND, {
            "version": VERSION, "presentation_edition": PRESENTATION_EDITION,
            "workspace_id": workspace.project["id"], "state": "complete",
            "selection_id": selection_id, "selection": selection, "title": selection["title"],
            "calibration_id": report["id"], "plan_id": plan["id"],
            "uncertainty_id": selection["uncertainty_id"], "map_id": selection["map_id"],
            "selected_run_id": report["selected_run_id"], "selected_profile_id": report["selected_profile_id"],
            "directory": directory.relative_to(workspace.root).as_posix(), "source_stamp": stamp,
            "files": files, "manifest": describe_file(directory, directory / "manifest.json"),
            "archive": describe_file(directory, archive_path), "file_count": len(files),
        })
        atomic_json(result_path, result, immutable=True)
        return result


def member(workspace, review_id, name):
    """Verify one retained package member without rehashing unrelated artifacts."""
    result = workspace._get(KIND, identifier(review_id))
    if (result.get("version") != VERSION or result.get("workspace_id") != workspace.project["id"]
            or digest(result["selection"]) != result["selection_id"]):
        raise ValueError("Select this workspace's original review edition")
    directory = workspace.root / DIRECTORY / identifier(result["selection_id"])
    if result["directory"] != directory.relative_to(workspace.root).as_posix():
        raise ValueError("The original review package directory changed")
    name = _name(name)
    expected = result["manifest"] if name == "manifest.json" else result["files"].get(name)
    if expected is None or expected["path"] != name:
        raise ValueError("Choose a member of the retained review package")
    return verify_file(directory, expected), expected


def inspect(workspace, review_id):
    result = workspace._get(KIND, identifier(review_id))
    if result.get("version") != VERSION or result.get("workspace_id") != workspace.project["id"]:
        raise ValueError("Select a retained review in this workspace")
    selected = result["selection"]
    for key in ("calibration_id", "plan_id", "uncertainty_id", "map_id"):
        if result[key] != selected[key]:
            raise ValueError("The review linkage differs from its original selection")
    if digest(selected) != result["selection_id"]:
        raise ValueError("The original review selection changed")
    directory = workspace.root / DIRECTORY / identifier(result["selection_id"])
    if result["directory"] != directory.relative_to(workspace.root).as_posix():
        raise ValueError("The original review package directory changed")
    basis = _basis(workspace, result["calibration_id"], result["uncertainty_id"], result["map_id"])
    for key in ("selected_run_id", "selected_profile_id"):
        if result[key] != basis[0][key]:
            raise ValueError("The review changed the original nominal selection")
    if basis[-1] != result["source_stamp"] or result["source_stamp"] != selected["source_stamp"]:
        raise ValueError("The retained review dependencies differ from the original selection")
    verify_file(directory, result["manifest"])
    manifest = read_json(directory / "manifest.json")
    if (manifest["selection"] != selected or manifest["files"] != result["files"]
            or manifest["selection_id"] != result["selection_id"]):
        raise ValueError("The retained review manifest differs")
    for name, expected in result["files"].items():
        if _name(name) != expected["path"]:
            raise ValueError("A review member differs from its inventory path")
        verify_file(directory, expected)
    verify_file(directory, result["archive"])
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace")
    commands = parser.add_subparsers(dest="action", required=True)
    make = commands.add_parser("prepare")
    make.add_argument("calibration_id")
    make.add_argument("--uncertainty-id")
    make.add_argument("--map-id")
    make.add_argument("--title")
    make.add_argument("--notes", default="")
    show = commands.add_parser("inspect")
    show.add_argument("review_id")
    args = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(args.workspace)
    result = (prepare(workspace, args.calibration_id, uncertainty_id=args.uncertainty_id,
                      map_id=args.map_id, title=args.title, notes=args.notes)
              if args.action == "prepare" else inspect(workspace, args.review_id))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
