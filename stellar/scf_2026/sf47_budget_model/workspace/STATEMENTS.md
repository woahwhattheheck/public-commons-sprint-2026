# Account statements and grant cash reconciliation

Account statements carries original CSV, OFX / QFX and MT940 bank files into the existing Grant Operations cash records. Select the native source format and account, review its original posted movements, reconcile source balances, and receive the reviewed cash in one original case transaction. CSV uses explicit column and locale mapping. OFX / QFX and MT940 use their maintained native readers and keep the original parser report with the source.

Open **Delivery and cash operations → Account statements**. The same feature is available through the original Python CLI, typed Grant client and Merchant MCP. Cash, invoices, Budget performance, forecasts, complete-case exports and receiving continue to use their existing original records.

## Original source and account identity

For CSV, select the original UTF-8 file, optionally with its UTF-8 BOM. The first record supplies the exact column headings; headings retain their surrounding spaces. Supported separators are comma, semicolon, tab and vertical bar. Quoted fields, quoted multiline descriptions, CRLF and LF records retain their original bytes. A row decision names the physical source line at the beginning of its CSV record, so multiline fields do not silently renumber later decisions.

Use a stable nonsecret account ID, such as `operating-usd`, plus a readable account label. Keep this ID for later statements and corrections from the same account. It is case-sensitive. Do not put credentials, a full account number or an access token in the ID. Statements use `statement/<accountId>` as the source namespace in the original cash record's network field and the selected currency as its asset. This identifies an accounting source account. Keep this same alias when moving between exports and formats from that bank account.

For CSV, the original transaction ID column is required. Payment identity is the account namespace, currency and original provider reference. A 64-character hexadecimal reference uses the cash domain's existing case normalization; other references remain case-sensitive. CSV dates, amounts, descriptions, source row numbers and filenames never substitute for the provider identity. Native OFX uses its FITID; MT940 uses the supplied statement identity and transaction position described below. Two legitimate same-day, same-amount payments with distinct provider IDs remain two movements. The same provider ID on two accounts remains two account observations.

Each import selects one currency or asset. If the CSV has a currency column, map it: every interpreted row must match the selected currency. Separate different currency populations into their original complete exports. An optional original USD valuation column can supply a distinct valuation of a non-USD amount; retain its explicit basis in Valuation note. The original asset amount stays separate and exact.

## Inspect original OFX / QFX and MT940 accounts

Choose OFX / QFX or MT940 before selecting the original file. Inspection reads the original bytes and lists the exact account and currency sections. Choose one section and its stable account alias before preview. A file containing several accounts is inspected once for each chosen source interpretation; receiving one section retains the full original file and report while creating cash only for that section.

OFX / QFX retains the declared encoding from the original file. QFX uses the OFX source format. The native reader handles its supported original XML and SGML records; file extensions do not substitute for its format validation. MT940 requires the original transport, encoding and interpretation choices explicitly:

| MT940 choice | Accepted values and meaning |
| --- | --- |
| Transport profile | TEXT_BODY for original statement text; FIN_ENVELOPE for the original FIN transport envelope. |
| Character encoding | ASCII, UTF-8 or ISO-8859-1, matching the actual original file. |
| Debit / credit profile | CD_ONLY for C and D records; CD_REVERSALS when the source uses the supported RC and RD reversal marks. |
| Century window start | 1900 through 2000. The native reader resolves two-digit source years within this explicit 100-year window. |
| Date basis | VALUE_DATE. The full original value date is recorded; a separate entry MMDD remains an original partial date. |
| Currency precision | An explicit map of uppercase currency codes to decimal places, from 0 through 6. For example, USD: 2. |

The selected MT940 options travel with the exact file through preview, receiving and case reopening. Changing the century window or amount precision after cash from those bytes is recorded creates an interpretation conflict. Reconcile the original cash observations before changing their source meaning.

