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

The customer covers the original manual response-import workflow and configured native posting. The native QuickBooks plan retains its normalized company and accounts, original handoff and accountant rows, editable journal and review. Both paths retain the actual provider response bytes and original accountant-return result.

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

### Configured native company and journal posting

The same QBO client can inspect the host's native connection, capture the actual company and account pages, preview a reviewed journal and retain its native posting. The host declares platforms.qbo using either its original realmId, environment and token environment name, or the reviewed OAuth company described below. Optional minorVersion remains part of the original connection identity. The SDK uses that host-owned connection for provider requests.

Use read --action connection, or SDK connection(), to inspect the current configured destination. Native company capture is read --action company-fetch or SDK companyFetch(args). Supply the actual realmId and environment, and choose summary, accounts or snapshot. The snapshot view includes the full original company and its sourceDocuments; the accounts view is paged. expectedCompanySha256 can pin a subsequent requested view to the same original company content. This capture performs native GET requests and does not create a journal.

Native posting has two customer preview actions:

| Action | Selection | Execution behavior |
| --- | --- | --- |
| post | Original reviewed plan, current revision, stable posting UUID, actor, ISO createdAt and expectedParentId | Native preview binds the company, original journal bytes and full posting intent before the first submission. |
| post-resume | Existing nativePost UUID, current revision, actor and original previewSha256 | Only explicit execute invokes the original native continuation; reconcile reads its retained outcome. |

Use post only for a journal with no retained native posting. Its native preview returns the original planSha256, exact journal requestSha256, previewSha256 and postId. Prepare and execute that returned preview through the same durable operation directory. The original controller retains the posting intent and request bytes before external dispatch.

After an uncertain response, select the existing nativePost from the original plan. Preview post-resume using that operation's exact ID and digest, then prepare a new directory for that explicit resume decision. Reconcile alone will return executionRequired:true when this original operation still needs the prepared provider continuation. It will not call resumePost, query QuickBooks or repeat a journal POST.

~~~sh
starforge merchant-accounting-platforms preview \
  --url "$ACCOUNTING_MCP_URL" --workspace "$ACCOUNTING_WORKSPACE" --platform qbo \
  --action post-resume --request "$CASE_DIR/native-resume-arguments.json" \
  --out "$CASE_DIR/native-resume-preview.json"

starforge merchant-accounting-platforms prepare \
  --dir "$CASE_DIR/native-resume-operation" \
  --url "$ACCOUNTING_MCP_URL" --workspace "$ACCOUNTING_WORKSPACE" --platform qbo \
  --preview "$CASE_DIR/native-resume-preview.json"

starforge merchant-accounting-platforms reconcile \
  --dir "$CASE_DIR/native-resume-operation"

starforge merchant-accounting-platforms execute \
  --dir "$CASE_DIR/native-resume-operation"
~~~

The argument file contains planId, revision, id, actor and previewSha256 from the selected native posting and current operator decision. The caller does not choose a new posting ID when resolving the original request. A BOOKED operation is adopted by both execute and reconcile without another submission.

The native continuation first uses any retained response that can finish locally. When provider access remains necessary, the original controller keeps the same request UUID, reviewed request bytes, company, environment and request URL. It queries the original journal identity and retains native query/read/post attempts. An already observed journal is not silently replaced by another posting. The customer does not implement its own provider retry algorithm.

| Native posting state | Customer interpretation |
| --- | --- |
| PREPARED or RUNNING | Original intent is retained or its native call is running; inspect the same operation. |
| UNCERTAIN or RETRYABLE | Original outcome requires continued observation or an explicit native resume. Retained retryAt remains authoritative. |
| RECEIVED | Original provider source is retained; the native controller can finish its accountant-return linkage. |
| BOOKED | The original native posting is linked to its retained accountant return. |
| FAULT or CONFLICT | Inspect the original native response, attempt records and lastError before selecting a further native action. |

This distinction also appears in CLI status: pending native posting returns exit3; native FAULT or CONFLICT returns exit2. Original QBO response PENDING recovery remains a separate local-return path and can run during reconcile. That local recovery never invokes the native posting continuation.

Read plan view native-attempts to inspect the complete original attempt inventory. Native files use kind:qbo, planId and nativePost:true. The posting's root files are intent.json and request.json. For an actual retained attempt, additionally supply its original attemptId and choose response.json or receipt.json. The same download helper checks the returned source digest and releases only its owned reader. Keep the returned file metadata rather than constructing paths from a guessed attempt number.

### Reviewed OAuth company in the same customer connection

The host can attach an already reviewed QuickBooks company to this same accounting workspace. Complete the original [QuickBooks connection and company-selection workflow](../../stellar/scf-starforge-20261009/sf30-seller-sdk/oauth-connections/QUICKBOOKS.md) first: register the application, connect and review the returned grant, capture the actual company and chart, and save the exact reviewed selection. That workflow owns consent, renewal, selection replacement and revocation.

In the existing workspace's platforms.qbo configuration, the host operator supplies:

~~~json
{
  "oauth": {
    "connectionsFile": "../oauth-connections.json",
    "selectionDirectory": "../qbo-company"
  }
}
~~~

The two paths resolve from the merchant configuration file's directory. connectionsFile is the existing OAuth host registry configuration; selectionDirectory contains the original saved company selection. The optional expectedSelectionSha256 pins selection.integrity.sha256 from that reviewed record. Copy the actual 64-character lowercase digest when this deployment requires a fixed selection. A changed selection then fails open with ACCOUNTING_QBO_SELECTION_CHANGED so the operator can review the configuration and saved choice together.

