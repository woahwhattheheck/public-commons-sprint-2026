# QGIS analyst workspace

The analyst console operates the original QGIS project workspace from a browser. It keeps received source editions, layer choices, native maps, field campaigns, review decisions and complete project handovers together. The same project can also be opened through the original desktop plugin and installed command line.

Use **Sources → Layers → Maps** for a first map, **Editions** for a later source, **Field** for a device collection and office return, and **Transfers** for complete receiving. **History** reopens the original project events and submitted operations.

## Open the existing project

### Applications

In the installed Applications workspace, select **QGIS analyst workspace** and enter:

| Setting | What to select |
| --- | --- |
| Original QGIS workspace | The absolute private directory initialized or received by the original QGIS application. It contains `workspace.sqlite`. |
| Existing operator Python | An existing absolute Python 3.11 or later executable on the POSIX host. |
| Private native QGIS runtime JSON | The optional existing native Python/QGIS command and its required QFieldSync or QGIS prefix paths. Select it for native map and field operations. |
| Private connection file | An optional separate private file in which the listener retains its current connection. The default is inside the original workspace. |

Review the selection, save it, then use the original **Start** and **Open** controls. The application binds the selected source, existing executables, project identity and private workspace before opening the live listener. Use **Stop** to close that listener and its owned worker. A later Start reopens the same saved project.

The native runtime file uses the existing field bridge contract:

```json
{
  "native_command": ["/absolute/existing/qgis-python"],
  "qfieldsync_path": "/absolute/existing/QFieldSync",
  "prefix_path": "/absolute/existing/qgis-prefix"
}
```

Include the optional directories when that installed environment needs them. The command is a Python-compatible executable or existing wrapper that accepts Python options and a script path; fixed wrapper arguments may follow its executable in the array. The console uses that selected installation for original QGIS processing.

The workspace directory, its database and the selected runtime JSON must be private to the operating account. Keep the workspace outside the software directory. The managed listener uses the existing POSIX file locks and listens on `127.0.0.1`.

### Installed command or retained software

The installed command opens the same application:

```sh
starforge stac-qgis-analyst \
  --workspace /absolute/project-workspace \
  --python /absolute/existing/python3 \
  --native-runtime-file /absolute/private/native-runtime.json
```

The runtime file is optional for source review, saved layer choices, edition decisions and project receiving. Native map processing requires the selected QGIS installation.

From the repository, invoke `node stellar/scf-starforge-20261009/sf30-seller-sdk/stac/qgis/analyst.mjs` with the same options. A complete received project includes `software/analyst.mjs`; invoke that file to use its retained software. An installed desktop plugin includes the launcher inside its `starforge_stac` directory.

The listener prints one private connection record and retains it at `analyst/connection.json` by default. Open its `operatorUrl`. The URL fragment carries the local connection key, so pass the complete URL only to the operator of that project. Stop removes that listener's own connection file. `--port 0` selects an available local port; `--connection-file` selects a separate private connection file.

## Receive source editions

Open **Sources**. Use the complete original STAC receiving, vector export or supported PostGIS receiving directory produced by the maintained source tools. Keep its manifest and every declared file together. The relevant producer guides describe the source-specific acquisition and export; the analyst workspace consumes their retained results.

1. Enter **Original receiving directory on this host**, or select the complete folder with the source upload control.
2. Enter the producer's expected manifest SHA-256 when supplied.
3. Choose **Inspect original source**. Review the original source kind, manifest identity, scene or layer inventory, asset count and retained files.
4. Choose **Import this exact source** from the inspected result. Import binds the displayed manifest identity and copies the original source closure into the project.
5. In **Imported source register**, select the appropriate edition with **Make active**.

Folder upload preserves each selected relative path, byte count and original file content. Its progress belongs to the saved upload identity. If transfer is interrupted, reselect the same complete folder; the browser checks retained prefix bytes before appending the remainder. A completed upload supplies the host directory for inspection.

Import retains distinct source editions. Selecting an active source changes the working selection while keeping earlier editions available for comparison and existing maps.

