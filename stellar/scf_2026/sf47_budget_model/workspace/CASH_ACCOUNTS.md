# Cash accounts and original observation corrections

Open **Delivery operations → Cash / issuer** to work with the original cash account. The desk joins dated cash movements, exact asset quantities, invoice allocations, original source documents, correction history and the existing Completion and Forecast workflows. Issuer correspondence remains available immediately below the cash desk.

## Open the original account

Choose the reporting start and end dates, then the network, currency and asset. **Open account** reads the current saved case. The **Accounts** section lists every recorded currency/network/asset combination and its opening, period and closing USD positions; **Open this account** selects those exact original dimensions.

An **All** selector includes every value for that dimension. **Unspecified network** or **Unspecified asset** selects the original empty value. These choices remain distinct in the API and handover: `null` means all values, while `""` selects an actual empty field.

The selected dates use the original business date of each cash observation and its state at the displayed case version. Opening covers dates before the start. Closing covers dates through the end. Period is closing less opening. Omitting the start includes all earlier activity in the period.

**Transactions** supports reference/source/supplier search, state, direction, category and an in-period filter. It retains original voided, testnet and unvalued observations. Open a movement for its exact quantity, original USD valuation, complete invoice allocations, source and valuation documents, and the original record. A corrected predecessor links directly to its current successor.

**Balances and allocations** shows selected-account cash, original native quantities and the source invoices reached by those allocations. Each invoice's opening, period and closing payment position includes every original case allocation, including other cash accounts. Supplier names and original invoice numbers remain attached throughout the view.

**Corrections** shows the original and replacement observation, operator, reason, time, complete correction source and related Completion/Forecast work. **Sources and history** provides each original document and the relevant native case events with complete before/after values.

Changing the selection clears the earlier displayed report and export controls. A failed refresh leaves the current input available to correct or reopen.

## Record an observed movement

1. Enter the recording operator in the Operations toolbar and choose **Record cash movement**.
2. Enter the original date, direction, category, payment reference, currency, network, asset identity and exact decimal quantity.
3. Retain the USD valuation and its original basis. The native USD rule uses the original USD amount. A different currency can remain unvalued; an explicit USD valuation retains its source documents and note.
4. Add every original invoice allocation in the payment or refund, including allocations to different suppliers. Use the invoice's original ID and the exact allocated USD amount. The original cash validator enforces payment/refund direction, allocation totals, invoice existence, source associations and duplicate original references.
5. Select existing source documents or attach an original file. The attachment is saved through the original `source.add` command, and the draft continues at its returned case version.
6. Review the complete input and choose **Save reviewed change**.

A recorded movement uses the existing `cash.record` command. The new desk also opens existing source observations created by Statements, Bulk Ledger Intake, Supplier Accounts and original native receiving. Their source identities remain attached.

## Correct an original observation

Open a movement and choose **Correct observation**. The editor starts from the complete original native cash data, including all allocations and valuation/source fields. Edit the actual fields that need correction and retain a clear reason. An already voided observation can also receive a recorded successor. When a predecessor already has a correction, open its current successor to continue that same chain.

**Review correction and financial impact** shows:

- The original and proposed native fields.
- Before, after and change in whole-case cash and invoice positions.
- Every affected invoice's paid, open and credit balances.
- Affected work-package payments and exact native asset changes.
- Original statement associations, completion clocks and saved forecast references.
- Any native source, capacity, state or financial finding that needs resolution.

The review is bound to the case version, selected dates/account, original record, complete replacement input and source documents. **Save reviewed correction** records the original void, replacement and complete correction source in one native workspace transaction. When the predecessor was already void, its earlier original void remains in the history. Each native command retains its own event and case version under the original correction request.

The correction source contains the full original observation, its voided form, full replacement, operator, reason, source attachments, exact native versions, request ID and reviewed input identity. The account can follow multiple corrections to the current terminal observation.

**Void observation** records the existing native `cash.void` action with the operator's reason. A later correction can continue from that retained original record.

### Original financial behavior

The desk and correction preview reuse `operations_performance.py` and `operations_domain.py`. Cash totals include the native observed and valued operating entries for the selected date. Testnet and void rows remain visible with their original basis outside those totals. Other currencies retain exact original quantities and any separately observed USD value.

Invoice payments and refunds keep the original allocation signs: outgoing allocations increase net paid; incoming refunds reduce it. Invoice liabilities use the original issue date and current invoice state. Prepayments, future-issued invoices and supplier credits consequently follow the same existing Performance calculation. Package effects use the original exact-cent invoice-line allocation.

Changing a quantity, valuation, account, date or allocation recalculates both the selected account and the complete case. All original values remain in the retained correction source.

