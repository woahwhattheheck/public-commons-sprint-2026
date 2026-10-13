#!/usr/bin/env python3
"""Bind original SPARROW references to completed baseline runs and retain the course.

No native NDR/SDR run is dispatched. The maintained observation/calibration
engines perform the original whole-catchment reduction and parameter scoring.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

from model import calibration, calibration_execution
from model.common import atomic_json, digest, held, read_json, verify_file
from model.workspace import Workspace
from source_tools.usgs_annual import bind

SCHEMA = "upstate.sparrow-candidate-course/v1"
VERSION = 1
ROOT = Path(__file__).resolve().parents[1]
PREPARED = ROOT / "source/usgs-southeast-sparrow-2012/prepared-tributaries"
PRESET = ROOT / "source/usgs-southeast-sparrow-2012/candidate-course.json"
CODE_PATHS = (
    "source_tools/sparrow_candidate_course.py", "source_tools/usgs_annual.py",
    "model/calibration.py", "model/calibration_execution.py",
    "model/observations.py", "model/observation_support.py", "model/rasters.py",
    "model/native_versions.py", "model/model_selection.py",
)


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _baseline_runs(workspace, ensemble_id, run_ids):
    if ensemble_id:
        ensemble = workspace._get("ensembles", ensemble_id)
        run_ids = []
        for member in ensemble["members"]:
            candidates = [r for r in member["runs"] if r.get("role") == "baseline"]
            if len(candidates) != 1:
                raise ValueError("Each original ensemble member must retain one explicit baseline")
            row = candidates[0]
            if row["scenario_id"] != ensemble["baseline_scenario_id"]:
                raise ValueError("Original ensemble baseline selection differs")
            if row["run_id"] not in run_ids:
                run_ids.append(row["run_id"])
        retained = {"id": ensemble["id"], "grid_id": ensemble["grid_id"],
                    "baseline_scenario_id": ensemble["baseline_scenario_id"],
                    "members": ensemble["members"]}
    else:
        if len(set(run_ids)) != len(run_ids):
            raise ValueError("Select each original native candidate once")
        retained = None
    if not run_ids:
        raise ValueError("Select completed original baseline candidates")
    # _candidates below performs the maintained state, grid, scenario, model and
    # actual producing-version validation before any comparison is created.
    return run_ids, retained


def _original_reference(workspace, binding, preset):
    observed = workspace._get("observations", binding["observation_id"])
    if observed["original"]["sha256"] != preset["annual_csv_sha256"]:
        raise ValueError("The admitted annual source is not this original prepared edition")
    expected = {r["record_id"]: r for r in preset["records"]}
    found = {r["id"]: r for r in observed["rows"]}
    if len(found) != len(observed["rows"]) or set(found) != set(expected):
        raise ValueError("Retain every original preset observation exactly once")
    for key, row in found.items():
        original = expected[key]
        for field in ("catchment_id", "station_id", "parameter", "period_start", "period_end", "unit"):
            if row[field] != original[field]:
                raise ValueError("Original observation identity differs: " + key + " / " + field)
        if row["value"] != original["value"] or not row["admitted"]:
            raise ValueError("Original annual target value or admission differs: " + key)
    _, source = workspace.source_file(binding["catchments"]["source_collection_id"],
                                      binding["catchments"]["source_id"])
    if source["body"]["sha256"] != preset["catchments_sha256"]:
        raise ValueError("The original complete catchment source differs")
    return observed



def _derived_catchments(workspace, selector, binding, contract, preset, observed, grid):
    """Verify an explicit producer's same-DEM basin edition and native outlets."""
    from math import isfinite
    from pyproj import CRS, Geod, Transformer
    from shapely.geometry import Point
    from model import rasters

    if contract is None or not isinstance(contract.get("delineation_record"), dict):
        raise ValueError("A separate basin edition needs its retained same-DEM delineation record")
    record = read_json(verify_file(workspace.root, contract["delineation_record"]))
    # A companion cannot contain the content-addressed ID of its own collection.
    # Bind its source-local selector before import; retain the actual collection
    # in the external contract and returned course binding after import.
    local_selector = {key: value for key, value in selector.items()
                      if key != "source_collection_id"}
    source_path, entry = workspace.source_file(selector["source_collection_id"], selector["source_id"])
    if (record.get("schema") != "upstate.annual-reference-delineation/v1"
            or record.get("dem_source_sha256") != grid["inputs"]["DEM"]["source_sha256"]
            or record.get("prepared_dem_sha256") != grid["files"]["DEM"]["sha256"]
            or record.get("original_catchments_sha256") != preset["catchments_sha256"]
            or record.get("derived_catchments_sha256") != entry["body"]["sha256"]
            or record.get("catchment_selection") != local_selector
            or not isinstance(record.get("method"), str) or not record["method"].strip()):
        raise ValueError("Delineation must retain the actual model DEM, source basins and selected output edition")
    verify_file(workspace.root / "grids" / grid["id"], grid["files"]["DEM"])
    retained = {(v["sha256"], v["bytes"]) for v in entry["companions"]}
    if not any(v["sha256"] == preset["catchments_sha256"] for v in entry["companions"]):
        raise ValueError("The derived source must retain the complete original NLDI basin body as a companion")
    descriptor = contract["delineation_record"]
    if (descriptor["sha256"], descriptor["bytes"]) not in retained:
        raise ValueError("The actual derivation record must be a portable companion of its derived basin source")
    producer_files = record.get("producer_files")
    if not isinstance(producer_files, list) or not producer_files:
        raise ValueError("Retain the actual delineation arguments/log or producer record")
    for item in producer_files:
        if (item["sha256"], item["bytes"]) not in retained:
            raise ValueError("Every original delineation producer file must remain a source companion")
        # Independent receiving preserves original producer descriptors verbatim.
        # Resolve by the already verified native companion body, rather than
        # requiring the former Workspace's execution-directory layout.
        matches = [v for v in entry["companions"]
                   if (v["sha256"], v["bytes"]) == (item["sha256"], item["bytes"])]
        if not matches:
            raise ValueError("Retained delineation producer companion is missing")
        companion = matches[0]
        verify_file(workspace.root, {"path": companion["object"],
                                    "sha256": item["sha256"], "bytes": item["bytes"]})
    features, crs = rasters.vector_geometry(
        source_path, layer=selector.get("layer") or entry.get("layer"), where=selector.get("where"))
    polygons = {str(f["properties"][selector["id_field"]]): f["geometry"] for f in features}
    source_rows = {r["id"]: r for r in observed["rows"]}
    expected = {r["catchment_id"] for r in preset["records"]}
    outlets = record.get("outlets")
    if (not isinstance(outlets, list) or len(outlets) != len(expected)
            or {v.get("catchment_id") for v in outlets} != expected):
        raise ValueError("Retain one original outlet mapping for every selected reference catchment")
    checks = []
    geod = Geod(ellps="WGS84")
    for row in outlets:
        original = source_rows.get(row.get("source_record_id"))
        if original is None or original["catchment_id"] != row["catchment_id"]:
            raise ValueError("Delineation outlet is not one of this basin's original annual-reference records")
        attributes = original["source_records"]
        lon, lat = attributes.get("longitude"), attributes.get("latitude")
        if (row.get("original_longitude") != lon or row.get("original_latitude") != lat
                or any(isinstance(v, bool) or not isinstance(v, (int, float))
                       or not isfinite(v) for v in (lon, lat))
                or not (-180 <= lon <= 180 and -90 <= lat <= 90)):
            raise ValueError("The original published outlet coordinates changed")
        xy = row.get("model_outlet_xy")
        if (not isinstance(xy, list) or len(xy) != 2 or
                any(isinstance(v, bool) or not isinstance(v, (int, float)) or not isfinite(v) for v in xy)):
            raise ValueError("Retain the actual finite delineation outlet coordinates")
        transform = Transformer.from_crs(CRS.from_user_input(row["model_outlet_crs"]),
                                         CRS.from_user_input(crs), always_xy=True)
        px, py = transform.transform(*xy)
        polygon = polygons.get(row["catchment_id"])
        if polygon is None or not polygon.covers(Point(px, py)):
            raise ValueError("Actual delineation outlet is outside its selected upstream basin")
        transform_ll = Transformer.from_crs(CRS.from_user_input(row["model_outlet_crs"]),
                                            "EPSG:4326", always_xy=True)
        mlon, mlat = transform_ll.transform(*xy)
        _, _, distance = geod.inv(lon, lat, mlon, mlat)
        checks.append({**row, "source_station_id": original["station_id"],
                       "model_outlet_within_derived_basin": True,
                       "original_to_model_outlet_distance_m": abs(distance)})
    return {"original_selection": binding["catchments"], "selected_selection": selector,
            "source_entry": entry, "delineation_record_file": contract["delineation_record"],
            "original_delineation_record": record, "outlet_checks": checks,
            "membership_method": "Original reference IDs and published coordinates matched exactly; "
                                 "each retained model outlet lies within its source-native derived basin. "
                                 "The original producer method/arguments retain the drainage derivation."}


