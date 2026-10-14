"""Continue one authored matched-control study in the original geographic receiver.

This module is called by receive_geographic_headwaters.py. Its direct entry point
only reopens an already restored study with the source contained in that archive.
Native design, matching, adoption and execution remain in model.multivariate_control.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

APP = Path(__file__).resolve().parents[1]
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from model.common import atomic_bytes, atomic_json, describe_file, digest, file_digest, identifier, now, read_json, verify_file
from model.workspace import Workspace
from source_tools.geographic_headwaters_reopen import receiving_lock, _lock_identity
from source_tools.receiving_process import popen_with_lease, inherited_descriptor

SCHEMA = "upstate.multivariate-control-receiving/v1"
REOPEN = "upstate.multivariate-control-cold-reopen/v1"
HELPER = "source_tools/multivariate_control_receiving.py"


def _event(stage, **details):
    print(json.dumps({"stage": stage, **details}, sort_keys=True, allow_nan=False), flush=True)


def _outside(path, root):
    if path == root or path.is_relative_to(root) or root.is_relative_to(path):
        raise ValueError("Keep matched-control receiving output outside the application and Workspace")


def _original_runs(workspace):
    """Snapshot completed original records without inventing or changing a run."""
    records = []
    for path in sorted((workspace.root / "runs").glob("*/run.json")):
        value = read_json(path)
        if value.get("state") == "complete":
            if value.get("id") != path.parent.name:
                raise ValueError("A completed original run changed its content identity")
            records.append({"id": value["id"], "selection": value["selection"],
                            "record": describe_file(workspace.root, path)})
    return records


def _preserve_original_runs(workspace, originals):
    for row in originals:
        path = verify_file(workspace.root, row["record"])
        value = read_json(path)
        if (value.get("id") != row["id"] or value.get("state") != "complete"
                or value.get("selection") != row["selection"]):
            raise ValueError("The matched-control continuation changed an original completed run")
    return {"completed_originals": len(originals), "identity": "MATCH"}


def _archive(workspace, output, selection):
    from model import study_transfer
    path = output / "matched-control-study.zip"
    receipt_path = output / "study-archive.json"
    if path.exists():
        inspected = study_transfer.inspect_transfer_archive(path, verify=True)
        if inspected["study"]["identity"]["selection"] != study_transfer.normalise(selection):
            raise ValueError("The retained archive belongs to another authored matched-control study")
        if inspected["manifest"]["project"] != workspace.project:
            raise ValueError("The retained archive belongs to another Workspace")
        if receipt_path.exists():
            receipt = read_json(receipt_path)
            if receipt["id"] != inspected["study"]["id"]:
                raise ValueError("The retained archive receipt changed its selected study")
            if receipt.get("sha256") != file_digest(path):
                raise ValueError("The retained selected Study ZIP differs from its original receipt")
            return receipt, inspected
        # An export can publish its complete archive before its caller saves the ACK.
        # Reconcile that exact original ZIP; never replace it with another selection.
        receipt = {"id": inspected["study"]["id"], "path": str(path),
                   "bytes": path.stat().st_size, "sha256": file_digest(path),
                   "recovered_complete_archive": True}
    else:
        receipt = study_transfer.export_study(
            workspace, path, selection,
            progress=lambda value: _event("matched-control-study-export", **value))
        inspected = study_transfer.inspect_transfer_archive(path, verify=True)
    atomic_json(receipt_path, receipt, immutable=True)
    return receipt, inspected


def _restore(output, archive, project):
    from model import portable
    destination = output / "received"
    receipt_path = output / "study-restore.json"
    if destination.exists():
        restored = portable.resume_restore(
            archive["path"], destination, expected_archive_sha256=archive["sha256"])
    else:
        restored = portable.restore(archive["path"], destination)
    if (restored["archive_sha256"] != archive["sha256"]
            or restored["project"] != project
            or Path(restored["application"]).resolve() != destination / "application"
            or Path(restored["workspace"]).resolve() != destination / "workspace"):
        raise ValueError("The received matched-control study changed its original archive or project")
    # Native resume may add its reconciliation status. Retain the first full receipt,
    # and keep the latest native reconciliation as a separate current result.
    if not receipt_path.exists():
        atomic_json(receipt_path, restored, immutable=True)
    atomic_json(output / "study-restore-current.json", restored)
    return restored


def _cold_reopen(restored, inspected, design, output, lock_fd, outcome=None):
    """Run the archive's own source in a clean Python process."""
    from source_tools.geographic_headwaters_reopen import _support
    support = _support()
    application = Path(restored["application"]).resolve(strict=True)
    workspace = Path(restored["workspace"]).resolve(strict=True)
    members = inspected["manifest"]["members"]
    if "application/" + HELPER not in members:
        raise ValueError("The selected Study must include its original matched-control receiving chapter")
    source_identity = support._application(application, members)
    attempt = uuid.uuid4().hex
    directory = output / "cold-reopen" / attempt
    directory.mkdir(parents=True, exist_ok=False)
    request = {"schema": REOPEN, "attempt_id": attempt,
               "application": str(application), "workspace": str(workspace),
               "project": restored["project"], "archive_sha256": restored["archive_sha256"],
               "study_id": inspected["study"]["id"], "design": design,
               **({"outcome": outcome} if outcome is not None else {}),
               "receiving_lock": _lock_identity(lock_fd, output / ".matched-control-receiving.lock")}
    request_path = directory / "request.json"
    result_path = directory / "result.json"
    atomic_json(request_path, request, immutable=True)
    request_sha = file_digest(request_path)
    command = [sys.executable, "-I", "-B", str(application / HELPER),
               "--reopen-request", str(request_path), "--request-sha256", request_sha,
               "--result", str(result_path), "--lock-fd", str(lock_fd)]
    atomic_json(directory / "launch.json",
                {"schema": REOPEN, "command": command, "started_at": now(),
                 "request_sha256": request_sha, "source_members": len(source_identity)},
                immutable=True)
    process = None
    try:
        with (directory / "stdout.log").open("xb", buffering=0) as stdout, \
                (directory / "stderr.log").open("xb", buffering=0) as stderr:
            process = popen_with_lease(command, cwd=application, stdout=stdout, stderr=stderr,
                                       pass_fds=(lock_fd,))
            _event("matched-control-cold-process", pid=process.pid, command=command)
            code = process.wait()
            os.fsync(stdout.fileno())
            os.fsync(stderr.fileno())
        if code:
            raise RuntimeError("The contained matched-control application exited "
                               + str(code) + "; inspect " + str(directory / "stderr.log"))
        result = read_json(result_path)
        if (result.get("schema") != REOPEN or result.get("attempt_id") != attempt
                or result.get("request_sha256") != request_sha or result.get("identity") != "MATCH"
                or result.get("project") != restored["project"]
                or result.get("study_id") != inspected["study"]["id"]
                or result.get("design_id") != design["id"]
                or (outcome is not None and result.get("outcome_id") != outcome["id"])):
            raise ValueError("The contained application returned another saved design or Study")
        for name, identity in source_identity.items():
            if support._identity(support._member(application, name).lstat()) != identity:
                raise ValueError("The contained application source changed during cold reopening")
        return {**result, "attempt_directory": str(directory), "returncode": code,
                "stdout": str(directory / "stdout.log"), "stderr": str(directory / "stderr.log")}
    except BaseException:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        raise


