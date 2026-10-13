# Collaborative Document Workbench

This installed TJLabs product operates the complete original Tiptap/Hocuspocus/Yjs application. It brings the application into the existing Installation, Applications and private Merchant interfaces. The original source, rich-text engine, authorization, SQLite store, binary document history, runtime manager and receiving programme remain unchanged.

Use this guide with PREPARING.md for original runtime preparation and RECEIVING.md for the one complete native/browser/customer receiving course. The workbench/OPERATOR.md file is the complete original browser guide. This document explains the installed product, private host binding, customer agent and commissioning path.

## 1. What is installed and what is private

The product contains all 50 original source files from Commons commit fce1f8b787822513fb1b8a1ed77f41c5f2322fae under workbench/. The sibling original-source.json identifies every original path, mode, bytes, SHA-256 and Git blob. Integration code, this guide and the Installation/grant declarations remain outside that source directory.

The installed commands are:

| Command | Complete operating purpose |
| --- | --- |
| collaborative-documents | Forward to the exact original CLI at an explicitly selected prepared application |
| collaborative-documents-prepare | Complete original runtime preparation, portable export/receiving and returned-application build/ready binding |
| collaborative-documents-managed | Run the one original application under Applications foreground ownership |
| collaborative-documents-receive | Continue the complete original collaboration and independent receiving course, then the installed customer integration |

The generic Merchant package and the original prepared application are different retained artifacts. The former contains these wrappers, shared Applications/Merchant/Installation dependencies and all original source. The original runtime manager creates its own application directory, dependency installation and portable runtime archive. The customer project’s .ndjson.gz handoff contains editable project/source/binary history. Keep all three complete outputs; none replaces another.

Keep the customer workspace, private authentication file, launch configuration, generated connection and Merchant export directory outside the unchanged original application. Generated original node_modules/, dist/ and .runtime/ are the only permitted generated roots within an application copy. Arbitrary added JSON or Markdown inside it changes its source population. Authentication and ephemeral session tokens do not belong in source, customer handoffs, public guides or screenshots.

The package’s source status and the actual receiving status are separate. A merged declaration or authored receiving script is not an installed runtime, an operated native browser course, a customer purchase or independent customer acceptance.

## 2. Prepare the complete native runtime

Follow PREPARING.md using the supplied original package/lock and upstream source archives. The preparer invokes the existing runtime manager and the existing installer/build. It retains the original operation, source manifests, stdout/stderr and portable runtime; it does not replace the original controller with another install engine.

A prepared runtime returns an application path. Independent runtime receiving returns another application path. Run the original installer’s prepared-runtime adoption at the corresponding returned application. The receipt must record that host’s actual Node executable and version, package/module paths, package-lock, reference schema and full selected runtime identity. The original server also verifies dist/build-manifest.json and every declared build input/output.

Do not copy a source-host runtime-ready.json into the receiving installation. Do not move node_modules or change an old receipt to make paths agree. The original full runtime receive and installed-script inspection regenerate the receiving receipt from the real returned application. Applications uses that same applicationDirectory and runtimeReadyFile.

The selected source requires Node 24, native SQLite and the exact lockfile’s Hocuspocus 4.7.1, Tiptap 3.31.4, Yjs 13.6.33, y-prosemirror 1.3.7 and y-indexeddb 9.0.12, together with the other locked dependencies. These are the selected original versions, not a request to upgrade to the latest release. The original package includes 15 direct exact pins and its complete resolved lock.

Run the installed preparation command with the selected host's actual Node 24, npm and Python executables:

```sh
/ACTUAL/node /INSTALLED/starforge.mjs collaborative-documents-prepare prepare \
  --directory /srv/private/collaboration/runtime-preparation \
  --npm /ACTUAL/npm --python /ACTUAL/python3
```

If the original complete upstream archives are already retained, add `--hocuspocus-archive ABS` and `--tiptap-archive ABS` to that same request. An interrupted preparation continues with the same arguments plus `--resume`. The preparer invokes the original runtime's prepare, full export and independent receive, then the original installer at each returned application. It does not start the document application.

The successful `stellar-forge.collaborative-documents-preparation.v1` result has `status: "READY"`. It retains the complete selected request and archive, plus these bindings:

