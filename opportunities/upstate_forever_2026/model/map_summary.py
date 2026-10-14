"""Full-resolution quantitative companions for the retained scientific map atlas.

This module reads the exact delivered datasets. It never runs a model, changes
pixels, converts native rates again or subtracts totals on unequal support.
"""
from __future__ import annotations

import csv
import io
import math
from html import escape
from pathlib import Path

from .common import atomic_bytes, atomic_json, describe_file, digest, read_json, verify_file

VERSION = "atlas-native-quantities/v1"
SCHEMA = "upstate.map-quantities/v1"
JSON_PATH = "maps/map-quantities.json"
CSV_PATH = "maps/map-quantities.csv"
FILE_KEYS = ("map_quantities_json", "map_quantities_csv")
MASS_UNITS = {"kg/pixel/year": "kg/year", "metric_tonnes/pixel/year": "metric_tonnes/year"}
PERCENTILES = (5, 25, 50, 75, 95, 98)
METHOD = (
    "Every finite, unmasked cell of the exact delivered raster participates. "
    "Percentiles use native values and linear interpolation, including zero and negative values. "
    "Area is the affine pixel area in the projected coordinate system, converted to hectares. "
    "Annual totals sum mass-per-pixel values once. Each dataset retains its own support; "
    "totals on different footprints are not subtracted. Display caps change colors only."
)


class _Sum:
    def __init__(self):
        self.total = self.correction = 0.0

    def add(self, value):
        updated = self.total + value
        if abs(self.total) >= abs(value):
            self.correction += (self.total - updated) + value
        else:
            self.correction += (value - updated) + self.total
        self.total = updated

    def value(self):
        result = self.total + self.correction
        if not math.isfinite(result):
            raise ValueError("Map quantity exceeds the finite numeric range")
        return result


def _scale_key(scale):
    if not isinstance(scale, dict):
        return None
    low, high = scale.get("minimum"), scale.get("maximum")
    if (isinstance(low, bool) or isinstance(high, bool)
            or not isinstance(low, (int, float)) or not isinstance(high, (int, float))
            or not math.isfinite(low) or not math.isfinite(high) or low >= high):
        raise ValueError("Map quantities require the original finite display range")
    return digest({"minimum": low, "maximum": high})


def measure(path, dataset):
    """Read one original raster in bounded windows; keep real masks and signs."""
    import numpy as np
    import rasterio
    from .raster_stats import raster_statistics, raster_windows

    scales = {}
    for relation in dataset.get("maps", []):
        scale = relation.get("display_scale")
        key = _scale_key(scale)
        if key is not None:
            if scale.get("units") and scale["units"] != dataset["units"]:
                raise ValueError("Map quantities and display scale use different units")
            scales[key] = {"minimum": scale["minimum"], "maximum": scale["maximum"],
                           "below_cells": 0, "above_cells": 0}
    with rasterio.Env(GDAL_CACHEMAX=64 * 1024 * 1024), rasterio.open(path) as raster:
        if raster.count != 1 or not raster.crs or not raster.crs.is_projected:
            raise ValueError("Map quantities require the original single-band projected raster")
        if raster.scales != (1.0,) or raster.offsets != (0.0,):
            raise ValueError("Retain the original physical-value raster with identity scale and offset")
        unit_name, to_metres = raster.crs.linear_units_factor
        t = raster.transform
        pixel_area_ha = abs(t.a * t.e - t.b * t.d) * to_metres ** 2 / 10000
        if not math.isfinite(pixel_area_ha) or pixel_area_ha <= 0:
            raise ValueError("Map raster has no finite positive projected cell area")
        statistics = raster_statistics(raster, percentiles=PERCENTILES)
        counts = {"negative": 0, "zero": 0, "positive": 0}
        sums = {"negative": _Sum(), "positive": _Sum()}
        for window in raster_windows(raster):
            band = raster.read(1, window=window, masked=True)
            values = np.ma.getdata(band)
            values = values[~np.ma.getmaskarray(band) & np.isfinite(values)]
            for name, selected in (("negative", values[values < 0]),
                                   ("positive", values[values > 0])):
                counts[name] += int(selected.size)
                sums[name].add(float(selected.sum(dtype="float64")))
            counts["zero"] += int(np.count_nonzero(values == 0))
            for scale in scales.values():
                scale["below_cells"] += int(np.count_nonzero(values < scale["minimum"]))
                scale["above_cells"] += int(np.count_nonzero(values > scale["maximum"]))
        if sum(counts.values()) != statistics["valid_cells"]:
            raise ValueError("Raster support changed while map quantities were being read")
        support = {
            "valid_cells": statistics["valid_cells"], "invalid_cells": statistics["invalid_cells"],
            "pixel_area_ha": pixel_area_ha,
            "valid_area_ha": statistics["valid_cells"] * pixel_area_ha,
            "invalid_grid_area_ha": statistics["invalid_cells"] * pixel_area_ha,
            "area_basis": "Projected affine grid area; not geodesic ground area",
            "width": raster.width, "height": raster.height,
            "crs": raster.crs.to_string(), "linear_unit": unit_name,
            "linear_unit_to_metres": to_metres, "transform": list(t)[:6],
        }
    total_units = MASS_UNITS.get(dataset["units"])
    available = statistics["valid_cells"] > 0
    directions = {name: {"cells": count, "area_ha": count * pixel_area_ha}
                  for name, count in counts.items()}
    if total_units:
        for name in ("negative", "positive"):
            directions[name]["annual_mass"] = sums[name].value() if available else None
        directions["zero"]["annual_mass"] = 0.0 if available else None
    return {
        "support": support,
        "values": {key: statistics[key] for key in ("minimum", "maximum", "mean", "percentiles")},
        "annual_mass": statistics["sum"] if total_units and available else None,
        "annual_mass_units": total_units,
        "mass_total_reason": ("No valid cells" if total_units and not available else
                              None if total_units else "A cell-value sum is not an annual mass for these units"),
        "directions": directions, "display_scales": scales,
        "percentile_method": statistics["method"],
    }


