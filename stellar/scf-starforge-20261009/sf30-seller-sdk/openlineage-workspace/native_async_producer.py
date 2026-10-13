#!/usr/bin/env python3
"""Operate the released OpenLineage async transport against the original workspace."""
from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.metadata
import json
import math
import os
import signal
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urljoin

from native_python_producer import (
    SDK_VERSION, MAX_SOURCE_BYTES, ProducerError, atomic_json, checked_transport,
    configuration, events_from, now, original_bytes, prepare_inputs,
    private_directory, read_json, sha256,
)

SCHEMA = "commons.openlineage.async-python-producer.v1"
SDK_SOURCE = {
    "version": "1.53.0",
    "commit": "8ad5c14c63fbab63fedd8ff42f9a208d86ad07fe",
    "asyncHttpGitBlob": "1a5c146a45fb71cacdcf858f7e04ae45500bed23",
    "serdeGitBlob": "784dbfc20c6aefe984c131d227759aafcd260507",
    "runGitBlob": "d8110607108afbd6cc3dc88aa910a1cf3090248d",
}
ROOT_FILES = {"producer.json", "plan.json", "async-close.json", "complete-result.json"}
RECORD_DIRECTORIES = {"requests", "receipts", "failures", "originals"}


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False,
                      separators=(",", ":")).encode("utf-8")


def record_hash(value: Any) -> str:
    return sha256(canonical_bytes(value))


def operation_name(value: str) -> str:
    if (not isinstance(value, str) or not value.strip() or len(value) > 512
            or any(char in value for char in "\r\n\0")):
        raise ProducerError("Use an original operation ID of at most 512 characters")
    return sha256(value.encode("utf-8")) + ".json"


def bounded_number(value: Any, name: str, low: float, high: float,
                   *, integer: bool = False) -> float | int:
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or value < low or value > high
            or (integer and not isinstance(value, int))):
        raise ProducerError(name + " is outside its supported range")
    return value


class OperationLease:
    """One local process operates the original producer directory at a time."""

    def __init__(self, directory: Path):
        self.path = directory / ".async-writer.lock"
        self.handle = None
        self.worker_exited = None

    def protect_worker(self, exited: threading.Event):
        if self.worker_exited is not None and not self.worker_exited.is_set():
            raise ProducerError("The original lease already belongs to a running async worker")
        self.worker_exited = exited

    def acquire(self):
        handle = self.path.open("a+b")
        try:
            if os.name == "nt":
                import msvcrt
                handle.seek(0, os.SEEK_END)
                if handle.tell() == 0:
                    handle.write(b"\0")
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError) as error:
            handle.close()
            raise ProducerError("The original async producer directory is active") from error
        self.handle = handle
        return self

    def close(self):
        if self.handle is None:
            return True
        # Even an outer lease context must not unlock an interrupted native close.
        if self.worker_exited is not None and not self.worker_exited.is_set():
            return False
        handle, self.handle = self.handle, None
        try:
            if os.name == "nt":
                import msvcrt
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            # POSIX close releases this descriptor only. An SDK child that
            # inherited the same open file description keeps the original lock.
        finally:
            handle.close()
        return True

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *_):
        self.close()


def native_sdk():
    if importlib.metadata.version("openlineage-python") != SDK_VERSION:
        raise ProducerError("Select the prepared openlineage-python==" + SDK_VERSION + " environment")
    from openlineage.client import run, serde
    from openlineage.client.transport import async_http
    # This adapter observes narrow custody/lifetime seams in this exact released implementation.
    for module, expected in ((async_http, SDK_SOURCE["asyncHttpGitBlob"]),
                             (serde, SDK_SOURCE["serdeGitBlob"]),
                             (run, SDK_SOURCE["runGitBlob"])):
        data = Path(module.__file__).read_bytes()
        actual = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if actual != expected:
            raise ProducerError("The installed SDK source differs from the selected 1.53.0 release: "
                                + module.__name__ + " (" + actual + ")")
    return async_http, serde.Serde, run


def async_configuration(config: dict) -> tuple[dict, str]:
    if not isinstance(config, dict) or not isinstance(config.get("transport"), dict):
        raise ProducerError("Select a complete native async transport configuration")
    selected = dict(config["transport"])
    if selected.get("type") != "async_http":
        raise ProducerError("Select transport.type=async_http")
    # Retain the original origin, workspace, header and credential validation.
    checked, workspace_id = checked_transport({"transport": {**selected, "type": "http"}})
    checked["type"] = "async_http"
    custom = checked.get("custom_headers", {})
    lowered = [str(key).lower() for key in custom]
    if len(set(lowered)) != len(lowered):
        raise ProducerError("Use one original value per case-insensitive native header")
    if "content-type" in lowered:
        raise ProducerError("The native event serializer supplies Content-Type")
    checked["custom_headers"] = {key: value for key, value in custom.items()
                                 if str(key).lower() != "x-openlineage-workspace"}
    checked["custom_headers"]["X-OpenLineage-Workspace"] = workspace_id
    checked["timeout"] = bounded_number(checked.get("timeout", 30), "timeout", 0.1, 300)
    checked["max_queue_size"] = bounded_number(checked.get("max_queue_size", 64),
                                              "max_queue_size", 1, 1000000, integer=True)
    checked["max_concurrent_requests"] = bounded_number(
        checked.get("max_concurrent_requests", 4), "max_concurrent_requests", 1, 1024, integer=True)
    if "verify" in checked and not isinstance(checked["verify"], bool):
        raise ProducerError("Native TLS verify must be a boolean")
    retry = checked.get("retry")
    if retry is not None:
        if not isinstance(retry, dict):
            raise ProducerError("Native retry must be an object")
        if "total" in retry:
            bounded_number(retry["total"], "retry.total", 0, 10, integer=True)
        if "backoff_factor" in retry:
            bounded_number(retry["backoff_factor"], "retry.backoff_factor", 0, 60)
        if "status_forcelist" in retry and (
                not isinstance(retry["status_forcelist"], (list, tuple))
                or any(isinstance(status, bool) or not isinstance(status, int)
                       or status < 400 or status > 599 for status in retry["status_forcelist"])):
            raise ProducerError("Native retry status_forcelist requires HTTP error status integers")
    return checked, workspace_id


