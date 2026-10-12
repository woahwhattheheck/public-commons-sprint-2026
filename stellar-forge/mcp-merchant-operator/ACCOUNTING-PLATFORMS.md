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
    "qbo": {
      "tokenEnv": "STARFORGE_QBO_ACCESS_TOKEN",
      "realmId": "9130350000000001",
      "environment": "sandbox"
    },
    "xero": {
      "tokenEnv": "STARFORGE_XERO_ACCESS_TOKEN",
      "tenants": {
        "merchant": "00000000-0000-0000-0000-000000000001"
      }
    }
  }
}
~~~

Replace the illustrated QuickBooks company and Xero tenant with the actual authorized identities. The QuickBooks connection selects its exact realmId and sandbox or production environment; an optional minorVersion is retained in the native request URL. Its original HTTP client reads the configured token environment variable. Native
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
retained PENDING response/accountant intents and completes an already received
native posting from its retained local files. Both native controllers preserve
interrupted provider-operation state for the original reviewed continuation.

Pause and close use the existing maintenance workflow. They stop new admission,
drain accepted calls and file reads, then close both controllers' owned native tasks before
closing the original accounting workspace. Resume constructs the original
controllers against those same directories and identities.

A customer disconnect releases only that customer's retained file reads.
Explicit workspace close is the owner operation. The customer guide distinguishes
those actions and keeps original native operations available for reconciling an
uncertain client response.

## QuickBooks: connected company to the original accountant return

1. Open merchant_accounting_qbo_status and page handoffs/plans. Read the selected
   handoff with merchant_accounting_qbo_handoff. The row view preserves original
   native amounts, source classifications, frozen adjustment context and the
   current accountant parent.

2. Read merchant_accounting_qbo_connection to check the host's exact company,
   environment and credential availability. merchant_accounting_qbo_company_fetch
   performs the original native CompanyInfo, Preferences and complete Account
   query, including inactive accounts. Default output is a compact summary;
   accounts view pages the captured chart and snapshot view returns the full
   validated company with its original sourceDocuments. Each fetch is a fresh
   native read. Carry expectedCompanySha256 when comparing another page so a
   changed company/chart is reported instead of silently mixing captures.

3. The operator retains that company snapshot inside the declared journal input,
   or writes the original sourceDocuments into the existing qbo-company import
   format. merchant_accounting_qbo_company_preview reads that host-selected source
   and displays actual account identity, currency, activity, type and eligibility.
   Use the same companySource in journal preview when the request does not already
   contain its companySnapshot. The full native source is available to the SDK;
   tool arguments continue to carry the host alias and exact source hash.

4. Call merchant_accounting_qbo_preview with the declared journal source and
   optional companySource. Review the actual home-currency values, balanced native
   lines, selected accounts and original source context. Retain and execute its
   exact merchant_accounting_qbo_create command. The native preview digest and
   source pins identify the original DRAFT plan; the same exact request reopens
   that UUID.

5. Read merchant_accounting_qbo_plan and send merchant_accounting_qbo_review with
   its current revision, stable review UUID, actor, note and planSha256. The original
   controller reserves the selected company/events and exposes journal-entry.json.

6. Call merchant_accounting_qbo_post_preview for that reviewed plan with the current
   revision and expectedParentId plus a stable posting id, actor and createdAt.
   The native preview selects the configured company and exact retained journal
   bytes. Retain its complete command and binding, then explicitly execute
   merchant_accounting_qbo_post. The original controller publishes its immutable
   intent/request, records native attempts, reconciles the exact original journal
   and links the same accountant return.

7. After a lost reply, read that plan's nativePost before attempting another
   operation. The SDK's reconcile reads the saved native identity. An explicit
   merchant_accounting_qbo_post_resume selects the same id and previewSha256
   with the current workspace revision and resuming actor. The original native
   controller may query/read the provider and, when its retained operation permits,
   submit the original request. Customer reconciliation does not automatically
   invoke this execution action.

8. When nativePost is BOOKED, its responseId/journalEntryId and original accountant
   return remain attached to the same plan. Retrieve intent.json/request.json with
   nativePost:true; retrieve a native attempt's response.json/receipt.json with
   its attemptId. Plan view native-attempts pages the complete original history,
   and view files supplies the exact selectors for all retained files.

The native preview exposes three distinct digests. Keep each in its original role:

| Field | Native meaning |
| --- | --- |
| planSha256 | The retained reviewed QuickBooks plan |
| requestSha256 | Exact original journal-entry.json bytes sent to the provider |
| previewSha256 | The native posting intent, including its UUID/time, actor, company, request URL, parent and request/plan hashes |

The native posting remains the original controller's operation:

