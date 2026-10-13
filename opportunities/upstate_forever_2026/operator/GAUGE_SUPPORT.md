# Regional gauge and catchment support

Gauge support joins original USGS daily-flow gauges and NLDI upstream whole catchments to a saved regional watershed report. It uses the maintained station-geography engine for original coordinate handling, exact station identities, candidate selection and native polygon membership. The new consumer measures catchment intersections, retains original daily-flow coverage and presents a source-preserving report through the existing operator.

## Open the product

Use the complete maintained application, including the current shared extension host, regional watershed and station-geography families. Restart the existing operator after adding this component; its descriptor registers **Gauge support** after **Station geography**. For an existing application, run `python -B operator/install_gauge_support.py --application "$APPLICATION" --source-root "$COMPONENT_ROOT" --apply`. Omit --apply to inspect the complete installation plan. A fresh complete public checkout already contains the descriptor; no shared host code is replaced.

1. Open the intended existing Workspace.
2. Receive the original regional edition and select its saved watershed report.
3. Import the maintained NLDI source manifest and prepared daily-flow coverage manifest, or run the source intake below.
4. Open **Gauge support**. Choose the saved report, original HUC12 polygon source and native HUC ID field, original gauge points or an existing station edition, whole catchment source and daily-flow coverage table.
5. Select the reporting HUC12s. Multiple utility polygon sources are optional; each remains a separate scope with its own native identifier field.
6. Build and retain the report. The original operator queue holds the selection, task and result.
7. Open a saved result, select a gauge and examine its original basin, point HUC membership, regional HUC intersections and annual coverage.
8. Download the readable HTML report, full CSVs, GeoJSONs, source archive and original station-geography ZIP. Use the existing Workspace backup/restore to reopen the entire linked project.

The browser keeps a submitted operation ID with its exact selection; retrying the same pending selection reuses the original queue operation. Saved results and drafts are scoped to the actual Workspace.

## Source scope

The completed source package is merged in [PR3089](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3089), merge bc3f465556801b5254dea6d3c8696f06e1e27e4a. Its native manifest is:

    source/hydrology-huc05-07-20261013/nldi/model-sources.json

The three original entries are:

| Entry | Role | Identity |
| --- | --- | --- |
| nldi-daily-flow-gauge-locations-20261013 | Original gauge points | station_id = USGS- plus original site_no |
| nldi-daily-flow-whole-catchments-20261013 | Original NHDPlusV2 upstream whole catchments | basin_id; source station_id and ts_id retained |
| nldi-daily-flow-station-basin-bindings-20261013 | Exact station/series/source bindings | station_id |

Each entry retains the complete original source closure: original linked-data feature responses, original catchment bodies, source request URIs, metadata, derived views and companion hashes. All thirteen catchment requests use **simplified=false** and **splitCatchment=false**. The supplied whole catchment can extend downstream of the gauge point. A source gauge may also lie outside its own supplied original polygon: the product explicitly records interior, boundary, outside or unresolved rather than snapping the point or changing the polygon. Original source measure and all catchment attributes remain visible. Preserve this source interpretation in comparisons.

The original daily-flow source family is merged in PR3038:

    source/hydrology-huc05-07-20261013/

It retains eight original inputs: station inventory, series catalogue and six annual daily responses. Its unchanged derived coverage JSON is a top-level array of thirteen station objects. Each contains exact site_no, ts_id and six calendar-year rows. The new preparation command registers that existing array as a table with all thirteen other original source-family files as companions.

The coverage registration is complementary to the original daily observed-water importer. Original flow values, units, qualifiers and methods remain owned by that existing intake.

## One-command native receiving

Run from the current application with the actual equipped interpreter. Use an existing Workspace that already contains the completed original regional report. The HUC manifest must contain the actual original polygon source; its report/context JSON does not contain polygon geometry.

