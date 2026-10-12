"""Finalize an existing original Dataset page through the SF36 lost-output path.

The original session definition, page configuration and permanent attempt marker
remain the native source. A fixed offline Node reader calls the original SF88
definition/page builders, retaining their URL and canonical-JSON semantics.
Python independently verifies the private bytes, original buyer workspace,
approved request and HMAC reservation before the shared sealed observation.
"""
from __future__ import annotations

import hashlib
import hmac
import os
from pathlib import Path
import re
import subprocess

from governor import Denied, ID_PATTERN, as_time, canonical, parse_amount, validate_request
from finalize import HASH, NETWORKS, decode, private_path
from lost_output_finality import (
    evidence_state, finalize_lost_output, raw_file, require,
)

SOURCE_SCHEMA = 'stellar-forge.sf88.lost-output-source.v1'
CONTEXT_SCHEMA = 'stellar-forge.sf36.dataset-attempt-context.v1'
NATIVE_CONTEXT = Path(__file__).with_name('dataset_context.mjs')
EMPTY_SHA256 = hashlib.sha256(b'').hexdigest()


def inspect_native_attempt(node, directory, index, *, use_system_ca=False):
    """Call the original complete page reader through one fixed native entry."""
    require(type(use_system_ca) is bool, 'INVALID_OBSERVER_SYSTEM_CA_OPTION')
    result = subprocess.run(
        [node, *(['--use-system-ca'] if use_system_ca else []), str(NATIVE_CONTEXT)],
        input=canonical({'directory': str(directory), 'index': index}),
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env={'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'}, timeout=60, check=False)
    require(len(result.stdout) <= 4_000_000, 'DATASET_CONTEXT_RESULT_TOO_LARGE')
    parsed = decode(result.stdout)
    error = parsed.get('error')
    if isinstance(error, str) and re.fullmatch(r'[A-Z0-9_]{1,120}', error):
        raise Denied(error)
    require(result.returncode == 0 and not error and parsed.get('schema') == CONTEXT_SCHEMA,
            'ORIGINAL_DATASET_CONTEXT_INVALID')
    return parsed

def retained_response(path, limit):
    """Retain response identity independently of payment and page acceptance."""
    require(type(limit) is int and 1024 <= limit <= 16_777_216,
            'DATASET_CONTEXT_RESPONSE_LIMIT_INVALID')
    if not os.path.lexists(path):
        return {'condition': 'ABSENT', 'bytes': 0, 'sha256': None}
    raw = raw_file(path, limit)
    return {'condition': 'SAVED' if raw else 'EMPTY', 'bytes': len(raw),
            'sha256': hashlib.sha256(raw).hexdigest()}


