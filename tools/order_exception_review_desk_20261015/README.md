# Order Exception Review Desk

A complete local workspace for comparing order snapshots, reviewing incoming requests and retaining human decisions.

## Open and use

Open `Order_Exception_Review_Desk.html` in a browser with IndexedDB and Web Crypto support. Select **New workspace**. The standalone HTML contains its complete application code and makes no network requests.

1. Import an actual UTF-8 order CSV/TSV or a JSON array of flat objects. JSON object keys must be unique; numeric cells must be exact safe base-10 integers. Export decimal/exponent values, negative zero and long numeric identifiers as quoted strings. Choose its role, source system, export/receipt time and declared source period. Original text, including a UTF-8 BOM and line endings, remains retained.
2. Select the original file and declare its company/ledger scope, order-level or order-plus-line grain, and exact source columns. Enter comparison mappings one per line, such as `quantity=Qty`, `unit=UOM`, `promised_date=Promise Date` and `status=Status`. Both snapshots must describe the same company and grain. At least one comparison field is required.
3. Import and map a later order snapshot. **Compare snapshots** identifies changed, unchanged, new, missing and ambiguous keys. Missing rows describe only the supplied files. Review the original source before interpreting cancellation, shipment or fulfilment.
4. Import a request export as CSV/JSON. It may include message ID, date, sender, order, line and full request text. Map its company and order/line keys. The desk proposes unique exact-key matches; it never accepts them on behalf of the operator.
5. Read the original request and order rows. Record one explicit binding with the reviewer and reason. A single request can deliberately refer to several order rows.
6. Start a decision case from a binding or comparison. Record the complete proposed disposition and why it is needed. Append approval, then an observed result bound to a later original record, then closure. Carry out any business-system action through its ordinary authorized process.
7. Download the **complete editable workspace**. It contains all original source text, parsed rows, mappings, bindings, decisions and the entire operation history. Open that JSON in the same HTML desk to create a separate continued workspace. The original local workspace remains available.

Use the source filter and original row numbers to inspect large files. The comparison view displays up to100 filtered results; narrow the key/value filter for the desired records. Request suggestions display the first100; the explicit-binding form can select any original row number.

## Decision meaning

- **Proposed:** a reviewer has written an intended disposition.
- **Approved:** the recorded reviewer accepted the current proposal.
- **Observed:** an operator recorded the result and linked one or more original source rows.
- **Closed:** the observed result or rejection was reviewed.
- **Rejected:** the reason for rejecting the disposition is retained.

These are authored review records. Reviewer text is not an authenticated electronic-signature service. Every version remains available. A changed proposal starts a new proposed version. An older browser view cannot silently overwrite a newer decision version.

## Source and matching contract

Source values preserve spelling, spaces, case and JSON scalar type. Order identifiers retain leading zeros in CSV/string values. Numeric JSON identifiers cannot recover zeros absent from their original export. Company scope is explicit and part of every exact match. Duplicate keys are ambiguous; the desk does not guess which duplicate is authoritative.

No date, timezone, quantity or unit conversion occurs. For example `12` and `12.0` remain different original CSV values. Review the source's units, site, timezone and effective period with its owner. A column mapped in only one snapshot is visibly reported as a mapping difference.

Once a source mapping is used in a retained binding or decision, its interpretation stays fixed. To correct it, import another source identity and declare the corrected mapping; preserve the prior review as history. Original files can always be downloaded individually.

## Persistence and recovery

Unfinished mapping, binding and decision fields are retained exactly, including incomplete or invalid text, separately for each selected source/review. A selected original file is retained byte-for-byte even before successful parsing. These drafts and pending bytes travel in the complete workspace download. Draft changes save after a short debounce; navigation preserves the drafts, and accepted business edits first flush pending writing. Text typed during an accepted-operation save remains retained; only an unchanged submitted form is cleared.

Each accepted edit is saved to IndexedDB before being acknowledged. A second tab that saves a newer revision causes a conflict instead of replacement. If browser storage fails, the complete in-memory copy remains downloadable and the page warns before closing. Download it and reopen it as a separate workspace to continue.

Portable files contain a SHA-256 of canonical workspace JSON and each original source. Opening verifies the complete workspace, original hashes and parsed table equality. Checksums establish byte consistency, not the identity of an author. Original source bodies live once in the sources collection. New source events point to their retained identity and checksum. Draft events retain view, form-key and pending-file metadata; the writing collection retains the complete current unfinished text and pending bytes. Prior imported events and all decision versions remain unchanged. The JSON is readable and complete; share it according to the sensitivity of the original operating records.

Each original source can contain up to24MiB,50,000 rows and200 columns. Complete portable files have no separate application size cutoff: receiving capacity depends on the available browser or Node.js memory. Failed parsing or checksum validation leaves the current workspace unchanged. For large operational extracts, agree a coherent source period/company export that includes the records needed for the review.

## Native tools

Requires Node.js with the built-in modules used by the CLI. Keep the CLI and core beside one another:

```text
node verification/operating-course.cjs
node verification/unfinished-writing-course.cjs
node order-review-cli.cjs inspect Order_Review_<id>_r14.json
node order-review-cli.cjs compare Order_Review_<id>_r14.json <before-source-id> <after-source-id> comparison.json
node order-review-cli.cjs sources Order_Review_<id>_r14.json extracted-originals
node order-review-cli.cjs decisions Order_Review_<id>_r14.json decision-history.csv
```

`inspect` reports original IDs, mappings and current reviews. `compare` uses the same production core as the browser. Source extraction prefixes each filename with its original source identity and sanitizes the display filename. Outputs are create-only; an identical existing file can be reused, while different bytes require another path. New files are flushed and published through a same-directory hard link; directory sync is used on POSIX. The native source is included for an equipped operator.

## Delivery contents

- `Order_Exception_Review_Desk.html`: self-contained application.
- `order-review-core.cjs`: the complete production comparison and decision engine embedded in the HTML.
- `order-review-cli.cjs`: native inspect/compare/extract/CSV commands.
- `Blank_Order_Review_Workspace.json`: complete empty starter file.
- `README.md`: this operating guide.
- `verification/`: one whole authored operating course, its exact result and complete exported course workspace.

The verification course exercises the actual production core: four originals,13 rows, two order snapshots, request ambiguity/company separation, explicit binding, proposed/approved/observed/closed/amended history, complete file reopen and ordinary CSV reopen. It was executed in V8 with an explicit SHA-256 codec. The exact unfinished-writing controller also ran through invalid-form retention, concurrent draft and accepted-operation saves, view change and an unparseable pending original using explicit DOM/storage/timer adapters. Duplicate JSON keys and lossy numeric cells are rejected by the shared lexical parser. The browser script blocks were syntax-compiled. The equipped-operator course covers native filesystem operations and rendered-browser normal use. Record those actual results against the exact outgoing version when they are completed.

## License

The application, native tools and authored operating examples in this directory are available under the [MIT license](LICENSE). Original operating files imported by a user retain their original ownership and sharing restrictions.
