# Managed Unstructured Pipelines

This module operates local-file jobs in the launcher-selected Unstructured Pipelines account. It retains the exact uploaded inputs, reviewed provider profile, original provider job, response captures, and selected output bytes. The existing Research workspace uses these operations to receive a selected result into the original dossier Store.

## Account and profile configuration

Create a private launcher configuration and select the provider's actual template:

~~~json
{
  "schema": "stellar-forge.unstructured-pipelines-config.v1",
  "account": "research-operations",
  "apiUrl": "https://platform.unstructuredapp.io/",
  "apiKeyEnv": "UNSTRUCTURED_API_KEY",
  "profiles": [
    {
      "id": "reviewed-partition-template",
      "label": "Reviewed document partition template",
      "requestData": {
        "template_id": "replace-with-the-selected-provider-template-id"
      }
    }
  ],
  "limits": {
    "maxInputs": 10,
    "maxInputBytes": 50000000,
    "maxTotalInputBytes": 268435456,
    "maxRequestDataBytes": 1048576,
    "maxResponseBytes": 8388608,
    "maxOutputBytes": 67108864,
    "requestTimeoutMs": 120000
  }
}
~~~

A profile can instead supply the provider's exact `job_nodes` array. Select exactly one of `template_id` and `job_nodes` inside `requestData`. Additional documented request-data settings are preserved. Submission sends `request_data` as a JSON string and each file as another `input_files` multipart part.

The HTTPS API base is selected by the launcher. A deployment prefix is retained: a base ending in `/deployment-a/` produces `/deployment-a/api/v1/jobs/`. The base contains no URL credentials, query, or fragment, and redirects are disabled. Dedicated and in-VPC deployments can use their operator-selected HTTPS address.

The key value is resolved from `apiKeyEnv` in the original process. Plans and portable editions contain the safe account/API identity and a profile summary. Exact job-node settings remain private because they can include private provider parameters. A summary contains `id`, `label`, `sha256`, `mode`, and either `templateId` or `nodeCount`.

The current provider limit is ten local files per job and 50 MB per file. This implementation uses 50,000,000 bytes for that per-file ceiling; configuration can lower these limits. Other response, retention, and waiting settings above are local ceilings. Provider account billing remains that of the selected account. Existing jobs remain readable and cancellable when the selected account, API base, and key variable match their retained source. Submitting a new job also requires the original profile digest to match.

The provider requires at least one second between job launches. All creates in this retained workspace share an account/API lock and a durable reservation record across profiles, process restarts, and configuration revisions. After acquiring an existing launch lock, a new create waits one second before dispatch. The lock remains held through that create response, so another local create reports `PIPELINE_LAUNCH_BUSY` without sending HTTP while it is held. The original operation remains `PREPARED`; inspect it and make a new explicit submit action when the active request ends. Cancellation during the local wait also preserves a known-unsent operation. GET, output download, and cancel actions do not consume this create interval.

This coordination covers the same retained directory and selected account/API identity. Other devices or separate directories must also honor the provider's account limit. Unstructured runs up to five local-file jobs concurrently and leaves overflow in its actual `SCHEDULED` state. The reader preserves that state and does not invent a local five-job rejection.

## Prepare and review exact inputs

Use an absolute private operation directory:

~~~js
import { openPipelineOperations } from './operations.mjs';

const operations = await openPipelineOperations({
  directory: '/private/research/pipelines',
  configuration,
  env: process.env,
});

const prepared = await operations.prepare({
  requestId: 'research-2026-10-12-documents-a',
  profileId: 'reviewed-partition-template',
  label: 'Planning documents',
  context: {
    dossierId: 'the-original-dossier-id',
    question: 'Which project obligations and dates occur in these documents?',
  },
  inputs: [{
    path: '/private/uploads/planning-document.pdf',
    filename: 'planning-document.pdf',
    contentType: 'application/pdf',
    sourceRef: { source: 'operator-upload', document: 'planning-document.pdf' },
  }],
});
~~~

Display `prepared.plan.payload.source`, `profile`, `inputs`, and `limits` for review. Retain `prepared.plan.sha256` with that decision.

Preparation copies the actual input bytes and records each byte count and SHA-256 digest. Submission verifies the retained copies. Once preparation completes, the original upload paths can be absent.

Repeating the same prepare request returns the original plan. Changed selections cannot reuse its request ID. If preparation stopped after writing its frozen input manifest, the same request finishes missing copies only when the bytes still match that manifest.

