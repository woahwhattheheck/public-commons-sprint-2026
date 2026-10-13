"""Retain a complete native calibration review as an existing scientific report source.

The existing ordered observed-report consumer carries this edition through the
scientific HTML/PDF, delivery archive, source viewer and editable Workspace.
"""
from __future__ import annotations

import argparse
import html
import math
from pathlib import Path
import json

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     held, identifier, read_json, verify_file)
from . import calibration_review as reviews
from . import observed_context
from .scientific_figures import _validate_figure

VERSION = 1
EDITION = "native-calibration-review-report-v1"
KIND = "calibration-report-sources"
DIRECTORY = "calibration-report-source-exports"
SOURCE_ID = "native-calibration-review"
SCHEMA = "upstate.observed-report/v1"


def _text(value):
    if value is None:
        return "Unavailable"
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("The original calibration report contains a nonfinite value")
        return format(value, ".8g")
    return str(value)


def _table(columns, rows):
    return {"kind": "table", "columns": list(columns),
            "rows": [[_text(value) for value in row] for row in rows]}


def _number(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value))


def _point_rows(report):
    """Join the nominal winner to its original reference units without refitting."""
    references = {row["id"]: row for row in report["reference_units"]}
    if len(references) != len(report["reference_units"]):
        raise ValueError("Original calibration reference unit IDs must be unique")
    result, seen = [], set()
    for row in report["prediction_rows"]:
        if row["run_id"] != report["selected_run_id"]:
            continue
        key = row["unit_id"]
        if key in seen or key not in references:
            raise ValueError("Selected prediction rows must name one original reference unit")
        seen.add(key)
        unit = references[key]
        if row.get("included") is not True:
            continue
        if unit.get("partition") not in {"calibration", "validation"}:
            continue
        observed, predicted = unit["observed_annual_mass"], row["predicted_annual_mass"]
        if not _number(observed) or not _number(predicted):
            raise ValueError("Included calibration values must retain finite annual quantities")
        result.append({**unit, **row, "unit_id": key, "partition": unit["partition"],
                       "parameter": unit["parameter"], "units": unit["units"],
                       "observed_annual_mass": observed, "predicted_annual_mass": predicted})
    return result


def _figures(report):
    points = _point_rows(report)
    figures = []
    for parameter in sorted({row["parameter"] for row in points}):
        selected = [row for row in points if row["parameter"] == parameter]
        units = {row["units"] for row in selected}
        if len(units) != 1:
            raise ValueError("A calibration figure must retain one physical unit per pollutant")
        unit = next(iter(units))
        values = [float(row[key]) for row in selected
                  for key in ("observed_annual_mass", "predicted_annual_mass")]
        lower, upper = min(0.0, min(values)), max(0.0, max(values))
        span = upper - lower
        if span == 0:
            upper = lower + 1.0
        else:
            upper += span * .06
            if lower < 0:
                lower -= span * .06
        if not math.isfinite(upper - lower) or upper <= lower:
            raise ValueError("Original annual values exceed the finite figure coordinate range")
        ticks = [{"value": lower + (upper - lower) * i / 4,
                  "label": format(lower + (upper - lower) * i / 4, ".4g")}
                 for i in range(5)]
        groups = []
        for partition, marker, label in (
                ("calibration", "circle", "Calibration"),
                ("validation", "square-open", "Held-out")):
            actual = [row for row in selected if row["partition"] == partition]
            groups.append({
                "geometry": "scatter", "label": label, "marker": marker,
                "points": [{"x": row["observed_annual_mass"],
                            "y": row["predicted_annual_mass"],
                            "unit_id": row["unit_id"], "catchment_id": row["catchment_id"],
                            "group_id": row["group_id"], "partition": partition}
                           for row in actual],
            })
        panel = {
            "id": parameter, "title": parameter.capitalize(),
            "x": {"label": "Original annual reference", "unit": unit,
                  "domain": [lower, upper], "ticks": ticks},
            "y": {"label": "Selected prediction", "unit": unit,
                  "domain": [lower, upper], "ticks": ticks},
            "series": [{"geometry": "line", "label": "1:1", "markers": False, "points": [
                {"x": lower, "y": lower}, {"x": upper, "y": upper}]}] + groups,
        }
        figure = {
            "id": "selected-" + parameter, "title": "Selected native calibration: " + parameter,
            "caption": ("One point per included original catchment reference unit. Circles show "
                        "calibration groups; open squares show held-out spatial groups. The two axes "
                        "use identical physical ranges. The prediction is the retained total used by "
                        "the original objective, including its explicitly retained external annual "
                        "load where present. The nominal selected run is " + report["selected_run_id"]
                        + ". Original source-estimated reference methods and periods are retained "
                        "in the accompanying source tables."),
            "panels": [panel],
        }
        _validate_figure(figure)
        figures.append(figure)
    return figures


