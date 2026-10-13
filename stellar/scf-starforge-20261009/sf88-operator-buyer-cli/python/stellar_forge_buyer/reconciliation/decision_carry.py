"""Reviewed reuse of frozen engineer decisions in the original warehouse.

Native typed comparisons retain complete row multiplicities. Capture identities
remain separate from the source meaning and policy required for reuse.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import sys

from ..duckdb_dataset import _hex, _json, _now, _qid
from ..duckdb_agent import read_identity
from ..storage import parse
from .contracts import (SCHEMA as RECONCILIATION, fail, fields, integer, literal,
                        page, request_id, sha, subject, table, text)

SCHEMA = "stellar-forge.duckdb-reconciliation.decision-carry.v1"
FEATURE_SCHEMA = RECONCILIATION + ".decision-carry"
STATES = ("ELIGIBLE", "PRIOR_OPEN", "POLICY_CHANGED", "GROUP_MISSING",
          "VALUES_CHANGED", "ROW_MISSING", "ROW_AMBIGUOUS", "TARGET_REVIEWED")
MAX_SELECTION = 10000
MAX_LINEAGE = 10000

_TABLES = {"reviews": "sf_reconciliation_carry_reviews",
           "applications": "sf_reconciliation_carry_applications"}
_TIMESCALE_CAPTURE = {
    "report_id", "sha256", "bytes", "filename", "revision", "digest", "created_at",
    "source_count", "source_id", "native_filename", "native_bytes", "native_sha256",
    "table_digest", "title",
}
_TIMESCALE_REQUIRED = {
    "commissioning_workspace_id", "commissioning_id", "role", "table_name",
    "native_columns", "provider_completeness", "contract_revision", "interpretation",
}


def _decoded(value):
    return parse(value.encode("utf-8"))


def _same(first, second):
    # Preserve JSON type, order of arrays, and absent versus empty values.
    return _json(first) == _json(second)


def schema(db):
    db.execute("CREATE TABLE IF NOT EXISTS sf_reconciliation_carry_reviews("
               "id VARCHAR PRIMARY KEY,target_run_id VARCHAR NOT NULL,record VARCHAR NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS sf_reconciliation_carry_candidates("
               "review_id VARCHAR,candidate_id BIGINT,kind VARCHAR NOT NULL,state VARCHAR NOT NULL,"
               "record VARCHAR NOT NULL,PRIMARY KEY(review_id,candidate_id))")
    db.execute("CREATE TABLE IF NOT EXISTS sf_reconciliation_carry_applications("
               "id VARCHAR PRIMARY KEY,review_id VARCHAR UNIQUE NOT NULL,target_run_id VARCHAR NOT NULL,"
               "review_revision BIGINT NOT NULL,record VARCHAR NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS sf_reconciliation_carry_members("
               "application_id VARCHAR,candidate_id BIGINT,sequence BIGINT NOT NULL,"
               "PRIMARY KEY(application_id,candidate_id))")


def exists(db):
    return db.execute("SELECT 1 FROM information_schema.tables WHERE table_name=?",
                      [_TABLES["reviews"]]).fetchone() is not None


def record(db, kind, identity):
    identity = _hex(identity)
    if kind not in _TABLES:
        fail("CARRY_RECORD_KIND_INVALID")
    row = db.execute("SELECT record FROM " + _TABLES[kind] + " WHERE id=?", [identity]).fetchone() if exists(db) else None
    if not row:
        fail("CARRY_RECORD_NOT_FOUND")
    result = _decoded(row[0])
    expected = "review_id" if kind == "reviews" else "application_id"
    if result.get(expected) != identity:
        fail("CARRY_RECORD_CHANGED")
    if kind == "reviews" and result.get("review_sha256") != sha({k: v for k, v in result.items() if k != "review_sha256"}):
        fail("CARRY_REVIEW_CHANGED")
    return result


def _page(items, key, offset, limit, total):
    return {key: items, "offset": offset, "limit": limit, "total": total,
            "next_offset": offset + len(items) if offset + len(items) < total else None}


def catalog(db, kind, *, target_run_id=None, offset=0, limit=25):
    offset, limit = page(offset, limit)
    if kind not in _TABLES:
        fail("CARRY_CATALOG_INVALID")
    parameters, where = [], ""
    if target_run_id is not None:
        parameters, where = [_hex(target_run_id)], " WHERE target_run_id=?"
    if not exists(db):
        if offset:
            fail("PAGE_INVALID")
        return _page([], kind, offset, limit, 0)
    total = db.execute("SELECT count(*) FROM " + _TABLES[kind] + where, parameters).fetchone()[0]
    if offset > total:
        fail("PAGE_INVALID")
    rows = db.execute("SELECT record FROM " + _TABLES[kind] + where + " ORDER BY id LIMIT ? OFFSET ?",
                      parameters + [limit, offset]).fetchall()
    return _page([_decoded(row[0]) for row in rows], kind, offset, limit, total)


def candidates(db, review_id, *, state=None, kind=None, offset=0, limit=25):
    review = record(db, "reviews", review_id)
    offset, limit = page(offset, limit)
    where, parameters = ["review_id=?"], [review["review_id"]]
    if state is not None:
        if state not in STATES:
            fail("CARRY_STATE_INVALID")
        where.append("state=?")
        parameters.append(state)
    if kind is not None:
        if kind not in {"group", "row"}:
            fail("CARRY_KIND_INVALID")
        where.append("kind=?")
        parameters.append(kind)
    where = " WHERE " + " AND ".join(where)
    total = db.execute("SELECT count(*) FROM sf_reconciliation_carry_candidates" + where, parameters).fetchone()[0]
    if offset > total:
        fail("PAGE_INVALID")
    rows = db.execute("SELECT record FROM sf_reconciliation_carry_candidates" + where +
                      " ORDER BY candidate_id LIMIT ? OFFSET ?", parameters + [limit, offset]).fetchall()
    return {"review_id": review_id, **_page([_decoded(row[0]) for row in rows], "candidates", offset, limit, total)}


def candidate(db, review_id, candidate_id):
    record(db, "reviews", review_id)
    candidate_id = integer(candidate_id, minimum=1)
    row = db.execute("SELECT record FROM sf_reconciliation_carry_candidates WHERE review_id=? AND candidate_id=?",
                     [review_id, candidate_id]).fetchone()
    if not row:
        fail("CARRY_CANDIDATE_NOT_FOUND")
    return _decoded(row[0])


def _scope(edition):
    original = edition["source_scope"]
    if not isinstance(original, dict):
        fail("CARRY_SOURCE_SCOPE_INVALID")
    meaning = edition["source_meanings"]
    if original.get("sourceFormat") == "TIMESCALE_COMMISSIONING":
        context = original.get("timescale")
        if (not isinstance(context, dict) or not _TIMESCALE_REQUIRED <= set(context)
                or meaning is not None):
            fail("CARRY_TIMESCALE_SCOPE_INVALID")
        stable = {key: deepcopy(value) for key, value in original.items()
                  if key not in {"snapshot", "rows", "id", "timescale"}}
        stable["timescale"] = {key: deepcopy(value) for key, value in context.items()
                               if key not in _TIMESCALE_CAPTURE}
        return {"format": "TIMESCALE_COMMISSIONING", "scope": stable,
                "continuity": "Original commissioning workspace/project, side role, native schema and complete reviewed interpretation."}
    stable = {key: deepcopy(value) for key, value in original.items()
              if key not in {"snapshot", "rows", "originalQuerySignature"}}
    if meaning is not None:
        if (not isinstance(meaning, dict) or not isinstance(meaning.get("document"), dict)
                or not isinstance(meaning.get("definition_sha256"), str)):
            fail("CARRY_SOURCE_MEANINGS_INVALID")
        return {"format": "DATASET_SEMANTICS", "scope": stable,
                "meaning": {"schema": meaning["document"].get("schema"),
                            "definition_sha256": _hex(meaning["definition_sha256"])},
                "continuity": "Original checked semantic definition and capture-independent query/field constraints."}
    # Legacy snapshots have no globally unique provider identity. An engineer's
    # free-text note is not a substitute. The exact SAME retained immutable input
    # is still usable, for example after a display-only pair revision.
    return {"format": "LEGACY_SAME_SOURCE_ONLY", "scope": stable,
            "immutable_source": {"manifest_sha256": edition["manifest_sha256"],
                                 "source_binding_sha256": edition["source_binding_sha256"]},
            "continuity": "Only the same original retained source; distinct dictionary-free captures do not prove continuity."}


def policy(before, after):
    first, second = before["review"], after["review"]
    checks, blocking = [], []
    def check(name, value, note):
        checks.append({"name": name, "equal": bool(value), "basis": note})
        if not value:
            blocking.append(name)
    check("SAME_PAIR", before["pair_id"] == after["pair_id"], "Original pair identity.")
    check("MAPPING_AND_MEANING", _same(first["definition"]["columns"], second["definition"]["columns"]),
          "Complete ordered key/value mapping, literal maps, meanings, numeric allowances and normalization policies.")
    check("CANONICAL_SQL_TYPES", _same(first["comparison_columns"], second["comparison_columns"]),
          "Exact ordered native canonical SQL types and roles.")
    check("WINDOWS", _same({k: first["definition"][k] for k in ("windows", "window_column")},
                          {k: second["definition"][k] for k in ("windows", "window_column")}),
          "Exact bounds, type, inclusion rule and selected window column.")
    check("PAIR_NOTES", _same(first["definition"]["notes"], second["definition"]["notes"]),
          "Retained operator scope/interpretation notes; display label may change.")
    check("OMITTED_COLUMNS", _same(first["omitted"], second["omitted"]),
          "Every unused original source field remains explicit.")
    check("NUMERIC_POLICY", _same(first.get("comparison_rules"), second.get("comparison_rules")),
          "Complete frozen exact/tolerance policy and unit.")
    check("NORMALIZATION_POLICY", _same(first.get("normalizations"), second.get("normalizations")),
          "Complete frozen source-unit/time interpretation and canonical representability policy.")
    captures = {}
    for side in ("source", "target"):
        a, b = first[side], second[side]
        check(side.upper() + "_IMPORT_MAPPING", _same(a["columns"], b["columns"]) and _same(a["keys"], b["keys"]),
              "Complete original SQL field/source/type/nullability mapping and import keys.")
        left, right = _scope(a), _scope(b)
        check(side.upper() + "_SOURCE_CONTINUITY", _same(left, right), left["continuity"])
        captures[side] = {"before": {k: deepcopy(a[k]) for k in
                                     ("edition_id", "row_count", "manifest_sha256", "source_binding_sha256", "source_scope")},
                          "after": {k: deepcopy(b[k]) for k in
                                    ("edition_id", "row_count", "manifest_sha256", "source_binding_sha256", "source_scope")}}
    return {"compatible": not blocking, "checks": checks, "blocking_reasons": blocking,
            "capture_changes": captures,
            "content_basis": "Exact native typed canonical/status/reason multiplicities AND every original imported SQL column, separately by side; known-group row decisions additionally require unique complete-row identity. Rows with an unresolved key have an explicit row-local exact-content basis and no paired-group assertion."}


def _checked_run(native, db, identity):
    run = native._run_on(db, _hex(identity))
    checked = native._review_on(db, run["review"]["definition"])
    if checked["review_sha256"] != run["definition_sha256"] or not _same(checked, run["review"]):
        fail("CARRY_ORIGINAL_REVIEW_CHANGED")
    return run


def _temp(request, kind):
    return "sf_carry_stage_" + request_id(request) + "_" + kind


def _group_matches(native, db, before, after, request, temporary):
    """Compare complete native bags with EXCEPT ALL; never serialize values."""
    review = before["review"]
    mapping = _temp(request, "group_matches")
    temporary.append(mapping)
    old_groups, new_groups = (_qid(table("groups", run["run_id"])) for run in (before, after))
    db.execute("CREATE TEMP TABLE " + _qid(mapping) + " AS SELECT a.group_id AS source_group_id,"
               "b.group_id AS target_group_id,false AS canonical_changed,false AS original_changed FROM " +
               old_groups + " a LEFT JOIN " + new_groups + " b ON " + native._key_equal(review, "a", "b"))
    count = len(review["definition"]["columns"])
    def canonical(run, earlier):
        projection = [("r.group_id" if earlier else "m.source_group_id") + " AS source_group_id",
                      "r.side", "r.status", "r.reason", "r.window_id"]
        projection += ["r.c" + str(i) for i in range(count)]
        source = _qid(table("rows", run["run_id"])) + " r"
        if not earlier:
            source += " JOIN " + _qid(mapping) + " m ON r.group_id=m.target_group_id"
        return "SELECT " + ",".join(projection) + " FROM " + source + " WHERE r.group_id IS NOT NULL"
    def mark(left, right, flag):
        sql = ("WITH old_rows AS (" + left + "),new_rows AS (" + right +
               "),delta AS ((SELECT * FROM old_rows EXCEPT ALL SELECT * FROM new_rows) UNION ALL "
               "(SELECT * FROM new_rows EXCEPT ALL SELECT * FROM old_rows)) "
               "UPDATE " + _qid(mapping) + " SET " + flag +
               "=true WHERE source_group_id IN (SELECT source_group_id FROM delta)")
        db.execute(sql)
    mark(canonical(before, True), canonical(after, False), "canonical_changed")
    for side in ("source", "target"):
        def originals(run, earlier):
            edition = native.workspace._record(db, "sf_editions", run[side + "_edition"])
            projection = [("r.group_id" if earlier else "m.source_group_id") + " AS source_group_id"]
            projection += ["o." + _qid(c["name"]) + " AS original_" + str(i)
                           for i, c in enumerate(edition["columns"])]
            source = (_qid(table("rows", run["run_id"])) + " r JOIN " + _qid(edition["table"]) +
                      " o ON r.row_id=o.sf_row")
            if not earlier:
                source += " JOIN " + _qid(mapping) + " m ON r.group_id=m.target_group_id"
            return ("SELECT " + ",".join(projection) + " FROM " + source +
                    " WHERE r.side=" + literal(side) + " AND r.group_id IS NOT NULL")
        mark(originals(before, True), originals(after, False), "original_changed")
    return mapping


def _row_matches(native, db, before, after, request, temporary):
    """A complete original row may move position, but duplicates stay ambiguous."""
    selected = _temp(request, "row_matches")
    temporary.append(selected)
    db.execute("CREATE TEMP TABLE " + _qid(selected) +
               "(side VARCHAR,source_row BIGINT,target_row BIGINT,source_occurrences BIGINT,target_occurrences BIGINT)")
    for side in ("source", "target"):
        def rows(run):
            edition = native.workspace._record(db, "sf_editions", run[side + "_edition"])
            values = ["r.status", "r.reason", "r.window_id"]
            values += ["r.c" + str(i) for i in range(len(run["review"]["definition"]["columns"]))]
            values += ["o." + _qid(c["name"]) for c in edition["columns"]]
            aliases = ["v" + str(i) for i in range(len(values))]
            sql = ("SELECT r.row_id," + ",".join(value + " AS " + alias for value, alias in zip(values, aliases)) +
                   " FROM " + _qid(table("rows", run["run_id"])) + " r JOIN " + _qid(edition["table"]) +
                   " o ON r.row_id=o.sf_row WHERE r.side=" + literal(side))
            return sql, aliases
        old, names = rows(before)
        new, new_names = rows(after)
        if names != new_names:
            fail("CARRY_ORIGINAL_SCHEMA_CHANGED")
        group = ",".join(names)
        join = " AND ".join("o." + name + " IS NOT DISTINCT FROM n." + name for name in names)
        sql = ("WITH old_rows AS (" + old + "),new_rows AS (" + new + "),"
               "old_counted AS (SELECT *,count(*) OVER(PARTITION BY " + group + ")::BIGINT AS occurrences FROM old_rows),"
               "new_counted AS (SELECT " + group + ",count(*)::BIGINT AS occurrences,min(row_id)::BIGINT AS matched_row"
               " FROM new_rows GROUP BY " + group + ") "
               "INSERT INTO " + _qid(selected) + " SELECT " + literal(side) +
               ",o.row_id,CASE WHEN o.occurrences=1 AND n.occurrences=1 THEN n.matched_row ELSE NULL END,"
               "o.occurrences,coalesce(n.occurrences,0) FROM old_counted o LEFT JOIN new_counted n ON " + join)
        db.execute(sql)
    return selected


def _verify_report(native, db, report):
    before = _checked_run(native, db, report["run_id"])
    if (report.get("schema") != RECONCILIATION + ".report"
            or report["pair_id"] != before["pair_id"]
            or not _same(report["review"], before["review"])
            or report["source_edition"] != before["source_edition"]
            or report["target_edition"] != before["target_edition"]
            or integer(report["review_revision"]) > before["review_revision"]):
        fail("CARRY_SOURCE_REPORT_CHANGED")
    return before


def prepare(native, db, body):
    fields(body, ("request_id", "workspace_id", "source_report_id", "target_run_id",
                  "expected_revision", "scope_basis"))
    scope_basis = text(body["scope_basis"], maximum=16000)
    report = native._record(db, "reports", _hex(body["source_report_id"]))
    before = _verify_report(native, db, report)
    after = _checked_run(native, db, body["target_run_id"])
    if after["run_id"] == before["run_id"]:
        fail("CARRY_DIFFERENT_RUN_REQUIRED")
    if before["pair_id"] != after["pair_id"]:
        fail("CARRY_SAME_PAIR_REQUIRED")
    if after["review_revision"] != integer(body["expected_revision"]):
        fail("REVIEW_REVISION_CHANGED")
    schema(db)
    compared = policy(before, after)
    temporary = []
    request = request_id(body["request_id"])
    try:
        latest = _temp(request, "source_decisions")
        temporary.append(latest)
        db.execute("CREATE TEMP TABLE " + _qid(latest) + " AS SELECT sequence,subject,record,"
                   "json_extract_string(record,'$.subject.kind') AS kind,"
                   "json_extract_string(record,'$.subject.side') AS side,"
                   "CAST(json_extract_string(record,'$.subject.group_id') AS BIGINT) AS group_id,"
                   "CAST(json_extract_string(record,'$.subject.row') AS BIGINT) AS row_id FROM (" +
                   native._latest(before["run_id"], report["review_revision"]) + ")")
        kinds = dict(db.execute("SELECT kind,count(*) FROM " + _qid(latest) + " GROUP BY kind").fetchall())
        if set(kinds) - {"group", "row"}:
            fail("CARRY_SOURCE_DECISION_CHANGED")
        group_matches = (_group_matches(native, db, before, after, request, temporary)
                         if compared["compatible"] and (kinds.get("group") or kinds.get("row")) else None)
        row_matches = (_row_matches(native, db, before, after, request, temporary)
                       if compared["compatible"] and kinds.get("row") else None)
        group_expression = "CASE WHEN d.kind='group' THEN d.group_id ELSE o.group_id END"
        selected = ["d.sequence", "d.record AS source_decision", "d.kind", "d.side",
                    group_expression + " AS group_id", "d.row_id"]
        # A row decision can describe a paired exception. Its complete known-key
        # group must remain unchanged on BOTH sides, in addition to the row's
        # own unique correspondence. Unresolved-key rows have no paired group.
        joins = (" LEFT JOIN " + _qid(table("rows", before["run_id"])) +
                 " o ON d.kind='row' AND d.side=o.side AND d.row_id=o.row_id")
        if group_matches:
            selected += ["g.target_group_id", "g.canonical_changed", "g.original_changed"]
            joins += " LEFT JOIN " + _qid(group_matches) + " g ON (" + group_expression + ")=g.source_group_id"
        else:
            selected += ["NULL::BIGINT AS target_group_id", "NULL::BOOLEAN AS canonical_changed",
                         "NULL::BOOLEAN AS original_changed"]
        if row_matches:
            selected += ["r.target_row", "r.source_occurrences", "r.target_occurrences"]
            joins += " LEFT JOIN " + _qid(row_matches) + " r ON d.kind='row' AND d.side=r.side AND d.row_id=r.source_row"
        else:
            selected += ["NULL::BIGINT AS target_row", "NULL::BIGINT AS source_occurrences",
                         "NULL::BIGINT AS target_occurrences"]
        projected = "SELECT " + ",".join(selected) + " FROM " + _qid(latest) + " d" + joins
        target_key = ("CASE WHEN p.kind='group' AND p.target_group_id IS NOT NULL THEN "
                      "'group:'||CAST(p.target_group_id AS VARCHAR) WHEN p.kind='row' AND p.target_row IS NOT NULL "
                      "THEN p.side||':'||CAST(p.target_row AS VARCHAR) ELSE NULL END")
        sql = ("SELECT p.*,t.record AS target_decision FROM (" + projected + ") p LEFT JOIN (" +
               native._latest(after["run_id"], after["review_revision"]) + ") t ON t.subject=" + target_key)
        stage = _temp(request, "candidates")
        temporary.append(stage)
        db.execute("CREATE TEMP TABLE " + _qid(stage) +
                   "(candidate_id BIGINT PRIMARY KEY,kind VARCHAR,state VARCHAR,record VARCHAR)")
        checksum, last, counts = hashlib.sha256(), 0, {state: 0 for state in STATES}
        while True:
            rows = db.execute("SELECT * FROM (" + sql + ") WHERE sequence>? ORDER BY sequence LIMIT 1000", [last]).fetchall()
            if not rows:
                break
            insert = []
            for (sequence, source_raw, kind, side, group_id, row_id, target_group_id,
                 canonical_changed, original_changed, target_row, source_occurrences,
                 target_occurrences, target_raw) in rows:
                decision = _decoded(source_raw)
                source_subject, _ = subject(decision["subject"])
                if sequence != decision["sequence"] or decision["run_id"] != before["run_id"]:
                    fail("CARRY_SOURCE_DECISION_CHANGED")
                target_subject = ({"kind": "group", "group_id": target_group_id} if kind == "group" and target_group_id is not None
                                  else {"kind": "row", "side": side, "row": target_row}
                                  if kind == "row" and target_row is not None else None)
                prior_target = _decoded(target_raw) if target_raw is not None else None
                reasons = []
                checks = {"policy_compatible": compared["compatible"], "identity_match": target_subject is not None,
                          "canonical_values_equal": (not canonical_changed if canonical_changed is not None else None),
                          "original_values_equal": (not original_changed if original_changed is not None else None),
                          "unique_row_match": (source_occurrences == 1 and target_occurrences == 1
                                               if source_occurrences is not None else None)}
                if decision["outcome"] == "OPEN":
                    state = "PRIOR_OPEN"
                    reasons.append("The frozen prior report leaves this subject OPEN; no completed disposition is available to carry.")
                elif not compared["compatible"]:
                    state = "POLICY_CHANGED"
                    reasons += compared["blocking_reasons"]
                elif group_id is not None and target_group_id is None:
                    state = "GROUP_MISSING"
                    reasons.append("No later group has this exact reviewed native key and window. Absence is not a correction.")
                elif group_id is not None and (canonical_changed or original_changed):
                    state = "VALUES_CHANGED"
                    if canonical_changed:
                        reasons.append("Canonical values, status, reason or multiplicities changed.")
                    if original_changed:
                        reasons.append("At least one complete original imported row or its side-specific multiplicity changed.")
                elif kind == "row" and not target_occurrences:
                    state = "ROW_MISSING"
                    reasons.append("No later row has this complete original typed content and canonical interpretation. Correspondence is not inferred.")
                elif kind == "row" and (source_occurrences != 1 or target_occurrences != 1):
                    state = "ROW_AMBIGUOUS"
                    reasons.append("The complete row is not unique on both sides of this history comparison; no arbitrary duplicate position is selected.")
                elif prior_target is not None:
                    state = "TARGET_REVIEWED"
                    reasons.append("The target subject already has an engineer decision, including an explicit OPEN. It will not be overwritten.")
                else:
                    state = "ELIGIBLE"
                    reasons.append("The frozen decision, source meaning, reviewed policy and complete native content match; explicit selection is still required.")
                if kind == "row" and group_id is None and checks["unique_row_match"]:
                    checks["canonical_values_equal"] = True
                    checks["original_values_equal"] = True
                value = {"candidate_id": sequence, "kind": kind, "state": state, "reasons": reasons,
                         "source_subject": source_subject, "target_subject": target_subject,
                         "source_decision": decision, "target_decision": prior_target,
                         "source_run_id": before["run_id"], "target_run_id": after["run_id"], "checks": checks}
                if kind == "row":
                    value["row_occurrences"] = {"source": source_occurrences, "target": target_occurrences}
                    value["row_group"] = {"source": group_id, "target": target_group_id,
                                          "basis": ("COMPLETE_GROUP_AND_UNIQUE_ROW" if group_id is not None
                                                    else "UNRESOLVED_KEY_ROW_ONLY")}
                raw = _json(value)
                checksum.update(raw.encode("utf-8") + b"\n")
                insert.append((sequence, kind, state, raw))
                counts[state] += 1
                last = sequence
            db.executemany("INSERT INTO " + _qid(stage) + " VALUES(?,?,?,?)", insert)
        total = sum(counts.values())
        if total != sum(kinds.values()):
            fail("CARRY_CANDIDATE_ACCOUNTING_CHANGED")
        binding = {"schema": SCHEMA + ".review", "workspace_id": read_identity(db),
                   "pair_id": before["pair_id"], "source_report_id": report["report_id"],
                   "source_report_sha256": sha(report), "source_run_id": before["run_id"],
                   "source_report_revision": report["review_revision"], "target_run_id": after["run_id"],
                   "target_review_revision": after["review_revision"], "source_review": deepcopy(before["review"]),
                   "target_review": deepcopy(after["review"]), "scope_basis": scope_basis, "policy": compared,
                   "summary": {"total": total, "eligible": counts["ELIGIBLE"], "states": counts},
                   "candidates_sha256": checksum.hexdigest()}
        identity = sha(binding)
        prior = db.execute("SELECT id FROM sf_reconciliation_carry_reviews WHERE id=?", [identity]).fetchone()
        if prior:
            return record(db, "reviews", identity)
        result = {**binding, "review_id": identity, "created_at": _now()}
        result["review_sha256"] = sha(result)
        db.execute("INSERT INTO sf_reconciliation_carry_reviews VALUES(?,?,?)", [identity, after["run_id"], _json(result)])
        db.execute("INSERT INTO sf_reconciliation_carry_candidates SELECT ?,candidate_id,kind,state,record FROM " +
                   _qid(stage), [identity])
        db.execute("UPDATE sf_workspace SET value=? WHERE key='reconciliation_schema'", [FEATURE_SCHEMA])
        return result
    finally:
        interrupted = sys.exc_info()[0] is not None
        for name in reversed(temporary):
            try:
                db.execute("DROP TABLE IF EXISTS " + _qid(name))
            except Exception:
                if not interrupted:
                    raise


def _verify_candidates(db, review):
    checksum, last, count = hashlib.sha256(), 0, 0
    while True:
        rows = db.execute("SELECT candidate_id,record FROM sf_reconciliation_carry_candidates "
                          "WHERE review_id=? AND candidate_id>? ORDER BY candidate_id LIMIT 1000",
                          [review["review_id"], last]).fetchall()
        if not rows:
            break
        for candidate_id, raw in rows:
            value = _decoded(raw)
            if value["candidate_id"] != candidate_id or raw != _json(value):
                fail("CARRY_CANDIDATE_CHANGED")
            checksum.update(raw.encode("utf-8") + b"\n")
            last, count = candidate_id, count + 1
    if count != review["summary"]["total"] or checksum.hexdigest() != review["candidates_sha256"]:
        fail("CARRY_CANDIDATE_CHANGED")


def apply(native, db, body):
    fields(body, ("request_id", "workspace_id", "review_id", "review_sha256",
                  "expected_revision", "candidate_ids", "actor", "reason"))
    review = record(db, "reviews", body["review_id"])
    if review["review_sha256"] != _hex(body["review_sha256"]):
        fail("CARRY_REVIEW_CHANGED")
    expected = integer(body["expected_revision"])
    after = _checked_run(native, db, review["target_run_id"])
    if after["review_revision"] != expected or expected != review["target_review_revision"]:
        fail("REVIEW_REVISION_CHANGED")
    report = native._record(db, "reports", review["source_report_id"])
    before = _verify_report(native, db, report)
    if (sha(report) != review["source_report_sha256"] or
            not _same(before["review"], review["source_review"]) or
            not _same(after["review"], review["target_review"]) or
            not _same(policy(before, after), review["policy"])):
        fail("CARRY_SOURCE_REPORT_CHANGED")
    if not review["policy"]["compatible"]:
        fail("CARRY_POLICY_CHANGED")
    if db.execute("SELECT 1 FROM sf_reconciliation_carry_applications WHERE review_id=?", [review["review_id"]]).fetchone():
        fail("CARRY_REVIEW_ALREADY_APPLIED")
    values = body["candidate_ids"]
    if not isinstance(values, list) or not 1 <= len(values) <= MAX_SELECTION:
        fail("CARRY_SELECTION_REQUIRED")
    selected = [integer(value, minimum=1) for value in values]
    if len(set(selected)) != len(selected):
        fail("CARRY_SELECTION_DUPLICATE")
    selected.sort()
    actor, reason = text(body["actor"], maximum=240), text(body["reason"], maximum=16000)
    _verify_candidates(db, review)
    chosen = []
    target_subjects = set()
    for selected_id in selected:
        value = candidate(db, review["review_id"], selected_id)
        if value["state"] != "ELIGIBLE" or value["target_subject"] is None:
            fail("CARRY_CANDIDATE_INELIGIBLE")
        _, key = subject(value["target_subject"])
        if key in target_subjects:
            fail("CARRY_TARGET_AMBIGUOUS")
        target_subjects.add(key)
        if db.execute("SELECT 1 FROM sf_reconciliation_decisions WHERE run_id=? AND subject=?",
                      [after["run_id"], key]).fetchone():
            fail("CARRY_TARGET_ALREADY_REVIEWED")
        original = db.execute("SELECT record FROM sf_reconciliation_decisions WHERE run_id=? AND sequence=?",
                              [before["run_id"], value["source_decision"]["sequence"]]).fetchone()
        if original is None or not _same(_decoded(original[0]), value["source_decision"]):
            fail("CARRY_SOURCE_DECISION_CHANGED")
        chosen.append(value)
    identity = sha({"schema": SCHEMA + ".application", "workspace_id": read_identity(db),
                    "request_id": request_id(body["request_id"]), "review_id": review["review_id"],
                    "review_sha256": review["review_sha256"], "candidate_ids": selected,
                    "actor": actor, "reason": reason})
    applied = []
    for value in chosen:
        origin = value["source_decision"]
        lineage = {"schema": SCHEMA + ".decision", "application_id": identity,
                   "review_id": review["review_id"], "review_sha256": review["review_sha256"],
                   "candidate_id": value["candidate_id"], "source_report_id": report["report_id"],
                   "source_report_sha256": review["source_report_sha256"], "source_run_id": before["run_id"],
                   "source_sequence": origin["sequence"], "source_subject": deepcopy(origin["subject"]),
                   "source_decision_sha256": sha(origin), "source_actor": origin["actor"],
                   "scope_basis": review["scope_basis"], "carry_reason": reason}
        decision = native._append_decision(db, after["run_id"], expected + len(applied),
            value["target_subject"], origin["outcome"], actor, origin["reason"], body["request_id"],
            carried_from=lineage)
        applied.append({"candidate_id": value["candidate_id"], "subject": decision["subject"],
                        "sequence": decision["sequence"], "outcome": decision["outcome"]})
    result = {"schema": SCHEMA + ".application", "application_id": identity, "workspace_id": read_identity(db),
              "review_id": review["review_id"], "review_sha256": review["review_sha256"],
              "source_report_id": report["report_id"], "source_report_sha256": review["source_report_sha256"],
              "source_run_id": before["run_id"], "target_run_id": after["run_id"],
              "prior_review_revision": expected, "review_revision": expected + len(applied),
              "selected_candidate_ids": selected, "applied": applied, "actor": actor, "reason": reason,
              "created_at": _now()}
    db.execute("INSERT INTO sf_reconciliation_carry_applications VALUES(?,?,?,?,?)",
               [identity, review["review_id"], after["run_id"], result["review_revision"], _json(result)])
    db.executemany("INSERT INTO sf_reconciliation_carry_members VALUES(?,?,?)",
                   [(identity, item["candidate_id"], item["sequence"]) for item in applied])
    db.execute("UPDATE sf_workspace SET value=? WHERE key='reconciliation_schema'", [FEATURE_SCHEMA])
    return result


def _reference(kind, value):
    identity = value[{"reports": "report_id", "reviews": "review_id", "applications": "application_id"}[kind]]
    result = {{"reports": "report_id", "reviews": "review_id", "applications": "application_id"}[kind]: identity,
              "sha256": sha(value)}
    if kind == "reports":
        result.update(run_id=value["run_id"], review_revision=value["review_revision"],
                      source_edition=value["source_edition"], target_edition=value["target_edition"])
    elif kind == "reviews":
        result.update(review_sha256=value["review_sha256"], source_report_id=value["source_report_id"],
                      target_run_id=value["target_run_id"], target_review_revision=value["target_review_revision"],
                      candidates_sha256=value["candidates_sha256"])
    else:
        result.update(review_id=value["review_id"], source_report_id=value["source_report_id"],
                      target_run_id=value["target_run_id"], prior_review_revision=value["prior_review_revision"],
                      review_revision=value["review_revision"], applied_count=len(value["applied"]))
    return result


def _lineage_record(native, db, kind, identity):
    return native._record(db, "reports", identity) if kind == "reports" else record(db, kind, identity)


def snapshot(native, db, run, revision):
    if not exists(db):
        return None
    rows = db.execute("SELECT record FROM sf_reconciliation_carry_applications WHERE target_run_id=? "
                      "AND review_revision<=? ORDER BY review_revision,id", [run["run_id"], revision]).fetchall()
    if not rows:
        return None
    direct = [_decoded(row[0]) for row in rows]
    pending = [("applications", value["application_id"], sha(value)) for value in direct]
    retained = {"applications": {}, "reviews": {}, "reports": {}}
    while pending:
        kind, identity, expected = pending.pop()
        if identity in retained[kind]:
            if expected is not None and retained[kind][identity]["sha256"] != expected:
                fail("CARRY_LINEAGE_CHANGED")
            continue
        if sum(len(values) for values in retained.values()) >= MAX_LINEAGE:
            fail("CARRY_LINEAGE_LIMIT")
        value = _lineage_record(native, db, kind, identity)
        reference = _reference(kind, value)
        if expected is not None and reference["sha256"] != expected:
            fail("CARRY_LINEAGE_CHANGED")
        retained[kind][identity] = reference
        if kind == "applications":
            reviewed = record(db, "reviews", value["review_id"])
            if (reviewed["review_sha256"] != value["review_sha256"] or
                    reviewed["source_report_sha256"] != value["source_report_sha256"] or
                    reviewed["target_run_id"] != value["target_run_id"]):
                fail("CARRY_LINEAGE_CHANGED")
            pending += [("reviews", reviewed["review_id"], sha(reviewed)),
                        ("reports", value["source_report_id"], value["source_report_sha256"])]
        elif kind == "reviews":
            pending.append(("reports", value["source_report_id"], value["source_report_sha256"]))
        else:
            previous = value.get("decision_carry_forward")
            if previous is not None:
                if previous.get("schema") != SCHEMA + ".lineage":
                    fail("CARRY_LINEAGE_CHANGED")
                for group in ("applications", "reviews", "reports"):
                    key = {"applications": "application_id", "reviews": "review_id", "reports": "report_id"}[group]
                    pending += [(group, item[key], item["sha256"]) for item in previous[group]]
    source_editions = {run["source_edition"], run["target_edition"]}
    for value in retained["reports"].values():
        source_editions.update((value["source_edition"], value["target_edition"]))
    return {"schema": SCHEMA + ".lineage", "applied_here": [value["application_id"] for value in direct],
            **{kind: [values[key] for key in sorted(values)] for kind, values in retained.items()},
            "source_editions": sorted(source_editions),
            "meaning": "Frozen reviews and all candidate outcomes are retained. Carried decisions remain engineer dispositions, not source corrections or automatic acceptance; later manual decisions retain their own sequence."}


def statement(run_id, revision):
    """The original saved-query/export engine receives the entire candidate set."""
    return ("SELECT a.id AS application_id,r.id AS carry_review_id,"
            "json_extract_string(r.record,'$.source_report_id') AS source_report_id,"
            "json_extract_string(r.record,'$.source_report_sha256') AS source_report_sha256,"
            "json_extract_string(r.record,'$.source_run_id') AS source_run_id,"
            "a.target_run_id,a.review_revision,c.candidate_id,c.kind,c.state,"
            "json_extract(c.record,'$.source_subject') AS source_subject,"
            "json_extract(c.record,'$.target_subject') AS target_subject,"
            "json_extract(c.record,'$.source_decision') AS source_decision_json,"
            "json_extract(c.record,'$.target_decision') AS target_decision_json,"
            "(m.sequence IS NOT NULL) AS selected,m.sequence AS applied_sequence,"
            "json_extract_string(a.record,'$.actor') AS carry_actor,"
            "json_extract_string(a.record,'$.reason') AS carry_reason,"
            "c.record AS candidate_json,r.record AS carry_review_json,a.record AS application_json "
            "FROM sf_reconciliation_carry_applications a JOIN sf_reconciliation_carry_reviews r ON a.review_id=r.id "
            "JOIN sf_reconciliation_carry_candidates c ON c.review_id=r.id "
            "LEFT JOIN sf_reconciliation_carry_members m ON m.application_id=a.id AND m.candidate_id=c.candidate_id "
            "WHERE a.target_run_id=" + literal(_hex(run_id)) + " AND a.review_revision<=" +
            str(integer(revision)) + " ORDER BY a.review_revision,a.id,c.candidate_id")


def lineage_records(native, db, report):
    lineage = report.get("decision_carry_forward")
    if lineage is None:
        return
    if lineage.get("schema") != SCHEMA + ".lineage":
        fail("CARRY_LINEAGE_CHANGED")
    for kind in ("reports", "reviews", "applications"):
        key = {"reports": "report_id", "reviews": "review_id", "applications": "application_id"}[kind]
        for reference in lineage[kind]:
            value = _lineage_record(native, db, kind, reference[key])
            if not _same(_reference(kind, value), reference):
                fail("CARRY_LINEAGE_CHANGED")
            if kind == "reviews":
                _verify_candidates(db, value)
            yield "decision-carry/" + kind + "/" + reference[key] + ".json", value


def source_editions(report):
    lineage = report.get("decision_carry_forward")
    current = {report["source_edition"], report["target_edition"]}
    if lineage is None:
        return current
    if lineage.get("schema") != SCHEMA + ".lineage":
        fail("CARRY_LINEAGE_CHANGED")
    for item in lineage["reports"]:
        current.update((_hex(item["source_edition"]), _hex(item["target_edition"])))
    if sorted(current) != lineage["source_editions"]:
        fail("CARRY_LINEAGE_CHANGED")
    return current


def validate_lineage_files(report, read_record):
    """Validate the declared complete reference graph without opening a new DB."""
    lineage = report.get("decision_carry_forward")
    if lineage is None:
        return
    source_editions(report)
    records = {}
    refs = {}
    for kind in ("reports", "reviews", "applications"):
        key = {"reports": "report_id", "reviews": "review_id", "applications": "application_id"}[kind]
        if not isinstance(lineage[kind], list):
            fail("CARRY_LINEAGE_CHANGED")
        for reference in lineage[kind]:
            identity = _hex(reference[key])
            tag = (kind, identity)
            if tag in records or len(records) >= MAX_LINEAGE:
                fail("CARRY_LINEAGE_CHANGED")
            value = read_record("decision-carry/" + kind + "/" + identity + ".json")
            if not _same(_reference(kind, value), reference):
                fail("CARRY_LINEAGE_CHANGED")
            records[tag], refs[tag] = value, reference
    used = set()
    pending = [("applications", _hex(identity)) for identity in lineage["applied_here"]]
    if len(set(pending)) != len(pending) or not pending:
        fail("CARRY_LINEAGE_CHANGED")
    for tag in pending:
        application = records.get(tag)
        if (application is None or application["target_run_id"] != report["run_id"]
                or application["review_revision"] > report["review_revision"]):
            fail("CARRY_LINEAGE_CHANGED")
    while pending:
        tag = pending.pop()
        if tag in used:
            continue
        if tag not in records:
            fail("CARRY_LINEAGE_INCOMPLETE")
        used.add(tag)
        kind, identity = tag
        value = records[tag]
        if kind == "applications":
            review_tag = ("reviews", value["review_id"])
            origin_tag = ("reports", value["source_report_id"])
            review, origin = records.get(review_tag), records.get(origin_tag)
            if (review is None or origin is None or review["review_sha256"] != value["review_sha256"]
                    or sha({k: v for k, v in review.items() if k != "review_sha256"}) != review["review_sha256"]
                    or review["source_report_id"] != origin["report_id"]
                    or sha(origin) != value["source_report_sha256"]
                    or review["source_report_sha256"] != value["source_report_sha256"]
                    or review["target_run_id"] != value["target_run_id"]
                    or review["target_review_revision"] != value["prior_review_revision"]
                    or value["review_revision"] != value["prior_review_revision"] + len(value["applied"])):
                fail("CARRY_LINEAGE_CHANGED")
            pending += [review_tag, origin_tag]
        elif kind == "reviews":
            origin_tag = ("reports", value["source_report_id"])
            origin = records.get(origin_tag)
            if origin is None or sha(origin) != value["source_report_sha256"]:
                fail("CARRY_LINEAGE_CHANGED")
            pending.append(origin_tag)
        else:
            previous = value.get("decision_carry_forward")
            if previous is not None:
                if previous.get("schema") != SCHEMA + ".lineage":
                    fail("CARRY_LINEAGE_CHANGED")
                for group in ("applications", "reviews", "reports"):
                    key = {"applications": "application_id", "reviews": "review_id", "reports": "report_id"}[group]
                    for reference in previous[group]:
                        child = (group, reference[key])
                        if child not in refs or not _same(refs[child], reference):
                            fail("CARRY_LINEAGE_INCOMPLETE")
                        pending.append(child)
    if used != set(records):
        fail("CARRY_LINEAGE_UNRELATED_RECORD")
