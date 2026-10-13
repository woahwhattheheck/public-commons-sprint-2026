# Original source and adapter selection

## Escala collective-investment mock

Repository: https://github.com/escala-dev/collective-investment-api
Selected commit: ca9ae6256fdbf7786e20b4c2b2926ce179468944

The complete 39 selected implementation bodies remain in the original research delivery, outside this public application tree. The repository did not include a licence file. This independently implemented adapter retains the published Swagger interface, its compiled JSON, explicit projection profile and exact source provenance as separate application members. All three are verified by lib/catalogue.mjs before exposing callable actions.

The actual router/services govern implementation differences. The architecture describes future authentication, tenant isolation, durable voting/custody and financial services; the selected Express source does not implement those controls. Its service responses are fixed examples. The adapter exposes implemented routes as sandbox mock observations and keeps the two Swagger-only webhook routes nondispatchable.

The profile records source corrections, including the audit router's projectId query versus the Swagger proposalId and the contradictory vote type/enum. These corrections do not alter the retained original source. Original response fields and number tokens remain unchanged.

## Stellar Disbursement Platform

Repository: https://github.com/stellar/stellar-disbursement-platform-backend
Version: 7.0.0
Selected commit: 14704274467d267b6c6679052d7251ef6050d118

The complete bundled OpenAPI YAML and compiled JSON are retained. sources/sdp-original-source.json includes all 22 selected complete official source/doc bodies: the API, route registration, handlers, permissions middleware, original disbursement/payment models and instruction validators, amount/contact/verification definitions, the exact receiver contact wire enum, pagination/export implementation, multi-account guidance, security and licence.

The selected docs source is pinned to stellar/stellar-docs commit b3cb1c5a642e092f90e7bef242ebfe6885a58006. This is an adapter compatibility pin, not an assertion about the partner's actual SDP deployment.

One important source correction is explicit: the selected OpenAPI status PATCH omits its request body; the actual handler requires the status JSON. The profile preserves that handler-backed body contract.

Source distribution accounts and recipient wallets are separate. API keys carry resource permissions and distribution_wallet_ids; JWT roles and distribution-account access are independent. The API can start payments through the selected disbursement status mutation. Original provider authorization is not replaced by a local relationship or mock attestation.

## Horizon

The full maintained original SDK/documentation cohort is sources/horizon-original.json, based on stellar/js-stellar-sdk v17.0.1, commit 74ac883871396138e1882a3ca4bcec7e4ace76b5. The adapter retains original account/operation/transaction/network scope, cursor semantics and complete response values. Its stream parser and worker use the same workspace and original retained network proof.

## Reproduction and licences

The bundled YAML compiler is the complete maintained js-yaml distribution and licence. Run:

```sh
node compile-provider-schemas.mjs
```

It parses both retained original YAML bodies and verifies byte equality with the retained compiled JSON. It does not rewrite the source manifest or select newer remote schemas.

The source-files.json manifest contains every complete application member with bytes, SHA256 and mode. Public application source includes generic code and public provider originals only. Opportunity correspondence, proposed commercial terms, private configuration, customer records and runtime credentials remain outside it.
