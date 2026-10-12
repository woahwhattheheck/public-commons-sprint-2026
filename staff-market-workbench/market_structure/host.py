"""Market-structure receiving inside the original Workspace transaction and store."""
from __future__ import annotations

import csv
import io
import json
import re
import uuid
import zipfile
from core import Problem, digest, now, stable, strict_json
from classification import engine as classification
from classification import host as classification_host
from . import engine

PROPOSALS = "market_structure_proposals"
REVIEWS = "market_structure_reviews"
DERIVATIONS = "market_structure_derivations"
PAGE_SIZE = 50
MAX_DOCUMENT = 32 * 1024 * 1024
MAX_SOURCE_PACKAGE = 128 * 1024 * 1024
ACTIONS = {"preview", "save_proposal", "review", "derive"}


def _exists(db):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (PROPOSALS,)).fetchone() is not None


def _ensure(db):
    db.execute("""CREATE TABLE IF NOT EXISTS market_structure_proposals(
        id TEXT PRIMARY KEY,created_at TEXT NOT NULL,revision INTEGER NOT NULL,
        sha256 TEXT NOT NULL,document TEXT NOT NULL)""")
    db.execute("""CREATE TABLE IF NOT EXISTS market_structure_reviews(
        id TEXT PRIMARY KEY,proposal_id TEXT NOT NULL,created_at TEXT NOT NULL,
        revision INTEGER NOT NULL,document TEXT NOT NULL,
        FOREIGN KEY(proposal_id) REFERENCES market_structure_proposals(id))""")
    db.execute("""CREATE TABLE IF NOT EXISTS market_structure_derivations(
        id TEXT PRIMARY KEY,proposal_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,
        revision INTEGER NOT NULL,document TEXT NOT NULL,
        FOREIGN KEY(proposal_id) REFERENCES market_structure_proposals(id))""")
    db.execute("CREATE INDEX IF NOT EXISTS market_structure_review_order ON market_structure_reviews(proposal_id,revision)")


def _analysis_reviews(db, identity):
    return [json.loads(row[0]) for row in db.execute(
        "SELECT document FROM reviews WHERE analysis_id=? ORDER BY created_at,rowid", (identity,))]


def _analysis(db, identity):
    row = db.execute("SELECT document,job_id FROM analyses WHERE id=?", (identity,)).fetchone()
    if not row:
        raise Problem("The original market analysis is absent", 404, "ANALYSIS_MISSING")
    value = json.loads(row[0])
    expected = digest({key: item for key, item in value.items() if key != "result_sha256"})
    if value.get("id") != identity or value.get("result_sha256") != expected or row[1] != value.get("job", {}).get("id"):
        raise Problem("The original market analysis differs from its retained identity", 409, "CONTENT_CHANGED")
    return value


def _source_metadata(db, identity):
    row = db.execute("SELECT kind,source_key,edition,raw_sha,status,imported_revision,document FROM imports WHERE id=?",
                     (identity,)).fetchone()
    if not row or row[4] != "IMPORTED":
        raise Problem("An original imported source edition is absent", 409, "SOURCE_MISSING")
    value = json.loads(row[6])
    if value.get("id") != identity or value.get("raw_sha256") != row[3]:
        raise Problem("The imported source differs from its original raw-file identity", 409, "CONTENT_CHANGED")
    blob = db.execute("SELECT name,size FROM blobs WHERE sha=?", (row[3],)).fetchone()
    if not blob or value.get("bytes") != blob[1]:
        raise Problem("The retained original source file is absent or has different size", 409, "SOURCE_MISSING")
    return {"id": identity, "kind": row[0], "source_key": row[1], "edition": row[2],
            "raw_sha256": row[3], "bytes": blob[1], "filename": value.get("filename") or blob[0],
            "status": row[4], "imported_revision": row[5], "source_document_sha256": digest(value),
            "metadata": {key: item for key, item in value.items() if key != "records"},
            "retained_record_count": len(value.get("records", []))}


