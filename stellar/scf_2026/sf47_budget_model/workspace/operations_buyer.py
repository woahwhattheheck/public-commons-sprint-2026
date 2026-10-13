"""Original SF88 Inbox/Node source receiving in the existing SF47 Operations transaction."""
from __future__ import annotations

import base64
from copy import deepcopy
from datetime import datetime
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
NODE_SCHEMA = "stellar-forge.node-operation-accounting-export.v1"
CUSTOMER_USE_SCHEMA = "stellar-forge.sf88.customer-use-return.v1"
MAX_CUSTOMER_USE_HANDOFF = 16 * 1024 * 1024
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
    if not isinstance(value, str) or len(value) > ((MAX_CUSTOMER_USE_HANDOFF + 2) // 3) * 4:
        raise Problem("Select an original buyer handoff up to 8 MiB, or a customer-use return up to 16 MiB.", 413, "BUYER_HANDOFF_SIZE")
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise Problem("The original buyer source encoding is invalid.", 422, "BUYER_HANDOFF_INVALID") from exc
    if not raw or len(raw) > MAX_CUSTOMER_USE_HANDOFF or base64.b64encode(raw).decode("ascii") != value:
        raise Problem("Select an original buyer handoff up to 8 MiB, or a customer-use return up to 16 MiB.", 413, "BUYER_HANDOFF_SIZE")
    return raw


def filename(value):
    value = text(value, "Original buyer filename", 240, True)
    if value in (".", "..") or "/" in value or "\\" in value or any(ord(c) < 32 for c in value):
        raise Problem("Use a plain original buyer filename.", 422, "BUYER_INPUT_INVALID")
    return value


def inspect(raw):
    try:
        decoded_source = json.loads(raw)
        wrapper = isinstance(decoded_source, dict) and decoded_source.get("schema") == CUSTOMER_USE_SCHEMA
        del decoded_source
    except (UnicodeError, ValueError, TypeError):
        wrapper = False
    if not raw or len(raw) > (MAX_CUSTOMER_USE_HANDOFF if wrapper else MAX_HANDOFF):
        raise Problem("The selected original buyer source exceeds its own carrier bound.", 413, "BUYER_HANDOFF_SIZE")
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
        if len(process.stdout) > (2 * MAX_READER_OUTPUT if wrapper else MAX_READER_OUTPUT):
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
                or report.get("schema") not in ("stellar-forge.sf88.operations-handoff.v1", NODE_SCHEMA, CUSTOMER_USE_SCHEMA)
                or (report.get("schema") == CUSTOMER_USE_SCHEMA) != wrapper
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
    if purchase is None:
        return []
    return [value for value in context["records"]["purchases"] if value["state"] != "VOID" and
        ((value.get("intentId") and value["intentId"] == purchase["intentId"])
         or (purchase.get("transactionHash") and value.get("network") == purchase["network"]
             and value.get("transactionHash") == purchase["transactionHash"]))]


def _conflicts(purchase, previous):
    if purchase is None or not previous:
        return []
    result = [key for key in ANCHORS if previous.get(key) not in (None, "") and
              purchase.get(key) not in (None, "") and previous[key] != purchase[key]]
    if int(previous.get("amountStroops", "0")) > 0 and int(purchase.get("amountStroops", "0")) > 0 \
            and previous["amountStroops"] != purchase["amountStroops"]:
        result.append("amountStroops")
    return result



def _historical_node(row, previous):
    if row.get("sourceKind") != "NODE_ACCOUNTING" or row["purchase"] is None or previous is None:
        return False
    observed = domain.timestamp(row["purchase"]["observedAt"], "Original Node accounting observation")
    current = domain.timestamp(previous["observedAt"], "Retained purchase observation")
    return datetime.fromisoformat(observed.replace("Z", "+00:00")) < datetime.fromisoformat(current.replace("Z", "+00:00"))


def _node_links(context, row):
    """Locate the original Node operation without introducing a financial row."""
    if row.get("sourceKind") != "NODE_ACCOUNTING":
        return []
    identity = row["node"]["sourceIdentitySha256"]
    links = []
    for source in context["sources"].values():
        association = source.get("buyerHandoff")
        if not isinstance(association, dict) or association.get("sourceSchema") != NODE_SCHEMA:
            continue
        for link in association.get("rows", []):
            node = link.get("node")
            if isinstance(node, dict) and node.get("sourceIdentitySha256") == identity:
                links.append({"sourceId": source["id"], "sourceSha256": source["sha256"],
                    **deepcopy(link)})
    return sorted(links, key=lambda link: (link["sourceId"], link["jobId"]))


def node_observations(context):
    """Return all immutable source editions, grouped by original operation identity.

    These are source/deployment observations. No value from this view enters the
    purchase, approved-intent, cash, grant-receipt or external-customer totals.
    """
    groups = {}
    for source in context["sources"].values():
        association = source.get("buyerHandoff")
        if not isinstance(association, dict) or association.get("sourceSchema") != NODE_SCHEMA:
            continue
        for link in association.get("rows", []):
            node = link.get("node")
            if not isinstance(node, dict):
                continue
            identity = node["sourceIdentitySha256"]
            group = groups.setdefault(identity, {"sourceIdentitySha256": identity,
                "intentId": link["intentId"], "sourceIdentity": deepcopy(node["sourceIdentity"]),
                "deploymentIds": [], "purchaseIds": [], "editions": []})
            if link["deploymentId"] not in group["deploymentIds"]:
                group["deploymentIds"].append(link["deploymentId"])
            if link.get("purchaseId") and link["purchaseId"] not in group["purchaseIds"]:
                group["purchaseIds"].append(link["purchaseId"])
            group["editions"].append({"sourceId": source["id"], "sourceSha256": source["sha256"],
                "bytes": source["bytes"], "filename": association["originalFilename"],
                "jobId": link["jobId"], "deploymentId": link["deploymentId"],
                "purchaseId": link.get("purchaseId"), "disposition": link["disposition"],
                "node": deepcopy(node), "outcome": deepcopy(link["outcome"]),
                "output": deepcopy(link["output"]), "purchase": deepcopy(link["purchase"]),
                "finality": deepcopy(link["finality"]), "reports": deepcopy(association["reports"])})
    for group in groups.values():
        group["deploymentIds"].sort()
        group["purchaseIds"].sort()
        group["editions"].sort(key=lambda item: (item["sourceId"], item["jobId"]))
    return sorted(groups.values(), key=lambda item: item["sourceIdentitySha256"])



def _customer_use_context(context, report, loader):
    """Bind every original use to an immutable edition held by this exact case."""
    if report.get("schema") != CUSTOMER_USE_SCHEMA:
        return None
    try:
        selected, buyer_source = report["customerUse"], report["buyerSource"]
        if (not isinstance(selected, dict) or not isinstance(buyer_source, dict)
                or buyer_source.get("schema") != "stellar-forge.sf88.operations-handoff.v1"):
            raise ValueError("Original inner Inbox source is missing")
        rows = {row["jobId"]: row for row in report["rows"]}
        if len(rows) != len(report["rows"]):
            raise ValueError("Repeated native job")
        source_case = text(selected["source"]["caseId"], "Original Calendar case", 100, True)
        binding_ids, jobs, editions = set(), {}, {}
        bindings = selected["bindings"]
        if not isinstance(bindings, list) or not bindings:
            raise ValueError("No original use bindings")
        for binding in bindings:
            if binding["id"] in binding_ids:
                raise ValueError("Repeated original binding")
            binding_ids.add(binding["id"])
            ref = binding["entry"]
            key = (ref["installationId"], ref["revision"])
            if key not in editions:
                editions[key] = loader(*key)
            edition = editions[key]
            if (edition["id"] != key[0] or edition["revision"] != key[1]
                    or edition["sha256"] != ref["installationSha256"]
                    or digest({name: value for name, value in edition.items() if name != "sha256"}) != edition["sha256"]):
                raise ValueError("Historical Installation identity differs")
            calendar = edition["preview"]["document"]["useCalendar"]
            entries = [entry for entry in calendar["entries"] if entry["id"] == ref["entryId"]]
            if len(entries) != 1 or canonical(entries[0]) != canonical(binding["use"]):
                raise ValueError("The complete historical Calendar entry differs")
            buyer_id = entries[0]["buyerDeploymentId"]
            if not isinstance(buyer_id, str) or not buyer_id:
                raise ValueError("Original use buyer is missing")
            if binding["kind"] not in ("PERIOD_REQUESTS", "RETAINED_RESPONSES"):
                raise ValueError("Unknown original binding kind")
            requests = binding["requests"]
            if not isinstance(requests, list) or not requests:
                raise ValueError("No original native requests")
            for request in requests:
                native = rows.get(request["jobId"])
                if (native is None or native["intentId"] != request["intentId"]
                        or native["configSha256"] != request["configSha256"]
                        or native["sourceConfigSha256"] != request["sourceConfigSha256"]):
                    raise ValueError("A Calendar binding differs from its original Inbox job")
                previous = jobs.get(request["jobId"])
                if previous is not None and previous != buyer_id:
                    raise ValueError("One native job cannot change its original buyer")
                jobs[request["jobId"]] = buyer_id
        if set(jobs) != set(rows):
            raise ValueError("The return includes unrelated native jobs")
        original_ids = {edition["preview"]["source"]["caseId"] for edition in editions.values()}
        origin = context["program"].get("origin", {})
        if isinstance(origin, dict) and origin.get("programId"):
            original_ids.add(origin["programId"])
        state = ("CURRENT_CASE" if source_case == context["program"]["id"]
                 else "RETAINED_CASE_LINEAGE" if source_case in original_ids
                 else "HISTORICAL_INSTALLATIONS")
        # Exact scoped immutable editions retain custody across new case IDs.
        return {"caseBinding": state, "sourceCaseId": source_case,
                "receivingCaseId": context["program"]["id"], "deployments": jobs}
    except Problem:
        raise
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise Problem("The customer-use return differs from its complete retained Installation and Inbox bindings.",
                      422, "BUYER_CUSTOMER_USE_BINDING") from exc


def _customer_use_live(context, report, operations):
    if report.get("schema") != CUSTOMER_USE_SCHEMA:
        return None
    if operations is None:
        raise Problem("Use the original Operations host to review these retained Installations.",
                      503, "BUYER_CUSTOMER_USE_HOST_REQUIRED")
    import operations_installations as installations
    return _customer_use_context(context, report, lambda ident, revision:
        installations.get(operations, context["program"]["id"], ident, revision))


def preview(context, body, *, operations=None):
    fields(body, ("expectedVersion", "filename", "contentBase64"), "buyer preview")
    expected = domain.integer(body.get("expectedVersion"), "Reviewed operations version", 1, 10000000)
    if context["program"]["version"] != expected:
        raise Problem("The operations case changed. Refresh it before reviewing this buyer source.",
                      409, "OPERATIONS_CONFLICT")
    name = filename(body.get("filename"))
    native = inspect(handoff_bytes(body.get("contentBase64")))
    report = native["report"]
    customer_use_binding = _customer_use_live(context, report, operations)
    rows = []
    for source in report["rows"]:
        matches = _matches(context, source)
        conflicts = _conflicts(source["purchase"], matches[0]) if len(matches) == 1 else []
        operation_links = _node_links(context, source)
        deployment_ids = sorted({link["deploymentId"] for link in operation_links})
        if len(deployment_ids) > 1:
            conflicts.append("NODE_ORIGINAL_DEPLOYMENT_DIVERGENCE")
        prior_purchases = {link["purchaseId"] for link in operation_links if link.get("purchaseId")}
        if source["purchase"] is not None and prior_purchases and (
                len(prior_purchases) != 1 or {match["id"] for match in matches} != prior_purchases):
            conflicts.append("NODE_ORIGINAL_PURCHASE_BINDING")
        if any(link["node"]["sourceIdentity"] != source["node"]["sourceIdentity"]
               for link in operation_links):
            conflicts.append("NODE_ORIGINAL_SOURCE_IDENTITY")
        disposition = ("OBSERVE_ORIGINAL_OPERATION" if operation_links else "NEW_ORIGINAL_OPERATION") \
            if source["purchase"] is None else "OBSERVE_ORIGINAL" if matches else "NEW_ORIGINAL"
        rows.append({**source, "matches": [{"id": row["id"], "deploymentId": row["deploymentId"],
                    "intentId": row.get("intentId", ""), "transactionHash": row.get("transactionHash"),
                    "version": row["version"], "observedAt": row["observedAt"]} for row in matches],
            "suggestedPurchaseId": matches[0]["id"] if len(matches) == 1 else None,
            "currentObservationPreserved": _historical_node(source, matches[0]) if len(matches) == 1 else False,
            "operationMatches": operation_links,
            "suggestedDeploymentId": deployment_ids[0] if len(deployment_ids) == 1 else None,
            "identityConflicts": conflicts,
            "receiving": "CONFLICT" if len(matches) > 1 or conflicts or not source["canReceive"]
                        else disposition})
    result = {"schema": SCHEMA, "caseId": context["program"]["id"], "version": expected,
        "source": {**report["source"], "filename": name, "schema": report["schema"]}, "reader": report["reader"],
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
    if customer_use_binding is not None:
        result.update({"customerUse": deepcopy(report["customerUse"]),
            "buyerSource": deepcopy(report["buyerSource"]), "customerUseBinding": customer_use_binding})
    result["previewSha256"] = digest(result)
    return result


def _source(operations, context, raw, name, observed, media, kind="purchase", *, maximum=MAX_HANDOFF):
    identity = hashlib.sha256(raw).hexdigest()
    for value in context["sources"].values():
        if value["sha256"] == identity and value["bytes"] == len(raw):
            found = operations.db.execute("SELECT content FROM ops_sources WHERE program_id=? AND id=?",
                (context["program"]["id"], value["id"])).fetchone()
            if found is not None and bytes(found[0]) == raw:
                return value
    row = operations._source_add(context["program"]["id"], {"filename": name, "mediaType": media,
        "kind": kind, "sourceUrl": "", "observedAt": observed,
        "contentBase64": base64.b64encode(raw).decode("ascii")}, _maximum=maximum)
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
    """One original command transaction for selected operations, purchases and source."""
    fields(data, ("filename", "contentBase64", "expectedPreviewSha256", "deploymentId", "deployment", "selections"),
           "buyer receiving command")
    reviewed = preview(context, {"expectedVersion": context["program"]["version"],
        "filename": data.get("filename"), "contentBase64": data.get("contentBase64")}, operations=operations)
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
        if row["purchase"] is None and purchase_id is not None:
            raise Problem("This original unpaid operation has no purchase. Retain null purchaseId.",
                          422, "BUYER_NODE_NO_PURCHASE")
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
        required_buyer = reviewed.get("customerUseBinding", {}).get("deployments", {}).get(row["jobId"])
        if required_buyer is not None and deployment_id != required_buyer:
            raise Problem("Receive this original Calendar use into its retained buyer deployment.",
                          409, "BUYER_CUSTOMER_USE_DEPLOYMENT")
        if any(link["deploymentId"] != deployment_id for link in row["operationMatches"]):
            raise Problem("This Node operation already belongs to its retained deployment. Select that deployment.",
                          409, "BUYER_ORIGINAL_DEPLOYMENT_REQUIRED")
        if previous and previous["deploymentId"] != deployment_id:
            raise Problem("A later purchase observation retains its original deployment. Select that deployment.",
                          409, "BUYER_ORIGINAL_DEPLOYMENT_REQUIRED")
    domain.prepare("deployments", deployment, context, previous_deployment)
    new_count = int(previous_deployment is None) + sum(previous is None and row["purchase"] is not None for row, previous in staged)
    count = operations.db.execute("SELECT COUNT(*) FROM ops_records WHERE program_id=?",
                                 (context["program"]["id"],)).fetchone()[0]
    if count + new_count > 5000:
        raise Problem("This operations case has reached its retained-record bound.", 413, "BUYER_RECORD_LIMIT")

    raw = handoff_bytes(data["contentBase64"])
    report_raw = reviewed["html"].encode("utf-8")
    if not report_raw or len(report_raw) > MAX_HANDOFF:
        raise Problem("Select fewer original buyer jobs for this report.", 413, "BUYER_REVIEW_SIZE")
    prefix = "buyer-" + reviewed["source"]["sha256"][:20]
    source_kind = "deployment" if reviewed["source"]["schema"] == NODE_SCHEMA else "purchase"
    original = _source(operations, context, raw, prefix + "--" + reviewed["source"]["filename"][:170],
                       reviewed["source"]["capturedAt"], "application/json", source_kind,
                       maximum=MAX_CUSTOMER_USE_HANDOFF if reviewed["source"]["schema"] == CUSTOMER_USE_SCHEMA else MAX_HANDOFF)
    report = _source(operations, context, report_raw, prefix + ".native.html",
                     reviewed["source"]["capturedAt"], "text/html", source_kind)
    source_ids = [original["id"], report["id"]]
    deployment["sourceIds"] = list(dict.fromkeys([*deployment.get("sourceIds", []), *source_ids]))
    saved_deployment, deployment_changed = _saved(operations, context, "deployments", deployment,
                                                 previous_deployment, actor, version)
    changes, links = [], []
    for row, previous in staged:
        if row["purchase"] is None:
            links.append({"jobId": row["jobId"], "intentId": row["intentId"],
                "configSha256": row["configSha256"], "sourceRecordSha256": row["sourceRecordSha256"],
                "purchaseId": None, "deploymentId": saved_deployment["id"],
                "sourceKind": "NODE_ACCOUNTING", "disposition": row["disposition"],
                "node": deepcopy(row["node"]), "outcome": deepcopy(row["outcome"]),
                "output": deepcopy(row["output"]), "purchase": None, "finality": deepcopy(row["finality"])})
            continue
        association = original.get("buyerHandoff", {})
        old_link = next((value for value in association.get("rows", [])
                         if previous and value.get("jobId") == row["jobId"]
                         and value.get("purchaseId") == previous["id"]
                         and value.get("deploymentId") == previous["deploymentId"]
                         and value.get("intentId") == row["intentId"]
                         and value.get("configSha256") == row["configSha256"]
                         and value.get("sourceRecordSha256") == row["sourceRecordSha256"]), None)
        if old_link:
            # This exact received association is historical evidence. A later
            # source may already have changed the current purchase observation.
            # Reopening it must preserve that current record, including its clock.
            saved, changed = deepcopy(previous), False
        else:
            historical = _historical_node(row, previous)
            # A first-time historical accounting carrier remains useful source
            # evidence. Keep the current purchase projection and its actual clock;
            # the new source edition separately retains all original timestamps.
            candidate = deepcopy(previous) if historical else {**deepcopy(previous or {}), **row["purchase"], "deploymentId": saved_deployment["id"]}
            # A later retained source may omit earlier known facts. It does not erase them.
            if previous:
                # The Inbox observes payment/output, not the merchant order lifecycle.
                candidate["orderStatus"] = previous["orderStatus"]
                if row.get("sourceKind") == "NODE_ACCOUNTING":
                    # Accounting carriers do not observe the response file. Their
                    # immutable source output remains NOT_EMBEDDED without
                    # replacing the original Inbox/file observation.
                    candidate["outputStatus"] = previous["outputStatus"]
                    if (candidate["settlementStatus"] == "UNKNOWN"
                            or (previous["settlementStatus"] == "SETTLED" and row["finality"] is None)):
                        candidate["settlementStatus"] = previous["settlementStatus"]
                    # An older or unsigned accounting record cannot undo an
                    # already established original signed attempt.
                    if previous["attemptStatus"] == "ATTEMPTED":
                        candidate["attemptStatus"] = previous["attemptStatus"]
                        candidate["paymentAttempted"] = previous["paymentAttempted"]
                for key in OPTIONAL_FACTS:
                    if candidate.get(key) in (None, "") and previous.get(key) not in (None, ""):
                        candidate[key] = previous[key]
                if candidate["amountStroops"] == "0" and int(previous["amountStroops"]) > 0:
                    candidate["amountStroops"] = previous["amountStroops"]
            candidate["sourceIds"] = list(dict.fromkeys([*(previous or {}).get("sourceIds", []), *source_ids]))
            note = "Original SF88 " + ("Node operation " if row.get("sourceKind") == "NODE_ACCOUNTING" else "intent ") + row["intentId"] + "; retained source " + reviewed["source"]["sha256"] + "."
            if row["issues"]:
                note += " Review items: " + "; ".join(row["issues"]) + "."
            old_note = (previous or {}).get("sourceNote", "")
            candidate["sourceNote"] = old_note if note in old_note else (old_note + "\n" + note).strip()
            saved, changed = _saved(operations, context, "purchases", candidate, previous, actor, version)
        changes.append({"jobId": row["jobId"], "before": previous, "after": saved, "changed": changed})
        links.append({"jobId": row["jobId"], "intentId": row["intentId"], "configSha256": row["configSha256"],
            "sourceRecordSha256": row["sourceRecordSha256"], "purchaseId": saved["id"], "deploymentId": saved_deployment["id"],
            **({"sourceKind": "NODE_ACCOUNTING", "disposition": row["disposition"],
                "node": deepcopy(row["node"]), "outcome": deepcopy(row["outcome"]),
                "output": deepcopy(row["output"]), "purchase": deepcopy(row["purchase"]),
                "finality": deepcopy(row["finality"])} if row.get("sourceKind") == "NODE_ACCOUNTING" else {})})

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
        **({"sourceSchema": NODE_SCHEMA, "sourceIdentitySha256": reviewed["source"]["sourceIdentitySha256"],
            "commandId": reviewed["source"]["commandId"], "contextSha256": reviewed["source"]["contextSha256"]}
           if reviewed["source"]["schema"] == NODE_SCHEMA
           else {"inboxSha256": reviewed["source"]["inboxSha256"]}),
        **({"sourceSchema": CUSTOMER_USE_SCHEMA, "customerUse": deepcopy(reviewed["customerUse"]),
            "buyerSource": deepcopy(reviewed["buyerSource"])}
           if reviewed["source"]["schema"] == CUSTOMER_USE_SCHEMA else {}),
        "capturedAt": reviewed["source"]["capturedAt"],
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
            "unselectedJobIds": sorted(set(rows) - seen),
            "operationalObservations": [deepcopy(link) for link in links if link.get("sourceKind") == "NODE_ACCOUNTING"]},
        "kind": "buyerReceiving", "recordId": saved_deployment["id"],
        "sourceIds": source_ids, "sourceSha256": reviewed["source"]["sha256"],
        "purchaseIds": [value["after"]["id"] for value in changes], "selectedJobIds": sorted(seen),
        "operationalObservationIds": sorted({link["node"]["sourceIdentitySha256"] for link in links if link.get("sourceKind") == "NODE_ACCOUNTING"}),
        "totalSourceJobs": len(rows), "unselectedJobIds": sorted(set(rows) - seen),
        "sourceChange": {"before": before_source, "after": original} if source_changed else None}