def keys(value: Any, allowed: set[str], label: str):
    if not isinstance(value, dict):
        raise ProducerError(label + " must be an object")
    extra = set(value) - allowed
    if extra:
        raise ProducerError(label + " has fields outside the selected SDK RunEvent model: "
                            + ", ".join(sorted(extra)))


def typed_event(value: Any, serde, run):
    """Preserve the native serialization while activating the SDK's RunEvent ordering.

    Legacy RunEvent accepts the original explicit schemaURL. Optional absent fields
    are passed as None, so the SDK does not add empty facets or dataset lists.
    """
    if not isinstance(value, dict) or "eventType" not in value:
        # Actual native attrs instances remain intact. Dataset/Job event dictionaries
        # have no run ordering dependency and use the SDK's ordinary JSON path.
        serde.to_json(value)
        return value
    keys(value, {"eventType", "eventTime", "run", "job", "producer", "inputs", "outputs", "schemaURL"},
         "Run event")
    keys(value.get("run"), {"runId", "facets"}, "Run")
    keys(value.get("job"), {"namespace", "name", "facets"}, "Job")
    def datasets(items, output: bool):
        if items is None:
            return None
        if not isinstance(items, list):
            raise ProducerError("Run inputs and outputs must be lists")
        result = []
        field = "outputFacets" if output else "inputFacets"
        constructor = run.OutputDataset if output else run.InputDataset
        for item in items:
            keys(item, {"namespace", "name", "facets", field}, "Dataset")
            result.append(constructor(namespace=item["namespace"], name=item["name"],
                                      facets=item.get("facets"), **{field: item.get(field)}))
        return result
    native = run.RunEvent(
        eventType=run.RunState(value["eventType"]), eventTime=value["eventTime"],
        run=run.Run(runId=value["run"]["runId"], facets=value["run"].get("facets")),
        job=run.Job(namespace=value["job"]["namespace"], name=value["job"]["name"],
                    facets=value["job"].get("facets")),
        producer=value["producer"], schemaURL=value["schemaURL"],
        inputs=datasets(value.get("inputs"), False), outputs=datasets(value.get("outputs"), True),
    )
    if serde.to_dict(native) != serde.to_dict(value):
        raise ProducerError("The selected SDK model would change this original event")
    return native


def request_identity(value: dict) -> dict:
    return {key: value[key] for key in (
        "schema", "workspaceId", "operationId", "sdkSource", "serializedSha256",
        "serializedBytes", "original", "run"
    )}


def validate_request(request: dict) -> tuple[bytes, bytes]:
    if request.get("schema") != SCHEMA + ".request" or request.get("sdkSource") != SDK_SOURCE:
        raise ProducerError("The original request uses a different async producer source")
    operation_name(request["operationId"])
    wire = base64.b64decode(request["wireBase64"], validate=True)
    if sha256(wire) != request["wireSha256"] or len(wire) != request["wireBytes"]:
        raise ProducerError("The retained original SDK request is incomplete")
    encoding = request.get("contentEncoding")
    if encoding == "gzip":
        import gzip
        import io
        with gzip.GzipFile(fileobj=io.BytesIO(wire)) as stream:
            decoded = stream.read(MAX_SOURCE_BYTES + 1)
    elif encoding == "identity":
        decoded = wire
    else:
        raise ProducerError("The retained original request has an unsupported encoding")
    if len(decoded) > MAX_SOURCE_BYTES or len(decoded) != request["serializedBytes"] or (
            sha256(decoded) != request["serializedSha256"]):
        raise ProducerError("The original SDK serialization is incomplete")
    return wire, decoded


def validate_acknowledgement(request: dict, acknowledgement: Any):
    source = acknowledgement.get("source", {}) if isinstance(acknowledgement, dict) else {}
    if (not isinstance(acknowledgement, dict)
            or acknowledgement.get("workspaceId") != request["workspaceId"]
            or acknowledgement.get("operationId") != request["operationId"]
            or source.get("id") != request["wireSha256"]
            or source.get("bytes") != request["wireBytes"]
            or source.get("contentEncoding", "identity") != request["contentEncoding"]
            or isinstance(acknowledgement.get("revision"), bool)
            or not isinstance(acknowledgement.get("revision"), int)
            or acknowledgement["revision"] < 0):
        raise ProducerError("The native acknowledgement does not identify the original request")
    if request["contentEncoding"] == "gzip" and (
            source.get("decodedSha256") != request["serializedSha256"]
            or source.get("decodedBytes") != request["serializedBytes"]):
        raise ProducerError("The receiver's decoded source differs from the native SDK serialization")