def _binding(state):
    atlas = state["atlas"]
    datasets = (atlas.get("datasets") or {}).get("datasets")
    if not isinstance(datasets, list) or not datasets:
        raise ValueError("Retain the original atlas GIS datasets before their quantitative summary")
    if len({item["id"] for item in datasets}) != len(datasets):
        raise ValueError("Atlas quantitative datasets must have distinct original IDs")
    return {"version": VERSION, "delivery_id": state["id"], "grid_id": atlas["grid_id"],
            "baseline_run_id": atlas["baseline_run_id"],
            "scenario_run_ids": atlas["scenario_run_ids"],
            "datasets": datasets,
            "pages": [{key: row[key] for key in ("map_key", "family", "title", "panels")}
                      for row in atlas["pages"]]}


def validate(summary):
    if (summary.get("schema") != SCHEMA or summary.get("version") != VERSION
            or digest({key: value for key, value in summary.items() if key != "id"}) != summary.get("id")):
        raise ValueError("Map quantities differ from their retained original edition")
    return summary


def build(directory, state):
    """Bind every summary to the exact retained original dataset and source."""
    binding = _binding(state)
    rows = []
    for original in binding["datasets"]:
        companions = [item["file"] for item in original.get("companions", [])]
        path = verify_file(directory, original["file"])
        for item in companions:
            verify_file(directory, item)
        result = measure(path, original)
        # Detect changes during multi-pass statistics, including external masks.
        verify_file(directory, original["file"])
        for item in companions:
            verify_file(directory, item)
        rows.append({**{key: original.get(key) for key in (
            "id", "title", "kind", "units", "signed", "file", "source_raster", "source_file",
            "grid_id", "profile_id", "baseline_run_id", "comparison_id", "pollutant", "runs",
            "source_editions", "support", "derivation", "maps", "model_domain", "reporting_area",
            "reporting_mask")}, "quantities": result})
    result = {
        "schema": SCHEMA, "version": VERSION, "input_id": digest(binding),
        "delivery_id": state["id"], "title": state["atlas"]["title"],
        "grid_id": binding["grid_id"], "baseline_run_id": binding["baseline_run_id"],
        "scenario_run_ids": binding["scenario_run_ids"],
        "delivery_mode": state["atlas"].get("delivery_mode"),
        "native_study": state["atlas"].get("source_context", {}).get("native_study"),
        "method": METHOD, "datasets": rows,
    }
    return {**result, "id": digest(result)}


def _csv_value(value):
    if isinstance(value, str) and (value.startswith(("\t", "\r")) or
                                  value.lstrip().startswith(("=", "+", "-", "@"))):
        return "'" + value
    return value


