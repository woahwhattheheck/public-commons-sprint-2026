#!/usr/bin/env python3
"""Join the maintained opening files into an existing complete collection."""
from __future__ import annotations
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, stat.S_IMODE(info.st_mode))


def read_member(path: Path):
    """Read one stable regular member, preserving aliases and concurrent edits."""
    try:
        before = path.lstat()
    except FileNotFoundError:
        return None, None
    if (not stat.S_ISREG(before.st_mode)
            or getattr(before, 'st_file_attributes', 0) & 0x400):
        raise ValueError('Preserved a nonregular collection member: ' + str(path))
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
                 | getattr(os, 'O_NONBLOCK', 0))
    with os.fdopen(fd, 'rb') as stream:
        if identity(os.fstat(stream.fileno())) != identity(before):
            raise ValueError('Preserved a collection member changed while opening: ' + str(path))
        body = stream.read()
        after = os.fstat(stream.fileno())
    if (identity(before) != identity(after)
            or identity(after) != identity(path.lstat()) or len(body) != before.st_size):
        raise ValueError('Preserved a collection member changed while reading: ' + str(path))
    return body, after


def digest(path: Path) -> str | None:
    body, _ = read_member(path)
    return None if body is None else hashlib.sha256(body).hexdigest()


def sync_directory(root):
    if os.name != 'nt':
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


@contextlib.contextmanager
def installation_lock(root):
    # A persistent, shared lock serializes component receivers in this collection.
    # Never unlink it: another receiver may already be waiting on the same inode.
    path = root / '.collection-opening.lock'
    if path.exists() or path.is_symlink():
        read_member(path)
    fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode)
                or identity(info) != identity(path.lstat())
                or getattr(info, 'st_file_attributes', 0) & 0x400):
            raise ValueError('Preserved a nonregular collection opening lock')
        if os.name == 'nt':
            import msvcrt
            if info.st_size == 0:
                os.write(fd, b'0')
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


def restore_execute_mode(path, expected, mode):
    """Repair only execute bits on the identical installed launcher, never data."""
    if os.name == 'nt' or not mode & 0o111:
        return False
    body, before = read_member(path)
    if body is None or hashlib.sha256(body).hexdigest() != expected:
        raise ValueError('Preserved a concurrent collection edit: ' + path.name)
    desired = stat.S_IMODE(before.st_mode) | (mode & 0o111)
    if desired == stat.S_IMODE(before.st_mode):
        return False
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        if identity(os.fstat(fd)) != identity(before):
            raise ValueError('Preserved a launcher changed before mode restoration: ' + path.name)
        os.fchmod(fd, desired)
        os.fsync(fd)
        after = os.fstat(fd)
        if identity(after) != identity(path.lstat()):
            raise ValueError('Preserved a launcher replaced during mode restoration: ' + path.name)
    finally:
        os.close(fd)
    if digest(path) != expected:
        raise ValueError('The launcher changed during mode restoration: ' + path.name)
    return True


def apply(collection: Path, source: Path | None = None):
    """Receive one full root component; keep original application and Studies."""
    root = Path(collection).expanduser().resolve(strict=True)
    source = Path(source or Path(__file__).resolve().parent).resolve(strict=True)
    raw, _ = read_member(source / 'OPENING_COMPONENT.json')
    manifest = json.loads(raw)
    if (not isinstance(manifest, dict)
            or manifest.get('schema') != 'upstate.collection-opening-component/v1'
            or not isinstance(manifest.get('files'), list) or not manifest['files']):
        raise ValueError('Receive the complete original opening component manifest')
    if not (root / 'application').is_dir() or not (root / 'STUDIES.json').is_file():
        raise ValueError('Choose the complete existing collection, not an application-only checkout')
    updated, repaired = [], []
    with installation_lock(root):
        plan, names = [], set()
        for row in manifest['files']:
            name = row['path']
            if (not isinstance(name, str) or not name or Path(name).name != name
                    or name in ('.', '..') or any(c in name for c in ('\\', ':', '\0'))
                    or name.casefold() in names):
                raise ValueError('Opening component must contain distinct portable root files only')
            names.add(name.casefold())
            incoming, destination = source / name, root / name
            body, _ = read_member(incoming)
            expected, allowed = row['sha256'], row['predecessor_sha256']
            if (not isinstance(expected, str) or not re.fullmatch('[0-9a-f]{64}', expected)
                    or not isinstance(allowed, list)
                    or any(not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value)
                           for value in allowed)
                    or type(row['bytes']) is not int or row['bytes'] < 0
                    or not isinstance(row['mode'], str) or not re.fullmatch('0?[0-7]{3}', row['mode'])):
                raise ValueError('Receive the complete opening descriptor: ' + name)
            if body is None or len(body) != row['bytes'] or hashlib.sha256(body).hexdigest() != expected:
                raise ValueError('Receive the complete opening source file: ' + name)
            current, before = read_member(destination)
            previous = None if current is None else hashlib.sha256(current).hexdigest()
            if previous is not None and previous != expected and previous not in allowed:
                raise ValueError('Preserved concurrent collection edits in ' + name + '; compose this current file before applying')
            plan.append((row, body, destination, before, previous == expected))
        # Preflight every source and destination before repairing modes or bytes.
        for row, body, destination, before, unchanged in plan:
            if unchanged:
                if restore_execute_mode(destination, row['sha256'], int(row['mode'], 8)):
                    repaired.append(row['path'])
                continue
            fd, temporary_name = tempfile.mkstemp(prefix='.' + row['path'] + '.', dir=root)
            temporary = Path(temporary_name)
            try:
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(body)
                    stream.flush()
                    if hasattr(os, 'fchmod'):
                        os.fchmod(stream.fileno(), int(row['mode'], 8))
                    else:
                        os.chmod(temporary, int(row['mode'], 8))
                    os.fsync(stream.fileno())
                _, current = read_member(destination)
                if ((current is None) != (before is None)
                        or (before is not None and identity(current) != identity(before))):
                    raise ValueError('Preserved a concurrent collection edit: ' + row['path'])
                os.replace(temporary, destination)
                sync_directory(root)
                updated.append(row['path'])
            finally:
                temporary.unlink(missing_ok=True)
    return {'component': manifest['component'], 'updated': updated, 'mode_repaired': repaired}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('collection', type=Path)
    args = parser.parse_args()
    print(json.dumps(apply(args.collection), sort_keys=True))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError) as error:
        import sys
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