def _original_record(db, record, kind):
    row = db.execute("SELECT import_id,kind,sha,document FROM records WHERE id=?", (record.get("id"),)).fetchone()
    if not row:
        raise Problem("An original analysis record is absent", 409, "RECORD_MISSING")
    retained = json.loads(row[3])
    if (row[1] != kind or row[0] != record.get("source_id") or retained != record
            or digest(record.get("record")) != row[2] or record.get("sha256") != row[2]):
        raise Problem("The analysis record differs from its native source edition", 409, "CONTENT_CHANGED")
    return retained


def analysis_snapshot(db, identity, expected=None, accepted=True):
    value = _analysis(db, identity)
    reviews = _analysis_reviews(db, identity)
    latest = reviews[-1] if reviews else None
    if accepted and (not latest or latest.get("outcome") != "accepted"
                     or latest.get("result_sha256") != value["result_sha256"] or value.get("errors")):
        raise Problem("Select the exact accepted original market analysis", 409, "ANALYSIS_REVIEW_REQUIRED",
                      {"analysis_id": identity, "latest_review": latest})
    if expected and (expected.get("expected_result_sha256") != value["result_sha256"]
                     or expected.get("expected_review_id") != (latest or {}).get("id")):
        raise Problem("The selected analysis or its latest review changed; reopen that exact source",
                      409, "ANALYSIS_SELECTION_CHANGED", {"analysis_id": identity, "latest_review": latest})
    records = [_original_record(db, value["job"], "jobs")]
    for line in value["lines"]:
        records.append(_original_record(db, line["survey"], "surveys"))
        selection = line["selection"]
        row = db.execute("SELECT document FROM selections WHERE id=?", (selection.get("id"),)).fetchone()
        if (not row or json.loads(row[0]) != selection or selection.get("job_id") != value["job"]["id"]
                or selection.get("survey_id") != line["survey"]["id"] or selection.get("outcome") != "selected"):
            raise Problem("An original selected match differs from the accepted analysis", 409, "CONTENT_CHANGED")
    sources = [_source_metadata(db, source_id) for source_id in sorted({record["source_id"] for record in records})]
    by_source = {source["id"]: source for source in sources}
    for record in records:
        if record["source_sha256"] != by_source[record["source_id"]]["raw_sha256"]:
            raise Problem("A source row differs from its original file hash", 409, "CONTENT_CHANGED")
    return {"analysis": value, "accepted_review": latest, "review_history": reviews, "sources": sources,
            "custody": "Original native analysis, selected match decisions, source rows and imported-file identities"}


def _preview(db, payload):
    value = classification.obj(payload.get("document"), "pay-structure document")
    refs = classification.unique(classification.array(value.get("analyses"), "selected analyses", engine.MAX_ANALYSES),
                                 "analysis_id")
    snapshots = {ref["analysis_id"]: analysis_snapshot(db, ref["analysis_id"], ref) for ref in refs}
    result = engine.build(value, snapshots)
    if payload.get("original") is not None:
        original = classification.obj(payload["original"], "original editable proposal")
        raw = original.get("content")
        if not isinstance(raw, str) or len(raw.encode("utf-8")) > 16 * 1024 * 1024:
            raise Problem("The retained original editable proposal must be UTF-8 text up to 16 MiB")
        parsed = strict_json(raw.lstrip("\ufeff"))
        if not isinstance(parsed, dict):
            raise Problem("The original editable proposal must contain a JSON object")
        edited = payload.get("edited_original", False)
        if not isinstance(edited, bool):
            raise Problem("edited_original must be a boolean")
        original_document = parsed.get("document", parsed)
        if not edited and original_document != value:
            raise Problem("The original imported document differs from the submitted draft; record its edits",
                          409, "IMPORTED_DOCUMENT_CHANGED")
        result["original_input"] = {"filename": classification.text(original.get("filename"), "original filename", blank=True, limit=300),
                                   "content": raw, "raw_sha256": digest(raw.encode("utf-8")), "edited_document": edited}
        result.pop("preview_sha256")
        result["preview_sha256"] = digest(result)
    if len(stable(result).encode("utf-8")) > MAX_DOCUMENT:
        raise Problem("The complete retained proposal exceeds 32 MiB; divide the professional scope", 413, "DOCUMENT_TOO_LARGE")
    return result


