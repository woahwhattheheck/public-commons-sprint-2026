# Customer service reviews

A customer service review is an immutable handover built from selected records already saved in this OpenLineage workspace. It retains the operator's title, customer, period, scope, narrative and attribution alongside complete Service Levels assessments, Quality evaluations and comparisons, incident decisions, dispositions, follow-up histories, original source locations and evidence-file identities.

The review does not evaluate events again or change an incident, rule, policy or follow-up. Use the original Service Levels and Quality desks for those actions. The operator-entered period explains the handover; it does not silently remove selected records that were saved outside that period.

## Open the existing workspace

Use the existing installed OpenLineage command and the original workspace directory or authenticated host. The customer review page is `customer-service-review.html`; the operator guide is [CUSTOMER_SERVICE_REVIEW_OPERATOR.md](CUSTOMER_SERVICE_REVIEW_OPERATOR.md). Service Levels and the existing reports remain available.

Start with `openlineage customer-review status --workspace DIRECTORY`. It returns the current workspace ID/revision, lightweight headers for all selectable original records, and saved customer-review headers. The overview does not transfer every complete historical customer review. Open an individual original or saved review explicitly.

An HTTP connection uses `--url URL` in place of `--workspace DIRECTORY`. Use a private `--token-file FILE` when required and retain `--expected-workspace-id ID` and `--instance-id ID` for an already selected host. These are the original server identity and bearer-token mechanisms. Tokens are not written into review documents, prepared request files or exported reports.

## Select a complete review document

The document schema is `commons.openlineage.customer-review-document.v1`. Required operating fields are:

| Field | Meaning |
| --- | --- |
| title | Name of this saved handover |
| customer | Operator-entered customer or receiving team |
| periodStart, periodEnd | Real YYYY-MM-DD dates, with start no later than end |
| scope | What this selection covers, including exclusions or limitations |
| narrative | Optional full customer narrative; omitted means an empty string |
| recordedBy | Attribution entered by the operator |
| assessmentIds | Distinct original saved Service Levels assessment IDs |
| evaluationIds | Distinct original saved Quality evaluation IDs |
| comparisonIds | Distinct original saved Quality comparison IDs |
| resultIds | Distinct original retained result-file IDs |
| supersedes | null for a first review, or the exact previous review ID and contentSha256 |

Select at least one original record across the four ID arrays. Empty arrays are valid. Selection order and entered text remain in the document. The native writer rejects unknown fields, duplicate IDs, absent originals and invalid dates.

To add another edition to a review, select its current saved head through `supersedes: {id, contentSha256}`. The prior body remains immutable. A second successor of the same head is rejected, so another operator's later edition must be inspected before continuing that lineage. A separate first review can cover a different customer, period or purpose.

## What the preview retains

`customer-review.preview` freezes the selection against one committed workspace revision. It includes:

- Every explicitly selected assessment, evaluation, comparison and result descriptor.
- Both original evaluations for every selected comparison.
- The incident snapshots connected to selected assessment findings, including their complete recorded decision histories and the supporting assessments referenced by those histories.
- Disposition snapshots for the selected and supporting evaluations.
- Every follow-up snapshot for the selected comparisons, including full prior versions, attribution, due dates, reasons and exact earlier disposition references.
- All evidence results referenced by any retained follow-up version.
- The original editions, source descriptors and event records needed by that complete selection.

The preview's `document` remains the exact explicit selection; additional supporting originals appear under `originals`. Counts describe complete retained arrays. They are not risk scores or inferred improvements.

Mutable incident, disposition and follow-up heads are reconstructed from their original committed operation receipts at `sourceRevision`. Saving a later native decision does not alter an earlier customer review. Deep receiving reconstructs the same historical snapshot and checks it against the saved preview, so merely replacing a frozen history while recalculating its outer checksum is insufficient.

Each original header includes `sha256`, the digest of its complete original row. `customer-review.original` requires this exact digest. Saved evaluations and comparisons also retain their own native content hashes; the two identities have different purposes and are not substituted for one another.

## CLI preparation and same-request recovery

The full command names are:

```text
openlineage customer-review status --workspace DIRECTORY
openlineage customer-review preview --workspace DIRECTORY --input DOCUMENT.json --out NEW_PREVIEW.json
openlineage customer-review prepare --preview PREVIEW.json --expected-preview-sha256 HASH --operation-id ID --out NEW_REQUEST.json
openlineage customer-review request --workspace DIRECTORY --request REQUEST.json --expected-request-sha256 HASH
openlineage customer-review save --workspace DIRECTORY --request REQUEST.json --expected-request-sha256 HASH --out NEW_RECEIPT.json
openlineage customer-review resume --workspace DIRECTORY --request REQUEST.json --expected-request-sha256 HASH --out NEW_RECEIPT.json
openlineage customer-review show --workspace DIRECTORY --id REVIEW_ID --out NEW_REVIEW.json
openlineage customer-review report --workspace DIRECTORY --id REVIEW_ID --format html --out NEW_REPORT.html
```

Use your actual selected file paths, original IDs and returned hashes. The first preview command writes the full preview and returns its file descriptor and native `previewSha256`. Inspect that complete preview before preparing the save.

