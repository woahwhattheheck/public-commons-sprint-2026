#!/usr/bin/env python3
"""One resumable original-case regional source/profile/native/cold-receiving operation.

Uses the existing scientific Workspace and actual input definition. It creates no
synthetic observations, source coefficients or model results. Optional native
execution remains the original model.experiments runner.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--definition", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--baseline-run")
    parser.add_argument("--scenario", action="append", default=[])
    parser.add_argument("--execute-native", action="store_true")
    parser.add_argument("--browser-result", type=Path)
    args = parser.parse_args(argv)
    app = args.application.resolve(strict=True)
    root = args.output.resolve()
    workspace_root = args.workspace.resolve(strict=True)
    if (root.is_relative_to(app) or app.is_relative_to(root)
            or root.is_relative_to(workspace_root) or workspace_root.is_relative_to(root)):
        raise ValueError("Keep original application, scientific Workspace and operation output disjoint")
    if args.execute_native and not args.baseline_run:
        raise ValueError("Native execution requires the actual original completed baseline run")
    sys.path.insert(0, str(app))
    from model.workspace import Workspace
    from model import regional_biophysical as library, portable
    from model.common import atomic_bytes, atomic_json, canonical, digest, file_digest, held, read_json
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".regional-course.lock", blocking=False):
        workspace = Workspace(workspace_root)
        raw = args.definition.resolve(strict=True).read_bytes()
        supplied = json.loads(raw)
        definition = supplied
        if supplied.get("schema") == "upstate.regional-biophysical-working/v1":
            if supplied["project_id"] != workspace.project["id"]:
                raise ValueError("The actual working file belongs to another original project")
            definition = supplied["definition"]
        selected_source = {}
        for name in ("model/regional_biophysical.py", "operator/regional_biophysical.py",
                     "operator/extensions/regional-biophysical.json",
                     "operator/web/regional_biophysical.mjs", "operator/web/regional_biophysical.css",
                     "source_tools/regional_biophysical.py", "source_tools/regional_biophysical_course.py",
                     "source_tools/regional_biophysical_browser.mjs",
                     "model/experiment_profiles.py", "model/biophysical_evidence.py",
                     "model/profiles.py", "model/workspace.py", "model/portable.py",
                     "source/regional-biophysical-20261013/library.json",
                     "source/regional-biophysical-20261013/albright-2023-biophysical.csv",
                     "source/regional-biophysical-20261013/study-definitions.json"):
            path = app / name
            selected_source[name] = {"bytes": path.stat().st_size, "sha256": file_digest(path)}
            atomic_bytes(root / "source" / name, path.read_bytes(), immutable=True)
        binding = {"schema": "upstate.regional-biophysical-course-input/v1",
                   "operation_id": args.operation_id, "workspace": str(workspace_root),
                   "project": workspace.project, "application": str(app),
                   "definition_sha256": hashlib.sha256(raw).hexdigest(),
                   "definition_bytes": len(raw), "definition": definition,
                   "baseline_run_id": args.baseline_run, "scenario_ids": args.scenario,
                   "execute_native": args.execute_native, "browser_result_sha256": file_digest(args.browser_result) if args.browser_result else None,
                   "sources": selected_source}
        atomic_bytes(root / "original-definition.json", raw, immutable=True)
        atomic_json(root / "input.json", binding, immutable=True)
        state_path = root / "state.json"
        state = read_json(state_path) if state_path.exists() else {
            "schema": "upstate.regional-biophysical-course/v1", "operation_id": args.operation_id,
            "input_sha256": digest(binding), "stages": {}}
        if state["input_sha256"] != digest(binding):
            raise ValueError("Resume the same original course input and complete source cohort")
        def stage(name, value):
            state["stages"][name] = value
            atomic_json(state_path, state)
        original_profile = workspace._get("profiles", definition["baseline_profile_id"])
        original_path, original_source = workspace.source_file(
            original_profile["source_collection_id"], original_profile["biophysical_source_id"])
        original_bytes = original_path.read_bytes()
        try:
            proposed = library.preview(workspace, definition)
            atomic_json(root / "preview.json", proposed, immutable=True)
            prepared = library.prepare(workspace, {"definition": definition,
                                                  "preview_sha256": proposed["preview_sha256"]})
            repeated = library.prepare(workspace, {"definition": definition,
                                                  "preview_sha256": proposed["preview_sha256"]})
            if canonical(prepared) != canonical(repeated):
                raise ValueError("The exact original preparation did not reopen its saved result")
            stage("prepared", {"id": prepared["id"], "profile_id": prepared["profile_id"],
                               "evidence_id": prepared["evidence_id"]})
            files = library.export(workspace, prepared["id"])
            actual = {}
            for label, path in files.items():
                body = path.read_bytes()
                atomic_bytes(root / "artifacts" / path.name, body, immutable=True)
                actual[label] = {"path": "artifacts/" + path.name, "bytes": len(body),
                                 "sha256": hashlib.sha256(body).hexdigest()}
            stage("exports", actual)
            if args.browser_result:
                browser = read_json(args.browser_result)
                if (browser.get("schema") != "upstate.regional-biophysical-browser/v1"
                        or browser.get("project_id") != workspace.project["id"]
                        or browser.get("selection_id") != prepared["id"]):
                    raise ValueError("The real browser operated a different project/selection")
                for label, path in files.items():
                    received = args.browser_result.parent / browser["downloads"][label]["path"]
                    if received.read_bytes() != path.read_bytes():
                        raise ValueError("Browser-visible download differs from the original retained export: " + label)
                atomic_json(root / "browser-result.json", browser, immutable=True)
                stage("browser", {"state": "actual browser/download source parity", "selection_id": prepared["id"]})
            if args.baseline_run:
                experiment = library.prepare_experiment(workspace, {
                    "selection_id": prepared["id"], "baseline_run_id": args.baseline_run,
                    "scenario_ids": args.scenario, "title": definition["title"] + " regional source experiment",
                    "reason": definition["reason"]})
                experiment_path = root / "native-experiment.json"
                if experiment_path.exists():
                    retained = read_json(experiment_path)
                    if any(canonical(retained.get(key)) != canonical(experiment.get(key))
                           for key in ("id", "workspace_id", "selection")):
                        raise ValueError("The resumed native experiment changed its original source selection")
                else:
                    atomic_json(experiment_path, experiment, immutable=True)
                atomic_json(root / "native-experiment-current.json", experiment)
                stage("native_prepared", {"experiment_id": experiment["id"]})
                if args.execute_native:
                    from model import experiments, study_report
                    experiments.execute(workspace, experiment["id"])
                    summary = experiments.read_summary(workspace, experiment["id"])
                    atomic_json(root / "native-summary.json", summary)
                    stage("native_results", summary)
                    report = study_report.build(workspace, experiment["id"])
                    atomic_json(root / "native-report.json", report)
                    stage("native_report", report)
            if workspace._get("profiles", original_profile["id"]) != original_profile or original_path.read_bytes() != original_bytes:
                raise ValueError("The original baseline profile or exact table bytes changed")
            archive = root / "Regional_Biophysical_Complete_Workspace.zip"
            if archive.exists():
                manifest = portable.inspect_archive(archive)
                if manifest["project"] != workspace.project:
                    raise ValueError("The retained complete archive belongs to another original project")
                # Existing archive must contain this exact saved immutable selection.
                name = "workspace/" + library.KIND + "/" + prepared["id"] + ".json"
                if name not in manifest["members"]:
                    raise ValueError("An earlier archive does not contain this selected operation")
            else:
                workspace.backup(archive)
                manifest = portable.inspect_archive(archive)
            stage("archive", {"path": archive.name, "bytes": archive.stat().st_size, "sha256": file_digest(archive)})
            receiver = root / "cold-receiver"
            if receiver.exists():
                received = portable.resume_restore(archive, receiver, expected_archive_sha256=file_digest(archive))
            else:
                received = portable.restore(archive, receiver)
            cold = Workspace(receiver / "workspace")
            cold_record = library.inspect(cold, prepared["id"])
            if canonical(cold_record) != canonical(prepared):
                raise ValueError("Cold receiving changed the actual source selection")
            cold_files = library.export(cold, prepared["id"])
            for label in files:
                if cold_files[label].read_bytes() != files[label].read_bytes():
                    raise ValueError("Cold receiving changed a complete original attachment")
            library.verify_all(cold)
            stage("cold_received", received)
            result = {"schema": "upstate.regional-biophysical-course-result/v1",
                      "operation_id": args.operation_id, "project_id": workspace.project["id"],
                      "selection_id": prepared["id"], "profile_id": prepared["profile_id"],
                      "baseline_profile_id": original_profile["id"], "evidence_id": prepared["evidence_id"],
                      "native_execution_requested": args.execute_native,
                      "native_results": state["stages"].get("native_results"),
                      "browser_observed": "browser" in state["stages"],
                      "artifacts": actual, "archive": state["stages"]["archive"],
                      "cold_receiver": str(receiver), "source_preserved": True}
            atomic_json(root / "result.json", result, immutable=True)
            state["state"] = "complete";state.pop("error", None);atomic_json(state_path, state)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0
        except BaseException as exc:
            state["state"] = "interrupted"
            state["error"] = {"type": type(exc).__name__, "message": str(exc)}
            atomic_json(state_path, state)
            raise

if __name__ == "__main__":
    raise SystemExit(main())
