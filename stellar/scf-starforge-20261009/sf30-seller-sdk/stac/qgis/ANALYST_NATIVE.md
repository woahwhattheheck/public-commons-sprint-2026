# Original QGIS analyst receiving

This continuation opens a saved native QGIS project, operates it in the analyst browser, exports its complete editable workspace, and receives that workspace into a separate directory. It uses the original QGIS engine, original request journal and existing Applications lifecycle. The selected project supplies the data, native map and original source editions.

Run it after the original QGIS source receiving and map operation has produced an actual saved project. Keep its source workspace, source edition, native runtime and operation ID. The continuation reads the selected map; it does not generate a replacement dataset.

The everyday operator workflow is in [ANALYST.md](ANALYST.md). The native field-round producer and its existing device return are documented in [FIELD_OPERATIONS.md](FIELD_OPERATIONS.md). This document describes the installed end-to-end receiving command and the files the receiving operator keeps.

## What the continuation does

The driver uses the original installed `analyst.mjs` listener, or the installed Applications model when a manager and READY runtime are selected. It opens the real browser against the authenticated loopback listener and performs this sequence:

1. Opens the original Sources, Layers, Editions, Field and History panes with the existing workspace and responsible analyst.
2. Selects an existing saved native project, reopens it through QGIS, renders its visible map, and reads a native vector feature page when the map contains a vector or footprint layer.
3. Downloads the exact generated PNG and, when a field round is selected, its complete original device ZIP.
4. Exports the whole original project, including source editions, map files, QML and style resources, field rounds, original domain history, analyst requests and complete installed software.
5. Stops the original application, starts the same saved application again, and reopens the retained render request with the same input and result.
6. Uploads that complete ZIP through the browser's resumable upload, receives it into a separate project directory, and opens the received original workspace.
7. Compares the received domain snapshot and every original analyst request, reopens the native map, renders it again, and captures the actual desktop and mobile operator panes.
8. Closes the owned browser and the original application through its existing Stop path. The final result is written after those closures.

The map is rendered by `QgsMapRendererParallelJob`. Layer opening, provider identity, selected vector sublayer, filter, project CRS and native saved-map verification remain the original QGIS implementation. A live PostGIS layer uses the selected existing database connection and the original native check; its receiving package carries the accepted relation definitions and references.

## Select the original input

Use a UTF-8 JSON file with schema `starforge.stac-qgis-analyst-native-receiving.v1`. All paths are absolute paths on the selected equipped host. The example below illustrates the field names; replace the paths and project ID with the actual original producer's retained output.

```json
{
  "schema": "starforge.stac-qgis-analyst-native-receiving.v1",
  "operationId": "original-qgis-receiving-operation",
  "workspaceDirectory": "/work/original-qgis-project",
  "outputRoot": "/work/analyst-receiving-continuation",
  "pythonExecutable": "/existing/operator-python",
  "nativeRuntimeFile": "/private/original-qgis-runtime.json",
  "playwrightModule": "/existing/playwright/index.mjs",
  "browserExecutable": "/existing/chrome-headless-shell",
  "actor": "Receiving analyst",
  "projectId": "original-saved-project-id",
  "timeoutMs": 600000
}
```

