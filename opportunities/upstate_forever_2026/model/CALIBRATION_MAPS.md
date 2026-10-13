# Original-catchment calibration maps and editable GIS

This workflow connects a completed annual-load calibration to its actual upstream catchments. It creates registered vector sources, complete numeric tables, per-pollutant atlases and ordinary saved Spatial reviews. Those same sources enter the maintained editable GIS exporter without a new model runner or a separate map application.

Every figure and vector attribute derives from an existing completed calibration report. The workflow keeps the original selected candidate, observation edition, catchment IDs, source periods, calibration/validation split, normalization scales and native support. It can add the already saved published-source-error supplement.

## Operator workflow

Open the completed calibration, choose **Prepare original catchment maps**, and select the existing source-error supplement if needed. The default includes the original selected candidate. Additional eligible candidate runs can be included for calibration units only.

The resulting retained map edition provides:

- A source layer for every selected candidate/pollutant pair, with complete original catchment polygons and numeric residual attributes.
- A PDF atlas and scalable SVG pages for each layer.
- A CSV containing all plotted and inspectable values, original source-record IDs and periods.
- A printable HTML index linking the complete files.
- Original calibration, selection, observation-edition and source-CSV copies, plus source-error JSON when selected.
- Direct opening of each registered vector in the existing Spatial review.
- A saved Spatial review with solid calibration outlines and dashed held-out selected-candidate outlines.
- A ready selection for the original editable GIS export, including scientific context attachments.

The native Spatial review uses its maintained outline and point-attribute inspection controls. Its ordinary vector overlays are not described as a shaded residual raster. The separate atlas provides signed residual figures with grayscale magnitude.

The model API is:

```python
from model import calibration_maps

maps = calibration_maps.prepare(
    workspace,
    actual_completed_calibration_id,
    uncertainty_id=actual_retained_source_error_id,  # optional
    candidate_run_ids=actual_eligible_run_ids,       # optional; defaults to selected
)
maps = calibration_maps.inspect(workspace, maps["id"])
link = calibration_maps.save_review(workspace, maps["id"], maps["layers"][0]["id"])
```

Only existing IDs are accepted. Selected run ordering follows the original ranking, so changing checkbox order does not create a second edition. The original selected candidate must remain in the chosen cohort.

Command line, from the application root:

```sh
python -m model.calibration_maps /path/to/original/workspace prepare EXISTING_CALIBRATION_ID
python -m model.calibration_maps /path/to/original/workspace prepare EXISTING_CALIBRATION_ID --uncertainty-id EXISTING_UNCERTAINTY_ID
python -m model.calibration_maps /path/to/original/workspace inspect RETURNED_MAP_ID
python -m model.calibration_maps /path/to/original/workspace save-review RETURNED_MAP_ID EXISTING_LAYER_ID
```

Repeat `--candidate-run-id` for an explicit cohort, including the originally selected run. The action uses completed saved prediction rows; it does not execute InVEST or fit a new estimator.

## Original geometry and coordinate systems

The original calibration plan identifies its source collection, vector source, native layer, property filter and catchment identity field. The workflow reopens that exact retained source through `Workspace.source_file`, which verifies original bytes, hashes and companion relationships. Its primary body must match the catchment source recorded in the original calibration spatial grouping.

The original catchment identity field must remain unique and non-null. Every required calibration catchment must be present. A valid Polygon or MultiPolygon is required; invalid geometry receives an explicit exception rather than an automatic repair.

The maintained `rasters.vector_geometry` reader handles the original native vector source, including its gzip path support. All polygon components and interior rings remain present.

Two coordinate systems serve different purposes:

| Product | Coordinates |
| --- | --- |
| Registered GeoJSON | EPSG:4326 longitude/latitude, transformed from the original source with explicit x/y axis order |
| Atlas and saved review | The originally selected candidate's retained projected model-grid CRS in metres |
| Source provenance | Original source WKT, output CRS, actual atlas CRS and source body/companions |

The atlas projection comes from the original saved model grid; it is not an assumed statewide projection. Reprojection is checked for valid finite geometry. There is no union, simplification, clipping, rasterization or replacement catchment delineation.

## What one feature means

