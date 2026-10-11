#!/usr/bin/env python3
"""MIT. Prepare original CloudSync records for the retained Python research function.

The selected Parquet reader runs separately. This command preserves its original
13-column JSON values, retains both original file identities, and removes only
insignificant JSON whitespace. It neither downloads nor substitutes source rows.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat

from contract import CLOUDSYNC_SCHEMA, canonical, plan_selection, read_cloudsync, require, sha256, strict_json


def regular(path, maximum):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= maximum, 'Expected a regular file within its size limit.')
        value = stream.read(maximum + 1)
        require(len(value) == before.st_size and len(value) <= maximum, 'The source file changed or exceeded its size limit.')
        return value


def parquet_identity(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and 8 <= before.st_size <= 268435456, 'Select the original Parquet file within 256 MiB.')
        require(stream.read(4) == b'PAR1', 'The selected original does not have a Parquet header.')
        stream.seek(-4, os.SEEK_END)
        require(stream.read(4) == b'PAR1', 'The selected original does not have a Parquet footer.')
        stream.seek(0)
        digest, size = hashlib.sha256(), 0
        while block := stream.read(1048576):
            size += len(block)
            require(size <= before.st_size, 'The original Parquet file changed during inspection.')
            digest.update(block)
        require(size == before.st_size, 'The original Parquet file changed during inspection.')
        return {'format': 'parquet', 'sha256': digest.hexdigest(), 'bytes': size}


def compact_json(text):
    # Parsing verifies the JSON contract; the writer does not serialize numbers
    # again, so number tokens and strings retain exactly the decoder's values.
    strict_json(text, decimals=True)
    output, quoted, escaped = [], False, False
    for character in text:
        if quoted:
            output.append(character)
            if escaped:
                escaped = False
            elif character == '\\':
                escaped = True
            elif character == '"':
                quoted = False
        elif character == '"':
            quoted = True
            output.append(character)
        elif character not in ' \t\r\n':
            output.append(character)
    return ''.join(output)


def for_interval(plan, interval):
    result = {**plan, 'window': {**plan['window'], 'timeInterval': interval}}
    result['selectionSha256'] = sha256(canonical({key: result[key] for key in ['provider', 'window', 'units', 'limits']}))
    return result


def write_new(path, content):
    path = Path(path).absolute()
    temporary = path.with_name('.' + path.name + '.' + secrets.token_hex(8) + '.tmp')
    created = False
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        created = True
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)  # Atomic publication; never replaces an existing file.
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if created:
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['plan', 'rows', 'original', 'source-url', 'decoder', 'decoder-version', 'out']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--interval', choices=['minutes', 'hours', 'days'], required=True)
    parser.add_argument('--compare', action='append', default=[], metavar='PREPARED_INPUT.json')
    options = parser.parse_args()
    plan = strict_json(regular(options.plan, 1048576))
    plan_selection(plan)
    require(len(options.compare) <= 2, 'At most two original comparison intervals can be supplied.')
    original_rows = regular(options.rows, 4194304)
    body = compact_json(original_rows.decode('utf-8', errors='strict'))
    source = {
        'schema': CLOUDSYNC_SCHEMA,
        'original': {'url': options.source_url, **parquet_identity(options.original)},
        'decoder': {'name': options.decoder, 'version': options.decoder_version,
                    'numberFormat': 'binary64-roundtrip-json', 'originalRowsSha256': sha256(original_rows),
                    'originalRowsBytes': len(original_rows)},
        'interval': options.interval, 'rowsBody': body, 'rowsSha256': sha256(body),
    }
    rows, _ = read_cloudsync(for_interval(plan, options.interval), source)
    result, seen, total = {'cloudsync': source}, {options.interval}, len(rows)
    if options.compare:
        result['compareCloudsync'] = []
    for path in options.compare:
        previous = strict_json(regular(path, plan['limits']['maxInputBytes']))
        require(isinstance(previous, dict) and set(previous) == {'cloudsync'}, 'A comparison must be one prepared original source without nested comparisons.')
        comparison = previous['cloudsync']
        require(isinstance(comparison, dict) and comparison.get('interval') in ['minutes', 'hours', 'days']
                and comparison['interval'] not in seen, 'Each comparison must use a different original interval.')
        seen.add(comparison['interval'])
        rows, _ = read_cloudsync(for_interval(plan, comparison['interval']), comparison)
        total += len(rows)
        result['compareCloudsync'].append(comparison)
    require(total <= plan['limits']['maxRows'], 'The combined supplied rows exceed this product limit.')
    content = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8') + b'\n'
    require(len(content) <= plan['limits']['maxInputBytes'], 'The complete source input exceeds the original function limit; select a smaller source window.')
    write_new(options.out, content)
    print(json.dumps({'input': str(Path(options.out).absolute()), 'bytes': len(content), 'sha256': sha256(content),
                      'selectedInterval': options.interval, 'merchantInterval': plan['window']['timeInterval'],
                      'totalOriginalRows': total, 'comparisonIntervals': sorted(seen - {options.interval}),
                      'nativeInputLimit': plan['limits']['maxInputBytes']}))


if __name__ == '__main__':
    main()
