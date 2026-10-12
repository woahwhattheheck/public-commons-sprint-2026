# Xero customer invoice and credit handovers

This workspace prepares and reconciles customer document handovers from the existing merchant receivables ledger. An operator maps an organisation's original CSV templates and contact names, reviews issued invoices and credits, retains an immutable package, and records original Xero document JSON or an explicitly mapped document-summary CSV. Unresolved documents can continue through a linked correction package. Existing Xero document identities remain associated with their original source documents across that package family.

| Work area | Operator workflow |
| --- | --- |
| Handover queue | Open prepared packages, review current resolution counts and continue earlier work. |
| Organisation mapping | Retain original templates, set account and tax fields, enter exact Xero contact names and select line overrides from original documents. |
| Prepare documents | Select issued invoices and credits, inspect mapping issues, review exact totals and file identities, then prepare the reviewed package. |
| Package and results | Download handover files, record original Xero document results, inspect row outcomes, correct unresolved documents and download the complete history. |

## Install the complete selected product

Build the exact maintained source commit with the existing distribution builder:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-checkout --ref FULL_COMMIT_SHA \
  --selection merchant-receivables-xero --out /private/xero-release
~~~

The recipe includes the original accounting, customer, service quotation and receivables operations, the Xero handover desk, and their managed Applications providers. It uses the source builder's existing import collector, retained browser assets and dependency declarations.

Use the returned archive and its SHA256 with the original runtime installer:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /private/xero-runtime \
  --archive /absolute/returned-package.tgz --sha256 RETURNED_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /private/xero-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /private/xero-runtime -- receivables-xero help
~~~

The existing installed Runtime workspace discovers **Xero customer handovers** in Applications. Select the original initialized private accounting directory and use Review, Save, Start and Open. The original workspace ID and source configuration remain bound to that saved application. The same process exposes the original invoice/customer routes beside the Xero desk.

The remaining commands use the installed `starforge` command or the equivalent source CLI. A source checkout needs Node 22.16+ for the original accounting runtime; the full managed installation also selects the original Python/native tooling through the installer.


## Open the existing workspace

Run the installed command against the initialized private accounting directory:

~~~sh
starforge receivables-xero serve --directory /private/accounting --port 8449
~~~

The direct source entrypoint is equivalent:

~~~sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/xero/cli.mjs serve --directory /private/accounting --port 8449
~~~

Open the URL returned by the command. The default is http://127.0.0.1:8449/receivables/xero/. The same service also exposes the original invoices and customers workspace, plus customer statements, under the original accounting owner. Enter the operator name in the left column before saving work.

The CLI prints the actual workspace ID, original source fingerprint and local URL in its startup record. Applications can use application-provider.mjs to launch and observe the service through the existing managed lifecycle. Its provider ID is merchant-receivables-xero; its command is receivables-xero.

## Save an organisation mapping

Choose **Organisation mapping** and create a profile for the receiving Xero organisation. Set its exact name, currency, currency decimal places, default account code and tax type. Currency scales zero, one and two are supported.

Upload the organisation's original invoice and credit CSV templates. Each may be up to 256 KiB. Header spelling and any leading asterisk retain their original bytes. The compiler may add its supported explicit TaxAmount column when absent from the template. The original template remains in the retained package.

Select the invoice and credit date formats independently. Enter the exact Xero contact name for each workspace customer involved in the handover. A missing contact mapping becomes a review issue.

For exceptional lines, select an issued source document and one of its original lines. The operator reads invoice.json or credit.json from the original receivables document route. It uses the actual invoice line ID, or the credit's original invoiceLineId. Set that line's account code and tax type, then add the override. Adding the same document and line replaces that one override.

Save the mapping version. Editing an existing profile carries its retained template bytes forward unless a replacement file is explicitly selected. The profile ID and expected version accompany the update. **Reload saved version** restores the selected saved mapping in the form.

## Review and prepare a handover

Choose **Prepare documents**, select the saved mapping and the as-of date, then select issued invoices and credits. The document filter and kind selector help locate the intended records. **Select visible issued documents** affects the currently displayed eligible records.

Choose **Review selected documents**. Review issues, contact names, original amounts and output file identities. Net, tax and total are canonical decimal strings, such as 124.00, displayed with their original currency. Invoice and credit totals remain separate. Prepared credit CSV amounts use the compiler's negative credit convention.

