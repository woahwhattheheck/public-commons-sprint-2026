# Eighteenmile: reported discharge quantities in observed flow context

The three outfalls upstream of USGS gauge 02186702 report 683.717745 million US gallons during 2023, equivalent to 2,588,153.21 m³. This equals 4.23596% of the gauge's 61,099,554.39 m³ observed calendar-year volume. The monthly volume ratio ranges from 2.30381% in January to 11.94475% in October. This seasonal context belongs beside the source quantities and actual lake-study sampling dates in the Upper Savannah scientific review.

## Calculated monthly context

| Month | Observed mean flow, cfs | Reported upstream flow, million US gal | Reported/gauge volume, % | Upstream total P, kg | Gross total P mass/gauge volume, mg/L |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2023-01 | 147.806 | 68.225513 | 2.304 | 73.790 | 0.006582 |
| 2023-02 | 84.611 | 55.547548 | 3.628 | 63.166 | 0.010898 |
| 2023-03 | 76.606 | 61.003753 | 3.975 | 53.228 | 0.009161 |
| 2023-04 | 131.283 | 63.197670 | 2.483 | 44.892 | 0.004659 |
| 2023-05 | 65.555 | 58.787842 | 4.476 | 52.834 | 0.010626 |
| 2023-06 | 85.333 | 54.676710 | 3.305 | 140.599 | 0.022448 |
| 2023-07 | 45.835 | 50.161813 | 5.462 | 127.496 | 0.036675 |
| 2023-08 | 45.681 | 56.383544 | 6.160 | 87.765 | 0.025332 |
| 2023-09 | 32.780 | 55.203750 | 8.685 | 92.916 | 0.038619 |
| 2023-10 | 23.729 | 56.789024 | 11.945 | 58.154 | 0.032313 |
| 2023-11 | 27.520 | 52.296450 | 9.801 | 100.488 | 0.049749 |
| 2023-12 | 55.977 | 51.444128 | 4.587 | 53.988 | 0.012716 |

Upstream reported total phosphorus totals 949.31580872 kg. Its annual gross source-mass/observed-volume index is 0.0155372 mg/L. This index divides reported upstream effluent mass by the same-calendar-period gauge water volume. A receiving-water prediction additionally represents transport, retention, travel time and other source terms. The index supports comparisons of the seasonal size of a reported source term within a single gauge domain.

The upstream group contains Milliken Pendleton (SC0000477), Pickens Upper (SC0042994) and Pickens Middle (SC0047856). Original NLDI flowline membership and reach measures place Pendleton-Clemson (SC0035700) downstream of this gauge. All four remain in the facility table with their original routing relationship. Upstream ratios use the three upstream permits.

## Data and physical meanings

The companion retains exact copies of the 230-row original-edition reporting-period table, the four original-source routing relationships and the complete original USGS 2023 daily response. The parent DMR edition contains the 20 original EPA series, 980 record identities and the executed original selection/calculation program. Each monthly facility row preserves original period bounds, selected DMR identifiers, source path/hash/URL, concentration qualifiers and period status.

Reported average rates are multiplied by actual calendar overlap days. A quarterly source rate remains a quarterly average when its quantity is allocated to a calendar month. Every original rate and reporting interval remains visible. Decimal rates are integrated and summed with BigInt fixed-decimal arithmetic; ratios use double precision.

The gauge denominator uses the 365 original approved daily mean discharges: parameter 00060, statistic 00003, method 126695. One cfs is 0.028316846592 m³/s and each reporting date represents a nominal 86400-second day. One million US gallons is 3785.411784 m³.

## Quantity cohorts and coverage

Total P, suspended solids and reported flow cover all 365 days at all three upstream permits. Total nitrogen covers February–December at both Pickens facilities: 5148.93199689 kg over 334 days per facility. Milliken's 4887.58235867 kg nitrate uses parameter 00620 and remains its own source species. Ammonia retains its original quarterly reporting and threshold statuses at Milliken.

Aggregates define their expected facility cohort separately for each original parameter, and complete amounts require all days at every member. Partial quantified amounts and facility-day counts remain separate fields. All 20 facility-series sums and quantified-day counts reconcile to the parent annual DMR edition.

## Files and native intake

| Table | Rows | Meaning |
| --- | ---: | --- |
| derived/facility_monthly.csv | 240 | All 20 facility-series in each calendar month, with routing and original reporting intervals |
| derived/upstream_monthly.csv | 72 | Six distinct parameter cohorts across 12 months |
| derived/upstream_annual.csv | 6 | Annual cohort quantities, coverage and eligible volume comparisons |
| derived/gauge_monthly.csv | 12 | Original approved gauge flow integrated by calendar month |

Install this companion at observations/eighteenmile_2023/npdes/flow_context. Its model-sources.json registers four ordinary native tables. Add that manifest to the existing source import or as another --context-manifest to the maintained assessment-map operator. Source companions include the calculation, exact input copies, input index and this guide.

```sh
node observations/eighteenmile_2023/npdes/flow_context/rebuild_monthly_flow.mjs --output-dir ACTUAL_RECOMPUTED_DIRECTORY
```

The CLI checks input bytes and hashes, executes the same calculation, compares the five expected output hashes and writes the recomputed tables and method summary. Existing identical outputs are reusable.

## Primary references

- [EPA Effluent Charts Help](https://echo.epa.gov/help/reports/effluent-charts-help): reporting identities, statistical bases, units and no-data indicators.
- [EPA loading-calculation hierarchy](https://echo.epa.gov/trends/loading-tool/resources/loading-calculations): source-specific reported quantity interpretation.
- [USGS gauge 02186702](https://waterdata.usgs.gov/monitoring-location/USGS-02186702/): monitored receiving stream.
- [USGS NHD linear referencing](https://pubs.usgs.gov/fs/2012/3068/FS12-3068.pdf): reach-measure orientation supporting the original routing edition.
