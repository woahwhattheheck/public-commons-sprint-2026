# Macroeconomic source starter

This source package adds complete CPI and GDP histories to the existing unemployment edition. The maintained FRED application imports the original tables, combines selected retained captures into one economic edition, saves its review, publishes the edition through the original merchant, and receives its data with the original customer.

## Source inventory

| Series | Source file | Original observations | Observation interval | Frequency and units | Original missing values |
| --- | --- | ---: | --- | --- | ---: |
| CPIAUCSL | [cpiaucsl-20261012.public-table.json](cpiaucsl-20261012.public-table.json) | 956 | 1947-01-01 to 2026-08-01 | Monthly; Index 1982-1984=100; seasonally adjusted | 1 |
| GDP | [gdp-20261012.public-table.json](gdp-20261012.public-table.json) | 318 | 1947-01-01 to 2026-04-01 | Quarterly; billions of dollars; seasonally adjusted annual rate | 0 |
| UNRATE | [unrate-20261012.public-table.json](unrate-20261012.public-table.json) | 945 | 1948-01-01 to 2026-09-01 | Monthly; percent; seasonally adjusted | 1 |

The 2,219 observations keep their original dates, values and meanings. CPIAUCSL is a price index; GDP is the source's nominal output level at an annual rate; UNRATE is the unemployment rate. Each observation remains attached to its series, units, frequency and adjustment.

Official source tables:

- [CPIAUCSL, Consumer Price Index for All Urban Consumers: All Items in U.S. City Average](https://fred.stlouisfed.org/data/CPIAUCSL), published by the U.S. Bureau of Labor Statistics.
- [GDP, Gross Domestic Product](https://fred.stlouisfed.org/data/GDP), published by the U.S. Bureau of Economic Analysis.
- [UNRATE, Unemployment Rate](https://fred.stlouisfed.org/data/UNRATE), published by the U.S. Bureau of Labor Statistics.

CPI and GDP were retrieved on 2026-10-12 at 01:38:52.463 UTC. UNRATE was retrieved on 2026-10-12 at 01:08:43.499 UTC. The wrapper retains the original source URL and retrieval timestamp beside the exact table text.

| Series | Publisher's original update label | Retained table UTF-8 bytes | Table SHA-256 |
| --- | --- | ---: | --- |
| CPIAUCSL | 2026-09-11 8:37 AM CDT | 21,056 | `be79ba8b338b2f19084b4ded2f30b0f43662644f6302f6d5e5235630ba5f198f` |
| GDP | 2026-09-30 7:54 AM CDT | 7,704 | `51cd2a4b8f763a15aad8abf1b8e399d20202ddb9777ba88905ab0a5f426f978c` |
| UNRATE | 2026-10-02 8:24 AM CDT | 17,369 | `185b90004b852d00bbeef97cbafaae553ec6f1c8513b5a07ad56ca00d7218588` |

The byte counts and hashes identify `table_text` in each wrapper. The CPI and GDP representation retains every observation and the table's metadata; its `included_source_line_ranges` records the retrieved web-reader lines. Narrative Notes are omitted from those two transports. The original series pages remain the source for their full notes.

## Import the three series into one project

Run these commands from the installed source directory `stellar/scf-starforge-20261009/sf30-seller-sdk/fred`. Keep the private project outside the installed package. The [macro selection](../examples/macro-selection.json) also supplies the original three series and full interval for a subsequent API acquisition using the host's configured FRED key.

```sh
node cli.mjs init --project /absolute/private/macro-project \
  --title "US macroeconomic editions" --selection examples/macro-selection.json
node cli.mjs import --project /absolute/private/macro-project \
  --id macro-cpi-source-20261012 --expected-revision 1 \
  --source sources/cpiaucsl-20261012.public-table.json
node cli.mjs import --project /absolute/private/macro-project \
  --id macro-gdp-source-20261012 --expected-revision 2 \
  --source sources/gdp-20261012.public-table.json
node cli.mjs import --project /absolute/private/macro-project \
  --id macro-unrate-source-20261012 --expected-revision 3 \
  --source sources/unrate-20261012.public-table.json
node cli.mjs serve --project /absolute/private/macro-project --port 0
```

A new project finishes these imports at revision 4 with three retained capture IDs. Each import reports its original capture ID and current revision. When using an existing project, read its current revision with `node cli.mjs show --project /absolute/private/macro-project` and use the actual revision for the next operation.

Open **Editions & review → Combine retained public tables**. Select the CPIAUCSL, GDP and UNRATE captures and choose **Create combined edition**. The resulting capture contains all 2,219 original observations under one retained source identity. Inspect it and save its review.

The same operation is available through the CLI. Use the three capture IDs returned by the original imports:

```sh
node cli.mjs combine --project /absolute/private/macro-project \
  --id macro-combined-20261012 --expected-revision 4 \
  --captures CPI_CAPTURE_SHA,GDP_CAPTURE_SHA,UNRATE_CAPTURE_SHA
```

The command returns the combined capture ID and revision 5. Subsequent reviews and publications use that current revision. When continuing an existing project, use its actual revision and saved operation IDs. You can also review and publish any of the original single-series captures independently. **Merchant** publishes a reviewed edition with the host's existing payment terms and facilitator. **Customer** prepares the exact published request and receives the original paid response. The [application guide](../README.md#publish-and-operate-the-merchant) covers merchant lifetime, native purchase, recovery, pagination and complete project receiving.

## Meaning of this starter

Public-table editions retain the UTC retrieval date in `as_of` and `PUBLIC_TABLE_RETRIEVAL_DATE` in `time_basis`. FRED API captures use the selected real-time period and `FRED_REALTIME_DATE`. Both modes preserve their own source metadata in the retained capture and published manifest.

This starter preserves monthly and quarterly records at their original observation dates. Source values remain their original strings; missing values remain `.` with `missing: true`. Any later calculation of inflation, growth or a common-frequency panel needs an explicit transformation with its own stated method and retained input edition.

To refresh, retain a new complete public-table wrapper or acquire the selected API vintage in the same application. Save a new capture and review. Compare successive captures with the same series and source mode to inspect original added dates, revised values and metadata changes. Exporting the project carries the original captures, reviews, edition plans and operation history together.

## Execution against the retained source

The unchanged application model from product commit `57f9bd5090a3025454b923df3a002b75dae7b5bd` parsed both new wrappers with `readPublicTable` and generated the customer CSV with `observationCsv`. All 956 CPI rows and 318 GDP rows were retained, including CPI's original missing observation. The resulting CPI CSV is 117,249 UTF-8 bytes, SHA-256 `e5183a52926fcb1dbec4b3c8b03d6ad345fbdc8893914566635a508fb108811a`; GDP is 42,418 UTF-8 bytes, SHA-256 `57c80f8f154e756ac0f205a438e0a4373020f7750ed9710aec8d3df8a9d4e994`.

The composed public-table model preserves all 2,219 original rows and the two original missing values in a 258,797-byte customer CSV. Monthly and quarterly observations retain their original dates and meanings. Its collection window is 2026-10-12T01:08:43.499Z through 2026-10-12T01:38:52.463Z; each series keeps its own complete source timestamp and table bytes. The manifest also identifies the original Notes-field coverage supplied by each transport.

The [application guide](../README.md) provides the complete source review, native merchant, customer delivery and project receiving workflow.
