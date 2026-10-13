# Prepare original scientific sources in the operator

The source preparation desk runs the existing native input helpers on the
operator's original task queue. It covers numeric elevation, Annual NLCD land
cover, annual precipitation, rainfall erosivity and whole-soil erodibility. A
completed preparation can enter the scientific source catalogue immediately or
join other completed inputs in a composed source edition.

## Native source operations

| Method | Existing implementation | Result |
| --- | --- | --- |
| USGS elevation | source_tools.raster_sources.prepare_dem | Original Float32 elevation tiles assembled on the selected land-cover grid; metres. |
| PRISM precipitation | source_tools.raster_sources.prepare_prism | Original 1991–2020 annual normal and metadata; annual precipitation is the explicit NDR runoff proxy. |
| Annual NLCD | source_tools.nlcd_static.receive and prepare | The retained 2025 Collection 1.2 national product, clipped locally to the complete selected upstream domain. |
| NOAA erosivity | source_tools.erosivity_sources.receive_original and prepare | Original historical R-factor raster, physical conversion and source period. |
| USDA whole-soil K | source_tools.soil_sources.prepare | Native whole-soil surface interpretation and mapunit geometry on the selected model grid, with missing-data policy and SI conversion. |

The original helpers retain their provider contracts, exact raster geometry,
source editions, units, native interpretation choices and public-source request
receipts. Their existing partial/completed outputs remain the continuation
points. This adapter supplies selection, durable original inputs, native task
progress, composition and scientific-workspace import.

## Select the files already available

Start the operator with its original scientific workspace and state directory.
Register native source directories with the integration's repeated
--source-root option, alongside existing --source-manifest registrations. A
registered manifest's parent directory is also available to the source desk.
These paths may hold the existing large national archive or source packets
received through the current source operation.

The desk can select an imported scientific source, an operator upload, bundled
original source metadata, or a file beneath a registered directory. Directory
navigation is paginated and preserves the actual filenames. Source selection
does not accept an arbitrary browser-supplied host path.

For a shapefile, the original SHP, SHX, DBF and PRJ travel together; present CPG,
QPJ and XML sidecars are retained as well. A selected imported source also keeps
its declared native companions. The Annual NLCD static metadata manifest keeps
its original XML beside the exact original manifest.

Prepare the original NLCD domain before selecting it as the reference for DEM
or soil preparation. Use the same complete upstream-domain vector and positive
buffer for all related grid inputs. The reporting mask remains the separate
South Carolina reporting selection already used by the scientific workspace.

The PRISM and NOAA modes default to an existing complete original archive.
Select its original capture or completed transfer receipt as required by that
helper. Explicit download mode selects the helper's fixed published national
archive. The Annual NLCD operation always receives the completed national
archive and makes its domain clip locally.

The land-cover desk also exposes the native reading mode. Choose **Read the
original ZIP directly** to use the maintained archive reader, which verifies
complete TIFF/sidecar hashes and ZIP CRC and reads through GDAL's native
/vsizip/ path. It retains the complete national archive and local categorical
clip without a second full national TIFF. Choose **Expand the original
national TIFF** when that existing read mode is the intended selection. An
omitted mode preserves earlier task selections and the helper's existing
expanded behavior. Changing modes creates a new explicit source selection.

Archive reading requires the current source_tools/nlcd_static.py successor
from F0C88DUTKST, 53,363 bytes, SHA256
1234d1cc1bb1bc4cbcfe695f7e681ddda807d161ece7eced73126f88416ad24e,
or its compatible successor. Both modes preserve the original domain, grid,
classes, NoData, source identity and source-manifest contract.

The national land-cover receiver reads the actual archive byte count from the
selected retained file. Its TIFF expansion capacity is selected explicitly
within the operator's configured extraction limit. The original helper reads
the real member inventory, native CRS, affine, classes and NoData.

## Preparation and recovery

The submitted source action has the same immutable operation identity and
request hash as every other operator task. Native execution uses the existing
single-worker queue and workspace gate, keeping independent HTTP reads
responsive.

