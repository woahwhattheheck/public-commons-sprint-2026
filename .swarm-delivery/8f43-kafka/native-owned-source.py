#!/usr/bin/env python3
"""MIT. Publish and recover one owned local Kafka source through the real native protocol."""
from __future__ import annotations
import argparse
import base64
from collections import Counter
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import uuid

OPERATION = "SCF-KAFKA-MERCHANT-8F43-20261012"
SCHEMA = "stellar-forge.kafka-owned-native-source.v1"


def encoded(value):
    return None if value is None else base64.b64encode(value).decode("ascii")


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def atomic(path, data, same=False):
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            os.chmod(temporary, 0o600)
            output.write(data); output.flush(); os.fsync(output.fileno())
        if same:
            try:
                os.link(temporary, path)
            except FileExistsError:
                if path.is_symlink() or path.read_bytes() != data:
                    raise RuntimeError("The original owned-topic source input changed")
        else:
            os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description="Seed one owned loopback Kafka topic with exact retained input")
    parser.add_argument("--root", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--broker", required=True)
    parser.add_argument("--topic", default="sf30-kafka-8f43-native-receiving-20261012")
    args = parser.parse_args()
    if not re.fullmatch(r"127\.0\.0\.1:[1-9][0-9]{0,4}", args.broker) or int(args.broker.rsplit(":", 1)[1]) > 65535:
        raise RuntimeError("This publisher accepts only the selected owned loopback broker")
    if args.topic != "sf30-kafka-8f43-native-receiving-20261012":
        raise RuntimeError("Retain this operation's dedicated owned demonstration topic")
    root = Path(args.root).expanduser().absolute()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = root.lstat()
    if root.resolve() != root or info.st_uid != os.getuid() or info.st_mode & 0o077 or not root.is_dir():
        raise RuntimeError("Use the same original private native source directory")
    with os.fdopen(os.open(root / "producer.lock", os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600), "r+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        sys.path.insert(0, str(Path(args.source_root).resolve(strict=True) / "kafka"))
        from transport import native, properties
        from model import Workspace
        from contract import api_bytes
        native()  # Select the exact declared confluent-kafka 2.16.0 implementation.
        from confluent_kafka import Producer, KafkaException, KafkaError
        from confluent_kafka.admin import AdminClient, NewTopic
        config = {"schema": "stellar-forge.kafka-connection.v1",
            "label": "Owned Apache Kafka receiving topic", "brokers": [args.broker],
            "topic": args.topic, "security": {"protocol": "PLAINTEXT"},
            "requestTimeoutSeconds": 30, "maxMessageBytes": 1048576,
            "maxCaptureBytes": 16777216, "maxCaptureRecords": 10000}
        common = properties(config, None)
        admin = AdminClient(common)
        cluster = str(admin.describe_cluster(request_timeout=30).result(30).cluster_id)
        input_path = root / "source-input.json"
        if input_path.exists():
            original = json.loads(input_path.read_bytes())
            if original.get("schema") != SCHEMA or original.get("operation") != OPERATION or original.get("clusterId") != cluster or original.get("config") != config:
                raise RuntimeError("The selected native broker differs from this retained original source")
            timestamp = original["timestampMs"]
        else:
            timestamp = int(time.time() * 1000)
        rows = [
            (0, b"customer-42", b'{"customer":"customer-42","balance":18446744073709551615,"price":1.2300,"active":true}', [("dbz.op", b"c"), ("tag", b"one"), ("tag", b"two")]),
            (0, b"customer-42", b'{"customer":"customer-42","balance":18446744073709551615,"price":1.2300,"active":true}', [("dbz.op", b"c"), ("tag", b"one"), ("tag", b"two")]),
            (0, b"", b"null", [("dbz.op", b"c")]),
            (0, b"gone", None, [("dbz.op", b"d")]),
            (0, b"customer-42", b'{"customer":"customer-42","balance":18446744073709551614,"price":2.0000,"active":false}', [("dbz.op", b"u")]),
            (0, b"deleted-row", b'{"customer":"deleted-row","reason":"withdrawn"}', [("dbz.op", b"d")]),
            (1, b"\xff", b"\x00\xff", [("binary", None), ("binary", b"")]),
            (1, b"empty-value", b"", [("dbz.op", b"u")]),
            (1, None, b'{"notice":"unkeyed"}', [("dbz.op", b"c")]),
            (1, b"other-customer", b'{"empty":"","nullable":null,"quantity":0}', [("dbz.op", b"c")]),
            (1, b"other-customer", None, [("dbz.op", b"d")]),
            (1, b"ambiguous", b'{"operation":"retained-as-supplied"}', [("dbz.op", b"c"), ("dbz.op", b"u")]),
        ]
        identity = hashlib.sha256(json_bytes({"operation": OPERATION, "timestampMs": timestamp,
            "clusterId": cluster, "topic": args.topic})).hexdigest().encode()
        expected = []
        for partition, key, value, headers in rows:
            retained_headers = headers + [("sf30.receiving.source", identity)]
            expected.append({"partition": partition, "timestampMs": str(timestamp),
                "keyBase64": encoded(key), "valueBase64": encoded(value),
                "headers": [{"name": name, "valueBase64": encoded(body)} for name, body in retained_headers]})
        source_input = {"schema": SCHEMA, "operation": OPERATION, "clusterId": cluster,
            "config": config, "timestampMs": timestamp, "records": expected,
            "sourceKind": "owned-local-native-kafka", "producer": "confluent-kafka==2.16.0"}
        atomic(input_path, json_bytes(source_input), same=True)
        request = {"connection": "owned-kafka-8f43", "expectedRevision": 0,
            "operation": OPERATION + ":source-connection", "config": config}
        atomic(root / "connection-request.json", json_bytes(request), same=True)
        try:
            admin.create_topics([NewTopic(args.topic, num_partitions=2, replication_factor=1, config={
                "cleanup.policy": "delete", "retention.ms": "604800000",
                "min.insync.replicas": "1", "message.timestamp.type": "CreateTime"})],
                request_timeout=30, operation_timeout=30)[args.topic].result(30)
        except KafkaException as error:
            if not error.args or error.args[0].code() != KafkaError.TOPIC_ALREADY_EXISTS:
                raise
        producer = Producer(common | {"transactional.id": "sf30-kafka-8f43-native-source-20261012",
            "enable.idempotence": True, "acks": "all", "transaction.timeout.ms": 60000})
        producer.init_transactions(60)
        current_transaction = False
        workspace = root / "source-observations"

        def read_original_source(label):
            with Workspace(workspace, create=not workspace.exists()) as ws:
                connection = ws.save_connection(request)
                name = OPERATION + ":" + label + ":" + uuid.uuid4().hex[:12]
                inspection = ws.inspect_connection({"connection": connection["id"], "revision": connection["revision"],
                    "operation": name + ":inspect"})
                capture = ws.prepare_capture({"inspection": inspection["id"], "operation": name + ":capture",
                    "ranges": [{"partition": row["partition"], "start": row["low"], "end": row["end"]}
                               for row in inspection["partitions"]]})
                capture = ws.run_capture(capture["id"], capture["revision"])
                if capture["status"] != "COMPLETE":
                    atomic(root / (label + "-capture.json"), api_bytes(capture))
                    raise RuntimeError("The original native source read returned " + capture["status"])
                messages = []
                page = ws.messages(capture["id"], 0, 200)
                if page["total"] > 200:
                    raise RuntimeError("The owned demonstration topic contains another operation's source")
                for item in page["messages"]:
                    messages.append(ws.message(item["id"]))
                atomic(root / (label + "-capture.json"), api_bytes({"inspection": inspection,
                    "capture": capture, "messages": messages}))
                return inspection, capture, messages

        def selected_fields(message):
            return {name: message[name] for name in ("partition", "timestampMs", "keyBase64", "valueBase64", "headers")}

        def verify(messages):
            actual = [selected_fields(message) for message in messages]
            if actual != expected:
                raise RuntimeError("The native committed source does not match the complete original owned input")
            ids = [message["id"] for message in messages]
            if len(set(ids)) != len(expected):
                raise RuntimeError("The original consumer collapsed distinct native offsets")
            return [{"id": message["id"], "partition": message["partition"], "offset": message["offset"],
                "sha256": message["sha256"], "valueState": message["valueState"],
                "goldskyOperation": message["goldskyOperation"]} for message in messages]

        deliveries, delivery_errors = [], []
        def delivered(error, message):
            if error is not None:
                delivery_errors.append(str(error))
            else:
                deliveries.append({"topic": message.topic(), "partition": message.partition(),
                    "offset": str(message.offset())})
        try:
            before, before_capture, prior = read_original_source("before")
            if prior:
                retained = verify(prior)
                final_inspection, final_capture = before, before_capture
            else:
                # One actual aborted record makes native offsets non-dense.
                producer.begin_transaction(); current_transaction = True
                producer.produce(args.topic, partition=0, key=b"aborted-owned-record",
                    value=b'{"committed":false}', timestamp=timestamp,
                    headers=[("sf30.receiving.source", identity)], on_delivery=delivered)
                if producer.flush(30) or delivery_errors:
                    raise RuntimeError("The owned source producer did not deliver its original transaction")
                producer.abort_transaction(30); current_transaction = False
                atomic(root / "aborted-transaction.json", json_bytes({"status": "ABORTED",
                    "deliveries": deliveries.copy(), "sourceInputSha256": hashlib.sha256(input_path.read_bytes()).hexdigest()}))
                deliveries.clear()
                producer.begin_transaction(); current_transaction = True
                for partition, key, value, headers in rows:
                    producer.produce(args.topic, partition=partition, key=key, value=value, timestamp=timestamp,
                        headers=headers + [("sf30.receiving.source", identity)], on_delivery=delivered)
                if producer.flush(30) or delivery_errors:
                    raise RuntimeError("The owned source producer did not deliver its complete original input")
                producer.commit_transaction(30); current_transaction = False
                atomic(root / "committed-delivery.json", json_bytes({"status": "COMMITTED",
                    "deliveries": deliveries, "sourceInputSha256": hashlib.sha256(input_path.read_bytes()).hexdigest()}))
                final_inspection, final_capture, messages = read_original_source("committed")
                retained = verify(messages)
            result = {"schema": SCHEMA, "operation": OPERATION, "status": "COMPLETE",
                "sourceKind": "owned-local-native-kafka", "clusterId": cluster,
                "topicId": final_inspection["topicId"], "topic": args.topic,
                "client": final_inspection["client"], "records": len(retained),
                "sourceInputSha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
                "capture": final_capture, "messages": retained, "connectionRequest": str(root / "connection-request.json")}
            atomic(root / "result.json", api_bytes(result))
            print(json.dumps({"operation": OPERATION, "status": result["status"], "records": len(retained),
                "topic": args.topic, "topicId": result["topicId"]}), flush=True)
        finally:
            if current_transaction:
                try:
                    producer.abort_transaction(30)
                except Exception:
                    pass
            producer.flush(5)
            del producer
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print("Owned native Kafka source: " + str(error), file=sys.stderr, flush=True)
        sys.exit(1)
