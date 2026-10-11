"""Durable source versions, original-engine plans, named decisions and handoffs."""
from __future__ import annotations

import base64
import csv
import html
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import threading
import uuid
import zipfile
import zlib
from datetime import date, timedelta

from native import native_projection
from sources import (ROLES, ROLE_BY_KEY, WorkError, boolean, build_state, clean_text,
                     coverage, digest, fail, json_text, mapped_rows, now, parse_source,
                     raw_upload, settings_checked, validate_mapping)

SCHEMA = "shiftloom.retained-workspace.v1"
HERE = Path(__file__).resolve().parent
SOURCE_LINKS = [
    dict(label="Get Connected source and pagination contract", url="https://api.galaxydigital.com/docs/api.yml?v=1.9.2"),
    dict(label="Actual schedule export columns", url="https://learn.getconnectedvolunteer.com/en/articles/10179128-how-to-export-schedule-data"),
    dict(label="Responses and team reservations", url="https://learn.getconnectedvolunteer.com/en/articles/10179574-need-or-opportunity-responses-site-managers"),
    dict(label="Client integration responsibilities", url="https://learn.getconnectedvolunteer.com/en/articles/11779226-site-settings-api")
]


def encode_record(value):
    raw = json_text(value).encode("utf-8")
    if len(raw) >= 65536:
        compressed = zlib.compress(raw, 6)
        if len(compressed) < len(raw) * 0.8:
            return "zlib-json-v1:" + base64.b64encode(compressed).decode("ascii")
    return raw.decode("utf-8")


def decode_record(value):
    if value.startswith("zlib-json-v1:"):
        try:
            value = zlib.decompress(base64.b64decode(value[13:], validate=True)).decode("utf-8")
        except (ValueError, zlib.error, UnicodeDecodeError):
            fail("WORKSPACE_RECORD", "A retained workspace record is damaged. Restore its complete backup.", 409)
    return json.loads(value)


def copy(value):
    return json.loads(json_text(value))


def identifier(prefix):
    return prefix + "-" + uuid.uuid4().hex


def page(values, offset=0, limit=50):
    try:
        offset, limit = int(offset), int(limit)
    except (ValueError, TypeError):
        fail("PAGINATION", "Use integer offset and limit.")
    if offset < 0 or not 1 <= limit <= 200:
        fail("PAGINATION", "Offset must be nonnegative and limit must be between 1 and 200.")
    return dict(rows=values[offset:offset + limit], total=len(values), offset=offset, limit=limit)


def engine(operation, state, **kwargs):
    try:
        result = subprocess.run(["node", str(HERE / "engine_bridge.mjs")],
            input=json_text(dict(operation=operation, state=state, **kwargs)), text=True,
            capture_output=True, timeout=30, check=False)
        payload = json.loads(result.stdout)
    except FileNotFoundError:
        fail("ENGINE_RUNTIME", "Install Node 22.16 or later to run the original ShiftLoom planner.", 503)
    except (ValueError, subprocess.TimeoutExpired):
        fail("ENGINE_RUNTIME", "The original planner did not return a complete result.", 503)
    if not payload.get("ok"):
        fail("ENGINE_REJECTED", payload.get("error", "The original planner rejected this state."), 409)
    return payload["result"]