Browse **Original scenes** and **Received asset inventory** with their page controls. For STAC, Collection and Item form the original scene identity. Source outcomes and metadata-only assets remain visible. Select a scene to inspect its assets, then use **Show all assets** to return to the complete inventory.

Use **Inspect in QGIS** for an actual retained asset when the native runtime is selected. The result identifies its native provider, available layers or sublayers, fields and coordinate system. Choose **Add this native layer** from that result, or add the retained raster/vector asset directly when its source already identifies the layer kind. STAC scene footprints can be added as their own layer.

Preserve source-specific identity and field meaning when building a map. A parcel identifier, assessment basis, observation date or dataset edition remains the producer's value. Choose any metric or owner classification through the applicable domain workflow before displaying it as a reviewed result.

## Use accepted PostGIS relations

A PostGIS source enters through its complete original `postgis-receiving.json` package. Inspect and import that source in **Sources**, then open its accepted database-layer inventory. The original adapter retains the source edition, relation identities, required roles and native field/geometry contract.

Choose a retained relation and select its existing local connection profile. The connection object uses `starforge.postgis-qgis-connection.v1`:

| Field | Original local selection |
| --- | --- |
| `profileId` | The selected connection profile's identity. |
| `service` | Its existing libpq service name. |
| `authConfigId` | Optional existing QGIS authentication reference, using its seven-character alphanumeric ID. |
| `role` | The actual intended database role. |
| `sslMode` | The reviewed SSL mode for that service. |
| `allowEditing` | The explicit editing selection supported by the accepted role and original adapter. |

Select the local service and role that correspond to the received contract. The native worker uses the selected existing QGIS profile and authentication-store environment, including existing `QGIS_AUTH_DB_DIR_PATH`, `QGIS_AUTH_PASSWORD_FILE` and libpq service configuration when needed. Configure that original environment through the privately reviewed Applications environment file, or the existing shell environment for standalone launch. The source binding retains the public connection references and reviewed settings; authentication databases and credentials stay in their existing local custody.

Run the original native database check for the selected source and relations. Review the actual relation, role, fields, geometry and connection outcome, then retain the chosen database layer in the project. The browser supports database layer selection and successor mapping through the same original workspace and analyst journal.

After selecting the intended layers, save the complete database layer selection and create its native map. Reopen that saved project and check the actual database-backed layers on the selected host. Preserve the received database relation contract and native readback alongside any retained local source exports.

For a later accepted database source, inspect/import the complete successor and review the relation mapping before changing the map. Earlier source contracts, selections and native projects remain in the original history.

On independent receiving, select the existing local service, role and QGIS authentication reference that are available on the receiving host, then run the native check again. The complete project carries its accepted source/relationship contracts, saved layer and map definitions, original decisions and software; the native database connection resolves through that host's existing authorized service.

The added original actions are:

| Action | Complete input |
| --- | --- |
| `postgis.select` | `sourceId`, original `layerId`, complete `connection`, and optional `label`. |
| `postgis.check` | `sourceId`, selected `layerIds` and complete `connection`. |
| `postgis.layers` | The complete reviewed database `layers` list. |

Page the accepted relation inventory with `GET /api/database-layers?sourceId=SOURCE_ID&offset=0&limit=50`. The existing operation envelope, actor, original revision and same-request continuation apply to these actions.

## Edit the complete layer selection

Open **Layers**. The browser shows an editable draft beside the revision at which it was opened.

Each retained layer has an original source edition, stable layer ID, kind and label. Adjust visibility, opacity and ordering as needed. **Remove from draft** removes that map selection while retaining its source edition and prior project history.

For a vector asset, keep the exact native sublayer and any intended provider subset expression. For a raster, select the original renderer or explicit grayscale/RGB band numbers. A CRS override is an explicit selection for that native asset. Existing native styles display their retained style file and dependencies.

Choose **Save complete layer selection** to save the entire reviewed list. If the workspace advanced after the draft was opened, export the draft, reload the saved selection, review the intervening work and reapply the intended changes at the current revision. The original compare-and-swap revision prevents an older draft from silently replacing a newer selection.

After saving, choose **Save current workspace as a native QGIS map**. An optional **Project CRS** selects the desired project coordinate system. QGIS reads the original files, provider, selected sublayers, filters, fields and styles, then retains a new native project edition. Existing saved map editions remain available.