| Result field | Use |
| --- | --- |
| `primary.applicationDirectory` and `primary.runtimeReadyFile` | Prepared source-host application and its actual host receipt |
| `receiving.applicationDirectory` and `receiving.runtimeReadyFile` | Independently received application and its newly observed receipt |
| `runtimeDirectory` and `runtimeId` inside each binding | Original prepared or received runtime identity |
| `ready` inside each binding | Ready-file path, complete bytes and SHA-256 |
| `archive` | Complete portable runtime path, bytes and SHA-256 |
| `next` | Application/ready pair to configure: primary after preparation, receiving after receive-only |

The exact result is retained at `OPERATION/.runtime/PREPARED.json`. Use its returned fields. A prepared application is commonly under `prepared-runtime/application`; a received application is commonly under `received-runtime/payload/application`. Those examples do not replace the returned selection.

Inspect or export the completed preparation using the same operation directory:

```sh
starforge collaborative-documents-prepare inspect --directory /srv/private/collaboration/runtime-preparation
starforge collaborative-documents-prepare export \
  --directory /srv/private/collaboration/runtime-preparation \
  --output /srv/private/delivery/Collaborative_Document_Runtime.tar.gz
```

On the compatible receiving host, select the complete archive and a separate private receiving operation:

```sh
starforge collaborative-documents-prepare receive \
  --directory /srv/private/customer-collaboration/runtime-receiving \
  --archive /srv/private/delivery/Collaborative_Document_Runtime.tar.gz \
  --python /ACTUAL/python3
```

Receive-only returns `primary: null` and a complete `receiving` binding. It performs original full runtime receiving without another npm acquisition. Select the actual same Node version and compatible operating system/architecture; follow the native ABI check for installed add-ons. If that selection is incompatible, the existing runtime owner prepares the retained original source and lock for the receiving host.

Read the preparation result for actual returned paths. Subsequent examples use /srv/private/collaboration as an illustrative private host directory; replace it with the customer’s actual authorized owned directory and returned application path.

## 3. Bind the private original authentication

The original auth schema is tjlabs.tiptap-auth.v1. Each actor has id, name, a private bearer token, roles and tenantIds. Roles are operator, editor and viewer. A wildcard tenant membership is explicit; it does not bypass the project’s document grants.

For a private reference or commissioned local installation, create the actual host-owned file with fresh secret values. This example writes secrets only to the selected 0600 file; it does not print them:

```js
import {mkdir,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';

const root='/srv/private/collaboration';
await mkdir(root,{recursive:true,mode:0o700});
const actor=(id,name,roles,tenantIds)=>({
  id,name,roles,tenantIds,token:randomBytes(32).toString('base64url')
});
const value={
  schema:'tjlabs.tiptap-auth.v1',
  actors:[
    actor('collaboration-operator','Document operator',['operator'],['*']),
    actor('editor-a','First editor',['editor'],['tenant-a']),
    actor('editor-b','Second editor',['editor'],['tenant-a']),
    actor('viewer','Document viewer',['viewer'],['tenant-a']),
    actor('outsider','Other tenant viewer',['viewer'],['tenant-b'])
  ]
};
await writeFile(root+'/auth.json',JSON.stringify(value,null,2)+'\n',
  {flag:'wx',mode:0o600});
```

Use real customer identities and tenant selections for actual commissioning. The example actors are authored receiving fixtures. Original auth-file validation remains authoritative and rejects unsafe ownership or permissions. Do not overwrite an existing auth file to make a retry look new.

An actor’s roles and tenant membership are only the host boundary. The project must also hold an enabled matching grant for that actor and tenant. A grant with documentIds:[] applies to all documents in that exact tenant. Administrative operator access allows source/configuration/history operations but does not implicitly authorize live document editing or persistence. Give the operator an explicit document grant only when that is part of the approved customer scope.

The original editor receives short-lived provider tokens through its authenticated document-session endpoint. The browser holds them in memory. No Merchant tool issues, exports or retains those tokens.

## 4. Review and start the original managed application

Create a private launch JSON with the exact returned runtime/application paths:

