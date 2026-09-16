from __future__ import annotations

import json
import os
from typing import Any

from .agent import build_review_proposal
from .aws_contract import parse_s3_events
from .codec import canonical_json
from .vision import inspect_pair


class RuntimeErrorProofLine(RuntimeError):
    pass


def _get_object_bytes(s3: Any, bucket: str, key: str, version_id: str = "") -> bytes:
    kwargs = {"Bucket": bucket, "Key": key}
    if version_id:
        kwargs["VersionId"] = version_id
    response = s3.get_object(**kwargs)
    body = response.get("Body")
    if body is None:
        raise RuntimeErrorProofLine("S3 object body missing")
    raw = body.read()
    if not isinstance(raw, (bytes, bytearray)):
        raise RuntimeErrorProofLine("S3 object body was not bytes")
    return bytes(raw)


def process_event(event: dict[str, Any], *, s3: Any, table: Any, reference_bucket: str, reference_key: str) -> dict[str, Any]:
    if not reference_bucket or not reference_key:
        raise RuntimeErrorProofLine("reference object configuration is required")
    results: list[dict[str, Any]] = []
    reference = _get_object_bytes(s3, reference_bucket, reference_key)
    for item in parse_s3_events(event):
        inspection = _get_object_bytes(s3, item.bucket, item.key, item.version_id)
        evidence = inspect_pair(reference, inspection)
        proposal = build_review_proposal(evidence)
        ledger_item = {
            "pk": f"EVENT#{item.idempotency_key}",
            "event_key": item.idempotency_key,
            "bucket": item.bucket,
            "key": item.key,
            "version_id": item.version_id,
            "evidence_receipt_sha256": evidence["receipt_sha256"],
            "proposal_receipt_sha256": proposal["receipt_sha256"],
            "evidence_json": canonical_json(evidence).decode("utf-8"),
            "proposal_json": canonical_json(proposal).decode("utf-8"),
        }
        try:
            table.put_item(
                Item=ledger_item,
                ConditionExpression="attribute_not_exists(pk)",
            )
            status = "RECORDED"
        except Exception as exc:
            code = getattr(exc, "response", {}).get("Error", {}).get("Code") if hasattr(exc, "response") else None
            if code != "ConditionalCheckFailedException":
                raise
            status = "DUPLICATE_IGNORED"
        results.append({
            "event_key": item.idempotency_key,
            "status": status,
            "evidence_receipt_sha256": evidence["receipt_sha256"],
            "proposal_receipt_sha256": proposal["receipt_sha256"],
        })
    return {"schema": "proofline.aws-result.v1", "results": results}


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    import boto3

    table_name = os.environ.get("EVIDENCE_TABLE", "")
    reference_bucket = os.environ.get("REFERENCE_BUCKET", "")
    reference_key = os.environ.get("REFERENCE_KEY", "")
    if not table_name:
        raise RuntimeErrorProofLine("EVIDENCE_TABLE is required")
    s3 = boto3.client("s3")
    table = boto3.resource("dynamodb").Table(table_name)
    result = process_event(
        event,
        s3=s3,
        table=table,
        reference_bucket=reference_bucket,
        reference_key=reference_key,
    )
    return {"statusCode": 200, "body": json.dumps(result, sort_keys=True, separators=(",", ":"))}
