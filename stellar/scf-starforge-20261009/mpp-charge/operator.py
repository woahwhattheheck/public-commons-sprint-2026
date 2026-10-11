"""MIT. Native MPP -> existing SF36/SF59 local approval and original SF86 finality."""
from __future__ import annotations
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[1]
for module in ('sf36-spend-governor', 'sf62-human-approval-cli', 'sf59-operator-reservation-gate'):
    sys.path.insert(0, str(ROOT / module))
from governor import Denied, Governor, canonical, issue_consent, issue_finality_attestation, validate_request
from console import check_ledger_path, key_from_environment, review_payload
from operator_gate import reserve_for_approval
from finalize import verified_facts, private_path, decode

def request_from_intent(intent, *, actor, service):
    if intent.get('schema') != 'stellar-forge.mpp-intent.v1':
        raise Denied('MPP_ORIGINAL_INTENT_REQUIRED')
    terms = intent['acceptedTerms']
    challenge = terms['challenge']
    q = challenge['request']
    request = intent['request']
    if challenge.get('method') != 'stellar' or challenge.get('intent') != 'charge':
        raise Denied('MPP_NATIVE_CHARGE_REQUIRED')
    if q.get('methodDetails', {}).get('feePayer') is True:
        raise Denied('MPP_UNSPONSORED_PULL_REQUIRED')
    return validate_request({
        'request_id': intent['intentId'], 'actor': actor, 'service': service,
        'resource': request['url'], 'network': q['methodDetails']['network'],
        'asset': q['currency'], 'scheme': 'exact', 'max_amount': q['amount'],
        'pay_to': q['recipient'], 'max_timeout_seconds': intent['maxTimeoutSeconds'],
        'method': request['method'], 'body_present': request['bodyPresent'],
        'body_bytes': request['bodyBytes'], 'body_sha256': request['bodySha256'],
        'accepted_terms_sha256': hashlib.sha256(canonical(terms)).hexdigest(),
    })

def approval_result(request, outcome='FRESH_RESERVATION_APPROVED'):
    return {'schema': 'stellar-forge.mpp-approval.v1', 'outcome': outcome,
        'request_id': request['request_id'], 'request_sha256': hashlib.sha256(canonical(request)).hexdigest(),
        'approved_request': request, 'reserved_atomic_units': request['max_amount'],
        'network': request['network'], 'asset': request['asset']}

