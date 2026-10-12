# Implementation evidence in Grant Operations

The **Implementation evidence** desk connects an original merchant implementation to the existing grant operating case. It reads the maintained SF74 commissioning source, preserves the producer's task, measurement and receiving semantics, and lets the operator select the exact observations and existing case records that belong together.

A saved evidence review has its own immutable review ID in the original SF47 case journal. Its complete source, observation cutoff, selected work and purchase links, Installation editions, findings and producer report travel with the original case export. The existing Tranche completion workflow can select this review as supporting evidence.

## Select the original source and case

Open the maintained workspace, choose the existing operating case and enter the recording operator. In **Implementation evidence**, choose **Attach original source** to use the original Sources intake. Supported complete JSON sources are:

| Original source | Preserved content |
| --- | --- |
| `merchant-commissioning.json`, schema `stellar-forge.merchant-commissioning.v1` | Complete commissioning state and its embedded original files. |
| Merchant workspace, schema `stellar-forge.merchant-workspace.v1` | Original workspace, workorder inputs, case identity and commissioning state. |
| Merchant Support handoff, schema `stellar-forge.merchant-support-handoff.v1` | Exact inner workspace, Support identity, implementation state and original files. |

A runtime-only Support handoff does not contain implementation observations. Keep that handoff in the existing runtime-support receiver. An implementation source is limited to the original 8 MiB attachment bound; the native projection is bounded at 16 MiB. The reader returns a size error instead of shortening the original source.

Choose the attached original by filename, byte count and SHA-256. **Read original implementation** invokes the maintained producer over those exact retained bytes. The desk shows the original case/workorder, complete current task definitions, original counts, separate technical and customer receiving, and the producer's own comparisons and report.

The observation cutoff is canonical UTC including milliseconds, for example `2026-10-12T12:00:00.000Z`. Both the observation time and its recorded time must be at or before that cutoff. Later observations and corrections remain in the complete source history. The saved source contains the selected current task and workorder definitions; the desk explicitly labels these definitions and does not reconstruct an earlier definition from an observation date.

## Retain source-bundle originals

The current producer can retain a native source-bundle manifest without embedding every original member in its commissioning JSON. **Original files** shows that complete named inventory, including historical editions and original attachments that have no task assignment. Each member retains its original role, path, byte count, SHA-256 and source-bundle identity.

Embedded original files are already present. For each external member, attach its actual bytes through the original Sources intake, return to the same review, and select the matching retained source. Only an exact SHA-256 and byte count is offered. Two files with the same exact bytes can share one retained binding; each original manifest path remains in the inventory.

The review records these selections as `originalFileRefs:[{sha256,sourceId}]`. An unavailable member produces a blocking `ORIGINAL_FILE_UNAVAILABLE` finding. A review may retain that finding, but a complete evidence export returns `IMPLEMENTATION_ORIGINAL_FILE_UNAVAILABLE` until the frozen selection itself contains the required original file bindings. Use the original source and a newly reviewed draft to add missing bindings; never rewrite an existing frozen review.

A runtime contained in a native Support handoff retains its own separate digest. The UI labels a download of the containing handoff accordingly. It does not label that entire carrier as extracted runtime bytes.

Each original attachment keeps the existing 8 MiB bound, and the complete evidence ZIP keeps the original 32 MiB bound. If a source exceeds those limits, retain its original native delivery and the explicit unavailable/size result; this desk does not truncate or split an original file and claim successful complete evidence.

## Review source observations and exact associations

Use **Tasks**, **Receiving** and **Measurements** to inspect the original records. Search covers the full original row fields. Paging shows 50 rows at a time, with complete counts. **Open original** retains the complete record, associated workorder/materials and exact original file downloads.

The producer remains authoritative for task dependencies, corrected measurements, receiving scope, effective task decisions, subject matching and comparability. In particular:

- A completed task is a recorded task state. Technical receiving and customer receiving remain separate decisions.
- A measurement retains its original task, input and output scope, quantity, units, active effort, elapsed effort, manual corrections and author.
- A missing measure remains missing. A recorded zero remains zero.
- A baseline/follow-up comparison remains the producer's comparison. Different volume and per-unit comparisons remain visible.
- A source observation recorded after the selected cutoff cannot become current evidence merely because it describes an earlier date.
- Negative or changes-required receiving is valid evidence of that recorded result. Freezing the review does not turn it into acceptance.
- A purchase association records the operator's explicit link. It alone does not prove that a purchased output is a selected implementation material.

