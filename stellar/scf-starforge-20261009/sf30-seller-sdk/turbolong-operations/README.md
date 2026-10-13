# Turbolong operations

Operate a complete vault period using Turbolong's selected contracts, keeper scripts, rate engines, telemetry and retained source. The application provides a local operator interface, CLI, scheduled read acquisition, native command history, incident and correction work, complete reports and an independently runnable received installation.

The selected publisher source is `Dgetsylver/TurboLong@f017de605bb020bf3d7f4285aae4c654508e8d86`. The companion loads the customer's complete installation or private 276-file source capsule. The publisher's source, installed packages, native tools and compiled artifacts remain bound to the selected runtime. The public companion does not embed the publisher's unlicensed source.

Start with Node 22.16 or newer. HTTP telemetry acquisition, source import, incident work, reporting and receiving use the application's Node modules. Native vault, keeper, deployment and rate-engine actions additionally require the selected complete original runtime.

- [OPERATING_DATA.md](OPERATING_DATA.md): period scope, all 16 native actions, source coverage, corrective work and all 13 report members.
- [RUNTIME.md](RUNTIME.md): original source build, tools, process custody and recovery.
- [APPLICATIONS.md](APPLICATIONS.md): selected distribution and managed Applications launch.

## Open the operating workspace

From a complete repository checkout:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/turbolong-operations/cli.mjs serve \
  --workspace /absolute/private/turbolong-operations \
  --port 8779
~~~

The installed package exposes the same CLI as `stellar-turbolong-operations`. Keep port 8779 when reopening the same operator in the browser: the browser's recovery journal is scoped to the origin and workspace UUID.

The host prints one JSON startup record with marker `TURBOLONG_OPERATIONS_READY`. Open its `url`; the fragment contains the private operator token. The browser keeps that token in session storage and removes it from the address bar. The listener accepts loopback addresses only. A saved workspace UUID prevents a managed launch from silently opening a different installation.

The interface includes:

| Area | Complete work |
| --- | --- |
| Periods and vaults | Save immutable period and deployed-vault versions; select exact network, dates and contract identities. |
| Acquisitions | Group read-only native queries; collect all provider pages; retain complete cycles and schedule them at a saved cadence. |
| Native operations | Prepare, inspect, dispatch, collect, pause and reconcile the original selected request and all attempts. |
| Sources | Import complete JSON, JSONL or log files; download every native request, response and artifact. |
| Incidents and corrections | Record status, linked sources, native operations and full history; apply explicit analytical corrections to exact original occurrences. |
| Analysis and reports | Freeze a source selection, calculate period coverage and render complete HTML, JSON and CSV members. |
| Receiving | Export the full application, workspace and used runtimes; stream a complete archive; receive and reopen independently. |
| Recovery | Resume the retained request UUID, exact arguments, uploaded File and committed response after a disconnect. |

An empty workspace opens without provider credentials or an installed native runtime. Attach the actual connections before acquiring data or preparing native commands.

## Select private host configuration

Copy `examples/connections.example.json` to a private location outside the workspace, edit its paths and set owner-only file permissions. The example includes public mainnet telemetry and a separate testnet native connection. Remove the testnet connection and `runtimes` entry when using only public HTTP acquisition. Placeholder paths and vault IDs are deliberately not working selections.

~~~sh
chmod 600 /absolute/private/turbolong-connections.json

stellar-turbolong-operations serve \
  --workspace /absolute/private/turbolong-operations \
  --connections-file /absolute/private/turbolong-connections.json \
  --port 8779
~~~

A configuration has named `connections` and optional `runtimes:[{directory,expectedManifestSha256}]`. A connection selects its network and actual telemetry, RPC and Horizon URLs. Trusted `private` settings select the runtime, execution directory, history root, HTTP headers, environment and explicit `secretFiles` map.

Keep private configuration, credential files, installed source, retained runtimes, keeper histories and execution directories outside the exported workspace. The host checks declared paths, including every file under `secretFiles`. Credentials are supplied only to the selected native transport. Portable source records retain original permitted bytes, credential references and redacted-wire hashes where the native runtime removes known secret echoes. Raw execution custody remains private.

The public telemetry URL is the publisher's selected rate Worker. Its network and coverage must agree with the operating period; a label in a configuration does not turn mainnet observations into testnet results. Select the customer's actual endpoints when they differ.

## Create the complete period and acquisition

Edit `examples/period.template.json` with the intended UTC bounds and acceptance scope. Dates are half-open: the start is included and the end is excluded.

~~~sh
stellar-turbolong-operations period-save \
  --workspace /absolute/private/turbolong-operations \
  --file /absolute/private/period.json
~~~

Record the returned period UUID and version. Fill those values into `examples/acquisition.template.json`, preserving each query's actual connection and arguments.

~~~sh
stellar-turbolong-operations acquisition-save \
  --workspace /absolute/private/turbolong-operations \
  --connections-file /absolute/private/turbolong-connections.json \
  --file /absolute/private/acquisition.json

