# Collaborative Document runtime preparation and portable receiving

This command prepares the complete original Tiptap/Hocuspocus application for the installed Merchant product. It receives the original runtime on a second private path and binds each returned application to its own native receipt. The next step is the existing Applications Review → Save → Start workflow, using the returned application and receipt paths.

The business workspace remains separate. This preparation does not open a document server, create tenants or grants, import documents, restore epochs, or run the two-client receiving course. Those actions belong to the original workshare operation and its existing receiving owner.

## Selected source and runtime

The installed product contains the unchanged 50-file application from Commons commit `fce1f8b787822513fb1b8a1ed77f41c5f2322fae`. Its exact selection is `products/collaborative-documents/original-source.json`, SHA-256 `7f99b944d4cc09f589bc04d189db492ad172501b181f6d3404be027e3d0255b8`. Every original source body is checked before preparation and again at each prepared or received application path.

The original application requires **Node 24**, including its native `node:sqlite` API. Use the same actual Node executable to invoke the installed command, bind its receipts, and start its managed Applications. Preparation records the executable, full version, ABI, operating system, and architecture. The package selects these exact direct dependencies:

| Packages | Version |
| --- | --- |
| `@hocuspocus/server`, `@hocuspocus/provider` | 4.7.1 |
| `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret`, `@tiptap/html`, `@tiptap/pm` | 3.31.4 |
| `yjs` | 13.6.33 |
| `y-prosemirror` | 1.3.7 |
| `y-indexeddb` | 9.0.12 |
| `crossws` | 0.4.15 |
| `esbuild` | 0.28.2 |
| `parse5` | 8.0.1 |
| `ws` | 8.22.0 |

The unchanged 50,357-byte npm lock has SHA-256 `72621f79b14ef8f2bcccb1b02e29ad43784c8aec8d6c50561ca0bf3e330f845e`. The original `runtime/manage.py` owns npm resolution, installation, original upstream source acquisition, build, complete installed inventory, and portable receiving. The adapter invokes those existing operations; it has no separate dependency resolver or collaboration engine.

Full upstream source is retained by the original runtime: Hocuspocus `bd288a4441fb60a663bbaf34660a490eb59dd6ea` and Tiptap `d9af9c6a16e17438b06b2266765b9c1a21a3d7a0`, selected in the unchanged `runtime/upstreams.json`. Original source licences and examples travel with the complete runtime archive.

## One complete preparation

Select an owned private operation directory outside the installed workbench and its ancestors. Use the actual compatible host's Node 24, npm and Python executables.

```sh
/ACTUAL/node /INSTALLED/starforge.mjs collaborative-documents-prepare prepare \
  --directory /PRIVATE/collaborative-preparation \
  --npm /ACTUAL/npm \
  --python /ACTUAL/python3
```

The exact installed distribution may expose `starforge` directly; use its existing command entry. The complete source module can also be called with the same Node executable:

```sh
/ACTUAL/node /INSTALLED/products/collaborative-documents/prepare.mjs prepare \
  --directory /PRIVATE/collaborative-preparation \
  --npm /ACTUAL/npm \
  --python /ACTUAL/python3
```

On a host with the original complete upstream archives already retained, provide both original archive paths:

```sh
/ACTUAL/node /INSTALLED/products/collaborative-documents/prepare.mjs prepare \
  --directory /PRIVATE/collaborative-preparation \
  --npm /ACTUAL/npm \
  --python /ACTUAL/python3 \
  --hocuspocus-archive /PRIVATE/original-hocuspocus.tar.gz \
  --tiptap-archive /PRIVATE/original-tiptap.tar.gz
```

Each supplied archive is frozen by complete length and SHA in the request. The original collector verifies its selected Git members. Without supplied archives the original collector acquires its selected upstreams. Initial npm preparation needs access to the selected packages unless their original runtime environment already supplies the required cache.

The complete command performs:

1. Verify all 50 installed source members and the pinned original source selection.
2. Save the exact command request, executable identities, source hashes, selected input archives and operation directory.
3. Invoke original `runtime/manage.py prepare` with the unchanged lock and browser build enabled.
4. Receive its returned `prepared-runtime/application`, inspect the full installed inventory, and verify its original 50 source members.
5. Execute that application's original `scripts/install.mjs --prepared-runtime`. This adopts the already prepared runtime and writes a ready receipt; it does not run another npm installation or browser build.
6. Export the complete original runtime through `runtime/manage.py export`.
7. Independently receive that complete archive through `runtime/manage.py receive` into `received-runtime`.
8. Bind the received application's original installer receipt to its actual location and Node executable.
9. Recheck the ready receipts, full package inventories, source bodies, and original browser build inputs/output before publishing the complete preparation result.