def _svg(figure):
    """Render the same retained numeric specification as the existing PDF consumer."""
    panel = figure["panels"][0]
    low, high = panel["x"]["domain"]
    left, top, size = 95.0, 65.0, 440.0
    x = lambda value: left + (value - low) / (high - low) * size
    y = lambda value: top + size - (value - low) / (high - low) * size
    esc = lambda value: html.escape(_text(value), quote=True)
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="700" height="635" '
             'viewBox="0 0 700 635" role="img">',
             "<title>" + esc(figure["title"]) + "</title><desc>" + esc(figure["caption"]) + "</desc>",
             '<rect width="700" height="635" fill="white"/>',
             '<g fill="#202020" font-family="Arial,Helvetica,sans-serif">',
             '<text x="95" y="30" font-size="19">' + esc(figure["title"]) + "</text>"]
    for tick in panel["x"]["ticks"]:
        px, py = x(tick["value"]), y(tick["value"])
        parts.extend([
            '<path d="M %.6f 65 V 505 M 95 %.6f H 535" stroke="#dedede" fill="none"/>' % (px, py),
            '<text x="%.6f" y="528" text-anchor="middle" font-size="12">%s</text>' % (px, esc(tick["label"])),
            '<text x="84" y="%.6f" text-anchor="end" font-size="12">%s</text>' % (py + 4, esc(tick["label"])),
        ])
    parts.append('<rect x="95" y="65" width="440" height="440" fill="none" stroke="#202020"/>')
    parts.append('<path d="M 95 505 L 535 65" fill="none" stroke="#202020" stroke-dasharray="5 4"/>')
    for series in panel["series"][1:]:
        for point in series["points"]:
            px, py = x(point["x"]), y(point["y"])
            title = esc(point["catchment_id"] + " | " + point["partition"] +
                        " | reference " + _text(point["x"]) + " | prediction " + _text(point["y"]))
            if series["marker"] == "square-open":
                parts.append('<rect x="%.6f" y="%.6f" width="8" height="8" fill="white" '
                             'stroke="#202020"><title>%s</title></rect>' % (px - 4, py - 4, title))
            else:
                parts.append('<circle cx="%.6f" cy="%.6f" r="3.5" fill="#202020">'
                             '<title>%s</title></circle>' % (px, py, title))
    unit = esc(panel["x"]["unit"])
    parts.extend([
        '<text x="315" y="556" text-anchor="middle" font-size="13">Original annual reference (' + unit + ")</text>",
        '<text transform="translate(20 285) rotate(-90)" text-anchor="middle" font-size="13">Selected prediction (' + unit + ")</text>",
        '<circle cx="102" cy="585" r="3.5"/><text x="116" y="590" font-size="12">Calibration</text>',
        '<rect x="228" y="581" width="8" height="8" fill="white" stroke="#202020"/>'
        '<text x="245" y="590" font-size="12">Held-out spatial groups</text>',
        '<path d="M 438 585 H 461" stroke="#202020" stroke-dasharray="5 4"/>'
        '<text x="469" y="590" font-size="12">1:1</text>',
        "</g></svg>\n",
    ])
    return "".join(parts).encode("utf-8")


