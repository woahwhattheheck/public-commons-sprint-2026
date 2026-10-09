"""AWS S3 manifest -> OpenCV 5 inspection -> DynamoDB record -> FIFO review.

Source-only deployment entrypoint. Does not automate workplace safety decisions.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from urllib.parse import unquote_plus

from .vision import decode_image, orchestrate

MAX_MANIFEST_BYTES = 32_768
MAX_FRAME_BYTES = 12_000_000


def _body(s3, bucket: str, key: str, maximum: int) -> bytes:
    if not key.startswith(("frames/", "config/", "requests/")) or "/../" in key or key.startswith("/"):
        raise ValueError("Disallowed object key")
    response = s3.get_object(Bucket=bucket, Key=key)
    length = int(response.get("ContentLength", 0))
    if length > maximum:
        raise ValueError("S3 object too large")
    raw = response["Body"].read(maximum + 1)
    if not raw or len(raw) > maximum:
        raise ValueError("S3 object empty or too large")
    return raw


def _key_allowed(key: str, prefix: str, extension: tuple[str, ...]) -> bool:
    return (
        isinstance(key, str)
        and key.startswith(prefix)
        and not any(c in key for c in ("\\", "\x00", "\n", "\r", "?", "#"))
        and ".." not in key.split("/")
        and key.lower().endswith(extension)
    )


def handler(event, context):
    """Only accepts requests/*.json S3 events and same-bucket frame keys.

    A request manifest must contain `first_key`, optional `second_key`, and a
    trusted `camera_key` under config/. A signed upload preflight owns the
    request-manifest creation. IAM, not a request field, determines the bucket.
    """
    import boto3
    from botocore.exceptions import ClientError

    bucket = os.environ["PALLET_BUCKET"]
    table_name = os.environ["PALLET_TABLE"]
    queue_url = os.environ["PALLET_REVIEW_QUEUE_URL"]
    records = event.get("Records", [])
    if len(records) != 1:
        raise ValueError("One request manifest object per invocation")
    source = records[0]["s3"]
    if source["bucket"]["name"] != bucket:
        raise ValueError("Unexpected bucket")
    manifest_key = unquote_plus(source["object"]["key"])
    if not _key_allowed(manifest_key, "requests/", (".json",)):
        raise ValueError("Only request manifests are accepted")
    s3 = boto3.client("s3")
    dynamodb = boto3.resource("dynamodb")
    sqs = boto3.client("sqs")
    manifest_raw = _body(s3, bucket, manifest_key, MAX_MANIFEST_BYTES)
    request = json.loads(manifest_raw)
    if not isinstance(request, dict) or request.get("schema") != 1:
        raise ValueError("Unsupported manifest schema")
    site = request.get("site")
    if not isinstance(site, str) or not (1 <= len(site) <= 50) or not all(c.isalnum() or c in "-_" for c in site):
        raise ValueError("Invalid site identifier")
    first_key = request.get("first_key")
    second_key = request.get("second_key")
    camera_key = request.get("camera_key")
    if not _key_allowed(first_key, f"frames/{site}/", (".png", ".jpg", ".jpeg")):
        raise ValueError("First frame must be in site-scoped frames/")
    if second_key is not None and not _key_allowed(second_key, f"frames/{site}/", (".png", ".jpg", ".jpeg")):
        raise ValueError("Confirmation frame must be in same site")
    if not _key_allowed(camera_key, f"config/{site}/", (".json",)):
        raise ValueError("Configuration must be in site-scoped config/")
    config = json.loads(_body(s3, bucket, camera_key, MAX_MANIFEST_BYTES))
    reference_key = config.get("reference_key")
    if not _key_allowed(reference_key, f"frames/{site}/", (".png", ".jpg", ".jpeg")):
        raise ValueError("Trusted reference not configured")
    first = decode_image(_body(s3, bucket, first_key, MAX_FRAME_BYTES))
    reference = decode_image(_body(s3, bucket, reference_key, MAX_FRAME_BYTES))
    second = decode_image(_body(s3, bucket, second_key, MAX_FRAME_BYTES)) if second_key else None
    decision = orchestrate(reference, first, config["aisle_polygon"], second)
    # Source identity includes exact manifest bytes, not a client-controlled claim ID.
    inspection_id = hashlib.sha256(bucket.encode() + b"\0" + manifest_key.encode() + b"\0" + manifest_raw).hexdigest()
    receipt = {
        "inspection_id": inspection_id,
        "site": site,
        "decision": decision["decision"],
        "next_action": decision["next_action"],
        "first_regions": len(decision["first"]["regions"]),
        "created_epoch": int(time.time()),
    }
    # At-least-once SQS delivery; consumers MUST dedupe on inspection_id.
    # Send first: failed queue delivery leaves no false processed receipt.
    if decision["decision"] in ("HUMAN_REVIEW_REQUIRED", "DISAGREEMENT_REVIEW", "RETAKE_REQUIRED"):
        sqs.send_message(
            QueueUrl=queue_url,
            MessageGroupId=site,
            MessageDeduplicationId=inspection_id,
            MessageBody=json.dumps(receipt, sort_keys=True),
        )
    item = {**receipt, "ttl_epoch": receipt["created_epoch"] + 30 * 86400}
    try:
        dynamodb.Table(table_name).put_item(Item=item, ConditionExpression="attribute_not_exists(inspection_id)")
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
        return {"status": "DUPLICATE", "inspection_id": inspection_id}
    return {"status": "PROCESSED", **receipt}