| Field | Meaning |
| --- | --- |
| `operationId` | The existing receiving operation ID, retained across retries. |
| `workspaceDirectory` | An original private `QgisWorkspace` with its `workspace.sqlite`, complete retained files and at least one saved native project. |
| `outputRoot` | A separate canonical private directory for this continuation, its retained inputs, browser profile, transfer and results. It must be outside the source workspace, and cannot be its parent. |
| `pythonExecutable` | The existing Python 3.11+ used for the operator listener and original workspace reader. |
| `nativeRuntimeFile` | The original private native runtime selection used by the QGIS worker. Its exact bytes are bound to the continuation. |
| `playwrightModule` | The existing Playwright ESM module on that host. |
| `browserExecutable` | The existing Chromium or Chrome headless executable. |
| `actor` | Responsible analyst displayed in the browser and retained on the original actions. |
| `projectId` | Optional explicit saved map ID. When omitted, the first invocation selects the latest original saved project and retains that selection for continuation. |
| `featureLayerId` | Optional existing vector layer ID from the selected saved map. When omitted, its first vector or footprint layer is used. |
| `fieldRoundId` | Optional original field round whose exact device ZIP should be downloaded. |
| `environmentFile` | Optional original private environment JSON for the existing QGIS profile, auth store and libpq environment. |
| `managerDirectory`, `runtimeDirectory` | Optional pair selecting the existing Applications manager and READY installed runtime. |
| `timeoutMs` | Maximum wait for one retained phase, from 60,000 to 3,600,000 milliseconds. Default: 600,000. |

The native runtime JSON is the original QField/QGIS contract, such as:

```json
{
  "native_command": ["/existing/qgis-python"],
  "qfieldsync_path": "/existing/qfieldsync",
  "prefix_path": "/existing/qgis-prefix"
}
```

Include only the optional paths required by that existing installation. The driver and analyst preserve the selected host environment. The optional `environmentFile` is the same private JSON object accepted by Applications: environment variable names mapped to strings. It is inherited only by the selected original listener and native worker. Its exact file hash is retained; its values are not copied into the project.

A selected `authConfigId` refers to the existing QGIS authentication store. Preserve the existing `QGIS_CUSTOM_CONFIG_PATH` or `QGIS_AUTH_DB_DIR_PATH`, plus the original libpq service lookup when those are in use. The project software does not create another auth database. Use the original PostGIS native check to reopen the accepted connection on the receiving host.

Keep both the runtime JSON and optional environment JSON private, with no group or other permissions. The original workspace, output directory and listener connection are private too. Executable symlinks are resolved to their actual existing targets.

## Installed and direct commands

Run the installed command from the complete prepared release:

```sh
starforge stac-qgis-analyst-receiving /absolute/original-analyst-handoff.json
```

The same driver is directly callable from a source checkout or a complete received project's software directory:

```sh
node /absolute/qgis/analyst-native-receiving.mjs /absolute/original-analyst-handoff.json
```

The ESM entry exports `receiveQgisAnalyst(input, {signal, onProgress})` and the standard installed `main(argv)` / `run(argv)` functions. Progress records contain the original operation ID and current phase. A successful final line contains the saved result pathname, workspace ID and captured revision.

The source-only command needs Node, the existing operator Python, Playwright and Chromium. Its native map actions use the QGIS command already selected in the original runtime JSON. Field project reopening also uses its original QField dependencies. The optional Applications mode additionally needs the complete installed distribution and its existing manager/runtime modules.

### Original Applications mode

Provide `managerDirectory` and `runtimeDirectory` together. The driver attaches the selected READY runtime to that manager, reads the installed `stac-qgis-analyst` provider, and uses its native Review, Save, Connect, Start, Recover and Stop methods.

The original and received workspaces have distinct saved application entries. Their application IDs, review IDs and start request IDs remain in the continuation record. A stopped run is closed before another start review is created. An inactive interrupted run is reconciled through the original Recover operation; a surviving command is closed through Stop before a replacement start is recorded.

Use the same complete installed release for the original and received analyst. The restored project's exported software is separately complete and can be opened through its own direct `analyst.mjs` entry. Direct mode exercises that restored software in this continuation.

### Direct mode

Omit both manager fields. The driver starts the original Node/Python listener with its exact inspected binding, and verifies its authenticated startup identity against the selected workspace and complete source. It retains the private connection file within the operation output and controls only that original instance.

On restart, an existing matching live listener is reused. If its connection is unresolved while the saved process is still alive, the same receiving operation retains that state for reconciliation. The original listener's own workspace lock remains authoritative.

## Continue the same operation

