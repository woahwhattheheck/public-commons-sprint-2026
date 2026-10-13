#!/usr/bin/env python3
"""Run matched ARJWS/Pioneer priority and native watershed comparisons."""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "model"

from .common import (INVEST_VERSION, atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, held, identifier, now, read_json, verify_file)
from . import rasters
from . import native_versions
from .workspace import Workspace

SCHEMA = "upstate.utility-scenario-cohort/v1"
SOURCE_ROLE = "SOURCE_WATER_PROTECTION_AREAS"
PUBLISHER = "https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/2"
POLLUTANTS = {
    "nitrogen_export": "nitrogen",
    "phosphorus_export": "phosphorus",
    "sediment_export": "sediment",
}
# Original SCDES layer-2 identities and attributes, retained in ECO-SOURCE12.
AREAS = (
    {"object_id": 11, "utility": "ARJWS", "system": "0420011",
     "pws_id": "SC0420011", "intake_id": "S04101", "buffer_ft": 1500},
    {"object_id": 12, "utility": "ARJWS", "system": "0420011",
     "pws_id": "SC0420011", "intake_id": "S04101", "buffer_ft": 200},
    {"object_id": 131, "utility": "Pioneer", "system": "3720001",
     "pws_id": "SC3720001", "intake_id": "S37109", "buffer_ft": 1500},
    {"object_id": 132, "utility": "Pioneer", "system": "3720001",
     "pws_id": "SC3720001", "intake_id": "S37109", "buffer_ft": 200},
)
PLANNING_FIELDS = {"weights", "caps", "percentile", "weight_sets"}


def _weights_grid(planning, divisions, pollutants):
    """Enumerate declared N/P/sediment ratios on a complete simplex lattice."""
    from .scenario_analysis import _weight_sets
    if not isinstance(divisions, int) or isinstance(divisions, bool) or divisions < 0:
        raise ValueError("weight_grid must be a nonnegative integer")
    result = json.loads(canonical(planning))
    existing = _weight_sets(result, pollutants=pollutants)
    if not divisions:
        return result, {"divisions": 0, "added_weight_sets": 0,
                        "weight_set_count": len(existing)}
    names = tuple(POLLUTANTS)
    identities = {item["id"] for item in existing}
    ratios = {tuple(round(item["normalized_weights"][k], 15) for k in names)
              for item in existing}
    added = []
    def lattice(count, remaining, prefix=()):
        if count == 1:
            yield prefix + (remaining,)
            return
        for value in range(remaining + 1):
            yield from lattice(count - 1, remaining - value, prefix + (value,))

    for selected_values in lattice(len(pollutants), divisions):
        selected = dict(zip(pollutants, selected_values))
        values = tuple(selected.get(name, 0) for name in names)
        ratio = tuple(round(value / divisions, 15) for value in values)
        if ratio in ratios:
            continue
        key = "simplex-" + "-".join(str(value) for value in values)
        if key in identities:
            raise ValueError("A supplied weight-set ID conflicts with the requested grid: " + key)
        added.append({"id": key,
                      "title": "Planning ratios N:P:sediment " + ":".join(str(v) for v in values),
                      "weights": dict(zip(names, values))})
        identities.add(key)
        ratios.add(ratio)
    result["weight_sets"] = list(result.get("weight_sets", [])) + added
    return result, {"divisions": divisions, "added_weight_sets": len(added),
                    "weight_set_count": len(existing) + len(added),
                    "grid_point_count": math.comb(divisions + len(pollutants) - 1, len(pollutants) - 1),
                    "comparison_pollutants": list(pollutants),
                    "meaning": "Declared planning-weight alternatives; each ratio sums to one after normalization"}


