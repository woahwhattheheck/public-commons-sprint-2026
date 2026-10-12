# Economic editions

Build a retained economic data product from the official FRED API, review revisions across vintages, publish the reviewed observations through the maintained Stellar Forge merchant, and receive the same edition through the original customer.

The private operator application includes source selection and acquisition, source import, observation inspection, saved reviews, exact vintage comparisons, merchant publication and lifetime, native customer preparation and delivery recovery, and portable project receiving. The installed command is `starforge fred`; the source entrypoint is `node stellar/scf-starforge-20261009/sf30-seller-sdk/fred/cli.mjs`.


This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.

By using this application, users agree to the [FRED API Terms of Use](https://fred.stlouisfed.org/docs/api/terms_of_use.html). The source metadata and original responses retain the series notes, including source copyright notices. A series owner's reuse conditions continue to apply to publication; FRED access does not grant a third party's redistribution rights. Review the retained notes and original series page for each series you publish. The edition manifest carries the API notice and terms link with the source attribution.

## Start one project

Use Linux, Node 24 and the existing util-linux `flock` command. Keep project and customer state outside the installed package. Create a selection JSON using the supplied [selection example](examples/selection.json), with the original series IDs and observation interval you need.

```sh
starforge fred init --project /absolute/private/economic-project \
  --title "Economic research" --selection /absolute/selection.json
starforge fred serve --project /absolute/private/economic-project --port 0
```

Open the private URL printed by the command. It belongs to that running session. The operator interface has five sections: Source, Editions & review, Merchant, Customer, and History & handover. The original source remains available after stopping and reopening the same project.

Source acquisition uses the operator’s existing FRED API key through the `FRED_API_KEY` process environment variable. Choose a different reference with `init --api-key-env NAME`. The project retains that variable name; the value is inserted only into the request sent to the official API. Source receipts retain a key-free request descriptor. Imported captures, reviews, comparisons, publication, source exports and project receiving work from the retained bytes.

FRED’s API documentation specifies an API key for requests and a user’s own key for an application. See the original [API key contract](https://fred.stlouisfed.org/docs/api/api_key.html). Existing configured environments can supply the key without a new account or application setup.


## Use the retained UNRATE source

The repository includes the complete [official UNRATE public-table source](sources/unrate-20261012.public-table.json), retrieved from [FRED's published table](https://fred.stlouisfed.org/data/UNRATE) on 2026-10-12 at 01:08:43.499 UTC. Its 945 observations cover January 1948 through September 2026. The original publisher is the U.S. Bureau of Labor Statistics; values are monthly, seasonally adjusted percentages. The source's update label is retained verbatim. Its original missing marker at 2025-10-01 remains a missing observation.

The retained table text contains 17,369 UTF-8 bytes with SHA-256 `185b90004b852d00bbeef97cbafaae553ec6f1c8513b5a07ad56ca00d7218588`. The source file includes every original row and metadata line. Its wrapper records the actual retrieval timestamp, source URL, count, byte count and table digest.

Start this concrete economic project from the source directory:

```sh
node cli.mjs init --project /absolute/private/unrate-project \
  --title "UNRATE economic edition" --selection examples/unrate-selection.json
node cli.mjs import --project /absolute/private/unrate-project \
  --id unrate-source-20261012 --expected-revision 1 \
  --source sources/unrate-20261012.public-table.json
node cli.mjs serve --project /absolute/private/unrate-project --port 0
```

The import returns the original capture ID and revision 2. Open **Editions & review** to inspect all 945 rows, retain the review and publish it with your configured merchant payment terms. This source can immediately supply the native customer operation, project export and receiving flow below.

A public-table import uses `commons.retained-public-table.v1`; `source.mjs` exports `sealFredPublicTable` to convert that complete original transport into `stellar-forge.fred-public-table-capture.v1`. The parser verifies the exact official source URL, original metadata, full date range, complete row count, date order, original strings and source digest. Both source formats enter the same retained project and merchant workflow.

The public table's `as_of` column records the UTC retrieval date, with `time_basis=PUBLIC_TABLE_RETRIEVAL_DATE`. API editions use `time_basis=FRED_REALTIME_DATE` and retain their original real-time interval fields. Public-table real-time interval cells are empty because the page publishes a current snapshot. The edition manifest and browser series detail carry this distinction, the complete retrieval timestamp and original publisher metadata. A comparison of successive complete public tables includes newly published observation dates; API comparisons retain their explicitly selected interval.


## Combine retained economic tables

Import each complete original public table into the same project, then use **Editions & review → Combine retained public tables**. Select one retained capture for each series and choose **Create combined edition**. The resulting capture enters the existing review, comparison, publication, original customer and project handover workflow.

For example, UNRATE, CPIAUCSL and GDP keep their original series rows in one long-form dataset. Monthly unemployment percentages, monthly price indexes and quarterly GDP values retain their own units, seasonal adjustment and frequency. Each original date/value pair remains in its series; the combined edition introduces no interpolated periods, resampling or cross-series arithmetic. Customers use the original `series` filter and observation-date ranges.

The CLI uses the same retained sources and revision:

```sh
starforge fred combine --project /absolute/private/economic-project \
  --id macro-edition-20261012 --expected-revision CURRENT_REVISION \
  --captures UNRATE_CAPTURE_SHA,CPI_CAPTURE_SHA,GDP_CAPTURE_SHA
```

The result returns its new capture ID, original source capture IDs and project revision. Choose one original edition for each series; duplicate series selections return their actual conflict for correction. A combined capture can also supply a later composition when its series do not overlap the other selected captures.

Programmatic receiving accepts `{version: "commons.retained-public-table-set.v1", tables: [originalTable, ...]}` through `importFredCapture`, or calls `sealFredPublicTables` directly. A complete set may contain up to fifty distinct series and one million original observations within the 64 MiB capture allowance. Its tables are ordered by original series ID for a stable source identity.

Each customer row keeps that series' own public-table retrieval date. The manifest retains each original full retrieval timestamp plus a collection window; the edition's summary date is the latest collection date. The original source JSON contains every table's text and digest. The complete project export and receiving operation carry the combined edition and its selected original captures together.

## Select the source and vintage

The source selection has this format:

```json
{
  "schema": "stellar-forge.fred-selection.v1",
  "series": ["CPILFESL", "GDP", "UNRATE"],
  "asOf": "2025-01-31",
  "start": "2020-01-01",
  "end": "2024-12-31",
  "pageSize": 1000,
  "maxRows": 1000000
}
```

`asOf` is the information vintage; `start` and `end` select observation dates. They answer different questions. The original FRED real-time period describes when information was known, including later revisions to values and metadata. This application sets both real-time boundaries to the one selected `asOf` date. The original [real-time period documentation](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html) explains that contract.

The acquisition uses the original [`fred/series`](https://fred.stlouisfed.org/docs/api/fred/series.html) metadata and [`fred/series/observations`](https://fred.stlouisfed.org/docs/api/fred/series_observations.html) responses. It requests JSON, ascending observation dates, original level values (`units=lin`) and real-time-period output (`output_type=1`). Frequency aggregation is left unset. Each series keeps its source frequency, units, seasonal adjustment, update time and notes.

Changing the selected vintage creates another source capture. Existing captures, reviews, merchant editions and customer requests remain bound to their own original selection.

## Acquire, import and resume

In the browser, save the source settings, then choose **Acquire selected source**. The application stores every completed original response before moving to the next page. State remains readable during acquisition; use **Refresh state** to see the saved phase. The same operation resumes retained pages after an interruption.

Equivalent command:

```sh
starforge fred capture --project /absolute/private/economic-project \
  --id economic-january-capture --expected-revision 1
starforge fred show --project /absolute/private/economic-project
```

Use the actual revision shown by `show`. Repeat the original capture ID and expected revision to resume its pending operation. A completed operation returns its retained result; it does not acquire another edition. A fresh source observation uses a new operation ID.

HTTP 429 retains the provider’s retry time with the pending acquisition. Continue the same operation when that time arrives. An interrupted request, invalid source response, count change or overlapping date leaves the original completed pages available. To change an unsuccessful selection, use **Abandon pending action and retain its files**, then save the corrected selection. This is a project mutation action; native customer attempts continue through their original buyer recovery.

Import an already completed capture using **Import retained source** or:

```sh
starforge fred import --project /absolute/private/economic-project \
  --id import-original-capture --expected-revision 1 --source /absolute/capture.json
```

The import verifies every original response digest, its key-free request, the selection, metadata, pagination, dates and complete source inventory. A capture carries `stellar-forge.fred-capture.v1`, the normalized selection, original response records and its content identity. `source.mjs` exports `sealFredCapture`, `validateCapture` and `storeFredCapture` for trusted integrations retaining actual source responses.

The source supports 1–50 distinct series, 1–100,000 observations per API page, and a selected combined capacity up to one million rows. Each source response is limited to 8 MiB and a capture to 64 MiB. The original completed capture stays fixed when a later provider result changes.

## Inspect and review the observations

**Editions & review** shows each selected series’ identity and meaning beside its observations. The table pages through original source records and can select one series. Download the complete original capture from this section.

Every numeric value remains the original FRED string, including its decimal precision. The source’s `.` marker remains `value: "."`, accompanied by `missing: true`. It does not become zero, an interpolated value or a row omission.

The customer projection always retains these columns together:

| Column | Meaning |
| --- | --- |
| `series` | Original FRED series ID |
| `date` | Original observation date |
| `value` | Original numeric string or missing marker |
| `missing` | Whether the original value is `.` |
| `as_of` | API information vintage or UTC public-table retrieval date, identified by `time_basis` |
| `time_basis` | `FRED_REALTIME_DATE` for the API, `PUBLIC_TABLE_RETRIEVAL_DATE` for the published table |
| `units` | Source units |
| `frequency` | Original source frequency |
| `seasonal_adjustment` | Original source adjustment |

`realtime_start` and `realtime_end` can also be exposed. The original dataset controls selected fields, equality filters, date ranges, sorting, page size and snapshot-bound continuation. The default policy is in [projection.json](examples/projection.json). Exact numeric strings are kept out of numeric range/sort controls; the date and series fields provide chronological and identity ordering.

Add a review note and choose **Save reviewed edition**. The saved review contains the original capture ID, complete projection policy and note. Its identity is stable, and repeated completion of the same operation reuses that review.

```sh
starforge fred review --project /absolute/private/economic-project \
  --id review-january --expected-revision 2 --capture CAPTURE_SHA \
  --policy /absolute/projection.json --note /absolute/review-note.txt
```

## Compare retained vintages

Select two captures with the same series and source mode. API captures also retain the same observation interval. The comparison identifies added dates, removed dates, revised values, changes to missing values and changes to the series’ meaning. Titles, units, frequency, seasonal adjustment, coverage, update time and notes have their own metadata comparison.

An exact decimal difference is available when both original values are numeric and their units, frequency and adjustment match. It uses integer decimal arithmetic, preserving precision. A meaning change carries its original field differences and keeps its values directly inspectable. Each row remains attached to its original series and observation date.

```sh
starforge fred compare --project /absolute/private/economic-project \
  --before ORIGINAL_CAPTURE_SHA --after FOLLOWING_CAPTURE_SHA \
  --out /absolute/delivery/vintage-comparison.json
```

The browser paginates comparison rows and offers the unchanged complete report as a download.

## Publish and operate the merchant

In **Merchant**, select the saved review, merchant public HTTPS origin and original public payment terms. The `payment` object uses the existing SF30 fields: `scheme`, `network`, `asset`, `amount`, `payTo`, and `maxTimeoutSeconds`.

```sh
starforge fred publish --project /absolute/private/economic-project \
  --id publish-january --expected-revision 3 --review REVIEW_SHA \
  --origin https://your-merchant.example --path /economic-data \
  --payment /absolute/private/public-payment-terms.json
```

The immutable publication contains the original capture, customer CSV, native dataset configuration, saved review, edition manifest, original seller configuration and offers. Each edition receives its own public path and snapshot. The paid observation route runs through the original version store and SF30 native lifecycle. Customer requests retain their explicit edition snapshot, and every page uses the original payment and receipt path.

**Start original seller** opens the selected publication. The existing seller supplies its developer page, offers and OpenAPI. Its original listener binds to loopback; use the merchant’s existing HTTPS routing for its declared public origin. With a configured facilitator, the original native factory supplies verification and settlement:

```sh
starforge fred serve --project /absolute/private/economic-project --port 0 \
  --facilitator https://your-existing-facilitator.example
```

Alternatively, run just the original merchant:

```sh
starforge fred merchant --project /absolute/private/economic-project \
  --publication PUBLICATION_SHA --port 0 \
  --facilitator https://your-existing-facilitator.example
```

Omitting the facilitator opens the original challenge-only seller for its offer and developer interface. A configured local HTTP facilitator requires `--allow-local-facilitator`. The native packages and payment authority are the maintained toolkit’s existing runtime.

The publication exposes the edition manifest and any complete capture/CSV that fits the original asset response limits. The actual available source-file choices are listed beside the merchant and in the customer selector. Larger originals remain in the complete project handover, while the original dataset still serves its paginated customer rows.

**Stop and retain seller** drains the existing native service and closes the same version store. Restarting reopens that store with its initialized settings and original snapshot. Another publication can then be selected and started. Source acquisition and source reviews use their retained private project; public requests never receive the project control capability.

## Prepare and receive through the original buyer

Supply the receiving host’s existing private `Buyer` constructor configuration with `serve --buyer-config FILE`. It names the original `runtimeDirectory`, private `stateDirectory`, and original `operatorProfile` or other supported native runtime settings. The package’s [Node buyer](../../sf88-operator-buyer-cli/node/README.md) and [operator setup](../../sf88-operator-buyer-cli/README.md) retain their normal host configuration.

In **Customer**, select the publication, observation query or advertised source file, stable intent and payment alternative. **Prepare this request** writes the original SF88 request with the exact saved offer and expected terms. **Review and execute original purchase** invokes the configured original buyer. Its approval happens in the launch terminal.

```sh
starforge fred prepare --project /absolute/private/economic-project \
  --publication PUBLICATION_SHA --intent economic-customer-page-1 \
  --query 'where_series=GDP&gte_date=2023-01-01&limit=25' --accept 0
starforge fred buy --project /absolute/private/economic-project \
  --publication PUBLICATION_SHA --intent economic-customer-page-1 \
  --buyer-config /absolute/private/buyer-host.json
```

The original buyer owns its private configuration, approval, financial attempt and saved response. The economic binding retains its capture, edition, snapshot, offer plan and original request. An interrupted callback or repeated execution reads the same attempt and result. An already recorded attempt is recovered through the original buyer.

```sh
starforge fred recover --project /absolute/private/economic-project \
  --publication PUBLICATION_SHA --intent economic-customer-page-1 \
  --buyer-config /absolute/private/buyer-host.json
starforge fred delivery --project /absolute/private/economic-project \
  --publication PUBLICATION_SHA --intent economic-customer-page-1 \
  --buyer-config /absolute/private/buyer-host.json --out /absolute/delivery/page-1.json
```

The original dataset receiver inspects the returned snapshot, query and cursor. **Prepare next page selection** carries its original metadata and cursor forward with a new intent for the next paid page. The CLI’s `--previous FILE` accepts that preceding metadata object. Whole-file deliveries verify the original advertised byte count, content type and digest before exposing the saved result.

## Export and reopen the project

Use **Export complete project** after completing or abandoning a pending project action. The bundle retains the project identity and revision, exact source responses, reviews, operation history and original public merchant plans.

```sh
starforge fred export --project /absolute/private/economic-project \
  --out /absolute/delivery/economic-project.json
starforge fred receive --project /absolute/private/received-economics \
  --source /absolute/delivery/economic-project.json
starforge fred serve --project /absolute/private/received-economics --port 0
```

Receiving reconstructs the exact immutable data and merchant files from their original capture, review and terms, then verifies the original edition and native dataset snapshot. Repeating receipt of the same bundle returns the retained receipt. The receiving host keeps its own existing buyer configuration and process environment. Customer financial attempts remain in their original buyer state directory.

Every project mutation supplies the revision the operator reviewed. A concurrent change is surfaced with the current project available for a fresh decision. Source captures and published editions are content addressed; completed operation IDs retain their original result. Exports use exclusive file creation.

## Public module interfaces

| Export | Main interfaces |
| --- | --- |
| `./seller/fred/model` | `normalizeSelection`, `inspectCapture`, `projectionPolicy`, `compareCaptures`, `exactDifference` |
| `./seller/fred/source` | `captureFred`, `sealFredCapture`, `sealFredPublicTable`, `sealFredPublicTables`, `validateCapture`, `readFredCapture` |
| `./seller/fred/project` | Project initialization, source capture/import, review, publication, export and receiving |
| `./seller/fred` | Immutable editions, original merchant, customer preparation, execution, recovery and delivery export |
| `./seller/fred/workspace` | `startFredWorkspace` |

All return values use the retained original source and application identities. `source.mjs` accepts an explicit transport for existing host integration; ordinary acquisition uses `fetch` against the fixed official FRED origin. The original source URLs are retained beside every response.
