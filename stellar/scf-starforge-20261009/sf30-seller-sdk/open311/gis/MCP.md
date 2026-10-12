# GIS merchant tools and typed SDK

The **open311-gis-workspaces** provider operates the same SQLite GIS workspace as the browser and CLI. Its family/configuration key is **open311GISWorkspaces** and its host connection field is **open311GISWorkspaceConnection**. Original source, analyst-return and receiving files are selected through explicit host aliases with pinned file hashes.

The provider uses the maintained merchant host, original release store and retained-file reader. See [INSTALL.md](INSTALL.md) for the complete source selection and private runtime preparation.

## Select private desks and original files

Initialize the operating and receiving directories with open311-gis init. Create a private connection JSON file with mode 0600:

~~~json
{
  "schema": "stellar-forge.open311-gis-host.v1",
  "workspaces": {
    "operations": {
      "label": "Municipal GIS operations",
      "directory": "/absolute/private/municipal-gis",
      "inputs": {
        "collection": {
          "label": "Complete original municipal collection",
          "path": "/absolute/handover/municipal-collection.json",
          "sha256": "EXACT_COMPLETE_FILE_SHA256",
          "kind": "source",
          "format": "json"
        }
      }
    },
    "received": {
      "label": "Received municipal GIS desk",
      "directory": "/absolute/private/municipal-gis-received",
      "inputs": {}
    }
  }
}
~~~

Replace the source SHA-256 with the hash of the complete original file. Use distinct private directories. Relative paths resolve against the connection file's directory. The configuration permits up to 128 workspace aliases and 128 input aliases per workspace.

Input kind is source, return or workspace. Source and receiving inputs use format json. Analyst return inputs use gpkg, geojson, csv or json. A returned-file alias selects the completed analyst file, its exact hash and kind return; a receiving alias selects the complete GIS workspace JSON and kind workspace.

The merchant tool arguments select these declared aliases. Complete original input bytes are checked against the configured hash at admission. Source import and receiving preserve the original text; GeoPackage returns preserve the original binary bytes.

## Initialize and register the maintained merchant host

Save the original initializer options in a private JSON file:

~~~json
{
  "directory": "/absolute/private/gis-merchant",
  "connection": "/absolute/private/gis-host.json",
  "name": "Municipal GIS handoff"
}
~~~

Invoke the source-owned initializer through the prepared runtime:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  merchant-providers init open311-gis-workspaces \
  --options /absolute/private/gis-setup.json
~~~

The equivalent SDK is initializeGISMerchantWorkspace from open311/gis/mcp-setup.mjs. Pass releaseStore when selecting an existing original SF82 release store. Setup retains the original intent and initializer attempts; repeat the same arguments to recover an interrupted setup.

Generate the client configuration on the actual host that launches the installed merchant:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  merchant-mcp-client-config \
  --config /absolute/private/gis-merchant/merchant-mcp.json \
  --name open311-gis \
  --output /absolute/private/gis-mcp-client.json
~~~

The maintained generator records the actual absolute Node executable and prepared stdio source. Apply that server entry through the MCP client's existing configuration workflow. To preserve other servers, use the generator's --merge option with the existing client JSON, select an unused server name and write a new output file.

The direct terminal transport uses merchant-mcp-stdio --config /absolute/private/gis-merchant/merchant-mcp.json through the same runtime-install run command. A receiving host prepares its delivered runtime and generates its own host-local client entry.

## Complete operating surface

