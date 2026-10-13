"""Attach one original fixed-scale scenario analysis to its native GIS release.

This module reads retained outputs. It never recalculates model quantities or
sums overlapping source zones. Receiving-water family unions stay in their
original native analysis and delivery adapter.
"""
from __future__ import annotations

import csv
import io
import json
import math
from pathlib import Path

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     identifier, read_json, verify_file)
from .model_selection import require_complete_delivery
from .reuse import copy_verified
from .native_versions import model_versions, models_for_outputs

SCHEMA = "upstate.scenario-analysis-delivery/v1"
ANALYSIS_SCHEMA = "upstate.scenario-analysis/v1"
POLLUTANTS = ("nitrogen_export", "phosphorus_export", "sediment_export")
NAMES = {"nitrogen_export": "Nitrogen", "phosphorus_export": "Phosphorus",
         "sediment_export": "Sediment"}
SOURCE_KEYS = ("source_collection_id", "source_id", "layer", "where")


def _copy(value):
    return json.loads(canonical(value))


def _version(run):
    def text(value):
        return value.strip() if isinstance(value, str) and value.strip() else None
    requested = text(run.get("selection", {}).get("invest_version"))
    observed = text((run.get("runtime") or {}).get("version"))
    return {"requested": requested, "observed": observed,
            "comparison_version": observed or requested,
            "basis": "observed_runtime" if observed else "requested_legacy" if requested else "unavailable",
            "differs_from_requested": bool(observed and requested and observed != requested)}


def _load(workspace, key, *, verify=False):
    key = identifier(key)
    directory = workspace.root / "analyses" / key
    record = read_json(directory / "analysis.json")
    if (record.get("schema") != ANALYSIS_SCHEMA or record.get("id") != key
            or record.get("state") != "complete"):
        raise ValueError("Choose a completed original scenario analysis")
    if verify:
        for descriptor in record.get("files", {}).values():
            verify_file(directory, descriptor)
    return record, describe_file(directory, directory / "analysis.json")


def _areas(record):
    saved = {row["id"]: row for row in record.get("selection", {}).get("zones", [])}
    result = []
    for region in record.get("regions", []):
        source = region.get("source") or {}
        choice = source.get("selection") or saved.get(region["id"]) or {}
        metadata = {name: choice[name] for name in (
            "source_plan_id", "receptor_ids", "source_relation_method",
            "source_geometry_scope", "source_selection_changed", "original_source_selection")
                    if name in choice}
        metadata.update(choice.get("metadata") or {})
        result.append({
            "id": region["id"], "title": region.get("title") or region["id"],
            "reporting_area": region["id"] == "reporting_area",
            "map_family": region.get("map_family"), "rank_group": region.get("rank_group"),
            "area_ha": region.get("area_ha"), "selected_cells": region.get("selected_cells"),
            "source_features": region.get("source_features"),
            "source": _copy(source), "selection": _copy(choice), "metadata": _copy(metadata),
        })
    return result


