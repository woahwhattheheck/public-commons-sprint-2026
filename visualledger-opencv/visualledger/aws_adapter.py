"""AWS event adapter with injected I/O seams for offline proof.

The pure handler contract maps one versioned S3 object event to an idempotent
Dynamo-style evidence record. Production boto3 wiring is intentionally a thin
wrapper; tests exercise the same normalized contract without credentials/spend.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
from typing import Any, Callable

from .agent import TRACE_SCHEMA, canonical, compile_trace
from .vision import VisionError

PIPELINE_GENERATION = "visualledger-opencv/v2"
RECORD_SCHEMA = "visualledger-aws-record/v2"
MAX_SCOPE_RECORDS = 512
_HEX64 = re.compile(r"[0-9a-f]{64}\Z")


def _text(value: Any, label: str, maximum: int = 512) -> str:
    if type(value) is not str or not value or len(value) > maximum or "\x00" in value:
        raise VisionError(f"invalid {label}")
    return value


def _normalize_source(source: Any) -> dict[str, str]:
    if type(source) is not dict or set(source) != {"bucket", "key", "version_id", "etag"}:
        raise VisionError("malformed normalized source")
    bucket = _text(source["bucket"], "bucket", 128)
    key = _text(source["key"], "key", 1024)
    version_id = _text(source["version_id"], "versionId", 512)
    etag = _text(source["etag"], "eTag", 128)
    if re.fullmatch(r"[A-Za-z0-9._/-]+", key) is None or key.startswith("/") or ".." in key.split("/"):
        raise VisionError("unsafe S3 object key")
    return {"bucket": bucket, "key": key, "version_id": version_id, "etag": etag}


def normalize_s3_event(event: Any) -> dict[str, str]:
    if type(event) is not dict or set(event) != {"Records"} or type(event["Records"]) is not list or len(event["Records"]) != 1:
        raise VisionError("expected exactly one S3 event record")
    record = event["Records"][0]
    try:
        s3 = record["s3"]
        source = {
            "bucket": s3["bucket"]["name"],
            "key": s3["object"]["key"],
            "version_id": s3["object"]["versionId"],
            "etag": s3["object"]["eTag"],
        }
    except (KeyError, TypeError) as exc:
        raise VisionError("malformed S3 event") from exc
    return _normalize_source(source)


def event_identity(event: dict[str, str], pipeline_generation: str = PIPELINE_GENERATION) -> str:
    source = _normalize_source(event)
    payload = {
        "bucket": source["bucket"],
        "key": source["key"],
        "version_id": source["version_id"],
        "etag": source["etag"],
        "pipeline_generation": pipeline_generation,
    }
    return hashlib.sha256(canonical(payload)).hexdigest()


def _validate_trace_receipt(trace: Any, *, event_id: str) -> dict[str, Any]:
    if type(trace) is not dict or trace.get("schema") != TRACE_SCHEMA:
        raise VisionError("stored trace schema is invalid")
    if trace.get("evidence_id") != event_id[:32]:
        raise VisionError("stored trace evidence id does not match event generation")
    receipt = trace.get("receipt_sha256")
    if type(receipt) is not str or _HEX64.fullmatch(receipt) is None:
        raise VisionError("stored trace receipt is invalid")
    body = dict(trace)
    body.pop("receipt_sha256", None)
    expected = hashlib.sha256(canonical(body)).hexdigest()
    if not hmac.compare_digest(receipt, expected):
        raise VisionError("stored trace receipt mismatch")
    return trace


def _record_auth_key(value: Any) -> bytes:
    if type(value) is not bytes or not 32 <= len(value) <= 128:
        raise VisionError("record authentication key must be 32..128 bytes")
    return value


def _record_sha256(record: dict[str, Any]) -> str:
    body = dict(record)
    body.pop("record_hmac_sha256", None)
    body.pop("record_sha256", None)
    return hashlib.sha256(canonical(body)).hexdigest()


def _record_hmac_sha256(record: dict[str, Any], record_auth_key: bytes) -> str:
    key = _record_auth_key(record_auth_key)
    body = dict(record)
    body.pop("record_hmac_sha256", None)
    return hmac.new(key, canonical(body), hashlib.sha256).hexdigest()


def validate_record_generation(
    record: Any,
    *,
    record_auth_key: bytes,
    expected_scope: str | None = None,
    expected_event_id: str | None = None,
) -> dict[str, Any]:
    """Validate one retained record as an authenticated current evidence generation."""
    required = {
        "schema", "event_id", "pipeline_generation", "source", "scope", "trace",
        "record_sha256", "record_hmac_sha256",
    }
    if type(record) is not dict or set(record) != required or record.get("schema") != RECORD_SCHEMA:
        raise VisionError("malformed retained evidence record")
    if record.get("pipeline_generation") != PIPELINE_GENERATION:
        raise VisionError("retained evidence belongs to another pipeline generation")

    source = _normalize_source(record.get("source"))
    scope = source["key"].split("/", 1)[0]
    if not scope or record.get("scope") != scope:
        raise VisionError("retained evidence scope/source mismatch")
    if expected_scope is not None and scope != expected_scope:
        raise VisionError("retained evidence is outside queried scope")

    event_id = record.get("event_id")
    if type(event_id) is not str or _HEX64.fullmatch(event_id) is None:
        raise VisionError("malformed retained event id")
    if not hmac.compare_digest(event_id, event_identity(source)):
        raise VisionError("retained event id/source mismatch")
    if expected_event_id is not None and not hmac.compare_digest(event_id, expected_event_id):
        raise VisionError("retained replay event id mismatch")

    auth = record.get("record_hmac_sha256")
    if type(auth) is not str or _HEX64.fullmatch(auth) is None:
        raise VisionError("retained record authentication seal is invalid")
    expected_auth = _record_hmac_sha256(record, record_auth_key)
    if not hmac.compare_digest(auth, expected_auth):
        raise VisionError("retained record authentication seal mismatch")

    _validate_trace_receipt(record.get("trace"), event_id=event_id)

    receipt = record.get("record_sha256")
    if type(receipt) is not str or _HEX64.fullmatch(receipt) is None:
        raise VisionError("retained record receipt is invalid")
    expected = _record_sha256(record)
    if not hmac.compare_digest(receipt, expected):
        raise VisionError("retained record receipt mismatch")
    return record


def handle_s3_event(
    event: Any,
    *,
    load_object: Callable[[str, str, str], bytes],
    read_record: Callable[[str, str], dict[str, Any] | None],
    write_record: Callable[[str, str, dict[str, Any]], None],
    load_prior_fingerprints: Callable[[str], list[dict[str, str]]],
    record_auth_key: bytes,
    allow_opencv4_dev: bool = False,
) -> dict[str, Any]:
    record_auth_key = _record_auth_key(record_auth_key)
    normalized = normalize_s3_event(event)
    identity = event_identity(normalized)
    scope = normalized["key"].split("/", 1)[0]
    if not scope:
        raise VisionError("S3 key must include an entity scope prefix")
    existing = read_record(scope, identity)
    if existing is not None:
        validate_record_generation(
            existing,
            record_auth_key=record_auth_key,
            expected_scope=scope,
            expected_event_id=identity,
        )
        return {"status": "IDEMPOTENT_REPLAY", "event_id": identity, "record": existing}
    priors = load_prior_fingerprints(scope)
    raw = load_object(normalized["bucket"], normalized["key"], normalized["version_id"])
    trace = compile_trace(
        raw,
        evidence_id=identity[:32],
        prior_fingerprints=priors,
        allow_opencv4_dev=allow_opencv4_dev,
    )
    record = {
        "schema": RECORD_SCHEMA,
        "event_id": identity,
        "pipeline_generation": PIPELINE_GENERATION,
        "source": normalized,
        "scope": scope,
        "trace": trace,
    }
    record["record_sha256"] = _record_sha256(record)
    record["record_hmac_sha256"] = _record_hmac_sha256(record, record_auth_key)
    write_record(scope, identity, record)
    return {"status": "RECORDED", "event_id": identity, "record": record}


def prior_fingerprints_from_records(
    records: Any,
    *,
    scope: str,
    record_auth_key: bytes,
    maximum: int = MAX_SCOPE_RECORDS,
) -> list[dict[str, str]]:
    """Validate retained same-scope record generations and extract duplicate evidence."""
    scope = _text(scope, "scope", 1024)
    if "/" in scope:
        raise VisionError("invalid scope")
    if type(maximum) is not int or isinstance(maximum, bool) or not 1 <= maximum <= MAX_SCOPE_RECORDS:
        raise VisionError("invalid prior-record bound")
    if type(records) is not list or len(records) > maximum:
        raise VisionError("same-scope evidence exceeds bounded duplicate index")
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for record in records:
        validate_record_generation(record, record_auth_key=record_auth_key, expected_scope=scope)
        event_id = record["event_id"]
        if event_id in seen:
            raise VisionError("duplicate prior event id")
        seen.add(event_id)
        trace = record["trace"]
        try:
            evidence_id = trace["evidence_id"]
            fingerprint = trace["perception"]["fingerprint_dhash64"]
        except (KeyError, TypeError) as exc:
            raise VisionError("prior record missing fingerprint evidence") from exc
        if type(evidence_id) is not str or not evidence_id or len(evidence_id) > 96:
            raise VisionError("malformed prior evidence id")
        if type(fingerprint) is not str or re.fullmatch(r"[0-9a-f]{16}", fingerprint) is None:
            raise VisionError("malformed prior fingerprint")
        out.append({"evidence_id": evidence_id, "fingerprint": fingerprint})
    out.sort(key=lambda row: (row["evidence_id"], row["fingerprint"]))
    return out


def lambda_handler(event: Any, context: Any) -> dict[str, Any]:  # pragma: no cover - requires live AWS SDK/runtime
    """Minimal production wrapper for S3 + DynamoDB with validated retained history."""
    try:
        import boto3
    except Exception as exc:
        raise RuntimeError("boto3 is required in the Lambda image") from exc
    table_name = os.environ.get("VISUALLEDGER_TABLE", "")
    if not table_name:
        raise RuntimeError("VISUALLEDGER_TABLE is required")
    auth_text = os.environ.get("VISUALLEDGER_RECORD_HMAC_KEY", "")
    try:
        record_auth_key = _record_auth_key(auth_text.encode("utf-8", "strict"))
    except (UnicodeEncodeError, VisionError) as exc:
        raise RuntimeError("VISUALLEDGER_RECORD_HMAC_KEY must be a 32..128 byte UTF-8 secret") from exc
    s3 = boto3.client("s3")
    table = boto3.resource("dynamodb").Table(table_name)

    def load_object(bucket: str, key: str, version: str) -> bytes:
        return s3.get_object(Bucket=bucket, Key=key, VersionId=version)["Body"].read()

    def read_record(scope: str, event_id: str) -> dict[str, Any] | None:
        item = table.get_item(
            Key={"scope": scope, "event_id": event_id},
            ConsistentRead=True,
        ).get("Item")
        return None if item is None else json.loads(item["payload_json"])

    def write_record(scope: str, event_id: str, record: dict[str, Any]) -> None:
        table.put_item(
            Item={"scope": scope, "event_id": event_id, "payload_json": canonical(record).decode("ascii")},
            ConditionExpression="attribute_not_exists(#scope) AND attribute_not_exists(event_id)",
            ExpressionAttributeNames={"#scope": "scope"},
        )

    def load_prior_fingerprints(scope: str) -> list[dict[str, str]]:
        response = table.query(
            KeyConditionExpression=" #scope = :scope",
            ExpressionAttributeNames={"#scope": "scope"},
            ExpressionAttributeValues={":scope": scope},
            ConsistentRead=True,
            Limit=MAX_SCOPE_RECORDS + 1,
        )
        items = response.get("Items", [])
        if response.get("LastEvaluatedKey") is not None or len(items) > MAX_SCOPE_RECORDS:
            raise VisionError("same-scope evidence exceeds bounded duplicate index")
        records: list[dict[str, Any]] = []
        for item in items:
            try:
                payload = item["payload_json"]
                record = json.loads(payload)
            except (KeyError, TypeError, json.JSONDecodeError) as exc:
                raise VisionError("malformed retained same-scope record") from exc
            records.append(record)
        return prior_fingerprints_from_records(records, scope=scope, record_auth_key=record_auth_key)

    return handle_s3_event(
        event,
        load_object=load_object,
        read_record=read_record,
        write_record=write_record,
        load_prior_fingerprints=load_prior_fingerprints,
        record_auth_key=record_auth_key,
        allow_opencv4_dev=False,
    )
