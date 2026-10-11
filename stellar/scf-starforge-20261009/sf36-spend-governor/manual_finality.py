"""Original SF36 worker branch for an operator-selected missing-receipt recovery.

Purchase inputs stay in the original private SF88 inbox/workspace. An immutable
HMAC-sealed observation is durable before the existing atomic reconcile, and a
separate sealed completion is durable afterward. A crash is resumed explicitly
with the same selected transaction; readback only authenticates existing state.
"""
from __future__ import annotations

import hashlib
import hmac
import os
from pathlib import Path
import re
import tempfile

from governor import Denied, ID_PATTERN, as_time, canonical, issue_finality_attestation, now_utc, parse_amount, validate_request
from finalize import HASH, NETWORKS, SCHEMA, decode, private_path, read_source, run_adapter

SOURCE_SCHEMA = 'stellar-forge.sf88.missing-receipt-source.v1'
PROOF_SCHEMA = 'stellar-forge.sf36.manual-proof.v1'
RECOVERY_SCHEMA = 'stellar-forge.sf36.manual-recovery.v1'
DOMAIN = b'stellar-forge.sf36.manual-finality.v1\x00'


def require(value, reason):
    if not value:
        raise Denied(reason)


def raw_file(path, limit=4_000_000):
    private_path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        raw = stream.read(limit + 1)
    require(len(raw) <= limit, 'MANUAL_SOURCE_TOO_LARGE')
    return raw


