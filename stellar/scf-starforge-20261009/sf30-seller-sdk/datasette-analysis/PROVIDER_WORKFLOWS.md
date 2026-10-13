# Installed provider workflows

The **Provider sources** desk brings the maintained Shopify Payments, Xero contacts and Odoo target readers into the existing Source workflows operator. It uses the original workspace, capability, provider CLIs, preparation engines and native Analysis request runner.

The desk retains the complete provider acquisition and its selected inputs. An operator can inspect that source, prepare or reconcile the customer workflow, configure the original Analysis request, produce its native result, and transfer the source and result together. A receiving installation can reopen the complete handover and configure its received preparation against its own selected Analysis installation.

The existing **Business requests** pane remains the default. Switch to **Provider sources** in the workspace mode bar when working with provider acquisition or a handover.

## 1. Select the maintained installation

Use the current selected product, including the existing Python workflow engine, Analysis installation, original provider subtree and these provider desk files:

| File | Purpose |
| --- | --- |
| `provider_workflows.py` | Durable provider operation controller and exact existing CLI invocation |
| `provider_workflows.mjs` | Browser operations, drafts, source review, receiving and downloads |
| `provider_workflows.css` | Responsive provider desk styling |
| `PROVIDER_WORKFLOWS.md` | This complete operating guide |

The maintained installation source binding includes the complete `partner-workflows/` subtree. Its selected original provider files accompany provider captures and handovers according to the original CLI contracts. Retain the whole selected application and its source manifest when installing or transferring the operator.

The managed wrapper accepts an optional `settings.providersFile` referencing the private provider descriptor. Review, startup and live health bind that descriptor and the selected absolute Node executable. Keep this configuration on the operator host with the existing installation settings. Each original business request retains its own bound source configuration.

For direct use of the maintained Python entrypoint:

```sh
python3 workflow_cli.py serve \
  --workspace /absolute/original/workflow-workspace \
  --providers /absolute/private/providers.json \
  --port 0 \
  --open
```

Use the installation's actual Python runtime and paths. The existing `--configuration` option can still select the default business request profile when that installation needs one. A provider-configured request receives its own configuration from its completed preparation and selected installation.

Without a provider descriptor, the original operator still opens. The provider pane explains that no provider connections are configured. This is a useful installation check before adding an authorized provider account.

## 2. Private provider descriptor

The descriptor selects existing host resources. The browser receives connection IDs, readable scope, environment reference names, availability, input IDs and installation IDs. The host resolves their exact paths and executable.

A minimal descriptor for opening an empty provider desk is:

```json
{
  "schema": "stellar-forge.provider-workflows.v1",
  "node": "/absolute/existing/node",
  "connections": [],
  "inputs": [],
  "installations": []
}
```

`node` must name the actual installed executable by absolute path. The controller does not substitute an executable found elsewhere on PATH.

### Connections

Each configured connection has the following shape:

```json
{
  "id": "original-connection-id",
  "title": "Readable original account and scope",
  "provider": "odoo-target",
  "tokenEnv": "EXISTING_ODOO_TOKEN_ENV",
  "capture": {},
  "maxAttempts": 8,
  "timeoutSeconds": 60
}
```

This example describes the wrapper fields. Replace the empty `capture` object with the complete actual provider selection described in the corresponding original guide. Do not submit an empty capture as an account selection.

| Provider ID | Complete capture selection and preparation |
| --- | --- |
| `shopify-payments` | [SHOPIFY_PAYMENTS.md](partner-workflows/SHOPIFY_PAYMENTS.md): installed shop, exact API version, original payout window, explicit optional unassigned window, source operation and currency/transaction-role policy |
| `xero-contacts` | Original Xero capture and preparation guide in `partner-workflows/`: actual tenant, contact capture selection, original review and mapping decisions |
| `odoo-target` | [ODOO_TARGET.md](partner-workflows/ODOO_TARGET.md): exact origin/database/version, expected user, ordered allowed companies, selected External ID scope and explicit existing-parent alias policy |