| Record | Local identity |
| --- | --- |
| Operation | `up_` plus 64 lowercase hexadecimal characters |
| Input | `in_` plus 64 lowercase hexadecimal characters |
| Retained output | `out_` plus 64 lowercase hexadecimal characters |
| Action | Stable original request ID, action kind, and fingerprint |

Provider job, file, and node identifiers retain the provider's actual strings. They are encoded as URL components; no UUID-only format or local input-order mapping is assumed.

## Submit and inspect the original operation

After the plan is reviewed:

~~~js
const submitted = await operations.submit(prepared.plan.id, {
  requestId: 'research-2026-10-12-documents-a-submit',
  expectedRevision: prepared.operation.revision,
  expectedPlanSha256: prepared.plan.sha256,
});

const current = await operations.inspect(prepared.plan.id);
~~~

The command journal and dispatch marker are durable before the create call. A complete provider response is retained before applying it to the operation. The client makes one create request per separately requested action.

Each new action checks the current revision. A stale action returns `PIPELINE_REVISION_CHANGED`; reopen the same operation and review its state. Repeating a recorded action returns its saved outcome. The returned `actionResult` identifies that exact action even if a later action has advanced the operation:

~~~js
{
  requestId,
  kind,
  status: 'COMPLETE',
  appliedRevision,
  result,
  error
}
~~~

An inspect view contains `plan`, `operation`, `running`, `interrupted`, `sourceMatches`, `profileMatches`, and `outputOptions`. A running operation exposes its original `activeAction`. Source-only inspection makes no provider request.

| Phase | Current meaning |
| --- | --- |
| `PREPARED` | Exact inputs/profile are retained; no accepted provider job is recorded. |
| `SUBMITTING` | The original create action owns the operation lock. |
| `SUBMISSION_UNKNOWN` | The original create may have reached the provider; a complete usable reply is unavailable. |
| `REJECTED` | A complete create response reported a recognized client-side rejection. The reviewed plan remains available after its cause is corrected. |
| `ACTIVE` | The provider reports `SCHEDULED` or `IN_PROGRESS`. |
| `COMPLETED` | The provider's job status is `COMPLETED`; processing details and output availability remain visible. |
| `STOPPED` | A provider job read reports `STOPPED`. |
| `FAILED` | A provider job read reports `FAILED`. |

A request known to have been aborted before `fetch` is invoked is recorded as `PIPELINE_REQUEST_NOT_SENT` and returns to `PREPARED`. Reopening can then accept a fresh explicitly requested submission. An uncertain started request remains `SUBMISSION_UNKNOWN`.

Refresh through the same operation:

~~~js
const refreshed = await operations.refresh(current.plan.id, {
  requestId: 'research-2026-10-12-documents-a-refresh-1',
  expectedRevision: current.operation.revision,
});
~~~

Refresh captures the actual job and, when that read succeeds, its processing details. `operation.jobObservedAt` and `detailsObservedAt` identify those source observations.

The original detail model distinguishes `SUCCESS` and `COMPLETED_WITH_ERRORS`. It preserves the provider's node counts and message; optional node names/type/subtype may be absent or null. The module performs no automatic polling loop. The existing operator chooses refreshes and schedules through its account controls.

## Reconcile a lost create reply

Local reopening applies a fully captured create response without another provider call. If that reply is unavailable, inspect the existing account jobs:

~~~js
const candidates = await operations.listProviderJobs(prepared.plan.id, {
  // Optional actual provider filters:
  // workflowId: 'actual-workflow-id',
  // status: 'COMPLETED',
});
~~~

The result is `{jobs, receiptId, receivedAt, workflowId, status}`. The provider currently returns an array with workflow/status filters; no pagination cursor is invented.

After selecting the existing job from the provider's records:

~~~js
const uncertain = await operations.inspect(prepared.plan.id);
const reconciled = await operations.reconcile(prepared.plan.id, {
  requestId: 'research-2026-10-12-documents-a-reconcile',
  expectedRevision: uncertain.operation.revision,
  expectedPlanSha256: uncertain.plan.sha256,
  providerJobId: 'the-existing-provider-job-id',
  reason: 'Selected the original job after the lost create response.',
});
~~~

Reconciliation retrieves that exact job with the retained account and records the reason and source receipt. A known job cannot be replaced silently. The provider does not specify a correspondence between `input_file_ids` and the local multipart order, so filenames or array positions do not establish that association.

## Retain an actual output choice

`pipelineOutputOptions(job)` reads the original JobInformation model. The same choices appear in `view.outputOptions`:

~~~js
[
  { fileId, nodeId: null, label, source: 'input_file_ids' },
  { fileId, nodeId, label, source: 'output_node_files' },
]
~~~

The default form selects the provider's final-node output for an actual input-file ID. The explicit form selects the advertised file/node pair.

~~~js
const ready = await operations.inspect(prepared.plan.id);
const choice = ready.outputOptions[0]; // Select visibly in the operator UI.

const retained = await operations.retainOutput(ready.plan.id, {
  requestId: 'research-2026-10-12-documents-a-output-1',
  expectedRevision: ready.operation.revision,
  fileId: choice.fileId,
  nodeId: choice.nodeId,
});

const outputId = retained.actionResult.result.outputId;
const { body, metadata } = await operations.readOutput(ready.plan.id, outputId);
~~~

Check `actionResult.error` before using its result. A successful retention preserves raw response bytes, actual content type, job/file/node IDs, byte count, SHA-256, receipt ID, and receive time. Re-reading verifies those bytes. A repeated action returns the retained output; a separately requested later read can retain another edition if the provider returns changed bytes for the same choice.

Available choices remain visible when processing ends with errors or partial outputs. The actual download response determines whether a selected output is available. Keep the source processing status and node errors with a partially successful result.

The managed workspace's `edition.mjs` creates the standard `sf88-research-results-v1` envelope from the selected retained output. Its receiving adapter uses the original dossier Store and the same saved receiving request. The portable edition carries output and job/file/node/profile/input identities. Private configuration, API keys, and signed transport URLs remain in the operator's private state.

`readInput(operationId, inputId)` and `readOutput(operationId, outputId)` return `{body: Buffer, metadata}`. They support continued work after the initial upload source is removed.

## Cancel and reopen

~~~js
const active = await operations.inspect(prepared.plan.id);
const cancelled = await operations.cancel(active.plan.id, {
  requestId: 'research-2026-10-12-documents-a-cancel',
  expectedRevision: active.operation.revision,
  reason: 'The operator no longer needs the remaining processing.',
});
~~~

Cancellation retains the actual provider response, then reads the job. `operation.cancel.status` distinguishes `ACKNOWLEDGED`, `UNKNOWN`, `REJECTED`, and `CONFIRMED`. Only the job read establishes `STOPPED`. When the reply or follow-up read is lost, keep the same job and refresh it.

An `AbortSignal` stops the owned local HTTP call. Closing the module aborts its local requests and waits for their state updates. The provider job remains addressable by its original ID.

~~~js
await operations.close();

const reopened = await openPipelineOperations({
  directory: '/private/research/pipelines',
  configuration,
  env: process.env,
});
const saved = await reopened.list();
const same = await reopened.inspect(saved[0].plan.id);
~~~

`list()` returns inspect views, newest preparation first. It reuses the retained inputs, provider jobs, and outputs. Opening an operation recovers captured replies locally before allowing another action.

## Retained files and delivery

Each operation contains its reviewed plan, frozen private provider profile, copied inputs, command journal, complete or partial HTTP captures, retained outputs, and current state. The original private-file writer publishes complete files atomically. Output publication shares the retained response bytes instead of downloading them again.

Preserve the private operation in the original operator workspace backup for operational recovery. Use the selected research dossier edition/export for a customer document result. Raw account job listings and private provider parameters stay with the operator.

## Primary provider contract

The implementation follows official Python client
[ba25d2537151e0cbd6bdfadd97167a47f1e7d948](https://github.com/Unstructured-IO/unstructured-python-client/tree/ba25d2537151e0cbd6bdfadd97167a47f1e7d948),
version 0.46.3, OpenAPI 1.2.31.

- [Pipelines overview](https://docs.unstructured.io/api-reference/workflow/overview): ten local files, 50 MB per file, one-second launch spacing, and five concurrently running local-file jobs with provider scheduling for overflow.
- [Create job](https://docs.unstructured.io/api-reference/api/job/create-job): JSON request-data string and repeated input files.
- [Get job](https://docs.unstructured.io/api-reference/api/job/get-job) and [details](https://docs.unstructured.io/api-reference/api/job/get-job-details): original job state and node processing statistics.
- [List jobs](https://docs.unstructured.io/api-reference/api/job/list-jobs): account records and supported filters.
- [Cancel job](https://docs.unstructured.io/api-reference/api/job/cancel-job): cancellation acknowledgment.
- [Download output](https://docs.unstructured.io/api-reference/api/job/download-job-output): exact file ID and optional node ID.
