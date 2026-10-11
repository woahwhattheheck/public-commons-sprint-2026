# QuickBooks and Xero through the existing merchant MCP

The merchant MCP operates the original QuickBooks and Xero workspaces through the
same accountant instance and exclusive accounting lease. A customer can select
the existing handoff, review its actual payment and refund context, retain a
reviewed journal, reconcile the original provider result, apply the original
accountant return and retrieve the retained files. The browser, original workspace
CLI and MCP reopen the same records.

The [customer SDK and durable CLI](./ACCOUNTING-PLATFORMS-CLIENT.md) provide one
interface for both platforms over the existing authenticated MCP connection.
The [accounting guide](./ACCOUNTING.md) describes the original source configuration,
accountant handoffs and operating maintenance. The native operator contracts are
the [QuickBooks workflow](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/QBO_WORKFLOW.md)
and [Xero workflow](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/XERO.md).

## Configure the original workspace and source files

Add the following fields inside the existing accounting workspace definition.
Paths resolve relative to the private merchant MCP configuration. Every source
is selected by the host; customer tool calls carry aliases.

~~~json
{
  "platformInputs": {
    "qbo-company": "../bookkeeping/qbo-company.json",
    "qbo-plan": "../bookkeeping/qbo-plan.json",
    "qbo-posting": "../bookkeeping/original-qbo-response.json",
    "xero-company": "../bookkeeping/xero-context.json",
    "xero-plan": "../bookkeeping/xero-plan.json",
    "xero-posting": "../bookkeeping/xero-responses.json"
  },
  "platforms": {
    "xero": {
      "tokenEnv": "STARFORGE_XERO_ACCESS_TOKEN",
      "tenants": {
        "merchant": "00000000-0000-0000-0000-000000000001"
      }
    }
  }
}
~~~

Replace the illustrated tenant UUID with the actual authorized tenant. Native
Xero context capture and journal operations select that declared alias. The
retained plan must name the same native tenant. The original Xero client reads
the configured environment variable and uses its fixed Accounting API endpoint.
Source imports, plan review, retained operation reads and accountant returns can
operate without a native token.

A platformInputs map has up to 64 aliases, like the other original accounting
source maps. Each source is an original regular file. The adapter reads its
UTF-8 bytes, checks its size and returns sourceSha256. A save requires that exact
digest; editing the selected file requires another review.

The input formats are the original native operator formats:

| Alias example | File contents |
| --- | --- |
| qbo-company | One JSON object with realmId and original companyInfo, preferences and accounts values; native JSON text can be retained in each source field |
| qbo-plan | The original QuickBooks plan request, including stable id/createdAt, frozen handoff, current expectedParentId, realm/company/currency, date and explicit rows |
| qbo-posting | The exact original provider JournalEntry or Fault JSON bytes |
| xero-company | The original context request with stable id, name, actor, tenantId, organizationBase64 and accountsBase64 |
| xero-plan | The original Xero plan request with stable id/createdAt, handoff/context/baseline, explicit inclusion/exclusion entries and valuation treatment |
| xero-posting | The original response import object with stable capture id, actor and ordered files containing name/base64 |

The QuickBooks source envelope is at most 32 MiB; its combined native company
documents remain subject to the original 8 MiB limit, and a posting response is
at most 8 MiB. Xero input envelopes are at most 96,000,000 bytes, with the native
per-file and combined-response limits enforced by the original engine. Large
JSON, base64 and company documents stay on the host instead of appearing inside
a tool argument.

Keep each journal's UUID and createdAt explicit in its source file before
preview. A preview binds those original values; the adapter does not replace
them with another journal identity on a retry.

The same provider can be initialized for an existing accounting workspace:

~~~sh
starforge merchant-mcp init-accounting \
  --dir /absolute/new/merchant-operator \
  --accounting /absolute/private/accounting.json

starforge merchant-mcp serve \
  --config /absolute/new/merchant-operator/merchant-mcp.json
~~~

The accounting.json file contains the object inside accounting, including its
original workspace directory, outbox, proofs and terms. An existing merchant
continues using its original configuration with these added fields. Existing
HTTP and stdio launchers register the same tools. Use the provider's existing
authentication and the configured workspace alias.

