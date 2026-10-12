#!/usr/bin/env python3
"""Native Databento acquisition with retained responses, same-job recovery and exact source export."""
from __future__ import annotations

import argparse
import contextlib
import csv
import datetime as dt
from decimal import Decimal, InvalidOperation
import fcntl
import gzip
import hashlib
import importlib.metadata
import io
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import uuid
import warnings
import enum
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

SCHEMA = "tj.databento-acquisition.v1"
HANDOFF = "tj.databento-acquisition-handoff.v1"
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SHA = re.compile(r"^[a-f0-9]{64}$")
FORMATS = {"csv": "csv", "dbn-jsonl": "dbn-jsonl", "json": "json"}
PLAN_KEYS = {
    "dataset", "symbols", "schema", "start", "end", "stype_in", "stype_out",
    "encoding", "compression", "pretty_px", "pretty_ts", "map_symbols",
    "split_symbols", "split_duration", "split_size", "delivery", "limit",
}
COST_KEYS = {"dataset", "symbols", "schema", "start", "end", "stype_in", "limit"}
DEFAULTS = {
    "stype_in": "raw_symbol", "stype_out": "instrument_id",
    "encoding": "dbn", "compression": "zstd",
    "pretty_px": False, "pretty_ts": False, "map_symbols": False,
    "split_symbols": False, "split_duration": "day", "delivery": "download",
}

class AcquisitionError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code

def fail(code, message):
    raise AcquisitionError(code, message)

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def ident(value, label="operation"):
    if not isinstance(value, str) or not ID.fullmatch(value) or value in {".", ".."}:
        fail("INVALID_ID", f"{label} must be 1–128 simple letters, digits, dots, underscores or hyphens.")
    return value

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()

def digest(value):
    return hashlib.sha256(value).hexdigest()

def fingerprint(file):
    h = hashlib.sha256()
    count = 0
    with Path(file).open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            h.update(chunk)
            count += len(chunk)
    return {"bytes": count, "sha256": h.hexdigest()}

def private_directory(path):
    path = Path(path).absolute()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink() or not path.is_dir():
        fail("PRIVATE_STORE", "The private store must be a real local directory.")
    os.chmod(path, 0o700)
    return path

def sync_dir(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def write_bytes(path, body, *, replace=False, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not replace and path.exists():
        if path.is_file() and not path.is_symlink() and path.read_bytes() == body:
            return
        fail("RETAINED_CONFLICT", "A retained file already has different bytes: " + path.name)
    temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex + ".part")
    with temporary.open("xb") as stream:
        os.chmod(temporary, mode)
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        if replace:
            os.replace(temporary, path)
        else:
            try:
                os.link(temporary, path)
            except FileExistsError:
                if path.is_symlink() or path.read_bytes() != body:
                    fail("RETAINED_CONFLICT", "A retained file already has different bytes: " + path.name)
        sync_dir(path.parent)
    finally:
        if temporary.exists():
            temporary.unlink()

def write_json(path, value, *, replace=False):
    write_bytes(path, encoded(value), replace=replace)

def read_json(path):
    with Path(path).open(encoding="utf-8") as stream:
        return json.load(stream)

def lossless_json(body):
    return json.loads(body, parse_int=str, parse_float=str,
                      parse_constant=lambda _: fail("INVALID_NUMBER", "Nonfinite JSON number."))

def clean(value, secrets=()):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if str(key).lower().replace("-", "_") in {
                "token", "access_token", "api_key", "authorization", "password",
                "cookie", "set_cookie", "secret", "credentials",
            }:
                result[str(key)] = "[private]"
            else:
                result[str(key)] = clean(item, secrets)
        return result
    if isinstance(value, (list, tuple)):
        return [clean(item, secrets) for item in value]
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, "[private]")
        return value
    return value

def request_plan(path):
    raw = read_json(path)
    if not isinstance(raw, dict) or set(raw) - PLAN_KEYS:
        fail("INVALID_REQUEST", "Use a native batch request object with only documented batch fields.")
    for name in ("dataset", "schema", "start", "end", "symbols"):
        if raw.get(name) is None or raw.get(name) == "":
            fail("INVALID_REQUEST", "Set the explicit native request field: " + name)
    if not isinstance(raw["dataset"], str) or not isinstance(raw["schema"], str):
        fail("INVALID_REQUEST", "dataset and schema must retain their native string values.")
    if isinstance(raw["symbols"], bool) or not isinstance(raw["symbols"], (str, int, list)):
        fail("INVALID_REQUEST", "symbols must be the original native symbol selection.")
    if isinstance(raw["symbols"], list) and (not raw["symbols"] or len(raw["symbols"]) > 2000):
        fail("INVALID_REQUEST", "Supply 1–2,000 original symbols, or an explicit native ALL_SYMBOLS selector.")
    plan = {**DEFAULTS, **raw}
    if plan["delivery"] != "download":
        fail("INVALID_REQUEST", "This receiver uses the native download delivery.")
    if plan["pretty_px"] or plan["pretty_ts"]:
        fail("PRECISION", "Use pretty_px=false and pretty_ts=false for native acquisitions; presentation belongs in the report.")
    for name in ("limit", "split_size"):
        if name in plan and (isinstance(plan[name], bool) or not isinstance(plan[name], int) or plan[name] <= 0):
            fail("INVALID_REQUEST", name + " must be a positive integer when supplied.")
    return plan

def read_key(args):
    if args.key_file:
        file = Path(args.key_file)
        if not file.is_file() or file.is_symlink() or file.stat().st_mode & 0o077:
            fail("CREDENTIAL_FILE", "Use a private regular key file with mode0600.")
        key = file.read_text(encoding="utf-8").strip()
    else:
        key = os.environ.get(args.key_env, "").strip()
    if not key or key == "YOUR_API_KEY" or "\n" in key or "\r" in key:
        fail("CREDENTIAL_MISSING", "Select the existing customer key through --key-env or --key-file.")
    return key

def native_versions():
    try:
        version = importlib.metadata.version("databento")
        decoder = importlib.metadata.version("databento-dbn")
    except (ImportError, importlib.metadata.PackageNotFoundError):
        fail("NATIVE_SDK", "Install the original databento==0.87.0 and compatible databento-dbn~=0.70.0 runtime.")
    if version != "0.87.0" or not decoder.startswith("0.70."):
        fail("NATIVE_SDK_VERSION", "This operated client expects databento0.87.0 with databento-dbn0.70.x; keep that compatible pair.")
    return {"databento": version, "databento-dbn": decoder}

def native_sdk():
    versions = native_versions()
    try:
        import databento as db
    except ImportError:
        fail("NATIVE_SDK", "Use the original databento0.87.0 installation with its declared HTTP dependencies.")
    return db, versions

