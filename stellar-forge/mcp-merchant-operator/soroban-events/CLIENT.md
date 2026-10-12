# Soroban event Merchant operations

Operate saved Stellar contract-event queries, retain the actual RPC acquisition, freeze an event edition, and deliver its complete source files through the existing Merchant host. The Merchant provider opens the same original workspace used by the native event engine and Applications. Each interface shares the original plan versions, capture IDs, request journal, revisions, exports, and native workspace lease. Recurring watches use a native watch adapter beside that same engine, with their own control revision and source window history.

The installed command is `starforge-merchant merchant-soroban-events`. The package export is `./merchant/mcp/soroban-events`. The adjacent `client.d.ts` describes all 28 tools, their arguments and replies, complete-file transfers, and setup.

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

Resuming keeps that same capture and cursor. An optional `connectionAlias` selects a compatible host-configured recovery endpoint while the native engine retains that original cursor and pins the actual public connection identity per attempt. The Merchant CLI exposes this as `resume --connection-alias ALIAS`. If a reply to an already-sent mutation is lost, repeat the exact saved request first. The native journal returns the completed original result before checking its old revision. A new body needs a new request ID and the current revision.

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

## Run a recurring contract-event service

A watch turns a saved native query into a continuing event service. It retains the source workspace identity, plan version for each window, next ledger, active native capture and cursor, completed editions, and publication progress. The same original engine performs acquisition and source recovery. A watch has an independent revision: use `watchState` for watch changes and `state` for plan/capture/edition changes.

### Trusted connections and publication destinations

Extend the private host connection with named connections and publications. This example uses the actual public testnet RPC as the named `testnet` connection. Keep the existing default RPC fields when the same workspace also uses the single-capture commands.

```json
{
  "schema": "stellar-forge.soroban-events-connection.v1",
  "workspaces": {
    "ledger": {
      "label": "Contract event service",
      "directory": "/private/soroban/ledger",
      "rpcUrl": "https://soroban-testnet.stellar.org",
      "network": "stellar:testnet",
      "connections": {
        "testnet": {
          "rpcUrl": "https://soroban-testnet.stellar.org",
          "network": "stellar:testnet"
        }
      },
      "publications": {
        "contract-feed": {
          "directory": "/private/publications/contract-events",
          "label": "Contract events"
        }
      }
    },
    "received": {
      "label": "Received contract event service",
      "directory": "/private/soroban/received",
      "connections": {
        "testnet": {
          "rpcUrl": "https://soroban-testnet.stellar.org",
          "network": "stellar:testnet"
        }
      },
      "publications": {
        "received-feed": {
          "directory": "/private/publications/received-contract-events"
        }
      }
    }
  },
  "receivers": {
    "analyst": "received"
  }
}
```

Each named connection accepts the same `rpcUrl`, `network`, `headers`, `headerEnv` and `allowHttp` fields as the default connection. Both forms also accept the original `timeoutMs` (1,000–300,000) and `maxResponseBytes` (1,024–268,435,456) settings. Named RPC aliases preserve the native upper- or lower-case spelling. Explicit HTTP is limited to native loopback endpoints. Configure `default` once, either through the existing flat RPC fields or the named map. A workspace accepts up to 32 named connections and 32 publication aliases. Public workspace descriptions list their aliases; the engine lists their network, source ID and RPC origin.

A Merchant watch request selects `connectionAlias`, optional `recoveryConnectionAlias`, and `publication` by alias. The maintained host resolves the publication alias to the native `{directory, feedId?, sourceId?, label?, description?}` descriptor. Native publication state remains in its original separate directory. A receiving publication alias selects a private base directory. The native importer restores each historical target into its own identity-bound child directory, preserving the original feed and source identities.

The host connection file remains private. Watch source exports contain the original source identities and acquisition, with host paths and credentials removed by the native exporter. Bind the receiving host's actual connection and publication aliases when receiving.

### Configure, catch up, start and pause

Open the Merchant workspace, save the original plan through `planSave`, then create its watch. The plan ID below is the original saved plan ID from the acquisition workflow.

