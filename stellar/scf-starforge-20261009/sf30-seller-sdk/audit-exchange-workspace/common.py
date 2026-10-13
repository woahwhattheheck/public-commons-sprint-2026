"""Shared exact-value and error primitives for Audit Exchange."""
from __future__ import annotations
import base64
import hashlib
import json
from datetime import datetime, timezone

class AuditError(Exception):
    def __init__(self, code, message, details=None, status=400):
        super().__init__(message)
        self.code, self.details, self.status = code, details, status

def require(condition, code, message, details=None, status=400):
    if not condition:
        raise AuditError(code, message, details, status)

def text(value, field, *, blank=True):
    require(isinstance(value, str), "invalid_input", field + " must be a string")
    require(blank or bool(value.strip()), "invalid_input", field + " is required")
    return value

def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def key(*parts):
    return digest("\0".join(str(p) for p in parts).encode("utf-8"))

def decode64(value, maximum=256 * 1024 * 1024):
    text(value, "contentBase64", blank=False)
    require(len(value) <= ((maximum + 2) // 3) * 4, "input_too_large", "The selected file exceeds the configured input capacity")
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as error:
        raise AuditError("invalid_base64", "The complete file must use valid base64") from error
    require(len(raw) <= maximum, "input_too_large", "The selected file exceeds the configured input capacity")
    return raw
