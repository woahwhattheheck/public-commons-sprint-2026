# Original observations in Monitoring design

This component joins the existing Monitoring design workspace to retained stream observations, source network relations and historical daily-flow coverage. It uses the current native registry, task queue, immutable records and authenticated exports. A selected network, saved design or campaign revision remains unchanged.

## What the original Eighteenmile data establishes

The retained cohort contains four WQP stations, 589 original nutrient results, 153 station activities on 106 dates, and all 2,192 daily means at USGS 02186702 during 2020–2025. The original high-flow coverage package is the 20-file source cohort merged in PR3167.

Three additional unchanged USGS NLDI upstream-with-tributaries responses establish the indexed order of the selected reaches:

SV375 → SV245 → SV376 → USGS 02186702 → SV233.

For SV375, SV245 and SV376, each original navigation response's station identifier and COMID agrees with the independently retained coordinate hydrolocation. The final gauge–SV233 relation uses their exact shared ReachCode and original measures: gauge 53.4049 and SV233 17.172927977358476. The source linear reference runs from zero at the downstream end to 100 at the upstream end.

The three complete source URLs are:

- https://api.water.usgs.gov/nldi/linked-data/comid/11749145/navigation/UT/wqp?f=json&distance=100
- https://api.water.usgs.gov/nldi/linked-data/comid/11749687/navigation/UT/wqp?f=json&distance=100
- https://api.water.usgs.gov/nldi/linked-data/comid/11749243/navigation/UT/wqp?f=json&distance=100

All responses, their complete properties and original point geometry are retained. The source relation table has 20 ordered pairwise station/gauge relations. Transitive paths list every supporting original response and hydrolocation source. The point layer uses the original WQP station coordinates, retaining indexed reach identity as attributes.

NLDI describes catchment-indexed connectivity. The original unsimplified whole-reach basin remains separate from a precisely split gauge basin. Source points, linear references, travel time and intervening watershed contributions remain distinct.

## Paired chemistry interpretation

The source processor consumes the existing AE11 paired-station table unchanged. It adds network direction, upstream/downstream station IDs and the same interval expressed as downstream minus upstream. Reversing station order exchanges and negates interval endpoints and exchanges the open-end flags. It preserves all original source activity IDs, sample clocks, reported time zones, clock separation, censoring bounds, analytes and source gauge qualifiers.

Across the existing 23 shared dates for SV375 and SV376, phosphorus is higher at the downstream SV376 on 22 dates and unresolved by censoring on one. The 22 include an interval with lower endpoint zero but an open boundary. Reconstructed total nitrogen is lower downstream on 20 dates and higher on three. This is the existing paired source result expressed in original stream order. Same-date sampling is not a travel-time-aligned parcel comparison, and the context makes no source attribution or attenuation estimate.

The existing paired-analysis owner retains leave-one-date-out, year-cohort and high-flow-exclusion sensitivity. This component supplies the source network interpretation to that maintained study.

## Existing desk workflow

1. Import the ordinary application-root manifest, eighteenmile_monitoring_context.sources.json. It registers the observational document, original station point layer and source relation table. Each source carries its complete declared original and derived companion files.
2. Open Monitoring design and select its existing source-bound network. Original source station IDs match exactly. An explicit mapping is available when the network uses a different original identifier.
3. Optionally open a saved design or campaign. A campaign supplies its retained station bindings and exact revision identity.
4. Under Observed support for this network, select the imported source edition and preview.
5. Review the full station-match table, station coordinate differences, selected catchment association, original source topology, exact calendar date overlap, high-flow episodes and signed paired concentration intervals.
6. Save the context. The immutable record retains source, network, plan and campaign revision identities.
7. Download the complete context package or export the existing field package while this saved context and matching plan remain selected.

The original field-package and HTML actions include the selected context only when its exact plan and network match. Campaign exports also require the same original campaign revision. The existing complete Workspace export carries the immutable context and retained source objects through ordinary backup/restore.

Station mapping is explicit. A source activity identifier is never accepted as a station identifier. The module reports every unmatched source station and every native station without observations. A coordinate difference above 100 metres is an inspection flag; the reported distance is a spherical point-to-point diagnostic and does not move either source point.

## Calendar and event meaning

Calendar overlap uses the saved plan's unchanged absolute dates. It does not transplant a future programme into prior source years.

For each actual saved visit the record carries:

- Exact visit key, catchment search area and date.
- Original campaign station binding when present.
- Matching original source station and same-station/same-date activity IDs.
- Original daily mean, qualifiers, source record indices and annual-P95 membership when that date exists.
- An explicit outside-received-series state when no original day is available.

An unbound catchment remains an unbound search area even when a source station lies in it. Candidate stations in that area are listed separately. A planned date overlapping a high-flow episode is a calendar intersection; collected field-event history remains in the original campaign.