def csv_bytes(summary):
    validate(summary)
    columns = ("map_key", "panel", "dataset_id", "title", "kind", "pixel_units", "signed",
               "valid_cells", "invalid_cells", "pixel_area_ha", "valid_area_ha",
               "annual_mass", "annual_mass_units", "minimum", "p05", "p25", "median", "p75", "p95", "p98", "maximum", "mean",
               "negative_cells", "zero_cells", "positive_cells", "negative_annual_mass", "positive_annual_mass",
               "display_minimum", "display_maximum", "below_display_cells", "above_display_cells",
               "support_definition", "grid_id", "profile_id", "baseline_run_id", "comparison_id",
               "run_ids", "raster_path", "raster_sha256", "summary_id")
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns)
    writer.writeheader()
    for item in summary["datasets"]:
        q = item["quantities"]
        values = q["values"]
        percentiles = {p["percentile"]: p["value"] for p in values["percentiles"]}
        for relation in item["maps"]:
            scale = q["display_scales"].get(_scale_key(relation.get("display_scale")), {})
            row = {"map_key": relation["map_key"], "panel": relation["panel"], "dataset_id": item["id"],
                   "title": relation["title"], "kind": item["kind"], "pixel_units": item["units"], "signed": item["signed"],
                   **{k: q["support"][k] for k in ("valid_cells", "invalid_cells", "pixel_area_ha", "valid_area_ha")},
                   "annual_mass": q["annual_mass"], "annual_mass_units": q["annual_mass_units"],
                   **{k: values[k] for k in ("minimum", "maximum", "mean")},
                   **{name: percentiles[p] for name, p in (("p05", 5), ("p25", 25), ("median", 50), ("p75", 75), ("p95", 95), ("p98", 98))},
                   **{name + "_cells": q["directions"][name]["cells"] for name in ("negative", "zero", "positive")},
                   **{name + "_annual_mass": q["directions"][name].get("annual_mass") for name in ("negative", "positive")},
                   "display_minimum": scale.get("minimum"), "display_maximum": scale.get("maximum"),
                   "below_display_cells": scale.get("below_cells"), "above_display_cells": scale.get("above_cells"),
                   "support_definition": item["support"],
                   **{k: item[k] for k in ("grid_id", "profile_id", "baseline_run_id", "comparison_id")},
                   "run_ids": "; ".join(run["id"] for run in item["runs"]),
                   "raster_path": item["file"]["path"], "raster_sha256": item["file"]["sha256"], "summary_id": summary["id"]}
            writer.writerow({key: _csv_value(value) for key, value in row.items()})
    return output.getvalue().encode("utf-8-sig")


def write(directory, state):
    """Resume the same quantitative edition without rescanning accepted rasters."""
    registered = state.get("files", {})
    if all(key in registered for key in FILE_KEYS):
        previous = validate(read_json(verify_file(directory, registered[FILE_KEYS[0]])))
        verify_file(directory, registered[FILE_KEYS[1]])
        if previous["input_id"] != digest(_binding(state)):
            raise ValueError("Retained map quantities bind a different dataset edition")
        state["map_quantities"] = previous
        return previous
    result = build(directory, state)
    target = Path(directory) / JSON_PATH
    atomic_json(target, result)
    atomic_bytes(Path(directory) / CSV_PATH, csv_bytes(result))
    state.setdefault("files", {})[FILE_KEYS[0]] = describe_file(directory, target, title="Full-resolution map quantities")
    state["files"][FILE_KEYS[1]] = describe_file(directory, Path(directory) / CSV_PATH, title="Map quantities CSV")
    state["map_quantities"] = result
    return result


def _number(value):
    return "Unavailable" if value is None else format(value, ",.7g")


def _unit(value):
    return str(value or "").replace("metric_tonnes", "metric tonnes")


def _label(item):
    runs = item.get("runs") or []
    scenario = (runs[-1].get("scenario") or {}).get("title") if runs else None
    return item["title"] + (" — " + scenario if scenario else "")