Inspection shows account references from the source, currency, source date range, posted row count, pending count, balance snapshots and native findings. Original credit-card and credit-line accounts describe liabilities; their obligations belong in Supplier accounts. The account picker identifies which sections can supply grant cash.

Original balance snapshots keep their own dates. An OFX ledger balance is an as-of snapshot; its download window supplies the original requested range. OFX does not supply an opening balance merely because it supplies a closing snapshot. The MT940 reader verifies each original booked page and retains connecting page balances and sequence findings. A single page or an unambiguous connected set supplies its original opening and closing amounts for review. Available and forward balances retain their distinct source dates.

## Native payment identity and original corrections

The source format determines each payment's stable identity:

| Original format | Grant cash identity within the selected account and currency |
| --- | --- |
| CSV | The mapped original provider transaction reference. |
| OFX / QFX | The original FITID. The original DTPOSTED local calendar date supplies the cash date. |
| MT940 | The original account, currency, statement year, statement number, sequence and transaction ordinal. The retained reference is a hash of this native statement identity and position. |

MT940 owner and bank reference fields can repeat or contain placeholders. They remain visible as provider references, while the supplied statement position distinguishes legitimate repeated payments. A changed amount or date under the same MT940 position conflicts with its earlier cash facts. The native reader retains duplicate-page occurrences and detects differing pages under one source identity.

Native review row numbers start at 2 and identify the selected account's ordered movements. The source-line field separately retains the physical line from OFX or MT940. This gives each XML movement its own review decision even when the entire XML file occupies one physical line. CSV decisions continue to use their original physical record-start lines.

The review preserves pending OFX observations in the full report. Pending observations do not create cash. An original currency override needs a reviewed account-currency amount before that row can be received.

OFX correction records remain explicit. For REPLACE, retain the correction in the source review note or the row's reason, exclude a superseded occurrence present in the file, and correct or void an already recorded target through the existing Cash action before receiving its replacement. The desk identifies replacement cycles, competing selected replacements and active target records. For DELETE, void the referenced original Cash observation and exclude the deletion record with its reason. These actions retain the original bank instructions and the operator's cash correction history.

An existing stable alias stays bound to its original bank account reference and currency. The same original section cannot create duplicate active cash by changing only its alias. Original source account references stay in the retained source metadata; the operator's short alias remains the cash namespace.

## Choose the CSV number and date format

The selected decimal mark is a period or comma. An optional thousands separator can be a period, comma, space, nonbreaking space or apostrophe, and must differ from the decimal mark. Grouped numbers require groups of three digits. Amounts can use one leading sign or parentheses for a negative value. Currency symbols and exponent notation are rejected. The parser and cash writer use Decimal values and native strings.

For signed amounts, specify whether positive values represent inflows or outflows. For separate debit and credit columns, debit means outflow and credit means inflow; both values must be nonnegative and at most one may be nonzero. Empty debit/credit cells mean zero. A zero movement can be retained as an explicit exclusion when it is an informational row.

Select exactly one date order:

| Input format | Example |
| --- | --- |
| YYYY-MM-DD | 2026-10-12 |
| MM/DD/YYYY | 10/12/2026 |
| DD/MM/YYYY | 12/10/2026 |
| YYYY/MM/DD | 2026/10/12 |

The source must match the selected shape and an actual calendar date. The importer does not infer a locale from an ambiguous date or number.

## Review rows and original balances

Preview interprets the complete selected account section against the current case version. The browser shows all source rows with paging and filtering. Download the complete preview when reviewing it elsewhere.

| Row result | Meaning and action |
| --- | --- |
| New cash movement | Valid original source and cash facts; selected for receiving. |
| Already recorded | The same account/payment identity already has matching original cash facts. The existing record is retained. |
| Excluded | The operator supplied a reason for omitting this row from new cash records. Original bytes and the decision remain in the review. |
| Needs correction | A source/mapping/value conflict, repeated selected provider ID, changed existing cash facts, or voided original observation needs reconciliation. The batch cannot be received. |

