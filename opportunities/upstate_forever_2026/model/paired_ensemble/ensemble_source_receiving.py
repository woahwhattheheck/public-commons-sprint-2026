"""Receive and import the existing complete paired-report source ZIP.

This is the inverse of ensemble_report_source.export_source, not a new archive
format. Transport uses only the standard library and the shared native filesystem
layer. Scientific source, report, member and producing-model identities are kept.
Copyright 2026 TokenJunkieLabs.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import zipfile
import zlib

from .. import portable_fs as _fs
from .ensemble_report_source import REPORT_SCHEMA, SCHEMA, SOURCE_ID, inspect
from .ensemble_store import digest, fingerprint, held, identifier, read

RECORD = 'report-source-record.json'
_CONTROL = {'intent.json', 'sources.json', 'report-source.json'}
_REQUIRED = _CONTROL | {'science-summary.json', 'original-inventory.json'}
_BLOCK = 1024 * 1024


def _descriptors(rows):
    if not isinstance(rows, list):
        raise ValueError('Retain the complete original source file inventory')
    result = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('Each source member needs its original size and checksum')
        name = _fs.relative_name(row.get('path'), windows=True)
        if name in result or type(row.get('bytes')) is not int or row['bytes'] < 0:
            raise ValueError('Duplicate or invalid source member: ' + name)
        result[name] = {'bytes': row['bytes'], 'sha256': identifier(row.get('sha256'))}
    _fs.validate_members(result, portable=True)
    return result


def _record_members(record):
    if not isinstance(record, dict) or not isinstance(record.get('identity'), dict):
        raise ValueError('Choose a complete original paired-report source')
    identity = record['identity']
    if (record.get('schema') != SCHEMA or record.get('state') != 'complete'
            or record.get('source_id') != SOURCE_ID
            or record.get('id') != digest(identity)
            or record.get('ensemble_id') != identity.get('ensemble_id')
            or record.get('record_sha256') != digest({
                name: value for name, value in record.items() if name != 'record_sha256'})):
        raise ValueError('The original paired-report source identity changed')
    identifier(record['ensemble_id'])
    members = _descriptors(record.get('files'))
    if RECORD in members or not _REQUIRED.issubset(members):
        raise ValueError('Retain the source recipe, manifest and scientific inventories')
    _fs.validate_members([RECORD, *members], portable=True)
    return members


def _source_entry(root, record, members):
    """Bind the original importer recipe to the already-verified full inventory."""
    manifest = read(root / 'sources.json')
    entries = manifest.get('entries') if isinstance(manifest, dict) else None
    if (not isinstance(manifest, dict) or manifest.get('schema') != 'upstate.sources/v1'
            or not isinstance(entries, list) or len(entries) != 1
            or not isinstance(entries[0], dict)):
        raise ValueError('Retain the original single paired scientific source manifest')
    entry = entries[0]
    if (entry.get('id') != SOURCE_ID or entry.get('kind') != 'document'
            or entry.get('path') != 'report-source.json'
            or entry.get('sha256') != members['report-source.json']['sha256']):
        raise ValueError('The importer manifest differs from the original report source')
    companions = _descriptors(entry.get('companions'))
    expected = {name: item for name, item in members.items() if name not in _CONTROL}
    recipe = read(root / 'report-source.json')
    if (companions != expected or not isinstance(recipe, dict)
            or recipe.get('schema') != REPORT_SCHEMA
            or recipe.get('ensemble_id') != record['ensemble_id']
            or _descriptors(recipe.get('inputs')) != expected):
        raise ValueError('The scientific recipe must retain every original companion')
    return entry, companions


def _unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('Duplicate field in the original source record: ' + key)
        value[key] = item
    return value


def _finite_json(value):
    raise ValueError('Nonfinite value in the original source record: ' + value)


def _archive_members(archive, max_bytes):
    infos = archive.infolist()
    names = [info.filename for info in infos]
    if len(set(names)) != len(names):
        raise ValueError('Duplicate paired-report source archive member')
    _fs.validate_members(names, portable=True)
    by_name = {}
    for info in infos:
        if (info.is_dir() or info.orig_filename != info.filename or info.flag_bits & 1
                or stat.S_IFMT(info.external_attr >> 16) not in (0, stat.S_IFREG)):
            raise ValueError('Receive original unencrypted regular source files only')
        by_name[info.filename] = info
    if RECORD not in by_name:
        raise ValueError('Choose a paired-report source ZIP, not an ensemble-result ZIP')
    if by_name[RECORD].file_size > 64 * 1024**2:
        raise ValueError('Source record exceeds the 64 MiB metadata reader capacity')
    raw_record = archive.read(RECORD)
    record = json.loads(raw_record, object_pairs_hook=_unique_object,
                        parse_constant=_finite_json)
    members = _record_members(record)
    members[RECORD] = {'bytes': len(raw_record),
                       'sha256': hashlib.sha256(raw_record).hexdigest()}
    if set(members) != set(by_name):
        raise ValueError('Archive files differ from the complete original source inventory')
    size = 0
    for name, expected in members.items():
        if by_name[name].file_size != expected['bytes']:
            raise ValueError('Original source member length differs: ' + name)
        size += expected['bytes']
    if max_bytes is not None and size > max_bytes:
        raise ValueError('Source exceeds the explicitly selected receiving disk allowance')
    return record, members, size


def receive_source(source, destination, *, max_bytes=None):
    """Publish a complete independently movable source into a NEW directory.

    A differing or matching existing destination is preserved. Inspect it or
    select another destination rather than merging trees or overwriting files.
    The source ZIP and every declared original member are unchanged.
    """
    if max_bytes is not None and (type(max_bytes) is not int or max_bytes < 0):
        raise ValueError('The receiving disk allowance must be a nonnegative byte count')
    source = _fs.native_path(source).resolve(strict=True)
    displayed = Path(destination).absolute()
    destination = _fs.native_path(displayed)
    if destination.exists() or destination.is_symlink():
        raise FileExistsError('Receive into a new directory; preserve the existing source')
    destination.parent.mkdir(parents=True, exist_ok=True)
    lock = destination.parent / ('.' + destination.name + '.source-receiving.lock')
    with held(lock, blocking=True):
        if destination.exists() or destination.is_symlink():
            raise FileExistsError('Source receiving destination already exists')
        original = fingerprint(source)
        staging = _fs.native_path(tempfile.mkdtemp(
            dir=destination.parent, prefix='.paired-source-receive-'))
        try:
            with os.fdopen(_fs.open_file(source, os.O_RDONLY), 'rb') as stream:
                with zipfile.ZipFile(stream, 'r', allowZip64=True) as archive:
                    record, members, size = _archive_members(archive, max_bytes)
                    if shutil.disk_usage(staging).free < size:
                        raise OSError('Insufficient free disk for the complete report source')
                    for name, expected in sorted(members.items()):
                        count, checksum = 0, hashlib.sha256()
                        with _fs.parent_directory(staging, name, create=True) as (parent, leaf):
                            descriptor = parent.open(leaf, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
                            with os.fdopen(descriptor, 'wb') as out, archive.open(name) as incoming:
                                for chunk in iter(lambda: incoming.read(_BLOCK), b''):
                                    count += len(chunk)
                                    if count > expected['bytes']:
                                        raise ValueError('Source expands beyond its declared bytes: ' + name)
                                    checksum.update(chunk)
                                    out.write(chunk)
                                out.flush()
                                os.fsync(out.fileno())
                            if count != expected['bytes'] or checksum.hexdigest() != expected['sha256']:
                                raise ValueError('Original report source member differs: ' + name)
                            parent.sync()
            checked = inspect(staging)
            if checked != record:
                raise ValueError('Source record changed during receiving')
            _source_entry(staging, checked, _record_members(checked))
            if fingerprint(source) != original:
                raise ValueError('Source archive changed during receiving')
            if destination.exists() or destination.is_symlink():
                raise FileExistsError('Source destination changed during receiving')
            _fs.publish_directory(staging, destination)
            return {'schema': SCHEMA, 'state': 'complete', 'id': record['id'],
                    'ensemble_id': record['ensemble_id'], 'title': record['title'],
                    'directory': str(displayed),
                    'source_manifest': str(displayed / 'sources.json'),
                    'members': len(members), 'uncompressed_bytes': size,
                    'archive': original}
        except (zipfile.BadZipFile, EOFError, zlib.error) as error:
            raise ValueError('The paired-report source ZIP is incomplete or damaged') from error
        finally:
            if staging.exists():
                shutil.rmtree(staging)


def import_source(workspace, directory):
    """Use the original Workspace importer on a captured or independently received source.

    The receiving Workspace may differ from the producing Workspace. The report
    recipe and its original project/member/model identities remain unchanged;
    the returned source_choice selects the new local collection for composition.
    """
    root = _fs.native_path(directory).resolve(strict=True)
    record = inspect(root)
    members = _record_members(record)
    _, expected = _source_entry(root, record, members)
    collection = workspace.import_sources(root / 'sources.json')
    choice = {'source_collection_id': collection['id'], 'source_id': SOURCE_ID}
    body, entry = workspace.source_file(choice['source_collection_id'], SOURCE_ID)
    if fingerprint(body) != members['report-source.json']:
        raise ValueError('The original importer returned a different scientific recipe')
    rows = []
    for item in entry.get('companions', []):
        name = item.get('view_path')
        if name is None:
            name = item.get('filename')
        rows.append({'path': name, 'bytes': item.get('bytes'), 'sha256': item.get('sha256')})
    if _descriptors(rows) != expected:
        raise ValueError('The original importer changed the complete source companions')
    return {'schema': SCHEMA, 'state': 'complete', 'report_source_id': record['id'],
            'ensemble_id': record['ensemble_id'], 'title': record['title'],
            'project_id': workspace.project['id'],
            'original_project_id': record['identity'].get('workspace_id'),
            'source_choice': choice, 'source_count': 1,
            'companion_count': len(expected),
            'directory': str(Path(directory).absolute()), 'summary': record['summary']}
