# Baserow source, merchant and customer operations through MCP

Connect an agent to the same Baserow workspace that an operator uses in the browser. The agent can inspect the original table or public grid, retain every selected row and file, review a versioned data product, operate its original publisher, prepare and stage the merchant, and deliver a complete source packet to another workspace.

The browser, MCP tools, native publisher and release console share the existing source directory, request journal, plans, runs, source versions and deployment receipts. A customer can download complete retained files after the source browser closes, then reopen and import that same packet offline. The [Baserow source guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/baserow/README.md) explains source selection and the [workspace guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/baserow/workspace/README.md) covers its browser.

## Connect the existing source workspace

Run the installed Baserow workspace, or open its existing card in **Applications**:

```sh
starforge baserow-workspace serve --directory /private/baserow/source
```

Use the complete private URL returned by that original server. Its form is `http://127.0.0.1:PORT/#token=HEX_TOKEN`. Save the current URL in a private file, or place it in an environment variable available to the merchant MCP process. When the source browser restarts, update that same file or environment binding to its current URL.

Declare a connection file such as `/private/baserow/baserow-workspaces.json`:

```json
{
  "schema": "stellar-forge.baserow-workspace-connection.v1",
  "workspaces": {
    "catalog": {
      "label": "Baserow catalog",
      "directory": "/private/baserow/source",
      "consoleUrlFile": "/private/baserow/current-source.url",
      "files": {
        "received": {
          "label": "Received original source packet",
          "path": "/private/baserow/received/baserow-source.json"
        }
      }
    }
  }
}
```

Directories must already identify the actual private native workspaces. Files and directories use the original private permissions. Relative paths resolve against the connection file. Each of 1–32 workspace aliases binds one distinct directory. A source packet alias can additionally pin `sha256`; `merchant_baserow_input` returns its actual byte count and digest before import.

Use exactly one of `consoleUrlFile` or `consoleUrlEnv` for each workspace. For the latter, supply the environment variable's name, for example `"consoleUrlEnv": "STARFORGE_BASEROW_SOURCE_URL"`. On the first use of a current URL, the adapter checks the source server's native schema and exact directory. The private source token stays in the host connection.

Initialize and run the existing merchant operator:

```sh
starforge merchant-mcp init-baserow-workspaces \
  --dir /private/baserow/merchant \
  --connection /private/baserow/baserow-workspaces.json

starforge merchant-mcp serve \
  --config /private/baserow/merchant/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
```

Set `MCP_ACCESS_TOKEN` to the host's private operator token before startup. Connect an HTTP MCP client to the returned endpoint plus `/mcp`. The existing stdio front door also works:

```sh
starforge merchant-mcp-stdio --config /private/baserow/merchant/merchant-mcp.json
```

An existing merchant configuration attaches the connection with `baserowWorkspaceConnection` and its existing private `exportsDirectory`. The generic merchant initializer accepts `--baserow-workspaces`. The original source host continues to own source, publisher and release-console lifetimes.

## The complete tool surface

Every source-scoped tool takes `workspace`. Source results are returned as `{workspace,native}`, where `native` preserves the actual source API result. Retained export tools return their completion manifest or original file-range result directly.

| Tool | Complete operation |
| --- | --- |
| `merchant_baserow_workspaces` | List source aliases, declared packet inputs and merchant/runtime profile names. |
| `merchant_baserow_status` | Current draft and revision, selected version, capture/version/discovery pages, pending requests and original publisher state. |
| `merchant_baserow_input` | Original host packet bytes and SHA256 for one declared `file` alias. |
| `merchant_baserow_discover` | Retain native public-grid/table metadata using the source's existing connection alias and one request UUID. |
| `merchant_baserow_discovery` | Reopen one saved discovery by its original `id`. |
| `merchant_baserow_capture` | Capture all selected native pages and selected original attachment bytes. |
| `merchant_baserow_capture_read` | Read complete record pages, file pages, schema or an original interrupted attempt. |
| `merchant_baserow_draft` | Save the complete query/projection draft against `expectedRevision`. |
| `merchant_baserow_preview` | Check all captured rows against one exact `draftRevision`. |
| `merchant_baserow_version` | Read, review/save or select an immutable source version. |
| `merchant_baserow_compare` | Compare two saved source versions and their complete retained dataset results. |
| `merchant_baserow_publisher` | Original source/target/plan/run inspection, extraction, review, publication, buyer handoff and refresh schedule. |
| `merchant_baserow_deployment` | Original merchant review, package, comparison, stage and release-console controls. |
| `merchant_baserow_operation` | Inspect or resume the same retained native source request. |
| `merchant_baserow_import` | Import one complete declared packet or retained source export under its original SHA256 and request UUID. |
| `merchant_baserow_export` | Retain an entire capture, source version, merchant package, combined handoff or original attachment. |
| `merchant_baserow_exports` | Page complete and preparing exports with their stable IDs and snapshot. |
| `merchant_baserow_export_manifest` | Read the complete original manifest and its exact hash. |
| `merchant_baserow_export_file` | Receive one original file in hash-bound ranges through the shared streamed snapshot. |
| `merchant_baserow_export_file_release` | Close a temporary download snapshot while preserving the original export. |

