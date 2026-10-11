# Operate the original buyer on Stellar mainnet

The original workspace, native SDK signer, saved checkout, inbox and SF36
accounting worker accept `stellar:pubnet`. The network comes from the selected
merchant offer and stays bound to the approved operation, payer, asset,
reservation and transaction receipt throughout the same workflow.

## Prepare and initialize

Use the maintained checkout on Node 22+ and Python 3.11+, with the buyer's pinned
dependencies installed as described in [NATIVE_SIGNER.md](NATIVE_SIGNER.md).
Select the actual mainnet offer from your saved discovery using the existing
`--prepare` command. Supply the offer's original URL, method, selected row and
accepted option; retain its exact request body and operation ticket when present.
The resulting review file must say `operation.expect.network: stellar:pubnet`
and contain that offer's mainnet asset contract and recipient.

The initializer consumes this review file. It never changes a testnet quote
into a mainnet quote, and an existing workspace's network cannot be switched.
Create the private workspace for the selected mainnet operation:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --init-workspace --config /private/mainnet-review.json \
  --dir /private/mainnet-operator --actor owner-operator \
  --service selected-merchant --payer ACTUAL_EXISTING_MAINNET_PUBLIC_ADDRESS \
  --python /usr/bin/python3 --secret-env STELLAR_MAINNET_SECRET

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review-workspace --dir /private/mainnet-operator

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --diagnose-workspace --dir /private/mainnet-operator
```

The payer is the existing operator account's public G-address. Use the existing
wallet setup to provide the named secret, or replace `--secret-env` with
`--signer-provider /absolute/operator/wallet.mjs`. Initialization and review do
not open that wallet. The default total and daily budget equal the approved
per-operation maximum; larger budgets use the original explicit
`--total-atomic` and `--daily-atomic` options.

## Network and RPC selection

The signer and accounting worker share [networks.json](../sf86-rpc-transfer-reconcile/networks.json).
Its canonical passphrases and public providers follow the
[Stellar network documentation](https://developers.stellar.org/docs/networks)
and [provider directory](https://developers.stellar.org/docs/data/apis/rpc/providers).

| Approved network | Default RPC | Other supported accounting RPC |
| --- | --- | --- |
| `stellar:testnet` | `https://soroban-testnet.stellar.org` | `https://soroban-rpc.testnet.stellar.gateway.fm` |
| `stellar:pubnet` | `https://soroban-rpc.mainnet.stellar.gateway.fm` | `https://archive-rpc.lightsail.network/` |

`--rpc` explicitly selects the workspace signer/RPC setting. The original
signer also supports an operator's own HTTPS RPC; the privileged accounting
worker uses the listed public providers. A provider listed for the other
network is rejected before signing. The default mainnet provider supports the
current native SDK operation; the archive provider is available to the separate
read-only SF86/SF36 commands for older transactions.

Before reading a live transaction, the observer requires the selected network's
exact canonical passphrase. For pubnet this is
`Public Global Stellar Network ; September 2015`. A matching hash or successful
HTTP response from the wrong network cannot complete observation or accounting.
Providers are selected explicitly; failed lookups do not silently switch them.

## Execute and finish the same inbox operation

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  init --root /private/mainnet-inbox

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  enqueue --root /private/mainnet-inbox --config /private/mainnet-operator/operator.json

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  execute --root /private/mainnet-inbox --intent ORIGINAL_INTENT_ID \
  --workspace /private/mainnet-operator

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  finalize --root /private/mainnet-inbox --intent ORIGINAL_INTENT_ID \
  --workspace /private/mainnet-operator

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  report --root /private/mainnet-inbox --out /private/mainnet-history.html \
  --workspace /private/mainnet-operator
```

Use the original review's intent ID. Execution enters the existing terminal
approval and durable reservation flow before the native SDK signs. It makes
the same one paid retry and retains the original checkout response and record.
`finalize` reuses that attempted operation, opens only the original accounting
keys, and records an independently matched transfer against its reservation.
The canonical accounting receipt is `stellar:pubnet/TRANSACTION_HASH`.
The original callback and file-delivery outcomes remain visible separately.

After a restart, use the same workspace, inbox and intent. Repeating `finalize`
returns the authenticated original result without another signature, transfer
or finality attestation. A testnet receipt/status cannot be credited as pubnet,
and the legacy `checkStellarTestnetTransaction()` API still accepts testnet only.
See [FINALIZATION.md](FINALIZATION.md) for full request binding and recovery.
