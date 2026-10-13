"""Join receiving-water analyses to the existing seven-map delivery."""
from __future__ import annotations
import json
from pathlib import Path
import shutil
from .common import (
    atomic_json, describe_file, file_digest, identifier, read_json, verify_file,
)
from . import rasters, receiving_waters


def selected_analysis(workspace, selection, *, priority_settings=None, progress=None):
    """Resolve one explicit receiving_waters selection to completed quantities.

    selection is the existing delivery request. The nested receiving_waters
    record chooses analysis_id, plan_id, plan or receptor_spec. An explicit
    analysis is reused only with the same selected baseline and alternatives.
    """
    choice = selection.get("receiving_waters")
    if choice is None:
        return None
    if not isinstance(choice, dict):
        raise ValueError("Receiving-water delivery selection must be an object")
    baseline_id = identifier(selection["baseline_run_id"])
    alternatives = list(selection.get("scenario_run_ids", selection.get("alternative_run_ids", [])))
    baseline = workspace.inspect_run(baseline_id)
    keys = [name for name in ("analysis_id", "plan_id", "plan", "receptor_spec") if choice.get(name) is not None]
    if len(keys) != 1:
        raise ValueError("Select exactly one receiving-water analysis, plan or source profile")
    if keys[0] == "analysis_id":
        result = receiving_waters.inspect(workspace, choice["analysis_id"])
        if result.get("state") != "complete":
            raise ValueError("Complete the selected receiving-water analysis")
        if result["baseline_run_id"] != baseline_id or set(result["alternative_run_ids"]) != set(alternatives):
            raise ValueError("Receiving-water analysis must match the delivery baseline and alternatives")
        if choice.get("quantity_scope") and result["quantity_scope"] != choice["quantity_scope"]:
            raise ValueError("Selected receiving-water quantity scope differs from the retained analysis")
        return result
    if keys[0] == "plan_id":
        plan_id = identifier(choice["plan_id"])
    elif keys[0] == "plan":
        plan_id = receiving_waters.prepare(workspace, choice["plan"])["id"]
    else:
        plan_id = receiving_waters.prepare_receptor_spec(
            workspace, choice["receptor_spec"], grid_id=baseline["selection"]["grid_id"],
        )["id"]
    request = {
        "plan_id": plan_id, "baseline_run_id": baseline_id,
        "alternative_run_ids": alternatives,
        "quantity_scope": choice.get("quantity_scope", "reporting"),
    }
    for name in ("title", "weights", "normalization", "pollutants", "accounting"):
        if name in choice:
            request[name] = choice[name]
    if priority_settings and "normalization" not in request:
        quantities = request.get("pollutants") or [key for key in rasters.MASS_UNITS if key in baseline["artifacts"]]
        request["normalization"] = {
            "method": "explicit", "caps": {key: priority_settings["caps"][key] for key in quantities},
            "reference": {
                "kind": "selected baseline delivery priority",
                "baseline_run_id": baseline_id,
                "method": priority_settings["method"],
                "percentile": priority_settings.get("percentile"),
            },
        }
        request.setdefault("weights", {key: priority_settings["weights"][key] for key in quantities})
    return receiving_waters.analyze(workspace, request, progress=progress)


