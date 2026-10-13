"""Receive original accepted classification exports in the native Workspace.

The original documents and reviews remain unchanged. Local receipt/revision
columns record this receiving operation; exported history is never represented
as an absent original workspace database or operation journal.
"""
from __future__ import annotations

import base64
import binascii
from datetime import datetime
import io
import json
from pathlib import PurePosixPath
import re
import stat
import uuid
import zipfile

from core import Problem, digest, now, stable
from . import engine

SCHEMA = "staff-market.classification-receiving/v1"
TABLE = "classification_received_packages"
LINKS = "classification_received_documents"
MAX_SOURCE = 24 * 1024 * 1024
MAX_EXPANDED = 128 * 1024 * 1024
MAX_FILES = 128
MAX_DOCUMENTS = 512
MAX_REVIEWS = 4096


def _host():
    from . import host
    return host


def _require(condition, message, code="PACKAGE_INVALID"):
    if not condition:
        raise Problem(message, 422, code)


def _text(value, label, blank=False, limit=10000):
    return engine.text(value, label, blank=blank, limit=limit)


def _sha(value, label):
    _require(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value), label + " must be an original SHA-256")
    return value


def _timestamp(value, label):
    _text(value, label, limit=100)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise Problem("Invalid " + label) from exc
    _require(parsed.tzinfo is not None, label + " must retain its timezone")


def _signed(value, label, excluded=()):
    _require(isinstance(value, dict), label + " must be an object")
    selected = _sha(value.get("sha256"), label + " identity")
    try:
        calculated = digest({key: item for key, item in value.items() if key not in {"sha256", *excluded}})
    except (ValueError, TypeError, OverflowError) as exc:
        raise Problem(label + " contains an unsupported or non-finite value") from exc
    _require(selected == calculated, label + " differs from its retained content identity", "CONTENT_CHANGED")


def _json(raw, label):
    def pairs(items):
        result = {}
        for key, value in items:
            _require(key not in result, "Duplicate JSON field in " + label + ": " + key)
            result[key] = value
        return result
    try:
        # Match original host._load JSON number semantics. Raw bytes remain in blobs.
        value = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=pairs,
                           parse_constant=lambda value: (_ for _ in ()).throw(ValueError("non-finite number")))
        stable(value)
        return value
    except (UnicodeError, ValueError, TypeError, OverflowError, RecursionError) as exc:
        raise Problem("Read a complete finite UTF-8 JSON export: " + label) from exc


def _source(payload):
    encoded = payload.get("content_base64")
    _require(isinstance(encoded, str) and 0 < len(encoded) <= ((MAX_SOURCE + 2) // 3) * 4,
             "Select a complete classification JSON or ZIP no larger than 24 MiB")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise Problem("The retained source must be complete base64 bytes") from exc
    _require(0 < len(raw) <= MAX_SOURCE, "Select a complete source no larger than 24 MiB")
    source_sha = digest(raw)
    _require(_sha(payload.get("expected_source_sha256"), "Source") == source_sha,
             "The selected source bytes changed", "CONTENT_CHANGED")
    _text(payload.get("filename"), "filename", limit=300)
    filename = payload["filename"]
    _require(PurePosixPath(filename).name == filename and "\\" not in filename and "\0" not in filename,
             "Keep the original source filename without directory components")
    context = {
        "actor": _text(payload.get("actor"), "receiving operator", limit=300),
        "origin_workspace_id": _text(payload.get("origin_workspace_id"), "original workspace ID", blank=True, limit=200),
        "source_ref": _text(payload.get("source_ref"), "source handoff reference", limit=3000),
        "notes": _text(payload.get("notes"), "receiving notes", blank=True, limit=30000),
    }
    return raw, {"filename": filename, "bytes": len(raw), "sha256": source_sha}, context


def _members(raw, filename):
    if not raw.startswith(b"PK"):
        _require(filename.lower().endswith(".json"), "Choose the original accepted JSON or a ZIP of its exports")
        return [(filename, raw)]
    result = []
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as package:
            infos = package.infolist()
            _require(1 <= len(infos) <= MAX_FILES, "The source ZIP must contain 1–128 original files")
            _require(len({item.filename for item in infos}) == len(infos), "The source ZIP repeats a member name")
            _require(sum(item.file_size for item in infos) <= MAX_EXPANDED, "Expanded source files exceed 128 MiB")
            for item in infos:
                name = item.filename
                path = PurePosixPath(name)
                kind = stat.S_IFMT(item.external_attr >> 16)
                _require(not item.is_dir() and kind in (0, stat.S_IFREG), "Receive regular source members only")
                _require(not path.is_absolute() and ".." not in path.parts and "\\" not in name and "\0" not in name
                         and str(path) == name and path.suffix.lower() in {".json", ".csv"},
                         "A source member is outside the original JSON/CSV export format: " + name)
                _require(not (item.flag_bits & 1), "Receive an unencrypted original export")
                _require(item.file_size <= _host().MAX_DOCUMENT, "An original member exceeds 32 MiB")
                value = package.read(item)
                _require(len(value) == item.file_size, "The source member is incomplete: " + name)
                result.append((name, value))
    except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError, EOFError, NotImplementedError) as exc:
        raise Problem("The original ZIP could not be read completely") from exc
    return result