| Native status | Customer operation |
| --- | --- |
| PREPARED or RUNNING | Observe the original retained operation; allow its owner to finish |
| UNCERTAIN or RETRYABLE | Inspect retained attempts and retryAt, then explicitly continue the same reviewed posting when appropriate |
| RECEIVED | The original provider response is retained; continue its local accountant import using the native operation |
| BOOKED | Retrieve and reconcile the original journal and accountant return |
| FAULT or CONFLICT | Inspect the exact retained native response and reconcile the company's original records before another reviewed action |

The native controller applies its provider throttle and Retry-After handling.
Neither a customer timeout nor a missing transport reply creates a new posting
UUID. Once the original native journal has been observed, its retained identity
continues to govern recovery.

### Import an existing native posting response

A previously received provider JournalEntry or Fault can use the original saved
response workflow on the reviewed plan:

1. Select its exact original JSON through the declared response source. Call
   merchant_accounting_qbo_response_preview with the stable response UUID, name,
   actor, createdAt, realm and current expectedParentId.

2. Review and execute the returned merchant_accounting_qbo_response_save command.
   The original controller retains the response and return intent, applies the
   accountant import and links its saved return. PENDING becomes SAVED and the
   plan becomes BOOKED when that original return is linked.

3. For an interrupted response, read its full paged history.
   merchant_accounting_qbo_response_resume continues the same planId/responseId
   with the current revision and actor. It operates the retained original return.

A native Fault remains a retained FAULT response. Cancellation of an unused
journal uses merchant_accounting_qbo_cancel with a stable cancellation UUID,
the original plan digest, reason and unusedConfirmed:true. Retained native
posting attempts and matched pending/saved returns remain subject to the
original controller's cancellation rules.

### QuickBooks call examples

These examples use the existing connection's call(name, arguments) operation.
The caller retains each exact returned command and binding before execution.

~~~js
const connection = await call('merchant_accounting_qbo_connection', {
  workspace: 'sales'
});

const company = await call('merchant_accounting_qbo_company_fetch', {
  workspace: 'sales',
  realmId: connection.realmId,
  environment: connection.environment,
  view: 'accounts',
  offset: 0,
  limit: 25
});

const preview = await call('merchant_accounting_qbo_preview', {
  workspace: 'sales',
  source: 'qbo-plan',
  companySource: 'qbo-company',
  view: 'rows',
  offset: 0,
  limit: 25
});

// Execute after reviewing the native source and retaining its complete command.
const created = await call(preview.command.tool, preview.command.arguments);
const plan = await call('merchant_accounting_qbo_plan', {
  workspace: 'sales',
  planId: created.record.id,
  view: 'responses',
  offset: 0,
  limit: 25
});
~~~

After the original review, native posting uses the same selected plan:

~~~js
const nativePreview = await call('merchant_accounting_qbo_post_preview', {
  workspace: 'sales',
  planId: reviewedPlan.record.id,
  revision: reviewedPlan.revision,
  expectedParentId: reviewedPlan.expectedParentId,
  id: retainedPosting.id,
  createdAt: retainedPosting.createdAt,
  actor: retainedPosting.actor
});

// Retain and review nativePreview.command and nativePreview.binding first.
const submitted = await call(
  nativePreview.command.tool,
  nativePreview.command.arguments
);

const reopened = await call('merchant_accounting_qbo_plan', {
  workspace: 'sales',
  planId: reviewedPlan.record.id,
  view: 'native-attempts',
  offset: 0,
  limit: 25
});
~~~

The illustrated reviewedPlan is the current original plan read after review.
retainedPosting contains the caller's already saved original UUID/time and actor.
The SDK's durable operations command retains those fields before dispatch and
reconciles the same nativePost if the reply is lost.

The company source has its own digest in a creation command. A source request
containing companySnapshot uses that complete native snapshot directly; supplying
a second companySource for the same request is rejected.

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
| QuickBooks native posting | Plan UUID, native posting UUID and original preview, plan and request SHA256 | qbo_plan record.nativePost; observe the original status, then explicitly execute post-resume only when continuation is needed |
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
| qbo native intent | kind:qbo, planId, nativePost:true, file | Original intent.json and request.json |
| qbo native attempt | kind:qbo, planId, nativePost:true, attemptId, file | Original response.json and receipt.json from the selected retained provider attempt |
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
| QuickBooks | [qbo-workspace.mjs](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/qbo-workspace.mjs), [native HTTP client](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/qbo-http.mjs) | [qbo.mjs](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/qbo.mjs), [company import](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/qbo-company.mjs) |
| Xero | [xero-workspace.mjs](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/xero-workspace.mjs) | [xero.mjs](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/xero.mjs), [native HTTP client](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/xero-http.mjs) |
