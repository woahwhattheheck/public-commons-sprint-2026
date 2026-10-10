# SF59 | Buyer approval only after original durable reservation

**New integration, not a replacement payment engine.** Source: original SF31 buyer client (buyer.mjs) calls its asynchronous approve(intent) before any signing; original SF54 intent_adapter.py maps the exact immutable offer to the strict 15-field SF36 request; original SF36 Governor.reserve() enforces separately issued operator authorization, budget and durable SQLite WAL reservation. This implementation uses all three original modules without modifying their owners' files.

## Operational integration

The exported Python function reserve_for_approval(intent, actor=..., service=..., governor=..., consent_for_request=...) is intended for a **trusted, operator-controlled service**. On its default code path, it imports the real SF54 mapper from the same SCF checkout, which in turn imports and validates against the real SF36 governor. A separately privileged consent provider must verify the original operator's purchase decision and genuine SF31 quote, then issue the SF36 exact-request consent. Its authorization is not interchangeable with a text message or an arbitrary agent assertion. The existing Governor.reserve must atomically return a NEW RESERVED result for the exact request ID, amount, scheme, network and asset; only then does the gate return True to the buyer caller.

A previous reservation, including IDEMPOTENT_EXISTING, is deliberately NOT a new authorization to sign and retry. Missing consent, malformed source intent, identity drift, budget exhaustion, a provider exception or unexpected reserve receipt all fail closed. The original SF31 signed request remains one-shot. If the reserve succeeds but the caller crashes or signing/network delivery fails, the maximum stays reserved until the separate trusted SF36 finality operator reconciles the actual outcome. There is no automatic refund for an unknown transaction.

### Example trusted-service use

    from operator_gate import reserve_for_approval

    def approve_from_authenticated_buyer_context(intent):
        return reserve_for_approval(
            intent, actor='approved-agent', service='verified-merchant',
            governor=governor,
            consent_for_request=independently_authorize_and_issue_permit,
        )

The governor must be the original authenticated SF36 instance backed by a durable on-disk ledger. The separately controlled authorization function must bind the human's decision to the **complete accepted payment requirement** and its source; it must NOT be accessible to untrusted agents. The privileged service must authenticate its caller, bind it to the original SF31 invocation and never share operator signing keys, consent-issuer keys or database access. The optional intent_mapper injection is solely for isolated focused checks; any production integration must pin and verify the original SF54/SF36 implementations.

## Focused behavior check

Python 3.10+, standard library, no packages or GitHub Actions:

    cd stellar/scf-starforge-20261009/sf59-operator-reservation-gate
    python3 -m unittest -q test_operator_gate.py

The six focused assertions exercise fresh reservation only, duplicate denial, unapproved rejection, malformed intent rejection, actor drift and governor rejection. The isolated test uses a governor double and source-mapper double. It is not independent live proof of Stellar payment, complete authentication wiring or end-to-end SF31/SF54/SF36 execution; their already-merged original source contracts are required at deployment. This lane initiates no wallet, token transfer, network request, provider submission, grant form, or external commercial contact.

## Handoff

Owner of SF31 maintains HTTP buyer retry and official x402 signer integration. Owner of SF54 maintains complete quote serialization. Owner of SF36 maintains consent issuing and durable budget/finality ledger. Owner of SF43/Muse maintains genuine original-wire and network acceptance checks. SF59 adds the missing **post-consent reserve-result gate** only; it is not a new competing scheme or simulation controller.
