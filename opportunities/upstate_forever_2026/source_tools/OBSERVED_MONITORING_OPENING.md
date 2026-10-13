# Open the complete original observation cohort in Monitoring

The original regional campaign uses 87 assessment stations. Four of those stations also occur in the 36-station microbial source, accounting for 117 original observations. That campaign keeps its own station IDs, design and future calendar.

This preparation opens the entire original microbial station cohort as a separate native Monitoring network. It reuses the completed Station geography selection, including the two retained native coordinate sources: 34 WGS84 points in EPSG:4326 and two NAD83 points in EPSG:4269. It carries all 730 observations, their source fields and sample dates into a saved observed context. The original USGS-02177000 gauge can therefore display its own 2022 daily-flow and episode context through the existing station-specific flow rules.

## Run the existing 36-station receiving course

Use the current complete application and the same scientific Workspace in which the original microbial geographic study completed. From that application directory:

~~~bash
python -B source_tools/prepare_observed_monitoring.py \
  --workspace /absolute/path/to/workspace \
  --geography-id 3bf6c45056785bedd914d0dc6dd201cbd9cc8222431e4ba7dbf1a7a99b0144a7 \
  --output /absolute/path/to/microbial-monitoring-opening
~~~

The actual saved geography ID above is the completed original 36-station, 730-observation course on the regional receiving Workspace. Choose the appropriate saved geography ID when using a different retained project. The program reads the existing native selection through station_geography.inspect with verification. It does not invoke a new geography build.

The default observed source is the full edition in microbial_monitoring_context.sources.json. Its manifest and complete original companions must be present in the application. If that source is already imported, add --observed-collection followed by its actual retained collection ID. An alternative complete source manifest can be selected with --observed-manifest. The default named entry is utility-microbial-monitoring-observed-context-20261013.

The program resolves the native coordinate source collection and the original watershed edition from the saved geography selection. Both coordinate sources retain MonitoringLocationIdentifier, so every observation joins by its exact WQP station ID. It reads the unique native HUC12 and ToHUC field names with their original case. This convenience route is for the original unambiguous vector-source edition. A geography selection with CSV coordinate tables, a nondefault layer or an explicit per-station geometry choice needs a matching native vector source and an explicit selection file. A source with different field names likewise needs an explicit selection.

## What it creates

The course performs these connected operations:

1. Reads and verifies the selected observed source and all retained companions.
2. Reads each original coordinate group with the maintained Fiona/pyproj reader, producing its WGS84 planning view while preserving all original station attributes, native coordinate strings and datum declarations.
3. Selects every station ID in the observed source. Any additional native source features are recorded separately; duplicate or missing source identities must be resolved before preparation continues.
4. Saves a derived station source whose complete companions include the original station editions and a per-feature lineage index.
5. Uses the maintained Monitoring network builder to retain original catchment topology, geodesic areas, point membership and any boundary ambiguity.
6. Saves the complete observed context through the existing Monitoring service. Exact station matching binds all original activities and observations. The source's same-station flow scope remains authoritative.
7. Produces the existing observed-context report and ZIP, then exports a selected editable study containing the context, network and complete source dependencies.
8. Restores that archive into a separate receiving directory and reopens the original saved network and observed context.

This is an original observed network. Its historical activities remain historical observations. Future dates, costs, crew assignments and intervention choices are supplied later through the ordinary Monitoring design and campaign controls.

## Open and inspect the result

operation.json contains the actual network_id, context_id, original project/selection identity, source collection, summary, exported study and restored location. The exact context is also saved as observed-context.json for inspection.

Open the same scientific Workspace in the application, choose the saved network in Monitoring, then select its saved Observed support context. Its existing observation browser provides station/status/comment filters and full original row details. Annual, station-year and monthly coverage remain the original full-source tables; matched counts show the complete selected cohort.

