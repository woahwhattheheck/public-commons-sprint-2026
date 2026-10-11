# SF96 | Real merchant 402 to reviewed Stellar buyer intent

**End-to-end gap closed:** SF85 can already acquire a consenting merchant's real unpaid HTTP 402 response, and SF84 classifies its original x402 v2 and Stellar MPP payment challenges. SF88 can already produce an offline operator-review configuration *from a facilitator catalog*. This product adds the missing source-native path for a merchant who has a directly observed original x402 challenge **but is not yet in that catalog**: capture → original decode → explicit one-option selection → hard atomic spend ceiling → source-bound review → separately owned SF88 human approval if the merchant actually proceeds.

This is an integration of the [SF85 original capture](../sf85-live-402-capture/README.md), [SF84 original dual-rail inspector](../sf84-mpp-market-intake/README.md) and [SF88 original approved buyer](../sf88-operator-buyer-cli/README.md). It never creates a competing HTTP client, 402 decoder, buyer signer, facilitator, wallet, catalog, monitoring service or payment flow. Node 22+, standard library only, no server and no GitHub Actions.

## Operator journey using the *original* merchant response

1. Obtain an original seller-approved capture, or reuse one your team has already taken. Preserve the first-party evidence and merchant authorization privately:

```sh
mkdir -m 700 -p /private/scf-pilots/captures /private/scf-pilots/handoffs
node stellar/scf-starforge-20261009/sf85-live-402-capture/capture.mjs \
  --url 'https://YOUR_REAL_APPROVED_SELLER/PATH' \
  --allow-origin 'https://YOUR_REAL_APPROVED_SELLER' \
  --method GET --out /private/scf-pilots/captures/seller.json
```

Only replace the illustrative seller URL with an *actual*, approved HTTPS endpoint. The SF85 original sends a single header-only request, without a wallet, with verified TLS and its own address policy. For a previously captured original, omit this step and point `--capture` at its exact path.

2. Inspect the *actual* source to see the original offer indices. Use the original inspector, **not hand-retyped terms**:

```sh
node stellar/scf-starforge-20261009/sf84-mpp-market-intake/inspect.mjs \
  /private/scf-pilots/captures/seller.json
```

3. Explicitly select **one indivisible original exact Stellar x402 option** and set a decimal-string maximum authorized for subsequent *review*, never an auto-payment. `--max-atomic` is in **atomic units**, not display dollars. It must be no smaller than the quote. Do not select an MPP option, a non-Stellar option or a fabricated index:

```sh
node stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff/handoff.mjs \
  --capture /private/scf-pilots/captures/seller.json \
  --offer-index 0 --intent-id merchant-pilot-20261011-001 \
  --max-atomic 1000 --out /private/scf-pilots/handoffs/review-001
```

The values above illustrate command *shape*, not a current merchant quote. For a live operator run choose the actual `offerIndex` and an explicit cap from the real capture. The new output directory must not exist. The tool uses 0700 for its directory and 0600 for each file.

4. Check the original source binding, then run the **unmodified existing** SF88 offline review:

```sh
node stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff/handoff.mjs \
  --verify /private/scf-pilots/handoffs/review-001
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/scf-pilots/handoffs/review-001/buyer-review.json
```

## Source-bound deliverables

| Private file | Purpose |
| --- | --- |
| `original-capture.json` | **Exact bytes**, unmodified, of original SF85 operator capture. |
| `buyer-review.json` | Original SF88-compatible operator review draft with chosen intent, URL, method and complete selected exact Stellar terms. No operator, signer or authorization. |
| `selection.json` | Original capture SHA-256, raw encoded challenge SHA-256, original accepted-offer SHA-256, quote/cap, exact resource URL and selected alternative. |
| `review.txt` | Human-readable handoff card, including instructions for the unchanged SF88 reviewer. |
| `manifest.json` | SHA-256 and byte counts for all four files. |

`--verify` re-reads the persisted original capture, reruns the **real SF84 inspector**, checks all four files and derives the same **real SF88 validated** operation. It never trusts the manifest alone and will reject changes to the capture, selected index, terms, budget, config or handoff card. The hashes are locally computed change detection, **not source authentication or signatures**. Compare the printed source SHA to your independently retained operator original if custody matters.

The source must be an SF85-shaped, actual 402 GET or HEAD capture; a non-402, missing/duplicate/ambiguous x402 challenge or malformed MPP companion is refused. The selected option must be native `exact` on `stellar:testnet` or `stellar:pubnet`, with source-provided asset, recipient, integer amount and timeout. The captured merchant URL must match the advertised HTTPS resource origin and path (and any declared query). A payment flow other than supported `authorization` is rejected; nothing is silently coerced. Source classification cannot prove merchant identity, customer consent or onchain settlement.

## Transition to an authorized paid pilot

The generated **review** config is intentionally unsigned and **cannot execute** via SF88. The trusted SF49/operator team, not this importer, can copy it into a **new private** execution config and add the pre-existing SF36 operator policy, durable ledger, original signer module and evidence destination after independently verifying seller and accepted terms. The original SF88 `--execute` then enforces its existing typed human approval and reservation. No auto-signing, wallet provisioning, self-approval or forced retry happens here. A seller may change its quote between capture and execution; owner must check the still-current original challenge. Do not treat HTTP 200 or 402 as finality or a sale.

Run the one focused source-native wiring acceptance from the complete actual checkout with:

```sh
node stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff/acceptance.mjs
```

It uses original SF84 and SF88 modules, a single ephemeral original-shaped local 402 header capture, a real private output directory, and verifies positive generation plus essential refusal behavior. It does not contact public merchants, send a payment, or run hosted CI. MIT.