"""Export native watershed/scenario decisions from an existing scientific Workspace."""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import csv
import io
import json
import math
from pathlib import Path
import sys

from .common import (INVEST_VERSION, atomic_bytes, atomic_json, canonical,
                     describe_file, digest, file_digest, held, identifier, now, read_json, verify_file)
from .workspace import Workspace
from . import rasters
from .native_versions import model_versions

SCHEMA = "upstate.scenario-decisions/v1"
SELECTION_SCHEMA = "upstate.scenario-decision-selection/v1"
OUTPUTS = {
    "nitrogen": {"stage": "ndr", "output": "n_total_export", "stream": "stream",
                 "units": "kg/year", "rate_units": "kg/ha/year", "title": "Nitrogen export"},
    "phosphorus": {"stage": "ndr", "output": "p_surface_export", "stream": "stream",
                   "units": "kg/year", "rate_units": "kg/ha/year", "title": "Phosphorus export"},
    "sediment": {"stage": "sdr", "output": "sed_export", "stream": "stream",
                 "units": "metric_tonnes/year", "rate_units": "metric_tonnes/ha/year",
                 "title": "Sediment export"},
}


def delivery_context(value):
    """Validate an explicit report handoff using the native delivery contract."""
    if "delivery_mode" not in value:
        if "native_study" in value:
            raise ValueError("Choose native_study delivery mode for original study metadata")
        return {}
    from . import native_study

    original = {"delivery_mode": value["delivery_mode"]}
    if "native_study" in value:
        original["native_study"] = value["native_study"]
    is_study = native_study.prepare(original)
    if not is_study and "native_study" in original:
        raise ValueError("Original study metadata belongs to native_study delivery mode")
    result = {"delivery_mode": original["delivery_mode"]}
    if is_study:
        result["native_study"] = original["native_study"]
    return result


def selection(value):
    allowed = {"schema", "title", "run_ids", "zones", "pollutants",
               "delivery_mode", "native_study"}
    if not isinstance(value, dict) or set(value) - allowed:
        raise ValueError("Use a scenario decision selection with schema, title, run_ids, zones, optional pollutants and optional original delivery context")
    if value.get("schema") != SELECTION_SCHEMA:
        raise ValueError("Select upstate.scenario-decision-selection/v1")
    if not isinstance(value.get("title"), str) or not value["title"].strip():
        raise ValueError("Name the watershed scenario report")
    ids = value.get("run_ids")
    if (not isinstance(ids, list) or len(ids) < 1
            or any(not isinstance(k, str) for k in ids) or len(set(ids)) != len(ids)):
        raise ValueError("Select a completed reference run followed by any distinct alternative run IDs")
    if "pollutants" in value:
        pollutants = value["pollutants"]
        if (not isinstance(pollutants, list) or not pollutants
                or any(not isinstance(k, str) or k not in OUTPUTS for k in pollutants)
                or len(set(pollutants)) != len(pollutants)):
            raise ValueError("Select distinct available nitrogen, phosphorus or sediment outputs")
    zones = value.get("zones", [])
    if not isinstance(zones, list) or any(not isinstance(z, dict) for z in zones):
        raise ValueError("Additional source zones must be a list of selections")
    for zone in zones:
        permitted = {"id", "title", "source_collection_id", "source_id", "layer",
                     "where", "id_field", "label_field", "feature_ids", "scope"}
        if set(zone) - permitted:
            raise ValueError("Unknown zone fields: " + ", ".join(sorted(set(zone) - permitted)))
        for name in ("id", "title", "source_collection_id", "source_id", "id_field"):
            if not isinstance(zone.get(name), str) or not zone[name].strip():
                raise ValueError("Each zone source needs " + name)
        if zone.get("scope", "whole") not in ("whole", "reporting_intersection"):
            raise ValueError("Zone scope is whole or reporting_intersection")
        if "where" in zone and not isinstance(zone["where"], dict):
            raise ValueError("Zone where is an exact original attribute selection")
        if "feature_ids" in zone and (not isinstance(zone["feature_ids"], list)
                or not zone["feature_ids"] or any(not isinstance(k, str) for k in zone["feature_ids"])):
            raise ValueError("feature_ids must retain complete original string identities")
    return {**value, **delivery_context(value)}


def available_pollutants(run):
    """Names of completed native export stages retained by this run."""
    stages = run.get("stages", {})
    result = []
    for pollutant, spec in OUTPUTS.items():
        stage = stages.get(spec["stage"], {})
        files = stage.get("files", {})
        if (stage.get("completed_at") and spec["output"] in files
                and (spec["stream"] in files or
                     spec["stage"] == "sdr" and "stream_and_drainage" in files)):
            result.append(pollutant)
    return result


def _selected_models(pollutants):
    return tuple(dict.fromkeys(OUTPUTS[name]["stage"] for name in pollutants))


