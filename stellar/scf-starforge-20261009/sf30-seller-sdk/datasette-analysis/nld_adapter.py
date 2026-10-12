"""Whole NLD commissioning and editable receiving in the original Analysis workspace.

No new AnalysisWorkspace or row store is created. DatasetteAnalysis owns the
selected versions, source documents, jobs, queries, reports and archive engine.
The explicit local NLD target/state are retained as complete original documents.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
from nld_contract import (SCHEMA, RUN_SCHEMA, PROJECTION_SCHEMA, MEANING, META, NldError,
    need, now, encoded, sha, identity, parse, load, read, identifier, name, quote, relative,
    private_directory, publish, publish_json, file_identity, check_file, held, sync,
    specification, project_rows, verify_projection, compile_project, verify_project,
    closure, export_zip, target_report)
from nld_worker import normalize_request, project_lock

from stellar_forge_buyer.response_documents import (
    document_path, retained_document_files, validate_manifest, MAX_ORIGINAL_BYTES)
from stellar_forge_buyer.errors import StateError

PREFIX = "nld-"
SOURCE_URL = "https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis"
MAX_ARCHIVE = 32 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024

def _source_document(directory, title, data, originals, *, captured_at, description):
    """Use the original portable ResponseDocument contract and byte custody."""
    directory = private_directory(directory)
    raw = encoded(data)
    need(len(raw) <= 32 * 1024 * 1024, "NLD_REPORT_DOCUMENT_CAPACITY")
    payload = {"path": "files/" + sha(raw) + ".json", "bytes": len(raw),
               "sha256": sha(raw), "contentType": "application/json"}
    publish(directory / payload["path"], raw)
    retained = []
    for role, path, media in originals:
        descriptor = file_identity(path)
        need(descriptor["bytes"] <= MAX_ORIGINAL_BYTES, "NLD_COMPLETE_ORIGINAL_CAPACITY", role)
        selected = {"path": "files/" + descriptor["sha256"] + ".bin",
                    "bytes": descriptor["bytes"], "sha256": descriptor["sha256"],
                    "contentType": media, "role": role}
        destination = directory / selected["path"]
        _copy(path, destination, descriptor)
        retained.append(selected)
    manifest = {"schema": "stellar-forge.analysis-source-document.v1",
                "title": title[:200], "format": "json", "complete": True,
                "document": payload, "originals": retained,
                "provenance": {"kind": "operator-file", "publisher": "Selected original Datasette and native NLD operation",
                    "capturedAt": captured_at, "scope": "Complete retained NLD project/result and selected original Analysis version",
                    "description": description[:12000],
                    "transform": {"name": "Retained Datasette -> original NLD commissioning",
                        "sourceUrl": SOURCE_URL, "sha256": sha(read(Path(__file__)))}}}
    validate_manifest(manifest)
    publish_json(directory / "source.json", manifest)
    return directory / "source.json"

def _copy(source, target, expected):
    target = Path(target)
    private_directory(target.parent)
    if target.exists():
        actual = file_identity(target)
        need(all(actual[k] == expected[k] for k in ("bytes", "sha256")), "NLD_COPY_DESTINATION_CHANGED", str(target))
        return
    fd, pending = tempfile.mkstemp(prefix=".nld-copy-", dir=target.parent)
    complete = False
    try:
        count, checksum = 0, hashlib.sha256()
        with held(source) as (input_file, _), os.fdopen(fd, "wb") as output:
            while chunk := input_file.read(65536):
                output.write(chunk); count += len(chunk); checksum.update(chunk)
            need(count == expected["bytes"] and checksum.hexdigest() == expected["sha256"], "NLD_COPY_SOURCE_CHANGED")
            output.flush(); os.fsync(output.fileno())
        os.link(pending, target, follow_symlinks=False)
        sync(target.parent)
        complete = True
    finally:
        if complete:
            Path(pending).unlink(missing_ok=True)
            sync(target.parent)

def _table(columns, rows):
    # JSON source collection rows must contain every declared cell.
    return {"columns": columns, "rows": [{c: row.get(c) for c in columns} for row in rows]}

def _report_collections(projection, completed, native, review):
    coverage_columns = ["source_rows", "target_rows", "selected_processing_keys", "matching_rows",
                        "missing_rows", "different_rows", "retained_outside_selection",
                        "coverage_denominator", "coverage"]
    summaries = _table(coverage_columns, [review])
    mappings = _table(["source", "target", "description", "unit", "time_basis", "business_key"],
        [{**b, "business_key": b["source"] in projection["specification"]["keys"]}
         for b in projection["specification"]["mapping"]])
    measures = _table(["target", "unit", "time_basis", "note", "scope", "row_count", "known_count",
                       "states", "exact_known_sum", "minimum", "maximum", "aggregation"],
        [{**m, "states": encoded(m["states"]).decode().rstrip("\n")} for m in review["measures"]])
    flow = native["flow"]
    state_rows = [{"kind": "flow", "name": flow["flow_name"], "status": flow["execution_status"],
        "native_uid": flow["flow_uid"], "started_at": flow.get("started_at"),
        "ended_at": flow.get("ended_at"), "source_count": None, "inserted_count": None,
        "updated_count": None, "deleted_count": None, "error": flow.get("execution_error"),
        "detail": encoded({k: v for k, v in flow.items() if k != "steps"}).decode().rstrip("\n")}]
    for step in flow.get("steps") or []:
        state_rows.append({"kind": step.get("step_category"), "name": step.get("step_name"),
            "status": step.get("step_status"), "native_uid": step.get("flow_uid"),
            "started_at": step.get("started_at"), "ended_at": step.get("ended_at"),
            "source_count": step.get("source_entries_in_success"),
            "inserted_count": step.get("target_entries_inserted_in_success"),
            "updated_count": step.get("target_entries_updated_in_success"),
            "deleted_count": step.get("target_entries_deleted_in_success"),
            "error": step.get("step_error"), "detail": encoded(step).decode().rstrip("\n")})
    state = _table(["kind", "name", "status", "native_uid", "started_at", "ended_at", "source_count",
                    "inserted_count", "updated_count", "deleted_count", "error", "detail"], state_rows)
    outcomes = _table(["business_key", "source_key", "original_row", "state", "selected_in_run",
                       "target_source_edition", "target_analysis_version", "target_original_row",
                       "source_values", "target_values"],
        [{**r, "source_values": encoded(r["source_values"]).decode().rstrip("\n"),
          "target_values": encoded(r["target_values"]).decode().rstrip("\n") if r["target_values"] is not None else None}
         for r in review["outcomes"]])
    target_rows = [r["target_values"] for r in review["outcomes"] if r["target_values"] is not None] + review["outside_selection"]
    targets = _table(projection["columns"], sorted(target_rows, key=lambda r: r["_sf_business_key"]))
    meanings = _table(["topic", "meaning"], [{"topic": key, "meaning": value} for key, value in MEANING.items()])
    collections = {"coverage": summaries, "mappings": mappings, "measures": measures,
                   "native": state, "review": outcomes, "target": targets, "meaning": meanings}
    notes = {
        "coverage": "Counts compare every source business key with the retained native target. The denominator is the whole selected source; rows outside it are separate.",
        "mappings": "Explicit operator-reviewed source and target names. Units and time basis are declarations preserved with the source; no automatic unit conversion occurs.",
        "measures": "Exact known subtotals over source-numeric values. Missing/null/blank/non-numeric values are separately counted; a known subtotal is not total population coverage.",
        "native": "Original NLD UID, actual statuses and steps. Missing native counts remain NULL, not zero. A flow success alone is not a whole-source coverage claim.",
        "review": "Every selected original row, exact processing key, target source lineage and matched/missing/different outcome. Complete JSON retains all type/presence details.",
        "target": "Complete frozen native target at this run, including separately counted earlier rows outside the current source selection. Numeric values stay exact text.",
        "meaning": "Source, incremental, deletion, execution and portable-receiving semantics used by this operation.",
    }
    recipes = [{"key": key, "collection": key, "title": key.replace("_", " ").title(),
                "note": notes[key], "sheet": key.title(), "order_by": [],
                "numeric": [c for c in ("source_rows", "target_rows", "selected_processing_keys", "matching_rows",
                    "missing_rows", "different_rows", "retained_outside_selection", "coverage_denominator",
                    "original_row", "row_count", "known_count") if c in collection["columns"]]}
               for key, collection in collections.items() if collection["rows"]]
    return collections, recipes

class DatasetteNld:
    def __init__(self, original_model):
        self.model = original_model
        self.analysis = original_model.analysis

    def _reload(self):
        self.model.record = self.model._read()
        root = self.model.record.setdefault("nld", {"schema": SCHEMA, "projects": []})
        need(root.get("schema") == SCHEMA, "NLD_WORKSPACE_SCHEMA_CHANGED")
        return root

    def _project(self, project_id):
        identifier(project_id)
        root = self._reload()
        selected = next((p for p in root["projects"] if p["id"] == project_id), None)
        need(selected is not None, "NLD_PROJECT_NOT_FOUND")
        return selected

    def _directory(self, project_id):
        identifier(project_id)
        return self.model.directory / "nld" / "projects" / project_id

    def _check_original(self, edition_id):
        record = self.model._read()
        edition = self.model._selected(record, edition_id)
        need(edition.get("status") == "COMPLETE", "NLD_COMPLETE_DATASETTE_EDITION_REQUIRED")
        version = self.analysis.database.version(edition["version_id"])
        columns, rows = self.model._table_rows(version)
        return edition, version, columns, rows

    def _definition(self, project, definition_id=None):
        selected = definition_id or project.get("current_definition")
        result = next((d for d in project["definitions"] if d["id"] == selected), None)
        need(result is not None, "NLD_DEFINITION_NOT_FOUND")
        return result

    def _document_archive(self, checkpoint):
        path = document_path(self.analysis.database.directory, checkpoint["document_id"])
        need(sha(read(path)) == checkpoint["document_id"], "NLD_RETAINED_DOCUMENT_CHANGED")
        document = load(path)
        descriptor = next((r for r in document["originals"] if r["role"] == "complete-nld-project"), None)
        need(descriptor is not None and descriptor["bytes"] == checkpoint["archive"]["bytes"]
             and descriptor["sha256"] == checkpoint["archive"]["sha256"], "NLD_RETAINED_PROJECT_ARCHIVE_CHANGED")
        original = path.parent / descriptor["path"]
        actual = file_identity(original)
        need(all(actual[k] == descriptor[k] for k in ("bytes", "sha256")), "NLD_RETAINED_PROJECT_ARCHIVE_CHANGED")
        return original

    def restore_project(self, project_id, *, checkpoint_id=None, resume=False):
        """Materialize only this same project's exact original retained closure."""
        return self._materialize(self._project(project_id), checkpoint_id=checkpoint_id)

    def _materialize(self, project, *, checkpoint_id=None):
        project_id = project["id"]
        checkpoints = project.get("checkpoints", [])
        selected = next((c for c in checkpoints if c["id"] == checkpoint_id), None) if checkpoint_id else (
            checkpoints[-1] if checkpoints else None)
        need(selected is not None, "NLD_PROJECT_CHECKPOINT_REQUIRED")
        root = self._directory(project_id)
        original = self._document_archive(selected)
        intent = {"schema": SCHEMA + "/restore", "project_id": project_id, "checkpoint_id": selected["id"],
                  "archive": selected["archive"], "members": selected["members"]}
        if (root / ".restored.json").exists():
            received = load(root / ".restored.json")
            need(received["project_id"] == project_id, "NLD_RESTORED_PROJECT_CHANGED")
            # A completed reopened project may have new native runs or edits.
            # Reopening an old package must never replace its current state.
            return {"schema": SCHEMA, "status": "EXISTING_PROJECT", "project_id": project_id,
                    "original_checkpoint_id": received["checkpoint_id"], "current_state_preserved": True}
        if root.exists() and not (root / ".restore-intent.json").exists():
            need((root / "project-binding.json").exists()
                 and load(root / "project-binding.json")["project_id"] == project_id, "NLD_EXISTING_PROJECT_UNBOUND")
            return {"schema": SCHEMA, "status": "EXISTING_PROJECT", "project_id": project_id, "current_state_preserved": True}
        need(sum(m["bytes"] for m in selected["members"]) <= MAX_EXPANDED, "NLD_RESTORE_CAPACITY")
        # Preflight the entire selected archive before creating a destination or
        # publishing its intent. Rejecting an older checkpoint must still permit
        # the operator to select the complete current checkpoint.
        with zipfile.ZipFile(original) as archive:
            expected = {relative(m["path"]): m for m in selected["members"]}
            need(len(expected) == len(selected["members"]) and archive.namelist() == sorted(expected), "NLD_RESTORE_ARCHIVE_MEMBERS")
            state_info = expected.get("checkpoint-state.json")
            need(state_info is not None, "NLD_RESTORE_STATE_MISSING")
            need(0 <= state_info["bytes"] <= 32 * 1024 * 1024
                 and archive.getinfo("checkpoint-state.json").file_size == state_info["bytes"],
                 "NLD_RESTORE_STATE_CAPACITY")
            state_raw = archive.read("checkpoint-state.json")
            need(sha(state_raw) == state_info["sha256"], "NLD_RESTORE_STATE_CHANGED")
            retained_state = parse(state_raw)
            need(retained_state.get("schema") == SCHEMA + "/project-snapshot"
                 and retained_state.get("project_id") == project_id
                 and retained_state.get("original_workspace_id") == self.analysis.identity
                 and retained_state.get("operation_id") == self.model.operation_id
                 and retained_state.get("meaning_id") == project["meaning_id"], "NLD_RESTORE_STATE_BINDING")
            need(retained_state.get("definitions") == project["definitions"]
                 and retained_state.get("current_definition") == project["current_definition"],
                 "NLD_RESTORE_STALE_CHECKPOINT",
                 "Use a checkpoint containing the current complete definition history and selection.")
            need(retained_state.get("runs") == project["runs"], "NLD_RESTORE_STALE_CHECKPOINT",
                 "Every current run is required, including prepared, failed and unresolved requests and their recorded evidence.")
            # Validate every complete member before publishing any original file.
            for info in archive.infolist():
                need(not info.is_dir() and info.file_size == expected[info.filename]["bytes"],
                     "NLD_RESTORE_MEMBER_SIZE")
                digest, count = hashlib.sha256(), 0
                with archive.open(info) as source:
                    while chunk := source.read(65536):
                        count += len(chunk); need(count <= info.file_size, "NLD_RESTORE_MEMBER_SIZE"); digest.update(chunk)
                need(count == info.file_size and digest.hexdigest() == expected[info.filename]["sha256"],
                     "NLD_RESTORE_MEMBER_HASH")
            def expect_json(path, value, *, required=True):
                member = expected.get(path)
                need(member is not None or not required, "NLD_RESTORE_RUN_EVIDENCE_MISSING", path)
                if member is not None:
                    raw = encoded(value)
                    need(member["bytes"] == len(raw) and member["sha256"] == sha(raw),
                         "NLD_RESTORE_RUN_EVIDENCE_CHANGED", path)
            def expect_files(prefix, members):
                for member in members:
                    path = prefix + relative(member["path"])
                    actual = expected.get(path)
                    need(actual is not None and all(actual[key] == member[key] for key in ("bytes", "sha256")),
                         "NLD_RESTORE_RUN_MEMBER_CHANGED", path)
            for run in project["runs"]:
                run_id = identifier(run["id"])
                request = run["request"]
                need(run.get("request_sha256") == identity(request)
                     and request.get("run_id") == run_id and request.get("project_id") == project_id
                     and request.get("definition_id") == run["definition_id"], "NLD_RESTORE_RUN_REQUEST_CHANGED")
                prefix = "runs/" + run_id + "/"
                dispatched = prefix + "dispatch.json" in expected
                expect_json("requests/" + run_id + ".json", request,
                            required=dispatched or bool(run.get("invocations")) or run.get("status") != "PREPARED")
                expect_json(prefix + "intent.json", request, required=dispatched)
                for invocation in run.get("invocations", []):
                    if invocation.get("file") is not None:
                        expect_files("", [invocation["file"]])
                        need(invocation["file"]["path"] == invocation["log"], "NLD_RESTORE_INVOCATION_CHANGED")
                if run.get("completed") is not None:
                    completed = run["completed"]
                    need(run.get("status") == "COMPLETE"
                         and completed.get("request_sha256") == identity(request)
                         and completed.get("native_uid") == run_id, "NLD_RESTORE_COMPLETED_RUN_CHANGED")
                    expect_json(prefix + "completed.json", completed)
                    expect_files(prefix, completed["files"])
                    expect_files("", [run["completed_file"]])
                    need(run["completed_file"]["path"] == prefix + "completed.json", "NLD_RESTORE_COMPLETED_FILE_CHANGED")
                else:
                    need(run.get("status") != "COMPLETE", "NLD_RESTORE_COMPLETED_RUN_MISSING")
                failure = run.get("failure")
                if failure is not None:
                    need(run.get("status") == "FAILED"
                         and failure.get("request_sha256") == identity(request)
                         and failure.get("native_uid") == run_id
                         and failure.get("flow", {}).get("execution_status") == "FAILED"
                         and failure.get("flow", {}).get("ended_at"), "NLD_RESTORE_FAILED_RUN_CHANGED")
                    expect_json(prefix + "failed-receipt.json", failure)
                    expect_files(prefix, failure["files"])
                if dispatched or run.get("completed") is not None or failure is not None:
                    need("target.sqlite" in expected, "NLD_RESTORE_CURRENT_TARGET_MISSING")
                for filename in ("dispatch.json", "native-return.json", "native-error.json"):
                    path = prefix + filename
                    if path not in expected:
                        continue
                    need(expected[path]["bytes"] <= 64 * 1024 * 1024, "NLD_RESTORE_NATIVE_EVIDENCE_CAPACITY")
                    native = parse(archive.read(path))
                    need(native.get("request_sha256") == identity(request), "NLD_RESTORE_NATIVE_REQUEST_CHANGED")
                    if filename == "dispatch.json":
                        need(native.get("native_uid") == run_id and native.get("run_id") == run_id
                             and native.get("project_definition") == run["definition_id"],
                             "NLD_RESTORE_NATIVE_UID_CHANGED")
                    else:
                        need(native.get("flow", {}).get("flow_uid") == run_id, "NLD_RESTORE_NATIVE_UID_CHANGED")
            root = private_directory(root)
            with project_lock(root):
                publish_json(root / ".restore-intent.json", intent)
                for info in archive.infolist():
                    target = root / info.filename
                    private_directory(target.parent)
                    if target.exists():
                        check_file(root, expected[info.filename])
                        continue
                    fd, pending = tempfile.mkstemp(prefix=".nld-receive-", dir=target.parent)
                    complete = False
                    try:
                        with archive.open(info) as source, os.fdopen(fd, "wb") as output:
                            while chunk := source.read(65536):
                                output.write(chunk)
                            output.flush(); os.fsync(output.fileno())
                        actual = file_identity(pending)
                        need(all(actual[k] == expected[info.filename][k] for k in ("bytes", "sha256")), "NLD_RESTORE_COPY_CHANGED")
                        os.link(pending, target, follow_symlinks=False)
                        sync(target.parent)
                        complete = True
                    finally:
                        if complete:
                            Path(pending).unlink(missing_ok=True)
                for definition in project["definitions"]:
                    verify_project(root / "definitions" / definition["id"])
                publish_json(root / ".restored.json", {**intent, "received_at": now()})
        return {"schema": SCHEMA, "status": "RESTORED", "project_id": project_id,
                "checkpoint_id": selected["id"], "members": len(expected), "source_requests": 0}

    def _ensure(self, project):
        root = self._directory(project["id"])
        if not root.exists() or (root / ".restore-intent.json").exists() and not (root / ".restored.json").exists():
            self._materialize(project)
        need((root / "project-binding.json").exists(), "NLD_PROJECT_BINDING_REQUIRED")
        binding = load(root / "project-binding.json")
        need(binding == {"schema": SCHEMA, "project_id": project["id"],
                         "workspace_id": self.analysis.identity, "operation_id": self.model.operation_id},
             "NLD_PROJECT_WORKSPACE_CHANGED")
        return root

    def status(self, *, project_id=None):
        # A concurrent status read must not replace the active writer's object.
        root = self.model._read().get("nld", {"schema": SCHEMA, "projects": []})
        projects = root["projects"]
        if project_id is not None:
            identifier(project_id)
            projects = [p for p in projects if p["id"] == project_id]
            need(len(projects) == 1, "NLD_PROJECT_NOT_FOUND")
        return {"schema": SCHEMA, "workspace_id": self.analysis.identity,
                "operation_id": self.model.operation_id, "projects": projects,
                "meaning": MEANING, "native_execution": "Only run entries with an original completed UID are executed."}

    def rows(self, *, project_id, definition_id=None, run_id=None, kind="source", offset=0, limit=100):
        need(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 500,
             "NLD_ROW_PAGE")
        projects = self.status(project_id=project_id)["projects"]
        project = projects[0]
        root = self._directory(project_id)
        need((root / "project-binding.json").exists(), "NLD_PROJECT_RESTORE_REQUIRED")
        need(kind in ("source", "review", "target"), "NLD_ROW_KIND")
        selected_run = None
        if run_id is not None:
            identifier(run_id)
            selected_run = next((r for r in project["runs"] if r["id"] == run_id), None)
            need(selected_run is not None and selected_run["status"] == "COMPLETE",
                 "NLD_COMPLETE_NATIVE_RUN_REQUIRED")
            if definition_id is not None:
                need(definition_id == selected_run["definition_id"], "NLD_RUN_DEFINITION_CHANGED")
            definition_id = selected_run["definition_id"]
        definition = self._definition(project, definition_id)
        manifest, projection = verify_project(root / "definitions" / definition["id"])
        if kind == "source":
            all_rows, columns = projection["rows"], projection["columns"]
        else:
            need(selected_run is not None, "NLD_RUN_SELECTION_REQUIRED")
            directory = root / "runs" / run_id
            completed = load(directory / "completed.json")
            filename = "target-review.json" if kind == "review" else "target-rows.json"
            member = next((r for r in completed["files"] if r["path"] == filename), None)
            need(member is not None, "NLD_NATIVE_RESULT_MEMBER_MISSING")
            check_file(directory, member)
            content = load(directory / filename)
            all_rows = content["outcomes"] if kind == "review" else content["rows"]
            columns = list(all_rows[0]) if kind == "review" and all_rows else (
                ["business_key", "source_key", "original_row", "state", "selected_in_run",
                 "target_source_edition", "target_analysis_version", "target_original_row",
                 "source_values", "target_values"] if kind == "review" else projection["columns"])
        page = all_rows[offset:offset + limit]
        return {"schema": SCHEMA + "/rows", "project_id": project_id, "definition_id": definition["id"],
                "run_id": run_id, "kind": kind, "offset": offset, "limit": limit,
                "total": len(all_rows), "columns": columns, "rows": page,
                "next_offset": offset + len(page) if offset + len(page) < len(all_rows) else None,
                "source_edition_id": projection["edition_id"], "source_version_id": projection["version_id"]}

    def prepare(self, *, project_id, edition_id, specification, resume=False):
        identifier(project_id); identifier(edition_id, full=True)
        with self.model._mutex:
            edition, version, columns, rows = self._check_original(edition_id)
            projection = project_rows(edition, version, columns, rows, specification)
            state = self._reload()
            project = next((p for p in state["projects"] if p["id"] == project_id), None)
            if project is None:
                project = {"id": project_id, "created_at": now(), "title": projection["specification"]["title"],
                           "meaning_id": projection["meaning_id"], "definitions": [], "runs": [], "reports": [],
                           "checkpoints": [], "current_definition": None}
                state["projects"].append(project)
                self.model._save()
                root = private_directory(self._directory(project_id))
                publish_json(root / "project-binding.json", {"schema": SCHEMA, "project_id": project_id,
                    "workspace_id": self.analysis.identity, "operation_id": self.model.operation_id})
            else:
                # Mapping/identity changes belong to a new explicitly selected
                # project; a new source edition may keep the existing meaning.
                need(project["meaning_id"] == projection["meaning_id"], "NLD_PROJECT_MAPPING_CHANGED",
                     "Create a new project ID for a new identity/mapping contract.")
                root = self._ensure(project)
            task_raw, contract_raw, worker_raw = (read(HERE / leaf) for leaf in
                                                  ("nld_task.py", "nld_contract.py", "nld_worker.py"))
            manifest, files = compile_project(projection, task_raw, contract_raw, worker_raw, project_id=project_id)
            definition = next((d for d in project["definitions"] if d["id"] == manifest["id"]), None)
            definition_dir = private_directory(root / "definitions" / manifest["id"])
            for path, raw in files.items():
                publish(definition_dir / path, raw)
            verify_project(definition_dir)
            if definition is None:
                definition = {"id": manifest["id"], "projection_id": projection["id"], "edition_id": edition_id,
                              "version_id": version["version_id"], "row_count": len(rows),
                              "title": projection["specification"]["title"], "specification": projection["specification"],
                              "created_at": now(), "status": "PREPARED", "native_runs": []}
                project["definitions"].append(definition)
            project["current_definition"] = definition["id"]
            self.model._save()
            checkpoint = self.checkpoint(project_id, reason="Prepared complete native project")
            return {"schema": SCHEMA, "status": "PREPARED", "project_id": project_id,
                    "definition": definition, "checkpoint": checkpoint,
                    "native_execution": "not_started", "source_requests": 0}

    def _resolve_projection(self, project, definition):
        root = self._ensure(project)
        manifest, projection = verify_project(root / "definitions" / definition["id"])
        edition, version, columns, rows = self._check_original(definition["edition_id"])
        rebuilt = project_rows(edition, version, columns, rows, definition["specification"])
        need(rebuilt == projection and manifest["projection_id"] == definition["projection_id"],
             "NLD_SELECTED_ORIGINAL_VERSION_CHANGED")
        return root, manifest, projection

    def execute(self, *, project_id, definition_id, run_id, strategy, operator, note,
                python=None, keys=None, limit=None, resume=False):
        with self.model._mutex:
            project = self._project(project_id)
            definition = self._definition(project, definition_id)
            root, manifest, projection = self._resolve_projection(project, definition)
            request = normalize_request({"schema": RUN_SCHEMA, "project_id": project_id,
                "definition_id": definition_id, "run_id": run_id, "strategy": strategy,
                "operator": operator, "note": note, "keys": keys, "limit": limit}, manifest)
            saved = next((r for r in project["runs"] if r["id"] == run_id), None)
            if saved is None:
                saved = {"id": run_id, "request": request, "request_sha256": identity(request),
                         "status": "PREPARED", "created_at": now(), "definition_id": definition_id}
                project["runs"].append(saved)
                definition["native_runs"].append(run_id)
                self.model._save()
            need(saved["request"] == request, "NLD_ORIGINAL_RUN_REQUEST_CHANGED")
            request_file = root / "requests" / (run_id + ".json")
            publish_json(request_file, request)
            completed_file = root / "runs" / run_id / "completed.json"
            executable = python or sys.executable
            need(isinstance(executable, str) and executable and "\0" not in executable, "NLD_PYTHON_EXECUTABLE")
            if not completed_file.exists():
                if saved.get("status") == "DISPATCHED":
                    need(resume, "NLD_REOPEN_ORIGINAL_RUN", "Continue the original run and its native UID.")
                directory = private_directory(root / "invocations" / run_id)
                # Invocation output stays outside the worker's frozen run closure:
                # its final stdout is written only after completed.json exists.
                attempt = len(saved.setdefault("invocations", []))
                log_name = "worker-" + str(attempt + 1).zfill(3) + ".log"
                log_path = directory / log_name
                arguments = [executable, "-B", "-u", str(root / "definitions" / definition_id / "nld_worker.py"),
                             "--project", str(root), "--definition", definition_id, "--request", str(request_file)]
                if resume:
                    arguments.append("--resume")
                invocation = {"number": attempt + 1, "started_at": now(),
                              "python": executable, "log": (Path("invocations") / run_id / log_name).as_posix(), "status": "PREPARED"}
                saved["invocations"].append(invocation)
                saved["status"] = "DISPATCHED"
                self.model._save()
                try:
                    with log_path.open("xb") as output:
                        os.chmod(log_path, 0o600)
                        process = subprocess.Popen(arguments, stdin=subprocess.DEVNULL, stdout=output,
                                                   stderr=subprocess.STDOUT, shell=False, close_fds=True)
                        invocation["pid"] = process.pid; invocation["status"] = "ENTERED"
                        self.model._save()
                        returncode = process.wait()
                        output.flush(); os.fsync(output.fileno())
                    invocation.update(status="RETURNED", returncode=returncode, ended_at=now(),
                                      file=file_identity(log_path, relative_to=root))
                except BaseException as error:
                    invocation.update(status="UNCONFIRMED", error={"type": type(error).__name__, "message": str(error)})
                    self.model._save()
                    raise
                self.model._save()
                if not completed_file.exists():
                    failed_path = root / "runs" / run_id / "failed-receipt.json"
                    failure = load(failed_path) if failed_path.exists() else None
                    if failure is not None:
                        need(failure["request_sha256"] == identity(request)
                             and failure["native_uid"] == run_id, "NLD_FAILED_RUN_IDENTITY_CHANGED")
                        for member in failure["files"]:
                            check_file(failed_path.parent, member)
                    saved.update(status="FAILED" if failure is not None else "UNRESOLVED",
                                 last_returncode=returncode, failure=failure)
                    self.model._save()
                    # Preserve all original prefixes and logs in the same source
                    # workflow; this does not turn a failed invocation into a run.
                    self.checkpoint(project_id, reason="Retained failed native target" if failure is not None
                                    else "Retained unresolved native invocation")
                    raise NldError("NLD_NATIVE_FAILED" if failure is not None else "NLD_NATIVE_COMPLETION_PENDING",
                                   "The original worker log, UID and available target evidence remain. Continue the original request to read its retained outcome.")
            completed = load(completed_file)
            need(completed.get("request_sha256") == identity(request) and completed["native_uid"] == run_id,
                 "NLD_COMPLETED_NATIVE_IDENTITY_CHANGED")
            for member in completed["files"]:
                check_file(completed_file.parent, member)
            saved.update(status="COMPLETE", completed=completed,
                         completed_file=file_identity(completed_file, relative_to=root))
            self.model._save()
            checkpoint = self.checkpoint(project_id, reason="Completed original NLD run")
            report = self.report(project_id=project_id, run_id=run_id, resume=resume)
            return {"schema": SCHEMA, "status": "COMPLETE", "run": saved,
                    "checkpoint": checkpoint, "report": report, "source_requests": 0}

    def checkpoint(self, project_id, *, reason):
        project = self._project(project_id)
        root = self._ensure(project)
        with project_lock(root):
            members = []
            for item in closure(root):
                parts = Path(item["path"]).parts
                if (item["path"] == ".operate.lock" or "runtime-config" in parts or "__pycache__" in parts
                    or item["path"] in ("target.sqlite", "target.sqlite-wal", "target.sqlite-shm")
                    or item["path"].startswith(".restore-") or item["path"] == ".restored.json"):
                    continue
                members.append(item)
            temporary = private_directory(self.model.directory / "nld" / "checkpoints" / project_id)
            source_files = {}
            if (root / "target.sqlite").exists():
                fd, backup_path = tempfile.mkstemp(prefix=".target-backup-", dir=temporary)
                os.close(fd)
                source_db = sqlite3.connect((root / "target.sqlite").as_uri() + "?mode=ro", uri=True)
                target_db = sqlite3.connect(backup_path)
                try:
                    source_db.backup(target_db)
                    need(target_db.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "NLD_CHECKPOINT_TARGET_INTEGRITY")
                finally:
                    source_db.close(); target_db.close()
                with open(backup_path, "rb") as source:
                    os.fsync(source.fileno())
                descriptor = file_identity(backup_path)
                descriptor["path"] = "target.sqlite"
                members.append(descriptor); source_files["target.sqlite"] = Path(backup_path)
            snapshot_state = {"schema": SCHEMA + "/project-snapshot", "project_id": project_id,
                              "meaning_id": project["meaning_id"], "definitions": project["definitions"],
                              "runs": project["runs"], "current_definition": project["current_definition"],
                              "original_workspace_id": self.analysis.identity, "operation_id": self.model.operation_id}
            snapshot_bytes = encoded(snapshot_state)
            state_path = temporary / (sha(snapshot_bytes) + ".state.json")
            publish(state_path, snapshot_bytes)
            members.append({"path": "checkpoint-state.json", "bytes": len(snapshot_bytes), "sha256": sha(snapshot_bytes)})
            source_files["checkpoint-state.json"] = state_path
            # A received earlier checkpoint-state is superseded by the new
            # current snapshot in this new archive, while its earlier whole
            # archive remains retained in the original document history.
            by_name = {m["path"]: m for m in members}
            members = [by_name[key] for key in sorted(by_name)]
            need(sum(m["bytes"] for m in members) <= MAX_EXPANDED, "NLD_CHECKPOINT_EXPANDED_CAPACITY")
            checkpoint_id = identity({"project_id": project_id, "members": members})
            existing = next((c for c in project["checkpoints"] if c["id"] == checkpoint_id), None)
            if existing:
                self._document_archive(existing)
                return existing
            archive_path = temporary / (checkpoint_id + ".zip")
            archive = export_zip(root, archive_path, members, source_files=source_files)
            need(archive["bytes"] <= MAX_ARCHIVE, "NLD_COMPLETE_PROJECT_DOCUMENT_CAPACITY",
                 "The original ResponseDocument member limit is 32 MiB; keep the complete archive and select a larger supported transfer explicitly.")
            data = {"schema": SCHEMA + "/checkpoint", "project_id": project_id, "checkpoint_id": checkpoint_id,
                    "members": members, "archive": archive, "reason": reason,
                    "definition_ids": [d["id"] for d in project["definitions"]]}
            source_manifest = _source_document(temporary / checkpoint_id, project["title"] + " — complete NLD project",
                data, [("complete-nld-project", archive_path, "application/zip")],
                captured_at=project["created_at"], description="Complete local NLD project, definitions, exact selected source rows, original native state/history, target SQLite backup, receipts and logs. " + reason)
            registered = self.analysis.responses.register("nld_" + checkpoint_id[:24], "document", manifest=source_manifest)
            document_id = sha(read(source_manifest))
            # Read every original registered member before attaching its ID to
            # this same workspace's domain state.
            retained_document_files(self.analysis.database.directory, document_id)
            checkpoint = {"id": checkpoint_id, "document_id": document_id, "source": registered,
                          "archive": archive, "members": members, "created_at": now(), "reason": reason}
            project["checkpoints"].append(checkpoint)
            self.model._save()
            return checkpoint

    def report(self, *, project_id, run_id, resume=False):
        project = self._project(project_id)
        run = next((r for r in project["runs"] if r["id"] == run_id), None)
        need(run is not None and run["status"] == "COMPLETE", "NLD_COMPLETE_NATIVE_RUN_REQUIRED")
        definition = self._definition(project, run["definition_id"])
        root, manifest, projection = self._resolve_projection(project, definition)
        directory = root / "runs" / run_id
        completed = load(directory / "completed.json")
        for member in completed["files"]:
            check_file(directory, member)
        native = load(directory / "native-return.json")
        review = load(directory / "target-review.json")
        need(review["projection_id"] == projection["id"] and native["flow"]["flow_uid"] == run_id,
             "NLD_REPORT_NATIVE_BINDING_CHANGED")
        columns, recipes = _report_collections(projection, completed, native, review)
        data = {key: c["rows"] for key, c in columns.items()}
        report_id = identity({"project_id": project_id, "run_id": run_id, "projection_id": projection["id"],
                              "native": sha(read(directory / "native-return.json")),
                              "review": sha(read(directory / "target-review.json")), "data": data})
        record = next((r for r in project["reports"] if r["edition_id"] == report_id), None)
        if record is not None and record.get("status") == "COMPLETE":
            return record
        checkpoint = project["checkpoints"][-1]
        archive = self._document_archive(checkpoint)
        source = projection["workspace_input"]["source"]
        intro = (str(source.get("publisher", "Retained publisher")) + ". " + str(source.get("license", "Original terms retained")) +
                 ". Source " + str(source.get("url", "")) + "\nNative NLD UID " + run_id + "; status " +
                 completed["native_status"] + ". Matching target rows " + str(review["matching_rows"]) + " of " +
                 str(review["source_rows"]) + " selected original rows. " + str(review["retained_outside_selection"]) +
                 " target rows are outside the current source selection. Known numeric sums retain explicit coverage, units and source years. "
                 "No absent row is deleted; no capture time is used as an update watermark. Complete original source, native state, "
                 "queries, report, workbook and editable project remain in the original Analysis archive.")
        report_dir = private_directory(self.model.directory / "nld" / "reports" / report_id)
        source_manifest = _source_document(report_dir, project["title"] + " — NLD result", data,
            [("complete-nld-project", archive, "application/zip"),
             ("original-native-return", directory / "native-return.json", "application/json"),
             ("original-target-review", directory / "target-review.json", "application/json")],
            captured_at=run["created_at"], description=intro)
        if record is None:
            record = {"edition_id": report_id, "id": report_id, "name": "nld_" + report_id[:20],
                      "title": project["title"] + " — NLD result", "created_at": now(),
                      "row_count": projection["workspace_input"]["row_count"],
                      "source": {**source, "analysis_introduction": intro},
                      "status": "PREPARING", "collections": {}, "files": [],
                      "project_id": project_id, "run_id": run_id,
                      "original_source_edition": projection["edition_id"],
                      "original_analysis_version": projection["version_id"],
                      "complete_project_document_id": checkpoint["document_id"]}
            project["reports"].append(record)
            self.model._save()
        for key, collection in columns.items():
            if not collection["rows"] or key in record["collections"]:
                continue
            record["collections"][key] = self.model._prepare_collection(
                record, key, collection, source_manifest, native_version=None, resume=resume)
            self.model._save()
        self.model._products(record, {"recipes": recipes, "introduction": intro,
            "publication_note": "Original native NLD execution, exact retained source/target comparison and explicit coverage.",
            "workbook_note": "Source numeric values and known subtotals remain exact text; native missing counts remain NULL. Complete project and original source travel in the native workspace archive."}, resume=resume)
        for item in record["files"]:
            if not item["name"].startswith(PREFIX):
                item["name"] = PREFIX + project_id + "-" + run_id + "-" + item["name"]
                item["filename"] = "NLD_" + run_id[:8] + "_" + item["filename"]
        record["status"] = "COMPLETE"
        self.model._save()
        return record

    @staticmethod
    def _delivery_source_identity(project):
        return identity({key: project.get(key) for key in
                         ("id", "meaning_id", "definitions", "current_definition", "runs", "reports")})

    def pack(self, *, project_id, export_id, destination=None, resume=False):
        """Bind one original export ID to its exact retained project checkpoint."""
        identifier(project_id); identifier(export_id)
        project = self._project(project_id)
        deliveries = project.setdefault("deliveries", [])
        delivery = next((d for d in deliveries if d["id"] == export_id), None)
        if delivery is None:
            # An original export created by another operation cannot acquire a
            # new project/checkpoint meaning after its snapshot already exists.
            need(not any(e["id"] == export_id for e in self.model.record["exports"]),
                 "NLD_EXPORT_ID_ALREADY_BOUND")
            need(not any(d["id"] == export_id for p in self.model.record["nld"]["projects"]
                         for d in p.get("deliveries", [])), "NLD_EXPORT_ID_ALREADY_BOUND")
            checkpoint = self.checkpoint(project_id, reason="Complete customer delivery")
            project = self._project(project_id)
            delivery = {"id": export_id, "project_id": project_id,
                        "checkpoint_id": checkpoint["id"], "document_id": checkpoint["document_id"],
                        "archive": {key: checkpoint["archive"][key] for key in ("bytes", "sha256")},
                        "project_state_sha256": self._delivery_source_identity(project),
                        "status": "PREPARED", "created_at": now()}
            project.setdefault("deliveries", []).append(delivery)
            self.model._save()
        checkpoint = next((c for c in project["checkpoints"] if c["id"] == delivery["checkpoint_id"]), None)
        need(checkpoint is not None and delivery["project_id"] == project_id
             and checkpoint["document_id"] == delivery["document_id"]
             and all(checkpoint["archive"][key] == delivery["archive"][key] for key in ("bytes", "sha256")),
             "NLD_DELIVERY_CHECKPOINT_CHANGED")
        self._document_archive(checkpoint)
        exported_record = next((e for e in self.model.record["exports"] if e["id"] == export_id), None)
        native_complete = bool(exported_record and exported_record.get("status") == "COMPLETE")
        if not native_complete and self._delivery_source_identity(project) != delivery["project_state_sha256"]:
            attempts = self.model.record["jobs"].get("WORKSPACE_EXPORT:" + export_id, [])
            if attempts:
                try:
                    job = self.analysis.job(attempts[-1]["id"])
                except StateError as error:
                    if (getattr(error, "code", None) or str(error)) != "ANALYSIS_JOB_NOT_FOUND":
                        raise
                else:
                    native_complete = job.get("status") == "COMPLETE"
            need(native_complete, "NLD_PENDING_DELIVERY_SOURCE_CHANGED",
                 "The saved project changed before this archive completed. Retain this original export and choose a new export ID for the current project.")
        binding = {key: delivery[key] for key in
                   ("id", "project_id", "checkpoint_id", "document_id", "archive", "project_state_sha256")}
        try:
            exported = self.model.export(destination=destination, export_id=export_id, resume=resume)
            project = self._project(project_id)
            current = next(d for d in project["deliveries"] if d["id"] == export_id)
            need(all(current[key] == value for key, value in binding.items()), "NLD_DELIVERY_BINDING_CHANGED")
            export_identity = {key: exported[key] for key in ("id", "job_id", "files")}
            need(current.get("original_export") in (None, export_identity), "NLD_ORIGINAL_DELIVERY_CHANGED")
            current.update(status="COMPLETE", original_export=export_identity)
            current.setdefault("completed_at", now())
            current.pop("error", None)
            self.model._save()
        except BaseException as error:
            project = self._project(project_id)
            current = next(d for d in project["deliveries"] if d["id"] == export_id)
            current.update(status="FAILED", error={"code": getattr(error, "code", type(error).__name__),
                                                    "message": str(error)})
            self.model._save()
            raise
        return {"schema": SCHEMA + "/delivery", "project_id": project_id,
                "export_id": export_id, "checkpoint": checkpoint,
                "original_workspace_export": exported,
                "receiving": "Use the original Analysis archive receiver, then nld.restore in that same received workspace."}

    def dispatch(self, action, body):
        need(isinstance(body, dict), "NLD_REQUEST_OBJECT")
        methods = {"nld.status": self.status, "nld.rows": self.rows,
                   "nld.prepare": self.prepare, "nld.execute": self.execute,
                   "nld.report": self.report, "nld.pack": self.pack, "nld.restore": self.restore_project}
        need(action in methods, "NLD_ACTION_UNKNOWN", action)
        return methods[action](**body)

