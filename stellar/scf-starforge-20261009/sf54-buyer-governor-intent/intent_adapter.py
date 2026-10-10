"""SF54: map the original SF31 immutable approval intent to the SF36 consent shape.

Read-only, keyless composition over the *actual* SF36 canonical/validation API.
Never issue a permit, create a reservation, approve a purchase, or sign a payment.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

SOURCE_DIR = Path(__file__).resolve().parents[1] / 'sf36-spend-governor'
sys.path.insert(0, str(SOURCE_DIR))
from governor import Denied, canonical, parse_amount, validate_request  # noqa: E402

INTENT_FIELDS = frozenset({
    'intentId', 'url', 'method', 'scheme', 'network', 'amount', 'asset', 'payTo',
    'maxAtomic', 'maxTimeoutSeconds', 'acceptedTerms', 'bodyPresent',
    'bodyBytes', 'bodySha256',
})
TERM_PAIRS = (
    ('scheme', 'scheme'), ('network', 'network'), ('amount', 'amount'),
    ('asset', 'asset'), ('payTo', 'payTo'),
    ('maxTimeoutSeconds', 'maxTimeoutSeconds'),
)


def buyer_intent_to_governor_request(intent: Any, *, actor: str, service: str) -> dict[str, Any]:
    """Fail closed on SF31/SF36 contract drift and bind the *full* accepted terms.

    This is a serialization boundary, NOT an approval. Trusted owners must bind
    the actual quote, operator consent, reservation and signer out of process.
    """
    if type(intent) is not dict or set(intent) != INTENT_FIELDS:
        raise Denied('SF31_APPROVAL_INTENT_SCHEMA_MISMATCH')
    terms = intent['acceptedTerms']
    if type(terms) is not dict or intent['scheme'] != 'exact':
        raise Denied('SF31_EXACT_TERMS_REQUIRED')
    for original, mirror in TERM_PAIRS:
        if original not in terms or type(terms[original]) is not type(intent[mirror]) or terms[original] != intent[mirror]:
            raise Denied('SF31_TERMS_MIRROR_MISMATCH_' + original)
    if type(intent['maxAtomic']) is not str:
        raise Denied('SF31_MAX_ATOMIC_INVALID')
    offered = parse_amount(terms['amount'], 'accepted_amount')
    cap = parse_amount(intent['maxAtomic'], 'maxAtomic')
    if offered < 1 or offered > cap:
        raise Denied('SF31_SPEND_CAP_EXCEEDED')
    # Reuse SF36's exact Python ensure_ascii/sorted-key canonicalization. Never
    # reimplement this with JS key order or a lossy floating point conversion.
    digest = hashlib.sha256(canonical(terms)).hexdigest()
    request = {
        'request_id': intent['intentId'],
        'actor': actor,
        'service': service,
        'network': terms['network'],
        'asset': terms['asset'],
        'scheme': terms['scheme'],
        # Reserve the actual exact quoted amount, not the larger operator cap.
        'max_amount': terms['amount'],
        'resource': intent['url'],
        'pay_to': terms['payTo'],
        'max_timeout_seconds': terms['maxTimeoutSeconds'],
        'method': intent['method'],
        'body_present': intent['bodyPresent'],
        'body_bytes': intent['bodyBytes'],
        'body_sha256': intent['bodySha256'],
        'accepted_terms_sha256': digest,
    }
    return validate_request(request)


def cli() -> int:
    parser = argparse.ArgumentParser(description='Read-only SF31 approval intent to SF36 exact request')
    parser.add_argument('--actor', required=True)
    parser.add_argument('--service', required=True)
    args = parser.parse_args()
    try:
        raw = sys.stdin.buffer.read(65537)
        if len(raw) > 65536:
            raise Denied('SF31_INTENT_INPUT_TOO_LARGE')
        intent = json.loads(raw.decode('utf8'), parse_constant=lambda _: (_ for _ in ()).throw(Denied('NONFINITE_JSON')))
        request = buyer_intent_to_governor_request(intent, actor=args.actor, service=args.service)
    except (Denied, UnicodeError, json.JSONDecodeError, ValueError, TypeError, KeyError) as exc:
        print('DENIED: ' + str(exc), file=sys.stderr)
        return 2
    sys.stdout.write(json.dumps({'schema': 'stellar-forge.sf54.governor-request.v1',
        'request': request}, sort_keys=True, separators=(',', ':')) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(cli())
