# Collaborative Document Workbench — complete Merchant receiving

This guide owns the additive Merchant receiving course for the same original Collaborative Document application. The original fifty-file Hocuspocus/Tiptap/Yjs workbench remains unchanged. The source still belongs to Commons selection fce1f8b787822513fb1b8a1ed77f41c5f2322fae, received here beneath products/collaborative-documents/workbench/. Its exact full source inventory is original-source.json.

The original six-phase receiving operation is TIPTAP-HOCUSPOCUS-WORKSHARE-0C7A-20261012. Existing placement and first execution remain with 64B7/8F43 under the original company and compute threads. This integration continues that operation, its three imported documents, its two tenant boundaries, original actor identities, native document epochs, checkpoints, deployments, handoffs and saved result. Check the existing accepting owner before running it; an unacknowledged tool call or unavailable native runtime does not establish a new execution owner. Source publication is engineering delivery, not evidence of an executed or visually inspected customer product.

## What this course adds

The original programme already performs source import, two-editor collaboration, a deletion-only save, offline merge, tenant separation, restore into a new document epoch, configuration rollback, fresh/same/forward/older handoff receiving, historical reads, desktop/mobile controls and native reopening. Its result.json and delivery files are retained without replacement.

The Merchant course then does the following with those same original workspaces:

1. Attaches the selected complete Merchant installation through the maintained Runtime Workspace. It retains the exact distribution archive, package/manifest.json, runtime-install.json and original runtime handoff.
2. Inspects the original complete preparation, both returned application directories and ready/build identities. It retains the whole exported prepared-runtime archive and the two ready receipts separately from the project package.
3. Saves, connects and starts the original source workspace through Applications. It uses the actual original listener port and origin from receiving.json, preserving the selected document edition's allowedOrigins.
4. Opens operator, editor-a, editor-b, viewer and outsider aliases against that one listener. The original host actor and document grants govern every operation; an operator role alone does not confer document access.
5. Reads all sources, native job files, named handoffs and all three current native persistence receipts through MCP's retained-file interface. Every chunk, complete length and SHA is checked. Original historical revisions remain readable.
6. Receives the original authored reference through the native resumable upload API and declared-file upload. It retains a source, records a checkpoint review and replays the exact earlier source request after the later revision. The same native request receipt and Merchant journal remain available.
7. Temporarily revokes the original viewer grant. A previously retained full ProjectView must then fail current authorization. The same original grant is restored in its own durable phase, and the exact retained file becomes readable again.
8. Starts the existing reviewed deployment and uses the selected original Yjs/Hocuspocus packages for one retained same-epoch edit. The edit owner freezes the original native operation bytes before applying them. Persistence requires the full update SHA and byte count and the state vector, including its SHA; synchronization alone is insufficient.
9. Closes that actual provider/socket owner, drains the original deployment into a checkpoint and downloads the complete checkpoint archive. The checkpoint's JSON descriptor SHA is not the download SHA. Both native download and MCP full-file read must agree on the complete archive bytes.
10. Runs the unchanged original browser in its read-only receiving phase against the managed source listener. It opens every pane at 1440 and 390 pixels, historical document views and exact named downloads. The full original collaboration course is not dispatched a second time.
11. Prepares a new complete named handoff after the Merchant changes. A second immutable private host configuration declares those actual bytes as a receiving input. The existing receiving workspace imports that package through the original handoff.receive action.
12. Audits all original binary documents and epochs on the receiving host, repeats the actual receiving browser course, stops both managed owners, then cold-opens both original workspaces and checks the complete saved state and current tenant permissions.
13. Closes every actual browser/provider/Application owner before publishing the immutable additive MERCHANT_RESULT.json. Complete original and additive artifacts remain independently verifiable on completed reopen.

This is a real application workflow. It does not add a replacement CRDT, a private approximation of the server, a synthetic HTTP receiver, or a second customer project.

## Source and runtime selections

The original pinned packages include Hocuspocus server/provider 4.7.1, Tiptap 3.31.4, Yjs 13.6.33, y-prosemirror 1.3.7 and y-indexeddb 9.0.12, with the original package lock and schema. Use the original preparation controller described in PREPARING.md. Do not run another npm installation in an already prepared source tree, and do not move a built node_modules tree to a guessed receiving location.

The preparation command returns primary and receiving records, each with:

- runtimeDirectory and runtimeId from the original complete runtime controller;
- applicationDirectory from that controller's actual return value;
- runtimeReadyFile and its full ready descriptor;
- the complete original archive path, byte count and SHA.

The receiving application is commonly nested under a received payload. Use applicationDirectory exactly as returned. The managed server and original receiver are dynamically imported from those verified application directories. They are not forced to run from the installed Merchant workbench copy.