## One lifetime and one delivery path

Open the workspace with merchant_accounting_open. Its operating maintenance
controller opens the original accounting store and constructs the accountant,
QuickBooks and Xero controllers under that same lease. QuickBooks recovers
retained PENDING response/accountant intents. Xero initializes its retained
state and marks an interrupted original native operation appropriately.

Pause and close use the existing maintenance workflow. They stop new admission,
drain accepted calls and file reads, then close Xero's owned native tasks before
closing the original accounting workspace. Resume constructs the original
controllers against those same directories and identities.

A customer disconnect releases only that customer's retained file reads.
Explicit workspace close is the owner operation. The customer guide distinguishes
those actions and keeps original native operations available for reconciling an
uncertain client response.

## QuickBooks: original handoff to saved accountant return

1. Open merchant_accounting_qbo_status and page handoffs/plans. Read the selected
   handoff with merchant_accounting_qbo_handoff. The row view preserves original
   native amounts, source classifications, frozen adjustment context and the
   current accountant parent.

2. Review the actual company/chart source with
   merchant_accounting_qbo_company_preview. The native company importer displays
   each account's actual identity, currency, activity, type and eligibility reason.
   Use this same companySource in journal preview when the plan request does not
   already contain a retained companySnapshot.

3. Call merchant_accounting_qbo_preview with the declared journal source and,
   when used, companySource. Page rows, native journal lines and accounts. The
   native preview retains the selected company's original mapping, explicit
   home-currency values, source context and balanced journal.

4. Retain the returned command exactly. It names
   merchant_accounting_qbo_create and contains the source hashes, native
   previewSha256 and workspace revision. Execute that command to retain the
   original DRAFT plan. A repeated exact request reopens the original plan UUID.

5. Read merchant_accounting_qbo_plan. Review the actual retained plan and send
   merchant_accounting_qbo_review with its current revision, stable review UUID,
   actor, note and planSha256. The original controller reserves the selected
   company/events and makes journal-entry.json available.

6. Retrieve that original journal-entry.json through merchant_accounting_file.
   The authorized QuickBooks client performs the posting using the original
   native company/environment and request identity described in the
   [QuickBooks guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/QBO_WORKFLOW.md).
   This customer adapter does not add another QuickBooks executor.

7. Select the exact original returned JSON through the declared response source.
   Call merchant_accounting_qbo_response_preview with the stable response UUID,
   name, actor, createdAt, original realm and current expectedParentId. Review the
   native matched result or original Fault and the proposed accountant return.

8. Execute the returned merchant_accounting_qbo_response_save command unchanged.
   The original controller first retains the response and return intent, applies
   the original accountant import and links its saved return. PENDING becomes
   SAVED and the plan becomes BOOKED when that original return is linked.

9. For an interrupted existing response, read the full paged response history
   before repeating a save. merchant_accounting_qbo_response_resume selects the
   same planId/responseId with the current revision and actor. It continues the
   retained original return.

A native Fault remains a retained FAULT response; the original plan remains
available for the operator to resolve that provider result. A cancellation uses
merchant_accounting_qbo_cancel, a stable cancellation UUID, the original plan
digest, reason and explicit unusedConfirmed:true. Matched pending or saved
returns remain in their original accountant workflow.

### QuickBooks call examples

These examples use the existing connection's call(name, arguments) operation.
The caller retains the exact returned command and binding before submitting it.

~~~js
const preview = await call('merchant_accounting_qbo_preview', {
  workspace: 'sales',
  source: 'qbo-plan',
  companySource: 'qbo-company',
  view: 'rows',
  offset: 0,
  limit: 25
});

// After reviewing that native preview:
const created = await call(preview.command.tool, preview.command.arguments);

const plan = await call('merchant_accounting_qbo_plan', {
  workspace: 'sales',
  planId: created.record.id,
  view: 'responses',
  offset: 0,
  limit: 25
});
~~~

The company source has its own digest in the command. A source request containing
companySnapshot uses that retained snapshot directly; supplying a second
companySource for the same request is rejected.

## Xero: original source, draft operation and bookkeeping return