def _cohort(workspace, record):
    selected = record.get("selection") or {}
    ids = record.get("run_ids")
    expected = [selected.get("baseline_run_id")] + list(selected.get("scenario_run_ids", []))
    if not isinstance(ids, list) or not ids or ids != expected or len(set(ids)) != len(ids):
        raise ValueError("Retain the original analysis's complete ordered native-run selection")
    ids = [identifier(value) for value in ids]
    if record.get("baseline_run_id") != ids[0]:
        raise ValueError("The saved analysis reference differs from its original selection")
    details = record.get("runs", [])
    if [row.get("id") for row in details] != ids:
        raise ValueError("The saved analysis native-run records differ")
    bindings = {row["run_id"]: row for row in record.get("input_binding", [])}
    issues, cases = [], []
    grid_id = details[0]["selection"]["grid_id"]
    profile_id = details[0]["selection"]["profile_id"]
    def issue(code, message, run_id=None):
        issues.append({"code": code, "message": message, "run_id": run_id})
    if len(ids) < 2:
        issue("future_scenario", "Complete a source-bound land-cover alternative and save an analysis containing it and this reference for the seven-family GIS release.")
    if set(record.get("comparison_pollutants", [])) != set(POLLUTANTS):
        issue("analysis_models", "Retain nitrogen, phosphorus and sediment in this source analysis before attaching it to the seven-family GIS release.")
    selected_models = models_for_outputs(record.get("comparison_pollutants", []))
    reference_versions = None
    for index, detail in enumerate(details):
        key = detail["id"]
        case = {"id": key, "title": detail.get("title") or key,
                "role": "reference" if index == 0 else "alternative",
                "grid_id": detail["selection"]["grid_id"],
                "profile_id": detail["selection"]["profile_id"],
                "scenario_kind": detail.get("scenario_kind"),
                "comparison_kind": detail.get("comparison_kind"),
                "saved_native_version": _copy(detail.get("native_version")),
                "saved_model_versions": _copy(detail.get("model_versions"))}
        cases.append(case)
        try:
            run = workspace.inspect_run(key)
            if run.get("state") != "complete":
                raise ValueError("The original native run is not complete")
            require_complete_delivery(run)
            if digest(run["selection"]) != digest(detail["selection"]):
                issue("run_selection", "Restore the exact native selection retained by this analysis.", key)
            if run["selection"]["grid_id"] != grid_id:
                issue("grid", "Keep every release alternative on the retained reference grid.", key)
            if run["selection"]["profile_id"] != profile_id:
                issue("profile", "This case changes the parameter profile. Retain a common-profile land-cover cohort for the original future-service maps.", key)
            scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
            if index == 0 and scenario["kind"] != "baseline":
                issue("scenario_kind", "Choose an original baseline scenario for the current-export maps.", key)
            elif index and scenario["kind"] != "landcover":
                issue("scenario_kind", "Use an explicit source-bound land-cover alternative for future-service maps.", key)
            current_version = _version(run)
            current_models = model_versions(run, selected_models)
            case["native_version"] = current_version
            case["model_versions"] = current_models
            if index == 0:
                reference_versions = current_models
            for model, provenance in current_models.items():
                reference = (reference_versions or {}).get(model, {})
                version = provenance["comparison_version"]
                if not version or version != reference.get("comparison_version"):
                    issue("native_version", "Restore the " + model.upper() +
                          " execution version shared by the original analysis cohort.", key)
            bound = bindings.get(key)
            if not bound:
                issue("native_binding", "Restore the original analysis's retained native input binding.", key)
            else:
                if digest(bound.get("selection")) != digest(run["selection"]):
                    issue("bound_selection", "The native selection differs from the saved analysis input binding.", key)
                for pollutant, original in bound.get("artifacts", {}).items():
                    artifact = run.get("artifacts", {}).get(pollutant) or {}
                    if any(artifact.get(field) != original.get(field) for field in ("sha256", "bytes", "units")):
                        issue("native_artifact", "Restore the original " + pollutant + " raster edition retained by this analysis.", key)
                saved_models = bound.get("model_versions") or detail.get("model_versions")
                if saved_models is not None:
                    if not isinstance(saved_models, dict):
                        raise ValueError("The saved model execution binding must be an object")
                    # The completed model source governs the comparison. A later
                    # unrelated stage may legitimately replace the run runtime.
                    fields = ("comparison_version", "basis", "observed_stage_version",
                              "requested_version", "stage_completed_at", "reused_from")
                    for model in selected_models:
                        original = saved_models.get(model)
                        current = current_models[model]
                        if not isinstance(original, dict) or any(
                                digest(original.get(field)) != digest(current.get(field))
                                for field in fields):
                            issue("bound_version", "Restore the original " + model.upper() +
                                  " execution provenance retained by this analysis.", key)
                elif bound.get("native_version") is not None:
                    original = bound["native_version"]
                    if (digest(original) != digest(current_version)
                            or any(value["comparison_version"] != original.get("comparison_version")
                                   for value in current_models.values())):
                        issue("bound_version", "The native execution provenance differs from the saved analysis input binding; keep the original analysis and restore its exact run edition.", key)
        except (ValueError, OSError, KeyError, TypeError) as error:
            issue("native_run", "Reopen or restore " + case["title"] + ": " + str(error), key)
    return ids, grid_id, profile_id, cases, issues


