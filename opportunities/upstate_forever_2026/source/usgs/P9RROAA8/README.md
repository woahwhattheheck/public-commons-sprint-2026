# Original USGS seasonal loads — P9RROAA8

This directory preserves the complete original seasonal-load table from USGS release [10.5066/P9RROAA8](https://doi.org/10.5066/P9RROAA8), plus a reproducible inventory of its actual geography, identifiers and time coverage. It provides a southeastern regional benchmark source for the water-quality workbench.

**Scientific interpretation: Needs expert review.** The released station geography has zero rows in the Upper Savannah project's seven HUC8 groups, `03060101` through `03060107`. Use the supplied coverage inventory to select a suitable geography before an observation or calibration import.

## Files and original identity

| File | Contents |
| --- | --- |
| `Seasonal_time_step_estimates_southeastern_US_2001_2014.txt` | Complete original tab-separated table, 5,261,599 bytes; original fields, identifiers, blank values and CRLF line endings retained. |
| `source-coverage.json` | Exact source identity, all 45 field names, time codes, station-identifier counts, complete HUC8 inventory, blank-geography example and project-HUC8 comparison. |

Original publisher file: <https://www.sciencebase.gov/catalog/file/get/60ec83fad34e3bf20b41d3c8?f=__disk__dd%2F81%2F8e%2Fdd818e189cc21f05a10692f6bc08f12ac35e0cfc>.

- Publisher MD5: `68e071d788c38f1c3f3bb671160b6648`.
- Verified SHA256: `8af8604360dfca267804f9252773d43022b250a4f8fa4f9e9fb63e5942296f93`.
- Original Git blob: `9631e51ca2e1f412e2f5669bc65dd6e081cea941`.
- Release license: **CC0**, as recorded by the original publisher.

## Observed coverage

The table contains 16,056 data rows, 45 columns and 320 distinct COMIDs. It retains 54 original `Timestep` codes, from `200102` through `201403`: three codes in 2001, all four codes for each year 2002–2013, and three in 2014. A complete time-code inventory does not imply that every station has every value.

There are 47 nonempty original HUC8 values and 50 rows with blank HUC8. The geographic comparison explicitly left-pads nonempty HUC8 strings to eight digits while preserving the table's original seven-digit values. Blank source geography stays blank. The full inventory and each group's actual row and COMID counts are in `source-coverage.json`.

The original nonempty `Station_ID` field has 172 distinct values. The four flow-identifier fields together contain 185 distinct identifiers. Constituent station fields have 217 nitrogen, 225 phosphorus and 136 suspended-sediment identifiers; these include the publisher's combined-station identifiers and are counts of identifiers, rather than an inferred count of physical monitoring stations. Keep all station fields as text so leading zeros and original combined IDs survive import.

## Byte recovery

The received complete text representation contained exactly 100 HTML-encoded `&amp;` entities and omitted the terminal CRLF. Decoding those entities and restoring the single terminal CRLF reproduced both the publisher's exact byte count and its MD5 checksum. The resulting bytes are the original table preserved here. `source-coverage.json` retains the received representation's byte count/SHA256 and the exact two presentation corrections.

The inventory was computed from every data row of those verified original bytes. Read the release's original field documentation before assigning scientific meaning, estimator eligibility, reporting periods or units to a downstream calculation.
