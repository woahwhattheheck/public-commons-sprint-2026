"""Reuse verified original bodies only within one synchronous native operation."""
from __future__ import annotations

from collections import OrderedDict
import contextlib
from contextvars import ContextVar
from functools import wraps
import os
from pathlib import Path
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
        self.source_hash_reads = 0
        self.source_hashed_bytes = 0
        self.source_copied_bytes = 0
        self.source_reused_verifications = 0

    def owns_context(self):
        return self.owner == (os.getpid(), threading.get_ident())

    def observation(self):
        return {"hash_reads": self.hash_reads, "hashed_bytes": self.hashed_bytes,
                "reused_verifications": self.reused_verifications,
                "source_hash_reads": self.source_hash_reads,
                "source_hashed_bytes": self.source_hashed_bytes,
                "source_copied_bytes": self.source_copied_bytes,
                "source_reused_verifications": self.source_reused_verifications}

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
    from .host_files import open_regular, stat_regular

    label = "Retained output"
    expected_size, expected_hash = item["bytes"], item["sha256"]
    key = (str(path), expected_size, expected_hash)
    current = _CURRENT.get()
    if current is not None and not current.owns_context():
        current = None
    descriptor = open_regular(path, os.O_RDONLY)
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
        at_path = stat_regular(path)
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

def source_identity(source, path, label, *, expected_state=None, output=None):
    """Hash an opened original, or reuse this operation's exact stable inode.

    Copies always stream and hash. A cache hit still opens the original file and
    compares its regular-file identity with both the current path and descriptor.
    No verified state survives the outer operation, thread, process, or a write.
    """
    from .common import _file_state, _stream_identity
    from .host_files import stat_regular

    path = Path(path)
    opened = os.fstat(source.fileno())
    if not stat.S_ISREG(opened.st_mode):
        raise ValueError(label + " is not a regular file")
    state = _file_state(opened)
    if expected_state is not None and state != expected_state:
        raise ValueError(label + " changed during intake")
    at_path = stat_regular(path)
    if not stat.S_ISREG(at_path.st_mode) or _file_state(at_path) != state:
        raise ValueError(label + " changed at its original path")
    current = _CURRENT.get()
    if current is not None and not current.owns_context():
        current = None
    # Hard-link aliases may reuse an identity only while ALL inode metadata
    # remains exact. Creating/removing a link changes ctime and misses this key.
    links = opened.st_nlink
    key = ("original-source", state, links)
    cached = current.entries.get(key) if current is not None else None
    reused = output is None and cached is not None
    if reused:
        checksum, size = cached
    else:
        checksum, size, state = _stream_identity(
            source, label, expected_state=state, output=output)
        if current is not None:
            current.source_hash_reads += 1
            current.source_hashed_bytes += size
            if output is not None:
                current.source_copied_bytes += size
    at_path = stat_regular(path)
    if (not stat.S_ISREG(at_path.st_mode) or _file_state(at_path) != state
            or at_path.st_nlink != links
            or _file_state(os.fstat(source.fileno())) != state
            or os.fstat(source.fileno()).st_nlink != links):
        if current is not None:
            current.entries.pop(key, None)
        raise ValueError(label + " changed during intake")
    if size != opened.st_size:
        raise ValueError(label + " changed length during intake")
    if current is not None:
        if reused:
            current.source_reused_verifications += 1
        current.remember(key, (checksum, size))
    return checksum, size, state
