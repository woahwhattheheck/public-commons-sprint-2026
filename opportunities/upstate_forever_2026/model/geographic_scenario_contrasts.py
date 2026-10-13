"""Describe the physical inputs at actual geographic scenario change pixels.

This is a bounded-window companion to the original allocation pass. The shared
prepared scalar inputs do not change between scenarios. These statistics describe
where each scenario changed land cover; they are not native NDR/SDR outputs.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import math
from pathlib import Path

from .common import atomic_json, identifier, verify_file

SCHEMA = "upstate.geographic-scenario-physical-contrasts/v1"
EDITION = "prepared-input-contrasts/1"
ROLES = ("DEM", "PRECIPITATION", "R_FACTOR", "K_FACTOR")
VARIABLES = ROLES + ("R_TIMES_K",)
ARMS = ("restoration", "control")
CLASSES = ("all", "81", "82", "other")
UNITS = {"DEM": "m", "R_FACTOR": "MJ*mm/(ha*h*year)",
         "K_FACTOR": "t*ha*h/(ha*MJ*mm)", "R_TIMES_K": "t/(ha*year)"}
LABELS = {"DEM": "Elevation", "PRECIPITATION": "NDR runoff proxy",
          "R_FACTOR": "Rainfall erosivity factor R", "K_FACTOR": "Soil erodibility factor K",
          "R_TIMES_K": "Input-factor product R × K"}
MEMBERS = ("physical-contrasts.json", "physical-contrasts.csv", "physical-distributions.csv")
NOTES = [
    "The same original prepared scalar grids are used by all three native scenarios. Differences describe the geographic selection of changed pixels, not scenario-induced changes to rain, soil or elevation.",
    "Each arm contains its actual final baseline-to-alternative changed cells on the region's three-scenario common categorical support. Classes 81 and 82 refer to the original baseline; other contains every remaining baseline code. The all row includes all three class groups.",
    "Each scalar has its own finite, unmasked support. Valid and missing counts refer to the explicit arm/class denominator; restoration/control overlap remains visible and is not assumed absent.",
    "R minus C is a descriptive difference between independently supported pixel means. It is not a causal treatment effect, matched-pair estimate, significance test or pollutant-load difference.",
    "Population standard deviation uses centered per-window moments and stable Chan merging. Equal-area prepared cells receive equal weight; these are selected raster-pixel statistics, not vector-polygon samples.",
    "Shared histogram edges use the original whole prepared-grid minimum and maximum, so regions and arms share a declared scale. R × K bounds enclose the product using nonnegative original factor bounds; they are not observed product extrema. No quantiles are inferred.",
    "R × K has units t/(ha*year) only for the declared original factor units. It is an input-factor product without slope-length, cover, practice or routing factors; it is not SDR erosion or sediment export. Elevation is not a slope or LS proxy.",
    "Precipitation retains its original declared units and is described as a runoff proxy unless the aligned source explicitly declares mm/year. No area multiplication, second conversion or resampling is applied.",
]


def _bounds(item, label):
    count = item.get("valid_cells")
    if isinstance(count, bool) or not isinstance(count, int) or count < 0:
        raise ValueError(label + " needs its original prepared valid-cell count")
    low, high = item.get("minimum"), item.get("maximum")
    if count == 0:
        if low is not None or high is not None:
            raise ValueError(label + " has inconsistent empty prepared bounds")
        return None
    if (isinstance(low, bool) or isinstance(high, bool)
            or not isinstance(low, (int, float)) or not isinstance(high, (int, float))
            or not math.isfinite(low) or not math.isfinite(high) or low > high):
        raise ValueError(label + " needs finite original prepared-grid bounds")
    return [float(low), float(high)]


def _histogram(bounds):
    if bounds is None:
        return {"basis": "original prepared grid has no valid cells", "edges": [],
                "constant_value": None, "bin_count": 0}
    low, high = bounds
    if low == high:
        return {"basis": "original whole prepared-grid bounds", "edges": [low, high],
                "constant_value": low, "bin_count": 1}
    import numpy as np
    edges = np.linspace(low, high, 33, dtype=np.float64)
    if not np.all(np.diff(edges) > 0):
        raise ValueError("Prepared input bounds cannot define distinct shared histogram edges")
    return {"basis": "original whole prepared-grid bounds", "edges": edges.tolist(),
            "constant_value": None, "bin_count": 32}


def bind(workspace, grid_record):
    """Bind original aligned files and exact retained source metadata without views."""
    key = identifier(grid_record["id"])
    collection_id = identifier(grid_record["spec"]["source_collection_id"])
    collection = workspace._get("sources", collection_id)
    entries = {entry["id"]: entry for entry in collection["entries"]}
    directory = workspace.root / "grids" / key
    variables = {}
    for role in ROLES:
        descriptor = grid_record["files"].get(role)
        original = grid_record["inputs"].get(role)
        if descriptor is None and original is None:
            variables[role] = {"available": False, "label": LABELS[role], "units": None,
                               "reason": "Not prepared for the selected native model scope",
                               "histogram": _histogram(None)}
            continue
        if descriptor is None or original is None:
            raise ValueError("Prepared physical input lost its original file or provenance: " + role)
        source_id = grid_record["spec"]["input_sources"].get(role)
        entry = entries.get(source_id)
        if (entry is None or entry["kind"] != "raster" or original["source_id"] != source_id
                or original["source_sha256"] != entry["body"]["sha256"]
                or original["source_uri"] != entry["uri"] or original["vintage"] != entry["vintage"]):
            raise ValueError("Prepared physical input no longer matches its original source: " + role)
        units = descriptor.get("units")
        conversion = entry.get("conversion")
        source_units = conversion.get("target_units") if conversion else entry.get("units")
        if units != source_units or role in UNITS and units != UNITS[role]:
            raise ValueError("Retain the original prepared physical input units: " + role)
        bounds = _bounds(original, role)
        if role in ("R_FACTOR", "K_FACTOR") and bounds is not None and bounds[0] < 0:
            raise ValueError("Original R and K factors must be nonnegative")
        verify_file(directory, descriptor)
        variables[role] = {
            "available": True, "label": ("Annual precipitation" if role == "PRECIPITATION"
                                        and units == "mm/year" else LABELS[role]),
            "units": units, "aligned_file": deepcopy(descriptor),
            "prepared_input": deepcopy(original),
            "source": {"source_collection_id": collection_id, "source_id": source_id,
                       "entry": deepcopy(entry)},
            "histogram": _histogram(bounds),
        }
    r, k = variables["R_FACTOR"], variables["K_FACTOR"]
    if r["available"] and k["available"]:
        rb, kb = _bounds(r["prepared_input"], "R"), _bounds(k["prepared_input"], "K")
        bounds = None if rb is None or kb is None else [rb[0] * kb[0], rb[1] * kb[1]]
        if bounds is not None and not all(math.isfinite(value) for value in bounds):
            raise ValueError("Original R × K enclosing bounds are not finite")
        histogram = _histogram(bounds)
        histogram["basis"] = "nonnegative whole-grid factor bounds; enclosing, not observed product extrema"
        variables["R_TIMES_K"] = {
            "available": True, "label": LABELS["R_TIMES_K"], "units": UNITS["R_TIMES_K"],
            "derived_from": ["R_FACTOR", "K_FACTOR"], "histogram": histogram,
        }
    else:
        variables["R_TIMES_K"] = {
            "available": False, "label": LABELS["R_TIMES_K"], "units": UNITS["R_TIMES_K"],
            "reason": "Both original prepared R and K factors are required",
            "histogram": _histogram(None),
        }
    return {"schema": SCHEMA, "edition": EDITION, "grid_id": key,
            "grid": deepcopy(grid_record["grid"]), "source_collection_id": collection_id,
            "variables": variables, "notes": list(NOTES)}


def open_sources(workspace, binding, stack):
    import rasterio
    from rasterio.crs import CRS
    from rasterio.transform import Affine
    grid = binding["grid"]
    result = {}
    for role in ROLES:
        variable = binding["variables"][role]
        if not variable["available"]:
            continue
        path = verify_file(workspace.root / "grids" / binding["grid_id"], variable["aligned_file"])
        source = stack.enter_context(rasterio.open(path))
        if (source.count != 1 or source.width != grid["width"] or source.height != grid["height"]
                or source.transform != Affine(*grid["transform"])
                or source.crs != CRS.from_user_input(grid["crs"])):
            raise ValueError("Physical contrasts require the exact original single-band prepared grid")
        result[role] = source
    return result


def read_window(sources, window, binding):
    """Read each prepared scalar once per original allocation window."""
    import numpy as np
    result = {}
    for role, source in sources.items():
        data = source.read(1, window=window, masked=True)
        values = np.asarray(np.ma.getdata(data), dtype=np.float64)
        valid = ~np.ma.getmaskarray(data) & np.isfinite(values)
        if role in ("R_FACTOR", "K_FACTOR") and np.any(valid & (values < 0)):
            raise ValueError("Original prepared R/K contains a negative physical value")
        result[role] = (values, valid)
    if binding["variables"]["R_TIMES_K"]["available"]:
        r, rv = result["R_FACTOR"]
        k, kv = result["K_FACTOR"]
        valid = rv & kv
        values = np.zeros(r.shape, dtype=np.float64)
        values[valid] = r[valid] * k[valid]
        if np.any(valid & ~np.isfinite(values)):
            raise ValueError("Original prepared R × K product is not finite")
        result["R_TIMES_K"] = (values, valid)
    return result


def _moment(variable):
    return {"count": 0, "mean": 0.0, "m2": 0.0, "minimum": None, "maximum": None,
            "histogram": [0] * variable["histogram"]["bin_count"]}


def empty(binding):
    return {"classes": {
        group: {"common_categorical_cells": 0, "overlap_changed_cells": 0,
                "changed_cells": dict.fromkeys(ARMS, 0),
                "samples": {arm: {role: _moment(binding["variables"][role])
                                  for role in VARIABLES} for arm in ARMS}}
        for group in CLASSES}}


def _add(moment, data, variable):
    import numpy as np
    count = int(data.size)
    if not count:
        return
    spec = variable["histogram"]
    if not spec["edges"]:
        raise ValueError("A supposedly empty original prepared input contains valid selected cells")
    low, high = spec["edges"][0], spec["edges"][-1]
    minimum, maximum = float(np.min(data)), float(np.max(data))
    if minimum < low or maximum > high:
        raise ValueError("Selected physical values exceed their original whole-grid histogram bounds")
    mean = float(np.mean(data, dtype=np.float64))
    centered = data - mean
    m2 = float(np.dot(centered, centered))
    if spec["constant_value"] is not None:
        counts = [count]
    else:
        counts = [int(value) for value in np.histogram(data, bins=spec["edges"])[0]]
    if sum(counts) != count or not math.isfinite(mean) or not math.isfinite(m2):
        raise ValueError("Physical statistics lost finite values or histogram support")
    prior, total = moment["count"], moment["count"] + count
    delta = mean - moment["mean"]
    moment["m2"] += m2 + delta * delta * prior * count / total
    moment["mean"] += delta * count / total
    moment["count"] = total
    moment["minimum"] = minimum if moment["minimum"] is None else min(minimum, moment["minimum"])
    moment["maximum"] = maximum if moment["maximum"] is None else max(maximum, moment["maximum"])
    moment["histogram"] = [a + b for a, b in zip(moment["histogram"], counts)]


def accumulate(state, arrays, valid, inside, scalars, binding):
    import numpy as np
    common = inside & valid["baseline"] & valid["restoration"] & valid["control"]
    changed = {arm: common & (arrays[arm] != arrays["baseline"]) for arm in ARMS}
    classes = {"all": common, "81": common & (arrays["baseline"] == 81),
               "82": common & (arrays["baseline"] == 82),
               "other": common & (arrays["baseline"] != 81) & (arrays["baseline"] != 82)}
    for group, selected in classes.items():
        record = state["classes"][group]
        record["common_categorical_cells"] += int(np.count_nonzero(selected))
        record["overlap_changed_cells"] += int(np.count_nonzero(
            selected & changed["restoration"] & changed["control"]))
        for arm in ARMS:
            mask = selected & changed[arm]
            count = int(np.count_nonzero(mask))
            record["changed_cells"][arm] += count
            if not count:
                continue
            for role, (values, finite) in scalars.items():
                _add(record["samples"][arm][role], values[mask & finite], binding["variables"][role])


def finish(state, binding):
    area = binding["grid"]["pixel_area_ha"]
    result = {"schema": SCHEMA, "classes": []}
    for group in CLASSES:
        value = state["classes"][group]
        record = {key: deepcopy(value[key]) for key in (
            "common_categorical_cells", "overlap_changed_cells", "changed_cells")}
        record.update(baseline_class=group, overlap_changed_hectares=value["overlap_changed_cells"] * area,
                      samples={}, mean_differences={})
        for arm in ARMS:
            denominator = value["changed_cells"][arm]
            record["samples"][arm] = {}
            for role in VARIABLES:
                variable, moment = binding["variables"][role], value["samples"][arm][role]
                count = moment["count"]
                if count > denominator or sum(moment["histogram"]) != count:
                    raise ValueError("Physical contrast counts no longer match the selected denominator")
                mean = moment["mean"] if count else None
                deviation = math.sqrt(max(0.0, moment["m2"] / count)) if count else None
                if count and (not math.isfinite(mean) or not math.isfinite(deviation)):
                    raise ValueError("Physical contrast moments are not finite")
                record["samples"][arm][role] = {
                    "available": variable["available"], "units": variable["units"],
                    "selected_cells": denominator, "selected_hectares": denominator * area,
                    "valid_cells": count, "missing_cells": denominator - count,
                    "valid_hectares": count * area, "coverage_fraction": count / denominator if denominator else None,
                    "mean": mean, "population_standard_deviation": deviation,
                    "minimum": moment["minimum"], "maximum": moment["maximum"],
                    "histogram_counts": moment["histogram"],
                }
        for role in VARIABLES:
            r, c = (record["samples"][arm][role] for arm in ARMS)
            record["mean_differences"][role] = {
                "restoration_minus_control": (r["mean"] - c["mean"]
                                               if r["valid_cells"] and c["valid_cells"] else None),
                "units": binding["variables"][role]["units"],
                "restoration_valid_cells": r["valid_cells"], "control_valid_cells": c["valid_cells"],
                "basis": "descriptive difference of independently supported pixel means",
            }
        result["classes"].append(record)
    return result


def _csv(path, fields, rows):
    with Path(path).open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write(directory, report):
    """Retain complete per-region moments and distributions before source import."""
    binding = report["identity"]["physical_input_binding"]
    records = [{key: deepcopy(region[key]) for key in (
        "id", "title", "kind", "relationship", "quantity_scope", "physical_contrasts")}
        for region in report["regions"]]
    atomic_json(directory / MEMBERS[0], {
        "schema": SCHEMA, "allocation_id": report["id"], "project_id": report["project_id"],
        "binding": binding, "run_ids": report["run_ids"], "regions": records, "notes": NOTES})
    def rows(distribution=False):
        for region in records:
            identity = {"region_id": region["id"], "region_title": region["title"],
                        "region_kind": region["kind"], "relationship": region["relationship"],
                        "quantity_scope": region["quantity_scope"]}
            for group in region["physical_contrasts"]["classes"]:
                context = {**identity, "baseline_class": group["baseline_class"],
                           "common_categorical_cells": group["common_categorical_cells"],
                           "overlap_changed_cells": group["overlap_changed_cells"]}
                for arm in ARMS:
                    for role in VARIABLES:
                        sample = group["samples"][arm][role]
                        if not distribution:
                            yield {**context, "scenario": arm, "variable": role,
                                   **{key: value for key, value in sample.items() if key != "histogram_counts"},
                                   "restoration_minus_control_mean": group["mean_differences"][role]["restoration_minus_control"]}
                            continue
                        histogram = binding["variables"][role]["histogram"]
                        for index, count in enumerate(sample["histogram_counts"]):
                            yield {**context, "scenario": arm, "variable": role,
                                "units": sample["units"], "bin_index": index,
                                "lower": histogram["edges"][index], "upper": histogram["edges"][index + 1],
                                "upper_inclusive": index == len(sample["histogram_counts"]) - 1,
                                "valid_cells": sample["valid_cells"], "cells": count,
                                "fraction_of_valid": count / sample["valid_cells"] if sample["valid_cells"] else None,
                                "bound_basis": histogram["basis"]}
    context_fields = ["region_id", "region_title", "region_kind", "relationship", "quantity_scope",
                      "baseline_class", "common_categorical_cells", "overlap_changed_cells", "scenario", "variable"]
    _csv(directory / MEMBERS[1], context_fields + [
        "available", "units", "selected_cells", "selected_hectares", "valid_cells", "missing_cells",
        "valid_hectares", "coverage_fraction", "mean", "population_standard_deviation",
        "minimum", "maximum", "restoration_minus_control_mean"], rows())
    _csv(directory / MEMBERS[2], context_fields + [
        "units", "bin_index", "lower", "upper", "upper_inclusive", "valid_cells", "cells",
        "fraction_of_valid", "bound_basis"], rows(distribution=True))


def _number(value):
    return "Unavailable" if value is None else format(value, ".5g")


def sections(report):
    """Compact original report blocks; complete native rows remain downloadable."""
    binding = report["identity"]["physical_input_binding"]
    blocks = list(NOTES)
    inputs = []
    for role in VARIABLES:
        variable = binding["variables"][role]
        inputs.append([role, variable["label"], variable["units"] or "Not declared",
                       "Available" if variable["available"] else variable["reason"]])
    blocks.append({"kind": "table", "columns": ["Input", "Meaning", "Declared units", "Availability"],
                   "rows": inputs, "widths": None, "caption": "Exact aligned native inputs; source identities, conversions and common histogram edges are retained in physical-contrasts.json."})
    blocks.append("Complete physical-contrasts.csv contains every region, original-class group, arm and variable with selected/valid/missing counts, mean, population standard deviation and extrema. physical-distributions.csv contains every shared histogram bin. Classes all/81/82/other and changed-pixel overlap remain explicit.")
    blocks.append({"kind": "links", "items": [
        {"path": MEMBERS[0], "title": "Complete physical-input identities and every regional contrast (JSON)"},
        {"path": MEMBERS[1], "title": "All region, baseline-class and scenario statistics (CSV)"},
        {"path": MEMBERS[2], "title": "All shared physical-input histogram bins (CSV)"},
    ]})
    output = [["Physical setting of the actual changed pixels", blocks]]
    for region in report["regions"]:
        if region["kind"] not in ("whole_selection", "utility_upstream_union"):
            continue
        group = next(value for value in region["physical_contrasts"]["classes"] if value["baseline_class"] == "all")
        rows = []
        for role in VARIABLES:
            r, c = (group["samples"][arm][role] for arm in ARMS)
            rows.append([binding["variables"][role]["label"], r["units"] or "Not declared",
                         str(r["valid_cells"]) + "/" + str(r["selected_cells"]),
                         _number(r["mean"]), str(c["valid_cells"]) + "/" + str(c["selected_cells"]),
                         _number(c["mean"]), _number(group["mean_differences"][role]["restoration_minus_control"])])
        output.append([region["title"] + " — " + region["quantity_scope"] + ": changed-pixel physical inputs", [
            region["relationship"] + ". Restoration/control changed-pixel overlap: " +
            str(group["overlap_changed_cells"]) + " cells. All baseline classes shown; original 81/82/other details remain in the complete data.",
            {"kind": "table", "columns": ["Input", "Units", "R valid/selected", "R mean",
                                         "C valid/selected", "C mean", "R − C mean"],
             "rows": rows, "widths": None,
             "caption": "Descriptive means on each arm's finite input support. They do not estimate scenario-induced physical change or a native pollutant effect."},
        ]])
    return output