1. Select an existing context with merchant_accounting_xero_context, or preview
   the declared organization/accounts source with
   merchant_accounting_xero_context_preview and execute its returned import
   command. This native source preview checks the actual organization and chart,
   including the tenant, currency, demo flag and usable manual-journal accounts.
   The import command binds the original import request and byte hashes. After
   import, use the retained record's contextSha256 and actual createdAt.

2. For an actual native organization/chart read, use
   merchant_accounting_xero_context_capture with a declared tenant alias, its expectedTenantId from
   merchant_accounting_sources and a stable context UUID. The original controller performs the reads and retains
   their exact results. Reconcile that UUID before retrying a lost reply;
   native capture reads the provider before its import deduplication.

3. Call merchant_accounting_xero_source with the original handoffId/contextId.
   Page components, accounts and reservations. Every payment and verified
   returned amount remains a distinct original component. The native plan
   request supplies an explicit include/exclude decision for every component,
   its actual valuation and accounting treatment.

4. Preview the declared plan with merchant_accounting_xero_preview. Review the
   included and excluded entries, native journal summaries, paged lines and
   conflicts. Execute its returned creation command. The adapter reuses the
   native normalized request, including defaults, so a replay matches the
   originally retained plan request.

5. Read merchant_accounting_xero_plan and its original files. For a native
   operation, call merchant_accounting_xero_operate with the exact retained
   planSha256, declared tenant alias, stable operation UUID, current revision,
   actor and explicit action: create-drafts or refresh.

   Creation uses the original native tenant/chart preflight, exact draft
   payloads and retained idempotency keys. Refresh observes the existing
   original journals. The controller decides which retained journal attempts
   are eligible and preserves uncertain attempted creations.

6. Poll merchant_accounting_xero_operation with the same operationId. The
   original statuses are RUNNING, COMPLETE, FAILED and INTERRUPTED. Inspect
   original error details, captureId and paged source-file identities.
   A timeout at the customer connection is not a new native operation.

7. For provider files obtained through the merchant's existing client, use
   merchant_accounting_xero_response_preview on the declared ordered response
   set, then execute its returned import command. The native comparison verifies
   those actual journals against this exact plan. The preview/import binding
   covers the original capture UUID, actor and file content; the saved comparison
   retains its own original timestamp and comparison digest.

8. Read merchant_accounting_xero_comparison by its retained captureId. Page
   original journals, native lines, issues and unassigned results. Successful
   observations in a partial native operation remain individually identifiable.

9. Call merchant_accounting_xero_return_preview with the same plan/capture,
   stable return UUID/time, name, actor and expected current accountant parent.
   Review conflicts, skipped rows, assignments and the native accountant summary.
   The returned command includes the native previewSha256 and exact csvSha256.

10. Execute that original return command. The adapter asks the original
    controller for the same preview and verifies the complete CSV digest before
    delegating applyReturn. If the original return intent already exists, it
    reads that native retained request and verifies its CSV instead. The original
    accountant importer applies and links the same return UUID.

11. Complete an existing PREPARED return through
    merchant_accounting_xero_return_resume, selecting its original planId,
    captureId, returnId and previewSha256. The command uses the original retained
    request. It creates no new provider request or accountant return identity.

An unused Xero plan can be cancelled with its current revision, actor, reason and
explicit noExternalImport:true. The original controller checks attempted and
observed delivery before releasing the source reservation.

### Xero call examples

~~~js
const preview = await call('merchant_accounting_xero_preview', {
  workspace: 'sales',
  source: 'xero-plan',
  view: 'journals',
  offset: 0,
  limit: 25
});

const created = await call(preview.command.tool, preview.command.arguments);

const detail = await call('merchant_accounting_xero_plan', {
  workspace: 'sales',
  planId: created.record.id,
  view: 'returnIntents',
  offset: 0,
  limit: 25
});
~~~

For a journal's paged lines, use view:lines and its actual journalIndex. Plan
summaries omit large entry arrays and payload lines; exact native payload bytes
remain in the retained file inventory.

## Reconcile the original identities

The customer CLI stores the accepted command and its binding before dispatch.
After an uncertain reply, it observes the original native record. It does not
infer absence from a transport error or silently create another operation UUID.

