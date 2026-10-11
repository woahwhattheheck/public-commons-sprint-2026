# SF85 · One merchant 402 change review, two actual captures

**Commercial workflow:** a merchant can migrate from x402 to MPP, add a charge/session offer, change a Stellar payment amount or recipient, or silently remove an option while both HTTP responses still say `402`. The existing **SF84 original capture inspector** evaluates a single authorized response. This module consumes **two unmodified original SF84-compatible raw HTTP 402 capture files** and produces a before/after change record the seller and our existing SF49 merchant operator can act on. It does not create an overlapping catalog-drift engine (SF79), a new paid buyer (SF31), or a replacement for the actual live merchant diagnostic and workorder (SF70/SF76/SF77).

**Who uses this:** The original SCF SF49 merchant relationship owner, for one seller-chosen resource and method, before promising migration work or signing a paid repair acceptance. It can also document the non-interchangeability of MPP and x402 for the SCF #46 founder narrative. Stellar officially supports `@stellar/mpp` **Charge** and **Session**, neither of which our existing x402 buyer implicitly understands.

## Actual operation, Node 22+

From the public sprint repository root:

```sh
node stellar/scf-starforge-20261009/sf85-merchant-rail-change-review/review.mjs \
  /private/seller-before.json /private/seller-after.json > /private/merchant-review.json

node stellar/scf-starforge-20261009/sf85-merchant-rail-change-review/review.mjs \
  /private/seller-before.json /private/seller-after.json --format markdown > /private/merchant-review.md
```

Use the **original SF84 input schema**: `status`, exact `url`, uppercase `method`, and ordered `headers` pairs or object. Keep original `PAYMENT-REQUIRED` and `WWW-Authenticate: Payment ...` challenge values unchanged. Both inputs must describe the **same merchant resource URL and method** to compare; otherwise the result explicitly requires source/scope review. Provide two separately observed captures with the seller's authority, not a seller URL for this tool to fetch. Credentials, cookies, authorization headers and payment signatures are rejected by imported SF84. No network calls, input rewrites, disk writes beyond the operator's stdout redirection, secrets, signing, settlement, payment, invoices, or hosted Actions.

The machine JSON and readable Markdown share one deterministic core:

- **Indivisible x402 terms:** compares each complete `(scheme, network, asset, payTo, amount, maxTimeoutSeconds)` tuple with multiplicity. Adding/removing/changing one option is recorded as removal plus addition. No mixing of x402 option fields, no x402 → MPP amount conversion.
- **MPP scope:** compares each `method`, `intent` (`charge` versus `session`), `realm`, and canonical original advertised request JSON digest. Challenge ID rotation is recorded separately so a rotating nonce does not automatically masquerade as an economic change.
- **Opaque drift:** if x402 source options have identical compared tuples but change additional fields or encoding, records their original per-offer digests separately. Does not silently certify those additional fields as equivalent.
- **Source and safety:** original raw file SHA-256, rail classification, missing fields, invalid or ambiguous headers, non-402 captures, method/url changes, x402 challenge resource/URL mismatch, unsupported MPP methods, empty/invalid monetary fields are explicitly surfaced. Incomplete captures cannot produce a clean technical comparison.

`decision` can be `SOURCE_OR_SCOPE_REVIEW_REQUIRED`, `MATERIAL_RAIL_CHANGE_REVIEW`, `MATERIAL_TERMS_SAME_OPAQUE_FIELDS_CHANGED`, or `NO_MATERIAL_RAIL_DELTA_OBSERVED`. Even the last means only that this *limited* field comparison detected no change, never merchant identity verification, valid signing, availability, paid buyer retry, Stellar ledger proof, seller approval, or evidence of revenue. Record original filenames, authorization, dates and any actual independent delivery/settlement receipts in the seller's separately agreed SF77 workflow. SF77's original SF70-based contract is **not** replaced or automatically signed by a 402 header review.

## Human merchant review sequence

1. Merchant selects one real live resource and method. Obtain **authorized**, safe-to-store pre/post HTTP 402 response captures through the same client path, without auth, payment proof or private values.
2. Run SF85 once. Show the seller the exact removed/added rail and individual recipient, asset, network, amount or MPP Charge/Session request. Resolve source-scope flags first; challenge IDs alone are not price evidence.
3. Agree on one specific repair/adoption milestone and use original SF70 → SF74/SF72 → SF76 → SF77 to qualify actual merchant browser and paid workflow when relevant. Keep one original relationship owner and approved commercial terms.
4. Recheck the original seller after an agreed change. If the original seller agrees on a priced pilot, use the existing single-owner SF49 outreach and provider-receipted acceptance process. Do not claim this output proves payment or customer acceptance.

For one focused **local code acceptance**, use `node stellar/scf-starforge-20261009/sf85-merchant-rail-change-review/acceptance.mjs`. It invokes the unmodified existing SF84 inspector with source-shaped local fixtures to check tuple changes, Charge/Session splits, scope changes and malformed challenges. These fixtures are structural format cases, not externally observed merchant results.

Primary documentation: https://developers.stellar.org/docs/build/agentic-payments/mpp (Charge/Session); original SF84 inspector at `../sf84-mpp-market-intake/inspect.mjs` and operator guide. Real seller capture and contractual confirmation are required for a customer claim.