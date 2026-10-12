# GIS migration workspace

A complete local workspace for moving approved vector exports into native data and usable QGIS maps. The operator retains the original source, every explicit mapping decision, corrected editions, native projects, publication files and the complete application used for delivery.

The migration module composes the maintained vector and QGIS engines in the adjacent directories. Its records use the original QGIS workspace database, revision journal, saved operations and complete archive. The browser, command line and independent receiver all open that same workspace.

## Start the operator

Keep the complete `stac/` source tree together. Select the existing Python environments that provide the required native drivers. The QGIS receiving guide describes the supported QGIS runtime and actual provider checks.

```bash
python3 -B stellar/scf-starforge-20261009/sf30-seller-sdk/stac/migration/server.py \
  --workspace /private/migration-workspace \
  --create --title "Approved data migration" \
  --python /absolute/path/to/python \
  --vector-python /absolute/path/to/fiona-python \
  --qgis-python /absolute/path/to/qgis-python \
  --exports /private/migration-exports
```

Open the local address printed by the process. Its access fragment establishes the session in that browser. The operator binds to `127.0.0.1`; the default port is 8917. Use `--port` for an existing local port assignment. Reopen the same workspace with the same command; `--create` also safely opens an existing original workspace.

The three Python options may identify the same installed environment. Vector capture and generation use the selected Fiona/GDAL environment. Project construction, publication and native receiving use the selected QGIS environment. Ordinary source, mapping and history reads use the main Python. The Overview page reports the actual installed native providers when requested.

## Operate the complete migration

### Source intake and full records

Choose the approved source selection JSON from the original vector workflow, then supply its local source root. The selection binds the complete input files, their sizes and hashes, original layer selection and row identities. The Sources page retains the imported original JSON bytes, including a UTF-8 BOM, alongside the editable selection.

A retained native capture can also be received by its directory and complete manifest SHA-256. Both routes use the original vector capture reader. Saved captures contain every selected feature and its original geometry, fields, nested values and numeric representations.

Select a saved source and layer to page through all records. The displayed original record JSON and original identity remain available for each row. Choose two different saved captures to create a complete comparison using the original source comparison engine; all comparison rows and their complete detail stay accessible through pagination.

### Mapping and destination choices

Create a mapping draft from the selected source. Every selected source layer and field must have an explicit destination entry. The draft includes:

- Destination table and field names, with the original driver's reserved-name rules.
- Each field's representation: automatic native selection, an explicit native type, exact JSON text or a retained reference.
- Null policies and destination keys, including how null values participate in key equality.
- Geometry null policy, observed or assigned source CRS, and selected target CRS.
- Output formats, proposed PostGIS schema and complete native project definitions.
- Notes and decisions for any changed source layers, fields, keys or project selections.

The editor keeps every field even when the current page shows a subset. It retains drafts in the browser across navigation and reload. An imported editable plan keeps its complete original bytes as well as later edits. A malformed imported file remains downloadable while the operator corrects the input.

Save the plan to inspect the full source constraint result. Each issue retains its source position, original row identity and complete detail. Filter and page the complete issue index; the plan's issue count covers the full selected source. Correct the relevant choice and save a new plan. Each plan is immutable and identified by its exact normalized content.

Keys follow the destination representation selected for their fields. The review detects values that collapse to the same native key, including numeric zero representations. Required, non-null and preserved-null choices remain explicit. The source retains exact values independently of its native representation.

### Reviews and native data

Record an accepted or changes-requested review with the operator's note. Review records identify their original saved plan and exact source document.

Build the selected valid plan through the actual native vector provider. The original export engine writes and reopens the requested data, checking its native layers, features, fields, geometry, CRS and complete sidecars. Each generated edition retains the full original output manifest and the actual receiving result.

The edition also contains `postgis-handover.json`: the selected schema, actual GeoPackage tables, fields, geometry, CRS, row counts and key decisions. Its source is the retained native GeoPackage, ready for the selected destination import workflow. Destination connection settings belong to that deployment.

### QGIS projects and resources

Each project definition selects exact original source-layer IDs and the saved project CRS. A definition may specify visibility, opacity, subset expression, CRS override, a retained QML style and its complete local resource descriptors.

