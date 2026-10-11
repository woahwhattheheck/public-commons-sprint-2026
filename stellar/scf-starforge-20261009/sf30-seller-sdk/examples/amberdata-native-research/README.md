# Amberdata native research merchant

This application delivers two selected Amberdata spot reads and a Python OHLCV
research function through the existing Stellar Forge merchant. The operator edits,
previews, versions, runs and exports the application in the original
[Python merchant workspace](../../python/workspace/README.md). Customers use the
original generated seller client and the original SF88 buyer. Source revisions,
checkout outcomes, saved customer responses and research results retain their
existing owners and storage.

| Function | Public request | Product input | Result |
| --- | --- | --- | --- |
| `spot_instruments` | `GET /spot/instruments` | Empty initial input; an optional previous merchant continuation token | Exact provider body, selected instrument/availability identity, byte count and digest |
| `spot_ohlcv` | `GET /spot/ohlcv` | Empty initial input; an optional previous merchant continuation token | One exact provider page for the retained exchange, instrument, interval and time window |
| `ohlcv_summary` | `POST /research/ohlcv-summary` | Ordered saved page envelopes, or a supported complete research input object | Observed OHLCV, exact decimal strings, explicit units, missing intervals and source identities |

Each provider read uses the original `createUpstreamHandlers` through an
application-owned Node bridge. The bridge lives with the original Python worker
and closes on worker shutdown. It does not implement another HTTP transport or
payment path. The summary uses the supplied source bodies and does not fetch
additional market data. The fixed selection in `product.json` determines the
provider API version, exchange, instrument, window, units and input limits.

## Prepare an installation

Use Node 22.13 or later, Python 3.11 or later, and the complete original Stellar
Forge source/runtime. This directory's JavaScript and Python add no package
dependencies. Actual buyer signing uses the existing native buyer dependencies
and the operator's existing configuration described in
[SF88](../../../sf88-operator-buyer-cli/README.md).

Copy `example-plan.json` into a private working directory and select the actual
merchant origin, provider version and entitled data selection. Replace the
example payment recipient and asset with the actual offered Stellar terms before
using a payable release. The example's `UNVERIFIED_DEMO_*` values are preparation
placeholders. Its historical window illustrates a source contract; it is not a
claim that a provider account, public deployment or paid execution exists.

The original plan compiler checks the selected payment tuple and declares all
three Python functions. `prepare` creates a private installation and its first
saved source revision:

```sh
AMBERDATA_SOURCE_DIR=/absolute/original/source
AMBERDATA_EXAMPLE="$AMBERDATA_SOURCE_DIR/stellar/scf-starforge-20261009/sf30-seller-sdk/examples/amberdata-native-research"

node "$AMBERDATA_EXAMPLE/prepare.mjs" prepare \
  --plan /private/amberdata-plan.json \
  --out /private/amberdata-installation \
  --source-root "$AMBERDATA_SOURCE_DIR"

node "$AMBERDATA_EXAMPLE/prepare.mjs" workspace \
  --dir /private/amberdata-installation -- status
node "$AMBERDATA_EXAMPLE/prepare.mjs" workspace \
  --dir /private/amberdata-installation -- serve --port 8431
```

Open the original operator URL printed by `serve`. The existing workspace
provides source editing, function input editing, retained previews, source
history, release comparison, activation, rollback, managed start/stop/restart,
customer SDK exports and complete portable workspace exports. It retains an
unsaved editor draft separately from accepted revisions. The operator URL's
workspace credential is private.

The installation contains:

| Path | Purpose |
| --- | --- |
| `application/` | The imported Python application, contract, bridge, compiled `product.json`, upstream bindings and merchant declaration |
| `workspace/` | The original saved source/revision/preview/release/customer-export workspace |
| `host/runtime.json` | The original runtime source path and Node executable for this host |
| `host/page.key` | Private merchant pagination key |
| `installation.json`, `prepared.json` | The retained preparation identity and original workspace binding |

