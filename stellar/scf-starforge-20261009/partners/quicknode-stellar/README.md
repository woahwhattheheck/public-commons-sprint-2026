# QuickNode Stellar settlement reference

A provider-specific pilot configuration for the original Stellar RPC merchant. The runtime is the existing [SF30 JSON-RPC merchant](../../sf30-seller-sdk/jsonrpc/README.md) and [retained operator workspace](../../sf30-seller-sdk/jsonrpc/workspace/README.md). The reference selects three read products, keeps provider credentials in the launch environment, and supplies the original buyer preparation and operating workflow.

This is a proposed integration for QuickNode's product team. QuickNode has not announced adoption of this reference or a Stellar payment rail. Its published x402 product already serves blockchain queries through several payment models. The specific extension considered here is **pay-per-request settlement on Stellar**.

## Verified integration seam

As reviewed on 2026-10-11, QuickNode's [payment-network table](https://www.quicknode.com/docs/build-with-ai/x402-payments) lists EVM and Solana settlement networks. The RPC chain and payment chain are independent. Its official [@quicknode/x402](https://github.com/quiknode-labs/quicknode-x402) package, version 0.1.3, detects EVM/Solana network prefixes and registers their exact schemes. A Stellar network string therefore needs client and gateway support.

The original merchant already registers the canonical `@x402/stellar/exact/server` implementation through `@x402/core/server`. The [Stellar x402 documentation](https://developers.stellar.org/docs/build/agentic-payments/x402) describes its Soroban authorization-entry signing flow. No alternative payment scheme is introduced by this configuration.

| Interface | This reference | QuickNode integration work |
| --- | --- | --- |
| Public HTTP request | POST `/stellar/getNetwork`, `/stellar/getTransaction`, or `/stellar/getEvents`; body is the selected method's params object | Map an agreed staging route to these fixed methods or join the same admission/handler behavior to the existing gateway |
| Upstream request | Fixed JSON-RPC 2.0 method and ID, sent to the provider's exact private endpoint | Supply the designated QuickNode endpoint through the environment |
| Query network | Stellar public network in the starter | Verify the actual network before opening the seller |
| Payment network | Stellar testnet in the starter | Publish the intended exact payment option and connect the approved facilitator |
| Buyer | Original SF88 review and signer workflow | Add native Stellar signer/scheme handling to the chosen QuickNode client integration |
| Operator | Original persisted plans, packages, diagnoses, buyer requests, availability and delivery state | Retain those state directories and agree ownership of support/reconciliation |

The selected-route interface is explicit. QuickNode's existing gateway uses a chain-slug endpoint and a full JSON-RPC request envelope; callers must not send that full envelope to this reference's params-only product paths. The integration owner chooses the public interface before implementing its gateway join.

## Selected read products

| Product | Params | Result and operation |
| --- | --- | --- |
| `getNetwork` | `{}` | Network passphrase and protocol version; a lightweight first buyer walkthrough |
| `getTransaction` | `{"hash":"ACTUAL_64_CHARACTER_TRANSACTION_HASH"}` | Transaction lookup; SUCCESS, FAILED and NOT_FOUND describe chain data, independently of the payment receipt |
| `getEvents` | A current retained ledger window or a cursor, plus explicit page size | Contract-event page; each deliberate next page is a separate purchase with a new intent |

The provider's successful JSON-RPC envelope bytes are preserved, including integer literals outside JavaScript's safe integer range. Read `result` using a lossless parser where required. Malformed params are rejected before payment admission. Provider and result-contract errors are distinct from a valid chain transaction whose status is FAILED or NOT_FOUND.

Current history bounds come from the actual provider's `getHealth` result. For `getEvents`, `endLedger` is exclusive; a cursor request omits ledger bounds. Do not retain an old ledger window as a live example. The supplied event template uses a cursor obtained from an actual previous page.

The first walkthrough uses `getNetwork`. During qualification, the public documentation endpoint returned a `getLatestLedger` response with header and ledger metadata exceeding one megabyte, so that method is not selected for this starter. Use a separately sized product if that payload is required; truncating a JSON-RPC result is not a successful delivery.

The starter uses a maximum event page of 100, a one-megabyte response limit, a ten-second upstream deadline, and four concurrent upstream requests. These are pilot configuration choices. Set them against the agreed provider allowance and response sizes.

## Prepare an actual merchant

Use Node 24 and the current complete source checkout or maintained merchant distribution. The verified original workspace merge is [PR1096](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1096), commit `9c2a32c35b5471b2c249512cf9629c263bc743af`. A sparse source checkout must also retain `stellar-forge/payment-auto-catalog`, which the original compiler imports.

Copy `plan.template.json` into a private operating directory. Replace the merchant HTTPS origin and recipient with the intended actual values. Review every atomic-unit price. The testnet asset in the template is the USDC contract published by Stellar; the example prices are configuration examples, not QuickNode prices or an agreed commercial rate.

The environment reference `QUICKNODE_STELLAR_RPC_URL` holds the exact designated provider URL. If it includes a path token, retain the whole URL in the private launch environment. Public plans, OpenAPI, offers, buyer reviews and operator exports retain the environment-variable name. The endpoint does not accept URL userinfo, a query string or a fragment.

```sh
RPC=stellar/scf-starforge-20261009/sf30-seller-sdk/jsonrpc/cli.mjs
node "$RPC" inspect --plan /private/quicknode/plan.json
node "$RPC" prepare --plan /private/quicknode/plan.json \
  --out /private/quicknode/prepared
node "$RPC" diagnose --plan /private/quicknode/prepared/plan.json
```

The parent operating directory must already be private (mode 0700); `prepared` must be new. Preparation runs the original SF61 compiler and retains the plan, OpenAPI, route bindings, offers, trusted handlers and run instructions. It makes no provider request. Diagnosis performs one `getNetwork` and one `getHealth` read, recording actual identity, protocol and retention.

QuickNode publishes a [public documentation endpoint](https://www.quicknode.com/docs/stellar/getNetwork) for examples. Use an agreed provider-owned endpoint for the paid pilot. A public documentation read does not demonstrate a QuickNode settlement transaction.

## Complete the original buyer and operator workflow

For the first read, copy `requests/getNetwork.json` to a retained private file:

```sh
node "$RPC" buyer --package /private/quicknode/prepared \
  --method getNetwork --body-file /private/quicknode/getNetwork.json \
  --intent-id YOUR_STABLE_PURCHASE_ID --out /private/quicknode/buyer-review.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/quicknode/buyer-review.json
```

Continue the original SF88 signer/workspace procedure for the actual authorized payment. Review the exact network, asset, merchant recipient, amount and requested resource together. Keep the same purchase intent and operation when reconciling an interrupted attempt; a deliberate new request or next page receives a new intent.

For a complete retained browser workflow:

```sh
node "$RPC" workspace --dir /private/quicknode/workspace --create \
  --plan /private/quicknode/plan.json \
  --facilitator https://YOUR_ACTUAL_FACILITATOR
```

Open the launcher's private session URL. Save and review the plan, prepare its original package, diagnose the provider, prepare the buyer request, and start the selected merchant. The original workspace binds to loopback; retain the existing HTTPS ingress for the public seller. Use its original availability desk to pause a product, drain admitted work, then reopen the same workspace and package. Rotate an endpoint credential in its private source after draining and before restart.

The generated trusted handler entry refers to the immutable source installation that prepared it. Preserve that installation with the prepared package; an upgrade uses a newly prepared package and the original release comparison/activation workflow.

## Proposed pilot acceptance

These are acceptance criteria for an agreed staging integration, not claims that QuickNode has already run or accepted it.

| Demonstration | Acceptance |
| --- | --- |
| First paid read | An actual Stellar testnet payment satisfies the agreed offer and returns the selected QuickNode RPC result, with payment result and chain-data result independently identified |
| Invalid request or payment terms | Invalid params or a wrong network, asset, amount, recipient or expired authorization cannot produce a successful paid product |
| Upstream failure | Provider failure and JSON-RPC error behavior follow the agreed billing rule; valid FAILED/NOT_FOUND chain data is handled separately |
| Interrupted delivery | The same retained purchase is reconciled after connection loss or restart; operator state distinguishes settlement outcome from delivery outcome |
| Merchant operation | Selected products pause, drain and reopen with original state; credential values are absent from public generated artifacts |
| Team handoff | The designated engineer reproduces the agreed walkthrough from the retained configuration, source version and runbook |

The initial scope is one agreed staging route, three selected reads, and Stellar testnet USDC pay-per-request. QuickNode's credit-drawdown authentication, SIWX sessions, Circle nanopayments, WebSocket and gRPC behavior need their own integration scope. A production transition requires the actual production recipient, asset, facilitator and operational decisions to be selected explicitly.

## Source references

- [QuickNode x402 payment models, networks and billing](https://www.quicknode.com/docs/build-with-ai/x402-payments)
- [QuickNode client source](https://github.com/quiknode-labs/quicknode-x402)
- [QuickNode Stellar API overview](https://www.quicknode.com/docs/stellar/api-overview)
- [QuickNode getNetwork request and public documentation endpoint](https://www.quicknode.com/docs/stellar/getNetwork)
- [Stellar native x402 protocol and asset references](https://developers.stellar.org/docs/build/agentic-payments/x402)
- [Original JSON-RPC merchant workspace release](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1096)

MIT. This package contains configuration and integration documentation for the original merchant; source licenses of the linked dependencies continue to apply.
