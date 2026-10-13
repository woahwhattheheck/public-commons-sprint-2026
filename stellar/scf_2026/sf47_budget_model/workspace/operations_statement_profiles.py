"""Named, immutable statement setups in the existing Grant Operations case."""
from __future__ import annotations

import base64
from copy import deepcopy
import hashlib
import json
import re
import uuid

from model import Problem, canonical, digest, now, text
import operations_domain as domain

SCHEMA = "stellar-forge.sf47-statement-setups.v1"
MEDIA = "application/vnd.stellar-forge.statement-setup+json"
MARKER = "statementSetup"
ACTION = "statement-setup.save"
SETTING_KEYS = ("sourceFormat", "accountId", "accountLabel", "currency", "defaultCategory")
BANK_KEYS = ("sourceFormat", "accountReference", "bankId", "kind", "nativeAccountSha256", "dateBasis")


def fail(message, code="INVALID_STATEMENT_SETUP", status=422):
    domain.fail(message, code, status)


def obj(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        fail(label + ": use the supported complete object.")
    return value


def settings(inputs):
    """Reuse the actual statement interpretation validator, without row decisions."""
    import operations_statements as statements
    import operations_statement_formats as formats
    source_format = domain.enum(inputs.get("sourceFormat", "CSV"), ("CSV", "OFX", "MT940"), "Statement format")
    effective = {key: deepcopy(inputs[key]) for key in SETTING_KEYS if key in inputs}
    effective["sourceFormat"] = source_format
    effective["source"] = None  # configuration validates interpretation, not source bytes.
    if source_format == "CSV":
        effective.update({key: deepcopy(inputs.get(key)) for key in ("format", "columns")})
    else:
        effective.update({"format": formats.FORMAT, "columns": formats.COLUMNS})
    config = statements.configuration(effective)
    result = {"sourceFormat": source_format, **{key: deepcopy(config[key]) for key in SETTING_KEYS if key != "sourceFormat"}}
    if source_format == "CSV":
        columns = {key: config["columns"].get(key, "") for key in
                   ("date", "reference", "description", "amount", "debit", "credit", "currency", "usdValue")}
        for key in (("debit", "credit") if config["format"]["amountMode"] == "SIGNED" else ("amount",)):
            columns[key] = ""
        result.update({"format": config["format"], "columns": columns})
    else:
        _, options = formats.options(inputs)
        if source_format == "MT940":
            result["statementOptions"] = options
    return result


def basis(inputs, normalized):
    import operations_statements as statements
    import operations_statement_formats as formats
    raw, decoded, metadata = statements.source_input(inputs.get("source"), normalized["sourceFormat"] == "CSV")
    result = {"sourceSha256": metadata["sha256"], "filename": metadata["filename"], "headers": [], "bank": None}
    if normalized["sourceFormat"] == "CSV":
        config = statements.configuration({**normalized, "source": inputs["source"]})
        result["headers"] = statements.read_csv(decoded, config)[0]
        if any(len(header) > 300 for header in result["headers"]):
            fail("Saved setups support original column headings up to 300 characters.")
    else:
        selected = formats.select(raw, metadata, {**normalized, "statementId": inputs.get("statementId")})
        result["bank"] = {key: selected["summary"].get(key) for key in BANK_KEYS}
    return result


def link(row):
    if row is None:
        return None
    edition = row["edition"]
    return {"id": edition["id"], "name": edition["name"], "revision": edition["revision"],
            "sourceId": row["source"]["id"], "sourceSha256": row["source"]["sha256"],
            "editionSha256": edition["sha256"]}


def summary(row):
    e = row["edition"]
    return {**link(row), "status": e["status"], "caseVersion": e["caseVersion"],
            "savedAt": e["savedAt"], "actor": e["actor"], "note": e["note"],
            "settings": deepcopy(e["settings"]), "basis": deepcopy(e["basis"])}


def read_record(metadata, raw):
    try:
        if (metadata.get("mediaType") != MEDIA or len(raw) != metadata.get("bytes")
                or hashlib.sha256(raw).hexdigest() != metadata.get("sha256")):
            fail("The saved statement setup differs from its complete source.", "STATEMENT_SETUP_SOURCE", 409)
        e = json.loads(raw)
        required = {"schema", "id", "name", "revision", "status", "caseVersion", "previous",
                    "savedAt", "actor", "note", "settings", "basis", "sha256"}
        if not isinstance(e, dict) or set(e) != required or e.get("schema") != SCHEMA:
            fail("The complete saved statement setup edition is required.")
        if not isinstance(e["id"], str) or not re.fullmatch(r"statement-setup-[a-f0-9]{32}", e["id"]):
            fail("The original statement setup identity is invalid.")
        text(e["name"], "Saved setup name", 160, True)
        domain.enum(e["status"], ("ACTIVE", "ARCHIVED"), "Setup status")
        domain.integer(e["revision"], "Setup edition", 1, 1000000)
        domain.integer(e["caseVersion"], "Setup case version", 2, 10000000)
        domain.timestamp(e["savedAt"], "Setup save time")
        text(e["actor"], "Setup recording operator", 300, True)
        text(e["note"], "Setup save note", 12000, True)
        if settings(e["settings"]) != e["settings"]:
            fail("The retained statement setup interpretation changed.")
        b = obj(e["basis"], ("sourceSha256", "filename", "headers", "bank"), "Setup original mapping basis")
        if set(b) != {"sourceSha256", "filename", "headers", "bank"}:
            fail("Keep the complete setup source identity and mapping basis.")
        domain.sha(b["sourceSha256"], "Original mapped source digest", False)
        text(b["filename"], "Original mapped filename", 240, True)
        if (not isinstance(b["headers"], list) or len(b["headers"]) > 200
                or any(not isinstance(h, str) or not h.strip() or len(h) > 300 for h in b["headers"])
                or len(set(b["headers"])) != len(b["headers"])):
            fail("The retained setup headers are invalid.")
        if e["settings"]["sourceFormat"] == "CSV":
            if b["bank"] is not None or not b["headers"] or any(
                    h and h not in b["headers"] for h in e["settings"]["columns"].values()):
                fail("Keep the exact mapped CSV headers in the setup basis.")
        elif (b["headers"] or not isinstance(b["bank"], dict) or set(b["bank"]) != set(BANK_KEYS)
              or b["bank"]["sourceFormat"] != e["settings"]["sourceFormat"]):
            fail("Keep the original selected bank account context.")
        marker = {"schema": SCHEMA, "id": e["id"], "revision": e["revision"], "sha256": e["sha256"]}
        if (digest({k: v for k, v in e.items() if k != "sha256"}) != e["sha256"]
                or metadata.get(MARKER) != marker):
            fail("The retained statement setup edition changed.", "STATEMENT_SETUP_SOURCE", 409)
        return {"source": metadata, "edition": e}
    except (KeyError, TypeError, ValueError, UnicodeError) as exc:
        if isinstance(exc, Problem):
            raise
        fail("The saved statement setup is incomplete or unreadable.", "STATEMENT_SETUP_SOURCE", 409)


def checked_chain(values):
    values = sorted(values, key=lambda row: (row["edition"]["id"], row["edition"]["revision"]))
    previous = {}
    for row in values:
        e = row["edition"]
        prior = previous.get(e["id"])
        if (e["revision"] != (prior["edition"]["revision"] + 1 if prior else 1)
                or e["previous"] != link(prior)
                or prior and e["caseVersion"] <= prior["edition"]["caseVersion"]):
            fail("Keep each setup's complete ordered editions.", "STATEMENT_SETUP_HISTORY", 409)
        previous[e["id"]] = row
    return values


def records(operations, case_id):
    result = []
    for metadata_raw, raw in operations.db.execute(
            "SELECT metadata_json,content FROM ops_sources WHERE program_id=? ORDER BY id", (case_id,)):
        metadata = json.loads(metadata_raw)
        if MARKER in metadata:
            result.append(read_record(metadata, bytes(raw)))
    return checked_chain(result)


def save(operations, context, data, actor, version, note):
    obj(data, ("id", "expectedRevision", "name", "status", "inputs"), "Save statement setup")
    text(note, "Reason for this setup edition", 12000, True)
    ident = data.get("id")
    history = records(operations, context["program"]["id"])
    prior = next((row for row in reversed(history) if row["edition"]["id"] == ident), None)
    revision = domain.integer(data.get("expectedRevision"), "Current setup edition", 0, 1000000)
    if (ident is not None and prior is None) or revision != (prior["edition"]["revision"] if prior else 0):
        fail("Refresh this case and compare the latest saved setup before saving an edition.", "STATEMENT_SETUP_CONFLICT", 409)
    status = domain.enum(data.get("status", "ACTIVE"), ("ACTIVE", "ARCHIVED"), "Setup status")
    name = text(data.get("name"), "Saved setup name", 160, True)
    if status == "ARCHIVED":
        if not prior or "inputs" in data:
            fail("Archive the selected existing setup without replacing its mapping.")
        normalized, original = deepcopy(prior["edition"]["settings"]), deepcopy(prior["edition"]["basis"])
    else:
        inputs = obj(data.get("inputs"), (
            "source", "accountId", "accountLabel", "currency", "sourceFormat", "format", "columns",
            "defaultCategory", "statementOptions", "statementId", "statementSetup", "openingBalance",
            "closingBalance", "decisions", "valuationNote", "sourceReviewNote"), "Actual mapped statement")
        normalized = settings(inputs)
        original = basis(inputs, normalized)
    ident = ident or "statement-setup-" + uuid.uuid4().hex
    e = {"schema": SCHEMA, "id": ident, "name": name, "revision": revision + 1, "status": status,
         "caseVersion": version, "previous": link(prior), "savedAt": now(), "actor": actor, "note": note,
         "settings": normalized, "basis": original}
    e["sha256"] = digest(e)
    raw = (canonical(e) + "\n").encode()
    metadata = operations._source_add(context["program"]["id"], {
        "contentBase64": base64.b64encode(raw).decode("ascii"),
        "filename": ident + "-r" + str(e["revision"]) + ".json",
        "mediaType": MEDIA, "kind": "other", "observedAt": e["savedAt"]})
    metadata[MARKER] = {"schema": SCHEMA, "id": ident, "revision": e["revision"], "sha256": e["sha256"]}
    operations.db.execute("UPDATE ops_sources SET metadata_json=? WHERE program_id=? AND id=?",
                         (canonical(metadata), context["program"]["id"], metadata["id"]))
    saved = read_record(metadata, raw)
    return {"before": None, "after": metadata, "kind": "source", "recordId": metadata["id"],
            "statementSetup": summary(saved)}


def validate_selection(summaries, inputs, bank=None, *, before_version=None):
    selected = inputs.get("statementSetup")
    if selected is None:
        return None
    if not isinstance(selected, dict):
        fail("Select a complete saved statement setup edition.")
    row = next((r for r in summaries if {k: r[k] for k in
               ("id", "name", "revision", "sourceId", "sourceSha256", "editionSha256")} == selected), None)
    if (row is None or row["status"] != "ACTIVE"
            or before_version is not None and row["caseVersion"] >= before_version):
        fail("The selected statement setup edition is absent from this original case.", "STATEMENT_SETUP_SELECTION", 409)
    if settings(inputs) != row["settings"]:
        fail("The mapping changed after choosing this setup. Save the current mapping as a new edition or clear its setup selection.",
             "STATEMENT_SETUP_CHANGED", 409)
    if row["basis"]["bank"] is not None and {k: (bank or {}).get(k) for k in BANK_KEYS} != row["basis"]["bank"]:
        fail("The selected original bank account differs from this setup. Review its account and save a separate setup.",
             "STATEMENT_SETUP_ACCOUNT", 409)
    return deepcopy(selected)


def validate_import(context, events, files):
    history = checked_chain([read_record(metadata, files["sources/" + metadata["id"]])
                             for metadata in context["sources"].values() if MARKER in metadata])
    matched = set()
    for row in history:
        e, metadata = row["edition"], row["source"]
        if e["caseVersion"] > len(events):
            fail("A saved statement setup lacks its original event.", "STATEMENT_SETUP_HISTORY", 409)
        event = events[e["caseVersion"] - 1]
        if (event.get("action") != ACTION or event.get("kind") != "source"
                or event.get("recordId") != metadata["id"] or event.get("after") != metadata
                or event.get("actor") != e["actor"] or event.get("note") != e["note"]):
            fail("A saved statement setup differs from its original save.", "STATEMENT_SETUP_HISTORY", 409)
        matched.add(metadata["id"])
    if {event.get("recordId") for event in events if event.get("action") == ACTION} != matched:
        fail("The case is missing an original statement setup edition.", "STATEMENT_SETUP_HISTORY", 409)
    summaries = [summary(row) for row in history]
    for metadata in context["sources"].values():
        marker = metadata.get("statement", {})
        if not isinstance(marker, dict) or marker.get("role") not in ("CSV", "ORIGINAL"):
            continue
        review = json.loads(files["sources/" + marker["reviewSourceId"]])
        inputs = review.get("inputs", {})
        selected = validate_selection(summaries, inputs, review.get("preview", {}).get("bank"),
                                      before_version=review["caseVersion"])
        if selected is not None and review.get("preview", {}).get("statementSetup") != selected:
            fail("The statement preview lost its selected setup edition.", "STATEMENT_SETUP_HISTORY", 409)
    return history