## Continue a statement, tranche or forecast

### Account statements

The statement importer keeps its original CSV, explicit row interpretation and saved review. A later source row that matches an earlier corrected observation resolves through the source- and event-validated correction chain to the current native observation.

The statement preview marks that row as existing and carries both its original interpreted record and the current corrected record, original cash ID and correction source IDs. Same-edition receiving and a fresh overlapping statement edition retain the current existing cash ID. The original CSV row is preserved.

If two selected source rows resolve to the same current movement, the preview asks for an explicit duplicate-row exclusion. A separately reused live reference, ambiguous successor or terminal void remains visible for correction through the original account.

### Tranche completion

The account shows the original receipt clocks, original and extended deadlines, submitted outcomes and saved reviews. Correcting a payment preserves the previous completion receipt and submission history. The existing Completion workflow exposes the original payment's current state, including its void, and the replacement payment's native clock.

Choose **Open tranche completion** to review the current receipt selection and continue the original paid-tranche work. Past prepared reviews and submissions retain their original selected receipt.

### Operating forecasts

Each saved forecast keeps its complete original input and source snapshot. After a correction, the account derives a current continuation by resolving every retained corrected cash reference to the current terminal observation.

**Open current inputs** opens that complete input in the existing Forecast editor. It carries the actual current cash IDs and case version and runs the original forecast preview. Review dates, remaining work and cash, then save a new edition through the normal Forecast operation. **Download complete inputs** retains the full editable input for CLI or agent use. Opening a current continuation first downloads any earlier unsaved forecast draft so that input remains available.

These continuations are available immediately after saving and whenever the account is reopened. Their original forecast identity and every source correction ID travel with the account report.

## Retained input and interrupted requests

The browser retains each case's complete editable cash desk in IndexedDB. It saves the date/account selection, original draft and before-record, pending request, earlier reconciled request and last accepted result. Navigation and case switching retain that input.

A pending request keeps its original actor, case version, complete body and request ID. **Resume original request** sends that same body to the original native operation. The server returns the retained result for an already accepted request.

When the server rejects a request because the case or selected record changed, **Review against current case** opens the current original case and preserves the earlier request alongside the editable input. Review the corrected input again to prepare its new operation. A source attachment recovery retains its completed result so returning to the draft cannot record that same recovered source again.

Two tabs use an atomic stored-revision comparison. If another tab saved a newer desk, the current tab retains its entire input and reports the conflict. **Download desk input** preserves that full input. **Open saved desk and retain this input** first downloads the current tab's input, then opens the saved edition.

**Open desk input** accepts a complete downloaded desk for the same original case. It retains the current desk as a download before adopting the selected input. For a received case with a new native ID, first import the complete account ZIP and continue its original ledger there.

## Export and reopen the complete account

**Download complete account** binds the selected report hash, dates/account and case version to one original case snapshot. The ZIP contains:

| File | Contents |
| --- | --- |
| `cash-account.html` | Readable offline account, native quantities, invoices, corrections and source history |
| `cash-account.json` | Full account report, records, allocations, dependencies and current forecast inputs |
| `transactions.csv` | Complete original selected cash records and successor associations |
| `allocations.csv` | Every payment/refund allocation with its cash, supplier and invoice identity |
| `accounts.csv` | Complete account groups and opening/period/closing quantities and USD positions |
| `invoices.csv` | Source invoices, full positions, lines and document associations |
| `activity.csv` | Relevant original case history and before/after records |
| `corrections.json` | Every retained correction packet and source metadata |
| `source-index.csv` | Original source identities and metadata |
| `selection.json` | Exact original dates, network, currency and asset |
| `operations-case.zip` | Whole native case, original source bytes, planner, records, reviews and saved work |
| `README.txt`, `MANIFEST.json` | Receiving instructions and the complete member inventory |

Choose **Import complete case** in the receiving workspace and select this whole ZIP. The receiver validates the archive members and original correction sources, rebuilds the account from the original native records, and compares it before adopting the received case identity. It opens the same dates and exact account dimensions.

The inner `operations-case.zip` also works through the existing whole-case receiver. Original statements, suppliers, work/invoice intake, installations, forecasts, completion plans and reviews remain in that case.

The complete ZIP follows the native 32 MiB archive bound. Original attachments follow the existing source and case limits. A downloaded editable browser desk can contain up to 64 MiB, including its complete pending source request; the CLI accepts the same desk bound.

## CLI

Use the installed `grant` command with the existing workspace directory. Replace each uppercase identity with the selected original case, version or reviewed hash.

