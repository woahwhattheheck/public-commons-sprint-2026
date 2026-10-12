# Wherobots merchant consumer and complete receiving

This consumer connects an existing merchant operator to a private customer receiving directory. It receives every file from a saved workflow or dataset export, continues committed byte ranges after interruption, verifies the complete original inventory, and imports a workflow through the original Python workspace before reopening it.

The source entry points are:

| Entry point | Purpose |
| --- | --- |
| index.mjs and index.d.mts | Typed local workspace SDK and public consumer functions |
| merchant-client.mjs | Generic merchant.call consumer, durable receiving and local CLI |
| merchant-tools.mjs | Original 27-operation host contract and file chunk limit |
| interoperability/merchant_receiving.mjs | Complete original-workspace receiving operation |
| wherobots_operator/exports.py | Original archive/package inspection and retained native export |
| wherobots_operator/portable.py | Complete source/record/object import, corrected editions and independent reopening |

The SDK runs on Node with the original Python 3.10+ runtime selected by the operator. Install the exact Python versions in requirements.txt for native Wherobots operations and Parquet/GeoParquet reading. Downloading and inspecting a named export uses Node; importing and reopening a workflow invokes the selected original Python workspace. The complete workflow archive includes this editable source, declarations and original license files.

## Attach an existing merchant

Supply the original opened merchant object, or an authenticated carrier with the same async call(name, arguments) interface. Direct native results and standard MCP structuredContent/text replies are accepted. Provider errors retain their original codes.

~~~javascript
import {
  createWherobotsMerchantClient,
  importReceivedWherobotsWorkflow
} from "./index.mjs";

const client = createWherobotsMerchantClient({
  merchant,
  workspace: "spatial",
  workspaceId: originalWorkspaceId
});
const status = await client.status();
const workflow = await client.get({kind: "workflow", id: workflowId});
const exported = await client.export({
  workflow_id: workflow.id,
  expected_revision: workflow.revision_sha256,
  export_id: "customer-refresh-01"
});

const received = await client.receiveExport({
  exportId: exported.export_id,
  expectedManifestSha256: exported.manifest_sha256,
  directory: "/absolute/private/customer-delivery"
});

const customer = await importReceivedWherobotsWorkflow({
  directory: received.directory,
  workspace: "/absolute/private/customer-workspace",
  python: "/absolute/original-runtime/bin/python3",
  create: true
});
console.log(customer.workspace_id, customer.workflow.id, customer.editions.map(x => x.id));
~~~

workspace is a host-declared alias. workspaceId is the original ID from initialization/state. If omitted, the client obtains that ID from the original status reply and pins it for the client lifetime. The first selected operation checks the alias, and every received manifest must match its original workspace identity.

The consumer owns its local receiving files. The caller owns the merchant lifecycle. client.close() is the original merchant_wherobots_close operation for that selected alias; the enclosing host is closed with merchant.close() when its accepted work has completed.

## Saved export identities

Export a complete workflow using workflow_id, expected_revision and an export_id. Export a dataset with edition_id, dataset_id, expected_revision and an export_id. Obtain expected_revision from the corresponding current workflow or edition record.

The host retains the request and complete original export under that export_id. Repeating an identical selection returns the original manifest and files. Select a new export_id when preparing a later delivery; this keeps earlier received editions available for comparison and reopening.

The returned manifest binds:

- The source workspace_id, export_id and workflow/dataset selection.
- The expected saved record revision and exact request SHA256.
- Every original relative file path, complete byte count and SHA256.
- A manifest_sha256 computed over the original recursively key-sorted payload, excluding that digest field.

The receiver verifies the manifest and request digests before writing data. expectedManifestSha256 allows a caller to repeat a previously selected manifest explicitly. Its value is the manifest's declared content identity, not the hash of its displayed or indented JSON text.

## Resume a complete delivery

Repeat receiveExport with the same directory, workspace, export ID and expected manifest. The directory contains the original manifest, its source binding, complete installed files and per-file progress. For each saved prefix, the receiver reads its retained bytes, verifies the saved prefix hash and continues from the committed offset.