def _input_binding(workspace, basis, contract):
    grid = workspace.get_grid(basis["candidates"][0]["grid_id"])
    directory = workspace.root / "grids" / grid["id"]
    # These are the actual prepared model domain and reporting area, retained
    # separately from the full original gauge catchments and native stage exports.
    geometric = {name: grid["files"][name] for name in
                 ("model_domain", "reporting_area", "reporting_mask") if name in grid["files"]}
    for item in geometric.values():
        verify_file(directory, item)
    sources = {}
    for role, value in grid["inputs"].items():
        path, entry = workspace.source_file(grid["spec"]["source_collection_id"],
                                            grid["spec"]["input_sources"][role])
        if value["source_sha256"] != entry["body"]["sha256"]:
            raise ValueError("Prepared input and retained original source differ for " + role)
        sources[role] = {"selection": {"source_collection_id": grid["spec"]["source_collection_id"],
                                      "source_id": entry["id"]},
                         "metadata": entry, "prepared": value}
    snapshot = {"grid_id": grid["id"], "scenario_id": basis["candidates"][0]["scenario_id"],
                "grid": grid["grid"], "grid_spec": grid["spec"], "original_inputs": sources,
                "prepared_geography": geometric,
                "profiles": [{key: item.get(key) for key in
                              ("run_id", "profile_id", "model_period", "profile_references",
                               "table_summary", "parameters")} for item in basis["candidates"]]}
    if contract is not None:
        if (not isinstance(contract, dict)
                or set(contract) - {"schema", "grid_id", "scenario_id", "input_source_sha256",
                                    "catchments_sha256", "model_domain_sha256", "reporting_mask_sha256",
                                    "interpretation", "alignment_files", "delineation_record"}
                or contract.get("schema") != "upstate.annual-reference-input-contract/v1"):
            raise ValueError("Use the explicit annual-reference input contract schema")
        for key in ("grid_id", "scenario_id"):
            if key in contract and contract[key] != snapshot[key]:
                raise ValueError("The actual " + key + " differs from the selected input contract")
        for field, role in (("model_domain_sha256", "model_domain"),
                            ("reporting_mask_sha256", "reporting_mask")):
            if contract.get(field) != geometric.get(role, {}).get("sha256"):
                raise ValueError("The retained " + role + " differs from the input contract")
        expected = contract.get("input_source_sha256")
        if (not isinstance(expected, dict) or not expected
                or set(expected) != set(sources)):
            raise ValueError("Pin every actual model input role in input_source_sha256")
        for role, sha in expected.items():
            if sha != sources[role]["metadata"]["body"]["sha256"]:
                raise ValueError("The actual original source edition differs for " + role)
        if contract.get("catchments_sha256") != basis["spatial_groups"]["source"]["sha256"]:
            raise ValueError("The original gauge catchment edition differs from the contract")
        if not isinstance(contract.get("interpretation"), str) or not contract["interpretation"].strip():
            raise ValueError("Retain the source periods and same-DEM gauge alignment interpretation")
        # The owner can bind original same-DEM delineation/source comparisons as
        # actual retained files; a prose declaration alone cannot alter geometry.
        for item in contract.get("alignment_files", []):
            verify_file(workspace.root, item)
        snapshot["input_contract"] = contract
    return snapshot


