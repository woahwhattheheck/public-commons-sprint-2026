"""Capture only declared delivery files, retaining exact bytes and portable paths.

No GIS parsers, directory discovery, source modification or network access.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import stat

MAX_REFERENCES = 256
MAX_FILE_BYTES = 2 * 1024 ** 3
MAX_TOTAL_BYTES = 8 * 1024 ** 3
MAX_MANIFEST_BYTES = 1024 ** 2
CHUNK_BYTES = 1024 ** 2


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fingerprint(index: dict) -> str:
    """Seal serializable index metadata, excluding its own digest."""
    payload = {key: value for key, value in index.items() if key != 'packageSha256'}
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                     separators=(',', ':'), allow_nan=False).encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


def relative_path(value: str) -> str:
    require(isinstance(value, str) and value and '\x00' not in value and '\\' not in value,
            'Declared file paths must be nonempty relative paths using forward slashes')
    path = PurePosixPath(value)
    require(not path.is_absolute() and not PureWindowsPath(value).drive,
            'Absolute or drive-relative file paths are not portable')
    require(all(part not in ('', '.', '..') for part in value.split('/')) and str(path) == value,
            'Declared paths cannot contain empty, dot or traversal components')
    return value


def _signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def _file_state(root: Path, relative: str):
    """Reject symlinks and special files anywhere below the selected root."""
    current = root
    parts = PurePosixPath(relative).parts
    for position, part in enumerate(parts):
        current = current / part
        try:
            info = current.lstat()
        except FileNotFoundError:
            return None
        require(not stat.S_ISLNK(info.st_mode), f'Symlink is not a delivery file: {relative}')
        if position < len(parts) - 1:
            require(stat.S_ISDIR(info.st_mode), f'Non-directory component in declared path: {relative}')
        else:
            require(stat.S_ISREG(info.st_mode), f'Delivery input must be a regular file: {relative}')
    return info


def _open_regular(root: Path, relative: str, expected):
    current = _file_state(root, relative)
    require(current is not None and _signature(current) == _signature(expected),
            f'Source changed before capture: {relative}')
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    descriptor = os.open(root / relative, flags)
    try:
        opened = os.fstat(descriptor)
        require(stat.S_ISREG(opened.st_mode) and _signature(opened) == _signature(expected),
                f'Source changed while opening: {relative}')
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _unchanged(root: Path, relative: str, expected):
    current = _file_state(root, relative)
    require(current is not None and _signature(current) == _signature(expected),
            f'Source changed during capture: {relative}')


def _read_manifest(root: Path, name: str, expected_state):
    require(expected_state.st_size <= MAX_MANIFEST_BYTES, 'Manifest exceeds 1 MiB')
    descriptor = _open_regular(root, name, expected_state)
    with os.fdopen(descriptor, 'rb') as stream:
        raw = stream.read(MAX_MANIFEST_BYTES + 1)
        require(len(raw) <= MAX_MANIFEST_BYTES, 'Manifest exceeds 1 MiB')
        require(_signature(os.fstat(stream.fileno())) == _signature(expected_state),
                'Manifest changed during capture')
    _unchanged(root, name, expected_state)
    return raw


def _private_file(path: Path):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    return os.fdopen(descriptor, 'wb')


def capture_delivery(manifest_path: Path, out_dir: Path,
                     references: list[dict], expected_manifest_bytes: bytes) -> dict:
    """Create a private, new-only delivery snapshot; do not finalize a failed capture.

    Each reference has a role and canonical relative path; path=None records an
    undeclared required item. Existing output directories are never reused.
    On IO failure a partial directory remains for diagnosis, without a seal.
    """
    manifest_path = Path(manifest_path).absolute()
    require(not manifest_path.is_symlink(), 'Manifest cannot be a symlink')
    root = manifest_path.parent.resolve(strict=True)
    manifest_name = relative_path(manifest_path.name)
    state = _file_state(root, manifest_name)
    require(state is not None, 'Manifest file is missing')
    require(isinstance(expected_manifest_bytes, bytes), 'Expected manifest must be captured bytes')
    raw_manifest = _read_manifest(root, manifest_name, state)
    require(raw_manifest == expected_manifest_bytes, 'Manifest changed since it was parsed')
    require(isinstance(references, list) and len(references) <= MAX_REFERENCES,
            'A package may declare at most 256 file references')

    roles_by_path = {manifest_name: {'delivery-manifest'}}
    missing = []
    for reference in references:
        require(isinstance(reference, dict), 'File reference must be an object')
        role = reference.get('role')
        require(isinstance(role, str) and role.strip() and '\x00' not in role,
                'File reference needs a nonempty role')
        value = reference.get('path')
        if value is None:
            missing.append({'roles': [role], 'path': None, 'reason': 'Required file was not declared'})
            continue
        relative = relative_path(value)
        roles_by_path.setdefault(relative, set()).add(role)

    # Reject ambiguous names on case-insensitive recipients, even on Linux.
    portable_names = {}
    for relative in roles_by_path:
        key = relative.casefold()
        require(key not in portable_names or portable_names[key] == relative,
                'Declared delivery paths collide on case-insensitive filesystems')
        portable_names[key] = relative
    for key in portable_names:
        parts = key.split('/')
        require(not any('/'.join(parts[:position]) in portable_names for position in range(1, len(parts))),
                'Declared file paths collide with a directory on case-insensitive filesystems')
    source_states = {}
    total = 0
    for relative, roles in roles_by_path.items():
        info = state if relative == manifest_name else _file_state(root, relative)
        source_states[relative] = info
        if info is None:
            missing.append({'roles': sorted(roles), 'path': 'delivery/' + relative,
                            'reason': 'Declared source file is missing'})
            continue
        require(info.st_size <= MAX_FILE_BYTES, f'Declared file exceeds 2 GiB: {relative}')
        total += info.st_size
        require(total <= MAX_TOTAL_BYTES, 'Declared delivery exceeds 8 GiB')

    output_path = Path(out_dir).absolute()
    require(not output_path.is_symlink(), 'Output directory cannot be a symlink')
    destination = output_path.resolve()
    require(not destination.is_relative_to(root), 'Output directory must be outside the source tree')
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    delivery = destination / 'delivery'
    delivery.mkdir(mode=0o700)
    artifacts = []
    for relative in sorted(roles_by_path):
        info = source_states[relative]
        if info is None:
            continue
        target = delivery / relative
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        digest = hashlib.sha256()
        copied = 0
        descriptor = _open_regular(root, relative, info)
        with os.fdopen(descriptor, 'rb') as source, _private_file(target) as sink:
            while True:
                chunk = source.read(CHUNK_BYTES)
                if not chunk:
                    break
                copied += len(chunk)
                require(copied <= info.st_size and copied <= MAX_FILE_BYTES,
                        f'Source grew during capture: {relative}')
                sink.write(chunk)
                digest.update(chunk)
            require(copied == info.st_size and _signature(os.fstat(source.fileno())) == _signature(info),
                    f'Source changed during capture: {relative}')
        _unchanged(root, relative, info)
        artifacts.append({'roles': sorted(roles_by_path[relative]), 'path': 'delivery/' + relative,
                          'bytes': copied, 'sha256': digest.hexdigest()})

    # A source copied early must still have the same identity at completion.
    for relative, info in source_states.items():
        if info is None:
            require(_file_state(root, relative) is None, f'Missing source appeared during capture: {relative}')
        else:
            _unchanged(root, relative, info)
    require(_read_manifest(root, manifest_name, state) == raw_manifest,
            'Manifest changed during capture')
    index = {'schema': 'upstate-ec-sdc-2026/package-v1', 'manifestPath': 'delivery/' + manifest_name,
             'artifacts': artifacts, 'missing': missing}
    index['packageSha256'] = fingerprint(index)
    return index


def verify_capture(out_dir: Path, index: dict) -> None:
    """Check only catalogued bytes, including audit.json appended by the CLI."""
    require(isinstance(index, dict) and index.get('schema') == 'upstate-ec-sdc-2026/package-v1',
            'Unsupported package index')
    require(index.get('packageSha256') == fingerprint(index), 'Package index fingerprint differs')
    artifacts = index.get('artifacts')
    require(isinstance(artifacts, list) and artifacts, 'Package index has no captured artifacts')
    root = Path(out_dir).resolve(strict=True)
    seen = set()
    for artifact in artifacts:
        require(isinstance(artifact, dict), 'Invalid artifact entry')
        relative = relative_path(artifact.get('path'))
        require(relative.casefold() not in seen, 'Duplicate artifact path in package index')
        seen.add(relative.casefold())
        size = artifact.get('bytes')
        digest = artifact.get('sha256')
        require(type(size) is int and 0 <= size <= MAX_FILE_BYTES and
                isinstance(digest, str) and len(digest) == 64 and all(c in '0123456789abcdef' for c in digest),
                f'Invalid artifact size or digest: {relative}')
        info = _file_state(root, relative)
        require(info is not None and info.st_size == size, f'Captured file missing or size changed: {relative}')
        descriptor = _open_regular(root, relative, info)
        actual, read_bytes = hashlib.sha256(), 0
        with os.fdopen(descriptor, 'rb') as stream:
            while True:
                chunk = stream.read(CHUNK_BYTES)
                if not chunk:
                    break
                read_bytes += len(chunk)
                require(read_bytes <= size, f'Captured file grew while reading: {relative}')
                actual.update(chunk)
            require(_signature(os.fstat(stream.fileno())) == _signature(info),
                    f'Captured file changed while reading: {relative}')
        _unchanged(root, relative, info)
        require(read_bytes == size and actual.hexdigest() == digest, f'Captured bytes differ: {relative}')
    manifest = relative_path(index.get('manifestPath'))
    require(any(artifact['path'] == manifest for artifact in artifacts),
            'Manifest is not included in the captured artifacts')