| Operation | Original identity to reconcile | Native record |
| --- | --- | --- |
| QuickBooks draft | Plan UUID and native preview/plan digest | qbo_plan record.integrity |
| QuickBooks review | Plan UUID and original review UUID | record.review |
| QuickBooks cancellation | Plan UUID and original cancellation UUID | record.cancellation |
| QuickBooks response | Plan UUID and original response UUID, byte/result hashes | qbo_plan view:responses |
| QuickBooks resume | Same response UUID | Original PENDING/SAVED response and linked return |
| Xero context import/capture | Original context UUID and import/tenant identity | xero_context record |
| Xero plan | Plan UUID, planSha256 and original normalized request hash | xero_plan record |
| Xero draft/refresh operation | Plan UUID and original operation UUID/request hash | xero_operation |
| Xero response import | Plan UUID and original capture UUID/source request hash | xero_plan view:captures and xero_comparison |
| Xero accountant application | Plan UUID, original return UUID/capture/preview hash | xero_plan view:returnIntents and view:returns |
| Xero retained-return resume | Same retained return intent | Original PREPARED/APPLIED intent and linked return |

Status and plan tools provide total/offset/limit/items for complete paging.
Ordinary summary lists are recent selections, not a complete absence check.
Retained operations may apply or link an already saved result during recovery;
that action keeps its original identity and uses the original engine.

The original missing-record codes are QBO_PLAN_NOT_FOUND,
QBO_RESPONSE_NOT_FOUND, XERO_CONTEXT_NOT_FOUND, XERO_PLAN_NOT_FOUND,
XERO_CAPTURE_NOT_FOUND and XERO_OPERATION_NOT_FOUND. Other failures retain their
actual meaning. A source mismatch or native accounting conflict requires
reconciling the original request and current state.

## Retrieve exact original files

Use the existing merchant_accounting_file and merchant_accounting_file_release
tools, or the customer SDK's original chunk reader. The shared reader verifies
the complete original bytes once and retains its own private snapshot for
subsequent chunks. Keep all selectors, readId and expectedSha256 unchanged
through that read.

| Kind | Required selectors | Files |
| --- | --- | --- |
| qbo | planId, file | Original plan.json, reviewed journal-entry.json, handoff.json, accountant.csv, optional accountant-return.json and review.html |
| qbo response | kind:qbo, planId, responseId, file | Original response.json, result.json and, for matched returns, returned.csv and return-request.json |
| xero | planId, exact file name | Any original file named in xero_plan view:files, including retained context, native request/response, comparison and accountant intent files |
| xero archive | planId, file:xero-handoff.tar | Complete original Xero handoff and linked accountant returns |

Xero filenames can contain the original nested capture/operation/return
directories. Select the exact retained name from the paged inventory. The native
controller checks membership and exact bytes; a caller supplies no filesystem
path.

~~~json
{
  "workspace": "sales",
  "kind": "qbo",
  "planId": "00000000-0000-0000-0000-000000000002",
  "responseId": "00000000-0000-0000-0000-000000000003",
  "file": "response.json",
  "offset": 0,
  "limit": 65536
}
~~~

Replace the example IDs with the actual retained record identities. Subsequent
chunks use the original response's readId and SHA256 with the next offset.
An unfinished reader can be released explicitly; normal customer disconnect
drains that customer's reads.

A file or archive remains subject to the existing merchant reader limit.
When a complete native archive exceeds that limit, retrieve its original files
individually from the same inventory. Reading an archive does not create a new
payment, provider posting or accounting export engine.

## Original implementation

The adapter in [accounting-platforms.mjs](./accounting-platforms.mjs) delegates
to the existing controllers. [accounting.mjs](./accounting.mjs) owns their
configuration, maintenance admission and lifetime. It uses the same
[retained file reader](./retained-file-reads.mjs) as the existing delivered
response, period, accountant, recovery and adjustment workflows.

| Platform | Native controller | Native engine and source contract |
| --- | --- | --- |
| QuickBooks | [qbo-workspace.mjs](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/qbo-workspace.mjs) | [qbo.mjs](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/qbo.mjs), [company import](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/qbo-company.mjs) |
| Xero | [xero-workspace.mjs](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/xero-workspace.mjs) | [xero.mjs](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/xero.mjs), [native HTTP client](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/xero-http.mjs) |
