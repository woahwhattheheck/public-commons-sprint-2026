"""Receiving extension for the original F11 Workspace.

The original host supplies its live SQLite connection inside BEGIN IMMEDIATE and
owns operation replay, expected revision, commit and rollback.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict

from core import Problem
from . import engine

TABLE = "receiving_documents"
ACTION_NAMES = (
    "snapshot", "document", "inspectSnapshot", "previewHandoff", "createHandoff",
    "exportHandoff", "exportRecord", "importHandoff", "previewReturn", "reviewReturn",
    "compareHandoffs", "reviewAnnualChange",
)


def _exists(db):
    return db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (TABLE,)
    ).fetchone() is not None


def _ensure(db):
    db.execute("""CREATE TABLE IF NOT EXISTS receiving_documents(
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        stored_revision INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        document TEXT NOT NULL
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS receiving_documents_kind "
               "ON receiving_documents(kind,created_at)")


def _accepted(db):
    """Read the same original analyses and review order as Workspace.document."""
    result = []
    for row in db.execute("SELECT document FROM analyses ORDER BY created_at,id"):
        analysis = json.loads(row[0])
        reviews = [json.loads(review[0]) for review in db.execute(
            "SELECT document FROM reviews WHERE analysis_id=? ORDER BY created_at",
            (analysis["id"],))]
        if not reviews or reviews[-1].get("outcome") != "accepted":
            continue
        if reviews[-1].get("result_sha256") != analysis.get("result_sha256"):
            continue
        if analysis.get("errors"):
            continue
        analysis["reviews"] = reviews
        result.append(analysis)
    return result


def _source_refs(db, analyses):
    identities = set()
    for analysis in analyses:
        job = analysis.get("job") or {}
        if job.get("source_id"):
            identities.add(job["source_id"])
        for line in analysis.get("lines", []):
            survey = line.get("survey") or {}
            if survey.get("source_id"):
                identities.add(survey["source_id"])
    sources = []
    for identity in sorted(identities):
        row = db.execute("SELECT document FROM imports WHERE id=?", (identity,)).fetchone()
        if row:
            original = json.loads(row[0])
            # Original import document carries its edition, source metadata,
            # licensed-use declaration, original byte hash, and mapping decisions.
            sources.append(original)
        else:
            sources.append({"id": identity, "availability": "original source reference retained in analysis"})
    return sources


def _snapshot_id(target_date, currency):
    return "pricing-edition-" + engine.digest([target_date, currency])[:24]


def _snapshot_groups(db):
    groups = defaultdict(list)
    for analysis in _accepted(db):
        groups[(analysis.get("target_date"), analysis.get("currency"))].append(analysis)
    return groups


def _snapshot(workspace, db, identity):
    for (target_date, currency), analyses in _snapshot_groups(db).items():
        if _snapshot_id(target_date, currency) != identity:
            continue
        reviews = [analysis["reviews"][-1] for analysis in analyses]
        revisions = [analysis.get("source_revision") for analysis in analyses]
        numeric_revisions = [value for value in revisions if isinstance(value, int)]
        snapshot = {
            "id": identity,
            "revision": max(numeric_revisions) if numeric_revisions else 0,
            "label": f"{target_date or 'Undated'} · {currency or 'Unspecified currency'} · {len(analyses)} reviewed analyses",
            "cycle": target_date[:4] if isinstance(target_date, str) and len(target_date) >= 4 else "Undated",
            "asOf": target_date, "currency": currency,
            "review": {
                "by": "; ".join(sorted({review["reviewer"] for review in reviews})),
                "at": max(review["created_at"] for review in reviews),
                "reference": "; ".join(review["id"] for review in reviews),
                "references": [review["id"] for review in reviews],
            },
            "sourceRefs": _source_refs(db, analyses),
            "analysisIds": [analysis["id"] for analysis in analyses],
            "sourceRevisions": revisions,
            "rows": [{"id": analysis["id"], "jobId": analysis["job"]["id"], "data": analysis}
                     for analysis in analyses],
        }
        return snapshot
    raise Problem("This reviewed pricing edition is absent. Accept an original analysis "
                  "or refresh the reviewed editions.", 404, "SNAPSHOT_MISSING")


