#!/usr/bin/env python3
"""Adopt the original completed Gura case and continue its explicit paired class study."""
from __future__ import annotations
import argparse
import contextlib
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import socket
import sys
import uuid

SOURCE_MERGE = "ed06d50e7beaa8fdf1f11fe3a0c6f6d86ccf6eaa"
CONVERSIONS = [(5, 8), (5, 19)]
SCHEMA = "upstate.gura-paired-intake/v1"

class LoggedOutput:
    def __init__(self, stream, log):
        self.stream, self.log, self.buffer, self.study_id = stream, log, "", None
    def write(self, value):
        self.stream.write(value)
        self.log.write(value)
        self.buffer += value
        while "\n" in self.buffer:
            line, self.buffer = self.buffer.split("\n", 1)
            try:
                row = json.loads(line)
            except (ValueError, TypeError):
                continue
            if (isinstance(row, dict) and row.get("state") == "prepared"
                    and row.get("baseline_run_id") and row.get("scenario_ids")):
                self.study_id = row["id"]
        return len(value)
    def flush(self):
        self.stream.flush()
        self.log.flush()

def runtime():
    result = {"hostname": socket.gethostname(), "pid": os.getpid(),
              "python": sys.executable, "python_version": sys.version, "packages": {}}
    for name in ("natcap.invest", "GDAL", "pygeoprocessing", "rasterio", "numpy"):
        try:
            result["packages"][name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            result["packages"][name] = None
    return result

def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--application", type=Path, required=True)
    p.add_argument("--workspace", type=Path, required=True)
    p.add_argument("--receiving-state", type=Path,
                   help="Original receive_gura_native state; defaults to Workspace/gura-receiving")
    p.add_argument("--baseline-run-id", help="Select the actual recorded original baseline explicitly")
    p.add_argument("--execute", action="store_true",
                   help="Run pending native paired cases; default synchronizes completed cases only")
    p.add_argument("--output", type=Path, help="Separate exported paired results directory")
    return p

def main(argv=None):
    args = parser().parse_args(argv)
    application = args.application.resolve(strict=True)
    workspace_path = args.workspace.resolve(strict=True)
    if (application == workspace_path or application.is_relative_to(workspace_path)
            or workspace_path.is_relative_to(application)):
        raise ValueError("Keep application source and actual Workspace in separate directories")
    sys.path.insert(0, str(application))
    from model.workspace import Workspace
    from model.common import atomic_json, describe_file, file_digest, held, now, read_json
    from model import paired_robustness
    from source_tools import gura_receipt, gura_comparison, receive_gura_robustness
    ws = Workspace(workspace_path)
    actual_runtime = runtime()
    if args.execute and actual_runtime["packages"]["natcap.invest"] != "3.20.0":
        raise ValueError("This original-source continuation selects natcap.invest 3.20.0")
    source_paths = [
        "model/paired_robustness.py", "source_tools/receive_gura_robustness.py",
        "source_tools/gura_receipt.py", "source_tools/gura_comparison.py",
        "source_tools/receive_gura_studies.py", "model/parameter_studies.py",
        "model/experiments.py", "model/scenario_decisions.py", "model/native.py",
        "model/workspace.py", "model/rasters.py"]
    software = [describe_file(application, application / name) for name in source_paths]
    directory = ws.root / "gura-receiving" / "paired-class5-continuation"
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".intake.lock", blocking=False):
        admission = {"schema": SCHEMA, "operation": "GURA-NATIVE-01",
                     "runtime": actual_runtime, "application": str(application),
                     "workspace": str(ws.root), "workspace_id": ws.project["id"],
                     "conversions": [list(pair) for pair in CONVERSIONS],
                     "mode": "execute" if args.execute else "completed-only",
                     "started_at": now(), "software": software,
                     "paired_source_merge": SOURCE_MERGE}
        attempt = uuid.uuid4().hex
        attempt_path = directory / "attempts" / (attempt + ".json")
        atomic_json(attempt_path, {**admission, "state": "admitted"})
        atomic_json(directory / "latest.json", {"attempt": attempt, "path": str(attempt_path)})
        try:
            receiving = gura_receipt.prepare(ws, run_id=args.baseline_run_id,
                                             receiving_state=args.receiving_state)
            receiving_path = Path(receiving["receiving_path"])
            baseline = ws.inspect_run(receiving["baseline_run_id"])
            if baseline["state"] != "complete":
                raise ValueError("Complete or restore the retained original baseline first")
            plan = gura_comparison.make_plan(
                receiving_path, conversions=CONVERSIONS, workspace=ws)
            plan_path = receiving_path.parent / "gura-class5-to-8-and-19-plan.json"
            atomic_json(plan_path, plan, immutable=True)
            gura_comparison._check_plan(receiving_path, plan_path, workspace=ws)
            admission.update(
                baseline_run_id=receiving["baseline_run_id"],
                source_collection_id=receiving["source_collection_id"],
                grid_id=receiving["grid_id"], profile_id=receiving["profile_id"],
                baseline_scenario_id=receiving["scenario_id"],
                native_grid=receiving["native_grid"],
                original_programme_id=receiving["programme_id"],
                table_source_policy=receiving["table_source_policy"],
                original_tables=receiving["original_tables"],
                receiving_path=str(receiving_path),
                receiving=describe_file(receiving_path.parent, receiving_path),
                plan_path=str(plan_path), plan_id=plan["id"],
                plan=describe_file(plan_path.parent, plan_path),
                cases=[{"key": case["key"], "source_class": case["source_class"],
                        "target_class": case["target_class"],
                        "planned_source_cells": case["planned_source_cells"],
                        "planned_source_area_ha": case["planned_source_area_ha"]}
                       for case in plan["cases"]])
            atomic_json(attempt_path, {**admission, "state": "source-bound"})
            invocation = ["--application", str(application), "--workspace", str(ws.root),
                          "--receiving", str(receiving_path), "--plan", str(plan_path),
                          "--execute" if args.execute else "--completed-only"]
            if args.output:
                invocation += ["--output", str(args.output)]
            log_path = directory / "attempts" / (attempt + ".log")
            with log_path.open("x", encoding="utf-8") as log:
                output = LoggedOutput(sys.stdout, log)
                with contextlib.redirect_stdout(output):
                    return_code = receive_gura_robustness.main(invocation)
                output.flush()
            if not output.study_id:
                raise RuntimeError("The maintained paired receiver returned no prepared study identity")
            study = paired_robustness.inspect(ws, output.study_id)
            result = {**admission, "state": study["state"], "finished_at": now(),
                      "paired_id": study["id"], "families": study["families"],
                      "files": study.get("files", {}),
                      "paired_directory": str(ws.root / "paired-robustness" / study["id"]),
                      "receiver_return_code": return_code,
                      "receiver_arguments": invocation,
                      "log": describe_file(directory, log_path)}
            if not args.execute:
                result["native_solver_calls"] = 0
            atomic_json(attempt_path, result)
            print(json.dumps({"intake_record": str(attempt_path), **result},
                             sort_keys=True, allow_nan=False), flush=True)
            return return_code
        except BaseException as error:
            failure = {**admission, "state": "failed", "finished_at": now(),
                       "error": {"type": type(error).__name__, "message": str(error)}}
            try:
                atomic_json(attempt_path, failure)
            except OSError:
                pass
            raise

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"state": "failed", "type": type(error).__name__,
                          "message": str(error)}), file=sys.stderr, flush=True)
        raise SystemExit(1)