def _load(db, identity):
    if not _exists(db):
        raise Problem("The proposed pay structure is absent", 404, "PROPOSAL_MISSING")
    row = db.execute("SELECT sha256,document FROM market_structure_proposals WHERE id=?", (identity,)).fetchone()
    if not row:
        raise Problem("The proposed pay structure is absent", 404, "PROPOSAL_MISSING")
    value = json.loads(row[1])
    expected = digest({key: item for key, item in value.items() if key != "sha256"})
    if value.get("id") != identity or value.get("sha256") != expected or row[0] != expected:
        raise Problem("The retained proposed structure differs from its saved identity", 409, "CONTENT_CHANGED")
    return value


def _reviews(db, identity):
    if not _exists(db):
        return []
    result = [json.loads(row[0]) for row in db.execute(
        "SELECT document FROM market_structure_reviews WHERE proposal_id=? ORDER BY revision,rowid", (identity,))]
    for row in result:
        if row.get("sha256") != digest({key: value for key, value in row.items() if key != "sha256"}):
            raise Problem("The retained proposal review differs from its saved identity", 409, "CONTENT_CHANGED")
    return result


def _latest(db, identity):
    rows = _reviews(db, identity)
    return rows[-1] if rows else None


def _accepted(db, proposal, expected_review=None):
    review = _latest(db, proposal["id"])
    if (not review or review.get("outcome") != "accepted" or review.get("proposal_sha256") != proposal["sha256"]
            or (expected_review is not None and review["id"] != expected_review)):
        raise Problem("Accept and reopen this exact proposed structure before deriving its method and roles",
                      409, "PROPOSAL_REVIEW_REQUIRED", {"latest_review": review})
    return review


def _input_status(db, proposal):
    result = []
    for ref in proposal["content"]["document"]["analyses"]:
        try:
            snapshot = analysis_snapshot(db, ref["analysis_id"], ref)
            result.append({**ref, "state": "accepted", "latest_review": snapshot["accepted_review"]})
        except Problem as exc:
            result.append({**ref, "state": exc.code, "message": str(exc), "details": exc.details})
    return result


def _require_inputs(db, proposal):
    status = _input_status(db, proposal)
    if any(row["state"] != "accepted" for row in status):
        raise Problem("Reconcile the changed original analysis selections before this new acceptance or derivation",
                      409, "INPUT_REVIEW_CHANGED", {"inputs": status})
    return status


def _derivation(db, identity):
    if not _exists(db):
        return None
    row = db.execute("SELECT document FROM market_structure_derivations WHERE proposal_id=?", (identity,)).fetchone()
    if not row:
        return None
    value = json.loads(row[0])
    if value.get("sha256") != digest({key: item for key, item in value.items() if key != "sha256"}):
        raise Problem("The retained derivation differs from its original identity", 409, "CONTENT_CHANGED")
    for kind in ("method", "roles"):
        ref = value[kind]
        original = classification_host._load(db, kind, ref["id"])
        if original["sha256"] != ref["sha256"]:
            raise Problem("The derived classification edition differs from its saved identity", 409, "CONTENT_CHANGED")
    return value


def _original_input(kind, content, origin):
    raw = stable({"schema": engine.SCHEMA, "kind": kind, "content": content, "origin": origin})
    return {"filename": origin["proposal"]["id"] + "-" + kind + ".json", "format": "json",
            "content": raw, "raw_sha256": digest(raw.encode("utf-8")),
            "market_structure_origin": {"workspace_id": origin["workspace_id"],
                "proposal_id": origin["proposal"]["id"], "proposal_sha256": origin["proposal"]["sha256"],
                "derivation_id": origin["derivation_id"]}}


