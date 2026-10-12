# Soroban event Merchant operations

Operate saved Stellar contract-event queries, retain the actual RPC acquisition, freeze an event edition, and deliver its complete source files through the existing Merchant host. The Merchant provider opens the same original workspace used by the native event engine and Applications. Each interface shares the original plan versions, capture IDs, request journal, revisions, exports, and native workspace lease.

The installed command is `starforge-merchant merchant-soroban-events`. The package export is `./merchant/mcp/soroban-events`. The adjacent `client.d.ts` describes all 18 tools, their arguments and replies, complete-file transfers, and setup.

## Connect an original workspace

Create one private UTF-8 connection file. Paths below are examples; select the actual original directories and RPC endpoint for the intended network.

```json
{
  "schema": "stellar-forge.soroban-events-connection.v1",
  "workspaces": {
    "ledger": {
      "label": "Contract events",
      "directory": "/private/soroban/ledger",
      "rpcUrl": "https://soroban-testnet.stellar.org",
      "network": "stellar:testnet"
    },
    "received": {
      "label": "Received event source",
      "directory": "/private/soroban/received"
    }
  },
  "receivers": {
    "analyst": "received"
  }
}
```

A connection supports 1–32 workspace aliases. Each original canonical directory has one alias. An entry with an RPC endpoint selects `stellar:testnet` or `stellar:pubnet`; a receiving-only workspace can omit both endpoint and network. Each receiver selects one already-declared workspace alias, which keeps one native owner per directory.

For authenticated RPC services, prefer `headerEnv`, for example `{"Authorization":"SOROBAN_RPC_AUTHORIZATION"}`, with the complete header value in that environment variable. Private `headers` are also accepted. Public state contains only the connection ID, network and RPC origin. Actual URL paths, queries and header values stay in the host connection. HTTPS is required by default. An explicitly configured native/local HTTP source can set `allowHttp:true`.

Keep the private connection file and directories outside the exported source. Existing directories must be private and canonical. A new workspace is initialized by its original native opener when the Merchant `open` operation first owns it.

Initialize a private Merchant directory:

```sh
starforge-merchant merchant-soroban-events init \
  --directory /private/merchants/soroban \
  --connection /private/config/soroban-events.json \
  --name "Contract event operations"
```

Setup writes the exact connection binding and normal `merchant-mcp.json`, initializes the original release store, creates its export directory, and validates the configuration with the maintained Merchant reader. Repeating this same setup resumes its original staged publication and release-store initialization. Keep the saved setup and connection bytes together.

The result has this shape:

```json
{
  "schema": "stellar-forge.merchant-mcp.v1",
  "state": "INITIALIZED",
  "configuration": "/private/merchants/soroban/merchant-mcp.json",
  "source": "original-soroban-events-workspace",
  "workspaces": [
    {
      "workspace": "ledger",
      "label": "Contract events",
      "captureConfigured": true,
      "network": "stellar:testnet"
    },
    {
      "workspace": "received",
      "label": "Received event source",
      "captureConfigured": false,
      "network": null
    }
  ],
  "receivers": { "analyst": "received" }
}
```

Start the existing authenticated Merchant host with that configuration:

```sh
starforge-merchant merchant-mcp serve \
  --config /private/merchants/soroban/merchant-mcp.json --port 3211
```

The standard stdio entry point is `starforge-merchant merchant-mcp-stdio --config /private/merchants/soroban/merchant-mcp.json`. The generic initializer can also run `starforge-merchant merchant-providers init soroban-events --options /private/setup.json`, where the JSON contains `directory`, `connection` and optional `name`.

Supply the existing Merchant credential through `MCP_ACCESS_TOKEN` or another environment variable selected by `--token-env`. The client uses the original authenticated MCP HTTP initialization and tool transport. It accepts HTTPS or the original loopback HTTP listener.

## Save, acquire and resume the original source

Open the configured workspace once on the running Merchant host. Retain every complete mutation request before sending it. Its `requestId`, `expectedRevision` and full body identify that operation after an interrupted reply.

