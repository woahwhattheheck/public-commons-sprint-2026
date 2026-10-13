# Editable GIS handover

This contribution extends the original Upper Savannah scientific Workspace with
complete, portable desktop GIS projects. It exports retained source editions,
prepared grids, completed baseline and alternative runs, and signed comparison
rasters without rerunning the scientific models. Every physical raster keeps its
original cells, mask, coordinate system and companions. Legends and overviews apply
the declared band scale and offset, matching the QGIS provider; raw and physical
extrema are both retained. The provider behavior is documented in its source:
https://api.qgis.org/api/3.44/qgsrasterdataprovider_8cpp_source.html Every vector working copy
is a GeoPackage containing the full selected geometry and attributes.


## Continue a completed map delivery in Editable GIS

Open the completed delivery in **Maps and delivery**, then choose **Prepare editable GIS project**. The existing Editable GIS desk opens with that exact delivery selected, the original study coordinate system, and its actual retained GIS datasets. The same delivery can be selected directly in the desk's **Completed map delivery** field.

The completed-delivery selection includes baseline physical exports, every retained signed scenario difference, and the actual generic, receptor or receiving-water priorities used in the atlas. The model-domain and reporting-area polygons become separate editable context layers. Dataset source identities, units, original masks and numerical values remain attached to the existing scientific result.

Starting from a delivery deliberately starts with its own datasets. Other source editions, prepared grids, runs or comparisons can be added explicitly in the existing form. The delivery ID is saved with that Workspace's form; catalogue refresh preserves both the selected delivery and edits made while the request is in flight. The original source-only intake remains available.

Click **Build complete GIS project**. This submits the normal gis.project.export task. Open its original task result and download the complete editable ZIP. The existing OPEN_GIS.html and project.qgz entry points, independent receive operation and seal/pack workflow apply to this project.

### Original atlas relationships and working layers

Each retained delivery dataset becomes one logical GIS layer. A priority raster serving multiple map families stays one layer with every original map relationship. Distinct comparison artifacts retain their distinct original dataset and scenario identities even when the numerical TIFF bytes match.

Physical exports and signed differences retain the engine's original metric/units/purpose style grouping. Signed differences retain alternative-minus-baseline direction and common valid support. Dimensionless priorities carry their own normalization and geographic-support identity, so unrelated priority methods do not acquire a shared scientific metric merely because they have the same units.

Completed atlas layers retain their original saved display limits, units, percentile method and map relationships. The original map renderer’s Greys palette applies to physical exports and priorities; its RdBu_r palette applies to signed alternative-minus-baseline changes. Other source/run exports keep the existing shared full-native-cell grayscale policy. The original map display_scale remains in each layer’s retained source metadata.

Every layer.source retains the complete original dataset record: grid and profile IDs, baseline and alternative run/scenario records, producing-model provenance, source editions, original comparison identity, physical header, support method, derivation and atlas map relationships.

### Metadata, maps and report context

One context attachment preserves the original delivery-relative directory hierarchy. It contains the existing atlas PDF, JSON/CSV index, source context, individual map PDFs, dataset GeoTIFFs and actual companions, FGDC XML, native/grid provenance, display-scale metadata and self-contained scientific PDF reports. The FGDC links from gis/metadata to the actual original dataset paths continue to resolve after independent receiving.

Open the attachment from OPEN_GIS.html. Its files retain their original bytes and names. The separate working layers are independent copies intended for desktop editing; the attached originals remain the immutable source context for the edited edition.

The source binding also records the original delivery-state descriptor and its scientific/complete archive descriptors as lineage. The map-and-dataset attachment contains the explicit GIS/report members described above. Use the original completed delivery's archive controls when the full scientific Workspace is needed.

A completed delivery must have the current upstate.atlas-datasets/v1 catalogue. Older delivery editions remain visible with their reason; build the current edition from their retained scientific selections to provide the exact dataset relationships. The queued export verifies the complete record, atlas/dataset agreement and every selected member before invoking the maintained GIS builder.

### Command-line selection

The original command remains:

~~~sh
python model/gis_project_cli.py workspace-export "$WORKSPACE" delivery-gis-selection.json
~~~

