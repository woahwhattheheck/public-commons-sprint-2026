# Huwise / Opendatasoft merchant agent

This interface operates the maintained Huwise workbench through the shared merchant MCP host. Agents use the same saved source editions, notes, field projections, publisher candidates, merchant packages and buyer requests as the original browser and CLI. The typed client and command line receiver deliver complete original files and reopen them locally. Installed JavaScript and TypeScript applications import the client from `@tokenjunkielabs/starforge-merchant/merchant/mcp/opendatasoft/client`.

## Connect an existing project

Use the maintained runtime with original Node exact-JSON support and Linux flock. Keep the connection file private (0600), and the workbench, its parent directory and merchant output directory private (0700).

A minimal connection names one original project:

~~~json
{
  "schema": "stellar-forge.opendatasoft-workspace-connection.v1",
  "workspaces": {
    "portals": {
      "label": "Huwise portal datasets",
      "directory": "/srv/starforge/huwise-workbench",
      "origin": "https://public.opendatasoft.com",
      "imports": {},
      "merchants": {},
      "sellers": {}
    }
  }
}
~~~

Run the original merchant entry point from the repository root:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-opendatasoft-workspaces \
  --dir /srv/starforge/huwise-merchant \
  --connection /srv/starforge/huwise-connection.json

node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /srv/starforge/huwise-merchant/merchant-mcp.json \
  --port 3211
~~~

The installable package exposes the same commands through `starforge merchant-mcp init-opendatasoft-workspaces` and `starforge merchant-mcp serve`. The original native application remains available as `starforge huwise` or `starforge opendatasoft`; the complete agent file receiver is `starforge merchant-huwise` or `starforge merchant-opendatasoft`.

Supply the existing merchant bearer token through MCP_ACCESS_TOKEN using the maintained host setup. The same host supports its existing OAuth and stdio configuration.

The initializer binds the original workbench's seller-releases store. If that store already has a selected release, its generation and history are preserved. A connection can name several workspaces; choose its primary seller with --workspace ALIAS. Other configured workspaces retain their source, review and file operations. Stage and core seller control use the selected original store.

An existing merchant can attach the same connection through --opendatasoft-workspaces CONNECTION_JSON and --release-store ORIGINAL_WORKBENCH/seller-releases during its normal init. A direct merchant-mcp.json connection uses the property opendatasoftWorkspaceConnection.

For a new workbench, first create its empty private directory and set create:true in its host connection. The first open creates its original workbench.json. Subsequent opens retain that same project.

Private portals can declare authTokenEnv as the name of their existing portal credential environment variable. Named imports contain label and file for a complete original capture manifest. Named merchant profiles contain label, payment, origin and path copied from the reviewed original merchant terms. Named sellers contain label and url; a local deployment additionally sets allowLoopback:true. The host-level runtime object accepts the original port, facilitator and allowLocalFacilitator settings.

## Operate the original application

The host advertises 32 merchant_opendatasoft tools only when this connection is configured.

| Workflow | Operations | Original state |
| --- | --- | --- |
| Project ownership | status, open, close | Workbench lease and process instance |
| Source selection | search, dataset, preview, capture, resume, import | Explore API query and complete retained capture |
| Data review | edition, rows, facets, notes, compare | Original fields, exact values, notes revision and edition history |
| Typed publication | source_save, publication_create, publication, publication_review, publication_recover, publication_publish | Native projection, candidate, reviewer and published dataset |
| Merchant and buyer | merchant_export, merchant_stage, buyer_offer, buyer_prepare | Original merchant package, release store and reviewed offer |
| Operation control | operation, cancel | Original asynchronous operation ID |
| Complete receiving | export, exports, manifest, file, file_release | Immutable original files, SHA256 manifest and resumable native reads |

Start with status and open. Open optionally exposes the original private browser on the same workbench, so edits made in that browser appear in the agent's subsequent reads. Its returned browser URL is a private operator control link.

Capture, import, notes, field selection and publication changes return the original operationId immediately. Capture also returns editionId. Read operation with that exact ID until the original operation completes. If a reply is interrupted, inspect status and the same operation before issuing another change. cancel selects that exact current operation; resume selects the same unfinished capture.

The native Explore API owns query semantics. Capture selection accepts datasetId and the original where, order_by, repeated refine/exclude, lang/timezone and transport/capture capacity options. Search and preview use the same original provider queries and returned pagination. Use complete capture for the retained dataset, then page rows without the Explore records-window limit.

Edition review returns the actual capture manifest SHA256, row count, fields, source rights and field suggestions. Copy the inspected digest into source_save and notes. Notes also require the current expectedRevision. Source projections use the native field/type/nullability/encoding compiler.

For publication, use the exact candidate digest in publication_review, then the actual native review ID in publication_publish. Select a configured merchant profile to export. merchant_stage verifies that this host controls that workbench's original seller-releases store; use the existing merchant_inspect, merchant_compare, merchant_activate and merchant_start controls afterward. Read the original seller offer before buyer_prepare, retaining its offerSha256, acceptIndex and existing intentId.

Close selects the process instance returned by open. It closes its borrowed browser and native workbench, drains its active operation, and releases ownership. Saved projects, merchant history and completed exports remain available.

## Typed client

Import the maintained opendatasoft-client.mjs with its adjacent TypeScript declarations. Named methods use camelCase; call also accepts the exact short action or full tool name.

~~~js
import {
  openOpendatasoftClient,
  downloadOpendatasoftExport,
  reopenOpendatasoftExport
} from './stellar-forge/mcp-merchant-operator/opendatasoft-client.mjs';

