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

## Original operation and custody

The queue's private execution snapshot identifies the original operator, ledger,
payer and evidence directory. The original SF82 record retains the SF62 request
and digest. Their URL, method, body presence/length/digest, exact payment terms
and owner identities must agree. The Python worker independently validates the
full digest and HMAC-audited reservation. Passing the selected digest explicitly
prevents evidence replacement between those steps from selecting another request.

`openWorkspace(..., {accounting:true})` uses the original protected key loader
without invoking signer prerequisites, loading a wallet provider or accessing
its secret variable. Only the three original SF36 keys enter the Python worker
environment. Its separate Node observer receives no operator keys. A later
reduction in the workspace's new-spending cap does not erase an earlier reservation.

The observer uses the workspace's explicitly configured testnet RPC. Supported
providers are SDF and Gateway, both in the [Stellar provider directory](https://developers.stellar.org/docs/data/apis/rpc/providers):

- `https://soroban-testnet.stellar.org`
- `https://soroban-rpc.testnet.stellar.gateway.fm`

The selected provider must return the canonical testnet passphrase before its
transaction and native transfer events are read. The observation retains that
endpoint. There is no automatic provider fallback, seller-selected RPC or loopback
finalization. The original official SDK decoder also supports the maintained
buyer's local pinned installation.

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
