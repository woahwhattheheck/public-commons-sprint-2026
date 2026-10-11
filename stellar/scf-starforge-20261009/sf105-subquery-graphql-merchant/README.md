# SF105: paid indexed Stellar data through original SubQuery + SF30

**One native seller, approved operations, no new payment engine.** This is an executable Stellar Community Fund #46 merchant adoption arm for a prospective data provider, not a claim that a SubQuery partnership, payable route, real settlement, SCF award or subscription already exists.

First-party [Stellar & Soroban SubQuery docs](https://academy.subquery.network/doc/indexer/quickstart/quickstart_chains/stellar.html) define Account, Payment, Credit, Debit, Transfer entities and show example GraphQL Query Service results. The separate [native query service documentation](https://subquery.network/doc/indexer/run_publish/query/query.html) confirms GraphQL is the normal read-only data access path. A client project controls its own schema and GraphQL endpoint, which must be checked against its live GraphQL playground before paid onboarding. The two included query templates are based on those public entity names, not verified against a third-party deployment.

## How the actual native integration works

The new adapter exports named paid application handlers plus matching PREPAYMENT admissions. Customers may supply *only* bounded named variables for a fixed, operator-authored GraphQL query. The original SF30 upstream module performs HTTPS origin enforcement, public DNS address pinning, deadline/capacity/byte bounding, redirect refusal, credential isolation and POST delivery. The original SF30 seller owns 402 metadata, facilitator processing, original payment verification, application cancellation, settlement and final response. **No invented acceptance or second payment implementation.**

Unknown JSON body fields, raw caller GraphQL text, arbitrary URLs, undeclared variables and out-of-range inputs receive 422 via the existing admission step **before** payment processing. Original GraphQL errors, missing data roots, invalid UTF-8, invalid JSON and excessive returned nodes fail as 502 and enter native failure/cancellation, never a manufactured payment success. No automatic backend retries. Only the declared data root is returned. Native seller challenge-only mode never invokes any paid application handler.

The operator-approved JSON is in [examples/approved-queries.json](./examples/approved-queries.json). It declares two *separate* Stellar indexed-data products: payments and credits. Each has its own static query and bounded first parameter (1–100) and fixed data root. Replace the example origin https://indexer.example with the actual merchant-controlled SubQuery GraphQL origin; keep its fixed path correct. For client-specific changes, version the operator-approved query locally rather than accepting buyer GraphQL. The static backend Authorization header is supplied by the deployment environment named in authorizationEnv, not copied from a buyer header; the environment value must be the full intended Authorization value, never logged or checked in.

## Seller configuration, using the existing SF30 schema

Supply the merchant's original **seller-service.v1** JSON externally. The standard fields are documented in [original SF30 upstream example](../sf30-seller-sdk/examples/upstream-service.json) and [original seller README](../sf30-seller-sdk/README.md). Use **two named fixed JSON POST routes** with the following exact one-to-one bindings:

| Seller route field | Indexed payments | Indexed credits |
|---|---|---|
| id | subquery-payments | subquery-credits |
| path | /indexed/payments | /indexed/credits |
| definition.method | POST | POST |
| definition.bodyType | json | json |
| definition.body | {"variables":{"first":10}} | {"variables":{"first":10}} |
| handler | getPayments | getCredits |
| admit | admitPayments | admitCredits |

Set the existing definition.serviceName, description, and owner-verified native payment details, including actual Stellar asset, payout recipient, atomic-unit price, explicit stellar:testnet/pubnet network and timeout. The product never generates a merchant wallet, billing agreement or offer price. Each native route must match one and only one approved operation, and a missing admit is rejected at startup.

### Run the actual original merchant stack (Node 22+)

From the public repository root:

~~~bash
S=stellar/scf-starforge-20261009/sf105-subquery-graphql-merchant

# Offline original offer compiler, no API credential or network activity:
node "$S/launch.mjs" --seller /private/merchant-seller.json \
  --queries "$S/examples/approved-queries.json" --check

# Local original 402 seller, NO facilitator and NO SubQuery backend calls:
node "$S/launch.mjs" --seller /private/merchant-seller.json \
  --queries "$S/examples/approved-queries.json" --port 8423

# Merchant-owned verified real terms and properly configured facilitator:
node "$S/launch.mjs" --seller /private/merchant-seller.json \
  --queries /private/approved-queries.json \
  --facilitator https://merchant-facilitator.example/facilitator
~~~

The original seller prints its loopback URL, mode, offers and readiness endpoints. Configure HTTPS proxy exposure, environment secrets and verified recipient/asset/payments separately. A backend on the SAME host may be configured as http://127.0.0.1:PORT with --allow-loopback-upstream, never arbitrary remote cleartext. Native seller listens on loopback; external access is deployed by its owner.

Example buyer JSON POST body to /indexed/payments:

~~~json
{"variables":{"first":10}}
~~~

A buyer without payment receives the original standard HTTP 402 offer, not data. Actual paid application delivery requires a configured native facilitator, verified terms and a merchant-owned running SubQuery endpoint.

## Focused source-native exercise

~~~bash
node stellar/scf-starforge-20261009/sf105-subquery-graphql-merchant/acceptance.mjs

# Add the actual seller-service.v1 JSON path to include original HTTP402:
node stellar/scf-starforge-20261009/sf105-subquery-graphql-merchant/acceptance.mjs \
  /private/merchant-seller.json
~~~

The exercise uses actual original SF30 hardened transport against a local SubQuery-shaped HTTP server and checks approved fixed GraphQL, type bounding, real backend POST, malformed GraphQL response rejection. With a configured merchant seller JSON it also starts the ACTUAL SF30 seller in CHALLENGE_ONLY mode and verifies one real 402 calls NO backend. This is a **source-native adapter acceptance**, not third-party SubQuery production connectivity, real Stellar settlement or received revenue. No GitHub Actions or broad test suites.

## Concrete paid-workshare proposal

For a SubQuery or Stellar-indexer customer, deliver: (1) exact original schema and live GraphQL endpoint discovery, (2) agreed 2–5 approved and bounded query products, (3) native Stellar/x402 atomic pricing plus verified asset and recipient, (4) owner-managed HTTPS and facilitator, (5) genuine native merchant operation / receipt acceptance, (6) observable usage and buyer handoff. The ongoing genuine first-party SubQuery lead in #sales owns contact and any offer; code does not claim an external agreement. This source is additive and does not overlap SF102 Cube, SF30 PostgreSQL, SF82 release management, SF88 signing, SF97 merchant analytics or SF46 distribution.
