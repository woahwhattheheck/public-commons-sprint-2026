# Tiptap and Hocuspocus migration operator

This component keeps an application's original document sources, tenant mapping, migration decisions, collaborative native state, configuration history, and receiving handoff in one project. The browser uses the selected original Tiptap editor, Hocuspocus provider, Yjs document, and y-indexeddb persistence. The same shared schema is used by the native importer and the editor.

The included reference is an explicitly authored three-document application example. It has two documents in `tenant-a` and one in `tenant-b`. It is not a customer's production content. Keep its original `reference/documents.json` bytes and source identity when running the receiving programme. An actual application migration should retain that application's complete source, authorization contract, schema, and mapping as separate sources.

## Install and select the original runtime

Use the component's maintained installation procedure and its complete selected package lock. The installation produces a runtime-ready receipt with the actual Node executable, installed package versions, module locations, and selected source identities. The current source selection uses Node 24, Hocuspocus server/provider 4.7.1, Tiptap 3.31.4, Yjs 13.6.33, y-prosemirror 1.3.7, and y-indexeddb 9.0.12. These are source selections; an installation is ready only after the original installer has returned its actual receipt.

Do not substitute a browser-only editor, a JSON copy of a Yjs document, or a different CRDT for this native runtime. Retain the exact selected interpreter and module tree. If the supplied executable is a symlink into an installed runtime, use that selected path rather than replacing it with its resolved base executable.

The core serves the bundled `web/app.mjs` at `/assets/app.js` and the original stylesheet at `/assets/style.css`. It serves this complete guide at `/operator-guide`. Browser bundling belongs to the same selected installation. No external font, image service, or CDN is required by this interface.

A reference server can be opened using the original command:

```sh
node cli.mjs serve --directory /absolute/private/workspace --auth /absolute/private/auth.json
```

The receiving programme additionally supplies the exact runtime-ready receipt to `createApplicationServer({ directory, authFile, runtimeReadyFile, host: '127.0.0.1', port })`. The core verifies that receipt and reports the actual selection through `GET /api/session`. There is no separate runtime configuration mutation in the operator.

## Host identity and tenant grants

The host verifies each HTTP actor. Request bodies cannot choose an actor or tenant authorization. A production integration may provide the core's `contextForRequest`; the private reference installation uses:

```json
{
  "schema": "tjlabs.tiptap-auth.v1",
  "actors": [
    {
      "id": "operator",
      "name": "Migration operator",
      "token": "a-private-host-generated-token",
      "roles": ["operator"],
      "tenantIds": ["*"]
    }
  ]
}
```

Generate actual tokens privately, protect the file, and preserve it for a restart of that installation. Do not put tokens in URLs, screenshots, source archives, public configuration, or issue descriptions. The operator asks for the host token when the page opens. It keeps that token only in page memory; a reload requires authentication again. Native document-session tokens are returned only by the authenticated document-session route and are renewed through that same route.

An operator's administrative permission allows source and history review. Live document access still requires an enabled project grant for the exact actor and tenant. An empty `documentIds` list means all documents in that tenant; it does not cross into another tenant. A read grant opens a read-only editor. Revocation or an expired session prevents further authorized collaboration.

The reference receiving programme uses five privately generated actors: `operator`, `editor-a`, `editor-b`, `viewer`, and `outsider`. The two editors and viewer are scoped to `tenant-a`; the outsider is scoped to `tenant-b`. Its authorization checks use those real host identities and project grants.

## Work through the operator

### 1. Retain the complete sources

Create a project from **New project**, then open **Sources**. Retain the original document population, shared schema, application material, and authorization contract with the appropriate roles. Include source URLs, attribution, and other relevant metadata.

The browser saves the complete selected file before uploading it. The host receives chunks of at most 8 MiB, validates each chunk hash, then seals the full file against its original size and SHA-256. The source action consumes that completed upload. A dropped connection resumes the same upload and request rather than selecting another source.

The browser upload limit is 512 MiB; an individual native document is limited to 32 MiB by the reference configuration. Larger application populations can still be represented as multiple complete source inputs within the actual native limits. Do not truncate a source merely to make a demonstration fit.

**Read source** verifies the complete response before showing an explicitly limited text preview. HTML is shown as source text in the operator; source embeds never execute in its origin. **Download** returns the complete retained file with its original identity.

