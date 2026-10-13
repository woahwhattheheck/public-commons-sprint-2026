# Current WBD context in existing Station Geography studies

The complete 184 original point/polygon records join the existing nine observation-station studies as station source context. Import `observations/wbd_station_join_20261013/station-context.sources.json` into the same Workspace, then use its ordinary prepared studies and saved geography editions. No station is added to or removed from a study.

Each context row retains every original column from the dated official WBD polygon-matches table. Three additional columns supply the study station identity, the original table SHA-256 and one-based data-row identity, and the context kind. Original USGS identifiers keep their USGS- prefix. An original permitted outfall such as SC0042994:001 joins the existing SC0042994 station; entity_id, point_id, outfall identity, original coordinate variant and native coordinates remain separate original fields.

The 184 records describe 175 distinct station identities. Multiple original coordinate representations remain separate rows under the same station. Source-coordinate context is not a replacement for the selected station geometry. In particular, the added 13-gauge NLDI selection retains the original NWIS-coordinate WBD context as such; the current saved selection's own point/polygon membership is still calculated independently from its selected coordinates.

The existing source_references surface retains each complete context row in analysis.json, station GeoJSON and station CSV; the portable geography archive carries the complete original source closure. The observed-study receiving comparison includes each original context row and row identity while allowing only collection-address rebinding.

All five lake-study sites remain selected. SV-840 has current_huc12=030601010803 and source_study_huc10=0306010106; these fields retain different meanings. The other four lake locations have current_huc12=030601010602. The seven added flow gauges outside the retained 217-HUC identity set keep their original cohort membership and explicit membership fields. Original inventory HUCs, assessment HUCs and dated agency comparisons remain unchanged.

## Receiving

From the current complete application, import the ordinary station-context manifest alongside the existing observation, calibration and regional manifests. The context is optional for older Workspaces: prepared studies remain usable and expose station_context_missing until this exact table is imported. With the source imported, station_context_table_count is one for each of the nine choices. The existing source-coordinate and observation selections stay editable.

Run the original source replay:

```
node observations/wbd_station_join_20261013/rebuild_station_context.mjs --check
```

The replay verifies the original polygon table and all its original companions, regenerates all 184 records, and compares exact output bytes. It adds zero measurement rows.

Expected context rows in the unchanged nine cohorts are 67, 17, 6, 19, 19, 13, 13, 29 and 30, respectively. Their station counts remain 67, 17, 5, 10, 10, 13, 13, 29 and 30. The lake cohort has six source-context rows because an assessment location and study location are both retained for one station; agency/network cohorts retain all three explicit outfall coordinate variants.


## Exact selected-coordinate interpretation

Each saved station exports wbd_context_status, selected_current_huc12s, selected_wbd_point_ids and the complete wbd_source_context. The selected-match rule requires identical native EPSG, x and y values; it does not round or reproject one source to another datum. Each record retains point_id and coordinate_variant. A matching original point-source SHA is recorded separately when available. Records for other native coordinates stay explicit alternatives.

The original source-coordinate comparison was executed for all nine recipes. Exact selected-match station counts are 67, 17, 5, 10, 10, 13, 0, 29 and 30. The 13 NLDI selections preserve their 13 original NWIS-coordinate WBD records as alternatives. Their selected points still use the existing independent retained-domain point/polygon calculation. All four agency outfalls select original_state; all four network outfalls select nldi_indexed. The printable station report lists all alternatives and the exact selected relation.

The author installer verifies and retains the complete 204-file original WBD component plus the new context source and replay. It composes six exact maintained Station Geography hooks and preserves unrelated changes. The portable receiving check compares all original source rows and the selected-coordinate interpretation after collection-address rebinding.
