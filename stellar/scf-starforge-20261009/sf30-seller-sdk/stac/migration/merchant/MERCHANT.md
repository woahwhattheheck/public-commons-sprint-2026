# Native GIS migration: SDK, merchant tools and complete receiving

The installed migration workspace joins the original vector, QGIS, mapping, cartographic publication and archive engines to the existing Starforge merchant host. It supplies 44 `merchant_migration_*` tools, a typed JavaScript client, and the `starforge migration-workspace` command. The original migration database, revisions, accepted plans and complete file archive remain the operating record.

Use this guide alongside [the operator guide](../README.md), [complete project receiving](../RECEIVING.md), and [native cartographic publication](../CARTOGRAPHY.md). The editable browser opens the same workspace. The SDK uses that workspace's actual source and native operations.

## Install and select the original host

The installed package is `@tokenjunkielabs/starforge-merchant`. This source contributes:

| Installed entry | Purpose |
| --- | --- |
| `starforge migration-workspace` | Setup, native calls, complete downloads and independent receiving |
| `@tokenjunkielabs/starforge-merchant/seller/stac/migration` | Typed source, mapping, project and publication client |
| `@tokenjunkielabs/starforge-merchant/buyer/stac/migration` | Complete handover and native receiving client |
| `@tokenjunkielabs/starforge-merchant/merchant/mcp/migration` | The same original merchant family and tool metadata |
| Provider `migration-workspaces` | Source-owned, lazy merchant registration |

The contribution is `distribution/contributions/migration-workspaces.json`. It carries the complete declared native source, including the canonical PostGIS package, and this consumer. The standard distribution composer owns the installed command and provider registry.

First create or select the original migration workspace using its existing browser or Python entrypoint. Read its real ID from `state`. Put that ID, the selected native environments, and the approved input/output locations into a private host connection:

```json
{
  "schema": "starforge.migration-merchant-connection.v1",
  "name": "Delivery GIS workspaces",
  "workspaces": {
    "delivery": {
      "workspaceId": "ORIGINAL_WORKSPACE_ID",
      "directory": "/private/migration-workspace",
      "runtimeDirectory": "/private/migration-native-tasks",
      "python": "/absolute/path/to/main-python",
      "vectorPython": "/absolute/path/to/fiona-python",
      "qgisPython": "/absolute/path/to/qgis-python",
      "pythonPath": [],
      "environment": {
        "QT_QPA_PLATFORM": "offscreen"
      },
      "inputs": {
        "approved_source": {
          "kind": "selection",
          "file": "/private/inputs/selection.json",
          "sourceRoot": "/private/inputs/original",
          "bytes": 12345,
          "sha256": "COMPLETE_ORIGINAL_SELECTION_SHA256"
        },
        "retained_capture": {
          "kind": "capture",
          "directory": "/private/inputs/native-capture",
          "sha256": "COMPLETE_ORIGINAL_CAPTURE_MANIFEST_SHA256"
        }
      },
      "destinations": {}
    }
  }
}
```

Replace the illustrative ID, byte count and hashes with the original observed values. Paths may be absolute or relative to the connection file. `vectorPython` and `qgisPython` default to `python`; declare separate installed environments when the browser uses them. `pythonPath` adds actual native module locations. The host environment can supply the original runtime's other variables.

The routing matches the browser: capture, native data generation and vector information use the vector Python; native projects, receiving, QGIS information and cartography use the QGIS Python; other source and workspace operations use the main Python. The entrypoint checks the declared workspace ID before its original operation. For a received archive, it checks the incoming workspace ID and exact archive hash before publishing the destination.

`runtimeDirectory` is external to every active workspace. It retains native inputs, process attempts, complete results, logs, reader state and completed archives. A workspace's directory and runtime directory stay paired with its original ID.

Create the original merchant configuration:

```bash
starforge migration-workspace init \
  --directory /private/migration-merchant \
  --connection /private/migration-connection.json
```

This creates the original SF82 release store and merchant configuration, then validates the complete source-owned registry. Repeating the command with identical input reopens the same configuration. To join an existing merchant, retain its other families and add `"migrationWorkspaceConnection": "/private/migration-connection.json"` to that original configuration. The standard `merchant-providers init migration-workspaces --options FILE` hook uses the same initializer.

A private `--merchant FILE` CLI call opens the maintained merchant host for that invocation and closes it after completion. An already running merchant can be addressed by its original MCP `--url`. Use its existing authentication environment variable through `--token-env`.

## Typed client and exact native results

Borrow an already opened original merchant:

```js
import {
  createMigrationMerchantClient,
  parseExactJSON,
  stringifyExactJSON
} from '@tokenjunkielabs/starforge-merchant/seller/stac/migration';

const migration = await createMigrationMerchantClient({
  merchant: originalMerchant,
  endpoint: originalMerchantIdentity,
  workspace: 'delivery',
  workspaceId: originalWorkspaceId
});

const current = await migration.call('state');
if (current.state !== 'COMPLETE') throw new Error(current.state);
console.log(current.value.id, current.value.revision);
```