def dispatch(workspace, db, action, payload, revision):
    classification.obj(payload, "market-structure request")
    if action not in ACTIONS:
        raise Problem("Unknown pay-structure action", 404, "UNKNOWN_MARKET_STRUCTURE_ACTION")
    if action == "preview":
        return _preview(db, payload)
    _ensure(db)
    if action == "save_proposal":
        content = _preview(db, payload)
        if payload.get("expected_preview_sha256") != content["preview_sha256"]:
            raise Problem("Reopen the exact complete proposal preview before saving", 409, "PREVIEW_CHANGED",
                          {"current_preview_sha256": content["preview_sha256"]})
        value = {"schema": engine.SCHEMA, "kind": "proposal", "id": "market-structure-" + uuid.uuid4().hex,
                 "workspace_id": workspace.meta(db)["id"], "created_at": now(), "stored_revision": revision,
                 "created_by": classification.text(payload.get("actor"), "actor", limit=300), "content": content}
        if payload.get("supersedes"):
            previous = _load(db, classification.identity(payload["supersedes"], "superseded proposal"))
            if payload.get("expected_supersedes_sha256") != previous["sha256"]:
                raise Problem("Reopen the original proposed structure before saving its next edition",
                              409, "CONTENT_CHANGED")
            value["supersedes"] = {"id": previous["id"], "sha256": previous["sha256"]}
            value["changes"] = engine.compare(previous["content"], content)
        value["sha256"] = digest(value)
        raw = stable(value)
        if len(raw.encode("utf-8")) > MAX_DOCUMENT:
            raise Problem("The complete retained proposal exceeds 32 MiB", 413, "DOCUMENT_TOO_LARGE")
        db.execute("INSERT INTO market_structure_proposals VALUES(?,?,?,?,?)",
                   (value["id"], value["created_at"], revision, value["sha256"], raw))
        return value
    proposal = _load(db, classification.identity(payload.get("id"), "proposal id"))
    if payload.get("expected_sha256") != proposal["sha256"]:
        raise Problem("Reopen this exact proposed structure before continuing", 409, "CONTENT_CHANGED")
    if action == "review":
        outcome = payload.get("outcome")
        if outcome not in {"accepted", "changes_requested"}:
            raise Problem("Choose accepted or changes_requested")
        upstream = _require_inputs(db, proposal) if outcome == "accepted" else _input_status(db, proposal)
        review = {"schema": engine.SCHEMA, "kind": "review", "id": "market-structure-review-" + uuid.uuid4().hex,
                  "proposal_id": proposal["id"], "proposal_sha256": proposal["sha256"],
                  "created_at": now(), "stored_revision": revision,
                  "reviewer": classification.text(payload.get("reviewer"), "reviewer", limit=300),
                  "notes": classification.text(payload.get("notes"), "review notes", limit=30000),
                  "outcome": outcome, "input_reviews": upstream}
        review["sha256"] = digest(review)
        db.execute("INSERT INTO market_structure_reviews VALUES(?,?,?,?,?)",
                   (review["id"], proposal["id"], review["created_at"], revision, stable(review)))
        return review
    previous = _derivation(db, proposal["id"])
    if previous:
        return {**previous, "reused": True}
    review = _accepted(db, proposal, classification.identity(payload.get("expected_review_id"), "accepted proposal review"))
    _require_inputs(db, proposal)
    actor = classification.text(payload.get("actor"), "actor", limit=300)
    identity = "market-structure-derivation-" + uuid.uuid4().hex
    origin = {"schema": engine.SCHEMA, "workspace_id": workspace.meta(db)["id"],
              "proposal": {"id": proposal["id"], "sha256": proposal["sha256"]},
              "derivation_id": identity, "accepted_review": review,
              "original_proposal": proposal, "proposal_reviews": _reviews(db, proposal["id"])}
    method_content = classification.method(proposal["content"]["method"])
    method_doc = classification_host._save(db, "method", method_content, {"actor": actor}, revision,
                                          original=_original_input("method", method_content, origin))
    role_content = classification.role_set(proposal["content"]["roles"], method_content)
    if role_content["errors"]:
        raise Problem("Resolve the role decisions before deriving the native edition", 409, "ROLE_DECISION_ERRORS")
    for row in role_content["rows"]:
        row["native_job"] = workspace._record(db, row["native_job_id"], "jobs")
    role_origin = {key: item for key, item in origin.items() if key not in {"original_proposal", "proposal_reviews"}}
    role_origin["method"] = {"kind": "method", "id": method_doc["id"], "sha256": method_doc["sha256"]}
    roles_doc = classification_host._save(db, "roles", role_content, {"actor": actor}, revision,
        parents={"method": classification_host._ref(db, method_doc)},
        original=_original_input("roles", role_content, role_origin))
    value = {"schema": engine.SCHEMA, "kind": "derivation", "id": identity, "proposal_id": proposal["id"],
             "proposal_sha256": proposal["sha256"], "accepted_proposal_review": review,
             "created_at": now(), "stored_revision": revision, "created_by": actor,
             "method": {"kind": "method", "id": method_doc["id"], "sha256": method_doc["sha256"]},
             "roles": {"kind": "roles", "id": roles_doc["id"], "sha256": roles_doc["sha256"]},
             "review_state": "New native method and role editions await their existing classification reviews"}
    value["sha256"] = digest(value)
    db.execute("INSERT INTO market_structure_derivations VALUES(?,?,?,?,?)",
               (identity, proposal["id"], value["created_at"], revision, stable(value)))
    return value


