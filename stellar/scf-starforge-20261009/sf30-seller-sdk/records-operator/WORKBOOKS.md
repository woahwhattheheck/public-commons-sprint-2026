# Workbook receiving in the Records operator

This is the complete original XLSX receiving, reviewed mapping and custody-source workflow in the existing Records application. The same Python workspace retains source, revisions, private previews, draft recovery, history and portable export. The workbook controls use the original server and authentication.

A received workbook is available for inspection and full export even when its rows are blank or its custody information is incomplete. A transfer request, scheduled destruction date and temporary intake number retain their original meanings. Actual custody admission, withdrawal or destruction requires independently attributed source evidence.

## Receive and inspect the original file

Use the Workbooks tab in the original operator URL. Upload the original .xlsx file as bytes, then retain its source kind, label and actual capture time. Existing prepared inputs can declare the same file in edition.workbooks. Keep the content-addressed path captures/<sha256>.xlsx, exact byte count and lowercase SHA-256.

The reader retains the original ZIP and worksheet identities, sheet names including leading/trailing spaces, sheet visibility, selected physical row and column numbers, stored cells and blanks, merged-cell ranges, hidden rows/columns, number formats, raw numeric lexemes, formula text and its original cached value. The workbook's 1900/1904 date system is metadata. It does not recalculate formulas, convert a serial date into a guessed timestamp, fill a merged cell's blank neighbors or discard blank rows.

Inspect all sheet metadata first. Select an exact sheet and inclusive row/column range. For a workbook with several relevant sheets, create one intake descriptor per sheet using the same original file identity. Each intake has its own range and decisions; the complete original workbook remains one source file.

The native private function is:

~~~javascript
inspect_workbook({
  periodId, editionId, workbookId,
  sheet, offset, limit, query, row
})
~~~

All parameters are optional except the identifiers needed to resolve the selected workspace. Without workbookId it returns the retained workbook list. The default page is 100 rows; the maximum requested page is 500. Large cells can reduce the returned page, with byteLimited, hasMore and exact nextOffset. A different sheet argument is an inspection choice; it does not change the saved custody range.

The result schema is tj.records-workbook-inspection.v1. It includes report, workbook metadata, assessment, page and custodySource. Read the selected range, source SHA and returned binding before recording a decision. The browser retains a completed preview and reopens it without repeating the same private operation.

## Explicit source mapping

Each workbook descriptor in edition.workbooks includes:

~~~json
{
  "id": "transfer-intake",
  "label": "Original operator-supplied transfer list",
  "path": "captures/<original-sha256>.xlsx",
  "sha256": "<original-sha256>",
  "bytes": 12345,
  "capturedAt": "<actual whole-second UTC>",
  "sourceKind": "operator-provided-workbook",
  "role": "transfer-request",
  "selection": {
    "sheet": "<exact original sheet name>",
    "firstRow": 10,
    "lastRow": 40,
    "firstColumn": "A",
    "lastColumn": "U"
  },
  "fieldMap": {},
  "mapping": {},
  "constants": {},
  "requiredFields": [],
  "requiredContext": [],
  "context": {},
  "documents": [],
  "rowDecisions": [],
  "custody": {}
}
~~~

These placeholders illustrate the schema and are not a populated customer inventory.

fieldMap assigns semantic form fields to exact uppercase source columns. Supported fields include temporary_box, schedule, series_code, series_title, sequence_range, year_in_box, destroy_date, permanent_box, remarks and request_date. Use the actual source cell for a merged range. A label above two apparent columns does not establish that the underlying row contains two distinct cells.

mapping maps only the original engine's carton_ref, site_ref, admitted_at, terminated_at and termination_kind. constants supplies explicit absent values. A mapping and constant cannot supply the same canonical field. Per-row reviewed values can replace a mapped interpretation while retaining its original cell, formula and source hash.

Temporary numbering is not an authority-assigned permanent carton ID. A request date is not an admission. A scheduled destruction date is not a destruction event. The bridge requires an explicit reviewed actual value when those source fields could otherwise be confused.

Context retains department/division/account/contact, retentionAuthority, rateAuthority, preparedBy, verifiedBy, verifiedAt and verificationReference. Add the actual relevant keys to requiredContext. requiredFields lists the semantic fields that the selected source owner requires for included records. The application does not invent a department, approved rate, retention schedule, independent verifier or destruction date.