For Xero, the controller accepts the original tenant as `tenantId` (or the original `tenant` field), plus supported `pageSize` and `maxRecords`. Shopify and Odoo use the complete original `capture --config` document unchanged.

Keep the token in the existing host environment named by `tokenEnv`. No token value belongs in `capture`, the provider descriptor, browser drafts or business request parameters. The browser shows the reference name and whether it is currently available. A missing credential blocks a new source capture; retained source operations remain inspectable.

Use a fresh source selection and provider operation when the original account or scope changes. Replaying an existing operation retains its original submitted inputs and bound source identities.

### Host-owned input files

Inputs identify actual retained customer files or previously downloaded handovers:

```json
{
  "id": "original-contact-input",
  "title": "Original supplied contact preparation",
  "kind": "contacts",
  "path": "/absolute/original/contact-input.json"
}
```

The browser offers inputs only for the appropriate declared kind.

| Kind | Use |
| --- | --- |
| `contacts` | Original complete contact input for Odoo target preparation |
| `native-result` | Actual importer result for Odoo reconciliation |
| `native-delivery` | Original native delivery ZIP to accompany a provider handover |
| `provider-handover` | Complete downloaded provider handover received from another operator |
| `decisions` | Retained original decision document; the Xero preparation form accepts the complete reviewed JSON |
| Other declared kind | Visible host inventory; available only when the corresponding operation supports it |

Input paths remain on the host. An operator chooses the configured input ID. For a handover received from another installation, the receiving host places the complete original downloaded file at its actual path and registers it as `provider-handover`.

### Analysis installations

Each installation selects the existing Analysis workspace, parser and complete original source archive:

```json
{
  "id": "original-analysis-installation",
  "title": "Existing customer Analysis installation",
  "analysisWorkspace": "/absolute/original/analysis-workspace",
  "operationId": "the-original-32-lowercase-hex-analysis-operation-id",
  "parser": "/absolute/original/parser",
  "sourceArchive": "/absolute/original/source-archive"
}
```

Replace every illustrative value with the actual installation identity. In particular, `operationId` is the existing 32-character lowercase hexadecimal Analysis operation ID. It is distinct from provider operation IDs and customer business request IDs.

The controller binds the selected installation and generated source files before explicit execution. The original request ID, profile, correlation and business parameters come from the complete business request supplied by the operator.

## 3. Capture and inspect a source

1. Open **Provider sources**, then **New**.
2. Select the installed connection. Review **Selected account and original source scope** and the credential reference.
3. Select **Capture source** and use a descriptive title.
4. Submit the operation. Its ID is retained before the request is sent.
5. Inspect **Source and result**, **Complete files**, and **Attempts and history** as the original capture progresses.
6. After completion, use **Inspect capture** or download the complete operation record and original source files.

The original provider reader defines source completeness. Shopify retains the selected payouts and complete related transaction acquisition under its observed pass contract. Odoo retains the selected original aliases, partners, ancestor chain, schema and identity observations. Xero retains its original tenant capture and review inputs. The operator exposes these original outcomes and their raw files.

A capture must reach **Complete** before it appears as a source for preparation. Ordinary operation selectors use the selected connection. Xero comparison can select complete captures from another configured Xero connection; the original compare engine still checks their actual tenant and source relation.

Use the operation search for a title, account or original operation ID. The provider filter narrows the retained list without changing any original source.

## 4. Prepare the customer workflow

### Shopify Payments

Choose the complete capture and **Prepare workflow**. The existing retail preparation engine consumes the exact retained input, including the original transaction roles and currency scales. Review its totals, exceptions and prepared source inventory. Unknown or unresolved source conditions remain visible in the original outcome.

Select an Analysis installation during preparation when required by the existing preparation flow, or select it explicitly during native configuration.

### Xero contacts

Use **Review Xero contacts** for the complete capture. Download and inspect its original review, then provide the complete reviewed decision object in **Original Xero review and mapping decisions** when preparing.

The JSON control can load a local original decision file. It keeps the entire supplied object in the browser draft and submitted operation. It does not generate mapping decisions from a partial table preview.

Use **Compare Xero captures** to compare two complete original contact editions. Both source captures remain retained. Comparison checks and review requirements come from the maintained Xero engine.

