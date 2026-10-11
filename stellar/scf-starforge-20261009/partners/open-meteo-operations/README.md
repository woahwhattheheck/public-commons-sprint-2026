# Open-Meteo weather operations

A complete weather merchant and customer operating workspace on the maintained Stellar Forge seller, buyer, and recovery implementations.

Save site revisions, choose an explicit forecast, historical reanalysis, or ensemble request, retain the original response, evaluate operating windows, and freeze an attributed report. Each report includes its exact decision revisions, original JSON, every returned member column, CSV, HTML, and a file manifest. The original SF88 workspace retains the buyer intent, payment policy, evidence, and recovery custody.

## Run the installed product

~~~sh
npx --no-install starforge weather-operations --help
~~~

The repository entry point is `stellar/scf-starforge-20261009/partners/open-meteo-operations/cli.mjs`. Use the original native runtime profile: Node with `node:sqlite`, Python 3, and the pinned official `@x402/core` and `@x402/stellar` packages. This component adds no payment engine, server framework, weather database server, or chart dependency.

An explicit `OPEN_METEO_RUNTIME_ROOT` may select another complete maintained `stellar/scf-starforge-20261009` tree. Installed use discovers the original sibling source automatically. All paths are canonical absolute paths; private files use 0600 and directories use 0700. Outputs are create-only and return the actual destination and SHA-256.

## Compile and operate the merchant

Copy [examples/product.json](examples/product.json) into a private directory. Replace its public origin, asset, recipient, and prices with reviewed merchant terms. Template strings are configuration placeholders.

~~~sh
npx --no-install starforge weather-operations merchant compile \
  --config /private/weather-input/product.json \
  --out /private/weather-merchant-distribution

npx --no-install starforge weather-operations merchant serve \
  --config /private/weather-input/product.json \
  --port 8423 \
  --descriptor /private/weather-input/merchant-runtime.json
~~~

Compilation uses the original seller service, exact upstream declarations, OpenAPI compiler, and generated seller client. The resulting `client/seller-client.mjs` owns:

| Generated operation | Merchant path | Original source |
| --- | --- | --- |
| `weatherForecast` | `/weather/forecast` | Operational forecast |
| `weatherHistory` | `/weather/history` | Historical reanalysis |
| `weatherEnsemble` | `/weather/ensemble` | Individual ensemble members |

Without `--facilitator`, serving exposes the original challenge-only seller. Supply the reviewed native facilitator URL to use the maintained payment service. The explicit `--allow-local-facilitator` switch is available for local operation. These commands do not create a provider subscription.

Every GET selects one site and model, inclusive dates, declared variables and units, `timeformat=unixtime`, and the canonical ordered query. Unknown or duplicate parameters fail admission. Successful source bytes remain unchanged. Provider API keys are absent from the public query, OpenAPI operation, generated client, and buyer configuration.

## Initialize the receiving workspace

Use an existing original SF88 operator under the selected state root:

~~~sh
npx --no-install starforge weather-operations init \
  --state-root /private/weather \
  --operator /private/weather/operator \
  --client /private/weather-merchant-distribution/client/seller-client.mjs \
  --provider /private/weather-input/provider.json
~~~

Or initialize that operator through the original offline review and host-owned preset:

~~~sh
npx --no-install starforge weather-operations init \
  --state-root /private/weather \
  --review /private/weather-input/offline-review.json \
  --operator-preset /private/weather-input/operator-preset.json \
  --total-atomic 30000 \
  --daily-atomic 30000 \
  --client /private/weather-merchant-distribution/client/seller-client.mjs \
  --provider /private/weather-input/provider.json
~~~

`offline-review.json` is the original SF88 GET operation with explicit expected Stellar terms and no attached signer, operator, or evidence directory. Initialization invokes the maintained `initializeWorkspace`. [examples/operator-preset.json](examples/operator-preset.json) shows the original schema; replace its payer and local Python path. Select the named wallet environment variable or the original trusted signer-provider path.

Budgets must fit the host preset and cover the original single-operation cap. Key values remain in the original runtime environment or signer provider. The setup retains exact review/preset bytes, generated client, settings, buyer state, and weather state under one private root. Reopen through its `settings.json`.

## Operate in the browser

~~~sh
npx --no-install starforge weather-operations serve \
  --settings /private/weather/settings.json \
  --descriptor /private/weather-launch/launch.json
~~~

Create the private descriptor parent first. Open the returned local URL on the same machine. It bootstraps a session and removes the launch capability from the address bar. The loopback server validates host, origin, session, and input.