Build the maps from the chosen native edition. The original QGIS engine imports the complete native output, resolves each selected source/layer/table identity, captures native styles and resources, writes the QGZ with relative paths, and reopens every saved map. A project build retains its original subrequests and committed revisions across interruption.

The definition's title is the delivery label. The native QGZ retains the original workspace title. Each delivery records that title policy together with the native input, selected CRS, exact project file and source identities.

See [Complete projects and receiving](RECEIVING.md) for the full Python interface and original project lifecycle.

### Map publication

Map publication opens the same saved native projects. It selects the actual drawing layers, project extent or explicit extent, page size and orientation, resolution, attribution, legend and scale bar. A corrected publication selects its original predecessor and records the exact comparison and reason for the change.

The complete publication includes editable QGZ and QPT files, PDF, PNG, the saved publication plan and the full native result. Preview images are loaded from their declared workspace file and checked against its complete byte count and SHA-256.

The publication panel keeps its draft and the original request identity. A retained output-ready operation can finish its original completion step after reopening. Native source, project, layer, style and output identities stay bound to that operation.

See [Native publication](CARTOGRAPHY.md) and [Publication operator](CARTOGRAPHY_BROWSER.md) for the source-selected controls, rendering and independent reopen workflow.

### Corrected editions

Start a new draft with the chosen predecessor plan and the corrected source capture. Existing stable layer and field choices are carried forward. Added or removed fields, invalidated keys and changed project selections become visible decisions. Complete those decisions and save the successor.

A mapping-only correction can use the same original source and a predecessor plan. A source correction selects its own retained source capture. The saved history distinguishes these cases through their actual source IDs. Earlier sources, plans, outputs, maps and publications remain available.

### Complete handover and onward receiving

Choose the current workspace revision and export the full archive outside the active workspace. The archive includes the original source, full mapping and constraint review, every native edition, QGIS project, style resource, publication, event and saved request, plus the selected complete application source.

The export result provides the exact archive identity. Receive that archive into a separate private directory using its SHA-256. The original receiver verifies every member and restores the same original workspace and history. Native receiving then reopens the saved maps and publications through the selected QGIS installation.

The independent receiving helper runs from the application included in the received archive. It verifies its own source and loaded migration/vector/QGIS/publication modules against the retained `softwareId`. It can export the complete received workspace onward and reopen that second delivery with the same source and project identities.