def _document(value):
    _signed(value, "Original document", ("reviews",))
    _require(value.get("schema") == engine.SCHEMA and value.get("kind") in engine.KINDS,
             "Receive the original classification document schema")
    identity = engine.identity(value.get("id"), "original document ID")
    _timestamp(value.get("created_at"), "original document time")
    _text(value.get("created_by"), "original document author", limit=300)
    _require(type(value.get("stored_revision")) is int and value["stored_revision"] > 0,
             "Retain the original document revision")
    content = engine.obj(value.get("content"), "original content")
    parents = engine.obj(value.get("parents"), "original parent references")
    expected = {"method": set(), "roles": {"method"}, "roster": {"method", "roles"},
                "scenario": {"method", "roles", "roster"}}[value["kind"]]
    actual = set(parents)
    _require(actual == expected or (value["kind"] == "scenario" and actual == expected | {"baseline_method"}),
             "The original parent reference set is incomplete or unsupported")
    row_key = "grades" if value["kind"] == "method" else "rows"
    rows = engine.array(content.get(row_key), "original " + row_key, maximum=25000, empty=False)
    _require(all(isinstance(row, dict) for row in rows), "Every original content row must be an object")
    for key, ref in parents.items():
        engine.obj(ref, "original input reference")
        target_kind = "method" if key == "baseline_method" else key
        _require(ref.get("kind") == target_kind, "The original input kind differs")
        engine.identity(ref.get("id"), "original input ID")
        _sha(ref.get("sha256"), "Original input")
    reviews = value.get("reviews")
    _require(isinstance(reviews, list) and len(reviews) <= MAX_REVIEWS,
             "Retain the complete original review array")
    seen = set()
    for review in reviews:
        _signed(review, "Original review")
        _require(review.get("schema") == engine.SCHEMA and review.get("kind") == "review",
                 "Receive the original review schema")
        review_id = engine.identity(review.get("id"), "original review ID")
        _require(review_id not in seen, "The document repeats an original review")
        seen.add(review_id)
        _require(review.get("document_id") == identity and review.get("document_kind") == value["kind"]
                 and review.get("document_sha256") == value["sha256"], "The review belongs to another document")
        _timestamp(review.get("created_at"), "original review time")
        _require(type(review.get("stored_revision")) is int and review["stored_revision"] > 0,
                 "Retain the original review revision")
        _text(review.get("reviewer"), "original reviewer", limit=300)
        _text(review.get("notes"), "original review notes", limit=30000)
        _require(review.get("outcome") in {"accepted", "changes_requested"}, "Unknown original review outcome")
        upstream = engine.obj(review.get("upstream_reviews"), "original review inputs")
        _require(set(upstream) == (actual if review["outcome"] == "accepted" else set()),
                 "The original review's input acceptance is incomplete")
        if review["outcome"] == "accepted":
            _require(not content.get("errors"), "An accepted original edition still contains calculation errors")
    return {key: item for key, item in value.items() if key != "reviews"}, reviews


