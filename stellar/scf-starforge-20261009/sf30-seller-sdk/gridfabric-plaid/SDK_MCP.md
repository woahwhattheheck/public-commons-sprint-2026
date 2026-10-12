# GridFabric SDK, MCP and managed applications

The SDK and merchant provider attach to the existing GridFabric Plaid operator. The native application continues to own measurements, mappings, callbacks, reports, event history, dispatch journals, SQLite and the workspace lease. Its CLI, browser, SDK and MCP interface read the same records.

The package exports the typed SDK at `./seller/gridfabric-plaid/sdk`, the merchant adapter at `./seller/gridfabric-plaid/mcp`, and the original native workspace, server and portable delivery modules at their existing export paths. The maintained distribution discovers the source-owned `gridfabric-plaid` merchant and application providers. The managed command is `starforge gridfabric-application`; the original standalone command remains `starforge gridfabric-plaid`.

Use [MANAGED_APPLICATION.md](MANAGED_APPLICATION.md) for application configuration, lifecycle ownership and managed receiving. Use [DOMAIN_OPERATIONS.md](DOMAIN_OPERATIONS.md) for source interpretation, callback and dispatch semantics. The retained [Plaid sources](contracts/SOURCES.md) identify the upstream contracts behind the native operations.

## Runtime and source layout

The native operator uses Linux, Node 22.13 or newer with `node:sqlite`, Linux `flock`, and the existing GNU publication tools described in [README.md](README.md). The HTTP SDK uses Node's standard HTTP, filesystem and crypto modules. The complete retained file downloader and merchant adapter use the maintained Starforge framework delivered by this contribution.

Preserve the repository-shaped source tree, including `merchant-fleet-gateway/state-lease.mjs`, `stellar-forge/mcp-merchant-operator`, and the declared distribution dependencies. Install the selected maintained package or use its complete selected source. The native server reports a SHA-256 over its full module roster; the installed application separately binds the full maintained package manifest. These identities serve different purposes: one identifies the executing domain and HTTP operator, and the other identifies its installed application and integration source.

## Attach to an existing operator

Start or select the actual application first. The standalone form is:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/cli.mjs \
  --workspace /private/gridfabric-workspace serve --port 0 \
  --connection-file /private/gridfabric-console.url
~~~

The connection file is an ordinary private UTF-8 file containing the loopback console URL and its bearer fragment. The managed application publishes the same native URL format. Select its actual workspace ID, canonical directory and native source digest from the application's retained launch record.

~~~js
import {readFileSync} from 'node:fs';
import {connectGridFabricOperator} from './sdk/index.mjs';

const selected = JSON.parse(readFileSync('/private/gridfabric-sdk-selection.json', 'utf8'));
const client = await connectGridFabricOperator({
  connectionFile: selected.connectionFile,
  expectedWorkspaceId: selected.workspaceId,
  expectedWorkspace: selected.workspace,
  expectedSourceSha256: selected.sourceSha256,
});
try {
  const state = await client.state();
  const source = await client.source();
  console.log({workspace: client.identity.workspace_id, revision: state.revision,
    collections: state.collections, source: source.sha256});
} finally {
  await client.close();
}
~~~

The client reads the private connection descriptor through a stable file handle, authenticates to the exact IPv4 loopback origin, checks the logical workspace and directory, and verifies the full module-roster digest. Mutating HTTP calls carry the native Origin gate. Complete replies retain the workspace-binding response header.

Optional `timeoutMs` and `maximumResponseBytes` select the caller's HTTP limits. Defaults are 300,000 ms and 64 MiB for one JSON response. The source-file and portable-archive paths stream their bytes separately. Select memory and request limits for the actual measurement portfolio.

`client.close()` drains this client's pending HTTP requests and releases its transport. Application Stop owns the listener, SQLite and native lease. After the application has restarted and published its new connection URL, `await client.reopen()` attaches to the same workspace, directory and native source. The connection identity changes to the new origin. A change of workspace or source requires an explicit new client selection.

## Native operations and typed inputs

The SDK exposes every native operation through `call(operation, payload)`, its corresponding camel-case method, and `callRaw(operation, payload)`. The first two return the full native JSON value. `callRaw` also retains `raw_text`, HTTP status, normalized headers, original raw headers and workspace ID. Domain errors retain the full native error and response text in `error.details`.

