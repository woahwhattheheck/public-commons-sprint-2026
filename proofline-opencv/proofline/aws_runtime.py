from __future__ import annotations

import json
import os
from typing import Any

from .agent import build_review_proposal
from .aws_contract import S3ObjectEvent, parse_s3_events
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


def _stored_result(
    table: Any,
    *,
    event: S3ObjectEvent,
    event_key: str,
    reference_bucket: str,
    reference_key: str,
    reference_version_id: str,
) -> dict[str, Any] | None:
    response = table.get_item(Key={"pk": f"EVENT#{event_key}"}, ConsistentRead=True)
    if not isinstance(response, dict):
        raise RuntimeErrorProofLine("DynamoDB get_item returned invalid response")
    item = response.get("Item")
    if item is None:
        return None
    if not isinstance(item, dict):
        raise RuntimeErrorProofLine("stored ledger item is invalid")
    expected_identity = {
        "event_key": event_key,
        "bucket": event.bucket,
        "key": event.key,
        "version_id": event.version_id,
        "reference_bucket": reference_bucket,
        "reference_key": reference_key,
        "reference_version_id": reference_version_id,
    }
    if any(item.get(key) != value for key, value in expected_identity.items()):
        raise RuntimeErrorProofLine("stored ledger identity mismatch")
    evidence_receipt = item.get("evidence_receipt_sha256")
    proposal_receipt = item.get("proposal_receipt_sha256")
    if not isinstance(evidence_receipt, str) or len(evidence_receipt) != 64:
        raise RuntimeErrorProofLine("stored evidence receipt is invalid")
    if not isinstance(proposal_receipt, str) or len(proposal_receipt) != 64:
        raise RuntimeErrorProofLine("stored proposal receipt is invalid")
    return {
        "event_key": event_key,
        "status": "DUPLICATE_REPLAY",
        "evidence_receipt_sha256": evidence_receipt,
        "proposal_receipt_sha256": proposal_receipt,
    }


def process_event(
    event: dict[str, Any],
    *,
    s3: Any,
    table: Any,
    reference_bucket: str,
    reference_key: str,
    reference_version_id: str,
) -> dict[str, Any]:
    if not reference_bucket or not reference_key or not reference_version_id:
        raise RuntimeErrorProofLine("pinned reference bucket/key/version configuration is required")
    results: list[dict[str, Any]] = []
    reference: bytes | None = None
    for item in parse_s3_events(event):
        event_key = item.bound_idempotency_key(
            reference_bucket=reference_bucket,
            reference_key=reference_key,
            reference_version_id=reference_version_id,
        )
        existing = _stored_result(
            table,
            event=item,
            event_key=event_key,
            reference_bucket=reference_bucket,
            reference_key=reference_key,
            reference_version_id=reference_version_id,
        )
        if existing is not None:
            results.append(existing)
            continue
        if reference is None:
            reference = _get_object_bytes(s3, reference_bucket, reference_key, reference_version_id)
        inspection = _get_object_bytes(s3, item.bucket, item.key, item.version_id)
        source_binding = {
            "reference": {
                "provider": "AWS_S3",
                "bucket": reference_bucket,
                "key": reference_key,
                "version_id": reference_version_id,
            },
            "inspection": {
                "provider": "AWS_S3",
                "bucket": item.bucket,
                "key": item.key,
                "version_id": item.version_id,
            },
        }
        evidence = inspect_pair(reference, inspection, source_binding=source_binding)
        if evidence.get("source_binding") != source_binding:
            raise RuntimeErrorProofLine("inspection evidence did not bind exact S3 source generations")
        proposal = build_review_proposal(evidence)
        ledger_item = {
            "pk": f"EVENT#{event_key}",
            "event_key": event_key,
            "bucket": item.bucket,
            "key": item.key,
            "version_id": item.version_id,
            "reference_bucket": reference_bucket,
            "reference_key": reference_key,
            "reference_version_id": reference_version_id,
            "evidence_receipt_sha256": evidence["receipt_sha256"],
            "proposal_receipt_sha256": proposal["receipt_sha256"],
            "evidence_json": canonical_json(evidence).decode("utf-8"),
            "proposal_json": canonical_json(proposal).decode("utf-8"),
        }
        try:
            table.put_item(Item=ledger_item, ConditionExpression="attribute_not_exists(pk)")
            result = {
                "event_key": event_key,
                "status": "RECORDED",
                "evidence_receipt_sha256": evidence["receipt_sha256"],
                "proposal_receipt_sha256": proposal["receipt_sha256"],
            }
        except Exception as exc:
            code = getattr(exc, "response", {}).get("Error", {}).get("Code") if hasattr(exc, "response") else None
            if code != "ConditionalCheckFailedException":
                raise
            stored = _stored_result(
                table,
                event=item,
                event_key=event_key,
                reference_bucket=reference_bucket,
                reference_key=reference_key,
                reference_version_id=reference_version_id,
            )
            if stored is None:
                raise RuntimeErrorProofLine("conditional duplicate had no stored ledger row") from exc
            result = stored
        results.append(result)
    return {"schema": "proofline.aws-result.v1", "results": results}


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    import boto3

    table_name = os.environ.get("EVIDENCE_TABLE", "")
    reference_bucket = os.environ.get("REFERENCE_BUCKET", "")
    reference_key = os.environ.get("REFERENCE_KEY", "")
    reference_version_id = os.environ.get("REFERENCE_VERSION_ID", "")
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
        reference_version_id=reference_version_id,
    )
    return {"statusCode": 200, "body": json.dumps(result, sort_keys=True, separators=(",", ":"))}
