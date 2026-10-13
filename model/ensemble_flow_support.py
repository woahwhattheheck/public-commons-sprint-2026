"""Bind original daily-flow support to admitted annual-reference records."""
from __future__ import annotations

from copy import deepcopy
from datetime import date
import html
import json
from pathlib import Path
import shutil
import subprocess

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, held, identifier, now, read_json, relative_file,
                     verify_file)
from . import ensemble_references

ROLE = "discharge-reference-period-support"
SCHEMA = "upstate.discharge-reference-period-support/v1"
SOURCE_DIRECTORY = "source/hydrology-huc05-07-20261013"
SUMMARY_FIELDS = (
    "record_id", "observation_id", "original_preparation_id", "station_id",
    "flow_station_id", "flow_binding_basis", "flow_site_no", "flow_ts_id",
    "catchment_id", "parameter", "method", "original_period_start",
    "original_period_end", "expected_days", "captured_period_intersection",
    "days_outside_captured_period", "status", "numeric_days",
    "source_record_days", "coverage_fraction", "fully_supported_reference_period",
    "covered_days_volume_m3", "complete_reference_period_volume_m3",
    "source_qualifier_counts", "numeric_qualifier_counts",
)


def _member(entry, name):
    candidates = [body for body in [entry["body"], *entry.get("companions", [])]
                  if body.get("view_path", body.get("filename")) == name]
    if len(candidates) != 1:
        raise ValueError("Retain the original flow-support companion: " + name)
    body = candidates[0]
    return {"path": body["object"], "bytes": body["bytes"], "sha256": body["sha256"]}


def _read(workspace, source):
    if not isinstance(source, dict):
        raise ValueError("Choose a retained original flow-support source")
    collection = identifier(source.get("collection_id"))
    key = source.get("source_id")
    path, entry = workspace.source_file(collection, key)
    if entry.get("role") != ROLE or entry.get("kind") != "table":
        raise ValueError("Choose the original discharge-reference-period-support table")
    if source.get("source_sha256") and source["source_sha256"] != entry["body"]["sha256"]:
        raise ValueError("The selected original flow-support edition changed")
    descriptor = _member(entry, "flow-support/reference-period-support.json")
    result = read_json(verify_file(workspace.root, descriptor))
    if result.get("schema") != SCHEMA or not isinstance(result.get("records"), list):
        raise ValueError("Retain the original reference-period support result")
    if result.get("record_count") != len(result["records"]):
        raise ValueError("Original reference-period support record count differs")
    files = {
        "flow_support_json": descriptor,
        "flow_support_csv": describe_file(workspace.root, path),
        "flow_reference_binding": _member(entry, "flow-support/selected-reference-binding.json"),
        "flow_date_support": _member(entry, "flow-support/station-date-support.json"),
    }
    return result, entry, {
        "collection_id": collection, "source_id": key,
        "source_sha256": entry["body"]["sha256"],
        "result_sha256": descriptor["sha256"],
    }, files


def _summary(row):
    result = {key: deepcopy(row.get(key)) for key in SUMMARY_FIELDS}
    original = row.get("summary") or {}
    result["daily_summary"] = {key: original.get(key) for key in (
        "approved_days", "estimated_days", "provisional_days", "revised_days",
        "absent_date_days", "non_numeric_days", "mean_cfs", "p05_daily_cfs",
        "p50_daily_cfs", "p95_daily_cfs", "minimum_daily_cfs", "maximum_daily_cfs")}
    return result


def catalog(workspace):
    """Explicit form read; ordinary ensemble polling does not scan source bodies."""
    available, errors = [], []
    for collection in workspace._list("sources"):
        for entry in collection.get("entries", []):
            if entry.get("role") != ROLE:
                continue
            source = {"collection_id": collection["id"], "source_id": entry["id"],
                      "source_sha256": entry["body"]["sha256"]}
            try:
                result, _, actual, files = _read(workspace, source)
                binding = result.get("binding") or {}
                native = binding.get("binding") or {}
                available.append({
                    "id": digest(actual), "title": entry.get("title", entry["id"]),
                    "source": actual, "import_id": binding.get("import_id"),
                    "workspace_id": binding.get("workspace_id"),
                    "observation_id": native.get("observation_id") or binding.get("observation_id"),
                    "original_preparation_id": binding.get("original_preparation_id"),
                    "source_period": result.get("source_period"),
                    "record_count": result["record_count"],
                    "status_counts": result.get("status_counts", {}),
                    "rows": [_summary(row) for row in result["records"]],
                })
            except (ValueError, OSError, KeyError, TypeError) as error:
                errors.append({"source": source, "error": str(error)})
    return {"sources": available, "errors": errors}


