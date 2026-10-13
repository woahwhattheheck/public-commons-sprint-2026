# USGS seasonal loads and upstream catchments

This source preparation joins the published USGS nitrogen/phosphorus load release to the workbench's existing observation comparison. It retains the actual station catalog, seasonal tables, dictionary, estimator choices and uncertainty. The resulting annual CSV, original upstream catchments and metadata enter the same source collection and observation workflow used by the operator.

The implementation is source_tools/usgs_loads.py. It uses the original capture function in source_tools/raster_sources.py, the existing content-addressed source custody in model/common.py, and the native vector reader in model/rasters.py.

## Original data and spatial reference

The selected release is [Ator and others (2024), Estimated seasonal nitrogen and phosphorus loads in selected streams of the conterminous United States, 1999–2020](https://doi.org/10.5066/P13YSTHM). The [USGS Water Mission Area catalog](https://water.usgs.gov/catalog/datasets/8a7d3140-2272-433c-9359-30840125cd7c/) identifies measured water-quality and streamflow inputs, Fluxmaster and WRTDS estimates, and the original processing code. Its seasonal outputs are observation-derived estimates with their own period and estimator uncertainty.

Catchments use the [current USGS NLDI basin endpoint](https://api.water.usgs.gov/docs/nldi/basin/). NLDI associates a feature with the NHDPlusV2 network and returns its contributing upstream basin. Every request here explicitly selects full-resolution geometry with simplified=false. The chosen splitCatchment value is retained: true splits the local catchment at the indexed feature position, while false uses the complete local catchment. The source catalog and exact feature response are retained with each basin. The [registered feature-source documentation](https://api.water.usgs.gov/docs/nldi/feature-sources/) describes nwissite and the native comid source.

A water-quality station, its published streamflow station and its published COMID remain distinct identities. The contract states which physical location the load represents. Selecting a flow gauge's basin requires original source support for that load-to-basin relationship; the presence of a flow_station_id alone describes the input flow record.

## Workflow

Keep the delivered original release files together in one source directory. Preserve their relative paths, original bytes and any shapefile companions. An analyst contract binds those exact files to the definitions in the release dictionary and processing code.

Run the commands from the delivered application root, with the existing GIS runtime:

    python3 -B -m source_tools.usgs_loads inventory \
      --contract ACTUAL_CONTRACT.json --original-root ORIGINAL_SOURCE \
      --output table-inventory.json

    python3 -B -m source_tools.usgs_loads qualify \
      --contract ACTUAL_CONTRACT.json --original-root ORIGINAL_SOURCE \
      --output station-qualification.json

    python3 -B -m source_tools.usgs_loads prepare \
      --contract ACTUAL_CONTRACT.json --original-root ORIGINAL_SOURCE \
      --output PREPARED_SOURCE

Inventory reads every selected table, reports its actual headers/count and optional observed code values, and extracts original FGDC attribute labels, definitions, units and enumerations. Qualification projects the actual catalog coordinates into WGS84 and checks them against the selected source reporting polygon. It preserves every station row, its original row number, coordinates, flow-station ID, COMID, published area fields and study-area membership.

Use those actual records to complete the selections in the contract. Preparation retains the selected original source, forms complete annual records, fetches each selected original NLDI feature and basin, and writes a complete source-manifest.json. The existing source_tools/compose.py can compose that manifest with the current model collection. Its source entries have roles OBSERVED_LOADS and OBSERVATION_CATCHMENTS.

The output directory is one immutable source selection. Repeating preparation there checks the original selection and hashes, reuses completed HTTP responses and returns its existing result. Use a new directory for a revised calendar, estimator, source edition or station selection. The portable prepared directory can be reopened with its source-contract.json and original/ subtree.

## Source contract

The contract schema is upstate.usgs-seasonal-loads-contract/v1. It has release.doi equal to 10.5066/P13YSTHM and a useful title and release citation. All names below describe fields; populate them from the actual retained source rather than treating them as sample data.

### Files and evidence

files is a dictionary keyed by a stable source ID. Each entry contains:

| Field | Meaning |
|---|---|
| path | Original relative path below --original-root |
| sha256 | Exact original file SHA256 |
| bytes | Optional exact original byte count |
| uri | Original publication or download URL |
| kind | Optional kind; metadata_xml enables FGDC attribute extraction |

Include the original dictionary/readme and code that define the selected calendar, units and estimator. Include every component needed by a native source such as a reporting-area shapefile. An evidence array contains objects with file_id and location. Location identifies the original metadata attribute, table, page or processing-code section; optional explanatory fields are retained.

The preparer checks every declared file before using it and carries the original bytes into original/. Its content-addressed objects avoid copying identical bytes while the prepared source is assembled.

### Reporting polygon and station catalog

reporting_area contains file_id, optional layer and exact where attribute mapping, and evidence. The native vector reader selects those original features and returns their valid polygon union.

station_table contains file_id, optional encoding/delimiter, coordinate_crs, coordinate_evidence, and columns. The columns mapping requires station_id, station_name, longitude and latitude. Optional mappings are flow_station_id, comid, area, flow_station_area and huc8. IDs remain original strings, including leading zeroes.

inventory may additionally inspect columns named in inspect_columns. It records up to 1,000 distinct observed values per selected column and marks a larger inventory explicitly. It never replaces the original table.

### Native seasonal table and annual calendar

load_tables is an array. Each entry contains file_id, optional encoding/delimiter, series_id, series_evidence, columns, period_definition, parameters and optional row_rules.

series_id identifies one native load series and flow basis. Use the same ID across physical file partitions of that same series. A differently detrended, flow-normalized, source-selected or otherwise distinct series needs its own identity and source interpretation. Four quarters from different series cannot become one annual record.

columns maps station_id, year and quarter. It may also map days, period_start and period_end. Explicit source dates must use the retained source's ISO date representation; the date check verifies those values against the same declared native calendar.

period_definition contains:

| Field | Meaning |
|---|---|
| annual_start_month | Actual starting month of the source annual period, 1–12 |
| year_label | start for the starting year; end for the year containing the period's final day |
| quarter_values | Four distinct original string codes in native annual order |
| evidence | Original definition or code establishing that calendar |
| source_end_inclusive | true when an explicitly mapped source period_end includes that final day |

Each quarter spans its three calendar months. Day counts include leap years. An optional native days column must match the complete season. The annual period in the output uses a start-inclusive, end-exclusive interval. A familiar label such as WYEARS does not supply its calendar by itself.

### Load values, estimators and flags

Each table's parameters array contains one or both supported total-load definitions:

| Field | Meaning |
|---|---|
| parameter | nitrogen or phosphorus |
| parameter_code | Original total nitrogen00600 or total phosphorus00665 |
| load_column | Actual native estimate column |
| method_column | Actual estimator-selection column |
| accepted_methods | Original string estimator codes selected from the source |
| mass_unit | kg, g, metric_tonnes or lb, as explicitly interpreted from the original unit |
| value_basis | season_total_mass or mean_daily_mass |
| evidence | Original unit, estimate and estimator definitions |
| uncertainty_columns | Optional original uncertainty columns |
| uncertainty_evidence | Definitions of retained uncertainty fields |
| row_rules | Optional native qualifier selections |
| allow_mixed_estimators | true only when the selected source interpretation permits its different quarter estimators to be combined |

For mean_daily_mass, the preparer multiplies the source decimal value by the actual number of days in that quarter. For season_total_mass, it retains the quarter mass directly. Mass conversion uses exact Decimal factors before the four quarterly masses are summed to kilograms. Negative, missing or nonnumeric estimates remain in the review output.

Each row rule contains column, allowed_values, meaning and evidence. Values are exact native strings. Table-level rules and parameter-level rules both apply. This keeps the source's quality, detrending and preferred-estimator flags visible. Rejected alternative rows remain available even when one accepted estimate supplies that same quarter.

An annual record needs exactly one admitted estimate in each of the four quarters, a complete continuous annual period and one native series. Ambiguous duplicate accepted quarters remain in annual-review.json. Estimator changes across quarters require the explicit source-backed allow_mixed_estimators choice and retain all original names.

No annual confidence interval is manufactured by summing quarterly standard errors. Each annual record carries the original quarter uncertainty fields and their definitions. A separate annual uncertainty calculation would need a supported covariance or original annual interval method.

### Station and basin selections

selections is an array of actual station choices. Each contains station_id, optional catalog_record_number to distinguish a repeated catalog identity, selection_reason, selection_evidence and catchment.

catchment contains:

| Field | Meaning |
|---|---|
| source | Actual registered NLDI source: nwissite or comid for these native joins |
| identifier | Exact original feature ID |
| station_role | water_quality_station, published_flow_station or published_reach |
| split_catchment | Explicit boolean selecting the local-basin convention |
| identity_evidence | Source definition establishing the load's physical support |

A water_quality_station identifier must be the same selected original station under nwissite. A published_flow_station identifier must match the original catalog's actual flow-station field. A published_reach must match its original COMID. Station and catchment IDs never come from display names.

The qualifier retains actual study-area membership; an outside station can be selected when its documented upstream or downstream relationship is useful. The selection reason and evidence remain in the delivered package. Published station areas, NLDI COMID and geodesic upstream area are carried side by side so an analyst can inspect the actual spatial relationship. Original area units remain in the source dictionary.

## Outputs and operator join

The prepared source includes:

| File | Purpose |
|---|---|
| source-contract.json, plan.json | Exact input meaning and immutable source selection |
| station-qualification.json | Every original catalog row and measured reporting-area membership |
| annual-loads.csv | Complete annual N/P records in kg/year |
| annual-records.json | Full derived records and original selected quarterly rows |
| annual-review.json | Missing quarters, ambiguous estimates and rejected native records |
| observation-metadata.json | Direct input to Workspace.import_observations |
| catchments.geojson | Complete selected upstream basins keyed by catchment_id |
| catchment-sources.json | Original station, feature, basin, HTTP, area and mapping context |
| nldi/ | Actual NLDI source catalog, feature/basin bodies and original capture receipts |
| original/ | Exact published source and method files |
| source-manifest.json | Existing workbench source collection contract |
| result.json | Reopenable selection, counts and exact retained file identities |

Import annual-loads.csv with observation-metadata.json through the existing operator. Its CSV columns already match model/observations.py. Select the prepared catchment source and catchment_id for comparison.

The comparison uses the existing original native NDR stage outputs and their same-stage stream masks. It retains expected native stream NoData separately from missing nonstream support. Complete upstream coverage is required for whole-load fit metrics; the original partial modeled total remains visible for a partially covered catchment.

Review the source observation period alongside the model's land-cover and parameter vintages. The operator retains year, estimator, qualification and uncertainty for every record and provides coverage filters, scatter/table inspection and CSV export. This preparation does not launch an InVEST run.

## Receiving and continuation

A completed source can be reopened entirely from its delivered files. On an interrupted preparation, retain the same output directory, plan, original files and capture receipts. Run the same prepare command. Completed source and HTTP bodies are verified and reused; unfinished source requests continue through the existing native capture implementation.

To reopen a prepared source moved to a new directory, pass that directory's source-contract.json as --contract and its original/ as --original-root. The logical selection hashes remain the same because absolute authoring paths are not part of the plan.

The full raw response files and dictionary travel as source companions through the existing composer and portable workspace. The operator's established download and receiving paths remain responsible for delivery of the assembled working model.
