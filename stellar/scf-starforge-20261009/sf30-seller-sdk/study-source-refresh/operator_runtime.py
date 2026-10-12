"""One original Study HTTP owner and an authenticated source/instance identity."""
from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import os
from pathlib import Path
import stat
import sys
import uuid

from model import ROOT, encoded, fail, private_directory

INSTANCE_SCHEMA = "stellar-forge.study-operator-instance.v1"
SELECTION_SCHEMA = "stellar-forge.study-operator-selection.v1"
_SKIP = {"__pycache__", "node_modules", "examples", "test", "tests"}
_SUFFIXES = {".py", ".mjs", ".js", ".html", ".css"}


def source_files():
    result = {}
    for current, directories, filenames in os.walk(ROOT, followlinks=False):
        directories[:] = sorted(name for name in directories if name not in _SKIP and not name.startswith("."))
        for name in directories:
            if (Path(current) / name).is_symlink():
                fail("OPERATOR_SOURCE_SYMLINK")
        for name in sorted(filenames):
            path = Path(current) / name
            if name.startswith(".") or path.suffix not in _SUFFIXES:
                continue
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, "rb") as stream:
                before = os.fstat(stream.fileno())
                if not stat.S_ISREG(before.st_mode) or before.st_size > 8 * 1024 * 1024:
                    fail("OPERATOR_SOURCE_INVALID")
                digest = hashlib.sha256()
                while part := stream.read(65536):
                    digest.update(part)
                after = os.fstat(stream.fileno())
                if any(getattr(before, key) != getattr(after, key) for key in
                       ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")):
                    fail("OPERATOR_SOURCE_CHANGED")
                result[path.relative_to(ROOT).as_posix()] = digest.hexdigest()
    if not {"server.py", "application.py", "workspace.py", "operator_runtime.py"} <= result.keys():
        fail("OPERATOR_SOURCE_INCOMPLETE")
    return dict(sorted(result.items()))


@contextmanager
def operator_lease(directory):
    """Separate HTTP ownership from the original per-mutation SQLite lock."""
    directory = private_directory(directory)
    descriptor = os.open(directory / "operator.lock",
                         os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077
                or info.st_uid != os.getuid()):
            fail("OPERATOR_LEASE_INVALID")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("OPERATOR_ALREADY_RUNNING")
        sources = source_files()
        selection = {"schema": SELECTION_SCHEMA, "workspace_directory": str(directory),
                     "source_directory": str(ROOT), "source_files": sources}
        yield {"schema": INSTANCE_SCHEMA, "instance_id": str(uuid.uuid4()), "pid": os.getpid(),
               "selection": selection, "selection_sha256": hashlib.sha256(encoded(selection)).hexdigest(),
               "source_sha256": hashlib.sha256(encoded(sources)).hexdigest(),
               "execution": {"python_executable": sys.executable,
                             "python_realpath": str(Path(sys.executable).resolve())}}
    finally:
        os.close(descriptor)
