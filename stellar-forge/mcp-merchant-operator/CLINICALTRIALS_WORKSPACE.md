# ClinicalTrials workspace through MCP

The ClinicalTrials MCP attachment operates the same retained workspace as the ClinicalTrials browser and Python CLI. It gives agents and customer operators the study, source, PRS, edition, publisher and receiving workflow through the existing authenticated console.

The Python workspace owns provider captures, original source bytes, mappings, queries, operation journals and its lease. The merchant MCP process attaches that running console. Closing MCP drains its own requests and temporary file reads; the original console remains available to its browser and CLI.

## Open the original workspace and attach MCP

Start the maintained ClinicalTrials owner:

~~~sh
starforge clinicaltrials --workspace /work/clinical/registry init

starforge clinicaltrials --workspace /work/clinical/registry \
  serve --port 0 --console-url-file /work/clinical/clinical-console.url
~~~

The direct source equivalent is:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/clinicaltrials/cli.mjs \
  --workspace /work/clinical/registry \
  serve --port 0 --console-url-file /work/clinical/clinical-console.url
~~~

Its private URL file contains the exact original loopback URL and capability followed by a newline. Use that file as the connection reference. The attachment rereads it for every request, supporting the original console's new port and capability after reconnect.

Create a private clinicaltrials-connection.json:

~~~json
{
  "schema": "stellar-forge.clinicaltrials-workspace-connection.v1",
  "workspaces": {
    "portfolio": {
      "label": "Clinical study portfolio",
      "consoleUrlFile": "./clinical-console.url",
      "files": {
        "source-review": {
          "kind": "source",
          "path": "./original-source.ndjson",
          "name": "original-source.ndjson"
        },
        "prs-review": {
          "kind": "prs",
          "path": "./original-prs.xml",
          "name": "original-prs.xml"
        },
        "receiving-packet": {
          "kind": "packet",
          "path": "./clinicaltrials-project.zip",
          "name": "clinicaltrials-project.zip"
        }
      }
    }
  }
}
~~~

Paths resolve relative to this file. Each workspace and file alias is a lowercase name of up to 64 letters, digits, underscores or hyphens. Declare only the handles needed by that workspace. A handle can additionally pin its original sha256 and label.

Select exactly one consoleUrlFile or consoleUrlEnv per workspace. The environment alternative holds the same private printed URL. The original console must be reachable in the MCP host's network environment. Connection and URL files use private permissions.

Initialize and start the existing merchant host:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs \
  init-clinicaltrials-workspaces \
  --dir /work/clinical-mcp \
  --connection /work/clinical/clinicaltrials-connection.json

node stellar-forge/mcp-merchant-operator/serve.mjs \
  serve --config /work/clinical-mcp/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
~~~

MCP_ACCESS_TOKEN is the host's normal bearer environment reference, separate from the original console capability. The standalone initializer creates the normal MCP configuration, original release-store structure and private customer export directory.

For a merchant exposing additional maintained operations, the general init command accepts --clinicaltrials-workspaces CONNECTION_JSON. Existing merchant configuration can declare clinicalTrialsWorkspaceConnection alongside its other components.

## Discover the complete surface

Use the existing merchant-mcp clinicaltrials command, or the direct client entrypoint:

~~~sh
node stellar-forge/mcp-merchant-operator/clinicaltrials-cli.mjs tools
~~~

It prints every exact schema. The call command accepts a short action such as study, or its full name merchant_clinicaltrials_study.

