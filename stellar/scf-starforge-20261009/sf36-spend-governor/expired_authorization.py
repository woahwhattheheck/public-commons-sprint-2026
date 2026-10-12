"""Resume an original expired, untransferred native Stellar authorization.

The privileged host binds the original complete approval and stopped attempt.
This worker observes the original public chain, retains the exact source and
provider responses, seals that observation, and calls the original SF36 ledger.
Release, fresh consent, new reservation and chain settlement remain distinct.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import timedelta
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import ssl
import sqlite3
import stat
import subprocess
import shutil
import sys
import tempfile
from urllib.parse import urlsplit, parse_qs
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parent))

from governor import (Denied, Governor, as_time, canonical, now_utc, parse_amount,
    validate_request, issue_expired_authorization_attestation)
from finalize import (decode, private_path, read_source, check_ledger_path,
    key_from_environment)

SCHEMA = 'stellar-forge.sf36.expired-authorization.v1'
SOURCE_SCHEMA = 'stellar-forge.sf36.expired-authorization-source.v1'
PERMIT_SCHEMA = 'stellar-forge.sf36.expired-resume-permit.v1'
PROFILE = 'native-testnet-x402-stellar-2.28.0/v1'
HORIZON = 'https://horizon-testnet.stellar.org'
PASSPHRASE = 'Test SDF Network ; September 2015'
NATIVE_ASSET = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
HASH = re.compile(r'^[0-9a-f]{64}$')
ACCOUNT = re.compile(r'^G[A-Z2-7]{55}$')
SDK_FILES = {
    'dist/esm/chunk-EGJCLWK3.mjs': '8ab5d52236bca84114dd38dc6f48b61e8f5a70ecbfed17144b4176db6e95af7b',
    'dist/esm/chunk-HBDJ2YHP.mjs': '6b90c248d2fd0913a39d9feb665a32f7d07739220db5ca377dce6e089eb2ea5d',
}
MAX_FILE = 16 * 1024 * 1024
MAX_HTTP = 4 * 1024 * 1024
MAX_HISTORY_PAGES = 32


def require(value, code):
    if not value:
        raise Denied(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def raw_file(path, maximum=MAX_FILE, *, private=True):
    path = Path(path)
    if private:
        private_path(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= maximum,
                'EXPIRY_SOURCE_FILE_INVALID')
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
    require(len(raw) <= maximum and len(raw) == before.st_size == after.st_size and
            before.st_ino == after.st_ino and before.st_mtime_ns == after.st_mtime_ns,
            'EXPIRY_SOURCE_CHANGED_DURING_READ')
    return raw


def atomic(path, raw, *, replace=False):
    """Same private parent, fsync bytes and directory; never follow an old link."""
    path = Path(path)
    private_path(path.parent, directory=True)
    if os.path.lexists(path):
        previous = raw_file(path, max(len(raw), MAX_FILE))
        if not replace:
            require(previous == raw, 'EXPIRY_RETAINED_BYTES_CONFLICT')
            return
    descriptor, temporary = tempfile.mkstemp(prefix='.expiry-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if not replace and os.path.lexists(path):
            require(raw_file(path, max(len(raw), MAX_FILE)) == raw,
                    'EXPIRY_RETAINED_BYTES_CONFLICT')
            return
        os.replace(temporary, path)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def json_write(path, value, *, replace=False):
    atomic(path, canonical(value) + b'\n', replace=replace)


def mkdir(path):
    path.mkdir(mode=0o700, exist_ok=True)
    private_path(path, directory=True)


@contextmanager
def original_approval_lock(ledger):
    """Use the exact original SF81 ledger lock, without deleting its inode."""
    path = ledger.with_name(ledger.name + '.sf81.lock')
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'a') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and
                not info.st_mode & 0o077, 'EXPIRY_ORIGINAL_LOCK_NOT_PRIVATE')
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise Denied('ORIGINAL_APPROVAL_OWNER_ACTIVE') from error
        yield



def native_context(source, *, node):
    require(isinstance(node, str) and Path(node).is_absolute() and os.access(node, os.X_OK),
            'EXPIRY_TRUSTED_ABSOLUTE_NODE_REQUIRED')
    process = subprocess.run([node, str(Path(__file__).with_name('expired_context.mjs'))],
        input=canonical({key: source[key] for key in ('sourceKind', 'configurationFile', 'attemptFile', 'facilitatorConfigurationFile')}),
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env={'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'}, timeout=60, check=False)
    require(len(process.stdout) <= 65536, 'EXPIRY_NATIVE_CONTEXT_TOO_LARGE')
    require(process.stdout.strip(), 'EXPIRY_ORIGINAL_NATIVE_CONTEXT_NO_RESULT')
    result = decode(process.stdout)
    require(process.returncode == 0 and not result.get('error') and
            result.get('schema') == 'stellar-forge.sf36.expired-attempt-context.v1',
            result.get('error') if isinstance(result.get('error'), str) and
                re.fullmatch(r'[A-Z0-9_]{1,120}', result['error'])
            else 'EXPIRY_ORIGINAL_NATIVE_CONTEXT_FAILED')
    return result

def select_original(value, path):
    require(isinstance(path, list) and 1 <= len(path) <= 16 and
            all(isinstance(part, str) and 1 <= len(part) <= 128 for part in path),
            'EXPIRY_BASELINE_SOURCE_PATH_INVALID')
    for part in path:
        require(type(value) is dict and part in value, 'EXPIRY_BASELINE_SOURCE_FIELD_MISSING')
        value = value[part]
    return value


def chain_baseline(source, values, manifest, request, native):
    selection = source.get('chainBaseline', {})
    fields = {'network', 'payer', 'feePayer', 'observedLedger',
              'transaction', 'transactionLedger', 'transactionSource'}
    require(type(selection) is dict and set(selection) == {'role', 'fields', 'originalReceipt'} and
            selection.get('role') in values and values[selection['role']] is not None and
            type(selection.get('fields')) is dict and set(selection['fields']) == fields and
            isinstance(selection.get('originalReceipt'), str) and
            selection['originalReceipt'].startswith('https://') and
            1 <= len(selection['originalReceipt']) <= 4096,
            'EXPIRY_ORIGINAL_PRIOR_CHAIN_SOURCE_REQUIRED')
    original = decode(values[selection['role']])
    value = {key: select_original(original, path) for key, path in selection['fields'].items()}
    require(value['network'] == request['network'] and value['payer'] == source['payer'] and
            value['feePayer'] == value['transactionSource'] == native['feePayer'] and
            type(value['observedLedger']) is int and type(value['transactionLedger']) is int and
            1 <= value['transactionLedger'] <= value['observedLedger'] < source['signingAnchorLedger'] and
            isinstance(value['transaction'], str) and HASH.fullmatch(value['transaction']),
            'EXPIRY_ORIGINAL_PRIOR_CHAIN_STATE_MISMATCH')
    retained = next(item for item in manifest if item['role'] == selection['role'])
    return {**value, 'sourceRole': selection['role'], 'sourceSha256': retained['sha256'],
            'sourceBytes': retained['bytes'], 'originalReceipt': selection['originalReceipt']}


def source_context(path, source, source_raw, *, payer, ledger, policy, node):
    require(raw_file(path) == source_raw, 'EXPIRY_ORIGINAL_DESCRIPTOR_CHANGED')
    require(source.get('schema') == SOURCE_SCHEMA and
            source.get('sourceKind') in ('dataset', 'node-operation'),
            'EXPIRY_SOURCE_SCHEMA_INVALID')
    request = validate_request(source.get('approvedRequest'))
    request_sha = sha(canonical(request))
    require(request['network'] == 'stellar:testnet' and request['scheme'] == 'exact' and
            request['asset'] == NATIVE_ASSET, 'EXPIRY_NATIVE_TESTNET_PROFILE_REQUIRED')
    require(source.get('payer') == payer and ACCOUNT.fullmatch(payer) and
            isinstance(source.get('feePayer'), str) and ACCOUNT.fullmatch(source['feePayer']),
            'EXPIRY_ORIGINAL_PAYER_AND_FEE_PAYER_REQUIRED')
    require(source.get('requestSha256', request_sha) == request_sha,
            'EXPIRY_APPROVAL_DIGEST_MISMATCH')
    files = source.get('files')
    require(isinstance(files, list) and 2 <= len(files) <= 64, 'EXPIRY_ORIGINAL_FILES_REQUIRED')
    values, manifest = {}, []
    roles = set()
    for item in files:
        require(type(item) is dict and set(item) <= {'role', 'path', 'sha256', 'bytes', 'state'} and
                isinstance(item.get('role'), str) and
                re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', item['role']) and
                item['role'] not in roles and item['role'] not in ('descriptor', 'custody'),
                'EXPIRY_SOURCE_ROLE_INVALID')
        role, original = item['role'], Path(item['path'])
        require(original.is_absolute() and original.resolve() == original,
                'EXPIRY_SOURCE_PATH_INVALID')
        roles.add(role)
        if item.get('state') == 'ABSENT':
            require(item.get('sha256') is None and item.get('bytes') == 0 and
                    not os.path.lexists(original), 'EXPIRY_ABSENT_SOURCE_CHANGED')
            values[role] = None
            manifest.append({**item, 'state': 'ABSENT'})
            continue
        require(isinstance(item.get('sha256'), str) and HASH.fullmatch(item['sha256']) and
                type(item.get('bytes')) is int and 0 <= item['bytes'] <= MAX_FILE,
                'EXPIRY_SOURCE_HASH_REQUIRED')
        raw = raw_file(original)
        require(len(raw) == item['bytes'] and sha(raw) == item['sha256'],
                'EXPIRY_ORIGINAL_SOURCE_CHANGED')
        values[role] = raw
        manifest.append({**item, 'state': 'SAVED'})
    require(values.get('configuration') is not None and values.get('attempt') is not None and
            values.get('facilitator') is not None,
            'EXPIRY_ORIGINAL_CONFIGURATION_AND_ATTEMPT_REQUIRED')
    by_role = {item['role']: item for item in manifest}
    require(by_role['configuration']['path'] == source.get('configurationFile') and
            by_role['attempt']['path'] == source.get('attemptFile') and
            by_role['facilitator']['path'] == source.get('facilitatorConfigurationFile'),
            'EXPIRY_SOURCE_SELECTION_MISMATCH')
    cfg, attempt = decode(values['configuration']), decode(values['attempt'])
    native = native_context(source, node=node)
    require(native.get('sourceKind') == source['sourceKind'] and
            native.get('configurationBytesSha256') == sha(values['configuration']) and
            native.get('attemptSha256') == sha(values['attempt']) and
            native.get('facilitatorConfigurationSha256') == sha(values['facilitator']) and
            native.get('feePayer') == source['feePayer'],
            'EXPIRY_ORIGINAL_NATIVE_SOURCE_CHANGED')
    owner, operation = cfg.get('operator', {}), cfg.get('operation', {})
    expected = operation.get('expect', {})
    require(owner.get('ledger') == str(ledger) and owner.get('policy') == str(policy) and
            owner.get('actor') == request['actor'] and owner.get('service') == request['service'] and
            operation.get('intentId') == request['request_id'] == attempt.get('intentId') and
            operation.get('url') == request['resource'] and
            operation.get('method', 'GET') == request['method'] and
            cfg.get('trustedPayer') == payer, 'EXPIRY_ORIGINAL_CONFIG_APPROVAL_MISMATCH')
    require(all(expected.get(field) == request[target] for field, target in (
                ('network', 'network'), ('asset', 'asset'), ('scheme', 'scheme'), ('payTo', 'pay_to'))) and
            parse_amount(expected.get('maxAtomic')) >= parse_amount(request['max_amount']),
            'EXPIRY_ORIGINAL_PAYMENT_TERMS_MISMATCH')
    if expected.get('maxTimeoutSeconds') is not None:
        require(type(expected['maxTimeoutSeconds']) is int and
                request['max_timeout_seconds'] <= expected['maxTimeoutSeconds'],
                'EXPIRY_APPROVED_TIMEOUT_MISMATCH')
    body_present = operation.get('bodyFile') is not None
    body = values.get('body') if body_present else b''
    require(body is not None and request['body_present'] == body_present and
            request['body_bytes'] == len(body) and request['body_sha256'] == sha(body),
            'EXPIRY_ORIGINAL_REQUEST_BODY_MISMATCH')
    if body_present:
        require(by_role['body']['path'] == operation['bodyFile'],
                'EXPIRY_ORIGINAL_REQUEST_BODY_PATH_MISMATCH')
    if source['sourceKind'] == 'dataset':
        require(attempt.get('schema') == 'stellar-forge.sf88.dataset-attempt.v1' and
                attempt.get('configurationSha256') == native.get('configurationSha256'),
                'EXPIRY_ORIGINAL_DATASET_ATTEMPT_MISMATCH')
    else:
        require(values.get('operation') is not None, 'EXPIRY_ORIGINAL_NODE_OPERATION_REQUIRED')
        meta = decode(values['operation'])
        require(meta.get('schema') == attempt.get('schema') == 'stellar-forge.node-buyer.v1' and
                meta.get('state') == 'PREPARED' and meta.get('intentId') == request['request_id'] and
                meta.get('configSha256') == attempt.get('configSha256') == sha(values['configuration']) and
                meta.get('bodySha256') == attempt.get('bodySha256') == sha(body) and
                attempt.get('kind') is None, 'EXPIRY_ORIGINAL_NODE_ATTEMPT_MISMATCH')
        if operation.get('ticketFile') is not None:
            require(values.get('ticket') is not None and
                    by_role['ticket']['path'] == operation['ticketFile'] and
                    meta.get('ticketSha256') == sha(values['ticket']),
                    'EXPIRY_ORIGINAL_NODE_TICKET_MISMATCH')
    started = as_time(attempt.get('startedAt', attempt.get('createdAt')))
    require(as_time(source.get('attemptStartedAt')) == started and
            as_time(native.get('attemptStartedAt')) == started and
            native.get('bodyPresent') == body_present and native.get('bodyBytes') == len(body) and
            native.get('bodySha256') == sha(body),
            'EXPIRY_ORIGINAL_ATTEMPT_TIME_MISMATCH')
    stopped = source.get('executionStopped', {})
    require(type(stopped) is dict and stopped.get('kind') in (
                'OWNED_PROCESS_EXIT', 'ORIGINAL_KERNEL_LEASE_RELEASED', 'EXECUTOR_SESSION_TERMINATED') and
            started <= as_time(stopped.get('at')) <= now_utc(),
            'EXPIRY_STOPPED_ORIGINAL_EXECUTION_REQUIRED')
    custody_raw = raw_file(Path(stopped['evidenceFile']), 1_048_576)
    require(sha(custody_raw) == stopped.get('evidenceSha256'),
            'EXPIRY_ORIGINAL_CUSTODY_RECEIPT_CHANGED')
    custody = decode(custody_raw)
    require(custody.get('intentId') == request['request_id'] and
            custody.get('attemptSha256') == by_role['attempt']['sha256'] and
            custody.get('state') == 'STOPPED' and custody.get('observedAt') == stopped['at'] and
            isinstance(custody.get('providerReceipt'), str) and 1 <= len(custody['providerReceipt']) <= 4096,
            'EXPIRY_ORIGINAL_CUSTODY_RECEIPT_MISMATCH')
    anchor = source.get('signingAnchorLedger')
    require(type(anchor) is int and 1 <= anchor < 2**32 and
            anchor + request['max_timeout_seconds'] < 2**32, 'EXPIRY_SIGNING_ANCHOR_INVALID')
    sdk_root = Path(source['sdkRoot'])
    sdk_files = []
    for relative, expected_sha in SDK_FILES.items():
        raw = raw_file(sdk_root / relative, 4_000_000, private=False)
        require(sha(raw) == expected_sha, 'EXPIRY_ORIGINAL_SDK_PROFILE_CHANGED')
        sdk_files.append({'path': str(sdk_root / relative), 'sha256': expected_sha, 'bytes': len(raw)})
    package = decode(raw_file(sdk_root / 'package.json', 65536, private=False))
    require(package.get('name') == '@x402/stellar' and package.get('version') == '2.28.0',
            'EXPIRY_ORIGINAL_SDK_VERSION_MISMATCH')
    baseline = chain_baseline(source, values, manifest, request, native)
    binding = {'sourceKind': source['sourceKind'], 'sourcePath': str(path),
        'sourceSha256': sha(source_raw), 'requestSha256': request_sha,
        'intentId': request['request_id'], 'payer': payer, 'feePayer': source['feePayer'],
        'attemptStartedAt': source['attemptStartedAt'], 'executionStopped': stopped,
        'files': manifest, 'sdkFiles': sdk_files, 'nativeContext': native, 'profile': PROFILE,
        'chainBaseline': baseline,
        'signingAnchorLedger': anchor,
        'expiryLedgerUpperBound': anchor + request['max_timeout_seconds']}
    return request, binding, values, custody_raw


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise Denied('EXPIRY_PROVIDER_REDIRECT_REFUSED')


class Observer:
    def __init__(self, directory, *, https_proxy=None):
        self.directory = directory
        self.captures = []
        proxies = {}
        if https_proxy is not None:
            require(isinstance(https_proxy, str) and 1 <= len(https_proxy) <= 4096 and
                    not any(character.isspace() for character in https_proxy),
                    'EXPIRY_OPERATOR_PROXY_INVALID')
            endpoint = urlsplit(https_proxy)
            require(endpoint.scheme in ('http', 'https') and endpoint.hostname and
                    endpoint.username is None and endpoint.password is None and
                    endpoint.path in ('', '/') and not endpoint.query and not endpoint.fragment and
                    (endpoint.port is None or 1 <= endpoint.port <= 65535),
                    'EXPIRY_OPERATOR_PROXY_INVALID')
            proxies['https'] = https_proxy
        # Only the explicit host-selected proxy is used. Destination TLS and the
        # fixed original Horizon endpoint are unchanged; ambient proxies stay off.
        self.opener = build_opener(ProxyHandler(proxies), NoRedirect(),
                                   HTTPSHandler(context=ssl.create_default_context()))

    def get(self, path, role, *, minimum_ledger=None):
        url = HORIZON + path
        require(path.startswith('/') and not path.startswith('//') and
                urlsplit(url).netloc == 'horizon-testnet.stellar.org',
                'EXPIRY_PROVIDER_ENDPOINT_INVALID')
        request = Request(url, headers={'Accept': 'application/json', 'Accept-Encoding': 'identity',
                                       'User-Agent': 'Starforge-Original-Expiry-Observer/1', 'Cache-Control': 'no-cache'})
        with self.opener.open(request, timeout=30) as response:
            require(response.status == 200 and response.geturl() == url,
                    'EXPIRY_PROVIDER_RESPONSE_INVALID')
            raw = response.read(MAX_HTTP + 1)
            require(len(raw) <= MAX_HTTP, 'EXPIRY_PROVIDER_RESPONSE_TOO_LARGE')
            received = now_utc().isoformat()
            content_type = response.headers.get('Content-Type', '').split(';')[0].strip()
            require(content_type in ('application/json', 'application/hal+json'),
                    'EXPIRY_PROVIDER_JSON_REQUIRED')
            latest_header = response.headers.get('Latest-Ledger')
            latest_ledger = int(latest_header) if latest_header and re.fullmatch(r'[0-9]{1,10}', latest_header) else None
            if minimum_ledger is not None:
                require(latest_ledger is not None and latest_ledger >= minimum_ledger,
                        'EXPIRY_ACCOUNT_RESPONSE_HISTORY_NOT_CURRENT')
            receipt = {'url': url, 'status': response.status, 'receivedAt': received,
                'latestLedger': latest_ledger,
                'contentType': content_type, 'bytes': len(raw), 'sha256': sha(raw)}
        filename = role + '-' + receipt['sha256'] + '.json'
        atomic(self.directory / filename, raw)
        self.captures.append({**receipt, 'file': filename})
        return decode(raw)

    def root(self, role):
        value = self.get('/', role)
        require(value.get('network_passphrase') == PASSPHRASE,
                'EXPIRY_PROVIDER_NETWORK_MISMATCH')
        current, history, ingest = (value.get('core_latest_ledger'),
            value.get('history_latest_ledger'), value.get('ingest_latest_ledger'))
        require(type(current) is int and type(history) is int and history > 0 and current >= history and
                (ingest is None or type(ingest) is int and ingest >= history),
                'EXPIRY_SYNCHRONIZED_HISTORY_REQUIRED')
        return {'core': current, 'history': history, 'ingest': ingest}

    def account(self, account, baseline_ledger, role, *, minimum_ledger, expected_sequence=None):
        value = self.get('/accounts/' + account, role + '-account', minimum_ledger=minimum_ledger)
        account_at_ledger = self.captures[-1]['latestLedger']
        require(value.get('account_id') == account and
                re.fullmatch(r'[0-9]{1,30}', value.get('sequence', '')) and
                type(value.get('last_modified_ledger')) is int,
                'EXPIRY_ORIGINAL_ACCOUNT_REQUIRED')
        modified_time = value.get('last_modified_time')
        if modified_time is None:
            ledger = self.get('/ledgers/' + str(value['last_modified_ledger']), role + '-modified-ledger')
            require(ledger.get('sequence') == value['last_modified_ledger'], 'EXPIRY_ACCOUNT_LEDGER_MISMATCH')
            modified_time = ledger.get('closed_at')
        require(value['last_modified_ledger'] <= baseline_ledger and
                (expected_sequence is None or value['sequence'] == expected_sequence),
                'EXPIRY_ACCOUNT_CHANGED_SINCE_ORIGINAL_CHAIN_BASELINE')
        path = '/accounts/' + account + '/transactions?order=desc&limit=200&include_failed=true'
        count, seen, newest, previous = 0, set(), None, None
        for page in range(MAX_HISTORY_PAGES):
            # Horizon historical transaction lists do not carry Latest-Ledger.
            # Fresh account states bracket this list; the original submitter's
            # unchanged sequence is the independent non-submission condition.
            data = self.get(path, role + '-transactions-' + str(page + 1))
            rows = data.get('_embedded', {}).get('records')
            require(isinstance(rows, list) and len(rows) <= 200, 'EXPIRY_ACCOUNT_HISTORY_INVALID')
            reached_before = False
            for row in rows:
                transaction = row.get('hash')
                paging = row.get('paging_token')
                created = as_time(row.get('created_at'))
                require(isinstance(transaction, str) and HASH.fullmatch(transaction) and
                        transaction not in seen and isinstance(paging, str) and
                        re.fullmatch(r'[0-9]{1,40}', paging) and
                        type(row.get('ledger')) is int and row['ledger'] > 0,
                        'EXPIRY_ACCOUNT_HISTORY_RECORD_INVALID')
                require(previous is None or int(paging) < previous,
                        'EXPIRY_ACCOUNT_HISTORY_NOT_CONTIGUOUS')
                require(row['ledger'] <= baseline_ledger, 'EXPIRY_ORIGINAL_ACCOUNT_HAS_LATER_TRANSACTION')
                seen.add(transaction);previous = int(paging);count += 1
                if newest is None:
                    newest = {'transaction': transaction, 'ledger': row['ledger'],
                              'createdAt': row['created_at']}
                reached_before = reached_before or row['ledger'] <= baseline_ledger
            # The original completed chain observation is the lower boundary.
            # The proof does not depend on the signing host's wall clock.
            if not rows or len(rows) < 200 or reached_before:
                history_at_ledger = self.captures[-1]['latestLedger']
                current = self.get('/accounts/' + account, role + '-account-after',
                    minimum_ledger=minimum_ledger)
                require(current.get('account_id') == account and
                        current.get('sequence') == value['sequence'] and
                        current.get('last_modified_ledger') == value['last_modified_ledger'],
                        'EXPIRY_ACCOUNT_CHANGED_DURING_HISTORY_OBSERVATION')
                return {'account': account, 'sequence': value['sequence'],
                    'lastModifiedLedger': value['last_modified_ledger'],
                    'lastModifiedTime': modified_time, 'records': count, 'pages': page + 1,
                    'coverage': 'ORIGINAL_ACCOUNT_HISTORY_WITH_BRACKETED_CURRENT_ACCOUNT_STATE',
                    'baselineLedger': baseline_ledger, 'accountObservedAtLedger': account_at_ledger,
                    'accountReobservedAtLedger': self.captures[-1]['latestLedger'],
                    'historyObservedAtLedger': history_at_ledger,
                    'absenceBasis': 'ORIGINAL_SUBMITTER_SEQUENCE_UNCHANGED' if expected_sequence is not None
                        else 'ORIGINAL_PAYER_ACCOUNT_STATE_UNCHANGED',
                    'newest': newest, 'transactionsAfterBaseline': 0}
            next_url = data.get('_links', {}).get('next', {}).get('href', '')
            parsed = urlsplit(next_url)
            query = parse_qs(parsed.query)
            require(parsed.scheme == 'https' and parsed.netloc == 'horizon-testnet.stellar.org' and
                    parsed.path == '/accounts/' + account + '/transactions' and
                    query.get('order') == ['desc'] and query.get('limit') == ['200'] and
                    query.get('include_failed') == ['true'] and query.get('cursor') == [str(previous)],
                    'EXPIRY_ACCOUNT_HISTORY_CURSOR_INVALID')
            path = parsed.path + '?' + parsed.query
        raise Denied('EXPIRY_ACCOUNT_HISTORY_LIMIT_REACHED')


def seal(governor, value):
    return {'schema': SCHEMA, 'value': value,
            'mac': hmac.new(governor.ok, canonical(value), hashlib.sha256).hexdigest()}


def unseal(governor, path):
    saved = read_source(path)
    require(saved.get('schema') == SCHEMA and type(saved.get('value')) is dict and
            isinstance(saved.get('mac'), str) and hmac.compare_digest(saved['mac'],
                hmac.new(governor.ok, canonical(saved['value']), hashlib.sha256).hexdigest()),
            'EXPIRY_RETAINED_OBSERVATION_AUTHENTICATION_FAILED')
    return saved['value']


def archived_observation(governor, directory, source_sha):
    value = unseal(governor, directory / 'observation.json')
    require(value['binding']['sourceSha256'] == source_sha, 'EXPIRY_OBSERVATION_SOURCE_CHANGED')
    for item in value['retainedFiles']:
        raw = raw_file(directory / item['file'])
        require(len(raw) == item['bytes'] and sha(raw) == item['sha256'],
                'EXPIRY_RETAINED_SOURCE_CHANGED')
    for item in value['captures']:
        raw = raw_file(directory / 'provider' / item['file'], MAX_HTTP)
        require(len(raw) == item['bytes'] and sha(raw) == item['sha256'],
                'EXPIRY_RETAINED_PROVIDER_RESPONSE_CHANGED')
    return value


def observe(governor, source_path, source, source_raw, directory, *, payer, ledger, policy, node, https_proxy=None):
    source_sha = sha(source_raw)
    saved_path = directory / 'observation.json'
    if saved_path.exists():
        return archived_observation(governor, directory, source_sha)
    request, binding, inputs, custody_raw = source_context(source_path, source, source_raw,
        payer=payer, ledger=ledger, policy=policy, node=node)
    current = governor.authorization(request)
    require(current['reservation']['state'] == 'reserved', 'EXPIRY_ORIGINAL_RESERVED_GENERATION_REQUIRED')
    binding['reservationGeneration'] = current['generation']
    retained = []
    mkdir(directory / 'source')
    for role, raw in {'descriptor': source_raw, 'custody': custody_raw, **inputs}.items():
        if raw is None:
            continue
        filename = 'source/' + role + '.bin'
        atomic(directory / filename, raw)
        retained.append({'file': filename, 'bytes': len(raw), 'sha256': sha(raw)})
    mkdir(directory / 'provider')
    provider = Observer(directory / 'provider', https_proxy=https_proxy)
    anchor = provider.get('/ledgers/' + str(binding['signingAnchorLedger']), 'signing-anchor')
    require(anchor.get('sequence') == binding['signingAnchorLedger'] and
            as_time(anchor.get('closed_at')) >= as_time(binding['executionStopped']['at']) and
            isinstance(anchor.get('hash'), str) and HASH.fullmatch(anchor['hash']),
            'EXPIRY_ANCHOR_MUST_FOLLOW_STOPPED_EXECUTION')
    before = provider.root('before')
    require(before['history'] > binding['expiryLedgerUpperBound'],
            'EXPIRY_AUTHORIZATION_STILL_WITHIN_LEDGER_WINDOW')
    baseline = binding['chainBaseline']
    prior = provider.get('/transactions/' + baseline['transaction'], 'original-prior-transaction')
    require(prior.get('hash') == baseline['transaction'] and prior.get('ledger') == baseline['transactionLedger'] and
            prior.get('successful') is True and prior.get('source_account') == source['feePayer'] and
            isinstance(prior.get('source_account_sequence'), str) and
            re.fullmatch(r'[0-9]{1,30}', prior['source_account_sequence']),
            'EXPIRY_PRIOR_NATIVE_TRANSACTION_MISMATCH')
    accounts = {}
    for role, account in (('fee-payer', source['feePayer']), ('payer', payer)):
        accounts[role] = provider.account(account, baseline['observedLedger'], role,
            minimum_ledger=before['history'],
            expected_sequence=prior['source_account_sequence'] if role == 'fee-payer' else None)
    require(accounts['fee-payer']['newest'] is not None and
            accounts['fee-payer']['newest']['transaction'] == baseline['transaction'],
            'EXPIRY_HISTORY_MUST_INCLUDE_ORIGINAL_PRIOR_SUBMISSION')
    after = provider.root('after')
    require(after['history'] >= before['history'] and after['core'] >= before['core'],
            'EXPIRY_PROVIDER_HISTORY_MOVED_BACKWARD')
    _, again, _, _ = source_context(source_path, source, source_raw, payer=payer, ledger=ledger, policy=policy, node=node)
    expected_binding = dict(binding);expected_binding.pop('reservationGeneration')
    require(again == expected_binding and governor.authorization(request) == current,
            'EXPIRY_ORIGINAL_GENERATION_CHANGED_DURING_OBSERVATION')
    value = {'schema': SCHEMA, 'profile': PROFILE, 'binding': binding,
        'approvedRequest': request, 'networkPassphrase': PASSPHRASE,
        'anchor': {'ledger': anchor['sequence'], 'hash': anchor['hash'], 'closedAt': anchor['closed_at']},
        'authorization': {'kind': 'SOURCE_BOUND_UPPER_BOUND',
            'upperExpiryLedger': binding['expiryLedgerUpperBound'],
            'observedHistoryLedger': before['history'],
            'rule': 'original signing currentLedger + ceil(maxTimeoutSeconds / positive integral estimate); estimate >= 1',
            'signatureValidThroughUpperBoundInclusive': True},
        'before': before, 'after': after, 'accounts': accounts,
        'captures': provider.captures, 'retainedFiles': retained,
        'observedAt': now_utc().isoformat()}
    require(raw_file(source_path) == source_raw, 'EXPIRY_ORIGINAL_DESCRIPTOR_CHANGED')
    json_write(saved_path, seal(governor, value))
    return value


def release_event(governor, request, generation, proof_sha):
    """Authenticate the retained release even after its same request is resumed."""
    governor.db.execute('BEGIN')
    try:
        ledger = governor._audit()
        require(request['request_id'] in ledger, 'EXPIRY_ORIGINAL_RESERVATION_MISSING')
        result = None
        generation_seen = False
        predecessor = None
        for serialized, mac in governor.db.execute('SELECT event,mac FROM journal ORDER BY sequence'):
            event = json.loads(serialized)
            if mac == generation:
                require(not generation_seen, 'EXPIRY_DUPLICATE_RESERVATION_GENERATION')
                generation_seen = True
                if event.get('type') == 'resume_expired':
                    require(event.get('request_id') == request['request_id'] and
                            event.get('request_digest') == sha(canonical(request)),
                            'EXPIRY_RESERVATION_GENERATION_MISMATCH')
                    predecessor = event['release_journal_mac']
                else:
                    require(event.get('type') == 'reserve' and
                            event.get('reservation', {}).get('request_id') == request['request_id'],
                            'EXPIRY_RESERVATION_GENERATION_MISMATCH')
            if event.get('type') != 'expire_untransferred':
                continue
            claim = event['attestation']
            if claim['request_id'] == request['request_id'] and claim['reservation_generation'] == generation:
                require(claim['request_digest'] == sha(canonical(request)) and
                        claim['proof_sha256'] == proof_sha, 'EXPIRY_RELEASE_HISTORY_CONFLICT')
                require(result is None, 'EXPIRY_DUPLICATE_RELEASE_HISTORY')
                result = {'release_journal_mac': mac, 'attestation': claim}
        require(generation_seen, 'EXPIRY_ORIGINAL_RESERVATION_GENERATION_MISSING')
        if result is not None:
            result['previous_release_journal_mac'] = predecessor
        governor.db.execute('COMMIT')
        return result
    except BaseException:
        governor.db.execute('ROLLBACK')
        raise


def summary(governor, value, directory):
    request = value['approvedRequest'];proof_sha = sha(canonical(value))
    released = release_event(governor, request, value['binding']['reservationGeneration'], proof_sha)
    current = governor.authorization(request)
    return {'schema': SCHEMA, 'outcome': 'EXPIRED_AUTHORIZATION_RELEASED' if released else 'EXPIRED_UNTRANSFERRED_OBSERVED',
        'request_id': request['request_id'], 'request_sha256': sha(canonical(request)),
        'source_sha256': value['binding']['sourceSha256'],
        'generation': value['binding']['reservationGeneration'],
        'proof_sha256': proof_sha, 'observation': str(directory / 'observation.json'),
        'state': current['reservation']['state'], 'current_generation': current['generation'],
        'release_journal_mac': released['release_journal_mac'] if released else None,
        'previous_release_journal_mac': released['previous_release_journal_mac'] if released else None,
        'authorization_expiry_upper_bound': value['authorization']['upperExpiryLedger'],
        'observed_history_ledger': value['authorization']['observedHistoryLedger'],
        'actual': '0' if released else None,
        'released_atomic_units': request['max_amount'] if released else None}


def execute(args):
    source_path = args.source
    source_raw = raw_file(source_path)
    source = decode(source_raw)
    source_sha = sha(source_raw)
    check_ledger_path(args.ledger)
    private_path(args.ledger)
    private_path(args.reports, directory=True)
    require(isinstance(args.expected_request_sha, str) and HASH.fullmatch(args.expected_request_sha) and
            sha(canonical(validate_request(source.get('approvedRequest')))) == args.expected_request_sha,
            'EXPIRY_REVIEWED_ORIGINAL_REQUEST_REQUIRED')
    directory = args.reports / source_sha
    if args.action != 'read':
        mkdir(directory)
    else:
        private_path(directory, directory=True)
    keys = [key_from_environment('SF36_' + name + '_KEY_B64') for name in ('CONSENT', 'AUDIT', 'OPERATOR')]
    with original_approval_lock(args.ledger):
        governor = Governor(args.ledger, read_source(args.policy, private=False), *keys)
        try:
            if args.action == 'read':
                value = archived_observation(governor, directory, source_sha)
            else:
                value = observe(governor, source_path, source, source_raw, directory, payer=args.payer,
                                ledger=args.ledger, policy=args.policy, node=args.node,
                                https_proxy=getattr(args, 'https_proxy', None))
            request = value['approvedRequest']
            proof_sha = sha(canonical(value))
            if args.action == 'release':
                # Original files are still present until the caller has this
                # authenticated release. Reopening an already released result
                # uses its sealed original archive after the same-source rename.
                existing = release_event(governor, request, value['binding']['reservationGeneration'], proof_sha)
                if not existing:
                    _, binding, _, _ = source_context(source_path, source, source_raw,
                        payer=args.payer, ledger=args.ledger, policy=args.policy, node=args.node)
                    expected = dict(value['binding']);expected.pop('reservationGeneration')
                    require(binding == expected, 'EXPIRY_ORIGINAL_SOURCE_CHANGED_BEFORE_RELEASE')
                    claim = issue_expired_authorization_attestation(governor.ok,
                        request_id=request['request_id'], request_digest=args.expected_request_sha,
                        reservation_generation=value['binding']['reservationGeneration'],
                        network=request['network'], expiry_ledger=value['authorization']['upperExpiryLedger'],
                        observed_ledger=value['authorization']['observedHistoryLedger'], proof_sha256=proof_sha)
                    governor.release_expired_authorization(claim)
            result = summary(governor, value, directory)
            if args.action == 'permit':
                require(args.resume_permit_file is not None and result['release_journal_mac'] is not None,
                        'EXPIRY_ORIGINAL_RELEASE_AND_PRIVATE_PERMIT_PATH_REQUIRED')
                private_path(args.resume_permit_file.parent, directory=True)
                expiry = (now_utc() + timedelta(minutes=10)).isoformat()
                token = governor.issue_expired_resume_permit(request, proof_sha256=proof_sha, expiry_utc=expiry)
                permit = {'schema': PERMIT_SCHEMA, 'request_id': request['request_id'],
                    'request_sha256': args.expected_request_sha, 'proof_sha256': proof_sha,
                    'release_journal_mac': result['release_journal_mac'], 'expires_at': expiry, 'token': token}
                raw = canonical(permit) + b'\n'
                json_write(args.resume_permit_file, permit, replace=True)
                result['resumePermit'] = {'file': str(args.resume_permit_file),
                    'sha256': sha(raw), 'bytes': len(raw), 'expiresAt': expiry}
            return result
        finally:
            governor.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('observe', 'release', 'read', 'permit'))
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--ledger', type=Path, required=True)
    parser.add_argument('--policy', type=Path, required=True)
    parser.add_argument('--payer', required=True)
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--https-proxy', help='Explicit operator-selected HTTP(S) CONNECT proxy; default direct TLS')
    parser.add_argument('--expected-request-sha', required=True)
    parser.add_argument('--reports', type=Path, required=True)
    parser.add_argument('--resume-permit-file', type=Path)
    args = parser.parse_args(argv)
    os.umask(0o077)
    try:
        require(bool(args.resume_permit_file) == (args.action == 'permit'),
                'EXPIRY_PERMIT_PATH_REQUIRES_EXPLICIT_PERMIT_ACTION')
        result = execute(args)
        print(json.dumps(result, sort_keys=True, ensure_ascii=True), flush=True)
        return 0
    except (Denied, OSError, sqlite3.Error, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        code = str(error) if isinstance(error, Denied) else 'EXPIRY_SOURCE_OR_PROVIDER_IO_FAILED'
        print(json.dumps({'schema': SCHEMA, 'outcome': 'EXPIRY_CONTINUATION_ERROR', 'code': code}),
              flush=True)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