The borrowed merchant keeps its original owner and lifecycle. The client also accepts `{url, workspace, workspaceId, tokenEnv, environment, signal}` for the existing HTTP host. It checks the configured alias and workspace ID when it connects.

Native calls return a retained task, rather than flattening the engine envelope:

```js
{
  workspaceId,
  requestId,
  command,
  state,
  attempt,
  resultJson,
  value,
  resultFile: {name, bytes, sha256},
  logFile: {name, bytes, sha256}
}
```

`resultJson` contains the complete original JSON envelope, including exact numeric tokens. Its `value` is a convenient projection: exact numeric objects appear as `{$number: "original lexeme"}`. Use `parseExactJSON(resultJson)` and `stringifyExactJSON` when editing and saving original numeric content. Mapping and publication inputs use complete `planJson` and `specJson` strings.

The default inline result limit is 256 KiB. The host can set `inlineResultBytes` between 1 KiB and 4 MiB. Larger native results retain their full `resultFile`; download that original file through `downloadTaskFile` or `task_file`. A result surviving a process interruption can be `RESULT_RETAINED` until its original full envelope is read. Native logs become downloadable after the selected attempt has stopped.

## Complete source, mapping and native delivery

Start by inspecting `inputs`, then use `capture` for the host's original selection or `receive_capture` for an already retained complete native capture. Input tools take aliases and exact hashes; the host supplies the actual file paths. Keep each write's original `revision`, `requestId` and `actor`.

```js
const captured = await migration.call('capture', {
  input: 'approved_source',
  expectedSha256: originalSelectionSha256,
  revision: current.value.revision,
  requestId: captureRequestId,
  actor: operator
});
```

Read the actual returned capture ID from the complete result. Page `source_rows` for every selected original layer. Use `draft` to create the full mapping document, then review its original fields, destination representations, keys, null decisions, CRS and project definitions. Preserve the complete draft while making the intended changes:

```js
const draftTask = await migration.call('draft', {captureId});
const originalDraft = parseExactJSON(draftTask.resultJson).result;
// Edit the complete original draft returned by this workspace.
const saved = await migration.call('save_plan', {
  planJson: stringifyExactJSON(reviewedPlan),
  revision: observedRevision,
  requestId: planRequestId,
  actor: operator
});
```

`issues` pages all actual mapping findings. Resolve the relevant choices in a saved successor and record `review_plan` with `accepted` or `changes-requested` and the operator's note. `build_edition` uses the saved plan through the original native vector engine, retaining its real native output and readback. `build_projects` builds and reopens every project selected by that edition.

Page reads accept `offset` and `limit`; the native maximum is 100. Continue while `hasMore` is true. The collections and full documents preserve their original IDs.

For corrected data, receive the actual corrected capture, compare it with `compare_captures`, and draft from that capture plus the original `predecessorPlanId`. Complete any new field/key/project decisions, then review and build the successor. `comparison_rows` retains all changes; the earlier source, plan, maps and history remain available.

### Complete native cartography

`cartography_inventory` returns the actual saved maps and publications. Select a project ID from the returned native project build, prepare a complete publication `specJson`, and call `cartography_preview`. The original plan owns page geometry, extent, layer order, legend, scale bar, attribution and corrected-publication comparison.

Save the reviewed plan with `cartography_save_plan`, then publish through `cartography_publish` with its original write identity. The native result contains the editable QGZ and QPT, PDF, PNG, original plan and complete receipt. Use `cartography_download` to obtain an exact declared descriptor, then the ordinary `file` reader for its complete bytes. `cartography_reopen` opens the selected or all saved publications through the same native renderer.