def _same_prefix(left, right):
    return len(left) <= len(right) and all(stable(a) == stable(b) for a, b in zip(left, right))


def _join_history(left, right, label):
    if _same_prefix(left, right):
        return right
    if _same_prefix(right, left):
        return left
    raise Problem("Original review histories diverge for " + label + "; receive that source into a separate workspace",
                  409, "REVIEW_HISTORY_CONFLICT")


def _parse(raw, filename):
    members = _members(raw, filename)
    documents, histories, roots, member_rows = {}, {}, [], []
    packages, csv_files = [], []
    for name, content in members:
        member_rows.append({"path": name, "bytes": len(content), "sha256": digest(content)})
        if name.lower().endswith(".csv"):
            csv_files.append((name, content))
            continue
        value = _json(content, name)
        _require(isinstance(value, dict) and value.get("schema") == engine.SCHEMA
                 and set(value) == {"schema", "root", "documents", "accepted_review"},
                 "Choose a complete accepted scenario export: " + name)
        root = engine.obj(value["root"], "original root")
        _require(root.get("kind") == "scenario", "Receive an accepted scenario root")
        original = engine.array(value["documents"], "original exported documents", maximum=MAX_DOCUMENTS)
        local = {}
        for supplied in original:
            doc, reviews = _document(supplied)
            _require(doc["id"] not in local, "A package repeats an original document")
            local[doc["id"]] = doc
            if doc["id"] in documents:
                _require(stable(documents[doc["id"]]) == stable(doc), "One original document ID carries different content",
                         "CONTENT_CHANGED")
                histories[doc["id"]] = _join_history(histories[doc["id"]], reviews, doc["id"])
            else:
                documents[doc["id"]], histories[doc["id"]] = doc, reviews
        _require(root.get("id") in local and local[root["id"]]["kind"] == "scenario" and root == {
            "id": local[root["id"]]["id"], "kind": "scenario", "sha256": local[root["id"]]["sha256"]},
            "The original root identity differs", "CONTENT_CHANGED")
        reached, pending = set(), [root["id"]]
        while pending:
            identity = pending.pop()
            if identity in reached:
                continue
            reached.add(identity)
            for ref in local[identity]["parents"].values():
                _require(ref["id"] in local and local[ref["id"]]["kind"] == ref["kind"]
                         and local[ref["id"]]["sha256"] == ref["sha256"], "An original referenced edition is missing")
                pending.append(ref["id"])
        _require(reached == set(local), "The export contains documents outside its selected root")
        root_reviews = next(row["reviews"] for row in original if row["id"] == root["id"])
        accepted = value["accepted_review"]
        _require(root_reviews and stable(accepted) == stable(root_reviews[-1])
                 and accepted["outcome"] == "accepted", "The root's original accepted review is missing")
        packages.append((root["id"], local))
        roots.append({**root, "member": name, "accepted_review_id": accepted["id"],
                      "accepted_review_sha256": accepted["sha256"],
                      "title": local[root["id"]]["content"].get("config", {}).get("title", root["id"])})
    _require(1 <= len(packages) <= 64 and len(documents) <= MAX_DOCUMENTS,
             "Receive 1–64 complete accepted roots and at most 512 original documents")
    reviews_by_id = {}
    for identity, rows in histories.items():
        for review in rows:
            known = reviews_by_id.get(review["id"])
            _require(known is None or stable(known) == stable(review), "An original review ID carries different content")
            reviews_by_id[review["id"]] = review
    _require(len(reviews_by_id) <= MAX_REVIEWS, "The complete source exceeds 4,096 reviews")
    for doc in documents.values():
        parents = doc["parents"]
        if doc["kind"] in {"roster", "scenario"}:
            roles = documents[parents["roles"]["id"]]
            _require(roles["parents"]["method"]["id"] == parents["method"]["id"],
                     "The role and method editions do not belong together")
        if doc["kind"] == "scenario":
            workforce = documents[parents["roster"]["id"]]
            _require(workforce["parents"]["roles"]["id"] == parents["roles"]["id"]
                     and workforce["parents"]["method"]["id"] == parents["method"]["id"],
                     "The workforce edition belongs to different original inputs")
            expected_inputs = {key: {field: ref[field] for field in ("id", "kind", "sha256")}
                               for key, ref in parents.items()}
            _require(doc["content"].get("inputs") == expected_inputs, "The saved calculation input identities differ")
        for ref in parents.values():
            selected = ref.get("review_at_selection")
            if selected is not None:
                _require(isinstance(selected, dict) and selected.get("id") in reviews_by_id
                         and stable(selected) == stable(reviews_by_id[selected["id"]])
                         and selected["document_id"] == ref["id"],
                         "An input's original selected review is absent")
        for review in histories[doc["id"]]:
            for key, selected in review["upstream_reviews"].items():
                _require(isinstance(selected, dict) and selected.get("id") in reviews_by_id
                         and stable(selected) == stable(reviews_by_id[selected["id"]])
                         and selected["document_id"] == parents[key]["id"]
                         and selected["document_sha256"] == parents[key]["sha256"]
                         and selected["outcome"] == "accepted", "An original upstream acceptance is absent")
    expected_csv = {digest(engine.csv_export(documents[root["id"]]["content"]["rows"])) for root in roots}
    for name, content in csv_files:
        _require(digest(content) in expected_csv, "The supplied CSV does not match an original accepted root: " + name,
                 "CSV_CONTENT_CHANGED")
    return documents, histories, roots, member_rows


