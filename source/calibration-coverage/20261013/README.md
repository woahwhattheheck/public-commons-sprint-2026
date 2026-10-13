# Original calibration coverage sources

This directory extends the maintained Upper Savannah calibration source work with
six original government responses and their complete query provenance. It follows
the existing A73C/OBS12 acquisition request, Slack message 1791861681.528029, and
keeps the original scientific processor and regional watershed selection.

## Original files

| File under raw/ | Original scope | Bytes |
|---|---|---:|
| usgs-huc03060105-07-sites.tsv | Expanded USGS stream-site inventory, all statuses, HUC03060105/06/07 | 22544 |
| usgs-02186702-nutrients-2020-2025.csv | Exact same-outlet WQP Nutrient query, 2020–2025 | 1754 |
| usgs-huc03060105-07-discharge-series.tsv | Original daily-series period-of-record catalogue | 49360 |
| usgs-huc03060105-daily-mean-discharge-2023.tsv | Two selected candidate stations, 2023 daily mean discharge | 25535 |
| usgs-huc03060106-daily-mean-discharge-2023.tsv | Ten selected candidate stations, 2023 daily mean discharge | 121706 |
| usgs-huc03060107-daily-mean-discharge-2023.tsv | One selected candidate station, 2023 daily mean discharge | 13179 |

Every complete original body remains byte-for-byte unchanged. capture.json records
its original URL, parameters, capture time, byte count, SHA256 and parsed inventory.
The publisher's original comments, field descriptions, warning text and qualifiers
remain part of the retained response. All site and native time-series IDs are strings.

## Continue the existing source selection

The expanded HUC8 site query returns 84 sites: six in 03060105, 73 in 03060106 and
five in 03060107. The maintained model domain contains a selected 49-HUC12 subset
in these groups; apply the original polygon membership and upstream/receiving
relationships when choosing model comparisons. Broad HUC8 membership is a source
candidate criterion, separate from that retained domain selection.

The original period-of-record response contains 264 series rows at 66 stations.
The request's parameter filter selects stations; its returned rows also include
other parameters and statistics. Select rows explicitly using:

- data_type_cd equal to dv;
- parm_cd equal to 00060 (discharge);
- stat_cd equal to 00003 (daily mean);
- begin_date on or before 2023-12-31 and end_date on or after 2023-01-01.

That produces 13 distinct station/time-series candidates. Their full original
2023 records are already captured in the three daily files. The IDs and period
metadata are retained in capture.json, including the TS_ID bound by each daily
file's original column header. The existing source processor can select relevant
stations from these completed captures without repeating the remote queries.

## Observed daily coverage

| Station | Native TS_ID | Quantified days in 2023 | Approved estimated days |
|---|---|---:|---:|
| 02193340 | 34493 | 365 | 80 |
| 02193500 | 324274 | 365 | 0 |
| 02195320 | 324277 | 365 | 7 |
| 02195470 | 344257 | 365 | 0 |
| 02196000 | 126801 | 365 | 0 |
| 02196485 | 126828 | 327 | 0 |
| 02196690 | 126845 | 365 | 0 |
| 02196835 | 34520 | 365 | 76 |
| 021968385 | 243203 | 365 | 0 |
| 02197000 | 126852 | 365 | 0 |
| 02197020 | 34530 | 365 | 11 |
| 021973269 | 34535 | 344 | 2 |
| 02197500 | 127079 | 365 | 13 |

All 4686 original daily means are numeric, with one record per station/date.
The source units are cubic feet per second. The original A qualifier denotes
approved values, and A:e retains the publisher's estimated-value qualifier;
189 records have A:e. Eleven stations have all 365 dates. USGS02196485 has
38 absent dates, and USGS021973269 has 21. Preserve these gaps and qualifiers
in the existing observed-data import, summaries and model comparisons.

The WQP request for site USGS-02186702, dates 2020-01-01 through 2025-12-31,
and characteristicType=Nutrient returns its complete 63-column CSV header with
zero data records. This exact query result belongs in the same-outlet calibration
context alongside its site/date/category scope. Other sites, dates and constituent
categories remain separate original source selections.

## RDB reader contract

Daily-value RDB repeats its header and field-width rows between station blocks.
A reader must replace the active column header whenever agency_cd begins a new
header row, skip its following width/type row, and bind the original
TS_ID_00060_00003 value with TS_ID_00060_00003_cd from that block. Preserve date,
value text and qualifier text. The expanded site table has 42 columns; the
period-of-record table has 24. Original comments identify the units and statistic.

No annual load or concentration estimator is introduced by this source intake.
The maintained hydrology/calibration processor owns aggregation and scientific
comparison, using the original station/outlet relationship and full date support.

## Primary sources

- USGS Site Service: https://waterservices.usgs.gov/nwis/site/
- USGS Daily Values Service: https://waterservices.usgs.gov/nwis/dv/
- USGS service format and period-of-record documentation: https://waterservices.usgs.gov/docs/site-service/site-service-details/
- Water Quality Portal Result Service: https://www.waterqualitydata.us/data/Result/search
- Exact complete queries and original source hashes: capture.json in this directory.
- Original acquisition request: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791861681528029
