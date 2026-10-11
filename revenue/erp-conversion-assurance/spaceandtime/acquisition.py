#!/usr/bin/env python3
"""Retained native acquisition and original ERP input preparation."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import csv
from datetime import datetime, timezone
from decimal import Decimal
from email.utils import parsedate_to_datetime
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import sys
import time
import uuid

import makeinfinite as native

HERE = Path(__file__).resolve().parent
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,95}\Z')
SHA = re.compile(r'[a-f0-9]{64}\Z')
IMPORT_SCHEMA = 'tjl.native-acquisition-input.v1'
PREPARED_SCHEMA = 'tjl.spaceandtime.prepared.v1'
MAX_INPUT = 128 * 1024 * 1024


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def packed(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + '\n').encode('utf-8')


def sha(body):
    return hashlib.sha256(body).hexdigest()


def read_regular(path, maximum=MAX_INPUT):
    fd = os.open(Path(path), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            raise ValueError('Choose a complete regular input within the supported size: ' + str(path))
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            body = stream.read(maximum + 1)
        after = os.fstat(fd)
        if len(body) > maximum or (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
            raise ValueError('The original input changed while being retained: ' + str(path))
        return body
    finally:
        os.close(fd)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic(path, body, *, replace=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.parent / ('.write-' + uuid.uuid4().hex)
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            os.replace(temp, path)
        else:
            os.link(temp, path)
        sync_directory(path.parent)
    finally:
        temp.unlink(missing_ok=True)


def private_directory(path):
    path = Path(path).expanduser().absolute()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if path.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('Use an owned private 0700 workspace directory.')
    path = path.resolve()
    if path == HERE or HERE in path.parents:
        raise ValueError('Keep retained native and customer files in a private directory outside the source checkout.')
    return path


def pointer(value, path, *, missing=None):
    if isinstance(path, str):
        if not path.startswith('/'):
            raise ValueError('A field selector must be an RFC 6901 JSON pointer beginning with /.')
        parts = [part.replace('~1', '/').replace('~0', '~') for part in path[1:].split('/')]
    elif isinstance(path, list) and all(isinstance(part, str) for part in path):
        parts = path
    else:
        raise ValueError('A native records path must be an array of property names or a JSON pointer.')
    current = value
    for part in parts:
        if isinstance(current, dict) and part in current:
            current = current[part]
        elif isinstance(current, list) and re.fullmatch(r'0|[1-9]\d*', part) and int(part) < len(current):
            current = current[int(part)]
        else:
            return missing
    return current


def _tuple_value(value):
    if isinstance(value, Decimal):
        return {'number': native.scalar(value)}
    if value is None or isinstance(value, (str, int, bool)):
        return value
    raise ValueError('A native identity tuple must contain scalar fields.')


def selected(row, filters):
    for condition in filters:
        if not isinstance(condition, dict) or set(condition) != {'path', 'operator', 'value'}:
            raise ValueError('Each retained-input filter needs path, operator and value.')
        observed = pointer(row, condition['path'])
        op, expected = condition['operator'], condition['value']
        if op == 'eq':
            match = observed == expected
        elif op == 'ne':
            match = observed != expected
        elif op == 'in' and isinstance(expected, list):
            match = observed in expected
        else:
            raise ValueError('Retained-input filters support eq, ne and in against original scalar values.')
        if not match:
            return False
    return True


def projection_value(row, selection):
    if isinstance(selection, str):
        return native.scalar(pointer(row, selection))
    if isinstance(selection, dict) and set(selection) == {'tuple'} and isinstance(selection['tuple'], list):
        values = [_tuple_value(pointer(row, part)) for part in selection['tuple']]
        return json.dumps(values, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    raise ValueError('A CSV projection selects an original JSON pointer or an explicit tuple of pointers.')


def retry_time(headers):
    value = headers.get('retry-after', '')
    try:
        if re.fullmatch(r'\d+(\.\d+)?', value):
            return time.time() + float(value)
        return max(time.time(), parsedate_to_datetime(value).timestamp())
    except (ValueError, TypeError, OverflowError):
        return time.time() + 60


class Store:
    def __init__(self, directory):
        self.path = private_directory(directory)
        self.objects = self.path / 'objects'
        self.objects.mkdir(exist_ok=True, mode=0o700)
        self.locks = self.path / 'locks'
        self.locks.mkdir(exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(self.path / 'acquisition.sqlite3', timeout=20)
        os.chmod(self.path / 'acquisition.sqlite3', 0o600)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS captures (
            id TEXT PRIMARY KEY, kind TEXT NOT NULL, plan TEXT NOT NULL,
            plan_sha TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS responses (
            id INTEGER PRIMARY KEY, capture_id TEXT NOT NULL REFERENCES captures(id),
            step TEXT NOT NULL, request TEXT NOT NULL, status INTEGER NOT NULL,
            headers TEXT NOT NULL, body_sha TEXT NOT NULL, bytes INTEGER NOT NULL,
            received_at TEXT NOT NULL, accepted INTEGER NOT NULL DEFAULT 0,
            info TEXT NOT NULL DEFAULT '{}');
          CREATE INDEX IF NOT EXISTS response_capture_step ON responses(capture_id,step,accepted);
          CREATE TABLE IF NOT EXISTS seen_keys (
            capture_id TEXT NOT NULL REFERENCES captures(id), key_sha TEXT NOT NULL,
            PRIMARY KEY(capture_id,key_sha));
        ''')

    def close(self):
        self.db.close()

    @contextmanager
    def lease(self, identity):
        if not ID.fullmatch(identity):
            raise ValueError('Use a stable capture ID of 1–96 letters, digits, dots, underscores or hyphens.')
        fd = os.open(self.locks / (identity + '.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise ValueError('This capture is already being acquired. Read its current status or reconnect after that process completes.') from error
            yield
        finally:
            os.close(fd)

    def put(self, body):
        digest = sha(body)
        target = self.objects / digest
        if target.exists():
            if sha(read_regular(target, max(MAX_INPUT, len(body)))) != digest:
                raise ValueError('A retained native object no longer matches its recorded bytes.')
        else:
            try:
                atomic(target, body)
            except FileExistsError:
                if sha(read_regular(target, max(MAX_INPUT, len(body)))) != digest:
                    raise ValueError('A concurrently retained native object has different bytes.')
        return digest

    def body(self, digest):
        if not SHA.fullmatch(digest):
            raise ValueError('The retained object digest is malformed.')
        body = read_regular(self.objects / digest)
        if sha(body) != digest:
            raise ValueError('A retained native object failed its exact-byte check.')
        return body

    def create(self, identity, kind, plan, state=None):
        if not ID.fullmatch(identity):
            raise ValueError('Choose a stable capture ID using letters, digits, dots, underscores and hyphens.')
        body = packed(plan)
        existing = self.db.execute('SELECT * FROM captures WHERE id=?', (identity,)).fetchone()
        if existing:
            if existing['kind'] != kind or existing['plan_sha'] != sha(body):
                raise ValueError('This capture ID already identifies another exact input plan. Use a new ID for a new selection.')
            return self.get(identity)
        state = state or {'status': 'new', 'phase': 'schemas', 'metadata': {}, 'rows': 0,
                          'observed_records': 0, 'raw_bytes': 0, 'pages': 0, 'after': None}
        with self.db:
            self.db.execute('INSERT INTO captures VALUES (?,?,?,?,?,?,?)',
                (identity, kind, body.decode(), sha(body), packed(state).decode(), now(), now()))
        return self.get(identity)

    def get(self, identity):
        row = self.db.execute('SELECT * FROM captures WHERE id=?', (identity,)).fetchone()
        if row is None:
            raise ValueError('The capture ID does not exist in this private workspace.')
        return {**dict(row), 'plan': json.loads(row['plan']), 'state': json.loads(row['state'])}

    def save(self, identity, state):
        self.db.execute('UPDATE captures SET state=?,updated_at=? WHERE id=?',
                        (packed(state).decode(), now(), identity))

    def rows(self, identity):
        capture = self.get(identity)
        if capture['state']['status'] != 'ready':
            raise ValueError('Complete the native capture before preparing finance inputs.')
        for response in self.db.execute('SELECT * FROM responses WHERE capture_id=? AND accepted=1 ORDER BY id', (identity,)):
            info = json.loads(response['info'])
            if info.get('role') != 'records':
                continue
            parsed = native.decode(self.body(response['body_sha']))
            records = pointer(parsed, info['records_path']) if info.get('records_path') is not None else parsed
            if not isinstance(records, list) or any(not isinstance(row, dict) for row in records):
                raise ValueError('The retained native response no longer contains its recorded row array.')
            for row in records:
                if selected(row, info.get('filters', [])):
                    yield row

    def describe(self, identity):
        capture = self.get(identity)
        pages = [{**dict(row), 'request': json.loads(row['request']), 'headers': json.loads(row['headers']),
                  'info': json.loads(row['info'])}
                 for row in self.db.execute('SELECT * FROM responses WHERE capture_id=? ORDER BY id', (identity,))]
        return {**capture, 'responses': pages}

    def fetch(self, identity, step, request, client):
        public = native.public_request(request)
        request_bytes = packed(public)
        step_id = step + ':' + sha(request_bytes)
        prior = self.db.execute('SELECT * FROM responses WHERE capture_id=? AND step=? AND status BETWEEN 200 AND 299 ORDER BY id DESC LIMIT 1',
                                (identity, step_id)).fetchone()
        if prior:
            return dict(prior), self.body(prior['body_sha'])
        response = client.send(request)
        digest = self.put(response['body'])
        headers = {key.lower(): value for key, value in response['headers'].items() if key.lower() in native.SAFE_HEADERS}
        with self.db:
            result = self.db.execute('INSERT INTO responses(capture_id,step,request,status,headers,body_sha,bytes,received_at) VALUES(?,?,?,?,?,?,?,?)',
                (identity, step_id, request_bytes.decode(), response['status'], packed(headers).decode(), digest, len(response['body']), now()))
        row = dict(self.db.execute('SELECT * FROM responses WHERE id=?', (result.lastrowid,)).fetchone())
        if response['status'] == 429 or response['status'] >= 500:
            state = self.get(identity)['state']
            state.update(status='paused', retry_at=retry_time(headers), error='Native HTTP ' + str(response['status']) + '; resume after Retry-After. Original accepted pages remain retained.')
            with self.db:
                self.save(identity, state)
            return None, None
        if not 200 <= response['status'] < 300:
            raise ValueError('Native acquisition returned HTTP ' + str(response['status']) + '. Its original response is retained; review the selected existing account, permissions or query and resume.')
        return row, response['body']

    def acquire(self, identity, secret):
        client = native.Client(secret)
        with self.lease(identity):
            try:
                while True:
                    capture = self.get(identity)
                    state, plan = capture['state'], capture['plan']
                    if state['status'] == 'ready':
                        return self.describe(identity)
                    if state.get('retry_at', 0) > time.time():
                        return self.describe(identity)
                    phase = state['phase']
                    state.update(status='running', error='')
                    state.pop('retry_at', None)
                    with self.db:
                        self.save(identity, state)
                    resource = {'schemas': 'schema', 'tables': 'table', 'columns': 'table/column', 'primary_keys': 'table/primarykey'}.get(phase)
                    if resource:
                        params = {'scope': plan.get('scope', 'PUBLIC')}
                        if phase != 'schemas':
                            params['schema'] = native._selected(state['metadata']['schemas'], 'schema', plan['schema'])['schema']
                        if phase in ('columns', 'primary_keys'):
                            params.pop('scope')
                            params['table'] = native._selected(state['metadata']['tables'], 'table', plan['table'])['table']
                        request = client.discovery(resource, params)
                    else:
                        request = client.sql(native.query(state['resolved'], count=phase.startswith('count_'),
                            after=state['after'] if phase == 'records' else None, limit=plan['page_size']))
                    response, body = self.fetch(identity, phase, request, client)
                    if response is None:
                        return self.describe(identity)
                    rows = native.native_array(body)
                    info = {'role': 'metadata', 'phase': phase}
                    new_keys = []
                    if resource:
                        state['metadata'][phase] = rows
                        sequence = ['schemas', 'tables', 'columns', 'primary_keys']
                        index = sequence.index(phase)
                        stop = capture['kind'] == 'discovery' and ((phase == 'schemas' and not plan.get('schema')) or
                            (phase == 'tables' and not plan.get('table')) or phase == 'primary_keys')
                        if stop:
                            state.update(status='ready', phase='complete', metadata_complete=True)
                        elif phase == 'primary_keys':
                            state['resolved'] = native.resolve(plan, state['metadata'])
                            state['phase'] = 'count_before'
                        else:
                            state['phase'] = sequence[index + 1]
                    elif phase == 'count_before':
                        state['expected_rows'] = native.observed_count(rows)
                        if state['expected_rows'] > plan['max_rows']:
                            raise ValueError('The native count exceeds this capture’s configured capacity. Select a complete narrower window or raise the explicit capacity in a new capture.')
                        state['phase'] = 'records'
                    elif phase == 'records':
                        info.update(role='records', records_path=None, filters=[], records=len(rows))
                        if len(rows) > plan['page_size']:
                            raise ValueError('The native query returned more rows than its selected LIMIT.')
                        if state['rows'] + len(rows) > plan['max_rows']:
                            raise ValueError('The complete native acquisition exceeds its configured row capacity.')
                        for row in rows:
                            missing = set(state['resolved']['columns']) - row.keys()
                            if missing:
                                raise ValueError('The native result omitted selected columns: ' + ', '.join(sorted(missing)))
                            key = native.key_values(row, state['resolved'])
                            new_keys.append(sha(packed(key)))
                        if rows:
                            state['after'] = native.key_values(rows[-1], state['resolved'])
                            state['rows'] += len(rows)
                            state['observed_records'] += len(rows)
                            state['pages'] += 1
                        else:
                            state['phase'] = 'count_after'
                    elif phase == 'count_after':
                        state['final_count'] = native.observed_count(rows)
                        if state['expected_rows'] != state['rows'] or state['final_count'] != state['rows']:
                            raise ValueError('The original count observations and acquired row count differ. The retained window changed or the provider returned an incomplete result; start a fresh capture for the agreed window.')
                        state.update(status='ready', phase='complete', query_complete=True,
                                     transactional_snapshot=False, completed_at=now())
                    else:
                        raise ValueError('The retained native phase is unknown.')
                    state['raw_bytes'] += response['bytes']
                    if state['raw_bytes'] > plan.get('max_capture_bytes', 1024 ** 3):
                        raise ValueError('The complete native capture exceeds its configured byte capacity.')
                    with self.db:
                        try:
                            self.db.executemany('INSERT INTO seen_keys VALUES (?,?)', [(identity, key) for key in new_keys])
                        except sqlite3.IntegrityError as error:
                            raise ValueError('The native keyset acquisition repeated an installed primary key; original pages are retained for the selected window.') from error
                        self.db.execute('UPDATE responses SET accepted=1,info=? WHERE id=?', (packed(info).decode(), response['id']))
                        self.save(identity, state)
            except native.NativeRetry as error:
                state = self.get(identity)['state']
                state.update(status='paused', retry_at=retry_time(error.headers), error=str(error),
                             authentication_status=error.status)
                with self.db:
                    self.save(identity, state)
                return self.describe(identity)
            except (ValueError, OSError, TimeoutError) as error:
                state = self.get(identity)['state']
                state.update(status='error', error=str(error))
                with self.db:
                    self.save(identity, state)
                raise

    def import_native(self, identity, manifest_file):
        manifest_file = Path(manifest_file).expanduser().absolute()
        raw_manifest = read_regular(manifest_file, 2 * 1024 * 1024)
        manifest = json.loads(raw_manifest)
        allowed = {'schema', 'provider', 'label', 'window', 'complete', 'expected_records', 'filters', 'unique_columns', 'responses'}
        if not isinstance(manifest, dict) or set(manifest) - allowed or manifest.get('schema') != IMPORT_SCHEMA:
            raise ValueError('Choose a native acquisition input manifest with its documented response provenance.')
        if manifest.get('complete') is not True or not isinstance(manifest.get('provider'), str) or not manifest['provider']:
            raise ValueError('The native input manifest must identify its provider and completed source selection.')
        expected = manifest.get('expected_records')
        if isinstance(expected, bool) or not isinstance(expected, int) or expected < 0:
            raise ValueError('Retain the observed full native record count before selection in expected_records.')
        if not isinstance(manifest.get('responses'), list) or not manifest['responses']:
            raise ValueError('Retain at least one original native response.')
        filters, unique = manifest.get('filters', []), manifest.get('unique_columns', [])
        if not isinstance(filters, list) or not isinstance(unique, list):
            raise ValueError('Native selection filters and unique column pointers must be arrays.')
        manifest_sha = self.put(raw_manifest)
        plan = {'manifest': manifest, 'original_manifest_sha256': manifest_sha}
        with self.lease(identity):
            capture = self.create(identity, 'retained-native', plan,
                {'status': 'new', 'phase': 'import', 'rows': 0, 'observed_records': 0, 'raw_bytes': 0, 'pages': 0})
            if capture['state']['status'] == 'ready':
                return self.describe(identity)
            retained, observed, selected_count, keys, total_bytes = [], 0, 0, set(), 0
            for index, item in enumerate(manifest['responses']):
                if not isinstance(item, dict) or item.get('role', 'records') not in ('records', 'metadata'):
                    raise ValueError('Each retained response must identify its records or metadata role.')
                filename = item.get('file')
                if not isinstance(filename, str) or not filename:
                    raise ValueError('Each retained response needs its original local file.')
                source = Path(filename)
                if not source.is_absolute():
                    source = manifest_file.parent / source
                body = read_regular(source)
                digest = self.put(body)
                if item.get('sha256') and digest != item['sha256']:
                    raise ValueError('An original response does not match its declared digest: ' + filename)
                status = item.get('status')
                if isinstance(status, bool) or not isinstance(status, int) or not 200 <= status < 300:
                    raise ValueError('Only completed successful native response bodies can supply acquired rows.')
                if not isinstance(item.get('url'), str) or not item['url'].startswith('https://'):
                    raise ValueError('Retain each original native HTTPS response URL.')
                role = item.get('role', 'records')
                info = {'role': role, 'original_filename': source.name, 'records_path': item.get('records_path'), 'filters': filters if role == 'records' else []}
                if role == 'records':
                    parsed = native.decode(body)
                    rows = pointer(parsed, item['records_path']) if item.get('records_path') is not None else parsed
                    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                        raise ValueError('The retained native records path is not an array of original row objects.')
                    observed += len(rows)
                    kept = 0
                    for row in rows:
                        if unique:
                            values = [pointer(row, path) for path in unique]
                            if any(value is None for value in values):
                                raise ValueError('An original row omitted a declared native unique field.')
                            key = sha(packed([native.scalar(value) for value in values]))
                            if key in keys:
                                raise ValueError('The original native response pages repeat a declared unique record.')
                            keys.add(key)
                        if selected(row, filters):
                            kept += 1
                    selected_count += kept
                    info.update(records=len(rows), selected_records=kept, excluded_records=len(rows) - kept)
                total_bytes += len(body)
                request = {'method': item.get('method', 'GET'), 'url': item['url'], 'body': item.get('request_body'),
                           'headers': {}, 'authorization_fields_omitted': []}
                if request['method'] != 'GET':
                    raise ValueError('The retained native import supports original GET acquisitions; use the MakeInfinite connector for SQL requests.')
                headers = {key.lower(): value for key, value in item.get('headers', {}).items() if key.lower() in native.SAFE_HEADERS}
                retained.append((identity, 'native-import:' + str(index), packed(request).decode(), status,
                                 packed(headers).decode(), digest, len(body), item.get('at', now()), packed(info).decode()))
            if observed != expected:
                raise ValueError('The retained native pages contain ' + str(observed) + ' records, differing from expected_records ' + str(expected) + '.')
            state = {'status': 'ready', 'phase': 'complete', 'rows': selected_count, 'observed_records': observed,
                     'excluded_records': observed - selected_count, 'raw_bytes': total_bytes,
                     'pages': len(retained), 'query_complete': True, 'transactional_snapshot': False,
                     'completed_at': now(), 'provider': manifest['provider']}
            with self.db:
                self.db.execute('DELETE FROM responses WHERE capture_id=?', (identity,))
                self.db.executemany('INSERT INTO responses(capture_id,step,request,status,headers,body_sha,bytes,received_at,info,accepted) VALUES(?,?,?,?,?,?,?,?,?,1)', retained)
                self.save(identity, state)
            return self.describe(identity)

    def csv_bytes(self, identity, projection):
        if not isinstance(projection, dict) or not projection or len(projection) > 256:
            raise ValueError('Use an ordered header-to-native-field projection for the finance CSV.')
        if any(not isinstance(name, str) or not name or '\0' in name for name in projection):
            raise ValueError('CSV output headers must be nonempty strings.')
        output = io.StringIO(newline='')
        writer = csv.writer(output, lineterminator='\n')
        writer.writerow(projection)
        count = 0
        for row in self.rows(identity):
            writer.writerow([projection_value(row, selection) for selection in projection.values()])
            count += 1
            if output.tell() > MAX_INPUT:
                raise ValueError('The complete prepared CSV exceeds 128 MiB. Select a complete smaller agreed window or extend the explicit original service capacity.')
        body = output.getvalue().encode('utf-8')
        if len(body) > MAX_INPUT:
            raise ValueError('The complete UTF-8 prepared CSV exceeds 128 MiB.')
        return body, count

    def prepare(self, identity, spec_file, destination, *, ledger=None, ledger_capture=None,
                projection=None, ledger_projection=None):
        capture = self.describe(identity)
        if capture['state']['status'] != 'ready':
            raise ValueError('Complete the original native capture before preparing its finance input.')
        spec_raw = read_regular(spec_file, 262144)
        spec = json.loads(spec_raw)
        if not isinstance(spec, dict) or spec.get('version') != 1 or not isinstance(spec.get('target_columns'), dict) or not isinstance(spec.get('source_columns'), dict):
            raise ValueError('Use the original ERP version 1 source/target mapping specification.')
        projection = projection or {name: '/' + name.replace('~', '~0').replace('/', '~1') for name in dict.fromkeys(spec['target_columns'].values())}
        if not set(spec['target_columns'].values()).issubset(projection):
            raise ValueError('The native CSV projection must provide every original target_columns header.')
        target_body, target_rows = self.csv_bytes(identity, projection)
        related = [capture]
        if ledger_capture:
            ledger_projection = ledger_projection or {name: '/' + name.replace('~', '~0').replace('/', '~1') for name in dict.fromkeys(spec['source_columns'].values())}
            if not set(spec['source_columns'].values()).issubset(ledger_projection):
                raise ValueError('The ledger capture projection must provide every original source_columns header.')
            source_body, source_rows = self.csv_bytes(ledger_capture, ledger_projection)
            if ledger_capture != identity:
                related.append(self.describe(ledger_capture))
            ledger_info = {'capture_id': ledger_capture, 'projection': ledger_projection, 'rows': source_rows}
        elif ledger:
            source_body = read_regular(ledger)
            ledger_info = {'original_filename': Path(ledger).name, 'source': 'operator-supplied original ledger CSV'}
        else:
            raise ValueError('Supply the agreed original ledger CSV or a second completed native capture.')
        if not source_body:
            raise ValueError('The original ledger CSV is empty.')
        input_identity = {'capture_id': identity, 'capture_plan_sha256': capture['plan_sha'],
                          'source_sha256': sha(source_body), 'target_sha256': sha(target_body),
                          'original_spec_sha256': sha(spec_raw), 'projection': projection,
                          'ledger': ledger_info}
        prepared_id = sha(packed(input_identity))
        destination = Path(destination).expanduser().absolute()
        if destination.exists():
            existing = verify_prepared(destination)
            if existing.get('preparation_id') != prepared_id:
                raise ValueError('The preparation destination contains a different exact input selection. Choose a new directory.')
            return existing
        destination.mkdir(parents=True, mode=0o700)
        files = []

        def retain(name, body):
            atomic(destination / name, body)
            files.append({'path': name, 'bytes': len(body), 'sha256': sha(body)})

        try:
            retain('source.csv', source_body)
            retain('target.csv', target_body)
            retain('originals/original-spec.json', spec_raw)
            provenance = []
            for item in related:
                response_entries = []
                for index, response in enumerate(item['responses']):
                    stem = 'originals/' + item['id'] + '/response-' + str(index + 1).zfill(6)
                    retain(stem + '.json', self.body(response['body_sha']))
                    request_body = packed(response['request'])
                    retain(stem + '.request.json', request_body)
                    response_entries.append({**response, 'body_path': stem + '.json',
                                             'request_path': stem + '.request.json', 'request_sha256': sha(request_body)})
                if item['kind'] == 'retained-native':
                    retain('originals/' + item['id'] + '/native-import.json', self.body(item['plan']['original_manifest_sha256']))
                provenance.append({**item, 'responses': response_entries})
            acquisition = {'schema': 'tjl.spaceandtime.acquisition.v1', 'preparation_id': prepared_id,
                           **input_identity, 'target_rows': target_rows, 'captures': provenance,
                           'numeric_handling': 'Native JSON numbers parse as exact integers/Decimal; CSV decimal values use fixed decimal text without rounding.',
                           'created_at': now()}
            acquisition_body = packed(acquisition)
            retain('acquisition.json', acquisition_body)
            workspace = spec.get('workspace', {})
            if not isinstance(workspace, dict):
                raise ValueError('The original spec.workspace metadata must be an object.')
            spec['workspace'] = {**workspace, 'spaceandtime_acquisition': {
                'schema': 'tjl.spaceandtime.acquisition-ref.v1', 'preparation_id': prepared_id,
                'capture_id': identity, 'acquisition_sha256': sha(acquisition_body),
                'source_sha256': sha(source_body), 'target_sha256': sha(target_body),
                'capture_ids': [item['id'] for item in related], 'window': capture['plan'].get('window', capture['plan'].get('manifest', {}).get('window'))}}
            spec_body = packed(spec)
            if len(spec_body) > 262144:
                raise ValueError('The complete mapped spec exceeds the original service’s 256 KiB limit.')
            retain('spec.json', spec_body)
            result = {'schema': PREPARED_SCHEMA, 'preparation_id': prepared_id, 'capture_id': identity,
                      'ledger_capture_id': ledger_capture, 'acquisition_sha256': sha(acquisition_body),
                      'source_sha256': sha(source_body), 'target_sha256': sha(target_body),
                      'spec_sha256': sha(spec_body), 'files': sorted(files, key=lambda item: item['path'])}
            atomic(destination / 'manifest.json', packed(result))
            return result
        except Exception:
            # Keep any completed private bytes available; a new destination can
            # finish preparation without mutating the original acquisition.
            raise


def verify_prepared(directory):
    directory = Path(directory).resolve()
    manifest = json.loads(read_regular(directory / 'manifest.json', 8 * 1024 * 1024))
    if manifest.get('schema') != PREPARED_SCHEMA or not isinstance(manifest.get('files'), list):
        raise ValueError('The destination is not a complete native preparation package.')
    seen = set()
    for item in manifest['files']:
        name = item.get('path')
        if not isinstance(name, str) or str(PurePosixPath(name)) != name or name.startswith('/') or '..' in PurePosixPath(name).parts or '\\' in name or name in seen:
            raise ValueError('The preparation inventory contains an invalid relative file path.')
        seen.add(name)
        current = directory
        for part in PurePosixPath(name).parts[:-1]:
            current = current / part
            if current.is_symlink():
                raise ValueError('A preparation parent path is a symbolic link.')
        body = read_regular(directory / name)
        if sha(body) != item.get('sha256') or len(body) != item.get('bytes'):
            raise ValueError('A prepared native file differs from its original inventory: ' + name)
    for name in ('source.csv', 'target.csv', 'spec.json', 'acquisition.json'):
        if name not in seen:
            raise ValueError('The complete preparation is missing ' + name)
        expected = manifest[name.split('.')[0] + '_sha256']
        if sha(read_regular(directory / name)) != expected:
            raise ValueError('A canonical preparation digest differs from its inventory.')
    return manifest


def load_json(path):
    return json.loads(read_regular(path, 2 * 1024 * 1024)) if path else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True, help='Owned private retained-acquisition directory outside the checkout')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('list')
    inspect = commands.add_parser('show')
    inspect.add_argument('--id', required=True)
    discover = commands.add_parser('discover')
    discover.add_argument('--id', required=True)
    discover.add_argument('--credentials', required=True)
    discover.add_argument('--scope', choices=['PUBLIC', 'SUBSCRIPTION'], default='PUBLIC')
    discover.add_argument('--schema')
    discover.add_argument('--table')
    capture = commands.add_parser('capture')
    capture.add_argument('--id', required=True)
    capture.add_argument('--plan', required=True)
    capture.add_argument('--credentials', required=True)
    resume = commands.add_parser('resume')
    resume.add_argument('--id', required=True)
    resume.add_argument('--credentials', required=True)
    imported = commands.add_parser('import')
    imported.add_argument('--id', required=True)
    imported.add_argument('--manifest', required=True)
    exported = commands.add_parser('csv')
    exported.add_argument('--id', required=True)
    exported.add_argument('--projection', required=True)
    exported.add_argument('--out', required=True)
    prepare = commands.add_parser('prepare')
    prepare.add_argument('--id', required=True)
    prepare.add_argument('--spec', required=True)
    source = prepare.add_mutually_exclusive_group(required=True)
    source.add_argument('--ledger')
    source.add_argument('--ledger-capture')
    prepare.add_argument('--projection')
    prepare.add_argument('--ledger-projection')
    prepare.add_argument('--out', required=True)
    args = parser.parse_args()
    store = Store(args.workspace)
    try:
        if args.command == 'list':
            result = [{**dict(row), 'state': json.loads(row['state'])} for row in store.db.execute('SELECT id,kind,plan_sha,state,created_at,updated_at FROM captures ORDER BY created_at DESC')]
        elif args.command == 'show':
            result = store.describe(args.id)
        elif args.command == 'discover':
            if args.table and not args.schema:
                raise ValueError('Select the installed schema before requesting its table metadata.')
            plan = {'scope': args.scope, 'schema': args.schema, 'table': args.table}
            store.create(args.id, 'discovery', plan)
            result = store.acquire(args.id, native.credentials(args.credentials))
        elif args.command == 'capture':
            store.create(args.id, 'makeinfinite', native.validate_plan(load_json(args.plan)))
            result = store.acquire(args.id, native.credentials(args.credentials))
        elif args.command == 'resume':
            if store.get(args.id)['kind'] not in ('makeinfinite', 'discovery'):
                raise ValueError('Use import with the original input manifest to resume retained native input preparation.')
            result = store.acquire(args.id, native.credentials(args.credentials))
        elif args.command == 'import':
            result = store.import_native(args.id, args.manifest)
        elif args.command == 'csv':
            body, rows = store.csv_bytes(args.id, load_json(args.projection))
            atomic(args.out, body)
            result = {'path': str(Path(args.out).absolute()), 'rows': rows, 'bytes': len(body), 'sha256': sha(body)}
        else:
            result = store.prepare(args.id, args.spec, args.out, ledger=args.ledger,
                ledger_capture=args.ledger_capture, projection=load_json(args.projection),
                ledger_projection=load_json(args.ledger_projection))
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        if isinstance(result, dict) and result.get('state', {}).get('status') == 'paused':
            return 3
        return 0
    finally:
        store.close()


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, sqlite3.Error, KeyError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