Each chunk is requested through:

~~~javascript
await merchant.call("merchant_wherobots_file", {
  workspace: "spatial",
  kind: "export",
  export_id: exportId,
  file: originalManifestFile.path,
  expected_sha256: originalManifestFile.sha256,
  offset: committedOffset,
  limit: 196608,
  // read_id is repeated while this same original read remains live.
});
~~~

A read ID belongs to one live merchant process. After restart, the receiver selects the same original file/hash at the saved offset and obtains a fresh read ID. When an in-process read explicitly returns WHEROBOTS_READ_NOT_FOUND, the consumer reacquires that same file at the same offset once. Other provider failures retain their original result for the caller to resolve.

The receiver checks the declared file identity, byte count, offset, canonical base64, chunk length and next offset before committing data. It flushes the data before replacing the progress journal. Any uncommitted trailing bytes are removed when that same saved prefix is reopened. A file becomes visible in files/ only after its complete byte count and SHA256 match the original manifest.

The default chunk size is 65,536 bytes; the original host contract permits up to 196,608 bytes per call. Every original file may be at most 8 GiB. Download and hash operations stream with bounded buffers; the complete file is not retained in JavaScript memory.

Use AbortSignal for an operator pause:

~~~javascript
const controller = new AbortController();
await client.receiveExport({
  exportId,
  directory: "/absolute/private/customer-delivery",
  expectedManifestSha256,
  signal: controller.signal,
  onProgress(progress) {
    renderProgress(progress);
    if (operatorRequestedPause) controller.abort();
  }
});
~~~

onProgress is called after durable checkpoints with phase, file, fileOffset, completedBytes, totalBytes and chunks. A pause returns WHEROBOTS_RECEIVE_INTERRUPTED after the accepted merchant call settles, keeping its last committed prefix. The original active read is released. Restart the same command to continue.

The local lease prevents concurrent receiving writers from sharing that directory. A terminated process's lease can be recovered on the same host after its process is confirmed absent. Current files, progress and final imports remain bound to their original manifest.

## Inspect and reopen independently

~~~javascript
import {
  inspectReceivedWherobotsExport,
  importReceivedWherobotsWorkflow
} from "./index.mjs";

const original = await inspectReceivedWherobotsExport(
  "/absolute/private/customer-delivery",
  {expectedManifestSha256}
);
const customer = await importReceivedWherobotsWorkflow({
  directory: original.directory,
  workspace: "/absolute/private/customer-workspace",
  workspaceId: savedCustomerWorkspaceId,
  python: "/absolute/original-runtime/bin/python3"
});
~~~

Inspection checks every complete file and requires the files/ directory to match the original inventory exactly. It returns the workflow ZIP path or dataset directory plus their original manifest.

Workflow import first invokes the original archive inspector. It checks the archive's source workspace, workflow revision and complete file SHA256 against the merchant manifest, then invokes the original import operation. It closes that local client, reopens it with the resulting customer workspace ID, and verifies the original workflow and every imported edition again.

create: true initializes a new, separate local customer workspace through the original initializer. Existing workspaces preserve their identity. env and python select the same original installed runtime; include the declared Arrow module path in PYTHONPATH when that runtime uses a shared engine.

A corrected complete handover is received into its own export directory and imported into the same customer workspace. The original receiving engine retains the source workspace association, original record revisions, preserved content objects and successive edition identities. The returned receiving result reports created, advanced and reused records.

The receiver's complete workflow source is available at customer.receiving.source_directory. Its index.mjs can be imported directly to reopen that customer workspace with the independently received SDK. Original source-only editions retain their source records and typed values; native job operations use the complete reviewed native workflow/account definition.

## Original dataset publisher handover

~~~javascript
const edition = await client.get({kind: "edition", id: editionId});
const exported = await client.export_dataset({
  edition_id: edition.id,
  dataset_id: datasetId,
  expected_revision: edition.revision_sha256,
  export_id: "customer-dataset-01"
});
const packageFiles = await client.receiveExport({
  exportId: exported.export_id,
  expectedManifestSha256: exported.manifest_sha256,
  directory: "/absolute/private/customer-dataset"
});
~~~

