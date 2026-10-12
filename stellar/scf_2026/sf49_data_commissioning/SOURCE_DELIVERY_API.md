# SF49 source delivery in the original commissioning desk

This component retains large source files beside the original saved SF74 case. It invokes the original SF49 preparation and receiving functions and the original SF74/SF77 workorder replay. It adds no case store, payment process, diagnostic producer, or customer-acceptance authority.

## Native host contract

Import the component from the existing SF74 server:

~~~js
import {openSourceEditionDelivery}
  from '../../scf_2026/sf49_data_commissioning/source-edition-delivery.mjs';
import {createSourceEditionDeliveryRoutes}
  from '../../scf_2026/sf49_data_commissioning/source-edition-http.mjs';

const sourceDelivery = await openSourceEditionDelivery({
  directory: privateSourceBundleDirectory,
  python, environment,
  resolveInputs,
  attachBundle,
});
const sourceRoutes = createSourceEditionDeliveryRoutes({service:sourceDelivery});
sourceRoutes.configure(originalHttpServer);

// In the original authenticated request handler, before reading a JSON body:
if (await sourceRoutes.handle(req, res, {origin:actualBoundOrigin})) return;

// In the original host's shutdown:
await sourceRoutes.close();
~~~

The original host remains responsible for its authentication and bound loopback listener. The route additionally checks the actual Host, Origin, and Fetch-Site. Pass the trusted actual origin as `http://127.0.0.1:PORT`, without a trailing slash. The host must route these paths before its ordinary JSON reader. Large bodies are raw PUT streams. Call `sourceRoutes.configure(server)` before listening: it removes Node's whole-request deadline that would otherwise cut off a valid large upload, while preserving the original header deadline. Each raw upload has a two-minute inactivity timeout and retains its exact declared byte ceiling.

### Resolve the saved original input

~~~js
async function resolveInputs({
  caseId, caseRevision, operationId, directory, signal
}) {
  // Read this exact saved version through the original case store.
  // Use the original runtime-handoff and owner-terms functions.
  // Retain the first resulting files under this operation's directory.
  return {handoff: "/absolute/original-support.json",
          terms: "/absolute/original-terms.json"};
}
~~~

The callback must retain and return the same first handoff and terms bytes for the same operation. In particular, an interrupted retry must not regenerate the native handoff's original timestamp. The service hashes both files before accepting its request, copies them into its own original-inputs directory, and checks those same pins on continuation. No support or terms bytes are sent through browser JSON.

A missing current case revision is a native conflict, not permission to select a newer case silently. The operator can save another case edition and start a separately identified source transfer.

### Attach the verified source to that case

~~~js
async function attachBundle({
  caseId, expectedRevision, requestId, actor, descriptor,
  directory, loadWorkorder, signal
}) {
  const native = await loadWorkorder();
  // Use the original case CAS and commissioning command.
  // Retain a compact source reference to descriptor; full files stay outside
  // the case's inline materials and JSON boundaries.
  return {caseId, revision, commissioningRevision, editionId};
}
~~~

The callback must inspect the original case's recorded request before rejecting a stale expected revision: a previous attachment may already have committed while its HTTP or local result was lost. Repeating the same request ID and payload returns that original case result. It must not create a second workorder after an ambiguous response.

The callback result is compact JSON, at most 2 MiB. It contains the resulting case/commissioning identities, not the full case, handoff or file contents.

`loadWorkorder()` runs original SF49/SF74/SF77 validation and returns:

~~~js
{
  summary, manifest, request,
  result: {packet, html, checklist},
  inputs: {terms: originalTermsBase64, supportText, inputs: originalRuntimeMapping},
  source: {
    workspaceSha256, supportSha256, termsSha256,
    handoff: {bytes, sha256}
  }
}
~~~

This is a server-side bridge to the original commissioning model. Its `terms` encoding matches the original `record_workorder` input. The native handoff uses the installed SF74 `MAX_HANDOFF_BYTES`, including the current workspace's commissioning and Service content, so the host must store its source as a compact external reference when it exceeds the model's inline limit. Retain the original support/workspace SHA, file role, bundle ID, manifest SHA and relative file identity in that reference. Do not put its Base64 representation into the commissioning record or the saved case JSON.

The descriptor schema is `stellar-forge.sf49.source-bundle-reference.v1`:

~~~js
{
  schema, id, caseId, caseRevision,
  operationId, bundleId, manifestSha256, generatedAt,
  workOrderRef, sourceKind, nativeSource, nativeReplay,
  nativeSourceMatches, runtimeSource,
  files: [{path, role, bytes, sha256}]
}
~~~

The descriptor includes the exact original manifest as a named file. It does not claim that the customer accepted a deliverable or that a payment occurred.

## Browser panel

Serve the two original component assets through the provided routes. Add the stylesheet to the existing document, then mount inside its current commissioning section:

~~~html
<link rel="stylesheet" href="/commissioning-source/panel.css">
~~~

~~~js
import {mountSourceBundlePanel} from '/commissioning-source/panel.mjs';

const sources = mountSourceBundlePanel({
  root: sourceBundleElement,
  api: originalJsonApi,
  getCase: () => ({
    id: savedCaseId, revision: savedCaseRevision,
    actor: currentOperator, dirty: originalEditorIsDirty
  }),
  onAttached: async attachment => {
    // attachment.result is the original compact case-CAS result.
    // Refresh only its named case; do not overwrite another open editor.
  }
});
// After the original case selection changes:
await sources.caseChanged();
// When disposing this panel:
sources.close();
~~~

