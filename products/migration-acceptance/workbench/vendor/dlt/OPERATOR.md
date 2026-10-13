# Operating the dltHub migration application

## What the operator owns

This application retains customer data, original native dlt pipeline state and an explicit consumer selection. It opens private local files, runs the selected original dlt/DuckDB engine and stores complete closed results. HTTP, browser and CLI operate the same workspace facade. The web interface is an installed operator, with Sources, Plans, Native runs, Comparison, Cutover, Receiving and History views.

A completed code review is separate from an actual native result. A native job is complete only after its original worker publishes its result and the parent retains every closed native file. A programme is complete only when the original receiving journal and `CUSTOMER_RESULT.json` say so and all named artifacts still match.

## Platform and original runtime

Use Linux, Node 24 or later, the existing selected CPython 3.12 build, Git, flock and uv. The application’s Node modules use only built-in Node APIs. Actual browser receiving needs an existing Playwright module and Chromium executable. Do not resolve an environment Python symlink to its base interpreter: the selected invocation is part of runtime identity.

The pinned original engine is dlt 1.31.0 at commit `2360d229c77f7f64692acc31a4555f4cfcd50ed3`. Original source and lockfile remain unchanged. Installation enables only the DuckDB extra and no default development groups.

From the complete product directory:

```sh
node runtime/runtime.mjs install --directory /absolute/private/dlt-runtime --python /absolute/python3.12 --uv /absolute/uv
node runtime/runtime.mjs verify --directory /absolute/private/dlt-runtime
node runtime/runtime.mjs pack --directory /absolute/private/dlt-runtime --output /absolute/delivery/dlt-runtime.tar.gz
```

Use the same directory and arguments to continue an interrupted install. It retains the original source, cache, command logs and identity. Its inherited kernel lock remains held through actual native children. The packed runtime includes the full original checkout, exact dependency cache, selected uv and receiving helpers. It rebuilds its virtual environment offline on a matching receiving interpreter; copying a virtual environment to a new path is not its receiving method.

The ready JSON must contain `state:"ready"`, the original version and source commit, the actual Python executable, runtimeId, installed-manifest identity and complete portable descriptor. New native jobs require that portable descriptor so their handoffs include the full receiving runtime.

Read runtime/OPERATING.md for the full installation/receiving contract and logs.

## Private installation and authentication

Create an owned workspace directory with mode 0700. Keep authentication outside customer source/handoffs in an owned mode 0600 file:

```json
{
  "schema": "tjlabs.sling-auth.v1",
  "actors": [
    {
      "id": "migration-operator",
      "name": "Migration operator",
      "roles": ["operator"],
      "token": "REPLACE_WITH_A_PRIVATE_RANDOM_TOKEN_AT_LEAST_24_CHARACTERS"
    },
    {
      "id": "customer-reviewer",
      "name": "Customer reviewer",
      "roles": ["viewer"],
      "token": "REPLACE_WITH_A_DIFFERENT_PRIVATE_RANDOM_TOKEN"
    }
  ]
}
```

The retained schema name comes from the unchanged original authentication module. The operator role can mutate; viewer can read. A deployment can supply the existing host’s `contextForRequest(request)` callback instead of the local bearer file. Its actor has id, name and roles. Authentication is not exported in handoffs.

```sh
node cli.mjs serve --directory /absolute/private/customer-workspace --auth /absolute/private/auth.json --runtime-ready /absolute/private/dlt-runtime/runtime-ready.json --host 127.0.0.1 --port 8781
```

Open the printed origin and enter the installation token. The server checks roles on each API call and validates browser mutation origin. The default listener is loopback. An existing host owns external TLS, proxy and identity integration. Do not open a second CLI writer while this server owns the same workspace; stop the original server or use its HTTP interface.

The server’s `/operator-guide` route serves this full document. `GET /health` is its lightweight listener status; authenticated `GET /api/info` returns instance identity, actor, permissions, upload limits and runtime selection.

## Retain and review sources

Upload the complete original source, retaining its filename, media type, byte count and SHA256. A resumable upload has a stable upload ID, complete expected identity and exact per-chunk range/hash. The caller reopens the same upload and resumes at the server’s committed offset. Completed sources become immutable content objects. A later source edition adds a new descriptor; it does not overwrite older bytes.

Supported native input formats are:

- CSV with explicit delimiter and explicit strings representing NULL.
- A full original JSON array.
- Newline JSON with complete object records.

A plan can review field mappings, original resource names, normalized target names, native column hints, primary keys, schema contracts, native incremental cursor options, merge strategy and nested normalization depth. Data acquisition from a live customer system is a separately selected original connector integration. Do not label an uploaded configuration as an implemented live extractor.

