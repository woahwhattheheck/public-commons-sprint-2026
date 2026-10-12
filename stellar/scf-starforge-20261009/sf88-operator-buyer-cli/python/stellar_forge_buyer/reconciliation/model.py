"""Complete paired accounting and engineer review in one original DuckDB warehouse.

All writes use DuckDBWorkspace's native guard and connection. Original edition
tables and source files are immutable inputs. No external source is requested.
"""
from __future__ import annotations

from copy import deepcopy

from ..duckdb_dataset import _hex, _json, _now, _qid, _wire
from ..duckdb_agent import read_identity
from .. import duckdb_semantics
from ..storage import parse
from .contracts import (SCHEMA, OUTCOMES, CATEGORIES, STATUSES, bound_review, fail,
                        fields, integer, literal, page, pair_key, request_id, sha,
                        selected_rows, subject, table, text)

_TABLES = {
    "pairs": "sf_reconciliation_pairs",
    "runs": "sf_reconciliation_runs",
    "reports": "sf_reconciliation_reports",
    "requests": "sf_reconciliation_requests",
}


def decoded(value):
    return parse(value.encode("utf-8"))


def _list_page(rows, key, offset, limit, total):
    return {key: rows, "offset": offset, "limit": limit, "total": total,
            "next_offset": offset + len(rows) if offset + len(rows) < total else None}