A successful result uses schema `stellar-forge.collaborative-documents-preparation.v1`, status `READY`, and includes:

| Field | Meaning |
| --- | --- |
| `primary.applicationDirectory` | Actual complete original prepared application |
| `primary.runtimeReadyFile` | Its host-specific original native selection receipt |
| `primary.runtimeDirectory` / `runtimeId` | Original complete prepared runtime identity |
| `receiving.applicationDirectory` | Independently received original application |
| `receiving.runtimeReadyFile` | Ready receipt bound to that received path |
| `receiving.runtimeDirectory` / `runtimeId` | Distinct original received runtime identity |
| `archive` | Complete archive path, bytes and SHA-256 |
| `next` | Primary application/receipt pair for Applications; received pair in receive-only mode |

The complete result lives at `OPERATION/.runtime/PREPARED.json`. Its frozen candidate is written first. If publication is interrupted, the same command verifies and adopts those exact saved values.

## Use the actual returned application

The original runtime intentionally copies the selected application into its prepared or received directory. Its module paths and ready receipt belong to that returned location. Do not substitute the installed source-only `workbench` path or copy a ready receipt from a different application directory.

Use the resulting pair in the existing private launch configuration:

```json
{
  "applicationDirectory": "/PRIVATE/collaborative-preparation/prepared-runtime/application",
  "runtimeReadyFile": "/PRIVATE/collaborative-preparation/.runtime/primary-runtime-ready.json"
}
```

These are the two runtime fields to join to the full original host configuration, which also selects the private business workspace, actual auth file, actor, and connection file. The existing Applications provider reviews and freezes that complete configuration. Start rechecks every original source member before dynamically importing the selected original server. The server itself checks the original native selection and browser build before opening the business Store.

For a received customer installation use the **received** application/receipt pair from the result. Give each business workspace its own configured private auth and connection files through the existing installation workflow. Credentials and document-server access grants are separate from preparation and are not placed in the runtime source archive.

## Browser-build and source identity

The original build produces `dist/app.js` and `dist/build-manifest.json`. The manifest binds every actual esbuild source input and the full browser output to the native runtime selection and exact lockfile. Preparation checks this complete set before returning READY.

The original complete application inventory includes installed dependencies and browser output. After the original runtime declares READY, do not add files inside its inventoried application. This adapter stores request history, command logs and ready receipts under the operation's separate `.runtime` directory. The original installer lock sits beside its application.

The installed source verifier permits only the original 50 files plus the original generated root `node_modules`, `dist`, and `.runtime` directories. Product adapters and `original-source.json` remain outside the workbench. This preserves the application's full editable-source selection.

## Continue an interrupted original preparation

Repeat the same complete command with `--resume`:

```sh
/ACTUAL/node /INSTALLED/products/collaborative-documents/prepare.mjs prepare \
  --directory /PRIVATE/collaborative-preparation \
  --npm /ACTUAL/npm \
  --python /ACTUAL/python3 \
  --resume
```

Include the same archive flags if they were selected initially. Changing the original directory, Node identity, executable selection, source manifest, input archive body or mode is rejected.

The operation's kernel lock protects its wrapper records and is inherited by each direct original command. The original runtime and installer retain their own complete native lock ownership through npm/build. A disconnected observer is not proof that a command ended; the next original command reconciles through that same runtime or installer lock.

Every command retains its full argv, source binding, original request, actual process-start observation, complete stdout/stderr and terminal result. A failed record write after spawning keeps the same child and waits for its actual closure before releasing the wrapper's lock or logs. Closed successful results can be adopted even when the first success acknowledgement was lost.

An incomplete dependency installation is handled by the unchanged runtime's same-directory command and native attempt history. This wrapper does not automatically select the original runtime's explicit `--repair-dependencies` option, change an existing source selection, or replace a completed READY inventory. If the native owner determines an explicit dependency repair is required, use its existing original repair operation and then resume this same request after the original runtime is READY.