The Airbyte review preserves the original public API, protocol, legacy syncCatalog or Terraform shape and its selected/unselected stream semantics. It requires an explicit dlt input before any native effect. Cursor type, source-defined cursor, key paths, field mapping, namespace, nested tables and independent expected data need actual operator decisions.

## Native input format

The complete editable reference inputs are generated by `reference/prepare.py`. Customer input follows this shape; all source IDs must already exist in the workspace:

```json
{
  "schema": "dlthub.pipeline-input.v1",
  "title": "Customer records migration",
  "pipelineName": "customer_migration",
  "datasetName": "customer_migration",
  "phase": "baseline",
  "resources": [
    {
      "name": "records",
      "tableName": "records",
      "sourceId": "RETAINED_DATA_SOURCE_ID",
      "format": "csv",
      "columns": [
        {"name": "id", "data_type": "bigint", "nullable": false},
        {"name": "updated_at", "data_type": "timestamp", "timezone": true},
        {"name": "amount", "data_type": "decimal", "precision": 38, "scale": 7}
      ],
      "primaryKey": ["id"],
      "writeDisposition": {"disposition": "merge", "strategy": "delete-insert"},
      "incremental": {"cursor_path": "updated_at", "initial_value": "2020-01-01T00:00:00Z"},
      "schemaContract": {"tables": "evolve", "columns": "freeze", "data_type": "freeze"},
      "maxTableNesting": 10,
      "nullValues": [""]
    }
  ],
  "acceptance": [
    {
      "table": "records",
      "expectedSourceId": "RETAINED_COMPLETE_EXPECTED_TABLE_ID",
      "columns": [
        {"name": "id", "cellType": "integer"},
        {"name": "updated_at", "cellType": "timestamp"},
        {"name": "amount", "cellType": "decimal"}
      ],
      "primaryKey": ["id"],
      "ignoredRightColumns": ["_dlt_load_id", "_dlt_id"]
    }
  ],
  "limits": {"maxRows": 250000, "maxBytes": 536870912, "workers": 1}
}
```

Pipeline, dataset, resource, target-table and hinted-column names are explicit normalized lowercase identifiers. Resource names and target names must each be distinct. The application supports one to fifty resources. A merge requires an explicit primary key. The native engine decides the actual supported destination behavior; errors remain original native results.

Hints support text, bigint, double, bool, timestamp, date, decimal, binary, json and time. Decimal precision is limited to DuckDB’s exact supported 38 digits. Text fields such as padded codes remain text. CSV null representations are explicit; an empty cell is not silently a NULL unless selected. Unhinted fields retain native inference and the reviewed schema contract.

Incremental options include the native cursor path, initial and end values, max/min, row order, missing-value behavior, open/closed range boundaries and lag. The bounded backfill path uses the original end-value semantics. It does not manually replace native state.

The independent expected table is a full retained file:

```json
{
  "schema": "dlthub.expected-table.v1",
  "table": "records",
  "complete": true,
  "rowCount": 1,
  "columns": [
    {"name": "id", "type": "BIGINT"},
    {"name": "amount", "type": "DECIMAL(38,7)"}
  ],
  "rows": [
    [
      {"type": "integer", "value": "9007199254740993"},
      {"type": "decimal", "value": "12345678901234567890.1234567"}
    ]
  ]
}
```

The example illustrates two fields; the actual acceptance mapping must include every business column. Rows use typed cells, with `{"type":"null"}` for NULL. Integer and decimal values are lexical strings. Binary is Base64; float64 uses the exact 16-hex-digit network-order IEEE754 representation. Timestamps and dates are explicit text in their typed cells. Native exports retain all actual destination columns, including ignored native metadata, so omitted business schema remains visible.

## Original stage lifecycle

Compile the retained input and approve that exact current plan before preparing a job. Each stage names an original closed parent job when continuing the pipeline. Its private data files are copied from that parent’s complete retained custody into a new writable generation. Pipeline names, source cursor and original load package identities survive. The earlier closed parent remains immutable.

| Stage | Native action and boundary |
|---|---|
| extract | Original resources and native incremental extraction. A pending package must first be completed or explicitly aborted. |
| normalize | Original normalizer processes retained extracted packages. |
| load | Original loader processes retained normalized packages and publishes complete typed destination exports. |
| run | The same explicit extract, normalize and load stages in one original job. |
| inspect | Original pipeline/package/schema/state inspection without an extract or load. |
| verify | Fresh complete destination inspection/export from the selected closed parent. |
| retry_failed | Original `retry_failed_job(loadId, jobFileName)`, retaining its original package and reason. |
| abort | Original dry-run abort plan, then original `abort_packages`; retained pre-abort parent remains available. |

Selecting a non-latest closed parent requires a written forkReason. This allows deliberate recovery or rollback without silently discarding later pipeline history.

The runtime wrapper verifies the whole selected installation while holding its original runtime lease. The original operation lifetime remains owned through verification and the Python worker. Native result files belong to the same job. An installation cannot be rewritten under an active job.

