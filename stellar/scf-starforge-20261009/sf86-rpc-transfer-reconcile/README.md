# SF86: official Stellar RPC transfer reconciliation without Stellar CLI

A direct **read-only** Node.js companion to the original [SF82 CLI reconciliation](../sf82-chain-transfer-reconcile/README.md). This original RPC path handles **Stellar testnet and pubnet**, using `getNetwork`, `getTransaction` and `getEvents`, and the existing SF43 `createOfficialEventDecoder()` from `@stellar/stellar-sdk`. It checks the approved network and exact token transfer without requiring the `stellar` executable.

## Existing authorized operator workflow

1. Run an **already-authorized** SF81 original buyer checkout on the existing signer/policy/ledger host. Use `sf81ReconciliationRecord(paidResult)` from `../sf82-chain-transfer-reconcile/record.mjs` to export the stripped original record once with private `0600` permissions. Do not copy private keys, an HTTP Response body, cookies or x402 signatures.
2. Obtain the trusted payer **G-address from the original wallet owner**, independently of the merchant. It must match the original SF81 receipt payer.
3. From the existing Node 22+ x402/SCF checkout with `@stellar/stellar-sdk` installed (as used by original SF43), run:

```bash
node stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/cli.mjs \
  --sf81-result /private/operator/sf81-payment-record.json \
  --payer G_YOUR_ACTUAL_TRUSTED_56_CHARACTER_ADDRESS
```

Testnet defaults to SDF's `https://soroban-testnet.stellar.org`. An explicit
`--rpc-endpoint https://soroban-rpc.testnet.stellar.gateway.fm` selects Gateway,
also listed in the [official Stellar provider directory](https://developers.stellar.org/docs/data/apis/rpc/providers).
Pubnet defaults to `https://soroban-rpc.mainnet.stellar.gateway.fm`; an explicit
`--rpc-endpoint https://archive-rpc.lightsail.network/` selects the documented
mainnet archive provider. The shared [network catalog](networks.json) also feeds
the original signer and Python accounting worker. An explicit endpoint must
belong to the record's original network.
The observer checks that network's canonical passphrase with `getNetwork` and
records the selected endpoint. It does not fall back automatically.
For a focused local HTTP check, `--rpc-endpoint http://127.0.0.1:PORT/` retains
its separate local verdict. Optional `--max-event-pages 24` (range 1–100) limits
event reads. An endpoint in a seller receipt is never selected.

### Open the original SF82 evidence file

The SF82 checkout adapter now saves the existing `sf81ReconciliationRecord()`
inside its create-only evidence file whenever that original record is available.
This completes the saved-file handoff for SF88 operators without requiring a
separate manual export from an in-memory buyer result:

```sh
node stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/cli.mjs \
  --sf82-evidence /private/stellar-evidence/ORIGINAL_INTENT_SHA256.json \
  --payer YOUR_ACTUAL_TRUSTED_G_ADDRESS
```

Choose exactly one of `--sf81-result` or `--sf82-evidence`. The latter checks that
the retained record agrees with the envelope's intent, original observed terms,
receipt and reservation summary, then uses the **same** SF86 verifier. The payer
still comes from the wallet owner, and a file or seller assertion does not prove
approval or payment. No buyer, signer, merchant endpoint or ledger writer runs.

An older SF82 file, a free response or an incomplete buyer result may not contain
an original reconciliation record. In that case the CLI returns exit code 2 with
`SF82_ORIGINAL_RECONCILIATION_RECORD_UNAVAILABLE`, before loading the SDK or making
RPC calls. It never infers the missing reservation asset/schema or original payer.
A contradictory saved record returns `SF82_RECONCILIATION_RECORD_MISMATCH`.
The source file remains unchanged; retain it alongside the emitted reconciliation
result. Neither unavailable evidence nor a failed lookup authorizes a new purchase.

Successful testnet observation returns `CHAIN_TRANSFER_MATCHED_RPC_TESTNET`;
pubnet returns `CHAIN_TRANSFER_MATCHED_RPC_PUBNET`. Loopback returns the separate
`LOCAL_RPC_REPLAY_MATCHED` verdict. Failure returns `NOT_RECONCILED` with its
reason and exit code 2. The original reservation remains unchanged by this CLI.

## Checks performed on the original source values

- Original SF81 intent ID, exactly matching original SF62 `FRESH_RESERVATION_APPROVED` request, network, SEP-41 asset and reserved atomic amount.
- `exact` scheme on the original `stellar:testnet` or `stellar:pubnet` network, valid checked Stellar StrKey asset/payer/recipient, positive signed-i128 amount, trusted payer and canonical seller-reported transaction hash.
- Actual official RPC `getTransaction` must return status `SUCCESS`, the exact requested transaction hash and a positive ledger number. HTTP 200 alone is never enough.
- Actual `getEvents` must enumerate contract events from that transaction ledger for the approved asset. The existing **SF43 official Stellar SDK XDR decoder** must produce exactly one transfer with the approved payer, recipient and atomic amount. Malformed native XDR, duplicates, unknown order/cursor, missing evidence or a page-budget exhaustion fail closed.
- Output preserves chain ledger, matched event ID and SHA-256 hashes of the observed RPC objects for review; does not persist raw response bodies, tokens or private payment material. This is a transaction-specific transfer check, **not** cryptographic seller-to-HTTP-intent binding, accounting finality or proof of a paying customer.

The CLI performs read-only observation. Original SF36 owns accounting, and the
original buyer owns payment execution. The supported scheme remains `exact`.

## Focused local transport/logic check

```bash
node stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/acceptance.mjs
```

The check runs a real Node HTTP loopback JSON-RPC server using shaped non-chain records and an explicitly injected test decoder. It verifies multi-page successful contract matching, duplicate transfer rejection, incomplete cursor coverage, no-transfer, reserve mismatch, payer mismatch, endpoint restrictions and decoder requirements. It does **not** claim to decode original Stellar XDR or observe a paid testnet transaction. A native operator with an actual SF81 signed receipt and `@stellar/stellar-sdk` can execute the production CLI against the official testnet provider and report the distinct live verdict to the existing SCF SF43/SF81 owners.
