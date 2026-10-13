#!/usr/bin/env python3
"""Native OpenLineage HTTP producer with durable original requests and receiving receipts."""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import importlib.metadata
import json
import os
import sys
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit

SDK_VERSION = "1.53.0"
MAX_SOURCE_BYTES = 64 * 1024 * 1024
SCHEMA = "commons.openlineage.python-producer.v1"


class ProducerError(RuntimeError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def private_directory(path: Path) -> Path:
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not path.is_dir():
        raise ProducerError("The selected operation path must be a directory")
    return path


def read_json(path: Path) -> Any:
    return json.loads(path.read_bytes())


def atomic_json(path: Path, value: Any, *, first: bool = False) -> Any:
    """Publish a complete private record; first=True preserves a concurrent original."""
    data = (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    private_directory(path.parent)
    descriptor, temporary = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if first:
            try:
                os.link(temporary, path)
            except FileExistsError:
                pass
        else:
            os.replace(temporary, path)
        if os.name != "nt":
            parent = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(parent)
            finally:
                os.close(parent)
        return read_json(path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def original_bytes(path: Path) -> bytes:
    with path.open("rb") as stream:
        data = stream.read(MAX_SOURCE_BYTES + 1)
    if len(data) > MAX_SOURCE_BYTES:
        raise ProducerError("Original producer input exceeds 64 MiB")
    return data


def events_from(data: bytes) -> list[dict[str, Any]]:
    if data.startswith(b"\x1f\x8b"):
        # Read a bounded decoded stream instead of expanding an arbitrary archive.
        import io
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
            data = stream.read(MAX_SOURCE_BYTES + 1)
        if len(data) > MAX_SOURCE_BYTES:
            raise ProducerError("Decoded producer input exceeds 64 MiB")
    text = data.decode("utf-8-sig")
    try:
        value = json.loads(text)
        events = value if isinstance(value, list) else [value]
    except json.JSONDecodeError:
        events = [json.loads(line) for line in text.splitlines() if line.strip()]
    if not events or any(not isinstance(event, dict) for event in events):
        raise ProducerError("Use original event JSON, an event array, or JSON lines")
    for event in events:
        if not all(isinstance(event.get(key), str) and event[key] for key in
                   ("eventTime", "producer", "schemaURL")):
            raise ProducerError("Each original event requires eventTime, producer and schemaURL")
    return events


def configuration(connection: Path, token_file: Path | None, compression: str) -> dict:
    identity = read_json(connection)
    if (identity.get("schema") != "commons.openlineage.startup.v1"
            or not isinstance(identity.get("workspaceId"), str)
            or not isinstance(identity.get("instanceId"), str)):
        raise ProducerError("Use the receiving workspace's original connection.json")
    transport = {
        "type": "http", "url": identity["url"], "endpoint": "api/v1/lineage",
        "timeout": 30,
        "custom_headers": {"X-OpenLineage-Workspace": identity["workspaceId"]},
    }
    if compression == "gzip":
        transport["compression"] = "gzip"
    if token_file is not None:
        token = token_file.read_text(encoding="utf-8").strip()
        if len(token) < 24 or any(c in token for c in "\r\n\0"):
            raise ProducerError("The selected producer token must contain at least 24 characters on one line")
        transport["auth"] = {"type": "api_key", "apiKey": token}
    return {"transport": transport}


def checked_transport(config: dict) -> tuple[dict, str]:
    transport = config.get("transport")
    if not isinstance(transport, dict) or transport.get("type") != "http":
        raise ProducerError("Select the native HTTP transport")
    address = urlsplit(str(transport.get("url", "")))
    if (address.scheme not in ("http", "https") or not address.hostname
            or address.username or address.password or address.query or address.fragment
            or address.path not in ("", "/")):
        raise ProducerError("The receiver must be an HTTP origin without credentials or a path")
    if transport.get("endpoint", "api/v1/lineage").lstrip("/") != "api/v1/lineage":
        raise ProducerError("Select the original api/v1/lineage producer endpoint")
    headers = transport.get("custom_headers", {})
    if not isinstance(headers, dict):
        raise ProducerError("Native custom_headers must be an object")
    lowered = {str(key).lower(): value for key, value in headers.items()}
    workspace_id = lowered.get("x-openlineage-workspace")
    if not isinstance(workspace_id, str) or not workspace_id:
        raise ProducerError("Pin the original X-OpenLineage-Workspace identity")
    if any(key in lowered for key in
           ("idempotency-key", "content-length", "content-encoding", "authorization")):
        raise ProducerError("Use native auth and compression settings; operation headers are supplied per event")
    return dict(transport), workspace_id


def request_identity(record: dict) -> dict:
    return {key: record[key] for key in
            ("schema", "workspaceId", "operationId", "serializedSha256", "original")}


def recording_session(directory: Path, workspace_id: str):
    from requests import Session

    class ReceiptSession(Session):
        context: dict | None = None

        def send(self, request, **kwargs):
            context = self.context
            if context is None:
                raise ProducerError("Emit through WorkspaceProducer with an original operation ID")
            data = request.body
            wire = data.encode("utf-8") if isinstance(data, str) else bytes(data or b"")
            encoding = request.headers.get("Content-Encoding", "identity").lower()
            if encoding not in ("identity", "gzip"):
                raise ProducerError("The selected native transport must emit identity or gzip")
            decoded = gzip.decompress(wire) if encoding == "gzip" else wire
            candidate = {
                "schema": SCHEMA + ".request", "workspaceId": workspace_id,
                "operationId": context["operationId"], "original": context["original"],
                "serializedSha256": sha256(decoded), "serializedBytes": len(decoded),
                "wireSha256": sha256(wire), "wireBytes": len(wire),
                "contentEncoding": encoding, "contentType": request.headers["Content-Type"],
                "wireBase64": base64.b64encode(wire).decode("ascii"),
                "createdAt": now(),
            }
            record_path = directory / "requests" / (sha256(context["operationId"].encode()) + ".json")
            saved = atomic_json(record_path, candidate, first=True)
            if request_identity(saved) != request_identity(candidate):
                raise ProducerError("This operation ID already identifies a different original event")
            # A retry uses the first actual SDK-produced bytes, including its gzip header.
            original_wire = base64.b64decode(saved["wireBase64"], validate=True)
            if sha256(original_wire) != saved["wireSha256"] or len(original_wire) != saved["wireBytes"]:
                raise ProducerError("The retained original request is incomplete")
            original_decoded = gzip.decompress(original_wire) if saved["contentEncoding"] == "gzip" else original_wire
            if sha256(original_decoded) != saved["serializedSha256"]:
                raise ProducerError("The retained SDK serialization is incomplete")
            request.body = original_wire
            request.headers["Content-Type"] = saved["contentType"]
            request.headers["Content-Length"] = str(len(original_wire))
            request.headers["Idempotency-Key"] = context["operationId"]
            request.headers["X-OpenLineage-Workspace"] = workspace_id
            if saved["contentEncoding"] == "gzip":
                request.headers["Content-Encoding"] = "gzip"
            else:
                request.headers.pop("Content-Encoding", None)
            kwargs["allow_redirects"] = False
            response = super().send(request, **kwargs)
            if response.status_code != 200:
                atomic_json(directory / "failures" / record_path.name, {
                    "schema": SCHEMA + ".failure", "operationId": context["operationId"],
                    "at": now(), "status": response.status_code,
                    "retryAfter": response.headers.get("Retry-After"),
                    "wireSha256": saved["wireSha256"],
                })
                if response.status_code >= 400:
                    response.raise_for_status()
                raise ProducerError("The native receiver returned HTTP " + str(response.status_code))
            acknowledgement = response.json()
            source = acknowledgement.get("source", {})
            if (acknowledgement.get("workspaceId") != workspace_id
                    or acknowledgement.get("operationId") != context["operationId"]
                    or source.get("id") != saved["wireSha256"]
                    or source.get("bytes") != saved["wireBytes"]
                    or source.get("contentEncoding", "identity") != saved["contentEncoding"]
                    or not isinstance(acknowledgement.get("revision"), int)):
                raise ProducerError("The receiving acknowledgement does not match the original request")
            if saved["contentEncoding"] == "gzip" and (
                    source.get("decodedSha256") != saved["serializedSha256"]
                    or source.get("decodedBytes") != saved["serializedBytes"]):
                raise ProducerError("The receiver's decoded source differs from the native serialization")
            receipt = {
                "schema": SCHEMA + ".receipt", "sdk": "openlineage-python",
                "sdkVersion": SDK_VERSION, "transport": "HttpTransport",
                "workspaceId": workspace_id, "operationId": context["operationId"],
                "original": context["original"], "serializedSha256": saved["serializedSha256"],
                "wireSha256": saved["wireSha256"], "wireBytes": saved["wireBytes"],
                "contentEncoding": saved["contentEncoding"], "acknowledgedAt": now(),
                "acknowledgement": acknowledgement,
            }
            atomic_json(directory / "receipts" / record_path.name, receipt)
            context["receipt"] = receipt
            return response

    return ReceiptSession()


class WorkspaceProducer:
    """Emit native attrs event objects or original JSON objects through OpenLineage HttpTransport.

    The operation directory contains original wire bodies and receiving acknowledgements.
    Credentials remain in the caller's configuration or token file.
    """

    def __init__(self, config: dict, directory: str | Path):
        installed = importlib.metadata.version("openlineage-python")
        if installed != SDK_VERSION:
            raise ProducerError("This producer requires openlineage-python==" + SDK_VERSION)
        from openlineage.client.transport.http import HttpConfig, HttpTransport
        from openlineage.client.serde import Serde
        transport, self.workspace_id = checked_transport(config)
        self.directory = private_directory(Path(directory).resolve())
        saved = atomic_json(self.directory / "producer.json", {
            "schema": SCHEMA, "workspaceId": self.workspace_id,
            "sdkVersion": SDK_VERSION, "createdAt": now(),
        }, first=True)
        if saved.get("schema") != SCHEMA or saved.get("workspaceId") != self.workspace_id:
            raise ProducerError("The existing operation belongs to a different receiving workspace")
        self.session = recording_session(self.directory, self.workspace_id)
        native_config = HttpConfig.from_dict(transport)
        native_config.session = self.session
        self.transport = HttpTransport(native_config)
        self.serde = Serde
        self.lock = threading.Lock()

    def emit(self, event: Any, operation_id: str, *, original: dict | None = None) -> dict:
        if (not isinstance(operation_id, str) or not operation_id.strip()
                or len(operation_id) > 512 or any(c in operation_id for c in "\r\n\0")):
            raise ProducerError("Use a non-empty original operation ID of at most 512 characters")
        original = original or {}
        with self.lock:
            serialized = self.serde.to_json(event).encode("utf-8")
            record_name = sha256(operation_id.encode()) + ".json"
            receipt_path = self.directory / "receipts" / record_name
            if receipt_path.exists():
                receipt = read_json(receipt_path)
                if (receipt.get("schema") != SCHEMA + ".receipt"
                        or receipt.get("workspaceId") != self.workspace_id
                        or receipt.get("operationId") != operation_id
                        or receipt.get("serializedSha256") != sha256(serialized)
                        or receipt.get("original") != original):
                    raise ProducerError("The completed operation identifies a different original event")
                request = read_json(self.directory / "requests" / record_name)
                wire = base64.b64decode(request["wireBase64"], validate=True)
                if (request_identity(request) != {
                        "schema": SCHEMA + ".request", "workspaceId": self.workspace_id,
                        "operationId": operation_id, "serializedSha256": sha256(serialized),
                        "original": original}
                        or sha256(wire) != receipt.get("wireSha256")
                        or len(wire) != receipt.get("wireBytes")
                        or receipt.get("acknowledgement", {}).get("source", {}).get("id") != sha256(wire)):
                    raise ProducerError("The saved receipt no longer matches its original SDK request")
                return {**receipt, "delivery": "retained"}
            context = {"operationId": operation_id, "original": original}
            self.session.context = context
            try:
                # The released SDK performs serialization, compression, auth, retry and HTTP emission.
                self.transport.emit(event)
                if "receipt" not in context:
                    raise ProducerError("The native transport returned without a matching receiving acknowledgement")
                return {**context["receipt"], "delivery": "received"}
            finally:
                self.session.context = None

    def close(self) -> None:
        self.transport.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def prepare_inputs(directory: Path, inputs: list[Path], operation_id: str) -> dict:
    files = []
    for path in inputs:
        data = original_bytes(path)
        events = events_from(data)
        identity = sha256(data)
        encoded = {"sha256": identity, "bytes": len(data), "base64": base64.b64encode(data).decode("ascii")}
        saved = atomic_json(directory / "originals" / (identity + ".json"), encoded, first=True)
        if saved != encoded:
            raise ProducerError("The retained producer source differs from its original bytes")
        files.append({"name": path.name, "sha256": identity, "bytes": len(data), "events": len(events)})
    plan = {"schema": SCHEMA + ".plan", "operationId": operation_id, "files": files}
    saved = atomic_json(directory / "plan.json", plan, first=True)
    if saved != plan:
        raise ProducerError("Resume the original inputs and operation ID, or choose a new operation directory")
    return saved


def status(directory: Path) -> dict:
    plan_path = directory / "plan.json"
    plan = read_json(plan_path) if plan_path.exists() else None
    receipts = []
    for path in sorted((directory / "receipts").glob("*.json")):
        saved = read_json(path)
        receipts.append({key: saved[key] for key in
                         ("operationId", "workspaceId", "wireSha256", "sdkVersion", "acknowledgedAt")})
    requests = list((directory / "requests").glob("*.json"))
    return {
        "schema": SCHEMA + ".status", "directory": str(directory),
        "operationId": plan.get("operationId") if plan else None,
        "plannedEvents": sum(item["events"] for item in plan["files"]) if plan else None,
        "preparedRequests": len(requests), "acknowledgedEvents": len(receipts),
        "pendingRequests": [path.stem for path in requests if not (directory / "receipts" / path.name).exists()],
        "receipts": receipts,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("emit", "resume", "status"))
    parser.add_argument("--directory", required=True, type=Path)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--config", type=Path)
    source.add_argument("--connection", type=Path)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--compression", choices=("identity", "gzip"), default="gzip")
    parser.add_argument("--input", action="append", type=Path, default=[])
    parser.add_argument("--operation-id")
    args = parser.parse_args(argv)
    directory = private_directory(args.directory.resolve())
    if args.command == "status":
        print(json.dumps(status(directory), indent=2))
        return 0
    if args.config:
        if args.token_file:
            raise ProducerError("--token-file belongs to --connection; native --config already contains auth")
        # producer-config creates JSON, which is also accepted by the native YAML loader.
        config = read_json(args.config)
    elif args.connection:
        config = configuration(args.connection, args.token_file, args.compression)
    else:
        raise ProducerError("Select --config or the original --connection")
    if args.command == "emit":
        if not args.input or not args.operation_id:
            raise ProducerError("emit requires original --input files and --operation-id")
        plan = prepare_inputs(directory, args.input, args.operation_id)
    else:
        if args.input or args.operation_id:
            raise ProducerError("resume uses the original saved inputs and operation ID")
        plan = read_json(directory / "plan.json")
        if plan.get("schema") != SCHEMA + ".plan":
            raise ProducerError("The selected directory has no original producer plan")
    with WorkspaceProducer(config, directory) as producer:
        for file_index, file in enumerate(plan["files"]):
            saved = read_json(directory / "originals" / (file["sha256"] + ".json"))
            data = base64.b64decode(saved["base64"], validate=True)
            if sha256(data) != file["sha256"] or len(data) != file["bytes"]:
                raise ProducerError("An original producer input is incomplete")
            events = events_from(data)
            if len(events) != file["events"]:
                raise ProducerError("The original event selection changed")
            for event_index, event in enumerate(events):
                operation_id = plan["operationId"] + "/file-" + str(file_index + 1) + "/event-" + str(event_index + 1)
                producer.emit(event, operation_id, original={
                    "sourceSha256": file["sha256"], "sourceName": file["name"],
                    "fileIndex": file_index + 1, "eventIndex": event_index + 1,
                })
    result = status(directory)
    atomic_json(directory / "complete-result.json", result)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"error": str(error), "type": type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)