def _copy_member(source_root, item, directory, prefix):
    original = verify_file(source_root, item)
    target = directory / prefix / item["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.stat().st_size != item["bytes"] or file_digest(target) != item["sha256"]:
            raise ValueError("A retained receiving-water delivery member changed: " + str(target))
    else:
        shutil.copyfile(original, target)
    result = {**item, **describe_file(directory, target)}
    if result["bytes"] != item["bytes"] or result["sha256"] != item["sha256"]:
        raise ValueError("Receiving-water delivery copy differs from its original")
    return result


def export(workspace, analysis_id, directory):
    """Export complete source plan, analysis and files to a self-contained folder."""
    analysis = receiving_waters.inspect(workspace, analysis_id)
    if analysis["state"] != "complete":
        raise ValueError("Complete the selected receiving-water analysis for export")
    plan = receiving_waters.inspect_plan(workspace, analysis["plan_id"])
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    analysis_root = workspace.root / "receiving-water-analyses" / analysis["id"]
    plan_root = workspace.root / "receiving-water-plans" / plan["id"]
    identity = {
        "analysis_id": analysis["id"], "analysis_record_sha256": analysis["record_sha256"],
        "plan_id": plan["id"], "plan_record_sha256": plan["record_sha256"],
    }
    index_path = directory / "receiving-water-delivery.json"
    if index_path.exists():
        retained = read_json(index_path)
        if retained["identity"] != identity:
            raise ValueError("Choose a separate export directory for another receiving-water selection")
        for item in retained["files"].values():
            verify_file(directory, item)
        return retained
    files = {}
    for name, item in analysis["files"].items():
        files["analysis_" + name] = _copy_member(analysis_root, item, directory, "analysis")
    for name, item in plan["files"].items():
        files["plan_" + name] = _copy_member(plan_root, item, directory, "plan")
    files["analysis_record"] = _copy_member(
        analysis_root, describe_file(analysis_root, analysis_root / "analysis.json"), directory, "analysis",
    )
    files["plan_record"] = _copy_member(
        plan_root, describe_file(plan_root, plan_root / "plan.json"), directory, "plan",
    )
    def exported(item):
        return {**item, "path": "analysis/" + item["path"]} if item else None
    original_layers = receiving_waters.delivery_layers(workspace, analysis["id"])
    families = {}
    for family, row in original_layers["families"].items():
        families[family] = {
            **row,
            "current_priority": exported(row["current_priority"]),
            "contribution_mask": exported(row["contribution_mask"]),
            "alternatives": {
                run_id: {
                    **alternative,
                    **{name: exported(alternative[name]) for name in
                       ("current_priority", "increased_export_priority", "avoided_export_priority")},
                    "physical_changes": {name: exported(item)
                                         for name, item in alternative["physical_changes"].items()},
                }
                for run_id, alternative in row["alternatives"].items()
            },
        }
    result = {
        "schema": "upstate.receiving-water-delivery/v1", "identity": identity,
        "title": analysis["title"], "baseline_run_id": analysis["baseline_run_id"],
        "alternative_run_ids": analysis["alternative_run_ids"],
        "quantity_scope": analysis["quantity_scope"], "pollutants": analysis.get("pollutants", list(rasters.MASS_UNITS)),
        "normalization": analysis["normalization"],
        "families": families, "files": files, "measurement": analysis["measurement"],
        "accounting": analysis.get("accounting"),
        "accounting_subjects": [
            {**row, "metrics": {**row["metrics"], "files": {
                name: exported(item) for name, item in row["metrics"]["files"].items()
            }}}
            for row in analysis["subjects"] if row["kind"] == "accounting"
        ],
        "receptors": [
            {"id": row["id"], "title": row["title"], "family": row["family"],
             "relationship_precision": row["relationship_precision"],
             "source": row["source"], "classification": row["classification"],
             "contribution_area_ha": row["contribution_area_ha"],
             "area_in_quantity_scope_ha": row["area_in_quantity_scope_ha"],
             "metrics": {**row["metrics"], "files": {
                 name: exported(item) for name, item in row["metrics"]["files"].items()
             }}}
            for row in analysis["subjects"] if row["kind"] == "receptor"
        ],
    }
    atomic_json(index_path, result)
    return result


def collect(workspace, selection, directory, *, priority_settings=None, progress=None):
    """Return delivery inventory and actual attributed overlays for selected waters."""
    analysis = selected_analysis(
        workspace, selection, priority_settings=priority_settings, progress=progress,
    )
    if analysis is None:
        return None
    directory = Path(directory)
    inventory = export(workspace, analysis["id"], directory)
    prepared = workspace.get_grid(workspace.inspect_run(analysis["baseline_run_id"])["selection"]["grid_id"])
    overlay_path = verify_file(directory, inventory["files"]["analysis_receiving_waters_gpkg"])
    overlays = {}
    for family, row in inventory["families"].items():
        if row["current_priority"] is None:
            continue
        selected, _ = rasters.vector_geometry(
            overlay_path, layer="receiving_waters", target_crs=prepared["grid"]["crs"],
            where={"kind": "family_union", "family": family},
        )
        overlays[family] = {
            "label": row["title"] + " / " + inventory["quantity_scope"].replace("_", " "),
            "features": selected, "width": 0.8, "style": "--",
            "source": {"analysis_id": analysis["id"], "plan_id": analysis["plan_id"],
                       "method": row["relationship_precision"]},
        }
    return {"inventory": inventory, "overlays": overlays, "directory": str(directory)}


def attach_state(state, delivery_directory, product):
    """Add original copied artifacts to the existing delivery state."""
    if product is None:
        return
    directory, delivery_directory = Path(product["directory"]), Path(delivery_directory)
    inventory = product["inventory"]
    state["receiving_waters"] = {
        "identity": inventory["identity"], "quantity_scope": inventory["quantity_scope"],
        "pollutants": inventory["pollutants"],
        "artifact_root": directory.relative_to(delivery_directory).as_posix(),
        "normalization": inventory["normalization"], "families": inventory["families"],
        "measurement": inventory["measurement"],
        "accounting": inventory.get("accounting"),
        "report_sections": report_section(product),
    }
    for name, item in inventory["files"].items():
        state["files"]["receiving_water_" + name] = describe_file(
            delivery_directory, verify_file(directory, item),
        )
    state["files"]["receiving_water_index"] = describe_file(
        delivery_directory, directory / "receiving-water-delivery.json",
    )


def apply_map_specs(specifications, product):
    """Replace configured protection-family panels with their own physical priorities."""
    if product is None:
        return
    directory = Path(product["directory"])
    for family, row in product["inventory"]["families"].items():
        artifact = row["current_priority"]
        if artifact is None:
            continue
        existing_panels, existing_overlays = specifications.get(family, ([], []))
        previous = dict(existing_panels[0]) if existing_panels else {}
        units = previous.get("units", "dimensionless (0-1)")
        own_overlay = product["overlays"].get(family)
        specifications[family] = (
            [{**previous, "path": verify_file(directory, artifact),
              "label": "Current export priority in selected receiving-water land",
              "units": units, "signed": False,
              "scale": {"minimum": 0.0, "maximum": 1.0, "signed": False,
                        "units": units,
                        "label": "Fixed 0-1 range for the selected receiving-water priority."}}],
            existing_overlays + ([own_overlay] if own_overlay else []),
        )


def report_section(product):
    """A scientific-report section using actual per-water quantities and source methods."""
    if product is None:
        return []
    inventory = product["inventory"]
    paragraphs = [
        "Receiving-water physical quantities use the " + inventory["quantity_scope"].replace("_", " ")
        + " scope. Each family uses its actual selected contribution footprint.",
        "Fixed pollutant normalization: " + json.dumps(inventory["normalization"], sort_keys=True),
        inventory["measurement"]["physical"],
        inventory["measurement"]["coverage"],
        inventory["measurement"]["overlap"],
    ]
    for row in inventory["receptors"]:
        metrics = row["metrics"]
        summary = {
            "title": row["title"], "family": row["family"],
            "relationship": row["relationship_precision"],
            "selected_cells": metrics["selected_cells"],
            "annual_exports": {
                pollutant: {name: value[name] for name in ("sum", "sum_units", "valid_cells", "coverage_fraction")}
                for pollutant, value in metrics["baseline_physical"].items()
            },
            "alternative_changes": {
                run_id: {pollutant: {name: value[name] for name in
                                    ("sum", "sum_units", "sum_increased_export", "sum_avoided_export",
                                     "valid_cells", "coverage_fraction")}
                         for pollutant, value in alternative["changes"].items()}
                for run_id, alternative in metrics["alternatives"].items()
            },
        }
        paragraphs.append(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return [("Receiving-water quantities and priorities", paragraphs)]


def extend_assets(manifest, state):
    """Include the complete receiving-water files in the normal delivery package."""
    assets = manifest["project_assets"]
    selected = {item for item in assets}
    for name, item in state["files"].items():
        if name.startswith("receiving_water_") and item["path"] not in selected:
            assets.append(item["path"])
            selected.add(item["path"])
