# Conservation source and point reports

This edition makes the completed source-to-score workflow usable in a portable Conservation report. It retains the original parcel geometry, source measurements, published point results, native pollutant units and saved portfolio decision. The HTML explains them; CSV and GeoPackage expose the fields directly; JSON and the exact original criterion table preserve their complete meaning.

## Open the report

Build a Conservation study through the existing operator, then use its existing report and export controls. A saved portfolio opens the same report over its actual selected parcel IDs. Exporting an older completed study creates a new presentation edition from that study's verified candidates and geometries.

The portable ZIP opens at index.html. It contains the whole candidate inventory, editable GIS, the original study and plan selections, and a packet-manifest.json listing each member's byte count and SHA-256. New presentation.json binds the added report files to the original candidate and geometry inventories and the original selected IDs.

The original completed study and plan files keep their existing paths and hashes. A refreshed presentation is retained under conservation-exports/<edition ID>. Its identity includes the original subject files and the installed reporting and Conservation implementations. Re-exporting that same edition reuses it.

## Read areas correctly

| Field | Geometry and meaning |
|---|---|
| area_ha | Full original planning-unit geometry, in hectares. |
| reporting_area_ha | Intersection of that unit with the retained reporting boundary, in hectares. |
| whole_parcel_acres | Full original area converted with 10000 / 4046.8564224 acres per hectare. |
| reporting_parcel_acres | Reporting intersection converted with the same exact unit conversion. |
| parcel_acres | The actual bound parcel-size criterion. Its automatic value uses full original parcel area. An explicitly imported criterion retains its selected source/binding. |
| hydric_soil_acres | Actual selected hydric footprint inside the declared source-criterion geometry, under the saved source interpretation. |
| sensitive_riparian_acres | Actual selected sensitive-riparian union inside the declared source-criterion geometry. |

The source builder records area_basis on each numeric interval. Full parcel size can differ substantially from the reporting intersection. Context and modeled quantities describe their declared reporting geometry, while an explicit whole-parcel cost stays a whole-parcel cost.

The Lake Keowee plan's parcel-size criterion is on printed page 142. Hydric and sensitive-riparian area criteria are on printed pages 140 and 139. New source preparation uses the full original parcel by default for spatial criteria. The explicit spatial_criteria_basis setting can select reporting_parcel as a recorded adaptation. The saved table's per-metric geometry map preserves independent land-cover, protected-land, parcel-size and native support meanings; imported external criteria retain their selected interpretation.

The source acquisition AOI includes the complete original selected parcels as well as the reporting domain. Geometry acquisition therefore covers the full parcel where a criterion requires it. Reporting clipping is a separate recorded operation.

## Read a published point result

The report uses the actual retained point_score result and the current study's original normalization metadata. It does not call the point engine again.

| Status | Meaning |
|---|---|
| exact | The practice prerequisite is met and the total points are determined. |
| range | The prerequisite is met; at least one criterion retains different lower and upper contributions. |
| prerequisite_absent | The original criterion values establish that the practice prerequisite is absent. |
| prerequisite_unresolved | The selected sources have not established the prerequisite. |
| not_a_published_point_method | This candidate uses the maintained physical or contextual scoring path. |

point_lower and point_upper are sums of the retained per-criterion bounds. They are conditional on the practice prerequisite. point_exact is populated only when the complete numeric total is determined and the prerequisite is met. Other eligibility rules remain separate: a parcel may have an exact published score while another explicit study rule excludes it from automatic ranking.

The top-level criterion table contributes each criterion once. Maximum and capped-sum subterms stay inside that criterion's retained terms; the long-form CSV never adds those child terms again.

`point_score_options` preserves the discrete attainable totals from the retained source rules. A lower and upper total do not imply that every integer between them is possible. The report also carries `point_priority_options`, `point_source_profile` and `point_classification_states`. Combinations across unresolved criteria remain conservative because correlations between missing observations are not inferred. An unresolved practice prerequisite remains visible even when its conditional numeric contribution is determined.

## Closed acreage limits and exact points

Both interval endpoints are included. For example, the original hydric rule awards one point at five acres, two at thirty, and three at fifty. If a recorded interval reaches exactly thirty acres at its upper endpoint, the two-point contribution remains possible. The complete source-bound interval is preserved in metric_bounds.

An exact point contribution can be determined even while the exact acreage is unresolved. The report labels those contributions through point_interval_resolved_criteria and the detail-table column “Resolved by acreage interval.” The acreage value remains null; the lower and upper fields remain visible.

A structural_only interval uses the parcel geometry to bound an area when a required original footprint is absent. Its observed_positive_acres remains null. A measured zero is different and stays numeric zero. Mixed and unknown soil map units remain unresolved under the fully-hydric source interpretation; a source query mask is not automatically certainty coverage.

HTML numbers use the stored float representation rather than rounding an acreage across a published point threshold. CSV and JSON preserve the saved numeric values.

The published profile retains literal bin endpoints, including the hydric-soil gap between 4.99 and 5 acres and the sensitive-buffer gap between 7.99 and 8 acres. A closed interval is evaluated at every relevant endpoint and across its intervening regions. The report retains an unclassified region or overlapping original classes instead of silently rounding the measurement into a neighboring bin. Its source references identify the unchanged original profile and the actual selected criterion field.

## Follow the decision

An explicit saved selection is described as an explicit parcel selection. A ranked portfolio states its saved objective and deterministic greedy ordering. A saved reviewed optimizer decision identifies the original optimization analysis and shows the recorded objective, engine, solver result and geometry scope.