```sh
grant operations --workspace "$GRANT_DATA" cash-account \
  --case CASE_ID --start-date 2026-10-01 --end-date 2026-10-31 \
  --expected-version CASE_VERSION --output /absolute/working/cash-account.json

grant operations --workspace "$GRANT_DATA" cash-account-export \
  --case CASE_ID --start-date 2026-10-01 --end-date 2026-10-31 \
  --expected-version CASE_VERSION --expected-report-sha256 REPORT_SHA256 \
  --output /absolute/working/cash-account.zip
```

Use `--network`, `--currency` and `--asset` for the exact account. An omitted dimension means all; `--network ""` selects an original empty network.

A correction input is a complete JSON object containing `expectedVersion`, `originalCashId`, `replacement`, `reason` and optional `selection` and `attachments`. The replacement contains the same native fields as `cash.record`: original date, direction, category, quantity, currency/network/asset, USD value, reference, tranche, full allocations, source IDs/note and valuation source IDs/note. Keep decimal amounts as original strings.

```sh
grant operations --workspace "$GRANT_DATA" cash-correction-preview \
  --case CASE_ID --input /absolute/working/correction.json \
  --output /absolute/working/correction-preview.json

grant operations --workspace "$GRANT_DATA" cash-correction-apply \
  --case CASE_ID --input /absolute/working/correction.json \
  --actor "Recording operator" --request-id ORIGINAL_CORRECTION_REQUEST \
  --expected-preview-sha256 PREVIEW_SHA256 \
  --output /absolute/working/correction-result.json
```

The apply flags can already be retained in the JSON body. If supplied in both places, they must match. Preview also accepts a downloaded cash desk's complete correction draft. Apply can resume that desk's original pending correction.

Use the dedicated resume command for a complete downloaded desk containing a pending correction, `cash.record`, `cash.void` or `source.add` request:

```sh
grant operations --workspace "$GRANT_DATA" cash-desk-resume \
  --case CASE_ID --input /absolute/working/cash-desk.json \
  --output /absolute/working/original-result.json
```

That operation uses the retained body unchanged. Existing output files are preserved by the original create-only publisher; select a new output filename for a later result.

## HTTP, typed client and Merchant MCP

All operations use the existing authenticated local workspace and its original access policy.

| Surface | Read | Review | Save | Complete export |
| --- | --- | --- | --- | --- |
| HTTP under `/api/operations/{caseId}` | `GET /cash-account` | `POST /cash-correction-preview` | `POST /cash-correction` | `GET /cash-account/export.zip` |
| `GrantWorkspaceClient` | `read('cash-account', selection)` | `cashCorrectionPreview(caseId, body)` | `cashCorrectionApply(caseId, body)` | `export('cash-account', selection)` |
| Merchant grant tools | `cash_account` | `cash_correction_preview` | `cash_correction_apply` | `export` with `kind: 'cash-account'` |

Read selection includes `caseId`, `startDate`, `endDate`, `network`, `currency`, `asset` and optional `expectedVersion`. Export requires the reviewed end date, case version and `expectedReportSha256`. The HTTP query preserves explicit empty account dimension values.

The preview body is the complete correction input. Apply adds `expectedPreviewSha256`, `actor` and `requestId`. Both retain the same original selection and replacement. Typed declarations expose original observations, complete account reports, correction previews, receipts and forecast continuations.

Merchant tools accept the complete input inline through `inputs` or through one existing verified source reference. For a retained browser request use `inputPointer: '/pending/body'` and the hash of the complete input file. Optional top-level version, actor, request and preview pins must match fields already present in the retained body. Complete results remain available through the Merchant's original snapshot, row and file interfaces.

API-only corrections can retain original supporting files atomically in `attachments`. Each uses the native `source.add` fields: filename, complete base64 bytes, media type, kind, source URL and observed time. The replacement can refer to `@attachment:0`, `@attachment:1` and subsequent zero-based positions in its source or valuation source IDs. Preview uses stable temporary source identities; apply resolves those same attachments to the original native source records inside the transaction.

## Installed source and native continuation

The managed Python and Node source declarations include the complete cash engine, browser and stylesheet. The host, HTTP adapter, CLI, typed client and Merchant provider expose the same native operations. Keep the cumulative installed source, including Statements, Supplier Accounts, Performance, Work/Invoice Intake and Completion/Forecast, when continuing an existing workspace.

The original native case owner can perform the complete continuation in one retained case: open a dated account, inspect a payment with allocations, review and record the actual required correction, reopen its source and successor, continue the current forecast and tranche selection, receive an overlapping original statement where applicable, export the whole account and import it into the receiving workspace. Carry the complete original source files and downloaded account alongside that installed desktop and phone workflow.
