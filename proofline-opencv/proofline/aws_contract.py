from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import unquote_plus

from .vision import PIPELINE_GENERATION

MAX_RECORDS = 32


class AwsContractError(ValueError):
    pass


def _bounded_text(value: Any, name: str, max_bytes: int) -> str:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise AwsContractError(f"{name} must be non-empty text")
    try:
        raw = value.encode("utf-8", "strict")
    except UnicodeEncodeError as exc:
        raise AwsContractError(f"{name} must be valid UTF-8") from exc
    if len(raw) > max_bytes:
        raise AwsContractError(f"{name} exceeds byte limit")
    return value


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

    def bound_idempotency_key(
        self,
        *,
        reference_bucket: str,
        reference_key: str,
        reference_version_id: str,
    ) -> str:
        ref_bucket = _bounded_text(reference_bucket, "reference_bucket", 255)
        ref_key = _bounded_text(reference_key, "reference_key", 1024)
        ref_version = _bounded_text(reference_version_id, "reference_version_id", 1024)
        if ref_version == "null":
            # Suspended-bucket null versions are overwriteable, not immutable pins.
            raise AwsContractError("reference_version_id must name an immutable S3 version")
        material = "\0".join([
            self.bucket,
            self.key,
            self.version_id,
            self.event_name,
            self.sequencer,
            ref_bucket,
            ref_key,
            ref_version,
            PIPELINE_GENERATION,
        ]).encode("utf-8")
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
        version_id = obj.get("versionId")
        if not isinstance(key, str) or not key or not isinstance(sequencer, str) or not sequencer:
            raise AwsContractError("key and sequencer are required")
        if not isinstance(version_id, str) or not version_id.strip() or version_id == "null":
            # Missing/unversioned and suspended-bucket null IDs can read an
            # overwritten LATEST object. Never record that as a pinned source.
            raise AwsContractError("non-null versionId required for exact S3 inspection generation")
        _bounded_text(version_id, "versionId", 1024)
        # S3 object keys are application/x-www-form-urlencoded in notifications.
        # Default unquote_plus() replaces malformed UTF-8 with U+FFFD, silently
        # changing the object selected for inspection.
        if re.search(r"%(?![0-9A-Fa-f]{2})", key):
            raise AwsContractError("S3 event key contains malformed percent encoding")
        try:
            decoded_key = unquote_plus(key, encoding="utf-8", errors="strict")
            byte_length = len(decoded_key.encode("utf-8", "strict"))
        except (UnicodeError, ValueError) as exc:
            raise AwsContractError("S3 event key must decode as valid UTF-8") from exc
        if "\x00" in decoded_key or byte_length > 1024:
            raise AwsContractError("invalid S3 key")
        item = S3ObjectEvent(bucket, decoded_key, version_id, event_name, sequencer)
        if item.idempotency_key in seen:
            continue
        seen.add(item.idempotency_key)
        parsed.append(item)
    return parsed
