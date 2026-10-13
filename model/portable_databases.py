"""Consistent portable copies of mutable application databases.

Original model inputs and GIS products retain their exact bytes. Only databases
used as application state are captured through SQLite's online backup API.
"""
from __future__ import annotations

from contextlib import closing, contextmanager
from pathlib import Path
import hashlib
import re
import sqlite3
import stat
import tempfile
import time

# This is the product's original project-local ProjectStore path. Unknown
# SQLite files may be scientific source editions and must retain exact bytes.
MUTABLE_DATABASE_MEMBERS = {
    "workspace/intelligence/investigations.sqlite3",
    "workspace/robust_decisions/robust_decisions.sqlite3",
    "workspace/conservation-design/editor/projects.sqlite",
}
SIDECARS = ("-wal", "-shm", "-journal")


def _state_database(name, path):
    """Recognize only original application-owned mutable database members."""
    return isinstance(name, str) and (
        name in MUTABLE_DATABASE_MEMBERS
        or re.fullmatch(r"workspace/source-refreshes/[0-9a-f]{64}/state\.sqlite3", name) is not None
    )


def _identity(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("Database capture requires a retained regular file")
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _same_file(path, identity):
    current = _identity(path)
    if current[:2] != identity[:2]:
        raise ValueError("A database was replaced during archive capture: " + str(path))


def without_database_files(inventory, databases, namespace):
    ignored = set()
    prefix = namespace + "/"
    for member, record in databases.items():
        if record.get("method") == "verified-frozen-snapshot" or not member.startswith(prefix):
            continue
        relative = member[len(prefix):]
        ignored.add(relative)
        ignored.update(relative + suffix for suffix in SIDECARS)
    return {name: identity for name, identity in inventory.items() if name not in ignored}


def _verify_frozen_database(name, path, identity, descriptor):
    """Verify a caller-frozen, self-contained SQLite member without rewriting it."""
    if not _state_database(name, path) or not isinstance(descriptor, dict):
        raise ValueError("Choose a supported frozen workspace database: " + name)
    size, expected = descriptor.get("bytes"), descriptor.get("sha256")
    if (type(size) is not int or size < 0 or not isinstance(expected, str)
            or len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected)):
        raise ValueError("A frozen database needs its exact bytes and SHA-256: " + name)
    if _identity(path) != identity or identity[2] != size:
        raise ValueError("The frozen database changed before archive capture: " + name)
    for suffix in SIDECARS:
        companion = path.with_name(path.name + suffix)
        if companion.exists() or companion.is_symlink():
            raise ValueError("A frozen database must have no live journal companions: " + name)
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while True:
            block = source.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
    if digest.hexdigest() != expected or _identity(path) != identity:
        raise ValueError("The frozen database content identity changed: " + name)


def verify_database_sources(sources):
    for name, captured in sources.items():
        path, identity = captured[:2]
        _same_file(path, identity)
        if len(captured) == 3:
            _verify_frozen_database(name, path, identity, captured[2])


@contextmanager
def snapshot_databases(inputs, directory, *, frozen=None):
    """Yield archive inputs, retaining explicitly verified frozen SQLite bytes.

    frozen maps complete archive member names to their expected bytes/sha256.
    Every other supported database uses the ordinary live SQLite online backup.
    """
    if frozen is None:
        frozen = {}
    if not isinstance(frozen, dict) or any(not isinstance(name, str) for name in frozen):
        raise ValueError("Frozen database identities must be keyed by archive member name.")
    frozen = {name: dict(value) if isinstance(value, dict) else value
              for name, value in frozen.items()}
    candidates = {}
    for name, path, identity in inputs:
        if not _state_database(name, path):
            continue
        with path.open("rb") as source:
            if source.read(16) != b"SQLite format 3\0":
                continue
        _same_file(path, identity)
        candidates[name] = (path, identity)
    unknown = set(frozen) - set(candidates)
    if unknown:
        raise ValueError("Frozen database members are absent or unsupported: " + ", ".join(sorted(unknown)))
    if not candidates:
        yield inputs, {}, {}
        return

    ignored = {name + suffix for name in candidates for suffix in SIDECARS}
    with tempfile.TemporaryDirectory(prefix=".archive-sqlite-", dir=directory) as temporary:
        snapshots = {}
        records = {}
        captured_sources = {}
        for index, (name, (path, identity)) in enumerate(sorted(candidates.items())):
            if name in frozen:
                _verify_frozen_database(name, path, identity, frozen[name])
                snapshots[name] = (name, path, identity)
                records[name] = {
                    "method": "verified-frozen-snapshot",
                    "journal": "self-contained",
                    "bytes": frozen[name]["bytes"],
                    "sha256": frozen[name]["sha256"],
                }
                captured_sources[name] = (path, identity, frozen[name])
                continue
            snapshot = Path(temporary) / (str(index) + ".sqlite3")
            _same_file(path, identity)
            busy_since = None

            def progress(status, remaining, total):
                nonlocal busy_since
                if status in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
                    current = time.monotonic()
                    if busy_since is None:
                        busy_since = current
                    elif current - busy_since >= 30:
                        raise ValueError("Database remained locked during archive capture: " + name)
                else:
                    busy_since = None

            try:
                # mode=ro retains committed WAL transactions. immutable=1 would
                # silently ignore them and is deliberately not used here.
                with closing(sqlite3.connect(path.absolute().as_uri() + "?mode=ro",
                                             uri=True, timeout=30)) as source:
                    source.execute("BEGIN")
                    source.execute("SELECT name FROM sqlite_schema LIMIT 1").fetchone()
                    with closing(sqlite3.connect(snapshot)) as target:
                        source.backup(target, pages=256, progress=progress)
                        target.execute("PRAGMA journal_mode=DELETE")
                        target.commit()
            except sqlite3.Error as error:
                raise ValueError("Could not capture application database " + name +
                                 ": " + str(error)) from error
            _same_file(path, identity)
            snapshots[name] = (name, snapshot, _identity(snapshot))
            records[name] = {
                "method": "sqlite-online-backup",
                "journal": "self-contained",
            }
            captured_sources[name] = (path, identity)
        selected = [
            snapshots.get(name, (name, path, identity))
            for name, path, identity in inputs if name not in ignored
        ]
        yield selected, records, captured_sources
