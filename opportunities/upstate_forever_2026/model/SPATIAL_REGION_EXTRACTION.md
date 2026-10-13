# Saved Area → editable native-grid GIS

This continuation adds **Create editable GIS extract** to the existing **Spatial review → Region measurements** result. Start with an actual saved Area analysis. The extract contains full-resolution original cells, their original coordinate system and band encoding, separate selection/support masks, the original Area geometry, readable statistics and a portable editable GIS project.

It does not run InVEST, interpolate pixels, calculate a new catchment or replace a retained source. The selected original Area and the existing GIS builder remain authoritative.

## Use the actual application

1. Open the original scientific Workspace, then **Spatial review**.
2. Select its original raster(s). Use the existing Area tool, **Use visible extent**, or **Measure this original polygon** on an inspected source feature. Choose the cell-inclusion rule and save the calculation.
3. Open that saved Area from **Saved region analyses**. Review its original source selections, units, valid-cell counts and any common-support difference.
4. Choose **Create editable GIS extract**. The ordinary workspace queue retains the request and progress. Repeating the same original request uses the same immutable extraction edition.
5. Open the extraction result. Download **Complete editable GIS ZIP**. Extract the complete archive into a new folder and open **OPEN_GIS.html** or **project.qgz** there. The QGIS file requires its packaged relative layers; do not send the QGZ alone.
6. Individual GeoTIFFs, masks, boundary GeoPackage, original analysis, CSV tables, report and exact implementation sources are also available through the existing verified download tickets.
7. Use the original editable-GIS receiving/sealing workflow for changed cartography or attributes. A changed GIS edition is independent of the retained Area/extraction. It does not revise the original scientific calculation automatically.

A project ID, Conservation plan ID, or paired SpatialReview ID is not a saved Area ID. If no Area exists, explicitly choose its real original sources and geometry through the original Area API/UI first.

## What the raster files mean

| Member | Meaning |
|---|---|
| Primary/comparison values | A rectangular integer window of one original band, retaining stored cell values, dtype, nodata declaration, scale, offset, native CRS and affine alignment. The internal display mask is selected-area AND original valid finite physical support. |
| Region mask | Unsigned byte: 1 when the original cell-centre or all-touched rule selects the cell; 0 otherwise. |
| Original-valid mask | Unsigned byte: 1 when the original band is unmasked and finite after its original scale/offset; 0 for original nodata/nonfinite support. This covers the entire extracted rectangle. |
| Comparison-minus-primary | Present only when the original Area declares aligned grids, matching physical units and noncategorical values. It contains scaled physical comparison minus primary, on common selected valid cells. |
| Common-valid mask | Unsigned byte: 1 only where both original rasters have selected valid support. |

The raw values outside the polygon but inside its rectangular window remain original values and are masked. Masks are separate data with explicit meanings; nodata is never silently converted to zero. Stream or structural codes are not reinterpreted as measured values. This generic Area tool preserves the original layer semantics.

Each raster uses its own original grid and window. Different grids can be exported together for inspection, but are not resampled into a manufactured common grid. The existing SpatialReview compatibility check determines whether subtraction is available.

Original projected grid-cell areas use the retained affine transform and CRS axis units. Geographic grids retain counts without inventing metric areas. A sum of pixel values retains its existing interpretation: a kg/ha/year raster is still a rate raster, and its raw pixel-value sum is not a kg/year mass. No new load, concentration, retention or field-observation claim is introduced.

Clipped DEM, flow-accumulation or routing rasters are working subsets. They are not a newly conditioned model domain, and their upstream dependencies are not reconstructed by clipping.

## Original geometry, identity and source

The package includes the selected boundary in its original selection CRS. For an original source feature, it also retains that feature's original geometry and every attribute, with explicit original feature ID and field-name mapping. A source attribute named fid is retained under a safe mapped name rather than being consumed by the GeoPackage's internal FID.

The existing Area validator reopens the selected feature from the original source; browser coordinates cannot replace that geometry. Every source file/companion is checked through the original SpatialReview reader. Exported selected/valid counts and common-valid counts must equal the saved Area result.

The extraction identity binds:

- the actual project, saved Area ID and complete original Area record hash;
- the explicit title/notes selection;
- the complete extraction and GIS implementation identities;
- the original GIS builder version.

Each committed directory retains a sealed extraction record and full file descriptors. Reopening checks the record, original Area identity, all retained members and the complete existing GIS inventory. Previous editions are immutable. A changed source implementation produces another explicit extraction edition; it does not overwrite an earlier edition.

The source provenance retains original layer bindings, source entry metadata, native encoding and original source IDs. Whole upstream scientific source files remain in the original Workspace. The portable GIS contains the extracted original cells and boundary, exact provenance, original analysis/tables, and full producer source files.

## Installed source closure

The additive fragment is:
integration/component_fragments/spatial-region-extraction.json

It extends the existing spatial-regions component, retaining the original descriptor, adapter and UI. It explicitly includes the new kernel, this guide, the receiving commands and dynamically copied GIS sources, and requires the existing gis-projects component. It does not replace the global component catalogue.

The original application assembler resolves the selected component and its existing dependency closure. Install the complete resulting source edition through the maintained application receiving mechanism. A loose new kernel file is insufficient: its adapter, extension descriptor and current Area UI must come from the same edition.

The unchanged AGENTS.md and CURRENT_OWNER_DIRECTION.md travel with this component. Do not rewrite those instructions in a downstream package.

