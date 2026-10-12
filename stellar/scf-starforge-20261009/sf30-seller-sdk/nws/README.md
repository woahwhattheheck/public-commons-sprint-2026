# Site Weather Operations

Site Weather Operations turns a saved portfolio of US sites into reviewable National Weather Service source editions and original Stellar Forge datasets. A staff member can choose a site, collect its current source resources, review forecasts and observations, compare editions, record decisions, publish a selected table and receive the original customer files in one workspace.

The seven console sections are **Sites**, **Source captures**, **Weather review**, **Editions and changes**, **Staff review**, **Datasets and publishing**, and **Customer handover**. The layout uses a grayscale industrial interface, ordinary controls and readable source tables. On narrow screens, site, dataset and release records become labeled cards; wide weather tables scroll inside their own table area.

## Start or reopen the workspace

Use the installed SDK runtime or run the source-owned browser command from the seller SDK directory:

~~~sh
node nws/workspace.mjs \
  --workspace /private/site-weather \
  --user-agent 'WeatherOperations/1.0 (operations@example.org)' \
  --startup-format json
~~~

Replace the example User-Agent with the responsible operator’s identifier. NWS requires an identifying User-Agent for API requests. The application includes a default identifying project URL; an organization can supply its own value.

The startup descriptor contains the exact workspace UUID, directory, source directory, selected User-Agent, process ID and private session URL. Its schema is `stellar-forge.nws-workspace-startup.v1`, with status `NWS_READY`. Open the complete URL, including its fragment, in the browser. The fragment establishes the local session and is removed from the displayed URL. The browser keeps the session token in session storage.

Stop with Ctrl+C. To reopen the same work, use the same directory. When an installed launcher already knows the workspace UUID, it supplies `--expected-workspace-id` to check that the selected directory still contains that workspace.

Additional options:

| Option | Purpose |
| --- | --- |
| `--port 0` | Select an available loopback port. A specific local port can also be chosen. |
| `--inbox /private/original-inbox` | Bind the original SF88 inbox for customer receiving. |
| `--release-runtime /private/release-runtime.json` | Select the original publisher’s port and facilitator configuration. |
| `--expected-workspace-id UUID` | Reopen the previously selected workspace identity. |
| `--startup-format json` | Emit the descriptor consumed by CLI clients and the managed launcher. |

A release runtime file accepts `port`, `facilitator` and `allowLocalFacilitator`, through the existing SF82 runtime normalizer. Keep the workspace, inbox, runtime file and startup descriptor in their intended private locations. A running console is the writer for that directory. Its command-line client uses the same running session instead of opening a second writer.

The managed application is `nws-site-weather`. Its `nws-workspace` command launches this browser server; `nws` runs the separate action CLI, and `nws-mcp` runs the typed client. See [MANAGED.md](MANAGED.md) for the source-owned Applications integration and [MCP.md](MCP.md) for the agent and receiving interface.

## 1. Establish the site portfolio

Choose **Sites → Add site**. Enter the site’s name and decimal latitude and longitude. Coordinates are normalized to four decimal places for the NWS point request. Add a responsible team or owner and any site instructions that should accompany its future editions.

The preferred station is optional. With an empty preference, a capture selects the first station in the actual provider catalog. To use a particular station, save the identifier published in that site’s station catalog. If the preferred identifier is absent from a later catalog, the capture offers the actual available stations for selection.

An existing site can be edited or archived. Archiving ends new collection for that site; its previous editions, decisions, datasets and deliveries remain part of the saved workspace. **Reopen site** makes it available for collection again. Site edits keep the previous settings in site history, and existing editions retain the site settings that were selected for their capture.

A site’s grid cell is discovered again during each capture. The application follows the forecast, hourly forecast, raw grid and station URLs returned by the current point response. The retained Washington Monument example illustrates why this matters: the current source mapping in that package is LWX 97,71, while an older documentation example used a different grid cell.

## 2. Collect or import original source

Choose **Capture** on a site. All weather products are selected by default:

- Forecast periods.
- Hourly forecast periods.
- Every interval-valued layer in the raw grid response.
- Observations from the selected station and requested interval.
- Active point alerts and the recent point alert history.

