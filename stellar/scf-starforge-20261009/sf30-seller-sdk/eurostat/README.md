# Eurostat economic workspace

Turn a complete official Eurostat response into a reviewed, versioned merchant dataset and an economic briefing. One saved project owns acquisition history, retained responses, source selections, publication plans, native dataset editions and the configured buyer handoff.

The included product starts with **576 original monthly observations for 2024–2025** from Eurostat **UNE_RT_M**: Germany, Spain, France and Italy; total and under-25 ages; total, male and female populations; seasonally adjusted labour-force percentages. A complete original response, immediately usable HTML/JSON/CSV briefing and reviewed source handover are included. [SOURCE.md](SOURCE.md) retains the original URL and response identities.

## Open the finished briefing

[Complete economic briefing](examples/briefing-20261012/briefing.html) · [Structured briefing](examples/briefing-20261012/briefing.json) · [Exact observation CSV](examples/briefing-20261012/observations.csv) · [Original response](examples/briefing-20261012/original-response.json).

The briefing contains every selected cell, 24 monthly series and their latest selected month compared with the same month one year earlier. For total age/total sex, December 2025 values are Germany 3.9, Spain 10.2, France 8.0 and Italy 5.7 percent of the labour force. Their changes from December 2024 are +0.4, −0.6, +0.7 and −0.7 percentage points. The production report generator derives these values from the retained original response. The edition was retrieved on 2026-10-12 and retains the publisher update of 2026-10-08; the selected period ends in December 2025.

## One application, maintained engines

The Eurostat driver plugs into the original SourceDatasetPublisher in ../postgres/publisher/model.mjs. It uses that engine’s private workspace lease, SQLite history, extraction limits, dataset loader, candidate review, snapshot store, publication recovery and scheduler. Its console extends the original browser server. Merchant releases use SF82’s existing dataset package and complete sourceFiles copier. The native receiver uses SF88 Buyer.createDataset, the original page session and finalizeAll with its original workspaceDirectory, followed by SF100 delivery and saved-delivery reopening.

| Source | Responsibility |
| --- | --- |
| model.mjs | Lossless JSON-stat parsing, coordinates, selections, missing/status states and edition comparison |
| source.mjs | Official URL validation, single-GET acquisition, exact response retention and source declarations |
| driver.mjs / publisher.mjs | Reviewed source extraction inside the maintained dataset publisher |
| workspace.mjs | Saved project, imports/exports, acquisition continuation and source-review binding |
| server.mjs / public | Local source console and original publisher workflow |
| report.mjs | Complete HTML/JSON/CSV briefing with exact decimal comparisons |
| release.mjs | Source-complete SF82 merchant package, staging, activation and supervised runtime |
| client.mjs / client.d.ts | Typed installed client for the same local application |
| mcp.mjs | 26 standard MCP tools over the original local listener |
| receiving.mjs | Resumable source→publication→merchant→buyer→accounting→delivery operation |

## Runtime and first launch

Use Linux, **Node 24 LTS**, and util-linux **flock**. The source adapter and report generator add no third-party runtime dependency. They consume the maintained repository’s publisher, dataset, SF82 and SF88 modules. A native buyer uses its existing runtime, signer, operator profile, original ledger and account resources.

The source-owned distribution contribution registers **stellar-forge eurostat**, package exports beneath **./seller/eurostat**, and **Eurostat economic workspace** in Applications. Source users invoke the same CLI directly:

~~~sh
EUROSTAT_SOURCE=/absolute/repository/stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat
EUROSTAT_PROJECT=/absolute/private/eurostat-project

node "$EUROSTAT_SOURCE/cli.mjs" init --workspace "$EUROSTAT_PROJECT"
node "$EUROSTAT_SOURCE/cli.mjs" import-handover \
  --workspace "$EUROSTAT_PROJECT" \
  --file "$EUROSTAT_SOURCE/examples/reviewed-source-handover.json"
node "$EUROSTAT_SOURCE/cli.mjs" serve --workspace "$EUROSTAT_PROJECT" --port 8468
~~~