NODE_CSV_FIELDS = ("sourceIdentitySha256", "intentId", "sourceId", "sourceSha256", "filename",
    "commandId", "contextSha256", "deploymentId", "purchaseId", "disposition", "nativeOutcome",
    "recordAuthority", "httpStatus", "responseCapture", "responseBytesEmbedded", "network", "asset",
    "approvedAtomicAmount", "settlementStatus", "transactionHash", "finalizedAtomicAmount",
    "attemptCreatedAt", "sourceObservedAt", "accountingCompletedAt")


def node_csv_rows(context):
    rows = []
    for group in node_observations(context):
        for edition in group["editions"]:
            node, output = edition["node"], edition["output"]
            purchase, finality = edition.get("purchase") or {}, edition.get("finality") or {}
            rows.append({"sourceIdentitySha256": group["sourceIdentitySha256"],
                "intentId": group["intentId"], "sourceId": edition["sourceId"],
                "sourceSha256": edition["sourceSha256"], "filename": edition["filename"],
                "commandId": node["commandId"], "contextSha256": node["contextSha256"],
                "deploymentId": edition["deploymentId"], "purchaseId": edition.get("purchaseId"),
                "disposition": edition["disposition"], "nativeOutcome": node["outcome"],
                "recordAuthority": node["recordAuthority"], "httpStatus": output["httpStatus"],
                "responseCapture": output["captureStatus"], "responseBytesEmbedded": False,
                "network": purchase.get("network"), "asset": purchase.get("asset"),
                "approvedAtomicAmount": purchase.get("amountStroops"),
                "settlementStatus": purchase.get("settlementStatus"),
                "transactionHash": purchase.get("transactionHash"),
                "finalizedAtomicAmount": finality.get("amountAtomic"),
                "attemptCreatedAt": node["attemptCreatedAt"], "sourceObservedAt": node["sourceObservedAt"],
                "accountingCompletedAt": node["accountingCompletedAt"]})
    return rows


