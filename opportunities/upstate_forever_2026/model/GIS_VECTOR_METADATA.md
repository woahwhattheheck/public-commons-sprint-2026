# Editable vector metadata in the original GIS handover

This extends the existing editable GIS project. Each newly created vector working dataset receives FGDC CSDGM XML and a complete JSON provenance record. Original source files, selected rows, field mapping, CRS, geometry and scientific results remain attached to the same project.

Implementation edition: GIS builder 1.6.0; vector metadata 1.0.0. The maintained caller is `model/gis_workspace.py`; the writer is `model/gis_vector_metadata.py`. The complete native-study selection uses the same contract through `model/gis_native_study.py`.

## Export a selected scientific edition

Continue the existing GIS operator or original Workspace export command. Select the actual sources, completed runs, prepared grids or saved native-study cohort. Use the original delivery selection when its atlas datasets and map context are required.

The Workspace request retains a metadata contact from:

1. Explicit `metadata_contact` in the selection.
2. The existing `contact` alias, when `metadata_contact` was not supplied.
3. The actual selected delivery's retained contact.
4. An empty declaration when none was supplied.

If both explicit aliases are present they must agree. An explicitly empty object remains empty; it does not silently inherit the delivery's contact. Invalid declared field types are rejected by the maintained contact validator. Required absent XML contact values are written as `Unknown`, not inferred from a project title, author account or organization name.

For an explicit retained-file request passed directly to `gis_project_cli.py build`, use the canonical top-level `metadata_contact` field. The aliases above belong to the Workspace selection adapter. Supply only real declared contact details. The existing fields include `name` or `person`, `organization`, `position`, `email`, `phone`, and structured `address` or `addresses`. The original helper also retains declared fax/TDD, hours and instructions.

The original source declarations are retained under each source layer's `source.source_metadata`. A source edition label is not treated as an observation or publication date. The field mapping records original names, any collision-safe renaming and the generated original-row identity field. Storage types do not establish measurement precision or scientific field meaning.

## Inspect the metadata and its dataset

Open the delivered `OPEN_GIS.html` and select the vector layer's details. Use its metadata downloads alongside **Working layer**, **Original source**, and the complete project metadata. Open `project.qgz` in QGIS and inspect the actual attribute table and geometry.

The current layer record has:

```json
{
  "vector_metadata": {
    "schema": "upstate.gis-vector-metadata/v1",
    "version": "1.0.0",
    "id": "content-derived identity",
    "xml": {"path": "metadata/vectors/IDENTITY.xml", "bytes": 0, "sha256": "actual SHA-256"},
    "json": {"path": "metadata/vectors/IDENTITY.json", "bytes": 0, "sha256": "actual SHA-256"}
  }
}
```

This example documents the shape only; actual generated descriptors supply their real lengths and hashes. The JSON binds the working GeoPackage's path, bytes, SHA-256 and layer name to its inspected schema, source files, original declarations, selection and process. XML's dataset link is relative to that same project hierarchy. Copying an XML alone does not carry its dataset.

The metadata keeps original coordinate-system and bound information. Unknown accuracy, coordinate precision, dates and contact fields remain explicit. A vector is not described as a raster grid, and no pixel resolution is invented for it. Original source content dates, dataset processing and metadata creation have distinct meanings.

## Continue an editable project

Use the existing included CLI with the same compatible GIS Python used by the project. Replace the variables below with actual retained paths. These commands do not run an InVEST model.

```sh
"$GIS_PYTHON" "$GIS_DIR/tools/model/gis_project_cli.py" verify "$GIS_DIR"
"$GIS_PYTHON" "$GIS_DIR/tools/model/gis_project_cli.py" pack "$GIS_DIR" "$GIS_ARCHIVE"
"$GIS_PYTHON" "$GIS_DIR/tools/model/gis_project_cli.py" receive "$GIS_ARCHIVE" "$NEW_GIS_DIR"
```

Receive into a new directory. The original verifier checks the complete member inventory, project references and native datasets; current vector metadata also has to bind the actual working file and descriptors. Historical projects exported before this feature remain readable. Re-export the selection with the current builder to create the new metadata edition.

For an intentional recipient edit, keep the relative working paths, save the QGIS project and close the dataset's active editing session. Use the original seal action with the real edit reason:

```sh
"$GIS_PYTHON" "$GIS_DIR/tools/model/gis_project_cli.py" seal "$GIS_DIR" --reason "$EDIT_REASON" --project-file project.qgz
```

