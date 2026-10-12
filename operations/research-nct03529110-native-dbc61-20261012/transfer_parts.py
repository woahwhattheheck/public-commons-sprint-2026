#!/usr/bin/env python3
"""Plan and verify byte-exact multipart file transfers. No network access."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

SCHEMA = 'commons.file-part.v1'


def encoded(value):
    return json.dumps(value, ensure_ascii=True, separators=(',', ':'), sort_keys=True).encode('utf-8')


def digest_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(part)
    return digest.hexdigest()


def envelope(transfer, index, count, offset, raw):
    return {'schema': SCHEMA, 'transfer_id': transfer, 'index': index, 'count': count,
            'offset': offset, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
            'data_base64': base64.b64encode(raw).decode('ascii')}


def plan(source, budget, raw_limit=None):
    source = Path(source)
    if source.is_symlink() or not source.is_file():
        raise ValueError('source must be an existing regular file, not a link')
    if isinstance(budget, bool) or not isinstance(budget, int) or budget < 512:
        raise ValueError('max request bytes must be an integer of at least 512')
    if raw_limit is not None and (isinstance(raw_limit, bool) or not isinstance(raw_limit, int) or raw_limit < 1):
        raise ValueError('raw chunk limit must be positive')
    size = source.stat().st_size
    if size >= 10 ** 20:
        raise ValueError('file exceeds supported byte range')
    sha = digest_file(source)
    transfer = 'sha256-' + sha
    # A conservative metadata bound keeps every concrete envelope within budget.
    overhead = len(encoded(envelope(transfer, 10 ** 20 - 1, 10 ** 20 - 1, 10 ** 20 - 1, b''))) + 20
    chunk = ((budget - overhead) // 4) * 3
    if raw_limit is not None:
        chunk = min(chunk, raw_limit)
    if chunk < 1:
        raise ValueError('budget leaves no room for file content')
    count = max(1, (size + chunk - 1) // chunk)
    if count > 100000:
        raise ValueError('more than 100000 parts; use a larger budget or native binary upload')
    return {'schema': 'commons.file-transfer.v1', 'transfer_id': transfer, 'bytes': size,
            'sha256': sha, 'parts': count, 'raw_chunk_bytes': chunk,
            'max_request_bytes': budget, 'transport': 'file_envelopes_only', 'uploaded': False}


def write_new(path, raw):
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)


def split(source, budget, output, raw_limit=None):
    source, target = Path(source), Path(output)
    data = plan(source, budget, raw_limit)
    if target.exists() or target.is_symlink():
        raise ValueError('output directory already exists')
    target.mkdir(parents=True, mode=0o700, exist_ok=False)
    offset, actual_digest = 0, hashlib.sha256()
    try:
        with source.open('rb') as stream:
            for index in range(data['parts']):
                raw = stream.read(data['raw_chunk_bytes'])
                item = envelope(data['transfer_id'], index, data['parts'], offset, raw)
                payload = encoded(item)
                if len(payload) > budget:
                    raise ValueError('concrete envelope exceeds budget')
                write_new(target / ('part-%06d.json' % index), payload)
                offset += len(raw)
                actual_digest.update(raw)
            if stream.read(1) or offset != data['bytes'] or actual_digest.hexdigest() != data['sha256']:
                raise ValueError('source changed during transfer preparation')
        write_new(target / 'manifest.json', encoded(data))
    except Exception:
        # Incomplete directories intentionally lack a manifest and cannot be joined.
        raise
    return dict(data, state='parts_prepared', directory=str(target))


def join(directory, output):
    root, destination = Path(directory), Path(output)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('parts directory must be a regular directory')
    manifest_path = root / 'manifest.json'
    if manifest_path.is_symlink():
        raise ValueError('manifest cannot be a link')
    meta = json.loads(manifest_path.read_text(encoding='utf-8'))
    if meta.get('schema') != 'commons.file-transfer.v1':
        raise ValueError('unsupported manifest schema')
    count = meta.get('parts')
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 100000:
        raise ValueError('invalid part count')
    if destination.exists() or destination.is_symlink():
        raise ValueError('destination already exists')
    expected = {'part-%06d.json' % i for i in range(count)}
    actual = {p.name for p in root.glob('part-*.json')}
    if actual != expected:
        raise ValueError('missing or unexpected parts')
    fd, temp_name = tempfile.mkstemp(prefix='.commons-transfer-', dir=destination.parent)
    tmp = Path(temp_name)
    sha, offset = hashlib.sha256(), 0
    try:
        with os.fdopen(fd, 'wb') as stream:
            for index in range(count):
                path = root / ('part-%06d.json' % index)
                if path.is_symlink() or not path.is_file():
                    raise ValueError('part must be a regular file')
                packed = path.read_bytes()
                if len(packed) > meta['max_request_bytes']:
                    raise ValueError('part exceeds manifest budget')
                item = json.loads(packed)
                expected_fields = {'schema': SCHEMA, 'transfer_id': meta['transfer_id'],
                                   'index': index, 'count': count, 'offset': offset}
                if any(item.get(k) != v for k, v in expected_fields.items()):
                    raise ValueError('part identity, numbering or offset mismatch')
                raw = base64.b64decode(item['data_base64'], validate=True)
                if len(raw) != item['bytes'] or hashlib.sha256(raw).hexdigest() != item['sha256']:
                    raise ValueError('part byte count or digest mismatch')
                stream.write(raw)
                sha.update(raw)
                offset += len(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if offset != meta['bytes'] or sha.hexdigest() != meta['sha256']:
            raise ValueError('full file byte count or digest mismatch')
        if meta['transfer_id'] != 'sha256-' + sha.hexdigest():
            raise ValueError('transfer ID mismatch')
        os.link(tmp, destination)  # Publish without replacing a concurrent destination.
        return {'state': 'restored', 'path': str(destination), 'bytes': offset,
                'sha256': sha.hexdigest(), 'transfer_id': meta['transfer_id']}
    finally:
        tmp.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('plan', 'split'):
        p = sub.add_parser(name)
        p.add_argument('source')
        p.add_argument('--max-request-bytes', type=int, required=True)
        p.add_argument('--raw-chunk-limit', type=int)
        if name == 'split':
            p.add_argument('--output', required=True)
    p = sub.add_parser('join')
    p.add_argument('directory')
    p.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'join':
            result = join(args.directory, args.output)
        elif args.command == 'split':
            result = split(args.source, args.max_request_bytes, args.output, args.raw_chunk_limit)
        else:
            result = plan(args.source, args.max_request_bytes, args.raw_chunk_limit)
        print(json.dumps(result, indent=2))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print('transfer-parts: ' + str(exc), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
