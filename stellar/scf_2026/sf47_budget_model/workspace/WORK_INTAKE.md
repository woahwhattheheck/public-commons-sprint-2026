# Work and invoice source intake

Open **Delivery and cash operations → Work / invoice intake** in the original Grant Operations browser.

This workflow receives original CSV and TSV timesheets and supplier invoice lines. It keeps the source attachment, positional mapping, corrections, saved editions and native record links in the existing operations case. Applied work enters **Logged**; applied invoices enter **Received**, ready for the existing work and invoice review flows.

## Complete operator workflow

1. Add the actual contributors or suppliers in **Contributors**.
2. Choose an existing source attachment or attach the original delimited file. Select **Recorded work** or **Supplier invoices**, give the intake a name, and set the source format.
3. Map each native field to a zero-based source column or one explicit value. The browser displays positions starting at one. Duplicate and blank source headers remain distinguishable by position.
4. Match exact contributor and work-package source values to existing case records. Native IDs can be used directly.
5. Preview the complete source. Open rows to inspect every original cell, correct selected values with a reason, or exclude a row. Inspect proposed records to select an exact existing record, record separate work with a reason, or exclude a proposed record.
6. Save a draft whenever the mapping or decisions should become a retained case edition. Saving can retain unresolved source rows for later correction.
7. Preview again after a save or case change. Review the counts, hours, invoice totals and duplicate decisions, then **Apply reviewed intake**.
8. Open the created or matched records in **Work** or **Invoices**. Their review, acceptance, dispute and payment allocation continue through those existing sections.
9. **Export complete case** carries every saved intake edition, the exact original attachment, all applied record links and snapshots, the case history, and the original planner.

The complete reviewed apply runs inside the original SQLite transaction. A rejected source row or stale case version leaves the proposed record set unapplied. Reusing the exact original request returns its original result. Reopening the same source hash and intake kind returns the existing intake.

## Complete browser drafts and related accounting desks

**Download complete draft** includes every intake mapping, the selected original file bytes, source controls and the exact pending request. **Open complete draft** restores that complete input in its original case and first downloads the current tab’s draft. An imported pending request keeps its original request identity and reads the native result through the normal retry path.

Browser writes compare the saved storage revision in one IndexedDB transaction. If another tab saves first, this tab retains its input and offers **Download this draft and open saved draft**. The downloaded draft can be reopened from the same desk. Saved case editions and the native request transaction continue to enforce their own current versions.

Use **Bulk ledger intake** for complete contributor, work, invoice and observed-cash tables with native field mappings and cross-file references. It shares the same original case and records; [its operator guide](LEDGER_INTAKE.md) describes that complete workflow. This work/invoice desk supplies explicit source formats, corrections, exclusions and cross-export record reuse. Both continue into Work, Invoices, Supplier accounts and Budget performance.

## Source formats

| Setting | Supported values |
| --- | --- |
| Encoding | UTF-8, UTF-16, Windows-1252 |
| Column separator | Comma, tab, semicolon, pipe |
| Header row | Positive logical CSV row; zero means no header |
| Date order | YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY |
| Decimal separator | Point or comma |
| Thousands separator | None, comma, point, space |

A quoted multiline cell remains one logical CSV row and retains its physical start and end lines. Dates use an explicit order and a four-digit year. Grouped numbers must use groups of three; hours retain at most four decimal places and USD invoice amounts retain at most two. These amounts use the original decimal arithmetic.

The original case supports source files up to 8 MiB, 24 MiB of retained attachments, 200 attachments, 5,000 native records and a 32 MiB complete case archive. The intake uses those existing capacities.

### Work fields

| Field | Meaning |
| --- | --- |
| externalId | Optional original row identity, qualified by sourceSystem |
| contributor | Existing contributor ID or exact source value to map |
| costId | Existing planned work-package ID; blank allows unplanned work |
| description | Original recorded-work description |
| startDate / endDate | Actual work period in the selected source date order |
| hours | Positive recorded hours |
| fundingBasis | PREAWARD, GRANT, CUSTOMER or INTERNAL |

### Invoice fields

| Field | Meaning |
| --- | --- |
| externalId | Optional original source identity; repeated lines may belong to one invoice |
| contributor | Existing supplier/contributor ID or exact source value to map |
| number | Original invoice number |
| issuedDate / dueDate | Issue date and optional due date in the selected source date order |
| lineId | Optional original line ID; omission retains the source row number as its line ID |
| description | Invoice-line description |
| amountUsd | Explicit positive USD line amount |
| currency | USD |
| costId | Optional original work-package ID |
| workIds | Optional existing work IDs, separated with semicolons |

Rows with the same supplier and invoice number form one invoice in original source order. Their issue and due dates must agree. Invoice numbers remain unique per supplier across the native case.

The invoice ledger records USD. Select a source column that actually supplies USD, or an explicit source-backed USD value. Original foreign amounts remain in the attached source. Foreign-currency planning and sourced exchange rates remain available through the existing operating forecast.

