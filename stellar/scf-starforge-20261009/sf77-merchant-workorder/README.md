# SF77 · Turn an actual merchant diagnostic into a sellable work order

The existing SCF SF70 operator produces a source-bound, method-aware **unpaid** merchant diagnostic. SF77 takes its saved original JSON and a separate operator-supplied commercial terms file, and generates an immediately usable seller acceptance packet. It does **not** run another seller test, make a network request, sign/pay/settle, invoice, contact any prospect or invent successful repairs. A paid pilot is a distinct agreement with actual merchant acceptance.

This is a commercial handoff for the existing SCF SF49 paid-merchant lane. It consumes the original SF76 before/after comparator when recheck inputs are supplied; it does not replace SF74 diagnostic UI or SF73 seller-owned catalog admission. Original source files remain byte-untouched and are bound in the exported artifacts by SHA-256; findings preserve **HIGH** vs **UNKNOWN**. It won't call browser readiness if the original catalog declared a POST/MCP-only operation.

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

## Attach the actual repair recheck

After an authorized operator captures a second original SF70 report, generate a **new** packet directory with the same owner terms and exact before/after files:

```bash
node stellar/scf-starforge-20261009/sf77-merchant-workorder/workorder.mjs \
  --intake /private/seller-before-sf70.json \
  --after /private/seller-after-sf70.json \
  --terms /private/seller-terms.json --out /private/seller-recheck-packet
```

For a catalog-proven POST-only HTTP offer, include both original SF72 OPTIONS reports captured against the corresponding SF70 file. Use the existing `sf72-post-only-preflight/preflight.mjs` CLI for those authorized captures; SF77 does not probe the seller itself:

```bash
node stellar/scf-starforge-20261009/sf77-merchant-workorder/workorder.mjs \
  --intake /private/seller-before-sf70.json \
  --after /private/seller-after-sf70.json \
  --sf72-before /private/seller-before-sf72.json \
  --sf72-after /private/seller-after-sf72.json \
  --terms /private/seller-terms.json --out /private/seller-post-recheck-packet
```

### Use the existing SF74 console downloads

The merged [SF74 support console](../sf74-merchant-support-console/README.md) supplies these same original inputs:

```bash
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs
```

1. Run the authorized before diagnosis and choose **Download intake JSON** (`merchant-intake.json`). For a POST-only offer, review the displayed target, Origin and credential mode, explicitly authorize its separate check, choose **Run original OPTIONS-only preflight**, then download `merchant-post-preflight.json`.
2. Keep both files unchanged. Repeat the diagnosis and optional preflight after the agreed repair with identical scope and credential policy. The browser may suffix filenames; identify before/after pairs by the original timestamps and hashes. Renaming is fine; reformatting changes the bound bytes.
3. Pass the actual before and after intake files to `--intake` and `--after`. For POST, pass their corresponding preflight files to `--sf72-before` and `--sf72-after`. Use the same owner-supplied terms and a new output directory in the command above. The console's downloaded comparison JSON is useful for review, but SF77 consumes the original source pairs and recomputes through SF76.

The optional `packet.json.repairReview` is the unchanged return value of the original `sf76-merchant-remediation-delta/compare.mjs`. The HTML and checklist show its classification, unpaid technical milestone, original source timestamps and hashes, and finding changes. The original baseline and commercial terms remain separate. All seller acceptance boxes remain open, including when an unpaid technical milestone is observed.

The comparator re-evaluates retained original SF70/SF72 observations. It rejects changed resource/catalog/origin/network/payee/method, non-later captures, forged stored decisions, changed known browser credential modes, conflicting original observations, unpaired SF72 reports and SF72 hashes that do not match the exact SF70 bytes. Keep the original JSON files unchanged: reformatting an SF70 file invalidates an SF72 report bound to its old bytes. Each comparison source is limited to 2,000,000 bytes; owner terms retain the 5 MiB limit. Input must be valid UTF-8 JSON. Outputs use a new 0700 directory and 0600 files.

