# Starforge STAC QGIS receiving

This component turns an original verified Starforge STAC customer delivery into a native GIS project that another analyst can receive and reopen. It retains the original selected data, complete scene and Collection metadata, native customer records, map choices, styles, source editions, saved maps, and project history.

The desktop plugin uses an existing QGIS 3.40 or later installation, including its own Python, Qt, GDAL and projection libraries. The Starforge command prepares the original source and builds the plugin ZIP. The native plugin then operates the received local files.

## Prepare the original source and install

Use the complete original customer receiving directory that opens with the existing STAC customer receiver. It contains the native customer manifest, selected edition, dataset/native bindings, and original retained files.

~~~sh
starforge stac-qgis export --directory ORIGINAL_CUSTOMER_RECEIVING --out NEW_QGIS_SOURCE
starforge stac-qgis open --directory NEW_QGIS_SOURCE
starforge stac-qgis plugin --out starforge-stac-qgis.zip
~~~

The existing STAC command also accepts qgis-export, qgis-open, and qgis-plugin with the same flags.

The export calls the original StacDelivery.open, original verified copy, and original portable GIS exporter. It reopens that result through the original portable receiver before writing qgis-receiving.json. This final manifest binds every original and portable member by relative path, byte count and SHA-256. Its source identity keeps the original bundle, selection, edition, content snapshot, and native binding. The complete original source stays alongside the desktop projection.

In QGIS, open **Plugins → Manage and Install Plugins → Install from ZIP**, select the generated archive, and enable **Starforge STAC Receiving**. Open its toolbar action or **Plugins → Starforge STAC → Starforge STAC Receiving**. The plugin includes this guide.

## Create and receive a GIS workspace

Choose **Create project**, select a parent directory, and enter a new directory name. Enter the analyst name used in the project history.

Choose **Import original receiving** and select the exact qgis-receiving.json from the prepared source. The importer checks the complete member set and hashes every original file while copying it into the workspace. Each imported edition is immutable under sources/<receiving-manifest-SHA>. Repeating the same import request returns its retained result. An interrupted copy resumes the same content-addressed files.

**Open project** reopens its existing workspace.sqlite and retained files. **Receive archive** opens a complete project ZIP in a fresh directory or resumes the same unfinished receiving directory. Receiving checks archive members, lengths, hashes, original source identities, native map/style references and contiguous history before publishing its database.

Selecting an edition in the **Sources** tab changes which original scenes and assets the operator browses. Existing map layers retain their individually selected edition until the analyst changes them.

## Original scenes and assets

The **Scenes and layers** tab displays Collection/Item identities, original observation date or interval, source cloud-cover metadata, and asset counts. A blank field means that the source did not provide that value. **Scene metadata** opens the original complete Feature objects, including geometry, properties, assets, and source links.

The asset table retains original asset keys, media types, roles, outcomes, local byte counts, hashes, and source metadata. An asset without a retained local file remains visible with its original outcome and reason. Its remote href stays part of the original source record. A local thumbnail can be opened from its folder even when it has no geospatial CRS.

**Inspect native file** asks the installed QGIS providers to inspect the actual received file. Raster details include source CRS, extent, width, height, actual band numbers/types/names, source nodata, scale and offset. Vector details include native sublayers, geometry type, fields and feature count. A non-finite native numeric value is reported as its explicit NaN/Infinity string. It is never replaced with zero.

The original STAC metadata and the native file metadata are shown together. A CRS override is a recorded analyst choice; the plugin never assigns a geographic CRS to an unreferenced image from a thumbnail's scene footprint.

## Select and edit map layers

Use **All footprints** or **Selected footprints** to map the original scene geometry. The derived GeoJSON preserves those complete original Feature objects and their Collection/Item identities.

Use **Add selected asset** for an actually received local raster or vector. Choose the actual native vector sublayer when the file contains several layers. Raster bands may use the native default, one explicit gray band number, or three explicit R,G,B band numbers. Band numbers start at one and are checked against the actual provider. Direct local GDAL rasters and OGR vectors are supported. A container-specific raster subdataset needs its own original received asset; it is not substituted with an unrelated container member.

Set a label, opacity and visibility. A vector filter is an explicit native provider subset string; it is retained, reapplied and checked alongside the selected native sublayer. Use **Edit selected** to revise these choices, an explicit CRS override, bands or selected native sublayer. A changed native renderer/CRS/sublayer returns to its native display settings so an earlier incompatible custom style is not silently applied.

**Move up** and **Move down** retain the selected map order. **Remove selected** removes the layer choice and preserves its source editions and earlier saved maps.

**Apply to QGIS map** prepares the complete selected set, then replaces only the existing layers and group marked for this workspace. Other open QGIS layers remain under the user's normal project control. Footprints use a neutral outline; QGIS supplies its native raster renderer. Use **Zoom to layers**, the normal map canvas and native layer controls to inspect the data. Explicit raster band changes use QGIS's normal default contrast enhancement; its retained native QML records the resulting display.