def _comparison(workspace, basis, candidate, progress, output):
    run_id = candidate["run_id"]
    previous = progress.get("comparisons", {}).get(run_id)
    if previous:
        if previous["execution_fingerprint"] != candidate["execution_fingerprint"]:
            raise ValueError("Original candidate execution changed; use a new course output")
        value = workspace._get("observation-comparisons", previous["id"])
        if not calibration._matching_comparison(value, basis, run_id, checkpoint_matches=True):
            raise ValueError("Retained course comparison source or producing files differ")
        atomic_json(output / ("comparison-" + run_id + ".json"), value, immutable=True)
        return value
    existing = [v for v in workspace._list("observation-comparisons")
                if calibration._matching_comparison(v, basis, run_id)]
    value = (sorted(existing, key=lambda x: x["id"])[0] if existing else
             workspace.compare_observations(run_id, basis["selection"]["observation_id"],
                                            basis["selection"]["catchments"]))
    if not calibration._matching_comparison(value, basis, run_id, checkpoint_matches=True):
        raise ValueError("Native comparison changed its source or output identity")
    progress.setdefault("comparisons", {})[run_id] = {
        "id": value["id"], "execution_fingerprint": candidate["execution_fingerprint"]}
    atomic_json(output / ("comparison-" + run_id + ".json"), value, immutable=True)
    atomic_json(output / "progress.json", progress)
    return value


