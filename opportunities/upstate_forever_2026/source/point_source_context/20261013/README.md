# Eighteenmile point-source discharge cohort

This addition joins the complete EPA ECHO history to the existing 2023 science calculator and the four original South Carolina DES outfall points. It supplies one native source collection with 22 entries, six prepared CSV views, a usable geographic layer, and all 230 reporting periods for the existing Measurements context workflow.

The existing science calculator remains the source of the day-weighted quantities. This bridge connects those quantities to original DMR identities, the EPA Loading Tool outputs, the historical source and the original mapped permits. It preserves each amount's species, physical unit, reporting interval and calculation method.

## Assemble and import

This complete closure carries all 170 original and prepared files in one normal application source-bank overlay. It includes the original EPA bodies from F0C8K2W4B0D, EPA history/core from F0C8Q6PADFC, the 39-file science companion and 19-file gauge-routing supplement from F0C8J1E75FV, and the canonical 18-file cohort from F0C8NLBGWGN. Four identical shared map/guide files are retained once. All member paths remain relative to the application root.

The current application assembler accepts each member's content_gzip_base64 and original bytes/SHA256. Compose this complete source bank into the current maintained application; use that application's current assembler and source receiver. The decoded source bank is a single overlay, including source bodies and prepared outputs. Its per-file compression is a transport representation; materialized files retain their original UTF-8 bytes.

~~~sh
python -B source_tools/application_assembly.py /actual/current/application \
  --overlay /actual/complete-point-source-canvas.md \
  --edition ECHO-POINT-SOURCE-COMPLETE-20261013-r3 \
  --output /actual/new-composed-source-root
~~~

If the installed source already contains the earlier standalone cohort, this edition changes its observation support label and corresponding source-manifest companion hash. Preserve the existing application code and scientific source. The six generated quantitative tables are identical to the preceding canonical cohort.

All prepared outputs and the native source manifest are already supplied. From the existing application root:

~~~sh
python -B source_tools/import_point_source_cohort.py \
  --project-root . --workspace /actual/existing/workspace
~~~

The driver imports the local eighteenmile_point_source_context.sources.json through Workspace.import_sources and imports the period context through the existing Workspace.import_observations. It returns the actual source collection, source bindings and observation ID, and saves that same small operating result to source/point_source_context/20261013/receiving/native-import.json.

The ordinary source tables include every row. The observation intake uses value_basis=point_source_discharge_context and measurement_support=point_source_discharge: all 230 periods remain contextual, including three original below-detection periods without a numeric threshold. Its actual EPA HUC12 reference is retained with the exact original reporting feature and state point identity. Catchment annual-load comparisons continue to use their own measured receiving-water catchment sources.

The driver's --source-only option imports the geographic and table sources on a receiver that is currently assembling its observation module. --create-workspace explicitly creates a new workspace when needed; otherwise the existing workspace is opened.

## Rebuild from the retained cohort

The complete preparation core is source_tools/point_source_cohort.mjs. The standard-library Node driver verifies the selected eighteen retained input files and regenerates all six tables, metadata, summary and source manifest, while adopting the original science team's native map unchanged:

~~~sh
node source_tools/point_source_cohort_cli.mjs --root .
~~~

The input-manifest.json pins the exact retained source edition and carries the original file descriptors. All generated table hashes are rebuilt from their actual UTF-8 bytes. The calculation core was executed against the complete retained source cohort for the supplied edition.

Workspace retains original objects by SHA-256, so repeated source companions reuse the same original bytes. Its source views preserve the relative arrangement of primary and companion files.

## Source views

| File under source/point_source_context/20261013 | Rows/features | Use |
| --- | ---: | --- |
| canonical_measurements_2023.csv | 2,282 | All original 2023 DMR values, with the 980-record science subset and selected quantity identities joined |
| period_method_comparison_2023.csv | 230 | Existing calculated quantities beside exact EPA selected loading records, coverage and native mapped permit |
| annual_method_comparison_2023.csv | 20 | Full-year/partial reported quantities, common-period comparison, published annual outputs and original row arrays |
| outfall_history_context.csv | 6 | The six original EPA reporting-feature identities, first/last periods, source HUC/reach values and current state mapped permit |
| annual_history_map_index.csv | 663 | Complete 2007–2026 source context associated with the current mapped permit |
| point_source_period_observations.csv | 230 | Original period context for the existing native observation interface |
| observations/eighteenmile_2023/npdes/dmr_outfalls_2023.geojson (retained original project path) | 4 | Current science native layer, preserved byte for byte with its source ID and context-layer metadata |

The single root manifest also imports the original EPA historical tables, the unchanged calculated science period/annual tables, and the unchanged original DES points. Original source bodies, schemas, qualifiers and calculation guides remain available as companions.

The canonical DMR table contains one row per original DMRValueId. All 980 IDs in the target-series science source are present in the complete 2,282-record response, and all 227 quantity IDs selected by the science calculation resolve. Source values match. The two retained representations use &lt; and &lt;= versus literal operators in 607 qualifier fields; the joined table keeps the original representation from each source and adds explicit normalized operator columns.

## How the methods compare

Every one of the 182 mass periods has exactly one matching EPA loading record on permit, EPA reporting feature, species code, monitoring location and original period end. The other 48 periods are flow records and retain million-US-gallon quantities.

The reported-standard-rate method retains decimal quantities produced by the existing science calculator. EPA's period output supplies its own selected and displayed loading result. Both are useful source context. The comparison retains the exact difference and the original EPA display increment; it does not substitute one source quantity into another source's record.

