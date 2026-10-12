# n8n merchant agent operations and complete job receiving

This interface operates the original n8n merchant started by Applications or the
native merchant launcher. The browser, paid-job services and MCP tools share the
same job model, dispatch history, worker and prepared configuration.

A host configuration selects each original merchant by its saved directory and
installed source. Every tool takes its workspace alias. The adapter verifies the
private launch file, selected source bytes, process identity and authenticated
live launch before issuing an operation. A managed launch can use its original
copied command source; the native launch reader checks that copy against the
selected installed source.

## Connect an existing merchant

Start the saved n8n merchant through its existing Applications entry. Keep its
original private prepared directory. Its original launch creates
n8n-launch.json there and owns the application jobs, seller, customer service and
private operator listener.

Create a private connection file, for example /srv/starforge/n8n-workspaces.json:

~~~json
{
  "schema": "stellar-forge.n8n-workspace-connection.v1",
  "workspaces": {
    "invoices": {
      "label": "Invoice automation",
      "directory": "/srv/starforge/invoice-merchant"
    }
  }
}
~~~

The connection file must be owned, canonical and private (0600); original merchant
directories must be canonical private directories (0700). One directory has one
alias. The connection supports 1–32 aliases.

sourceDirectory is optional. Its default is the n8n source installed beside this
MCP adapter. If the original merchant uses a different selected installation,
declare that installation's exact canonical
stellar/scf-starforge-20261009/sf30-seller-sdk/n8n directory. The adapter imports
only this host-selected launch reader. The reader also verifies the copied
command source recorded by a managed Applications launch.

Initialize the maintained merchant host in a new private directory:

~~~sh
chmod 600 /srv/starforge/n8n-workspaces.json
starforge merchant-mcp init-n8n-workspaces \
  --dir /srv/starforge/invoice-agent \
  --connection /srv/starforge/n8n-workspaces.json \
  --name "Invoice automation operator"
~~~

The result identifies merchant-mcp.json and the configured aliases. Serve it with
the existing merchant MCP HTTP or stdio entry and its normal authentication.
Use the original host's printed endpoint for a client.

To join an existing multi-family merchant host, add n8nWorkspaceConnection to its
existing merchant-mcp.json instead of initializing another host:

~~~json
{
  "n8nWorkspaceConnection": "/srv/starforge/n8n-workspaces.json"
}
~~~

That fragment belongs alongside the host's existing schema, name, source and
other connection fields. The general init command also accepts
--n8n-workspaces CONNECTION_JSON when creating a host with another merchant source.

The adapter's configuration reader only reads selections. The first actual tool
call attaches to the live merchant. Stopping the MCP host drains its own calls and
releases its temporary export reads. The original merchant retains its lifetime
under Applications or its native launcher.

## Inspect and prepare an original job

Call merchant_n8n_status with the configured workspace. It returns the original
automation definitions, input schemas, examples, payment terms, worker state,
source hashes and current launch identity. Environment entries describe named
references and availability. Service summaries include origins; the original
private launch token remains in the host.

Use merchant_n8n_jobs to page the original queue. Its filters are q and status,
and limit is 1–200. Pass nextCursor back with the same filters. A cursor includes
the original collection revision; a concurrent job change returns
N8N_CURSOR_CHANGED so the next query starts from the current collection.

For a new job, retain a request UUID and its complete input before sending:

~~~json
{
  "workspace": "invoices",
  "requestId": "c7d153b7-cbb1-43dd-82b6-9b9f6a6f18d0",
  "reference": "invoice-2026-001",
  "functionId": "invoiceSummary",
  "input": {
    "invoiceId": "EXAMPLE-INVOICE-001",
    "currency": "USD",
    "lines": [
      {
        "description": "Document preparation",
        "quantity": 3,
        "unitPriceMinor": 12500
      },
      {
        "description": "Data export",
        "quantity": 2,
        "unitPriceMinor": 4500
      }
    ],
    "discountMinor": 1500,
    "taxBasisPoints": 750
  },
  "label": "Reviewed invoice"
}
~~~

This uses the original invoiceSummary example from example-input.json. It returns
two lines, five units, subtotal 46500, taxable amount 45000, tax 3375 and total
48375 in USD. For another configured function, use that function's exact current
input schema and example.

merchant_n8n_prepare returns the original job handoff, including its claimToken,
purchase request, terms, status and result addresses. Save the complete handoff
privately for the intended original customer workflow. The prepared job enters
PREPARED. Its original paid-job application controls submission, native
settlement and eligibility for the worker.