Set a default category, then review specific categories and grant tranches where the source requires them. A tranche belongs to a grant inflow. For actual supplier payments or refunds, allocate exact USD amounts to the retained invoices. Allocations use the original cash domain: they need an observed USD value, fit within that value and follow the original outflow/refund direction rules. A statement does not create supplier invoices or rewrite their amounts.

An exclusion needs a reason. It retains the raw row and its parse problems where applicable. Excluding a duplicate provider row is an explicit operator choice, not silent deduplication.

Enter the original opening and closing balances together. CSV uses its selected decimal and grouping format. OFX / QFX and MT940 use ordinary decimal text with a period and no grouping. Reconciliation uses **every readable movement in the original statement**, including already recorded and explicitly excluded movements:

`calculated closing balance = original opening balance + original inflows − original outflows`

The report shows the calculated balance and its difference from the stated closing balance. A mismatch prevents receiving. When a movement amount or currency cannot be interpreted, supplied balances remain unavailable and receiving requires correction. If both balances are omitted, the report displays that condition and the original row decisions still govern receiving. Statement totals and the amount of *new* cash being imported are shown separately.

For native files, the original parser's page and account controls remain visible alongside this operator-supplied reconciliation. Original OFX totals describe the supplied posted occurrences, including corrections and repeated occurrences; review these against the source snapshots and their dates. A source containing overlapping windows or correction records does not acquire a fabricated opening balance. MT940 booked-balance differences and conflicting original page identities prevent receiving even when the optional aggregate balances are omitted.

## Review a group of statement rows

For a statement with many movements, use **Work with selected rows** in the existing native preview. The controls work with exact source row numbers in that preview.

1. Preview the mapped source against the current case. Apply a status or reference/description filter when useful.
2. Select individual source rows, **Select rows on this page**, or **Select all matching rows**. Page selection covers the displayed page of up to 50 rows; matching selection covers every result under the currently applied filter. Selections accumulate and stay selected when paging or filtering. **Clear selection** removes the whole selection.
3. Check the selected count and source movement totals. Amounts are added as exact decimal strings and kept separate by currency and inflow/outflow direction. The panel counts already-recorded, excluded, conflicted and unreadable movements. These totals describe selected source rows, including exclusions and already-recorded cash.
4. Choose **Category / grant tranche**, **Exclude from this import**, or **Include in native review**. A category or tranche can remain unchanged. Explicitly clear an existing tranche before changing a row to a non-grant category. A tranche needs a grant inflow.
5. Enter the reason to append to every changed row. Earlier reasons remain intact. **Review selected-row changes** displays the complete proposed before/after decision, its original reference and description, and its retained invoice allocation count. Page through the proposed changes or download the complete proposal.
6. **Apply these row decisions** updates only the editable browser draft. Use **Preview updated decisions** to run the existing native parser, duplicate checks, cash validator, source limits and balance reconciliation. Confirm and import through the original statement action.

Classification skips rows already recorded in the current preview. Excluding an already-recorded source row omits it from this receiving decision; it does not void the existing cash observation. Including an excluded row sends its original facts through native review again. Source errors, changed cash facts and repeated identities keep their original conflict behavior.

Group changes preserve every original allocation and source field. Invoice allocation changes remain individual decisions in **Invoice allocations**. If an appended reason would exceed the original 4,000-character bound, the proposal identifies that row and stays unapplied. No invalid row is silently dropped.

### Recover or undo the current group change

**Undo last group change** restores the exact previous decision array while that preview and the newly applied decisions remain current. A subsequent individual edit, mapping/source/account change or new native preview ends that undo point. Those changes also clear the old selection and proposed batch so a source row number cannot silently refer to another interpretation.

The existing Staff-scoped browser draft retains selected rows, current batch controls and the current undo point alongside the original inputs and decisions. A page reload can continue the same current preview; a changed case version requires a new preview. Downloaded recovery files preserve every applied per-row decision and original source. Opening a recovery file requires fresh native review and starts a new selection.

