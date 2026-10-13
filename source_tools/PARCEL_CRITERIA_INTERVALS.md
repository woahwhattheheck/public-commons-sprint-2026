# Source acreage intervals in published parcel priorities

The parcel criteria builder now carries the acreage that the retained sources establish, together with the largest additional footprint that remains possible inside the original parcel geometry. The Lake Keowee point engine applies the published acreage thresholds to that complete interval. A criterion receives exact points whenever every attainable acreage receives the same published contribution.

This connects the original hydric-soil and floodplain acquisition to the existing Conservation workflow: capture original sources, derive the current parcel table, inspect its criterion coverage, score the published practice, and select a portfolio using the same original parcel IDs and geometry.

## Use it in the current operator

Choose the actual parcel study and reporting area in Conservation. **Build criteria from imported layers** reads its saved source editions. The source-acquisition task can also prepare criteria directly from its retained result, carrying the actual hydric certainty footprint and selected floodplain source.

When the task completes, use **Use prepared parcel criteria**. The operator restores the originating study geometry and selects its retained JSON table. Build the published **Land protection** study. The candidate details carry the acreage interval, source relationship, known and possible points, and exact criterion points when the interval determines them.

The existing portfolio operation consumes the saved candidate IDs and exact selected parcel union. Its native scenario and experiment handoff use that same footprint. The numerical interval describes a source criterion; it does not replace or reshape the selected land.

Useful demonstration sentences:

1. “This table is built from the selected original parcels and imported source layers.”
2. “The mapped footprint gives a lower acreage; the unresolved part of the parcel gives its upper limit.”
3. “We apply every published threshold that the interval can reach.”
4. “When the entire interval receives the same points, that criterion is resolved.”
5. “The portfolio keeps the original selected parcels and sends their actual footprint into the native scenario.”

## The area calculation

Let P be the analysis parcel, O its positively mapped criterion footprint, and C the actual source certainty coverage. The builder computes:

- Lower area: area(P intersect O).
- Unresolved area: area(P outside (O union C)).
- Upper area: lower area plus unresolved area, capped at area(P).

The original geometry is transformed into the study's selected projected coordinate system in metres. The existing builder uses 4046.8564224 square metres per acre. Source polygons are unioned before their overlap areas are measured, so overlapping fragments do not add acreage twice.

A source's query mask and its certainty coverage have different jobs. A soil query rectangle records where the original service was asked for data. The default hydric certainty geometry contains map units positively resolved as fully hydric or fully nonhydric. Mixed and unknown map units can lie inside the original query rectangle while remaining outside that certainty geometry.

The acquisition adapter exports those two source relationships separately. The criteria builder receives the actual certainty selection through its source binding. A positive footprint remains useful even where coverage is incomplete: it belongs in the lower limit and is removed from the unresolved remainder.

When a footprint source has not been selected, parcel geometry alone supplies the interval from zero to the analysis parcel's area. Its method is parcel_geometry_area_limit and its source_roles is empty. This can establish a zero-point acreage criterion for a parcel smaller than the first published threshold. It does not assign an observed feature to that parcel.

The canonical exact acreage is populated when determined. Otherwise it remains null and the separate interval carries the available quantitative information.

## Which parcel geometry each criterion uses

| Criterion | Geometry | Interval |
|---|---|---|
| parcel_acres | Full original parcel polygon | Equal lower and upper limits from the original full area |
| hydric_soil_acres | Declared spatial_criteria_basis; full original parcel by default | Positive selected hydric footprint plus unresolved certainty coverage |
| sensitive_riparian_acres | Declared spatial_criteria_basis; full original parcel by default | Positive published riparian union or its observed components, plus unresolved support |

For a parcel crossing the reporting boundary, the table preserves full parcel area, reporting area and the actual source-criterion geometry independently. New operations default to full original parcel geometry for spatial criteria; reporting_parcel is an explicit saved adaptation. Prior completed tables retain their original basis. Both original_parcels and reporting_parcels GeoPackage layers retain those fields and their interval endpoints.

The generated table retains geometry_context and its SHA256, which bind the exact parcel source edition, layer, selection and reporting source or native grid. The point engine compares that context when a builder-produced JSON table is selected for another study. Matching parcel labels cannot silently substitute another geometry edition.

## Hydric soils

The default original-source interpretation selects a fully hydric map unit using native hydclprs = 100 together with the retained component-rating agreement described in SOIL_FLOODPLAIN_SOURCES.md. Its certainty footprint also includes confirmed fully nonhydric map units. Mixed or unknown map units retain their original percentages and component attributes and enlarge the acreage interval.

