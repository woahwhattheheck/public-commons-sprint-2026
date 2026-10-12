"""SF62: interactive, local human authorization for original SF31/SF54/SF36/SF59.

An operator-side command, not an agent API, payment signer or network service.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[1]
for module in ('sf36-spend-governor', 'sf54-buyer-governor-intent', 'sf59-operator-reservation-gate'):
    sys.path.insert(0, str(ROOT / module))
from governor import Denied, Governor, canonical, issue_consent  # type: ignore[import-not-found]  # noqa: E402
from intent_adapter import buyer_intent_to_governor_request  # type: ignore[import-not-found]  # noqa: E402
from operator_gate import (  # type: ignore[import-not-found]  # noqa: E402
    ReservationApprovalDenied, reserve_for_approval,
)

MAX_INPUT = 65_536


def load_json(path: Path) -> dict:
    if not path.is_file() or path.stat().st_size > MAX_INPUT:
        raise Denied('INPUT_FILE_MISSING_OR_TOO_LARGE')
    with path.open('rb') as source:
        raw = source.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        raise Denied('INPUT_TOO_LARGE')
    obj = json.loads(raw.decode('utf-8'),
                     parse_constant=lambda _: (_ for _ in ()).throw(Denied('NONFINITE_JSON')))
    if type(obj) is not dict:
        raise Denied('OBJECT_REQUIRED')
    return obj


def key_from_environment(name: str) -> bytes:
    encoded = os.environ.get(name, '')
    try:
        key = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise Denied('INVALID_BASE64_KEY_' + name) from error
    if len(key) < 32:
        raise Denied('KEY_TOO_SHORT_' + name)
    return key


def check_ledger_path(path: Path) -> None:
    if not path.is_absolute() or str(path) == ':memory:':
        raise Denied('LEDGER_PATH_MUST_BE_ABSOLUTE_ON_DISK')
    # Never allow a privileged operator's wallet budget journal to be redirected
    # through a symlink or kept in a shared group/world writable directory.
    if path.is_symlink():
        raise Denied('LEDGER_SYMLINK_REFUSED')
    parent = path.parent
    if not parent.is_dir() or parent.is_symlink():
        raise Denied('LEDGER_DIRECTORY_MISSING_OR_SYMLINK')
    mode = parent.stat().st_mode
    if mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise Denied('LEDGER_DIRECTORY_MUST_NOT_BE_SHARED_WRITABLE')
    if path.exists() and (not path.is_file() or path.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO)):
        raise Denied('LEDGER_FILE_NOT_PRIVATE')


def review_payload(intent: dict, request: dict) -> tuple[dict, str]:
    digest = hashlib.sha256(canonical(request)).hexdigest()
    # Output uses JSON escapes so hostile metadata cannot inject terminal control
    # characters into the prompt or visually disguise the signed payment terms.
    data = {
        'schema': 'stellar-forge.sf62.operator-review.v1',
        'request_sha256': digest,
        'request_id': request['request_id'],
        'actor': request['actor'], 'service': request['service'],
        'resource': request['resource'], 'method': request['method'],
        'scheme': request['scheme'], 'network': request['network'],
        'asset': request['asset'], 'pay_to': request['pay_to'],
        'max_atomic_units_to_reserve': request['max_amount'],
        'max_timeout_seconds': request['max_timeout_seconds'],
        'body_present': request['body_present'],
        'body_bytes': request['body_bytes'],
        'body_sha256': request['body_sha256'],
        'accepted_terms_sha256': request['accepted_terms_sha256'],
        'complete_original_accepted_terms': intent['acceptedTerms'],
    }
    return data, 'APPROVE ' + digest[:16]


def reserve_reviewed(intent: dict, request: dict, *, policy_path: Path,
                     ledger_path: Path, confirm_review) -> dict:
    """Trusted host review channel over the original SF36/SF59 reservation.

    The channel receives the native mapped request and current policy estimate.
    It must return this exact request digest after the operator's decision.
    Construction of the channel is privileged host configuration.
    """
    if not callable(confirm_review):
        raise Denied('OPERATOR_REVIEW_CHANNEL_REQUIRED')
    check_ledger_path(ledger_path)
    policy = load_json(policy_path)
    ck = key_from_environment('SF36_CONSENT_KEY_B64')
    ak = key_from_environment('SF36_AUDIT_KEY_B64')
    ok = key_from_environment('SF36_OPERATOR_KEY_B64')
    # SQLite creates private files using this process's restricted umask.
    os.umask(0o077)
    governor = Governor(str(ledger_path), policy, ck, ak, ok)
    try:
        estimate = governor.estimate(request)
        review, _ = review_payload(intent, request)
        if not estimate.get('approved'):
            raise Denied('SPEND_POLICY_ESTIMATE_DENIED')
        digest = review['request_sha256']
        # Pass a detached JSON projection so a host renderer cannot mutate the
        # reviewed digest, original request or estimate while displaying them.
        presented = json.loads(json.dumps({'review': review,
            'current_native_budget_estimate': estimate}, ensure_ascii=True))
        if confirm_review(presented) != digest:
            raise Denied('EXPLICIT_OPERATOR_CONSENT_NOT_GIVEN')

        def operator_issue(mapped: dict) -> str:
            if mapped != request or hashlib.sha256(canonical(mapped)).hexdigest() != digest:
                raise Denied('MAPPED_INTENT_CHANGED_AFTER_OPERATOR_REVIEW')
            expiry = datetime.now(timezone.utc) + timedelta(minutes=5)
            return issue_consent(ck, mapped, expiry.isoformat())

        # This native gate refuses an old/duplicate request_id even if the owner
        # supplied the exact same typed command again. It alone returns TRUE.
        approved = reserve_for_approval(
            intent, actor=request['actor'], service=request['service'],
            governor=governor, consent_for_request=operator_issue,
        )
        if approved is not True:
            raise Denied('NO_FRESH_DURABLE_RESERVATION')
        return {
            'schema': 'stellar-forge.sf62.result.v1',
            'outcome': 'FRESH_RESERVATION_APPROVED',
            'request_id': request['request_id'],
            'request_sha256': digest,
            # Retain the exact non-secret intent whose digest is in SF36. A
            # smaller network/amount summary cannot authorize reconciliation.
            'approved_request': request.copy(),
            'reserved_atomic_units': request['max_amount'],
            'network': request['network'],
            'asset': request['asset'],
            'signed_requests': 0, 'wallet_calls': 0, 'payments_confirmed': 0,
            'next_action': 'SEPARATE_APPROVED_SIGNER_AND_TRUSTED_FINALITY_RECONCILIATION',
        }
    finally:
        governor.close()


def reserve_interactive(intent: dict, request: dict, *, policy_path: Path,
                        ledger_path: Path, terminal) -> dict:
    """Original controlling-terminal presentation of the shared native gate."""
    if terminal is None:
        raise Denied('CONTROLLING_TERMINAL_REQUIRED')

    def confirm(presented: dict) -> str | None:
        digest = presented['review']['request_sha256']
        confirmation = 'APPROVE ' + digest[:16]
        print(json.dumps(presented, sort_keys=True, indent=2, ensure_ascii=True))
        print('A reserve is NOT a payment, a signature or a finalized receipt.', flush=True)
        print('To authorize ONE fresh reservation, type exactly: ' + confirmation, flush=True)
        return digest if terminal.readline(100).rstrip('\r\n') == confirmation else None

    return reserve_reviewed(intent, request, policy_path=policy_path,
                            ledger_path=ledger_path, confirm_review=confirm)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description='Original SCF x402 human review and durable budget reservation')
    p.add_argument('--intent', type=Path, required=True, help='Exact JSON emitted by the SF31 approval callback')
    p.add_argument('--actor', required=True, help='Owner-verified agent identity')
    p.add_argument('--service', required=True, help='Owner-verified seller/service identity')
    p.add_argument('--reserve', action='store_true', help='Requires a human at a controlling terminal and real policy/ledger/keys')
    p.add_argument('--policy', type=Path, help='Original SF36 JSON budget policy')
    p.add_argument('--ledger', type=Path, help='Private absolute durable SQLite WAL file')
    args = p.parse_args(argv)
    try:
        intent = load_json(args.intent)
        request = buyer_intent_to_governor_request(intent, actor=args.actor, service=args.service)
        review, _ = review_payload(intent, request)
        if not args.reserve:
            print(json.dumps({'outcome': 'PREVIEW_ONLY_NO_RESERVATION', 'review': review},
                             sort_keys=True, indent=2, ensure_ascii=True))
            return 0
        if args.policy is None or args.ledger is None:
            raise Denied('RESERVE_REQUIRES_POLICY_AND_LEDGER')
        try:
            with open('/dev/tty', 'r', encoding='utf-8') as terminal:
                result = reserve_interactive(intent, request,
                                             policy_path=args.policy, ledger_path=args.ledger,
                                             terminal=terminal)
        except OSError as error:
            raise Denied('CONTROLLING_TERMINAL_REQUIRED') from error
        print(json.dumps(result, sort_keys=True, ensure_ascii=True))
        return 0
    except (Denied, ReservationApprovalDenied, ValueError, TypeError,
            KeyError, OSError, UnicodeError, json.JSONDecodeError) as error:
        print(json.dumps({'outcome': 'DENIED_NO_NEW_APPROVAL', 'reason': str(error)},
                         sort_keys=True, ensure_ascii=True), file=sys.stderr)
        return 2

if __name__ == '__main__':
    raise SystemExit(main())

