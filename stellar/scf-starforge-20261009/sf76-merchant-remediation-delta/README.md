# SF76 · Original-source merchant repair delta

**Goal:** turn an agreed seller diagnosis and repair into an acceptance document that one merchant and one engineer can inspect, without inventing paid checkouts. Node 22+, built-in modules only; no network requests. Does not replace SF49 commercial qualification, SF52 seller observations, SF70 merchant intake, SF72 POST preflight, or SF74 operator console.

1. With merchant permission, run original SF70 `run.mjs` BEFORE a repair with the agreed seller resource, facilitator catalog, exact Stellar network, payTo, buyer origin and retry method. Retain the emitted source JSON bytes (0600). For genuine POST-only HTTP offers, run original SF72 `preflight.mjs` on that exact file and retain the resulting JSON bytes.
2. Apply and deploy the merchant-approved implementation change with their engineer (e.g. SF69 CORS middleware for relevant browser settings). Re-run identical original SF70 scope AFTER. For POST, repeat SF72 on the second exact intake. Do not swap seller URLs, buyer origins, networks, recipients, facilitator or method between captures.
3. Compare the two original-source captures from the **public repository root**:

```sh
node stellar/scf-starforge-20261009/sf76-merchant-remediation-delta/compare.mjs \
  --before /private/seller-before-sf70.json --after /private/seller-after-sf70.json \
  --out /private/seller-remediation-delta.json
```

For POST-only HTTP, add `--sf72-before /private/post-before-sf72.json --sf72-after /private/post-after-sf72.json`. The SF72 files are accepted only if each includes the SHA-256 of the **exact** respective SF70 JSON bytes, and its scope and timing match. A mismatched payment recipient, network, resource, catalog, origin or method fails rather than fabricating a before/after improvement. Unchanged filenames aren't required; unchanged **source scope** is.

The program calculates SHA-256 of each original JSON file, preserves exact original classification and observation timestamps, and lists resolved/not-reobserved, introduced, retained and severity-changed original findings. Incomplete after-catalog coverage never counts a missing old finding as a resolved issue. Output is one create-only JSON report, mode 0600, never an overwrite; stdout also prints it. Exit `0` means an **unpaid** technical milestone is observed, `2` means HIGH remediation remains, `3` means technically inconclusive, `1` means invalid source/input. This is **not** authorization to send payment-bearing requests, sign, settle, collect fees, or contact an endpoint without operator permission.

*GET path:* `GET_UNPAID_DISCOVERY_AND_BROWSER_READY` means original SF70's fully observed unpaid 402/browser behavior and catalog listing look consistent. *POST path:* `POST_OPTIONS_READY_CHALLENGE_UNCHECKED` means original SF52 complete catalog proved the selected POST-only operation and original SF72 observed permitted browser OPTIONS. The actual POST x402 challenge, paid retry, receipt and service delivery remain **unverified**. Other methods remain inconclusive until their own original source support exists. Even a clean result does not prove a seller signed a contract or a purchaser paid.

## Commercial owner handoff

Give the existing SF49 owner the immutable BEFORE source, optional BEFORE SF72, owner-approved change identifier, AFTER source, optional AFTER SF72, and SF76 JSON. Define acceptance for one actual paid remediation workshare against the client's agreed route, not a generic storefront. Obtain a *separate* seller sign-off and payment agreement. Do not publish private commercial URLs, keys or buyer-origin information to public issues. No Actions workflows or hosted build required.
