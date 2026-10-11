# Tomorrow.io weather operations

Turn a location and work window into a reviewed forecast edition, staff assignments, a refreshed comparison, and a portable customer handover. This product uses the existing Stellar Forge seller and buyer runtime. The operator interface uses a neutral industrial layout and the original forecast JSON and PNG tile.

## Start the operator workspace

Use Node 22 or later with the installed Stellar Forge source and dependencies. The maintained entrypoint is `sf30-seller-sdk/tomorrow/cli.mjs`.

Create a plan JSON:

```json
{
  "schema": "stellar-forge.tomorrow-plan.v1",
  "usage": {
    "mode": "keyless-evaluation",
    "retentionSeconds": 0,
    "exportRaw": false
  },
  "timeoutMs": 30000,
  "maxCallsPerMinute": 10,
  "maxInFlight": 2
}
```

```sh
node sf30-seller-sdk/tomorrow/cli.mjs init --workspace /absolute/weather-work --plan /absolute/plan.json
node sf30-seller-sdk/tomorrow/cli.mjs serve --workspace /absolute/weather-work --port 0
```

Open the printed local URL. Its initial fragment establishes the local operator session. Keep the same process running throughout a keyless evaluation so its forecast bytes remain available. The UI saves configuration drafts, reviews the exact requests, captures the selected edition, records staff decisions, compares a later edition, and exports or imports a handover. It displays actual acquisition failures and retained decisions after a process restart.

For a corporate or cloud network with an explicitly configured HTTPS proxy, add:

```json
{
  "transport": {
    "mode": "explicit-connect",
    "origin": "https://api.tomorrow.io",
    "proxyEnv": "HTTPS_PROXY"
  }
}
```

That selection uses the original SF31 public HTTPS transport with its CONNECT, TLS and origin checks. Direct networks use the original SF30 upstream transport. Provider and proxy credentials are referenced through server environment names.

For licensed service, configure the customer's actual license reference, allowed retention in seconds, raw export permission and any license expiry. Set the API key in the named server environment variable, default `TOMORROW_API_KEY`. The app uses the REST `apikey` header. The separate hosted Tomorrow MCP service uses its documented `X-Api-Key` scheme.

## A complete work order

The browser supports these fields directly. The same JSON works with the `work` command:

```json
{
  "title": "Austin field maintenance window",
  "location": {
    "label": "Austin work location",
    "latitude": 30.2672,
    "longitude": -97.7431
  },
  "window": {
    "startTime": "now",
    "endTime": "nowPlus6h",
    "timezone": "America/Chicago",
    "dailyStartHour": 6
  },
  "units": "metric",
  "fields": ["temperature", "humidity", "solarGHI", "windSpeed", "windGust", "precipitationIntensity"],
  "timesteps": ["1h"],
  "tile": {"zoom": 8, "field": "precipitationIntensity"},
  "thresholds": [
    {"id": "gust-review", "field": "windGust", "operator": "gte", "value": 15, "unit": "m/s", "label": "Operator gust review threshold"}
  ]
}
```

The sample threshold is an editable demonstration input. The operator sets thresholds for the actual work. Relative times resolve once into fixed offset-aware timestamps when the work order is saved. A prepared edition freezes that work version and its requests.

The point request uses Tomorrow's documented `[latitude, longitude]` ordering. Tile coordinates are derived from that same point using the selected zoom. GeoJSON has its own coordinate convention; this adapter does not substitute it.

### Review, acquisition and staff decisions

Each edition goes through PREPARED, REVIEWED and ACQUIRING, then COMPLETE, PARTIAL or FAILED. A recovered interrupted operation can be INTERRUPTED. The review binds exact URL, JSON body, units, time window, source handling and number of selected provider calls. Each selected PNG is a separate call.

Original returned intervals retain their timestamp, offset, native units, explicit nulls and absent fields. The interface also identifies returned points outside the selected half-open work window. A PNG supplies map context; threshold decisions use Timeline measurements.

Staff decisions are immutable revisions with assignee, decision, note, source hash and interval identity. A later decision becomes the current assignment while the earlier revision stays visible. Supported choices are PROCEED, RESCHEDULE, REVIEW and CANCEL. An uncertain browser response can be retried using its saved request ID without recording a second decision.

