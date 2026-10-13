"""CLI composition for the original case funding book and request journal."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import stat

from model import Problem, MAX_BUNDLE, canonical, digest
from operations import MAX_SOURCE, SCHEMA as OPERATIONS_SCHEMA

SCHEMA = "stellar-forge.sf47-cost-funding.cli.v1"


def register(command, mutation):
    command("cost-funding", "List the complete current work/invoice population and funding edition history", case=True, output=True)
    target = command("funding-seed", "Prepare editable allocations from current or historical funding source", case=True, output=True)
    target.add_argument("--expected-version", required=True, type=int)
    target.add_argument("--revision", type=int)
    target.add_argument("--inputs-only", action="store_true")
    target = command("funding-show", "Open the exact saved funding edition and later original-source differences", case=True, output=True)
    target.add_argument("--revision", type=int)
    target = command("funding-preview", "Calculate all assignments, remainders and period balances without saving", case=True, output=True)
    target.add_argument("--expected-version", required=True, type=int)
    target.add_argument("--inputs", required=True)
    target = command("funding-save", "Save one reviewed successor through the original case request journal", case=True, output=True)
    mutation(target, version=True, note_required=True)
    target.add_argument("--inputs", required=True)
    target.add_argument("--expected-preview-sha256", required=True)
    target.add_argument("--receipt", required=True, help="Original private receipt path; exact retries retain this path and its .request.json")
    target = command("funding-request", "Read the original committed save without a mutation", case=True, output=True)
    target.add_argument("--request-id", required=True)
    target = command("funding-export", "Export the complete selected report, every row, history and original case ZIP", case=True)
    target.add_argument("--revision", required=True, type=int)
    target.add_argument("--expected-version", required=True, type=int)
    target.add_argument("--expected-report-sha256", required=True)
    target.add_argument("--output", required=True)


def fail(message, code="FUNDING_CLI_RECOVERY", status=409):
    raise Problem(message, status, code)


def retained(path):
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except FileNotFoundError:
        return None
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or not 0 < st.st_size <= MAX_SOURCE:
            fail("The retained request or receipt is not a complete regular file.")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            raw = stream.read(MAX_SOURCE + 1)
        after = os.fstat(fd)
        if len(raw) != st.st_size or (st.st_dev, st.st_ino, st.st_mtime_ns, st.st_size) != (
                after.st_dev, after.st_ino, after.st_mtime_ns, after.st_size):
            fail("The original request or receipt changed during its read.")
        value = json.loads(raw.decode("utf-8"))
        if raw != (canonical(value) + "\n").encode("utf-8"):
            fail("Keep the exact canonical bytes of the original request and accepted receipt.")
        return value
    finally:
        os.close(fd)


def exact_publish(path, value, publish):
    raw = (canonical(value) + "\n").encode("utf-8")
    old = retained(path)
    if old is not None:
        if old != value:
            fail("The original output path belongs to different complete inputs or result.")
        return {"path": str(Path(path).absolute()), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "recovered": True}
    try:
        return publish(path, raw)
    except Problem as exc:
        if exc.code != "OUTPUT_EXISTS" or retained(path) != value:
            raise
        return {"path": str(Path(path).absolute()), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "recovered": True}


def save(ops, args, inputs, publish):
    body = {"expectedVersion": args.expected_version, "requestId": args.request_id,
            "actor": args.actor, "note": args.note, "action": "funding.save",
            "data": {"inputs": inputs, "expectedPreviewSha256": args.expected_preview_sha256}}
    case = ops.read(args.case)["program"]
    fingerprint = digest({"domain": OPERATIONS_SCHEMA, "programId": args.case, "body": body})
    request = {"schema": SCHEMA + ".request", "caseId": args.case, "caseCreatedAt": case["createdAt"],
               "request": body, "fingerprint": fingerprint}
    request_path = str(Path(args.receipt).expanduser().absolute()) + ".request.json"
    request_original = retained(request_path)
    receipt = retained(args.receipt)
    if request_original is not None and request_original != request:
        fail("Keep the original case, operator, request ID, revision, complete input and preview.")
    if receipt is not None:
        if (request_original is None or not isinstance(receipt, dict)
                or set(receipt) != {"schema", "prepared", "result", "resultSha256"}
                or receipt["schema"] != SCHEMA + ".receipt" or receipt["prepared"] != request
                or receipt["resultSha256"] != digest(receipt["result"])):
            fail("The accepted receipt no longer joins its exact prepared request.")
    # Read the original journal before any version check or source mutation.
    original = ops.funding_request(args.case, args.request_id)
    if original["caseCreatedAt"] != case["createdAt"]:
        fail("The original case identity changed.")
    if original["found"]:
        if original["fingerprint"] != fingerprint:
            fail("The original request is committed with different complete inputs.")
        if receipt is not None and (receipt["result"] != original["result"]
                                    or receipt["resultSha256"] != original["resultSha256"]):
            fail("The original committed result differs from the retained accepted response.")
        result = original["result"]
    else:
        if receipt is not None:
            fail("This restored workspace lacks the accepted original commitment. Restore matching state before continuing.")
        exact_publish(request_path, request, publish)
        result = ops.command(args.case, body)
        # The same original journal proves the source and save event before receipt publication.
        original = ops.funding_request(args.case, args.request_id)
        if (not original["found"] or original["fingerprint"] != fingerprint
                or original["result"] != result or original["resultSha256"] != digest(result)):
            fail("Retain the exact request; its original save could not be reconciled.")
    exact_publish(request_path, request, publish)
    envelope = {"schema": SCHEMA + ".receipt", "prepared": request,
                "result": result, "resultSha256": digest(result)}
    descriptor = exact_publish(args.receipt, envelope, publish)
    return {**result, "originalReceipt": descriptor}


def operate(ops, args, read_bytes, publish):
    action = args.operation
    if action == "cost-funding":
        result = ops.funding_catalog(args.case)
    elif action == "funding-seed":
        result = ops.seed_funding(args.case, {"expectedVersion": args.expected_version,
                                             **({"revision": args.revision} if args.revision is not None else {})})
        if args.inputs_only:
            result = result["inputs"]
    elif action == "funding-show":
        result = ops.funding(args.case, args.revision)
    elif action == "funding-request":
        result = ops.funding_request(args.case, args.request_id)
    elif action in ("funding-preview", "funding-save"):
        try:
            inputs = json.loads(read_bytes(args.inputs, MAX_SOURCE))
        except (ValueError, UnicodeError) as exc:
            raise Problem("Use a complete UTF-8 funding input document.", 422, "INVALID_COST_FUNDING") from exc
        result = (ops.preview_funding(args.case, {"expectedVersion": args.expected_version, "inputs": inputs})
                  if action == "funding-preview" else save(ops, args, inputs, publish))
    elif action == "funding-export":
        result = {"caseId": args.case, "output": publish(args.output, ops.export_funding(
            args.case, args.revision, args.expected_version, args.expected_report_sha256))}
        return result
    else:
        fail("Unknown cost funding command.", "INVALID_COST_FUNDING", 422)
    if getattr(args, "output", None):
        return {"output": publish(args.output, (canonical(result) + "\n").encode("utf-8"))}
    return result