def _support(basis, comparisons, preset):
    wanted = {r["record_id"] for r in preset["records"]}
    complete, details = set(wanted), []
    for run_id, result in comparisons.items():
        rows = {r["observation_id"]: r for r in result["comparisons"]}
        if len(rows) != len(result["comparisons"]):
            raise ValueError("Native comparison repeats an original observation ID")
        good = {key for key, row in rows.items() if row.get("included_in_metrics") is True}
        complete &= good
        details.append({"run_id": run_id, "comparison_id": result["id"],
                        "complete_observation_ids": sorted(wanted & good),
                        "partial_rows": [r for r in result["comparisons"]
                                         if r["observation_id"] in wanted and not r["included_in_metrics"]],
                        "exclusions": result["exclusions"]})
    selected = [r for r in preset["records"] if r["record_id"] in complete]
    parameters = sorted({r["parameter"] for r in selected})
    assignments = basis["spatial_groups"]["assignments"]
    groups = {assignments[r["catchment_id"]] for r in selected}
    target = assignments.get(preset["preferred_validation_catchment"])
    training_parameters = {r["parameter"] for r in selected if assignments[r["catchment_id"]] != target}
    validation = [target] if target in groups and groups - {target} and set(parameters) <= training_parameters else []
    return {"basis": preset["selection_policy"], "selected_observation_ids": sorted(complete),
            "excluded_observation_ids": sorted(wanted - complete),
            "parameters": parameters, "calibration_group_ids": sorted(groups - set(validation)),
            "validation_group_ids": validation, "candidate_support": details,
            "all_original_geographic_groups": basis["spatial_groups"],
            "selected_catchment_groups": {r["catchment_id"]: assignments[r["catchment_id"]] for r in selected}}