```js
import {openSorobanEventsMerchantClient} from './client.mjs';

const client = await openSorobanEventsMerchantClient({
  url: process.env.SOROBAN_MERCHANT_URL,
  tokenEnv: 'MCP_ACCESS_TOKEN'
});
const original = await client.open({workspace: 'ledger'});

const planRequest = {
  workspace: 'ledger',
  requestId: 'events-plan-2026-10-12',
  expectedRevision: original.revision,
  name: 'Contract event source',
  pageSize: 100,
  filters: []
};
const saved = await client.planSave(planRequest);

const captureRequest = {
  workspace: 'ledger',
  requestId: 'events-capture-2026-10-12',
  expectedRevision: saved.revision,
  planId: saved.plan.id
};
const started = await client.captureStart(captureRequest);
const captureId = started.capture.id;
const status = await client.captureStatus({workspace: 'ledger', captureId});
```

An empty filter list selects the native available event scope. Supply the actual contract/topic/type filters and optional `startLedger` and `endLedger` for the intended acquisition. The native engine validates the RPC query and checks the endpoint's actual network. It snapshots the available retention boundary and fixed ending ledger, then retains each exact JSON-RPC exchange and its cursor. Unknown event fields and original XDR strings remain in the acquired objects.

A plan save can supply `planId` to save another version of the same plan. Existing captures retain their original plan version.

Capture status reports one of `PENDING`, `CAPTURING`, `INTERRUPTED`, `WAITING_FOR_LEDGER` or `COMPLETE`, along with the original frontier, page and attempt history, and returned error. Read the retained status and current workspace revision before explicitly resuming:

```js
const current = await client.state({workspace: 'ledger'});
const resumed = await client.captureResume({
  workspace: 'ledger',
  requestId: 'events-resume-2026-10-12',
  expectedRevision: current.revision,
  captureId
});
```

Resuming keeps that same capture and cursor. If a reply to an already-sent mutation is lost, repeat the exact saved request first. The native journal returns the completed original result before checking its old revision. A new body needs a new request ID and the current revision.

Read complete original events by their saved page cursor:

```js
let after;
do {
  const page = await client.events({
    workspace: 'ledger', captureId, limit: 100,
    ...(after === undefined ? {} : {after})
  });
  for (const event of page.rows) {
    // event is the complete original RPC event object.
    console.log(event);
  }
  after = page.nextCursor ?? undefined;
} while (after !== undefined);
```

The `contractId` and `type` parameters select a view of the retained capture. A view does not change its acquired raw source.

## Freeze and deliver a complete source edition

After the capture is complete, use the current revision to create an edition. Keep the edition and full export results with the intended delivery:

```js
const current = await client.state({workspace: 'ledger'});
const edition = await client.editionCreate({
  workspace: 'ledger',
  requestId: 'events-edition-2026-10-12',
  expectedRevision: current.revision,
  captureId,
  name: 'Contract events for analysis'
});
const exported = await client.sourceExport({
  workspace: 'ledger',
  requestId: 'events-export-2026-10-12',
  expectedRevision: edition.revision,
  editionId: edition.edition.id
});

const receipt = await client.downloadExport({
  workspace: 'ledger',
  exportId: exported.export.id,
  expectedManifestSha256: exported.export.manifestSha256,
  directory: '/private/deliveries/contract-events',
  onProgress: progress => console.log(progress.file, progress.bytes, progress.total)
});
const reopened = await client.reopenExport({
  workspace: 'ledger',
  exportId: receipt.exportId,
  expectedManifestSha256: receipt.manifestSha256,
  directory: receipt.directory
});
```

The receiver retains the exact native `manifest.json` bytes and every declared source file in its original path:

| Native path | Contents |
| --- | --- |
| `source.json` | Original workspace, plan, capture and edition metadata |
| `captures/<capture ID>/exchanges/*.json` | Exact JSON-RPC exchange documents, including retained raw response bytes |
| `editions/<edition ID>/events.json` | The complete original event objects selected by the edition |
| `manifest.json` | Original file paths, byte counts and SHA-256 identities |

The maintained downloader adds its own private `download-state` directory for checkpoints. It preserves nested native paths and verifies complete file hashes before publishing each file and the final manifest. An interrupted transfer resumes with the same endpoint, workspace alias, export ID, manifest hash and local directory. A lost retained-reader handle is reopened for the same original file and byte offset. The offline `reopen` command verifies every original local file.

Complete downloads stream files up to 8 GiB each through the existing retained descriptor reader; the manifest limit is 64 MiB. They use bounded file chunks up to 196,608 bytes. The client's complete JSON reader supports a selected original JSON file up to 128 MiB. Larger original files remain available through download.