```js
const watchState = await client.watchState({workspace: 'ledger'});
const watchRequest = {
  workspace: 'ledger',
  requestId: 'contract-service-save-2026-10-12',
  expectedRevision: watchState.revision,
  name: 'Contract event service',
  planId: saved.plan.id,
  connectionAlias: 'testnet',
  windowLedgers: 5000,
  pollIntervalMs: 5000,
  publication: 'contract-feed'
};
const watchSaved = await client.watchSave(watchRequest);
const watchId = watchSaved.watch.id;

// A finite catch-up also works while the watch's desired state is PAUSED.
const caughtUp = await client.watchRun({
  workspace: 'ledger', watchId, maxWindows: 1
});
console.log(caughtUp.busy, caughtUp.completedWindows, caughtUp.watch.nextLedger);

const beforeStart = await client.watchState({workspace: 'ledger'});
const startRequest = {
  workspace: 'ledger',
  requestId: 'contract-service-start-2026-10-12',
  expectedRevision: beforeStart.revision,
  watchId
};
const running = await client.watchStart(startRequest);
const progress = await client.watchStatus({workspace: 'ledger', watchId});
```

The Merchant host owns one native recurring loop per open workspace. Starting a watch commits `RUNNING` and the native loop acquires its windows. A disconnected client does not end the host's service. Reopening an original workspace resumes its persisted running watches. The loop idles while every watch is paused.

`watchRun` performs 1–1000 finite windows; the default is one. When the same watch already owns its native source lease, the call returns `busy:true` and its current state. Read that source state to follow the existing run. Pausing during acquisition lets the current original source operation drain.

```js
const beforePause = await client.watchState({workspace: 'ledger'});
const paused = await client.watchPause({
  workspace: 'ledger', watchId,
  requestId: 'contract-service-pause-2026-10-12',
  expectedRevision: beforePause.revision
});
const afterPause = await client.watchStatus({workspace: 'ledger', watchId});

const beforeConfigure = await client.watchState({workspace: 'ledger'});
const configured = await client.watchConfigure({
  workspace: 'ledger', watchId,
  requestId: 'contract-service-configure-2026-10-12',
  expectedRevision: beforeConfigure.revision,
  windowLedgers: 2500,
  pollIntervalMs: 10000,
  endLedger: null
});
```

A configuration applies to later windows. The active window retains its selected plan version and source connection. `endLedger` is exclusive; set it to `null` to continue without a fixed final ledger. `publication:null` disables future publication; `recoveryConnectionAlias:null` clears that optional recovery route. Window size is 1–1,000,000 ledgers. Poll interval is 1,000–86,400,000 milliseconds. The native RPC page/frontier rules still govern each acquisition.

A new watch starts from its explicit `startLedger`, then the saved plan's start if present, otherwise the first actually observed latest ledger. Subsequent windows use the retained checkpoint. Select the actual historical starting ledger when creating a watch intended to acquire historical data.

Native watch progress is visible through the same status surface:

| Status | Operator meaning |
| --- | --- |
| `PAUSED` | The saved watch is available for configuration or finite catch-up. |
| `PAUSING` | The pause is committed and the current native source operation is draining. |
| `RUNNING` | The native runner owns or is advancing source work. |
| `WAITING_FOR_LEDGER` | The selected source frontier is waiting for additional ledger availability. |
| `RETENTION_GAP` | The original next ledger requires a retained edition or a source that still serves it. |
| `INTERRUPTED` | The original window and acquisition state remain available for continuation. |
| `COMPLETE` | The saved ending ledger has been covered. |

`active`, `windows`, `lastError` and `nextLedger` retain the native operational detail. Each completed window identifies its plan version, interval, capture, edition SHA, event count and publication result. The watch's source origin survives receiving, so later captured windows append under the same original feed namespace.

All watch control mutations keep the original request ID, full body and expected watch revision. Repeat the exact saved mutation after an interrupted response. If the native engine reports a revision conflict before applying a new operation, read its latest watch state and prepare that intended change using a new request ID and revision. Source progress can advance this revision while a service is running.

### Recover original source coverage

`watchRepair` selects complete original editions already present in the workspace, a configured recovery connection, or both. Receive the complete native edition source first when the required source is on another host. A recovery connection must be the actual endpoint that can serve the missing ledger interval.