The full [receiving journey](../RECEIVING.md#complete-native-receiving-journey) can compose baseline and corrected publication from the exact maps it just built. Its optional `cartography` selection retains both complete specs and the correction note before the first archive. The independent receiver checks the selected original software closure and reopens the maps and publications included in that archive.

## Native requests, interruption and restart

Native writes keep the same task ID as their original journal request. The attachment persists the full request before starting its selected Python and retains each attempt's result and log. The original engine owns committed workspace actions.

For a running host, `wait: false` returns the accepted task identity while its native operation proceeds. Read `task`, and use `cancel` for that original request if required. A restarted attachment identifies an already running original child by its host, boot, PID birth and arguments; it follows that process. Once a prior attempt has ended, a repeated failed request can continue the original engine with the same input. Changed input under the same request ID is a conflict.

A completed original result is returned on exact retry. To read current workspace state after later edits, make a fresh `state` call. Retain the original request for a resumed mutation.

The private `--merchant` CLI waits for its complete call before releasing its host. Use the running host's `--url` for asynchronous calls. Native process groups are cancelled and drained before attachment shutdown releases its original lock. Closing one alias permits a later reopen; closing the full original merchant drains all attached native work and retained readers.

Complete result or log receiving uses the shared retained downloader:

```js
await migration.downloadTaskFile({
  requestId: projectRequestId,
  kind: 'result',
  directory: '/private/receiving/project-result'
});
```

The download retains its original attempt and file descriptor. Reopening that same directory resumes the exact selected result even if the native request later has a newer attempt. The lower-level `task_file` and `task_file_release` also accept an explicit original `attempt`.

## Complete archive receiving

Export once at the selected current workspace revision:

```js
const exported = await migration.call('export', {
  exportId: handoverId,
  revision: reviewedRevision,
  requestId: exportRequestId,
  actor: operator
});
const selected = await migration.inspectExport({exportId: handoverId});
const downloaded = await migration.downloadExport({
  exportId: handoverId,
  expectedManifestSha256: selected.manifestSha256,
  directory: '/private/receiving/approved-handover'
});
```

The small `migration-export.json` binds the original workspace, revision, request, native package manifest and complete `handover.zip`. The ZIP is the original archive with every declared source, mapping, edition, project, style resource, publication, request, event and selected native application.

The consumer uses the maintained retained-file transport. It checks the manifest, original byte offsets, chunks and complete hashes; it synchronizes bytes before checkpoints. It resumes the same file prefix after a process restart and reopens an expired reader against the same immutable original file. Maximum chunks are 196,608 bytes. The final manifest is published after the complete archive verifies.

Inspect and independently receive the downloaded archive:

```js
import {
  inspectReceivedMigrationExport,
  receiveMigrationExport
} from '@tokenjunkielabs/starforge-merchant/buyer/stac/migration';

await inspectReceivedMigrationExport({
  directory: '/private/receiving/approved-handover',
  expectedManifestSha256: selected.manifestSha256
});

const received = await receiveMigrationExport({
  directory: '/private/receiving/approved-handover',
  expectedManifestSha256: selected.manifestSha256,
  destination: '/private/independent-migration',
  runtimeDirectory: '/private/independent-migration-tasks',
  python: '/absolute/path/to/qgis-python',
  requestId: receivingRequestId,
  nativeReopen: 'required'
});
```

The original receiver verifies the full package and installs the same workspace identity, source, editions, requests and event history. `required`, the consumer default, reopens its real maps and publications through the selected QGIS runtime. It then reads the original workspace state and verifies the complete migration closure. The consumer retains its own complete receiving result for exact continuation.

The received archive includes the complete native Python/QGIS application named by its software selection. Its independent Python journey runs from those received modules, including onward export and reopen. The installed merchant SDK uses the complete Starforge distribution for its shared host and file transport.

For remote receiving at a host-declared destination, add an input of kind `handover` with its exact `file`, `bytes`, `sha256` and incoming `workspaceId`, plus a destination alias naming the receiving directory and that same workspace ID. Call `receive` with the two aliases, exact hash, original receiving request ID and native reopening mode. The original incoming package identity is checked before destination publication.

## CLI operations

The CLI accepts the same complete tool arguments in a JSON file:

```bash
starforge migration-workspace call \
  --merchant /private/migration-merchant/merchant-mcp.json \
  --workspace delivery --workspace-id ORIGINAL_WORKSPACE_ID \
  --command build_projects --payload /private/requests/build-projects.json

starforge migration-workspace download \
  --url ORIGINAL_MERCHANT_MCP_URL \
  --workspace delivery --workspace-id ORIGINAL_WORKSPACE_ID \
  --export-id ORIGINAL_HANDOVER_ID \
  --expected-manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --directory /private/receiving/approved-handover

starforge migration-workspace receive-local \
  --directory /private/receiving/approved-handover \
  --destination /private/independent-migration \
  --runtime /private/independent-migration-tasks \
  --python /absolute/path/to/qgis-python \
  --request-id ORIGINAL_RECEIVING_REQUEST
```

`inspect-export` reads the remote selection; `inspect-received` verifies completed local files. `download-task --request-id ID --kind result|log --directory DIR` receives an exact original native result. `receive` combines complete remote download and independent local native receiving. Repeat `--python-path` for actual native module locations. `--help` lists the full command interface.

Standard output carries the complete result JSON; progress uses standard error. A returned native failed, cancelled or interrupted task exits with status 2 and keeps its original task/result/log identities.

## Tool groups

All names below use the `merchant_migration_` prefix.

| Workflow | Operations |
| --- | --- |
| Original host and source | `status`, `open`, `inputs`, `state`, `records`, `document`, `draft`, `source_rows` |
| Mapping and corrected editions | `issues`, `comparison_rows`, `capture`, `receive_capture`, `save_plan`, `review_plan`, `compare_captures`, `build_edition` |
| Native maps and source checks | `build_projects`, `verify`, `native_info`, `qgis_info`, `native_reopen` |
| Original requests and files | `history`, `operation`, `task`, `cancel`, `files`, `file`, `file_release`, `task_file`, `task_file_release` |
| Complete handover | `export`, `export_manifest`, `export_file`, `export_file_release`, `receive` |
| Native publication | `cartography_inventory`, `cartography_preview`, `cartography_save_plan`, `cartography_publish`, `cartography_operation`, `cartography_publication`, `cartography_download`, `cartography_reopen` |
| Original lifecycle | `close` |

The TypeScript declarations match these tool arguments, exact result/file shapes, native configurations and consumer functions.
