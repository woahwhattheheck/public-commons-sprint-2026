# Work and invoice workbook

Open **Delivery operations → Work / invoice workbook** inside the existing Grant Operations application. The desk prepares work records and supplier invoices, exchanges an editable XLSX, and returns the reviewed changes through the original case.

The workbook shares the native contributors, work packages, work, invoices, source attachments, event history and complete-case receiver. Work uses exact decimal hours; invoices use the existing USD ledger. The original record lifecycle and Work Intake duplicate decisions apply.

## Prepare and exchange

1. Open the intended Operations case and choose **Prepare a workbook from this case**. Enter a meaningful name. Select contributors or suppliers, or leave the selection empty to include all retained contributors.
2. Save the preparation. Each existing work record becomes one Work row; each invoice line becomes one Invoices row. The original IDs remain visible.
3. Edit rows in the desk or choose **Download saved XLSX**. An unsaved browser edit remains a working copy; the XLSX always represents the selected saved edition.
4. Download the **complete case** when another operator needs the whole native workspace, records, original source attachments and history.
5. Edit the Work and Invoices sheets in a spreadsheet application. Keep the headings, original row IDs, invoice IDs, line IDs, and the Read me identity. Save the complete file.

The five sheets are Work, Invoices, Contributors, Work packages and Read me. The reference sheets show retained contributor and cost IDs. All authored cells use text storage, preserving leading zeroes and exact decimal spelling. Enter dates as YYYY-MM-DD, hours as a positive decimal with at most four fractional places, and USD line amounts with at most two. Formulas are rejected by the original reader; enter the reviewed final value.

