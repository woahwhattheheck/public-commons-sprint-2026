# Palmera / Safe transaction review

Capture an existing Palmera or Safe transaction, buy its exact Tenderly simulation through the original Stellar buyer, review the result, and deliver a portable handover that another operator can reopen.

The adapter keeps the original Safe transaction object at the SDK boundary. The SDK supplies the Safe transaction hash and complete encoded `execTransaction` call. The existing Tenderly customer owns merchant selection, the original SF88 intent, payment review, execution, recovery and response validation. The existing analysis workspace owns traces, state changes, assets, logs, comparison and CSV export.

## Runtime and source

Use the maintained Node 24 runtime with the complete Starforge source and its installed feature dependencies. The capture module runs inside the caller's existing Palmera / Safe application environment. Keep that application's SDK installation, provider and wallet connection.

The SDK seam was checked against Palmera `1.0.0-beta.1`, which declares Safe Protocol Kit `4.1.0`. Its [original Palmera source](https://github.com/keyper-labs/palmera-module-sdk/blob/main/src/Palmera.ts) exposes `getSafeSDK()` and returns original Safe transactions. The reviewed Palmera source blob is `9347187b5f1c86afd7e08fa2a78c0c885733cbf3`. Safe's [Protocol Kit 4.1.0 source in release r45](https://github.com/safe-global/safe-core-sdk/blob/r45/packages/protocol-kit/src/Safe.ts) supplies `getEncodedTransaction(transaction)` and `getTransactionHash(transaction)`.

The saved transaction record names these reviewed interfaces and retains the actual Safe address, network and contract version returned by the caller's SDK.

Related original operating surfaces:

- [Tenderly merchant and workspace](../tenderly-stellar-pilot/)
- [Original Tenderly customer](../tenderly-stellar-pilot/customer/)
- [Original native buyer and operator configuration](../../sf88-operator-buyer-cli/)
- [Original Node buyer SDK](../../sf88-operator-buyer-cli/node/)
- [Original Tenderly analysis workspace](../../sf88-operator-buyer-cli/tenderly-analysis/)

All CLI paths below are absolute. Set `SAFE_REVIEW_CLI` to this directory's `cli.mjs`; `BUYER_RUNTIME` to the original SF88 runtime directory; and `REVIEW_ROOT` to an operator-owned private working directory.

```sh
node "$SAFE_REVIEW_CLI" --help
```

## 1. Capture the transaction already selected in Palmera

The application integration uses the original objects directly:

```js
import { preparePalmeraSelection } from './transaction.mjs';

const selected = await preparePalmeraSelection({
  palmera,                         // the application's initialized Palmera instance
  transaction: selectedTransaction, // its existing original SafeTransaction
  directory: selectionDirectory,  // absolute private destination
  context: reviewedContext,
  label: 'Treasury transaction review',
  origin: {
    application: 'Palmera',
    operation: selectedOperationName,
    reference: originalApplicationReference
  }
});
```

For an application using Protocol Kit directly, `prepareSafeSelection({safe, transaction, ...})` accepts its initialized original Safe instance.

The explicit simulation context has exactly six fields:

| Field | Meaning |
| --- | --- |
| `networkId` | Decimal EVM network ID; must match the actual SDK network. |
| `blockNumber` | Exact nonnegative block number accepted by the original Tenderly request contract. |
| `transactionIndex` | Exact transaction position within the selected block. |
| `from` | The intended outer execution caller address. |
| `gas` | The selected outer execution gas limit. |
| `value` | Exact decimal-string outer execution value in wei. |

The original request contract validates these values. The saved public body uses `block_number`, `transaction_index`, `from`, the actual Safe address as `to`, the SDK's encoded execution call as `input`, `gas` and `value`. Decimal value and gas-price fields inside the Safe transaction remain strings.

Transaction data, encoded signatures, context and origin are captured before asynchronous SDK reads. The adapter checks transaction and SDK identity again when the reads finish. A changed transaction requires a fresh selection. The selected Safe hash is stored as `transactionHash`; any Palmera module operation or application reference stays separately in `origin`.

The directory contains three original selection files:

| File | Content |
| --- | --- |
| `safe-transaction.json` | Original SDK transaction data, signatures, hash, encoded execution, Safe identity and selected context. |
| `simulation.json` | Exact public request bytes for the merchant. |
| `selection.json` | Both file descriptors and the immutable selection ID. |

### Use the same capture through the CLI

A caller-owned ESM module exports `async loadTransaction({context})`. It returns either `{palmera, transaction}` or `{safe, transaction}`, with optional `label`, `origin` and `close()`. The module retrieves the actual selected transaction from the existing application. The optional close function releases resources owned by that factory.

```sh
node "$SAFE_REVIEW_CLI" capture \
  --module "$REVIEW_ROOT/current-transaction.mjs" \
  --context "$REVIEW_ROOT/selected-context.json" \
  --out "$REVIEW_ROOT/selection-a"

node "$SAFE_REVIEW_CLI" selection \
  --directory "$REVIEW_ROOT/selection-a"
```

A capture uses the signatures currently present in the original transaction. Keep the actual execution caller, signatures, nonce and block position together when choosing the simulation context.

## 2. Prepare the original merchant purchase

Use the merchant's original workspace or customer interface to issue an operation ticket for `selection-a/simulation.json`. Retain its actual plan and ticket. The original [Tenderly customer preparation](../tenderly-stellar-pilot/CUSTOMER.md) owns the compiled offer, ticket validation and selected request terms.

```sh
node "$SAFE_REVIEW_CLI" prepare \
  --selection "$REVIEW_ROOT/selection-a" \
  --plan "$REVIEW_ROOT/merchant-plan.json" \
  --ticket "$REVIEW_ROOT/merchant-ticket-a.json" \
  --intent safe-review-a \
  --out "$REVIEW_ROOT/prepared-a"
```

This operation retains the exact selection, plan and ticket, derives the original merchant selection and saves one original buyer configuration. The merchant network must match the selected Safe network. Its directory contains the complete native `buyer.json`, `merchant-selection.json`, both original input files and the saved selection.

```sh
node "$SAFE_REVIEW_CLI" prepared \
  --directory "$REVIEW_ROOT/prepared-a"
```

Preparation uses the original ticket expiry rules. The original buyer still performs its own current approval and ticket checks when executing the purchase.

## 3. Import, review and execute through the original buyer

Use the original buyer's operator-profile format and established signer configuration:

```sh
node "$SAFE_REVIEW_CLI" import-prepared \
  --directory "$REVIEW_ROOT/prepared-a" \
  --operator-profile "$REVIEW_ROOT/operator-profile.json" \
  --state "$REVIEW_ROOT/buyer-state" \
  --runtime "$BUYER_RUNTIME"

node "$SAFE_REVIEW_CLI" review \
  --intent safe-review-a \
  --out "$REVIEW_ROOT/purchase-review-a.json" \
  --state "$REVIEW_ROOT/buyer-state" \
  --runtime "$BUYER_RUNTIME"
```

The review file joins the selected Safe transaction and merchant with the unchanged original buyer review. Inspect the merchant's native payment terms, actual request, operation ticket and signer decision through that original review. Then explicitly execute the reviewed simulation purchase:

```sh
node "$SAFE_REVIEW_CLI" execute \
  --intent safe-review-a \
  --review "$REVIEW_ROOT/purchase-review-a.json" \
  --state "$REVIEW_ROOT/buyer-state" \
  --runtime "$BUYER_RUNTIME"
```

This starts the original simulation purchase. Safe transaction execution stays in the original Palmera / Safe application.

The `SafeSimulationBuyer` class exposes the same workflow for application integration:

```js
const buyer = new SafeSimulationBuyer({
  runtimeDirectory,
  stateDirectory,
  analysisWorkspace
});
const operation = await buyer.fromPrepared(preparedDirectory, {operatorProfile});
const review = await operation.review();
// Present this exact review in the original operator flow.
const result = await operation.execute({review});
const summary = await result.summary();
```

## 4. Continue the same intent after a lost reply

```sh
node "$SAFE_REVIEW_CLI" inspect \
  --intent safe-review-a \
  --state "$REVIEW_ROOT/buyer-state" \
  --runtime "$BUYER_RUNTIME"

node "$SAFE_REVIEW_CLI" recover \
  --intent safe-review-a \
  --state "$REVIEW_ROOT/buyer-state" \
  --runtime "$BUYER_RUNTIME"
```

Recovery calls the original buyer's retained result path for this exact intent. A completed Tenderly response is validated against the retained network, block, transaction position, caller, Safe address, encoded execution, gas and value.

A reverted EVM simulation remains a completed simulation result when the provider returned it successfully. Its original status, error, traces and changes remain available for review.

If import created the original buyer intent but its final Safe binding was interrupted, finish that original attachment:

```sh
node "$SAFE_REVIEW_CLI" attach \
  --intent safe-review-a \
  --selection "$REVIEW_ROOT/prepared-a/selection" \
  --merchant-selection "$REVIEW_ROOT/prepared-a/merchant-selection.json" \
  --state "$REVIEW_ROOT/buyer-state" \
  --runtime "$BUYER_RUNTIME"
```

Attachment requires the same exact original request bytes, native configuration, network and merchant. The original intent remains the payment authority.

## 5. Review and compare in the existing analysis workspace

```sh
node "$SAFE_REVIEW_CLI" analyze \
  --intent safe-review-a \
  --analysis "$REVIEW_ROOT/analysis" \
  --state "$REVIEW_ROOT/buyer-state" \
  --runtime "$BUYER_RUNTIME"

node "$SAFE_REVIEW_CLI" serve \
  --analysis "$REVIEW_ROOT/analysis"
```

The server prints its original loopback URL with the local operator token. It provides the existing call trace, state, asset and log views, retained captures, comparison, review notes and export. Stop the CLI with Ctrl-C to close that original listener.

A revised transaction receives its own capture and original purchase intent, such as `safe-review-b`. Compare the completed original results:

```sh
node "$SAFE_REVIEW_CLI" compare \
  --before safe-review-a \
  --after safe-review-b \
  --analysis "$REVIEW_ROOT/analysis" \
  --title "Treasury revision review" \
  --notes "$REVIEW_ROOT/review-notes.txt" \
  --state "$REVIEW_ROOT/buyer-state" \
  --runtime "$BUYER_RUNTIME"
```

Both selections must name the same Safe and network. Each keeps its own original block, caller, encoded execution and purchase result. The original analysis engine performs the comparison and saves the review.

## 6. Deliver and reopen a complete handover

```sh
node "$SAFE_REVIEW_CLI" handover \
  --intent safe-review-a \
  --analysis "$REVIEW_ROOT/analysis" \
  --out "$REVIEW_ROOT/handover-a" \
  --state "$REVIEW_ROOT/buyer-state" \
  --runtime "$BUYER_RUNTIME"
```

Open `handover-a/index.html` for the industrial review index. Its links lead to the original analysis report, full provider response, exact selected transaction, native buyer result and source manifests.

The handover contains:

- `selection/`: the three exact original Safe selection files.
- `tenderly/`: the original completed customer export, including request bytes, response and unchanged native result.
- `analysis/`: the existing analysis export, report and four CSV tables.
- `index.html`: the portable Safe transaction and simulation overview.
- `manifest.json`: the joined file descriptors, selection ID, original intent, response digest and analysis capture ID.

The first complete original customer export owns the native result used for analysis. A later process recovery can add recording metadata to the live buyer result; reopening the same handover keeps its first retained record.

The receiving operator can validate the delivered directory without a wallet or running merchant:

```sh
node "$SAFE_REVIEW_CLI" open \
  --directory "$REVIEW_ROOT/handover-a"

node "$SAFE_REVIEW_CLI" receive \
  --from "$REVIEW_ROOT/handover-a" \
  --out "$REVIEW_ROOT/received/handover-a" \
  --analysis "$REVIEW_ROOT/received/analysis"

node "$SAFE_REVIEW_CLI" serve \
  --analysis "$REVIEW_ROOT/received/analysis"
```

Receiving copies only the declared original members, publishes the final manifest after them, and feeds the same response, request and native result through the original analysis library. The resulting capture ID must match the delivered capture.

## Retained operation behavior

| Interrupted step | Continue |
| --- | --- |
| Selection publication | Repeat the same selected input into the same output; matching published bytes are reused. |
| Purchase preparation | Repeat `prepare` with the same selection, plan, ticket, intent and destination. |
| Native import before Safe attachment | Use `attach` for the already created original intent. |
| Purchase reply | Use `inspect` and `recover` on that same original intent. |
| Handover publication | Repeat `handover` with the same intent and destination. |
| Recipient copy or analysis import | Repeat `receive` with the same source, destination and analysis workspace. |

A changed selection, plan, ticket, native configuration or completed file produces a concrete source-conflict error. Retained directories and original operation records stay available for inspection. New transaction selections use new output directories and their own original purchase intents.

## Module map

| Module | Responsibility |
| --- | --- |
| `transaction.mjs` | Original SDK capture, immutable selection and exact receiving. |
| `preparation.mjs` | Original merchant draft and retained offline purchase preparation. |
| `workspace.mjs` | Thin native customer binding, reviewed execution, recovery and comparison. |
| `handover.mjs` | Original customer/analysis export join and portable receiving. |
| `report.mjs` | Offline industrial review index. |
| `cli.mjs` | Complete operator workflow and original analysis listener. |
