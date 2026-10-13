"""Persistent operator workflow around the original acceptance/verify.py engine."""
from __future__ import annotations

import copy
import csv
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import uuid
import zipfile
from collections import Counter, OrderedDict
from contextlib import contextmanager

from .adapters import KINDS, REQUIRED, TRANSITIONS, InvalidData, canonical, csv_bytes, mapped_rows, parse, suggested_mapping, validate_mapping

SCHEMA = "mcpherson-asset-workspace-v1"
ID = lambda: uuid.uuid4().hex
SHA = lambda body: hashlib.sha256(body).hexdigest()


class Conflict(ValueError):
    pass


class Workspace:
    def __init__(self, directory, create=False):
        requested = Path(directory).absolute()
        if requested.is_symlink():
            raise InvalidData("Open the original private workspace directory")
        self.root = requested.resolve()
        if create:
            self.root.mkdir(mode=0o700, parents=True, exist_ok=False)
        if not self.root.is_dir() or self.root.is_symlink():
            raise InvalidData("Use an existing private workspace, or create a new directory")
        os.chmod(self.root, 0o700)
        self.database = self.root / "workspace.sqlite3"
        if self.database.is_symlink() or (not create and not self.database.is_file()):
            raise InvalidData("Initialize a new workspace or open its existing original database")
        self.cache = OrderedDict()
        self.cache_lock = threading.RLock()
        with self.connection() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,title TEXT NOT NULL,mode TEXT NOT NULL,
              revision INTEGER NOT NULL,state TEXT NOT NULL,created_at REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS inputs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,kind TEXT NOT NULL,
              filename TEXT NOT NULL,format TEXT NOT NULL,sha256 TEXT NOT NULL,body BLOB NOT NULL,
              row_count INTEGER NOT NULL,columns_json TEXT NOT NULL,metadata TEXT NOT NULL,created_at REAL NOT NULL,
              UNIQUE(project_id,kind,sha256));
            CREATE TABLE IF NOT EXISTS history(project_id TEXT NOT NULL,revision INTEGER NOT NULL,
              state TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,detail TEXT NOT NULL,at REAL NOT NULL,
              PRIMARY KEY(project_id,revision));
            CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,
              request_hash TEXT NOT NULL,result TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS native_runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,
              data_hash TEXT NOT NULL,result TEXT NOT NULL,packet BLOB NOT NULL,created_at REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,revision INTEGER NOT NULL,
              state TEXT NOT NULL,note TEXT NOT NULL,actor TEXT NOT NULL,created_at REAL NOT NULL,packet BLOB);
            """)
            prior = db.execute("SELECT value FROM settings WHERE key='schema'").fetchone()
            if prior and prior["value"] != SCHEMA:
                raise InvalidData("Unsupported workspace schema")
            db.execute("INSERT OR IGNORE INTO settings VALUES('schema',?)", (SCHEMA,))
            if "packet" not in {row["name"] for row in db.execute("PRAGMA table_info(releases)")}:
                db.execute("ALTER TABLE releases ADD COLUMN packet BLOB")
        os.chmod(self.database, 0o600)

    @contextmanager
    def connection(self, write=False):
        db = sqlite3.connect(self.database, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
        try:
            if write:
                db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def projects(self):
        with self.connection() as db:
            return [dict(row) for row in db.execute("SELECT id,title,mode,revision,created_at FROM projects ORDER BY created_at DESC")]

    def create_project(self, title, mode, actor, operation=None):
        if mode not in ("development", "vendor-authorized", "public-reference") or not isinstance(title, str) or not 1 <= len(title.strip()) <= 150:
            raise InvalidData("Name the project and select development, public-reference or vendor-authorized inputs")
        if not isinstance(actor, str) or not 1 <= len(actor.strip()) <= 150:
            raise InvalidData("A named operator is required")
        operation = operation or ID()
        if not isinstance(operation, str) or not 1 <= len(operation) <= 100:
            raise InvalidData("Use one operation ID for project creation and retries")
        request_hash = SHA(canonical(["create", title, mode, actor]).encode())
        project_id, now = ID(), time.time()
        state = {"inputs": {}, "mappings": {}, "decisions": {}, "repairs": [], "changes": [], "work_order_overrides": {},
                 "exclusions": {}, "comparison_fields": ["label", "status", "parent_id", "location_id", "geometry"],
                 "transitions": TRANSITIONS, "current_release": None, "native_run": None,
                 "attestation": {"supplier_reviewer": "", "city_data_authorization_ref": "", "vendor_sow_ref": ""},
                 "expected_source_rows": None, "expected_target_rows": None, "expected_correlation_ids": []}
        with self.connection(write=True) as db:
            prior = db.execute("SELECT request_hash,result FROM operations WHERE id=?", (operation,)).fetchone()
            if prior:
                if prior["request_hash"] != request_hash:
                    raise Conflict("This operation ID already belongs to a different action")
                return json.loads(prior["result"])
            db.execute("INSERT INTO projects VALUES(?,?,?,?,?,?)", (project_id, title.strip(), mode, 0, canonical(state), now))
            db.execute("INSERT INTO history VALUES(?,?,?,?,?,?,?)", (project_id, 0, canonical(state), "project_created", actor, "{}", now))
            db.execute("INSERT INTO operations VALUES(?,?,?,?)", (operation, project_id, request_hash, canonical({"id": project_id, "revision": 0})))
        return {"id": project_id, "revision": 0}

    def project(self, project_id, db=None):
        if db is None:
            with self.connection() as connection:
                return self.project(project_id, connection)
        row = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise KeyError(project_id)
        return {**dict(row), "state": json.loads(row["state"])}

    def _change(self, project_id, expected_revision, actor, operation, action, payload, mutate):
        if not isinstance(actor, str) or not 1 <= len(actor.strip()) <= 150:
            raise InvalidData("A named operator is required")
        if not isinstance(operation, str) or not 1 <= len(operation) <= 100:
            raise InvalidData("Use one operation ID for this action and its retries")
        request_hash = SHA(canonical([project_id, expected_revision, actor, action, payload]).encode())
        with self.connection(write=True) as db:
            prior = db.execute("SELECT * FROM operations WHERE id=?", (operation,)).fetchone()
            if prior:
                if prior["request_hash"] != request_hash:
                    raise Conflict("This operation ID already belongs to a different action")
                return json.loads(prior["result"])
            project = self.project(project_id, db)
            if type(expected_revision) is not int or project["revision"] != expected_revision:
                raise Conflict("The workspace changed. Refresh the current project before applying this edit")
            state = copy.deepcopy(project["state"])
            detail = mutate(db, state, project) or {}
            revision = expected_revision + 1
            db.execute("UPDATE projects SET revision=?,state=? WHERE id=?", (revision, canonical(state), project_id))
            db.execute("INSERT INTO history VALUES(?,?,?,?,?,?,?)", (project_id, revision, canonical(state), action, actor, canonical(detail), time.time()))
            result = {"project_id": project_id, "revision": revision, "action": action, **detail}
            db.execute("INSERT INTO operations VALUES(?,?,?,?)", (operation, project_id, request_hash, canonical(result)))
            return result

    def input(self, input_id, project_id=None):
        with self.connection() as db:
            row = db.execute("SELECT * FROM inputs WHERE id=?", (input_id,)).fetchone()
        if not row or project_id and row["project_id"] != project_id:
            raise KeyError(input_id)
        return {**dict(row), "columns": json.loads(row["columns_json"]), "metadata": json.loads(row["metadata"])}

    def parsed(self, input_id):
        with self.cache_lock:
            if input_id in self.cache:
                self.cache.move_to_end(input_id)
                return self.cache[input_id]
        record = self.input(input_id)
        if record["kind"] == "roundtrips":
            value = {"columns": [], "rows": [], "metadata": {"format": "jsonl"}}
        else:
            value = parse(record["body"], record["format"])
        with self.cache_lock:
            self.cache[input_id] = value
            while len(self.cache) > 4:
                self.cache.popitem(last=False)
        return value

    def import_data(self, project_id, expected_revision, actor, operation, kind, filename, file_format, body):
        if kind not in (*KINDS, "roundtrips"):
            raise InvalidData("Unknown input type")
        filename = Path(filename.replace("\\", "/")).name
        if not filename or len(filename) > 180:
            raise InvalidData("Use a short input filename")
        if kind == "roundtrips":
            if file_format != "jsonl":
                raise InvalidData("Original round-trip evidence uses JSONL")
            parsed = parse(body, "jsonl")
        else:
            parsed = parse(body, file_format)
        digest = SHA(body)
        if file_format == "belleville-capture" and kind != "source_assets":
            raise InvalidData("Import the public capture as source assets; select the actual vendor export for target assets")
        if file_format == "maximo-target" and kind != "target_assets":
            raise InvalidData("Import the complete Maximo carrier as target assets")
        def mutate(db, state, project):
            old = db.execute("SELECT id FROM inputs WHERE project_id=? AND kind=? AND sha256=?", (project_id, kind, digest)).fetchone()
            input_id = old["id"] if old else ID()
            if not old:
                db.execute("INSERT INTO inputs VALUES(?,?,?,?,?,?,?,?,?,?,?)", (input_id, project_id, kind, filename, file_format, digest, body,
                           len(parsed["rows"]), canonical(parsed["columns"]), canonical(parsed["metadata"]), time.time()))
            state["inputs"][kind] = input_id
            if kind in KINDS:
                previous = state["mappings"].get(kind)
                if not previous or previous["columns"] != parsed["columns"]:
                    state["mappings"][kind] = {"value": suggested_mapping(kind, parsed["columns"]), "confirmed": False, "columns": parsed["columns"]}
            return {"input_id": input_id, "kind": kind, "sha256": digest, "rows": len(parsed["rows"]), "reused_original": bool(old)}
        return self._change(project_id, expected_revision, actor, operation, "input_selected", {"kind": kind, "sha256": digest, "filename": filename, "format": file_format}, mutate)

    def save_mapping(self, project_id, expected_revision, actor, operation, kind, mapping):
        def mutate(db, state, project):
            input_id = state["inputs"].get(kind)
            if not input_id or kind not in KINDS:
                raise InvalidData("Import this dataset first")
            columns = self.parsed(input_id)["columns"]
            value = validate_mapping(kind, mapping, columns)
            state["mappings"][kind] = {"value": value, "confirmed": True, "columns": columns, "actor": actor, "at": time.time()}
            return {"kind": kind, "mapping_sha256": SHA(canonical(value).encode())}
        return self._change(project_id, expected_revision, actor, operation, "mapping_saved", {"kind": kind, "mapping": mapping}, mutate)

    def select_input(self, project_id, expected_revision, actor, operation, kind, input_id, reason):
        if kind not in (*KINDS, "roundtrips") or not isinstance(reason, str) or not reason.strip():
            raise InvalidData("Select an input type and explain its selection or removal")
        def mutate(db, state, project):
            if input_id is None:
                state["inputs"].pop(kind, None)
                state["mappings"].pop(kind, None)
            else:
                original = self.input(input_id, project_id)
                if original["kind"] != kind:
                    raise InvalidData("Select an original input of the same dataset type")
                state["inputs"][kind] = input_id
                if kind in KINDS:
                    prior = state["mappings"].get(kind)
                    if not prior or prior["columns"] != original["columns"]:
                        state["mappings"][kind] = {"value": suggested_mapping(kind, original["columns"]),
                            "confirmed": False, "columns": original["columns"]}
            return {"kind": kind, "input_id": input_id, "reason": reason.strip()}
        return self._change(project_id, expected_revision, actor, operation, "original_input_selected",
                            {"kind": kind, "input_id": input_id, "reason": reason}, mutate)

    def _data(self, state):
        datasets, issues = {}, []
        for kind, input_id in state["inputs"].items():
            if kind not in KINDS:
                continue
            mapping = state["mappings"].get(kind)
            if not mapping or not mapping["confirmed"]:
                issues.append({"kind": kind, "row": 0, "field": "mapping", "message": "Review and save the input mapping"})
                datasets[kind] = []
                continue
            try:
                rows, errors = mapped_rows(kind, self.parsed(input_id), mapping["value"])
                datasets[kind] = rows
                issues.extend({"kind": kind, **error} for error in errors)
            except InvalidData as error:
                datasets[kind] = []
                issues.append({"kind": kind, "row": 0, "field": "mapping", "message": str(error)})
        return datasets, issues

    @staticmethod
    def _finding(kind, row, code, field, message, severity="error", record=None):
        identity = SHA(canonical([kind, row, code, field, message]).encode())[:24]
        return {"id": identity, "kind": kind, "row": row, "code": code, "field": field, "message": message,
                "severity": severity, "record_id": (record or {}).get("id", "")}

    def inspect(self, project):
        state = project["state"]
        datasets, issues = self._data(state)
        findings = [self._finding(x["kind"], x["row"], "mapping_or_geometry", x["field"], x["message"]) for x in issues]
        indexes = {}
        for kind, rows in datasets.items():
            if kind == "returns":
                continue
            ids = Counter(row["id"] for row in rows)
            indexes[kind] = {row["id"]: row for row in rows if row["id"] and ids[row["id"]] == 1}
            for row in rows:
                if not row["id"].strip():
                    findings.append(self._finding(kind, row["_row"], "empty_id", "id", "A record needs a nonempty identifier", record=row))
                elif row["id"] != row["id"].strip():
                    findings.append(self._finding(kind, row["_row"], "id_whitespace", "id", "The original checker strips key whitespace; explicitly select trim_ids in the mapping", record=row))
                elif ids[row["id"]] > 1:
                    findings.append(self._finding(kind, row["_row"], "duplicate_id", "id", "Identifier occurs more than once in this input", record=row))
        assets, targets = indexes.get("source_assets", {}), indexes.get("target_assets", {})
        locations, requests = indexes.get("locations", {}), indexes.get("requests", {})
        for kind in ("source_assets", "target_assets"):
            current = indexes.get(kind, {})
            hierarchy = {}
            for row in current.values():
                for field, reference in (("parent_id", current), ("location_id", locations)):
                    if row.get(field) and row[field] not in reference:
                        findings.append(self._finding(kind, row["_row"], "missing_relation", field, "Referenced " + field + " is absent from its selected dataset", record=row))
                # Resolve each path once; a long linear asset hierarchy is O(n).
                if row["id"] not in hierarchy:
                    path, seen, node = [], set(), row["id"]
                    while node and node in current and node not in hierarchy and node not in seen:
                        seen.add(node)
                        path.append(node)
                        node = current[node].get("parent_id")
                    cycle = node in seen or hierarchy.get(node, False)
                    for member in path:
                        hierarchy[member] = cycle
                if hierarchy.get(row["id"]):
                    findings.append(self._finding(kind, row["_row"], "hierarchy_cycle", "parent_id", "Container/component hierarchy reaches a cycle", record=row))
        for kind in ("requests", "work_orders"):
            for row in datasets.get(kind, []):
                if row["asset_id"] not in assets:
                    findings.append(self._finding(kind, row["_row"], "missing_asset", "asset_id", "Asset is absent from the selected source inventory", record=row))
                if kind == "requests" and row["location_id"] and row["location_id"] not in locations:
                    findings.append(self._finding(kind, row["_row"], "missing_location", "location_id", "Location is absent from the selected location input", record=row))
                if kind == "work_orders" and row["request_id"]:
                    request = requests.get(row["request_id"])
                    if not request or request["asset_id"] != row["asset_id"]:
                        findings.append(self._finding(kind, row["_row"], "request_asset_conflict", "request_id", "Request must exist and refer to the same asset", record=row))
                if kind == "work_orders":
                    effective = self._work_order(state, row)
                    if effective["status"] not in state["transitions"]:
                        findings.append(self._finding(kind, row["_row"], "unknown_status", "status", "Work-order status is absent from the saved transition contract", record=row))
                    if effective["revision"] < 1:
                        findings.append(self._finding(kind, row["_row"], "invalid_revision", "revision", "Use a positive whole-number source revision", record=row))
        request_groups = Counter((row["asset_id"], " ".join(row["summary"].casefold().split())) for row in datasets.get("requests", []))
        for row in datasets.get("requests", []):
            if row["summary"] and request_groups[(row["asset_id"], " ".join(row["summary"].casefold().split()))] > 1:
                findings.append(self._finding("requests", row["_row"], "possible_duplicate_request", "summary", "Another request has the same asset and summary; keep or merge explicitly in the vendor workflow", "warning", row))
        source_only = project["mode"] == "public-reference" and "source_assets" in state["inputs"] and "target_assets" not in state["inputs"]
        if source_only:
            findings.append(self._finding("inventory", 0, "target_not_selected", "", "Public source is ready for mapping review. Import the actual target export to begin source-to-target reconciliation.", "warning"))
        elif "source_assets" not in state["inputs"] or "target_assets" not in state["inputs"]:
            findings.append(self._finding("inventory", 0, "missing_inventory", "", "Select both source and target asset exports"))
        for key, source in assets.items():
            if key in state["exclusions"]:
                if key in targets:
                    findings.append(self._finding("source_assets", source["_row"], "exclusion_present_in_target", "id", "Excluded source still occurs in the target export", record=source))
                continue
            target = targets.get(key)
            if not target and source_only:
                continue
            if not target:
                findings.append(self._finding("source_assets", source["_row"], "missing_target", "id", "Source asset is absent from the selected target export", record=source))
            else:
                for field in state["comparison_fields"]:
                    if source[field] != target[field]:
                        findings.append(self._finding("target_assets", target["_row"], "field_difference", field, "Source and target mapped values differ", record=target))
        for key, target in targets.items():
            if key not in assets:
                findings.append(self._finding("target_assets", target["_row"], "target_orphan", "id", "Target asset has no matching source key; preserve it while resolving the comparison scope", record=target))
        for kind, input_id in state["inputs"].items():
            if self.input(input_id)["metadata"].get("exceeded_transfer_limit"):
                findings.append(self._finding(kind, 0, "incomplete_esri_export", "", "Esri export reports exceededTransferLimit; import complete paginated source data"))
        for finding in findings:
            finding["decision"] = state["decisions"].get(finding["id"])
        return {"datasets": datasets, "indexes": indexes, "findings": findings,
                "errors": sum(f["severity"] == "error" for f in findings), "warnings": sum(f["severity"] == "warning" for f in findings)}

    def view(self, project_id):
        project = self.project(project_id)
        inspected = self.inspect(project)
        inputs = []
        with self.connection() as db:
            for row in db.execute("SELECT id,kind,filename,format,sha256,row_count,columns_json,metadata,created_at FROM inputs WHERE project_id=? ORDER BY created_at DESC", (project_id,)):
                record = dict(row)
                record["columns"] = json.loads(record.pop("columns_json"))
                record["metadata"] = json.loads(record["metadata"])
                record["selected"] = project["state"]["inputs"].get(record["kind"]) == record["id"]
                inputs.append(record)
            history = [dict(row) for row in db.execute("SELECT revision,action,actor,detail,at FROM history WHERE project_id=? ORDER BY revision DESC LIMIT 100", (project_id,))]
            releases = [dict(row) for row in db.execute("SELECT id,revision,note,actor,created_at FROM releases WHERE project_id=? ORDER BY created_at DESC", (project_id,))]
            runs = [dict(row) for row in db.execute("SELECT id,data_hash,result,created_at FROM native_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 20", (project_id,))]
        for run in runs:
            run["result"] = json.loads(run["result"])
        return {"project": project, "inputs": inputs, "counts": {kind: len(rows) for kind, rows in inspected["datasets"].items()},
                "errors": inspected["errors"], "warnings": inspected["warnings"], "findings": inspected["findings"],
                "history": history, "releases": releases, "native_runs": runs, "kinds": KINDS, "required": REQUIRED}

    def records(self, project_id, kind, query="", page=0, page_size=50, record_id=None):
        if kind not in KINDS or type(page) is not int or page < 0 or type(page_size) is not int or not 1 <= page_size <= 200:
            raise InvalidData("Select a dataset and nonnegative page")
        project = self.project(project_id)
        datasets, _ = self._data(project["state"])
        rows = datasets.get(kind, [])
        if kind == "work_orders":
            rows = [self._work_order(project["state"], row) for row in rows]
        if record_id is not None:
            rows = [row for row in rows if row.get("id", row.get("change_id")) == record_id]
        if query:
            rows = [row for row in rows if query.casefold() in canonical(row).casefold()]
        return {"kind": kind, "page": page, "total": len(rows), "page_size": page_size,
                "rows": rows[page * page_size:(page + 1) * page_size], "revision": project["revision"]}

    def save_settings(self, project_id, expected_revision, actor, operation, settings):
        def mutate(db, state, project):
            fields = settings.get("comparison_fields")
            if not isinstance(fields, list) or not fields or len(set(fields)) != len(fields) or any(field not in KINDS["source_assets"] or field == "id" for field in fields):
                raise InvalidData("Select distinct asset comparison fields")
            transitions = settings.get("transitions")
            if not isinstance(transitions, dict) or not transitions or any(not isinstance(key, str) or not key or not isinstance(values, list) or any(not isinstance(value, str) or not value for value in values) for key, values in transitions.items()):
                raise InvalidData("Provide explicit status-to-allowed-status transitions")
            if any(value not in transitions for values in transitions.values() for value in values):
                raise InvalidData("Every destination status must have a transition entry, including terminal states")
            attestation = settings.get("attestation")
            if not isinstance(attestation, dict) or set(attestation) != {"supplier_reviewer", "city_data_authorization_ref", "vendor_sow_ref"} or any(not isinstance(value, str) or len(value) > 1000 for value in attestation.values()):
                raise InvalidData("Retain the original three named engagement references")
            for key in ("expected_source_rows", "expected_target_rows"):
                value = settings.get(key)
                if value is not None and (type(value) is not int or value < 1):
                    raise InvalidData("Full-export counts must be positive integers or remain unrecorded")
                state[key] = value
            correlations = settings.get("expected_correlation_ids", [])
            if not isinstance(correlations, list) or any(not isinstance(value, str) or not value.strip() for value in correlations) or len(set(correlations)) != len(correlations):
                raise InvalidData("Record the expected distinct observed round-trip correlations")
            state.update(comparison_fields=fields, transitions=transitions, attestation=attestation, expected_correlation_ids=correlations)
            return {"comparison_fields": fields, "transition_states": list(transitions)}
        return self._change(project_id, expected_revision, actor, operation, "project_contract_saved", settings, mutate)

    def review(self, project_id, expected_revision, actor, operation, finding_id, decision, note):
        if decision not in ("repair_requested", "reviewed", "keep_separate") or not isinstance(note, str) or not 1 <= len(note.strip()) <= 4000:
            raise InvalidData("Select a disposition and explain it")
        def mutate(db, state, project):
            if finding_id not in {f["id"] for f in self.inspect(project)["findings"]}:
                raise Conflict("This finding no longer describes the current selected inputs")
            state["decisions"][finding_id] = {"decision": decision, "note": note.strip(), "actor": actor, "at": time.time()}
            return {"finding_id": finding_id, "decision": decision}
        return self._change(project_id, expected_revision, actor, operation, "finding_reviewed", {"finding_id": finding_id, "decision": decision, "note": note}, mutate)

    def exclude(self, project_id, expected_revision, actor, operation, asset_id, reason, remove=False):
        if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 4000:
            raise InvalidData("Explain the source exclusion decision")
        def mutate(db, state, project):
            view = self.inspect(project)
            if asset_id not in view["indexes"].get("source_assets", {}):
                raise InvalidData("Select one unique source asset")
            if remove:
                state["exclusions"].pop(asset_id, None)
            else:
                if asset_id in view["indexes"].get("target_assets", {}):
                    raise InvalidData("An approved omission must be absent from the actual target export")
                state["exclusions"][asset_id] = {"source_key": asset_id, "reason": reason.strip(), "approved_by": actor}
            return {"asset_id": asset_id, "excluded": not remove, "reason": reason.strip()}
        return self._change(project_id, expected_revision, actor, operation, "exclusion_recorded", {"asset_id": asset_id, "reason": reason, "remove": remove}, mutate)

    def propose_repair(self, project_id, expected_revision, actor, operation, kind, row_number, field, value, reason):
        if kind not in KINDS or field not in KINDS[kind] or not isinstance(value, str) or len(value) > 100000 or not isinstance(reason, str) or not reason.strip():
            raise InvalidData("Select an input field and explain its proposed replacement")
        def mutate(db, state, project):
            rows = self._data(state)[0].get(kind, [])
            row = next((item for item in rows if item["_row"] == row_number), None)
            if row is None:
                raise InvalidData("Select a current input row")
            proposal = {"id": ID(), "input_id": state["inputs"][kind], "kind": kind, "row": row_number,
                        "field": field, "before": row[field], "after": value, "reason": reason.strip(), "actor": actor, "at": time.time()}
            state["repairs"].append(proposal)
            return {"repair_id": proposal["id"], "kind": kind, "row": row_number, "field": field}
        return self._change(project_id, expected_revision, actor, operation, "repair_proposed", {"kind": kind, "row": row_number, "field": field, "value": value, "reason": reason}, mutate)

    @staticmethod
    def _work_order(state, row):
        current = dict(row)
        current["revision"] = int(row.get("revision")) if str(row.get("revision") or "").isascii() and str(row.get("revision") or "").isdigit() else 0
        override = state["work_order_overrides"].get(row["id"])
        if override and override["input_id"] == state["inputs"].get("work_orders"):
            current.update(status=override["status"], revision=override["revision"], returned_reference=override["provider_reference"])
        return current

    def request_status(self, project_id, expected_revision, actor, operation, work_order_id, desired_status, note):
        if not isinstance(note, str) or not note.strip():
            raise InvalidData("Describe the requested work-order change")
        def mutate(db, state, project):
            view = self.inspect(project)
            row = view["indexes"].get("work_orders", {}).get(work_order_id)
            if not row:
                raise InvalidData("Select one uniquely identified work order")
            row = self._work_order(state, row)
            if row["revision"] < 1 or desired_status not in state["transitions"].get(row["status"], []):
                raise InvalidData("This status transition or work-order revision is not in the current contract")
            if any(change["work_order_id"] == work_order_id and change["state"] == "requested" for change in state["changes"]):
                raise Conflict("This work order already has a requested update awaiting a returned result")
            change = {"id": ID(), "work_order_id": work_order_id, "asset_id": row["asset_id"], "request_id": row["request_id"],
                      "input_id": state["inputs"]["work_orders"], "expected_revision": row["revision"], "previous_status": row["status"],
                      "status": desired_status, "note": note.strip(), "state": "requested", "actor": actor, "at": time.time()}
            state["changes"].append(change)
            return {"change_id": change["id"], "work_order_id": work_order_id, "expected_revision": row["revision"]}
        return self._change(project_id, expected_revision, actor, operation, "status_change_requested", {"work_order_id": work_order_id, "status": desired_status, "note": note}, mutate)

    def apply_returns(self, project_id, expected_revision, actor, operation):
        def mutate(db, state, project):
            view = self.inspect(project)
            mapping = state["mappings"].get("returns")
            if not mapping or not mapping["confirmed"] or not view["datasets"].get("returns"):
                raise InvalidData("Import and map the actual returned update records first")
            changes = {change["id"]: change for change in state["changes"]}
            returned = view["datasets"]["returns"]
            if len({row["change_id"] for row in returned}) != len(returned):
                raise InvalidData("Returned file repeats a change ID")
            applied, reused, rejected = [], [], []
            for row in returned:
                change = changes.get(row["change_id"])
                if not change or not row["provider_reference"].strip() or row["result"] not in ("ok", "rejected"):
                    raise InvalidData(f"Return row {row['_row']} needs a known change, provider reference, and result ok or rejected")
                identity = {key: row[key] for key in KINDS["returns"]}
                response_hash = SHA(canonical(identity).encode())
                if change["state"] in ("applied", "rejected"):
                    if change["response_hash"] != response_hash:
                        raise Conflict("An already applied change has a different returned result")
                    reused.append(change["id"])
                    continue
                raw = view["indexes"].get("work_orders", {}).get(change["work_order_id"])
                if not raw or state["inputs"].get("work_orders") != change["input_id"]:
                    raise Conflict("The work-order source changed after the request; reconcile that request against the new export")
                current = self._work_order(state, raw)
                if any(row[key] != change[key] for key in ("work_order_id", "asset_id", "request_id", "status")) or row["expected_revision"] != str(change["expected_revision"]):
                    raise Conflict("Returned identifiers, desired status or expected revision differ from the exact request")
                if row["result"] == "rejected":
                    change.update(state="rejected", response_hash=response_hash, returned_input_id=state["inputs"]["returns"],
                                  applied_by=actor, applied_at=time.time(), provider_reference=row["provider_reference"])
                    rejected.append(change["id"])
                    continue
                if current["revision"] != change["expected_revision"] or current["status"] != change["previous_status"]:
                    raise Conflict("Another returned update has changed the work order")
                if row["status"] not in state["transitions"].get(current["status"], []):
                    raise Conflict("The current transition contract no longer permits this returned status")
                state["work_order_overrides"][change["work_order_id"]] = {"input_id": change["input_id"], "status": row["status"],
                    "revision": current["revision"] + 1, "provider_reference": row["provider_reference"], "response_hash": response_hash}
                change.update(state="applied", response_hash=response_hash, returned_input_id=state["inputs"]["returns"], applied_by=actor, applied_at=time.time())
                applied.append(change["id"])
            return {"applied": applied, "already_applied": reused, "rejected": rejected, "returned_input_id": state["inputs"]["returns"]}
        return self._change(project_id, expected_revision, actor, operation, "returned_updates_applied", {}, mutate)

    def withdraw_change(self, project_id, expected_revision, actor, operation, change_id, reason):
        if not isinstance(reason, str) or not reason.strip():
            raise InvalidData("Explain why this local request is withdrawn")
        def mutate(db, state, project):
            change = next((item for item in state["changes"] if item["id"] == change_id), None)
            if not change or change["state"] != "requested":
                raise InvalidData("Only a pending local request can be withdrawn")
            change.update(state="withdrawn", withdrawn_by=actor, withdrawn_at=time.time(), withdrawal_reason=reason.strip())
            return {"change_id": change_id, "reason": reason.strip()}
        return self._change(project_id, expected_revision, actor, operation, "local_request_withdrawn",
                            {"change_id": change_id, "reason": reason}, mutate)

    @staticmethod
    def data_hash(state):
        return SHA(canonical({key: state[key] for key in ("inputs", "mappings", "exclusions", "comparison_fields", "attestation", "expected_source_rows", "expected_target_rows", "expected_correlation_ids")}).encode())

    def native_check(self, project_id, expected_revision, actor, operation):
        def mutate(db, state, project):
            datasets, issues = self._data(state)
            if issues or not datasets.get("source_assets") or not datasets.get("target_assets") or not state["inputs"].get("roundtrips"):
                raise InvalidData("Map source/target inventory and import the recorded original round-trip JSONL")
            native_file = Path(__file__).parents[1] / "acceptance" / "verify.py"
            specification = importlib.util.spec_from_file_location("mcpherson_original_acceptance", native_file)
            native = importlib.util.module_from_spec(specification)
            specification.loader.exec_module(native)
            run_id = ID()
            fields = ["id", *state["comparison_fields"]]
            contents = {"source.csv": csv_bytes(datasets["source_assets"], fields), "target.csv": csv_bytes(datasets["target_assets"], fields),
                        "roundtrips.jsonl": self.input(state["inputs"]["roundtrips"])["body"]}
            manifest = {"schema": native.SCHEMA, "run_id": run_id, "attestation": state["attestation"],
                        "source": {"path": "source.csv", "key": "id"}, "target": {"path": "target.csv", "source_key": "id"},
                        "field_pairs": [{"source": field, "target": field} for field in state["comparison_fields"]],
                        "expected_source_rows": state["expected_source_rows"], "expected_target_rows": state["expected_target_rows"],
                        "approved_exclusions": list(state["exclusions"].values()), "roundtrip_jsonl": "roundtrips.jsonl",
                        "expected_correlation_ids": state["expected_correlation_ids"]}
            contents["manifest.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
            contents["transformations.json"] = (json.dumps({"input_ids": state["inputs"], "mappings": state["mappings"],
                "manual_repairs_applied": False, "mode": project["mode"]}, indent=2) + "\n").encode()
            with tempfile.TemporaryDirectory(prefix="native-review-", dir=self.root) as temporary:
                for name, body in contents.items():
                    path = Path(temporary) / name
                    path.write_bytes(body)
                    os.chmod(path, 0o600)
                try:
                    result = {"status": "consistent", "receipt": native.verify(Path(temporary) / "manifest.json")}
                except (native.InvalidPacket, ValueError, OSError, UnicodeError, csv.Error) as error:
                    result = {"status": "needs_repair", "message": str(error)}
            result.update(mode=project["mode"], original_engine_sha256=SHA(native_file.read_bytes()), manual_repairs_applied=False)
            contents["result.json"] = (json.dumps(result, indent=2) + "\n").encode()
            packet = self._zip(contents)
            db.execute("INSERT INTO native_runs VALUES(?,?,?,?,?,?)", (run_id, project_id, self.data_hash(state), canonical(result), packet, time.time()))
            state["native_run"] = run_id
            return {"run_id": run_id, "result": result}
        return self._change(project_id, expected_revision, actor, operation, "original_acceptance_run", {}, mutate)

    def release(self, project_id, expected_revision, actor, operation, note):
        if not isinstance(note, str) or not 1 <= len(note.strip()) <= 4000:
            raise InvalidData("Explain the internal handoff decision")
        def mutate(db, state, project):
            inspected = self.inspect(project)
            if inspected["errors"]:
                raise InvalidData("Repair the current source, mapping or relationship errors before releasing this handoff")
            run = db.execute("SELECT * FROM native_runs WHERE id=? AND project_id=?", (state["native_run"], project_id)).fetchone()
            if not run or run["data_hash"] != self.data_hash(state) or json.loads(run["result"])["status"] != "consistent":
                raise InvalidData("Run the original checker against these exact selected inputs and mappings before release")
            release_id = ID()
            state["current_release"] = release_id
            db.execute("INSERT INTO releases VALUES(?,?,?,?,?,?,?,NULL)", (release_id, project_id, expected_revision + 1, canonical(state), note.strip(), actor, time.time()))
            return {"release_id": release_id, "note": note.strip()}
        result = self._change(project_id, expected_revision, actor, operation, "handoff_released", {"note": note}, mutate)
        self.export(project_id, result["release_id"])
        return result

    def restore_revision(self, project_id, expected_revision, actor, operation, target_revision, reason):
        if type(target_revision) is not int or not isinstance(reason, str) or not reason.strip():
            raise InvalidData("Select a retained revision and explain its restoration")
        def mutate(db, state, project):
            old = db.execute("SELECT state FROM history WHERE project_id=? AND revision=?", (project_id, target_revision)).fetchone()
            if not old:
                raise InvalidData("The selected project revision is not retained")
            old_state = json.loads(old["state"])
            # Preserve the real external-result record: rollback changes the local
            # comparison/selection, not the fact that a returned result was read.
            externally_applied = [change for change in state["changes"] if change["state"] == "applied"]
            old_applied = {change["id"] for change in old_state["changes"] if change["state"] == "applied"}
            if any(change["id"] not in old_applied for change in externally_applied):
                raise InvalidData("This revision predates an applied returned update. Reconcile with a fresh vendor export; local rollback cannot undo a vendor event")
            state.clear()
            state.update(old_state)
            return {"restored_revision": target_revision, "reason": reason.strip()}
        return self._change(project_id, expected_revision, actor, operation, "revision_restored", {"target_revision": target_revision, "reason": reason}, mutate)

    @staticmethod
    def _zip(contents):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, body in sorted(contents.items()):
                entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o600 << 16
                archive.writestr(entry, body)
        return output.getvalue()

    def export(self, project_id, release_id=None):
        project = self.project(project_id)
        if release_id:
            with self.connection() as db:
                release = db.execute("SELECT * FROM releases WHERE id=? AND project_id=?", (release_id, project_id)).fetchone()
            if not release:
                raise KeyError(release_id)
            if release["packet"] is not None:
                return release["packet"]
            project.update(state=json.loads(release["state"]), revision=release["revision"])
        state = project["state"]
        inspected = self.inspect(project)
        contents = {"workspace.json": (json.dumps(project, indent=2) + "\n").encode(),
                    "findings.json": (json.dumps(inspected["findings"], indent=2) + "\n").encode(),
                    "change-history.json": (json.dumps(state["changes"], indent=2) + "\n").encode(),
                    "requested-updates.json": (json.dumps({"schema": "municipal-workspace.exchange.v1", "mode": project["mode"],
                        "project_id": project_id, "revision": project["revision"],
                        "changes": [change for change in state["changes"] if change["state"] == "requested"]}, indent=2) + "\n").encode()}
        source_manifest = []
        for kind, input_id in state["inputs"].items():
            original = self.input(input_id, project_id)
            name = "originals/" + kind + "/" + original["filename"]
            contents[name] = original["body"]
            source_manifest.append({"path": name, "input_id": input_id, "sha256": original["sha256"], "rows": original["row_count"], "metadata": original["metadata"]})
        for kind, rows in inspected["datasets"].items():
            contents["mapped/" + kind + ".csv"] = csv_bytes(rows, KINDS[kind])
            if kind == "work_orders":
                reconciled = [self._work_order(state, row) for row in rows]
                contents["reconciled/work_orders.csv"] = csv_bytes(reconciled, [*KINDS[kind], "returned_reference"])
            repairs = [repair for repair in state["repairs"] if repair["kind"] == kind and repair["input_id"] == state["inputs"].get(kind)]
            if repairs:
                proposed = copy.deepcopy(rows)
                by_row = {row["_row"]: row for row in proposed}
                for repair in repairs:
                    by_row[repair["row"]][repair["field"]] = repair["after"]
                contents["proposed-repairs/" + kind + ".csv"] = csv_bytes(proposed, KINDS[kind])
        with self.connection() as db:
            history = [dict(row) for row in db.execute("SELECT revision,action,actor,detail,at FROM history WHERE project_id=? AND revision<=? ORDER BY revision", (project_id, project["revision"]))]
            run = db.execute("SELECT packet FROM native_runs WHERE id=? AND project_id=?", (state["native_run"], project_id)).fetchone()
        if run:
            contents["original-acceptance-packet.zip"] = run["packet"]
        from .report import report
        originals = [self.input(input_id, project_id) for input_id in state["inputs"].values()]
        contents["asset-handoff.html"] = report(project, inspected, originals)
        contents["source-manifest.json"] = (json.dumps(source_manifest, indent=2) + "\n").encode()
        contents["history.json"] = (json.dumps(history, indent=2) + "\n").encode()
        contents["README.txt"] = ("Municipal asset/work-order operator handoff\nMode: " + project["mode"] + "\n"
            "Original inputs remain under originals/. Mapped CSVs record the explicit saved transformations.\n"
            "Proposed repairs are separate and were not substituted into the original acceptance check.\n"
            "Requested updates use the local exchange contract; a vendor adapter supplies actual returned records.\n"
            "This download does not submit a City response, send an API update, or establish vendor/City acceptance.\n").encode()
        from .maximo_target import export_jobs
        from .maximo_load import export as export_maximo_loads
        contents.update(export_jobs(self, project_id))
        contents.update(export_maximo_loads(self, project_id))
        packet = self._zip(contents)
        if release_id:
            with self.connection(write=True) as db:
                db.execute("UPDATE releases SET packet=? WHERE id=? AND project_id=? AND packet IS NULL", (packet, release_id, project_id))
                packet = db.execute("SELECT packet FROM releases WHERE id=? AND project_id=?", (release_id, project_id)).fetchone()["packet"]
        return packet

    def report(self, project_id):
        from .report import report
        project = self.project(project_id)
        inspected = self.inspect(project)
        originals = [self.input(input_id, project_id) for input_id in project["state"]["inputs"].values()]
        return report(project, inspected, originals)

    def backup(self):
        with tempfile.TemporaryDirectory(prefix="snapshot-", dir=self.root) as temporary:
            path = Path(temporary) / "workspace.sqlite3"
            with self.connection() as source:
                destination = sqlite3.connect(path)
                try:
                    source.backup(destination)
                finally:
                    destination.close()
            body = path.read_bytes()
        manifest = {"schema": SCHEMA, "created_at": time.time(), "database_sha256": SHA(body), "bytes": len(body)}
        return self._zip({"workspace.sqlite3": body, "manifest.json": (json.dumps(manifest, indent=2) + "\n").encode()})


def restore_backup(source, destination):
    destination = Path(destination).resolve()
    if destination.exists():
        raise InvalidData("Restore into a new directory; the current workspace is preserved")
    with zipfile.ZipFile(source) as archive:
        if sorted(archive.namelist()) != ["manifest.json", "workspace.sqlite3"]:
            raise InvalidData("Expected one original workspace database and its manifest")
        if any(info.file_size > 2 * 1024**3 for info in archive.infolist()):
            raise InvalidData("Snapshot exceeds the 2 GiB restore limit")
        manifest = json.loads(archive.read("manifest.json"))
        body = archive.read("workspace.sqlite3")
    if manifest.get("schema") != SCHEMA or manifest.get("database_sha256") != SHA(body) or manifest.get("bytes") != len(body):
        raise InvalidData("Snapshot content does not match its original manifest")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="restore-", dir=destination.parent) as temporary:
        path = Path(temporary) / "workspace.sqlite3"
        path.write_bytes(body)
        os.chmod(path, 0o600)
        database = sqlite3.connect(path)
        try:
            if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or database.execute("SELECT value FROM settings WHERE key='schema'").fetchone()[0] != SCHEMA:
                raise InvalidData("Restored database is not a complete workspace")
        finally:
            database.close()
        destination.mkdir(mode=0o700)
        os.replace(path, destination / "workspace.sqlite3")
    return {"directory": str(destination), "sha256": SHA(body), "projects": len(Workspace(destination).projects())}
