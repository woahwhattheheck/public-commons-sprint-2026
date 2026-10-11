# OpenWeather customer integration

A complete local customer application for One Call 4.0 current weather and hourly timelines. It retains the original API inventory, acquires provider pages under an explicit call allowance, preserves partial work through interruption, lets an operator review immutable data editions, and exports them through the existing SF61 merchant compiler and SF82 release operator.

The application includes an industrial browser console, a headless CLI, a header-authenticated customer API, a Node client with TypeScript declarations, CSV/NDJSON/JSON handover, scheduled refresh, and workspace recovery. Existing merchant packages can be refreshed through the maintained source-review engine while preserving route identities, exact atomic prices, and payment settings.

This workflow serves a customer's existing subscription and authorized application. The direct API stays on the customer's host. Optional merchant release tooling joins the customer's authorized service deployment and existing commercial agreement.

## Start the application

Use the maintained Starforge source distribution or repository with its existing runtime dependencies and Node 22.16 or newer. This application adds no npm package dependency. Original SF61/SF82 operations use their maintained dependencies.

From `stellar/scf-starforge-20261009/sf61-openapi-seller-import`:

```sh
node openweather/cli.mjs serve --store /absolute/private/weather-customer --port 8428
```

Supply the customer's existing One Call credential as `OPENWEATHER_API_KEY` in the launch environment. Supply a separate strong `OPENWEATHER_APP_TOKEN` for the customer API and merchant upstream. The browser accepts environment-variable **names**; it never asks for credential values. An existing secret manager or the host's private environment file can supply these variables.

The command prints the actual loopback origin and a complete operator URL with a random access token in its fragment. Open that complete URL. The console moves its token into session storage and removes the fragment from the address bar. It binds to `127.0.0.1`, validates its actual host and origin, and uses a separate bearer token for private operations. Access a remote host through its existing private operator connection.

The private workspace directory must be unaliased and mode 0700; retained files use 0600. A process lease keeps one operator process in charge of each store. Close that process before using a headless command against the same store.

The selected application port is retained. Reopening the same workspace without `--port` reuses that port, which keeps existing merchant upstreams valid. Changing the application port requires a new integration source review and release. `--package-parent /absolute/private/original-packages` joins an existing SF61 package directory; otherwise packages live beneath this weather workspace.

## Operator workflow

### 1. Set up the actual customer project and call allowance

Save the customer's location, unit mode, language, provider-key environment name, request deadline, and maximum hourly pages per acquisition. The identifier stays fixed; a settings change creates a new project revision and disables its schedule until it is configured again.

Enter an explicit account window in UTC, its total permitted calls, and calls made elsewhere. The application accounts for its own requests, preserves the used count when a window is updated, and refuses overlapping accounting windows. It stops before a request that would exceed this local allowance. It counts failures and interrupted requests conservatively because they may consume provider calls. Updating a local limit does not modify the provider account or subscription.

One store tracks one key environment after calls have been made. Use a separate store for another provider account. Reconcile any other users of that account before increasing the available allowance.

Import the customer's original OpenAPI JSON or YAML under **Setup & source**. The maintained SF61 inspector returns its actual operations, request contracts, backend authentication, and compatibility findings. The exact imported source, its SHA-256, and optional original HTTPS location stay with the project.

### 2. Acquire current weather and the required hourly range

Choose whole UTC hours, with an exclusive end. Each acquisition reads current weather once, then follows the hourly provider's actual `next` URLs until it has reached the requested end, exhausted the source, or reached a configured allowance.

Each hourly page contains at most twenty provider records. The displayed call estimate is a lower bound for the selected range: one current request plus the hourly pages. Actual provider continuations govern pagination.

The acquisition process:

1. Durably reserves one account call and records the exact request identity before dispatch.
2. Adds the provider key only to the outgoing request.
3. Retains the returned HTTP status, response metadata, sanitized source JSON, normalized records, and continuation.
4. Applies that retained receipt to the acquisition before dispatching the next page.

All provider requests are serialized within the workspace. The request deadline is configurable from one to 120 seconds. A provider page is limited to one MiB, a stored response to two MiB, and the retained workspace to 256 MiB. These local capacities are shown as actionable errors while the existing records remain available.

**Stop after current request** preserves the current page. **Resume saved acquisition** continues its saved cursor; it can add hourly pages to the original allowance. The current reading and successful hourly pages are reused.

