"""Publisher intake extension for the original FSU Workspace transaction.

The parent owns operation replay, expected_revision, commit, rollback and backup.
This module makes no network requests and never opens a second database.
"""
from __future__ import annotations
import hashlib
import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "commons.compensation.publisher-intake.v1"
ACTIONS = ("columns", "preview", "review", "cohort", "compare", "csv")
ROOT = Path(__file__).resolve().parent
HASH = re.compile(r"^[0-9a-f]{64}$")
NUMERIC_DEFAULTS = {
    "unit_multiplier", "annual_hours", "annual_periods",
    "p25", "p50", "p75", "organization_count", "incumbent_count",
}

def _error(message, status=422, code="PUBLISHER_INPUT", details=None):
    from core import Problem
    raise Problem(message, status, code, details)

def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)

def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def _installed(db):
    return bool(db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='publisher_docs'").fetchone())

def _schema(db):
    db.execute("""CREATE TABLE IF NOT EXISTS publisher_docs(
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at TEXT NOT NULL,
        revision INTEGER NOT NULL, document TEXT NOT NULL)""")

def _identity(kind, identity):
    if not isinstance(identity, str) or not HASH.fullmatch(identity):
        _error("Select the saved publisher document.", 404, "PUBLISHER_DOCUMENT_MISSING")
    if kind not in {"preview", "edition", "cohort"}:
        _error("Unknown publisher document type.", 404, "PUBLISHER_DOCUMENT_MISSING")
    return kind + ":" + identity

def _get(db, kind, identity):
    key = _identity(kind, identity)
    if not _installed(db):
        _error("The publisher document has not been saved.", 404, "PUBLISHER_DOCUMENT_MISSING")
    row = db.execute("SELECT document FROM publisher_docs WHERE id=?", (key,)).fetchone()
    if not row:
        _error("The publisher document has not been saved.", 404, "PUBLISHER_DOCUMENT_MISSING")
    return json.loads(row[0])

def _reference(payload, field, hash_field):
    value = payload.get(field)
    if isinstance(value, dict):
        value = value.get(hash_field)
    if value is None:
        value = payload.get(hash_field)
    if not isinstance(value, str) or not HASH.fullmatch(value):
        _error("Reopen the saved " + field + " before continuing.", 409, "PUBLISHER_REFERENCE_REQUIRED")
    return value

def _save(db, kind, result, revision, original, native=None):
    hash_field = {"preview": "previewHash", "edition": "editionHash", "cohort": "cohortHash"}[kind]
    key = _identity(kind, result[hash_field])
    envelope = {"data": result, "original": original, "native": native}
    old = db.execute("SELECT document FROM publisher_docs WHERE id=?", (key,)).fetchone()
    if old:
        if json.loads(old[0]) != envelope:
            _error("This saved publisher identity already has different contents.", 409, "PUBLISHER_IDENTITY_CONFLICT")
        return
    db.execute("INSERT INTO publisher_docs VALUES(?,?,?,?,?)", (key, kind, _now(), revision, _json(envelope)))

def _run(action, payload):
    if action not in ACTIONS:
        _error("Unknown publisher action.", 404, "PUBLISHER_ACTION_MISSING")
    node = os.environ.get("FSU_INTAKE_NODE") or shutil.which("node")
    if not node:
        _error("Install Node 24 or set FSU_INTAKE_NODE to its executable.", 503, "PUBLISHER_RUNTIME_MISSING")
    raw = _json(payload)
    if len(raw.encode("utf-8")) > 64 * 1024 * 1024:
        _error("This publisher operation exceeds the 64 MiB request limit.", 413)
    try:
        completed = subprocess.run(
            [node, str(ROOT / "cli.mjs"), action], input=raw, text=True,
            encoding="utf-8", stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=60, check=False, cwd=ROOT,
        )
    except subprocess.TimeoutExpired:
        _error("Publisher processing exceeded 60 seconds; reduce this import's selected rows.", 503, "PUBLISHER_TIMEOUT")
    except OSError as exc:
        _error("The publisher runtime could not start: " + str(exc), 503, "PUBLISHER_RUNTIME_MISSING")
    if completed.returncode:
        try:
            detail = json.loads(completed.stderr)
        except (ValueError, TypeError):
            detail = {"error": "PUBLISHER_PROCESS", "message": completed.stderr[:1200]}
        _error(detail.get("message", "Publisher processing failed."), 422, detail.get("error", "PUBLISHER_INPUT"), {"path": detail.get("path", "")})
    if action == "csv":
        return completed.stdout
    try:
        return json.loads(completed.stdout)
    except ValueError:
        _error("The publisher runtime returned an unreadable result.", 502, "PUBLISHER_RESULT")

def _preview_request(payload):
    selected = {k: payload[k] for k in ("csv", "source", "mapping", "defaults", "delimiter", "numberStyle", "capturedAt") if k in payload}
    # The original server preserves JSON decimals as lexemes. Configuration
    # defaults have plain decimal meaning; only uploaded textual cells use locale.
    defaults = dict(selected.get("defaults") or {})
    for field in NUMERIC_DEFAULTS & defaults.keys():
        value = defaults[field]
        if isinstance(value, str) and value.strip():
            if not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", value.strip()):
                _error("Use a plain decimal for the " + field + " default.", details={"path": field})
            defaults[field] = value.strip()
    selected["defaults"] = defaults
    return selected

def _native_records(edition):
    source = edition["source"]
    records = []
    for row in edition["rows"]:
        value = row["normalized"]
        # Intake has already applied the explicit source scale and period.
        # Import annual amounts once; the original report retains the source
        # percentiles, period, factor and peer selection in publisher_docs.
        records.append({
            "id": row["stableKey"],
            "job_title": value["survey_job_title"],
            "description": value["job_description"],
            "publisher": source["publisher_name"],
            "survey_name": source["survey_name"],
            "effective_date": value["effective_date"],
            "currency": value["currency"],
            "period": "annual",
            "amount_scale": 1,
            "annual_hours": "",
            "periods_per_year": "",
            "p25": value.get("annualized_exact", value["annualized"])["p25"],
            "p50": value.get("annualized_exact", value["annualized"])["p50"],
            "p75": value.get("annualized_exact", value["annualized"])["p75"],
            "geography": value["geography"],
            "industry": value["industry"],
            "organization_size": value["size_band"],
            "cohort": value["scope_cut"],
            "organizations": value["organization_count"],
            "respondents": value["incumbent_count"],
            "source_url": source["source_reference"],
        })
    return records

def _import_native(workspace, db, edition, revision):
    source = edition["source"]
    records = _native_records(edition)
    text = _json({"records": records})
    native_bytes = len(text.encode("utf-8"))
    if native_bytes > 16 * 1024 * 1024:
        _error("The selected rows expand beyond the original 16 MiB import limit. Select fewer source rows for this reviewed edition.", 413, "PUBLISHER_NORMALIZED_LIMIT", {"selected_rows": len(records), "normalized_bytes": native_bytes, "limit_bytes": 16 * 1024 * 1024})
    preview = workspace._preview(db, {
        "kind": "surveys",
        "text": text,
        "filename": "publisher-" + edition["editionHash"][:16] + ".json",
        "source_name": "Publisher " + source["publisher_id"] + " / " + source["survey_id"],
        "edition": source["edition_id"],
        "mapping": {key: key for key in records[0]},
        "metadata": {
            "number_format": "plain",
            "publisher_intake": {
                "schema": SCHEMA,
                "edition_hash": edition["editionHash"],
                "preview_hash": edition["previewHash"],
                "original_source_sha256": edition["sourceSha256"],
                "license_reference": source["license_reference"],
                "source_reference": source["source_reference"],
                "review": edition["review"],
                "amount_basis": "Reviewed annual amounts; original scale and period retained in publisher edition",
            },
        },
    }, revision)
    imported = workspace._import(db, {"preview_id": preview["id"]}, revision)
    links = {}
    for native in db.execute("SELECT id,record_key FROM records WHERE import_id=?", (imported["source_id"],)):
        links[native["record_key"]] = native["id"]
    return {"source_id": imported["source_id"], "record_ids": links, "import": imported}

def dispatch(workspace, db, action, payload, revision):
    """Called only inside the parent's existing transaction; returns kernel data."""
    if action not in ACTIONS or not isinstance(payload, dict):
        _error("Unknown publisher action or invalid request.", 404, "PUBLISHER_ACTION_MISSING")
    _schema(db)
    if action == "columns":
        return _run(action, {k: payload[k] for k in ("csv", "delimiter") if k in payload})
    if action == "preview":
        request = _preview_request(payload)
        result = _run(action, request)
        raw = request["csv"].encode("utf-8")
        sha = hashlib.sha256(raw).hexdigest()
        if sha != result["sourceSha256"]:
            _error("Original publisher bytes differ from the parsed source.", 409, "PUBLISHER_SOURCE_CHANGED")
        filename = result["source"]["filename"]
        db.execute("INSERT OR IGNORE INTO blobs VALUES(?,?,?,?)", (sha, filename, len(raw), raw))
        original = {"sha256": sha, "bytes": len(raw), "filename": filename}
        _save(db, "preview", result, revision, original)
        return result
    if action == "review":
        envelope = _get(db, "preview", _reference(payload, "preview", "previewHash"))
        review = dict(payload.get("review") or {})
        if review.get("expectedHash") != envelope["data"]["previewHash"]:
            _error("The review targets a different preview.", 409, "PREVIEW_CHANGED")
        result = _run(action, {"preview": envelope["data"], "review": review})
        existing = db.execute("SELECT document FROM publisher_docs WHERE id=?", (_identity("edition", result["editionHash"]),)).fetchone()
        if existing:
            if json.loads(existing[0])["data"] != result:
                _error("The saved edition identity differs.", 409, "PUBLISHER_IDENTITY_CONFLICT")
            return result
        native = _import_native(workspace, db, result, revision)
        _save(db, "edition", result, revision, envelope["original"], native)
        return result
    if action == "cohort":
        envelope = _get(db, "edition", _reference(payload, "edition", "editionHash"))
        selection = dict(payload.get("selection") or {})
        if isinstance(selection.get("minOrganizations"), str):
            value = selection["minOrganizations"]
            if not re.fullmatch(r"\d+", value):
                _error("Minimum organizations must be a whole number.")
            selection["minOrganizations"] = int(value)
        result = _run(action, {"edition": envelope["data"], "selection": selection})
        native = dict(envelope["native"])
        included = {row["stableKey"] for row in result["rows"]}
        native["record_ids"] = {key: value for key, value in native["record_ids"].items() if key in included}
        native["parent_edition_hash"] = envelope["data"]["editionHash"]
        _save(db, "cohort", result, revision, envelope["original"], native)
        return result
    if action == "compare":
        previous = _get(db, "edition", _reference(payload, "previous", "editionHash"))["data"]
        current = _get(db, "edition", _reference(payload, "current", "editionHash"))["data"]
        return _run(action, {"previous": previous, "current": current})
    submitted = payload.get("edition")
    cohort = isinstance(submitted, dict) and submitted.get("kind") == "cohort"
    kind, field = ("cohort", "cohortHash") if cohort else ("edition", "editionHash")
    envelope = _get(db, kind, _reference(payload, "edition", field))
    return _run("csv", {"edition": envelope["data"]})

def state(workspace, db):
    result = {"schema": SCHEMA, "editions": [], "previews": [], "cohorts": []}
    if not _installed(db):
        return result
    for row in db.execute("SELECT kind,created_at,revision,document FROM publisher_docs ORDER BY revision DESC,id"):
        envelope = json.loads(row["document"])
        data = envelope["data"]
        kind = row["kind"]
        field = {"preview": "previewHash", "edition": "editionHash", "cohort": "cohortHash"}[kind]
        item = {
            "id": data[field], "kind": kind, "created_at": row["created_at"],
            "revision": row["revision"], "source": data["source"],
            "sourceSha256": data["sourceSha256"], "rows": len(data["rows"]),
            "native_source_id": (envelope.get("native") or {}).get("source_id"),
        }
        if kind == "cohort":
            item.update(label=data["label"], editionHash=data["editionHash"], summary=data["summary"])
        if kind == "preview":
            item["summary"] = data["summary"]
        result[{"preview": "previews", "edition": "editions", "cohort": "cohorts"}[kind]].append(item)
    return result

def document(workspace, db, kind, identity):
    if kind in {"edition-records", "cohort-records"}:
        return _get(db, kind.split("-")[0], identity)["native"]
    return _get(db, kind, identity)["data"]

def download(workspace, db, kind, identity):
    """Use original-preview / original-edition / original-cohort, or csv/json-kind."""
    try:
        format_name, document_kind = kind.split("-", 1)
    except ValueError:
        _error("Unknown publisher download.", 404)
    envelope = _get(db, document_kind, identity)
    data = envelope["data"]
    if format_name == "original":
        original = envelope["original"]
        row = db.execute("SELECT data FROM blobs WHERE sha=?", (original["sha256"],)).fetchone()
        if not row:
            _error("Original publisher file is absent.", 404, "PUBLISHER_SOURCE_MISSING")
        raw = bytes(row[0])
        if hashlib.sha256(raw).hexdigest() != original["sha256"]:
            _error("Original publisher file changed.", 409, "PUBLISHER_SOURCE_CHANGED")
        filename = re.sub(r"[^A-Za-z0-9._-]", "_", Path(original["filename"]).name) or "publisher.csv"
        return {"data": raw, "content_type": "text/csv; charset=utf-8", "filename": filename}
    if format_name == "csv" and document_kind in {"edition", "cohort"}:
        raw = _run("csv", {"edition": data}).encode("utf-8")
        return {"data": raw, "content_type": "text/csv; charset=utf-8", "filename": "publisher-" + identity[:16] + ".csv"}
    if format_name == "json":
        return {"data": (_json(data) + "\n").encode("utf-8"), "content_type": "application/json", "filename": "publisher-" + identity[:16] + ".json"}
    _error("Unknown publisher download.", 404)
