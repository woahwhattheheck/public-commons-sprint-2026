#!/usr/bin/env python3
"""Original merchant snapshot/restore and a read-only native-application join."""
from __future__ import annotations

import argparse
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "recovery"))
import merchant_snapshot
sys.path.insert(0, str(HERE.parent / "api-access"))
import pass_store

SCHEMA = "stellar-forge.sf101.api-application-snapshot.v1"
ADMISSION = "stellar-forge.sf101.api-application-admission.v1"
MAX_MANIFEST = 12 * 1024 * 1024
HASH = re.compile(r"[a-f0-9]{64}\Z")
RECORD = re.compile(r"records/(sf101-[a-f0-9]{64})\.json\Z")


def need(condition, code):
    if not condition:
        raise pass_store.PassError(code, 409)


def read_private(path, limit):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077
             and info.st_nlink == 1 and info.st_size <= limit,
             "APP_RECOVERY_PRIVATE_FILE_REQUIRED")
        with os.fdopen(os.dup(fd), "rb") as stream:
            body = stream.read(limit + 1)
        need(len(body) == info.st_size and len(body) <= limit,
             "APP_RECOVERY_FILE_CHANGED")
        return body
    finally:
        os.close(fd)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def image_layout(source, manifest):
    expected_assets = {item["sha256"] + ".bin" for item in manifest["orders"]}
    need(set(os.listdir(source)) == {"assets", "merchant.sqlite3", "snapshot.json"}
         and set(os.listdir(source / "assets")) == expected_assets,
         "APP_RECOVERY_MERCHANT_CLOSURE_CHANGED")
    paths = [source / "snapshot.json", source / "merchant.sqlite3",
             *(source / "assets" / name for name in sorted(expected_assets))]
    size = 0
    for path in paths:
        info = path.lstat()
        need(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077
             and info.st_nlink == 1 and info.st_size <= 2 * 1024**3,
             "APP_RECOVERY_MERCHANT_FILE_REQUIRED")
        size += info.st_size
    return {"imageBytes": size, "imageEntries": len(paths) + 2}


def object_json(root, entry, limit):
    need(isinstance(entry, dict) and isinstance(entry.get("sha256"), str)
         and HASH.fullmatch(entry["sha256"]) and entry.get("kind") == "file",
         "APP_RECOVERY_NATIVE_RECORD_INVALID")
    body = read_private(root / "objects" / (entry["sha256"] + ".bin"), limit)
    need(len(body) == entry.get("bytes")
         and hashlib.sha256(body).hexdigest() == entry["sha256"],
         "APP_RECOVERY_NATIVE_RECORD_CHANGED")
    return json.loads(body.decode("utf-8"))