Repeated preparation resumes only this installation's exact original inputs. To
change the product, use the existing source workspace and save a new revision.
The host API credential is supplied privately as `AMBERDATA_API_KEY`; it is not
written into the product, source revision or customer export. The wrapper supplies
the host runtime and private pagination key to the original workspace process.

## Select data deliberately

The plan uses explicit UTC timestamps with milliseconds. `startDate` is inclusive
and `endDate` is exclusive. The Amberdata REST endpoint documents a maximum
731-day span. This application selects `minutes`, `hours` or `days`, and makes
neither the endpoint's default rolling-window request nor an implicit sort change.
The endpoint's `sortDirection` option applies only to its documented recent-window
conditions; this fixed-window product does not add it.

The instrument-information documentation shows both an array response and a
legacy exchange/instrument map. Set `provider.instrumentsShape` to the actual
selected version's `array` or `instrument-map` contract. The application checks
the actual provider `api-version` metadata. A version or response-shape change
belongs in a reviewed source revision.

OHLC prices use the selected quote unit. Volume uses the selected base unit or
contract count. Amberdata documents BitMEX volume as contracts; this product
retains that unit and does not silently convert it. Daily candle boundaries are
exchange-specific: `units.dailyBoundaryMinutes` is the explicit UTC minute offset
used by this selected exchange. `units.source` retains the first-party source
used to choose the unit and boundary.

The summary reports the first observed open, last observed close, maximum observed
high, minimum observed low and sum of observed volume. It preserves Decimal
results as JSON strings. Missing candles remain compact gaps; there are no filled
prices or fabricated volume rows. Identical duplicate candles can be counted
without double-counting their volume; conflicting values for the same timestamp
are rejected by the original contract.

The research function also accepts an explicit Amberdata CloudSync Parquet source
with its exact decoded-row text. That input retains the original file URL, size
and SHA-256, actual decoder/version/number representation, original decoded-file
identity and compact text identity. The supplied `rowsBody` preserves all source
columns and numeric tokens. At most two additional original CloudSync sources can
be compared across the same selected time window. Their per-interval summaries,
differences, null counts and derived-value counts remain separate. Use
`source-input.py` to prepare these inputs from the actual retained source files;
the exact commands and schema are in [OPERATIONS.md](OPERATIONS.md).

