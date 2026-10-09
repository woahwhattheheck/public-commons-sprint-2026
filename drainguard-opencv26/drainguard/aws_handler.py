"""Meaningful AWS S3→Lambda→S3+DynamoDB review pipeline; no autonomous maintenance.

Deploy via infra/template.yaml. This module does not make AWS requests at import time.
"""
from __future__ import annotations
import hashlib
import io
import json
import os
from urllib.parse import unquote_plus

import cv2
import numpy as np

from .vision import Slot, inspect

MAX_CAPTURE_BYTES = 12 * 1024 * 1024
MAX_CONFIG_BYTES = 128 * 1024


def _read_s3_bounded(s3, bucket: str, key: str, limit: int,
                     version_id: str | None = None) -> tuple[bytes, str]:
    """Read at most limit bytes; pin capture reads to the triggering S3 version."""
    request = {"Bucket": bucket, "Key": key}
    if version_id is not None:
        request["VersionId"] = version_id
    obj = s3.get_object(**request)
    if version_id is not None and obj.get("VersionId") != version_id:
        raise ValueError("S3 capture version mismatch")
    declared = int(obj.get("ContentLength", limit + 1))
    if declared < 1 or declared > limit:
        raise ValueError("S3 object size outside admitted bounds")
    # A bounded streaming read, guarding against bogus ContentLength.
    with obj["Body"] as body:
        raw = body.read(limit + 1)
    if not raw or len(raw) > limit or len(raw) != declared:
        raise ValueError("S3 object changed size or exceeded limit")
    return raw, obj.get("ETag", "").strip('"')


def _image(data: bytes) -> np.ndarray:
    decoded = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if decoded is None:
        raise ValueError("expected a decodable image")
    return decoded


def _slot_config(data: bytes) -> list[Slot]:
    obj = json.loads(data.decode("utf-8"))
    if not isinstance(obj, dict) or obj.get("schema") != "drainguard/slots/v1" or not isinstance(obj.get("slots"), list):
        raise ValueError("reference slot schema invalid")
    return [Slot.parse(row) for row in obj["slots"]]


def _validate_record(record: dict, expected_bucket: str) -> tuple[str, str, str, str | None]:
    if record.get("eventSource") != "aws:s3":
        raise ValueError("S3 events only")
    s3 = record["s3"]
    bucket = s3["bucket"]["name"]
    key = unquote_plus(s3["object"]["key"])
    if bucket != expected_bucket:
        raise ValueError("capture originated outside configured bucket")
    if not (key.startswith("captures/") and key.lower().endswith((".jpeg", ".jpg", ".png"))):
        raise ValueError("capture must be in captures/ as JPEG or PNG")
    if any(component in ("", ".", "..") for component in key.split("/")) or len(key) > 512:
        raise ValueError("unsafe capture object key")
    # This deployment enables versioning. A late event MUST NOT read the newest
    # object at the same key and mistakenly attribute it to the old event.
    version = s3["object"].get("versionId")
    if not isinstance(version, str) or not (1 <= len(version) <= 200) or version == "null":
        raise ValueError("versioned capture event required")
    expected_etag = s3["object"].get("eTag")
    if expected_etag is not None and (not isinstance(expected_etag, str) or not expected_etag):
        raise ValueError("malformed event ETag")
    return bucket, key, version, expected_etag