The selection JSON includes the actual delivery_id, a project title and optional display CRS:

~~~json
{
  "title": "Selected completed watershed delivery",
  "delivery_id": "ACTUAL_64_CHARACTER_DELIVERY_ID",
  "sources": [],
  "notes": ["Editable GIS handover of the retained map delivery."]
}
~~~

Omitting project_crs selects the original delivery grid CRS. An explicitly supplied project_crs changes the project's display coordinates through the existing builder while preserving each working dataset's native coordinates.

The same request/result identities, complete GIS inventory, QGS/QGZ references, original file transport, desktop edit sealing and received-source adoption govern this continuation. Its operation is ES-20261013-DELIVERY-GIS-PROJECT; source is contained in the existing gis_workspace, GIS desk and delivery inspector paths.


## Review the actual changes in a received GIS edition

In **Editable GIS projects**, open the received edition's **Compare exported and received working editions** section. Select the retained **Original exported GIS project** and choose **Build complete edition comparison**. Only exports with the same original GIS selection are offered. The queued operation verifies the actual original request, both inventory fingerprints, logical layer IDs, retained source identities and complete working files.

This comparison uses the original exported working data and the actual received working data. The existing **Working vector changes** control separately compares received vectors with their original retained source features; its original-source/Fiona identity reference remains available. Choose the comparison whose original reference matches the question. The received edition's seal history remains available as additional provenance; a file-hash history alone does not supply the old geometry or raster values.

The normal task result opens the completed report and its full ZIP, JSON and layer-summary CSV. The received card retains the exact original export choice through refresh and displays completed reviews with their actual edition identities and report creation time. Changing the selected original export clears an incompatible optional adoption review, while preserving the separate adoption title, reason, working-layer and original table/document choices.

### What the report contains

Vector layers are paired using their original collision-safe source identity field, without converting identifiers such as 001 into numbers. The comparison streams complete properties and geometries through a disk-backed index. It distinguishes typed attribute changes, coordinate changes, topologically equivalent geometry, added and removed features, and missing or duplicate identities. Ambiguous rows are retained as individual unpaired records. They are not silently overwritten or matched by row position.

Each vector layer has a complete changes.jsonl file with original and received properties and geometry for every changed or unpaired row, plus a compact changes.csv. Only a small example set enters the report summary; the full change records remain downloadable. Header/schema and CRS changes are retained even when ordinary attribute values are unchanged. A changed CRS leaves geometric comparison unpaired while the exact original coordinates and attributes remain in the records.

Raster review concerns the original logical GIS layer's selected band. The complete before/after all-band header, data types, nodata, scale, offset, descriptions, mask flags and units remain in the report. Native cells are paired only when the actual CRS, dimensions, six affine values and selected band agree. A changed grid is reported as an unpaired structural change; it is not resampled to manufacture cell comparisons.

On a matching grid, 512-by-512 windows retain counts for common finite-valid cells, added/removed valid support, neither-valid cells and nonfinite unmasked values. The support-change.tif codes are:

| Code | Meaning |
|---|---|
| 0 | Neither edition has a finite-valid selected-band value |
| 1 | Both editions have a finite-valid selected-band value |
| 2 | The received edition adds a finite-valid value |
| 3 | The received edition removes a finite-valid value |

The value-change.tif is **received minus exported**, in the original declared physical units, on common support. Raw encoding changes are counted separately. The comparison applies each original band scale and offset, cancels equal offsets before subtraction, and uses exact scalar input arithmetic when large integers or changed encoding parameters require it. Float64 output cannot represent every mathematically possible difference; such cells have an explicit unrepresentable count and NoData instead of a misleading zero. Exact change counts and the retained native input editions remain available. Summary mean and RMSE concern the representable difference cells.

Categorical layers and layers with different declared units retain raw-change and support counts without assigning an arithmetic physical difference across categories or different units. Working-file and actual companion changes remain separate from the selected-band numeric result; the report does not describe other bands as numerically unchanged.

### Locate raster changes in the original grid