def validate_receipt(request: dict, receipt: dict):
    validate_request(request)
    if (receipt.get("schema") != SCHEMA + ".receipt"
            or receipt.get("requestSha256") != record_hash(request)
            or receipt.get("operationId") != request["operationId"]
            or receipt.get("workspaceId") != request["workspaceId"]
            or receipt.get("wireSha256") != request["wireSha256"]
            or receipt.get("serializedSha256") != request["serializedSha256"]):
        raise ProducerError("The retained acknowledgement belongs to a different original request")
    validate_acknowledgement(request, receipt.get("acknowledgement"))


def expected_operations(plan: dict | None) -> dict[str, dict]:
    if plan is None:
        return {}
    result = {}
    for file_index, file in enumerate(plan["files"], 1):
        for event_index in range(1, file["events"] + 1):
            identifier = plan["operationId"] + "/file-" + str(file_index) + "/event-" + str(event_index)
            result[identifier] = {"sourceSha256": file["sha256"], "sourceName": file["name"],
                                  "fileIndex": file_index, "eventIndex": event_index}
    return result


def status(directory: Path) -> dict:
    plan_path = directory / "plan.json"
    plan = read_json(plan_path) if plan_path.exists() else None
    expected = expected_operations(plan)
    if plan is not None:
        if plan.get("schema") != "commons.openlineage.python-producer.v1.plan":
            raise ProducerError("The original producer plan uses a different schema")
        for item in plan["files"]:
            saved = read_json(directory / "originals" / (item["sha256"] + ".json"))
            data = base64.b64decode(saved["base64"], validate=True)
            if sha256(data) != item["sha256"] or len(data) != item["bytes"]:
                raise ProducerError("An original input differs from the retained producer plan")
            if len(events_from(data)) != item["events"]:
                raise ProducerError("The original source event count changed")
    producer_path = directory / "producer.json"
    producer = read_json(producer_path) if producer_path.exists() else None
    rows, seen = [], set()
    for path in sorted((directory / "requests").glob("*.json")):
        request = read_json(path)
        validate_request(request)
        identifier = request["operationId"]
        if path.name != operation_name(identifier) or identifier in seen:
            raise ProducerError("The original request index is inconsistent")
        if producer and request["workspaceId"] != producer.get("workspaceId"):
            raise ProducerError("An original request belongs to a different workspace")
        if plan and (identifier not in expected or expected[identifier] != request["original"]):
            raise ProducerError("An original request differs from the retained input plan")
        seen.add(identifier)
        receipt_path = directory / "receipts" / path.name
        failure_path = directory / "failures" / path.name
        row = {
            "operationId": identifier, "workspaceId": request["workspaceId"],
            "original": request["original"], "run": request["run"],
            "wireSha256": request["wireSha256"], "wireBytes": request["wireBytes"],
            "serializedSha256": request["serializedSha256"],
            "contentEncoding": request["contentEncoding"], "preparedAt": request["createdAt"],
            "state": "unacknowledged",
        }
        if receipt_path.exists():
            receipt = read_json(receipt_path)
            validate_receipt(request, receipt)
            row.update(state="received", acknowledgedAt=receipt["acknowledgedAt"],
                       revision=receipt["acknowledgement"]["revision"],
                       receiptSha256=record_hash(receipt),
                       acknowledgement=receipt["acknowledgement"])
        if failure_path.exists():
            failure = read_json(failure_path)
            if (failure.get("schema") != SCHEMA + ".failure"
                    or failure.get("requestSha256") != record_hash(request)):
                raise ProducerError("A native failure record has changed its original request")
            row["observations"] = failure["observations"]
        rows.append(row)
    for path in (directory / "receipts").glob("*.json"):
        if not (directory / "requests" / path.name).exists():
            raise ProducerError("A receiving acknowledgement has no original request")
    pending = [row["operationId"] for row in rows if row["state"] != "received"]
    missing = sorted(set(expected) - seen)
    closed_path = directory / "async-close.json"
    closed = read_json(closed_path) if closed_path.exists() else None
    return {
        "schema": SCHEMA + ".status", "directory": str(directory),
        "workspaceId": producer.get("workspaceId") if producer else None,
        "operationId": plan.get("operationId") if plan else None,
        "sdkSource": SDK_SOURCE, "plannedEvents": len(expected) if plan else None,
        "preparedRequests": len(rows), "acknowledgedEvents": len(rows) - len(pending),
        "unsubmittedOperations": missing, "unacknowledgedOperations": pending,
        "complete": bool(rows) and not pending and not missing,
        "lastClosedSession": closed, "events": rows,
    }


