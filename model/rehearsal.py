"""Actual-case operator rehearsal and portable teaching records.

Copyright 2026 TokenJunkieLabs. Uses the original Workspace, task identities,
file objects and scientific-workspace archive. It never starts a model run.
"""
from __future__ import annotations
from copy import deepcopy
from datetime import datetime
import hashlib
import html
import json
import os
from pathlib import Path
import re
import tempfile
import zipfile

from .common import (
    INVEST_VERSION, MAP_IDS, atomic_bytes, atomic_json, canonical, describe_file,
    digest, file_digest, held, identifier, now, read_json, relative_file, retain_file,
)
from .model_selection import run_scope

SCHEMA = "upstate.operator-rehearsal/v1"
SELECTION_KEYS = frozenset({
    "source_collection_id", "grid_id", "profile_id", "baseline_run_id",
    "alternative_run_ids", "comparison_id", "delivery_id", "spatial_review_id",
    "backup_task_id", "restore_task_id",
})
MAX_MEDIA_BYTES = 256 * 1024 * 1024
MASS = {
    "nitrogen_export": "kg/year", "phosphorus_export": "kg/year",
    "sediment_export": "metric_tonnes/year",
}
RFP = "https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf"
NDR = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html"
SDR = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html"

LESSONS = [
    ("study", "Open the actual study",
     "Open the retained source edition and explain its date, geography and original files.",
     "The selected source title, publication URI, vintage, file identities and source scope.",
     "A source edition is the exact input used by this case. The full South Carolina reporting area and upstream modeling context are different selections.",
     "This is the actual source edition for the case; we can trace every input to its original file.",
     "sources", "source-open", "Import original sources"),
    ("geography", "Explain the model and reporting areas",
     "Open the selected grid and its spatial view. Identify the reporting boundary and upstream context.",
     "The real coordinate system, dimensions, 30 m working grid, reporting mask and source-resolution information.",
     "Thirty metres is the working cell size. Resampling a coarser input does not create finer original information. Upstream contributing areas remain in the calculation even when the presentation map is masked.",
     "The calculation includes the upstream context, and the displayed reporting area is explicitly selected.",
     "grids", "grid-new", "Prepare or inspect a model grid"),
    ("parameters", "Explain the parameter profile",
     "Open the original biophysical table and the selected NDR/SDR parameters.",
     "The retained table codes, parameter values, model period and references.",
     "Coefficients and scientific assumptions belong to the selected profile. A working profile is not automatically calibrated or scientifically approved.",
     "We can change the assumptions in a new saved profile while keeping the earlier result reproducible.",
     "profiles", "profile-new", "Open parameter controls"),
    ("alternatives", "Show the actual alternative",
     "Open the baseline and each selected alternative's land-cover scenario and original change masks.",
     "The original baseline, the exact retained polygons and land-cover changes, with a reason for each alternative.",
     "A scenario is a proposed change to the retained land cover. If a comparison also changes the parameter profile, explain that additional sensitivity change separately.",
     "This alternative changes these selected areas; the original baseline remains available.",
     "scenarios", "scenario-new", "Open scenario controls"),
    ("calculation", "Run or reopen original calculations",
     "Begin this step before using the original run controls. Follow the actual native task and log, then record the outcome.",
     "Original run IDs, InVEST version, real task attempts, native stages and completed physical outputs.",
     "A previously completed result is a recorded result. A new task that merely returns an already-complete run is not a fresh calculation. Native processing time and operator walkthrough time are shown separately.",
     "These quantities came from the models selected for this run, and this is their actual run history.",
     "runs", "run-prepare", "Open native run controls"),
    ("maps", "Read a real map",
     "Open the original map or spatial view and explain its extent, legend, units and selected case.",
     "Actual N/P/sediment artifacts or a saved map review, and any completed requested map families.",
     "NDR 3.20 raster rates are kg/ha/year and SDR rates are metric tonnes/ha/year. A 30 m cell is 0.09 ha; area totals use the retained native aggregation. Planning scores and designated protection areas have separate meanings.",
     "The legend tells us whether this is a physical export estimate, a scenario difference or a planning priority.",
     "spatial", None, None),
    ("comparison", "Explain a before-and-after result",
     "Open the saved comparison and read the selected baseline, alternatives, physical changes and coverage.",
     "A comparison of the actual selected runs on the same grid, including any parameter-profile change.",
     "The signed difference is alternative minus baseline. A negative export difference means less modeled export under that alternative. A percent change needs a nonzero compatible baseline and cannot be inferred from a color alone.",
     "We are comparing these two retained cases, with the sign, units and assumptions shown explicitly.",
     "comparisons", "run-compare", "Open comparison controls"),
    ("delivery", "Open the complete deliverables",
     "Open the native delivery, inspect its maps, report and GIS/metadata files, and use the original download controls.",
     "The actual seven-map-family inventory and complete native delivery status, with original file descriptors.",
     "The requested future-loss, current-export, designated-water and combined-priority maps answer different questions. The 2016 maps in the RFP are examples, not current model outputs. Model N/P/sediment estimates are not direct E. coli or cyanotoxin measurements.",
     "The recipient receives the maps, physical layers, methods and retained inputs that belong to this case.",
     "deliveries", "delivery-new", "Open complete delivery controls"),
    ("transfer", "Save, reopen and continue",
     "Begin this step, create an original Workspace backup, restore that exact archive, and open the receiving workspace. Select its actual backup and restore tasks when recording the outcome.",
     "A completed backup and restore with matching archive SHA, original project identity and a separate receiving workspace key.",
     "The original scientific archive carries the project and application. This teaching packet accompanies it; it does not replace the data, model or working project. Later receiving edits remain separate from the earlier saved rehearsal.",
     "This is the transferred working copy, with the same original project and a separate place to continue.",
     "overview", "backup", "Create complete Workspace backup"),
]
STEP_IDS = tuple(x[0] for x in LESSONS)


