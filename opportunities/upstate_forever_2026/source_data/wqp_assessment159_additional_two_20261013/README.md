# Additional WQP locations for the 159-station assessment study

The original published 2024 and July 2026 assessment banks select 192 cause records at 159 distinct stations in the exact retained 217-HUC domain. Original SCDES Atlas STAT matching locates 152 stations; the existing eight-station WQP source locates five more. This separate source supplies RS-21038 and RS-22075 from their official WQP station pages.

## Import and select

Import `sources.json` through the existing Workspace source importer. Select source ID `scdes-wqp-assessment159-additional-two-20261013` as an additional monitoring-station source with `station_id_field=MonitoringLocationName`, `id_field=MonitoringLocationIdentifier` and `source_crs=EPSG:4326`. Keep the existing 705-feature Atlas and WQP8 source references beside it.

The two point coordinates copy the original longitude/latitude strings reported on the official pages. Both source pages explicitly report WGS84. The GeoJSON preserves every metadata value shown in each page table as a string; the retained extraction companion preserves the retrieved page text and exact primary URLs. The source representation is a derivation from official station-page metadata.

`assessment159_native_identity_crosswalk.csv` records all 159 station/source/native-ID matches in each source's native CRS. Its station publisher HUCs and assessment HUCs stay separate. Original assessment record IDs remain edition-specific. This identity crosswalk is an input to the maintained native point-in-polygon workflow; the workflow computes actual geometric memberships from the retained polygons.

Published 2024 uses imported normalized body SHA 69e6894001fdcfa0130d8be532a31655eda22486a4044079665e8ee614eb5b0c and publisher table-text identity SHA 9be7679b79ca2a8a4d4d21227ad57371b88fd6082e8b29c7efc6d9a18ab0edce. July 2026 uses imported normalized body SHA cceaf00eb0fc4cc85eabb67fbd2a9b5d843bb0cc0c7ab8da54d2108f025c2522 and original PDF identity SHA c26a79441d22e8a4a302c9094640654c199c88ec6171875e00bf6cde4a0c0dd7. Keep source-record IDs and original JSON array pointers: all 813 statewide TMDL rows have source_row=1, and the 2024 source has multiple causes for some source rows.
