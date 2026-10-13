# Reviewed asset identity and hierarchy crosswalk

This is part of the existing Fixed Asset Finance Workspace. It keeps the original six financial domains, work-order allocations, source preparers and operation journals. It performs no target posting and invents no company, asset, book, journal or event identity.

## Purpose and limits

A genuine target migration may assign a new company, asset or depreciation-book identifier. The original literal-key reconciliation deliberately continues to report that difference. **Asset identity crosswalk** adds an explicit, attributed correspondence between actual selected source and returned target rows. Both original values remain visible.

Each asset and each book may have only one partner. Splits, merges, currency conversion and ledger transformations require their own reviewed migration scope; this feature neither allocates amounts nor infers those transformations. Matching names, amounts or row positions never creates a link automatically.

An asset correspondence also checks its original parent: the linked source parent must resolve to exactly the target parent in the same target company. Missing parents, ambiguous originals, cycles, unlinked selected rows and changed hierarchy remain findings. Original descriptions and classifications remain visible as separate attribute differences. A named identity decision does not silently make those fields equal.

Book correspondence is required for monetary projection. The source asset and source book must resolve to the same target company. Currency and declared accounting basis must agree. No symbol or exchange-rate inference is used.

The mapped report compares:

* Individual balance keys: linked company/book/asset plus exact as-of date, currency and measure. Duplicate keys remain ambiguous.
* Event totals: linked company/book/asset plus exact effective date, currency, measure and event type. All original event IDs, rows, amounts and raw amount spelling remain in the complete JSON. Equal aggregates do **not** establish event-ID parity or prove that offsetting events are identical.
* Original source and target journal arithmetic independently, in each original company/book/journal/currency. Debit and credit are never merged across journals or rewritten. Asset-bearing journal lines carry their explicit asset correspondence; original lines without an asset remain explicitly so.

Amounts use the original engine's declared scale and normalized decimal strings, with integer arithmetic for sums and signed target-minus-source differences. Original CSV and raw amount values remain unchanged, including leading zeros, plus signs and trailing fractional zeros.

The report's scoped `ready` means its mapped identity/financial checks have no unresolved findings, at least one monetary group was compared, and the original independent financial basis is confirmed. It is **not** the original literal-ID report's ready status, a posting authorization, work-order acceptance, complete event-line parity or approval of changed descriptive attributes. The full handover retains all of these separate reports.

## Operate the existing browser

1. Open the current complete `Fixed_Asset_Finance_Workspace.html`. Import and map actual source and returned target Assets and Books using the existing Source files / Field mapping controls. Map balances, events, journals and independent control totals for the intended financial scope.
2. Open **Asset identity crosswalk**. Select Assets or Financial books. Search an original source row, select it, then search and select an actual returned target row. Labels show the literal company and original ID. Add or replace the working link.
3. Review both identity types. Parent correspondence is checked from actual retained asset rows. A returned target already linked elsewhere cannot be assigned again. Remove the previous working link explicitly when correcting a decision.
4. Enter reviewer and reason, then **Save reviewed crosswalk edition**. A partial correspondence may be saved; unlinked populations remain unresolved. No identity is changed in either source.
5. Saving an attributed supporting event changes the original financial-policy basis. After finishing identity decisions, return to **Financial basis**, inspect each original policy and explicitly save its current review. This ordering preserves the existing engine's source-and-supporting-evidence binding.
6. Read mapped balances, event totals, open findings and independent original journals. The original Reconciliation desk remains available with its literal-ID result. Use the readable report and complete JSON for all rows; the browser limits visible result rows only, not retained data.
7. Save working HTML while unfinished. Its raw search, selected rows, working links, attribution and draft remain available on reopening. **Start from current selections** retains the former working draft inside the new saved working state while opening current source choices. New source/mapping/correction editions make saved correspondence stale until explicitly reviewed again.
8. Download the readable self-contained HTML, full JSON and correspondence CSV. The existing full Handover includes those outputs, complete history, original and corrected CSVs, independent financial report, unchanged work-order state and complete rebuildable application source.

For many rows, download the working schedule. It has exactly `domain,source_row_id,target_row_id`. Preserve actual internally generated row IDs; a blank target leaves the source unlinked. Load the complete schedule into working review, inspect it, then save with attribution. A repeated source row, repeated target, unknown domain or foreign row fails; the previous working copy remains. IDs are exact strings. Do not edit original asset values merely to make identifiers match.