Invoke the same JSON with the same `outputRoot`. Do this after a carrier interruption, a browser closure or an original runtime recovery. The original operation record binds the selected paths, runtime and environment file hashes, and exact driver source.

The driver retains each browser action body to `actions/<phase>.json` before the browser sends it. It records the original request ID, original revision, actor and payload. Once a request exists in the workspace, it reopens that ID. If the original request is absent after a transport loss, it submits those same bytes. If the selected original worker ended in a resumable state, it continues that original request with its input SHA.

The driver does not issue a new source import to repair an uncertain native action. Original worker progress, retained result files and operation errors remain in the workspace. An unresolved native request stays visible in History and is resumed on its selected host.

The exported ZIP is frozen by its original export request. Later receiving work does not replace the original captured snapshot. Re-entering a partially completed independent receiving step compares every original request and domain record; extra analyst requests are accepted only when they belong to this continuation's already retained receiving actions.

The browser profile and upload state are private local operating files. A partial upload continues against its existing manifest and exact byte ranges. The original server verifies the complete file hash before exposing the file for receiving.

Changes to the original runtime file, environment file or driver source require an explicit new reviewed continuation selection. Preserve the existing record and any active native work while integrating such a source correction.

## Result and file handover

The final result is `analyst-native-result.json`, schema `starforge.stac-qgis-analyst-native-result.v1`. The live record is `analyst-native-record.json`. Both identify the original workspace, selected native project, captured revision, original request IDs, native results and exact artifact hashes.

| Output | Receiving use |
| --- | --- |
| `artifacts/complete-original-project.zip` | Complete editable project and source handover, with its original hash. |
| `received-project/` | Independently received workspace, native files, history and complete software. |
| `artifacts/native-original-map.png` | Actual QGIS-rendered original map. |
| `artifacts/original-field-package.zip` | Exact original field package when a field round was selected. |
| `artifacts/original-*.png` | Desktop views of the original operator workflow. |
| `artifacts/reopened-native-map.png` | Same original map after application Stop and reopen. |
| `artifacts/received-*.png` | Received project desktop and mobile operator views. |
| `actions/*.json` | Exact original browser action bodies for continuation. |
| `original-exports/` | Original native export output, referenced by its saved workspace request. |

The received project keeps original source and domain identities while its directory changes. It includes the source reader, QGIS native engine integration, field round modules, PostGIS adapter, analyst server/browser, this driver and both receiving guides. The exported source does not include an installed QGIS binary or host credentials.

The final result records source edition IDs and actual native readbacks. Map transfer verifies full response size and SHA-256. Each original retained history member and its file closure is checked by the original receiving implementation before the new workspace is published.

Retain the result JSON, complete project ZIP and the selected actual screenshots through the existing host's artifact retention before a private working namespace ends. Keep the completed original source workspace or its complete final archive under its existing owner. Browser profiles, listener URLs, private environment files and auth stores remain with the selected host.

## Use with the existing source producer

For a source operation already producing `qgis-receiving.json`, use its complete original receiving directory in the original QGIS workspace workflow, save the actual native map, then pass that workspace to this continuation.

For a source-native vector producer, use its actual complete `vector-export.json` directory or its original independently received vector package. Its GeoPackage, Shapefile members, selection, source edition and feature identity remain under that producer's original receiving contract. A raw GeoJSON file and manifest become a vector export only when the original vector producer has performed that operation.

For a PostGIS receiving source, use the actual `postgis-receiving.json`, accepted relation catalog, role and selected local connection through the original database-layer workflow. Keep complete captured metadata and native check history in the same QGIS project. Distinguish the accepted database reference from a copied vector dataset.

For QField, select the original field round and saved native project produced by the original field receiving flow. That flow owns instrument commissioning, device packaging, partial returns, relation validation, reconciliation and later rounds. This continuation opens and transfers those same retained objects in the browser.

All these inputs use the original `QgisWorkspace` journal and complete receiving package. The analyst provides the common operator surface, native map view, history and handover around them.
