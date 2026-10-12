"""MIT. Exact Kafka configuration, source identity and lossless event projection."""
from __future__ import annotations
import base64
import binascii
from datetime import datetime, timezone
import hashlib
import json
import re

from shared import InputError, json_bytes, ndjson_source

MAX_SOURCE = 256 * 1024 * 1024
HEX = re.compile(r"[0-9a-f]{64}\Z")
OPERATION = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")
ENV = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,127}\Z")
OFFSET = re.compile(r"(0|[1-9][0-9]{0,18})\Z")
BROKER = re.compile(r"(?:[A-Za-z0-9][A-Za-z0-9.-]*|\[[0-9A-Fa-f:]+\]):[0-9]{1,5}\Z")
ACTIVE = {"RUNNING", "CANCELLING"}
STATUS = {"PREPARED", "RUNNING", "CANCELLING", "CANCELLED", "INTERRUPTED",
          "COMPLETE", "LIMIT_REACHED", "SOURCE_GAP", "SOURCE_CHANGED", "SOURCE_CONFLICT", "ERROR"}
WIRE_KEYS = {"schema", "clusterId", "topicId", "topic", "partition", "offset",
             "timestampType", "timestampMs", "leaderEpoch", "keyBase64", "valueBase64", "headers"}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def ident(value):
    if not isinstance(value, str) or not HEX.fullmatch(value):
        raise InputError("Choose a complete retained Kafka identifier")
    return value


def operation(value):
    if not isinstance(value, str) or not OPERATION.fullmatch(value):
        raise InputError("Operation and connection names require 1–128 letters, digits, periods, colons, dashes or underscores")
    return value


