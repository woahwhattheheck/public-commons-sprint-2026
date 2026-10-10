"""Fail-closed SF31 -> SF54 -> SF36 reservation gate for trusted operators.

No outbound networking, token minting, signer access, keys or payment execution.
This is a *privileged-side* adapter, not a callback implementation to expose
inside an untrusted agent or public server.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any


class ReservationApprovalDenied(RuntimeError):
    """A fresh, fully bound reservation has not been established."""


def reserve_for_approval(
    intent: Mapping[str, Any],
    *,
    actor: str,
    service: str,
    governor: Any,
    consent_for_request: Callable[[dict[str, Any]], str],
    intent_mapper: Callable[..., dict[str, Any]] | None = None,
) -> bool:
    """Return True ONLY on a new SF36 durable reservation of this SF31 intent.

    The trusted service supplies (1) an existing genuine SF36 Governor,
    (2) a separate privileged consent provider that validates actual human
    authorization and binds the complete SF54 request, and (3) the original
    SF31 callback intent. Never place the consent issuer's key inside an agent.

    A reserved duplicate is intentionally rejected: allowing a second SF31
    callback to sign could replay a signed payment attempt. An unsettled
    reservation remains held after any downstream signer/transport failure;
    only the original trusted finality path can reconcile it.
    """
    if intent_mapper is None:
        # The original SF54 contract, loaded from the same SCF checkout.
        from pathlib import Path
        import sys
        sf54 = Path(__file__).resolve().parents[1] / 'sf54-buyer-governor-intent'
        if str(sf54) not in sys.path:
            sys.path.insert(0, str(sf54))
        from intent_adapter import buyer_intent_to_governor_request
        intent_mapper = buyer_intent_to_governor_request

    # This call invokes SF36 validate_request through the real SF54 adapter.
    request = intent_mapper(dict(intent), actor=actor, service=service)
    if not isinstance(request, dict) or not request:
        raise ReservationApprovalDenied('INVALID_MAPPED_INTENT')
    if request.get('actor') != actor or request.get('service') != service:
        raise ReservationApprovalDenied('OPERATOR_IDENTITY_DRIFT')
    if not callable(consent_for_request):
        raise ReservationApprovalDenied('NO_PRIVILEGED_CONSENT_PROVIDER')

    # Provider must *independently* authorize; obtaining a token is not
    # evidence of owner consent unless issued by the privileged issuer.
    permit = consent_for_request(request)
    if not isinstance(permit, str) or not permit or len(permit) > 8192:
        raise ReservationApprovalDenied('CONSENT_NOT_GRANTED')

    # SF36 atomically checks the bound owner permit, the actual caps,
    # durable WAL state and idempotent request ID before returning.
    result = governor.reserve(request, permit)
    if not isinstance(result, dict) or result.get('outcome') != 'RESERVED':
        raise ReservationApprovalDenied('NO_FRESH_RESERVATION')
    for expected_field, actual_field in (
        ('request_id', 'request_id'),
        ('max_amount', 'max_amount'),
        ('scheme', 'scheme'),
        ('network', 'network'),
        ('asset', 'asset'),
    ):
        if result.get(actual_field) != request.get(expected_field):
            raise ReservationApprovalDenied('RESERVATION_RESPONSE_MISMATCH')
    return True