### 2. Define tenant access

Use **Tenant access** to create the receiving tenants and grant exact host actors access to selected documents or all documents in one tenant. Record why each grant is appropriate. Keep the application's existing authorization boundary explicit.

An imported handoff retains its original project and grant history, but it does not import host bearer credentials or silently start a collaboration server. The receiving host supplies its own authenticated actors and runtime selection.

### 3. Review and freeze an edition

An edition binds its retained sources, shared schema ID, XML field, and native persistence configuration. The installed reference uses schema `reference-v1` and field `default`; both transformer and editor import the same `reference/schema.mjs`.

The JSON configuration exposes `debounceMs`, `maxDebounceMs`, `maxDocumentBytes`, and `allowedOrigins`. Review the actual browser origin when deploying. Save a working edition, inspect its complete record, and freeze it before preparing a migration or deployment.

A different schema requires the corresponding real native schema and editor extensions. The browser refuses to open a document whose schema or field it does not implement, while keeping the original content available for review.

### 4. Review every migration row

Select the original source, frozen edition, format, and complete mapping. A JSON population uses this mapping shape:

```json
{
  "arrayPath": "documents",
  "sourceKeyField": "id",
  "titleField": "title",
  "tenantField": "tenantId",
  "contentField": "content",
  "documentNameField": "documentName",
  "schemaId": "reference-v1",
  "field": "default"
}
```

A single HTML or native Yjs update uses `sourceKey`, `title`, `tenantId`, `documentName`, `schemaId`, and `field`. Original native Yjs input remains binary input; it is not converted into a made-up JSON update format.

The native planner returns each original source key, source hash, target name, tenant, and any schema or mapping errors. Open **Review rows** and choose **Import** or **Skip** with an explicit reason. The table pages 100 rows at a time and retains each reviewed row in the original draft. Apply only after the required rows have been reviewed and native errors resolved.

A nonempty existing target is protected. Use a new document name or the explicit checkpoint restore workflow when replacement is intended. The ordinary migration action does not overwrite an existing collaborative document.

### 5. Start and use the native editor

Prepare a deployment from the frozen edition, then explicitly start it. The native worker, import, persistence, and deployment records remain visible in **Runtime**. A failed or interrupted job retains its original ID and completed work; inspect that record before selecting **Resume**.

In **Documents**, open an authorized current document. The editor loads its original local Yjs cache, obtains an ephemeral host session for the selected physical epoch, and connects the original Hocuspocus provider. The formatting toolbar operates through the installed Tiptap commands. Collaborative cursors identify authenticated editors.

The three status areas have different meanings:

| Status | What it establishes |
| --- | --- |
| Network / initial synchronization | The original collaboration connection has reached that observed state. |
| Original local state retained | y-indexeddb has retained the selected native update in this actor's browser cache. |
| Saved on host | The host's persisted complete native update has exactly the editor's SHA-256 and byte count, and its state vector also matches. |

Synchronization by itself does not establish persistence. A Yjs state vector does not describe deletions completely, so the browser also compares the full `Y.encodeStateAsUpdate(doc)` v1 bytes. A pure deletion must change the complete binary persistence identity even when its state vector is unchanged.

**Check saved state** flushes the local native store and reads the original host persistence receipt. **Download native state** preserves the complete selected `.yjs` bytes with a separate identity manifest, including document, tenant, epoch, schema, field, full hash, and vector. It does not flatten rich text into an alternate document model.

### 6. Work offline and reconnect deliberately

**Work offline** flushes local native persistence and disconnects the original provider socket. Edits then remain in that epoch's y-indexeddb cache. They are not marked Saved on host until the exact host receipt matches after reconnection.

**Reconnect original document** requests authorization again. If the same document epoch and actor binding are still current, the native provider merges the original updates. If a content restore created a new epoch, the old connection is retired and the old cache remains available to download. It is never automatically attached to the replacement document.

The local cache key includes installation, actor, project, tenant, document, physical epoch, schema, and field. Reloading the web page still requires the host page and authentication; this product does not claim an offline service-worker application shell. Once the page and session are available, its retained native cache can be reopened under the same binding.

Before closing or switching documents, the browser flushes local persistence. A failed local save keeps the original document available for recovery. The explicit close attempts all owned provider, editor, database, and document cleanup, retaining actual cleanup errors.

