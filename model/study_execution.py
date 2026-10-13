"""Summarize actual native execution for the selected experiment.

Reads run metadata only. Raster bodies and native engines are not loaded.
All byte counts are logical lengths of retained files, not disk allocation.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime
import csv
import hashlib
import io
import json

from .common import now, relative_file
from .model_selection import run_models

SCHEMA = "upstate.study-execution/v1"


def _seconds(start, end):
    if not isinstance(start, str) or not isinstance(end, str):
        return None
    try:
        a = datetime.fromisoformat(start.replace("Z", "+00:00"))
        b = datetime.fromisoformat(end.replace("Z", "+00:00"))
        if a.tzinfo is None or b.tzinfo is None:
            return None
        result = (b - a).total_seconds()
        return result if result >= 0 else None
    except (ValueError, TypeError, OverflowError):
        return None


def _files(descriptors):
    """Deduplicate complete original descriptors within one native run."""
    result = {}
    for item in descriptors:
        if not isinstance(item, dict):
            raise ValueError("Native execution file metadata must be an object")
        path, size, checksum = item.get("path"), item.get("bytes"), item.get("sha256")
        if (not isinstance(path, str) or not path
                or isinstance(size, bool) or not isinstance(size, int) or size < 0
                or not isinstance(checksum, str) or len(checksum) != 64):
            raise ValueError("Native execution file metadata is incomplete")
        value = {"path": path, "bytes": size, "sha256": checksum}
        if path in result and result[path] != value:
            raise ValueError("Native execution file metadata conflicts for " + path)
        result[path] = value
    return result


def _stage(run, model):
    stage = run.get("stages", {}).get(model) or {}
    complete = bool(stage.get("completed_at") and stage.get("files"))
    donor = stage.get("reused_from") or {}
    reused = bool(donor.get("run_id"))
    descriptors = [
        *stage.get("files", {}).values(),
        *stage.get("companions", []),
        *stage.get("additional_files", []),
    ]
    files = _files(descriptors)
    row = {
        "run_id": run["id"], "model": model,
        "state": "reused" if complete and reused else "calculated" if complete else "pending",
        "source_run_id": donor.get("run_id"),
        "input_signature": (stage.get("input_signature") or {}).get("id"),
        "started_at": stage.get("started_at"),
        "completed_at": stage.get("completed_at"),
        "native_elapsed_seconds": (
            _seconds(stage.get("started_at"), stage.get("completed_at"))
            if complete and not reused else None),
        "reuse_elapsed_seconds": (
            _seconds(stage.get("reuse_started_at"), stage.get("reused_at"))
            if complete and reused else None),
        "source_native_elapsed_seconds": (
            _seconds(donor.get("stage_started_at"), donor.get("stage_completed_at"))
            if complete and reused else None),
        "output_files": len(files),
        "output_logical_bytes": sum(item["bytes"] for item in files.values()),
        "transfer_logical_bytes": (stage.get("transfer") or {}).get("bytes") if reused else None,
        "transfer_methods": dict((stage.get("transfer") or {}).get("methods", {})),
    }
    return row, files


def from_runs(summary, runs, *, sources=(), observed_at=None, unavailable=()):
    """Build accounting from selected, already-read run snapshots."""
    requested = set()
    for case in summary.get("rows", []):
        for field in ("run_id", "baseline_run_id"):
            if case.get(field):
                requested.add(case[field])
    rows, snapshots, all_files = [], [], {}
    seen = set()
    for run in runs:
        key = run["id"]
        if key not in requested:
            raise ValueError("Execution snapshot belongs to another experiment")
        if key in seen:
            raise ValueError("Execution snapshot repeats a native run")
        seen.add(key)
        execution = run.get("execution") or {}
        history = run.get("execution_history", [])
        for model in run_models(run):
            row, _ = _stage(run, model)
            rows.append(row)
        # Native registry entries and delivered masses can repeat paths.
        # Reconcile together before summing, including repeats across models.
        descriptors = []
        for model in run_models(run):
            stage = run.get("stages", {}).get(model) or {}
            descriptors.extend(stage.get("files", {}).values())
            descriptors.extend(stage.get("companions", []))
            descriptors.extend(stage.get("additional_files", []))
        descriptors.extend(run.get("artifacts", {}).values())
        run_files = _files(descriptors)
        for path, item in run_files.items():
            all_files[(key, path)] = item
        previous_attempts = [
            {"attempt": item.get("attempt"), "state": item.get("state"),
             "phase": item.get("phase"), "host": item.get("host"),
             "started_at": item.get("started_at"),
             "ended_at": item.get("completed_at") or item.get("failed_at"),
             "elapsed_seconds": _seconds(item.get("started_at"),
                                        item.get("completed_at") or item.get("failed_at"))}
            for item in history
        ]
        current_end = execution.get("completed_at") or execution.get("failed_at")
        snapshots.append({
            "run_id": key, "state": run["state"],
            "profile_id": run["selection"]["profile_id"],
            "scenario_id": run["selection"]["scenario_id"],
            "host": execution.get("host"), "pid": execution.get("pid"),
            "attempt": execution.get("attempt"), "phase": execution.get("phase"),
            "started_at": execution.get("started_at"), "ended_at": current_end,
            "attempt_elapsed_seconds": _seconds(execution.get("started_at"), current_end),
            "previous_attempts": previous_attempts,
            "recorded_storage": execution.get("storage"),
            "storage_recorded_at": execution.get("storage_recorded_at"),
            "error": run.get("error"),
            "output_files": len(run_files),
            "output_logical_bytes": sum(item["bytes"] for item in run_files.values()),
        })
    totals = {}
    for model in sorted({row["model"] for row in rows}):
        selected = [row for row in rows if row["model"] == model]
        counts = Counter(row["state"] for row in selected)
        native = [row["native_elapsed_seconds"] for row in selected
                  if row["native_elapsed_seconds"] is not None]
        transfers = [row["reuse_elapsed_seconds"] for row in selected
                     if row["reuse_elapsed_seconds"] is not None]
        reused_rows = [row for row in selected if row["state"] == "reused"]
        transfer_bytes = [row["transfer_logical_bytes"] for row in reused_rows
                          if row["transfer_logical_bytes"] is not None]
        methods = Counter()
        for row in selected:
            methods.update(row["transfer_methods"])
        totals[model] = {
            "selected_stages": len(selected), "calculated_stages": counts["calculated"],
            "reused_stages": counts["reused"], "pending_stages": counts["pending"],
            "native_timed_stages": len(native), "native_elapsed_seconds": sum(native) if native else None,
            "reuse_timed_stages": len(transfers),
            "reuse_elapsed_seconds": sum(transfers) if transfers else None,
            "output_logical_bytes": sum(row["output_logical_bytes"] for row in selected),
            "transfer_measured_stages": len(transfer_bytes),
            "transfer_unknown_stages": len(reused_rows) - len(transfer_bytes),
            "transfer_logical_bytes": sum(transfer_bytes) if transfer_bytes else None,
            "transfer_methods": dict(methods),
        }
    return {
        "schema": SCHEMA, "experiment_id": summary["id"],
        "workspace_id": summary["workspace_id"],
        "summary_generated_at": summary["generated_at"],
        "observed_at": observed_at or now(),
        "planned_cases": summary.get("counts", {}).get("cases"),
        "materialized_cases": len(summary.get("rows", [])),
        "requested_runs": len(requested), "read_runs": len(seen),
        "unavailable_runs": list(unavailable),
        "models": totals, "stages": rows, "runs": snapshots,
        "output_files": len(all_files),
        "output_logical_bytes": sum(item["bytes"] for item in all_files.values()),
        "sources": list(sources),
        "definitions": {
            "selection": "Distinct run and paired baseline IDs retained in this experiment summary.",
            "native_time": "Completed local native-stage elapsed time, including registry capture; reused donor duration is excluded.",
            "reuse_time": "Observed transfer elapsed time for completed reused stages.",
            "timing": "Elapsed intervals come from complete timezone-aware timestamps; unknown or reversed intervals stay null.",
            "bytes": "Global logical lengths of retained native and exported output files, deduplicated by run and relative path; model rows sum their separate stage output inventories.",
            "transfer": "Logical bytes and methods recorded by the independent stage importer; reflinks can share physical storage.",
            "storage": "Timestamped worker filesystem observations; shared free space is never summed across runs.",
            "snapshot": "Run metadata observed when the report is built; the experiment summary keeps its own publication time.",
        },
    }


def collect(workspace, summary):
    """Read each selected run once without loading any native/GIS library."""
    ids = sorted({case[field] for case in summary.get("rows", [])
                  for field in ("run_id", "baseline_run_id") if case.get(field)})
    runs, sources, unavailable = [], [], []
    for key in ids:
        try:
            inspected = workspace.inspect_run(key)
            relative = "runs/" + key + "/run.json"
            path = relative_file(workspace.root, relative)
            body = path.read_bytes()
            run = json.loads(body)
            if run["id"] != key or run["selection"] != inspected["selection"]:
                raise ValueError("Execution snapshot changed its selected native run")
            runs.append(run)
            sources.append({"run_id": key, "path": relative, "bytes": len(body),
                            "sha256": hashlib.sha256(body).hexdigest()})
        except FileNotFoundError:
            unavailable.append({"run_id": key, "state": "not materialized"})
    return from_runs(summary, runs, sources=sources, unavailable=unavailable)


def csv_bytes(accounting):
    columns = (
        "run_id", "model", "state", "source_run_id", "input_signature",
        "started_at", "completed_at", "native_elapsed_seconds", "reuse_elapsed_seconds",
        "source_native_elapsed_seconds", "output_files", "output_logical_bytes",
        "transfer_logical_bytes",
    )
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for row in accounting["stages"]:
        writer.writerow({name: row.get(name) for name in columns})
    return output.getvalue().encode("utf-8")
