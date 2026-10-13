# Using the observed hydrology in native calibration

The retained 2020–2025 discharge gives the Upper Savannah work an actual hydrologic reference for selecting periods, comparing basins and interpreting nutrient sampling. Pair the native nutrient or sediment total with an observed constituent mass on the same contributing basin. Keep the lake-response observations attached to their original lake stations.

This assessment uses the original 88-file observed-hydrology edition, the 44-file Eighteenmile successor and the exact 217-HUC12 model-domain list. The companion [calibration-context.json](calibration-context.json) records their file hashes, station matrix, domain membership, spatial results and model comparison contracts.

## Actual geographic coverage

The domain and station comparison is based on original HUC identifiers:

| HUC8 prefix | HUC12s in retained model domain | Retained discharge gauges |
| --- | ---: | ---: |
| 03060101 | 36 | 4 |
| 03060102 | 32 | 6 |
| 03060103 | 57 | 3 |
| 03060104 | 43 | 3 |
| 03060105 | 18 | 0 |
| 03060106 | 8 | 0 |
| 03060107 | 23 | 0 |

Forty-nine domain HUC12s belong to the last three groups. This identifies a concrete acquisition extension: add actual discharge stations for those groups through the existing observed-source workflow. HUC membership does not establish that a station's entire contributing basin is inside the prepared model grid. Retain the actual outlet basin and inspect physical-input coverage when adding a comparison zone.

Source: [original station inventory](derived/monitoring_stations_nad83.geojson), [source queries and hashes](inputs.json), and [retained domain identifiers](../../source/receptor-topology/20261013/domain-huc12s.json).

## What each retained gauge contributes

The edition contains 88 complete calendar gauge-years; 83 have approved values on every expected day. Approved and estimated are independent source qualifiers: an approved year can still contain estimated daily values. The companion matrix retains both counts.

The provisional column below counts retained provisional daily values over the entire 2020–2025 period.

| USGS site | Original station name | Published drainage area, mi² | Complete years | Provisional days |
| --- | --- | ---: | --- | ---: |
| 02176930 | CHATTOOGA RIVER AT BURRELLS FORD,  NR PINE MTN,  GA | 46.7 | 2020, 2021, 2022, 2023, 2024, 2025 | 0 |
| 02177000 | CHATTOOGA RIVER NEAR CLAYTON,  GA | 207 | 2020, 2021, 2022, 2023, 2024, 2025 | 0 |
| 02178400 | TALLULAH RIVER NEAR CLAYTON,  GA | 58.4 | 2020, 2021, 2022, 2023, 2024, 2025 | 0 |
| 02180400 | TIGER CREEK NEAR LAKEMONT,  GA | 24 | 2021, 2022, 2023, 2024, 2025 | 0 |
| 02181350 | TALLULAH R AT TERRORA PWRHSE,  NR TALLULAH FALLS, GA | 181 | 2020, 2021, 2022, 2023, 2024, 2025 | 0 |
| 02181580 | TALLULAH RIVER AB POWERHOUSE,  NR TALLULAH FALLS, GA | 184.4 | 2020, 2021, 2023, 2024, 2025 | 21 |
| 02185010 | EASTATOEE CRK ON CLEO CHAPMAN HWY NEAR SUNSET,  SC | 21.7 | 2021, 2022, 2023, 2024, 2025 | 28 |
| 02186000 | TWELVEMILE CREEK NEAR LIBERTY,  SC | 106 | 2020, 2021, 2022, 2023, 2024, 2025 | 29 |
| 02186645 | CONEROSS CK NR SENECA,  SC | 65.4 | 2024, 2025 | 29 |
| 02186702 | EIGHTEENMILE CREEK BELOW PENDLETON,  SC | 48.6 | 2020, 2021, 2022, 2023, 2024, 2025 | 29 |
| 02187910 | ROCKY RIVER NR STARR,  SC | 111 | 2020, 2021, 2022, 2023, 2024 | 0 |
| 02188600 | BEAVERDAM CREEK ABOVE ELBERTON,  GA | 72 | 2020, 2021, 2022, 2023, 2024, 2025 | 0 |
| 02191227 | GROVE CREEK AT US 441 AND GA 15 NEAR COMMERCE,  GA | 60.4 | 2020, 2021, 2022, 2023, 2024, 2025 | 0 |
| 02191300 | BROAD RIVER ABOVE CARLTON,  GA | 760 | 2020, 2021, 2022, 2023, 2024, 2025 | 0 |
| 02192000 | BROAD RIVER NEAR BELL,  GA | 1420 | 2020, 2021, 2022, 2023, 2024, 2025 | 0 |
| 02192500 | LITTLE RIVER NEAR MT. CARMEL,  SC | 217 | 2020, 2021, 2022, 2023, 2024, 2025 | 0 |

