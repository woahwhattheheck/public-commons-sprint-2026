#!/usr/bin/env python3
"""Join the maintained opening files into an existing complete collection."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile


def digest(path: Path) -> str | None:
    if path.is_symlink():
        raise ValueError('Preserved a linked collection member: ' + str(path))
    if not path.exists():
        return None
    if not path.is_file() or getattr(path.lstat(), 'st_file_attributes', 0) & 0x400:
        raise ValueError('Preserved a nonregular collection member: ' + str(path))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('collection', type=Path)
    args = parser.parse_args()
    root = args.collection.expanduser().resolve(strict=True)
    source = Path(__file__).resolve().parent
    manifest = json.loads((source / 'OPENING_COMPONENT.json').read_text(encoding='utf-8'))
    if not (root / 'application').is_dir() or not (root / 'STUDIES.json').is_file():
        raise ValueError('Choose the complete existing collection, not an application-only checkout')
    plan = []
    for row in manifest['files']:
        name = row['path']
        if not isinstance(name, str) or Path(name).name != name or name in ('.', '..'):
            raise ValueError('Opening component must contain root files only')
        incoming, destination = source / name, root / name
        if digest(incoming) != row['sha256']:
            raise ValueError('Receive the complete opening source file: ' + name)
        before = digest(destination)
        if before == row['sha256']:
            continue
        allowed = row['predecessor_sha256']
        if before is not None and before not in allowed:
            raise ValueError('Preserved concurrent collection edits in ' + name + '; compose this current file before applying')
        plan.append((row, incoming, destination, before))
    # Preflight every file before mutating any original. Data and manifests are
    # outside this component's file list and are never rewritten here.
    for row, incoming, destination, before in plan:
        fd, temporary_name = tempfile.mkstemp(prefix='.' + row['path'] + '.', dir=root)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(incoming.read_bytes())
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, int(row['mode'], 8))
            if digest(destination) != before:
                raise ValueError('Preserved a concurrent collection edit: ' + row['path'])
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
    print(json.dumps({'component': manifest['component'], 'updated': [row[0]['path'] for row in plan]}, sort_keys=True))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError) as error:
        parser_message = str(error)
        import sys
        print(parser_message, file=sys.stderr)
        raise SystemExit(2)