The original ready receipt binds its selected Node executable/version, source root, package.json, lockfile, shared schema, selected package modules and browser build. Use the same actual Node 24 executable for the programme. Do not resolve an explicitly selected interpreter path to a different executable or weaken the original ready binding.

The selected Merchant source tree must be the actual sourceRoot of the installed Merchant runtime. inspectMerchantRuntime verifies the original installation metadata and source-manifest identity. The course must not run from an unrelated checkout while pointing at a different installed package.

## Complete preparation and original manifest

If an original prepared/received runtime and its completed PREPARED.json already exist, inspect and reuse them. The unchanged prepare command adopts its original ready runtime; it does not repeat npm/build merely to create the caller's ready receipt.

For the sole unstarted original preparation, the maintained command is:

~~~sh
node PRODUCTS/collaborative-documents/prepare.mjs prepare \
  --directory PRIVATE_PREPARATION \
  --npm ABSOLUTE_SELECTED_NPM \
  --python ABSOLUTE_SELECTED_PYTHON
~~~

Optional --hocuspocus-archive and --tiptap-archive select the exact original retained archives. Add --resume only to continue the same saved preparation. An independent receiving host uses:

~~~sh
node PRODUCTS/collaborative-documents/prepare.mjs receive \
  --directory PRIVATE_RECEIVING_PREPARATION \
  --archive COMPLETE_ORIGINAL_RUNTIME_ARCHIVE \
  --python ABSOLUTE_SELECTED_PYTHON
~~~

For this full dual-host integration, select the completed prepare result that includes both primary and receiving. Its result is PRIVATE_PREPARATION/.runtime/PREPARED.json. A receive-only result can be used by the ordinary managed customer host; the dual-host commissioning course requires both original selections.

The unchanged native receiver requires a source manifest with schema, sourceRef and all fifty file descriptors. The product's builtin original-source.json has the complete file selection and repository/commit/prefix authority, but its publication schema does not include sourceRef. Preserve an already selected original receiving manifest exactly. For an unstarted first course, create a derivative receiving manifest once outside either application directory:

~~~js
import {readFile,writeFile} from 'node:fs/promises';
const selected = JSON.parse(await readFile(PRODUCT + '/original-source.json','utf8'));
const receiving = {
  ...selected,
  sourceRef: {
    repository: selected.repository,
    commit: selected.commit,
    prefix: selected.prefix
  }
};
await writeFile(ORIGINAL_RECEIVING_MANIFEST,
  JSON.stringify(receiving,null,2) + '\n', {flag:'wx',mode:0o600});
~~~

This preserves every original file descriptor and source fact. It does not alter original-source.json or any of the fifty source leaves. Once the original operation records the manifest SHA, keep the same file on every continuation.

## One full invocation

Use the exact original operation directory and original browser selections. Replace labels below with absolute paths selected from the original receipts. Arguments passed to the unchanged receiver retain their existing meaning.

~~~sh
SELECTED_NODE INSTALLED_SOURCE/products/collaborative-documents/receiving.mjs \
  --source ACTUAL_PRIMARY_APPLICATION_DIRECTORY \
  --directory ORIGINAL_RECEIVING_OPERATION_DIRECTORY \
  --runtime-ready ACTUAL_PRIMARY_RUNTIME_READY \
  --source-manifest ORIGINAL_RECEIVING_MANIFEST \
  --receiving-source ACTUAL_RECEIVING_APPLICATION_DIRECTORY \
  --receiving-runtime-ready ACTUAL_RECEIVING_RUNTIME_READY \
  --playwright ACTUAL_EXISTING_PLAYWRIGHT_MODULE \
  --chromium ACTUAL_EXISTING_CHROMIUM_EXECUTABLE \
  --merchant-workspace ORIGINAL_RUNTIME_WORKSPACE \
  --merchant-runtime COMPLETE_INSTALLED_MERCHANT_RUNTIME \
  --merchant-preparation COMPLETE_PREPARED_JSON \
  --resume
~~~

The distribution also exposes collaborative-documents-receive through the maintained command router. The thin receive.mjs wrapper forwards to this same receiving.mjs implementation.

On a genuinely unstarted original course omit --resume. On interruption, retain the same paths, operation, manifest, actors and exact request journal and use --resume. --recover-completed is the original programme's completed-only recovery option; it does not authorize a new pipeline or a new native migration.

The full integration first invokes the unchanged prepared source's receiving/main. If the original result is already complete, that original path reopens its saved result and byte identities. After that original owner has closed, the integration acquires the same original operation-directory lease. It never acquires a second lock recursively around the running original receiver.

Do not substitute a new original operation directory to escape a retained failure. Do not discard an unknown native request or replace its ID. The original runtime, explicit job resume and Applications recover paths preserve the actual operation history.