def report_sections(summary):
    """Use ordinary typed report blocks for PDF, HTML, ODT and workbooks."""
    validate(summary)
    groups = {}
    for item in summary["datasets"]:
        groups.setdefault((item["kind"], item["units"], bool(item["signed"])), []).append(item)
    sections = []
    for (kind, units, signed), items in groups.items():
        mass_units = items[0]["quantities"]["annual_mass_units"]
        rows, directions = [], []
        for item in items:
            q, v = item["quantities"], item["quantities"]["values"]
            pct = {p["percentile"]: p["value"] for p in v["percentiles"]}
            rows.append([_label(item), _number(q["support"]["valid_area_ha"]),
                         _number(q["annual_mass"]) if mass_units else "Not a mass", 
                         _number(v["minimum"]), _number(pct[50]), _number(pct[95]), _number(v["maximum"])])
            if signed:
                directions.append([_label(item), *[_number(q["directions"][sign]["area_ha"])
                                                   for sign in ("negative", "zero", "positive")],
                                   _number(q["directions"]["negative"].get("annual_mass")),
                                   _number(q["directions"]["positive"].get("annual_mass"))])
        blocks = list(dict.fromkeys(item["support"] for item in items))
        blocks += ["Alternative minus baseline: negative values indicate lower annual export." if signed else
                   "Original retained cell values. Each summary uses this dataset's valid footprint.",
                   {"kind": "table", "columns": ["Map / scenario", "Valid ha", "Annual change" if signed else "Annual export", "Minimum", "Median", "95th percentile", "Maximum"],
                    "rows": rows, "caption": "Cell values: " + _unit(units) + ". " +
                    ("Annual mass: " + _unit(mass_units) + ". " if mass_units else "Priority scores have no annual mass total. ") +
                    "Full-resolution pixels, including zeros; each row uses its own valid support."}]
        if signed:
            blocks.append({"kind": "table", "columns": ["Map / scenario", "Decrease ha", "Unchanged ha", "Increase ha", "Negative mass", "Positive mass"],
                           "rows": directions, "caption": "Signed contributions on the same difference-raster support, in " + _unit(mass_units) + "."})
        blocks += [METHOD, "Complete numeric values, original run IDs, support definitions and raster SHA-256 values accompany this report in maps/map-quantities.csv and .json. Summary " + summary["id"] + "."]
        sections.append(("Map quantities: " + kind.replace("_", " "), blocks))
    return sections


def html_for_sheet(summary, sheet):
    """Human-readable values inside the existing offline map-browser cards."""
    if summary is None:
        return ""
    lookup = {item["id"]: item for item in summary["datasets"]}
    result = []
    for panel in sheet["panels"]:
        item = lookup.get(panel.get("dataset", {}).get("id"))
        if item is None:
            raise ValueError("Map quantities are missing a selected original panel")
        q, v = item["quantities"], item["quantities"]["values"]
        pct = {p["percentile"]: p["value"] for p in v["percentiles"]}
        fields = [("Valid mapped support", _number(q["support"]["valid_area_ha"]) + " ha / " + str(q["support"]["valid_cells"]) + " cells"),
                  ("Excluded grid cells", str(q["support"]["invalid_cells"])),
                  ("Minimum / median / 95th percentile / maximum", " / ".join(_number(x) for x in (v["minimum"], pct[50], pct[95], v["maximum"])) + " " + _unit(item["units"]))]
        if q["annual_mass_units"]:
            fields.insert(0, ("Net annual change" if item["signed"] else "Annual export on valid support", _number(q["annual_mass"]) + " " + _unit(q["annual_mass_units"])))
        if item["signed"]:
            for sign, label in (("negative", "Decrease"), ("zero", "Unchanged"), ("positive", "Increase")):
                d = q["directions"][sign]
                fields.append((label, str(d["cells"]) + " cells / " + _number(d["area_ha"]) + " ha" +
                    ((" / " + _number(d.get("annual_mass")) + " " + _unit(q["annual_mass_units"])) if q["annual_mass_units"] else "")))
        scale = q["display_scales"].get(_scale_key(panel.get("display_scale")))
        if scale:
            fields.append(("Outside the displayed color range", str(scale["below_cells"]) + " below / " + str(scale["above_cells"]) + " above; original values retained"))
        body = "".join("<dl class=\"field\"><dt>" + escape(label) + "</dt><dd>" + escape(value) + "</dd></dl>" for label, value in fields)
        result.append("<div class=\"map-quantities\"><h4>" + escape(panel["title"]) + " — full-resolution values</h4>" +
                      "<p class=\"muted\">" + escape(item["support"]) + "</p><div class=\"grid\">" + body + "</div>" +
                      ("<p class=\"muted\">Negative change means lower annual export; positive change means higher annual export.</p>" if item["signed"] else "") +
                      ("<p class=\"muted\">Dimensionless priority values are not summed into a mass.</p>" if not q["annual_mass_units"] else "") + "</div>")
    return "".join(result)


def client_sections(summary):
    """Use the same original quantities in the existing client report compiler."""
    return [{
        "id": "map-quantities-" + str(index + 1), "title": title,
        "paragraphs": [block for block in blocks if isinstance(block, str)],
        "tables": [{key: block[key] for key in ("columns", "rows", "caption")}
                   for block in blocks if isinstance(block, dict) and block["kind"] == "table"],
    } for index, (title, blocks) in enumerate(report_sections(summary))]
