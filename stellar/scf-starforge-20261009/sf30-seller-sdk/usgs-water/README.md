# USGS Water operations

A complete monitoring-data workflow for Stellar Forge: select an original USGS Water Data v1 query, retain every source page, compare observations, save an operational review, and publish a portable merchant edition through the existing Stellar payment and buyer stack.

The private browser workspace and CLI share the same saved project. Hydrology teams can reopen a decision with its exact input pages and calculations, then distribute that edition through native query, source-file, and edition routes. Merchant requests use the retained edition; acquisition is a separate operator action.

## Start the workspace

Use Node 22 or newer on Linux with the existing Stellar Forge dependencies and `flock`. From the repository root:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/cli.mjs serve \
  --project /absolute/private/water-project \
  --port 0
~~~

The installed package forwards the same operations through `starforge usgs-water`. For example, `starforge usgs-water serve --project /absolute/private/water-project --port 0` opens this workspace from the maintained distribution.

Open the returned loopback workspace URL. The operator can:

1. Save locations, parameter/statistic codes, collection, explicit source period, and page size.
2. Acquire original pages, inspect partial progress, cancel, and resume the original capture ID.
3. Select a capture, choose approval status and analysis/baseline periods, and compare a previous capture.
4. Save a review with its decision note and export the report, exact observations CSV, or GeoJSON.
5. Prepare an immutable edition, supply the existing public origin and payment terms, and start its merchant.
6. Prepare, execute, and reopen an original buyer intent when the workspace has an existing buyer configuration.

The interface uses a neutral industrial layout. Source pages, reported units, quality fields, and calculation details remain available beside the analysis. Changing a project form requires saving the selection before another acquisition.

The workspace binds to loopback and keeps its project private. An absolute real directory is required. Use the original merchant's HTTPS reverse proxy and payment configuration for public delivery.

## Equivalent CLI workflow

Example inputs are in `examples/`. The sample selection is the original daily discharge series at USGS-01646500 for October 1–7, 2026, with two records per response page.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/cli.mjs init \
  --project /absolute/private/water-project \
  --title "Potomac daily operations" \
  --selection stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/examples/daily-selection.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/cli.mjs capture \
  --project /absolute/private/water-project \
  --id potomac-20261001-07 \
  --expected-revision 1

node stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/cli.mjs review \
  --project /absolute/private/water-project \
  --capture potomac-20261001-07 \
  --id discharge-review-1 \
  --options stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/examples/period-comparison.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/cli.mjs export \
  --project /absolute/private/water-project \
  --review discharge-review-1 \
  --format html \
  --out /absolute/private/discharge-review.html

node stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/cli.mjs edition \
  --project /absolute/private/water-project \
  --review discharge-review-1 \
  --id discharge-edition-1
~~~

`capture` with the same ID and saved selection resumes its original pending page. A completed capture reopens without another USGS request. A new source selection has a new project revision and requires a new capture ID.

Run `cli.mjs help` for configuration, capture/review/edition listing, merchant staging/status, and customer operations. JSON output goes to stdout unless `--out` selects a new file. Existing output files are preserved.

## Scientific interpretation

The analysis groups observations by collection, location, time series, parameter, statistic, original unit, and method category. It calculates count, minimum, maximum, mean, and median within each selected group and period. A baseline comparison reports the change between the selected periods. Capture comparison identifies added, removed, changed, and unresolved conflicting features using original identities.

Measurements remain their original strings. Decimal arithmetic uses integer coefficients and scales; means and even-count medians retain an exact fraction alongside a display value. Daily observations retain local calendar dates. Continuous timestamps retain their full original offset and fractional precision and are ordered by their instant.

Absent values, nulls, text, non-finite measurements, duplicate features, conflicting versions, approval status, and qualifiers remain visible. Missing or conflicting observations are reported separately from the arithmetic. Charts show the original numeric observations and leave unobserved intervals empty. A saved review stores its options, source identities, calculations, comparison, and note.

