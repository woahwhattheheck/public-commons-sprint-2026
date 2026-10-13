# Original 217-HUC NHD query envelopes

The pending original-domain query calculation is complete for AE11 / eco_source's existing source acquisition operation. There are 13 occupied query rectangles and three empty historical cells: tile-1-1, tile-3-4 and tile-4-4. All 217 original polygons, 217 rings and 273,049 original vertices were read from the unchanged retained source member.

## Use

queries.json contains the 13 existing-style {id,envelope} records. Keep envelope as its serialized string when passing the ArcGIS geometry parameter so the original decimal tokens remain unchanged. member-query-plan.json contains every original covered-HUC membership, all 16 cell outcomes, source identities and exact outer bounds. Those envelopes feed the current agency count/ID/geometry acquisition; use the maintained original-ring receiver for final feature selection.

The original 16-cell grid and entire historical query-plan.json reproduce exactly from the retained CSV. Every CSV feature ID, ring count, vertex count and source-feature pointer matches the full original geometry; the reconstructed five-file source bank matches SHA338ebb7f6d7fb7d74a0e3064367206487c57b638a28268bed4af0692cc7641cc. Exact coordinate parsing preserves all source decimal lexemes, compares their arbitrary-precision values when necessary, retains original interior grid partitions, and extends outer edges to original extrema. Completed execution used the same closed-intersection and conservative-enclosure rules in merged source_tools/nhd_domain_queries.py (PR3438).

## Replay

replay.mjs exports deriveQueries(originalDecodedText, originalBoundsCSV, inventoryObject, originalHistoricalPlanText) and exactJSON(value). It is self-contained JavaScript with no dependencies. The original input identities and source-member retrieval are in member-query-plan.json. The retained acquisition inventory supplies coverage_grid; its domain_query_bounds descriptor pins all five original bounds members and historical query plan. The existing Python archive command remains the original native receiver's archive-based entry point. This package records direct verified-member execution separately and does not overwrite that command's archive receipt path.

Preserve the existing acquisition edition and already received responses. The completed exact output is supplied to the original source owner so remaining exterior queries can proceed immediately. All geometry, CRS, feature ordering and agency source values remain unchanged.
