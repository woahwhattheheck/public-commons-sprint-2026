# Soroswap and DeFindex operator workflows

These adapters run inside the same BIM Exchange workspace, source journal, wallet selection and portable archive as the other providers. Quotes, simulations, plans, wallet submissions and confirmations remain separate retained records. Every HTTP/RPC response is retained before it is exposed to the adapter. No adapter signs a transaction, broadcasts one, stores a private key or represents a locally prepared payload as a completed exchange.

## Select the complete source and account

Install the application's pinned `@stellar/stellar-sdk` **16.0.1** dependency. Select the full Stellar network ID, passphrase, HTTPS RPC URL and HTTPS Horizon URL. The RPC `getNetwork` and Horizon root must agree with the selected passphrase. Connect the wallet on that exact network.

For Soroswap, use provider key `soroswap`, API base `https://api.soroswap.finance`, explicit `mainnet` or `testnet` environment, and a server-side credential alias. The corresponding passphrase is either `Public Global Stellar Network ; September 2015` or `Test SDF Network ; September 2015`. The alias selects the existing backend credential binding; credential values are not form fields, source records or portable files.

Soroswap public configuration may select `protocols` (distinct names from soroswap, phoenix, aqua, comet, sushi, sdex), numeric `parts` (1–100), numeric `maxHops` (1–10), numeric `feeBps` (0–9999), `referralId`, `gaslessTrustline:"create"`, and `maxFeeStroops` as exact positive integer text. When protocols are omitted, the adapter queries Soroswap itself. A provider route may aggregate other exchanges; the complete route records that source rather than treating it as independent liquidity. Optional `contractIds.router` or `contractIds.aggregator` pins must match the actual provider address lookup.

For DeFindex use provider key `defindex`, API base `https://api.defindex.io`, matching explicit environment and, where its issued HTTP interface requires authentication, the server-side credential alias. `publicConfig.maxFeeStroops` optionally limits the assembled wallet transaction fee. Direct contract simulations use the selected Stellar RPC and Horizon. Public deployment addresses are research evidence; the operator still selects the actual vault.

Both provider bases must use their issued HTTPS origins without embedded credentials. Network and provider configuration are frozen into retained evidence. To prepare from an older quote or vault observation, restore its original configuration or obtain a new observation.

## Exact values and form types

All token amounts, vault shares, transaction fee limits and on-chain integer values are **decimal integer text**, in the original asset's native units. Do not convert them through browser `Number`, round them, or assume every vault asset has the same decimals. Vector positions follow the complete original vault asset order.

The action catalogue exposes these exact forms:

| Action | Required fields | Optional fields |
| --- | --- | --- |
| `soroswap.protocols` | None | None |
| `soroswap.pools` | `protocols: string[]` | `assetA`, `assetB`; supply both or neither |
| `soroswap.balances` | None | `address`, `token` |
| `soroswap.quote` | `tokenIn`, `tokenOut`, `amount: integer-text`, `mode: EXACT_IN or EXACT_OUT` | `slippageBps: integer-text`, `ttlSeconds: integer-text` |
| `soroswap.prepare` | `quoteId: evidence-id` | `routeIndex: integer-text`, default 0 |
| `soroswap.confirm` | `submissionId: evidence-id` | None |
| `defindex.discover` | None | None |
| `defindex.vault` | `vault: contract address` | None |
| `defindex.position` | `vault` | `owner`, `transactionSource` |
| `defindex.deposit.prepare` | `vaultEvidenceId`, `amounts: integer-text[]`, `minAmounts: integer-text[]`, `invest: boolean` | `ttlSeconds: integer-text` |
| `defindex.withdraw.prepare` | `vaultEvidenceId`, `shares: integer-text`, `minAmounts: integer-text[]` | `ttlSeconds: integer-text` |
| `defindex.http.prepare` | `vaultEvidenceId`, `operation`, `slippageBps: integer-text` | `amounts: integer-text[]` for deposit/withdraw; `shares: integer-text` for withdraw-shares; `invest: boolean` for deposit; `minAmounts: integer-text[]` required for either withdrawal; `maxShares: integer-text` required for withdraw-by-assets |
| `defindex.confirm` | `submissionId: evidence-id` | None |

