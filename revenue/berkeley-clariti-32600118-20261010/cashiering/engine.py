"""Additive daily cashiering lifecycle using the original permitting Workspace database."""
from __future__ import annotations

import base64
import copy
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import sqlite3
import uuid
import zlib

from . import model as m
from .reporting import render_report, build_packet
from .receiving import Receiving, SOURCE_FILES as RECEIVING_SOURCE_FILES

ROOT = Path(__file__).resolve().parent
MAX_FILE = 25 * 1024 * 1024


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(prefix):
    return prefix + "-" + uuid.uuid4().hex


def json_value(value):
    return json.loads(value)


def page(rows, query):
    offset = max(0, int(query.get("offset", 0)))
    limit = min(500, max(1, int(query.get("limit", 100))))
    needle = str(query.get("query", "")).casefold()
    result = []
    for row in rows:
        if needle and needle not in m.canonical(row).casefold():
            continue
        if query.get("kind") and row.get("kind") != query["kind"]:
            continue
        if query.get("code") and row.get("code") != query["code"]:
            continue
        if query.get("status") and row.get("status", row.get("review", {}).get("status")) != query["status"]:
            continue
        result.append(row)
    return {"total": len(result), "offset": offset, "limit": limit, "rows": result[offset:offset + limit]}


class Cashiering:
    def __init__(self, workspace, conflict):
        self.workspace = workspace
        self.conflict = conflict
        self.receiving = Receiving(self)
        self.source_files = {}
        # Retain the complete existing application and additive operator, including
        # both browser surfaces and the original native comparator bridge.
        component_paths = (
            "cashiering/__init__.py", "cashiering/model.py", "cashiering/engine.py",
            "cashiering/reporting.py", "cashiering/API.md", "cashiering/SOURCE_CONTRACT.md",
            "cashiering/requirements-catalog.json", "cashiering/source-manifest.json",
            "cashiering/WORKFLOW.md", "cashiering/public/index.html",
            "cashiering/public/app.mjs", "cashiering/public/style.css",
            "workspace/app.py", "workspace/intake.py", "workspace/scenarios.py",
            "workspace/API.md", "workspace/audit-bridge.mjs",
            "workspace/public/index.html", "workspace/public/app.mjs",
            "workspace/public/style.css", "audit.mjs",
        ) + RECEIVING_SOURCE_FILES
        for relative_path in component_paths:
            path = ROOT.parent / relative_path
            if path.is_file():
                self.source_files[relative_path] = path.read_bytes()
        catalog = ROOT / "requirements-catalog.json"
        self.source_catalog = json.loads(catalog.read_text()) if catalog.is_file() else {}
        with workspace.lock, workspace.db() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS cash_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS cash_captures(
                  id TEXT PRIMARY KEY,kind TEXT NOT NULL,filename TEXT NOT NULL,raw BLOB NOT NULL,
                  sha256 TEXT NOT NULL,created_at TEXT NOT NULL,captured_at TEXT NOT NULL,
                  coverage TEXT NOT NULL,parsed TEXT NOT NULL,selected INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS cash_mappings(
                  capture_id TEXT NOT NULL REFERENCES cash_captures(id),version INTEGER NOT NULL,
                  mapping TEXT NOT NULL,confirmed INTEGER NOT NULL,issues TEXT NOT NULL,created_at TEXT NOT NULL,
                  PRIMARY KEY(capture_id,version));
                CREATE TABLE IF NOT EXISTS cash_runs(
                  id TEXT PRIMARY KEY,body TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS cash_editions(
                  id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES cash_runs(id),edit_revision INTEGER NOT NULL,
                  snapshot_hash TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,action TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS cash_events(
                  seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT,action TEXT NOT NULL,actor TEXT NOT NULL,
                  created_at TEXT NOT NULL,details TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS cash_profiles(
                  id TEXT NOT NULL,version INTEGER NOT NULL,value TEXT NOT NULL,created_at TEXT NOT NULL,
                  PRIMARY KEY(id,version));
                CREATE TABLE IF NOT EXISTS cash_artifacts(
                  id TEXT PRIMARY KEY,kind TEXT NOT NULL,filename TEXT NOT NULL,raw BLOB NOT NULL,
                  sha256 TEXT NOT NULL,metadata TEXT NOT NULL,created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS cash_requests(
                  id TEXT PRIMARY KEY,request_sha TEXT NOT NULL,response BLOB NOT NULL,created_at TEXT NOT NULL);
            """)
            conn.execute("INSERT OR IGNORE INTO cash_meta VALUES('settings',?)", (m.canonical(m.DEFAULT_SETTINGS),))
            self.receiving.initialize(conn)

    def _settings(self, conn):
        return json.loads(conn.execute("SELECT value FROM cash_meta WHERE key='settings'").fetchone()[0])

    def _revision(self, conn):
        return int(conn.execute("SELECT value FROM meta WHERE key='revision'").fetchone()[0])

    def _capture_row(self, conn, ident):
        row = conn.execute("SELECT * FROM cash_captures WHERE id=?", (ident,)).fetchone()
        if row is None:
            raise ValueError("Original capture not found.")
        return row

    def _mapping(self, conn, ident, version=None):
        row = conn.execute("SELECT * FROM cash_mappings WHERE capture_id=?" +
                           (" AND version=?" if version is not None else " ORDER BY version DESC LIMIT 1"),
                           (ident, version) if version is not None else (ident,)).fetchone()
        if row is None:
            raise ValueError("The requested original mapping edition is absent.")
        return {"version": row["version"], "mapping": json.loads(row["mapping"]), "confirmed": bool(row["confirmed"]),
                "issues": json.loads(row["issues"]), "created_at": row["created_at"]}

    def _capture(self, conn, ident, history=False):
        row = self._capture_row(conn, ident)
        parsed = json.loads(row["parsed"])
        mapping = self._mapping(conn, ident) if row["kind"] in m.LANES else {
            "version": 0, "mapping": {}, "confirmed": True, "issues": [], "created_at": row["created_at"]}
        result = {key: row[key] for key in ("id", "kind", "filename", "sha256", "created_at", "captured_at")}
        result.update(bytes=len(row["raw"]), rows=len(parsed.get("rows", [])), headers=parsed.get("headers", []),
                      preview=parsed.get("rows", [])[:5], coverage=json.loads(row["coverage"]),
                      mapping=mapping["mapping"], mapping_version=mapping["version"],
                      confirmed=mapping["confirmed"], current=bool(row["selected"]),
                      issues=mapping["issues"], issue_count=len(mapping["issues"]))
        if history:
            result["mapping_history"] = [self._mapping(conn, ident, x["version"]) for x in conn.execute(
                "SELECT version FROM cash_mappings WHERE capture_id=? ORDER BY version", (ident,))]
        return result

    def _state(self, conn):
        captures = []
        for row in conn.execute("SELECT id FROM cash_captures ORDER BY created_at DESC,id"):
            capture = self._capture(conn, row["id"])
            capture["issues"] = capture["issues"][:30]
            captures.append(capture)
        runs, packets = [], []
        for row in conn.execute("SELECT body FROM cash_runs ORDER BY created_at DESC,id"):
            body = json.loads(row["body"])
            run = copy.deepcopy(body["run"])
            run.update(body.get("summary", {}))
            runs.append(run)
            packets.extend(copy.deepcopy(body.get("packets", [])))
        profiles = [json.loads(row["value"]) for row in conn.execute("SELECT value FROM cash_profiles ORDER BY id,version DESC")]
        latest = {}
        for profile in profiles:
            latest.setdefault(profile["id"], profile["version"])
            profile["current"] = profile["version"] == latest[profile["id"]]
        return {"revision": self._revision(conn), "settings": self._settings(conn), "captures": captures,
                "runs": runs, "profiles": profiles, "packets": packets,
                "catalog": {"source_catalog": self.source_catalog, "fields": m.FIELDS,
                            "required_fields": {lane: list(m.REQUIRED) for lane in m.LANES},
                            "lanes": list(m.LANES), "events": list(m.EVENTS), "statuses": list(m.STATUSES),
                            "mapping_schema": m.DEFAULT_MAPPING, "review_states": list(m.REVIEW_STATES),
                            "receipt_states": list(m.RECEIPT_STATES)}}

    def state(self):
        with self.workspace.lock, self.workspace.db() as conn:
            return self._state(conn)

    def _body(self, conn, ident):
        row = conn.execute("SELECT body FROM cash_runs WHERE id=?", (ident,)).fetchone()
        if row is None:
            raise ValueError("Financial run not found.")
        return json.loads(row["body"])

    def _bindings(self, conn, ids):
        if not isinstance(ids, list) or not ids or len(ids) > 1000 or any(not isinstance(x, str) for x in ids):
            raise ValueError("Select at least one original confirmed financial capture, up to 1000.")
        result = []
        original_keys = {}
        for ident in dict.fromkeys(ids):
            capture = self._capture(conn, ident)
            if capture["kind"] not in m.LANES or not capture["confirmed"]:
                raise ValueError("Only a confirmed financial source can enter a run.")
            original_key = (capture["kind"], capture["sha256"], capture["coverage"]["source_system"], capture["coverage"]["report_family"])
            if original_key in original_keys:
                raise ValueError("The same original export is selected twice: " + original_keys[original_key] + " and " + ident + ". Retain one source for this run.")
            original_keys[original_key] = ident
            result.append({"capture_id": ident, "mapping_version": capture["mapping_version"]})
        return result

    def _hydrate(self, conn, body):
        result = copy.deepcopy(body)
        result["rows"] = {lane: [] for lane in m.LANES}
        result["manifest"] = []
        for binding in body["source_bindings"]:
            row = self._capture_row(conn, binding["capture_id"])
            mapping = self._mapping(conn, row["id"], binding["mapping_version"])
            if not mapping["confirmed"]:
                raise ValueError("Retained run mapping was not confirmed.")
            capture = {"id": row["id"], "filename": row["filename"]}
            normalized, issues = m.normalize(capture, bytes(row["raw"]), mapping["mapping"], body["settings"], mapping["version"])
            if issues:
                raise ValueError("The declared run settings cannot interpret the retained original " +
                                 row["filename"] + ": " + issues[0]["message"])
            result["rows"][row["kind"]].extend(normalized)
            result["manifest"].append({"capture_id": row["id"], "kind": row["kind"], "filename": row["filename"],
                                       "sha256": row["sha256"], "bytes": len(row["raw"]), "captured_at": row["captured_at"],
                                       "coverage": json.loads(row["coverage"]), "mapping": mapping["mapping"],
                                       "mapping_version": mapping["version"]})
        return result

    def _history(self, conn, body, cutoff=None):
        source_ids = {x["capture_id"] for x in body["source_bindings"]}
        events = []
        for row in conn.execute("SELECT * FROM cash_events ORDER BY seq"):
            if cutoff is not None and row["seq"] > cutoff:
                continue
            details = json.loads(row["details"])
            if row["run_id"] == body["run"]["id"] or details.get("capture_id") in source_ids:
                events.append({**{k: row[k] for k in ("seq", "run_id", "action", "actor", "created_at")}, "details": details})
        return events

    def _detail(self, conn, body, summary=False, historical=False):
        native = m.calculate(self._hydrate(conn, body))
        snapshot_hash = native["snapshot_hash"]
        signoffs = copy.deepcopy(body.get("signoffs", []))
        for signoff in signoffs:
            signoff["current"] = bool(signoff.get("active", True) and signoff["edit_revision"] == body["run"]["edit_revision"]
                                      and signoff["snapshot_hash"] == snapshot_hash)
        closings = copy.deepcopy(body.get("closings", []))
        for closing in closings:
            closing["current"] = bool(closing["id"] == body.get("current_close_id") and
                                      closing["edit_revision"] == body["run"]["edit_revision"] and
                                      closing["snapshot_hash"] == snapshot_hash)
        current = next((x for x in closings if x["current"]), None)
        reviewer_ids = {x["reviewer_id"].casefold() for x in signoffs if x["current"]}
        status = "closed" if current else "reviewed" if len(reviewer_ids) >= body["settings"]["close_reviewers_required"] else "open"
        run = {**body["run"], "status": status, "settings": body["settings"]}
        result = {"schema": "berkeley.cashiering.run.v1", "revision": self._revision(conn), **native, "run": run,
                  "corrections": copy.deepcopy(body.get("corrections", [])), "signoffs": signoffs, "closings": closings,
                  "closing": current, "interface_exports": copy.deepcopy(body.get("interface_exports", [])),
                  "history": self._history(conn, body, body.get("history_through") if historical else None), "packets": copy.deepcopy(body.get("packets", [])),
                  "historical": historical}
        result["counts"].update(signoffs=len(signoffs), current_signoffs=len(reviewer_ids), closings=len(closings),
                                interface_exports=len(result["interface_exports"]), history=len(result["history"]))
        for export in result["interface_exports"]:
            export["current_financial_edition"] = export["snapshot_hash"] == snapshot_hash
            receipts = sorted(export.get("receipts", []), key=lambda x: (datetime.fromisoformat(x["observed_at"].replace("Z", "+00:00")), x["created_at"], x["id"]))
            export["status"] = receipts[-1]["status"] if receipts else "prepared"
        if summary:
            result["rows"] = {lane: [] for lane in m.LANES}
            for name in ("groups", "findings", "allocations", "corrections", "history"):
                result[name] = []
            result["summary_only"] = True
        return result

    def detail(self, ident, summary=False):
        with self.workspace.lock, self.workspace.db() as conn:
            return self._detail(conn, self._body(conn, ident), summary)

    def _event(self, conn, action, actor, details, run_id=None):
        conn.execute("INSERT INTO cash_events(run_id,action,actor,created_at,details) VALUES(?,?,?,?,?)",
                     (run_id, action, actor, now(), m.canonical(details)))

    def _save(self, conn, body, action, actor, details):
        ident = body["run"]["id"]
        projection = self._detail(conn, body)
        body["summary"] = {"status": projection["run"]["status"], "counts": projection["counts"],
                           "snapshot_hash": projection["snapshot_hash"]}
        at = now()
        edition = uid("edition")
        self._event(conn, action, actor, {**details, "edition_id": edition, "edit_revision": body["run"]["edit_revision"],
                                        "snapshot_hash": projection["snapshot_hash"]}, ident)
        body["history_through"] = conn.execute("SELECT MAX(seq) FROM cash_events").fetchone()[0]
        conn.execute("INSERT INTO cash_runs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at",
                     (ident, m.canonical(body), body["run"]["created_at"], at))
        conn.execute("INSERT INTO cash_editions VALUES(?,?,?,?,?,?,?)",
                     (edition, ident, body["run"]["edit_revision"], projection["snapshot_hash"], m.canonical(body), at, action))
        return edition

    def _touch(self, body):
        body["run"]["edit_revision"] += 1
        body["current_close_id"] = None

    def _actor(self, payload):
        return m.text(payload.get("owner", payload.get("name", "Operator")), "owner", required=True, maximum=300)

    def _note(self, payload):
        return m.text(payload.get("note", ""), "reason/note", required=True)

    def _artifact(self, conn, kind, filename, raw, metadata):
        if not isinstance(raw, bytes):
            raise ValueError("Artifact bytes were not produced.")
        ident, sha = uid("artifact"), hashlib.sha256(raw).hexdigest()
        conn.execute("INSERT INTO cash_artifacts VALUES(?,?,?,?,?,?,?)",
                     (ident, kind, filename, raw, sha, m.canonical(metadata), now()))
        return {"id": ident, "artifact_id": ident, "kind": kind, "filename": filename,
                "sha256": sha, "bytes": len(raw), **metadata}

    def _document(self, conn, ident):
        source = conn.execute("SELECT * FROM cash_captures WHERE id=?", (ident,)).fetchone()
        if source is not None:
            return {"id": source["id"], "filename": source["filename"], "raw": bytes(source["raw"]),
                    "sha256": source["sha256"], "kind": source["kind"], "coverage": json.loads(source["coverage"])}
        artifact = conn.execute("SELECT * FROM cash_artifacts WHERE id=?", (ident,)).fetchone()
        if artifact is not None:
            return {"id": artifact["id"], "filename": artifact["filename"], "raw": bytes(artifact["raw"]),
                    "sha256": artifact["sha256"], "kind": artifact["kind"]}
        raise ValueError("Retained document/artifact not found.")

    def _dispatch(self, conn, action, p):
        if action.startswith("receiving-"):
            return self.receiving.dispatch(conn, action, p)
        actor = self._actor(p)
        if action == "settings":
            settings = m.validate_settings(p.get("settings"))
            conn.execute("UPDATE cash_meta SET value=? WHERE key='settings'", (m.canonical(settings),))
            self._event(conn, action, actor, {"settings": settings})
            return settings, None
        if action == "upload":
            kind = p.get("kind")
            if kind not in (*m.LANES, "document"):
                raise ValueError("Choose a financial lane or retained document.")
            filename = m.text(p.get("filename"), "original filename", required=True, maximum=500)
            encoded = p.get("content_base64")
            if not isinstance(encoded, str):
                raise ValueError("Supply base64 original bytes.")
            try:
                raw = base64.b64decode(encoded, validate=True)
            except (ValueError, TypeError):
                raise ValueError("Original bytes are not valid base64.") from None
            if not 0 < len(raw) <= MAX_FILE:
                raise ValueError("Original file is empty or exceeds 25 MiB.")
            captured_at = m.instant(p.get("captured_at"))
            scope = m.coverage(p.get("coverage", {}))
            sha = hashlib.sha256(raw).hexdigest()
            for previous in conn.execute("SELECT id,coverage,captured_at FROM cash_captures WHERE kind=? AND sha256=?", (kind, sha)):
                if json.loads(previous["coverage"]) == scope:
                    self._event(conn, "source-reacquired", actor, {"capture_id": previous["id"], "sha256": sha,
                                                                "original_captured_at": previous["captured_at"], "reacquired_at": captured_at,
                                                                "filename": filename})
                    return {"capture": self._capture(conn, previous["id"]), "duplicate": True}, None
            parsed = m.parse_capture(raw, filename) if kind in m.LANES else {"headers": [], "rows": []}
            ident, at = uid("capture"), now()
            conn.execute("INSERT INTO cash_captures VALUES(?,?,?,?,?,?,?,?,?,0)",
                         (ident, kind, filename, raw, sha, at, captured_at, m.canonical(scope), m.canonical(parsed)))
            if kind in m.LANES:
                mapping = copy.deepcopy(m.DEFAULT_MAPPING)
                mapping["fields"] = {field: {"column": field} for field in m.FIELD_NAMES if field in parsed["headers"]}
                _, issues = m.normalize({"id": ident, "filename": filename}, raw, mapping, self._settings(conn), 1)
                conn.execute("INSERT INTO cash_mappings VALUES(?,?,?,?,?,?)",
                             (ident, 1, m.canonical(mapping), 0, m.canonical(issues), at))
            self._event(conn, action, actor, {"capture_id": ident, "kind": kind, "filename": filename,
                                             "sha256": sha, "bytes": len(raw), "captured_at": captured_at, "coverage": scope})
            return {"capture": self._capture(conn, ident), "duplicate": False}, None
        if action == "mapping":
            capture = self._capture(conn, p.get("capture_id"))
            if capture["kind"] not in m.LANES:
                raise ValueError("Documents do not have financial field mappings.")
            mapping = m.validate_mapping(p.get("mapping"), capture["headers"])
            confirmed = p.get("confirmed")
            if type(confirmed) is not bool:
                raise ValueError("Confirm or save the mapping draft explicitly.")
            version = capture["mapping_version"] + 1
            row = self._capture_row(conn, capture["id"])
            _, issues = m.normalize(capture, bytes(row["raw"]), mapping, self._settings(conn), version)
            if confirmed and issues:
                raise ValueError("Cannot confirm this interpretation: " + issues[0]["message"])
            conn.execute("INSERT INTO cash_mappings VALUES(?,?,?,?,?,?)",
                         (capture["id"], version, m.canonical(mapping), int(confirmed), m.canonical(issues), now()))
            conn.execute("UPDATE cash_captures SET selected=0 WHERE id=?", (capture["id"],))
            self._event(conn, action, actor, {"capture_id": capture["id"], "mapping_version": version,
                                             "mapping": mapping, "confirmed": confirmed, "issue_count": len(issues)})
            return self._capture(conn, capture["id"], True), None
        if action == "select":
            capture = self._capture(conn, p.get("capture_id"))
            if type(p.get("selected")) is not bool or capture["kind"] not in m.LANES:
                raise ValueError("Select/deselect a financial data capture explicitly.")
            if p["selected"] and not capture["confirmed"]:
                raise ValueError("Confirm this exact mapping before selecting the source.")
            conn.execute("UPDATE cash_captures SET selected=? WHERE id=?", (int(p["selected"]), capture["id"]))
            self._event(conn, action, actor, {"capture_id": capture["id"], "selected": p["selected"]})
            return self._capture(conn, capture["id"]), None
        if action == "run":
            label = m.text(p.get("label"), "run label", required=True, maximum=300)
            start, end = m.day(p.get("start_date")), m.day(p.get("end_date"))
            if start > end:
                raise ValueError("Run end date precedes start.")
            ids = p.get("capture_ids")
            if ids is None:
                ids = [x["id"] for x in conn.execute("SELECT id FROM cash_captures WHERE selected=1 ORDER BY id")]
            bindings = self._bindings(conn, ids)
            ident = uid("run")
            body = {"run": {"id": ident, "label": label, "start_date": start, "end_date": end, "created_at": now(),
                            "source_revision": self._revision(conn), "edit_revision": 1, "note": p.get("note", "")},
                    "settings": self._settings(conn), "source_bindings": bindings,
                    "allocations": [], "corrections": [], "reviews": {}, "signoffs": [], "closings": [],
                    "current_close_id": None, "interface_exports": [], "packets": []}
            self._save(conn, body, action, actor, {"source_bindings": bindings})
            return {"run_id": ident}, ident
        if action == "profile":
            ident = p.get("id") or uid("profile")
            m.text(ident, "profile id", required=True, maximum=100)
            old = conn.execute("SELECT MAX(version) FROM cash_profiles WHERE id=?", (ident,)).fetchone()[0]
            version = (old or 0) + 1
            name = m.text(p.get("name"), "profile name", required=True, maximum=300)
            scope = p.get("scope", "balances")
            lane = p.get("lane", "permits")
            if scope not in ("balances", "transactions") or lane not in m.LANES:
                raise ValueError("Choose balances or one original transaction lane.")
            columns = p.get("columns")
            if not isinstance(columns, list) or not 1 <= len(columns) <= 100:
                raise ValueError("Supply 1..100 original receiving columns in order.")
            balance_fields = {"business_date", "session_id", "payment_type", "currency", "expected_minor", "cashier_minor",
                              "processor_minor", "cashier_difference_minor", "processor_difference_minor"}
            transaction_fields = set(m.FIELD_NAMES) | {"record_key", "reported_net_minor", "raw_status", "raw_event"}
            allowed = balance_fields if scope == "balances" else transaction_fields
            normalized = []
            headers = set()
            for column in columns:
                if not isinstance(column, dict):
                    raise ValueError("Every receiving column needs its explicit binding.")
                header = m.text(column.get("header"), "receiving header", required=True, maximum=300)
                if header in headers:
                    raise ValueError("Receiving headers must be unique.")
                headers.add(header)
                if ("literal" in column) == ("field" in column):
                    raise ValueError("Choose exactly one native field or supplied literal for a receiving column.")
                if "field" in column and column["field"] not in allowed:
                    raise ValueError("Unknown field for this receiving row family.")
                if "literal" in column and not isinstance(column["literal"], str):
                    raise ValueError("Receiving literals preserve exact supplied text.")
                fmt = column.get("format", "text")
                if fmt not in ("text", "minor", "major"):
                    raise ValueError("Unknown receiving value format.")
                normalized.append({"header": header, "format": fmt, **{k: column[k] for k in ("field", "literal") if k in column}})
            delimiter = p.get("delimiter", ",")
            if not isinstance(delimiter, str) or len(delimiter) != 1 or delimiter in ('"', "\r", "\n", "\x00"):
                raise ValueError("Receiving delimiter must be one supported character.")
            if type(p.get("include_header", True)) is not bool or p.get("line_ending", "CRLF") not in ("CRLF", "LF"):
                raise ValueError("Declare header inclusion and CRLF/LF line endings.")
            profile = {"id": ident, "version": version, "name": name, "scope": scope, "lane": lane,
                       "columns": normalized, "delimiter": delimiter, "include_header": p.get("include_header", True),
                       "line_ending": p.get("line_ending", "CRLF"), "note": self._note(p), "created_at": now()}
            conn.execute("INSERT INTO cash_profiles VALUES(?,?,?,?)", (ident, version, m.canonical(profile), profile["created_at"]))
            self._event(conn, action, actor, {"profile": profile})
            return profile, None
        if action not in {"refresh", "run-settings", "allocate", "allocation-retire", "correct", "correction-retire",
                          "review", "signoff", "close", "reopen", "interface-prepare", "interface-receipt", "packet"}:
            raise ValueError("Unknown financial action.")
        body = self._body(conn, p.get("run_id"))
        run_id = body["run"]["id"]
        detail = self._detail(conn, body)
        note = self._note(p)
        result = {}
        if action == "refresh":
            bindings = self._bindings(conn, p.get("capture_ids"))
            body["source_bindings"] = bindings
            body["run"]["source_revision"] = self._revision(conn)
            self._touch(body)
            new_groups = {g["id"] for g in m.calculate(self._hydrate(conn, body))["groups"]}
            for allocation in body["allocations"]:
                if allocation.get("active", True) and (allocation["source_group_id"] not in new_groups or allocation["target_group_id"] not in new_groups):
                    allocation.update(active=False, retired_at=now(), retired_by=actor, retirement_note="Original endpoint removed by explicit source refresh: " + note)
            result = {"source_bindings": bindings}
        elif action == "run-settings":
            body["settings"] = m.validate_settings(p.get("settings"))
            self._touch(body)
            result = {"settings": body["settings"]}
        elif action == "allocate":
            group_map = {x["id"]: x for x in detail["groups"]}
            source, target = group_map.get(p.get("source_group_id")), group_map.get(p.get("target_group_id"))
            if not source or not target or source["kind"] != "permits" or target["kind"] != "receivables":
                raise ValueError("Choose an actual permit source group and receivables target group.")
            amount = m.integer(p.get("amount_minor"))
            if source["currency"] != target["currency"] or source["remaining_minor"] is None or target["remaining_minor"] is None:
                raise ValueError("Allocation requires known original amounts in the same currency.")
            if int(amount) == 0 or any((int(g["remaining_minor"]) > 0) != (int(amount) > 0) or abs(int(amount)) > abs(int(g["remaining_minor"])) for g in (source, target)):
                raise ValueError("Allocation must have the same direction and fit both remaining balances.")
            result = {"id": uid("allocation"), "source_group_id": source["id"], "target_group_id": target["id"],
                      "amount_minor": amount, "currency": source["currency"], "owner": actor, "note": note,
                      "created_at": now(), "active": True, "source_hash": source["source_hash"], "target_hash": target["source_hash"]}
            body["allocations"].append(result)
            self._touch(body)
        elif action == "allocation-retire":
            allocation = next((x for x in body["allocations"] if x["id"] == p.get("allocation_id")), None)
            if allocation is None or not allocation.get("active", True):
                raise ValueError("Select an active original allocation.")
            allocation.update(active=False, retired_at=now(), retired_by=actor, retirement_note=note)
            result = copy.deepcopy(allocation)
            self._touch(body)
        elif action == "correct":
            row = next((r for lane in m.LANES for r in detail["rows"][lane] if r["record_key"] == p.get("record_key")), None)
            if row is None:
                raise ValueError("Select an original row from this run.")
            changes = m.correction_changes(p.get("changes"), body["settings"])
            result = {"id": uid("correction"), "record_key": row["record_key"],
                      "source_mapping_version": row["source_mapping_version"], "changes": changes,
                      "before": {k: row.get(k) for k in changes}, "owner": actor, "note": note,
                      "created_at": now(), "active": True}
            body["corrections"].append(result)
            self._touch(body)
        elif action == "correction-retire":
            correction = next((x for x in body["corrections"] if x["id"] == p.get("correction_id")), None)
            if correction is None or not correction.get("active", True):
                raise ValueError("Select an active original correction.")
            correction.update(active=False, retired_at=now(), retired_by=actor, retirement_note=note)
            result = copy.deepcopy(correction)
            self._touch(body)
        elif action == "review":
            finding = next((x for x in detail["findings"] if x["id"] == p.get("finding_id")), None)
            if finding is None or p.get("status") not in m.REVIEW_STATES:
                raise ValueError("Choose a current original finding and review state.")
            if p["status"] == "accepted_exception" and not finding["waivable"]:
                raise ValueError("This stale source/amount binding must be corrected, not waived.")
            result = {"status": p["status"], "owner": actor, "note": note, "updated_at": now()}
            body["reviews"][finding["id"]] = result
            self._touch(body)
        elif action == "signoff":
            reviewer_id = m.text(p.get("reviewer_id"), "reviewer identity", required=True, maximum=300).strip()
            name = m.text(p.get("name"), "reviewer name", required=True, maximum=300)
            role = m.text(p.get("role"), "reviewer role", required=True, maximum=300)
            statement = m.text(p.get("statement"), "review statement", required=True)
            for signoff in body["signoffs"]:
                if signoff["reviewer_id"].casefold() == reviewer_id.casefold():
                    signoff["active"] = False
            result = {"id": uid("signoff"), "reviewer_id": reviewer_id, "name": name, "role": role, "statement": statement,
                      "note": note, "signed_at": now(), "edit_revision": body["run"]["edit_revision"],
                      "snapshot_hash": detail["snapshot_hash"], "active": True}
            body["signoffs"].append(result)
        elif action == "close":
            current = [x for x in detail["signoffs"] if x["current"]]
            if len({x["reviewer_id"].casefold() for x in current}) < body["settings"]["close_reviewers_required"]:
                raise ValueError("The exact current financial edition needs the required distinct deposit reviewers.")
            if detail["counts"]["unaccepted_findings"]:
                raise ValueError("Resolve or explicitly accept the remaining source-bound findings before close.")
            documents = p.get("deposit_document_ids", [])
            if not isinstance(documents, list) or any(not isinstance(x, str) for x in documents):
                raise ValueError("Deposit documents must be retained original IDs.")
            for ident in dict.fromkeys(documents):
                self._capture_row(conn, ident)
            result = {"id": uid("closing"), "status": "closed", "owner": actor, "note": note, "created_at": now(),
                      "edit_revision": body["run"]["edit_revision"], "snapshot_hash": detail["snapshot_hash"],
                      "signoffs": current, "deposit_document_ids": list(dict.fromkeys(documents))}
            body["closings"].append(result)
            body["current_close_id"] = result["id"]
        elif action == "reopen":
            result = {"previous_close_id": body.get("current_close_id"), "owner": actor, "note": note}
            self._touch(body)
        elif action == "interface-prepare":
            version = p.get("profile_version")
            if type(version) is not int:
                raise ValueError("Select the exact receiving profile version.")
            row = conn.execute("SELECT value FROM cash_profiles WHERE id=? AND version=?", (p.get("profile_id"), version)).fetchone()
            if row is None:
                raise ValueError("Receiving profile edition not found.")
            profile = json.loads(row["value"])
            label = m.text(p.get("label"), "prepared file label", required=True, maximum=300)
            records = detail["balances"] if profile["scope"] == "balances" else [
                r for r in detail["rows"][profile["lane"]] if r["in_scope"] and not r["excluded"]]
            output = io.StringIO(newline="")
            writer = csv.writer(output, delimiter=profile["delimiter"], lineterminator="\r\n" if profile["line_ending"] == "CRLF" else "\n")
            if profile["include_header"]:
                writer.writerow([x["header"] for x in profile["columns"]])
            for record in records:
                values = []
                for column in profile["columns"]:
                    value = column["literal"] if "literal" in column else record.get(column["field"])
                    if value is None:
                        value = ""
                    elif column["format"] in ("minor", "major"):
                        value = m.integer(value, "receiving numeric field")
                        if column["format"] == "major":
                            value = m.major(value, body["settings"]["scales"][record["currency"]])
                    elif not isinstance(value, str):
                        value = m.canonical(value)
                    values.append(value)
                writer.writerow(values)
            raw = output.getvalue().encode("utf-8")
            ident = uid("exchange")
            metadata = {"export_id": ident, "run_id": run_id, "profile_id": profile["id"], "profile_version": profile["version"],
                        "edit_revision": body["run"]["edit_revision"], "snapshot_hash": detail["snapshot_hash"], "row_count": len(records)}
            artifact = self._artifact(conn, "prepared-interface", ident + ".csv", raw, metadata)
            result = {"id": ident, "label": label, "owner": actor, "note": note, "created_at": now(),
                      "status": "prepared", "artifact_id": artifact["id"], "sha256": artifact["sha256"], "bytes": artifact["bytes"],
                      "profile": profile, "source_revision": body["run"]["source_revision"], "receipts": [], **metadata}
            body["interface_exports"].append(result)
        elif action == "interface-receipt":
            export = next((x for x in body["interface_exports"] if x["id"] == p.get("export_id")), None)
            if export is None or p.get("status") not in m.RECEIPT_STATES:
                raise ValueError("Choose the exact retained prepared exchange and an actual observation state.")
            original = self._capture_row(conn, p.get("document_id"))
            observed_at = m.instant(p.get("observed_at"))
            reference = m.text(p.get("reference"), "native receipt reference", required=True, maximum=2000)
            result = {"id": uid("receipt"), "export_id": export["id"], "artifact_id": export["artifact_id"],
                      "profile_id": export["profile_id"], "profile_version": export["profile_version"],
                      "edit_revision": export["edit_revision"], "snapshot_hash": export["snapshot_hash"],
                      "status": p["status"], "observed_at": observed_at, "reference": reference,
                      "document_id": original["id"], "document_sha256": original["sha256"],
                      "owner": actor, "note": note, "created_at": now()}
            export["receipts"].append(result)
        elif action == "packet":
            label = m.text(p.get("label"), "packet label", required=True, maximum=300)
            originals = []
            for entry in detail["manifest"]:
                original = self._document(conn, entry["capture_id"])
                original.update(mapping=entry["mapping"], coverage=entry["coverage"])
                originals.append(original)
            document_ids = {x for closing in body["closings"] for x in closing.get("deposit_document_ids", [])}
            for export in body["interface_exports"]:
                document_ids.add(export["artifact_id"])
                document_ids.update(x["document_id"] for x in export["receipts"])
            documents = [self._document(conn, ident) for ident in sorted(document_ids) if ident not in {x["id"] for x in originals}]
            frozen = copy.deepcopy(detail)
            self.receiving.attach_packet(conn, run_id, frozen, documents)
            frozen["packet_preparation"] = {"label": label, "owner": actor, "note": note, "prepared_at": now()}
            raw, manifest = build_packet(frozen, originals, documents, source_files=self.source_files)
            ident = uid("packet")
            metadata = {"packet_id": ident, "run_id": run_id, "edit_revision": body["run"]["edit_revision"],
                        "snapshot_hash": detail["snapshot_hash"], "manifest": manifest}
            artifact = self._artifact(conn, "financial-packet", ident + ".zip", raw, metadata)
            result = {"id": ident, "label": label, "owner": actor, "note": note, "artifact_id": artifact["id"],
                      "sha256": artifact["sha256"], "bytes": artifact["bytes"], "manifest": manifest,
                      "run_id": run_id, "edit_revision": body["run"]["edit_revision"],
                      "snapshot_hash": detail["snapshot_hash"], "created_at": now()}
            body["packets"].append(result)
        edition = self._save(conn, body, action, actor, {"note": note, "result": result})
        return {**result, "edition_id": edition}, run_id

    def write(self, action, payload):
        if not isinstance(payload, dict):
            raise ValueError("Financial request must be an object.")
        request_id = payload.get("request_id")
        if request_id is not None:
            try:
                if not isinstance(request_id, str) or str(uuid.UUID(request_id)) != request_id:
                    raise ValueError()
            except (ValueError, TypeError, AttributeError):
                raise ValueError("request_id must be a canonical UUID.") from None
        request_sha = m.fingerprint({"action": action, "payload": payload})
        with self.workspace.lock, self.workspace.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if request_id:
                previous = conn.execute("SELECT * FROM cash_requests WHERE id=?", (request_id,)).fetchone()
                if previous:
                    if previous["request_sha"] != request_sha:
                        raise self.conflict("This original request ID already belongs to a different payload.")
                    return json.loads(zlib.decompress(previous["response"]).decode())
            self.workspace.check_revision(conn, payload.get("revision"))
            result, run_id = self._dispatch(conn, action, payload)
            self.workspace.bump(conn)
            response = {"revision": self._revision(conn), "state": self._state(conn), "result": result}
            if run_id:
                response["detail"] = self._detail(conn, self._body(conn, run_id))
            if request_id:
                conn.execute("INSERT INTO cash_requests VALUES(?,?,?,?)",
                             (request_id, request_sha, zlib.compress(m.canonical(response).encode(), 6), now()))
            return response

    def read(self, path, query):
        parts = path.strip("/").split("/")
        if parts[:2] != ["api", "cashiering"]:
            return None
        rest = parts[2:]
        with self.workspace.lock, self.workspace.db() as conn:
            if rest and rest[0] == "receiving":
                return self.receiving.read(conn, rest[1:], query)
            if rest == ["state"]:
                return self._state(conn), "application/json; charset=utf-8", None
            if len(rest) == 2 and rest[0] == "requests":
                row = conn.execute("SELECT response FROM cash_requests WHERE id=?", (rest[1],)).fetchone()
                return {"found": row is not None, "response": json.loads(zlib.decompress(row["response"]).decode()) if row else None}, "application/json; charset=utf-8", None
            if rest and rest[0] == "captures" and len(rest) in (2, 3):
                ident = rest[1]
                capture = self._capture(conn, ident, len(rest) == 2)
                if len(rest) == 2:
                    return capture, "application/json; charset=utf-8", None
                row = self._capture_row(conn, ident)
                if rest[2] == "download":
                    ext = Path(row["filename"]).suffix if re.fullmatch(r"\.[A-Za-z0-9]{1,8}", Path(row["filename"]).suffix) else ".bin"
                    return bytes(row["raw"]), "application/octet-stream", "financial-original-" + ident + ext
                if rest[2] == "rows":
                    if query.get("normalized") in ("1", "true"):
                        if capture["kind"] not in m.LANES:
                            rows, issues = [], []
                        else:
                            mapping = self._mapping(conn, ident)
                            rows, issues = m.normalize(capture, bytes(row["raw"]), mapping["mapping"], self._settings(conn), mapping["version"])
                    else:
                        rows, issues = json.loads(row["parsed"]).get("rows", []), []
                    return {"capture_id": ident, **page(rows, query), "issues": issues}, "application/json; charset=utf-8", None
            if len(rest) == 2 and rest[0] == "artifacts":
                row = conn.execute("SELECT * FROM cash_artifacts WHERE id=?", (rest[1],)).fetchone()
                if row is None:
                    raise ValueError("Retained artifact not found.")
                mime = "application/zip" if row["kind"] in ("financial-packet", "receiving-packet") else "text/csv; charset=utf-8" if row["kind"] == "prepared-interface" else "application/octet-stream"
                return bytes(row["raw"]), mime, row["filename"]
            if len(rest) == 2 and rest[0] == "packets":
                for row in conn.execute("SELECT body FROM cash_runs"):
                    packet = next((x for x in json.loads(row["body"]).get("packets", []) if x["id"] == rest[1]), None)
                    if packet:
                        return packet, "application/json; charset=utf-8", None
                raise ValueError("Retained packet not found.")
            if len(rest) == 2 and rest[0] == "editions":
                row = conn.execute("SELECT * FROM cash_editions WHERE id=?", (rest[1],)).fetchone()
                if row is None:
                    raise ValueError("Retained run edition not found.")
                result = self._detail(conn, json.loads(row["body"]), historical=True)
                result["edition"] = {k: row[k] for k in ("id", "run_id", "edit_revision", "snapshot_hash", "created_at", "action")}
                return result, "application/json; charset=utf-8", None
            if rest and rest[0] == "runs" and len(rest) in (2, 3):
                ident = rest[1]
                body = self._body(conn, ident)
                if len(rest) == 2:
                    return self._detail(conn, body, query.get("summary") == "1"), "application/json; charset=utf-8", None
                action = rest[2]
                if action == "editions":
                    rows = [dict(x) for x in conn.execute("SELECT id,run_id,edit_revision,snapshot_hash,created_at,action FROM cash_editions WHERE run_id=? ORDER BY created_at DESC,id", (ident,))]
                    return page(rows, query), "application/json; charset=utf-8", None
                detail = self._detail(conn, body)
                if action == "report":
                    return render_report(detail), "text/html; charset=utf-8", None
                if action == "rows":
                    lane = query.get("kind")
                    if lane not in m.LANES:
                        raise ValueError("Select an exact original financial row lane.")
                    return page(detail["rows"][lane], {k: v for k, v in query.items() if k != "kind"}), "application/json; charset=utf-8", None
                if action in ("groups", "findings", "allocations", "corrections", "history"):
                    return page(detail[action], query), "application/json; charset=utf-8", None
            raise ValueError("Financial resource not found.")