stellar-turbolong-operations acquisition-run \
  --workspace /absolute/private/turbolong-operations \
  --connections-file /absolute/private/turbolong-connections.json \
  --acquisition-id ACTUAL_ACQUISITION_UUID
~~~

The acquisition freezes its period version, native queries and child request UUIDs. Snapshot history follows the original `before=id` cursor through all available pages. Route history exposes the publisher's latest row window and a separately labeled all-time aggregate. Import full keeper JSONL to cover older per-period routing; a latest-500 window is retained as partial history.

Use `acquisition-start` to schedule the saved plan. The `serve` process carries one abortable acquisition worker; a terminal-only deployment can run `worker` with the same workspace and private configuration. A stable lease prevents two workers from owning the same workspace. Saved schedules accept read-only actions, including the catalogue's conditional-write checks. Keeper writes are prepared and dispatched explicitly.

Pause with `acquisition-pause`. Pausing preserves the frozen cycle, query index, child operations and provider cursor. Resume the original request body shown by `acquisition-read` when a cycle is already running; do not allocate a replacement request to conceal an uncertain result.

Vault templates must contain the actual deployed IDs from the selected original installation. Remove inapplicable optional pool/share fields. Keep `underlyingClassic:null` when that is the publisher's native asset representation and retain the corresponding Soroban asset contract. Saving a revised vault creates another immutable version; earlier periods, operations and reports retain their pinned selection.

## Run and reconcile the original native operation

The browser builds the native argument form from the full catalogue. Nested vault selections, original rate inputs and full advanced arguments remain available. Integer values beyond JavaScript's safe range use the catalogue's exact decimal-string representation.

For a terminal workflow, put the complete method body in a private JSON file. The operation template demonstrates a read-only snapshot request:

~~~sh
stellar-turbolong-operations operation-prepare \
  --workspace /absolute/private/turbolong-operations \
  --connections-file /absolute/private/turbolong-connections.json \
  --input /absolute/private/operation.json

stellar-turbolong-operations operation-collect \
  --workspace /absolute/private/turbolong-operations \
  --connections-file /absolute/private/turbolong-connections.json \
  --operation-id ACTUAL_OPERATION_UUID
~~~

`operation-run` dispatches the selected prepared page or command. `operation-collect` follows complete provider pagination unless an explicit `maxPages` bound is supplied. Each native request, selected runtime, dispatch marker, result, full observation and continuation is retained before the acknowledgement becomes visible.

A live original process can return `PENDING`. A lost transport can leave `UNCERTAIN`. Use `operation-reconcile` to read the original command receipt, log and transaction outcome. The same request and execution origin remain selected. A received unfinished keeper command cannot run again simply because its former host's local command directory is absent; `RUNTIME_EXECUTION_ORIGIN_REQUIRED` keeps that custody requirement visible. Record an explicit new corrective operation only when the actual outcome and intended next action are known.

Preparation errors also retain their full observations and runtime selection. A failed preparation that never dispatched can be continued with the same operation ID, original action, arguments and scope. A completed nonzero native command remains a failed original outcome.

## Import full history and keep source identity

Use the Sources form to retain a complete File before upload, or import an actual local file:

~~~sh
stellar-turbolong-operations source-import \
  --workspace /absolute/private/turbolong-operations \
  --period-id ACTUAL_PERIOD_UUID \
  --kind keeper.harvest \
  --name harvest.jsonl \
  --file /absolute/private/keeper/harvest.jsonl
~~~

The CLI computes the complete selected file hash; the browser journals and hashes the complete File before transfer. The host verifies bytes and retains an immutable source descriptor. All source members remain downloadable in bounded ranges with a final full-file size and SHA256 check.

The imported kind controls analysis of the selected bytes. Keep the publisher's original JSON/JSONL fields and actual timestamps. Malformed lines and missing scope remain visible in the resulting analysis; the application does not manufacture absent observations. The original source is retained alongside its selected interpretation.

## Incidents, corrective work and report editions

Record the incident's period, status, severity, source IDs and actual observation/resolution time. Each update adds immutable history. Reopening a resolved incident clears the current closed timestamp while preserving the prior resolution entry.

Corrective work supports `PROPOSED`, `IN_PROGRESS`, `AWAITING_OUTCOME`, `IMPLEMENTED`, `VERIFIED` and `REJECTED`. Link actual native operation/source IDs and explain the outcome. Pure operational work needs no analytical row action. A data correction must select the exact source/row or advanced key; implementation and verification affect that selected occurrence while preserving all raw rows and prior history. Changing a correction into operational-only work clears its former analytical target.

~~~sh
stellar-turbolong-operations analysis-create \
  --workspace /absolute/private/turbolong-operations \
  --period-id ACTUAL_PERIOD_UUID \
  --name "Complete operating period"