The report reads those saved choices. It does not rerun a time-limited solver, reorder selected IDs, recompute a published score, alter a land-cover scenario or choose new source editions. The ordinary portfolio builder continues to enforce actual eligibility, full-unit cost, unit count and the selected area basis.

A refreshed export reconstructs the editable selected_union from the verified original reporting polygons for the already-saved selected IDs. Native and context totals are the saved portfolio summary. Original planning-unit and reporting-footprint layers are kept separate.

## Native units and support

The existing Conservation path aggregates InVEST 3.20 NDR and SDR rates using actual polygon-cell intersection hectares. Nitrogen and phosphorus retain kg/year; sediment retains metric_tonnes/year. The report retains the actual native grid's resolution and pixel area.

For an original published classification expressed per native pixel, the detail table retains the original scalar, its physical unit and the actual pixel area. A transfer from a published reference-cell cutoff to a different native cell area is an explicit recorded adaptation; it does not change the annual mass totals or replace the original source profile.

An unselected model family stays unavailable with its original reason. An alternative retains its own support. Its paired difference is alternative minus baseline on the common native support; native structural stream omissions remain separately recorded. Added point fields never replace these quantities or change their units.

## Portable files

| File | Complete contents |
|---|---|
| index.html | Native geography/model tables plus readable parcel-area, prerequisite, exact/range point, criterion and source sections. |
| candidates.csv | All candidates with original model metrics and directly selectable acreage/point/interval fields. |
| portfolio.csv | Selected candidates for a saved portfolio, using the same field meanings. |
| geodata.gpkg | Original planning_units and reporting_footprints with the added numeric/string fields; selected_union for a saved portfolio. |
| criterion-contributions.csv | One row per candidate and top-level published criterion, including exact/lower/upper points, selected flag, original rule reference and nested terms. |
| criterion-values.csv | One row per candidate and required source metric, with exact value, closed bounds, area basis, coverage semantics and original binding. |
| criterion-scores.json | Original typed point_score and score_components for every candidate, including nulls, booleans and complete bounds. |
| source-register.json | Original study and criterion-source identities, input/coverage sources, native bindings, source metadata and the copied original criterion-table descriptor. |
| source-register.csv | Flat original source IDs, references, selected meanings, editions, byte hashes and selection fields. |
| report-data-dictionary.json | Area, point, interval, native-unit, geometry and file definitions. |
| original-criteria.json or .csv, optionally .gz | Exact original selected criterion-table bytes; byte hash is checked against the prepared study. |
| presentation.json | This presentation's implementation identities, original study/plan inventories, selected IDs and generated file hashes. |
| candidates.json, study.json, plan.json | Original machine-readable candidates and saved study/portfolio records. |
| packet-manifest.json | Exact file inventory for the portable ZIP. |

All CSV fields retain the established spreadsheet-safe escaping for formula-like text. Original typed source values remain in JSON and GeoPackage. Long-form CSV records stream to disk so the exporter does not create a second full parcel-by-criterion collection in memory.

The area/point overview previews up to 500 reported units. Expandable criterion and source details preview up to 60 published-practice units in the saved order. The report states those counts whenever the selected population is larger. Every candidate and criterion is included in the linked complete CSV/JSON and GIS artifacts.

## Implementation and integration

New file: model/conservation_reporting.py.

The guarded integration file contains twelve unique replacements for model/conservation.py. They add the module import, flat CSV/GIS fields, the report wrapper, study/plan supplemental files, and fresh export-edition identity/members. They preserve the current native resolution validation, cell-area labels, selected NDR/SDR availability, point engine and actual portfolio algorithms.

The existing _report is renamed _base_report; the wrapper passes its unchanged native tables into extend_report. The wrapper inserts the new source-to-score sections at the existing unique decision heading and replaces the old unconditional greedy explanation with the actual saved decision description. If the maintained base report changes those anchors, the renderer reports the exact mismatch instead of silently dropping the explanation.

Public helpers used by the joins:

~~~python
conservation_reporting.flat_values(candidate)
conservation_reporting.csv_fields()
conservation_reporting.gis_fields()
conservation_reporting.extend_report(base_html, study, candidates, plan=plan)
conservation_reporting.write_supplements(workspace, directory, study, candidates, plan=plan)
conservation_reporting.presentation_members(workspace, export_directory, study, candidates, plan=plan)
conservation_reporting.identity()
~~~

Existing operational commands remain valid:

~~~python
from model import conservation

study = conservation.inspect(workspace, actual_study_id, include_candidates=True)
packet = conservation.export_packet(workspace, study["id"], actual_plan_id_or_none)
~~~

Use an actual retained source-operation result to prepare the criterion table, then create the existing published-method study through the operator. The maintained criteria result contains the original source collection, table ID, geometry context and score selection. Choose the matching published category and retain its interpretation; the existing UI restores the original study geometry when using a prepared table.

## Source references

- Lake Keowee Watershed Plan (2020), Table 31 and Appendix D, including printed pages 139, 140 and 142: https://www.des.sc.gov/sites/des/files/media/document/WBP_for_Lake_Keowee_Watersheds_2020.pdf
- Original publisher edition: https://www.lakekeoweewatershed.org/files/files/Lake%20Keowee%20Watershed%20Plan.pdf
- InVEST 3.20 nutrient delivery user guide: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- InVEST 3.20 sediment delivery user guide: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html
- NRCS original map-unit/component schema: https://sdmdataaccess.sc.egov.usda.gov/documents/TableColumnDescriptionsReport.pdf

Every generated report also retains its actual selected source URLs, source bodies, table fields, layer selection, vintage and original byte hashes.