def _supported_pollutants(run, pollutants):
    versions = model_versions(run, _selected_models(pollutants))
    return [name for name in pollutants
            if versions[OUTPUTS[name]["stage"]]["comparison_version"] == INVEST_VERSION]


def catalog(workspace):
    """Fast original run/source choices; build verifies the chosen file bodies."""
    profiles = {p["id"]: p for p in workspace._list("profiles")}
    scenarios = {s["id"]: s for s in workspace._list("scenarios")}
    runs, issues = [], []
    for path in sorted((workspace.root / "runs").glob("*/run.json")):
        try:
            run = workspace.inspect_run(path.parent.name)
            selected = run["selection"]
            profile = profiles[selected["profile_id"]]
            scenario = scenarios[selected["scenario_id"]]
            available = available_pollutants(run)
            outputs = _supported_pollutants(run, available)
            versions = model_versions(run, _selected_models(available))
            ready = run.get("state") == "complete" and bool(outputs)
            runs.append({
                "id": run["id"], "state": run.get("state"), "reportable": ready,
                "selection": selected, "pollutants": outputs,
                "available_pollutants": available, "model_versions": versions,
                "excluded_pollutants": [
                    {"pollutant": name, "model": OUTPUTS[name]["stage"],
                     "version": versions[OUTPUTS[name]["stage"]]["comparison_version"],
                     "required_version": INVEST_VERSION}
                    for name in available if name not in outputs],
                "scenario_title": scenario.get("title", scenario["id"]),
                "scenario_kind": scenario["kind"],
                "profile_title": profile.get("title", profile["id"]),
                "completed_at": run.get("completed_at"),
                "runtime_version": (run.get("runtime") or {}).get("version"),
            })
        except (ValueError, OSError, KeyError, TypeError) as error:
            issues.append({"run_id": path.parent.name, "error": str(error)})
    groups = {}
    for run in runs:
        if not run["reportable"]:
            continue
        selected = run["selection"]
        grouping = {"grid_id": selected["grid_id"], "profile_id": selected["profile_id"],
                    "pollutants": run["pollutants"]}
        key = digest(grouping)
        group = groups.setdefault(key, {"id": key, **grouping, "run_ids": [],
                                        "baseline_run_ids": [], "alternative_run_ids": []})
        group["run_ids"].append(run["id"])
        group["baseline_run_ids" if run["scenario_kind"] == "baseline"
              else "alternative_run_ids"].append(run["id"])
    vectors = []
    for source in workspace.sources():
        for entry in source.get("entries", []):
            if entry.get("kind") == "vector":
                vectors.append({"source_collection_id": source["id"], "source_id": entry["id"],
                                "title": entry.get("title", entry["id"]), "layer": entry.get("layer"),
                                "uri": entry.get("uri"), "vintage": entry.get("vintage"),
                                "scope": entry.get("scope")})
    saved = []
    for path in sorted((workspace.root / "scenario-decisions").glob("*/decision.json")):
        row = read_json(path)
        saved.append({k: row[k] for k in ("id", "title", "created_at", "baseline_run_id",
                                        "selection", "zones", "runs", "pollutants", "report_kind") if k in row})
    return {"schema": "upstate.scenario-decision-catalog/v1", "project": workspace.project,
            "runs": runs, "cohorts": list(groups.values()), "zone_sources": vectors,
            "reports": saved, "issues": issues, "outputs": OUTPUTS,
            "utility_focus_huc12": ["030601010703", "030601010704", "030601020507", "030601020502"]}


def select_cohort(workspace, baseline_run_id, *, alternative_run_ids=None,
                  title=None, pollutants=None, zones=None,
                  delivery_mode=None, native_study=None):
    """Construct a retained selection from actual completed runs, then build it."""
    choices = catalog(workspace)
    eligible = {run["id"]: run for run in choices["runs"] if run["reportable"]}
    if baseline_run_id not in eligible:
        raise ValueError("Choose an available completed baseline run from the decision catalog")
    baseline = eligible[baseline_run_id]
    if alternative_run_ids is None:
        alternative_run_ids = [
            run["id"] for run in choices["runs"]
            if run["reportable"] and run["id"] != baseline_run_id
            and run["selection"]["grid_id"] == baseline["selection"]["grid_id"]
            and run["selection"]["profile_id"] == baseline["selection"]["profile_id"]
            and run["scenario_kind"] == "landcover"
            and run["pollutants"] == baseline["pollutants"]]
    if not isinstance(alternative_run_ids, list):
        raise ValueError("Alternative run IDs must be a list; an empty list reports reference totals")
    for key in alternative_run_ids:
        if key not in eligible:
            raise ValueError("The selected alternative is not a completed native run: " + str(key))
        if eligible[key]["selection"]["grid_id"] != baseline["selection"]["grid_id"]:
            raise ValueError("Use alternatives from the same retained native grid")
    value = {"schema": SELECTION_SCHEMA,
             "title": title or "Watershed scenarios - " + baseline["profile_title"],
             "run_ids": [baseline_run_id] + alternative_run_ids, "zones": zones or []}
    if pollutants is not None:
        value["pollutants"] = pollutants
    else:
        selected_runs = [baseline] + [eligible[key] for key in alternative_run_ids]
        value["pollutants"] = [p for p in OUTPUTS if all(p in r["pollutants"] for r in selected_runs)]
    if delivery_mode is not None:
        value["delivery_mode"] = delivery_mode
    if native_study is not None:
        value["native_study"] = native_study
    return selection(value)


