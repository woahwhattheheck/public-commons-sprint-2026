#!/usr/bin/env python3
"""Exact incremental transport for complete Upper Savannah archive editions.

No scientific file is modified, and no native model is invoked. A delta plus its
exact retained base reconstructs the producer's original full ZIP byte for byte.
Only stdlib is required for transport; native inspect/restore remains authoritative.
"""
from __future__ import annotations
import argparse
from collections import Counter
import contextlib
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import zipfile

SCHEMA = 'upstate.archive-delta/v1'
JOURNAL = 'upstate.archive-delta-receiving/v1'
NATIVE = 'upstate.scientific-workspace-archive/v1'
CHUNK = 1024 * 1024
MAX_MANIFEST = 64 * CHUNK


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def integer(value, label, minimum=0):
    if type(value) is not int or value < minimum:
        raise ValueError(f'{label} must be an integer >= {minimum}')
    return value


def sha(value):
    if (not isinstance(value, str) or len(value) != 64
            or any(c not in '0123456789abcdef' for c in value)):
        raise ValueError('A complete lowercase SHA-256 identity is required')
    return value


def identity(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError('Select a retained regular file: ' + str(path))
    s = path.stat()
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def bytes_hash(stream, length, output=None):
    h = hashlib.sha256()
    remaining = length
    while remaining:
        block = stream.read(min(CHUNK, remaining))
        if not block:
            raise ValueError('A retained byte range ended early')
        h.update(block)
        if output is not None:
            output.write(block)
        remaining -= len(block)
    return h.hexdigest()


def file_hash(path):
    before = identity(path)
    with Path(path).open('rb') as source:
        result = bytes_hash(source, before[2])
    if identity(path) != before:
        raise ValueError('The source changed while it was read: ' + str(path))
    return result


def atomic_json(path, value):
    path = Path(path)
    fd, name = tempfile.mkstemp(prefix='.delta-write-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(canonical(value) + b'\n'); out.flush(); os.fsync(out.fileno())
        os.replace(name, path)
        fsync_dir(path.parent)
    finally:
        Path(name).unlink(missing_ok=True)


def fsync_dir(path):
    if os.name != 'nt':
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


@contextlib.contextmanager
def held(path):
    """Keep concurrent receivers from sharing a partial output or journal."""
    import fcntl
    with Path(path).open('a+b') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError('Another receiver owns this output; retain its operation') from error
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def native_module(application):
    application = Path(application).resolve(strict=True)
    if not (application / 'model/portable.py').is_file():
        raise ValueError('Select the original application containing model/portable.py')
    loaded = sys.modules.get('model.portable')
    if loaded is not None and Path(loaded.__file__).resolve().parent.parent != application:
        raise ValueError('Use a fresh process for a different archived application')
    sys.path.insert(0, str(application))
    from model import portable
    return portable


def describe(path):
    path = Path(path)
    before = identity(path)
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        names = [i.filename for i in infos]
        if len(names) != len(set(names)):
            raise ValueError('Original archive contains duplicate entries')
        info = archive.getinfo('ARCHIVE.json')
        if info.file_size > MAX_MANIFEST:
            raise ValueError('Native inventory exceeds the receiving metadata limit')
        manifest = json.loads(archive.read(info))
        if manifest.get('schema') != NATIVE:
            raise ValueError('Select a complete original scientific Workspace archive')
        members = manifest.get('members')
        if not isinstance(members, dict) or set(members) | {'ARCHIVE.json'} != set(names):
            raise ValueError('Archive and original member inventory differ')
        for item in infos:
            if item.flag_bits & 1 or item.is_dir():
                raise ValueError('Native archive must retain unencrypted regular members')
        offsets = sorted((i.header_offset, i.filename) for i in infos)
    spans = []
    if offsets[0][0]:
        spans.append((0, offsets[0][0], '@zip-prefix'))
    for n, (start, name) in enumerate(offsets):
        end = offsets[n + 1][0] if n + 1 < len(offsets) else before[2]
        if start < 0 or end <= start:
            raise ValueError('Original ZIP local-record offsets overlap')
        spans.append((start, end - start, name))
    with path.open('rb') as source:
        records = []
        for offset, length, name in spans:
            source.seek(offset)
            records.append({'offset': offset, 'bytes': length,
                            'sha256': bytes_hash(source, length), 'member': name})
    result = {'filename': path.name, 'bytes': before[2], 'sha256': file_hash(path),
              'project': manifest['project'], 'members': members, 'records': records}
    if identity(path) != before:
        raise ValueError('The original archive changed during indexing')
    return result


def changes(base, target):
    result = []
    for name in sorted(base.keys() | target.keys()):
        a, b = base.get(name), target.get(name)
        status = 'added' if a is None else 'removed' if b is None else 'unchanged' if a == b else 'changed'
        result.append({'path': name, 'status': status,
                       'before': a, 'after': b})
    return result


def create(base, target, output, *, application, progress=None):
    """Create a standalone transport ZIP from two frozen original native archives."""
    base, target, output = map(lambda p: Path(p).absolute(), (base, target, output))
    if output.exists() or output in (base, target):
        raise ValueError('Choose a new delta file outside both original archives')
    before = {p: identity(p) for p in (base, target)}
    start = time.monotonic()
    native = native_module(application)
    for path in (base, target):
        native.inspect_archive(path, verify=True)
    a, b = describe(base), describe(target)
    if a['project']['id'] != b['project']['id']:
        raise ValueError('Incremental editions must belong to the same original project')
    index = {}
    for record in a['records']:
        index.setdefault((record['sha256'], record['bytes']), record['offset'])
    instructions, payloads = [], {}
    reused = 0
    for record in b['records']:
        token = (record['sha256'], record['bytes'])
        instruction = dict(record)
        if token in index:
            instruction.update(source='base', source_offset=index[token]); reused += record['bytes']
        else:
            instruction.update(source='payload', payload='payload/' + record['sha256'])
            payloads.setdefault(record['sha256'], record)
        instructions.append(instruction)
    content = {'schema': SCHEMA, 'base': {k: a[k] for k in ('filename', 'bytes', 'sha256', 'project')},
               'target': {k: b[k] for k in ('filename', 'bytes', 'sha256', 'project')},
               'instructions': instructions, 'changes': changes(a['members'], b['members']),
               'summary': {'target_records': len(instructions), 'reused_bytes': reused,
                           'unique_payload_bytes': sum(r['bytes'] for r in payloads.values()),
                           'target_bytes': b['bytes'], 'member_status': dict(Counter(r['status'] for r in changes(a['members'], b['members'])))}}
    manifest = {**content, 'id': digest(canonical(content))}
    raw = canonical(manifest)
    if len(raw) > MAX_MANIFEST:
        raise ValueError('Delta metadata exceeds the receiving limit; use full original transport')
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.delta-package-', dir=output.parent); os.close(fd)
    try:
        with zipfile.ZipFile(tmp, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as package, target.open('rb') as source:
            package.writestr('DELTA.json', raw, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
            for key, record in payloads.items():
                source.seek(record['offset'])
                with package.open('payload/' + key, 'w', force_zip64=True) as sink:
                    if bytes_hash(source, record['bytes'], sink) != key:
                        raise ValueError('Original target changed during packaging')
            if progress:
                progress({'phase': 'packaged', **manifest['summary']})
        for path in before:
            if identity(path) != before[path]:
                raise ValueError('An original archive changed during packaging')
        with open(tmp, 'rb') as stream:
            os.fsync(stream.fileno())
        # Hard-link publication is atomic and does not replace a competing file.
        os.link(tmp, output); fsync_dir(output.parent)
    finally:
        Path(tmp).unlink(missing_ok=True)
    return {'id': manifest['id'], 'delta': str(output), 'bytes': output.stat().st_size,
            'sha256': file_hash(output), 'elapsed_seconds': time.monotonic() - start,
            **manifest['summary']}


def inspect(delta):
    """Validate complete transport recipe and its inventory without extracting paths."""
    with zipfile.ZipFile(delta) as z:
        infos = z.infolist()
        names = [i.filename for i in infos]
        if len(names) != len(set(names)) or 'DELTA.json' not in names:
            raise ValueError('Delta contains duplicate members or lacks DELTA.json')
        info = z.getinfo('DELTA.json')
        if info.file_size > MAX_MANIFEST:
            raise ValueError('Delta metadata exceeds the receiving limit')
        m = json.loads(z.read(info))
        if m.get('schema') != SCHEMA or m.get('id') != digest(canonical({k: v for k, v in m.items() if k != 'id'})):
            raise ValueError('Delta recipe identity differs')
        for which in ('base', 'target'):
            integer(m[which]['bytes'], which + ' length', 1); sha(m[which]['sha256'])
        if m['base']['project']['id'] != m['target']['project']['id']:
            raise ValueError('Delta project identities differ')
        cursor, payloads = 0, {}
        if not isinstance(m['instructions'], list) or not m['instructions']:
            raise ValueError('Delta needs a complete ordered byte recipe')
        for row in m['instructions']:
            size = integer(row['bytes'], 'record length', 1)
            if integer(row['offset'], 'target offset') != cursor:
                raise ValueError('Delta has gaps or overlaps')
            sha(row['sha256'])
            if row['source'] == 'base':
                begin = integer(row['source_offset'], 'base offset')
                if begin + size > m['base']['bytes']:
                    raise ValueError('Delta reads beyond its base')
            elif row['source'] == 'payload':
                name = 'payload/' + row['sha256']
                if row['payload'] != name:
                    raise ValueError('Unexpected payload path')
                if name in payloads and payloads[name] != size:
                    raise ValueError('Conflicting payload lengths')
                payloads[name] = size
            else:
                raise ValueError('Unknown byte source')
            cursor += size
        if cursor != m['target']['bytes'] or set(names) != {'DELTA.json'} | set(payloads):
            raise ValueError('Delta inventory does not reconstruct its whole target')
        for i in infos:
            if i.flag_bits & 1 or i.is_dir():
                raise ValueError('Delta must retain unencrypted regular members')
            allowed = (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) if i.filename == 'DELTA.json' else (zipfile.ZIP_STORED,)
            if i.compress_type not in allowed:
                raise ValueError('Delta payload records must be stored without recompression')
        for name, size in payloads.items():
            if z.getinfo(name).file_size != size:
                raise ValueError('Payload length differs')
    return m


def receive(base, delta, output, *, progress=None):
    """Reconstruct exactly, with durable progress and verified interrupted replay."""
    base, delta, output = map(lambda p: Path(p).absolute(), (base, delta, output))
    if output in (base, delta):
        raise ValueError('Output must be separate from retained inputs')
    m = inspect(delta)
    before = {p: identity(p) for p in (base, delta)}
    if before[base][2] != m['base']['bytes'] or file_hash(base) != m['base']['sha256']:
        raise ValueError('Select the exact retained base archive named in the delta')
    output.parent.mkdir(parents=True, exist_ok=True)
    work = output.with_name('.' + output.name + '.delta-partial')
    journal = output.with_name('.' + output.name + '.delta-progress.json')
    lock = output.with_name('.' + output.name + '.delta.lock')
    if any(p.is_symlink() for p in (output, work, journal, lock)):
        raise ValueError('Receiving paths must not be symbolic aliases')
    start = time.monotonic()
    with held(lock):
        if output.exists():
            if output.stat().st_size != m['target']['bytes'] or file_hash(output) != m['target']['sha256']:
                raise ValueError('Existing output differs; preserve it and choose a new destination')
            return {'path': str(output), 'sha256': m['target']['sha256'], 'bytes': m['target']['bytes'], 'reused_completed_output': True}
        state = {'schema': JOURNAL, 'id': m['id'], 'completed_records': 0, 'completed_bytes': 0}
        if journal.exists():
            old = json.loads(journal.read_bytes())
            if old.get('schema') != JOURNAL or old.get('id') != m['id']:
                raise ValueError('Retained partial output belongs to a different delivery')
            count = integer(old.get('completed_records'), 'completed record count')
            if count > len(m['instructions']):
                raise ValueError('Retained receiving cursor is invalid')
            state = old
        elif work.exists():
            raise ValueError('Unowned partial output exists; preserve it and choose a new destination')
        resumed = state['completed_records']
        mode = 'r+b' if work.exists() else 'x+b'
        with work.open(mode) as sink, base.open('rb') as source, zipfile.ZipFile(delta) as z:
            cursor = 0
            for row in m['instructions'][:resumed]:
                if bytes_hash(sink, row['bytes']) != row['sha256']:
                    raise ValueError('A committed partial record was edited; preserve it and choose a new destination')
                cursor += row['bytes']
            if cursor != state['completed_bytes']:
                raise ValueError('Retained receiving byte cursor differs')
            sink.truncate(cursor); sink.seek(cursor)
            atomic_json(journal, state)
            for n, row in enumerate(m['instructions'][resumed:], resumed + 1):
                if row['source'] == 'base':
                    source.seek(row['source_offset'])
                    actual = bytes_hash(source, row['bytes'], sink)
                else:
                    with z.open(row['payload']) as payload:
                        actual = bytes_hash(payload, row['bytes'], sink)
                if actual != row['sha256']:
                    raise ValueError('Retained source record differs: ' + row['member'])
                cursor += row['bytes']
                if n % 32 == 0 or n == len(m['instructions']):
                    sink.flush(); os.fsync(sink.fileno())
                    state.update(completed_records=n, completed_bytes=cursor)
                    atomic_json(journal, state)
                    if progress:
                        progress({'phase': 'receiving', **state, 'target_bytes': m['target']['bytes']})
            sink.flush(); os.fsync(sink.fileno())
        if file_hash(work) != m['target']['sha256']:
            raise ValueError('Reconstructed full archive differs from its original producer')
        for path in before:
            if identity(path) != before[path]:
                raise ValueError('An input changed during receiving')
        os.link(work, output); fsync_dir(output.parent)
        work.unlink(); journal.unlink(missing_ok=True)
        return {'path': str(output), 'sha256': m['target']['sha256'], 'bytes': m['target']['bytes'],
                'reused_completed_output': False, 'resumed_records': resumed,
                'elapsed_seconds': time.monotonic() - start}


def restore(base, delta, output, destination, *, application, progress=None):
    """Join the original native restore; no alternate Workspace receiver exists here."""
    result = receive(base, delta, output, progress=progress)
    native = native_module(application)
    native.inspect_archive(output, verify=True)
    destination = Path(destination)
    if destination.exists():
        received = native.resume_restore(output, destination, expected_archive_sha256=result['sha256'])
    else:
        received = native.restore(output, destination)
    return {'archive': result, 'native_receiving': received}


def write_review(delta, output):
    if __package__:
        from .archive_delta_view import render
    else:
        from archive_delta_view import render
    m = inspect(delta)
    metadata = {'delta_filename': Path(delta).name, 'delta_bytes': Path(delta).stat().st_size,
                'delta_sha256': file_hash(delta), 'manifest': m}
    Path(output).write_text(render(metadata), encoding='utf-8')
    return {'path': str(output), 'bytes': Path(output).stat().st_size, 'sha256': file_hash(output)}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    c = sub.add_parser('create'); c.add_argument('base'); c.add_argument('target'); c.add_argument('output'); c.add_argument('--application', required=True)
    i = sub.add_parser('inspect'); i.add_argument('delta')
    r = sub.add_parser('receive'); r.add_argument('base'); r.add_argument('delta'); r.add_argument('output')
    r = sub.add_parser('restore'); r.add_argument('base'); r.add_argument('delta'); r.add_argument('output'); r.add_argument('destination'); r.add_argument('--application', required=True)
    v = sub.add_parser('review'); v.add_argument('delta'); v.add_argument('output')
    a = vars(p.parse_args(argv)); command = a.pop('command')
    function = {'create': create, 'inspect': inspect, 'receive': receive, 'restore': restore, 'review': write_review}[command]
    try:
        result = function(**a)
        if command == 'inspect':
            result = {k: result[k] for k in ('schema', 'id', 'base', 'target', 'summary')}
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
