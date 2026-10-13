"""Classification extension inside the original workspace's one transaction."""
from __future__ import annotations

import json
import uuid
from core import Problem, digest, now, stable, strict_json
from . import engine, receiving

TABLE = "classification_documents"
REVIEWS = "classification_reviews"
MAX_DOCUMENT = 32 * 1024 * 1024
ACTION_NAMES = ("save_method", "save_roles", "save_roster", "preview_scenario", "save_scenario", "review",
                "preview_package", "receive_package")


def _exists(db):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (TABLE,)).fetchone() is not None


def _ensure(db):
    db.execute("""CREATE TABLE IF NOT EXISTS classification_documents(
        id TEXT PRIMARY KEY,kind TEXT NOT NULL,created_at TEXT NOT NULL,
        revision INTEGER NOT NULL,sha256 TEXT NOT NULL,document TEXT NOT NULL)""")
    db.execute("""CREATE TABLE IF NOT EXISTS classification_reviews(
        id TEXT PRIMARY KEY,document_id TEXT NOT NULL,created_at TEXT NOT NULL,
        revision INTEGER NOT NULL,document TEXT NOT NULL,
        FOREIGN KEY(document_id) REFERENCES classification_documents(id))""")
    db.execute("CREATE INDEX IF NOT EXISTS classification_review_order ON classification_reviews(document_id,revision)")


def _load(db, kind, identity):
    if kind not in engine.KINDS or not _exists(db):
        raise Problem("Classification document is absent", 404, "CLASSIFICATION_DOCUMENT_MISSING")
    row = db.execute("SELECT sha256,document FROM classification_documents WHERE kind=? AND id=?", (kind, identity)).fetchone()
    if not row:
        raise Problem("Classification document is absent", 404, "CLASSIFICATION_DOCUMENT_MISSING")
    doc = json.loads(row[1])
    expected = digest({k: v for k, v in doc.items() if k != "sha256"})
    if doc.get("sha256") != expected or row[0] != expected:
        raise Problem("The saved classification document differs from its original identity", 409, "CONTENT_CHANGED")
    return doc


def _reviews(db, identity):
    return [json.loads(r[0]) for r in db.execute(
        "SELECT document FROM classification_reviews WHERE document_id=? ORDER BY revision,rowid", (identity,))]


def _latest(db, identity):
    rows = _reviews(db, identity)
    return rows[-1] if rows else None


def _ref(db, doc):
    return {"kind": doc["kind"], "id": doc["id"], "sha256": doc["sha256"], "review_at_selection": _latest(db, doc["id"])}


def _parent(db, ref):
    doc = _load(db, ref["kind"], ref["id"])
    if ref["sha256"] != doc["sha256"]:
        raise Problem("An original input reference differs from its retained document", 409, "CONTENT_CHANGED")
    return doc


def _accepted(db, doc):
    review = _latest(db, doc["id"])
    if not review or review["outcome"] != "accepted" or review["document_sha256"] != doc["sha256"]:
        raise Problem("Accept the exact " + doc["kind"] + " edition before accepting its dependent result",
                      409, "INPUT_REVIEW_REQUIRED", {"kind": doc["kind"], "id": doc["id"]})
    return review


def _save(db, kind, content, payload, revision, parents=None, original=None):
    _ensure(db)
    doc = {"schema": engine.SCHEMA, "kind": kind, "id": "classification-" + kind + "-" + uuid.uuid4().hex,
           "created_at": now(), "created_by": engine.text(payload.get("actor"), "actor", limit=300),
           "stored_revision": revision, "content": content, "parents": parents or {}}
    if payload.get("supersedes"):
        old = _load(db, kind, engine.identity(payload["supersedes"], "supersedes"))
        doc["supersedes"] = {"id": old["id"], "sha256": old["sha256"]}
    if original:
        doc["original_input"] = original
    doc["sha256"] = digest(doc)
    raw = stable(doc)
    if len(raw.encode("utf-8")) > MAX_DOCUMENT:
        raise Problem("The complete classification document exceeds 32 MiB", 413, "DOCUMENT_TOO_LARGE")
    db.execute("INSERT INTO classification_documents VALUES(?,?,?,?,?,?)",
               (doc["id"], kind, doc["created_at"], revision, doc["sha256"], raw))
    return doc


