"""MIT. Official Confluent client capture with original Kafka positions and bytes."""
from __future__ import annotations
import importlib
import os
from pathlib import Path
import time
import sys

from shared import InputError
from contract import now, config as validate_config, wire, b64, MAX_SOURCE

REQUIREMENT = "confluent-kafka==2.16.0"


class CaptureProblem(InputError):
    def __init__(self, status, message, detail=None):
        super().__init__(message)
        self.status = status
        self.detail = detail or {}


def client_status():
    result = {"available": False, "pythonPackage": "confluent-kafka", "version": None,
              "libraryVersion": None, "requirement": REQUIREMENT}
    try:
        package = importlib.import_module("confluent_kafka")
        version = package.version()[0]
        result.update(version=version, libraryVersion=package.libversion()[0])
        if version != "2.16.0":
            result["message"] = "Select the declared " + REQUIREMENT + " in this application's Python environment"
        else:
            result["available"] = True
    except (ImportError, OSError):
        result["message"] = "Install " + REQUIREMENT + " in the selected Python environment to capture a broker; retained files and the console remain available"
    return result


def native():
    status = client_status()
    if not status["available"]:
        raise InputError(status["message"])
    from confluent_kafka import Consumer, TopicPartition, TopicCollection, IsolationLevel, KafkaError
    from confluent_kafka.admin import AdminClient, OffsetSpec
    return Consumer, TopicPartition, TopicCollection, IsolationLevel, KafkaError, AdminClient, OffsetSpec


def properties(raw, group):
    raw = validate_config(raw)
    security = raw["security"]
    result = {"bootstrap.servers": ",".join(raw["brokers"]),
              "security.protocol": security["protocol"],
              "socket.timeout.ms": raw["requestTimeoutSeconds"] * 1000,
              "api.version.request.timeout.ms": raw["requestTimeoutSeconds"] * 1000,
              "client.id": "stellar-forge-kafka", "log_level": 0}
    references = {"usernameEnv": "sasl.username", "passwordEnv": "sasl.password",
                  "caFileEnv": "ssl.ca.location", "certificateFileEnv": "ssl.certificate.location",
                  "keyFileEnv": "ssl.key.location", "keyPasswordEnv": "ssl.key.password"}
    if "mechanism" in security:
        result["sasl.mechanism"] = security["mechanism"]
    for key, target in references.items():
        if key not in security:
            continue
        reference = security[key]
        value = os.environ.get(reference)
        if not value or "\x00" in value:
            raise InputError("Set the private environment reference " + reference + " in the original console process")
        if key.endswith("FileEnv"):
            path = Path(value).expanduser()
            if not path.is_absolute() or not path.is_file():
                raise InputError("The private TLS file reference " + reference + " must select an existing absolute file")
        result[target] = value
    if group is not None:
        result.update({
            "group.id": "stellar-forge-capture-" + group[:48],
            "enable.auto.commit": False, "enable.auto.offset.store": False,
            "auto.offset.reset": "error", "enable.partition.eof": True,
            "isolation.level": "read_committed", "allow.auto.create.topics": False,
            "fetch.message.max.bytes": raw["maxMessageBytes"],
            "fetch.max.bytes": min(MAX_SOURCE, max(raw["maxMessageBytes"], 16 * 1024 * 1024)),
            "receive.message.max.bytes": max(raw["maxMessageBytes"] + 1024 * 1024, 32 * 1024 * 1024),
            "queued.max.messages.kbytes": 16384,
        })
    return result


def native_error(error, config):
    """Keep the real provider error while excluding resolved credential values."""
    message = str(error)
    for key, reference in config["security"].items():
        if key.endswith("Env"):
            value = os.environ.get(reference)
            if value:
                message = message.replace(value, "<private:" + reference + ">")
    return message[:2000]


