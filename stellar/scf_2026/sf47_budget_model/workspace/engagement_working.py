"""Read one original Contributor preparation/handoff request without a write.

The existing Operations requests, immutable record and case event are the only
authorities. This module owns no connection, transaction or request journal.
"""
from __future__ import annotations

import json
import re

from model import Problem, digest, short_id, text
import operations_domain as domain
import operations_engagements as engagements
import forecast as forecasts
import portfolio as portfolios

SCHEMA = "stellar-forge.sf47-engagement-request.v1"
OPERATIONS_SCHEMA = "stellar-forge.sf47-operations.v1"
ACTIONS = ("engagement.prepare", "forecast.save", "portfolio.save", "engagement.receiving")


def fail(message, code="INVALID_ENGAGEMENT_REQUEST", status=422):
    raise Problem(message, status, code)


def lookup(operations, program_id, body):
    """Caller holds the original Operations snapshot for this complete read."""
    engagements.obj(body, {"command"}, "Contributor request lookup")
    command = engagements.obj(body.get("command"),
        {"expectedVersion", "actor", "action", "data", "note", "requestId"},
        "Original Contributor command")
    action = command.get("action")
    if action not in ACTIONS:
        fail("Select an original engagement prepare, Forecast save, Portfolio save or receiving command.")
    version = domain.integer(command.get("expectedVersion"), "Original case version", 1, 10000000)
    actor = text(command.get("actor"), "Original recording operator", 300, True)
    note = text(command.get("note", ""), "Original operation note", 12000,
                action in ("engagement.prepare", "engagement.receiving"))
    if not isinstance(command.get("data"), dict):
        fail("Retain the whole original native command data.")
    request_id = short_id(command.get("requestId"), "Original request ID")
    if not isinstance(program_id, str) or not re.fullmatch(r"operation-[a-f0-9]{32}", program_id):
        fail("Select the original operating case.")
    operations._program(program_id)
    fingerprint = digest({"domain": OPERATIONS_SCHEMA, "programId": program_id, "body": command})
    row = operations.db.execute(
        "SELECT fingerprint,result_json FROM requests WHERE request_id=?", (request_id,)).fetchone()
    if row is None:
        return {"schema": SCHEMA, "found": False, "programId": program_id, "requestId": request_id}
    if row[0] != fingerprint:
        fail("This retained request ID belongs to another exact command.", "REQUEST_CONFLICT", 409)
    result = json.loads(row[1])
    kind = "forecast" if action == "forecast.save" else "portfolio" if action == "portfolio.save" else "review"
    if (not isinstance(result, dict) or result.get("id") != program_id
            or result.get("action") != action or result.get("version") != version + 1
            or result.get("kind") != kind or not isinstance(result.get("recordId"), str)):
        fail("The original result differs from its selected Contributor command.", "ENGAGEMENT_REQUEST_CHANGED", 409)
    table = {"forecast": "ops_forecasts", "portfolio": "ops_portfolios", "review": "ops_reviews"}[kind]
    saved = operations.db.execute("SELECT body_json FROM " + table + " WHERE program_id=? AND id=?",
                                 (program_id, result["recordId"])).fetchone()
    event_row = operations.db.execute(
        "SELECT body_json FROM ops_events WHERE program_id=? AND version=?", (program_id, result["version"])).fetchone()
    if saved is None or event_row is None:
        fail("The accepted request is missing its complete original record or case event.",
             "ENGAGEMENT_REQUEST_CHANGED", 409)
    record, event = json.loads(saved[0]), json.loads(event_row[0])
    if (not isinstance(record, dict) or not isinstance(event, dict)
            or digest({k: v for k, v in record.items() if k != "sha256"}) != record.get("sha256")
            or digest({k: v for k, v in event.items() if k != "sha256"}) != event.get("sha256")
            or record.get("id") != result["recordId"] or record.get("version") != result["version"]
            or record.get("actor") != actor or record.get("note") != note
            or event.get("requestId") != request_id or event.get("action") != action
            or event.get("actor") != actor or event.get("note") != note
            or event.get("kind") != kind or event.get("recordId") != record["id"]
            or event.get("version") != result["version"]):
        fail("The original request, immutable record and event no longer agree.",
             "ENGAGEMENT_REQUEST_CHANGED", 409)
    if action == "engagement.prepare":
        if record.get("purpose") != engagements.PURPOSE or result.get("reviewSha256") != record["sha256"]:
            fail("The original engagement edition identity differs.", "ENGAGEMENT_REQUEST_CHANGED", 409)
        summary = engagements.summary(record)
    elif action == "engagement.receiving":
        if record.get("purpose") != engagements.RECEIVING_PURPOSE or result.get("reviewSha256") != record["sha256"]:
            fail("The original engagement receiving identity differs.", "ENGAGEMENT_REQUEST_CHANGED", 409)
        summary = engagements.receiving_summary(record)
        for key in ("book", "forecast", "portfolio"):
            if result.get(key) != record["engagementReceiving"][key]:
                fail("The original receiving result differs from its complete saved join.",
                     "ENGAGEMENT_REQUEST_CHANGED", 409)
    else:
        summary = forecasts.summary(record) if kind == "forecast" else portfolios.summary(record)
    expected_result = {"id": program_id, "version": version + 1, "action": action,
                       "kind": kind, "recordId": record["id"]}
    if action in ("engagement.prepare", "engagement.receiving"):
        expected_result["reviewSha256"] = record["sha256"]
    if action == "engagement.receiving":
        for key in ("book", "forecast", "portfolio"):
            expected_result[key] = record["engagementReceiving"][key]
    if result != expected_result:
        fail("The complete original receipt differs from its accepted record.",
             "ENGAGEMENT_REQUEST_CHANGED", 409)
    if event.get("after") != summary:
        fail("The original event differs from its saved Contributor result.", "ENGAGEMENT_REQUEST_CHANGED", 409)
    return {"schema": SCHEMA, "found": True, "programId": program_id, "requestId": request_id,
            "fingerprint": fingerprint, "result": result,
            "record": {"id": record["id"], "kind": kind, "sha256": record["sha256"]},
            "eventSha256": event["sha256"]}