def inspect(workspace, report_id, *, include_report=True):
    """Reopen saved native products without rerunning the model or aggregation."""
    report_id = identifier(report_id)
    directory = workspace.root / "scenario-decisions" / report_id
    summary = read_json(directory / "decision.json")
    if summary.get("id") != report_id or summary.get("schema") != SCHEMA:
        raise ValueError("Retained scenario report identity differs")
    paths = {kind: verify_file(directory, item) for kind, item in summary["files"].items()}
    if include_report:
        report = read_json(paths["json"])
        if report.get("id") != report_id or report.get("schema") != SCHEMA:
            raise ValueError("Retained quantitative report identity differs")
        return {"summary": summary, "report": report}
    return {"summary": summary}


def _geometry_zones(workspace, grid, requests):
    from pyproj import CRS
    from shapely.geometry import mapping
    from shapely.ops import unary_union
    crs = CRS.from_user_input(grid["grid"]["crs"])
    grid_root = workspace.root / "grids" / grid["id"]
    zones = []
    study_title = str(workspace.project.get("title") or grid.get("spec", {}).get("title") or "Study").strip() or "Study"
    for key, title in (("reporting_area", study_title + " reporting area"),
                       ("model_domain", "Complete retained hydrologic model domain")):
        item = grid["files"][key]
        path = verify_file(grid_root, item)
        rows, _ = rasters.vector_geometry(path, target_crs=crs)
        geometry = rasters.polygon_union(rows)
        zones.append({"id": key, "title": title, "scope": "whole",
                      "geometry": geometry,
                      "source": {"kind": "retained_grid", "grid_id": grid["id"],
                                 "file": item, "role": key},
                      "original_area_ha": geometry.area / 10000})
    reporting = zones[0]["geometry"]
    for request in requests:
        source_path, entry = workspace.source_file(request["source_collection_id"],
                                                   request["source_id"])
        rows, _ = rasters.vector_geometry(source_path, layer=request.get("layer") or entry.get("layer"),
                                          where=request.get("where"), target_crs=crs)
        wanted = set(request.get("feature_ids", []))
        found = set()
        grouped = {}
        for row in rows:
            native_id = row["properties"].get(request["id_field"])
            if native_id is None:
                raise ValueError("Original zone identity is null: " + request["id_field"])
            native_id = str(native_id)
            if wanted and native_id not in wanted:
                continue
            if native_id in grouped:
                raise ValueError("Zone feature identity repeats; select a unique native field: " + native_id)
            found.add(native_id)
            geometry = row["geometry"]
            if geometry.geom_type not in ("Polygon", "MultiPolygon"):
                raise ValueError("Watershed report zones require polygon geometry")
            original_area = geometry.area / 10000
            if request.get("scope", "whole") == "reporting_intersection":
                geometry = geometry.intersection(reporting)
            if geometry.is_empty or geometry.area <= 0:
                continue
            label = row["properties"].get(request.get("label_field", "")) or native_id
            grouped[native_id] = {
                "id": request["id"] + ":" + native_id,
                "title": request["title"] + " - " + str(label),
                "feature_id": native_id, "scope": request.get("scope", "whole"),
                "geometry": geometry, "original_area_ha": original_area,
                "source": {"kind": "source_feature", "source_collection_id": request["source_collection_id"],
                           "source_id": request["source_id"], "uri": entry.get("uri"),
                           "vintage": entry.get("vintage"), "body": entry["body"],
                           "layer": request.get("layer") or entry.get("layer"),
                           "id_field": request["id_field"], "where": request.get("where"),
                           "original_attributes": row["properties"]},
            }
        if wanted - found:
            raise ValueError("Original source lacks selected zone identities: " + ", ".join(sorted(wanted - found)))
        zones.extend(grouped[k] for k in sorted(grouped))
    identities = [z["id"] for z in zones]
    if len(identities) != len(set(identities)):
        raise ValueError("Report zone IDs must be unique")
    for zone in zones:
        geometry = zone["geometry"]
        if not geometry.is_valid or not math.isfinite(geometry.area) or geometry.area <= 0:
            raise ValueError("Selected zone requires a geometry correction: " + zone["id"])
        zone["area_ha"] = geometry.area / 10000
    return zones, crs