Swap slippage is 0–9999 basis points, default 50. Quote/native preparation lifetime is 1–3600 seconds, default 300. Soroswap amounts and native vault values must fit nonnegative signed i128; positive values are required where the action spends or withdraws. Direct deposit must contain at least one positive desired amount. Each deposit minimum must be no larger than its corresponding desired amount. HTTP DeFindex slippage is 0–10000; the full original response and actual encoded minima are retained.

The issued DeFindex HTTP amount interface accepts JSON numbers. This adapter accepts only integers through `Number.MAX_SAFE_INTEGER` on that interface and directs larger values to the exact native deposit/withdraw workflow. It does not silently send strings to an interface that specifies numbers.

## Complete Soroswap course

1. Use the existing `query.run` command with `actionId:"soroswap.quote"`. Supply the same token pair, exact amount, mode, slippage and lifetime used by the shared route-discovery form. The quote source record retains the complete native request, original provider JSON text, original returned values, route, fees, price-impact text and exchange identities.
2. Alternatively use the shared `exchange.discover` workflow. It queries the selected Soroswap, Aquarius and Sushi providers concurrently and retains every provider reply or error. A route index in a discovery record is the index in its full flattened quote list, not a provider-local index.
3. Inspect the selected route and original source. `bim.swap-quote.v1` records exact input/output, minimum output or maximum input, original source wallet/network, creation/expiration, route and full provider snapshot. Missing provider fees or price impact remain explicitly unreported. Network fees become available after preparation.
4. Use `plan.prepare` with `actionId:"soroswap.prepare"`, `input:{quoteId,routeIndex}`, and the original query in `evidenceIds`. Shared `exchange.prepareBest` is a separate orchestration action: it proposes sequentially simulated candidates from the original comparison rather than silently signing a fallback.
5. The adapter sends the complete retained quote JSON verbatim to the issued build endpoint. It checks the original unsigned transaction source, contract, method, assets, amount, recipient and exact limit. It restricts the unsigned transaction time bounds to the original quote lifetime and retains the unmodified build response separately.
6. Supported router and aggregator invocations are independently simulated through the selected RPC and assembled with the actual simulation resources and authorization entries. Simulation errors or restoration requirements produce a review result; there is no automatic restore or submission. The current public router/aggregator contracts require their funding and recipient address to be the same authenticated wallet.
7. A complete classic SDEX path is checked for its source, destination, token contracts, exact amount and min/max bound. It has **no Soroban contract simulation**. The shared best-route workflow must not label that classic source check as a successful contract simulation. Extra operations, fee sponsorship or an unknown source-edition method retain the entire payload for review.
8. Inspect the assembled fee, full operation list, authorization entries, exact XDR, transaction hash and expiry. Sign and submit only through the selected external wallet when the operator explicitly chooses to do so.
9. Retain that wallet result through the existing `submission.record` command against the original plan. Then use `submission.refresh` with `soroswap.confirm` for a direct Soroswap plan, selecting the original submission and plan as evidence. Plans created by shared `exchange.prepareBest` use the shared `exchange.confirm` action.
10. Confirmation reads the original hash from RPC and checks the full envelope/result. If RPC no longer retains it, the helper checks the selected Horizon network and transaction. Confirmation requires original hash/envelope/result agreement; a missing record remains pending or unavailable. Full result metadata remains retained even when its version has no optional decoded return-value presentation.

A confirmation is ledger evidence about the selected transaction, not a replacement for the wallet's original submitted envelope. A failed transaction remains failed and retains its original ledger result.

## Complete DeFindex course

Start with `defindex.discover` and retain the selected `defindex.vault` result. The latter includes every asset, strategy and reported fee field with the complete original response. Use `defindex.position` to simulate exact native share balance, underlying amounts for those shares, and current vault assets. A C-address owner can be inspected using an explicit funded G-address `transactionSource`.

Position reads are complete individual simulations, not an atomic snapshot across multiple ledgers. The vault's `get_asset_amounts_per_shares` method can perform report and fee changes when submitted; this application only simulates it for observation and does not claim those changes were committed.