The same **REVIEW.html** includes a geographic raster-change view for each
paired raster layer. Choose the layer and a support or physical-change view,
then inspect its native coordinate footprint with the map's zoom, pan, reset
and selected-region controls. The complete layer summary and original change
artifact links remain beside the view. Keyboard operation and the selected
region's text readout provide the same retained data as the map.

The display aggregates **every** native support cell into contiguous grid bins
with at most 256 bins along either dimension. It does not sample one native cell
or resample the scientific rasters. Each bin retains the exact counts of cells
valid in neither edition, both editions, only the received edition or only the
exported edition. A sparse addition or removal remains present in its bin.
Physical views retain the minimum and maximum finite representable
received-minus-exported difference and its contributing cell count. Positive
and negative changes remain separate so opposite signs cannot cancel.

The selected region is explicitly a display bin. Its readout gives the native
zero-based inclusive row/column range, actual coordinate corners, support counts and physical
range/count. It does not label that region as a single native raster cell.
The geographic footprint uses all six original affine coefficients, including
rotation and shear, the actual CRS, and the smaller final bins at the raster
edges. View zoom changes the display only. The original selected-band units,
subtraction direction and native grid remain unchanged.

Open the linked **support-change.tif**, optional **value-change.tif** and
**raster-view.json** for the complete retained artifacts. The physical TIFF
contains original common finite-valid cells with representable differences;
the original report separately retains exact changed counts and unrepresentable
difference counts. Categories or differing declared units retain support views
and explicit skipped-arithmetic explanations. Incompatible native grids or
selected bands retain their unpaired explanation instead of a resampled map.

The offline viewer, its embedded view data and all linked change artifacts
travel in the original complete review ZIP and optional source-adoption context.
It makes no network or map-tile request. Original exported/received working TIFFs
and their companions remain in their respective complete GIS project archives;
the report does not create links that escape its own ZIP.

The geographic producer is **received-gis-review/v2**. Selecting the same
original export/received pair through the existing review action creates the
current immutable report edition. Previously completed review IDs and adopted
source contexts retain their original content and continue to reopen.

The current catalogue supplies its producer version to the existing queued
review request. This distinguishes the new report from an earlier completed
task for the same pair, while preserving exact same-version lost-response and
retry recovery. An explicitly versioned CLI/request must match the installed
producer; the ordinary CLI selection can continue to omit that optional field.

Geographic continuation: **ES-20261013-GIS-REVIEW-GEOGRAPHY**.

### Portable report and recovery

The complete review ZIP opens through **REVIEW.html** and includes both original project manifests, review.json, layers.csv and every layer's full change records or derived support/value rasters. The report preserves the exact exported/received project and edition IDs, original source/run/scenario provenance, inventory fingerprints and subtraction direction. Keep the complete ZIP contents together so its relative links resolve.

Review output is retained under:

~~~text
gis-received/<receipt_id>/reviews/<review_id>/
~~~

The received project and its inventory remain immutable. A failed operation continues from completed layer checkpoints whose native files and companions were checked against the original input inventory. A changed-input failure invalidates the affected attempt's reusable checkpoints. Completion rechecks the complete original input fingerprints before retaining its final report.

The normal full scientific Workspace backup and restore carry the received project, original export and review together. The portable review ZIP supplies the change report and its data; the complete GIS project ZIP supplies the independently editable original/received working layers.

### Retain a review with an adopted source edition

In the existing received-source adoption form, **Retain a change review with this source edition** is an explicit choice. It offers complete reviews matching the selected original export and the exact current received fingerprint. Selecting a review retains its complete report context with the new original source collection and makes that review identity part of the adoption selection.

The original adoption path also supports received working layers or selected original tables and documents without attaching a review. Working-layer selections still retain all required original attachments. Independent table/document selection, native types, units, dates, geography, companions and original queued-task recovery stay available.

The full application CLI uses the same backend:

~~~sh
python model/gis_project_cli.py workspace-review "$WORKSPACE" gis-review-selection.json
~~~

A selection file contains actual retained IDs:

~~~json
{
  "receipt_id": "ACTUAL_RECEIVED_GIS_ID",
  "export_id": "ACTUAL_ORIGINAL_EXPORTED_GIS_ID"
}
~~~