def bind(workspace, reference, source, *, record_ids=None):
    """Attach the producer's exact original records without changing observations."""
    if not reference or reference.get("workspace_id") != workspace.project["id"]:
        raise ValueError("Choose this workspace's original annual-reference import")
    result, entry, actual, files = _read(workspace, source)
    binding = result.get("binding") or {}
    expected = reference["binding"]
    if (binding.get("import_id") != reference["import_id"]
            or binding.get("workspace_id") != reference["workspace_id"]
            or binding.get("original_preparation_id") != reference["original_preparation_id"]
            or binding.get("binding") != expected):
        raise ValueError("Flow support belongs to a different original annual-reference binding")
    originals = {row["id"]: row for row in reference["reference_records"]}
    if len(originals) != len(reference["reference_records"]):
        raise ValueError("The admitted reference edition repeats a native record ID")
    selected = list(originals) if record_ids is None else list(record_ids)
    if not selected or len(set(selected)) != len(selected) or set(selected) - set(originals):
        raise ValueError("Choose distinct admitted annual-reference record IDs for flow context")
    rows = {}
    for row in result["records"]:
        key = row.get("record_id")
        if key in rows:
            raise ValueError("The original flow-support result repeats a record ID")
        if key not in originals:
            continue
        original = originals[key]
        if row.get("original_reference_record") != original:
            raise ValueError("Original observation, station, method or period differs for " + key)
        if (row.get("observation_id") != expected["observation_id"]
                or row.get("original_period_start") != original["period_start"]
                or row.get("original_period_end") != original["period_end"]
                or row.get("period_end_exclusive") is not True):
            raise ValueError("Flow-support record identity or exclusive interval differs for " + key)
        days = (date.fromisoformat(original["period_end"]) - date.fromisoformat(original["period_start"])).days
        if days <= 0 or row.get("expected_days") != days:
            raise ValueError("Original flow-support calendar denominator differs for " + key)
        numeric = row.get("numeric_days")
        if numeric is not None and (isinstance(numeric, bool) or not isinstance(numeric, int)
                                    or not 0 <= numeric <= days):
            raise ValueError("Original numeric daily coverage differs for " + key)
        rows[key] = row
    missing = set(selected) - set(rows)
    if missing:
        raise ValueError("Retained flow support omits selected reference records: " + ", ".join(sorted(missing)))
    selected_rows = [_summary(rows[key]) for key in selected]
    counts = {}
    for row in selected_rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    return {
        "schema": "upstate.ensemble-flow-support-binding/v1",
        "source": actual, "title": entry.get("title", entry["id"]),
        "import_id": reference["import_id"], "observation_id": expected["observation_id"],
        "original_preparation_id": reference["original_preparation_id"],
        "source_period": result["source_period"], "source_operation_id": result.get("source_operation_id"),
        "source_originals": result.get("source_originals", []),
        "methods": result.get("methods", {}), "record_ids": selected,
        "record_count": len(selected), "status_counts": counts,
        "rows": selected_rows, "files": files,
    }


def _report(value):
    esc = lambda x: html.escape("" if x is None else str(x), quote=True)
    columns = [
        ("record_id", "Original record"), ("parameter", "Constituent"),
        ("station_id", "Observation station"), ("flow_station_id", "Original flow station"),
        ("flow_ts_id", "USGS series"), ("original_period_start", "Start"),
        ("original_period_end", "End exclusive"), ("status", "Source support"),
        ("numeric_days", "Numeric days"), ("expected_days", "Requested days"),
        ("days_outside_captured_period", "Outside captured period"),
        ("covered_days_volume_m3", "Covered-days volume m³"),
        ("complete_reference_period_volume_m3", "Complete-period volume m³"),
    ]
    headings = "".join("<th>" + esc(label) + "</th>" for _, label in columns)
    rows = "".join("<tr>" + "".join("<td>" + esc(row.get(key)) + "</td>" for key, _ in columns)
                   + "</tr>" for row in value["rows"])
    return ("<!doctype html><html lang='en'><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width'><title>Original flow-period support</title>"
        "<style>body{font:15px system-ui;color:#222;background:white;margin:32px}"
        "table{border-collapse:collapse;font-size:13px}th,td{border:1px solid #bbb;padding:7px;text-align:left}"
        "th{background:#eee}code{overflow-wrap:anywhere}.scroll{overflow:auto}</style>"
        "<h1>Original daily-flow support for annual references</h1><p>Import <code>"
        + esc(value["import_id"]) + "</code> · observation <code>" + esc(value["observation_id"])
        + "</code></p><p>Every interval uses its original exclusive end date. Numeric, estimated and provisional "
        "source days retain their original flags. Covered-days volume uses available daily means; "
        "missing dates and unresolved station mappings remain visible.</p><div class='scroll'><table><thead><tr>"
        + headings + "</tr></thead><tbody>" + rows + "</tbody></table></div><h2>Source methods</h2>"
        + "".join("<p><strong>" + esc(key.replace("_", " ")) + ".</strong> " + esc(text) + "</p>"
                  for key, text in value["methods"].items()) + "</html>")


