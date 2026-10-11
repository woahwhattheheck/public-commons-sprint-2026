"""Retained permitting cutover workspace around the original Clariti comparator."""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
import csv
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import subprocess
import tempfile
import threading
from urllib.parse import parse_qs, urlparse
import uuid

from intake import FIELDS, REQUIRED, IDENTIFIER, captured_time, default_mapping, load_crosswalk, load_export, normalize_export, validate_mapping
from scenarios import RECIPES, evaluate, validate_check

ROOT = Path(__file__).resolve().parent
APP_ID = 1112560209
DEFAULT_SETTINGS = {"cohort": "", "currency": "USD", "currency_scale": 2, "scope_note": "", "scenarios": []}
MAX_FILE = 25 * 1024 * 1024


def now():
    return datetime.now(timezone.utc).isoformat()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def validate_settings(value):
    if not isinstance(value, dict):
        raise ValueError("Supply workspace settings.")
    settings = {**DEFAULT_SETTINGS, **value}
    if not isinstance(settings["cohort"], str) or not IDENTIFIER.fullmatch(settings["cohort"]):
        raise ValueError("Name the intended same-cohort comparison using letters, numbers, dot, underscore, colon or hyphen.")
    if not isinstance(settings["currency"], str) or len(settings["currency"]) != 3 or not settings["currency"].isalpha():
        raise ValueError("Use a three-letter currency code for this cohort.")
    settings["currency"] = settings["currency"].upper()
    if type(settings["currency_scale"]) is not int or not 0 <= settings["currency_scale"] <= 6:
        raise ValueError("Currency scale must be an integer from zero to six.")
    if not isinstance(settings["scope_note"], str) or not settings["scope_note"].strip() or len(settings["scope_note"]) > 12000:
        raise ValueError("Describe the included population, observation point and agreed export scope.")
    scenarios = settings["scenarios"]
    if not isinstance(scenarios, list) or len(scenarios) > 100:
        raise ValueError("Supply at most 100 cutover scenarios.")
    ids = set()
    for scenario in scenarios:
        if not isinstance(scenario, dict) or not IDENTIFIER.fullmatch(str(scenario.get("id", ""))) or scenario["id"] in ids:
            raise ValueError("Every cutover scenario needs a unique valid identifier.")
        ids.add(scenario["id"])
        for field in ("title", "criterion"):
            if not isinstance(scenario.get(field), str) or not scenario[field].strip() or len(scenario[field]) > 12000:
                raise ValueError("Every scenario needs a title and an explicit acceptance criterion.")
        if type(scenario.get("required")) is not bool:
            raise ValueError("Mark each scenario as required or optional.")
        validate_check(scenario.get("check"))
    return settings


class Conflict(ValueError):
    pass


