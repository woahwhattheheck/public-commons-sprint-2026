# Research Documents and Pipelines

The existing Research workspace now exposes the complete Documents and managed
Pipelines workflow to local applications, the command line and merchant agents.
All three use the same saved purchases, source operations, research questions,
received editions and complete file exports as the browser.

## Connect to the existing workspace

Start or reopen Research through its existing Applications entry. Select its
private application URL file and original dossier directory. The client reads
that connection file again for every request and checks the workspace identity;
closing an attachment drains its own requests and leaves the application with
its original owner.

~~~js
import {ResearchWorkspaceClient} from
  '@tokenjunkielabs/starforge-merchant/buyer/research-dossiers/client';

const client = new ResearchWorkspaceClient({
  connectionFile: '/absolute/private/research-application.json',
  directory: '/absolute/private/research-dossiers',
});
try {
  const status = await client.status();
  const documents = client.documents();
  const pipelines = client.pipelines();
  // Use the saved dossier ID and the methods described below.
} finally {
  await client.close();
}
~~~

In the source repository, import the same class from workspace-client.mjs in
this directory. The maintained package also exports the document client
factories at /buyer/research-dossiers/documents. The ordinary Research client
constructs them with its existing authenticated transport and file receiver.

The command uses the same connection and directory:

~~~sh
starforge research-client documents-help
starforge research-client pipelines-list \
  --connection-file /absolute/private/research-application.json \
  --directory /absolute/private/research-dossiers \
  --id ORIGINAL_DOSSIER_ID
~~~

The original research-dossiers remote command accepts the same commands.
Every operation below takes the original dossier ID. Command input files are
JSON objects; downloads require a new destination supplied with --out.

## Receive completed original Documents

1. Read documents.list(dossierId). The response contains saved purchases,
   received editions, the current dossier revision and nextAfter. Continue
   with the returned cursor. A received edition remains reviewable when its
   former buyer source is disconnected.
2. Review documents.review(dossierId, selection), selecting exactly one
   purchaseId or editionId. The result describes the document, native Partition
   result, parameters, warnings and complete edition hash.
3. Read documents.elements(dossierId, request) with that selection and
   expectedEditionSha256. Offset/limit page the original element order; page,
   type and query filter the original response. Continue nextOffset.
4. Receive the reviewed purchase into its original question. The receiving
   request contains selection: {purchaseId}, questionId, label,
   expectedEditionSha256 and expectedRevision from the dossier. Native
   receiving reconciles the same already-saved binding before appending a new
   edition.
5. Download the document bytes, original response or full research edition
   through documents.download(dossierId, {selection,
   expectedEditionSha256, kind, file}). The kind is document, response or
   edition; file is the local destination.

The corresponding commands are documents-list, documents-review,
documents-elements, documents-receive and documents-download.
documents-review takes the selection object itself in --input.
documents-elements and documents-receive take their complete native request.
documents-download takes {selection, expectedEditionSha256, kind} in --input
and the destination in --out.

## Prepare a managed pipeline from original files

pipelines.list(dossierId) returns the actual configured profiles, source
limits, workspace upload limit, original operations and received editions.
Choose a profile from that response and an existing question from the dossier.

~~~js
const prepared = await client.pipelines().prepareFiles(dossierId, {
  requestId: originalPreparationRequestId,
  profileId: selectedProfileId,
  questionId: originalQuestionId,
  label: 'Reviewed document processing',
  expectedRevision: reviewedDossierRevision,
  files: [
    {
      file: '/absolute/customer/original.pdf',
      sha256: reviewedCompleteFileSha256,
      filename: 'original.pdf',
      contentType: 'application/pdf',
    },
  ],
});
const operationId = prepared.plan.id;
const planSha256 = prepared.plan.sha256;
const operationRevision = prepared.operation.revision;
~~~

Every source file requires its complete reviewed SHA256. filename and
contentType are optional; their defaults are the selected file's basename and
application/octet-stream. The client verifies every file before sending the
preparation, streams from those same open file descriptors and verifies the
complete bytes again before completing the JSON request. It compares the
returned ordered input identities with the selected filenames, media types,
byte counts and hashes.

