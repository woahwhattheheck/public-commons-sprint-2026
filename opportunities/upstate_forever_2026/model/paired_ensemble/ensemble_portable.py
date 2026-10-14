"""Complete offline ensemble-result receiving, with no original source paths.

Copyright 2026 TokenJunkieLabs.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import zipfile
from .. import portable_fs as _fs
from .ensemble_store import (atomic, canonical, digest, fingerprint, held, read,
                             verify, native_provenance)

MANIFEST = 'ensemble-project.json'
SCHEMA = 'upstate.ensemble-result-project/v1'


def safe_name(name):
    return PurePosixPath(_fs.relative_name(name, windows=True))


def _write_member(archive, directory, name, expected):
    """Archive the verified original bytes, not a second unverified path read."""
    path = verify(directory, {**expected, 'path': name})
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = 0o100644 << 16
    count, checksum = 0, hashlib.sha256()
    with os.fdopen(_fs.open_file(path, os.O_RDONLY), 'rb') as incoming:
        with archive.open(info, 'w', force_zip64=True) as outgoing:
            for chunk in iter(lambda: incoming.read(1024 * 1024), b''):
                count += len(chunk)
                if count > expected['bytes']:
                    raise ValueError('Original result grew during export: ' + name)
                checksum.update(chunk)
                outgoing.write(chunk)
    if count != expected['bytes'] or checksum.hexdigest() != expected['sha256']:
        raise ValueError('Original result changed during export: ' + name)
    verify(directory, {**expected, 'path': name})


def export_project(directory, destination):
    directory = _fs.native_path(directory).resolve(strict=True)
    displayed_destination = Path(destination).absolute()
    destination = _fs.native_path(displayed_destination)
    if destination.exists() or destination.is_symlink():
        raise FileExistsError('Choose a new result archive destination')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with held(directory / '.analysis.lock', blocking=True), held(directory / '.report.lock', blocking=True):
        analysis = read(directory / 'analysis.json')
        if analysis['state'] != 'complete' or digest(analysis['selection']) != analysis['id']:
            raise ValueError('Export a complete original ensemble analysis')
        reports = read(directory / 'reports.json')
        if reports['ensemble_id'] != analysis['id']:
            raise ValueError('Report belongs to another ensemble')
        provenance = reports.get('native_provenance')
        if provenance is not None and provenance not in reports['files']:
            raise ValueError('The original runtime provenance is absent from the report inventory')
        native_provenance(directory, analysis, provenance)
        members = {}
        for descriptor in list(analysis['artifacts'].values()) + reports['files']:
            path = verify(directory, descriptor)
            members[descriptor['path']] = fingerprint(path)
        for name in ('analysis.json', 'reports.json'):
            members[name] = fingerprint(directory / name)
        for name in ('execution.json', 'execution-settings.json'):
            if (directory / name).is_file():
                members[name] = fingerprint(directory / name)
        if MANIFEST in members:
            raise ValueError('A result artifact occupies the portable manifest name')
        _fs.validate_members([MANIFEST, *members], portable=True)
        if 'index.html' not in members:
            raise ValueError('Retain the original report entrypoint in the result inventory')
        manifest = {'schema': SCHEMA, 'ensemble_id': analysis['id'],
                    'title': analysis['selection']['title'], 'entrypoint': 'index.html',
                    'contents': 'Complete quantitative result rasters, source/profile/run identities, member totals and offline report',
                    'original_inputs': 'Retained by the original scientific Workspace; transfer with Workspace.backup',
                    'members': members}
        pending = None
        try:
            fd, name = tempfile.mkstemp(dir=destination.parent, prefix='.ensemble-', suffix='.zip')
            pending = _fs.native_path(name)
            # Keep the completed archive on a writable handle for Windows fsync.
            with os.fdopen(fd, 'w+b') as output:
                with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                    archive.writestr(MANIFEST, canonical(manifest) + b'\n')
                    for name, expected in sorted(members.items()):
                        _write_member(archive, directory, name, expected)
                output.flush()
                os.fsync(output.fileno())
            # Same create-only publication on NTFS, APFS and no-hard-link media.
            _fs.publish_file(pending, destination)
            _fs.sync_directory(destination.parent)
            return {'schema': SCHEMA, 'ensemble_id': analysis['id'],
                    'path': str(displayed_destination), **fingerprint(destination),
                    'members': len(members), 'uncompressed_bytes': sum(m['bytes'] for m in members.values())}
        finally:
            if pending is not None:
                pending.unlink(missing_ok=True)


def _manifest(archive, max_bytes):
    infos = archive.infolist()
    if len({info.filename for info in infos}) != len(infos):
        raise ValueError('Duplicate archive member')
    _fs.validate_members([info.filename for info in infos], portable=True)
    for info in infos:
        safe_name(info.filename)
        if info.orig_filename != info.filename:
            raise ValueError('Archive member has a noncanonical original name')
        mode = info.external_attr >> 16
        if info.is_dir() or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
            raise ValueError('Only regular result files may be received')
        if info.flag_bits & 1:
            raise ValueError('Encrypted result members are not supported')
    info = archive.getinfo(MANIFEST)
    if info.file_size > 64*1024**2:
        raise ValueError('Portable manifest exceeds the 64 MiB metadata reader capacity')
    value = json.loads(archive.read(MANIFEST), parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite project JSON')))
    if not isinstance(value, dict) or value.get('schema') != SCHEMA or not isinstance(value.get('members'), dict):
        raise ValueError('Select an original ensemble result project')
    if MANIFEST in value['members']:
        raise ValueError('The portable manifest cannot declare itself as a result')
    if set(value['members']) | {MANIFEST} != {info.filename for info in infos}:
        raise ValueError('Archive members differ from the complete declared project')
    if value.get('entrypoint') != 'index.html' or 'index.html' not in value['members']:
        raise ValueError('Retain the original report entrypoint in the received result')
    size = 0
    for name, expected in value['members'].items():
        safe_name(name)
        if not isinstance(expected, dict) or type(expected.get('bytes')) is not int or expected['bytes'] < 0:
            raise ValueError('Invalid result member size')
        checksum = expected.get('sha256')
        if not isinstance(checksum, str) or len(checksum) != 64 or any(c not in '0123456789abcdef' for c in checksum):
            raise ValueError('Invalid original result checksum: ' + name)
        if archive.getinfo(name).file_size != expected['bytes']:
            raise ValueError('Result member length differs: ' + name)
        size += expected['bytes']
    if max_bytes is not None and size > max_bytes:
        raise ValueError('Project exceeds the explicitly selected receiving disk allowance')
    return value, size


def receive_project(source, destination, *, max_bytes=None):
    source = _fs.native_path(source).resolve(strict=True)
    displayed_destination = Path(destination).absolute()
    destination = _fs.native_path(displayed_destination)
    if destination.exists() or destination.is_symlink():
        raise FileExistsError('Receive into a new directory; preserve any existing result project')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with held(destination.parent / ('.' + destination.name + '.receiving.lock'), blocking=True):
        if destination.exists() or destination.is_symlink():
            raise FileExistsError('Receiving destination already exists')
        original = fingerprint(source)
        staging = _fs.native_path(tempfile.mkdtemp(dir=destination.parent, prefix='.ensemble-receive-'))
        try:
            with os.fdopen(_fs.open_file(source, os.O_RDONLY), 'rb') as incoming:
                with zipfile.ZipFile(incoming, 'r', allowZip64=True) as archive:
                    manifest, size = _manifest(archive, max_bytes)
                    if shutil.disk_usage(staging).free < size:
                        raise OSError('Insufficient free disk for the complete result project')
                    for name, expected in manifest['members'].items():
                        count, checksum = 0, hashlib.sha256()
                        with _fs.parent_directory(staging, name, create=True) as (parent, leaf):
                            descriptor = parent.open(leaf, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
                            with os.fdopen(descriptor, 'wb') as out, archive.open(name) as src:
                                for chunk in iter(lambda: src.read(1024*1024), b''):
                                    count += len(chunk)
                                    if count > expected['bytes']:
                                        raise ValueError('Result expands beyond its declared bytes')
                                    checksum.update(chunk)
                                    out.write(chunk)
                                out.flush()
                                os.fsync(out.fileno())
                            if count != expected['bytes'] or checksum.hexdigest() != expected['sha256']:
                                raise ValueError('Result member differs: ' + name)
                            parent.sync()
                    atomic(staging / MANIFEST, manifest, immutable=True)
            analysis = read(staging / 'analysis.json')
            if analysis['state'] != 'complete' or analysis['id'] != manifest['ensemble_id'] or digest(analysis['selection']) != analysis['id']:
                raise ValueError('Received analysis identity differs')
            reports = read(staging / 'reports.json')
            if reports['ensemble_id'] != analysis['id']:
                raise ValueError('Received report belongs to another analysis')
            provenance = reports.get('native_provenance')
            if provenance is not None and provenance not in reports['files']:
                raise ValueError('The received runtime provenance is absent from its report inventory')
            native_provenance(staging, analysis, provenance)
            for artifact in list(analysis['artifacts'].values()) + reports['files']:
                if artifact['path'] not in manifest['members']:
                    raise ValueError('A complete quantitative/report artifact is missing')
                verify(staging, artifact)
            if fingerprint(source) != original:
                raise ValueError('Result archive changed during receiving')
            if destination.exists() or destination.is_symlink():
                raise FileExistsError('Receiving destination changed during transfer')
            _fs.publish_directory(staging, destination)
            return {'schema': SCHEMA, 'ensemble_id': analysis['id'],
                    'directory': str(displayed_destination),
                    'entrypoint': str(displayed_destination / 'index.html'),
                    'members': len(manifest['members']), 'uncompressed_bytes': size,
                    'archive': original}
        finally:
            if staging.exists():
                shutil.rmtree(staging)
