# Collaborative application migration and operations

A complete Tiptap/Hocuspocus application for retaining source documents, reviewing a migration, operating tenant-scoped collaboration, restoring content deliberately, and receiving the complete project on another host.

The editor uses Tiptap and the original Hocuspocus provider. Hocuspocus and Yjs perform synchronization and conflict resolution. The application adds the business and operating workflow around those engines: explicit document grants, reviewed source editions, durable binary storage, native job recovery, operator decisions, and portable handoffs.

## What the application contains

- A browser workspace for sources, mappings, tenant/document access, collaboration, deployments, checkpoints, reviews and delivery history.
- One shared Tiptap schema for JSON/HTML/native binary migration and browser rendering. Unsupported nodes, marks and attributes become visible mapping errors.
- Native Yjs binary persistence in an owned SQLite workspace and a content-addressed object store. A pure deletion must be represented by the full stored binary before the editor reports storage confirmed.
- A host identity adapter or private reference token file, plus explicit tenant and document grants checked when opening a native session and when handling its subsequent messages.
- Original request and job identities for replay, interrupted continuation, start, stop, rollback, checkpoint and restore.
- Complete deterministic NDJSON gzip handoffs containing immutable project history, original source bytes, native binary documents, named checkpoints, request receipts and the editable application source.
- One installed browser/receiving programme that exercises the authored three-document population, two editors, offline merge, a pure deletion, tenant isolation, a new document epoch, configuration rollback and complete receiving.

The exact installed selection is in package.json and package-lock.json. The principal packages are Hocuspocus server/provider 4.7.1, Tiptap 3.31.4, Yjs 13.6.33, y-prosemirror 1.3.7 and y-indexeddb 9.0.12. Select Node 24 on a Linux host with the original flock utility and native Node SQLite API. The application retains one owned workspace writer. A writable received workspace is a separate private copy.

## Install and launch

Run from this component directory. Choose a private installation location outside the source tree for runtime receipts, workspace data and credentials.

```bash
node scripts/install.mjs --receipt /private/tiptap/runtime-ready.json --cache /private/tiptap/npm-cache
node cli.mjs runtime
node cli.mjs serve --directory /private/tiptap/workspace --auth /private/tiptap/auth.json --runtime-ready /private/tiptap/runtime-ready.json --host 127.0.0.1 --port 8785
```

The installer runs the original npm lockfile installation and esbuild bundle, verifies the selected native module locations and shared schema, and writes the completed receipt. An existing receipt is reopened and checked; it is not silently replaced. The server verifies the browser bundle against its complete recorded inputs and binds the runtime to the application source loaded by that process.

The private reference auth file has this shape. Replace the example token with a private generated value, give the file mode 0600, and keep its directory mode 0700.

```json
{
  "schema": "tjlabs.tiptap-auth.v1",
  "actors": [
    {
      "id": "operator",
      "name": "Migration operator",
      "token": "PRIVATE_RANDOM_VALUE",
      "roles": ["operator"],
      "tenantIds": ["*"]
    }
  ]
}
```

A wildcard operator can manage project metadata. A live document session still requires an explicit project grant. The browser keeps the bearer token in memory. For an existing application, mount createApplicationServer with its async contextForRequest(request) identity adapter and return the actual actor id, name, roles and tenantIds. The server revalidates that authority for native session messages. Configure the selected public origin and reviewed allowed origins when mounting behind the application's HTTP/WebSocket host.

The browser is at the printed origin. Its complete operating guide is available at /operator-guide and in [OPERATOR.md](OPERATOR.md). Exact actions, view fields and transport rules are in [CORE-CONTRACT.md](CORE-CONTRACT.md).

## Receive the complete installed runtime

The original runtime contribution in [runtime/RUNTIME.md](runtime/RUNTIME.md) retains both complete upstream source trees, the exact application source, installed dependencies, build outputs and native installation history. It is part of this same application delivery.

For a complete installation archive, run its original prepare command against this component and the delivered source manifest. Supply the already retained original upstream archives when available; the runtime verifies every original Git member.

```bash
python3 -B runtime/manage.py prepare --application /absolute/component --manifest /private/tiptap/source-manifest.json --directory /private/tiptap/prepared-runtime --node /absolute/node --npm /absolute/npm --hocuspocus-archive /private/original-hocuspocus.tar.gz --tiptap-archive /private/original-tiptap.tar.gz --export /private/tiptap/complete-runtime.tar.gz
```

Use the returned application path. From that prepared application, bind the core receipt without reinstalling its already completed dependencies or build:

```bash
node scripts/install.mjs --prepared-runtime /private/tiptap/prepared-runtime --receipt /private/tiptap/runtime-ready.json
```

The same runtime contribution independently receives its complete archive on a compatible host. Run this adapter from that returned receiving application and select a new private receipt. The installed application and the original business project are separate handoffs: receive the full project through the original application API, then explicitly start its deployment under that host's identity.

## Work through a project