Incomplete years stay visible in [calendar_year_flow.csv](derived/calendar_year_flow.csv). Tiger Creek and Eastatoee begin partway through 2020. Coneross has 238 observed days in 2023 and complete 2024–2025 records. Tallulah above the powerhouse is missing one day in 2022; Rocky River is missing one day in 2025. Use the existing complete-period fields when a calculation needs an entire year. Preserve the named powerhouse stations and their operational setting when selecting hydrologic comparators.

Source: [annual observations](derived/calendar_year_flow.csv) and the original agency responses indexed by [inputs.json](inputs.json).

## Eighteenmile: three different spatial extents

The gauge USGS 02186702 has a published drainage area of **48.6 mi²**, equal to **125.873422 km²**. The annual runoff table uses that published scalar area. It also retains a real upstream polygon from [the original USGS NLDI request](https://api.water.usgs.gov/nldi/linked-data/nwissite/USGS-02186702/basin?f=json&simplified=false&splitCatchment=false), COMID 11749433. That request deliberately keeps whole catchments, including the outlet catchment.

The lake study describes HUC10 0306010106 and HUC12s 030601010601 / 030601010602, with a reported study area of 38,112 acres. This is a separate reported extent. The model's own gauge-outlet delineation should use its actual DEM and routing network. Preserve all three identities instead of replacing one area with another.

The original WGS84 routine nutrient stations are:

| Station | Longitude | Latitude | Inside retained upstream gauge basin |
| --- | ---: | ---: | --- |
| SV-268 | -82.82177536 | 34.5971986 | No |
| SV-374 | -82.8299353 | 34.5721409 | No |

Both results come from direct point-in-polygon calculations against the original NLDI polygon in the same EPSG:4326 coordinate reference. The NAD83-only special-study points retain their separate datum. The upstream daily-flow join therefore supplies hydrologic context for these lake measurements. An annual lake load estimate requires the lake site's own water balance, inflows and constituent behavior.

Sources: [original basin](original/eighteenmile_nldi_whole_basin.geojson), [published gauge metadata](original/eighteenmile_station_metadata.json), [lake station coordinates](../eighteenmile_2023/study_sites_wgs84.geojson), and [study extent](../eighteenmile_2023/study.json).

## Native comparisons this evidence supports

**Period and routing alignment.** Compare observations and modeled output on the same outlet basin and period. The maintained native programme can retain different actual parameter profiles, run sensitivity cases, and summarize common valid output areas. Begin with one-at-a-time parameter variation, then retain joint designs for parameters that change the result. [InVEST calibration guidance](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/calibration_freshwater.html)

**NDR.** Discharge helps characterize hydrologic conditions. The nutrient comparison target is annual nitrogen or phosphorus mass in kg/year. The runoff proxy is normalized by its mean or a specified reference. Consequently, multiplying every proxy cell by the same factor has no effect when its mean is recomputed. An explicit shared reference preserves an intended climate comparison. Nutrient export stops at the stream; downstream lake behavior needs separate interpretation. [Pinned NDR documentation](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html)

**SDR.** Use annual sediment mass in metric tonnes/year on the matched basin. Account for reservoir trapping and material from sources outside modeled overland erosion when comparing outlet observations. Rainfall erosivity remains its own physical input; discharge is not its replacement. The retained broader WQP collection includes nine TSS records at SV-375, SV-376 and SV-245, plus turbidity. These supply dated observations for further spatial joining; turbidity in NTU needs an appropriate concentration relationship before mass integration. [Pinned SDR documentation](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html) and [actual WQP coverage](../eighteenmile_2023/wqp/derived/coverage.csv).

**Mass and measurement units.** The current native application converts pinned 3.20 output rates using the physical pixel area once. Sum those mass-per-cell artifacts for a basin. For matched discharge and concentration, the dimensional relation is:

```text
kg = sum(Q_m3_per_second × C_mg_per_litre × interval_seconds / 1000)
```

An irregular concentration series needs an explicit estimator between samples and preserved detection-limit treatment. The product of separate means differs from the mean product whenever flow and concentration covary. Retain the original daily qualifiers, concentration bounds and sampling times in that calculation.


### Installed profile-to-native argument mapping

On source commit 904ac1340507365a897ca846e7cfab3577898507, the optional value is `profile["ndr"]["runoff_proxy_av"]`. The profile validator requires a finite positive number and retains the profile's title and source references. The native argument builder forwards the NDR profile unchanged and sets `runoff_proxy_path` from the prepared grid's `PRECIPITATION` role. Use the actual retained raster's units when defining a fixed reference; put the same referenced value into each profile intended for that comparison.

Source: [profile validation](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/904ac1340507365a897ca846e7cfab3577898507/opportunities/upstate_forever_2026/model/profiles.py), blob 7e21e77a7d65f2256c700c44cdc34eff44306e9d; [native argument mapping](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/904ac1340507365a897ca846e7cfab3577898507/opportunities/upstate_forever_2026/model/native_arguments.py), blob 274d1d8cb6be91f46b7f74c201ec3b3e9265ad0a.

## Integration with retained source workflows

Import observed_hydrology_20261013/model-sources.json through the existing workspace source importer. The vector IDs are usgs-savannah-observed-gauges-2020-2025 and usgs-eighteenmile-whole-catchments-20261013. Add the actual gauge basin as a named comparison zone using the existing scenario/report APIs. The complete annual matrix, real lake-station geometry and underlying original agency records now provide the source material for that join.

## Reported point sources in the observed Eighteenmile flow context

The retained [DMR source and calculation](../eighteenmile_2023/npdes/DMR_LOADS.md) supplies 230 reporting-period quantities from 980 original EPA value records. The [monthly flow companion](../eighteenmile_2023/npdes/flow_context/README.md) joins those periods to the original 365 approved USGS daily means at gauge 02186702. Use the source quantities, reporting intervals and same-period gauge volumes together.

### Select the actual upstream cohort

The [original outfall/gauge relations](../eighteenmile_2023/npdes/flow_context/inputs/outfall_gauge_relations.csv) put Milliken Pendleton (SC0000477), Pickens Upper (SC0042994) and Pickens Middle (SC0047856) upstream of the gauge. Pendleton-Clemson (SC0035700) remains in the facility and map context downstream.

All four points fall within the retained whole-catchment polygon. The same-reach ordering supplies the important distinction: Milliken has reach measure 92.5177, the gauge 53.4049 and Pendleton-Clemson 24.0152 on reach 03060101000042. The two Pickens outfalls are members of the gauge's upstream network on other reaches. Use these original network relationships when selecting a gauge cohort. Display the agency point and indexed network point as separate locations; their supplied-to-indexed distances range from 14.21 m to 289.85 m in this edition.

The state map labels all four outfalls 001, while Milliken's EPA records use T1M for phosphorus, nitrate, TSS and flow and T1Q for ammonia. Preserve that permit-level join and both feature identities. The map's current source capture and the 2023 discharge reporting period remain separate dates. [Native source mapping](../eighteenmile_2023/npdes/NATIVE_IMPORT.md)

### Read quantity, coverage and species together

| Parameter | Upstream source cohort | Retained amount | Quantified facility-days | Reporting interpretation |
| --- | --- | ---: | ---: | --- |
| Total P, 00665 | All three upstream permits | 949.3158 kg | 1,095 / 1,095 | Complete 2023 cohort |
| TSS, 00530 | All three upstream permits | 52,868.1134 kg | 1,095 / 1,095 | Complete 2023 cohort |
| Flow, 50050 | All three upstream permits | 683.717745 million US gallons | 1,095 / 1,095 | Complete 2023 cohort |
| Total N as N, 00600 | Pickens Upper and Middle | 5,148.9320 kg | 668 / 730 | February–December; retain January as missing |
| Nitrate as N, 00620 | Milliken | 4,887.5824 kg | 365 / 365 | Complete Milliken nitrate series |
| Ammonia as N, 00610 | All three upstream permits | 513.4236 kg quantified across available periods | 821 / 1,095 | Preserve each facility's available intervals |

Source: [original annual cohort table](../eighteenmile_2023/npdes/flow_context/derived/upstream_annual.csv). “Complete” describes the stated parameter-specific facility cohort. EPA's nutrient aggregation selects nonoverlapping nitrogen components and gives reported total N priority. Apply an explicit species and interval selection before deriving any combined nitrogen quantity. [EPA nutrient aggregation](https://echo.epa.gov/trends/loading-tool/resources/technical-background-methodology/nutrient-aggregation)

Milliken ammonia has three original periods with an unquantified detection-threshold status and a numeric-zero September–November period. Preserve the zero and the unknown intervals separately. Quarterly average rates allocated to months retain their original quarterly reporting interval. EPA's calculation guidance likewise distinguishes statistical bases, mass quantities, flow-dependent concentration calculations and represented discharge duration. [Original period records](../eighteenmile_2023/npdes/derived/period_loads.csv); [EPA loading hierarchy](https://echo.epa.gov/trends/loading-tool/resources/loading-calculations)

### Separate seasonal source changes from flow-volume changes

The three-facility reported effluent volume is 2,588,153.21 m³ over 2023; measured gauge volume is 61,099,554.39 m³. Their annual ratio is **4.236%**, calculated from the two annual volume sums. The monthly ratio rises from **2.304% in January to 11.945% in October**. Over those two months reported effluent volume decreases 16.763%, while gauge volume decreases 83.946%; the ratio rises 5.185 times. Show both component volumes beside the percentage. [Monthly source and gauge table](../eighteenmile_2023/npdes/flow_context/derived/upstream_monthly.csv)

Total-P mass is greatest in June, at 140.5993 kg. Its gross source-mass/gauge-volume index is greatest in November, at 0.0497494 mg/L, when the source quantity is 100.4884 kg and gauge volume is lower. The annual index is 0.0155372 mg/L. Milliken contributes 80.163% of this selected upstream reported phosphorus total; Pickens Upper and Middle contribute 9.033% and 10.804%.

Use the label **gross reported source mass / observed same-period gauge volume**. This is a dated source term in the selected gauge domain. A receiving-water prediction additionally represents stream and reservoir transport, retention, travel time and other sources.

Complete shared subperiods are also available for the partial annual cohorts:

- **Two-Pickens total N, February–December:** 5,148.93199689 kg over 334 calendar days divided by 49,889,345.23705836 m³ of gauge volume gives a same-period index of **0.10320705 mg/L**.
- **Three-facility ammonia, September–November:** 83.0384157 kg over 91 calendar days divided by 6,225,556.133203477 m³ gives **0.01333831 mg/L**. This uses the complete common months; the broader partial annual quantified amount includes additional Pickens months.

These subperiod calculations sum only the rows with a complete cohort in [upstream_monthly.csv](../eighteenmile_2023/npdes/flow_context/derived/upstream_monthly.csv), then compute `1000 × summed kg / summed gauge m3`. The original annual completeness fields stay unchanged.

### Use the data in the native report and model comparison

Import both existing manifests through the assessment runner's `--context-manifest` option: `observations/eighteenmile_2023/npdes/model-sources.json` registers the outfall vector and three DMR tables; `observations/eighteenmile_2023/npdes/flow_context/model-sources.json` registers the four flow-context tables.

Keep the dated point-source quantities beside the actual land-cover NDR/SDR export for the corresponding domain and source period. Review coefficient derivation before combining source terms, and represent the selected stream or reservoir transport explicitly. Use the monthly context to interpret the lake-study sampling dates and the separate annual source terms when evaluating a native scenario.

## Additional 13-gauge source coverage and hydrologic context

The completed source acquisition adds 13 distinct native daily-mean discharge series from HUC8 groups 03060105, 03060106 and 03060107 for 2020–2025. The original 16-gauge edition keeps its source identity; the two retained inventories now cover 29 distinct gauges. The additional eight original USGS responses and full paths/line numbers are in [the regional source edition](../../source/hydrology-huc05-07-20261013/README.md). Its [calibration guide](../../source/hydrology-huc05-07-20261013/CALIBRATION_CONTEXT.md), [annual table](../../source/hydrology-huc05-07-20261013/derived/calendar_year_flow.csv), [monthly table](../../source/hydrology-huc05-07-20261013/derived/calendar_month_flow.csv) and [2023 reference context](../../source/hydrology-huc05-07-20261013/derived/2023_reference_flow_context.csv) use the existing numerical conventions.

The new source has 26,242 records, 26,241 numeric daily means, 654 estimated numeric values and 13 provisional numeric values. Horse Creek's original `Rat`/`P` record on 2024-09-24 remains nonnumeric. Sixty-one of 78 gauge-years have complete numeric calendar coverage; all 61 are approved. Derived products add 936 monthly periods and retain the same 196-day lake-study window as a date selection. That date window does not assign a new gauge's flow to the Eighteenmile lake sampling sites.

The 2023 flow context is spatially varied. Kiokee Creek is 59.18% above the median of its five other complete approved-year means, Stevens Creek 11.43% above, and Little River 11.71% below. Savannah River at Augusta is 0.37% below its five-year reference median. These differences strengthen the need for matching periods and original catchments when interpreting regional model results. Augusta Canal and Savannah River near Waynesboro have only 327 and 344 numeric days in 2023; their observed-day means remain visible and their complete-year ratios and annual volumes stay unavailable. The original canal inventory has no drainage area, so runoff depth also stays unavailable.

Source qualification has a measurable influence on the retained totals. At Butler Creek below 7th Avenue, 76 estimated approved dates carry 41.96% of observed 2023 flow volume. Kiokee Creek's seven estimated approved dates carry 12.95%, and Spirit Creek's eleven carry 21.06%. The dates strictly above Stevens Creek's observed daily-flow 95th percentile carry 62.72% of its 2023 volume. These are partitions of the original measured-date volume, useful for choosing validation periods and checking high-flow representation. They do not alter the retained daily values or their agency qualifiers.

The extended site inventory retains NAD83 monitoring coordinates and source drainage areas. Its 49 candidate-domain HUC12 identifiers consist of 18 in 03060105, eight in 03060106 and 23 in 03060107. The individual monitoring-point join and the contributing-basin overlap remain separate records in the original geographic workflow. A74F's original NLDI point/COMID/reach/measure and upstream geometry support those catchment comparisons. Use the actual original polygon relations when selecting native calibration outlets.

The exact same-outlet WQP nutrient request for USGS-02186702, 2020-01-01 through 2025-12-31, returned its 63-column header with zero result rows. [The retained source capture](../../source/calibration-coverage/20261013/capture.json) records that site/date/category query and original body hash alongside the expanded site and daily source inventory.
