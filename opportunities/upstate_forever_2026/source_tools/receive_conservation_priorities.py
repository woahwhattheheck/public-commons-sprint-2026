"""Receive retained Conservation priorities through original Workspace operations.

Run inside the complete application. This course reuses a completed study and
creates an explicitly authored decision; it never launches an InVEST model.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import subprocess
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
from model.common import atomic_json, canonical, describe_file, digest, held, now, read_json, verify_file
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


def _authored_json(path, label):
    """Retain the complete analyst source, including its original UTF-8 bytes."""
    body = Path(path).resolve().read_bytes()
    text = body.decode("utf-8")
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError(label + " must be a complete JSON object")
    return value, {"filename": Path(path).name, "bytes": len(body),
                   "sha256": hashlib.sha256(body).hexdigest(), "content": text}


def _matched_subject(workspace, args, output, implementations):
    """Prepare only the original spatial projection of explicitly selected runs."""
    if args.selection is None:
        raise ValueError("Matched-family receiving requires a complete analyst-authored --selection")
    if args.max_count is not None or args.include_unprotected:
        raise ValueError("Put all matched-family criteria and constraints in --selection")
    spec, spec_source = _authored_json(args.matched_study_spec, "Matched study specification")
    request, request_source = _authored_json(args.selection, "Priority decision")
    families = spec.get("matched_families")
    if spec.get("mode") != "native_model" or not isinstance(families, list) or not families:
        raise ValueError("Select explicit matched_families in an original native_model Conservation specification")
    objective = request.get("objective")
    if not isinstance(objective, dict):
        raise ValueError("Select an explicit matched-family priority objective")
    if objective.get("kind") == "multi-criteria":
        criteria = objective.get("criteria")
        if not isinstance(criteria, list) or not any(
                row.get("kind") in ("matched-restoration", "matched-disturbance")
                for row in criteria if isinstance(row, dict)):
            raise ValueError("The decision must select at least one original matched-family criterion")
    elif objective.get("kind") not in ("matched-restoration", "matched-disturbance"):
        raise ValueError("Use an explicit matched-family or mixed-criteria priority decision")
    for root in (workspace.root.resolve(), APPLICATION.resolve()):
        if output == root or root in output.parents:
            raise ValueError("Keep matched-family receiving output outside the source Workspace and application")
    admission = {
        "schema": "upstate.conservation-matched-priority-admission/v1",
        "project_id": workspace.project["id"], "study_source": spec_source,
        "request_source": request_source, "implementations": implementations,
    }
    output.mkdir(parents=True, exist_ok=True)
    atomic_json(output / "matched-admission.json", admission, immutable=True)
    phase = "prepare_matched_study"
    try:
        # prepare/build are the maintained bounded-memory spatial projection.
        # They validate completed native identities and never call a model runner.
        prepared = conservation.prepare(workspace, spec)
        phase = "build_matched_study"
        conservation.build(workspace, prepared["id"])
        study = conservation.inspect(workspace, prepared["id"], include_candidates=True)
        if study.get("state") != "complete" or not study.get("matched_family_support"):
            raise ValueError("The original matched-family study has no complete retained support")
        if request.get("study_id") not in (None, study["id"]):
            raise ValueError("The authored priority request names another Conservation study")
        request = {**request, "study_id": study["id"]}
        context = {
            "admission_id": digest(admission), "authored_spec": spec,
            "study_id": study["id"], "matched_family_support": study["matched_family_support"],
            "native_bindings": study["selection"]["bindings"]["runs"],
        }
        atomic_json(output / "matched-study.json", context, immutable=True)
        return study, request, context
    except BaseException as error:
        try:
            atomic_json(output / "matched-failure.json", {
                "phase": phase, "at": now(), "type": type(error).__name__,
                "message": str(error), "traceback": traceback.format_exc(),
                "admission_id": digest(admission)})
        except OSError as receipt_error:
            if hasattr(error, "add_note"):
                error.add_note("Could not retain matched-study failure: " + str(receipt_error))
        raise


def _matched_transfer(workspace, study, plan, analysis, report, exported,
                      output, implementations):
    """Export the original typed Study and operate its own received application."""
    from model import portable, study_transfer
    selection = {
        "title": plan["title"], "include_related_results": False,
        "roots": [
            {"kind": "conservation", "id": study["id"]},
            {"kind": "conservation-plans", "id": plan["id"]},
            {"kind": "conservation-exports", "id": exported["id"]},
            {"kind": "conservation-report-sources", "id": report["id"]},
        ],
    }
    archive_path = output / "matched-priorities-editable-study.zip"
    transfer = study_transfer.export_study(workspace, archive_path, selection)
    inspected = study_transfer.inspect_transfer_archive(archive_path, verify=True)
    manifest = inspected["manifest"]
    if (manifest["project"] != workspace.project
            or inspected["study"]["identity"]["selection"] != study_transfer.normalise(selection)):
        raise ValueError("The editable Study archive belongs to another original selection")
    for name, expected in implementations.items():
        member = manifest["members"].get("application/" + name)
        if (not isinstance(member, dict)
                or any(member.get(key) != expected.get(key) for key in ("bytes", "sha256"))):
            raise ValueError("The Study archive lacks its exact receiving source: " + name)
    for metric in study["matched_family_support"]["metrics"].values():
        descriptor = metric.get("mask")
        if descriptor is not None:
            member = manifest["members"].get("workspace/" + descriptor["path"])
            if (not isinstance(member, dict)
                    or any(member.get(key) != descriptor.get(key) for key in ("bytes", "sha256"))):
                raise ValueError("The Study archive lost an original pollutant support mask")
    destination = output / "received-matched-study"
    if destination.exists():
        received = portable.resume_restore(
            archive_path, destination, expected_archive_sha256=transfer["sha256"])
    else:
        received = portable.restore(archive_path, destination)
    received_application = Path(received["application"]).resolve()
    received_workspace = Path(received["workspace"]).resolve()
    for name, expected in implementations.items():
        actual = describe_file(received_application, received_application / name)
        if any(actual.get(key) != expected.get(key) for key in ("bytes", "sha256")):
            raise ValueError("The received application differs at " + name)
    expectation = {
        "project_id": workspace.project["id"], "study_id": study["id"], "plan_id": plan["id"],
        "analysis_id": analysis["id"], "report_id": report["id"],
        "study_selection": study["selection"], "study_files": study["files"],
        "support": study["matched_family_support"], "analysis": analysis,
        "plan_selection": plan["selection"], "plan_files": plan["files"],
        "selected_ids": plan["selected_ids"], "summary": plan["summary"],
        "report_selection": report["selection"], "report_source": report["source"],
    }
    expectation_path = output / "cold-study-expectation.json"
    atomic_json(expectation_path, expectation, immutable=True)
    # A new interpreter loads the received application itself. It does not inherit
    # the producer's imported Workspace/Conservation modules.
    script = r'''import json, sys
from pathlib import Path
application, root, expected_path = map(Path, sys.argv[1:])
sys.path.insert(0, str(application))
from model.workspace import Workspace
from model import conservation, conservation_optimization as optimization
from model import conservation_report_source as report_source
from model import study_transfer, observed_report_render
from model.common import read_json, verify_file
expected = read_json(expected_path)
workspace = Workspace(root, create=False)
if workspace.project["id"] != expected["project_id"]:
    raise ValueError("Received matched study has another project")
study = conservation.inspect(workspace, expected["study_id"], include_candidates=True)
analysis = optimization.get_analysis(workspace, study["id"], expected["analysis_id"])["analysis"]
plan = conservation.get_plan(workspace, expected["plan_id"])
report = report_source.get(workspace, expected["report_id"])
pairs = (
    (study["selection"], expected["study_selection"], "study selection"),
    (study["files"], expected["study_files"], "study files"),
    (study["matched_family_support"], expected["support"], "per-pollutant support"),
    (analysis, expected["analysis"], "complete frozen analysis"),
    (plan["selection"], expected["plan_selection"], "plan selection"),
    (plan["files"], expected["plan_files"], "plan files"),
    (plan["selected_ids"], expected["selected_ids"], "selected planning units"),
    (plan["summary"], expected["summary"], "physical portfolio quantities"),
    (report["selection"], expected["report_selection"], "scientific-report selection"),
    (report["source"], expected["report_source"], "scientific-report source"),
)
for observed, retained, label in pairs:
    if observed != retained:
        raise ValueError("Received original differs: " + label)
for files in (study["files"], plan["files"], report["files"], report["members"]):
    for descriptor in files.values():
        verify_file(workspace.root, descriptor)
for metric in study["matched_family_support"]["metrics"].values():
    if metric.get("mask") is not None:
        verify_file(workspace.root, metric["mask"])
study_transfer.verify_received_studies(workspace)
render_preview = observed_report_render.prepare(workspace, [report["source"]], title=report["title"])
rendered = observed_report_render.render(
    workspace, render_preview, expected_path.parent / "received-scientific-report")
if rendered["state"] != "complete":
    raise ValueError("Received original scientific report did not render completely")
for descriptor in rendered["files"].values():
    verify_file(Path(rendered["output"]), descriptor)
print(json.dumps({
    "state": "complete", "project_id": workspace.project["id"],
    "study_id": study["id"], "plan_id": plan["id"], "analysis_id": analysis["id"],
    "report_id": report["id"], "candidate_count": len(study["candidates"]),
    "selected_ids": plan["selected_ids"], "support_id": study["matched_family_support"]["id"],
    "application": str(application), "workspace": str(root),
    "scientific_report": {"output": rendered["output"], "files": rendered["files"],
                          "state": rendered["state"]},
}, ensure_ascii=False, sort_keys=True, allow_nan=False))
'''
    completed = subprocess.run(
        [sys.executable, "-I", "-B", "-c", script, str(received_application),
         str(received_workspace), str(expectation_path)], cwd=received_application,
        capture_output=True, text=True, check=False)
    process = {"returncode": completed.returncode, "stdout": completed.stdout,
               "stderr": completed.stderr, "python": sys.executable}
    atomic_json(output / "cold-study-process.json", process)
    if completed.returncode != 0:
        raise RuntimeError("The received original application could not reopen its matched study: "
                           + completed.stderr[-12000:])
    if not completed.stdout.strip():
        raise ValueError("The received original application returned no complete result")
    cold = json.loads(completed.stdout.strip().splitlines()[-1])
    if cold.get("state") != "complete":
        raise ValueError("The received original application did not complete study reopening")
    atomic_json(output / "cold-study.json", cold, immutable=True)
    return {"archive": transfer, "receiver": received, "cold": cold}


def _receive(args):
    workspace = Workspace(args.workspace.resolve(), create=False)
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
    matched = None
    if getattr(args, "matched_study_spec", None) is not None:
        for name in ("model/conservation_families.py", "model/study_transfer.py",
                     "model/conservation_study_transfer.py", "model/portable.py"):
            implementations[name] = describe_file(APPLICATION, APPLICATION / name)
        original = None
        study, selection, matched = _matched_subject(workspace, args, output, implementations)
    else:
        original = conservation.get_plan(workspace, args.source_plan)
        if original.get("state") != "complete":
            raise ValueError("Use an original completed Conservation plan")
        study = conservation.inspect(workspace, original["study_id"], include_candidates=True)
        if study.get("state") != "complete":
            raise ValueError("Use the original completed candidate study")
        _verify(workspace, original["files"])
        selection = _selection(original, study, args)
    _verify(workspace, study["files"])
    identity = {
        "schema": "upstate.conservation-priority-receiving-selection/v1",
        "project_id": workspace.project["id"], "source_plan_id": original["id"] if original else None,
        "source_plan_selection": original["selection"] if original else None,
        "original_study_selection": study["selection"],
        "candidate_inventory": study["files"]["candidates"],
        "geometry_inventory": study["files"]["geometries"],
        "authored_selection": selection, "implementations": implementations,
    }
    if matched is not None:
        identity["matched_study"] = matched
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
        if original is not None:
            after = conservation.get_plan(reopened_workspace, original["id"])
            if canonical(after) != canonical(original):
                raise ValueError("The original saved plan changed during receiving")
        observed = conservation.inspect(reopened_workspace, study["id"], include_candidates=False)
        if observed["selection"] != study["selection"] or observed["files"] != study["files"]:
            raise ValueError("The original completed candidate edition changed")
        if original is not None:
            _verify(reopened_workspace, original["files"])
        transferred = None
        if matched is not None:
            if observed.get("matched_family_support") != matched["matched_family_support"]:
                raise ValueError("The original per-pollutant matched-family support changed")
            native, _ = conservation._native(reopened_workspace, observed["selection"]["spec"])
            if native != matched["native_bindings"]:
                raise ValueError("The completed native selections or output bindings changed")
            phase = "export_and_receive_matched_study"
            transferred = _matched_transfer(
                reopened_workspace, study, plan, analysis, report, exported,
                output, implementations)
        result = {
            "schema": "upstate.conservation-priority-receiving/v1", "state": "complete",
            "selection_id": key, "completed_at": now(), "project_id": workspace.project["id"],
            "source_plan_id": original["id"] if original else None, "study_id": study["id"],
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
        if matched is not None:
            result["matched_study"] = matched
            result["editable_study"] = transferred
        if previous is not None:
            if matched is not None and (previous.get("matched_study") != matched
                    or previous.get("editable_study", {}).get("cold") != transferred["cold"]
                    or previous.get("editable_study", {}).get("archive", {}).get("sha256")
                    != transferred["archive"]["sha256"]):
                raise ValueError("Original matched-study receiving replay differs")
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


def receive(args):
    if getattr(args, "matched_study_spec", None) is None:
        return _receive(args)
    output = args.output.resolve()
    for root in (args.workspace.resolve(), APPLICATION.resolve()):
        if output == root or root in output.parents:
            raise ValueError("Keep matched receiving output outside the original application and Workspace")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".matched-receiving.lock", blocking=False):
        return _receive(args)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    subject = parser.add_mutually_exclusive_group(required=True)
    subject.add_argument("--source-plan", help="Original completed Conservation plan")
    subject.add_argument("--matched-study-spec", type=Path,
                         help="Complete original Conservation specification with explicit matched_families")
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