class AsyncWorkspaceProducer:
    """Use the released SDK queue, ordering, retry, worker and close lifecycle.

    Three pinned seams add custody only: _prepare_request keeps the first SDK body;
    _process_event delegates to the native worker through a receipt-checking client;
    _mark_failed retains the native terminal failure while preserving native release.
    """

    def __init__(self, config: dict, directory: str | Path, *, lease: OperationLease | None = None):
        module, self.serde, self.run_module = native_sdk()
        selected, self.workspace_id = async_configuration(config)
        self.directory = private_directory(Path(directory).resolve())
        self.lease = lease or OperationLease(self.directory).acquire()
        self.owns_lease = lease is None
        self.preparing = None
        self.emission_lock = threading.RLock()
        self.observation_lock = threading.RLock()
        self.submitted = set()
        self.pending_limit = selected["max_queue_size"] + selected["max_concurrent_requests"]
        self.storage_errors = []
        self.closed = False
        self.close_result = None
        self.transport = None
        self.worker_exited = threading.Event()
        self.endpoint = urljoin(selected["url"], selected.get("endpoint", "api/v1/lineage"))
        try:
            saved = atomic_json(self.directory / "producer.json", {
                "schema": SCHEMA, "workspaceId": self.workspace_id,
                "sdkSource": SDK_SOURCE, "createdAt": now(),
            }, first=True)
            if (saved.get("schema") != SCHEMA or saved.get("workspaceId") != self.workspace_id
                    or saved.get("sdkSource") != SDK_SOURCE):
                raise ProducerError("Resume the original async producer source and workspace")
            owner = self

            class ReceiptedClient:
                def __init__(self, client):
                    self.client = client

                async def post(self, *, url, content, headers):
                    identifier = headers["Idempotency-Key"]
                    request = owner.read_request(identifier)
                    wire, _ = validate_request(request)
                    sent = content.encode("utf-8") if isinstance(content, str) else bytes(content)
                    if url != owner.endpoint or sent != wire:
                        raise ProducerError("The native worker changed the selected request")
                    try:
                        response = await self.client.post(
                            url=url, content=content, headers=headers, follow_redirects=False)
                    except Exception as error:
                        owner.observe(identifier, {"kind": "transport", "type": type(error).__name__,
                                                   "effect": "unknown", "at": now()})
                        raise
                    if response.status_code == 200:
                        try:
                            acknowledgement = response.json()
                            validate_acknowledgement(request, acknowledgement)
                            receipt = {
                                "schema": SCHEMA + ".receipt", "sdkSource": SDK_SOURCE,
                                "transport": "AsyncHttpTransport",
                                "workspaceId": owner.workspace_id, "operationId": identifier,
                                "requestSha256": record_hash(request),
                                "serializedSha256": request["serializedSha256"],
                                "wireSha256": request["wireSha256"],
                                "acknowledgedAt": now(), "acknowledgement": acknowledgement,
                            }
                            path = owner.directory / "receipts" / operation_name(identifier)
                            saved = atomic_json(path, receipt, first=True)
                            validate_receipt(request, saved)
                        except Exception as error:
                            owner.observe(identifier, {"kind": "acknowledgement",
                                "type": type(error).__name__, "status": 200, "effect": "unknown", "at": now()})
                            raise
                    else:
                        owner.observe(identifier, {"kind": "http", "status": response.status_code,
                            "retryAfter": response.headers.get("Retry-After"), "at": now()})
                        if 200 <= response.status_code < 300:
                            raise ProducerError("The original receiver requires a complete HTTP 200 acknowledgement")
                    return response

            class RecordedTransport(module.AsyncHttpTransport):
                def __init__(self, *args, **kwargs):
                    owner.transport = self
                    owner.lease.protect_worker(owner.worker_exited)
                    super().__init__(*args, **kwargs)

                def _setup_loop(self):
                    # Observe the original worker itself, including interrupted join.
                    # Thread.is_alive alone can be unreliable after interrupted joins.
                    try:
                        return super()._setup_loop()
                    finally:
                        owner.worker_exited.set()

                def _prepare_request(self, event):
                    original = owner.preparing
                    if original is None:
                        raise ProducerError("Emit through the original async producer request")
                    body, headers = super()._prepare_request(event)
                    wire = body.encode("utf-8") if isinstance(body, str) else bytes(body)
                    encoding = headers.get("Content-Encoding", "identity").lower()
                    serialized = event.encode("utf-8")
                    if len(serialized) > MAX_SOURCE_BYTES or len(wire) > MAX_SOURCE_BYTES:
                        raise ProducerError("The native serialized event exceeds 64 MiB")
                    candidate = {
                        "schema": SCHEMA + ".request", "workspaceId": owner.workspace_id,
                        "sdkSource": SDK_SOURCE, "operationId": original["operationId"],
                        "original": original["original"], "run": original["run"],
                        "serializedSha256": sha256(serialized), "serializedBytes": len(serialized),
                        "wireSha256": sha256(wire), "wireBytes": len(wire),
                        "wireBase64": base64.b64encode(wire).decode("ascii"),
                        "contentEncoding": encoding, "contentType": headers["Content-Type"],
                        "createdAt": now(),
                    }
                    saved = atomic_json(owner.directory / "requests" / operation_name(original["operationId"]),
                                        candidate, first=True)
                    if request_identity(candidate) != request_identity(saved):
                        raise ProducerError("The operation ID already binds a different original event")
                    first_wire, _ = validate_request(saved)
                    headers["Idempotency-Key"] = original["operationId"]
                    headers["X-OpenLineage-Workspace"] = owner.workspace_id
                    headers["Content-Type"] = saved["contentType"]
                    if saved["contentEncoding"] == "gzip":
                        headers["Content-Encoding"] = "gzip"
                    else:
                        headers.pop("Content-Encoding", None)
                    return first_wire, headers

                async def _process_event(self, client, semaphore, request, from_main_queue=True):
                    return await super()._process_event(ReceiptedClient(client), semaphore, request,
                                                        from_main_queue=from_main_queue)

                def _mark_failed(self, request):
                    released = super()._mark_failed(request)
                    try:
                        owner.observe(request.headers["Idempotency-Key"], {
                            "kind": "native-failed", "at": now(), "eventId": request.event_id,
                            "releasedTerminalRequests": len(released),
                        })
                    except Exception as error:
                        owner.storage_errors.append(type(error).__name__)
                    return released

            self.transport = RecordedTransport(module.AsyncHttpConfig.from_dict(selected))
        except BaseException:
            worker = getattr(self.transport, "worker_thread", None)
            if worker is None or worker.ident is None:
                self.worker_exited.set()
            else:
                try:
                    self.close(0)
                except BaseException:
                    pass  # The original worker keeps its protected lease until exit.
            if self.owns_lease:
                self.lease.close()
            raise

    def read_request(self, identifier: str) -> dict:
        value = read_json(self.directory / "requests" / operation_name(identifier))
        if value.get("workspaceId") != self.workspace_id or value.get("operationId") != identifier:
            raise ProducerError("The selected request belongs to another original operation")
        return value

    def observe(self, identifier: str, observation: dict):
        with self.observation_lock:
            request = self.read_request(identifier)
            path = self.directory / "failures" / operation_name(identifier)
            prior = read_json(path) if path.exists() else {
                "schema": SCHEMA + ".failure", "workspaceId": self.workspace_id,
                "operationId": identifier, "requestSha256": record_hash(request), "observations": [],
            }
            if prior.get("requestSha256") != record_hash(request):
                raise ProducerError("The retained observation belongs to a different request")
            prior["observations"].append(observation)
            atomic_json(path, prior)

    def emit(self, event: Any, operation_id: str, *, original: dict | None = None,
             ordering_timeout: float = 60) -> dict:
        name = operation_name(operation_id)
        original = {} if original is None else original
        if not isinstance(original, dict):
            raise ProducerError("Original source metadata must be an object")
        canonical_bytes(original)
        with self.emission_lock:
            if self.closed:
                raise ProducerError("This native async producer is closed; resume its original directory")
            native = typed_event(event, self.serde, self.run_module)
            canonical_bytes(self.serde.to_dict(native))
            serialized = self.serde.to_json(native).encode("utf-8")
            if len(serialized) > MAX_SOURCE_BYTES:
                raise ProducerError("The native serialized event exceeds 64 MiB")
            plan_path = self.directory / "plan.json"
            if plan_path.exists():
                expected = expected_operations(read_json(plan_path))
                if expected.get(operation_id) != original:
                    raise ProducerError("This request does not match the original source plan")
            request_path = self.directory / "requests" / name
            if request_path.exists():
                request = self.read_request(operation_id)
                validate_request(request)
                if request["serializedSha256"] != sha256(serialized) or request["original"] != original:
                    raise ProducerError("The original request ID already identifies a different event")
            receipt_path = self.directory / "receipts" / name
            if receipt_path.exists():
                request, receipt = self.read_request(operation_id), read_json(receipt_path)
                validate_receipt(request, receipt)
                return {"operationId": operation_id, "state": "received", "delivery": "retained",
                        "receipt": receipt}
            if operation_id in self.submitted:
                return {"operationId": operation_id, "state": "submitted", "delivery": "existing-native-queue"}
            event_dict = self.serde.to_dict(native)
            run = {"runId": event_dict["run"]["runId"], "eventType": event_dict["eventType"]} if (
                "eventType" in event_dict and isinstance(event_dict.get("run"), dict)) else None
            bounded_number(ordering_timeout, "admission timeout", 0.1, 86400)
            # Include terminal requests held outside the SDK's main queue in
            # admission. This only waits on native counters; it adds no queue.
            deadline = time.monotonic() + ordering_timeout
            while self.get_stats()["pending"] >= self.pending_limit:
                if not self.transport.worker_thread.is_alive():
                    raise ProducerError("The native async worker stopped; resume the retained source plan")
                if time.monotonic() >= deadline:
                    raise ProducerError("The native async queue is still occupied; resume the retained source plan")
                time.sleep(0.01)
            # Upstream tracking keys are runId + eventType. Drain before reusing
            # a currently pending key for a different original event.
            slot = run["runId"] + "-" + run["eventType"] if run else None
            with self.transport.event_lock:
                occupied = slot is not None and slot in self.transport.events
            if occupied and not self.transport.wait_for_completion(ordering_timeout):
                raise ProducerError("An earlier native run-state request is still pending; resume the original plan")
            self.preparing = {"operationId": operation_id, "original": original, "run": run}
            try:
                self.transport.emit(native)
                self.submitted.add(operation_id)
            finally:
                self.preparing = None
            return {"operationId": operation_id, "state": "submitted", "delivery": "native-queue",
                    "request": str(request_path)}

    def get_stats(self) -> dict:
        with self.transport.event_lock:
            return dict(self.transport.get_stats())

    def wait_for_completion(self, timeout: float = 30) -> bool:
        bounded_number(timeout, "drain timeout", 0, 86400)
        return self.transport.wait_for_completion(timeout)

    def close(self, timeout: float = 30) -> dict:
        with self.emission_lock:
            if self.close_result is not None:
                if self.owns_lease:
                    self.lease.close()
                return self.close_result
            bounded_number(timeout, "close timeout", 0, 86400)
            self.closed = True
            # A prior interrupted call leaves the same worker and lease available
            # for this close. No later emit is admitted once closing has begun.
            if not self.worker_exited.is_set():
                drained = self.transport.close(timeout)
                self.worker_exited.wait()
            else:
                drained = self.get_stats().get("pending", 1) == 0
            self.transport.worker_thread.join()
            result = {
                "schema": SCHEMA + ".close", "workspaceId": self.workspace_id,
                "closedAt": now(), "sdkSource": SDK_SOURCE, "nativeDrained": bool(drained),
                "nativeWorkerExited": True,
                "nativeStats": self.get_stats(), "storageErrors": list(self.storage_errors),
            }
            atomic_json(self.directory / "async-close.json", result)
            self.close_result = result
            if self.owns_lease:
                self.lease.close()
            return result

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def file_hash(path: Path) -> tuple[str, int]:
    digest, count = hashlib.sha256(), 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
            count += len(chunk)
    return digest.hexdigest(), count