The observation CSV and GeoJSON preserve source provenance and original values. The report includes capture status, selected ranges, numeric and missing counts, conflicts, and source links.

## Native merchant and customer

[MERCHANT.md](./MERCHANT.md) documents the complete application API, public payment terms, query syntax, edition portability, and original customer operation.

The edition packages all retained request/response members, original GeoJSON bytes, normalized features, the typed SF30 CSV dataset, saved analysis, and review. The native dataset snapshot and edition identity bind the delivered content. Moving an edition preserves the relative source closure.

Staging uses original SF61 offer compilation and service bindings. Ordinary startup/resume uses original SF82 lifecycle and readback. Delivery uses original SF30 admission and handlers. Customer execution and reopening use the original SF88 Node Buyer and retained result bytes.

The three routes under the edition's content-derived path are:

| Route | Delivered content |
| --- | --- |
| `observations` | A native dataset page with the fixed snapshot, selected fields, filters, ranges, and cursor |
| `source?file=...` | The exact bytes of an explicitly listed source page or analysis file |
| `edition` | The immutable edition manifest |

A dataset page is one native purchase. Original dataset admission validates the requested selection before payment. Supply the accepted atomic amount, network, asset, receiving address, and timeout from the operator's existing configuration.

To enable customer actions in the workspace, pass `--buyer-config /absolute/private/buyer.json`. Its contents are the original Node Buyer constructor options, including `runtimeDirectory`, `stateDirectory`, and `operatorProfile`. Private operator material stays in the original buyer runtime.

## Source acquisition and migration

[PROVIDER.md](./PROVIDER.md) documents supported original filters, exact request construction, transport, optional API-key environment selection, source quality fields, pagination, retained members, and interrupted acquisition.

The provider uses the official [USGS OGC API v1](https://api.waterdata.usgs.gov/docs/ogcapi/), including daily, continuous, monitoring-locations, and time-series-metadata collections. Arrays become separate original requests and each request follows the provider's own next links.

The [USGS migration guide](https://api.waterdata.usgs.gov/docs/ogcapi/migration/) supports replacing older integrations with these collections. The [October 2, 2026 announcement](https://waterdata.usgs.gov/blog/api-observations-decom/) retires the experimental Observations API on October 19, 2026. That specific deadline applies to the experimental service. This product offers a concrete migration and operational-delivery service: retain original data, recover interrupted work, make the review reproducible, and deliver selected editions to existing customers.

## Native operation

The maintained [complete journey](./JOURNEY.md) exercises the original source, project, merchant, and buyer implementations together. The bundled [source responses](./examples/usgs-20261001-07.source.json) and [portable capture](./examples/usgs-20261001-07.capture.tar.gz) contain the actual October 11, 2026 USGS acquisition.

The completed run retained four original response pages and seven observations, delivered four native dataset pages plus a source file and edition manifest, and reopened all six original buyer results after the authoring capture moved. Reopening added zero merchant requests or local fixture settlements. The original local commerce fixture preserves the native buyer outcome and verified delivery state. See the journey guide for the exact runnable command and runtime configuration.

## Source map

| Module | Responsibility |
| --- | --- |
| `provider.mjs` | Native selection, original paginated capture, exact response retention, resume, and normalized provenance |
| `analysis.mjs` | Exact decimal summaries, period and capture comparisons, exports, and reports |
| `project.mjs` | Saved revisions, acquisition lifecycle, review decisions, and edition composition |
| `merchant.mjs` | Native dataset/asset edition, SF61/SF82 merchant, and original SF88 purchase/reopen |
| `workspace.mjs` | Private browser API and owned process lifecycle |
| `ui/` | Industrial monitoring workspace |
| `cli.mjs` | Command-line access to the same project and customer flow |

The runtime source is additive under the existing SF30 seller SDK and composes the maintained project primitives. Source-specific details are isolated from the original payment, seller, and buyer implementations.
