"""Observed multi-year class trajectories inside the original ledger tile transaction.

All areas use the ledger's fractional polygon weights and one common supported
mask across every selected observation. No intervening year is interpolated.
"""
from __future__ import annotations
import json
import math
from pathlib import Path
import zlib

import numpy as np
import rasterio

SCHEMA = "upstate.landcover-timeline/v1"
STATUS = {1: "stable", 2: "changed_once", 3: "changed_multiple", 4: "returned_to_initial"}
RASTERS = {
    "sequence": "timeline-class-sequence.tif",
    "status": "timeline-status.tif",
    "change_count": "timeline-change-count-plus-one.tif",
    "final_observations": "timeline-final-class-observations.tif",
    "last_change_to_year": "timeline-last-transition-to-year.tif",
    "forest_status": "timeline-forest-status.tif",
}


def years(value, count=None):
    from .landcover_ledger import LedgerError
    if (not isinstance(value, (list, tuple)) or len(value) < 2
            or any(type(year) is not int or not 1 <= year <= 9999 for year in value)
            or any(a >= b for a, b in zip(value, value[1:]))
            or count is not None and len(value) != count):
        raise LedgerError("Choose at least two distinct observation years in increasing order, one per retained source band")
    return list(value)


def describe(codes, observation_years):
    """The observed class path, including returns after any previously left class."""
    changed_at = [i for i in range(1, len(codes)) if codes[i] != codes[i - 1]]
    seen = {codes[0]}
    reversals = 0
    for i in changed_at:
        reversals += int(codes[i] in seen)
        seen.add(codes[i])
    last = changed_at[-1] if changed_at else 0
    returned = bool(changed_at and codes[-1] == codes[0])
    status = ("returned_to_initial" if returned else "changed_multiple" if len(changed_at) > 1
              else "changed_once" if changed_at else "stable")
    return {
        "change_count": len(changed_at), "reversal_count": reversals,
        "returned_to_initial": returned,
        "last_change_from_year": observation_years[last - 1] if changed_at else None,
        "last_change_to_year": observation_years[last] if changed_at else None,
        "final_class_observations": len(codes) - last,
        "status": status,
    }


def prepare_tile(values, mask, observation_years):
    """Deduplicate actual cell sequences once; retain the exact common-support mask."""
    matrix = np.stack([value[0][mask] for value in values], axis=1)
    patterns, inverse = np.unique(matrix, axis=0, return_inverse=True)
    details = [describe([int(code) for code in row], observation_years) for row in patterns]
    return {"mask": mask, "patterns": patterns, "inverse": inverse, "details": details}


def tile_delta(prepared, weights, cell_ha):
    selected = weights[prepared["mask"]]
    size = len(prepared["patterns"])
    hectares = np.bincount(prepared["inverse"], weights=selected * cell_ha, minlength=size)
    counts = np.bincount(prepared["inverse"], weights=(selected > 0).astype(np.int64), minlength=size)
    return {"patterns": [[row.tolist(), float(hectares[i]), int(counts[i])]
                         for i, row in enumerate(prepared["patterns"]) if counts[i] > 0]}


def initialize_rasters(output, source, observation_years, resume):
    from .landcover_ledger import LedgerError
    paths = {key: Path(output) / name for key, name in RASTERS.items()}
    for key, path in paths.items():
        count = len(observation_years) if key == "sequence" else 1
        dtype = "uint8" if key in ("sequence", "status", "forest_status") else "uint16"
        if resume:
            if not path.is_file():
                raise LedgerError("Temporal checkpoint raster missing: " + str(path))
            with rasterio.open(path) as retained:
                if (retained.width, retained.height, retained.crs, retained.transform,
                        retained.count, retained.dtypes[0], retained.nodata) != (
                        source.width, source.height, source.crs, source.transform, count, dtype, 0):
                    raise LedgerError("Temporal checkpoint raster grid or encoding changed")
            continue
        with rasterio.open(path, "w", driver="GTiff", width=source.width, height=source.height,
                           count=count, dtype=dtype, crs=source.crs, transform=source.transform,
                           nodata=0, compress="deflate", tiled=True, blockxsize=256, blockysize=256,
                           BIGTIFF="IF_SAFER") as target:
            target.update_tags(ledger_timeline_schema=SCHEMA, selected_years=json.dumps(observation_years))
            if key == "sequence":
                for band, year in enumerate(observation_years, 1):
                    target.set_band_description(band, str(year) + " observed NLCD class; zero excluded")
            else:
                descriptions = {
                    "status": "1 stable; 2 one observed transition; 3 multiple; 4 returned to initial class; 0 excluded",
                    "change_count": "Observed adjacent class transition count plus one; 0 excluded",
                    "final_observations": "Trailing selected observations in the final class; 0 excluded",
                    "last_change_to_year": "Later selected year of last observed transition; 0 stable or excluded (use status)",
                    "forest_status": "1 always forest; 2 always outside forest; 3 ended in forest after entry; 4 ended outside after exit; 5 returned to initial membership; 0 excluded",
                }
                target.set_band_description(1, descriptions[key])
    return paths