~~~bash
"$PYTHON" -B -m source_tools.receive_gauge_support \
  --workspace "$WORKSPACE" \
  --report-id "$REGIONAL_REPORT_ID" \
  --huc-manifest "$ORIGINAL_DOMAIN_MANIFEST" \
  --huc-source-id upstate-wbd-upstream-domain-20261012 \
  --huc-id-field huc12 \
  --output "$GAUGE_RECEIVING_OUTPUT"
~~~

Alternatively select an already imported original HUC source:

~~~bash
"$PYTHON" -B -m source_tools.receive_gauge_support \
  --workspace "$WORKSPACE" \
  --report-id "$REGIONAL_REPORT_ID" \
  --huc-collection "$ORIGINAL_DOMAIN_COLLECTION_ID" \
  --huc-source-id "$ORIGINAL_DOMAIN_SOURCE_ID" \
  --huc-id-field "$ORIGINAL_HUC_FIELD" \
  --output "$GAUGE_RECEIVING_OUTPUT"
~~~

Use a receiving output directory outside the application and Workspace. The command preserves the complete original daily14 family, verifies the eight original response hashes, registers unchanged coverage, imports the original NLDI collection, binds the original HUC polygons and saves the exact selection. It builds the support report, backs up the same Workspace, restores it into an independent directory and reopens its linked support, original station and regional report identities.

Add repeated --reporting-huc12 arguments for an explicit reporting subset. Omitting them uses the saved regional report's explicit selection, or all original report HUC12s when no subset is selected. An optional --utility-selection file holds a JSON array of actual original Workspace polygon references, each with collection_id, source_id, source_sha256 and id_field.

Add --prepare-only to complete source retention and write the selection before starting geometry computation. Repeating the command without that flag continues the same prepared source operation.

The receiving output includes:

- receiving-gauge-support.json: actual interpreter, host, process, source collections, completed phase IDs and exceptions.
- daily-coverage-source/: the complete unchanged daily14 source family plus its new model-sources.json.
- gauge-support-selection.json: the original source and saved report references.
- gauge-support-workspace-EDITION.zip: the complete portable Workspace.
- reopened-EDITION/workspace/: the independently reopened project.

The command checks that project, support build, station edition, source bytes and original regional report survive restore. It reuses the original portable engine.

## Direct CLI

~~~bash
"$PYTHON" -B -m model.gauge_support --workspace "$WORKSPACE" catalog
"$PYTHON" -B -m model.gauge_support --workspace "$WORKSPACE" build "$SELECTION_JSON"
"$PYTHON" -B -m model.gauge_support --workspace "$WORKSPACE" inspect "$GAUGE_SUPPORT_ID" --complete --verify
"$PYTHON" -B -m model.gauge_support --workspace "$WORKSPACE" verify
~~~

A selection binds actual source identities:

~~~json
{
  "title": "Regional original gauge support",
  "report_id": "actual saved watershed report ID",
  "reporting_huc12s": ["actual selected HUC12"],
  "huc_sources": [{
    "collection_id": "actual original domain collection ID",
    "source_id": "actual original domain source ID",
    "source_sha256": "actual retained source body SHA256",
    "id_field": "actual native HUC12 field"
  }],
  "point_source": {
    "collection_id": "actual NLDI collection ID",
    "source_id": "nldi-daily-flow-gauge-locations-20261013",
    "station_id_field": "station_id"
  },
  "catchment_source": {
    "collection_id": "same actual NLDI collection ID",
    "source_id": "nldi-daily-flow-whole-catchments-20261013"
  },
  "coverage_source": {
    "collection_id": "actual prepared coverage collection ID",
    "source_id": "usgs-huc05-07-daily-flow-coverage-20261013"
  },
  "utility_sources": []
}
~~~

The illustrative strings are replaced by actual catalogue IDs or the preparation command. A saved station_edition_id can replace point_source. Existing station candidate choices remain available as station_choices when building from an original point source.