def source_context(source_path, source, governor, payer, ledger, policy):
    require(source.get('schema') == SOURCE_SCHEMA, 'MANUAL_SOURCE_SCHEMA_INVALID')
    intent = source.get('intentId')
    require(isinstance(intent, str) and ID_PATTERN.fullmatch(intent), 'MANUAL_INTENT_INVALID')
    transaction = source.get('transaction')
    digest = source.get('requestSha256')
    require(isinstance(transaction, str) and HASH.fullmatch(transaction) and
            isinstance(digest, str) and HASH.fullmatch(digest), 'MANUAL_TRANSACTION_AND_DIGEST_REQUIRED')
    queue = Path(source['queueRoot'])
    workspace = Path(source['workspace'])
    private_path(queue, directory=True)
    private_path(workspace, directory=True)
    job_id = hashlib.sha256(intent.encode('utf8')).hexdigest()
    job = queue / 'jobs' / job_id
    directory = job / 'manual-finality'
    private_path(job, directory=True)
    private_path(directory, directory=True)
    require(source_path == directory / (transaction + '.source.json'), 'MANUAL_SOURCE_LOCATION_INVALID')
    paths = {'request': job / 'request.json', 'sourceConfig': job / 'source-config.json',
             'configuration': job / 'execution.json', 'attempt': job / 'attempt.json',
             'evidence': workspace / 'evidence' / (job_id + '.json'),
             'workspaceConfig': workspace / 'operator.json', 'workspaceManifest': workspace / 'workspace.json'}
    data, hashes = {}, {}
    for name, path in paths.items():
        raw = raw_file(path)
        hashes[name] = hashlib.sha256(raw).hexdigest()
        data[name] = decode(raw)
    request, cfg, attempt = data['request'], data['configuration'], data['attempt']
    evidence, active, manifest = data['evidence'], data['workspaceConfig'], data['workspaceManifest']
    op, owner, expected = cfg['operation'], cfg['operator'], cfg['operation']['expect']
    require(request.get('schema') == 'stellar-forge.sf88.buyer-inbox.v1' and request.get('id') == job_id and
            request.get('operation') == op and op.get('intentId') == intent and
            request.get('configSha256') == hashes['configuration'] == source.get('configSha256') and
            request.get('sourceConfigSha256') == hashes['sourceConfig'], 'MANUAL_FROZEN_REQUEST_MISMATCH')
    require(attempt.get('schema') == request['schema'] and attempt.get('kind') == 'EXECUTE' and
            attempt.get('intentId') == intent and attempt.get('id') == source.get('attemptId') and
            attempt.get('configSha256') == source['configSha256'], 'MANUAL_ORIGINAL_ATTEMPT_MISMATCH')
    require(manifest.get('directory') == str(workspace) and manifest.get('config') == 'operator.json' and
            manifest.get('keys') == 'operator-keys.json' and
            all(owner.get(key) == active['operator'].get(key) for key in ('python', 'actor', 'service', 'ledger', 'policy')) and
            owner.get('ledger') == str(ledger) == str(workspace / 'reservations.sqlite') and
            owner.get('policy') == str(policy) == str(workspace / 'policy.json') and
            cfg.get('evidenceDir') == active.get('evidenceDir') == str(workspace / 'evidence') and
            cfg.get('signerModule') == active.get('signerModule') == str(workspace / 'signer.mjs') and
            cfg.get('trustedPayer') == active.get('trustedPayer') == manifest.get('payer') == payer and
            cfg.get('buyerTransport') == active.get('buyerTransport') == manifest.get('buyerTransport'),
            'MANUAL_ORIGINAL_WORKSPACE_MISMATCH')
    signer = manifest['signer']
    require(all(expected.get(key) == active['operation']['expect'].get(key)
                for key in ('scheme', 'network', 'asset', 'payTo')) and
            all(expected.get(key) == signer.get(key) for key in ('network', 'asset', 'payTo')) and
            signer.get('expectedPayer') == payer and expected.get('network') == manifest.get('network') and
            expected.get('network') in NETWORKS and expected.get('scheme') == 'exact' and
            re.fullmatch(r'C[A-Z2-7]{55}', expected.get('asset', '')) and
            re.fullmatch(r'[GC][A-Z2-7]{55}', expected.get('payTo', '')), 'MANUAL_TRUSTED_TERMS_MISMATCH')
    require(request.get('evidencePath') == str(paths['evidence']) and
            evidence.get('schema') == 'scf82.checkout-evidence.v1' and evidence.get('intentId') == intent and
            evidence.get('observation', {}).get('intentId') == intent and
            as_time(evidence.get('observedAt')) >= as_time(attempt.get('startedAt')),
            'MANUAL_ORIGINAL_EVIDENCE_MISMATCH')
    buyer = evidence.get('observation', {}).get('buyer', {})
    require(buyer.get('receipt') is None and
            not evidence.get('reconciliation', {}).get('record', {}).get('receipt'),
            'ORIGINAL_RECEIPT_PRESENT_USE_NORMAL_FINALIZER')
    signed = evidence.get('report', {}).get('counts', {}).get('signedAttempts')
    require(type(signed) is int and signed >= 1, 'MANUAL_ORIGINAL_SIGNED_ATTEMPT_REQUIRED')
    reservation = evidence.get('operatorReservation', {})
    require(reservation.get('outcome') == 'FRESH_RESERVATION_APPROVED' and
            reservation.get('requestId') == intent and reservation.get('requestSha256') == digest,
            'MANUAL_ORIGINAL_RESERVATION_REQUIRED')
    row = governor.reservation_by_digest(intent, digest)
    require(row['scheme'] == 'exact' and row['actor'] == owner['actor'] and row['service'] == owner['service'] and
            all(row[key] == expected[key] == reservation.get(key) for key in ('network', 'asset')) and
            row['amount'] == reservation.get('reservedAtomicUnits') and
            0 < parse_amount(row['amount']) <= parse_amount(expected['maxAtomic']),
            'MANUAL_AUDITED_RESERVATION_TERMS_MISMATCH')
    if request.get('bodySha256') is None:
        require(op.get('bodyFile') is None and request.get('bodyBytes') == 0, 'MANUAL_ORIGINAL_BODY_MISMATCH')
        hashes['body'] = None
    else:
        require(op.get('bodyFile') == str(job / 'request-body.bin'), 'MANUAL_ORIGINAL_BODY_PATH_MISMATCH')
        body = raw_file(job / 'request-body.bin', 16_777_216)
        hashes['body'] = hashlib.sha256(body).hexdigest()
        require(hashes['body'] == request['bodySha256'] and len(body) == request['bodyBytes'],
                'MANUAL_ORIGINAL_BODY_MISMATCH')
    require(source.get('sourceHashes') == hashes, 'MANUAL_SOURCE_HASHES_CHANGED')
    preimage = reservation.get('approved_request')
    if preimage is not None:
        preimage = validate_request(preimage)
        require(hashlib.sha256(canonical(preimage)).hexdigest() == digest and
                preimage['request_id'] == intent and preimage['actor'] == owner['actor'] and
                preimage['service'] == owner['service'] and preimage['resource'] == op['url'] and
                preimage['method'] == op['method'] and preimage['pay_to'] == expected['payTo'] and
                preimage['max_amount'] == row['amount'] and
                all(preimage[key] == row[key] for key in ('network', 'asset', 'scheme')) and
                preimage['body_present'] == (hashes['body'] is not None) and
                preimage['body_bytes'] == request['bodyBytes'] and
                preimage['body_sha256'] == (hashes['body'] or hashlib.sha256(b'').hexdigest()),
                'MANUAL_RETAINED_REQUEST_PREIMAGE_MISMATCH')
    binding = {key: source[key] for key in ('queueRoot', 'workspace', 'intentId', 'attemptId',
               'configSha256', 'requestSha256', 'transaction', 'sourceHashes')}
    binding['sourcePath'] = str(source_path)
    binding['sourceSha256'] = hashlib.sha256(raw_file(source_path)).hexdigest()
    binding['attemptStartedAt'] = attempt['startedAt']
    binding['evidenceObservedAt'] = evidence['observedAt']
    binding['requestBinding'] = ('ORIGINAL_PREIMAGE_HASH_VERIFIED' if preimage is not None else
                                 'ORIGINAL_HMAC_RESERVATION_DIGEST_AND_FROZEN_OPERATOR_INPUTS')
    terms = {'network': row['network'], 'asset': row['asset'], 'amount': row['amount'],
             'payTo': expected['payTo'], 'payer': payer}
    return binding, terms, row, directory


