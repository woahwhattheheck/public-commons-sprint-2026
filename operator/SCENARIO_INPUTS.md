# Native model input changes

This component adds an input comparison desk to the current Upper Savannah operator. It compares two completed native runs on the same retained grid and explains what changed in the actual land-cover raster, selected biophysical rows and native parameter files.

## Install and use

Receive this complete component beside the current application. The application must already contain the selected-model scientific core and the ECSA extension host.

    python -B operator/install_scenario_inputs.py \
      --application /path/to/current/application \
      --source /path/to/received/component

The installer copies only its own scientific module, operator provider, browser assets, registration and this guide. It parses Python before replacement, retains changed source preimages and installation intent, and resumes interrupted installations. An identical completed repeat retains the prior receipt. Existing unrelated files stay with their current owners.

Open **Model input changes** in the operator. Select two completed runs on the same grid, then choose **Compare native inputs**. The existing authorized task queue owns the operation, recovery and downloads. The desk retains the selected run IDs and operation identity across a page refresh. Saved comparisons reopen with their original timestamps and source hashes.

A run or decision desk can open this view with an existing selected pair:

    await extensions.openExtension(
      'scenario-inputs', 'openPair', baselineRunId, alternativeRunId);

The scientific command is also available directly:

    python -B -m model.scenario_inputs \
      --workspace /path/to/scientific/workspace \
      --baseline-run COMPLETE_BASELINE_ID \
      --alternative-run COMPLETE_ALTERNATIVE_ID

The Python entry point is:

    model.scenario_inputs.analyze_inputs(workspace, baseline_run_id, alternative_run_id)

This method returns an immutable scenario-input-audits workspace record, with retained files and their hashes. Repeating the same operands and compiler bytes reopens the same record. No NDR or SDR engine is executed by this desk; the runs must already have completed their selected native models.

## Model and operand selection

The audit selects only models present in both run selections. It reads each run's actual compiled land-cover artifact, or the retained original NLCD raster for a baseline scenario. The coefficient CSV is resolved through the original Workspace.source_file method and verified against the profile's retained table hash.

The selected native table fields are taken from the current model_selection.TABLE_FIELDS contract. An NDR-only comparison uses the nutrient fields. An SDR-only comparison uses USLE C and P. An unused table column cannot create an affected-area claim for an omitted model.

Numeric comparisons use Decimal values: 1, 1.0 and 1e0 represent the same coefficient. Load-type strings preserve their native categorical meaning. Only table rows reached by actual native land-cover cells contribute to the footprint. The report separately identifies unused table codes.

Global model parameters are loaded from the actual retained stage argument files. Values omitted by the native invocation remain explicitly omitted. The report does not substitute a guessed default. Grid inputs remain fixed because both runs must identify the same immutable grid.

## Spatial accounting

All raster operands must match the retained native dimensions, affine transform and CRS. Cell area is the absolute affine determinant on a projected metre grid divided by 10,000. The actual model-domain polygon is rasterized by pixel centre, matching the original application's polygon-mask convention.

Three kinds of support are retained:

- **Native routing domain:** actual model-domain polygon and the paired land-cover coverage.
- **Reporting basin:** native domain intersected with the retained reporting mask.
- **Paired output support:** each original paired output comparison's valid cells, intersected with the same domain and reporting mask.

Coverage tables report extent, paired valid land-cover cells, baseline-only, alternative-only and neither-valid cells. Changed areas always use paired valid land-cover cells. Coefficient effects in the wider routing domain can influence exports inside the reporting basin.

For each selected model, each valid cell receives one category:

| Code | Meaning |
| --- | --- |
| 0 | Same land-cover code and same selected coefficients |
| 1 | Different land-cover code with identical selected coefficients |
| 2 | Same land-cover code with different selected coefficients |
| 3 | Different land-cover code and different selected coefficients |
| 255 | Outside the native domain or invalid paired land-cover support |

Coefficient-changed hectares combine categories 2 and 3. A coefficient-only practice is therefore visible even when its LULC codes remain unchanged. Global parameter changes are displayed separately because they have no unique local footprint.

Each class transition retains its exact before/after coefficient values, changed selected fields, and counts for every reported support. Field-level changed areas overlap; summing those areas would count the same cells more than once.

## Original outcome comparison

The component calls the existing Workspace.compare_runs for the chosen ordered pair. Its original difference artifacts and annual sum_change values are referenced and downloadable. The source comparator owns outcome arithmetic and finite support; the input audit does not create a second outcome method.

The application exports nitrogen and phosphorus as kg/pixel/year and sediment as metric tonnes/pixel/year. Their retained summed changes are annual mass. The audit preserves these original values. It does not multiply an already converted output by pixel area a second time.

The output changes and input footprints have different meanings. Routing permits an input change to affect downstream cells. A coefficient or configuration change also does not establish a causal share of the paired outcome: the original engine run computes the combined result. Coalition allocation and common-mask watershed assessment remain available through their existing desks.

## Original model references

The implementation follows the actual model source and selected-model contracts in the retained application. The official version-specific guides explain the scientific meaning of the compared fields:

- NDR 3.20.0: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- SDR 3.20.0: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html

NDR distinguishes application-rate and measured-runoff nutrient loading. SDR uses land-cover-specific cover and practice factors. Their spatial routing means changed input cells and changed export cells need not coincide.

## Spatial response ledger

Edition 1.1 adds a response partition over the exact original paired export-difference rasters. Each output keeps its own annual units. Gross reductions, gross increases, unchanged cells and net changes are reported by the model's input category. The original paired comparison's finite cell count and block-order sum must be reproduced exactly before the ledger is retained.

Current native difference TIFFs store Float32 values. The ledger decomposes their sign, exponent and mantissa into exact integer units of 2^-149. Category and sign partitions therefore conserve the physical raster values exactly. The original native sum remains the displayed net change; any floating summation roundoff is retained as a separate numeric field. Roundoff is never assigned to a physical category.

The ledger retains the fifty largest increases and fifty largest reductions for each available output, ordered by magnitude with native row and column breaking ties. The corresponding GeoPackage contains actual cell-centre points in the source CRS. CSV includes native coordinates, WGS84 longitude/latitude, original row/column, annual delta, both land-cover codes, model input category and whether global parameters changed. These points identify modeled source-response cells, rather than receptor concentrations or receiving-water observations.

Inside/outside input categories describe source-cell locations. A response outside changed coefficient cells can arise through routing. When global parameters also changed, they are identified as a comparison-wide condition, with no allocation of their effects to local inputs.

The expanded downloads include response-partitions.csv, response-cells.csv and response-cells.gpkg. The receiving application uses the same task and saved-report workflow. The original 1.0.0 source bank remains available; the installer accepts its recorded file hashes when applying this edition.

## Retained files and operator integration

The completed record contains the full report JSON, transition CSV, changed coefficient CSV, global parameter CSV and one categorical GeoTIFF per selected common model. The record includes the exact run selections, table originals, argument-file hashes, native LULC hashes, domain/reporting masks, compiler hash and existing outcome comparison references.

The ECSA descriptor registers one action, scenario.inputs.compare, and authenticated catalogue/report reads. Heavy spatial work stays in the original task queue. Download tickets use the original verified file provider. The receiving verifier checks retained report files. The browser factory isolates its DOM/CSS and ignores responses superseded by a workspace or lifecycle change.

The component adds no independent scheduler or test framework.