def _stage_path(workspace, run, spec, kind):
    files = run["stages"][spec["stage"]]["files"]
    name = spec[kind]
    if kind == "stream" and spec["stage"] == "sdr":
        stage = run["stages"]["sdr"]
        arguments = read_json(verify_file(workspace.root / "runs" / run["id"], stage["arguments"]))
        if arguments.get("drainage_path"):
            name = "stream_and_drainage"
    if name not in files:
        raise ValueError("Original " + spec["stage"] + " registry lacks " + name)
    record = files[name]
    return verify_file(workspace.root / "runs" / run["id"], record), record


def _empty_stats():
    return {"valid_cells": 0, "structural_stream_cells": 0,
            "unexpected_missing_cells": 0, "unknown_stream_cells": 0,
            "all_valid_mass": 0.0, "common_mass": 0.0}


def _summarize_zone(geometry, datasets, streams, run_ids, crs):
    import numpy as np
    from rasterio.errors import WindowError
    from rasterio.features import geometry_mask, geometry_window
    from rasterio.windows import Window
    from shapely.geometry import Polygon

    reference = datasets[0]
    pixel_area = abs(reference.transform.a * reference.transform.e
                     - reference.transform.b * reference.transform.d) / 10000
    extent = Polygon([reference.transform * point for point in
                      ((0, 0), (reference.width, 0),
                       (reference.width, reference.height), (0, reference.height))])
    outside_area = geometry.difference(extent).area / 10000
    stats = {key: _empty_stats() for key in run_ids}
    paired = {key: {"valid_cells": 0, "baseline_mass": 0.0, "alternative_mass": 0.0,
                    "baseline_only_cells": 0, "alternative_only_cells": 0} for key in run_ids[1:]}
    selected = common_count = structural_all = support_changed = 0
    try:
        bounds = geometry_window(reference, [geometry.__geo_interface__])
    except WindowError:
        bounds = None
    if bounds is not None:
        bh, bw = reference.block_shapes[0]
        for row in range(max(0, int(bounds.row_off) // bh * bh),
                         min(reference.height, math.ceil(bounds.row_off + bounds.height)), bh):
            for col in range(max(0, int(bounds.col_off) // bw * bw),
                             min(reference.width, math.ceil(bounds.col_off + bounds.width)), bw):
                window = Window(col, row, min(bw, reference.width-col),
                                min(bh, reference.height-row))
                shape = (int(window.height), int(window.width))
                inside = geometry_mask([geometry.__geo_interface__], out_shape=shape,
                                       transform=reference.window_transform(window),
                                       all_touched=False, invert=True)
                if not np.any(inside):
                    continue
                selected += int(np.count_nonzero(inside))
                arrays, valid_masks, structural_masks = [], [], []
                for key, source, stream in zip(run_ids, datasets, streams):
                    values = source.read(1, window=window, masked=True)
                    flow = stream.read(1, window=window, masked=True)
                    raw = np.ma.getdata(values).astype("float64")
                    masked = np.ma.getmaskarray(values)
                    good = inside & ~masked & np.isfinite(raw)
                    if np.any(raw[good] < 0):
                        raise ValueError("Original export contains a negative rate")
                    flow_raw = np.ma.getdata(flow)
                    known_flow = (~np.ma.getmaskarray(flow) & np.isfinite(flow_raw)
                                  & ((flow_raw == 0) | (flow_raw == 1)))
                    structural = inside & masked & known_flow & (flow_raw == 1)
                    value = stats[key]
                    value["valid_cells"] += int(np.count_nonzero(good))
                    value["structural_stream_cells"] += int(np.count_nonzero(structural))
                    value["unexpected_missing_cells"] += int(np.count_nonzero(inside & ~good & ~structural))
                    value["unknown_stream_cells"] += int(np.count_nonzero(inside & ~known_flow))
                    value["all_valid_mass"] += float(np.sum(raw[good], dtype="float64")) * pixel_area
                    arrays.append(raw)
                    valid_masks.append(good)
                    structural_masks.append(structural)
                common = np.logical_and.reduce(valid_masks)
                same_structural = np.logical_and.reduce(structural_masks)
                changed = np.logical_or.reduce(valid_masks) & ~common
                common_count += int(np.count_nonzero(common))
                structural_all += int(np.count_nonzero(same_structural))
                support_changed += int(np.count_nonzero(changed))
                for key, raw in zip(run_ids, arrays):
                    stats[key]["common_mass"] += float(np.sum(raw[common], dtype="float64")) * pixel_area
                for index, key in enumerate(run_ids[1:], 1):
                    pair_mask = valid_masks[0] & valid_masks[index]
                    pair = paired[key]
                    pair["valid_cells"] += int(np.count_nonzero(pair_mask))
                    pair["baseline_mass"] += float(np.sum(arrays[0][pair_mask], dtype="float64")) * pixel_area
                    pair["alternative_mass"] += float(np.sum(arrays[index][pair_mask], dtype="float64")) * pixel_area
                    pair["baseline_only_cells"] += int(np.count_nonzero(valid_masks[0] & ~valid_masks[index]))
                    pair["alternative_only_cells"] += int(np.count_nonzero(valid_masks[index] & ~valid_masks[0]))
    common_area = common_count * pixel_area
    coverage = {
        "polygon_area_ha": geometry.area / 10000,
        "outside_native_extent_ha": outside_area,
        "within_native_extent": extent.covers(geometry),
        "pixel_area_ha": pixel_area, "selected_cells": selected,
        "common_valid_cells": common_count, "common_valid_area_ha": common_area,
        "common_valid_fraction": common_count / selected if selected else None,
        "common_structural_stream_cells": structural_all,
        "common_native_support_fraction": ((common_count + structural_all) / selected
                                           if selected else None),
        "valid_support_changed_cells": support_changed,
        "unresolved_common_cells": selected - common_count - structural_all,
        "method": "Original polygon pixel centres on aligned native outputs; common valid support across every selected run",
    }
    for value in stats.values():
        value["valid_area_ha"] = value["valid_cells"] * pixel_area
        value["common_yield_per_ha_year"] = value["common_mass"] / common_area if common_count else None
        value["common_mass"] = value["common_mass"] if common_count else None
        value["all_valid_mass"] = value["all_valid_mass"] if value["valid_cells"] else None
        value["complete_native_support"] = (coverage["within_native_extent"] and selected > 0
                                            and value["unexpected_missing_cells"] == 0
                                            and value["valid_cells"] > 0)
    baseline = stats[run_ids[0]]
    alternatives = []
    for key in run_ids[1:]:
        value = stats[key]
        base, future = baseline["common_mass"], value["common_mass"]
        change = future - base if base is not None and future is not None else None
        benefit = -change if change is not None else None
        pair = paired[key]
        pair_count = pair["valid_cells"]
        pair_base = pair["baseline_mass"] if pair_count else None
        pair_future = pair["alternative_mass"] if pair_count else None
        pair_change = pair_future - pair_base if pair_count else None
        pair.update({"valid_area_ha": pair_count * pixel_area,
                     "baseline_only_area_ha": pair["baseline_only_cells"] * pixel_area,
                     "alternative_only_area_ha": pair["alternative_only_cells"] * pixel_area,
                     "baseline_mass": pair_base, "alternative_mass": pair_future,
                     "change_mass": pair_change,
                     "avoided_export_mass": -pair_change if pair_change is not None else None,
                     "change_percent": pair_change / pair_base * 100 if pair_base not in (None, 0) else None,
                     "support": "Intersection of this baseline and alternative only"})
        alternatives.append({
            "run_id": key, "pairwise": pair, "baseline_common_mass": base, "alternative_common_mass": future,
            "change_mass": change, "avoided_export_mass": benefit,
            "change_percent": change / base * 100 if base not in (None, 0) else None,
            "avoided_export_percent": benefit / base * 100 if base not in (None, 0) else None,
            "percent_status": ("no_common_support" if base is None else
                               "unchanged_zero" if base == 0 and future == 0 else
                               "new_export_from_zero" if base == 0 else "defined"),
            "direction": ("lower_export" if change is not None and change < 0 else
                          "higher_export" if change is not None and change > 0 else
                          "unchanged" if change == 0 else "no_common_support"),
        })
    return {"coverage": coverage, "runs": stats, "alternatives": alternatives}


def _pareto(zone, run_details):
    candidates = []
    for detail in run_details[1:]:
        if detail["comparison_kind"] != "landcover_under_common_profile":
            continue
        vector = []
        for parameter, result in zone["pollutants"].items():
            item = next(v for v in result["alternatives"] if v["run_id"] == detail["id"])
            if item["avoided_export_mass"] is None:
                vector = []
                break
            vector.append(item["avoided_export_mass"])
        if vector:
            candidates.append((detail["id"], vector))
    nondominated = []
    dominated = {}
    for key, values in candidates:
        better = [other for other, rival in candidates
                  if other != key and all(a >= b for a, b in zip(rival, values))
                  and any(a > b for a, b in zip(rival, values))]
        if better:
            dominated[key] = better
        else:
            nondominated.append(key)
    return {"method": "Pareto comparison of selected native pollutant exports; no cross-unit weighted score",
            "objectives": list(zone["pollutants"]),
            "eligible_run_ids": [key for key, _ in candidates],
            "nondominated_run_ids": nondominated, "dominated_by": dominated,
            "eligibility": "Common land-cover profile with numeric export on the same all-run pixel support",
            "scope": "Tradeoffs apply to the displayed common modeled footprint; each pollutant retains its own coverage",
            "portfolio_note": "Combined interventions require a combined native run; standalone benefits are not additive"}


def _csv(report):
    out = io.StringIO(newline="")
    columns = ["zone_id", "zone_title", "scope", "pollutant", "units", "baseline_run_id",
               "alternative_run_id", "comparison_kind", "baseline_common_mass",
               "alternative_common_mass", "change_mass", "avoided_export_mass",
               "change_percent", "percent_status", "common_valid_area_ha",
               "common_valid_fraction", "outside_native_extent_ha",
               "valid_support_changed_cells", "unresolved_common_cells"]
    writer = csv.DictWriter(out, fieldnames=columns)
    writer.writeheader()
    details = {r["id"]: r for r in report["runs"]}
    for zone in report["zones"]:
        for parameter, result in zone["pollutants"].items():
            coverage = result["coverage"]
            for alternative in result["alternatives"]:
                row = {"zone_id": zone["id"], "zone_title": zone["title"], "scope": zone["scope"],
                       "pollutant": parameter, "units": OUTPUTS[parameter]["units"],
                       "baseline_run_id": report["baseline_run_id"],
                       "alternative_run_id": alternative["run_id"],
                       "comparison_kind": details[alternative["run_id"]]["comparison_kind"]}
                for key in columns:
                    if key in alternative:
                        row[key] = alternative[key]
                    elif key in coverage:
                        row[key] = coverage[key]
                for key, value in list(row.items()):
                    if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
                        row[key] = "'" + value
                writer.writerow(row)
    return out.getvalue().encode("utf-8")



def _totals_csv(report):
    """One native annual export and coverage row per selected run, zone and pollutant."""
    out = io.StringIO(newline="")
    columns = ["zone_id", "zone_title", "scope", "pollutant", "units", "run_id",
               "scenario_id", "profile_id", "comparison_kind", "all_valid_mass",
               "common_mass", "common_yield_per_ha_year", "valid_area_ha", "valid_cells",
               "structural_stream_cells", "unexpected_missing_cells", "unknown_stream_cells",
               "complete_native_support", "common_valid_area_ha", "common_valid_fraction",
               "outside_native_extent_ha", "selected_cells"]
    writer = csv.DictWriter(out, fieldnames=columns)
    writer.writeheader()
    for zone in report["zones"]:
        for parameter, result in zone["pollutants"].items():
            for detail in report["runs"]:
                values = {**result["coverage"], **result["runs"][detail["id"]]}
                row = {"zone_id": zone["id"], "zone_title": zone["title"], "scope": zone["scope"],
                       "pollutant": parameter, "units": report["outputs"][parameter]["units"],
                       "run_id": detail["id"], "scenario_id": detail["selection"]["scenario_id"],
                       "profile_id": detail["selection"]["profile_id"],
                       "comparison_kind": detail["comparison_kind"]}
                row.update({name: values[name] for name in columns if name in values})
                for name, value in list(row.items()):
                    if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
                        row[name] = "'" + value
                writer.writerow(row)
    return out.getvalue().encode("utf-8")


def build(workspace, requested, *, progress=None):
    requested = selection(requested)
    runs = [workspace.inspect_run(key) for key in requested["run_ids"]]
    if any(run.get("state") != "complete" for run in runs):
        raise ValueError("Select completed original model runs")
    common_pollutants = [
        p for p in OUTPUTS
        if all(p in _supported_pollutants(r, available_pollutants(r)) for r in runs)]
    selected_pollutants = requested.get("pollutants", common_pollutants)
    if not selected_pollutants:
        raise ValueError("The selected runs share no completed native pollutant output")
    unavailable = set(selected_pollutants) - set(common_pollutants)
    if unavailable:
        raise ValueError("Complete these native outputs with retained InVEST " + INVEST_VERSION +
                         " in every selected run: " + ", ".join(sorted(unavailable)))
    outputs = {p: OUTPUTS[p] for p in OUTPUTS if p in selected_pollutants}
    grid_ids = {run["selection"]["grid_id"] for run in runs}
    if len(grid_ids) != 1:
        raise ValueError("Select runs on the same retained reporting/model grid")
    selected_models = _selected_models(outputs)
    executed_versions = {run["id"]: model_versions(run, selected_models) for run in runs}
    for run in runs:
        for model, provenance in executed_versions[run["id"]].items():
            if provenance["comparison_version"] != INVEST_VERSION:
                raise ValueError("Scenario decisions use retained native " + model.upper() +
                                 " InVEST " + INVEST_VERSION + "; run " + run["id"] +
                                 " has " + str(provenance["comparison_version"]))
    grid = workspace.get_grid(runs[0]["selection"]["grid_id"])
    zones, crs = _geometry_zones(workspace, grid, requested.get("zones", []))
    details = []
    base_profile = runs[0]["selection"]["profile_id"]
    for index, run in enumerate(runs):
        scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
        profile = workspace._get("profiles", run["selection"]["profile_id"])
        kind = ("baseline" if index == 0 else
                "parameter_and_landcover_change" if run["selection"]["profile_id"] != base_profile and scenario["kind"] == "landcover" else
                "parameter_change" if run["selection"]["profile_id"] != base_profile else
                "landcover_under_common_profile" if scenario["kind"] == "landcover" else
                "same_profile_baseline")
        details.append({"id": run["id"], "selection": run["selection"],
                        "completed_at": run.get("completed_at"), "runtime": run.get("runtime"),
                        "model_versions": executed_versions[run["id"]],
                        "stage_runtimes": {
                            model: (run.get("stages", {}).get(model) or {}).get("runtime")
                            for model in selected_models},
                        "scenario_title": scenario.get("title", scenario["id"]),
                        "scenario_kind": scenario["kind"], "scenario": scenario,
                        "profile_title": profile.get("title", profile["id"]),
                        "comparison_kind": kind,
                        "landcover_edits": run.get("stages", {}).get("landcover", {}).get("edits", [])})
    viewer_path = Path(__file__).resolve().parent.parent / "operator" / "web" / "scenario_decisions.html"
    implementation = {"producer_sha256": file_digest(Path(__file__)),
                      "viewer_sha256": file_digest(viewer_path)}
    identity = {"schema": SCHEMA, "implementation": implementation, "selection": requested, "runs": [
        {"id": r["id"], "stages": r["stages"]} for r in runs],
        "zones": [{"id": z["id"], "scope": z["scope"], "source": z["source"]} for z in zones]}
    key = digest(identity)
    directory = workspace.root / "scenario-decisions" / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".decisions.lock", blocking=False):
        summary_path = directory / "decision.json"
        if summary_path.exists():
            existing = read_json(summary_path)
            for item in existing["files"].values():
                verify_file(directory, item)
            return {**existing, "reused": True}
        report = {"schema": SCHEMA, "id": key, "title": requested["title"], "created_at": now(),
                  "project": workspace.project, "grid_id": grid["id"], "selection": requested,
                  "implementation": implementation,
                  "baseline_run_id": runs[0]["id"], "runs": details, "outputs": outputs,
                  "pollutants": list(outputs),
                  "report_kind": "scenario_comparison" if len(runs) > 1 else "reference_totals",
                  "available_pollutants_by_run": {r["id"]: available_pollutants(r) for r in runs},
                  "scope_note": "Zones are evaluated independently. Overlapping utility catchments and reporting/native domains must not be added together.",
                  "mass_note": "Native InVEST 3.20.0 annual per-hectare exports are multiplied once by native projected pixel area.",
                  "interpretation": "Avoided export is baseline minus alternative on common valid pixel support. Annual source contributions to streams do not represent measured reservoir intake loads.",
                  "zones": [{k: v for k, v in z.items() if k != "geometry"} | {"pollutants": {}} for z in zones]}
        import rasterio
        from pyproj import CRS
        for parameter, spec in outputs.items():
            with ExitStack() as stack:
                datasets, streams = [], []
                for run in runs:
                    path, _ = _stage_path(workspace, run, spec, "output")
                    stream_path, _ = _stage_path(workspace, run, spec, "stream")
                    datasets.append(stack.enter_context(rasterio.open(path)))
                    streams.append(stack.enter_context(rasterio.open(stream_path)))
                reference = datasets[0]
                projected = CRS.from_user_input(reference.crs)
                factors = [a.unit_conversion_factor for a in projected.axis_info[:2]]
                if not projected.is_projected or len(factors) != 2 or any(abs(v-1) > 1e-8 for v in factors):
                    raise ValueError("Native export coordinates must be projected metres")
                if projected != crs:
                    raise ValueError("Original native output and retained grid CRS differ")
                for source in datasets + streams:
                    rasters.check_same_grid(reference, source)
                    if source.count != 1:
                        raise ValueError("Select single-band original export and stream rasters")
                for index, zone in enumerate(zones):
                    partial_path = directory / "completed-zones" / (parameter + "-" + digest(zone["id"]) + ".json")
                    if partial_path.exists():
                        partial = read_json(partial_path)
                        if partial.get("report_id") != key or partial.get("zone_id") != zone["id"] or partial.get("pollutant") != parameter:
                            raise ValueError("Retained watershed outcome selection differs")
                        value = partial["result"]
                    else:
                        value = _summarize_zone(zone["geometry"], datasets, streams,
                                                requested["run_ids"], crs)
                        atomic_json(partial_path, {"report_id": key, "zone_id": zone["id"],
                                    "pollutant": parameter, "result": value}, immutable=True)
                    report["zones"][index]["pollutants"][parameter] = value
                    if progress:
                        progress({"stage": "watershed_scenarios", "pollutant": parameter,
                                  "zone": zone["id"], "completed_zones": index + 1,
                                  "total_zones": len(zones), "run_count": len(runs)})
        for zone in report["zones"]:
            zone["scenario_tradeoffs"] = _pareto(zone, details)
        report_path, csv_path, html_path = directory / "report.json", directory / "comparisons.csv", directory / "index.html"
        atomic_json(report_path, report)
        atomic_bytes(csv_path, _csv(report))
        totals_path = directory / "annual-totals.csv"
        atomic_bytes(totals_path, _totals_csv(report))
        from pyproj import Transformer
        from shapely.geometry import mapping
        from shapely.ops import transform
        to_geo = Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform
        geography_path = directory / "zones.geojson"
        atomic_json(geography_path, {"type": "FeatureCollection", "features": [
            {"type": "Feature", "id": zone["id"], "geometry": mapping(transform(to_geo, zone["geometry"])),
             "properties": {"zone_id": zone["id"], "title": zone["title"],
                            "scope": zone["scope"], "area_ha": zone["area_ha"],
                            "original_area_ha": zone["original_area_ha"]}} for zone in zones]})
        html = viewer_path.read_text(encoding="utf-8")
        token = '<script type="application/json" id="embedded-report"></script>'
        if html.count(token) != 1:
            raise ValueError("Scenario report viewer has lost its report insertion point")
        encoded = canonical(report).decode("utf-8").replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        html = html.replace(token, '<script type="application/json" id="embedded-report">' + encoded + '</script>')
        atomic_bytes(html_path, html.encode("utf-8"))
        summary = {"schema": SCHEMA, "id": key, "title": report["title"], "created_at": report["created_at"],
                   "selection": requested, "baseline_run_id": report["baseline_run_id"],
                   "zones": len(zones), "runs": len(runs), "pollutants": list(outputs),
                   "report_kind": report["report_kind"],
                   "files": {"json": describe_file(directory, report_path),
                             "csv": describe_file(directory, csv_path),
                             "totals_csv": describe_file(directory, totals_path),
                             "geography": describe_file(directory, geography_path),
                             "html": describe_file(directory, html_path)}}
        atomic_json(summary_path, summary)
        return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--selection", help="Original baseline, alternatives and retained watershed source choices")
    mode.add_argument("--catalog", action="store_true", help="List completed native cohorts and original source choices")
    mode.add_argument("--baseline-run", help="Build a report from an existing baseline and actual alternatives")
    mode.add_argument("--report-id", help="Reopen a saved report and verify its native products")
    parser.add_argument("--alternative-run", action="append", dest="alternative_runs")
    parser.add_argument("--reference-only", action="store_true", help="Report the selected baseline alone, even when alternatives have completed")
    parser.add_argument("--pollutant", action="append", choices=list(OUTPUTS), dest="pollutants")
    parser.add_argument("--title")
    parser.add_argument("--delivery-mode", choices=("regional_rfp", "native_study"),
                        help="Retain an explicit report-to-atlas delivery context")
    parser.add_argument("--study-title", help="Original native study title")
    parser.add_argument("--study-purpose", help="Original native study purpose")
    parser.add_argument("--study-reference", help="Optional original study reference")
    parser.add_argument("--zones", help="JSON array of retained watershed selections")
    args = parser.parse_args(argv)
    try:
        if args.reference_only and (not args.baseline_run or args.alternative_runs):
            raise ValueError("Use --reference-only with --baseline-run and without --alternative-run")
        study_fields = {key: value for key, value in (
            ("title", args.study_title), ("purpose", args.study_purpose),
            ("reference", args.study_reference)) if value is not None}
        if (args.delivery_mode is not None or study_fields) and not args.baseline_run:
            raise ValueError("Use delivery context flags with --baseline-run; --selection retains its own context")
        workspace = Workspace(args.workspace)
        if args.catalog:
            result = catalog(workspace)
        elif args.report_id:
            result = inspect(workspace, args.report_id)
        else:
            requested = (read_json(args.selection) if args.selection else
                         select_cohort(workspace, args.baseline_run,
                                       alternative_run_ids=[] if args.reference_only else args.alternative_runs,
                                       title=args.title, pollutants=args.pollutants,
                                       zones=read_json(args.zones) if args.zones else None,
                                       delivery_mode=args.delivery_mode,
                                       native_study=study_fields or None))
            result = build(workspace, requested,
                           progress=lambda value: print(json.dumps(value, allow_nan=False), file=sys.stderr, flush=True))
        print(json.dumps(result, allow_nan=False, sort_keys=True))
        return 0
    except (ValueError, OSError, RuntimeError, KeyError, TypeError, ImportError) as exc:
        print(json.dumps({"state": "failed", "type": type(exc).__name__, "message": str(exc)}),
              file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