For additional desktop style editing and the exact source-specific layer options, use the original [operator guide](OPERATIONS.md) and [vector receiving guide](VECTOR_RECEIVING.md). Save those changes through the original workspace so the style and required resources become part of its receiving closure.

## Work with native maps and features

Open **Maps** and choose a saved native project.

- **Reopen and verify native map** reopens that actual QGZ and its retained original source bindings.
- **Render full map** asks QGIS to render the saved project and retains the image, actual visible extent, project CRS and original readback.
- **Download original QGZ** downloads the saved native project file.

The map image supports zoom, directional movement and click-to-center. Each request renders another view of the same saved native project. The displayed extent comes from the completed native render.

Use **Native feature table** to choose an actual vector or footprint layer. **Read native features** returns the original native field names/types, feature IDs and values, including nulls. The optional current-map-extent selection filters the feature request to the displayed area. Continue with **Next features** while the page indicates more rows. The provider feature count and selected subset expression remain visible with the result.

Image dimensions range from 64 to 4,096 pixels per side, with a maximum of 8,388,608 pixels per render. The native rendering window is 120 seconds. If a render needs a smaller view, retain the original result/error and start a reviewed render with an appropriate extent or image size.

The QGZ download is useful for an installed QGIS desktop. Use the complete project ZIP in **Transfers** when handing over the source files, styles, decisions, history and receiving software with it.

## Review a later source edition

Import the later complete source first, then open **Editions**.

1. Select the earlier and later imported editions.
2. Choose **Compare original editions**. Review the source identities, comparison summary and paged scene/asset changes.
3. For every current layer using the earlier edition, choose **Keep earlier edition**, **Use later edition**, or **Remove layer**.
4. For an updated vector layer, review its exact successor sublayer and subset expression.
5. Record the reason for the decisions and choose **Retain complete edition review**.

The review is bound to the two original editions and the project revision seen when comparison began. Updating changed native bytes clears the prior style, band selection and CRS override so the successor can be reviewed on its actual source. A layer kept on the earlier edition remains explicitly attached to that source.

Review the resulting layer selection and save a new native map. Earlier source files, saved maps and the original review remain available in **Saved edition reviews** and **History**.

## Commission field collection and receive the office return

The **Field** pane uses the original QField workflow and its native QGIS/QFieldSync bridge. The complete [field operations guide](FIELD_OPERATIONS.md) describes the native device and field formats.

### Commission the saved map

Open **Open commissioning draft**, select the saved native project, and choose **Inspect actual native layers and relations**.

Set the field project title and instructions. Add the intended device profiles. For each editable native layer, select the read-only stable feature identity field, permitted editable fields, and explicit add/delete/geometry permissions. Configure labels, groups, required values and the supported text, multiline, choice, range, date, attachment or image widgets. When adding a new field, select its actual type.

Choice values are exact JSON scalars. Preserve the distinction between a number, boolean, string and null when mapping the original form. Keep attachment instructions with the field project.

Select read-only reference layers. For parent/child relations, retain every field pair of each original compound relation and its native association/composition strength. Review the complete definition and current project revision, then choose **Commission with original QGIS / QFieldSync**.

The commissioning draft can be exported and later loaded as a complete native definition. The saved campaign retains the actual office edition and reviewed instructions.

### Export and collect

Select the campaign and device profile, then choose **Export next original field round**. A campaign has one current exported/returned round before acceptance or explicit closure.

Download **Complete device package** or use **Make exact device copy** into a new device directory on the host. Extract the entire ZIP into a separate device folder. Open the original QField project, collect the intended changes, save, and close the device application before returning the whole saved folder.

### Receive and review

Choose the original field round. Select the complete saved device-return folder on the host or upload that whole folder through the browser.

1. Choose **Inventory saved return** and inspect its actual retained file identity.
2. Choose **Receive selected return into this round**. The operation binds the inventoried file set to the original round and base office edition.
3. Select the retained return and **Read reviewed changes**. Review added, changed, deleted and attachment records, or filter by issue/problem and original layer ID. Continue through the complete paged result.
4. Record the office acceptance note.
5. When the original return is ready, choose **Accept this reviewed return and create the next office map**.