def sealed_read(path, key):
    value = read_source(path)
    payload, seal = value.get('payload'), value.get('hmacSha256')
    require(isinstance(payload, dict) and isinstance(seal, str) and HASH.fullmatch(seal) and
            hmac.compare_digest(seal, hmac.new(key, DOMAIN + canonical(payload), hashlib.sha256).hexdigest()),
            'MANUAL_RECOVERY_AUTHENTICATION_FAILED')
    return payload


def create_sealed(path, payload, key):
    """Create complete bytes atomically, without replacing a prior record."""
    content = canonical({'payload': payload, 'hmacSha256':
        hmac.new(key, DOMAIN + canonical(payload), hashlib.sha256).hexdigest()}) + b'\n'
    fd, temporary = tempfile.mkstemp(prefix='.manual-', dir=path.parent)
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


def check_completion(payload, binding, row):
    require(payload.get('schema') == RECOVERY_SCHEMA and payload.get('binding') == binding,
            'MANUAL_RECOVERY_BINDING_CONFLICT')
    result = payload['result']
    facts = result['verifiedFacts']
    require(row['state'] == 'settled' and row['actual'] == result['actual'] == facts['atomicAmount'] and
            row['receipt_ref'] == result['receipt_ref'] == facts['network'] + '/' + binding['transaction'] and
            row['proof_sha256'] == result['proof_sha256'] == hashlib.sha256(canonical(facts)).hexdigest() and
            result['request_sha256'] == binding['requestSha256'] and
            facts['request_sha256'] == binding['requestSha256'] and facts['intentId'] == binding['intentId'] and
            facts['transaction'] == binding['transaction'], 'MANUAL_RECOVERY_LEDGER_CONFLICT')
    return {'schema': SCHEMA, **result, 'outcome': 'IDEMPOTENT_FINALIZED', 'recovery': payload,
            'chainObservation': 'ORIGINAL_AUDITED_MANUAL_FINALIZATION_REUSED'}


