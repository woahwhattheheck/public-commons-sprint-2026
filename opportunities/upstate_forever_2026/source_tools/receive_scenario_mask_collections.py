"""Continue an owned native scenario course with masks from retained editions.

The caller supplies the complete authored scenario and an existing completed
baseline. This module creates no source data, queue, browser or provider client.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import subprocess
import zipfile

APP = Path(__file__).resolve().parents[1]
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from model.common import (atomic_bytes, atomic_json, canonical, digest, file_digest,
                          held, identifier, read_json, verify_file, _sync_directory)
from model.workspace import Workspace
from model.model_selection import run_models
from model.scenario_mask_sources import ScenarioMaskSources, mask_collection, mask_source_id
from model.scenario_footprint import preview_run, get_footprint
from model import portable, study_transfer

INPUT_SCHEMA = "upstate.scenario-mask-collections-receiving-input/v1"
RESULT_SCHEMA = "upstate.scenario-mask-collections-receiving/v1"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def pin(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), "Retain an ordinary output file: " + str(path))
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": file_digest(path)}


def retained_json(path, value):
    atomic_json(path, value, immutable=True)
    require(read_json(path) == value, "The complete retained record differs: " + str(path))
    return value


def safe_member(root, name, *, existing=True):
    part = portable.member_name(name)
    root = Path(root).resolve()
    current = root
    for piece in part.parts:
        current = current / piece
        require(not current.is_symlink(), "A retained member is an alias: " + name)
    require(current.resolve(strict=existing).is_relative_to(root),
            "A retained member leaves its original directory: " + name)
    if existing:
        require(current.is_file(), "A retained member is absent: " + name)
    return current


def source_pairs(workspace, scenario):
    resolver = ScenarioMaskSources(workspace, scenario)
    pairs = []
    for index, patch in enumerate(scenario["patches"]):
        collection_id, source_id = mask_collection(scenario, patch), mask_source_id(patch)
        body_path, entry = resolver(source_id, collection_id)
        collection = workspace._get("sources", collection_id)
        # The whole collection identity includes its original manifest and every
        # retained body; the selected pair separately preserves complete metadata.
        pairs.append({"patch_index": index, "source_collection_id": collection_id,
                      "source_id": source_id, "explicit": "source_collection_id" in patch,
                      "patch": copy.deepcopy(patch), "entry": copy.deepcopy(entry),
                      "collection": copy.deepcopy(collection)})
        for body in [entry["body"], *entry.get("companions", [])]:
            verify_file(workspace.root, {"path": body["object"], "bytes": body["bytes"],
                                         "sha256": body["sha256"]})
    return pairs


def validate_input(workspace, supplied):
    require(isinstance(supplied, dict) and supplied.get("schema") == INPUT_SCHEMA,
            "Supply the complete authored scenario-mask receiving input")
    require(set(supplied).issubset({"schema", "operation_id", "project_id", "baseline_run_id",
                                  "scenario", "reuse_source_run_ids", "source_revision"}),
            "Unknown receiving input field")
    require(isinstance(supplied.get("operation_id"), str) and supplied["operation_id"].strip(),
            "Retain the original receiving operation ID")
    require(supplied.get("project_id") == workspace.project["id"],
            "Select the original supplied scientific project")
    baseline = workspace.inspect_run(identifier(supplied.get("baseline_run_id")))
    require(baseline.get("state") == "complete", "Complete the original selected baseline first")
    baseline_scenario = workspace._get("scenarios", baseline["selection"]["scenario_id"])
    require(baseline_scenario.get("kind") == "baseline",
            "Select the original unchanged land-cover baseline")
    authored = supplied.get("scenario")
    require(isinstance(authored, dict) and authored.get("kind") == "landcover",
            "Supply the complete scientist-authored land-cover scenario")
    from model.profiles import scenario_spec
    scenario_spec(authored)
    pairs = source_pairs(workspace, authored)
    require(len({row["source_collection_id"] for row in pairs}) >= 2,
            "This continuation requires authored masks from at least two actual retained editions")
    reuse = supplied.get("reuse_source_run_ids", [])
    require(isinstance(reuse, list) and len(reuse) == len(set(reuse)),
            "Retain a unique ordered list of original reuse runs")
    for key in reuse:
        candidate = workspace.inspect_run(identifier(key))
        require(candidate.get("state") == "complete", "Reuse only an actual completed native run")
    return baseline, pairs


def verify_study_members(archive_path, receiving, manifest):
    """Open every literal archived member and its independently restored bytes."""
    destination = Path(receiving["directory"])
    with zipfile.ZipFile(archive_path) as archive:
        for name, row in manifest["members"].items():
            target = safe_member(destination, name)
            require(target.stat().st_size == row["bytes"] and file_digest(target) == row["sha256"],
                    "A complete restored Study member differs: " + name)
            with archive.open(name) as source:
                checksum, count = hashlib.sha256(), 0
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    checksum.update(block)
                    count += len(block)
                require(count == row["bytes"] and checksum.hexdigest() == row["sha256"],
                        "A literal Study ZIP member differs: " + name)



def cold_verify(application, workspace_path, expected_path, output):
    """Start the restored application's own Python modules in an independent process."""
    application = Path(application).resolve(strict=True)
    script = """
import json, pathlib, sys
app, root, expectation = map(pathlib.Path, sys.argv[1:4])
sys.path.insert(0, str(app))
from model.workspace import Workspace
from model.scenario_footprint import get_footprint
from model.study_transfer import verify_received_studies
from model.common import verify_file
expected = json.loads(expectation.read_text(encoding='utf-8'))
ws = Workspace(root)
assert ws.project == expected['project'], 'Cold original project differs'
assert ws._get('scenarios', expected['scenario']['id']) == expected['scenario'], 'Cold scenario differs'
for row in [expected['baseline'], expected['run']]:
    assert ws.inspect_run(row['id']) == row, 'Cold complete run differs'
assert get_footprint(ws, expected['footprint']['id']) == expected['footprint'], 'Cold footprint differs'
for row in expected['source_pairs']:
    assert ws._get('sources', row['source_collection_id']) == row['collection'], 'Cold original source collection differs'
    path, entry = ws.source_file(row['source_collection_id'], row['source_id'])
    assert {**entry, 'source_collection_id':row['source_collection_id']} == row['entry'], 'Cold original selected source differs'
    for body in [entry['body'], *entry.get('companions', [])]:
        verify_file(ws.root, {'path': body['object'], 'bytes': body['bytes'], 'sha256': body['sha256']})
comparison = json.loads((ws.root/'comparisons'/expected['comparison']['id']/'comparison.json').read_text(encoding='utf-8'))
assert comparison == expected['comparison'], 'Cold original comparison differs'
verify_received_studies(ws)
print(json.dumps({'schema':'upstate.scenario-mask-cold-reopen/v1',
                  'project_id':ws.project['id'], 'scenario_id':expected['scenario']['id'],
                  'run_id':expected['run']['id'], 'footprint_id':expected['footprint']['id'],
                  'comparison_id':comparison['id'], 'source_pair_count':len(expected['source_pairs']),
                  'application':str(app), 'workspace':str(ws.root)}, sort_keys=True))
"""
    attempt = Path(tempfile.mkdtemp(prefix="cold-attempt-", dir=output))
    atomic_bytes(attempt / "verify.py", script.encode("utf-8"), immutable=True)
    command = [sys.executable, "-I", str(attempt / "verify.py"), str(application),
               str(Path(workspace_path).resolve()), str(Path(expected_path).resolve())]
    completed = subprocess.run(command, cwd=application, capture_output=True, check=False)
    atomic_bytes(attempt / "stdout.txt", completed.stdout, immutable=True)
    atomic_bytes(attempt / "stderr.txt", completed.stderr, immutable=True)
    retained_json(attempt / "process.json", {"command": command, "returncode": completed.returncode})
    require(completed.returncode == 0,
            "The restored application's cold verification failed; retain " + str(attempt))
    result = json.loads(completed.stdout)
    retained_json(Path(output) / "cold-reopen.json", result)
    return result



