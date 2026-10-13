"""Retain original native execution history without running or re-timing a model."""
from __future__ import annotations

from copy import deepcopy
import csv
from datetime import datetime, timezone
import hashlib
import html
import io
import json
import os
from pathlib import Path
import zipfile

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     held, identifier, now, read_json, verify_file)

ROOT = "native-run-histories"
SCHEMA = "upstate.native-run-history/v1"
SELECTION_SCHEMA = "upstate.native-run-history-selection/v1"
FORMAT_VERSION = 1
MAX_RUNS = 1000
NOTES = [
    "Intervals come from retained original records. Missing, timezone-free or reversed bounds remain unavailable.",
    "Native stage duration covers the producer's recorded stage interval, including registry retention; it is not a CPU benchmark.",
    "A reused stage retains its donor's original calculation bounds. Those bounds are excluded from work performed for this receiving run.",
    "Reuse transfer duration uses reuse_started_at and reused_at; it is not native model execution time.",
    "Attempt intervals include input checks, waiting, transfer, calculation and export. Closed-interval unions count overlap once; their span also includes gaps.",
    "Interrupted attempts without a recorded end remain open. recovered_at and updated_at are observations, not invented stop times.",
    "Recorded execution histories may be partial. Durations describe retained intervals, not an estimate of missing history.",
    "Cross-host interval comparisons depend on the original hosts\u0027 clock synchronization. Full attempt host records are retained.",
    "N/P and sediment values remain the original output descriptors with their declared units. Timing does not change or recompute scientific results.",
    "JSON retains original values. CSV text beginning with a spreadsheet formula character is prefixed with an apostrophe.",
]


