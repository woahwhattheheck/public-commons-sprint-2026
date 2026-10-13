# Bulk ledger intake

Use **Delivery operations → Bulk ledger intake** to bring complete contributor, work, supplier-invoice and observed-cash tables into the original Grant Operations case. The desk retains the selected files exactly, shows the native record that each source row will create or replace, and records the complete intake in one transaction.

The same workflow is available through the original HTTP service, CLI, typed client and Merchant MCP provider. The browser uses the existing case, source attachments, record commands and history. The selected plan revision continues to supply the original cost-package IDs and financial rules.

## Record a complete intake in the browser

1. Open the retained Operations case and enter its recording operator. Select **Bulk ledger intake** and give the intake a useful title, such as the source system and accounting period.
2. Choose the kind of table and select its original files. CSV, TSV and JSON tables are supported. Add separate invoices, valuation records or other documents as **Supporting attachment** files. Every file remains downloadable in the draft and is retained as a native case source when the intake is applied.
3. Select each file in the left-hand list. Check its kind, format, original filename, source URL and observation time. Use **Inspect columns** to see its original headers, mapped examples and columns that are not being imported. Map native fields to their original columns; use **Ignore** for a column that must not populate the corresponding native field.
4. Enter any table defaults as JSON. Defaults supply native values when a table does not contain them. The desk keeps the full text while it is edited and reports malformed JSON before previewing. Use the reference panel to find existing contributors, work, invoices, sources and the case's pinned cost packages.
5. Select **Preview complete intake**. Review the total files and records, every input error, and the full before-and-after record values. Filter or page the list to inspect a large intake; the downloaded preview includes the complete result. The preview binds the exact files and mapping to the selected case version.
6. Select **Record complete intake**. All original files, all native row changes and the original input-to-record map are saved together. A failure rolls back the complete intake. A successful result identifies the saved source document and every resulting native record.
7. Continue in **Work**, **Invoices**, **Cash / issuer** or **Budget performance**. Use **Recorded intakes** to reopen every original file and its record mapping. Use **Export complete case** for the normal receiving handover.

The CSV and TSV template buttons download headers for the selected record kind. Fill those templates with actual source values, or map an existing export without rewriting it.

## Original input document

A portable input uses this shape:

~~~json
{
  "schema": "stellar-forge.sf47-ledger-intake.v1",
  "title": "Source system and period",
  "files": [
    {
      "id": "work-file",
      "filename": "work.csv",
      "kind": "work",
      "format": "csv",
      "contentBase64": "<complete original file bytes, base64 encoded>",
      "mapping": {
        "key": "Entry ID",
        "description": "Description",
        "hours": "Hours"
      },
      "defaults": {
        "fundingBasis": "PREAWARD"
      }
    }
  ]
}
~~~

The angle-bracket value above is a placeholder. The browser fills it from the selected file; the CLI builder reads the explicitly selected local file. The server accepts the original bytes directly and does not open a path supplied in an HTTP request.

| File property | Meaning |
| --- | --- |
| `id` | A distinct file key within this input. Use letters, digits, dot, underscore, colon or dash; begin with a letter or digit. |
| `filename` | The original plain filename, without a directory path. |
| `kind` | `contributors`, `work`, `invoices`, `cash` or `source`. |
| `format` | `csv`, `tsv`, `json` or `binary`; binary is available for supporting attachments. |
| `contentBase64` | The complete original bytes. Retained source hashes are calculated from these bytes. |
| `mapping` | For CSV/TSV, native field name to original header. A `null` value explicitly ignores that native field. |
| `defaults` | Native values applied before each table row. A populated row value takes precedence. Set each `key` and existing `id` in the row itself. |
| `sourceUrl` | Optional original HTTP(S) source URL. |
| `observedAt` | Optional original timestamp including its timezone. |
| `mediaType` | Optional plain MIME type. The file format supplies a default. |

CSV and TSV must be UTF-8, with an optional UTF-8 byte-order mark. The parser preserves the bytes, validates quoting and requires distinct, nonempty headers. A native field with the same name as a header is selected automatically unless its mapping overrides or ignores it. Blank cells leave the field's default in place; a field without a value or default receives its original native handling.

JSON tables use native field names and contain either a nonempty array of records or an object whose only property is `records`, containing that array. They support the same defaults and reference syntax. Duplicate JSON object keys and non-finite numbers are rejected. Use decimal strings for money and quantities; decimal numbers in original JSON table bytes are parsed without binary floating-point rounding.

A supporting file uses `kind: "source"` and an empty mapping/defaults object. It contributes source bytes and can be referenced from another table. At least one contributor, work, invoice or cash record is required to apply an intake.

## Native fields and financial meaning

Every record kind accepts optional `key`, `id`, `sourceIds` and `sourceNote`.

