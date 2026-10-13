"""Receive original issuer messages through native Operations sources and history."""
from __future__ import annotations

import base64
from copy import deepcopy
import hashlib
import json
import re
import uuid

from model import Problem, canonical, digest, now, text
import operations_domain as domain
import issuer_correspondence as parser

SCHEMA = "stellar-forge.issuer-correspondence.receiving.v1"
MARKER = "issuerCorrespondence"
ACTION = "issuer-correspondence.bind"


def fail(message, code="ISSUER_CORRESPONDENCE_SOURCE", status=422):
    raise Problem(message, status, code)


def fields(value, allowed):
    if not isinstance(value, dict) or set(value) - set(allowed):
        fail("Use the documented complete issuer message input.")
    return value


def input_data(value):
    fields(value, ("filename", "mediaType", "contentBase64", "observedAt", "sourceUrl"))
    filename = text(value.get("filename"), "Original issuer filename", 240, True)
    media = text(value.get("mediaType", "message/rfc822"), "Original media type", 200, True)
    if "/" in filename or "\\" in filename or filename in (".", "..") or any(ord(ch) < 32 for ch in filename):
        fail("Use the original plain filename.")
    if not re.fullmatch(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+", media):
        fail("Use the original source media type.")
    observed = domain.timestamp(value.get("observedAt"), "Source observation time")
    url = domain.url(value.get("sourceUrl", ""), "Original source URL")
    encoded = value.get("contentBase64")
    if not isinstance(encoded, str) or len(encoded) > (8 * 1024 * 1024 + 2) * 4 // 3 + 16:
        fail("Receive a nonempty original issuer source up to 8 MiB.", status=413)
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as exc:
        raise Problem("The original issuer bytes are unreadable.", 422, "INVALID_SOURCE") from exc
    if not raw or len(raw) > 8 * 1024 * 1024:
        fail("Receive a nonempty original issuer source up to 8 MiB.", status=413)
    return {"filename": filename, "mediaType": media, "observedAt": observed,
            "sourceUrl": url, "contentBase64": encoded}, raw


def inspect(value):
    source, raw = input_data(value)
    inspection = parser.inspect_correspondence(raw, source["filename"], media_type=source["mediaType"])
    candidates = parser.source_candidates(raw, inspection, observed_at=source["observedAt"], source_url=source["sourceUrl"])
    if not isinstance(candidates, list):
        fail("The maintained correspondence parser returned an unsupported selection.")
    identity = {"filename": source["filename"], "mediaType": source["mediaType"],
                "observedAt": source["observedAt"], "sourceUrl": source["sourceUrl"],
                "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                "candidates": [{k: candidate.get(k) for k in ("key", "path", "available", "bytes", "sha256",
                              "nativeFilename", "mediaType", "representation", "decodeIssue", "issue")} for candidate in candidates]}
    return {"schema": SCHEMA + ".preview", "inspection": inspection, "candidates": candidates,
            "source": identity, "inspectionSha256": digest(identity)}


def summary(row):
    value = row["edition"]
    metadata = value["inspection"].get("metadata", {})
    return {"sourceId": row["source"]["id"], "sha256": row["source"]["sha256"],
            "subject": metadata.get("subject", ""), "messageId": metadata.get("messageId", ""),
            "date": metadata.get("date", ""), "dateUtc": metadata.get("dateUtc"),
            "filename": value["inspection"]["original"]["filename"],
            "originalSourceId": next(choice["source"]["id"] for choice in value["selected"] if choice["path"] == "original"),
            "attachmentCount": sum(choice["path"] != "original" for choice in value["selected"]),
            "caseVersion": value["caseVersion"], "savedAt": value["savedAt"]}