```json
{
  "schema":"stellar-forge.collaborative-documents-launch.v1",
  "directory":"/srv/private/collaboration/customer-workspace",
  "applicationDirectory":"/srv/private/collaboration/prepared/application",
  "authFile":"/srv/private/collaboration/auth.json",
  "actorId":"collaboration-operator",
  "runtimeReadyFile":"/srv/private/collaboration/prepared-runtime-ready.json",
  "connectionFile":"/srv/private/collaboration/connection.json"
}
```

The illustrative applicationDirectory must be replaced by the actual preparation result. The receiving host gets a distinct launch file with its returned application/runtime, its own private auth and its own customer workspace/connection.

In Applications, choose Collaborative Document Workbench, select the private configuration file, then Review and Save the original application. The provider freezes the complete configuration hash, full original 50 source identity and workspace/connection resource selection. Start uses the original createApplicationServer directly; that factory already listens and owns the native collaboration runtime, store and lease.

For a foreground host operating the same selected lifetime directly:

```sh
starforge collaborative-documents-managed --configuration /srv/private/collaboration/launch.json --port 0
```

The actual startup has status COLLABORATIVE_DOCUMENTS_READY and records the loopback URL, launch/instance, exact prepared application, source/runtime selection and private connection identity. Use the observed URL, not a guessed port.

Applications Stop drains the original admitted HTTP/upload/job work and native collaboration before releasing its lease. If startup or closure fails while the original owner still holds resources, retain that same owner and repeat its closure; a second launcher is not a recovery method. Reopening preserves the original workspace and project history. A prior deployment may be stopped or interrupted and requires its explicit original start action. Replaying an already completed start request is historical replay, not a new start.

## 5. Commission the complete source population

Log in to the original browser with the correct private actor. The browser keeps the bearer in memory and retains authored pending requests in IndexedDB scoped to installation, actor, origin and project.

Create the project with a stable request ID. Retain the exact request file for CLI or agent recovery:

```json
{
  "requestId":"customer-documents-create-001",
  "title":"Customer operating documents",
  "notes":"Complete authorized tenant-a source population and independent editable handover."
}
```

Keep the committed returned project ID. Every action uses the actual current expectedRevision and a stable requestId. Do not copy an example revision into a live project.

Upload original files using complete length and SHA-256. The upload limit is 512 MiB, native chunks are 8 MiB and each migrated document is limited to 32 MiB. Resuming an upload reuses its original ID and exact committed ranges. A new filename or SHA under an old upload ID is an identity conflict.

Retain the completed upload as a source with role documents, schema, application, auth_contract or other. An auth_contract source describes the agreed authorization model; it must not contain the actual private bearer or session-secret file.

Create the tenants and explicit grants. Select the retained source/configuration edition, schemaId reference-v1 and field default, unless a separately commissioned supported schema integration has changed the original source. Set reviewed debounce, maximum document bytes and allowed origins; freeze the edition. The reference schema does not silently support arbitrary rich-text extensions or proprietary content.

For a JSON batch, the original mapping is:

```json
{
  "arrayPath":"documents",
  "sourceKeyField":"id",
  "titleField":"title",
  "tenantField":"tenantId",
  "contentField":"content",
  "documentNameField":"documentName",
  "schemaId":"reference-v1",
  "field":"default"
}
```

A single HTML or Yjs input selects sourceKey, title, tenantId, documentName, schemaId and field. Review every plan row. Errors remain visible; unsupported content is not accepted by dropping it. Decide import or skip for the complete population and retain reasons. Import uses new logical document names. To change an existing document’s contents, use the real editor or an explicit reviewed restore, not an overwrite disguised as another import.

Apply the reviewed migration. Follow the original job/attempt and actual native files until complete. A transport error alone does not establish whether the action committed.

## 6. Edit, disconnect and confirm actual storage

Prepare/start the original deployment for the selected frozen edition. Use two distinct authorized actors in independent original browser contexts. Confirm each opens the intended tenant/document/epoch.

Operate real concurrent edits. Disconnect one provider through the original offline control, make an offline edit, reload from the original y-indexeddb cache, then reconnect. The original Hocuspocus provider and Yjs engine own synchronization and merge. The wrapper is not a replacement CRDT.

The editor’s storage confirmation compares:

- Full original Y.encodeStateAsUpdate v1 binary SHA-256 and byte count.
- Original Y.encodeStateVector and its persisted identity.

