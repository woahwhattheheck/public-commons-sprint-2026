#!/usr/bin/env python3
"""Join the maintained opening files into an existing complete collection."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile


BLOCK = 1024 * 1024


def digest(path: Path) -> str | None:
    if path.is_symlink():
        raise ValueError('Preserved a linked collection member: ' + str(path))
    if not path.exists():
        return None
    if not path.is_file() or getattr(path.lstat(), 'st_file_attributes', 0) & 0x400:
        raise ValueError('Preserved a nonregular collection member: ' + str(path))
    result = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(BLOCK):
            result.update(block)
    return result.hexdigest()


def declared_mode(row: dict) -> int:
    value = row['mode']
    if not isinstance(value, str):
        raise ValueError('Opening component mode must be an octal string: ' + row['path'])
    try:
        mode = int(value, 8)
    except ValueError as error:
        raise ValueError('Opening component mode is not octal: ' + row['path']) from error
    if mode < 0 or mode > 0o777 or format(mode, '04o') != value:
        raise ValueError('Opening component mode is not canonical: ' + row['path'])
    return mode


def descriptor_digest(descriptor: int) -> str:
    result = hashlib.sha256()
    with os.fdopen(os.dup(descriptor), 'rb') as stream:
        while block := stream.read(BLOCK):
            result.update(block)
    return result.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('collection', type=Path)
    args = parser.parse_args()
    root = args.collection.expanduser().resolve(strict=True)
    source = Path(__file__).resolve().parent
    manifest = json.loads((source / 'OPENING_COMPONENT.json').read_text(encoding='utf-8'))
    application = root / 'application'
    if not application.is_dir() or not (root / 'STUDIES.json').is_file():
        raise ValueError('Choose the complete existing collection, not an application-only checkout')
    sys.path.insert(0, str(application))
    from model import portable_fs

    plan = []
    mode_plan = []
    for row in manifest['files']:
        name = row['path']
        if not isinstance(name, str) or Path(name).name != name or name in ('.', '..'):
            raise ValueError('Opening component must contain root files only')
        mode = declared_mode(row)
        incoming, destination = source / name, root / name
        if digest(incoming) != row['sha256']:
            raise ValueError('Receive the complete opening source file: ' + name)
        before = digest(destination)
        if before == row['sha256']:
            if os.name != 'nt' and stat.S_IMODE(destination.lstat().st_mode) != mode:
                mode_plan.append((row, destination, mode))
            continue
        allowed = row['predecessor_sha256']
        if before is not None and before not in allowed:
            raise ValueError('Preserved concurrent collection edits in ' + name + '; compose this current file before applying')
        plan.append((row, incoming, destination, before, mode))

    # Preflight every file before mutating any original. Data and manifests are
    # outside this component's file list and are never rewritten here.
    updated = []
    for row, incoming, destination, before, mode in plan:
        fd, temporary_name = tempfile.mkstemp(prefix='.' + row['path'] + '.', dir=root)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(incoming.read_bytes())
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, mode)
            if digest(destination) != before:
                raise ValueError('Preserved a concurrent collection edit: ' + row['path'])
            portable_fs.replace(temporary, destination)
            updated.append(row['path'])
        finally:
            temporary.unlink(missing_ok=True)

    mode_repaired = []
    for row, destination, mode in mode_plan:
        descriptor = portable_fs.open_file(destination, os.O_RDONLY)
        try:
            before = portable_fs.fd_stat(descriptor)
            if descriptor_digest(descriptor) != row['sha256']:
                raise ValueError('Preserved a concurrent collection edit: ' + row['path'])
            after = portable_fs.fd_stat(descriptor)
            identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            identity_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
            if identity_after != identity_before:
                raise ValueError('Preserved a concurrent collection edit: ' + row['path'])
            if stat.S_IMODE(after.st_mode) != mode:
                os.fchmod(descriptor, mode)
                os.fsync(descriptor)
                mode_repaired.append(row['path'])
        finally:
            os.close(descriptor)

    if updated or mode_repaired:
        portable_fs.sync_directory(root)
    print(json.dumps({
        'component': manifest['component'],
        'mode_repaired': mode_repaired,
        'updated': updated,
    }, sort_keys=True))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError) as error:
        parser_message = str(error)
        print(parser_message, file=sys.stderr)
        raise SystemExit(2)