For optional reviewed adoption, add the actual review_id to the existing workspace-adopt-sources selection. Omit that field for the original adoption path. Standalone GIS seal/pack/receive tools remain usable independently; Workspace review uses the installed scientific application's gis_edition_review module.

Operation: ES-20261013-RECEIVED-GIS-REVIEW.

## Open and continue a delivery

Extract the complete archive into a new directory. Open **OPEN_GIS.html** for the
self-contained geographic overviews, layer search, units, run/source identities,
and operating instructions. Open **project.qgz** in QGIS for the editable layers.
Keep the whole directory together: QGIS project files refer to the accompanying
data using relative paths. The QGIS file-format documentation describes these
project/data relationships: https://docs.qgis.org/3.44/en/docs/user_manual/appendices/qgis_file_formats.html

The `originals/` directory preserves the selected source bytes and companions.
The `layers/` directory contains independent working copies, not hardlinks. A
vector's `source_row_id` (or collision-safe equivalent declared in the metadata)
maps the working row to its original row. `layers.csv` is the complete layer table;
`project.json` retains the selection, units, case identities, methods and history.
Raster overviews use nearest-cell display resampling. Vector overviews use
explicitly recorded topology-preserving simplification. Neither replaces the
full-resolution numerical or geometric data.

After editing attributes, geometries or styling, save inside the received directory
and close editing before recording the edition:

```sh
python tools/model/gis_project_cli.py seal . --reason "Reviewed catchment attributes"
python tools/model/gis_project_cli.py pack . ../reviewed-gis.zip
python tools/model/gis_project_cli.py receive ../reviewed-gis.zip ../next-receiver
```

When both project files changed, select `--project-file project.qgz` or
`--project-file project.qgs`. The selected native project is synchronized to the
other format. Existing layer IDs and relative working paths remain fixed; added
external datasets or reprojected vector sources enter through a new explicit
selection. The next receiver can edit and transfer again. The sender's retained
originals are not modified. Metadata history retains previous inventories and
manifests; retain a prior ZIP to preserve that edition's complete working bytes.

## Use the maintained scientific Workspace

Run from the original product root, with its original `model/workspace.py` and GIS
dependencies installed:

```sh
python -m model.gis_project_cli workspace-catalogue /path/to/study
python -m model.gis_project_cli workspace-export /path/to/study selection.json
```

A source-only selection is useful before native model execution:

```json
{
  "title": "Upper Savannah retained study geography",
  "project_crs": "EPSG:5070",
  "source_collection_id": "ACTUAL_RETAINED_COLLECTION_ID",
  "sources": [
    {"source_id": "ACTUAL_RETAINED_DOMAIN_ID", "visible": true},
    {"source_id": "ACTUAL_RETAINED_REPORTING_ID", "visible": true}
  ]
}
```

The IDs above are explicit placeholders, not invented study data. Obtain the
actual IDs from `workspace-catalogue`. Include `grid_id` and `include_grid: true`
for the original prepared grid; `baseline_run_id`, `scenario_run_ids` and
`comparison_ids` select existing complete outputs. A source collection without a
`sources` list selects all its retained entries. Each selected source can specify
an original vector `layer`, an equality `where` object, `units`, `purpose`, `group`
and initial `visible` state. `purpose` distinguishes context, categorical,
physical, priority and difference layers.

The adapter uses the original `source_file`, `get_grid`, `inspect_run`, `_get` and
source-catalogue interfaces. It retains the original run/profile/scenario IDs and
actual declared artifact units. It does not substitute an ecological model or
create new run outputs. Export results live under
`WORKSPACE/gis-exports/SELECTION_HASH/` with the project directory, complete archive,
selection and export record. Same-request reopening verifies the retained edition.

## Build from retained files directly

The direct CLI needs no scientific Workspace installation:

```sh
python model/gis_project_cli.py build request.json output-directory --source-root retained-inputs
python model/gis_project_cli.py verify output-directory
python model/gis_project_cli.py pack output-directory complete-gis.zip
```