| Kind | Native fields |
| --- | --- |
| Contributors | `name`, `kind`, `contact`, `note`. Contributor kind is `PERSON`, `ORGANIZATION`, `TEAM` or `ROLE`. |
| Work | `contributorId`, `costId`, `description`, `startDate`, `endDate`, `hours`, `fundingBasis`. Funding basis is `PREAWARD`, `GRANT`, `CUSTOMER` or `INTERNAL`. |
| Supplier invoices | `contributorId`, `number`, `issuedDate`, `dueDate`, and `lines`, or grouped `line.*` columns. Native invoice amounts are USD. |
| Observed cash | `direction`, `category`, `date`, `currency`, `network`, `asset`, `amount`, `usdValue`, `valuationSourceIds`, `valuationNote`, `externalRef`, `tranche`, and `allocations`, or grouped `allocation.*` columns. |

Work dates and invoice/cash dates use `YYYY-MM-DD`. Work hours are positive decimal quantities with up to four decimal places. Supplier invoice lines and USD allocations are positive amounts with up to two decimal places. Work and invoice cost IDs must name packages from the case's pinned plan revision.

Cash uses a positive original quantity and separate `IN` or `OUT` direction. Its categories are `GRANT`, `INVOICE`, `CUSTOMER`, `CAPITAL`, `REFUND` and `OTHER`. The original network, asset and external payment reference identify an observation. A repeated active payment identity is rejected by the original cash command.

For USD cash, the original amount determines its USD value. A non-USD asset keeps its original quantity; an optional recorded USD value, valuation sources and valuation note supply the financial valuation. Invoice allocations require a recorded USD value and cannot exceed it. Allocate an outflow to supplier invoices, or use an actual refund inflow. A grant receipt is an inflow.

An export with signed amounts or different source categories needs an explicit native table that expresses those values correctly. Retain that export as a supporting file and reference it from the native table. Column mapping selects original values; it does not silently change signs, convert currencies or infer payment events.

### New records and complete replacements

Omit `id` to create a record. Set `id` only when deliberately replacing an existing original record. The replacement is the complete native record input, so include every field and any prior source links that should remain.

The preview shows the existing `before` record and full prepared `after` values. One intake can replace a given retained record once. New contributors are active, new work is `LOGGED`, and new supplier invoices are `RECEIVED`. Existing work must be in its editable logged state, and an existing invoice must be in its editable received state. Continue submission, acceptance, review, dispute or reopening through the normal case controls.

Cash observations use the original immutable lifecycle. Correct an erroneous retained observation with the normal void/correction workflow. Every native record created by the intake retains its own case version and original history event.

## Link rows, source files and existing records

A record's optional `key` provides a stable reference inside the complete input. A value such as `@supplier-a` selects the row whose key is `supplier-a`. Keys are distinct across all files in an intake. Without an explicit key, the parser uses the file key and source row position, such as `work-file:2`.

Use retained IDs directly when linking existing records. Contributor IDs have the original `person-` prefix; work and invoice IDs retain their native prefixes. The browser's reference panel exposes those exact IDs.

The intake processes contributors, then work, then supplier invoices, then cash. It therefore resolves these links across files:

| Field | Supported target |
| --- | --- |
| Work/invoice `contributorId` | Existing contributor ID or `@contributor-row-key`. |
| Invoice line `workIds` | Existing work IDs or `@work-row-key` values. |
| Cash allocation `invoiceId` | Existing invoice ID or `@invoice-row-key`. |
| `sourceIds`, `valuationSourceIds` | Existing source IDs or `@file:file-key` values. |

Array fields are native JSON arrays. In CSV/TSV cells, enter their JSON text using the file format's ordinary quoting rules. The array fields are `sourceIds`, `valuationSourceIds`, `lines`, `allocations` and `line.workIds`.

Every record is automatically linked to its own original table file. Its source note also carries the intake title, file key and contributing row positions. Additional supporting files are linked explicitly, for example:

~~~json
{
  "sourceIds": ["@file:original-invoice"],
  "valuationSourceIds": ["@file:valuation-record"]
}
~~~

References are resolved only in the native reference fields. An `@...` string in an ordinary description remains ordinary source text.

## Group invoice lines and cash allocations

A supplier-invoice CSV can contain one line per source row. Use the same explicit `key` for all lines belonging to one invoice, repeat the same invoice header fields, and supply:

~~~text
line.id
line.costId
line.description
line.amountUsd
line.workIds
~~~

The grouped rows become one native invoice with its complete `lines` array. Invoice line IDs must be distinct within that invoice. A missing line ID receives a row-based line ID. A repeated invoice key with a different contributor, number, date, source note or other header is rejected, allowing the operator to resolve inconsistent source rows before recording them.

