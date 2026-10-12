# ArcGIS workspaces through the merchant agent interface

Use the ArcGIS workbench from an MCP client and the browser over the same saved publisher. The adapter covers source import and live capture, public column mapping, immutable editions, deployment exports, original release controls, and complete file delivery. The existing `merchant_publisher_*` tools handle extraction plans, candidate inspection, reviewed publication, recovery, buyer handoffs and scheduled refreshes.

This is a connection to the maintained ArcGIS workbench. Its capture, request, edition, deployment and publisher histories are the same histories seen in the industrial browser. A tool response includes the exact workspace and publisher instance IDs so a client can retain the correct operation across a lost response.

## Host setup

Use the runtime requirements in [WORKBENCH.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/WORKBENCH.md): a supported Node release with `node:sqlite` and the Linux `flock` utility for a version-2 dataset writer. The merchant source distribution must include the ArcGIS workbench and publisher modules.

First declare the original ArcGIS publisher in the existing publisher connection file. Its alias, directory, seller and resource bindings continue to belong to `MerchantPublisher`. Do not launch a second publisher server against that directory. See the publisher setup in the [merchant operator README](README.md).

Create an owner-readable connection JSON, for example `arcgis-workspaces.json`:

```json
{
  "schema": "stellar-forge.arcgis-workspace-connection.v1",
  "workspaces": {
    "field-data": {
      "label": "Field dataset delivery",
      "publisher": "field-publisher",
      "files": {
        "layer": {
          "label": "Original layer metadata",
          "kind": "layer",
          "file": "/srv/field-input/layer.json"
        },
        "records": {
          "label": "Original feature response",
          "kind": "attributes",
          "file": "/srv/field-input/features.json"
        },
        "seller": {
          "label": "Reviewed seller configuration",
          "kind": "seller",
          "file": "/srv/field-input/seller.json"
        }
      },
      "connections": {
        "source": {
          "label": "Declared source layer",
          "connection": {
            "layerUrl": "https://services.example.org/arcgis/rest/services/FieldData/FeatureServer/0",
            "pageSize": 250,
            "maxRows": 250000,
            "maxSourceBytes": 67108864,
            "maxPageBytes": 16777216,
            "timeoutMs": 120000
          }
        }
      },
      "runtime": {
        "port": 0
      }
    }
  }
}
```

The URL and paths above are examples. Set them to the actual retained inputs and source layer. Files mode uses the declared layer URL as original source identity; it reads the declared metadata and page uploads. Live mode queries that declared layer.

An authenticated profile can contain `"tokenEnv": "ARCGIS_TOKEN"` inside `connection`. Set the value in the host process environment. The client selects a profile alias and cannot choose a credential environment variable, arbitrary source URL, host path, release store or runtime. The public profile summary reports whether authentication is configured without returning the environment name or its value.

Initialize a merchant agent host over those declarations:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-arcgis-workspaces \
  --dir /srv/field-agent \
  --publishers /srv/publisher-connection.json \
  --connection /srv/arcgis-workspaces.json \
  --release-store /srv/original-release-store \
  --name "Field dataset operations"
node stellar-forge/mcp-merchant-operator/serve.mjs serve --config /srv/field-agent/merchant-mcp.json
```

Use the original release store when adopting existing releases. The initializer also supports a new store when none is being adopted. An existing publisher initializer can receive `--arcgis-workspaces` and `--release-store`. An existing merchant configuration can reference both `publisherConnection` and `arcgisWorkspaceConnection`.

One ArcGIS workspace is allowed per declared ArcGIS publisher. Host validation resolves file paths, checks each publisher's source kind and keeps all selected runtime and release-store settings on the host.

## Installed launcher and Applications

The installed toolkit exposes the combined workspace as `starforge arcgis-agent`. Initialize the host with the declarations above, then open the original publisher and browser through one merchant process:

```sh
starforge merchant-mcp init-arcgis-workspaces \
  --dir /srv/field-agent \
  --publishers /srv/publisher-connection.json \
  --connection /srv/arcgis-workspaces.json \
  --release-store /srv/original-release-store
starforge arcgis-agent inspect \
  --config /srv/field-agent/merchant-mcp.json --workspace field-data
starforge arcgis-agent serve \
  --config /srv/field-agent/merchant-mcp.json --workspace field-data \
  --port 0 --mcp-port 0 --token-env MCP_ACCESS_TOKEN