A request uses schema `upstate.gis-request/v1`, title, project CRS and a nonempty
`layers` array. Every layer declares `id`, `title`, `kind` (`vector` or `raster`),
`file` (`path`, exact `bytes`, SHA-256), optional `companions`, `group`, `units`,
`purpose`, source provenance and selection options. Paths are relative to the
explicit source root. GeoTIFFs retain all dependencies, including masks. An
original `.json.gz` vector is read through GDAL's gzip driver. Other original
files are carried as attachments, with complete companion sets.

The full request used in the included county operating case is retained in its
processing-source archive. Its named county source is Basemap's installed
UScounties dataset; three state selections contain 305 complete county features.
Two 30 m geographic rasters derive from the Anderson/Oconee/Pickens county union.
The county mask and Euclidean boundary distance are explicitly described
geographic processing examples, not the official HUC12 domain or pollutant results.
Original data notices and processing methods accompany that case.

## Native QGIS receiving

Use the Python environment supplied with an installed QGIS 3 application. The
helper requires QGIS bindings but does not invoke InVEST:

```sh
QT_QPA_PLATFORM=offscreen /usr/bin/python3 tools/model/gis_project_native.py \
  original-project new-native-receiver
```

It copies the **complete package** to the new receiving directory, opens every
layer with QGIS, checks provider validity and populations/dimensions, renders the
selected map, saves QGIS's own project, reopens it, and writes the resulting
version/provider information and image into that received package. The sender
stays unchanged. An unsuccessful opening leaves its copied directory available
for diagnosis and produces no successful native-receiving record.

The authored cloud execution used Python 3.13, Fiona 1.10.1, Rasterio 1.5.0,
pyproj 3.7.2, Shapely 2.1.2 and Chromium. Full data export, receiving, recipient
editing and second receiving ran there. QGIS Python was not installed in that
container; its native-desktop helper therefore requires the equipped receiving
host. Browser interaction checks rendered the actual self-contained HTML in
Chromium; administrator policy prevented network/file navigation in that browser.

## Operating sequence for Bryce

**Inspect.** Open the delivered HTML. Choose a layer, inspect its units and source
identity, then use *Fit selected layer*. Explain: “Each layer identifies its source
and case, so the map can be traced to the underlying data.”

**Compare.** Toggle the selected baseline and alternative groups. Matching physical
metrics and units use a common legend range. Signed difference layers retain the
original comparison direction; dimensionless priorities are not pollutant loads.
Explain: “The comparison preserves the native units and tells us which case and
parameter profile produced the result.”

**Work.** Open `project.qgz`, expand a case group and inspect a raster value or the
GeoPackage's attribute table. Explain: “This is an editable GIS project. The
operator receives the data, source files and project structure.”

**Return.** Edit a working attribute, save and close it, seal with the reason, then
pack and receive into a different directory. Explain: “The recipient can continue
independently; we retain the original data and identify each transferred edition.”

## Implementation boundaries

All exports use create-only staged publication. Hash inventories cover every
retained file, copied original and history record. ZIP receiving checks paths,
member collisions, available space and extracted identities before publishing the
new directory. Packing verifies the bytes it actually writes. The kernel releases
process locks after interruption; the next operation can retry the same request.
These checks belong to file correctness, not a new business approval policy.

This component owns only the additive GIS files. Installation into the original
operator's queue/navigation/download system must compose the current owning
source instead of overwriting another agent's operator panels. The CLI and Python
adapter are the direct maintained entrypoints of this source edition.

## Original operator integration

The contribution includes the complete grayscale `Editable GIS projects` panel,
queued `gis.project.export`, `gis.project.receive`, `gis.project.adopt-sources`,
`gis.project.review` and `gis.vector.review` operations, original upload
receiving, independent archive copies and the original hash-checked downloads.

Apply the component installer to the current complete application. It uses the
receiving application's maintained extension installer when present; the original
pre-registry application retains its narrow direct integration:

```sh
python install_gis_projects.py --application /path/to/original/application --dry-run
python install_gis_projects.py --application /path/to/original/application
```

