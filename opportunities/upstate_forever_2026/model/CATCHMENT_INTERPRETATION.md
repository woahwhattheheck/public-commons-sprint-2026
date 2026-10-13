# Whole-catchment annual yields and original spatial dependence

The existing observation report, calibration review, scientific report source and original-catchment atlas now expose annual mass per hectare beside the original annual masses. The result helps distinguish a large load caused by a large drainage area from a large load per unit area. Original calibration selection, native results and source references retain their identities.

## Physical definition and source support

For each retained original catchment:

\[
Y_{\mathrm{reference}} = L_{\mathrm{reference}} / A_{\mathrm{catchment}},
\qquad
Y_{\mathrm{native}} = L_{\mathrm{native}} / A_{\mathrm{catchment}}.
\]

If the saved calibration explicitly includes a delivered external annual load, the source retains native, external and total-prediction yields separately. The difference column is total-prediction yield minus reference yield.

The denominator is exactly observation-comparisons/<comparison-id>.json → comparisons[*] → spatial_coverage.catchment_area_ha: the complete original source polygon projected into that native comparison's metre CRS, divided by 10,000. The covered_area_ha field is a separate grid measure. Neither valid-cell area nor a clipped raster window is substituted for the complete polygon. The original raster_extent_crs, outside-raster area, valid cells, structural stream omissions and unexpected missing cells remain attached.

Reference yield uses this explicitly selected comparison polygon. A separately published gage drainage area is not silently substituted. Where an original reference station and its selected catchment have different geographic support, area normalization does not resolve that scientific mismatch.

The supported native annual units kg/year and metric_tonnes/year produce kg/ha/year and metric_tonnes/ha/year. Explicit retained tonnes/year and t/year aliases also retain their corresponding per-hectare labels. Unknown mass units or unavailable original polygon area produce an unavailable yield.