def _snapshot_metadata(db):
    snapshots = []
    for (target_date, currency), analyses in _snapshot_groups(db).items():
        reviews = [analysis["reviews"][-1] for analysis in analyses]
        snapshots.append({
            "id": _snapshot_id(target_date, currency),
            "label": f"{target_date or 'Undated'} · {currency or 'Unspecified currency'} · {len(analyses)} reviewed analyses",
            "cycle": target_date[:4] if isinstance(target_date, str) and len(target_date) >= 4 else "Undated",
            "asOf": target_date, "currency": currency,
            "revision": max((analysis.get("source_revision", 0) for analysis in analyses), default=0),
            "rowCount": len(analyses), "analysisIds": [analysis["id"] for analysis in analyses],
            "review": {"by": "; ".join(sorted({review["reviewer"] for review in reviews})),
                       "at": max(review["created_at"] for review in reviews),
                       "reference": "; ".join(review["id"] for review in reviews)},
            "rows": [{"id": analysis["id"], "jobId": analysis["job"]["id"],
                      "label": analysis["title"], "jobTitle": analysis["job"]["record"].get("title", ""),
                      "resultSha256": analysis["result_sha256"],
                      "reviewId": analysis["reviews"][-1]["id"]}
                     for analysis in analyses],
        })
    return sorted(snapshots, key=lambda item: (item["asOf"] or "", item["currency"] or ""), reverse=True)


def _load(db, kind, identity):
    if not _exists(db):
        raise Problem("This receiving document is absent.", 404, "RECEIVING_DOCUMENT_MISSING")
    row = db.execute("SELECT document,sha256 FROM receiving_documents WHERE kind=? AND id=?",
                     (kind, identity)).fetchone()
    if not row:
        raise Problem("This receiving document is absent.", 404, "RECEIVING_DOCUMENT_MISSING")
    record = json.loads(row[0])
    engine._verify(record, kind)
    if row[1] != record["sha256"]:
        raise Problem("The saved receiving document differs from its retained identity.",
                      409, "CONTENT_CHANGED")
    return record


def _save(db, record, revision):
    _ensure(db)
    body = engine.canonical(record)
    if len(body.encode("utf-8")) > engine.MAX_DOCUMENT_BYTES:
        raise Problem("The receiving document exceeds 32 MiB.", 413, "DOCUMENT_TOO_LARGE")
    existing = db.execute("SELECT sha256,document FROM receiving_documents WHERE id=?",
                          (record["id"],)).fetchone()
    if existing:
        if existing[0] != record["sha256"]:
            raise Problem("This document ID already belongs to another immutable edition.",
                          409, "RECEIVING_ID_CONFLICT")
        return json.loads(existing[1])
    db.execute("INSERT INTO receiving_documents VALUES(?,?,?,?,?,?,?)",
               (record["id"], record["kind"], record["createdAt"], record["createdBy"],
                revision, record["sha256"], body))
    return record


def _metadata(record, stored_revision):
    result = {key: record[key] for key in
              ("schema", "kind", "id", "createdAt", "createdBy", "sha256", "previewHash")
              if key in record}
    result["storedRevision"] = stored_revision
    if record["kind"] == "handoff":
        result.update(
            label=record["profile"]["label"], recipient=record["profile"]["recipient"],
            rowCount=len(record["rows"]), snapshot=record["snapshot"],
            format=record["profile"]["format"],
            summary={"rows": len(record["rows"]), "excluded": len(record.get("excludedRows", []))}
        )
    elif record["kind"] == "return-review":
        result.update(handoffId=record["handoffId"], summary=record["summary"],
                      rowCount=len(record["entries"]))
    elif record["kind"] == "annual-review":
        result.update(previous=record["previous"], current=record["current"],
                      summary=record["summary"], rowCount=len(record["entries"]))
    return result


