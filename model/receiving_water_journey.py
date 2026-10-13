#!/usr/bin/env python3
"""Render, save, export and reopen actual retained receiving-water maps."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "model"

from .common import (
    atomic_json, digest, file_digest, held, identifier, now, read_json, verify_file,
)
from .workspace import Workspace
from .spatial import SpatialReview
from .spatial_exports import SpatialExports, _application_identity
from . import portable, receiving_waters

SCHEMA = "upstate.receiving-water-native-journey/v1"
PRIORITIES = {
    "current_priority", "increased_export_priority", "avoided_export_priority",
}
STATISTICS = PRIORITIES | {"contribution_mask", "change"}


def _one(layers, **criteria):
    matches = [
        row for row in layers
        if all(row.get(name) == value for name, value in criteria.items())
    ]
    if len(matches) != 1:
        raise ValueError(
            "Expected one original spatial layer for " +
            json.dumps(criteria, sort_keys=True) + "; found " + str(len(matches))
        )
    return matches[0]


def _choice(layer, where=None):
    value = {"layer_id": layer["id"]}
    if layer["kind"] == "vector":
        value["layer"] = layer["native_layer"]
        if where:
            value["where"] = where
    else:
        value["band"] = 1
    return value


def _overlay(layer, *, where=None, style="solid"):
    return {
        "selection": _choice(layer, where), "label": layer["title"],
        "visible": True, "style": style, "width": 1.25, "opacity": 1,
    }


def _subjects(plan, analysis, request):
    rows = (
        analysis["subjects"] if analysis
        else [{**row, "kind": "receptor"} for row in plan["receptors"]]
    )
    kind = request.get("subject_kind")
    if kind:
        rows = [row for row in rows if row["kind"] == kind]
    wanted = request.get("subject_ids") or []
    if wanted:
        rows = [row for row in rows if row["id"] in wanted]
        missing = set(wanted) - {row["id"] for row in rows}
        if missing:
            raise ValueError("Original subject IDs are absent: " + ", ".join(sorted(missing)))
    if not rows:
        raise ValueError("Choose existing subjects from the original saved plan or analysis")
    return rows


def _analysis_run(analysis, request):
    statistic = request.get("statistic") or "current_priority"
    if statistic not in STATISTICS:
        raise ValueError("Select an original receiving-water raster statistic")
    run_id = request.get("run_id")
    alternatives = analysis.get("alternative_run_ids", [])
    if run_id is None:
        if statistic in {"increased_export_priority", "avoided_export_priority", "change"}:
            if len(alternatives) != 1:
                raise ValueError("Select the actual alternative with --run-id")
            run_id = alternatives[0]
        else:
            run_id = analysis["baseline_run_id"]
    if run_id not in [analysis["baseline_run_id"], *alternatives]:
        raise ValueError("Selected run is absent from the original completed analysis")
    if statistic == "contribution_mask" and run_id != analysis["baseline_run_id"]:
        raise ValueError("The retained contribution mask is associated with the baseline grid")
    if statistic in {"increased_export_priority", "avoided_export_priority", "change"}:
        if run_id not in alternatives:
            raise ValueError("Select an original alternative run for a paired change")
    quantity = request.get("quantity")
    if statistic == "change":
        quantities = analysis.get("pollutants") or analysis.get("identity", {}).get("pollutants")
        if not quantities:
            quantities = {
                key for subject in analysis.get("subjects", [])
                for key in subject.get("metrics", {}).get("baseline_physical", {})
            }
        if quantity not in quantities:
            raise ValueError("Select an actual analyzed quantity with --quantity")
    elif quantity is not None:
        raise ValueError("Physical quantity selection applies to a signed change raster")
    return statistic, run_id, quantity


def _payload(layers, plan, analysis, subject, request):
    if analysis is None:
        criteria = {
            "group": "receiving-water-plan",
            "receiving_water_plan_id": plan["id"],
            "subject_id": subject["id"], "subject_kind": "receptor",
        }
        original = _one(layers, **criteria, geometry_role="receptor")
        contribution = _one(layers, **criteria, geometry_role="contribution")
        return {
            "title": (subject["title"] + " / Original source and contribution area")[:500],
            "reference": _choice(contribution), "primary": None,
            "comparison": None, "mode": "single", "scale": {"mode": "auto"},
            "overlays": [
                _overlay(contribution), _overlay(original, style="dash"),
            ],
            "markers": [],
            "notes": (
                "Original receiving-water plan " + plan["id"] + ". " +
                subject["relationship_precision"] + ". Relationship: " +
                subject["relation"]["method"] + "."
            ),
        }, None
    statistic, run_id, quantity = _analysis_run(analysis, request)
    summary = _one(
        layers, group="receiving-water-analysis",
        receiving_water_analysis_id=analysis["id"], statistic="physical_summary",
    )
    criteria = {
        "group": "receiving-water-analysis",
        "receiving_water_analysis_id": analysis["id"],
        "subject_id": subject["id"], "subject_kind": subject["kind"],
        "statistic": statistic, "run_id": run_id,
    }
    if quantity:
        criteria["quantity"] = quantity
    raster = _one(layers, **criteria)
    where = {"subject_id": subject["id"], "kind": subject["kind"]}
    return {
        "title": (subject["title"] + " / " + raster["title"].split(" / ", 1)[-1])[:500],
        "reference": _choice(summary, where), "primary": _choice(raster),
        "comparison": None, "mode": "single",
        "scale": (
            {"mode": "fixed", "minimum": 0, "maximum": 1}
            if statistic in PRIORITIES else {"mode": "auto"}
        ),
        "overlays": [_overlay(summary, where=where)], "markers": [],
        "notes": (
            "Original receiving-water analysis " + analysis["id"] +
            ". Quantity scope: " + analysis["quantity_scope"] +
            ". " + subject["relationship_precision"] +
            ". Statistic: " + statistic + "; run: " + run_id +
            (". Physical quantity: " + quantity if quantity else "") + "."
        ),
    }, raster


def _reopen(workspace, review_id, export_id):
    spatial = SpatialReview(workspace)
    exporter = SpatialExports(workspace, spatial=spatial)
    exported = exporter.inspect(export_id)
    if exported["state"] != "complete" or exported["review_id"] != review_id:
        raise ValueError("Selected original map export is not complete")
    root = workspace.root / "spatial-exports" / export_id
    exported_body = read_json(verify_file(root, exported["files"]["review"]))
    if digest(exported_body) != review_id:
        raise ValueError("Exported review does not match its original content identity")
    review = {**exported_body, "id": review_id}
    validation = spatial.validate_saved(review)
    frame = spatial.frame(review)
    primary = frame["images"].get("primary")
    return {
        "review_id": review_id, "export_id": export_id,
        "binding_identity": validation["identity"],
        "bindings": validation["bindings"], "view": frame["view"],
        "primary_source_sha256": primary["source_sha256"] if primary else None,
        "primary_units": primary["units"] if primary else None,
        "warnings": frame["warnings"],
    }


def _archive_and_reopen(workspace, directory, maps, publish):
    archive = directory / "workspace.zip"
    restored_dir = directory / "restored"
    publish("workspace_backup")
    if archive.exists():
        manifest = portable.inspect_archive(archive, verify=True)
        if manifest["project"] != workspace.project:
            raise ValueError("Existing archive belongs to another original workspace")
        spatial = SpatialReview(workspace)
        exporter = SpatialExports(workspace, spatial=spatial)
        for item in maps:
            review = workspace._get("spatial-reviews", item["review_id"])
            spatial.validate_saved(review, verified_members=manifest["members"])
            exporter.inspect(item["export_id"], verified_members=manifest["members"])
    else:
        portable.backup(workspace, archive)
        manifest = portable.inspect_archive(archive, verify=False)
    publish("workspace_restore")
    if restored_dir.exists():
        for name, item in manifest["members"].items():
            verify_file(restored_dir, {**item, "path": name})
        restored = Workspace(restored_dir / "workspace")
        if restored.project != workspace.project:
            raise ValueError("Existing received workspace identity differs")
    else:
        received = portable.restore(archive, restored_dir)
        restored = Workspace(received["workspace"])
    publish("reopen_received_workspace")
    reopened = [
        _reopen(restored, item["review_id"], item["export_id"]) for item in maps
    ]
    return {
        "path": str(archive), "sha256": file_digest(archive),
        "bytes": archive.stat().st_size, "members": len(manifest["members"]),
        "workspace": str(restored.root),
        "application": str(restored_dir / "application"),
        "project_id": restored.project["id"], "reopened": reopened,
    }


def run(workspace, request, output_dir, *, progress=None):
    """Execute the original saved-map workflow and persist its actual outcome."""
    request = json.loads(json.dumps(request, allow_nan=False))
    identity = {
        "schema": SCHEMA, "project_id": workspace.project["id"],
        "request": request, "implementation_sha256": file_digest(__file__),
        "renderer_id": digest(_application_identity()),
    }
    operation_id = digest(identity)
    directory = Path(output_dir).resolve() / operation_id
    if directory.is_relative_to(workspace.root):
        raise ValueError("Choose an output directory outside the scientific workspace")
    directory.mkdir(parents=True, exist_ok=True)
    record_path = directory / "journey.json"
    result = {
        **identity, "id": operation_id, "state": "running",
        "started_at": now(), "workspace": str(workspace.root),
        "result_path": str(record_path), "maps": [], "empty_subjects": [],
    }

    def publish(stage, **details):
        result.update(stage=stage, updated_at=now())
        result["active"] = details
        atomic_json(record_path, result)
        if progress:
            progress({"stage": stage, **details})

    with held(directory / ".journey.lock", blocking=False):
        try:
            publish("inspect_original_plan")
            analysis_id = request.get("analysis_id")
            analysis = (
                receiving_waters.inspect(workspace, identifier(analysis_id))
                if analysis_id else None
            )
            if analysis and analysis["state"] != "complete":
                raise ValueError("Select an existing completed receiving-water analysis")
            plan_id = request.get("plan_id") or (analysis["plan_id"] if analysis else None)
            plan = receiving_waters.inspect_plan(workspace, identifier(plan_id))
            if analysis and analysis["plan_id"] != plan["id"]:
                raise ValueError("Analysis and source plan identities differ")
            preparation = request.get("preparation")
            if preparation:
                if set(preparation["receptor_ids"]) != {row["id"] for row in plan["receptors"]}:
                    raise ValueError("Original prepared receptor IDs differ from the saved plan")
                if any(row["source"]["source_collection_id"] != preparation["source_collection_id"]
                       for row in plan["receptors"]):
                    raise ValueError("Prepared plan does not retain the original source collection")
            if analysis is None and any(request.get(k) for k in ("run_id", "quantity", "statistic")):
                raise ValueError("Numerical result selection requires --analysis-id")
            result.update(plan_id=plan["id"], analysis_id=analysis["id"] if analysis else None)
            subjects = _subjects(plan, analysis, request)
            if analysis:
                _analysis_run(analysis, request)
            publish("open_original_spatial_catalog")
            spatial = SpatialReview(workspace)
            exporter = SpatialExports(workspace, spatial=spatial)
            layers = spatial.catalog()["layers"]
            for subject in subjects:
                selected = {"subject_id": subject["id"], "subject_kind": subject["kind"]}
                if analysis and subject["metrics"]["selected_cells"] == 0:
                    result["empty_subjects"].append({
                        **selected, "selected_cells": 0,
                        "area_in_quantity_scope_ha": subject["area_in_quantity_scope_ha"],
                    })
                    continue
                publish("open_original_layers", **selected)
                payload, raster = _payload(layers, plan, analysis, subject, request)
                description = spatial.describe({"selection": payload["reference"]})
                frame = spatial.frame(payload)
                payload["view"] = frame["view"]
                publish("save_review", **selected)
                review = spatial.save(payload)
                publish("export_map", **selected, review_id=review["id"])
                exported = exporter.export({
                    "review_id": review["id"],
                    "paper": request.get("paper", "letter"), "dpi": request.get("dpi", 220),
                })
                if exported["state"] != "complete":
                    raise ValueError("Original native map export did not complete")
                publish("reopen_exported_review", **selected, export_id=exported["id"])
                reopened = _reopen(
                    Workspace(workspace.root), review["id"], exported["id"],
                )
                base = workspace.root / "spatial-exports" / exported["id"]
                artifacts = {
                    name: {**exported["files"][name],
                           "absolute_path": str(base / exported["files"][name]["path"])}
                    for name in ("map_png", "map_pdf", "map_svg", "bundle")
                }
                result["maps"].append({
                    **selected, "title": subject["title"],
                    "review_id": review["id"], "export_id": exported["id"],
                    "reference_layer_id": payload["reference"]["layer_id"],
                    "primary_layer_id": raster["id"] if raster else None,
                    "units": raster.get("units") if raster else None,
                    "native_crs": description["native"]["crs"],
                    "view": frame["view"], "reopened": reopened,
                    "artifacts": artifacts,
                })
                publish("map_complete", **selected)
            if request.get("archive_and_reopen"):
                result["archive"] = _archive_and_reopen(
                    workspace, directory, result["maps"], publish,
                )
            result.update(
                state="complete" if result["maps"] else "empty_quantity_scope",
                completed_at=now(), stage="complete", active={},
                selected_subjects=len(subjects), exported_maps=len(result["maps"]),
            )
        except Exception as error:
            result.update(
                state="failed", failed_at=now(),
                error={"type": type(error).__name__, "message": str(error)},
            )
        atomic_json(record_path, result)
    return result


def parser():
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--workspace", type=Path)
    command.add_argument("--preparation", type=Path)
    command.add_argument("--output-dir", type=Path, required=True)
    command.add_argument("--plan-id")
    command.add_argument("--analysis-id")
    command.add_argument("--subject-id", action="append", dest="subject_ids")
    command.add_argument("--subject-kind", choices=("receptor", "family_union"))
    command.add_argument("--statistic", choices=sorted(STATISTICS))
    command.add_argument("--run-id")
    command.add_argument(
        "--quantity",
        choices=("nitrogen_export", "phosphorus_export", "sediment_export"),
    )
    command.add_argument("--paper", choices=("letter", "a4"), default="letter")
    command.add_argument("--dpi", type=int, choices=(150, 220, 300), default=220)
    command.add_argument("--archive-and-reopen", action="store_true")
    return command


def main(argv=None):
    command = parser()
    args = command.parse_args(argv)
    if args.preparation is None and (args.workspace is None or not (args.plan_id or args.analysis_id)):
        command.error("Select --preparation, or --workspace with --plan-id or --analysis-id")
    stage = "open_preparation" if args.preparation else "open_operation"
    try:
        preparation = None
        if args.preparation:
            path = args.preparation.resolve()
            receipt = read_json(path)
            if receipt.get("schema") != "upstate.public-water-preparation/v1":
                raise ValueError("Select the original public-water preparation result")
            if receipt.get("plan_state") != "complete":
                raise ValueError("The original source preparation did not complete its plan")
            original_workspace = Path(receipt["workspace"])
            if not original_workspace.is_absolute():
                raise ValueError("Preparation must retain its absolute scientific Workspace path")
            original_workspace = original_workspace.resolve()
            if args.workspace is not None and args.workspace.resolve() != original_workspace:
                raise ValueError("Explicit Workspace differs from the original preparation")
            original_plan = identifier(receipt["plan_id"])
            if args.plan_id is not None and args.plan_id != original_plan:
                raise ValueError("Explicit plan differs from the original preparation")
            args.workspace, args.plan_id = original_workspace, original_plan
            preparation = {
                "path": str(path), "bytes": path.stat().st_size,
                "sha256": file_digest(path),
                "source_collection_id": receipt["source_collection_id"],
                "receptor_ids": receipt["receptor_ids"],
            }
        request = {
            name: value for name, value in vars(args).items()
            if name not in ("workspace", "output_dir", "preparation") and value is not None
        }
        if preparation is not None:
            request["preparation"] = preparation
        stage = "open_operation"
        result = run(
            Workspace(args.workspace), request, args.output_dir,
            progress=lambda row: print(
                json.dumps(row, sort_keys=True), file=sys.stderr, flush=True,
            ),
        )
    except Exception as error:
        result = {
            "schema": SCHEMA, "state": "failed", "stage": stage,
            "workspace": str(args.workspace),
            "error": {"type": type(error).__name__, "message": str(error)},
        }
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
    return 0 if result["state"] == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
