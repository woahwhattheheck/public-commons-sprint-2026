# SF77 · Merchant workorders from original diagnosis or runtime sources

The existing SCF SF70 operator produces a source-bound, method-aware **unpaid** merchant diagnostic. SF77 takes its saved original JSON and a separate operator-supplied commercial terms file, and generates an immediately usable seller acceptance packet. It does **not** run another seller test, make a network request, sign/pay/settle, invoice, contact any prospect or invent successful repairs. A paid pilot is a distinct agreement with actual merchant acceptance.

This is a commercial handoff for the existing SCF SF49 paid-merchant lane. It consumes the original SF76 before/after comparator when recheck inputs are supplied; it does not replace SF74 diagnostic UI or SF73 seller-owned catalog admission. Original source files remain byte-untouched and are bound in the exported artifacts by SHA-256; findings preserve **HIGH** vs **UNKNOWN**. It won't call browser readiness if the original catalog declared a POST/MCP-only operation.

The same builder also accepts an original SF74 runtime case. A merchant incident or retained usage period can become a workorder directly, using its original SF93 packet or SF30 history/SF97 report and optional SF98 journals. Both source paths share the commercial terms, economics, workorder JSON, readable HTML and checklist. Runtime intake uses the existing SF74 review and its original history/native engines.

## Create a workorder from a retained runtime case

In the original [SF74 console](../sf74-merchant-support-console/RUNTIME_SUPPORT.md#prepare-a-workorder-from-this-case), attach and review the merchant's original packet or retained period. Choose **Attached runtime case** in the existing workorder stage, enter the owner-supplied scope, deliverables, acceptance criteria and commercial terms, and create the packet. Save the case to retain those raw drafts and its source choice. Reopening restores them; the next export receives its actual new generation time. Earlier case versions retain their own sources and terms.

For another operator or a filesystem workflow, export the existing complete `.merchant-support.json` handoff and the owner terms JSON, then run:

```sh
node stellar/scf-starforge-20261009/sf77-merchant-workorder/workorder.mjs \
  --handoff /private/merchant-case.merchant-support.json \
  --terms /private/merchant-owner-terms.json \
  --out /private/workorders/NEW-runtime-workorder
```

The complete handoff supplies its original workspace and runtime files. The importer validates its source hashes and the builder invokes `reviewRuntime` directly. `--handoff` and `--intake` are alternatives; the handoff already retains its before/follow-up observations and cannot be combined with separate diagnostic recheck flags. Both modes produce the same three files in a new private directory. `--at UTC_ISO` remains available when a caller needs a reproducible generation timestamp.

Runtime workorders use the latest attached capture's exact saved merchant mapping, which must match the current case. The original method and observed route remain explicit. Any recorded resource/catalog/buyer origin must be a valid HTTP(S) URL; a recorded buyer origin is origin-only. Optional unmapped fields remain unfilled, and same-origin or local operations do not require a separate discovery/CORS diagnosis. Earlier baseline mappings, process restarts, historical paths, missing coverage and overlapping periods remain visible with the original comparison result. The mapping records the operator's selected merchant scope; source hashes do not authenticate that merchant.

The unchanged `SCF-SF77/merchant-workorder-v1` packet gains `sourceKind: "RUNTIME"` and `runtimeReview` for this source form. `repairReview` stays `null`; runtime observations are not represented as an SF70/SF76 diagnosis. `baseline.sourceSha256` binds the original runtime-case bytes. The CLI also records exact handoff, workspace and runtime hashes in `runtimeSource`. The JSON retains the complete original reviewed day/session coverage and native event decisions; the readable packet includes exact source references, observed method/path and complete current payment-option/recipient identities.

Runtime findings retain the original queue's side, kind and event reference. HTTP/native observations are labeled **OBSERVED**; source coverage and scope context are labeled **CONTEXT**. These labels do not assign a diagnostic severity or assert that every context item is a repair. When no condition is recorded, the packet says so and the owner can describe the actual desired service. Original HTTP responses, native notices, inbox acceptance and customer fulfillment remain separate. Follow-up counts or rates do not by themselves establish a repair caused the change.

## Owner-entered delivery and acceptance

Both source paths accept optional `delivery` fields in the existing owner terms file:

```json
{
  "delivery": {
    "scope": "",
    "deliverables": "",
    "acceptanceCriteria": ""
  }
}
```

Add this object to the normal terms, alongside `workOrderRef`, seller/relationship ownership, merchant permission, the commercial fields and `proposedWindow`. Each optional field is plain text of at most 8,192 characters. The builder includes the entered text in the same packet, readable workorder and checklist; blank values remain unfilled. The SF74 case also retains incomplete raw drafts and restores older terms files with empty new fields. Entered criteria describe the work to review; they do not record a merchant signature, completed acceptance, invoice or received payment.

In code, existing `buildPacket(intake, terms, sourceSha256, generatedAt, recheck)` calls remain available. `buildRuntimePacket({supportText, inputs}, terms, generatedAt)` selects the original runtime source path and returns the same workorder family. Keep the full original checkout or maintained product distribution so its SF74, SF30 history and SF97 imports are present.

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