A new edition is an explicit acquisition. Comparisons match location, units, timezone, daily boundary, timestep, timestamp and field. Changes use actual paired values. Added, removed and missing observations are displayed separately. The application does no interpolation, accumulation from precipitation rates, or image-based measurement.

## Delivery and reopening

`handover` and the browser export retain the selected original edition metadata, request identity and staff decisions. `import` adds that work to a receiving workspace. A source workspace identifier remains in the handover; the receiving workspace keeps its own browser draft identity.

Evaluation raw bytes are held in the running process. After restart, requests, response hashes, returned extent and staff decisions reopen. Licensed source files reopen until their configured expiry. A metadata handover displays METADATA_ONLY until its authorized raw files are imported or acquired through the original buyer.

```sh
node sf30-seller-sdk/tomorrow/cli.mjs handover --workspace /absolute/weather-work --out /absolute/weather-handover.json
node sf30-seller-sdk/tomorrow/cli.mjs import --workspace /absolute/receiving-weather --input /absolute/weather-handover.json
```

For permitted licensed raw delivery, add `--include-raw true`. The receiving plan must explicitly configure the same license reference and export permission. Its own shorter retention or expiry is also enforced. Exact bytes and hashes are checked on import and use.

## Original native seller and customer operation

`packageWeatherEdition` in `merchant.mjs` consumes a completed licensed edition with permitted raw export. It invokes the original SF30 `inspectResponseAsset`, `createAssetBundle` and `exportAssetCatalog`. The resulting directory contains native seller config, immutable file products, public pinned catalog and `weather-product.json`.

Supply the real public HTTPS origin and the exact ordered payment options in a private seller terms JSON. The existing seller compiler validates network, scheme, asset, amount, recipient and timeout. The two products are the original Timeline JSON and selected PNG; each resource advertises its own exact digest, size and MIME type.

```sh
node sf30-seller-sdk/tomorrow/cli.mjs package --workspace /absolute/weather-work --edition EDITION_ID --seller /absolute/seller-terms.json --out /absolute/weather-product
node sf30-seller-sdk/tomorrow/cli.mjs serve-seller --package /absolute/weather-product --port 0
```

The default server reports CHALLENGE_ONLY. To use the original native x402 payment lifecycle, pass `--factory-module` with a trusted local module whose default export is the application's original native seller factory. The library function `serveWeatherPackage({directory,nativeFactory})` accepts the same factory. Its configured expiry check runs before the original payment admission. The service closes when that source edition expires.

The customer supplies their original Buyer runtime/state/profile settings, exact product and catalog, and an explicit payment option index for each resource:

```json
{
  "purchaseId": "austin-weather-20261011",
  "acceptIndices": {"timeline": 0, "tile": 0}
}
```

`prepare-buy` uses the original `prepareReview` and `Buyer.fromConfig`. It retains the exact native catalog selection, payment ceiling and response pins. `review-buy` saves the original reviews. `buy` uses those reviews and the original operator profile. The application adds no signer or alternate payment journal.

```sh
node sf30-seller-sdk/tomorrow/cli.mjs prepare-buy --workspace /absolute/customer-weather --buyer-config /absolute/buyer.json --purchase /absolute/weather-purchase --product /absolute/weather-product.json --catalog /absolute/catalog.json --selection /absolute/selection.json
node sf30-seller-sdk/tomorrow/cli.mjs review-buy --workspace /absolute/customer-weather --buyer-config /absolute/buyer.json --purchase /absolute/weather-purchase --out /absolute/weather-review.json
node sf30-seller-sdk/tomorrow/cli.mjs buy --workspace /absolute/customer-weather --buyer-config /absolute/buyer.json --purchase /absolute/weather-purchase --review /absolute/weather-review.json
```

`recover-buy` calls original operation recovery and reuses saved verified results. It never launches another acquisition. `continue-buy-preparation` resumes preparation of resources that have no prepared original operation. Original handles remain available through `WeatherPurchase.original()`.

The customer workspace retains the original provider edition and adds its own original buyer delivery receipt. If the original process exit was not recorded but the native saved response is recoverable, the complete hash-verified file can populate the weather view while its receipt preserves the original runtime error and exit metadata. Reopening and file use do not turn that event into another payment attempt.

`export-buy` produces the receiving handover. Its `handover` member is the same original workspace import format.