Open the actual printed local URL. The handover includes the complete original response, its actual retrieval metadata, all original dimensions and the reviewed unemployment selection. Choose **Create full extraction plan**, select the saved plan below, extract, review the actual target and publish. A first publication initializes the original dataset version store. The merchant release controls retain that exact published edition and the operator’s configured payment terms.

Reopen using the same serve command and project path. The saved project.json binds its original source, publisher and dataset directories. Stop the existing listener before opening that project through another CLI; its original Linux lease enforces one writer.

## Acquire another edition

The console accepts the direct Eurostat Statistics API URL. The installed command accepts [the included source query](examples/source-query.json):

~~~sh
node "$EUROSTAT_SOURCE/cli.mjs" acquire \
  --workspace "$EUROSTAT_PROJECT" \
  --input "$EUROSTAT_SOURCE/examples/source-query.json"
~~~

An acquisition ID binds the exact URL, timeout and size settings. Its intent is retained before one public GET. Every attempt records the actual HTTP status, public headers, returned body or received prefix, completion state, timestamps and error. Only a complete successful JSON-stat response becomes a source capture.

Eurostat can return an asynchronous warning with status 413. Keep the original request and operation ID, then set **continueExisting: true** when requesting another check. Each explicit continuation records one further GET under that same acquisition. Completed captures are reused.

The URL builder supports EN/FR/DE, repeated native dimension filters, exact periods, since/until ranges and lastTimePeriod. It reads the returned category order. A unavailable filter may yield a zero-sized dimension; a latest-period selection may yield a populated cube with absent values. The project retains and distinguishes both source states.

## Import a complete original response

The included original body can also be imported separately with its exact acquisition metadata:

~~~sh
node "$EUROSTAT_SOURCE/cli.mjs" import \
  --workspace "$EUROSTAT_PROJECT" \
  --file "$EUROSTAT_SOURCE/sources/une_rt_m-2024-2025.original.json" \
  --input "$EUROSTAT_SOURCE/examples/original-acquisition.json"
~~~

The input reader accepts ordinary repository files, then retains private exact copies. Source numeric spelling is preserved. Imports retain the actual URL, retrieval time and carrier description. The included native public-attachment acquisition preserves its original upload ID and complete UTF-8 result.

Saving a source query binds its capture, dimension codes, missing-cell choice, reviewer, note, intended use, reuse basis, exact selected geographies, attribution and adaptation notice. It requires the displayed current source hash. The included reviewed-query.json is bound to a fresh project containing just this capture. In an existing project, the browser/client uses its actual current source hash.

## Exact values and original status

JSON-stat’s last dimension changes fastest. The adapter validates complete id/size order and each category index before computing coordinates. Dense arrays, sparse objects and metadata-only arrays have separate interpretations.

| Original source condition | Published value | Companion state |
| --- | --- | --- |
| JSON number 3.0 | String 3.0 | value_state=VALUE |
| Explicit JSON null | Empty string | value_state=NULL |
| Sparse position absent | Empty string | value_state=ABSENT |
| Global status string | Original string | status_state=GLOBAL |
| Status present at cell | Original string | status_state=PRESENT |
| Explicit status null | Empty string | status_state=NULL |
| Status absent | Empty string | status_state=ABSENT |

Each dimension has an original code and label column. Cell index is an exact integer. Observation and status columns are nonnullable strings, with companion states retaining the native distinctions within the existing CSV contract. Decimal observations are never converted to binary floating point for storage or comparisons.

The original response and metadata stay in every plan capture and merchant package. Dataset-wide annotations keep their original scope; selected counts are calculated from this response. Default extraction order is original cell index. Other reviewed string-column orders are lexical, with original index as the stable tie break. A complete selected result must finish within the declared native row, byte and deadline limits before becoming a candidate.

## Installed publication commands

~~~sh
node "$EUROSTAT_SOURCE/cli.mjs" template \
  --workspace "$EUROSTAT_PROJECT" --query unemployment --out /absolute/private/unemployment-plan.json