[USGS SPARROW FAQ, “What metrics do SPARROW models predict?”](https://water.usgs.gov/nawqa/sparrow/FAQs/faq.html) distinguishes total yield (total load divided by entire upstream drainage area) from incremental and delivered yields. This presentation uses the whole-catchment definition. It does not estimate an incremental catchment load or downstream delivery, or turn InVEST hillslope delivery into a measured outlet flux.

## Complete, partial and historical records

A complete native yield requires both the original row's admission to comparison metrics and the original complete_catchment support. Original stream NoData recognized as structural by the same producing-stage stream raster stays visible; no mass is imputed.

For partial native support, the original partial annual mass remains in partial_native_annual_mass. Complete native and total-prediction yields remain null. A reference yield can still be shown when the complete source-polygon area is retained. A legacy record with no original area keeps an explicit unavailable denominator. There is no area inference from cell counts.

The calibration summary historically retains support counts but omits polygon area. The catchment_interpretation.collect helper reads the exact original comparisons named by report.comparison_ids[run_id], including excluded/partial prediction rows, and matches their original observation record IDs. It verifies:

- Comparison, run and observation-edition identities.
- Original catchment source selection and source-body SHA.
- Catchment, native parameter and mass units for each constituent period.
- Consistent whole-catchment denominator and CRS across a reference unit's periods.

The original temporal weighting and complete period list remain unchanged. Multiple years do not create independent spatial catchments. Visible report rows include the original period; CSV/JSON retain every original record identifier, method, uncertainty, qualifier context and reference period.

## Original constituent basis

Reference values preserve the source-aware constituent classification used by the scientific reports, including TSS code 00530 and suspended sediment code 80154. Yield normalization does not convert TSS to SSC. Nested reference source records are resolved from the original observation edition before assigning the display basis.

Plots use separate source-basis cohorts. Their numerical-equality line is a visual guide, not evidence of identical analytical methods or transport support. Raw annual values and any published conversion coefficients remain unchanged. Any separately prepared SPARROW sediment-method sensitivity source remains its own selected source.

## Retained spatial dependence

The relationship table exposes plan.spatial_groups.connections unchanged:

- Shared upstream polygon area, with its original overlap_ha.
- Shared original station ID, with its original station identifier.

Original assignments, dependence groups and calibration/validation partitions remain in the yield tables and JSON. Connected groups can contain indirect relationships, and explicit groups can merge multiple components. These edges are not a river routing graph. No containment direction or upstream/downstream ordering is inferred. Catchment loads must not be added as independent parts of a regional total merely because they have been normalized by area.

Default report figures and tables show the selected candidate's held-out results and each challenger's calibration partition. Fully identified downloadable records can retain other original predictions; they do not create a new candidate-selection criterion.

## Existing application workflow

Use the completed calibration already selected in the Workspace:

1. Prepare original-catchment residual maps if a GIS/atlas edition is wanted.
2. Prepare the ordinary calibration review with that map edition and any already selected source-error supplement.
3. Prepare the review's scientific report source.
4. Select that source in the existing Sources desk or ordered scientific report composer. The same recipe flows through ordinary PDF, HTML, Markdown and delivery archives.

These existing commands use the exact completed calibration ID and do not run InVEST:

~~~sh
"$PYTHON" -B -m model.calibration_maps "$WORKSPACE" prepare "$CALIBRATION_ID"
"$PYTHON" -B -m model.calibration_review "$WORKSPACE" prepare "$CALIBRATION_ID" \
  --map-id "$MAP_ID"
"$PYTHON" -B -m model.calibration_report_source --workspace "$WORKSPACE" prepare \
  --review "$REVIEW_ID"
~~~

Use the IDs returned by each command. The maps/review --uncertainty-id argument keeps an existing error supplement. The map --candidate-run-id argument selects additional original eligible candidate runs; the original selected run remains required and challenger maps keep calibration-only scope.

A single Python invocation can carry the returned identities end to end:

~~~python
from model.workspace import Workspace
from model import calibration_maps, calibration_review, calibration_report_source

workspace = Workspace(workspace_path)
maps = calibration_maps.prepare(workspace, original_calibration_id)
review = calibration_review.prepare(
    workspace, original_calibration_id, map_id=maps["id"])
source = calibration_report_source.prepare(workspace, review["id"])
print({
    "calibration_id": original_calibration_id,
    "map_id": maps["id"],
    "review_id": review["id"],
    "source_id": source["source_id"],
    "source_collection_id": source["source_collection_id"],
    "directory": source["directory"],
})
~~~

Ordinary native-versus-observation scientific reports also gain the yield table through the maintained observation_diagnostics.build path. Saved comparison IDs and scientific admission policies are unchanged.

## Complete retained outputs

| Existing output | Added interpretation |
|---|---|
| Calibration review HTML | Selected whole-catchment yield table, source-basis scatter plots, original spatial-connection table |
| tables/catchment-yields.csv | All retained candidate/reference rows with run, unit, period, group, denominator, physical yields and support status |
| tables/catchment-relations.csv | Exact original pair connections, overlap area or station basis, original groups and partitions |
| catchment-interpretation.json | Complete original support, source rows, comparison fingerprints and unchanged grouping evidence |
| yield-figures/specification.json and SVGs | Numeric source-bound figure specifications and industrial grayscale plots |
| Original residual atlas CSV/GeoJSON | Yield, area, constituent-basis and support fields alongside existing mass/residual fields |
| Original atlas PDF/SVG | Whole area and reference/prediction yield labels while preserving mass, residual and source-error range |
| Scientific report source | Typed interpretation sections, original dossier companions, yield figures and complete JSON |

The review registers every new file in its ordinary inventory and archive. The source report copies those complete companions and adds its own exact numeric figure specification. GIS exports preserve the original polygon parts and holes; the residual layer style and nominal residual meaning remain unchanged.

New review/source/map presentation editions receive new presentation identities. Historical map selections without a presentation-edition key are reconstructed exactly when inspected, and earlier report-source editions remain supported. None of the new presentation code changes native runs, observation editions, calibration plans/results, nominal rankings or validation-group assignments.

## Producing-worker inspection of the outgoing edition

Owner-directed rendered-product inspection, version 2026-10-13.1, applies to this current receiving course. Before calling the outgoing scientific report, atlas, operator view or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the actual populated screen or its real screenshots, and operate its important controls. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the product.

Continue the existing completed-calibration operation and retain its exact source pin, calibration/map/review/source IDs and output paths. Open the real populated calibration review and scientific report in the operator at the intended screenshare width and at a narrow width where relevant; exercise source selection, figure/table access, empty/loading/error states and the important controls. Download and reopen the HTML, PDF and ZIP through their ordinary links. Inspect the actual six-panel atlas PDF pages, complete multi-line yield/area labels and footer, source-basis figure labels, repeated-period rows, long catchment names, held-out labels and CSV/GIS downloads. Open the received edition as part of the existing archive continuation.

Keep the industrial presentation readable: clear hierarchy, consistent typography and spacing, restrained controls, useful labels and tables that remain readable without clipping or horizontal overflow. Fix broken links, missing styling, cramped or unreadable content in the maintained producing source, then inspect the corrected outgoing edition. Preserve all original workflows, source identities, scientific computations and calibration choices.

Return the actual output identities and accessible rendered pages or screenshots to the existing source owner so that owner can view the same outgoing result and repair visible defects. Use these focused checks to finish the current delivery; do not add a broad test suite, separate verification product, new watcher, forced restart or duplicate native solve. The existing sprint cutoff remains October 13, 2026 at 14:00 UTC.