Keep a request UUID with its exact payload before each change. A different intentional action gets a new UUID. Source version IDs are positive integers; capture, discovery, source request and run identities are UUIDs; export IDs are UUID version 4. Hashes are full lowercase SHA256 values.

### Native source selection and complete capture

Discovery `input` retains `connectionAlias`, `slug` or `tableId`, optional `viewId`, native `filters` and `search`, and `requestId`. Select connection aliases already configured on the original source host. Private table credentials remain with that host.

Capture `input` contains `discoveryId`, `connectionAlias`, explicit `orderBy`, `attachments`, complete `queries`, `title`, `expectedDraftRevision` and `requestId`. Use the native field IDs returned by discovery. Keep the actual public-view selection and explicit ordering with the capture; a public view's placeholder entity IDs do not identify a private table.

Queries name their projection columns explicitly. A projection source is `field_<native numeric ID>`, `$recordId` or `$order`. Native type and encoding choices remain those in the source guide: exact identity text, native scalar values, explicit JSON text for structured values and attachment descriptors. Save the full query draft when editing it.

For complete rows or files, use:

```js
await client.call('merchant_baserow_capture_read', {
  workspace: 'catalog',
  id: captureId,
  kind: 'rows',
  expectedCaptureSha256: captureSha256,
  offset: 0,
  limit: 100
});
```

Continue each returned `nextOffset` until it is `null`. Repeat the same capture hash. Record values retain original number tokens and structured values; the row page distinguishes `number-token`, `null`, `string`, `boolean` and `structured`. Source order is preserved.

The file page includes the original filename, byte count, SHA256 and reference count. Its human-readable references preview is capped at 25; the complete original packet retains every reference. Attachment retention uses the original source-returned full file URL and the source's selected origin rules. A metadata-only capture keeps `{mode:"metadata"}`. A retained-file capture keeps its exact original attachment policy and bytes.

Use `kind:"attempt"` to inspect the retained state of an interrupted capture. Inspect or resume its existing source request before deciding whether to make a new provider observation.

### Review and select the data product

Save the complete draft with `merchant_baserow_draft`, retaining its returned `draftRevision`. Preview that exact revision. The native result includes `id`, `complete`, `allRowsChecked` and per-query reports.

Save a source version:

```js
await client.call('merchant_baserow_version', {
  workspace: 'catalog',
  action: 'save',
  input: {
    draftRevision,
    previewId,
    reviewer,
    note,
    expectedSelectedVersion,
    requestId
  }
});
```

`expectedSelectedVersion` is the current native selection, including `null` for the first version. Read a version with `{workspace,action:"read",id}`. Select an existing version with `{workspace,action:"select",input:{versionId,expectedSelectedVersion,requestId}}`. A saved version returns its source file hash, capture hash, schema, queries and original review.

## Operate the original publisher

Open the reviewed source selection:

```js
await client.call('merchant_baserow_publisher', {
  workspace: 'catalog',
  action: 'open',
  expectedSelectedVersion: versionId,
  requestId
});
```

The source host opens its actual publisher and refresh schedule. Publisher read actions use `{workspace,action,input}`. Publisher writes also require the current `expectedSelectedVersion` and one source `requestId`. Read source, target, complete plan and run results before each decision.