Cash can similarly use one source row per invoice allocation:

~~~text
allocation.invoiceId
allocation.amountUsd
~~~

Repeat the cash key and identical cash header values, including the original payment reference and full cash amount, on each allocation row. The amount is the total original payment, while each allocation amount is that invoice's share. The grouped result is one cash observation with a complete allocation array.

Use either the native `lines`/`allocations` array or its grouped columns for a record. Repeated keys without grouped columns are rejected. A native cash observation can allocate to each invoice once, and the original financial validator evaluates the complete total.

## Drafts, interrupted responses and previous intakes

The browser uses an optimistic stored revision so concurrent tabs cannot silently overwrite each other's full draft. On a conflict, this tab keeps its complete input and pending request available to download. **Download this draft and open saved draft** preserves the current input before reopening the other tab's saved edition.

The browser retains the full desk by case in IndexedDB: original file bytes, mapping, defaults text, current selection, note, returned result and any pending request. Switching sections or closing the desk preserves the pending operation. The dispatched mutation uses the original application transport, so the result can still be retained after the visible section is disposed.

Use **Download complete draft** to move the desk or keep an explicit local copy. **Download original request** retains the same complete desk with its pending body and request identity. Opening that file in the same case restores the original retry. Opening a desk for another case keeps the input files for a new review.

If the response is interrupted, use **Retry original intake**. It sends the unchanged input, reviewed version, preview digest and request ID. The original workspace transaction returns the first successful result for that request. A definite rejected request releases the draft for correction and a fresh preview; a transport failure keeps the original request available.

After recording, the case retains a JSON source named `ledger-intake-<input-digest-prefix>.json`. It contains the original file specifications, source IDs, source byte counts and hashes, source row groups, record IDs, per-record versions, recording operator and request ID. Its original files live in the same native source store. **Recorded intakes → Open original intake** reconstructs the complete input from those retained bytes.

The exact same complete input is recognized as already recorded in that case. Different input documents still pass the native duplicate-invoice and duplicate-payment rules. Record keys are local to the input; they do not guess an existing contributor from a display name.

## CLI

Use the normal CLI entry point with the retained workspace directory. These examples run from `stellar/scf_2026/sf47_budget_model/workspace`. Close the original browser server before opening its workspace through the headless CLI; use the HTTP or typed client to operate an already running server. Set `LEDGER_CASE_ID`, `LEDGER_CASE_VERSION` and `LEDGER_PREVIEW_SHA256` to the actual selected case and reviewed preview values, and select your own private paths and recording operator.

First inspect the current case and available intake contract:

~~~sh
python3 cli.py operations --workspace /absolute/private/grant-workspace ledger-intake \
  --case "$LEDGER_CASE_ID" \
  --output /absolute/private/intake-contract.json
~~~

Create header templates with `ledger-intake-template --kind contributors|work|invoices|cash --format csv|tsv --output <new-file>`.

A CLI build specification uses the same input schema and explicit `sourceFile` paths in place of each file's `contentBase64`. A relative source path is resolved against the build specification's directory.

~~~json
{
  "schema": "stellar-forge.sf47-ledger-intake.v1",
  "title": "Selected original accounting export",
  "files": [
    {
      "id": "suppliers",
      "sourceFile": "./suppliers.csv",
      "kind": "contributors",
      "format": "csv",
      "mapping": {
        "key": "Supplier key",
        "name": "Supplier name",
        "kind": null
      },
      "defaults": {
        "kind": "ORGANIZATION"
      }
    }
  ]
}
~~~

Compile the selected files once, then preview and apply the same compiled document:

~~~sh
python3 cli.py operations --workspace /absolute/private/grant-workspace ledger-intake-build \
  --input /absolute/private/intake-spec.json \
  --output /absolute/private/intake-document.json

python3 cli.py operations --workspace /absolute/private/grant-workspace ledger-intake-preview \
  --case "$LEDGER_CASE_ID" \
  --input /absolute/private/intake-document.json \
  --output /absolute/private/intake-preview.json

python3 cli.py operations --workspace /absolute/private/grant-workspace ledger-intake-apply \
  --case "$LEDGER_CASE_ID" \
  --input /absolute/private/intake-document.json \
  --expected-version "$LEDGER_CASE_VERSION" \
  --expected-preview-sha256 "$LEDGER_PREVIEW_SHA256" \
  --actor "Recording operator" \
  --request-id ledger-intake-original-request \
  --note "Original source system and period" \
  --output /absolute/private/intake-result.json
~~~

Use the preview's `case.version` and `previewSha256`. If applying is interrupted, repeat the same command and original request ID. Choose a fresh output filename if the previous output file already exists.

`ledger-intake-original --case <id> --source <recorded-source-id>` returns the saved recipe, full original file document and recorded map. Add `--document-only` to write the reconstructed input directly. Preview and apply also accept a downloaded browser desk and read its retained defaults text.