The point response and station catalog also travel with the capture. Enter observation start and end times as ISO 8601 values with `Z` or a numeric UTC offset. The default interval is the preceding 24 hours. The capture records the selected interval before collection begins.

Forecast units can be US or SI. Grid and observation measurements keep their original provider unit codes. The application does not interpolate grid values or convert source nulls into zero.

A capture has its own stable ID, selected site, query, source tasks and response checkpoints. **Source captures** shows each task’s state, record count, received pages, continuation and error details. One unavailable or failed source resource does not discard the other completed resources.

### Source continuation

The provider’s returned continuation URL drives collection. An empty collection page completes that resource even when the response advertises another cursor. Its unused cursor stays in the coverage record.

For observation history, the application retains the requested start and end separately from the returned cursor. If the provider’s descending observation page reaches the requested lower boundary, collection ends there. Received records outside the selected interval remain in the original response; the weather table projects records inside the interval.

This behavior follows the actual retained source responses. In the reference package, an empty station continuation still advertises another page, and the observation cursor drops the explicit time filters. Both original responses are included in the package.

### Pause, resume and interrupted work

Choose **Pause** to stop an active capture. Completed responses are retained before task progress moves to the next resource. Choose **Continue capture** to resume the same saved query and checkpoints.

After a process restart, queued or running captures are shown as paused. Resume the selected capture. A source timeout, rate limit or storage failure leaves the original operation and preceding completed source available. A provider Retry-After value is retained and observed. Identical initial alert collections also observe the NWS guidance of at least 30 seconds between polls.

A capture becomes complete when its requested tasks have completed or the current point source marks a resource unavailable. A partial capture can still form a source edition for review. Continuing the capture produces another immutable edition when its source coverage changes.

### Import a source package

Choose **Import source** and select a saved site with the package’s exact normalized coordinates. Upload either:

- An exported `stellar-forge.nws-capture-package.v1` source package.
- The retained `commons.nws-source-capture.v1` reference package supplied with this application.

Import uses the complete source response bodies and their original metadata. Each declared byte count and SHA-256 is checked. A native HTTP 304 revalidation retains its earlier data body and its separate wire response. Both identities survive source export and import.

The original imported package stays in the edition’s provenance, including supplementary source pages outside the table selection. A portable re-export carries those supplementary pages forward without adding them to the selected weather table.

## 3. Review the weather edition

Open an edition from **Source captures** or **Editions and changes**. Its overview shows source coverage, current grid mapping, station selection, observation interval, source retrieval information and original response pages.

The available tables are:

| Table | Meaning |
| --- | --- |
| Forecast periods | Each original forecast period, its temperature and description. |
| Hourly forecast | Original hourly periods and associated forecast fields. |
| Grid intervals | Every interval-valued source layer, with its original field, unit and interval. |
| Observation history | Measurements and conditions from records inside the selected station interval. |
| Most recent captured observation | The most recent observation within this edition’s selected interval. |
| Active alerts | The active point alert collection captured for this edition. |
| Alert history | The recent historical point alert collection and its continuation. |
| Observation stations | The station catalog returned for this point mapping. |

Each projected row retains its original response hash, source record location and source URL. **Details** shows the complete projected row, including the original structured period, measurement, alert or station details. **Source** opens the complete retained response text. A source response can also be downloaded directly.

Weather pages display up to 100 rows. **Previous page** and **Next page** move through the table. The text filter applies to the displayed page; the dataset query interface supports filtered access across a complete prepared table.

### Values, times and units

The projection keeps `value`, `valueType`, `unitCode` and `qualityControl` separate. A source null is the string `null` with `valueType` equal to `null`; an absent value is represented separately. Structured source values remain available in `detailsJson`. Geometry stays in `geometryJson`, including legitimate null alert geometry.

The original `validTime`, `validFrom` and `validUntil` remain attached. Explicit endpoints and fixed time durations can be resolved into endpoints. Calendar durations and source literals such as `NOW` remain source literals when fixed endpoints cannot be resolved.

Separate `validFromUtc` and `validUntilUtc` columns normalize explicitly zoned endpoints for chronological dataset filtering and sorting. They leave unresolved endpoints empty. This keeps the original source spelling while making comparisons across UTC offsets useful.

