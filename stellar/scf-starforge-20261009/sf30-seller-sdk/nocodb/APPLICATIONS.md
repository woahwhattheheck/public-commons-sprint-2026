# NocoDB source authoring in Applications

The maintained **Applications** workspace can run the original NocoDB source editor as a saved application. The source editor retains its existing metadata observations, complete record-page captures, reviewed projections, source versions, publisher requests, dataset versions and merchant releases. Applications supplies its existing review, process ownership, private Open URL, Stop and recovery workflow.

Choose **NocoDB source authoring** (`nocodb-authoring`). Its original command is `nocodb-source workspace serve`. The application opens an initialized source workspace. Starting or reopening it does not acquire a NocoDB observation, publish a dataset or start a merchant.

## Select the original workspace and runtime

Use a supported original merchant installation with Node 24, Linux and the maintained `flock`-based workspace/managed-worker support. Select a runtime that Applications already reports as **READY** and that contains both this helper and the original NocoDB workspace launch files. Its common Applications catalog must include this entry.

For a new source workspace, initialize it once through the original installed command. Replace the example paths with private absolute paths belonging to the operator:

```sh
starforge nocodb-source workspace init \
  --directory /private/nocodb/catalog-source \
  --target /private/nocodb/catalog-dataset
```

The `--target` argument is optional; the original initializer supplies its default dataset location when omitted. The selected source, publisher and dataset paths become immutable workspace settings. To use an existing workspace, select its original directory and omit initialization or `--create`.

In Applications, select:

| Field | Original input |
| --- | --- |
| Initialized private NocoDB workspace | The initialized absolute directory, for example `/private/nocodb/catalog-source`. |
| Private NocoDB connections file | Optional original host-selected server and environment-token references. Leave empty when working from retained source packets. |
| Local port | `0` chooses an available loopback port. An omitted port uses the original NocoDB default, 8461. |
| Private environment JSON | The existing Applications private environment file when the original NocoDB token reference needs a value in the launched process. |
| READY runtime | The maintained original installation containing the source editor and its dependency closure. |

There are no seller-origin or paid-resource launch fields in this NocoDB entry. The original publisher, deployment review and merchant console retain the customer and merchant settings at the point where those operations are reviewed.

## Use the original host connection

A private connections file maps a local alias to the original NocoDB server and an environment variable name:

```json
{
  "catalog": {
    "label": "Reviewed catalog database",
    "server": "https://nocodb.example.org",
    "tokenEnv": "NOCODB_CATALOG_TOKEN",
    "pageSize": 100
  }
}
```

The hostname and variable name above are examples. Use the existing authorized server and token reference. The original provider owns server validation, API v3 selection, request limits and authentication. An intentional local HTTP provider must explicitly declare the original `allowHttp` option.

Keep the connections file private and use the original private-file permissions. Its values contain references, not the token itself. Put the actual token in the host's original private environment input. The application review retains the connection file path and SHA-256; it does not copy the token, metadata or record pages into its declaration.

Reviewing the application validates that local connection file and its native schema. It does not issue an API request or refresh a credential. A workspace can open with no connections file to inspect or receive retained source work. A live observation requires an explicitly selected configured connection in the original source editor.

To change the server or token reference, stop the application, review the changed connection file and save the application again before Start. If an environment token value changes, use the original Applications environment update and restart the same saved application so its process receives the current environment. A running source editor retains the connection snapshot with which it opened.

See [PROVIDER_INPUT.md](PROVIDER_INPUT.md) for the original provider/capture contract and [WORKSPACE.md](WORKSPACE.md) for the source editor's connection and operation controls.

## Review, save and start

1. Select **NocoDB source authoring**, the READY runtime and the original input paths.
2. Review the exact command and inputs. The native reader inspects immutable settings from the existing SQLite workspace and the selected source files.
3. Save through the existing Applications workflow. Complete its original runtime adoption when that READY runtime has not yet been adopted for managed execution.
4. Review **Start** and start that saved application. The original command takes the source workspace's existing lease and checks the reviewed identity before opening it for writes.
5. Use **Open** on the retained run. The private URL opens the original NocoDB editor with its browser token in the fragment.

