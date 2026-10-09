"""Optional version-bound S3 review adapter for OrchardCue.

Requires S3 bucket versioning and ObjectCreated event versionId. No live AWS
requests are made unless lambda_handler is invoked in an authorized deployment.
A replay cannot silently replace prior review evidence.
"""
import hashlib
import json
import os
from urllib.parse import unquote_plus

from engine import analyze_bytes

MAX_BYTES = 8_000_000


def _capture_id(bucket, key, version_id, content_sha256):
    identity = {"bucket": bucket, "key": key, "version_id": version_id,
                "content_sha256": content_sha256}
    canonical = json.dumps(identity, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _put_if_absent_or_identical(s3, bucket, key, body, content_type):
    try:
        s3.put_object(Bucket=bucket, Key=key, Body=body,
                      ContentType=content_type, IfNoneMatch="*")
        return "CREATED"
    except Exception as exc:
        code = getattr(exc, "response", {}).get("Error", {}).get("Code")
        if code not in ("PreconditionFailed", "412"):
            raise
    # Strong S3 read-after-write consistency lets retries verify prior evidence.
    saved = s3.get_object(Bucket=bucket, Key=key)
    if saved.get("ContentLength") != len(body):
        raise ValueError("immutable review evidence conflicts with existing object")
    if saved["Body"].read(len(body) + 1) != body:
        raise ValueError("immutable review evidence conflicts with existing object")
    return "ALREADY_IDENTICAL"


def lambda_handler(event, context):
    input_bucket = os.environ["ORCHARDCUE_INPUT_BUCKET"]
    review_bucket = os.environ["ORCHARDCUE_REVIEW_BUCKET"]
    if not input_bucket or not review_bucket or input_bucket == review_bucket:
        raise ValueError("separate configured input and review buckets required")
    records = event.get("Records")
    if not isinstance(records, list) or len(records) != 1:
        raise ValueError("expected one S3 event record")
    record = records[0]
    if record.get("eventSource") != "aws:s3" or not str(
        record.get("eventName", "")
    ).startswith("ObjectCreated:"):
        raise ValueError("expected S3 ObjectCreated event")
    source_bucket = record["s3"]["bucket"]["name"]
    if source_bucket != input_bucket:
        raise ValueError("bucket rejected by allowlist")
    object_event = record["s3"]["object"]
    key = unquote_plus(object_event["key"])
    if not key.lower().endswith((".jpg", ".jpeg", ".png")) or ".." in key or key.startswith("/"):
        raise ValueError("unsupported S3 image key")
    version_id = object_event.get("versionId")
    if not isinstance(version_id, str) or not version_id or version_id == "null" or len(version_id) > 1024:
        raise ValueError("versioned S3 event required; refusing unbound latest-key read")

    import boto3  # Optional, invoked only for an authorized Lambda delivery
    s3 = boto3.client("s3")
    obj = s3.get_object(Bucket=source_bucket, Key=key, VersionId=version_id)
    if obj.get("VersionId") != version_id:
        raise ValueError("retrieved S3 version differs from the triggering event")
    size = obj.get("ContentLength")
    if type(size) is not int or size < 1 or size > MAX_BYTES:
        raise ValueError("source object exceeds image size budget or lacks length")
    raw = obj["Body"].read(MAX_BYTES + 1)
    if len(raw) != size or len(raw) > MAX_BYTES:
        raise ValueError("source object read was incomplete or exceeds budget")

    report, overlay = analyze_bytes(raw)
    digest = hashlib.sha256(raw).hexdigest()
    if report.get("input_sha256") != digest:
        raise ValueError("analyzer source hash does not match retrieved bytes")
    capture_id = _capture_id(source_bucket, key, version_id, digest)
    report["capture_source"] = {
        "bucket": source_bucket, "key": key, "version_id": version_id,
        "input_sha256": digest, "capture_id": capture_id
    }
    prefix = "operator-review/v1/" + capture_id
    report_bytes = (json.dumps(report, sort_keys=True, indent=2) + "\n").encode("utf-8")
    first = _put_if_absent_or_identical(
        s3, review_bucket, prefix + "/report.json", report_bytes, "application/json"
    )
    second = _put_if_absent_or_identical(
        s3, review_bucket, prefix + "/overlay.png", overlay, "image/png"
    )
    status = "ALREADY_IDENTICAL" if first == second == "ALREADY_IDENTICAL" else (
        "CREATED" if first == second == "CREATED" else "RECOVERED_PARTIAL"
    )
    return {
        "review_prefix": prefix,
        "receipt_status": status,
        "input_version_id": version_id,
        "input_sha256": digest,
        "action": report["decision"]["action"],
        "red_candidates": report["candidate_count"],
        "human_confirmation_required": True,
    }