### Odoo target baseline

Choose the complete target capture, the configured original `contacts` input and **Prepare workflow**. The existing contacts engine receives the source records plus the actual target baseline.

Keep the target scope and alias review visible. Several External IDs can refer to one physical Odoo partner. The original source adapter preserves those aliases and identifies ambiguous source mappings. An incompatible selected alias, missing parent or incomplete target baseline remains a preparation review issue.

### Odoo after-import reconciliation

After the existing importer returns its actual result, capture the current original Odoo target scope again. Select:

- The complete new target capture.
- The original completed baseline **preparation, reconciliation, received bundle or configuration**.
- The actual configured `native-result` file.
- The original installation when required.

Then choose **Reconcile import result**. The controller follows the baseline's retained capture lineage; the original engines verify the target scope and actual importer result. The original importer continues to own customer writes.

## 5. Configure and run original Analysis

A complete preparation, reconciliation or received handover can become the input to **Prepare original analysis**. A previously completed configuration can also be selected when the original flow needs its retained preparation.

Select the existing Analysis installation and load the **complete original business request**. Preserve its original request ID, profile, correlation and parameters. The controller delegates source configuration to the maintained workflow CLI and retains the generated request and configuration as original operation artifacts.

A completed configuration exposes **Run original Analysis request**. This is the explicit transition into the existing Workflow runner. The server:

1. Reads the verified completed preparation and installation bindings.
2. Accepts the original request in the existing Workflow.
3. Binds that request's configuration under the original workspace lock.
4. Starts or reopens the existing native job.

The browser switches to **Business requests** only after receiving the actual request ID. Inspect the original source, queries, reports, workbook, export and receiving outcomes there.

Each request keeps its own bound configuration. Retrying or reopening that request uses the same configuration. The default server profile remains the default for its own intended request flow.

A provider operation ID is a source-operation identity. It never replaces the original customer request ID or the Analysis operation ID.

## 6. Complete handover

Choose **Prepare complete handover** from a complete preparation, reconciliation, received bundle or retained configuration. Select its original capture and preparation. For an Odoo reconciliation, also select the earlier baseline preparation, received bundle or configuration so both original captures remain part of the handover. The controller follows and verifies its actual retained preparation and capture lineage.

There are two mutually exclusive ways to include a native result:

| Choice | Behavior |
| --- | --- |
| **Completed original Analysis request** | Select a completed original request from the controller's native request catalog. The existing Workflow exports its full native delivery and verifies its relation to the prepared source. |
| **Existing original native archive** | Select a configured `native-delivery` input. Its exact original ZIP accompanies the provider handover. |

Choose one native source, or leave both empty when transferring only the complete provider preparation.

Shopify and Odoo use their maintained complete handover commands. Xero uses its original complete prepared source-and-decision bundle and receiver; its separate capture selector is optional because the original retained preparation supplies the source lineage. The controller retains the provider-specific source inventory and exposes original files with byte counts and SHA-256 identities.

Download the complete handover artifact from **Complete files**. Keep the full archive when passing work to another installation. Individual report downloads are useful for inspection, while the complete handover preserves the source, preparation and selected native companion together.

## 7. Receive and continue on another operator

Open **Receive handover** using the intended installed provider connection. Choose exactly one source:

- **Retained handover operation**: an existing completed handover in this workspace and connection.
- **Complete handover file from another operator**: a host-configured `provider-handover` input containing the complete downloaded original file.

The controller invokes the original provider receiver and retains its received paths and inventory. Where a native companion is present, the existing Workflow receiving interface handles that original archive. **Received original workspace** shows the actual Workflow and Analysis directories, original request identity and complete receiving record. Copy either directory or download the full record, then reopen that directory through the existing installed Source workflows or Analysis application. These paths identify the actual restored workspaces; the original archive and receiving result remain downloadable. The controller also accepts the host input kind `handover` for a registered complete provider bundle.

After completion, **Prepare original analysis** can use the received preparation. Select the receiving installation and the intended complete original business request. Source paths are bound to the actual received files by the original configuration flow.