def _sections(review, report, plan, observed, detail, atlas):
    chosen = next(row for row in report["ranked_candidates"] if row["run_id"] == report["selected_run_id"])
    refs = report["reference_units"]
    unit_by_parameter = {row["parameter"]: row["units"] for row in refs}
    calibration_groups = plan["selection"]["calibration_group_ids"]
    validation_groups = plan["selection"]["validation_group_ids"]
    method_rows = []
    for parameter, objective in report["objective"].items():
        norm = report["normalization"].get(parameter, {})
        method_rows.append([parameter, objective["weight"],
                            norm.get("value") if isinstance(norm, dict) else norm,
                            unit_by_parameter.get(parameter),
                            norm.get("basis", norm.get("reason", norm.get("method"))) if isinstance(norm, dict) else None])
    sections = [
        ["Original native calibration review", [
            "Retained review: " + review["title"] + ". Review ID " + review["id"] + ".",
            "These results describe the original selected native run " + report["selected_run_id"]
            + ", parameter profile " + report["selected_profile_id"] + ", and calibration "
            + report["id"] + ". Each source report retains its own scientific selection.",
            report["selection_method"], report["reference_interpretation"], report["temporal_method"],
            _table(["Quantity", "Retained value"], [
                ["Candidate runs", report.get("candidate_count", len(plan["candidates"]))],
                ["Distinct parameter profiles", report.get("distinct_profile_count",
                    len({row["profile_id"] for row in plan["candidates"]}))],
                ["Calibration spatial groups", len(calibration_groups)],
                ["Held-out spatial groups", len(validation_groups)],
                ["Selected nominal objective", chosen["objective_score"]],
                ["Selected native models", chosen.get("selected_models", [])],
            ]),
            review["selection"]["notes"] or "The original review contains no additional notes.",
        ]],
        ["Original reference quantities and selection method", [
            "Physical annual mass remains in each source pollutant's declared unit. The dimensionless "
            "ranking uses the original fixed objective weights and normalization scales.",
            _table(["Pollutant", "Weight", "Normalization scale", "Units", "Scale basis"], method_rows),
            _table(["Partition", "Original spatial-group IDs"], [
                ["Calibration", calibration_groups], ["Held-out validation", validation_groups]]),
            "Original observation edition " + observed["id"] + ". Its complete original CSV, "
            "methods, estimator periods, catchment geometry and exclusions are included in this source.",
            {"kind": "links", "items": [
                {"title": "Original reference-unit methods, periods and annual quantities",
                 "path": "dossier/tables/reference-units.csv"},
                {"title": "Complete selected reference, native, external and total prediction",
                 "path": "dossier/tables/selected-catchments.csv"},
            ]},
        ]],
    ]
    ranked = report["ranked_candidates"]
    displayed = ranked[:12]
    sections.append(["Nominal candidate comparison", [
        "The original calibration objective determines this order. Displayed rows: "
        + str(len(displayed)) + " of " + str(len(ranked)) + "; the complete ranking accompanies this report.",
        _table(["Rank", "Profile", "Native models", "Nominal objective", "Run ID"],
               [[row["rank"], row.get("title", row["profile_id"]),
                 row.get("selected_models", []), row["objective_score"], row["run_id"]]
                for row in displayed]),
        {"kind": "links", "items": [{"title": "Complete original candidate ranking",
                                    "path": "dossier/tables/candidate-ranking.csv"}]},
    ]])
    metrics = []
    for partition, values in (
            ("Calibration", chosen["pollutant_metrics"]),
            ("Held-out validation", report["selected_validation"]["pollutant_metrics"])):
        for parameter, row in values.items():
            metrics.append([partition, parameter, row.get("units", unit_by_parameter.get(parameter)),
                            row.get("catchments"), row.get("spatial_groups"), row.get("rmse"),
                            row.get("mean_bias"), row.get("nash_sutcliffe_efficiency")])
    sections.append(["Selected model: physical fit and held-out support", [
        "Held-out values describe the originally selected candidate. Candidate ranking uses calibration groups only.",
        chosen.get("physical_metrics_basis", "Physical catchment metrics describe the retained rows; the declared selection objective weights calibration spatial groups equally."),
        _table(["Partition", "Pollutant", "Units", "Catchments", "Groups", "RMSE", "Mean bias", "NSE"], metrics),
        "Held-out support state: " + _text(report["selected_validation"].get("state")) + ".",
        {"kind": "links", "items": [
            {"title": "Complete physical metrics", "path": "dossier/tables/physical-metrics.csv"},
            {"title": "Original omitted or excluded reference records", "path": "dossier/tables/excluded-references.csv"},
            {"title": "Candidate support failures", "path": "dossier/tables/candidate-failures.csv"},
        ]},
    ]])
    selected_points = _point_rows(report)
    sections.append(["Retained annual-load accounting", [
        "Displayed complete selected reference units: " + str(min(12, len(selected_points))) +
        " of " + str(len(selected_points)) + ". Native catchment export and explicitly retained "
        "external annual contributions sum to the total prediction used by the original objective. "
        "The complete accounting and incomplete-support rows remain in the selected-catchments CSV.",
        _table(["Catchment", "Partition", "Pollutant", "Units", "Reference", "Native",
                "External", "Total prediction"],
               [[row["catchment_id"], row["partition"], row["parameter"], row["units"],
                 row["observed_annual_mass"], row.get("native_annual_mass"),
                 row.get("delivered_external_annual_mass"), row["predicted_annual_mass"]]
                for row in selected_points[:12]]),
    ]])
    stability = report["group_stability"]
    sections.append(["Dependence on calibration spatial groups", [
        "Leave-one-calibration-group-out stability state: " + _text(stability.get("state")) + ".",
        "Completed folds: " + _text(stability.get("completed_folds")) + ". The original candidate "
        "predictions and omitted-group outcomes are retained in the complete table.",
        {"kind": "links", "items": [
            {"title": "Original spatial-group selection stability", "path": "dossier/tables/group-stability.csv"},
            {"title": "Complete retained candidate envelope", "path": "dossier/tables/candidate-envelope.csv"},
        ]},
    ]])
    if detail:
        coverage = detail["coverage"]
        sections.append(["Published source-error sensitivity", [
            "Source-error edition " + detail["id"] + ", multiplier " + _text(detail["standard_errors"]) + ".",
            reviews.SENSITIVITY.get(detail["selection_sensitivity"]["state"],
                                    _text(detail["selection_sensitivity"]["state"])),
            *(detail["interpretation"] if isinstance(detail["interpretation"], list)
              else [detail["interpretation"]]),
            "Each gap is challenger objective minus the original selected objective. Positive gaps "
            "favor the original selection. Bounds use the retained fixed scales and marginal source-error "
            "ranges; the original nominal selection is preserved.",
            _table(["Original source rows", "Rows with published error", "Missing error rows"], [
                [coverage["source_record_count"], coverage["records_with_standard_error"],
                 len(coverage["missing_record_ids"])]]),
            _table(["Candidate", "Nominal gap", "Minimum gap", "Maximum gap", "Tolerance",
                    "First-tie multiplier", "First-tie state", "Comparison state"],
                   [[row.get("title", row["run_id"]), row["nominal_gap"], row["minimum_gap"],
                     row["maximum_gap"], row["numerical_tolerance"],
                     row.get("first_tie_standard_errors"), row.get("first_tie_state"), row["state"]]
                    for row in detail["pairwise"][:12]]),
            {"kind": "links", "items": [
                {"title": "Complete source-error comparisons and missing support",
                 "path": "dossier/tables/source-error-pairs.csv"},
                {"title": "Original error-source records and units",
                 "path": "dossier/tables/source-error-records.csv"},
            ]},
        ]])
    if atlas:
        items = []
        for layer in atlas["layers"]:
            for key, label in (("pdf", "PDF atlas"), ("csv", "Catchment table"), ("geojson", "Editable geometry")):
                member = layer.get(key)
                if member:
                    items.append({"title": layer["title"] + " — " + label,
                                  "path": "dossier/maps/" + member["path"]})
        sections.append(["Original catchment residual maps", [
            atlas["interpretation"],
            "Original map edition " + atlas["id"] + ". Scalar comparisons retain overlapping "
            "upstream catchments, compound geometry and holes. Per-pollutant display ranges remain "
            "those declared in the saved atlas.",
            {"kind": "links", "items": items},
        ]])
    sections.append(["Read and reuse the complete original dossier", [
        "Open the retained index with its surrounding folder to read all original tables and selected maps. "
        "The complete dossier ZIP and the original scientific records travel as verified source companions.",
        {"kind": "links", "items": [
            {"title": "Complete readable calibration review", "path": "dossier/index.html"},
            {"title": "Complete original review ZIP", "path": "dossier/calibration-review.zip"},
            {"title": "Original dossier file inventory", "path": "dossier/manifest.json"},
            {"title": "Original calibration result", "path": "dossier/records/calibrations.json"},
            {"title": "Original calibration selection", "path": "dossier/records/calibration-plans.json"},
            {"title": "Original observation edition", "path": "dossier/records/observations.json"},
        ]},
    ]])
    return sections