| Short action | Original operation |
| --- | --- |
| workspaces | Declared consoles and file aliases; owned verified reads |
| status | Full original state, integer revision, cohort and publisher history |
| inventory | Snapshot-paged captures, reviews, PRS, plans, reconciliations, exports, sources, mappings, builds and comparisons |
| capture | Original capture request, version, retained pages and completeness |
| studies | Saved cohort page with optional query over retained studies |
| study | Complete original nested study, exact lexical JSON and source identity |
| study_compare | The same NCT ID across two retained captures |
| prs | Original/candidate XML record and original validation/comparison |
| prs_plan | Frozen original modernization decisions |
| prs_reconciliation | Original typed comparison and study/field reconciliation |
| batch | Complete client receiving batch, findings, row history and declared deliveries |
| batch_entry | One retained entry with original/current documents and full selected PRS reports |
| operation | Original request journal after completed or interrupted action |
| action | Reviewed native action with original integer revision and UUID |
| files | Actual declared input byte counts and hashes |
| prs_upload | Full raw XML intake through the original PRS route |
| prs_candidate | Complete declared XML candidate and native comparison against its original document |
| restore | Full raw ClinicalTrials package receiving through the existing console |
| file_prepare | One complete original native file retained for delivery |
| exports | Saved complete MCP delivery manifests after reply loss or restart |
| manifest | Exact completion manifest and hash |
| file | Verified chunks from one retained original read |
| file_release | Release that temporary read while preserving the complete export |

The module also delegates the maintained 18 original NDJSON source tools with a source_ prefix: workspaces, status, inventory, inspect, ingest, ingest_text, plan, plan_save, build, query, compare, changes, export, merchant_prepare, exports, file_read, file_release and import. These retain their original schemas and engine behavior.

Save a private status argument file:

~~~json
{"workspace":"portfolio"}
~~~

Then call:

~~~sh
node stellar-forge/mcp-merchant-operator/clinicaltrials-cli.mjs \
  call --url http://127.0.0.1:3211/mcp \
  --action status --arguments /work/clinical/status.json \
  --output /work/clinical/status-result.json
~~~

The returned original state contains applicationSchema stellar-forge.clinicaltrials-workspace.v1 and the existing NDJSON workspace schema. Revision is a nonnegative integer. Capture IDs, source IDs, NCT IDs, provider versions and content hashes remain distinct fields.

Use inventory with offset zero first. Continue using its nextOffset and snapshot as expectedSnapshot. A changed array returns CLINICALTRIALS_INVENTORY_CHANGED. The native studies reader preserves the selected capture and its original offset/query semantics; paging retained studies performs no new acquisition.

## Cohort, capture and source review

All Clinical changes use the original action envelope:

~~~json
{
  "workspace": "portfolio",
  "action": "cohort.configure",
  "payload": {
    "name": "Daiichi Sankyo results portfolio",
    "query": {
      "query.lead": "Daiichi Sankyo",
      "aggFilters": "results:with",
      "sort": "LastUpdatePostDate:desc"
    },
    "pageSize": 50,
    "markupFormat": "markdown",
    "maxStudies": 100000,
    "maxBytes": 268435456
  },
  "expectedRevision": 0,
  "requestId": "0a103692-82d4-4d0b-bf0c-3fdd38c04355"
}
~~~

This is the original cohort payload shape. Use the revision actually returned by your workspace and a fresh UUID for a new intended operation. Save the complete JSON before sending. Retain that UUID for recovery of its exact operation.

The native acquisition preserves complete fields, requests the count on the first page, and continues the opaque provider token until it is absent, including across empty pages. Capture selection and provider version remain in the original retained source.

| Stage | Native action |
| --- | --- |
| Select source | cohort.configure, version.inspect |
| Acquire/continue | capture.start, capture.select, capture.advance, capture.resume, capture.pause |
| Review study | review.record |
| Prepare mapping | mapping.default, mapping.save |
| Build/compare | edition.build, edition.compare |
| Query retained edition | dataset.query |
| Prepare merchant/package | merchant.configure, package.export |
| PRS operations | prs.candidate, prs.plan, prs.apply, prs.reconcile, prs.preview |
| Disclosure batch | batch.create, batch.links, batch.plan, batch.apply, batch.preview, batch.select, batch.reconcile, batch.review, batch.export |
| Publisher | Installed original publisher.* actions |
| Dossier | Installed original dossier.* actions, validated by the controller's joined leaf |

The original controller validates each payload and retains its outcome. A review.record payload contains captureId, nctId, its exact expectedSha256, decision ready/follow-up/exclude, reviewedBy and the actual note. Inspect the complete retained study and source page first.

