#!/usr/bin/env python3
"""Compose private application execution with the original SF101 reservation.

The gateway owns customer authentication and allowance admission. This adapter
reads that existing reservation before a native worker starts, and later uses
the original operator API to attach a retained result or release unstarted work.
"""
import argparse
import base64
import hashlib
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api-access"))
import pass_store

SCHEMA = "stellar-forge.sf101.api-application-admission.v1"
EXECUTION_SCHEMA = "stellar-forge.sf101.api-application-execution.v1"
HASH = re.compile(r"[a-f0-9]{64}\Z")
OPERATION = re.compile(r"sf101-[a-f0-9]{64}\Z")
MAX_INPUT = 7 * 1024 * 1024


def need(condition, code, status=409):
    if not condition:
        raise pass_store.PassError(code, status)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def operation_id(ref, request_id):
    return "sf101-" + hashlib.sha256(encoded([ref, request_id])).hexdigest()


def admission(state, request):
    """One original read snapshot, immediately before the execution claim."""
    operation = request.get("operation")
    need(isinstance(operation, str) and OPERATION.fullmatch(operation), "APP_OPERATION_REQUIRED", 400)
    need(request.get("method") == "POST" and isinstance(request.get("path"), str)
         and isinstance(request.get("routeId"), str)
         and isinstance(request.get("requestSha256"), str)
         and HASH.fullmatch(request["requestSha256"]), "APP_REQUEST_IDENTITY_REQUIRED", 400)
    with pass_store._connection(state) as (db, root):
        need(pass_store._has_schema(db), "APP_PASS_RESERVATION_REQUIRED")
        # Only live reservations are candidates. No derived enrollment or payment
        # rows are created; the operation is the gateway's exact existing key.
        matches = []
        for row in db.execute("""SELECT * FROM sf101_api_calls
                WHERE status='IN_FLIGHT' AND route_id=? AND method='POST' AND path=?""",
                (request["routeId"], request["path"])):
            if operation_id(row["order_ref"], row["request_id"]) == operation:
                matches.append(row)
        need(len(matches) == 1, "APP_LIVE_RESERVATION_REQUIRED")
        row = matches[0]
        need(time.time() < row["lease_until"], "APP_RESERVATION_EXPIRED")
        need(row["request_sha256"] == request["requestSha256"], "APP_REQUEST_FINGERPRINT_CHANGED")
        order = pass_store._order(db, row["order_ref"])
        need(order["state"] == "ENTITLED" and pass_store.receiver.access_allowed(db, row["order_ref"]),
             "APP_ORIGINAL_ACCESS_DENIED", 403)
        record, plan = pass_store._bound_plan(db, root, order)
        route = next((item for item in plan["routes"] if item["id"] == row["route_id"]), None)
        need(route is not None and route["method"] == row["method"] and route["path"] == row["path"]
             and route["units"] == row["units"], "APP_ORIGINAL_ROUTE_CHANGED")
        call = pass_store._call_view(row)
        try:
            response_type = pass_store.validate_content_type(request.get("responseContentType"))
        except pass_store.PassError:
            response_type = "application/octet-stream"
        return {"schema": SCHEMA, "authority": "sf101-purchased-api-allowance",
                "operation": operation, "orderRef": row["order_ref"], "requestId": row["request_id"],
                "routeId": row["route_id"], "method": row["method"], "path": row["path"],
                "requestSha256": row["request_sha256"], "units": row["units"], "responseContentType": response_type,
                "admissionRevision": row["revision"], "deadlineAt": call["deadlineAt"],
                "manifestSha256": record["manifest_sha256"], "planSha256": record["plan_sha256"]}


def matched_execution(args, value):
    need(isinstance(value, dict) and value.get("schema") == EXECUTION_SCHEMA,
         "APP_NATIVE_EXECUTION_REQUIRED")
    row = value.get("execution")
    need(isinstance(row, dict) and row.get("id") == operation_id(args.order, args.request_id),
         "APP_EXECUTION_OPERATION_CHANGED")
    payment = row.get("payment")
    need(isinstance(payment, dict) and payment.get("schema") == SCHEMA
         and payment.get("authority") == "sf101-purchased-api-allowance"
         and payment.get("operation") == row["id"] and payment.get("orderRef") == args.order
         and payment.get("requestId") == args.request_id
         and row.get("settlement") is None, "APP_NATIVE_ADMISSION_REQUIRED")
    need(isinstance(value.get("profileSha256"), str)
         and HASH.fullmatch(value["profileSha256"])
         and payment.get("profileSha256") == value["profileSha256"],
         "APP_EXECUTION_PROFILE_CHANGED")
    history = pass_store.call_history(args.state, args.order, args.request_id)
    call = history["call"]
    need(all(call[key] == payment[key] for key in
             ("orderRef", "requestId", "routeId", "method", "path", "requestSha256", "units")),
         "APP_ALLOWANCE_EXECUTION_MISMATCH")
    need(isinstance(row.get("attempts"), list), "APP_NATIVE_ATTEMPTS_REQUIRED")
    return row, history