def reopen(request_path, request_sha256, result_path, lock_fd):
    request_path = Path(request_path).resolve(strict=True)
    if file_digest(request_path) != identifier(request_sha256):
        raise ValueError("The cold-reopen request changed")
    request = read_json(request_path)
    if request.get("schema") != REOPEN or Path(request["application"]).resolve() != APP:
        raise ValueError("Use the source contained in the selected original Study archive")
    lock = request["receiving_lock"]
    if _lock_identity(lock_fd, lock["path"]) != lock:
        raise ValueError("The contained application lost the original receiving lock")
    workspace = Workspace(Path(request["workspace"]).resolve(strict=True))
    if workspace.project != request["project"]:
        raise ValueError("The contained Workspace is not the selected original project")
    from model import multivariate_control, study_transfer
    verification = study_transfer.verify_received_studies(workspace)
    if request["study_id"] not in {row["id"] for row in verification}:
        raise ValueError("The native selected-study receiver lost the original design root")
    found = multivariate_control.inspect(workspace, request["design"]["id"])
    if found != request["design"]:
        raise ValueError("Cold reopening changed the retained design, adoption or native result")
    outcome = None
    if request.get("outcome") is not None:
        from model import multivariate_control_outcomes
        outcome = multivariate_control_outcomes.inspect(workspace, request["outcome"]["id"])
        if outcome != request["outcome"]:
            raise ValueError("Cold reopening changed the exact native outcome report, support or source")
    result = {"schema": REOPEN, "attempt_id": request["attempt_id"],
              "request_sha256": request_sha256, "project": workspace.project,
              "study_id": request["study_id"], "design_id": found["id"],
              **({"outcome_id": outcome["id"]} if outcome is not None else {}),
              "identity": "MATCH", "verified_studies": verification, "completed_at": now()}
    atomic_json(Path(result_path), result, immutable=True)
    return result