def _prepared_plans(workspace, areas):
    from . import receiving_waters
    choices, issues = [], []
    groups = {}
    for area in areas:
        key = area["metadata"].get("source_plan_id")
        if key and not area["reporting_area"]:
            groups.setdefault(key, []).append(area)
    for key, linked in sorted(groups.items()):
        try:
            plan = receiving_waters.inspect_plan(workspace, key)
            if plan.get("state") != "complete":
                raise ValueError("Complete the original source plan")
            originals = {row["id"]: row for row in plan["identity"]["selection"]["receptors"]}
            matched = set()
            for area in linked:
                metadata, selected = area["metadata"], area["selection"]
                if metadata.get("source_selection_changed") or selected.get("buffer_m", 0):
                    raise ValueError("An analysis zone changed its preparation binding or added a buffer")
                receptors = metadata.get("receptor_ids")
                if not isinstance(receptors, list) or not receptors:
                    raise ValueError("Keep the original receptor IDs with each prepared source area")
                for receptor_id in receptors:
                    original = originals.get(receptor_id)
                    if not original or original.get("relation", {}).get("method") != "source_area":
                        raise ValueError("This zone is not one of the prepared published source-area polygons")
                    source = original["source"]
                    if digest({name: selected.get(name) for name in SOURCE_KEYS}) != digest({name: source.get(name) for name in SOURCE_KEYS}):
                        raise ValueError("A selected source edition, layer or typed filter differs from the original prepared receptor")
                    if area.get("map_family") != original.get("family"):
                        raise ValueError("The selected source-area map family differs from the prepared plan")
                    matched.add(receptor_id)
            choices.append({
                "id": key, "title": plan.get("title") or key,
                "record_sha256": plan["record_sha256"],
                "matched_receptor_ids": sorted(matched),
                "additional_receptor_ids": sorted(set(originals) - matched),
                "receptor_count": len(originals),
                "scope": "The full prepared plan is analyzed on this delivery's retained reporting grid. Its family unions count overlapping land once.",
                "selection": {"plan_id": key, "quantity_scope": "reporting"},
            })
        except (ValueError, OSError, KeyError, TypeError) as error:
            issues.append({"plan_id": key, "message": str(error)})
    return choices, issues


def _binding(workspace, record, artifact, ids, grid_id, profile_id):
    areas = _areas(record)
    return {
        "schema": SCHEMA, "analysis_id": record["id"],
        "analysis_sha256": artifact["sha256"], "analysis_bytes": artifact["bytes"],
        "analysis_title": record.get("title") or record["id"],
        "analysis_created_at": record.get("created_at"),
        "project_id": workspace.project["id"], "baseline_run_id": ids[0],
        "scenario_run_ids": ids[1:], "grid_id": grid_id, "profile_id": profile_id,
        "pollutants": record.get("comparison_pollutants", []),
        "normalization": _copy(record.get("normalization")),
        "coverage": _copy(record.get("coverage")),
        "native_version": _copy(record.get("native_version")),
        "input_binding": _copy(record.get("input_binding", [])),
        "areas": areas,
        "source_area_origins": _copy(record.get("selection", {}).get("source_area_origins", [])),
        "source_plan_ids": sorted({area["metadata"]["source_plan_id"] for area in areas
                                   if area["metadata"].get("source_plan_id")}),
        "source_files": _copy(record.get("files", {})),
        "interpretation": {
            "areas": "Each original source polygon is intersected with the retained reporting area. Source zones may overlap; their totals remain independent.",
            "support": "The attached analysis retains its own common-cohort physical and planning support. The original delivery maps retain their stated support.",
            "planning": "Attached fixed-cap planning scores are dimensionless; annual nitrogen and phosphorus masses are kg/year and sediment is metric tonnes/year.",
        },
    }


def _releases(workspace, binding):
    rows, issues = [], []
    for path in sorted((workspace.root / "deliveries").glob("*/delivery-state.json")):
        try:
            state = read_json(path)
            selection = state.get("selection") or {}
            if selection.get("source_scenario_analysis_id") != binding["analysis_id"]:
                continue
            if (state.get("schema") != "upstate.delivery/v1" or state.get("id") != path.parent.name
                    or selection.get("source_scenario_analysis_sha256") != binding["analysis_sha256"]):
                raise ValueError("The release does not retain this exact analysis edition")
            rows.append({"id": state["id"], "title": selection.get("title") or state["id"],
                         "state": state.get("state"), "created_at": state.get("created_at"),
                         "completed_at": state.get("completed_at")})
        except (ValueError, OSError, KeyError, TypeError) as error:
            issues.append({"release_id": path.parent.name, "message": str(error)})
    rows.sort(key=lambda row: (row.get("created_at") or "", row["id"]), reverse=True)
    return rows, issues