def process_event(record: dict, s3, table, bucket: str, reference_key: str, slots_key: str) -> dict:
    source_bucket, source_key, source_version, expected_etag = _validate_record(record, bucket)
    capture_bytes, etag = _read_s3_bounded(s3, source_bucket, source_key, MAX_CAPTURE_BYTES,
                                            version_id=source_version)
    if expected_etag is not None and etag != expected_etag.strip('"'):
        raise ValueError("S3 event ETag does not match version-pinned capture")
    before_bytes, reference_etag = _read_s3_bounded(s3, bucket, reference_key, MAX_CAPTURE_BYTES)
    config_bytes, config_etag = _read_s3_bounded(s3, bucket, slots_key, MAX_CONFIG_BYTES)
    slots = _slot_config(config_bytes)
    report, annotated = inspect(_image(before_bytes), _image(capture_bytes), slots)
    # Bind actual bytes, not the S3 ETag (which can be a multipart/encryption
    # token rather than a content digest). Distinguish delayed/overwritten event
    # versions and pipeline revisions; stable for an exact replay.
    input_sha = hashlib.sha256(capture_bytes).hexdigest()
    reference_sha = hashlib.sha256(before_bytes).hexdigest()
    config_sha = hashlib.sha256(config_bytes).hexdigest()
    binding = "\0".join(["drainguard/aws_receipt/v2", bucket, source_key,
                           source_version, input_sha, reference_sha, config_sha])
    assessment_id = hashlib.sha256(binding.encode("utf-8")).hexdigest()[:36]
    report["assessment_id"] = assessment_id
    report["input_key"] = source_key
    report["input_version_id"] = source_version
    report["input_sha256"] = input_sha
    report["input_etag"] = etag
    report["baseline_key"] = reference_key
    report["baseline_etag"] = reference_etag
    report["baseline_sha256"] = reference_sha
    report["slot_config_etag"] = config_etag
    report["slot_config_sha256"] = config_sha
    report["assessment_binding_schema"] = "drainguard/aws_receipt/v2"
    report["cv_runtime"] = cv2.__version__
    report["aws_execution_claim"] = "Lambda processing; no assertion of human validation"
    report_key = f"reports/{assessment_id}/report.json"
    image_key = f"reports/{assessment_id}/annotated.jpg"
    jpg_ok, encoded = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 84])
    if not jpg_ok:
        raise ValueError("overlay encoding failed")
    json_payload = (json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    # Evidence first, human-review queue second; a failed upload cannot create an item that claims delivery.
    s3.put_object(Bucket=bucket, Key=report_key, Body=json_payload, ContentType="application/json", ServerSideEncryption="AES256")
    s3.put_object(Bucket=bucket, Key=image_key, Body=encoded.tobytes(), ContentType="image/jpeg", ServerSideEncryption="AES256")
    try:
        table.put_item(
            Item={"assessmentId": assessment_id, "sourceKey": source_key,
                  "sourceVersionId": source_version, "sourceSHA256": input_sha,
                  "status": report["status"],
                  "reportKey": report_key, "annotatedKey": image_key, "humanReviewRequired": True,
                  "state": "AWAITING_HUMAN_REVIEW"},
            ConditionExpression="attribute_not_exists(assessmentId)")
        queue_state = "CREATED"
    except Exception as exc:
        # DynamoDB replay condition is allowed; other errors must surface and retry the entire event.
        # Import is deferred, keeping standalone synthetic local mode dependency-free.
        from botocore.exceptions import ClientError
        if isinstance(exc, ClientError) and exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            queue_state = "EXISTING_IDEMPOTENT"
        else:
            raise
    return {"assessment_id": assessment_id, "review_state": queue_state, "report_key": report_key, "annotated_key": image_key}


def handler(event: dict, context=None) -> dict:
    """Process S3 ObjectCreated notification(s); fail the invocation on any failed record."""
    import boto3
    bucket = os.environ["DRAINGUARD_BUCKET"]
    reference = os.environ.get("DRAINGUARD_REFERENCE_KEY", "reference/reference.png")
    slots_key = os.environ.get("DRAINGUARD_SLOTS_KEY", "reference/slots.json")
    table_name = os.environ["DRAINGUARD_REVIEW_TABLE"]
    s3 = boto3.client("s3")
    table = boto3.resource("dynamodb").Table(table_name)
    records = event.get("Records")
    if not isinstance(records, list) or not 1 <= len(records) <= 10:
        raise ValueError("expected 1-10 S3 records")
    results = [process_event(r, s3, table, bucket, reference, slots_key) for r in records]
    return {"schema": "drainguard/lambda/v1", "processed": len(results), "receipts": results}