The original GDAX BTC/USD CloudSync files for 15 February 2026 have complete
minute, hour and day timestamp coverage, while their observed minute-volume sum
is 30.48229210 BTC below the hourly and daily sums. The research result retains
each interval's own values and makes that difference visible. The
[retained-source example](OPERATIONS.md#observed-cloudsync-source) explains the
actual output and its limits.

## Preview, release and run

Use the original workspace's Preview view or its original CLI command. Supply the
exact saved revision, function name, input file and a stable operation identifier:

```sh
node "$AMBERDATA_EXAMPLE/prepare.mjs" workspace \
  --dir /private/amberdata-installation -- preview \
  --revision ACTUAL_SAVED_REVISION --function ohlcv_summary \
  --input /private/research-input.json --operation amberdata-summary-preview-001 \
  --out /private/summary-preview.json
```

A provider preview explicitly calls the selected provider with the host's
authorized API credential. A summary preview runs on the supplied retained data.
Use retained previews and source revisions when correcting an input; reopening a
result does not require acquiring the data again.

In Releases, stage the saved revision with an explicit release ID, inspect its
original file/source digest, compare it to the current release, and activate
against the displayed generation. Run starts the selected original release. The
original runtime's mode is authoritative: without a facilitator it is
`CHALLENGE_ONLY` and does not import the Python application for paid execution.
Configure the actual supported facilitator and existing deployment origin for the
intended execution mode. The original browser controls the managed instance and
can export the generated customer SDK for that exact release/instance.

Give the customer the selected `product.json`, the original generated
`seller-client.mjs` and its original companion files, and the appropriate customer
example below. The published origin, payment tuple and generated SDK must all
belong to the selected release. A source export and a running provider service
are separate delivery states.

## Node customer: a saved operation and its result

`customer.mjs` uses the original generated client's `buildRequest` and the original
SF88 Node `Buyer.fromRequest`. No callback supplies a replacement approval or
signer. The existing private operator profile, signer and ledger remain in use.

The following Bash arrays keep the same application state and original handoff
files across the commands:

```sh
AMBERDATA_NODE=(node "$AMBERDATA_EXAMPLE/customer.mjs")
AMBERDATA_BUYER=(--source-root "$AMBERDATA_SOURCE_DIR" --state /private/amberdata-node)
AMBERDATA_HANDOFF=(--profile /private/operator-profile.json --client /private/customer/seller-client.mjs --product /private/customer/product.json)

"${AMBERDATA_NODE[@]}" prepare "${AMBERDATA_BUYER[@]}" "${AMBERDATA_HANDOFF[@]}" \
  --operation spot_ohlcv --intent amberdata-ohlcv-001 \
  --max-atomic "$REVIEWED_MAX_ATOMIC" --accept 0

"${AMBERDATA_NODE[@]}" execute "${AMBERDATA_BUYER[@]}" \
  --intent amberdata-ohlcv-001 --product /private/customer/product.json \
  --out /private/customer/ohlcv-page-0.json

"${AMBERDATA_NODE[@]}" recover "${AMBERDATA_BUYER[@]}" \
  --intent amberdata-ohlcv-001 --product /private/customer/product.json
```

Set `REVIEWED_MAX_ATOMIC` to the explicitly selected atomic-unit cap, and `--accept`
to the actual offered alternative. `prepare` displays the original native review;
`execute` runs the original approval/reservation/signing path once. `recover`
performs local reads of the same intent. A saved native response remains available
even if later interpretation or payment-evidence collection needs attention.

For offline preparation, pass a new private profile JSON file containing `{}`.
Both customer examples can prepare and review the retained request with that
profile, then `inspect` can reopen its `PREPARED` state in a fresh process. Keep
the same state directory and intent ID. An operator and signer are configured
through the original buyer before execution; an offline prepared record has no
delivered response yet. [Customer preparation](OPERATIONS.md#prepare-and-reopen-a-retained-research-request)
shows the complete retained-data command flow.

When a page contains an available merchant continuation, prepare the next
deliberate request using `--after /private/customer/ohlcv-page-0.json`, another
stable intent, and the same product/client/profile. This option takes the token
from the saved envelope. It does not accept a raw provider URL or arbitrary cursor.
Every continuation is another selected, reviewed native buyer operation.
An unavailable interpretation or null continuation token remains visible with its
reason and the exact original body. It does not cause an automatic repeat request.

Prepare the research function using the ordered saved page envelopes:

```sh
"${AMBERDATA_NODE[@]}" prepare "${AMBERDATA_BUYER[@]}" "${AMBERDATA_HANDOFF[@]}" \
  --operation ohlcv_summary --intent amberdata-research-001 \
  --max-atomic "$REVIEWED_RESEARCH_MAX_ATOMIC" --accept 0 \
  --page /private/customer/ohlcv-page-0.json
```

Repeat `--page` for each actual following page in order. Use `--input
/private/research-input.json` instead to supply a complete supported research input
object. `--input`, page selection and prior-page selection are mutually exclusive.
Execute and recover this summary using its own existing intent and the same
commands above. The return value retains native checkout/process status separately
from research completeness.

The module also exports `prepareCustomerOperation`, `operationInputs`,
`inspectPage`, `inspectPayload` and `consumeResult` for an existing Node application.
Pass the original `Buyer`, original generated module and selected `product.json`.

## Python customer: original saved-offer preparation

`customer.py` uses the original `stellar_forge_buyer.Buyer`. Supply the exact
original saved discovery response containing the selected merchant resource,
plus its zero-based row and accepted alternative. The native preparer verifies
the fixed origin/path/method and copies the offered amount, asset, network and
recipient. It also preserves the original listing and discovery digest.

The native preparer accepts a saved `{"resources": [...]}` envelope containing
the original offer rows. Preserve those rows and their order, and select the
actual operation with its zero-based `--row` and `--accept` indexes. The generated
Node SDK supplies its own operation and accepted-offer selection.

```sh
python3 "$AMBERDATA_EXAMPLE/customer.py" \
  --source-root "$AMBERDATA_SOURCE_DIR" --state /private/amberdata-python \
  prepare --discovery /private/customer/native-discovery.json --row 0 --accept 0 \
  --profile /private/operator-profile.json --product /private/customer/product.json \
  --operation spot_ohlcv --intent amberdata-python-ohlcv-001

python3 "$AMBERDATA_EXAMPLE/customer.py" \
  --source-root "$AMBERDATA_SOURCE_DIR" --state /private/amberdata-python \
  execute --intent amberdata-python-ohlcv-001 \
  --product /private/customer/product.json --out /private/customer/python-ohlcv-page-0.json

python3 "$AMBERDATA_EXAMPLE/customer.py" \
  --source-root "$AMBERDATA_SOURCE_DIR" --state /private/amberdata-python \
  recover --intent amberdata-python-ohlcv-001 --product /private/customer/product.json
```

The row index above is illustrative: choose the actual row for `spot_ohlcv` in the
retained original listing. Python supports the same `--after`, repeated `--page`
and `--input` forms. `AmberdataCustomer` also accepts an existing original Buyer
programmatically. Node and Python examples keep their own original application
state directories; a saved page exported by either can be consumed by the other.

## Read the result correctly

| Field | Meaning |
| --- | --- |
| `body` | The original provider JSON text, retained inside a page envelope |
| `bodySha256`, `bodyBytes` | Identity of the UTF-8 provider body, not of a reformatted JSON object |
| `selectionSha256` | The retained provider/window/unit/limit selection |
| `pageChainComplete` | The supplied REST chain reaches its actual terminal page; null for CloudSync file inputs |
| `intervalCoverageComplete` | All expected selected candle positions were observed |
| `complete` | Native research completeness for the selected source format and observed interval coverage |
| `sources`, `gaps` | Original input identities and absent candle intervals |
| `interpretation`, `continuation` | Provider interpretation and next-token availability, including explicit unavailable reasons |
| `sourceKind` | The actual research source format; `cloudsync-parquet` retains original file and decoder identity |
| `nativeSuccess`, `native`, `process` | Original buyer delivery/process/accounting information, separate from research completeness |

Both clients save/export native response bytes before their interpretation step.
An `interpretationError` retains the original native result and response-file
identity. Repair the product/input interpretation and reopen that response; a
fresh payment is not required to read bytes already delivered. `--out` is
create-only, so a later copy needs a new output path.

See [OPERATIONS.md](OPERATIONS.md) for full operator handoff, source provenance,
limits, recovery and accepted-release responsibilities.

## Sources

- [Amberdata spot exchange/instrument information](https://docs.amberdata.io/http/market/spot-exchanges-information.md)
- [Amberdata spot OHLCV endpoint](https://docs.amberdata.io/http/market/spot-ohlcv.md)
- [Amberdata OHLCV data dictionary](https://docs.amberdata.io/data-dictionary/market/ohlcv.md)
- [Amberdata CloudSync market data and original sample files](https://docs.amberdata.io/cloudsync/cloudsync-market)
- [Amberdata delivery methods](https://www.amberdata.io/delivery)
- [Original upstream implementation and operating contract](../../UPSTREAM.md)
- [Original Node buyer](../../../sf88-operator-buyer-cli/node/README.md)
- [Original Python buyer](../../../sf88-operator-buyer-cli/python/README.md)