def _cursor(identity):
    if identity == "start":
        return None
    if not isinstance(identity, str) or not re.fullmatch(r"before-[1-9][0-9]{0,18}", identity):
        raise Problem("Reopen an original result page", 422, "INVALID_PAGE")
    value = int(identity[7:])
    if value > 9223372036854775807:
        raise Problem("The original result page is outside the native row-ID range", 422, "INVALID_PAGE")
    return value


def _analysis_metadata(db, value):
    reviews = _analysis_reviews(db, value["id"])
    return {"id": value["id"], "title": value["title"], "created_at": value["created_at"],
            "result_sha256": value["result_sha256"], "job_id": value["job"]["id"],
            "job_title": value["job"]["record"]["title"], "job_source_name": value["job"]["source_name"],
            "job_edition": value["job"]["edition"], "currency": value["currency"],
            "consensus": value["consensus"], "target_date": value.get("target_date"),
            "source_mode": value.get("source_mode"), "latest_review": reviews[-1] if reviews else None,
            "errors": value.get("errors", []), "source_count": len(value["lines"])}


def _proposal_metadata(db, value):
    content = value["content"]["document"]
    return {"id": value["id"], "sha256": value["sha256"], "created_at": value["created_at"],
            "created_by": value["created_by"], "name": content["name"], "edition": content["edition"],
            "currency": content["currency"], "grades": len(content["grades"]), "roles": len(content["roles"]),
            "analyses": len(content["analyses"]), "latest_review": _latest(db, value["id"]),
            "derivation": _derivation(db, value["id"]), "supersedes": value.get("supersedes")}


def _page(db, kind, identity):
    before = _cursor(identity)
    table = "analyses" if kind == "analysis-page" else PROPOSALS
    if table == PROPOSALS and not _exists(db):
        return {"items": [], "next": None, "total": 0, "page_size": PAGE_SIZE}
    sql = "SELECT rowid,document FROM " + table
    params = []
    if before is not None:
        sql += " WHERE rowid<?"
        params.append(before)
    rows = db.execute(sql + " ORDER BY rowid DESC LIMIT ?", (*params, PAGE_SIZE + 1)).fetchall()
    selected = rows[:PAGE_SIZE]
    projector = _analysis_metadata if table == "analyses" else _proposal_metadata
    return {"items": [projector(db, json.loads(row[1])) for row in selected],
            "next": "before-" + str(selected[-1][0]) if len(rows) > PAGE_SIZE else None,
            "total": db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0], "page_size": PAGE_SIZE}