For each observation choose **Use evidence** or **Keep as context**. In the link dialog, select the existing deployments, work rows, purchases and outcome records and enter the association basis. Closing the dialog retains the entered link draft. **Retain evidence links** applies it to the review selection.

**Review scope** records the review name, optional tranche, exact cutoff, explicit Installation editions and source note. Installation choices display both the original identity and revision. A review preserves its selected saved editions; it does not revise their acceptance. Earlier selected editions remain available as historical selections when the latest Installation changes.

The desk never creates a purchase or support observation to fill a gap. It does not change work approval, settlement, delivery, Installation acceptance, cash, an award or an issuer decision. Use those original workflows when their actual evidence requires a separate recorded action.

## Preview and freeze

**Preview selected evidence** binds the entered selection to the current case version, original source and exact saved Installation editions. The result retains every selected observation, linked record snapshot, findings and a preview SHA-256.

Findings identify missing or changed links, superseded or later observations, mismatched receiving subjects and evidence that needs current review. Context-only selections retain their historical meaning. The operator may freeze a selection with findings; the saved review preserves those findings, and Completion independently decides whether its selected evidence is current and appropriate for that tranche.

**Freeze evidence review** sends `implementation.prepare` through the original case command endpoint with:

- the expected case version;
- the exact entered inputs and preview SHA-256;
- the original request ID;
- the recording operator and note.

The first committed request is authoritative. After an interrupted response, use **Continue original freeze** or **Read back accepted review**. Repeating the same request returns its first result. A changed request must use the original conflict workflow; do not reassign a retained request ID to different input.

The UI keeps per-source drafts and unfinished link dialogs across refreshes. A case version conflict keeps the draft and exact source. **Adopt current case version** explicitly moves the draft to the current records and requires another preview. Source bytes and large native projections are not copied into browser session storage. The draft and original command must fit the bounded browser storage before dispatch; if that storage cannot retain the request, no command is sent.

## Frozen review and original bytes

**Frozen reviews** lists the original saved review, cutoff, source and current-link comparison. Opening a review shows the original snapshot and findings. **Use as new draft** copies the selected scope into an entered draft for a new explicit preview; it does not rewrite the saved review.

**Download complete evidence** produces a deterministic ZIP containing:

| Member | Purpose |
| --- | --- |
| `implementation-review.json` | Complete frozen review, source projection, explicit inputs, linked snapshots and findings. |
| `implementation.html` | Receiving report for the frozen selection and original source context. |
| `producer-receiving/report.html` | The original producer's report from the selected source and cutoff. |
| `original-files.json`, `source-bundles.json` and `original-files/<SHA-256>` | Complete embedded and explicitly bound external originals, every native manifest, and original material/workorder references. |
| `sources/<source ID>` | Exact original implementation source and linked evidence attachments. |
| CSV tables | Complete selected links, tasks, receiving observations, measurements and comparison fields. |
| `MANIFEST.json` | Exact original member paths, byte counts and SHA-256 values. |

The ZIP and complete expanded selected evidence use the original 32 MiB bundle bound. Exports fail explicitly if the complete closure exceeds that bound; they do not emit a partial successful package.

### Verify the original producer at every evidence boundary

A carrier's self-reported projection digest cannot establish its receiving or comparison meaning. On case import, current Completion evidence use and review export, SF47 re-runs the maintained inspector against the exact original bytes and frozen cutoff. It compares the actual reader identities and the complete returned projection with the historical projection. The reader identity covers the inspector and its full ten-file native import closure, including runtime reconciliation and original seller history.

A different installed reader returns `IMPLEMENTATION_READER_PROVENANCE_MISMATCH`. A changed derived result returns `IMPLEMENTATION_PROJECTION_MISMATCH`. Keep the frozen source and historical projection intact and select the original published reader release needed to verify them. A new reader does not silently relabel an old review.

An already committed identical case import still recovers its original request and result before requiring a currently installed reader. A new import validates the complete original source, its producer result, event history, linked record versions and exact earlier Installation editions. Changed bytes under the same request ID retain the original request-conflict behavior.

## Include evidence in Tranche completion

In **Tranche completion**, select the applicable tranche and use **Frozen implementation evidence (optional)**. Select up to 20 distinct original reviews in the intended order. The preview checks their tranche, cutoff, creation date, findings and current links. It keeps technical and customer receiving separate and includes the full frozen evidence in the prepared Completion package.