def publish_file(temporary: Path, destination: Path, expected_sha: str, expected_bytes: int):
    try:
        os.link(temporary, destination)
    except FileExistsError:
        if destination.is_symlink() or not destination.is_file() or (
                file_hash(destination) != (expected_sha, expected_bytes)):
            raise ProducerError("The selected delivery path contains a different original file")
    if os.name != "nt":
        descriptor = os.open(destination.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def publish_bytes(destination: Path, data: bytes):
    private_directory(destination.parent)
    descriptor, name = tempfile.mkstemp(prefix=".pending-async-", dir=destination.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        publish_file(temporary, destination, sha256(data), len(data))
    finally:
        temporary.unlink(missing_ok=True)


def archive_operation(directory: Path, destination: Path) -> dict:
    if destination == directory or directory in destination.parents:
        raise ProducerError("Select a new delivery file outside the original operation directory")
    with OperationLease(directory):
        current = status(directory)
        members = []
        for path in sorted(directory.rglob("*")):
            relative = path.relative_to(directory)
            selected = (len(relative.parts) == 1 and relative.name in ROOT_FILES) or (
                len(relative.parts) == 2 and relative.parts[0] in RECORD_DIRECTORIES
                and relative.suffix == ".json")
            if not selected:
                continue
            if path.is_symlink() or not path.is_file():
                raise ProducerError("The producer delivery contains a non-regular original record")
            digest, length = file_hash(path)
            members.append({"path": relative.as_posix(), "bytes": length, "sha256": digest})
        manifest = {"schema": SCHEMA + ".delivery", "workspaceId": current["workspaceId"],
                    "operationId": current["operationId"], "sdkSource": SDK_SOURCE,
                    "complete": current["complete"], "files": members}
        private_directory(destination.parent)
        descriptor, name = tempfile.mkstemp(prefix=".pending-async-export-", dir=destination.parent)
        temporary = Path(name)
        try:
            with os.fdopen(descriptor, "w+b") as stream:
                with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    for member in members:
                        info = zipfile.ZipInfo(member["path"], date_time=(1980, 1, 1, 0, 0, 0))
                        info.compress_type = zipfile.ZIP_DEFLATED
                        info.external_attr = 0o600 << 16
                        digest, count = hashlib.sha256(), 0
                        with (directory / member["path"]).open("rb") as source, archive.open(info, "w") as target:
                            while chunk := source.read(1024 * 1024):
                                target.write(chunk)
                                digest.update(chunk)
                                count += len(chunk)
                        if (digest.hexdigest(), count) != (member["sha256"], member["bytes"]):
                            raise ProducerError("An original producer record changed during export")
                    info = zipfile.ZipInfo("manifest.json", date_time=(1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o600 << 16
                    archive.writestr(info, canonical_bytes(manifest) + b"\n")
                stream.flush()
                os.fsync(stream.fileno())
            digest, count = file_hash(temporary)
            publish_file(temporary, destination, digest, count)
            return {"schema": SCHEMA + ".export", "path": str(destination), "bytes": count,
                    "sha256": digest, "workspaceId": current["workspaceId"],
                    "operationId": current["operationId"], "complete": current["complete"],
                    "files": len(members)}
        finally:
            temporary.unlink(missing_ok=True)


def receive_operation(source: Path, destination: Path) -> dict:
    """Receive or finish publishing this exact producer archive in its new directory."""
    archive_sha, archive_bytes = file_hash(source)
    if archive_bytes > 2 * 1024 * 1024 * 1024:
        raise ProducerError("The original producer archive exceeds 2 GiB")
    private_directory(destination.parent)
    control = destination.parent / (".async-receive-" + sha256(destination.name.encode("utf-8")))
    if control.is_symlink():
        raise ProducerError("The original receiving custody path must be a real directory")
    private_directory(control)
    with OperationLease(control):
        intent_path = control / "intent.json"
        if destination.is_symlink() or (destination.exists() and not intent_path.exists()):
            raise ProducerError("Select a new receiving directory for this original producer archive")
        temporary = Path(tempfile.mkdtemp(prefix=".receiving-async-", dir=destination.parent))
        try:
            with zipfile.ZipFile(source) as archive:
                entries = archive.infolist()
                if len(entries) > 100000 or len({item.filename for item in entries}) != len(entries):
                    raise ProducerError("The producer archive has duplicate or excessive members")
                try:
                    info = archive.getinfo("manifest.json")
                except KeyError as error:
                    raise ProducerError("The original producer delivery manifest is missing") from error
                if info.file_size > 32 * 1024 * 1024:
                    raise ProducerError("The producer delivery manifest exceeds 32 MiB")
                manifest = json.loads(archive.read(info))
                if (not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA + ".delivery"
                        or manifest.get("sdkSource") != SDK_SOURCE
                        or not isinstance(manifest.get("files"), list)
                        or not isinstance(manifest.get("complete"), bool)):
                    raise ProducerError("Select this original native async producer delivery")
                members = manifest["files"]
                if any(not isinstance(item, dict) or not isinstance(item.get("path"), str)
                       for item in members):
                    raise ProducerError("The producer manifest requires complete original file records")
                if len({item["path"] for item in members}) != len(members):
                    raise ProducerError("The producer manifest repeats an original path")
                if {item.filename for item in entries} != {"manifest.json", *[item["path"] for item in members]}:
                    raise ProducerError("The producer archive differs from its complete original manifest")
                total = 0
                for item in members:
                    path = PurePosixPath(item["path"])
                    allowed = (len(path.parts) == 1 and path.name in ROOT_FILES) or (
                        len(path.parts) == 2 and path.parts[0] in RECORD_DIRECTORIES
                        and path.suffix == ".json" and len(path.stem) == 64
                        and all(char in "0123456789abcdef" for char in path.stem))
                    if (not allowed or path.as_posix() != item["path"] or path.is_absolute()
                            or ".." in path.parts or "\\" in item["path"]):
                        raise ProducerError("The producer archive contains an undeclared path")
                    info = archive.getinfo(item["path"])
                    if (isinstance(item.get("bytes"), bool) or not isinstance(item.get("bytes"), int)
                            or item["bytes"] < 0 or info.file_size != item["bytes"]
                            or not isinstance(item.get("sha256"), str) or len(item["sha256"]) != 64
                            or any(char not in "0123456789abcdef" for char in item["sha256"])
                            or info.is_dir() or ((info.external_attr >> 16) & 0o170000) == 0o120000):
                        raise ProducerError("The producer archive has invalid original file metadata")
                    total += info.file_size
                    if total > 2 * 1024 * 1024 * 1024:
                        raise ProducerError("The decoded producer archive exceeds 2 GiB")
                    target = temporary.joinpath(*path.parts)
                    private_directory(target.parent)
                    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    digest, length = hashlib.sha256(), 0
                    with archive.open(info) as original, os.fdopen(descriptor, "wb") as received:
                        while chunk := original.read(1024 * 1024):
                            length += len(chunk)
                            if length > item["bytes"]:
                                raise ProducerError("The original archive member exceeded its declared size")
                            received.write(chunk)
                            digest.update(chunk)
                        received.flush()
                        os.fsync(received.fileno())
                    if (digest.hexdigest(), length) != (item["sha256"], item["bytes"]):
                        raise ProducerError("The received original producer bytes do not match")
            if file_hash(source) != (archive_sha, archive_bytes):
                raise ProducerError("The original producer archive changed during receiving")
            current = status(temporary)
            if (current["workspaceId"] != manifest["workspaceId"]
                    or current["operationId"] != manifest["operationId"]
                    or current["complete"] != manifest["complete"]):
                raise ProducerError("The received original producer state differs from its delivery")
            intent = {
                "schema": SCHEMA + ".receive-intent", "destination": destination.name,
                "archiveSha256": archive_sha, "archiveBytes": archive_bytes,
                "manifestSha256": record_hash(manifest),
                "workspaceId": current["workspaceId"], "operationId": current["operationId"],
            }
            saved_intent = atomic_json(intent_path, intent, first=True)
            if saved_intent != intent:
                raise ProducerError("This receiving destination already belongs to a different original archive")
            try:
                destination.mkdir(mode=0o700)
            except FileExistsError:
                if destination.is_symlink() or not destination.is_dir():
                    raise ProducerError("The original receiving destination is not its selected directory")
            # The original intent is durable before directory creation. Each
            # verified file is linked atomically; rerun finishes only that archive.
            for item in members:
                target = destination / item["path"]
                if target.parent.is_symlink():
                    raise ProducerError("A received original record directory became a symbolic link")
                private_directory(target.parent)
                publish_file(temporary / item["path"], target, item["sha256"], item["bytes"])
            marker_path = destination / ".async-received.json"
            already_received = marker_path.exists()
            marker = atomic_json(marker_path, {
                "schema": SCHEMA + ".received", "archiveSha256": archive_sha,
                "archiveBytes": archive_bytes, "receivedAt": now(),
                "workspaceId": current["workspaceId"], "operationId": current["operationId"],
                "files": len(members), "complete": current["complete"],
            }, first=True)
            if any(marker.get(key) != value for key, value in {
                "schema": SCHEMA + ".received", "archiveSha256": archive_sha,
                "archiveBytes": archive_bytes, "workspaceId": current["workspaceId"],
                "operationId": current["operationId"], "files": len(members),
                "complete": current["complete"],
            }.items()):
                raise ProducerError("The original receiving completion identifies a different delivery")
            return {**marker, "directory": str(destination), "reused": already_received}
        finally:
            shutil.rmtree(temporary)


def selected_config(args) -> dict:
    if args.config:
        if args.token_file:
            raise ProducerError("--token-file belongs to --connection")
        config = read_json(args.config)
    elif args.connection:
        config = configuration(args.connection, args.token_file, args.compression)
        config["transport"].update(type="async_http", max_queue_size=args.queue_size,
                                    max_concurrent_requests=args.concurrency)
    else:
        raise ProducerError("Select the original --config or --connection")
    async_configuration(config)
    return config


def run_plan(directory: Path, config: dict, command: str, inputs: list[Path],
             operation_id: str | None, timeout: float) -> dict:
    with OperationLease(directory) as lease:
        _, serde, run = native_sdk()
        if command == "emit":
            if not inputs or not operation_id:
                raise ProducerError("emit requires original --input files and --operation-id")
            # Validate every selected event through the actual model before dispatch.
            for path in inputs:
                for event in events_from(original_bytes(path)):
                    canonical_bytes(serde.to_dict(typed_event(event, serde, run)))
            plan = prepare_inputs(directory, inputs, operation_id)
        else:
            if inputs or operation_id:
                raise ProducerError("resume uses the original saved inputs and operation ID")
            plan = read_json(directory / "plan.json")
        if plan.get("schema") != "commons.openlineage.python-producer.v1.plan":
            raise ProducerError("The original native producer plan is missing")
        _, workspace_id = async_configuration(config)
        prior = status(directory)
        if prior["workspaceId"] is not None and prior["workspaceId"] != workspace_id:
            raise ProducerError("Resume the original receiving workspace")
        if prior["complete"]:
            return {**prior, "delivery": "retained"}
        producer = AsyncWorkspaceProducer(config, directory, lease=lease)
        try:
            for file_index, file in enumerate(plan["files"], 1):
                saved = read_json(directory / "originals" / (file["sha256"] + ".json"))
                data = base64.b64decode(saved["base64"], validate=True)
                if sha256(data) != file["sha256"] or len(data) != file["bytes"]:
                    raise ProducerError("An original producer input is incomplete")
                events = events_from(data)
                if len(events) != file["events"]:
                    raise ProducerError("The original event selection changed")
                for event_index, event in enumerate(events, 1):
                    identifier = plan["operationId"] + "/file-" + str(file_index) + "/event-" + str(event_index)
                    producer.emit(event, identifier, original={
                        "sourceSha256": file["sha256"], "sourceName": file["name"],
                        "fileIndex": file_index, "eventIndex": event_index,
                    }, ordering_timeout=max(timeout, 1))
            producer.wait_for_completion(timeout)
        finally:
            producer.close(timeout)
        result = status(directory)
        atomic_json(directory / "complete-result.json", result)
        return result


def supervise_receiving(args) -> int:
    """Keep the original kernel lease in the Node programme and every SDK child."""
    if os.name == "nt":
        raise ProducerError("The native receiving programme uses the existing POSIX receiving lease")
    if not all((args.directory, args.node, args.workspace, args.operator_token_file, args.producer_token_file)):
        raise ProducerError("Receiving requires directory, Node, original workspace and both private token files")
    directory = private_directory(args.directory.resolve())
    with OperationLease(directory) as lease:
        descriptor = lease.handle.fileno()
        command = [args.node, str(Path(__file__).with_name("ASYNC_PRODUCER_RECEIVING.mjs")),
                   "--directory", str(directory), "--workspace", str(args.workspace.resolve()),
                   "--python", sys.executable,
                   "--operator-token-file", str(args.operator_token_file.resolve()),
                   "--producer-token-file", str(args.producer_token_file.resolve())]
        if args.source_commit:
            command.extend(["--source-commit", args.source_commit])
        environment = dict(os.environ, OPENLINEAGE_RECEIVING_LOCK_ROOT=str(directory),
                           OPENLINEAGE_RECEIVING_LOCK_FD=str(descriptor))
        child = subprocess.Popen(command, env=environment, pass_fds=(descriptor,))
        try:
            return child.wait()
        except KeyboardInterrupt:
            if child.poll() is None:
                child.send_signal(signal.SIGINT)
            return child.wait()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("configure", "emit", "resume", "status", "export", "receive", "receive-workspace"))
    parser.add_argument("--directory", type=Path)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--config", type=Path)
    selection.add_argument("--connection", type=Path)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--compression", choices=("identity", "gzip"), default="gzip")
    parser.add_argument("--queue-size", type=int, default=64)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--drain-timeout", type=float, default=30)
    parser.add_argument("--input", action="append", type=Path, default=[])
    parser.add_argument("--operation-id")
    parser.add_argument("--node")
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--operator-token-file", type=Path)
    parser.add_argument("--producer-token-file", type=Path)
    parser.add_argument("--source-commit")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    bounded_number(args.drain_timeout, "drain timeout", 0, 86400)
    if args.command == "receive-workspace":
        return supervise_receiving(args)
    if args.command == "configure":
        if not args.connection or args.config or not args.out:
            raise ProducerError("configure requires the observed --connection and a new --out")
        config = selected_config(args)
        data = json.dumps(config, ensure_ascii=False, indent=2).encode() + b"\n"
        publish_bytes(args.out.resolve(), data)
        print(json.dumps({"out": str(args.out.resolve()), "workspaceId":
              config["transport"]["custom_headers"]["X-OpenLineage-Workspace"],
              "transport": "async_http", "queueSize": args.queue_size,
              "concurrency": args.concurrency, "authenticated": bool(config["transport"].get("auth"))}))
        return 0
    if not args.directory:
        raise ProducerError("--directory is required for this original operation")
    if args.command == "receive":
        if len(args.input) != 1:
            raise ProducerError("receive requires one original --input archive")
        print(json.dumps(receive_operation(args.input[0].resolve(), args.directory.resolve()), indent=2))
        return 0
    directory = private_directory(args.directory.resolve())
    if args.command == "status":
        print(json.dumps(status(directory), indent=2))
        return 0
    if args.command == "export":
        if not args.out:
            raise ProducerError("export requires --out outside the original directory")
        print(json.dumps(archive_operation(directory, args.out.resolve()), indent=2))
        return 0
    config = selected_config(args)
    result = run_plan(directory, config, args.command, args.input, args.operation_id, args.drain_timeout)
    print(json.dumps(result, indent=2))
    return 0 if result["complete"] else 2


if __name__ == "__main__":
    interrupted = {"signal": None}
    def stop(signum, _):
        interrupted["signal"] = signum
        raise KeyboardInterrupt()
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print(json.dumps({"state": "interrupted", "continuation": "resume the original directory"}),
              file=sys.stderr)
        raise SystemExit(128 + (interrupted["signal"] or signal.SIGINT))
    except Exception as error:
        print(json.dumps({"error": str(error), "type": type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)