A prepared job has no effects until started. Cancellation retains its original control receipt and cancelled attempt; explicit resume continues that job. A cancellation issued before its first command does not permanently cancel later attempts.

If a stage result was written immediately before a controller loss, the worker reopens that exact deterministic original receipt. It binds stage, attempt and selected input digest. It does not repeat the completed effect merely because the journal pointer was interrupted.

A native extraction or failed-job retry with an uncertain result remains awaiting reconciliation. Review its full original files and supply an explicit retry, adopt or abandon decision bound to step and attempt. Adoption requires a genuine complete original result receipt. Normalize, load and abort use their original native recovery behavior. Do not use a different request ID to disguise the same uncertain operation.

## Complete parity and cutover

Comparison examines every retained row and its multiplicity. It checks selected schema compatibility, exact typed values, NULL keys and duplicate keys. It checks all normalized business tables have explicit acceptance definitions. Pending packages, failed jobs in non-aborted packages or unmapped normalized child tables keep cutover blocked even when one selected table happens to match.

The source, plan and full typed observations remain downloadable. A comparison from one plan cannot approve another. A consumer switch additionally requires an explicit complete verify job for the currently approved plan and its exact ready comparison.

Cutover changes this application’s retained consumer binding. The previous binding is stored on the original cutover record. Rollback selects that original previous binding and retains all later data/history. The consumer API returns full-population pages from the selected closed export, identifies its source snapshot and says `liveQuery:false`. It does not claim a production database connection was rewired.

External systems can use the complete retained DuckDB snapshot through their existing owner. This application does not execute arbitrary external production cutover SQL.

## HTTP mutations and replay

Every mutation has a stable request ID and expected project revision. For example:

```json
{
  "requestId": "operator_original_request_id",
  "expectedRevision": 12,
  "action": "run.prepare",
  "payload": {
    "planId": "plan_original_id",
    "stage": "normalize",
    "parentJobId": "job_original_extract_id"
  }
}
```

POST this to `/api/projects/PROJECT_ID/actions` using the original installation bearer token. The browser writes the full pending envelope to IndexedDB before sending. Its storage scope includes installation instance, actor and project. Mutation controls stay disabled until the pending record for that scope has been successfully loaded. A storage failure remains explicit and retryable.

Replaying the exact same actor/request/body returns its original saved result. The separate currentRevision/historical metadata identifies any newer project state. Changing the input under the same request ID is rejected. An expected-revision conflict needs review of the current state; it is not a reason to invent an automatic new mutation.

Actions include source.retain, source.review, plan.compile, plan.review, runtime.select, run.prepare, job.start, job.resume, job.cancel, job.resolve, comparison.create, cutover.apply, cutover.rollback, review.record, handoff.prepare and handoff.receive. The UI supplies structured forms and full JSON inspection. The API preserves the original action receipts.

Read routes include project snapshots with optional revision, complete sources, compiled plans/native resource config, comparisons and observations, individual native files, complete named handoffs, and bounded current consumer pages. Downloads bind Content-Length, X-Content-SHA256 and exact original bytes.

## CLI

Local CLI commands take the same private workspace lease. Use them after closing the server that owns that directory:

```sh
node cli.mjs list --directory /absolute/private/customer-workspace
node cli.mjs create --directory /absolute/private/customer-workspace --request-id original_create_request --title "Customer migration"
node cli.mjs show --directory /absolute/private/customer-workspace --project PROJECT_ID
node cli.mjs retain --directory /absolute/private/customer-workspace --project PROJECT_ID --request-id original_source_request --file /absolute/source.csv --role data --title "Original full source"
node cli.mjs action --directory /absolute/private/customer-workspace --runtime-ready /absolute/private/dlt-runtime/runtime-ready.json --input /absolute/original-request.json
node cli.mjs download --directory /absolute/private/customer-workspace --project PROJECT_ID --kind handoff --id HANDOFF_ID --output /absolute/delivery/Complete_Application.ndjson
```

The CLI retains each full original mutation before dispatch. Keep its request ID and exact input to continue after a lost acknowledgement. Read-only command failures and their complete logs can be continued without replacing the old observation.

## Whole application handoff

A sealed canonical v2 NDJSON package contains the complete selected revision prefix, original requests, source/plan/comparison/review objects, all native attempts and closed data files, complete runtime archive and editable application source. Content objects are included once by SHA256. Historical v2 headers retain the exact source/request selection needed to reconstruct byte-identical older named packages. Older literal gzip-v1 packages remain readable.

New portable filenames end in `.ndjson`, media type `application/x-ndjson`. Runtime archives remain tar.gz. Do not confuse their formats.