Create a project and record the intended tenant boundaries. Upload and retain the original document input; supported intake is Tiptap JSON, HTML, or an original Yjs v1 binary update. The reference JSON mapping is retained in the operator guide. Each individual document has a 32 MiB ceiling and a complete uploaded source/handoff has a 512 MiB ceiling.

Create and freeze a source/configuration edition, plan its migration, and review every row. The native converter validates against the same schema used by the browser. Review source errors and explicit skips before applying. Converted original Yjs bytes are retained before any target commit. A migration does not overwrite an already populated target.

Select a deployment and grant the actual actors access to the exact tenant/documents. Native collaboration starts only through the original deployment action. The editor exposes local changes, synchronization and durable storage distinctly. Its durable receipt compares the complete Yjs update and state vector; synchronization alone is insufficient.

A configuration rollback uses the selected earlier edition while preserving current document content. A content restore drains the current deployment and creates a new physical document epoch from the selected checkpoint. Earlier connected/offline clients retain their earlier epoch and cannot merge their pending state into the restored epoch.

Prepare the complete handoff after the original native owner has drained. Receive that file using the original upload and handoff.receive actions. The imported project keeps its original identity and prefix history. Same-package replay, forward receiving and older-package receiving preserve the current source and existing history. The receiving host supplies its own credentials and explicitly starts its own deployment.

## CLI and host integration

```bash
node cli.mjs help
node cli.mjs list --origin http://127.0.0.1:8785
node cli.mjs show --origin http://127.0.0.1:8785 --project PROJECT_ID
node cli.mjs action --origin http://127.0.0.1:8785 --input retained-action.json
node cli.mjs upload --origin http://127.0.0.1:8785 --file documents.json --upload-id ORIGINAL_UUID
node cli.mjs download --origin http://127.0.0.1:8785 --path /api/projects/PROJECT_ID/handoffs/HANDOFF_ID/download --output complete-project.ndjson.gz
```

API commands read TIPTAP_OPERATOR_TOKEN, or the name selected by --token-env. Retain the exact action JSON and request/upload IDs. The current host state is reconciled before original request replay. A completed start receipt is historical after its owner ends; explicit continuation starts the same deployment with a retained new start request. It does not repeat the migration.

## Complete installed receiving

Use the source manifest delivered with this edition, the original completed installation receipt, and an actually installed Playwright module and Chromium executable.

```bash
node receiving/receive.mjs --source /absolute/component --directory /private/tiptap/receiving --runtime-ready /private/tiptap/runtime-ready.json --source-manifest /private/tiptap/source-manifest.json --playwright /absolute/playwright/index.mjs --chromium /absolute/chrome
```

After a reviewed interruption, append --resume with all the same input selections. The retained journal keeps the exact pending HTTP requests, source population, native job identities, browser storage and named artifacts. No phase is counted complete until its actual result and retained outputs are present. The programme's result.json and complete delivery files establish the operated result; source parsing and installation receipts establish their respective earlier stages only.

The reference population is explicitly authored demonstration content. It is not a customer migration or a scale benchmark. Customer source, schema, identity and hosting choices are reviewed under the separate [implementation workshare](WORKSHARE.md).

## Recovery and the saved receiving case

The operator exposes an awaited `window.migrationWorkspace.close()` boundary. It stops new UI admissions, drains the original editor and requests, retains closing drafts and accepted responses, and closes its local storage before returning `{state:'CLOSED'}`. If closure fails, the same application keeps its remaining owners available for another attempt. A pending action's **Read original receipt** control reads the original actor/request receipt without submitting the action again.

The installed receiving programme retains each original application, browser, native process and file owner through actual closure. A completed result whose final journal or closure record was interrupted can use `--recover-completed` with the exact original selections. That mode verifies the immutable result and all its files, repairs only local completion records, and starts no application host or browser.

[receiving/SAVING.md](receiving/SAVING.md) describes the complete original receiving-to-private-case workflow. It invokes this same Node receiver using the selected Node 24 installation and a separately installed receiving application. The closed private case contains actual workspaces, native document objects, original NDJSON-gzip handovers, textual observations, immutable results, journals and closure receipts. Git-backed application source stays in its complete source delivery; authentication secrets, browser profiles and temporary screenshots remain outside the saved case. The existing file-transfer helper owns its ordinary prepare, transfer and finalize operation.

All selected application files, the package and lockfile, original source manifest, runtime-ready receipts and actual browser identities are verified before the course. The original three-document reference and all twelve business-course checks remain unchanged. Completion requires the actual receiving result and its complete files; these source changes alone establish no executed customer or reference result.

## Source and license

[SOURCE-CONTRACT.md](SOURCE-CONTRACT.md) records the original engine boundaries and supporting source URLs. New application source uses the MIT license in LICENSE. The unchanged original workspace helper closure and its license remain under vendor/stellar-expert/. npm retains the original third-party package sources and licenses. The lockfile and completed runtime receipt select the actual native implementation.

No commercial Tiptap cloud license, paid extension or customer commitment is implied by this open-source reference application.