def validate_node_import(context, events, reviews, files):
    """Bind restored Node links and source history to the unchanged native reader.

    Existing Inbox source editions retain their original receiving contract.
    Every Node edition is independently re-read from its exact retained bytes;
    current record clocks and frozen historical review values are not rewritten.
    """
    inspected = {}
    sources = context["sources"]
    has_node = False

    def rejected(message):
        raise Problem(message, 422, "BUYER_NODE_RECEIVING_SOURCE")

    def validate(source, snapshot):
        nonlocal has_node
        association = source.get("buyerHandoff")
        if not isinstance(association, dict):
            return
        possible = (association.get("sourceSchema") == NODE_SCHEMA
            or association.get("reader", {}).get("product") == "ORIGINAL_SF88_NODE_ACCOUNTING"
            or any(isinstance(link, dict) and link.get("sourceKind") == "NODE_ACCOUNTING"
                   for link in association.get("rows", []) if isinstance(association.get("rows"), list)))
        if not possible:
            return
        has_node = True
        retained = sources.get(source["id"])
        if not retained or (retained["sha256"], retained["bytes"]) != (source["sha256"], source["bytes"]):
            rejected("A retained Node source edition differs from its complete original bytes.")
        if source["id"] not in inspected:
            raw = files.get("sources/" + source["id"])
            if not isinstance(raw, bytes):
                rejected("The original Node carrier is missing from this complete case.")
            native = inspect(raw)
            if native["report"]["schema"] != NODE_SCHEMA:
                rejected("This Node association requires the original Node accounting carrier.")
            inspected[source["id"]] = native["report"]
        report = inspected[source["id"]]
        if (association.get("schema") != SCHEMA or association.get("sourceSchema") != NODE_SCHEMA
                or association.get("sourceSha256") != source["sha256"]
                or association.get("sourceIdentitySha256") != report["source"]["sourceIdentitySha256"]
                or association.get("commandId") != report["source"]["commandId"]
                or association.get("contextSha256") != report["source"]["contextSha256"]
                or association.get("capturedAt") != report["source"]["capturedAt"]
                or type(association.get("totalSourceJobs")) is not int
                or association["totalSourceJobs"] != len(report["rows"])
                or association.get("reader") != report["reader"]):
            rejected("The restored Node source identity or native reader binding differs.")
        filename(association.get("originalFilename"))
        links, reports = association.get("rows"), association.get("reports")
        if not isinstance(links, list) or not 1 <= len(links) <= len(report["rows"]):
            rejected("Retain the selected original Node source rows.")
        if not isinstance(reports, list) or not reports or len(reports) > 200:
            rejected("Retain the original Node review files.")
        seen_reports = set()
        for original_report in reports:
            if not isinstance(original_report, dict) or set(original_report) != {"sourceId", "sha256"}:
                rejected("A Node review file descriptor is incomplete.")
            selected = sources.get(original_report["sourceId"])
            if (not selected or selected["sha256"] != original_report["sha256"]
                    or selected["id"] in seen_reports):
                rejected("A Node review file differs from its retained source identity.")
            seen_reports.add(selected["id"])
        rows = {row["jobId"]: row for row in report["rows"]}
        deployment_ids = {row["id"] for row in snapshot["records"]["deployments"]}
        purchases = {row["id"]: row for row in snapshot["records"]["purchases"]}
        seen = set()
        for link in links:
            if not isinstance(link, dict) or link.get("jobId") not in rows or link["jobId"] in seen:
                rejected("Each Node source identity must be retained once in its source edition.")
            seen.add(link["jobId"])
            original = rows[link["jobId"]]
            if not original["canReceive"]:
                rejected("The original Node reader requires resolution before receiving this source.")
            fixed = ("jobId", "intentId", "configSha256", "sourceRecordSha256",
                     "sourceKind", "disposition", "node", "outcome", "output", "purchase", "finality")
            if set(link) != set(fixed) | {"purchaseId", "deploymentId"}:
                rejected("The Node association has unknown or missing original fields.")
            if any(link[key] != original[key] for key in fixed):
                rejected("A restored Node observation differs from its original carrier.")
            if link["deploymentId"] not in deployment_ids:
                rejected("The original Node deployment is missing from this case edition.")
            if original["purchase"] is None:
                if link["purchaseId"] is not None:
                    rejected("An original unpaid Node observation cannot become a purchase.")
            else:
                purchase = purchases.get(link["purchaseId"])
                if (not purchase or purchase["deploymentId"] != link["deploymentId"]
                        or _conflicts(original["purchase"], purchase)):
                    rejected("The Node purchase differs from its retained original identity.")

    try:
        for source in sources.values():
            validate(source, context)
        for review in reviews:
            snapshot = review.get("snapshot", {})
            if not isinstance(snapshot, dict) or not isinstance(snapshot.get("sources", []), list):
                continue  # The original review validator handles its complete shape.
            for source in snapshot.get("sources", []):
                if isinstance(source, dict):
                    validate(source, snapshot)
        if has_node:
            for source in sources.values():
                association = source.get("buyerHandoff", {})
                if association.get("sourceSchema") != NODE_SCHEMA:
                    continue
                changes = [event.get("sourceChange", {}).get("after") for event in events
                           if event.get("action") == "buyer.receive"
                           and isinstance(event.get("sourceChange"), dict)
                           and isinstance(event["sourceChange"].get("after"), dict)
                           and event["sourceChange"]["after"].get("id") == source["id"]]
                if not changes or changes[-1] != source:
                    rejected("The current Node source association differs from its original receiving event.")
            for group in node_observations(context):
                if len(group["deploymentIds"]) != 1 or len(group["purchaseIds"]) > 1:
                    rejected("The same original Node operation has divergent receiving associations.")
        return has_node
    except Problem:
        raise
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise Problem("The complete Node source/association history is invalid.",
                      422, "BUYER_NODE_RECEIVING_SOURCE") from exc