requestId must be a canonical version-4 UUID. reference is optional; when absent,
the original operation uses job_ followed by that UUID. A supplied reference and
every jobId use 1–80 characters: an initial letter/digit followed by letters,
digits, dot, underscore, colon or hyphen. A functionId begins with a letter and
uses up to 56 letters, digits or underscores.

Repeat the same request UUID and fields after an uncertain response. The
merchant retains the claim token before creating the job, so that retry returns
the same job and handoff. Reusing the UUID with different fields returns
N8N_REQUEST_CONFLICT.

## Original job and execution operations

merchant_n8n_job returns the full original job and dispatch history. The two
revisions are separate: job.revision belongs to the paid job, and
dispatch.revision belongs to n8n execution history. An undispatched job has a
null dispatch.

| Tool | Required operation fields besides workspace | Result and continuation |
| --- | --- | --- |
| merchant_n8n_status | None | Current original functions, worker, source and launch |
| merchant_n8n_jobs | None | Paged jobs; optional q, status, limit, cursor |
| merchant_n8n_job | jobId | Full original job and dispatch |
| merchant_n8n_prepare | requestId, functionId, input | Same saved job and private handoff on an exact retry |
| merchant_n8n_renew | requestId, jobId, expectedRevision, reason | Renewed original claim; exact retry returns its same token |
| merchant_n8n_cancel | jobId, expectedRevision, reason | Original job cancellation |
| merchant_n8n_retry | jobId, expectedRevision, reason | Retry under the original job state rules |
| merchant_n8n_reconcile | jobId, expectedRevision, reason | Original dispatch reconciliation; optional executionId |
| merchant_n8n_authorize_rerun | jobId, expectedRevision, jobRevision, reason | Explicit new execution authorization under both original revisions |
| merchant_n8n_worker_start | None | Start the original queue worker |
| merchant_n8n_worker_stop | None | Drain the original worker; inspect status for completion |
| merchant_n8n_export | requestId, jobId, expectedRevision, expectedDispatchRevision | Immutable complete job export |
| merchant_n8n_exports | None | Paged exports; optional jobId, limit, cursor |
| merchant_n8n_manifest | exportId | Retained manifest descriptor |
| merchant_n8n_file | exportId, file, expectedManifestSha256, expectedSha256 | Original base64 file chunk; optional offset, limit, readId |
| merchant_n8n_file_release | exportId, readId | Release the temporary read continuation |

For cancel, retry and renew, expectedRevision is the current job revision. Claim
renewal uses the original PREPARED/unsubmitted/unsettled conditions. Its UUID
preserves the renewed handoff through a lost reply. If another claim operation
supersedes it, refresh the original job and prepare the next intentional renewal
with its current revision and a new request UUID.

For reconcile and authorize_rerun, expectedRevision is the current dispatch
revision. authorize_rerun additionally requires the current jobRevision and its
original native settlement.

A retained acknowledgment or execution observation is used to poll the same
n8n execution. For a lost acknowledgment, reconcile can adopt an explicit
executionId only after the original engine verifies the configured workflow and
the complete original job/input identity. Review that history before choosing
authorize_rerun; that operation authorizes another actual workflow execution.

After an uncertain cancel, retry, reconcile or rerun response, read the same job
and dispatch. Their retained histories and current revisions describe the
operation's effect. Starting a different job or choosing a new execution is a
separate intentional operation.

## Freeze the complete original result

Select both current revisions from merchant_n8n_job. For a PREPARED job whose
dispatch is null, expectedDispatchRevision must be null:

~~~json
{
  "workspace": "invoices",
  "requestId": "e6614865-3dc8-46a1-849c-7a3f0fa61a6c",
  "jobId": "invoice-2026-001",
  "expectedRevision": 1,
  "expectedDispatchRevision": null
}
~~~

merchant_n8n_export retains these complete files:

- n8n-job-export.json: source, request, job, revision, complete file descriptors
  and total-byte identity.
- job.json: the original complete job, including input, source, history and
  result metadata.
- dispatch.json: the original complete dispatch history, or the original null
  value when the job has not dispatched.
- result.json: exact delivered result bytes when the original job is COMPLETED.

Each payload is limited to 64 MiB and the complete payload set to 96 MiB. The
manifest is at most 65,000 bytes. The original result's content type and filename
are preserved in the manifest even though its portable carrier is result.json.

The response is:

~~~json
{
  "state": "MANIFEST_RETAINED",
  "exportId": "64-character SHA256",
  "manifestFile": {
    "name": "n8n-job-export.json",
    "bytes": 1234,
    "sha256": "64-character manifest SHA256"
  },
  "workspace": "invoices"
}
~~~

Retain exportId and manifestFile.sha256. An exact repeated export request returns
the same immutable export even if the live job later renews, cancels or completes.
A job that changes while a first export is being captured returns
N8N_EXPORT_REVISION_CHANGED. Inspect current revisions and use a new request UUID
for the newly selected export.

merchant_n8n_exports pages every completed retained export, optionally by jobId.
Each item includes its original job revision, file descriptors and manifest
digest. Incomplete private staging directories are excluded.

## Download and reopen

Inspect the original manifest first:

~~~sh
starforge merchant-mcp inspect-n8n \
  --url "$MERCHANT_MCP_URL" \
  --workspace invoices \
  --export-id "$N8N_EXPORT_ID" \
  --manifest-sha256 "$N8N_MANIFEST_SHA256"
~~~

The maintained client reads MCP_ACCESS_TOKEN from the environment unless
--token-env selects another existing credential reference. Credentials are
supplied through the original MCP authentication.

Receive all original files into a new private directory:

~~~sh
starforge merchant-mcp download-n8n \
  --url "$MERCHANT_MCP_URL" \
  --workspace invoices \
  --export-id "$N8N_EXPORT_ID" \
  --manifest-sha256 "$N8N_MANIFEST_SHA256" \
  --out /srv/starforge/received/invoice-2026-001
~~~

The existing receiver writes and fsyncs a verified prefix, records a private
checkpoint, and publishes each exact file after its SHA256 matches. Progress is
written to stderr. On interruption, repeat the same command with the same
directory. Preserve the endpoint, workspace alias, exportId and manifest hash.
--chunk-bytes selects 1–196608 bytes; the default is 196608.

Temporary read handles can expire or disappear during a merchant restart. The
client opens the same immutable file with its original digest and saved byte
offset. The destination lease prevents two receiving clients from writing the
same directory concurrently. A different export or endpoint cannot reuse that
checkpoint.

After every complete download, the client verifies the full original job input
digest, source configuration/application hashes, selected job revision and
dispatch identity. The completed response includes recordsValidated: true,
dispatchRevision, file/byte counts, manifestSha256 and the original job summary.

Reopen an already received export locally:

~~~sh
starforge merchant-mcp reopen-n8n \
  --dir /srv/starforge/received/invoice-2026-001 \
  --manifest-sha256 "$N8N_MANIFEST_SHA256"
~~~

Reopen checks every complete file and the original job/dispatch identities.
It uses the same original private download lease and needs no merchant
connection. The received job is a portable record; operational continuation
uses the original merchant and its existing job identity.

## JavaScript and TypeScript

Installed public entries:

- ./merchant/mcp/n8n: configuration reader, sixteen tool definitions and
  MerchantN8nWorkspaces.
- ./merchant/mcp/n8n/client: inspectN8nJobDownload, downloadN8nJobExport and
  reopenN8nJobDownload, with adjacent TypeScript declarations.
- ./merchant/n8n: the original merchant public API, export contracts and
  N8nAgentOperations.
- ./merchant/n8n/agent-operations and ./merchant/n8n/transfer-format: original
  source modules for native integrations.

~~~js
import {
  inspectN8nJobDownload,
  downloadN8nJobExport,
  reopenN8nJobDownload,
} from './n8n-workspace-client.mjs';

const selection = {
  url: process.env.MERCHANT_MCP_URL,
  workspace: 'invoices',
  exportId: process.env.N8N_EXPORT_ID,
};

const inspected = await inspectN8nJobDownload(selection);
const saved = await downloadN8nJobExport({
  ...selection,
  expectedManifestSha256: inspected.manifestSha256,
  directory: '/srv/starforge/received/invoice-2026-001',
});
const reopened = await reopenN8nJobDownload({
  directory: saved.directory,
  expectedManifestSha256: saved.manifestSha256,
});
~~~

A trusted existing MCP client can supply client instead of url. It must expose
a stable endpoint string and call(name, arguments, options?). Both HTTP and
supplied clients receive the same enforced workspace binding. Their retained
endpoint identity includes #n8n-workspace= followed by the configured alias.

The adapter and receiver use only the selected original source, authenticated
merchant interface and maintained retained-file transport. Native payment,
workflow execution, job ownership and operator decisions remain in the original
merchant.
