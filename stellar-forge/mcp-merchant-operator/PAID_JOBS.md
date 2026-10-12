# Original paid-job merchants through the agent

The paid-job tool family connects an agent to merchants that are already running. It uses the merchant's original paid-job model, input desk, worker, delivery service, resolution cases, and settlement accounting. The managed Applications service can start that same merchant and retain its launch identity; the agent attaches to the recorded service.

This guide covers configuration and operations. [PAID_JOBS_RECEIVING.md](./PAID_JOBS_RECEIVING.md) covers the typed client, complete file downloads, interrupted receiving, and offline reopening. The [managed Applications guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/README.md) covers installed source selection, launch, service status, and shutdown.

## Attach the selected merchant

Create a private connection JSON file owned by the service account, with mode `0600`. Select the canonical original merchant directory and the exact hashes from its source identity. For an Applications launch, select the retained `job-service-launch.json` file. For an independently operated merchant, select a private text file containing its original operator URL, including the URL's fragment token.

```json
{
  "schema": "stellar-forge.paid-job-workspace-connection.v1",
  "workspaces": {
    "invoice_service": {
      "label": "Invoice reconciliation merchant",
      "directory": "/srv/starforge/invoices/merchant-state",
      "launchFile": "/srv/starforge/applications/operations/selected-operation/job-service-launch.json",
      "source": {
        "configSha256": "<original 64-character configuration SHA-256>",
        "applicationSha256": "<original 64-character application SHA-256>"
      }
    }
  }
}
```

Use exactly one of `launchFile` and `urlFile` for each workspace. Optional `runtimeDirectory` and `selectionSha256` pins further restrict an installed Applications source selection. The connection supports 1–32 workspace aliases, using lowercase letters, digits, underscores, and hyphens. Each selected merchant directory must be distinct and private.

The provider authenticates the original `/api/identity` before calling the selected merchant. It checks the directory and configuration/application hashes on every attachment, and the additional runtime/selection pins when configured. A managed launch is checked against its retained process and service identity. Tool arguments use configured aliases, so a tool call cannot select another filesystem directory or arbitrary service URL.

Initialize a new MCP control directory:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-paid-job-workspaces \
  --dir /srv/starforge/invoice-agent \
  --connection /srv/starforge/invoice-agent-connection.json