The selected READY runtime and its managed executable release can live in different directories. All nine original workspace files must match between them:

`launch.mjs`, `model.mjs`, `cli.mjs`, `server.mjs`, `provider.mjs`, `packet.mjs`, `browser.mjs`, `index.html`, and `style.css`.

The native launcher reports the actual selected and executed source directories, that complete source identity, the process PID, a fresh browser instance ID, the original workspace/settings identity and its `nocodbWorkspace` URL. The maintained Applications observer validates this original announcement before retaining the Open URL. The public health response is the original local `/api/health` body with service `nocodb-source-authoring` and its current `ready` state; it does not expose a source capture or token.

Normal work does not invalidate the application. The identity binds the original directory and database device/inode plus immutable settings. It excludes mutable SQLite bytes, size, timestamps, draft revisions, selected source version, captures and publisher records. Saving another reviewed source version remains ordinary work in that same application.

## Complete the source-to-customer workflow

The source editor supplies two original entry paths:

- Select an existing host connection, discover the actual base/table/view metadata and inspect the native field and primary-key identities. Review the intended source selection, stable primary-key order and public projection before an explicit capture.
- Import a previously frozen original source or an exported source packet. Its complete retained metadata, count receipts and record pages remain the input; opening or importing it does not repeat the provider extraction.

A live capture uses the original NocoDB reader. Its opening table metadata and matching count, all original record pages through the terminal continuation, and closing metadata/count remain together. Keep the original field IDs, record identity, decimal/null/text conversion and source order when reviewing a projection. The source preview and saved version identify the exact retained input and column decisions.

After reviewing a saved source version, open the original publisher from that version. The original publisher owns extraction review, publication requests and the resulting dataset version. Saving or selecting a source version alone does not publish a dataset.

Use the original deployment review after a matching publication. It records explicit merchant terms and prepares the original dataset package for SF82. The original release console owns stage, compare, active selection, run, drain, restart and rollback; it also provides the original customer export and buyer handoff. Applications retains process ownership of the source editor and composes those existing operations.

The complete provider and customer workflow remains documented in [README.md](README.md), [DEPLOYMENT.md](DEPLOYMENT.md) and [WORKSPACE.md](WORKSPACE.md). Use the original returned version, request, release and export IDs. The Applications entry does not introduce another publication or financial ledger.

## Stop and reopen

Use **Stop** on the saved application's current run. The maintained worker signals the original CLI. The original source service drains its admitted operation and closes its owned publisher/deployment resources and database before releasing the original workspace lease.

Follow that same retained Stop/run until it is terminal. If the HTTP reply is lost, reopen the operation and recover its status. A new Start is appropriate after the original run has stopped.

A later Start uses the same saved application and source directory. It produces a fresh private browser URL and instance ID while retaining captures, request UUIDs, reviewed versions, selected source, published datasets and prepared merchant releases. Reopening does not activate a merchant; the original deployment controls perform that explicit action.

The direct CLI and any native MCP source owner use the same original workspace lease. Use the already running application for that workspace, or stop it through its original owner before opening the same workspace through another host. The original lock error identifies a real existing owner; it is not a reason to initialize a replacement workspace.

## Recover the original request

| Observed situation | Original continuation |
| --- | --- |
| Save reply was lost | Reopen the existing Applications review/application and recover that same save request. Its original revision and request identity remain authoritative. |
| Start reply was lost | Inspect the retained Start/run. Recover its process and private URL through that same operation. |
| Source capture/import reply was lost | Inspect the original request with the browser recovery control or `workspace operation`/`attempt`. Resume that exact UUID through the original engine. |
| A provider capture is incomplete | Inspect its retained attempt and original receipts. Resume does not fetch metadata/pages again; an explicitly requested new observation uses a new capture request. |
| Draft or selected version changed | Review the current original revision and selection. A stale source write must not overwrite later source work. |
| Stop reply was lost | Follow the same retained Stop and native drain to a terminal state before Start. |
| Connection-file bytes changed | Stop and review/save the actual current private file before another launch. A pending older review will not silently accept changed bytes. |
| Workspace was restored or replaced | Review the received original workspace again. A changed database inode or immutable path binding changes its launch identity even when historical content is equal. |
| SQLite requires crash recovery | With its original process stopped, run `starforge nocodb-source workspace status --directory ORIGINAL_DIRECTORY` through the original engine, then review the application. |
| READY or executed source changed | Use the maintained runtime refresh/adoption and re-review. Both selected and executed nine-file source identities must match. |