Acceptance uses the exact reviewed return digest and the original native synchronization. The next office map and source history remain attached to the same campaign. A later field round starts from that accepted office edition.

When a round should end without acceptance, record the reason and use **Close original field round**. The previous round, return and review remain in history.

## Recover the same operation

Every submitted action receives a stable request ID, frozen input SHA-256, actor and project revision. Its attempts and completed result live in the original `workspace.sqlite` alongside the project.

| Displayed state | Operator action |
| --- | --- |
| READY | The request is retained. Open it and continue when the current worker is available. |
| RUNNING | Reopen the original request to observe its progress. The listener permits one owned worker for the workspace. |
| INTERRUPTED | Open the retained request, read its error/progress, and choose the same-request continuation when offered. |
| FAILED | Read the full original error. Continue the same input after resolving a transient condition, or review a new request if the intended input must change. |
| COMPLETED | Reopen the saved result and downloads. A repeated exact request returns that completed operation. |

Use **History → Saved analyst operations** or **Open an original request by ID**. The operation view shows the complete input, attempts, current status, retained result files and original error details.

A listener loss can leave a stored RUNNING row after its worker has ended. The current operation view shows INTERRUPTED when the original lock is free. Continue that saved request instead of creating another action from memory.

A source import, layer change, source selection, edition review, map save or field mutation still uses the original workspace's domain request/revision logic. If the domain mutation finished before the listener lost its final response, continuation recovers the original result. If another reviewed change advanced the workspace first, refresh and review a new action at that revision.

The native runtime is part of the frozen request. Reopen with the originally selected runtime to continue it. After a project is independently received at another host path, an unfinished action that refers to original host directories is displayed as **original host input**. Select the current original input or destination and submit a reviewed new action for that location. The received historical request stays intact.

Browser form drafts and submitted operations serve different purposes. **Download browser draft** preserves unsaved choices and remembered request IDs; reopen it only for the same project identity. The saved project journal remains the authority for submitted actions and actual results.

## Export, receive and reopen the complete project

In **Transfers**, choose **Export complete original project**. Select an archive directory outside the active workspace, or use the default deliveries directory beside it.

The complete archive includes:

- The original project state, domain events and request results from one SQLite snapshot.
- Imported source manifests and retained assets.
- Current and historical map editions, derived files, native styles and their required resources.
- Field campaigns, original device packages, received returns and referenced attachments.
- Analyst request history and retained result files.
- The original desktop, command-line, analyst and receiving software with its guides.

Finish the intended source import or field receiving before exporting their files as project content. Upload staging and unsaved browser choices can be resumed on the original host; the domain import/receiving attaches the intended files to the complete saved project.

Download the **Complete project ZIP** and retain its displayed SHA-256. The operation's archive identity includes the original workspace ID, revision, manifest digest, total decoded bytes and file count. The export command uses the original selected revision.

For independent receiving, select the entire original ZIP, its expected SHA-256 and a new directory separate from the current project. Choose **Receive complete original project**. The receiver verifies the complete archive inventory and each declared file, validates every original source/map/style/field/analyst reference, and publishes the received database through the original receiving path.

The result shows the same project identity and saved revision with the new directory and receiving receipt. Open that directory as a separate Applications selection or with its retained `software/analyst.mjs` and the host's existing Python/native runtime. The current listener remains attached to its original project.

On the received project, reopen the original sources, maps, field records and completed operation results. Create a fresh complete export there when another transport ZIP is needed. A historical export request retains its original archive identity; the new host chooses its own output directory.

**Download complete saved history** produces the project snapshot JSON for review. Choose the complete project ZIP to carry the referenced file bytes and receiving software as well.

## API and retained identities

The maintained contracts are [actions](analyst/actions.py), [listener routes](analyst/server.py), [upload intake](analyst/uploads.py), [request journal](starforge_stac/analyst_state.py) and the original [workspace receiving codec](starforge_stac/model.py).

The browser uses the same local listener API. The connection header is `X-Starforge-Qgis-Workspace`; retain it only in the private client for that listener. The authenticated browser session supports the original file downloads.

