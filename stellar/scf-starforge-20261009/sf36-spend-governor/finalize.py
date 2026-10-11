"""Privileged original SF36 settlement worker. No signer or payment retry.

The trusted buyer host supplies its private original SF81/SF82 capture. The
worker checks the complete approved request against the existing HMAC ledger,
invokes original SF86 against Stellar RPC, then calls original reconcile().
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import threading

from governor import Denied, Governor, canonical, issue_finality_attestation, validate_request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'sf62-human-approval-cli'))
from console import check_ledger_path, key_from_environment  # noqa: E402

SCHEMA = 'stellar-forge.sf36.finalization.v1'
HASH = re.compile(r'^[0-9a-f]{64}$')
ADAPTER = Path(__file__).with_name('observe.mjs')
MAX_SOURCE = 4_000_000


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Denied('DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def decode(raw: bytes):
    def nonfinite(_):
        raise Denied('NONFINITE_JSON')
    result = json.loads(raw.decode('utf8'), object_pairs_hook=unique_object,
                        parse_constant=nonfinite)
    if type(result) is not dict:
        raise Denied('JSON_OBJECT_REQUIRED')
    return result


def private_path(path: Path, *, directory=False):
    if not path.is_absolute() or path.resolve() != path:
        raise Denied('ABSOLUTE_NORMALIZED_PATH_WITHOUT_SYMLINK_REQUIRED')
    info = path.lstat()
    if (not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            or info.st_uid != os.geteuid() or info.st_mode & 0o077):
        raise Denied('PRIVATE_OPERATOR_OWNED_SOURCE_REQUIRED')
    # The original protected host capture supplies HTTP-intent/transaction
    # association. It must not be replaceable through a shared-writable parent.
    if path.parent.stat().st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise Denied('SOURCE_PARENT_SHARED_WRITABLE')


def read_source(path: Path, *, private=True):
    if private:
        private_path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_SOURCE:
            raise Denied('SOURCE_MISSING_OR_TOO_LARGE')
        raw = stream.read(MAX_SOURCE + 1)
    if len(raw) > MAX_SOURCE:
        raise Denied('SOURCE_TOO_LARGE')
    return decode(raw)


def original_record(source):
    if source.get('schema') == 'scf82.checkout-evidence.v1':
        saved = source.get('reconciliation', {})
        record = saved.get('record')
        if saved.get('status') != 'AVAILABLE' or type(record) is not dict:
            raise Denied('ORIGINAL_RECONCILIATION_RECORD_UNAVAILABLE')
        if source.get('intentId') != record.get('intentId'):
            raise Denied('ORIGINAL_EVIDENCE_INTENT_MISMATCH')
        return record
    return source


def approved_record(source):
    record = original_record(source)
    p = record.get('operatorReservation')
    if type(p) is not dict or p.get('schema') != 'stellar-forge.sf62.result.v1' or \
            p.get('outcome') != 'FRESH_RESERVATION_APPROVED':
        raise Denied('ORIGINAL_OPERATOR_RESERVATION_REQUIRED')
    request = validate_request(p.get('approved_request'))
    request_sha = hashlib.sha256(canonical(request)).hexdigest()
    if type(p.get('request_sha256')) is not str or not hmac.compare_digest(request_sha, p['request_sha256']):
        raise Denied('APPROVED_REQUEST_DIGEST_MISMATCH')
    q, receipt = record.get('requirement'), record.get('receipt')
    if type(q) is not dict or type(receipt) is not dict:
        raise Denied('ORIGINAL_NATIVE_TERMS_AND_RECEIPT_REQUIRED')
    if request['scheme'] != 'exact' or request['network'] != 'stellar:testnet':
        raise Denied('ORIGINAL_RPC_EXACT_TESTNET_ONLY')
    if record.get('intentId') != request['request_id'] or p.get('request_id') != request['request_id']:
        raise Denied('ORIGINAL_RESERVATION_ID_MISMATCH')
    if any(q.get(key) != request[field] for key, field in (
            ('scheme', 'scheme'), ('network', 'network'), ('asset', 'asset'),
            ('payTo', 'pay_to'), ('amount', 'max_amount'))) or \
            any(p.get(key) != request[field] for key, field in (
                ('network', 'network'), ('asset', 'asset'), ('reserved_atomic_units', 'max_amount'))):
        raise Denied('APPROVED_PAYMENT_TERMS_MISMATCH')
    if receipt.get('network') != request['network'] or \
            not isinstance(receipt.get('transaction'), str) or not HASH.fullmatch(receipt['transaction']):
        raise Denied('ORIGINAL_TRANSACTION_REQUIRED')
    return record, request, request_sha


def run_adapter(node: str, payload: dict):
    # The operator config chooses an executable, not a shell or arbitrary module.
    # SF36 keys and unrelated credentials never enter the Node observer process.
    result = subprocess.run([node, str(ADAPTER)], input=canonical(payload),
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env={'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'}, timeout=420, check=False)
    if len(result.stdout) > MAX_SOURCE:
        raise Denied('ORIGINAL_OBSERVER_RESULT_TOO_LARGE')
    parsed = decode(result.stdout)
    if result.returncode or parsed.get('error'):
        raise Denied('ORIGINAL_OBSERVER_FAILED')
    return parsed


def verified_facts(proof, request, request_sha, transaction, payer):
    if type(proof) is not dict or proof.get('schema') != 'stellar-forge.sf86.rpc-reconciliation.v1' or \
            proof.get('verdict') != 'CHAIN_TRANSFER_MATCHED_RPC_TESTNET' or \
            proof.get('source') != 'official-stellar-testnet-rpc':
        raise Denied('FRESH_ORIGINAL_RPC_MATCH_REQUIRED')
    expected = {'intentId': request['request_id'], 'transaction': transaction,
        'network': request['network'], 'asset': request['asset'], 'payer': payer,
        'recipient': request['pay_to'], 'atomicAmount': request['max_amount']}
    if any(proof.get(key) != value for key, value in expected.items()) or \
            proof.get('matchingTransfers') != 1 or type(proof.get('ledger')) is not int or proof['ledger'] < 1 or \
            type(proof.get('matchingEventId')) is not str or not (1 <= len(proof['matchingEventId']) <= 512):
        raise Denied('RPC_FACTS_DO_NOT_MATCH_ORIGINAL_APPROVAL')
    # RPC latestLedger, pagination and response hashes change after finality.
    # Hash immutable, independently verified facts for idempotent accounting.
    return {'schema': 'stellar-forge.sf36.verified-facts.v1', **expected,
        'request_sha256': request_sha, 'ledger': proof['ledger'],
        'eventId': proof['matchingEventId']}


def finalize_source(governor, source, payer, *, node):
    record, request, request_sha = approved_record(source)
    row = governor.reservation(request)
    receipt = record['receipt']
    if receipt.get('payer') != payer:
        raise Denied('TRUSTED_PAYER_DOES_NOT_MATCH_ORIGINAL_RECEIPT')
    # One canonical receipt string keeps the original governor's network-level
    # receipt reuse protection effective across different request IDs.
    receipt_ref = request['network'] + '/' + receipt['transaction']
    if row['state'] == 'settled':
        if row['receipt_ref'] != receipt_ref or row['actual'] != request['max_amount']:
            raise Denied('EXISTING_FINALITY_CONFLICT')
        return {'schema': SCHEMA, 'outcome': 'IDEMPOTENT_FINALIZED',
            'request_id': request['request_id'], 'actual': row['actual'],
            'receipt_ref': receipt_ref, 'proof_sha256': row['proof_sha256'],
            'chainObservation': 'ORIGINAL_AUDITED_FINALIZATION_REUSED'}
    proof = run_adapter(node, {'action': 'observe', 'source': source, 'payer': payer})
    facts = verified_facts(proof, request, request_sha, receipt['transaction'], payer)
    # Audit again after network IO, before issuing authority. Original reconcile
    # then takes its own immediate transaction and rechecks journal/projection.
    governor.reservation(request)
    proof_sha = hashlib.sha256(canonical(facts)).hexdigest()
    attestation = issue_finality_attestation(governor.ok, request['request_id'],
        request['max_amount'], receipt_ref, proof_sha)
    result = governor.reconcile(attestation)
    return {'schema': SCHEMA, **result, 'receipt_ref': receipt_ref,
        'proof_sha256': proof_sha, 'verifiedFacts': facts,
        'chainObservation': 'FRESH_ORIGINAL_SF86_RPC'}


def write_report(directory: Path, source: Path, result):
    # The report is restartable output. Only original SF36 is accounting state.
    name = hashlib.sha256(str(source).encode('utf8')).hexdigest() + '.json'
    fd, temporary = tempfile.mkstemp(prefix='.finalize-', dir=directory)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(canonical(result) + b'\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, directory / name)
        parent = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sources = parser.add_mutually_exclusive_group(required=True)
    sources.add_argument('--record', type=Path, help='Private original SF81 record or SF82 evidence')
    sources.add_argument('--records-dir', type=Path, help='Private existing original evidence directory')
    parser.add_argument('--ledger', type=Path, required=True)
    parser.add_argument('--policy', type=Path, required=True)
    parser.add_argument('--payer', required=True, help='Actual account from trusted signer configuration')
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--reports', type=Path, required=True, help='Separate existing private output directory')
    parser.add_argument('--outbox', type=Path, help='Existing original merchant SF98 private outbox')
    parser.add_argument('--merchant-route', help='Independently selected original seller route ID')
    parser.add_argument('--watch-seconds', type=int, default=0, help='0: one sweep; >=30: repeat read-only observation')
    args = parser.parse_args(argv)
    stop = threading.Event()
    try:
        if not args.node or not Path(args.node).is_absolute() or not Path(args.node).is_file() or not os.access(args.node, os.X_OK):
            raise Denied('TRUSTED_ABSOLUTE_NODE_EXECUTABLE_REQUIRED')
        if not re.fullmatch(r'G[A-Z2-7]{55}', args.payer):
            raise Denied('TRUSTED_CLASSIC_PAYER_REQUIRED')
        if args.watch_seconds and args.watch_seconds < 30:
            raise Denied('WATCH_INTERVAL_MUST_BE_AT_LEAST_30_SECONDS')
        check_ledger_path(args.ledger)
        private_path(args.ledger)  # MUST exist; Governor must not create a new ledger.
        private_path(args.reports, directory=True)
        if args.record and args.record.parent == args.reports:
            raise Denied('REPORTS_MUST_BE_SEPARATE_FROM_ORIGINAL_EVIDENCE')
        if args.records_dir:
            private_path(args.records_dir, directory=True)
            if args.records_dir == args.reports:
                raise Denied('REPORTS_MUST_BE_SEPARATE_FROM_ORIGINAL_EVIDENCE')
        if bool(args.outbox) != bool(args.merchant_route):
            raise Denied('OUTBOX_AND_ORIGINAL_MERCHANT_ROUTE_REQUIRED_TOGETHER')
        if args.outbox:
            private_path(args.outbox, directory=True)
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', args.merchant_route):
                raise Denied('INVALID_ORIGINAL_MERCHANT_ROUTE')
            for name in ('events.ndjson', 'deliveries.ndjson'):
                path = args.outbox / name
                if path.exists():
                    private_path(path)
        policy = read_source(args.policy, private=False)
        keys = [key_from_environment('SF36_' + name + '_KEY_B64')
                for name in ('CONSENT', 'AUDIT', 'OPERATOR')]
        os.umask(0o077)
        governor = Governor(args.ledger, policy, *keys)
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
        signal.signal(signal.SIGINT, lambda *_: stop.set())
        try:
            while not stop.is_set():
                paths = [args.record] if args.record else sorted(args.records_dir.glob('*.json'))
                failed = 0
                for path in paths:
                    if stop.is_set():
                        break
                    try:
                        source = read_source(path)
                        result = finalize_source(governor, source, args.payer, node=args.node)
                        result['merchant'] = {'status': 'NOT_CONFIGURED'}
                        if args.outbox:
                            try:
                                result['merchant'] = run_adapter(args.node, {'action': 'merchant',
                                    'source': source, 'outbox': str(args.outbox), 'route': args.merchant_route})
                            except (Denied, OSError, ValueError, subprocess.TimeoutExpired):
                                result['merchant'] = {'status': 'ORIGINAL_MERCHANT_JOURNAL_READ_FAILED'}
                    except (Denied, OSError, ValueError, TypeError, KeyError, subprocess.TimeoutExpired) as error:
                        failed += 1
                        result = {'schema': SCHEMA, 'outcome': 'NOT_FINALIZED',
                            'reason': str(error) if isinstance(error, Denied) else 'SOURCE_OR_OBSERVER_IO_FAILED',
                            'reservation': 'UNCHANGED_BY_THIS_ATTEMPT'}
                    write_report(args.reports, path, result)
                    print(json.dumps(result, sort_keys=True, ensure_ascii=True), flush=True)
                if not args.watch_seconds:
                    return 2 if failed else 0
                stop.wait(args.watch_seconds)
        finally:
            governor.close()
        return 0
    except (Denied, OSError, ValueError, TypeError) as error:
        print(json.dumps({'schema': SCHEMA, 'outcome': 'WORKER_ERROR',
            'reason': str(error) if isinstance(error, Denied) else 'OPERATOR_IO_OR_CONFIGURATION_ERROR',
            'accounting': 'INSPECT_ORIGINAL_LEDGER_REPORT_WRITE_MAY_HAVE_FOLLOWED_FINALIZATION'}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
