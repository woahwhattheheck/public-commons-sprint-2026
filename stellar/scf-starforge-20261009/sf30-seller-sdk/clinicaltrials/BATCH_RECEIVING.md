# Disclosure batch receiving

Receive a client's protocol or results XML as a retained batch, review the exceptions with the original PRS tools, and deliver the exact files, client references and decisions together.

Batch receiving uses the same ClinicalTrials workspace, authenticated console, action journal and SQLite owner as cohort capture, study review, PRS, native datasets and Publisher. It calls the existing PRS inspection, modernization, upload-composition and reconciliation functions.

## Start or reopen

Use the installed ClinicalTrials contribution and its existing Python 3.11+ environment with the declared PRS dependency:

~~~sh
starforge clinicaltrials --workspace /absolute/private/disclosure init
starforge clinicaltrials --workspace /absolute/private/disclosure serve --port 0 --console-url-file /absolute/private/disclosure-console.txt
~~~

Open the private console link and choose **Batch receiving**. XML-only receiving works in an empty Clinical workspace. An existing public registry capture is available for explicit source-link review.

Managed Applications and the direct console open this same workspace. Stop or close the owning console before opening it in another CLI process. Browser and authenticated HTTP clients attach to the live owner.

## Receive files and client references

Enter the batch name, receiving reviewer and context. Select the original XML files and their protocol or results schema. The browser calculates the exact file SHA256, retains the inputs through the original authenticated PRS upload, and displays the original inspection.

Each batch supports 1–1,000 client entries, up to 64 MiB per XML and 256 MiB of distinct original XML bytes. Duplicate client entries share the exact retained file and inspection while keeping separate keys, source links, histories and dispositions.

A receiving manifest supplies the client's reference and exact source identity:

~~~json
{
  "schema": "stellar-forge.clinicaltrials-batch-intake.v1",
  "name": "October disclosure receiving",
  "reviewer": "Receiving operator",
  "entries": [
    {
      "key": "CLIENT-REFERENCE",
      "file": "protocol-record.xml",
      "sha256": "REPLACE_WITH_THE_ORIGINAL_FILE_SHA256",
      "label": "Original protocol delivery",
      "schema": "protocol",
      "sourceLinks": []
    }
  ]
}
~~~

Set the manifest before choosing the files. A manifest row applies only when the exact filename and SHA256 match. Several rows may match one file when the client supplied several distinct references. A mismatch is reported before that file is sent to the workspace.

The browser retains intake metadata in its session. After reconnecting it recognizes already-retained inputs by original SHA256 and schema. Reselect any remaining files and continue. Download the intake manifest when transferring the selection to another operator.

**Create reviewed receiving batch** records the selected references after all original files are retained. Clearing intake affects the browser selection; retained source files remain available in PRS tools.

Already-retained XML can be added directly, including separately edited candidates. Its receiving schema must match the original retained inspection.

## Review each entry

Open a client reference. The entry shows the input file, current document, original inspection, linked studies, disposition and findings. Filters focus on ready, follow-up, excluded, pending or finding-bearing rows.

The original inspection supplies schema, results-reference, source-interpretation and deprecated-element findings. A selected partial-update preview adds unresolved composition findings. A source reconciliation adds its original typed differences.

Each disposition records reviewer, explanation, current document SHA256 and complete current review-context SHA256:

- **Ready for handover** selects the preparation scope after original XML, results-reference and selected composition errors are resolved.
- **Follow-up required** retains the row, input and findings with the operator's explanation.
- **Exclude from selected delivery** records the exclusion while preserving its original reference and history.

Changing the document or source selection clears the current disposition. Earlier decisions remain in the row history. Selecting the same composed document keeps its original composition and unresolved findings; choose a prepared candidate through its retained composition. An existing ready decision cannot silently follow another candidate or new source link.

The batch is READY when it contains at least one ready entry and no pending or follow-up entries. The full delivery includes all original references and explanations for exclusions.

## Modernize deprecated elements

Expand **Review deprecated XML elements and apply a plan**. The table comes from the original PRS inspection, including exact occurrence identity, source path, value and allowed replacement fields.

Choose explicit keep, remove or replace decisions for the occurrences being addressed. Supply reasons and, for replacement, the exact field values. Prepare the original plan, inspect its complete source-bound result, then apply it.

Applying a plan retains a separate candidate and original comparison. The batch selects that candidate for the entry and keeps its input, plan and earlier history. Review the findings and record a new disposition.

The September 22, 2026 NLM notice describes thirteen deprecated tags whose values are accepted but ignored, with possible future removal. Preserve that timing in the review. The exact official XSDs and original modernization rules travel with the installed contribution and customer package.