def node_report(context):
    rows = node_observations(context)
    if not rows:
        return None
    return {"operations": len(rows), "sourceEditions": sum(len(row["editions"]) for row in rows),
        "unpaidOperations": sum(any(item["disposition"] == "NO_PAYMENT_REQUIRED"
                                   for item in row["editions"]) for row in rows),
        "rows": rows,
        "basis": "Unique original Node operation identities and every explicitly received source edition. Unpaid observations create no purchase, approved-payment intent, cash entry or independent-customer count."}


def validate_customer_use_import(context, events, reviews, files, saved_installations):
    """Receive original Calendar/Inbox custody with the native case importer.

    The caller has already validated every immutable Installation edition and
    its complete original history. No fresh case, purchase or request is made.
    """
    editions = {(row["id"], row["revision"]): row for row in saved_installations}
    inspected, found = {}, set()
    sources = context["sources"]

    def rejected(message):
        raise Problem(message, 422, "BUYER_CUSTOMER_USE_RECEIVING_SOURCE")

    def validate(source, snapshot):
        association = source.get("buyerHandoff")
        if not isinstance(association, dict):
            return
        possible = (association.get("sourceSchema") == CUSTOMER_USE_SCHEMA
                    or "customerUse" in association or "buyerSource" in association)
        if not possible:
            return
        found.add(source["id"])
        retained = sources.get(source["id"])
        if not retained or (retained["sha256"], retained["bytes"]) != (source["sha256"], source["bytes"]):
            rejected("A customer-use source edition differs from its complete original bytes.")
        if source["id"] not in inspected:
            raw = files.get("sources/" + source["id"])
            if not isinstance(raw, bytes):
                rejected("The complete original customer-use carrier is missing.")
            native = inspect(raw)
            report = native["report"]
            if report["schema"] != CUSTOMER_USE_SCHEMA:
                rejected("This association requires the distinct native customer-use return.")
            scoped = _customer_use_context(context, report, lambda ident, revision: editions[(ident, revision)])
            inspected[source["id"]] = (report, scoped)
        report, scoped = inspected[source["id"]]
        if (association.get("schema") != SCHEMA
                or association.get("sourceSchema") != CUSTOMER_USE_SCHEMA
                or association.get("sourceSha256") != source["sha256"]
                or association.get("inboxSha256") != report["buyerSource"]["inboxSha256"]
                or association.get("capturedAt") != report["source"]["capturedAt"]
                or association.get("customerUse") != report["customerUse"]
                or association.get("buyerSource") != report["buyerSource"]
                or association.get("reader") != report["reader"]
                or type(association.get("totalSourceJobs")) is not int
                or association["totalSourceJobs"] != len(report["rows"])):
            rejected("The retained customer-use metadata differs from its exact original carrier.")
        filename(association.get("originalFilename"))
        links, reports = association.get("rows"), association.get("reports")
        if not isinstance(links, list) or not 1 <= len(links) <= len(report["rows"]):
            rejected("Retain the selected original customer-use source rows.")
        if not isinstance(reports, list) or not reports or len(reports) > 200:
            rejected("Retain the original customer-use review files.")
        seen_reports = set()
        for descriptor in reports:
            if not isinstance(descriptor, dict) or set(descriptor) != {"sourceId", "sha256"}:
                rejected("A customer-use review file descriptor is incomplete.")
            selected = sources.get(descriptor["sourceId"])
            raw_report = files.get("sources/" + descriptor["sourceId"])
            if (not selected or selected["sha256"] != descriptor["sha256"]
                    or selected["id"] in seen_reports or not isinstance(raw_report, bytes)
                    or hashlib.sha256(raw_report).hexdigest() != descriptor["sha256"]):
                rejected("A customer-use review file differs from its retained bytes.")
            seen_reports.add(selected["id"])
        rows = {row["jobId"]: row for row in report["rows"]}
        deployments = {row["id"]: row for row in snapshot["records"]["deployments"]}
        purchases = {row["id"]: row for row in snapshot["records"]["purchases"]}
        seen = set()
        for link in links:
            if not isinstance(link, dict) or link.get("jobId") not in rows or link["jobId"] in seen:
                rejected("Each received customer-use source job must appear once.")
            seen.add(link["jobId"])
            original = rows[link["jobId"]]
            fixed = ("jobId", "intentId", "configSha256", "sourceRecordSha256")
            if (set(link) != set(fixed) | {"purchaseId", "deploymentId"}
                    or any(link[name] != original[name] for name in fixed)
                    or not original["canReceive"] or original["purchase"] is None):
                rejected("A received customer-use job differs from the original Inbox observation.")
            if (link["deploymentId"] not in deployments
                    or link["deploymentId"] != scoped["deployments"][link["jobId"]]):
                rejected("The received job lost its original Calendar buyer deployment.")
            purchase = purchases.get(link["purchaseId"])
            if (not purchase or purchase["deploymentId"] != link["deploymentId"]
                    or _conflicts(original["purchase"], purchase)):
                rejected("The received purchase differs from its original native identity.")

    try:
        for source in sources.values():
            validate(source, context)
        for review in reviews:
            snapshot = review.get("snapshot", {})
            if not isinstance(snapshot, dict) or not isinstance(snapshot.get("sources", []), list):
                continue
            for source in snapshot.get("sources", []):
                if isinstance(source, dict):
                    validate(source, snapshot)
        # Reconcile every prior source association, including the incremental
        # selected-job history, against the same original native source.
        for event in events:
            change = event.get("sourceChange")
            if event.get("action") != "buyer.receive" or not isinstance(change, dict):
                continue
            for name in ("before", "after"):
                source = change.get(name)
                if isinstance(source, dict):
                    validate(source, context)
        for source_id in found:
            source = sources[source_id]
            changes = [event["sourceChange"]["after"] for event in events
                       if event.get("action") == "buyer.receive"
                       and isinstance(event.get("sourceChange"), dict)
                       and isinstance(event["sourceChange"].get("after"), dict)
                       and event["sourceChange"]["after"].get("id") == source_id]
            if not changes or changes[-1] != source:
                rejected("The current customer-use association differs from its original receiving event.")
        return bool(found)
    except Problem:
        raise
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise Problem("The complete original customer-use receiving history is invalid.",
                      422, "BUYER_CUSTOMER_USE_RECEIVING_SOURCE") from exc
