# Complete migration projects and receiving

Build the selected maps from a retained migration edition, export the complete workspace, and reopen every saved map at an independent receiving location. The archive includes the original source exports, reviewed mapping and correction records, generated native data, saved QGIS projects, styles and local style resources, and the installed migration application.

The migration workspace uses the existing QGIS workspace database and revision journal. Project construction, native styles, QGZ writing and receiving all use the maintained QGIS engine in the adjacent `qgis/` source. A corrected edition remains a separate source and project version in that same history.

## Prepare a delivery

In the migration operator, inspect the approved source export and destination schema. Save the complete mapping plan, including field and key identities, null handling, CRS assignment or transformation, and the selected output layers. Generate its native edition through the original vector engine.

Select the intended maps from that edition's `projectDefinitions`. Each definition names its original source-layer IDs, selected project CRS and GeoPackage output. It can retain original layer display choices and captured style files. Build the maps using the displayed workspace revision and one stable request ID.

The complete project action performs these native operations in order:

1. Bind the original edition, definitions, actor and starting revision in the existing workspace journal.
2. Import the entire original vector export and select its manifest identity.
3. Resolve each selected layer through its original source ID, source-layer ID and native output ID. The GeoPackage's exact native table name remains the selected table.
4. Load those layers with the actual QGIS provider, capture their current QML styles and local resources, and save the map with relative source paths.
5. Reopen the saved QGZ and verify its workspace, source, layer, native table, style and resource bindings.
6. Record every completed project under the original edition and request.

The project definition's title is retained in the migration delivery. The maintained native writer uses the workspace title inside each QGZ.

The build binds the complete original edition with the vector engine's exact canonical serializer. `editionFile` retains the original edition document's byte count and SHA-256; `editionSha256` records its canonical document identity. `projectDefinitionsJson` retains the complete exact original definition JSON inside the ordinary QGIS journal. The accompanying `projectDefinitions` contains only the declared QGIS display arguments: visibility is a boolean, opacity is the native double required by QGIS, style files remain original descriptors, and native text controls remain strings. Source coordinates, exact numeric field values, keys, original manifests and source-row sidecars stay in their original retained files and original vector representation.

Keep the complete archive outside the active workspace. Select its original revision when exporting. A successful export returns the archive's exact byte count, SHA-256, manifest SHA-256, workspace ID and revision.

## Correct an edition

Create the corrected source or mapping as a new immutable migration record. Generate its new native edition and select its intended project definitions explicitly. Use a new build request with the reviewed current workspace revision.

The prior source, map, styles and correction history remain available. Building a successor selects its declared original native outputs; it does not rewrite an earlier map. An explicit saved style may be selected for the successor through `layerOptions`; the original QGIS validator and native provider must accept its source, field and resource bindings.

The original workspace comparison can compare the two imported source manifest IDs. It reports actual retained source and native-output differences. The receiving journey retains the full comparison report for each adjacent distinct edition and reopens the complete prior/current map set after building the selected editions.

## Receive and operate

Use the complete archive and its original SHA-256. Receive into a new private workspace directory. The unchanged original QGIS receiver verifies every declared member, restores the exact workspace snapshot and operation history, and preserves the additional migration state. The migration wrapper then verifies every declared migration document and file.

Reopening uses the selected QGIS installation's Python, Qt, GDAL and PROJ. The existing QGIS engine requires version 3.40 or later and records the actual runtime version. Use the version and providers selected for the delivery.

Native execution takes place on the QGIS application's thread. A command-line receiving worker creates one offscreen QGIS application for its complete operation. A QGIS desktop caller reuses its existing application. A threaded web handler should dispatch the original native operation through its selected Python worker.

The source package supports ordinary Python inspection and receiving:

- `native_reopen="auto"` reopens all maps when the selected QGIS module is available.
- `native_reopen="required"` requires the actual native reopen to finish.
- `native_reopen="skip"` receives and verifies files for a later native session.

A provider, style or resource error from an installed QGIS runtime is returned by the native operation. Only a missing QGIS module is treated as unavailable in auto mode.

The migration workspace retains complete application editions in `state.migration.software`. Each original `{id, path, source, files}` record identifies its complete file inventory under `migration/software/<closure SHA>/stac/`. This source includes the migration operator, original vector engine, paired QGIS engine, guides and the independent receiving entrypoint. The QGIS writer also carries its own original `software/starforge_stac/` files; both sets remain in the same complete archive. Open the received workspace through the selected migration application, then choose any original saved map. All retained source data and style resources resolve inside the received workspace. The complete received workspace can itself be exported and received onward with the same source, mapping, project and operation identities.

## Python interface

Run from the installed complete source with its `stac/` directory on `PYTHONPATH`. The receiver selects the paired original QGIS source from that same installation.

