"""Bounded, version-pinned S3 image ingress without SDK or vision dependencies."""
from __future__ import annotations

from typing import Any

READ_CHUNK_BYTES = 64 * 1024


class S3ImageInputError(ValueError):
    """An object does not satisfy the image input contract."""


def read_image_object(
    s3: Any, bucket: str, key: str, version_id: str = "", *, max_bytes: int,
) -> bytes:
    """Read at most max_bytes + 1 bytes and close the owned response body.

    ContentLength allows early rejection but never replaces the streaming bound.
    An extra byte distinguishes an exactly-at-limit object from an oversized one.
    """
    if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes < 1:
        raise ValueError("max_bytes must be a positive integer")
    kwargs = {"Bucket": bucket, "Key": key}
    if version_id:
        kwargs["VersionId"] = version_id
    response = s3.get_object(**kwargs)
    if not isinstance(response, dict):
        raise S3ImageInputError("S3 get_object returned an invalid response")
    body = response.get("Body")
    if body is None:
        raise S3ImageInputError("S3 object body missing")
    close = getattr(body, "close", None)
    if not callable(close):
        raise S3ImageInputError("S3 object body is not a closable stream")
    try:
        if not callable(getattr(body, "read", None)):
            raise S3ImageInputError("S3 object body is not readable")
        declared = response.get("ContentLength")
        if "ContentLength" in response:
            if isinstance(declared, bool) or not isinstance(declared, int) or declared < 0:
                raise S3ImageInputError("S3 ContentLength is invalid")
            if declared > max_bytes:
                raise S3ImageInputError("S3 image exceeds byte limit")
        raw = bytearray()
        while True:
            requested = min(READ_CHUNK_BYTES, max_bytes + 1 - len(raw))
            chunk = body.read(requested)
            if not isinstance(chunk, (bytes, bytearray)):
                raise S3ImageInputError("S3 object body was not bytes")
            if len(chunk) > requested:
                raise S3ImageInputError("S3 object body exceeded the requested read size")
            if not chunk:
                break
            raw.extend(chunk)
            if len(raw) > max_bytes:
                raise S3ImageInputError("S3 image exceeds byte limit")
        if declared is not None and len(raw) != declared:
            raise S3ImageInputError("S3 image length does not match ContentLength")
        if not raw:
            raise S3ImageInputError("S3 image is empty")
        result = bytes(raw)
    except BaseException:
        # Cleanup must not hide the original read/validation failure.
        try:
            close()
        except Exception:
            pass
        raise
    close()
    return result