def read_record(metadata, raw):
    if len(raw) != metadata["bytes"] or hashlib.sha256(raw).hexdigest() != metadata["sha256"]:
        fail("The retained original issuer receiving source differs.", status=409)
    try:
        value = json.loads(raw)
        if (value.get("schema") != SCHEMA
                or digest({k: v for k, v in value.items() if k != "sha256"}) != value.get("sha256")
                or metadata.get(MARKER) != {"schema": SCHEMA, "id": value["id"], "sha256": value["sha256"]}
                or not re.fullmatch(r"issuer-message-[a-f0-9]{32}", value["id"])):
            fail("Keep the complete original message receiving index.")
        domain.integer(value["caseVersion"], "Original receiving version", 2, 10000000)
        domain.timestamp(value["savedAt"], "Original receiving time")
        text(value["actor"], "Receiving operator", 300, True)
        if value["inspection"].get("schema") != "stellar-forge.issuer-correspondence.v1":
            fail("The complete original correspondence inspection is required.")
        if not isinstance(value["selected"], list) or not any(row.get("path") == "original" for row in value["selected"]):
            fail("The receiving selection must retain the original whole message.")
        return {"source": metadata, "edition": value}
    except (KeyError, TypeError, ValueError, UnicodeError) as exc:
        if isinstance(exc, Problem):
            raise
        raise Problem("The original issuer receiving index cannot be read.", 422, "ISSUER_CORRESPONDENCE_SOURCE") from exc


def records(operations, program_id):
    rows = []
    for metadata_raw, raw in operations.db.execute(
            "SELECT metadata_json,content FROM ops_sources WHERE program_id=? ORDER BY id", (program_id,)):
        metadata = json.loads(metadata_raw)
        if MARKER in metadata:
            rows.append(read_record(metadata, bytes(raw)))
    return sorted(rows, key=lambda row: row["edition"]["caseVersion"], reverse=True)


def get(operations, program_id, source_id):
    for row in records(operations, program_id):
        if row["source"]["id"] == source_id:
            return row
    fail("Select a retained original issuer message.", "ISSUER_CORRESPONDENCE_NOT_FOUND", 404)


def bind(operations, context, data, actor, version, note):
    fields(data, ("inspection", "identity", "selected", "inspectionSha256", "initialCaseVersion"))
    for row in data["selected"]:
        if context["sources"].get(row["source"]["id"]) != row["source"]:
            fail("A received attachment differs from its original native source record.", status=409)
    value = {"schema": SCHEMA, "id": "issuer-message-" + uuid.uuid4().hex,
             "caseVersion": version, "initialCaseVersion": data["initialCaseVersion"],
             "savedAt": now(), "actor": actor, "note": note,
             "inspection": data["inspection"], "identity": data["identity"],
             "inspectionSha256": data["inspectionSha256"], "selected": data["selected"]}
    value["sha256"] = digest(value)
    raw = (canonical(value) + "\n").encode()
    metadata = operations._source_add(context["program"]["id"], {
        "filename": value["id"] + ".json", "mediaType": "application/json", "kind": "grant",
        "observedAt": value["savedAt"], "contentBase64": base64.b64encode(raw).decode("ascii")})
    metadata[MARKER] = {"schema": SCHEMA, "id": value["id"], "sha256": value["sha256"]}
    operations.db.execute("UPDATE ops_sources SET metadata_json=? WHERE program_id=? AND id=?",
                          (canonical(metadata), context["program"]["id"], metadata["id"]))
    return {"before": None, "after": metadata, "kind": "source", "recordId": metadata["id"],
            "correspondence": summary({"source": metadata, "edition": value})}