def write_rasters(paths, values, prepared, window, shape):
    from .landcover_ledger import GROUPS
    mask = prepared["mask"] if prepared is not None else np.zeros(shape, dtype=bool)
    status_codes = {value: key for key, value in STATUS.items()}
    patterns = prepared["patterns"] if prepared is not None else []
    details = prepared["details"] if prepared is not None else []
    forest = set(GROUPS["forest"])
    forest_codes = []
    for pattern in patterns:
        present = [int(code) in forest for code in pattern]
        if all(present):
            value = 1
        elif not any(present):
            value = 2
        elif present[-1] == present[0]:
            value = 5
        else:
            value = 3 if present[-1] else 4
        forest_codes.append(value)
    # Every raster closes before the caller commits this tile's original SQLite row.
    for key, path in paths.items():
        with rasterio.open(path, "r+") as target:
            if key == "sequence":
                for band in range(1, target.count + 1):
                    data = np.zeros(shape, dtype=np.uint8)
                    if values is not None:
                        data[mask] = values[band - 1][0][mask]
                    target.write(data, band, window=window)
                continue
            data = np.zeros(shape, dtype=target.dtypes[0])
            if prepared is not None and len(patterns):
                if key == "status":
                    lookup = [status_codes[row["status"]] for row in details]
                elif key == "change_count":
                    lookup = [row["change_count"] + 1 for row in details]
                elif key == "final_observations":
                    lookup = [row["final_class_observations"] for row in details]
                elif key == "last_change_to_year":
                    lookup = [row["last_change_to_year"] or 0 for row in details]
                else:
                    lookup = forest_codes
                data[mask] = np.asarray(lookup, dtype=data.dtype)[prepared["inverse"]]
            target.write(data, 1, window=window)