def _browser_admission(restored, study_id, design, outcome=None):
    """Pin the received native Study for the existing browser course."""
    root = Path(restored["workspace"]).resolve(strict=True)
    members = ["workspace.json", "study-transfers/" + identifier(study_id) + ".json",
               "multivariate-controls/" + identifier(design["id"]) + "/design.json"]
    if design.get("adoption"):
        members.append("multivariate-controls/" + design["id"] + "/adoption.json")
    if outcome is not None:
        members.append("multivariate-control-outcomes/" + identifier(outcome["id"]) + "/outcome.json")
    runs = []
    for path in sorted((root / "runs").glob("*/run.json")):
        value = read_json(path)
        if value.get("id") != path.parent.name:
            raise ValueError("The received run differs from its original identifier")
        members.append(path.relative_to(root).as_posix())
        runs.append({"id": value["id"], "state": value["state"]})
    return {"schema": "upstate.multivariate-control-browser-admission/v1",
            "project": restored["project"], "archive_sha256": restored["archive_sha256"],
            "application": restored["application"], "workspace": restored["workspace"],
            "study_id": study_id, "design_id": design["id"],
            **({"outcome_id": outcome["id"]} if outcome is not None else {}),
            "run_records": runs,
            "files": [describe_file(root, root / name) for name in members]}


