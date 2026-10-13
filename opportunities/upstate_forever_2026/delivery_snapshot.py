"""Capture only declared delivery files, retaining exact bytes and portable paths.

No GIS parsers, directory discovery, source modification or network access.
"""
from __future__ import annotations

import errno
import hashlib
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import stat
import sys

# Explicit source budgets, independent of scenario count. Callers can select
# larger actual jobs through the same API/CLI; package metadata never relaxes
# the verifier's caller-selected policy.
MAX_REFERENCES = None
MAX_FILE_BYTES = None
MAX_TOTAL_BYTES = None
MAX_MANIFEST_BYTES = 16 * 1024 ** 2
MAX_INDEX_BYTES = 64 * 1024 ** 2
CHUNK_BYTES = 1024 ** 2

DEFAULT_LIMITS = {
    'max_references': MAX_REFERENCES,
    'max_file_bytes': MAX_FILE_BYTES,
    'max_total_bytes': MAX_TOTAL_BYTES,
    'max_manifest_bytes': MAX_MANIFEST_BYTES,
    'max_index_bytes': MAX_INDEX_BYTES,
}


def capture_limits(overrides=None):
    """Return validated caller-selected positive integer source budgets."""
    if overrides is None:
        return dict(DEFAULT_LIMITS)
    require(isinstance(overrides, dict), 'Package limits must be an object')
    require(not set(overrides) - set(DEFAULT_LIMITS),
            'Unknown package limit: ' + ', '.join(sorted(str(k) for k in set(overrides) - set(DEFAULT_LIMITS))))
    result = {**DEFAULT_LIMITS, **overrides}
    for key, value in result.items():
        require((value is None and key in {'max_references', 'max_file_bytes', 'max_total_bytes'})
                or (type(value) is int and value > 0),
                key + ' must be a positive integer, or None for source count/byte budgets')
    return result


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fingerprint(index: dict) -> str:
    """Seal the same canonical metadata without a second full JSON byte copy."""
    payload = {key: value for key, value in index.items() if key != 'packageSha256'}
    encoder = json.JSONEncoder(ensure_ascii=False, sort_keys=True,
                               separators=(',', ':'), allow_nan=False)
    digest = hashlib.sha256()
    for chunk in encoder.iterencode(payload):
        digest.update(chunk.encode('utf-8'))
    return digest.hexdigest()


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


def _read_manifest(root: Path, name: str, expected_state, limits):
    maximum = limits['max_manifest_bytes']
    require(expected_state.st_size <= maximum,
            f'Manifest exceeds max_manifest_bytes={maximum}')
    descriptor = _open_regular(root, name, expected_state)
    with os.fdopen(descriptor, 'rb') as stream:
        raw = stream.read(maximum + 1)
        require(len(raw) <= maximum,
                f'Manifest exceeds max_manifest_bytes={maximum}')
        require(_signature(os.fstat(stream.fileno())) == _signature(expected_state),
                'Manifest changed during capture')
    _unchanged(root, name, expected_state)
    return raw


def _private_file(path: Path):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    return os.fdopen(descriptor, 'wb')


def _clone(source, sink):
    """Try an independent copy-on-write snapshot; stream on unsupported filesystems."""
    if not sys.platform.startswith('linux'):
        return False
    try:
        import fcntl
    except ImportError:
        return False
    try:
        fcntl.ioctl(sink.fileno(), 0x40049409, source.fileno())  # Linux FICLONE
        return True
    except OSError as error:
        unsupported = {errno.EXDEV, errno.EINVAL, errno.ENOTTY, errno.ENOSYS,
                       getattr(errno, 'EOPNOTSUPP', errno.ENOSYS),
                       getattr(errno, 'ENOTSUP', errno.ENOSYS)}
        if error.errno not in unsupported:
            raise
        sink.seek(0)
        sink.truncate(0)
        return False