Both must agree with the persisted receipt for the selected epoch. A pure deletion can change the update/delete set without advancing the vector. “Connected” or “synced” is not “saved.”

Exercise the actual read-only viewer and a nonmatching tenant actor. Change or revoke an approved grant through the original grant.save action and check affected sessions. Historical project/checkpoint views do not mount an editable live provider.

Inspect the rendered outgoing application and real screenshots at desktop and narrow/mobile widths. Operate the important controls, populated/empty/error states, downloads and reopening. Merely collecting screenshots, counting DOM elements or receiving HTTP 200 is not visual acceptance.

## 7. Checkpoint, rollback and restore

A checkpoint can capture persisted state or drain the original deployment. For handover and independent receiving, use the original drained checkpoint so the committed project revision includes the actual final native saves.

Configuration/runtime rollback uses deployment.rollback with documentPolicy preserve_current. It selects a retained frozen edition without discarding current document content.

Explicit content restore is a separate document.restore action. Select a retained checkpoint, document IDs, reason and mode new_epoch. The original operation drains, creates new physical epochs and preserves previous histories. Old offline edits belong to their previous epoch and must not re-enter the restored target. The restored deployment remains stopped until explicitly started.

Download the complete original checkpoint archive. It contains the checkpoint descriptor and the actual native binary files. Keep its original filename, complete byte count and SHA-256.

## 8. Private Merchant customer-agent configuration

The provider uses family/config collaborativeDocuments and host input collaborativeDocumentsConnection. It does not require a separate authentication service.

Create a private host-alias configuration:

```json
{
  "schema":"stellar-forge.collaborative-documents-host.v1",
  "workspaces":{
    "operator":{
      "label":"Customer document operator",
      "directory":"/srv/private/collaboration/customer-workspace",
      "connectionFile":"/srv/private/collaboration/connection.json",
      "actorId":"collaboration-operator",
      "inputs":{}
    },
    "editor":{
      "label":"Authorized tenant editor",
      "directory":"/srv/private/collaboration/customer-workspace",
      "connectionFile":"/srv/private/collaboration/connection.json",
      "actorId":"editor-a",
      "inputs":{}
    },
    "viewer":{
      "label":"Authorized tenant viewer",
      "directory":"/srv/private/collaboration/customer-workspace",
      "connectionFile":"/srv/private/collaboration/connection.json",
      "actorId":"viewer",
      "inputs":{}
    }
  }
}
```

Multiple aliases may attach to the same workspace and connection with different explicit actor IDs. They do not open additional application writers. Each alias has separate retained files/requests. A connection file can identify only its original workspace.

To declare a complete host input, add an entry under that alias’s inputs:

```json
{
  "customer-documents":{
    "label":"Complete approved customer document source",
    "file":"/srv/private/collaboration/input/customer-documents.json",
    "sha256":"REPLACE_WITH_THE_ACTUAL_COMPLETE_64_HEX_SHA256",
    "bytes":12345,
    "filename":"customer-documents.json",
    "mediaType":"application/json"
  }
}
```

Replace the illustrative length and digest with the actual complete file identity. No tool accepts an arbitrary model-supplied host path. The declared source is reopened, fully hashed and kept stable before and during original upload.

Initialize the existing private Merchant host from the installed module:

```js
import {initializeCollaborativeDocumentsMerchant}
  from './source/products/collaborative-documents/setup.mjs';

const result=await initializeCollaborativeDocumentsMerchant({
  directory:'/srv/private/collaboration/merchant',
  connection:'/srv/private/collaboration/merchant-aliases.json',
  name:'Customer collaborative document operator'
});
```

This prepares the original Merchant configuration, release store and private exports directory; it does not start another application or grant new document access. Keep the returned configuration path and use the installed Merchant HTTP/stdio/client-configuration commands. The ordinary merchant-providers catalog exposes the provider through the maintained registry.

## 9. Complete agent catalog

Every tool name has the prefix merchant_collaboration_. All workspace arguments select a host-declared alias.