An import or setup request already awaiting its original response locks these editing controls. Resume that exact original request first. The final saved review, recorded cash, complete case ZIP and independent receiving retain the same explicit per-row decisions through the existing native transaction and source history.

## Receive the exact reviewed batch

After reviewing the rows, classifications, invoice allocations and balances, confirm the preview and select Import reviewed cash movements. The original case version and preview SHA bind the request to the complete source bytes and interpretation.

Receiving uses the existing SF47 SQLite transaction. It retains:

- The exact original CSV, OFX / QFX or MT940 bytes as a payment source.
- A complete JSON review containing the source identity, source observation, interpretation, classifications, exclusions, normalized preview, original cash identities and the recording operator. Native bank formats include the entire original parser report in this same review source.
- Every selected new cash observation, referencing both original sources.
- One case event and one new case version, with the original request ID.

The original cash validator checks each new row against current records and earlier staged rows from the same batch. Any failure rolls back the original statement source, review, new cash rows, event, case version and request result together. The original limits apply: 5,000 total business records, 200 attached sources, 24 MiB of attached bytes, 8 MiB per source and a 32 MiB request/export envelope. Each selected native account section and each source CSV has a 5,000-movement limit. CSV permits up to 200 headings and source cells up to 32,000 characters.

The complete review can exceed the original file size because it retains the exact interpretation, source positions and native parser report. Preview includes that review in its source-capacity check.

## Repeated statements, changed facts and voids

A repeated statement checks current cash records. Matching original payment identities are shown as Already recorded. A previously received identical source edition with the same mapping and decisions is returned unchanged, without another source pair or case version. A new overlapping statement can retain its own source and review while adding only new cash movements.

A changed amount, direction, date, category, USD valuation, tranche or invoice allocation under an already recorded provider identity is a conflict. Reconcile the original cash observation through the Cash view and retain its correction before importing an updated source. The statement desk does not overwrite immutable observations.

A voided original observation without a retained successor is a review conflict. A source- and event-bound Cash Accounts correction can reconcile an older source row to its current observation. The desk marks that row Already recorded, retains the original record and correction-source identities, and shows the current corrected record. Several source rows cannot resolve to one current cash observation without explicit duplicate exclusions.

The statement review remains attached after later normal cash voids. Complete-case receiving checks that each imported statement cash identity, its original facts and its source/review references remain present. For native bank sources it also reruns the same maintained reader against the exact original bytes and options, then checks the full parser report, account binding, source positions and original row fields.

## Cash Accounts and account reconciliation

Received native bank sources appear as original statement origins in Cash Accounts, including observations with retained correction chains. Account reconciliation reads the same complete source and review, reruns the original native interpretation and uses its posted movements and original currency amounts for period matching.

Opening a retained statement from the reconciliation view brings its complete original inputs back to Account statements. OFX / QFX and MT940 accounts are inspected from those retained bytes; the original selection, options and row decisions stay available for a new review. A pending import retains its exact request while the selected next statement stays queued.

Complete reconciliation packages include the original file as original-statement.ofx, original-statement.qfx or original-statement.mt940 and include its complete review beside the full original case. CSV packages retain their existing original-statement.csv member. Receiving checks the declared original members, exact bytes and rebuilt complete report through the original package importer.

## Interrupted browser requests

The browser retains the complete source, format options, account selection, mapping, decisions and exact pending request in its existing-origin IndexedDB. Use the same host and port when reopening this browser state. It also provides a complete recovery JSON download and import.

If a receive response is lost, use Resume original import. It sends the same request ID and exact original payload through the native request ledger. If the server has already returned success, Read saved case reopens the case and checks the recorded source, new and existing cash IDs, case version and original preview identity.

