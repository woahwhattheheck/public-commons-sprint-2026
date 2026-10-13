# Original utility observations in watershed decisions

This source join makes the existing original microbial and regional stream observations available in the utility watershed report. **Needs expert review** for site-specific sampling design and interpretation.

## Actual source result

The original utility profile is SHA256 `93abaaf736c66a7ca971ca931da2a3d81d939ecdeb830c7892267153c4413da7`. Its ARJWS selection has four whole HUC12s and its Pioneer/PRWD selection has 32. Their original programme and designation context stays in the maintained watershed report.

| Utility | Original E. coli records | Stations | Distinct sample dates | Information Only comments | Field replicates |
| --- | ---: | ---: | ---: | ---: | ---: |
| ARJWS | 142 | 5 | 109 | 0 | 0 |
| Pioneer/PRWD | 588 | 31 | 255 | 72 | 1 |

All 730 original rows retain their source file/row, station/activity identities, methods, original units, detection conditions, reporting limits and comments. The quantity is microbial concentration, with the original unit spellings `MPN/100mL` and `MPN/100 ml`. Station/year/method/activity/unit groups expose measured-only minimum/median/maximum beside original detection counts. The separate explicit comment view removes only the source's Information Only/Infomation Only marker; the default source cohort remains complete.

The ARJWS stations belong to original HUC12s 030601010701,030601010702 and030601010703. The retained microbial cohort has no selected station in 030601010704. This describes this original query's sampling geography. Pioneer membership uses the original WQP HUC8 code 03060102 and the retained complete 32-HUC union; individual HUC12 station assignment stays unresolved in this source edition. A subsequent original native Station geography result can supply that separate assignment.

The active station set changes by year. ARJWS has three active stations in each of 2021–2025, but these are different sets; Pioneer has 15, 12, 11, 13 and 18. The source tables preserve all 36 station histories, including zero-observation station-years. Campaign coverage and source samples retain their actual dates.

## Regional nutrient and daily-flow support

The original 589 nutrient rows form 19 station/constituent/fraction/method/result-type/unit series. All four station points were evaluated against the original EPSG:4326 ARJWS polygons using their original WGS84 positions. Every point lies outside that four-HUC selection. Their source HUC8 is 03060101, which differs from Pioneer's complete 03060102 selection.

These observations therefore appear as regional stream context in the utility report. The original NLDI relationship to USGS 02186702 remains separate: SV-233 is downstream on the same original reach; the other three retain their original indexed-upstream-reach relationship. Full-reach polygon membership and gauge-specific network support are separate source fields.

The maintained flow analysis supplies 2,192 daily records and 106 unique chemistry dates across 2020–2025. Its 65 source-defined high-flow episodes include 58 without a sampled date in the four-station cohort. In 2024, none of 13 sampled dates reaches that year's P95 threshold; the 19 days at or above that threshold contain 40.2571% of the recorded gauge water volume. These are the already published source calculations, carried with their complete source identity and method, including the original provisional/estimated qualifiers.

Original reported Nitrogen, Kjeldahl nitrogen, nitrate/nitrite and phosphorus remain separate. [EPA's nutrient aggregation reference](https://echo.epa.gov/trends/loading-tool/resources/technical-background-methodology/nutrient-aggregation) requires consistent constituent mass basis when combining components. The existing component diagnostic and its six source discrepancies remain in the original stream analysis.

## Use with native model results

[NDR documentation](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html) describes long-term land-origin nutrient delivery to the modeled stream. [SDR documentation](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html) defines the corresponding sediment-delivery model. The application's current native output rates become annual mass using actual native cell hectares and the selected spatial support.

The observed E. coli series and native nitrogen/phosphorus/sediment outputs represent different constituents. Original nutrient grab concentrations also have different time and spatial support from annual source-export mass. A receiving-water comparison needs matched constituents, contributing geography, source dates, flow integration and transport/process assumptions. The saved utility report puts these facts next to its actual observations and land-management source context.

Useful work supported by these originals includes reviewing microbial sites within each utility selection, choosing follow-up sampling periods and locations, inspecting high-flow coverage, comparing consistently defined source series, and examining land-origin model priorities with the appropriate geographical relationship. All original measurements remain available through the exported CSVs.

## Rebuild and install

From the complete pinned application source:

~~~sh
node source_tools/build_utility_observed_context.mjs
~~~

Optional positional arguments are the application root and a separate output directory. The source loader verifies every declared original byte count/SHA256 in inputs.json before invoking the calculation kernel. The checked-in result was produced by this complete kernel against the actual retained source bytes in JavaScript.

The new source manifest is utility_observed_context.sources.json. Its ordinary upstate.sources/v1 entry retains the context JSON, human report, tables, input manifest and original input members. The maintained regional watershed installer includes this edition when it is present.

In Regional watersheds, open a saved native-network report, inspect a utility's observed sampling summary, and choose Save and export. The saved selection binds the observed source body, complete source manifest and original utility profile; its exact original HUC12 membership must agree. The report copies all supplied source members under observed-sources and includes ordinary verified download descriptors. Export identities include the actual observed selection, so earlier saved briefs remain available.

The native receiver source_tools/receive_utility_source_context.py also binds and exports this source edition when installed. Its actual receiving.json records the exported files. The original native receiving operation remains the place to obtain the Python output directory and stdout.

## Source lineage

inputs.json identifies every input by exact application path, SHA256, byte length and pinned repository source link. The underlying publisher references remain in the original microbial source-inputs.json and stream input-manifest.json. The three main original source services are [WQP](https://www.waterqualitydata.us/), [USGS WBD](https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6), and [USGS 02186702](https://waterdata.usgs.gov/monitoring-location/USGS-02186702/).

## One complete offline utility packet

The existing download panel includes `utility-watershed-packet.zip`. It contains
all verified saved export files at their actual relative paths, plus a packet
manifest. Extract the ZIP and open `watershed-selection-brief.html` to follow
its source links locally. The native utility receiver writes this same packet.
Automatic observed context attaches only when both the original profile and
complete HUC membership match; other original utility selections export through
their own existing source workflow.