## Inspect a complete result

```sh
/ACTUAL/node /INSTALLED/products/collaborative-documents/prepare.mjs inspect \
  --directory /PRIVATE/collaborative-preparation
```

Inspection reopens the saved result, original ready receipts, complete source/application inventories, browser build and archive identity. It does not dispatch a document application. An incomplete preparation remains a same-request resume, not a reported READY result.

## Deliver the complete runtime

The initial complete preparation already saves `OPERATION/collaborative-documents-runtime.tar.gz` and independently receives it. Retain that complete archive together with `PREPARED.json` and the original editable business package. The runtime archive carries native dependencies/build/source; the business package carries the original document binaries, tenants, grants, migrations, reviews, checkpoint/epoch history and original request results.

To export another named full runtime artifact through the same original runtime owner:

```sh
/ACTUAL/node /INSTALLED/products/collaborative-documents/prepare.mjs export \
  --directory /PRIVATE/collaborative-preparation \
  --output /PRIVATE/delivery/Collaborative_Document_Runtime.tar.gz
```

The named output must be outside the preparation root. An existing different output is preserved and rejected by the original exporter; it is not replaced.

## Independently receive on a compatible host

Install the same complete Merchant source selection on the receiving host and select the complete original runtime archive. Use Node 24 on the original operating system and architecture:

```sh
/ACTUAL/node /INSTALLED/products/collaborative-documents/prepare.mjs receive \
  --directory /PRIVATE/customer-collaborative-runtime \
  --archive /PRIVATE/delivery/Collaborative_Document_Runtime.tar.gz \
  --python /ACTUAL/python3
```

This invokes original full receiving, inspects every selected installed file, verifies the unchanged 50 source members, and binds the actual received application using its original installer. It performs no npm acquisition. The returned `receiving` and `next` fields identify the actual application and ready receipt to configure.

The original receiver requires compatible operating system and architecture, and matching Node ABI when native add-ons are present. The application browser manifest also binds the exact Node runtime selection. Use the same Node version for a byte-preserving runtime receive. If that complete selection is incompatible, the existing runtime owner prepares the retained source and lock on the target host instead of relabeling incompatible binaries.

## Receiving course and handover

Preparation is one input to the existing complete Tiptap/Hocuspocus workshare programme `TIPTAP-HOCUSPOCUS-APPLICATION-WORKSHARE-0C7A-20261012`. Preserve the original 64B7/8F43/0C7A owner and same receiving journal.

The integrated course uses both returned ready application paths, opens the original operator, receives original source documents, reviews mappings, imports through native Yjs, configures actual tenant/document grants, and starts the selected deployment. Its two authenticated clients exercise concurrent editing, IndexedDB offline reload, reconnect/merge, and durable binary persistence. It then checks read-only and tenant isolation, original checkpoint/rollback/new-epoch restore, complete named business handoffs, independent receiving and cold reopen.

The producing owner opens and runs the exact outgoing application, inspects its actual desktop and relevant mobile states, and visually checks the retained screenshots. Exercise the real downloads, open the complete ZIP contents, and reopen the exported workspaces on the independent received application. Inspect every page of any attached PDF and every other outgoing attachment before delivery. Keep this work inside the original complete receiving programme and its existing native/browser owner; source checks and a READY runtime supply its inputs.

Keep the complete native logs, selected runtime archive, original source manifest, preparation result, original programme result, screenshots, reopened exports, and final customer artifacts together. The delivery identifies which actual application/receipt pair serves each workspace and which existing operator owns its next Start, Stop, upgrade, and restore.

## Maintained rendered-product instruction

The following current Merchant instruction applies to the original receiving owner and every worker contributing to the outgoing application or attachment:

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Before calling any customer/prospect-facing application, website, dashboard, demo, report, presentation or export ready, open/run/render the exact outgoing version, look at the rendered screen or its actual screenshots, and operate the important user controls. Inspect the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk; do not run broad suites or build a verification product.

Include this complete instruction in delegated assignments and the active owner-controlled policy, boot, build and receiving guidance those workers actually read. Preserve all other owner controls and original operation identities. Leave historical records and third-party/vendor policies intact. Do not force restarts, create watchers or revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Apply the same inspection to every outgoing attachment. New videos require natural generative text-to-speech and an actual watch/listen pass.
