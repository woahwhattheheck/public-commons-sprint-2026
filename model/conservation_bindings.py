"""Read-through conservation selections for implementation and editable design.

The existing conservation plan remains the authoritative saved selection.
This module creates portable consumer views and validates source references.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path, PurePosixPath
import sys

from . import conservation, rasters
from .common import (
    INVEST_VERSION, atomic_json, canonical, describe_file, digest,
    identifier, read_json, verify_file,
)

SCHEMA = "upstate.conservation-binding/v1"
REFERENCE_SCHEMA = "upstate.conservation-plan-reference/v1"
SUPPORTED_INVEST_VERSION = "3.20.0"
GEOMETRY_CRS = "EPSG:4326"
ANNUAL_UNITS = {
    "nitrogen_export": "kg/year",
    "phosphorus_export": "kg/year",
    "sediment_export": "metric_tonnes/year",
}


def _copy(value):
    return json.loads(canonical(value))


def _descriptor(prefix, item):
    """Express an existing file identity relative to the original Workspace."""
    if not isinstance(item, dict):
        raise ValueError("A retained input file descriptor is required")
    path = PurePosixPath(item["path"])
    if (path.is_absolute() or not path.parts or ".." in path.parts
            or "\\" in item["path"] or "\0" in item["path"]):
        raise ValueError("Retained file paths must remain within their original Workspace")
    result = _copy(item)
    result["path"] = (PurePosixPath(prefix) / path).as_posix() if prefix else path.as_posix()
    return result


def _object_descriptor(body):
    return {
        "path": body["object"], "bytes": body["bytes"], "sha256": body["sha256"],
        "filename": body["filename"], "view_path": body.get("view_path", body["filename"]),
        "source_path": body.get("source_path", body["filename"]),
    }


def _selection(workspace, plan_id):
    plan = conservation.get_plan(workspace, identifier(plan_id))
    if plan.get("state") != "complete":
        raise ValueError("Complete the original conservation portfolio before attaching a consumer")
    study = conservation.inspect(workspace, plan["study_id"], include_candidates=True)
    if study.get("state") != "complete":
        raise ValueError("The original conservation study must be complete")
    selected = plan.get("selected_ids")
    if (not isinstance(selected, list) or not selected
            or not all(isinstance(value, str) for value in selected)
            or len(set(selected)) != len(selected)):
        raise ValueError("The saved portfolio needs unique original string unit identities")
    indexed = {row["id"]: row for row in study["candidates"]}
    if len(indexed) != len(study["candidates"]) or set(selected) - set(indexed):
        raise ValueError("The portfolio selection differs from its original candidate inventory")
    if plan["selection"]["candidates_sha256"] != study["files"]["candidates"]["sha256"]:
        raise ValueError("The saved portfolio binds a different candidate inventory")
    if plan["selection"]["geometries_sha256"] != study["files"]["geometries"]["sha256"]:
        raise ValueError("The saved portfolio binds a different geometry inventory")
    footprint = plan["files"]["footprint"]
    if footprint.get("layer") != "selected_union":
        raise ValueError("Select the existing saved reporting-area union")
    verify_file(workspace.root, footprint)
    return plan, study, [indexed[key] for key in selected]


def plan_reference(workspace, plan_id):
    """Return a compact stable foreign reference for task, site and design records."""
    plan, study, _ = _selection(workspace, plan_id)
    return _reference(workspace, plan, study)


def _source_assets(workspace, study):
    result = {}
    collections = {}
    for role, source in study["selection"]["bindings"]["sources"].items():
        selection = source["selection"]
        collection_id = selection["source_collection_id"]
        if collection_id not in collections:
            collections[collection_id] = workspace._get("sources", collection_id)
        collection = collections[collection_id]
        entries = [entry for entry in collection["entries"] if entry["id"] == selection["source_id"]]
        if len(entries) != 1:
            raise ValueError("The original source edition has no unique selected entry")
        entry = entries[0]
        if entry["body"]["sha256"] != source["body"]["sha256"]:
            raise ValueError("The conservation source body differs from its saved edition")
        result[role] = {
            "selection": _copy(selection),
            "collection_id": collection_id,
            "collection_title": collection.get("title"),
            "collection_manifest": _object_descriptor(collection["original_manifest"]),
            "entry": _copy(entry),
            "body": _object_descriptor(entry["body"]),
            "companions": [_object_descriptor(item) for item in entry.get("companions", [])],
            "relation": source.get("relation"),
            "meaning": source.get("meaning"),
            "reference": source.get("reference"),
            "geometry_role": (
                "Original retained source bytes, including source properties and any original Z/M axes"
                if entry["kind"] == "vector" else "Original retained source bytes"
            ),
        }
    return result


def _same_file(left, right):
    return (isinstance(left, dict) and isinstance(right, dict)
            and all(key in left and key in right and left[key] == right[key]
                    for key in ("path", "bytes", "sha256")))



def _validate_execution_snapshot(execution, selected):
    """Validate retained resolver output without changing its observed/legacy basis."""
    from .native_versions import POLICY
    if (not isinstance(execution, dict) or execution.get("policy") != POLICY
            or execution.get("unit_contract_version") != SUPPORTED_INVEST_VERSION
            or execution.get("supported") is not True
            or set(execution.get("model_versions", {})) != set(selected)):
        raise ValueError("Retain the exact selected models and supported native unit provenance")
    for name in selected:
        row = execution["model_versions"][name]
        if row.get("model") != name or row.get("comparison_version") != SUPPORTED_INVEST_VERSION:
            raise ValueError("The model execution version differs from its declared rate-unit adapter")
        basis = row.get("basis")
        if basis == "completed_stage_runtime":
            valid = row.get("observed_stage_version") == row["comparison_version"] and bool(row.get("stage_completed_at"))
        elif basis == "observed_run_fallback":
            valid = (row.get("observed_stage_version") is None
                     and row.get("observed_run_version") == row["comparison_version"])
        elif basis == "requested_legacy":
            valid = (row.get("observed_stage_version") is None
                     and row.get("observed_run_version") is None
                     and row.get("requested_version") == row["comparison_version"])
        else:
            valid = False
        if not valid:
            raise ValueError("Preserve the actual completed-stage, run fallback or labeled legacy version basis")
    return execution

def _native_bindings(workspace, study):
    result = {}
    original = study["selection"]["bindings"]["runs"]
    if study["mode"] == "source_context":
        if original:
            raise ValueError("A source-context study cannot carry completed model-run bindings")
        return result
    if INVEST_VERSION != SUPPORTED_INVEST_VERSION:
        raise ValueError("This conservation consumer requires the original InVEST 3.20.0 unit contract")
    baseline_id = study["selection"]["spec"]["baseline_run_id"]
    executions = conservation._bound_native_execution(workspace, study)
    for run_id, bound in original.items():
        current = workspace.inspect_run(run_id)
        if current["state"] != "complete" or current["selection"] != bound["selection"]:
            raise ValueError("The original completed native run/version differs from the saved study")
        selected = conservation._selected_models(bound["selection"])
        expected_outputs = set(conservation._selected_outputs(bound["selection"]))
        if set(bound["outputs"]) != expected_outputs:
            raise ValueError("Retain exactly the original run's selected native output registry")
        prefix = "runs/" + run_id
        outputs = {}
        for pollutant, item in bound["outputs"].items():
            if pollutant not in ANNUAL_UNITS or item["unit"] != ANNUAL_UNITS[pollutant]:
                raise ValueError("Keep the original separate annual pollutant units")
            stage = current["stages"][item["stage"]]
            if (not _same_file(stage["files"][item["output_id"]], item["rate"])
                    or not _same_file(stage["files"][item["stream_id"]], item["stream"])
                    or not _same_file(stage["arguments"], item["arguments"])):
                raise ValueError("The native output registry differs from the bound original run")
            outputs[pollutant] = {
                **_copy(item),
                "execution": _copy(executions[run_id]["model_versions"][item["stage"]]),
                "rate": _descriptor(prefix, item["rate"]),
                "stream": _descriptor(prefix, item["stream"]),
                "arguments": _descriptor(prefix, item["arguments"]),
                "native_rate_unit": (
                    "metric_tonnes/ha/year" if pollutant == "sediment_export" else "kg/ha/year"
                ),
                "annual_quantity_unit": ANNUAL_UNITS[pollutant],
                "registry_run_root": prefix,
            }
        result[run_id] = {
            "id": run_id,
            "role": "baseline" if run_id == baseline_id else "alternative",
            "selection": _copy(bound["selection"]),
            "runtime": _copy(bound.get("runtime")),
            "execution": _copy(executions[run_id]),
            "completed_at": bound.get("completed_at"),
            "outputs": outputs,
            "selected_models": selected,
            "output_availability": {
                pollutant: {
                    "availability": "modeled" if pollutant in expected_outputs else "not_selected",
                    "availability_reason": None if pollutant in expected_outputs else (
                        conservation.POLLUTANTS[pollutant][0].upper()
                        + " was not selected in run " + run_id
                    ),
                } for pollutant in ANNUAL_UNITS
            },
            "file_reference_root": "workspace",
        }
    return result


def _unit_reference(candidate):
    source = candidate["source_identity"]
    if (not isinstance(source, dict)
            or not all(isinstance(source.get(key), str) and source[key]
                       for key in ("source_collection_id", "source_id", "native_id"))
            or source["native_id"] != candidate["id"]):
        raise ValueError("The candidate lacks its complete original source identity")
    identity = {
        "source_collection_id": source["source_collection_id"],
        "source_id": source["source_id"], "native_id": source["native_id"],
    }
    return {
        "kind": "retained_planning_unit", "unit_key": digest(identity),
        **identity,
    }


def _candidate_views(candidates, reference):
    result = []
    for candidate in candidates:
        unit = _unit_reference(candidate)
        result.append({
            "unit_ref": unit,
            "plan_ref": {key: reference[key] for key in ("workspace_id", "plan_id", "study_id")},
            "candidate": _copy(candidate),
            "implementation_basis": {
                "unit_id": candidate["id"], "label": candidate["label"],
                "unit_type": candidate["unit_type"],
                "whole_unit_area_ha": candidate["area_ha"],
                "reporting_area_ha": candidate["reporting_area_ha"],
                "supplied_whole_unit_cost": candidate["cost"],
                "currency": candidate["currency"],
                "cost_role": "Original supplied planning amount",
                "eligibility_at_selection": candidate["eligible"],
                "selection_exclusion_reasons": _copy(candidate["exclusion_reasons"]),
            },
        })
    return result


def _geometry_views(workspace, plan, study, selected):
    """Standard lon/lat GeoJSON views; retain the original metric geometry separately."""
    from pyproj import CRS, Transformer
    from shapely import wkb
    from shapely.geometry import mapping
    from shapely.ops import transform, unary_union

    analysis_crs = CRS.from_user_input(study["analysis_crs"])
    target = CRS.from_epsg(4326)
    project = Transformer.from_crs(analysis_crs, target, always_xy=True).transform
    inventory = read_json(verify_file(workspace.root, study["files"]["geometries"]))
    if inventory["study_id"] != study["id"] or CRS.from_user_input(inventory["analysis_crs"]) != analysis_crs:
        raise ValueError("The retained geometry inventory differs from this study")
    raw_units = inventory["units"]
    original, reporting = [], []
    original_union_inputs = []
    selected_keys = set(plan["selected_ids"])

    def view(geometry):
        if geometry.is_empty or not geometry.is_valid:
            raise ValueError("The retained portfolio geometry requires its original correction")
        mapped = transform(project, geometry)
        if mapped.is_empty or not mapped.is_valid:
            raise ValueError("The selected display transformation produces invalid geometry")
        return mapping(mapped)

    for row in selected:
        native = raw_units.get(row["id"])
        if native is None:
            raise ValueError("Selected unit geometry is absent")
        whole = wkb.loads(bytes.fromhex(native["original"]))
        clipped = wkb.loads(bytes.fromhex(native["reporting"]))
        if whole.geom_type not in ("Polygon", "MultiPolygon") or clipped.geom_type not in ("Polygon", "MultiPolygon"):
            raise ValueError("The selected planning-unit boundaries must remain polygonal")
        unit = _unit_reference(row)
        properties = {
            "unit_key": unit["unit_key"], "unit_id": row["id"], "label": row["label"],
            "source_collection_id": unit["source_collection_id"],
            "source_id": unit["source_id"],
            "plan_id": plan["id"], "study_id": study["id"],
            "whole_unit_area_ha": row["area_ha"], "reporting_area_ha": row["reporting_area_ha"],
            "original_attributes": _copy(row["original_attributes"]),
        }
        original.append({
            "type": "Feature", "id": unit["unit_key"], "geometry": view(whole),
            "properties": {**properties, "geometry_role": "Whole source unit transformed to the study analysis plane"},
        })
        reporting.append({
            "type": "Feature", "id": unit["unit_key"], "geometry": view(clipped),
            "properties": {**properties, "geometry_role": "Source unit intersected with the saved reporting area"},
        })
        original_union_inputs.append(whole)

    union_path = verify_file(workspace.root, plan["files"]["footprint"])
    union_rows, _ = rasters.vector_geometry(union_path, layer="selected_union", target_crs=analysis_crs)
    saved_union = rasters.polygon_union(union_rows)
    whole_union = unary_union(original_union_inputs)
    union_properties = {
        "plan_id": plan["id"], "study_id": study["id"],
        "selected_ids": list(plan["selected_ids"]),
        "unit_count": len(selected_keys),
    }
    return {
        "representation_crs": GEOMETRY_CRS,
        "coordinate_order": "longitude, latitude",
        "analysis_crs": study["analysis_crs"],
        "area_basis": "Areas remain the original saved projected-plane hectares; display coordinates do not recompute area",
        "geometry_provenance": (
            "XY analysis views of the retained conservation geometry. The source_assets body and companions retain "
            "the original unmodified source response, native CRS, attributes, holes, multipart structure and any Z/M axes."
        ),
        "whole_units": {"type": "FeatureCollection", "features": original},
        "reporting_units": {"type": "FeatureCollection", "features": reporting},
        "reporting_union": {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature", "id": plan["id"], "geometry": view(saved_union),
                "properties": {
                    **union_properties, "geometry_role": "Saved selected reporting-area union",
                    "area_ha": plan["summary"]["union_area_ha"],
                },
            }],
        },
        "whole_unit_union": {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature", "id": plan["id"], "geometry": view(whole_union),
                "properties": {
                    **union_properties, "geometry_role": "Union of selected whole source units",
                    "area_ha": plan["summary"]["whole_unit_union_area_ha"],
                },
            }],
        },
        "original_metric_footprint": _copy(plan["files"]["footprint"]),
        "original_metric_inventory": _copy(study["files"]["geometries"]),
    }


def _reference(workspace, plan, study):
    return {
        "schema": REFERENCE_SCHEMA,
        "kind": "conservation_plan",
        "workspace_id": workspace.project["id"],
        "plan_id": plan["id"], "study_id": study["id"],
        "selected_ids": list(plan["selected_ids"]),
        "candidate_table_sha256": study["files"]["candidates"]["sha256"],
        "geometry_inventory_sha256": study["files"]["geometries"]["sha256"],
        "footprint": _copy(plan["files"]["footprint"]),
    }


def bind_plan(workspace, plan_id, *, include_geometry=True):
    """Read a completed saved plan into the shared implementation/design contract.

    No conservation or implementation state is created or changed. Consumers
    retain source_reference in their own assignments, site plans and revisions.
    """
    if not isinstance(include_geometry, bool):
        raise ValueError("include_geometry must be true or false")
    plan, study, candidates = _selection(workspace, plan_id)
    reference = _reference(workspace, plan, study)
    native = _native_bindings(workspace, study)
    study_record = {key: value for key, value in study.items() if key != "candidates"}
    payload = {
        "schema": SCHEMA,
        "source_reference": reference,
        "plan": _copy(plan),
        "study": _copy(study_record),
        "selected_units": _candidate_views(candidates, reference),
        "source_assets": _source_assets(workspace, study),
        "native_runs": native,
        "geometry": _geometry_views(workspace, plan, study, candidates) if include_geometry else None,
        "artifacts": {
            "plan": describe_file(
                workspace.root, workspace.root / "conservation-plans" / plan["id"] / "plan.json"),
            "study": describe_file(
                workspace.root, workspace.root / "conservation" / study["id"] / "study.json"),
            "candidate_inventory": _copy(study["files"]["candidates"]),
            "geometry_inventory": _copy(study["files"]["geometries"]),
            "selected_reporting_union": _copy(plan["files"]["footprint"]),
        },
        "file_reference_root": "workspace",
        "scientific_contract": {
            "mode": study["mode"],
            "metric_state": study["metric_state"],
            "invest_version": SUPPORTED_INVEST_VERSION if native else None,
            "unit_contract_version": SUPPORTED_INVEST_VERSION if native else None,
            "execution_policy": next(iter(native.values()))["execution"]["policy"] if native else None,
            "execution_version_basis": "Each selected model retains completed-stage provenance; observed-run and requested-legacy fallbacks remain explicitly labeled",
            "annual_units": _copy(ANNUAL_UNITS),
            "native_grid": _copy(study["selection"]["bindings"]["grid"]) if native else None,
            "native_rate_units": {
                "nitrogen_export": "kg/ha/year",
                "phosphorus_export": "kg/ha/year",
                "sediment_export": "metric_tonnes/ha/year",
            } if native else None,
            "quantity_basis": "Saved selected-footprint contributions within the complete modeled cases",
            "model_selection": {
                "source": "Each original run.selection.models; omission preserves historical combined NDR and SDR",
                "unselected_output": "not_selected with null annual quantity and null native-support areas",
                "alternative_quantity": "Uses that alternative's selected output and its own coverage",
                "paired_difference": "Requires the pollutant in both cases, then uses common valid native cells",
                "availability_fields": [
                    "availability", "availability_reason",
                    "comparison_availability", "comparison_availability_reason",
                ],
            },
            "comparison": {
                "delta": "Alternative minus baseline on common valid original native cells",
                "reduction": "Baseline minus alternative on common valid original native cells",
                "delta_support": "common_coverage_fraction",
                "alternative_support": "coverage_fraction",
                "profile_difference": "profile_changed",
            },
            "method": _copy(study["method"]),
            "monitoring_link": (
                "Attach observed site/sample/activity/result records using their own original measurement "
                "identities, dates, units, qualifiers and source methods. The plan supplies spatial and model "
                "context; an observed-load comparison uses the original observation catchment and annualization method."
            ),
        },
        "consumer_contract": {
            "authoritative_selection": "plan.id in the existing conservation-plans directory",
            "task_attachment": "source_reference plus selected_units[].unit_ref",
            "planning_amount": (
                "implementation_basis.supplied_whole_unit_cost remains its original source planning amount; "
                "consumer budget, commitment and actual-cost ledgers retain their own separately entered records"
            ),
            "monitoring_site_relation": (
                "Record the chosen original planning-unit/catchment relation on each real or proposed site; "
                "the selected footprint alone does not define an observed site's upstream drainage catchment"
            ),
            "editable_geometry": (
                "Display geometry is standard EPSG:4326 GeoJSON derived from the saved metric analysis geometry. "
                "Keep original source_assets and source_reference with each independent edited successor revision."
            ),
            "scenario_callable": "model.conservation_scenarios.create_scenario(workspace, spec)",
            "scenario_selection": {
                "plan_id": plan["id"], "requires": ["title", "reason", "from_codes", "to_code"],
                "optional": {
                    "prepare_run": ["grid_id", "profile_id", "models"],
                    "prepare_experiment": [
                        "title", "reason", "baseline_run_id", "prepare_run",
                        "profile_ids", "scenario_ids", "design", "axes"],
                },
                "models": {
                    "values": ["ndr", "sdr"],
                    "omitted": "Use the native models shared by the selected grid and parameter profile",
                    "full_mode": "Omit models in retained selections to preserve existing full-model IDs",
                },
            },
            "experiment_callable": "model.conservation_scenarios.prepare_experiment(workspace, spec)",
            "experiment_action": "conservation.experiment.prepare",
            "experiment_selection": {
                "requires": ["conservation_scenario_id"],
                "optional": [
                    "title", "reason", "baseline_run_id", "prepare_run",
                    "profile_ids", "scenario_ids", "design", "axes"],
                "native_selection": "Retain the same grid, profile and selected model families in the paired baseline and portfolio case",
                "footprint": "Use the saved selected_union source unchanged; require complete model-domain coverage and report reporting-area overlap separately",
                "baseline": "Reuse a compatible original-landcover reference or prepare it from the retained grid edition",
                "continuation": "Use returned experiment_id in the existing experiment.run queue action",
            },
        },
    }
    binding = {**payload, "id": digest(payload)}
    validate_binding(binding)
    return binding


def validate_binding(value):
    """Validate the portable view and its original plan/study selection identities."""
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise ValueError("Use a complete upstate.conservation-binding/v1 view")
    identifier(value.get("id"))
    if digest({key: item for key, item in value.items() if key != "id"}) != value["id"]:
        raise ValueError("The portable conservation binding content changed")
    reference, plan, study = value["source_reference"], value["plan"], value["study"]
    if reference.get("schema") != REFERENCE_SCHEMA or reference.get("kind") != "conservation_plan":
        raise ValueError("The consumer must retain the original conservation-plan reference")
    if not isinstance(reference.get("workspace_id"), str) or not reference["workspace_id"]:
        raise ValueError("The original Workspace identity is required")
    for row, key in ((plan, "plan_id"), (study, "study_id")):
        identifier(row.get("id"))
        if row["id"] != reference[key] or digest(row["selection"]) != row["id"]:
            raise ValueError("The original saved " + key + " differs from this consumer view")
        if row.get("state") != "complete":
            raise ValueError("The referenced conservation selection must be complete")
    if plan["study_id"] != study["id"]:
        raise ValueError("The plan and study identities differ")
    selected = plan["selected_ids"]
    if (not isinstance(selected, list) or not selected
            or not all(isinstance(key, str) for key in selected)
            or len(set(selected)) != len(selected)
            or selected != reference["selected_ids"]):
        raise ValueError("The binding must preserve the complete original selected string IDs")
    if reference["candidate_table_sha256"] != study["files"]["candidates"]["sha256"]:
        raise ValueError("The candidate inventory identity differs")
    if reference["geometry_inventory_sha256"] != study["files"]["geometries"]["sha256"]:
        raise ValueError("The geometry inventory identity differs")
    if reference["footprint"] != plan["files"]["footprint"]:
        raise ValueError("The selected-union source identity differs")
    units = value["selected_units"]
    if not isinstance(units, list) or [row["candidate"]["id"] for row in units] != selected:
        raise ValueError("The portable view must carry each selected native unit once, in saved order")
    expected_runs = study["selection"]["bindings"]["runs"]
    expected_outputs = {run_id: set(conservation._selected_outputs(run["selection"]))
                        for run_id, run in expected_runs.items()}
    baseline_id = study["selection"]["spec"]["baseline_run_id"]
    for unit in units:
        candidate = unit["candidate"]
        if unit["unit_ref"] != _unit_reference(candidate):
            raise ValueError("The original source-edition unit reference differs")
        if (unit["plan_ref"]["workspace_id"] != reference["workspace_id"]
                or unit["plan_ref"]["plan_id"] != plan["id"]
                or unit["plan_ref"]["study_id"] != study["id"]):
            raise ValueError("The unit attachment references a different saved plan")
        for pollutant, expected_unit in ANNUAL_UNITS.items():
            metric = candidate["pollutants"][pollutant]
            if metric["unit"] != expected_unit:
                raise ValueError("Preserve separate annual nitrogen, phosphorus and sediment units")
            if study["mode"] == "source_context":
                if metric["baseline"] is not None or metric["alternatives"]:
                    raise ValueError("A source-context consumer must preserve unbound physical quantities")
            else:
                expected_alternatives = set(study["selection"]["spec"]["alternative_run_ids"])
                if set(metric["alternatives"]) != expected_alternatives:
                    raise ValueError("Preserve the complete selected alternative-run quantities")
                baseline_selected = pollutant in expected_outputs[baseline_id]
                baseline_availability = metric.get("availability", "modeled")
                if baseline_availability != ("modeled" if baseline_selected else "not_selected"):
                    raise ValueError("The baseline availability differs from its selected native models")
                if not baseline_selected:
                    for key in ("baseline", "coverage_fraction", "valid_area_ha", "structural_stream_area_ha", "missing_area_ha"):
                        if metric.get(key) is not None:
                            raise ValueError("An omitted native baseline output must retain null quantity and coverage")
                    if not metric.get("availability_reason"):
                        raise ValueError("State which native baseline model was not selected")
                for alternative_id, alternative in metric["alternatives"].items():
                    for key in ("delta", "reduction", "common_coverage_fraction", "coverage_fraction", "profile_changed"):
                        if key not in alternative:
                            raise ValueError("Preserve common support and parameter lineage on every scenario difference")
                    alternative_selected = pollutant in expected_outputs[alternative_id]
                    if alternative.get("availability", "modeled") != ("modeled" if alternative_selected else "not_selected"):
                        raise ValueError("The alternative availability differs from its selected native models")
                    if not alternative_selected:
                        for key in ("value", "coverage_fraction", "valid_area_ha", "structural_stream_area_ha", "missing_area_ha"):
                            if alternative.get(key) is not None:
                                raise ValueError("An omitted native alternative output must retain null quantity and coverage")
                        if not alternative.get("availability_reason"):
                            raise ValueError("State which native alternative model was not selected")
                    shared = baseline_selected and alternative_selected
                    if alternative.get("comparison_availability", "modeled") != ("modeled" if shared else "not_shared"):
                        raise ValueError("The paired comparison availability differs from the original case selections")
                    if not shared:
                        for key in ("delta", "reduction", "common_baseline", "common_alternative",
                                    "common_coverage_fraction", "common_valid_area_ha", "common_structural_stream_area_ha"):
                            if alternative.get(key) is not None:
                                raise ValueError("A pollutant omitted from either selected case has no paired quantity or coverage")
                        if not alternative.get("comparison_availability_reason"):
                            raise ValueError("Explain the native model selection preventing a paired difference")
    if set(value["native_runs"]) != set(expected_runs):
        raise ValueError("The native case selection differs from the saved study")
    for key, run in value["native_runs"].items():
        if run["selection"] != expected_runs[key]["selection"]:
            raise ValueError("The consumer requires the exact original native run selection")
        execution = run.get("execution")
        if execution is not None:
            _validate_execution_snapshot(execution, conservation._selected_models(run["selection"]))
            requested = run["selection"].get("invest_version")
            requested = requested.strip() if isinstance(requested, str) and requested.strip() else None
            if (execution.get("run_version", {}).get("requested") != requested
                    or any(row.get("requested_version") != requested
                           for row in execution["model_versions"].values())):
                raise ValueError("Keep the requested version distinct and equal to the original run selection")
            retained_execution = expected_runs[key].get("execution")
            if retained_execution is not None and retained_execution != execution:
                raise ValueError("The consumer execution provenance differs from the saved study")
            for pollutant, output in run["outputs"].items():
                model = conservation.POLLUTANTS[pollutant][0]
                if output.get("execution") != execution["model_versions"][model]:
                    raise ValueError("Keep each original output linked to its completed model execution")
        elif expected_runs[key].get("execution") is not None:
            raise ValueError("Preserve the saved study's completed model execution provenance")
        elif run["selection"].get("invest_version") != SUPPORTED_INVEST_VERSION:
            raise ValueError("A legacy binding without stage provenance requires its original 3.20.0 requested unit contract")
        if (set(run["outputs"]) != expected_outputs[key]
                or set(expected_runs[key]["outputs"]) != expected_outputs[key]):
            raise ValueError("The selected native output inventory differs from the original completed run")
        if "selected_models" in run and run["selected_models"] != conservation._selected_models(run["selection"]):
            raise ValueError("The reported selected models differ from the original native case")
        if "output_availability" in run:
            availability = run["output_availability"]
            if set(availability) != set(ANNUAL_UNITS):
                raise ValueError("Preserve each pollutant's native model availability")
            for pollutant, row in availability.items():
                if row["availability"] != ("modeled" if pollutant in expected_outputs[key] else "not_selected"):
                    raise ValueError("The reported output availability differs from the native model selection")
    geometry = value.get("geometry")
    if geometry is not None:
        if geometry["representation_crs"] != GEOMETRY_CRS or geometry["coordinate_order"] != "longitude, latitude":
            raise ValueError("The browser geometry must use standard longitude/latitude GeoJSON")
        keys = [row["unit_ref"]["unit_key"] for row in units]
        for name in ("whole_units", "reporting_units"):
            collection = geometry[name]
            if collection.get("type") != "FeatureCollection" or [row["id"] for row in collection["features"]] != keys:
                raise ValueError("The geometry view differs from its complete selected-unit inventory")
        for name in ("reporting_union", "whole_unit_union"):
            collection = geometry[name]
            if (collection.get("type") != "FeatureCollection" or len(collection["features"]) != 1
                    or collection["features"][0]["id"] != plan["id"]):
                raise ValueError("The geometry view must preserve the selected portfolio union identity")
    return value


def resolve_reference(workspace, reference, *, include_geometry=True):
    """Reopen the same source selection for a saved field or design record."""
    if not isinstance(reference, dict) or reference.get("schema") != REFERENCE_SCHEMA:
        raise ValueError("Read the original conservation-plan source reference")
    if reference.get("workspace_id") != workspace.project["id"]:
        raise ValueError("Open the original Workspace or its complete portable restoration")
    bound = bind_plan(workspace, reference.get("plan_id"), include_geometry=include_geometry)
    if bound["source_reference"] != reference:
        raise ValueError("The consumer reference differs from the original saved selection")
    return bound


def write_binding(workspace, plan_id, destination, *, include_geometry=True, replace=False):
    """Write a consumer artifact; preserve the existing plan and study stores."""
    if not isinstance(replace, bool):
        raise ValueError("replace must be true or false")
    binding = bind_plan(workspace, plan_id, include_geometry=include_geometry)
    destination = Path(destination).expanduser().resolve()
    atomic_json(destination, binding, immutable=not replace)
    return {
        "schema": "upstate.conservation-binding-export/v1",
        "binding_id": binding["id"],
        "source_reference": binding["source_reference"],
        "file": describe_file(destination.parent, destination),
        "absolute_path": str(destination),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    exported = commands.add_parser("export", help="Write the actual saved plan for implementation or design")
    exported.add_argument("--workspace", required=True, type=Path)
    exported.add_argument("--plan-id", required=True)
    exported.add_argument("--output", required=True, type=Path)
    exported.add_argument("--without-geometry", action="store_true")
    exported.add_argument("--replace", action="store_true")
    checked = commands.add_parser("verify", help="Open and validate a complete retained consumer view")
    checked.add_argument("binding", type=Path)
    checked.add_argument("--workspace", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "export":
            from .workspace import Workspace
            result = write_binding(
                Workspace(args.workspace), args.plan_id, args.output,
                include_geometry=not args.without_geometry, replace=args.replace,
            )
        else:
            binding = validate_binding(read_json(args.binding))
            if args.workspace:
                from .workspace import Workspace
                resolved = resolve_reference(
                    Workspace(args.workspace), binding["source_reference"],
                    include_geometry=binding["geometry"] is not None,
                )
                if resolved["id"] != binding["id"]:
                    raise ValueError("The original Workspace view differs from this exported binding")
            result = {
                "schema": "upstate.conservation-binding-read/v1",
                "binding_id": binding["id"], "source_reference": binding["source_reference"],
                "selected_unit_count": len(binding["selected_units"]),
                "mode": binding["study"]["mode"],
                "native_run_ids": list(binding["native_runs"]),
                "geometry_available": binding["geometry"] is not None,
            }
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False))
        return 0
    except (ValueError, KeyError, TypeError, OSError, RuntimeError, ImportError) as error:
        print(json.dumps({"state": "error", "type": type(error).__name__, "message": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