| Permit | Reported-standard TP quantity, kg | Sum of EPA displayed period loads, kg | EPA displayed annual result, kg |
| --- | ---: | ---: | ---: |
| SC0000477 / Milliken | 761.00387363 | 761.40 | 761 |
| SC0035700 / Pendleton-Clemson | 170.15919910 | 170.16 | 170 |
| SC0042994 / Pickens Upper | 85.75061170 | 85.75 | 85.75 |
| SC0047856 / Pickens Middle | 102.56132339 | 102.56 | 103 |

For example, Milliken's July TP period has a reported-standard quantity of 105.55499907 kg and a displayed EPA period load of 106 kg. The full comparison exposes those values directly. The separate annual output has its own displayed precision.

Upper and Middle total-N observations span 334 days in 2023. Their quantified reported-standard amounts are 2,138.62146246 and 3,010.31053443 kg. The complete-year field remains empty for each. EPA's displayed period sums are 2,138.04 and 3,009.99 kg, while the published annual output is 2,333 and 3,284 kg with estimation factor 1.09. The annual comparison carries all these values and their distinct coverage.

Milliken's complete nitrogen series is nitrate as N, parameter 00620. It has its own map field and source rows. Its quarterly ammonia series retains one numeric zero and three original unquantified below-detection periods. Each contextual observation carries its original candidate DMR identities, NODI values and represented interval.

## Geographic layer and eight-map integration

The cohort adopts the current science companion's exact source ID `scdes-eighteenmile-npdes-outfalls-2023`, original `dmr_outfalls_2023.geojson` and native manifest metadata. The retained 11,329-byte file has SHA-256 `07b42387abb0398e5be468fce3f28f72ce654ce4abf35fb7a2184e522c65fdf7`. Its four original EPSG:26917 point coordinates and all original quantity/coverage properties remain unchanged.

| Original map property | Meaning |
| --- | --- |
| tp_annual_kg / tp_quantified_days | Reported total phosphorus quantity and represented days |
| tn_annual_kg / tn_quantified_period_kg / tn_quantified_days | Complete-year TN quantity, actual quantified amount and coverage |
| nitrate_annual_kg / nitrate_quantified_days | Nitrate as N, with its separate species identity |
| ammonia_annual_kg / ammonia_quantified_period_kg / ammonia_quantified_days | Original ammonia series and coverage |
| tss_annual_kg / tss_quantified_days | Suspended-solids quantity and coverage |
| flow_annual_million_us_gallons / flow_quantified_days | Flow amount and coverage |
| permit_id / state_outfall_id / state_objectid | Exact published state point identity |
| tp_reporting_feature / ammonia_reporting_feature | The original EPA reporting branches |

The source entry retains `metadata.context_layer=true`, its annual-source ID and all 36 original companions. The root manifest also adopts the current science period and annual entries, with their IDs and complete original companion lists. Only member paths receive the project-relative prefix needed by a root manifest.

For the existing eight-map assessment runner, add the complete root manifest as the point-source context input:

~~~sh
--context-manifest eighteenmile_point_source_context.sources.json
~~~

Use this complete cohort manifest in the existing point-source slot. It already includes the same current science map and period/annual entries from `observations/eighteenmile_2023/npdes/model-sources.json`. The broader study/lake context manifest `observations/eighteenmile_2023/model-sources.json` remains its separate input. The source runner receives the same map ID and adds the historical and measurement context alongside it.

The receiver's actual source binding is:

~~~json
{
  "source_collection_id": "value returned by the native import",
  "source_id": "scdes-eighteenmile-npdes-outfalls-2023"
}
~~~

Join uses the actual permit ID. The state source maps outfall 001 for each permit; Milliken's EPA records use T1M and T1Q and the historical source also contains 001. Those labels stay separate in every joined view. The historical index associates earlier reporting series with the current mapped permit while retaining earlier coordinates and reporting dates.

The original DES vector is also retained as `upstate-eighteenmile-des-original-outfalls`. The exact source metadata and current science `NATIVE_IMPORT.md` document source coordinate quality and map use.

## Native observation context

The supplied CSV follows the existing observation interface: catchment_id, parameter, value, unit, with record_id, station_id, period_start, period_end, qualifier, method and source_records. Every period has a unique stable record ID. Period ends follow the science companion's exclusive-end convention, recorded by the dates and calculation method.

Each record uses its actual EPA-published HUC12 context. The per-row source_records JSON retains the permit, EPA reporting feature, species, selected and candidate original DMR IDs, source pointers, state feature ID and full reporting status. The receiver adds actual native source bindings to collection metadata.

The three nonnumeric periods retain their original reporting status in this same intake. They are visible alongside the 227 quantified periods. The full source tables provide the original limit, concentration qualifier, permit version and parallel reporting branches for each record.

## Primary source and method references

- EPA ECHO effluent service and field dictionary: https://echo.epa.gov/help/reports/effluent-charts-help
- EPA selected loading methodology: https://echo.epa.gov/trends/loading-tool/resources/technical-background-methodology
- EPA monitoring-period output definitions: https://echo.epa.gov/help/loading-tool/reports/monitoring-period-loads-help
- The existing science method and all twenty calculated series: observations/eighteenmile_2023/npdes/DMR_LOADS.md
- Original state feature response and metadata: observations/eighteenmile_2023/npdes/originals/des_four_npdes_outfall_features.json and des_npdes_layer21_metadata.json
- The delivered EPA capture-manifest.json records every original query, retained body identity and source-period choice.
