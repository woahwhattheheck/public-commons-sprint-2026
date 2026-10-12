"""Recover an original SF36 charge whose native output was lost after approval.

The original SF88 request, execution, attempt and private workspace remain
authoritative. The caller supplies the exact approved-request preimage; its
digest must authenticate against the original HMAC journal. This branch records
the exact absent, empty or invalid SF82 output and observes the selected transaction with the
original SF43 adapter. It retains a sealed observation before original reconcile
and a separate sealed completion afterward.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import tempfile

from governor import Denied, ID_PATTERN, as_time, canonical, issue_finality_attestation, now_utc, parse_amount, validate_request
from finalize import HASH, NETWORKS, SCHEMA, decode, private_path, read_source, run_adapter

SOURCE_SCHEMA = 'stellar-forge.sf88.lost-output-source.v1'
PROOF_SCHEMA = 'stellar-forge.sf36.lost-output-proof.v1'
RECOVERY_SCHEMA = 'stellar-forge.sf36.lost-output-recovery.v1'
DOMAIN = b'stellar-forge.sf36.lost-output-finality.v1\x00'
ORIGIN = 'ORIGINAL_HMAC_RESERVATION_AND_SF43_LOST_OUTPUT_RECOVERY'


def require(value, reason):
    if not value:
        raise Denied(reason)


def raw_file(path, limit=4_000_000):
    private_path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        raw = stream.read(limit + 1)
    require(len(raw) <= limit, 'LOST_OUTPUT_SOURCE_TOO_LARGE')
    return raw


def evidence_state(path):
    """Bind the exact original loss state without modifying its bytes."""
    if path.parent.exists():
        private_path(path.parent, directory=True)
    if not os.path.lexists(path):
        return {'condition': 'ABSENT', 'bytes': 0, 'sha256': None}
    raw = raw_file(path)
    state = {'condition': 'EMPTY' if not raw else 'INVALID_JSON',
             'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
    if raw:
        def nonfinite(_):
            raise ValueError('non-JSON numeric constant')
        try:
            json.loads(raw.decode('utf8'), parse_constant=nonfinite,
                       parse_int=lambda value: value, parse_float=lambda value: value)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
            pass
        else:
            raise Denied('ORIGINAL_EVIDENCE_PRESENT_USE_ORIGINAL_FINALIZER')
    return state


def source_context(source_path, source, governor, payer, ledger, policy):
    require(source.get('schema') == SOURCE_SCHEMA, 'LOST_OUTPUT_SOURCE_SCHEMA_INVALID')
    intent = source.get('intentId')
    require(isinstance(intent, str) and ID_PATTERN.fullmatch(intent), 'LOST_OUTPUT_INTENT_INVALID')
    transaction, digest = source.get('transaction'), source.get('requestSha256')
    require(isinstance(transaction, str) and HASH.fullmatch(transaction) and
            isinstance(digest, str) and HASH.fullmatch(digest), 'LOST_OUTPUT_TRANSACTION_AND_DIGEST_REQUIRED')
    queue, workspace = Path(source['queueRoot']), Path(source['workspace'])
    private_path(queue, directory=True)
    private_path(workspace, directory=True)
    job_id = hashlib.sha256(intent.encode('utf8')).hexdigest()
    job = queue / 'jobs' / job_id
    directory = job / 'lost-output'
    private_path(job, directory=True)
    private_path(directory, directory=True)
    require(source_path == directory / (transaction + '.source.json'), 'LOST_OUTPUT_SOURCE_LOCATION_INVALID')
    source_raw = raw_file(source_path)
    require(decode(source_raw) == source, 'LOST_OUTPUT_SOURCE_CHANGED')
    evidence_path = workspace / 'evidence' / (job_id + '.json')
    loss = evidence_state(evidence_path)
    require(source.get('evidenceState') == loss, 'LOST_OUTPUT_ORIGINAL_EVIDENCE_CHANGED')
    paths = {
        'request': job / 'request.json',
        'sourceConfig': job / 'source-config.json',
        'configuration': job / 'execution.json',
        'attempt': job / 'attempt.json',
        'workspaceConfig': workspace / 'operator.json',
        'workspaceManifest': workspace / 'workspace.json',
    }
    data, hashes = {}, {'evidence': loss['sha256']}
    for name, path in paths.items():
        raw = raw_file(path)
        hashes[name] = hashlib.sha256(raw).hexdigest()
        data[name] = decode(raw)
    request, cfg, attempt = data['request'], data['configuration'], data['attempt']
    active, manifest = data['workspaceConfig'], data['workspaceManifest']
    op, owner, expected = cfg['operation'], cfg['operator'], cfg['operation']['expect']
    require(request.get('schema') == 'stellar-forge.sf88.buyer-inbox.v1' and
            request.get('id') == job_id and request.get('operation') == op and
            op.get('intentId') == intent and
            request.get('configSha256') == hashes['configuration'] == source.get('configSha256') and
            request.get('sourceConfigSha256') == hashes['sourceConfig'],
            'LOST_OUTPUT_FROZEN_REQUEST_MISMATCH')
    require(attempt.get('schema') == request['schema'] and attempt.get('kind') == 'EXECUTE' and
            attempt.get('intentId') == intent and attempt.get('id') == source.get('attemptId') and
            attempt.get('configSha256') == source['configSha256'],
            'LOST_OUTPUT_ORIGINAL_ATTEMPT_MISMATCH')
    as_time(attempt['startedAt'])
    require(manifest.get('directory') == str(workspace) and manifest.get('config') == 'operator.json' and
            manifest.get('keys') == 'operator-keys.json' and
            all(owner.get(key) == active['operator'].get(key) for key in ('python', 'actor', 'service', 'ledger', 'policy')) and
            owner.get('ledger') == str(ledger) == str(workspace / 'reservations.sqlite') and
            owner.get('policy') == str(policy) == str(workspace / 'policy.json') and
            cfg.get('evidenceDir') == active.get('evidenceDir') == str(workspace / 'evidence') and
            cfg.get('signerModule') == active.get('signerModule') == str(workspace / 'signer.mjs') and
            cfg.get('trustedPayer') == active.get('trustedPayer') == manifest.get('payer') == payer and
            cfg.get('buyerTransport') == active.get('buyerTransport') == manifest.get('buyerTransport'),
            'LOST_OUTPUT_ORIGINAL_WORKSPACE_MISMATCH')
    signer = manifest['signer']
    require(all(expected.get(key) == active['operation']['expect'].get(key)
                for key in ('scheme', 'network', 'asset', 'payTo')) and
            all(expected.get(key) == signer.get(key) for key in ('network', 'asset', 'payTo')) and
            signer.get('expectedPayer') == payer and expected.get('network') == manifest.get('network') and
            expected.get('network') in NETWORKS and expected.get('scheme') == 'exact' and
            re.fullmatch(r'C[A-Z2-7]{55}', expected.get('asset', '')) and
            re.fullmatch(r'[GC][A-Z2-7]{55}', expected.get('payTo', '')),
            'LOST_OUTPUT_TRUSTED_TERMS_MISMATCH')
    require(request.get('evidencePath') == str(evidence_path), 'LOST_OUTPUT_ORIGINAL_EVIDENCE_PATH_MISMATCH')
    if request.get('bodySha256') is None:
        require(op.get('bodyFile') is None and request.get('bodyBytes') == 0, 'LOST_OUTPUT_ORIGINAL_BODY_MISMATCH')
        hashes['body'] = None
    else:
        require(op.get('bodyFile') == str(job / 'request-body.bin'), 'LOST_OUTPUT_ORIGINAL_BODY_PATH_MISMATCH')
        body = raw_file(job / 'request-body.bin', 16_777_216)
        hashes['body'] = hashlib.sha256(body).hexdigest()
        require(hashes['body'] == request['bodySha256'] and len(body) == request['bodyBytes'],
                'LOST_OUTPUT_ORIGINAL_BODY_MISMATCH')
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
            preimage['method'] == op['method'] and preimage['pay_to'] == expected['payTo'] and
            preimage['max_amount'] == row['amount'] and
            all(preimage[key] == row[key] for key in ('network', 'asset', 'scheme')) and
            preimage['body_present'] == (hashes['body'] is not None) and
            preimage['body_bytes'] == request['bodyBytes'] and
            preimage['body_sha256'] == (hashes['body'] or hashlib.sha256(b'').hexdigest()),
            'LOST_OUTPUT_RETAINED_REQUEST_PREIMAGE_MISMATCH')
    if expected.get('maxTimeoutSeconds') is not None:
        timeout = expected['maxTimeoutSeconds']
        require(type(timeout) is int and 1 <= preimage['max_timeout_seconds'] <= timeout,
                'LOST_OUTPUT_APPROVED_TIMEOUT_MISMATCH')
    binding = {key: source[key] for key in (
        'queueRoot', 'workspace', 'intentId', 'attemptId', 'configSha256',
        'requestSha256', 'transaction', 'sourceHashes', 'evidenceState')}
    binding.update(sourcePath=str(source_path), sourceSha256=hashlib.sha256(source_raw).hexdigest(),
                   attemptStartedAt=attempt['startedAt'], evidencePath=str(evidence_path),
                   evidenceStatus=loss['condition'] + '_ORIGINAL_OUTPUT',
                   requestBinding='EXACT_ORIGINAL_PREIMAGE_AND_HMAC_RESERVATION_VERIFIED')
    terms = {'network': row['network'], 'asset': row['asset'], 'amount': row['amount'],
             'payTo': expected['payTo'], 'payer': payer}
    return binding, terms, row, directory


def sealed_read(path, key):
    value = read_source(path)
    payload, seal = value.get('payload'), value.get('hmacSha256')
    require(isinstance(payload, dict) and isinstance(seal, str) and HASH.fullmatch(seal) and
            hmac.compare_digest(seal, hmac.new(key, DOMAIN + canonical(payload), hashlib.sha256).hexdigest()),
            'LOST_OUTPUT_RECOVERY_AUTHENTICATION_FAILED')
    return payload


def create_sealed(path, payload, key):
    """Retain complete immutable bytes before publishing their directory entry."""
    content = canonical({'payload': payload, 'hmacSha256':
        hmac.new(key, DOMAIN + canonical(payload), hashlib.sha256).hexdigest()}) + b'\n'
    fd, temporary = tempfile.mkstemp(prefix='.lost-output-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            return sealed_read(path, key)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
        return payload
    finally:
        os.unlink(temporary)


def observation_facts(native, terms, binding, endpoint):
    profile = NETWORKS[terms['network']]
    proof = native.get('proof', {})
    require(native.get('schema') == 'stellar-forge.sf36.manual-observation.v1' and
            native.get('origin') == 'OPERATOR_SELECTED_TRANSACTION_ORIGINAL_SF43' and
            native.get('rpcEndpoint') == endpoint and endpoint in profile['rpcEndpoints'] and
            proof.get('status') == profile['chainStatus'] and
            proof.get('proof') == 'RPC_TX_AND_SEP41_TRANSFER_EVENT_MATCH' and
            proof.get('transaction') == binding['transaction'] and proof.get('network') == terms['network'] and
            proof.get('contractId') == terms['asset'] and proof.get('payer') == terms['payer'] and
            proof.get('recipient') == terms['payTo'] and proof.get('amountAtomic') == terms['amount'] and
            type(proof.get('ledger')) is int and proof['ledger'] > 0 and
            isinstance(proof.get('eventId'), str) and 1 <= len(proof['eventId']) <= 512,
            'LOST_OUTPUT_ORIGINAL_SF43_TRANSFER_MISMATCH')
    created_at = proof.get('createdAt')
    require(isinstance(created_at, str) and re.fullmatch(r'[1-9][0-9]{0,12}', created_at),
            'LOST_OUTPUT_TRANSACTION_TIME_REQUIRED')
    # Stellar RPC reports inclusion time in whole Unix seconds; compare the
    # original attempt at the same resolution, without an invented grace window.
    require(int(created_at) >= int(as_time(binding['attemptStartedAt']).timestamp()),
            'LOST_OUTPUT_TRANSACTION_PREDATES_ORIGINAL_ATTEMPT')
    return {'schema': 'stellar-forge.sf36.verified-facts.v1', 'intentId': binding['intentId'],
            'transaction': binding['transaction'], 'network': terms['network'], 'asset': terms['asset'],
            'payer': terms['payer'], 'recipient': terms['payTo'], 'atomicAmount': terms['amount'],
            'request_sha256': binding['requestSha256'], 'ledger': proof['ledger'],
            'eventId': proof['eventId'], 'transactionCreatedAt': created_at}


def check_observation(observed, binding, terms):
    require(observed.get('schema') == PROOF_SCHEMA and observed.get('binding') == binding and
            observed.get('origin') == ORIGIN and isinstance(observed.get('observation'), dict),
            'LOST_OUTPUT_OBSERVATION_BINDING_CONFLICT')
    facts = observation_facts(observed['observation'], terms, binding, observed.get('rpcEndpoint'))
    require(observed.get('verifiedFacts') == facts and
            as_time(observed['observedAt']) >= as_time(binding['attemptStartedAt']) and
            int(facts['transactionCreatedAt']) <= int(as_time(observed['observedAt']).timestamp()),
            'LOST_OUTPUT_OBSERVATION_FACTS_CONFLICT')
    return facts


def check_completion(payload, binding, row, observed, terms):
    facts = check_observation(observed, binding, terms)
    require(payload.get('schema') == RECOVERY_SCHEMA and payload.get('binding') == binding and
            payload.get('observationSha256') == hashlib.sha256(canonical(observed)).hexdigest(),
            'LOST_OUTPUT_RECOVERY_BINDING_CONFLICT')
    result = payload['result']
    require(result.get('verifiedFacts') == facts and
            row['state'] == 'settled' and row['actual'] == result['actual'] == facts['atomicAmount'] and
            row['receipt_ref'] == result['receipt_ref'] == facts['network'] + '/' + binding['transaction'] and
            row['proof_sha256'] == result['proof_sha256'] == hashlib.sha256(canonical(facts)).hexdigest() and
            result['request_id'] == binding['intentId'] and result['request_sha256'] == binding['requestSha256'],
            'LOST_OUTPUT_RECOVERY_LEDGER_CONFLICT')
    return {'schema': SCHEMA, **result, 'outcome': 'IDEMPOTENT_FINALIZED', 'recovery': payload,
            'observation': observed,
            'chainObservation': 'ORIGINAL_AUDITED_LOST_OUTPUT_FINALIZATION_REUSED'}


def finalize_lost_output(governor, source_path, source, payer, *, node, ledger, policy,
                         rpc_endpoint=None, expected_request_sha=None, rpc_proxy_url=None,
                         verify_only=False, use_system_ca=False, context_reader=None):
    require(expected_request_sha == source.get('requestSha256'), 'LOST_OUTPUT_SELECTED_DIGEST_MISMATCH')
    # Fixed native entrypoints select their own original-source reader. The
    # public descriptor cannot choose a module or bypass the original ledger.
    if context_reader is None and source.get('sourceKind') == 'dataset':
        from lost_dataset_finality import dataset_source_context
        def context(path, value, original_governor, original_payer, original_ledger, original_policy):
            return dataset_source_context(
                path, value, original_governor, original_payer, original_ledger, original_policy,
                node=node, use_system_ca=use_system_ca)
    elif context_reader is None and source.get('sourceKind') == 'node-operation':
        from lost_node_finality import node_source_context
        def context(path, value, original_governor, original_payer, original_ledger, original_policy):
            return node_source_context(
                path, value, original_governor, original_payer, original_ledger, original_policy,
                node=node, use_system_ca=use_system_ca)
    else:
        context = source_context if context_reader is None else context_reader
    binding, terms, row, directory = context(source_path, source, governor, payer, ledger, policy)
    proof_path = directory / (binding['transaction'] + '.proof.json')
    completion_path = directory / 'recovery.json'
    if completion_path.exists():
        observed = sealed_read(proof_path, governor.ak)
        return check_completion(sealed_read(completion_path, governor.ak), binding, row, observed, terms)
    require(not verify_only, 'LOST_OUTPUT_RECOVERY_NOT_COMPLETED')
    receipt_ref = terms['network'] + '/' + binding['transaction']
    if row['state'] == 'settled':
        require(row['receipt_ref'] == receipt_ref and row['actual'] == terms['amount'], 'EXISTING_FINALITY_CONFLICT')
    if proof_path.exists():
        observed = sealed_read(proof_path, governor.ak)
    else:
        profile = NETWORKS[terms['network']]
        endpoint = rpc_endpoint or profile['defaultRpc']
        require(endpoint in profile['rpcEndpoints'], 'RPC_ENDPOINT_NOT_ALLOWED')
        native = run_adapter(node, {'action': 'observe-manual', 'expected': terms,
            'transaction': binding['transaction'], 'rpcEndpoint': endpoint,
            **({'rpcProxyUrl': rpc_proxy_url} if rpc_proxy_url is not None else {})},
            use_system_ca=use_system_ca)
        facts = observation_facts(native, terms, binding, endpoint)
        observed = create_sealed(proof_path, {
            'schema': PROOF_SCHEMA, 'binding': binding, 'verifiedFacts': facts,
            'observation': native, 'observedAt': now_utc().isoformat(),
            'rpcEndpoint': endpoint, 'origin': ORIGIN}, governor.ak)
    facts = check_observation(observed, binding, terms)
    # Every frozen byte and the HMAC reservation are checked again after network
    # observation. Original reconcile audits its own immediate transaction.
    current, current_terms, row, _ = context(
        source_path, read_source(source_path), governor, payer, ledger, policy)
    require(current == binding and current_terms == terms, 'LOST_OUTPUT_SOURCE_CHANGED_DURING_OBSERVATION')
    proof_sha = hashlib.sha256(canonical(facts)).hexdigest()
    result = governor.reconcile(issue_finality_attestation(
        governor.ok, binding['intentId'], terms['amount'], receipt_ref, proof_sha))
    result = {**result, 'receipt_ref': receipt_ref, 'request_sha256': binding['requestSha256'],
              'proof_sha256': proof_sha, 'verifiedFacts': facts,
              'chainObservation': 'ORIGINAL_SF43_LOST_OUTPUT_SELECTED_TRANSACTION'}
    completion = create_sealed(completion_path, {
        'schema': RECOVERY_SCHEMA, 'binding': binding, 'result': result,
        'completedAt': now_utc().isoformat(), 'observedAt': observed['observedAt'],
        'observationSha256': hashlib.sha256(canonical(observed)).hexdigest(),
        'recordAuthority': 'ORIGINAL_SF36_HMAC_JOURNAL_AND_SEALED_LOST_OUTPUT_RECOVERY'}, governor.ak)
    current_row = governor.reservation_by_digest(binding['intentId'], binding['requestSha256'])
    check_completion(completion, binding, current_row, observed, terms)
    return {'schema': SCHEMA, **result, 'recovery': completion, 'observation': observed}