| Suffix | Original operation or complete retained result |
| --- | --- |
| status | Declared aliases, connection state and complete input descriptors |
| connect | Authenticate the declared actor against the selected original launch |
| disconnect | Close this attachment and its read handles; keep original app and retained files |
| browser | Current original browser URL without any bearer or provider token |
| info | Complete authenticated session, permissions, runtime and native limits |
| projects | Complete original actor-visible project list |
| project | Complete current or selected historical ProjectView |
| create | Original project creation with exact durable request |
| action | Original action/payload/revision/request, with native semantics unchanged |
| requests | Durable complete original request selections and local outcomes |
| request | Native actor-scoped committed request receipt |
| upload_begin | Select a complete original actor-bound upload |
| upload_status | Original committed upload offset and identity |
| upload_chunk | Exact canonical-base64 range, at most 196608 decoded bytes |
| upload_finish | Verify/finalize the same full original upload |
| upload_input | Stream one complete declared file using original 8 MiB chunks |
| documents | Complete visible document list under actual tenant/document grants |
| persistence | Original document epoch and complete persisted binary/vector receipt |
| artifact | Full original source, checkpoint, handoff or native job file |
| files | Complete retained response/artifact descriptors |
| file | Exact SHA-bound retained bytes through the maintained read ID and offset |
| file_release | Close only the selected read handle |
| inspect | JSON pointer or up to 50 entries from a complete retained JSON response |

File/request listing pages are at most 100 entries. Retained byte pages are at most 196608 bytes. Large native files stream into retained storage; JSON projection is a navigation aid, not the delivered output. Follow references or read the complete saved bytes.

The artifact selection is {projectId,kind,id,revision?}, with kind source, handoff or checkpoint. For kind job, id is the original job ID and fileId is its selected artifact ID. Select exact expectedSha256 and expectedBytes; optional expected filename/media type bind the original download. The original filename is preserved when supplied by the server.

The action tool forwards the original action set, including project.update, source.retain, tenant.save, grant.save, edition.save/freeze, migration.plan/review/apply, deployment.prepare/start/stop/rollback, checkpoint.create, document.restore, job.cancel/resume, handoff.prepare/receive and review.save. The original actor and application validate the full payload. The source-owned tool schema does not invent a shortcut around those checks.

## 10. Exact request recovery and authorization of retained files

Before dispatching create/action, the Merchant adapter saves the complete original input under the original instance, actor and request ID. Reusing the ID with changed content is rejected locally and by the original application.

After an uncertain response:

1. Keep the same alias/actor, request ID, payload and expected revision.
2. Read requests to recover the complete retained input and local result state.
3. Read request for the original application’s actor-scoped completion.
4. If needed, replay the identical create/action. Read its committed original revision/result separately from current runtime/revision observations.
5. Do not create a replacement request solely because an HTTP response was lost.

A successful native action remains confirmed even if local response retention fails. A grant recheck or native job launch can fail after the database commit; the original request receipt resolves that boundary. Replaying a completed request preserves the native result rather than issuing another business mutation.

Retained content is still subject to current original authorization. The cache binds the original installation/actor, role and tenant selection plus every project/document represented in the snapshot. Before returning cached bytes or JSON, the adapter checks the current original session and appropriate project/document access. If one represented document is no longer granted, the old full snapshot is not disclosed merely because another project document remains visible. Administrative snapshots require current operator permission. Persistence always checks the exact current document grant, including for an operator.

After Applications Stop, saved files and requests are not deleted, but content reads need the original application reopened and the same authorized actor reconnected. Reconnection does not adopt another installation or actor’s old content. No session token is retained as an artifact.

## 11. Original CLI

The original CLI has top-level dispatch. The installed wrapper forwards its real process and exit status, preserving the selected source. Use --application or --configuration before the original command:

```sh
starforge collaborative-documents --configuration /srv/private/collaboration/launch.json runtime
starforge collaborative-documents --configuration /srv/private/collaboration/launch.json list --origin http://127.0.0.1:ACTUAL_PORT
starforge collaborative-documents --configuration /srv/private/collaboration/launch.json show --origin http://127.0.0.1:ACTUAL_PORT --project ACTUAL_PROJECT_ID
```

The original API commands read TIPTAP_OPERATOR_TOKEN, or the named environment variable selected by --token-env. The host supplies that private value; it is not a command argument, URL or project source.