def describe(workspace, analysis_id):
    """Describe a real continuation, including exact choices still made in the original form."""
    record, artifact = _load(workspace, analysis_id)
    ids, grid_id, profile_id, cases, issues = _cohort(workspace, record)
    binding = _binding(workspace, record, artifact, ids, grid_id, profile_id)
    weights = next((row["weights"] for row in record.get("normalization", {}).get("weight_sets", [])
                    if row.get("id") == "selected"), record["selection"].get("weights"))
    selection = {"source_scenario_analysis_id": record["id"],
                 "source_scenario_analysis_sha256": artifact["sha256"],
                 "baseline_run_id": ids[0], "scenario_run_ids": ids[1:],
                 "title": record.get("title") or "Scenario analysis GIS delivery",
                 "map_settings": {"caps": _copy(record.get("normalization", {}).get("caps") or {}),
                                  "weights": _copy(weights)}}
    plans, plan_issues = _prepared_plans(workspace, binding["areas"])
    releases, release_issues = _releases(workspace, binding)
    return {"schema": SCHEMA, "source_analysis": binding, "selection": selection,
            "ready": not issues, "cases": cases, "issues": issues,
            "prepared_plans": plans, "prepared_plan_issues": plan_issues,
            "releases": releases, "release_issues": release_issues,
            "remaining_choices": ["Original source-water and high-quality-water overlays",
                                  "Responsible GIS metadata contact",
                                  "Optional original prepared receiving-water plan and native union analysis",
                                  "Original map layout and priority choices"]}


def bind_analysis(workspace, selection):
    """Validate the exact saved analysis before its hash contributes to release identity."""
    key = selection.get("source_scenario_analysis_id")
    if key is None:
        if selection.get("source_scenario_analysis_sha256") is not None:
            raise ValueError("Choose the saved scenario analysis for this attachment edition")
        return None
    record, artifact = _load(workspace, key, verify=True)
    ids, grid_id, profile_id, _cases, issues = _cohort(workspace, record)
    expected = selection.get("source_scenario_analysis_sha256")
    if expected is not None and expected != artifact["sha256"]:
        raise ValueError("The selected scenario analysis edition changed; reopen its original delivery continuation")
    if selection.get("baseline_run_id") != ids[0] or selection.get("scenario_run_ids") != ids[1:]:
        raise ValueError("Keep the attached scenario analysis's exact reference and ordered alternatives")
    if issues:
        raise ValueError(" ".join(row["message"] for row in issues))
    return _binding(workspace, record, artifact, ids, grid_id, profile_id)


def _source_csv(areas):
    text = io.StringIO(newline="")
    columns = ["area_id", "title", "reporting_area", "map_family", "rank_group",
               "area_ha", "selected_cells", "source_features",
               "source_collection_id", "source_id", "layer", "where",
               "source_plan_id", "receptor_ids", "metadata", "source"]
    writer = csv.DictWriter(text, fieldnames=columns)
    writer.writeheader()
    for area in areas:
        row = {"area_id": area["id"], **{name: area.get(name) for name in columns if name in area},
               **{name: area["selection"].get(name) for name in SOURCE_KEYS},
               "source_plan_id": area["metadata"].get("source_plan_id"),
               "receptor_ids": area["metadata"].get("receptor_ids")}
        output = {}
        for name in columns:
            value = row.get(name)
            if isinstance(value, (dict, list)):
                value = canonical(value).decode("utf-8")
            if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
                value = "'" + value
            output[name] = value
        writer.writerow(output)
    return text.getvalue().encode("utf-8")


def retain_analysis(workspace, directory, state, binding):
    """Copy every exact analysis asset into original project inputs; support safe resume."""
    if binding is None:
        return None
    record, artifact = _load(workspace, binding["analysis_id"], verify=True)
    if artifact["sha256"] != binding["analysis_sha256"]:
        raise ValueError("The original scenario analysis changed before release packaging")
    source = workspace.root / "analyses" / record["id"]
    prefix = "scenario-analysis/" + record["id"] + "/"
    files = state.setdefault("files", {})
    def retain(name, descriptor, relative):
        copied = copy_verified(source, descriptor, directory, path=prefix + relative)
        key = "scenario_analysis_" + name
        if key in files and files[key]["sha256"] != copied["sha256"]:
            raise ValueError("The retained scenario-analysis release member differs: " + name)
        files[key] = {**copied, "analysis_id": record["id"]}
    retain("record", artifact, "analysis.json")
    for name, descriptor in record["files"].items():
        retain(name, descriptor, descriptor["path"])
    target = Path(directory) / prefix
    inventory = target / "source-area-inventory.csv"
    atomic_bytes(inventory, _source_csv(binding["areas"]), immutable=True)
    files["scenario_analysis_source_inventory"] = describe_file(directory, inventory)
    selected = _copy(record["selection"])
    envelope = {
        "schema": "upstate.scenario-source-areas/v1",
        "selection": {"title": record.get("title"), "zones": selected.get("zones", []),
                      "source_area_origins": selected.get("source_area_origins", [])},
        "origin": {"source_analysis_id": record["id"], "source_analysis_sha256": artifact["sha256"],
                   "source_plan_ids": binding["source_plan_ids"], "source_grid_id": binding["grid_id"],
                   "source_baseline_run_id": binding["baseline_run_id"],
                   "source_run_ids": record["run_ids"],
                   "scope": binding["interpretation"]["areas"]},
    }
    path = target / "source-areas.json"
    atomic_json(path, envelope, immutable=True)
    files["scenario_analysis_source_areas"] = describe_file(directory, path)
    link = target / "delivery-binding.json"
    atomic_json(link, binding, immutable=True)
    files["scenario_analysis_binding"] = describe_file(directory, link)
    state["source_scenario_analysis"] = binding
    return {"binding": binding, "record": record}


