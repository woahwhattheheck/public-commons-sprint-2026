# Finage source capture and input preparation

`acquisition.py` captures the original Finage REST response bodies and the application message payloads delivered by the original `websockets` library. It can also import already retained originals without contacting a provider. It emits ordinary source files for the existing PythonWorkspace; that workspace continues to own editing, reviews, revisions, releases and customer delivery.

## Start with existing originals

Use this route when a colleague, a prior session or a customer has already retained the selected response:

```sh
python3 acquisition.py import --manifest import-manifest.json --out capture
python3 acquisition.py inspect --dir capture
python3 acquisition.py prepare --dir capture --out prepared
```

The manifest schema is `commons.finage.import.v1`. Each source declares its exact relative path, bytes, SHA256, original format, capture UTC, source kind, wire-byte provenance, request, scope, edition and optional capture metadata. Source bodies stay unchanged. The importer never silently turns a documentation example into live data. A complete retained input may include both primary live editions and explicitly labelled reference examples.

`prepared/workspace.json` uses `tj.finage-market-workspace.v1`. The other files are the selected original captures and metadata. `source_manifest.json` identifies every prepared file and the complete selection; it is an input receipt, not a second application database. Pass these files to the original Finage application/workbench and save them through the original PythonWorkspace.

To continue an interrupted identical import or preparation, add `--resume`. The original capture configuration and prepared-file identities must match. Existing accepted files are read back rather than overwritten. A different source selection belongs in a different prepared output directory.

## Capture with an existing account

`example-plan.json` is an editable account plan, not an observed data set. Select the operations and account-assigned socket server that the customer actually uses. API and socket keys come from existing environment variables and stay outside the plan:

```sh
python3 acquisition.py capture --plan account-plan.json --out account-capture
python3 acquisition.py inspect --dir account-capture
python3 acquisition.py prepare --dir account-capture --out account-input
```

The default variables are `FINAGE_API_KEY` and `FINAGE_SOCKET_KEY`. `--api-key-env` and `--socket-key-env` choose other existing variable names. Do not put a credential in a command argument, source file, socket URL or shared report. This client does not create an account, buy a subscription, register a new socket or obtain another key.

