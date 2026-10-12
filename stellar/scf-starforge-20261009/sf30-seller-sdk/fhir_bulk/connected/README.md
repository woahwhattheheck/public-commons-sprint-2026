# Connected FHIR Bulk Data operations

Use the original FHIR workbench from its browser, a local command line and the
normal merchant MCP host. All three address the same native workspace and saved
acquisition operations. The connected interface covers provider discovery,
complete Group paging, Bulk Data acquisition, original resources, mapping,
dataset editions, comparisons and complete receiving.

Every native response is retained in full. Binary downloads stream to private
files and use the maintained merchant receiver. Small responses are also
readable directly in the tool result; larger responses remain available through
complete-file download and JSON-pointer inspection.

The native formats and behavior are documented in [the product guide](../README.md)
and [HTTP_API.md](../HTTP_API.md). The installed browser entry is described in
[APPLICATIONS.md](../APPLICATIONS.md).

## Connect the existing workspace

Open FHIR Bulk Data in Applications, or start the original native command:

~~~sh
starforge fhir-bulk serve --workspace /private/fhir-workspace --port 0
~~~

After binding its listener, the server writes
`fhir/operator-connection.json` in its private workspace. The connected layer
reads that descriptor and verifies the authenticated native workspace/process
identity. Access capabilities remain on the host. Whole-workspace exports
enumerate original records, sources and acquisition custody; this live
connection descriptor belongs to the running operator.

Create a mode0600 connection file in a private directory:

~~~json
{
  "schema": "stellar-forge.fhir-bulk-merchant-connection.v1",
  "workspaces": {
    "clinical": {
      "directory": "/private/fhir-workspace",
      "label": "Original clinical workspace",
      "allowStart": false
    }
  }
}
~~~

A workspace must already be initialized or received. Relative paths resolve
against this configuration file. Each alias selects one real private directory.

`allowStart:true` authorizes a persistent SDK client or merchant provider to
start the normal native `serve` process when the workspace is stopped. The
original workspace lease decides ownership. A running Applications operator is
borrowed. Optional `credentialsFile` selects the existing private
authentication-profile file for an owned launch.

Add complete host-file inputs when needed:

~~~json
{
  "inputs": {
    "handover": {
      "file": "/private/received/fhir-customer-packet.zip",
      "sha256": "REPLACE_WITH_THE_COMPLETE_ORIGINAL_FILE_SHA256",
      "label": "Original customer packet"
    }
  }
}
~~~

Place this `inputs` object inside the workspace entry. The SHA256 is optional;
if supplied, it must match the full original file. Each selected input is hashed
when the host opens. Before intake, all its bytes are copied into a private
snapshot and checked against that original identity. Tools select the input
alias; file paths are private host configuration.

## Local command line

Save `{"workspace":"clinical"}` as a JSON arguments file, then run:

~~~sh
starforge merchant-fhir-bulk call \
  --connection /private/fhir-connections.json \
  --exports /private/fhir-tool-files \
  --action state \
  --args /private/state-arguments.json
~~~

The result includes the original native workspace/instance IDs, HTTP status,
retained export ID, manifest SHA256, and complete file names, byte counts and
SHA256 values. `COMPLETED` reflects a successful native HTTP response;
`REJECTED` retains the full native rejection. Provider errors preserve the
native status/retry fields in the original response.

`retention.state:"COMPLETE"` means the manifest and all files are retained.
`original-response.json` contains the entire native response.
`original-request.json` preserves the selected action, arguments and native
target. If the readable tool preview is small, `value` also contains the full
response; otherwise inspect or receive its original file.

Read the complete JSON value:

~~~sh
starforge merchant-fhir-bulk value \
  --connection /private/fhir-connections.json \
  --exports /private/fhir-tool-files \
  --workspace clinical \
  --export-id ORIGINAL_RETAINED_EXPORT_SHA256 \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256
~~~

Download every original file:

~~~sh
starforge merchant-fhir-bulk download \
  --connection /private/fhir-connections.json \
  --exports /private/fhir-tool-files \
  --workspace clinical \
  --export-id ORIGINAL_RETAINED_EXPORT_SHA256 \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --directory /private/received/fhir-result
~~~

Repeat the same command and directory to resume an interrupted download.
The maintained receiver checks the manifest, complete file hashes and saved
partial prefixes. Its local flock lease coordinates writers. Reopen complete
files without a server connection:

~~~sh
starforge merchant-fhir-bulk reopen \
  --workspace clinical \
  --export-id ORIGINAL_RETAINED_EXPORT_SHA256 \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --directory /private/received/fhir-result
~~~

The local command closes its own connection on exit. The browser operator keeps
its original owner. Persistent clients can explicitly own native startup and
shutdown with `operator_open` and `operator_release`.

## Normal merchant MCP host

Initialize a host over this private connection:

~~~sh
starforge merchant-fhir-bulk init \
  --directory /private/fhir-merchant \
  --connection /private/fhir-connections.json \
  --name "FHIR operations"
~~~

The resulting `merchant-mcp.json` uses the original merchant schema, release
store and `fhirBulkConnection` field. An existing merchant can add that field
to its own configuration.

Start the ordinary merchant listener:

~~~sh
starforge merchant-mcp serve \
  --config /private/fhir-merchant/merchant-mcp.json \
  --port 3211 \
  --token-env MCP_ACCESS_TOKEN
~~~

The token is supplied through the selected environment variable. Replace the
local CLI `--connection`/`--exports` pair with
`--url http://127.0.0.1:3211 --token-env MCP_ACCESS_TOKEN`.

The provider is `fhir-bulk-workspaces`, its configuration/family key is
`fhirBulk`, and its tool prefix is `merchant_fhir_bulk_`. The source-owned
distribution contribution supplies its lazy provider, command, setup, typed
client and complete receiving program.

The provider serializes native actions for each workspace. Different workspaces
and reads of retained immutable files can proceed independently. Native
acquisition and source validators remain the original owners.

## Typed client

The installed package exposes this module at `./merchant/fhir-bulk`. From
the source product directory, a program can import the connected module:

~~~js
import {
  openFhirLocalClient,
  readFhirValue,
  downloadFhirExport,
  reopenFhirExport,
} from './connected/client.mjs';

const client = await openFhirLocalClient({
  connection: '/private/fhir-connections.json',
  exportsDirectory: '/private/fhir-tool-files',
});
try {
  const opened = await client.operatorOpen({workspace:'clinical'});
  const stateResult = await client.state({workspace:'clinical'});
  const state = await readFhirValue({client,result:stateResult});

  const build = state.builds[0];
  const queryResult = await client.buildQuery({
    workspace:'clinical',buildId:build.id,query:{limit:'25'},
  });
  const query = await client.readValue({result:queryResult});

  const packet = await client.buildPacket({
    workspace:'clinical',buildId:build.id,
  });
  const received = await downloadFhirExport({
    client,workspace:'clinical',exportId:packet.exportId,
    expectedManifestSha256:packet.manifestSha256,
    directory:'/private/customer/fhir-packet',
  });
  const reopened = await reopenFhirExport({
    directory:received.directory,workspace:'clinical',
    exportId:packet.exportId,
    expectedManifestSha256:packet.manifestSha256,
  });
  console.log({opened,query,received,reopened});
} finally {
  await client.close();
}
~~~

`openFhirMerchantClient` uses the same actions through the original MCP
transport:

~~~js
const client = await openFhirMerchantClient({
  url:'http://127.0.0.1:3211',
  tokenEnv:'MCP_ACCESS_TOKEN',
  environment:process.env,
});
~~~

Every named method also has `call(action,args,requestOptions)`. The action
may be plain, such as `source_rows`, or include the full tool prefix.
The declarations in `client.d.mts` cover all actions, named methods,
argument shapes, native results, manifests, ranges and complete downloads.

## Acquisition and recovery

Start from `state` and the saved native connection/export definitions.

| Action | Original operation |
| --- | --- |
| `connection_save` | Save the complete native connection definition. |
| `discover` | Receive original CapabilityStatement and SMART configuration. |
| `groups`, `group_page` | Receive/reopen each full Group Bundle; follow the exact returned next URL. |
| `export_save` | Save the reviewed export definition and rendered native request. |
| `export_advance` | Progress the same saved acquisition operation through kickoff, polling, manifests and file receiving. |
| `operation` | Read the full retained operation, progress and original provider results. |
| `operation_status` | Adopt an original accepted status URL through native recovery. |
| `operation_receive_capture` | Finish the accepted operation from a complete retained original source packet. |
| `operation_cancel` | Submit/reopen the original native cancellation request. |