```js
const beforeRepair = await client.watchState({workspace: 'ledger'});
const repaired = await client.watchRepair({
  workspace: 'ledger', watchId,
  requestId: 'contract-service-repair-2026-10-12',
  expectedRevision: beforeRepair.revision,
  editionIds: originalRecoveryEditionIds
});
const resumedWindow = await client.watchRun({
  workspace: 'ledger', watchId, maxWindows: 1
});
```

Repair and continuation use the native plan, range and edition checks. Partial windows retain their actual source pages and cursor. The following capture continues that original source operation before later work advances the checkpoint.

### Export and receive the continuing service

A complete watch export includes the original `watch.json` metadata, native watch state, its pinned window history, retained editions, any active capture's original exchanges and cursor, and its original publication source. Use the same complete-file transport used for an edition. The manifest identifies its kind with `stellar-forge.soroban-events.watch-export.v1` and the original `watchId`.

```js
const beforeExport = await client.watchState({workspace: 'ledger'});
const watchExport = await client.watchExport({
  workspace: 'ledger', watchId,
  requestId: 'contract-service-export-2026-10-12',
  expectedRevision: beforeExport.revision
});
const watchReceipt = await client.downloadExport({
  workspace: 'ledger',
  exportId: watchExport.export.id,
  expectedManifestSha256: watchExport.export.manifestSha256,
  directory: '/private/deliveries/contract-event-service'
});
await client.reopenExport({
  workspace: 'ledger',
  exportId: watchReceipt.exportId,
  expectedManifestSha256: watchReceipt.manifestSha256,
  directory: watchReceipt.directory
});

await client.open({workspace: 'received'});
const destinationWatches = await client.watchState({workspace: 'received'});
const receivedWatch = await client.receiveExport({
  workspace: 'ledger',
  exportId: watchExport.export.id,
  expectedManifestSha256: watchExport.export.manifestSha256,
  receiver: 'analyst',
  requestId: 'contract-service-receive-2026-10-12',
  expectedRevision: destinationWatches.revision,
  connectionAlias: 'testnet',
  publication: 'received-feed'
});
```

The high-level `receiveExport` helper reads the original manifest and dispatches to the native edition or watch receiving tool. A watch import uses the destination's watch revision. The explicit `watchReceive` method takes the same selected export, target receiver, manifest hash and watch revision.

The received watch is `PAUSED`. Inspect it, select its actual local source aliases and continue it through `watchRun` or `watchStart`. The native receiving operation retains the original watch, plan, capture, edition and feed identities. Publication appends the original events under the preserved source scope; overlapping editions keep the original event ID and payload for native deduplication.

A watch receipt exposes `watchId` and `sourceSchema`; an edition receipt exposes `editionId` and its source schema. `inspectExport`, `readJson`, CLI `json`/`value`, full download, interruption recovery and local reopen apply to both kinds.

### Native foreground operation

The selected product also installs `soroban-events-watch`. It operates the same native directory directly and requires no browser or Merchant HTTP listener. The entry module is `soroban-events/watch-cli.mjs`; its callable exports are `runSorobanEventsWatchCLI` and `main`.

Create a private `connections.json` map:

```json
{
  "testnet": {
    "rpcUrl": "https://soroban-testnet.stellar.org",
    "network": "stellar:testnet"
  }
}
```

Native connection objects use the original engine's actual RPC fields; the separate Merchant connection reader also supports resolving `headerEnv` in its private host configuration. Every native watch command accepts `--workspace`, optional `--connection-file` for the default connection, and optional `--connections-file` for the trusted map.

Save the watch's JSON input with its actual saved plan ID and optional native publication descriptor:

```json
{
  "name": "Contract event service",
  "planId": "ORIGINAL_SAVED_PLAN_UUID",
  "connectionAlias": "testnet",
  "windowLedgers": 5000,
  "pollIntervalMs": 5000,
  "publication": {
    "directory": "/private/publications/contract-events",
    "label": "Contract events"
  }
}
```

Use `soroban-events-watch state` for the current watch revision. These command examples use shell variables for the saved IDs and revision returned by the preceding native operation.

