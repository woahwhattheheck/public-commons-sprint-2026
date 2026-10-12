# Economic analyst briefings

Author, review, publish and deliver a complete report over retained FRED economic observations. The same project keeps the original source, exact selected comparisons, full offline HTML, CSV, report JSON and manifest. The merchant uses its existing native asset offers and configured Stellar buyer for paid delivery.

The [finished three-series report](examples/briefing-20261012/briefing.html) is ready to download and open offline. Its directory also contains the complete report data, measures, manifest, original 2,219-observation source capture and saved review. It was produced by this application's actual source/model/report functions from the retained official UNRATE, CPIAUCSL and GDP tables.

## Author in the existing workspace

Open the original economic Application or `starforge fred serve` session. Under **Editions & review**, select the retained capture. In **Review the customer edition**, enable **Include an analyst briefing**.

Choose a title, observation interval, decimal precision and original series. Each selected series has its own comparison methods and an explicit relative-percent option. Preview the complete selection; use the report's measure pages to inspect its original values, baseline dates, missing markers and calculation states. Source metadata and units remain visible beside the selection.

**Save reviewed edition** retains the analyst selection under the same source review. The **Analyst briefings** panel opens that original saved report, downloads its complete files, and loads an existing source/review/selection back into the editor. Saving the unchanged review reuses the original report identity. Changing the source, projection, note or briefing selection creates a different review.

In **Merchant**, select that saved review and the existing public origin/payment terms. The publication contains the original dataset and the complete report files. In **Customer**, select `briefing.html`, `briefing-measures.csv`, `briefing.json` or `briefing-manifest.json` from the advertised resources. Prepare the original stable intent, inspect its terms, buy through the configured native buyer and recover/download that same intent.

The downloaded HTML is a complete offline report. It has summary cards, source descriptions, exact comparison pages, local series/state filters, and downloads of the full report JSON and CSV. All report values and source notes travel inside the file.

## Source and calculation contract

The calculation uses the original source level values. It keeps every observation's series, date, literal value, missing marker, frequency, units, seasonal adjustment, information date and time basis. It does not resample observations or substitute a missing value.

| Selection | Exact baseline |
| --- | --- |
| Previous period: monthly | Same calendar day, one month earlier |
| Previous period: quarterly | Same calendar day, three months earlier |
| Previous period: semiannual / annual | Same calendar day, six / twelve months earlier |
| Previous period: daily / weekly / biweekly | One / seven / fourteen calendar days earlier |
| Year earlier | Same calendar day twelve months earlier; monthly, quarterly, semiannual or annual series |
| Previous observation | Immediately preceding original observation row, including a missing marker |

Baselines come from the same retained capture and may precede the displayed interval. A missing exact calendar date remains absent; a prior missing observation remains missing. Daily or irregular series can use **previous observation** to request that explicitly. Previous-period calendar comparisons retain holidays and other absent dates as absent baselines.

Absolute change is exact decimal subtraction. For a series whose original unit is **Percent**, this difference is labeled **Percentage points**. Other differences retain the original unit.

Relative percent change is separately selected and uses `100 × (current − baseline) / baseline`. The calculation uses integer decimal arithmetic, then rounds to the selected 0–12 decimal places using half-even rounding. The output retains whether rounding occurred. A zero denominator produces `ZERO_BASE` with no numeric relative result.

