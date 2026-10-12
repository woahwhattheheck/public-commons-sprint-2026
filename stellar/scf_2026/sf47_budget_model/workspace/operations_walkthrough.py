"""Run one resumable delivery-operations walkthrough through the original local server.

This starts no server and makes no external payment. The cash/delivery case is
explicitly WALKTHROUGH. An optional original source packet creates a separate
OPERATIONS case with its retained pre-award and team-operated testnet semantics.
"""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import tempfile
from urllib.parse import quote, urlsplit
import uuid
import zipfile


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n").encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def atomic(path, raw):
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)



def duplicated_review_bundle(raw):
    """One malformed receive of the existing export, through the same importer."""
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        members = {item.filename: (item, archive.read(item.filename)) for item in archive.infolist()}
    document = json.loads(members["operations.json"][1])
    document["reviews"].append(deepcopy(document["reviews"][0]))
    changed = encoded(document)
    members["operations.json"] = (members["operations.json"][0], changed)
    manifest = json.loads(members["MANIFEST.json"][1])
    for item in manifest["files"]:
        if item["path"] == "operations.json":
            item.update(bytes=len(changed), sha256=sha(changed))
    members["MANIFEST.json"] = (members["MANIFEST.json"][0], encoded(manifest))
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for info, content in members.values():
            archive.writestr(info, content)
    return output.getvalue()

class Receiving:
    def __init__(self, url, key_file, output, plan_id):
        origin = urlsplit(url)
        if origin.scheme != "http" or origin.hostname not in ("127.0.0.1", "localhost", "::1") or origin.username or origin.password or origin.path not in ("", "/") or origin.query or origin.fragment:
            raise ValueError("Use the original loopback HTTP server origin.")
        self.origin, self.address = url.rstrip("/"), origin
        self.token = Path(key_file).read_text().strip()
        self.output = Path(output).expanduser().resolve()
        self.output.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.checkpoint = self.output / "operations-walkthrough-checkpoint.json"
        if self.checkpoint.exists():
            self.state = json.loads(self.checkpoint.read_bytes())
            if self.state["planId"] != plan_id:
                raise ValueError("This receiving checkpoint belongs to another selected plan.")
        else:
            self.state = {"schema": "sf47.operations-walkthrough.v1", "planId": plan_id,
                          "prefix": "walkthrough-" + uuid.uuid4().hex, "steps": {}}
            self.save()
        self.prefix = self.state["prefix"]

    def save(self):
        atomic(self.checkpoint, encoded(self.state))

    def request(self, path, body=None, headers=None):
        if not path.startswith("/api/") or path.startswith("//"):
            raise ValueError("Use an original workspace API path.")
        supplied = {"Authorization": "Bearer " + self.token, "Origin": self.origin}
        supplied.update(headers or {})
        if isinstance(body, bytes):
            raw = body
        elif body is None:
            raw = None
        else:
            raw = encoded(body)
            supplied["Content-Type"] = "application/json"
        connection = http.client.HTTPConnection(self.address.hostname, self.address.port or 80, timeout=30)
        try:
            connection.request("GET" if body is None else "POST", path, body=raw, headers=supplied)
            response = connection.getresponse()
            result = response.read()
            if "application/json" in response.getheader("Content-Type", ""):
                result = json.loads(result)
            return response.status, result
        finally:
            connection.close()

    def read(self, path):
        status, value = self.request(path)
        if status != 200:
            raise RuntimeError("Original read failed: " + path + " HTTP " + str(status))
        return value

    def step(self, key, path, build, *, expected=200, headers=None):
        retained = self.state["steps"].get(key)
        if retained and "result" in retained:
            return retained["result"]
        if not retained:
            body = build()
            retained = {"path": path, "expected": expected, "headers": headers or {},
                        "body": base64.b64encode(body).decode() if isinstance(body, bytes) else body,
                        "binary": isinstance(body, bytes)}
            self.state["steps"][key] = retained
            self.save()
        if retained["path"] != path or retained["expected"] != expected:
            raise ValueError("The resumed step differs from its retained operation.")
        body = base64.b64decode(retained["body"]) if retained["binary"] else retained["body"]
        status, value = self.request(path, body, retained["headers"])
        if status != expected:
            safe = value.get("message", value.get("error", "Request failed")) if isinstance(value, dict) else "Unreadable response"
            raise RuntimeError(key + ": HTTP " + str(status) + " " + str(safe))
        retained["result"] = value
        self.save()
        return value

    def command(self, key, case_id, action, data, note="Internal fictional walkthrough"):
        def body():
            return {"expectedVersion": self.read("/api/operations/" + case_id)["program"]["version"],
                    "requestId": self.prefix + "-" + key, "actor": "Internal walkthrough operator",
                    "note": note, "action": action, "data": data() if callable(data) else data}
        return self.step(key, "/api/operations/" + case_id + "/command", body)

    def rejected(self, key, case_id, action, data, expected=409):
        return self.step(key, "/api/operations/" + case_id + "/command",
            lambda: {"expectedVersion": self.read("/api/operations/" + case_id)["program"]["version"],
                     "requestId": self.prefix + "-" + key, "actor": "Internal walkthrough operator",
                     "note": "Expected refusal inside the fictional walkthrough", "action": action, "data": data},
            expected=expected)

    def bundle(self, case_id):
        path = self.output / "fictional-delivery-operations.zip"
        if "archive" not in self.state:
            raw = self.read("/api/operations/" + case_id + "/export.zip")
            atomic(path, raw)
            self.state["archive"] = {"path": path.name, "bytes": len(raw), "sha256": sha(raw)}
            self.save()
        raw = path.read_bytes()
        if sha(raw) != self.state["archive"]["sha256"]:
            raise ValueError("The retained walkthrough export changed.")
        return raw