```

Set `MCP_ACCESS_TOKEN` in the host environment before starting. The launcher prints one JSON startup record containing the actual `operatorUrl`, `mcpUrl`, persistent `workbenchId`, current instance IDs and configuration binding SHA-256. Open `operatorUrl` in the browser and connect the MCP client to `mcpUrl` with that host token. The startup record contains no token value. Port `0` lets each original listener choose a free loopback port.

To save the same application in the runtime console, select a READY installation containing this command, then choose **Applications → New application → ArcGIS merchant workspace**. Select the original `merchant-mcp.json`, its ArcGIS workspace alias, the browser port and MCP port. An optional private environment JSON supplies the MCP token and any declared source credentials through the existing managed worker.

**Review application** retains the original merchant and connection declarations, publisher directory, installed source and exact command. **Save application**, **Review start** and **Start reviewed application** use the existing managed release process. **Open application** appears only after the native launcher announces its actual browser URL. The original operation also retains the matching MCP endpoint and workspace identities.

The application binds the three original configuration files by their actual SHA-256 values. If a declaration changes between review and startup, review its current configuration again. Source captures, publisher plans, editions and deployment history remain mutable through their original controls; merely launching the application does not create a new capture or dataset.

Closing a browser window leaves the host running. The `merchant_arcgis_browser` close operation drains only that listener; agent work remains available. **Stop application**, SIGINT or SIGTERM closes the original MCP owner and drains its borrowed browser, workbench, retained file reads and publisher. Reopening uses the same saved state.

For embedding, the package exports `./merchant/mcp/arcgis` and `./merchant/mcp/arcgis/server`. The latter exposes `inspectArcgisAgentBinding({configPath, workspace})` and `startArcgisAgentWorkspace({configPath, workspace, port, mcpPort, tokenEnv, environment, expectedBindingSha256})`. Startup returns `{startup, operator, server, url, close}`. Call its `close()` to shut down that one owner.

## Open the original workspace

Call `merchant_arcgis_status({})` to list configured aliases without opening a publisher. Then:

```json
{
  "workspace": "field-data"
}
```

Pass this to `merchant_arcgis_open`. Retain:

| Returned value | Meaning |
| --- | --- |
| `workbenchId` | Persistent original ArcGIS workspace identity; required by subsequent ArcGIS operations. |
| `instanceId` | This process's workbench instance; required to close that workbench. |
| `publisherInstanceId` | The existing merchant publisher instance; identical to `merchant_publisher_open` for its alias. |
| `native.revision` | Current source-selection revision; required when selecting an edition. |
| `native.captures`, `native.editions`, `native.deployments` | Retained native records, each with its original ID and state. |

The open operation also opens the original publisher when necessary. Its existing enabled schedule resumes through the single native scheduler, exactly as it does for `merchant_publisher_open`. Inspect that saved schedule through `merchant_publisher_schedule` if it is relevant to the work.

All examples below use names such as WORKBENCH_UUID and REQUEST_UUID as placeholders. Copy actual returned IDs and generate a fresh UUID only when starting a genuinely new native request. Keep each request UUID and its complete input before dispatch.

## Import original files or capture a live layer

### Retained files

Use `merchant_arcgis_source` with `action: "inspect"`, a workspace, its workbenchId and a file alias. The response includes the original file's name, byte length, role and SHA-256.

Then upload those same bytes:

```json
{
  "workspace": "field-data",
  "workbenchId": "WORKBENCH_UUID",
  "action": "upload",
  "file": "layer",
  "requestId": "UPLOAD_REQUEST_UUID",
  "expectedSha256": "INSPECTED_SHA256"
}
```

A successful upload returns `result.request.state: "SUCCEEDED"` and `result.upload.id`. Retain that upload ID. Upload the ordered original feature pages and the reviewed seller configuration in the same way. Uploads preserve exact original JSON bytes; repeating an accepted upload UUID also checks the actual request bytes.

Prepare the capture with `merchant_arcgis_capture`:

```json
{
  "workspace": "field-data",
  "workbenchId": "WORKBENCH_UUID",
  "action": "prepare",
  "requestId": "CAPTURE_REQUEST_UUID",
  "title": "Original source response",
  "mode": "files",
  "profile": "source",
  "query": {
    "where": "1=1",
    "returnGeometry": true
  },
  "files": {
    "metadata": "METADATA_UPLOAD_UUID",
    "pages": ["FEATURE_PAGE_UPLOAD_UUID"],
    "representation": "parsed-json"
  }
}
```

Use `wire-json` when the retained file is the original wire response, or `parsed-json` for a previously parsed and serialized response. This label does not manufacture transport provenance. For separately retained geometry, supply `geometryPages` and the actual `geometryField`; that join field must be included in the selected source fields.

Preparing a capture creates or resumes the original capture declaration. It does not imply all its pages have been consumed. Read the retained request and capture, then use `action: "continue"` with the same `captureId`, a new continuation request UUID and, optionally, `maxPages`. The native capture stores actual page progress before moving forward.

### Live layer

Prepare with `mode: "live"`, the declared profile and the exact provider query, omitting `files`. Optional `outFields` is an array of actual source field names; omitting it selects the native metadata's nongeometry fields. The original object ID is retained. Continue the same capture to read the provider's metadata, selected IDs and pages.

The host connection sets page, row, byte and timeout limits. The original capture engine validates the field types, selected object IDs, complete page set and spatial reference. Inspect the native result with `action: "inspect"` and the original capture UUID. The response contains native state, field definitions, original geometry type and spatial reference, default public mapping, and a small bounded attribute sample.

`action: "pause"` supplies a request UUID and the active capture UUID. It asks the existing native continuation to stop while retaining its progress. Pause remains available while a continuation is running; the adapter does not serialize a long capture behind an unrelated browser listener operation.

## Review a mapping and select an edition

A complete capture is the source of an immutable edition. Use `merchant_arcgis_edition` with `action: "create"`, the actual capture UUID and its reviewed SHA-256:

```json
{
  "workspace": "field-data",
  "workbenchId": "WORKBENCH_UUID",
  "action": "create",
  "requestId": "EDITION_REQUEST_UUID",
  "captureId": "COMPLETE_CAPTURE_UUID",
  "expectedCaptureSha256": "REVIEWED_CAPTURE_SHA256",
  "title": "Reviewed public field mapping",
  "query": "records",
  "columns": {
    "object_id": {"field": "OBJECTID"},
    "geoid": {"field": "GEOID"},
    "attributes_json": {"source": "attributes"},
    "geometry_json": {"source": "geometry"},
    "spatial_reference_json": {"source": "spatialReference"}
  }
}
```

Use the actual object ID and source field names from capture inspection. The example keeps identifiers as their original string values and includes original Esri JSON. Geometry conversion and coordinate reprojection are separate receiving choices. Missing values retain their source meaning; the adapter does not replace missing measurements with zero.

Read the request to completion and inspect the edition. Then select it with `action: "select"`, its retained edition UUID, a selection request UUID and the exact current `expectedRevision` from workbench status. A stale revision is rejected by the original selection transaction.

Creating or selecting an edition does not extract or publish the dataset. The next stage uses the original publisher tools.

## Extract, inspect and publish through the existing publisher

Use the publisher alias returned by workspace open, for example `field-publisher`.

1. Call `merchant_publisher_source`. Retain the exact selected source hash, named query and public projection.
2. Call `merchant_publisher_plan_save` with that hash, named query, explicit dataset column types and extraction order/limits. Copy the original source fields into the intended public types; string identifiers remain strings. Allow enough cell bytes for any intentionally retained geometry JSON.
3. Call `merchant_publisher_extract` with its saved plan ID, plan digest and a client-retained run UUID.
4. Read the same run with `merchant_publisher_inspect`. Check the candidate's actual rows, types, selection and digest.
5. Use `merchant_publisher_target` to read the current target. Review the exact candidate with `merchant_publisher_review`, naming the responsible reviewer and note and binding the current snapshot/revision. Initialization is the native absent-target case.
6. Publish with the original run UUID and returned review UUID through `merchant_publisher_publish`.

The publisher's source-selection and extraction operations exclude conflicting native work. Its saved plans, candidate rows, reviews, target revisions and history remain visible in the browser. After an uncertain publication, use the existing run's inspect and recover tools before deciding whether another publication is necessary.

Scheduled refreshes use the same publisher and the same scheduler object. Save, enable, pause, run or continue a policy through the existing `merchant_publisher_schedule*` tools. Opening the borrowed ArcGIS browser does not start another timer.

## Export and stage a complete receiving package

Upload the host-declared reviewed seller configuration. For an already published run, use `merchant_arcgis_deployment`:

```json
{
  "workspace": "field-data",
  "workbenchId": "WORKBENCH_UUID",
  "action": "export",
  "requestId": "DEPLOYMENT_REQUEST_UUID",
  "runId": "PUBLISHED_RUN_UUID",
  "sellerUploadId": "SELLER_UPLOAD_UUID",
  "label": "Reviewed field dataset delivery"
}
```

Inspect the original request and deployment. The native exporter retains its CSV, dataset/seller/source definitions, binding and GIS receiving declaration in one package adjacent to the original publisher directory.

Stage that retained deployment using `action: "stage"`, its original deployment UUID, a new request UUID and the desired release ID. Optional label changes its display label. The operation uses the host's release store and runtime, then retains the original release-specific receiving declaration.

Read `action: "inspect"` to obtain the native package inspection and exact available filenames, byte counts and SHA-256 values. A staged package exposes:

| File | Role |
| --- | --- |
| `dataset.csv` | Original published dataset bytes. |
| `dataset.json` | Native dataset schema and serving limits. |
| `seller.json` | Reviewed seller definition. |
| `source.json` | Original capture and public field provenance. |
| `binding.json` | Native dataset resource binding. |
| `arcgis-receiving.json` | GIS receiving declaration for the exported package. |
| `release-receiving.json` | Receiving declaration bound to the staged release. |

Export and staging do not start a merchant, issue a payment or create a second dataset capture. Open the existing release controls with `merchant_arcgis_release_console` and a retained request UUID to select, start, restart, drain or roll back the actual release through its native controller. The live capability URL is returned only by the current owner; it is not saved in the request journal.

## Deliver complete original files

Use `merchant_arcgis_file` with the workspace, workbenchId, deployment UUID and an inspected filename. Supply the known expected SHA-256 on the first call when available.

The result returns `file` metadata, `readId`, base64 bytes, current offset and `nextOffset`. Append decoded bytes in order. If nextOffset is nonnull, repeat the same selection with the returned readId, expectedSha256 and nextOffset. The first call verifies the original file; subsequent chunks reuse its immutable snapshot. The final chunk releases the snapshot.

Each workbench allows at most four open read snapshots and 256,000,000 aggregate snapshot bytes. Chunks can contain up to 196,608 bytes. Snapshots idle for two minutes expire. Files over the snapshot limit can be streamed through the native workbench's download route. Use `merchant_arcgis_file_release` to end an unfinished read early.

A read that expired, completed or was explicitly released can resume by omitting readId and sending the same expectedSha256 plus desired offset. That opens and verifies the original file again. A changed original file is rejected. Nothing silently substitutes a newer deployment's bytes.

## Browser and shutdown ownership

`merchant_arcgis_browser` with `action: "open"` returns the original industrial workbench URL. Port zero selects an available local port. Repeating open returns the same listener; choosing a different fixed port requires closing the current listener first.

| Action | What closes | What remains |
| --- | --- | --- |
| ArcGIS browser close | HTTP listener and in-flight response streams | Same workbench, publisher, scheduler and retained data. |
| `merchant_arcgis_close` with current instanceId | Browser, retained file snapshots and workbench model; active source work drains through its native cancellation | Merchant-owned publisher and its single scheduler; original saved state. |
| `merchant_publisher_close` with publisherInstanceId | Native scheduler, all accepted borrowed work, child workbench resources, then publisher | Saved source, requests, plans, runs, releases and history, available on reopen. |
| Merchant operator shutdown | Every adapter drains, then its remaining owners close | Original durable workspaces and final operation results. |

A workspace reopen creates a new process instance while retaining the original workbench ID and data. Read status before continuing a saved operation. Browser controls and MCP methods use the same original workbench object while both are open.

## Request recovery

Every native ArcGIS mutation has a caller-retained UUID and exact original input. Read it with `merchant_arcgis_request`:

| Native state | Continue this operation |
| --- | --- |
| `RUNNING` | Follow that request or pause its original capture continuation. |
| `SUCCEEDED` | Consume its retained result. Resending identical input returns it without another native operation. |
| `PAUSED` or `INTERRUPTED` | Inspect the same source and explicitly resend the original operation UUID and input to continue it. |
| `FAILED` | Read the original error, correct its actual dependency, then continue identical input if appropriate. A changed request requires a new UUID. |

Reusing a UUID for a different input is rejected by the original request journal. Selection compares the current source revision; edition creation compares the capture hash; upload compares the actual input bytes; publication compares the reviewed candidate and target; file delivery compares the original exported bytes. These checks are the native transaction boundaries that make interrupted work resumable.