```python
from migration.workspace import Workspace
from migration.receiving import (
    build_projects,
    export_handover,
    inspect_handover,
    receive,
    reopen_handover,
)

workspace = Workspace("/private/existing-migration")
built = build_projects(
    workspace,
    "ORIGINAL_EDITION_ID",
    request_id="ORIGINAL_PROJECT_BUILD_REQUEST",
    actor="Delivery operator",
    expected_revision=REVIEWED_REVISION,
)

archive = export_handover(
    workspace,
    "/private/delivery/complete-migration.zip",
    expected_revision=workspace.read()["revision"],
)
inventory = inspect_handover(
    archive["path"],
    expected_sha256=archive["sha256"],
)

received = receive(
    archive["path"],
    "/private/received-migration",
    expected_sha256=archive["sha256"],
    native_reopen="required",
)
maps = reopen_handover(received["workspace"])

```

`build_projects` returns the original `record_project_delivery` result plus:

| Field | Meaning |
| --- | --- |
| `projectBuild` | Immutable build input identity and complete saved project records |
| `projectBuild.inputSha256` | Canonical identity of the edition, source, definitions, actor and starting revision |
| `projectBuild.editionFile` and `editionSha256` | Exact original edition bytes and the vector engine's canonical document identity |
| `projectBuild.projectDefinitionsJson` | Complete original definition JSON, including exact source numeric values |
| `projectBuild.projectDefinitions` | Declared native QGIS display arguments used to create the maps |
| `projectBuild.projects` | Every native project ID, exact file, source IDs, original layer/style definitions and native saved readback |
| `projectBuild.operations` | Ordered original subrequest IDs, actions and committed revisions |
| `replayed` | Whether the final original build request already existed |
| `nativeReopen` | Readbacks from reopening the retained projects during this call |

`inspect_handover` creates no workspace. Its result contains the complete file inventory, source rows, saved project rows, migration state, history counts and original archive/manifest/snapshot identities. By default it streams and verifies every member. `verify_files=False` reads the complete archive identity and metadata for a preview; its `verification.allMembers` field records that selection.

`export_handover` calls the original archive writer. If a complete file already exists after a lost response, it verifies that archive and requires the same workspace and selected revision before returning its original identity.

`reopen_handover` reopens every saved map and calls the original cartographic publication receiver for all retained publications. Its `publications` field preserves the complete original publication readback, including the retained QGZ, QPT, PDF, PNG, plan and receipt bindings. Prepare or correct publications through the existing cartography operator before the complete handover is frozen. That operator retains its own original request, actor, revision, corrected-source comparison and publication status.

`receive` returns the original receiving fields, the reopened migration `workspace`, migration verification result, current revision and native map/publication readbacks. A retry of the same archive reuses the original received workspace. Existing legitimate subsequent workspace edits stay in that workspace.

## Complete native receiving journey

The maintained helper operates on the owner's existing captured and reviewed migration workspace. Populate edition IDs and paths from that original workspace:

```json
{
  "operationId": "ORIGINAL_MIGRATION_RECEIVING_OPERATION",
  "workspace": "/private/existing-migration",
  "outputRoot": "/private/migration-delivery",
  "actor": "Original delivery operator",
  "editions": [
    {
      "editionId": "ORIGINAL_BASELINE_EDITION",
      "requestId": "ORIGINAL_BASELINE_PROJECT_BUILD",
      "expectedRevision": 12
    },
    {
      "editionId": "ORIGINAL_CORRECTED_EDITION",
      "requestId": "ORIGINAL_CORRECTED_PROJECT_BUILD"
    }
  ]
}

```

The shown IDs, paths and revision are input-shape examples. The operator supplies the retained real selections. When an entry omits `expectedRevision`, the helper durably records the current revision before its first native dispatch. Every retry reads that same saved action.

Run the existing selected QGIS Python:

```sh
"$STARFORGE_QGIS_PYTHON" migration/examples/receiving_journey.py \
  --config /private/original-migration-receiving.json

```

This one operation builds the complete selected edition sequence, verifies each completed request's replay, retains full adjacent-edition comparisons, reopens all maps, exports and inspects the complete archive, receives it twice at the same destination, and checks the exact original snapshot.

It then starts a separate selected-QGIS process using the **received application's own source** to reopen every saved map. It exports that received workspace onward and repeats the independent native reopen at the onward location. The helper resolves the entrypoint from the chosen `state.migration.software` record and verifies every declared file before starting the child. It then checks that the child's migration, vector and QGIS modules, including the entrypoint and publication receiver, are exact declared members of that independently received application. The output retains the selected software ID, metadata identity, entrypoint descriptor and loaded source-file descriptors. The onward receiver uses the same software ID.

If the workspace retains several application editions, the helper selects the one whose complete source matches its running installation. Set `softwareId` in the original configuration when choosing another retained edition or when no single edition matches. This is an original software identity, not a filesystem path. A direct independent reopen accepts `--software-id` with that same retained ID. All application bytes and recorded source paths remain relative to the workspace.