def recover(args, value):
    row, history = matched_execution(args, value)
    need(row.get("state") == "COMPLETED" and row["attempts"]
         and row["attempts"][-1].get("state") == "COMPLETED", "APP_COMPLETED_EXECUTION_REQUIRED")
    descriptor = row.get("result")
    need(isinstance(descriptor, dict) and isinstance(value.get("bodyBase64"), str),
         "APP_RETAINED_RESULT_REQUIRED")
    try:
        body = base64.b64decode(value["bodyBase64"], validate=True)
    except (ValueError, TypeError):
        raise pass_store.PassError("APP_RETAINED_RESULT_INVALID", 409) from None
    need(len(body) <= pass_store.MAX_RESPONSE_BYTES
         and descriptor.get("bytes") == len(body)
         and descriptor.get("sha256") == hashlib.sha256(body).hexdigest()
         and descriptor.get("file") == descriptor["sha256"] + ".bin"
         and row["attempts"][-1].get("resultSha256") == descriptor["sha256"],
         "APP_RETAINED_RESULT_CHANGED")
    content_type = pass_store.validate_content_type(descriptor.get("contentType"))
    response = {"status": 200, "contentType": content_type,
                "sha256": descriptor["sha256"], "bytes": len(body)}
    common = {"ref": args.order, "request_id": args.request_id,
              "expected_revision": args.revision, "operation_id": args.operation_id,
              "actor": args.actor, "reason": args.reason,
              "status": 200, "body": body, "content_type": content_type}
    prior = next((item for item in history["actions"] if item["operation_id"] == args.operation_id), None)
    if prior:
        need(prior["action"] in {"resolve-consume", "attach-result"}, "APP_RECOVERY_OPERATION_CHANGED")
        if prior["action"] == "attach-result":
            outcome = pass_store.attach_result(args.state, **common)
        else:
            outcome = pass_store.resolve_call(args.state, decision="consume", **common)
    elif history["call"]["result"] is not None:
        need(history["call"]["storedStatus"] == "COMPLETED"
             and history["call"]["result"] == response, "APP_STORED_RESULT_DIFFERS")
        return {"schema": "stellar-forge.sf101.api-application-recovery.v1",
                "executionId": row["id"], "alreadyCompleted": True, "call": history["call"]}
    elif history["call"]["storedStatus"] == "CONSUMED":
        outcome = pass_store.attach_result(args.state, **common)
    else:
        outcome = pass_store.resolve_call(args.state, decision="consume", **common)
    return {"schema": "stellar-forge.sf101.api-application-recovery.v1",
            "executionId": row["id"], "outcome": outcome}


def release(args, value):
    row, history = matched_execution(args, value)
    # The native store has first made the queued operation terminal under its
    # exclusive writer lease. No later retry can execute this operation.
    need(row.get("state") == "CANCELLED" and row.get("attempts") == []
         and row.get("result") is None, "APP_UNSTARTED_CANCELLATION_REQUIRED")
    need(any(item.get("action") == "unstarted-cancelled" for item in row.get("history", [])),
         "APP_UNSTARTED_CANCELLATION_REQUIRED")
    prior = next((item for item in history["actions"] if item["operation_id"] == args.operation_id), None)
    if prior:
        need(prior["action"] == "resolve-release", "APP_RECOVERY_OPERATION_CHANGED")
    elif history["call"]["storedStatus"] == "RELEASED":
        return {"schema": "stellar-forge.sf101.api-application-recovery.v1",
                "executionId": row["id"], "alreadyReleased": True, "call": history["call"]}
    outcome = pass_store.resolve_call(args.state, ref=args.order, request_id=args.request_id,
        expected_revision=args.revision, operation_id=args.operation_id,
        actor=args.actor, reason=args.reason, decision="release")
    return {"schema": "stellar-forge.sf101.api-application-recovery.v1",
            "executionId": row["id"], "outcome": outcome}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("admit", "describe", "recover", "release"))
    parser.add_argument("--state", required=True)
    for name in ("order", "request-id", "operation-id", "actor", "reason"):
        parser.add_argument("--" + name)
    parser.add_argument("--revision", type=int)
    args = parser.parse_args()
    state = pass_store.receiver.require_private_dir(args.state)
    if args.action == "describe":
        need(args.order is not None and args.request_id is not None, "APP_CALL_REFERENCE_REQUIRED", 400)
        result = pass_store.call_history(state, args.order, args.request_id)
    else:
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        need(len(raw) <= MAX_INPUT, "APP_INPUT_TOO_LARGE", 413)
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeError):
            raise pass_store.PassError("APP_INPUT_JSON_REQUIRED", 400) from None
        need(isinstance(value, dict), "APP_INPUT_JSON_REQUIRED", 400)
        if args.action == "admit":
            result = admission(state, value)
        else:
            need(all(getattr(args, name) is not None for name in
                     ("order", "request_id", "operation_id", "actor", "reason", "revision")),
                 "APP_OPERATOR_RECOVERY_FIELDS_REQUIRED", 400)
            result = recover(args, value) if args.action == "recover" else release(args, value)
    print(json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = getattr(error, "code", "")
        if not isinstance(code, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{1,100}", code):
            code = "APP_ALLOWANCE_UNAVAILABLE"
        print(json.dumps({"ok": False, "error": code, "status": getattr(error, "status", 503)}),
              file=sys.stderr)
        sys.exit(1)
