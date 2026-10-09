# Capture-response reuse and cart-reference binding

This change composes with the pending-settlement, read-only status route, checkout
coalescing, and OAuth cache from PR #213. It preserves that implementation rather
than replacing its server, browser UI, existing tests, or operating notes.

## Delivered behavior

The capture request asks PayPal for `Prefer: return=representation`. When the
response includes its nested capture, the existing settlement validation checks
that record directly. A completed order with a pending capture remains pending;
completed settlement still requires matching order ID, capture ID, USD amount,
and both completed statuses. This removes one Orders GET from that path.

The official capture response may omit order intent and purchase-unit amount.
Those remain mandatory on the pre-capture GET. Any such fields supplied in the
capture response must still agree, and the capture's own amount is always required.
A supplied purchase-unit `reference_id` must match the reviewed cart fingerprint.
Contradictory records are rejected, not concealed by a second provider read.

Minimal responses and units without a capture retain PR #213's GET fallback. A
fallback never replays the capture POST. The sandbox-only endpoint, human consent,
review fingerprint, operation-specific idempotency key, expiry-aware OAuth cache,
and read-only pending recovery remain unchanged. This is a local prototype;
**Needs expert review before production use.**

## Focused checks

```sh
node --test tests/capture-representation.test.mjs
node --test --test-name-pattern='PayPal|capture|completed order|OAuth' tests/focused.test.mjs
```

Node 22.16.0: four new checks passed; six relevant existing PR #213 checks passed.
Mock complete representations used one pre-capture GET and one capture POST;
minimal/incomplete representations used two GETs and one POST. Rejected mismatches
did not trigger a fallback read or repeat the POST. All transports were synthetic;
no real credentials, OAuth exchange, model request, payment, or contest submission
was performed. The existing original contributors and entrant rights are preserved.

## Sources and composition

- Official response preference and capture schema:
  https://developer.paypal.com/api/orders/v2/orders-capture
- Existing settlement implementation: PR #213, merged commit
  `91aeb4b90142ac1b88fc1568d6b746e16d53dd88`.
- Verified adapter preimage: `bf3858e5f3707686cdec8534eaf6fa6ca33e25a7`.
- Verified unchanged existing test file: `af2072e96541cce7a44b717c82bd24d09d87363c`.

The earlier overlapping PR #211 draft was coalesced onto this merged baseline.
Its duplicate checkout helper, server/UI replacements, and obsolete test variant
are not part of the final contribution.