class Workspace:
    def __init__(self, path):
        self.path = str(Path(path).resolve())
        self.lock = threading.RLock()
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.db() as conn:
            marker = conn.execute("PRAGMA application_id").fetchone()[0]
            if marker not in (0, APP_ID) or (marker == 0 and conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchone()):
                raise ValueError("Select a new path or an existing permitting workspace database.")
            conn.executescript("""
                PRAGMA application_id=1112560209;
                PRAGMA user_version=1;
                CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS datasets(id TEXT PRIMARY KEY,side TEXT NOT NULL,filename TEXT NOT NULL,
                    raw BLOB NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL,captured_at TEXT NOT NULL,
                    mapping TEXT NOT NULL,confirmed INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS slots(side TEXT PRIMARY KEY,dataset_id TEXT NOT NULL REFERENCES datasets(id));
                CREATE TABLE IF NOT EXISTS dataset_catalog(id TEXT PRIMARY KEY REFERENCES datasets(id),headers TEXT NOT NULL,row_count INTEGER NOT NULL,preview TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,label TEXT NOT NULL,created_at TEXT NOT NULL,
                    source_revision INTEGER NOT NULL,report TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS findings(run_id TEXT NOT NULL REFERENCES runs(id),id TEXT NOT NULL,
                    code TEXT NOT NULL,case_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(run_id,id));
                CREATE INDEX IF NOT EXISTS findings_case ON findings(run_id,case_id);
                CREATE TABLE IF NOT EXISTS cases(run_id TEXT NOT NULL REFERENCES runs(id),case_id TEXT NOT NULL,
                    type TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(run_id,case_id));
                CREATE TABLE IF NOT EXISTS decisions(run_id TEXT NOT NULL REFERENCES runs(id),kind TEXT NOT NULL,
                    item_id TEXT NOT NULL,status TEXT NOT NULL,owner TEXT NOT NULL,note TEXT NOT NULL,
                    updated_at TEXT NOT NULL,PRIMARY KEY(run_id,kind,item_id));
                CREATE TABLE IF NOT EXISTS decision_history(id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,kind TEXT NOT NULL,item_id TEXT NOT NULL,status TEXT NOT NULL,
                    owner TEXT NOT NULL,note TEXT NOT NULL,updated_at TEXT NOT NULL);
            """)
            conn.execute("INSERT OR IGNORE INTO meta VALUES('revision','0')")
            conn.execute("INSERT OR IGNORE INTO meta VALUES('settings',?)", (canonical(DEFAULT_SETTINGS),))

    @contextmanager
    def db(self):
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def check_revision(self, conn, value):
        revision = int(conn.execute("SELECT value FROM meta WHERE key='revision'").fetchone()[0])
        if type(value) is not int or value != revision:
            raise Conflict("Workspace changed. Refresh and reapply your change.")
        return revision

    def bump(self, conn):
        conn.execute("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'")

    def state(self):
        with self.lock, self.db() as conn:
            meta = {r["key"]: r["value"] for r in conn.execute("SELECT * FROM meta")}
            datasets = []
            for row in conn.execute("SELECT d.id,d.side,d.filename,d.sha256,d.created_at,d.captured_at,d.mapping,d.confirmed,s.side AS current_slot,c.headers,c.row_count,c.preview FROM datasets d LEFT JOIN slots s ON s.dataset_id=d.id LEFT JOIN dataset_catalog c ON c.id=d.id ORDER BY d.created_at DESC"):
                if row["headers"] is None:
                    raw = conn.execute("SELECT raw FROM datasets WHERE id=?", (row["id"],)).fetchone()[0]
                    parsed = load_export(raw, row["filename"])
                    headers, rows, preview = parsed["headers"], len(parsed["rows"]), parsed["rows"][:5]
                    conn.execute("INSERT INTO dataset_catalog VALUES(?,?,?,?)", (row["id"], canonical(headers), rows, canonical(preview)))
                else:
                    headers, rows, preview = json.loads(row["headers"]), row["row_count"], json.loads(row["preview"])
                datasets.append({**{key: row[key] for key in ("id", "side", "filename", "sha256", "created_at", "captured_at")}, "mapping": json.loads(row["mapping"]), "confirmed": bool(row["confirmed"]), "current": row["current_slot"] is not None, "headers": headers, "rows": rows, "preview": preview})
            runs = [dict(r) for r in conn.execute("SELECT id,label,created_at,source_revision FROM runs ORDER BY created_at DESC,rowid DESC")]
            return {"revision": int(meta["revision"]), "settings": json.loads(meta["settings"]), "datasets": datasets, "runs": runs, "fields": FIELDS, "required_fields": REQUIRED, "scenario_recipes": RECIPES}

    def settings(self, payload):
        settings = validate_settings(payload.get("settings"))
        with self.lock, self.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            self.check_revision(conn, payload.get("revision"))
            conn.execute("UPDATE meta SET value=? WHERE key='settings'", (canonical(settings),))
            self.bump(conn)
        return {"settings": settings}

    def upload(self, payload, crosswalk=False):
        side = "crosswalk" if crosswalk else payload.get("side")
        if side not in ("source", "target", "crosswalk") or (side == "crosswalk" and not crosswalk):
            raise ValueError("Select source or target for the original export.")
        filename = str(payload.get("filename", ""))[:240]
        if not filename.lower().endswith((".csv", ".json")) or (crosswalk and not filename.lower().endswith(".csv")):
            raise ValueError("Select a CSV or JSON export; crosswalks use CSV.")
        try:
            raw = base64.b64decode(payload.get("base64", ""), validate=True)
        except (ValueError, TypeError):
            raise ValueError("Invalid uploaded file encoding.") from None
        if not raw or len(raw) > MAX_FILE:
            raise ValueError("Each export must be nonempty and at most 25 MiB.")
        parsed = load_export(raw, filename)
        if crosswalk:
            load_crosswalk(raw)
        captured_at = now() if crosswalk else captured_time(payload.get("captured_at"))
        mapping = {} if crosswalk else default_mapping(parsed["headers"])
        identifier = uuid.uuid4().hex
        with self.lock, self.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            self.check_revision(conn, payload.get("revision"))
            conn.execute("INSERT INTO datasets VALUES(?,?,?,?,?,?,?,?,?)", (identifier, side, filename, raw, hashlib.sha256(raw).hexdigest(), now(), captured_at, canonical(mapping), int(crosswalk)))
            conn.execute("INSERT INTO dataset_catalog VALUES(?,?,?,?)", (identifier, canonical(parsed["headers"]), len(parsed["rows"]), canonical(parsed["rows"][:5])))
            conn.execute("INSERT INTO slots VALUES(?,?) ON CONFLICT(side) DO UPDATE SET dataset_id=excluded.dataset_id", (side, identifier))
            self.bump(conn)
        return {"dataset_id": identifier, "rows": len(parsed["rows"])}

    def mapping(self, payload):
        with self.lock, self.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            self.check_revision(conn, payload.get("revision"))
            row = conn.execute("SELECT * FROM datasets WHERE id=?", (payload.get("dataset_id"),)).fetchone()
            if not row or row["side"] == "crosswalk":
                raise ValueError("Select an original source or target export.")
            parsed = load_export(row["raw"], row["filename"])
            mapping = validate_mapping(payload.get("mapping"), parsed["headers"])
            conn.execute("UPDATE datasets SET mapping=?,confirmed=1 WHERE id=?", (canonical(mapping), row["id"]))
            self.bump(conn)
        return {"dataset_id": row["id"]}

    def remove_crosswalk(self, payload):
        with self.lock, self.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            self.check_revision(conn, payload.get("revision"))
            conn.execute("DELETE FROM slots WHERE side='crosswalk'")
            self.bump(conn)
        return {"removed": True}

    def select_dataset(self, payload):
        with self.lock, self.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            self.check_revision(conn, payload.get("revision"))
            row = conn.execute("SELECT id,side,confirmed FROM datasets WHERE id=?", (payload.get("dataset_id"),)).fetchone()
            if not row:
                raise ValueError("Retained export not found.")
            if not row["confirmed"]:
                raise ValueError("Confirm this export's mapping before selecting it for a new comparison.")
            conn.execute("INSERT INTO slots VALUES(?,?) ON CONFLICT(side) DO UPDATE SET dataset_id=excluded.dataset_id", (row["side"], row["id"]))
            self.bump(conn)
        return {"dataset_id": row["id"], "side": row["side"]}

    def dataset(self, identifier):
        with self.db() as conn:
            row = conn.execute("SELECT * FROM datasets WHERE id=?", (identifier,)).fetchone()
            if not row:
                raise ValueError("Export not found.")
            return {**dict(row), "mapping": json.loads(row["mapping"])}

    def preview(self, identifier, offset=0, limit=100, normalized=False):
        export = self.dataset(identifier)
        if normalized and export["side"] != "crosswalk":
            with self.db() as conn:
                settings = validate_settings(json.loads(conn.execute("SELECT value FROM meta WHERE key='settings'").fetchone()[0]))
                cross = conn.execute("SELECT d.raw FROM slots s JOIN datasets d ON d.id=s.dataset_id WHERE s.side='crosswalk'").fetchone()
            data = normalize_export(export, settings, load_crosswalk(cross[0]) if cross else {})
            rows = data["previews"]
            errors = data["errors"]
        else:
            rows = load_export(export["raw"], export["filename"])["rows"]
            errors = []
        return {"rows": rows[offset:offset + limit], "total": len(rows), "offset": offset, "limit": limit, "errors": errors}

    def run(self, payload):
        with self.lock, self.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            revision = self.check_revision(conn, payload.get("revision"))
            settings = validate_settings(json.loads(conn.execute("SELECT value FROM meta WHERE key='settings'").fetchone()[0]))
            exports = {r["side"]: {**dict(r), "mapping": json.loads(r["mapping"])} for r in conn.execute("SELECT d.* FROM slots s JOIN datasets d ON s.dataset_id=d.id")}
            for side in ("source", "target"):
                if side not in exports or not exports[side]["confirmed"]:
                    raise ValueError("Upload and confirm the " + side + " field mapping.")
            crosswalk = load_crosswalk(exports["crosswalk"]["raw"]) if "crosswalk" in exports else {}
            inputs = {side: normalize_export(exports[side], settings, crosswalk) for side in ("source", "target")}
            errors = [*inputs["source"]["errors"], *inputs["target"]["errors"]]
            manifest = [{**{key: value[key] for key in ("id", "side", "filename", "sha256", "captured_at", "created_at", "mapping")}, "dataset_id": value["id"], "bytes": len(value["raw"])} for value in exports.values()]
            private_findings = []
            if not errors:
                node = os.environ.get("BERKELEY_NODE") or shutil.which("node")
                if not node:
                    raise ValueError("Install Node.js 22 or later to run the original comparator.")
                request = {side: {"cohort": settings["cohort"], "records": inputs[side]["records"]} for side in ("source", "target")}
                process = subprocess.run([node, str(ROOT / "audit-bridge.mjs")], input=canonical(request), text=True, capture_output=True, timeout=90)
                try:
                    bridge = json.loads(process.stdout)
                except ValueError:
                    raise ValueError("The original comparator did not return a valid result. Check the Node runtime.") from None
                if not bridge.get("ok"):
                    errors.append({"dataset_id": "", "line": 0, "message": bridge.get("message", "Original comparator rejected the normalized exports.")})
                else:
                    public = bridge["result"]
                    detailed = public.pop("findings")
                    for found in detailed:
                        item = {"code": found["code"], "case_id": found["caseId"], "message": found["code"].replace("_", " ").capitalize(), "source": found["source"], "target": found["target"], "details": found["details"], "source_context": inputs["source"]["contexts"].get(found["caseId"]), "target_context": inputs["target"]["contexts"].get(found["caseId"])}
                        item["id"] = digest({"manifest": manifest, "finding": item})
                        private_findings.append(item)
            if errors:
                public = {"status": "INPUT_REVIEW_REQUIRED", "sourceRecords": len(inputs["source"]["records"]), "targetRecords": len(inputs["target"]["records"]), "totalFindings": 0, "issues": {}, "examples": [], "examplesTruncated": False}
            previous = None
            for row in conn.execute("SELECT id,label,report FROM runs ORDER BY created_at DESC,rowid DESC"):
                candidate = json.loads(row["report"])
                if candidate["settings"]["cohort"] == settings["cohort"]:
                    previous = row
                    break
            prior = {}
            if previous:
                for row in conn.execute("SELECT f.payload,d.status,d.owner,d.note,d.updated_at FROM findings f LEFT JOIN decisions d ON d.run_id=f.run_id AND d.kind='finding' AND d.item_id=f.id WHERE f.run_id=?", (previous["id"],)):
                    found = json.loads(row["payload"])
                    key = self.finding_key(found)
                    prior[key] = {"run_id": previous["id"], "run_label": previous["label"], "finding_id": found["id"], "status": row["status"] or "open", "owner": row["owner"] or "", "note": row["note"] or "", "updated_at": row["updated_at"]}
            matched_keys = set()
            for finding in private_findings:
                key = self.finding_key(finding)
                if key in prior:
                    finding["prior_review"] = prior[key]
                    matched_keys.add(key)
            continuity = {"previous_run_id": previous["id"] if previous else None, "previous_run_label": previous["label"] if previous else None, "comparison_valid": not errors, "unchanged_findings": len(matched_keys) if not errors else None, "new_or_changed_findings": len(private_findings) - len(matched_keys) if not errors else None, "no_longer_present": len(prior) - len(matched_keys) if not errors else None}
            run_id = uuid.uuid4().hex
            report = {"settings": settings, "manifest": manifest, "public_report": public, "input_errors": errors, "continuity": continuity, "scenario_results": evaluate(settings["scenarios"], inputs["target"]["records"]) if not errors else [], "normalization_summary": [{"side": side, "original_rows": inputs[side]["rows"], "normalized_rows": len(inputs[side]["records"]), "errors": len(inputs[side]["errors"])} for side in ("source", "target")], "engine": {"file": "audit.mjs", "sha256": hashlib.sha256((ROOT.parent / "audit.mjs").read_bytes()).hexdigest()}}
            conn.execute("INSERT INTO runs VALUES(?,?,?,?,?)", (run_id, str(payload.get("label") or settings["cohort"])[:240], now(), revision, canonical(report)))
            conn.executemany("INSERT INTO findings VALUES(?,?,?,?,?)", [(run_id, item["id"], item["code"], item["case_id"], canonical(item)) for item in private_findings])
            source = {r["id"]: r for r in inputs["source"]["records"]}
            target = {r["id"]: r for r in inputs["target"]["records"]}
            conn.executemany("INSERT INTO cases VALUES(?,?,?,?)", [(run_id, key, (source.get(key) or target[key])["type"], canonical({"case_id": key, "source": source.get(key), "target": target.get(key)})) for key in sorted(set(source) | set(target))])
            self.bump(conn)
        return {"run_id": run_id}

    @staticmethod
    def finding_key(finding):
        fields = {"TYPE_CHANGED": "type", "DEPARTMENT_CHANGED": "department", "STATUS_CHANGED": "status", "LINKS_CHANGED": "links", "REVIEWS_CHANGED": "reviews", "REVIEW_ASSIGNMENTS_CHANGED": "reviewAssignments", "REVIEW_DUE_CHANGED": "reviewDueAt", "ATTACHMENTS_CHANGED": "attachments", "PAYMENT_MINOR_CHANGED": "paymentMinor"}
        field = fields.get(finding["code"])
        values = {side: (finding.get(side) or {}).get(field) if field else finding.get(side) for side in ("source", "target")}
        return digest({"case_id": finding["case_id"], "code": finding["code"], "details": finding.get("details", {}), "values": values})

    def _decisions(self, conn, run_id):
        decisions = [dict(r) for r in conn.execute("SELECT * FROM decisions WHERE run_id=?", (run_id,))]
        return {"reviews": {r["item_id"]: r for r in decisions if r["kind"] == "finding"}, "scenario_reviews": {r["item_id"]: r for r in decisions if r["kind"] == "scenario"}, "cutover": next((r for r in decisions if r["kind"] == "cutover"), None)}

    def _counts(self, conn, run_id):
        rows = conn.execute("SELECT COALESCE(d.status,'open') AS status,COUNT(*) AS n FROM findings f LEFT JOIN decisions d ON d.run_id=f.run_id AND d.kind='finding' AND d.item_id=f.id WHERE f.run_id=? GROUP BY COALESCE(d.status,'open')", (run_id,)).fetchall()
        counts = {"open": 0, "needs_fix": 0, "accepted_difference": 0}
        counts.update({r["status"]: r["n"] for r in rows})
        counts["total"] = sum(counts.values())
        return counts

    def detail(self, run_id, summary=False):
        with self.lock, self.db() as conn:
            row = conn.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise ValueError("Comparison run not found.")
            result = {key: row[key] for key in ("id", "label", "created_at", "source_revision")}
            result.update(json.loads(row["report"]))
            result.update(self._decisions(conn, run_id))
            result["counts"] = self._counts(conn, run_id)
            result["cutover_blockers"] = self._cutover_blockers(conn, run_id, result)
            if not summary:
                result["findings"] = [json.loads(r[0]) for r in conn.execute("SELECT payload FROM findings WHERE run_id=? ORDER BY code,case_id,id", (run_id,))]
                result["review_history"] = [dict(r) for r in conn.execute("SELECT * FROM decision_history WHERE run_id=? ORDER BY id", (run_id,))]
            else:
                result["review_history"] = [dict(r) for r in conn.execute("SELECT * FROM decision_history WHERE run_id=? ORDER BY id DESC LIMIT 20", (run_id,))][::-1]
            result["review_history_total"] = conn.execute("SELECT COUNT(*) FROM decision_history WHERE run_id=?", (run_id,)).fetchone()[0]
            return result

    def findings(self, run_id, offset=0, limit=50, query="", code="", status=""):
        with self.db() as conn:
            where, args = "f.run_id=?", [run_id]
            if query:
                where += " AND (instr(lower(f.case_id),lower(?))>0 OR instr(lower(f.code),lower(?))>0)"
                args += [query, query]
            if code:
                where += " AND f.code=?"
                args.append(code)
            if status:
                where += " AND COALESCE(d.status,'open')=?"
                args.append(status)
            join = " FROM findings f LEFT JOIN decisions d ON d.run_id=f.run_id AND d.kind='finding' AND d.item_id=f.id WHERE " + where
            total = conn.execute("SELECT COUNT(*)" + join, args).fetchone()[0]
            rows = []
            for row in conn.execute("SELECT f.payload,d.status,d.owner,d.note,d.updated_at" + join + " ORDER BY f.code,f.case_id,f.id LIMIT ? OFFSET ?", [*args, limit, offset]):
                finding = json.loads(row["payload"])
                finding["review"] = {"status": row["status"] or "open", "owner": row["owner"] or "", "note": row["note"] or "", "updated_at": row["updated_at"]}
                rows.append(finding)
            return {"rows": rows, "total": total, "offset": offset, "limit": limit, "counts": self._counts(conn, run_id)}

    def cases(self, run_id, offset=0, limit=100, query="", record_type=""):
        with self.db() as conn:
            where, args = "run_id=?", [run_id]
            if query:
                where += " AND instr(lower(case_id),lower(?))>0"
                args.append(query)
            if record_type:
                where += " AND type=?"
                args.append(record_type)
            total = conn.execute("SELECT COUNT(*) FROM cases WHERE " + where, args).fetchone()[0]
            rows = []
            for value in conn.execute("SELECT payload FROM cases WHERE " + where + " ORDER BY case_id LIMIT ? OFFSET ?", [*args, limit, offset]):
                item = json.loads(value[0])
                findings = conn.execute("SELECT f.id,COALESCE(d.status,'open') AS review_status FROM findings f LEFT JOIN decisions d ON d.run_id=f.run_id AND d.kind='finding' AND d.item_id=f.id WHERE f.run_id=? AND f.case_id=?", (run_id, item["case_id"])).fetchall()
                statuses = {f["review_status"] for f in findings}
                item.update({"finding_ids": [f["id"] for f in findings], "review_status": "needs_fix" if "needs_fix" in statuses else "open" if "open" in statuses else "accepted_difference" if statuses else "matched"})
                rows.append(item)
            return {"rows": rows, "total": total, "offset": offset, "limit": limit}

    def _save_decision(self, conn, run_id, kind, item_id, status, owner, note):
        values = (run_id, kind, item_id, status, owner, note, now())
        conn.execute("INSERT INTO decisions VALUES(?,?,?,?,?,?,?) ON CONFLICT(run_id,kind,item_id) DO UPDATE SET status=excluded.status,owner=excluded.owner,note=excluded.note,updated_at=excluded.updated_at", values)
        conn.execute("INSERT INTO decision_history(run_id,kind,item_id,status,owner,note,updated_at) VALUES(?,?,?,?,?,?,?)", values)

    def _cutover_blockers(self, conn, run_id, report):
        blockers = []
        if report["input_errors"]:
            blockers.append("Resolve the input normalization errors in a new comparison.")
        if not report["public_report"]["sourceRecords"] or not report["public_report"]["targetRecords"]:
            blockers.append("Both snapshots need records from the agreed cohort.")
        required_checks = {s["id"] for s in report["settings"]["scenarios"] if s["required"] and s.get("check")}
        for result in report.get("scenario_results", []):
            if result["scenario_id"] in required_checks and result["status"] != "passed":
                blockers.append("Configured scenario " + result["scenario_id"] + " is " + result["status"] + ". Review its actual candidate cases in a corrected run.")
        counts = self._counts(conn, run_id)
        if counts["open"] or counts["needs_fix"]:
            blockers.append("Resolve or explicitly accept every comparison finding.")
        scenarios = [s for s in report["settings"]["scenarios"] if s["required"]]
        if not scenarios:
            blockers.append("Define at least one required operational scenario before the comparison.")
        decisions = self._decisions(conn, run_id)["scenario_reviews"]
        for scenario in scenarios:
            if decisions.get(scenario["id"], {}).get("status") != "passed":
                blockers.append("Complete required scenario: " + scenario["title"])
        return blockers

    def decision(self, payload, kind):
        run_id, status = payload.get("run_id"), payload.get("status")
        choices = {"finding": {"open", "needs_fix", "accepted_difference"}, "scenario": {"pending", "passed", "failed"}, "cutover": {"pending", "ready", "deferred"}}
        if status not in choices[kind]:
            raise ValueError("Choose an available decision status.")
        owner, note = str(payload.get("owner", "")).strip(), str(payload.get("note", "")).strip()
        if not owner or len(owner) > 200 or len(note) > 12000 or (status not in ("open", "pending", "needs_fix") and not note):
            raise ValueError("Name the reviewer and record a reason for the decision.")
        with self.lock, self.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            self.check_revision(conn, payload.get("revision"))
            row = conn.execute("SELECT report FROM runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise ValueError("Comparison run not found.")
            report = json.loads(row[0])
            if kind == "finding":
                item_id = payload.get("finding_id")
                if not conn.execute("SELECT id FROM findings WHERE run_id=? AND id=?", (run_id, item_id)).fetchone():
                    raise ValueError("Finding does not belong to this run.")
            elif kind == "scenario":
                item_id = payload.get("scenario_id")
                if item_id not in {s["id"] for s in report["settings"]["scenarios"]}:
                    raise ValueError("Scenario does not belong to this run.")
            else:
                item_id = "main"
                blockers = self._cutover_blockers(conn, run_id, report)
                if status == "ready" and blockers:
                    raise ValueError(" ".join(blockers))
            self._save_decision(conn, run_id, kind, item_id, status, owner, note)
            if kind != "cutover":
                current = self._decisions(conn, run_id)["cutover"]
                if current and current["status"] == "ready":
                    self._save_decision(conn, run_id, "cutover", "main", "pending", owner, "Reopened after a " + kind + " decision changed; review the retained cutover history.")
            self.bump(conn)
        return {"saved": True}

    def handoff(self, run_id):
        report = self.detail(run_id)
        with self.db() as conn:
            cases = [json.loads(r[0]) for r in conn.execute("SELECT payload FROM cases WHERE run_id=? ORDER BY case_id", (run_id,))]
        return {"format": "permitting-cutover-handoff.v1", "exported_at": now(), "run": report, "cases": cases}

    def backup(self):
        with self.lock, tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "backup.sqlite"
            with self.db() as source, sqlite3.connect(path) as target:
                source.backup(target)
            return path.read_bytes()


def restore(source, destination):
    if Path(destination).exists():
        raise ValueError("Restore into a new database path.")
    with sqlite3.connect("file:" + str(Path(source).resolve()) + "?mode=ro", uri=True) as original:
        if original.execute("PRAGMA application_id").fetchone()[0] != APP_ID or original.execute("PRAGMA user_version").fetchone()[0] != 1:
            raise ValueError("Select a supported permitting workspace backup.")
        if original.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Backup failed the SQLite consistency check.")
        Path(destination).parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(destination) as target:
            original.backup(target)


def serve(workspace, port):
    token = secrets.token_urlsafe(24)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            return

        def host_ok(self):
            return self.headers.get("Host") in ("127.0.0.1:" + str(port), "localhost:" + str(port))

        def respond(self, code, body, mime="application/json; charset=utf-8", filename=None):
            if isinstance(body, (dict, list)):
                body = canonical(body).encode()
            elif isinstance(body, str):
                body = body.encode()
            self.send_response(code)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if filename:
                self.send_header("Content-Disposition", 'attachment; filename="' + filename + '"')
            self.end_headers()
            self.wfile.write(body)

        def error(self, code, error):
            self.respond(code, {"error": str(error), "message": str(error)})

        def do_GET(self):
            if not self.host_ok():
                return self.error(403, "Use the local workspace address.")
            url = urlparse(self.path)
            parts = url.path.strip("/").split("/")
            query = {k: values[-1] for k, values in parse_qs(url.query).items()}
            try:
                if url.path in ("/", "/index.html", "/app.mjs", "/style.css"):
                    name = "index.html" if url.path in ("/", "/index.html") else url.path[1:]
                    body = (ROOT / "public" / name).read_text().replace("__SESSION_TOKEN__", token)
                    mime = "text/html" if name.endswith(".html") else "text/css" if name.endswith(".css") else "text/javascript"
                    return self.respond(200, body, mime + "; charset=utf-8")
                if url.path == "/api/state":
                    return self.respond(200, workspace.state())
                if url.path == "/api/backup":
                    return self.respond(200, workspace.backup(), "application/octet-stream", "permitting-workspace.sqlite")
                offset, limit = max(0, int(query.get("offset", 0))), min(500, max(1, int(query.get("limit", 100))))
                if len(parts) == 4 and parts[:2] == ["api", "datasets"]:
                    if parts[3] == "preview":
                        return self.respond(200, workspace.preview(parts[2], offset, limit, query.get("normalized") == "1"))
                    if parts[3] == "download":
                        data = workspace.dataset(parts[2])
                        ext = ".csv" if data["filename"].lower().endswith(".csv") else ".json"
                        return self.respond(200, data["raw"], "application/octet-stream", "original-export-" + data["id"] + ext)
                if len(parts) >= 3 and parts[:2] == ["api", "runs"]:
                    run_id = parts[2]
                    if len(parts) == 3:
                        return self.respond(200, workspace.detail(run_id, query.get("summary") == "1"))
                    if len(parts) == 4:
                        action = parts[3]
                        if action == "findings":
                            return self.respond(200, workspace.findings(run_id, offset, limit, query.get("query", ""), query.get("code", ""), query.get("status", "")))
                        if action == "cases":
                            return self.respond(200, workspace.cases(run_id, offset, limit, query.get("query", ""), query.get("type", "")))
                        if action == "handoff":
                            return self.respond(200, workspace.handoff(run_id), filename="permitting-handoff-" + run_id + ".json")
                        if action == "summary":
                            return self.respond(200, workspace.detail(run_id, True)["public_report"], filename="permitting-summary-" + run_id + ".json")
                        if action == "findings.csv":
                            report = workspace.detail(run_id)
                            output = io.StringIO(newline="")
                            writer = csv.writer(output)
                            writer.writerow(["finding_id", "case_id", "code", "review", "owner", "note", "original_context", "candidate_context"])
                            for finding in report["findings"]:
                                review = report["reviews"].get(finding["id"], {})
                                values = [finding["id"], finding["case_id"], finding["code"], review.get("status", "open"), review.get("owner", ""), review.get("note", ""), canonical(finding["source_context"]), canonical(finding["target_context"])]
                                writer.writerow(["'" + value if value.startswith(("=", "+", "-", "@", "\t", "\r")) else value for value in values])
                            return self.respond(200, output.getvalue(), "text/csv; charset=utf-8", "permitting-findings.csv")
                self.error(404, "Not found.")
            except (ValueError, TypeError, UnicodeError, csv.Error, OSError) as error:
                self.error(400, error)

        def do_POST(self):
            if not self.host_ok() or self.headers.get("X-Workspace-Token") != token:
                return self.error(403, "Reload the local workspace page before saving.")
            if self.headers.get_content_type() != "application/json":
                return self.error(415, "JSON request required.")
            try:
                length = int(self.headers.get("Content-Length", 0))
                if not 0 < length <= 40 * 1024 * 1024:
                    return self.error(413, "Request is empty or exceeds 40 MiB.")
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError("Request must be an object.")
                actions = {"/api/upload": workspace.upload, "/api/mapping": workspace.mapping, "/api/select-dataset": workspace.select_dataset, "/api/settings": workspace.settings, "/api/run": workspace.run, "/api/crosswalk": lambda p: workspace.upload(p, True), "/api/crosswalk/remove": workspace.remove_crosswalk, "/api/review": lambda p: workspace.decision(p, "finding"), "/api/scenario-review": lambda p: workspace.decision(p, "scenario"), "/api/cutover": lambda p: workspace.decision(p, "cutover")}
                action = actions.get(urlparse(self.path).path)
                if not action:
                    return self.error(404, "Not found.")
                self.respond(200, action(payload))
            except Conflict as error:
                self.respond(409, {"error": str(error), "message": str(error), "current_revision": workspace.state()["revision"]})
            except (ValueError, TypeError, UnicodeError, csv.Error, OSError, subprocess.TimeoutExpired) as error:
                self.error(400, error)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("Permitting workspace: http://127.0.0.1:" + str(port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(ROOT / "workspace.sqlite"))
    parser.add_argument("--port", type=int, default=8798)
    parser.add_argument("--restore")
    args = parser.parse_args()
    if args.restore:
        restore(args.restore, args.db)
    serve(Workspace(args.db), args.port)


if __name__ == "__main__":
    main()
