# Cost funding: one allocation book for the original case

Cost funding records how an operator assigns the original case's work hours and supplier invoice lines to selected funding sources. Each saved edition contains the complete allocation, the original source revisions used to calculate it, all unassigned remainders, and its full period report. It appears in the existing **Cost funding** tab and uses the original Grant Operations case, request journal, source attachments and export/import path.

This is an internal funding assignment. The original Work acceptance, supplier invoice state, observed cash, issuer events, contractual fee, grant conditions and customer acceptance keep their existing meanings. Selecting GRANT does not record an award, establish eligible cost, create a reimbursement claim or record cash receipt. Selecting CUSTOMER does not create another customer charge. An eligibility assessment belongs to its recording operator and its selected original evidence.

The feature does not change the SCF application's proposed 400 engineering/handover hours or USD 38,000 budget. Use the actual selected plan as the comparison basis. When customer-specific implementation work and common grant work coexist, identify the applicable original rows and their selected funding basis explicitly. The same original quantity cannot be assigned twice within an edition. Separate commercial obligations and actual grant conditions still come from their original records.

## Open the original work

Use the existing owner's installed Grant Operations application and original case. The tab operates on the current case; it does not initialize another case or start another service. The original Sources, Work, Invoices, Cash, Issuer events and other tabs remain available through their existing routes.

Before assigning a source-stated term, retain its actual document through **Original sources**. The funding source picker lists existing case attachments with their original names and hashes. A previous funding edition cannot be used as evidence for its own funding conditions.

The original application files include:

- `operations_funding.py`: exact compiler, saved editions, source reconstruction, report and complete handover.
- `operations_funding.mjs`, `operations_funding_requests.mjs` and `operations_funding.css`: editor, original request recovery and responsive presentation.
- `operations_funding_cli.py`: commands composed into the existing `cli.py operations` command.
- The existing `operations.py`, `operations_http.py`, `operations_cli.py`, browser parent and typed agent client.
- The existing MCP Grant owner, with `grant-funding-recovery.mjs` for complete private request/response retention.

Both original managed source rosters include the compiler, CLI, browser, request helper, style and this guide. Receive the complete cumulative application source through the original owner. Copying one module beside an older installation is not a complete source update.

## Prepare and save in the browser

1. Open **Cost funding** in the original case. The heading shows the case identity and version. Select **New draft from current book**. The first draft has no inferred funding assignment; later drafts carry the selected book's complete assignments.
2. Enter the title, internal review status, as-of date, reporting start/end and allocation note. An empty reporting start includes all earlier retained records. The reporting end and as-of date remain explicit.
3. Add each funding source. Use a stable ID, a useful name and a category. Record the agreement reference, original attachment selection, source-stated conditions, any cost window, receipt timing and a basis note. An unstated date or limit remains empty.
4. Select an original Work row or supplier invoice line and use **Edit split**. Assign exact hours or USD to one or more selected sources. Choose an eligibility assessment and its original evidence when one is recorded. The remainder stays unassigned. **Keep unassigned with a note** records an explanation without inventing a funding source.
5. Select **Calculate complete allocation**. Review the full opening/period/closing report, all source-row balances, original states, limits, source-window observations and changes from the prior edition. The browser pages long tables; the complete inputs, report JSON, offline HTML and CSVs include every row.
6. Enter a reason for the saved edition and select **Save reviewed edition**. The save binds the exact preview, complete input, current case version, current funding revision, operator and stable request ID. The original transaction commits its source attachment, case event and request result together.
7. Open the saved edition. It shows the exact original case, plan, work, invoice and source revisions, plus later differences in the current case. **Export full report and original case** creates the complete selected handover.

The status REVIEWED means the operator reviewed this internal allocation. It is not supplier approval, customer acceptance, issuer acceptance or a funding award.

The browser retains editable drafts separately from saved editions. Editing an input invalidates its calculated preview. Refreshing current source does not discard assignments that have become invalid: absent original rows remain visible until the operator explicitly resolves them.

Use **Remove this local draft** to free one of the 50 local draft slots. Download the complete input or editor recovery first if you need that local copy. Removal is unavailable while an original save remains pending and checks pending requests again before changing the editor. It removes only the selected local draft; saved editions and original request/returned-response history stay retained. The editor selects the most recently created remaining draft and names it in the status, or clears the selection when none remains. A storage failure keeps the complete draft available in the current view for download and recovery.