Spreadsheet CSV exports prefix formula-leading cells with an apostrophe. These are human-viewable exports; complete JSON and original CSV preserve exact text. The working schedule uses only generated source-row identities and the two fixed domain names.

## Original CLI

Use the same existing `cli.mjs`, original workspace path and saved operation IDs. No new controller is introduced.

```sh
node cli.mjs crosswalk-inspect --workspace /absolute/workspace.json
node cli.mjs crosswalk-save --workspace /absolute/workspace.json --request /absolute/reviewed-crosswalk-request.json
node cli.mjs crosswalk-save --workspace /absolute/workspace.json --request /absolute/reviewed-crosswalk-request.json --csv /absolute/complete-correspondences.csv
node cli.mjs crosswalk-report --workspace /absolute/workspace.json --out /absolute/new-crosswalk-output
node cli.mjs handover --workspace /absolute/workspace.json --out /absolute/new-complete-handover
node cli.mjs receive --workspace /absolute/independent/workspace.json --input /absolute/new-complete-handover/workspace.json
```

`crosswalk-inspect` returns actual original choices, current `basis_sha256`, current `head`, financial groups and history. Save request shape:

```json
{
  "operationId": "your-stable-original-operation",
  "expectedRevision": 26,
  "at": "2026-10-13T19:00:00Z",
  "previous": null,
  "basis_sha256": "COPY_THE_ACTUAL_CURRENT_BASIS",
  "actor": "Named reviewer",
  "reason": "Actual source-backed correspondence decision",
  "pairs": [
    {
      "domain": "assets",
      "sourceRowId": "COPY_ACTUAL_SELECTED_SOURCE_ROW_ID",
      "targetRowId": "COPY_ACTUAL_RETURNED_TARGET_ROW_ID"
    }
  ]
}
```

Use the actual current workspace revision and head; the numbers above only illustrate the schema. With `--csv`, omit `pairs` and preserve that complete CSV unchanged for retries. A repeated exact operation reopens its original receipt before considering later revisions. Changing the payload under an accepted operation ID fails. Another workspace edit or changed selected basis requires a new reviewed request. The original CLI lock, immutable outputs and operation history remain authoritative.

The CLI handover now includes the full guided-source bootstrap as well as the crosswalk modules. This closes the earlier guided-intake omission where runtime-source validation required three source-preparation modules that the CLI did not yet place in its generated HTML.

## Full source and handover

New maintained files:

* `asset-crosswalk.mjs`: pure original-workspace companion, exact arithmetic, attributed journal and complete exports.
* `asset-crosswalk-ui.mjs`: existing browser desk and retained working choices.
* `asset-crosswalk-receiving.mjs`: additive continuation of the original browser receiving course.
* This guide.

The original `application-source.mjs` allowlist, builder, template, app and CLI carry all four. The complete generated HTML embeds the same full source bodies that operate it. Both browser and CLI handovers retain those sources and manifest hashes. Receiving the original `workspace.json` retains every original supporting event and its exact ordered history; the crosswalk reader revalidates the source/mapping/correction basis at each historical operation.

## Existing receiving course and actual viewing

The maintained `runFinanceReceiving` now calls `runAssetCrosswalkReceiving` as its named companion phase. It uses an isolated illustrative copy of the actual current HTML in the existing browser and output operation. It does not alter customer files, supplier sessions, completed financial/work-order histories or target systems.

The continuation operates real browser controls for company C→D, book BOOK→LEDGER, assets P/A→Q/T, exact 18-decimal values larger than JavaScript's safe integer range, original parent links, saved unfinished choices, withdrawal/supersession and restored decisions. It reaffirms original financial policies, downloads all crosswalk formats, verifies every complete handover member, runs the copied CLI and cold-opens that CLI-generated application including Prepare native sources. The fixtures are explicitly illustrative, not Port tenant records or claims of installed customer throughput.

For a separately invoked continuation after an already completed parent course, call the same exported function with the original qualified browser context, output directory and current complete application path. Preserve the original parent result. Do not replace a completed receiving receipt merely to claim that a new phase already ran.

The responsible producer must OPEN, LOOK at and operate the exact outgoing desktop and narrow application, actual screenshots, readable HTML, complete CSV/JSON, full archive contents and copied/rebuilt application. Capturing screenshots, passing source checks or another review is not visual acceptance. Return the actual source edition, host/process/result, viewed screenshots, exercised controls and first concrete defect through the original Port case. Preserve Bryce's tabs and all existing contact/approval controls. No external contact or tenant posting is performed by this feature.

TokenJunkieLabs.