```js
const inspected = await client.inspectExport({
  workspace: 'ledger',
  exportId: exported.export.id,
  expectedManifestSha256: exported.export.manifestSha256
});
const eventFile = inspected.manifest.files.find(file =>
  file.path === 'editions/' + edition.edition.id + '/events.json'
);
const events = await client.readJson({
  workspace: 'ledger',
  exportId: exported.export.id,
  expectedManifestSha256: inspected.manifestSha256,
  file: eventFile.path
});
```

`readJson` reads every original byte, verifies its SHA-256, then decodes the complete value. The `json` tool supports JSON Pointer navigation and array/object pages for interactive inspection. If one preview exceeds its reply limit, the reply identifies the complete original file containing it.

To reopen the source as a separate editable workspace on the configured host:

```js
const destination = await client.open({workspace: 'received'});
const received = await client.receiveExport({
  workspace: 'ledger',
  exportId: exported.export.id,
  expectedManifestSha256: exported.export.manifestSha256,
  receiver: 'analyst',
  requestId: 'events-receive-2026-10-12',
  expectedRevision: destination.revision
});
```

The receiving revision belongs to `received`. The native importer binds the exact manifest hash, verifies declared files against the original RPC page/cursor chain and event projection, preserves original plan/capture/edition IDs, and reopens the saved plan for later local work. A receive-only connection needs no RPC endpoint. Future captures use the receiving workspace's separately configured endpoint.

## Publication and shared ownership

`publisherSource({workspace, editionId})` returns the selected original event file, complete byte count, SHA-256 and format for the existing dataset publisher. The source-native `soroban-events-publish` command prepares or appends that same edition through the original event feed, Merchant release and Buyer workflow. The parent product guide documents that publication journey and its retained selection.

Close the Merchant workspace before opening the same directory in the native CLI, publisher or Applications. Closing drains owned calls and releases the original engine and retained file descriptors. The separate receiving workspace can be closed explicitly by its own alias.

```js
await client.close({workspace: 'ledger'});
await client.close({workspace: 'received'});
```

## CLI operations

Each remote command accepts `--url` and optional `--token-env`. `call --action ACTION --args ARGS_JSON` exposes every complete declared tool input. `tools` prints the machine-readable catalog.

| Tool action, after `merchant_soroban_events_` | Client method | CLI command |
| --- | --- | --- |
| `workspaces` | `workspaces` | `workspaces` |
| `open`, `close`, `state` | same names | same names |
| `plan_save` | `planSave` | `plan --args PLAN_JSON` |
| `capture_start` | `captureStart` | `capture --plan-id UUID` |
| `capture_resume` | `captureResume` | `resume --capture-id UUID` |
| `capture_status` | `captureStatus` | `status --capture-id UUID` |
| `events` | `events` | `events --capture-id UUID` |
| `edition_create` | `editionCreate` | `edition --capture-id UUID --name NAME` |
| `edition` | `edition` | `show-edition --edition-id UUID` |
| `source_export` | `sourceExport` | `export --edition-id UUID` |
| `publisher_source` | `publisherSource` | `publisher-source --edition-id UUID` |
| `manifest` | `manifest`, `inspectExport` | `inspect --export-id SHA` |
| `file`, `file_release` | `file`, `fileRelease` | `call` or complete `download` |
| `json` | `json`, complete `readJson` | `json`, complete `value` |
| `receive` | `receive`, `receiveExport` | `receive --receiver ALIAS` |

Mutating CLI commands require the saved `--request-id` and `--expected-revision`. Plan JSON contains `name` and optional `planId`, `startLedger`, `endLedger`, `filters` and `pageSize`. The plan command supplies the workspace and mutation fields separately, preventing accidental replacement by the file.

```sh
starforge-merchant merchant-soroban-events download \
  --url http://127.0.0.1:3211/mcp \
  --workspace ledger --export-id "$SOROBAN_EXPORT_ID" \
  --manifest-sha256 "$SOROBAN_MANIFEST_SHA256" \
  --directory /private/deliveries/contract-events

starforge-merchant merchant-soroban-events reopen \
  --workspace ledger --export-id "$SOROBAN_EXPORT_ID" \
  --manifest-sha256 "$SOROBAN_MANIFEST_SHA256" \
  --directory /private/deliveries/contract-events
```

Command errors retain the original mutation request ID, workspace and action when available. Read the original saved request and source state to recover that operation, then continue the same native capture or source delivery.