def operate(workspace_path, prepared, preset_path, output, *, ensemble_id=None,
            run_ids=None, reference_run_id=None, input_contract=None, interpretation=None,
            catchment_selector=None):
    workspace = Workspace(workspace_path)
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    preset = read_json(preset_path)
    if preset.get("schema") != "upstate.sparrow-candidate-course-preset/v1":
        raise ValueError("Use the complete original SPARROW candidate-course preset")
    contract = read_json(input_contract) if input_contract else None
    selected_catchments = read_json(catchment_selector) if catchment_selector else None
    if selected_catchments is not None and contract is None:
        raise ValueError("An alternate catchment edition requires its actual input/delineation contract")
    with held(output / ".course.lock", blocking=False):
        progress_path = output / "progress.json"
        progress = read_json(progress_path) if progress_path.exists() else {"schema": SCHEMA, "comparisons": {}}
        admitted = False
        try:
            binding = bind(workspace.root, prepared)
            if binding["original_preparation_id"] != preset["preparation_id"]:
                raise ValueError("Original prepared tributary identity differs")
            observed = _original_reference(workspace, binding, preset)
            candidates, ensemble = _baseline_runs(workspace, ensemble_id, list(run_ids or []))
            if reference_run_id and reference_run_id not in candidates:
                raise ValueError("Explicit reference run must be an original selected baseline")
            notes = [
                preset["source_interpretation"]["annualization_method"],
                *preset["source_interpretation"]["notes"],
                preset["selection_policy"]["simulated_inputs"],
                "Native stage export rasters cover original whole upstream catchments, including land "
                "outside the four-anchor South Carolina reporting mask. Reporting-mask totals are not gauge loads.",
                interpretation or "Annual-reference comparison of the retained original inputs. Review each "
                "input's actual vintage and the relation between source basin and the model's DEM-derived drainage.",
            ]
            if contract:
                notes.append(contract["interpretation"])
            selection = {"schema": calibration.SELECTION_SCHEMA, "title": preset["title"],
                         "candidate_run_ids": candidates, "observation_id": binding["observation_id"],
                         "catchments": selected_catchments if selected_catchments is not None else binding["catchments"],
                         "observation_record_ids": [r["record_id"] for r in preset["records"]],
                         "temporal_weighting": "whole_years", "notes": notes, "leave_group_out": False}
            if reference_run_id:
                selection["reference_run_id"] = reference_run_id
            basis = calibration.preview(workspace, selection)
            calibration_execution.cohort(workspace, basis["candidates"], basis["selection"]["objective"], verify=True)
            inputs = _input_binding(workspace, basis, contract)
            if selected_catchments is not None:
                inputs["catchment_derivation"] = _derived_catchments(
                    workspace, selected_catchments, binding, contract, preset, observed,
                    workspace.get_grid(inputs["grid_id"]))
                notes.append("Separate same-DEM catchment edition: " + json.dumps(
                    {"original_selection": binding["catchments"], "selected_selection": selected_catchments,
                     "original_catchments_sha256": preset["catchments_sha256"],
                     "selected_catchments_sha256": basis["spatial_groups"]["source"]["sha256"],
                     "delineation_record": contract["delineation_record"]}, sort_keys=True))
            identity = {"schema": SCHEMA, "version": VERSION, "workspace_id": workspace.project["id"],
                        "binding": binding, "preset_sha256": _sha(preset_path), "ensemble": ensemble,
                        "original_selection": selection, "native_execution": basis["native_execution"],
                        "model_inputs": inputs, "code_sha256": {p: _sha(ROOT / p) for p in CODE_PATHS}}
            identity["id"] = digest(identity)
            if progress.get("course_id") not in (None, identity["id"]):
                raise ValueError("This output retains another immutable course; select a fresh directory")
            atomic_json(output / "course-input.json", identity, immutable=True)
            admitted = True
            progress.pop("error", None)
            progress.update(course_id=identity["id"], state="running", phase="original_comparisons")
            atomic_json(progress_path, progress)
            comparisons = {}
            for candidate in basis["candidates"]:
                progress["current_run_id"] = candidate["run_id"]
                atomic_json(progress_path, progress)
                comparisons[candidate["run_id"]] = _comparison(workspace, basis, candidate, progress, output)
            support = _support(basis, comparisons, preset)
            atomic_json(output / "original-support.json", support, immutable=True)
            result = None
            plan = None
            if support["selected_observation_ids"]:
                selection.update(
                    observation_record_ids=support["selected_observation_ids"],
                    catchment_groups=support["selected_catchment_groups"],
                    calibration_group_ids=support["calibration_group_ids"],
                    validation_group_ids=support["validation_group_ids"],
                    objective={p: {"weight": 1.0} for p in support["parameters"]})
                notes.extend([
                    "Coverage-based reference subset and whole-group holdout were fixed before reading fit scores; "
                    "every original row and partial comparison remains in this course.",
                    "Course input identity " + identity["id"],
                    "Input source editions: " + json.dumps(
                        {r: v["source_sha256"] for r, v in workspace.get_grid(inputs["grid_id"])["inputs"].items()},
                        sort_keys=True),
                ])
                selection["notes"] = notes
                plan = calibration.prepare(workspace, selection)
                atomic_json(output / "selection.json", plan["selection"], immutable=True)
                atomic_json(output / "plan.json", plan, immutable=True)
                progress.update(phase="reference_evaluation", plan_id=plan["id"])
                atomic_json(progress_path, progress)
                result = calibration.analyze(workspace, plan["id"])
                atomic_json(output / "result.json", result, immutable=True)
            summary = {"schema": SCHEMA, "id": identity["id"], "state": "complete",
                       "workspace_id": workspace.project["id"],
                       "observation_id": binding["observation_id"], "catchments": selection["catchments"],
                       "original_reference_catchments": binding["catchments"],
                       "ensemble_id": ensemble["id"] if ensemble else None, "candidate_run_ids": candidates,
                       "original_reference_count": len(observed["rows"]),
                       "complete_reference_count": len(support["selected_observation_ids"]),
                       "selected_observation_ids": support["selected_observation_ids"],
                       "excluded_observation_ids": support["excluded_observation_ids"],
                       "comparison_ids": {k: v["id"] for k, v in comparisons.items()},
                       "plan_id": plan["id"] if plan else None, "result_id": result["id"] if result else None,
                       "evaluation_state": result["state"] if result else "original_comparisons_complete",
                       "evaluation_design": result["evaluation_design"] if result else "no_complete_common_catchment",
                       "selected_run_id": result.get("selected_run_id") if result else None,
                       "interpretation": notes, "original_input": "course-input.json",
                       "original_support": "original-support.json",
                       "continuation": "Open the saved annual references and, when present, the exact Calibration result; "
                                       "Continue selected profile retains the original plan/source editions."}
            atomic_json(output / "course.json", summary, immutable=True)
            progress.update(state="complete", phase="complete", current_run_id=None)
            atomic_json(progress_path, progress)
            return summary
        except BaseException as error:
            # A rejected source/code/candidate binding must not relabel the
            # original course checkpoint. Its current error goes to stderr.
            if not admitted:
                raise
            progress.update(state="interrupted" if isinstance(error, (KeyboardInterrupt, SystemExit)) else "failed",
                            error={"type": type(error).__name__, "message": str(error)})
            try:
                atomic_json(progress_path, progress)
            except OSError:
                pass
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--prepared", type=Path, default=PREPARED)
    parser.add_argument("--preset", type=Path, default=PRESET)
    parser.add_argument("--output", type=Path, required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--ensemble-id")
    group.add_argument("--candidate-run-id", action="append")
    parser.add_argument("--reference-run-id")
    parser.add_argument("--input-contract", type=Path)
    parser.add_argument("--catchments", type=Path, help="Optional retained same-DEM catchment source selector")
    parser.add_argument("--interpretation", help="Original model/source periods and physical input meaning")
    args = parser.parse_args(argv)
    try:
        result = operate(args.workspace, args.prepared, args.preset, args.output,
                         ensemble_id=args.ensemble_id, run_ids=args.candidate_run_id,
                         reference_run_id=args.reference_run_id, input_contract=args.input_contract,
                         interpretation=args.interpretation, catchment_selector=args.catchments)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0 if result["evaluation_state"] != "no_eligible_candidates" else 2
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, ArithmeticError) as error:
        print("Original annual-reference course: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
