"""Supplier content operations: shared exact-byte and validation primitives."""
from __future__ import annotations
import base64, hashlib, json, re, uuid, zlib
from datetime import datetime, timezone

SCHEMA = "supplier-content-workbench.v1"
MAX_UPLOAD = 48 * 1024 * 1024
MAX_EXPANDED = 96 * 1024 * 1024

class Problem(Exception):
    def __init__(self, code, message, status=400, details=None):
        super().__init__(message)
        self.code, self.status, self.details = code, status, details
    def record(self):
        return {"code": self.code, "message": str(self), "details": self.details}

def need(condition, code, message, status=400, details=None):
    if not condition:
        raise Problem(code, message, status, details)

def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

def ident(prefix):
    return prefix + "-" + uuid.uuid4().hex

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")

def digest(data):
    return hashlib.sha256(data).hexdigest()

def text(value, label, maximum=1000, optional=False):
    if value is None and optional:
        return ""
    need(isinstance(value, str), "TEXT_REQUIRED", label + " must be text.")
    value = value.strip()
    need((optional or bool(value)) and len(value) <= maximum and "\x00" not in value,
         "TEXT_INVALID", label + " is empty, too long, or contains an invalid character.")
    return value

def source_bytes(payload):
    name = text(payload.get("filename"), "Filename", 240)
    need("/" not in name and "\\" not in name and name not in (".", ".."),
         "FILENAME_INVALID", "Use the original file's name without a directory.")
    value = payload.get("content_base64")
    need(isinstance(value, str) and 0 < len(value) <= ((MAX_UPLOAD + 2) // 3) * 4,
         "UPLOAD_SIZE", "Choose a complete source file up to 48 MiB.")
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise Problem("UPLOAD_ENCODING", "The selected file is not valid base64.") from exc
    need(0 < len(raw) <= MAX_UPLOAD and base64.b64encode(raw).decode() == value,
         "UPLOAD_ENCODING", "The source file's exact bytes are required.")
    return name, raw

def gs1_check(value, lengths):
    if not isinstance(value, str) or len(value) not in lengths or not value.isascii() or not value.isdigit():
        return False
    total = sum(int(c) * (3 if i % 2 == 0 else 1) for i, c in enumerate(reversed(value[:-1])))
    return (10 - total % 10) % 10 == int(value[-1])

def field_at(item, path):
    if path.startswith("attributes."):
        name = path[len("attributes."):]
        values = [x.get("value") for x in item.get("attributes", []) if x.get("name") == name]
        if len(values) > 1:
            raise Problem("MAPPING_AMBIGUOUS", "A repeated native attribute needs a specific path.",
                          422, {"source": path, "matches": len(values)})
        return values[0] if values else None
    if path.startswith("native:"):
        selected = path[len("native:"):]
        values = [x.get("value") for x in item.get("attributes", []) if x.get("path") == selected]
        need(len(values) <= 1, "MAPPING_AMBIGUOUS", "The native attribute path is not unique.", 422)
        return values[0] if values else None
    current = item
    for part in path.split("."):
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
            current = current[int(part)]
        else:
            return None
    return current

def decompressed(raw, maximum=128 * 1024 * 1024):
    try:
        decoder = zlib.decompressobj()
        value = decoder.decompress(raw, maximum + 1)
        need(len(value) <= maximum and decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail,
             "COMPRESSED_RECORD_LIMIT", "The retained compressed record is incomplete or exceeds its supported size.", 422)
        return value
    except zlib.error as exc:
        raise Problem("COMPRESSED_RECORD_INVALID", "The retained compressed record is invalid.", 422) from exc