@contextmanager
def open_nld_download(model, name):
    state = model._read().get("nld", {})
    matches = [item for project in state.get("projects", []) for report in project.get("reports", [])
               for item in report.get("files", []) if item["name"] == name]
    need(len(matches) == 1, "NLD_DOWNLOAD_SELECTION_REQUIRED")
    item = matches[0]
    mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if item["filename"].endswith(".xlsx") else (
        "application/zip" if item["filename"].endswith(".zip") else "text/html;charset=utf-8" if item["filename"].endswith(".html") else "application/json")
    if item["kind"] == "workbook":
        with model.analysis.workbooks.download(item["job_id"], item["native_name"]) as (stream, descriptor):
            need(all(item[k] == descriptor[k] for k in ("bytes", "sha256")), "NLD_DOWNLOAD_BINDING_CHANGED")
            yield stream, {**item, "content_type": mime}
    else:
        path, descriptor = model.analysis.report_export_file(item["job_id"])
        need(all(item[k] == descriptor[k] for k in ("bytes", "sha256")), "NLD_DOWNLOAD_BINDING_CHANGED")
        with held(path) as (stream, _):
            need(file_identity(path)["sha256"] == item["sha256"], "NLD_DOWNLOAD_SOURCE_CHANGED")
            yield stream, {**item, "content_type": mime}
