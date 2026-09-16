from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any
from urllib.parse import unquote_plus

from .vision import PIPELINE_GENERATION

MAX_RECORDS = 32


class AwsContractError(ValueError):
    pass


@dataclass(frozen=True)
class S3ObjectEvent:
    bucket: str
    key: str
    version_id: str
    event_name: str
    sequencer: str

    @property
    def idempotency_key(self) -> str:
        material = "\0".join(
            [self.bucket, self.key, self.version_id, self.event_name, self.sequencer, PIPELINE_GENERATION]
        ).encode("utf-8")
        return hashlib.sha256(material).hexdigest()


def parse_s3_events(event: dict[str, Any]) -> list[S3ObjectEvent]:
    if not isinstance(event, dict):
        raise AwsContractError("event must be an object")
    records = event.get("Records")
    if not isinstance(records, list) or not 1 <= len(records) <= MAX_RECORDS:
        raise AwsContractError("Records must contain 1..32 entries")
    parsed: list[S3ObjectEvent] = []
    seen: set[str] = set()
    for record in records:
        if not isinstance(record, dict) or record.get("eventSource") != "aws:s3":
            raise AwsContractError("only S3 events are accepted")
        event_name = record.get("eventName")
        if not isinstance(event_name, str) or not event_name.startswith("ObjectCreated:"):
            raise AwsContractError("only ObjectCreated S3 events are accepted")
        s3 = record.get("s3")
        if not isinstance(s3, dict):
            raise AwsContractError("missing s3 object")
        bucket = s3.get("bucket", {}).get("name") if isinstance(s3.get("bucket"), dict) else None
        obj = s3.get("object")
        if not isinstance(bucket, str) or not bucket or not isinstance(obj, dict):
            raise AwsContractError("invalid S3 bucket/object")
        key = obj.get("key")
        sequencer = obj.get("sequencer")
        version_id = obj.get("versionId", "")
        if not isinstance(key, str) or not key or not isinstance(sequencer, str) or not sequencer:
            raise AwsContractError("key and sequencer are required")
        if not isinstance(version_id, str):
            raise AwsContractError("versionId must be a string when present")
        decoded_key = unquote_plus(key)
        if "\x00" in decoded_key or len(decoded_key.encode("utf-8")) > 1024:
            raise AwsContractError("invalid S3 key")
        item = S3ObjectEvent(bucket, decoded_key, version_id, event_name, sequencer)
        if item.idempotency_key in seen:
            continue
        seen.add(item.idempotency_key)
        parsed.append(item)
    return parsed