An unresolved original request stays intact until its result is reconciled. Choosing another statement does not replace it. Keep the downloaded recovery input in the operator's private working directory; it contains the original financial source.

## Command line

The original grant launcher supplies the operations CLI. Use the same installed source and private workspace already selected for Grant Operations.

A compact inputs file may omit `source.contentBase64` when `--file` supplies the original CSV, OFX / QFX or MT940 bytes. Retain the source observation timestamp so preview and receiving assemble the same exact input:

~~~json
{
  "source": {
    "filename": "operating-october.csv",
    "observedAt": "2026-10-12T18:00:00Z",
    "sourceUrl": ""
  },
  "accountId": "operating-usd",
  "accountLabel": "Operating account",
  "currency": "USD",
  "format": {
    "delimiter": ",",
    "decimalMark": ".",
    "groupMark": ",",
    "dateFormat": "YYYY-MM-DD",
    "amountMode": "SIGNED",
    "positiveDirection": "IN"
  },
  "columns": {
    "date": "Date",
    "reference": "Transaction ID",
    "description": "Description",
    "amount": "Amount"
  },
  "defaultCategory": "OTHER",
  "decisions": []
}
~~~

Replace the sample observation and headings with those selected from the original source. Add both original balances when supplied.

~~~sh
grant operations --workspace "$GRANT_DATA" statement-preview \
  --case CASE_ID --expected-version CURRENT_VERSION \
  --inputs /absolute/working/statement-mapping.json \
  --file /absolute/inputs/operating-october.csv \
  --output /absolute/working/statement-preview.json

grant operations --workspace "$GRANT_DATA" statement-receive \
  --case CASE_ID --expected-version CURRENT_VERSION \
  --inputs /absolute/working/statement-mapping.json \
  --file /absolute/inputs/operating-october.csv \
  --expected-preview-sha256 REVIEWED_PREVIEW_SHA256 \
  --actor "Recording operator" --request-id ORIGINAL_REQUEST_ID \
  --note "Reviewed original account statement and classifications" \
  --output /absolute/working/statement-receipt.json
~~~

Use the original current version from preview for receiving. The receive result supplies the next version. Full browser-exported inputs already contain the exact source bytes and can be supplied through `--inputs` without `--file`. If both inline bytes and `--file` are present, they must match. Output paths are create-only private files; an existing output is preserved.

Read the resulting complete case, report and sources with the existing `show`, `report`, `source`, `history` and `export` commands. The complete-case ZIP retains both original sources and all cash facts and can be reopened through the same original `import`.

### Native bank inspection and receiving

Create an inspection input with the original source observation and the format options. The CLI supplies the exact bytes from the selected file:

~~~json
{
  "sourceFormat": "OFX",
  "source": {
    "filename": "operating-october.qfx",
    "observedAt": "2026-10-12T18:00:00Z",
    "sourceUrl": ""
  }
}
~~~

For MT940, select sourceFormat MT940 and add the exact original options, for example:

~~~json
{
  "profile": "TEXT_BODY",
  "encoding": "UTF-8",
  "debitCreditProfile": "CD_ONLY",
  "yearWindowStart": 1970,
  "dateBasis": "VALUE_DATE",
  "currencyScales": {"USD": 2}
}
~~~

That object is the statementOptions field; choose its values from the original source format.

~~~sh
grant operations --workspace "$GRANT_DATA" statement-inspect \
  --case CASE_ID --expected-version CURRENT_VERSION \
  --inputs /absolute/working/bank-inspection-inputs.json \
  --file /absolute/inputs/operating-october.qfx \
  --output /absolute/working/bank-accounts.json
~~~

Use the selected section's exact id as statementId in the complete preview inputs. Retain sourceFormat, source and statementOptions from inspection, then add accountId, accountLabel, currency, defaultCategory and decisions. Original balances, valuationNote and sourceReviewNote can accompany the same complete input. Native bank inputs omit CSV columns and format.