class Reconciliation:
    """Borrow the existing warehouse owner; create no service or database."""

    def __init__(self, workspace):
        self.workspace = workspace

    @staticmethod
    def _exists(db):
        row = db.execute("SELECT value FROM sf_workspace WHERE key='reconciliation_schema'").fetchone()
        if row and row[0] != SCHEMA:
            fail("SCHEMA_CHANGED")
        return row is not None

    @classmethod
    def _schema(cls, db):
        cls._exists(db)
        db.execute("INSERT INTO sf_workspace VALUES('reconciliation_schema',?) ON CONFLICT DO NOTHING", [SCHEMA])
        db.execute("CREATE TABLE IF NOT EXISTS sf_reconciliation_pairs(id VARCHAR PRIMARY KEY,name VARCHAR UNIQUE NOT NULL,revision BIGINT NOT NULL,record VARCHAR NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS sf_reconciliation_pair_history(id VARCHAR,revision BIGINT,record VARCHAR NOT NULL,PRIMARY KEY(id,revision))")
        db.execute("CREATE TABLE IF NOT EXISTS sf_reconciliation_runs(id VARCHAR PRIMARY KEY,pair_id VARCHAR NOT NULL,pair_revision BIGINT NOT NULL,review_revision BIGINT NOT NULL,record VARCHAR NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS sf_reconciliation_decisions(run_id VARCHAR,sequence BIGINT,subject VARCHAR NOT NULL,record VARCHAR NOT NULL,PRIMARY KEY(run_id,sequence))")
        db.execute("CREATE TABLE IF NOT EXISTS sf_reconciliation_reports(id VARCHAR PRIMARY KEY,run_id VARCHAR NOT NULL,review_revision BIGINT NOT NULL,record VARCHAR NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS sf_reconciliation_requests(id VARCHAR PRIMARY KEY,kind VARCHAR NOT NULL,body VARCHAR NOT NULL,state VARCHAR NOT NULL,record VARCHAR NOT NULL)")

    @staticmethod
    def _record(db, kind, identity):
        _hex(identity)
        if kind not in {"pairs", "runs", "reports"}:
            fail("RECORD_KIND_INVALID")
        row = db.execute("SELECT record FROM " + _TABLES[kind] + " WHERE id=?", [identity]).fetchone()
        if row is None:
            fail("RECORD_NOT_FOUND")
        return decoded(row[0])

    def _review_on(self, db, value):
        fields(value, ("name", "label", "source_edition", "target_edition", "columns"),
               ("window_column", "windows", "notes"))
        source = self.workspace._record(db, "sf_editions", _hex(value["source_edition"]))
        target = self.workspace._record(db, "sf_editions", _hex(value["target_edition"]))
        return bound_review(value, source, target,
            duckdb_semantics.edition_context(db, source),
            duckdb_semantics.edition_context(db, target), read_identity(db))

    def review(self, definition):
        with self.workspace._guard(), self.workspace._connection() as db:
            db.execute("BEGIN")
            try:
                result = self._review_on(db, definition)
                db.commit()
                return result
            except BaseException:
                db.rollback()
                raise

    def _mutate(self, kind, body, work):
        body = deepcopy(body)
        identity = request_id(body.get("request_id"))
        expected_workspace = request_id(body.get("workspace_id"))
        with self.workspace._guard(), self.workspace._connection(writeable=True) as db:
            db.execute("BEGIN")
            try:
                if expected_workspace != read_identity(db):
                    fail("WORKSPACE_ID_CHANGED")
                self._schema(db)
                prior = db.execute("SELECT kind,body,record FROM sf_reconciliation_requests WHERE id=?", [identity]).fetchone()
                if prior:
                    if prior[0] != kind or decoded(prior[1]) != body:
                        fail("ORIGINAL_REQUEST_CHANGED")
                    record = decoded(prior[2])
                    if record["state"] == "COMPLETE":
                        db.commit()
                        return record["result"]
                else:
                    record = {"request_id": identity, "kind": kind, "body": body,
                              "created_at": _now(), "state": "PREPARED"}
                record.update(state="RUNNING", updated_at=_now())
                record.pop("error", None)
                db.execute("INSERT INTO sf_reconciliation_requests VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,record=excluded.record",
                           [identity, kind, _json(body), record["state"], _json(record)])
                db.commit()
                # Holding the SAME native exclusive guard proves an older
                # interrupted writer no longer owns this transaction. No PID
                # guessing or automatic request replay is involved.
                db.execute("BEGIN")
                result = work(db, body)
                record.update(state="COMPLETE", result=result, updated_at=_now())
                db.execute("UPDATE sf_reconciliation_requests SET state='COMPLETE',record=? WHERE id=?", [_json(record), identity])
                db.commit()
                return result
            except BaseException as error:
                db.rollback()
                if "record" in locals():
                    record.update(state="INTERRUPTED", error=getattr(error, "code", type(error).__name__), updated_at=_now())
                    try:
                        db.execute("BEGIN")
                        db.execute("UPDATE sf_reconciliation_requests SET state='INTERRUPTED',record=? WHERE id=?", [_json(record), identity])
                        db.commit()
                    except BaseException:
                        db.rollback()
                raise

    def status(self):
        with self.workspace._guard(), self.workspace._connection() as db:
            result = {"schema": SCHEMA, "workspace_id": read_identity(db),
                      "pair_count": 0, "run_count": 0, "report_count": 0}
            if self._exists(db):
                for kind in ("pairs", "runs", "reports"):
                    result[kind[:-1] + "_count"] = db.execute("SELECT count(*) FROM " + _TABLES[kind]).fetchone()[0]
            return result

    def catalog(self, kind, *, offset=0, limit=25, pair_id=None, run_id=None):
        offset, limit = page(offset, limit)
        if kind not in {"pairs", "runs", "reports", "operations"}:
            fail("CATALOG_INVALID")
        actual = "requests" if kind == "operations" else kind
        clauses, parameters = [], []
        if pair_id is not None:
            if kind != "runs":
                fail("CATALOG_FILTER_INVALID")
            clauses.append("pair_id=?")
            parameters.append(_hex(pair_id))
        if run_id is not None:
            if kind != "reports":
                fail("CATALOG_FILTER_INVALID")
            clauses.append("run_id=?")
            parameters.append(_hex(run_id))
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.workspace._guard(), self.workspace._connection() as db:
            if not self._exists(db):
                if offset:
                    fail("PAGE_INVALID")
                return _list_page([], kind, offset, limit, 0)
            db.execute("BEGIN")
            try:
                total = db.execute("SELECT count(*) FROM " + _TABLES[actual] + where, parameters).fetchone()[0]
                if offset > total:
                    fail("PAGE_INVALID")
                rows = db.execute("SELECT record FROM " + _TABLES[actual] + where +
                                  " ORDER BY id LIMIT ? OFFSET ?", parameters + [limit, offset]).fetchall()
                result = _list_page([decoded(x[0]) for x in rows], kind, offset, limit, total)
                db.commit()
                return result
            except BaseException:
                db.rollback()
                raise

    def request(self, identity):
        identity = request_id(identity)
        with self.workspace._guard(), self.workspace._connection() as db:
            if not self._exists(db):
                fail("REQUEST_NOT_FOUND")
            row = db.execute("SELECT record FROM sf_reconciliation_requests WHERE id=?", [identity]).fetchone()
            if not row:
                fail("REQUEST_NOT_FOUND")
            return decoded(row[0])

    def resume(self, identity, workspace_id):
        prior = self.request(identity)
        if prior["body"]["workspace_id"] != request_id(workspace_id):
            fail("WORKSPACE_ID_CHANGED")
        return self.perform(prior["kind"], prior["body"])

    def _pair_on(self, db, identity, revision=None):
        identity = _hex(identity)
        if revision is None:
            return self._record(db, "pairs", identity)
        revision = integer(revision, minimum=1)
        row = db.execute("SELECT record FROM sf_reconciliation_pair_history WHERE id=? AND revision=?", [identity, revision]).fetchone()
        if not row:
            fail("PAIR_REVISION_NOT_FOUND")
        return decoded(row[0])

    def pair(self, identity, revision=None):
        with self.workspace._guard(), self.workspace._connection() as db:
            if not self._exists(db):
                fail("RECORD_NOT_FOUND")
            return self._pair_on(db, identity, revision)

    def _save_pair(self, db, body):
        fields(body, ("request_id", "workspace_id", "expected_revision", "definition", "review_sha256"))
        expected = integer(body["expected_revision"])
        review = self._review_on(db, body["definition"])
        if review["review_sha256"] != _hex(body["review_sha256"]):
            fail("REVIEW_CHANGED")
        identity = pair_key(review)
        row = db.execute("SELECT revision,record FROM sf_reconciliation_pairs WHERE id=?", [identity]).fetchone()
        revision = row[0] if row else 0
        if revision != expected:
            fail("PAIR_REVISION_CHANGED")
        if row:
            prior = decoded(row[1])
            if prior["definition_sha256"] == review["review_sha256"]:
                return prior
        record = {"schema": SCHEMA, "pair_id": identity, "name": review["definition"]["name"],
                  "label": review["definition"]["label"], "revision": revision + 1,
                  "definition_sha256": review["review_sha256"], "definition": review["definition"],
                  "review": review, "created_at": _now()}
        db.execute("INSERT INTO sf_reconciliation_pairs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,record=excluded.record",
                   [identity, record["name"].casefold(), record["revision"], _json(record)])
        db.execute("INSERT INTO sf_reconciliation_pair_history VALUES(?,?,?)",
                   [identity, record["revision"], _json(record)])
        return record

    @staticmethod
    def _key_indices(review):
        return [i for i, c in enumerate(review["definition"]["columns"]) if c["role"] == "key"]

    @classmethod
    def _key_equal(cls, review, a, b):
        return " AND ".join(a + "." + name + " IS NOT DISTINCT FROM " + b + "." + name
                           for name in ["window_id"] + ["c" + str(i) for i in cls._key_indices(review)])

    def _run(self, db, body):
        fields(body, ("request_id", "workspace_id", "pair_id", "expected_revision", "definition_sha256"))
        pair = self._pair_on(db, body["pair_id"], body["expected_revision"])
        if pair["definition_sha256"] != _hex(body["definition_sha256"]):
            fail("DEFINITION_CHANGED")
        review = self._review_on(db, pair["definition"])
        if review["review_sha256"] != pair["definition_sha256"]:
            fail("ORIGINAL_EDITION_CHANGED")
        identity = sha({"workspace_id": read_identity(db), "pair_id": pair["pair_id"],
                        "pair_revision": pair["revision"], "definition_sha256": pair["definition_sha256"]})
        prior = db.execute("SELECT id FROM sf_reconciliation_runs WHERE id=?", [identity]).fetchone()
        if prior:
            return self._run_on(db, identity)
        rows, values, groups = (_qid(table(k, identity)) for k in ("rows", "values", "groups"))
        sql = []
        for side in ("source", "target"):
            edition = self.workspace._record(db, "sf_editions", review[side]["edition_id"])
            sql.append(selected_rows(review, side, edition["table"]))
        db.execute("CREATE TABLE " + rows + " AS " + " UNION ALL ".join("(" + x + ")" for x in sql))
        all_columns = ["c" + str(i) for i in range(len(review["definition"]["columns"]))]
        keys = ["c" + str(i) for i in self._key_indices(review)]
        grouped = ",".join(["window_id"] + all_columns)
        db.execute("CREATE TABLE " + values + " AS SELECT " + grouped +
                   ",count(*) FILTER(WHERE side='source') AS source_count,"
                   "count(*) FILTER(WHERE side='target') AS target_count FROM " + rows +
                   " WHERE status='INCLUDED' GROUP BY " + grouped)
        key_sql = ",".join(["window_id"] + keys)
        known = " AND ".join(["window_id IS NOT NULL"] + [k + " IS NOT NULL" for k in keys])
        counts = ("SELECT " + key_sql +
                  ",count(*) FILTER(WHERE side='source') AS source_count"
                  ",count(*) FILTER(WHERE side='target') AS target_count"
                  ",count(*) FILTER(WHERE side='source' AND status='QUARANTINED') AS source_quarantined"
                  ",count(*) FILTER(WHERE side='target' AND status='QUARANTINED') AS target_quarantined"
                  " FROM " + rows + " WHERE " + known + " GROUP BY " + key_sql)
        bags = ("SELECT " + key_sql +
                ",sum(least(source_count,target_count))::BIGINT AS matched_count"
                ",sum(greatest(source_count-target_count,0))::BIGINT AS source_unmatched"
                ",sum(greatest(target_count-source_count,0))::BIGINT AS target_unmatched"
                " FROM " + values + " GROUP BY " + key_sql)
        joined = ("SELECT g.*,coalesce(v.matched_count,0) AS matched_count,"
                  "coalesce(v.source_unmatched,0) AS source_unmatched,"
                  "coalesce(v.target_unmatched,0) AS target_unmatched FROM (" + counts +
                  ") g LEFT JOIN (" + bags + ") v ON " + self._key_equal(review, "g", "v"))
        category = ("CASE WHEN source_quarantined>0 OR target_quarantined>0 THEN 'NOT_COMPARABLE'"
                    " WHEN source_count=0 THEN 'TARGET_ONLY' WHEN target_count=0 THEN 'SOURCE_ONLY'"
                    " WHEN source_unmatched=0 AND target_unmatched=0 THEN 'MATCHED'"
                    " WHEN source_count=1 AND target_count=1 THEN 'VALUE_DIFFERENCE'"
                    " ELSE 'MULTISET_DIFFERENCE' END")
        db.execute("CREATE TABLE " + groups + " AS SELECT row_number() OVER(ORDER BY " + key_sql +
                   ")::BIGINT AS group_id,*," + category + " AS category,"
                   "(source_count>1 OR target_count>1) AS duplicate_key FROM (" + joined + ")")
        db.execute("ALTER TABLE " + rows + " ADD COLUMN group_id BIGINT")
        db.execute("UPDATE " + rows + " r SET group_id=g.group_id FROM " + groups +
                   " g WHERE " + self._key_equal(review, "r", "g"))
        summary = self._summary_on(db, identity, review)
        record = {"schema": SCHEMA, "run_id": identity, "pair_id": pair["pair_id"],
                  "pair_revision": pair["revision"], "definition_sha256": pair["definition_sha256"],
                  "review_revision": 0, "review": review, "summary": summary,
                  "source_edition": review["source"]["edition_id"], "target_edition": review["target"]["edition_id"],
                  "created_at": _now(), "comparison_basis": review["comparison_basis"]}
        db.execute("INSERT INTO sf_reconciliation_runs VALUES(?,?,?,?,?)",
                   [identity, pair["pair_id"], pair["revision"], 0, _json(record)])
        return self._run_on(db, identity)

    def _summary_on(self, db, identity, review):
        rows, groups = (_qid(table(k, identity)) for k in ("rows", "groups"))
        raw = db.execute("SELECT side,status,count(*) FROM " + rows + " GROUP BY side,status").fetchall()
        totals = {(side, status): count for side, status, count in raw}
        result = {}
        bags = db.execute("SELECT coalesce(sum(matched_count),0)::BIGINT,coalesce(sum(source_unmatched),0)::BIGINT,"
                          "coalesce(sum(target_unmatched),0)::BIGINT FROM " + groups).fetchone()
        for index, side in enumerate(("source", "target")):
            included = totals.get((side, "INCLUDED"), 0)
            quarantined = totals.get((side, "QUARANTINED"), 0)
            excluded = totals.get((side, "EXCLUDED_WINDOW"), 0)
            total = included + quarantined + excluded
            if total != review[side]["row_count"] or included != bags[0] + bags[index + 1]:
                fail("ACCOUNTING_CHANGED")
            result[side] = {"total": total, "included": included, "quarantined": quarantined,
                            "excluded": excluded, "matched": bags[0], "unmatched": bags[index + 1]}
        counts = dict(db.execute("SELECT category,count(*) FROM " + groups + " GROUP BY category").fetchall())
        result["groups"] = {name: counts.get(name, 0) for name in CATEGORIES}
        result["groups"]["total"] = sum(counts.values())
        result["groups"]["duplicate_groups"] = db.execute("SELECT count(*) FROM " + groups + " WHERE duplicate_key").fetchone()[0]
        result["accounting_balanced"] = True
        result["scope_note"] = ("SOURCE_ONLY and TARGET_ONLY describe known canonical keys within the selected windows. "
                                "Rows with unresolved keys remain separately quarantined; their correspondence is not inferred. "
                                "Matched multiplicity counts equal canonical values and never assigns an arbitrary duplicate row pairing.")
        return result

    @staticmethod
    def _latest(identity, revision):
        return ("SELECT * EXCLUDE(rank) FROM (SELECT subject,sequence,record,row_number() OVER("
                "PARTITION BY subject ORDER BY sequence DESC) AS rank FROM sf_reconciliation_decisions "
                "WHERE run_id=" + literal(identity) + " AND sequence<=" + str(revision) + ") WHERE rank=1")

    def _progress_on(self, db, run, revision):
        identity = run["run_id"]
        groups, rows = (_qid(table(k, identity)) for k in ("groups", "rows"))
        required = ("SELECT 'group:'||CAST(group_id AS VARCHAR) AS subject FROM " + groups +
                    " WHERE category<>'MATCHED' OR duplicate_key UNION ALL SELECT side||':'||CAST(row_id AS VARCHAR)"
                    " AS subject FROM " + rows + " WHERE status='QUARANTINED'")
        query = ("SELECT coalesce(json_extract_string(d.record,'$.outcome'),'OPEN') AS outcome,count(*) FROM (" +
                 required + ") r LEFT JOIN (" + self._latest(identity, revision) +
                 ") d ON r.subject=d.subject GROUP BY outcome")
        counts = dict(db.execute(query).fetchall())
        required_count = sum(counts.values())
        recorded = db.execute("SELECT count(*) FROM (" + self._latest(identity, revision) + ")").fetchone()[0]
        return {"required": required_count, "recorded": recorded,
                "accepted": counts.get("ACCEPTED_DIFFERENCE", 0),
                "requires_correction": counts.get("REQUIRES_CORRECTION", 0),
                "deferred": counts.get("DEFERRED", 0), "open": counts.get("OPEN", 0),
                "resolved": counts.get("ACCEPTED_DIFFERENCE", 0)}

    def _run_on(self, db, identity):
        record = self._record(db, "runs", _hex(identity))
        revision = db.execute("SELECT review_revision FROM sf_reconciliation_runs WHERE id=?", [identity]).fetchone()[0]
        record["review_revision"] = revision
        record["summary"] = {**record["summary"], "decisions": self._progress_on(db, record, revision)}
        return record

    def run(self, identity):
        with self.workspace._guard(), self.workspace._connection() as db:
            if not self._exists(db):
                fail("RECORD_NOT_FOUND")
            db.execute("BEGIN")
            try:
                result = self._run_on(db, identity)
                db.commit()
                return result
            except BaseException:
                db.rollback()
                raise

    def _decision(self, db, body):
        fields(body, ("request_id", "workspace_id", "run_id", "expected_revision", "subject", "outcome", "actor", "reason"))
        run = self._run_on(db, body["run_id"])
        if run["review_revision"] != integer(body["expected_revision"]):
            fail("REVIEW_REVISION_CHANGED")
        selected, key = subject(body["subject"])
        if selected["kind"] == "group":
            exists = db.execute("SELECT 1 FROM " + _qid(table("groups", run["run_id"])) +
                                " WHERE group_id=?", [selected["group_id"]]).fetchone()
        else:
            exists = db.execute("SELECT 1 FROM " + _qid(table("rows", run["run_id"])) +
                                " WHERE side=? AND row_id=?", [selected["side"], selected["row"]]).fetchone()
        if not exists:
            fail("DECISION_SUBJECT_NOT_FOUND")
        if body["outcome"] not in OUTCOMES:
            fail("OUTCOME_INVALID")
        decision = {"run_id": run["run_id"], "sequence": run["review_revision"] + 1, "subject": selected,
                    "outcome": body["outcome"], "actor": text(body["actor"], maximum=240),
                    "reason": text(body["reason"], maximum=16000), "created_at": _now(),
                    "request_id": body["request_id"]}
        db.execute("INSERT INTO sf_reconciliation_decisions VALUES(?,?,?,?)",
                   [run["run_id"], decision["sequence"], key, _json(decision)])
        db.execute("UPDATE sf_reconciliation_runs SET review_revision=? WHERE id=?",
                   [decision["sequence"], run["run_id"]])
        return {"decision": decision, "run": self._run_on(db, run["run_id"])}

    def _grid(self, db, sql, parameters, offset, limit):
        total = db.execute("SELECT count(*) FROM (" + sql + ")", parameters).fetchone()[0]
        if offset > total:
            fail("PAGE_INVALID")
        result = db.execute("SELECT * FROM (" + sql + ") LIMIT ? OFFSET ?", parameters + [limit, offset])
        columns = [{"name": x[0], "type": str(x[1])} for x in result.description]
        return {"columns": columns, "rows": _wire(result.fetchall()), "offset": offset, "limit": limit,
                "total": total, "next_offset": offset + limit if offset + limit < total else None}

    @staticmethod
    def _projected(review, keys_only=False, alias="r"):
        return [alias + ".c" + str(i) + " AS " + _qid(("key:" if c["role"] == "key" else "value:") + c["name"])
                for i, c in enumerate(review["definition"]["columns"]) if not keys_only or c["role"] == "key"]

    def _rows_sql(self, run, revision=None):
        projection = ["r.side", 'r.row_id AS "row"', "r.group_id", "r.status", "r.reason", "r.window_id"] + self._projected(run["review"])
        if revision is None:
            return "SELECT " + ",".join(projection) + " FROM " + _qid(table("rows", run["run_id"])) + " r"
        return ("SELECT " + ",".join(projection) + ",d.record AS decision_json FROM " +
                _qid(table("rows", run["run_id"])) + " r LEFT JOIN (" + self._latest(run["run_id"], revision) +
                ") d ON d.subject=r.side||':'||CAST(r.row_id AS VARCHAR)")

    def _groups_sql(self, run, revision=None):
        projection = ["r.group_id", "r.category", "r.duplicate_key", "r.window_id"] + self._projected(run["review"], True)
        projection += ["r." + x for x in ("source_count", "target_count", "source_quarantined", "target_quarantined",
                                          "matched_count", "source_unmatched", "target_unmatched")]
        sql = "SELECT " + ",".join(projection) + " FROM " + _qid(table("groups", run["run_id"])) + " r"
        if revision is not None:
            sql = ("SELECT " + ",".join(projection) + ",d.record AS decision_json FROM " +
                   _qid(table("groups", run["run_id"])) + " r LEFT JOIN (" + self._latest(run["run_id"], revision) +
                   ") d ON d.subject='group:'||CAST(r.group_id AS VARCHAR)")
        return sql

    def grid(self, identity, kind, *, offset=0, limit=25, side=None, status=None, group_id=None, category=None, duplicates=None):
        offset, limit = page(offset, limit)
        with self.workspace._guard(), self.workspace._connection() as db:
            if not self._exists(db):
                fail("RECORD_NOT_FOUND")
            db.execute("BEGIN")
            try:
                run = self._run_on(db, identity)
                where, parameters = [], []
                if kind == "groups":
                    if side is not None or status is not None or group_id is not None:
                        fail("GROUP_FILTER_INVALID")
                    if category is not None:
                        if category not in CATEGORIES:
                            fail("CATEGORY_INVALID")
                        where.append("category=?")
                        parameters.append(category)
                    if duplicates is not None:
                        if type(duplicates) is not bool:
                            fail("DUPLICATES_FILTER_INVALID")
                        where.append("duplicate_key=?")
                        parameters.append(duplicates)
                    sql = self._groups_sql(run, run["review_revision"])
                    order = "group_id"
                elif kind == "rows":
                    if category is not None or duplicates is not None:
                        fail("ROW_FILTER_INVALID")
                    if side is not None:
                        if side not in {"source", "target"}:
                            fail("SIDE_INVALID")
                        where.append("side=?")
                        parameters.append(side)
                    if status is not None:
                        if status not in STATUSES:
                            fail("STATUS_INVALID")
                        where.append("status=?")
                        parameters.append(status)
                    if group_id is not None:
                        where.append("group_id=?")
                        parameters.append(integer(group_id, minimum=1))
                    sql = self._rows_sql(run, run["review_revision"])
                    order = 'side,"row"'
                else:
                    fail("GRID_INVALID")
                sql = "SELECT * FROM (" + sql + ")" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY " + order
                result = self._grid(db, sql, parameters, offset, limit)
                result.update(run_id=identity, review_revision=run["review_revision"])
                db.commit()
                return result
            except BaseException:
                db.rollback()
                raise

    def row(self, identity, side, row):
        if side not in {"source", "target"}:
            fail("SIDE_INVALID")
        row = integer(row, minimum=1)
        with self.workspace._guard(), self.workspace._connection() as db:
            if not self._exists(db):
                fail("RECORD_NOT_FOUND")
            run = self._run_on(db, identity)
            result = db.execute("SELECT * FROM (" + self._rows_sql(run, run["review_revision"]) +
                                ') WHERE side=? AND "row"=?', [side, row])
            fields_ = [x[0] for x in result.description]
            canonical = result.fetchone()
            if canonical is None:
                fail("ROW_NOT_FOUND")
            edition = self.workspace._record(db, "sf_editions", run[side + "_edition"])
            result = db.execute("SELECT * FROM " + _qid(edition["table"]) + " WHERE sf_row=?", [row])
            names = [x[0] for x in result.description]
            original = result.fetchone()
            if original is None:
                fail("ORIGINAL_ROW_CHANGED")
            return {"side": side, "row": row, "edition_id": edition["edition_id"],
                    "original": _wire(dict(zip(names, original))), "canonical": _wire(dict(zip(fields_, canonical)))}

    def decisions(self, identity, *, offset=0, limit=25):
        offset, limit = page(offset, limit)
        with self.workspace._guard(), self.workspace._connection() as db:
            if not self._exists(db):
                fail("RECORD_NOT_FOUND")
            run = self._run_on(db, identity)
            total = run["review_revision"]
            if offset > total:
                fail("PAGE_INVALID")
            rows = db.execute("SELECT record FROM sf_reconciliation_decisions WHERE run_id=? ORDER BY sequence LIMIT ? OFFSET ?",
                              [identity, limit, offset]).fetchall()
            return _list_page([decoded(x[0]) for x in rows], "decisions", offset, limit, total)

    def _comparison(self, db, before, after):
        a, b = before["review"], after["review"]
        ak = [(a["comparison_columns"][i]["name"], a["comparison_columns"][i]["type"]) for i in self._key_indices(a)]
        bk = [(b["comparison_columns"][i]["name"], b["comparison_columns"][i]["type"]) for i in self._key_indices(b)]
        if ak != bk:
            fail("COMPARISON_KEYS_CHANGED")
        a_columns = [(x["name"], x["type"], x["role"]) for x in a["comparison_columns"]]
        b_columns = [(x["name"], x["type"], x["role"]) for x in b["comparison_columns"]]
        comparable = sorted(a_columns) == sorted(b_columns)
        joins = ["a.window_id IS NOT DISTINCT FROM b.window_id"]
        projected = ["coalesce(a.window_id,b.window_id) AS window_id"]
        for ia, ib in zip(self._key_indices(a), self._key_indices(b)):
            joins.append("a.c" + str(ia) + " IS NOT DISTINCT FROM b.c" + str(ib))
            projected.append("coalesce(a.c" + str(ia) + ",b.c" + str(ib) + ") AS " +
                             _qid("key:" + a["definition"]["columns"][ia]["name"]))
        compared = ("category", "source_count", "target_count", "source_quarantined", "target_quarantined",
                    "matched_count", "source_unmatched", "target_unmatched", "duplicate_key")
        changed_counts = "(" + " OR ".join("a." + x + " IS DISTINCT FROM b." + x for x in compared) + ")"
        prefix, content_join = "", ""
        if comparable:
            # Compare complete typed canonical multiplicities. Counts/category
            # alone cannot distinguish 10/11 from 10/12, or 10/10 from 20/20.
            # Include known-key quarantined rows and their interpretation reason.
            # No value is converted to JSON, floating point or a digest here.
            def bag(run, indices):
                projection = ["side", "status", "reason", "window_id"]
                projection += ["c" + str(index) + " AS c" + str(i) for i, index in enumerate(indices)]
                return ("SELECT " + ",".join(projection) + ",count(*)::BIGINT AS occurrences FROM " +
                        _qid(table("rows", run["run_id"])) + " WHERE group_id IS NOT NULL GROUP BY " +
                        ",".join(str(i) for i in range(1, len(projection) + 1)))
            b_positions = [b_columns.index(item) for item in a_columns]
            keys = ["window_id"] + ["c" + str(i) for i in self._key_indices(a)]
            prefix = ("WITH before_content AS (" + bag(before, range(len(a_columns))) +
                      "),after_content AS (" + bag(after, b_positions) +
                      "),content_delta AS ((SELECT * FROM before_content EXCEPT ALL SELECT * FROM after_content)"
                      " UNION ALL (SELECT * FROM after_content EXCEPT ALL SELECT * FROM before_content)),"
                      "changed_content AS (SELECT " + ",".join(keys) + ",true AS changed FROM content_delta GROUP BY " +
                      ",".join(keys) + ") ")
            content_keys = ["d.window_id IS NOT DISTINCT FROM coalesce(a.window_id,b.window_id)"]
            for ia, ib in zip(self._key_indices(a), self._key_indices(b)):
                content_keys.append("d.c" + str(ia) + " IS NOT DISTINCT FROM coalesce(a.c" + str(ia) + ",b.c" + str(ib) + ")")
            content_join = " LEFT JOIN changed_content d ON " + " AND ".join(content_keys)
            changed_content = "coalesce(d.changed,false)"
            change = changed_counts + " OR " + changed_content
        else:
            # A changed canonical schema cannot be silently combination-cast and
            # cannot establish UNCHANGED, even when the category/counts match.
            changed_content = "NULL::BOOLEAN"
            change = "true"
        category = ("CASE WHEN a.group_id IS NULL THEN 'ADDED_TO_REPORT' WHEN b.group_id IS NULL THEN 'ABSENT_FROM_REPORT'"
                    " WHEN " + change + " THEN 'CHANGED' ELSE 'UNCHANGED' END")
        projected = [category + " AS change", "a.group_id AS before_group_id", "b.group_id AS after_group_id",
                     ("true" if comparable else "false") + " AS canonical_schema_equal",
                     changed_content + " AS canonical_content_changed",
                     changed_counts + " AS classification_or_counts_changed"] + projected
        projected += [side + "." + x + " AS " + side_name + "_" + x
                      for x in compared for side, side_name in (("a", "before"), ("b", "after"))]
        sql = (prefix + "SELECT " + ",".join(projected) + " FROM " + _qid(table("groups", before["run_id"])) +
               " a FULL OUTER JOIN " + _qid(table("groups", after["run_id"])) + " b ON " + " AND ".join(joins) + content_join)
        counts = dict(db.execute("SELECT change,count(*) FROM (" + sql + ") GROUP BY change").fetchall())
        scope = {
            "before_run_id": before["run_id"], "after_run_id": after["run_id"],
            "mapping_equal": a["definition"]["columns"] == b["definition"]["columns"],
            "canonical_schema_equal": comparable,
            "content_basis": "Exact native typed canonical value/side/status/reason multiplicities for every known-key group.",
            "windows_equal": (a["definition"]["windows"], a["definition"]["window_column"]) ==
                             (b["definition"]["windows"], b["definition"]["window_column"]),
            "source_scope_equal": a["source"]["source_scope"] == b["source"]["source_scope"],
            "target_scope_equal": a["target"]["source_scope"] == b["target"]["source_scope"],
            "summary": {k: counts.get(k, 0) for k in ("ADDED_TO_REPORT", "ABSENT_FROM_REPORT", "CHANGED", "UNCHANGED")},
            "meaning": "Absence from the later selected report is not proof of a correction. Original inputs, mappings, windows and decisions stay separately retained.",
        }
        return sql, scope

    def _report(self, db, body):
        fields(body, ("request_id", "workspace_id", "run_id", "expected_revision"), ("before_run_id",))
        run = self._run_on(db, body["run_id"])
        revision = integer(body["expected_revision"])
        if revision != run["review_revision"]:
            fail("REVIEW_REVISION_CHANGED")
        before_id = body.get("before_run_id")
        if before_id is not None:
            _hex(before_id)
        identity = sha({"schema": SCHEMA + ".report", "workspace_id": read_identity(db),
                        "run_id": run["run_id"], "review_revision": revision, "before_run_id": before_id})
        existing = db.execute("SELECT id FROM sf_reconciliation_reports WHERE id=?", [identity]).fetchone()
        if existing:
            return self._record(db, "reports", identity)
        statements = {
            "rows": self._rows_sql(run, revision) + ' ORDER BY side,"row"',
            "groups": self._groups_sql(run, revision) + " ORDER BY group_id",
            "decisions": ("SELECT sequence,subject,json_extract_string(record,'$.outcome') AS outcome,"
                          "json_extract_string(record,'$.actor') AS actor,json_extract_string(record,'$.reason') AS reason,"
                          "record AS decision_json FROM sf_reconciliation_decisions WHERE run_id=" + literal(run["run_id"]) +
                          " AND sequence<=" + str(revision) + " ORDER BY sequence"),
        }
        comparison = None
        if before_id:
            before = self._run_on(db, before_id)
            statement, comparison = self._comparison(db, before, run)
            statements["changes"] = statement + " ORDER BY window_id,coalesce(before_group_id,after_group_id)"
        queries = []
        for kind, sql in statements.items():
            # This is the original saved-query writer, sharing this transaction.
            # No duplicate recipe/SQL implementation or nested warehouse lock.
            query = self.workspace._save_query_on(db, "Recon_" + identity + "_" + kind,
                                                 sql, parameters=[], expected_revision=0)
            queries.append({"kind": kind, **query})
        record = {"schema": SCHEMA + ".report", "report_id": identity, "run_id": run["run_id"],
                  "pair_id": run["pair_id"], "pair_revision": run["pair_revision"], "review_revision": revision,
                  "definition": run["review"]["definition"], "review": run["review"], "summary": run["summary"],
                  "source_edition": run["source_edition"], "target_edition": run["target_edition"],
                  "before_run_id": before_id, "scope_comparison": comparison, "queries": queries,
                  "views_at_creation": self.workspace._views(db), "created_at": _now()}
        db.execute("INSERT INTO sf_reconciliation_reports VALUES(?,?,?,?)",
                   [identity, run["run_id"], revision, _json(record)])
        return record

    def report(self, identity):
        with self.workspace._guard(), self.workspace._connection() as db:
            if not self._exists(db):
                fail("RECORD_NOT_FOUND")
            return self._record(db, "reports", identity)

    def changes(self, identity, *, offset=0, limit=25):
        offset, limit = page(offset, limit)
        with self.workspace._guard(), self.workspace._connection() as db:
            if not self._exists(db):
                fail("RECORD_NOT_FOUND")
            report = self._record(db, "reports", identity)
            query = next((x for x in report["queries"] if x["kind"] == "changes"), None)
            if query is None:
                fail("COMPARISON_NOT_FOUND")
            return self._grid(db, query["sql"], query["parameters"], offset, limit)

    def perform(self, kind, body):
        actions = {"pairs": self._save_pair, "run": self._run, "decision": self._decision, "report": self._report}
        if kind not in actions:
            fail("OPERATION_INVALID")
        return self._mutate(kind, body, actions[kind])