class Conflict(ValueError):
    code = "REHEARSAL_REVISION"
    status = 409


def _text(value, name, *, empty=False, limit=12000):
    if not isinstance(value, str) or (not empty and not value.strip()) or len(value) > limit:
        raise ValueError(name + " needs " + ("valid" if empty else "nonempty") + " text within " + str(limit) + " characters")
    return value


def _selection(value):
    if not isinstance(value, dict) or set(value) - SELECTION_KEYS:
        raise ValueError("Select only the declared original case identities")
    result = {}
    for key in sorted(SELECTION_KEYS - {"alternative_run_ids"}):
        if value.get(key) not in (None, ""):
            result[key] = identifier(value[key])
    alternatives = value.get("alternative_run_ids", [])
    if not isinstance(alternatives, list) or len(set(alternatives)) != len(alternatives):
        raise ValueError("Alternative run IDs must be a list without duplicates")
    result["alternative_run_ids"] = [identifier(x) for x in alternatives]
    if result.get("baseline_run_id") in alternatives:
        raise ValueError("The baseline and alternatives must be distinct")
    return result


def _seconds(start, end):
    if not start or not end:
        return None
    try:
        a, b = datetime.fromisoformat(start), datetime.fromisoformat(end)
        if not a.tzinfo or not b.tzinfo or b < a:
            return None
        return round((b-a).total_seconds(), 6)
    except (TypeError, ValueError):
        return None


# Completion belongs to the selected evidence for each lesson. Backup/restore
# task choices affect the transfer lesson only; a changed scientific case does
# not inherit completion from an unrelated historical attempt.
_RUN_SELECTION = ("source_collection_id", "grid_id", "profile_id",
                  "baseline_run_id", "alternative_run_ids")
_STEP_SELECTION = {
    "study": ("source_collection_id",),
    "geography": ("source_collection_id", "grid_id"),
    "parameters": ("profile_id",),
    "alternatives": _RUN_SELECTION,
    "calculation": _RUN_SELECTION,
    "maps": _RUN_SELECTION + ("spatial_review_id", "delivery_id"),
    "comparison": _RUN_SELECTION + ("comparison_id",),
    "delivery": _RUN_SELECTION + ("delivery_id",),
    "transfer": tuple(sorted(SELECTION_KEYS)),
}


def completion(record):
    """Read-only current-case status; never rewrite a saved attempt or record."""
    selected = record["selection"]
    steps = []
    for step in record["steps"]:
        fields = _STEP_SELECTION[step["id"]]
        def matches(attempt):
            original = attempt.get("result_selection", attempt.get("selection"))
            if not isinstance(original, dict):
                return False
            return all(original.get(key, [] if key == "alternative_run_ids" else None)
                       == selected.get(key, [] if key == "alternative_run_ids" else None)
                       for key in fields)
        flags = [matches(attempt) for attempt in step["attempts"]]
        compatible = [index for index, match in enumerate(flags) if match]
        index = compatible[-1] if compatible else None
        state = step["attempts"][index]["outcome"] if index is not None else "unrecorded"
        steps.append({"id": step["id"], "state": state, "current_attempt_index": index,
                      "compatible_attempt_indices": compatible, "attempt_matches": flags})
    return {"observed_steps": sum(step["state"] == "observed" for step in steps),
            "total_steps": len(STEP_IDS), "steps": steps}


def _summary(record):
    current = completion(record)
    return {key: record[key] for key in (
        "id", "revision", "title", "operator", "audience", "mode", "updated_at", "active_step"
    )} | {key: current[key] for key in ("observed_steps", "total_steps")}


def _task_snapshot(task):
    fields = ("id", "operation_id", "workspace", "action", "request_sha256", "state",
              "created_at", "started_at", "ended_at", "error")
    result = {k: task[k] for k in fields if k in task}
    result["elapsed_seconds"] = _seconds(task.get("started_at"), task.get("ended_at"))
    result["attempts"] = [
        {k: row[k] for k in ("number", "state", "started_at", "ended_at", "error") if k in row}
        | {"elapsed_seconds": _seconds(row.get("started_at"), row.get("ended_at"))}
        for row in task.get("attempts", [])
    ]
    result["run_id"] = task.get("payload", {}).get("run_id")
    output = task.get("result", {})
    result["result_identity"] = {k: output[k] for k in
        ("id", "project_id", "archive_sha256", "sha256", "bytes", "members", "workspace_key", "identity")
        if k in output}
    if isinstance(output.get("project"), dict):
        result["result_identity"]["project_id"] = output["project"].get("id")
    return result