## Austin utility intake

`austin-intake.mjs` provides `buildAustinForecast` for exact native Timeline inputs and `exportAustinForecast` for licensed workspace editions. It produces:

- `forecast-vintages.csv` with the accepted original intake columns.
- `forecast-mapping.json`, ready to use as the existing intake's forecast member.
- Exact original response JSON for each edition.
- `forecast-source.json` with each source hash, native pointer, request, actual time basis, exclusions and missing measurements.

The operator supplies an existing station ID or accepted station alias. Metric temperature, humidity, GHI and wind pass through unchanged. The existing Austin intake performs its own Decimal conversions to Fahrenheit and mph.

```sh
node sf30-seller-sdk/tomorrow/cli.mjs austin-forecast --workspace /absolute/weather-work --editions EDITION_ID --station-id EXISTING_STATION_ID --timestep 1h --out /absolute/austin-forecast-input
```

The original `commons.austin-weather-intake.v1` mapping still supplies the current observations and assets. Attach the generated forecast member to that same project. This exporter creates no replacement acceptance engine.

The canonical `issued_at` is source availability for analysis. A supplied native provider issue timestamp must resolve to its exact JSON pointer; otherwise the actual response acquisition is explicitly labeled as the availability basis. Provider issuance and acquisition remain separate columns. `valid_at` is the original interval start time. Intervals valid before source availability are itemized as exclusions, retaining the original response and returned extent.

Use one explicit timestep for an intake export; other returned timesteps remain recorded in the source manifest. Blank cells retain missing or null measurements. Acquisition cadence, native forecast spacing and downstream ADMS transmission are separate events.

## Interfaces

| Module | Public interface |
| --- | --- |
| config.mjs | compileWeatherPlan, normalizeWork, requestsFor |
| source.mjs | createTomorrowSource, readTimeline, readPng |
| workspace.mjs | WeatherWorkspace.create/open and original workflow methods |
| server.mjs | startWeatherServer({workspace,host,port}) |
| merchant.mjs | packageWeatherEdition, openWeatherPackage, serveWeatherPackage |
| customer.mjs | WeatherPurchase.prepare/open/review/execute/recover/export/original |
| austin-intake.mjs | buildAustinForecast, exportAustinForecast |
| cli.mjs | main and complete command help |

## Provider sources

The maintained request and unit contracts are [Timeline](https://docs.tomorrow.io/reference/post-timelines), [map tiles](https://docs.tomorrow.io/reference/get-map-tile), [API formats](https://docs.tomorrow.io/reference/api-formats), [core fields](https://docs.tomorrow.io/reference/data-layers-core) and [solar fields](https://docs.tomorrow.io/reference/solar). Keyless evaluation is described in the [provider's API guide](https://support.tomorrow.io/hc/en-us/articles/31227543026708-How-to-Use-the-Tomorrow-io-API). Deployment and source handling follow the customer's actual agreement and [published terms](https://www.tomorrow.io/legal/terms-of-service/).

[Powered by Tomorrow.io](https://www.tomorrow.io/)

## Recover one failed resource

A provider response can complete the Timeline while the map fails. The edition retains its successful source, staff decisions, HTTP status and provider error. Recovery reads saved attempt files without a provider request. A retry is an explicit, separately reviewed read of just the selected failed resource.

```sh
node cli.mjs recover --workspace ./operations --edition EDITION_ID
node cli.mjs review-retry --workspace ./operations --edition EDITION_ID --kind tile --tile-time-format whole-seconds --out ./tile-retry-review.json
node cli.mjs retry --workspace ./operations --edition EDITION_ID --kind tile --review ./tile-retry-review.json
```

The browser exposes the same review and retry actions. Its review shows the exact URL, previous failure, usage terms and one provider call. `whole-seconds` removes an all-zero fractional second from the map timestamp while preserving the exact instant, map point and field; `original` retains the original spelling. The adapter validates either request against the original work selection. It never substitutes a forecast window or field during a retry.

Every retry has an immutable capture file and retained request history. A successfully captured resource cannot be retried through this action. An interrupted attempt can be recovered from its saved capture; another provider request requires a new review. Provider error JSON is read up to 64 KiB and only its code/type/message are retained, with a configured API key redacted. No automatic HTTP retry is performed.
