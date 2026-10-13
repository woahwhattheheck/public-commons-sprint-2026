# Original gauge-split source capture

This continues [source operation 1791864959](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791864959123639). The original thirteen whole-catchment responses remain in the merged NLDI source family. This producer requests the seven gauges with complete numeric daily discharge for 2020–2025 and retains every original HTTP request, status, response body and any returned USGS job identity.

## Original source selection

The fixed request plan binds these original site/series identities to their unchanged NLDI feature bodies and COMID, reachcode, measure and WGS84 coordinates:

| Station | Daily-series ID | COMID | Original measure |
|---|---:|---:|---:|
| USGS-02193340 | 34493 | 6289497 | 31.4872 |
| USGS-02193500 | 324274 | 6289757 | 88.313 |
| USGS-02195320 | 324277 | 22720339 | 5.8999 |
| USGS-02196000 | 126801 | 11730030 | 88.347 |
| USGS-02197000 | 126852 | 22724061 | 1.4036 |
| USGS-02197020 | 34530 | 22725411 | 79.2738 |
| USGS-02197500 | 127079 | 22726585 | 83.8922 |

Original NLDI source directory: source/hydrology-huc05-07-20261013/nldi, merged PR3089. The producer validates its exact model-sources manifest, station/basin bindings and all original/derived companions, then retains the entire 34-file family below retained-whole-source in the native capture directory. No source coordinates, polygon rings or whole-catchment responses are modified.

The six-file capture component includes the executable producer, original seven-station request plan, original 6,822-byte process description, original 46,209-byte OpenAPI document, capture metadata and this guide. Public USGS contract URLs:

- https://api.water.usgs.gov/nldi/pygeoapi/processes/nldi-splitcatchment?f=json
- https://api.water.usgs.gov/nldi/pygeoapi/openapi?f=json
- https://api.water.usgs.gov/docs/nldi/basin/
- https://api.water.usgs.gov/docs/nldi-pygeoapi/splitcatchment/

The process description advertises sync-execute and async-execute. The captured execution OpenAPI currently declares only Prefer: respond-sync. The native producer uses that explicit preference and the publisher's original inputs-array example: four text/plain values for lat, lon, upstream="True" and simplified="False". Any actual 201/202 Location or jobID is retained and continued through the original /jobs/{id} and /results endpoints.

## Execute the existing operation

Use the accepting host's current equipped interpreter and application checkout. Python standard library is sufficient for capture and original-geometry materialization.

From the current application root:

    "$PYTHON" -B -m source_tools.capture_nldi_split \
      --output "$NLDI_SPLIT_OUTPUT" \
      --route process \
      --timeout 600 \
      --wait-seconds 600

This processes all seven requests sequentially, printing each actual response status and saved response path as it finishes. The output is a persistent directory outside the original source directories. It has its own exclusive file lock so two workers cannot repeat the same native capture concurrently.

Default original source and contract directories resolve from the application root. Supply --source-root and --contract-root only when the same original directories were received elsewhere. These flags select directories whose bytes still have to match the retained request plan.

The alternative original indexed-gauge route is:

    "$PYTHON" -B -m source_tools.capture_nldi_split \
      --output "$NLDI_INDEXED_SPLIT_OUTPUT" \
      --route basin \
      --timeout 600 \
      --wait-seconds 600

For that route, each exact GET is:

    https://api.water.usgs.gov/nldi/linked-data/nwissite/USGS-SITE/basin?simplified=false&splitCatchment=true&f=json

Use a separate output directory for the alternate source method. The capture selection includes the route and original plan hash; resuming cannot silently change them. An optional repeated --station USGS-02193340 selects existing plan members for immediate execution while retaining the complete seven-station plan. It creates no second model or task queue.

## Resume original work

Run the same command with the same output directory. Completed station bodies are reused, and actual pending USGS jobs are polled. The producer saves its active HTTP selection before dispatch and an immutable response journal before updating aggregate progress. It recovers a complete interrupted response journal automatically. Existing job URLs survive interrupted polling.