def _number(value, *, signed=False):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        return "Unavailable"
    return format(value, "+,.6g" if signed and value != 0 else ",.6g")


def _table(columns, rows, caption=None):
    return {"kind": "table", "columns": columns,
            "rows": [[str(value) for value in row] for row in rows],
            "widths": None, "caption": caption}


def _version_rows(record):
    rows = []
    for run in record["runs"]:
        title = run.get("title") or run["id"]
        role = "Reference" if run["id"] == record["baseline_run_id"] else "Alternative"
        versions = run.get("model_versions")
        if versions:
            for model, version in versions.items():
                rows.append([title, role, model.upper(),
                             version.get("comparison_version") or "Not retained",
                             version.get("requested_version") or "Not retained",
                             version.get("basis") or "Not retained"])
        else:
            version = run.get("native_version") or {}
            rows.append([title, role, "Legacy run record",
                         version.get("observed") or version.get("requested") or "Not retained",
                         version.get("requested") or run.get("selection", {}).get("invest_version") or "Not retained",
                         version.get("basis") or "Legacy selection provenance"])
    return rows


def report_sections(product):
    """Readable append-only blocks; all numbers come directly from the attached record."""
    if product is None:
        return []
    binding, record = product["binding"], product["record"]
    runs = {row["id"]: row.get("title") or row["id"] for row in record["runs"]}
    areas = {row["id"]: row for row in binding["areas"]}
    blocks = [
        "Original analysis: " + binding["analysis_title"] + ".",
        "Analysis ID: " + binding["analysis_id"] + "; original record SHA-256: " + binding["analysis_sha256"] + ".",
        binding["interpretation"]["areas"], binding["interpretation"]["support"],
        "Positive physical change means increased modeled annual export. Zero-baseline percentages and quantities with no common cells remain unavailable.",
        _table(["Run", "Role", "Model", "Retained InVEST", "Requested InVEST", "Version basis"],
               _version_rows(record)),
    ]
    sections = [("Attached fixed-scale scenario analysis", blocks)]
    physical_by_area, priority_by_area, sensitivity_by_area = {}, {}, {}
    for row in record.get("physical", []):
        physical_by_area.setdefault(row["region_id"], []).append(row)
    for row in record.get("priority", []):
        if row["weight_set_id"] == "selected":
            priority_by_area.setdefault(row["region_id"], []).append(row)
    for row in record.get("sensitivity", []):
        sensitivity_by_area.setdefault(row["region_id"], {})[row["run_id"]] = row
    for area in binding["areas"]:
        physical = physical_by_area.get(area["id"], [])
        table_rows = []
        for row in physical:
            available = isinstance(row.get("common_valid_cells"), (int, float)) and row["common_valid_cells"] > 0
            table_rows.append([
                runs.get(row["run_id"], row["run_id"]), NAMES.get(row["pollutant"], row["pollutant"]),
                str(row.get("units", "")).replace("metric_tonnes", "metric tonnes"),
                _number(row.get("baseline_common_sum")) if available else "Unavailable",
                _number(row.get("common_sum")) if available else "Unavailable",
                _number(row.get("change"), signed=True) if available else "Unavailable",
                _number(row.get("common_valid_cells")), _number(row.get("common_area_ha")),
            ])
        metadata, choice = area["metadata"], area["selection"]
        source_notes = [
            ("Baseline reporting area. " if area["reporting_area"] else "Independent source planning area. ") +
            "Geometry intersection: " + _number(area.get("area_ha")) + " ha; selected grid cells: " + _number(area.get("selected_cells")) + ".",
            "Map family: " + str(area.get("map_family") or "General planning") +
            "; rank group: " + str(area.get("rank_group") or "Unranked") + ".",
            "Original source collection: " + str(choice.get("source_collection_id") or "Not retained") +
            "; source: " + str(choice.get("source_id") or "Not retained") + ".",
        ]
        if choice.get("where"):
            source_notes.append("Original typed feature filter: " + canonical(choice["where"]).decode("utf-8") + ".")
        if metadata.get("source_plan_id"):
            source_notes.append("Prepared plan: " + metadata["source_plan_id"] +
                                "; original receptors: " + ", ".join(metadata.get("receptor_ids") or []) + ".")
        if metadata.get("source_selection_changed"):
            source_notes.append("The saved analysis selected a changed preparation binding. The complete original and selected bindings are retained in its source inventory.")
        source_notes.append(_table(
            ["Run", "Pollutant", "Annual unit", "Baseline", "Selected", "Change", "Common cells", "Common ha"],
            table_rows, "Original all-run common support for each pollutant; no cross-area summation."))
        priorities = priority_by_area.get(area["id"], [])
        sensitivity = sensitivity_by_area.get(area["id"], {})
        source_notes.append(_table(
            ["Run", "Mean planning score", "Score change", "Common cells", "Weight-score minimum", "Weight-score maximum"],
            [[runs.get(row["run_id"], row["run_id"]), _number(row.get("mean")),
              _number(row.get("score_change"), signed=True), _number(row.get("common_cells")),
              _number(sensitivity.get(row["run_id"], {}).get("score_min")),
              _number(sensitivity.get(row["run_id"], {}).get("score_max"))] for row in priorities],
            "Dimensionless fixed-cap scores; sensitivity spans the saved explicit weight sets."))
        sections.append(("Saved analysis area: " + area["title"], source_notes))
    normalization = record.get("normalization") or {}
    methods = [binding["interpretation"]["planning"],
               "Reference support: " + str(normalization.get("reference_support") or "Retained in original analysis") + ".",
               "Formula: " + str(normalization.get("method") or "Retained in original analysis") + ".",
               _table(["Pollutant", "Fixed cap", "Cap unit"],
                      [[NAMES.get(name, name), _number(value),
                        str((normalization.get("cap_units") or {}).get(name, "")).replace("metric_tonnes", "metric tonnes")]
                       for name, value in (normalization.get("caps") or {}).items()]),
               _table(["Weight set", "Nitrogen", "Phosphorus", "Sediment"],
                      [[row.get("title") or row["id"]] +
                       [_number(row.get("weights", {}).get(name)) for name in POLLUTANTS]
                       for row in normalization.get("weight_sets", [])]),
               "The attachment retains every original physical, pairwise, planning and sensitivity CSV, its analysis JSON, GeoPackage geography and raster outputs. Original source definitions and typed filters are supplied in source-areas.json and source-area-inventory.csv.",
               "A separately selected receiving-water plan contributes its own native family-union analysis. Overlapping individual area totals above are never added to produce that union."]
    sections.append(("Attached analysis methods and original assets", methods))
    return sections


def extend_assets(manifest, state):
    binding = state.get("source_scenario_analysis")
    if binding is None:
        return manifest
    # Keep the manifest small; the full immutable provenance is a declared asset.
    artifact = state.get("files", {}).get("scenario_analysis_binding")
    if artifact is None:
        raise ValueError("Retain the original scenario-analysis binding before packaging")
    manifest["source_scenario_analysis"] = {
        "schema": binding["schema"], "analysis_id": binding["analysis_id"],
        "analysis_sha256": binding["analysis_sha256"], "analysis_bytes": binding["analysis_bytes"],
        "analysis_title": binding["analysis_title"], "grid_id": binding["grid_id"],
        "baseline_run_id": binding["baseline_run_id"],
        "scenario_run_ids": list(binding["scenario_run_ids"]),
        "area_count": len(binding["areas"]), "source_plan_ids": list(binding["source_plan_ids"]),
        "binding_artifact": _copy(artifact),
    }
    assets = manifest.setdefault("project_assets", [])
    existing = set(assets)
    for name, descriptor in state.get("files", {}).items():
        if name.startswith("scenario_analysis_") and descriptor["path"] not in existing:
            assets.append(descriptor["path"])
            existing.add(descriptor["path"])
    return manifest