def state(workspace, db):
    meta = workspace.meta(db)
    return {"schema": engine.SCHEMA, "workspace_id": meta["id"], "revision": meta["revision"],
            "analyses": _page(db, "analysis-page", "start"), "proposals": _page(db, "proposal-page", "start"),
            "measures": list(engine.MEASURES), "rate_basis": "annual_fulltime",
            "range_modes": ["analysis_measures", "entered", "reference_percent"]}


def document(workspace, db, kind, identity):
    if kind in {"analysis-page", "proposal-page"}:
        return _page(db, kind, identity)
    if kind == "analysis":
        return analysis_snapshot(db, identity, accepted=False)
    if kind == "proposal":
        proposal = _load(db, identity)
        return {**proposal, "reviews": _reviews(db, identity), "input_status": _input_status(db, proposal),
                "derivation": _derivation(db, identity)}
    if kind == "derivation":
        value = _derivation(db, identity)
        if value:
            return value
    raise Problem("Choose an original analysis, proposal or derived edition", 404, "DOCUMENT_MISSING")


def _package(db, proposal):
    value = {"schema": engine.SCHEMA, "root": {"kind": "proposal", "id": proposal["id"], "sha256": proposal["sha256"]},
             "proposal": proposal, "reviews": _reviews(db, proposal["id"]),
             "current_input_status": _input_status(db, proposal), "derivation": _derivation(db, proposal["id"])}
    if value["derivation"]:
        roles = classification_host._load(db, "roles", value["derivation"]["roles"]["id"])
        value["classification_editions"] = classification_host._package(db, roles)
    return value


def _csv(db, proposal, accepted_review):
    stream = io.StringIO(newline="")
    columns = ["role_id", "native_job_id", "job_title", "role_analysis_id", "grade_id", "grade_label",
               "currency", "rate_basis", "minimum", "reference", "maximum", "reference_label",
               "anchor_analysis_id", "anchor_analysis_sha256", "anchor_review_id", "range_mode", "rounding",
               "reference_mode", "reference_measure", "retained_target_date", "date_basis", "date_basis_note",
               "method_effective_date", "method_effective_timing", "grade_rationale", "role_rationale",
               "source_use_note", "proposal_id", "proposal_sha256", "proposal_acceptance_id",
               "anchor_current_state", "anchor_current_review_id", "anchor_current_review_outcome",
               "role_current_state", "role_current_review_id", "role_current_review_outcome"]
    writer = csv.DictWriter(stream, fieldnames=columns)
    writer.writeheader()
    content = proposal["content"]
    decisions = {row["id"]: row for row in content["document"]["grades"]}
    grades = {row["id"]: row for row in content["method"]["grades"]}
    roles = {row["id"]: row for row in content["roles"]["rows"]}
    inputs = {row["analysis"]["id"]: row for row in content["inputs"]}
    states = {row["analysis_id"]: row for row in _input_status(db, proposal)}
    for state in states.values():
        reviews = _analysis_reviews(db, state["analysis_id"])
        state["current_review"] = reviews[-1] if reviews else {}
    for decision in content["document"]["roles"]:
        role, grade = roles[decision["id"]], grades[decision["grade_id"]]
        grade_decision = decisions[grade["id"]]
        snapshot = inputs[grade_decision["analysis_id"]]
        analysis, review = snapshot["analysis"], snapshot["accepted_review"]
        anchor_state, role_state = states[analysis["id"]], states[decision["analysis_id"]]
        writer.writerow({"role_id": role["id"], "native_job_id": role["native_job_id"], "job_title": role["title"],
            "role_analysis_id": decision["analysis_id"], "grade_id": grade["id"], "grade_label": grade["label"],
            "currency": content["method"]["currency"], "rate_basis": "annual_fulltime", "minimum": grade["min"],
            "reference": grade["reference"], "maximum": grade["max"], "reference_label": grade["reference_label"],
            "anchor_analysis_id": analysis["id"], "anchor_analysis_sha256": analysis["result_sha256"],
            "anchor_review_id": review["id"], "range_mode": grade_decision["range_mode"],
            "rounding": grade_decision["rounding"], "reference_mode": grade_decision["reference_mode"],
            "reference_measure": grade_decision["reference_measure"], "retained_target_date": analysis.get("target_date"),
            "date_basis": content["document"]["date_basis"], "date_basis_note": content["document"]["date_basis_note"],
            "method_effective_date": content["method"]["effective_date"],
            "method_effective_timing": content["method"]["effective_timing"],
            "grade_rationale": grade_decision["rationale"], "role_rationale": decision["rationale"],
            "source_use_note": content["document"]["source_use_note"], "proposal_id": proposal["id"],
            "proposal_sha256": proposal["sha256"], "proposal_acceptance_id": accepted_review["id"],
            "anchor_current_state": anchor_state["state"],
            "anchor_current_review_id": anchor_state["current_review"].get("id"),
            "anchor_current_review_outcome": anchor_state["current_review"].get("outcome"),
            "role_current_state": role_state["state"],
            "role_current_review_id": role_state["current_review"].get("id"),
            "role_current_review_outcome": role_state["current_review"].get("outcome")})
    return stream.getvalue().encode("utf-8")


