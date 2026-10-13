"""Crash-safe local experiment storage. Copyright 2026 TokenJunkieLabs."""
from __future__ import annotations
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value):
        raise ValueError('Use a complete retained experiment or run ID')
    return value


def read(path):
    def invalid(value):
        raise ValueError('Nonfinite JSON value: ' + value)
    return json.loads(Path(path).read_text(encoding='utf-8'), parse_constant=invalid)


def atomic(path, value, *, immutable=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    body = canonical(value) + b'\n'
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.pending-', delete=False) as f:
            pending = Path(f.name)
            f.write(body)
            f.flush()
            os.fsync(f.fileno())
        if immutable:
            try:
                os.link(pending, path)
            except FileExistsError:
                if path.read_bytes() != body:
                    raise ValueError('Immutable experiment item changed: ' + path.name)
        else:
            os.replace(pending, path)
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if pending:
            pending.unlink(missing_ok=True)


@contextlib.contextmanager
def held(path, *, blocking=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        yield
    finally:
        os.close(fd)


def fingerprint(path):
    path = Path(path)
    h = hashlib.sha256()
    with path.open('rb') as f:
        before = os.fstat(f.fileno())
        for b in iter(lambda: f.read(1024*1024), b''):
            h.update(b)
        after = os.fstat(f.fileno())
    fields = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if fields(before) != fields(after):
        raise ValueError('Source changed while reading: ' + path.name)
    return {'bytes': after.st_size, 'sha256': h.hexdigest()}


def member(root, name):
    root = Path(root).resolve()
    if not isinstance(name, str) or '\\' in name or '\0' in name:
        raise ValueError('Invalid project member')
    p = Path(name)
    if p.is_absolute() or not p.parts or '..' in p.parts or p.as_posix() != name:
        raise ValueError('Use a canonical relative project member')
    path = (root / p).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError('Project member is outside its workspace')
    return path


def verify(root, item):
    path = member(root, item['path'])
    actual = fingerprint(path)
    if any(actual[k] != item[k] for k in actual):
        raise ValueError('Retained result changed: ' + item['path'])
    return path