| Tool suffix after merchant_open311_gis_ | Result |
| --- | --- |
| workspaces | Configured desks and original input aliases |
| status | Workspace ID, revision, saved record counts, recent operations and downloads |
| records | Paged source, handoff, return, decision or dispatch summaries |
| input | Original configured file purpose, format, size and hash |
| inspect_source | Complete source description and saved report choices |
| import_source | Retain the exact source file and selected original records |
| handoff_create | Save a named source selection, filters, analyst defaults and optional predecessor |
| source_rows | Search and page original imported rows |
| handoff_info | Saved definition, source coverage and operating row page |
| row | One complete request, source versions and accepted analyst fields |
| return_import | Retain a complete analyst file and its proposals/conflicts/missing rows |
| return_info | Page proposals, conflicts, missing keys or review decisions |
| decision_save | Explicitly accept/reject proposals and save the next handoff edition |
| dispatch_create | Save reviewed action=dispatch rows and destination column mapping |
| dispatch_info | Dispatch identity, destination, mapping, coverage and row page |
| operation | Recover the original saved action result |
| receive | Receive the complete GIS workspace into an empty selected desk |
| file_read | Complete source/return/analyst/dispatch/workspace/operation bytes |
| file_release | Release a retained reader |

Record and row pages require the observed expectedRevision. Follow nextOffset until null. Page limits are 1–100 for the merchant transport; browser/API pages support 1–1000. Large complete source and returned files use the retained-file interface.

Each mutation requires requestId and expectedRevision. Read status before a new action. Recover an uncertain action using its original request ID and input; original results remain available after independent receiving. The operation view replaces large input bodies with their byte/hash manifests and host alias selection; kind operation downloads the complete saved input and result. A receiving operation stores originalFile {sha256,bytes} and incomingPackageSha256 in its input descriptor. Its original source files, analyst uploads and complete record/history transfer remain in the receiving workspace; successive receiving operations keep that descriptor compact.

## Typed transport adapter

The SDK adapts an existing merchant callTool function. For an application importing the installed package:

~~~js
import { Open311GISMerchantClient } from
  '@tokenjunkielabs/starforge-merchant/merchant/open311-gis/client';
import { writeFile } from 'node:fs/promises';

const desk = new Open311GISMerchantClient(
  (name, args) => merchantTransport.callTool({ name, arguments: args }),
  'operations',
);

const state = await desk.status();
const source = await desk.importSource({
  input: 'collection',
  expectedSha256: originalCollectionFileSha256,
  requestId: 'gis-source-intake-001',
  expectedRevision: state.revision,
});
const handoff = await desk.createHandoff({
  requestId: 'gis-handoff-001',
  expectedRevision: source.revision,
  definition: {
    name: 'Municipal GIS allocation',
    sourceIds: [source.source.id],
    defaults: { action: 'review' },
  },
});
const file = await desk.downloadFile({
  kind: 'gpkg',
  handoffId: handoff.handoff.id,
  expectedRevision: handoff.revision,
});
await writeFile('/absolute/handover/municipal-analyst.gpkg', file.bytes, {
  flag: 'wx', mode: 0o600,
});
~~~

After the edited file is selected in a host return alias, use importReturn with its alias/hash, original handoff ID and analyst. Page returned changes with returned, then call decide with the explicit current handoff ID, reviewer and accepted/rejected proposal IDs. CreateDispatch accepts the same definition as the browser/CLI, including destination column names.

DownloadFile verifies each chunk's exact byte count, stable file manifest, complete SHA-256 and terminal offset. An onChunk async sink streams large files to the caller's output. The original selection, expected hash and offset identify continuation. The maintained retained reader controls the snapshot; a later live workspace change leaves that already retained file selection intact.

## Receiving and provider ownership

The receiving input alias points to a complete exported GIS workspace JSON. Use receive with its exact hash and a new stable receiving request ID while the destination desk is empty. The workspace importer reconstructs original source selections, analyst comparisons, decision lineage and dispatch derivation before committing.

The provider opens its selected SQLite handles lazily and drains admitted operations on close. It releases its own retained readers and database handles. The independent browser process continues operating the same saved workspace.

The full installed product includes the original source collector and reporting workbench, so a receiving operator can import later source editions, refresh the current GIS handoff, review new analyst changes and prepare the next complete dispatch.
