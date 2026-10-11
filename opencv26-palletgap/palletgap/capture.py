"""Trusted, version-pinned S3 publisher for PalletGap capture evidence.

The producer uploads and reads back every input before publishing the request
manifest. It never treats an S3 key, ETag, or caller-supplied version as proof
that the inspected bytes were stored.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
from pathlib import Path
import re
from typing import Any


MAX_CONFIG_BYTES = 32_768
MAX_FRAME_BYTES = 12_000_000
SITE_RE = re.compile(r"^[A-Za-z0-9_-]{1,50}$")
CAPTURE_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _read(path: str | Path, maximum: int) -> bytes:
    source = Path(path)
    size = source.stat().st_size
    if not 0 < size <= maximum:
        raise ValueError(f"{source} size is outside the supported bounds")
    raw = source.read_bytes()
    if len(raw) != size:
        raise ValueError(f"{source} changed while it was read")
    return raw


def _read_json(path: str | Path) -> dict[str, Any]:
    raw = _read(path, MAX_CONFIG_BYTES)
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("Camera configuration must be a JSON object")
    return value


def _version(response: dict[str, Any], key: str) -> str:
    value = response.get("VersionId")
    if not isinstance(value, str) or value in ("", "null") or len(value) > 512:
        raise ValueError(f"S3 did not return a real VersionId for {key}")
    if any(ord(char) < 32 for char in value):
        raise ValueError(f"S3 returned an invalid VersionId for {key}")
    return value


def _extension(path: str | Path) -> str:
    suffix = Path(path).suffix.lower()
    if suffix not in IMAGE_SUFFIXES:
        raise ValueError(f"Unsupported image extension: {suffix}")
    return suffix


class CapturePublisher:
    """Publish one immutable schema-2 capture set to a versioned bucket."""

    def __init__(self, s3, bucket: str):
        if not isinstance(bucket, str) or not bucket:
            raise ValueError("Bucket is required")
        self.s3 = s3
        self.bucket = bucket
        self.published: list[dict[str, Any]] = []

    def _put_verified(self, key: str, raw: bytes, content_type: str) -> dict[str, Any]:
        digest = _sha256(raw)
        response = self.s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=raw,
            ContentLength=len(raw),
            ContentType=content_type,
            Metadata={"sha256": digest},
            IfNoneMatch="*",
        )
        version_id = _version(response, key)
        stored = self.s3.get_object(Bucket=self.bucket, Key=key, VersionId=version_id)
        if _version(stored, key) != version_id:
            raise ValueError(f"S3 readback version mismatch for {key}")
        body = stored["Body"].read(len(raw) + 1)
        metadata_digest = stored.get("Metadata", {}).get("sha256")
        if body != raw or metadata_digest != digest:
            raise ValueError(f"S3 byte readback mismatch for {key}")
        receipt = {"key": key, "version_id": version_id, "sha256": digest, "bytes": len(raw)}
        self.published.append(receipt)
        return receipt

    def publish(
        self,
        *,
        site: str,
        capture_id: str,
        camera_id: str,
        camera_config: str | Path,
        reference: str | Path,
        first: str | Path,
        second: str | Path | None = None,
    ) -> dict[str, Any]:
        if not SITE_RE.fullmatch(site):
            raise ValueError("Invalid site identifier")
        if not CAPTURE_RE.fullmatch(capture_id) or not CAPTURE_RE.fullmatch(camera_id):
            raise ValueError("Invalid capture or camera identifier")
        config = _read_json(camera_config)
        if "aisle_polygon" not in config:
            raise ValueError("Camera configuration requires aisle_polygon")

        reference_raw = _read(reference, MAX_FRAME_BYTES)
        first_raw = _read(first, MAX_FRAME_BYTES)
        second_raw = _read(second, MAX_FRAME_BYTES) if second is not None else None
        reference_key = f"frames/{site}/{capture_id}-reference{_extension(reference)}"
        first_key = f"frames/{site}/{capture_id}-first{_extension(first)}"
        second_key = (
            f"frames/{site}/{capture_id}-second{_extension(second)}"
            if second is not None else None
        )

        reference_receipt = self._put_verified(
            reference_key, reference_raw, mimetypes.guess_type(reference_key)[0] or "application/octet-stream"
        )
        first_receipt = self._put_verified(
            first_key, first_raw, mimetypes.guess_type(first_key)[0] or "application/octet-stream"
        )
        second_receipt = None
        if second_raw is not None and second_key is not None:
            second_receipt = self._put_verified(
                second_key, second_raw, mimetypes.guess_type(second_key)[0] or "application/octet-stream"
            )

        config = dict(config)
        config["reference_key"] = reference_key
        config["reference_version_id"] = reference_receipt["version_id"]
        config_raw = json.dumps(config, sort_keys=True, separators=(",", ":")).encode()
        if len(config_raw) > MAX_CONFIG_BYTES:
            raise ValueError("Derived camera configuration is too large")
        config_key = f"config/{site}/{camera_id}.json"
        config_receipt = self._put_verified(config_key, config_raw, "application/json")

        manifest = {
            "schema": 2,
            "site": site,
            "camera_key": config_key,
            "camera_version_id": config_receipt["version_id"],
            "first_key": first_key,
            "first_version_id": first_receipt["version_id"],
        }
        if second_receipt is not None and second_key is not None:
            manifest.update(second_key=second_key, second_version_id=second_receipt["version_id"])
        manifest_raw = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        # Publish last: no request event can exist before every referenced byte and
        # VersionId has been independently read back.
        manifest_key = f"requests/{site}/{capture_id}.json"
        manifest_receipt = self._put_verified(manifest_key, manifest_raw, "application/json")
        return {
            "schema": "palletgap.capture-receipt/v1",
            "bucket": self.bucket,
            "manifest": {**manifest_receipt, "body_sha256": _sha256(manifest_raw)},
            "inputs": {
                "reference": reference_receipt,
                "first": first_receipt,
                "second": second_receipt,
                "camera": config_receipt,
            },
        }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Publish a version-pinned PalletGap capture")
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--site", required=True)
    parser.add_argument("--capture-id", required=True)
    parser.add_argument("--camera-id", required=True)
    parser.add_argument("--camera-config", required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--first", required=True)
    parser.add_argument("--second")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    import boto3

    receipt = CapturePublisher(boto3.client("s3"), args.bucket).publish(
        site=args.site,
        capture_id=args.capture_id,
        camera_id=args.camera_id,
        camera_config=args.camera_config,
        reference=args.reference,
        first=args.first,
        second=args.second,
    )
    print(json.dumps(receipt, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