The optional `api(path, input?)` callback returns parsed JSON and rejects non-success responses. With no callback, the panel uses same-origin fetch and the existing browser session. File uploads use same-origin XHR with a native File body and progress. Downloads use direct attachment links and the browser's download path. Neither uses a whole-file ArrayBuffer, Base64, or browser digest allocation.

Closing the panel aborts only its incomplete upload and polling. An accepted original command remains retained on the server. Reopening shows its saved request so the operator can inspect or explicitly continue the same command.

## HTTP interface

Base: `/api/commissioning/source-bundles`.

| Method | Path | Input / result |
|---|---|---|
| GET | `/state?caseId=ID&offset=0&limit=30` | Retained transfer summaries, count and limits. |
| GET | `/transfer?id=ID` | Declared files, completed upload pins, inspection, original bundle descriptor and exported archive. |
| POST | `/command` | Bounded command metadata; returns HTTP 202 after retaining its exact request. |
| GET | `/command?id=ID&requestId=REQUEST` | Original request, running/completed/continuation state and saved result/error. |
| PUT | `/upload?id=ID&file=FILE_ID` | Raw `application/octet-stream`; declared exact bytes and optional SHA. |
| GET / HEAD | `/download?id=ID&kind=archive` | Complete source ZIP, ETag and one HTTP byte range. |
| GET / HEAD | `/download?id=ID&kind=file&name=RELATIVE_PATH` | A file declared by the original source bundle manifest. |

All POST bodies are limited to 2 MiB. The command shape is:

~~~js
{
  id: "stable-transfer-id",
  requestId: "stable-command-id",
  action: "begin|prepare|inspect|receive|export|reopen|attach",
  input: {id: "stable-transfer-id", ...},
  continue: false
}
~~~

The exact request is retained before the original operation starts. After a missing response, GET that command first. An unresolved command can be retried only with the identical request and `continue:true`. The transfer's existing kernel-owned workspace lock prevents two processes from executing that continuation concurrently.

Commands:

- `begin`: `{id,kind:"source"|"archive",caseId,caseRevision,label,actor,files}`.
- Each selected file: `{id,name,role,bytes:"DECIMAL",sha256?}`. Archive mode takes exactly one file. Source mode takes up to 64 attachments. A completed upload establishes its immutable native SHA before preparation.
- `prepare`, `inspect`, `receive`, `export`: `{id}`.
- `reopen`: `{id,requestId}`.
- `attach`: `{id,caseId,expectedRevision,requestId,actor}`.

For `reopen` and `attach`, the nested and outer request IDs are identical. These IDs remain the same across browser reconnect, process restart and local result reconciliation.

## Limits and source identity

| Boundary | Retained behavior |
|---|---|
| Original source attachment | At most 8 GiB per file, 64 files. |
| Original SF49 input allowance | 16 GiB including its conservative handoff/terms allowance. |
| Native support handoff | Original exported `MAX_HANDOFF_BYTES`: `2 × (MAX_RUNTIME_BYTES + MAX_WORKSPACE_BYTES) + 1 MiB`. |
| Owner terms | Original 1 MiB limit. |
| Source archive expanded inventory | 16 GiB plus `MAX_HANDOFF_BYTES` plus 6 MiB, at most 72 ZIP members. |
| Source archive uploaded bytes | Expanded inventory ceiling plus 16 MiB ZIP allowance. |
| Original commissioning inline material | Its own 48 MiB limit, unchanged. |
| Original commissioning record | Its own 64 MiB limit, unchanged. |
| Complete saved case | Original `MAX_WORKSPACE_BYTES`, including existing commissioning and Service fields. |
| HTTP metadata | 2 MiB. Raw file bodies bypass this parser. |

The state response's `limits` reports the derived `handoffBytes`, `termsBytes`, `expandedBytes`, and `archiveBytes`. New source selections reserve the current original handoff and terms allowances within 16 GiB. Reopening an already accepted selection validates its actual retained source/terms pins and total rather than applying a new conservative reservation to the old request.

ZIP64 is used for large original members. The archive contains a distinct SF49 envelope, the byte-identical original `manifest.json`, and every original declared file. The existing Cloud archive wrappers retain their separate Cloud schema and 8 GiB limits.

Uploads retain completed files and their native hashes. An incomplete individual file restarts from its beginning under the same transfer ID; this interface does not claim partial upload resumption. Download ranges permit the browser or a receiving client to resume transfer of already retained bytes.

A complete download hashes the opened descriptor while streaming and withholds its final chunk until the native hash and file identity agree. Range and HEAD responses identify the original retained whole-file SHA in ETag and `X-Source-SHA256`; they do not claim to rehash bytes outside the requested range. Archive receiving always verifies all original members and the full archive, then invokes original SF49 receiving and replay.

## Ownership and shutdown

Each source transfer uses the existing PostgreSQL publisher kernel workspace-lock helper in its own private transfer directory. The original case writer is acquired only by the final host attachment callback. Independent transfers do not hold or serialize the case writer during large uploads, archive building or receiving.

The service tracks its accepted commands and uploads. Close rejects new work, stops owned uploads and archive children, waits for the original local operations to drain, then releases their retained transfer locks. The HTTP route closes only its owned streams and the supplied delivery service. It does not stop the original case store or a shared browser.