The request field is `implementationReviewIds`. It is optional; existing completion requests that omit it retain their original input and result semantics. It composes with the independently selected `cohortReviewIds`.

No payment clock is invented. An unpaid operating case can display a selected evidence review while the existing payment-based completion controls remain unavailable. A frozen evidence review or local prepared form does not record submission or issuer acceptance. The original submission and issuer-outcome actions retain that responsibility.

## Native CLI and HTTP interfaces

All CLI commands use the original SF47 workspace and actor/request journal. Retain the actual IDs and filenames returned by earlier commands.

~~~sh
python3 cli.py operations --workspace /absolute/original-workspace show \
  --case ORIGINAL_CASE_ID

python3 cli.py operations --workspace /absolute/original-workspace implementation-source \
  --case ORIGINAL_CASE_ID --source ORIGINAL_SOURCE_ID \
  --as-of 2026-10-12T12:00:00.000Z --expected-version CURRENT_VERSION \
  --output /absolute/new/source-read.json

python3 cli.py operations --workspace /absolute/original-workspace implementation-preview \
  --case ORIGINAL_CASE_ID --inputs /absolute/entered/implementation-inputs.json \
  --expected-version CURRENT_VERSION --output /absolute/new/preview.json

python3 cli.py operations --workspace /absolute/original-workspace implementation-prepare \
  --case ORIGINAL_CASE_ID --inputs /absolute/entered/implementation-inputs.json \
  --expected-version CURRENT_VERSION --expected-preview-sha256 ORIGINAL_PREVIEW_SHA256 \
  --actor "Recording operator" --request-id ORIGINAL_REQUEST_ID \
  --note "Explicit original implementation evidence review"

python3 cli.py operations --workspace /absolute/original-workspace implementation-export \
  --case ORIGINAL_CASE_ID --review ORIGINAL_REVIEW_ID \
  --output /absolute/new/Original_Implementation_Evidence.zip

python3 cli.py operations --workspace /absolute/original-workspace implementation-original \
  --case ORIGINAL_CASE_ID --source ORIGINAL_SOURCE_ID --sha256 ORIGINAL_FILE_SHA256 \
  --output /absolute/new/original-file
~~~

The corresponding API routes reuse the existing authenticated server, current-version checks and bounded request transport:

| Method and route | Request or result |
| --- | --- |
| POST `/api/operations/{case}/implementation-source` | `{expectedVersion, sourceId, asOfAt?}` → original source and complete native projection plus initial review inputs. |
| POST `/api/operations/{case}/implementation-preview` | `{expectedVersion, inputs}` → complete preview, findings and preview SHA. |
| POST `/api/operations/{case}/command` | Original `implementation.prepare` command with `data:{inputs, expectedPreviewSha256}`. |
| GET `/api/operations/{case}/reviews/{review}` | Complete original frozen review. |
| GET `/api/operations/{case}/implementation-reviews/{review}/export.zip` | Exact complete frozen evidence bundle. |
| GET `/api/operations/{case}/implementation-originals/{source}/{sha256}` | Exact selected embedded original, served as a download. |

The input shape below is illustrative. Replace placeholders only with actual source IDs and current case record identities. An empty link array remains an explicit absence of an association.

~~~json
{
  "name": "Selected original implementation review",
  "sourceId": "<attached original source ID>",
  "sourceSha256": "<exact source SHA-256>",
  "asOfAt": "2026-10-12T12:00:00.000Z",
  "tranche": 2,
  "installationRefs": [],
  "originalFileRefs": [],
  "selections": [
    {
      "kind": "receiving",
      "id": "<original receiving observation ID>",
      "use": "EVIDENCE",
      "deploymentIds": ["<existing deployment ID>"],
      "workIds": ["<existing work ID>"],
      "purchaseIds": [],
      "outcomeIds": [],
      "note": "The retained source and these selected records establish this association."
    }
  ],
  "note": "Recorded scope and source basis."
}
~~~

Valid selection kinds are `task`, `receiving` and `measurement`; review use is `EVIDENCE` or `CONTEXT`. A single review selects at most 200 distinct observations and 20 Installation editions.

## Maintained typed client and merchant agent

The original `GrantWorkspaceClient` provides:

- `implementationSource(caseId, expectedVersion, sourceId, asOfAt?)`
- `implementationPreview(caseId, expectedVersion, inputs)`
- `implementationPrepare(caseId, {expectedVersion, requestId, actor, note?, inputs, expectedPreviewSha256})`
- `download('implementation', {caseId, reviewId})`
- `download('implementation-original', {caseId, sourceId, sha256})`

The maintained merchant provider exposes `merchant_grant_implementation_source`, `merchant_grant_implementation_preview` and `merchant_grant_implementation_prepare`. Preview and prepare accept inline inputs or an exact retained input file and explicit JSON pointer through the existing provider's verified input transport. The complete original file is hash-checked before applying a pointer.

The existing `merchant_grant_export` supports the two implementation export kinds. Results remain complete retained snapshots and files with normal byte/row paging and same-request recovery. Completion preview and prepare accept the optional `implementationReviewIds` field.

The selected complete provider catalogue has 67 tools, including the maintained Installation, cohort and implementation interfaces. The managed Python and Node launchers include the four new source/UI modules in the same boot identity. The SF74 producer modules remain explicit files in the original distribution source selection.

`buyer-receiving-runtime.json` retains the original buyer runtime and selects the current Grant Operations, Installation, implementation, SF74 source-bundle and MCP retained-file reader modules by exact path and Git blob identity. The selection contains 212 source files; retaining the descriptor itself gives a 213-file source package. Its static native import closure is complete. The original receiving owner selects this complete source before dispatching the unchanged case/intent workflow; an already started operation retains its saved source and request identity.

## Continue the one original receiving workflow

`implementation-operations-receiving.mjs` is an optional phase of the existing `buyer-operations-receiving.mjs` controller. It does not register a job, make a purchase or initialize another source population. The original complete v37 case, selected Routescan operation and all other original purchases/deployments remain the receiving input.

Before the original operation starts, its owner can select the updated complete source manifest and add `implementationReceiving` to the same reviewed private configuration. Do not change a configuration whose original native operation has already begun: retain its exact configuration/request, finish or resolve that original operation, and use the owner's explicit supported source-selection continuation.

The optional selection has this shape:

~~~json
{
  "schema": "sf47.implementation-native-selection.v1",
  "source": {
    "path": "/absolute/original/merchant-support-handoff.json",
    "filename": "merchant-support-handoff.json",
    "bytes": 12345,
    "sha256": "<actual complete source SHA-256>",
    "observedAt": "<original UTC observation time>",
    "sourceUrl": "<original source handoff reference>"
  },
  "inputs": {
    "name": "Original implementation evidence",
    "asOfAt": "<reviewed canonical UTC cutoff>",
    "tranche": 2,
    "installationRefs": [],
    "originalFileRefs": [],
    "selections": [],
    "note": "<explicit original source and association basis>"
  }
}
~~~

The optional top-level `files` array supplies actual external originals as `{path,filename,bytes,sha256,mediaType?,observedAt?,sourceUrl?,id?}`. Its members must match the maintained producer's inventory. An existing source can instead be explicitly selected in `inputs.originalFileRefs`; otherwise the same browser attaches the exact original bytes once and retains each original request. Missing required native source members stop this complete receiving phase before freezing.

This is a configuration shape, not a customer example or a runnable preselected case. The original implementation owner must supply the actual complete carrier and selected observation IDs. If the exact original source is already attached, set `source.id` to that source ID. Otherwise, the browser uses the existing source form once and retains its original `source.add` request before dispatch. Multiple matching retained source records require an explicit source ID.

The phase imports the entered review draft, reads the exact original source/cutoff, opens the selected original task/receiving/measurement details, previews the explicit links and freezes one original request. It verifies that original work, purchase, deployment, cash and outcome records remain unchanged.

The browser downloads the frozen evidence and displays the optional Completion selection. After the original server drains, the existing agent phase uses the same workspace to read and preview the source through the typed client and MCP, replay the browser's first freeze request, receive complete rows and verify the same deterministic ZIP. The CLI then reads the current case version and reopens the original source and frozen export. The full case import invokes the original-source provenance gate, and the restored browser opens the same review ID and source bytes.

The original cohort CLI reads the current case version after this additive review while checking its unchanged original measurement digest. Its original frozen request and selected purchase population remain intact.

Retain the whole private continuation directory, including its configuration hash, source and freeze requests, `implementation-receiving/` artifacts, complete case ZIP, source manifest and final same-case readback. A completed local result must report actual execution and service closure. Publishing this source does not claim that the original native receiving operation has completed.