For this original source, the expected matched totals are 36 stations, 730 activities and 730 observations. The separate USGS flow scope contains one station and the original 2022 daily series. Flow episode activity counts use Sample-Routine observations. All original censoring and comments remain attached to their original records.

The network retains any source-derived station assignment issue. Such a point remains in the observation view with its original identity; the normal Monitoring design rules determine whether a future design can use an unresolved station. The preparation never substitutes a watershed label for the native polygon relationship.

## Generic explicit selection

The same preparation accepts --selection with a JSON document:

~~~json
{
  "schema": "upstate.observed-monitoring-selection/v1",
  "title": "Original observed station network",
  "domain": {
    "collection_id": "ACTUAL_RETAINED_DOMAIN_COLLECTION",
    "source_id": "ACTUAL_DOMAIN_ENTRY",
    "id_field": "huc12",
    "downstream_field": "tohuc"
  },
  "observations": {
    "collection_id": "ACTUAL_RETAINED_OBSERVED_COLLECTION",
    "source_id": "ACTUAL_OBSERVED_DOCUMENT"
  },
  "station_sources": [
    {
      "collection_id": "ACTUAL_NATIVE_COORDINATE_COLLECTION",
      "source_id": "utility-ecoli-native-wgs84",
      "station_id_field": "MonitoringLocationIdentifier"
    },
    {
      "collection_id": "ACTUAL_NATIVE_COORDINATE_COLLECTION",
      "source_id": "utility-ecoli-native-nad83",
      "station_id_field": "MonitoringLocationIdentifier"
    }
  ],
  "expected_domain_count": 217
}
~~~

Replace the illustrative collection placeholders with actual retained IDs; the program never searches by a partial label or guesses an account/project. A separate exact source cohort can use its own IDs and original native field names. The optional expected_domain_count verifies the supplied count. The known Upper Savannah source entry also retains its existing decoded-hash check.

All station properties are preserved. Two explicit planning properties, observed_station_id and observed_source_feature, supply the matched identity and native feature lineage; a conflicting original field is rejected. No fuzzy name/coordinate matching is applied.

## Resume and receiving outputs

Repeat the same command and output directory after an interruption. request.json binds the original project, Workspace and complete selection. operation.json checkpoints the station source, saved network, observed context, context ZIP and selected-study archive. Existing artifact bodies are verified before reuse. The initial operation timestamp is retained so an interrupted save reconstructs the same immutable network identity.

Use --prepare-only to finish the network/context/report stage without exporting and restoring an editable study. Repeating the command without --prepare-only completes receiving in the same operation.

Output layout:

~~~text
request.json
operation.json
observed-context.json
station-edition/
  stations-wgs84.geojson
  lineage.json
  sources.json
  originals/<original-collection-id>/...
exports/<retained-context-export>/monitoring-observed-context.zip
observed-monitoring-study.zip
received/
  application/
  workspace/
~~~

The maintained selected-study exporter selects monitoring_observed_contexts with include_related_results false. Its existing typed dependency closure carries the exact network and retained sources into the normal application/Workspace archive. The restored network and context must match the originals. An existing receiving directory continues through the maintained portable.resume_restore API, pinned to the retained study archive SHA256. That API validates the original archive, project and destination, recognizes the native delivery-state registration made by a successful restore, and recovers the complete receiving result after an interrupted final write. Historical successful restores use its compatible original-member check. The opening then independently verifies the original observed context and saved network against the received records. operation.json retains the full original receiving result and its archive identity.

The component fragment extends the maintained Monitoring family with this preparation and guide, and includes the original regional source-retention helper. Existing regional designs, campaigns and saved study editions continue to use their original records.

Use the current complete application when resuming a previously received study: model/portable.py must provide its maintained resume_restore API. Preserve the same original output directory, request, archive and received Workspace. The receiving helper never restores over existing work. After the native result returns, open the exact populated Monitoring network/context in the original operator, inspect desktop and narrow screenshots, exercise observations, downloads and saved-study reopening, and inspect every actual outgoing attachment before delivery.
