"""Use original durable primitives without modifying the shared common module."""
from __future__ import annotations
from . import common as _native

def _original(current, legacy):
    fn = getattr(_native, current, None)
    return fn if fn is not None else getattr(_native, legacy)

ContractError = getattr(_native, "ContractError", ValueError)
atomic_json = _native.atomic_json
digest = _native.digest
held = _native.held
canonical_bytes = _original("canonical", "canonical_bytes")
file_sha256 = _original("file_digest", "file_sha256")
load_json = _original("read_json", "load_json")
utc_now = _original("now", "utc_now")