A native map-unit percentage describes the original survey map unit. The implementation does not multiply a parcel overlap by that percentage to create a spatially located hydric acreage. The interval uses actual selected geometry and the remaining parcel area.

An explicitly selected predominant or any-component interpretation remains part of the retained acquisition and source binding. The same interval calculation then applies to that chosen whole-map-unit footprint and its actual coverage.

The published hydric contribution is:

| Hydric acreage | Points |
|---|---:|
| At least 50 | 3 |
| At least 30 and below 50 | 2 |
| At least 5 and below 30 | 1 |
| Below 5 | 0 |

These values come from the Lake Keowee Watershed Plan, Appendix D, printed page 140. The current method document keeps the source and page alongside each criterion.

## Sensitive riparian area

The published sensitive-riparian footprint combines the original variable riparian model with the 100-foot surface-water buffer. The existing builder accepts an already retained complete union, or the original variable footprint plus its retained surface-water source.

Every positively mapped component is a subset of that union. The revised builder keeps the observed constant buffer even when the variable model is absent. Its acres contribute to the lower limit. Conversely, a missing constant or variable component can still contribute unobserved area, so the composite upper limit remains conservative until the selected component sources provide complete support.

A positive observed component also establishes sensitive_riparian_present. The original land-cover overlay can establish a positive forested-riparian intersection on that observed component. Absence still follows the actual source coverage.

For a directly imported sensitive_riparian union, the original coverage geometry can remove known-absent area from the upper limit. For a partially assembled variable-plus-water union, the implementation uses complete-component support when available and otherwise retains the unobserved remainder as possible area.

The published sensitive-riparian contribution is:

| Sensitive riparian acreage | Points |
|---|---:|
| At least 43 | 4 |
| At least 20 and below 43 | 3 |
| At least 8 and below 20 | 2 |
| At least 2 and below 8 | 1 |
| Below 2 | 0 |

These values come from Appendix D, printed page 139. Full-parcel size contributes one point at 50 acres, as described on printed page 142.

## Applying an interval to the published steps

The engine treats interval endpoints as included. It evaluates the published step function at both endpoints and at every threshold within the interval, preserving the values immediately below each threshold. The smallest and largest attainable point values become known_points and possible_points.

| Input interval | Published criterion | Known points | Possible points | Exact criterion points |
|---|---|---:|---:|---:|
| 52 to 68 acres | Hydric soil | 3 | 3 | 3 |
| 31 to 47 acres | Hydric soil | 2 | 2 | 2 |
| 4 to 7 acres | Hydric soil | 0 | 1 | Unresolved |
| 0 to 4.5 acres | Hydric soil | 0 | 0 | 0 |
| 29 to 30 acres | Hydric soil | 1 | 2 | Unresolved |
| 43 to 60 acres | Sensitive riparian | 4 | 4 | 4 |

The closed 30-acre endpoint in the fifth example reaches the next hydric point band. The engine preserves that possibility. Exact acreage can remain null in the first, second, fourth and sixth examples while the published point contribution is determined.

These are direct applications of the published threshold rules. The study's own original geometry supplies its actual intervals.

The overall point score follows the existing category calculation: sum criterion contributions, preserve criterion maxima and the practice prerequisite, and assign an exact total when all required contributions are determined. Partial totals retain their known and possible points. Current modeled nitrogen, phosphorus and sediment quantities remain separate candidate fields.

## Retained table contract

The existing upstate.parcel-criteria/v1 table gains rows[].metric_bounds. Each numeric field descriptor contains:

| Field | Meaning |
|---|---|
| lower, upper | Finite nonnegative closed acreage limits |
| unit | acres |
| method | Original positive-footprint/coverage calculation or parcel_geometry_area_limit |
| reference | Original criterion/source meaning |
| area_basis | whole_original_parcel or reporting_parcel |
| analysis_area_acres | Area of the bound original geometry |
| observed_positive_acres | Area already inside the positive footprint; null when only the parcel-area bound is available |
| unresolved_acres | Additional area still possible under selected source support |
| confirmed_absence_acres | Analysis area excluded from the upper footprint |
| source_roles | Actual selected source roles used in the calculation |
| structural_only | True when the interval uses only the original parcel-area limit |
| coverage_complete | Whether the selected source covers the analysis geometry under the maintained coverage rule |
| exact | Whether the numeric endpoints are equal |

