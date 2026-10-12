# WQX client: complete files, saved decisions and receiving

The maintained WQX client calls the original merchant MCP operator. It uses `openMerchantFileClient` from `retained-download.mjs` for authentication, MCP initialization, request identity and structured tool responses. An existing MCP host can instead supply its native `call()` and stable `endpoint` adapter. The original managed WQX application, provider, buyer and retained file store remain the owners of the work.

`wqx-workspace-client.mjs` exposes typed methods for all 37 published WQX tools. `wqx-workspace-cli.mjs` provides the same complete operations, plus local upload, download and offline reopening. The declarations are `wqx-workspace-client.d.mts` and `wqx-workspace-cli.d.mts`.

## Initialize the original WQX host

The host owner first selects the existing private WQX connection file described in [WQX_WORKSPACE.md](WQX_WORKSPACE.md). Its workspace aliases identify actual managed project directories and their retained `projectBindingId` values. The same file can expose named original input files and captures. Host paths belong in that connection file; client MCP requests use those aliases.

Prepare the private setup options:

```json
{
  "directory": "/absolute/private/water-merchant",
  "connection": "/absolute/private/wqx-workspace-connection.json",
  "name": "Water quality merchant"
}
```

The common merchant-provider CLI operation is:

```text
merchant-providers init wqx-water-quality --options /absolute/private/wqx-host-setup.json
```

It calls the source-owned WQX initializer through the existing provider registry. The same source-owned initializer is available through the common registry API:

```js
import { initializeMerchantProvider } from
  './stellar-forge/mcp-merchant-operator/providers.mjs';

const setup = await initializeMerchantProvider('wqx-water-quality', {
  directory: '/absolute/private/water-merchant',
  connection: '/absolute/private/wqx-workspace-connection.json',
  name: 'Water quality merchant',
});
console.log(setup.configuration, setup.state, setup.workspaces);
```

The result includes `configuration`, `configurationSha256`, `state` (`INITIALIZED` or `REOPENED`), `wqxWorkspacesConfigured: true`, the original workspace aliases/bindings, and ownership `ORIGINAL_MANAGED_WQX_HOST`. Repeating the same setup directory, connection, name and release store reopens that original setup. An optional `releaseStore` selects an already initialized original SF82 store; omitting it creates the setup's private store. Use the returned merchant configuration with the existing merchant MCP host, then connect the client to that host's actual listener.

## Connect to the existing operator

Run the installed source with Node 24. Resumable local downloads use the original `acquireStateLease` implementation and Linux `flock` from util-linux. The HTTP transport accepts the selected HTTPS endpoint or its original loopback HTTP listener. The access token is read from the named environment variable, default `MCP_ACCESS_TOKEN`.

```sh
node stellar-forge/mcp-merchant-operator/wqx-workspace-cli.mjs status \
  --url "$WQX_MCP_URL" --token-env MCP_ACCESS_TOKEN --workspace water
```

`WQX_MCP_URL` can supply the endpoint without `--url`. Obtain the alias from the operator’s original WQX configuration. `status` without an alias reads its configured inventory. The same private managed project is followed after an Applications restart; its current native launch and source binding come from the original connection.

Use the existing registration command for a subprocess MCP host:

```sh
node stellar-forge/mcp-merchant-operator/client-config.mjs \
  --config /absolute/private/merchant-mcp.json \
  --output /absolute/private/new-mcp-host.json
```

The overall native setup and exact operation requests are in [WQX_WORKSPACE.md](WQX_WORKSPACE.md). This client adds no separate subprocess or HTTP transport.

## Receive a complete original portable project

Choose an existing private local directory for command records. The receiving workspace is an original managed WQX project configured in the operator. Upload the complete original bundle from the client’s machine, retaining one lowercase input identifier:

```sh
node stellar-forge/mcp-merchant-operator/wqx-workspace-cli.mjs upload \
  --workspace receiver --input-id potomac_plan_01 \
  --file /absolute/input/potomac-quarter-open-waters-01-complete-open-waters.json \
  --content-type application/json \
  --sha256 2b6ff2ca633860d8a83320a4c6dc072f54350dadf12449fd126cd353f9db618b \
  --progress true --save-json /absolute/private/potomac-upload.json

node stellar-forge/mcp-merchant-operator/wqx-workspace-cli.mjs receive \
  --workspace receiver --kind plan --input-ref input:potomac_plan_01 \
  --save-json /absolute/private/potomac-received.json
```

The supplied example is the original complete 31,495,178-byte Potomac Open Waters bundle: 1,035 results, 13 activities, one station and 1,112 original limits. Its original public source is retained by the WQX product. The native receiver verifies the complete bundle, reconstructs its private source/project and reopens the same original review and plan.

Each input supports at most 134,217,728 bytes. Every append contains at most 65,536 decoded bytes. The client hashes one held local file descriptor, verifies that descriptor remains unchanged while reading, and sends only `inputId`, basename, content type, length, hash and the exact next base64 range. The local source path stays on the client.

If an upload response is interrupted, inspect or repeat the same operation:

```sh
node stellar-forge/mcp-merchant-operator/wqx-workspace-cli.mjs input-status \
  --input-id potomac_plan_01
```

Repeat `upload` with the same `inputId`, source bytes, name and content type. The server’s `receivedBytes` advances the original transfer, including a chunk committed before its response was lost. Replayed bytes are compared with the existing original input. A different source under the same identifier is rejected. Completion requires the server’s whole-file length and SHA-256 verification. Remove `--save-json` or choose a new record filename after reconciling the prior invocation; that option reserves the exact new output before dispatch.

An already retained file can be consumed directly as `file:FILE_ID`; a host-configured input uses `host:ALIAS`. Those references select original files inside the operator. Client paths and arbitrary download URLs are absent from the MCP input schema.

## Download and reopen every byte

First select the original native export and save its descriptor. Then keep that exact descriptor and one private directory for its download:

```sh
node stellar-forge/mcp-merchant-operator/wqx-workspace-cli.mjs file \
  --workspace water --family plan --id potomac-quarter-open-waters-01 \
  --format bundle --save-json /absolute/private/potomac-descriptor.json

node stellar-forge/mcp-merchant-operator/wqx-workspace-cli.mjs download \
  --workspace water --descriptor /absolute/private/potomac-descriptor.json \
  --directory /absolute/private/potomac-download --progress true

node stellar-forge/mcp-merchant-operator/wqx-workspace-cli.mjs reopen \
  --directory /absolute/private/potomac-download \
  --sha256 2b6ff2ca633860d8a83320a4c6dc072f54350dadf12449fd126cd353f9db618b
```

`download` also accepts the `{result, file}` response saved by a native operation. The file descriptor includes its original `fileId`, basename, MIME type, byte count and SHA-256. Its ID is a full lowercase SHA-256 selected by the original file store; it is distinct from the content hash.

The output directory contains the complete original file, `wqx-file.json` and `download-state/checkpoint.json`. Each chunk is checked against the selected descriptor, original read ID, expected offset, complete length and canonical base64. Each durable checkpoint binds the endpoint/workspace identity and SHA-256 of its actual local byte prefix. On resume, the prefix is rehashed; only an uncheckpointed suffix left by the same interrupted local write is truncated. An expired native read is reopened at the same original hash and offset.

The full content hash must match before the final file is published. The original private directory lease serializes concurrent local callers. Saved files remain mode 0600 with independent inodes. Keep the directory intact while a download is incomplete. `reopen` verifies the completed descriptor, checkpoint and full local file without opening an MCP connection. Command JSON saved through `--save-json` belongs outside this dedicated download directory.

`--save-json` exclusively creates the selected mode-0600 file before opening or dispatching the native client, then retains that same file handle through publication. A second invocation selecting the same output is rejected before a native call. On a handled failure, the original reservation retains the error. A killed process can leave an empty reservation; keep it while checking the original input, review or intent, then select a new command-record filename for its intended continuation. If result persistence fails, the complete native response is still printed to stdout and the error identifies the original reserved output.

`file` supports native capture responses, scientific review exports, Open Waters plans, bulk decision exports and purchased customer files. `files` pages all descriptors already retained by the same operator, including earlier process or launch output. Use original `file_read`/`file_release` methods for range consumers; the high-level download releases its own active read on interruption.

## Full-table decisions without oversized MCP messages

A complete decision document is exported through the original full CSV/TSV formatter. For a large document, upload it once and pass its returned `inputRef` as `documentRef`.

```sh
node stellar-forge/mcp-merchant-operator/wqx-workspace-cli.mjs upload \
  --input-id potomac_decisions_01 --file /absolute/private/decisions.json \
  --content-type application/json

node stellar-forge/mcp-merchant-operator/wqx-workspace-cli.mjs table-export \
  --workspace water --document-ref input:potomac_decisions_01 --format csv \
  --save-json /absolute/private/decisions-csv-descriptor.json

node stellar-forge/mcp-merchant-operator/wqx-workspace-cli.mjs download \
  --workspace water --descriptor /absolute/private/decisions-csv-descriptor.json \
  --directory /absolute/private/decisions-csv
```

After editing the complete native table, use a new named input for its changed bytes. Import it with the original parser, then pass the complete resulting document’s file reference into preview:

```sh
node stellar-forge/mcp-merchant-operator/wqx-workspace-cli.mjs upload \
  --input-id potomac_edited_csv_01 --file /absolute/private/edited-decisions.csv \
  --content-type text/csv

node stellar-forge/mcp-merchant-operator/wqx-workspace-cli.mjs table-import \
  --workspace water --input-ref input:potomac_edited_csv_01 --format csv \
  --save-json /absolute/private/imported-decisions.json

node stellar-forge/mcp-merchant-operator/wqx-workspace-cli.mjs decisions-preview \
  --workspace water --new-plan-id reviewed-potomac-01 \
  --document-ref "file:$IMPORTED_DOCUMENT_FILE_ID" \
  --save-json /absolute/private/decision-preview.json

node stellar-forge/mcp-merchant-operator/wqx-workspace-cli.mjs decisions-save \
  --workspace water --review-id reviewed-potomac-decisions-01 \
  --new-plan-id reviewed-potomac-01 --preview-sha "$ORIGINAL_PREVIEW_SHA256" \
  --document-ref "file:$IMPORTED_DOCUMENT_FILE_ID" \
  --save-json /absolute/private/saved-decisions.json
```

