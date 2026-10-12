"""Import an operator-supplied original source packet into the same SF47 case."""
from __future__ import annotations

import base64
import hashlib
import json

from model import canonical, digest, now, text, Problem
from operations import SCHEMA, MAX_SOURCE, generated
import operations_domain as domain

INTAKE_SCHEMA = "scf.operations.source-intake.v1"


def import_source_intake(ops, raw, body):
    """One native transaction; the packet and its exact source texts stay private."""
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_SOURCE:
        domain.fail("Use a nonempty original source intake up to 8 MiB.", status=413)
    try:
        packet = json.loads(raw)
    except (ValueError, UnicodeError) as exc:
        raise Problem("The original source intake is not readable UTF-8 JSON.", 422, "INVALID_INTAKE") from exc
    if not isinstance(packet, dict) or packet.get("schema") != INTAKE_SCHEMA:
        domain.fail("Select an original SCF operations source-intake packet.")
    interest = packet.get("interest", {})
    if (interest.get("status") != "INTEREST_SUBMITTED_AWAITING_INVITATION"
            or interest.get("full_application_submitted") is not False
            or interest.get("invitation_received") is not False
            or any(packet.get(key) != [] for key in ("grant_awards", "grant_receipts", "customer_revenue_receipts"))):
        domain.fail("This importer handles the stated pre-award source packet. Use explicit case records for later issuer and cash events.", "INTAKE_STAGE")
    original_sources = packet.get("sources")
    purchases = packet.get("purchases")
    if not isinstance(original_sources, list) or not 1 <= len(original_sources) <= 20 or not isinstance(purchases, list) or len(purchases) > 100:
        domain.fail("The original intake source and purchase collections are invalid.")
    checked, seen = [], set()
    for item in original_sources:
        if not isinstance(item, dict) or not isinstance(item.get("text"), str) or item.get("encoding") != "utf-8":
            domain.fail("The original intake needs complete returned UTF-8 source texts.")
        ident = text(item.get("id"), "Original source identity", 200, True)
        if ident in seen:
            domain.fail("Original source identities must be distinct.")
        seen.add(ident)
        content = item["text"].encode("utf-8")
        if not content or len(content) != item.get("bytes") or hashlib.sha256(content).hexdigest() != item.get("sha256"):
            domain.fail("A source text differs from its original returned bytes.", "INTAKE_SOURCE_CHANGED", 409)
        checked.append((item, content))
    if interest.get("source_id") not in seen:
        domain.fail("The issuer acknowledgement source is not retained.")
    for item in purchases:
        if (not isinstance(item, dict) or item.get("participant_classification") != "TEAM_OPERATED"
                or item.get("network") != "stellar:testnet" or item.get("atomic_unit") != "stroop"
                or item.get("decimal_places") != 7 or item.get("source_id") not in seen
                or item.get("included_in_independent_customer_count") is not False
                or item.get("included_in_grant_cash") is not False
                or item.get("included_in_usd_revenue") is not False):
            domain.fail("Preserve the original team-operated testnet purchase classification.", "INTAKE_CLASSIFICATION")
    actor = text(body.get("actor"), "Recording operator", 300, True)
    name = text(body.get("name"), "Operations case name", 300, True)
    revision = domain.integer(body.get("selectedRevision"), "Saved plan revision", 1, 1000000)
    expected = domain.sha(body.get("expectedContentSha256"), "Reviewed plan content", False)
    anchor = domain.calendar(body.get("calendarStart"), "Operational calendar anchor", True)
    captured = domain.timestamp(packet.get("assembled_at"), "Original intake assembly time")
    acknowledged = domain.timestamp(interest.get("acknowledged_at"), "Issuer acknowledgement time")
    packet_sha = hashlib.sha256(raw).hexdigest()
    payload = {"domain": SCHEMA, "action": "intake", "packetSha256": packet_sha, "body": body}

    def action():
        plan = ops.workspace._read(body["planId"], revision)
        if plan["contentSha256"] != expected:
            domain.fail("The selected plan differs from the reviewed source.", "PLAN_SOURCE_CONFLICT", 409)
        pid, stamp, version = generated("operation"), now(), 1
        origin = {"kind": INTAKE_SCHEMA, "packetSha256": packet_sha, "assembledAt": captured,
                  "classification": "PREAWARD_TEAM_OPERATED_TESTNET", "originalPlanId": plan["id"]}
        ops.db.execute("INSERT INTO ops_programs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (pid, plan["id"], revision, version, "OPEN", name, "OPERATIONS",
             anchor or plan["planning"].get("calendarStart"), canonical(plan), stamp, stamp, canonical(origin)))
        event_body = {"actor": actor, "requestId": body["requestId"], "note": "Imported exact original pre-award sources"}
        ops._event(pid, version, event_body, "create",
                   after={"planId": plan["id"], "revision": revision, "contentSha256": expected,
                          "sourceSha256": plan["source"]["sha256"], "mode": "OPERATIONS", "packetSha256": packet_sha})

        def append_source(data):
            nonlocal version
            result = ops._source_add(pid, data)
            version += 1
            ops._event(pid, version, event_body, "source.add", after=result, kind="source", record_id=result["id"])
            return result["id"]

        def append_record(kind, data):
            nonlocal version
            values = domain.prepare(kind, data, ops._context(pid))
            version += 1
            result = {**values, "id": generated(domain.PREFIX[kind]), "version": version,
                      "createdAt": now(), "updatedAt": now(), "recordedBy": actor}
            ops._save(pid, kind, result)
            verb = "record" if kind in ("purchases", "cash") else "save"
            singular = {"awards": "award", "deployments": "deployment", "purchases": "purchase"}[kind]
            ops._event(pid, version, event_body, singular + "." + verb, after=result, kind=kind, record_id=result["id"])
            return result["id"]

        packet_id = append_source({"filename": "original-source-intake.json", "contentBase64": base64.b64encode(raw).decode(),
                                   "kind": "other", "mediaType": "application/json", "observedAt": captured})
        source_ids = {}
        for item, content in checked:
            source_ids[item["id"]] = append_source({
                "filename": item["id"] + ".md", "contentBase64": base64.b64encode(content).decode(),
                "mediaType": item.get("mime_type", "text/markdown"), "sourceUrl": item.get("url", ""),
                "kind": "grant" if item["id"] == interest["source_id"] else "purchase", "observedAt": captured})
        append_record("awards", {
            "stage": "INTEREST_ACKNOWLEDGED", "date": acknowledged[:10], "amountUsd": None,
            "reference": "gmail:" + text(interest.get("original_gmail_message_id"), "Original issuer message", 300, True),
            "sourceIds": [source_ids[interest["source_id"]], packet_id],
            "sourceNote": "Interest acknowledged at " + acknowledged + "; invitation and full application remain pending. No award or receipt is recorded."})
        for item in purchases:
            note = ("Original retained outcome: " + domain.url(item.get("original_outcome_url"), "Original outcome", False)
                    + "\nCanonical source section: " + str(item.get("source_section", ""))
                    + "\nTeam-operated Stellar testnet purchase; excluded from independent customer adoption, grant cash and USD revenue.")
            refs = [source_ids[item["source_id"]], packet_id]
            dep = append_record("deployments", {
                "name": text(item.get("title"), "Original operation title", 500, True),
                "operator": "TJL team-operated demonstration", "operatorId": "tjl-team-operated",
                "role": "BOTH", "participantClass": "TEAM_OPERATED", "environment": "TESTNET", "state": "OPERATING",
                "releaseRef": item["original_outcome_url"], "sourceIds": refs, "sourceNote": note})
            result = item.get("result", {})
            append_record("purchases", {
                "deploymentId": dep, "network": item["network"], "asset": item["asset"],
                "transactionHash": item["transaction_hash"], "ledger": item.get("ledger"),
                "amountStroops": item["amount_atomic"], "deliveredBytes": result.get("bytes"),
                "deliveredSha256": result.get("sha256") or "", "attemptStatus": "ATTEMPTED",
                "settlementStatus": "SETTLED", "outputStatus": "COMPLETE",
                "origin": "SOURCE_SUMMARY", "observedAt": captured, "sourceIds": refs,
                "sourceNote": note + "\nThis is the source-summary capture time. Native attempt/completion timestamps and intent IDs have not been invented."})
        ops.db.execute("UPDATE ops_programs SET version=?,updated_at=? WHERE id=?", (version, now(), pid))
        return {"id": pid, "version": version, "action": "intake", "planId": plan["id"], "planRevision": revision,
                "packetSha256": packet_sha, "sources": len(checked) + 1, "purchases": len(purchases),
                "applicationStage": "INTEREST_ACKNOWLEDGED", "grantAwards": 0, "grantReceipts": 0,
                "customerRevenueReceipts": 0, "independentCustomerOperators": 0}
    return ops.workspace._transaction(body.get("requestId"), payload, action)