## Native properties and styles

**Native layer properties** opens QGIS's existing layer-properties dialog. Use QGIS's normal symbology, labels, transparency and display controls. **Capture current styles** saves native QML styles, current layer labels, visibility, opacity and CRS into the workspace.

The capture checks that each open managed layer still uses its retained original asset and edition. Concrete local QML image/SVG resources are copied with hashes and rebased into the workspace. A missing local resource or an external style image needs to be received before the complete style can be retained. An SVG with external linked content needs its images embedded in that source SVG. QGIS's installed font availability remains part of the receiving environment; the project does not redistribute font software.

After capture, the original data files remain unchanged. Styles and resource files are retained separately, and saved map versions keep the style edition they used. Reapplying the current selection loads those native styles through QGIS and checks its actual success result.

## Review a later original edition

Import the later prepared receiving directory into the same workspace. In **Later edition**, choose the prior and later editions and select **Compare**.

The comparison uses exact original Collection/Item and Collection/Item/asset keys. It reports added, removed, changed and unchanged scenes. Asset review distinguishes original metadata/outcome changes from identical received bytes; different receipt timestamps alone do not make the imagery a different file. The original query objects are compared independently of the edition's content snapshot.

Choose one decision for every current map layer bound to the prior edition:

| Decision | Result |
| --- | --- |
| Keep | The layer keeps its prior source, file, native choices and retained style. |
| Update | The layer selects the same original identity in the later edition. A received later file must exist. |
| Remove | The layer leaves the current map selection; earlier source and map versions remain retained. |

An updated all-scenes footprint layer uses the later original scene set. An explicit scene subset keeps only its identities that remain in the later edition. An updated raster/vector with changed bytes resets its old band choices, CRS override and custom style for native inspection. Edit the layer before applying it when the new file requires a selected sublayer or a source CRS decision.

Enter a reason and choose **Apply reviewed decisions**. The complete comparison and prior definitions are retained in history. Apply the changed selection to QGIS, inspect the native result, and save another map version. Earlier saved maps continue to reference their original editions.

## Save and reopen native maps

In **Saved maps and receiving**, select an explicit project CRS if needed and choose **Save native map version**. With an empty CRS field, the saved project uses the first selected layer's valid native CRS.

The saver builds an independent QgsProject containing the retained managed layer selection. It writes a native QGZ with relative paths, checks QGIS's write result, reopens it, and verifies the original layer/file bindings before retaining the saved version. The map records its original input revision and layer definitions. This leaves the currently open desktop project available for normal user work.

A stable request and native-input.json bind a save across a lost response. If QGIS already wrote the map before the state commit, the same action reopens that original file and continues its existing revision. A completed request returns the original result. A conflicting revision is displayed for review.

Select a saved version and choose **Reopen selected map**. The reader verifies its native file, original source closure and styles, then opens the exact saved QGZ through QGIS's native project action. QGIS handles the existing save-current-project interaction. **Saved map details** shows the original native readback, source choices and hashes.

## Complete project handover

Choose **Export complete project** and a new ZIP filename outside the active workspace. The exporter takes one consistent SQLite read snapshot and streams the complete referenced file closure:

- Every imported original receiving edition, including original customer/native records and portable GIS files.
- All retained QGZ versions and their exact derived footprint/native-input files.
- Current and historical native styles and concrete local resources, including styles referenced only by earlier event/request history before a map was saved.
- Analyst source/layer/review state, all original history revisions and completed request results.
- The complete installable Python plugin source, metadata, this guide and license.

The archive manifest lists the exact decoded byte count and SHA-256 for every member. Image formats that are already compressed are stored without a second expensive compression pass. Large members stream in chunks and ZIP64 is available. The exporter verifies each file while writing it and publishes only the completed new archive.

At the receiving workstation, install the plugin using the original generated plugin ZIP, or zip the received software/starforge_stac directory under the same starforge_stac root. Choose **Receive archive**, then reopen every required saved map. Relative file paths point into the new received workspace, including all earlier source editions.

A repeated receive of the same archive returns the same receipt. It also checks the retained workspace file closure. An interrupted receive can be retried into the same directory: already-complete files are verified and the same snapshot is published. If the database was published before its receipt write, receiving recognizes that exact snapshot and finishes the original operation. Keep any independently changed workspace and receive another archive into a new directory.

## History and interrupted operations

The workspace uses its own original SQLite store for GIS analyst choices; it does not create a second acquisition, payment or customer authority. Every state change uses a displayed revision, analyst and stable request ID in one transaction.

The desktop stores its pending action locally before dispatch. **History and recovery → Resume pending action** retries that same input and request. Completed actions return their original result. A revision conflict keeps the local pending action visible so the analyst can inspect current history.