def aggregate(db, report, observation_years):
    from .landcover_ledger import CLASSES, GROUPS, LedgerError
    observation_years = years(observation_years, len(report["scenarios"]) + 1)
    totals = {zone["id"]: {} for zone in report["zones"]}
    for (payload,) in db.execute("SELECT payload FROM tiles ORDER BY tile_id"):
        for delta in json.loads(zlib.decompress(payload)):
            if "temporal" not in delta:
                continue
            accumulator = totals[delta["zone_id"]]
            for codes, area, count in delta["temporal"]["patterns"]:
                key = tuple(codes)
                prior = accumulator.setdefault(key, [0.0, 0])
                prior[0] += area
                prior[1] += count
    support = {row["zone_id"]: row["support"] for row in report["rows"]
               if row["scenario"] == report["scenarios"][0]}
    rows = []
    for zone in report["zones"]:
        analysis = support[zone["id"]]["analysis_valid_ha"]
        covered = support[zone["id"]]["covered_ha"]
        patterns = totals[zone["id"]]
        if not math.isclose(sum(value[0] for value in patterns.values()), analysis, rel_tol=3e-10, abs_tol=1e-8):
            raise LedgerError("Temporal sequence totals differ from the original common-support ledger")
        annual = [{code: 0.0 for code in CLASSES} for year in observation_years]
        adjacent = [{} for year in observation_years[1:]]
        summary = dict.fromkeys((
            "stable_ha", "changed_ha", "one_observed_transition_ha", "multiple_observed_transitions_ha",
            "returned_to_initial_ha", "changed_without_return_ha", "persistent_final_ha",
            "unconfirmed_final_ha", "forest_internal_only_ha", "forest_exit_ha", "forest_entry_ha"), 0.0)
        groups = {name: dict.fromkeys(("stable_present_ha", "stable_absent_ha",
                                      "entered_ha", "exited_ha", "returned_ha"), 0.0) for name in GROUPS}
        trajectories = []
        for codes, (area, count) in sorted(patterns.items()):
            detail = describe(codes, observation_years)
            trajectories.append({"codes": list(codes), "ha": area, "intersecting_cells": count, **detail})
            changes = detail["change_count"]
            summary["changed_ha" if changes else "stable_ha"] += area
            if changes:
                summary["one_observed_transition_ha" if changes == 1 else "multiple_observed_transitions_ha"] += area
                summary["returned_to_initial_ha" if detail["returned_to_initial"] else "changed_without_return_ha"] += area
                summary["persistent_final_ha" if detail["final_class_observations"] >= 2 else "unconfirmed_final_ha"] += area
            for i, code in enumerate(codes):
                annual[i][code] += area
            for i, pair in enumerate(zip(codes, codes[1:])):
                entry = adjacent[i].setdefault(pair, [0.0, 0])
                entry[0] += area
                entry[1] += count
            for name, members in GROUPS.items():
                present = [code in members for code in codes]
                enters = any(not a and b for a, b in zip(present, present[1:]))
                exits = any(a and not b for a, b in zip(present, present[1:]))
                returned = (enters or exits) and present[-1] == present[0]
                if all(present):
                    groups[name]["stable_present_ha"] += area
                if not any(present):
                    groups[name]["stable_absent_ha"] += area
                if enters:
                    groups[name]["entered_ha"] += area
                if exits:
                    groups[name]["exited_ha"] += area
                if returned:
                    groups[name]["returned_ha"] += area
                if name == "forest":
                    if changes and all(present):
                        summary["forest_internal_only_ha"] += area
                    if exits:
                        summary["forest_exit_ha"] += area
                    if enters:
                        summary["forest_entry_ha"] += area
        rows.append({
            "zone_id": zone["id"], "zone_name": zone["name"],
            "analysis_ha": analysis, "covered_ha": covered,
            "coverage_pct": analysis / covered * 100 if covered else None,
            "trajectories": trajectories,
            "annual": [{"year": year, "classes": [{"code": code, "ha": area} for code, area in counts.items()]}
                       for year, counts in zip(observation_years, annual)],
            "adjacent": [{"from_year": a, "to_year": b, "transitions": [
                {"from_code": pair[0], "to_code": pair[1], "ha": values[0], "intersecting_cells": values[1]}
                for pair, values in sorted(counts.items())]}
                         for a, b, counts in zip(observation_years, observation_years[1:], adjacent)],
            "summary": summary if analysis else dict.fromkeys(summary, None),
            "groups": groups if analysis else {name: dict.fromkeys(values, None) for name, values in groups.items()},
        })
    return {
        "schema": SCHEMA, "years": observation_years,
        "intervals": [{"from_year": a, "to_year": b, "gap_years": b - a}
                      for a, b in zip(observation_years, observation_years[1:])],
        "rows": rows,
        "interpretation": [
            "Every annual, adjacent and whole-trajectory total uses the same supported pixels across all selected observations and the original fractional watershed boundaries.",
            "Selected years are observed source labels. An interval brackets a mapped transition; missing years are not interpolated and its event date is not inferred.",
            "Changed area means at least one observed class transition, even when the first and last classes agree. Reversal count counts a return to any previously observed class after leaving it.",
            "Persistent final area means changed cells whose final class appears in at least two trailing selected observations. It describes observed retention, not continuous duration, verified ground change or future permanence.",
            "Entry and exit group areas each count a cell once if that crossing occurred anywhere in its sequence. They overlap for returning paths and must not be added as disjoint categories.",
            "Forest internal-only area changes among 41, 42 and 43 while remaining in that forest group in every selected observation. Woody wetland 90 remains a separate NLCD wetland class.",
            "Two observations support an endpoint transition only. Repeated final-state evidence and observed returns require additional selected observations.",
            "Classification disagreement and source revision can contribute to apparent changes; use consistent product collections, original metadata and confidence/reference products when interpreting real land change.",
            "A cell crossing watershed boundaries has positive-area counts in each intersected zone; use fractional hectares, and use the unique domain for study-wide totals.",
        ],
        "raster_encoding": {
            "sequence": "One band per selected year in the same order; original NLCD code; 0 excluded.",
            "status": STATUS,
            "change_count": "Stored value minus one; 0 excluded.",
            "final_observations": "Number of trailing selected observations equal to the final class; 0 excluded.",
            "last_change_to_year": "Later selected year of last transition; 0 stable or excluded (distinguish with status).",
            "forest_status": {1: "always forest", 2: "always outside forest", 3: "ended in forest after entry",
                              4: "ended outside forest after exit", 5: "returned to initial forest membership"},
        },
    }