def native_cohort(runs, pollutants=None):
    """Resolve observed execution versions for the actual common native outputs."""
    from .model_selection import common_comparison_outputs
    common = common_comparison_outputs(runs)
    selected = tuple(common if pollutants is None else pollutants)
    if not selected or set(selected) - set(common):
        raise ValueError("Select outputs retained by every completed native run")
    result = native_versions.comparison_versions(
        runs, native_versions.models_for_outputs(selected))
    for run in runs:
        for model, version in result["runs"][run["id"]].items():
            observed = version["observed_stage_version"] or version["observed_run_version"]
            if not observed:
                raise ValueError("Run " + run["id"] + " lacks an observed " + model.upper() +
                                 " execution version; retain its original completed-stage or run runtime")
            if version["comparison_version"] != INVEST_VERSION:
                raise ValueError("Utility " + model.upper() + " comparisons require original InVEST " +
                                 INVEST_VERSION + "; run " + run["id"] + " records " +
                                 str(version["comparison_version"]))
    return result


def prepare(workspace, requested):
    """Bind retained source features and one real run cohort for both producers."""
    if not isinstance(requested, dict):
        raise ValueError("Select a utility cohort object")
    requested = json.loads(canonical(requested))
    permitted = {"title", "source_collection_id", "source_id", "baseline_run_id",
                 "scenario_run_ids", "planning", "weight_grid"}
    if set(requested) - permitted:
        raise ValueError("Unknown utility cohort fields: " + ", ".join(sorted(set(requested) - permitted)))
    alternatives = requested.get("scenario_run_ids", [])
    if not isinstance(alternatives, list):
        raise ValueError("scenario_run_ids must list completed alternative native runs")
    requested["scenario_run_ids"] = alternatives
    report_kind = "scenario_comparison" if alternatives else "reference_totals"
    ids = [requested["baseline_run_id"]] + alternatives
    if any(not isinstance(key, str) or not key for key in ids) or len(set(ids)) != len(ids):
        raise ValueError("Use distinct complete baseline and alternative run IDs")
    runs = [workspace.inspect_run(key) for key in ids]
    if any(run.get("state") != "complete" for run in runs):
        raise ValueError("Complete the selected native runs before launching the utility cohort")
    grid_ids = {run["selection"]["grid_id"] for run in runs}
    if len(grid_ids) != 1:
        raise ValueError("The utility cohort requires one retained reporting/model grid")
    from .model_selection import common_comparison_outputs
    comparison_pollutants = common_comparison_outputs(runs)
    execution = native_cohort(runs, comparison_pollutants)
    from .scenario_decisions import available_pollutants
    for run in runs:
        native = set(available_pollutants(run))
        absent_native = [name for name in comparison_pollutants if POLLUTANTS[name] not in native]
        if absent_native:
            raise ValueError("Run " + run["id"] + " needs original native export and stream descriptors for: " + ", ".join(absent_native))
        missing = [name for name in comparison_pollutants if name not in run.get("artifacts", {})]
        if missing:
            raise ValueError("Run " + run["id"] + " needs original annual-mass outputs: " + ", ".join(missing))
        for name in comparison_pollutants:
            descriptor = run["artifacts"][name]
            if descriptor.get("units") != rasters.MASS_UNITS[name]:
                raise ValueError("Run " + run["id"] + " has an unexpected annual-mass unit for " + name)
    grid = workspace.get_grid(runs[0]["selection"]["grid_id"])
    collection = workspace._get("sources", requested["source_collection_id"])
    candidates = [entry for entry in collection["entries"]
                  if entry.get("kind") == "vector" and entry.get("role") == SOURCE_ROLE]
    if requested.get("source_id"):
        candidates = [entry for entry in candidates if entry["id"] == requested["source_id"]]
    if len(candidates) != 1:
        raise ValueError("Select one retained SOURCE_WATER_PROTECTION_AREAS source; provide source_id when the collection contains several")
    source = candidates[0]
    source_path, source = workspace.source_file(collection["id"], source["id"])
    rows, crs = rasters.vector_geometry(source_path, layer=source.get("layer"),
                                        target_crs=grid["grid"]["crs"])
    indexed = {}
    for row in rows:
        value = row["properties"].get("OBJECTID")
        if value is not None and str(value) in {str(area["object_id"]) for area in AREAS}:
            if str(value) in indexed:
                raise ValueError("The native protection source repeats OBJECTID " + str(value))
            indexed[str(value)] = row
    grid_root = workspace.root / "grids" / grid["id"]
    reporting_path = verify_file(grid_root, grid["files"]["reporting_area"])
    reporting_rows, _ = rasters.vector_geometry(reporting_path, target_crs=crs)
    reporting = rasters.polygon_union(reporting_rows)
    planning = requested.get("planning", {})
    if not isinstance(planning, dict) or set(planning) - PLANNING_FIELDS:
        raise ValueError("Planning accepts weights, caps, percentile and weight_sets")
    planning, grid_spec = _weights_grid(planning, requested.get("weight_grid", 0), comparison_pollutants)
    title = str(requested.get("title") or "ARJWS and Pioneer native scenario priorities")
    analysis = {"title": title, "baseline_run_id": ids[0], "scenario_run_ids": ids[1:],
                **planning, "zones": []}
    decisions = {"schema": "upstate.scenario-decision-selection/v1", "title": title,
                 "run_ids": ids, "zones": []}
    if tuple(comparison_pollutants) != tuple(POLLUTANTS):
        decisions["pollutants"] = [POLLUTANTS[name] for name in comparison_pollutants]
    bindings = []
    for area in AREAS:
        identity = str(area["object_id"])
        if identity not in indexed:
            raise ValueError("Original protection source lacks OBJECTID " + identity)
        row = indexed[identity]
        props, geometry = row["properties"], row["geometry"]
        if geometry.geom_type not in ("Polygon", "MultiPolygon"):
            raise ValueError("Protection OBJECTID " + identity + " must retain its original polygon")
        if str(props.get("SYSTEM")) != area["system"]:
            raise ValueError("Protection OBJECTID " + identity + " has a different native SYSTEM identity")
        if str(props.get("INTAKE")) != area["intake_id"]:
            raise ValueError("Protection OBJECTID " + identity + " has a different original intake identity")
        try:
            buffer_ft = float(props["BUFFER_FT"])
        except (KeyError, ValueError, TypeError):
            raise ValueError("Protection OBJECTID " + identity + " lacks its native BUFFER_FT") from None
        if not math.isfinite(buffer_ft) or buffer_ft != area["buffer_ft"]:
            raise ValueError("Protection OBJECTID " + identity + " has a different published buffer level")
        prefix = area["utility"].lower() + "-swpa-" + str(area["buffer_ft"])
        region_id = prefix + ":" + identity
        zone_title = area["utility"] + " source-water protection, " + format(area["buffer_ft"], ",") + " ft"
        selection = {"source_collection_id": collection["id"], "source_id": source["id"],
                     "where": {"OBJECTID": props["OBJECTID"]}}
        if source.get("layer"):
            selection["layer"] = source["layer"]
        rank_group = "published-swpa-" + str(area["buffer_ft"]) + "ft"
        analysis["zones"].append({
            **selection, "id": region_id, "title": zone_title, "buffer_m": 0,
            "rank_group": rank_group, "map_family": "critical_drinking_water"})
        decisions["zones"].append({
            **selection, "id": prefix, "title": zone_title, "id_field": "OBJECTID",
            "feature_ids": [identity], "scope": "reporting_intersection"})
        intersected = geometry.intersection(reporting)
        bindings.append({
            **area, "region_id": region_id, "title": zone_title, "rank_group": rank_group,
            "source_collection_id": collection["id"], "source_id": source["id"],
            "source_sha256": source["body"]["sha256"], "native_where": selection["where"],
            "original_area_ha": geometry.area / 10000.0,
            "reporting_intersection_area_ha": intersected.area / 10000.0,
            "scope": "reporting_intersection", "additional_buffer_m": 0})
    if not any(item["reporting_intersection_area_ha"] > 0 for item in bindings):
        raise ValueError(
            "The selected native reporting area does not overlap any of the original "
            "ARJWS or Pioneer protection polygons. Select the retained Upper Savannah "
            "or South Carolina study and a completed native run covering these source areas.")
    from .scenario_decisions import selection as decision_selection
    decision_selection(decisions)
    return {
        "schema": SCHEMA, "title": title, "requested": requested, "run_ids": ids,
        "report_kind": report_kind,
        "baseline_run_id": ids[0], "grid_id": grid["id"],
        "comparison_pollutants": list(comparison_pollutants),
        "native_execution": execution,
        "source": {"source_collection_id": collection["id"], "source_id": source["id"],
                   "title": source["title"], "uri": source["uri"], "vintage": source["vintage"],
                   "body": source["body"], "role": source.get("role"),
                   "publisher_layer": PUBLISHER},
        "zone_bindings": bindings, "weight_grid": grid_spec,
        "analysis_selection": analysis, "decision_selection": decisions,
        "notes": [
            "Original layer-2 upstream source-water protection polygons retain the publisher's BUFFER_FT attributes.",
            "Published 200-foot and 1,500-foot selections form separate rank groups; no additional geometry buffer is applied.",
            "Each zone is intersected with the same retained reporting area. At least one original protection area overlaps the study; individually outside areas retain their source identity and empty results.",
            "Overlapping protection-area masses remain separate.",
            ("The single selected native run supplies source-area reference totals and planning priorities."
             if report_kind == "reference_totals" else
             "Both producers use the same ordered baseline and alternative cohort."),
            "Native physical quantities retain their pollutant units; original stream and missing-data counts remain visible.",
            "Each compared model retains its completed-stage execution version, with observed run runtime used only when the stage has no retained version. Original requested versions remain provenance.",
            "Weight-grid points are declared planning alternatives; they do not assign probabilities to preferences.",
        ],
    }


