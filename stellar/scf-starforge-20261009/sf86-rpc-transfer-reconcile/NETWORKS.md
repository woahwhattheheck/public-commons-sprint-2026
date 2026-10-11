# Reconcile native Stellar transfers on both networks

SF86 now reads the original SF81 record or SF82 evidence on `stellar:testnet`
and `stellar:pubnet`. It uses the original SF43 decoder from the installed
`@stellar/stellar-sdk`, and the same exact transaction, payer, token, recipient
and atomic-amount comparison on either network.

## Select the network's provider

The payment record retains its original network. The verifier chooses the
corresponding default below, or accepts an explicitly selected provider from
that network's fixed list. A root HTTPS URL accepts one trailing slash and is
recorded in its canonical form.

| Payment network | Default RPC | Additional RPC | Successful verdict |
| --- | --- | --- | --- |
| `stellar:testnet` | `https://soroban-testnet.stellar.org` | `https://soroban-rpc.testnet.stellar.gateway.fm` | `CHAIN_TRANSFER_MATCHED_RPC_TESTNET` |
| `stellar:pubnet` | `https://soroban-rpc.mainnet.stellar.gateway.fm` | `https://archive-rpc.lightsail.network/` | `CHAIN_TRANSFER_MATCHED_RPC_PUBNET` |

These endpoints are listed in the [Stellar RPC provider directory](https://developers.stellar.org/docs/data/apis/rpc/providers),
reviewed October 11, 2026. Provider selection is explicit; failed requests do
not switch providers. Keep the selected endpoint in an existing operator plan.

Every provider verification begins with
[`getNetwork`](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getNetwork).
Its passphrase must equal the known value for the payment network:

| Network | Required passphrase |
| --- | --- |
| Testnet | `Test SDF Network ; September 2015` |
| Public network | `Public Global Stellar Network ; September 2015` |

The result retains that passphrase, the selected endpoint, and the SHA-256 of
the observed network response. The verifier then reads
[`getTransaction`](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction)
and [`getEvents`](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents).
The first event request selects the transaction's ledger with an exclusive
`endLedger`; cursor continuation omits both ledger bounds as the RPC API
requires. The complete transaction ledger is checked for exactly one matching
decoded SEP-41 transfer. Original pagination, duplicate and decoding checks
remain in the existing verifier.

For a retained public-network checkout:

```sh
node stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/cli.mjs \
  --sf82-evidence /private/checkout/ORIGINAL_INTENT_SHA256.json \
  --payer YOUR_ORIGINAL_TRUSTED_G_ADDRESS \
  --rpc-endpoint https://soroban-rpc.mainnet.stellar.gateway.fm
```

The payer comes from the original wallet operator. `--sf81-result` accepts the
existing stripped original record as an alternative input. The CLI retains
its JSON output and exit statuses. The result schema remains
`stellar-forge.sf86.rpc-reconciliation.v1`; public-network success adds the
distinct source `official-stellar-pubnet-rpc`. For several original records,
use the [retained collection workflow](BATCH.md).

## Accounting integration

The original merchant accounting reader now accepts both network-specific SF86
results. Public-network proof requires the matching fixed provider, canonical
passphrase, network response digest, transaction response digest, event page
digests, and the original exact-transfer fields. Older original testnet proof
files keep their existing acceptance rules.

Proof lookup, duplicate transaction detection and unused-proof accounting use
the pair `(network, transaction fingerprint)`. An identical hash on another
network has its own entry. A native event still needs one matching configured
payment option, including its recorded recipient or unique legacy recipient
mapping. Conflicting proof files and reused transactions remain exceptions.
Accounting terms use the verifier's checked Stellar StrKeys, a C-contract asset,
a G-account or C-contract recipient, and a positive signed-i128 atomic amount.

Matched public-network rows have `verificationScope: OFFICIAL_PUBNET_RPC`.
Unmatched public-network rows retain `PUBLIC_NETWORK_PENDING` and contribute
to `totals.publicNetworkPending`. Testnet rows retain their original
`OFFICIAL_TESTNET_ONLY` scope. `OFFICIAL_TRANSFER_MATCHED` and all existing
CSV/report fields stay compatible with the original accounting workspace.

## Existing caller compatibility

The original buyer, governor, finalizer, verifier and collector share
[`networks.json`](networks.json). `checkOriginalTerms(record, payer)` validates
the original reservation and receipt on either supported network.
`NETWORKS`, `networkProfile` and `resolveRpcEndpoint` remain the original
shared interfaces; `RPC_NETWORKS` derives its collection/accounting view from
that same catalog. The buyer still selects its network through the original
operator configuration and reservation workflow.

`rpcNetwork(network, endpoint)` exports the selected fixed network profile.
`reconcileRpc` additionally accepts an `AbortSignal`; cancellation interrupts
network reads and returns the existing error path. Public input cannot select
an arbitrary endpoint. Local HTTP development endpoints retain
`LOCAL_RPC_REPLAY_MATCHED` on either network, which the accounting reader ignores.

RPC history is provider-retained. A missing or failed transaction yields an
unresolved result, which an operator can recheck through the original collector.
The transfer report retains the original payment and reservation references;
the existing buyer/governor workflow owns reservation state and the merchant's
accounting records own financial recognition.
