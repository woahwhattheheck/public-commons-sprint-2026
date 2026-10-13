"""Original Parameter-study coordinates for the shared scientific figure renderer.

Every physical coordinate is copied from selected-results.json. Ordinal case
positions and axis bounds are presentation metadata, with no fitted trends.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
import csv
import io
import json
from pathlib import Path

from .common import atomic_bytes, atomic_json, digest, file_digest
from . import ensemble_scientific_figures as drawing
from .scientific_figures import _validate_figure

EDITION = 1
SPEC = "parameter-figure-spec.json"
COORDINATES = "parameter-figure-coordinates.csv"
COVERAGE = "parameter-figure-coverage.json"
PAGE_SIZE = 12
LABELS = {"nitrogen_export": "Nitrogen", "phosphorus_export": "Phosphorus",
          "sediment_export": "Sediment"}
FIELDS = ("baseline_mass", "case_mass", "change")


def _text(value):
    if value is None:
        return "Undefined"
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    return str(value)


def _table(columns, rows, caption):
    return {"kind": "table", "columns": columns,
            "rows": [[_text(value) for value in row] for row in rows], "caption": caption}


def _context(row, index, selection, selected_sha256):
    return {
        "case_id": row["case_id"], "case_label": row["case"], "record_id": row["case_id"],
        "run_id": row["run_id"], "profile_id": row["profile_id"],
        "area_id": row["area_id"], "area": row["area"], "pollutant": row["pollutant"],
        "units": row["units"], "overrides": deepcopy(row["overrides"]),
        "baseline_valid_cells": row["baseline_valid_cells"],
        "case_valid_cells": row["case_valid_cells"], "paired_valid_cells": row["paired_valid_cells"],
        "paired_area_ha": row["paired_area_ha"], "support_changed": row["support_changed"],
        "baseline_full_mass": row["baseline_full_mass"], "case_full_mass": row["case_full_mass"],
        "percent_change": row["percent_change"],
        "experiment_id": selection["experiment_id"],
        "original_result_sha256": selection["expected_artifact_sha256"],
        "selected_results_sha256": selected_sha256,
        "original_row": {"path": "selected-results.json", "json_pointer": "/rows/" + str(index)},
    }


def build(selected, rows, *, selected_sha256):
    """Describe each original pair independently, including undefined coverage."""
    selection = selected["selection"]
    order = {key: index + 1 for index, key in enumerate(selection["case_ids"])}
    groups = defaultdict(list)
    for index, row in enumerate(rows):
        if (row["case_id"] not in order or row["area_id"] not in selection["area_ids"] or
                row["pollutant"] not in selection["pollutants"]):
            raise ValueError("A Parameter figure row is outside the selected original matrix")
        if not isinstance(row["units"], str) or not row["units"].strip():
            raise ValueError("Keep the original physical units beside every Parameter figure")
        groups[(row["area_id"], row["pollutant"], row["units"])].append((index, row))
    figures, omitted, coordinates = [], [], []
    total_points = 0
    for (area, pollutant, units), values in groups.items():
        values.sort(key=lambda item: order[item[1]["case_id"]])
        for page, start in enumerate(range(0, len(values), PAGE_SIZE)):
            records = values[start:start + PAGE_SIZE]
            figure_id = "parameter-" + digest([area, pollutant, units])[:20] + "-" + str(page + 1)
            mass_points = {(field, changed): [] for field in FIELDS[:2] for changed in (False, True)}
            change_points = {False: [], True: []}
            page_omitted = []
            plotted_pairs = 0
            for index, row in records:
                context = _context(row, index, selection, selected_sha256)
                position = order[row["case_id"]]
                changed = row["support_changed"]
                if type(changed) is not bool:
                    raise ValueError("Keep the original boolean support comparison in Parameter figures")
                any_point = False
                for field in FIELDS:
                    value = row[field]
                    if value is None:
                        omission = {"figure_id": figure_id, "field": field, "reason": "Original value is undefined",
                                    **deepcopy(context), "source": {
                                        "path": "selected-results.json", "json_pointer": "/rows/" + str(index) + "/" + field}}
                        omitted.append(omission)
                        page_omitted.append(omission)
                        continue
                    if drawing._number(value) is None:
                        raise ValueError("A retained Parameter figure value must be finite or explicitly undefined")
                    if row["paired_valid_cells"] <= 0:
                        raise ValueError("A finite Parameter paired value has no original valid-cell support")
                    point = {"x": position, "y": value, "field": field,
                             "source": {"path": "selected-results.json",
                                        "json_pointer": "/rows/" + str(index) + "/" + field},
                             **deepcopy(context)}
                    if field == "change":
                        change_points[changed].append(point)
                    else:
                        mass_points[(field, changed)].append(point)
                    coordinates.append({"figure_id": figure_id, **deepcopy(point)})
                    total_points += 1
                    any_point = True
                plotted_pairs += int(any_point)
            if not plotted_pairs:
                # Their exact rows remain in coverage.json and the report tables.
                continue
            positions = [order[row["case_id"]] for unused, row in records]
            x = drawing._axis("Original selected case (key below)", "",
                              [min(positions) - .6, max(positions) + .6],
                              [{"value": value, "label": str(value)} for value in positions])
            masses = [point["y"] for points in mass_points.values() for point in points]
            changes = [point["y"] for points in change_points.values() for point in points]
            panels = []
            if masses:
                series = []
                for field, title, marker in (("baseline_mass", "Baseline", "circle"),
                                             ("case_mass", "Case", "square-open")):
                    for changed in (False, True):
                        points = mass_points[(field, changed)]
                        if points:
                            series.append({"geometry": "scatter", "label": title + (" / changed support" if changed else ""),
                                           "marker": ("triangle" if field == "baseline_mass" else "cross")
                                                     if changed else marker,
                                           "points": points})
                panels.append({
                    "title": "Original annual mass on each pair's valid cells", "x": deepcopy(x),
                    "y": drawing._axis("Annual export mass", units, drawing._domain(masses, zero=True)),
                    "series": series,
                })
            if changes:
                panels.append({
                    "title": "Original case minus baseline", "x": deepcopy(x),
                    "y": drawing._axis("Annual change", units, drawing._domain(changes, zero=True)),
                    "series": [{"geometry": "scatter", "label": "Changed support" if changed else "Paired change",
                                "marker": "cross" if changed else "circle", "points": points}
                               for changed, points in change_points.items() if points],
                    "reference_lines": [{"axis": "y", "value": 0, "label": "No change"}],
                })
            figure = {
                "id": figure_id,
                "title": LABELS.get(pollutant, pollutant) + " — " + records[0][1]["area"] +
                         " — cases " + str(min(positions)) + "–" + str(max(positions)),
                "caption": (
                    "Each position is an original selected parameter case with land cover held fixed. "
                    "Values are copied from the saved annual-mass result. Each baseline/case pair uses "
                    "its own intersection of valid pixel centres; changed support is explicitly marked. "
                    "Matching counts alone do not establish matching geography across cases. "
                    "No lines, fitted trends, pooled support or probability intervals are introduced. "
                    "Negative change means lower modeled export. Undefined values have no plotted point "
                    "and remain in the coverage record and original numeric tables. Original full totals "
                    "are separate from the paired masses. Case, profile, run and support keys follow this figure."),
                "panels": panels, "area_id": area, "pollutant": pollutant, "units": units,
                "source_record_count": len(records), "plotted_record_count": plotted_pairs,
                "omitted_records": page_omitted,
                "detail_tables": [
                    _table(["Position", "Original case", "Case ID"],
                           [[order[row["case_id"]], row["case"], row["case_id"]] for unused, row in records],
                           "Figure case key; position is presentation metadata, not a parameter value."),
                    _table(["Position", "Profile ID", "Native run ID"],
                           [[order[row["case_id"]], row["profile_id"], row["run_id"]]
                            for unused, row in records],
                           "Exact original native selections; full parameter assignments remain in the coordinate JSON."),
                    _table(["Position", "Baseline cells", "Case cells", "Paired cells", "Paired area (ha)", "Changed"],
                           [[order[row["case_id"]], row["baseline_valid_cells"], row["case_valid_cells"],
                             row["paired_valid_cells"], row["paired_area_ha"], row["support_changed"]]
                            for unused, row in records],
                           "Original independent and paired support. These counts never stand in for a shared-mask identity."),
                ],
            }
            _validate_figure(figure)
            figures.append(figure)
    return {
        "schema": "upstate.scientific-figure-spec/v1", "version": EDITION,
        "experiment_id": selection["experiment_id"],
        "original_result_sha256": selection["expected_artifact_sha256"],
        "selected_results_sha256": selected_sha256,
        "figures": figures,
        "coverage": {"selected_rows": len(rows), "figure_count": len(figures),
                     "plotted_values": total_points, "undefined_values": len(omitted),
                     "omitted_records": omitted},
        "methods": ["All physical coordinates are copied from selected-results.json.",
                    "Each original case pair retains its own geographic support.",
                    "Areas, pollutants and physical units remain separate.",
                    "Case positions and padded axis bounds are presentation metadata.",
                    "No physical aggregation, smoothing, interpolation or probability inference occurs."],
        "coordinates": coordinates,
    }


def write(directory, selected, rows):
    directory = Path(directory)
    selected_sha256 = file_digest(directory / "selected-results.json")
    spec = build(selected, rows, selected_sha256=selected_sha256)
    coordinates = spec.pop("coordinates")
    atomic_json(directory / SPEC, spec, immutable=True)
    atomic_json(directory / COVERAGE, spec["coverage"], immutable=True)
    atomic_json(directory / "parameter-figure-coordinates.json", {
        "schema": "upstate.parameter-figure-coordinates/v1",
        "experiment_id": spec["experiment_id"],
        "original_result_sha256": spec["original_result_sha256"],
        "selected_results_sha256": selected_sha256, "coordinates": coordinates,
    }, immutable=True)
    figures = []
    for figure in spec["figures"]:
        path = "figures/" + figure["id"] + ".svg"
        atomic_bytes(directory / path, drawing._svg(figure).encode("utf-8"), immutable=True)
        figures.append({"id": figure["id"], "path": path})
    fields = ["figure_id", "field", "x", "y", "case_id", "case_label", "run_id", "profile_id",
              "area_id", "area", "pollutant", "units", "baseline_valid_cells", "case_valid_cells",
              "paired_valid_cells", "paired_area_ha", "support_changed", "baseline_full_mass",
              "case_full_mass", "percent_change", "original_result_sha256", "selected_results_sha256",
              "overrides", "source"]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for point in coordinates:
        row = {}
        for key, value in point.items():
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
            if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
                value = "'" + value
            row[key] = value
        writer.writerow(row)
    atomic_bytes(directory / COORDINATES, output.getvalue().encode("utf-8"), immutable=True)
    return {"figure_spec": SPEC, "figures": figures, "coverage": spec["coverage"]}