### Corrected invoices and later work

Keep the original cost correction in the existing invoice or work workflow. Then refresh Cost funding and prepare a successor from the intended prior edition. **Use current source and save base** selects the current case and latest book revision while preserving every draft assignment.

If a corrected invoice line is lower than its assigned total, preview refuses the over-allocation. Reduce or reassign the draft amounts explicitly, leave the exact remainder unassigned, review the new source differences and save the successor. A VOID source has effective quantity zero; a positive assignment to it must be resolved. Neither action rewrites the prior funding edition.

A removed original row stays visible as an absent-source assignment in the editable draft. Keep the older edition as history and explicitly remove that draft assignment before saving a successor. A changed original record is compared by its actual ID, version and complete record hash.

The book is one ordered sequence per case. Selecting an older edition for editing still uses the current head as the successor base. It does not create a parallel book or reset later saved history.

## Exact quantities and period meaning

Every quantity is a decimal string. Supplier invoice assignments allow at most two decimal places; Work assignments allow at most four. Exponents, negative quantities, nonfinite values and binary floating-point approximations are not accepted as quantity inputs. Each supplied quantity is bounded by the compiler's stated native limit.

For each original source row:

```text
assigned + unassigned = effective original quantity
```

An edition may assign less than the original quantity. It may not assign more. The unassigned fund is a calculated remainder, not an editable source or an implied financing commitment.

Hours and USD have separate columns and totals. Assigning six hours to a grant does not value those hours or establish six hours of eligible reimbursable labor. An invoice line linked to Work retains its original link; the report does not add invoice USD and Work hours into one cost figure.

Period attribution uses the **whole Work row's end date** and the **supplier invoice's issue date**:

| Report interval | Original date selection |
| --- | --- |
| Opening | Before the selected reporting start |
| Period | On or after the start, through the end, inclusive |
| Closing | Opening plus period |
| After end | After the selected reporting end |

If the reporting start is empty, opening is zero and all rows through the end enter the period. Work spanning the start is identified; its hours are not prorated. The as-of date is retained context. These dates do not establish legal cost incurrence, a grant claim period or payment timing.

The report keeps all original source rows, including unreviewed, unaccepted and VOID records. Separate totals show Work that has its original accepted state, invoices with their original reviewed state, and operator-assessed supported or excluded invoice assignments. A source-window observation identifies date fit without converting it into an eligibility decision.

An optional `limitUsd` compares the selected source's closing invoice assignments with a recorded limit. Excess remains visible. The compiler does not reduce an original invoice, invent offsetting cash, waive a receivable or silently move an excess to another fund.

### Illustration only

For an original USD 100 invoice line, assigning USD 70 to one source and USD 20 to another leaves USD 10 unassigned. For an original 10-hour Work row, assigning 6 hours and 3 hours leaves 1 hour unassigned. These are separate quantities.

If the actual invoice is later corrected to USD 80, the prior USD 90 assignment cannot pass a new preview. The operator can select a new USD 60 / USD 20 split with zero remainder, or another supported split totaling no more than USD 80. The previous USD 100 source and allocation remain in their original saved edition.

These figures are examples. The feature does not create example Work, invoices, grants, customer payments or purchases in the case.

## Full editable input

The seed command and browser input download supply the complete object. Edit those returned values and keep the actual native record and source IDs. The following shows the input structure; uppercase ID placeholders must be replaced with actual IDs from the original catalog.

```json
{
  "expectedRevision": 0,
  "document": {
    "title": "Cost funding allocation",
    "status": "DRAFT",
    "asOfDate": "2026-10-12",
    "periodStart": null,
    "periodEnd": "2026-10-12",
    "note": "Operator's complete allocation basis",
    "funds": [
      {
        "id": "implementation",
        "name": "Selected implementation funding",
        "kind": "CUSTOMER",
        "reference": "",
        "decision": "PROPOSED",
        "sourceIds": [],
        "conditions": "",
        "costWindowStart": null,
        "costWindowEnd": null,
        "receiptTiming": "",
        "limitUsd": null,
        "note": "Terms remain proposed until the original evidence is recorded"
      }
    ],
    "assignments": [
      {
        "kind": "WORK",
        "recordId": "ACTUAL_WORK_ID",
        "lineId": null,
        "note": "Basis for this source-row assignment",
        "allocations": [
          {
            "fundId": "implementation",
            "quantity": "6",
            "eligibility": "UNASSESSED",
            "sourceIds": [],
            "basis": ""
          }
        ]
      }
    ]
  }
}
```