Mapping uses the original inventory: exact nested key paths and array markers, occurrence/record counts, type distributions and original samples. Mapping.save accepts the full original {plan}; edition.build accepts captureId and planId when selecting them explicitly; edition.compare accepts beforeId and afterId. Dataset.query accepts buildId and the original query parameter object.

The complete study read includes the nested object, original lexical JSON and source page. SectionJson retains the exact original section JSON for review. Source and build hashes come from the retained native engine, independently of displayed names.

## PRS intake, modernization and reconciliation

For an original full or partial upload composition, call action with prs.preview and {baseDocumentId, incomingDocumentId, reviewer, rules?}. Both selected documents must already be retained in this workspace. The original PRS engine applies its protocol/results schema and reviewed composition rules, retains both inputs, and returns the composed candidate with its complete report. Use the same revision and UUID envelope as every other native action.

Read the saved result with prs_preview {previewId}; page original preview history with inventory kind prsPreviews. Prs_catalog returns the original source-bound field definitions. Retained preview records include both document IDs, candidate ID, reviewer, original timestamp and the complete composition report. For protocol/results reconciliation, preserve the original field IDs, ordered repeated values and explicit recordLinks for correlated outcomes, arms, sites and results groups. The original leaf validates those relationships and records each original value.

Use files to inspect the actual host-declared XML and its complete SHA256. Prs_upload requires the declared prs handle, expectedSha256, schema protocol/results, current expectedRevision and retained requestId.

The attachment streams the complete XML with the native request headers. It checks the reviewed hash before sending and uses the same open file descriptor. The original controller binds the received body hash to its request and calls the maintained PRS leaf with the exact official schemas.

Read prs for the original report, document ID, schema errors and legacy elements. Prs.candidate accepts originalId, complete reviewed XML, name, reviewedBy and note. For a complete host-selected candidate, use prs_candidate with the declared prs file handle, expectedSha256, originalId, reviewedBy, note, revision and UUID. It reads that complete UTF-8 XML and invokes the same native candidate comparison. Original PRS inputs/candidates retain the leaf's 64 MiB XML limit.

Prs.plan takes the original documentId, a decisions array, reviewer and rationale. Each decision preserves elementId, action remove/keep/replace and reason; replacement includes the original leaf's replacement value. Read the complete frozen record with prs_plan, then apply that exact record using prs.apply {documentId,planId}.

Prs.reconcile accepts documentId, captureId and the original plan:

~~~json
{
  "studyLinks": [
    {
      "studyIndex": 1,
      "nctId": "ORIGINAL_NCT_ID",
      "reason": "Reviewed original study match"
    }
  ],
  "reviewer": "Reviewer label",
  "rationale": "Reason for this reconciliation"
}
~~~

The leaf also accepts its fieldIds and field decisions. Read the retained report with prs_reconciliation. Original XML, candidate XML, plans and reconciliation reports remain in the native package/source closure.

## Disclosure batches and exact XML handover

The batch-enabled contribution exposes 43 tools: 25 Clinical tools and the same 18 original source tools. Use `inventory` with `kind: "batches"` or `"batchExports"` for snapshot-paged history, `batch` for the selected batch, and `batch_entry` for a row's original/current documents, composition, modernization and source reconciliation.

Retain each host-declared XML through `prs_upload`, then call the normal `action` tool with `batch.create`. Supply the name, reviewer and entries containing distinct client keys, retained `documentId` values and explicitly reviewed `sourceLinks`. The original controller preserves duplicate client references to identical XML as separate entries.

Every row action carries `batchId`, `entryId` and `expectedDocumentId` in addition to the same workspace revision and request UUID. `batch.review` also carries the exact `expectedContextSha256` returned by `batch_entry`, its decision `ready`, `follow-up` or `exclude`, reviewer and note. Prepare/apply, preview/select and source reconciliation delegate to the original PRS engine. The full payload contract is [Disclosure batch receiving](../../stellar/scf-starforge-20261009/sf30-seller-sdk/clinicaltrials/BATCH_RECEIVING.md).

