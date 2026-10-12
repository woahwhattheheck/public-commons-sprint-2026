"""Commissioning intake in the original DuckDB owner, files and edition lifecycle."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import hashlib

from ..duckdb_agent import read_identity
from ..duckdb_dataset import _json, _now
from ..duckdb_semantics import _file_bytes
from ..errors import StateError
from ..storage import digest, parse, private_directory, read, sync_directory, write
from ..reconciliation.model import Reconciliation
from .source import (SCHEMA, DESCRIPTOR, MANIFEST, MAX_REPORT, MAX_ROWS, MAX_COLUMNS,
                     CommissioningReport, fail, need, fields, hash_id, request_id,
                     uuid, integer, filename, interpretation, read_original)

_REPORTS = "sf_timescale_intake_reports"
_REQUESTS = "sf_timescale_intake_requests"
_CHUNK = 1024 * 1024


def _exists(db):
    row = db.execute("SELECT value FROM sf_workspace WHERE key='timescale_intake_schema'").fetchone()
    need(not row or row[0] == SCHEMA, "SCHEMA_CHANGED")
    return row is not None


def _schema(db):
    _exists(db)
    db.execute("INSERT INTO sf_workspace VALUES('timescale_intake_schema',?) ON CONFLICT DO NOTHING", [SCHEMA])
    db.execute("CREATE TABLE IF NOT EXISTS " + _REPORTS + "(id VARCHAR PRIMARY KEY,record VARCHAR NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS " + _REQUESTS + "(id VARCHAR PRIMARY KEY,kind VARCHAR NOT NULL,body VARCHAR NOT NULL,record VARCHAR NOT NULL)")


def _decoded(value):
    return parse(value.encode("utf-8"))


def _report_on(db, identity):
    hash_id(identity)
    need(_exists(db), "REPORT_NOT_FOUND")
    row = db.execute("SELECT record FROM " + _REPORTS + " WHERE id=?", [identity]).fetchone()
    need(row is not None, "REPORT_NOT_FOUND")
    record = _decoded(row[0])
    need(record.get("report_id") == identity and record.get("sha256") == identity
         and record.get("file_owner") == "timescale-report:" + identity, "RETAINED_REPORT_CHANGED")
    return record


def report_bytes(workspace, identity, *, db=None, expected_workspace_id=None):
    """Use the existing sf_files/sf_file_chunks; no second BLOB store."""
    if db is None:
        with workspace._guard(), workspace._connection() as connection:
            return report_bytes(workspace, identity, db=connection, expected_workspace_id=expected_workspace_id)
    if expected_workspace_id is not None:
        need(read_identity(db) == request_id(expected_workspace_id), "WORKSPACE_ID_CHANGED")
    record = _report_on(db, identity)
    raw = _file_bytes(db, record["file_owner"], "original-commissioning.json", MAX_REPORT)
    need(len(raw) == record["bytes"] and digest(raw) == identity, "RETAINED_REPORT_CHANGED")
    return raw, record


def report_file_bytes(workspace, identity, name, *, db=None):
    if db is None:
        with workspace._guard(), workspace._connection() as connection:
            return report_file_bytes(workspace, identity, name, db=connection)
    record = _report_on(db, identity)
    if name == "original-commissioning.json":
        declared = {"name": name, "bytes": record["bytes"], "sha256": identity}
    elif name == "TIMESCALE_INTAKE.md":
        declared = record.get("receiving_guide")
    elif name == "intake-receiving.json":
        declared = record.get("receiving_manifest")
    else:
        fail("SOURCE_FILE_NOT_FOUND")
    need(isinstance(declared, dict) and declared.get("name") == name, "RETAINED_REPORT_CHANGED")
    maximum = MAX_REPORT if name == "original-commissioning.json" else 2 * 1024 * 1024
    raw = _file_bytes(db, record["file_owner"], name, maximum)
    need(len(raw) == declared.get("bytes") and digest(raw) == declared.get("sha256"),
         "RETAINED_REPORT_CHANGED")
    return raw, declared, record


def report_guide_bytes(workspace, identity, *, db=None):
    """The guide edition is retained with the original report, not reloaded at import."""
    if db is None:
        with workspace._guard(), workspace._connection() as connection:
            return report_guide_bytes(workspace, identity, db=connection)
    record = _report_on(db, identity)
    declared = record.get("receiving_guide")
    need(isinstance(declared, dict) and declared.get("name") == "TIMESCALE_INTAKE.md",
         "RECEIVING_GUIDE_CHANGED")
    raw = _file_bytes(db, record["file_owner"], declared["name"], 2 * 1024 * 1024)
    need(len(raw) == declared.get("bytes") and digest(raw) == declared.get("sha256"),
         "RECEIVING_GUIDE_CHANGED")
    return raw


def _page(rows, key, offset, limit, maximum=100):
    integer(offset); integer(limit, 1, maximum)
    need(offset <= len(rows), "PAGE_INVALID")
    selected = rows[offset:offset + limit]
    return {key: selected, "offset": offset, "limit": limit, "total": len(rows),
            "next_offset": offset + len(selected) if offset + len(selected) < len(rows) else None}


def _public(record):
    return {key: value for key, value in record.items() if key != "file_owner"}


class TimescaleIntake:
    def __init__(self, workspace):
        self.workspace = workspace

    def _request_on(self, db, identity):
        request_id(identity)
        need(_exists(db), "REQUEST_NOT_FOUND")
        row = db.execute("SELECT kind,body,record FROM " + _REQUESTS + " WHERE id=?", [identity]).fetchone()
        need(row is not None, "REQUEST_NOT_FOUND")
        record = _decoded(row[2])
        need(record.get("request_id") == identity and record.get("kind") == row[0]
             and record.get("body") == _decoded(row[1]), "ORIGINAL_REQUEST_CHANGED")
        return record

    def request(self, identity):
        with self.workspace._guard(), self.workspace._connection() as db:
            return self._request_on(db, identity)

    def _mutate(self, kind, body, work):
        """Keep a discoverable same-input operation around idempotent native calls.

        Each original warehouse mutation still acquires its own kernel guard.
        Original review IDs, immutable imports and paired request IDs reconcile
        interrupted completion; this journal never substitutes those results.
        """
        body = deepcopy(body)
        identity, expected = request_id(body.get("request_id")), request_id(body.get("workspace_id"))
        with self.workspace._mutex:
            with self.workspace._guard(), self.workspace._connection(writeable=True) as db:
                db.execute("BEGIN")
                try:
                    need(read_identity(db) == expected, "WORKSPACE_ID_CHANGED")
                    _schema(db)
                    prior = db.execute("SELECT id FROM " + _REQUESTS + " WHERE id=?", [identity]).fetchone()
                    if prior:
                        record = self._request_on(db, identity)
                        need(record["kind"] == kind and record["body"] == body, "ORIGINAL_REQUEST_CHANGED")
                        if record["state"] == "COMPLETE":
                            db.commit()
                            return record["result"]
                    else:
                        record = {"request_id": identity, "kind": kind, "body": body,
                                  "created_at": _now(), "state": "PREPARED"}
                    record.update(state="RUNNING", updated_at=_now())
                    record.pop("error", None)
                    db.execute("INSERT INTO " + _REQUESTS + " VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record",
                               [identity, kind, _json(body), _json(record)])
                    db.commit()
                except BaseException:
                    db.rollback()
                    raise
            try:
                result = work(body)
                with self.workspace._guard(), self.workspace._connection(writeable=True) as db:
                    current = self._request_on(db, identity)
                    need(current["body"] == body and current["kind"] == kind, "ORIGINAL_REQUEST_CHANGED")
                    if current["state"] == "COMPLETE":
                        return current["result"]
                    record.update(state="COMPLETE", result=result, updated_at=_now())
                    db.execute("UPDATE " + _REQUESTS + " SET record=? WHERE id=?", [_json(record), identity])
                return result
            except BaseException as error:
                try:
                    with self.workspace._guard(), self.workspace._connection(writeable=True) as db:
                        current = self._request_on(db, identity)
                        if current["state"] != "COMPLETE":
                            current.update(state="INTERRUPTED", error=getattr(error, "code", type(error).__name__), updated_at=_now())
                            db.execute("UPDATE " + _REQUESTS + " SET record=? WHERE id=?", [_json(current), identity])
                except BaseException:
                    pass
                raise

    def status(self):
        with self.workspace._guard(), self.workspace._connection() as db:
            result = {"schema": SCHEMA, "workspace_id": read_identity(db), "report_count": 0, "review_count": 0,
                      "limits": {"report_bytes": MAX_REPORT, "rows": MAX_ROWS, "columns": MAX_COLUMNS, "page_rows": 250}}
            if _exists(db):
                result["report_count"] = db.execute("SELECT count(*) FROM " + _REPORTS).fetchone()[0]
                result["review_count"] = db.execute("SELECT count(*) FROM " + _REQUESTS +
                    " WHERE kind='review' AND json_extract_string(record,'$.state')='COMPLETE'").fetchone()[0]
            return result

    def reports(self, *, offset=0, limit=25):
        with self.workspace._guard(), self.workspace._connection() as db:
            rows = [] if not _exists(db) else [_public(_decoded(row[0])) for row in
                db.execute("SELECT record FROM " + _REPORTS + " ORDER BY id").fetchall()]
        rows.sort(key=lambda row: (row["created_at"], row["report_id"]), reverse=True)
        return _page(rows, "reports", offset, limit)

    def report(self, identity):
        raw, record = report_bytes(self.workspace, hash_id(identity))
        report = CommissioningReport(raw, identity)
        return {**_public(record), "sources": report.descriptors(),
                "scope_note": "All rows in each selected original file are retained. Native database-wide completeness, time meaning and acceptance are not inferred."}

    def source(self, identity, source_id, *, offset=0, limit=25, q=""):
        integer(offset); integer(limit, 1, 250)
        need(isinstance(q, str) and len(q.encode()) <= 4096, "SEARCH_INVALID")
        raw, _ = report_bytes(self.workspace, hash_id(identity))
        report = CommissioningReport(raw, identity)
        selected = report.source(source_id)
        table = selected["table"]
        all_rows = table["rows"]
        rows = [row for row in all_rows if not q or any(q.casefold() in value.casefold()
                for value in row if value is not None)]
        used, defaults = {"sf_row"}, []
        for index, original in enumerate(table["names"]):
            name = original if "\x00" not in original and len(original.encode()) <= 240 and original.casefold() not in used else "column_" + str(index + 1)
            while name.casefold() in used:
                name += "_"
            used.add(name.casefold())
            defaults.append({"source": original, "name": name, "type": "VARCHAR",
                             "nullable": not all_rows or any(row[index] is None for row in all_rows)})
        descriptor = next(row for row in report.descriptors() if row["id"] == source_id)
        return {"report_id": identity, "source_id": source_id, "descriptor": descriptor,
                "columns": table["columns"], "source_rows": len(all_rows), "default_columns": defaults,
                **_page(rows, "rows", offset, limit, 250)}

    def retain(self, body, raw=None):
        fields(body, ("request_id", "workspace_id", "filename", "sha256"))
        filename(body["filename"]); hash_id(body["sha256"])
        if raw is not None:
            need(isinstance(raw, bytes) and digest(raw) == body["sha256"], "REPORT_CHANGED")
        def work(value):
            with self.workspace._guard(), self.workspace._connection(writeable=True) as db:
                _schema(db)
                existing = db.execute("SELECT id FROM " + _REPORTS + " WHERE id=?", [value["sha256"]]).fetchone()
                if existing:
                    retained, record = report_bytes(self.workspace, value["sha256"], db=db)
                    need(record["filename"] == value["filename"], "ORIGINAL_FILENAME_CHANGED")
                    CommissioningReport(retained, value["sha256"])
                    report_guide_bytes(self.workspace, value["sha256"], db=db)
                    report_file_bytes(self.workspace, value["sha256"], "intake-receiving.json", db=db)
                    return _public(record)
                need(raw is not None, "SOURCE_REQUIRED")
                report = CommissioningReport(raw, value["sha256"])
                owner = "timescale-report:" + report.sha256
                guide = Path(__file__).with_name("OPERATING.md").read_bytes()
                need(0 < len(guide) <= 2 * 1024 * 1024, "OPERATING_GUIDE_REQUIRED")
                guide_file = {"name": "TIMESCALE_INTAKE.md", "bytes": len(guide), "sha256": digest(guide)}
                manifest = {"schema": SCHEMA + ".download-manifest", "workspace_id": value["workspace_id"],
                            "report_id": report.sha256, "complete": True,
                            "source_format": "TIMESCALE_COMMISSIONING", "filename": value["filename"],
                            "files": [{"name": "original-commissioning.json", "bytes": len(raw), "sha256": report.sha256},
                                      guide_file]}
                manifest_raw = (_json(manifest) + "\n").encode("utf-8")
                manifest_file = {"name": "intake-receiving.json", "bytes": len(manifest_raw), "sha256": digest(manifest_raw)}
                record = {**report.summary(value["filename"]), "file_owner": owner, "receiving_guide": guide_file,
                          "receiving_manifest": manifest_file}
                db.execute("BEGIN")
                try:
                    # Reserved non-edition owner keys cannot collide with the
                    # original 64-hex immutable edition IDs.
                    db.execute("INSERT INTO sf_files VALUES(?,?,?,?)", [owner, "original-commissioning.json", len(raw), report.sha256])
                    for index, start in enumerate(range(0, len(raw), _CHUNK)):
                        db.execute("INSERT INTO sf_file_chunks VALUES(?,?,?,?)",
                                   [owner, "original-commissioning.json", index, raw[start:start + _CHUNK]])
                    db.execute("INSERT INTO sf_files VALUES(?,?,?,?)",
                               [owner, guide_file["name"], len(guide), guide_file["sha256"]])
                    for index, start in enumerate(range(0, len(guide), _CHUNK)):
                        db.execute("INSERT INTO sf_file_chunks VALUES(?,?,?,?)",
                                   [owner, guide_file["name"], index, guide[start:start + _CHUNK]])
                    db.execute("INSERT INTO sf_files VALUES(?,?,?,?)",
                               [owner, manifest_file["name"], len(manifest_raw), manifest_file["sha256"]])
                    db.execute("INSERT INTO sf_file_chunks VALUES(?,?,?,?)",
                               [owner, manifest_file["name"], 0, manifest_raw])
                    db.execute("INSERT INTO " + _REPORTS + " VALUES(?,?)", [report.sha256, _json(record)])
                    db.commit()
                except BaseException:
                    db.rollback()
                    raise
                return _public(record)
        return self._mutate("retain", body, work)

    def retain_path(self, body):
        fields(body, ("request_id", "workspace_id", "report_path", "sha256", "filename"))
        original = {key: value for key, value in body.items() if key != "report_path"}
        # A completed original request can return without the former source file.
        try:
            prior = self.request(body["request_id"])
        except StateError as error:
            if error.code != "DUCKDB_TIMESCALE_REQUEST_NOT_FOUND":
                raise
        else:
            need(prior["body"] == original and prior["kind"] == "retain", "ORIGINAL_REQUEST_CHANGED")
            if prior["state"] == "COMPLETE":
                return prior["result"]
            try:
                report_bytes(self.workspace, body["sha256"])
            except StateError as error:
                if error.code != "DUCKDB_TIMESCALE_REPORT_NOT_FOUND":
                    raise
            else:
                return self.retain(original)
        return self.retain(original, read_original(body["report_path"]))

    def review(self, body):
        fields(body, ("request_id", "workspace_id", "report_id", "source_id", "columns", "interpretation"), ("keys",))
        hash_id(body["report_id"]); uuid(body["source_id"])
        need(body.get("keys", []) == [], "PRESERVE_NATIVE_DUPLICATES_USE_EMPTY_KEYS")
        def work(value):
            raw, record = report_bytes(self.workspace, value["report_id"], expected_workspace_id=value["workspace_id"])
            report = CommissioningReport(raw, value["report_id"])
            selected = report.source(value["source_id"])
            meaning = interpretation(value["interpretation"], selected["table"]["names"])
            descriptor = {"schema": DESCRIPTOR, "workspace_id": value["workspace_id"],
                          "report_id": value["report_id"], "report_filename": record["filename"],
                          "source_id": value["source_id"], "interpretation": meaning}
            payload = (_json(descriptor) + "\n").encode("utf-8")
            need(len(payload) <= 8 * 1024 * 1024, "DESCRIPTOR_LIMIT")
            directory = private_directory(self.workspace.directory / "timescale-intake-descriptors")
            need(directory.resolve() == directory, "PRIVATE_DIRECTORY_REQUIRED")
            path = directory / (digest(payload) + ".json")
            if path.exists():
                need(read_original(path, 8 * 1024 * 1024) == payload, "REVIEW_DESCRIPTOR_CHANGED")
                sync_directory(directory)
            else:
                write(path, payload, exclusive=True)
            result = self.workspace.review_import(path, columns=value["columns"], keys=[])
            need(result.get("timescale_source", {}).get("descriptor") == descriptor, "REVIEW_SOURCE_CHANGED")
            return result
        return self._mutate("review", body, work)

    def import_review(self, body):
        fields(body, ("request_id", "workspace_id", "review_id"))
        hash_id(body["review_id"])
        def work(value):
            with self.workspace._guard(), self.workspace._connection() as db:
                review = self.workspace._record(db, "sf_reviews", value["review_id"])
                need(isinstance(review.get("timescale_source"), dict), "TIMESCALE_REVIEW_REQUIRED")
            return self.workspace.import_review(value["review_id"])
        return self._mutate("import", body, work)

    def operations(self, *, offset=0, limit=25):
        with self.workspace._guard(), self.workspace._connection() as db:
            rows = [] if not _exists(db) else [_decoded(row[0]) for row in
                db.execute("SELECT record FROM " + _REQUESTS).fetchall()]
        rows.sort(key=lambda row: (row["created_at"], row["request_id"]), reverse=True)
        return _page(rows, "operations", offset, limit)

    def reviews(self, *, offset=0, limit=25):
        with self.workspace._guard(), self.workspace._connection() as db:
            rows = []
            if _exists(db):
                for (saved,) in db.execute("SELECT record FROM " + _REQUESTS + " WHERE kind='review'").fetchall():
                    request = _decoded(saved)
                    if request["state"] != "COMPLETE":
                        continue
                    result, body = request["result"], request["body"]
                    edition = db.execute("SELECT id FROM sf_editions WHERE id=?", [result["review_id"]]).fetchone()
                    rows.append({"request_id": request["request_id"], "review_id": result["review_id"],
                                 "report_id": body["report_id"], "source_id": body["source_id"],
                                 "created_at": request["created_at"], "edition_id": edition[0] if edition else None,
                                 "columns": result["columns"], "interpretation": body["interpretation"]})
        rows.sort(key=lambda row: (row["created_at"], row["request_id"]), reverse=True)
        return _page(rows, "reviews", offset, limit)

    def resume(self, identity, workspace_id):
        expected = request_id(workspace_id)
        prior = self.request(identity)
        need(prior["body"]["workspace_id"] == expected and
             self.workspace.identity()["workspace_id"] == expected, "WORKSPACE_ID_CHANGED")
        if prior["kind"] == "retain":
            return self.retain(prior["body"])
        if prior["kind"] == "review":
            return self.review(prior["body"])
        if prior["kind"] == "import":
            return self.import_review(prior["body"])
        fail("REQUEST_KIND_INVALID")

    def pair_review(self, definition):
        from ..reconciliation.contracts import fields as pair_fields
        pair_fields(definition, ("name", "label", "source_edition", "target_edition", "columns"),
                    ("window_column", "windows", "notes"))
        editions = [self.workspace.edition(hash_id(definition[key])) for key in ("source_edition", "target_edition")]
        contexts = [edition.get("timescale_source") for edition in editions]
        need(all(isinstance(context, dict) for context in contexts), "TWO_TIMESCALE_EDITIONS_REQUIRED")
        need(contexts[0]["role"] == "BASELINE" and contexts[1]["role"] == "OBSERVED", "BASELINE_AND_OBSERVED_REQUIRED")
        need((contexts[0]["report_id"], contexts[0]["source_id"]) !=
             (contexts[1]["report_id"], contexts[1]["source_id"]), "DISTINCT_ORIGINAL_SOURCES_REQUIRED")
        scope = ("commissioning_workspace_id", "commissioning_id", "contract_revision")
        if any(contexts[0].get(key) != contexts[1].get(key) for key in scope):
            need(isinstance(definition.get("notes"), str) and bool(definition["notes"].strip()),
                 "CHANGED_SOURCE_SCOPE_NOTE_REQUIRED")
        return Reconciliation(self.workspace).review(definition)

    def pair(self, body):
        fields(body, ("request_id", "workspace_id", "expected_revision", "definition", "review_sha256"))
        expected = self.pair_review(body["definition"])
        need(expected["review_sha256"] == body["review_sha256"], "PAIR_REVIEW_CHANGED")
        return Reconciliation(self.workspace).perform("pairs", body)
