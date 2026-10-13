#!/usr/bin/env python3
"""Run resumable, source-bound Gura parameter studies in the native application."""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import csv
import html
import io
import json
import logging
import os
from pathlib import Path

import stat
import subprocess
import time
import uuid
import sys
import traceback

EDITION = "gura-original-parameter-suite/1"
NDR_GUIDE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html"
SDR_GUIDE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html"
SCOPES = {"ndr": ("ndr",), "sdr": ("sdr",), "both": ("ndr", "sdr")}
PURPOSE = (
    "Evaluate explicit native parameter and routing choices on the original Gura study. "
    "Retain the release inputs, coefficient table, original watershed, 15 m grid and "
    "zero added buffer. Report each completed case's physical export and paired-cell "
    "coverage against the original parameter values for the same landscape."
)


def axes_for(scope):
    active = SCOPES[scope]
    result = []
    for model in active:
        result.append({
            "name": model.upper() + " connectivity shape",
            "parameters": [model + ".k_param"], "values": [1, 2],
            "reason": (
                "Compare explicit connectivity-shape values 1 and 2. The official "
                "guide illustrates this response; the original Gura reference is 2."
            ),
            "references": [NDR_GUIDE if model == "ndr" else SDR_GUIDE],
        })
    if "sdr" in active:
        result.append({
            "name": "SDR connectivity midpoint",
            "parameters": ["sdr.ic_0_param"], "values": [0.5, 2],
            "reason": (
                "Compare explicit sediment-connectivity midpoint values 0.5 and 2 "
                "from the documented delivery-ratio response illustration. Retain "
                "the original Gura midpoint 0.5 in the reference case."
            ),
            "references": [SDR_GUIDE, NDR_GUIDE],
        })
    result.append({
        "name": "Native flow routing",
        "parameters": [model + ".flow_dir_algorithm" for model in active],
        "values": ["mfd", "d8"],
        "reason": (
            "Compare the two routing algorithms supported by the original 3.20.0 "
            "models. In the combined study apply the same algorithm to both models. "
            "The archived Gura MFD argument is preserved and executed as lowercase mfd."
        ),
        "references": [NDR_GUIDE if model == "ndr" else SDR_GUIDE for model in active],
    })
    return result


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--application", type=Path, required=True)
    p.add_argument("--workspace", type=Path, required=True)
    p.add_argument("--inputs", type=Path, required=True,
                   help="Original release NDR.zip and SDR.zip directory")
    p.add_argument("--baseline-run-id",
                   help="Existing completed original both-model Gura baseline")
    p.add_argument("--scopes", choices=tuple(SCOPES), nargs="+",
                   default=["ndr", "sdr", "both"])
    p.add_argument("--design", choices=("factorial", "one-at-a-time"), default="factorial")
    p.add_argument("--evaluation-run-id", action="append", default=[],
                   help="Also study a retained original-profile portfolio evaluation; repeatable")
    p.add_argument("--include-planning-evaluation", action="store_true",
                   help="Also use the actual evaluation in gura-planning-state.json")
    p.add_argument("--difference-maps", action="store_true",
                   help="Retain per-case difference rasters through the native comparison API")
    p.add_argument("--isolate-native-cases", action="store_true",
                   help="Execute each unfinished native run in a fresh interpreter; retain the exact cases and stage cache")
    p.add_argument("--archive", type=Path,
                   help="Copy the completed/partial portable suite ZIP to this external path")
    return p


