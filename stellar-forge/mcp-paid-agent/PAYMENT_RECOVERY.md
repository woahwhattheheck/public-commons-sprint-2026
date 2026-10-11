# Inspect and retain an original payment outcome

The buyer keeps the seller's receipt, the original quote and an independent
transaction observation together. A failed MCP settlement now retains the native
facilitator's `x402/payment-response` metadata, including its transaction hash,
network, payer and failure reason. The original x402 wrapper still owns payment
verification, settlement and the tool's error result.

Open an original quote in the [browser console](CONSOLE.md), inspect **Payment
transaction**, and select **Read transaction outcome**. The same operation is
available to MCP clients as `bazaar_reconcile_payment`. It reads Stellar through
the host's configured adapter and saves the observation in the original quote's
`result.reconciliation`. It does not call the seller, sign another authorization,
resubmit a transaction or repeat the purchased tool.

## Connect the original native operator

The [native MCP operator](REMOTE_MCP.md) now returns `reconcilePayment` alongside
its existing approval, signer and close methods. Export that function from the
existing private operator module:

```js
export const {approve, signPayment, reconcilePayment, close} = operator;
```

`startMcpWorkspace` supplies the function to the original broker. Embedded hosts
can pass it as `new McpPaidToolBroker({..., reconcilePayment})`. The native helper
reuses the configured trusted payer and network. An optional
`reconciliationRpcUrl` selects an observation provider from the existing network
catalog; a private signing endpoint otherwise uses that network's original
public observation provider. `reconciliationHttpsProxyEnv` names an explicitly
selected CONNECT proxy environment variable. `reconciliationFetchImpl` accepts
an existing trusted host transport. None of these settings is an MCP argument.

## Inspect without loading a signer

For a read-only host, create a private module using the installed source path:

```js
import {createNativeMcpReconciler} from '/absolute/checkout/stellar-forge/mcp-paid-agent/payment-reconciliation.mjs';

export const reconcilePayment = createNativeMcpReconciler({
  payer: process.env.STELLAR_PAYER_ADDRESS,
  network: 'stellar:testnet',
  rpcUrl: process.env.STELLAR_OBSERVATION_RPC_URL,
  // Set this only if the host has explicitly selected that proxy:
  // httpsProxyEnv: 'HTTPS_PROXY',
});
```

Set the existing `MCP_OPERATOR_MODULE` to this absolute module path and reopen
the existing `MCP_STATE_DIR` with the normal workspace launcher. A module that
exports only `reconcilePayment` connects observation without approval or signing
functions. The controlling access token and workspace ownership remain the same.
No payer secret, payment operator runtime or merchant connection is needed to
read an unsuccessful transaction.

## Inspect an original quote

```json
{"quoteId":"ORIGINAL_QUOTE_ID"}
```

Pass this object to `bazaar_reconcile_payment`. The quote must record a signed
dispatch and must no longer be executing. The adapter obtains the transaction
from its retained server receipt and uses the quote's original exact payment
terms, plus the host's trusted payer. A simultaneous request for the same lookup
joins the active read instead of opening another RPC sequence.

Some results produced by x402/mcp 2.28 before this repair contain a settlement
error but omit its transaction hash. Use the original transaction from the
operator's retained execution record:

```json
{"quoteId":"ORIGINAL_QUOTE_ID","transaction":"ORIGINAL_64_CHARACTER_HASH"}
```

The resulting observation is labeled `transactionSource: OPERATOR_REFERENCE`.
The saved native result and its original receipt are not rewritten. A supplied
hash cannot replace a different hash already present in the original receipt.
The console exposes the same input only when its saved response lacks a valid
transaction hash.

## Read the actual outcome

The maintained SF86 verifier uses its original approved RPC network catalog,
network-passphrase check, bounded transport and official contract-event decoder.
Its observation includes the exact transaction, original quote terms, endpoint,
ledger, observation time and hashes of the actual RPC responses.

| Outcome | What the observation establishes |
| --- | --- |
| `FAILED` | The selected network returned this exact transaction as failed in the recorded ledger. The report retains the original server failure when available. Quoted payer, recipient and amount remain quote terms; this outcome does not represent a completed transfer. |
| `NOT_FOUND` | This RPC did not return the transaction in its available history. This outcome does not establish that a payment never occurred. |
| `TRANSFER_MATCHED` | The original SF86 verifier found exactly one successful contract transfer for the quoted payer, recipient, asset and atomic amount in this transaction. Its existing transfer report and event digests are included. |

The original quote status describes what happened in the buyer operation; the
independent observation describes the selected transaction. Both remain visible
after restart. A signing failure before dispatch remains `REJECTED` and has no
transaction to reconcile. A server-reported unsuccessful settlement remains
separate from a network-confirmed failed transaction until the lookup completes.

If the local observation cannot be saved, the MCP response includes it separately
as `transactionObservation` with `saved:false` and a storage error. The console
offers its download immediately. The broker preserves the original quote,
receipt, status and any earlier saved observation; a full disk cannot turn a
confirmed payment into an uncertain one merely because an inspection failed.
The same detached response is used if local recovery reveals a different original
receipt while a lookup is active. Recovery preserves an older observation for a
different reference as `supersededReconciliation`, separately from the restored
native receipt, and continues recovering the useful native result.

The lookup does not change a spending reservation or authorize another purchase.
A later purchase uses its own explicit original approval workflow. Original
funded attempts and subsequent rejected authorizations remain separate records.

## Retain and recover the full receipt

The complete saved MCP `CallToolResult` contains the native receipt, including
fields outside the compact status view. Status retains network, transaction,
payer, `success`, `errorReason` and `errorMessage`; unusually long values are
shortened with explicit `truncatedFields`, while the complete result retains
their original values.

The seller observes the actual native facilitator return in a per-call async
context. It adds that receipt only when the official wrapper omitted it. It
preserves an existing SDK receipt, the native error content and the original
handler invocation. Concurrent sessions cannot acquire each other's receipts.
If the wrapper fails after settlement returned, the actual receipt accompanies
the original execution-error result as well.

**Recover saved files** uses the original complete native result and verifies
its preview, quote identity, existing receipt fields and file bytes. It can
restore failure details that an older compact quote snapshot omitted. It cannot
recover a receipt that was never present in the returned native result; use the
explicit transaction-reference lookup for that case. An already saved transaction
observation is retained when local result metadata is recovered.

The original [result inbox](RESULTS.md), file download and private SQLite history
remain the durable consumers. Reconciliation is a separate saved observation;
the full native result file and its digest remain unchanged.
