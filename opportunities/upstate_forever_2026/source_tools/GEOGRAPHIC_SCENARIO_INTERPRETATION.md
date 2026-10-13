# Geographic scenario source-loading interpretation

This module continues the original actual-geography headwaters preparation through a useful scientific report section. The saved baseline, restoration, matched control, native ensemble and their numerical decisions remain the original services.

## Read the quantities together

The treatment converts exactly the same number of cells in each original agricultural class to the same destination class. At the current assumed coefficients, pasture 81 to forest 41 removes 8 kg N/ha/year and 0.58 kg P/ha/year of unweighted source loading; crop 82 to forest 41 removes 20 kg N/ha/year and 1.68 kg P/ha/year. These are changes in the declared source coefficients. Native stream-export changes additionally depend on delivery and retention.

The helper derives those coefficients from the actual retained CSV, including the native application-rate adjustment when selected. For each original class c and nutrient x it calculates:

- Unweighted source reduction in each alternative: area per cell × matched class count × (effective original coefficient − effective destination coefficient).
- Corridor/control proxy-weighted reduction: area per cell × coefficient difference × sum of the selected original precipitation values / original preparation-domain precipitation mean.
- Signed source-loading difference: corridor reduction minus control reduction.
- Absolute source-loading difference bound: sum over classes of area per cell × absolute coefficient difference × sum of absolute paired rainfall residuals / the same mean.

The signed difference uses the retained sum of paired rainfall residuals to avoid subtracting large, nearly equal totals; the accompanying aggregation-roundoff column preserves the numerical closure difference. The preparation-domain normalization is explicitly named. The native NDR solver may have different actual valid support or runoff normalization after preparation; its completed output comparison supplies native stream-delivered quantities. This source calculation does not replace that comparison.

Sediment source generation also responds to R, K and LS. Class/rainfall matching does not hold those fields, native stream distance or contributing area constant. Interpret the final sediment contrast as the response of the declared siting alternatives under the same physical scenario; inspect erosion generation and stream delivery together.

A buffer distance of 90 m passed to LineString.buffer is 90 m on each side, approximately 180 m full width. The report names this explicitly. The hypothetical valley corridor and the native routed stream are distinct retained objects.

## Continue the same prepared case

Use the actual geographic-headwaters/<prepared-id>/prepared.json, its inputs/input-receipt.json and inputs/biophysical.csv, plus inputs/matched-control/matching-summary.json in the final frozen geographic producer. Its full JSON must equal prepared.input_summary.control. The earlier adapter-wrapped edition is also recognized through prepared.input_summary.control.preparation.summary; its original relocated summary must match that exact embedded object.

Run at the existing source/report boundary, preserving any active solver and its original runtime:

~~~sh
node APP/source_tools/geographic_scenario_interpretation.mjs \
  --prepared WORKSPACE/geographic-headwaters/ID/prepared.json \
  --input-receipt WORKSPACE/geographic-headwaters/ID/inputs/input-receipt.json \
  --matching-summary WORKSPACE/geographic-headwaters/ID/inputs/matched-control/matching-summary.json \
  --biophysical WORKSPACE/geographic-headwaters/ID/inputs/biophysical.csv \
  --output OWNED_REPORT_OUTPUT
~~~

The helper verifies the original matching-summary equality, input-receipt geographic identity and coefficient bytes, raster transform/CRS/area, changed class counts, complete corridor exclusion, and paired rainfall arithmetic. It writes complete by-class and total CSVs, interpretation JSON, native report recipe and a two-entry upstate.sources/v1 manifest. Every recipe input is a companion of the same report entry, so the existing Workspace materializes all original inputs correctly.

Import OWNED_REPORT_OUTPUT/sources.json through the maintained Sources selection or Workspace.import_sources. In Scientific Reports choose its OBSERVED_CONTEXT document together with the original native comparison. The report section is also exported as reportSection(report) for the existing geographic report producer. The pure calculation function interpretGeographicScenario can consume retained JSON/CSV rows in another JS host.

The module uses Node built-ins only for the CLI; the calculation and report-section exports are independent of filesystem, network and Node. Existing exact output is reused; changed scientific input requires a distinct owned edition directory.

## Original treatment allocation among HUCs

The final producer records actual reporting, corridor and changed-cell counts by original reporting HUC. These counts are retained in an additional CSV and report table, with source-coefficient reductions calculated separately for each HUC. Matching holds class counts over the whole reporting support, not within every utility or HUC. The control area for a particular HUC remains unpopulated until its actual footprint is intersected; absent allocation is never converted to zero. The original utility/footprint service supplies that local control area and source-class distribution. Individual original HUC rows remain separate source selections.

## Use the completed native comparison

For each profile, retain common finite support across baseline, corridor restoration and off-corridor control. Compare baseline minus restoration and baseline minus control on that same support. Subtracting these reductions yields control minus restoration. Divide by actual treated hectares only after preserving the original annual quantities.

Name spatial summaries separately:

| Original geometry | Interpretation |
| --- | --- |
| Full upstream model domain | Routing and modeled source support for this selected case |
| Selected HUCs intersected with the original SC boundary | South Carolina reporting support |
| Four focus HUC12 anchors | The original utility focus selections |
| Original utility protection polygons | Publisher-defined source-water protection footprint |
| Complete 4-HUC ARJWS and 32-HUC PRWD upstream groups | Original WBD topology-derived contributing-unit context |

The helper retains the actual selected IDs, bindings and areas. A spatial sum of exported hillslope contributions inside a utility polygon does not simulate transport through reservoirs or concentration at the intake. Parameter members use their existing support-group decision editions, with distinct finite masks kept distinct.

### Primary model documentation

- NDR 3.20.0 source loading, runoff normalization, retention and export: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- SDR 3.20.0 erosion generation and stream delivery: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html

## Current delivery direction

Carry CURRENT_OWNER_DIRECTION.md v2026-10-13.3 into this existing continuation: actual original RFP 30 m geography and retained source identities; editable baseline/restoration/control; native annual N/P kg/year and sediment tonnes/year to streams; real progress, maps, comparisons and full editable GIS/project export and cold reopen. The prime retains scientific methods, review and client relationship. Personally open and use outgoing reports, maps and attachments and fix readability. Preserve active owners and the 14:00 UTC October 13 cutoff.