def exact(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= set(value) or set(value) - set(required) - set(optional):
        raise InputError("Expected exactly these fields: " + ", ".join(sorted(required)))
    return value


def integer(value, low, high, label):
    if type(value) is not int or not low <= value <= high:
        raise InputError(f"{label} must be an integer from {low} to {high}")
    return value


def offset(value):
    if not isinstance(value, str) or not OFFSET.fullmatch(value) or int(value) > 9223372036854775807:
        raise InputError("Kafka offsets must be exact nonnegative signed-64-bit decimal strings")
    return value


def label(value, maximum=160):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise InputError("Choose a short printable label")
    return value


def config(raw):
    exact(raw, {"schema", "label", "brokers", "topic", "security", "requestTimeoutSeconds",
                "maxMessageBytes", "maxCaptureBytes", "maxCaptureRecords"})
    if raw["schema"] != "stellar-forge.kafka-connection.v1":
        raise InputError("Choose the original Kafka connection schema")
    label(raw["label"])
    brokers = raw["brokers"]
    if not isinstance(brokers, list) or not 1 <= len(brokers) <= 32 or any(not isinstance(item, str) for item in brokers) or len(set(brokers)) != len(brokers):
        raise InputError("Supply 1–32 unique Kafka host:port brokers")
    for broker in brokers:
        if not isinstance(broker, str) or len(broker) > 300 or not BROKER.fullmatch(broker) or not 1 <= int(broker.rsplit(":", 1)[1]) <= 65535:
            raise InputError("Kafka brokers must be explicit host:port or [IPv6]:port addresses")
    topic = raw["topic"]
    if not isinstance(topic, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,249}", topic) or topic in {".", ".."}:
        raise InputError("Choose one exact Kafka topic name")
    security = raw["security"]
    exact(security, {"protocol"}, {"mechanism", "usernameEnv", "passwordEnv", "caFileEnv",
                                  "certificateFileEnv", "keyFileEnv", "keyPasswordEnv"})
    protocol = security["protocol"]
    if protocol not in {"PLAINTEXT", "SSL", "SASL_PLAINTEXT", "SASL_SSL"}:
        raise InputError("Choose PLAINTEXT, SSL, SASL_PLAINTEXT or SASL_SSL")
    sasl = {"mechanism", "usernameEnv", "passwordEnv"}
    tls = {"caFileEnv", "certificateFileEnv", "keyFileEnv", "keyPasswordEnv"}
    if protocol.startswith("SASL"):
        if not sasl <= set(security) or security["mechanism"] not in {"PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"}:
            raise InputError("SASL requires its mechanism and private username/password environment references")
    elif set(security) & sasl:
        raise InputError("Choose a SASL protocol before supplying SASL references")
    if not protocol.endswith("SSL") and set(security) & tls:
        raise InputError("Choose TLS before supplying certificate references")
    if bool(security.get("certificateFileEnv")) != bool(security.get("keyFileEnv")):
        raise InputError("A client certificate and private key must be selected together")
    if "keyPasswordEnv" in security and "keyFileEnv" not in security:
        raise InputError("A key password reference requires the selected private key")
    for key, value in security.items():
        if key.endswith("Env") and (not isinstance(value, str) or not ENV.fullmatch(value)):
            raise InputError("Credential references must be environment-variable names, never credential values")
    integer(raw["requestTimeoutSeconds"], 1, 120, "Request timeout")
    integer(raw["maxMessageBytes"], 1, 16 * 1024 * 1024, "Message byte limit")
    integer(raw["maxCaptureBytes"], 1, MAX_SOURCE, "Capture byte limit")
    integer(raw["maxCaptureRecords"], 1, 1000000, "Capture record limit")
    return json.loads(json_bytes(raw))


def b64(value):
    return None if value is None else base64.b64encode(value).decode("ascii")


def unb64(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise InputError("Kafka wire bytes require canonical base64 or null")
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as error:
        raise InputError("Invalid Kafka wire base64") from error
    if b64(raw) != value:
        raise InputError("Kafka wire base64 must be canonical")
    return raw


def wire_identity(value):
    return digest(json_bytes({key: value[key] for key in ("clusterId", "topicId", "partition", "offset")}))


def wire(raw):
    exact(raw, WIRE_KEYS)
    if raw["schema"] != "stellar-forge.kafka-message.v1":
        raise InputError("Choose an original native Kafka message")
    for key in ("clusterId", "topicId", "topic"):
        label(raw[key], 300)
    integer(raw["partition"], 0, 2147483647, "Partition")
    offset(raw["offset"])
    if raw["timestampType"] not in {"NOT_AVAILABLE", "CREATE_TIME", "LOG_APPEND_TIME"}:
        raise InputError("Unknown native Kafka timestamp type")
    stamp = raw["timestampMs"]
    if raw["timestampType"] == "NOT_AVAILABLE":
        if stamp is not None:
            raise InputError("An unavailable native timestamp must remain null")
    elif not isinstance(stamp, str) or not re.fullmatch(r"-?(0|[1-9][0-9]{0,18})", stamp) or not -9223372036854775808 <= int(stamp) <= 9223372036854775807:
        raise InputError("Retain the exact native Kafka timestamp as a decimal string")
    if raw["leaderEpoch"] is not None:
        integer(raw["leaderEpoch"], 0, 2147483647, "Leader epoch")
    total = 0
    for key in ("keyBase64", "valueBase64"):
        decoded = unb64(raw[key])
        total += len(decoded) if decoded is not None else 0
    headers = raw["headers"]
    if not isinstance(headers, list) or len(headers) > 65536:
        raise InputError("Retain the ordered native Kafka headers within the message limit")
    for header in headers:
        exact(header, {"name", "valueBase64"})
        if not isinstance(header["name"], str) or len(header["name"]) > 65536:
            raise InputError("Kafka header names must retain their original text")
        try:
            total += len(header["name"].encode("utf-8"))
        except UnicodeError as error:
            raise InputError("Kafka header names must contain valid Unicode") from error
        decoded = unb64(header["valueBase64"])
        total += len(decoded) if decoded is not None else 0
    if total > 16 * 1024 * 1024:
        raise InputError("Native Kafka message exceeds 16 MiB")
    body = json_bytes(raw)
    return {"id": wire_identity(raw), "sha256": digest(body), "bytes": len(body), "payloadBytes": total, "wire": raw}


def decoded(raw, mode="json"):
    """Keep numbers in the original NDJSON JsonNumber representation."""
    record = wire(raw)
    key = unb64(raw["keyBase64"])
    value = unb64(raw["valueBase64"])
    key_text = None
    if key is not None:
        try:
            key_text = key.decode("utf-8")
        except UnicodeError:
            pass
    parsed, error = None, None
    state = "tombstone" if value is None else "binary"
    if value is not None and mode == "json":
        try:
            parsed = json.loads(value, parse_int=ndjson_source.JsonNumber,
                                parse_float=ndjson_source.JsonNumber,
                                parse_constant=ndjson_source._constant,
                                object_pairs_hook=ndjson_source._pairs)
            ndjson_source._validate_tree(parsed)
            state = "json"
        except (ValueError, UnicodeError, RecursionError, InputError) as issue:
            error = str(issue)[:240]
            state = "invalid-json"
    operations = [unb64(h["valueBase64"]) for h in raw["headers"] if h["name"] == "dbz.op"]
    gs = operations[0].decode("ascii") if len(operations) == 1 and operations[0] in {b"c", b"u", b"d"} else None
    partition_key = None if key is None else digest(json_bytes({
        "clusterId": raw["clusterId"], "topicId": raw["topicId"],
        "partition": raw["partition"], "keyBase64": raw["keyBase64"]}))
    envelope = {"eventId": record["id"], "partitionKeyId": partition_key,
        **{k: raw[k] for k in ("clusterId", "topicId", "topic", "offset", "timestampType",
                              "timestampMs", "keyBase64", "valueBase64", "headers")},
        "partition": str(raw["partition"]), "offsetOrder": raw["offset"].zfill(19),
        "leaderEpoch": None if raw["leaderEpoch"] is None else str(raw["leaderEpoch"]),
        "keyUtf8": key_text, "value": parsed, "valueState": state, "parseError": error,
        "goldskyOperation": gs, "deleted": value is None or gs == "d"}
    return record | {"envelope": envelope}


def api_message(raw):
    value = decoded(raw)
    envelope = value["envelope"]
    return {"id": value["id"], "sha256": value["sha256"],
        **{k: v for k, v in raw.items() if k != "schema"},
        **{k: envelope[k] for k in ("keyUtf8", "value", "valueState", "parseError", "goldskyOperation", "deleted")}}


def exact_document(value):
    """Emit original numeric lexemes while retaining ordinary API metadata numbers."""
    if isinstance(value, ndjson_source.JsonNumber) or value is None or type(value) is bool or isinstance(value, str):
        return value
    if type(value) in {int, float}:
        return ndjson_source.JsonNumber(json.dumps(value, allow_nan=False))
    if isinstance(value, (list, tuple)):
        return [exact_document(item) for item in value]
    if isinstance(value, dict):
        return {key: exact_document(item) for key, item in value.items()}
    raise InputError("Expected an original JSON response")


def api_bytes(value):
    return (ndjson_source.exact_json(exact_document(value)) + "\n").encode("utf-8")


def default_plan(name):
    fields = ["eventId", "partitionKeyId", "topic", "partition", "offset", "offsetOrder",
              "timestampType", "timestampMs", "keyUtf8", "valueState", "goldskyOperation"]
    nullable = {"partitionKeyId", "timestampMs", "keyUtf8", "goldskyOperation"}
    columns = [{"name": field, "path": [field], "type": "string",
                "nullable": field in nullable, "mode": "scalar", "missing": "error"}
               for field in fields]
    columns.extend([
        {"name": "keyState", "path": ["keyUtf8"], "type": "string", "mode": "state"},
        {"name": "valueJson", "path": ["value"], "type": "string", "mode": "json"},
        {"name": "deleted", "path": ["deleted"], "type": "boolean"},
    ])
    raw = {"schema": ndjson_source.SCHEMA, "name": label(name, 128), "recordPath": [],
        "columns": columns, "keys": ["eventId"],
        "filters": ["topic", "partition", "valueState", "goldskyOperation"],
        "sorts": ["offsetOrder"], "ranges": [], "defaultLimit": 50, "maxLimit": 1000,
        "maxBytes": MAX_SOURCE, "maxRows": 1000000, "maxCellChars": 1048576, "allowEmpty": True}
    return ndjson_source.validate_plan(raw)