Selecting the same composed document retains its composition findings. A prepared composition is selected with its original `previewId`; the controller keeps unresolved source units visible. Native unlinked XML study indices and typed differences remain in the same entry review.

After `batch.export`, inspect its declared `files`. Prepare any member with:

~~~json
{
  "workspace": "portfolio",
  "kind": "batch",
  "exportId": "export-ORIGINAL_ACTION_UUID",
  "file": "disclosure-batch.zip",
  "expectedSha256": "ORIGINAL_DECLARED_FILE_SHA256",
  "expectedRevision": 12
}
~~~

This uses the same verified file reader, completion manifest, chunked client download and local reopening as other Clinical deliveries. The archive includes all client references, exceptions, exact original/candidate XML and their transitive plan/composition inputs, linked study sources, contracts and a complete v2 portable workspace. Restore that portable ZIP in an empty receiver; an existing XML-only batch workspace remains populated. The attachment closes its own requests and readers while the original console continues to own the batch.

## Native publication and customer work

The action tool forwards publisher.* through the same ClinicalTrials controller. Read status.state.publisher to inspect its current source selection, draft, release, generation, review and customer session before changing them. Preserve the original reviewed revision, generation and digest fields.

Prepare from the current original native export and use the publisher's own review/stage/select/start/status controls. Buyer review, intent/session preparation, run/recover, accounting and export retain the existing native customer workflow, original ledger gates, page cursor and completed rows.

The supported original publisher download kinds are:

| Kind | Original output |
| --- | --- |
| draft-csv | Publisher dataset |
| draft-review | Publisher review document |
| buyer-config | Prepared buyer configuration |
| session-manifest | Customer session manifest |
| session-csv | Complete customer CSV |
| session-jsonl | Complete customer JSONL |
| session-review | Customer review document |

Use file_prepare with kind publisher, its publisherKind and the native id. Each returned body is read once and retained unchanged. Generated review documents keep their actual generation timestamp; subsequent chunks and local reopening reference that exact retained version.

Dossier actions are passed only to the original installed controller namespace. Its leaf owns dossier receiving, original comparison/review and export. An unknown action remains rejected by that controller. The attachment does not create a parallel study or dossier store.

## Complete delivery and local reopening

File_prepare accepts the original declared selection:

| Kind | Required selector |
| --- | --- |
| export | exportId and file from that original export's declared members |
| batch | exportId and file from the original batch delivery's declared members |
| source | captureId and file from the original capture's declared members |
| contract | Installed original contract name |
| prs | documentId and prsKind xml/report |
| publisher | publisherKind and original id |

An optional expectedSha256 pins reviewed original bytes. Optional expectedRevision requires the same Clinical revision before and after reading the file. Otherwise the manifest records both observed revisions while retaining the exact file hash.

The returned exportId identifies this MCP delivery and is distinct from a native ClinicalTrials package export ID. Its completion manifest binds workspace, original native selection, observed revisions and the original file name/size/type/SHA256. A nested native filename stays in the source selection; the complete downloaded file uses its safe original filename.

~~~sh
node stellar-forge/mcp-merchant-operator/clinicaltrials-cli.mjs \
  inspect --url http://127.0.0.1:3211/mcp --export EXPORT_SHA256

node stellar-forge/mcp-merchant-operator/clinicaltrials-cli.mjs \
  download --url http://127.0.0.1:3211/mcp \
  --export EXPORT_SHA256 --manifest-sha256 REVIEWED_MANIFEST_SHA256 \
  --directory /work/clinical/received-project
~~~

The existing download engine verifies the manifest, streams exact chunks, retains byte offset/hash checkpoints, and publishes the final manifest after every file is complete. Chunk size can be 1–196608 bytes. Repeat the same command and directory after interruption to reuse the verified prefix. An expired read reopens at the same hash and offset.

Reopen after both listeners close:

~~~sh
node stellar-forge/mcp-merchant-operator/clinicaltrials-cli.mjs \
  reopen --export EXPORT_SHA256 \
  --manifest-sha256 REVIEWED_MANIFEST_SHA256 \
  --directory /work/clinical/received-project
