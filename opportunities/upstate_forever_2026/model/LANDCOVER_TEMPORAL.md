# Observed land-cover trajectories

This extension operates inside the existing Land-cover changes calculation, saved Workspace editions, Scientific Reports and portable exports. The original pairwise run/source behavior is retained. Select **Observed timeline** in the existing operator; select actual retained raster bands, enter their observation years in chronological order, choose the original reporting polygons and inspect the input preview before running. The ordinary operator handles these controls; a JSON selection is an optional scriptable representation.

## Source and scientific meaning

Use the actual source's mapping year, not its download date. The input preview displays the original label, vintage, URI, band and exact raster identity. Years are explicit operator selections bound into the saved calculation; they are not inferred from filenames. Keep the product and collection/version consistent and retain all original masks/sidecars. The application requires an identical native width, height, coordinate system and affine transform across the observations and does not resample categorical rasters in this operation.

USGS Annual NLCD Collection 1.2 includes observations through2025. Its official change product is derived from differences between consecutive land-cover maps, attributed to the later observation year. The class maps and confidence product have different roles: classification confidence is not a probability that an inferred real-world management event occurred. The core original source references are:

- USGS, Annual NLCD Collection 1.2 release: https://www.usgs.gov/centers/eros/news/annual-nlcd-collection-12-now-available
- USGS, Annual NLCD Land Cover Change: https://www.usgs.gov/centers/eros/science/usgs-eros-archive-land-cover-annual-nlcd-collection-1-land-cover-change
- USGS, Annual NLCD Land Cover Confidence: https://www.usgs.gov/centers/eros/science/usgs-eros-archive-land-cover-annual-nlcd-collection-12-land-cover-confidence
- MRLC, actual class legend: https://www.mrlc.gov/data/legends/annual-nlcd-land-cover-legend
- USGS original data release: https://doi.org/10.5066/P94UXNTS

These primary sources were read on 2026-10-13. Product availability is context; each calculation remains bound to the source bytes actually selected in its Workspace.

A sequence such as 41 →21 →41 contains two observed transitions and a return to its initial class. It must not disappear merely because its endpoint classes agree. A sequence 41 →42 →43 changes the detailed forest class while remaining within the original41/42/43 forest group. Woody wetland 90 remains in the original wetland group. Other class groups are unchanged from the maintained reducer.

**Observed retention:** persistent final area is changed area whose final class appears in at least two trailing selected observations. It is not continuous duration, a verified event date, ecological recovery or future permanence. The last transition is bracketed by its two selected years. For 2019, 2020, 2022, 2023, the 2020→2022 interval remains a two-calendar-year gap. No 2021 class is created. Two observations alone support an endpoint change; they cannot show a return or repeated final-state evidence after a change.

**Returns and groups:** reversal_count counts each transition into a class previously observed after leaving it. Thus 41→21→42→21 has one such return even though it ends in a different class from the initial one. returned_to_initial reports the separate whole-sequence endpoint return. Group entered/exited hectares each count a cell once if any corresponding group crossing occurred. A forest→nonforest→forest path contributes to both entry and exit and to returned membership. Those quantities overlap and must not be summed as disjoint areas.

## Calculation and interruption recovery

The original reducer reads each native window once. It computes the existing exact polygon/pixel intersection fractions, original valid masks and supported class codes, and uses the intersection across **all** selected observations. Pair-specific masks are refused for a timeline. Unknown codes follow the existing error/exclude policy, and original support/unknown-class accounts remain in the baseline-versus-each-observation rows.

The same window's exact class-sequence patterns and fractional hectares are attached to the existing original SQLite tile transaction. The original raster outputs and every temporal output close before committing that row. A cancelled or interrupted tile is rewritten on resume; a committed tile is reused. The fingerprint includes original source and companion hashes, ordered bands, selected years, options and the temporal reducer source identity. Changed inputs or chronology require a new edition. There is no second scheduler, checkpoint store or hydrology model.

