"""Bind one original direct Node Buyer attempt to the existing SF36 finalizer.

The fixed offline Node reader calls the original Operation._bound(), including
request-body, operation-ticket and immutable continuation bindings. Python
independently verifies original private files, workspace trust, approved request
and audited reservation. Observation, sealing and reconciliation are delegated
to the unchanged shared lost-output engine.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import subprocess

from governor import ID_PATTERN, as_time, canonical, parse_amount, validate_request
from finalize import HASH, NETWORKS, decode, private_path
from lost_output_finality import evidence_state, finalize_lost_output, raw_file, require

SOURCE_SCHEMA = 'stellar-forge.sf88.lost-output-source.v1'
CONTEXT_SCHEMA = 'stellar-forge.sf36.node-attempt-context.v1'
NATIVE_CONTEXT = Path(__file__).with_name('node_context.mjs')
EMPTY_SHA = hashlib.sha256(b'').hexdigest()


def inspect_native_node(node, state_directory, intent_id, *, use_system_ca=False):
    require(type(use_system_ca) is bool, 'INVALID_OBSERVER_SYSTEM_CA_OPTION')
    result = subprocess.run(
        [node, *(['--use-system-ca'] if use_system_ca else []), str(NATIVE_CONTEXT)],
        input=canonical({'stateDirectory': str(state_directory), 'intentId': intent_id}),
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env={'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'}, timeout=60, check=False)
    require(len(result.stdout) <= 4_000_000, 'NODE_CONTEXT_RESULT_TOO_LARGE')
    parsed = decode(result.stdout)
    error = parsed.get('error')
    require(result.returncode == 0 and not error and parsed.get('schema') == CONTEXT_SCHEMA,
            error if isinstance(error, str) and re.fullmatch(r'[A-Z0-9_]{1,120}', error)
            else 'ORIGINAL_NODE_CONTEXT_INVALID')
    return parsed


def optional_identity(path, limit, *, classify_json=False):
    if not os.path.lexists(path):
        return {'condition': 'ABSENT', 'bytes': 0, 'sha256': None}
    private_path(path)
    if classify_json:
        raw = raw_file(path, limit)
        condition = 'EMPTY' if not raw else 'INVALID_JSON'
        if raw:
            try:
                json.loads(raw.decode('utf8'))
                condition = 'JSON'
            except (ValueError, UnicodeError):
                pass
        return {'condition': condition, 'bytes': len(raw),
                'sha256': hashlib.sha256(raw).hexdigest()}
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as reader:
        before = os.fstat(reader.fileno())
        require(before.st_size <= limit, 'NODE_CONTEXT_SOURCE_TOO_LARGE')
        digest, size = hashlib.sha256(), 0
        while True:
            chunk = reader.read(65536)
            if not chunk:
                break
            size += len(chunk)
            require(size <= limit, 'NODE_CONTEXT_SOURCE_TOO_LARGE')
            digest.update(chunk)
        after = os.fstat(reader.fileno())
        require(size == before.st_size == after.st_size and before.st_mtime_ns == after.st_mtime_ns,
                'NODE_CONTEXT_SOURCE_CHANGED')
    return {'condition': 'SAVED' if size else 'EMPTY', 'bytes': size,
            'sha256': digest.hexdigest()}


def node_source_context(source_path, source, governor, payer, ledger, policy, *,
                        node, use_system_ca=False):
    require(source.get('schema') == SOURCE_SCHEMA and source.get('sourceKind') == 'node-operation',
            'NODE_LOST_OUTPUT_SOURCE_SCHEMA_INVALID')
    intent, transaction, request_sha = source.get('intentId'), source.get('transaction'), source.get('requestSha256')
    require(isinstance(intent, str) and ID_PATTERN.fullmatch(intent) and
            isinstance(transaction, str) and HASH.fullmatch(transaction) and
            isinstance(request_sha, str) and HASH.fullmatch(request_sha),
            'LOST_OUTPUT_TRANSACTION_AND_DIGEST_REQUIRED')
    state, workspace = Path(source['stateDirectory']), Path(source['workspace'])
    private_path(state, directory=True)
    private_path(workspace, directory=True)
    operation = state / hashlib.sha256(intent.encode('utf8')).hexdigest()
    directory = operation / 'lost-output'
    private_path(operation, directory=True)
    private_path(directory, directory=True)
    require(str(operation) == source.get('operationDirectory') and
            source_path == directory / (transaction + '.source.json'),
            'NODE_LOST_OUTPUT_SOURCE_LOCATION_INVALID')
    source_raw = raw_file(source_path)
    require(decode(source_raw) == source and decode(raw_file(directory / 'selection.json')) == source,
            'NODE_LOST_OUTPUT_SELECTION_CHANGED')
    paths = {'configuration': operation / 'config.json', 'operation': operation / 'operation.json',
             'attempt': operation / 'attempt.json', 'workspaceConfig': workspace / 'operator.json',
             'workspaceManifest': workspace / 'workspace.json'}
    data, hashes = {}, {}
    for name, path in paths.items():
        raw = raw_file(path, 16384 if name == 'attempt' else 262144)
        hashes[name] = hashlib.sha256(raw).hexdigest()
        data[name] = decode(raw)
    cfg, meta, attempt = data['configuration'], data['operation'], data['attempt']
    active, manifest = data['workspaceConfig'], data['workspaceManifest']
    op, owner, expected = cfg['operation'], cfg['operator'], cfg['operation']['expect']
    native = inspect_native_node(node, state, intent, use_system_ca=use_system_ca)
    require(meta.get('schema') == 'stellar-forge.node-buyer.v1' and meta.get('state') == 'PREPARED' and
            meta.get('intentId') == op.get('intentId') == attempt.get('intentId') == intent and
            attempt.get('schema') == meta['schema'] and attempt.get('kind') is None and
            native.get('sourceKind') == 'node-operation' and native.get('intentId') == intent and
            native.get('stateDirectory') == str(state) and native.get('operationDirectory') == str(operation) and
            native.get('runtimeDirectory') == meta.get('runtimeDirectory') == source.get('runtimeDirectory') and
            native.get('attemptId') == hashes['attempt'] == source.get('attemptId') and
            native.get('configSha256') == hashes['configuration'] == meta.get('configSha256') ==
            attempt.get('configSha256') == source.get('configSha256'),
            'NODE_LOST_OUTPUT_ORIGINAL_ATTEMPT_MISMATCH')
    started = attempt.get('startedAt', attempt.get('createdAt'))
    as_time(started)
    require(native.get('attemptStartedAt') == started and native.get('attemptState') == attempt.get('state'),
            'NODE_LOST_OUTPUT_ATTEMPT_TIME_MISMATCH')
    require(manifest.get('directory') == str(workspace) and manifest.get('config') == 'operator.json' and
            manifest.get('keys') == 'operator-keys.json' and
            all(owner.get(key) == active['operator'].get(key) for key in ('python', 'actor', 'service', 'ledger', 'policy')) and
            owner.get('ledger') == str(ledger) == str(workspace / 'reservations.sqlite') and
            owner.get('policy') == str(policy) == str(workspace / 'policy.json') and
            cfg.get('signerModule') == active.get('signerModule') == str(workspace / 'signer.mjs') and
            cfg.get('trustedPayer') == active.get('trustedPayer') == manifest.get('payer') == payer and
            cfg.get('buyerTransport') == active.get('buyerTransport') == manifest.get('buyerTransport') and
            meta.get('nativeWorkspace') in (None, str(workspace)),
            'NODE_LOST_OUTPUT_ORIGINAL_WORKSPACE_MISMATCH')
    signer = manifest['signer']
    require(all(expected.get(key) == active['operation']['expect'].get(key) for key in ('scheme', 'network', 'asset', 'payTo')) and
            all(expected.get(key) == signer.get(key) for key in ('network', 'asset', 'payTo')) and
            signer.get('expectedPayer') == payer and expected.get('network') == manifest.get('network') and
            expected.get('network') in NETWORKS and expected.get('scheme') == 'exact' and
            re.fullmatch(r'C[A-Z2-7]{55}', expected.get('asset', '')) and
            re.fullmatch(r'[GC][A-Z2-7]{55}', expected.get('payTo', '')),
            'NODE_LOST_OUTPUT_TRUSTED_TERMS_MISMATCH')
    evidence_directory = operation / 'evidence'
    private_path(evidence_directory, directory=True)
    evidence_path = evidence_directory / (hashlib.sha256(intent.encode('utf8')).hexdigest() + '.json')
    require(cfg.get('evidenceDir') == str(evidence_directory) and native.get('evidencePath') == str(evidence_path),
            'NODE_LOST_OUTPUT_EVIDENCE_PATH_MISMATCH')
    loss = evidence_state(evidence_path)
    hashes['evidence'] = loss['sha256']
    require(source.get('evidenceState') == native.get('evidenceState') == loss,
            'NODE_LOST_OUTPUT_EVIDENCE_CHANGED')
    body_present = op.get('bodyFile') is not None
    if body_present:
        require(op['bodyFile'] == str(operation / 'request.body'), 'NODE_LOST_OUTPUT_BODY_PATH_MISMATCH')
        body = raw_file(operation / 'request.body', 1_048_576)
        hashes['body'] = hashlib.sha256(body).hexdigest()
    else:
        body, hashes['body'] = b'', None
    body_sha = hashlib.sha256(body).hexdigest()
    require(meta.get('bodySha256') == attempt.get('bodySha256') == native.get('bodySha256') == body_sha and
            native.get('bodyPresent') == body_present and native.get('bodyBytes') == len(body),
            'NODE_LOST_OUTPUT_ORIGINAL_BODY_MISMATCH')
    if op.get('ticketFile') is not None:
        require(op['ticketFile'] == str(operation / 'operation-ticket.json'), 'NODE_LOST_OUTPUT_TICKET_PATH_MISMATCH')
        hashes['ticket'] = hashlib.sha256(raw_file(operation / 'operation-ticket.json', 16384)).hexdigest()
    else:
        hashes['ticket'] = None
    require(meta.get('ticketSha256') == native.get('ticketSha256') == hashes['ticket'],
            'NODE_LOST_OUTPUT_ORIGINAL_TICKET_MISMATCH')
    local_outcome = {}
    for name, filename in (('stdout', 'stdout.json'), ('stderr', 'stderr.log'), ('result', 'result.json')):
        local_outcome[name] = optional_identity(operation / filename,
            16_777_216 if name == 'result' else 33_554_432, classify_json=name == 'result')
        hashes[name] = local_outcome[name]['sha256']
    if cfg.get('responseFile') is not None:
        download = cfg['responseFile']
        require(download.get('destination') == str(operation / 'response.bin') and
                type(download.get('maxBytes', 64 * 1024 * 1024)) is int and
                0 < download.get('maxBytes', 64 * 1024 * 1024) <= 9_007_199_254_740_991,
                'NODE_LOST_OUTPUT_RESPONSE_PATH_MISMATCH')
        local_outcome['response'] = optional_identity(operation / 'response.bin', download.get('maxBytes', 64 * 1024 * 1024))
        hashes['response'] = local_outcome['response']['sha256']
    require(source.get('localOutcome') == native.get('localOutcome') == local_outcome and
            source.get('transportCheckpointSha256') == native.get('transportCheckpointSha256'),
            'NODE_LOST_OUTPUT_LOCAL_OUTCOME_CHANGED')
    require(native.get('sourceHashes') == {key: value for key, value in hashes.items()
            if key not in ('workspaceConfig', 'workspaceManifest')} and source.get('sourceHashes') == hashes,
            'NODE_LOST_OUTPUT_SOURCE_HASHES_CHANGED')
    preimage = validate_request(source.get('approvedRequest'))
    require(hmac.compare_digest(hashlib.sha256(canonical(preimage)).hexdigest(), request_sha),
            'LOST_OUTPUT_APPROVED_REQUEST_DIGEST_MISMATCH')
    row = governor.reservation(preimage)
    require(row['state'] in ('reserved', 'settled') and row['scheme'] == 'exact' and
            row['actor'] == owner['actor'] and row['service'] == owner['service'] and
            all(row[key] == expected[key] for key in ('network', 'asset')) and
            0 < parse_amount(row['amount']) <= parse_amount(expected['maxAtomic']),
            'LOST_OUTPUT_AUDITED_RESERVATION_TERMS_MISMATCH')
    require(preimage['request_id'] == intent and preimage['actor'] == owner['actor'] and
            preimage['service'] == owner['service'] and preimage['resource'] == op['url'] and
            preimage['method'] == op['method'] and preimage['pay_to'] == expected['payTo'] and
            preimage['max_amount'] == row['amount'] and
            all(preimage[key] == row[key] for key in ('network', 'asset', 'scheme')) and
            preimage['body_present'] == body_present and preimage['body_bytes'] == len(body) and
            preimage['body_sha256'] == body_sha,
            'LOST_OUTPUT_RETAINED_REQUEST_PREIMAGE_MISMATCH')
    if expected.get('maxTimeoutSeconds') is not None:
        require(type(expected['maxTimeoutSeconds']) is int and
                1 <= preimage['max_timeout_seconds'] <= expected['maxTimeoutSeconds'],
                'LOST_OUTPUT_APPROVED_TIMEOUT_MISMATCH')
    binding = {key: source[key] for key in (
        'sourceKind', 'stateDirectory', 'operationDirectory', 'runtimeDirectory', 'workspace',
        'intentId', 'attemptId', 'configSha256', 'requestSha256', 'transaction',
        'sourceHashes', 'evidenceState', 'localOutcome', 'transportCheckpointSha256')}
    binding.update(sourcePath=str(source_path), sourceSha256=hashlib.sha256(source_raw).hexdigest(),
        attemptStartedAt=started, evidencePath=str(evidence_path),
        evidenceStatus=loss['condition'] + '_ORIGINAL_OUTPUT',
        requestBinding='EXACT_ORIGINAL_PREIMAGE_AND_HMAC_RESERVATION_VERIFIED')
    terms = {'network': row['network'], 'asset': row['asset'], 'amount': row['amount'],
             'payTo': expected['payTo'], 'payer': payer}
    return binding, terms, row, directory


def finalize_node_lost_output(governor, source_path, source, payer, *,
                              node, ledger, policy, **options):
    def context(path, value, original_governor, original_payer, original_ledger, original_policy):
        return node_source_context(path, value, original_governor, original_payer,
            original_ledger, original_policy, node=node,
            use_system_ca=options.get('use_system_ca', False))
    return finalize_lost_output(governor, source_path, source, payer, node=node,
        ledger=ledger, policy=policy, context_reader=context, **options)
