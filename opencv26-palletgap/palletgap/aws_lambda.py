"""AWS S3 manifest -> OpenCV 5 inspection -> DynamoDB record -> FIFO review.

Source-only deployment entrypoint. Does not automate workplace safety decisions.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from urllib.parse import unquote_plus

from .vision import decode_image, orchestrate

MAX_MANIFEST_BYTES = 32_768
MAX_FRAME_BYTES = 12_000_000


def _body(s3, bucket: str, key: str, maximum: int, *,
          version_id: str | None = None, expected_etag: str | None = None) -> bytes:
    if not key.startswith(("frames/", "config/", "requests/")) or "/../" in key or key.startswith("/"):
        raise ValueError("Disallowed object key")
    options = {"Bucket": bucket, "Key": key}
    if version_id is not None:
        if not isinstance(version_id, str) or not (1 <= len(version_id) <= 512) or any(ord(c) < 32 for c in version_id):
            raise ValueError("Invalid S3 event version")
        options["VersionId"] = version_id
    if expected_etag is not None:
        if not isinstance(expected_etag, str) or not re.fullmatch(r'"?[a-fA-F0-9]{32}(?:-[1-9][0-9]*)?"?', expected_etag):
            raise ValueError("Invalid S3 event ETag")
        options["IfMatch"] = '"' + expected_etag.strip('"') + '"'
    response = s3.get_object(**options)
    if version_id is not None and response.get("VersionId") != version_id:
        raise ValueError("S3 event version does not match retrieved manifest")
    if expected_etag is not None and response.get("ETag", "").strip('"').lower() != expected_etag.strip('"').lower():
        raise ValueError("S3 event ETag does not match retrieved manifest")
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
    event_object = source["object"]
    version_id = event_object.get("versionId")
    if version_id == "null":
        version_id = None  # Unversioned buckets may provide the literal sentinel.
    etag = event_object.get("eTag")
    if version_id is None and etag is None:
        raise ValueError("S3 event has neither versionId nor eTag; cannot pin manifest")
    manifest_raw = _body(
        s3, bucket, manifest_key, MAX_MANIFEST_BYTES,
        version_id=version_id, expected_etag=etag,
    )
    request = json.loads(manifest_raw)
    if not isinstance(request, dict) or type(request.get("schema")) is not int or request["schema"] not in (1, 2):
        raise ValueError("Unsupported manifest schema")
    pinned = request["schema"] == 2
    if pinned and version_id is None:
        raise ValueError("Schema 2 requires a versioned request manifest event")

    def input_version(container: dict, name: str) -> str | None:
        if not pinned:
            return None
        value = container.get(name)
        if not isinstance(value, str) or value in ("", "null"):
            raise ValueError(f"Schema 2 requires {name} S3 version ID")
        # _body independently checks length/control bytes before forwarding to S3.
        return value
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
    camera_version = input_version(request, "camera_version_id")
    first_version = input_version(request, "first_version_id")
    if pinned and not second_key and request.get("second_version_id") is not None:
        raise ValueError("Second frame version supplied without second frame key")
    second_version = input_version(request, "second_version_id") if second_key else None
    config_raw = _body(s3, bucket, camera_key, MAX_MANIFEST_BYTES,
                       version_id=camera_version)
    config = json.loads(config_raw)
    if not isinstance(config, dict):
        raise ValueError("Invalid camera configuration object")
    reference_key = config.get("reference_key")
    if not _key_allowed(reference_key, f"frames/{site}/", (".png", ".jpg", ".jpeg")):
        raise ValueError("Trusted reference not configured")
    reference_version = input_version(config, "reference_version_id")
    first_raw = _body(s3, bucket, first_key, MAX_FRAME_BYTES,
                      version_id=first_version)
    reference_raw = _body(s3, bucket, reference_key, MAX_FRAME_BYTES,
                          version_id=reference_version)
    second_raw = (_body(s3, bucket, second_key, MAX_FRAME_BYTES,
                        version_id=second_version) if second_key else None)
    evidence_sha256 = {
        "manifest": hashlib.sha256(manifest_raw).hexdigest(),
        "config": hashlib.sha256(config_raw).hexdigest(),
        "reference": hashlib.sha256(reference_raw).hexdigest(),
        "first": hashlib.sha256(first_raw).hexdigest(),
        "second": hashlib.sha256(second_raw).hexdigest() if second_raw is not None else None,
    }
    first = decode_image(first_raw)
    reference = decode_image(reference_raw)
    second = decode_image(second_raw) if second_raw is not None else None
    decision = orchestrate(reference, first, config["aisle_polygon"], second)
    # Bind the receipt to bytes ACTUALLY inspected: a stable manifest key alone
    # does not distinguish overwrites of its config or frame objects.
    identity = {"bucket": bucket, "manifest_key": manifest_key, "evidence_sha256": evidence_sha256}
    evidence_versions = None
    if pinned:
        evidence_versions = {
            "manifest": version_id,
            "config": camera_version,
            "reference": reference_version,
            "first": first_version,
            "second": second_version,
        }
        # Versions distinguish exact capture instances even with identical bytes.
        identity["evidence_versions"] = evidence_versions
    inspection_id = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    receipt = {
        "evidence_sha256": evidence_sha256,
        "inspection_id": inspection_id,
        "site": site,
        "decision": decision["decision"],
        "next_action": decision["next_action"],
        "first_regions": len(decision["first"]["regions"]),
        "created_epoch": int(time.time()),
    }
    if pinned:
        receipt["evidence_versions"] = evidence_versions
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
