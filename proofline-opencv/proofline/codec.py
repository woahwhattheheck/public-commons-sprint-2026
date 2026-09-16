from __future__ import annotations

import hashlib
import json
import math
from typing import Any

MAX_CANONICAL_BYTES = 2_000_000


class CodecError(ValueError):
    pass


def _walk(value: Any, depth: int = 0) -> None:
    if depth > 32:
        raise CodecError("maximum JSON depth exceeded")
    if value is None or isinstance(value, (bool, str)):
        if isinstance(value, str):
            try:
                value.encode("utf-8", "strict")
            except UnicodeEncodeError as exc:
                raise CodecError("strings must be valid UTF-8 scalars") from exc
        return
    if isinstance(value, int) and not isinstance(value, bool):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise CodecError("non-finite numbers are forbidden")
        return
    if isinstance(value, list):
        for item in value:
            _walk(item, depth + 1)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise CodecError("JSON object keys must be strings")
            _walk(key, depth + 1)
            _walk(item, depth + 1)
        return
    raise CodecError(f"unsupported canonical JSON type: {type(value).__name__}")


def canonical_json(value: Any) -> bytes:
    _walk(value)
    try:
        raw = json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8", "strict")
    except (TypeError, ValueError, UnicodeEncodeError) as exc:
        raise CodecError("value is not canonical JSON") from exc
    if len(raw) > MAX_CANONICAL_BYTES:
        raise CodecError("canonical payload exceeds size limit")
    return raw


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest_json(value: Any) -> str:
    return sha256_hex(canonical_json(value))


def loads_strict(raw: bytes | str, *, max_bytes: int = MAX_CANONICAL_BYTES) -> Any:
    if isinstance(raw, str):
        try:
            encoded = raw.encode("utf-8", "strict")
        except UnicodeEncodeError as exc:
            raise CodecError("input must be valid UTF-8") from exc
    elif isinstance(raw, bytes):
        encoded = raw
    else:
        raise CodecError("input must be bytes or str")
    if len(encoded) > max_bytes:
        raise CodecError("input exceeds size limit")
    try:
        value = json.loads(encoded.decode("utf-8", "strict"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CodecError("invalid JSON") from exc
    _walk(value)
    return value
