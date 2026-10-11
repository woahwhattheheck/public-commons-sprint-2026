# QuickBooks and Xero customer operations

This customer interface uses the merchant's existing accounting workspace, original QuickBooks and Xero controllers, and the same MCP connection as the other merchant tools. It gives an operator a complete path from original source selection and preview through retained requests, response reconciliation, accountant returns and exact file delivery.

The platform adapter is described in [ACCOUNTING-PLATFORMS.md](ACCOUNTING-PLATFORMS.md). Host configuration and ordinary accounting operations remain in [ACCOUNTING.md](ACCOUNTING.md). Backup, pause, restore and reader ownership use [ACCOUNTING-MAINTENANCE-CLIENT.md](ACCOUNTING-MAINTENANCE-CLIENT.md).

## Installed entry points

Both installed commands dispatch to this same module:

~~~text
starforge merchant-accounting-platforms --help
starforge merchant-mcp platforms --help
~~~

JavaScript applications can import the connection, SDK and prepared-operation functions:

~~~js
import {
  createAccountingPlatformClient,
  connectAccountingPlatformClient,
  accountingPlatformOperation,
  accountingPlatformActions,
} from '@tokenjunkielabs/starforge-merchant/merchant/accounting-platforms';

import {
  prepareAccountingPlatformOperation,
  runAccountingPlatformOperation,
  downloadAccountingPlatformFile,
} from '@tokenjunkielabs/starforge-merchant/merchant/accounting-platforms/operations';
~~~

The SDK accepts an already initialized MCP caller, including the merchant's original stdio transport. The connected SDK and CLI use the original HTTP MCP endpoint. They keep native plan, context, capture, response, operation and return IDs; they do not create a second financial engine or job queue.

## Select the actual workspace and inputs

The examples below use environment variables for an already configured endpoint and workspace. Set ACCOUNTING_MCP_URL to its HTTPS URL or loopback HTTP URL, ACCOUNTING_WORKSPACE to the existing alias, and MCP_ACCESS_TOKEN through the host's normal credential setup. Only the token's environment-variable name is retained in a prepared operation.

~~~sh
starforge merchant-accounting-platforms sources \
  --url "$ACCOUNTING_MCP_URL" --workspace "$ACCOUNTING_WORKSPACE" --platform qbo

starforge merchant-accounting-platforms open \
  --url "$ACCOUNTING_MCP_URL" --workspace "$ACCOUNTING_WORKSPACE" --platform qbo

starforge merchant-accounting-platforms status \
  --url "$ACCOUNTING_MCP_URL" --workspace "$ACCOUNTING_WORKSPACE" --platform qbo
~~~

The original sources response lists each workspace's platformInputs aliases. Those aliases refer to original JSON files declared by the host. The operator supplies the alias and, where available, the retained SHA-256. Native previews resolve the original bytes and return their exact source digest. Large provider JSON, base64 payloads and accountant CSV remain on the host.

For Xero, the same response supplies platforms.xero.tenants entries with alias and tenantId. A context capture requires both the selected alias and expectedTenantId. The adapter rejects a host alias that now points to a different tenant. Native plan operations also bind the selected alias to the tenant already retained in the plan.

Use actions to see every current native input field and required field. It runs locally and needs no merchant connection:

~~~sh
starforge merchant-accounting-platforms actions --platform qbo
starforge merchant-accounting-platforms actions --platform xero
~~~

Read commands preserve the platform's actual view names and pagination. Pages use offset and limit, with a maximum of 200 entries. To read a particular result, retain its original ID and select the appropriate native view. Reconciliation searches the complete relevant response or return inventory, checking that its total and revision stay consistent across pages.

## One durable preview-to-result workflow

Every change starts from a preview. Native preview tools return the command and binding directly. For review, cancellation, operation, resume and context-capture choices that have no separate native preview tool, the customer client reads the original record and labels its review CLIENT_REVIEW_OF_ORIGINAL_NATIVE_RECORD. It retains the caller's exact arguments, original IDs and native digests. Neither preview path performs the requested mutation.

A preview can contain rows, issues and source metadata needed by the operator. Its command contains the exact small mutation arguments. Save the whole preview before preparing or sending it.

The following is a QuickBooks create example. The example alias must be replaced by an alias returned by the actual sources call. The host's original request JSON contains its own native ID, actor, createdAt, source selection and plan choices.

~~~json
{
  "source": "approved_qbo_plan"
}
~~~

Save that JSON as a private create-arguments.json file. Its parent directory must be private and its file mode must have no group or world permissions. Use a new operation directory and new preview filename:

