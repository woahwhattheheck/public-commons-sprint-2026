"""Per-row receiving in the original Cashiering workspace and request transaction."""
from __future__ import annotations

import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import uuid
import zlib

from . import model as m
from . import receiving_model as rm

SOURCE_FILES = (
    "cashiering/receiving.py", "cashiering/receiving_model.py",
    "cashiering/receiving_report.py", "cashiering/receiving_cli.py",
    "cashiering/RECEIVING.md", "cashiering/public/receiving.html",
    "cashiering/public/receiving.mjs", "cashiering/public/receiving.css",
)
ACTIONS = {
    "receiving-capture", "receiving-mapping", "receiving-compare", "receiving-refresh",
    "receiving-assign", "receiving-assignment-retire", "receiving-review",
    "receiving-decision", "receiving-packet",
}


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(prefix):
    return prefix + "-" + uuid.uuid4().hex


def decode(value):
    return json.loads(value)


class Receiving:
    def __init__(self, cashiering):
        self.cash = cashiering

    def initialize(self, conn):
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS cash_receiving_sources(
                id TEXT PRIMARY KEY,run_id TEXT NOT NULL,export_id TEXT NOT NULL,
                document_id TEXT NOT NULL REFERENCES cash_captures(id),
                source_key TEXT NOT NULL UNIQUE,metadata TEXT NOT NULL,
                parsed TEXT NOT NULL,created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS cash_receiving_mappings(
                source_id TEXT NOT NULL REFERENCES cash_receiving_sources(id),
                version INTEGER NOT NULL,value TEXT NOT NULL,confirmed INTEGER NOT NULL,
                issues TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(source_id,version));
            CREATE TABLE IF NOT EXISTS cash_receiving_runs(
                id TEXT PRIMARY KEY,run_id TEXT NOT NULL,export_id TEXT NOT NULL,
                body TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS cash_receiving_editions(
                id TEXT PRIMARY KEY,receiving_id TEXT NOT NULL REFERENCES cash_receiving_runs(id),
                version INTEGER NOT NULL,analysis_id TEXT NOT NULL,body TEXT NOT NULL,
                action TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(receiving_id,version));
            CREATE TABLE IF NOT EXISTS cash_receiving_analyses(
                id TEXT PRIMARY KEY,metadata TEXT NOT NULL,created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS cash_receiving_rows(
                analysis_id TEXT NOT NULL REFERENCES cash_receiving_analyses(id),
                kind TEXT NOT NULL,ordinal INTEGER NOT NULL,id TEXT NOT NULL,
                status TEXT NOT NULL,code TEXT NOT NULL,value TEXT NOT NULL,
                PRIMARY KEY(analysis_id,kind,ordinal),UNIQUE(analysis_id,kind,id));
            CREATE INDEX IF NOT EXISTS cash_receiving_row_lookup
                ON cash_receiving_rows(analysis_id,kind,id);
            CREATE INDEX IF NOT EXISTS cash_receiving_row_filter
                ON cash_receiving_rows(analysis_id,kind,status,code);
            CREATE INDEX IF NOT EXISTS cash_receiving_source_export
                ON cash_receiving_sources(run_id,export_id,created_at);
        """)

        conn.execute("INSERT OR IGNORE INTO cash_meta(key,value) VALUES('receiving_workspace_id',?)", (uid("cashiering-workspace"),))

    def _workspace_id(self, conn):
        return conn.execute("SELECT value FROM cash_meta WHERE key='receiving_workspace_id'").fetchone()[0]

    def _export(self, conn, run_id, export_id):
        body = self.cash._body(conn, run_id)
        original = next((x for x in body.get("interface_exports", []) if x["id"] == export_id), None)
        if original is None:
            raise ValueError("Select an original prepared exchange from this financial run.")
        export = copy.deepcopy(original)
        artifact = conn.execute("SELECT * FROM cash_artifacts WHERE id=?", (export["artifact_id"],)).fetchone()
        if artifact is None or artifact["kind"] != "prepared-interface":
            raise ValueError("The original prepared exchange artifact is absent.")
        meta = decode(artifact["metadata"])
        for field in ("export_id", "run_id", "profile_id", "profile_version", "edit_revision", "snapshot_hash", "row_count"):
            if meta.get(field) != export.get(field):
                raise ValueError("Prepared artifact metadata differs from its retained exchange: " + field)
        if artifact["sha256"] != export["sha256"]:
            raise ValueError("The prepared artifact and original exchange hashes differ.")
        profile = conn.execute("SELECT value FROM cash_profiles WHERE id=? AND version=?",
                               (export["profile_id"], export["profile_version"])).fetchone()
        if profile is None or decode(profile["value"]) != export["profile"]:
            raise ValueError("The exact original prepared profile edition is absent or changed.")
        edition = conn.execute(
            "SELECT * FROM cash_editions WHERE run_id=? AND edit_revision=? AND snapshot_hash=? ORDER BY created_at,id LIMIT 1",
            (run_id, export["edit_revision"], export["snapshot_hash"])).fetchone()
        if edition is None:
            raise ValueError("The original prepared financial edition is absent.")
        frozen = decode(edition["body"])
        headers, rows = rm.prepared_rows(bytes(artifact["raw"]), export)
        export["prepared_headers"] = headers
        export["financial_edition_id"] = edition["id"]
        export["current_financial_edition"] = body["run"]["edit_revision"] == export["edit_revision"] and body.get("summary", {}).get("snapshot_hash") == export["snapshot_hash"]
        return export, rows, copy.deepcopy(frozen["settings"]["scales"]), bytes(artifact["raw"])

    def _mapping(self, conn, source_id, version=None):
        query = "SELECT * FROM cash_receiving_mappings WHERE source_id=?"
        args = (source_id,)
        if version is None:
            query += " ORDER BY version DESC LIMIT 1"
        else:
            query += " AND version=?"
            args = (source_id, version)
        row = conn.execute(query, args).fetchone()
        if row is None:
            raise ValueError("The selected returned-source mapping edition is absent.")
        return {"version": row["version"], "mapping": decode(row["value"]), "confirmed": bool(row["confirmed"]),
                "issues": decode(row["issues"]), "created_at": row["created_at"]}

    def _source(self, conn, source_id, version=None, *, full=False, verify=False):
        row = conn.execute("SELECT * FROM cash_receiving_sources WHERE id=?", (source_id,)).fetchone()
        if row is None:
            raise ValueError("Original returned source not found.")
        document = self.cash._capture_row(conn, row["document_id"])
        if verify and hashlib.sha256(bytes(document["raw"])).hexdigest() != document["sha256"]:
            raise ValueError("The retained returned original no longer matches its captured bytes.")
        parsed = decode(row["parsed"])
        mapping = self._mapping(conn, source_id, version)
        result = {k: row[k] for k in ("id", "run_id", "export_id", "document_id", "created_at")}
        result.update(filename=document["filename"], sha256=document["sha256"], bytes=len(document["raw"]),
                      captured_at=document["captured_at"], metadata=decode(row["metadata"]),
                      headers=parsed["headers"], rows=len(parsed["rows"]), preview=parsed["rows"][:5],
                      mapping_version=mapping["version"], mapping=mapping["mapping"],
                      confirmed=mapping["confirmed"], mapping_issues=mapping["issues"])
        result["mapping_editions"] = [
            {"version": item["version"], "confirmed": bool(item["confirmed"]), "created_at": item["created_at"]}
            for item in conn.execute("SELECT version,confirmed,created_at FROM cash_receiving_mappings WHERE source_id=? ORDER BY version", (source_id,))]
        result["latest_mapping_version"] = result["mapping_editions"][-1]["version"]
        if full:
            result["parsed"] = parsed
        return result

    def _body(self, conn, ident):
        row = conn.execute("SELECT body FROM cash_receiving_runs WHERE id=?", (ident,)).fetchone()
        if row is None:
            raise ValueError("Saved exchange receiving comparison not found.")
        return decode(row["body"])

    def _bindings(self, conn, values, run_id, export_id):
        if not isinstance(values, list) or not 1 <= len(values) <= 1000:
            raise ValueError("Select one or more original returned sources and exact confirmed mappings.")
        bindings, keys = [], set()
        for value in values:
            if not isinstance(value, dict) or set(value) != {"source_id", "mapping_version"} or type(value["mapping_version"]) is not int:
                raise ValueError("Every selected source needs source_id and integer mapping_version.")
            source = self._source(conn, value["source_id"], value["mapping_version"])
            if source["run_id"] != run_id or source["export_id"] != export_id:
                raise ValueError("A returned source belongs to another original prepared exchange.")
            if not source["confirmed"]:
                raise ValueError("Confirm this exact mapping before comparing the returned source.")
            if source["id"] in keys:
                raise ValueError("Select each returned original once.")
            keys.add(source["id"])
            bindings.append(copy.deepcopy(value))
        return bindings

    def _analysis(self, conn, body):
        export, prepared, scales, _ = self._export(conn, body["run_id"], body["export_id"])
        if scales != body["scales"] or export["sha256"] != body["export_sha256"]:
            raise ValueError("Receiving no longer names its original prepared financial input.")
        sources = [self._source(conn, x["source_id"], x["mapping_version"], full=True, verify=True) for x in body["sources"]]
        signature = m.fingerprint({
            "export_sha256": export["sha256"], "artifact_id": export["artifact_id"], "profile": export["profile"],
            "sources": [{k: s[k] for k in ("id", "sha256", "metadata", "mapping_version", "mapping")} for s in sources],
            "assignments": [a for a in body["assignments"] if a.get("active", True)], "scales": scales,
        })
        if conn.execute("SELECT 1 FROM cash_receiving_analyses WHERE id=?", (signature,)).fetchone():
            return signature
        calculated = rm.calculate(export, prepared, sources, {**body, "reviews": {}, "decisions": []})
        rows = {kind: calculated.pop(kind) for kind in ("prepared", "observations", "findings")}
        calculated.pop("decisions", None)
        calculated.pop("review_sha256", None)
        calculated["source_bindings"] = [
            {k: s[k] for k in ("id", "document_id", "filename", "sha256", "bytes", "captured_at", "metadata", "mapping_version", "mapping", "rows")}
            for s in sources]
        calculated["export"] = export
        conn.execute("INSERT INTO cash_receiving_analyses VALUES(?,?,?)", (signature, m.canonical(calculated), now()))
        for kind, values in rows.items():
            for ordinal, value in enumerate(values, 1):
                if kind == "findings":
                    value.pop("review", None)
                status = value.get("match", "") if kind == "observations" else value.get("status", "")
                conn.execute("INSERT INTO cash_receiving_rows VALUES(?,?,?,?,?,?,?)",
                             (signature, kind, ordinal, value["id"], status, value.get("code", ""), m.canonical(value)))
        return signature

    def _metadata(self, conn, body):
        row = conn.execute("SELECT metadata FROM cash_receiving_analyses WHERE id=?", (body["analysis_id"],)).fetchone()
        if row is None:
            raise ValueError("The complete retained receiving analysis is absent.")
        metadata = decode(row["metadata"])
        reviewed = []
        open_count = 0
        for row in conn.execute("SELECT id FROM cash_receiving_rows WHERE analysis_id=? AND kind='findings' ORDER BY ordinal", (body["analysis_id"],)):
            review = copy.deepcopy(body["reviews"].get(row["id"], {"status": "open"}))
            reviewed.append({"id": row["id"], "review": review})
            open_count += review.get("status") in ("open", "investigating")
        review_sha = m.fingerprint({"comparison_sha256": metadata["comparison_sha256"], "reviews": reviewed})
        metadata["review_sha256"] = review_sha
        metadata["counts"]["open_findings"] = open_count
        decisions = copy.deepcopy(body["decisions"])
        for decision in decisions:
            decision["current"] = decision["input_sha256"] == metadata["input_sha256"] and decision["review_sha256"] == review_sha
        original_body = self.cash._body(conn, body["run_id"])
        metadata["export"]["current_financial_edition"] = original_body["run"]["edit_revision"] == metadata["export"]["edit_revision"] and original_body.get("summary", {}).get("snapshot_hash") == metadata["export"]["snapshot_hash"]
        return {"schema": "berkeley.cashiering.receiving.v1", "id": body["id"], "run_id": body["run_id"],
                "export_id": body["export_id"], "label": body["label"], "version": body["version"], "edition_id": body["edition_id"],
                "created_at": body["created_at"], "updated_at": body["updated_at"], "note": body["note"],
                "scales": body["scales"], "analysis_id": body["analysis_id"], "decisions": decisions,
                "assignments": copy.deepcopy(body["assignments"]), "packets": copy.deepcopy(body["packets"]),
                "workspace_revision": self.cash._revision(conn), **metadata}

    def _row(self, conn, body, kind, ident):
        if kind not in ("prepared", "observations", "findings"):
            raise ValueError("Unknown receiving row family.")
        row = conn.execute("SELECT value FROM cash_receiving_rows WHERE analysis_id=? AND kind=? AND id=?",
                           (body["analysis_id"], kind, ident)).fetchone()
        if row is None:
            raise ValueError("This exact original row is absent from the selected receiving edition.")
        value = decode(row["value"])
        if kind == "findings":
            value["review"] = copy.deepcopy(body["reviews"].get(ident, {"status": "open"}))
        return value

    def _page(self, conn, body, kind, query):
        if kind not in ("prepared", "observations", "findings"):
            raise ValueError("Unknown receiving row family.")
        offset = max(0, int(query.get("offset", 0)))
        limit = min(500, max(1, int(query.get("limit", 100))))
        where = ["analysis_id=?", "kind=?"]
        args = [body["analysis_id"], kind]
        if query.get("query"):
            where.append("instr(lower(value),?)>0")
            args.append(m.text(str(query["query"]), "search", maximum=1000).lower())
        for key in ("status", "code"):
            if query.get(key):
                where.append(key + "=?")
                args.append(str(query[key]))
        clause = " AND ".join(where)
        review_status = query.get("review_status")
        if review_status is not None and (kind != "findings" or review_status not in rm.REVIEW_STATES):
            raise ValueError("Choose an exact finding review state.")
        if review_status is not None:
            total, rows = 0, []
            for row in conn.execute("SELECT id,value FROM cash_receiving_rows WHERE " + clause + " ORDER BY ordinal", args):
                review = body["reviews"].get(row["id"], {"status": "open"})
                if review.get("status") == review_status:
                    if offset <= total < offset + limit:
                        rows.append({**decode(row["value"]), "review": copy.deepcopy(review)})
                    total += 1
        else:
            total = conn.execute("SELECT COUNT(*) FROM cash_receiving_rows WHERE " + clause, args).fetchone()[0]
            rows = []
            for row in conn.execute("SELECT id,value FROM cash_receiving_rows WHERE " + clause + " ORDER BY ordinal LIMIT ? OFFSET ?", (*args, limit, offset)):
                value = decode(row["value"])
                if kind == "findings":
                    value["review"] = copy.deepcopy(body["reviews"].get(row["id"], {"status": "open"}))
                rows.append(value)
        return {"id": body["id"], "version": body["version"], "analysis_id": body["analysis_id"],
                "kind": kind, "total": total, "offset": offset, "limit": limit, "rows": rows}

    def _complete(self, conn, body):
        result = self._metadata(conn, body)
        for kind in ("prepared", "observations", "findings"):
            values = []
            for row in conn.execute("SELECT id,value FROM cash_receiving_rows WHERE analysis_id=? AND kind=? ORDER BY ordinal",
                                    (body["analysis_id"], kind)):
                value = decode(row["value"])
                if kind == "findings":
                    value["review"] = copy.deepcopy(body["reviews"].get(row["id"], {"status": "open"}))
                values.append(value)
            result[kind] = values
        result["history"] = [decode(r["body"]) for r in conn.execute(
            "SELECT body FROM cash_receiving_editions WHERE receiving_id=? AND version<=? ORDER BY version", (body["id"], body["version"]))]
        return result

    def _save(self, conn, body, action, actor, note, *, recalculate=True):
        if recalculate or not body.get("analysis_id"):
            body["analysis_id"] = self._analysis(conn, body)
        body["version"] += 1
        body["updated_at"] = now()
        edition = uid("receiving-edition")
        body["edition_id"] = edition
        conn.execute("INSERT INTO cash_receiving_runs VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at",
                     (body["id"], body["run_id"], body["export_id"], m.canonical(body), body["created_at"], body["updated_at"]))
        conn.execute("INSERT INTO cash_receiving_editions VALUES(?,?,?,?,?,?,?)",
                     (edition, body["id"], body["version"], body["analysis_id"], m.canonical(body), action, body["updated_at"]))
        self.cash._event(conn, action, actor, {"receiving_id": body["id"], "export_id": body["export_id"],
                         "receiving_version": body["version"], "edition_id": edition, "analysis_id": body["analysis_id"],
                         "note": note}, body["run_id"])
        return {"receiving_id": body["id"], "version": body["version"], "edition_id": edition,
                "analysis_id": body["analysis_id"]}

    def _metadata_input(self, p):
        value = p.get("metadata")
        allowed = {"source_system", "report_family", "native_reference", "observed_at", "mode", "complete", "note"}
        if not isinstance(value, dict) or set(value) != allowed:
            raise ValueError("Describe the returned source system, report, native reference, original observation time, mode, complete and note.")
        value = copy.deepcopy(value)
        for key in ("source_system", "report_family", "native_reference"):
            m.text(value[key], key, required=True, maximum=1000)
        value["observed_at"] = m.instant(value["observed_at"])
        if value["mode"] not in ("snapshot", "events") or type(value["complete"]) is not bool:
            raise ValueError("Declare an original snapshot or event stream and its actual complete-report observation.")
        m.text(value["note"], "returned source scope", required=True)
        return value

    def dispatch(self, conn, action, p):
        if action not in ACTIONS:
            raise ValueError("Unknown receiving operation.")
        if p.get("receiving_workspace_id") != self._workspace_id(conn):
            raise self.cash.conflict("The retained request names a different cashiering workspace.")
        actor, note = self.cash._actor(p), self.cash._note(p)
        if action == "receiving-capture":
            export, prepared, scales, _ = self._export(conn, p.get("run_id"), p.get("export_id"))
            metadata = self._metadata_input(p)
            has_document = isinstance(p.get("document_id"), str) and bool(p["document_id"])
            if has_document == ("content_base64" in p):
                raise ValueError("Choose one retained original document or supply a complete new original file.")
            if has_document:
                original = self.cash._capture_row(conn, p["document_id"])
            else:
                coverage = {"source_system": metadata["source_system"], "report_family": metadata["report_family"],
                            "data_mode": "snapshot" if metadata["mode"] == "snapshot" else "event_stream", "note": metadata["note"]}
                captured, _ = self.cash._dispatch(conn, "upload", {
                    "kind": "document", "filename": p.get("filename"), "content_base64": p.get("content_base64"),
                    "captured_at": p.get("captured_at"), "coverage": coverage, "owner": actor})
                original = self.cash._capture_row(conn, captured["capture"]["id"])
            raw = bytes(original["raw"])
            if hashlib.sha256(raw).hexdigest() != original["sha256"]:
                raise ValueError("The original returned bytes no longer match their capture.")
            parsed = m.parse_capture(raw, original["filename"])
            key = m.fingerprint({"run_id": p["run_id"], "export_id": export["id"], "sha256": original["sha256"], "metadata": metadata})
            prior = conn.execute("SELECT id FROM cash_receiving_sources WHERE source_key=?", (key,)).fetchone()
            if prior:
                self.cash._event(conn, action, actor, {"source_id": prior["id"], "reused": True, "note": note}, p["run_id"])
                return {"source": self._source(conn, prior["id"]), "reused": True}, None
            ident, at = uid("return-source"), now()
            conn.execute("INSERT INTO cash_receiving_sources VALUES(?,?,?,?,?,?,?,?)",
                         (ident, p["run_id"], export["id"], original["id"], key, m.canonical(metadata), m.canonical(parsed), at))
            mapping = copy.deepcopy(rm.DEFAULT_MAPPING)
            common = [x for x in export["prepared_headers"] if x in parsed["headers"]]
            preferred = next((x for x in ("record_key", "transaction_id", "record_id") if x in common), None)
            if preferred:
                mapping["keys"] = [{"prepared": preferred, "returned": preferred}]
            if "status" in parsed["headers"]:
                mapping["status_column"] = "status"
            mapping, issues = rm.validate_mapping(mapping, parsed["headers"], export["prepared_headers"])
            conn.execute("INSERT INTO cash_receiving_mappings VALUES(?,?,?,?,?,?)",
                         (ident, 1, m.canonical(mapping), 0, m.canonical(issues), at))
            self.cash._event(conn, action, actor, {"source_id": ident, "document_id": original["id"],
                             "export_id": export["id"], "sha256": original["sha256"], "note": note}, p["run_id"])
            return {"source": self._source(conn, ident), "reused": False}, None
        if action == "receiving-mapping":
            source = self._source(conn, p.get("source_id"))
            export, _, _, _ = self._export(conn, source["run_id"], source["export_id"])
            if type(p.get("confirmed")) is not bool:
                raise ValueError("Save a draft or confirm this receiving interpretation explicitly.")
            mapping, issues = rm.validate_mapping(p.get("mapping"), source["headers"], export["prepared_headers"], confirmed=p["confirmed"])
            if type(p.get("mapping_version")) is not int or p["mapping_version"] != source["mapping_version"]:
                raise self.cash.conflict("This returned-source mapping changed. Reopen its latest edition before saving your interpretation.")
            version = source["mapping_version"] + 1
            conn.execute("INSERT INTO cash_receiving_mappings VALUES(?,?,?,?,?,?)",
                         (source["id"], version, m.canonical(mapping), int(p["confirmed"]), m.canonical(issues), now()))
            self.cash._event(conn, action, actor, {"source_id": source["id"], "mapping_version": version,
                             "confirmed": p["confirmed"], "note": note}, source["run_id"])
            return {"source": self._source(conn, source["id"])}, None
        if action == "receiving-compare":
            export, _, scales, _ = self._export(conn, p.get("run_id"), p.get("export_id"))
            sources = self._bindings(conn, p.get("sources"), p["run_id"], p["export_id"])
            body = {"id": uid("receiving"), "version": 0, "run_id": p["run_id"], "export_id": p["export_id"],
                    "export_sha256": export["sha256"], "scales": scales,
                    "label": m.text(p.get("label"), "receiving label", required=True, maximum=300),
                    "sources": sources, "assignments": [], "reviews": {}, "decisions": [], "packets": [],
                    "created_at": now(), "note": note}
            return self._save(conn, body, action, actor, note), None
        body = self._body(conn, p.get("receiving_id"))
        if type(p.get("receiving_version")) is not int or p["receiving_version"] != body["version"]:
            raise self.cash.conflict("This receiving edition changed. Reopen its current version before saving the retained edit.")
        recalculate = False
        if action == "receiving-refresh":
            body["sources"] = self._bindings(conn, p.get("sources"), body["run_id"], body["export_id"])
            if "label" in p:
                body["label"] = m.text(p["label"], "receiving label", required=True, maximum=300)
            body["note"] = note
            recalculate = True
        elif action == "receiving-assign":
            observation = self._row(conn, body, "observations", p.get("observation_id"))
            excluded = p.get("excluded", False)
            if type(excluded) is not bool:
                raise ValueError("Declare whether the original returned row is outside this exchange.")
            prepared = None if excluded else self._row(conn, body, "prepared", p.get("prepared_id"))
            for assignment in body["assignments"]:
                if assignment["observation_id"] == observation["id"] and assignment.get("active", True):
                    assignment.update(active=False, retired_at=now(), retired_by=actor, retirement_note=note)
            body["assignments"].append({"id": uid("receiving-assignment"), "observation_id": observation["id"],
                "observation_sha256": observation["sha256"], "prepared_id": None if excluded else prepared["id"],
                "prepared_sha256": None if excluded else prepared["sha256"], "excluded": excluded,
                "owner": actor, "note": note, "created_at": now(), "active": True})
            recalculate = True
        elif action == "receiving-assignment-retire":
            assignment = next((a for a in body["assignments"] if a["id"] == p.get("assignment_id") and a.get("active", True)), None)
            if assignment is None:
                raise ValueError("Select an active original row assignment.")
            assignment.update(active=False, retired_at=now(), retired_by=actor, retirement_note=note)
            recalculate = True
        elif action == "receiving-review":
            finding = self._row(conn, body, "findings", p.get("finding_id"))
            if p.get("status") not in rm.REVIEW_STATES:
                raise ValueError("Choose an original receiving finding review state.")
            body["reviews"][finding["id"]] = {"status": p["status"], "owner": actor, "note": note, "updated_at": now()}
        elif action == "receiving-decision":
            if p.get("status") not in rm.DECISIONS:
                raise ValueError("Record reviewed, needs_correction or in_progress against this exact receiving edition.")
            detail = self._metadata(conn, body)
            body["decisions"].append({"id": uid("receiving-decision"), "status": p["status"], "owner": actor,
                "statement": m.text(p.get("statement"), "review statement", required=True), "note": note,
                "created_at": now(), "input_sha256": detail["input_sha256"],
                "review_sha256": detail["review_sha256"], "comparison_sha256": detail["comparison_sha256"],
                "receiving_version": body["version"], "counts": detail["counts"]})
        elif action == "receiving-packet":
            from .receiving_report import build_packet
            label = m.text(p.get("label"), "receiving handoff label", required=True, maximum=300)
            detail = self._complete(conn, body)
            detail["handoff"] = {"label": label, "owner": actor, "note": note, "created_at": now()}
            export, _, _, prepared_raw = self._export(conn, body["run_id"], body["export_id"])
            originals = []
            history_bindings = {(b["source_id"], b["mapping_version"]) for edition in [body, *detail["history"]] for b in edition["sources"]}
            for source_id, version in sorted(history_bindings):
                source = self._source(conn, source_id, version, verify=True)
                originals.append({**source, "raw": self.cash._document(conn, source["document_id"])["raw"]})
            raw, manifest = build_packet(detail, prepared_raw, originals, self.cash.source_files)
            ident = uid("receiving-packet")
            artifact = self.cash._artifact(conn, "receiving-packet", ident + ".zip", raw,
                {"receiving_id": body["id"], "receiving_version": body["version"], "export_id": body["export_id"],
                 "input_sha256": detail["input_sha256"], "comparison_sha256": detail["comparison_sha256"],
                 "review_sha256": detail["review_sha256"], "manifest": manifest})
            body["packets"].append({"id": ident, "artifact_id": artifact["id"], "label": label,
                "sha256": artifact["sha256"], "bytes": artifact["bytes"], "owner": actor, "note": note,
                "created_at": now(), "receiving_version": body["version"], "input_sha256": detail["input_sha256"],
                "review_sha256": detail["review_sha256"], "manifest": manifest})
            result = self._save(conn, body, action, actor, note, recalculate=False)
            return {**result, "packet": copy.deepcopy(body["packets"][-1])}, None
        return self._save(conn, body, action, actor, note, recalculate=recalculate), None

    def state(self, conn, run_id=None, export_id=None):
        params, where = [], []
        if run_id:
            where.append("run_id=?")
            params.append(run_id)
        if export_id:
            where.append("export_id=?")
            params.append(export_id)
        clause = " WHERE " + " AND ".join(where) if where else ""
        sources = [self._source(conn, row["id"]) for row in conn.execute("SELECT id FROM cash_receiving_sources" + clause + " ORDER BY created_at DESC,id", params)]
        runs = []
        for row in conn.execute("SELECT body FROM cash_receiving_runs" + clause + " ORDER BY updated_at DESC,id", params):
            body = decode(row["body"])
            detail = self._metadata(conn, body)
            runs.append({k: detail[k] for k in ("id", "run_id", "export_id", "label", "version", "created_at", "updated_at",
                        "input_sha256", "comparison_sha256", "review_sha256", "counts", "decisions")})
        exports = []
        for row in conn.execute("SELECT body FROM cash_runs" + (" WHERE id=?" if run_id else ""), (run_id,) if run_id else ()):
            body = decode(row["body"])
            for export in body.get("interface_exports", []):
                if export_id and export["id"] != export_id:
                    continue
                exports.append({**{k: export[k] for k in ("id", "label", "artifact_id", "sha256", "bytes", "row_count",
                                      "profile", "edit_revision", "snapshot_hash", "created_at")},
                                "run_id": body["run"]["id"], "run_label": body["run"]["label"]})
        return {"revision": self.cash._revision(conn), "workspace_id": self._workspace_id(conn), "sources": sources, "runs": runs, "exports": exports,
                "catalog": {"statuses": list(rm.STATUSES), "review_states": list(rm.REVIEW_STATES),
                            "decisions": list(rm.DECISIONS), "mapping": copy.deepcopy(rm.DEFAULT_MAPPING)}}

    def attach_packet(self, conn, run_id, detail, documents):
        """Join complete selected receiving editions to the existing financial packet."""
        entries, existing = [], {x["id"] for x in documents}
        for row in conn.execute("SELECT body FROM cash_receiving_runs WHERE run_id=? ORDER BY created_at,id", (run_id,)):
            body = decode(row["body"])
            entry = self._complete(conn, body)
            entries.append(entry)
            bindings = {(b["source_id"], b["mapping_version"]) for edition in [body, *entry["history"]] for b in edition["sources"]}
            for source_id, version in sorted(bindings):
                source = self._source(conn, source_id, version, verify=True)
                if source["document_id"] not in existing:
                    documents.append(self.cash._document(conn, source["document_id"]))
                    existing.add(source["document_id"])
        detail["row_receiving"] = entries

    def read(self, conn, parts, query):
        if not parts or parts == ["state"]:
            return self.state(conn, query.get("run_id"), query.get("export_id")), "application/json; charset=utf-8", None
        if parts[0] == "requests" and len(parts) == 2:
            row = conn.execute("SELECT id,request_sha,response FROM cash_requests WHERE id=?", (parts[1],)).fetchone()
            return {"workspace_id": self._workspace_id(conn), "request_id": parts[1], "found": row is not None,
                    "request_sha256": row["request_sha"] if row else None,
                    "response": decode(zlib.decompress(row["response"]).decode("utf-8")) if row else None}, "application/json; charset=utf-8", None
        if parts[0] == "sources" and len(parts) in (2, 3):
            version = int(query["mapping_version"]) if query.get("mapping_version") else None
            source = self._source(conn, parts[1], version, full=len(parts) == 3)
            if len(parts) == 2:
                source["mapping_history"] = [self._mapping(conn, source["id"], row["version"]) for row in conn.execute(
                    "SELECT version FROM cash_receiving_mappings WHERE source_id=? ORDER BY version", (source["id"],))]
                return source, "application/json; charset=utf-8", None
            if parts[2] == "values":
                column = query.get("column")
                if column not in source["headers"]:
                    raise ValueError("Select an original returned column.")
                counts = {}
                for row in source["parsed"]["rows"]:
                    value = row["values"].get(column)
                    key = m.canonical(value)
                    entry = counts.setdefault(key, {"value": value, "count": 0})
                    entry["count"] += 1
                values = sorted(counts.values(), key=lambda item: (-item["count"], m.canonical(item["value"])))
                offset, limit = max(0, int(query.get("offset", 0))), min(500, max(1, int(query.get("limit", 100))))
                return {"source_id": source["id"], "sha256": source["sha256"], "column": column,
                        "offset": offset, "limit": limit, "total": len(values), "values": values[offset:offset + limit]}, "application/json; charset=utf-8", None
            if parts[2] == "rows":
                offset, limit = max(0, int(query.get("offset", 0))), min(500, max(1, int(query.get("limit", 100))))
                rows = source["parsed"]["rows"]
                return {"source_id": source["id"], "sha256": source["sha256"], "offset": offset, "limit": limit,
                        "total": len(rows), "rows": rows[offset:offset + limit]}, "application/json; charset=utf-8", None
        if parts[0] == "exports" and len(parts) == 2:
            export, rows, scales, _ = self._export(conn, query.get("run_id"), parts[1])
            offset, limit = max(0, int(query.get("offset", 0))), min(500, max(1, int(query.get("limit", 100))))
            return {"export": export, "scales": scales, "offset": offset, "limit": limit, "total": len(rows),
                    "rows": rows[offset:offset + limit]}, "application/json; charset=utf-8", None
        if parts[0] in ("runs", "editions") and len(parts) in (2, 3, 4):
            if parts[0] == "editions":
                edition = conn.execute("SELECT body FROM cash_receiving_editions WHERE id=?", (parts[1],)).fetchone()
                if edition is None:
                    raise ValueError("Original receiving edition not found.")
                body = decode(edition["body"])
            else:
                body = self._body(conn, parts[1])
            if len(parts) == 2:
                return self._metadata(conn, body), "application/json; charset=utf-8", None
            kind = parts[2]
            if kind in ("prepared", "observations", "findings"):
                value = self._row(conn, body, kind, parts[3]) if len(parts) == 4 else self._page(conn, body, kind, query)
                return value, "application/json; charset=utf-8", None
            if kind == "history":
                rows = [dict(x) for x in conn.execute(
                    "SELECT id,version,analysis_id,action,created_at FROM cash_receiving_editions WHERE receiving_id=? ORDER BY version DESC",
                    (body["id"],))]
                return {"receiving_id": body["id"], "rows": rows}, "application/json; charset=utf-8", None
            if kind == "json":
                return self._complete(conn, body), "application/json; charset=utf-8", body["id"] + "-v" + str(body["version"]) + ".json"
            if kind == "report":
                from .receiving_report import render_report
                return render_report(self._complete(conn, body)), "text/html; charset=utf-8", None
            if kind.endswith(".csv") and kind[:-4] in ("prepared", "observations", "findings"):
                from .receiving_report import rows_csv
                selected = kind[:-4]
                return rows_csv(self._complete(conn, body), selected), "text/csv; charset=utf-8", body["id"] + "-" + kind
        raise ValueError("Receiving resource not found.")