Forecast generation, observation measurement, alert issue/expiry and source retrieval times retain their own meanings. For imported captures that supplied only a retrieval date, the console shows that date. It does not substitute the later import time as a source retrieval timestamp.

The NWS documentation explains that observation values can arrive after quality-control processing and that some source measurements can remain null. Review the source’s quality metadata alongside an operational decision.

## 4. Compare editions and preserve staff decisions

Choose **Editions and changes → Compare editions**. Select two editions of the same saved site and the same forecast units. Observation comparisons also require the same source station. Select the table to compare.

The comparison reports added, removed, changed and unchanged source records. Changed records show each changed field and its before/after values. The screen presents an initial set of differences; **Download complete comparison** contains the complete comparison. Duplicate source record IDs are retained as comparison details.

Forecast period numbers can shift as the forecast advances. Comparison identity follows source intervals rather than treating the period’s ordinal number as a weather change. The original period number remains in the original response.

The comparison also includes both captures’ queries and coverage. A difference between observation windows remains visible as part of the comparison’s scope. Reopen saved comparisons from the same section.

Choose **Staff review → Add review**, or start a review from an individual weather row. Enter a subject, decision or follow-up note and one of:

- **Open**.
- **Reviewed**.
- **Follow-up required**.

The note attaches to the exact source edition. Updating a saved review preserves its previous note, status and update time. A source-package export carries these decisions to a receiving workspace and records their original imported identity.

### Concurrent edits and reply recovery

Every new action uses the workspace revision displayed when its form was opened and a stable operation ID. The browser retains entered values and the pending action in session storage when space permits.

Source imports accept a file up to 60 MiB. Their saved form contains the file name, size, content fingerprint and original operation, with the source body kept out of session storage. After a page reload, reopen the saved form and select the same source package. The browser checks the parsed package’s SHA-256 and restores it to the original request. An unchanged import recovers the original result. Choosing a different package or changing other fields creates a new action. The browser retains the small pending form before dispatching an import.

If the workspace changes while the form is open, choose **Review latest saved view**. Read the relevant current site, edition, note or publisher state. Then choose **Use this revision and keep my form**. The entered fields remain in place; a release operation also adopts the generation that was actually reviewed.

When a request’s response is interrupted, submit the unchanged form or choose **Continue saved action**. The server resolves the original operation before checking the current workspace revision. A completed action returns its saved result. A changed payload receives a new operation identity.

## 5. Prepare and query the original dataset

Choose **Prepare dataset**, select an edition and weather table, and name the dataset. The application writes an original SF30 CSV dataset configuration, the selected rows and its complete source provenance.

The prepared dataset includes:

- `dataset.csv` with 29 declared columns.
- `dataset.json`, consumed by the original dataset handler.
- `source.json` with source contract, edition summary, table and projection meaning.
- `provenance/source-edition.json` with the complete edition and original response metadata.
- The original response bodies and separate revalidation wire bodies in `provenance/`.
- The original imported capture package when the edition came from an import.

The dataset’s immutable snapshot identifies its exact configuration and row bytes. Open **Inspect dataset** to see the original description and declared query capabilities.

Choose **Query**. The request is one URL-encoded query string under the original SF30 contract. Examples:

~~~text
limit=50
limit=50&where_field=temperature
fields=validFromUtc,field,value,unitCode&where_field=temperature&sort=validFromUtc&limit=50
where_stationId=KDCA&sort=-validFromUtc&limit=50
gte_validFromUtc=2026-10-12T03%3A45%3A00.000Z&lte_validFromUtc=2026-10-12T04%3A15%3A00.000Z&limit=50
~~~

Equality filters are declared for `siteId`, `table`, `field`, `stationId`, `status`, `severity`, `recordId` and `unitCode`. Chronological string ranges are declared for the two normalized UTC endpoints, using `gt_`, `gte_`, `lt_` or `lte_`. Sorting is available for `validFromUtc`, `validUntilUtc`, `field` and `stationId`; a leading minus selects descending order.