~~~sh
starforge merchant-accounting-platforms preview \
  --url "$ACCOUNTING_MCP_URL" --workspace "$ACCOUNTING_WORKSPACE" --platform qbo \
  --action create --request "$CASE_DIR/create-arguments.json" \
  --out "$CASE_DIR/create-preview.json"

starforge merchant-accounting-platforms prepare \
  --dir "$CASE_DIR/create-operation" \
  --url "$ACCOUNTING_MCP_URL" --workspace "$ACCOUNTING_WORKSPACE" --platform qbo \
  --preview "$CASE_DIR/create-preview.json"

starforge merchant-accounting-platforms execute \
  --dir "$CASE_DIR/create-operation"

starforge merchant-accounting-platforms reconcile \
  --dir "$CASE_DIR/create-operation"
~~~

Preparation is local. It seals the exact endpoint, platform, workspace, token environment name, normalized command, binding and full preview into request.json. It writes and syncs the initial state.json before publishing an executable request. Reopening that directory accepts only the same complete preview and destination.

Execution first looks for the original native result. If the exact result already exists, it returns that result without submitting another request. Otherwise it records the send boundary, then sends the retained command. After a reply or an uncertain reply, it reconciles the original identity again. The returned submissionAttempted flag describes this invocation; previouslyAttempted reflects the retained operation history.

Reconcile does not create a new plan, context capture, response import, provider request or journal operation. It can complete the existing pending accountant return associated with the same retained QuickBooks response or Xero return intent. Before that original resume call, the CLI records the exact recovery command and increments recoveryAttempts. Submission and recovery therefore remain distinguishable.

Keep the whole operation directory, including request.json and state.json. Missing state is not reconstructed as a fresh operation: its earlier send history is needed to interpret an uncertain response. An operation whose request file was never published is not ready to execute.

### Revisions and changed source

Use the native revision returned by the selected record. The engine decides whether a mutation is valid at that revision; the customer does not overwrite a caller's revision, workspace, actor, source digest or tenant.

If a native revision or source check rejects an unsent change, inspect the original record and prepare the newly reviewed command in a new directory. Preserve the earlier directory and any original request IDs needed for reconciliation. Do not edit request.json to remove an error or reset its history.

A source alias is a locator, not an identity. The command's sourceSha256, original previewSha256 and native IDs are the retained identity. If the host file changes after preview, the native source check reports that change before the new command can proceed.

## QuickBooks: original journal and response workflow

The customer presents the original manual/import workflow. The native QuickBooks plan retains its normalized company and accounts, original handoff and accountant rows, editable journal and review. Provider-response import retains the actual response bytes and original accountant-return result.

| Customer preview action | Read before preparing | Identity retained for reconciliation |
| --- | --- | --- |
| create | Native plan preview from source; optional companySource preview | Original plan ID, actor, createdAt and journal integrity digest |
| review | Original plan summary and journal digest | Plan ID, review request UUID and native request digest |
| cancel | Original plan and explicit unusedConfirmed choice | Plan ID, cancellation UUID and native request digest |
| response-save | Original plan, response source preview, realm and expected accountant parent | Plan ID, response UUID, exact source digest and reviewed result digest |
| response-resume | Original retained response selected by responseId | The same response and result digests; no replacement response |

Normal progression is DRAFT to REVIEWED and, when the original response supports it, BOOKED. Cancellation is the native CANCELLED state. The original journal-entry.json file is available for REVIEWED or BOOKED plans. Read plan files and rows before choosing the exact original export.

To prepare a review, use these fields from the current plan and your explicit review decision:

~~~json
{
  "planId": "ORIGINAL_PLAN_UUID",
  "revision": 17,
  "id": "NEW_RETAINED_REVIEW_UUID",
  "actor": "Operator name",
  "note": "Original journal and account mapping reviewed.",
  "planSha256": "ORIGINAL_JOURNAL_SHA256"
}
~~~

The ID and digest strings above are placeholders. Use valid UUIDs and the actual 64-character digest from the original record. The revision shown is illustrative; use the observed revision. The preview command is --action review, followed by the same prepare/execute/reconcile sequence.

Cancellation additionally requires note and unusedConfirmed:true. Those fields describe the operator's actual decision about the native plan. The client preserves them rather than inferring them from an absent provider response.

For response-save, the argument file selects:

- planId and source: the original plan and the host's original response JSON alias;
- id, name, actor and createdAt: the explicit retained response identity;
- realmId: the selected QuickBooks company realm;
- expectedParentId: the current original accountant-return parent UUID, or null when there is no parent.