def native_join(root, inspected):
    manifest = json.loads(read_private(root / "application-snapshot.json", MAX_MANIFEST).decode("utf-8"))
    need(isinstance(manifest, dict) and manifest.get("schema") == SCHEMA
         and isinstance(manifest.get("entries"), list) and len(manifest["entries"]) <= 9500,
         "APP_RECOVERY_MANIFEST_INVALID")
    merchant = inspected["manifest"]
    need(manifest.get("merchant", {}).get("manifestSha256") == inspected["manifestSha256"],
         "APP_RECOVERY_MERCHANT_SNAPSHOT_CHANGED")
    records = []
    for entry in manifest["entries"]:
        if isinstance(entry, dict) and entry.get("root") == "native" and str(entry.get("path", "")).startswith("records/"):
            match = RECORD.fullmatch(entry["path"])
            need(match is not None, "APP_RECOVERY_NATIVE_RECORD_INVALID")
            row = object_json(root, entry, 2097152)
            need(isinstance(row, dict) and row.get("id") == match.group(1),
                 "APP_RECOVERY_NATIVE_RECORD_CHANGED")
            records.append(row)
    database = root / "merchant" / "merchant.sqlite3"
    connection = sqlite3.connect(database.as_uri() + "?mode=ro&immutable=1", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        orders = {item["orderRef"]: item for item in merchant["orders"]}
        plans = {}
        statuses = {}
        retained = 0
        differing_responses = 0
        related_passes = set()
        for row in records:
            payment = row.get("payment")
            need(isinstance(payment, dict) and payment.get("schema") == ADMISSION
                 and payment.get("authority") == "sf101-purchased-api-allowance"
                 and payment.get("profileSha256") == manifest.get("profileSha256")
                 and payment.get("gatewaySha256") == manifest.get("gatewaySha256")
                 and row.get("source") == manifest.get("source")
                 and row.get("settlement") is None and payment.get("operation") == row["id"],
                 "APP_RECOVERY_NATIVE_AUTHORITY_CHANGED")
            ref, request_id = payment.get("orderRef"), payment.get("requestId")
            expected = "sf101-" + hashlib.sha256(encoded([ref, request_id])).hexdigest()
            need(expected == row["id"], "APP_RECOVERY_OPERATION_CHANGED")
            call = pass_store._call(connection, ref, request_id)
            view = pass_store._call_view(call)
            need(all(view[key] == payment.get(key) for key in
                     ("orderRef", "requestId", "routeId", "method", "path", "requestSha256", "units"))
                 and view["deadlineAt"] == payment.get("deadlineAt")
                 and isinstance(payment.get("admissionRevision"), int)
                 and 1 <= payment["admissionRevision"] <= call["revision"],
                 "APP_RECOVERY_ALLOWANCE_BINDING_CHANGED")
            record = pass_store._pass(connection, ref)
            original = pass_store._order(connection, ref)
            need(ref in orders and orders[ref]["sha256"] == record["manifest_sha256"]
                 == original["file_sha256"] == payment.get("manifestSha256")
                 and record["plan_sha256"] == payment.get("planSha256"),
                 "APP_RECOVERY_PAID_PLAN_CHANGED")
            if ref not in plans:
                body = read_private(root / "merchant" / orders[ref]["path"], pass_store.MAX_PLAN_BYTES)
                plan = pass_store.validate_plan(json.loads(body.decode("utf-8")))
                compact = pass_store._compact(plan)
                need(compact == record["plan_json"]
                     and hashlib.sha256(compact.encode("utf-8")).hexdigest() == record["plan_sha256"],
                     "APP_RECOVERY_PAID_PLAN_CHANGED")
                plans[ref] = plan
            route = next((item for item in plans[ref]["routes"] if item["id"] == payment["routeId"]), None)
            need(route is not None and all(route[key] == payment[key] for key in ("method", "path", "units")),
                 "APP_RECOVERY_PAID_ROUTE_CHANGED")
            related_passes.add(ref)
            statuses[call["status"]] = statuses.get(call["status"], 0) + 1
            if call["response_sha256"] is not None:
                saved = connection.execute(
                    "SELECT body FROM sf101_api_results WHERE order_ref=? AND request_id=?",
                    (ref, request_id)).fetchone()
                need(saved is not None and isinstance(saved["body"], bytes)
                     and len(saved["body"]) == call["response_bytes"]
                     and hashlib.sha256(saved["body"]).hexdigest() == call["response_sha256"],
                     "APP_RECOVERY_ALLOWANCE_RESULT_CHANGED")
                retained += 1
                result = row.get("result")
                if isinstance(result, dict) and (
                        result.get("sha256") != call["response_sha256"]
                        or result.get("contentType") != call["content_type"]
                        or result.get("bytes") != call["response_bytes"]):
                    differing_responses += 1
        usage = {ref: pass_store._usage(connection, ref) for ref in sorted(related_passes)}
        return {"executions": len(records), "callStates": statuses,
                "retainedCallResponses": retained, "differingRetainedResponses": differing_responses,
                "usage": usage}
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["snapshot", "inspect", "restore"])
    args = parser.parse_args()
    body = sys.stdin.buffer.read(MAX_MANIFEST + 1)
    need(len(body) <= MAX_MANIFEST, "APP_RECOVERY_INPUT_TOO_LARGE")
    value = json.loads(body.decode("utf-8"))
    need(isinstance(value, dict), "APP_RECOVERY_INPUT_REQUIRED")
    if args.action == "snapshot":
        result = merchant_snapshot.create_snapshot(value["state"], value["destination"])
        retained = json.loads(read_private(Path(result["snapshot"]) / "snapshot.json", MAX_MANIFEST).decode("utf-8"))
        result["sourceStateDigest"] = retained["sourceStateDigest"]
    elif args.action == "restore":
        result = merchant_snapshot.restore_snapshot(value["snapshot"], value["destination"])
    else:
        root = merchant_snapshot.receiver.require_private_dir(value["snapshot"])
        source = root / "merchant"
        inspected = merchant_snapshot.inspect_snapshot(source)
        manifest = inspected["manifest"]
        result = {"schema": merchant_snapshot.SCHEMA,
                  "manifestSha256": inspected["manifestSha256"],
                  "databaseSha256": manifest["database"]["sha256"],
                  "sourceStateDigest": manifest["sourceStateDigest"],
                  "createdAt": manifest["createdAt"], "orders": len(manifest["orders"]),
                  **image_layout(source, manifest), "join": native_join(root, inspected)}
    print(json.dumps(result, sort_keys=True, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = getattr(error, "code", "")
        if not isinstance(code, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{1,100}", code):
            code = {errno.ENOENT: "APP_RECOVERY_FILE_NOT_FOUND", errno.ENOSPC: "APP_RECOVERY_STORAGE_FULL"}.get(
                getattr(error, "errno", None), "APP_MERCHANT_RECOVERY_FAILED")
        print(json.dumps({"ok": False, "error": code}), file=sys.stderr)
        sys.exit(1)