The original CLI prints each write's request ID before the operation. Retain that UUID. Do not substitute a new request merely to discover whether an earlier write completed. The original request journal, input digest, draft revision and selected version determine recovery.

Examples using an already returned UUID:

```text
starforge nocodb-source workspace operation --directory ORIGINAL_DIRECTORY --request ORIGINAL_UUID
starforge nocodb-source workspace attempt --directory ORIGINAL_DIRECTORY --request ORIGINAL_UUID
starforge nocodb-source workspace resume --directory ORIGINAL_DIRECTORY --request ORIGINAL_UUID
```

These placeholders mean the original directory and UUID from that operation. See the source workspace guide for its exact status and admission outcomes.

## Receive source work on another host

Use the original version or capture export from the source editor. The packet retains original pages, source/schema/count receipts and the selected source projection. Keep it as private source work; the original publisher and merchant/customer exporter produce the separate reviewed customer deliverable.

For an authorized receiving host:

1. Install the complete original runtime and initialize a receiving source workspace through `workspace init`.
2. Import the actual exported packet in that original workspace. The browser supplies its request UUID and expected draft revision; the CLI provides the same `import --packet`, `--request` and `--expected-revision` controls.
3. Inspect the received native source and public projection, then review/save the source version using the receiving workspace's current original selection.
4. Add that receiving directory to Applications and perform its own Review/Save/Start. Its native inode/settings identity is intentionally different from the sending host's identity.
5. Publish or stage a merchant only through the original receiving publisher and deployment review when that is part of the intended delivery.

The source CLI also provides `export --version`, `export-capture --capture` and `packet --source`; each uses a new output file. Preserve the entire returned packet rather than extracting one page or reconstructing source metadata.

A source packet is not a whole merchant backup. Preserve the original publisher, dataset and release state through their existing closed-state export/recovery interfaces when transferring the full merchant. Do not copy a live SQLite file as a substitute. The Applications declaration is a local process binding and is reviewed again on the receiving host; it does not transport a credential, database or independent journal.

## Exact managed launch interface

The shared Applications composer supplies the original NocoDB CLI extension:

```text
starforge nocodb-source workspace serve
  --directory ORIGINAL_PRIVATE_WORKSPACE
  --source-directory SELECTED_RUNTIME_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/workspace
  --source-sha256 ORIGINAL_NINE_FILE_DIGEST
  --workspace-identity ORIGINAL_WORKSPACE_IDENTITY
  --startup-json
  [--connections PRIVATE_CONNECTIONS.json --connections-sha256 REVIEWED_FILE_SHA256]
  [--port 0]
```

The native readers and saved application review provide these hashes. They are not editable substitutes for another workspace or installation. The ordinary direct `workspace serve` command retains its human-readable startup format; managed `--startup-json` emits one compact JSON line.

That line has schema `stellar-forge.nocodb-authoring-startup.v1`, status `NOCODB_AUTHORING_READY`, the exact source/workspace/connection identities, PID, instance ID and `nocodbWorkspace` URL. It does not contain table IDs, captured records or a NocoDB token.

For the maintained Applications catalog/factory/observer, the additive helper ABI is:

```js
nocodbApplication(common)
prepareNocoDBApplication(settings, { inputPath, runtimeDirectory })
nocodbStartup(request, startupLine)
```

Preparation returns the original CLI `args`, the reviewed local `inputs`, and an empty `createDirectories`. The workspace input is explicitly mutable; the original native identity protects its fixed binding. Startup returns `{url, original}` for the existing serialized observer and private run receipt. The helper does not spawn a process, take a second workspace lease or implement Stop itself.

Use the original common Applications catalog, adoption, worker, save/run/stop and observer with this helper and the matching original NocoDB source. The same managed lifecycle then carries source authoring through normal work, receiving and restart.