| Publisher action | Original `input` |
| --- | --- |
| `status` | Optional `limit`, `plansOffset`, `runsOffset`, `historyOffset`. |
| `source` / `target` | Empty object. |
| `plan` | `planId`. |
| `run` | `runId` and optional original dataset query string `query`. |
| `plan-save` | `plan`: title, declared query, input, exact sourceHash, dataset schema and extraction limits/order. |
| `extract` | `planId`, inspected `planDigest` and a retained, explicit `runId`. |
| `cancel` / `recover` | `runId`. |
| `review` | `runId`, `candidateDigest`, reviewer/note, and `initialize:true` or exact target `expectedSnapshot` / `expectedRevision`. |
| `publish` | `runId` and original `reviewId`. |
| `buyer-offer` | `runId` and optional `query`. |
| `buyer-prepare` | `runId`, optional `query`, `offerSha256`, `acceptIndex` and original `intentId`. |
| `buyer-handoff` | `runId` and original `handoffId`. |
| `schedule` | Optional `limit` and `offset`. |
| `schedule-save` | Original schedule `policy`. |
| `schedule-enable` | Schedule `revision` and current target `expectedSnapshot` / `expectedRevision`. |
| `schedule-pause` / `schedule-run` / `schedule-continue` | Current schedule `revision`. |

A write that returns normally has native `mode:"ORIGINAL_PUBLISHER_RESULT"`, `action`, `value` and exact source version/hash. Extraction retains the original run immediately and continues through its native completion. Read that run until its actual state is `READY`, then review its candidate digest, publish its review ID and inspect the resulting snapshot.

The complete extraction plan uses the actual saved source query and output types. Keep max-row/byte/cell limits appropriate for the selected source and retain the actual ordering in the plan. The source publisher uses the same original capture for a frozen source.

Buyer preparation retains the existing public buyer configuration and native history event. `buyer-handoff` reopens those exact bytes and checks their original hash. The returned `configText` is the complete original configuration; use the existing buyer workflow to execute its prepared request.

Close the original publisher using `{workspace,action:"close",requestId}`. A later open is a new intentional operation against the selected source version.

### Recover the same operation

Read `merchant_baserow_operation` with the original `requestId` after a lost reply. `resume:true` continues the native source journal. A completed request returns its original result.

An interrupted publisher command returns `mode:"OBSERVED_ORIGINAL_STATE"` and actual current native records. For example, a retained extraction UUID identifies its original run; a publication in `PUBLICATION_UNKNOWN` uses the original publisher's recovery; buyer preparation returns matching retained handoff records. This recovery result can differ from the successful command's `value` shape.

A recovered plan-save can return several `originalPlans` matching source hash, query and title after the recorded prior plan ID. Inspect each complete dataset/extraction definition and explicitly select the intended native plan before continuing. The observer's match is an inventory of actual plans. It is not an automatic choice of a particular normalized extraction or proof that one candidate was this request's result.

Read the current target, run, review and schedule records when deciding how to continue. Preserve the same original run and offer identities through recovery.

## Prepare and stage the merchant

The host connection can declare `terms` and `runtimes` maps. Each terms profile contains the real public `origin`, fixed `path` and native `payment` object accepted by the original Baserow deployment compiler. Each runtime profile contains the original `port`, optional `facilitator` and optional `allowLocalFacilitator` settings. Use the owner's actual merchant terms and facilitator configuration.

Deployment actions preserve the original source API payloads:

| Action | `input` |
| --- | --- |
| `status` | Optional native run/operation paging fields. |
| `package` | `id` of the completed package request. |
| `compare` | Retained SF82 release IDs `from` and `to`; omit `from` to compare the current active release. |
| `review` | `versionId`, `runId`, host `termsProfile` alias and `requestId`. |
| `prepare` | `reviewRequestId`, `expectedReviewSha256` and `requestId`. |
| `stage` | `packageRequestId`, `expectedSourceSha256`, release `id` / `label`, host `runtimeProfile` alias and `requestId`. |
| `open` | `requestId` to open the existing release console. |
| `close` | Original console `instanceId` and `requestId`. |
| `command` | Native action, console instance, expected generation/digest, retained release/instance IDs and `requestId`. |

The adapter resolves profile names to the host's actual terms and runtime objects before the native source request is retained. Inspect the original release console state before select/start/stop/rollback actions; its existing generation and digest checks apply. A lost release reply is reconciled through the same source request.

The prepared deployment keeps its original five files: `dataset.csv`, `dataset.json`, `seller.json`, `source.json` and `binding.json`. Its host dataset path remains the one recorded by the original deployment compiler. To create a merchant on another host, receive the source packet into that host's native workspace, publish its own reviewed version and prepare its own original deployment.

## Retain a complete customer handoff

Choose one stable export UUID and an exact selection:

| Kind | Required selection fields | Payload files |
| --- | --- | --- |
| `capture` | `captureId`, `expectedCaptureSha256` | Complete `baserow-source.json` packet. |
| `version` | `versionId`, `expectedCaptureSha256`, `expectedSourceSha256` | Complete version packet, including the selected query draft. |
| `deployment` | `packageRequestId`, `expectedPackageSha256` | Original five-file merchant package. |
| `handoff` | Version fields plus `packageRequestId` and `expectedPackageSha256` | Complete source packet and original five-file package. |
| `attachment` | `captureId`, `expectedCaptureSha256`, native `file` and `expectedFileSha256` | The original attachment's complete bytes. |