## Matching and saved decisions

Equivalent work requires an explicit decision when it already exists in the case or repeats in the source. **Use the exact existing record** requires matching business values and an active native record. **Record separate work** retains the operator's reason.

A nonempty sourceSystem qualifies externalId across later source editions. An identity cannot create separate native records in two proposed groups. Repeated externalId values on lines of the same invoice are supported. A source identity already attached to a native record must use its matching original record or be corrected.

Saved editions are immutable. The current draft may be revised; an applied intake reopens its original record links. A subsequent change to a work or invoice record retains the applied source snapshot in the intake history.

## Browser drafts and interrupted saves

Local edits are retained in browser draft storage. **Save draft** writes a case edition that also travels in the complete case export. The browser keeps the exact outgoing request before dispatch and retains a committed result before reopening its case.

If the response is interrupted, **Resume saved request** uses that same request. If the operation already completed, the original receipt returns. A known rejected request can be reconciled against the refreshed case while retaining local edits. A newer saved intake edition offers the explicit choice to continue the local draft on the current edition or use the current saved edition.

Use **Download mapping document** to move a complete editable mapping, corrections and decisions between clients. **Load mapping document** reviews it against the original attachment and current case before replacing the local draft.

## Native Python and CLI

All operations use the existing Workspace owner and Operations service:

- list_work_intakes(case_id)
- work_intake(case_id, intake_id, revision=None)
- preview_work_intake(case_id, body)
- command(case_id, body) with work-intake.upload, work-intake.save or work-intake.apply

The existing CLI adds:

| Command | Required selection |
| --- | --- |
| operations work-intakes | --case |
| operations work-intake-show | --case, --intake; optional --revision |
| operations work-intake-upload | --case, --file or --source, --name, --kind, --expected-version, --actor, --request-id |
| operations work-intake-preview | --case, --intake, --expected-version; optional --revision and --document |
| operations work-intake-save | --case, --intake, --expected-revision, --expected-version, --actor, --request-id |
| operations work-intake-apply | Same original selection plus --expected-preview-sha256 |

Upload accepts --format pointing to a complete format JSON object. Save and apply accept --document pointing to the complete intake document; omission uses the current saved edition. All six commands accept --output for a new private JSON file. Original source export and complete case export/import use the existing commands.

The format object is:

```json
{
  "encoding": "utf-8-sig",
  "delimiter": ",",
  "headerRow": 1,
  "dateFormat": "ISO",
  "decimalSeparator": ".",
  "groupSeparator": ""
}
```

A mapping document retains:

```json
{
  "format": {
    "encoding": "utf-8-sig",
    "delimiter": ",",
    "headerRow": 1,
    "dateFormat": "ISO",
    "decimalSeparator": ".",
    "groupSeparator": ""
  },
  "mapping": {
    "contributor": {"column": 0},
    "description": {"column": 1},
    "startDate": {"column": 2},
    "endDate": {"column": 3},
    "hours": {"column": 4},
    "fundingBasis": {"value": "PREAWARD"}
  },
  "contributors": [],
  "costs": [],
  "rowEdits": [],
  "recordDecisions": [],
  "sourceSystem": ""
}
```

Use actual original source positions and case identities. A correction is {row, values, skip, reason}; a record decision is {key, action, recordId, reason}. The preview supplies the original candidate keys.

## HTTP and agent tools

| Interface | Operation |
| --- | --- |
| GET /api/operations/{case}/work-intakes | Current intake summaries |
| GET /api/operations/{case}/work-intakes/{intake}?revision=N | Original source rows and selected edition |
| POST /api/operations/{case}/work-intake-preview | Read-only complete preview |
| POST /api/operations/{case}/command | Original upload, save or apply transaction |
| GET /api/operations/{case}/export.zip | Complete native case |
| POST /api/operations/import | Receive the complete native case |

A preview body contains expectedVersion, intakeId, optional revision and optional document. A save/apply command data object contains intakeId, expectedRevision, optional document and expectedPreviewSha256. Apply requires the exact preview digest.

The typed GrantWorkspaceClient adds workIntakeUpload, workIntakePreview, workIntakeSave and workIntakeApply, plus work-intakes and work-intake read views.

The maintained merchant provider exposes merchant_grant_work_intakes, merchant_grant_work_intake, merchant_grant_work_intake_upload, merchant_grant_work_intake_preview, merchant_grant_work_intake_save and merchant_grant_work_intake_apply. Attach original bytes through merchant_grant_source_attach, then select its sourceId when opening the intake. Edited documents can be passed inline as inputs or selected from an original host input, retained response snapshot or committed input transfer. Complete responses retain the existing snapshot pagination and exact file-download routes.

Both Python and Node managed launch selections include the intake engine, browser module and stylesheet. The existing Grant Operations source distribution includes the whole workspace component and these maintained operator interfaces.