def finalize_manual(governor, source_path, source, payer, *, node, ledger, policy,
                    rpc_endpoint=None, expected_request_sha=None, rpc_proxy_url=None, verify_only=False):
    require(expected_request_sha == source.get('requestSha256'), 'MANUAL_SELECTED_DIGEST_MISMATCH')
    binding, terms, row, directory = source_context(source_path, source, governor, payer, ledger, policy)
    completion_path = directory / 'recovery.json'
    if completion_path.exists():
        return check_completion(sealed_read(completion_path, governor.ak), binding, row)
    require(not verify_only, 'MANUAL_RECOVERY_NOT_COMPLETED')
    receipt_ref = terms['network'] + '/' + binding['transaction']
    if row['state'] == 'settled':
        require(row['receipt_ref'] == receipt_ref and row['actual'] == terms['amount'], 'EXISTING_FINALITY_CONFLICT')
    proof_path = directory / (binding['transaction'] + '.proof.json')
    if proof_path.exists():
        observed = sealed_read(proof_path, governor.ak)
    else:
        profile = NETWORKS[terms['network']]
        endpoint = rpc_endpoint or profile['defaultRpc']
        require(endpoint in profile['rpcEndpoints'], 'RPC_ENDPOINT_NOT_ALLOWED')
        native = run_adapter(node, {'action': 'observe-manual', 'expected': terms,
            'transaction': binding['transaction'], 'rpcEndpoint': endpoint,
            **({'rpcProxyUrl': rpc_proxy_url} if rpc_proxy_url is not None else {})})
        proof = native.get('proof', {})
        require(native.get('schema') == 'stellar-forge.sf36.manual-observation.v1' and
                native.get('origin') == 'OPERATOR_SELECTED_TRANSACTION_ORIGINAL_SF43' and
                native.get('rpcEndpoint') == endpoint and proof.get('status') == profile['chainStatus'] and
                proof.get('proof') == 'RPC_TX_AND_SEP41_TRANSFER_EVENT_MATCH' and
                proof.get('transaction') == binding['transaction'] and proof.get('network') == terms['network'] and
                proof.get('contractId') == terms['asset'] and proof.get('payer') == terms['payer'] and
                proof.get('recipient') == terms['payTo'] and proof.get('amountAtomic') == terms['amount'] and
                type(proof.get('ledger')) is int and proof['ledger'] > 0 and
                isinstance(proof.get('eventId'), str) and 1 <= len(proof['eventId']) <= 512,
                'MANUAL_ORIGINAL_SF43_TRANSFER_MISMATCH')
        facts = {'schema': 'stellar-forge.sf36.verified-facts.v1', 'intentId': binding['intentId'],
                 'transaction': binding['transaction'], 'network': terms['network'], 'asset': terms['asset'],
                 'payer': terms['payer'], 'recipient': terms['payTo'], 'atomicAmount': terms['amount'],
                 'request_sha256': binding['requestSha256'], 'ledger': proof['ledger'], 'eventId': proof['eventId']}
        observed = create_sealed(proof_path, {'schema': PROOF_SCHEMA, 'binding': binding,
            'verifiedFacts': facts, 'observedAt': now_utc().isoformat(),
            'rpcEndpoint': endpoint, 'origin': 'OPERATOR_SELECTED_TRANSACTION_ORIGINAL_SF43'}, governor.ak)
    require(observed.get('schema') == PROOF_SCHEMA and observed.get('binding') == binding,
            'MANUAL_OBSERVATION_BINDING_CONFLICT')
    facts = observed['verifiedFacts']
    # Source and journal may have changed during network IO. Re-read both before
    # issuing authority; original reconcile then audits in BEGIN IMMEDIATE.
    current, current_terms, row, _ = source_context(source_path, read_source(source_path), governor, payer, ledger, policy)
    require(current == binding and current_terms == terms, 'MANUAL_SOURCE_CHANGED_DURING_OBSERVATION')
    proof_sha = hashlib.sha256(canonical(facts)).hexdigest()
    result = governor.reconcile(issue_finality_attestation(governor.ok, binding['intentId'],
        terms['amount'], receipt_ref, proof_sha))
    result = {**result, 'receipt_ref': receipt_ref, 'request_sha256': binding['requestSha256'],
              'proof_sha256': proof_sha, 'verifiedFacts': facts,
              'chainObservation': 'ORIGINAL_SF43_OPERATOR_SELECTED_TRANSACTION'}
    completion = create_sealed(completion_path, {'schema': RECOVERY_SCHEMA, 'binding': binding,
        'result': result, 'completedAt': now_utc().isoformat(), 'observedAt': observed['observedAt'],
        'recordAuthority': 'ORIGINAL_SF36_HMAC_JOURNAL_AND_SEALED_MANUAL_RECOVERY'}, governor.ak)
    current_row = governor.reservation_by_digest(binding['intentId'], binding['requestSha256'])
    check_completion(completion, binding, current_row)
    return {'schema': SCHEMA, **result, 'recovery': completion}