def dataset_source_context(source_path, source, governor, payer, ledger, policy,
                           *, node, use_system_ca=False):
    require(source.get('schema') == SOURCE_SCHEMA and source.get('sourceKind') == 'dataset',
            'DATASET_LOST_OUTPUT_SOURCE_SCHEMA_INVALID')
    intent, index = source.get('intentId'), source.get('pageIndex')
    require(isinstance(intent, str) and ID_PATTERN.fullmatch(intent) and
            type(index) is int and 1 <= index <= 10000,
            'DATASET_LOST_OUTPUT_ATTEMPT_SELECTION_INVALID')
    transaction, digest = source.get('transaction'), source.get('requestSha256')
    require(isinstance(transaction, str) and HASH.fullmatch(transaction) and
            isinstance(digest, str) and HASH.fullmatch(digest),
            'LOST_OUTPUT_TRANSACTION_AND_DIGEST_REQUIRED')
    session, workspace = Path(source['sessionDirectory']), Path(source['workspace'])
    private_path(session, directory=True)
    private_path(workspace, directory=True)
    private_path(session / 'pages', directory=True)
    private_path(session / 'evidence', directory=True)
    page = session / 'pages' / f'{index:06d}'
    directory = page / 'lost-output'
    private_path(page, directory=True)
    private_path(directory, directory=True)
    require(source_path == directory / (transaction + '.source.json'),
            'DATASET_LOST_OUTPUT_SOURCE_LOCATION_INVALID')
    source_raw = raw_file(source_path)
    require(decode(source_raw) == source, 'LOST_OUTPUT_SOURCE_CHANGED')
    paths = {
        'session': session / 'session.json',
        'configuration': page / 'config.json',
        'attempt': page / 'attempt.json',
        'workspaceConfig': workspace / 'operator.json',
        'workspaceManifest': workspace / 'workspace.json',
    }
    data, hashes = {}, {'body': None}
    for name, path in paths.items():
        raw = raw_file(path, 262144 if name != 'attempt' else 8192)
        hashes[name] = hashlib.sha256(raw).hexdigest()
        data[name] = decode(raw)
    definition, cfg, attempt = data['session'], data['configuration'], data['attempt']
    active, manifest = data['workspaceConfig'], data['workspaceManifest']
    native = inspect_native_attempt(node, session, index, use_system_ca=use_system_ca)
    require(native.get('intentId') == intent and native.get('index') == index and
            native.get('attemptId') == source.get('attemptId') == hashes['attempt'] and
            native.get('pageConfigurationSha256') == attempt.get('configurationSha256') and
            native.get('sessionConfigurationSha256') == definition.get('configurationSha256') and
            hashes['configuration'] == source.get('configSha256') and
            native.get('attemptStartedAt') == attempt.get('startedAt') and
            native.get('workspaceDirectory') in (None, str(workspace)),
            'DATASET_LOST_OUTPUT_ORIGINAL_ATTEMPT_MISMATCH')
    as_time(attempt['startedAt'])
    # The original reader checked every preceding native page and cursor.
    # Re-read exactly those fixed private paths here, so its validated hashes
    # must describe the same original bytes as this authority-bearing context.
    for number in range(1, index):
        previous_page = session / 'pages' / f'{number:06d}'
        private_path(previous_page, directory=True)
        prefix = f'previous.{number:06d}.'
        for name, filename, limit in (
                ('configuration', 'config.json', 262144),
                ('attempt', 'attempt.json', 8192),
                ('response', 'response.json', definition['limits']['maxPageBytes'])):
            raw = raw_file(previous_page / filename, limit)
            hashes[prefix + name] = hashlib.sha256(raw).hexdigest()
    native_hashes = native.get('sourceHashes')
    require(isinstance(native_hashes, dict), 'DATASET_CONTEXT_SOURCE_HASHES_REQUIRED')
    op, owner, expected = cfg['operation'], cfg['operator'], cfg['operation']['expect']
    require(op.get('intentId') == intent and op.get('method') == 'GET' and
            'bodyFile' not in op and native.get('requestMethod') == 'GET' and
            native.get('requestUrl') == op.get('url') and native.get('requestBodyPresent') is False,
            'DATASET_LOST_OUTPUT_ORIGINAL_REQUEST_MISMATCH')
    require(manifest.get('directory') == str(workspace) and manifest.get('config') == 'operator.json' and
            manifest.get('keys') == 'operator-keys.json' and
            all(owner.get(key) == active['operator'].get(key)
                for key in ('python', 'actor', 'service', 'ledger', 'policy')) and
            owner.get('ledger') == str(ledger) == str(workspace / 'reservations.sqlite') and
            owner.get('policy') == str(policy) == str(workspace / 'policy.json') and
            definition['config'].get('evidenceDir') == active.get('evidenceDir') == str(workspace / 'evidence') and
            cfg.get('evidenceDir') == native.get('evidenceDirectory') == str(session / 'evidence') and
            cfg.get('signerModule') == active.get('signerModule') == str(workspace / 'signer.mjs') and
            cfg.get('trustedPayer') == active.get('trustedPayer') == manifest.get('payer') == payer and
            cfg.get('buyerTransport') == active.get('buyerTransport') == manifest.get('buyerTransport'),
            'DATASET_LOST_OUTPUT_ORIGINAL_WORKSPACE_MISMATCH')
    signer = manifest['signer']
    require(all(expected.get(key) == active['operation']['expect'].get(key)
                for key in ('scheme', 'network', 'asset', 'payTo')) and
            all(expected.get(key) == signer.get(key) for key in ('network', 'asset', 'payTo')) and
            signer.get('expectedPayer') == payer and expected.get('network') == manifest.get('network') and
            expected.get('network') in NETWORKS and expected.get('scheme') == 'exact' and
            re.fullmatch(r'C[A-Z2-7]{55}', expected.get('asset', '')) and
            re.fullmatch(r'[GC][A-Z2-7]{55}', expected.get('payTo', '')),
            'DATASET_LOST_OUTPUT_TRUSTED_TERMS_MISMATCH')
    evidence_path = session / 'evidence' / (hashlib.sha256(intent.encode('utf8')).hexdigest() + '.json')
    loss = evidence_state(evidence_path)
    require(source.get('evidenceState') == loss, 'LOST_OUTPUT_ORIGINAL_EVIDENCE_CHANGED')
    hashes['evidence'] = loss['sha256']
    response_path = page / 'response.json'
    require(cfg['responseFile'].get('destination') == native.get('responsePath') == str(response_path),
            'DATASET_LOST_OUTPUT_RESPONSE_PATH_MISMATCH')
    response = retained_response(response_path, definition['limits']['maxPageBytes'])
    require(source.get('responseState') == response == native.get('responseState'),
            'DATASET_LOST_OUTPUT_ORIGINAL_RESPONSE_CHANGED')
    hashes['response'] = response['sha256']
    expected_native_hashes = {key: value for key, value in hashes.items()
                             if key in ('session', 'configuration', 'attempt', 'response') or
                             key.startswith('previous.')}
    require(native_hashes == expected_native_hashes, 'DATASET_CONTEXT_SOURCE_CHANGED_DURING_READ')
    require(source.get('sourceHashes') == hashes, 'LOST_OUTPUT_SOURCE_HASHES_CHANGED')
    preimage = validate_request(source.get('approvedRequest'))
    approved_sha = hashlib.sha256(canonical(preimage)).hexdigest()
    require(hmac.compare_digest(approved_sha, digest), 'LOST_OUTPUT_APPROVED_REQUEST_DIGEST_MISMATCH')
    row = governor.reservation(preimage)
    require(row['state'] in ('reserved', 'settled') and row['scheme'] == 'exact' and
            row['actor'] == owner['actor'] and row['service'] == owner['service'] and
            all(row[key] == expected[key] for key in ('network', 'asset')) and
            0 < parse_amount(row['amount']) <= parse_amount(expected['maxAtomic']),
            'LOST_OUTPUT_AUDITED_RESERVATION_TERMS_MISMATCH')
    require(preimage['request_id'] == intent and preimage['actor'] == owner['actor'] and
            preimage['service'] == owner['service'] and preimage['resource'] == op['url'] and
            preimage['method'] == 'GET' and preimage['pay_to'] == expected['payTo'] and
            preimage['max_amount'] == row['amount'] and
            all(preimage[key] == row[key] for key in ('network', 'asset', 'scheme')) and
            preimage['body_present'] is False and preimage['body_bytes'] == 0 and
            preimage['body_sha256'] == EMPTY_SHA256,
            'LOST_OUTPUT_RETAINED_REQUEST_PREIMAGE_MISMATCH')
    if expected.get('maxTimeoutSeconds') is not None:
        timeout = expected['maxTimeoutSeconds']
        require(type(timeout) is int and 1 <= preimage['max_timeout_seconds'] <= timeout,
                'LOST_OUTPUT_APPROVED_TIMEOUT_MISMATCH')
    binding = {key: source[key] for key in (
        'sourceKind', 'sessionDirectory', 'pageIndex', 'workspace', 'intentId', 'attemptId',
        'configSha256', 'requestSha256', 'transaction', 'sourceHashes', 'evidenceState', 'responseState')}
    binding.update(
        sourcePath=str(source_path), sourceSha256=hashlib.sha256(source_raw).hexdigest(),
        attemptStartedAt=attempt['startedAt'],
        evidencePath=str(evidence_path), evidenceStatus=loss['condition'] + '_ORIGINAL_OUTPUT',
        requestBinding='EXACT_ORIGINAL_PREIMAGE_AND_HMAC_RESERVATION_VERIFIED')
    terms = {'network': row['network'], 'asset': row['asset'], 'amount': row['amount'],
             'payTo': expected['payTo'], 'payer': payer}
    return binding, terms, row, directory


def finalize_dataset_lost_output(governor, source_path, source, payer, *,
                                node, ledger, policy, **options):
    def context(path, value, original_governor, original_payer, original_ledger, original_policy):
        return dataset_source_context(
            path, value, original_governor, original_payer, original_ledger, original_policy,
            node=node, use_system_ca=options.get('use_system_ca', False))
    return finalize_lost_output(
        governor, source_path, source, payer, node=node, ledger=ledger, policy=policy,
        context_reader=context, **options)
