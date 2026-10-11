# Amberdata operator and customer handoff

This guide follows the original application from selected source to a saved
research result and an exported merchant workspace. The existing Python workspace,
SF30 provider binding, SF82 release manager and SF88 buyer remain the executing
components. All paths below are operator-selected examples.

## Establish the selected product

The retained `application/product.json` is the customer selection contract. Keep
its exact copy with the original generated SDK and original discovery listing.
`selectionSha256` covers provider, time window, units and execution limits. The
SDK and original offer retain the payable origin, operation, amount, network,
asset and recipient. Inspect both sets of fields before an accepted release.

| Input | Required decision or original source |
| --- | --- |
| Public origin | The actual canonical HTTPS origin for this merchant release |
| API version and response shape | The version available to the provider account; actual array or legacy instrument-map response |
| Exchange and instrument | One exact provider selection; these are not arbitrary customer query parameters |
| Time window | Explicit UTC start inclusive and end exclusive, plus minutes/hours/days |
| Units | Actual base, quote and volume units, with base-volume or contract-volume classification |
| Daily boundary | The selected exchange's UTC candle boundary, recorded in minutes from midnight |
| Provider access | The account's existing entitled API/data access and operator's private credential |
| Native execution | Existing supported facilitator, payer/signer/operator setup and original budget journal |
| Data handoff | Exact original provider bodies or Parquet/decoder files, source URL and original hashes |

The plan compiler accepts the following bounds. Choose the useful limits for the
product's actual data selection; the original byte and row checks apply at
execution and customer preparation.

| Setting | Supported bound |
| --- | --- |
| REST window | More than zero and no more than 731 days |
| `limits.maxResponseBytes` | 1,024–262,144 UTF-8 bytes per provider body |
| `limits.maxInputBytes` | 1,024–524,288 bytes for the complete research request |
| `limits.maxRows` | 1–2,000 selected source rows |
| `limits.maxPages` | 1–16 original REST pages |
| `limits.timeoutMs` | 100–20,000 milliseconds per original provider call |
| `limits.continuationTtlSeconds` | 60–86,400 seconds |
| `workerCount` | 1–8 original Python workers |

The native generated request builder retains its 2,048-character complete URL
limit. An unusable provider continuation must remain visible as an unavailable
token with its reason; it is not a terminal-page assertion. Increasing a product
body limit cannot bypass an original transport or request-input limit.

## Keep two source formats explicit

### REST pages

The two public GET functions return `stellar-forge.amberdata-page.v1`. The envelope
retains `operation`, `selectionSha256`, selected provider/window/units,
`request.pageIndex`, `request.cursor`, `request.previousBodySha256`, exact UTF-8
`body`, `bodySha256`, `bodyBytes`, `nativeUpstream`, interpretation state and
continuation state. Preserve the whole envelope, including the body text.

Interpretation is either `ready` or `unavailable`, with the original product
error when unavailable. A valid saved response can still contain an unavailable
interpretation. Inspect its retained bytes and selected version; do not replace a
saved provider result with a reformatted body or another request merely to read it.

`continuation: null` means no continuation envelope was produced. A continuation
object can contain a string token, or a null token with `unavailableReason`.
`pageLimitReached` states the selected product's page limit. Customer preparation
requires an actual string token and preserves the next native operation's
explicit intent and review. It neither decodes a token into an arbitrary provider
URL nor follows the provider's `metadata.next` directly.

Supply `{"pages":[PAGE_0,PAGE_1]}` to the summary, with each complete saved
envelope in original order. The contract checks the provider version, original
cursor chain, prior body identity, window, candle alignment and actual OHLCV.
A first page with additional provider pages can still produce a useful partial
summary. Its `pageChainComplete` remains false.

### CloudSync Parquet and decoded rows

The supported research source object is:

```json
{
  "cloudsync": {
    "schema": "stellar-forge.amberdata-cloudsync.v1",
    "original": {
      "url": "https://original-provider-source.example/original.parquet",
      "format": "parquet",
      "sha256": "ACTUAL_ORIGINAL_PARQUET_SHA256",
      "bytes": 12345
    },
    "decoder": {
      "name": "duckdb",
      "version": "ACTUAL_DECODER_VERSION",
      "numberFormat": "binary64-roundtrip-json",
      "originalRowsSha256": "ACTUAL_DECODED_FILE_SHA256",
      "originalRowsBytes": 45678
    },
    "interval": "minutes",
    "rowsBody": "EXACT_COMPACT_DECODED_JSON_TEXT",
    "rowsSha256": "ACTUAL_COMPACT_TEXT_SHA256"
  }
}
```