node "$EUROSTAT_SOURCE/cli.mjs" save \
  --workspace "$EUROSTAT_PROJECT" --input /absolute/private/unemployment-plan.json
node "$EUROSTAT_SOURCE/cli.mjs" extract --workspace "$EUROSTAT_PROJECT" --plan RETURNED_PLAN_NUMBER
node "$EUROSTAT_SOURCE/cli.mjs" inspect --workspace "$EUROSTAT_PROJECT" --run RETURNED_RUN_UUID
~~~

The original review command returns the retained run with its **data.review.id**. Publish with that exact review ID. For an existing running target, review its current snapshot and revision. The publisher validates the full query contract and actual target binding. **publisher-help** lists every original review, publish, recovery, buyer and schedule option; workspace arguments always name the Eurostat project.

## Briefings and complete source handover

~~~sh
node "$EUROSTAT_SOURCE/cli.mjs" briefing \
  --workspace "$EUROSTAT_PROJECT" \
  --id d233dffca23950f40743535de9b76b98c3a9c25b0ad0e32610d691e750a09727 \
  --query unemployment --out /absolute/private/eurostat-briefing
node "$EUROSTAT_SOURCE/cli.mjs" export-sources \
  --workspace "$EUROSTAT_PROJECT" --out /absolute/private/eurostat-source-handover.json
~~~

The briefing contains HTML, structured JSON, exact CSV and the original response. Standalone HTML includes every selected observation, full source metadata and print styles. Monthly comparisons match all non-time categories, retain current/baseline flags, and express PC_ACT differences in percentage points.

Source handovers carry every original capture and reviewed query with exact bytes and hashes. Import merges identical identities. A changed query needs a distinct explicit name, preserving the recipient’s original selection. Source material is portable; continue native publisher, dataset and buyer operations at their recorded original paths.

## Native merchant/customer receiving

[RECEIVING.md](RECEIVING.md) describes the one-command native operation. Its checkpoint retains the original run UUID, source selection, release, buyer state/profile, page session and operator accounting workspace. It follows actual native cursors to completion, finalizes the original reservations, creates the SF100 data room, compares every delivered row with the exact source and reopens the saved delivery.

The original SF82 package carries response, metadata, portable source plan, reuse review, candidate, publication and seller binding. Exact source bytes and the reviewed handover also accompany the customer’s native CSV/JSONL/HTML delivery.

## Typed client and MCP

The contribution exports the typed client at **./seller/eurostat/client** in the installed distribution. Its API follows client.d.ts:

~~~js
import { createEurostatClient } from './client.mjs';
const eurostat = createEurostatClient({ origin: 'http://127.0.0.1:8468' });
const project = await eurostat.status();
const captureId = Object.keys(project.source.captures)[0];
const page = await eurostat.cells(captureId, { offset: 0, limit: 100 });
const original = await eurostat.originalResponse(captureId);
~~~

Start MCP stdio against the same live listener:

~~~sh
stellar-forge eurostat mcp --origin http://127.0.0.1:8468
~~~

The 26 tools cover source inspection, paged cells/comparisons, original response bytes, economic briefing, acquisition continuation, reviews, publication, native buyer preparation and SF82 release control. They follow the [2025-06-18 stdio transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle) and [tool](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) contracts.

## Operational limits

One source response is complete UTF-8 JSON-stat 2.0, at most 32 MiB and 250,000 declared cells. A publisher source declaration is at most 256 KiB; capture metadata is at most 4 MiB. Native extraction defaults to 250,000 rows, 64 MiB and 30 seconds, with the original reviewed larger byte/deadline options available. Browser/MCP input is at most 48 MiB; the installed handover CLI supports the complete declared 256 MiB aggregate source-file limit.

The original scheduler re-extracts the immutable capture in its saved plan. Acquire/review a new response and select its new plan/policy to advance the economic edition. The browser binds to loopback with the maintained exact-host/origin checks and content-security policy. Payment credentials remain in the configured native operator environment and original profile references.