Receive the entire dataset manifest, including package.json, dataset.json, dataset.csv, source.json and every source companion. The original SF30 loadDatasetConfig function accepts files/dataset.json. The original SF82 readDatasetSourceFiles function accepts files/ plus its unchanged source.json.

source.json preserves both sourceFiles and original_objects with the identical complete source/listing/run/output descriptors. It also retains the original edition, dataset, source binding, column mapping, field states, geometry and CRS. CSV source values remain strings; exact numbers and structured values use the original lossless representation. rows replies preserve exact numeric, decimal, large integer, binary and temporal tags for previews.

The complete workflow ZIP is the source/operation/edition interchange. The dataset export is the existing SF30 CSV data product and uses that original engine's column, cell and package capacities.

## Private host commands

Run the complete consumer directly from its source:

~~~text
node merchant-client.mjs status --config /private/merchant-mcp.json --workspace spatial

node merchant-client.mjs export --config /private/merchant-mcp.json --workspace spatial --workflow-id WORKFLOW_ID --expected-revision WORKFLOW_REVISION_SHA256 --export-id customer-refresh-01

node merchant-client.mjs receive --config /private/merchant-mcp.json --workspace spatial --export-id customer-refresh-01 --directory /private/customer-delivery --manifest-sha256 MANIFEST_SHA256

node merchant-client.mjs inspect --directory /private/customer-delivery

node merchant-client.mjs import --directory /private/customer-delivery --customer-workspace /private/customer-workspace --create-customer --python /private/runtime/bin/python3

node merchant-client.mjs deliver --config /private/merchant-mcp.json --workspace spatial --export-id customer-refresh-01 --directory /private/customer-delivery --customer-workspace /private/customer-workspace --create-customer --python /private/runtime/bin/python3
~~~

export-dataset takes --edition-id, --dataset-id, --expected-revision and --export-id. call dispatches any documented original operation with --operation and, when needed, a private --arguments JSON file. Use --workspace-id to pin the original configured source workspace and --customer-id to pin an existing local receiving workspace.

Configuration files, source file paths and receiving destinations are local CLI inputs. The MCP requests carry only their declared workspace/input aliases and original export/file identities. SIGINT and SIGTERM pause receiving at its committed prefix and then drain the opened host.

The standalone public functions are createWherobotsMerchantClient, receiveWherobotsExport, inspectReceivedWherobotsExport, importReceivedWherobotsWorkflow and runWherobotsMerchantClientCli.

## Complete source receiving operation

interoperability/merchant_receiving.mjs consumes the already completed original native/source workspace. Supply the existing private connection and the original workflow/edition IDs returned by its operation:

~~~text
node interoperability/merchant_receiving.mjs --connection /private/wherobots-connection.json --workspace reference --workflow-id ORIGINAL_WORKFLOW_ID --edition-id ORIGINAL_EDITION_ID --out /private/wherobots-merchant-receiving --python /private/runtime/bin/python3
~~~

The connection uses the schema and private aliases documented in MERCHANT.md. This operation:

1. Opens the actual original host and its complete 27 Wherobots tools.
2. Exports the selected original workflow, receives a durable chunk and pauses.
3. Closes that host and resumes the same export in a new Node process.
4. Repeats the original export selection and verifies the same retained manifest.
5. Receives every dataset from the selected edition, including all original files.
6. Loads each received dataset through the original SF30 loader and SF82 companion reader.
7. Imports the complete workflow, repeats receiving and reopens the same independent customer.
8. Imports the SDK from that received editable source and compares every page of every imported edition to the source's exact typed rows.

The operation retains selection.json, the original interruption, all complete receiving directories and operation.json with actual source/edition/workspace IDs, hashes, reader counts and the restarted process outcome. It continues the existing source operation and its retained complete outputs.