## Private host and actor configuration

The course writes its private material under ORIGINAL_RECEIVING_OPERATION_DIRECTORY/merchant-receiving. Auth remains the original private-auth.json outside any public export. No document session token enters the host alias configuration, retained MCP response, log, source archive or customer result.

Each actual listener has one immutable launch configuration with exactly the maintained fields:

~~~json
{
  "schema": "stellar-forge.collaborative-documents-launch.v1",
  "applicationDirectory": "ACTUAL_PREPARED_APPLICATION",
  "directory": "ORIGINAL_NATIVE_WORKSPACE",
  "authFile": "ORIGINAL_PRIVATE_AUTH_FILE",
  "actorId": "operator",
  "runtimeReadyFile": "ACTUAL_READY_RECEIPT",
  "connectionFile": "PRIVATE_GENERATED_CONNECTION_FILE"
}
~~~

Applications settings select configurationFile and the original numeric port. The course records the actual workspace instance and origin before starting. The generated connection file is distinct from the launch input, auth, ready receipt and all installed source files. Managed ownership includes that connection file's original kernel lease and the original application workspace writer.

The Merchant host schema is stellar-forge.collaborative-documents-host.v1. It declares one alias per actor/listener. Aliases may share the same directory and generated connection file only with distinct explicit actor IDs. The course uses primary and receiving for the operator; primary-editor-a, primary-editor-b, primary-viewer, primary-outsider and the corresponding receiving aliases retain separate actor-bound request and file journals.

The five original actors are preserved:

| Actor | Host role | Tenant | Original document grant |
| --- | --- | --- | --- |
| operator | operator | * | Explicit write grants in both tenants |
| editor-a | editor | tenant-a | Write |
| editor-b | editor | tenant-a | Write |
| viewer | viewer | tenant-a | Read |
| outsider | editor | tenant-b | Write only in tenant-b |

Read access remains current. A cached file cannot bypass a later grant revocation. The course retains the actual denial before restoring the original viewer grant. Acknowledging an error is not treated as a successful write or a cleared authorization hold.

## Applications lifecycle and unknown responses

Application review, save and start inputs are durably recorded before dispatch. The retained application ID, review ID and start request ID are reused on continuation. Applications Stop closes the actual managed application; Merchant disconnect closes only the MCP attachment.

A completed historical deployment.start receipt does not prove the deployment still has a live owner. The course reads the original current deployment and owner, waits for its existing jobs, and uses an explicit same-deployment continuation only under the original resume semantics. It does not replay an old completed start and claim a new runtime.

The integration stores every owned native edit/browser handle before awaiting its run. close() retries the actual unfinished resource stages. It retains the operation lease and actual owner handles until closure is confirmed, including startup/listen failures and publication failures. Unavailable process observations do not establish that an owner ended.

The same rules apply to the original receiver error's closeable owner. The wrapper drains that owner before releasing its own lifetime. An interrupted shell transport is reconciled through the original native record; it is not silently replayed.

## Exact mutation and native edit recovery

All create/action requests include their exact actor, request ID, project, expected revision and full payload. A provider error may occur after a committed native effect, for example after a grant update or job launch. The MCP adapter preserves the complete original request on every error. Inspect requests and the original request receipt, then replay that same request rather than issuing a replacement.

The source-retention course intentionally makes a later checkpoint review before replaying the earlier request. The earlier response retains its original view/result and historical revision, while the separate currentRevision identifies the actual current head.

The native edit helper owns one distinct directory beneath merchant-receiving/native-edit. It opens the selected original packages, verifies the original physical document/epoch/deployment, retains the actual native update bytes before applying them, and reuses those Yjs operation IDs on continuation. It never regenerates a new paragraph merely because an acknowledgement was lost.

Saved means the full original Y.encodeStateAsUpdate v1 byte SHA and length and both state-vector representations match the server-durable receipt. A state vector alone does not describe deletion state. The helper closes every actual WebSocket and provider before the checkpoint drains the native deployment.

### Native editing after independent receiving

The receiving browser phases in this integration inspect saved views and downloads; they do not establish a new editing deployment on the receiving host. The transferred original edition retains its reviewed primary-only allowedOrigins. Before enabling native editing at an independent receiving origin, inspect that host's actual origin, prepare and review a configuration edition that explicitly allows it through the original deployment/configuration actions, freeze the reviewed edition, and start that selected deployment. Retain the prior edition for the original rollback workflow. Do not assume that importing a handoff changes allowedOrigins or that an unchanged primary-only edition authorizes the receiving editor.

The integration does not repeat the original offline merge, delete-only or epoch-restore programme. Those accepted original outputs remain in the original result. Its added edit exercises the actual prepared engine through the managed host and is included in the latest complete handoff.