1. **Sites & requests.** Save a named site and IANA zone. Select the model, dates, variables, and units. A request retains that exact site revision; subsequent site edits do not rewrite it.
2. **Sources & decisions.** Inspect retrieval, source SHA, requested coordinates, selected grid, UTC/local timestamps, units, and members. Compare identical UTC timestamps. Save a window, threshold, aggregation, coverage requirement, owner, disposition, and notes.
3. **Frozen reports.** Select exact decision revisions. Download complete ZIP, HTML, or JSON. Later working revisions leave the old report and source bytes intact.
4. **Recovery.** Review, capture, and verify the complete original state. Stop the workspace before same-root restoration through the CLI.

**Read provider source** retains the exact HTTP 200 JSON before interpretation. **Reprocess retained original bytes** uses the same read if interpretation needs to resume; it makes no HTTP request. A later explicit provider read is retained separately.

Buyer preparation applies to a draft. Enter its explicit maximum atomic payment and offer index. Preparation uses the original generated client and `Buyer.fromWorkspace`, then checks the original reviewed URL, GET method, absent body, headers, expected terms, and native workspace.

Evaluation mode exposes an explicit public-endpoint option for an unsigned request through the original buyer. Production merchant preparation uses the generated client and selected merchant terms. **Read original buyer outcome** reads the same attempt and saved response; it does not purchase again.

The original operator checks `/dev/tty` before recording an execution attempt. Start the CLI or browser server from a controlling terminal. On Linux when needed:

~~~sh
script -q -e -c \
  'npx --no-install starforge weather-operations serve --settings /private/weather/settings.json' \
  /dev/null
~~~

Any original payment approval remains in that terminal. The weather browser does not replace it. A missing terminal is a setup failure before the native attempt.

## The same workflow from CLI or JavaScript

The CLI shares the browser model. Stop the browser before a separate process opens that weather directory; the original descriptor-held state lease excludes concurrent owners.

~~~sh
npx --no-install starforge weather-operations site-save \
  --settings /private/weather/settings.json --input /private/weather-input/site.json

npx --no-install starforge weather-operations request-save \
  --settings /private/weather/settings.json --input /private/weather-input/request.json

npx --no-install starforge weather-operations source \
  --settings /private/weather/settings.json --request REQUEST_ID \
  --input /private/weather-input/current-revision.json

npx --no-install starforge weather-operations series \
  --settings /private/weather/settings.json --capture CAPTURE_ID \
  --variable temperature_2m --unit fahrenheit

npx --no-install starforge weather-operations compare \
  --settings /private/weather/settings.json --left FORECAST_CAPTURE_ID \
  --right ENSEMBLE_CAPTURE_ID --variable temperature_2m
~~~

`current-revision.json` contains the actual `expectedRevision`. `prepare` additionally takes `maxAtomic`, `acceptIndex`, and optional explicit `directEvaluation`. `execute`, `inspect`, and `recover` take the same retained request ID. `decision-save` takes a capture and rule. `report-freeze` requires explicit `{id, revision}` selections; `report-export` publishes the selected report as ZIP, HTML, or JSON.

The [site](examples/site.json), [request](examples/request.json), and [decision](examples/decision.json) examples show those inputs. Replace retained IDs and dates with the actual selection. No example requests data automatically.

Applications can import `./partners/open-meteo/application` for compilation/initialization, `./partners/open-meteo/workspace` for the same `WeatherWorkspace`, `./partners/open-meteo/server` for the local server, `./partners/open-meteo/analysis` for interpretation, and `./partners/open-meteo/reports` for original frozen exports. `./partners/open-meteo` exports the native weather contract.

## Meaning of the source data

