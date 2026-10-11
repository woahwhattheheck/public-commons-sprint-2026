# SF86: official Stellar RPC transfer reconciliation without Stellar CLI

A direct **read-only** Node.js companion to the original [SF82 CLI reconciliation](../sf82-chain-transfer-reconcile/README.md). SF82 still supports native `stellar tx fetch` result/event JSON and pubnet. This additive SF86 path handles **Stellar testnet only**, using official Soroban RPC `getTransaction` and `getEvents`, and the *existing SF43* `createOfficialEventDecoder()` from `@stellar/stellar-sdk`. It neither imports a seller-created “settled” assertion as chain proof nor requires the `stellar` executable.

## Existing authorized operator workflow

1. Run an **already-authorized** SF81 original buyer checkout on the existing signer/policy/ledger host. Use `sf81ReconciliationRecord(paidResult)` from `../sf82-chain-transfer-reconcile/record.mjs` to export the stripped original record once with private `0600` permissions. Do not copy private keys, an HTTP Response body, cookies or x402 signatures.
2. Obtain the trusted payer **G-address from the original wallet owner**, independently of the merchant. It must match the original SF81 receipt payer.
3. From the existing Node 22+ x402/SCF checkout with `@stellar/stellar-sdk` installed (as used by original SF43), run:

```bash
node stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/cli.mjs \
  --sf81-result /private/operator/sf81-payment-record.json \
  --payer G_YOUR_ACTUAL_TRUSTED_56_CHARACTER_ADDRESS
```

The default endpoint is the first-party read-only `https://soroban-testnet.stellar.org`. For a focused *local* HTTP test only, `--rpc-endpoint http://127.0.0.1:PORT/` is permitted and **cannot** return the live verdict. Optional `--max-event-pages 24` (valid range 1–100) caps HTTP reads. No endpoint from the untrusted receipt is accepted.

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

Successful **actual official testnet** verification returns `CHAIN_TRANSFER_MATCHED_RPC_TESTNET`; loopback always returns `LOCAL_RPC_REPLAY_MATCHED`, not live-chain proof. Failure returns `NOT_RECONCILED` plus a machine-readable reason with exit code 2. In both cases `reservation` remains `UNCHANGED_VERIFY_SEPARATELY`.

## Checks performed on the original source values

- Original SF81 intent ID, exactly matching original SF62 `FRESH_RESERVATION_APPROVED` request, network, SEP-41 asset and reserved atomic amount.
- `exact` scheme on `stellar:testnet`, valid checked Stellar StrKey asset/payer/recipient, positive signed-i128 amount, trusted payer and canonical seller-reported transaction hash.
- Actual official RPC `getTransaction` must return status `SUCCESS`, the exact requested transaction hash and a positive ledger number. HTTP 200 alone is never enough.
- Actual `getEvents` must enumerate contract events from that transaction ledger for the approved asset. The existing **SF43 official Stellar SDK XDR decoder** must produce exactly one transfer with the approved payer, recipient and atomic amount. Malformed native XDR, duplicates, unknown order/cursor, missing evidence or a page-budget exhaustion fail closed.
- Output preserves chain ledger, matched event ID and SHA-256 hashes of the observed RPC objects for review; does not persist raw response bodies, tokens or private payment material. This is a transaction-specific transfer check, **not** cryptographic seller-to-HTTP-intent binding, accounting finality or proof of a paying customer.

No wallet signatures, payment calls, merchant POSTs, grant applications, ledger edits, hosted Actions or contact sends are made. No mainnet, unsupported future x402 `upto`, or unauthorized customer traffic is implied. For pubnet, use the existing SF82 CLI path with its native exact proof.

## Focused local transport/logic check

```bash
node stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/acceptance.mjs
```

The check runs a real Node HTTP loopback JSON-RPC server using shaped non-chain records and an explicitly injected test decoder. It verifies multi-page successful contract matching, duplicate transfer rejection, incomplete cursor coverage, no-transfer, reserve mismatch, payer mismatch, endpoint restrictions and decoder requirements. It does **not** claim to decode original Stellar XDR or observe a paid testnet transaction. A native operator with an actual SF81 signed receipt and `@stellar/stellar-sdk` can execute the production CLI against the official testnet provider and report the distinct live verdict to the existing SCF SF43/SF81 owners.