def _product(directory, summary, primary):
    return {"id": summary["id"], "directory": directory,
            "files": {**summary["files"], "primary_json": primary}}


def _verify_products(workspace, products):
    if set(products) != {"analysis", "decisions"}:
        raise ValueError("The completed utility cohort must retain both native products")
    for kind, product in products.items():
        key = identifier(product["id"])
        expected = ("analyses/" if kind == "analysis" else "scenario-decisions/") + key
        if product["directory"] != expected:
            raise ValueError("A retained utility product has a different workspace directory")
        root = workspace.root / expected
        for item in product["files"].values():
            verify_file(root, item)


def _joined_rows(plan, analysis, report):
    if (analysis["run_ids"] != plan["run_ids"]
            or [run["id"] for run in report["runs"]] != plan["run_ids"]
            or len({analysis["grid_id"], report["grid_id"], plan["grid_id"]}) != 1
            or analysis["baseline_run_id"] != report["baseline_run_id"]):
        raise ValueError("The native report and planning analysis refer to different selections")
    selected = plan.get("comparison_pollutants", list(POLLUTANTS))
    if analysis.get("comparison_pollutants", list(POLLUTANTS)) != selected:
        raise ValueError("The planning analysis selected a different native pollutant intersection")
    expected_native = {POLLUTANTS[name] for name in selected}
    if set(report.get("pollutants", expected_native)) != expected_native:
        raise ValueError("The native report selected a different pollutant intersection")
    decision_zones = {zone["id"]: zone for zone in report["zones"]}
    physical = {(row["region_id"], row["run_id"], row["pollutant"]): row
                for row in analysis["physical"]}
    priority = {(row["region_id"], row["run_id"]): row for row in analysis["priority"]
                if row["weight_set_id"] == "selected"}
    sensitivity = {(row["region_id"], row["run_id"]): row for row in analysis["sensitivity"]}
    details = {run["id"]: run for run in analysis["runs"]}
    regions = [{"region_id": "reporting_area", "title": "Full reporting area",
                "utility": None, "system": None, "pws_id": None, "intake_id": None,
                "buffer_ft": None, "object_id": None, "rank_group": None,
                "scope": "reporting_area", "source_collection_id": None,
                "source_id": None, "source_sha256": None,
                "reporting_intersection_area_ha": None}] + plan["zone_bindings"]
    rows = []
    for region in regions:
        region_id = region["region_id"]
        zone = decision_zones.get(region_id)
        if zone is None and region["reporting_intersection_area_ha"] != 0:
            raise ValueError("The native report lacks selected reporting zone " + region_id)
        for run_id in plan["run_ids"]:
            score = priority[(region_id, run_id)]
            spread = sensitivity[(region_id, run_id)]
            for pollutant in plan.get("comparison_pollutants", POLLUTANTS):
                native_name = POLLUTANTS[pollutant]
                mass = physical[(region_id, run_id, pollutant)]
                native = zone["pollutants"][native_name] if zone is not None else None
                native_run = native["runs"][run_id] if native else {}
                current = native_run.get("common_mass")
                baseline = native["runs"][plan["baseline_run_id"]]["common_mass"] if native else None
                coverage = native["coverage"] if native else {}
                count = coverage.get("common_valid_cells", 0)
                if count != mass["common_valid_cells"]:
                    raise ValueError("Common support differs for " + region_id + "/" + run_id +
                                     "/" + pollutant + ": native=" + str(count) +
                                     ", annual-mass=" + str(mass["common_valid_cells"]))
                if current is not None and baseline is not None:
                    change = current - baseline
                    percent = 100.0 * change / baseline if baseline else None
                    status = ("defined" if baseline else "unchanged_zero" if current == 0 else "new_export_from_zero")
                else:
                    change = percent = None
                    status = "no_common_support"
                row = {key: region.get(key) for key in (
                    "region_id", "title", "utility", "pws_id", "intake_id", "system",
                    "object_id", "buffer_ft", "rank_group", "scope", "source_collection_id",
                    "source_id", "source_sha256")}
                model = native_versions.models_for_outputs([pollutant])[0]
                executed = plan["native_execution"]["runs"][run_id][model]
                row.update({
                    "native_model": model,
                    "native_execution_version": executed["comparison_version"],
                    "native_version_basis": executed["basis"],
                    "native_stage_version": executed["observed_stage_version"],
                    "native_run_version": executed["observed_run_version"],
                    "native_requested_version": executed["requested_version"],
                    "baseline_run_id": plan["baseline_run_id"], "run_id": run_id,
                    "comparison_kind": details[run_id]["comparison_kind"],
                    "report_kind": plan.get("report_kind", "scenario_comparison"),
                    "pollutant": pollutant, "units": mass["units"],
                    "common_yield_per_ha_year": native_run.get("common_yield_per_ha_year"),
                    "native_all_valid_mass": native_run.get("all_valid_mass"),
                    "native_valid_cells": native_run.get("valid_cells"),
                    "native_valid_area_ha": native_run.get("valid_area_ha"),
                    "native_structural_stream_cells": native_run.get("structural_stream_cells"),
                    "native_unexpected_missing_cells": native_run.get("unexpected_missing_cells"),
                    "native_unknown_stream_cells": native_run.get("unknown_stream_cells"),
                    "native_complete_support": native_run.get("complete_native_support"),
                    "selected_cells": coverage.get("selected_cells"),
                    "common_native_support_fraction": coverage.get("common_native_support_fraction"),
                    "common_valid_cells": count,
                    "common_area_ha": coverage.get("common_valid_area_ha", 0),
                    "common_coverage_fraction": coverage.get("common_valid_fraction"),
                    "baseline_common_mass": baseline, "current_common_mass": current,
                    "change_mass": change,
                    "avoided_export_mass": -change if change is not None else None,
                    "change_percent": percent, "percent_status": status,
                    "selected_priority_mean": score["mean"],
                    "priority_common_cells": score["common_cells"],
                    "priority_coverage_fraction": score["coverage_fraction"],
                    "selected_priority_score_change": score["score_change"],
                    "selected_priority_rank": score["rank"],
                    "baseline_priority_rank": score["baseline_rank"],
                    "priority_rank_change": score["rank_change"],
                    "sensitivity_score_min": spread["score_min"],
                    "sensitivity_score_max": spread["score_max"],
                    "sensitivity_score_range": spread["score_range"],
                    "sensitivity_best_rank": spread["best_rank"],
                    "sensitivity_worst_rank": spread["worst_rank"],
                    "sensitivity_rank_span": spread["rank_span"],
                    "weight_set_count": spread["weight_set_count"],
                })
                rows.append(row)
    return rows


