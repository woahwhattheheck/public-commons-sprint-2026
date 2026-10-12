"""MIT. Trusted native MCP host integration with the original SF36 spend ledger.

The host reviews the exact logical MCP invocation before invoking reserve.
Only a fresh original reservation authorizes its subsequent native signer call.
The original SF86 verifier supplies finality; this helper never calls a wallet.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[2] / 'stellar' / 'scf-starforge-20261009'
sys.path.insert(0, str(ROOT / 'sf36-spend-governor'))
sys.path.insert(0, str(ROOT / 'sf62-human-approval-cli'))
from governor import (Denied, Governor, canonical, issue_consent,
                      issue_finality_attestation, validate_request)
from console import check_ledger_path, key_from_environment
from finalize import decode, verified_facts, NETWORKS

SCHEMA = 'stellar-forge.mcp-spending.v1'
RECORD_SCHEMA = 'stellar-forge.mcp-spending-binding.v1'
MAX_INPUT = 4 * 1024 * 1024
MAX_DOCUMENT = 128 * 1024
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
HASH = re.compile(r'^[0-9a-f]{64}$')
ACTIONS = {'estimate', 'reserve', 'status', 'finalize'}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def private_directory(path):
    if not path.is_absolute() or path.resolve() != path:
        raise Denied('MCP_SPENDING_ABSOLUTE_REAL_DIRECTORY_REQUIRED')
    if not path.exists():
        path.mkdir(mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise Denied('MCP_SPENDING_PRIVATE_DIRECTORY_REQUIRED')


def read_record(path, *, private=True):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_INPUT:
            raise Denied('MCP_SPENDING_SOURCE_INVALID')
        if private and (info.st_uid != os.geteuid() or info.st_mode & 0o077):
            raise Denied('MCP_SPENDING_PRIVATE_RECORD_REQUIRED')
        raw = stream.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        raise Denied('MCP_SPENDING_SOURCE_TOO_LARGE')
    return decode(raw)


def write_new(path, value):
    """Publish a complete create-only record before changing the original ledger."""
    raw = canonical(value) + b'\n'
    if len(raw) > MAX_INPUT:
        raise Denied('MCP_SPENDING_RECORD_TOO_LARGE')
    fd, temporary = tempfile.mkstemp(prefix='.mcp-spending-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        # Hard-link publication is atomic and refuses an existing destination.
        # A killed writer can leave a private temporary, never partial JSON at
        # the canonical configuration, invocation or finality pathname.
        os.link(temporary, path, follow_symlinks=False)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass

def selected_id(value):
    if type(value) is not str or not UUID.fullmatch(value):
        raise Denied('MCP_SPENDING_QUOTE_ID_REQUIRED')
    return value


def document(value):
    if type(value) is not str:
        raise Denied('MCP_SPENDING_ORIGINAL_JSON_REQUIRED')
    raw = value.encode('utf8')
    if len(raw) > MAX_DOCUMENT:
        raise Denied('MCP_SPENDING_DOCUMENT_TOO_LARGE')
    return decode(raw), raw


def checked_binding(binding, args):
    if type(binding) is not dict or set(binding) != {
            'quoteId', 'payer', 'invocationJson', 'acceptedJson', 'request'}:
        raise Denied('MCP_SPENDING_BINDING_FIELDS_INVALID')
    quote_id = selected_id(binding['quoteId'])
    payer = binding['payer']
    if type(payer) is not str or not re.fullmatch(r'[GC][A-Z2-7]{55}', payer):
        raise Denied('MCP_SPENDING_TRUSTED_PAYER_REQUIRED')
    invocation, invocation_bytes = document(binding['invocationJson'])
    accepted, accepted_bytes = document(binding['acceptedJson'])
    if set(invocation) != {'endpoint', 'transport', 'toolName', 'paymentResourceUrl',
                           'arguments', 'inputSchemaSha256'} or \
            invocation['transport'] not in {'sse', 'streamable-http'} or \
            type(invocation['toolName']) is not str or \
            not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', invocation['toolName']) or \
            type(invocation['arguments']) is not dict or \
            type(invocation['inputSchemaSha256']) is not str or \
            not HASH.fullmatch(invocation['inputSchemaSha256']) or \
            type(invocation['paymentResourceUrl']) is not str or \
            not 1 <= len(invocation['paymentResourceUrl']) <= 2048:
        raise Denied('MCP_SPENDING_LOGICAL_INVOCATION_INVALID')
    if accepted.get('scheme') != 'exact' or type(accepted.get('extra')) is not dict or \
            accepted['extra'].get('areFeesSponsored') is not True or \
            accepted['extra'].get('paymentFlow', 'authorization') != 'authorization':
        raise Denied('MCP_SPENDING_NATIVE_EXACT_TERMS_REQUIRED')
    # Hash original JS mcpJson UTF-8 strings, never Python's JSON number format.
    # POST/resource describe the endpoint. The body digest describes the complete
    # logical MCP call, including transport, schema and payment resource identity.
    expected = validate_request({
        'request_id': quote_id, 'actor': args.actor, 'service': args.service,
        'network': accepted.get('network'), 'asset': accepted.get('asset'),
        'scheme': accepted.get('scheme'), 'max_amount': accepted.get('amount'),
        'resource': invocation['endpoint'], 'pay_to': accepted.get('payTo'),
        'max_timeout_seconds': accepted.get('maxTimeoutSeconds'), 'method': 'POST',
        'body_present': True, 'body_bytes': len(invocation_bytes),
        'body_sha256': digest(invocation_bytes),
        'accepted_terms_sha256': digest(accepted_bytes),
    })
    supplied = validate_request(binding['request'])
    if canonical(supplied) != canonical(expected):
        raise Denied('MCP_SPENDING_REQUEST_BINDING_MISMATCH')
    return binding, expected, digest(canonical(expected))


def record_at(state, quote_id, args):
    record = read_record(state / (selected_id(quote_id) + '.json'))
    if record.get('schema') != RECORD_SCHEMA:
        raise Denied('MCP_SPENDING_RECORD_SCHEMA_INVALID')
    binding, request, request_sha = checked_binding(record.get('binding'), args)
    if binding['quoteId'] != quote_id or record.get('request_sha256') != request_sha:
        raise Denied('MCP_SPENDING_RETAINED_BINDING_MISMATCH')
    return binding, request, request_sha


def retained_binding(state, binding, request_sha, args):
    path = state / (binding['quoteId'] + '.json')
    try:
        existing, _, existing_sha = record_at(state, binding['quoteId'], args)
    except FileNotFoundError:
        write_new(path, {'schema': RECORD_SCHEMA, 'binding': binding,
                         'request_sha256': request_sha})
        return
    if not hmac.compare_digest(existing_sha, request_sha) or canonical(existing) != canonical(binding):
        raise Denied('MCP_SPENDING_QUOTE_ALREADY_BOUND')


def native_reservation(governor, request):
    try:
        return governor.reservation(request)
    except Denied as error:
        if str(error) == 'unknown reserved payment':
            return None
        raise


def open_governor(args):
    check_ledger_path(args.ledger)
    initialized = args.state_directory / 'ledger-initialized.json'
    if initialized.exists():
        marker = read_record(initialized)
        if marker != {'schema': SCHEMA, 'ledger': str(args.ledger)}:
            raise Denied('MCP_SPENDING_LEDGER_IDENTITY_CHANGED')
        if not args.ledger.exists():
            raise Denied('MCP_SPENDING_ORIGINAL_LEDGER_MISSING')
    policy = read_record(args.policy, private=False)
    keys = [key_from_environment('SF36_' + name + '_KEY_B64')
            for name in ('CONSENT', 'AUDIT', 'OPERATOR')]
    governor = Governor(args.ledger, policy, *keys)
    try:
        if not initialized.exists():
            write_new(initialized, {'schema': SCHEMA, 'ledger': str(args.ledger)})
        return governor
    except BaseException:
        governor.close()
        raise


def finalize_payment(governor, state, binding, request, request_sha, proof):
    row = governor.reservation(request)
    if type(proof) is not dict or proof.get('schema') != 'stellar-forge.sf86.payment-attempt.v1' or \
            proof.get('outcome') != 'TRANSFER_MATCHED' or proof.get('rpcStatus') != 'SUCCESS':
        raise Denied('MCP_SPENDING_ORIGINAL_MATCHED_PAYMENT_ATTEMPT_REQUIRED')
    transaction = proof.get('transaction')
    if type(transaction) is not str or not HASH.fullmatch(transaction):
        raise Denied('MCP_SPENDING_ORIGINAL_TRANSACTION_REQUIRED')
    expected = {'intentId': request['request_id'], 'network': request['network'],
                'asset': request['asset'], 'payer': binding['payer'],
                'recipient': request['pay_to'], 'atomicAmount': request['max_amount']}
    if any(proof.get(key) != value for key, value in expected.items()):
        raise Denied('MCP_SPENDING_PAYMENT_ATTEMPT_BINDING_MISMATCH')
    transfer = proof.get('transfer')
    facts = verified_facts(transfer, request, request_sha, transaction, binding['payer'])
    profile = NETWORKS[request['network']]
    if proof.get('source') != profile['rpcSource'] or \
            proof.get('rpcEndpoint') != transfer['rpcEndpoint'] or \
            type(proof.get('ledger')) is not int or proof['ledger'] != transfer['ledger']:
        raise Denied('MCP_SPENDING_PAYMENT_ATTEMPT_SOURCE_MISMATCH')
    facts_sha = digest(canonical(facts))
    receipt_ref = request['network'] + '/' + transaction
    if row['state'] == 'settled' and (row['receipt_ref'] != receipt_ref or
            row['actual'] != request['max_amount'] or row['proof_sha256'] != facts_sha):
        raise Denied('MCP_SPENDING_EXISTING_FINALITY_CONFLICT')
    finality_path = state / (request['request_id'] + '.finality.json')
    try:
        saved = read_record(finality_path)
    except FileNotFoundError:
        write_new(finality_path, {'schema': SCHEMA, 'request_id': request['request_id'],
            'request_sha256': request_sha, 'proof_sha256': facts_sha,
            'verifiedFacts': facts, 'proof': proof})
    else:
        if saved.get('schema') != SCHEMA or saved.get('request_id') != request['request_id'] or \
                saved.get('request_sha256') != request_sha or \
                saved.get('proof_sha256') != facts_sha or saved.get('verifiedFacts') != facts:
            raise Denied('MCP_SPENDING_RETAINED_FINALITY_CONFLICT')
    attestation = issue_finality_attestation(governor.ok, request['request_id'],
        request['max_amount'], receipt_ref, facts_sha)
    result = governor.reconcile(attestation)
    return {**result, 'receipt_ref': receipt_ref, 'proof_sha256': facts_sha,
            'verifiedFacts': facts, 'reservation': governor.reservation(request)}


def dispatch(args, payload):
    action = payload.get('action')
    if action not in ACTIONS or set(payload) - {'action', 'binding', 'quoteId', 'proof'}:
        raise Denied('MCP_SPENDING_ACTION_INVALID')
    if 'binding' in payload:
        binding, request, request_sha = checked_binding(payload['binding'], args)
        quote_id = binding['quoteId']
        if 'quoteId' in payload and payload['quoteId'] != quote_id:
            raise Denied('MCP_SPENDING_SELECTED_QUOTE_MISMATCH')
    else:
        quote_id = selected_id(payload.get('quoteId'))
        if action in {'estimate', 'reserve'}:
            raise Denied('MCP_SPENDING_COMPLETE_BINDING_REQUIRED')
        try:
            binding, request, request_sha = record_at(args.state_directory, quote_id, args)
        except FileNotFoundError:
            if action == 'status':
                return {'outcome': 'NOT_RESERVED', 'request_id': quote_id}
            raise Denied('MCP_SPENDING_RETAINED_BINDING_REQUIRED')
    result = {'request_id': quote_id, 'request_sha256': request_sha, 'binding': binding}
    if action in {'status', 'finalize'}:
        try:
            saved, _, saved_sha = record_at(args.state_directory, quote_id, args)
        except FileNotFoundError:
            if action == 'status':
                return {**result, 'outcome': 'NOT_RESERVED'}
            raise Denied('MCP_SPENDING_RETAINED_BINDING_REQUIRED')
        if saved_sha != request_sha or canonical(saved) != canonical(binding):
            raise Denied('MCP_SPENDING_RETAINED_BINDING_MISMATCH')
    governor = open_governor(args)
    try:
        if action == 'estimate':
            prior = native_reservation(governor, request)
            governor.db.execute('BEGIN')
            try:
                estimate = governor.estimate(request)
                governor.db.execute('COMMIT')
            except BaseException:
                governor.db.execute('ROLLBACK')
                raise
            return {**result, 'outcome': 'ESTIMATED', 'estimate': estimate, 'reservation': prior}
        if action == 'reserve':
            retained_binding(args.state_directory, binding, request_sha, args)
            expiry = datetime.now(timezone.utc) + timedelta(minutes=5)
            consent = issue_consent(governor.ck, request, expiry.isoformat())
            native = governor.reserve(request, consent)
            return {**result, **native, 'reservation': governor.reservation(request)}
        if action == 'status':
            row = native_reservation(governor, request)
            return {**result, 'outcome': 'RESERVATION' if row else 'NOT_RESERVED', 'reservation': row}
        return {**result, **finalize_payment(governor, args.state_directory,
                                            binding, request, request_sha, payload.get('proof'))}
    finally:
        governor.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor', required=True)
    parser.add_argument('--service', required=True)
    parser.add_argument('--policy', required=True, type=Path)
    parser.add_argument('--ledger', required=True, type=Path)
    parser.add_argument('--state-directory', required=True, type=Path)
    args = parser.parse_args()
    action, quote_id = None, None
    try:
        os.umask(0o077)
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        if len(raw) > MAX_INPUT:
            raise Denied('MCP_SPENDING_INPUT_TOO_LARGE')
        payload = decode(raw)
        action = payload.get('action')
        candidate = payload.get('quoteId')
        if candidate is None and type(payload.get('binding')) is dict:
            candidate = payload['binding'].get('quoteId')
        quote_id = selected_id(candidate)
        private_directory(args.state_directory)
        if not args.policy.is_absolute() or args.policy.resolve() != args.policy or \
                not args.ledger.is_absolute() or args.ledger.resolve() != args.ledger:
            raise Denied('MCP_SPENDING_ABSOLUTE_ORIGINAL_PATHS_REQUIRED')
        lock_fd = os.open(args.state_directory / 'state.lock',
            os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(lock_fd, 'a') as lock:
            info = os.fstat(lock.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
                raise Denied('MCP_SPENDING_PRIVATE_REGULAR_LOCK_REQUIRED')
            # The owning Node call supplies timeout/cancellation and drains this
            # process. Queue on the private file lock so a simultaneous status
            # read cannot reject an otherwise valid approved purchase as busy.
            fcntl.flock(lock, fcntl.LOCK_EX)
            configuration = {'schema': SCHEMA, 'actor': args.actor, 'service': args.service,
                'policy': str(args.policy), 'ledger': str(args.ledger)}
            configuration_path = args.state_directory / 'configuration.json'
            try:
                saved_configuration = read_record(configuration_path)
            except FileNotFoundError:
                write_new(configuration_path, configuration)
            else:
                if saved_configuration != configuration:
                    raise Denied('MCP_SPENDING_ORIGINAL_CONFIGURATION_CHANGED')
            result = dispatch(args, payload)
        print(json.dumps({'schema': SCHEMA, 'action': action, **result},
                         sort_keys=True, separators=(',', ':'), ensure_ascii=True), flush=True)
        return 0
    except (Denied, OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError) as error:
        print(json.dumps({'schema': SCHEMA, 'action': action, 'request_id': quote_id,
            'outcome': 'ERROR', 'error_type': type(error).__name__,
            'reason': str(error)[:256] if isinstance(error, Denied) else 'MCP_SPENDING_LOCAL_IO_OR_INPUT_ERROR'},
            sort_keys=True, separators=(',', ':'), ensure_ascii=True), flush=True)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