| State | Operator action |
|---|---|
| `BUDGET` | Reconcile the current local allowance and recorded external usage, then resume. |
| `PAGE_LIMIT` | Review retained coverage, add the needed hourly pages, then resume. |
| `RATE_LIMITED` | Respect the actual `Retry-After`, reconcile provider usage, then resume. |
| `AUTH_REQUIRED` | Correct the existing key or One Call subscription in the launch environment, reopen, then resume. |
| `SOURCE_ERROR` | Inspect the retained response or network failure; resume the same cursor when appropriate. |
| `UNKNOWN` | Inspect the request that was in flight during interruption. Its call remains counted; explicitly acknowledge another attempt before resuming. |
| `INVALID_REQUEST`, `UNAVAILABLE`, `INVALID_RESPONSE`, `REJECTED` | Inspect the actual retained input/response and start an acquisition with corrected inputs. |

On restart, an in-flight request with a complete retained receipt is applied without requesting it again. An in-flight request without a complete receipt becomes `UNKNOWN`. The application never refunds an uncertain call automatically.

A traversal can stop because the source is exhausted while the requested time range still has gaps. The data coverage calculation, rather than the job's terminal state, determines whether an edition is complete.

### 3. Review and deliver immutable data editions

Open an acquisition under **Review & deliver**. The console shows current weather, UTC and local hourly timestamps, received versus expected hours, missing intervals, identical overlap records, and conflicting overlaps.

Identical overlaps are deduplicated. A conflicting overlap requires an explicit first-record or last-record decision. A partial range requires a recorded acceptance note. Absent measurements remain absent.

Saving a data edition freezes the selected project revision, field mapping, retained source identities, coverage, and review decisions. Existing editions remain available after later acquisitions or settings changes. **Open saved edition** reopens the original accepted data; **Use for the direct customer API** selects it. **Restore previous customer edition** swaps back to the previous selection.

Downloads include:

- Complete review JSON with data and source identities.
- Hourly CSV with UTC timestamp, IANA local display, original measurement semantics, conditions, and alert identifiers.
- Hourly NDJSON with project, timezone, and unit metadata on every record.
- Authored customer OpenAPI for the actual application origin and exact immutable edition.
- Complete handoff JSON with the original imported customer API sources, data review, merchant package/release references, and operator requirements.

CSV leaves absent values blank. Its precipitation probability column is the original fraction. The browser formats that value as a percentage. Use the review or handoff's unit metadata when loading CSV into another system.

### 4. Export through the original merchant compiler

Under **API integration**, either create a new merchant package with the customer's authorized payment settings and exact atomic price strings, or select an existing original SF61 package to refresh.

The authored customer adapter exposes two operations:

- `GET /current`
- `GET /hourly?offset=0&limit=100`

Its backend is the running weather application's exact immutable edition. The backend uses `x-weather-token` from `OPENWEATHER_APP_TOKEN`, which is supported by the original SF61 backend-header contract. The provider's `appid` remains inside the acquisition process.

This OpenAPI is the **customer adapter contract**; the separately linked One Call documentation remains the provider contract. No replacement merchant compiler is introduced.

Review the original effective routes, backend URLs, required environment variables, response contracts, and atomic prices before export. For a source refresh, the existing `createRefreshReview` report identifies the necessary retained/remapped/removed/added operation decisions. Supply that report's actual decisions and review again until it is ready.

The saved integration review preserves its exact source, plan, original source-refresh report, package directory, and preview. **Reopen saved integration** restores it after a restart. Export is create-only: repeating an interrupted export reopens a completed package only when its original inputs and compiled bytes match the saved review. A conflicting package name remains unchanged and requires a new name.

The application calls the maintained `prepareMerchant`, `savePackage`, `createRefreshReview`, and `exportRefreshReview` APIs. Existing package history stays with the original merchant workspace.

### 5. Stage, operate, and roll back the original release

Under **Deployment**, choose an exported original package and stage a named SF82 release. Choose the seller listen port and, when applicable, the authorized HTTPS facilitator. The original challenge-preview mode is available when no facilitator is configured.

Staging verifies the original package, retains its exact provenance, and uses the original release compiler. The console shows the actual release generation and comparison. Selection requires that observed generation; concurrent selection changes require a fresh comparison.

**Start selected original seller** starts the actual maintained release process and shows its URL and mode. **Drain and stop owned seller** closes that process through its original lifecycle. Selecting or rolling back a release drains the process owned by this application before changing selection; start the selected release afterward.

