"""Shared serialization and provenance primitives. No model/runtime dependencies."""
from __future__ import annotations
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

VERSION = '1.0.0'

class IntelligenceError(Exception):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def loads(value: Any, default: Any = None) -> Any:
    if value is None or value == '':
        return default
    return json.loads(value) if isinstance(value, str) else value


def digest(value: Any) -> str:
    return hashlib.sha256(dumps(value).encode()).hexdigest()


def file_digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def finite(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (ValueError, TypeError, OverflowError):
        return None


def public_metadata(value: Any) -> Any:
    """Avoid propagating storage paths, bearer material, or signed source URLs."""
    from urllib.parse import urlsplit, urlunsplit
    if isinstance(value, dict):
        return {k: public_metadata(v) for k, v in value.items()
                if not any(s in k.lower() for s in ('password', 'secret', 'token', 'api_key', 'authorization', 'cookie'))
                and k.lower() not in {'path', 'output_dir', 'workspace_dir'} and not k.lower().endswith(('_path','_dir'))}
    if isinstance(value, list):
        return [public_metadata(v) for v in value]
    if isinstance(value, str) and value.startswith(('http://', 'https://')):
        u = urlsplit(value)
        host = u.hostname or ''
        if u.port:
            host += ':' + str(u.port)
        return urlunsplit((u.scheme, host, u.path, '', ''))
    return value