def state(workspace, db):
    result = {"schema": engine.SCHEMA, "revision": workspace.meta(db).get("revision"),
              "snapshots": _snapshot_metadata(db),
              "handoffs": [], "returnReviews": [], "annualReviews": [], "history": []}
    if not _exists(db):
        return result
    kinds = {"handoff": "handoffs", "return-review": "returnReviews", "annual-review": "annualReviews"}
    for row in db.execute("SELECT document,stored_revision FROM receiving_documents "
                          "ORDER BY created_at DESC,id DESC"):
        record = json.loads(row[0])
        item = _metadata(record, row[1])
        result[kinds[record["kind"]]].append(item)
        result["history"].append(item)
    return result


def document(workspace, db, kind, identity):
    try:
        if kind == "snapshot":
            return _snapshot(workspace, db, identity)
        if kind not in ("handoff", "return-review", "annual-review"):
            raise Problem("Unknown receiving document type.", 404, "UNKNOWN_DOCUMENT_KIND")
        return _load(db, kind, identity)
    except engine.ReceivingError as exc:
        raise Problem(str(exc), exc.status, exc.code) from exc


def _identity(payload, key):
    value = payload.get(key)
    if isinstance(value, dict):
        return engine._text(value.get("id"), key + ".id")
    return engine._text(value, key)


def _saved_handoff(db, value):
    identity = value.get("id") if isinstance(value, dict) else value
    identity = engine._text(identity, "handoff id")
    record = _load(db, "handoff", identity)
    if isinstance(value, dict) and value.get("sha256") and value["sha256"] != record["sha256"]:
        raise Problem("The requested handoff differs from the saved original edition.",
                      409, "CONTENT_CHANGED")
    return record


def _review_options(payload):
    expected = engine._text(payload.get("expectedPreviewHash"), "expectedPreviewHash")
    actor = engine._text(payload.get("actor"), "actor")
    options = {"expectedPreviewHash": expected, "actor": actor}
    if payload.get("at") is not None:
        options["at"] = payload["at"]
    if payload.get("id") is not None:
        options["id"] = payload["id"]
    return options