**Release local pending action** removes only that local UI marker. Retained source files, saved native maps and the original workspace event/request history stay available. Use this when a deliberate new action is appropriate after reviewing a conflict. Do not change the same request ID's payload.

Cancellation stops the current chunked local import/export/verification at its next progress boundary. Already retained exact files and native operations remain available. QGIS provider work runs in the application's native thread; the interface does not interrupt an in-progress GDAL call by terminating QGIS.

## Python CLI and complete native continuation

Run the Python entry with the existing QGIS Python environment for native-inspect/native-save/native-open. Pure receiving and workspace commands use Python's standard library. Put the qgis directory on PYTHONPATH or run from that directory:

~~~sh
python -m starforge_stac.cli create --workspace NEW_WORKSPACE --title "Received imagery"
python -m starforge_stac.cli import --workspace WORKSPACE --input import.json --progress
python -m starforge_stac.cli scenes --workspace WORKSPACE
python -m starforge_stac.cli assets --workspace WORKSPACE
python -m starforge_stac.cli layers --workspace WORKSPACE --input layers.json
python -m starforge_stac.cli native-save --workspace WORKSPACE --input save.json
python -m starforge_stac.cli native-open --workspace WORKSPACE --project-id PROJECT_ID
python -m starforge_stac.cli export --workspace WORKSPACE --file COMPLETE_PROJECT.zip --revision REVISION
python -m starforge_stac.cli receive --workspace NEW_RECEIVER --file COMPLETE_PROJECT.zip --expected-sha256 ARCHIVE_SHA
~~~

Mutation input uses the actual displayed revision, one stable requestId and actor. An import input is:

~~~json
{
  "revision": 0,
  "requestId": "customer-receiving-1",
  "actor": "Receiving analyst",
  "directory": "/absolute/original/qgis-source",
  "expectedManifestSha256": "THE_ACTUAL_QGIS_RECEIVING_MANIFEST_SHA256"
}
~~~

A layers input adds a complete layers array. Each definition has a stable id, sourceId, kind, label, visible and opacity. Footprints use allScenes and original sceneKeys; raster/vector definitions use original collection, itemId and assetKey, with optional vectorLayer, bands and crsOverride. Use the CLI's complete original scenes/assets output instead of deriving another identity.

A review input adds leftSourceId, rightSourceId, decisions[{layerId,decision}] and note. A native-save input optionally adds projectCrs. Read commands include open, source-open, scenes, assets, compare, history and operation. The latter retrieves one original requestId.

The maintained native-journey.py accepts one original operation config. It opens the exact original source, imports it, maps original footprints plus explicitly selected native assets, captures native styles, saves/reopens a map, and performs complete archive receiving into another directory with native reopen of every map. An optional original later edition exercises the exact supplied successor decisions.

~~~json
{
  "operationId": "CUSTOMER_STAC_QGIS_RECEIVING",
  "outputRoot": "/absolute/owned/native-operation",
  "sourceDirectory": "/absolute/original/prepared-qgis-source",
  "sourceManifestSha256": "ACTUAL_SHA256",
  "actor": "Receiving analyst",
  "title": "Original customer GIS handover",
  "assetSelections": []
}
~~~

The assetSelections array contains only actual received asset identities and selected native kinds/settings. Original scene footprints can be mapped when a customer's selected imagery is a non-georeferenced thumbnail. The native result records that original file selection and the actual native outcome.

~~~sh
python native-journey.py --config ORIGINAL_OPERATION.json
~~~

For an actual desktop capture, set STARFORGE_QGIS_JOURNEY_CONFIG to that same file and run the existing QGIS application with --code pointing to native-journey.py. The driver uses qgis.utils.iface only when the real desktop supplies it. An API-only QGIS process records its actual native result without an invented desktop image.

## Maintained source seams

| Source | Interface |
| --- | --- |
| bridge.mjs | exportQgisReceiving and openQgisReceiving over the original Node receiver |
| starforge_stac/model.py | ReceivingSource, QgisWorkspace, compare_sources and receive_package |
| starforge_stac/qgis_project.py | Native file inspection, selected layers, style capture, save and reopen |
| starforge_stac/plugin.py | Original QGIS plugin/menu/dock and analyst workflow |
| starforge_stac/cli.py | Workspace and native QGIS operator commands |
| plugin-package.py | Deterministic complete installable plugin ZIP |
| native-journey.py | One original-input native receiving continuation |

Primary API references: [QGIS raster layers](https://docs.qgis.org/3.40/en/docs/pyqgis_developer_cookbook/raster.html), [native project load/save](https://docs.qgis.org/3.40/en/docs/pyqgis_developer_cookbook/loadproject.html), [QgsProject](https://qgis.org/pyqgis/3.44/core/QgsProject.html), [QgsProviderRegistry](https://qgis.org/pyqgis/3.44/core/QgsProviderRegistry.html), and [QgsMapLayer styles](https://qgis.org/pyqgis/master/core/QgsMapLayer.html).