def run(payload):
    action = payload['action']
    config = payload['operator']
    ledger = Path(config['ledger'])
    check_ledger_path(ledger)
    private_path(ledger)
    policy_path = Path(config['policy'])
    if not policy_path.is_absolute() or policy_path.resolve() != policy_path:
        raise Denied('MPP_CANONICAL_POLICY_REQUIRED')
    policy = decode(policy_path.read_bytes())
    keys = [key_from_environment('SF36_' + kind + '_KEY_B64') for kind in ('CONSENT', 'AUDIT', 'OPERATOR')]
    request = request_from_intent(payload['intent'], actor=config['actor'], service=config['service'])
    os.umask(0o077)
    governor = Governor(ledger, policy, *keys)
    try:
        if action == 'inspect':
            try:
                row = governor.reservation(request)
            except Denied as error:
                if str(error) == 'unknown reserved payment':
                    return {'schema': 'stellar-forge.mpp-approval.v1', 'outcome': 'UNRESERVED'}
                raise
            return {**approval_result(request, 'ORIGINAL_RESERVATION_RECOVERED'), 'reservation': row}
        if action == 'approve':
            estimate = governor.estimate(request)
            if not estimate.get('approved'):
                raise Denied('MPP_SPEND_POLICY_ESTIMATE_DENIED')
            fd = os.open('/dev/tty', os.O_RDWR | os.O_NOCTTY)
            if not stat.S_ISCHR(os.fstat(fd).st_mode):
                os.close(fd)
                raise Denied('MPP_CONTROLLING_TERMINAL_REQUIRED')
            with os.fdopen(fd, 'r+', buffering=1) as terminal:
                review, confirmation = review_payload(payload['intent'], request)
                terminal.write(json.dumps({'review': review, 'current_native_budget_estimate': estimate,
                    'maximum_network_fee_stroops': payload['intent']['acceptedTerms']['maxFeeStroops']},
                    sort_keys=True, indent=2, ensure_ascii=True) + '\n')
                terminal.write('Authorize this exact purchase by typing: ' + confirmation + '\n')
                if terminal.readline(100).rstrip('\r\n') != confirmation:
                    raise Denied('MPP_OPERATOR_CONSENT_DECLINED')
            def consent(mapped):
                if mapped != request:
                    raise Denied('MPP_REVIEWED_INTENT_CHANGED')
                return issue_consent(keys[0], mapped, (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat())
            approved = reserve_for_approval(payload['intent'], actor=config['actor'], service=config['service'],
                governor=governor, consent_for_request=consent, intent_mapper=request_from_intent)
            if approved is not True:
                raise Denied('MPP_FRESH_RESERVATION_REQUIRED')
            return approval_result(request)
        if action == 'finalize':
            approved = payload['approval']
            digest = hashlib.sha256(canonical(request)).hexdigest()
            if approved.get('approved_request') != request or not hmac.compare_digest(approved.get('request_sha256', ''), digest):
                raise Denied('MPP_ORIGINAL_APPROVAL_MISMATCH')
            row = governor.reservation(request)
            transaction = payload['transaction']
            if not re.fullmatch(r'[0-9a-f]{64}', transaction):
                raise Denied('MPP_ORIGINAL_TRANSACTION_REQUIRED')
            receipt_ref = request['network'] + '/' + transaction
            if row['state'] == 'settled':
                if row['receipt_ref'] != receipt_ref or row['actual'] != request['max_amount']:
                    raise Denied('MPP_FINALITY_CONFLICT')
                return {'schema': 'stellar-forge.mpp-finality.v1', 'outcome': 'IDEMPOTENT_FINALIZED',
                    'receipt_ref': receipt_ref, 'actual': row['actual'], 'proof_sha256': row['proof_sha256']}
            node = payload['node']
            if not Path(node).is_absolute() or not os.access(node, os.X_OK):
                raise Denied('MPP_ABSOLUTE_NODE_REQUIRED')
            observation = subprocess.run([node, str(Path(__file__).with_name('observe.mjs'))],
                input=canonical({'intentId': request['request_id'], 'challenge': payload['intent']['acceptedTerms']['challenge'],
                    'payer': payload['payer'], 'transaction': transaction, 'dependencyRoot': payload['dependencyRoot'],
                    'rpcEndpoint': payload.get('rpcEndpoint')}),
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False, timeout=420,
                env={'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'})
            if observation.returncode or len(observation.stdout) > 4_000_000:
                raise Denied('MPP_ORIGINAL_RPC_OBSERVER_FAILED')
            result = decode(observation.stdout)
            if result.get('outcome') != 'TRANSFER_MATCHED':
                return {'schema': 'stellar-forge.mpp-finality.v1', 'outcome': 'PENDING', 'observation': result}
            facts = verified_facts(result['transfer'], request, digest, transaction, payload['payer'])
            governor.reservation(request)
            proof = hashlib.sha256(canonical(facts)).hexdigest()
            result = governor.reconcile(issue_finality_attestation(governor.ok, request['request_id'],
                request['max_amount'], receipt_ref, proof))
            return {'schema': 'stellar-forge.mpp-finality.v1', **result,
                'receipt_ref': receipt_ref, 'proof_sha256': proof, 'verifiedFacts': facts}
        raise Denied('MPP_OPERATOR_ACTION_INVALID')
    finally:
        governor.close()

def main():
    raw = sys.stdin.buffer.read(300_001)
    if len(raw) > 300_000:
        raise Denied('MPP_OPERATOR_INPUT_TOO_LARGE')
    result = run(decode(raw))
    print(json.dumps({**result, 'input_sha256': hashlib.sha256(raw).hexdigest()}, ensure_ascii=True))
    return 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'schema': 'stellar-forge.mpp-operator-error.v1',
            'error': str(error) if isinstance(error, Denied) else 'MPP_OPERATOR_EXECUTION_FAILED'}))
        raise SystemExit(2)