def _existing(db, documents, histories):
    host = _host()
    result = []
    for identity, doc in documents.items():
        current = None
        if host._exists(db):
            row = db.execute("SELECT kind FROM classification_documents WHERE id=?", (identity,)).fetchone()
            if row:
                current = host._load(db, row[0], identity)
                _require(stable(current) == stable(doc), "A received document ID conflicts with this workspace",
                         "CONTENT_CHANGED")
        existing_reviews = host._reviews(db, identity) if current else []
        combined = _join_history(existing_reviews, histories[identity], identity)
        added = combined[len(existing_reviews):]
        for review in histories[identity]:
            if host._exists(db):
                row = db.execute("SELECT document FROM classification_reviews WHERE id=?", (review["id"],)).fetchone()
                _require(row is None or stable(json.loads(row[0])) == stable(review),
                         "A received review ID conflicts with this workspace", "CONTENT_CHANGED")
        result.append({"id": identity, "kind": doc["kind"], "sha256": doc["sha256"],
                       "document_action": "reuse" if current else "receive",
                       "reviews_to_add": [review["id"] for review in added],
                       "current_review": existing_reviews[-1] if existing_reviews else None})
    return result


def _external(documents):
    result = []
    for doc in documents.values():
        prior = doc.get("supersedes")
        if prior and prior.get("id") not in documents:
            result.append({"document_id": doc["id"], "kind": "supersedes", "reference": prior})
        if doc["kind"] == "roles":
            for row in doc["content"]["rows"]:
                if row.get("native_job_id"):
                    result.append({"document_id": doc["id"], "row_id": row.get("id"), "kind": "original_job_snapshot",
                                   "id": row["native_job_id"], "snapshot_included": isinstance(row.get("native_job"), dict)})
    return result


def _prepared(workspace, db, payload):
    raw, source, context = _source(payload)
    documents, histories, roots, members = _parse(raw, source["filename"])
    current = _existing(db, documents, histories)
    overview = {
        "schema": SCHEMA, "receiving_workspace_id": workspace.meta(db)["id"],
        "source": source, "context": context, "roots": roots, "members": members,
        "documents": [{"id": doc["id"], "kind": doc["kind"], "sha256": doc["sha256"],
                       "name": doc["content"].get("name") or doc["content"].get("config", {}).get("title"),
                       "rows": len(doc["content"].get("rows", doc["content"].get("grades", []))),
                       "review_ids": [review["id"] for review in histories[doc["id"]]]}
                      for doc in documents.values()],
        "review_count": sum(map(len, histories.values())), "current_documents": current,
        "external_references": _external(documents),
        "history_scope": "Complete exported classification documents, original parents and ordered reviews",
        "original_workspace_operations_included": False,
    }
    overview["preview_sha256"] = digest(overview)
    return raw, documents, histories, overview