class Rehearsal:
    """One teaching collection inside the original scientific Workspace."""
    def __init__(self, workspace, *, task_reader=None, upload_reader=None, workspace_reader=None):
        self.ws = workspace
        self.root = workspace.root / "rehearsals"
        self.task_reader = task_reader
        self.upload_reader = upload_reader
        self.workspace_reader = workspace_reader

    def _task(self, key):
        if not self.task_reader:
            raise ValueError("This observation needs the original operator task store")
        result = self.task_reader(identifier(key))
        if not isinstance(result, dict) or result.get("id") != key:
            raise ValueError("The original selected task identity differs")
        if self.workspace_reader:
            selected = self.workspace_reader(result["workspace"])
            if selected.project["id"] != self.ws.project["id"]:
                raise ValueError("The selected task belongs to another scientific project")
        return result

    def _file(self, scope, descriptor):
        result = {k: descriptor[k] for k in ("path", "bytes", "sha256", "units", "sum", "sum_units",
                                            "minimum", "maximum", "valid_count", "nodata_count") if k in descriptor}
        try:
            path = relative_file(scope, descriptor["path"])
            result["present"] = path.stat().st_size == descriptor["bytes"]
        except (OSError, ValueError, KeyError):
            result["present"] = False
        result["integrity_basis"] = "original native descriptor and current file length; full file bytes are checked by the original download/export"
        return result

    def _capture(self, selection):
        choice = _selection(selection)
        overview = self.ws.overview()
        selected = {}
        def get(kind, name):
            key = choice.get(name)
            if not key:
                return None
            if kind in ("sources", "profiles", "scenarios", "spatial-reviews"):
                row = self.ws._get(kind, key)
            elif kind == "runs":
                row = self.ws.inspect_run(key)
            else:
                candidates = [x for x in overview.get(kind, []) if x.get("id") == key]
                if len(candidates) != 1:
                    raise ValueError("The selected " + name.replace("_", " ") + " is unavailable")
                row = candidates[0]
            selected[name] = deepcopy(row)
            return row
        baseline = get("runs", "baseline_run_id")
        runs = ([baseline] if baseline else []) + [self.ws.inspect_run(x) for x in choice["alternative_run_ids"]]
        if baseline:
            for field in ("grid_id", "profile_id"):
                actual = baseline["selection"][field]
                if choice.get(field) and choice[field] != actual:
                    raise ValueError("The selected " + field + " differs from the original baseline")
                choice[field] = actual
            if any(r["selection"]["grid_id"] != choice["grid_id"] for r in runs):
                raise ValueError("Use baseline and alternatives on the same original grid")
        grid = get("grids", "grid_id")
        profile = get("profiles", "profile_id")
        if grid:
            actual = grid["spec"]["source_collection_id"]
            if choice.get("source_collection_id") and choice["source_collection_id"] != actual:
                raise ValueError("The displayed source edition differs from the selected grid")
            choice["source_collection_id"] = actual
            if grid.get("state") == "complete":
                self.ws.get_grid(grid["id"])
        source = get("sources", "source_collection_id")
        comparison = get("comparisons", "comparison_id")
        delivery = get("deliveries", "delivery_id")
        spatial = get("spatial-reviews", "spatial_review_id")
        if comparison:
            expected = [choice.get("baseline_run_id")] + choice["alternative_run_ids"]
            actual = [comparison["baseline_run_id"]] + [r["run_id"] for r in comparison["alternatives"]]
            if actual != expected:
                raise ValueError("Select the comparison of these exact baseline and alternative runs in their original order")
            from .native_versions import validate_run_comparison
            validate_run_comparison(self.ws, comparison)
        if delivery:
            spec = delivery["selection"]
            if spec.get("baseline_run_id") != choice.get("baseline_run_id") or spec.get("scenario_run_ids") != choice["alternative_run_ids"]:
                raise ValueError("Select the native delivery for these exact runs")
        scenarios = [self.ws._get("scenarios", r["selection"]["scenario_id"]) for r in runs]
        if baseline and scenarios[0].get("kind") != "baseline":
            raise ValueError("Select an actual baseline scenario for the teaching baseline")
        native = []
        for run in runs:
            artifacts = {name: self._file(self.ws.root / "runs" / run["id"], row)
                         for name, row in run.get("artifacts", {}).items()}
            native.append({
                "id": run["id"], "selection": run["selection"], "state": run["state"],
                "scope": run_scope(run),
                "created_at": run.get("created_at"), "started_at": run.get("started_at"),
                "completed_at": run.get("completed_at"), "artifacts": artifacts,
                "stages": {name: {k: stage[k] for k in ("started_at", "completed_at") if k in stage}
                           | {"elapsed_seconds": _seconds(stage.get("started_at"), stage.get("completed_at"))}
                           for name, stage in run.get("stages", {}).items()},
            })
        physical = bool(native) and all(r["scope"]["selected_models_complete"] and all(
            r["artifacts"].get(name, {}).get("present") is True
            for name in r["scope"]["expected_artifacts"]
        ) for r in native)
        selected_outputs = {name for row in native for name in row["scope"]["expected_artifacts"]}
        selected_models = {name for row in native for name in row["scope"]["selected_models"]}
        tasks, task_errors = {}, []
        for name in ("backup_task_id", "restore_task_id"):
            if choice.get(name):
                try:
                    tasks[name] = self._task(choice[name])
                except (OSError, ValueError, KeyError) as error:
                    task_errors.append(str(error))
        backup, restored = tasks.get("backup_task_id"), tasks.get("restore_task_id")
        transfer = bool(backup and restored and backup["state"] == restored["state"] == "complete"
                        and backup["action"] == "workspace.backup" and restored["action"] == "workspace.restore"
                        and backup.get("result", {}).get("sha256") == restored.get("result", {}).get("archive_sha256")
                        and backup.get("result", {}).get("project_id") == self.ws.project["id"]
                        and restored.get("result", {}).get("project", {}).get("id") == self.ws.project["id"]
                        and restored.get("result", {}).get("identity") == "MATCH"
                        and restored.get("result", {}).get("workspace_key") != restored.get("workspace"))
        map_inventory = {}
        if delivery:
            for map_key, descriptor in delivery.get("maps", {}).items():
                family = next((value for value in MAP_IDS
                               if map_key == value or map_key.startswith(value + "-")), map_key)
                if not isinstance(descriptor, dict) or "path" not in descriptor:
                    raise ValueError("The original native map descriptor differs")
                map_inventory.setdefault(family, []).append({
                    "map_key": map_key,
                    **self._file(self.ws.root / "deliveries" / delivery["id"], descriptor),
                })
        ready = {
            "study": bool(source), "geography": bool(grid and grid.get("state") == "complete"),
            "parameters": bool(profile), "alternatives": bool(baseline and choice["alternative_run_ids"]),
            "calculation": physical, "maps": bool(physical or spatial),
            "comparison": bool(comparison and physical),
            "delivery": bool(delivery and delivery.get("state") == "complete" and all(
                map_inventory.get(family) and all(item["present"] for item in map_inventory[family])
                for family in MAP_IDS)),
            "transfer": transfer,
        }
        evidence = {
            "study": {"source": source},
            "geography": {"grid": grid},
            "parameters": {"profile": profile},
            "alternatives": {"scenarios": scenarios, "runs": native,
                             "profile_changes": [r["id"] for r in runs[1:]
                                                 if baseline and r["selection"]["profile_id"] != baseline["selection"]["profile_id"]]},
            "calculation": {"runs": native, "selected_invest_version": INVEST_VERSION,
                            "total_units": {name: units for name, units in MASS.items() if name in selected_outputs},
                            "raster_units": {name: units for name, units in
                                             {"ndr": "kg/ha/year", "sdr": "metric_tonnes/ha/year"}.items()
                                             if name in selected_models},
                            "references": {"ndr": NDR, "sdr": SDR}},
            "maps": {"runs": native, "spatial_review": spatial, "map_inventory": map_inventory,
                     "requested_families": list(MAP_IDS)},
            "comparison": {"comparison": comparison, "runs": native, "direction": "alternative minus baseline"},
            "delivery": {"delivery": delivery, "map_inventory": map_inventory, "requested_families": list(MAP_IDS)},
            "transfer": {"backup": _task_snapshot(backup) if backup else None,
                         "restore": _task_snapshot(restored) if restored else None, "missing_task_context": task_errors},
        }
        links = {
            "study": [("sources", choice.get("source_collection_id"))],
            "geography": [("grids", choice.get("grid_id"))],
            "parameters": [("profiles", choice.get("profile_id"))],
            "alternatives": [("scenarios", x["id"]) for x in scenarios],
            "calculation": [("runs", x["id"]) for x in runs],
            "maps": [("runs", x["id"]) for x in runs] + ([("spatial_reviews", spatial["id"])] if spatial else []),
            "comparison": [("comparisons", choice.get("comparison_id"))],
            "delivery": [("deliveries", choice.get("delivery_id"))],
            "transfer": [],
        }
        steps = []
        for key, title, do, expect, meaning, say, view, action, label in LESSONS:
            controls = [{"type": "view", "view": view, "label": "Open " + title.lower()}]
            if action:
                controls.append({"type": "action", "action": action, "label": label})
            controls += [{"type": "item", "kind": kind, "id": ident, "label": "Open selected " + kind.replace("_", " ")}
                         for kind, ident in links[key] if ident]
            if key == "transfer":
                controls.append({"type": "action", "action": "restore", "label": "Restore exact Workspace archive"})
            steps.append({
                "id": key, "title": title, "do": do, "expect": expect, "meaning": meaning, "say": say,
                "ready": ready[key], "missing": [] if ready[key] else [
                    "Choose and complete the original " + title.lower() + " evidence before recording it as observed."
                ], "evidence": evidence[key], "controls": controls, "attempts": [],
            })
        return {"selection": choice, "steps": steps}

    def _history(self, key):
        key = identifier(key)
        rows, previous = [], None
        for path in sorted((self.root / key / "revisions").glob("*.json")):
            row = read_json(path)
            if (row.get("schema") != SCHEMA or row.get("id") != key
                or row.get("project_id") != self.ws.project["id"]
                or row.get("revision") != len(rows) + 1
                or path.name != str(len(rows) + 1).zfill(8) + ".json"
                or row.get("previous_record_sha256") != previous
                or digest({k: v for k, v in row.items() if k != "record_sha256"}) != row.get("record_sha256")):
                raise ValueError("The original rehearsal history differs")
            previous = row["record_sha256"]
            rows.append(row)
        return rows

    def record(self, key, revision=None):
        rows = self._history(key)
        if not rows:
            raise FileNotFoundError("The selected rehearsal is absent")
        if revision is None:
            return rows[-1]
        if isinstance(revision, bool) or not isinstance(revision, int) or not 1 <= revision <= len(rows):
            raise ValueError("Select an existing positive rehearsal revision")
        return rows[revision-1]

    def overview(self):
        records = []
        if self.root.exists():
            for path in sorted(self.root.iterdir()):
                if path.is_dir() and re.fullmatch(r"[0-9a-f]{64}", path.name):
                    rows = self._history(path.name)
                    if rows:
                        records.append(_summary(rows[-1]))
        return {"schema": SCHEMA, "project": self.ws.project, "records": records}

    def inspect(self, key, revision=None):
        rows = self._history(key)
        row = self.record(key, revision)
        try:
            live = self._capture(row["selection"])
        except (ValueError, OSError, KeyError) as error:
            live = {"selection": row["selection"], "steps": [], "error": str(error)}
        return {"record": row, "current_revision": rows[-1]["revision"],
                "history": [{k: r[k] for k in ("revision", "record_sha256", "event", "updated_at")} for r in rows],
                "live": live, "completion": completion(row)}

    def _media(self, upload_ids):
        if not isinstance(upload_ids, list) or len(set(upload_ids)) != len(upload_ids):
            raise ValueError("Use a list of distinct original media uploads")
        if upload_ids and not self.upload_reader:
            raise ValueError("Attach actual media using the original operator upload")
        files = []
        for key in upload_ids:
            upload = self.upload_reader(identifier(key))
            if upload.get("id") != key or not 0 <= upload["bytes"] <= MAX_MEDIA_BYTES:
                raise ValueError("Each teaching media file must be at most 256 MiB")
            suffix = Path(upload["filename"]).suffix.lower()
            if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".webm", ".mp4", ".mkv", ".mov"}:
                raise ValueError("Attach an actual screenshot or walkthrough recording")
            retained = retain_file(self.ws.root, upload["path"], upload["sha256"])
            if retained["bytes"] != upload["bytes"]:
                raise ValueError("The original media length differs")
            files.append({"path": retained["object"], "bytes": retained["bytes"], "sha256": retained["sha256"],
                          "filename": upload["filename"], "mime_type": upload.get("mime_type"),
                          "upload_id": key, "meaning": "Operator-selected original screenshot or recording"})
        return files

    def apply(self, action, payload, request_id):
        if action not in {"save", "begin", "record"} or not isinstance(payload, dict):
            raise ValueError("Choose save, begin or record with a complete JSON payload")
        if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}", request_id):
            raise ValueError("Retain one original request identity")
        input_sha = digest({"action": action, "payload": payload})
        key = identifier(payload["id"]) if payload.get("id") else digest({
            "project_id": self.ws.project["id"], "request_id": request_id, "kind": SCHEMA})
        if action != "save" and not payload.get("id"):
            raise ValueError("Select the existing rehearsal")
        with held(self.ws.root / ".workspace.lock", blocking=False):
            with held(self.root / ".rehearsal.lock", blocking=False):
                rows = self._history(key)
                # Resolve the original committed request BEFORE the current revision guard.
                for previous in rows:
                    event = previous["event"]
                    if event.get("request_id") == request_id:
                        if event.get("input_sha256") != input_sha or event.get("action") != action:
                            raise Conflict("This request already records a different rehearsal input")
                        return previous
                current = rows[-1] if rows else None
                if current:
                    expected = payload.get("expected_revision")
                    if isinstance(expected, bool) or not isinstance(expected, int) or expected != current["revision"]:
                        raise Conflict("The rehearsal advanced. Reopen its current revision before a new action.")
                elif payload.get("id") or payload.get("expected_revision") is not None:
                    raise Conflict("The selected rehearsal does not exist")
                timestamp = now()
                if action == "save":
                    if current and current["active_step"]:
                        raise Conflict("Finish or defer the active step before changing the selected case")
                    choice = self._capture(payload.get("selection", {}))
                    row = {
                        "schema": SCHEMA, "id": key, "project_id": self.ws.project["id"],
                        "title": _text(payload.get("title"), "Rehearsal title", limit=240),
                        "operator": _text(payload.get("operator"), "Operator", limit=240),
                        "audience": _text(payload.get("audience"), "Audience", limit=240),
                        "mode": payload.get("mode", "recorded"),
                        "selection": choice["selection"],
                        "notes": _text(payload.get("notes", ""), "Notes", empty=True),
                        "science_notes": _text(payload.get("science_notes", ""), "Scientific interpretation", empty=True),
                        "created_at": current["created_at"] if current else timestamp,
                        "active_step": None, "steps": choice["steps"],
                    }
                    if row["mode"] not in {"recorded", "live"}:
                        raise ValueError("Choose recorded results or a fresh live walkthrough")
                    if current:
                        for step, old in zip(row["steps"], current["steps"]):
                            step["attempts"] = deepcopy(old["attempts"])
                else:
                    row = deepcopy(current)
                    step_id = payload.get("step_id")
                    if step_id not in STEP_IDS:
                        raise ValueError("Choose an original teaching step")
                    tasks = []
                    if action == "record":
                        task_ids = payload.get("task_ids", [])
                        if not isinstance(task_ids, list) or len(set(task_ids)) != len(task_ids):
                            raise ValueError("Select distinct original task IDs")
                        tasks = [self._task(task_key) for task_key in task_ids]
                        if step_id == "transfer" and payload.get("outcome") == "observed":
                            backups = [t for t in tasks if t.get("action") == "workspace.backup"]
                            restores = [t for t in tasks if t.get("action") == "workspace.restore"]
                            if backups or restores:
                                if len(backups) != 1 or len(restores) != 1:
                                    raise ValueError("Select the one original backup and its matching restore task")
                                row["selection"]["backup_task_id"] = backups[0]["id"]
                                row["selection"]["restore_task_id"] = restores[0]["id"]
                    choice = self._capture(row["selection"])
                    if choice["selection"] != row["selection"]:
                        raise Conflict("The original case selection changed")
                    index = STEP_IDS.index(step_id)
                    step = row["steps"][index]
                    live = choice["steps"][index]
                    note = _text(payload.get("note", ""), "Operator note", empty=True)
                    if action == "begin":
                        if row["active_step"]:
                            raise Conflict("Finish or defer the existing active step")
                        row["active_step"] = {"step_id": step_id, "started_at": timestamp}
                        step["active_attempt"] = {
                            "request_id": request_id, "started_at": timestamp, "note": note,
                            "selection": deepcopy(row["selection"]), "before": live["evidence"],
                        }
                    else:
                        if not row["active_step"] or row["active_step"]["step_id"] != step_id or "active_attempt" not in step:
                            raise Conflict("Begin this same step before recording its outcome")
                        outcome = payload.get("outcome")
                        if outcome not in {"observed", "deferred"}:
                            raise ValueError("Record an observed or explicitly deferred outcome")
                        if outcome == "observed" and not live["ready"]:
                            raise ValueError("The original selected result is not ready; retain it as deferred with the actual missing input")
                        if step_id == "transfer" and outcome == "observed":
                            if not self.workspace_reader:
                                raise ValueError("Open the original receiving workspace to verify the transferred rehearsal")
                            restored = self._task(row["selection"]["restore_task_id"])
                            receiving_key = restored["result"]["workspace_key"]
                            receiving = Rehearsal(self.workspace_reader(receiving_key))
                            copied = receiving.record(key, current["revision"])
                            if copied["record_sha256"] != current["record_sha256"]:
                                raise ValueError("The received working copy lacks this exact active rehearsal revision; back up after beginning the transfer step")
                            live["evidence"]["rehearsal_receiving"] = {
                                "rehearsal_id": key, "revision": copied["revision"],
                                "record_sha256": copied["record_sha256"], "workspace_key": receiving_key,
                                "meaning": "The independent received working copy contains the exact rehearsal revision from before this completion.",
                            }
                        attempt = step.pop("active_attempt")
                        native_tasks = [t for t in tasks if t.get("action") == "run.start"
                                        and t.get("payload", {}).get("run_id") in
                                        [row["selection"].get("baseline_run_id")] + row["selection"]["alternative_run_ids"]]
                        before_runs = {r["id"]: r for r in attempt["before"].get("runs", [])}
                        after_runs = {r["id"]: r for r in live["evidence"].get("runs", [])}
                        fresh_stages = []
                        if step_id == "calculation":
                            for task in native_tasks:
                                run_id = task["payload"]["run_id"]
                                before_run, after_run = before_runs.get(run_id), after_runs.get(run_id)
                                if task.get("state") != "complete" or not before_run or not after_run:
                                    continue
                                for stage_name in ("ndr", "sdr"):
                                    stage = after_run.get("stages", {}).get(stage_name, {})
                                    prior = before_run.get("stages", {}).get(stage_name, {})
                                    if (stage.get("started_at") and stage.get("completed_at")
                                        and stage != prior
                                        and _seconds(attempt["started_at"], stage["started_at"]) is not None
                                        and _seconds(stage["completed_at"], timestamp) is not None):
                                        fresh_stages.append({"run_id": run_id, "stage": stage_name, **stage})
                        fresh = row["mode"] == "live" and bool(fresh_stages)
                        attempt.update(
                            ended_at=timestamp, outcome=outcome, note=note, evidence=live["evidence"],
                            result_selection=deepcopy(row["selection"]),
                            mode="deferred" if outcome == "deferred" else ("live" if fresh else "recorded"),
                            elapsed_seconds=_seconds(attempt["started_at"], timestamp),
                            task_evidence=[_task_snapshot(t) for t in tasks],
                            fresh_native_stages=fresh_stages,
                            files=self._media(payload.get("upload_ids", [])),
                            timing_meaning="elapsed_seconds measures this operator step; each task/stage retains its separate actual native timing",
                        )
                        step["attempts"].append(attempt)
                        row["active_step"] = None
                    for key_name in ("ready", "missing", "evidence", "controls"):
                        step[key_name] = deepcopy(live[key_name])
                row.update(revision=len(rows)+1, updated_at=timestamp,
                           previous_record_sha256=current["record_sha256"] if current else None,
                           event={"action": action, "request_id": request_id, "input_sha256": input_sha})
                row.pop("record_sha256", None)
                row["record_sha256"] = digest(row)
                atomic_json(self.root / key / "revisions" / (str(row["revision"]).zfill(8)+".json"), row, immutable=True)
                return row

    def export(self, key, revision=None):
        """Portable teaching packet, alongside the original full Workspace archive."""
        with held(self.ws.root / ".workspace.lock", blocking=False):
            with held(self.root / ".rehearsal.lock", blocking=False):
                row = self.record(key, revision)
                history = self._history(key)[:row["revision"]]
                folder = self.root / key / "exports" / row["record_sha256"]
                folder.mkdir(parents=True, exist_ok=True)
                bodies = {
                    "rehearsal.json": canonical(row)+b"\n",
                    "history.json": canonical(history)+b"\n",
                    "WALKTHROUGH.md": walkthrough(row).encode("utf-8"),
                    "walkthrough.html": render_html(row).encode("utf-8"),
                }
                media = {}
                for edition in history:
                    for step in edition["steps"]:
                        for attempt in step["attempts"]:
                            for file in attempt["files"]:
                                path = relative_file(self.ws.root, file["path"])
                                if path.stat().st_size != file["bytes"] or file_digest(path) != file["sha256"]:
                                    raise ValueError("An original teaching-media file changed")
                                name = "media/" + file["sha256"] + Path(file["filename"]).suffix.lower()
                                media[name] = (path, file)
                manifest = {
                    "schema": "upstate.operator-rehearsal-packet/v1", "project_id": self.ws.project["id"],
                    "rehearsal_id": key, "revision": row["revision"], "record_sha256": row["record_sha256"],
                    "selection": row["selection"],
                    "members": {name: {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
                                for name, body in bodies.items()}
                              | {name: {"bytes": file["bytes"], "sha256": file["sha256"]} for name, (_, file) in media.items()},
                    "semantics": "Complete editable teaching record and media. The original scientific Workspace archive supplies model inputs, results and application; this packet does not replace it.",
                    "sources": {"rfp": RFP, "ndr": NDR, "sdr": SDR},
                }
                for name, body in bodies.items():
                    atomic_bytes(folder / name, body, immutable=True)
                atomic_json(folder / "MANIFEST.json", manifest, immutable=True)
                target = folder / "operator-walkthrough.zip"
                if not target.exists():
                    fd, name = tempfile.mkstemp(prefix=".rehearsal-", suffix=".zip", dir=folder)
                    temporary = Path(name)
                    try:
                        with os.fdopen(fd, "wb") as raw:
                            with zipfile.ZipFile(raw, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=3, allowZip64=True) as z:
                                for member, body in sorted(bodies.items()):
                                    info = zipfile.ZipInfo(member, date_time=(1980,1,1,0,0,0))
                                    info.compress_type = zipfile.ZIP_DEFLATED
                                    z.writestr(info, body)
                                for member, (path, file) in sorted(media.items()):
                                    with path.open("rb") as source, z.open(member, "w", force_zip64=True) as destination:
                                        while True:
                                            block = source.read(1024*1024)
                                            if not block:
                                                break
                                            destination.write(block)
                                z.writestr("MANIFEST.json", canonical(manifest)+b"\n")
                            raw.flush(); os.fsync(raw.fileno())
                        os.link(temporary, target)
                    finally:
                        temporary.unlink(missing_ok=True)
                with zipfile.ZipFile(target) as z:
                    if set(z.namelist()) != set(manifest["members"]) | {"MANIFEST.json"} or len(z.namelist()) != len(set(z.namelist())):
                        raise ValueError("The retained teaching packet member inventory changed")
                    if z.read("MANIFEST.json") != canonical(manifest)+b"\n":
                        raise ValueError("The retained teaching packet manifest changed")
                    for name, expected in manifest["members"].items():
                        sha = hashlib.sha256()
                        size = 0
                        with z.open(name) as source:
                            for block in iter(lambda: source.read(1024*1024), b""):
                                sha.update(block); size += len(block)
                        if size != expected["bytes"] or sha.hexdigest() != expected["sha256"]:
                            raise ValueError("The retained teaching packet bytes changed")
                files = {name: describe_file(self.ws.root, folder / name) for name in bodies}
                files["packet"] = describe_file(self.ws.root, target)
                files["manifest"] = describe_file(self.ws.root, folder / "MANIFEST.json")
                return {"schema": manifest["schema"], "id": key, "revision": row["revision"],
                        "record_sha256": row["record_sha256"], "project_id": self.ws.project["id"],
                        "files": files, "semantics": manifest["semantics"]}


def walkthrough(row):
    states = {step["id"]: step for step in completion(row)["steps"]}
    lines = ["# " + row["title"], "", "TokenJunkieLabs — actual-case operator walkthrough", "",
             "Operator: " + row["operator"], "Audience: " + row["audience"],
             "Project: " + row["project_id"], "Saved rehearsal revision: " + str(row["revision"]),
             "Mode selected: " + row["mode"], "",
             "This record explains the exact case the operator demonstrated and preserves its model inputs, assumptions and original results.", "",
             "## Selected case", "", "~~~json", json.dumps(row["selection"], indent=2, ensure_ascii=False), "~~~", "",
             "## Scientific interpretation", "", row["science_notes"] or "No additional scientific judgment was supplied.", "",
             "Nutrient and sediment estimates support planning. They are not direct bacterial, cyanotoxin or drinking-water safety measurements.", ""]
    for step in row["steps"]:
        lines += ["## " + step["title"], "", "**Do:** " + step["do"], "", "**See:** " + step["expect"], "",
                  "**Meaning:** " + step["meaning"], "", "**Say:** " + step["say"], "",
                  "Selected evidence: " + ("available when saved" if step["ready"] else "not yet available when saved") + ".",
                  "Current selected-case completion: " + states[step["id"]]["state"] + ".", ""]
        for i, attempt in enumerate(step["attempts"], 1):
            lines += ["### Recorded attempt " + str(i), "",
                      "Outcome: " + attempt["outcome"] + "; mode: " + attempt["mode"] + ".",
                      "Case: " + ("matches this lesson's current selection." if states[step["id"]]["attempt_matches"][i-1]
                                  else "historical selection; it does not complete the currently selected case."),
                      "Observed: " + attempt["started_at"] + " to " + attempt["ended_at"] + ".",
                      "Operator step duration: " + str(attempt["elapsed_seconds"]) + " seconds.",
                      attempt["note"] or "No additional operator note.", ""]
            for task in attempt["task_evidence"]:
                lines.append("- Original task " + task["id"] + " · " + task["action"] + " · " + task["state"]
                             + " · native task duration " + str(task["elapsed_seconds"]) + " seconds.")
            if attempt["files"]:
                lines += ["", "Actual attached media:"]
                lines += ["- [" + f["filename"].replace("[", "\\[").replace("]", "\\]") + "](media/"
                          + f["sha256"] + Path(f["filename"]).suffix.lower() + ") · "
                          + str(f["bytes"]) + " bytes · SHA256 " + f["sha256"] for f in attempt["files"]]
            lines += [""]
    lines += ["## What the scientific lead chooses", "",
              "Source vintage and coverage; biophysical coefficients and model period; native routing/stream parameters; calibrated versus exploratory profiles; scenario land-cover changes; suitable observations; protection designations; normalization and weights for combined priorities.", "",
              "## Reopen and continue", "",
              "Open the original full scientific Workspace archive through the existing restore control. The same project retains this rehearsal history and actual media. A new operator action creates a later revision; it does not rewrite the earlier walkthrough. Use the original task recovery controls for interrupted scientific work.", "",
              "## Notes", "", row["notes"] or "No additional notes.", "",
              "## Original references", "", "- RFP: " + RFP, "- InVEST NDR 3.20: " + NDR, "- InVEST SDR 3.20: " + SDR, ""]
    return "\n".join(lines)


def render_html(row):
    states = {step["id"]: step for step in completion(row)["steps"]}
    esc = lambda x: html.escape(str(x), quote=True)
    parts = ['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
             '<title>'+esc(row["title"])+'</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#252525;background:#fff;max-width:1060px;margin:28px auto;padding:0 20px}h1,h2{line-height:1.2;font-weight:650}h1{font-size:28px}h2{font-size:20px}h3{font-size:16px}header,section,footer{border-top:1px solid #b8b8b8;padding:16px 0;margin:16px 0}dt{font-weight:650}dd{margin:0 0 10px}pre{overflow:auto;background:#f2f2f2;border:1px solid #d1d1d1;padding:12px}small{color:#555}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #d1d1d1;padding:6px}th{background:#eee}a{color:#222;text-decoration:underline}figure{margin:14px 0}figcaption{font-size:13px;color:#555;margin-bottom:6px}@media print{section{break-inside:avoid}body{font-size:10pt;margin:0;padding:0}}</style>',
             '<header><p>TokenJunkieLabs · Upper Savannah operator handoff</p><h1>'+esc(row["title"])+'</h1><p>'+esc(row["operator"])+' · '+esc(row["audience"])+'</p><p>Saved edition '+str(row["revision"])+' · '+esc(row["updated_at"])+'</p></header>',
             '<section><h2>Actual selected case</h2><pre>'+esc(json.dumps(row["selection"],indent=2))+'</pre><p>'+esc(row["science_notes"])+'</p><p>Model nutrient and sediment estimates support planning; they are not direct E. coli, cyanotoxin or drinking-water safety measurements.</p></section>']
    for step in row["steps"]:
        parts.append('<section><h2>'+esc(step["title"])+'</h2><dl>')
        for key, label in (("do","Do"),("expect","See"),("meaning","Meaning"),("say","Say")):
            parts.append('<dt>'+label+'</dt><dd>'+esc(step[key])+'</dd>')
        parts.append('</dl><p>'+('Selected evidence was available.' if step["ready"] else 'The required original result remained pending.')+'</p><p>Current selected-case completion: '+esc(states[step["id"]]["state"])+'.</p>')
        for index, attempt in enumerate(step["attempts"]):
            parts.append('<p><strong>'+('Matches this lesson’s current selection.' if states[step["id"]]["attempt_matches"][index] else 'Historical selection — this attempt does not complete the current case.')+'</strong></p>')
            parts.append('<h3>'+esc(attempt["outcome"].capitalize())+' · '+esc(attempt["mode"])+'</h3><p>'+esc(attempt["note"])+'</p><p>Operator step: '+esc(attempt["elapsed_seconds"])+' seconds · '+esc(attempt["started_at"])+' to '+esc(attempt["ended_at"])+'</p>')
            if attempt["task_evidence"]:
                parts.append('<table><thead><tr><th>Original action</th><th>State</th><th>Task time, seconds</th></tr></thead><tbody>')
                for task in attempt["task_evidence"]:
                    parts.append('<tr><td>'+esc(task["action"])+'</td><td>'+esc(task["state"])+'</td><td>'+esc(task["elapsed_seconds"])+'</td></tr>')
                parts.append('</tbody></table>')
            for media in attempt["files"]:
                url = "media/" + media["sha256"] + Path(media["filename"]).suffix.lower()
                parts.append('<figure><figcaption>'+esc(media["filename"])+' · '+esc(media["bytes"])+' bytes</figcaption>')
                if Path(media["filename"]).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
                    parts.append('<a href="'+esc(url)+'"><img style="max-width:100%;height:auto" src="'+esc(url)+'" alt="'+esc(media["filename"])+'"></a>')
                else:
                    parts.append('<video controls preload="metadata" style="max-width:100%"><source src="'+esc(url)+'"></video><p><a href="'+esc(url)+'">Open original recording</a></p>')
                parts.append('</figure>')
        parts.append('</section>')
    parts += ['<section><h2>Working project and next operator</h2><p>The original full Workspace archive carries the source, scientific results and application. This teaching packet supplies the saved editable explanation, actual observations and attached media. Restore the original project to continue; retain the prior rehearsal edition.</p><p>'+esc(row["notes"])+'</p></section>',
              '<footer><p>Project '+esc(row["project_id"])+' · Rehearsal '+esc(row["id"])+'</p><p><a href="'+esc(RFP)+'">Original RFP</a> · <a href="'+esc(NDR)+'">NDR 3.20 methods</a> · <a href="'+esc(SDR)+'">SDR 3.20 methods</a></p></footer></html>']
    return "".join(parts)+"\n"