Original PDFs, instructions, rate/retention records, custody requests and actual receipts remain exact reference bytes in documents:

~~~json
{
  "id": "warehouse-receipt",
  "label": "Actual receiving evidence",
  "path": "references/<retained-file>.pdf",
  "sha256": "<exact-sha256>",
  "bytes": 12345,
  "kind": "custody-receipt",
  "capturedAt": "<actual whole-second UTC>",
  "sourceKind": "operator-provided-record"
}
~~~

Kinds are instructions, retention, rate, custody-transfer, custody-receipt, inventory and other. Reference files are not imported as invoice or custody rows merely because they are attached.

## Review every selected row

The page shows physical row numbers, blank state, original cell detail, merged ranges, mapped fields and current issues. A row decision records its original sourceRowSha256, include/exclude/pending status, owner, actual timestamp and note.

An included row must have actual carton/site identifiers, a canonical whole-second UTC admission, any actual termination and an attributed evidence reference. Active custody uses null terminated_at and null termination_kind. Closed custody uses a later actual timestamp and WITHDRAWN or DESTROYED. The original engine validates identifiers and custody intervals.

Evidence uses an exact retained document ID and meaningful reference. The special $workbook evidence ID is allowed only for an actual custody-inventory source. A transfer request cannot authenticate itself as a completed admission. Formula or spreadsheet error cells need an explicit reviewed actual custody value before inclusion.

An entirely blank row cannot become a custody record. The browser can record an attributed exclusion of explicitly selected rows, or an explicit blank-row disposition bound to the whole selected range's selectionSha256. Every blank still appears in the inspection and complete row export. Formula-bearing cells are not treated as blank.

Roles template and reference remain non-custody sources. An actual custody-inventory can explicitly declare emptyInventory when the source owner confirms a complete zero population; a blank template cannot be reclassified as a received zero-custody inventory automatically.

After mapping and row/context review, record the mapping review against the current bindingSha256. Changes to the original bytes, range, maps, context, documents, custody or row decisions make the earlier binding inapplicable. The previous review remains in saved history.

## Custody request and acknowledgments

The custody panel retains request date, transferring/receiving department and contacts, inventory, quantities, formats, reason, conditions, security/privacy instructions, method and actual acknowledgments. Each side has its own status, named person, timestamp and evidence.

custody.requiredFields declares the actual request fields required by this workflow. Set custody.requireBothAcknowledgments to true when the governing transfer process requires both recorded acknowledgments before this source can be promoted. The assessment then requires BOTH_ACKNOWLEDGMENTS_RETAINED and the declared fields.

When that option is false, the acknowledgment summary remains informative. Independently attributed warehouse admission evidence may establish an actual carton record while a separate transfer form remains incomplete. readyForCustodySource therefore means that the declared mapping and actual custody evidence are complete; it does not universally certify a fully signed transfer form.

This application retains decisions and evidence. It does not sign a form, submit a transfer, execute a move or destroy records.

## Promote into the original custody ledger

Only an eligible native assessment returns custodySource. Review it, then explicitly add that exact descriptor to the same edition.sources. The descriptor binds the original workbook ID, bytes, source hash and current workbookBindingSha256, and supplies the original carton table's identity mapping.

The original Records processor verifies that binding again before reading the selected included rows. It preserves source workbook, sheet, physical row, cell/range and review provenance in operator data. A stale mapping is an actionable input error. Change a custody value in the workbook review and save a new revision before explicitly refreshing its promoted source.

The original policy, services, invoices and custody metadata remain required for financial reconciliation. A transfer workbook alone cannot supply a closed billing period, contract/rate authority, complete services or invoice generation. Workbook inspection and delivery remain usable while build_records accurately reports missing financial inputs.

Customer invoice projections remain the original sanitized projections. Private workbook cells, reviewer notes and source paths do not become customer invoice fields.

## Adopt this capability in an existing workspace

A saved older Records revision keeps its original three functions and code until an explicit source adoption. Use the maintained workbook-capable product with the existing operation:

~~~sh
starforge records-workspace status --dir OPERATION
starforge records-workspace adopt-workbooks --dir OPERATION --revision CURRENT_REVISION
starforge records-workspace serve --dir OPERATION --port 8431
~~~

Or invoke the same workbench.mjs with node and the existing --source-root RUNTIME_SOURCE option. The adoption command adds workbook.py, the joined original processor/application and inspect_workbook while preserving all ledgers, unknown declaration fields, terms, files, reviews, previews, releases and customer history.