Every annual class table, adjacent transition matrix and trajectory total uses the same support. The complete trajectory total is checked against the original ledger's common-support area. Each reporting polygon retains fractional hectares; the study-area domain is the unique union. Positive-area cell-intersection counts are useful local counts but double-count a boundary cell across adjoining polygons, so sum hectares instead.

## Full outputs and normal reopening

Existing ledger.json, report.html, original comparison CSVs, source-edition binding, polygon geometry and baseline transition rasters remain present. The same portable archive additionally contains:

| File | Meaning |
|---|---|
| timeline-summary.csv | Every reporting area's observed change, returns, retained final class and forest quantities |
| timeline-trajectories.csv | Every actual selected class sequence, area, intersection count and observation metrics |
| timeline-annual-classes.csv | Every class area in every selected observation |
| timeline-adjacent-transitions.csv | Every adjacent selected-observation transition |
| timeline-groups.csv | Stable membership and overlapping observed group-crossing accounts |
| timeline-source-years.csv | Explicit observation years beside original source vintage, band and identity |
| timeline-class-sequence.tif | One native-grid band per selected year; original class codes, zero excluded |
| timeline-status.tif | 1 stable, 2 one transition, 3 multiple transitions, 4 returned to initial; 0 excluded |
| timeline-change-count-plus-one.tif | Observed transition count plus 1; 0 excluded |
| timeline-final-class-observations.tif | Trailing selected observations in final class; 0 excluded |
| timeline-last-transition-to-year.tif | Later selected year in last transition; 0 stable or excluded, distinguished using status |
| timeline-forest-status.tif | 1 always forest, 2 always outside, 3 ended in forest after entry, 4 ended outside after exit, 5 returned membership; 0 excluded |

Raster class attribution stays at the original pixel resolution; apply study-area-fraction.tif to obtain the unique study-area fraction. The exact original polygons and full source-year table remain in the archive. The source inputs themselves remain retained in Workspace; **Prepare scientific report** also carries those actual original inputs through the existing source bundle.

Open the existing report.html to view the full annual tables, paginate all trajectories, inspect adjacent matrices and download the original CSV/raster files. Open the whole archive with the original landcover receive command to verify every declared member. A saved timeline appears in the existing edition list and is inspected by the original Workspace reader. Scientific Reports receives the complete chronology and per-area summary, annual class table, source identities and every original attached output.

## Optional native API

Use the existing model.landcover_cli workspace preview/build commands with the same ordinary selection path. A selection's additional fields are:

    {
      "input_mode": "timeline",
      "annual_sources": [
        {"year": 2021, "source_collection_id": "<actual existing ID>", "source_id": "<actual raster ID>", "band": 1},
        {"year": 2022, "source_collection_id": "<actual existing ID>", "source_id": "<actual raster ID>", "band": 1},
        {"year": 2023, "source_collection_id": "<actual existing ID>", "source_id": "<actual raster ID>", "band": 1}
      ],
      "zones": {"source_collection_id": "<actual existing ID>", "source_id": "<actual polygon ID>", "id_field": "huc12", "name_field": "name"},
      "options": {"support_scope": "all", "unknown_policy": "error"},
      "title": "Observed land-cover timeline"
    }

The template IDs are placeholders, never sample project identifiers. The UI supplies actual catalogue selections and preserves the original source labels. Years must be unique integers 1–9999 in strictly increasing order. A source band may be selected only once. Existing source/run selectors keep their original shapes and behavior.

## Current product direction and actual use

Apply CURRENT_OWNER_DIRECTION.md 2026-10-13.4 together with the newer full post-call 52-order bank F0C8R2SQ0NP in the original Eco thread. Bryce's current purpose is for Tim to run his own files through the system: preview actual fields/units, choose scientific settings, Run, read readable results and save/export/reopen. Preserve his original organization and identifiers; optional technical JSON must not become an imposed user workflow.

The producing worker must operate and visually inspect the exact outgoing full operator/report at desktop and narrow widths, use the populated/empty/error states, download and reopen its actual attachments, and repair concrete findings. The complete operator/LANDCOVER_TIMELINE.md carries the full current owner instruction and actual receiving course. Source inspection alone is not an opened-product result. Existing completed native studies and their owners remain intact.
