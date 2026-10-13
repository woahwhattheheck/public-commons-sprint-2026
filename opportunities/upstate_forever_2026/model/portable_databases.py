"""Consistent portable copies of mutable application databases.

Original model inputs and GIS products retain their exact bytes. Only databases
used as application state are captured through SQLite's online backup API.
"""
from __future__ import annotations

from contextlib import closing, contextmanager
from pathlib import Path
import sqlite3
import stat
import tempfile
import time

# This is the product's original project-local ProjectStore path. Unknown
# SQLite files may be scientific source editions and must retain exact bytes.
MUTABLE_DATABASE_MEMBERS = {"workspace/intelligence/investigations.sqlite3"}
SIDECARS = ("-wal", "-shm", "-journal")


def _state_database(name, path):
    return name in MUTABLE_DATABASE_MEMBERS


def _identity(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("Database capture requires a retained regular file")
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _same_file(path, identity):
    current = _identity(path)
    if current[:2] != identity[:2]:
        raise ValueError("A database was replaced during archive capture: " + str(path))


def without_database_files(inventory, database_names, namespace):
    """Compare ordinary files without treating a committed DB write as a race."""
    ignored = set()
    prefix = namespace + "/"
    for name in database_names:
        if name.startswith(prefix):
            relative = name[len(prefix):]
            ignored.add(relative)
            ignored.update(relative + suffix for suffix in SIDECARS)
    return {name: value for name, value in inventory.items() if name not in ignored}


def verify_database_sources(sources):
    for path, identity in sources.values():
        _same_file(path, identity)


@contextmanager
def snapshot_databases(inputs, directory):
    """Yield immutable archive inputs and a small record of database snapshots."""
    candidates = {}
    for name, path, identity in inputs:
        if not _state_database(name, path):
            continue
        with path.open("rb") as source:
            if source.read(16) != b"SQLite format 3\0":
                continue
        _same_file(path, identity)
        candidates[name] = (path, identity)
    if not candidates:
        yield inputs, {}, {}
        return

    ignored = {name + suffix for name in candidates for suffix in SIDECARS}
    with tempfile.TemporaryDirectory(prefix=".archive-sqlite-", dir=directory) as temporary:
        snapshots = {}
        records = {}
        for index, (name, (path, identity)) in enumerate(sorted(candidates.items())):
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
        selected = [
            snapshots.get(name, (name, path, identity))
            for name, path, identity in inputs if name not in ignored
        ]
        yield selected, records, candidates