Keep the original handover file, complete receiving operation and native receipt together when the work passes onward. The receiving source remains reviewable without requiring the sending browser's local storage.

## 8. Drafts, exact replay and interrupted replies

The browser keeps editable drafts separately from submitted operations. Drafts are scoped to the original workflow workspace and browser origin.

**Download browser draft** preserves the selected connection, action, title, fields and provider operation ID. **Import browser draft** restores it only for the same original workspace and an available configured connection. Earlier drafts remain available in the draft selector.

Before a POST, the browser retains the complete exact submission. If a reply is interrupted, the pending panel offers:

- **Read original operation** to reconcile the server record.
- **Continue same request** to submit that same retained body again.
- **Download original request** to preserve the exact submitted document.

An existing ID cannot be reused with changed inputs. While a request is pending, a changed same-ID submission is rejected before the retained body can be overwritten. Reconcile or continue that exact original request before submitting another operation; a separate new draft can remain saved meanwhile. Use **Start a new operation** for a changed source selection or successor. A successful reconciliation checks the returned operation against the complete original submission, including whether a title was originally present.

The controller's full operation record exposes `submission`. The browser uses that exact body for continuation; it does not reconstruct a request from labels or partial results.

For an interrupted capture whose original CLI reports a retained lock, inspect **Observed original lock owner** and reconcile the actual host/PID first. Enter only the returned original owner ID in **Reconciled original lock owner ID** when that original recovery is appropriate. The optional `recoverLockId` is an attempt-level recovery control. It does not change the immutable business submission.

The durable controller owns the running child and operation journal. Closing a browser does not discard the original capture. Read the retained operation before starting any successor.

## 9. Files, source identity and progress

**Complete files** lists each retained artifact's original name, role, byte count and SHA-256. A download is checked against that identity before the browser offers the file.

Small text, JSON, CSV, XML and log files can be opened with **Read**. The desk renders their content as text; report markup and source strings are not executed as browser code. Complete original bytes remain available through **Download**.

**Attempts and history** shows the original start/finish times, exit codes, retained errors and logs. **Download complete operation record** preserves the whole returned operation, submission and artifact inventory.

Polling updates retained operations and details without rebuilding the active draft form. A submitted request remains independent of the browser's editable draft. Opening another workspace never imports this workspace's draft under the new identity.

## 10. Local HTTP contract

All routes use the existing workflow capability and operator origin checks. The UI receives a capability-bearing request helper from `workflow_app.mjs`; it does not maintain an additional credential.

| Method and route | Original behavior |
| --- | --- |
| GET `/api/providers/catalog` | Installed selections, current workspace ID, credential-reference availability, input/installation IDs and completed native request catalog |
| GET `/api/providers/operations` | Retained provider operations |
| GET `/api/providers/operations/{id}` | Complete original operation, exact submission, attempts, outcome and artifacts |
| POST `/api/providers/operations` | Submit or continue one exact provider operation |
| GET `/api/providers/operations/{id}/files/{fileId}` | Download a verified retained artifact |
| POST `/api/providers/operations/{configureId}/run` | Start or reopen the configured original native request; request body is `{}` |

Submission shape:

```json
{
  "operationId": "stable-original-provider-operation-id",
  "connectionId": "configured-original-connection",
  "action": "inspect",
  "inputs": {
    "captureOperationId": "complete-original-capture-operation-id"
  },
  "title": "Original capture inspection"
}
```

Supported action inputs:

| Action | Inputs |
| --- | --- |
| `capture` | Empty object; installed original capture selection supplies source scope |
| `inspect` | `captureOperationId` |
| Xero `review` | `captureOperationId` |
| Xero `compare` | `beforeOperationId`, `afterOperationId` |
| `prepare` | `captureOperationId`; Odoo `contactsInputId`; Xero complete `decisions`; optional `installationId` |
| Odoo `reconcile` | `captureOperationId`, `baselineOperationId`, `nativeResultInputId`; optional `installationId` |
| `handover` | `captureOperationId`, `preparedOperationId`; Odoo baseline when applicable; optional `nativeRequestId` or `nativeDeliveryInputId` |
| `receive` | Exactly one of `handoverOperationId`, `handoverInputId` |
| `configure` | `preparedOperationId`, `installationId`, complete original `request` |

