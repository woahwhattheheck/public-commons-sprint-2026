# SF102: sell named Cube analytics queries through the original Stellar x402 seller

For a merchant deployment, use the [Cube onboarding workflow](onboarding/README.md).
It binds approved reports to the actual saved `/meta` catalog, validates public
input examples, retains private plans and backend probes, and exports original
seller configs, buyer preparation, OpenAPI and a portable native launcher. Its
generated admission hook validates the original template before payment.

This is an **actual merchant integration module**, not another x402 server. An operator selects fixed Cube analytic reports; the existing SF30 seller sells a permitted HTTP GET route, then (only after its native payment gate) this adapter calls the original SF30 `createUpstreamHandlers` transport as a server-authenticated Cube `/cubejs-api/v1/load` POST. It preserves original DNS public-address pinning, HTTPS certificate checking, redirect and nested-402 rejection, bounded response, timeout, concurrency and cancellation behavior. No buyer-supplied SQL, arbitrary Cube JSON, upstream URL, authorization header, or bearer JWT crosses that boundary.

The operator still owns their merchant account, price, seller, payment facilitator, data rights, and seller environment. This package does not create a wallet, sign a Stellar transaction, settle a charge, process customer data automatically, or prove a provider agreed to a pilot.

## Scope and original source composition

- `cube-template.mjs` compiles no more than 24 operator-owned named reports. Every report fixes the Cube measures and query shape, with optional whole-value `$param` substitution only for declared `enum`, actual calendar `date`, or bounded `integer` parameters. Unknown, duplicate/repeated, missing, extra or invalid buyer parameters fail closed. The operator may also cap a date span to 1–366 days. Names are resolved from exact static seller paths `/reports/<name>`, not dynamic discovery or an unbound remote URL.
- `adapter.mjs` composes `../sf30-seller-sdk/upstream.mjs` to send exactly one fixed-path JSON POST per valid paid GET, with an operator-secret `Authorization` header loaded from a named environment variable. It does not retry an uncertain POST. The seller controls payment challenge, verification, settlement and content release.
- `seller-service.json`, `cube-adapter.json`, and `merchant-handlers.mjs` are local, *nonproduction* examples with original `UNVERIFIED_DEMO_*` payment markers and a local loopback Cube test backend. A live merchant must use real approved Stellar network/SEP-41 payment values and a trusted facilitator and confirm actual Cube schema/member permissions. The example `logs.count` / `logs.time` are taken from a publicly documented generic Cube format, **not claimed to be valid Stellar tables or available through Ortege's production accounts**.

## Merchant activation, challenge-only first

Copy and edit the three example config files as a trusted operator. Replace the two static `/reports/hourly-count` and `/reports/date-window` routes or add literal `/reports/<name>` routes whose names match an approved report. Each route may have its own operator-set fixed `amount`; there is no client-controlled amount. The original seller forbids dynamic colon paths for definition-only offers, so this example deliberately uses **literal routes**, not `/reports/:report`.

For a local Cube-compatible backend bound on `127.0.0.1:8765`, supply an environment value (the sample handler enables loopback only for that example):

```sh
export CUBE_API_AUTHORIZATION='Bearer LOCAL_TEST_TOKEN'
S=stellar/scf-starforge-20261009/sf102-cube-paid-query-adapter
node stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \
  --config "$S/seller-service.json" --handlers merchant-handlers.mjs --port 0
```

Use the actual URL printed by the original seller and perform an **unpaid** `GET /reports/hourly-count`. The service must return the existing original native HTTP 402; without an approved facilitator, it does **not** call the backend. `/_seller/health`, `/_seller/offers`, `/_seller/docs` and `/_seller/openapi.json` are the original seller's URLs. No CLI command in this example charges money or establishes a paid response.

For a real operator deployment, change `cube-adapter.json` `origin` to the vendor-authorized canonical HTTPS API origin on port 443, e.g. the hostname actually documented in your service agreement; set `allowLoopback:false` in `merchant-handlers.mjs`; inject `CUBE_API_AUTHORIZATION` securely at runtime as the **full** `Bearer ...` header. Never commit the JWT or use a buyer-provided header. The original upstream DNS policy rejects private or redirected targets. The merchant must ensure reports, member names, filters, rate limits, result sizes, payment terms and usage rights are approved by that vendor. Use original SF30 facilitator and deployment instructions to enable payment: [upstream merchant guide](../sf30-seller-sdk/UPSTREAM.md), [native seller guide](../sf30-seller-sdk/README.md), and [native seller acceptance](../sf96-seller-acceptance/README.md).

### HTTP path / Cube translation

| Paid seller GET | Trusted Cube POST after native payment approval |
|---|---|
| `/reports/hourly-count` | `{"query":{"measures":["logs.count"],"timeDimensions":[{"dimension":"logs.time","granularity":"hour","dateRange":"last 1440 minutes"}],"limit":100}}` |
| `/reports/date-window?start=2026-10-01&end=2026-10-10` | Same fixed measure with a date-window literal array, only two approved exact dates substituted |
| `/reports/hourly-count?query={...}` | HTTP 400 from the adapter, not a forwarded arbitrary Cube query |
| `/reports/date-window?start=2026-09-01&end=2026-10-10` | HTTP 400 because span exceeds 31 days |

Static pricing is applied to the original seller route and its 402 challenge. Calling the adapter function directly bypasses the sale gate and is **not a supported deployment**. Access to any upstream data is controlled by merchant-owned credentials and vendor authorization, not by the buyer's JWT.

## Production result and fault semantics

The adapter returns **only** a successful Cube HTTP 200 response containing an array-valued `data` field, subject to `maxRows`; successful but structurally invalid responses return a sanitized 502. The original upstream's own `400`/`429`/`502`/`503`/`504` errors propagate as its carefully sanitized JSON status. No raw upstream 401/403 bodies, backend credentials or cookies pass back. Original handler capacity and response-size limits remain authoritative. The adapter does not implement a payment retry or silently convert HTTP 402 into a success.

Data providers differ in Cube schema and row-level permission model: trial value depends on their explicit approval of one exact query and an appropriate fixed per-request price. The existing original SF49 commercial owner retains customer contact, consent, and pilot pricing authority. Provider contact is not a contract, paid settlement, grant eligibility, or deployment evidence.

## Focused offline validation

The local Node22 template exercise checked two original named report paths, fixed measure immutability, date-window exact substitutions, and rejection of unknown/undeclared/repeated/invalid/inverted parameters and invalid measures. No broad test suite or hosted Actions are needed. The separately operated **original SF30 seller and canonical x402 runtime** should be used for a real challenge-and-paid-lifecycle acceptance with vendor permission, rather than treating this isolated template check as payment proof.
