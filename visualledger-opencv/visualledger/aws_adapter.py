"""AWS event adapter with injected I/O seams for offline proof.

The pure handler contract maps one versioned S3 object event to an idempotent
Dynamo-style evidence record. Production boto3 wiring is intentionally a thin
wrapper; tests exercise the same normalized contract without credentials/spend.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from typing import Any, Callable

from .agent import canonical, compile_trace
from .vision import VisionError

PIPELINE_GENERATION = "visualledger-opencv/v1"
MAX_SCOPE_RECORDS = 512


def _text(value: Any, label: str, maximum: int = 512) -> str:
    if type(value) is not str or not value or len(value) > maximum or "\x00" in value:
        raise VisionError(f"invalid {label}")
    return value


def normalize_s3_event(event: Any) -> dict[str, str]:
    if type(event) is not dict or set(event) != {"Records"} or type(event["Records"]) is not list or len(event["Records"]) != 1:
        raise VisionError("expected exactly one S3 event record")
    record = event["Records"][0]
    try:
        s3 = record["s3"]
        bucket = _text(s3["bucket"]["name"], "bucket", 128)
        obj = s3["object"]
        key = _text(obj["key"], "key", 1024)
        version_id = _text(obj["versionId"], "versionId", 512)
        etag = _text(obj["eTag"], "eTag", 128)
    except (KeyError, TypeError) as exc:
        raise VisionError("malformed S3 event") from exc
    if re.fullmatch(r"[A-Za-z0-9._/-]+", key) is None or key.startswith("/") or ".." in key.split("/"):
        raise VisionError("unsafe S3 object key")
    return {"bucket": bucket, "key": key, "version_id": version_id, "etag": etag}


def event_identity(event: dict[str, str], pipeline_generation: str = PIPELINE_GENERATION) -> str:
    payload = {
        "bucket": event["bucket"],
        "key": event["key"],
        "version_id": event["version_id"],
        "etag": event["etag"],
        "pipeline_generation": pipeline_generation,
    }
    return hashlib.sha256(canonical(payload)).hexdigest()


def handle_s3_event(
    event: Any,
    *,
    load_object: Callable[[str, str, str], bytes],
    read_record: Callable[[str, str], dict[str, Any] | None],
    write_record: Callable[[str, str, dict[str, Any]], None],
    load_prior_fingerprints: Callable[[str], list[dict[str, str]]],
    allow_opencv4_dev: bool = False,
) -> dict[str, Any]:
    normalized = normalize_s3_event(event)
    identity = event_identity(normalized)
    scope = normalized["key"].split("/", 1)[0]
    if not scope:
        raise VisionError("S3 key must include an entity scope prefix")
    existing = read_record(scope, identity)
    if existing is not None:
        if type(existing) is not dict or existing.get("event_id") != identity:
            raise VisionError("stored idempotency record is malformed")
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
        "schema": "visualledger-aws-record/v1",
        "event_id": identity,
        "pipeline_generation": PIPELINE_GENERATION,
        "source": normalized,
        "scope": scope,
        "trace": trace,
    }
    record["record_sha256"] = hashlib.sha256(canonical(record)).hexdigest()
    write_record(scope, identity, record)
    return {"status": "RECORDED", "event_id": identity, "record": record}


def prior_fingerprints_from_records(records: Any, *, maximum: int = MAX_SCOPE_RECORDS) -> list[dict[str, str]]:
    """Validate retained same-scope records and extract bounded duplicate evidence."""
    if type(maximum) is not int or isinstance(maximum, bool) or not 1 <= maximum <= MAX_SCOPE_RECORDS:
        raise VisionError("invalid prior-record bound")
    if type(records) is not list or len(records) > maximum:
        raise VisionError("same-scope evidence exceeds bounded duplicate index")
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for record in records:
        if type(record) is not dict or record.get("schema") != "visualledger-aws-record/v1":
            raise VisionError("malformed same-scope evidence record")
        event_id = record.get("event_id")
        trace = record.get("trace")
        if type(event_id) is not str or len(event_id) != 64 or any(ch not in "0123456789abcdef" for ch in event_id):
            raise VisionError("malformed prior event id")
        if event_id in seen:
            raise VisionError("duplicate prior event id")
        seen.add(event_id)
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
    """Minimal production wrapper for S3 + DynamoDB.

    Required env: VISUALLEDGER_TABLE. Evidence is stored as canonical JSON.
    Near-duplicate history is intentionally not guessed here: a deployment must
    add the documented scope-index query before claiming duplicate detection on AWS.
    """
    try:
        import boto3
    except Exception as exc:
        raise RuntimeError("boto3 is required in the Lambda image") from exc
    table_name = os.environ.get("VISUALLEDGER_TABLE", "")
    if not table_name:
        raise RuntimeError("VISUALLEDGER_TABLE is required")
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
        # Base-table Query is strongly consistent. A scope larger than the retained
        # duplicate-evidence bound fails closed rather than silently sampling and
        # creating a false-negative duplicate path.
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
        return prior_fingerprints_from_records(records)

    return handle_s3_event(
        event,
        load_object=load_object,
        read_record=read_record,
        write_record=write_record,
        load_prior_fingerprints=load_prior_fingerprints,
        allow_opencv4_dev=False,
    )
