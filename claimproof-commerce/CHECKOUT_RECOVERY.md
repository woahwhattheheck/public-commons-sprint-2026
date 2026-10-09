# Sandbox checkout recovery

The **Check sandbox order status** button reads the existing order through `POST /api/status`; the PayPal operation is a GET, not another capture. It uses the same local review ID and cart fingerprint. A pending capture stays pending until PayPal's nested capture record reports `COMPLETED` with a matching identity, USD currency and amount. The outer order's `COMPLETED` value alone is not settlement proof.

An authorized capture checks the order before its POST and re-reads afterward, including when the POST returns only a minimal response. Existing pending or settled capture records prevent a second capture POST. Repeating `/api/capture` on a locally pending review takes the read-only path. A missing or inconsistent record requires investigation rather than a success label.

Concurrent identical operations on one review share the same in-flight result. Different simultaneous operations on that review are rejected until the current operation finishes. This is per-review, in-process coalescing, not a distributed lock. Stable PayPal request IDs remain unchanged. OAuth refreshes are shared and tokens are reused only within their returned expiry; failed refreshes clear, and a 401 evicts the rejected token without automatically replaying a payment mutation.

A timeout is still an **unknown outcome**, not a failed payment. Use the read-only check on the existing review first. Any deliberate retry of an uncertain capture must retain that review's existing request ID; never start a new checkout merely because a response was lost. Reviews expire after 30 minutes and disappear on restart. Resolve older outcomes in the PayPal sandbox dashboard. No production endpoint or background polling is added.

## Execution evidence, October 9, 2026

The focused Node contracts passed with a synthetic transport. An actual local HTTP server run confirmed that simultaneous create calls emitted one create, simultaneous capture calls emitted one capture, and a pending result became settled through the read-only status route. One token served that entire exercised checkout. Browser JavaScript passed syntax checking; the attempted Chromium UI run was blocked by environment policy (`ERR_BLOCKED_BY_ADMINISTRATOR`), so browser interaction is not claimed as tested. No real PayPal account, model request, buyer approval, payment or competition submission occurred in those checks.

## Competition completion

A real, authorized PayPal sandbox run and functioning AI integration are still required before presenting the app as an integrated competition entry. Keep existing credentials outside source and logs. Record sanitized order/capture evidence, demonstrate the actual application in a public YouTube video under three minutes, and submit the original entry with the public licensed source and complete setup/run instructions.

The official rules permit a reproducible runnable demo instead of public hosting. Do not open this deliberately loopback-only server to the internet just to satisfy an invented hosting prerequisite. The advertised submission deadline is November 12, 2026, noon Pacific. Original contributor credit and all eligible entrant prize claims remain preserved; no award or receipt of money is asserted.

References:
- PayPal authentication and token expiry: https://developer.paypal.com/api/rest/authentication/
- PayPal uncertain capture outcomes and idempotency: https://developer.paypal.com/api/rest/responses/
- PayPal Orders v2 integration, capture records: https://developer.paypal.com/api/rest/integration/orders-api/v1-v2-migration
- Official competition rules: https://paypalaihackathon.devpost.com/rules
