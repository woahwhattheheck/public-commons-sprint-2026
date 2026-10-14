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
import uuid


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, info.st_mode)


def read_original(path, fs, *, missing=False):
    """Read one stable regular file through the selected native filesystem."""
    try:
        before = fs.path_stat(path)
    except FileNotFoundError:
        if missing:
            return None, None
        raise
    if (not stat.S_ISREG(before.st_mode)
            or getattr(before, 'st_file_attributes', 0) & 0x400):
        raise ValueError('Preserved a nonregular collection member: ' + str(path))
    with os.fdopen(fs.open_file(path, os.O_RDONLY), 'rb') as stream:
        opened = fs.fd_stat(stream.fileno())
        if identity(before) != identity(opened):
            raise ValueError('Collection member changed while opening: ' + str(path))
        body = stream.read()
        after = fs.fd_stat(stream.fileno())
    current = fs.path_stat(path)
    if (identity(before) != identity(after) or identity(after) != identity(current)
            or len(body) != current.st_size):
        raise ValueError('Collection member changed while reading: ' + str(path))
    return body, current


def restore_mode(path, body, mode, fs, *, created=False):
    """Restore fresh-file modes or missing execute bits on verified received bytes."""
    if os.name == 'nt' or (not created and not mode & 0o111):
        return False
    current, before = read_original(path, fs)
    if current != body:
        raise ValueError('Preserved differing collection member: ' + str(path))
    wanted = mode if created else stat.S_IMODE(before.st_mode) | (mode & 0o111)
    changed = wanted != stat.S_IMODE(before.st_mode)
    if changed:
        fd = fs.open_file(path, os.O_RDONLY)
        try:
            if identity(fs.fd_stat(fd)) != identity(before):
                raise ValueError('Collection member changed before mode recovery: ' + str(path))
            os.fchmod(fd, wanted)
            os.fsync(fd)
        finally:
            os.close(fd)
        current, _ = read_original(path, fs)
        if current != body:
            raise ValueError('Collection member changed during mode recovery: ' + str(path))
    if mode & 0o111 and not os.access(path, os.X_OK):
        raise ValueError('The received opening file cannot be executed: ' + str(path))
    return changed


def apply(collection: Path, source: Path):
    """Preflight the whole component and retain all Workspace/data selections."""
    root, source = collection.expanduser().resolve(strict=True), source.resolve(strict=True)
    if not (root / 'application').is_dir() or not (root / 'STUDIES.json').is_file():
        raise ValueError('Choose the complete existing collection, not an application-only checkout')
    sys.path.insert(0, str(root / 'application'))
    from model import portable_fs as fs
    root, source = fs.native_path(root), fs.native_path(source)
    content, _ = read_original(source / 'OPENING_COMPONENT.json', fs)
    manifest = json.loads(content)
    if (not isinstance(manifest, dict)
            or manifest.get('schema') != 'upstate.collection-opening-component/v1'
            or not isinstance(manifest.get('files'), list) or not manifest['files']):
        raise ValueError('Receive the complete opening component manifest')
    names = [row.get('path') for row in manifest['files'] if isinstance(row, dict)]
    if len(names) != len(manifest['files']):
        raise ValueError('Opening component contains an invalid file record')
    fs.validate_members(names, portable=True)
    if len(set(names)) != len(names) or any('/' in name for name in names):
        raise ValueError('Opening component must contain distinct root files only')

    updated, restored, reused = [], [], []
    with fs.locked(root / '.collection-opening.lock'):
        plan = []
        for row in manifest['files']:
            name = row['path']
            incoming, destination = source / name, root / name
            body, _ = read_original(incoming, fs)
            expected = hashlib.sha256(body).hexdigest()
            if (expected != row.get('sha256') or type(row.get('bytes')) is not int
                    or len(body) != row['bytes']):
                raise ValueError('Receive the complete opening source file: ' + name)
            mode = int(row['mode'], 8)
            if mode < 0 or mode > 0o777:
                raise ValueError('Opening file mode must contain ordinary permission bits: ' + name)
            previous, _ = read_original(destination, fs, missing=True)
            allowed = row['predecessor_sha256']
            if not isinstance(allowed, list):
                raise ValueError('Opening predecessor selection must be a list: ' + name)
            if (previous is not None and previous != body
                    and hashlib.sha256(previous).hexdigest() not in allowed):
                raise ValueError('Preserved concurrent collection edits in ' + name
                                 + '; compose this current file before applying')
            plan.append((name, destination, body, mode, previous))
        # Check every source and predecessor before changing any file or mode.
        # Interrupted application can resume because current bodies are accepted.
        for name, destination, body, mode, previous in plan:
            current, _ = read_original(destination, fs, missing=True)
            if current != previous:
                raise ValueError('Preserved a concurrent collection edit: ' + name)
            if previous == body:
                reused.append(name)
            else:
                temporary = fs.native_path(root / ('.' + name + '.' + uuid.uuid4().hex))
                try:
                    fd = fs.open_file(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
                    with os.fdopen(fd, 'wb') as stream:
                        stream.write(body)
                        stream.flush()
                        if os.name != 'nt':
                            os.fchmod(stream.fileno(), mode)
                        os.fsync(stream.fileno())
                    # Close the writable handle before native publication.
                    current, _ = read_original(destination, fs, missing=True)
                    if current != previous:
                        raise ValueError('Preserved a concurrent collection edit: ' + name)
                    if previous is None:
                        try:
                            fs.publish_file(temporary, destination)
                        except FileExistsError:
                            current, _ = read_original(destination, fs)
                            if current != body:
                                raise ValueError('Preserved a concurrent collection edit: ' + name)
                    else:
                        fs.replace(temporary, destination)
                    updated.append(name)
                finally:
                    temporary.unlink(missing_ok=True)
            # Shared verified-copy publication and Windows-to-Mac ZIP movement
            # may lose modes even when every source byte already matches.
            if restore_mode(destination, body, mode, fs, created=previous != body):
                restored.append(name)
        fs.sync_directory(root)
    return {'component': manifest['component'], 'updated': updated,
            'restored_modes': restored, 'reused': reused}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('collection', type=Path)
    args = parser.parse_args()
    print(json.dumps(apply(args.collection, Path(__file__).resolve().parent), sort_keys=True))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