| Native group | Operations | Use |
|---|---|---|
| Workspace and contracts | `launch`, `state`, `source`, `contracts` | Inspect the selected operator and complete retained contracts. |
| Records and recovery | `page`, `host_page`, `detail`, `operation`, `exports`, `restore_status` | Read all original records, request outcomes and portable journals. |
| Measurement and reports | `configure_instance`, `import_source`, `save_mapping`, `activate_mapping`, `record_opt_decision`, `build_report`, `reconcile_distribution` | Apply the complete native input to the selected workspace revision. |
| Reviewed management | `prepare_management`, `begin_management`, `finish_management`, `reconcile_management` | Capture and continue the original management operation. |
| Reviewed device actions | `begin_device_action`, `finish_device_action`, `reconcile_device_action` | Preserve the original queued device intent and attempt. |
| Event and dispatch recovery | `recover_dispatches`, `project_event_history`, `resume_event_callback` | Continue retained event history and reviewed dispatch outcomes. |
| Host dispatch | `dispatch_management`, `dispatch_device` | Use the existing host's original network dispatch and receipt handling. |
| Portable export | `export` | Prepare or recover the complete native archive at a selected revision. |

These are 30 native operations: 10 reads, 17 domain actions, two host dispatches and one export. The declaration file `sdk/index.d.mts` includes all native operation inputs, source profiles, device and callback bindings, report mappings, reconciliation fields, response envelopes, file transfers and typed collection names.

Every domain action and dispatch takes the retained native envelope:

~~~json
{
  "request_id": "CALLER_RETAINED_CANONICAL_UUID",
  "expected_revision": 0,
  "input": {}
}
~~~

Replace the template with the caller's saved UUID, reviewed current revision and complete action input. The native input definitions remain in the domain engine. The SDK rejects undeclared envelope fields and non-JSON values before transport, then preserves the complete submitted input for native validation.

Save the request before invoking the action:

~~~js
const request = JSON.parse(readFileSync('/private/reviewed-gridfabric-mapping.json', 'utf8'));
const result = await client.saveMapping(request);
~~~

The native request UUID and expected revision retain their existing replay semantics. If the connection loses an action reply, inspect `await client.recover(request.request_id)`. The SDK adds that exact recovery query, request ID and operation to the error. A portable-export error instead points to its original export journal through `client.exports()`. Archive receiving retains the same restore UUID, archive bytes, digest and sibling destination.

For management and device work, the original host commits the fresh begin and captured dispatch before it sends. Repeating a captured request UUID reads or finishes its retained outcome. Review its saved attempt and receipt before any separate reconciliation. The SDK leaves the original operation and networking semantics intact.

## Complete collection reads

Domain tables are `instances`, `instance_editions`, `sources`, `source_rows`, `source_issues`, `mappings`, `callbacks`, `callback_deliveries`, `events`, `event_revisions`, `distributions`, `opt_decisions`, `device_actions`, `reports`, `report_rows`, `management_operations`, `management_receipts` and `operations`. Host tables are `host_files` and `host_dispatches`.

A page contains its collection, offset, limit, total, rows and `next_offset`. Follow continuation until null. The SDK iterators do this directly:

~~~js
for await (const page of client.pages('source_rows', {limit: 1000})) {
  await consumeOriginalPage(page);
}
for await (const record of client.rows('host_dispatches', {host: true, limit: 1000})) {
  await consumeOriginalDispatch(record);
}
~~~

The native page API accepts the original optional `scope`, `tag`, `gte`, `lt` and `order` filters. Each page reflects its native read time. Use a native portable export for a single atomic workspace snapshot while a live workspace is changing.

## Upload an original measurement source

`uploadFile` receives a caller-selected file path, complete byte count and SHA-256. It hashes the stable original file, then streams the same bytes into the native immutable vault and registers their metadata. The server verifies the complete upload before publication. UTF-8 source intake retains its native validation.

~~~js
const file = JSON.parse(readFileSync('/private/reviewed-meter-file.json', 'utf8'));
const upload = await client.uploadFile({
  file: file.path,
  name: file.name,
  mimeType: file.mimeType,
  expectedBytes: file.bytes,
  expectedSha256: file.sha256,
});
console.log(upload.value);

// Read the reviewed native import envelope saved for this file.
const request = JSON.parse(readFileSync('/private/reviewed-meter-import.json', 'utf8'));
if (request.input.file_sha256 !== upload.value.sha256) {
  throw new Error('The saved import must select the uploaded original file.');
}
const imported = await client.importSource(request);
~~~