| Recheck result | What the seller packet can say |
| --- | --- |
| `GET_UNPAID_DISCOVERY_AND_BROWSER_READY` | Same-scope unpaid GET discovery and browser-header conditions were observed. |
| `POST_OPTIONS_READY_CHALLENGE_UNCHECKED` | Original POST-only catalog route and OPTIONS conditions were observed; POST challenge, payment and delivery remain unchecked. |
| `BROWSER_CREDENTIAL_MODE_UNCONFIRMED` | A legacy source does not establish the browser credential mode. No technical milestone or cleared finding is inferred. |
| `CATALOG_COVERAGE_INCOMPLETE` | Findings absent from an incomplete after capture remain unconfirmed. |
| `REMEDIATION_STILL_REQUIRED` or `INCOMPLETE_EVIDENCE` | Review retained/new findings and the original evidence gaps. |

The comparison preserves credential mode as `true`, `false` or `null` (unknown) in packet scope. Legacy original SF68/SF72 observations may establish a missing SF70 scope mode; unknown never silently becomes noncredentialed. The finding changes are the original **SF70** findings; paired SF72 source status/hashes are displayed separately. A generated packet exits successfully even when the technical result is incomplete or requires remediation: inspect `repairReview.classification`, not the export exit code. Omitting `--after` retains the baseline-only workflow and sets `repairReview` to `null`.

## Commercial contract fields

`workOrderRef`, `sellerDisplayName` and `relationshipOwner` identify the opportunity. `merchantConsent.status` is `NOT_RECORDED` or `CONFIRMED`; only the latter may carry a true HTTPS receipt URL. `commercial.priceApproval` is `NOT_APPROVED` or `OWNER_APPROVED_PROPOSAL`. Supplying a guessed fee or cost does **not** make it an approved quote: the HTML and packet withhold amounts until the commercial owner supplies both nonnegative, cent-precision USD economics and a real HTTPS `approvalReceiptUrl`. The tool rejects loss-making approved proposals rather than silently calling them sellable. `proposedWindow` is free text and defaults to `UNSCHEDULED`.

An owner-accepted price plus confirmed merchant consent only raises the state to `READY_FOR_OWNER_TO_REVIEW_UNSENT_OFFER`, *not* a contract. Actual customer acceptance, signed terms, invoice and bank/processor payment must be separately evidenced. Source-scoping and method-specific proof are explicit: comparing POST-only merchant behavior to an unrelated GET is not acceptance.

## Acceptance flow

1. Seller confirms the **identical** resource URL, facilitator, buyer Origin, Stellar network, payTo, actual HTTP method, browser credential mode and original source hash. Any change creates a new version of the technical scope.
2. Operator addresses the **original** high-severity defects. Unknown/incomplete catalog/browser observations remain evidence gaps, not diagnosed failures. If no defects are present, don't sell a fabricated repair.
3. After work, owner runs SF70 again on the same original scope and supplies `--after` (plus paired SF72 files where applicable). SF77 invokes the independent SF76 comparator and includes its result directly in the handoff. Actual POST/MCP checkout acceptance requires the actual authorized method; unpaid CORS/GET diagnostics are insufficient.
4. Seller reviews evidence and agreed work. Only a separately recorded payment/contract creates billable revenue. Source hashes aid reproducibility, but no signature or seller authority is inferred from one report.

The bundled `sample-intake.json` and `sample-terms.json` are **ILLUSTRATIVE OFFLINE EXAMPLES ONLY**, not a merchant, quote, verified live settlement, customer or grant outcome. Never publish private intake reports or seller commercial terms into this public repository.

## Focused offline acceptance

```bash
node --test stellar/scf-starforge-20261009/sf77-merchant-workorder/test/recheck.test.mjs
```

Synthetic source observations exercise the original SF68/SF70/SF72/SF76 functions and the real SF77 file-based CLI. No merchant endpoint, browser execution, wallet or payment is involved.

