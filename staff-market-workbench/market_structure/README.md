# Proposed pay structures from accepted market analyses

This workflow turns an existing, reviewed market comparison into an explicit proposed pay structure and a native role edition. The analyst chooses the reference measure, range limits and role-to-grade mapping. The resulting editions retain the complete original comparison, source files, match decisions, review identities and calculation choices.

Open **Proposed pay structures** in the existing application. An accepted result in **Decisions and exports** also offers **Propose pay structure**, which opens that exact analysis in this workflow.

## Complete the operating workflow

### 1. Select the original accepted analyses

**Accepted analyses** shows the retained market results and their latest original review. Use **Inspect source** to open the complete analysis, every selected source row, source-edition metadata and full source-file download. The table loads 50 original analyses at a time; continue with **Load next 50 original analyses** to reach the remaining history.

Selecting a result pins its analysis ID, complete result SHA-256 and accepted review ID. Each source remains associated with its original currency, target date, permitted use, match decision, adjustment factors and annualization. The native receiving code verifies these identities again when calculating, saving, accepting and first deriving the proposed structure.

If an original review changes during the work, **Refresh selected review** replaces that selection explicitly. Review the proposal again against the new accepted source.

### 2. Record the professional decisions

In **Proposed decisions**, enter the method name, edition, basis and source-use note. Declare annual full-time rates. Give an effective date, or retain a clear effective-timing description when the source does not establish a calendar date.

Choose the date basis:

| Basis | Required source condition | Result |
| --- | --- | --- |
| Common target date | Every selected comparison has the same explicit target date | Retains those accepted annualized figures and that date |
| Retained source dates | Record a note explaining the historical or differing source dates | Retains each original date and amount, with the original source context visible |

The proposed structure applies the analyst's range choices to the already accepted comparison. The calculation keeps the original market-aging assumptions. A proposed method contains one currency; a separate method can carry another currency.

For every grade, select an original analysis and the reference:

| Reference choice | Analyst input |
| --- | --- |
| Original analysis measure | Select its complete accepted p25, p50 or p75 measure |
| Entered amount | Enter an explicit reference amount and explain its relationship to the selected analysis |

Then select one range rule:

| Range rule | Analyst input | Retained calculation |
| --- | --- | --- |
| Original analysis measures | Choose the original lower and upper percentile measures | Exact accepted measures and complete source coverage |
| Entered limits | Enter the minimum and maximum | Exact decimal inputs and the selected original reference |
| Percentages around the reference | Enter percentages below and above the reference | Reference × (1 − below/100), reference × (1 + above/100) |

Enter a rationale for each grade. Select exact decimal output or half-up rounding to cents. The preview preserves the unrounded minimum, reference and maximum alongside the final values and each rounding adjustment.

For every role, select its original job analysis and proposed grade, then record the assignment rationale. The original job title, description, native record ID and complete source row accompany the role. Each original job is assigned once within a proposed role edition. Every selected analysis must support a grade or role.

Grade and role editors display 25 rows per page. Their previous/next controls expose the complete retained decision set.

### 3. Preview and retain the proposed edition

**Calculate complete proposal preview** runs through the original native Workspace API. Review its grade ranges, original source references, full calculations, role mappings and date/source-use notes.

**Save proposed structure** records the exact preview hash and complete proposed document. Changing a substantive decision invalidates the prior preview in the browser; the native save also checks the complete current preview hash.

**Download current editable draft** preserves the complete editable decision document. The import editor uses the existing lossless JSON reader, retaining original decimal lexemes and a leading UTF-8 BOM. The full original imported content, filename and SHA-256 remain with the retained proposal. An edited original is labeled as such. Failed or malformed imports remain available for correction and exact download.

The browser stores drafts through the original workspace draft store. Returning from another operating view or refreshing the page restores the same draft. A submitted mutation is banked before sending. **Resume original request** reconciles its same operation ID; **Reopen the returned native result** applies an already returned result after an interrupted display or refresh.

### 4. Review, derive and use the native editions

Open the saved proposal under **Review and derive**. Record the reviewer and notes, then **Accept proposed structure** or **Request changes**.

Acceptance pins the currently accepted original input reviews. After acceptance, **Create native method and role editions** performs one atomic derivation inside the original Workspace transaction:

- Save one native classification method with the complete accepted proposal and original inputs.
- Save one native role edition whose parent is that exact method ID and SHA-256.
- Retain the proposal acceptance and stable derivation identity with both results.

Reopening the derivation returns its existing method and role IDs. The original operation-replay path also returns the original result after a lost response.

The resulting method and roles open directly in **Classification and placement**. Review those exact editions through that view's existing source-review workflow, then continue to workforce intake, placement, phased costs and accepted scenario exports.

**Use as a new proposal edition** retains the earlier proposal ID/SHA and compares grade and role changes by their stable IDs. Earlier proposed editions and their derived inputs remain readable.

## Receiving exports

| Export | Complete content |
| --- | --- |
| Editable JSON | Submitted decision document and original proposal identity |
| Accepted CSV | Role, original job, selected grade, exact amounts, reference/range rules, rationales, source/date basis, proposal acceptance, and current anchor/role review state |
| Accepted JSON package | Immutable proposal, complete original analyses and source metadata, proposal reviews, current input status, derivation, and native classification editions |
| Original-source ZIP | Accepted package, source manifest and complete original imported source bytes with size/SHA verification |
| Native Workspace backup | All original source files, records, decisions, proposal and classification history, operation journal and other existing workspace extensions |

