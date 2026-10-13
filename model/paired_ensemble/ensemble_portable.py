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
from .ensemble_store import canonical, digest, fingerprint, held, read, verify

MANIFEST = 'ensemble-project.json'
SCHEMA = 'upstate.ensemble-result-project/v1'


def safe_name(name):
    if not isinstance(name, str) or '\\' in name or '\x00' in name:
        raise ValueError('Invalid portable member name')
    path = PurePosixPath(name)
    if not path.parts or path.is_absolute() or '..' in path.parts or str(path) != name:
        raise ValueError('Portable members must use canonical relative names')
    return path


def export_project(directory, destination):
    directory = Path(directory).resolve(strict=True)
    destination = Path(destination).absolute()
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
        members = {}
        for descriptor in list(analysis['artifacts'].values()) + reports['files']:
            path = verify(directory, descriptor)
            members[descriptor['path']] = fingerprint(path)
        for name in ('analysis.json', 'reports.json'):
            members[name] = fingerprint(directory / name)
        for name in ('execution.json', 'execution-settings.json'):
            if (directory / name).is_file():
                members[name] = fingerprint(directory / name)
        manifest = {'schema': SCHEMA, 'ensemble_id': analysis['id'],
                    'title': analysis['selection']['title'], 'entrypoint': 'index.html',
                    'contents': 'Complete quantitative result rasters, source/profile/run identities, member totals and offline report',
                    'original_inputs': 'Retained by the original scientific Workspace; transfer with Workspace.backup',
                    'members': members}
        pending = None
        try:
            fd, name = tempfile.mkstemp(dir=destination.parent, prefix='.ensemble-', suffix='.zip')
            os.close(fd)
            pending = Path(name)
            with zipfile.ZipFile(pending, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                archive.writestr(MANIFEST, canonical(manifest) + b'\n')
                for name, expected in sorted(members.items()):
                    safe_name(name)
                    path = verify(directory, {**expected, 'path': name})
                    archive.write(path, name)
            with pending.open('rb') as body:
                os.fsync(body.fileno())
            # Exclusive publication: an existing result is never replaced.
            os.link(pending, destination)
            result = {'schema': SCHEMA, 'ensemble_id': analysis['id'],
                      'path': str(destination), **fingerprint(destination),
                      'members': len(members), 'uncompressed_bytes': sum(m['bytes'] for m in members.values())}
            return result
        finally:
            if pending is not None:
                pending.unlink(missing_ok=True)


def _manifest(archive, max_bytes):
    infos = archive.infolist()
    if len({info.filename for info in infos}) != len(infos):
        raise ValueError('Duplicate archive member')
    for info in infos:
        safe_name(info.filename)
        mode = info.external_attr >> 16
        if info.is_dir() or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
            raise ValueError('Only regular result files may be received')
        if info.flag_bits & 1:
            raise ValueError('Encrypted result members are not supported')
    info = archive.getinfo(MANIFEST)
    if info.file_size > 64*1024**2:
        raise ValueError('Portable manifest exceeds the 64 MiB metadata reader capacity')
    value = json.loads(archive.read(MANIFEST), parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite project JSON')))
    if value.get('schema') != SCHEMA or not isinstance(value.get('members'), dict):
        raise ValueError('Select an original ensemble result project')
    if set(value['members']) | {MANIFEST} != {info.filename for info in infos}:
        raise ValueError('Archive members differ from the complete declared project')
    size = 0
    for name, expected in value['members'].items():
        safe_name(name)
        if not isinstance(expected.get('bytes'), int) or expected['bytes'] < 0:
            raise ValueError('Invalid result member size')
        if archive.getinfo(name).file_size != expected['bytes']:
            raise ValueError('Result member length differs: ' + name)
        size += expected['bytes']
    if max_bytes is not None and size > max_bytes:
        raise ValueError('Project exceeds the explicitly selected receiving disk allowance')
    return value, size


def receive_project(source, destination, *, max_bytes=None):
    source = Path(source).resolve(strict=True)
    destination = Path(destination).absolute()
    if destination.exists() or destination.is_symlink():
        raise FileExistsError('Receive into a new directory; preserve any existing result project')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with held(destination.parent / ('.' + destination.name + '.receiving.lock'), blocking=True):
        if destination.exists() or destination.is_symlink():
            raise FileExistsError('Receiving destination already exists')
        original = fingerprint(source)
        staging = Path(tempfile.mkdtemp(dir=destination.parent, prefix='.ensemble-receive-'))
        try:
            with zipfile.ZipFile(source, 'r', allowZip64=True) as archive:
                manifest, size = _manifest(archive, max_bytes)
                if shutil.disk_usage(staging).free < size:
                    raise OSError('Insufficient free disk for the complete result project')
                for name, expected in manifest['members'].items():
                    target = staging.joinpath(*safe_name(name).parts)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    count = 0
                    checksum = hashlib.sha256()
                    with archive.open(name) as src, target.open('xb') as out:
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
                (staging / MANIFEST).write_bytes(canonical(manifest) + b'\n')
            analysis = read(staging / 'analysis.json')
            if analysis['state'] != 'complete' or analysis['id'] != manifest['ensemble_id'] or digest(analysis['selection']) != analysis['id']:
                raise ValueError('Received analysis identity differs')
            reports = read(staging / 'reports.json')
            if reports['ensemble_id'] != analysis['id']:
                raise ValueError('Received report belongs to another analysis')
            for artifact in list(analysis['artifacts'].values()) + reports['files']:
                if artifact['path'] not in manifest['members']:
                    raise ValueError('A complete quantitative/report artifact is missing')
                verify(staging, artifact)
            if fingerprint(source) != original:
                raise ValueError('Result archive changed during receiving')
            if destination.exists() or destination.is_symlink():
                raise FileExistsError('Receiving destination changed during transfer')
            os.rename(staging, destination)
            return {'schema': SCHEMA, 'ensemble_id': analysis['id'],
                    'directory': str(destination), 'entrypoint': str(destination / 'index.html'),
                    'members': len(manifest['members']), 'uncompressed_bytes': size,
                    'archive': original}
        finally:
            if staging.exists():
                shutil.rmtree(staging)