def prepare(workspace, review_id):
    review = reviews.inspect(workspace, identifier(review_id))
    original = workspace.root / review["directory"]
    report = workspace._get("calibrations", review["calibration_id"])
    plan = workspace._get("calibration-plans", review["plan_id"])
    observed = workspace._get("observations", plan["selection"]["observation_id"])
    detail = workspace._get("calibration-uncertainties", review["uncertainty_id"]) if review["uncertainty_id"] else None
    atlas = workspace._get("calibration-maps", review["map_id"]) if review["map_id"] else None
    selection = {"edition": EDITION, "workspace_id": workspace.project["id"],
                 "review_id": review["id"], "review_selection_id": review["selection_id"],
                 "source_stamp": review["source_stamp"]}
    selection_id = digest(selection)
    directory = workspace.root / DIRECTORY / selection_id
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".report-source.lock", blocking=False):
        result_path = directory / "result.json"
        if result_path.exists():
            return inspect(workspace, read_json(result_path)["id"])
        files = {}
        for name, expected in sorted(review["files"].items()):
            path = verify_file(original, expected)
            member = "dossier/" + reviews._name(name)
            files[member] = reviews._copy(directory, path, member, expected)
        for expected in (review["manifest"], review["archive"]):
            path = verify_file(original, expected)
            member = "dossier/" + reviews._name(expected["path"])
            files[member] = reviews._copy(directory, path, member, expected)

        def add(name, data):
            atomic_bytes(directory / name, data, immutable=True)
            files[name] = describe_file(directory, directory / name)

        figures = _figures(report)
        add("figures/specification.json", canonical({
            "schema": "upstate.scientific-figure-spec/v1", "edition": EDITION,
            "review_id": review["id"], "selected_run_id": report["selected_run_id"],
            "figures": figures}) + b"\n")
        for figure in figures:
            add("figures/" + figure["id"] + ".svg", _svg(figure))
        recipe = {
            "schema": SCHEMA, "edition": EDITION, "title": review["title"],
            "native_calibration_review": {
                **selection, "calibration_id": report["id"], "plan_id": plan["id"],
                "selected_run_id": report["selected_run_id"],
                "selected_profile_id": report["selected_profile_id"],
                "uncertainty_id": review["uncertainty_id"], "map_id": review["map_id"],
            },
            "sections": _sections(review, report, plan, observed, detail, atlas),
            "inputs": [{"path": name, "bytes": item["bytes"], "sha256": item["sha256"]}
                       for name, item in sorted(files.items())],
            "figure_spec": "figures/specification.json",
            "figures": [{"id": figure["id"], "path": "figures/" + figure["id"] + ".svg"}
                        for figure in figures],
            "source_links": ["dossier/index.html", "dossier/calibration-review.zip",
                             "dossier/sources/original-observations.csv", "dossier/manifest.json"],
        }
        add("observed-report.json", canonical(recipe) + b"\n")
        source_manifest = {
            "schema": "upstate.sources/v1", "title": review["title"] + " — native calibration report",
            "captured_at": None,
            "notes": ["Derived from the exact original completed calibration review and its retained source files."],
            "entries": [{
                "id": SOURCE_ID, "kind": "document", "role": "OBSERVED_CONTEXT",
                "title": review["title"], "uri": "urn:upstate:calibration-review:" + review["id"],
                "vintage": "Original calibration review " + review["id"][:16],
                "path": "observed-report.json", "sha256": files["observed-report.json"]["sha256"],
                "metadata": {"report_schema": SCHEMA, "producer": EDITION,
                             "calibration_review_id": review["id"], "calibration_id": report["id"],
                             "selected_run_id": report["selected_run_id"],
                             "selected_profile_id": report["selected_profile_id"]},
                "companions": [{"path": name, "sha256": item["sha256"]}
                               for name, item in sorted(files.items()) if name != "observed-report.json"],
            }],
        }
        atomic_json(directory / "sources.json", source_manifest, immutable=True)
        collection = workspace.import_sources(directory / "sources.json")
        if reviews.inspect(workspace, review["id"])["source_stamp"] != selection["source_stamp"]:
            raise ValueError("Original calibration review changed during report-source preparation")
        result = workspace._save(KIND, {
            "version": VERSION, "edition": EDITION, "workspace_id": workspace.project["id"],
            "state": "complete", "selection": selection, "selection_id": selection_id,
            "title": review["title"], "review_id": review["id"], "calibration_id": report["id"],
            "plan_id": plan["id"], "selected_run_id": report["selected_run_id"],
            "selected_profile_id": report["selected_profile_id"],
            "source_collection_id": collection["id"], "source_id": SOURCE_ID,
            "directory": directory.relative_to(workspace.root).as_posix(),
            "files": files, "manifest": describe_file(directory, directory / "sources.json"),
            "figure_count": len(figures), "companion_count": len(files) - 1,
        })
        atomic_json(result_path, result, immutable=True)
        return inspect(workspace, result["id"])