For an exact native deposit, retain the selected vault query in `evidenceIds`, then prepare `defindex.deposit.prepare` with the exact desired vector, minimum vector and explicit investment choice. For a withdrawal prepare `defindex.withdraw.prepare` with exact shares and the entire minimum-output vector. The adapter re-reads and matches the native vault asset order, constructs actual typed i128 arguments, and simulates the real deposit or withdrawal. It retains the complete actual return value and simulation; first-deposit locked liquidity and fee/report effects are not replaced by a guessed share-price formula.

A native transaction source must be a G-address wallet. For a contract wallet, use the issued `defindex.http.prepare` action with its exact documented request. For either HTTP withdrawal mode supply the entire explicit `minAmounts` vector. Withdraw-by-assets also requires `maxShares`, an explicit ceiling on the share burn. These are local operator bounds checked against the actual returned invocation; they are not invented HTTP parameters. A classic response is inspected against the chosen vault, method, caller, desired amounts/share count or cap, investment flag and minimum outputs, then independently simulated and assembled.

A smart-wallet response carries `xdr:null`, `isSmartWallet:true` and a complete `operationXDR`. The adapter decodes and checks that operation's actual contract, method and arguments, retains the original response and returns `NEEDS_REVIEW` with `unsignedPayload.kind:"stellar-operation"`. The selected smart wallet must construct its own complete transaction and contract authorization. An isolated operation does not have a final transaction hash or a transaction source sequence. The current source-specific confirmation requires an original full-envelope plan; it does not manufacture that plan from the operation payload.

For a full native/classic plan, externally sign and submit, retain the exact result with `submission.record`, then confirm with `defindex.confirm` using the original plan and submission evidence. The confirmed inner transaction hash must equal the original prepared plan hash.

## Restoring work and receiving the application

Keep the existing workspace request ID when recovering an interrupted command. Accepted query, plan and submission results are replayed from the same journal. New observations use new explicit requests and retain prior evidence.

Export the complete workspace through its existing portable workflow. Retain original quote and vault queries, all consumed evidence IDs, provider/configuration descriptors, HTTP/RPC exchanges, unsigned payloads, wallet submissions and confirmations. A recipient can inspect every source and reproduce local preparation against an explicitly selected current provider, while earlier observations and results remain immutable.

Before presenting this as a ready customer course, the original equipped receiver must install the pinned application, render the exact outgoing product, use these controls at narrow and screenshare widths, and open downloaded complete artifacts. Source parsing and peer review establish neither actual provider access nor native/browser execution. Account credentials and funded wallet authorization are supplied only by the responsible operator; this guide includes no example trade claimed as a business result.

## Exact source editions

The implementation is independently authored from these pinned original interfaces:

- Soroswap SDK 0.5.0: `soroswap/sdk@33fa216f5fcf82b299805ce7c078451ec254eb96`.
- Soroswap documentation: `soroswap/docs@a49981b7a7138c54b33ff2f38969bf003521b3cd`.
- Soroswap core/router: `soroswap/core@6eade008ee6794075ad941609e0fef0d1124d3eb`.
- Soroswap aggregator: `soroswap/aggregator@84de10e0f8d26168b4a76f8c23b963e50917517c`.
- DeFindex SDK 0.3.0: `defindex-io/defindex-sdk@bbee7f83b0a2f87b34066918647eb7099be046db`.
- DeFindex issued endpoint/auth documentation: `defindex-io/defindex-skill@9f8f7806be60a4e202009d44fd1af0e10605f2b5`.
- DeFindex contracts: `defindex-io/stellar-contracts@be878a9c1b0b176ec4351a85dad5557425c4a97c`.
- Stellar SDK16.0.1: `stellar/js-stellar-sdk@962fad4a45c43158738e552a30844a37108799cb`.

The original 232 selected source bodies are preserved in the programme's source carrier with full Git blob and SHA-256 identities. Live Swagger JSON was not obtained; interface completeness is stated against the selected full SDK, endpoint documents and contract bodies. The public application contains the authored adapters and provenance, not an unlicensed republication of the research repositories.
