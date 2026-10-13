"""Run the retained six-treatment pasture course and reuse its matched native outputs.

Consumes the original prepare_endale_pasture_cases.py receiving result. Uses the
existing experiment engine, reports and full-Workspace archive; no separate solver.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

APP = Path(__file__).resolve().parents[1]
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))
from model import experiments, management_cases, portable
from model.common import atomic_json, canonical, digest, file_digest, held, read_json, verify_file
from model.workspace import Workspace
from model.published_management_cases import selection as published_selection

RECIPE_PATH = APP / "source/management-practices-20261013/endale-2021-pasture-recipe.json"
RECIPE_SHA = "18dd011c195ff67e3a98e6fe34a788cacd94cd8dc70afe4fee4556a9c5dd86d2"


def prepared_source(workspace, directory):
    result = read_json(directory / "receiving-result.json")
    if result.get("state") != "prepared" or result.get("workspace_id") != workspace.project["id"]:
        raise ValueError("Prepare the six treatments in this actual Workspace first")
    selection = read_json(directory / "selection.json")
    binding = read_json(directory / "source-binding.json")
    record = management_cases.inspect(workspace, result["management_case_id"])
    if canonical(record["selection"]) != canonical(selection):
        raise ValueError("The prepared course differs from its retained management selection")
    if (binding.get("recipe_sha256") != RECIPE_SHA or file_digest(RECIPE_PATH) != RECIPE_SHA
            or binding.get("profile_id") != record["baseline_profile_id"]
            or binding.get("table_sha256") != selection["expected_table_sha256"]):
        raise ValueError("Keep the original published recipe, profile and coefficient edition")
    rebuilt_selection, rebuilt_binding = published_selection(
        workspace, binding["profile_id"], binding["lucode"], confirm_pasture=True,
        nitrogen_compartment=binding["nitrogen_compartment"],
        applicability=binding["applicability"])
    if (canonical(rebuilt_selection) != canonical(selection)
            or canonical(rebuilt_binding) != canonical(binding)):
        raise ValueError("The retained pasture values, class or compartment differ from the original recipe")
    recipe = read_json(RECIPE_PATH)
    profiles = {}
    for row in record["profiles"]:
        for case in row.get("management_cases", []):
            if case["name"] in profiles and profiles[case["name"]] != row["profile_id"]:
                raise ValueError("A named treatment has conflicting retained profiles")
            profiles[case["name"]] = row["profile_id"]
    treatments = {}
    for treatment in recipe["treatments"]:
        profile_id = profiles.get(treatment["name"])
        if not profile_id:
            raise ValueError("The management design must retain every published treatment name")
        treatments[treatment["key"]] = {**treatment, "profile_id": profile_id}
    if set(profiles) != {row["name"] for row in recipe["treatments"]}:
        raise ValueError("Use the dedicated six-treatment prepared selection for this course")
    return record, binding, recipe, treatments


def all_cases(workspace, experiment_id):
    offset = 0
    while True:
        page = experiments.inspect(workspace, experiment_id, offset=offset, limit=100)
        yield from page["cases"]
        if page["next_offset"] is None:
            break
        offset = page["next_offset"]


def report_writer(workspace):
    path = APP / "operator/experiment_operator.py"
    spec = importlib.util.spec_from_file_location("retained_endale_experiment_operator", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.ExperimentOperator(SimpleNamespace(ws=lambda key: workspace), ValueError)


def finish_experiment(workspace, experiment_id, renderer, *, completed_only=False, frozen_reports=None):
    state = experiments.execute(workspace, experiment_id, completed_only=completed_only)
    if state["state"] != "complete":
        raise RuntimeError("Resume the existing experiment: " + experiment_id +
                           " / " + state["state"] + " / " + str(state.get("error", "")))
    scope = workspace.root / "experiments" / experiment_id
    frozen = (frozen_reports or {}).get(experiment_id)
    reuse = False
    with held(scope / ".experiment.lock", blocking=False):
        marker_path = scope / "operator-report.json"
        if marker_path.exists():
            marker = read_json(marker_path)
            if (marker.get("summary_sha256") == file_digest(scope / "summary.json")
                    and marker.get("report", {}).get("path") == "report.html"):
                verify_file(scope, marker["report"])
                reuse = True
        if frozen:
            if not reuse or any(file_digest(scope / name) != descriptor["sha256"]
                                for name, descriptor in frozen["files"].items()):
                raise ValueError("The selected delivery's original report bytes changed; "
                                 "reopen that original archive to recover them")
    if not reuse:
        renderer._report(workspace.project["id"], experiment_id)
    summary = experiments.read_summary(workspace, experiment_id)
    if summary is None or summary["state"] != "complete":
        raise ValueError("The completed native experiment requires its original summary")
    return {"experiment_id": experiment_id, "state": summary["state"],
            "counts": summary["counts"], "progress": summary["progress"],
            "files": {name: {"path": str(scope / name), "sha256": file_digest(scope / name)}
                      for name in ("summary.json", "results.csv", "report.html")}}


def independent_reopen(application, workspace_path, expected):
    program = (
        "import json,sys\n"
        "sys.path.insert(0,sys.argv[1])\n"
        "from pathlib import Path\n"
        "from model.workspace import Workspace\n"
        "from model import management_cases,experiments\n"
        "from model.common import canonical,file_digest,digest\n"
        "def require(ok,label):\n"
        " if not ok: raise ValueError(label)\n"
        "expected=json.load(sys.stdin)\n"
        "ws=Workspace(Path(sys.argv[2]))\n"
        "require(ws.project['id']==expected['workspace_id'],'Workspace identity')\n"
        "record=management_cases.inspect(ws,expected['management_case_id'])\n"
        "require(digest(record)==expected['management_record_sha256'],'Management source and profiles')\n"
        "for item in expected['experiments']:\n"
        " summary=experiments.read_summary(ws,item['experiment_id'])\n"
        " require(summary and summary['state']=='complete','Complete native summary')\n"
        " scope=ws.root/'experiments'/item['experiment_id']\n"
        " for name,value in item['files'].items():\n"
        "  require(file_digest(scope/name)==value['sha256'],'Original report bytes: '+name)\n"
        " for row in summary['rows']:\n"
        "  if row['state']=='complete':\n"
        "   require(ws.inspect_run(row['run_id'])['state']=='complete','Native run')\n"
        "   require(ws.inspect_run(row['baseline_run_id'])['state']=='complete','Paired baseline')\n"
        "print(json.dumps({'state':'reopened','workspace_id':ws.project['id'],"
        "'management_case_id':record['id'],'experiments':len(expected['experiments'])}))\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", program, str(application), str(workspace_path)],
        input=json.dumps(expected, allow_nan=False), text=True,
        cwd=application, capture_output=True, check=True)
    return json.loads(result.stdout)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--prepared", type=Path, required=True,
                        help="Directory returned by prepare_endale_pasture_cases.py --prepare")
    parser.add_argument("--baseline-run", required=True)
    parser.add_argument("--scenario", action="append", default=[],
                        help="Additional existing land-cover scenario; may be repeated")
    parser.add_argument("--source-run", action="append", default=[],
                        help="Existing original native source run in the selected design")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--execute", action="store_true",
                        help="Run the existing native engine, then reuse completed matched outputs")
    parser.add_argument("--deliver", action="store_true",
                        help="Export and independently reopen the full completed editable Workspace")
    args = parser.parse_args(argv)
    if args.deliver and not args.execute:
        parser.error("--deliver requires --execute; completed original runs are reused")
    workspace = Workspace(args.workspace)
    output = args.output.resolve()
    if any(output == root or root in output.parents for root in (workspace.root.resolve(), APP.resolve())):
        raise ValueError("Choose a course output directory outside both the original application and Workspace")
    if output == args.prepared.resolve():
        raise ValueError("Keep the prepared source folder and course output folder distinct")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".pasture-course.lock", blocking=False):
        record, binding, recipe, treatments = prepared_source(workspace, args.prepared.resolve())
        baseline = workspace.inspect_run(args.baseline_run)
        if baseline["state"] != "complete":
            raise ValueError("Select the completed original baseline run")
        selection = {"case_id": record["id"], "baseline_run_id": baseline["id"],
                     "scenario_ids": args.scenario}
        if args.source_run:
            selection["source_run_ids"] = args.source_run
        primary = management_cases.prepare_experiment(workspace, selection)
        course = {"schema": "upstate.published-pasture-course/v1",
                  "workspace_id": workspace.project["id"], "management_case_id": record["id"],
                  "management_record_sha256": digest(record), "source_binding": binding,
                  "primary_experiment_id": primary["id"],
                  "matched_landscape": baseline["selection"]["scenario_id"],
                  "matched_interpretation": "Within-endophyte fertilizer contrasts on the original "
                  "baseline landscape; other selected landscapes remain separate native cases.",
                  "published_treatments": list(treatments.values())}
        atomic_json(output / "course-selection.json", course, immutable=True)
        result = {**course, "state": primary["state"], "experiments": []}
        atomic_json(output / "course-result.json", result)
        if not args.execute:
            print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
            return 0
        renderer = report_writer(workspace)
        frozen_path = output / "export-selection.json"
        frozen_export = read_json(frozen_path) if frozen_path.exists() else None
        frozen_reports = {item["experiment_id"]: item for item in
                          frozen_export["course"]["experiments"]} if frozen_export else {}
        main_result = finish_experiment(workspace, primary["id"], renderer,
                                        frozen_reports=frozen_reports)
        result["experiments"].append(main_result)
        result["state"] = "matching_completed_treatments"
        atomic_json(output / "course-result.json", result)
        scenario_id = baseline["selection"]["scenario_id"]
        runs = {}
        for case in all_cases(workspace, primary["id"]):
            if case["state"] == "complete" and case["scenario_id"] == scenario_id:
                prior = runs.setdefault(case["profile_id"], case["run_id"])
                if prior != case["run_id"]:
                    raise ValueError("Choose one exact native source for each profile/landscape pair")
        for pair in recipe["comparisons"]:
            left, right = treatments[pair["baseline_key"]], treatments[pair["alternative_key"]]
            left_run, right_run = runs[left["profile_id"]], runs[right["profile_id"]]
            matched = experiments.prepare(workspace, {
                "title": "Published pasture / " + pair["name"],
                "reason": pair["interpretation"] + " Source: " + recipe["source"]["uri"] +
                          " / Table S4 / 2007-2009. Retained management design: " + record["id"],
                "baseline_run_id": left_run, "scenario_ids": [],
                "profile_ids": [right["profile_id"]], "axes": [], "design": "factorial",
                "source_run_ids": list(dict.fromkeys([left_run, right_run]))})
            paired = finish_experiment(workspace, matched["id"], renderer, completed_only=True,
                                       frozen_reports=frozen_reports)
            paired.update(comparison=pair, baseline_run_id=left_run, alternative_run_id=right_run)
            result["experiments"].append(paired)
            atomic_json(output / "course-result.json", result)
        result["state"] = "complete"
        atomic_json(output / "course-result.json", result)
        if args.deliver:
            expected = {"workspace_id": workspace.project["id"],
                        "management_case_id": record["id"],
                        "management_record_sha256": digest(record),
                        "experiments": result["experiments"]}
            export_selection = {"course": expected,
                                "application_sha256": portable.application_digest()}
            atomic_json(output / "export-selection.json", export_selection, immutable=True)
            archive = output / "editable-pasture-project.zip"
            archive_receipt = output / "archive-result.json"
            if archive.exists():
                if not archive_receipt.exists():
                    # Recover a completed original archive after an interrupted receipt write.
                    manifest = portable.inspect_archive(archive, verify=True)
                    if manifest["project"] != workspace.project:
                        raise ValueError("The existing archive belongs to another Workspace")
                    archived_app = {
                        name[len("application/"):]: {key: item[key] for key in ("bytes", "sha256")}
                        for name, item in manifest["members"].items()
                        if name.startswith("application/")}
                    if digest(archived_app) != export_selection["application_sha256"]:
                        raise ValueError("The existing archive contains another application edition")
                    wanted = {
                        "workspace/management-cases/" + record["id"] + ".json":
                        file_digest(workspace.root / "management-cases" / (record["id"] + ".json"))}
                    for item in expected["experiments"]:
                        for name, descriptor in item["files"].items():
                            wanted["workspace/experiments/" + item["experiment_id"] + "/" + name] = descriptor["sha256"]
                    if any(manifest["members"].get(name, {}).get("sha256") != sha
                           for name, sha in wanted.items()):
                        raise ValueError("The existing archive differs from the selected completed course")
                    recovered = {"schema": manifest["schema"], "project_id": workspace.project["id"],
                                 "path": str(archive), "bytes": archive.stat().st_size,
                                 "sha256": file_digest(archive), "members": len(manifest["members"]),
                                 "selection": manifest["selection"], "receipt_recovered": True}
                    atomic_json(archive_receipt, recovered, immutable=True)
                saved = read_json(archive_receipt)
                if file_digest(archive) != saved["sha256"]:
                    raise ValueError("The retained project archive changed")
            else:
                saved = portable.backup(workspace, archive)
                atomic_json(archive_receipt, saved, immutable=True)
            receiving = output / "reopened-project"
            restored = (portable.resume_restore(archive, receiving,
                        expected_archive_sha256=saved["sha256"]) if receiving.exists()
                        else portable.restore(archive, receiving))
            reopened = independent_reopen(
                receiving / "application", receiving / "workspace", expected)
            result["delivery"] = {"archive": saved, "receiving": restored,
                                  "independent_reopen": reopened}
            atomic_json(output / "course-result.json", result)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