Create/action use --input with the exact retained JSON request. Upload requires --file and a stable --upload-id; use the original media type. Download selects an original /api/projects/... source/handoff/checkpoint/job route, verifies the full returned SHA and creates the destination without replacing different bytes. The original receive command preserves the selected placeholder project/revision, request ID, upload ID and whole handoff file.

The original serve command is retained, but do not start it alongside an Applications-owned listener for the same workspace. Applications managed start/stop is the normal customer lifecycle.

## 12. Complete independent receiving

Follow RECEIVING.md and preserve the original 64B7/8F43 operation selection. The full receiving programme must keep one native owner; an unavailable execution route does not authorize a second first dispatch.

The original course uses the complete original reference/document source and five private actors. It operates migration/review, native import/deployment, two-client editing, offline reload/reconnect, durable binary storage, grant denial, checkpoint, configuration rollback, explicit epoch restore and complete handoff receiving. Those authored reference documents are not customer data.

The installed extension then joins the exact resulting original workspaces to Applications and the private Merchant agent. It verifies complete source/runtime installation, actual aliases and current grants, exact mutation replay/native receipts, declared-file upload, original full artifact names/hashes/bytes, retained-file pagination, authorization after revocation, managed Stop/reopen and independent received project/history. It records actual original results; it does not rerun business imports simply to populate a demonstration.

A handoff must follow original native closure and a committed checkpoint of final persisted state. Receiving preserves imported project identity; a temporary receiving placeholder does not become the imported project. Same/forward/older receiving follows original prefix rules, preserving current local history. Receiving-host deployment bindings open stopped. Supply the receiving host’s own auth/runtime and explicitly start when authorized.

Keep the complete Merchant product package, the original portable installed-runtime archive, and named customer .ndjson.gz handoffs, each with its original full manifest and hash. A cold receiver must be able to reopen the real editable product and project, not merely inspect a receipt.

## 13. Installation, grant and recurring customer work

The Installation profile collaborative-documents uses the actual maintained Workshare-derived seed, source authority, buyer/merchant and price/budget selections. Its eleven steps cover complete intake, runtime, migration, editing, authorization, checkpoints/restore, agent use, independent receiving and actual outcome save. It never invents payments, assignments, native observations or customer usage.

The grant chapter and source registration select the same complete original product. Existing reusable implementation is distinct from funded customer adaptation. The accepted programme remains 400 hours/USD 38,000/150 days, with its six packages, three tranches and four payment steps. A commissioned task belongs once to the appropriate package or a separate Workshare.

A repeat purchase represents a real useful document edition, population, onboarding or supported change with complete output and acceptance. Keystrokes, network messages, failed/retried requests, duplicate downloads and additional file formats remain within their original task. Select actual customer calendars, receiving people and useful outputs before counting activity.

## 14. Source authority and acceptance

The original 50 selection is recorded in original-source.json. Consult workbench/CORE-CONTRACT.md, OPERATOR.md, SOURCE-CONTRACT.md, runtime/RUNTIME.md and receiving/SAVING.md for the native contracts. The complete package lock, licenses and original upstream source remain included. Integration source stays separately inspectable, including current-grant cache authorization and durable request handling.

Source review is complete only for the exact reviewed edition. Runtime installation, native operation, actual rendered inspection and customer receiving each need their own actual outcomes. Do not label this product ready for a customer solely because its source is merged or its declarations are registered. Keep the original native owner and finish the whole operating course before presenting the exact outgoing edition as operated.

## Maintained rendered-product instruction

The following current Merchant instruction applies to the original receiving owner and every worker contributing to the outgoing application or attachment:

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Before calling any customer/prospect-facing application, website, dashboard, demo, report, presentation or export ready, open/run/render the exact outgoing version, look at the rendered screen or its actual screenshots, and operate the important user controls. Inspect the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk; do not run broad suites or build a verification product.

Include this complete instruction in delegated assignments and the active owner-controlled policy, boot, build and receiving guidance those workers actually read. Preserve all other owner controls and original operation identities. Leave historical records and third-party/vendor policies intact. Do not force restarts, create watchers or revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Apply the same inspection to every outgoing attachment. New videos require natural generative text-to-speech and an actual watch/listen pass.