The displayed values are a field map, not an executable data fixture. Build the
actual input using the original acquired Parquet and its retained decoder JSON.
The source producer preserves all 13 source columns and the original JSON number
tokens. Its lexical compaction removes insignificant whitespace outside strings;
it does not parse and reserialize prices through a different floating-point
representation. The original Parquet digest/size, decoder identity and
pre-compaction decoded-file digest/size remain in the prepared input.

```sh
python3 "$AMBERDATA_EXAMPLE/source-input.py" \
  --plan /private/amberdata-installation/application/product.json \
  --rows /private/provider/minutes.decoded.json \
  --original /private/provider/minutes.parquet \
  --source-url "$ORIGINAL_MINUTES_SOURCE_URL" \
  --interval minutes --decoder duckdb --decoder-version "$ACTUAL_DECODER_VERSION" \
  --out /private/provider/minutes.research-input.json
```

Use the exact selected source URL and actual decoder version. Keep the original
Parquet and decoded JSON alongside the prepared input. Decoder installation and
data acquisition remain the existing provider/runtime workflow; the producer
does not buy data or download a new engine.

For comparisons, first prepare the original hourly/daily inputs in the same way,
with their corresponding source files, URLs and intervals. Then add their prepared
input files when creating the selected main input:

```sh
python3 "$AMBERDATA_EXAMPLE/source-input.py" \
  --plan /private/amberdata-installation/application/product.json \
  --rows /private/provider/minutes.decoded.json \
  --original /private/provider/minutes.parquet \
  --source-url "$ORIGINAL_MINUTES_SOURCE_URL" \
  --interval minutes --decoder duckdb --decoder-version "$ACTUAL_DECODER_VERSION" \
  --compare /private/provider/hours.research-input.json \
  --compare /private/provider/days.research-input.json \
  --out /private/provider/compared.research-input.json
```

The resulting `compareCloudsync` array holds at most two additional original
CloudSync source objects. The research function reports each actual interval's
same-window summary and differences. It does not replace finer-grained rows with
coarser data, reconcile away differences, or turn missing source values into zeros.
Each source's null counts, explicitly derived values and original identities
remain inspectable in the result.

CloudSync output has `sourceKind: "cloudsync-parquet"` and
`pageChainComplete: null`, because this is a supplied source file rather than a
REST cursor chain. The summary's Decimal strings preserve the supplied decoder
number tokens; they do not reconstruct precision absent from the original
Parquet numeric representation. Source null/derived counts describe the actual
selected data and calculation.

Both customer examples accept this exact prepared object with `--input` on
`ohlcv_summary`. Source text stays inside `rowsBody`; the outer request is encoded
by the original buyer/SDK. Do not wrap a CloudSync file in an invented REST
`status/payload` response. The complete request, including all comparison source
text, must fit the selected input limit.

Keep these distinct byte identities with the handoff:

| Identity | Bytes it describes |
| --- | --- |
| `original.sha256` | The acquired Parquet file |
| `decoder.originalRowsSha256` | The original decoded JSON file before lexical compaction |
| `rowsSha256` | The exact UTF-8 text embedded in that source's `rowsBody` |
| Input file SHA-256 | The complete prepared research JSON file, including its formatting and trailing newline |
| Native review `bodySha256` | The original buyer's complete serialized HTTP request body |

The customer helpers parse the outer input object before the original buyer/SDK
serializes the HTTP body. Node preserves the supplied outer key order; Python
uses sorted keys. Trailing file whitespace is absent from both request bodies.
Their native body hashes can therefore differ from the input-file hash and from
each other while every embedded source string remains exact. Compare each hash
with its own recorded bytes. The page envelope's `bodySha256` separately identifies
the raw provider response text.

### Observed CloudSync source