Use the original operation ID throughout progress and recovery. Its format is
the native1–96 character literal token, including the UUIDs used by the original
receiving run. After a lost acquisition response, read that saved operation
before continuing. The native engine owns provider Retry-After and `notBefore`.

Retained-capture receiving selects a source ID already in the workspace.
The native owner matches the complete packet's operation, connection, export
definition, accepted status/manifest and every original file identity/byte before
completing that same operation. Source intake and capture recovery remain separate
native actions so the original source is inspectable before joining it.

## Resources, mappings and dataset editions

The source inspector has distinct original selectors:

| Selector | Use |
| --- | --- |
| `sourceId` | SHA256 of the complete original source packet. |
| `member` | Exact ZIP member from `source_members`, used by `source_file`. |
| `fileId` and `line` | Original indexed file identity and one-based physical line from `source_rows`, used by `source_row`. |
| `resourceType`, `kind`, `query` | Native filters; stream kind can be output, deleted, error or all. |

Nested captures can use the native `CAPTURE_SHA256:FILE_SHA256` identity.
Preserve the exact selector returned by the source rows.

`mapping_default` derives a starting mapping for one original resource type.
`mapping_preview` evaluates the complete supplied plan. `plan_save` saves
the reviewed native plan; `build_create` projects one original source into a
complete dataset edition.

`compose` applies ordered original deltas to a base capture using native
version/deletion rules and explicit conflict resolutions. The resulting source
contains its complete original captures. It feeds the same mapping/build engine.

`build_query` accepts original dataset query parameters as literal strings.
The complete response includes the native `response.status` and
`response.body.page`. `comparison_create` compares two native editions;
`comparison_changes` pages original changes.

## Complete delivery and receiving

| Action | Complete output |
| --- | --- |
| `source_file` | One verified original member. |
| `source_packet` | Whole original source ZIP. |
| `build_dataset` | Native CSV, dataset specification and lineage ZIP. |
| `build_packet` | Customer packet with original source and reviewed mapping. |
| `comparison_file` | Whole original edition-change JSONL. |
| `workspace_packet` | Editable registry, sources, builds, comparisons and acquisition custody. |

All binary outputs stream to immutable files. The retained reader uses the
original descriptor implementation, so complete files avoid a second whole-file
memory copy. Manifests record exact native byte counts and SHA256 identities.

Configure another initialized workspace alias and receive an exported workspace:

~~~js
const exported = await client.workspacePacket({workspace:'clinical'});
await client.operatorOpen({workspace:'receiver'});
const receiving = await client.receiveExport({
  workspace:'receiver',sourceWorkspace:'clinical',
  exportId:exported.exportId,
  expectedManifestSha256:exported.manifestSha256,
  kind:'workspace',
});
const saved = await client.readValue({result:receiving});
~~~

Whole-workspace receiving uses a fresh empty target or the same already retained
archive. The native importer preserves the original workspace UUID and complete
history. Before dispatch, the client retains the selected archive identity.
If the response is lost during UUID adoption, the next call reads that same
instance's original receiving record and reconciles the selected archive.

`kind:'packet'` receives a customer dataset packet; `kind:'source'` receives
a whole source. `workspace_import`, `packet_import` and `source_import`
select their complete host-file aliases instead.

Retained exports survive native and merchant restarts. Read IDs are local to the
retained reader process; the receiver reselects the same manifest, file SHA256 and
offset when continuing a released read. `json` uses RFC6901 pointers to inspect
the complete original JSON while full-file receiving remains available.

## Operate the complete connected journey

`RECEIVING.mjs` consumes the actual completed `OPERATED_FHIR_BULK.json`
from the original source→dataset→merchant→customer journey:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_bulk/connected/RECEIVING.mjs \
  --receiving /private/original/OPERATED_FHIR_BULK.json \
  --out /private/original/connected-receiving \
  --chromium /absolute/existing/chromium
~~~

It keeps the browser open during connected reads, receives complete dataset,
source and workspace files, restores separate native workspace/customer targets,
reopens the merchant and checks the original records and dataset totals.
It uses the same completed provider exports.

The selected source/runtime supplies Node22+, Python, the original merchant
dependencies, Linux flock and Playwright/Chromium. The operation saves complete
request results, downloads, screenshots, source identities and its restartable
journal. `OPERATED_CONNECTED_FHIR.json` is emitted when the whole journey
finishes.