One feature represents one original catchment/pollutant reference unit for one selected completed candidate. The feature ID binds the original run ID and unit ID. The original catchment ID, source feature ID, station IDs, candidate/profile identity, parameter and native units remain scalar or JSON-text attributes.

The physical quantities are:

| Field | Meaning |
| --- | --- |
| `observed_annual_mass` | Original saved time-weighted annual reference for this catchment/pollutant |
| `native_annual_mass` | Retained completed native catchment load |
| `delivered_external_annual_mass` | Original explicitly supplied delivered external load |
| `predicted_annual_mass` | The quantity used by the original calibration, including that external load |
| `residual` | Predicted annual load minus original annual reference |
| `absolute_residual` | Magnitude of that signed residual |
| `relative_residual_percent` | 100 × residual / reference, only when the original reference is positive |
| `normalized_residual` | Residual divided by the original retained pollutant normalization scale |

Nitrogen and phosphorus retain kg/year. Sediment retains metric tonnes/year. Each source layer and each atlas is specific to one pollutant. No cross-pollutant mass sum is supplied.

The CSV and vector fields retain original source-record IDs, weighted source periods, methods, qualifiers and uncertainty details. The CSV uses the existing operator spreadsheet convention: text beginning with a formula-control prefix receives a leading apostrophe, while numeric quantities, including negative residuals, remain numeric. Exact text stays unchanged in JSON and GeoJSON. JSON-text attributes preserve lists and structured source details without losing their meaning in GeoPackage field conversion. `provenance.json` also keeps the complete original reference units and prediction rows.

## Native support and held-out observations

The workflow uses the original comparison's whole-catchment support result. Included values preserve valid-cell, structural-stream-omission and unexpected-missing-cell counts. Native calculations and stream-mask rules remain those of the saved original comparison.

An eligible calibration candidate must have complete calibration support. If that historical invariant is absent, preparation raises a concrete error rather than manufacturing a residual.

The original selected candidate can have incomplete held-out native support. Such features remain in the map with their original reference, partition and issues, while predicted/native/residual values remain null. They are never rendered as zero errors. White fill with an unavailable residual label distinguishes missing support from a numerical zero, and the complete table states coverage explicitly.

Additional candidate layers include calibration units only. They do not introduce challenger rankings or maps on held-out observations. The original full report is retained as an exact source attachment.

## Nested catchments and atlas reading

Catchments can share upstream land or contain one another. They remain separate features. Their source loads and residuals describe different original upstream areas and must not be added as independent regional totals.

The atlas avoids a last-feature-wins rasterization. Each panel draws one complete original catchment, including all components and holes. Nested areas therefore remain readable and do not obscure one another.

Every panel contains its original catchment ID, calibration or validation role, observed/predicted annual loads, native/external contributions, signed residual and source-reference band when selected. Solid panel frames denote calibration units; dashed frames denote held-out evaluation of the original selected candidate.

The SVG page reports each panel's exact projected bounding span in kilometres. Panels have individual extents; area comparisons should use the retained geometry and spans rather than apparent panel size. The PDF repeats the individual-extent interpretation. The atlas follows the original projected grid; it does not claim a true-north azimuth from an uncomputed convergence correction.

Grayscale encodes absolute residual magnitude. The numeric signed residual supplies direction. Light gray corresponds to zero magnitude and darker fill to larger magnitude. White/unfilled polygons have unavailable residuals, which are explicitly labeled. The maximum absolute residual for each pollutant is computed over the chosen saved candidates and applied consistently to that pollutant's atlases. This is a display scale, not a new calibration objective or probabilistic confidence measure.

PDFs use the existing Matplotlib runtime; SVG pages are created directly from the original projected coordinates. Original geometry and full precision attributes remain in GeoJSON independently of display coordinates. Matplotlib metadata excludes creation timestamps so interrupted reruns do not generate artificial scientific editions.

## Optional source-error bands

A source-error selection must be an existing `calibration-uncertainties` item for the same exact calibration. Its original dependency validator verifies the report, plan, observations and source CSV.

The reference endpoints come directly from its saved `reference_units`:

- `reference_lower` and `reference_upper` retain the original per-unit sensitivity region.
- `minimum_residual` equals the fixed predicted load minus the upper reference.
- `maximum_residual` equals the fixed predicted load minus the lower reference.
- `standard_errors`, `source_error_state` and missing source-record IDs retain coverage and selected multiplier.

