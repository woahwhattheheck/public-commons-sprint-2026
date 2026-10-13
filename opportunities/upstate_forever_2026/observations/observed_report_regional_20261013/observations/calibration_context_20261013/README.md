# Observed flow context for the Upper Savannah modelling work

## Decisions supported by these observations

The completed agency capture provides 2020–2025 daily flows and exact laboratory sampling dates. This assessment uses each gauge’s own complete annual observations to place 2023 in context, and measures which flow conditions the Eighteenmile lake-study dates represent. The calculation retains the original source-record references and quality counts.

At Eighteenmile Creek below Pendleton (USGS 02186702), the 2023 annual mean was 68.42055 ft³/s, 101.52% of the median annual mean in its other complete observed years. Compare this with the individual headwater rows below when selecting climate years and gauged catchments for regional model evaluation.

## Gauge-specific annual context

The reference is the median of the other fully observed annual means at the same gauge. The 2023 target is excluded from its own reference. Rank 1 is the lowest annual mean among that gauge’s complete years in this retained six-year record. Partial periods retain their observed mean and coverage; their annual ratio, annual runoff and rank remain empty. The JSON retains the approval, provisional, estimated and revised counts for the target and every reference year.

| USGS site | Original station name | 2023 valid days | 2023 mean, ft³/s | Other-year median, ft³/s | 2023/reference | Ascending rank |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 02176930 | CHATTOOGA RIVER AT BURRELLS FORD, NR PINE MTN, GA | 365/365 | 110.88 | 187.14 | 59.25% | 1/6 |
| 02177000 | CHATTOOGA RIVER NEAR CLAYTON, GA | 365/365 | 437.03 | 635.05 | 68.82% | 1/6 |
| 02178400 | TALLULAH RIVER NEAR CLAYTON, GA | 365/365 | 142.90 | 195.37 | 73.15% | 1/6 |
| 02180400 | TIGER CREEK NEAR LAKEMONT, GA | 365/365 | 45.60 | 59.15 | 77.08% | 1/5 |
| 02181350 | TALLULAH R AT TERRORA PWRHSE, NR TALLULAH FALLS,GA | 365/365 | 81.56 | 142.28 | 57.32% | 2/6 |
| 02181580 | TALLULAH RIVER AB POWERHOUSE, NR TALLULAH FALLS,GA | 365/365 | 61.63 | 152.27 | 40.47% | 2/5 |
| 02185010 | EASTATOEE CRK ON CLEO CHAPMAN HWY NEAR SUNSET, SC | 365/365 | 49.89 | 62.04 | 80.41% | 1/5 |
| 02186000 | TWELVEMILE CREEK NEAR LIBERTY, SC | 365/365 | 148.52 | 196.33 | 75.65% | 3/6 |
| 02186645 | CONEROSS CK NR SENECA, SC | 238/365 | 74.33 | 101.34 | — | — |
| 02186702 | EIGHTEENMILE CREEK BELOW PENDLETON, SC | 365/365 | 68.42 | 67.40 | 101.52% | 4/6 |
| 02187910 | ROCKY RIVER NR STARR, SC | 365/365 | 130.04 | 142.02 | 91.57% | 3/5 |
| 02188600 | BEAVERDAM CREEK ABOVE ELBERTON, GA | 365/365 | 88.82 | 95.04 | 93.45% | 3/6 |
| 02191227 | GROVE CREEK AT US 441 AND GA 15 NEAR COMMERCE, GA | 365/365 | 73.40 | 81.34 | 90.24% | 2/6 |
| 02191300 | BROAD RIVER ABOVE CARLTON, GA | 365/365 | 854.36 | 1003.93 | 85.10% | 3/6 |
| 02192000 | BROAD RIVER NEAR BELL, GA | 365/365 | 1619.61 | 1721.93 | 94.06% | 3/6 |
| 02192500 | LITTLE RIVER NEAR MT. CARMEL, SC | 365/365 | 178.37 | 199.45 | 89.43% | 2/6 |

Use the original gauge locations, contributing areas and published operating context when selecting a comparison. In particular, the two source records labelled powerhouse retain their separate station identities. The inventory spans four HUC8 query areas; each spatial comparison also carries the selected model-domain and gauge-catchment geometry.

## Sampling dates and observed high-flow periods

The retained study cohort has 16 unique 2023 dates. The original daily-flow reference contains 365 days. Its annual 95th percentile of daily mean flow is 134.8 ft³/s.

- 19 days meet or exceed that threshold and account for 25.35% of the observed annual discharge volume.
- During 2023-04-05 through 2023-10-17, 9 threshold days account for 24.06% of the observed 196-day volume.
- 0 of the 16 unique sampling dates meet that threshold. Sampling-date daily means range from 21.1 to 96.2 ft³/s, with median 43.45 ft³/s.
- The preceding three-day means exceed the annual daily threshold before 2023-05-02 and 2023-06-14. The preceding seven-day mean exceeds it before 2023-05-02. These antecedent windows are useful for interpreting lake response after elevated inflow.

The volume fractions divide sums of daily mean discharge over the selected dates; the common ft³/s-to-volume conversion cancels. These are shares of observed water volume. Concentration, nutrient mass and sediment mass have their own measured quantities and spatial support.

## Use in the native workflow

1. Import the complete observed-hydrology and Eighteenmile model-sources.json manifests, retaining original response companions and the published coordinate reference systems.
2. Match a candidate model’s reporting catchment to the original gauge basin and the corresponding observed period. Use complete-period flow/runoff and source quality counts to assess the hydrologic inputs.
3. Keep the source-specific annual pattern visible: 2023 lies near Eighteenmile’s other-year reference but is the lowest complete annual mean in several headwater records. Each catchment’s actual climate and observed-flow relationship should inform its model comparison.
4. Use the laboratory activity, station, project, method, censoring and sampling-date fields when comparing water-quality evidence with model outputs. The study’s low-to-moderate sampling-day flows and elevated antecedent windows provide different temporal context.
5. Evaluate annual nutrient and sediment exports with corresponding annual mass observations and matching contributing areas. The InVEST 3.20.0 freshwater calibration guidance describes the model-specific quantities and calibration sequence.

## Source and reproduction

Run from the application root:

    node source_tools/assess_observed_context.mjs

This produces assessment.json, station_year_context.csv and this document under observations/calibration_context_20261013. The JSON lists exact input-file hashes and the original daily-flow record associated with each sample date.

- [Original agency responses, methods and full hydrology edition](../observed_hydrology_20261013/README.md)
- [Complete annual observed-flow table](../observed_hydrology_20261013/derived/calendar_year_flow.csv)
- [Original daily-flow table and source-record links](../observed_hydrology_20261013/derived/daily_flow.csv)
- [Dated study-flow context and antecedent-window methods](../eighteenmile_2023/wqp/FLOW_CONTEXT_README.md)
- [USGS Eighteenmile station](https://waterdata.usgs.gov/monitoring-location/USGS-02186702/)
- [Published 2023 lake investigation](https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/2023LakeProgramFinalReport.pdf)
- [InVEST 3.20.0 freshwater calibration guidance](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/calibration_freshwater.html)