The operation statuses are `QUEUED`, `RUNNING`, `COMPLETE`, `INTERRUPTED` and `FAILED`. The readable browser state **Needs review** corresponds to `FAILED`; the retained original error determines the next action.

## 11. Source and receiving review

For an installed source change, retain the complete current controller, UI, server, original workflow engine, source CLI bindings and provider subtree. The installation's current manifest and exact executable binding define the selected product.

The additive browser mount is:

```js
mountProviderWorkflows({
  root,
  api,
  request,
  notify,
  onOpenRequest
});
```

`request(path, options)` returns the original capability-bearing raw HTTP response. `onOpenRequest(requestId)` selects the returned request in the existing Business requests pane. The mount returns `start`, `refresh`, `show` and `destroy`.

A useful receiving course follows the actual original source:

1. Open the selected installation and inspect its real catalog.
2. Reopen the same workspace in a fresh browser and verify the configured mode and retained operations.
3. Capture only the authorized original account selection.
4. Inspect source, prepare or reconcile, and download the original full records.
5. Configure and run the actual customer request.
6. Handover its source plus completed native request.
7. Receive that complete file on the intended receiving installation.
8. Reopen its source and native outcome, then continue from its received preparation.

An empty configured catalog exercises installation, capability, mode navigation and responsive rendering. A customer capture and full native receiving use the actual source account, input and request supplied by the original operation owner.

## Rendered-product inspection — owner directive, 2026-10-13

**Applies to every current and future peer, provider, local session and cloud worker.** Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing peer must open, run or render the exact outgoing version, look at its actual rendered screen or real screenshots, and operate its important user controls. Capturing screenshots without viewing them is insufficient. Inspect the actual screenshare width and narrow/mobile width where relevant; inspect populated, empty, loading and error states, downloads, exports and reopening.

**All attachments are part of this rule.** Literally open, view, play and use the exact final HTML, PDF, report, slides, spreadsheet, map, image, video, audio, archive and project as the recipient would. Extract archives and open their actual contained deliverables and working project; inspect every applicable report/PDF page. Tests, checklists, source/schema inspection and screenshots merely captured are not substitutes. Fix observed defects within the authorized work and continue delivery.

**Final media must be seen and heard.** For videos, use available high-quality generative media and natural voice generation/TTS instead of robotic default voices. Watch and listen to the final export for pronunciation, pacing, timing and audio alignment. Preserve existing spending, voice and attribution controls. This instruction adds no review queue, restart, watcher or new release permission.

Owner clarification and complete canonical attachment: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949 (operation RENDERED-PRODUCT-POLICY-SWARM-20261013-01, original file F0C8RJVMF54). Carry these attachment and final-media clauses in the instructions actually consumed by delegated workers, alongside the complete standing rule below.

Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized product work before presenting it. Code review, DOM counts, HTTP 200, unit checks and another peer's approval do not replace seeing the actual product. Use plain industrial design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve the real workflows, data and computation.

This inspection is part of delivery and leads directly to concrete repairs. It must not replace implementation and integration, become endless rechecking, create a peer-approval gate, launch broad suites or become a separate verification product. Continue useful authorized source and product work while the exact native/rendered receiving operation proceeds; preserve the actual execution state and existing operation identity.

Persist this rule in every active owner-controlled instruction surface that the provider and workers actually read: global/project AGENTS, CLAUDE, GEMINI and rules files, provider boot instructions, Commons source mirrors, cloud repository instruction copies, and current build/receiving guides. Include it in child assignments. Preserve other owner controls, historical evidence and third-party/vendor instructions. Do not force restarts, add watchers or restart owner-stopped work. Existing project-specific owner cutoffs remain in force.

Bryce's placement instruction: “that rule goes in every policy file the agents read not just a slack ping” and “and not just local sessions or ones from this provider”. Original coordination transport: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999 .

## Retained initial installed receiving course