The native preview supplies sourceSha256, previewSha256 and the current revision for the command. An exact repeated response UUID is reconciled against its original request, provider bytes and result digest. A different response under the same ID is an identity conflict.

Response statuses retain their native meanings:

| Status | Customer behavior |
| --- | --- |
| FAULT | Return the original fault and retained source; no successful accountant result is asserted. |
| PENDING | Reconcile may finish the original already saved accountant return through response-resume. |
| SAVED | Return the original response and linked accountant-return identity. |

Read retained responses or files directly:

~~~sh
starforge merchant-accounting-platforms plan \
  --url "$ACCOUNTING_MCP_URL" --workspace "$ACCOUNTING_WORKSPACE" --platform qbo \
  --plan-id "$QBO_PLAN_ID" --view responses --offset 0 --limit 200

starforge merchant-accounting-platforms plan \
  --url "$ACCOUNTING_MCP_URL" --workspace "$ACCOUNTING_WORKSPACE" --platform qbo \
  --plan-id "$QBO_PLAN_ID" --view files
~~~

## Xero: context, plan, original operation and return

Xero keeps its distinct native phases. The customer does not collapse a journal operation, a response capture and an accountant return into one success flag.

| Customer preview action | Original selection and review | Identity retained |
| --- | --- | --- |
| context-import | Original host JSON containing organization/account source | Context UUID and native source-request digest |
| context-capture | Current configured tenant alias and expected tenant UUID | Context UUID, tenant UUID, normalized name and actor |
| create | Original plan request, context, handoff and inclusion choices | Plan UUID, native request digest and plan digest |
| cancel | Original plan, reason and explicit noExternalImport:true | Plan UUID, original plan digest and retained reason |
| operate | Original plan, create-drafts or refresh, tenant and operation UUID | Plan UUID, operation UUID and normalized native request digest |
| response-import | Original response-file source preview | Capture UUID, normalized actor and native response-request digest |
| return-apply | Original comparison and accountant-return preview | Plan, capture and return UUIDs, preview digest and exact CSV digest |
| return-resume | Original PREPARED return intent | The same plan, capture, return and preview identity |

Context capture reads the native provider before retaining the new context. If its response is uncertain after any recorded send attempt, this operation directory only searches for its original context ID. It does not repeat the provider capture automatically. Continue investigating the original native operation and context; a missing reply does not establish that the capture was never made.

For operate, supply the current native revision, a stable operation UUID, actor, tenant alias, original planSha256 and action create-drafts or refresh. The original controller retains this operation identity before provider execution. The customer can inspect or wait for that same operation:

~~~sh
starforge merchant-accounting-platforms execute \
  --dir "$CASE_DIR/xero-operation" --wait-ms 30000 --poll-ms 1000

starforge merchant-accounting-platforms reconcile \
  --dir "$CASE_DIR/xero-operation" --wait-ms 30000 --poll-ms 1000
~~~

Waiting reads only the retained operation. The native statuses are RUNNING, COMPLETE, FAILED and INTERRUPTED. COMPLETE means the native operation completed; it does not mean every journal was posted or every accountant result was accepted. Inspect the operation's original journal sources, the captured comparison, issues and accountant-return outcome.

Use read with a private argument file for platform-specific records. For example, an operation lookup argument file contains planId, operationId and view. A comparison lookup contains planId, captureId and view. The action names are operation and comparison. Native views include summary, journalSources, journals, lines, issues and files where supported; actions lists the exact fields and the platform guide lists the native view choices.

A response import retains the exact original response-file set. The original adapter normalizes its native ID and actor consistently before passing it to importResponses, while retaining the source JSON digest. Reconciliation compares the capture's ID, actor and source.requestSha256.

Return application uses the original comparison. Its preview shows conflicts, missing rows, assignments, results and skipped entries through the native views. The reviewed command carries csvSha256; the adapter retains or regenerates the original CSV and checks that exact digest before delegating to applyReturn. The CLI never reconstructs the financial rows.

A pending Xero return is recovered through the original return intent's returnId and previewSha256. Reconciliation follows the retained return link and sourceReturnSha256. It does not mint another return ID, import another response or start a provider request.

The native cancellation record exposes its retained reason but not a separate cancelling-actor field. A reconciled cancellation therefore reports its identity basis explicitly: original plan UUID and retained reason. The client does not claim an actor match absent from that record.

## Original files and exact downloads

Use the original plan, response, operation or comparison file inventory to choose a filename and SHA-256. The download helper receives those original bytes through the existing retained reader and verifies the complete digest. It refuses to replace an existing output file.