The resulting output directory contains:

| File or directory | Use |
| --- | --- |
| `operation-input.json` and `actions/` | Original configuration and pre-dispatch revision/request bindings |
| `workspace-input.json` and `workspace-input-snapshot.json` | Original workspace, exact edition documents, source snapshot and committed history |
| `host-bindings/` | Explicit physical locations for the same operation on each receiving host |
| `builds/` | Original committed project delivery results |
| `comparisons/` | Complete original source/native edition comparisons |
| `complete-migration.zip` | Full source, mapping, native data, maps, styles, resources, history and application |
| `received-workspace/` | Independently restored editable workspace |
| `independent-reopen.json` | Original software selection, exact received-source modules, native maps and complete publication readbacks |
| `onward-migration.zip` and `onward-workspace/` | Complete onward handover and restored workspace |
| `onward-independent-reopen.json` | Native map/publication readbacks using the same original software edition at the onward receiver |
| `result.json` | Completed original operation, exact archives, editions, projects and receiving identities |

Keep the original configuration and output directory when resuming. Each build's start event binds its initial revision; each following subrequest uses the preceding committed revision. If another editor changes the workspace between unfinished steps, the original CAS check reports that change. Review the current workspace before choosing a new build request.

### Move the same operation to another host

Keep the original configuration file unchanged. Move the complete workspace and its complete receiving output directory, including saved actions, source bindings, archives, independent results and received workspaces. Paths for the new host are a separate explicit input:

```json
{
  "schema": "starforge.migration-receiving-host.v1",
  "operationId": "ORIGINAL_MIGRATION_RECEIVING_OPERATION",
  "expectedWorkspaceId": "ORIGINAL_WORKSPACE_ID",
  "expectedSnapshotSha256": "ORIGINAL_WORKSPACE_INPUT_SNAPSHOT_SHA256",
  "workspace": "/new-host/existing-migration",
  "outputRoot": "/new-host/migration-delivery"
}
```

Use the exact `workspaceId` and `snapshotSha256` from the retained `workspace-input.json`. This is the workspace snapshot bound when this operation first opened. It remains the reference after the operation has committed further work. The displayed values are input-shape examples; copy the full original identities.

```sh
"$STARFORGE_QGIS_PYTHON" migration/examples/receiving_journey.py \
  --config /new-host/original-migration-receiving.json \
  --remap /new-host/migration-host-paths.json
```

The helper verifies that the selected workspace has the same identity, original edition documents, event prefix and committed requests. Every retained source, project and migration record must remain present unchanged. A workspace at the same revision must match the complete retained snapshot exactly. A later revision must continue that history; unfinished build steps still use their original saved CAS revisions. The move also verifies all declared migration files.

The original configuration, snapshot, action inputs and completed result remain unchanged. Each explicit host mapping has a small saved binding in `host-bindings/`. Reusing that mapping after further committed progress verifies the original history without requiring the current revision to stay frozen.

Completed archives are read from the new output directory and verified against the saved byte counts, hashes, workspace IDs, manifest IDs and revisions. Their original receipt paths remain historical metadata. The helper returns current paths separately in `locations`; it uses those selected paths for receiving and onward receiving. Move each completed ZIP with its receipt. If a completed ZIP is missing, recover those original bytes from the previous carrier before continuing.

For an operation created by an earlier helper that has no `workspace-input.json`, select the moved workspace's exact current ID and canonical snapshot SHA-256 for the first explicit mapping. The helper retains that snapshot as the original binding before dispatch. All existing operation inputs and saved build actions still have to agree.

## Source and format references

- Maintained original QGIS model: `qgis/starforge_stac/model.py`, including `QgisWorkspace`, complete package export and `receive_package`.
- Original native project and styles: `qgis/starforge_stac/qgis_project.py`.
- Exact vector canonical values and retained original source: `vector/common.py`.
- Original cartographic publication and correction receiver: `migration/cartography.py` and `migration/CARTOGRAPHY.md`.
- Exact vector input adapter: `qgis/starforge_stac/vector_source.py` and `qgis/VECTOR_RECEIVING.md`.
- [QGIS project and style file formats](https://docs.qgis.org/3.44/en/docs/user_manual/appendices/qgis_file_formats.html).
- [PyQGIS loading and saving projects](https://docs.qgis.org/3.44/en/docs/pyqgis_developer_cookbook/loadproject.html).
- [GDAL GeoPackage driver](https://gdal.org/en/stable/drivers/vector/gpkg.html).

QGZ retains the native QGIS project and auxiliary project data. The maintained workspace additionally carries each referenced source, style and local resource file. Physical native field representations retain the original vector producer's complete field codecs and exact-value/source-row sidecars.