Whole-cohort year/month coverage and matched-station activity counts are labeled separately. The source has 65 annual-P95 episodes; 58 have no sampled day across the four-station cohort. A partial network may have fewer observed stations, and its own episode sample count is reported alongside the full source count.

Daily mean discharge is measured at USGS 02186702. It is regional date context for the four nutrient stations. It is not site-specific discharge for every point and is not multiplied by concentration to create annual mass.

## Public model API

Module: model.monitoring_observed_context.

- catalog(workspace): eligible retained document sources, exact station IDs and source-period counts.
- preview(workspace, **selection): reads original sources and current selected network/plan/campaign; returns a complete unsaved context.
- prepare(workspace, **selection): saves that result in monitoring_observed_contexts using the existing immutable store.
- inspect(workspace, context_id): verifies retained document/companions/manifest, original network sources, saved plan identity and exact historical campaign revision.
- list_saved(workspace): immutable context summaries.
- export_files(workspace, context_id, plan_id=None, network_id=None): exact context, CSV tables, human report and original source closure for the existing field package.
- export_context(workspace, context_id, export_root=None): complete original ZIP through the same authenticated queued export.
- verify_workspace(workspace): original object/relation verification on native receiving.

Selection keys:

    {
      "source_collection_id": "ACTUAL_IMPORTED_COLLECTION",
      "source_id": "eighteenmile-monitoring-observed-context-20261013",
      "network_id": "ACTUAL_SAVED_NETWORK",
      "plan_id": "ACTUAL_SAVED_PLAN",
      "station_mapping": {},
      "title": "Observed support for the selected monitoring plan"
    }

Choose plan_id or campaign_id. A network-only context is also supported. The actual returned native IDs come from the original Workspace; the source package supplies no fabricated IDs.

Queue writes are monitoring.context.prepare and monitoring.context.export. Existing GET /api/monitoring reads are context.catalog, context.list, context.get and context.preview. The established monitoring.export accepts optional context_id. The current 1.2.1 queued-export selection/completion record, expected campaign revision, workspace lock and task file decoration are preserved.

Source schema: upstate.monitoring-observed-source/v1.
Source role: monitoring_observed_context.
Saved result schema: upstate.monitoring_observed_contexts/v1 (the native Workspace collection schema).
Collection: monitoring_observed_contexts.

## Reproduce the source context

From the current complete application:

    node source/eighteenmile-stream-nutrients-20261013/monitoring-context/derive-monitoring-context.mjs

The processor checks every input's byte length and SHA-256 before writing its five derived outputs. It uses the exact original-network edition, the merged flow-coverage cohort and the maintained paired-study CSV. It adds three unchanged agency responses. The input manifest records those source identities.

To inspect in a native existing Workspace:

    python -B -m model.cli --workspace "$WORKSPACE" source-import eighteenmile_monitoring_context.sources.json
    python -B -m model.monitoring_observed_context --workspace "$WORKSPACE" catalog
    python -B -m model.monitoring_observed_context --workspace "$WORKSPACE" preview --selection "$SELECTION" --output "$PREVIEW"
    python -B -m model.monitoring_observed_context --workspace "$WORKSPACE" prepare --selection "$SELECTION" --output "$RECEIPT"

Use the actual retained network/plan/campaign and source collection IDs in the selection. Open that same context in Monitoring design, export the context and existing field package, then receive the ordinary complete Workspace and reopen the saved result.

## Complete source adoption

A full current checkout already includes the addon. For a maintained application with the shared extension registry, use:

    python -B integrations/monitoring/install_observed_context.py --application "$APPLICATION" --source "$SOURCE_ROOT" --preview
    python -B integrations/monitoring/install_observed_context.py --application "$APPLICATION" --source "$SOURCE_ROOT"

The installer checks every supplied body against the complete source manifest and every replacement against its current known predecessor. Existing 1.2.1 revisions/locks, export-intent records, source verification and workspace-scoped browser refresh remain composed. Original standalone archive members and their 1.2.0 manifest remain historical originals; runtime composition is recorded separately.

The source module parses original CSVs and resolves graph relations in the source-analysis runtime. Native preview/save/export requires the actual installed MonitoringWorkspace. Browser modules have been parsed in V8 and retain current shared-provider contracts. Actual native execution results belong to the receiving operation and its returned Workspace IDs.

## Primary method references

- USGS NLDI navigation: https://api.water.usgs.gov/docs/nldi/navigation/
- USGS NHD linear referencing: https://pubs.usgs.gov/fs/2012/3068/
- Original WQP station/result sources and complete source hashes: source/eighteenmile-stream-nutrients-20261013/source-manifest.json.
- Existing paired source: observations/eighteenmile_stream_nutrients_2020_2025/analysis/paired-station-contrasts.csv.
- Original flow coverage: source/eighteenmile-stream-nutrients-20261013/flow-analysis/input-manifest.json.
