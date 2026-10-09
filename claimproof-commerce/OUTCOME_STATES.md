# Sandbox capture outcomes

This extends the read-only reconciliation and OAuth/coalescing work in PR #213. It does not replace that implementation or create a separate competition entry.

## Unknown is not failed

Once a capture POST may have left the process, a transport error, malformed response or failed follow-up read leaves the review in `CAPTURE_UNKNOWN`. The endpoint returns HTTP 202 with that state. A later APPROVED order without a capture does not clear the uncertainty. Both the status action and a repeated capture action for this review read the existing order only; they never issue another capture POST.

Errors before the capture request, such as missing buyer approval or a mismatched cart, still reject the operation without manufacturing a pending payment.

## Terminal outcomes stay distinct

A verified capture that is DECLINED, DENIED or FAILED becomes `CAPTURE_FAILED`. REFUNDED or PARTIALLY_REFUNDED becomes `CAPTURE_REVERSED`; a voided order becomes `ORDER_VOIDED`. These states never authorize a new capture. A verified refund may replace a previously displayed successful capture. A stale success response must not turn a known refund back into a paid receipt. Order identity, intent, exact USD amount and capture identity remain verified before state changes.

The checkout UI hides capture approval controls for uncertain and terminal outcomes, while leaving the explicit read-only status control usable. A result marked UNKNOWN is not a claim of payment, rejection or refund.

## Reproduction

```sh
node --test tests/focused.test.mjs tests/outcome-reconciliation.test.mjs
```

The three new regression cases failed against the original PR #213 source and passed after this follow-through. Combined with the nine unchanged focused cases, 12 passed in the cloud container. Actual loopback HTTP routes were exercised with an isolated synthetic PayPal transport. The lost-response case performed one create, one capture and one OAuth request despite repeated capture/status actions. The terminal-outcome case sent no capture request. UI logic was exercised with a DOM stub, not a rendered-browser test.

No real provider credentials, payment, competition entry or award receipt is established by these checks. Original contributor credit and eligible entrant prize/payment claims remain intact. State is still in memory for 30 minutes and is not durable across restarts; reconcile unknown outcomes with the original sandbox order before creating another checkout. Needs expert review before production-payment use.

Provider references:
- https://developer.paypal.com/api/orders/v2/definitions/order_status
- https://developer.paypal.com/api/payments/v2/definitions/capture_status