def _csv(rows):
    output = io.StringIO(newline="")
    if rows:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]))
        writer.writeheader()
        for original in rows:
            writer.writerow({
                key: "'" + value if isinstance(value, str)
                and value.startswith(("=", "+", "-", "@", "\t", "\r")) else value
                for key, value in original.items()})
    return output.getvalue().encode("utf-8")


def _response(directory, state, *, reused=False):
    return {**state, "reused": reused,
            "cohort_artifact": describe_file(directory, directory / "cohort.json")}


def build(workspace, requested, *, progress=None):
    """Retain native utility reference totals or a complete scenario comparison."""
    from . import scenario_analysis, scenario_decisions
    plan = prepare(workspace, requested)
    viewer = Path(scenario_decisions.__file__).resolve().parent.parent / "operator" / "web" / "scenario_decisions.html"
    implementation = {
        "cohort_sha256": file_digest(Path(__file__)),
        "native_versions_sha256": file_digest(Path(native_versions.__file__)),
        "analysis_sha256": file_digest(Path(scenario_analysis.__file__)),
        "decisions_sha256": file_digest(Path(scenario_decisions.__file__)),
        "decision_viewer_sha256": file_digest(viewer),
    }
    key = digest({"schema": SCHEMA, "plan": plan, "implementation": implementation})
    directory = workspace.root / "utility-scenario-cohorts" / key
    directory.mkdir(parents=True, exist_ok=True)
    state_path = directory / "cohort.json"
    with held(directory / ".cohort.lock", blocking=False):
        if state_path.exists():
            previous = read_json(state_path)
            if previous.get("id") != key or previous.get("implementation") != implementation:
                raise ValueError("The retained utility cohort has a different source identity")
            if previous.get("state") == "complete":
                for item in previous["files"].values():
                    verify_file(directory, item)
                _verify_products(workspace, previous["products"])
                return _response(directory, previous, reused=True)
        state = {**plan, "id": key, "state": "building", "created_at": now(),
                 "implementation": implementation, "phase": "selections",
                 "files": {}, "products": {}}

        def retain(phase, detail=None):
            state.update(phase=phase, updated_at=now())
            if detail is not None:
                state["progress"] = detail
            atomic_json(state_path, state)
            if progress is not None:
                progress({"id": key, "state": state["state"], "phase": phase,
                          "detail": detail, "updated_at": state["updated_at"]})

        try:
            for name, selection in (("analysis", plan["analysis_selection"]),
                                    ("decisions", plan["decision_selection"])):
                path = directory / (name + "-selection.json")
                atomic_json(path, selection, immutable=True)
                state["files"][name + "_selection"] = describe_file(directory, path)
            retain("analysis", {"run_count": len(plan["run_ids"]),
                                "utility_zone_count": len(plan["zone_bindings"]),
                                "weight_set_count": plan["weight_grid"]["weight_set_count"]})
            analysis = scenario_analysis.analyze(workspace, plan["analysis_selection"])
            analysis_directory = "analyses/" + analysis["id"]
            state["products"]["analysis"] = _product(
                analysis_directory, analysis, analysis["analysis_artifact"])
            retain("native_decisions", {"analysis_id": analysis["id"]})

            def decision_progress(value):
                if progress is not None:
                    progress({"id": key, "state": "building", "phase": "native_decisions", **value})

            decision = scenario_decisions.build(workspace, plan["decision_selection"],
                                                progress=decision_progress)
            decision_directory = "scenario-decisions/" + decision["id"]
            report_path = verify_file(workspace.root / decision_directory, decision["files"]["json"])
            report = read_json(report_path)
            state["products"]["decisions"] = _product(
                decision_directory, decision, decision["files"]["json"])
            retain("utility_comparisons", {"analysis_id": analysis["id"], "decision_id": decision["id"]})
            state["rows"] = _joined_rows(plan, analysis, report)
            path = directory / "utility-comparisons.csv"
            atomic_bytes(path, _csv(state["rows"]))
            state["files"]["utility_comparisons"] = describe_file(directory, path)
            state.update(state="complete", completed_at=now(), row_count=len(state["rows"]),
                         normalization=analysis["normalization"],
                         physical_source="Original native decision report; annual rates multiplied once by actual pixel area",
                         priority_source="Fixed-cap analysis of original retained annual-mass artifacts",
                         mass_rounding="Native float64 rate aggregation and retained float32 mass rasters preserve their original rounding")
            retain("complete", {"analysis_id": analysis["id"], "decision_id": decision["id"],
                                "row_count": state["row_count"]})
            return _response(directory, state)
        except BaseException as error:
            state.update(state="failed", failed_at=now(),
                         error={"type": type(error).__name__, "message": str(error)})
            atomic_json(state_path, state)
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--source-collection", required=True,
                        help="Actual collection ID returned by prepare_public_water.py")
    parser.add_argument("--source-id", help="Original protection-area source ID when the collection has more than one")
    parser.add_argument("--baseline-run", required=True)
    parser.add_argument("--scenario-run", action="append", default=[],
                        help="Optional actual completed alternative; repeat for the complete comparison cohort")
    parser.add_argument("--title", default="ARJWS and Pioneer native scenario priorities")
    parser.add_argument("--planning", type=Path,
                        help="JSON with weights, optional fixed caps or percentile, and weight_sets")
    parser.add_argument("--weight-grid", type=int, default=0,
                        help="Optional simplex subdivisions: 4 spans 15 three-pollutant, 5 two-pollutant or 1 single-pollutant ratios")
    parser.add_argument("--full", action="store_true", help="Print the complete joined cohort")
    args = parser.parse_args(argv)
    try:
        requested = {
            "title": args.title, "source_collection_id": args.source_collection,
            "baseline_run_id": args.baseline_run, "scenario_run_ids": args.scenario_run,
            "planning": read_json(args.planning) if args.planning else {},
            "weight_grid": args.weight_grid,
        }
        if args.source_id:
            requested["source_id"] = args.source_id
        result = build(Workspace(args.workspace), requested,
                       progress=lambda value: print(json.dumps(value, allow_nan=False),
                                                    file=sys.stderr, flush=True))
        if not args.full:
            result = {key: result[key] for key in (
                "schema", "id", "title", "state", "report_kind", "baseline_run_id", "run_ids", "grid_id",
                "source", "zone_bindings", "comparison_pollutants", "weight_grid", "normalization", "row_count",
                "files", "products", "cohort_artifact", "reused")}
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))
        return 0
    except (ValueError, TypeError, KeyError, OSError, RuntimeError, ImportError) as error:
        print(json.dumps({"state": "failed", "type": type(error).__name__,
                          "message": str(error)}, ensure_ascii=False), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