For every row, set `selection.kind` to that kind:

```js
const exported = await client.call('merchant_baserow_export', {
  workspace: 'catalog',
  exportId,
  selection: {
    kind: 'version',
    versionId,
    expectedCaptureSha256: captureSha256,
    expectedSourceSha256: sourceSha256
  }
});
```

A combined handoff checks that its original deployment names the selected source version and capture. Its payload count is six; every completed export also retains `manifest.json`.

The packet includes complete original source metadata before and after acquisition, every page and closing page, complete values and the original selected file bytes. A complete export's request is retained before transfer, its files are checked against the native source, and its completion manifest is saved last. Repeat its exact ID and selection to recover an interrupted export. `merchant_baserow_exports` finds a prior export after a lost initial reply; continue pages with the returned snapshot.

Inspect `merchant_baserow_export_manifest` and retain the returned manifest file SHA256. `merchant_baserow_export_file` repeats that hash plus the chosen file hash on every range. Keep the returned `readId` and use `nextOffset` until `null`. The shared reader streams each full file into one private immutable snapshot before serving its ranges. Its Baserow limit is 553,648,128 bytes. Original source packets remain on disk while ranges are delivered.

### Download and reopen on the customer's host

The maintained receiver uses the same range protocol, verifies all bytes, checkpoints progress and saves the manifest after the complete payload:

```sh
starforge mcp-baserow-download inspect \
  --url http://127.0.0.1:3211/mcp --export-id "$EXPORT_ID"

starforge mcp-baserow-download download \
  --url http://127.0.0.1:3211/mcp --export-id "$EXPORT_ID" \
  --expected-manifest-sha256 "$MANIFEST_SHA256" \
  --directory /private/customer/baserow-delivery

starforge mcp-baserow-download reopen \
  --export-id "$EXPORT_ID" --expected-manifest-sha256 "$MANIFEST_SHA256" \
  --directory /private/customer/baserow-delivery
```

`inspect` and `download` use the customer's original `MCP_ACCESS_TOKEN` environment binding; `--token-env` selects another name. Resume `download` with the same endpoint, export ID, manifest hash and directory after interruption or MCP restart. A completed retained export can be served with its source browser closed. `reopen` verifies the complete local files offline.

The merchant CLI aliases are `inspect-baserow`, `download-baserow`, `reopen-baserow` and `receive-baserow`. They call this same receiver.

For a capture, version or combined handoff, receive the original source into a native customer workspace outside the download directory:

```sh
starforge mcp-baserow-download receive \
  --export-id "$EXPORT_ID" --expected-manifest-sha256 "$MANIFEST_SHA256" \
  --directory /private/customer/baserow-delivery \
  --workspace /private/customer/baserow-source --create \
  --title "Received Baserow source" --expected-draft-revision 0 \
  --request-id "$RECEIVING_REQUEST_ID"
```

Keep that same request UUID, title and expected draft revision when resuming. The original native import journal reopens a completed request, including across process restart. The received capture retains its original metadata, full rows, attachment bytes and capture hash. Review and version its draft through the customer's existing Baserow workspace.

An agent can perform the corresponding host-side import with `merchant_baserow_import`. Supply exactly one declared `file` alias or retained `exportId`, the packet's original `expectedSha256`, title, expected draft revision and request UUID. The adapter freezes and hashes the complete selected packet before it dispatches those same bytes to the receiving source workspace.

## Run the original-source continuation

[examples/baserow-handoff.mjs](examples/baserow-handoff.mjs) continues an existing completed public-catalog journey. It reopens that run's source workspace, operates the actual publisher through MCP, receives the original packet through MCP into a customer workspace, streams its complete files after the source browsers close, and reopens the same customer import offline.

```sh
node stellar-forge/mcp-merchant-operator/examples/baserow-handoff.mjs \
  --native-run /private/original-baserow-run \
  --out /private/original-baserow-run/mcp-customer \
  --source-ref "$FULL_REVIEWED_GIT_SHA"
```

The original run supplies its actual source/capture hashes and complete workspace receipt. All operation IDs, full native results, output manifests and final `mcp-customer-result.json` remain in the continuation directory. Its input is the original captured source and original source workspace. Optional actual merchant terms and runtime files extend the same continuation through deployment preparation and staging.