For new work, append a row with a distinct \`new-\` row ID and the retained contributor ID. Funding basis is PREAWARD, GRANT, CUSTOMER or INTERNAL. A blank work-package ID represents unplanned work.

For new invoices, each line needs a distinct \`new-\` row ID, a blank invoiceId, a supplier ID, invoice number, lineId, description, positive amount and USD currency. All lines of one supplier invoice share its number and dates. Work links contain existing native work IDs separated by semicolons. Record new work first to obtain its native IDs before preparing an invoice that links it.

The existing invoice editor adds lines to an existing invoice. This workbook edits the original retained lines or prepares an entirely new invoice. **Remove pending row** removes a newly authored browser row before saving; removing a retained row from a return leaves its current native record in place.

## Receive the workbook

Open the saved edition named on the workbook's Read me sheet. Choose the complete XLSX under **Receive returned XLSX**, set the last worksheet row for both input sheets, and choose whether hidden rows are included. The default includes hidden rows. The last-row selection is explicit and appears in the saved return.

**Compare returned workbook** runs the maintained dataset-refresh XLSX reader through the existing source_workbooks adapter. It retains the exact original workbook bytes, worksheet selection and cell-projection identity. Its identity sheet must match the selected exported edition.

The first comparison uses the exported edition, the latest saved preparation and the returned cells. A field changed only in the return is retained. A field changed only in the current preparation remains current. Matching changes agree. Divergent changes require **Current** or **Returned**, with a reason. Select all choices, then compare again and save the returned edition. Missing returned rows remain in the latest preparation.

A saved return is immutable. Later edits create another edition, preserving the returned file and every intervening preparation. The same complete-case export carries the entire chain.

## Compare and apply to the native case

Choose **Compare with current case**. This second comparison uses the original prepared native rows, the current native records and the saved or edited preparation. It preserves concurrent case changes and exposes divergent field changes.

Existing work edits require the original LOGGED state. Existing invoice edits require RECEIVED. Use **Recorded work** or **Invoices** to follow the existing reopen workflow where appropriate, then return to the preparation and compare again.

New rows use the original Work Intake parser and native validation. The review shows the proposed records, exact hour and USD totals, equivalent existing records, supplier invoice identities and source-row bindings. A duplicate requires an explicit separate-record, reuse or exclusion decision with a reason. Reuse selects an existing record with the same native business values.

Save an edited edition before applying it. **Apply saved preparation** submits the exact reviewed preview and current case version. One original Workspace transaction:

- updates existing records through work.save or invoice.save;
- attaches complete new-row source CSVs through work-intake.upload;
- applies the new sources through work-intake.apply;
- retains the immutable application edition and its original native operation links;
- verifies that the whole case still fits its native export.

An error rolls back the entire transaction. The application does not partially apply the first table and leave the second unrecorded. Later case changes invalidate the preview, requiring a current comparison.

New work enters LOGGED; new invoices enter RECEIVED. Use the existing work review, invoice review, dispute and payment controls to continue their normal lifecycle. **Supplier accounts** opens the original supplier account view and its work, invoice, payment and balance calculations.

## Working copies and interrupted replies

The browser retains its full selected draft, field choices, duplicate decisions, returned original bytes and exact pending request in a staff-scoped IndexedDB store. The existing Work Intake storage mechanism supplies versioned writes, so a second tab cannot silently replace a newer draft.

**Download working copy** carries the complete browser state as JSON. **Open working copy** restores it to its original case. The native saved editions and original attachments travel in the separate complete case ZIP. Save or download current edited work before opening another copy.

A write's complete body, actor, version and request ID are saved before dispatch. A lost reply leaves the original request selectable. **Resume original request** resends that same payload through the native request table, or finishes reopening an already retained receipt. A changed request is never substituted under the same ID. A definite rejected request can be retained in history while reopening the current case.

If another tab saved a newer browser copy, download the current tab's work, then use **Open saved browser copy**. The original pending request remains part of that saved copy.

## HTTP

All routes use the original authenticated service, named staff session, case assignment, actor and CSRF rules.

| Method | Route below /api/operations/{caseId} | Result |
|---|---|---|
| GET | /workbooks | Every saved workbook edition |
| GET | /workbooks/{reviewId} | Complete selected immutable preparation |
| POST | /workbook-preview | Native original/current/prepared comparison |
| POST | /workbook-return-preview | Actual XLSX inspection and current draft comparison |
| POST | /workbook-apply | Complete atomic native application |
| POST | /command | workbook.prepare, workbook.save or workbook.return |
| GET | /export.zip | Complete case, workbook history and original returns |

A prepare command uses the normal requestId, expectedVersion, actor and note, plus data containing name and optional contributorIds. Save uses bookId, rows, decisions and intakeDecisions. Return uses bookId naming the latest current preparation and a return object with the exported bookId, original source filename/dataBase64, both selections and returned-field decisions.

Native preview uses expectedVersion and bookId; optional full rows/decisions/intakeDecisions preview an edited working copy. Apply uses expectedVersion, bookId, expectedPreviewSha256, actor, note and requestId. The original saved preparation is the application input.

## CLI

Run the maintained CLI with its normal workspace and source options. Under its operations command, the complete workflow exposes:

- workbooks and workbook-show --book
- workbook-prepare --input
- workbook-save --input
- workbook-return --input
- workbook-preview --input --expected-version
- workbook-return-preview --book --xlsx --last-work-row --last-invoice-row
- workbook-apply --book --expected-preview-sha256

Mutation commands take the original --actor, --request-id, --expected-version and --note. Use --output to retain exact JSON. The --input files contain complete action data, and original source bytes remain part of the return. Existing operations export/import commands carry the whole case.

## Complete source and receiving

Runtime source comprises operations_workbook.py, operations_workbook.mjs, operations_workbook.css, operations_workbook_http.py and operations_workbook_cli.py, plus the existing Operations, HTTP, CLI, navigation host, Work Intake draft store and source-workbook-export joins. The existing XLSX reader, ZIP writer, native domain and Decimal calculations remain selected. The managed source inventory must include the complete new runtime paths.

The native receiving course uses a WALKTHROUGH case from the real checked-in planner, the original domain/Work Intake/apply/export/import paths, a conflicting concurrent work edit, exact request replay and repeated independent complete-case receiving. Its fixtures remain identified as internal workflow records.

For the producer's rendered-product pass, use the actual installed application and retained receiving case. Operate the populated and empty desktop views, narrow viewport, visible loading, invalid row/error/recovery, original XLSX download/open/edit/return, conflict choices, native preview/application, complete case export/import and browser working-copy reopen. Open every emitted source and attachment. Inspect the workbook in the actual spreadsheet viewer and inspect the actual desktop/narrow images, then repair concrete layout or control findings. Record the actual source selection, case, request and returned files with the completed course.

No hosted GitHub Actions execution is needed. The original repository Actions configuration remains selected.

## Browser receiving in the original host

The native course records `preparedBookId` and `emptyBookId` in `native-receiving.json`. In the already admitted original browser owner, import `work_invoice_workbook_browser.mjs` and call `runWorkbookCourse({page,native,output,caseId,preparedBookId,emptyBookId})`. Supply the existing authenticated Playwright page and original native read function. This course creates no server, process or workspace and uses that owner's lifetime lease. It opens Work and Invoices at desktop/narrow sizes, opens the empty preparation, downloads and reopens the complete browser copy and XLSX, operates a real row editor, observes parser error handling, and reopens the browser. Open every resulting screenshot and the XLSX in the producing session, inspect its cells and presentation, repair any visual issue and continue the same original course. Capturing images is preparation for that actual inspection.