class Store:
    def __init__(self, root, gateway=None):
        self.root = private_directory(root)
        self.operations = private_directory(self.root / "operations")
        if gateway is not None and (not isinstance(gateway, str) or not gateway.strip()):
            fail("GATEWAY_SELECTION", "Select an original native historical gateway.")
        if gateway and "://" in gateway:
            safe_url(gateway)
        self.gateway = gateway

    @contextlib.contextmanager
    def operation(self, operation_id, kind=None, request=None, key=None):
        operation_id = ident(operation_id)
        folder = private_directory(self.operations / operation_id)
        fd = os.open(folder / ".lock", os.O_CREAT | os.O_RDWR, 0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                fail("OPERATION_ACTIVE", "The same retained operation is already active.")
            state_file = folder / "operation.json"
            if state_file.exists():
                state = read_json(state_file)
                if kind and state["kind"] != kind:
                    fail("OPERATION_SELECTION", "This operation ID already has a different command.")
                if request is not None and state["requestSha256"] != digest(encoded(request)):
                    fail("OPERATION_SELECTION", "This operation ID already has a different request.")
                if key is not None and state.get("accountBinding") not in {None, digest(key.encode())}:
                    fail("ACCOUNT_SELECTION", "Reopen the existing operation with its original customer account.")
                if key is not None and state.get("gateway") != self.gateway:
                    fail("GATEWAY_SELECTION", "Reopen the operation with its original --gateway selection; production and preview are separate requests.")
            else:
                if kind is None:
                    fail("OPERATION_NOT_FOUND", "No retained operation exists for that ID.")
                state = {
                    "schema": SCHEMA, "id": operation_id, "kind": kind,
                    "createdAt": utc(), "updatedAt": utc(), "state": "PREPARED",
                    "request": request or {}, "requestSha256": digest(encoded(request or {})),
                    "accountBinding": digest(key.encode()) if key else None, "gateway": self.gateway,
                }
                write_json(state_file, state)
            yield Operation(folder, state, key)
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

class Operation:
    def __init__(self, root, state, key=None):
        self.root, self.state, self.key = root, state, key
        self.current_call = None
        self.calls = private_directory(root / "calls")

    def save(self, **fields):
        self.state.update(fields, updatedAt=utc())
        write_json(self.root / "operation.json", self.state, replace=True)

    def summary(self):
        # Raw responses, native account binding and authenticated download URLs stay private.
        return clean({key: value for key, value in self.state.items()
                      if key not in {"accountBinding"}}, (self.key,))

    def capture(self, response=None, error=None):
        if self.current_call is None:
            return
        label, attempt = self.current_call
        folder = private_directory(self.calls / label / ("attempt-" + str(attempt)))
        if response is not None:
            body, status = response.content, response.status_code
            headers = dict(response.headers)
        elif getattr(error, "http_body", None) is not None:
            body, status = error.http_body, getattr(error, "http_status", None)
            headers = dict(getattr(error, "headers", {}) or {})
        else:
            return
        if isinstance(body, str):
            body = body.encode()
        body_file = folder / "response.body"
        write_bytes(body_file, body)
        metadata = {
            "schema": "tj.databento-native-response.v1",
            "capturedAt": utc(), "httpStatus": status,
            "captureMethod": "native-sdk-response-content",
            "originalWireBytes": False,
            "contentDecoding": "The unchanged native requests client supplied response.content before SDK JSON interpretation.",
            "body": {"path": str(body_file.relative_to(self.root)), **fingerprint(body_file)},
            "headers": headers,
        }
        write_json(folder / "response.json", metadata)
        return metadata

    def client(self):
        db, versions = native_sdk()
        if not self.key:
            fail("CREDENTIAL_MISSING", "The original account is required for this provider operation.")
        gateway = self.state.get("gateway")
        client = db.Historical(key=self.key, **({"gateway": gateway} if gateway else {}))
        self.save(nativeVersions=versions, resolvedGateway=str(client.gateway))
        for part in (client.batch, client.metadata, client.symbology):
            for name in ("_get", "_post"):
                original = getattr(part, name)
                def receive(*args, _original=original, **kwargs):
                    try:
                        response = _original(*args, **kwargs)
                    except Exception as error:
                        self.capture(error=error)
                        raise
                    self.capture(response=response)
                    return response
                setattr(part, name, receive)
        return client

    def call(self, label, method, *, mutation=False, **kwargs):
        ident(label, "call")
        folder = private_directory(self.calls / label)
        result_file = folder / "result.json"
        if result_file.exists():
            saved = read_json(result_file)
            return saved["sdkResult"]
        attempts = sorted(folder.glob("attempt-*"), key=lambda p: int(p.name.split("-")[-1]))
        if attempts and mutation:
            for existing in reversed(attempts):
                record = existing / "response.json"
                if record.exists():
                    response = read_json(record)
                    if response["httpStatus"] is not None and 200 <= response["httpStatus"] < 300:
                        body = (self.root / response["body"]["path"]).read_bytes()
                        if fingerprint(self.root / response["body"]["path"]) != {k: response["body"][k] for k in ("bytes", "sha256")}:
                            fail("SOURCE_CHANGED", "Retained provider acknowledgement differs from its original bytes.")
                        recovered = json.loads(body)
                        write_json(result_file, {"sdkResult": recovered, "recoveredFrom": response["body"]})
                        return recovered
            self.save(state="SUBMISSION_UNCERTAIN")
            fail("SUBMISSION_UNCERTAIN", "The original submit already started. Use jobs and reconcile with its actual provider job ID; it will not be submitted again.")
        attempt = len(attempts) + 1
        private_directory(folder / ("attempt-" + str(attempt)))
        write_json(folder / ("attempt-" + str(attempt)) / "started.json",
                   {"at": utc(), "mutation": mutation, "nativeArguments": kwargs})
        self.current_call = (label, attempt)
        try:
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")
                value = method(**kwargs)
            warning_text = [clean(str(item.message), (self.key,)) for item in caught]
            write_json(result_file, {"sdkResult": value, "warnings": warning_text, "completedAt": utc()})
            return value
        except Exception:
            if mutation:
                self.save(state="SUBMISSION_UNCERTAIN")
            raise
        finally:
            self.current_call = None

    def response_value(self, label):
        folder = self.calls / label
        for attempt in sorted(folder.glob("attempt-*"), key=lambda p: int(p.name.split("-")[-1]), reverse=True):
            metadata_file = attempt / "response.json"
            if metadata_file.exists():
                record = read_json(metadata_file)
                file = self.root / record["body"]["path"]
                if fingerprint(file) != {key: record["body"][key] for key in ("bytes", "sha256")}:
                    fail("SOURCE_CHANGED", "An original provider response changed.")
                return lossless_json(file.read_bytes())
        fail("RESPONSE_MISSING", "The native response body for " + label + " is unavailable.")


def cost_arguments(plan):
    return {name: value for name, value in plan.items() if name in COST_KEYS}

def decimal_cost(value):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        fail("COST_RESPONSE", "The native cost response is not a finite USD amount.")
    if not result.is_finite() or result < 0:
        fail("COST_RESPONSE", "The native cost response is not a finite nonnegative USD amount.")
    return result

def estimate(args, store):
    plan, key = request_plan(args.request), read_key(args)
    with store.operation(args.id, "estimate", plan, key) as op:
        if op.state["state"] == "COMPLETE":
            return op.summary()
        client = op.client()
        op.call("range", client.metadata.get_dataset_range, dataset=plan["dataset"])
        for label, method in (("count", client.metadata.get_record_count),
                              ("size", client.metadata.get_billable_size),
                              ("cost", client.metadata.get_cost)):
            op.call(label, method, **cost_arguments(plan))
        quote = {
            "currency": "USD",
            "cost": str(decimal_cost(op.response_value("cost"))),
            "recordCount": op.response_value("count"),
            "billableBytes": op.response_value("size"),
            "availableRange": op.response_value("range"),
            "observedAt": utc(),
            "rangeSemantics": "start inclusive, end exclusive; native time filtering uses ts_recv when present, otherwise ts_event",
            "source": "unchanged native metadata endpoints and retained response bodies",
        }
        op.save(state="COMPLETE", quote=quote)
        return op.summary()

def submit(args, store):
    plan, key = request_plan(args.request), read_key(args)
    cap = decimal_cost(args.max_cost_usd)
    with store.operation(args.estimate_id, key=key) as quote_op:
        if quote_op.state["kind"] != "estimate" or quote_op.state["state"] != "COMPLETE":
            fail("ESTIMATE_SELECTION", "Select the completed estimate for this actual account and request.")
        if quote_op.state["requestSha256"] != digest(encoded(plan)):
            fail("ESTIMATE_SELECTION", "The estimate belongs to a different source selection.")
        original_quote = {"operationId": args.estimate_id, "quote": quote_op.state["quote"]}
    request = {"plan": plan, "estimateId": args.estimate_id, "maxCostUsd": str(cap)}
    with store.operation(args.id, "submit", request, key) as op:
        if op.state.get("providerJobId"):
            return op.summary()
        client = op.client()
        # A started mutation is reconciled from its retained acknowledgement first.
        # Never issue a new estimate or a second paid request for that attempt.
        if not list((op.calls / "submit").glob("attempt-*")):
            cost_label = "current-cost-" + uuid.uuid4().hex
            op.call(cost_label, client.metadata.get_cost, **cost_arguments(plan))
            current_cost = decimal_cost(op.response_value(cost_label))
            if current_cost > cap:
                op.save(state="COST_EXCEEDS_SELECTION", currentCostUsd=str(current_cost), maxCostUsd=str(cap))
                fail("COST_EXCEEDS_SELECTION", "The actual native cost exceeds the explicitly selected USD cap.")
            op.save(state="SUBMITTING", originalEstimate=original_quote,
                    currentCostUsd=str(current_cost), maxCostUsd=str(cap),
                    costCall=cost_label, costObservedAt=utc())
        result = op.call("submit", client.batch.submit_job, mutation=True, **plan)
        if not isinstance(result, dict) or not isinstance(result.get("id"), str) or not result["id"]:
            op.save(state="SUBMISSION_UNCERTAIN")
            fail("SUBMISSION_UNCERTAIN", "The native response is retained but does not expose its original job ID. Reconcile the selected job; do not resubmit.")
        op.save(state="SUBMITTED", providerJobId=result["id"],
                providerState=result.get("state"), acknowledgedAt=utc())
        return op.summary()

def job_view(value):
    if not isinstance(value, dict):
        fail("NATIVE_JOB_SHAPE", "The original full job details must be an object.")
    return {name: value[name] for name in (
        "id", "state", "ts_received", "ts_queued", "ts_process_start", "ts_process_done",
        "dataset", "schema", "start", "end", "encoding", "compression",
        "record_count", "cost_usd", "billable_size", "size", "stype_in", "stype_out",
        "symbols", "limit", "split_symbols", "split_duration", "split_size", "map_symbols",
    ) if name in value}

def jobs(args, store):
    key = read_key(args)
    request = {"states": args.states, "since": args.since}
    with store.operation(args.id, "jobs", request, key) as op:
        if op.state["state"] == "COMPLETE":
            return op.summary()
        client = op.client()
        rows = op.call("list", client.batch.list_jobs, states=args.states, since=args.since)
        if not isinstance(rows, list):
            fail("NATIVE_JOB_SHAPE", "The native list_jobs response is not a list.")
        # No short argument: the deprecated selector is not part of this caller.
        views = []
        for row in op.response_value("list"):
            if not isinstance(row, dict) or not isinstance(row.get("id"), str):
                fail("NATIVE_JOB_SHAPE", "A native job row has no original job ID.")
            views.append(job_view(row))
        op.save(state="COMPLETE", jobs=views,
                detailCommand="job --id NEW_READ_ID --job-id THE_ORIGINAL_JOB_ID",
                listSemantics="Compact list retained; full state comes from get_job_details.")
        return op.summary()

def job(args, store):
    key, job_id = read_key(args), ident(args.job_id, "provider job")
    with store.operation(args.id, "job", {"jobId": job_id}, key) as op:
        if op.state["state"] == "COMPLETE":
            return op.summary()
        client = op.client()
        details = op.call("details", client.batch.get_job_details, job_id=job_id)
        if details.get("id") not in {None, job_id}:
            fail("NATIVE_JOB_ID", "The provider returned details for a different job.")
        op.save(state="COMPLETE", providerJobId=job_id, job=job_view(op.response_value("details")))
        return op.summary()

def reconcile(args, store):
    key, job_id = read_key(args), ident(args.job_id, "provider job")
    with store.operation(args.id, key=key) as op:
        if op.state["kind"] != "submit":
            fail("OPERATION_SELECTION", "Reconcile the original submit operation ID.")
        existing = op.state.get("providerJobId")
        if existing and existing != job_id:
            fail("NATIVE_JOB_ID", "The submission already retains another original provider job.")
        client = op.client()
        details = op.call("reconcile-" + job_id, client.batch.get_job_details, job_id=job_id)
        if not isinstance(details, dict) or details.get("id") not in {None, job_id}:
            fail("NATIVE_JOB_ID", "The returned details do not identify the selected original job.")
        plan = op.state["request"]["plan"]
        # Full details remain in custody; inspect exact exposed native selection fields.
        fields = ("dataset", "schema", "encoding", "compression", "stype_in", "stype_out", "start", "end", "symbols", "limit")
        matched, unavailable = [], []
        for name in fields:
            if name not in plan:
                continue
            if name not in details:
                unavailable.append(name)
                continue
            actual, selected = details[name], plan[name]
            if name in {"start", "end"}:
                actual, selected = timestamp_ns(actual), timestamp_ns(selected)
            elif name == "symbols":
                def symbols(value):
                    return sorted(str(item) for item in (value.split(",") if isinstance(value, str) else value if isinstance(value, list) else [value]))
                actual, selected = symbols(actual), symbols(selected)
            elif name == "limit" and actual is not None and selected is not None:
                actual, selected = str(actual), str(selected)
            if actual != selected:
                fail("NATIVE_JOB_SELECTION", "The selected provider job differs in " + name + ".")
            matched.append(name)
        op.save(state="SUBMITTED", providerJobId=job_id, providerState=details.get("state"),
                reconciledAt=utc(), reconciliation={
                    "method": "operator-selected original job; native full details read",
                    "reviewer": args.reviewer,
                    "matchedFields": matched, "unavailableFields": unavailable,
                    "originalSubmissionReplayed": False,
                })
        return op.summary()

def file_manifest(rows):
    if not isinstance(rows, list) or not rows:
        fail("NATIVE_FILE_MANIFEST", "The native job has no retained available file manifest.")
    seen, result = set(), []
    for row in rows:
        if not isinstance(row, dict):
            fail("NATIVE_FILE_MANIFEST", "A provider file entry is not an object.")
        name = row.get("filename")
        if not isinstance(name, str) or not name or name in {".", ".."} or Path(name).name != name or "\\" in name or "\0" in name:
            fail("NATIVE_FILE_PATH", "The provider filename must be one safe local filename.")
        if name in seen:
            fail("NATIVE_FILE_MANIFEST", "The provider manifest repeats a filename.")
        seen.add(name)
        size, checksum = row.get("size"), row.get("hash")
        if isinstance(size, str) and re.fullmatch(r"[0-9]+", size):
            size = int(size)
        if isinstance(size, bool) or not isinstance(size, int) or size < 0 or not isinstance(checksum, str):
            fail("NATIVE_FILE_MANIFEST", "The provider file needs its exact size and hash.")
        algorithm, separator, value = checksum.partition(":")
        if not separator or algorithm not in hashlib.algorithms_available:
            fail("NATIVE_FILE_HASH", "The provider hash algorithm is not supported by the current native Python runtime.")
        try:
            expected_length = hashlib.new(algorithm).digest_size * 2
        except (ValueError, TypeError):
            fail("NATIVE_FILE_HASH", "The provider hash algorithm is invalid.")
        if len(value) != expected_length or not re.fullmatch(r"[0-9a-fA-F]+", value):
            fail("NATIVE_FILE_HASH", "The provider file hash is malformed.")
        result.append({"filename": name, "bytes": size, "providerHash": checksum})
    return result

def file_matches(file, row):
    file = Path(file)
    if not file.is_file() or file.is_symlink() or file.stat().st_size != row["bytes"]:
        return False
    algorithm, _, expected = row["providerHash"].partition(":")
    h = hashlib.new(algorithm)
    with file.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest().lower() == expected.lower()

def receive(args, store):
    key, job_id = read_key(args), ident(args.job_id, "provider job")
    request = {"jobId": job_id, "filenames": sorted(args.filename or [])}
    with store.operation(args.id, "receive", request, key) as op:
        if op.state["state"] == "COMPLETE":
            for row in op.state["files"]:
                if fingerprint(op.root / row["path"]) != {key: row[key] for key in ("bytes", "sha256")}:
                    fail("SOURCE_CHANGED", "The retained completed native file has changed.")
            return op.summary()
        client = op.client()
        # A not-yet-ready manifest is a read snapshot, not the immutable receiving
        # selection. A later invocation may read its same job again until files exist.
        if op.state.get("manifestCall"):
            detail_label, file_label = op.state["detailCall"], op.state["manifestCall"]
        else:
            read_id = uuid.uuid4().hex
            detail_label, file_label = "details-" + read_id, "files-" + read_id
        details = op.call(detail_label, client.batch.get_job_details, job_id=job_id)
        if not isinstance(details, dict) or details.get("id") not in {None, job_id}:
            fail("NATIVE_JOB_ID", "The full details do not identify the selected receiving job.")
        rows = op.call(file_label, client.batch.list_files, job_id=job_id)
        if rows == []:
            op.save(state="WAITING_FILES", providerJobId=job_id, job=job_view(op.response_value(detail_label)))
            fail("NATIVE_FILES_PENDING", "This same provider job has no available files yet. Reopen this receive operation later; no submit is performed.")
        described = file_manifest(rows)
        op.save(detailCall=detail_label, manifestCall=file_label)
        requested = set(args.filename or [row["filename"] for row in described])
        if not requested <= {row["filename"] for row in described}:
            fail("NATIVE_FILE_SELECTION", "A selected filename is absent from the original provider manifest.")
        selected = [row for row in described if row["filename"] in requested]
        op.save(state="RECEIVING", providerJobId=job_id, job=job_view(op.response_value(detail_label)),
                selection=selected, nativeResume="Original SDK per-file Range receiving into the same retained path")
        output = private_directory(op.root / "downloads")
        # Native download internally asks for the same list. Reuse the exact retained
        # response for this one private client and completed job, not another API request.
        original_list = client.batch.list_files
        client.batch.list_files = lambda selected_job: rows if selected_job == job_id else original_list(selected_job)
        completed = []
        try:
            for row in selected:
                destination = output / job_id / row["filename"]
                if destination.exists() and destination.stat().st_size == row["bytes"] and not file_matches(destination, row):
                    fail("NATIVE_FILE_HASH", "The complete-size retained file has a wrong digest. Preserve it and select a new receive operation for this same job; no paid job is resubmitted.")
                with warnings.catch_warnings(record=True) as caught:
                    warnings.simplefilter("always")
                    client.batch.download(job_id=job_id, output_dir=output,
                                          filename_to_download=row["filename"], keep_zip=False)
                if not file_matches(destination, row):
                    fail("NATIVE_FILE_INCOMPLETE", "The native receive has not produced the exact manifest size and digest; its partial bytes remain for the same-job continuation.")
                completed.append({**row, "path": str(destination.relative_to(op.root)),
                                  **fingerprint(destination),
                                  "nativeWarnings": [clean(str(item.message), (key,)) for item in caught]})
                op.save(completedFiles=completed)
        finally:
            client.batch.list_files = original_list
        op.save(state="COMPLETE", files=completed, completedAt=utc())
        return op.summary()

def resolve_symbols(args, store):
    key = read_key(args)
    request = read_json(args.request)
    allowed = {"dataset", "symbols", "stype_in", "stype_out", "start_date", "end_date"}
    if not isinstance(request, dict) or set(request) - allowed or any(
        request.get(name) is None for name in allowed
    ):
        fail("SYMBOLOGY_SELECTION", "Supply the native dataset, symbols, symbology types and explicit inclusive/exclusive UTC dates.")
    with store.operation(args.id, "symbology", request, key) as op:
        if op.state["state"] == "COMPLETE":
            return op.summary()
        client = op.client()
        op.call("resolve", client.symbology.resolve, **request)
        result = op.response_value("resolve")
        write_json(op.root / "symbology.json", result)
        op.save(state="COMPLETE", symbology={"path": "symbology.json", **fingerprint(op.root / "symbology.json")},
                rangeSemantics="UTC start_date inclusive, end_date exclusive")
        return op.summary()



# Source preparation uses the same explicit CSV/DBN representations as CORE_CONTRACT.
# Binary custody is independent of the original native workspace's file/revision caps.
SOURCE_KEYS = {
    "id", "format", "kind", "role", "dataset", "schema", "encoding", "representation",
    "completeness", "corpus", "capturedAt", "compression",
}
KINDS = {"records", "dbn-metadata", "symbology", "batch-list", "batch-details"}
ISO_NS = re.compile(
    r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$"
)

def safe_url(value):
    if not value:
        return value
    parts = urlsplit(value)
    if parts.scheme not in {"https", "http"} or not parts.hostname or parts.username or parts.password:
        fail("SOURCE_URL", "Use the original public source URL without embedded credentials.")
    private_names = {"token", "key", "api_key", "apikey", "access_token", "signature", "sig",
                     "authorization", "credential", "x-amz-credential", "x-amz-signature"}
    if any(name.lower() in private_names for name, _ in parse_qsl(parts.query, keep_blank_values=True)):
        fail("SOURCE_URL", "Authenticated URL parameters belong in private acquisition custody.")
    return urlunsplit(parts)

def descriptor_input(path):
    source = read_json(path)
    if not isinstance(source, dict):
        fail("SOURCE_DESCRIPTOR", "Provide the original core source descriptor.")
    # Existing core descriptors may contain a path/hash; retain() binds the actual bytes anew.
    unknown = set(source) - SOURCE_KEYS - {"path", "sha256", "bytes"}
    if unknown:
        fail("SOURCE_DESCRIPTOR", "Unsupported source descriptor fields: " + ", ".join(sorted(unknown)))
    value = {key: source[key] for key in SOURCE_KEYS if key in source}
    ident(value.get("id"), "source")
    if value.get("format") not in FORMATS or value.get("kind", "records") not in KINDS:
        fail("SOURCE_DESCRIPTOR", "Use core format csv/dbn-jsonl/json and the actual documented source kind.")
    value.setdefault("kind", "records")
    value.setdefault("role", "primary" if value["kind"] == "records" else "reference")
    if value["role"] not in {"primary", "reference"}:
        fail("SOURCE_DESCRIPTOR", "Source role must be primary or reference.")
    if value.get("compression") not in {None, "gzip"}:
        fail("SOURCE_COMPRESSION", "Portable core inputs support original plain bytes or gzip.")
    representation = value.setdefault("representation", {})
    if not isinstance(representation, dict):
        fail("SOURCE_DESCRIPTOR", "representation must be the original source metadata object.")
    if representation.get("sourceUrl"):
        representation["sourceUrl"] = safe_url(representation["sourceUrl"])
    if value.get("kind") == "records":
        encoding = value.get("encoding", {})
        if encoding.get("prices") not in {"decimal-fixed9", "integer-nanos"} or encoding.get("timestamps") not in {"iso8601-nanoseconds", "integer-nanos"}:
            fail("SOURCE_ENCODING", "Declare original prices decimal-fixed9/integer-nanos and timestamps iso8601-nanoseconds/integer-nanos.")
    completeness = value.setdefault("completeness", {"status": "unknown"})
    if completeness.get("status") not in {"complete-response", "complete-partition", "partial", "unknown"}:
        fail("SOURCE_COMPLETENESS", "Retain the explicit original completeness status.")
    return value

def source_file(path):
    file = Path(path).absolute()
    if not file.is_file() or file.is_symlink():
        fail("SOURCE_FILE", "Select an existing regular original source file.")
    return file

def copy_original(source, target, expected=None):
    source, target = source_file(source), Path(target)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if target.exists():
        if expected and fingerprint(target) == expected and not target.is_symlink():
            return expected
        fail("RETAINED_CONFLICT", "The retained source destination already exists.")
    temporary = target.with_name("." + target.name + "." + uuid.uuid4().hex + ".part")
    h, size = hashlib.sha256(), 0
    try:
        with source.open("rb") as src, temporary.open("xb") as dst:
            os.chmod(temporary, 0o600)
            while chunk := src.read(1024 * 1024):
                dst.write(chunk)
                h.update(chunk)
                size += len(chunk)
            dst.flush()
            os.fsync(dst.fileno())
        actual = {"bytes": size, "sha256": h.hexdigest()}
        if expected is not None and actual != expected:
            fail("SOURCE_CHANGED", "The original source changed while receiving its retained copy.")
        os.link(temporary, target)
        sync_dir(target.parent)
        return actual
    finally:
        if temporary.exists():
            temporary.unlink()

@contextlib.contextmanager
def decoded_stream(path):
    with Path(path).open("rb") as raw:
        magic = raw.read(4)
        raw.seek(0)
        if magic[:2] == b"\x1f\x8b":
            with gzip.GzipFile(fileobj=raw, mode="rb") as stream:
                yield stream
        elif magic == b"\x28\xb5\x2f\xfd":
            try:
                import zstandard
            except ImportError:
                fail("NATIVE_COMPRESSION", "Use the original SDK runtime's zstandard decoder for this native zstd file.")
            with zstandard.ZstdDecompressor().stream_reader(raw, closefd=False, read_across_frames=True) as stream:
                yield stream
        else:
            yield raw

def timestamp_ns(value):
    if not isinstance(value, str):
        fail("PARTITION_TIME", "The exact partition timestamp must remain a string.")
    if re.fullmatch(r"\d+", value):
        result = int(value)
        if result >= 18446744073709551615:
            fail("PARTITION_TIME", "An undefined timestamp cannot establish membership in a complete partition.")
        return result
    match = ISO_NS.fullmatch(value)
    if not match:
        fail("PARTITION_TIME", "Use an original integer-nanosecond or explicit-zone ISO nanosecond timestamp.")
    date, time, fraction, zone = match.groups()
    parsed = dt.datetime.fromisoformat(date + "T" + time + ("+00:00" if zone == "Z" else zone))
    delta = parsed.astimezone(dt.timezone.utc) - dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
    return (delta.days * 86400 + delta.seconds) * 1_000_000_000 + int((fraction or "").ljust(9, "0") or "0")

class RecordingLines:
    def __init__(self, stream):
        self.stream = stream
        self.current = []
        self.hash = hashlib.sha256()
        self.bytes = 0

    def __iter__(self):
        return self

    def __next__(self):
        line = next(self.stream)
        body = line.encode("utf-8")
        self.current.append(body)
        self.hash.update(body)
        self.bytes += len(body)
        return line

    def take(self):
        result = b"".join(self.current)
        self.current.clear()
        return result

def scan_records(file, format_name, *, destination=None, time_field=None, start=None, end=None):
    """Stream every input row; destination retains exact selected UTF-8 CSV/JSONL bytes."""
    if format_name not in {"csv", "dbn-jsonl"}:
        fail("SOURCE_FORMAT", "Only CSV and original DBN JSONL are record streams.")
    if (start is None) != (end is None):
        fail("PARTITION_SELECTION", "A complete natural partition needs both start and end.")
    lower, upper = (timestamp_ns(start), timestamp_ns(end)) if start is not None else (None, None)
    if lower is not None and (lower >= upper or time_field not in {"ts_recv", "ts_event"}):
        fail("PARTITION_SELECTION", "Use an increasing half-open time interval and native ts_recv or ts_event field.")
    total = selected = 0
    first = last = None
    selected_runs = []
    with decoded_stream(file) as binary:
        with io.TextIOWrapper(binary, encoding="utf-8", errors="strict", newline="") as text:
            lines = RecordingLines(text)
            if format_name == "csv":
                parser = csv.reader(lines)
                try:
                    header = next(parser)
                except StopIteration:
                    fail("SOURCE_CSV", "The original CSV has no header.")
                header_bytes = lines.take()
                names = [name.lstrip("\ufeff") if index == 0 else name for index, name in enumerate(header)]
                if len(set(names)) != len(names) or not names:
                    fail("SOURCE_CSV", "Original header names must uniquely identify each field.")
                if destination is not None:
                    destination.write(header_bytes)
                iterator = parser
            else:
                names = None
                iterator = lines
            for item in iterator:
                raw = lines.take()
                if format_name == "csv":
                    if not item:
                        # CSV physical blank lines have no logical records and remain in the corpus hash.
                        continue
                    if len(item) != len(names):
                        fail("SOURCE_CSV", "A CSV record differs from the original header's field count.")
                    record = dict(zip(names, item))
                else:
                    if not item.strip():
                        continue
                    record = lossless_json(item)
                    if not isinstance(record, dict):
                        fail("SOURCE_JSONL", "Each original DBN projection record must be an object.")
                total += 1
                include = True
                if lower is not None:
                    value = record.get(time_field)
                    if value is None and time_field == "ts_event":
                        value = record.get("hd", {}).get("ts_event")
                    instant = timestamp_ns(value)
                    include = lower <= instant < upper
                if include:
                    selected += 1
                    if first is None:
                        first = total
                    if last is None or total != last + 1:
                        selected_runs.append([total, total])
                    else:
                        selected_runs[-1][1] = total
                    last = total
                    if destination is not None:
                        destination.write(raw)
            return {
                "corpus": {"bytes": lines.bytes, "sha256": lines.hash.hexdigest(), "records": total},
                "records": selected, "firstSourceRecord": first, "lastSourceRecord": last,
                "contiguous": len(selected_runs) <= 1, "sourceRecordRuns": selected_runs,
            }

def bind_source(op, file, descriptor):
    with Path(file).open("rb") as stream:
        magic = stream.read(4)
    if (descriptor.get("compression") == "gzip") != (magic[:2] == b"\x1f\x8b"):
        fail("SOURCE_COMPRESSION", "The descriptor must identify the actual gzip or plain captured bytes.")
    if magic == b"\x28\xb5\x2f\xfd":
        fail("SOURCE_COMPRESSION", "Use decode for original DBN/zstd, or partition to preserve a complete CSV/JSONL interval as plain or gzip.")
    exact = fingerprint(file)
    extension = ".csv" if descriptor["format"] == "csv" else ".ndjson" if descriptor["format"] == "dbn-jsonl" else ".json"
    if descriptor.get("compression") == "gzip":
        extension += ".gz"
    relative = "captures/" + exact["sha256"] + extension
    destination = op.root / relative
    if Path(file).absolute() != destination.absolute():
        copy_original(file, destination, exact)
    return {**descriptor, "path": relative, **exact}

def retain(args, store):
    source, descriptor = source_file(args.source), descriptor_input(args.descriptor)
    original = fingerprint(source)
    origin = source_origin(store, args.from_id, source, original)
    if origin:
        descriptor.setdefault("representation", {})["acquisition"] = origin
    request = {"source": str(source), "original": original, "descriptor": descriptor}
    with store.operation(args.id, "retain", request) as op:
        if op.state["state"] == "COMPLETE":
            verify_sources(op)
            return op.summary()
        if descriptor["kind"] == "records":
            scan = scan_records(source, descriptor["format"])
            stated = descriptor["completeness"].get("records")
            if stated is not None and str(stated) != str(scan["records"]):
                fail("SOURCE_COUNT", "The complete source row count differs from its descriptor.")
            descriptor["completeness"]["records"] = scan["records"]
            if not descriptor.get("corpus"):
                descriptor["corpus"] = {"id": descriptor["id"] + "-corpus", **scan["corpus"]}
        index = descriptor.get("corpus", {}).get("index")
        if index:
            base = Path(args.input_root).absolute() if args.input_root else Path(args.descriptor).absolute().parent
            linked = retained_path(base, index)
            copy_original(linked, op.root / index["path"], identity(index))
        bound = bind_source(op, source, descriptor)
        op.save(state="COMPLETE", sources=[bound], sourceOrigin=origin, completedAt=utc())
        return op.summary()

def partition(args, store):
    source, descriptor = source_file(args.source), descriptor_input(args.descriptor)
    if descriptor["format"] not in {"csv", "dbn-jsonl"} or descriptor["kind"] != "records":
        fail("PARTITION_FORMAT", "Partition an original CSV or DBN JSONL record source.")
    original = fingerprint(source)
    origin = source_origin(store, args.from_id, source, original)
    if origin:
        descriptor.setdefault("representation", {})["acquisition"] = origin
    request = {"source": str(source), "original": original, "descriptor": descriptor,
               "timeField": args.time_field, "start": args.start, "end": args.end,
               "gzip": args.gzip, "maxFileBytes": args.max_file_bytes}
    with store.operation(args.id, "partition", request) as op:
        if op.state["state"] == "COMPLETE":
            verify_sources(op)
            return op.summary()
        temporary = op.root / ("partition-" + uuid.uuid4().hex + ".part")
        try:
            with temporary.open("xb") as raw:
                os.chmod(temporary, 0o600)
                if args.gzip:
                    with gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as target:
                        scanned = scan_records(source, descriptor["format"], destination=target,
                                               time_field=args.time_field, start=args.start, end=args.end)
                else:
                    scanned = scan_records(source, descriptor["format"], destination=raw,
                                           time_field=args.time_field, start=args.start, end=args.end)
                raw.flush()
                os.fsync(raw.fileno())
            if args.max_file_bytes and temporary.stat().st_size > args.max_file_bytes:
                fail("PARTITION_SIZE", "The complete selected partition exceeds the chosen file size. Select an actual smaller interval or gzip; no records were clipped.")
            descriptor.pop("compression", None)
            if args.gzip:
                descriptor["compression"] = "gzip"
            selected_hash, selected_bytes = hashlib.sha256(), 0
            with decoded_stream(temporary) as selected_stream:
                while chunk := selected_stream.read(1024 * 1024):
                    selected_hash.update(chunk)
                    selected_bytes += len(chunk)
            descriptor["corpus"] = {
                "id": descriptor.get("corpus", {}).get("id", descriptor["id"] + "-corpus"),
                **scanned["corpus"],
                "partition": {"bytes": selected_bytes, "sha256": selected_hash.hexdigest(),
                              "records": scanned["records"]},
            }
            descriptor["completeness"] = {
                "status": "complete-partition", "records": scanned["records"], "field": args.time_field,
                "start": args.start, "end": args.end, "completeWithinCorpus": True,
                "firstSourceRecord": scanned["firstSourceRecord"], "lastSourceRecord": scanned["lastSourceRecord"],
                "contiguous": scanned["contiguous"],
            }
            # Large fragmented interval indexes stay separate from the compact source descriptor.
            index = {"schema": "tj.databento-partition-index.v1", "sourceId": descriptor["id"],
                     "corpus": descriptor["corpus"], "recordRuns": scanned["sourceRecordRuns"],
                     "records": scanned["records"], "completeWithinCorpus": True}
            write_json(op.root / "partition-index.json", index)
            index_source = bind_source(op, op.root / "partition-index.json", {
                "id": descriptor["id"] + "-index", "format": "json", "kind": "dbn-metadata",
                "role": "reference", "representation": {"sourceKind": "complete-partition-row-index"},
                "completeness": {"status": "complete-response"}, "corpus": descriptor["corpus"],
            })
            descriptor["corpus"]["index"] = {key: index_source[key] for key in ("path", "bytes", "sha256")}
            bound = bind_source(op, temporary, descriptor)
            op.save(state="COMPLETE", sources=[bound, index_source], sourceOrigin=origin,
                    completeSelectedRecords=scanned["records"], completedAt=utc())
            return op.summary()
        finally:
            if temporary.exists():
                temporary.unlink()

def native_plain(value):
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, enum.Enum):
        return native_plain(value.value)
    if isinstance(value, int):
        return str(value) if abs(value) > 9007199254740991 else value
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): native_plain(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [native_plain(item) for item in value]
    if all(hasattr(value, name) for name in ("start_date", "end_date", "symbol")):
        return {name: native_plain(getattr(value, name)) for name in ("start_date", "end_date", "symbol")}
    # Native string enums are not necessarily Python enum.Enum subclasses.
    if type(value).__name__ in {"SType", "Schema", "Compression", "Encoding", "VersionUpgradePolicy"}:
        return str(value)
    fail("NATIVE_METADATA", "Unrecognized original metadata type: " + type(value).__name__)

def decode(args, store):
    source = source_file(args.source)
    request = {"source": str(source), "original": fingerprint(source), "mapSymbols": False,
               "prettyPrices": False, "prettyTimestamps": False, "upgradePolicy": "AS_IS"}
    origin = source_origin(store, args.from_id, source, request["original"])
    if origin:
        request["acquisition"] = origin
    with store.operation(args.id, "decode", request) as op:
        if op.state["state"] == "COMPLETE":
            verify_sources(op)
            return op.summary()
        # Use original native codecs, not a handwritten DBN decoder or an upgraded record layout.
        versions = native_versions()
        import databento_dbn as dbn
        temporary = op.root / ("projection-" + uuid.uuid4().hex + ".part")
        metadata, records = None, 0
        types = {}
        try:
            with temporary.open("xb") as target:
                os.chmod(temporary, 0o600)
                transcoder = dbn.Transcoder(target, encoding=dbn.Encoding.JSON,
                    compression=dbn.Compression.NONE, pretty_px=False, pretty_ts=False,
                    map_symbols=False, upgrade_policy=dbn.VersionUpgradePolicy.AS_IS)
                decoder = dbn.DBNDecoder(upgrade_policy=dbn.VersionUpgradePolicy.AS_IS)
                with decoded_stream(source) as stream:
                    while chunk := stream.read(65536):
                        transcoder.write(chunk)
                        for record in decoder.write_and_decode(chunk):
                            if isinstance(record, dbn.Metadata):
                                if metadata is not None:
                                    fail("DBN_METADATA", "The original DBN contains repeated metadata.")
                                metadata = {name: native_plain(getattr(record, name)) for name in (
                                    "version", "dataset", "schema", "start", "end", "limit",
                                    "stype_in", "stype_out", "symbols", "partial", "not_found", "mappings",
                                )}
                            else:
                                records += 1
                                name = type(record).__name__
                                types[name] = types.get(name, 0) + 1
                transcoder.flush()
                if transcoder.buffer() or decoder.buffer():
                    fail("DBN_INCOMPLETE", "The original AS_IS decoder retained an incomplete record; the projection is not complete.")
                target.flush()
                os.fsync(target.fileno())
            if metadata is None:
                fail("DBN_METADATA", "The original DBN has no complete metadata header.")
            projected = scan_records(temporary, "dbn-jsonl")
            if projected["records"] != records:
                fail("DBN_PROJECTION", "Native projected rows differ from native decoded record count.")
            original = request["original"]
            provenance = {
                "schema": "tj.databento-original-dbn-projection.v1", "capturedAt": utc(),
                "originalDBN": original, "nativeVersions": versions,
                "decoder": "original databento_dbn.Transcoder and DBNDecoder",
                "upgradePolicy": "AS_IS", "prettyPrices": False, "prettyTimestamps": False,
                "mapSymbols": False, "completeDecoderBuffer": True,
                "metadata": metadata, "recordTypes": types, "records": records,
                "projection": fingerprint(temporary),
            }
            write_json(op.root / "dbn-metadata.json", provenance)
            corpus = {"id": args.id + "-original-dbn", **original, "records": records}
            descriptor = {
                "id": args.id + "-records", "format": "dbn-jsonl", "kind": "records", "role": "primary",
                "dataset": metadata["dataset"], "schema": metadata["schema"],
                "encoding": {"prices": "integer-nanos", "timestamps": "integer-nanos"},
                "representation": {"sourceKind": "native-dbn-jsonl-projection", "originalDBN": original,
                                   "dbnVersion": metadata["version"], "upgradePolicy": "AS_IS",
                                   "mapSymbols": False, "nativeVersions": versions, **({"acquisition": origin} if origin else {})},
                "completeness": {"status": "complete-response", "records": records,
                                 "providerLimit": metadata["limit"], "providerPartial": metadata["partial"],
                                 "providerNotFound": metadata["not_found"]},
                "corpus": corpus,
            }
            rows = [bind_source(op, temporary, descriptor),
                    bind_source(op, op.root / "dbn-metadata.json", {
                        "id": args.id + "-metadata", "format": "json", "kind": "dbn-metadata",
                        "role": "reference", "dataset": metadata["dataset"], "schema": metadata["schema"],
                        "representation": {"sourceKind": "original-native-dbn-metadata", "originalDBN": original,
                                           "dbnVersion": metadata["version"], "upgradePolicy": "AS_IS"},
                        "completeness": {"status": "complete-response"}, "corpus": corpus,
                    })]
            op.save(state="COMPLETE", sources=rows, sourceOrigin=origin, nativeVersions=versions, decodedRecords=records, completedAt=utc())
            return op.summary()
        finally:
            if temporary.exists():
                temporary.unlink()

def identity(value):
    size, sha = value.get("bytes"), value.get("sha256")
    if isinstance(size, bool) or not isinstance(size, int) or size < 0 or not isinstance(sha, str) or not SHA.fullmatch(sha):
        fail("SOURCE_IDENTITY", "Every retained source needs its original nonnegative byte count and SHA256.")
    return {"bytes": size, "sha256": sha}

def source_origin(store, operation_id, file, exact):
    if not operation_id:
        return None
    with store.operation(operation_id) as original:
        if original.state["state"] != "COMPLETE":
            fail("SOURCE_ORIGIN", "Select a completed original receiving or source operation.")
        verify_sources(original)
        candidates = original.state.get("files", []) + original.state.get("sources", [])
        matches = [row for row in candidates if identity(row) == exact]
        if not matches:
            fail("SOURCE_ORIGIN", "The selected file is absent from that original operation's completed bytes.")
        return {
            "operationId": operation_id, "kind": original.state["kind"],
            "providerJobId": original.state.get("providerJobId"),
            "gateway": original.state.get("gateway"), "resolvedGateway": original.state.get("resolvedGateway"),
            "job": original.state.get("job"), "nativeVersions": original.state.get("nativeVersions"),
            "file": {key: matches[0][key] for key in ("path", "bytes", "sha256")},
            "parent": original.state.get("sourceOrigin"),
        }

def retained_path(root, descriptor):
    relative = descriptor.get("path")
    if not isinstance(relative, str) or not relative or "\x00" in relative:
        fail("SOURCE_PATH", "A retained source needs its exact relative path.")
    path = Path(relative)
    if path.is_absolute() or any(part in {".", ".."} for part in path.parts) or "\\" in relative:
        fail("SOURCE_PATH", "Retained file paths must stay inside their selected root.")
    root = Path(root).absolute()
    target = root / path
    current = root
    for part in path.parts:
        current = current / part
        if current.is_symlink():
            fail("SOURCE_PATH", "A retained input cannot traverse a symbolic link.")
    if not target.is_file():
        fail("SOURCE_MISSING", "Retained file is absent: " + relative)
    if fingerprint(target) != identity(descriptor):
        fail("SOURCE_CHANGED", "Retained bytes differ from the original identity: " + relative)
    return target

def source_closure(sources):
    result = {}
    for source in sources:
        for row in (source, source.get("corpus", {}).get("index")):
            if row is None:
                continue
            relative = row.get("path")
            exact = identity(row)
            if relative in result and identity(result[relative]) != exact:
                fail("SOURCE_IDENTITY", "Two source descriptors disagree about the same retained path.")
            result[relative] = {"path": relative, **exact}
    return list(result.values())

def verify_sources(op):
    sources = op.state.get("sources", [])
    for row in source_closure(sources):
        retained_path(op.root, row)
    for row in op.state.get("files", []):
        retained_path(op.root, row)
    symbology = op.state.get("symbology")
    if symbology:
        retained_path(op.root, symbology)
    return sources

def response_index(op):
    result = []
    for metadata_file in sorted(op.calls.glob("*/attempt-*/response.json")):
        record = read_json(metadata_file)
        body = record["body"]
        retained_path(op.root, body)
        result.append({
            "call": metadata_file.parent.parent.name,
            "attempt": int(metadata_file.parent.name.split("-")[-1]),
            "capturedAt": record["capturedAt"], "httpStatus": record["httpStatus"],
            "original": identity(body), "originalWireBytes": record["originalWireBytes"],
            "captureMethod": record["captureMethod"],
        })
    return result

def short_source_id(operation_id, suffix):
    value = operation_id + "-" + suffix
    if len(value) > 128:
        value = operation_id[:90] + "-" + digest(value.encode())[:20] + "-" + suffix[:15]
    return ident(value, "source")

def portable_sources(op):
    if op.state.get("sources"):
        verify_sources(op)
        return op.state["sources"]
    if op.state["state"] != "COMPLETE":
        fail("SOURCE_OPERATION", "Only a completed retained acquisition can enter a source handoff.")
    kind = op.state["kind"]
    if kind == "jobs":
        body, source_kind, origin = op.state["jobs"], "batch-list", "native-selected-batch-list"
    elif kind == "job":
        body, source_kind, origin = op.state["job"], "batch-details", "native-selected-batch-details"
    elif kind == "symbology":
        body = read_json(retained_path(op.root, op.state["symbology"]))
        source_kind, origin = "symbology", "native-resolved-symbology"
    else:
        fail("SOURCE_OPERATION", "Select retain, partition, decode, symbology, jobs or job operations. A received binary file must first be decoded or explicitly retained.")
    # The full HTTP bodies/headers remain in private calls/. These selected fields
    # contain no account token, authenticated download URL or native account binding.
    body = clean(body, (op.key,))
    file = op.root / "source-projection.json"
    write_json(file, body)
    descriptor = {
        "id": short_source_id(op.state["id"], "metadata"), "format": "json",
        "kind": source_kind, "role": "reference",
        "capturedAt": op.state.get("completedAt", op.state["updatedAt"]),
        "representation": {
            "sourceKind": origin, "gateway": op.state.get("resolvedGateway"),
            "nativeVersions": op.state.get("nativeVersions"), "originalResponses": response_index(op),
            "projection": "Selected original fields; original JSON number lexemes remain strings.",
        },
        "completeness": {"status": "complete-response"},
    }
    if kind == "symbology":
        descriptor["dataset"] = op.state["request"]["dataset"]
    elif kind == "job" and body.get("dataset"):
        descriptor["dataset"] = body["dataset"]
        descriptor["schema"] = body.get("schema")
    sources = [bind_source(op, file, descriptor)]
    op.save(sources=sources)
    return sources

def packet_selection(path):
    raw = read_json(path)
    if not isinstance(raw, dict) or set(raw) - {"title", "selectedEdition", "editions", "reviews", "outputColumns"}:
        fail("PACKET_SELECTION", "Use title, selectedEdition, editions, reviews and outputColumns in the explicit packet selection.")
    editions = raw.get("editions")
    if not isinstance(editions, list) or not editions:
        fail("PACKET_SELECTION", "Select at least one original source edition.")
    seen = set()
    for edition in editions:
        allowed = {"id", "label", "capturedAt", "role", "scope", "sourceOperations", "compareToEditionId"}
        if not isinstance(edition, dict) or set(edition) - allowed:
            fail("PACKET_SELECTION", "Use the original edition metadata plus explicit sourceOperations.")
        name = ident(edition.get("id"), "edition")
        if name in seen:
            fail("PACKET_SELECTION", "Edition IDs must be distinct.")
        seen.add(name)
        if edition.get("role") not in {"reference", "baseline", "preview"}:
            fail("PACKET_SELECTION", "Each edition needs its actual reference, baseline or preview role.")
        if not isinstance(edition.get("scope"), dict) or not edition.get("label") or not edition.get("capturedAt"):
            fail("PACKET_SELECTION", "Retain each edition's original label, capture time and scope.")
        operations = edition.get("sourceOperations")
        if not isinstance(operations, list) or not operations or len(set(operations)) != len(operations):
            fail("PACKET_SELECTION", "Select distinct completed source operation IDs for each edition.")
        for operation_id in operations:
            ident(operation_id)
    if raw.get("selectedEdition") not in seen:
        fail("PACKET_SELECTION", "selectedEdition must identify one of the retained editions.")
    for edition in editions:
        if edition.get("compareToEditionId") is not None and edition["compareToEditionId"] not in seen:
            fail("PACKET_SELECTION", "The comparison edition must be included in this same source packet.")
    for name in ("reviews", "outputColumns"):
        if name in raw and not isinstance(raw[name], list):
            fail("PACKET_SELECTION", name + " must be the original core array.")
    return raw

def verify_packet(directory):
    directory = Path(directory).absolute()
    if not directory.is_dir() or directory.is_symlink():
        fail("PACKET_DIRECTORY", "Select the complete retained source packet directory.")
    manifest_file = source_file(directory / "manifest.json")
    manifest = read_json(manifest_file)
    if manifest.get("schema") != HANDOFF or manifest.get("complete") is not True:
        fail("PACKET_MANIFEST", "The selected directory is not a completed original acquisition handoff.")
    seen = set()
    for row in manifest.get("files", []):
        if row["path"] in seen:
            fail("PACKET_MANIFEST", "The completed packet repeats a file path.")
        seen.add(row["path"])
        retained_path(directory, row)
    if not {"workspace.json", "acquisition.json"} <= seen:
        fail("PACKET_MANIFEST", "The complete source packet needs its workspace and acquisition index.")
    workspace = read_json(directory / "workspace.json")
    if workspace.get("schema") != "tj.databento-migration-workspace.v1":
        fail("PACKET_WORKSPACE", "The packet does not retain the original core workspace schema.")
    if fingerprint(directory / "workspace.json")["sha256"] != manifest.get("workspaceSha256"):
        fail("PACKET_MANIFEST", "The workspace differs from the original completed packet.")
    sources = [source for edition in workspace["editions"] for source in edition["sources"]]
    for row in source_closure(sources):
        if row["path"] not in seen:
            fail("PACKET_MANIFEST", "An original source is outside the completed file manifest.")
        retained_path(directory, row)
    return {"directory": str(directory), **manifest}

def export_packet(args, store):
    selection = packet_selection(args.selection)
    target = Path(args.out).absolute()
    request = {"selection": selection, "output": str(target)}
    with store.operation(args.id, "export", request) as op:
        if target.exists():
            actual = verify_packet(target)
            if actual["operationId"] != args.id or actual["selectionSha256"] != digest(encoded(selection)):
                fail("PACKET_EXISTS", "The output already belongs to another retained source selection.")
            op.save(state="COMPLETE", output=str(target), manifestSha256=fingerprint(target / "manifest.json")["sha256"])
            return actual
        target.parent.mkdir(parents=True, exist_ok=True)
        staging = target.with_name("." + target.name + "." + args.id + ".partial")
        if staging.is_symlink():
            fail("PACKET_DIRECTORY", "The owned staging directory cannot be a symbolic link.")
        staging = private_directory(staging)
        write_json(staging / "owner.json", {"operationId": args.id, "requestSha256": op.state["requestSha256"]})
        op.save(state="EXPORTING", output=str(target), staging=str(staging))
        editions, operation_index, files = [], {}, {}
        for selected in selection["editions"]:
            sources, source_ids = [], set()
            for operation_id in selected["sourceOperations"]:
                if operation_id == args.id:
                    fail("PACKET_SELECTION", "The export operation is not a source acquisition.")
                with store.operation(operation_id) as source_op:
                    rows = portable_sources(source_op)
                    for row in source_closure(rows):
                        original = retained_path(source_op.root, row)
                        copy_original(original, staging / row["path"], identity(row))
                        files[row["path"]] = row
                    for row in rows:
                        if row["id"] in source_ids:
                            fail("SOURCE_ID", "An edition repeats a source ID; select its original operation once.")
                        source_ids.add(row["id"])
                        sources.append(row)
                    operation_index[operation_id] = {
                        "id": operation_id, "kind": source_op.state["kind"],
                        "createdAt": source_op.state["createdAt"],
                        "completedAt": source_op.state.get("completedAt", source_op.state["updatedAt"]),
                        "gateway": source_op.state.get("gateway"),
                        "resolvedGateway": source_op.state.get("resolvedGateway"),
                        "sourceIds": [row["id"] for row in rows],
                        "sourceOrigin": source_op.state.get("sourceOrigin"),
                        "responses": response_index(source_op),
                    }
            edition = {key: value for key, value in selected.items() if key != "sourceOperations"}
            edition["sources"] = sources
            editions.append(edition)
        workspace = {
            "schema": "tj.databento-migration-workspace.v1", "title": selection.get("title", "Databento migration"),
            "selectedEdition": selection["selectedEdition"], "editions": editions,
            "reviews": selection.get("reviews", []), "outputColumns": selection.get("outputColumns", []),
        }
        write_json(staging / "workspace.json", workspace)
        write_json(staging / "acquisition.json", {
            "schema": "tj.databento-acquisition-index.v1", "operationId": args.id,
            "createdAt": op.state["createdAt"], "sourceOperations": list(operation_index.values()),
            "custody": "Raw HTTP bodies, headers, authenticated URLs, credentials and full private acquisition state are retained separately.",
        })
        for name in ("workspace.json", "acquisition.json"):
            files[name] = {"path": name, **fingerprint(staging / name)}
        manifest = {
            "schema": HANDOFF, "complete": True, "operationId": args.id,
            "selectionSha256": digest(encoded(selection)), "createdAt": op.state["createdAt"],
            "workspaceSha256": files["workspace.json"]["sha256"],
            "editionIds": [edition["id"] for edition in editions],
            "sourceFiles": len([name for name in files if name.startswith("captures/")]),
            "sourceBytes": sum(row["bytes"] for name, row in files.items() if name.startswith("captures/")),
            "files": [files[name] for name in sorted(files)],
        }
        write_json(staging / "manifest.json", manifest)
        verify_packet(staging)
        (staging / "owner.json").unlink()
        sync_dir(staging)
        if target.exists():
            fail("PACKET_EXISTS", "The create-only output was created by another writer; retain this completed staging packet.")
        os.rename(staging, target)
        sync_dir(target.parent)
        op.save(state="COMPLETE", output=str(target), manifestSha256=fingerprint(target / "manifest.json")["sha256"],
                completedAt=utc(), exportedSources=manifest["sourceFiles"])
        return {"directory": str(target), **manifest}

def reopen(args, store=None):
    if args.packet:
        return verify_packet(args.packet)
    with store.operation(args.id) as op:
        sources = verify_sources(op)
        responses = response_index(op)
        if op.state["kind"] == "export" and op.state.get("output") and Path(op.state["output"]).exists():
            packet = verify_packet(op.state["output"])
        else:
            packet = None
        return {"operation": op.summary(), "verifiedSourceFiles": len(source_closure(sources)),
                "verifiedResponses": len(responses), "packet": packet, "providerCalls": 0}

def parser():
    cli = argparse.ArgumentParser(
        description="Original Databento0.87 acquisition, exact same-job receiving and complete source handoffs.")
    cli.add_argument("--store", help="Private retained operation directory, independent of a merchant workspace.")
    cli.add_argument("--gateway", help="Original SDK historical gateway; omit for its default. Preview: hist-preview.databento.com.")
    credential = cli.add_mutually_exclusive_group()
    credential.add_argument("--key-env", default="DATABENTO_API_KEY", help="Name of the existing key environment variable.")
    credential.add_argument("--key-file", help="Existing private mode0600 key file; the value is never a command argument.")
    commands = cli.add_subparsers(dest="command", required=True)
    def command(name, description, function, operation=True):
        child = commands.add_parser(name, help=description, description=description)
        if operation:
            child.add_argument("--id", required=True, help="Retained operation ID; repeats keep the same selection.")
        child.set_defaults(handler=function)
        return child
    current = command("estimate", "Retain the native range, record count, billable size and exact USD cost.", estimate)
    current.add_argument("--request", required=True)
    current = command("submit", "Submit the explicitly selected native request once after a fresh cost-cap check.", submit)
    current.add_argument("--request", required=True)
    current.add_argument("--estimate-id", required=True)
    current.add_argument("--max-cost-usd", required=True)
    current = command("jobs", "Read and retain the compact native job list without the deprecated short parameter.", jobs)
    current.add_argument("--states", default="queued,processing,done")
    current.add_argument("--since", required=True)
    current = command("job", "Retain original full job details and expose their selected account-safe view.", job)
    current.add_argument("--job-id", required=True)
    current = command("reconcile", "Bind an uncertain original submit to the explicitly selected provider job; never resubmit.", reconcile)
    current.add_argument("--job-id", required=True)
    current.add_argument("--reviewer", required=True)
    current = command("receive", "Resume original SDK per-file receiving for the same paid job and verify its complete hashes.", receive)
    current.add_argument("--job-id", required=True)
    current.add_argument("--filename", action="append", help="One original manifest filename; repeat to select several.")
    current = command("symbology", "Retain native symbol mappings for explicit UTC start/end dates.", resolve_symbols)
    current.add_argument("--request", required=True)
    current = command("retain", "Copy the actual original CSV/JSONL/JSON source and declared metadata without changing its bytes.", retain)
    current.add_argument("--source", required=True)
    current.add_argument("--from-id", help="Completed original receiving/source operation whose exact file identity is carried forward.")
    current.add_argument("--descriptor", required=True)
    current.add_argument("--input-root", help="Root for an existing descriptor's corpus.index; defaults to the descriptor directory.")
    current = command("partition", "Stream a complete natural interval into exact CSV/JSONL record bytes and a full corpus index.", partition)
    current.add_argument("--source", required=True)
    current.add_argument("--from-id", help="Completed original receiving/source operation whose exact file identity is carried forward.")
    current.add_argument("--descriptor", required=True)
    current.add_argument("--time-field", required=True, choices=["ts_recv", "ts_event"])
    current.add_argument("--start", required=True)
    current.add_argument("--end", required=True)
    current.add_argument("--gzip", action="store_true")
    current.add_argument("--max-file-bytes", type=int, help="Reject a larger complete partition; never clip its rows.")
    current = command("decode", "Decode original DBN AS_IS with native0.70 and retain integer-string JSONL plus original metadata.", decode)
    current.add_argument("--source", required=True)
    current.add_argument("--from-id", help="Completed original receiving/source operation whose exact file identity is carried forward.")
    current = command("export", "Compose explicit source operations into a complete create-only multi-edition core packet.", export_packet)
    current.add_argument("--selection", required=True, help="JSON with native edition metadata and sourceOperations per edition.")
    current.add_argument("--out", required=True)
    current = command("reopen", "Verify a retained operation or complete source packet offline, without a provider request.", reopen, False)
    choice = current.add_mutually_exclusive_group(required=True)
    choice.add_argument("--id")
    choice.add_argument("--packet")
    return cli

def main(argv=None):
    args = parser().parse_args(argv)
    secret = None
    try:
        if args.command in {"estimate", "submit", "jobs", "job", "reconcile", "receive", "symbology"}:
            secret = read_key(args)
        if args.command == "reopen" and args.packet:
            result = reopen(args)
        else:
            if not args.store:
                fail("PRIVATE_STORE", "Select --store before the command; raw provider responses stay in that private directory.")
            if getattr(args, "max_file_bytes", None) is not None and args.max_file_bytes <= 0:
                fail("PARTITION_SIZE", "The explicit complete-file limit must be positive.")
            store = Store(args.store, args.gateway)
            result = args.handler(args, store)
        print(json.dumps(clean(result, (secret,)), ensure_ascii=False, allow_nan=False))
        return 0
    except KeyboardInterrupt:
        print(json.dumps({"error": "INTERRUPTED", "message": "The same retained operation may be reopened; a started submit is reconciled, never automatically replayed."}), file=sys.stderr)
        return 130
    except Exception as error:
        code = error.code if isinstance(error, AcquisitionError) else "DATABENTO_ACQUISITION_ERROR"
        message = clean(str(error), (secret,))
        print(json.dumps({"error": code, "message": message}, ensure_ascii=False), file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
