# Original parcel geometry for published spatial criteria

New criterion preparation now uses the full original parcel for source-derived spatial criteria by default. A study may explicitly select its reporting-boundary intersection instead. The choice is saved in the criterion operation, table, imported source scope, CSV, GeoPackage, point details and portable report.

The original parcel and reporting geometries remain separate throughout. Native pollutant aggregation, portfolio area limits and the saved land-cover scenario footprint continue to use their maintained declared geometry.

## Why this changes the source calculation

The original Lake Keowee plan describes hydric-soil acreage on the parcel in Appendix D, printed page 140, and sensitive-riparian acreage within each parcel on printed page 139. The parcel-size criterion is on printed page 142. These source definitions support measuring the complete selected parcel. Applying the reporting boundary first is a distinct regional interpretation and is now an explicit option.

The source still supplies its actual footprint and coverage. Selecting the full parcel does not extend a returned source polygon, infer absence outside its support, or allocate a soil component percentage to an unknown part of a parcel.

## Prepare the criteria

The existing public input gains one setting:

~~~python
from source_tools import parcel_criteria

result = parcel_criteria.prepare(workspace, {
    "study_id": actual_study_id,
    "settings": {
        "spatial_criteria_basis": "whole_original_parcel"
    }
})
~~~

The retained reporting-boundary interpretation is:

~~~python
result = parcel_criteria.prepare(workspace, {
    "study_id": actual_study_id,
    "settings": {
        "spatial_criteria_basis": "reporting_parcel"
    }
})
~~~

The selector also works with the existing new-study geographic specification under study instead of study_id. Source role overrides and all existing settings remain available. The CLI accepts the same JSON through prepare, or an explicit settings JSON through auto --study ACTUAL_ID --settings /actual/settings.json.

Operator label: **Source criterion geometry**.

| Value | Suggested choice label | Effect |
|---|---|---|
| whole_original_parcel | Full original parcel | Default for new source preparation. |
| reporting_parcel | Reporting-boundary intersection | Explicit saved regional adaptation. |

When preparing from a completed soil/floodplain source operation, preserve that operation's actual parcel_criteria_selection and source bindings. To choose a criterion basis, merge the explicit setting into the returned settings object before calling prepare. This changes the criterion interpretation and operation identity while reusing the original captured source bytes.

~~~python
selection = dict(capture_result["parcel_criteria_selection"])
selection["settings"] = {
    **selection.get("settings", {}),
    "spatial_criteria_basis": "whole_original_parcel",
}
criteria = parcel_criteria.prepare(workspace, selection)
~~~

## Which calculations use which geometry

| Criterion or quantity | Actual basis |
|---|---|
| Hydric and sensitive-riparian acreage | spatial_criteria_basis. |
| Stream length, stream order and classified reaches | spatial_criteria_basis. |
| Wetlands, modified wetlands, floodplain presence and source-water protection presence | spatial_criteria_basis. |
| Retained impairment-contribution geometry and source points such as dams | spatial_criteria_basis, with each source's explicit relation. |
| CWA parcel mean | spatial_criteria_basis; only complete selected raster support establishes the class. |
| Drinking-water and other-water adjacency | spatial_criteria_basis with the saved adjacency distance. |
| Parcel size, protected status and protected-land adjacency | Full original parcel, independently of the spatial selector. |
| Agricultural share, agricultural-water adjacency and developed-land presence | Existing land_cover_basis. Default whole_parcel; an explicit reporting_parcel selection stays independent. |
| Development within a floodplain criterion | Existing floodplain_development_basis. Default whole_parcel; the alternative uses the actual selected floodplain intersection. |
| Current modeled N/P/sediment criteria | The explicit native binding's original reporting footprint and native support. |
| Native annual quantities and paired scenario differences | Existing native reporting geometry and common-support rules. |
| Portfolio quantities, cost and area limits | The saved portfolio's existing union and selected whole/reporting area budget. |

This separation matters when a parcel crosses the reporting boundary. A whole-parcel point score can describe more land than the native reporting contribution. The report displays both areas and the criterion basis. If an optimizer divides the point score by reporting hectares, that remains an explicit points-per-reporting-hectare objective.

## Source coverage and acreage bounds

For a chosen scoring geometry P, a positive source footprint O and actual certainty coverage C:

- The lower acreage is area(P intersect O).
- The unresolved acreage is area(P outside (O union C)).
- The upper acreage is the lower plus the unresolved area, capped at area(P).

The same closed-bound method applies to full parcels and reporting intersections. A source captured only over the reporting domain can provide positive observations inside that domain while leaving the rest of a full parcel unresolved. Its coverage metadata governs absence. A query envelope is not automatically certainty coverage.

The existing soil/floodplain acquisition already includes the full original selected parcels in its AOI. A completed original soil capture can be reused where its retained query geometry covers that AOI; missing original geometry is acquired through the maintained source path.

Sensitive-riparian derivation still combines original variable-buffer results with the selected 30.48-metre waterway buffer. The original waterway search covers the chosen parcel buffered by that distance. Adjacency searches use the separate saved adjacency distance. Original source collectors should retain those actual masks and original response bodies.

## Stream-length population

Each parcel's original stream length is measured on the chosen geometry. The study mean uses positive complete lengths from the selected population under that same saved basis. If any selected parcel lacks complete support, the canonical above-mean criterion remains unresolved; the available complete-row mean is retained separately.

The population descriptor now includes spatial_criteria_basis. It does not mix full-parcel lengths with reporting-intersection lengths in one saved operation.

## What is retained

Each table row contains:

| Field | Meaning |
|---|---|
| metrics.whole_parcel_acres | Full original parcel area. |
| metrics.reporting_parcel_acres | Original parcel/reporting intersection area. |
| metrics.reporting_share | Reporting area divided by full original area. |
| metrics.spatial_criteria_acres | Actual selected spatial scoring area. |
| metrics.spatial_criteria_basis | Exact selected whole/reporting setting. |
| spatial_criteria_basis | Row-level retained geometry interpretation. |
| metric_bounds.*.area_basis | The actual geometry for each numeric criterion's closed bounds. |

The table, result and imported entry scope carry spatial_criteria_basis and metric_geometry. The per-metric map records independent full-parcel, land-cover, development and native-support meanings. The GeoPackage's original_parcels and reporting_parcels layers both expose criteria_acres and criteria_basis alongside their original full/reporting fields.

The existing geometry_context still binds the actual original parcel source edition, layer, selection and reporting source/grid. The setting does not substitute a new geometry edition. It changes a source calculation over those same retained shapes and is part of the new operation identity.

## Reports and prior operations

The report reads the saved table and interval geometry. It displays the actual source-criterion basis and retains full and reporting acres independently. Its metric CSV carries the per-metric geometry descriptor. Native output units and support fields remain separate.

Completed version-2 criterion operations and tables keep their original basis and original files. They are not relabelled as whole-parcel measurements. A new request under version 3 produces a new identity containing its explicit geometry setting, source profile and implementation.

An interrupted older operation still belongs to its saved implementation. To prepare a successor, submit its original study/source choices as a new request and specify the desired geometry basis. The previous checkpoint files remain associated with their original operation.

## Integration

This successor supplies complete source_tools/parcel_criteria.py, source/parcel-criteria-sources-20261013.json and model/conservation_reporting.py. Its integration JSON also carries uniquely guarded documentation updates for the existing builder, interval and report guides.

The maintained twelve report joins to model/conservation.py remain valid. No new model score, portfolio solver or native engine API is introduced. The UI/queue only needs to pass settings.spatial_criteria_basis to the existing criteria preparation action and show the returned field.

For an actual source-to-score receiving run, keep the existing captured source family and study ID, prepare the new table, build the selected published-practice study, then call the maintained conservation.export_packet on that saved study or plan. Return the actual source-operation, criteria-operation, source collection, study and packet identities.

## Primary references

- Lake Keowee Watershed-Based Plan (2020), Appendix D, printed pages 139, 140 and 142: https://www.des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/WPLakeKeowee.pdf
- Official alternate source: https://www.des.sc.gov/sites/des/files/media/document/WBP_for_Lake_Keowee_Watersheds_2020.pdf
- Original publisher edition: https://www.lakekeoweewatershed.org/files/files/Lake%20Keowee%20Watershed%20Plan.pdf
- Table 31, printed page 47, appears under section 10.1 and supplies the protection scorecard.