The official contracts are [forecast](https://open-meteo.com/en/docs), [historical weather](https://open-meteo.com/en/docs/historical-weather-api), and [ensemble](https://open-meteo.com/en/docs/ensemble-api).

| Item | Preserved meaning |
| --- | --- |
| Time | Unix validity seconds are converted with the returned IANA zone for DST-aware display. The API's reported fixed offset remains separate. |
| History | ERA5/ERA5-Land reanalysis, not a direct station observation. This history route does not substitute Historical Forecast or an individual archived forecast run. |
| Coordinates | Requested site and returned model grid are both retained; the cell can be kilometres from the site. |
| Generation time | `generationtime_ms` is API computation time, not model initialization or age. Retrieval is retained independently. |
| Instantaneous values | Temperature, wind speed, humidity, and historical ERA5/ERA5-Land gusts use validity instants in `[start,end)`. |
| Preceding intervals | Precipitation is the preceding-hour sum; radiation the preceding-hour mean; forecast/ensemble gusts preceding-hour maxima. Only complete intervals inside the UTC window are evaluated. |
| Missing values | `null` stays missing, including charts and export. It cannot count as zero or satisfy coverage. |
| Ensembles | Every returned member remains available. Threshold fractions use eligible returned members; they are not calibrated probabilities. Actual member count and horizon come from the response. |
| Comparison | Identical validity timestamps and requested coordinates, with model/grid differences retained. Reported differences compare returned medians. |
| Aggregation | Minimum, maximum, and mean use covered samples. Sum is allowed for precipitation. Expected coverage includes absent hours in the window. |

Application admission allows one forecast of up to 16 days, history up to 31, or ensemble up to 35, with six declared variables and a 1 MiB response ceiling. Actual model horizons, variable availability, and provider quotas still apply. Unavailable selections preserve their original error.

CSV contains one hourly row, source identity, site/grid, UTC/local time, and all native variable/member columns with units and interval labels. ZIP manifests bind original JSON, derived series, report, and decision files by SHA-256.

## Provider mode, costs, and attribution

Public evaluation `provider.json`:

~~~json
{"mode":"evaluation"}
~~~

For an existing Professional-or-higher commercial provider account:

~~~json
{"mode":"professional","apiKeyEnv":"OPEN_METEO_API_KEY"}
~~~

Optional `proxyEnv` selects the original public HTTPS transport's proxy reference for direct source acquisition. The merchant uses the maintained SF30 upstream transport.

Official [pricing and usage terms](https://open-meteo.com/en/pricing) permit public evaluation/prototyping. Commercial production uses customer endpoints and the account key; history and ensemble require Professional or higher. Account billing can count multiple units for time, variables, locations, or models. Merchant prices and buyer caps are independent explicit settings; supplier cost is not inferred from HTTP request count.

[Open-Meteo](https://open-meteo.com/) data uses [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The UI and exports preserve attribution and mark local-time display, unit conversion, analysis, and layout as derived. Original JSON remains unchanged.

## Recover the complete existing operation

Provide a strong passphrase through the named environment reference, keeping its value outside the archived workspace.

~~~sh
npx --no-install starforge weather-operations recovery review \
  --settings /private/weather/settings.json

npx --no-install starforge weather-operations recovery snapshot \
  --settings /private/weather/settings.json \
  --output /private/weather-backups/retained-20261011 \
  --passphrase-env OPEN_METEO_BACKUP_PASSPHRASE

npx --no-install starforge weather-operations recovery verify \
  --bundle /private/weather-backups/retained-20261011 \
  --record-sha ORIGINAL_RECORD_SHA256 \
  --passphrase-env OPEN_METEO_BACKUP_PASSPHRASE
~~~

Under its state lease and serial barrier, the weather model closes SQLite and invokes original SF88 encryption/checkpointing for the operator ledger plus weather, buyer, settings, client, and retained setup. It reopens the same store after capture and retains a successfully published native result if reopen fails.

Stop the process. With the original canonical state root absent:

~~~sh
npx --no-install starforge weather-operations recovery restore \
  --bundle /private/weather-backups/retained-20261011 \
  --record-sha ORIGINAL_RECORD_SHA256 \
  --passphrase-env OPEN_METEO_BACKUP_PASSPHRASE

npx --no-install starforge weather-operations serve \
  --settings /private/weather/settings.json
~~~

Restoration preserves original identities and runtime bindings. It neither relocates a ledger nor creates or executes a replacement buyer intent. Export the frozen report again from the restored original sources.

## Completed operating example

The original operating run on 11 October 2026 used three actual Open-Meteo responses: a 48-hour forecast, 72-hour ERA5 history spanning New York's March DST change, and a 48-hour ICON ensemble with 40 members and 120 returned variable/member columns. All original response bytes, requested sites, selected grid cells, native units, and validity seconds remain attached to their captures.

The forecast passed through the maintained SF88 buyer as an HTTP 200 `NO_PAYMENT_REQUIRED` evaluation response, with its original intent retained and no reservation or payment. The original SF30 merchant separately compiled the three operations, preserved the exact retained source bytes through its upstream handlers, and issued its native 402 challenge with the selected 10,000-atomic terms. This run does not claim a paid customer deployment.

The browser completed retained-source reprocessing, three attributed decisions, the 48-timestamp comparison, the complete 120-column member export, and a frozen three-source report. A later decision revision preserved the old report. Desktop and 390-pixel operation completed without page or API errors.

The original SF88 encrypted snapshot, verification, and same-root restoration then preserved the original buyer intent, settings/client/setup, three captures, four decision revisions, and one frozen report. The restored report exported the identical 33,416-byte ZIP, SHA-256 `28d56f92cdf35756773a40eb5a0125d03b5b0f86d5ebf63485d2c79365643f53`; all nine manifest-bound member files matched. Restoration and export used the retained original data without another provider request or buyer execution.