## Scientific interpretation

### Three distinct geographic scopes

The full upstream/model region is the exact HUC12 membership of the saved regional report. Every HUC12 must have its original valid polygon. The reporting area is an explicit subset of that membership. Utility areas are separately selected original polygon sources. Their intersections are calculated separately and are retained even when they overlap each other. Source-qualified scope identities retain the original native IDs, so separate utilities can use the same native ID without colliding.

Original station geography resolves points against native polygons with the original coordinate system and covers/interior/boundary semantics. Missing or ambiguous stations retain those states; a catchment can still be measured without fabricating a resolved gauge coordinate. Catchment rows and calendar coverage join on exact original site_no and ts_id.

### Areas and overlapping support

Original polygons are transformed to **EPSG:5070, NAD83 / Conus Albers**, using always_xy. All reported areas are square metres, with interface conversions to square kilometres. Native source vertices, ring ordering, CRS and identities remain in source archives. No buffer, simplification or polygon repair changes source geometry.

For each gauge, retain the original whole-catchment area, its regional intersection, part outside the region, selected reporting intersection, every intersected HUC12 and any utility area. Each HUC relationship reports both the fraction of the catchment and the fraction of the HUC. Boundary-only contact has zero area and remains explicitly labeled.

Regional scope summaries use the **geometric union** of catchments. Nested catchments therefore do not double-count regional area. The catchment-relationships CSV retains pairwise equality, containment, overlap and boundary contact. Network upstream/downstream relations come from the saved regional ToHUC report and are separately recorded in the HUC intersection table.

The map displays the original shapes in locally scaled longitude/latitude for inspection. It does not supply area values; the EPSG:5070 calculations do.

### Original calendar and qualifiers

For 2020–2025 the exact denominators are 366, 365, 365, 365, 366 and 365 days, totalling 2,192. Complete numeric coverage is the sum of original numeric days over these same calendars. It does not certify uniform measurement quality.

Approved, estimated and provisional flags are retained as separate original counts and may overlap. Original qualifier distributions, missing-date ranges and nonnumeric-date ranges remain in JSON and the selected station's source details. Original means are observed-numeric-day statistics; missing days are never filled.

These source support summaries accompany the existing model calibration/annual-load workflow. They do not convert a daily flow series into sediment or nutrient measurements.

## Saved outputs and portable source

The Workspace stores gauge-support editions and files under gauge-support/BUILD_ID/. Immutable analysis identity binds the version, exact selection, saved regional report hash, original station build and every source body hash.

Outputs include analysis.json; gauges, HUC intersections, annual coverage, utility intersections, scope union and catchment-relationship CSVs; original-shape GeoJSONs; the retained regional report; printable HTML; original station-geography ZIP; and gauge-support.zip with all source bodies/companions. The support ZIP is a complete report/source handoff. Use the existing full Workspace portable backup to reopen all linked source collections and report editions directly.

The shared extension registers a Workspace verification callback. It checks saved outputs, every original source, the linked original station edition and the exact saved regional report. The component uses existing original-data readers, source retention, task queue, verified download tickets, extension host and portable engine.


## Use a saved edition in the scientific or client report

Open a saved Gauge support edition and choose **Use in scientific report**. The existing operator queue prepares a report source from that exact saved edition, imports it into the same Workspace and offers **Open prepared report form**. The current scientific/client delivery form then uses the registered source. A completed source action remains available under Saved operations after reconnect.

Choose **New report selection** to start with this gauge context. Choose an existing saved delivery to retain its original model runs, alternatives, map settings, overlays, contact fields and previously selected original studies; the gauge context is appended to the ordered report-source selection. The new report uses the existing native baseline/alternative requirements and report assembly path.

