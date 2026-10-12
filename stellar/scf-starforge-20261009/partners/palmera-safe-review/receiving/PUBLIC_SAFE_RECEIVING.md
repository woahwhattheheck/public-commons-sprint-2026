# Original public Safe receiving input

This input selects the Safe project's recorded Gnosis owner-replacement execution. Use it with the merged Palmera / Safe adapter at `11bbd567750a67dc23d74fe3a8c4a0c4de85809d` and the original buyer/analysis engine.

## Original source

- Source repository: `safe-global/safe-eth-py`, commit `7ff81f717d34b3f744ce16ab193e4671a14e65da`.
- Original transaction data: [mock_transactions.py](https://github.com/safe-global/safe-eth-py/blob/7ff81f717d34b3f744ce16ab193e4671a14e65da/safe_eth/safe/tests/mocks/mock_transactions.py), blob `ff66dc6898004d6d2ad3c98dc12d04464b7ecb4f`.
- Its original network-read case: [test_transaction_service_api.py](https://github.com/safe-global/safe-eth-py/blob/7ff81f717d34b3f744ce16ab193e4671a14e65da/safe_eth/safe/tests/api/test_transaction_service_api.py), blob `ab28acc8e20b96e568549f3b43351d36ac4082a6`.
- Network: Gnosis, chain ID `100`.
- Safe: `0xAedF684C1c41B51CbD228116e11484425d2FACB9`, original nonce `5`.
- Outer transaction: `0x27ac6f19a73da17d632259563aafb5092ace7e44c932ca1ed2336b2da83b30ca`.
- Original Safe transaction hash: `0x06c88df42a8ab64b2b2c5e2b5c8c4df384c267b39929a8416d1518db23f91783`.
- Block `32106343`; source execution date `2024-01-24T15:22:55Z`.
- Original executor: `0xc6b82bA149CFA113f8f48d5E3b1F78e933e16DfD`.
- Exact approved-hash signature: 65 bytes, retained in `public-safe-source.json`.

The original source supplies the Safe transaction and signature. The read helper obtains the actual outer transaction and receipt through the existing SDK provider and derives the original transaction index, outer gas limit and outer value. It checks the block, executor, receipt, Safe hash and complete SDK-encoded execution calldata before returning the selected input. The source's `gasUsed=84977` is a receipt observation, not the outer gas limit.

## Maintained caller runtime

Original Palmera source is [c1be7138f9cfedfd9a5dbaeb990994b95f18d591](https://github.com/keyper-labs/palmera-module-sdk/tree/c1be7138f9cfedfd9a5dbaeb990994b95f18d591). Its package metadata blob `c0c28e8ab3a168c44f743bb6c113061b23c3a452` declares `@keyper-labs/palmera-module-sdk@1.0.0-beta.1` and `@safe-global/protocol-kit@4.1.0`. Original `yarn.lock` blob `995e78d2a1e39444db9f49e3fada5f52b76389fd` retains the 4.1.0 tarball:

```text
https://registry.yarnpkg.com/@safe-global/protocol-kit/-/protocol-kit-4.1.0.tgz
sha512-WAGXEn6UvKGlEYNqcWUasLZ4240sVWBg8T2SsfHoTs8Im0x2i48CNNZ5Mw9x+oKqhWs/Q9frNG6JcycN19LDRw==
```

That lock also has an indirect Protocol Kit 5.0.3. Resolve Protocol Kit from the actual Palmera package, as the helper does, and retain both resolved package paths/version readbacks in the existing case. The runtime inventory invocation on 2026-10-12 ended with `environment_offline409` before process creation, so this source handoff does not name a physically verified local caller installation.

Gnosis publishes the public starter RPC at [its original RPC provider page](https://docs.gnosischain.com/tools/RPC%20Providers/): `https://rpc.gnosischain.com/`. Use the operator's selected existing RPC if that is already configured.

Palmera 1.0.0-beta.1's original non-deterministic deployment map supports Polygon137, Base8453 and Sepolia11155111. This Gnosis source uses `prepareSafeSelection`. A caller's real Palmera transaction on one of those supported networks uses the same merged `preparePalmeraSelection` interface.

## One original receiving operation

Run the helper within the existing owner-selected runtime and receiving case. It exports:

```js
const selected = await readPublicSafe({
  callerRoot: absoluteExistingCallerProject,
  rpc: selectedExistingRpc,
  sourceFile: absolutePublicSafeSourceJson
});
try {
  const selection = await prepareSafeSelection({
    directory: absoluteSelectionDirectory,
    safe: selected.safe,
    transaction: selected.transaction,
    context: selected.context,
    label: selected.label,
    origin: selected.origin
  });
  // Retain selected.outer, selected.receipt, selected.runtime and selected.context
  // beside the existing case; selection/ retains its original three-file format.
} finally {
  await selected.close();
}
```

For the original CLI, retain the returned exact six-field context as `selected-context.json`; the caller-owned module's `loadTransaction({context})` returns the same original `safe`, `transaction`, `label`, `origin` and `close` after comparing the retained context to its observed context.

```sh
node "$SAFE_REVIEW_CLI" capture --module "$CASE/current-transaction.mjs" --context "$CASE/selected-context.json" --out "$CASE/selection"
node "$SAFE_REVIEW_CLI" selection --directory "$CASE/selection"
node "$SAFE_REVIEW_CLI" prepare --selection "$CASE/selection" --plan "$CASE/merchant-plan.json" --ticket "$CASE/merchant-ticket.json" --intent "$ORIGINAL_INTENT" --out "$CASE/prepared"
node "$SAFE_REVIEW_CLI" import-prepared --directory "$CASE/prepared" --operator-profile "$CASE/operator-profile.json" --state "$CASE/buyer-state" --runtime "$BUYER_RUNTIME"
node "$SAFE_REVIEW_CLI" review --intent "$ORIGINAL_INTENT" --out "$CASE/purchase-review.json" --state "$CASE/buyer-state" --runtime "$BUYER_RUNTIME"
```

The actual merchant plan and issued operation ticket must select EVM network100 and this exact body. Continue the existing buyer's review/execute/recover and original portable handover/receive commands from the merged [operating guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/11bbd567750a67dc23d74fe3a8c4a0c4de85809d/stellar/scf-starforge-20261009/partners/palmera-safe-review/README.md) on the same intent. The retained public source is the input; the original native/provider result and payment state remain the actual receiving outcome.