def _exists(db):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (TABLE,)).fetchone() is not None


def _ensure(db):
    db.execute("""CREATE TABLE IF NOT EXISTS classification_received_packages(
        id TEXT PRIMARY KEY,input_sha256 TEXT NOT NULL UNIQUE,raw_sha256 TEXT NOT NULL,
        received_revision INTEGER NOT NULL,document TEXT NOT NULL,
        FOREIGN KEY(raw_sha256) REFERENCES blobs(sha))""")
    db.execute("""CREATE TABLE IF NOT EXISTS classification_received_documents(
        package_id TEXT NOT NULL,document_id TEXT NOT NULL,source_order INTEGER NOT NULL,
        PRIMARY KEY(package_id,document_id),
        FOREIGN KEY(package_id) REFERENCES classification_received_packages(id),
        FOREIGN KEY(document_id) REFERENCES classification_documents(id))""")
    db.execute("CREATE INDEX IF NOT EXISTS classification_received_document ON classification_received_documents(document_id)")


def dispatch(workspace, db, action, payload, revision):
    raw, documents, histories, preview = _prepared(workspace, db, payload)
    if action == "preview_package":
        return preview
    _require(action == "receive_package", "Unknown accepted-package receiving action")
    _require(payload.get("expected_preview_sha256") == preview["preview_sha256"],
             "Reopen the exact current receiving preview", "PREVIEW_CHANGED")
    _ensure(db)
    source, context = preview["source"], preview["context"]
    input_sha = digest({"source": source, "context": context})
    prior = db.execute("SELECT id FROM classification_received_packages WHERE input_sha256=?", (input_sha,)).fetchone()
    if prior:
        return {"receipt": document(workspace, db, prior[0]), "reused": True}
    existing_blob = db.execute("SELECT size,data FROM blobs WHERE sha=?", (source["sha256"],)).fetchone()
    _require(existing_blob is None or (existing_blob[0] == len(raw) and bytes(existing_blob[1]) == raw),
             "The retained original blob differs", "CONTENT_CHANGED")
    db.execute("INSERT OR IGNORE INTO blobs VALUES(?,?,?,?)",
               (source["sha256"], source["filename"], len(raw), raw))
    counts = {"documents_received": 0, "documents_reused": 0, "reviews_received": 0}
    for status in preview["current_documents"]:
        doc = documents[status["id"]]
        if status["document_action"] == "receive":
            db.execute("INSERT INTO classification_documents VALUES(?,?,?,?,?,?)",
                       (doc["id"], doc["kind"], doc["created_at"], revision, doc["sha256"], stable(doc)))
            counts["documents_received"] += 1
        else:
            counts["documents_reused"] += 1
    for status in preview["current_documents"]:
        for review in histories[status["id"]]:
            if review["id"] in status["reviews_to_add"]:
                # Local ordering is separate from each unchanged source stored_revision.
                db.execute("INSERT INTO classification_reviews VALUES(?,?,?,?,?)",
                           (review["id"], review["document_id"], review["created_at"], revision, stable(review)))
                counts["reviews_received"] += 1
    receipt = {
        "schema": SCHEMA, "kind": "received_package", "id": "classification-received-" + uuid.uuid4().hex,
        "received_at": now(), "received_by": context["actor"],
        "receiving_workspace_id": workspace.meta(db)["id"], "receiving_revision": revision,
        "source": source, "context": context, "input_sha256": input_sha,
        "preview_sha256": preview["preview_sha256"], "roots": preview["roots"],
        "documents": preview["documents"], "review_count": preview["review_count"],
        "members": preview["members"], "external_references": preview["external_references"],
        "history_scope": preview["history_scope"], "original_workspace_operations_included": False,
        "counts": counts,
    }
    receipt["sha256"] = digest(receipt)
    db.execute("INSERT INTO classification_received_packages VALUES(?,?,?,?,?)",
               (receipt["id"], input_sha, source["sha256"], revision, stable(receipt)))
    for index, identity in enumerate(documents):
        db.execute("INSERT INTO classification_received_documents VALUES(?,?,?)", (receipt["id"], identity, index))
    return {"receipt": receipt, "reused": False}


