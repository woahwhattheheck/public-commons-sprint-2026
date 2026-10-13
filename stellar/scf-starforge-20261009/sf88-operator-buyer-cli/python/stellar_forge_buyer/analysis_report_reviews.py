"""Named-recipient editorial returns on the original Analysis report engine."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from .errors import StateError
from .analysis_reports import _id, _name, _hash, _text, _revision

ISSUE_SCHEMA = "stellar-forge.report-editorial-issue.v1"
RETURN_SCHEMA = "stellar-forge.report-editorial-return.v1"
WORKING_SCHEMA = "stellar-forge.report-editorial-working.v1"
MAX_SOURCE = 128 * 1024 * 1024
MAX_RETURN = 16 * 1024 * 1024


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def fail(code):
    raise StateError("REPORT_REVIEW_" + code)


def unpack(row):
    if row is None:
        fail("NOT_FOUND")
    raw = row["record"].encode("utf-8")
    if hashlib.sha256(raw).hexdigest() != row["sha256"]:
        fail("RETAINED_RECORD_CHANGED")
    return json.loads(raw)


def text(value, label, limit, required=False):
    return _text(value, label, limit, required=required)


def editorial(definition):
    return {"title": definition["title"], "introduction": definition.get("introduction", ""),
            "sections": [{"title": s["title"], "note": s.get("note", "")} for s in definition["sections"]]}


def query_key(section):
    return sha({k: section.get(k) for k in ("query_name", "query_revision", "parameters_text", "query_sha256")})


def fields(value):
    result = {"title": value["title"], "introduction": value["introduction"]}
    for index, section in enumerate(value["sections"]):
        result[f"sections/{index}/title"] = section["title"]
        result[f"sections/{index}/note"] = section["note"]
    return result


class ReportReviews:
    """A synchronous component owned by the existing AnalysisWorkspace lease.

    All issue, return and apply history is stored in its original SQLite file.
    The original reports.save remains the sole report-definition writer.
    No second AnalysisWorkspace, SQL engine, publication or source owner exists.
    """
    def __init__(self, workspace):
        self.workspace = workspace
        self.database = workspace.database
        self.reports = workspace.reports
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("CREATE TABLE IF NOT EXISTS sf_report_review_issues(sequence INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,request_sha256 TEXT NOT NULL,record TEXT NOT NULL,sha256 TEXT NOT NULL,source TEXT NOT NULL,source_sha256 TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS sf_report_review_returns(sequence INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,issue_id TEXT NOT NULL,request_sha256 TEXT NOT NULL,record TEXT NOT NULL,sha256 TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS sf_report_review_applies(sequence INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,return_id TEXT NOT NULL,request_sha256 TEXT NOT NULL,record TEXT NOT NULL,sha256 TEXT NOT NULL)")
            db.commit()

    @staticmethod
    def _store(db, table, identity, record):
        raw = encoded(record).decode("utf-8")
        db.execute(f"UPDATE {table} SET record=?,sha256=? WHERE id=?",
                   (raw, hashlib.sha256(raw.encode("utf-8")).hexdigest(), identity))

    def _issue(self, db, identity, full=False):
        _id(identity)
        columns = "*" if full else "record,sha256"
        row = db.execute(f"SELECT {columns} FROM sf_report_review_issues WHERE id=?", (identity,)).fetchone()
        record = unpack(row)
        if record["workspace_id"] != self.workspace.identity:
            fail("WORKSPACE_CHANGED")
        if full:
            raw = row["source"].encode("utf-8")
            if hashlib.sha256(raw).hexdigest() != row["source_sha256"] or row["source_sha256"] != record["source_sha256"]:
                fail("RETAINED_SOURCE_CHANGED")
            return {"issue": record, "issue_sha256": row["sha256"], "source_json": raw.decode("utf-8")}
        return {"issue": record, "issue_sha256": row["sha256"]}

    def issue(self, request):
        if set(request) - {"id", "job_id", "result_sha256", "recipient", "instructions"}:
            fail("ISSUE_FIELDS_INVALID")
        normalized = {"id": _id(request.get("id")), "job_id": _id(request.get("job_id")),
                      "result_sha256": _hash(request.get("result_sha256")),
                      "recipient": text(request.get("recipient"), "RECIPIENT", 1000, True),
                      "instructions": text(request.get("instructions", ""), "INSTRUCTIONS", 16000)}
        request_sha = sha(normalized)
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            old = db.execute("SELECT request_sha256 FROM sf_report_review_issues WHERE id=?", (normalized["id"],)).fetchone()
            if old:
                if old[0] != request_sha:
                    fail("REQUEST_ID_REUSED")
                return self._issue(db, normalized["id"])
            report = self.reports._report(db, normalized["job_id"])
            if report["result_sha256"] != normalized["result_sha256"]:
                fail("REPORT_CHANGED")
            tables = []
            size = len(encoded(report))
            for section in report["sections"]:
                rows = []
                for values in self.reports._rows(db, report, section):
                    size += len(encoded(values)) + 1
                    if size > MAX_SOURCE:
                        fail("COMPLETE_SOURCE_TOO_LARGE")
                    rows.append(values)
                tables.append({"ordinal": section["ordinal"], "columns": section["columns"], "rows": rows})
            source = {"report": report, "tables": tables}
            raw_source = encoded(source)
            if len(raw_source) > MAX_SOURCE:
                fail("COMPLETE_SOURCE_TOO_LARGE")
            source_sha = hashlib.sha256(raw_source).hexdigest()
        record = {"schema": ISSUE_SCHEMA, **normalized, "workspace_id": self.workspace.identity,
                  "report_name": report["definition"]["name"], "definition": report["definition"],
                  "source_sha256": source_sha, "source_bytes": len(raw_source), "issued_at": now()}
        raw = encoded(record)
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT request_sha256 FROM sf_report_review_issues WHERE id=?", (normalized["id"],)).fetchone()
            if old:
                if old[0] != request_sha:
                    fail("REQUEST_ID_REUSED")
            else:
                db.execute("INSERT INTO sf_report_review_issues(id,request_sha256,record,sha256,source,source_sha256) VALUES(?,?,?,?,?,?)",
                           (record["id"], request_sha, raw.decode(), hashlib.sha256(raw).hexdigest(), raw_source.decode(), source_sha))
            result = self._issue(db, normalized["id"])
            db.commit()
            return result

    def package(self, identity):
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            return self._issue(db, identity, full=True)

    def history(self, *, before=None, limit=25):
        if type(limit) is not int or not 1 <= limit <= 100 or before is not None and (type(before) is not int or before < 1):
            fail("PAGE_INVALID")
        with self.database._connection(readonly=True) as db:
            # Do not load each issue's complete typed tables to list its title.
            rows = db.execute("SELECT sequence,id,record,sha256 FROM sf_report_review_issues WHERE (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?",
                              (before, before, limit + 1))
            values, more = [], False
            for row in rows:
                if len(values) == limit:
                    more = True
                    break
                issue = unpack(row)
                summary = {key: issue[key] for key in ("id", "workspace_id", "recipient", "report_name", "issued_at", "source_sha256")}
                summary["definition"] = {key: issue["definition"][key] for key in ("title", "revision")}
                values.append({"sequence": row["sequence"], "issue": summary, "issue_sha256": row["sha256"]})
            return {"issues": values, "next_before": values[-1]["sequence"] if more else None}

    def detail(self, identity, *, returns_before=None, applies_before=None, limit=25):
        if type(limit) is not int or not 1 <= limit <= 100 or any(x is not None and (type(x) is not int or x < 1) for x in (returns_before, applies_before)):
            fail("PAGE_INVALID")
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            result = self._issue(db, identity)
            result["returns"], result["applies"] = [], []
            result["next_returns_before"] = result["next_applies_before"] = None
            rows = db.execute("SELECT sequence,id,record,sha256 FROM sf_report_review_returns WHERE issue_id=? AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?",
                              (identity, returns_before, returns_before, limit + 1))
            for row in rows:
                if len(result["returns"]) == limit:
                    result["next_returns_before"] = result["returns"][-1]["sequence"]
                    break
                record = unpack(row)
                result["returns"].append({"sequence": row["sequence"], "id": row["id"], "returned_at": record["received_at"],
                                          "reviewer": record["return"]["reviewer"], "sha256": row["sha256"]})
            rows = db.execute("SELECT a.sequence,a.id,a.return_id,a.record,a.sha256 FROM sf_report_review_applies a JOIN sf_report_review_returns r ON r.id=a.return_id WHERE r.issue_id=? AND (? IS NULL OR a.sequence<?) ORDER BY a.sequence DESC LIMIT ?",
                              (identity, applies_before, applies_before, limit + 1))
            for row in rows:
                if len(result["applies"]) == limit:
                    result["next_applies_before"] = result["applies"][-1]["sequence"]
                    break
                record = unpack(row)
                result["applies"].append({"sequence": row["sequence"], "id": row["id"], "return_id": row["return_id"],
                                         "status": record["status"], "created_at": record["created_at"],
                                         "definition_revision": record.get("definition", {}).get("revision"),
                                         "sha256": row["sha256"]})
            return result

    def returned(self, identity):
        with self.database._connection(readonly=True) as db:
            return unpack(db.execute("SELECT * FROM sf_report_review_returns WHERE id=?", (_id(identity),)).fetchone())

    def receive(self, value):
        if not isinstance(value, dict) or set(value) != {"schema", "id", "workspace_id", "issue_id", "issue_sha256", "source_sha256", "reviewer", "proposed", "notes", "editions"}:
            fail("RETURN_FIELDS_INVALID")
        if value["schema"] != RETURN_SCHEMA or len(encoded(value)) > MAX_RETURN:
            fail("RETURN_FORMAT_OR_SIZE_INVALID")
        identity = _id(value["id"])
        _id(value["issue_id"]); _hash(value["issue_sha256"]); _hash(value["source_sha256"])
        text(value["reviewer"], "REVIEWER", 1000, True)
        text(value["notes"], "RETURN_NOTE", 16000)
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            bound = self._issue(db, value["issue_id"])
            issue = bound["issue"]
            if value["workspace_id"] != issue["workspace_id"] or value["issue_sha256"] != bound["issue_sha256"] or value["source_sha256"] != issue["source_sha256"]:
                fail("RETURN_SOURCE_CHANGED")
            def validate(proposed):
                if not isinstance(proposed, dict) or set(proposed) != {"title", "introduction", "sections"}:
                    fail("EDITORIAL_FIELDS_INVALID")
                text(proposed["title"], "TITLE", 300, True); text(proposed["introduction"], "INTRODUCTION", 16000)
                if not isinstance(proposed["sections"], list) or len(proposed["sections"]) != len(issue["definition"]["sections"]):
                    fail("EDITORIAL_SECTIONS_CHANGED")
                for section in proposed["sections"]:
                    if not isinstance(section, dict) or set(section) != {"title", "note"}:
                        fail("EDITORIAL_FIELDS_INVALID")
                    text(section["title"], "SECTION_TITLE", 300, True); text(section["note"], "SECTION_NOTE", 8000)
            validate(value["proposed"])
            if not isinstance(value["editions"], list):
                fail("EDITION_HISTORY_INVALID")
            previous = None
            for edition in value["editions"]:
                if not isinstance(edition, dict) or set(edition) != {"id", "previous_sha256", "saved_at", "reviewer", "proposed", "notes", "sha256"}:
                    fail("EDITION_HISTORY_INVALID")
                _id(edition["id"]); text(edition["saved_at"], "EDITION_TIME", 100, True)
                text(edition["reviewer"], "REVIEWER", 1000, True); text(edition["notes"], "RETURN_NOTE", 16000)
                validate(edition["proposed"])
                if edition["previous_sha256"] != previous or sha({k:v for k,v in edition.items() if k != "sha256"}) != edition["sha256"]:
                    fail("EDITION_HISTORY_CHANGED")
                previous = edition["sha256"]
            request_sha = sha(value)
            old = db.execute("SELECT * FROM sf_report_review_returns WHERE id=?", (identity,)).fetchone()
            if old:
                if old["request_sha256"] != request_sha:
                    fail("REQUEST_ID_REUSED")
                return unpack(old)
            record = {"id": identity, "issue_id": issue["id"], "received_at": now(), "return": value, "return_sha256": request_sha}
            raw = encoded(record)
            db.execute("INSERT INTO sf_report_review_returns(id,issue_id,request_sha256,record,sha256) VALUES(?,?,?,?,?)",
                       (identity, issue["id"], request_sha, raw.decode(), hashlib.sha256(raw).hexdigest()))
            db.commit()
            return record

    def _preview(self, db, return_id, mapping=None):
        returned = unpack(db.execute("SELECT * FROM sf_report_review_returns WHERE id=?", (_id(return_id),)).fetchone())
        issued = self._issue(db, returned["issue_id"])["issue"]
        row = db.execute("SELECT * FROM sf_analysis_reports WHERE name=?", (issued["report_name"],)).fetchone()
        if row is None:
            fail("CURRENT_REPORT_NOT_FOUND")
        raw = row["record"].encode()
        if hashlib.sha256(raw).hexdigest() != row["sha256"]:
            fail("CURRENT_REPORT_CHANGED")
        current = json.loads(raw)
        base_keys = [query_key(s) for s in issued["definition"]["sections"]]
        current_keys = [query_key(s) for s in current["sections"]]
        if mapping is None:
            mapping = (list(range(len(base_keys))) if base_keys == current_keys else
                       [current_keys.index(key) if base_keys.count(key) == current_keys.count(key) == 1 else None for key in base_keys])
        if not isinstance(mapping, list) or len(mapping) != len(base_keys) or any(i is not None and (type(i) is not int or not 0 <= i < len(current_keys)) for i in mapping):
            fail("SECTION_MAPPING_INVALID")
        mapped = [i for i in mapping if i is not None]
        if len(mapped) != len(set(mapped)):
            fail("SECTION_MAPPING_MUST_BE_UNIQUE")
        baseline = fields(editorial(issued["definition"])); incoming = fields(returned["return"]["proposed"]); authored = fields(editorial(current))
        rows = []
        for key, original in baseline.items():
            target = key
            if key.startswith("sections/"):
                _, ordinal, kind = key.split("/")
                target = f"sections/{mapping[int(ordinal)]}/{kind}" if mapping[int(ordinal)] is not None else None
            present = authored.get(target) if target else None
            proposed = incoming[key]
            status = ("unmapped" if target is None else "unchanged" if original == present == proposed else
                      "same" if present == proposed else
                      "author-only" if proposed == original else "reviewer-only" if present == original else "conflict")
            rows.append({"key": key, "target": target, "issued": original, "current": present, "returned": proposed,
                         "status": status, "reviewer_changed": original != proposed})
        result = {"return_id": return_id, "return_sha256": returned["return_sha256"], "issue_id": issued["id"],
                  "recipient": issued["recipient"], "reviewer": returned["return"]["reviewer"], "notes": returned["return"]["notes"],
                  "report_name": issued["report_name"], "current_revision": current["revision"], "current_sha256": row["sha256"],
                  "mapping": mapping, "issued_sections": issued["definition"]["sections"], "current_sections": current["sections"],
                  "fields": rows, "current_definition": current}
        return {**result, "preview_sha256": sha(result)}

    def preview(self, return_id, mapping=None):
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            return self._preview(db, return_id, mapping)

    def apply(self, return_id, request):
        if not isinstance(request, dict) or set(request) != {"id", "preview_sha256", "mapping", "decisions", "note"}:
            fail("APPLY_FIELDS_INVALID")
        identity = _id(request["id"]); _id(return_id); _hash(request["preview_sha256"])
        text(request["note"], "DECISION_NOTE", 16000)
        request_sha = sha({"return_id": return_id, "request": request})
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT * FROM sf_report_review_applies WHERE id=?", (identity,)).fetchone()
            if old:
                if old["request_sha256"] != request_sha:
                    fail("REQUEST_ID_REUSED")
                intent = unpack(old)
                if intent["status"] == "COMPLETE":
                    return intent
                if intent.get("rejected_before_save"):
                    fail("CURRENT_REPORT_CHANGED")
            else:
                preview = self._preview(db, return_id, request["mapping"])
                if preview["preview_sha256"] != request["preview_sha256"]:
                    # Retain this definitive rejection so the original browser
                    # request can be reconciled without guessing about a lost reply.
                    rejected = {"id": identity, "status": "NEEDS_REVIEW", "return_id": return_id,
                                "created_at": now(), "request": request, "preview": preview,
                                "native_request": None, "report_name": preview["report_name"],
                                "rejected_before_save": True,
                                "last_error": "REPORT_REVIEW_CURRENT_REPORT_CHANGED"}
                    raw = encoded(rejected)
                    db.execute("INSERT INTO sf_report_review_applies(id,return_id,request_sha256,record,sha256) VALUES(?,?,?,?,?)",
                               (identity, return_id, request_sha, raw.decode(), hashlib.sha256(raw).hexdigest()))
                    db.commit()
                    fail("CURRENT_REPORT_CHANGED")
                decisions = request["decisions"]
                if not isinstance(decisions, dict) or set(decisions) - {row["key"] for row in preview["fields"]}:
                    fail("DECISIONS_INVALID")
                current = preview["current_definition"]
                selected = editorial(current)
                for row in preview["fields"]:
                    decision = decisions.get(row["key"], {"choice": "current"} if not row["reviewer_changed"] or row["status"] == "same" else None)
                    if not isinstance(decision, dict) or set(decision) - {"choice", "text"} or decision.get("choice") not in {"current", "returned", "custom"}:
                        fail("EXPLICIT_DECISION_REQUIRED")
                    choice = decision["choice"]
                    if row["target"] is None:
                        if choice != "current":
                            fail("MAP_SECTION_BEFORE_APPLYING")
                        continue
                    value = row["current"] if choice == "current" else row["returned"] if choice == "returned" else decision.get("text")
                    if row["target"] in {"title", "introduction"}:
                        selected[row["target"]] = value
                    else:
                        _, ordinal, kind = row["target"].split("/")
                        selected["sections"][int(ordinal)][kind] = value
                text(selected["title"], "TITLE", 300, True)
                text(selected["introduction"], "INTRODUCTION", 16000)
                for section in selected["sections"]:
                    text(section["title"], "SECTION_TITLE", 300, True)
                    text(section["note"], "SECTION_NOTE", 8000)
                native = {"id": identity, "expected_revision": current["revision"], "title": selected["title"],
                          "introduction": selected["introduction"], "sections": [
                              {"title": selected["sections"][i]["title"], "note": selected["sections"][i]["note"],
                               "query_name": s["query_name"], "query_revision": s["query_revision"], "parameters_text": s["parameters_text"]}
                              for i,s in enumerate(current["sections"])]}
                intent = {"id": identity, "status": "PENDING", "return_id": return_id, "created_at": now(),
                          "request": request, "preview": preview, "native_request": native, "report_name": preview["report_name"]}
                raw = encoded(intent)
                db.execute("INSERT INTO sf_report_review_applies(id,return_id,request_sha256,record,sha256) VALUES(?,?,?,?,?)",
                           (identity, return_id, request_sha, raw.decode(), hashlib.sha256(raw).hexdigest()))
            db.commit()
        # Original save checks its request replay BEFORE current-head CAS. This
        # resumes a lost reply even when subsequent author edits already exist.
        try:
            saved = self.reports.save(intent["report_name"], intent["native_request"])
        except Exception as error:
            with self.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                latest = unpack(db.execute("SELECT * FROM sf_report_review_applies WHERE id=?", (identity,)).fetchone())
                if latest["status"] != "COMPLETE":
                    latest["last_error"] = str(error); latest["observed_at"] = now()
                    if getattr(error, "code", str(error)) == "ANALYSIS_REPORT_DEFINITION_CHANGED":
                        latest["status"] = "NEEDS_REVIEW"
                    self._store(db, "sf_report_review_applies", identity, latest)
                db.commit()
            raise
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            latest = unpack(db.execute("SELECT * FROM sf_report_review_applies WHERE id=?", (identity,)).fetchone())
            if latest["status"] != "COMPLETE":
                latest["status"] = "COMPLETE"; latest["definition"] = saved; latest["definition_sha256"] = self.reports.definition(intent["report_name"], revision=saved["revision"])["sha256"]
                latest["completed_at"] = now(); latest.pop("last_error", None)
                self._store(db, "sf_report_review_applies", identity, latest)
            db.commit()
            return latest

    def apply_status(self, identity):
        with self.database._connection(readonly=True) as db:
            return unpack(db.execute("SELECT * FROM sf_report_review_applies WHERE id=?", (_id(identity),)).fetchone())
