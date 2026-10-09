"""Optional AWS Lambda/S3 review adapter. Does not actuate instruments.

Deployment must supply an OpenCV 5 Lambda runtime/layer and least-privilege S3.
The event only produces a pending-review observation and optional overlay.
"""
from __future__ import annotations

from hashlib import sha256
import json
import os
from urllib.parse import unquote_plus

import cv2
import numpy as np

from gaugetrace import analyze_image


_MAX_SOURCE_BYTES = 6 * 1024 * 1024


def _event_source(record: dict, input_prefix: str) -> tuple[str, str, str | None, str | None]:
    """Validate the exact object and event evidence before touching provider storage."""
    if not isinstance(record, dict) or record.get("eventSource") != "aws:s3" or not str(record.get("eventName", "")).startswith("ObjectCreated:"):
        raise ValueError("only S3 ObjectCreated events supported")
    s3_object = record.get("s3") or {}
    bucket = (s3_object.get("bucket") or {}).get("name")
    obj = s3_object.get("object") or {}
    raw_key = obj.get("key")
    if not isinstance(raw_key, str):
        raise ValueError("missing source object key")
    key = unquote_plus(raw_key)
    if not isinstance(bucket, str) or not bucket or not key.startswith(input_prefix) or key.endswith("/"):
        raise ValueError("object outside configured gauge input prefix")
    if not key.lower().endswith((".png", ".jpg", ".jpeg")):
        raise ValueError("unsupported image suffix")
    suffix = key[len(input_prefix):]
    if ".." in suffix.split("/") or not suffix or suffix.startswith("/") or len(key) > 850:
        raise ValueError("invalid input name")
    version = obj.get("versionId")
    etag = obj.get("eTag")
    if version is not None and (not isinstance(version, str) or not version):
        raise ValueError("invalid source version ID")
    if etag is not None and (not isinstance(etag, str) or not etag.strip('"')):
        raise ValueError("invalid source ETag")
    if version is None and etag is None:
        raise ValueError("S3 event must bind a versionId or eTag")
    return bucket, key, version, etag


def handler(event, context):
    import boto3
    result_bucket = os.environ["GAUGE_OUTPUT_BUCKET"]
    calibration = json.loads(os.environ["GAUGE_CALIBRATION_JSON"])
    input_prefix = os.environ.get("GAUGE_INPUT_PREFIX", "gauge-input/")
    if not isinstance(event, dict) or not isinstance(event.get("Records"), list) or len(event["Records"]) != 1:
        raise ValueError("expected exactly one S3 event record")
    bucket, key, version, event_etag = _event_source(event["Records"][0], input_prefix)
    s3 = boto3.client("s3")
    get_request = {"Bucket": bucket, "Key": key}
    if version is not None:
        get_request["VersionId"] = version
    source = s3.get_object(**get_request)
    # For unversioned buckets, the event can be stale by the time Lambda runs.
    # Refuse to report an image belonging to a *different* source ETag.
    response_etag = source.get("ETag")
    if event_etag is not None and (not isinstance(response_etag, str) or response_etag.strip('"') != event_etag.strip('"')):
        raise ValueError("S3 source changed since event; no review issued")
    if version is not None and source.get("VersionId") != version:
        raise ValueError("S3 version mismatch; no review issued")
    if source.get("ContentLength", 0) > _MAX_SOURCE_BYTES:
        raise ValueError("input exceeds six MiB review limit")
    content = source["Body"].read(_MAX_SOURCE_BYTES + 1)
    if len(content) > _MAX_SOURCE_BYTES:
        raise ValueError("input exceeds six MiB review limit")
    image = cv2.imdecode(np.frombuffer(content, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("not an image")
    observation, overlay = analyze_image(image, calibration)
    source_digest = sha256(content).hexdigest()
    canonical_calibration = json.dumps(calibration, sort_keys=True, separators=(",", ":"), allow_nan=False)
    calibration_digest = sha256(canonical_calibration.encode("utf-8")).hexdigest()
    review_id = sha256(json.dumps([bucket, key, version, source_digest, calibration_digest],
                                  separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()
    suffix = key[len(input_prefix):]
    # The suffix is readable to operators; the identity prevents evidence for an
    # updated image or a different calibration overwriting earlier reviews.
    report_key = f"gauge-review/reports/{suffix}.{review_id}.json"
    image_key = f"gauge-review/overlays/{suffix}.{review_id}.png"
    observation = {**observation, "review_id": review_id,
                   "source_evidence": {"bucket": bucket, "key": key, "version_id": version,
                                       "event_etag": event_etag, "content_sha256": source_digest,
                                       "version_bound": version is not None},
                   "calibration_sha256": calibration_digest}
    report_payload = json.dumps(observation, indent=2, allow_nan=False).encode("utf-8")
    encoded, overlay_bytes = cv2.imencode(".png", overlay)
    if not encoded:
        raise OSError("could not encode operator review overlay")
    s3.put_object(Bucket=result_bucket, Key=report_key, Body=report_payload,
                  ContentType="application/json", ServerSideEncryption="AES256")
    s3.put_object(Bucket=result_bucket, Key=image_key, Body=overlay_bytes.tobytes(),
                  ContentType="image/png", ServerSideEncryption="AES256")
    return {"decision": observation["decision"], "review_id": review_id,
            "source_sha256": source_digest, "report_key": report_key,
            "overlay_key": image_key, "operator_review_required": True}