def _stamp(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if stamp.tzinfo is None or stamp.utcoffset() is None:
            return None
        return stamp.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return None


def interval(start, end):
    left, right = _stamp(start), _stamp(end)
    issue = ("start_not_recorded" if start is None else "invalid_start") if left is None else (
        ("end_not_recorded" if end is None else "invalid_end") if right is None else
        ("end_before_start" if right < left else None))
    return {"started_at": start, "ended_at": end,
            "seconds": None if issue else (right - left).total_seconds(),
            "status": issue or "recorded"}


def _interval_summary(rows):
    valid = [row for row in rows if row["status"] == "recorded"]
    spans = sorted((_stamp(row["started_at"]), _stamp(row["ended_at"])) for row in valid)
    merged = []
    for start, end in spans:
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return {"records": len(rows), "closed_records": len(valid),
            "unavailable_records": len(rows) - len(valid),
            "sum_seconds": sum(row["seconds"] for row in valid) if valid else None,
            "union_seconds": sum((end - start).total_seconds() for start, end in merged) if merged else None,
            "span_seconds": (max(end for _, end in spans) - spans[0][0]).total_seconds() if spans else None,
            "earliest_start": spans[0][0].isoformat() if spans else None,
            "latest_end": max(end for _, end in spans).isoformat() if spans else None}


def _attempts(run):
    result = []
    history = run.get("execution_history", [])
    if not isinstance(history, list):
        raise ValueError("The retained execution history must be a list")
    originals = [("history", index, row) for index, row in enumerate(history, 1)]
    if run.get("execution") is not None:
        originals.append(("current", len(history) + 1, run["execution"]))
    for location, position, row in originals:
        if not isinstance(row, dict):
            raise ValueError("Each retained native attempt must be an object")
        # A recovered process has no proven termination time unless the producer
        # recorded one. Never substitute recovered_at or a resource observation.
        end = row.get("completed_at") if row.get("state") == "complete" else (
            row.get("failed_at") if row.get("state") == "failed" else None)
        result.append({"run_id": run["id"], "position": position, "location": location,
                       "attempt": row.get("attempt"), "state": row.get("state"),
                       "phase": row.get("phase"), "interval": interval(row.get("started_at"), end),
                       "original": deepcopy(row)})
    return result


def _reuse_lineage(value):
    lineage, seen = [], set()
    current = value
    while current is not None:
        if not isinstance(current, dict):
            raise ValueError("Retained native stage reuse lineage must be an object")
        # Content identity detects cycles after JSON decoding without collapsing
        # different transfers from the same donor/model.
        marker = digest({key: val for key, val in current.items() if key != "previous_reuse"})
        if marker in seen or len(lineage) >= 1000:
            raise ValueError("Retained native stage reuse lineage is cyclic or too deep")
        seen.add(marker)
        lineage.append(deepcopy({key: val for key, val in current.items() if key != "previous_reuse"}))
        current = current.get("previous_reuse")
    return lineage


def _stages(run):
    result = []
    stages = run.get("stages", {})
    if not isinstance(stages, dict):
        raise ValueError("The retained native stage registry must be an object")
    for model in ("ndr", "sdr"):
        if model not in stages:
            continue
        stage = stages[model]
        if not isinstance(stage, dict):
            raise ValueError("The original native stage must be an object")
        reused = stage.get("reused_from") is not None
        original_interval = interval(stage.get("started_at"), stage.get("completed_at"))
        result.append({"run_id": run["id"], "model": model,
                       "origin": "reused" if reused else "this_run",
                       "original_calculation": original_interval,
                       "local_calculation": None if reused else deepcopy(original_interval),
                       "transfer": interval(stage.get("reuse_started_at"), stage.get("reused_at")) if reused else None,
                       "reuse_lineage": _reuse_lineage(stage.get("reused_from")),
                       "files": len(stage.get("files") or {}),
                       "input_signature": deepcopy(stage.get("input_signature")),
                       "runtime": deepcopy(stage.get("runtime") or run.get("runtime")),
                       "original": deepcopy(stage)})
    return result


def _selection(value):
    if not isinstance(value, dict):
        raise ValueError("Select retained native run IDs")
    ids = value.get("run_ids")
    if not isinstance(ids, list) or not ids or len(ids) > MAX_RUNS:
        raise ValueError("Select between 1 and 1000 original native runs")
    ids = [identifier(key) for key in ids]
    if len(ids) != len(set(ids)):
        raise ValueError("Select each original native run once")
    title = value.get("title", "Native execution history")
    if not isinstance(title, str) or not title.strip() or len(title) > 240:
        raise ValueError("Name the native execution history in at most 240 characters")
    return {"run_ids": ids, "title": title.strip()}


def snapshot(workspace, selection):
    selected = _selection(selection)
    originals, contexts = [], {"grids": {}, "profiles": {}, "scenarios": {}}
    for key in selected["run_ids"]:
        row = deepcopy(workspace.inspect_run(key))
        if row.get("id") != key:
            raise ValueError("The native run identity differs from its selected original")
        originals.append(row)
        for field, family in (("grid_id", "grids"), ("profile_id", "profiles"),
                              ("scenario_id", "scenarios")):
            reference = identifier(row["selection"][field])
            if reference not in contexts[family]:
                value = workspace.get_grid(reference) if family == "grids" else workspace._get(family, reference)
                if value.get("id") != reference:
                    raise ValueError("The original native input identity differs")
                contexts[family][reference] = deepcopy(value)
    binding = {"schema": SELECTION_SCHEMA, "format_version": FORMAT_VERSION,
               "project_id": workspace.project["id"], "selection": selected,
               "runs": [{"id": row["id"], "sha256": digest(row)} for row in originals],
               "contexts": {kind: {key: digest(value) for key, value in rows.items()}
                            for kind, rows in contexts.items()}}
    return {"id": digest(binding), "binding": binding, "project": deepcopy(workspace.project),
            "runs": originals, "contexts": contexts}


def summarize(original):
    runs, attempts, stages = [], [], []
    for run in original["runs"]:
        current_attempts, current_stages = _attempts(run), _stages(run)
        attempts.extend(current_attempts)
        stages.extend(current_stages)
        selection = run["selection"]
        scenario = original["contexts"]["scenarios"][selection["scenario_id"]]
        profile = original["contexts"]["profiles"][selection["profile_id"]]
        grid = original["contexts"]["grids"][selection["grid_id"]]
        runs.append({"id": run["id"], "state": run.get("state"),
                     "title": scenario.get("title") or run["id"],
                     "scenario_kind": scenario.get("kind"), "profile_title": profile.get("title"),
                     "selection": deepcopy(selection), "grid": deepcopy(grid.get("grid")),
                     "original_sha256": digest(run), "attempt_count": len(current_attempts),
                     "reused_stages": sum(row["origin"] == "reused" for row in current_stages),
                     "attempt_intervals": _interval_summary([row["interval"] for row in current_attempts]),
                     "local_stage_intervals": _interval_summary([row["local_calculation"] for row in current_stages
                                                                if row["local_calculation"] is not None]),
                     "artifacts": deepcopy(run.get("artifacts", {}))})
    return {"runs": runs, "attempts": attempts, "stages": stages,
            "summary": {"selected_runs": len(runs),
                        "runs_with_attempts": sum(row["attempt_count"] > 0 for row in runs),
                        "runs_without_attempts": sum(row["attempt_count"] == 0 for row in runs),
                        "attempt_intervals": _interval_summary([row["interval"] for row in attempts]),
                        "local_stage_intervals": _interval_summary([row["local_calculation"] for row in stages
                                                                   if row["local_calculation"] is not None]),
                        "reused_stage_count": sum(row["origin"] == "reused" for row in stages),
                        "reuse_transfer_intervals": _interval_summary([row["transfer"] for row in stages
                                                                     if row["transfer"] is not None])},
            "interpretation": list(NOTES)}


def preview(workspace, selection):
    original = snapshot(workspace, selection)
    result = summarize(original)
    return {"schema": SCHEMA, "id": original["id"], "project_id": workspace.project["id"],
            "title": original["binding"]["selection"]["title"],
            "selection": original["binding"]["selection"], **result}


def _csv_cell(value):
    if value is None:
        return ""
    text = str(value)
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text


def _csv(headings, rows):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(headings)
    for row in rows:
        writer.writerow([value if type(value) in (int, float) else _csv_cell(value) for value in row])
    return stream.getvalue().encode("utf-8")


def _seconds(value):
    return "Not recorded" if value is None else format(value, ".6f").rstrip("0").rstrip(".") + " s"


def _table(headers, rows):
    return "<div class='table-scroll'><table><thead><tr>" + "".join("<th>" + html.escape(str(v)) + "</th>" for v in headers) + "</tr></thead><tbody>" + "".join(
        "<tr>" + "".join("<td>" + html.escape("Not recorded" if v is None else str(v)) + "</td>" for v in row) + "</tr>"
        for row in rows) + "</tbody></table></div>"


def _html(document):
    summary = document["summary"]
    attempt = summary["attempt_intervals"]
    local = summary["local_stage_intervals"]
    body = "<header><p>UPPER SAVANNAH SCIENTIFIC WORKBENCH</p><h1>" + html.escape(document["title"]) + "</h1><p>Original project " + html.escape(document["project_id"]) + "</p></header>"
    body += "<p>Saved " + html.escape(document["captured_at"]) + " · " + str(summary["selected_runs"]) + " selected runs · " + str(summary["reused_stage_count"]) + " reused native stages.</p>"
    body += "<h2>Recorded execution intervals</h2>" + _table(
        ["Measure", "Elapsed", "Coverage"],
        [["Attempt intervals, overlap counted once", _seconds(attempt["union_seconds"]),
          str(attempt["closed_records"]) + " closed / " + str(attempt["records"]) + " recorded attempts"],
         ["Span from earliest recorded start to latest recorded end, including gaps", _seconds(attempt["span_seconds"]),
          str(summary["runs_without_attempts"]) + " selected runs have no retained attempts"],
         ["Local native-stage intervals, overlap counted once", _seconds(local["union_seconds"]),
          str(local["closed_records"]) + " closed / " + str(local["records"]) + " local native stages"],
         ["Verified-reuse transfer intervals, overlap counted once", _seconds(summary["reuse_transfer_intervals"]["union_seconds"]),
          str(summary["reuse_transfer_intervals"]["closed_records"]) + " closed transfers"]])
    body += "<h2>Selected native runs</h2>" + _table(
        ["Scenario", "Profile", "State", "Models", "Grid", "Attempts", "Run ID"],
        [[row["title"], row["profile_title"], row["state"], ", ".join(row["selection"].get("models", ["ndr", "sdr"])),
          row["selection"]["grid_id"], row["attempt_count"], row["id"]] for row in document["runs"]])
    body += "<h2>Original attempts</h2>" + _table(
        ["Run", "Attempt", "State / last phase", "Started", "Ended", "Duration", "Bounds"],
        [[row["run_id"], row["attempt"] if row["attempt"] is not None else row["position"],
          str(row["state"]) + " / " + str(row["phase"]), row["interval"]["started_at"],
          row["interval"]["ended_at"], _seconds(row["interval"]["seconds"]), row["interval"]["status"]]
         for row in document["attempts"]])
    body += "<h2>Native stages and inherited work</h2>" + _table(
        ["Run", "Model", "Origin", "Original calculation start", "Original calculation end", "Original duration", "Transfer duration", "Donor run"],
        [[row["run_id"], row["model"].upper(), row["origin"], row["original_calculation"]["started_at"],
          row["original_calculation"]["ended_at"], _seconds(row["original_calculation"]["seconds"]),
          _seconds(row["transfer"]["seconds"]) if row["transfer"] else "Not applicable",
          row["reuse_lineage"][0].get("run_id") if row["reuse_lineage"] else "This run"]
         for row in document["stages"]])
    body += "<h2>Scientific bindings</h2><p>Each selected run preserves the original grid, parameter profile, scenario, native runtime and output descriptors. Full records and multi-hop reuse lineage are in history.json and originals/.</p>"
    body += "<h2>Interpretation</h2><ul>" + "".join("<li>" + html.escape(note) + "</li>" for note in NOTES) + "</ul>"
    body += "<h2>Open the retained files</h2><ul>" + "".join("<li><a href='" + name + "'>" + name + "</a></li>" for name in ("history.json", "runs.csv", "attempts.csv", "stages.csv", "identity.json", "MANIFEST.json")) + "</ul>"
    return ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>" + html.escape(document["title"]) + "</title><style>"
            "body{font:15px/1.55 system-ui,sans-serif;color:#181818;background:#fff;margin:0 auto;padding:24px;max-width:1500px}"
            "h1{font-size:30px}h2{margin-top:32px;font-size:21px}header{border-bottom:2px solid #333}"
            "p,li{max-width:1100px}.table-scroll{overflow:auto;border:1px solid #bbb}table{border-collapse:collapse;width:100%}"
            "th,td{border-bottom:1px solid #ccc;text-align:left;vertical-align:top;padding:9px;overflow-wrap:anywhere;min-width:100px}"
            "th{background:#eee}a{color:#222;text-decoration:underline}@media(max-width:600px){body{padding:14px}h1{font-size:25px}}"
            "@media print{.table-scroll{overflow:visible}th,td{font-size:9px;padding:4px;min-width:0}body{padding:0}}</style><body>"
            + body + "</body></html>").encode("utf-8")


