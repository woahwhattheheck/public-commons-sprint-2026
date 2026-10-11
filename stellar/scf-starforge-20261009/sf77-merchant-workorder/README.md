# SF77 · Turn an actual merchant diagnostic into a sellable work order

The existing SCF SF70 operator produces a source-bound, method-aware **unpaid** merchant diagnostic. SF77 takes its saved original JSON and a separate operator-supplied commercial terms file, and generates an immediately usable seller acceptance packet. It does **not** run another seller test, make a network request, sign/pay/settle, invoice, contact any prospect or invent successful repairs. A paid pilot is a distinct agreement with actual merchant acceptance.

This is a commercial handoff for the existing SCF SF49 paid-merchant lane. It does not replace SF74 diagnostic UI, SF76 before/after technical comparator or SF73 seller-owned catalog admission. The original SF70 report remains byte-untouched and is bound in the exported artifacts by SHA-256; all reported findings are copied with their exact original action text, preserving **HIGH** vs **UNKNOWN**. It won't call browser readiness if the original catalog declared a POST/MCP-only operation.

## Run locally (Node 22+, stdlib only)

Capture the real seller's original SF70 JSON with permission using the existing method-aware CLI:

```bash
node stellar/scf-starforge-20261009/sf70-merchant-intake/run.mjs \
  --resource https://seller.example/paid \
  --catalog https://facilitator.example/discovery/resources \
  --origin https://buyer.example \
  --network stellar:testnet --pay-to SELLER_PUBLIC_ADDRESS \
  --method POST --out /private/seller-sf70.json
```

Then fill in a **new, separately owner-supplied** terms file; copy `sample-terms.json` as a schema starting point. This is not a send/approval operation.

```bash
node stellar/scf-starforge-20261009/sf77-merchant-workorder/workorder.mjs \
  --intake /private/seller-sf70.json --terms /private/seller-terms.json \
  --out /private/seller-pilot-packet
```

Three private, **non-overwriting** 0600 files are emitted: `packet.json` (portable contract with original source digest and exact scope), `seller-packet.html` (readable local buyer/seller workshare), and `acceptance-checklist.md` (recheck evidence slots and seller review). All generated files must be reviewed before any external delivery. No network or hosted Actions required. `--at UTC_ISO` sets a reproducible generation timestamp.

## Commercial contract fields

`workOrderRef`, `sellerDisplayName` and `relationshipOwner` identify the opportunity. `merchantConsent.status` is `NOT_RECORDED` or `CONFIRMED`; only the latter may carry a true HTTPS receipt URL. `commercial.priceApproval` is `NOT_APPROVED` or `OWNER_APPROVED_PROPOSAL`. Supplying a guessed fee or cost does **not** make it an approved quote: the HTML and packet withhold amounts until the commercial owner supplies both nonnegative, cent-precision USD economics and a real HTTPS `approvalReceiptUrl`. The tool rejects loss-making approved proposals rather than silently calling them sellable. `proposedWindow` is free text and defaults to `UNSCHEDULED`.

An owner-accepted price plus confirmed merchant consent only raises the state to `READY_FOR_OWNER_TO_REVIEW_UNSENT_OFFER`, *not* a contract. Actual customer acceptance, signed terms, invoice and bank/processor payment must be separately evidenced. Source-scoping and method-specific proof are explicit: comparing POST-only merchant behavior to an unrelated GET is not acceptance.

## Acceptance flow

1. Seller confirms the **identical** resource URL, facilitator, buyer Origin, Stellar network, payTo, actual HTTP method and original source hash. Any change creates a new version of the technical scope.
2. Operator addresses the **original** high-severity defects. Unknown/incomplete catalog/browser observations remain evidence gaps, not diagnosed failures. If no defects are present, don't sell a fabricated repair.
3. After work, owner runs SF70 again on the same original scope and can use the independent SF76 comparator once integrated. Actual POST/MCP checkout acceptance requires the actual authorized method; unpaid CORS/GET diagnostics are insufficient.
4. Seller reviews evidence and agreed work. Only a separately recorded payment/contract creates billable revenue. Source hashes aid reproducibility, but no signature or seller authority is inferred from one report.

The bundled `sample-intake.json` and `sample-terms.json` are **ILLUSTRATIVE OFFLINE EXAMPLES ONLY**, not a merchant, quote, verified live settlement, customer or grant outcome. Never publish private intake reports or seller commercial terms into this public repository.