def inspect_source(raw, group, consumer=None, cancelled=None):
    _, TopicPartition, TopicCollection, IsolationLevel, _, AdminClient, OffsetSpec = native()
    from concurrent.futures import TimeoutError as FutureTimeout
    raw = validate_config(raw)
    timeout = raw["requestTimeoutSeconds"]
    admin = AdminClient(properties(raw, None))
    deadline = time.monotonic() + timeout + 1
    def result(future):
        while True:
            if cancelled is not None and cancelled.is_set():
                raise CaptureProblem("CANCELLED", "The original Kafka capture was cancelled during metadata retrieval")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise InputError("The original Kafka metadata request timed out")
            try:
                return future.result(timeout=min(0.25, remaining))
            except FutureTimeout:
                continue
    try:
        cluster_future = admin.describe_cluster(request_timeout=timeout)
        described = admin.describe_topics(TopicCollection([raw["topic"]]), request_timeout=timeout)
        cluster = result(cluster_future)
        topic = result(described[raw["topic"]])
        cluster_id = getattr(cluster, "cluster_id", None)
        topic_id = str(topic.topic_id) if getattr(topic, "topic_id", None) is not None else None
        if not cluster_id or not topic_id or topic_id in {"AAAAAAAAAAAAAAAAAAAAAA", "00000000-0000-0000-0000-000000000000"}:
            raise InputError("The broker must expose its original cluster identity and topic UUID for resumable capture")
        partitions = sorted(part.id for part in topic.partitions)
        if not partitions or len(partitions) > 4096:
            raise InputError("Select a Kafka topic with 1–4096 native partitions")
        tps = [TopicPartition(raw["topic"], part) for part in partitions]
        earliest = admin.list_offsets({tp: OffsetSpec.earliest() for tp in tps},
            isolation_level=IsolationLevel.READ_UNCOMMITTED, request_timeout=timeout)
        high = admin.list_offsets({tp: OffsetSpec.latest() for tp in tps},
            isolation_level=IsolationLevel.READ_UNCOMMITTED, request_timeout=timeout)
        latest = admin.list_offsets({tp: OffsetSpec.latest() for tp in tps},
            isolation_level=IsolationLevel.READ_COMMITTED, request_timeout=timeout)
        output = []
        for tp in tps:
            low, upper, end = result(earliest[tp]).offset, result(high[tp]).offset, result(latest[tp]).offset
            if any(type(number) is not int or not 0 <= number <= 9223372036854775807 for number in (low, upper, end)) or not low <= end <= upper:
                raise InputError("The broker returned inconsistent original committed offsets; refresh its metadata")
            output.append({"partition": tp.partition, "low": str(low), "high": str(upper),
                           "end": str(end), "observedAt": now()})
        return {"observedAt": now(), "client": client_status(), "clusterId": cluster_id,
                "topicId": topic_id, "topic": raw["topic"], "partitions": output}
    except (InputError, KeyboardInterrupt):
        raise
    except Exception as error:
        raise InputError("Native Kafka metadata failed: " + native_error(error, raw)) from error
    finally:
        del admin

def require_consumer_cluster(consumer, expected, raw, cancelled):
    _, _, _, _, KafkaError, _, _ = native()
    deadline = time.monotonic() + raw["requestTimeoutSeconds"]
    while True:
        if cancelled.is_set():
            raise CaptureProblem("CANCELLED", "The original Kafka capture was cancelled during consumer binding")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise CaptureProblem("ERROR", "The actual Kafka consumer did not return its cluster identity before the native timeout")
        try:
            cluster_id = consumer.cluster_id(timeout=min(0.25, remaining))
        except Exception as issue:
            error = issue.args[0] if getattr(issue, "args", ()) else None
            if hasattr(error, "code") and error.code() == KafkaError._TIMED_OUT:
                continue
            raise CaptureProblem("ERROR", "The actual Kafka consumer identity failed: " + native_error(issue, raw)) from issue
        if cluster_id is None:
            continue
        if cluster_id != expected:
            raise CaptureProblem("SOURCE_CHANGED", "The actual Kafka consumer and retained metadata identify different clusters",
                                 {"expectedClusterId": expected, "consumerClusterId": cluster_id})
        return cluster_id


