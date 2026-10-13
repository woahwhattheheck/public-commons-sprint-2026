#!/usr/bin/env python3
"""Kestra task bridge for the original Datasette/Analysis workflow CLI.

Business state, receiving and result hashes belong to workflow_engine.py.
This module transports complete native messages and actual publication receipts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any


class FlowError(ValueError):
    pass


def json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def read_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"),
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          FlowError("Non-finite JSON value")))


def write_json(path: str | Path, value: Any) -> None:
    target = Path(path)
    target.write_bytes(json_bytes(value) + b"\n")
    target.chmod(0o600)


def identity(value: Any, name: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 200 or not value.isprintable():
        raise FlowError(name + " must be a printable original identifier (1–200 characters)")
    return value


def absolute_path(value: Any, name: str) -> Path:
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise FlowError(name + " must be an installed absolute path")
    return Path(value)


def deployment(path: str | Path) -> dict[str, Any]:
    result = read_json(path)
    if not isinstance(result, dict) or result.get("schema") != "stellar-forge.kestra-runtime.v1":
        raise FlowError("Unsupported Kestra runtime configuration")
    for key in ("analysisRoot", "workspace", "configuration", "receiverWorkspace"):
        absolute_path(result.get(key), key)
    if result.get("correlationMode") not in ("business-properties", "native-header"):
        raise FlowError("Select business-properties or native-header correlation")
    destination = result.get("resultDestination", {})
    if not destination.get("destinationName") or destination.get("destinationType") not in ("QUEUE", "TOPIC"):
        raise FlowError("Select the original result destination")
    return result


def workflow(config: dict[str, Any], command: str, *, receiver: bool = False, **values: Any) -> dict[str, Any]:
    cli = absolute_path(config["analysisRoot"], "analysisRoot") / "workflow_cli.py"
    executable = config.get("pythonExecutable") or sys.executable
    args = [str(executable), str(cli), command,
            "--workspace=" + config["receiverWorkspace" if receiver else "workspace"]]
    for key, value in values.items():
        if value is not None:
            args.append("--" + key.replace("_", "-") + "=" + str(value))
    completed = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", check=False)
    if completed.returncode:
        # Provider errors can include credentials. The original worker retains its
        # business history; task logs identify the command without echoing secrets.
        raise FlowError("Original workflow command failed: " + command
                        + " (exit " + str(completed.returncode) + ")")
    try:
        result = json.loads(completed.stdout)
    except (ValueError, TypeError) as error:
        raise FlowError("Original workflow returned invalid JSON: " + command) from error
    if not isinstance(result, dict):
        raise FlowError("Original workflow returned a non-object: " + command)
    return result


def validate_prepared(config: dict[str, Any], prepared: dict[str, Any], item: dict[str, Any]) -> None:
    body = item.get("data")
    headers = item.get("headers")
    if not isinstance(body, dict) or not isinstance(headers, dict):
        raise FlowError("The retained result must contain its complete body and JMS properties")
    if body.get("schema") != "stellar-forge.source-workflow-result.v1":
        raise FlowError("Unexpected result envelope schema")
    for key in ("requestId", "correlationId", "deliveryId"):
        identity(body.get(key), key)
    pairs = {"businessRequestId": "requestId", "businessCorrelationId": "correlationId",
             "deliveryId": "deliveryId", "resultSha256": "resultSha256"}
    for property_name, body_name in pairs.items():
        if headers.get(property_name) != body.get(body_name):
            raise FlowError("Retained JMS property differs from result: " + property_name)
    for key in ("requestId", "deliveryId", "resultSha256"):
        if prepared.get(key) != body.get(key):
            raise FlowError("Prepared publication differs from retained result: " + key)
    if item.get("correlationId") != body["correlationId"]:
        raise FlowError("Retained native correlation differs from result")
    actual_hash = hashlib.sha256(json_bytes(body.get("result"))).hexdigest()
    if body.get("resultSha256") != actual_hash:
        raise FlowError("Retained result hash does not match its complete result")
    expected = config["resultDestination"]
    actual = prepared.get("destination", {})
    for key in ("destinationName", "destinationType"):
        if actual.get(key) != expected[key]:
            raise FlowError("Installed result destination differs from retained publication: " + key)
    if actual.get("correlationMode", "business-properties") != config["correlationMode"]:
        raise FlowError("Installed correlation mode differs from retained publication")
    for key in ("replyTo", "replyToType"):
        if item.get(key) != expected.get(key):
            raise FlowError("Installed reply destination differs from retained publication: " + key)
    if config["correlationMode"] == "business-properties" and item.get("replyTo"):
        raise FlowError("A native JMSReplyTo contract requires native-header mode")


def prepare_publication(config: dict[str, Any], request_id: str, attempt_id: str) -> dict[str, Any]:
    prepared = workflow(config, "publish", request_id=request_id,
                        attempt_id=attempt_id, output=str(Path("jms-message.json").resolve()))
    item = read_json("jms-message.json")
    if item != prepared.get("jms"):
        raise FlowError("Exported JMS item differs from the original publication result")
    validate_prepared(config, prepared, item)
    write_json("prepared.json", prepared)
    return {"requestId": prepared["requestId"], "deliveryId": prepared["deliveryId"],
            "attemptId": prepared["attemptId"], "resultSha256": prepared["resultSha256"],
            "status": "RESULT_READY"}


def prepare(config: dict[str, Any], message_path: str, execution_id: str, attempt_id: str) -> dict[str, Any]:
    transport = read_json(message_path)
    if not isinstance(transport, dict) or "data" not in transport:
        raise FlowError("Expected the complete native JMSMessage object")
    data = transport["data"]
    if isinstance(data, str):
        raw = data.encode("utf-8")
        body = json.loads(data)
    elif isinstance(data, dict):
        raw = json_bytes(data)
        body = data
    else:
        raise FlowError("Native request data must be a JSON object or its original JSON text")
    if not isinstance(body, dict):
        raise FlowError("Business request must be a JSON object")
    request_id = identity(body.get("requestId"), "requestId")
    Path("business-request.json").write_bytes(raw)
    Path("business-request.json").chmod(0o600)
    accepted = workflow(config, "accept", request=str(Path("business-request.json").resolve()),
                        transport=str(Path(message_path).resolve()), execution_id=execution_id)
    if accepted.get("requestId") != request_id:
        raise FlowError("Accepted request changed the original request identity")
    workflow(config, "run", request_id=request_id, configuration=config["configuration"])
    return prepare_publication(config, request_id, attempt_id)


def record(config: dict[str, Any], prepared_path: str, receipt_path: str) -> dict[str, Any]:
    prepared = read_json(prepared_path)
    receipt = read_json(receipt_path)
    count = receipt.get("messagesCount") if isinstance(receipt, dict) else None
    if type(count) is not int or count != 1:
        raise FlowError("Actual producer output must report exactly one published message")
    for key in ("requestId", "deliveryId", "resultSha256"):
        if key in receipt and receipt[key] != prepared[key]:
            raise FlowError("Actual producer receipt differs from retained publication: " + key)
    result = workflow(config, "published", request_id=prepared["requestId"],
                      attempt_id=prepared["attemptId"], count=count,
                      receipt=str(Path(receipt_path).resolve()))
    write_json("publication.json", result)
    return result


def resolve_environment(shape: Any) -> Any:
    if isinstance(shape, dict):
        if set(shape) == {"$env"}:
            key = shape["$env"]
            if not isinstance(key, str) or not key.startswith("CONAPI_JMS_") or key not in os.environ:
                raise FlowError("A selected connection setting is unavailable")
            return os.environ[key]
        return {key: resolve_environment(value) for key, value in shape.items()}
    if isinstance(shape, list):
        return [resolve_environment(value) for value in shape]
    return shape


def publish_native(config: dict[str, Any], prepared_path: str, item_path: str,
                   shape_path: str, receipt_path: str) -> dict[str, Any]:
    if config["correlationMode"] != "native-header":
        raise FlowError("Native header publication requires the installed native-header mode")
    prepared, item = read_json(prepared_path), read_json(item_path)
    validate_prepared(config, prepared, item)
    resolved = resolve_environment(read_json(shape_path))
    helper = absolute_path(config.get("nativeHeaderJar"), "nativeHeaderJar")
    args = [str(config.get("javaExecutable") or "java"), "-jar", str(helper),
            "--message", str(Path(item_path).resolve()),
            "--prepared", str(Path(prepared_path).resolve())]
    completed = subprocess.run(args, input=json_bytes(resolved), capture_output=True, check=False)
    if completed.returncode:
        raise FlowError("Native header producer failed (exit " + str(completed.returncode)
                        + "); continue the original retained publication attempt")
    try:
        receipt = json.loads(completed.stdout)
    except (ValueError, TypeError) as error:
        raise FlowError("Native header producer returned an invalid publication receipt") from error
    if receipt.get("messagesCount") != 1 or receipt.get("correlationId") != item["correlationId"]:
        raise FlowError("Native header producer receipt does not match the original result")
    write_json(receipt_path, receipt)
    return receipt


def selection(values: dict[str, Any], mode: str) -> dict[str, Any]:
    for key in ("requestId", "correlationId", "deliveryId"):
        identity(values.get(key), key)
    digest = values.get("expectedResultSha256")
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise FlowError("Expected result hash must be the original lowercase SHA-256")
    quote = lambda value: "'" + value.replace("'", "''") + "'"
    terms = [
        "businessRequestId = " + quote(values["requestId"]),
        "businessCorrelationId = " + quote(values["correlationId"]),
        "deliveryId = " + quote(values["deliveryId"]),
    ]
    if mode == "native-header":
        terms.append("JMSCorrelationID = " + quote(values["correlationId"]))
    elif mode != "business-properties":
        raise FlowError("Unknown correlation mode")
    return {**values, "correlationMode": mode, "messageSelector": " AND ".join(terms)}


def receive(config: dict[str, Any], messages_path: str, selection_path: str) -> dict[str, Any]:
    chosen = selection(read_json(selection_path), config["correlationMode"])
    messages = read_json(messages_path)
    if not isinstance(messages, list):
        raise FlowError("Expected all rows from the original native Consume storage output")
    if not messages:
        result = {"schema": "stellar-forge.source-workflow-receiving.v1",
                  "requestId": chosen["requestId"], "deliveryId": chosen["deliveryId"],
                  "status": "WAITING", "count": 0, "receipts": []}
    else:
        receipts = []
        for index, message in enumerate(messages):
            message_path = Path("received-message-" + str(index) + ".json").resolve()
            write_json(message_path, message)
            receipts.append(workflow(config, "receive-result", receiver=True,
                            message=str(message_path), request_id=chosen["requestId"],
                            correlation_id=chosen["correlationId"], delivery_id=chosen["deliveryId"],
                            expected_result_sha256=chosen["expectedResultSha256"],
                            correlation_mode=config["correlationMode"]))
        result = {"schema": "stellar-forge.source-workflow-receiving.v1",
                  "requestId": chosen["requestId"], "deliveryId": chosen["deliveryId"],
                  "status": "RECEIVED", "count": len(receipts), "receipts": receipts}
        if len(receipts) == 1:
            write_json("receipt.json", receipts[0])
    write_json("receiving.json", result)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("prepare", "recover", "record", "publish-native",
                                              "select", "receive", "acknowledge"))
    parser.add_argument("--deployment", default="runtime.json")
    parser.add_argument("--message", default="transport.json")
    parser.add_argument("--prepared", default="prepared.json")
    parser.add_argument("--receipt", default="producer-receipt.json")
    parser.add_argument("--connection-shape", default="connection-shape.json")
    parser.add_argument("--selection", default="selection.json")
    parser.add_argument("--messages", default="messages.json")
    parser.add_argument("--execution-id", default=os.environ.get("CONAPI_EXECUTION_ID"))
    parser.add_argument("--attempt-id", default=os.environ.get("CONAPI_ATTEMPT_ID"))
    parser.add_argument("--request-id", default=os.environ.get("CONAPI_REQUEST_ID"))
    args = parser.parse_args(argv)
    try:
        os.umask(0o077)
        config = deployment(args.deployment)
        if args.operation == "prepare":
            execution_id = identity(args.execution_id, "executionId")
            attempt_id = args.attempt_id or "kestra-" + hashlib.sha256(
                execution_id.encode("utf-8")).hexdigest()[:32]
            result = prepare(config, args.message, execution_id, attempt_id)
        elif args.operation == "recover":
            result = prepare_publication(config, identity(args.request_id, "requestId"),
                                         identity(args.attempt_id, "attemptId"))
        elif args.operation == "record":
            result = record(config, args.prepared, args.receipt)
        elif args.operation == "publish-native":
            result = publish_native(config, args.prepared, args.message,
                                    args.connection_shape, args.receipt)
        elif args.operation == "select":
            result = selection(read_json(args.selection), config["correlationMode"])
            write_json("selector.json", result)
        elif args.operation == "receive":
            result = receive(config, args.messages, args.selection)
        else:
            result = workflow(config, "acknowledge", request_id=identity(args.request_id, "requestId"),
                              receipt=str(Path(args.receipt).resolve()))
            write_json("acknowledgement.json", result)
        # Full native objects stay in output files and the original worker history.
        print(json.dumps({key: result[key] for key in (
            "schema", "status", "requestId", "deliveryId", "attemptId", "resultSha256",
            "messagesCount", "count") if key in result}, ensure_ascii=False))
        return 0
    except (FlowError, OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"error": {"code": "KESTRA_WORKFLOW_FAILED",
                                   "type": type(error).__name__,
                                   "message": str(error) if isinstance(error, FlowError)
                                   else "Could not process the selected workflow input"}}
                         ), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