Use [the original complete receiving journey](RECEIVING.md#complete-native-receiving-journey) for its configuration, independent process and moved-host continuation. The executable entrypoint is `examples/receiving_journey.py`.

## Saved requests and recovery

The browser writes the full command, payload, workspace ID, operator, original revision and request ID to IndexedDB before dispatch. Saved requests and recovery shows the original input, actual returned result or error, and an exact-resume action.

The original workspace checks a repeated request's identity before its current revision. A response lost after a committed write therefore reopens that same operation. A changed command or payload under the same request ID remains a conflict. Starting a new operation uses the current observed revision.

The publication component can supply its original `revision`, `requestId` and `actor` on continuation; the shell preserves them. A later result from the same operation retains its previous returned result in the browser journal. A transient server or process interruption leaves the original request available.

Native operations that span several original writes retain their own contiguous subrequest history. Reopen the original operation after an interruption. If an unrelated workspace edit changed the next expected revision, the returned source result identifies that conflict so the operator can choose the intended continuation.

The local server tracks and drains the native process groups it starts. On shutdown it stops its admitted children before releasing the operator. Source files, saved inputs and original workspace checkpoints remain on disk.

## Command-line interface

All commands use one complete JSON request:

```json
{
  "command": "save-plan",
  "payload": {
    "plan": {"schema": "starforge.gis-migration-plan.v1"},
    "revision": 7,
    "requestId": "migration-original-plan-request",
    "actor": "Delivery operator"
  }
}
```

The abbreviated plan above identifies the envelope; use the complete editable plan returned by `draft`.

```bash
/absolute/path/to/selected-python -B stac/migration/engine.py \
  --workspace /private/migration-workspace \
  --input /private/requests/original-request.json \
  --output /private/results/original-result.json \
  --progress
```

The optional output file is written atomically. Standard output ends with `MIGRATION_RESULT_JSON ` followed by the complete original JSON envelope. Native progress and provider output remain on standard error. Successful envelopes are `{"ok":true,"result":...}`; returned failures preserve their error code, message and details.

For a new workspace, use `create` with `{"title":"Approved data migration"}`. Subsequent read commands require the existing workspace. Preserve the complete original request file for a repeat invocation.

### Source, mapping and delivery commands

| Command | Payload |
| --- | --- |
| `state` | `{}` |
| `records` | `kind`, optional `offset`, `limit` |
| `document` | `kind`, `id` |
| `draft` | `captureId`, optional `predecessorPlanId` |
| `source-rows` | `captureId`, `layerId`, optional `offset`, `limit` |
| `issues` | `planId`, optional `offset`, `limit`, `layerId`, `kind` |
| `comparison-rows` | `comparisonId`, optional `offset`, `limit`, `layerId`, `status` |
| `history` | Optional `offset`, `limit` |
| `operation` | Original `requestId` |
| `files` | Exact `path`, or optional `query`, `offset`, `limit` |
| `native-info`, `qgis-info` | `{}` |
| `capture` | `selection`, `sourceRoot`, optional `originalBase64`, plus write identity |
| `receive-capture` | `directory`, `expectedManifestSha256`, plus write identity |
| `save-plan` | Complete `plan`, optional `originalBase64`, plus write identity |
| `review-plan` | `planId`, `outcome`, `note`, plus write identity |
| `compare-captures` | `beforeCaptureId`, `afterCaptureId`, plus write identity |
| `build-edition` | `planId`, plus write identity |
| `build-projects` | `editionId`, plus write identity |
| `export` | `destination`, `revision`, optional `expectedSha256`; the browser supplies its retained request and server-owned archive destination |
| `receive` | `archive`, `destination`, `expectedSha256`, optional `nativeReopen` |
| `verify` | `{}` |
| `native-reopen` | `{}` |

Write identity means the original `revision`, `requestId` and `actor`. Record collections are `captures`, `plans`, `editions`, `projectDeliveries`, `reviews`, `inputs`, `software` and `comparisons`. Pagination defaults to 50 rows, with a maximum of 100.

### Publication commands

| Command | Payload |
| --- | --- |
| `cartography.inventory` | `{}` |
| `cartography.preview` | Complete `spec` |
| `cartography.save-plan` | Complete `spec`, plus write identity |
| `cartography.publish` | `planId`, plus the original write identity |
| `cartography.operation` | Original `requestId` |
| `cartography.publication` | `publicationId` |
| `cartography.download` | `publicationId`, `kind`: qgz, qpt, pdf, png, plan or receipt |
| `cartography.reopen` | Optional `publicationId` |

The same commands are available through the authenticated local `POST /api` envelope. The publication component composes the main `api`, durable `mutate`, checked `download` and workspace selection callbacks.

## Source and numeric custody

Original JSON uses the vector engine's exact parser and canonical serializer. Unsafe integers and non-integral JSON numbers retain their original representation through browser import, native capture, saved mapping and source sidecars. Native display controls use the explicitly selected QGIS numeric types. The source values and conversion decisions remain retained separately.

The complete program manifest is `source-files.json`. Each saved application edition has its full source bytes and descriptors under `migration/software/<softwareId>/stac/`. Its row's `path` already names that `stac/` directory. Plans, editions and deliveries identify the selected software. Independent receiving verifies the selected row and loaded modules; several retained editions can be selected explicitly by software ID.

The original `qgis/` and `vector/` modules retain ownership of native conversion, project/provider behavior, portable archives and their own source checks. This additive module owns the migration decisions, complete operator and their integration. Read [the vector guide](../vector/README.md), [QGIS operations](../qgis/OPERATIONS.md), and [native vector receiving](../qgis/VECTOR_RECEIVING.md) with the delivery's selected source.

## File layout

- `workspace.py` composes migration records with the original workspace journal and complete files.
- `plan.py` normalizes explicit mappings and evaluates complete source constraints.
- `engine.py` provides the exact native request/result entrypoint.
- `server.py` and `public/` provide the local operator and saved browser requests.
- `receiving.py` and its original journey create, receive and independently reopen the complete maps.
- `cartography.py`, `cartography_native.py` and the publication panel create and reopen the native publication.
- `native.py` selects the paired original source and freezes the complete application file closure.