## Model/API contract

    from model.workspace import Workspace
    from model.spatial_regions import SpatialRegions
    from model.spatial_region_extract import RegionExtracts

    ws = Workspace("/actual/original/workspace")
    available = SpatialRegions(ws).catalog()
    # Choose one returned record's id explicitly.
    extracts = RegionExtracts(ws)
    result = extracts.export({"analysis_id": actual_saved_area_id})
    reopened = extracts.inspect(result["id"])

Optional export fields are title and notes. No replacement raster values, geometry, units or source bindings are accepted.

The existing queued action is spatial.region.extract. Payload:
{"analysis_id":"<actual saved 64-character Area ID>","title":"Optional authored title","notes":"Optional authored notes"}

Read routes are /api/spatial/regions/extract and /api/spatial/regions/extracts. They use the original workspace selection/authentication and download tickets. The extraction item kind is spatial_region_extractions. These are additions to the existing region adapter; ordinary region analyses and their exports remain unchanged.

## Run the original receiving course

Use the installed application and its existing scientific Python runtime. First list actual saved Areas:

    /actual/runtime/bin/python source_tools/receive_spatial_region_extract.py \
      --workspace /actual/original/workspace --catalog-only

Then choose one actual ID from that returned inventory:

    /actual/runtime/bin/python source_tools/receive_spatial_region_extract.py \
      --workspace /actual/original/workspace \
      --analysis-id ACTUAL_SAVED_AREA_ID \
      --output /actual/receiving/area-gis

If the Workspace contains no saved Area, the command fails clearly. An analyst may instead supply an explicitly authored JSON file with the original SpatialRegions.analyze request using --area-request. It must name actual original raster selections and actual geometry/source feature. The receiver does not select a model run, substitute a Conservation geometry, or fabricate a rectangle.

The course durably admits its exact input and source identities before creating an explicitly requested Area or extraction. It retains supplied Area JSON bytes unchanged, replays the same extraction, receives the complete original GIS ZIP into a separate directory, and opens the original Workspace/GIS package in a fresh Python process. It checks all original members, raster/vector readback, JSON and CSV attachments. It retains errors and the exact original output; a failure does not become a success receipt.

Output includes:
- request.json, selection.json and original-area.json;
- extraction.json and editable-area-gis.zip;
- received-gis/ with OPEN_GIS.html, project.qgz and the complete relative data;
- cold-process.json and cold-readback.json;
- result.json, or failure.json with the original error.

Archive copies are staged and checked before a no-replace publication. An interruption never turns a partial copy into the final archive name. An existing different file remains untouched for review.

Replay requires the same Area, source implementation, optional title/notes and output selection. Use a new receiving output for another edition. Do not change the input of an already-retained request.

Where QGIS Python is actually installed, add --qgis-python /actual/qgis/python. This invokes the existing gis_project_native.py on an independent copy: open original project, render native layers, save and reopen the QGIS edition. It retains qgis-native.png and the original source remains unchanged. Missing QGIS is reported as not executed; it is not a claimed visual check.

## Actual browser operation

The browser companion operates the original Area controls and original download links. Use only an authorized isolated browser provided by the producing host. It does not override a denied navigation, enter a reserved local browser or create a second native job.

Create a private local configuration file (do not publish the capability URL):

    {
      "operatorUrl": "http://127.0.0.1:ACTUAL_PORT/#token=ACTUAL_AUTHORIZED_CAPABILITY",
      "workspaceKey": "ACTUAL_OPERATOR_WORKSPACE_KEY",
      "analysisId": "ACTUAL_SAVED_AREA_ID",
      "extractionId": "ACTUAL_EXTRACTION_ID",
      "outputDirectory": "/actual/receiving/area-browser",
      "playwrightModule": "/actual/installed/playwright/index.mjs",
      "executablePath": "/actual/installed/chromium",
      "receivedDirectory": "/actual/receiving/area-gis/received-gis"
    }

Run:

    /actual/node source_tools/receive_spatial_region_extract_browser.mjs /private/config.json

For the ordinary button replay, select the default extraction created without custom title/notes; the existing button submits only the saved Area ID. The companion rejects a custom extraction before clicking. Custom editions remain inspectable and downloadable from saved history without falsely claiming they are the default button's edition.

The course opens the selected Workspace and saved Area, restores the actual Area controls, exercises an empty saved-analysis search, uses Create editable GIS extract through the real queue, confirms the same immutable edition, downloads every displayed original member and compares its exact bytes/hash, opens the actual readable report and portable catalogue, reloads and reopens the saved extraction. It captures desktop and 390-pixel layouts. Before forwarding the actual UI-generated action, it atomically retains the original operation UUID and complete request. It retains the accepted task response before polling. A restarted course reopens that task; an acknowledgment lost before retention is resolved from the original task history. If an original coalescing alias cannot be resolved through that history, the course retains explicit ambiguity and stops instead of silently issuing another request. A failure is retained; it does not silently try another browser/controller.

The browser result is evidence of the operated controls, not a claim that a person looked at the screenshots.

## Producing owner acceptance

Follow the complete current owner directions shipped with the application. The producing owner must open/run/render the exact outgoing edition, LOOK at the actual screens/screenshots, and use the important controls at desktop and narrow widths. Check relevant populated, empty, loading and error states with focused repairs where a defect is observed.

Open every outgoing attachment in its normal recipient form. View the HTML reports and portable catalogue; read the CSV/JSON/source attachments; open the actual GeoTIFFs/masks and GeoPackages; open, render, save and reopen the complete QGIS project on an equipped host. Inspect every produced map/report page and the archive's real received contents. Source parsing, hash checks, DOM/HTTP success and peer approval are not substitutes for this product inspection.

Keep the original native process and host ownership. This course is a continuation after the already accepted scientific operation reaches its boundary; it creates no parallel native run and executes no scientific models.
