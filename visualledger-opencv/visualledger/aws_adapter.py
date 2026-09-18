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
    read_record: Callable[[str], dict[str, Any] | None],
    write_record: Callable[[str, dict[str, Any]], None],
    load_prior_fingerprints: Callable[[str], list[dict[str, str]]],
    allow_opencv4_dev: bool = False,
) -> dict[str, Any]:
    normalized = normalize_s3_event(event)
    identity = event_identity(normalized)
    existing = read_record(identity)
    if existing is not None:
        if type(existing) is not dict or existing.get("event_id") != identity:
            raise VisionError("stored idempotency record is malformed")
        return {"status": "IDEMPOTENT_REPLAY", "event_id": identity, "record": existing}
    scope = normalized["key"].split("/", 1)[0]
    if not scope:
        raise VisionError("S3 key must include an entity scope prefix")
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
    write_record(identity, record)
    return {"status": "RECORDED", "event_id": identity, "record": record}


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

    def read_record(event_id: str) -> dict[str, Any] | None:
        item = table.get_item(Key={"event_id": event_id}, ConsistentRead=True).get("Item")
        return None if item is None else json.loads(item["payload_json"])

    def write_record(event_id: str, record: dict[str, Any]) -> None:
        table.put_item(
            Item={"event_id": event_id, "payload_json": canonical(record).decode("ascii")},
            ConditionExpression="attribute_not_exists(event_id)",
        )

    return handle_s3_event(
        event,
        load_object=load_object,
        read_record=read_record,
        write_record=write_record,
        load_prior_fingerprints=lambda scope: [],
        allow_opencv4_dev=False,
    )