### 7. Checkpoint, restore content, or roll back configuration

A **persisted checkpoint** captures the last committed native state. A **drain checkpoint** closes the selected deployment and seals its complete document state. Review the actual document hashes, vectors, epochs, and source bindings in the checkpoint record.

**Rollback config** selects a reviewed runtime edition with `documentPolicy: preserve_current`. It preserves current collaborative document data. It is appropriate for a configuration change that should not undo document edits.

**Restore content** is a different, explicit action. Select the checkpoint and documents, record the reason, and use `mode: new_epoch`. The core drains the old deployment, retains both histories, creates new physical document epochs, revokes old-epoch sessions, and leaves the deployment stopped. Start the reviewed deployment explicitly afterward. Earlier offline caches cannot inject their pending changes into the new epochs.

### 8. Prepare and receive the whole handoff

Close or drain the original deployment before **Prepare handoff**. Select the retained project revision and give the package a useful name. The package contains that revision's complete source and native binary closure. The named handoff descriptor is recorded in the next project revision; its own outer download record is naturally outside the selected package.

Download the complete `.ndjson.gz` file. The browser verifies the response's SHA-256 and size. Keep that original artifact, its source manifest, native runtime receipt, and receiving result together.

On the receiving host, create an empty receiving project, choose **Receive handoff**, and upload the complete original package. The resulting view uses the imported project's original ID, not the temporary receiving project's ID. The core preserves fresh, same, forward, and older receiving semantics. An older package remains available without rolling the current project backward.

Receiving opens closed. It preserves original native data and history while requiring the receiving host's own auth and runtime before explicit start. Open historical revisions from **Delivery & history** to inspect their original records and source bytes. Historical documents have no editable live connection.

## Exact request recovery and drafts

Every project mutation is prepared with its original request ID, complete JSON bytes, expected revision, source upload identity, and actor/installation/project scope before dispatch. An uncertain response stays visible in the retained-request banner. **Retry same request** sends those same bytes and ID.

A successful replay retains the core's original committed revision, project data, and result. Current revision, permissions, runtime, and connection metadata describe the current delivery. The interface separately refreshes the current project. A delayed response cannot clear a newer draft or switch an operator back to a project they already left. A rejected request can be explicitly closed after its observed rejection; an uncertain request remains retained.

If IndexedDB cannot be read, new mutations stay disabled until **Retry retained-state read** succeeds. The original key remains in place. A different unresolved request in another page cannot be overwritten by a new pending request. A stale draft keeps the revision at which it began; **Use reviewed current revision** is an explicit rebinding after inspecting the current project.

Do not recover a request by inventing a new ID, rewriting transport headers underneath a different UI request, or changing its file bytes. Preserve the pending request and its native receipt.

## Complete receiving programme

Run the original receiving entry from the selected installed component:

```sh
node receiving/receive.mjs \
  --source /absolute/selected/component \
  --directory /absolute/private/receiving-operation \
  --runtime-ready /absolute/installed/runtime-ready.json \
  --source-manifest /absolute/selected/source-manifest.json \
  --playwright /absolute/installed/playwright/index.mjs \
  --chromium /absolute/selected/chromium \
  --resume
```

To exercise the independently received installed application, add both receiving selectors to that same command:

```sh
  --receiving-source /absolute/received/runtime/application \
  --receiving-runtime-ready /absolute/private/received-runtime-ready.json
```

The original installed-runtime receiver supplies the returned application. From that application, the original installation command inspects its prepared runtime and regenerates its own ready receipt with the receiving host's actual Node executable, module paths, and source root. Both applications in this programme use that same selected Node executable. Keep the installed runtime separately from the project handoff.

Before creating the operation, the programme checks every file in both applications against the one complete source manifest and validates each ready receipt against its actual application. The source stage uses the original prepared application; fresh, forward, older, browser, and reopen receiving use the returned application's own server and browser modules. Both ready receipts and their hashes are retained in the final delivery. Omit both receiving selectors to use the one installed application for the two separately stored workspaces.

The source manifest is `{schema,sourceRef,files:[{path,bytes,sha256,gitBlob?}]}` with component-relative paths. Every selected file, the receiving entry itself, the shared schema, and the original reference population are checked before the operation directory is used. Use the original Node executable and supplied module paths from the runtime selection.

