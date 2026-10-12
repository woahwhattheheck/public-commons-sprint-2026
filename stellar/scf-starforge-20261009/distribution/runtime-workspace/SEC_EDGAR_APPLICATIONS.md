# SEC EDGAR in Applications

Open the retained SEC source operator through the existing Applications controller.
The application uses the original capture store, saved drafts, query preview,
customer exports, browser session and managed child lifecycle.

## Operator workflow

Choose **SEC EDGAR source operator** and select two private directories: the
original operator workspace and the immutable SEC capture store. An existing
private parent can contain a new workspace or capture store. Choose the local
port, then Review, Save and Start.

Open the resulting private workspace link. The original browser session connects
automatically. Import original company facts or filing captures, choose the
captured edition and offered concepts, preview the actual records, save the
merchant draft, and download its configuration, OpenAPI and buyer handoff.
The existing SEC CLI exports the complete selected source and generated customer
client using the same capture store and downloaded merchant configuration.

Stop closes the original HTTP listener and source workspace. Start reviews the
current saved version and reopens the same workspace and capture store.
Saved drafts, version history and imported immutable editions remain available.

The launch review binds the initial workspace identity, private capture directory,
current immutable revision and each configured original source edition. A new
draft becomes a new revision. Review on the next Start selects that current
revision; regular editing does not replace the workspace identity.

## Original controller integration

The family helper is distribution/runtime-workspace/application-sec-edgar.mjs.
The original SEC source hook is sf30-seller-sdk/sec-edgar/managed-launch.mjs.

The maintained distribution already registers sec-edgar to the original
sec-edgar/cli.mjs; the Applications adapter uses that command directly.

The shared catalog composer imports:

~~~js
import {
  secEdgarApplication,
  prepareSecEdgarApplication,
} from './application-sec-edgar.mjs';
~~~

Add secEdgarApplication(common) to the original catalog. In the existing
applicationCommand(type, settings, runtimeDirectory, context) family dispatch:

~~~js
} else if (type.id === 'sec-edgar') {
  const original = await prepareSecEdgarApplication(settings, {
    inputPath, runtimeDirectory,
  });
  args.push(...original.args);
  inputs.push(...original.inputs);
  createDirectories.push(...original.createDirectories);
}
~~~

Keep the existing common port and private environment handling. The returned
arguments select the original workspace command, capture store and workspace,
plus their reviewed identities and current source review. The original helper
returns reviewed input paths and any private directories created by Save.

The shared output observer imports secEdgarStartup from the same family helper.
Before generic URL parsing, recognize a sec-edgar request whose first argument
is workspace and the compact announcement prefix:

~~~text
{"schema":"stellar-forge.sec-edgar-workspace-startup.v1",
~~~

Use the existing asynchronous output chain:

~~~js
const startup = await secEdgarStartup(
  request, operationDirectory, text, context
);
~~~

The context is the existing child PID object. Store the returned url and
original in the original application-url.json, with the same application,
operation, command, observation time and original-command-stdout fields used by
the other families.

The helper reads the private original launch file, rechecks the immutable
workspace/source review, resolves the actual child's process start through the
existing process helper with the independently verified process-identity.mjs namespace fallback, and authenticates an actual request to
the selected original listener. Its returned URL retains the original browser
session fragment.

## Source hooks

The SEC CLI's original workspace command prepares the reviewed binding, starts
startEdgarWorkspace, writes one structured announcement, and keeps the original
signal/close handling. The ordinary CLI also emits this structured announcement.

The original server exposes authenticated GET /api/application under its
existing Host, Origin, session and bearer checks. It reports the original
workspace, store, current selected source review and actual process identity.
The original import, query, revision, save and download routes are the product
operations used after opening the workspace.

The private managed-launch.json is retained in the operator directory through
the existing atomic private-file writer. Its browser session belongs to that
specific listener and is replaced by the next original launch.

## Retained native source operation

The original source packet contains the Apple facts edition
apple-facts-20261011 and Genpact filings edition genpact-filings-20261011,
their full original raw JSON, the selected merchant configuration, generated
JavaScript client, OpenAPI, handoff and export manifest. The accepted input
manifest SHA-256 is
27ef7f9f05a99530cf72f64ce722dba8e90561444f1581350df8cbdc84374eee.

Use that actual packet and an existing following READY runtime for the installed
operation. The complete operation reviews and saves the application, opens the
actual private session, imports those original records, previews the selected
products, exports the complete customer package, stops the managed listener and
reopens the same source and workspace identities.


## Run the complete installed operation

Use sf30-seller-sdk/sec-edgar/managed-operation.mjs from the same accepted source.
It imports the selected runtime's original Applications model, source review,
compiler and exporter. The operation connects through the original private browser
session and retains actual source previews and customer downloads.

Write one private input JSON with this structure:

~~~json
{
  "schema": "stellar-forge.sec-edgar-managed-input.v1",
  "runtimeDirectory": "/absolute/following-ready-runtime",
  "workspaceDirectory": "/absolute/original-sec-workspace",
  "storeDirectory": "/absolute/original-sec-capture-store",
  "referenceExportDirectory": "/absolute/original-merchant-export",
  "manifestSha256": "27ef7f9f05a99530cf72f64ce722dba8e90561444f1581350df8cbdc84374eee",
  "outputDirectory": "/absolute/new-operation-directory"
}
~~~

Run the original Node 24 process:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/managed-operation.mjs --input /absolute/managed-input.json
~~~

The selected output directory must be new. Existing source imports resume through
the original store's immutable edition semantics. An existing merchant draft must
match the selected export. Normal Save creates the next original revision.
The operation retains input.json, result.json, original preview and download bytes,
the complete customer-export directory, and the actual Applications workspace.

A successful result records both managed operations, original workspace/store
identity, imported source hashes and counts, saved revision, actual product
previews, customer export, closed listeners and same-state reopen. The retained
result omits browser session secrets. The Applications workspace keeps its original
private managed launch records.