The installer composes the actual registration source, preserves unrelated
source, validates Python syntax before mutation, checks source predecessors and
retains exact before-images. On a registry application it calls the installed
`install_extensions.py` source transformations and registers the complete
`gis-projects` and `gis-vector-reviews` descriptors and their source files. It removes the exact former GIS-owned direct hooks when
migrating an older GIS installation, so the shared registry owns the actions,
navigation, assets and file routes once. Reapplying the same edition makes no
changes.

Both review references are installed together. The `gis-projects` provider
compares an exported working edition with the received edition; the separate
`gis-vector-reviews` provider compares original source features with their
received working features. The installer carries their original model modules,
providers and descriptors. On a pre-registry application, it upgrades an existing
GIS installation with the original vector action, authorized catalogue/inspect
routes, retained-item lookup and task decoration. Reapplying keeps those hooks
single; migration to the shared registry removes their exact former direct joins
before the descriptors become the active owners. The application's existing
authorization, Workspace selection, queue, download tickets and file policies
remain the same.

Start
the original `operator/server.py` with its original startup command, then select
**Editable GIS projects**. Choose an actual source edition, prepared grid and/or
completed cases. Click **Build complete GIS project**, inspect the original task,
and download its complete archive. The **Receive independent edition** form uses
the original uploader and keeps the received GIS separate from the study engine.

For ECSA's shared registry, `operator/extensions/gis-projects.json` implements the
actual published `upstate.operator-extension/v1` descriptor. It uses the same
backend implementation and lifecycle, not a second queue. The client requests the
original `getState`, `api`, `refreshState`, `showTask` and `toast` callbacks.
The component installer selects the current application's host automatically and
keeps one navigation and task owner. It composes the installed host source in
memory before writing the completed change; it never replaces that host with the
older GIS-era server, browser or registry.

### Inspect the exact outgoing populated product

The application-level **AGENTS.md** retains the owner's rendered-product
instruction, version **2026-10-13.1**. The component installer carries the current
source copy into the receiving application and preserves its existing local
instructions. Reapplication updates only the installer's marked instruction
section when one is present; its ordinary before-image journal retains the
previous bytes.

Before describing the outgoing GIS application, change report or handover as
ready, the producing worker must run and open that exact outgoing version, look
at its rendered screens or actual screenshots, and operate the important controls.
Use the existing populated county/study Workspace and its retained export,
received edition and review IDs. Inspect the actual screenshare width and a
narrow/mobile width, with relevant populated, empty, loading and error states.

In the existing GIS desk, inspect both comparison references, the selected
original export/received edition, the complete layer report, explicit unpaired
or skipped-arithmetic explanations, and the optional review context for source
adoption. Open the actual **REVIEW.html** and its downloads; extract the complete
report ZIP and follow its relative files after reopening. Inspect the corresponding
original GIS view, retained atlas legends and editable project entry points.
Operate the original queued tasks and task recovery in the same application.

This applies to every outgoing attachment. Open and use the extracted HTML,
relevant report/PDF pages, maps, images, archives and editable projects in their
normal recipient-facing viewers. Merely listing files, capturing screenshots or
reading their metadata is insufficient. If a handoff includes audiovisual media,
use natural high-quality generative narration where appropriate and actually
play, watch and listen to the final exported media. Preserve the complete current
marked owner instruction in application AGENTS.md through further delegation.

Look for unreadable tables, clipped controls, overflow, misleading labels,
unstyled screens and broken relative files. Fix visible defects in the maintained
source and inspect the corrected outgoing version. Retain readable plain industrial
layout and original scientific computations. Code review, DOM counts, HTTP
responses, screenshot capture without viewing, or another worker's approval do
not replace seeing the product. Keep the existing native receiving operation;
this inspection does not create another study or extend the sprint cutoff of
**2026-10-13 14:00 UTC**.

Include the current owner instruction in every delegated implementation or
receiving assignment and carry it through consumed build/receiving guides and
source mirrors. Preserve owner-stopped work and existing provider safeguards.

The complete original-member viewer uses the original file/download service.
Version 1.2.1 adds the current descriptor's typed nested member binding:

```json
{
  "path": "/api/file/gis-project/{workspace_key}/{kind}/{project_id}/{member_path...}",
  "handler": "member",
  "args": ["operator", "route.workspace_key", "route.kind", "route.project_id", "route.member_path"],
  "response": "ticket_policy_pair"
}
```

