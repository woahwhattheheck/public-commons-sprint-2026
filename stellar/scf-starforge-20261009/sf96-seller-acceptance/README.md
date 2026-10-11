# SF96 | Original seller route acceptance

A merchant go-live reviewer for the **existing** SF30 Stellar x402 seller, not a second server or payments stack. Its goal is to catch a commercially disastrous failure that health/offers dashboards alone cannot detect: a real local resource method returning 200, 404, 500, or an HTTP 402 with different network, asset, recipient, price, method or input schema than the seller advertised.

The product reads the actual original `/_seller/health` and `/_seller/offers` responses from one running loopback seller; then, **only if its own mode is `CHALLENGE_ONLY`**, invokes each eligible route using its original GET/HEAD method. The resource server's real `PAYMENT-REQUIRED` x402 v2 HTTP header is decoded, checked and compared against the *same live seller's* corresponding advertised canonical offer. It does not use mock challenge fixtures for audit decisions.

The tool emits four private, create-only merchant handoff artifacts: `audit.json`, `review.html` (offline, no network scripts), `acceptance.md` (operator action queue) and source/file hashes in `manifest.json`. Output directories must not already exist. This complements SF93's actual traffic/latency bundle, SF85's external one-shot acquisition, SF74's merchant workbench and SF82's original seller launcher. None are replaced.

## Operate the **original** runtime

Run Node 22+ from a complete public sprint repository checkout. In terminal A start an original SF30 challenge-only seller (no facilitator, wallet, credentials or buyer execution):

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$S/serve.mjs" --config "$S/examples/service.json" --port 0
```

Read the `url` in its actual JSON startup line, then in terminal B:

```sh
node stellar/scf-starforge-20261009/sf96-seller-acceptance/audit.mjs \
  --seller http://127.0.0.1:ACTUAL_PORT --out /tmp/scf96-merchant-run-001
```

Open `/tmp/scf96-merchant-run-001/review.html` locally, review the actual challenge outcomes and fix flagged route/config differences. `PASS` means the *actual locally running original* seller's unpaid 402 advertisement matched its own original declared terms for that request. `NEEDS_INPUT` means no POST/dynamic request was issued and cannot be counted as success. `BLOCKED` means HTTP status/protocol/terms deviated or a probe failed. Full pass gives only `CHALLENGE_ONLY_ACCEPTANCE_COMPLETE`, not payable production acceptance. The CLI returns exit 1 for an incomplete technical run and exit 2 for acquisition/argument/export failure; the new private artifact is still written for an incomplete run.

### Explicit method and dynamic route cases

The tool **does not** send POST, PUT, PATCH or DELETE automatically, even to a challenge-only seller. Provide an operator case for the intended operation and any dynamic route. Only explicitly declared original route IDs, a matching fixed/template path and originally declared query-input names are allowed. A POST retains its existing `allowPost:true` and JSON `body`. PUT/PATCH/DELETE require `allowMethod` equal to the exact declared method; PUT and PATCH also require JSON `body`, while DELETE rejects a body. A mismatched `allowMethod` or unknown case field aborts before probing. Example:

```json
{
  "schema": "scf.sf96.operator-cases.v1",
  "routes": {
    "forecast": {
      "path": "/api/v2/forecast",
      "query": {},
      "body": {"latitude": 38.25, "longitude": -85.76},
      "allowPost": true
    },
    "items": {
      "path": "/api/items/ABC123",
      "query": {"language": "en"}
    },
    "update-item": {
      "path": "/api/items/ABC123",
      "allowMethod": "PATCH",
      "body": {"quantity": 4}
    },
    "remove-item": {
      "path": "/api/items/ABC123",
      "allowMethod": "DELETE"
    }
  }
}
```

The example fields are **illustrative**. Real route IDs, allowed query names and JSON body requirements must come from your actual SF30 seller offers. Keep real customer identifiers/bodies private. Pass `--cases /absolute/cases.json`. Dynamic `:field` path values must remain one safe segment; the tool disallows moving a case to an undeclared path or origin. These methods are attempted only while the original seller reports `CHALLENGE_ONLY`. No application handler or upstream receives the request in that original mode. Missing method selection or required body returns `NEEDS_INPUT` without sending that request.

### Include native traffic evidence from SF93

If the merchant has already captured the original SF93 support bundle from the **same** local seller and observer, supply its `bundle.json`:

```sh
node stellar/scf-starforge-20261009/sf96-seller-acceptance/audit.mjs \
  --seller http://127.0.0.1:ACTUAL_PORT \
  --support /private/SF93-BUNDLE/bundle.json \
  --out /private/NEW-SF96-ACCEPTANCE
```

It retains the original support-session ID and SHA, and compares route IDs/methods against the live seller to prevent mixing support captures from a different deployment. It does **not** merge SF93 request counts into synthetic transactions, rewrite source data or claim that sequential captures were atomic.

## Merchant acceptance boundary

An actual `CHALLENGE_ONLY` 402 shows advertised protocol/route coherence at the local listener, **not** publicly reachable HTTPS, independent buyer consent, payment facilitation, wallet/payee control, native signed payment, settlement, resource fulfillment, merchant adoption, SCF grant acceptance or revenue. The CLI intentionally **refuses to probe** resource routes whenever the native seller mode is `NATIVE_X402`. For authorized live payments use the existing original SF31/SF88, native x402 and chain receipt/settlement components separately, with the actual merchant's consent. The original seller examples contain deliberately nonpayable markers.

This is an industrial, offline, no-dependencies operator acceptance product. It starts no CI and no hosted workflow. Keep operator cases and generated reports out of public Git history; they may contain merchant route IDs, operational context or commercial payment terms. `audit.json` stores original offer and challenge SHA-256 fingerprints rather than full headers. The original seller/facilitator/SCF founder and SF49 customer relationship owners retain their scopes.