def run(client, source_intake=None):
    original = client.read("/api/plans/" + client.state["planId"])
    if "originalSelection" not in client.state:
        client.state["originalSelection"] = {key: original[key] for key in ("id", "revision", "contentSha256")}
        client.save()
    selected = client.state["originalSelection"]
    original = client.read("/api/plans/" + selected["id"] + "/revision/" + str(selected["revision"]))
    if original["contentSha256"] != selected["contentSha256"]:
        raise ValueError("The selected original plan changed.")
    actual_case = None
    if source_intake:
        packet = Path(source_intake).read_bytes()
        packet_sha = sha(packet)
        prior = client.state.get("originalIntakeSha256")
        if prior and prior != packet_sha:
            raise ValueError("Use the same original source packet to resume.")
        client.state["originalIntakeSha256"] = packet_sha; client.save()
        actual_case = client.step("original-intake", "/api/operations/intake", lambda: {
            "planId": original["id"], "selectedRevision": original["revision"],
            "expectedContentSha256": original["contentSha256"], "name": "SCF original pre-award operating record",
            "actor": "Original source receiving operator", "requestId": client.prefix + "-original-intake",
            "packetBase64": base64.b64encode(packet).decode()})
        actual = client.read("/api/operations/" + actual_case["id"])
        assert actual["program"]["mode"] == "OPERATIONS"
        assert actual["report"]["applicationStage"] == "INTEREST_ACKNOWLEDGED"
        assert actual["report"]["cash"]["grantReceiptsUsd"] == "0.00"
        assert not actual["records"]["cash"] and len(actual["records"]["purchases"]) == 7
        assert sum(int(row["amountStroops"]) for row in actual["records"]["purchases"]) == 310000
        assert all(row["participantClass"] == "TEAM_OPERATED" and row["network"] == "stellar:testnet" for row in actual["records"]["purchases"])

    copied = client.step("copy-planning", "/api/plans/" + original["id"] + "/clone", lambda: {
        "expectedRevision": client.read("/api/plans/" + original["id"])["currentRevision"],
        "name": "Internal walkthrough — delivery plan", "requestId": client.prefix + "-copy-plan"})
    plan_id, revision = copied["id"], copied["revision"]
    case = client.step("open-case", "/api/operations", lambda: {
        "planId": plan_id, "selectedRevision": revision, "expectedContentSha256": copied["contentSha256"],
        "name": "Internal walkthrough — delivery, invoices and cash", "mode": "WALKTHROUGH",
        "calendarStart": "2026-10-11", "actor": "Internal walkthrough operator", "requestId": client.prefix + "-open-case"})
    case_id = case["id"]
    cost_id = copied["scenario"]["future_costs"][0]["id"]
    fixture = b"INTERNAL WALKTHROUGH ONLY\nFictional completed work, supplier invoice, grant receipt and deployment handover.\nNo actual award, money transfer or customer acceptance is asserted.\n"
    attached = client.command("source", case_id, "source.add", {"filename": "fictional-workflow-source.txt",
        "contentBase64": base64.b64encode(fixture).decode(), "mediaType": "text/plain", "kind": "other",
        "observedAt": "2026-10-11T12:00:00Z", "sourceUrl": ""})
    source = {"sourceIds": [attached["recordId"]], "sourceNote": "Internal fictional walkthrough only."}
    contributor = client.command("contributor", case_id, "contributor.save",
        {"name": "Fictional delivery contributor", "kind": "PERSON", "contact": "", **source})
    work = client.command("work", case_id, "work.save", {
        "contributorId": contributor["recordId"], "costId": cost_id, "description": "Fictional completed deployment implementation",
        "startDate": "2026-10-11", "endDate": "2026-10-11", "hours": "5", "fundingBasis": "PREAWARD", **source})
    client.command("work-submit", case_id, "work.submit", {"id": work["recordId"]})
    client.command("work-accept", case_id, "work.accept", {"id": work["recordId"]})
    invoice = client.command("invoice", case_id, "invoice.save", {
        "contributorId": contributor["recordId"], "number": "WALKTHROUGH-001", "issuedDate": "2026-10-11",
        "dueDate": "2026-10-25", "lines": [
            {"id": "implementation", "costId": cost_id, "description": "Fictional implementation", "amountUsd": "400.00", "workIds": [work["recordId"]]},
            {"id": "expense", "costId": None, "description": "Fictional unplanned expense", "amountUsd": "200.00", "workIds": []}], **source})
    client.command("invoice-review", case_id, "invoice.review", {"id": invoice["recordId"]})
    client.command("invoice-dispute", case_id, "invoice.dispute", {"id": invoice["recordId"]}, "Fictional clarification requested for the expense")
    client.command("invoice-reopen", case_id, "invoice.reopen", {"id": invoice["recordId"]})
    client.command("invoice-resolve", case_id, "invoice.review", {"id": invoice["recordId"]}, "Fictional clarification retained")
    award = client.command("award", case_id, "award.save", {"stage": "AWARDED", "reference": "FICTIONAL-AGREEMENT",
        "date": "2026-10-11", "amountUsd": "38000.00", **source})
    client.command("receipt", case_id, "cash.record", {"direction": "IN", "category": "GRANT",
        "date": "2026-10-11", "currency": "USD", "amount": "1000.00", "externalRef": "FICTIONAL-GRANT-RECEIPT",
        "tranche": 1, **source})
    for key, amount in (("partial-payment", "150.00"), ("second-payment", "250.00")):
        client.command(key, case_id, "cash.record", {"direction": "OUT", "category": "INVOICE",
            "date": "2026-10-12", "currency": "USD", "amount": amount, "externalRef": "FICTIONAL-" + key,
            "allocations": [{"invoiceId": invoice["recordId"], "amountUsd": amount}], **source})
    deployment = client.command("deployment", case_id, "deployment.save", {
        "name": "Fictional merchant and buyer installation", "operator": "Fictional internal operator",
        "operatorId": "walkthrough-team", "role": "BOTH", "participantClass": "TEAM_OPERATED",
        "environment": "TESTNET", "state": "OPERATING", "costIds": [cost_id], "tranche": 1,
        "endpoint": "", "releaseRef": "fictional-release-1", **source})
    purchase_data = {"deploymentId": deployment["recordId"], "network": "stellar:testnet", "asset": "native:XLM",
        "transactionHash": sha(b"fictional-walkthrough-transaction"), "ledger": 1, "amountStroops": "50000",
        "intentId": "fictional-intent-1", "operationId": "fictional-operation-1", "requestId": "fictional-request-1",
        "attemptStatus": "ATTEMPTED", "settlementStatus": "SETTLED", "outputStatus": "PARTIAL", "orderStatus": "PENDING",
        "origin": "OPERATOR_ENTRY", "observedAt": "2026-10-11T12:01:00Z", "firstAttemptAt": "2026-10-11T12:00:00Z",
        "settledAt": "2026-10-11T12:00:30Z", **source}
    purchase = client.command("purchase", case_id, "purchase.record", purchase_data)
    client.command("purchase-recovery", case_id, "purchase.observe", {
        **purchase_data, "id": purchase["recordId"], "outputStatus": "COMPLETE", "orderStatus": "FULFILLED",
        "observedAt": "2026-10-11T12:02:00Z", "outputCompletedAt": "2026-10-11T12:02:00Z",
        "deliveredBytes": 16, "deliveredSha256": sha(b"fictional-output"), "origin": "RECOVERED"},
        "Fictional recovery of the same already-settled transaction")
    cancelled = client.command("cancelled-attempt", case_id, "purchase.record", {
        "deploymentId": deployment["recordId"], "network": "stellar:testnet", "asset": "native:XLM",
        "intentId": "fictional-intent-2", "amountStroops": "0", "attemptStatus": "ATTEMPTED",
        "settlementStatus": "FAILED", "outputStatus": "UNKNOWN", "orderStatus": "PENDING",
        "observedAt": "2026-10-11T12:03:00Z", "firstAttemptAt": "2026-10-11T12:03:00Z", **source})
    def cancel_observation():
        row = next(row for row in client.read("/api/operations/" + case_id)["records"]["purchases"] if row["id"] == cancelled["recordId"])
        return {**row, "attemptStatus": "CANCELLED", "orderStatus": "CANCELLED", "observedAt": "2026-10-11T12:04:00Z"}
    client.command("cancel-after-attempt", case_id, "purchase.observe", cancel_observation,
                   "Fictional cancellation retains the original attempted denominator")
    client.command("handover", case_id, "deployment.save", lambda: {
        **next(row for row in client.read("/api/operations/" + case_id)["records"]["deployments"] if row["id"] == deployment["recordId"]),
        "state": "HANDED_OVER", "acceptedBy": "Fictional receiving operator", "acceptedAt": "2026-10-12"})
    client.command("outcome", case_id, "outcome.save", {"tranche": 1, "state": "SUBMITTED",
        "description": "Fictional deployment outcome submitted for internal review",
        "deploymentIds": [deployment["recordId"]], "date": "2026-10-12", **source})

    def next_plan():
        current = client.read("/api/plans/" + plan_id)
        planning = deepcopy(current["planning"]); planning["notes"] = str(planning.get("notes", "")) + "\nInternal walkthrough successor"
        return {"expectedRevision": current["currentRevision"], "scenarioPatch": {}, "planning": planning,
                "note": "Internal walkthrough: successor forecast does not rewrite selected operations", "requestId": client.prefix + "-advance-plan"}
    client.step("advance-plan", "/api/plans/" + plan_id + "/save", next_plan)
    pinned = client.read("/api/operations/" + case_id)
    assert pinned["plan"]["revision"] == revision and pinned["plan"]["contentSha256"] == copied["contentSha256"]
    assert pinned["program"]["currentPlanRevision"] > revision
    report = pinned["report"]
    assert report["cash"]["grantReceiptsUsd"] == "1000.00" and report["cash"]["openInvoiceUsd"] == "200.00"
    assert report["cash"]["netUsd"] == "600.00" and report["delivery"]["attemptedKnownIntents"] == 2
    assert report["delivery"]["completedKnownIntents"] == 1 and report["delivery"]["completionRate"] == "0.5000"

    first_review = client.command("review-before-change", case_id, "review", {}, "Fictional completed review")
    client.command("after-review-change", case_id, "contributor.save", lambda: {
        **next(row for row in client.read("/api/operations/" + case_id)["records"]["contributors"] if row["id"] == contributor["recordId"]),
        "name": "Fictional delivery contributor — clarified"})
    client.rejected("stale-review-close", case_id, "close", {"reviewId": first_review["recordId"], "expectedReviewSha256": first_review["businessSha256"]})
    final_review = client.command("final-review", case_id, "review", {}, "Fictional updated close review")
    client.command("close", case_id, "close", {"reviewId": final_review["recordId"], "expectedReviewSha256": final_review["businessSha256"]})
    client.rejected("closed-write", case_id, "work.save", {})
    raw = client.bundle(case_id)
    if "plansBeforeReceive" not in client.state:
        client.state["plansBeforeReceive"] = len(client.read("/api/plans")["plans"]); client.save()
    plans_before = client.state["plansBeforeReceive"]
    received = client.step("receive-bundle", "/api/operations/import?name=" + quote("Reopened internal walkthrough"), lambda: raw,
        headers={"Content-Type": "application/zip", "X-Request-ID": client.prefix + "-receive-bundle", "X-Recorded-By": "Internal walkthrough operator"})
    restored = client.read("/api/operations/" + received["id"])
    expected_state = "OPEN" if "result" in client.state["steps"].get("reopen-received", {}) else "CLOSED"
    assert restored["program"]["state"] == expected_state and restored["plan"]["revision"] == revision
    assert len(client.read("/api/plans")["plans"]) == plans_before + 1
    client.step("changed-import-refusal", "/api/operations/import?name=Changed%20walkthrough", lambda: raw, expected=409,
        headers={"Content-Type": "application/zip", "X-Request-ID": client.prefix + "-receive-bundle", "X-Recorded-By": "Internal walkthrough operator"})
    client.step("invalid-import-refusal", "/api/operations/import?name=Invalid%20request", lambda: raw, expected=422,
        headers={"Content-Type": "application/zip", "X-Request-ID": "invalid request identity", "X-Recorded-By": "Internal walkthrough operator"})
    client.step("duplicate-review-refusal", "/api/operations/import?name=Duplicate%20review", lambda: duplicated_review_bundle(raw), expected=422,
        headers={"Content-Type": "application/zip", "X-Request-ID": client.prefix + "-duplicate-review", "X-Recorded-By": "Internal walkthrough operator"})
    assert len(client.read("/api/plans")["plans"]) == plans_before + 1
    retained = client.read("/api/operations/" + case_id)
    for kind, rows in retained["records"].items():
        assert restored["records"][kind] == rows
    for metadata in retained["sources"]:
        assert client.read("/api/operations/" + received["id"] + "/sources/" + metadata["id"]) == fixture
    client.command("reopen-original", case_id, "reopen", {}, "Reopened fictional review for continuing delivery")
    client.command("reopen-received", received["id"], "reopen", {}, "Received fictional case resumes under the original lifecycle")
    original_step = client.state["steps"]["work"]["body"]
    before_version = client.read("/api/operations/" + case_id)["program"]["version"]
    status, replay = client.request("/api/operations/" + case_id + "/command", original_step)
    assert status == 200 and replay == client.state["steps"]["work"]["result"]
    assert client.read("/api/operations/" + case_id)["program"]["version"] == before_version
    result = {"schema": "sf47.operations-walkthrough-result.v1", "status": "PASS",
              "walkthroughCase": case_id, "receivedCase": received["id"], "originalSourceCase": actual_case["id"] if actual_case else None,
              "fictionalCashUsd": {"received": "1000.00", "paid": "400.00", "openInvoices": "200.00", "net": "600.00"},
              "fictionalIntentResult": {"attempted": 2, "complete": 1, "rate": "0.5000"},
              "originalSourceSemantics": "Pre-award interest acknowledgement; seven team-operated testnet purchases; no grant or customer cash" if actual_case else "No original source packet supplied",
              "archive": client.state["archive"], "completedSteps": len(client.state["steps"]),
              "originalPlan": selected}
    atomic(client.output / "operations-walkthrough-result.json", encoded(result))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Already-running original server origin")
    parser.add_argument("--access-key-file", required=True, help="Original private access.key; never printed")
    parser.add_argument("--plan", required=True, help="Original retained planning case")
    parser.add_argument("--output", required=True, help="Private checkpoint/export directory; reuse to resume")
    parser.add_argument("--source-intake", help="Optional private original source packet")
    args = parser.parse_args()
    print(json.dumps(run(Receiving(args.url, args.access_key_file, args.output, args.plan), args.source_intake), indent=2))


if __name__ == "__main__":
    main()