The handler returns an opaque `nextCursor` in its page metadata. **Next result page** reuses the query with that exact cursor. The cursor belongs to the selected snapshot, filters, field selection and ordering. Start a new query when those choices change. Dataset pages default to 50 rows and allow up to 200 rows within the original response byte limit. A prepared dataset, table review export or comparison accepts a complete selected table of up to 250,000 rows; a larger table returns an explicit capacity error before producing a partial output. For larger tabular projections, use the complete source package or the individual source response downloads. The CSV dataset observes its original 256 MiB capacity. Each saved export or comparison also accepts up to 256 MiB, including JSON and base64 encoding; an oversized output returns a capacity error before it is saved. Original response files remain available individually.

## 6. Operate the original publisher

Choose **Prepare release** on a prepared dataset. Enter the reviewed public origin and route, payment scheme, network, asset, atomic amount, merchant account and timeout.

This operation composes the existing SF30 dataset seller configuration, original dataset publisher and SF82 release store. It copies the complete selected source package into the release and retains the original snapshot and release digest. The NWS source API itself is free; the release is the operator’s prepared dataset service.

The release controls expose the original store:

1. **Inspect** reads the selected release, publisher state, routes and original handoff paths.
2. **Activate** selects that release using the reviewed current generation.
3. **Start** starts the selected original publisher.
4. **Stop** stops that publisher.
5. **Roll back** selects the previous retained release through the original store.

The console owns the running publisher process. Use the same console session for persistent start/stop work. The standalone action CLI requires `--session` for `release.start`, so the publisher remains under the running workspace process.

The displayed runtime mode is derived from the supplied original facilitator configuration. Configure the reviewed network and facilitator for the intended deployment. Customer payments and outcomes use the existing seller and buyer engines and their original request records.

## 7. Receive and deliver customer files

Start the workspace with `--inbox` pointing to the original SF88 buyer inbox. Under **Customer handover**, inspect the exact original intent IDs in page order.

**Inspect buyer intents** reads each original intent, state, attempt and outcome. **Receive dataset** passes that same selection to the original SF88 queue dataset exporter and SF100 receiving engine. It reassembles the retained buyer outcomes and checks their output identities.

A complete customer receipt exposes five original files:

| File | Customer use |
| --- | --- |
| `dataset.csv` | The received tabular data. |
| `dataset.jsonl` | The same delivery as JSON Lines. |
| `review.html` | The original readable customer review. |
| `delivery.json` | The original inbox selection and dataset delivery record. |
| `manifest.json` | The original output identities and dataset manifest. |

Each download is read from that saved delivery and checked against its recorded bytes and hash. A resumed incomplete assembly uses the same original inbox selection and preserves its interrupted output directory before reassembly.

Edition exports are also available in this section:

- **JSON review** includes the edition, selected table, all its rows and staff decisions.
- **Spreadsheet CSV** protects formula-leading text for spreadsheet use; the JSON and original response retain the source values.
- **Printable HTML review** carries source coverage, staff review, table rows and original response metadata.
- **Complete source package** carries the retained source and decisions into another workspace.

For a receiving workspace, create a site with the same coordinates, import the complete source package, review its original coverage and continue the same staff workflow. For a process restart on the same machine, reopen the existing private directory and UUID.

## Command-line work

The action CLI accepts a private workspace that is not already open, or the original startup descriptor of a running session.

~~~sh
node nws/cli.mjs --session /private/nws-startup.json view
node nws/cli.mjs --session /private/nws-startup.json schema
node nws/cli.mjs --session /private/nws-startup.json action --request /private/original-action.json
~~~

An action file uses the same four-field envelope as the browser:

~~~json
{
  "action": "site.save",
  "payload": {
    "label": "Washington Monument",
    "latitude": 38.8894,
    "longitude": -77.0352,
    "stationId": "KDCA",
    "owner": "Operations",
    "note": "Review the original source edition.",
    "active": true
  },
  "operationId": "washington-site-create-20261012",
  "expectedRevision": 0
}
~~~

Use the current revision from `view` when creating a new action. Retain the original operation ID and payload to recover its result after an interrupted response.

The convenience commands `collect` and `import-source` require a saved site ID and stable operation ID:

~~~sh
node nws/cli.mjs --session /private/nws-startup.json import-source \
  --site-id SITE_ID --operation-id weather-source-import-20261012 \
  --file nws/examples/washington-monument-source-20261012.json