def receive(operations, program_id, body):
    fields(body, ("requestId", "expectedVersion", "actor", "note", "input", "selectedPaths", "expectedInspectionSha256"))
    expected = domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000)
    actor = text(body.get("actor"), "Receiving operator", 300, True)
    note = text(body.get("note"), "Message receiving note", 12000, True)
    payload = {"domain": SCHEMA, "programId": program_id, "body": body}
    def action():
        context = operations._context(program_id)
        if context["program"]["version"] != expected:
            fail("The case changed. Retain the original message and review its current source.", "OPERATIONS_CONFLICT", 409)
        preview = inspect(body.get("input"))
        if preview["inspectionSha256"] != body.get("expectedInspectionSha256"):
            fail("The original message differs from the reviewed attachment selection.", status=409)
        available = {row["path"]: row for row in preview["candidates"] if row.get("available")}
        keys = body.get("selectedPaths")
        if (not isinstance(keys, list) or any(not isinstance(key, str) for key in keys)
                or len(keys) != len(set(keys)) or not keys or any(key not in available for key in keys)):
            fail("Select distinct available original message and attachment choices.")
        if not any(available[key]["path"] == "original" for key in keys):
            fail("Retain the original whole message with the selected attachment representations.")
        selected, receipts = [], []
        version = expected
        for key in keys:
            candidate = available[key]
            receipt = operations.command(program_id, {
                "requestId": "issuer-source-" + digest({"outer": body["requestId"], "key": key})[:64],
                "expectedVersion": version, "actor": actor, "note": note,
                "action": "source.add", "data": deepcopy(candidate["data"])}, _within_transaction=True)
            version = receipt["version"]
            metadata, _ = operations.source(program_id, receipt["recordId"])
            selected.append({key: deepcopy(candidate[key]) for key in candidate if key != "data"} | {"source": metadata})
            receipts.append(receipt)
        receipt = operations.command(program_id, {
            "requestId": "issuer-index-" + digest({"outer": body["requestId"]})[:64],
            "expectedVersion": version, "actor": actor, "note": note, "action": ACTION,
            "data": {"inspection": preview["inspection"], "identity": preview["source"],
                     "inspectionSha256": preview["inspectionSha256"], "selected": selected,
                     "initialCaseVersion": expected}}, _within_transaction=True)
        operations.export(program_id)
        return {**receipt, "action": "issuer-correspondence.receive", "sourceCommands": receipts,
                "selection": {"sourceIds": [row["source"]["id"] for row in selected],
                              "indexSourceId": receipt["recordId"]}}
    return operations.workspace._transaction(body.get("requestId"), payload, action)


def validate_import(context, events, files):
    selected = []
    for metadata in context["sources"].values():
        if MARKER in metadata:
            selected.append(read_record(metadata, files["sources/" + metadata["id"]]))
    for row in selected:
        value, metadata = row["edition"], row["source"]
        version = value["caseVersion"]
        if version > len(events):
            fail("The issuer receiving index has no original save event.")
        event = events[version - 1]
        if (event.get("action") != ACTION or event.get("kind") != "source" or event.get("recordId") != metadata["id"]
                or event.get("after") != metadata or event.get("actor") != value["actor"] or event.get("note", "") != value["note"]):
            fail("The original message index differs from its retained native event.")
        if (digest(value["identity"]) != value["inspectionSha256"]
                or value["initialCaseVersion"] + len(value["selected"]) + 1 != version):
            fail("The original message selection or receiving history differs.")
        original = next(choice for choice in value["selected"] if choice["path"] == "original")
        original_raw = files["sources/" + original["source"]["id"]]
        # Reuse the same original parser on receiving, including its warning and
        # malformed-encoding representations, while keeping complete raw bytes.
        fresh = inspect({"filename": value["identity"]["filename"], "mediaType": value["identity"]["mediaType"],
                         "observedAt": value["identity"]["observedAt"], "sourceUrl": value["identity"]["sourceUrl"],
                         "contentBase64": base64.b64encode(original_raw).decode("ascii")})
        if (fresh["inspection"] != value["inspection"] or fresh["inspectionSha256"] != value["inspectionSha256"]):
            fail("The received message differs from the original full inspection.")
        available = {choice["key"]: choice for choice in fresh["candidates"] if choice.get("available")}
        seen = set()
        for index, choice in enumerate(value["selected"]):
            key = choice.get("key")
            if key in seen or key not in available:
                fail("The received message repeats or omits an original attachment choice.")
            seen.add(key)
            candidate = available[key]
            expected_choice = {key: deepcopy(candidate[key]) for key in candidate if key != "data"} | {"source": choice["source"]}
            if choice != expected_choice or context["sources"].get(choice["source"]["id"]) != choice["source"]:
                fail("The attachment selection differs from its original representation.")
            raw = files["sources/" + choice["source"]["id"]]
            if raw != base64.b64decode(candidate["data"]["contentBase64"], validate=True):
                fail("The received original attachment bytes differ.")
            original_event = events[value["initialCaseVersion"] + index]
            if (original_event.get("action") != "source.add" or original_event.get("after") != choice["source"]
                    or original_event.get("actor") != value["actor"]):
                fail("The attachment differs from its original source writer event.")
    if {row["source"]["id"] for row in selected} != {event.get("recordId") for event in events if event.get("action") == ACTION}:
        fail("The complete receiving history is missing an original issuer message index.")
    return selected