def reopen_completed(workspace, supplied, identity, output, result):
    """Verify a completed original edition without rerunning current scientific code."""
    require(result.get("schema") == RESULT_SCHEMA and
            all(result.get(key) == value for key, value in identity.items() if key != "schema") and
            result.get("output_directory") == str(output),
            "The completed result belongs to another input, operation or output")
    for filename, value in (("scenario.json", result["scenario"]),
                            ("baseline.json", result["baseline"]), ("run.json", result["run"]),
                            ("footprint.json", result["footprint"]),
                            ("comparison.json", result["comparison"]),
                            ("source-pairs.json", result["source_pairs"]),
                            ("prepared.json", result["prepared"]),
                            ("study-manifest.json", result["study"]["manifest"]),
                            ("study-receipt.json", result["study"]["receipt"]),
                            ("study-archive.json", result["study"]["archive"])):
        require(read_json(output / filename) == value,
                "The retained complete output record changed: " + filename)
    require(workspace._get("scenarios", result["scenario"]["id"]) == result["scenario"],
            "The original completed scenario changed")
    for run in (result["baseline"], result["run"]):
        require(workspace.inspect_run(run["id"]) == run, "The original completed run changed")
    require(get_footprint(workspace, result["footprint"]["id"]) == result["footprint"],
            "The original completed footprint changed")
    require(source_pairs(workspace, result["scenario"]) == result["source_pairs"],
            "The original completed source bindings changed")
    require(read_json(workspace.root / "comparisons" / result["comparison"]["id"] /
                      "comparison.json") == result["comparison"], "The original comparison changed")
    archive_path = output / "scenario-study.zip"
    require(pin(archive_path) == result["study"]["archive"],
            "The complete original native Study ZIP changed")
    inspected = study_transfer.inspect_transfer_archive(archive_path, verify=True)
    require(inspected["manifest"] == result["study"]["manifest"] and
            inspected["study"] == result["study"]["receipt"],
            "The complete original native Study identity changed")
    destination = output / "restored-study"
    require(result["restored_directory"] == str(destination) and
            result["restored_workspace"] == str(destination / "workspace") and
            result["restored_application"] == str(destination / "application"),
            "The completed restore belongs to another receiving directory")
    receiving = (portable.resume_restore(archive_path, destination,
                                         expected_archive_sha256=result["study"]["archive"]["sha256"])
                 if destination.exists() else portable.restore(archive_path, destination))
    verify_study_members(archive_path, receiving, inspected["manifest"])
    expectation = {"project": workspace.project, "scenario": result["scenario"],
                   "baseline": result["baseline"], "run": result["run"],
                   "footprint": result["footprint"], "source_pairs": result["source_pairs"],
                   "comparison": result["comparison"]}
    require(read_json(output / "cold-expected.json") == expectation,
            "The cold receiving expectation changed")
    cold = cold_verify(receiving["application"], receiving["workspace"],
                       output / "cold-expected.json", output)
    require(cold == result["cold_reopen"], "The original cold receiving result changed")
    return result