The source desk records its current stage before work starts and records the
actual completion or error afterward. Stages include original-input retention,
native acquisition/preparation, source-packet assembly, project-transfer
retention and source import. The normal task view remains the place to inspect
an exception and resume that exact retained operation.

Input snapshots are recorded separately from the current host location. Their
original bytes enter the workspace content-addressed object store, and native
views retain the original filename and companion relationships. A resumed
preparation rebuilds missing views from those originals. Moving or removing an
external input directory does not silently select a different file.

Native working directories live under:

    OPERATOR_STATE/source-preparation/PROJECT_UUID/TASK_ID/

The workspace retains operation, selection, source-manifest and prepared-file
records under:

    WORKSPACE/source-preparation/TASK_ID/

Every completed source-manifest body and companion is retained in the
workspace object store. Consequently a prepared source can be composed after a
full workspace restore even when its previous operator-state directory is not
present. The source desk does this by reconstructing the original manifest
paths from the retained prepared-file bank. Completed inputs are retained even
when automatic catalogue import was deselected.

Incomplete provider working files remain in the original native task directory
for same-host continuation. The existing source helper determines whether a
particular original request can resume and honors its provider retry metadata.
The adapter adds no automatic source-download retry loop.

## Compose the useful scientific edition

A composition selects any combination of completed preparation tasks, imported
source collections and registered native source manifests. The operation
materializes their original files inside its native directory, preserving
relative paths and native sidecars, then invokes the existing source composer.

The composer retains original manifests as document sources, checks declared
bytes and hashes, and identifies duplicate source IDs. Choose compatible
source editions rather than selecting the same imported preparation twice.
Composition returns the native manifest and, by default, its imported source
collection ID. That ID is directly usable by the existing grid/profile/scenario
and scientific-run selection.

Preparation and composition both accept import_sources=false when the operator
wants to assemble the full source edition first. The completed bank remains
available to a later composition. With the default true value, the existing
Workspace.import_sources registers the prepared edition immediately.

Source metadata returns actual physical units, native raster coverage when the
helper supplies it, original conversion declarations and source resolution.
Coarser precipitation or R-factor inputs retain their original resolution
through 30 m model-grid preparation. K-factor NoData and the optional
original-NLCD open-water policy retain their existing scientific meaning.

## Native elevation progress and receiving concurrency

The elevation method exposes workers as a positive whole number with the
native default of one. This changes receiving concurrency while retaining the
same immutable source grid, original request plan and prepared source identity.
The existing helper honors actual provider responses and retains completed
tiles for its next invocation.

The desk passes the helper's progress dictionary into the original task's
operation record. During acquisition it reports original tile count, complete,
failed, pending and reused tiles, received bytes, worker count and any provider
deferral. During assembly it reports assembled tiles, valid cells and NoData
cells. Stage text and the string-array log tail expose those actual counts;
native_progress preserves the complete small callback dictionary for clients
that render numeric progress directly. Full per-tile native records stay with
the helper's prepared source packet.

This adapter uses the current original raster helper published at:

https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/cd5731674b42f4ad2ed655fa1e2f355e76f9d763/opportunities/upstate_forever_2026/source_tools/raster_sources.py

Its prepare_dem signature includes the additive workers and progress arguments.
The receiving source tree must contain that implementation or a compatible
successor. The helper's original completed-result path may return immediately
without emitting another progress event.

## Integration contract

The current complete operator uses the shared extension registry. Install these complete source files with the current application, then run its `install_extensions.py` against that application. The existing `operator/extensions/source-preparation.json` descriptor constructs this backend and registers the actions, reads and task decoration. The corresponding native-run-desk descriptor registers the run controls. This is the receiving route for the cumulative application.

The direct integration shown below is the alternative for an application that uses explicit shared-file registrations. Select one registration route so the same action and desk have one owner.

Import the additive module after the operator's registered source manifests
have been initialized:

    from source_preparation import SourcePreparation
    from source_preparation import ACTIONS as SOURCE_PREPARATION_ACTIONS
    from source_preparation import READS as SOURCE_PREPARATION_READS

    operator.source_preparation = SourcePreparation(
        operator, Fault, source_roots=source_roots)