Run the same statement-preview and statement-receive commands shown above with this input and the original bank file. Inspection creates no case version or cash; preview and receiving use the original current version and retain the same source interpretation. Account selection and format changes require a new preview.

## HTTP and typed client

Native inspection is an authenticated read-only POST:

`/api/operations/CASE_ID/statement-inspect`

Body: `{expectedVersion, inputs: {sourceFormat, source, statementOptions?}}`.

The response returns its case/version, exact source identity, selectable native account sections and inspection SHA. Send the selected section ID with the complete preview inputs.

Preview is an authenticated native POST:

`/api/operations/CASE_ID/statement-preview`

Body: `{expectedVersion, inputs}`.

Receiving is the existing authenticated command endpoint:

`/api/operations/CASE_ID/command`

Body: `{expectedVersion, actor, note, requestId, action: "statement.receive", data: {inputs, expectedPreviewSha256}}`.

The typed client exposes:

~~~js
const accounts = await grant.statementInspect(caseId, currentVersion, bankInspectionInputs);
// Select an exact cash-eligible account section, then form the complete inputs.
const preview = await grant.statementPreview(caseId, currentVersion, inputs);
const received = await grant.statementReceive(caseId, {
  expectedVersion: currentVersion,
  requestId: originalRequestId,
  actor: recordingOperator,
  note: reviewNote,
  inputs,
  expectedPreviewSha256: preview.value.previewSha256,
});
const current = await grant.read('case', {caseId});
~~~

`GrantStatementInput`, `GrantStatementPreview`, `GrantStatementRow` and `GrantStatementReceipt` preserve decimal text, original source lines, classifications and native receipt IDs in TypeScript. The request client retains uncertain-write status and the original request ID.

Merchant MCP exposes `merchant_grant_statement_inspect`, `merchant_grant_statement_preview` and `merchant_grant_statement_receive`. Each accepts the complete input inline or from the original verified host-input/snapshot/transfer mechanism. Complete large previews use the existing retained snapshot and row/file readers. The general `merchant_grant_case_command` also recognizes `statement.receive`.

The maintained `grant-operations` selection includes the complete source module, browser desk and styles. Both original managed-launch source lists include them, so an installed launch reviews and starts the same selected edition.

## Maintained native reader source

The installed statement desk includes the same original Python readers used by Merchant bank intake. Their exact original paths and Git blob identities are retained in [statement_parsers/README.md](statement_parsers/README.md). The grant adapter selects account sections and joins their original reports to the existing cash validator and transaction. Both managed launchers include the reader package and adapter, so the installed browser, CLI, typed client and Merchant tools share the same native interpretation.

## Reuse the next period’s account setup

The Statements desk now provides **Use a saved statement setup**. Save the actual current account and mapping as a named edition, compare exact headings and interpretation changes for the next file, and retain the selected edition with the original import. See [Saved statement setups](STATEMENT_SETUPS.md) for first-period setup, next-period receiving, revisions, archive history and full case recovery.


## Supplier payment allocation review

The invoice allocation editor now joins supplier/invoice search, original reference suggestions, current native paid/open balances, explicit partial and multiple-invoice allocations, original invoice source downloads, and a full before/after review. Each row keeps its own unfinished working copy in the same Staff-scoped statement draft and recovery file. Apply the reviewed allocation proposal, then preview the full statement again before importing. See [STATEMENT_ALLOCATIONS.md](STATEMENT_ALLOCATIONS.md) for the complete operator workflow, incoming refund treatment, current-position interpretation and recovery steps.


## Prepare several account statements

**Statement working copies** retains named complete editions for separate banks, accounts and periods. Search the whole list, compare an earlier edition before opening it, preserve the current work automatically when switching sources, and download/import every complete edition with its original file and request. The native case, cash writer and original preview remain unchanged. See [STATEMENT_WORKING_COPIES.md](STATEMENT_WORKING_COPIES.md) for the full workflow, independent receiving and concurrent-tab handling.