```

Use the existing MCP serve command with the returned configuration. For a merchant initialized through the general setup command, `--paid-job-workspaces` selects the same private connection file. The agent's bearer token and the original merchant's operator token remain separate. Keep both in their existing private configuration and authentication surfaces.

## Run the complete merchant operation

Start with `merchant_jobs_status` to inspect the selected source, worker, function catalogue, payment state, and service capabilities. Use `merchant_jobs_jobs` to search jobs by function, state, or text. Its cursor belongs to the observed job inventory revision; restart the query if that revision changes. `merchant_jobs_job` retrieves the original job record and current revision.

### Prepare the original job and input claims

`merchant_jobs_prepare` accepts the function, JSON input, and a caller-generated UUID `requestId`. Retain that UUID and the exact request before sending it. Repeating the same UUID and payload recovers the same operation, job reference, and private result claim if a response is interrupted. A changed payload needs a new operation UUID.

For a function that declares input files, upload and seal the original files through the existing paid-job intake, then supply their original reference and private claim token with the declared input descriptors. The agent reuses that original file store and validates the function's declared policy. An application's ordinary `$files` JSON property remains ordinary input when its function has no input-file declaration.

`merchant_jobs_renew` renews the original quote with a retained operation UUID, current job revision, and reason. The original model continues to decide whether the current payment and job state permits renewal. Use `merchant_jobs_cancel` or `merchant_jobs_retry` with the observed job revision and a reason for an explicit job decision.

### Inspect and release input files

`merchant_jobs_inputs` searches the original input desk by reference, function, upload state, and ownership. Ownership is `UNASSIGNED`, `ORPHAN_PIN`, or `RETAINED_JOB`. `merchant_jobs_input` returns the original descriptor, policy, job relationship, and release decision. `merchant_jobs_input_preview` reads a verified UTF-8 prefix from the original file.

`merchant_jobs_input_discard` requires the current upload revision and a reason. The original desk determines whether the file is releasable and whether an explicit orphan release is required. Whole-file receiving is part of the complete export described below.

### Operate the worker and delivery service

`merchant_jobs_worker` starts or stops the original merchant worker. `merchant_jobs_reconcile` reconciles the original paid-job queue. The same merchant owns its worker, payment source, leases, and job state throughout these operations.

When the selected merchant has a delivery service, `merchant_jobs_deliveries` reads its original state or a selected delivery. `merchant_jobs_delivery_control` supports scan, drain, start, stop, and an explicit revision-bound requeue with a reason. The provider checks the advertised delivery capability before dispatch.

Closing the MCP server cancels its own calls and closes its retained file readers. It leaves the attached merchant and its worker under their original owner. The Applications or standalone service lifecycle controls the merchant's final shutdown and drain.

## Resolve a buyer issue using the original case

`merchant_jobs_case_read` returns the case summary or a selected section: issues, messages, decisions, operations, previews, history, accounting, or buyer receipt. Large case sections use cursors tied to the current case revision. An optional request UUID narrows the retained operation history.

Each case decision uses the original case's current revision. Job decisions also require the current job revision. The native resolution service persists its operation UUIDs, applies its original state transitions, and recovers interrupted accounting decisions.

| Operation | Tool | Required decision context |
| --- | --- | --- |
| Reply to the buyer | `merchant_jobs_case_reply` | Operation UUID, case revision, message, optional original issue |
| Open or close the case | `merchant_jobs_case_state` | Operation UUID, case revision, state, actor, message |
| Retry or cancel the original job | `merchant_jobs_case_job` | Operation UUID, case and job revisions, actor, message |
| Inspect accounting availability | `merchant_jobs_accounting` | Workspace alias |
| Bind the original accounting run | `merchant_jobs_case_bind` | Original run ID and case revision |
| Refresh the bound run | `merchant_jobs_case_refresh` | Original job ID |
| Preview a refund or cancellation | `merchant_jobs_case_preview` | Operation UUID, case revision, amount in atomic units, effective time, actor, reason |
| Record the retained preview | `merchant_jobs_case_record` | The preview's operation UUID and current case revision |
| Verify a recorded adjustment | `merchant_jobs_case_verify` | Operation UUID, case revision, adjustment, original transaction, actor |
| Withdraw a pending adjustment | `merchant_jobs_case_withdraw` | Operation UUID, case revision, adjustment, actor, reason |
| Recover an interrupted decision | `merchant_jobs_case_recover` | The original operation UUID |
| Resume the original preview | `merchant_jobs_case_resume` | The original operation UUID and current case revision |

Read the current case and accounting state after each decision. A lost reply should be recovered with its original UUID; changing the UUID creates a distinct proposed operation. The provider uses the merchant's selected accounting configuration and the original accounting controller.

## Export the complete job and its files

Call `merchant_jobs_export` with the original job ID, observed job revision, observed case revision (or `null` when no case exists), and a retained export operation UUID. The merchant freezes a complete export under that operation and checks that the source job and case remain unchanged while original files are copied. Repeating the original operation returns its same immutable export even if the live case subsequently advances.

The export contains all applicable files:

| File | Contents |
| --- | --- |
| `paid-job-export.json` | Versioned manifest, selected revisions, source identity, original descriptors, complete file sizes and hashes |
| `job.json` | Original job, source, input, payment, result, and lifecycle state |
| `input-policy.json` | The original function's declared file policy, when present |
| `input_<slot>.bin` | Every original declared input file, using its slot, upload identity, descriptor, bytes, and hash |
| `result.bin` | The original completed result bytes, when present |
| `resolution.json` | The original complete resolution export, when present |
| `customer-receipt.json` | The buyer receipt derived by that original resolution case |
| `accounting.json` | The unchanged original bound accounting export, when present |

`merchant_jobs_exports` lists retained exports with a cursor pinned to that inventory. `merchant_jobs_manifest` retrieves the complete manifest and its SHA-256. `merchant_jobs_file` reads original export files in bounded chunks, requiring both the selected manifest hash and the file hash. Retain the returned read ID for the active transfer and release it using `merchant_jobs_file_release`.

The typed client automates those reads, descriptor checks, private receiving storage, durable progress, interrupted-read recovery, complete validation, and offline reopening:

```js
import {
  inspectPaidJobExport, downloadPaidJobExport, reopenPaidJobExport
} from '@tokenjunkielabs/starforge-merchant/merchant/mcp/paid-jobs/client';

const selection = {
  url: 'http://127.0.0.1:3211',
  tokenEnv: 'MCP_ACCESS_TOKEN',
  workspace: 'invoice_service',
  exportId: originalExportId
};
const inspected = await inspectPaidJobExport(selection);
const received = await downloadPaidJobExport({
  ...selection,
  expectedManifestSha256: inspected.manifestSha256,
  directory: '/srv/starforge/received/invoice-job'
});
const reopened = await reopenPaidJobExport({
  directory: received.directory,
  expectedManifestSha256: inspected.manifestSha256
});
```

Use the package name from your installed distribution if it differs. The source modules and installed export suffixes are the same. The standalone `merchant-paid-jobs` command and `serve.mjs jobs` dispatch expose `inspect`, `download`, and `reopen`; see the receiving guide for complete flags and result fields.

## Receive the original resolution case

`merchant_jobs_case_receive` selects a configured target workspace and a configured `sourceWorkspace`, original export ID, and manifest hash. The receiving client reads and validates every declared structured companion from that source, including the original job, policy, buyer receipt, and accounting run. It hands the unchanged resolution export to the target's original native receiving service.

The native service validates the job and accounting relationships and decides whether the case can be received. Repeating an identical already-received case is idempotent. Complete input and result file receiving uses the full download operation above; its directory can be reopened and checked independently.

## Native operating continuation

`sf30-seller-sdk/jobs/agent/native-continuation.mjs` extends the retained operator/buyer checkout and resolution journey. It attaches the agent to the same original merchant, recovers the original prepared job, replays completed resolution operation UUIDs, exports all original files, interrupts and resumes a real input download across an MCP restart, receives the original case, and reopens the complete download after shutdown.

The continuation records its operation UUIDs, selected export revision, original MCP endpoint, interrupted prefix, and final native result in the existing fixture. It also checks that closing the agent leaves the original worker and completed job under the merchant's ownership. The checkout driver calls this continuation after its original input and resolution phases, using a retained source result so a restart can continue the same journey.

Run the native journey against the selected source and original operation. Its produced result is the evidence for that execution; this guide describes the maintained workflow and file contract.