**Prepare immutable package** saves the exact reviewed selection, original document identities, mapping version and output files. A changed profile, date, document selection or accounting revision requires a fresh review. Unsaved edits to the selected mapping must be saved or reloaded before review.

The package opens after preparation. Download its listed import files to carry out the organisation's import. File descriptors retain original names, byte counts, SHA-256 identities and roles; import batch descriptors also identify document IDs and row count.

## Receive original Xero document results

Choose the source format before selecting a file. **Xero Invoices or CreditNotes JSON** is the default. The source file limit is 8 MiB and all original bytes are retained.

### Original native JSON

Save the complete original Accounting API response from the existing authorized Xero connection. The receiving adapter accepts the top-level Invoices and CreditNotes collections, including an envelope containing both, and original validation Elements. Retain one response or page per upload.

The official read resources are:

- [Accounting API Invoices documentation](https://developer.xero.com/documentation/api/accounting/invoices)
- [Accounting API Credit Notes documentation](https://developer.xero.com/documentation/api/accounting/creditnotes)
- GET https://api.xero.com/api.xro/2.0/Invoices
- GET https://api.xero.com/api.xro/2.0/CreditNotes

Use the existing authorized tenant and its accounting.transactions.read access. Preserve the original response, follow its pagination, and record the response pages that contain the package's document numbers. Customer invoices have Type ACCREC; customer credits have Type ACCRECCREDIT. Supplier records remain source-indexed outside this receivables selection.

The operator previews original collection pointers, numbers, document UUIDs, statuses, net/tax/total, currency and validation errors. The shared native JSON reader retains every numeric token as its original source string, including its decimal precision. Duplicate JSON keys are rejected because they would give one source field more than one meaning.

Native UUID fields are InvoiceID and CreditNoteID. Native amount fields are SubTotal, TotalTax and Total. A successful detailed response must also contain Contact.Name matching the package's retained contact mapping. A missing or different name becomes a visible mismatch while the accepted UUID stays associated with the source. Original HasErrors and ValidationErrors remain visible and take part in receiving. A DRAFT status accompanied by provider validation errors remains a rejected result.

Native imports retain the original response metadata and collection/index pointers. The package view carries a compact document summary. Its downloadable interpretation report retains the full original document objects, line items, field pointers and numeric tokens, linking each outcome to its original source objects. The [original result acquisition guide](NATIVE_RETURN.md) gives the complete read, paging and tenant workflow; the operator also links that guide beside the receiving form.

### Explicit document-summary CSV

Choose **Mapped document summary CSV** for an original report containing document UUIDs and full document totals. The file must be UTF-8, comma-delimited and have distinct column headers. Its first rows and actual headers are displayed.

| Returned field | Meaning |
| --- | --- |
| Original document number | Links the returned record to the original package document. |
| Xero document ID | The external Xero document UUID. |
| Status | The returned document status. |
| Net, tax, total | Full returned document amounts compared with the original package. |
| Currency | The returned document currency. |
| Error or message | Optional failure or diagnostic text. |

Select every actual header. Suggested familiar header names remain visible for review. Choose the amounts' decimal separator, thousands separator and credit sign. A decimal comma is an amount convention inside a field; the CSV delimiter remains a comma. Decimal and thousands separators must differ. Positive and negative returned credit conventions are supported explicitly.

### Record and continue from the outcome

Enter the receiving organisation and actual UTC receipt time. The organisation must match the prepared package. Imported status values default to DRAFT, AUTHORISED and PAID; retired status values default to VOIDED and DELETED. An original retirement result records that external identity in history. VOIDED retains the Xero document number, so its source remains unavailable for same-number correction; create a linked replacement document in the original Invoices and customers workspace. An actual draft DELETED result can release the original number for a correction package.

Record the file. Each document's current outcome includes its original amount, active and earlier Xero IDs, external status, source file, row numbers or JSON pointers, and explanatory message.

| Outcome | Continuation |
| --- | --- |
| UNRESOLVED | Receive the original result, or select the document for correction when allowed. |
| REJECTED | Inspect the provider's validation or rejection message. Use an available correction checkbox for a successor; a voided number requires a linked new document in the original receivables workspace. |
| IMPORTED | The returned identity, status and exact original amounts are associated with the source document. |
| MISMATCH | Inspect the discrepancy. Correct the established Xero record and receive its accurate original result against this same package. |
| CONFLICT | Inspect all active IDs and their source records. Correct or retire the actual conflicting Xero records, then receive their original updated results. |

The correction checkbox follows the controller's exact canCorrect field. An accepted UUID remains active even when its totals mismatch. Multiple active IDs, or a UUID assigned to two source documents in the same organisation, remain visible as conflicts. They continue through original-result receiving. Retired IDs remain in history. Active identities and the original number's retirement status determine whether a correction can be prepared. Returned files that affect a document through an organisation-wide shared-ID event are retained with that document's package exports, including an original retirement received against another package.

Every returned file appears in **Returned files and interpretation**, with its source format, original identity and complete interpreted outcomes. Native imports show their response metadata and JSON pointers. Summary CSV imports show exact headers and numeric conventions. Download the original file or its interpretation report there.

## Prepare a linked correction

Select the correctable unresolved documents in the outcome table. Save any mapping changes in **Organisation mapping**, then choose the saved version under **Correct unresolved documents**.

Review the correction. Its as-of date is the parent's exact original date, and its selection is restricted to unresolved source documents. Preparing creates a linked successor. The parent remains accessible and lists its corrections.

Imported bindings are resolved across the same organisation's package family and original source. Once a corrected document has been received successfully, its parent shows the resolved outcome and it is excluded from further correction exports.

## Preserve and recover an operation

Each saved operation contains the current accounting revision, operator name and stable request ID. The HTTP client does not automatically repeat mutations.

If a complete response cannot be read, the operator retains the exact request and displays **Retry the same operation**. Retry sends the same reviewed fields and identity. Saved requests are associated with the actual workspace ID and source fingerprint, so a reused local port cannot silently adopt another workspace's request.

**Download saved request** retains the operation name, target package and request body for recovery. Its value field is the mutation input for the corresponding CLI command. A known revision or profile-version conflict returns to a new review using current state.

Use **Refresh** to read the current ledger revision and package outcomes. **Complete archive** contains retained templates, original documents, prepared files, received files, mappings, status and history. **Package record** provides the complete structured export. The archive uses the existing customer TAR renderer and flat, unique filenames.

## CLI operations

Commands share the existing accounting owner and close it when finished. Mutation input supplies revision, actor and a stable requestId. Profile updates also supply id and expectedVersion; prepare and correct include the reviewed previewSha256.

~~~sh
starforge receivables-xero state --directory /private/accounting
starforge receivables-xero profile --directory /private/accounting --input /private/profile.json --invoice-template /private/invoices.csv --credit-template /private/credits.csv
starforge receivables-xero preview --directory /private/accounting --input /private/selection.json
starforge receivables-xero prepare --directory /private/accounting --input /private/reviewed-selection.json
starforge receivables-xero detail --directory /private/accounting --id PACKAGE_UUID
starforge receivables-xero receive --directory /private/accounting --id PACKAGE_UUID --input /private/receipt.json --file /private/Invoices.json --format NATIVE_JSON
starforge receivables-xero receive --directory /private/accounting --id PACKAGE_UUID --input /private/result-mapping.json --file /private/returned.csv --format CSV_SUMMARY
starforge receivables-xero correct --directory /private/accounting --id PACKAGE_UUID --input /private/reviewed-correction.json
starforge receivables-xero file --directory /private/accounting --id PACKAGE_UUID --name invoices.csv --out /private/new-invoices.csv
starforge receivables-xero export --directory /private/accounting --id PACKAGE_UUID --out /private/new-handover
starforge receivables-xero export --directory /private/accounting --id PACKAGE_UUID --format tar --out /private/new-handover.tar
starforge receivables-xero export --directory /private/accounting --id PACKAGE_UUID --format json --out /private/new-handover.json
~~~

Use exact filenames from detail for file; import batches may contain several generated files. Source-file flags retain original bytes in name/dataBase64 objects. Existing profiles may omit a template field to preserve that side's original bytes. Output paths must be new absolute paths. Files have owner-only permissions; existing destinations remain intact.

A selection input is:

~~~json
{
  "profileId": "SAVED_PROFILE_UUID",
  "documentIds": ["ORIGINAL_INVOICE_UUID", "ORIGINAL_CREDIT_UUID"],
  "asOf": "2026-10-12"
}
~~~

For a correction preview, add parentId and choose its unresolved document IDs. Preserve the parent's date. Add the actual previewSha256 and mutation envelope to prepare the reviewed result. The correct command receives the parent UUID through --id.

A native JSON receipt input, accompanied by --file and --format NATIVE_JSON, is:

~~~json
{
  "revision": 42,
  "actor": "Operator name",
  "requestId": "STABLE_OPERATION_UUID",
  "organisation": "Exact receiving organisation",
  "receivedAt": "2026-10-12T14:30:00.000Z",
  "format": "NATIVE_JSON",
  "importedStatusValues": ["DRAFT", "AUTHORISED", "PAID"],
  "retiredStatusValues": ["VOIDED", "DELETED"]
}
~~~

An explicit summary CSV mapping input, accompanied by --file and --format CSV_SUMMARY, is:

~~~json
{
  "revision": 42,
  "actor": "Operator name",
  "requestId": "STABLE_OPERATION_UUID",
  "organisation": "Exact receiving organisation",
  "receivedAt": "2026-10-12T14:30:00.000Z",
  "format": "CSV_SUMMARY",
  "columns": {
    "documentNumber": "InvoiceNumber",
    "documentId": "InvoiceID",
    "status": "Status",
    "net": "SubTotal",
    "tax": "TotalTax",
    "total": "Total",
    "currency": "CurrencyCode",
    "error": "Error"
  },
  "decimalSeparator": ".",
  "groupSeparator": "",
  "creditSign": "POSITIVE",
  "importedStatusValues": ["DRAFT", "AUTHORISED", "PAID"]
}
~~~

Replace example headers with exact headers from the returned file. The error mapping is optional. Use the current revision from state and a new operation identity for a new operator action; retain it for an exact retry.

## HTTP and host integration

Default API base: /api/receivables/xero.

| Method | Route | Controller call |
| --- | --- | --- |
| GET | /state | state({asOf}) |
| POST | /profiles | saveProfile(value) |
| POST | /preview | preview(value) |
| POST | /packages | prepare(value) |
| GET | /packages/:id | detail(id) |
| POST | /packages/:id/receive | receive(id,value) |
| POST | /packages/:id/correct | correct(id,value) |
| GET | /packages/:id/files/:name | file(id,name) |
| GET | /packages/:id/export | export(id).value |
| GET | /packages/:id/export?name=handover.tar | Complete original TAR export |
| GET | /packages/:id/export?name=FILE | Exact member of the complete export |

handleXeroReceivablesRequest(controller, request) is the pure adapter. It returns the existing value or file/type envelope, and null outside its API prefix. The parent retains its request and authorization boundary.

xeroReceivablesAsset(path, options) serves assets and per-host route configuration. Options include apiPath, uiPath, receivablesApiPath and receivablesUiPath. Compose original document routes alongside it for line selection. The browser manifest provides these assets to distribution.

createXeroReceivablesHandler(controller, options) provides loopback Host and Origin checks, the JSON request header, 32 MiB encoded body bound, CSP and downloads. It acquires no accounting lease.

prepareXeroReceivablesServer(options) and createXeroReceivablesServer(options) open one accounting workspace, initialize its original ReceivablesWorkspace and create XeroReceivablesWorkspace from that controller. Xero routes run before the parent prefixes. A supplied options.workspace remains owned by its caller. Closing an internally opened service closes that single original workspace.

~~~js
import {XeroReceivablesWorkspace} from './receivables/xero/store.mjs';
import {createXeroReceivablesHandler} from './receivables/xero/server.mjs';

// existingReceivables is the initialized original ReceivablesWorkspace.
const xero = await new XeroReceivablesWorkspace(existingReceivables).init();
const xeroHandler = await createXeroReceivablesHandler(xero, {port});

// Dispatch xeroHandler before the original receivables handlers.
~~~

The default standalone service composes original invoices, customers and statements. A host supplying its own original routes may disable that optional composition with includeReceivables:false and serve those same document routes itself.

XeroReceivablesClient provides typed routes in client.d.ts. Monetary values remain canonical decimal strings. Binary methods return a Response for the caller's chosen destination. Errors carry original status, code, details and request identity. Native receiving uses the shared public/native-json.mjs parser and native-return.mjs adapter in the same cumulative source distribution.