For invoice assignments use `kind: "INVOICE"`, the original invoice `recordId` and its actual `lineId`. One assignment row represents one original target, with distinct fund IDs in its allocations. Do not synthesize line IDs from descriptions.

Funding categories are PREAWARD, GRANT, CUSTOMER, INTERNAL and OTHER. Decision basis is PROPOSED or RECORDED. A RECORDED decision requires the original source attachment, a reference and a basis note. The eligibility values are UNASSESSED, SUPPORTED and EXCLUDED. SUPPORTED and EXCLUDED require selected original evidence and a basis. The compiler checks these source joins; it does not decide whether the recording operator has correctly interpreted a contract.

Source terms are separate fields: `conditions`, `costWindowStart`, `costWindowEnd`, `receiptTiming`, `limitUsd` and `note`. Do not turn an expected award date into an observed award, a schedule into a receipt, or an internal estimate into an agreed customer obligation.

## Original CLI

Run commands from the installed `workspace` application directory. `--workspace` belongs to the original `operations` parent command. Use the actual existing workspace and case IDs. The parent CLI requires an existing planning database for operations; it does not create one from these commands.

Use the existing owner to close its original server before opening the same SQLite workspace through the headless CLI. If that server is intentionally running, use its existing browser, authenticated HTTP or SDK/MCP route instead.

In the following commands, shell variables represent values already selected by the operator:

- `funding_workspace`: absolute path of the existing original workspace.
- `funding_case`: original operation ID returned by `operations list`.
- `funding_version`: actual case version read for the preview.
- `funding_request`: the stable request ID chosen and retained for this save.
- `funding_preview_sha`, `funding_revision`, `funding_report_sha`: complete values from the original preview or saved result.
- `funding_actor`: the recording operator's name.

Inspect and prepare:

```sh
python3 -B cli.py operations --workspace "$funding_workspace" list
python3 -B cli.py operations --workspace "$funding_workspace" cost-funding \
  --case "$funding_case" --output funding-catalog.json
python3 -B cli.py operations --workspace "$funding_workspace" funding-seed \
  --case "$funding_case" --expected-version "$funding_version" \
  --inputs-only --output funding-inputs.json
```

Edit the full `funding-inputs.json`, then calculate:

```sh
python3 -B cli.py operations --workspace "$funding_workspace" funding-preview \
  --case "$funding_case" --expected-version "$funding_version" \
  --inputs funding-inputs.json --output funding-preview.json
```

Read the complete preview and retain its `previewSha256`. Save the exact reviewed input with the original request and a new private receipt path:

```sh
python3 -B cli.py operations --workspace "$funding_workspace" funding-save \
  --case "$funding_case" --expected-version "$funding_version" \
  --actor "$funding_actor" --request-id "$funding_request" \
  --note "Reviewed complete funding allocation against the selected original source" \
  --inputs funding-inputs.json --expected-preview-sha256 "$funding_preview_sha" \
  --receipt funding-save.receipt.json
```

The CLI publishes `funding-save.receipt.json.request.json` before dispatch and the exact accepted receipt after original journal reconciliation. Keep both. An exact retry uses the same case, input bytes/value, original expected version, operator, note, request ID, preview and receipt paths. Read-only recovery is:

```sh
python3 -B cli.py operations --workspace "$funding_workspace" funding-request \
  --case "$funding_case" --request-id "$funding_request"
python3 -B cli.py operations --workspace "$funding_workspace" funding-show \
  --case "$funding_case" --revision "$funding_revision" --output funding-edition.json
```

For a successor, retain the earlier receipt and choose a new explicit request ID only after reviewing the new inputs. Select `--revision` on `funding-seed` if the starting allocation is a particular historical edition. Its `expectedRevision` still names the current head.

Export with the exact saved report and the current reviewed case version:

```sh
python3 -B cli.py operations --workspace "$funding_workspace" funding-export \
  --case "$funding_case" --revision "$funding_revision" \
  --expected-version "$funding_version" --expected-report-sha256 "$funding_report_sha" \
  --output cost-funding-handover.zip
```

Update `funding_version` to the actual current version after a save. Do not reuse the old pre-save version for a new export. Ordinary JSON/output paths are exclusive. Use new filenames for new reports. Original save request/receipt files additionally require their exact canonical retained bytes; do not reformat those recovery files. Editable input files are separate.