REST uses Python's standard library. WebSocket capture uses the same `websockets` package as [Finage's original Python example](https://github.com/FinageLTD/python-websocket-connection/blob/e7ebabf33033de059c2feebc2a503021680291da/websocket.py). The package is imported only for a selected socket operation, and its actual installed version is retained in the acquisition record. Use the customer's existing compatible installation; no provider SDK or replacement streaming server is required.

## Exact REST operations

| Operation | Original route | Explicit selection |
|---|---|---|
| `stock-aggregates` | `/agg/stock/{symbol}/{multiply}/{time}/{from}/{to}` | Positive multiplier; original interval; start/end dates; explicit `limit`, `sort` and `date_format` |
| `forex-aggregates` | `/agg/forex/{symbol}/{multiply}/{time}/{from}/{to}` | The same path fields; explicitly choose the Forex date format |
| `stock-snapshot` | `/snapshot/stock` | Explicit `quotes` and `trades` booleans; optional verbatim comma-separated `symbols` |
| `forex-snapshot` | `/snapshot/forex` | Explicit `quotes` and `trades`; original symbols |
| `public-forex-snapshot` | `https://homeapi.finage.co.uk/snapshot/forex` | The observed anonymous public website operation; no account query or credential |

Account REST uses `https://api.finage.co.uk` with the existing `apikey`. Redirects are retained as responses rather than forwarding a key to another origin. The fixed public route was observed in the provider's own [QuerySeed page](https://finage.co.uk/queryseed/pulse); it is a distinct source from an account-entitled REST or streaming feed.

The aggregate interval is one of `minute`, `hour`, `day`, `week`, `month`, `quarter`, or `year`. Finage documents a default limit of 100 and a maximum of 50,000. This client requires an explicit limit so a production selection cannot accidentally inherit 100. A body containing the requested maximum may be capped; the source record does not invent a next cursor or assert complete time-window coverage.

The original stock aggregate default is timestamp; the Forex aggregate default is datetime. Set `date_format` to `ts` or `dt` deliberately. Optional `st` and `et` are UTC time filters. `dbt_filter:false` trims the whole output boundaries; `true` applies those time filters daily. Preserve the original query in the saved edition when comparing results. These contracts come from the provider's [stock aggregate documentation](https://finage.co.uk/docs/api/us-stocks/stock-market-aggregates-api), [Forex aggregate documentation](https://finage.co.uk/docs/api/forex/forex-aggregates) and original endpoint catalog embedded in those pages.

A selected HTTP response is retained before interpretation. Successful bodies, HTTP errors, non-JSON bodies and interrupted partial bodies keep their own state. Finishing a network read and covering the whole requested market interval are different facts. The HTTP headers retained by the client include relevant date, length, type, ETag, caching and rate-limit information; it does not claim a captured network packet.

## Original WebSocket subscription and observation

Use the customer's existing dashboard-assigned server, for example the form `wss://<assigned-subdomain>.finage.ws:<assigned-port>/`, without its token. The client appends the existing socket token privately. Finage's current application and its own Python example send:

```json
{"action":"subscribe","symbols":"EURUSD,GBPUSD,USDJPY"}
```

The corresponding unsubscribe action uses the same verbatim symbols. Symbol spelling is provider/account specific; the client does not uppercase, remove slashes or merge instruments. The public model catalog includes both `EUR/USD` and unseparated symbols. Choose the actual subscribed selection rather than assuming that every model accepts the same spelling.

A socket plan chooses a finite `durationSeconds` and optional reconnect settings. The duration is an observation budget including connection and reconnect time. `connectedSeconds`, total elapsed time, connection outcomes, resumed intervals and reconnect waits are retained separately. A finished observation does not establish provider sequence continuity or the absence of messages during a disconnected interval.

Messages are saved as `commons.finage.message.v1` JSONL envelopes. Each carries a local ordinal, connection ID, UTC observation time, direction and kind. Payload records carry text/binary type, Base64 of the original library payload bytes, byte count and SHA256. Incoming data, provider control/error messages, outgoing subscriptions and local connection events remain distinguishable. The ordinal is local ordering, not an exchange or provider sequence number.

The client retains chunks near 7 MiB to keep ordinary chunks within the original workspace's 8 MiB file bound. The socket's maximum accepted application message is 8 MiB; an oversize message can end the connection and remains an explicit transport outcome. A single envelope can exceed the workspace bound after Base64 encoding; preparation then requires a different genuine source selection instead of silently dropping bytes.

For an interrupted writer, `capture --resume` preserves each complete original private chunk, recovers only validated complete JSONL lines from its exact prefix, retains any trailing fragment in the original private file, and starts a separate segment. It never claims to have observed the offline gap or fills it with generated messages.

The provider Playground's visible rolling list keeps 100 messages and its formatted view keeps only the latest entry per normalized symbol. Copying that screen is an excerpt. The reusable client retains the actual observed payloads and their source coverage.

## Retention and credential echoes

The capture directory contains `capture.json`, content-addressed consumable `captures/`, and a private area for raw HTTP responses, stream chunks and account identity. The account identity stores a private credential hash so resuming cannot accidentally mix accounts. It is excluded from prepared inputs.

If the provider echoes a credential in a body or payload, the exact original is retained privately first. The consumable copy is explicitly marked as a redacted derivative and keeps the original byte identity. A derivative is never labelled as the unchanged wire body. Keep the full capture directory in the customer's authorized private custody; distribute prepared inputs only to their intended recipients.

## Inspection, coverage and interpretation

`inspect` reads back every declared body and metadata file. It validates UTF-8 JSON and duplicate keys, snapshot and aggregate shapes, message envelope payload identities and consecutive local ordinals. For the published model catalog it reads each exact original structure string. Raw number tokens remain in the captured bodies; inspection does not rewrite prices through binary floating point.

Snapshot `totalResults` counts distinct symbols. A quote and a trade for the same symbol are two records but one symbol. `lastQuotes:null` is preserved as null. Numeric prices, string-encoded crypto prices and quantities, sizes, zero timestamps and unknown fields remain available to the processor.

Time interpretation belongs in the original operator workspace. The stock/Forex snapshot catalog labels timestamp microseconds, while the published example values also support materially different calendar dates under a millisecond interpretation. The public Forex response body does not declare a unit. Preserve the published claim, the raw value and the operator's explicit decision separately. Capture time must not replace event time.

Quote bid/ask, midpoint, last-trade and aggregate OHLCV are separate price bases. Historical bar comparison with a quote stream needs an explicit selected basis and matching time/symbol interpretation. No capture-level completeness flag proves exchange coverage, price accuracy, execution quality or an SLA.

## Resume and output handling

`capture --resume` uses the same unchanged plan and account binding. Completed REST results, including retained provider errors or invalid bodies, are not automatically requested again. A genuinely new provider attempt uses a new capture/selection and remains a distinct edition. Interrupted stream work resumes with an explicit gap.

`prepare --source EXACT_SOURCE_ID` selects complete retained sources or chunks. Repeat the flag for additional selections. The prepared manifest identifies selected versus total source counts, so a subset is visible. No row truncation is performed to satisfy the original 8 MiB file / 32 MiB revision limits. The original operator application can produce full artifact/file exports when a report is larger than a preview response.

CLI exit 0 means the operation completed; 2 means a retained capture is partial; 1 reports a configuration, access or file-integrity error. The error output is credential-redacted. Read the retained per-source and per-connection statuses instead of interpreting the exit code as a market-data guarantee.

## Source and customer use

Use the customer's existing Finage entitlements and agreed destinations. Finage's [terms](https://finage.co.uk/company/privacy-policy/terms-of-use) describe OTC/P2P/market-maker provenance and require permission for data redistribution. This software implements capture and receiving; it does not sell market data, alter those terms or create a right to redistribute a source. Private business proposals and retained customer data are kept outside this generic source directory.