def retain_report(workspace, support):
    """Portable readable companion, keyed only by its retained source and record choice."""
    key = digest(support)
    directory = workspace.root / "ensemble-flow-reports" / key
    report = directory / "flow-reference-support.html"
    atomic_bytes(report, _report(support).encode("utf-8"), immutable=True)
    return {**support, "files": {**support["files"],
            "flow_support_report": describe_file(workspace.root, report)}}


def prepare(workspace, import_id, *, source_root=None, node=None):
    """Replay the original source author's processor in the existing task operation."""
    reference = ensemble_references.resolve(workspace, import_id, verify=True)
    root = Path(source_root) if source_root else Path(__file__).resolve().parents[1] / SOURCE_DIRECTORY
    root = root.resolve(strict=True)
    script = root / "rebuild_reference_support.mjs"
    inputs = root / "reference-support-inputs.json"
    producer = {"source_inputs_sha256": file_digest(inputs), "replay_sha256": file_digest(script)}
    key = digest({"schema": "upstate.ensemble-flow-operation/v1", "reference": reference, "producer": producer})
    directory = workspace.root / "ensemble-flow-operations" / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".prepare.lock", blocking=False):
        state_path = directory / "state.json"
        old = read_json(state_path) if state_path.exists() else {}
        if old.get("state") == "complete":
            linked = bind(workspace, reference, old["source"])
            return {**old, "support": retain_report(workspace, linked)}
        executable = node or shutil.which("node")
        if not executable:
            raise OSError("The original flow-support replay requires Node.js in this receiving runtime")
        binding_path = directory / "original-reference.json"
        atomic_json(binding_path, reference, immutable=True)
        output = directory / "prepared"
        command = [str(executable), str(script), "--source-root", str(root), "--output", str(output),
                   "--binding", str(binding_path)]
        state = {"schema": "upstate.ensemble-flow-operation/v1", "id": key,
                 "workspace_id": workspace.project["id"], "import_id": reference["import_id"],
                 "observation_id": reference["binding"]["observation_id"],
                 "producer": producer, "state": "preparing_original_flow_support",
                 "started_at": now(), "command": command}
        atomic_json(state_path, state)
        stdout_path, stderr_path = directory / "stdout.log", directory / "stderr.log"
        try:
            with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
                process = subprocess.run(command, cwd=root, stdout=stdout, stderr=stderr, check=False)
            state["returncode"] = process.returncode
            if process.returncode:
                message = stderr_path.read_text(encoding="utf-8", errors="replace")[-6000:]
                raise ValueError("Original flow-support replay failed: " + message)
            produced = read_json(stdout_path)
            if produced.get("schema") != "upstate.discharge-reference-support-preparation/v1":
                raise ValueError("The original flow replay returned another result schema")
            manifest = output / "reference-support.sources.json"
            if Path(produced["source_manifest"]).resolve() != manifest.resolve():
                raise ValueError("The original flow manifest belongs to another preparation")
            collection = workspace.import_sources(manifest)
            matches = [entry for entry in collection["entries"] if entry.get("role") == ROLE]
            if len(matches) != 1:
                raise ValueError("The prepared original source needs one reference-period support table")
            entry = matches[0]
            source = {"collection_id": collection["id"], "source_id": entry["id"],
                      "source_sha256": entry["body"]["sha256"]}
            linked = retain_report(workspace, bind(workspace, reference, source))
            state.update(state="complete", completed_at=now(), source=source,
                         source_collection_id=collection["id"], record_count=linked["record_count"],
                         status_counts=linked["status_counts"],
                         files={**linked["files"],
                                "flow_replay_stdout": describe_file(workspace.root, stdout_path),
                                "flow_replay_stderr": describe_file(workspace.root, stderr_path)})
            atomic_json(state_path, state)
            return {**state, "support": linked}
        except BaseException as error:
            state.update(state="failed" if isinstance(error, Exception) else "interrupted",
                         updated_at=now(), error={"type": type(error).__name__, "message": str(error)})
            atomic_json(state_path, state)
            raise
