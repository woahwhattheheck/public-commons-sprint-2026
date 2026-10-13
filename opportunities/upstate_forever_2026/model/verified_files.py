"""Reuse verified original bodies only within one synchronous native operation."""
from __future__ import annotations

from collections import OrderedDict
import contextlib
from contextvars import ContextVar
from functools import wraps
import os
import stat
import threading

_CURRENT = ContextVar("upstate_verified_file_operation", default=None)
_MAX_ENTRIES = 16384


class VerifiedFiles:
    """Transient verified identities; no file bytes or persistent cache."""
    def __init__(self):
        self.owner = (os.getpid(), threading.get_ident())
        self.entries = OrderedDict()
        self.hash_reads = 0
        self.hashed_bytes = 0
        self.reused_verifications = 0

    def owns_context(self):
        return self.owner == (os.getpid(), threading.get_ident())

    def observation(self):
        return {"hash_reads": self.hash_reads, "hashed_bytes": self.hashed_bytes,
                "reused_verifications": self.reused_verifications}

    def remember(self, key, state):
        self.entries[key] = state
        self.entries.move_to_end(key)
        while len(self.entries) > _MAX_ENTRIES:
            self.entries.popitem(last=False)


@contextlib.contextmanager
def verified_files():
    """Join a nested operation, or own an empty scope until this call ends."""
    current = _CURRENT.get()
    if current is not None and current.owns_context():
        yield current
        return
    current = VerifiedFiles()
    token = _CURRENT.set(current)
    try:
        yield current
    finally:
        current.entries.clear()
        _CURRENT.reset(token)


def verified_operation(function):
    """Give the existing synchronous native entry an operation-local scope."""
    @wraps(function)
    def run(*args, **kwargs):
        with verified_files():
            return function(*args, **kwargs)
    return run


def verify_path(path, item):
    """Open and bind the selected regular inode before using a verified body."""
    # Import lazily: common.verify_file retains the public path validation API.
    from .common import _file_state, _stream_identity

    label = "Retained output"
    expected_size, expected_hash = item["bytes"], item["sha256"]
    key = (str(path), expected_size, expected_hash)
    current = _CURRENT.get()
    if current is not None and not current.owns_context():
        current = None
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        opened = os.fstat(source.fileno())
        if not stat.S_ISREG(opened.st_mode) or opened.st_size != expected_size:
            raise ValueError("Retained output changed: " + item["path"])
        state = _file_state(opened)
        reused = current is not None and current.entries.get(key) == state
        if reused:
            actual, count = expected_hash, expected_size
        else:
            actual, count, state = _stream_identity(source, label, expected_state=state)
            if current is not None:
                current.hash_reads += 1
                current.hashed_bytes += count
        if actual != expected_hash or count != expected_size:
            if current is not None:
                current.entries.pop(key, None)
            raise ValueError("Retained output changed: " + item["path"])
        # A rename, symlink swap or write during this read cannot publish a
        # verified identity for another path or body.
        at_path = path.lstat()
        if (not stat.S_ISREG(at_path.st_mode) or _file_state(at_path) != state
                or _file_state(os.fstat(source.fileno())) != state):
            if current is not None:
                current.entries.pop(key, None)
            raise ValueError("Retained output changed during verification: " + item["path"])
        if current is not None:
            if reused:
                current.reused_verifications += 1
            current.remember(key, state)
    return path