def dispatch(workspace, db, action, payload, revision):
    """Called by F11's receiving.<action> branch of Workspace.mutate."""
    try:
        engine._object(payload, "receiving payload")
        if action == "snapshot":
            return _snapshot(workspace, db, engine._text(payload.get("id"), "snapshot id"))
        if action == "document":
            return document(workspace, db, payload.get("kind"), payload.get("id"))
        if action == "inspectSnapshot":
            snapshot_value = payload.get("snapshot", payload.get("snapshotId"))
            return engine.inspectSnapshot(_snapshot(workspace, db, _identity({"s": snapshot_value}, "s")))
        if action == "previewHandoff":
            snapshot = _snapshot(workspace, db, _identity(payload, "snapshot"))
            return engine.previewHandoff(snapshot=snapshot, profile=payload.get("profile"),
                                         selectedRowIds=payload.get("selectedRowIds"))
        if action == "createHandoff":
            supplied = payload.get("preview")
            engine._object(supplied, "handoff preview")
            snapshot = _snapshot(workspace, db, supplied["snapshot"]["id"])
            current = engine.previewHandoff(snapshot=snapshot, profile=supplied["profile"],
                                             selectedRowIds=[row["id"] for row in supplied["rows"]])
            result = engine.createHandoff(current, **_review_options(payload))
            return _save(db, result, revision)
        if action == "exportHandoff":
            return engine.exportHandoff(_saved_handoff(db, payload.get("handoff")),
                                         format=payload.get("format"))
        if action == "exportRecord":
            kind = engine._text(payload.get("kind"), "kind")
            identity = engine._text(payload.get("id"), "id")
            if kind not in ("handoff", "return-review", "annual-review"):
                raise Problem("Choose a saved receiving record.", 400, "UNKNOWN_DOCUMENT_KIND")
            exported = download(workspace, db, kind, identity)
            raw = exported["data"]
            return {"schema": engine.SCHEMA, "kind": "export",
                    "filename": exported["filename"], "mime": exported["content_type"],
                    "encoding": "utf-8", "content": raw.decode("utf-8", "strict"),
                    "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        if action == "importHandoff":
            record = engine.importHandoff(payload.get("content"))
            # A complete external handoff can be received as its retained edition.
            # Its original review/source records remain in the document, while the
            # original Workspace operation records who imported it and when.
            return _save(db, record, revision)
        if action == "previewReturn":
            return engine.previewReturn(
                handoff=_saved_handoff(db, payload.get("handoff")), content=payload.get("content"),
                format=payload.get("format"), columnMapping=payload.get("columnMapping"))
        if action == "reviewReturn":
            supplied = payload.get("preview")
            engine._object(supplied, "return preview")
            handoff = _load(db, "handoff", supplied["handoffId"])
            source = supplied["source"]
            current = engine.previewReturn(
                handoff=handoff, content=source["content"], format=source["format"],
                columnMapping=source.get("columnMapping"))
            result = engine.reviewReturn(current, decisions=payload.get("decisions"),
                                          **_review_options(payload))
            return _save(db, result, revision)
        if action == "compareHandoffs":
            return engine.compareHandoffs(
                previous=_saved_handoff(db, payload.get("previous")),
                current=_saved_handoff(db, payload.get("current")), pairs=payload.get("pairs"))
        if action == "reviewAnnualChange":
            supplied = payload.get("comparison")
            engine._object(supplied, "annual comparison")
            matching = supplied.get("matching", {})
            comparison = engine.compareHandoffs(
                previous=_load(db, "handoff", supplied["previous"]["id"]),
                current=_load(db, "handoff", supplied["current"]["id"]),
                pairs=matching.get("pairs") if matching.get("kind") == "explicit" else None)
            result = engine.reviewAnnualChange(
                comparison, decisions=payload.get("decisions"), **_review_options(payload))
            return _save(db, result, revision)
        raise Problem("Unknown receiving action.", 404, "UNKNOWN_RECEIVING_ACTION")
    except engine.ReceivingError as exc:
        raise Problem(str(exc), exc.status, exc.code) from exc
    except (KeyError, TypeError, AttributeError) as exc:
        raise Problem("The receiving request is incomplete or has an invalid document shape.",
                      400, "INVALID_RECEIVING_INPUT") from exc


def download(workspace, db, kind, identity):
    try:
        if kind in ("handoff-csv", "handoff-tsv", "handoff-json"):
            record = _load(db, "handoff", identity)
            exported = engine.exportHandoff(record, format=kind.rsplit("-", 1)[1])
            return {"data": exported["content"].encode("utf-8"),
                    "content_type": exported["mime"], "filename": exported["filename"]}
        if kind == "returned-source":
            review = _load(db, "return-review", identity)
            safe_id = re.sub(r"[^A-Za-z0-9._-]", "_", identity)[:100]
            return {"data": review["source"]["content"].encode("utf-8"),
                    "content_type": "text/plain; charset=utf-8",
                    "filename": f"returned-{safe_id}.{review['source']['format']}"}
        record = document(workspace, db, kind, identity)
        safe_id = re.sub(r"[^A-Za-z0-9._-]", "_", identity)[:100]
        return {"data": (json.dumps(record, ensure_ascii=False, sort_keys=True, indent=2,
                                    allow_nan=False) + "\n").encode("utf-8"),
                "content_type": "application/json; charset=utf-8",
                "filename": f"{kind}-{safe_id}.json"}
    except engine.ReceivingError as exc:
        raise Problem(str(exc), exc.status, exc.code) from exc