The report source contains typed sections for gauge/series identities, original point membership, whole-catchment support, annual flow coverage, reporting/upstream/utility scopes, individual HUC intersections and overlapping catchment relationships. It retains the complete original package closure, including native source manifests and companions, all saved analysis/CSV/GeoJSON outputs, the original regional report, station-geography ZIP and gauge-support ZIP.

A self-contained map HTML and individual SVG maps use the saved catchment/HUC/gauge output geometries and the same local longitude/latitude display scale as the existing desk. Reporting HUC12s have grey fill, upstream context has white fill, whole catchments have a dark outline and gauges are points. All numeric areas continue to come from the original EPSG:5070 results. Map links and source attachments travel in the normal scientific/client HTML, PDF data package and delivery archive. The typed tables are rendered through the shared report engine.

### Native source preparation and import

From the current complete application:

~~~sh
"$PYTHON" -B -m model.gauge_support --workspace "$WORKSPACE" catalog
"$PYTHON" -B -m model.gauge_support --workspace "$WORKSPACE" inspect "$GAUGE_EDITION_ID" --complete --verify
"$PYTHON" -B -m model.gauge_report_context \
  --workspace "$WORKSPACE" \
  --edition-id "$GAUGE_EDITION_ID"
~~~

The last command verifies the selected saved result and its original package, writes the complete report source and imports it through `Workspace.import_sources`. Its JSON returns the exact `source`, `observed_context_binding`, `delivery_selection`, original edition/report IDs and verified files.

Append `--delivery-id "$SAVED_DELIVERY_ID"` to start from a specific retained delivery selection. The returned `delivery_selection` preserves the complete existing selection and appends the newly registered source. It removes the previous observed-source binding so the normal delivery builder binds the current ordered sources.

Use `--prepare-only` when preparing files without source import. The returned `manifest.path` is relative to the actual Workspace root and can be imported through the ordinary source-import action:

~~~sh
"$PYTHON" -B -m model.cli --workspace "$WORKSPACE" source-import "$WORKSPACE/$MANIFEST_PATH"
~~~

The module also exposes `prepare(workspace, edition_id, import_source=True, delivery_id=None)`. The shared operator action is `gauge.support.report` with payload `{edition_id, delivery_id?}`. It runs on the existing task queue and verified download transport.

### Retention and reopen

Each report source is stored below `gauge-support/BUILD_ID/report-context/OPERATION_ID/`. Its identity includes the producer version, Workspace/edition/build identities and exact hashes of the original package closure. Repeating preparation of the same source reuses identical retained files; a changed original fails verification.

The native manifest is `gauge-report.sources.json`. Its single document source is `gauge-report.json`, using the maintained `upstate.observed-report/v1` recipe contract and `metadata.report_schema`. Every original package member and every map is listed with its exact bytes and SHA256 as a companion. The recipe records all input descriptors, so the delivery source binding verifies the complete selected edition before report assembly.

The existing full Workspace backup retains the saved gauge edition, linked regional and station editions, registered source objects, queued operation, prepared report package and completed deliveries. Restore that same Workspace and reopen the source/delivery IDs returned by the original operation. The original Gauge support ZIP remains the report/source package for recipients who need the original analysis and all its inputs.

Receiving continuation remains the original regional operation 1791859874 and source handoff 1791866330. After the original gauge build completes, run this report source action in that same Workspace, open the existing scientific/client report form, generate the normal report/data/archive, then restore the completed Workspace and reopen those same IDs. Return the actual source collection/document identity and resulting report/archive paths to the original operation.

## Component files

- model/gauge_support.py
- model/gauge_report_context.py
- source_tools/receive_gauge_support.py
- operator/gauge_support.py
- operator/extensions/gauge-support.json
- operator/web/gauge_support.mjs
- operator/web/gauge_support.css
- operator/install_gauge_support.py
- operator/GAUGE_SUPPORT.md

Existing station geography, original JSON inventory intake, original daily observed-water importer and regional source-family ownership remain on their maintained implementations. Install the complete current application before applying this component.

