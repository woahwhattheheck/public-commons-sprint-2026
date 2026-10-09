# SPDX-License-Identifier: MIT
"""AWS Lambda S3-to-evidence worker. All decisions remain human-owned.

Deploy via the separate SAM template; no AWS calls occur on module import.
"""
from __future__ import annotations

from hashlib import sha256
import json
import os
from urllib.parse import unquote_plus

from thermoloom import decode_image, inspect

MAX_RECORDS = 10


def _records(event):
    if not isinstance(event, dict) or not isinstance(event.get("Records"), list):
        raise ValueError("expected an S3 event with Records")
    if not (1 <= len(event["Records"]) <= MAX_RECORDS):
        raise ValueError("S3 event record count out of bounds")
    for record in event["Records"]:
        if record.get("eventSource") != "aws:s3":
            raise ValueError("only S3 object-created events accepted")
        s3 = record.get("s3") or {}
        bucket = (s3.get("bucket") or {}).get("name")
        obj = s3.get("object") or {}
        key = unquote_plus(obj.get("key", ""))
        if not isinstance(bucket, str) or not bucket or not key.startswith("images/") or not key.lower().endswith(".png"):
            raise ValueError("expected S3 images/*.png object")
        if ".." in key.split("/") or len(key) > 1024:
            raise ValueError("invalid object key")
        yield bucket, key, obj.get("versionId"), obj.get("eTag")


def lambda_handler(event, context, s3_client=None):
    """Process image bytes in AWS; store only the review receipt to a separate S3 bucket.

    Receipt path is content-addressed to avoid generating conflicting output keys
    during S3 at-least-once event delivery. It is NOT exactly-once AWS execution.
    """
    if s3_client is None:
        import boto3
        s3_client = boto3.client("s3")
    output_bucket = os.environ.get("THERMOLOOM_OUTPUT_BUCKET", "")
    if not output_bucket:
        raise ValueError("THERMOLOOM_OUTPUT_BUCKET must be configured")
    rows, cols = int(os.environ.get("THERMOLOOM_ROWS", "4")), int(os.environ.get("THERMOLOOM_COLS", "6"))
    results = []
    for bucket, key, version, etag in _records(event):
        request = {"Bucket": bucket, "Key": key}
        if version:
            request["VersionId"] = version
        source = s3_client.get_object(**request)
        payload = source["Body"].read(8 * 1024 * 1024 + 1)
        frame = decode_image(payload)
        receipt = inspect(frame, rows=rows, cols=cols)
        fingerprint = sha256(f"{bucket}|{key}|{version or ''}|{etag or ''}|{receipt['capture_sha256']}".encode()).hexdigest()
        destination = f"reviews/{fingerprint}.json"
        document = {"schema": "thermoloom-aws-review/v1", "id": fingerprint,
                    "source": {"bucket": bucket, "key": key, "version": version},
                    "analysis": receipt, "automatic_repair": False,
                    "workflow_next": ("CAPTURE_RETAKE" if receipt["decision"] == "RETAKE" else
                                      "HUMAN_QUEUE" if receipt["decision"] == "HUMAN_REVIEW" else "ARCHIVE_MONITOR")}
        s3_client.put_object(Bucket=output_bucket, Key=destination,
                             Body=(json.dumps(document, sort_keys=True, separators=(",", ":")) + "\n").encode(),
                             ContentType="application/json", ServerSideEncryption="AES256")
        results.append({"id": fingerprint, "object": destination, "decision": receipt["decision"]})
    return {"schema": "thermoloom-worker-result/v1", "count": len(results), "results": results}