`prepare` needs no live workspace or server. It validates the complete preview and writes a create-only request containing the original document, revision, operation ID, preview hash and full preview. It returns `requestSha256`. Retain that file before the native save. Preparing a file performs no workspace mutation.

`request` is read-only reconciliation. It scans the original operation journal at one current revision for that exact operation ID and original native request hash. A found result is the original immutable receipt. A different body with the same ID is a conflict.

`save` and `resume` both reconcile first. They reuse a found accepted receipt, or submit the same original request when it is absent. They do not generate another operation ID, replace the preview or silently update the expected revision. A workspace change can reject the original compare-and-swap save; inspect the current originals and explicitly prepare new reviewed work only after the original request's outcome is known.

A network failure or receipt-output failure can happen after acceptance. Retain the full request and use `request` or `resume`; do not infer rejection from a missing local receipt. The CLI verifies the complete accepted preview, operation ID, saved revision and review content hash before writing the receipt.

Output files are create-only with private permissions for new files. Reopening an identical complete output is allowed and synchronizes its parent directory. A different existing file is left intact and rejected. Ordinary input files are read through one retained handle with before/after identity checks. Full preview/request/report size is governed by the actual file and available memory, not an arbitrary truncation limit.

## Native and typed interfaces

All six actions use the existing `POST /api/action` owner:

| Action | Arguments | Result |
| --- | --- | --- |
| customer-review.overview | {} | workspaceId, revision, lightweight choices and saved-review summaries |
| customer-review.original | kind, id, expectedSha256 | complete exact original plus workspace/revision identity |
| customer-review.preview | document | complete frozen preview and previewSha256 |
| customer-review.save | operationId, expectedRevision, document, expectedPreviewSha256 | original receipt with complete customerReview |
| customer-review.get | id | complete saved customerReview plus current workspace/revision |
| customer-review.report | id, format | mediaType and complete report text from the saved body |

Original kinds are `assessment`, `evaluation`, `comparison` and `result`. Report formats are `json`, `csv` and `html`.

`CustomerServiceReviewClient` extends the original HTTP client and exports `readCustomerReviews`, `readCustomerReviewOriginal`, `previewCustomerReview`, `saveCustomerReview`, `getCustomerReview`, `customerReviewReport` and `findCustomerReviewRequest`. The package export is `./seller/openlineage/customer-review`. Its declaration resolves the shipped base client declaration without changing the runtime module path.

The original MCP catalog includes the same six actions; read and report actions remain read-only. The single save action uses the existing workspace lock, operation journal and expected revision. There is no separate database, alternate writer or new provider request.

A saved review includes `schema`, `id`, `lineageId`, `edition`, `operationId`, committed `revision`, `createdAt`, the entire `preview`, and `contentSha256`. That digest covers the full saved body before the digest field is added. The preview hash likewise covers its entire body before `previewSha256`.

## Reports and original files

JSON contains the entire saved review. CSV includes a complete review row and every original record from every retained group, with the original JSON values encoded in cells. The original CSV encoder protects spreadsheet formula-leading text. HTML presents customer context, dated observations, recorded decisions, evidence identities, and every complete original group plus the complete saved record. It escapes all entered text and needs no external scripts, fonts or network resources.

Every format is derived exclusively from the saved preview. It does not read today's incident or disposition head. Opening the same review after later source imports, incident decisions or follow-up changes therefore retains the same report.

The review contains original file identities and complete record bodies. Download actual file bytes using the original `object.read` action: select the source's `id` or a result's `objectId`, read all returned ranges, preserve the declared length and verify the full SHA-256. An attached result's row ID is not its object ID.

For a complete transfer, use the original workspace export and receiving workflow. It carries the complete state, all source and result objects, historical customer reviews and the editable application. A standalone review report is useful for reading; the workspace package preserves the native evidence and receiving workflow.

## Complete export, receiving and reopening

Application edition 10 preserves every edition-9 file and adds the complete customer-review feature. The native inventory includes all 113 application files, including the browser, CLI, typed client, catalog, reports and guides. Historical inventories 1–9 remain explicit; their original packages still verify under their original versions. A package with customer-review records must include the complete edition-10 application.

The existing bundle verifier validates all source and result bytes, saved assessments/evaluations/comparisons, original history, and each customer review's request receipt. Deep validation recreates every frozen preview from the original operation history at its selected revision. Original workspace and record identities are retained by the existing receiver.

Use the existing original native commissioning and receiving operation to open the exact outgoing application, select actual retained records, inspect a preview, save one explicitly selected review, download its full reports and original files, export the complete workspace, receive it in the original independent destination and reopen that saved review. Do not start a replacement case or a synthetic verification programme for this feature.

Before describing an outgoing application or report as ready, the equipped owner must view the actual exact-version desktop and narrow layouts and operate the important selection, preview, save/reconcile, download and reopening controls. Inspect populated, empty, loading and error presentation where it actually occurs. Source review and syntax parsing do not claim that rendered/native receiving is complete.

## Preservation and scope

Customer names, narratives and original source records can be private. Keep complete requests, review files and workspace packages in the original authorized project destinations. Use the established project source/package handover. An email attachment restriction is not permission to rename, split, re-encode or route around that restriction.

The customer review preserves attribution entered by the operator; it does not certify that a named person approved the handover. It records dated original observations and decisions without inventing service guarantees, exposure calculations, compliance conclusions or a new financial judgment.