def _editable_value(parsed, kind):
    """Read the original editable export without importing someone else's reviews."""
    parsed = engine.obj(parsed, kind + " input")
    if "root" in parsed and "documents" in parsed:
        root = engine.obj(parsed["root"], "export root")
        candidates = [row for row in engine.array(parsed["documents"], "export documents")
                      if isinstance(row, dict) and row.get("id") == root.get("id")]
        if root.get("kind") != kind or len(candidates) != 1:
            raise Problem("Select an editable " + kind + " document")
        saved = candidates[0]
        expected = digest({key: value for key, value in saved.items() if key not in {"sha256", "reviews"}})
        if saved.get("sha256") != expected or root.get("sha256") != expected:
            raise Problem("The exported root differs from its original content identity", 409, "CONTENT_CHANGED")
        parsed = saved
    if "content" in parsed:
        if parsed.get("kind", kind) != kind:
            raise Problem("Select an editable " + kind + " document")
        parsed = engine.obj(parsed["content"], kind + " content")
    return dict(parsed)


def _input(payload, kind):
    value = _editable_value(payload.get("document", {}), kind)
    edited_rows = payload.get("edited_rows", False)
    if not isinstance(edited_rows, bool):
        raise Problem("edited_rows must be a boolean")
    retained_edits = value.get("rows") if edited_rows else None
    original = None
    if payload.get("content") is not None:
        content = payload["content"]
        format_name = "json" if kind == "method" else payload.get("format", "csv")
        if format_name == "json":
            if not isinstance(content, str) or len(content.encode("utf-8")) > MAX_DOCUMENT:
                raise Problem("The editable input exceeds 32 MiB")
            parsed = strict_json(content.lstrip("\ufeff"))
            imported = {"rows": parsed} if isinstance(parsed, list) and kind != "method" else _editable_value(parsed, kind)
            value = {**imported, **value}
            original = {"content": content, "format": "json", "raw_sha256": digest(content.encode("utf-8"))}
            if kind != "method":
                value["rows"] = engine.mapped_rows({"rows": engine.array(imported.get("rows"), "import rows")},
                                                   payload.get("mapping"))
                original["mapping"] = payload.get("mapping")
        else:
            original = engine.read_rows(content, format_name)
            value["rows"] = engine.mapped_rows(original, payload.get("mapping"))
            original = {k: v for k, v in original.items() if k != "rows"}
            original["mapping"] = payload.get("mapping")
        original["filename"] = engine.text(payload.get("filename"), "filename", blank=True, limit=300)
        if edited_rows:
            if kind != "method":
                value["rows"] = engine.array(retained_edits, "edited original rows")
                original["edited_rows"] = True
            else:
                original["edited_document"] = True
    for row in value.get("rows", []):
        if not isinstance(row, dict):
            raise Problem("Every original input row must be an object")
        for key in ("ratings", "source_refs"):
            if isinstance(row.get(key), str):
                row[key] = strict_json(row[key]) if row[key].strip() else []
    return value, original