OAuth mode obtains realmId, environment and minorVersion from that selection. The configuration accepts oauth on its own; combining it with tokenEnv, realmId, environment or minorVersion is rejected. Existing token-environment configurations continue to use their original behavior. Full host setup remains in [ACCOUNTING-PLATFORMS.md](ACCOUNTING-PLATFORMS.md).

The customer connects through the existing MCP endpoint. Its MCP_ACCESS_TOKEN authenticates that customer connection. The host resolves its QuickBooks connection directory and application secret through the original private environment; those provider values do not enter the customer request or prepared-operation directory.

#### Read and retain the selected company identity

The same installed commands open the existing alias and inspect the company:

~~~sh
starforge merchant-accounting-platforms open \
  --url "$ACCOUNTING_MCP_URL" --workspace "$ACCOUNTING_WORKSPACE" --platform qbo

starforge merchant-accounting-platforms read \
  --url "$ACCOUNTING_MCP_URL" --workspace "$ACCOUNTING_WORKSPACE" --platform qbo \
  --action connection

starforge merchant-accounting-platforms status \
  --url "$ACCOUNTING_MCP_URL" --workspace "$ACCOUNTING_WORKSPACE" --platform qbo
~~~

No request file is needed for read --action connection. In an embedded client, use await client.connection(). This refreshes the original local registry status and reports the saved selection; it does not acquire a bearer or make a QuickBooks request.

| Returned field | Meaning for the receiving operator |
| --- | --- |
| realmId, environment, minorVersion | Original native destination selected for this accounting owner. |
| selection.id and selection.integrity.sha256 | Exact reviewed selection opened by this owner. Retain both with the handover. |
| selection.companyName, baseCurrency, accountCount, selectableAccountCount, companySha256 and capturedAt | Original reviewed company snapshot and chart summary, including its capture identity. |
| selection.review | Original reviewer and reference for the company choice. |
| authorization.alias, profileSha256 and grantId | Original registered connection and reviewed authorization bound to the selection. |
| authorization.bindingMatches | Whether the current local alias, source, profile, grant, realm and environment still match that choice. |
| authorization.state, ready and lastError | Current original grant state and local admission result. Unavailable or closed ownership is explicit. |
| connection | Current native grant projection, including its retained refresh deadlines; null when unavailable. |
| provider | Null before first provider acquisition; afterward the original provider's public lifecycle snapshot. |

The top-level available and authorization.ready fields describe current local grant and binding readiness. Remote permission or revocation is learned through the next explicit native provider operation. A successful connection read therefore establishes the saved selection and local status, rather than proving a new provider request succeeded.

Before open, sources reports configured OAuth mode and any expected selection digest. Read connection after open to receive the selected company identity. Use that returned realmId and environment for a deliberate company-fetch. As described above, company-fetch performs the native company/preferences/account reads; its snapshot output retains the complete original source documents. The saved selection's earlier company snapshot remains distinct from a later fresh capture.

#### Continue historical work and recover authorization

Opening a revoked or replaced grant retains the original workspace's journals, accountant returns, native attempts and files. Use status and plan to choose the saved operation, ordinary reconcile to observe its exact result, and download to receive the selected original files. Native response or return recovery can complete already retained local bookkeeping through the original controller. Customer read and download ownership, digest checks and close behavior stay unchanged.

For a new native company capture or an explicit post or post-resume, the same host delegates to the original reviewed OAuth client. It rechecks the selected binding before obtaining provider authorization. Read authorization.lastError for the original grant or binding error. Disconnect removes the active grant and realm from the native registry, so an earlier saved selection can report QBO_OAUTH_COMPANY_CHANGED until the replacement grant and company are reviewed; other unavailable-grant states can report QBO_OAUTH_GRANT_REQUIRED. Keep that exact error and the existing prepared request. Refreshing a status view does not reauthorize the account.

Reconnect through the original connection manager, review the resulting grant and company, and save the new selection through the linked workflow. Token renewal within the same reviewed grant preserves the selection. Replacing the grant or company requires a new explicit selection. When a deliberately changed deployment pin is in use, update expectedSelectionSha256 and reload the original merchant host with that updated configuration. A workspace pause/resume or close/open within the same running host keeps its existing configured pin.

An already open accounting owner retains the selection it opened. After the host operator saves a replacement selection, use the existing maintenance pause/resume or accounting close/open workflow to reopen that same workspace and adopt it. Finish the owner's admitted operations and readers through the maintained lifecycle first. Read connection again and compare the returned selection, realm and environment with the reviewed replacement.

Keep every historical plan, native posting UUID, request digest and accountant-return identity. Reconnection supplies authorization to an existing native operation only when its original company, environment and request checks still match. It does not rewrite a journal to point at another company. A BOOKED posting remains adopted without another submission; an unfinished native posting still uses its explicit prepared post-resume decision and original request history.

The host closes the original QBO and Xero controllers before releasing the acquired provider and OAuth registry. Customer disconnect keeps its existing meaning: drain only the client-owned calls and readers and release that connection. The separate closeWorkspace operation closes the owned accounting workspace. This gives the receiving operator a single accounting lifetime across configuration, review, result recovery and delivery.

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

disconnect drains only this caller's owned file reads and preserves the original workspace and provider operations. The client returns the operation IDs it observed from its own operate calls through retainedOperations; the same custody view includes original native QBO posts observed from post and post-resume calls. Those IDs remain addressable through the original native controllers after this caller disconnects.

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