~~~

Reopening takes the original receiving lease and verifies the saved manifest and complete original file bytes. It reports the same selection, total bytes and exact file hashes.

To restore a full ClinicalTrials package, declare the completed ZIP as a packet alias for the intended existing receiving console. Inspect its actual hash, then call restore with that handle, expectedSha256, revision and UUID. The original receiver restores its captured/provider/PRS state. The delegated source_import operation separately preserves the original NDJSON packet behavior.

A portable receiver retains source editions, study review IDs and PRS artifacts in its new controller workspace. Inspect that receiver’s actual revision, operation journal and export inventory. Reuse a retained study review by its exact ID and source SHA; create the receiver’s current export from the same native snapshot. Keep the previous owner’s request and export journal with its original delivery so that both operating histories remain available.

## Recover the exact request

Keep the full action JSON, UUID and selected input SHA until its terminal outcome is read.

| Original status | Continue with |
| --- | --- |
| COMPLETE | Saved native result and revision |
| RUNNING | Read the same request while the original operation owns its lease |
| FAILED | Retained native error and saved state before choosing a corrected operation |
| INTERRUPTED | Same request plus the original source/controller recovery path |
| UNKNOWN | Reconcile the original state and exact attempted request before explicitly resubmitting that saved request |

CLINICALTRIALS_OPERATION_UNCERTAIN includes the original UUID after a lost action/upload response. The attachment makes no automatic mutation retry. Keep the original UUID, body, reviewed revision and file hash together. The controller binds the UUID to its original action/payload and checks the current revision when creating a new operation. The browser and MCP operation reader inspect the same record.

Console reconnection reads the same host reference. Complete MCP deliveries survive either process restart in the private exports directory and remain listed by exports. Temporary verified reads are disposable; complete original bytes and manifests remain. Storage errors preserve the actual local error code so the operator can restore capacity/access and continue the same record.

## Programmatic client and implementation

~~~js
import {
  openClinicalTrialsClient,
  downloadClinicalTrialsExport,
  reopenClinicalTrialsExport
} from './clinicaltrials-client.mjs';

const client = await openClinicalTrialsClient({
  url: 'http://127.0.0.1:3211/mcp',
  tokenEnv: 'MCP_ACCESS_TOKEN'
});

const current = await client.status({ workspace: 'portfolio' });
const page = await client.inventory({
  workspace: 'portfolio', kind: 'captures', offset: 0, limit: 50
});
~~~

Named helpers and client.call use the same exact tool definitions. Source helpers carry the source_ prefix. The original authenticated MCP client, RetainedFileReads and createRetainedDownload provide protocol/file handling; the Clinical attachment supplies only the native selection and manifest binding.

| Module | Responsibility |
| --- | --- |
| clinicaltrials-workspace.mjs | Same-console operations, native raw intake and retained delivery |
| clinicaltrials-client.mjs | Original MCP client, download and verified local reopening |
| clinicaltrials-cli.mjs | tools, call, inspect, download, reopen |
| catalog/clinicaltrials-workspace.mjs / catalog.mjs / providers.mjs | Lightweight tool metadata and the original configured provider lifetime |
| config.mjs / serve.mjs / instructions.mjs | Same-console host configuration, CLI and scoped operating guidance |
| sf30-seller-sdk/clinicaltrials/ | Original provider/controller/CLI/browser/package engines |
| source-workspace.mjs | Maintained NDJSON operations |
| retained-file-reads.mjs / retained-download.mjs | Original verified reads, receiving checkpoints and completion |

Limits are 32 configured consoles, 128 declared input handles per console, 128 KiB native JSON requests, 16 MiB native JSON responses, and 256 MB original file/verified snapshot budgets. Use paginated source views and complete-file transfer for large captures. Listing configuration or tools performs no provider acquisition or buyer mutation.

The local console transport consumes the original HTTP response stream directly with a total request deadline. It preserves the native bearer/Origin gate and validates complete retained file length and SHA256 before publishing a delivery manifest. An interrupted write still requires inspection of its original request UUID before continuation.