def inspect(workspace, record_id):
    record = workspace._get(KIND, identifier(record_id))
    if (record.get("version") != VERSION or record.get("edition") != EDITION
            or record.get("workspace_id") != workspace.project["id"]
            or digest(record["selection"]) != record["selection_id"]):
        raise ValueError("Select the original calibration report-source edition in this workspace")
    review = reviews.inspect(workspace, record["review_id"])
    expected_selection = {"edition": EDITION, "workspace_id": workspace.project["id"],
                          "review_id": review["id"], "review_selection_id": review["selection_id"],
                          "source_stamp": review["source_stamp"]}
    if record["selection"] != expected_selection:
        raise ValueError("The report source differs from its original calibration review")
    for key in ("calibration_id", "plan_id", "selected_run_id", "selected_profile_id"):
        if record[key] != review[key]:
            raise ValueError("The report source changed the review's original " + key)
    directory = workspace.root / DIRECTORY / identifier(record["selection_id"])
    if record["directory"] != directory.relative_to(workspace.root).as_posix():
        raise ValueError("The report source directory differs from its original selection")
    verify_file(directory, record["manifest"])
    for name, item in record["files"].items():
        if reviews._name(name) != item["path"]:
            raise ValueError("A report source member differs from its original inventory")
        verify_file(directory, item)
    choice = {"source_collection_id": record["source_collection_id"], "source_id": record["source_id"]}
    binding = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
    expected_hashes = {name: item["sha256"] for name, item in record["files"].items()}
    if (binding["body_sha256"] != record["files"]["observed-report.json"]["sha256"]
            or binding["member_sha256"] != expected_hashes):
        raise ValueError("The selected report source lost an original dossier or figure member")
    return record


def list_saved(workspace, review_id=None):
    return [{key: row.get(key) for key in (
        "id", "state", "title", "review_id", "calibration_id", "plan_id", "selected_run_id",
        "selected_profile_id", "source_collection_id", "source_id", "figure_count", "companion_count")}
        for row in workspace._list(KIND) if review_id is None or row["review_id"] == review_id]


def verify_workspace(workspace):
    records = [inspect(workspace, row["id"]) for row in workspace._list(KIND)]
    return [{"id": row["id"], "review_id": row["review_id"],
             "source_collection_id": row["source_collection_id"]} for row in records]


def main():
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare_command = commands.add_parser("prepare")
    prepare_command.add_argument("--review", required=True)
    inspect_command = commands.add_parser("inspect")
    inspect_command.add_argument("--id", required=True)
    commands.add_parser("list")
    args = parser.parse_args()
    workspace = Workspace(args.workspace)
    value = prepare(workspace, args.review) if args.command == "prepare" else (
        inspect(workspace, args.id) if args.command == "inspect" else list_saved(workspace))
    print(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