Row metrics retain their current canonical names and exact values. An unresolved numeric value remains null. The table-level numeric_intervals descriptor explains the calculation and records the available interval fields.

Coverage summaries preserve known and unknown exact-value counts. Numeric summaries also expose intervals, bounded_unknown, minimum_lower, maximum_upper and interval_unit. The same descriptor is retained in the imported source entry's scope.

The point reader validates finite ordered endpoints, included endpoints, units, method and reference. A supplied exact numeric value must lie inside its retained interval. Existing tables without metric_bounds continue through their original scalar path.

A canonical acreage field uses acres. An explicitly bound table field can use the existing ha_to_acres transform if its interval is declared in ha or hectares. Both endpoints convert together and the original interval remains in provenance. Candidate or native-export bindings continue to use their selected quantities; an unrelated same-name table interval does not replace them.

## Point details and exports

Candidate point_score contains metric_values, metric_sources and metric_bounds. Each numeric score component can include:

- value: its exact numeric acreage, or null.
- value_interval: lower, upper, unit, method and reference.
- evaluation: exact_metric, bounded_metric or undetermined_metric.
- known_points, possible_points and points.
- points_determined_by_interval: true when a nonexact acreage still resolves the published contribution.

The existing normalization summary also records parcels_with_numeric_intervals, criteria_determined_by_intervals and complete_scores_using_intervals.

The builder writes the following files:

| File | Interval representation |
|---|---|
| criteria.json | Full row metric_bounds and table numeric_intervals descriptors |
| criteria.csv | Numeric field_lower and field_upper columns plus the full metric_bounds JSON column |
| criteria.gpkg | The same numeric endpoints and full interval JSON in both original and reporting parcel layers |
| sources.json | Imported table/vector identities, geometry binding and interval metadata |
| selection.json | Exact original source choices, retained coverage, settings and implementation identities |

The canonical imported JSON preserves the original parcel IDs and complete context. The viewing CSV retains its existing spreadsheet escaping for formula-like original text.

## Native execution in the existing workspace

The existing acquisition result already contains the exact criteria request:

~~~python
from source_tools import soil_floodplain_sources, parcel_criteria
from model import conservation

capture_result = soil_floodplain_sources.inspect(workspace, actual_source_operation_id)
criteria_result = parcel_criteria.prepare(
    workspace, capture_result["parcel_criteria_selection"])
~~~

The existing source-only preparation can also build directly from the selected imported project layers:

~~~python
criteria_result = parcel_criteria.prepare(workspace, {
    "study_id": actual_parcel_study_id
})
~~~

For a saved request file:

~~~sh
python -B -m source_tools.parcel_criteria --workspace /actual/workspace prepare /actual/criteria-selection.json
~~~

To continue a saved original source selection:

~~~sh
python -B -m source_tools.parcel_criteria --workspace /actual/workspace prepare ACTUAL_CRITERIA_OPERATION_ID
~~~

To build from an existing parcel study and currently imported original sources:

~~~sh
python -B -m source_tools.parcel_criteria --workspace /actual/workspace auto --study ACTUAL_PARCEL_STUDY_ID
~~~

The builder retains its indexed spatial queries and completed parcel batches. Installing a successor implementation creates a distinct operation identity for a newly submitted request. A running operation resumes its original source selection and completed batches when the installed implementation matches its saved identity.

The operator's existing **Use prepared parcel criteria** action restores the source geometry and criterion table. A native assembler can use the returned score_selection as the existing published-method selection and add category_id = land_protection to its new study. Keep the actual parcel/reporting selection and purpose = protection or screening.

## Source references

- Lake Keowee Watershed Plan (2020), Appendix D, printed pages 139, 140 and 142: https://www.des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/WPLakeKeowee.pdf
- Original plan publisher and complete point-method references: https://www.lakekeoweewatershed.org/files/files/Lake%20Keowee%20Watershed%20Plan.pdf
- NRCS Soil Data Mart table/column descriptions, including hydclprs, hydricrating, native map-unit keys and polygon geometry: https://sdmdataaccess.sc.egov.usda.gov/documents/TableColumnDescriptionsReport.pdf
- NRCS original spatial-query definitions: https://sdmdataaccess.sc.egov.usda.gov/documents/AdvancedQueries.html

The interval formula follows geometric set containment in the retained source footprint. The published documents supply the original source meanings and point thresholds.