The [BLS percent-change guide](https://www.bls.gov/cpi/factsheets/calculating-percent-changes.htm) explains the same two-observation formula, matching months for twelve-month changes, and consistent index bases. The original [FRED observations API](https://fred.stlouisfed.org/docs/api/fred/series_observations.html) provides the source values and real-time fields used by API captures. Public table imports retain their actual table retrieval dates.

CPIAUCSL is an index series. Its absolute difference is in its original index units; its relative change is a percentage. GDP in the starter is nominal quarterly GDP in billions of dollars at a seasonally adjusted annual rate. The report keeps those original units; a quarter-to-quarter relative comparison is the direct ratio of those two published values. It does not annualize that growth rate or convert nominal values to real values.

| Measure state | Meaning |
| --- | --- |
| `READY` | Both original observations have supported numeric values |
| `SOURCE_MISSING` | The selected current observation has its original missing marker |
| `BASE_ABSENT` | The selected baseline row is outside or absent from the retained source |
| `BASE_MISSING` | The exact baseline has its original missing marker |
| `CALENDAR_DATE_ABSENT` | The selected earlier calendar date does not exist |
| `NUMERIC_LITERAL_UNSUPPORTED` | The original value cannot be interpreted by the supported decimal grammar |

Relative results additionally report `NOT_SELECTED`, `ZERO_BASE` or `SOURCE_UNAVAILABLE`. The complete CSV includes both the absolute and relative states.

A briefing selects 1–50 original series and 1–10,000 original observations. The complete source capture remains retained even when the reporting window selects fewer rows. A single native asset is limited to 16 MiB and the publication's combined asset budget is 64 MiB. All four briefing files must fit; the application gives a capacity error before advertising an incomplete report.

## Reproduce the finished original briefing

The supplied source is an actual complete native capture, including all three original public table texts, publisher metadata, original byte counts and SHA256s. Its native importer verifies those bytes.

These commands create a fresh operator project for the reusable published example. Set `FRED_ROOT` to the existing source directory and `FRED_PROJECT` to a new private project directory. In an existing project, use its current revision and retained operation IDs.

```sh
FRED_ROOT=/absolute/commons/stellar/scf-starforge-20261009/sf30-seller-sdk/fred
FRED_PROJECT=/absolute/private/economic-briefing

starforge fred init --project "$FRED_PROJECT" \
  --title "U.S. economic briefing" \
  --selection "$FRED_ROOT/examples/macro-selection.json"

starforge fred import --project "$FRED_PROJECT" \
  --id macro-original --expected-revision 1 \
  --source "$FRED_ROOT/examples/briefing-20261012/macro-source.capture.json"

starforge fred briefing-preview --project "$FRED_PROJECT" \
  --capture 4c7fc88552da69b9448054334bad10b72afee056ed93bcd2fb741d698dde042c \
  --briefing-file "$FRED_ROOT/examples/macro-briefing.json"

starforge fred review --project "$FRED_PROJECT" \
  --id macro-briefing-review --expected-revision 2 \
  --capture 4c7fc88552da69b9448054334bad10b72afee056ed93bcd2fb741d698dde042c \
  --note "$FRED_ROOT/examples/briefing-20261012/review-note.txt" \
  --briefing-file "$FRED_ROOT/examples/macro-briefing.json"

starforge fred briefing --project "$FRED_PROJECT" \
  --review af00af636c9397ac146966fed06588ef531594c65bc1ec289eada76b4af97802

starforge fred briefing-file --project "$FRED_PROJECT" \
  --review af00af636c9397ac146966fed06588ef531594c65bc1ec289eada76b4af97802 \
  --format html --out /absolute/delivery/economic-briefing.html
```

The source capture ID is `4c7fc88552da69b9448054334bad10b72afee056ed93bcd2fb741d698dde042c`. The supplied exact note and selection produce review `af00af636c9397ac146966fed06588ef531594c65bc1ec289eada76b4af97802` and report `fred-briefing-61435076ab2af2ad3314aba092e95cbfd38d3597dcddb6e1995623d331ef7245`.

For January 2024 through September 2026, the actual input yields 75 selected observations, 150 comparisons and 103 retained current/baseline observations. The report carries 144 available comparisons, four comparisons whose current value is missing, and two whose baseline value is missing. Both original missing source observations remain present.

| Complete file | Bytes | SHA256 |
| --- | ---: | --- |
| [briefing.html](examples/briefing-20261012/briefing.html) | 94,259 | `4f688eaec0bff842d86a92bcb8274224eb0ee39fc88c728b71d49ac827668a3d` |
| [briefing-measures.csv](examples/briefing-20261012/briefing-measures.csv) | 37,608 | `2a3b211b515fcfde9ca50141196dce6952c39c3497566eba1f7b990f6541c089` |
| [briefing.json](examples/briefing-20261012/briefing.json) | 79,423 | `3c2eb6d2f97879500aca97c56acf15773d354b1cf82014bd8f6cea78bdc63302` |
| [briefing-manifest.json](examples/briefing-20261012/briefing-manifest.json) | 1,178 | `0779e5c139a65f3f1d88a79c5843d9336d9ae7ceb572a9585704d742b3ac62c4` |

The original full tables are [UNRATE](https://fred.stlouisfed.org/data/UNRATE), [CPIAUCSL](https://fred.stlouisfed.org/data/CPIAUCSL) and [GDP](https://fred.stlouisfed.org/data/GDP). Their exact retrieved source inventory and public-table semantics are described in [MACRO_STARTER.md](sources/MACRO_STARTER.md).

## Publish and receive with the original merchant

Use the saved review in the existing publication form or native command. The complete public payment JSON selects the original network, asset, amount, recipient, scheme and timeout.

```sh
starforge fred publish --project "$FRED_PROJECT" \
  --id macro-briefing-publication --expected-revision 3 \
  --review af00af636c9397ac146966fed06588ef531594c65bc1ec289eada76b4af97802 \
  --origin https://your-existing-merchant.example \
  --payment /absolute/private/original-payment.json
```

Use the returned publication ID. Start the same private workspace with its original buyer configuration, facilitator and merchant port, then start the publication from the UI or installed client. The existing native seller serves the dataset and full report assets under the publication's immutable edition path. The original prepare/buy/recover commands accept each advertised briefing filename without a dataset query.

The merchant's published manifest includes the file sizes and SHA256s. Whole-file buyer preparation binds those exact values into the native response-file request. Customer recovery reads the same original intent and verifies the complete delivered bytes.

The original **SCF-FRED-UNRATE-RECEIVING-20261012** operation keeps its existing four source/page intents. Its saved source-only review remains a v1 edition. A briefing is a separate explicitly reviewed publication in that same continuing project.

## Installed client, CLI and agent

The existing private connection record and startup binding remain authoritative. [FRED.md](../../../../stellar-forge/mcp-merchant-operator/FRED.md) describes the installed connection and complete original merchant/customer workflow.

```sh
starforge fred-workspace briefing-preview \
  --connection /absolute/private/fred-connection.json --workspace macro \
  --capture 4c7fc88552da69b9448054334bad10b72afee056ed93bcd2fb741d698dde042c \
  --briefing-file "$FRED_ROOT/examples/macro-briefing.json"

starforge fred-workspace review \
  --connection /absolute/private/fred-connection.json --workspace macro \
  --id macro-briefing-review --revision 2 \
  --capture 4c7fc88552da69b9448054334bad10b72afee056ed93bcd2fb741d698dde042c \
  --note-file "$FRED_ROOT/examples/briefing-20261012/review-note.txt" \
  --briefing-file "$FRED_ROOT/examples/macro-briefing.json"

starforge fred-workspace briefing \
  --connection /absolute/private/fred-connection.json --workspace macro \
  --review af00af636c9397ac146966fed06588ef531594c65bc1ec289eada76b4af97802

starforge fred-workspace download \
  --connection /absolute/private/fred-connection.json --workspace macro \
  --kind briefing \
  --review af00af636c9397ac146966fed06588ef531594c65bc1ec289eada76b4af97802 \
  --format html --out /absolute/delivery/economic-briefing.html
```

The typed client methods are `previewBriefing({captureId, briefing, offset?})` and `briefing({reviewId, offset?})`. Existing `review` accepts the optional `briefing` selection. Existing `file`/`saveFredFile` accept `{kind:'briefing', reviewId, format:'html'|'csv'|'json'|'manifest'}`. A download first reads the saved original file descriptor, then requires the complete response to match its size and SHA256.

The FRED agent family now contains 30 tools. `merchant_fred_briefing_preview` returns original comparison pages. `merchant_fred_review` saves the optional selection. `merchant_fred_briefing` returns the saved report page and all four file descriptors. `merchant_fred_file_read` with kind `briefing` transfers the complete selected file through the maintained retained-read ID/chunk interface. The existing publication, payment, customer recovery and project export tools continue the same operation.

The pure calculation model and declarations are also exported as `./merchant/fred/briefing`. They accept the complete original FRED model and a source selection; all file/network/payment operations remain in the existing operator surfaces.

## Complete project handover

```sh
starforge fred export --project "$FRED_PROJECT" --out /absolute/delivery/economic-project.json
starforge fred receive --project /absolute/private/received-economic-project \
  --source /absolute/delivery/economic-project.json
starforge fred serve --project /absolute/private/received-economic-project \
  --connection-file /absolute/private/received-economic-startup.json
```

Source-only reviews, editions and project exports preserve their existing v1 identities. A saved analyst review adds its normalized selection to the original review identity. Analyst editions use `stellar-forge.fred-edition.v2`; project bundles containing briefings use `stellar-forge.fred-project-bundle.v2`.

The v2 bundle includes all original source captures and the complete four-file transfer for every analyst review, including unpublished reviews. Receiving validates the source, saved selection, exact calculation model, every file byte/hash and original native publication identity. It preserves the received HTML and CSV bytes. Reopening reads that retained package.

Briefing files are written through private temporary files, synced, linked into create-only destinations, then completed with the manifest last. Resuming the same original review finishes the same files; any differing existing bytes produce a conflict. Source and payment ownership remain with the original configured project and native buyer.

## Attribution

Every report carries the original source metadata and the application's FRED notice and [Terms of Use](https://fred.stlouisfed.org/docs/api/terms_of_use.html). Preserve the original publisher attribution and applicable source notices when distributing an edition. A saved report identifies its source capture, review, calculation version and full file manifest.