```sh
soroban-events-watch state \
  --workspace /private/soroban/ledger \
  --connections-file /private/config/connections.json

soroban-events-watch save \
  --workspace /private/soroban/ledger \
  --connections-file /private/config/connections.json \
  --input /private/config/watch.json \
  --request contract-service-save --revision "$SOROBAN_WATCH_REVISION"

soroban-events-watch catch-up \
  --workspace /private/soroban/ledger \
  --connections-file /private/config/connections.json \
  --watch "$SOROBAN_WATCH_ID" --max-windows 1

soroban-events-watch start \
  --workspace /private/soroban/ledger \
  --connections-file /private/config/connections.json \
  --watch "$SOROBAN_WATCH_ID" \
  --request contract-service-start --revision "$SOROBAN_WATCH_REVISION"
```

`start` prints the committed watch, then runs in the foreground. `daemon [--watch UUID]` runs persisted enabled watches without changing their desired state; without an ID it selects all running watches. SIGINT or SIGTERM aborts and drains the original native runner, prints its final retained state, and closes the watch adapter before the event workspace. The persisted desired state remains available for the next owner. Stop a direct foreground owner before another direct CLI process opens the same original directory. A running Merchant or browser host provides concurrent start/pause controls through its own original workspace.

| Native command | Required selection | Additional input |
| --- | --- | --- |
| `state` | Workspace | — |
| `status` | `--watch UUID` | — |
| `save` | Mutation request and watch revision | `--input JSON` with name, planId and watch settings |
| `configure` | Watch and mutation | `--input JSON` with changed settings |
| `start` | Watch and mutation | Continues as a foreground native runner |
| `daemon` | Optional watch | Runs persisted enabled selection |
| `pause` | Watch and mutation | Drains current native source work |
| `catch-up` | Watch | Optional `--max-windows N` |
| `repair` | Watch and mutation | `--input JSON` with editionIds and/or recoveryConnectionAlias |
| `export` | Watch and mutation | Returns the complete native source directory and manifest |
| `receive` | Mutation and `--source-directory ABS` | Manifest hash and receiving host aliases/paths |
| `source-file` | `--export SHA --path RELATIVE --output NEW_FILE` | Streams the exact original file and verifies its SHA256 |

Native mutations use `--request ID --revision N`. Receive accepts `--manifest-sha256 SHA`, `--connection-alias ALIAS`, `--recovery-connection-alias ALIAS` and `--publication-directory ABS`. The receiver opens the complete original source directory and restores the continuing service in a paused state.

## Publication and shared ownership

`publisherSource({workspace, editionId})` returns the selected original event file, complete byte count, SHA-256 and format for the existing dataset publisher. The source-native `soroban-events-publish` command prepares or appends that same edition through the original event feed, Merchant release and Buyer workflow. The parent product guide documents that publication journey and its retained selection.

Close the Merchant workspace before opening the same directory in the native CLI, publisher or Applications. Closing first aborts and drains the owned native watch runner and finite watch operations, then drains other owned calls and releases the original engine and retained file descriptors. The separate receiving workspace can be closed explicitly by its own alias.

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
| `capture_resume` | `captureResume` | `resume --capture-id UUID [--connection-alias ALIAS]` |
| `capture_status` | `captureStatus` | `status --capture-id UUID` |
| `events` | `events` | `events --capture-id UUID` |
| `edition_create` | `editionCreate` | `edition --capture-id UUID --name NAME` |
| `edition` | `edition` | `show-edition --edition-id UUID` |
| `source_export` | `sourceExport` | `export --edition-id UUID` |
| `publisher_source` | `publisherSource` | `publisher-source --edition-id UUID` |
| `watch_state` | `watchState` | `watch-state` |
| `watch_status` | `watchStatus` | `watch-status --watch-id UUID` |
| `watch_save` | `watchSave` | `watch-save --args WATCH_JSON` |
| `watch_configure` | `watchConfigure` | `watch-configure --watch-id UUID --args JSON` |
| `watch_start` | `watchStart` | `watch-start --watch-id UUID` |
| `watch_pause` | `watchPause` | `watch-pause --watch-id UUID` |
| `watch_run` | `watchRun` | `watch-catch-up --watch-id UUID --max-windows N` |
| `watch_repair` | `watchRepair` | `watch-repair --watch-id UUID --args JSON` |
| `watch_export` | `watchExport` | `watch-export --watch-id UUID` |
| `watch_receive` | `watchReceive`, `receiveExport` | `watch-receive --receiver ALIAS` |
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
