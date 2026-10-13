# Water and Habitat Context operator service

Authored by TokenJunkieLabs.

This provider connects the retained scientific context core to the existing Upper Savannah operator. The browser desk and command-line entry point use the same saved analyses, source selections and output files.

## Application files

- operator/water_context_service.py: registered provider.
- water_context_cli.py: command-line operation of the existing Workspace.
- model/water_context.py and model/WATER_CONTEXT.md: scientific calculation and methods.
- operator/extensions/water-context.json and operator/web/water_context.mjs: browser registration and desk supplied with the companion integration.

Use the existing application Python environment. A build requires the Fiona/GDAL, Shapely, pyproj and rasterio environment used by the original retained-vector/raster workflow. Catalog and saved-record reads use retained JSON metadata.

## Provider bindings

The existing extension registry imports the plain module water_context_service and constructs WaterContextService(operator, fault). Bind the following public methods:

| Binding | Method | Context arguments |
| --- | --- | --- |
| Action water-context.build | invoke | task |
| State key water_context | state | workspace_key |
| GET/POST /api/water-context/catalog | read, operation catalog | workspace_key, operation, payload |
| GET/POST /api/water-context/analysis | read, operation analysis | workspace_key, operation, payload |
| GET/POST /api/water-context/preview | read, operation preview | workspace_key, operation, payload |
| Item kind water-context | read, operation analysis | workspace_key, operation, payload |
| Task downloads | decorate_task | task |
| Receiving verification | verify_workspace | workspace |

The state contribution is an object with schema, method and analyses. The browser reads state.data.water_context.analyses. Refresh reads saved analysis manifests without source verification or GIS work.

The provider obtains every Workspace through Operator.ws(workspace_key). Original session authentication, task serialization, idempotent operation IDs, task resume/cancel and verified file delivery remain in the existing operator.

## Build and read requests

Submit a build to the original POST /api/actions endpoint:

    {
      "workspace": "<registered workspace key>",
      "action": "water-context.build",
      "operation_id": "<new UUID retained for this action>",
      "payload": {
        "selection": {
          "title": "Upper Savannah water and habitat context",
          "boundary": {
            "collection_id": "<retained collection ID>",
            "source_id": "<retained polygon source ID>"
          },
          "overlays": {
            "wetlands": {
              "collection_id": "<retained collection ID>",
              "source_id": "<NWI vector or prepared NWI_CONTEXT source ID>"
            },
            "flowlines": {
              "collection_id": "<retained collection ID>",
              "source_id": "<NHD flowline source ID>"
            }
          },
          "relations": [],
          "measurement_crs": "EPSG:5070"
        }
      }
    }

To reuse an immutable selection, supply payload.selection_id instead of payload.selection. The service requires exactly one of those inputs. The full selection contract, supported categories, field/feature filters and mapping-status behavior are documented in model/WATER_CONTEXT.md.

The action returns the original task. Read GET /api/task?id=TASK_ID for completion. A successful task has state complete and result fields kind, id, analysis_id, title, state, selection_id and summary. Completed tasks also have _downloads with the original verified file tickets.

Catalog requests return the core sources, collections, boundaries, categories and analyses arrays. Analysis and preview requests accept analysis_id; id and view_id are compatible aliases. When multiple aliases are supplied they must identify the same saved analysis.

POST /api/water-context/analysis accepts:

    {"workspace": "<registered workspace key>", "analysis_id": "<saved analysis ID>"}

Its response is the saved core record with _downloads and boundary_summaries. Completed boundary summaries are read from their verified retained artifact. The array preserves native boundary identity, selected overlap, both percentage denominators and local inventory statistics.

The preview route returns the precomputed preview envelope, including its feature count, shown count and truncation information. The complete unsimplified geometry is available through the geojson export.

## Downloads and receiving

Files use the original descriptor contract: path relative to the analysis directory, bytes and sha256. The service resolves that contained path and registers it with Operator._ticket. Routine task decoration does not rehash exports. Original file delivery verifies the requested artifact.

Downloads carry artifact keys suitable for stable browser controls. The main keys are archive, geojson, summary_csv, boundary_summaries_csv, features_csv and relationships_csv. Additional keys provide selection, sources, summary_json, boundary_summaries_json, geometry_corrections, preview, readme and portable_record.

The complete derived export is context-analysis.zip. Full workspace backup/restore retains the native input editions and immutable choices needed for continued editing and rebuilding. The existing recursive workspace archive includes water-context and water-context-selections.

Receiving verification checks completed context artifacts and retained selections through the core verifier. A valid saved failed/building attempt is reported as unfinished so its history can travel with the Workspace. A changed source selection or inconsistent completed artifact is an explicit receiving error.

## Command-line workflow

Run from the complete application directory, using its configured Python environment. Replace paths and retained IDs with the actual source catalogue values.

    python water_context_cli.py --workspace /path/to/workspace catalog
    python water_context_cli.py --workspace /path/to/workspace list
    python water_context_cli.py --workspace /path/to/workspace build --selection selection.json
    python water_context_cli.py --workspace /path/to/workspace build --selection-id SAVED_SELECTION_ID
    python water_context_cli.py --workspace /path/to/workspace show ANALYSIS_ID --boundaries
    python water_context_cli.py --workspace /path/to/workspace preview ANALYSIS_ID
    python water_context_cli.py --workspace /path/to/workspace export ANALYSIS_ID --output context-analysis.zip
    python water_context_cli.py --workspace /path/to/workspace export ANALYSIS_ID --artifact geojson --output water-habitat-context.geojson
    python water_context_cli.py --workspace /path/to/workspace verify

build --selection - reads the complete selection from standard input. Build reopens an already completed identical calculation through the core's deterministic selection/source identity.

All command results are JSON. Successful commands return exit status 0. Verification returns 1 when the core report has incomplete or inconsistent analyses. Input or execution errors return 2 with a JSON error on standard error.

Export copies one saved artifact while checking its recorded byte count and SHA-256, then publishes the destination atomically. The default artifact is the complete archive. Existing output files require the explicit --overwrite option. Exporting the selection artifact provides a reusable build input.

## Interpretation in the desk

Use NWI aquatic inventory, Digital NWI mapping, NHD flowline inventory and PAD-US inventory coverage as the headline concepts. Native category labels remain attached to class breakdowns.

Mapped coverage without selected NWI occurrence uses mapped_no_selected_occurrence_area_ha. The HUC/utility selection_share_pct denominator is the union of the reporting selection; source_boundary_share_pct uses the full original native polygon. Local inventory percentages use their selected overlap.

Areas use projected metre geometry, default EPSG:5070. Flowline lengths use WGS84 ellipsoidal geodesic measurement. Spatial relationships and map proximity retain those meanings; source-water routing and native nutrient/sediment model results remain in their corresponding application desks.