def document(workspace, db, identity):
    _require(isinstance(identity, str), "Select the original receiving record")
    if not _exists(db):
        raise Problem("Classification receiving record is absent", 404, "RECEIVING_MISSING")
    row = db.execute("SELECT document FROM classification_received_packages WHERE id=?", (identity,)).fetchone()
    if not row:
        raise Problem("Classification receiving record is absent", 404, "RECEIVING_MISSING")
    result = json.loads(row[0])
    _signed(result, "Native receiving record")
    _require(result["receiving_workspace_id"] == workspace.meta(db)["id"],
             "The receiving record belongs to another workspace")
    return result


def page(workspace, db, cursor="0"):
    _require(isinstance(cursor, str) and re.fullmatch(r"0|[1-9][0-9]{0,8}", cursor), "Choose a bounded receiving history cursor")
    offset = int(cursor)
    if not _exists(db):
        return {"items": [], "next_cursor": None, "total": 0}
    total = db.execute("SELECT count(*) FROM classification_received_packages").fetchone()[0]
    rows = db.execute("SELECT document FROM classification_received_packages ORDER BY received_revision DESC,rowid DESC LIMIT 25 OFFSET ?",
                      (offset,)).fetchall()
    items = []
    for row in rows:
        value = json.loads(row[0])
        items.append({key: value[key] for key in ("id", "sha256", "received_at", "received_by", "receiving_revision",
                      "source", "context", "roots", "review_count", "counts")})
    return {"items": items, "next_cursor": str(offset + len(items)) if offset + len(items) < total else None, "total": total}


def origins(db, identity):
    if not _exists(db):
        return []
    rows = db.execute("""SELECT p.id,p.document FROM classification_received_packages p
        JOIN classification_received_documents d ON d.package_id=p.id WHERE d.document_id=?
        ORDER BY p.received_revision,p.rowid""", (identity,)).fetchall()
    return [{"id": row[0], "received_at": json.loads(row[1])["received_at"],
             "source": json.loads(row[1])["source"]} for row in rows]


def download(workspace, db, kind, identity):
    member_index = None
    if kind == "received-member":
        _require(isinstance(identity, str) and "~" in identity, "Choose an original receiving member")
        identity, index = identity.rsplit("~", 1)
        _require(re.fullmatch(r"0|[1-9][0-9]{0,2}", index), "Choose a bounded original member")
        member_index = int(index)
    receipt = document(workspace, db, identity)
    if kind in {"received-original", "received-member"}:
        row = db.execute("SELECT size,data FROM blobs WHERE sha=?", (receipt["source"]["sha256"],)).fetchone()
        if not row:
            raise Problem("The complete original receiving source is absent", 409, "SOURCE_MISSING")
        raw = bytes(row[1])
        _require(row[0] == len(raw) == receipt["source"]["bytes"] and digest(raw) == receipt["source"]["sha256"],
                 "The original received source bytes differ", "CONTENT_CHANGED")
        if member_index is not None:
            _require(member_index < len(receipt["members"]), "The original source member is absent")
            expected = receipt["members"][member_index]
            members = _members(raw, receipt["source"]["filename"])
            _require(member_index < len(members), "The original source member is incomplete")
            name, value = members[member_index]
            _require(name == expected["path"] and len(value) == expected["bytes"]
                     and digest(value) == expected["sha256"], "The original member bytes differ", "CONTENT_CHANGED")
            return {"data": value, "content_type": "text/csv; charset=utf-8" if name.lower().endswith(".csv")
                    else "application/json; charset=utf-8", "filename": PurePosixPath(name).name}
        return {"data": raw, "content_type": "application/zip" if raw.startswith(b"PK") else "application/json",
                "filename": receipt["source"]["filename"]}
    _require(kind == "received-manifest", "Choose the original receiving record or source")
    return {"data": (json.dumps(receipt, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8"),
            "content_type": "application/json; charset=utf-8", "filename": identity + ".json"}
