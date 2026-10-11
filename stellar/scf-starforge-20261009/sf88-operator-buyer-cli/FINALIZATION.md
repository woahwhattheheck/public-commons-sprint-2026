# Finish accounting for a saved buyer purchase

The original inbox can finalize an existing attempted purchase through the same
operator workspace and SF36 spending ledger. It matches the complete approved
request to the inbox, observes the original transaction through SF86, and saves
the ledger result next to the attempt. It does not open the wallet, request
another signature or repeat the merchant purchase.

Install the pinned native runtime once from the maintained checkout:

```sh
npm --prefix stellar/scf-starforge-20261009/sf88-operator-buyer-cli ci --ignore-scripts --no-audit --no-fund
```

Use the existing private operator workspace and the same attempted intent:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  finalize --root /private/buyer-inbox --intent merchant-forecast-001 \
  --workspace /private/merchant-operator

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  show --root /private/buyer-inbox --intent merchant-forecast-001

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  report --root /private/buyer-inbox --out /private/buyer-history.html \
  --workspace /private/merchant-operator
```

The report includes the accounting outcome, actual atomic units, canonical
transaction receipt, finality identity, observation time and merchant callback
state. Supplying `--workspace` when exporting adds the concrete finalization
command for each attempted intent. Report export reads no keys and executes no
accounting. After finalization, the saved workspace is available to later exports.

The maintained Python host and inbox share the original
`finalizeOriginalAttempt()` export from `finalization.mjs`. The trusted caller
supplies its existing private `configurationPath`, `configSha256`, `intentId`,
canonical `evidencePath`, `bodySha256` (null for an absent body), `bodyBytes`,
`attemptStartedAt`, and `workspace`; `outbox`, `merchantRoute` and `signal` are
optional. It must validate and retain its original attempt record before calling.
The shared core checks those facts against the original config, approved request,
evidence and SF36 ledger without creating a queue job. It returns `result`,
`approvedRequestSha256`, `evidencePath`, `evidenceSha256`, `workspace` and
`completedAt`. The inbox wrapper adds only its original attempt identity and
saved accounting view, including prior successful finalization after restart.

## Original operation and custody

The queue's private execution snapshot identifies the original operator, ledger,
payer and evidence directory. The original SF82 record retains the SF62 request
and digest. Their URL, method, body presence/length/digest, exact payment terms
and owner identities must agree. The Python worker independently validates the
full digest and HMAC-audited reservation. Passing the selected digest explicitly
prevents evidence replacement between those steps from selecting another request.

`openWorkspace(..., {accounting:true})` uses the original protected key loader
without invoking signer prerequisites, loading a wallet provider or accessing
its secret variable. The three original SF36 keys enter the Python worker
environment; an explicitly configured proxy contributes only its validated,
credential-free endpoint. Its separate Node observer receives no operator keys. A later
reduction in the workspace's new-spending cap does not erase an earlier reservation.

The observer uses the workspace's RPC for the original approved network.
The shared [network catalog](../sf86-rpc-transfer-reconcile/networks.json)
contains SDF and Gateway for testnet, Gateway and Lightsail archive for pubnet,
as listed in the [Stellar provider directory](https://developers.stellar.org/docs/data/apis/rpc/providers).
The respective defaults are SDF testnet and Gateway mainnet. The complete
mainnet operation is documented in [MAINNET.md](MAINNET.md).

Equivalent root URLs with an optional trailing slash normalize to the same
provider. Credentials, additional paths, queries and fragments are rejected.

The selected provider must return that network's canonical passphrase before its
transaction and native transfer events are read. The observation retains that
endpoint. There is no automatic provider fallback, seller-selected RPC or loopback
finalization. The original official SDK decoder also supports the maintained
buyer's local pinned installation.

The request, reservation, receipt, provider and positive transfer verdict must
all agree on `stellar:testnet` or `stellar:pubnet`. Python and Node read the same
catalog. The final receipt retains that network prefix, so a transfer on one
network cannot be reused to discharge a reservation on the other.

If the workspace already selects `buyerTransport`, finalization uses that same
explicit fixed proxy or named environment source. It compares the queued and
workspace profiles and resolves the current endpoint before starting the worker.
No extra inbox command flag is needed. A managed cloud may change its proxy port
between commands; the saved environment name remains stable and the next
invocation resolves its current value. Missing or invalid selected proxy values
fail without changing the original accounting ledger.

The credential-free endpoint travels through a private worker environment value
and then the original observer's private JSON pipe. The resolved environment value
is absent from process arguments, saved workspaces, finalization reports and output.
An existing fixed proxy profile remains the operator's original configuration. The observer creates
a separate original SF31 CONNECT transport pinned only to the already selected
public RPC origin, retaining original SF85 TLS verification. Merchant headers,
tickets and wallet data never enter that connection. The default continues to
use the original direct RPC transport; no proxy or provider is selected implicitly.

## Outcomes and restart

| Result | Operator meaning |
| --- | --- |
| `FINALIZED` | Original SF36 recorded the matching actual transfer against its reservation. |
| `IDEMPOTENT_FINALIZED` | The same ledger already contains this finality; the command reused it without another observation or attestation. |
| `NOT_FINALIZED` | The original record or current observation could not complete finalization; inspect the returned reason. |
| `WORKER_ERROR` | Inspect the original ledger and rerun the same command after correcting the runtime issue. |

The inbox's `finalization.json` and workspace's `finalization-reports` directory
are replaceable views of the original ledger. They do not authorize a payment
or substitute for its authenticated state. Financial completion does not change
the permanent queue attempt marker or make the intent executable.

If saving the inbox view fails after accounting succeeds, the command retains
the actual result in its output and reports `finalizationView.status: SAVE_FAILED`.
Rerun the same command to rebuild the view. A later unsuccessful check retains
the earlier saved finalized result explicitly. An interrupted command may have
completed accounting; the same command resolves that state from the ledger.

`recover` remains the existing saved-evidence operation. File delivery and
merchant fulfillment retain their own original results; finalizing a transfer
does not mark a partial file complete. If the actual original SF98 outbox is on
the same trusted host, pass `--outbox ABS --merchant-route ORIGINAL_ROUTE_ID`
to include its original notification state. Remote merchants keep that state
in their own service; no outbox is inferred from a payment header.

For continuous existing-evidence sweeps, use the original
[SF36 worker](../sf36-spend-governor/FINALIZATION.md). Its existing ledger remains
the progress record across restart. The inbox command completes one explicitly
selected attempted intent at a time.