The initial PR1548 operator course is retained as historical native source packet `8c7ffa20` (332,703 bytes; SHA-256 prefix `fd05051a`) and complete one-command entry `d64a1339` (120,712 bytes; SHA-256 prefix `6f0492e6`). It opens the current application with an empty private provider descriptor, exercises actual browser mode navigation, reopening and a 390-pixel viewport, and preserves the original screenshots, page and result through the established receiving helpers. Its receiving ownership remains the original 9333 installed-provider arm.

The original invocation 1945 returned `409 environment_offline` before CreateProcess at 2026-10-13 10:41:48 UTC, with no native session or output. The subsequent original invocation 2005 also returned 409 before CreateProcess, with no native session or output. Neither invocation remains active. These retained pins describe the initial empty-catalog course; they are not the source entrypoint for the browser-input extension below. The original 9333 receiving owner composes the complete current application and input callback into its same whole receiving course and records the new source identity before invocation. The next customer capture and complete native handover use D156’s actual original account, prepared input and installation when supplied to the existing operation.


## 12. Receive original files in the browser

The **Original input files** section belongs to the same installed workflow workspace. It accepts a file selected by the operator's browser, retains its complete bytes, and makes a completed input available in the original provider operation selectors. An operator can receive a downloaded handover, original contacts, returned import result, native archive or mapping decisions without editing a server path.

Open **Provider sources**, then **Add or reopen an original file**. Choose **New file**, select the complete original file, choose its purpose and enter a useful title. Enter a supplied original SHA-256 when one accompanies the delivery. The browser calculates the complete selected file's SHA-256 with a streaming hasher before sending source bytes; it holds only the current 8 MiB slice for that calculation.

Choose **Retain original file**. Before the first begin request, the browser saves the exact input ID, filename, byte count, title, kind and expected SHA-256 in its workspace-scoped draft. The server owns that immutable input intent. The browser sends fixed 8 MiB chunks, with a smaller final chunk, and supplies each chunk's exact offset and SHA-256. The original server verifies each received chunk before it advances the retained offset.

Completion verifies the entire file and every accepted chunk again on the server. Only a completed input joins the provider catalog. An empty original file is a valid raw transport selection; its use as a business input remains subject to the original provider's source contract. A transport success says that those bytes were retained, not that the selected file is a valid provider bundle or that an import was accepted.

### Purposes and existing operations

| Input purpose | Original use |
| --- | --- |
| Complete provider handover; original handover legacy kind | Receive handover, as `handoverInputId` |
| Original contacts | Odoo Prepare workflow, as `contactsInputId` |
| Returned import result | Odoo Reconcile import result, as `nativeResultInputId` |
| Original native archive | Prepare complete handover, as `nativeDeliveryInputId` |
| Original mapping decisions | Xero Prepare workflow, as the complete original `decisions` object |

Choose **Use this file in an operation** after completion. Select the intended installed connection first. The desk preserves that account selection and the earlier operation draft. If a different action is needed, or the current draft belongs to an uncertain submitted request, it opens a fresh draft for that same selected connection. Useful same-action selections are copied into that new draft; the original pending body stays unchanged. It selects the new input, clears the mutually exclusive local handover or completed-native-request selection where applicable, and leaves submission to the operator. An unconfigured workspace can retain a file; using it in a provider operation requires the original configured connection.

A mapping decision input is opened as original UTF-8 JSON and its full byte count and SHA-256 are checked before it enters the existing Xero decision field. The browser form accepts a decision document up to 8 MiB; larger original documents remain fully retained and downloadable for the existing CLI preparation. Original source preparation, native receive and target import rules are unchanged.

### Pause, reload and exact reselection

**Pause transfer** stops the browser's next work and aborts its current HTTP transfer. The server may already have accepted that chunk. The browser reads the same input's status to determine the actual retained prefix. It never replaces the input or starts a new transfer ID because a reply was lost.

After a reload, open the retained input and reselect the same original file. Filename and length must agree. The browser computes its complete SHA-256 and checks it against the retained original expectation. It also reads and hashes every accepted chunk from the reselected file before sending the next chunk. A different byte sequence fails at that boundary.

