# SCF SF72: native x402 Bazaar GET-input triage

This is an executable, offline merchant-engineering addition for **Stellar Forge's** original SF52/SF64 seller visibility workflow. Original October 11 Vellar Bazaar metadata contains GET operations with JSON Schema query and path parameter requirements, including `markdown` for the live markdown-conversion resource and `original`/`revised` for the live diff resource, and required `address` under `pathParams` for the literal `/inspect/:address` route. In the original Railway cohort, four bare-GET 400 routes have required query keys and a fifth has a required path template. A naked GET returning HTTP 400 is *not*, by itself, sufficient to conclude that the actual parameterized x402 checkout is broken.

## Run (Node 22+, no installation)

Capture the native provider GET body via the existing SF41/SF52/Muse authorized read-only capture. Use exactly the saved JSON bytes. Run the original SF52 diagnostic against the same seller/recipient/network using its existing CLI. Then:

```sh
node input-hints.mjs --catalog vellar-original.json \
  --sf52 seller-original-sf52.json \
  --json-out merchant-input-triage.json \
  --html-out merchant-input-triage.html
```

`--sf52` is optional for a catalog-wide operation-contract inventory. HTML is suitable for a merchant-owner review, not a public buyer receipt. This adds new source-specific engineering information without altering the SF52 original report, SF64 scoring, existing offer details or provider credentials. It never invokes the origin, logs into any service, signs or pays. No actual paid settlement or customer acceptance is claimed.

## Decision and next implementation milestone

Only if the original SF52 result is an HTTP 400 on GET, the native catalog is an exhaustive snapshot aligned with the original SF52 report, every matching GET operation has a required query parameter or unresolved path template actually missing from the observed URL, and network/recipient match within a single accepted option, output is `GET_400_WITH_DECLARED_MISSING_INPUT`. That means **the original request omitted inputs the provider declares required**, *not* proof the omitted inputs caused the HTTP 400 or that the seller is fixed. Otherwise the prior HTTP 400 remains unresolved. This separates an input contract problem from a payment protocol/crawler error without suppressing any original evidence.

For a seller-approved paid integration, use this report to assemble the exact permitted input contract, have seller supply a valid example request, then request a valid unpaid 402 with native payment metadata before any consented payment or buyer delivery. Feed the actual 402, errors and remediation back into original SF49 merchant owner workflow. Do not use catalog example parameter values as authorization.

## Source custody

Original code: `stellar/scf-starforge-20261009/sf52-merchant-visibility/diagnose.mjs` and `sf64-merchant-conversion-report/report.mjs` in `woahwhattheheck/public-commons-sprint-2026`. Native Vellar input schema observed from the provider's testnet `/discovery/resources` endpoint October 11, 2026. The direct provider source and original Muse 27/27 GET, 19 transport failures, 5 HTTP400, 3 HTTP402 cohort must remain separately attributable. To integrate, add these three files under `stellar/scf-starforge-20261009/sf72-merchant-input-triage/`; reference only where seller legitimately opts into an SF72 review.

Focused check: `node --test input-hints.test.mjs`.

## October 11 real-provider source observation

Fresh read of the **actual native Vellar discovery** endpoint with `?limit=100&network=stellar%3Atestnet` returned **27 entries of 27 declared** and every entry declared GET. **17/27** declare JSON Schema required query keys. The Railway subset of eight declares four sets of mandatory query keys (`/hash`, `/base64`, `/word-count`, `/stroops`) and one parameterized `/inspect/:address` path; `/quote`, `/uuid`, `/timestamp` declare no required query/path values. This explains why the original five Railway bare-GET HTTP 400s require parameter-aware interpretation. The source observation is metadata only and does not demonstrate which validation branch generated the 400. Historic Muse 19 OnRender transport errors and three Railway HTTP402 remain unchanged. The snapshot was returned by the provider's native HTTP endpoint, not model-generated.