## Checkpoints, complete files and latest handoff

Checkpoint rows contain a descriptor SHA for their JSON description. The download is a complete gzip NDJSON checkpoint with the descriptor and every original Yjs file. The receiver first saves the actual download, verifies its bytes and native ETag when present, then passes that archive identity to merchant_collaboration_artifact. It does not use the descriptor hash as the archive hash.

All retained-file reads follow the original readId/offset/nextOffset contract with chunks up to 196608 bytes. They rehash the whole file and verify the actual full file stored by the maintained exporter. Sparse excerpts or a first chunk do not count as full custody. Upload input uses the original declared file and native chunking; inline uploads preserve their committed offsets.

A new named handoff is created after source/review, grant restoration, native edit, checkpoint and rendered source receiving. The private forward configuration is a new immutable edition that declares those exact handoff bytes. The receiving workspace adopts its selected immutable prefix under the original project ID. The original gzip-v1 archive is frozen before its outer handoff row is committed; consequently that newly exported row is retained as delivery custody, not invented inside its own incoming project. The native receivedRevision and packageSha256 bind the incoming prefix and complete archive. Earlier named handoffs remain available.

The current complete document triplet is compared across source, receiving and both cold reopens: document ID, tenant, physical name, epoch and complete durable update/vector receipt must match. The retained source/review changes must reach the incoming project too.

## What the customer receives

The delivery distinguishes three complete artifacts:

| Artifact | Contains | Reopening |
| --- | --- | --- |
| Original/latest project handoff | Original fifty-file standalone source selection, full project/native document state, versions, requests, sources, jobs and checkpoints | Original handoff.receive into a closed original workspace |
| Prepared-runtime archive | Original prepared package/build/runtime closure, inspected and received by the original runtime controller | collaborative-documents-prepare receive into an explicit private receiving root, then use actual returned applicationDirectory/runtimeReadyFile |
| Merchant distribution archive | Selected Applications/MCP/provider/Installation/receiving adapters and their unchanged original workbench source, plus the complete selected shared dependency closure | Original Merchant Installation and Runtime Workspace receiving, using exact package manifest |

The project handoff does not automatically contain integration files outside its fifty-file workbench selection. Retain the complete Merchant distribution and package manifest alongside the complete project and prepared-runtime handoffs.

Private configuration is recreated on the receiving host from actual local paths and the host's authorized actor records. Do not ship the original private-auth.json, local session secret, bearer token, ephemeral document token or generated connection file as a public customer asset. Documentation may retain path selectors without embedding credentials.

The additive result lives at merchant-receiving/MERCHANT_RESULT.json. Its artifacts include the complete original result files, exact integration request/response records, both whole distribution/runtime archives and manifests, native edit/checkpoint files, latest handoff, browser outputs and cold-read evidence. The original result.json remains byte-identical.

The final candidate is frozen before the completed state write. A lost final acknowledgement reopens that exact candidate and verifies every declared file before adopting it. It does not repeat setup and then construct a different final result. Missing or changed final files remain an explicit failure; the course does not rerun a browser to conceal a missing original artifact.

## Actual rendered inspection before presentation

The automated course's completed result is execution and custody evidence. It explicitly leaves customer-facing presentation pending the producing peer's actual visual inspection. Open the exact retained desktop/mobile screenshots, visit the actual application, use the important controls, open complete downloads and inspect reopened exports. Look at every applicable PDF page and open the actual outgoing ZIP contents. A screenshot that nobody viewed is not visual inspection.

Carry the following owner instruction verbatim into every delegated execution and active owner-controlled receiving guide.

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Before calling any customer/prospect-facing application, website, dashboard, demo, report, presentation or export ready, open/run/render the exact outgoing version, look at the rendered screen or its actual screenshots, and operate the important user controls. Inspect the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk; do not run broad suites or build a verification product.

Include this complete instruction in delegated assignments and the active owner-controlled policy, boot, build and receiving guidance those workers actually read. Preserve all other owner controls and original operation identities. Leave historical records and third-party/vendor policies intact. Do not force restarts, create watchers or revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999

The owner's 2026-10-13 09:58 addition also explicitly includes all outgoing attachments. New videos require natural generative TTS and actual watching/listening before presentation. This programme does not generate a video.

For this product inspect at least the actual populated overview, source inventory, tenant/grant table, edition and migration reviews, document list, native runtime state, delivery history, read-only viewer controls, denied/wrong-tenant state, stopped/loading/error state, both desktop and narrow layouts, every outgoing complete checkpoint/handoff download and a reopened export. If the native route is unavailable, attach this exact source and its opening commands to the existing equipped owner; review that owner's actual rendered result and keep independent implementation moving.

No new approval gate, watchdog, forced restart, paid CI fallback or replacement programme is introduced.