The module callback forwards those values to the unchanged
`GISProjects(operator).member(...)` resolver. The shared host authorizes the file
request, decodes the relative member once and serves the returned original ticket
with the resolver's content-security policy, byte ranges and download behavior.
All IDs and member paths resolve against the retained inventory; full native files
are served. Received HTML has an opaque-origin sandbox with scripts and downloads
and without operator-session, network, forms or same-origin access. The complete
pre-registry handler remains available for an application without the shared host.

The integration was composed against the maintained host and Workspace source at
[public application commit 74af5627](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/74af56274889b6d769516edb68399d3664cfc09e/opportunities/upstate_forever_2026).
Its APIs include `patch_server`, `patch_app`, typed nested file routes and original
`Workspace.import_sources`/`source_file` contracts. The 1.2.0 GIS computational,
archive, CLI, browser and native-QGIS bodies remain the original authored edition;
1.2.1 completes the current host registration and installer migration. The complete
source manifest records each file's size and SHA-256 and the original archive
identity.

Each complete task is redecorated with its original archive download and viewer
link when reopened after a process restart. Completed receiving is recoverable
when the initial response or receipt is lost: the new directory must match the
original incoming inventory before the same receiving record is adopted.

## Original Workspace receiving exercised

The source-only bridge was executed against the complete original `model.workspace.Workspace`, Git blob `4785867daaa959ad69a2ca955a3abc3f5ef324a7`, with its original `common.py` and `profiles.py` bodies matched byte-for-byte. The actual programme imported eight source entries, exported five full GIS layers, recreated the original Workspace object, reproduced the same selected GIS edition, and independently received the entire archive. Original stored objects remained unchanged. This runs independently of the numerical model installation; selected model-result exports continue to consume that installation's original completed runs.

The included operating case uses the complete South Carolina, Georgia and North Carolina county geometry selected from the retained Basemap 2.0.0 US-counties distribution, plus a 30 m mask and geographic distance raster computed from the actual Anderson/Oconee/Pickens county union. It exercises native file handling and editing. The study's actual retained 217-HUC domain is a separate source selection accepted by the same original Workspace importer and GIS exporter. The operating case's METHODS.json and all original distribution notices travel in its archive.

Raster min/max and display overviews apply the stored band scale and offset to physical values, without rewriting source cells. Physically comparable layers share their range even when stored encodings differ. A complete 3,252 by 3,273-cell distance raster and its differently encoded copy produced identical physical limits and all 5,591,230 valid cells.

## Bring a recipient's GIS edits back into the original study

Version 1.2 adds a complete return-to-study operation. Receive the sender's sealed
ZIP, choose the actual working layers to keep, give the new source edition a title
and explain the change. The existing `Workspace.import_sources` writer retains
those full GeoPackages or rasters as a **new** immutable source collection. Older
sources, prepared grids, coefficients, scenarios and numerical results stay intact.
A new source edition is available for the operator's normal selection and preparation
workflow; adopting it does not silently rerun or replace an existing model.

In **Editable GIS projects**, open the received edition's **Use received layers, tables or documents as study sources** section. Select its layers, enter the title and reason,
and click **Adopt selected study sources**. The original task records the received
edition, selected working layers and resulting source collection. In **Adopted study
source editions**, **Select this source edition for GIS export** opens that same native
collection for another complete handover. The retained source catalogue also exposes
it to the rest of the scientific application.

The command-line workflow uses exactly the same writers:

```sh
python model/gis_project_cli.py workspace-receive "$WORKSPACE" reviewed-gis.zip
python model/gis_project_cli.py workspace-adopt-sources "$WORKSPACE" adoption.json
python model/gis_project_cli.py workspace-catalogue "$WORKSPACE"
python model/gis_project_cli.py workspace-export "$WORKSPACE" continued-selection.json
```