const client = await openOpendatasoftClient({ url: process.env.MERCHANT_MCP_URL });
const workspace = 'portals';
const opened = await client.open({ workspace, browser: true });
const state = await client.status({ workspace });
const retainedEdition = state.native.editions.find(edition => edition.state === 'COMPLETE');
const edition = await client.edition({ workspace, editionId: retainedEdition.id });

const prepared = await client.export({
  workspace,
  exportId: 'portals-delivery-20261012',
  editionId: edition.id,
  expectedCaptureSha256: edition.manifestSha256,
  expectedNotesRevision: edition.notes.revision
});

await downloadOpendatasoftExport({
  client,
  exportId: prepared.exportId,
  directory: '/srv/starforge/received-portals',
  expectedManifestSha256: prepared.manifestSha256
});

await client.close({ workspace, instanceId: opened.instanceId });
const received = await reopenOpendatasoftExport({
  exportId: prepared.exportId,
  directory: '/srv/starforge/received-portals',
  expectedManifestSha256: prepared.manifestSha256
});
~~~

When the source contains several geographic fields, choose the inspected original geometryField explicitly in export. The native GeoJSON generator otherwise uses a sole geographic field or null geometry when none exists.

awaitOperation observes the original operation until its state changes from RUNNING. Its returned completion includes the actual state, result and error; callers decide their next domain action from that state. Observation cancellation leaves the original operation available through status and operation.

## Complete delivery

Export freezes all four original analyst formats at the selected capture and notes revision:

- data.json: original records, complete source metadata and analyst notes.
- data.csv: every retained row with original values encoded as JSON within their CSV cells.
- data.geojson: complete original properties and selected geographic values, with native geometry warnings.
- review.html: the complete offline review table and original rights/attribution.
- DATASET-RECEIVING.md: operating instructions for the selected source and delivery.

Optional sourceId includes the original field-selection declaration. Optional merchantExportId includes the full native merchant.tar.gz and its selected MERCHANT-RECEIVING.md. Optional buyerRequestId requires that same merchant package and includes the original buyer request. The provider verifies their native edition/package relationship before exporting.

These files come from the original application's own download routes. The merchant archive carries its full capture, native dataset, projection, reviewed plan, candidate, review, handler and API declarations. Its original receiving guide describes installation and continuation. The separately selected source declaration retains its original host capture path; the complete merchant package includes its relative capture binding.

The export ID is the durable request identity. Repeating the same export recovers its completion; changing its capture, notes revision or selected files requires a different ID. An interrupted writer uses the same original request and export lease. The completion manifest appears after every original file is saved and the edition identity is checked again.

The manifest and file tools work while the original workbench is closed. Reads use exact SHA256-pinned native descriptors, so large files need no duplicate server-side snapshot. Every continued or resumed read names the same manifest and file SHA256.

## Command line receiving

The installed merchant subcommands are also available directly from the maintained entry point:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs opendatasoft tools
node stellar-forge/mcp-merchant-operator/serve.mjs opendatasoft call \
  --url "$MERCHANT_MCP_URL" --action export --arguments /srv/starforge/export-request.json

node stellar-forge/mcp-merchant-operator/serve.mjs opendatasoft inspect \
  --url "$MERCHANT_MCP_URL" --export portals-delivery-20261012

node stellar-forge/mcp-merchant-operator/serve.mjs opendatasoft download \
  --url "$MERCHANT_MCP_URL" --export portals-delivery-20261012 \
  --directory /srv/starforge/received-portals --manifest-sha256 "$EXPORT_MANIFEST_SHA256"

node stellar-forge/mcp-merchant-operator/serve.mjs opendatasoft reopen \
  --export portals-delivery-20261012 --directory /srv/starforge/received-portals \
  --manifest-sha256 "$EXPORT_MANIFEST_SHA256"
~~~

The huwise command is an alias for this same customer client. Keep argument files private; --output writes a new private result file. Download checks every saved prefix, resumes the original file offset, and publishes its local completion manifest after all files match. Reopen verifies the completed manifest and every local file under the same download lease, including after the MCP host closes.

## Native ownership and source boundaries

This provider imports the maintained engine only on open. Tool metadata remains source-only; reading configuration does not open a project, start a listener or request a portal. Each opened alias owns one original workbench lease and one optional borrowed browser. File export requests use their own original state lease, and all accepted operations and native descriptors drain on provider shutdown.

Original engine and publication source: stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/. Shared merchant transport, release controls and retained download implementation remain in their existing modules.


## Complete native receiving example

The maintained example opens the full authenticated merchant host and its original Huwise browser, captures the complete public Open Data Inception dataset, pages every retained row, exports all four analyst formats, and receives the original complete files through the typed client. It deliberately interrupts the real download after a durable chunk, resumes that same receiving directory, closes its owned resources and reopens every file locally.

With the installed package:

~~~sh
starforge merchant-huwise-receive --directory /srv/starforge/huwise-receiving
~~~

From source:

~~~sh
node stellar-forge/mcp-merchant-operator/examples/opendatasoft-receiving.mjs \
  --directory /srv/starforge/huwise-receiving
~~~

To receive an existing original project, add --project /srv/starforge/huwise-workbench. This selects its completed native edition and any associated original source declaration, merchant archive, receiving guide and buyer request. The existing project's analyst notes are preserved. A new example project records its completed row and file review in its own analyst notes and confirms that the earlier immutable export still replays after that later edit.

The default source is https://public.opendatasoft.com and dataset open-data-sources. Use --origin and --dataset for another authorized public portal and dataset. The supplied directory retains the original project, merchant connection, export request, full customer files and native-receiving.json. Repeat the same command and directory after interruption. A completed operation reopens and verifies its original delivery locally.