A QuickBooks selection has this shape:

~~~json
{
  "kind": "qbo",
  "planId": "ORIGINAL_PLAN_UUID",
  "file": "journal-entry.json"
}
~~~

Response files additionally select the original responseId. Depending on the native record, file names include response.json, result.json, returned.csv and return-request.json. Other original plan files include plan.json, handoff.json, accountant.csv, accountant-return.json and review.html.

A Xero selection has kind:"xero", planId and the exact file name from the original retained inventory. This may be a plan or context file, a manual-journal JSON file, or an original captures/, operations/ or returns/ path. Do not replace the returned filename with a guessed basename.

~~~sh
starforge merchant-accounting-platforms download \
  --url "$ACCOUNTING_MCP_URL" --workspace "$ACCOUNTING_WORKSPACE" --platform xero \
  --selection "$CASE_DIR/original-file-selection.json" \
  --sha256 "$ORIGINAL_FILE_SHA256" --out "$CASE_DIR/original-file.json"
~~~

Returned filenames and source digests are native artifact identities. Downloading a provider request or result is not proof that the corresponding provider operation succeeded; its native status and comparison remain the source of that conclusion.

## Embed the original customer client

Use an existing initialized structured-result MCP caller:

~~~js
const client = createAccountingPlatformClient({
  workspace: selectedWorkspaceAlias,
  platform: 'qbo',
  call: existingMcpCall,
});

const preview = await client.preview('create', {
  source: selectedOriginalInputAlias,
});
const operation = accountingPlatformOperation(preview);

// The application's existing durable store retains the full preview and operation.
await originalApplicationStore.savePrepared({ preview, operation });

const before = await client.reconcile(operation);
if (!before.found) {
  await originalApplicationStore.markSending(operation);
  await client.command(operation);
}
const result = await client.reconcile(operation, {
  recover: true,
  onRecovery: command => originalApplicationStore.recordRecovery(operation, command),
});
await originalApplicationStore.saveNativeResult(operation, result);
await client.disconnect();
~~~

The store methods in this example belong to the receiving application; they are not additional SDK exports. For an existing HTTP destination, use prepareAccountingPlatformOperation and runAccountingPlatformOperation to get the provided private journal instead of implementing another send-history store. In particular, retain the CLI's no-repeat behavior for uncertain context captures.

Direct SDK command validates and sends the exact retained command. Reconcile checks its original returned identity. Applications should preserve both steps and retain the request before command; a successful transport reply by itself is not the reconciliation result.

SDK read accepts only declared native read actions. Mutation calls go through a validated preview/operation and command. Argument validation uses the adapter's original wire schemas. An explicitly supplied workspace that differs from the selected alias is rejected rather than silently replaced.

## Reader, operation and workspace lifetime

The client uses the same maintenance reader as accounting downloads. Complete downloads release their original read. Partial streams can be returned early and are released when their iterator closes. If the caller opens a retained read through its existing connection, registerFileRead/readId and releaseFile let it keep that reader under the same ownership.

disconnect drains only this caller's owned file reads and preserves the original workspace and provider operations. The client returns the operation IDs it observed from its own operate calls through retainedOperations; those remain addressable through the original native controller after this caller disconnects.

close is an explicit workspace close. It drains the caller's work and invokes the existing workspace close path. The native controller owns cancellation, completion and retained operation state. Read the original controller state after reopening instead of assuming that ending a transport erased its jobs.

maintenanceCommand('pause', ...) drains admitted customer calls before the existing maintenance pause. After resume, use the same original source IDs and digests with a newly owned read. The original response, archive and platform bytes remain in their existing source custody.

## Output, errors and recovery state

The CLI writes machine-readable JSON. Error records preserve the native or customer code and, for a prepared operation, the original operationDirectory, platform and action.

| Exit code | Meaning |
| --- | --- |
| 0 | A local preparation, read, or exact observed result completed. |
| 3 | The original result is not observed yet, or its retained operation is still pending. |
| 2 | An error, native FAULT, FAILED or INTERRUPTED outcome requires inspection. |

The returned native object is preserved with found, pending, submissionAttempted, previouslyAttempted and recoveryAttempted. An uncertain reply stays in the private state record even when a later lookup finds the original result.

Use the existing operation directory for later reconciliation. Retain its original request, source files and native IDs when moving machines or reopening a session. Keep the same configured endpoint, workspace and token environment name; resolving a missing reply does not justify selecting another company or tenant.

This guide describes the implemented customer protocol. Native provider results and release acceptance belong to the original platform operation and its retained result; examples and previews do not assert a live provider transaction.