Choose the project file actually saved; use `project.qgs` when that is the authoritative edited file. The existing seal rules still reject unreviewed layer replacement and changed CRS. Sealing refreshes current vector metadata to the inspected edited file and retains earlier XML/JSON identities. It does not claim that the recipient's edit was a new original agency source or a new model run.

Pack that sealed edition and receive it into another new directory. Open the actual delivered metadata, project and working layer there. Check that links still resolve and that the metadata corresponds to the edited edition rather than its predecessor.

## Re-adopt the received edition as a source

Use the original Workspace receiving and source-adoption commands from the complete application:

```sh
"$GIS_PYTHON" "$APP/model/gis_project_cli.py" workspace-receive "$WORKSPACE" "$GIS_ARCHIVE"
"$GIS_PYTHON" "$APP/model/gis_project_cli.py" workspace-adopt-sources "$WORKSPACE" "$ADOPTION_SELECTION"
```

The selection file must name the actual returned receipt, selected layer IDs, title and reason under the existing API. Use the IDs returned by the original receiver; a sample or historical receipt is not interchangeable.

Source adoption verifies the current vector metadata before retaining its descriptor. The XML, JSON and actual linked working GeoPackage travel together as required context under their original relative hierarchy. The imported source also retains its earlier originals and edition history. This avoids orphaning a metadata document when only one working layer is selected for the next source edition. The new source identity remains a received GIS edition, with the original source lineage preserved beneath it.

## Operate the original-project receiving course

Use the complete current application and an existing complete editable GIS directory containing the actual selected vector sources. The receiving output must be a new owned directory; the course preserves the supplied original project.

```sh
"$GIS_PYTHON" -B "$APP/source/fgdc-metadata/receive_vector_metadata.py" \
  --application "$APP" \
  --original-project "$ORIGINAL_GIS_DIR" \
  --output "$NEW_RECEIVING_OUTPUT" \
  --exercise-annotation \
  --exercise-workspace-adoption
```

The explicit `--exercise-annotation` flag performs a receiving exercise in a new copy: a new empty nullable annotation field is added while every original geometry, field and attribute value is checked unchanged. It is not a new observation, a customer edit, or a model result. The course uses the maintained builder, checks each created vector record against both retained official XML Schema and DTD, seals the edited copy, keeps the earlier XML/JSON files, and packs and independently receives the complete edition. It verifies that the original input project is unchanged. The second explicit flag receives that archive into a new independent Workspace, adopts the selected vectors through the original source importer, cold-reopens the Workspace and checks that each required XML/JSON/GPKG context retains its exact bytes and relative dataset link.

Keep the real command, source pin, selected original project, output paths and first exception or completed result. Then open the actual offline layer details and XML/JSON/GPKG/QGIS/ZIP outputs in their normal tools, including the received edition. The command's completed checks do not replace a personal visual inspection. Preserve current native processes and use one existing compatible GIS operator; no InVEST execution is needed.

## Maintained source and receiving boundary

The source closure includes the new vector helper and this guide, the unchanged `fgdc_metadata.py` contact/citation helpers, the original GIS builder/CLI/viewer and the complete Workspace/native-study adapters. The portable project's existing offline tools receive the required metadata helpers; standalone Workspace operations still use the complete original application.

The official retained schema family remains under `source/fgdc-metadata/schema/`; the original DTD also remains at `source/fgdc/fgdc-std-001-1998.dtd`. A well-formed file, inventory match or source review does not by itself establish an actual standards-validation or recipient-operation result. Report the exact XML/schema and original project editions actually operated.

Continue the same native GIS owner's retained project for export, normal metadata/QGIS use, intentional edit/seal, archive receiving and source adoption. Keep existing scientific runs and browser/process ownership. This is one joined product implementation, not a second application or a new model execution.

## Current owner direction

Carry `CURRENT_OWNER_DIRECTION.md` version `2026-10-13.4`, the full post-call campaign `F0C8R2SQ0NP`, and project `AGENTS.md` with the complete source handoff. The campaign explicitly supersedes the old 14:00 UTC checkpoint and releases the local browser hold. Preserve any actual active browser/native operation.

Before calling the outgoing application or attachments ready, the producing worker opens and uses the exact built version, personally looks at its desktop and narrow rendering, and opens the actual XML/JSON/GPKG/QGIS/ZIP outputs in their normal tools. Resolve observed defects in this same source. Authored source and literal-join replay are not native or visual acceptance. No external message to Tim, commercial acceptance, invoice or client send is authorized by this implementation.