A previous release can be selected through the original SF82 rollback mechanism. Its source and runtime identity stay intact. A repeated interrupted stage is accepted only when the retained package provenance and runtime match.

Direct customer data selection and merchant release selection have different lifetimes:

- `/weather/PROJECT/active/...` follows the selected direct data edition.
- A compiled merchant package binds a specific immutable edition. Refreshing its data requires a new integration review/export/stage and a reviewed original release selection.

This keeps a saved merchant release reproducible while the direct customer API can receive scheduled updates.

## Provider field and time contract

Primary source: [OpenWeather One Call 4.0](https://openweathermap.org/api/one-call-4), read 2026-10-11.

Current endpoint: `https://api.openweathermap.org/data/4.0/onecall/current`.

Hourly endpoint: `https://api.openweathermap.org/data/4.0/onecall/timeline/1h`.

Requests use latitude, longitude, `appid`, the selected unit mode, optional language, and hourly `start` in Unix seconds. The application consumes the original `data` array and preserves sanitized source pages. It accepts a continuation only on the same HTTPS provider origin and selected endpoint, with the same location, units, and language. It tolerates the documented-style coordinate rounding in returned links, strips any echoed key, and requires a forward hourly cursor.

| Provider field | Customer field | Meaning |
|---|---|---|
| `dt` | `at` | Exact Unix seconds UTC |
| `temp`, `feels_like`, `dew_point` | `temperature`, `feelsLike`, `dewPoint` | K for standard, °C for metric, °F for imperial |
| `wind_speed`, `wind_gust` | `windSpeed`, `windGust` | m/s for standard/metric; mph for imperial |
| `wind_deg` | `windDirection` | Meteorological degrees |
| `pressure` | `pressure` | hPa |
| `humidity`, `clouds` | `humidity`, `clouds` | Percent |
| `visibility` | `visibility` | Metres |
| `uvi` | `uvIndex` | UV index |
| `rain.1h`, `snow.1h` | `rainRate`, `snowRate` | mm/h in every unit mode; absence retained |
| `pop` | `precipitationProbability` | Fraction from zero to one |
| `sunrise`, `sunset` | `sunrise`, `sunset` | Unix seconds; polar absence retained |
| `weather`, `alerts` | `weather`, `alertIds` | Original condition objects and alert identifiers |

The provider's returned latitude/longitude, IANA timezone, and timezone offset are retained with each page. Ordering, coverage, and joins use UTC timestamps. Browser and CSV local displays use the IANA timezone, so daylight-saving changes are resolved for each timestamp instead of applying one fixed offset to an entire timeline.

## Node and TypeScript customer client

```js
import {createWeatherClient} from './client.mjs';

const weather = createWeatherClient({
  url: 'http://127.0.0.1:8428',
  token: process.env.OPENWEATHER_APP_TOKEN
});

const current = await weather.current('customer-weather');

for await (const hour of weather.hourly('customer-weather', {limit: 100})) {
  console.log(hour.at, hour.temperature, hour.rainRate);
}
```

`client.d.mts` describes current/hourly records, coverage, response envelopes, pagination, and client options. The hourly iterator pins the first returned data-edition identity before reading the next page, so a concurrent direct selection cannot mix two editions. Pass a specific review identity when the caller already has one.

The client validates response identity and forward pagination, bounds response size, and applies a request deadline. The application API uses `x-weather-token` on every customer request. The console and customer API use separate credentials.

## Scheduled refresh

Schedules run inside the application process. Set an interval of at least ten minutes and the desired forward hourly window. Each scheduled acquisition uses the same project revision, call ledger, provider continuation, and retained responses as an interactive acquisition.

Automatic direct-data selection requires an initial manually reviewed edition with the same project settings and field mapping. Only complete refreshes without unresolved conflicts are automatically selected. A paused or failed scheduled job remains the same pending job for inspection and explicit continuation. The scheduler does not silently retry authentication or quota failures. Restarting the app preserves its next due time and pending job.

A project settings change disables its schedule. Review an edition of the new revision and configure the schedule again. Schedules run while this application process is active; use the host's existing supervisor to keep it running.

## Headless commands and input files

Run `node openweather/cli.mjs --help` for the complete command list. The browser process must release the private store before a headless command opens it. Headless commands return structured JSON.

A project settings file has this shape; replace the example location and policy with the customer's choices:

```json
{
  "label": "Customer weather",
  "lat": 48.8566,
  "lon": 2.3522,
  "units": "metric",
  "lang": "en",
  "keyEnv": "OPENWEATHER_API_KEY",
  "maxPages": 25,
  "timeoutMs": 20000
}
```

```sh
node openweather/cli.mjs project --store /absolute/private/weather-customer --project customer-weather --input settings.json --expect 0
node openweather/cli.mjs account --store /absolute/private/weather-customer --input allowance.json
node openweather/cli.mjs source --store /absolute/private/weather-customer --project customer-weather --file original-api.yaml --name "Customer API"
node openweather/cli.mjs acquire --store /absolute/private/weather-customer --project customer-weather --start 2026-10-12T00:00:00Z --end 2026-10-13T00:00:00Z --request-id customer-weather-oct12
```

Allowance JSON contains `label`, `keyEnv`, explicit ISO `start`/`end`, `limit`, and `externalCalls`. Choose the actual current window and account allowance. A start/end supplied to `acquire` must use exact Unix seconds or an ISO timestamp with an explicit UTC offset and whole-hour boundaries.

| Command | Main inputs |
|---|---|
| `resume` | `--job`, optional `--extra-pages`, explicit `--acknowledge-unknown` when needed |
| `inspect` | `--job`, optional conflict policy |
| `review` | `--job`, optional notes file, explicit partial acceptance and conflict decision |
| `select` | `--project`, `--review`, expected project revision |
| `rollback-data` | Project and expected currently selected review |
| `export` | Project, review, new output file, JSON/CSV/NDJSON/handoff format |
| `integration-review` | Input JSON, actual application origin, optional original package directory |
| `integration-export` | Project, saved integration review, new package name |
| `stage` | JSON with project, exported package, release id, optional label/port/facilitator |
| `deployment` / `diff` | Current release state or named release comparison |
| `activate` / `rollback` | Original release identity and observed generation |
| `schedule` | JSON with project, expected revision, enabled, intervalMinutes, hours, autoSelect |
| `backup` / `restore` | New backup output file or a backup and a new private store |

A new integration input contains `project`, `review`, `sellerServer`, authorized `payment`, and `amountAtomic: {"current":"...", "hourly":"..."}`. Atomic prices remain decimal strings. A refresh input contains `project`, `review`, `baseline`, and the original source-review `decisions`.

## Restart, backup, and handover

The weather workspace backup includes projects, settings revisions, call accounting, original imported API documents, sanitized provider responses, immutable data editions, saved integration source/plan reviews, export/stage references, and selection history.

Restore into a new private directory:

```sh
node openweather/cli.mjs backup --store /absolute/private/weather-customer --out weather-backup.json
node openweather/cli.mjs restore --store /absolute/private/weather-recovered --file weather-backup.json
```

The weather backup validates every member's name, size, and SHA-256 before creating its new store. It preserves uncertain requests and used call counts. The original merchant packages and SF82 release store belong in the host's existing backup alongside this file; the weather JSON retains their references and does not embed those separate trees.

For an ordinary process restart, reopen the same private directory. A dead local process lease is recoverable after its ownership is checked. A live or another-host lease requires releasing the exact current owner. Keep the original private path and application port when restoring the host as a whole so saved package paths and upstreams remain valid. If paths or ports change, create a source refresh from the restored reviewed data and export a new original merchant package.

The handover consists of the source subtree, this guide, the selected review/handoff JSON, the customer's original API sources, the original merchant package and release store, the private workspace backup, and the existing host's credential/supervisor configuration. Credential values stay in the host's authorized secret custody.

## Implementation joins

| Module | Responsibility |
|---|---|
| `contract.mjs` | Provider endpoint, continuation, field, unit, time, and error adaptation |
| `store.mjs` | Exclusive private store, atomic writes, retained members, backup and restore |
| `acquisition.mjs` | Call reservations, native HTTP acquisition, interruption recovery, coverage and data editions |
| `integration.mjs` | Original SF61 source/package APIs and original SF82 release lifecycle |
| `delivery.mjs` | Customer exports, handoff and scheduled acquisition |
| `server.mjs` | Private operator API and header-authenticated customer data API |
| `browser.mjs`, `index.html`, `style.css` | Reopenable operator workflow |
| `client.mjs`, `client.d.mts` | Node/TypeScript customer consumption with edition-pinned pagination |
| `cli.mjs` | Headless and browser entrypoints over the same engines |

All source is additive under the existing SF61 component. Shared source-review, workspace, merchant compilation, runtime, and release ownership remain with their maintained implementations.