Missing errors remain uncovered, and an unselected supplement stays explicitly unselected. The map workflow does not recalculate source error, change normalization or create an uncertainty distribution. See `model/CALIBRATION_UNCERTAINTY.md` for the exact shared-source sensitivity interpretation.

## Source registration and existing GIS export

The generated manifest uses the original `upstate.sources/v1` interface and is admitted through `Workspace.import_sources`. Each vector entry identifies its calibration, run, profile, parameter, native units and signed residual direction. It is labeled as derived calibration residual geometry rather than a new observation acquisition.

The generated source collection becomes available immediately through `SpatialReview.catalog`. Its original catalog ID is saved in each layer's `spatial_selection`. The same vector supports original property filtering and numeric point inspection.

Each layer and its context document share a `gis_context_group`. The context document sets `gis_required_context: true`, allowing the existing editable GIS request to include complete reference/atlas attachments automatically when a user selects one residual layer.

The returned `gis_selection` is directly compatible with:

```python
from model import gis_workspace
exported = gis_workspace.export(workspace, maps["gis_selection"])
```

The existing operator action `gis.project.export` accepts that selection directly as its payload. It produces the existing editable QGIS/GeoPackage package, complete source layers and accompanying original scientific records. No alternate GIS exporter is introduced.

Source-only GIS handovers require a display CRS. The prepared selection supplies the actual original model-grid CRS explicitly. Vector attributes retain their ordinary GIS field meanings and remain editable in the original received-then-adopted edition workflow.

## Saved geographic review and reopen behavior

`save_review` calls the maintained `SpatialReview.save` API with:

- The exact registered residual source as reference.
- Its actual projected catchment bounds.
- Single mode with no invented raster primary/comparison.
- Separate exact `partition` property filters for calibration and held-out observations.
- Solid and dashed outlines, respectively.
- Original scientific interpretation and the retained calibration map ID in the notes.

The original Spatial review saves its own immutable source bindings and ID. A separate immutable `calibration-map-reviews` linkage records:

```text
map_id, layer_id, review_id, source_collection_id, source_id
```

This preserves reopened discovery without mutating the immutable map result. The operator can list links matching `map_id` and open the original saved review through its existing spatial item controls.

## Artifacts, validation and interruption recovery

A completed map result is stored in `calibration-maps/<id>.json`. Files live under `calibration-map-exports/<selection_id>/`, where the selection binds the original report, plan, source edition, candidate cohort and optional error supplement.

A verified existing result reopens directly. PDF and complete-layer checkpoints retain byte counts and hashes so interruption does not force repetition of already completed native atlas rendering. Source JSON/CSV/SVG files use immutable atomic writes. The original source importer retains its content-addressed behavior, so a retry does not duplicate an identical source edition.

`inspect` checks:

- Original completed calibration, plan, observation edition and source CSV.
- Original optional source-error supplement.
- Exact map selection and artifact directory.
- Every exported file's retained byte count and SHA-256.
- Registered derived source bodies and companions.
- Original observation catchment body identity.

It uses retained metadata/file validation and does not need to rerun model outputs or render figures. The application restore hook can use it when adopting a saved workspace.

The result exposes full layer IDs, source collection/entry IDs, native model/profile IDs, row counts by partition, incomplete support counts, file descriptors, exact source selection, original coordinate systems and the ready GIS selection. Complete original files accompany the human-readable atlas and tables.

## Runtime and scientific dependencies

Preparation uses the application's maintained Fiona, Shapely, PyProj and Matplotlib runtime. The module imports those libraries only for actual geometry/rendering work. Readback uses the original stdlib/file validation and retained source APIs.

Dependencies remain the current `model.common`, `model.calibration_uncertainty`, `model.rasters`, `model.spatial`, Workspace and existing editable GIS modules. The workflow preserves the current observation-ingest owner's point/daily context improvements; it changes no observation admission or annual-load comparison arithmetic.

The exported residuals are interpreted within the same original source period, native model vintage, catchment support, explicit external-load choices and model-process limitations as the completed calibration. Geographic presentation makes those actual results easier to inspect and deliver while preserving their original scientific identity.