The programme retains one private operation journal and the original writer lease. It uses the core's ordinary HTTP actions, native migration jobs, original Hocuspocus runtime, and real Tiptap browser. It retains the original request IDs across continuation. It does not substitute a mock server or an imitation CRDT.

The complete journey covers all three original reference documents; tenant grants; original native migration; two independent editor contexts; concurrent updates; a pure deletion and complete binary persistence; offline edits and reconnection; read-only and wrong-tenant access; checkpoint restoration into a new epoch while an old offline editor remains present; configuration rollback preserving current document data; exact HTTP request replay; named package download; fresh, same, forward, and older receiving; historical inspection; desktop and mobile layouts; and reopening the same saved application directories.

Full observations, original request envelopes and responses, complete handoff files, source/runtime identities, and final closure receipts are retained under the operation. Browser screenshots remain temporary internal inspection under each browser's tmp/screenshots directory and are excluded from durable result inventories and the saved private case. Auth tokens remain in the private auth file and page memory and are excluded from the public result. Completion is published from an exact saved candidate after the original browser and application owners have closed. The receiving journal's writer lease remains held through final publication and is released when that same programme returns.

A controller interruption is resumed using the same directory and `--resume`. Inspect an actual failed native job before permitting its original resume. The programme never repeats an ambiguous native effect merely because a browser or HTTP carrier disappeared. A published final result is reverified and reused with its original timestamp and bytes.

## Delivery and review

Provide the complete component source, original upstream provenance and licenses, exact source manifest, actual runtime-ready receipt, full native handoff, and receiving result. Preserve the source population separately from any customer-specific realization. Record actual execution, accepted customer use, and paid work as separate facts.

The browser source checkpoint alone is not a native receiving result. An installation receipt alone is not a successful collaborative session. Use the programme's retained original observations to support each delivery claim.


## Reopen an original committed request

The browser keeps the original request ID, complete HTTP body and selected actor/project scope before dispatch. **Retry same request** retains the original server replay behavior. **Read original receipt** makes an authenticated, read-only lookup of that actor's existing request row. It verifies the host instance, actor, request ID and canonical full input hash before accepting the native original result. It does not dispatch an application action or create a new revision. A missing receipt leaves the original request available for reconciliation.

A response observed in this page remains known even if IndexedDB publication fails or an older transaction finishes afterwards. A conflicting original input or native result is reported. Finishing the browser bookkeeping writes the same original result to its local record and clears only its matching pending request. Neither a storage failure nor navigation creates a replacement action.

## Closing a browser operator

`await window.migrationWorkspace.close()` freezes new interface admission and returns `{state:'CLOSED'}` only after the original editor, actual collaboration sockets, accepted operations and response bodies, pending drafts, IndexedDB transactions and database handles have drained. The host token is then cleared from page memory. The editor persists the full original Yjs state through the selected IndexedDB provider; it does not initialize a replacement document or clear an earlier epoch cache.

A failed close keeps its original owner objects and can be retried by calling the same method. In particular, a failed final local save retains the live Y.Doc and persistence owner. The receiving browser must await this close before saving the actor profile and closing the context. A disconnected provider or socket status is not a durable host-save receipt; the existing full update hash and state-vector comparison remains authoritative.

The application server likewise retains its original workspace lease, accepted HTTP work, collaboration sockets, document-store work and SQLite owner until their actual close. A failed server startup that still owns resources exposes `error.application.close()` (also `error.closeFailedApplication()`) for the same owner to be drained before the receiver releases its lease. The runtime request, deployment, migration, checkpoint and handoff formats remain unchanged.

### Closing drafts, received results, and editor transitions

The browser admits each original operation synchronously through its first await, so closing a form captures its complete draft before clearing the visible form. Complete asynchronous operations remain tracked until their response bodies, retained-state transactions, and callbacks finish.

Before application closure, every unfinished accepted response still held only in memory is persisted under its original actor, scope, request ID, and exact input. A failed write retains the same application and known result for another close attempt. It cannot report `CLOSED` while that accepted result would disappear on navigation.

Editor openings retain their original actor, installation, document, and epoch at admission and pass through one ordered transition. Every successful acquisition and failed-start editor owner is retained until its own close succeeds. Superseded openings close their original objects without replacing the current visible editor. The final application drain closes every remaining owner after all admitted transitions settle.