def receive_scenario_mask_collections(workspace, supplied, output_directory):
    """Callable continuation using one supplied Workspace and original native APIs.

    Retries select the same immutable scenario/run/footprint/comparison, original
    archive and receiving directory. The complete input is retained before the
    first native write. The owning caller retains its existing operation lock.
    """
    if not isinstance(workspace, Workspace):
        workspace = Workspace(workspace)
    output = Path(output_directory).absolute()
    require(not output.is_symlink(), "Select an ordinary receiving output directory")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".scenario-mask-receiving.lock", blocking=False):
        baseline, pairs = validate_input(workspace, supplied)
        supplied = copy.deepcopy(supplied)
        identity = {"schema": INPUT_SCHEMA, "operation_id": supplied["operation_id"],
                    "project_id": workspace.project["id"], "input_sha256": digest(supplied)}
        retained_json(output / "input.json", supplied)
        retained_json(output / "identity.json", identity)
        retained_json(output / "baseline.json", baseline)
        retained_json(output / "source-pairs.json", pairs)
        complete_path = output / "result.json"
        if complete_path.exists():
            return reopen_completed(workspace, supplied, identity, output, read_json(complete_path))
        implementation = {name: file_digest(APP / name) for name in (
            "model/workspace.py", "model/profiles.py", "model/native.py",
            "model/scenario_footprint.py", "model/scenario_mask_sources.py",
            "model/scenario_footprint_study.py", "model/study_transfer.py", "model/portable.py")}
        retained_json(output / "implementation.json", implementation)

        scenario = workspace.save_scenario(supplied["scenario"])
        if supplied["scenario"].get("id"):
            require(scenario["id"] == supplied["scenario"]["id"],
                    "The authored scenario differs from its supplied immutable identity")
        retained_json(output / "scenario.json", scenario)
        selection = {"grid_id": baseline["selection"]["grid_id"],
                     "profile_id": baseline["selection"]["profile_id"],
                     "scenario_id": scenario["id"], "models": list(run_models(baseline))}
        retained_json(output / "run-selection.json", selection)
        prepared = workspace.prepare_run(selection)
        require(prepared["id"] != baseline["id"], "Select a distinct authored alternative")
        retained_json(output / "run-identity.json",
                      {"id": prepared["id"], "selection": prepared["selection"]})
        prepared_path = output / "prepared.json"
        if prepared_path.exists():
            first_prepared = read_json(prepared_path)
            require(first_prepared["id"] == prepared["id"] and
                    first_prepared["selection"] == prepared["selection"],
                    "The original prepared run checkpoint differs")
        else:
            retained_json(prepared_path, prepared)
        footprint = preview_run(workspace, prepared["id"])
        require(footprint["run_id"] == prepared["id"] and
                footprint["selection"] == prepared["selection"],
                "The native preview belongs to another selected run")
        retained_json(output / "footprint.json", footprint)

        # Both reuse and execution belong to the original native implementation.
        workspace.run(prepared["id"], reuse_source_run_ids=supplied.get("reuse_source_run_ids"))
        run = workspace.inspect_run(prepared["id"])
        require(run["state"] == "complete", "Original native execution is not complete")
        retained_json(output / "run.json", run)
        comparison = workspace.compare_runs([baseline["id"], run["id"]])
        retained_json(output / "comparison.json", comparison)
        require(workspace.inspect_run(baseline["id"]) == baseline,
                "The original completed baseline changed during the continuation")
        require(source_pairs(workspace, scenario) == pairs,
                "A complete original source pair changed during native receiving")

        study_selection = {"schema": study_transfer.SELECTION_SCHEMA,
                           "title": scenario["title"] + " — complete native scenario study",
                           "roots": [{"kind": "runs", "id": baseline["id"]},
                                     {"kind": "runs", "id": run["id"]}],
                           "include_related_results": True}
        retained_json(output / "study-selection.json", study_selection)
        archive_path = output / "scenario-study.zip"
        study_transfer.export_study(workspace, archive_path, study_selection)
        inspected = study_transfer.inspect_transfer_archive(archive_path, verify=True)
        require(inspected["study"]["identity"]["selection"] ==
                study_transfer.normalise(study_selection), "Original Study selection differs")
        require(inspected["manifest"]["project"] == workspace.project,
                "Study belongs to another original project")
        retained_json(output / "study-manifest.json", inspected["manifest"])
        retained_json(output / "study-receipt.json", inspected["study"])
        archive_pin = pin(archive_path)
        retained_json(output / "study-archive.json", archive_pin)

        destination = output / "restored-study"
        receiving = (portable.resume_restore(archive_path, destination,
                                             expected_archive_sha256=archive_pin["sha256"])
                     if destination.exists() else portable.restore(archive_path, destination))
        require(receiving["archive_sha256"] == archive_pin["sha256"],
                "Original restore received another archive")
        verify_study_members(archive_path, receiving, inspected["manifest"])
        restored = Workspace(receiving["workspace"])
        require(restored.project == workspace.project, "Restored native project differs")
        require(restored._get("scenarios", scenario["id"]) == scenario,
                "Complete authored scenario changed in Study restoration")
        require(restored.inspect_run(baseline["id"]) == baseline and
                restored.inspect_run(run["id"]) == run, "Full native run restoration differs")
        require(source_pairs(restored, scenario) == pairs,
                "Study did not retain complete mask source collections and companions")
        require(read_json(restored.root / "comparisons" / comparison["id"] / "comparison.json") ==
                comparison, "Original comparison is missing from selected Study")
        require(get_footprint(restored, footprint["id"]) == footprint,
                "Complete original footprint is absent or changed in the native Study")
        study_transfer.verify_received_studies(restored)
        expectation = {"project": workspace.project, "scenario": scenario, "baseline": baseline,
                       "run": run, "footprint": footprint, "source_pairs": pairs,
                       "comparison": comparison}
        retained_json(output / "cold-expected.json", expectation)
        cold = cold_verify(receiving["application"], restored.root,
                           output / "cold-expected.json", output)

        result = {"schema": RESULT_SCHEMA, **identity, "scenario": scenario,
                  "baseline": baseline, "baseline_run_id": baseline["id"], "run": run,
                  "prepared": read_json(output / "prepared.json"), "footprint": footprint,
                  "comparison": comparison, "source_pairs": pairs,
                  "study": {"archive": archive_pin, "receipt": inspected["study"],
                            "manifest": inspected["manifest"]},
                  "restored_workspace": str(restored.root),
                  "restored_application": receiving["application"],
                  "restored_directory": receiving["directory"],
                  "receiving": {k: v for k, v in receiving.items() if k != "reused_completed_output"},
                  "output_directory": str(output), "cold_reopen": cold}
        result["schema"] = RESULT_SCHEMA
        retained_json(output / "result.json", result)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    result = receive_scenario_mask_collections(
        Workspace(args.workspace), read_json(args.input), args.output)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