The existing workspace accepts at most 32 file entries and 32 MiB of source
bytes per preparation. The configured source can impose smaller count,
individual-file and total-byte limits; the client reads and obeys those actual
limits. The original HTTP preparation route receives canonical base64 as a
stream, preserving its existing saved request and source operation.

pipelines-prepare --input PREPARATION.json accepts the same request. Relative
file paths are resolved against the directory containing PREPARATION.json.
Retain that exact JSON and the original files for restart recovery. Repeating
the same preparation request returns its saved operation when all the original
values match.

## Submit, observe, cancel and reconcile the same job

Read pipelines.operation(dossierId, operationId) before selecting an action.
A preparation starts at operation revision zero. The operation response carries
the original plan hash, current operation revision, provider job identity,
provider status, retained outputs and advertised outputOptions.

| Method / command | Native request fields |
| --- | --- |
| submit / pipelines-submit | requestId, expectedRevision, expectedPlanSha256 |
| refresh / pipelines-refresh | requestId, expectedRevision |
| cancel / pipelines-cancel | requestId, expectedRevision, reason |
| providerJobs / pipelines-provider-jobs | Optional workflowId and status |
| reconcile / pipelines-reconcile | requestId, expectedRevision, expectedPlanSha256, providerJobId, reason |
| retainOutput / pipelines-retain | requestId, expectedRevision, fileId and optional nodeId |

All action methods take dossierId, operationId, request and optional request
options. Each action requestId identifies that exact action. A later observation
uses its own requestId and the newly reviewed operation revision. For the CLI,
supply --operation and --input; provider-jobs accepts an omitted empty filter.

~~~js
const submitted = await client.pipelines().submit(dossierId, operationId, {
  requestId: originalSubmitRequestId,
  expectedRevision: prepared.operation.revision,
  expectedPlanSha256: prepared.plan.sha256,
});
const observed = await client.pipelines().refresh(dossierId, operationId, {
  requestId: originalObservationRequestId,
  expectedRevision: submitted.operation.revision,
});
~~~

An interrupted submit keeps its original operation. Inspect it, read the
configured provider's job inventory, match the actual job, then use reconcile
with that providerJobId and the original plan hash. This completes the existing
operation's identity. The browser and agent can continue that same job.

Cancellation records the provider's acknowledgment; refresh supplies the
observed terminal status. The saved phase distinguishes active, completed,
stopped, failed, rejected and uncertain submissions.

## Retain, review and receive pipeline output

Use a returned outputOptions selection for retainOutput. It downloads the
complete original provider output into the existing operation and returns its
out_... identity, digest, byte count and original file/node selection.

Review with pipelines.review(dossierId, {operationId, outputId}), or review an
already received dossier edition with {editionId}. Element inspection uses
pipelines.elements with selection, expectedEditionSha256 and the same
offset/limit/page/type/query fields as Documents.

Receiving uses the DOSSIER revision:

~~~js
const received = await client.pipelines().receive(dossierId, {
  selection: {operationId, outputId},
  requestId: originalReceivingRequestId,
  expectedEditionSha256: reviewedOutputEditionSha256,
  questionId: originalQuestionId,
  label: 'Received processing output',
  expectedRevision: reviewedDossierRevision,
});
~~~

The requestId, original output binding and receiving fields are retained
together. Repeat those same values after a lost receiving reply to recover the
saved result. The compact response includes the resulting dossier identity,
revision/counts and original receiving receipt.

The matching commands are pipelines-review, pipelines-elements and
pipelines-receive. pipelines-review takes the selection itself in --input.
The other commands take their complete requests.

### Which revision belongs to an action?

| Work | expectedRevision |
| --- | --- |
| Prepare files; receive a document; receive pipeline output | Reviewed dossier revision, starting at 1 |
| Submit, refresh, cancel, reconcile, retain output | Reviewed operation revision, starting at 0 |

A browser change and an agent action share these same revisions. Read the
current saved object after a conflict, review it, then choose the next action
from that state.

## Complete file downloads and restart

