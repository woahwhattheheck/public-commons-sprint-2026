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
