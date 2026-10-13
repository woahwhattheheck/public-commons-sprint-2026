# Utility-focus E. coli observations, 2021–2025

This complete source edition connects original Water Quality Portal observations to the issuer's utility-focus upstream geography. It contains all 730 original results at 36 stations, the complete 63-field publisher records, source station points, watershed membership, source methods, a reproducible compiler, an offline map/record explorer and a directly importable scientific Workspace manifest.

## Source selections

| Utility context | Stations | Original results | Geographic selection |
| --- | ---: | ---: | --- |
| ARJWS · Six and Twenty | 5 | 142 | Original WGS84 station points inside the four original HUC12 polygons identified by the retained upstream topology |
| PRWD · Tugaloo / Choestoea | 31 | 588 | Original publisher HUC8 `03060102`, matching the complete retained 32-HUC upstream union |

The ARJWS four-HUC selection comprises Upper and Lower Three and Twenty Creek plus Upper and Lower Six and Twenty Creek. Exact matched stations are RL-25084, RS-24163, SV-111, SV-735 and SV-833, under organization `21SC60WQ_WQX`. The source retains each station's full identifier. The two utility selections are disjoint.

The original station discovery query covers HUC8s `03060101` and `03060102` with E. coli observations from 1 January 2021 through 31 December 2025 and returns 70 stations. All original discovery rows remain in the source. The selected result queries return 142 ARJWS records and five Tugaloo yearly files containing 141, 82, 94, 115 and 156 records respectively.

The publisher's HUC8 polygon area is 2,562.97 square kilometres, while the sum of its 32 original HUC12 attributes in the earlier topology edition is 2,562.96. Both source values retain their native level and precision.

## Original measurement meaning

All 730 activities concern Escherichia coli in water. There are 729 routine samples and one explicitly identified field replicate, retained separately by the report filter and method summaries.

- 554 original numeric measurements.
- Six records reported above a quantitation limit.
- 67 records reported below a quantitation limit.
- 102 not-detected records.
- One not-reported record.

Censored original `ResultMeasureValue` fields remain empty. Original condition, limit type, limit token and limit units remain separate. The not-reported Georgia result retains its laboratory-temperature comment. Numeric zeros or fractions of limits are never substituted.

The three original method families are APHA 9223-B, APHA 9221-F and USGS BAC94. Original method names and descriptions are preserved. Source units are `MPN/100mL` and `MPN/100 ml`; the common chart axis spells this as MPN per 100 mL while every source spelling remains inspectable.

Summary rows separate station, calendar year, analytical method, activity type and original unit spelling. Minima, medians and maxima describe only the original numeric measured values in that group; counts with limits and missing results appear beside them. Actual sampling dates establish the temporal support. These observations supply field concentration context for the issuer's microbial-water objective alongside the application's retained nutrient/sediment land-export quantities.

## Geographic calculation and map

The compiler intersects the original WGS84 Station CSV coordinates with the four unchanged publisher-returned ARJWS polygon rings in EPSG:4326. It uses an even-odd point-in-polygon calculation and rejects a station exactly on a boundary or in overlapping selected units. Each matched HUC12 is retained in `station-membership.csv`.

PRWD selection uses the original station's HUC8 code and the previously published complete upstream membership. The report preserves this different source basis explicitly.

The original WQP GeoJSON provides the displayed station points. The original Station CSV also retains the numeric strings, coordinate datum and collection method. For the Tugaloo outline, the same USGS service returns a separate display response with `maxAllowableOffset=0.0001` degrees. This display outline is separately named and never used to assign station membership. The original full-resolution Tugaloo response URL and its separately captured body size are in `source-inputs.json`.

## Operate the report

Open `index.html`. Select utility area, station, sampling year, analytical method and result condition; search original station/activity/project/comment text. Map points and station-table links select an actual station. Filled time-plot circles show measured values, while open triangles show the original reported limit. Selecting a plotted point or table row opens all 63 original result fields.

The initial view selects routine samples; the retained field replicate is explicitly selectable. The result table renders 50 rows per page, and the selected CSV contains every matching row and all original fields. Selecting any station also selects its own utility geography. Changing a filter closes an inspected record when it leaves the selected cohort. Printing records every selected filter, expands the entire currently selected result table, then restores normal pagination.

All six unchanged original result CSVs and the original 70-station discovery CSV are embedded in the HTML, so those downloads work with the HTML alone. For linked geometry, source inventory, compiler and complete native receiving, keep this full directory together. The current-source manifest carries the complete relative hierarchy as companions for each main table/report entry.

## Reproduce and import

From the application root:

```bash
node source/ecoli_utility_context/20261013/build_ecoli_report.mjs
python -m model.cli --workspace /absolute/path/to/scientific-workspace source-import source/ecoli_utility_context/20261013/source-manifest.json
```

The Node compiler uses standard-library filesystem and SHA256 support. It verifies every original input against `source-inputs.json`, recalculates station membership and all original-row joins, then writes the same data, explorer and complete source manifest. Raw publisher files are read unchanged.

The `upstate.sources/v1` manifest registers the original observation table, selected station geometry, original ARJWS polygons, separately labeled PRWD display outline, method summaries and offline report. Full original records, geometry and the compiler are retained as source companions. Each result row carries its original source filename and CSV row ordinal, counting the header as row one.

## Original primary sources

- [Water Quality Portal web-service definitions](https://www.waterqualitydata.us/webservices_documentation/).
- [USGS WBD source service](https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer).
- [Issuer RFP and appendix](https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf).
- [Previously published original utility topology](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/b66b2a2f5ad5617ef4118ffd0240414b420040df/opportunities/upstate_forever_2026/source/receptor-topology/20261013).

`source-inputs.json` records each actual query URL, input filename, byte count and SHA256. This edition was captured on 13 October 2026. Original observations and geographic source material retain their publisher attribution and terms.