Upload and source import remain separate steps. The import identifies the original filename, provenance, explicit format/profile and optional corrected source. `uploadText` provides the same vault operation for a complete in-memory UTF-8 string, with optional expected SHA-256.

## Complete file and portable transfer

The canonical SDK file identities are `file_SHA256` for an immutable source and `export_UUID` for a retained portable export. SDK file helpers also normalize a bare source SHA-256. MCP takes the canonical identity explicitly.

`fileInfo` returns the full workspace-bound name, media type, byte count and SHA-256. `readFile` reads an exact offset and limit, up to 196,608 bytes, and requires the full expected SHA-256. Every range verifies the native file identity, total length, offset, range digest and complete response length. Reading the exact end yields an empty range.

Use the retained downloader for a file that must survive retries:

~~~js
import {downloadGridFabricFile, reopenGridFabricDownload} from './sdk/index.mjs';

const plan = JSON.parse(readFileSync('/private/gridfabric-portable-plan.json', 'utf8'));
const exported = await client.export({
  request_id: plan.exportRequestId,
  expected_revision: plan.expectedRevision,
});
const downloaded = await downloadGridFabricFile({
  client,
  fileId: 'export_' + plan.exportRequestId,
  directory: plan.downloadDirectory,
  expectedSha256: exported.sha256,
  chunkSize: 196608,
});
const reopened = await reopenGridFabricDownload({
  directory: plan.downloadDirectory,
  expectedManifestSha256: downloaded.manifestSha256,
  expectedWorkspaceId: client.identity.workspace_id,
  expectedFileId: 'export_' + plan.exportRequestId,
});
const received = await client.receiveArchive({
  file: reopened.originalFile.path,
  expectedBytes: reopened.originalFile.bytes,
  expectedSha256: reopened.originalFile.sha256,
  name: plan.restoredName,
  requestId: plan.restoreRequestId,
});
console.log(received.value);
~~~

The download directory retains `gridfabric-file.json`, its full-file manifest, resumable state and the exact original file. Reopening verifies the completed retained download locally. The manifest binds logical workspace, canonical workspace directory, native file ID, complete bytes and SHA-256. Its single delivered payload is the full selected native file.

The native `.jsonl.gz` export contains the complete logical tables, host records, internal meta state, dispatch history and immutable file bytes. The original export journal retains the selected revision and archive identity. Native receiving verifies the full archive and publishes a private sibling without clobbering an unrelated destination.

Restore status distinguishes a received snapshot from a workspace that has advanced since receiving. Use the same request UUID and original archive to recover a lost receiving reply. A currently advanced sibling remains available with its actual native status and revision.

## Configure the merchant MCP provider

The contribution declares merchant provider ID `gridfabric-plaid`, family and configuration key `gridFabricWorkspaces`, and configuration input `gridFabricWorkspaceConnection`. Select a private workspace configuration file. Paths resolve relative to that file; aliases use lowercase letters, digits, underscore and hyphen.

~~~json
{
  "schema": "stellar-forge.gridfabric-workspace-connection.v1",
  "workspaces": {
    "operations": {
      "label": "GridFabric operations",
      "connectionFile": "./gridfabric-console.url",
      "workspaceId": "ORIGINAL_WORKSPACE_ID",
      "workspace": "./gridfabric-workspace",
      "sourceSha256": "ORIGINAL_NATIVE_SOURCE_SHA256",
      "files": {
        "meter": {
          "path": "./incoming/meter.csv",
          "name": "meter.csv",
          "kind": "source",
          "bytes": 0,
          "sha256": "ORIGINAL_COMPLETE_FILE_SHA256",
          "mimeType": "text/csv"
        },
        "portable": {
          "path": "./incoming/GridFabric_Original.jsonl.gz",
          "kind": "archive",
          "bytes": 1,
          "sha256": "ORIGINAL_COMPLETE_ARCHIVE_SHA256"
        }
      },
      "receivingSiblings": {
        "received": {"name": "gridfabric-received"}
      }
    }
  }
}
~~~

This is a configuration template. Supply the actual retained IDs, byte counts, SHA-256 values and paths before use. `files`, `receivingSiblings` and `sourceSha256` are optional; pin the source when selecting a particular reviewed application edition. Source and archive aliases bind complete host files. Receiving aliases bind sibling names.

