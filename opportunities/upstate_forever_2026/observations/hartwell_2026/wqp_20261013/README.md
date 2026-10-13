# Lake Hartwell RL-26024: original 2026 observations

This is the complete official WQP/SCDES edition for station `21SC60WQ_WQX-RL-26024`, Lake Hartwell northeast of Broyles Recreation Area (34.52926917, -82.81795229; HUC8 03060101). Original source URLs, exact hashes and capture limitations are in `capture/capture.json`. All four original CSV bodies remain unchanged.

The request covers January 1–October 13, 2026. The actual rows cover six activities dated January 21, February 12, March 11, April 14, June 1 and July 6: 132 distinct result IDs and 132 matching limit rows. Acquisition used the existing public-URL attachment route, followed by full-body readback. Origin HTTP status/headers and exact origin fetch instants were not exposed and are recorded as null. The completion timestamp describes verification, not an invented server timestamp.

## Choose an interpretation edition

- `detection-v2/collection.json` is the preserved first prepared edition: 10 temperature and 6 total-phosphorus records recognized; 116 retained as unmapped.
- `characteristics-v1/collection.json` explicitly pins the characteristic mapping as well as detection-v2: all 132 original records recognized across 26 parameter keys, zero rejected rows. Original observations are the same; these are interpretations of the same source, not 264 independent measurements.

All 34 censored results retain an upper threshold and no point value. Six TKN and six nitrate-plus-nitrite results are not total nitrogen. Six total-phosphorus results preserve explicit as-P/unfiltered source context. Two hardness results have no stated chemical basis. MPN and CFU, NTU and FNU, method contexts and depth fields remain distinct. All original method/speciation/qualifier/fraction cells remain retained.

## Source questions for scientific review

The source uses EDT for every activity, including winter dates. Two salinity records report 36.79 ppt in this freshwater site context. Preserve these exact fields while obtaining publisher clarification; no correction is inferred. Repeated physical values remain distinct original result identities, not automatically independent replicates or averages. No catchment match, annual load, impairment determination or native model calibration is claimed.

## Actual native receiving course

From the maintained application root, pass the full `characteristics-v1` directory to existing `measurement_workspace/engine/cli.mjs collection-preview`, then `collection-receive`, `collection-publish`, and follow its original RECEIVING.md into a fresh workspace. The exact commands and full producing-peer visual/all-attachment requirements are in `source_tools/WQP_OFFICIAL_EDITION.md`. Pure source preparation completed here; SQLite and browser acceptance remain with the existing equipped owner.

Scientific reference: [EPA WQX nutrient semantics](https://www.epa.gov/sites/default/files/2017-06/documents/wqx_nutrient_best_practices_guide.pdf), [EPA detection-limit guidance](https://www.epa.gov/system/files/documents/2025-09/wqxdetectionlimitsbestpracticesguide_final.pdf), and the [official station page](https://www.waterqualitydata.us/provider/STORET/21SC60WQ_WQX/21SC60WQ_WQX-RL-26024/).
