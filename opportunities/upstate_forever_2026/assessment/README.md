# Upper Savannah assessment and model interpretation

Operation: ECOSYSTEM-SCIENCES-ASSESSMENT-20261013  
Prepared: 2026-10-13

This package supplies the existing Upper Savannah application with current, pollutant-specific assessment records and original monitoring locations. It joins the four RFP focus watersheds to the broader connected model domain and identifies a directly relevant nitrogen/phosphorus priority at the Eighteen Mile Creek arm of Lake Hartwell.

## Source editions and coverage

The [2026 draft Integrated Report](https://apps.des.sc.gov/PublicNotices/SearchAndDisplay/PDF/302110) contains the current draft listing and appendices. Its [public notice](https://apps.des.sc.gov/PublicNotices/SearchAndDisplay/Display/38165) runs through October 15, 2026. The updated assessment uses 2020-2024 data; previously listed conditions can carry forward when recent data are unavailable. Preserve the draft edition in map labels and exports.

The separately published [TMDL use-support table](https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/TMDLAttainmentStatus.pdf) is dated July 28, 2026. These two editions are represented independently so a station can have an approved bacteria TMDL, a dated recreation attainment result, and a different current listed cause.

The extracted candidate region is HUC8 03060101, 03060102 and 03060103. Join its 12-digit HUC strings to the original 217-HUC12 domain before reporting domain counts. Preserve the original 116 reporting intersections and 101 upstream ancestors, the separate Upper Savannah reporting mask, and the buffered model grid.

## Delivered records

- 101 listed site/use/cause rows across 87 monitoring sites, including the original station descriptions and source-row use/cause/priority values.
- 70 approved-TMDL coverage rows from the draft report.
- 68 dated TMDL use-support rows: 65 Not Supported and three Fully Supported for recreation/E. coli. The three are SV-206, SV-015 and SV-139; other uses and causes retain their own status.
- 10 waters-of-concern changes and three pollutant-specific delistings.
- Three Hartwell priority/context records and seven model interpretation profiles.
- Six original WQP monitoring locations in CSV and GeoJSON.
- Four published source-field differences, with original-report resolutions or original coordinates for spatial resolution.

All source pages are one-based physical PDF pages. SOURCES.json records original URLs, editions, extraction pages, dictionaries and counts. HUC identifiers must remain strings to preserve leading zeroes.

## Focus watersheds and model questions

| HUC12 | Station | Current draft concern | Application use |
|---|---|---|---|
| 030601010703 | RS-24163 | Recreation / E. coli, priority 3 | Catchment management context; retain bacteria observations separately |
| 030601010704 | RL-01020 | Aquatic life / pH, priority 3 | Nutrient-pressure context alongside dated pH direction and conditions |
| 030601020502 | SV-790 | Aquatic life / macroinvertebrates, priority 3 | Connected sediment and nutrient pressure screening |
| 030601020507 | SV-234 | Fish consumption / PCB, priority 3 | Upland sediment-management context with fish-tissue assessment |
| 030601010602 | SV-268 | Aquatic life / TN and TP, priority 1; turbidity, priority 3 | Direct annual nutrient-export scenario comparison; sediment-source context |

Priority 1 represents agency planning for 2026-2028, priority 2 for 2028-2030, and priority 3 after 2030. It is an assessment planning field. Keep all four RFP focus watersheds in the delivery.

At SV-268, the TN/TP listing, turbidity listing, pH protection context, lead water-of-concern record and legacy fecal-coliform TMDL are separate facts. The Appendix E pH standard-attained comment applies to pH. The annual nutrient profiles connect to NDR nitrogen and phosphorus export.

## Map and observation integration

Render verified station points from observed_monitoring_sites.geojson using longitude/latitude in WGS84. Keep the provider-qualified monitoring_location_id for original-data joins. Station metadata reports nutrient-record start/end years; a date range does not establish measurements in every year.

Use the HUC polygon label "Contains listed monitoring site." Retain the modeled contributing area as its own spatial relationship. A station's listed cause does not classify every location in its HUC polygon. The separate DES water-classification reach layer carries its own source attributes.

RS-06190 has published HUC12 values 030601030602 and 030601030502; SV-192 has 030601030513 and 030601030613. Both original points are supplied for a point-in-polygon join against the retained original HUC geometry. Preserve the published values in source_field_differences.csv and write a distinct derived spatial HUC field. The native observation owner already has the six-point join request in the project thread. SV-234 remains keyed to its published station/HUC relationship while its original fish-tissue coordinate source is recovered.

## Model units, comparison direction and use

The [InVEST 3.20 NDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) and [SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html) define the native outputs. Raw NDR rasters n_total_export and p_surface_export are kg/ha/year; raw SDR sed_export is metric tonnes/ha/year.

The retained application converts these raw rates once through model.rasters.rate_to_mass. Its workspace nitrogen_export, phosphorus_export and sediment_export rasters are already annual mass per pixel. Sum those workspace values directly over their retained support. A raw 30 m rate cell uses 0.09 ha exactly once; native watershed summaries are already annual mass.

The native comparison is alternative minus baseline. A display called "reduction" uses baseline minus alternative, the negative of that native difference. Retain the calculation direction in exports.

Compare modeled annual exports to source-calculated annual loads for the matching contributing area, period, parameter and units through model.observations. Use concentration, bacteria, pH, biological, fish-tissue and turbidity observations as their respective measured context. Reservoir comparisons need a named contributing area and explicit treatment of reservoir retention. SDR represents upland sheet/rill erosion; the sediment profile retains that physical scope.

## Assessment updates and source reconciliation

The agency removed affected pH readings from its Appalachia II office for August 1, 2022 through July 31, 2023 from the 2026 assessment and WQP. The supplied waters-of-concern table carries the resulting site-specific statuses, including six pH records now NOT IMPAIRED and SV-236 now IMPAIRED.

Original reports resolve two reference differences: [Cane/Little Cane report 017-05](https://des.sc.gov/sites/des/files/docs/HomeAndEnvironment/Docs/tmdl_cane2.pdf) is dated May 2005, supporting 2005 for SV-832; [Upper Savannah report 026-05](https://des.sc.gov/sites/des/files/docs/HomeAndEnvironment/Docs/tmdl_upsav_fc.pdf) is dated July 2005 and the July 2026 site table binds SV-735 to that report. Source values stay intact alongside the preferred references.

The draft coverage table adds RS-24122 and RS-24119 relative to the dated July table. Join by station, use, pollutant, source edition and assessment date; retain the legacy fecal-coliform marker on July E. coli attainment records.

## Installation

Materialize the complete capsule from its Slack Canvas into the existing Upper Savannah product root. The verified decoder writes the assessment/ files using the application's atomic writer. The GeoJSON, fact CSVs and model companion then join the existing assessment overlay, observation comparison and report/export paths. They require no replacement runner or new model source acquisition.
