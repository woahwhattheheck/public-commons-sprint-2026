"""Crash-safe local experiment storage. Copyright 2026 TokenJunkieLabs."""
from __future__ import annotations
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from .. import portable_fs as _fs


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value):
        raise ValueError('Use a complete retained experiment or run ID')
    return value


def read(path):
    def invalid(value):
        raise ValueError('Nonfinite JSON value: ' + value)
    with os.fdopen(_fs.open_file(_fs.native_path(path), os.O_RDONLY),
                   'r', encoding='utf-8') as stream:
        return json.load(stream, parse_constant=invalid)


def atomic(path, value, *, immutable=False):
    path = _fs.native_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    body = canonical(value) + b'\n'
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.pending-', delete=False) as f:
            pending = Path(f.name)
            f.write(body)
            f.flush()
            os.fsync(f.fileno())
        if immutable:
            try:
                _fs.publish_file(pending, path)
            except FileExistsError:
                with os.fdopen(_fs.open_file(path, os.O_RDONLY), 'rb') as current:
                    if current.read() != body:
                        raise ValueError('Immutable experiment item changed: ' + path.name)
        else:
            _fs.replace(pending, path)
        _fs.sync_directory(path.parent)
    finally:
        if pending:
            pending.unlink(missing_ok=True)


@contextlib.contextmanager
def held(path, *, blocking=False):
    with _fs.locked(path, blocking=blocking):
        yield


def fingerprint(path):
    path = _fs.native_path(path)
    h = hashlib.sha256()
    with os.fdopen(_fs.open_file(path, os.O_RDONLY), 'rb') as f:
        before = _fs.fd_stat(f.fileno())
        for b in iter(lambda: f.read(1024*1024), b''):
            h.update(b)
        after = _fs.fd_stat(f.fileno())
    fields = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if fields(before) != fields(after):
        raise ValueError('Source changed while reading: ' + path.name)
    return {'bytes': after.st_size, 'sha256': h.hexdigest()}


def member(root, name):
    root = _fs.native_path(root).resolve()
    _fs.relative_name(name)
    path = (root / name).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError('Project member is outside its workspace')
    return path


def verify(root, item):
    path = member(root, item['path'])
    actual = fingerprint(path)
    if any(actual[k] != item[k] for k in actual):
        raise ValueError('Retained result changed: ' + item['path'])
    return path


def native_provenance(directory, analysis, descriptor):
    """Read an original runtime report input bound to this exact physical result."""
    if descriptor is None:
        return None
    value = read(verify(directory, descriptor))
    selected = analysis['selection']
    if (value.get('schema') != 'upstate.ensemble-native-provenance/v1'
            or value.get('ensemble_id') != analysis['id']
            or value.get('selection_sha256') != digest(selected)
            or value.get('grid') != selected['grid']
            or value.get('members') != selected['members']
            or value.get('source_references_sha256') != digest(selected['source_references'])):
        raise ValueError('Native provenance belongs to another original ensemble selection')
    sources = selected['source_references']
    if not isinstance(sources, dict):
        raise ValueError('Native provenance requires original Workspace source references')
    models = [name for name, pollutants in (
        ('ndr', ('nitrogen_export', 'phosphorus_export')),
        ('sdr', ('sediment_export',)))
        if set(selected['pollutants']).intersection(pollutants)]
    cohort, records = value.get('cohort'), value.get('run_records')
    if not isinstance(cohort, dict) or not isinstance(records, dict):
        raise ValueError('Retain the original native version cohort and runtime records')
    by_run = cohort.get('runs')
    if not isinstance(by_run, dict) or cohort.get('models') != models:
        raise ValueError('Native provenance differs from the selected output models')
    versions = cohort.get('versions')
    bound = sources.get('native_versions', {name: sources.get('invest_version') for name in models})
    if (not isinstance(versions, dict) or set(versions) != set(models)
            or versions != bound or any(not isinstance(v, str) or not v for v in versions.values())):
        raise ValueError('Native provenance differs from the result-producing model versions')
    expected = {}
    for member in selected['members']:
        for side, scenario in (
                ('baseline', sources['baseline_scenario']['id']),
                ('alternative', member['scenario_id'])):
            key = member[side + '_run_id']
            binding = (sources['grid_id'], member['profile_id'], scenario)
            if key in expected and expected[key] != binding:
                raise ValueError('A retained native run has conflicting paired selections')
            expected[key] = binding
    if set(records) != set(expected) or set(by_run) != set(expected):
        raise ValueError('Native provenance does not contain the exact selected run roster')
    for key, binding in expected.items():
        record, resolved = records[key], by_run[key]
        if not isinstance(record, dict) or not isinstance(resolved, dict):
            raise ValueError('Retain complete original native run provenance')
        choice = record.get('selection')
        if (record.get('id') != key or not isinstance(choice, dict)
                or tuple(choice.get(name) for name in ('grid_id', 'profile_id', 'scenario_id')) != binding
                or set(resolved) != set(models)):
            raise ValueError('Native provenance changes an original run binding')
        stages = record.get('stages')
        if not isinstance(stages, dict) or set(stages) != set(models):
            raise ValueError('Retain each selected model stage in native provenance')
        for model in models:
            info = resolved[model]
            if (not isinstance(info, dict) or info.get('model') != model
                    or info.get('comparison_version') != versions[model]):
                raise ValueError('Paired native execution versions differ for ' + model.upper())
    return value