A connection failure during a POST can leave the provider outcome unknown. The original request remains in capture.json as submission_uncertain, along with its attempted body and response/error journal. A later invocation does not silently send that request again. If the accepting native worker has recovered the actual USGS job URL, attach it to that same station:

    "$PYTHON" -B -m source_tools.capture_nldi_split \
      --output "$NLDI_SPLIT_OUTPUT" --route process \
      --job 'USGS-02193340=https://api.water.usgs.gov/nldi/pygeoapi/jobs/ACTUAL_JOB_ID' \
      --station USGS-02193340

The producer validates that the URL belongs to the original USGS NLDI job namespace. When an original attempt is known to have ended and a repeat is appropriate, --retry-station USGS-02193340 records a new response sequence for that same source operation. It preserves all prior failed/uncertain request bodies. No automatic POST retry can create hidden duplicate geoprocessing jobs.

The original transport timeout defaults to 600 seconds per request. --wait-seconds controls subsequent polling time and --poll-seconds controls the interval between status requests. A pending job remains saved when the polling window ends, so the next invocation resumes it. Successful full capture exits 0; an incomplete seven-station capture exits 2 with actual per-station states in receiving-result.json.

## Retained outputs

- contract/: exact original request plan, publisher process description, publisher OpenAPI and capture metadata.
- retained-whole-source/: the complete unchanged prior NLDI source family.
- responses/USGS-SITE/NNNNN-STAGE/request.json: actual method, URL, headers, request body, timeout and start time.
- The matching body.json, response.json and optional wire.bin retain actual status, response URL, headers, full original bytes and hashes, including publisher errors.
- capture.json: actual runtime host/interpreter/PID, selection, per-station state, response journal and original job URL.
- results/SITE.geometry.json: the explicit original named basin geometry. Polygon coordinate arrays are unchanged.
- derived/split-basins.geojson and derived/station-basin-bindings.json: returned geometries with exact original station, series, request, COMID and source references.
- source-summary.json and receiving-result.json: actual completed count, method and saved native source-manifest location.
- editions/HASH/model-sources.json: an immutable upstate.sources/v1 source snapshot, created only when at least one actual returned basin is available. Its complete companion closure includes original documents, prior whole-source family, HTTP requests/responses and the exact capture state for that completed set.

A later successful station adds a new immutable completed-set edition. Earlier source collections can continue to use their original bytes and manifests.

## Scientific identities and receiving

The indexed basin route is labeled nhdplusv2_upstream_gauge_split. The process route is labeled nhdplusv2_coordinate_delineated_upstream because the publisher delineates from the original NLDI coordinate. This preserves the exact method used to obtain each geometry. Original whole-catchment support remains nhdplusv2_upstream_whole_catchments.

The process route accepts the explicit drainageBasin output. It does not substitute the local catchment, infer a union or repair geometry when a response shape differs. The original response remains available for the source owner to extend the exact output binding. Empty/invalid geometry and publisher failures remain visible per-station states.

Import the completed source edition with the existing Workspace source API:

    "$PYTHON" -B -m model.cli --workspace "$WORKSPACE" \
      source-import "$ACTUAL_RETURNED_SOURCE_MANIFEST"

Use the actual manifest path returned by the native command. The entry ID is nldi-seven-gauge-split-process-20261013 or nldi-seven-gauge-split-basin-20261013, with role gauge-upstream-split-catchment-support and id_field basin_id. The manifest declares its method and original source support. Partial seven-station completion is explicit in source-summary.json.

The merged Gauge support desk's current whole-catchment edition remains tied to its original source choice. Existing annual estimator/calibration owners can select the new actual upstream support when its original source identity, station relationship and period are appropriate. Original model-domain polygons, observation vintages, flow qualifiers and reported daily values retain their existing identities.

Return the first actual status/body path, native host/interpreter, saved USGS job URL if present and receiving-result.json to source operation1791864959. Continue original station7436/regional9874 and annual-source intake through their existing owners.