If the original begin reply was interrupted before an intent was published, the server returns `PROVIDER_INPUT_NOT_FOUND` with HTTP 404. **Continue original transfer** replays the same browser-retained begin body and ID. A different selection requires **New file**.

**Download transfer draft** preserves the exact workspace identity and original input intent as JSON. **Import transfer draft** accepts it only for that same workspace and refuses a conflicting intent for an existing input ID. Browser storage contains metadata and source identity, not the file's bytes. The actual original file must be selected again before continuing an incomplete upload.

A fresh browser can select an existing input from the server's retained list without the sending browser's local storage. A completed file can be opened and downloaded without reuploading it. A different workspace's input or draft cannot be rebound under this one.

### Full original downloads and receipts

A completed input offers **Download complete original file** and **Download input receipt**. The receipt contains the original byte identity and chunk inventory. The file download is checked against its complete byte count and SHA-256. Where the browser supports its file-save picker, the download is written incrementally to the selected destination and committed only after those checks. The fallback uses the browser's Blob download mechanism while hashing the response stream; it does not create a whole-file JavaScript ArrayBuffer.

The file list includes interrupted and complete transfers. **Read original status** and **Refresh files** retrieve their actual server records. A failure message preserves the same transfer for inspection and continuation. Refreshing retained file state does not rebuild an active provider operation draft.

### Original input HTTP interface

All input routes retain the existing capability authentication and origin checks. The browser supplies no server path, executable, account or credential value.

| Method and route | Body or result |
| --- | --- |
| POST `/api/providers/inputs` | Immutable `{inputId,kind,fileName,title,bytes,sha256}` selection |
| GET `/api/providers/inputs` | `{schema,workspaceId,inputs,chunkBytes}`; list summaries omit chunk arrays |
| GET `/api/providers/inputs/{id}` | Complete status with ordered original chunk identities |
| POST `/api/providers/inputs/{id}/chunks` | Binary body; exact `X-Input-Offset`, `X-Content-SHA256` and browser-supplied Content-Length |
| POST `/api/providers/inputs/{id}/complete` | `{sha256}`; full original identity verification |
| GET `/api/providers/inputs/{id}/file` | Complete original retained bytes |

IDs are `received-` followed by 32 lowercase hexadecimal characters. Filenames are plain original names, at most 240 UTF-8 bytes, without path separators or control characters. Titles are 1–300 characters without control characters. The server accepts a nonnegative safe integer byte count. Chunk bodies are exactly 8,388,608 bytes except the final remaining bytes. Chunk replies contain the acknowledged original `chunk` and `replayed` state; full status carries the whole chunk array.

The browser module is `provider_inputs.mjs`, mounted by the original `provider_workflows.mjs`. Its `mountProviderInputs({root,request,workspaceId,onComplete,onUse,notify})` returns `start`, `refresh`, `select`, `show` and `destroy`. The existing server serves this selected module and the installation binds both browser and Python input modules alongside the original provider source.

### Actual receiving course and limits of its result

The original installed-provider receiving owner runs one complete native course with the selected application and its original helpers. The browser callback accepts an actual local file descriptor: `{path,name,bytes,sha256,kind,title}`. It operates file selection, first accepted chunk, pause, reload, exact reselection, completion, full download and a new browser/server reopen. It retains the actual input ID, original returned status, downloaded byte/hash comparison and desktop/narrow screenshots.

When no customer provider bundle has been supplied, the course may use its already acquired, exact original Chrome-for-Testing publisher archive as a file-transport observation. Its title explicitly identifies that runtime source; its bytes and hash remain the original publisher's. The course must not call a provider receiver on that archive or describe it as a customer source-workflow archive. The result proves raw file custody and the operated interface for that actual source. The original customer capture, source preparation and native acceptance remain with the actual supplied account and business input.

Apply the full owner instruction above to this new receiving course: view the exact rendered screenshots, operate its controls, open the complete delivered files and working workspace, and fix observed defects. Retain the actual native outcome separately from source review or compilation; neither is rendered readiness.