Add SOURCE_PREPARATION_ACTIONS to the existing accepted actions and dispatch
them through source_preparation.invoke(task) inside the original worker.
Call source_preparation.decorate_task(task) in the existing task-view path.

Expose authenticated read routes for:

    GET or POST /api/source-preparation/catalog
    GET or POST /api/source-preparation/files
    GET or POST /api/source-preparation/progress
    GET or POST /api/source-preparation/result

All use read(workspace_key, operation, payload). Source preparations remain
ordinary POST /api/actions tasks.

Preparation payload:

    {
      "method": "dem",
      "title": "Upper Savannah original elevation",
      "inputs": {
        "reference": {"collection_id": "retained collection ID", "source_id": "actual NLCD source ID"},
        "domain": {"collection_id": "retained collection ID", "source_id": "actual upstream-domain source ID"},
        "metadata": {"builtin_id": "dem-metadata"}
      },
      "options": {
        "vintage": "Original source edition selected in retained metadata",
        "buffer_m": 1000,
        "tile_size": 2048,
        "workers": 1
      },
      "import_sources": true
    }

A file selector uses exactly one of:

    {"collection_id": "collection ID", "source_id": "source ID"}
    {"collection_id": "collection ID", "source_id": "source ID", "companion_path": "exact original companion path"}
    {"upload_id": "existing operator upload ID"}
    {"builtin_id": "catalogue builtin ID"}
    {"root_id": "registered source root ID", "path": "relative/original-file.zip"}

Composition payload:

    {
      "title": "Upper Savannah complete physical inputs",
      "prepared_task_ids": ["completed source task ID"],
      "source_collection_ids": ["retained geography/parameter collection ID"],
      "registered_ids": [],
      "import_sources": true
    }

The catalogue returns methods with id/title/description/role, inputs with
name/label/required/kinds/help/default, and options with
name/label/type/required/default/choices/help. Types are text, number and select;
whole-number options additionally carry integer:true and step:1. Choices use
{value,label} objects. Received-archive inputs use
when:{field:"source_mode",equals:"received"} so download mode displays only the
relevant controls.
It also returns roots, bundled references, imported sources, uploads, registered
manifests, preparation summaries and the actual operator limits. Each imported
source lists companions with exact native path, filename title, kind, byte
count, SHA256 and a complete companion selector. A view_path match takes
precedence over an original source_path or filename match, preserving distinct
native files that share a basename.

Directory reads take root_id, path and optional offset/limit; limit defaults
to 200 and supports page sizes from 1 to 500. They return entries
with name/path/is_dir/bytes plus total_entries and next_offset. The root path
is the empty string.

Progress reads take task_id and return task_id/state/stage/elapsed_seconds,
updated_at, error, outputs and log_tail. The log tail is an array of completed
or current native-stage descriptions. Result reads return the same progress,
the complete result and the retained stage history. Preparation summaries and
progress reconcile the original queue state after an operator restart, so an
interrupted task appears interrupted and can use the queue's existing Resume
action. A transferred completed preparation remains available when the
receiving operator has a different task queue.

A successful result contains task_id, source_collection_id, source_count,
physical_source_count, manifest_sha256, manifest_path, native_directory,
imported and downloadable record documents. Individual preparations also
return source_id, role and a source_entry summary with actual units,
conversions, source vintage/resolution and the helper's observed coverage.

## Primary source references

- Issuer RFP and appendix: https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf
- Official NDR model documentation: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html
- Official SDR model documentation: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html
- USGS elevation service: https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer
- PRISM annual source: https://data.prism.oregonstate.edu/normals/us/800m/ppt/monthly/prism_ppt_us_30s_2020_avg_30y.zip
- Original Annual NLCD national archive: https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/data-bundles/Annual_NLCD_LndCov_2025_CU_C1V2.zip
- NOAA original R-factor metadata: https://www.fisheries.noaa.gov/inport/item/48224
- USDA original native interpretation interface: https://sdmdataaccess.nrcs.usda.gov/documents/AdvancedQueries.html

The selected original helper and source manifests retain the edition used by
each preparation; the current documentation URLs are supporting references.