| Client method | Complete original file |
| --- | --- |
| documents.download(..., {kind: 'document', ...}) | Purchased or received document |
| documents.download(..., {kind: 'response', ...}) | Original Partition response |
| documents.download(..., {kind: 'edition', ...}) | Complete research edition |
| pipelines.downloadInput(dossierId, operationId, inputId, {file}) | Original prepared input |
| pipelines.downloadOutput(dossierId, operationId, outputId, {file}) | Complete retained provider output |
| pipelines.downloadReceived(..., {kind: 'output', ...}) | Original output from an operation or received edition |
| pipelines.downloadReceived(..., {kind: 'edition', ...}) | Complete pipeline research edition |

The local receiver streams into an exclusive temporary file, syncs it and
publishes a new destination. Success returns its path, filename, media type,
size and complete SHA256. expectedSha256 is optional for SDK downloads;
--sha256 supplies it in the CLI. If a requested hash differs after the complete
file is saved, the error retains destinationPublished: true and that exact
file result. Inspect that saved file using the returned identity.

The commands are documents-download, pipelines-input, pipelines-output and
pipelines-download. Direct pipeline input/output commands use --operation,
--file-id and --out. The received-file commands use their reviewed selection,
expectedEditionSha256 and kind in --input.

The existing export and reopen commands still carry the complete portable
dossier, including received original editions. Keep the customer's retained
dossier and source-operation directories with their established backup.

## Merchant agents

The existing Research merchant provider includes the new family in the same
catalog. Agents attach to a host-declared Research workspace and operate its
saved dossier IDs. Pipeline inputs are declared in the existing private
research-workspaces configuration:

~~~json
{
  "schema": "stellar-forge.research-workspaces.v1",
  "workspaces": {
    "research": {
      "label": "Research",
      "consoleUrlFile": "/absolute/private/research-application.json",
      "directory": "/absolute/private/research-dossiers",
      "sources": {
        "original-document": {
          "kind": "pipeline-input",
          "file": "/absolute/customer/original.pdf",
          "sha256": "REVIEWED_COMPLETE_SHA256",
          "filename": "original.pdf",
          "contentType": "application/pdf"
        }
      }
    }
  }
}
~~~

Replace the hash placeholder with the original 64-character lowercase SHA256.
merchant_research_workspaces exposes the declared source names, kinds, hashes
and input metadata. The preparation tool takes inputSources:
["original-document"]; the host resolves those names to the original files.

| Tool family | Operations |
| --- | --- |
| merchant_research_documents_ | list, review, elements, receive |
| merchant_research_pipelines_ | list, prepare, operation, submit, refresh, cancel, provider_jobs, reconcile, retain, review, elements, receive |

Every tool includes workspace and dossierId. Review/element tools accept
purchaseId or editionId for Documents; operationId/outputId or editionId for
Pipelines. Mutation arguments retain the native request IDs, hashes and
revision fields above. The tools share the original attachment's pending
requests, close/drain behavior and private source configuration.

### Export through the original merchant file store

merchant_research_export accepts these additional kinds:

| Kind | Selection |
| --- | --- |
| document-file, document-response, document-edition | purchaseId or editionId; expectedEditionSha256 |
| pipeline-input | operationId and inputId |
| pipeline-output | operationId and outputId |
| pipeline-received-output, pipeline-edition | operationId/outputId or editionId; expectedEditionSha256 |

All exports also take workspace and dossierId; expectedSha256 is optional.
The original merchant export ledger retains the complete downloaded file and
its content-addressed exportId. Read it with merchant_research_file_read,
continuing the returned readId and nextOffset. After restart, select the same
kind/exportId and retained offset. merchant_research_exports recovers a lost
export reply from the saved file records.

## Source and operating contracts

The implementation is in document-workspace-client.mjs and
document-workspace-cli.mjs, joined into the existing workspace-client.mjs and
workspace-cli.mjs. The merchant implementation is research-documents.mjs with
its data-only catalog module. The receiving handlers honor metadata projection
while the browser retains its normal full response.

The existing source-owned contracts remain in UNSTRUCTURED.md,
UNSTRUCTURED_PIPELINES.md, unstructured-workspace.mjs,
unstructured-pipelines-workspace.mjs and unstructured-pipelines/. Their saved
operations and received editions are the objects exposed by this client.