class Workspace:
    def __init__(self, filename):
        self.path = Path(filename).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA busy_timeout=10000")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA temp_store=MEMORY")
        tables = {row[0] for row in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if tables and not {"meta", "records", "sources"}.issubset(tables):
            self.db.close()
            fail("WORKSPACE_FORMAT", "That SQLite file belongs to a different application. Choose a new file or a ShiftLoom backup.", 409)
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL, id TEXT NOT NULL,
            created_at TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id));
          CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, raw BLOB NOT NULL);
          CREATE INDEX IF NOT EXISTS record_kind_created ON records(kind,created_at);
        """)
        existing = self.db.execute("SELECT value FROM meta WHERE key='workspace'").fetchone()
        if existing:
            state = json.loads(existing[0])
            if state.get("schema") != SCHEMA:
                fail("WORKSPACE_FORMAT", "This workspace needs its matching application version.", 409)
        else:
            today = date.today()
            state = dict(schema=SCHEMA, revision=0, created_at=now(), active_board_id=None, selection={},
                settings=dict(organization="", label="Volunteer coverage", timezone="UTC",
                    week_start=(today - timedelta(days=today.weekday())).isoformat(),
                    source_observed_at=now(), expiry_date_inclusive=True, cohort_complete=False, notes=""))
            self._save_meta(state)
        os.chmod(self.path, 0o600)

    def close(self):
        with self.lock:
            self.db.close()

    def _meta(self):
        return json.loads(self.db.execute("SELECT value FROM meta WHERE key='workspace'").fetchone()[0])

    def _save_meta(self, value):
        self.db.execute("INSERT OR REPLACE INTO meta VALUES ('workspace',?)", (json_text(value),))

    def _put(self, kind, value):
        self.db.execute("INSERT OR REPLACE INTO records VALUES (?,?,?,?)",
            (kind, value["id"], value["created_at"], encode_record(value)))

    def _get(self, kind, ident):
        row = self.db.execute("SELECT payload FROM records WHERE kind=? AND id=?", (kind, ident)).fetchone()
        if not row:
            fail("NOT_FOUND", f"The requested {kind} is not in this workspace.", 404)
        return decode_record(row[0])

    def _all(self, kind):
        return [decode_record(row[0]) for row in self.db.execute(
            "SELECT payload FROM records WHERE kind=? ORDER BY created_at,id", (kind,))]

    def _raw(self, ident):
        row = self.db.execute("SELECT raw FROM sources WHERE id=?", (ident,)).fetchone()
        if not row:
            fail("NOT_FOUND", "The retained source bytes are missing.", 404)
        return bytes(row[0])

    def _write(self, body, callback):
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                meta = self._meta()
                expected = body.get("expected_revision")
                if isinstance(expected, bool) or not isinstance(expected, int) or expected != meta["revision"]:
                    fail("STALE_WORKSPACE", "The workspace changed. Refresh it and review the current version.", 409,
                         current_revision=meta["revision"])
                result = callback(meta)
                meta["revision"] += 1
                meta["updated_at"] = now()
                self._save_meta(meta)
                self.db.execute("COMMIT")
                return dict(revision=meta["revision"], **result)
            except Exception as exc:
                if self.db.in_transaction:
                    self.db.execute("ROLLBACK")
                if isinstance(exc, sqlite3.Error) and getattr(exc, "sqlite_errorcode", None) == sqlite3.SQLITE_FULL:
                    fail("WORKSPACE_STORAGE", "Free space on the workspace drive, reload the current revision and retry this operation.", 507,
                         current_revision=self._meta()["revision"])
                raise

    @staticmethod
    def dataset_summary(value):
        config = value["config"]
        return {**{key: value.get(key) for key in ("id", "role", "name", "format", "sha256", "byte_count",
                "row_count", "headers", "confirmed", "created_at", "source_url", "config_revision", "native_source_id")},
            **{key: config.get(key, {}) for key in ("mapping", "constants", "value_maps")},
            "datetime_format": config.get("datetime_format", ""),
            "override_count": len(config.get("overrides", {})),
            "mapping_history": config.get("history", [])[-20:],
            "native_metadata": value.get("native_metadata")}

    def board_summary(self, value):
        return dict(id=value["id"], label=value["label"], parent_board_id=value.get("parent_board_id"),
            created_at=value["created_at"], revision=value["current_state"]["revision"],
            valid=not any(x["severity"] == "error" for x in value["issues"]),
            issue_count=len(value["issues"]) + len(value.get("current_findings", [])), counts=value["counts"],
            coverage_gap=sum(row["gap"] for row in coverage(value["current_state"]) if row["target"]),
            plan_count=len(self._for_board("plan", value["id"])),
            decision_count=len(self._for_board("decision", value["id"])))

    @staticmethod
    def plan_summary(value):
        return {key: value.get(key) for key in ("id", "board_id", "board_revision", "label", "status",
            "created_at", "intent", "prior_plan_id", "review")}

    @staticmethod
    def decision_summary(value):
        return {key: item for key, item in value.items() if key not in ("before_state", "after_state")}

    def _for_board(self, kind, ident):
        return [value for value in self._all(kind) if value["board_id"] == ident]

    def state(self):
        with self.lock:
            meta = self._meta()
            return dict(revision=meta["revision"], settings=meta["settings"], roles=ROLES,
                datasets=[self.dataset_summary(v) for v in reversed(self._all("dataset"))],
                selection=meta["selection"],
                boards=[self.board_summary(v) for v in reversed(self._all("board"))],
                active_board_id=meta["active_board_id"], source_links=SOURCE_LINKS)

    def settings(self, body):
        def action(meta):
            if not isinstance(body.get("settings"), dict):
                fail("SETTINGS", "Supply the named workspace settings.")
            meta["settings"] = settings_checked(body["settings"])
            return dict(settings=meta["settings"])
        return self._write(body, action)

    def _new_dataset(self, role, name, fmt, raw, headers, rows, config=None, **extra):
        value = dict(id=identifier("source"), role=role, name=name, format=fmt, sha256=digest(raw),
            byte_count=len(raw), row_count=len(rows), headers=headers, rows=rows, confirmed=False,
            created_at=now(), config_revision=0, source_url="",
            config=config or dict(mapping={}, constants={}, value_maps={}, datetime_format="", overrides={}, history=[]),
            **extra)
        self._put("dataset", value)
        self.db.execute("INSERT INTO sources VALUES (?,?)", (value["id"], raw))
        return value

    def upload(self, body):
        def action(meta):
            role = body.get("role")
            if role not in ROLE_BY_KEY:
                fail("SOURCE_ROLE", "Choose one of the five source roles.")
            name = clean_text(body.get("name", ""), "source filename", 240)
            source_url = clean_text(body.get("source_url", ""), "source URL or report name", 2000, False)
            raw, _ = raw_upload(body)
            fmt = body.get("format")
            root_path = clean_text(body.get("root_path", ""), "JSON array path", 500, False)
            headers, rows = parse_source(raw, fmt, root_path)
            dataset = self._new_dataset(role, name, fmt, raw, headers, rows)
            dataset.update(source_url=source_url, root_path=root_path)
            self._put("dataset", dataset)
            return dict(dataset_id=dataset["id"], dataset=self.dataset_summary(dataset), preview=rows[:10])
        return self._write(body, action)

    def native_snapshot(self, body):
        def action(meta):
            name = clean_text(body.get("name", ""), "native capture filename", 240)
            raw, _ = raw_upload(body)
            projected = native_projection(raw)
            native = dict(id=identifier("native"), name=name, created_at=now(), sha256=digest(raw),
                byte_count=len(raw), metadata=projected["metadata"])
            self._put("native", native)
            self.db.execute("INSERT INTO sources VALUES (?,?)", (native["id"], raw))
            datasets = []
            for role, projection in projected["projections"].items():
                ds = self._new_dataset(role, f"{name} — {role}.json", "json", projection["raw"],
                    projection["headers"], projection["rows"], config=projection["config"],
                    native_source_id=native["id"], native_metadata=projected["metadata"])
                datasets.append(self.dataset_summary(ds))
            return dict(native_source_id=native["id"], dataset_ids=[v["id"] for v in datasets],
                        datasets=datasets, metadata=projected["metadata"])
        return self._write(body, action)

    def dataset(self, ident, offset=0, limit=50):
        with self.lock:
            dataset = self._get("dataset", ident)
            rows, errors = mapped_rows(dataset)
            return dict(dataset=self.dataset_summary(dataset), **page(rows, offset, limit),
                        errors=errors[:500], error_count=len(errors))

    def source_raw(self, ident):
        with self.lock:
            try:
                source = self._get("dataset", ident)
            except WorkError as exc:
                if exc.status != 404:
                    raise
                source = self._get("native", ident)
            return self._raw(ident), source["name"]

    def mapping(self, ident, body):
        def action(meta):
            dataset = self._get("dataset", ident)
            config = validate_mapping(dataset, body)
            config["overrides"] = dataset["config"].get("overrides", {})
            config["history"] = dataset["config"].get("history", []) + [
                dict(action="mapping", at=now(), config_revision=dataset["config_revision"] + 1,
                     mapping=config["mapping"], constants=config["constants"], value_maps=config["value_maps"],
                     datetime_format=config["datetime_format"])]
            dataset.update(config=config, confirmed=True, config_revision=dataset["config_revision"] + 1)
            self._put("dataset", dataset)
            meta["selection"][dataset["role"]] = ident
            return dict(dataset_id=ident, dataset=self.dataset_summary(dataset))
        return self._write(body, action)

    def overrides(self, ident, body):
        def action(meta):
            dataset = self._get("dataset", ident)
            actor = clean_text(body.get("actor", ""), "coordinator name", 200)
            note = clean_text(body.get("note", ""), "correction explanation", 4000)
            changes = body.get("rows")
            if not isinstance(changes, list) or not 1 <= len(changes) <= 10000:
                fail("OVERRIDES", "Choose between 1 and 10,000 source rows for the explicit correction.")
            valid = {f["key"] for f in ROLE_BY_KEY[dataset["role"]]["fields"]}
            old = copy(dataset["config"].get("overrides", {}))
            affected = []
            seen = set()
            for change in changes:
                if not isinstance(change, dict):
                    fail("OVERRIDES", "Every correction needs a source row index and canonical fields.")
                index, fields = change.get("row_index"), change.get("fields")
                if isinstance(index, bool) or not isinstance(index, int) or not 1 <= index <= dataset["row_count"] or index in seen:
                    fail("OVERRIDES", "Choose distinct existing one-based source row indexes.")
                if not isinstance(fields, dict) or not fields or set(fields) - valid:
                    fail("OVERRIDES", "Choose explicit canonical fields for each corrected row.")
                for key, value in fields.items():
                    if isinstance(value, (dict, list)) or len(str(value)) > 4000:
                        fail("OVERRIDES", "Coordinator values must be scalars; separate qualification IDs with |.")
                seen.add(index)
                before = copy(old.get(str(index), {}))
                old.setdefault(str(index), {}).update(fields)
                affected.append(dict(row_index=index, before=before, after=copy(old[str(index)]), fields=fields))
            dataset["config"]["overrides"] = old
            dataset["config"].setdefault("history", []).append(dict(action="override", actor=actor, note=note, at=now(), rows=affected))
            dataset["config_revision"] += 1
            self._put("dataset", dataset)
            return dict(dataset_id=ident, updated_rows=len(affected), dataset=self.dataset_summary(dataset))
        return self._write(body, action)

    def select_dataset(self, body):
        def action(meta):
            ds = self._get("dataset", body.get("dataset_id"))
            if not ds["confirmed"]:
                fail("SOURCE_UNCONFIRMED", "Confirm this source's mapping before selecting it.")
            meta["selection"][ds["role"]] = ds["id"]
            return dict(dataset_id=ds["id"])
        return self._write(body, action)

    def _selected(self, meta):
        selected = {}
        for role, ident in meta["selection"].items():
            dataset = self._get("dataset", ident)
            if dataset["role"] != role or not dataset["confirmed"]:
                fail("SOURCE_SELECTION", "The selected source does not have a confirmed mapping for its role.")
            selected[role] = dataset
        return selected

    @staticmethod
    def _fingerprint(settings, selected):
        identity = dict(settings=settings, selection={role: dict(id=ds["id"], sha256=ds["sha256"],
            config_revision=ds["config_revision"]) for role, ds in sorted(selected.items())})
        return digest(json_text(identity).encode("utf-8"))

    def _matches(self, board, meta=None):
        meta = meta or self._meta()
        return self._fingerprint(meta["settings"], self._selected(meta)) == board["source_fingerprint"]

    @staticmethod
    def _continuity(parent, current_state, inventory):
        if not parent:
            return dict(parent_board_id=None, source_changes=[], volunteer_changes=[], shift_changes=[],
                        prior_plan_ids=[])
        previous = parent["current_state"]
        source_changes = []
        before_inventory = {s["role"]: s for s in parent["source_inventory"]}
        for source in inventory:
            before = before_inventory.get(source["role"])
            if not before or (before["id"], before["config_revision"], before["sha256"]) != (source["id"], source["config_revision"], source["sha256"]):
                source_changes.append(dict(role=source["role"], before=before, after=source))
        def relevant(row, kind):
            if kind == "shift":
                return {k: row.get(k) for k in ("label", "start", "end", "capacity", "reservedSlots", "required", "assigned", "target")}
            value = {k: row.get(k) for k in ("name", "active", "weeklyLimit", "available", "eligibility", "preferred")}
            value["qualifications"] = [{k: q.get(k) for k in ("id", "status", "from", "until", "originalExpiry")}
                                       for q in row.get("qualificationWindows", [])]
            return value
        def difference(key, kind):
            old, new = ({r["id"]: relevant(r, kind) for r in state[key]} for state in (previous, current_state))
            return [dict(id=ident, change="added" if ident not in old else "removed" if ident not in new else "changed",
                         before=old.get(ident), after=new.get(ident))
                    for ident in sorted(set(old) | set(new)) if old.get(ident) != new.get(ident)]
        return dict(parent_board_id=parent["id"], source_changes=source_changes,
            volunteer_changes=difference("volunteers", "volunteer"), shift_changes=difference("shifts", "shift"))

    def create_board(self, body):
        def action(meta):
            selected = self._selected(meta)
            settings = settings_checked(meta["settings"])
            result = build_state(selected, settings)
            parent_id = body.get("parent_board_id") or None
            parent = self._get("board", parent_id) if parent_id else None
            inventory = [dict(**self.dataset_summary(ds)) for role, ds in sorted(selected.items())]
            board = dict(id=identifier("board"), label=clean_text(body.get("label", settings["label"]), "board label", 200),
                parent_board_id=parent_id, created_at=now(), settings=copy(settings),
                source_fingerprint=self._fingerprint(settings, selected), source_inventory=inventory,
                frozen_sources={role: {k: copy(ds[k]) for k in ("id", "name", "sha256", "role", "headers", "config", "config_revision")}
                                for role, ds in selected.items()},
                initial_state=copy(result["state"]), current_state=result["state"],
                normalized=result["normalized"], issues=result["issues"], counts=result["counts"])
            board["current_findings"] = engine("inspect", board["current_state"]) if not any(x["severity"] == "error" for x in board["issues"]) else []
            board["continuity"] = self._continuity(parent, board["current_state"], inventory)
            if parent:
                board["continuity"]["prior_plan_ids"] = [v["id"] for v in self._for_board("plan", parent_id)]
                board["continuity"]["prior_decisions"] = [self.decision_summary(v) for v in self._for_board("decision", parent_id)]
            self._put("board", board)
            meta["active_board_id"] = board["id"]
            return dict(board_id=board["id"], board=self.board_summary(board))
        return self._write(body, action)

    def select_board(self, body):
        def action(meta):
            board = self._get("board", body.get("board_id"))
            meta["active_board_id"] = board["id"]
            return dict(board_id=board["id"])
        return self._write(body, action)

    def _undoable(self, board):
        approvals = [d for d in self._for_board("decision", board["id"])
                     if d["action"] == "APPROVE" and not d.get("reversed_by")]
        return approvals[-1]["id"] if approvals else None

    def board(self, ident):
        with self.lock:
            board = self._get("board", ident)
            findings = [{**finding, "severity": "warning"} for finding in board.get("current_findings", [])]
            return dict(board=self.board_summary(board), state=board["current_state"], coverage=coverage(board["current_state"]),
                issues=board["issues"] + findings,
                plans=[self.plan_summary(p) for p in reversed(self._for_board("plan", ident))],
                decisions=[self.decision_summary(v) for v in reversed(self._for_board("decision", ident))],
                source_inventory=board["source_inventory"], continuity=board["continuity"],
                source_matches_current=self._matches(board), latest_undoable_decision_id=self._undoable(board))

    def roster(self, ident, offset=0, limit=50, query=""):
        with self.lock:
            board = self._get("board", ident)
            state = board["current_state"]
            query = str(query).casefold()
            rows = []
            for volunteer in state["volunteers"]:
                if query and query not in (volunteer["id"] + " " + volunteer["name"]).casefold():
                    continue
                rows.append({**volunteer, "volunteer_id": volunteer["id"],
                    "assignments": [dict(shift_id=s["id"], label=s["label"], start=s["start"], end=s["end"],
                                        countsTowardLimit=s.get("countsTowardLimit", True))
                                    for s in state["shifts"] if volunteer["id"] in s["assigned"]],
                    "availability": [r for r in board["normalized"]["availability"]
                                     if str(r["canonical"]["volunteer_id"]) == volunteer["id"]]})
            return page(rows, offset, limit)

    def create_plan(self, ident, body):
        def action(meta):
            board = self._get("board", ident)
            if any(x["severity"] == "error" for x in board["issues"]):
                fail("SOURCE_FINDINGS", "Correct the blocking source findings and build a new board before planning.")
            sid = clean_text(body.get("shift_id", ""), "target shift ID", 160)
            shift = next((s for s in board["current_state"]["shifts"] if s["id"] == sid), None)
            if not shift or not shift.get("target", True):
                fail("TARGET_SHIFT", "Choose an actual target shift in this board's planning period.")
            intent = dict(shiftId=sid, absentVolunteerId=body.get("absent_volunteer_id") or None,
                          excludedVolunteerId=body.get("excluded_volunteer_id") or None)
            for key in ("absentVolunteerId", "excludedVolunteerId"):
                if intent[key] is not None:
                    intent[key] = clean_text(intent[key], "volunteer ID", 160)
            prior_id = body.get("prior_plan_id") or None
            if prior_id:
                prior = self._get("plan", prior_id)
                if prior["intent"]["shiftId"] != sid:
                    fail("PRIOR_PLAN", "A corrected continuation must refer to the same exact shift ID.")
                permitted = {board["id"]}
                ancestor = board.get("parent_board_id")
                while ancestor:
                    permitted.add(ancestor)
                    ancestor = self._get("board", ancestor).get("parent_board_id")
                if prior["board_id"] not in permitted:
                    fail("PRIOR_PLAN", "Link a plan from this board or its actual parent lineage.")
            proposal = engine("plan", board["current_state"], intent=intent)
            plan = dict(id=identifier("plan"), board_id=ident, board_revision=board["current_state"]["revision"],
                label=clean_text(body.get("label") or shift["label"], "plan label", 200), created_at=now(),
                intent=intent, proposal=proposal, state_snapshot=copy(board["current_state"]),
                status="DRAFT" if proposal.get("ok") else "INFEASIBLE",
                prior_plan_id=prior_id, review=None)
            self._put("plan", plan)
            return dict(plan_id=plan["id"], plan=self.plan_summary(plan))
        return self._write(body, action)

    def plan(self, ident):
        with self.lock:
            plan = self._get("plan", ident)
            board = self._get("board", plan["board_id"])
            state = plan["state_snapshot"]
            volunteers = {v["id"]: v for v in state["volunteers"]}
            target = next(s for s in state["shifts"] if s["id"] == plan["intent"]["shiftId"])
            source_index = {(r["source_ref"]["dataset_id"], r["row_index"]): r
                            for rows in board["normalized"].values() for r in rows}
            candidates = []
            for original in plan["proposal"].get("candidateReview", []):
                vid = original["id"]
                volunteer = volunteers.get(vid, {})
                refs = []
                for ref in volunteer.get("source_refs", []):
                    row = source_index.get((ref["dataset_id"], ref["row_index"]))
                    if not row:
                        continue
                    if ref["role"] == "availability" and str(row["canonical"]["shift_id"]) != target["id"]:
                        continue
                    if ref["role"] == "qualifications" and str(row["canonical"]["qualification_id"]) not in target["required"]:
                        continue
                    refs.append(ref)
                source_rows = [source_index[(ref["dataset_id"], ref["row_index"])] for ref in refs
                               if (ref["dataset_id"], ref["row_index"]) in source_index]
                candidates.append({**original, "volunteer_id": vid, "source_refs": refs, "source_rows": source_rows,
                    "qualifications": volunteer.get("qualificationWindows", []),
                    "availability": [r for r in board["normalized"].get("availability", [])
                        if str(r["canonical"]["volunteer_id"]) == vid and str(r["canonical"]["shift_id"]) == plan["intent"]["shiftId"]],
                    "assignments": [dict(shift_id=s["id"], label=s["label"], start=s["start"], end=s["end"],
                                        countsTowardLimit=s.get("countsTowardLimit", True), source_refs=s["source_refs"])
                                    for s in state["shifts"] if vid in s["assigned"]]})
            prior = self._get("plan", plan["prior_plan_id"]) if plan.get("prior_plan_id") else None
            return dict(plan=self.plan_summary(plan), proposal=plan["proposal"], candidates=candidates,
                prior_review=dict(plan=self.plan_summary(prior), proposal=prior["proposal"]) if prior else None,
                source_inventory=board["source_inventory"], source_matches_current=self._matches(board),
                board_revision=board["current_state"]["revision"])

    def review(self, ident, body):
        def action(meta):
            plan = self._get("plan", ident)
            board = self._get("board", plan["board_id"])
            action = body.get("decision")
            if action not in ("APPROVE", "REJECT"):
                fail("REVIEW_DECISION", "Choose approve or reject.")
            if plan["status"] not in ("DRAFT", "INFEASIBLE"):
                fail("PLAN_REVIEWED", "This exact proposal already has a retained review. Create a fresh plan.", 409)
            actor = clean_text(body.get("actor", ""), "reviewer name", 200)
            note = clean_text(body.get("note", ""), "review explanation", 4000)
            before = copy(board["current_state"])
            after = before
            if action == "APPROVE":
                if not boolean(body.get("confirmed_current_source"), "current source review"):
                    fail("CURRENT_SOURCE", "Confirm that these are the current source inputs before approving.")
                if not self._matches(board, meta):
                    fail("SOURCE_CHANGED", "The selected inputs or coordinator settings changed. Build a corrected board, or explicitly select this board's original inputs.", 409)
                if board["current_state"]["revision"] != plan["board_revision"]:
                    fail("STALE_PLAN", "The roster changed after this proposal. Plan again against its current revision.", 409)
                if not plan["proposal"].get("ok"):
                    fail("INCOMPLETE_COVERAGE", "This proposal does not fill the exact shift under its current constraints.")
                after = engine("apply", before, proposal=plan["proposal"])
                residual = [r for r in engine("inspect", after) if r["shiftId"] == plan["intent"]["shiftId"]]
                if residual:
                    fail("ROSTER_CONSTRAINT", "The original engine found a remaining constraint violation for the revised shift.", 409)
                board["current_state"] = after
                board["current_findings"] = engine("inspect", after)
                self._put("board", board)
            decision = dict(id=identifier("decision"), board_id=board["id"], plan_id=ident, action=action,
                actor=actor, note=note, created_at=now(), board_revision_before=before["revision"],
                board_revision_after=after["revision"], before_state=before, after_state=after,
                source_fingerprint=board["source_fingerprint"])
            self._put("decision", decision)
            plan["status"] = "APPROVED" if action == "APPROVE" else "REJECTED"
            plan["review"] = {k: v for k, v in decision.items() if k not in ("before_state", "after_state")}
            self._put("plan", plan)
            return dict(plan_id=ident, decision_id=decision["id"], board_id=board["id"], status=plan["status"])
        return self._write(body, action)

    def undo(self, ident, body):
        def action(meta):
            board = self._get("board", ident)
            selected = body.get("decision_id")
            if selected != self._undoable(board):
                fail("UNDO_ORDER", "Only this board's most recent remaining approval can be reversed.", 409)
            decision = self._get("decision", selected)
            if decision["board_id"] != ident:
                fail("UNDO_BOARD", "The decision belongs to another board.", 409)
            actor = clean_text(body.get("actor", ""), "coordinator name", 200)
            note = clean_text(body.get("note", ""), "reversal explanation", 4000)
            current = board["current_state"]
            comparable = lambda s: {k: v for k, v in s.items() if k != "revision"}
            if comparable(current) != comparable(decision["after_state"]):
                fail("UNDO_STATE", "The exact approved roster has changed. Review the latest decision before reversing.", 409)
            restored = copy(decision["before_state"])
            restored["revision"] = current["revision"] + 1
            undo = dict(id=identifier("decision"), board_id=ident, plan_id=decision["plan_id"], action="UNDO",
                actor=actor, note=note, created_at=now(), reverses_decision_id=selected,
                board_revision_before=current["revision"], board_revision_after=restored["revision"],
                before_state=current, after_state=restored, source_fingerprint=board["source_fingerprint"])
            self._put("decision", undo)
            decision["reversed_by"] = undo["id"]
            self._put("decision", decision)
            board["current_state"] = restored
            board["current_findings"] = engine("inspect", restored)
            self._put("board", board)
            plan = self._get("plan", decision["plan_id"])
            plan["status"] = "UNDONE"
            plan["review"]["reversed_by"] = undo["id"]
            self._put("plan", plan)
            return dict(board_id=ident, decision_id=undo["id"], status="UNDONE")
        return self._write(body, action)

    def backup(self):
        with self.lock:
            fd, filename = tempfile.mkstemp(prefix="shiftloom-backup-", suffix=".sqlite")
            os.close(fd)
            try:
                target = sqlite3.connect(filename)
                try:
                    self.db.backup(target)
                finally:
                    target.close()
                return Path(filename).read_bytes()
            finally:
                Path(filename).unlink(missing_ok=True)

    def handoff(self, ident):
        with self.lock:
            board = self._get("board", ident)
            plans = self._for_board("plan", ident)
            decisions = self._for_board("decision", ident)
            files = {}
            def add_json(name, value):
                files[name] = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
            add_json("board.json", {k: v for k, v in board.items() if k != "normalized"})
            add_json("normalized-source-rows.json", board["normalized"])
            add_json("settings.json", board["settings"])
            add_json("frozen-mappings.json", board["frozen_sources"])
            add_json("original-state.json", board["initial_state"])
            add_json("current-state.json", board["current_state"])
            add_json("plans.json", plans)
            add_json("decisions.json", decisions)
            native_ids = set()
            for source in board["source_inventory"]:
                extension = ".csv" if source["format"] == "csv" else ".json"
                files["originals/" + source["role"] + "-" + source["id"] + extension] = self._raw(source["id"])
                if source.get("native_source_id"):
                    native_ids.add(source["native_source_id"])
            for nid in sorted(native_ids):
                native = self._get("native", nid)
                files["originals/" + nid + ".json"] = self._raw(nid)
                add_json("originals/" + nid + ".metadata.json", {k: v for k, v in native.items()})
            ancestors = []
            parent_id = board.get("parent_board_id")
            while parent_id:
                parent = self._get("board", parent_id)
                folder = "lineage/" + parent_id + "/"
                ancestors.append(dict(board_id=parent_id, label=parent["label"], directory=folder))
                add_json(folder + "board.json", {k: v for k, v in parent.items() if k != "normalized"})
                add_json(folder + "normalized-source-rows.json", parent["normalized"])
                add_json(folder + "plans.json", self._for_board("plan", parent_id))
                add_json(folder + "decisions.json", self._for_board("decision", parent_id))
                for source in parent["source_inventory"]:
                    extension = ".csv" if source["format"] == "csv" else ".json"
                    files["originals/" + source["role"] + "-" + source["id"] + extension] = self._raw(source["id"])
                    nid = source.get("native_source_id")
                    if nid and nid not in native_ids:
                        native_ids.add(nid)
                        files["originals/" + nid + ".json"] = self._raw(nid)
                        add_json("originals/" + nid + ".metadata.json", self._get("native", nid))
                parent_id = parent.get("parent_board_id")
            add_json("lineage/index.json", ancestors)
            stream = io.StringIO(newline="")
            writer = csv.writer(stream, lineterminator="\r\n")
            writer.writerow(["shift_id", "label", "start", "end", "capacity", "additional_reserved_places", "volunteer_id", "volunteer_name", "planning_week"])
            names = {v["id"]: v["name"] for v in board["current_state"]["volunteers"]}
            for shift in board["current_state"]["shifts"]:
                for vid in shift["assigned"] or [""]:
                    writer.writerow([shift["id"], shift["label"], shift["start"], shift["end"], shift["capacity"],
                                     shift["reservedSlots"], vid, names.get(vid, ""), shift["countsTowardLimit"]])
            files["roster.csv"] = stream.getvalue().encode("utf-8")
            stream = io.StringIO(newline="")
            writer = csv.writer(stream, lineterminator="\r\n")
            writer.writerow(["decision_id", "action", "actor", "reviewed_at", "shift_id", "change", "volunteer_id", "name", "reverses_decision_id"])
            for decision in decisions:
                if decision["action"] == "REJECT":
                    continue
                before = {s["id"]: set(s["assigned"]) for s in decision["before_state"]["shifts"]}
                for shift in decision["after_state"]["shifts"]:
                    old, new = before[shift["id"]], set(shift["assigned"])
                    for action, members in (("remove", old - new), ("add", new - old)):
                        for vid in sorted(members):
                            writer.writerow([decision["id"], decision["action"], decision["actor"], decision["created_at"],
                                             shift["id"], action, vid, names.get(vid, ""), decision.get("reverses_decision_id", "")])
            files["reviewed-changes.csv"] = stream.getvalue().encode("utf-8")
            view = dict(board=self.board_summary(board), coverage=coverage(board["current_state"]),
                        issues=board["issues"] + board.get("current_findings", []),
                        plans=[self.plan_summary(p) for p in plans], decisions=[
                            {k: v for k, v in d.items() if k not in ("before_state", "after_state")} for d in decisions],
                        source_inventory=board["source_inventory"])
            files["review.html"] = ("""<!doctype html><meta charset="utf-8"><title>ShiftLoom coverage handoff</title>
