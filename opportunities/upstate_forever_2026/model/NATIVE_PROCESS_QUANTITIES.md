# Native process quantities

The process report explains the completed NDR and SDR calculations behind a baseline and its alternatives. It reads the original model registry, preserves the original model-domain polygons, and produces a source document that can be selected alongside the observed-flow, monitoring and other scientific reports in the existing delivery workflow.

The report includes original nutrient loads and exports, watershed nutrient retention, original sediment erosion/export/deposition/avoided-service quantities, actual native parameters, physical pixel area, coverage and common-cell scenario differences. It supports a single completed model, a baseline alone, and completed model stages retained inside a parent run whose other work has failed.

## Operate an existing workspace

Use the same GIS-enabled Python environment and application checkout as the completed native runs. The command reads completed files; it does not start InVEST.

```sh
python -m model.native_process_report --workspace /actual/workspace catalog
```

The catalogue lists each retained run, its selection, completed models, actual version provenance and available watershed registry outputs. Choose actual IDs from this output. Save a selection such as:

```json
{
  "schema": "upstate.native-process-selection/v1",
  "title": "Original baseline and selected land-cover alternatives",
  "run_ids": [
    "ACTUAL_BASELINE_RUN_ID",
    "ACTUAL_ALTERNATIVE_RUN_ID"
  ],
  "models": ["ndr", "sdr"]
}
```

The first run is the baseline. Omit `models` to use the intersection of completed models. Explicitly choose `["ndr"]` or `["sdr"]` for a single model. One run is a complete baseline process report; the change tables then have no alternative rows.

```sh
python -m model.native_process_report --workspace /actual/workspace preview selection.json
python -m model.native_process_report --workspace /actual/workspace build selection.json
```

Preview returns the deterministic report ID, actual stage versions and original file/byte count before copying. Build retains independent verified copies or reflinks of the selected native outputs, streams raster calculations in 512-by-512 windows, imports the finished scientific source and renders PDF, HTML, Markdown and structured report data with the maintained formatter.

Use `--no-render` when receiving the scientific source in an environment without ReportLab. The same build command without that flag subsequently renders the retained calculation. GIS libraries are needed for the original vector/raster analysis in both modes.

The Python API is:

```python
from model.native_process_report import catalog, preview, build, inspect, attach

available = catalog(workspace)
proposed = preview(workspace, selection)
product = build(workspace, selection)
saved = inspect(workspace, product["id"])
updated_delivery_selection = attach(workspace, product["id"], original_delivery_selection)
```

### Continue an interrupted calculation

Repeat the identical build command. The operation uses a nonblocking lock. Every completed model analysis and pairwise support analysis has a retained file fingerprint. Verified checkpoints are reopened; original-file transfers reuse their verified destination. A failed render leaves the imported source choice and completed scientific calculations available for continuation.

The output directory is `native-process-reports/<report-id>/` within the workspace. Inspect returns the current phase, completed stage keys, error details, source choice and workspace-relative file records:

```sh
python -m model.native_process_report --workspace /actual/workspace inspect ACTUAL_REPORT_ID
```

Scientific identity includes the selected completed stages, their registry file fingerprints, grid, effective execution versions and the calculation implementation. Changes to any of these create a distinct report edition. The original native run IDs and files are retained.

### Include it in the scientific delivery

Build imports `sources.json` through the existing `Workspace.import_sources` path and returns:

```json
{
  "source_choice": {
    "source_collection_id": "ACTUAL_COLLECTION_ID",
    "source_id": "native-process-ACTUAL_REPORT_ID"
  }
}
```

The document has `metadata.report_schema = "upstate.observed-report/v1"`, so it appears in the existing scientific-report source picker. Select it with the other original report editions in the desired order.

The command below appends it to a retained delivery selection without discarding the existing ordered reports:

```sh
python -m model.native_process_report --workspace /actual/workspace attach ACTUAL_REPORT_ID existing-delivery-selection.json delivery-with-processes.json
```

The helper preserves the legacy singleton form when only one report is selected. For multiple reports it preserves their order, keeps the compatibility primary selector equal to the first entry and appends this actual source once. The old aggregate report binding is removed so the maintained delivery preparation binds the complete new selection.

Use the resulting selection with the existing native-study or regional delivery operation. This source document does not impose parcel, receptor or seven-map prerequisites on the completed native calculations.

## Reading the quantities

### NDR

All original native watershed fields have units **kg/year**:

| Original field | Meaning |
| --- | --- |
| `n_surface_load` | Nitrogen load assigned to surface transport |
| `n_subsurface_load` | Nitrogen load assigned to subsurface transport |
| `n_surface_export` | Surface nitrogen reaching the modeled stream |
| `n_subsurface_export` | Subsurface nitrogen reaching the modeled stream |
| `n_total_export` | Combined nitrogen export |
| `p_surface_load` | Phosphorus load |
| `p_surface_export` | Phosphorus export |

The report derives total nitrogen load by addition and derives watershed retention as:

- Nitrogen: `n_surface_load + n_subsurface_load - n_total_export`.
- Phosphorus: `p_surface_load - p_surface_export`.

These are watershed-scale quantities. They do not locate a retained mass on individual pixels. The report also exposes export/load fractions and the original nitrogen export-component residual.