Receiving uses a private writable workspace. The full archive is inspected before adoption. New, same, forward and older prefixes have explicit dispositions; an older package cannot roll the current head backward. Imported native bindings are suspended, so a receiving host does not execute a historical job simply by opening the project. Explicit runtime selection and same-job control are required for any native continuation.

```sh
node cli.mjs inspect-package --directory /absolute/private/receiving-workspace --file /absolute/Complete_Application.ndjson
node cli.mjs receive --directory /absolute/private/receiving-workspace --project RECEIVING_PLACEHOLDER_ID --request-id original_receive_request --file /absolute/Complete_Application.ndjson
```

Create the empty receiving project first through the existing create action. A full imported project preserves its original project identity. The returned result identifies the selected project and disposition.

To rebuild the original runtime independently:

```sh
node runtime/runtime.mjs receive --bundle /absolute/dlt-runtime.tar.gz --sha256 ORIGINAL_ARCHIVE_SHA256 --directory /absolute/received-runtime --python /absolute/matching/python3.12
```

Offline receiving requires the same interpreter binary/build, ABI and platform identity. The new receipt contains its new executable/source paths and the same normalized runtimeId. No customer auth token or mutable local process binding is imported.

## Original upstream reference in the same programme

The complete receiving course now runs the unchanged upstream GitHub staged reference before the application's baseline. It uses the already selected runtime, a separate `upstream-original/original-reference` directory and the original `github_extract.py`, `github_normalize.py` and `github_load.py`. This original 100-issue fixture is distinct from the application's 100-event normalization fixture and 1,000-row migration reference.

The existing runtime wrapper holds both its installation lease and the outer native operation lease. The bridge verifies and passes those inherited descriptors through the reference receiver to every original stage, alongside the reference's own lock. A surviving stage therefore keeps its original runtime and operation ownership after a parent interruption. Resume the same complete programme with `--resume`; the reference continues its original package queues or receives its already completed archive.

The reference's complete operating archive includes source, database, pipeline state, full exports, logs and the linked HTML report. The application retains that archive and its exact result as ordinary documentation sources, so they travel in H1/H2/H3 and reopen in the received project. `CUSTOMER_RESULT.json` also lists the original report, archive, result, identities, load IDs and complete logs. The selected business pipeline, consumer comparison and cutover continue through the existing application.

## Complete reference commissioning

The same one programme accepts:

```sh
node receiving/receive.mjs --source /absolute/complete-product --directory /absolute/private/dlt-programme --config /absolute/complete-product/reference/programme.json --runtime-ready /absolute/private/dlt-runtime/runtime-ready.json --source-manifest /absolute/complete-product/SOURCE_MANIFEST.json --playwright /absolute/playwright/index.js --chromium /absolute/chromium
```

Continue the same source, configuration, runtime and directory with `--resume`. An optional `--python` chooses the stdlib source-preparation interpreter. `--receiving-python` selects the matching interpreter for the offline runtime rebuild. An already offline-received runtime can be supplied with `--receiving-runtime-ready`; its origin archive and runtimeId must match and it is reverified through the maintained runtime command.

The programme validates equality between the manifest and the entire editable source inventory before creating its operation. It then retains original inputs and deterministic derivation, runs baseline stages/cancellation continuation, observes schema rejection and native abort, evolves the plan, checks incremental changes/cursor replay/bounded backfill, loads the original nested fixture, verifies its coverage hold, and restores a reviewed earlier closed pipeline. It executes full consumer select/rollback/select.

It seals H1, runs the complete primary browser journey, seals H2, rebuilds or verifies the offline receiving runtime, receives the full application, runs its receiving browser, creates returned H3, and checks forward/same/older receiving. Finally it closes the servers, reopens both workspaces through the original CLI and downloads identical H1 from each.

The browser uses original project/request IDs and a persistent profile. It exercises an exact pending project update through lost acknowledgement and replay, checks role separation, captures all seven panes at desktop/mobile sizes and retains original source/native/typed/package downloads. It does not independently launch duplicate native jobs.

The final candidate timestamp is saved before immutable publication. Every declared comparison, derivation, full archive, consumer snapshot, browser image/download and browser-result file is rehashed at completion and on completed reopen. A missing artifact does not trigger a false successful return or an automatic new browser run.

## Retention and limits

Keep the source manifest, runtime archive, operation directory and named full handoffs. They hold original source and complete result custody. Transient browser cache or dependency installation cache is not a substitute for the named artifact. Retire only owned reproducible storage after the complete retained package has been verified.

Current caps are one million source/export rows per selected table and 512 MiB per retained input or typed export, with a reviewed lower cap permitted. Full nested populations can produce more tables than a flat source; the operator must map every business table before acceptance. The reference is deliberately small enough for one equipped Linux host.

The application is an implementation workshare. A successful public reference run is not a claim that any customer migration, commercial purchase, production deployment or payment occurred.