def _scenario_inputs(db, payload):
    structure = _load(db, "method", engine.identity(payload.get("method_id"), "method_id"))
    roles = _load(db, "roles", engine.identity(payload.get("roles_id"), "roles_id"))
    workforce = _load(db, "roster", engine.identity(payload.get("roster_id"), "roster_id"))
    if roles["parents"].get("method", {}).get("id") != structure["id"]:
        raise Problem("The role edition belongs to a different proposed classification method", 409, "INPUT_EDITION_MISMATCH")
    if workforce["parents"].get("roles", {}).get("id") != roles["id"]:
        raise Problem("The workforce edition belongs to a different role edition", 409, "INPUT_EDITION_MISMATCH")
    inputs = {"method": structure, "roles": roles, "roster": workforce}
    baseline = None
    if payload.get("baseline_method_id"):
        baseline = _load(db, "method", engine.identity(payload["baseline_method_id"], "baseline_method_id"))
        inputs["baseline_method"] = baseline
    result = engine.scenario(structure["content"], roles["content"], workforce["content"],
                             payload.get("config"), baseline["content"] if baseline else None)
    parents = {k: _ref(db, doc) for k, doc in inputs.items()}
    result["inputs"] = {k: {"id": doc["id"], "kind": doc["kind"], "sha256": doc["sha256"]} for k, doc in inputs.items()}
    result.pop("preview_sha256")
    result["preview_sha256"] = digest(result)
    return result, parents


def dispatch(workspace, db, action, payload, revision):
    engine.obj(payload, "classification request")
    if action not in ACTION_NAMES:
        raise Problem("Unknown classification action", 404, "UNKNOWN_CLASSIFICATION_ACTION")
    _ensure(db)
    if action in {"preview_package", "receive_package"}:
        return receiving.dispatch(workspace, db, action, payload, revision)
    if action == "save_method":
        value, original = _input(payload, "method")
        return _save(db, "method", engine.method(value), payload, revision, original=original)
    if action == "save_roles":
        method_doc = _load(db, "method", engine.identity(payload.get("method_id"), "method_id"))
        value, original = _input(payload, "roles")
        content = engine.role_set(value, method_doc["content"])
        for row in content["rows"]:
            if row.get("native_job_id"):
                original_job = workspace._record(db, row["native_job_id"], "jobs")
                row["native_job"] = original_job
        return _save(db, "roles", content, payload, revision,
                     parents={"method": _ref(db, method_doc)}, original=original)
    if action == "save_roster":
        roles = _load(db, "roles", engine.identity(payload.get("roles_id"), "roles_id"))
        value, original = _input(payload, "roster")
        content = engine.roster(value, roles["content"])
        method_doc = _parent(db, roles["parents"]["method"])
        if content["currency"] != method_doc["content"]["currency"]:
            raise Problem("The workforce currency differs from its original classification method")
        return _save(db, "roster", content, payload, revision,
                     parents={"roles": _ref(db, roles), "method": _ref(db, method_doc)}, original=original)
    if action in {"preview_scenario", "save_scenario"}:
        result, parents = _scenario_inputs(db, payload)
        if action == "preview_scenario":
            return result
        if payload.get("expected_preview_sha256") != result["preview_sha256"]:
            raise Problem("Reopen the exact calculation preview before retaining this scenario",
                          409, "PREVIEW_CHANGED", {"current_preview_sha256": result["preview_sha256"]})
        return _save(db, "scenario", result, payload, revision, parents=parents)
    kind = engine.text(payload.get("kind"), "review kind", limit=30)
    doc = _load(db, kind, engine.identity(payload.get("id"), "document id"))
    if payload.get("expected_sha256") != doc["sha256"]:
        raise Problem("Reopen the exact document before saving its review", 409, "CONTENT_CHANGED")
    outcome = payload.get("outcome")
    if outcome not in {"accepted", "changes_requested"}:
        raise Problem("Choose accepted or changes_requested")
    upstream = {}
    if outcome == "accepted":
        if doc["content"].get("errors"):
            raise Problem("Resolve the displayed input or calculation errors before accepting this edition",
                          409, "CALCULATION_ERRORS", {"errors": doc["content"]["errors"]})
        for key, ref in doc["parents"].items():
            parent = _parent(db, ref)
            upstream[key] = _accepted(db, parent)
    review = {"schema": engine.SCHEMA, "kind": "review", "id": "classification-review-" + uuid.uuid4().hex,
              "document_id": doc["id"], "document_kind": doc["kind"], "document_sha256": doc["sha256"],
              "created_at": now(), "stored_revision": revision,
              "reviewer": engine.text(payload.get("reviewer"), "reviewer", limit=300),
              "outcome": outcome, "notes": engine.text(payload.get("notes"), "review notes", limit=30000),
              "upstream_reviews": upstream}
    review["sha256"] = digest(review)
    db.execute("INSERT INTO classification_reviews VALUES(?,?,?,?,?)",
               (review["id"], doc["id"], review["created_at"], revision, stable(review)))
    return review


