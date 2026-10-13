# Original source and implementation provenance

## Selected Paycashless interface

The complete original OpenAPI 3.0.0 document for Paycashless API 1.1.0 is retained at `sources/paycashless-openapi.json`: 82,733 UTF-8 bytes, SHA-256 `32a8f2c29ec63dde0b76002460e1c66b5950267c51677f6d507b7185a10e9592`. Its original URL is <https://api.paycashless.com/openapi.json>. The catalogue checks this identity at startup and includes all 21 paths and 27 operation methods.

`sources/paycashless-projections.json` binds each actual method/path to a stable native action, response projection, continuation and exact readback selection. The original API document remains unchanged. It is not replaced by the projection file.

Complete source URL, byte and SHA-256 receipts for the official explanatory documents are in `sources/provider-source-receipts.json`. Read the originals:

- Authentication: <https://docs.paycashless.com/api-reference/authentication.md>
- Request signing: <https://docs.paycashless.com/api-signature.md>
- Callback signing: <https://docs.paycashless.com/webhooks.md>
- Event examples: <https://docs.paycashless.com/webhook-events.md>
- Invoice payment population: <https://docs.paycashless.com/api-reference/invoices/list-invoice-payments.md>
- Payment population: <https://docs.paycashless.com/api-reference/payments/list.md>
- Definitions and change history: <https://docs.paycashless.com/definitions.md> and <https://docs.paycashless.com/changelog.md>

The receipt preserves every selected source identity; the original case source packet retains the complete captured documents. This generic application contains the machine interface needed to reproduce its catalogue and the source receipts needed to review its interpretation.

## Protocol interpretation

The OpenAPI declares a bearer scheme but omits a top-level or per-operation security requirement. The official authentication instructions explicitly require a Bearer API key and signing headers. The implementation joins those complete instructions rather than treating the missing OpenAPI security array as unauthenticated access.

Request signing uses the published object-sort rule. It does not sort object contents inside arrays. The signed path excludes host and query and is lowercased; a body uses the HMAC of its published JSON representation. The request timestamp is seconds. The callback algorithm is separate: it signs the registered callback URL, the HMAC of `JSON.stringify(event.data)`, and the original callback timestamp. Because the callback documentation has exact-URL prose and lowercase-URL wording, configuration selects one convention explicitly. A selected timestamp freshness policy must state its unit.

The callback's top-level event label is not in that signature. The application retains it as unsigned display context, marks authenticated fields explicitly, and never uses the label alone to project a verified invoice/payment/payout state or choose an authenticated readback family. Complete original raw envelopes, data, headers and receptions remain retained.

The API exposes no idempotency-key parameter. The application does not infer an automatic safe mutation retry from generic conflict documentation. Original readback checks the exact provider identity/reference and source binding. Reprojecting a retained exchange requires its original connection descriptor; rebinding a local alias cannot reattribute old bytes to another merchant.

## Horizon source

`sources/horizon-original.json` is the complete maintained source capsule for the read-only Horizon adapter: ten full SDK/documentation/license files, 115,403 bytes including capsule metadata. The SDK is pinned to `stellar/js-stellar-sdk` v17.0.1, commit `74ac883871396138e1882a3ca4bcec7e4ace76b5`; documentation is pinned to `stellar/stellar-docs` commit `0886fb75182106bdd1b33c3aeae52bb5fe122b0a`. Its original Apache-2.0 license bodies and individual source URLs/hashes remain inside the capsule.

The settlement stream uses the actual account payments path and original cursor, ascending order and transaction join. Each complete frame, exact data representation, parsed operation/transaction projection and durable checkpoint share one original SQLite transaction. The worker first retains a successful network projection and checks its actual network passphrase. An open stream proves only its retained events and cursor; it does not prove a complete reporting period.

## Maintained application reuse

This application reuses the complete maintained Node 24 SQLite workspace, exact source parser/decimal routines, request journal, private file custody, archive/runtime receiving and browser recovery from the reviewed payment operations application. Provider catalogue, request authentication, callbacks, resource projections and financial model are specific to the issued Paycashless interface. No Conomy or Bloccpay customer data, Bridge contract, unrelated proprietary SDK, private commercial work order or credential is included.

The original reusable source selection was 45 complete files, 2,067,445 bytes / SHA-256 `b4b34407f1ca7a5f49dae3027753784c88e9aa7b7f67f51e698d45e0b3702580`. The complete current application roster and every current member hash are in `source-files.json`; receiving verifies those actual bodies, not a component count or an older source label.

## Scope of evidence

Official provider examples illustrate schemas and signing rules. They are not customer records or evidence of a completed merchant transaction. The funded project's integration roadmap explains the useful product scope but does not supply a deployed Stellar account, issuer, contract, API credential, or merchant export.

Whole-source review and authored source-only checks are recorded separately from native/provider execution. The application and commissioning guides require actual operator-selected inputs and the exact rendered outgoing product before claiming customer or demo readiness.