The [first-party CloudSync sample page](https://docs.amberdata.io/cloudsync/cloudsync-market)
publishes the original GDAX BTC/USD files for 15 February 2026. The completed
research run used the selected UTC window from 00:00 on that date to 00:00 on
16 February, with the minute file as the main source and hour/day files as
comparisons:

| Original interval | Observed rows | Timestamp coverage | Observed volume, BTC |
| --- | ---: | --- | ---: |
| Minutes | 1,440 | Complete | 5935.03093559 |
| Hours | 24 | Complete | 5965.51322769 |
| Days | 1 | Complete | 5965.51322769 |

All three sources agree on open 69786.96, high 70941.65, low 68020 and close 68792
USD. The saved source extension reports the observed close-minus-open change as
-994.96 USD and high-minus-low range as 2921.65 USD. The minute volume is
30.48229210 BTC lower than either comparison; full timestamp coverage does not
establish agreement between separately published intervals. The source does not
establish the reason for this difference. Each interval keeps its actual total,
original file/decoder identity, NULL counts and derived-value counts.

These supplied files produce `pageChainComplete: null` and complete interval
coverage. Their Decimal output comes from the retained decoder tokens. The
original saved-source preview, versioned release and rollback retain the same
source records; the example does not depend on another provider acquisition.

## Understand research completeness

| State | Meaning and useful operator action |
| --- | --- |
| REST chain complete; interval coverage complete | The supplied terminal chain contains every expected selected candle position. |
| REST chain incomplete | Retain the current summary and source pages; an actual usable continuation can be reviewed as another native operation. |
| Interval coverage incomplete | Inspect the reported gap intervals and exact source selection. No candle was filled to make the result appear complete. |
| CloudSync source | Inspect original file/decoder identity and interval coverage. REST chain state is null. |
| Conflicting duplicate candle | Inspect the original source bodies and timestamps; the function does not choose a winner silently. |
| Interpretation unavailable | The original response bytes remain the primary data. Inspect the stated schema/version/cursor or input error before revising the application. |

`complete` describes the research source and interval coverage. It is not a
settlement, invoice or customer-acceptance field. Original native buyer status,
HTTP delivery and independently observed transfer remain in their original
records. Both examples print these fields separately from research interpretation.

The summary's open and close are the first and last observed candles; high and
low are extrema of observed candles. Volume is summed once per retained candle.
Never multiply or annualize a partial window without making that separate analysis
explicit. Prices remain in the selected quote unit; contract volume remains
contracts. For a source whose daily candles use multiple boundaries, retain the
actual selected boundary; one fixed-boundary product does not merge them.

## Release, customer use and operator acceptance

The complete handoff should contain a usable original workspace export and its
actual source/release identity, the selected product, original SDK files and
original saved discovery listing, exact source inputs, customer instructions and
the native saved result used for acceptance. Keep provider data and operator
state in the agreed private delivery location. Native source publication alone
does not assert that a customer service is running.

Use the original workspace for a single composed operator journey: inspect/edit
the selected application, save a revision, preview actual retained input, inspect
the result and its source identities, stage and compare the selected release,
activate against its current generation, and run the original service. Export the
SDK from that running original instance. Use an original customer operation to
review, execute and reopen its delivered result. Then demonstrate source restore
or release rollback with the original history and retain the complete workspace
export. These are user workflows and accepted state transitions, not a second
test runner.

The provider operations use the account's actual authorized API access. The
research function can use already acquired original provider files. An accepted
source/decoder/summary result and an actual payable provider request are separately
visible operations; retain their original status instead of inferring one from
the other. Product licenses, API entitlement, hosting and provider usage remain
the parties' selected commercial arrangement.

## Prepare and reopen a retained research request

Keep the selected release's `product.json`, original generated SDK and original
saved discovery together. For offline preparation, create a new private profile
JSON file containing `{}`. This lets the original buyer retain and review the
request before an operator or signer is configured. The prepared operation has
no delivered response yet.

Use the complete input created by `source-input.py`, including its original
comparison sources. Select the amount cap and accepted alternative from the
actual offer. Node uses the generated SDK's named operation:

```sh
node "$AMBERDATA_EXAMPLE/customer.mjs" prepare \
  --source-root "$AMBERDATA_SOURCE_DIR" --state /private/amberdata-node \
  --profile /private/offline-profile.json \
  --client /private/customer/seller-client.mjs \
  --product /private/customer/product.json \
  --operation ohlcv_summary --intent amberdata-research-001 \
  --max-atomic "$REVIEWED_RESEARCH_MAX_ATOMIC" --accept "$REVIEWED_ACCEPT_INDEX" \
  --input /private/provider/compared.research-input.json

node "$AMBERDATA_EXAMPLE/customer.mjs" inspect \
  --source-root "$AMBERDATA_SOURCE_DIR" --state /private/amberdata-node \
  --intent amberdata-research-001
```

For Python, the saved discovery can be the supported `{"resources": [...]}`
envelope containing the original offer rows without changing their contents or
order. Select the zero-based row for `ohlcv_summary` and its actual accepted
alternative. Put the global source and state options before the command:

```sh
python3 "$AMBERDATA_EXAMPLE/customer.py" \
  --source-root "$AMBERDATA_SOURCE_DIR" --state /private/amberdata-python \
  prepare --discovery /private/customer/native-discovery.json \
  --row "$REVIEWED_SUMMARY_ROW" --accept "$REVIEWED_ACCEPT_INDEX" \
  --profile /private/offline-profile.json --product /private/customer/product.json \
  --operation ohlcv_summary --intent amberdata-python-research-001 \
  --input /private/provider/compared.research-input.json

python3 "$AMBERDATA_EXAMPLE/customer.py" \
  --source-root "$AMBERDATA_SOURCE_DIR" --state /private/amberdata-python \
  inspect --intent amberdata-python-research-001
```

`prepare` already returns the original native review. A later `inspect` process
reopens the same `PREPARED` record, including its selected body and payment terms.
Keep that state directory and intent ID; preparing a replacement is unnecessary.
Before execution, configure the original buyer's actual operator, signer and
budget, then review the same retained operation. Calling `recover` before any
execution returns `ORIGINAL_RESULT_NOT_RECORDED` with CLI exit 2, because there is
no native response to recover; `inspect` is the appropriate preparation read.

## Reopen and continue the original operation

For a customer operation, keep the same runtime, application state directory and
intent. `inspect` shows the original prepared/attempted state; `recover` returns
the retained native result and verifies the saved response bytes. The original
buyer records an attempt before native execution and refuses to repeat an
attempted purchase. An uncertain process exit can coexist with a usable saved
response. Original evidence and ledger reconciliation resolve the payment state.

`consumeResult`/`consume_result` never call `raiseForStatus` before exporting or
reading a saved response. Native process status, output export errors and payload
interpretation errors have separate fields. If a destination already exists,
choose another copy destination or use the original file; do not acquire another
response just to replace an export. A caller can reopen the same BuyerResult and
use the original byte readers directly.

The clients expose `interpretationStatus` alongside native status. A CLI returns
exit 2 when native completion, output export or interpretation is unavailable,
while retaining the original response. A useful partial summary remains readable
with its explicit completeness fields; its missing intervals are not converted
into an application transport failure.

After a source correction, the original saved product response can be interpreted
again locally. A new research invocation is a new explicitly selected native
operation. A continuation is also a new selected operation for the next source
page; it is not a retry of the previous attempt. Preserve the actual completed
pages and their ordering throughout the continuation.

## Export and adopt the merchant

Export the original workspace with a new destination:

```sh
node "$AMBERDATA_EXAMPLE/prepare.mjs" workspace \
  --dir /private/amberdata-installation -- export \
  --out /private/handoff/amberdata.workspace.json

node "$AMBERDATA_EXAMPLE/prepare.mjs" adopt \
  --bundle /private/handoff/amberdata.workspace.json \
  --out /private/adopted-amberdata \
  --source-root "$AMBERDATA_SOURCE_DIR"

node "$AMBERDATA_EXAMPLE/prepare.mjs" inspect --dir /private/adopted-amberdata
```

The original workspace importer retains source/revision/preview/release/customer
export state create-only. The new host has its own explicit original runtime path.
`adopt` creates host pagination-key state without embedding API credentials in the
portable workspace. If the operator intends existing pagination tokens to remain
usable on the new host, transfer the original private `host/page.key` through the
existing private credential handoff before use. Retain the key's restricted file
permissions. A different key intentionally invalidates old merchant tokens.

Customer buyer state, its original signer/operator files and spending journal
belong together. Use the original
[Node recovery](../../../sf88-operator-buyer-cli/node/RECOVERY.md) or
[Python recovery](../../../sf88-operator-buyer-cli/python/RECOVERY.md) workflow for
their transport and restoration. Merchant source adoption does not move a buyer
wallet, reconstruct its budget journal or restart its paid operations.

## Source and implementation references

- [Amberdata exchange/instrument API](https://docs.amberdata.io/http/market/spot-exchanges-information.md): available instruments, active state, response shapes and data windows.
- [Amberdata OHLCV API](https://docs.amberdata.io/http/market/spot-ohlcv.md): selected exchange/window, pagination, interval, time format and BitMEX volume unit.
- [Amberdata OHLCV dictionary](https://docs.amberdata.io/data-dictionary/market/ohlcv.md): field meaning and exchange candle boundaries.
- [Amberdata delivery](https://www.amberdata.io/delivery): provider delivery modes.
- [Original Python merchant workspace](../../python/workspace/README.md): authoring, retained preview, source/release history and portable export.
- [Original upstream handlers](../../UPSTREAM.md): provider request, credential substitution and execution behavior.
- [Original SF88 buyer](../../../sf88-operator-buyer-cli/README.md): operator setup, approval, saved native operation and recovery.
- [Original SF88 finalization](../../../sf88-operator-buyer-cli/FINALIZATION.md): the existing operation's independent financial reconciliation.