Source: [NLM ClinicalTrials.gov PRS API Updates](https://www.nlm.nih.gov/pubs/techbull/so26/so26_ctg_prs_api.html).

## Review a full or partial update

Choose a retained base and the entry's current incoming XML. Supply a reviewer and any explicit interpretation rules needed by the original PRS composition API. **Preview update** retains the input identities, composed candidate, complete comparison and unresolved source units.

Read the composition. Enter the candidate reviewer and selection reason, then explicitly select the composed candidate. Selection binds the composition report to the row. Unresolved source units stay visible and prevent a ready disposition.

The original input remains attached to the client entry. Selecting another retained candidate also requires a reviewer and reason and preserves earlier candidates and decisions.

## Link and compare registry records

Source links are explicit. The batch does not derive a corresponding NCT record from a filename, client reference or unrelated example identifier.

~~~json
[
  {
    "captureId": "capture-ORIGINAL_UUID",
    "nctId": "NCT_ORIGINAL_IDENTIFIER",
    "sourceSha256": "ORIGINAL_CAPTURED_STUDY_SHA256",
    "reason": "Explain the reviewed relationship to this client entry."
  }
]
~~~

The controller reads that study from the retained capture, records its exact source SHA256 and checks an expected SHA256 when supplied.

The complete typed reconciliation plan uses the existing field catalog, explicit study links, correlated record links, results group identities and reviewer decisions:

~~~json
{
  "studyLinks": [],
  "fieldIds": [],
  "recordLinks": [],
  "idLinks": [],
  "decisions": [],
  "reviewer": "Reviewing operator",
  "rationale": "Explain the selected comparison."
}
~~~

Populate these arrays from reviewed original XML and captured studies. **Open original PRS tools** exposes the complete native field catalog. Every NCT study in the reconciliation must first be linked to this batch entry.

The original reconciler consumes retained study JSON bytes and their capture/page/provider edition metadata. Typed differences, absent values and correlated record choices remain in its complete report and the row history.

## Complete handover and recovery

**Prepare complete batch delivery** retains:

| Member | Contents |
|---|---|
| disclosure-batch.zip | Complete declared delivery |
| batch-register.csv | Client references, input/current hashes, schema, study count, disposition, reviewer, note and linked NCT IDs |
| exceptions.csv | Original finding identities, source detail and current dispositions |
| batch.json | Complete entries, artifact references and row history |
| prs/ | Exact original/candidate XML, inspections, plans, previews and reconciliations, including original-document ancestors and both composition inputs |
| studies/ | Explicitly linked original study JSON and capture metadata |
| contracts/ | Original OpenAPI, XSDs and contract provenance |
| clinicaltrials-workspace.zip | Complete portable Clinical workspace |
| HANDOVER.md | Receiving and reopening instructions |
| manifest.json | Declared file sizes and SHA256 values |

Downloads use the existing authenticated console. The backend checks declared sizes and hashes before returning an export member.

The portable file carries the original workspace's source, mappings, builds, studies, PRS records and review history, including all batches. Choose the intended private workspace scope before handing it over.

~~~sh
starforge clinicaltrials --workspace /absolute/private/received init
starforge clinicaltrials --workspace /absolute/private/received restore --file /absolute/delivery/clinicaltrials-workspace.zip
starforge clinicaltrials --workspace /absolute/private/received serve
~~~

The same batch and entry IDs, input identities, source links and dispositions reopen. A receiver may create another delivery from that preserved state. A workspace that already contains XML, plans or batch reviews receives further work through its normal source actions; restore opens a new empty receiver or resumes the same original packet.

Batch-capable packets use schema stellar-forge.clinicaltrials-packet.v2 and require a batch-capable receiver. Existing packets without batches keep the original v1 format.

When the registry dataset is exported through **Export & recovery**, its source closure includes source/disclosure-batches.json, original PRS files and the complete portable workspace. Original SF82 sourceFiles binds those bytes through Publisher and customer receiving.

## Original action and read interfaces

All mutations use the existing envelope:

~~~json
{
  "action": "batch.create",
  "payload": {},
  "expectedRevision": 12,
  "requestId": "ORIGINAL_CANONICAL_UUID"
}
~~~

POST to /api/clinical/action through the original authenticated connection. After uncertain transport, retain the UUID and read /api/clinical/operation?requestId=... using the operator's pending-action controls.

Row mutations require batchId, entryId and expectedDocumentId. Disposition also requires expectedContextSha256. The original workspace revision and row bindings identify the reviewed state.

| Action | Additional payload |
|---|---|
| batch.create | name, reviewer, optional note, entries: unique key, optional label, documentId, optional sourceLinks |
| batch.links | sourceLinks |
| batch.plan | decisions, reviewer, optional rationale |
| batch.apply | planId |
| batch.preview | baseDocumentId, reviewer, optional rules |
| batch.select | documentId, reviewer, note, optional previewId |
| batch.reconcile | captureId, complete original plan |
| batch.review | expectedContextSha256, decision, reviewer, note |
| batch.export | batchId, no row fields |

| Read route | Parameters |
|---|---|
| GET /api/state | Original state plus batches and batchExports |
| GET /api/clinical/batch | batchId |
| GET /api/clinical/batch-entry | batchId, entryId |
| GET /api/clinical/batch-export | exportId, file |

batch() returns entries, summary and exports. batch-entry returns the row, original/current records and selected full plan, composition and reconciliation. Existing PRS reads/downloads serve those same records.

The direct command starforge clinicaltrials --workspace DIRECTORY act ACTION --file PAYLOAD.json uses these same actions when it owns the workspace. Live clients attach to the authenticated console.

## Source and operation

clinical_batch.py provides the mixin and records metadata in the original database. public/batch.js constructs one panel at module setup using the existing action, upload and download helpers. The server adds the module and three read routes; the original managed launch descriptor and owner drain remain composed.

This is a preparation and review workflow. The customer chooses source relationships, review decisions and receiving scope before using the prepared XML in its established submission process.
