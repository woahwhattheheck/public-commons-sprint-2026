# Complete customer correction worksheets

The Directory operator can send selected original HSDS rows to a customer as a complete offline worksheet, receive the customer's unchanged returned file, and prepare an explicit correction plan from individually reviewed changes. The same original source, row, member and edition identities remain visible throughout the round.

Open **Customer worksheets** in the installed Directory application. Select an existing frozen edition, browse its original rows, and add each complete row to the worksheet. JSON rows keep their complete lexical object text. CSV rows keep their physical cell order and complete original headers, including duplicate or blank headers and ragged positions. Rows from derived HSDS captures remain eligible, so a later worksheet can continue an accepted edition.

## Operator and customer sequence

1. Give the worksheet a label and actor, select the exact original rows, and prepare it. An optional predecessor is an existing accepted correction whose edition is this worksheet's base.
2. Download the complete portable customer package. It contains the immutable worksheet document, one self-contained customer.html, the original HTML/CSS/JavaScript assets, original records, source files and the complete file manifest.
3. The customer opens customer.html locally. It uses no network connection. Original values are read-only; each proposed whole JSON object or ordered CSV cell array is separate and needs a reason. JSON text is validated without reserializing its numeric tokens. Duplicate object keys are rejected.
4. Save the complete working JSON to preserve unfinished text and later reopen it. Download the returned JSON when the proposals and stated author/time are ready. A row omitted from that return makes no proposal.
5. In the original operator, select the worksheet, intake actor and exact returned file. The operator first stores immutable intake metadata with its SHA-256 and byte length, then uploads the unchanged file through that saved import ID.
6. Review the typed comparison. Choose **accept** or **keep original** for every change and provide an operator reason for each. The original customer reason is retained independently. Complete review prepares an ordinary correction plan; it does not preview or accept it.
7. Open that prepared plan in **Source corrections**. Build its candidate preview, review original and derived files and comparison, then explicitly accept the exact candidate. Export the complete correction or editable workspace for receiving.

All-kept review is a complete outcome with planId null and no-edits-selected. It does not create an empty artificial correction.

## Presence and type meaning

The comparison distinguishes an absent JSON field from a present null. Object fields are compared recursively with relative RFC6901 pointers. Arrays are complete atomic values; added or removed objects are also atomic, so reviewing one change cannot implicitly reindex another element. Numeric spelling remains part of the lexical value.

For CSV rows with the same number of physical cells, differences are individual zero-based columns. A changed cell count is one complete csv-row proposal. This preserves the meaning of ragged rows without treating omission of a physical position as an implicit shift. A full row and every unchanged cell remain available in the original worksheet file.

## Immutable records and complete files

| Collection | Meaning | File kinds |
| --- | --- | --- |
| correctionWorksheets | Selected exact source rows and original worksheet basis | input, rows; worksheet generates the complete immutable document |
| correctionWorksheetImports | Saved original intake metadata | input |
| correctionWorksheetReturns | Exact original returned bytes and proposed typed changes | original, changes |
| correctionWorksheetReviews | Every explicit decision and the prepared plan, if any | input, decisions |

The generated worksheet document uses the saved final worksheet ID. The package is an ordinary exports record with kind correction-worksheet; it is not embedded in the worksheet record. This avoids a circular content identity. Download it through the existing exports file route.

All row, change and decision files are complete JSONL. Pages have at most250 rows and4MiB. A single larger row remains available in its original full file. The operator's **Receive complete row file** checks the native byte count and SHA-256, then makes every complete row available for review. Files are never abbreviated to fit a page.

Limits: selected rows and returned changes10,000; input and original returned file32MiB; selected JSON value or complete CSV cells array16MiB; worksheet document/rows64MiB; complete changes/decisions256MiB. The original complete connected-file limit remains512MiB and the native editable archive limit2GiB.

## HTTP and native CLI

The installed catalogue directory-correction-worksheets-schema.json is authoritative. All four JSON inputs are strict objects.