def _source_package(db, proposal, package):
    sources = {}
    for snapshot in proposal["content"]["inputs"]:
        for source in snapshot["sources"]:
            if source["id"] in sources and sources[source["id"]] != source:
                raise Problem("The retained source identities disagree", 409, "CONTENT_CHANGED")
            sources[source["id"]] = source
    if sum(source["bytes"] for source in sources.values()) > MAX_SOURCE_PACKAGE:
        raise Problem("Selected original source files exceed 128 MiB; use the complete native workspace save",
                      413, "SOURCE_PACKAGE_TOO_LARGE")
    buffer = io.BytesIO()
    manifest = []
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        def write(name, data):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100600 << 16
            archive.writestr(info, data)
        for source in sorted(sources.values(), key=lambda value: value["id"]):
            row = db.execute("SELECT data,size FROM blobs WHERE sha=?", (source["raw_sha256"],)).fetchone()
            if not row or row[1] != source["bytes"] or len(row[0]) != source["bytes"] or digest(row[0]) != source["raw_sha256"]:
                raise Problem("The original source bytes differ from the accepted custody", 409, "CONTENT_CHANGED")
            safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", source["filename"])[:150] or "original"
            path = "original-sources/" + source["id"] + "/" + safe_name
            write(path, row[0])
            manifest.append({**source, "path": path})
        write("accepted-proposal.json", (json.dumps(package, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8"))
        write("source-manifest.json", (json.dumps({"schema": engine.SCHEMA, "sources": manifest},
                                                 ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8"))
    return buffer.getvalue()


def download(workspace, db, kind, identity):
    proposal = _load(db, identity)
    if kind == "editable":
        value = {"schema": engine.SCHEMA, "kind": "proposal", "document": proposal["content"]["submitted_document"],
                 "origin": {"id": proposal["id"], "sha256": proposal["sha256"], "workspace_id": proposal["workspace_id"]}}
    elif kind in {"accepted-package", "accepted-csv", "source-package"}:
        review = _accepted(db, proposal)
        if kind == "accepted-csv":
            return {"data": _csv(db, proposal, review), "content_type": "text/csv; charset=utf-8",
                    "filename": identity + "-accepted.csv"}
        value = _package(db, proposal)
        value["accepted_review"] = review
        if kind == "source-package":
            return {"data": _source_package(db, proposal, value), "content_type": "application/zip",
                    "filename": identity + "-original-sources.zip"}
    else:
        raise Problem("Choose editable, accepted-package, accepted-csv or source-package", 404, "EXPORT_MISSING")
    return {"data": (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8"),
            "content_type": "application/json; charset=utf-8", "filename": identity + "-" + kind + ".json"}