node nws/cli.mjs --session /private/nws-startup.json collect \
  --site-id SITE_ID --operation-id weather-current-capture-20261012 \
  --start 2026-10-12T00:00:00Z --end 2026-10-13T00:00:00Z
~~~

The collection commands wait until the selected capture finishes, becomes partial, awaits a station or pauses. Their result contains that actual capture state.

Use `rows` to read a weather table; `source` to save an original response; `download` to save a prepared edition export; and `receive-file` to save one of the five original customer files. File commands require a new output path and create it exclusively. Run `--help` for the paired options.

The complete native action vocabulary is:

| Area | Actions |
| --- | --- |
| Sites | `site.save`, `site.archive` |
| Collection | `capture.start`, `capture.resume`, `capture.pause`, `capture.station`, `capture.import` |
| Editions and review | `edition.select`, `edition.compare`, `annotation.save` |
| Dataset | `dataset.prepare`, `dataset.query` |
| Publisher | `release.prepare`, `release.inspect`, `release.activate`, `release.start`, `release.stop`, `release.rollback` |
| Customer receiving | `buyer.inspect`, `buyer.receive` |
| Export | `export.create` |

## Retained reference source

[examples/washington-monument-source-20261012.json](examples/washington-monument-source-20261012.json) is the complete retained source container, 608,872 bytes with SHA-256 `9a1a99def2fff2d32c9849ca613d867d007f40e1600610b7b436c190357f4563`.

It contains 11 original connector-extracted response texts totaling 551,803 bytes. The selected source includes 14 forecast periods, 156 hourly periods, every returned grid layer, 54 stations, seven observations in the recorded half-hour interval, an empty active alert collection and three historical alerts with their empty continuation. A separate five-observation page is retained as supplementary original source.

The source capture supplied a retrieval date and complete body text, without observed HTTP status or headers. Those fields remain explicitly unobserved. Its import exercises the same source decoding, station selection, continuation, edition, projection and publishing code as native capture.

## Source contract and implementation map

The source adapter follows the first-party [NWS Web Service documentation](https://www.weather.gov/documentation/services-web-api), [alert service documentation](https://www.weather.gov/documentation/services-web-alerts), [API FAQs](https://github.com/weather-gov/api/blob/694ed0f5526336e58d513a8b8a2b313d7896bbf7/general-faqs.md), and [gridpoint guidance](https://github.com/weather-gov/api/blob/694ed0f5526336e58d513a8b8a2b313d7896bbf7/gridpoints.md).

The reference OpenAPI contract is the first-party [weather-gov/api specification](https://github.com/weather-gov/api/blob/694ed0f5526336e58d513a8b8a2b313d7896bbf7/assets/openapi.yaml), commit `694ed0f5526336e58d513a8b8a2b313d7896bbf7`, blob `5ce3a5b94c6df769a55433498e615ec16093e37d`. That pinned document identifies its reference version as 1.9.0. Each actual capture retains the provider’s current returned fields, resource URLs and available transport metadata.

| Source | Responsibility |
| --- | --- |
| `schema.mjs` | Source contract, 21 action payloads, tables and 29 columns. |
| `provider.mjs` | Current point resource graph, NWS HTTPS, response decoding, source import and continuation. |
| `domain.mjs` | Source-faithful rows, UTC endpoints, comparisons and complete exports. |
| `core.mjs` | Site lifecycle, retained operations, capture checkpoints, immutable editions and composed native actions. |
| `dataset.mjs` | Original SF30 dataset preparation and original publisher/customer composition. |
| `workspace.mjs` | Private loopback server and startup descriptor. |
| `cli.mjs` | Original workspace actions and file operations from a shell. |
| `web/` | Complete seven-section operator console. |
| `mcp.mjs`, `mcp-protocol.mjs`, `mcp-client.mjs` | Typed agent tools and original file receiving. |
| `../stellar-expert/store.mjs` | Shared private writer, immutable objects, response checkpoints and edition store; its existing default workspace behavior is preserved. |

The storage engine retains original operation results, current selection, revisions, immutable source objects and source editions. Dataset, publisher, release and receiving work use their existing implementation and storage formats. This source adds the site-weather workflow and composes those engines through their original interfaces.