CLI output files use the existing private, create-only publication helper. The compiled document and any downloaded desk contain the original source bytes; keep them with the original case's private materials.

## HTTP and typed client

All HTTP paths below are relative to `/api/operations/{caseId}` and use the original workspace authentication.

| Method and path | Request and result |
| --- | --- |
| `GET /ledger-intake` | Current case identity, native fields, CSV/TSV templates, limits and previous intake summaries. |
| `POST /ledger-intake-inspect` | Body `{file}`; complete selected file specification. Returns original headers, source metadata, mapped sample and unmapped columns. |
| `POST /ledger-intake-preview` | Body `{document, expectedVersion?}`. Returns the complete preview, errors, before/after rows, summary and preview digest. |
| `POST /ledger-intake-apply` | Body `{document, expectedVersion, expectedPreviewSha256, actor, note?, requestId}`. Returns the source and record map after the entire transaction commits. |
| `GET /ledger-intakes/{sourceId}` | Saved source metadata, recorded recipe and reconstructed original input. |
| `GET /export.zip` | Existing complete operating-case export, including intake originals and history. |

The typed `GrantWorkspaceClient` exposes the same operations:

~~~js
const contract = (await client.read('ledger-intake', {caseId})).value;
const preview = (await client.ledgerIntakePreview(caseId, {document})).value;

if (!preview.canApply) {
  throw new Error(preview.errors.map(row => row.message).join('\n') ||
    'This exact complete input is already recorded.');
}

const originalBody = {
  document,
  expectedVersion: preview.case.version,
  expectedPreviewSha256: preview.previewSha256,
  actor,
  note,
  requestId
};
const receipt = (await client.ledgerIntakeApply(caseId, originalBody)).value;
const original = (await client.read('ledger-intake-original', {
  caseId,
  sourceId: receipt.sourceId
})).value;
~~~

Retain `originalBody` before dispatch and reuse it unchanged to recover an interrupted response. `ledgerIntakeInspect(caseId, file)` provides the column inspector. The client declarations include the complete input, inspection, preview, receipt, recorded source and reopened-original types.

## Merchant MCP

The existing configured Grant workspace supports:

- `merchant_grant_ledger_intake`
- `merchant_grant_ledger_intake_original`
- `merchant_grant_ledger_intake_inspect`
- `merchant_grant_ledger_intake_preview`
- `merchant_grant_ledger_intake_apply`

All select the original `workspace` alias and `caseId`. The original read additionally selects `sourceId`.

Inspect supplies one file object; preview and apply supply the complete intake document. Use `inputs` for an inline native object, or `input` plus `expectedInputSha256` for an existing host input, snapshot or completed transfer. `inputPointer` can select `/document` from a retained original response or downloaded desk. The provider verifies the complete referenced bytes before selecting the object.

Apply also supplies `expectedVersion`, `expectedPreviewSha256`, `actor`, `requestId` and optional `note`. Original responses use the provider's existing retained snapshots and full row/byte paging. The native case export remains available through the existing export and download controls.

## Capacity and complete receiving

An intake accepts at most 20 source files, 12 MiB of original source bytes, 5,000 source table rows and 1,000 resulting native records. Each original attachment must also fit the existing 8 MiB single-source limit. The original case retains its 200-source, 24 MiB source-store and 5,000-record limits; preview includes the complete recipe and required source capacity before allowing a save.

The HTTP service retains its existing 32 MiB request limit, which includes base64 and metadata. The browser and CLI accept a downloaded desk up to 64 MiB so its original pending request can travel with the editable input. The CLI then extracts the single native document and enforces the original 32 MiB request bound.

Use the complete case export to receive the work in another workspace. Import through the existing case importer, open the receiving case, select **Bulk ledger intake**, and reopen the recorded input. Source IDs, original file hashes, input recipe, row mapping and the original native records travel together. The selected receiving case can then generate its own [Budget performance](PERFORMANCE.md) report and complete period handover.

Both managed launch readers include the intake engine and its mounted browser files in the installed source selection. Adopt the full release before opening the retained workspace. The source selection already carries the complete Grant Operations component and this guide.

## Maintained source

- [Ledger engine](operations_ledger_intake.py), [operator desk](operations_ledger_intake.mjs) and [styles](operations_ledger_intake.css).
- [Original operations owner](operations.py), [native business rules](operations_domain.py), [HTTP adapter](operations_http.py) and [CLI](operations_cli.py).
- [Typed client](agent-client.mjs), [declarations](agent-client.d.mts), [managed Python source](managed_launch.py) and [managed Node source](launch.mjs).
- [Grant Operations installed guide](../../../../products/grant-operations/OPERATING.md).