Set `IMPORTED_DOCUMENT_FILE_ID` to the exact `file.fileId` returned by `table-import`, and `ORIGINAL_PREVIEW_SHA256` to the original preview value. The native save uses that complete source-bound document and expected preview hash. `reviewId` and `newPlanId` name immutable records; changing choices means creating the corresponding new reviewed operation. The complete returned JSON remains available through its descriptor even when the compact result omits long arrays.

For an inline document that fits the original MCP request limit, `--document-file DOCUMENT.json` replaces `--document-ref`. A decision-table CSV/TSV preserves the original identifiers, values, units, limits, explicit Set/Keep choices and reasons through the native formatter/parser.

## Typed native client

```js
import { openWqxWorkspaceClient, reopenWqxDownload } from './wqx-workspace-client.mjs';

const client = await openWqxWorkspaceClient({
  url: process.env.WQX_MCP_URL, tokenEnv: 'MCP_ACCESS_TOKEN', workspace: 'water',
});
try {
  const page = await client.inventory({ kind: 'plans', limit: 50 });
  const descriptor = await client.file({
    family: 'plan', id: 'potomac-quarter-open-waters-01', format: 'bundle',
  });
  const received = await client.downloadFile({
    file: descriptor, directory: '/absolute/private/potomac-download',
  }, { onProgress: value => process.stderr.write(JSON.stringify(value) + '\n') });
  const reopened = await reopenWqxDownload({
    directory: received.directory, expectedSha256: descriptor.sha256,
  });
  console.log(JSON.stringify({ page, received, reopened }));
} finally { client.close(); }
```

For an existing native MCP consumer, construct `new WqxWorkspaceClient({client: originalAdapter, workspace: 'water'})`. Its `call(name, args, options)` returns the original structured tool payload and identifies the existing endpoint. `openMerchantFileClient` already implements that contract. Closing this WQX client cancels its own pending reads/waits; native workspace operations preserve their original state.

All 37 tools have named methods. The complete project/capture/analysis/review/plan/edition/merchant/customer methods take `{request: ORIGINAL_REQUEST}` or `{inputRef: COMPLETE_INPUT_REFERENCE}`. Their exact keys come from `WQX_NATIVE_OPERATIONS` in `catalog/wqx-workspace.mjs`. For example:

```js
const analysis = await client.analyze({
  request: { captureId: 'potomac-2025-q1', options: { includeEstimated: false } },
});
const original = await client.downloadFile({
  file: analysis.file, directory: '/absolute/private/scientific-analysis',
});
```

`call('merchant_wqx_TOOL', originalArgs)` remains available for complete original request objects, with the same catalog validation and configured workspace binding. The CLI exposes those native methods by kebab-case command names and `--request-file`/`--input-ref`; `call --tool ... --args-file ...` accepts the full native argument object. Explicit flags must agree with the saved argument file.

## Current-state and transfer outcomes

| Outcome | Continuation using the same original state |
| --- | --- |
| Upload response lost | Read `input-status`, then repeat the same upload identity and source; resume from `receivedBytes`. |
| Download interrupted | Repeat the same descriptor and directory; the exact durable prefix is verified first. |
| Native read expired | The client opens that same file/hash/offset without the expired temporary `readId`. |
| Original source/hash changed | Select and review the intended original source or new immutable operation before continuing. |
| Inventory changed during pagination | Reopen the first page and carry its new `snapshot`; following pages require the saved snapshot. |
| Managed application restarted | The original provider reads the current saved launch and project binding; reopen original records in that launch. |
| Capture request returns a running job | Keep its original operation ID and read jobs/captures for actual completion. |
| Native save response interrupted | Read the same saved review/plan/intent and original status before choosing its permitted continuation. |
| Local `--save-json` write fails after a native response | The complete native response is printed on stdout even if its reserved local output cannot be completed; retain those original IDs and inspect them. |

The client does not automatically replay changing native operations after arbitrary errors. Named-input append replay is supported by the original byte-for-byte contract. Download retries reopen immutable retained bytes. Native customer execution continues to use the original configured buyer, intent and purchase journal.

## Concentration documents and complete reports

`concentrationUnits` reads one immutable plan's exact source groups. `concentrationPrepare` takes a complete document or input reference and one of `fromUnit`, `resultIds`, or `reportedLimitsOnly: true`. Its PREPARED result includes the directly reusable `documentRef`, complete `documentFile`, original JSON proposal `file` and native `reportCsvFile`. The existing input and download methods transfer every byte. `concentrationReport` reopens a saved review's complete JSON or CSV after a project restart or independent receiving.

The corresponding CLI commands are `concentration-units`, `concentration-prepare` and `concentration-report`. The [complete concentration guide](WQX_CONCENTRATIONS.md) provides exact commands and the full source-cohort receiving operation, including blank results, independent limit units and native source/choice binding.