Use the source-owned setup helper with a new private host directory:

~~~js
import {initializeGridFabricMerchant} from './mcp/setup.mjs';
const result = await initializeGridFabricMerchant({
  directory: '/private/gridfabric-merchant-host',
  connection: '/private/gridfabric-workspaces.json',
});
console.log(result.configuration);
~~~

Setup creates the maintained merchant configuration, release store and customer export directory, then reads the completed merchant configuration through the existing host. An existing selected release store may be supplied with `releaseStore`. The resulting `merchant-mcp.json` holds the absolute `gridFabricWorkspaceConnection` reference.

### Full tool catalogue

Every native operation appears as `merchant_gridfabric_<operation>` and takes the configured `workspace` alias plus its native fields. The complete catalogue has 38 tools. The eight additional tools are:

| Tool suffix | Purpose |
|---|---|
| `workspaces` | List the host's declared workspaces, reviewed files and sibling aliases. |
| `status` | Read the attached native workspace and current connection identity. |
| `reopen` | Reattach the borrower after the selected managed application restarts. |
| `file_info` | Read a complete source or export identity. |
| `file_manifest` | Obtain the deterministic full-file manifest and digest. |
| `file` | Read the requested manifest or native-file range and its next offset. |
| `upload` | Stream the selected reviewed source-file alias into the native vault. |
| `receive` | Restore the selected archive alias into its declared sibling using the retained UUID. |

Native MCP replies include `native`, `raw_text`, `http_status`, `headers` and `raw_headers`. Original error codes, native error objects and complete error response text remain available in the thrown error details.

`merchant_gridfabric_file_manifest` accepts `exportId` for either canonical file kind. `merchant_gridfabric_file` takes the manifest SHA-256, selected member SHA-256, exact offset and limit. `downloadGridFabricMerchantFile` joins these operations to the maintained retained-download writer and verifies the complete original payload. MCP upload and receiving take host-declared aliases and repeat their reviewed byte counts and digests.

The provider's close operation drains its borrowers. Its configuration remains reusable after the original application is restarted.

## Complete SDK and MCP receiving

The reusable `sdk/receiving.mjs` workflow takes an already populated native workspace and a retained configuration file. It uses the actual original SQLite, HTTP operator, archive format and file vault.

Copy [sdk/receiving-input.example.json](sdk/receiving-input.example.json) and fill it from the current application and saved operation. Keep `exportRequestId`, `restoreRequestId`, selected workspace/source and sibling name stable throughout that operation. `outputDirectory` is private and separate from the original workspace. Optional `minimumCollections` records the required native table counts for the selected complete input portfolio.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/sdk/receiving.mjs \
  --configuration /private/gridfabric-sdk-receiving.json
~~~

The workflow owns a receiving-directory lease and retains its operation record before requesting export. It then:

1. Exports the selected atomic native revision and receives every portable byte through the SDK.
2. Restores that archive through the original HTTP receiving route into the configured sibling.
3. Opens the received native SQLite workspace, reads all 18 domain and two host collections through every SDK page, and compares the complete rows with the same native operator.
4. Reads every retained immutable source file through exact SDK ranges, checking whole-file hashes and the end-of-file response.
5. Uses the full MCP catalogue to read all 20 collections, native contracts and source, preserve a native error response, download an original source, stream that same source and recover the same archive receiving request.
6. Closes the cold operator, opens that original received workspace again, and reattaches both SDK and MCP borrowers to its new native listener.
7. Closes its borrowers, listener, SQLite owner and receiving lease, then retains the completed receiving record and portable download.

The live application remains with its existing caller. The returned `commons.gridfabric-sdk-receiving.v1` record includes `workspace`, `revision`, `portable`, `restored`, collection/page/file results and `cold_operator_closed`. A completed call returns only after its cold workspace owner has closed. The managed receiving driver can then open that exact `restored.directory` through Applications.

Retry the same configuration after interruption. Export and restore reuse their retained native UUIDs and selected revision. A completed receiving operation verifies and reuses its retained portable file. A failed operation retains its actual error and completed phases in `receiving.json`.

The original 51-step, 53-check domain receiving and its source manifest remain under `operations/scf-gridfabric-plaid-receiving-20261012`. They retain their original source and exact functional inputs. The managed SDK receiving uses the selected current installed package and its explicit native source identity; its guide records the source and input selection for that run.