def _copy_exports(workspace, directory, state, *, exports=None, build_archive=True, progress=None):
    from model.common import atomic_bytes, atomic_json, describe_file, digest, read_json
    from model.parameter_exports import write_archive
    from model.parameter_suite_exports import SuiteExports
    exports = exports or SuiteExports(workspace, directory, state["id"])
    results, outputs, studies = [], {}, []
    for item in state["studies"]:
        key = item.get("study_id")
        if not key:
            studies.append(dict(item))
            continue
        current, exported, study_rows = exports.retain(item)
        item.update(state=current["state"], progress=current["progress"],
                    cases=[{name: case[name] for name in ("id", "run_id", "profile_id", "state")}
                           for case in current["cases"]])
        item["artifacts"] = exported
        item["export_layout"] = exports.layout(key)
        outputs.update({key + "/" + name: value for name, value in exported.items()})
        for row in study_rows:
            results.append({
                "study_id": key, "model_scope": item["model_scope"],
                "landscape_run_id": item["landscape_run_id"],
                "landscape": item["landscape"], **row,
            })
        studies.append(dict(item))
    result = {
        "schema": "upstate.gura-parameter-suite-results/v1",
        "suite_id": state["id"], "workspace_id": workspace.project["id"],
        "selection": state["selection"], "state": state["state"],
        "studies": studies, "rows": results, "export_cache": exports.progress(),
        "mass_basis": "Sum of retained annual mass per pixel after one native-rate area conversion.",
        "comparison_basis": "Each case minus its same-landscape original-parameter reference on paired valid cells.",
        "interpretation": (
            "Responses describe the explicitly selected native parameter/routing cases. "
            "Original baseline parameters, all case values, spatial support and source references are retained."
        ),
    }
    # Keep one truthful publication-time observation for identical scientific
    # contents. Live counters continue in state.packaging.cache, not in the
    # archive's identity on every retry.
    previous_path = directory / "results.json"
    if previous_path.is_file():
        try:
            previous = read_json(previous_path)
            scientific = lambda row: {key: value for key, value in row.items()
                                      if key != "export_cache"}
            if (isinstance(previous, dict)
                    and digest(scientific(previous)) == digest(scientific(result))
                    and isinstance(previous.get("export_cache"), dict)
                    and all(previous["export_cache"].get(key) == result["export_cache"].get(key)
                            for key in ("flat_studies", "nested_studies",
                                        "logical_bytes_selected", "logical_bytes_avoided"))):
                result["export_cache"] = previous["export_cache"]
        except (OSError, ValueError, TypeError):
            # A new original-source publication replaces an unreadable derived
            # snapshot; its scientific study records remain authoritative.
            pass
    atomic_json(directory / "results.json", result)
    fields = [
        "study_id", "model_scope", "landscape_run_id", "landscape",
        "case_id", "case", "run_id", "profile_id", "area_id", "area", "pollutant", "units",
        "baseline_mass", "case_mass", "change", "percent_change", "baseline_full_mass",
        "case_full_mass", "baseline_valid_cells", "case_valid_cells", "paired_valid_cells",
        "pixel_area_ha", "baseline_valid_area_ha", "case_valid_area_ha", "paired_area_ha",
        "support_changed", "overrides",
    ]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in results:
        writer.writerow({**row, "overrides": json.dumps(row["overrides"], sort_keys=True)})
    atomic_bytes(directory / "results.csv", output.getvalue().encode("utf-8"))
    escaped = lambda value: html.escape(str(value), quote=True)
    rows = []
    for item in studies:
        study_progress = item.get("progress", {})
        links = " ".join(
            '<a href="' + escaped(value["path"]) + '">' + escaped({"export_manifest": "Complete file manifest"}.get(name, name)) + "</a>"
            for name, value in item.get("artifacts", {}).items()
            if name in {"report", "csv", "archive", "export_manifest"})
        rows.append(
            "<tr><td>" + escaped(item["landscape"]) + "</td><td>" +
            escaped(item["model_scope"].upper()) + "</td><td>" + escaped(item["state"]) +
            "</td><td>" + escaped(study_progress.get("completed", 0)) + " / " +
            escaped(study_progress.get("total", 0)) + "</td><td>" + links + "<br><small>" +
            escaped(item.get("export_layout", {}).get("mode", "pending")) +
            " layout</small></td></tr>")
    report = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gura native parameter studies</title><style>