The command checks the original expected source head and known original application preimages. A custom application is left for an explicit source-editor merge, with the actual differing digest in the error. Repeating an accepted adoption with its original base reconciles the already-saved child. It does not create another workspace or repeat a payment.

New prepared workspaces use the original create command and copy every declared original workbook and document byte:

~~~sh
starforge records-workspace create --dir NEW_OPERATION --dataset INPUT/workspace.json
~~~

A standalone older handoff without workbook-capable saved source remains usable with its original three functions. To add this capability, invoke adoption from the maintained product rather than its earlier packaged application.

## Complete original workbook delivery

CLI inspection uses the exact selected saved revision:

~~~sh
starforge records-workspace workbook --dir OPERATION --revision REVISION   --period PERIOD --edition EDITION --workbook WORKBOOK_ID --offset 0 --limit 100
~~~

Add --out for the full selected range and original source handoff:

~~~sh
starforge records-workspace workbook --dir OPERATION --revision REVISION   --period PERIOD --edition EDITION --workbook WORKBOOK_ID --out NEW_WORKBOOK_HANDOFF
~~~

The full exporter does not use inspection pagination to limit the delivered population. It retains original.xlsx, every declared document, workbook/intake/review metadata, complete workbook-rows.ndjson, custody-source.json, custody-rows.json and a manifest with exact file hashes/counts. A template or incomplete intake can be delivered completely with readyForCustodySource false and zero projected custody rows.

The wrapper adds the unchanged complete native portable, current operator application, original installation declaration and complete handoff.json. It reconstructs the selected immutable revision, verifies output identities, retains an interrupted export and reopens an already-complete exact destination. Select a new output directory for a different source/revision.

A workbook-capable operator application carries 22 exact source/guide files: six from the selected native revision, including workbook.py and the three original engine files, plus sixteen current product/operating files. The manifest records each file's basis. An older saved revision without workbook.py has one fewer saved-source file.

The direct source CLI uses the same core:

~~~sh
python workbook.py inspect --workspace workspace.json --workbook WORKBOOK_ID
python workbook.py export --workspace workspace.json --workbook WORKBOOK_ID --out NEW_DIRECTORY
~~~

The direct exporter returns tj.records-workbook-handoff.v1; the native workspace wrapper returns tj.records-workbook-workspace-handoff.v1 and additionally carries native history and operating source.

## Financial delivery and portable receiving

An original financial operator handoff includes workbook-intakes.json and complete workbook-rows.ndjson in operator/. These retain all selected workbook rows and any explicit intake errors independently of the financial/customer files. completeWorkbookRowExport and workbookInputErrorCount state whether all workbook intakes were readable.

Use the included original workbench to receive a full workbook or financial operator handoff:

~~~sh
node operator/application/workbench.mjs reopen --source-root RUNTIME_SOURCE   --dir NEW_RECEIVING_OPERATION --bundle operator/workspace.python-workspace.json
node operator/application/workbench.mjs serve --source-root RUNTIME_SOURCE   --dir NEW_RECEIVING_OPERATION --port 8431
~~~

The new receiving directory contains the same original workspace identity, saved revisions, previews and source. Open retained results without recalculation. Historical source is read-only until explicitly restored as a new head. New edits preserve the earlier workbook and every source-bound decision.

Managed Applications uses the same installed records provider and native process ownership. Its launch-source identity includes workbook.py and web/workbook.mjs, and its asset manifest retains the original local-draft-store route. Re-review the actual installed source identity when upgrading the product. Do not overwrite a managed binding to hide a source change.

## Source and resource limits

The original native source limits remain 8 MiB per file, 32 MiB and 512 files per revision; native output is at most 1 MiB. The workbook reader additionally limits expanded ZIP content to 64 MiB, 4,096 ZIP members, 24 MiB per XML part, 256 worksheets and 500,000 stored cells. An intake selects at most 10,000 rows and 256 columns. The original custody engine retains its own 2,500-carton limit.

The reader rejects conflicting ZIP paths/relationships, encrypted input, unsupported XML entities and malformed worksheet structure. A complete source outside these limits needs an explicitly agreed complete partition while retaining its original parent source identity. No prefix is described as the whole workbook.

The page renders source text as text. Original cells and formulas remain unchanged; derived spreadsheet-facing exports use the original safe export rules. None of these controls creates a new policy, approval authority or customer fact.