When both load and export change, the interpretation states both changes alongside the resulting retention change. A larger retained amount can arise from a larger source load. A scenario's exported mass remains a separate result.

Original scalar arguments are retained, including stream threshold and an explicit runoff reference when supplied. An absent `runoff_proxy_av` is labeled as the native computed reference; it is not replaced by a guessed value. The threshold-equivalent area is the original cell area multiplied by the actual flow-accumulation threshold.

### SDR

All original native watershed fields have units **metric tonnes/year**:

| Original field | Meaning |
| --- | --- |
| `usle_tot` | Modeled soil loss under selected land cover |
| `sed_export` | Sediment delivered to the stream |
| `sed_dep` | Sediment deposited from upslope |
| `avoid_eros` | Avoided local erosion relative to the model's bare-soil reference |
| `avoid_exp` | Avoided sediment export |

Avoided export includes both the delivered portion of avoided local erosion and trapped sediment from upslope. Avoided erosion, deposition and avoided export are different model quantities. The report preserves them separately and does not sum them into an invented sediment budget.

## Geometry, valid support and comparison

The source of each watershed row is the original `watershed_results_ndr` or `watershed_results_sdr` registry entry. Both the model's native feature ID and a normalized geometry fingerprint are retained. Geometry is verified against the selected grid's original model domain; models and scenarios are matched by geometry rather than assuming that Shapefile and GeoPackage feature numbers coincide.

The model-domain polygon may extend beyond the reporting boundary. Both original boundaries and the reporting mask are retained. Native watershed totals describe the native aggregation domain; an existing delivered raster total may describe only the reporting mask. These are distinct spatial selections.

A report accepts the actual original InVEST **3.20.0** completed-stage or observed-run runtime and verifies its corresponding official module blob. It uses the maintained per-model version resolver, so independently adopted NDR and SDR stages preserve their actual provenance. A requested version alone cannot establish this output-unit contract.

Original NDR rate rasters are kg/ha/year and original SDR rate rasters are metric tonnes/ha/year. Each raster sum is multiplied once by its observed projected pixel area in hectares. Native vector fields already contain annual mass and receive no additional area multiplier. The implementation retains original north-up metre lattices of any valid cell size; it does not hard-code 15, 30 or 300 metres.

Coverage is evaluated separately for each original quantity. For every watershed and quantity the report keeps:

- Original native vector total.
- Independently reconstructed finite pixel-centre total.
- Valid cell count and hectares.
- Polygon cell-centre denominator, coverage fraction, negative and nonfinite cell counts.
- Difference between the original aggregation and the pixel-centre reconstruction.

Native zonal aggregation can treat very small polygons and boundary cells differently. The native total remains the original result; the diagnostic is retained beside it rather than silently replacing it.

For each alternative, paired raster calculations use the same original polygon and the finite-cell intersection of that quantity's baseline and alternative. The tables show common cells, cells valid only in each run, paired mass changes and percentages. Native watershed changes retain each original full-support result. If a parameter changes stream connectivity or valid coverage, both the coverage difference and the common-support response remain visible.

All changes use **alternative minus baseline**. Percentage changes use a strictly positive baseline; zero or nonpositive baselines retain the absolute change and an unavailable percentage. Profile selection changes, scenario selection changes, actual scalar argument changes and original biophysical-table changes remain separate fields.

No cross-gauge, cross-watershed or cross-pollutant grand total is produced. Native watershed geometries can overlap, and nutrient mass and sediment mass have different units and interpretations.

## Retained files

| File or directory | Contents |
| --- | --- |
| `identity.json` | Scientific selection, stage provenance, grid and implementation fingerprints |
| `original/` | Original selected native rasters, watershed vector and sidecars, arguments, profile, scenario, biophysical table and grid geometry/mask |
| `implementation/` | Exact process producer, quantity definitions and version resolver |
| `derived/` | Verified model and pairwise analysis checkpoints |
| `quantities.csv` | Original and derived watershed quantities |
| `support.csv` | Per-run quantity support, reconstructed totals and native differences |
| `changes.csv` | Native watershed baseline/alternative differences |
| `paired-support.csv` | Same-cell changes, own/common totals and coverage differences |
| `processes.json` | Complete structured scientific result |
| `report.json` | Typed scientific source recipe |
| `sources.json` | Original-source manifest with every analysis input companion |
| `report.pdf`, `report.html`, `report.md`, `report-data.json` | Maintained scientific formatter outputs |
| `operation.json` | Progress, source selector, completed output records and errors |

Every original selected process raster is included in the scientific source companion closure. Preview's byte estimate helps plan the actual receiving storage. Workspace backups already retain this operation directory, and the model directory carries its implementation.

## Scientific sources

The quantity contract was read directly from the official 3.20.0 model source and user guides:

- [NDR guide: load, export, watershed retention and output units](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html)
- [SDR guide: erosion, delivery, deposition and avoided services](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html)
- [Original NDR 3.20.0 implementation](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py), Git blob `f518b2867d4a327675fcb1c9b4ba56f29b12188d`.
- [Original SDR 3.20.0 implementation](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py), Git blob `0cac27add172011df367ff8026427dbbdbcda5b2`.

The models describe average annual landscape processes. The existing observed-flow, measured chemistry and reported point-discharge sources can accompany these results through the ordered scientific-report selection, preserving each source's physical quantity and date basis.