def _metadata(db, doc):
    value = doc["content"]
    return {"id": doc["id"], "kind": doc["kind"], "sha256": doc["sha256"], "created_at": doc["created_at"],
            "created_by": doc["created_by"], "name": value.get("name") or value.get("config", {}).get("title"),
            "edition": value.get("edition", ""), "rows": len(value.get("rows", value.get("grades", []))),
            "errors": len(value.get("errors", [])), "warnings": len(value.get("warnings", [])),
            "currency": value.get("currency"), "data_kind": value.get("data_kind"),
            "parents": doc["parents"], "latest_review": _latest(db, doc["id"]),
            "totals": value.get("totals"), "supersedes": doc.get("supersedes"),
            "received_packages": receiving.origins(db, doc["id"])}


def state(workspace, db):
    result = {"schema": engine.SCHEMA, "workspace_id": workspace.meta(db)["id"],
              "revision": workspace.meta(db)["revision"], "methods": [], "roles": [], "rosters": [], "scenarios": [],
              "received_packages": receiving.page(workspace, db)}
    if not _exists(db):
        return result
    groups = {"method": "methods", "roles": "roles", "roster": "rosters", "scenario": "scenarios"}
    for row in db.execute("SELECT document FROM classification_documents ORDER BY revision DESC,rowid DESC"):
        doc = json.loads(row[0])
        result[groups[doc["kind"]]].append(_metadata(db, doc))
    return result


def document(workspace, db, kind, identity):
    if kind == "received":
        return receiving.document(workspace, db, identity)
    if kind == "received-page":
        return receiving.page(workspace, db, identity)
    doc = _load(db, kind, identity)
    return {**doc, "reviews": _reviews(db, doc["id"])}


def _package(db, doc):
    """An export contains all original referenced editions and actual reviews."""
    originals, pending = {}, [doc]
    while pending:
        current = pending.pop()
        if current["id"] in originals:
            continue
        originals[current["id"]] = {**current, "reviews": _reviews(db, current["id"])}
        for ref in current["parents"].values():
            pending.append(_parent(db, ref))
    return {"schema": engine.SCHEMA, "root": {"id": doc["id"], "kind": doc["kind"], "sha256": doc["sha256"]},
            "documents": list(originals.values())}


def download(workspace, db, kind, identity):
    if kind in {"received-original", "received-manifest", "received-member"}:
        return receiving.download(workspace, db, kind, identity)
    if kind in {"scenario-csv", "scenario-package"}:
        doc = _load(db, "scenario", identity)
        review = _accepted(db, doc)
        if kind == "scenario-csv":
            return {"data": engine.csv_export(doc["content"]["rows"]), "content_type": "text/csv; charset=utf-8",
                    "filename": identity + "-accepted.csv"}
        result = _package(db, doc)
        result["accepted_review"] = review
    elif kind in engine.KINDS:
        doc = _load(db, kind, identity)
        result = {"schema": engine.SCHEMA, "kind": kind, "content": doc["content"],
                  "origin": {"id": doc["id"], "sha256": doc["sha256"],
                             "created_at": doc["created_at"], "parents": doc["parents"]}}
        if doc.get("original_input"):
            result["original_input"] = doc["original_input"]
    else:
        raise Problem("Choose an original classification document or accepted scenario export", 404)
    return {"data": (json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8"),
            "content_type": "application/json; charset=utf-8", "filename": identity + "-editable.json"}
