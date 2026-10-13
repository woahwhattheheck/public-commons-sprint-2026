#!/usr/bin/env python3
"""Operate the original Gura study through native subwatershed planning.

The source archive is unchanged. Agriculture-to-forest is an explicitly
declared planning alternative, evaluated with the original model parameters.
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import math
from pathlib import Path
import re
import sys
import traceback


def parser():
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--application", type=Path, required=True)
    value.add_argument("--workspace", type=Path, required=True)
    value.add_argument("--inputs", type=Path, required=True)
    value.add_argument("--baseline-run-id",
                       help="Completed original Gura application baseline; omitted runs the receiving driver first")
    value.add_argument("--max-count", type=int, default=3,
                       help="Maximum original subwatershed units selected; default 3")
    value.add_argument("--area-ha", type=float,
                       help="Optional maximum selected reporting-area hectares")
    value.add_argument("--min-coverage", type=float, default=0.90,
                       help="Minimum retained common-valid feature coverage (default: 90%%); original measured coverage remains in the inventory and report")
    value.add_argument("--feature-id-field",
                       help="Original subwatershed ID property; omitted preserves the original feature IDs")
    value.add_argument("--solver", choices=("deterministic", "scipy-milp"), default="deterministic")
    value.add_argument("--archive", type=Path,
                       help="Optional complete workspace backup after the evaluated portfolio")
    return value


def checked_conversion(originals, receiving_driver):
    result = {}
    for model, original in originals.items():
        path = Path(original["absolute_arguments"]["biophysical_table_path"])
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            native_fields = set(receiving_driver.NATIVE_COLUMNS[model])
            rows = {}
            for row in reader:
                code = int(row["lucode"].strip())
                if code in rows:
                    raise ValueError("Original biophysical table contains duplicate class codes")
                rows[code] = row
        if 5 not in rows or 8 not in rows:
            raise ValueError("Original Gura table does not contain both proposed class codes 5 and 8")
        descriptions = {
            code: (str(rows[code].get("description") or "").strip() or
                   " ".join(str(value or "") for key, value in rows[code].items()
                            if key not in native_fields))
            for code in (5, 8)
        }
        if not re.search(r"\bagricultur\w*\b", descriptions[5], re.IGNORECASE):
            raise ValueError("Original class 5 description does not identify agriculture: " + descriptions[5])
        if not re.search(r"\bforest\w*\b", descriptions[8], re.IGNORECASE):
            raise ValueError("Original class 8 description does not identify forest: " + descriptions[8])
        result[model] = {
            "source_table": str(path), "sha256": receiving_driver.sha(path),
            "from_code": 5, "to_code": 8,
            "original_rows": {"5": rows[5], "8": rows[8]},
            "descriptions": {str(key): value for key, value in descriptions.items()},
        }
    return result


def original_baseline(workspace, baseline_id, originals, receiver):
    from model.model_selection import common_comparison_outputs, run_models
    baseline = workspace.inspect_run(baseline_id)
    outputs = common_comparison_outputs([baseline])
    if set(run_models(baseline)) != {"ndr", "sdr"} or len(outputs) != 3:
        raise ValueError("This Gura planning operation requires the completed original NDR and SDR baseline")
    grid = workspace.get_grid(baseline["selection"]["grid_id"])
    spec = grid["spec"]
    definition = grid["grid"]
    if (not math.isclose(float(definition["resolution_m"]), 15, rel_tol=0, abs_tol=1e-8)
            or not math.isclose(float(definition["pixel_area_ha"]), 0.0225,
                                rel_tol=0, abs_tol=1e-10)
            or float(spec["upstream_buffer_m"]) != 0):
        raise ValueError("Gura planning requires the original 15 m grid and zero added watershed buffer")
    profile = workspace._get("profiles", baseline["selection"]["profile_id"])
    original_scenario = workspace._get("scenarios", baseline["selection"]["scenario_id"])
    if original_scenario.get("kind") != "baseline":
        raise ValueError("Choose the original Gura baseline land cover")
    original_table, _ = receiver.joined_table(workspace.root / "gura-receiving", originals, ("ndr", "sdr"))
    retained_table, _ = workspace.source_file(profile["source_collection_id"], profile["biophysical_source_id"])
    if receiver.sha(retained_table) != receiver.sha(original_table):
        raise ValueError("The baseline changed the original joined Gura biophysical parameters")
    for model in ("ndr", "sdr"):
        original = originals[model]
        for key in receiver.ARGUMENT_KEYS[model]:
            supplied = original["original_arguments"][key]
            retained = profile[model][key]
            if key == "flow_dir_algorithm":
                equal = str(supplied).lower() == str(retained).lower()
            else:
                equal = math.isclose(float(supplied), float(retained), rel_tol=0, abs_tol=0)
            if not equal:
                raise ValueError("The baseline changed original Gura parameter " + model + "." + key)
        for role, (key, _) in receiver.INPUTS[model].items():
            source_id = spec["input_sources"][role]
            path, _ = workspace.source_file(spec["source_collection_id"], source_id)
            original_path = Path(original["absolute_arguments"][key])
            if receiver.sha(path) != receiver.sha(original_path):
                receiver.equal_native_rasters(path, original_path)
    for field in ("reporting_area", "model_domain"):
        value = spec[field]
        if value.get("where"):
            raise ValueError("The original Gura domain must retain the complete release watershed")
        path, _ = workspace.source_file(spec["source_collection_id"], value["source_id"])
        receiver.equal_watersheds(path, originals["ndr"]["absolute_arguments"]["watersheds_path"])
    return baseline, grid


def import_units(workspace, receiving, originals, receiver):
    original = originals["ndr"]
    path = Path(original["absolute_arguments"]["watersheds_path"]).with_name("subwatersheds_gura.shp")
    if not path.is_file():
        raise ValueError("The original NDR archive lacks its subwatersheds_gura.shp layer")
    companions = receiver.sidecars(path)
    manifest = {
        "schema": "upstate.sources/v1", "title": "Gura original subwatershed planning units",
        "entries": [{
            "id": "gura_original_subwatersheds", "kind": "vector",
            "title": "Gura original release subwatersheds",
            "path": path.relative_to(receiving).as_posix(), "sha256": receiver.sha(path),
            "uri": original["archive"]["url"] + "#NDR/subwatersheds_gura.shp",
            "vintage": "Official InVEST 3.20.0 sample release",
            "unit_kind": "subwatershed",
            "companions": [{"path": p.relative_to(receiving).as_posix(), "sha256": receiver.sha(p)}
                           for p in companions],
            "scope": "Original Gura, Kenya subwatershed polygons and attributes",
        }],
    }
    manifest_path = receiving / "gura-subwatershed-sources.json"
    if manifest_path.exists():
        if json.loads(manifest_path.read_text(encoding="utf-8")) != manifest:
            raise ValueError("Retained original subwatershed source manifest changed")
    else:
        receiver.atomic(manifest_path, manifest)
    return workspace.import_sources(manifest_path)


def main(argv=None):
    args = parser().parse_args(argv)
    if args.max_count < 1:
        raise ValueError("--max-count must be positive")
    if args.area_ha is not None and (not math.isfinite(args.area_ha) or args.area_ha <= 0):
        raise ValueError("--area-ha must be positive and finite")
    if not math.isfinite(args.min_coverage) or not 0 <= args.min_coverage <= 1:
        raise ValueError("--min-coverage must be between 0 and 1")
    application = args.application.resolve(strict=True)
    sys.path.insert(0, str(application))
    sys.path.insert(0, str(application / "source_tools"))
    import receive_gura_native as receiver
    from model.common import held
    from model.model_selection import run_models
    from model.planning_inventory import build as build_inventory
    from model.portfolios import save_portfolio, prepare_scenario, build_report
    from model.workspace import Workspace
    root = args.workspace.resolve()
    receiving = root / "gura-receiving"
    receiving.mkdir(parents=True, exist_ok=True)
    state_path = receiving / "gura-planning-state.json"
    state = {
        "schema": "upstate.gura-subwatershed-planning/v1",
        "scope": receiver.SCOPE, "state": "starting",
        "request": {"baseline_run_id": args.baseline_run_id, "max_count": args.max_count,
                    "area_ha": args.area_ha, "min_coverage": args.min_coverage,
                    "feature_id_field": args.feature_id_field, "solver": args.solver},
    }
    def checkpoint(stage, **values):
        state.update(stage=stage, updated_at=receiver.now(), **values)
        receiver.atomic(state_path, state)
        receiver.emit("gura-planning-" + stage, state_path=str(state_path), **values)
    with held(receiving / ".planning-driver.lock", blocking=False):
        try:
            checkpoint("original-inputs")
            if args.baseline_run_id is None:
                result = receiver.main([
                    "--application", str(application), "--workspace", str(root),
                    "--inputs", str(args.inputs.resolve()), "--models", "ndr", "sdr",
                    "--mode", "both",
                ])
                if result:
                    raise RuntimeError("Original Gura receiving did not complete; inspect gura-receiving-state.json")
                original_state = json.loads(
                    (receiving / "gura-receiving-state.json").read_text(encoding="utf-8"))
                baseline_id = original_state["workspace_baseline"]["run_id"]
            else:
                baseline_id = args.baseline_run_id
            workspace = Workspace(root)
            originals = {model: receiver.unpack_original(args.inputs, receiving, model)
                         for model in ("ndr", "sdr")}
            classes = checked_conversion(originals, receiver)
            baseline, grid = original_baseline(workspace, baseline_id, originals, receiver)
            units = import_units(workspace, receiving, originals, receiver)
            checkpoint("baseline-ready", baseline_run_id=baseline_id,
                       grid_id=grid["id"], source_collection_id=units["id"],
                       original_class_definitions=classes)
            reason = (
                "Declared Gura planning alternative: convert only original class 5 agriculture "
                "to original class 8 forest within the release watershed. The original table "
                "descriptions and codes are checked before execution; all other land cover, "
                "native parameters, model inputs and the 15 m watershed grid remain retained."
            )
            alternative_scenario = workspace.save_scenario({
                "title": "Gura agriculture-to-forest watershed alternative",
                "reason": reason, "kind": "landcover",
                "source_collection_id": grid["spec"]["source_collection_id"],
                "patches": [{
                    "mask_source_id": grid["spec"]["reporting_area"]["source_id"],
                    "from_codes": [5], "to_code": 8, "reason": reason,
                    **{key: grid["spec"]["reporting_area"][key] for key in ("layer", "where")
                       if key in grid["spec"]["reporting_area"]},
                }],
                "reference_table_definitions": classes,
                "geography": receiver.SCOPE["geography"],
            })
            run_selection = {
                "grid_id": grid["id"], "profile_id": baseline["selection"]["profile_id"],
                "scenario_id": alternative_scenario["id"], "models": list(run_models(baseline)),
            }
            alternative = workspace.prepare_run(run_selection)
            checkpoint("alternative-prepared", alternative_run_id=alternative["id"],
                       alternative_scenario_id=alternative_scenario["id"])
            if alternative.get("state") != "complete":
                alternative = workspace.run(alternative["id"], reuse_source_run_ids=[baseline["id"]])
            if alternative.get("state") != "complete":
                raise ValueError("The actual Gura watershed alternative did not complete")
            selection = {
                "title": "Gura original subwatershed restoration inventory",
                "baseline_run_id": baseline_id, "scenario_run_ids": [alternative["id"]],
                "source_collection_id": units["id"], "source_id": "gura_original_subwatersheds",
                "unit_kind": "subwatershed",
            }
            if args.feature_id_field:
                selection["feature_id_field"] = args.feature_id_field
            inventory = build_inventory(workspace, selection)
            checkpoint("inventory-ready", inventory_id=inventory["id"],
                       inventory_files=inventory["files"], coverage=inventory["coverage"])
            constraints = {"max_count": args.max_count}
            if args.area_ha is not None:
                constraints["area_ha"] = args.area_ha
            portfolio_request = {
                "title": "Gura subwatershed restoration portfolio",
                "purpose": (
                    "Select original Gura subwatersheds under the declared count/area limits, "
                    "using the native watershed alternative's export changes as spatial priorities; "
                    "then execute the selected combined land-cover treatment."
                ),
                "inventory_id": inventory["id"],
                "objective": {"kind": "restoration", "basis": "total",
                              "scenario_run_id": alternative["id"]},
                "weights": {"nitrogen_export": 1, "phosphorus_export": 1, "sediment_export": 1},
                "filters": {"min_coverage_fraction": args.min_coverage,
                            "max_protected_fraction": 1, "source_water": "any",
                            "high_quality_water": "any"},
                "constraints": constraints, "solver": args.solver, "stability": True,
            }
            portfolio = save_portfolio(workspace, portfolio_request)
            checkpoint("portfolio-saved", portfolio_id=portfolio["id"],
                       selected_feature_ids=portfolio["selection"]["feature_ids"],
                       optimization=portfolio["optimization"])
            if not portfolio["selection"]["feature_ids"]:
                report = build_report(workspace, {
                    "portfolio_id": portfolio["id"],
                    "title": "Gura subwatershed planning — no positive feasible selection",
                })
                checkpoint("complete", state="complete", outcome="no-positive-feasible-selection",
                           report_id=report["id"], report_files=report["files"])
                return 0
            selected_scenario = prepare_scenario(workspace, {
                "portfolio_id": portfolio["id"],
                "title": "Gura selected-subwatershed agriculture-to-forest treatment",
                "reason": reason + " Apply within the portfolio's exact selected original subwatershed geometry.",
                "from_codes": [5], "to_code": 8,
            })
            selected_run = workspace.prepare_run({
                "grid_id": grid["id"], "profile_id": baseline["selection"]["profile_id"],
                "scenario_id": selected_scenario["id"], "models": list(run_models(baseline)),
            })
            checkpoint("selected-run-prepared", selected_scenario_id=selected_scenario["id"],
                       evaluation_run_id=selected_run["id"])
            if selected_run.get("state") != "complete":
                selected_run = workspace.run(selected_run["id"], reuse_source_run_ids=[baseline["id"]])
            if selected_run.get("state") != "complete":
                raise ValueError("The selected Gura combined treatment did not complete")
            comparison = workspace.compare_runs([baseline["id"], selected_run["id"]])
            report = build_report(workspace, {
                "portfolio_id": portfolio["id"], "evaluation_run_id": selected_run["id"],
                "comparison_id": comparison["id"],
                "title": "Gura subwatershed portfolio — completed native treatment",
            })
            checkpoint("evaluated", evaluation_run_id=selected_run["id"],
                       comparison_id=comparison["id"], report_id=report["id"],
                       report_files=report["files"])
            if args.archive:
                destination = args.archive.resolve()
                if destination.is_relative_to(root):
                    raise ValueError("Save the workspace backup outside its source tree")
                checkpoint("archived", backup=workspace.backup(destination, include_intermediates=False))
            checkpoint("complete", state="complete", completed_at=receiver.now(),
                       outcome="completed-native-selected-treatment")
            return 0
        except Exception as error:
            checkpoint("error", state="error", error={
                "type": type(error).__name__, "message": str(error),
                "traceback": traceback.format_exc(),
            })
            logging.exception("Gura planning operation failed at its actual stage")
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