def export_csv(root, report):
    """Complete tabular receiving for the same original report and its chronology."""
    from .landcover_exports import _csv
    from .landcover_ledger import LedgerError
    timeline = report.get("timeline")
    if timeline is None:
        return
    selected_years = years(timeline.get("years"), len(report["scenarios"]) + 1)
    if timeline.get("schema") != SCHEMA or report["options"]["support_scope"] != "all":
        raise LedgerError("Retain the complete all-observation timeline")
    if {row["zone_id"] for row in timeline["rows"]} != {zone["id"] for zone in report["zones"]}:
        raise LedgerError("Timeline zone inventory differs from the original ledger")
    summaries, trajectories, annual, adjacent, groups = [], [], [], [], []
    for row in timeline["rows"]:
        key = {"zone_id": row["zone_id"], "zone_name": row["zone_name"]}
        summaries.append({**key, "analysis_ha": row["analysis_ha"], "covered_ha": row["covered_ha"],
                          "coverage_pct": row["coverage_pct"], **row["summary"]})
        for trajectory in row["trajectories"]:
            trajectories.append({**key, "codes_by_selected_year": "|".join(map(str, trajectory["codes"])),
                                 **{name: value for name, value in trajectory.items() if name != "codes"}})
        for observed in row["annual"]:
            for item in observed["classes"]:
                annual.append({**key, "year": observed["year"], **item,
                               "class": report["classes"][str(item["code"])]})
        for interval in row["adjacent"]:
            for item in interval["transitions"]:
                adjacent.append({**key, "from_year": interval["from_year"], "to_year": interval["to_year"],
                                 **item, "from_class": report["classes"][str(item["from_code"])],
                                 "to_class": report["classes"][str(item["to_code"])]})
        for name, item in row["groups"].items():
            groups.append({**key, "group": name, **item})
    prefix = ["zone_id", "zone_name"]
    _csv(root / "timeline-summary.csv", list(summaries[0]), summaries)
    _csv(root / "timeline-trajectories.csv", prefix + [
        "codes_by_selected_year", "ha", "intersecting_cells", "change_count", "reversal_count",
        "returned_to_initial", "last_change_from_year", "last_change_to_year", "final_class_observations", "status"], trajectories)
    _csv(root / "timeline-annual-classes.csv", prefix + ["year", "code", "class", "ha"], annual)
    _csv(root / "timeline-adjacent-transitions.csv", prefix + [
        "from_year", "to_year", "from_code", "from_class", "to_code", "to_class", "ha", "intersecting_cells"], adjacent)
    _csv(root / "timeline-groups.csv", prefix + [
        "group", "stable_present_ha", "stable_absent_ha", "entered_ha", "exited_ha", "returned_ha"], groups)
    editions = report.get("source_editions")
    if editions is not None:
        originals = [editions["baseline"], *editions["alternatives"]]
        observations = [{
            "observation_year": year, "source_label": item["label"], "source_vintage": item.get("source_time") or "",
            "source_collection_id": item["source_collection_id"], "source_id": item["source_id"],
            "band": item["band"], "raster_bytes": item["raster"]["bytes"],
            "raster_sha256": item["raster"]["sha256"], "original_uri": item.get("source_uri") or "",
        } for year, item in zip(selected_years, originals)]
    else:
        inputs = {item["role"]: item for item in report["inputs"]}
        observations = [{
            "observation_year": year, "role": role, "path": inputs[role]["path"],
            "raster_bytes": inputs[role]["bytes"], "raster_sha256": inputs[role]["sha256"],
        } for year, role in zip(selected_years, ["baseline", *["scenario:" + key for key in report["scenarios"]]])]
    _csv(root / "timeline-source-years.csv", list(observations[0]), observations)