def _verify_originals(original, key, project_id):
    binding = original["binding"]
    if (original.get("id") != key or digest(binding) != key or
            binding.get("schema") != SELECTION_SCHEMA or binding.get("format_version") != FORMAT_VERSION or
            binding.get("project_id") != project_id or original.get("project", {}).get("id") != project_id):
        raise ValueError("The saved execution history belongs to another original project or selection")
    if ([row["id"] for row in original["runs"]] != binding["selection"]["run_ids"] or
            [{"id": row["id"], "sha256": digest(row)} for row in original["runs"]] != binding["runs"] or
            {kind: {reference: digest(value) for reference, value in rows.items()}
             for kind, rows in original["contexts"].items()} != binding["contexts"]):
        raise ValueError("The retained native run or scientific context snapshot changed")


def inspect(workspace, key):
    key = identifier(key)
    directory = workspace.root / ROOT / key
    record = read_json(directory / "report.json")
    if record.get("schema") != SCHEMA or record.get("id") != key or record.get("project_id") != workspace.project["id"]:
        raise ValueError("Open this saved execution history in its original project or restored copy")
    files = record.get("files")
    if not isinstance(files, dict) or not files:
        raise ValueError("The saved execution history lacks its retained file inventory")
    for name, item in files.items():
        if item.get("path") != name:
            raise ValueError("The execution history member name differs from its saved path")
        verify_file(directory, item)
    original = read_json(verify_file(directory, files["originals.json"]))
    _verify_originals(original, key, workspace.project["id"])
    manifest = read_json(verify_file(directory, files["MANIFEST.json"]))
    members = {name: item for name, item in files.items() if name not in {"MANIFEST.json", "history.zip"}}
    if manifest.get("id") != key or manifest.get("members") != members:
        raise ValueError("The execution history manifest differs")
    document = read_json(verify_file(directory, files["history.json"]))
    if (document.get("id") != key or document.get("project_id") != workspace.project["id"] or
            document.get("selection") != original["binding"]["selection"] or
            document.get("title") != original["binding"]["selection"]["title"] or
            document.get("captured_at") != original.get("captured_at") or
            any(document.get(name) != value for name, value in summarize(original).items())):
        raise ValueError("The readable history differs from its retained original run records")
    if (record.get("selection") != document["selection"] or record.get("title") != document["title"] or
            record.get("captured_at") != document["captured_at"] or record.get("summary") != document["summary"]):
        raise ValueError("The saved execution history catalogue differs from its original snapshot")
    with zipfile.ZipFile(verify_file(directory, files["history.zip"])) as archive:
        expected = {name: item for name, item in files.items() if name != "history.zip"}
        if len(archive.infolist()) != len(expected) or set(archive.namelist()) != set(expected):
            raise ValueError("The execution archive contains missing or duplicate members")
        for name, item in expected.items():
            info = archive.getinfo(name)
            if info.file_size != item["bytes"] or info.is_dir():
                raise ValueError("The execution archive member length differs")
            checksum = hashlib.sha256()
            with archive.open(info) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    checksum.update(block)
            if checksum.hexdigest() != item["sha256"]:
                raise ValueError("The original execution archive member changed")
    return deepcopy(record)


