"""Receive retained Conservation priorities through original Workspace operations.

Run inside the complete application. This course reuses a completed study and
creates an explicitly authored decision; it never launches an InVEST model.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys
import traceback
import zipfile

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model import conservation, conservation_optimization as optimization
from model import conservation_report_source as report_source
from model import observed_report_render
from model.common import atomic_json, canonical, describe_file, digest, now, read_json, verify_file
from model.workspace import Workspace


def _original_constraints(plan):
    prior = plan["selection"].get("optimization", {}).get("request", {})
    if isinstance(prior.get("constraints"), dict):
        return deepcopy(prior["constraints"])
    limits = plan["selection"].get("limits", {})
    result = {"area_basis": limits.get("area_basis", "whole_units")}
    for old, new in (("maximum_area_ha", "area_ha"),
                     ("maximum_cost", "budget_usd"),
                     ("maximum_parcels", "max_count")):
        if limits.get(old) is not None:
            result[new] = limits[old]
    return result


def _selection(plan, study, args):
    if args.selection:
        selected = read_json(args.selection.resolve())
        if not isinstance(selected, dict) or selected.get("study_id") != study["id"]:
            raise ValueError("The authored selection must name the original saved plan's study")
        if args.max_count is not None or args.include_unprotected:
            raise ValueError("Put constraints and criteria in the explicit selection; do not mix overrides")
        return selected
    contexts = study["selection"]["spec"].get("contexts", {})
    if "drinking_water" not in contexts:
        raise ValueError("Default source-water criteria need an actual bound drinking-water source")
    criteria = [
        {"id": "water", "label": "Source-water overlap", "kind": "source-context",
         "axis": "source_water_area_ha", "basis": "total"},
        {"id": "reporting", "label": "Reporting footprint", "kind": "source-context",
         "axis": "reporting_area_ha", "basis": "total"},
    ]
    if args.include_unprotected:
        if "protected_lands" not in contexts:
            raise ValueError("Unprotected area needs the original protected-lands source binding")
        criteria.append({"id": "unprotected", "label": "Unprotected reporting area",
                         "kind": "source-context", "axis": "unprotected_area_ha", "basis": "total"})
    constraints = _original_constraints(plan)
    if args.max_count is not None:
        constraints["max_count"] = args.max_count
    prior = plan["selection"].get("optimization", {}).get("request", {})
    result = {
        "study_id": study["id"], "title": args.title,
        "purpose": "Compare original planning units under explicit geographic preferences.",
        "objective": {"kind": "multi-criteria", "criteria": criteria},
        "weights": {row["id"]: 1 for row in criteria},
        "constraints": constraints,
        "include_ineligible": plan["selection"].get("include_ineligible", False),
        "stability": {"enabled": True, "profiles": [
            {"name": row["label"] + " first", "weights": {row["id"]: 1}}
            for row in criteria]},
        "scenario_stability": {"enabled": False, "cases": []},
    }
    for name in ("filters", "solver", "solver_time_limit_seconds"):
        if name in prior:
            result[name] = deepcopy(prior[name])
    return result


def _verify(workspace, members):
    for item in members.values():
        verify_file(workspace.root, item)


def receive(args):
    workspace = Workspace(args.workspace.resolve(), create=False)
    original = conservation.get_plan(workspace, args.source_plan)
    if original.get("state") != "complete":
        raise ValueError("Use an original completed Conservation plan")
    study = conservation.inspect(workspace, original["study_id"], include_candidates=True)
    if study.get("state") != "complete":
        raise ValueError("Use the original completed candidate study")
    _verify(workspace, original["files"])
    _verify(workspace, study["files"])
    selection = _selection(original, study, args)
    output = args.output.resolve()
    implementations = {}
    for name in ("model/conservation_optimization.py", "model/conservation.py",
                 "model/conservation_report_source.py", "model/conservation_report_maps.py",
                 "model/conservation_decision_geography.py",
                 "source_tools/receive_conservation_priorities.py",
                 "operator/web/conservation.mjs"):
        implementations[name] = describe_file(APPLICATION, APPLICATION / name)
    for name in observed_report_render._rendering_paths():
        implementations[name] = describe_file(APPLICATION, APPLICATION / name)
    identity = {
        "schema": "upstate.conservation-priority-receiving-selection/v1",
        "project_id": workspace.project["id"], "source_plan_id": original["id"],
        "source_plan_selection": original["selection"],
        "original_study_selection": study["selection"],
        "candidate_inventory": study["files"]["candidates"],
        "geometry_inventory": study["files"]["geometries"],
        "authored_selection": selection, "implementations": implementations,
    }
    output.mkdir(parents=True, exist_ok=True)
    atomic_json(output / "selection.json", identity, immutable=True)
    key = digest(identity)
    receipt_path = output / "result.json"
    previous = read_json(receipt_path) if receipt_path.exists() else None
    if previous is not None and previous.get("selection_id") != key:
        raise ValueError("This receiving directory belongs to another source or authored decision")
    phase = "preview"
    try:
        preview_path = output / "preview.json"
        if preview_path.exists():
            retained = read_json(preview_path)
            analysis = optimization._retained_preview(workspace, retained["request"], retained)
        else:
            analysis = optimization.preview(workspace, selection)
            atomic_json(preview_path, analysis, immutable=True)
        phase = "save_original_preview"
        saved = optimization.save(workspace, analysis["request"], retained_analysis=analysis)
        plan = saved["plan"]
        phase = "cold_reopen"
        reopened_workspace = Workspace(args.workspace.resolve(), create=False)
        reopened = optimization.get_analysis(reopened_workspace, study["id"], analysis["id"])
        if reopened["analysis"] != analysis:
            raise ValueError("Cold-reopened analysis differs from the completed preview")
        reopened_plan = conservation.get_plan(reopened_workspace, plan["id"])
        if reopened_plan["selection"] != plan["selection"]:
            raise ValueError("Cold-reopened plan selection differs")
        _verify(reopened_workspace, reopened_plan["files"])
        phase = "export_decision"
        exported = optimization.export(reopened_workspace, plan["id"])
        archive = verify_file(reopened_workspace.root, exported)
        with zipfile.ZipFile(archive) as bundle:
            bad = bundle.testzip()
            if bad is not None:
                raise ValueError("Decision archive has a damaged member: " + bad)
            required = {"optimization/analysis.json", "optimization/candidates.csv",
                        "optimization/index.html", "optimization/REFERENCE.json"}
            required.update("optimization/geography/" + name for name in (
                "decision-geography.gpkg", "decision-geography.json", "criteria.csv",
                "criterion-values.csv", "case-candidates.csv",
                "preference-profiles.csv", "README.md"))
            if not required.issubset(bundle.namelist()):
                raise ValueError("Decision archive lacks original retained analysis members")
        phase = "scientific_report_source"
        produced = report_source.prepare(reopened_workspace, {
            "plan_id": plan["id"], "title": plan["title"], "include_maps": True})
        report = report_source.get(reopened_workspace, produced["id"])
        if report["source"] != produced["source"] or report["selection"] != produced["selection"]:
            raise ValueError("Reopened scientific-report source differs")
        phase = "render_scientific_report"
        render_preview_path = output / "scientific-report-preview.json"
        expected_preview = observed_report_render.prepare(
            reopened_workspace, [report["source"]], title=report["title"])
        if render_preview_path.exists():
            render_preview = read_json(render_preview_path)
            if render_preview != expected_preview:
                raise ValueError("Retained report preview belongs to another original source or renderer")
        else:
            render_preview = expected_preview
            atomic_json(render_preview_path, render_preview, immutable=True)
        rendered = observed_report_render.render(
            reopened_workspace, render_preview, output / "scientific-report")
        render_root = Path(rendered["output"])
        for item in rendered["files"].values():
            verify_file(render_root, item)
        if rendered["state"] != "complete":
            raise ValueError("The original Scientific Reports render is incomplete")
        phase = "original_preservation"
        after = conservation.get_plan(reopened_workspace, original["id"])
        if canonical(after) != canonical(original):
            raise ValueError("The original saved plan changed during receiving")
        observed = conservation.inspect(reopened_workspace, study["id"], include_candidates=False)
        if observed["selection"] != study["selection"] or observed["files"] != study["files"]:
            raise ValueError("The original completed candidate edition changed")
        _verify(reopened_workspace, original["files"])
        result = {
            "schema": "upstate.conservation-priority-receiving/v1", "state": "complete",
            "selection_id": key, "completed_at": now(), "project_id": workspace.project["id"],
            "source_plan_id": original["id"], "study_id": study["id"],
            "candidate_count": len(study["candidates"]), "analysis_id": analysis["id"],
            "plan_id": plan["id"], "selected_ids": saved["selected_ids"],
            "authored_request": analysis["request"], "union_summary": saved["union_summary"],
            "analysis_files": reopened["state"]["files"], "plan_files": plan["files"],
            "decision_archive": exported, "scientific_report_source": report,
            "scientific_report": rendered,
            "implementations": implementations,
            "visual_review": {"state": "pending", "required": [
                "Operate the original outgoing Conservation desk and changed criteria.",
                "Inspect every outgoing report/map at desktop and narrow widths.",
                "Open actual CSV, GeoPackage, ZIP and scientific-report downloads."]},
        }
        if previous is not None:
            for name in ("project_id", "source_plan_id", "study_id", "analysis_id",
                         "plan_id", "selected_ids", "authored_request",
                         "analysis_files", "plan_files", "implementations",
                         "scientific_report"):
                if result[name] != previous[name]:
                    raise ValueError("Original receiving replay differs at " + name)
            return previous
        atomic_json(receipt_path, result, immutable=True)
        return result
    except BaseException as error:
        failure = {"schema": "upstate.conservation-priority-receiving-failure/v1",
                   "selection_id": key, "phase": phase, "at": now(),
                   "type": type(error).__name__, "message": str(error),
                   "traceback": traceback.format_exc()}
        try:
            atomic_json(output / "failure.json", failure)
        except OSError as receipt_error:
            if hasattr(error, "add_note"):
                error.add_note("Could not retain failure receipt: " + str(receipt_error))
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--source-plan", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--selection", type=Path,
                        help="Complete analyst-authored request using this study's original sources/cases")
    parser.add_argument("--title", default="Source-water and reporting-area priorities")
    parser.add_argument("--max-count", type=int,
                        help="Explicit analyst comparison cap; original constraints otherwise remain")
    parser.add_argument("--include-unprotected", action="store_true",
                        help="Add the original protected-lands context when actually bound")
    args = parser.parse_args(argv)
    if args.max_count is not None and args.max_count <= 0:
        parser.error("--max-count must be a positive whole unit count")
    result = receive(args)
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