body{font:15px/1.5 system-ui,sans-serif;color:#202428;background:#fff;max-width:1200px;margin:32px auto;padding:0 24px}
h1{font-size:26px}h2{font-size:19px}table{width:100%;border-collapse:collapse}
td,th{padding:12px;text-align:left;border-bottom:1px solid #cdd1d4;vertical-align:top}
small{color:#515b63}a{color:#273844;margin-right:12px}code{overflow-wrap:anywhere}
</style><h1>Gura native parameter studies</h1><p>""" + escaped(PURPOSE) + (
        "</p><p><strong>Suite state: " + escaped(state["state"]) +
        "</strong> · Original grid: 15 m · Added watershed buffer: 0 m</p>" +
        '<p><a href="results.csv">All completed physical results (CSV)</a>' +
        '<a href="results.json">Selections, cases and coverage (JSON)</a>' +
        '<a href="selection.json">Original suite design</a></p>' +
        "<table><thead><tr><th>Landscape</th><th>Models</th><th>State</th>" +
        "<th>Completed native cases</th><th>Study exports</th></tr></thead><tbody>" +
        "".join(rows) + "</tbody></table><h2>Interpretation</h2><p>" +
        escaped(result["interpretation"]) + "</p><p>" + escaped(result["comparison_basis"]) +
        " " + escaped(result["mass_basis"]) + "</p><p>Open a study report to inspect " +
        "its quantities, native run IDs, actual coverage and explicit coefficients. " +
        "Every study includes the original parameter reference for its own landscape.</p>" +
        "<h2>Portable study contents</h2><p>Flat studies carry their complete scientific files " +
        "at the original relative paths. Nested studies retain their complete study ZIP " +
        "when that layout is smaller. Open the file manifest for exact member hashes. " +
        "Both layouts preserve native arguments and aggregation history.</p><p>" +
        escaped(result["export_cache"]["logical_bytes_avoided"]) +
        " logical bytes of duplicate or redundant nested contents avoided across " +
        escaped(result["export_cache"]["flat_studies"]) +
        " flat studies. These are file lengths, not measured filesystem space or compressed ZIP savings.</p>" +
        "<h2>Original methods</h2><p><a href=\"" + NDR_GUIDE + "\">InVEST 3.20 NDR guide</a>" +
        "<a href=\"" + SDR_GUIDE + "\">InVEST 3.20 SDR guide</a></p>" +
        "<small>Suite <code>" + escaped(state["id"]) + "</code></small></html>")
    atomic_bytes(directory / "index.html", report.encode("utf-8"))
    for name in ("selection.json", "results.json", "results.csv", "index.html"):
        outputs[name] = describe_file(directory, directory / name)
    manifest = {"schema": "commons.gura-parameter-suite-package/v1",
                "suite_id": state["id"], "workspace_id": workspace.project["id"],
                "state": state["state"], "files": outputs,
                "study_layouts": {item["study_id"]: item.get("export_layout", {})
                                  for item in studies if item.get("study_id")}}
    atomic_json(directory / "manifest.json", manifest)
    artifacts = {"report": describe_file(directory, directory / "index.html"),
                 "csv": describe_file(directory, directory / "results.csv"),
                 "results": describe_file(directory, directory / "results.json"),
                 "manifest": describe_file(directory, directory / "manifest.json")}
    state["packaging"] = {"state": "reports_ready", "cache": exports.progress(),
                          "studies": len(studies), "archive": "pending"}
    if build_archive:
        write_archive(
            directory, directory / "gura-parameter-suite.zip",
            [describe_file(directory, directory / "manifest.json"), *outputs.values()],
            progress=progress)
        artifacts["archive"] = describe_file(directory, directory / "gura-parameter-suite.zip")
        state["packaging"].update(state="complete", archive="current")
    exports.prune()
    state["packaging"]["cache"] = exports.progress()
    return artifacts



@contextlib.contextmanager
def _native_batch_lock(path):
    """Keep the existing batch lease in both parent and its active native child."""
    from model.native_execution import native_batch_lease
    with native_batch_lease(path) as fd:
        yield fd


def _supervisor_custody(workspace_root):
    """Keep the actual inherited operation lease through nested native children."""
    raw_fd = os.environ.get("GURA_OPERATION_LOCK_FD")
    raw_path = os.environ.get("GURA_OPERATION_LOCK_PATH")
    if raw_fd is None and raw_path is None:
        return ()
    if raw_fd is None or raw_path is None:
        raise ValueError("The supervised operation requires its inherited descriptor and lock path")
    try:
        fd = int(raw_fd)
    except (TypeError, ValueError) as error:
        raise ValueError("The inherited operation lock descriptor must be an integer") from error
    path = Path(raw_path)
    if fd < 3 or not path.is_absolute() or path.name != "operation.lock":
        raise ValueError("The supervised operation lock descriptor or path is invalid")
    inherited = os.fstat(fd)
    retained = os.stat(path, follow_symlinks=False)
    if (not stat.S_ISREG(inherited.st_mode) or not stat.S_ISREG(retained.st_mode)
            or (inherited.st_dev, inherited.st_ino) != (retained.st_dev, retained.st_ino)):
        raise ValueError("The inherited operation descriptor differs from its retained lock file")
    manifest = json.loads(path.with_name("operation.json").read_text(encoding="utf-8"))
    if (manifest.get("schema") != "commons.gura-complete-operation/v1"
            or manifest.get("workspace") != str(Path(workspace_root).resolve())):
        raise ValueError("The inherited operation lease belongs to a different scientific Workspace")
    # The inherited descriptor shares the supervisor's open-file description.
    # Reasserting its existing lock does not release or replace that lease.
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return (fd,)


_NATIVE_CASE_CHILD = r'''
import json, pathlib, sys
request = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
sys.path.insert(0, request["application"])
from model.workspace import Workspace
workspace = Workspace(request["workspace"])
result = workspace.run(request["run_id"], reuse_source_run_ids=request["reuse_source_run_ids"])
if result["id"] != request["run_id"] or result["state"] != "complete":
    raise RuntimeError("Original prepared native case did not complete")
print(json.dumps({"run_id": result["id"], "state": result["state"]}), flush=True)
'''


def _isolated_process(application, workspace, receiving, run_id, donors, custody_fds, observe):
    """Execute one unchanged Workspace run; release its process memory on return."""
    from model.common import atomic_json, file_digest, now
    from model.model_selection import validate_completed_run
    from model.native_execution import (NativeProcessInterrupted, process_failure,
                                        record_process_interruption, resource_status)
    directory = receiving / "native-case-processes" / run_id / uuid.uuid4().hex
    directory.mkdir(parents=True, exist_ok=False)
    request = {
        "schema": "upstate.gura-isolated-native-case/v1", "application": str(application),
        "workspace": str(workspace.root), "workspace_id": workspace.project["id"],
        "run_id": run_id, "reuse_source_run_ids": sorted(value for value in donors if value != run_id),
        "python": sys.executable, "created_at": now(),
    }
    request_path = directory / "request.json"
    atomic_json(request_path, request, immutable=True)
    process = None
    started = now()
    resources_before = resource_status()
    try:
        with (directory / "stdout.log").open("xb") as stdout, (directory / "stderr.log").open("xb") as stderr:
            process = subprocess.Popen(
                [sys.executable, "-B", "-c", _NATIVE_CASE_CHILD, str(request_path)],
                cwd=application, env=dict(os.environ), stdin=subprocess.DEVNULL,
                stdout=stdout, stderr=stderr, pass_fds=tuple(custody_fds))
            observation = {"run_id": run_id, "pid": process.pid,
                           "process_directory": str(directory), "started_at": started,
                           "request_path": request_path.relative_to(workspace.root).as_posix(),
                           "request_sha256": file_digest(request_path), "python": sys.executable}
            atomic_json(directory / "process.json", observation, immutable=True)
            observe({**observation, "state": "running"})
            while True:
                try:
                    code = process.wait(timeout=15)
                    break
                except subprocess.TimeoutExpired:
                    # The child's ordinary run.json/native.log remain the native
                    # journals. This small operation observation keeps the caller live.
                    observe({**observation, "state": "running", "observed_at": now()})
        resources_after = resource_status()
        returned = {**observation, "state": "returned", "return_code": code, "returned_at": now(),
                    "resources_before": resources_before, "resources_after": resources_after}
    except BaseException:
        if process is not None and process.poll() is None:
            process.terminate()
            process.wait()
        raise
    result = workspace.inspect_run(run_id)
    signal_failure = process_failure(code, run_id=run_id, process=observation,
                                     before=resources_before, after=resources_after,
                                     native_state=result)
    if signal_failure is not None:
        # A complete original run remains complete even if its process received
        # a signal while exiting. Stop this attempt before another case starts.
        if result.get("state") == "complete":
            validate_completed_run(result)
        failure = NativeProcessInterrupted(signal_failure)
        recording_error = None
        try:
            record_process_interruption(workspace, run_id, signal_failure, pid=process.pid)
            atomic_json(directory / "return.json", returned)
            atomic_json(directory / "interruption.json", signal_failure, immutable=True)
            observe({**observation, "state": "interrupted", "return_code": code,
                     "error": signal_failure, "returned_at": now()})
        except (OSError, ValueError) as error:
            recording_error = error
            failure.native_failure["publication_error"] = {
                "type": type(error).__name__, "message": str(error)}
        if recording_error is not None:
            raise failure from recording_error
        raise failure
    atomic_json(directory / "return.json", returned)
    if result.get("state") == "complete":
        validate_completed_run(result)
        observe({**observation, "state": "complete", "return_code": code, "completed_at": now()})
        return result
    failure = RuntimeError("Original native case " + run_id + " returned "
                           + str(code) + "; continue its retained run and " + str(directory))
    if result.get("error"):
        failure.native_failure = result["error"]
    observe({**observation, "state": result.get("state", "interrupted"),
             "return_code": code, "returned_at": now()})
    raise failure


def main(argv=None):
    args = parser().parse_args(argv)
    application = args.application.resolve(strict=True)
    sys.path.insert(0, str(application))
    sys.path.insert(0, str(application / "source_tools"))
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")
    os.environ.setdefault("GDAL_CACHEMAX", "64")
    import receive_gura_native as receiver
    from receive_gura_planning import original_baseline
    from model import parameter_studies
    from model.common import atomic_json, digest, held, identifier, now, read_json
    from model.model_selection import run_models, validate_completed_run
    from model.workspace import Workspace
    from model.native_execution import process_interrupted, storage_exhausted
    from model.parameter_suite_exports import SuiteExports

    root = args.workspace.resolve()
    receiving = root / "gura-receiving"
    receiving.mkdir(parents=True, exist_ok=True)
    inputs = args.inputs.resolve(strict=True)
    scopes = [name for name in SCOPES if name in set(args.scopes)]
    state, directory = None, None
    custody_fds = ()

    class ReusingWorkspace(Workspace):
        """Expose original completed donors to native identity-checked stage reuse."""
        def __init__(self, path):
            super().__init__(path)
            self.donors = set()

        def remember(self, run_id):
            record = self.inspect_run(run_id)
            validate_completed_run(record)
            if record["state"] == "complete":
                self.donors.add(record["id"])
            return record

        def run(self, key, *, reuse_source_run_ids=None):
            donors = sorted(self.donors | set(reuse_source_run_ids or ()))
            retained = self.inspect_run(key)
            if args.isolate_native_cases and retained["state"] != "complete":
                _isolated_process(application, self, receiving, key, donors, custody_fds,
                    lambda value: checkpoint("native-case-process", native_case_process=value))
                # The ordinary completed-run path verifies every retained output;
                # it does not load or execute another native model.
            result = super().run(key, reuse_source_run_ids=[value for value in donors if value != key])
            if result["state"] == "complete":
                self.donors.add(result["id"])
            return result

    def checkpoint(stage, **values):
        if state is None:
            receiver.atomic(receiving / "parameter-suite-receiving.json", {
                "schema": "upstate.gura-parameter-suite-receiving/v1",
                "stage": stage, "updated_at": now(),
                "request": {"baseline_run_id": args.baseline_run_id,
                            "scopes": scopes, "design": args.design,
                            "evaluation_run_ids": args.evaluation_run_id,
                            "isolate_native_cases": args.isolate_native_cases}, **values})
            receiver.emit("gura-studies-" + stage, **values)
            return
        state.update(stage=stage, updated_at=now(), **values)
        atomic_json(directory / "state.json", state)
        receiver.emit("gura-studies-" + stage, suite_id=state["id"],
                      state_path=str(directory / "state.json"), **values)

    with _native_batch_lock(receiving / ".parameter-suite.lock") as suite_fd, _native_batch_lock(
            root / ".native-model-batch.lock") as batch_fd:
        custody_fds = tuple(dict.fromkeys((suite_fd, batch_fd, *_supervisor_custody(root))))
        try:
            baseline_id = args.baseline_run_id
            recorded = receiving / "gura-receiving-state.json"
            if baseline_id is None and recorded.is_file():
                baseline_id = read_json(recorded).get("workspace_baseline", {}).get("run_id")
            if baseline_id is not None and args.baseline_run_id is None:
                candidate = Workspace(root).inspect_run(identifier(baseline_id))
                if run_models(candidate) != ("ndr", "sdr"):
                    baseline_id = None
            if baseline_id is None:
                checkpoint("original-reference")
                original_args = [
                    "--application", str(application), "--workspace", str(root),
                    "--inputs", str(inputs), "--models", "ndr", "sdr", "--mode", "both"]
                if args.isolate_native_cases:
                    # The original reference receiver owns its separate .driver
                    # lease. It does not reacquire this suite's native batch lease.
                    code = subprocess.call(
                        [sys.executable, "-B", str(Path(receiver.__file__)), *original_args],
                        cwd=application, env=dict(os.environ), pass_fds=custody_fds)
                else:
                    code = receiver.main(original_args)
                if code:
                    raise RuntimeError("Original Gura receiving requires recovery; inspect its retained state")
                baseline_id = read_json(recorded)["workspace_baseline"]["run_id"]
            workspace = ReusingWorkspace(root)
            originals = {model: receiver.unpack_original(inputs, receiving, model)
                         for model in ("ndr", "sdr")}
            # Resume only the explicitly retained original both-model selection.
            candidate = workspace.inspect_run(identifier(baseline_id))
            if (run_models(candidate) != ("ndr", "sdr") or workspace._get(
                    "scenarios", candidate["selection"]["scenario_id"]).get("kind") != "baseline"):
                raise ValueError("Choose the original both-model Gura baseline run")
            workspace.run(candidate["id"])
            baseline, grid = original_baseline(workspace, baseline_id, originals, receiver)
            workspace.remember(baseline["id"])
            target_ids = list(args.evaluation_run_id)
            if args.include_planning_evaluation:
                planning = read_json(receiving / "gura-planning-state.json")
                if planning.get("evaluation_run_id"):
                    target_ids.append(planning["evaluation_run_id"])
                else:
                    raise ValueError("The retained planning operation has no selected-treatment evaluation")
            targets = [{"id": baseline["id"], "label": "Original Gura landscape",
                        "scenario_id": baseline["selection"]["scenario_id"], "portfolio_id": None}]
            for value in dict.fromkeys(target_ids):
                run = workspace.inspect_run(identifier(value))
                selection = run["selection"]
                scenario = workspace._get("scenarios", selection["scenario_id"])
                if (selection["grid_id"] != grid["id"]
                        or selection["profile_id"] != baseline["selection"]["profile_id"]
                        or run_models(run) != ("ndr", "sdr")
                        or scenario.get("kind") != "landcover" or not scenario.get("portfolio_id")):
                    raise ValueError("Additional landscapes must be original-profile Gura portfolio evaluations")
                workspace.run(run["id"])
                workspace.remember(run["id"])
                targets.append({"id": run["id"], "label": scenario["title"],
                                "scenario_id": scenario["id"], "portfolio_id": scenario["portfolio_id"]})
            selection = {
                "schema": "upstate.gura-parameter-suite-selection/v1", "edition": EDITION,
                "workspace_id": workspace.project["id"], "baseline_run_id": baseline["id"],
                "grid_id": grid["id"], "original_profile_id": baseline["selection"]["profile_id"],
                "targets": targets, "scopes": scopes, "design": args.design,
                "axes": {scope: axes_for(scope) for scope in scopes},
                "difference_maps": args.difference_maps,
                "original_argument_sha256": {
                    model: receiver.sha(Path(originals[model]["argument_path"]))
                    for model in ("ndr", "sdr")},
                "original_archive_sha256": {model: originals[model]["archive"]["sha256"]
                                            for model in ("ndr", "sdr")},
                "references": [NDR_GUIDE, SDR_GUIDE],
            }
            suite_id = digest(selection)
            directory = receiving / "parameter-studies" / suite_id
            directory.mkdir(parents=True, exist_ok=True)
            atomic_json(directory / "selection.json", selection, immutable=True)
            path = directory / "state.json"
            state = read_json(path) if path.exists() else {
                "schema": "upstate.gura-parameter-suite/v1", "id": suite_id,
                "selection": selection, "created_at": now(), "studies": [],
                "original_runtime": baseline.get("runtime"),
                "implementation": {"driver_sha256": receiver.sha(Path(__file__)),
                                   "engine_sha256": receiver.sha(Path(parameter_studies.__file__))},
            }
            if state["selection"] != selection:
                raise ValueError("Retained suite selection differs from its immutable source identity")
            state["execution_policy"] = {
                "native_cases": "isolated-process" if args.isolate_native_cases else "same-process",
                "python": sys.executable, "driver_sha256": receiver.sha(Path(__file__)),
                "case_order": "NDR-only, SDR-only, then combined; original run IDs and scientific selections",
            }
            # Use resolved original targets, not a later mutable planning-state
            # pointer, so an explicit continuation reopens the same suite.
            continuation = [sys.executable, "-B", str(Path(__file__).resolve()),
                            "--application", str(application), "--workspace", str(root),
                            "--inputs", str(inputs), "--baseline-run-id", baseline["id"],
                            "--scopes", *scopes, "--design", args.design]
            for target in targets[1:]:
                continuation.extend(["--evaluation-run-id", target["id"]])
            if args.difference_maps:
                continuation.append("--difference-maps")
            if args.isolate_native_cases:
                continuation.append("--isolate-native-cases")
            if args.archive:
                continuation.extend(["--archive", str(args.archive.resolve())])
            state["continue_argv"] = continuation
            exports = SuiteExports(workspace, directory, suite_id)
            for item in state["studies"]:
                if item.get("study_id"):
                    current = parameter_studies.inspect(workspace, item["study_id"])
                    for case in current["cases"]:
                        workspace.remember(case["run_id"])
            checkpoint("prepared", state="running")
            failures = []
            for scope in scopes:
                for target in targets:
                    item_key = target["id"] + ":" + scope
                    item = next((row for row in state["studies"] if row["key"] == item_key), None)
                    if item is None:
                        item = {"key": item_key, "landscape_run_id": target["id"],
                                "landscape": target["label"], "portfolio_id": target["portfolio_id"],
                                "model_scope": scope, "state": "preparing"}
                        state["studies"].append(item)
                    try:
                        scoped = workspace.prepare_run({
                            "grid_id": grid["id"], "profile_id": baseline["selection"]["profile_id"],
                            "scenario_id": target["scenario_id"], "models": list(SCOPES[scope])})
                        item["reference_run_id"] = scoped["id"]
                        checkpoint("reference-prepared", active_study_key=item_key)
                        workspace.run(scoped["id"])
                        study_selection = {
                            "title": "Gura " + scope.upper() + " parameters — " + target["label"],
                            "purpose": PURPOSE, "baseline_run_id": scoped["id"],
                            "design": args.design, "axes": selection["axes"][scope],
                            "reporting_areas": [], "difference_maps": args.difference_maps,
                        }
                        study = parameter_studies.prepare(workspace, study_selection)
                        item["study_id"] = study["id"]
                        checkpoint("study-prepared", active_study_key=item_key)

                        def progress(current):
                            item.update(state=current["state"], progress=current["progress"],
                                        active_run_id=current.get("active_run_id"),
                                        active_case_id=current.get("active_case_id"),
                                        aggregation_progress=current.get("aggregation_progress"))
                            checkpoint("native-cases", active_study_key=item_key)

                        current = parameter_studies.execute(workspace, study["id"], progress=progress)
                        item.update(state=current["state"], progress=current["progress"])
                        item.pop("error", None)
                        if current["state"] != "complete":
                            failures.append(item_key)
                    except Exception as error:
                        item.update(state="failed", error={
                            "type": type(error).__name__, "message": str(error),
                            "traceback": traceback.format_exc()})
                        failures.append(item_key)
                        if storage_exhausted(error) or process_interrupted(error):
                            raise
                        logging.exception("Gura parameter study needs recovery: %s", item_key)
                    # Keep the completed reports usable while remaining native cases continue.
                    state["state"] = "running"
                    checkpoint("study-exports", active_study_key=item_key)
                    state["files"] = _copy_exports(
                        workspace, directory, state, exports=exports, build_archive=False)
                    checkpoint("study-reported", active_study_key=item_key)
            complete = not failures and all(row["state"] == "complete" for row in state["studies"])
            state["state"] = "complete" if complete else "partial"
            state["files"] = _copy_exports(
                workspace, directory, state, exports=exports,
                progress=lambda value: checkpoint("suite-archive", export_progress=value))
            if args.archive:
                destination = args.archive.resolve()
                if destination.is_relative_to(root):
                    raise ValueError("Save the external suite ZIP outside the source workspace")
                destination.parent.mkdir(parents=True, exist_ok=True)
                from model.reuse import copy_verified
                transfer = {"files": 0, "bytes": 0, "methods": {}}
                copy_verified(directory, state["files"]["archive"], destination.parent,
                              path=destination.name, replace_mismatch=True, transfer=transfer)
                state["external_archive_transfer"] = transfer
                state["external_archive"] = receiver.artifact(destination, destination.parent)
            checkpoint("complete" if complete else "partial", active_study_key=None,
                       failed_study_keys=failures, completed_at=now() if complete else None)
            return 0 if complete else 1
        except Exception as error:
            try:
                checkpoint("interrupted" if process_interrupted(error) else "error",
                           state="partial" if process_interrupted(error) else "error", error={
                    **(getattr(error, "native_failure", None) or {}),
                    "type": type(error).__name__, "message": str(error),
                    "traceback": traceback.format_exc()})
            except OSError:
                if not storage_exhausted(error):
                    raise
            logging.exception("Gura parameter suite stopped at its actual operation")
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