A submitted action has this envelope:

```json
{
  "requestId": "operator-selected-stable-request",
  "action": "source.import",
  "payload": {
    "directory": "/absolute/original-receiving",
    "expectedManifestSha256": "the-actual-64-character-manifest-sha256"
  },
  "revision": 4,
  "actor": "Responsible analyst"
}
```

Read the current project revision first. Use an actual original manifest digest in the request.

| Route | Purpose |
| --- | --- |
| `GET /api/state` | Current project, selected runtime capability and worker state. |
| `POST /api/operations` | Retain and start one complete action. |
| `GET /api/operations?offset=0&limit=50` | Page the original operation register. |
| `GET /api/operations/REQUEST_ID` | Reopen full original input, progress, attempts and result. |
| `POST /api/operations/REQUEST_ID/continue` | Continue with `{"inputSha256":"actual-original-digest"}`. |
| `GET /api/history` | Page the original domain history. |
| `GET /api/scenes`, `GET /api/assets` | Page the selected original source inventory. |
| `GET /api/compare?left=SHA&right=SHA` | Compare two imported editions. |
| `GET /api/database-layers?sourceId=SOURCE_ID` | Page accepted PostGIS relation contracts. |
| `POST /api/uploads` | Retain a complete source/project/field upload manifest. |
| `PUT /api/uploads/UPLOAD_ID/file?path=RELATIVE_PATH&offset=BYTE_OFFSET` | Transfer an exact byte chunk with `X-Content-SHA256`. |
| `GET /api/uploads/UPLOAD_ID` | Reopen actual retained upload offsets. |
| `POST /api/uploads/UPLOAD_ID/complete` | Validate the complete upload with an empty JSON object. |
| `GET /download/operations/REQUEST_ID/files/INDEX` | Download a retained operation result file. |
| `GET /download/operations/REQUEST_ID/project` | Download that host's completed original project export. |
| `GET /download/projects/PROJECT_ID` | Download the original saved QGZ. |
| `GET /download/field/ROUND_ID` | Download the complete original device package. |
| `GET /download/history` | Download the full saved project snapshot JSON. |

Ordinary record pages accept up to 100 rows. A page's `total` and `complete`, or native feature `hasMore`, determine continuation. Native feature values preserve nulls and expose original field types; non-null scalar display values remain text.

Action payloads follow the original methods:

| Action | Required selection |
| --- | --- |
| `source.inspect` | Original directory; optional expected manifest SHA-256. |
| `source.import` | Original directory and inspected manifest SHA-256. |
| `source.select` | Imported source ID. |
| `layers.save` | Complete reviewed layer list. |
| `edition.review` | Earlier/later source IDs, every affected layer decision and reason. |
| `map.inspect` | Source ID, original Item/asset and Collection when present. |
| `map.save` | Current saved layer selection; optional project CRS. |
| `map.reopen` | Saved project ID. |
| `map.render` | Saved project ID, image size and optional actual extent. |
| `map.features` | Saved project/layer IDs, page and optional extent. |
| `project.export` | Optional archive directory outside the workspace. |
| `project.receive` | Complete archive file, expected SHA-256 and new destination. |
| `field.command` | Original field action and its complete payload. |

The field action names are `field.state`, `field.inventory`, `field.copy`, `field.review`, `field.inspect`, `field.reopen`, `field.commission`, `field.export`, `field.receive`, `field.accept`, `field.close` and `field.note`. They delegate to the original field engine.

The JSON operation body is limited to 32 MiB. Upload chunks are at most 8 MiB; the complete upload manifest supports up to 100,000 original files and 1 TiB in total, subject to actual host capacity and the source/receiving codec's limits. Result downloads support original byte ranges and expose their SHA-256 and ETag. Keep the complete original returned metadata when automating an operation.

## Deliver an operator-ready project

Hand over the complete project ZIP with its SHA-256, a clear project/source edition selection, the intended map or field round, and the named review decisions. Include this guide and the original source-specific guides already carried by the archive.

The receiving operator selects their existing runtime, receives into a new directory, opens the same saved project identity, and continues from its original source and review history.
