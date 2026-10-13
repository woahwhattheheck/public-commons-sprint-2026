# Adaptive acquisition of the original high-resolution stream network

This is a complete replacement for source_tools/capture_water_sources.py from merged PR2772. It includes the complete-envelope tiling extension and adaptive recovery for slow publisher envelope queries.

Run with the retained original 217-HUC domain archive:
```sh
python source_tools/capture_water_sources.py --domain-archive ORIGINAL_DOMAIN.zip --output CAPTURE --layer stream_order --stream-grid 4 --stream-spatial-relation index --stream-max-depth 4 --chunk 500
```

Each envelope must complete its original publisher count and native OBJECTID inventory before geometry capture proceeds. The script unions native IDs across adjoining envelopes, downloads each selected ID once with all attributes and geometry, and checks every original geometry page against its requested native IDs. water_context_geometry.select_domain_objects then performs exact selection against the original polygon domain.

If an envelope query times out or returns HTTP408/502/503/504, the script splits that envelope into four adjoining children and retries those complete queries. It retains completed original requests by their request hash. The saved inventory-progress file also retains subdivision decisions, so resuming does not repeat an expensive failed parent query. HTTP429 retains the existing Retry-After/backoff path and never causes a subdivision. All other failures stop with their actual error.

The --stream-max-depth limit controls subdivision depth per starting tile; default4 and allowed0..8. Set0 to disable adaptive splitting. The default --stream-grid remains1 and covers the whole original envelope. The freshwater selection and its original 217 HUC identifiers are unchanged.

A partial run keeps its complete original response files and inventory progress. A completed inventory records every successful leaf query. A capture.json with complete_geometry true is written only after all requested layers finish. The original adapter still verifies counts, native IDs, all-field geometry and exact-domain selection before creating the edition.

Source review: parent/child coverage, retry classification, native-ID union, retained request hashes and interrupted-run resume checked. Native Python execution remains to be performed by the receiving host.

## Native geometry batch recovery

The same timeout handling now divides an oversized native-ID geometry request into two nonoverlapping ID batches. The original native IDs, all source fields, and metadata-driven Z/M dimensions remain unchanged. Each successful original page must contain exactly its requested IDs. Partial, duplicate or mismatched responses raise their actual validation error.

Geometry subdivisions are retained in a separate progress companion keyed by the complete native-ID inventory and batch hash. Resuming uses the existing successful request-hash cache and skips previously failed parent batches. A singleton retains ordinary retries and fails explicitly if the publisher still cannot return it. Quota responses never trigger subdivision.

These changes address the observed original service behavior: some 100/500-ID queries timed out while an exact one-ID request worked; later Z/M-preserving 100/500-ID requests completed. The capture adapts only after an actual transient failure.

## Publisher spatial-index candidates

The optional --stream-spatial-relation index uses the publisher's supported esriSpatialRelIndexIntersects relation. This queries the source spatial index and can return extra candidates. The original complete count, IDs and predicate are retained, and the original polygon-based selector determines final domain membership after native geometry capture. The default remains intersects; envelope is also available when supported by the original metadata.

This option follows an actual source result: the repeatedly failing tile completed with 4,616 index candidates and a matching native count; that inventory contained all 1,364 IDs from the completed exact-intersection subtile. Preserve these as original candidate responses. Different query relations have different request hashes and inventory-progress scope, so they do not silently reuse one another's selection.

Official relation definition: https://developers.arcgis.com/enterprise-sdk/api-reference/net/esriSpatialRelEnum/
Original layer metadata: https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/3?f=pjson