def capture_delivery(manifest_path: Path, out_dir: Path,
                     references: list[dict], expected_manifest_bytes: bytes, *, limits=None) -> dict:
    """Create a private, new-only delivery snapshot; do not finalize a failed capture.

    Each reference has a role and canonical relative path; path=None records an
    undeclared required item. Existing output directories are never reused.
    On IO failure a partial directory remains for diagnosis, without a seal.
    """
    limits = capture_limits(limits)
    manifest_path = Path(manifest_path).absolute()
    require(not manifest_path.is_symlink(), 'Manifest cannot be a symlink')
    root = manifest_path.parent.resolve(strict=True)
    manifest_name = relative_path(manifest_path.name)
    state = _file_state(root, manifest_name)
    require(state is not None, 'Manifest file is missing')
    require(isinstance(expected_manifest_bytes, bytes), 'Expected manifest must be captured bytes')
    raw_manifest = _read_manifest(root, manifest_name, state, limits)
    require(raw_manifest == expected_manifest_bytes, 'Manifest changed since it was parsed')
    require(isinstance(references, list) and (limits['max_references'] is None
            or len(references) <= limits['max_references']),
            'Declared references exceed max_references=' + str(limits['max_references']))

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
        require(limits['max_file_bytes'] is None or info.st_size <= limits['max_file_bytes'],
                f"Declared file exceeds max_file_bytes={limits['max_file_bytes']}: {relative}")
        total += info.st_size
        require(limits['max_total_bytes'] is None or total <= limits['max_total_bytes'],
                'Declared delivery exceeds max_total_bytes=' + str(limits['max_total_bytes']))

    output_path = Path(out_dir).absolute()
    require(not output_path.is_symlink(), 'Output directory cannot be a symlink')
    destination = output_path.resolve()
    # Only declared inputs are read; an owned child output is safe when it
    # contains none of those inputs. This supports the native delivery/package
    # layout without discovering or recursively copying the output itself.
    require(destination != root and all(not (root / relative).is_relative_to(destination)
                                       for relative in roles_by_path),
            'Output directory overlaps a declared delivery input')
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    delivery = destination / 'delivery'
    delivery.mkdir(mode=0o700)
    artifacts = []
    storage = {'declared_bytes': total, 'reflink_bytes': 0, 'streamed_bytes': 0,
               'reflink_files': 0, 'streamed_files': 0}
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
            cloned = _clone(source, sink)
            while True:
                chunk = source.read(CHUNK_BYTES)
                if not chunk:
                    break
                copied += len(chunk)
                require(copied <= info.st_size, f'Source grew during capture: {relative}')
                if not cloned:
                    sink.write(chunk)
                digest.update(chunk)
            require(copied == info.st_size and _signature(os.fstat(source.fileno())) == _signature(info),
                    f'Source changed during capture: {relative}')
        _unchanged(root, relative, info)
        method = 'reflink' if cloned else 'streamed'
        storage[method + '_bytes'] += copied
        storage[method + '_files'] += 1
        artifacts.append({'roles': sorted(roles_by_path[relative]), 'path': 'delivery/' + relative,
                          'bytes': copied, 'sha256': digest.hexdigest()})

    # A source copied early must still have the same identity at completion.
    for relative, info in source_states.items():
        if info is None:
            require(_file_state(root, relative) is None, f'Missing source appeared during capture: {relative}')
        else:
            _unchanged(root, relative, info)
    require(_read_manifest(root, manifest_name, state, limits) == raw_manifest,
            'Manifest changed during capture')
    manifest_schema = json.loads(raw_manifest.decode('utf-8-sig')).get('schema')
    study = manifest_schema == 'commons.native-study-delivery/v1'
    index = {'schema': ('commons.native-study-package/v1' if study
                        else 'upstate-ec-sdc-2026/package-v1'),
             'manifestSchema': manifest_schema,
             'auditProfile': 'original-native-study-grid' if study else 'regional-rfp',
             'manifestPath': 'delivery/' + manifest_name,
             'artifacts': artifacts, 'missing': missing,
             'captureLimits': limits, 'declaredReferenceCount': len(references),
             'capturedSourceBytes': total, 'storage': storage}
    index['packageSha256'] = fingerprint(index)
    return index


def verify_capture(out_dir: Path, index: dict, *, limits=None) -> None:
    """Check catalogued bytes with caller budgets, never limits trusted from JSON."""
    limits = capture_limits(limits)
    require(isinstance(index, dict) and index.get('schema') in (
            'upstate-ec-sdc-2026/package-v1', 'commons.native-study-package/v1'),
            'Unsupported package index')
    require(index.get('packageSha256') == fingerprint(index), 'Package index fingerprint differs')
    artifacts = index.get('artifacts')
    require(isinstance(artifacts, list) and artifacts, 'Package index has no captured artifacts')
    require(limits['max_references'] is None or len(artifacts) <= limits['max_references'] + 2,
            'Captured artifact count exceeds the selected reference budget')
    if 'declaredReferenceCount' in index:
        count = index['declaredReferenceCount']
        require(type(count) is int and count >= 0 and
                (limits['max_references'] is None or count <= limits['max_references']),
                'Declared reference count exceeds the selected reference budget')
    manifest = relative_path(index.get('manifestPath'))
    root = Path(out_dir).resolve(strict=True)
    seen = set()
    total = 0
    for artifact in artifacts:
        require(isinstance(artifact, dict), 'Invalid artifact entry')
        relative = relative_path(artifact.get('path'))
        require(relative.casefold() not in seen, 'Duplicate artifact path in package index')
        seen.add(relative.casefold())
        size = artifact.get('bytes')
        digest = artifact.get('sha256')
        require(type(size) is int and size >= 0 and
                (limits['max_file_bytes'] is None or size <= limits['max_file_bytes']) and
                isinstance(digest, str) and len(digest) == 64 and all(c in '0123456789abcdef' for c in digest),
                f'Invalid artifact size or digest: {relative}')
        if relative == manifest:
            require(size <= limits['max_manifest_bytes'],
                    'Captured manifest exceeds max_manifest_bytes=' +
                    str(limits['max_manifest_bytes']))
        total += size
        require(limits['max_total_bytes'] is None or total <= limits['max_total_bytes'],
                'Captured delivery exceeds max_total_bytes=' + str(limits['max_total_bytes']))
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
    require(any(artifact['path'] == manifest for artifact in artifacts),
            'Manifest is not included in the captured artifacts')