Historical accepted exports retain the proposal's original acceptance. They also expose the current state and latest review identity/outcome of every original analysis. If an upstream review changes, the historical decision remains available with that change visible.

Source ZIPs retain the provider's permitted-use metadata and exact imported bytes. The receiving code verifies every file against its original recorded size and SHA-256. Its 128 MiB source-package limit has an explicit error; the original complete Workspace backup carries larger cases.

## Native API

The extension is registered as `market_structure` in the original `core.EXTENSIONS`. Existing server routing supplies its same-origin HTTP and static asset paths. The extension uses the same SQLite connection, `BEGIN IMMEDIATE` transaction, revision check and operation-replay journal as every existing native mutation.

### Read operations

```text
GET /api/extensions/market_structure/state
GET /api/extensions/market_structure/document/analysis-page/start
GET /api/extensions/market_structure/document/analysis-page/before-<rowid>
GET /api/extensions/market_structure/document/proposal-page/start
GET /api/extensions/market_structure/document/proposal-page/before-<rowid>
GET /api/extensions/market_structure/document/analysis/<analysis-id>
GET /api/extensions/market_structure/document/proposal/<proposal-id>
GET /api/extensions/market_structure/document/derivation/<proposal-id>
GET /api/extensions/market_structure/download/<kind>/<proposal-id>
```

Pages return `items`, `next`, `total` and `page_size`. Retain the exact `next` cursor. The complete original document read is separate from the table's summary rows.

Native Python uses the same read contract:

```python
from core import Workspace

workspace = Workspace("/path/to/retained-workspace")
state = workspace.extension_read("market_structure")
analysis = workspace.extension_read(
    "market_structure", "document", "analysis", analysis_id
)
download = workspace.extension_read(
    "market_structure", "download", "accepted-package", proposal_id
)
# download contains data bytes, content_type and filename.
```

### Mutations

Use `POST /api/extensions/market_structure/<action>` or
`workspace.mutate("market_structure." + action, body)`.
Every body carries `operation_id` and the exact integer `expected_revision`.

| Action | Additional fields |
| --- | --- |
| preview | `document`; optional `original: {filename, content}` and boolean `edited_original` |
| save_proposal | Preview fields, `expected_preview_sha256`, `actor`; optional `supersedes` and `expected_supersedes_sha256` |
| review | `id`, `expected_sha256`, `outcome`, `reviewer`, `notes` |
| derive | `id`, `expected_sha256`, `expected_review_id`, `actor` |

The document includes its method header; selected analysis ID/result SHA/review ID triples; one currency and annual-full-time rate basis; effective/date/source-use descriptions; complete grade decisions; and complete role assignments. `examples/market_structure_from_accepted.py` contains a complete original-source construction using these fields.

The native journal checks a previously accepted operation before the current revision. Reuse the original body and operation ID after an uncertain response. New arguments require a new operation. Meaningful selection, content, preview, source or revision conflicts return their original specific error codes.

Limits are 200 selected analyses, 2,000 grades, 25,000 roles, a 16 MiB original JSON import and a 32 MiB complete saved proposal. Read-only state/document/export operations open query-only SQLite connections. New storage tables are created inside the first original write transaction.

## Reopen the existing FSU example through this workflow

The maintained helper starts with an existing accepted native analysis. It snapshots that original workspace through its supported backup operation and receives it into a separate destination. This preserves all original inputs and case history.

Find the original accepted analysis ID:

```bash
python3 cli.py --workspace /path/to/existing-fsu-case state
```

Use the same explicit source, destination, output, analysis ID and reviewer on both invocations:

```bash
python3 examples/market_structure_from_accepted.py \
  --source-workspace /path/to/existing-fsu-case \
  --workspace /path/to/pay-structure-case \
  --output /path/to/pay-structure-operation \
  --analysis-id analysis-ORIGINAL_ID \
  --reviewer "Receiving operator" \
  --until saved
```

Run the same command with `--until complete` to reopen it in a new process. The helper reuses every original request, reviews the explicit percentile illustration, derives and reviews the native method/roles, reopens the same derivation, saves the accepted exports and complete native backup, restores that backup, and compares the original exported bytes and native editions.

For the original published FSU comparison, the selected p25/p50/p75 amounts remain USD 35,200 / 37,950 / 43,950 per full-time year. The grade assignment is explicitly an operating illustration. The original guidelines, source metadata and receiving notes remain with the case.

The output retains `context.json`, the source snapshot receipt, complete original analysis, exact imported decision file, each original mutation request and response, accepted exports, native backup identity, reopened case, and `RESULT.json`. Repeating the same invocation reconciles the same original operation identities. `MARKET_WORKBENCH_APP` can point the helper at an explicitly selected installed application tree.

## Source ownership and integration

The extension composes the original market-analysis records and review tables, the original classification normalizers/store/exporter, and the original browser lossless JSON parser and durable stores. Its added proposal, review and derivation tables belong to the same native workspace. The core change is one extension registration; the existing HTTP server and backup/restore implementation remain the shared runtime.

Files:

- `market_structure/engine.py`: explicit grade/role decisions, Decimal calculations, source/date admission and edition comparisons.
- `market_structure/host.py`: original source/review verification, native persistence/derivation, complete paging and exports.
- `market_structure/browser.mjs` and `browser.css`: source receiving, complete editable decisions, review/derivation and original draft/request continuation.
- `classification/browser.mjs`: exported original parser and exact ID/SHA edition opening.
- `web/app.js` and `web/index.html`: cached view, native receiving links and existing durable storage adapters.
- `examples/market_structure_from_accepted.py`: one complete existing-source receiving/restart/export/restore operation.