`adoption.json` contains `receipt_id`, `title`, `reason` and actual `layer_ids`
and/or `attachment_ids` from the received project's `project.json`. Select at least
one working layer, original table or document. A working-layer selection retains all
original attachments; an attachment-only selection can choose tables/documents
independently. An optional `review_id` retains the matching edition-comparison context. The returned
`source_collection_id` belongs to the original Workspace. Its `sources` array maps
each received layer ID to the native source ID. The next export selection can use
that collection and the same retained native source IDs.

The return operation also carries the selected layers' upstream originals, native
companions, provenance, history and attribution. Required context documents have
an explicit `gis_context_group`/`gis_required_context` binding; exporting only a
working layer still includes that layer's adoption context. Native companion
relationships retain their relative directory structure, including multi-file
source formats. Working files remain independent, so a colleague's edit never
changes the received originals or an earlier source collection. Repeating an
identical adoption, including recovery after its final response was lost, produces
the same original source collection instead of adding duplicates.

The actual full-size return exercise received five working layers, appended a
14-entry source edition (five geographic layers and nine context documents),
reopened it through the original Workspace, retained an actual Anderson County
attribute edit, and exported all five layers to a second independent receiver.
The 305 county features, two 3,252 by 3,273 rasters, original file identities and
attribution all survived the complete cycle. The native programme also removed
its final adoption response and recovered the same immutable source collection.

## Original atlas legends in desktop and offline views

A completed delivery can use the same numerical dataset in several map panels.
The GIS export retains each distinct saved scale as a named QGIS layer style.
It keeps one working GeoTIFF and one logical layer; the styles do not copy or
recalculate the dataset. Each style records its original map key and panel,
complete saved scale, units, color lookup, and the native band scale/offset.

In **OPEN_GIS.html**, open a layer's **Details** and choose **Atlas view**.
The map overview and legend change together. **Save view** retains that choice
with the existing layer visibility, extent and source-table selection; its view
address reopens the same choice for this exact edition. The matching native
**QGIS layer style** download is a relative QML file inside the complete project.

In QGIS, use the layer's **Styles** menu to choose the same named map view.
The project also retains the style files under **styles/**. Every named style
uses the original saved limits, the same resolved 256-color palette used by the
maintained atlas renderer, and endpoint colors outside the display limits.
Signed changes retain the original negative/zero/positive interpretation.
The full physical cell values, validity masks, declared CRS and companions are
unchanged. Band scale/offset are applied once in both the provider legend and
the offline display; original raw scale values remain in the style metadata.

The exporter stores the resolved palette and its Matplotlib version.
Only building a new atlas legend needs Matplotlib, already used by the original
atlas producer. Receiving a complete package and switching its styles use the
retained lookup. The QGIS shader encodes adjacent representable class boundaries
so its interpolated renderer follows the atlas's discrete color lookup instead
of inventing a new continuous stretch. Display reprojection and overview sampling
still use their declared native QGIS or nearest-cell display methods. Floating-point
normalization immediately beside a color-bin boundary can choose an adjacent
lookup color; the saved legend limits, units and resolved palette are retained.

Desktop edits remain authoritative in the selected QGS/QGZ. When sealing an
edition, a recognized original atlas style also selects its matching offline
overview. If the desktop renderer cannot be recognized, the package retains that native
renderer and explicitly labels the offline view as an original atlas view.
Recognition is conservative: native QGIS may add neutral pipe stages when saving,
which remain retained even when they are outside this original-style matcher.
It does not overwrite the recipient's native styling or describe an original
overview as a reproduction of an unrecognized desktop renderer.

The existing native receiving helper now selects every retained named style
in QGIS, compares its actual range and color stops, restores the selected style,
then renders, saves and independently reopens the project. On an edited edition,
it records which original styles still match while preserving the recipient's
additional changes. This uses the same complete-package native receiving command
documented above.

Serialization follows the original QGIS implementation:
- https://api.qgis.org/api/3.44/qgsmaplayerstylemanager_8cpp_source.html
- https://api.qgis.org/api/3.44/qgsmaplayerstyle_8cpp_source.html
- https://api.qgis.org/api/3.44/qgscolorrampshader_8cpp_source.html
- https://github.com/qgis/QGIS/blob/final-3_44_0/src/core/raster/qgssinglebandpseudocolorrenderer.cpp