<style>body{font:15px system-ui;max-width:1100px;margin:32px auto;padding:0 20px;color:#202020}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f2f2;padding:20px}h1{font-size:26px}</style>
<h1>Retained coverage handoff</h1><p>Named roster decisions, exact original sources and remaining coverage are preserved below. The operator applies approved changes through the organization's normal volunteer system.</p><pre>"""
                + html.escape(json.dumps(view, ensure_ascii=False, indent=2)) + "</pre>").encode("utf-8")
            files["START_HERE.md"] = (
                "# ShiftLoom retained coverage handoff\n\n"
                "Open review.html for the selected board and named decisions. Inspect roster.csv and reviewed-changes.csv before entering approved changes in the original volunteer system.\n\n"
                "Original source files are byte-for-byte in originals/. Their frozen mappings, coordinator settings, normalized rows, proposals and full before/after decisions are retained alongside them. Native captures include the original nested need/shift and per-user qualification records.\n\n"
                "The original planner fills one explicitly selected shift, requires complete target coverage, and ranks eligible candidates by existing workload and preference. Other shifts and remaining gaps remain visible in the review. Team reserved places are counted separately from named volunteers.\n\n"
                "To continue all retained boards and source versions, also download the workspace backup from the application and reopen it with:\n\n"
                "    python3 app.py --db /absolute/private/path/coverage.sqlite --port 8802\n\n"
                "The handoff is a review/export package; the separate complete SQLite backup reopens the interactive workspace.\n"
            ).encode("utf-8")
            manifest = dict(schema="shiftloom.coverage-handoff.v1", board_id=ident, created_at=now(),
                source_fingerprint=board["source_fingerprint"], source_inventory=board["source_inventory"],
                files=[dict(path=name, byte_count=len(raw), sha256=digest(raw)) for name, raw in sorted(files.items())])
            add_json("manifest.json", manifest)
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for name, raw in sorted(files.items()):
                    archive.writestr(name, raw)
            return output.getvalue(), f"ShiftLoom-{ident}-handoff.zip"