def message_wire(message, identity):
    timestamp_type, timestamp = message.timestamp()
    types = {0: "NOT_AVAILABLE", 1: "CREATE_TIME", 2: "LOG_APPEND_TIME"}
    if timestamp_type not in types:
        raise InputError("The native Kafka message returned an unknown timestamp type")
    epoch = message.leader_epoch()
    raw = {"schema": "stellar-forge.kafka-message.v1",
        "clusterId": identity["clusterId"], "topicId": identity["topicId"],
        "topic": message.topic(), "partition": message.partition(), "offset": str(message.offset()),
        "timestampType": types[timestamp_type],
        "timestampMs": None if timestamp_type == 0 else str(timestamp),
        "leaderEpoch": None if epoch is None or epoch < 0 else epoch,
        "keyBase64": b64(message.key()), "valueBase64": b64(message.value()),
        "headers": [{"name": name, "valueBase64": b64(value)} for name, value in (message.headers() or [])]}
    return wire(raw)


def capture_batches(raw, capture, cancelled):
    """Yield native batches; caller commits bytes and checkpoints in one SQLite transaction."""
    Consumer, TopicPartition, _, _, KafkaError, _, _ = native()
    raw = validate_config(raw)
    consumer = Consumer(properties(raw, capture["id"]))
    failure = None
    try:
        observed = inspect_source(raw, capture["id"], consumer, cancelled)
        if any(observed[key] != capture[key] for key in ("clusterId", "topicId", "topic")):
            raise CaptureProblem("SOURCE_CHANGED", "The native cluster or topic identity changed; retain this operation and inspect the intended topic", observed)
        observed["consumerClusterId"] = require_consumer_cluster(consumer, observed["clusterId"], raw, cancelled)
        metadata = {row["partition"]: row for row in observed["partitions"]}
        positions, ends = {}, {}
        for row in capture["ranges"]:
            part, next_offset, end = row["partition"], int(row["next"]), int(row["end"])
            if part not in metadata:
                raise CaptureProblem("SOURCE_CHANGED", "A selected original partition is no longer present", {"partition": part})
            current = metadata[part]
            if next_offset < end and int(current["low"]) > next_offset:
                raise CaptureProblem("SOURCE_GAP", "Kafka retention advanced beyond the retained next offset", {
                    "partition": part, "next": str(next_offset), "low": current["low"], "end": row["end"]})
            if next_offset < end and int(current["high"]) < end:
                raise CaptureProblem("SOURCE_CHANGED", "The native log end moved behind the selected original range", {
                    "partition": part, "selectedEnd": row["end"], "currentHigh": current["high"]})
            positions[part], ends[part] = next_offset, end
        active = {part for part in positions if positions[part] < ends[part]}
        consumer.assign([TopicPartition(raw["topic"], part, positions[part]) for part in sorted(active)])
        yield {"kind": "observed", "inspection": observed}
        pending, terminals = [], {}
        for part in positions.keys() - active:
            retained_range = next(row for row in capture["ranges"] if row["partition"] == part)
            terminals[part] = retained_range.get("terminalEvidence") or {
                "kind": "RETAINED_END", "observedOffset": str(positions[part]), "observedAt": now()}
        current_records, current_bytes = capture["records"], capture["retainedBytes"]
        last_progress = last_flush = time.monotonic()
        while active and not cancelled.is_set():
            message = consumer.poll(0.25)
            clock = time.monotonic()
            if message is not None:
                part = message.partition()
                error = message.error()
                if error is not None:
                    if error.code() == KafkaError._PARTITION_EOF:
                        if part not in positions or message.topic() != raw["topic"]:
                            raise CaptureProblem("SOURCE_CHANGED", "The native consumer returned an unassigned EOF topic or partition")
                        observed_offset = message.offset()
                        if part in active and observed_offset >= ends[part]:
                            positions[part] = ends[part]
                            terminals[part] = {"kind": "PARTITION_EOF", "observedOffset": str(observed_offset), "observedAt": now()}
                            active.remove(part)
                            consumer.pause([TopicPartition(raw["topic"], part)])
                            last_progress = clock
                    else:
                        raise CaptureProblem("ERROR", "Native Kafka capture failed: " + native_error(error, raw),
                                             {"code": error.code(), "name": error.name()})
                else:
                    if part not in positions or message.topic() != raw["topic"]:
                        raise CaptureProblem("SOURCE_CHANGED", "The native consumer returned an unassigned data topic or partition")
                    if part not in active:
                        continue
                    offset = message.offset()
                    if offset < positions[part]:
                        raise CaptureProblem("SOURCE_CHANGED", "The original consumer moved behind its retained assigned offset", {
                            "partition": part, "next": str(positions[part]), "observedOffset": str(offset)})
                    record = message_wire(message, observed)
                    boundary = offset >= ends[part]
                    if (record["payloadBytes"] > raw["maxMessageBytes"] or (not boundary and current_records + 1 > raw["maxCaptureRecords"]) or current_bytes + record["bytes"] > raw["maxCaptureBytes"]):
                        if pending or terminals:
                            yield {"kind": "batch", "messages": pending, "positions": dict(positions), "terminals": terminals}
                            pending, terminals = [], {}
                        raise CaptureProblem("LIMIT_REACHED", "The selected capture reached its original record or byte limit; retain this range and review its exact partial coverage", {
                            "partition": part, "next": str(positions[part]), "observedOffset": str(offset), "messageBytes": record["payloadBytes"], "retainedWireBytes": record["bytes"]})
                    pending.append({"record": record, "role": "boundary" if boundary else "record"})
                    current_bytes += record["bytes"]
                    if boundary:
                        positions[part] = ends[part]
                        terminals[part] = {"kind": "BOUNDARY_RECORD", "observedOffset": str(offset),
                                           "eventId": record["id"], "sha256": record["sha256"], "observedAt": now()}
                        active.remove(part)
                        consumer.pause([TopicPartition(raw["topic"], part)])
                    else:
                        positions[part] = offset + 1
                        current_records += 1
                        if positions[part] >= ends[part]:
                            terminals[part] = {"kind": "LAST_SELECTED_RECORD", "observedOffset": str(offset + 1),
                                               "eventId": record["id"], "sha256": record["sha256"], "observedAt": now()}
                            active.remove(part)
                            consumer.pause([TopicPartition(raw["topic"], part)])
                    last_progress = clock
            if pending or terminals:
                if len(pending) >= 100 or clock - last_flush >= 0.5 or not active:
                    yield {"kind": "batch", "messages": pending, "positions": dict(positions), "terminals": terminals}
                    pending, terminals = [], {}
                    last_flush = clock
            if active and clock - last_progress > max(10, raw["requestTimeoutSeconds"] * 2):
                if pending or terminals:
                    yield {"kind": "batch", "messages": pending, "positions": dict(positions), "terminals": terminals}
                raise CaptureProblem("ERROR", "The original consumer made no progress before its native request window ended; resume this same capture when the broker is ready")
        if pending or terminals:
            yield {"kind": "batch", "messages": pending, "positions": dict(positions), "terminals": terminals}
        final_status = "CANCELLED" if cancelled.is_set() and active else "COMPLETE"
        if final_status == "COMPLETE":
            verified = inspect_source(raw, capture["id"], consumer, cancelled)
            verified["consumerClusterId"] = require_consumer_cluster(consumer, verified["clusterId"], raw, cancelled)
            if any(verified[key] != capture[key] for key in ("clusterId", "topicId", "topic")):
                raise CaptureProblem("SOURCE_CHANGED", "The native topic identity changed during capture; retain these observations and inspect the intended topic", verified)
            yield {"kind": "verified", "inspection": verified}
        consumer.close()
        consumer = None
        yield {"kind": "finished", "status": final_status}
    except (InputError, KeyboardInterrupt) as issue:
        failure = issue
        raise
    except Exception as issue:
        failure = CaptureProblem("ERROR", "Native Kafka capture failed: " + native_error(issue, raw))
        raise failure from issue
    finally:
        if consumer is not None:
            try:
                consumer.close()
            except Exception as cleanup:
                if isinstance(failure, CaptureProblem):
                    failure.detail["cleanupError"] = native_error(cleanup, raw)
                elif failure is None:
                    raise CaptureProblem("ERROR", "The original Kafka consumer did not close cleanly: " + native_error(cleanup, raw)) from cleanup
