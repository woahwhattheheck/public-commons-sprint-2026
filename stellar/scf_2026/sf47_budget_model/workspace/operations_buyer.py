"""Original SF88 Inbox source receiving inside the existing SF47 Operations transaction."""
from __future__ import annotations

import base64
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import uuid

from model import Problem, canonical, digest, now, text
import operations_domain as domain

SCHEMA = "scf.operations.buyer-receiving.v1"
MAX_HANDOFF = 8 * 1024 * 1024
MAX_READER_OUTPUT = 16 * 1024 * 1024
HELPER = Path(__file__).resolve().with_name("buyer_handoff.mjs")
_READER = threading.BoundedSemaphore(1)
ANCHORS = ("network", "asset", "transactionHash", "intentId", "operationId", "requestId",
           "reservationId", "recipient", "acceptedTermsSha256", "firstAttemptAt", "merchantEventId")
OPTIONAL_FACTS = ("transactionHash", "ledger", "feesStroops", "deliveredBytes", "deliveredSha256",
                  "operationId", "requestId", "reservationId", "merchantEventId", "recipient",
                  "acceptedTermsSha256", "firstAttemptAt", "settledAt", "outputCompletedAt")


def fields(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise Problem("Use the declared " + label + ".", 422, "BUYER_INPUT_INVALID")
    return value


def handoff_bytes(value):
    if not isinstance(value, str) or len(value) > ((MAX_HANDOFF + 2) // 3) * 4:
        raise Problem("Select an original buyer handoff up to 8 MiB.", 413, "BUYER_HANDOFF_SIZE")
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise Problem("The original buyer source encoding is invalid.", 422, "BUYER_HANDOFF_INVALID") from exc
    if not raw or len(raw) > MAX_HANDOFF or base64.b64encode(raw).decode("ascii") != value:
        raise Problem("Select an original buyer handoff up to 8 MiB.", 413, "BUYER_HANDOFF_SIZE")
    return raw


def filename(value):
    value = text(value, "Original buyer filename", 240, True)
    if value in (".", "..") or "/" in value or "\\" in value or any(ord(c) < 32 for c in value):
        raise Problem("Use a plain original buyer filename.", 422, "BUYER_INPUT_INVALID")
    return value


def inspect(raw):
    selected = os.environ.get("SF47_BUYER_NODE") or shutil.which("node")
    if not selected or not Path(selected).is_absolute() or not Path(selected).is_file():
        raise Problem("The installed grant workspace needs its Node executable to read the original buyer product.",
                      503, "BUYER_NODE_UNAVAILABLE")
    if not _READER.acquire(blocking=False):
        raise Problem("Another original buyer source review is running. Continue this review when it finishes.",
                      409, "BUYER_REVIEW_BUSY")
    try:
        try:
            process = subprocess.run([selected, "--max-old-space-size=192", str(HELPER)],
                input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
        except subprocess.TimeoutExpired as exc:
            raise Problem("The original buyer reader timed out. Retain this same source selection.",
                          503, "BUYER_READER_TIMEOUT") from exc
        except OSError as exc:
            raise Problem("The installed original buyer reader could not start.",
                          503, "BUYER_READER_UNAVAILABLE") from exc
        if len(process.stdout) > MAX_READER_OUTPUT:
            raise Problem("Select fewer original buyer jobs for this source handoff.", 413, "BUYER_REVIEW_SIZE")
        try:
            result = json.loads(process.stdout)
        except (UnicodeError, ValueError) as exc:
            raise Problem("The original buyer reader did not return a complete result.",
                          503, "BUYER_READER_INCOMPLETE") from exc
        if process.returncode or not isinstance(result, dict) or result.get("error"):
            code = result.get("error", {}).get("code") if isinstance(result, dict) else None
            code = code if isinstance(code, str) and re.fullmatch(r"[A-Z0-9_]{1,120}", code) else "BUYER_SOURCE_REJECTED"
            raise Problem("The original buyer source needs review: " + code + ".", 422, code)
        report = result.get("report")
        if (result.get("schema") != "scf.operations.buyer-reader.v1" or not isinstance(report, dict)
                or report.get("schema") != "stellar-forge.sf88.operations-handoff.v1"
                or report.get("source", {}).get("sha256") != hashlib.sha256(raw).hexdigest()
                or report.get("source", {}).get("bytes") != len(raw)
                or not isinstance(report.get("rows"), list) or not 1 <= len(report["rows"]) <= 100
                or not isinstance(result.get("html"), str)):
            raise Problem("The selected source differs from the original buyer reader result.",
                          503, "BUYER_READER_CHANGED")
        return result
    finally:
        _READER.release()


def _matches(context, row):
    purchase = row["purchase"]
    return [value for value in context["records"]["purchases"] if value["state"] != "VOID" and
        ((value.get("intentId") and value["intentId"] == purchase["intentId"])
         or (purchase.get("transactionHash") and value.get("network") == purchase["network"]
             and value.get("transactionHash") == purchase["transactionHash"]))]


def _conflicts(purchase, previous):
    if not previous:
        return []
    result = [key for key in ANCHORS if previous.get(key) not in (None, "") and
              purchase.get(key) not in (None, "") and previous[key] != purchase[key]]
    if int(previous.get("amountStroops", "0")) > 0 and int(purchase.get("amountStroops", "0")) > 0 \
            and previous["amountStroops"] != purchase["amountStroops"]:
        result.append("amountStroops")
    return result


def preview(context, body):
    fields(body, ("expectedVersion", "filename", "contentBase64"), "buyer preview")
    expected = domain.integer(body.get("expectedVersion"), "Reviewed operations version", 1, 10000000)
    if context["program"]["version"] != expected:
        raise Problem("The operations case changed. Refresh it before reviewing this buyer source.",
                      409, "OPERATIONS_CONFLICT")
    name = filename(body.get("filename"))
    native = inspect(handoff_bytes(body.get("contentBase64")))
    report = native["report"]
    rows = []
    for source in report["rows"]:
        matches = _matches(context, source)
        conflicts = _conflicts(source["purchase"], matches[0]) if len(matches) == 1 else []
        rows.append({**source, "matches": [{"id": row["id"], "deploymentId": row["deploymentId"],
                    "intentId": row.get("intentId", ""), "transactionHash": row.get("transactionHash"),
                    "version": row["version"], "observedAt": row["observedAt"]} for row in matches],
            "suggestedPurchaseId": matches[0]["id"] if len(matches) == 1 else None,
            "identityConflicts": conflicts,
            "receiving": "CONFLICT" if len(matches) > 1 or conflicts or not source["canReceive"]
                        else "OBSERVE_ORIGINAL" if matches else "NEW_ORIGINAL"})
    result = {"schema": SCHEMA, "caseId": context["program"]["id"], "version": expected,
        "source": {**report["source"], "filename": name}, "reader": report["reader"],
        "counts": report["counts"], "interpretation": report["interpretation"],
        "rows": rows, "html": native["html"],
        "deployments": [{key: value.get(key) for key in
            ("id", "name", "operator", "operatorId", "role", "participantClass", "environment", "state", "version")}
            for value in context["records"]["deployments"]],
        "purchases": [{key: value.get(key) for key in
            ("id", "deploymentId", "intentId", "transactionHash", "network", "settlementStatus", "outputStatus", "observedAt", "version")}
            for value in context["records"]["purchases"] if value["state"] != "VOID"],
        "retainedSourceIds": [row["id"] for row in context["sources"].values()
                              if row["sha256"] == report["source"]["sha256"]]}
    result["previewSha256"] = digest(result)
    return result


def _source(operations, context, raw, name, observed, media):
    identity = hashlib.sha256(raw).hexdigest()
    for value in context["sources"].values():
        if value["sha256"] == identity and value["bytes"] == len(raw):
            found = operations.db.execute("SELECT content FROM ops_sources WHERE program_id=? AND id=?",
                (context["program"]["id"], value["id"])).fetchone()
            if found is not None and bytes(found[0]) == raw:
                return value
    row = operations._source_add(context["program"]["id"], {"filename": name, "mediaType": media,
        "kind": "purchase", "sourceUrl": "", "observedAt": observed,
        "contentBase64": base64.b64encode(raw).decode("ascii")})
    context["sources"][row["id"]] = row
    return row


def _saved(operations, context, kind, value, previous, actor, version):
    normalized = domain.prepare(kind, value, context, previous)
    if previous and all(previous.get(key) == field for key, field in normalized.items()):
        return previous, False
    stamp = now()
    row = {**normalized, "id": previous["id"] if previous else domain.PREFIX[kind] + "-" + uuid.uuid4().hex,
           "version": version, "createdAt": previous["createdAt"] if previous else stamp,
           "updatedAt": stamp, "recordedBy": actor}
    operations._save(context["program"]["id"], kind, row)
    context["records"][kind] = [old for old in context["records"][kind] if old["id"] != row["id"]] + [row]
    return row, True


def receive(operations, context, data, actor, version):
    """One original command transaction, including all selected purchases and retained source."""
    fields(data, ("filename", "contentBase64", "expectedPreviewSha256", "deploymentId", "deployment", "selections"),
           "buyer receiving command")
    reviewed = preview(context, {"expectedVersion": context["program"]["version"],
        "filename": data.get("filename"), "contentBase64": data.get("contentBase64")})
    if reviewed["previewSha256"] != domain.sha(data.get("expectedPreviewSha256"), "Reviewed buyer preview", False):
        raise Problem("The buyer source or operations case changed. Review the retained selection again.",
                      409, "BUYER_PREVIEW_CONFLICT")
    selected = data.get("selections")
    if not isinstance(selected, list) or not 1 <= len(selected) <= len(reviewed["rows"]):
        raise Problem("Select one or more original buyer jobs to receive.", 422, "BUYER_SELECTION_REQUIRED")
    rows = {row["jobId"]: row for row in reviewed["rows"]}
    purchases = {row["id"]: row for row in context["records"]["purchases"]}
    staged, seen, old_ids = [], set(), set()
    for selection in selected:
        fields(selection, ("jobId", "purchaseId"), "original purchase selection")
        job_id = selection.get("jobId")
        if job_id not in rows or job_id in seen:
            raise Problem("Select each original source job at most once.", 422, "BUYER_SELECTION_INVALID")
        seen.add(job_id)
        row = rows[job_id]
        if row["receiving"] == "CONFLICT":
            raise Problem("Resolve the displayed original source or purchase identity conflict first.",
                          409, "BUYER_PURCHASE_IDENTITY_CONFLICT")
        purchase_id = selection.get("purchaseId")
        previous = purchases.get(purchase_id) if purchase_id else None
        if purchase_id and (previous is None or previous["state"] == "VOID"):
            raise Problem("Select an active original purchase from this case.", 404, "BUYER_PURCHASE_NOT_FOUND")
        if row["matches"] and (len(row["matches"]) != 1 or purchase_id != row["matches"][0]["id"]):
            raise Problem("This intent or transaction already exists. Select its original purchase.",
                          409, "BUYER_ORIGINAL_PURCHASE_REQUIRED")
        if purchase_id in old_ids or _conflicts(row["purchase"], previous):
            raise Problem("Each selected job must preserve its own original purchase identity.",
                          409, "BUYER_PURCHASE_IDENTITY_CONFLICT")
        if purchase_id:
            old_ids.add(purchase_id)
        staged.append((row, previous))

    deployment_id = data.get("deploymentId")
    previous_deployment = None
    if deployment_id:
        if data.get("deployment") not in (None, {}):
            raise Problem("Choose an existing deployment or provide a new deployment.", 422, "BUYER_INPUT_INVALID")
        previous_deployment = next((row for row in context["records"]["deployments"] if row["id"] == deployment_id), None)
        if previous_deployment is None:
            raise Problem("Select the original buyer deployment.", 404, "BUYER_DEPLOYMENT_NOT_FOUND")
        deployment = deepcopy(previous_deployment)
    else:
        deployment = deepcopy(fields(data.get("deployment"), (
            "name", "operator", "operatorId", "role", "participantClass", "environment", "state",
            "costIds", "tranche", "endpoint", "releaseRef", "caseRef", "acceptedBy", "acceptedAt", "sourceNote"),
            "new buyer deployment"))
        deployment["sourceIds"] = []
    if deployment.get("role") not in ("BUYER", "BOTH"):
        raise Problem("Associate the Inbox with a buyer or combined merchant/buyer deployment.",
                      422, "BUYER_DEPLOYMENT_ROLE_REQUIRED")
    for row, previous in staged:
        if previous and previous["deploymentId"] != deployment_id:
            raise Problem("A later purchase observation retains its original deployment. Select that deployment.",
                          409, "BUYER_ORIGINAL_DEPLOYMENT_REQUIRED")
    domain.prepare("deployments", deployment, context, previous_deployment)
    new_count = int(previous_deployment is None) + sum(previous is None for _, previous in staged)
    count = operations.db.execute("SELECT COUNT(*) FROM ops_records WHERE program_id=?",
                                 (context["program"]["id"],)).fetchone()[0]
    if count + new_count > 5000:
        raise Problem("This operations case has reached its retained-record bound.", 413, "BUYER_RECORD_LIMIT")

    raw = handoff_bytes(data["contentBase64"])
    report_raw = reviewed["html"].encode("utf-8")
    if not report_raw or len(report_raw) > MAX_HANDOFF:
        raise Problem("Select fewer original buyer jobs for this report.", 413, "BUYER_REVIEW_SIZE")
    prefix = "buyer-" + reviewed["source"]["sha256"][:20]
    original = _source(operations, context, raw, prefix + "--" + reviewed["source"]["filename"][:170],
                       reviewed["source"]["capturedAt"], "application/json")
    report = _source(operations, context, report_raw, prefix + ".native.html",
                     reviewed["source"]["capturedAt"], "text/html")
    source_ids = [original["id"], report["id"]]
    deployment["sourceIds"] = list(dict.fromkeys([*deployment.get("sourceIds", []), *source_ids]))
    saved_deployment, deployment_changed = _saved(operations, context, "deployments", deployment,
                                                 previous_deployment, actor, version)
    changes, links = [], []
    for row, previous in staged:
        candidate = {**deepcopy(previous or {}), **row["purchase"], "deploymentId": saved_deployment["id"]}
        # A later retained source may omit earlier known facts. It does not erase them.
        if previous:
            for key in OPTIONAL_FACTS:
                if candidate.get(key) in (None, "") and previous.get(key) not in (None, ""):
                    candidate[key] = previous[key]
            if candidate["amountStroops"] == "0" and int(previous["amountStroops"]) > 0:
                candidate["amountStroops"] = previous["amountStroops"]
            # Viewing the same received source never manufactures a later observation.
            association = original.get("buyerHandoff", {})
            old_link = next((value for value in association.get("rows", [])
                             if value.get("jobId") == row["jobId"] and value.get("purchaseId") == previous["id"]
                             and value.get("sourceRecordSha256") == row["sourceRecordSha256"]), None)
            if old_link:
                candidate["observedAt"] = previous["observedAt"]
        candidate["sourceIds"] = list(dict.fromkeys([*(previous or {}).get("sourceIds", []), *source_ids]))
        note = "Original SF88 intent " + row["intentId"] + "; retained source " + reviewed["source"]["sha256"] + "."
        if row["issues"]:
            note += " Review items: " + "; ".join(row["issues"]) + "."
        old_note = (previous or {}).get("sourceNote", "")
        candidate["sourceNote"] = old_note if note in old_note else (old_note + "\n" + note).strip()
        saved, changed = _saved(operations, context, "purchases", candidate, previous, actor, version)
        changes.append({"jobId": row["jobId"], "before": previous, "after": saved, "changed": changed})
        links.append({"jobId": row["jobId"], "intentId": row["intentId"], "configSha256": row["configSha256"],
            "sourceRecordSha256": row["sourceRecordSha256"], "purchaseId": saved["id"], "deploymentId": saved_deployment["id"]})

    before_source = deepcopy(original)
    association = original.get("buyerHandoff")
    association = deepcopy(association) if isinstance(association, dict) and association.get("sourceSha256") == original["sha256"] else {}
    received = {value["jobId"]: value for value in association.get("rows", [])}
    for link in links:
        prior = received.get(link["jobId"])
        if prior and prior != link:
            raise Problem("This exact source job is already linked to its original purchase.",
                          409, "BUYER_RETAINED_SOURCE_LINK_CONFLICT")
        received[link["jobId"]] = link
    reports = list(association.get("reports", []))
    report_link = {"sourceId": report["id"], "sha256": report["sha256"]}
    if report_link not in reports:
        reports.append(report_link)
    association.update({"schema": SCHEMA, "sourceSha256": original["sha256"],
        "originalFilename": association.get("originalFilename") or reviewed["source"]["filename"],
        "inboxSha256": reviewed["source"]["inboxSha256"], "capturedAt": reviewed["source"]["capturedAt"],
        "totalSourceJobs": len(rows), "rows": sorted(received.values(), key=lambda row: row["jobId"]),
        "reports": reports, "reader": reviewed["reader"]})
    source_changed = association != original.get("buyerHandoff")
    if source_changed:
        original = {**original, "buyerHandoff": association}
        operations.db.execute("UPDATE ops_sources SET metadata_json=? WHERE program_id=? AND id=?",
            (canonical(original), context["program"]["id"], original["id"]))
        context["sources"][original["id"]] = original
    changed = deployment_changed or source_changed or any(value["changed"] for value in changes)
    return {"unchanged": not changed, "before": {"deployment": previous_deployment,
                "purchases": [value["before"] for value in changes]},
        "after": {"deployment": saved_deployment, "purchases": [value["after"] for value in changes],
            "sourceSha256": reviewed["source"]["sha256"], "selectedJobIds": sorted(seen),
            "unselectedJobIds": sorted(set(rows) - seen)},
        "kind": "buyerReceiving", "recordId": saved_deployment["id"],
        "sourceIds": source_ids, "sourceSha256": reviewed["source"]["sha256"],
        "purchaseIds": [value["after"]["id"] for value in changes], "selectedJobIds": sorted(seen),
        "totalSourceJobs": len(rows), "unselectedJobIds": sorted(set(rows) - seen),
        "sourceChange": {"before": before_source, "after": original} if source_changed else None}