def build(workspace, selection, expected_id):
    key = identifier(expected_id)
    selected = _selection(selection)
    directory = workspace.root / ROOT / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".history.lock", blocking=False):
        if (directory / "report.json").is_file():
            record = inspect(workspace, key)
            if record["selection"] != selected:
                raise ValueError("The saved execution history belongs to another selection")
            return record
        original_path = directory / "originals.json"
        if original_path.exists():
            original = read_json(original_path)
            _verify_originals(original, key, workspace.project["id"])
            if original["binding"]["selection"] != selected:
                raise ValueError("The retained execution snapshot belongs to another selection")
        else:
            original = snapshot(workspace, selected)
            if original["id"] != key:
                raise ValueError("The original run history changed after preview; review its current records")
            original["captured_at"] = now()
            atomic_json(original_path, original, immutable=True)
        document = {"schema": SCHEMA, "id": key, "project_id": workspace.project["id"],
                    "title": selected["title"], "selection": selected,
                    "captured_at": original["captured_at"], **summarize(original)}
        files = {"originals.json": describe_file(directory, original_path)}
        def emit(name, body):
            if not isinstance(body, bytes):
                body = canonical(body) + b"\n"
            path = directory / name
            # Preserve a previously retained readable edition after an interrupted
            # publication; the frozen originals remain its scientific identity.
            if name != "index.html" or not path.exists():
                atomic_bytes(path, body, immutable=True)
            files[name] = describe_file(directory, path)
        emit("identity.json", original["binding"])
        emit("history.json", document)
        emit("index.html", _html(document))
        for row in original["runs"]:
            emit("originals/runs/" + row["id"] + ".json", row)
        for family, rows in original["contexts"].items():
            for reference, value in rows.items():
                emit("originals/" + family + "/" + reference + ".json", value)
        emit("runs.csv", _csv(["run_id", "scenario", "scenario_kind", "profile", "state", "grid_id", "profile_id", "scenario_id", "attempt_count", "reused_stages"],
            [[row["id"], row["title"], row["scenario_kind"], row["profile_title"], row["state"],
              row["selection"]["grid_id"], row["selection"]["profile_id"], row["selection"]["scenario_id"],
              row["attempt_count"], row["reused_stages"]] for row in document["runs"]]))
        emit("attempts.csv", _csv(["run_id", "position", "attempt", "state", "phase", "started_at", "ended_at", "elapsed_seconds", "interval_status"],
            [[row["run_id"], row["position"], row["attempt"], row["state"], row["phase"],
              row["interval"]["started_at"], row["interval"]["ended_at"], row["interval"]["seconds"],
              row["interval"]["status"]] for row in document["attempts"]]))
        emit("stages.csv", _csv(["run_id", "model", "origin", "original_started_at", "original_completed_at", "original_elapsed_seconds",
                               "local_elapsed_seconds", "transfer_started_at", "transfer_completed_at", "transfer_seconds", "donor_run_id", "reuse_hops"],
            [[row["run_id"], row["model"], row["origin"], row["original_calculation"]["started_at"],
              row["original_calculation"]["ended_at"], row["original_calculation"]["seconds"],
              row["local_calculation"]["seconds"] if row["local_calculation"] else None,
              row["transfer"]["started_at"] if row["transfer"] else None,
              row["transfer"]["ended_at"] if row["transfer"] else None,
              row["transfer"]["seconds"] if row["transfer"] else None,
              row["reuse_lineage"][0].get("run_id") if row["reuse_lineage"] else None, len(row["reuse_lineage"])]
             for row in document["stages"]]))
        manifest = {"schema": "upstate.native-run-history-files/v1", "id": key, "members": deepcopy(files)}
        atomic_json(directory / "MANIFEST.json", manifest, immutable=True)
        files["MANIFEST.json"] = describe_file(directory, directory / "MANIFEST.json")
        target, pending = directory / "history.zip", directory / ".history.zip.pending"
        if not target.exists():
            try:
                with zipfile.ZipFile(pending, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                    for name, item in sorted(files.items()):
                        source = verify_file(directory, item)
                        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                        info.compress_type = zipfile.ZIP_DEFLATED
                        checksum, size = hashlib.sha256(), 0
                        with source.open("rb") as incoming, archive.open(info, "w", force_zip64=True) as out:
                            for block in iter(lambda: incoming.read(1024 * 1024), b""):
                                checksum.update(block); size += len(block); out.write(block)
                        if size != item["bytes"] or checksum.hexdigest() != item["sha256"]:
                            raise ValueError("A retained execution history member changed during export")
                os.replace(pending, target)
            finally:
                pending.unlink(missing_ok=True)
        files["history.zip"] = describe_file(directory, target)
        record = {"schema": SCHEMA, "id": key, "project_id": workspace.project["id"],
                  "title": selected["title"], "selection": selected, "captured_at": original["captured_at"],
                  "summary": document["summary"], "files": files}
        atomic_json(directory / "report.json", record, immutable=True)
        return inspect(workspace, key)


def catalog(workspace):
    result = []
    for path in sorted((workspace.root / ROOT).glob("*/report.json")):
        row = read_json(path)
        if row.get("id") != path.parent.name or row.get("project_id") != workspace.project["id"] or row.get("schema") != SCHEMA:
            raise ValueError("An execution history catalogue record belongs to another project")
        result.append({name: deepcopy(row[name]) for name in
                       ("id", "title", "selection", "captured_at", "summary")})
    return sorted(result, key=lambda row: (row["captured_at"], row["id"]), reverse=True)