def receive(workspace, output, *, selection_path=None, design_id=None, execute=False,
            prepared_id=None, outcome_selection_path=None):
    """Optional chapter of the maintained geographic receiving runner."""
    from model import multivariate_control, scenario_footprint, study_transfer
    if (selection_path is None) == (design_id is None):
        raise ValueError("Supply exactly one authored selection file or saved matched-control design ID")
    if type(execute) is not bool:
        raise ValueError("Choose explicitly whether to execute the new matched-control native case")
    output = Path(output).resolve()
    _outside(output, workspace.root)
    _outside(output, APP)
    output.mkdir(parents=True, exist_ok=True)
    with receiving_lock(output / ".matched-control-receiving.lock") as lock_fd:
        if selection_path is not None:
            body = Path(selection_path).resolve(strict=True).read_bytes()
            selected = json.loads(body)
            atomic_bytes(output / "original-selection.json", body, immutable=True)
            proposed = multivariate_control.preview(workspace, selected)
            atomic_json(output / "preview.json", proposed)
            requested = {"selection_sha256": hashlib.sha256(body).hexdigest()}
        else:
            requested = {"design_id": identifier(design_id)}
            selected = multivariate_control.inspect(workspace, design_id)["selection"]
        outcome_requested = {}
        outcome_selection = None
        if outcome_selection_path is not None:
            body = Path(outcome_selection_path).resolve(strict=True).read_bytes()
            outcome_selection = json.loads(body)
            from model import multivariate_control_outcomes
            multivariate_control_outcomes.normalize(outcome_selection)
            atomic_bytes(output / "original-outcome-selection.json", body, immutable=True)
            outcome_requested["outcome_selection_sha256"] = hashlib.sha256(body).hexdigest()
        baseline = workspace.inspect_run(identifier(selected["baseline_run_id"]))
        footprint = scenario_footprint.get_footprint(
            workspace, identifier(selected["restoration_footprint_id"]))
        if baseline["state"] != "complete":
            raise ValueError("Receive a completed original baseline before a new control study")
        restoration = workspace.inspect_run(footprint["run_id"])
        if restoration["state"] != "complete":
            raise ValueError("Receive the completed original restoration used by this design")
        if prepared_id is not None:
            prepared_id = identifier(prepared_id)
            prepared = read_json(workspace.root / "geographic-headwaters" / prepared_id / "prepared.json")
            if (prepared["project_id"] != workspace.project["id"]
                    or prepared["id"] != prepared_id or prepared["baseline_run_id"] != baseline["id"]
                    or restoration["id"] not in prepared["alternative_run_ids"]):
                raise ValueError("The design does not use the selected original Geographic baseline and restoration")
        identity = {"schema": SCHEMA, "project_id": workspace.project["id"], **requested, **outcome_requested,
                    "prepared_id": prepared_id, "execute": execute,
                    "baseline_run_id": baseline["id"], "restoration_run_id": restoration["id"]}
        operation_id = digest(identity)
        state_path = output / "receiving.json"
        if state_path.exists():
            state = read_json(state_path)
            if state.get("identity") != identity or state.get("id") != operation_id:
                raise ValueError("Resume the same authored matched-control chapter in this output directory")
        else:
            state = {"schema": SCHEMA, "id": operation_id, "identity": identity,
                     "original_completed_runs": _original_runs(workspace),
                     "created_at": now(), "stages": {}}
            atomic_json(state_path, state)

        def save(**value):
            state.update(value, updated_at=now())
            atomic_json(state_path, state)

        def phase(name, action):
            _preserve_original_runs(workspace, state["original_completed_runs"])
            started = time.perf_counter()
            save(state="running", active_stage=name)
            _event(name, operation_id=operation_id, state="running")
            try:
                result = action()
                _preserve_original_runs(workspace, state["original_completed_runs"])
            except BaseException as error:
                save(state="failed" if isinstance(error, Exception) else "interrupted",
                     error={"stage": name, "type": type(error).__name__, "message": str(error)})
                raise
            previous = state["stages"].get(name, {})
            state["stages"][name] = {"state": "complete",
                "first_completed_at": previous.get("first_completed_at", now()),
                "first_elapsed_seconds": previous.get("first_elapsed_seconds", time.perf_counter()-started),
                "latest_elapsed_seconds": time.perf_counter()-started}
            state.pop("error", None)
            save(active_stage=None)
            return result

        if design_id is None:
            design = phase("matched-control-prepare",
                           lambda: multivariate_control.prepare(workspace, selected,
                               progress=lambda value: _event("matched-control-design-progress", progress=value)))
            design_id = design["id"]
        else:
            design = multivariate_control.inspect(workspace, design_id)
        save(design_id=design_id, design_state=design["state"])
        atomic_json(output / "design.json", design)
        if design["state"] == "prepared":
            adopted = phase("matched-control-adopt", lambda: multivariate_control.adopt(workspace, design_id))
            save(adoption=adopted["adoption"])
            if execute:
                def execute_control():
                    from model import experiments
                    result = multivariate_control.execute(workspace, design_id)
                    atomic_json(output / "native-experiment.json", result)
                    summary = experiments.read_summary(workspace, adopted["adoption"]["experiment_id"])
                    if summary is not None:
                        atomic_json(output / "native-summary.json", summary)
                    if result.get("state") != "complete":
                        raise ValueError("The original matched-control experiment is not complete; inspect its retained progress and resume this same chapter")
                    return result
                execution = phase("matched-control-native", execute_control)
                save(execution=execution)
        else:
            # Infeasible and threshold-rejected assessments are complete scientific
            # records. Export their full treatment/support evidence without adoption.
            save(interpretation="No accepted control design; the full original treatment remains retained.",
                 native_execution="not_adopted")
        design = multivariate_control.inspect(workspace, design_id)
        atomic_json(output / "design.json", design)
        outcome = None
        if outcome_selection is not None:
            if design_id not in outcome_selection["design_ids"]:
                raise ValueError("Include this exact original saved design in the authored outcome group")
            from model import multivariate_control_outcomes
            outcome_preview = phase("matched-control-outcome-preview",
                                    lambda: multivariate_control_outcomes.preview(workspace, outcome_selection))
            atomic_json(output / "outcome-preview.json", outcome_preview)
            originals = _original_runs(workspace)
            outcome = phase("matched-control-outcome-report",
                            lambda: multivariate_control_outcomes.prepare(workspace, outcome_selection,
                                progress=lambda value: _event("matched-control-outcome-progress", progress=value)))
            if _original_runs(workspace) != originals:
                raise ValueError("The native outcome report changed or added a completed model run")
            if outcome["id"] != outcome_preview["id"]:
                raise ValueError("The prepared outcome left the exact original preview")
            atomic_json(output / "outcome.json", outcome)
            save(outcome_report=outcome, outcome_id=outcome["id"])
        transfer_selection = {
            "schema": study_transfer.SELECTION_SCHEMA,
            "title": selected["title"] + " — editable matched-control study",
            "roots": [{"kind": "multivariate-controls", "id": design_id}]
                     + ([{"kind": "multivariate-control-outcomes", "id": outcome["id"]}] if outcome is not None else []),
            "include_related_results": True,
        }
        preview = phase("matched-control-study-preview",
                        lambda: study_transfer.preview(workspace, transfer_selection))
        atomic_json(output / "study-preview.json", preview)
        archive, inspected = phase("matched-control-study-export",
                                  lambda: _archive(workspace, output, transfer_selection))
        save(archive=archive, study_id=inspected["study"]["id"])
        restored = phase("matched-control-study-restore",
                         lambda: _restore(output, archive, workspace.project))
        save(restored=restored)
        cold = phase("matched-control-contained-reopen",
                     lambda: _cold_reopen(restored, inspected, design, output, lock_fd, outcome))
        save(state="complete", active_stage=None, design=design, independent_reopen=cold,
             browser_admission=_browser_admission(restored, inspected["study"]["id"], design, outcome),
             preserved_originals=_preserve_original_runs(workspace, state["original_completed_runs"]),
             outcome=design["state"],
             producer_view="Pending actual desktop/narrow operation and viewing of every outgoing attachment.")
        return state


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="Read-only contained matched-control Study reopening")
    parser.add_argument("--reopen-request", type=Path, required=True)
    parser.add_argument("--request-sha256", required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--lock-fd", type=int, required=True)
    args = parser.parse_args(argv)
    with inherited_descriptor(args.lock_fd) as descriptor:
        result = reopen(args.reopen_request, args.request_sha256, args.result, descriptor)
    print(json.dumps(result, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