## Authenticated HTTP and typed client

All routes use the original private Grant service and its existing authentication:

| Method | Original route | Complete selection |
| --- | --- | --- |
| GET | `/api/operations/CASE/cost-funding` | Original case ID |
| POST | `/api/operations/CASE/funding-seed` | `expectedVersion`, optional historical `revision` |
| POST | `/api/operations/CASE/funding-preview` | `expectedVersion`, complete `inputs` |
| POST | `/api/operations/CASE/command` | Original `funding.save` body |
| GET | `/api/operations/CASE/cost-funding/request?requestId=ID` | Exact original request ID |
| GET | `/api/operations/CASE/cost-funding/edition?revision=N` | Exact saved edition |
| GET | `/api/operations/CASE/cost-funding/export.zip` | Query `revision`, `expectedVersion`, `expectedReportSha256` |

The native command body is:

```json
{
  "expectedVersion": 1,
  "requestId": "RETAINED_ORIGINAL_REQUEST",
  "actor": "RECORDING_OPERATOR",
  "note": "Reason for this reviewed edition",
  "action": "funding.save",
  "data": {
    "inputs": {"expectedRevision": 0, "document": {}},
    "expectedPreviewSha256": "COMPLETE_ORIGINAL_PREVIEW_SHA256"
  }
}
```

The abbreviated `document` in that shape is not executable input. Supply the complete document from seed/edit/preview.

The existing `GrantWorkspaceClient` exposes `read('cost-funding')`, `read('funding-edition')`, `read('funding-request')`, `fundingSeed`, `fundingPreview`, `fundingSave` and `download('cost-funding')`. All use the original configured client; they do not create a separate funding runtime.

```js
const catalog = (await client.read('cost-funding', {caseId})).value;
const seed = (await client.fundingSeed(caseId, {
  expectedVersion: catalog.catalog.case.version
})).value;
// Retain and edit seed.inputs, then obtain and review the entire native preview.
const preview = (await client.fundingPreview(caseId, {
  expectedVersion: catalog.catalog.case.version,
  inputs: reviewedInputs
})).value;
```

Before calling `fundingSave`, durably retain the exact complete input, case, request ID, operator, note, original expected version and preview. Persist the returned full `GrantJsonResponse` before advancing the caller. On recovery, pass its complete original `value` as optional `acceptedResult`; the method compares it with the original request journal and refuses an absent or different commitment before the command.

The MCP path below already supplies private complete request/response retention. The low-level SDK leaves the caller's durable file location with its existing owner.

The typed result is `GrantFundingReceipt`, containing the original case ID/version, action, source record ID and full `GrantFundingSummary`. The request reader returns `found`, the stable case creation identity, complete original fingerprint/result and result hash. A later case revision does not replace that committed result.

## Existing MCP owner

The original merchant operator exposes these tools:

- `merchant_grant_cost_funding`
- `merchant_grant_funding_edition`
- `merchant_grant_funding_request`
- `merchant_grant_funding_seed`
- `merchant_grant_funding_preview`
- `merchant_grant_funding_save`

Use the existing configured workspace alias and actual case IDs. Full editable inputs can be supplied inline or from an existing retained input/snapshot with the original complete hash and optional input pointer. Use the existing input transfer, snapshot JSON/rows and full file readers for large results; a displayed summary is not the complete report.

The save retains its exact prepared request and complete native response under the original MCP owner's private workspace storage, in `cost-funding-requests`. It preserves actual response bytes, status, media type, source identity and SHA-256. Reopening the same request first checks that original native commitment. Existing accepted bytes cannot be silently replaced by a new response or replayed into an older restored case.

The existing `merchant_grant_export` accepts `kind: "cost-funding"` with the exact `caseId`, `revision`, current `expectedVersion` and `expectedReportSha256`. Use its original retained-file reader to obtain every byte. The original full case import accepts the complete funding handover; there is no separate funding database importer.

## Complete report and receiving

The funding ZIP has these exact members:

| Member | Contents |
| --- | --- |
| `MANIFEST.json` | Full member roster, byte counts and hashes |
| `operations-case.zip` | Complete original case, plan history, source files and saved funding history |
| `cost-funding-selection.json` | Selected original case and funding edition identity |
| `cost-funding-report.json` | Complete saved edition, including document, source snapshot, calculation and changes |
| `cost-funding.html` | Complete offline report and source/context details |
| `cost-funding-allocations.csv` | Every allocation part with exact quantities, source references and assessment basis |
| `cost-funding-balances.csv` | Every original row and its assigned/unassigned balance |
| `cost-funding-changes.csv` | Complete original-row, assignment and funding-source changes with before/after values |

