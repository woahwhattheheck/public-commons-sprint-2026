# Original source contract

Source review date: 2026-10-13 UTC. This document distinguishes maintained source interfaces from a particular live service observation. Each receiving run retains its own original live responses and timestamps.

## Rialto maintained source

Repository: https://github.com/0d1026/Rialto

Reviewed commit: **267155c08475ecba40a5b28d7e32a6d005bd956a**

Primary source:

- [Discovery router](https://github.com/0d1026/Rialto/blob/267155c08475ecba40a5b28d7e32a6d005bd956a/packages/discovery/src/router.ts)
- [Wire envelope](https://github.com/0d1026/Rialto/blob/267155c08475ecba40a5b28d7e32a6d005bd956a/packages/discovery/src/wire.ts)
- [Public discovery types](https://github.com/0d1026/Rialto/blob/267155c08475ecba40a5b28d7e32a6d005bd956a/packages/shared/src/types/discovery-api.ts)
- [Maintained README](https://github.com/0d1026/Rialto/blob/267155c08475ecba40a5b28d7e32a6d005bd956a/README.md)
- [Original MCP discovery client](https://github.com/0d1026/Rialto/blob/267155c08475ecba40a5b28d7e32a6d005bd956a/packages/mcp-server/src/clients/discovery-client.ts)
- [Seller guide](https://github.com/0d1026/Rialto/blob/267155c08475ecba40a5b28d7e32a6d005bd956a/site/content/docs/guides/sellers.mdx)

The current source has MCP tools and a paid-call path. Some indexed public documentation describes an earlier skeleton. This receiving implementation follows the maintained source and keeps its original MCP execution intact.

### Original catalogue

`GET /discovery/resources` returns:

```json
{
  "x402Version": 2,
  "items": [],
  "pagination": {"limit": 100, "offset": 0, "total": 0}
}
```

The empty example documents the envelope only. Actual rows and totals come from retained live responses.

The router accepts network, scheme, type, payTo, extensions, limit and offset. This adapter uses network, scheme, optional type/payTo, limit and offset; it preserves the complete plan. The original maximum limit is 100. Returned resources preserve their original resource URL, optional tool name, payment options, type, version, source metadata, last-updated timestamp and any extensions. Identity is the original resource URL plus tool name.

The separate search route has its own query syntax and cursor. This implementation uses the complete list route, avoiding an implicit search-only view of catalogue coverage.

The source catalogue can derive a listing from a settlement event containing scheme, network, asset, payTo and amount. Such a listing does not necessarily provide the authorization timeout needed by the buyer. The actual selected merchant challenge supplies complete requirements. The receiving code keeps both original sources.

Original base URLs from the maintained project:

- Discovery: https://rialto-production-97c9.up.railway.app
- Facilitator: https://facilitator-production-0beb.up.railway.app

Each runtime capture independently records their actual status and complete returned bytes. Supported-kind and peer responses stay in the edition even if those auxiliary routes fail while catalogue pages succeed.

## Existing Stellar Forge buyer

Repository: https://github.com/woahwhattheheck/public-commons-sprint-2026

Reviewed commit: **3a1b3db8541a589053165dd219c49c35845bfcd8**

Directory: `stellar/scf-starforge-20261009/sf88-operator-buyer-cli`

This integration calls the complete installed original checkout. It adds no replacement settlement, wallet, signer or recovery engine.

### Exact preparation contract

`--prepare` receives the complete original saved-discovery envelope, row 0, an explicit original challenge acceptance index, a stable intent, the concrete URL/method, exact ordinary headers/body, a new review destination and an explicit customer-result destination.

The envelope is:

```json
{
  "mode": "ORIGINAL_UNSIGNED_CATALOG",
  "source": "ACTUAL_CONCRETE_MERCHANT_URL",
  "sourceEnvelope": "resources",
  "originalListings": ["COMPLETE_ACTUAL_V2_CHALLENGE_OBJECT"]
}
```

The quoted placeholders describe the contract and are not runnable service values.

Native preparation binds the full discovery hash, original listing and acceptance index. Selected expectations contain scheme, network, asset, payTo, maxAtomic, maxTimeoutSeconds and paymentFlow when the original option supplies it. Our receiver verifies those original bindings on resume, then calls native `--review` and `--export-operation`.

The v2 native operation handoff contains its original intentId, URL, method, headers, rowIndex, null ticket for this ordinary HTTP path, and complete hashed discovery/body bytes. The original importer validates and reconstructs machine-local paths. Receiving the whole adapter directory preserves history; receiving the native operation reconstructs an executable local review.

### Reviewed source hashes

| Original file | UTF-8 bytes | SHA-256 |
|---|---:|---|
| `cli.mjs` | 9287 | `f2f4db3f00b4f24f6b0e31def3cf2ea2f4fc1f29ef5481fb2527180709474419` |
| `prepare.mjs` | 11217 | `9bea878c27f7b02532199eca1ab3824ac93cc71306cbee4fbd1e984feef24a2e` |
| `operation-handoff.mjs` | 15311 | `34404be521a5d5f22618ddd1ed52eaf6a96cd196f552b84d0336adb36b178979` |
| `config.mjs` | 10034 | `a489f33ac32f56df37da3cf1b6a6ddbfa41363fc11ec8b6cd824db46582ada3d` |
| `request-headers.mjs` | 4389 | `8f0b6fb40f6db7916349aa83ed7622a4478d37b7b46e3f15763b756e0404cad9` |

## Application relevance

The [official SCF Build Award criteria](https://github.com/stellar/scf-handbook/blob/main/scf-awards/build-award/submission-criteria.md) request a defined architecture and verifiable traction or validated Stellar need. The [official budget and deliverable guidelines](https://github.com/stellar/scf-handbook/blob/main/scf-awards/build-award/budget-and-deliverable-guidelines.md) govern prospective grant work.

This source adds a concrete discovery-to-customer receiving workflow. Its live merchant outputs and subsequent independent adoption belong to the actual customer journey. Use the original application owner and current application source when composing this work into SCF46.

## License and attribution

The new receiving modules are MIT, Copyright 2026 TokenJunkieLabs. The ordinary-header restrictions follow the existing MIT-licensed SF88 request-headers source and remain subject to the original buyer's authoritative validation.

Rialto's source is Apache-2.0. The adapter calls its public interfaces and links the exact reviewed source; it does not distribute Rialto's implementation. The existing Stellar Forge source remains in its original repository and license.