stellar-turbolong-operations report-create \
  --workspace /absolute/private/turbolong-operations \
  --analysis-id ACTUAL_ANALYSIS_UUID \
  --name "Operating report"

stellar-turbolong-operations report-file \
  --workspace /absolute/private/turbolong-operations \
  --report-id ACTUAL_REPORT_UUID \
  --filename rate-snapshots.csv \
  --output /absolute/private/rate-snapshots.csv
~~~

An analysis freezes the exact period/vault versions, selected source IDs, raw file identities, incident/correction history and analysis-engine hash. Report retries reuse the same selection. A later workspace update requires a new edition to change the result. Download named members when a report contains several JSON or CSV files; `report.json` is the package's metadata and `period-analysis.json` is its full analytical result.

The report carries all 13 members documented in [OPERATING_DATA.md](OPERATING_DATA.md). Its acceptance result describes the retained observations and gaps; it does not infer that an operational target was met from a roadmap, latest-window aggregate or an absent log.

## Recover a browser request after interruption

The browser stores its request UUID, method, complete argument body, selected workspace identity and any full File in IndexedDB before sending a mutation. A failed journal write stops dispatch. An acknowledgement is retained before applying its report, export or receiving view; it is cleared only after that view is saved.

Reopening the same origin/workspace replays uncertain requests with the original UUID and body. Only an explicit `REVISION_CONFLICT` permits a new revision selection for the same semantic request. Transport errors do not create a new operation. Recovery shows the retained status and allows an operator to resume an unfinished action. Old completed browser records may be cleared after the corresponding result is applied; workspace history remains intact.

Terminal mutations accept `--request-id` and `--expected-revision`. The CLI fills only missing values and prints their selection to stderr before dispatch. Retain that receipt with the exact argument body for retry.

## Export and receive a complete installation

A full workspace export includes all period/vault/acquisition versions, original operations and attempts, complete request/response files, incident/correction history, report editions, the source application cohort and every referenced runtime. Host credentials and private connection files are supplied separately at the receiving host.

~~~sh
stellar-turbolong-operations workspace-export \
  --workspace /absolute/private/turbolong-operations \
  --connections-file /absolute/private/turbolong-connections.json \
  --destination /absolute/private/turbolong-delivery

stellar-turbolong-operations package-archive \
  --source-directory /absolute/private/turbolong-delivery \
  --output /absolute/private/turbolong-delivery.tar.gz

stellar-turbolong-operations package-unpack \
  --file /absolute/private/turbolong-delivery.tar.gz \
  --destination /absolute/private/turbolong-unpacked

stellar-turbolong-operations package-receive \
  --source-directory /absolute/private/turbolong-unpacked \
  --destination /absolute/private/turbolong-independent \
  --request-id ACTUAL_RECEIVING_REQUEST_UUID
~~~

Pin `--expected-manifest-sha256` to the actual export receipt when transferring a selected delivery. A repeated export request uses the exact pinned original revision, immutable source selections and completed copied bytes even when the live workspace advances.

Receiving verifies every full file and preserves original IDs, request bodies, runtime pins, modes and history. Native runtime links are reconstructed from declared regular-file transport. The result returns `workspace.directory`, `application.cli`, `application.server` and complete `application.runtimeConnections`. Use those actual paths to open the independent installation:

~~~sh
node /ACTUAL_RETURNED_APPLICATION_CLI serve \
  --workspace /ACTUAL_RETURNED_WORKSPACE_DIRECTORY \
  --connections-file /absolute/private/receiving-connections.json \
  --port 8779
~~~

Merge the returned runtime directory/hash selections into the receiving host's private connections. Received schedules and unfinished native work are paused. Reading the received reports requires no provider connection. Continuing data acquisition requires the appropriate host endpoints; continuing a native mutation requires its original custody or an explicitly prepared new corrective operation.

`report-export` selects only the report metadata and all rendered members. Use a full workspace export when the recipient needs the complete editable application, source history and native runtimes.

## Commission the actual source

Two ordinary programmes directly import the selected application modules:

~~~sh
node --expose-gc --max-old-space-size=384 period-programme.mjs
node transport-programme.mjs
~~~

The period programme exercises the complete 30-day/14-day period/report and correction semantics. The transport programme retains real local HTTP/RPC exchanges. Neither substitutes synthetic data for a customer's actual native run. Full installation/build/provider/browser/receiving commissioning must record its actual selected source, commands, returned provider results and remaining host or credential requirements.

## Source and method reference

`methods` lists every host operation. `catalogue` returns each original native action, full input schema, paging and outcome semantics. `records-page --table TABLE` reads all records beyond the current overview. The full method body is available through `invoke --method NAME --input FILE`.

The package's `source-files.json` hashes the complete application and maintained dependency cohort. [APPLICATIONS.md](APPLICATIONS.md) describes its distribution selection, direct executable and original managed launch contract. Stop the server with normal process shutdown; it aborts scheduled work, drains owned requests and closes the selected native services.