In allocation rows, `sourceIds` names the selected eligibility evidence; `fundSourceIds` names funding-term evidence. The full original target's source IDs and records remain in the edition's source snapshot and balance population. These are separate provenance roles.

Receive the outer ZIP through the existing **Import operations** workflow or original command:

```sh
python3 -B cli.py operations --workspace "$funding_receiving_workspace" import \
  --file cost-funding-handover.zip --name "Received cost funding case" \
  --actor "$funding_actor" --request-id "$funding_import_request" \
  --note "Receive the complete selected original funding handover"
```

The receiving workspace must be an intentionally selected existing workspace. The normal import gives the received case its native receiving identity and preserves the original source history. The result's `selectedFunding` identifies the selected report; the browser opens that edition. All funding source editions, original source attachments and native record history are included, not only the last visible screen.

Import validates every outer member, the complete inner case, source and report hashes, ordered funding predecessor links, historical original record values and the exact reconstructed selected report. A report inconsistent with its original case refuses. Existing case import replay follows its original request rules.

A received case is a distinct original import result. To retry a funding save already accepted in the source case, reopen that source case's matching database and its original request record; do not apply the source case's browser or CLI request to the received case.

## Interrupted work and preserved history

Browser recovery binds the case ID and its original creation timestamp. Editable drafts, original outgoing requests, complete returned bodies and accepted results are retained separately. A returned body counts as accepted evidence even if the later acceptance-marker write failed. This prevents an older restored journal from accepting a duplicate save merely because the browser still has only the complete returned body.

Use **Reconcile / continue original save** after a lost reply. It checks the original journal before source/version preflight. If the native result is present, it recovers that exact saved edition, even after later case edits. If an accepted result survives externally while the native commitment is absent, restore the matching original state; the request is not resubmitted.

A definite native rejection can be retained and explicitly retired through **Retain rejection and return to draft**. The old request remains in history. Imported recovery does not trust closure or rejection flags; it validates complete original prepared/returned/accepted records before making a request actionable.

**Download editor recovery** contains all retained drafts and original request evidence. Import it only into the same original case identity. It does not manufacture saved source records or replace later native state. Unsaved previews are recalculated against the selected current source after import.

Do not clear browser storage, delete receipt files or mint another request ID merely to get around an unresolved original save. Keep the complete evidence and recover the existing journal. If browser storage cannot retain new data, export the complete editor recovery before leaving; a new save remains disabled.

## Bounds and complete-source behavior

The compiler accepts up to 50 funding definitions, 10,000 original Work rows/invoice lines, 20,000 allocation parts and 50 distinct fund allocations per original target. A funding input must use the supported fields and exact existing source IDs. Native source attachment and whole-case bounds also apply.

Each complete funding edition occupies an original source attachment. The existing case permits at most 200 source files, 8 MiB per source and 24 MiB total source bytes; the complete case/funding ZIP is bounded at 32 MiB. The save checks complete-case exportability inside the original transaction. A failed size check rolls back the new edition and leaves the previous saved book intact.

The browser shows original targets in pages of 50 and report balances, observations and change lists in pages of 100. Every saved row travels in the complete output. Long tables are scrollable and controls reflow at narrow widths; runtime visual review belongs to the original installed application.

## Source and validation status

The mathematical, original Store/history, CLI, archive, browser, SDK, MCP and complete product integration were independently source-reviewed. The retained CLI receipt-byte identity correction, explicit local-draft removal and neutral desk/report styling are included. A source-level recovery exercise covered a retained returned body followed by failed acceptance-marker storage: an older missing journal was refused and the original commitment was recovered when restored, with one simulated dispatch and no live service call.

This guide does not claim an installed native run, a browser walkthrough, actual grant approval, incurred cost, an accepted customer contract or a received payment. Those outcomes must be recorded through the original operations and original owner when observed.

See [OPERATIONS.md](OPERATIONS.md), [PAYABLES.md](PAYABLES.md), [TASK_OUTCOMES.md](TASK_OUTCOMES.md), [AGENT.md](AGENT.md), the existing [CLI.md](CLI.md), and the original funding compiler and request helpers for their exact implementation contracts.
