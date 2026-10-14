# Named migration rehearsal review

Use **Rehearsal review** in the existing Fixed asset migration and exit workspace to retain a named observation of an actual selected source/returned export revision. Each edition carries its complete captured financial, work-order and asset-crosswalk reports, original source descriptors, population keys, reviewer, reference, note and original operation-prefix identity. Those observations remain readable when later application releases improve the live reconciliation engines.

## Review two actual rounds

1. Prepare/import the original source and actual returned exports through the existing source desks. Map their literal fields and review corrections, books, currencies and original journals.
2. Open **Rehearsal review**. Check the current original literal finance, financial basis, mapped identity and work-order outcomes separately.
3. Name the actual edition, choose its kind, identify the reviewer and original export/rehearsal reference, and describe the observed result and scope. Save the named edition. The record captures the revision immediately before its own supporting-file operation.
4. Import/select the later actual export, or make an attributed correction through the original desk. Return to **Rehearsal review**, choose **Review current revision**, retain the new attribution and save the later edition.
5. Select the earlier and later named editions. Search their original keys and filter changed, added, removed, raw-only or ambiguous rows. Every original row and calculated report remains in the full downloads.
6. Finish named edition records before reaffirming the current **Financial basis** policies. Saving any supporting evidence changes that engine's original policy basis. A historical “confirmed” result remains an observation of its captured revision; the live desk shows the current policy status.

Unfinished naming/selection fields travel in **Save working HTML** through the existing working-copy mechanism. If the workspace revision changes while a review is unfinished, the original draft is retained and explicit current-revision review is required. Original competing-tab and busy-operation handling remains authoritative.

## Exact comparison meaning

Finance rows pair only by the original declared keys for assets, books, balances, events, journals and independent controls. Work-order headers pair by company/work-order ID; cost rows add the original line ID. Duplicate keys remain **AMBIGUOUS** with their full populations; position and similar labels never establish equivalence.

A monetary delta is “later minus earlier” only when both original rows are valid and the company, book, currency, date, measure, asset, account, event type and cost basis remain compatible. Financial amounts additionally require one valid original selected book with the same currency and unchanged nonblank accounting basis. Quantity arithmetic requires an unchanged nonblank declared unit. Missing or changed scope remains visible with an explicit unavailable-delta reason. Decimal calculations use exact integer scale arithmetic, retaining every original amount token.

Mapped asset balances/events remain separate from literal finance rows. Full crosswalk reports preserve the actual saved correspondence and hierarchy. Exact finding membership changes are shown as observations; a changed source-row identity does not automatically resolve an earlier finding.

The captured reports use a compact lossless JSON value representation that retains repeated original values once. Original report hashes validate the decoded complete evidence. The original 32 MiB supporting-member, 128 MiB workspace and population limits still apply; larger inputs are rejected completely before a saved mutation. No rows are truncated.

## Original CLI

Run the complete extracted application with its original Node runtime. Use absolute paths and a stable saved request for every mutation.

```sh
node /absolute/application/services/fixed-asset-migration/cli.mjs rehearsal-preview --workspace /absolute/workspace.json
node /absolute/application/services/fixed-asset-migration/cli.mjs rehearsal-history --workspace /absolute/workspace.json
node /absolute/application/services/fixed-asset-migration/cli.mjs rehearsal-save --workspace /absolute/workspace.json --request /absolute/named-review-request.json
node /absolute/application/services/fixed-asset-migration/cli.mjs rehearsal-inspect --workspace /absolute/workspace.json --edition ACTUAL_SAVED_EDITION_ID
node /absolute/application/services/fixed-asset-migration/cli.mjs rehearsal-compare --workspace /absolute/workspace.json --before ACTUAL_EARLIER_ID --after ACTUAL_LATER_ID
node /absolute/application/services/fixed-asset-migration/cli.mjs rehearsal-report --workspace /absolute/workspace.json --before ACTUAL_EARLIER_ID --after ACTUAL_LATER_ID --out /absolute/new-review-directory
node /absolute/application/services/fixed-asset-migration/cli.mjs rehearsal-workspace --workspace /absolute/workspace.json --edition ACTUAL_SAVED_EDITION_ID --out /absolute/separate-historical-workspace.json
```

The saved request contains `operationId`, `expectedRevision`, optional ISO `at`, `previous` (the exact history head, or null), `expectedEvidenceSha256` from preview, and explicit `kind`, `label`, `actor`, `reference`, `note`. Kinds are `rehearsal`, `returned-export`, `handover-review`, `checkpoint`. A retry uses the same complete request and original operation ID. A changed request under an accepted ID is rejected; a new observation must review the actual current revision.

## Complete delivery and independent reopening

**Download readable review**, complete JSON, every comparison row CSV and full edition history use the selected original editions. Human CSV cells escape spreadsheet-formula prefixes; JSON retains exact values.

**Download selected historical workspace** exports the original operation prefix before the selected named edition was saved. It is a separate editable workspace revision. Open it as an independent copy using the normal receive command or browser receiving control; the current original workspace is preserved.

The full **Handover** and original CLI `handover` include all supporting edition records, all original source files and the latest two-edition comparison (or single saved edition) at:

- `rehearsals/history.json`
- `rehearsals/review.json`
- `rehearsals/report.html`
- `rehearsals/rows.csv`

The complete application sources include both rehearsal modules, this guide and the receiving continuation. Use `OPEN_DELIVERY.txt`, rebuild from the retained source or open the complete working HTML. The original full manifest verifies every member. Named observations do not replace the existing financial policy, work-order acceptance or live reconciliation decisions.

## Original receiving continuation

`run_browser_receiving.mjs` invokes `runRehearsalReceiving` through the original receiving operation after the existing source-preparation/crosswalk course. Its isolated dataset is explicitly illustrative. It saves an unfinished draft, records the first original edition, changes one 18th-decimal amount through the real correction UI, records the later edition, reads every review download, validates the complete source/archive manifest, recovers the exact historical workspace and reopens the copied application/CLI with both named editions intact.

The attachment viewer serves only explicitly registered local HTML files through a random-path loopback endpoint. It preserves qualified runtime/browser ownership and does not start another migration engine.

The producing owner must open, LOOK at and use the actual desktop/narrow application and every outgoing HTML,CSV,JSON, archive and reopened application in its appropriate viewer. A source exercise or saved screenshot is not a claim that those artifacts have been viewed.

TokenJunkieLabs · complete original migration evidence, named editions and reusable application source.