| Operation | HTTP | CLI |
| --- | --- | --- |
| Prepare | POST /api/directory/correction-worksheets/prepare | correction-worksheet-prepare --input INPUT.json |
| Export portable package | POST /api/directory/correction-worksheets/export | correction-worksheet-export --input INPUT.json |
| Save intake | POST /api/directory/correction-worksheets/imports | correction-worksheet-import --input INPUT.json |
| Receive unchanged file | PUT /api/directory/correction-worksheets/imports/ID/content | correction-worksheet-receive --import-id ID --file RETURN.json |
| Review every change | POST /api/directory/correction-worksheets/review | correction-worksheet-review --input INPUT.json |
| Whole worksheet document | GET /api/directory/correctionWorksheets/ID/document | correction-worksheet-document --id ID |

Every native CLI command also takes --workspace ABS. Use the original Python entry fhir_directory/cli.py or the installed human-services-directory command.

Rows use GET /api/directory/COLLECTION/ID/rows?offset=0&limit=50 with optional rowKey and state. State is original, proposed, accept or keep-original. The CLI is rows --kind correction-worksheet --collection COLLECTION --id ID --offset 0 --limit 50, with optional --row-key and --state.

Files use GET /api/directory/COLLECTION/ID/files/KIND. The CLI is file --kind correction-worksheet --collection COLLECTION --id ID --member KIND --out NEW_FILE. Complete package bytes use the ordinary file --kind export --id EXPORT_ID --out NEW_ZIP.

## Typed SDK, MCP and complete-file recovery

Four body actions expose the exact native schemas:

- directory_correction_worksheet_prepare, key correction_worksheet_prepare.
- directory_correction_worksheet_export, key correction_worksheet_export.
- directory_correction_worksheet_import, key correction_worksheet_import.
- directory_correction_worksheet_review, key correction_worksheet_review.

The raw action directory_correction_worksheet_receive takes workspace, saved importId, host-declared input and optional expectedSha256. A declared input must already exist when the connection is opened. Preserve its exact bytes and hash.

The typed receiveHumanServicesDirectoryWorksheet helper accepts either a full profile or a previously saved importId and returns the immutable native return plus the intake identity. On an uncertain result, error details retain that same import and host alias. Repeat with the exact original file; never substitute a newly authored proposal under an old binding.

Read helpers expose complete records and contiguous pages. downloadHumanServicesDirectoryWorksheetFile binds every original payload to the saved native descriptor and uses the maintained complete-file receiver. For an oversized page, download the full rows, changes or decisions JSONL. downloadHumanServicesDirectoryWorksheet prepares and receives the complete customer package. Generic manifests, range reads, download resume and reopening remain available.

The two original connected transport defaults remain4MiB for unrelated actions. Only the explicit directory_correction_ family has a32MiB native JSON allowance, covering corrections and worksheets. For a large prepared input, declare the complete file as a host input and use input_apply with its action and exact SHA. Carrier limits for an individual MCP request are not a reason to rewrite or split the native input.

## Working copies and uncertain requests

The operator retains the full accepted request before dispatch. A pending request cannot be replaced by selecting another saved intake. After an interrupted raw upload, reselect the same file and use **Resume exact pending request**. Its byte length and SHA must match. Immutable native request replay reconciles the original result.

Working JSON preserves selected refs, labels, intake metadata, explicit decisions and original pending request. Malformed imports are validated before replacing the existing draft. Inputs are frozen during awaited operations. Disposed views cannot overwrite a newer working copy. If browser storage is full, download the complete working JSON and keep the original returned file separately.

The native receiver verifies worksheet selections, exact returned bytes, all derived typed differences, every review decision and the corresponding existing correction plan. Earlier complete registry editions retain their original compatibility sets. Receiver-local import receipts retain their separate native meaning.

## Whole operating courses

[CORRECTION_WORKSHEETS_OPERATING.md](CORRECTION_WORKSHEETS_OPERATING.md) operates two original native worksheet rounds, an explicit all-kept alternative, exact request replay and complete cold receiving.

[CORRECTION_WORKSHEET_CLIENTS.md](CORRECTION_WORKSHEET_CLIENTS.md) operates the actual offline customer editor and private operator, full SDK/MCP originals, Merchant reopen and a fresh customer workspace. A published programme is source evidence. Actual completion is represented by its completed result, original journal and exact saved packet.

## A returned worksheet from an older edition

Open its saved return and choose **Review against current edition**. [Three-way review](WORKSHEET_RECONCILIATION.md) retains the complete original proposal, explicitly matches original/current rows, and presents base, customer and current values together. Every change requires a decision. Reviewing prepares a plan on the selected current edition; it does not preview or accept a source correction.
