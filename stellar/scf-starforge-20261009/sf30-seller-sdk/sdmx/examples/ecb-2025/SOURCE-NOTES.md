# Retained ECB exchange-rate source edition

These original public responses were retrieved on 12 October 2026. `sources.json`
binds each file to its actual request, response status, retrieval time, media type,
byte length and SHA-256. Adjacent receipts retain the returned HTTP headers. The
statistics and metadata files preserve their original bytes.

## Open the source

Use the current SDMX workspace's original source-intake operation with
`ecb-exr-dataflow.xml` for the complete maintained EXR structure and codelists.
`ecb-dataflows.xml` supplies the separate catalogue of 105 actual ECB flows.
`ecb-exr-dsd.xml` and `ecb-frequency-codelist.xml` retain the standalone maintained
structure and frequency vocabulary. Their identities are:

|Object|Agency|ID|Version|
|---|---|---|---|
|Dataflow|ECB|EXR|1.0|
|Data structure|ECB|ECB_EXR1|1.0|
|Frequency codelist|ECB|CL_FREQ|1.0|

The dataflow references the data structure. Its ordered series dimensions are
`FREQ`, `CURRENCY`, `CURRENCY_DENOM`, `EXR_TYPE`, `EXR_SUFFIX`; `TIME_PERIOD` is
the separate observation dimension. The complete flow response contains all
11 referenced codelists. Original names, descriptions, assignments and maintained
attributes remain in that response.

The full observation selection is:

```
https://data-api.ecb.europa.eu/service/data/ECB,EXR,1.0/A+D+M+Q.GBP+USD.EUR.SP00.A?startPeriod=2025-01-01&endPeriod=2025-12-31&detail=full
```

The three equivalent current responses differ only in HTTP `Accept`:

|File|Accept|
|---|---|
|ecb-exr-2025-generic.xml|application/vnd.sdmx.genericdata+xml;version=2.1|
|ecb-exr-2025-specific.xml|application/vnd.sdmx.structurespecificdata+xml;version=2.1|
|ecb-exr-2025.csv|text/csv|

Retain `metadata.origin` from the corresponding receipt. The parsed coverage
selection is an object, and each query value is an array. Completeness is
`selected_response`, with the exact 2025 start/end bounds; this describes the
requested selection. The delivered file is usable offline through the workspace's
existing source upload. `capture_ecb.py verify` checks this retained byte identity;
`capture_ecb.py capture /absolute/new-source-edition` creates a separate online
capture with its own receipts and leaves this edition intact.

## Observation and metadata semantics

There are eight series and 544 observations: GBP and USD against EUR, each with
one annual value, 255 daily values, 12 monthly values and four quarterly values.
The daily range is 2 January through 31 December 2025. The original frequency
labels and time formats are retained; this product does not resample daily data
to manufacture annual, monthly or quarterly observations.

Values are exact strings. For example, the annual GBP value is
`0.8567923137255` and the annual USD value is `1.1299831372549`. Their `DECIMALS`
metadata is respectively `5` and `4`; it is a source attribute, not an instruction
to round the stored value. The source attributes include `OBS_STATUS=A`,
`OBS_CONF=F`, `SOURCE_AGENCY=4F0` (European Central Bank), the exact unit and title,
and the original collection and time-format fields.

The actual CSV has 32 columns. Every row's original fields match the corresponding
GenericXML values and attributes when an absent XML field is compared with the
empty CSV cell. Both raw representations remain retained, so an empty source cell
and an absent XML component can still be inspected separately. StructureSpecific
series combine dimensions and attributes on their XML elements; resolve them
through the maintained DSD. Its DataSet control attributes use the SDMX
`data/structurespecific` namespace. Both XML responses identify the DSD through
the original Header URN, not a nested `Ref` element.

The official frequency codelist also distinguishes business-day `B` from daily
`D`, and retains both half-yearly `H` and semester `S` codes. The selected source
uses A/D/M/Q only. A `2025-S1` observation under an H or S series denotes the
first half of that year; these original frequency identities remain distinct.

## Retained response editions

`ecb-exr-selected-series.xml` is the actual `detail=nodata` response. It contains
the selected series metadata and no observation values. It is a metadata source,
not a new empty observation replacement.

`ecb-exr-2025-history.xml` is the actual `includeHistory=true` response. Its eight
series and 544 parsed observations equal the current response. Header IDs,
Prepared timestamps and DataSet validFromDate differ because the responses were
prepared at different times. These transport changes are retained as provenance
and do not establish a statistical revision. The history query remains recorded
as its own source selection.

The query with `updatedAfter=2026-10-12T00:06:34.064938Z` returned HTTP **404** and
`application/problem+json`; its 810-byte body is retained as
`ecb-exr-2025-after-capture.xml` under the original capture name. Its receipt and
manifest identify the actual JSON media type and unsuccessful HTTP status.
Import data only from successful SDMX responses. This response describes no
series returned for this exact update query; a general 404 can have other causes.
Keep the prior complete selection, and inspect the original response. The later
independent full/history captures provide the recorded unchanged-observation
comparison for this example.

## Attribution and use

Source: **European Central Bank (ECB)**. The [ECB statistics usage policy](https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html)
allows free commercial and noncommercial reuse of ECB statistics with source
attribution and unchanged statistics, including metadata. Third-party data may
need its originator's permission. Availability and subsequent revisions remain
subject to the provider's policy. This bundle retains the policy URL, retrieval
receipt and captured-page hash; the full policy page stays in the research record.

The [ECB reference-rate page](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)
describes these rates as information/reference data and discourages their use for
transactions. Preserve that purpose in customer-facing dataset terms. The
merchant configuration prices the selected software/data-delivery service; its
operator supplies the exact public terms and attribution through the original
seller workflow.

Official API contract: [overview](https://data.ecb.europa.eu/help/api/overview),
[data queries](https://data.ecb.europa.eu/help/api/data),
[metadata](https://data.ecb.europa.eu/help/api/metadata), and
[content negotiation](https://data.ecb.europa.eu/help/api/content-negotiation).

