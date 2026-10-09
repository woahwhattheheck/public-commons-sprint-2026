"""Optional AWS Lambda/S3 review adapter. Does not actuate instruments.

Deployment must supply an OpenCV 5 Lambda runtime/layer and least-privilege S3.
The event only produces a pending-review observation and optional overlay.
"""
from __future__ import annotations

import json
import os
from urllib.parse import unquote_plus

import cv2
import numpy as np

from gaugetrace import analyze_image


def handler(event, context):
    import boto3
    s3 = boto3.client("s3")
    result_bucket = os.environ["GAUGE_OUTPUT_BUCKET"]
    calibration = json.loads(os.environ["GAUGE_CALIBRATION_JSON"])
    input_prefix = os.environ.get("GAUGE_INPUT_PREFIX", "gauge-input/")
    records = event.get("Records", [])
    if not isinstance(records, list) or len(records) != 1:
        raise ValueError("expected exactly one S3 event record")
    record = records[0]
    if record.get("eventSource") != "aws:s3" or not record.get("eventName", "").startswith("ObjectCreated:"):
        raise ValueError("only S3 ObjectCreated events supported")
    bucket = record["s3"]["bucket"]["name"]
    key = unquote_plus(record["s3"]["object"]["key"])
    if not key.startswith(input_prefix) or key.endswith("/"):
        raise ValueError("object outside configured gauge input prefix")
    if not key.lower().endswith((".png", ".jpg", ".jpeg")):
        raise ValueError("unsupported image suffix")
    content = s3.get_object(Bucket=bucket, Key=key)["Body"].read(6 * 1024 * 1024 + 1)
    if len(content) > 6 * 1024 * 1024:
        raise ValueError("input exceeds six MiB review limit")
    image = cv2.imdecode(np.frombuffer(content, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("not an image")
    observation, overlay = analyze_image(image, calibration)
    suffix = key[len(input_prefix):]
    # S3 traversal is harmless to S3 key namespaces, but avoid key confusion.
    if ".." in suffix.split("/") or not suffix or suffix.startswith("/"):
        raise ValueError("invalid input name")
    report_key = "gauge-review/reports/" + suffix + ".json"
    image_key = "gauge-review/overlays/" + suffix + ".png"
    report_payload = json.dumps(observation, indent=2, allow_nan=False).encode("utf-8")
    encoded, overlay_bytes = cv2.imencode(".png", overlay)
    if not encoded:
        raise OSError("could not encode operator review overlay")
    s3.put_object(Bucket=result_bucket, Key=report_key, Body=report_payload,
                  ContentType="application/json", ServerSideEncryption="AES256")
    s3.put_object(Bucket=result_bucket, Key=image_key, Body=overlay_bytes.tobytes(),
                  ContentType="image/png", ServerSideEncryption="AES256")
    return {"decision": observation["decision"], "report_key": report_key,
            "overlay_key": image_key, "operator_review_required": True}
