# dlt 1.31.0 original engine contracts and reference inputs

This companion joins DLTHUB-PIPELINE-MIGRATION-0C7A-20261013. The application owner keeps the original pipeline programme, installed operator, native execution and company relationship. The companion supplies the exact engine contracts and original executable/data inputs needed by that application.

Upstream: dlt-hub/dlt commit `2360d229c77f7f64692acc31a4555f4cfcd50ed3`. Its pyproject declares version 1.31.0 and Python >=3.10,<3.15. The 27 complete originals in `upstream/` total 598,882 UTF-8 bytes; `source_manifest.json` records their original paths, immutable URLs, Git blob IDs, byte lengths and SHA256 hashes. The full Apache 2.0 license is retained. These are selected review/input sources; install the complete pinned engine for execution. [Original package metadata](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/pyproject.toml).

## Join the installed original engine

Use the application's existing environment and workspace. Install the frozen engine with:

```sh
python -m pip install 'dlt[duckdb] @ git+https://github.com/dlt-hub/dlt.git@2360d229c77f7f64692acc31a4555f4cfcd50ed3'
```

Record the actual installed dlt and DuckDB versions in the original receiving result. dlt's DuckDB extra has a broad lower bound; that requirement does not freeze the resolver's chosen DuckDB edition. Keep the original pipeline_name, pipelines_dir, destination database path and dataset_name as the receiving identity. Use dev_mode=False for the continued programme. The DuckDB database path should be absolute in the existing application workspace; its dataset/schema name should differ from the database/catalog name.

Reopen through `dlt.attach(pipeline_name=..., pipelines_dir=..., destination=..., dataset_name=...)` with the existing identity. This function can attempt destination recovery if local state is absent; report that recovered state explicitly rather than presenting it as a newly initialized empty pipeline. Keep the original local pipeline directory and actual DuckDB file in the application's complete export/restore closure. [Original attach implementation](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/dlt/pipeline/__init__.py#L185).

## Continue work at the engine's actual stage

The pipeline's public `extract`, `normalize` and `load` functions already implement stage transitions and trace/error capture. `run(data)` checks pending state before extracting new input. If pending normalization leaves normalized packages, it loads those packages and returns; the newly passed data has not been extracted in that invocation. If no normalized packages remain after that pending normalization, execution falls through and can extract the supplied new data. The operator must inspect the actual branch outcome and package IDs. The operator should show the original resumed package IDs, refresh pending state, and then allow the intended new input invocation. Do not label that recovery call as a completed new ingestion. [Original run branch](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/dlt/pipeline/pipeline.py#L697).

For a paused existing programme:

1. Capture its original extracted, normalized and completed package ID lists.
2. If there are extracted packages, continue its existing normalize step.
3. If there are normalized packages, continue its existing load step.
4. Display the returned LoadInfo and re-read the actual package states.
5. Start the selected new input only after the previous pending state is resolved.

A returned None from a stage or run is an actual no-work/no-data result; keep that distinct from a successful load with package IDs. Retain PipelineStepFailed.step, load_id, exception and step_info together. The load wrapper performs aborted-package cleanup and may return the original step_info after an explicitly requested abort; inspect package state before labeling it loaded.

## Operator inspection contract

| Display / action | Original public producer | Values to preserve |
| --- | --- | --- |
| Existing identity | pipeline_name, pipelines_dir, working_dir, dataset_name, destination | Exact original identity/path and actual installed engine versions |
| Pending work | has_pending_data; list_extracted_load_packages(); list_normalized_load_packages() | Original package IDs in each actual stage |
| Complete history | list_completed_load_packages() | IDs and each package's actual state; an aborted package can be in completed storage |
| Package detail | get_load_package_info(load_id) | load_id, state, schema name/hash, jobs, refresh, dropped/truncated tables, pending transitions |
| Saved source state | state and schemas | Complete original state/schema editions retained within the existing private workspace |
| Native step result | ExtractInfo / NormalizeInfo / LoadInfo.asdict() | Original load IDs, row/job metrics, timestamps, destination outputs and failures |
| Retry candidates | list_pending_retry_jobs_in_package(load_id) | Each original job file and its new_jobs or started_jobs folder |
| Failed jobs | list_failed_jobs_in_package(load_id) | Complete original job identity, failed_message and actual package state |

`LoadPackageInfo.jobs` is a dictionary by state on the Python object. Its `asdict()` output deliberately flattens jobs into a list, with each job retaining its own state. The normalized browser contract must use the selected producer consistently. Each LoadJobInfo.asdict() exposes table_name, file_id, retry_count, file_format, job_id, file_path, state, size/timing and failed_message. Package asdict() also replaces the raw schema/schema_update with schema_name, schema_hash, schema_migrated and flattened tables. If the UI needs the full current schema, obtain it from the actual schema object separately. [Package producer](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/dlt/common/storages/load_package.py#L311).

`LoadInfo.asdict()` retains original load IDs/package information, converts metrics into job_metrics and outputs, and includes destination/dataset identity. Its `has_failed_jobs` is a property; `raise_on_failed_jobs()` is a method. [Step producer](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/dlt/common/pipeline.py#L348).

Use inspection when the selected package changes or a native operation completes. The original get_load_package_info implementation reads filesystem metadata and exception files and explicitly advises against frequent calls. A browser redraw should render its received snapshot rather than recursively re-reading every package.

## Failed jobs, retry and interrupted transitions

The actual LoaderConfiguration defaults at this pin are workers=20, raise_on_failed_jobs=True, raise_on_max_retries=5 and auto_abort_on_terminal_error=False. The run() docstring contains an older statement about not raising for a single terminal failure; the current configuration and executable load path are the relevant behavior. Preserve both PipelineStepFailed and any returned failed-job status in the operator, since a caller may explicitly choose a different raise policy. [Current loader configuration](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/dlt/load/configuration.py#L10).

For an actual normalized package:

- `retry_failed_job(load_id, job_file_name)` moves an original failed job to new_jobs, increments its retry count and preserves its terminal exception in the exception history. It returns the new file path. Save/display that actual return; the subsequent existing load() performs execution.
- `list_pending_retry_jobs_in_package(load_id)` includes new_jobs and interrupted started_jobs. Only new_jobs entries can be passed to fail_pending_job.
- `fail_pending_job(load_id, job_file_name)` moves a retried new job to failed_jobs and copies the retained last error while preserving the full per-retry history.
- An interrupted started_jobs entry is resolved by the original next load() or abort operation. Keep it visible as interrupted; do not manufacture a failed/new folder transition in application code.
- A completed package is historical. Retry is implemented against normalized storage. Refresh original state before presenting a retry command for a historical failed-job row.

Sources: [retry](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/dlt/pipeline/pipeline.py#L1234), [pending job classification](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/dlt/pipeline/pipeline.py#L1196), [explicit fail action](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/dlt/pipeline/pipeline.py#L1216). Original pending-transition markers distinguish a destination-committed job from a job whose outcome was not recorded; the loader owns replay of those markers.

## Abort preview and actual effect

Use `pipeline.abort_packages(load_id=selected_id, dry_run=True)` to obtain the real plan. Present its package_to_abort, packages_to_delete, extracted_packages_to_delete and restore_from_load_id. The preview classifies terminal, transient, interrupted and already committed jobs. A None plan means there is no pending work to abort. Re-read the actual selected state before invoking the destructive original action through the existing operator decision.

The oldest normalized package being loaded is the one retained as an aborted record. Later normalized/extracted packages in the plan are deleted. When a retained start snapshot exists, local pipeline state and schemas rewind to that snapshot. For an older package without a snapshot, _apply_abort_plan emits its original warning and leaves local state/schemas unrestored; retain that warning and show the actual remaining state. Selecting a later package leaves older packages loadable and can delete the selected package without a completed abort record. The abort intent is persisted so the next load()/run() finishes interrupted cleanup. [Public abort](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/dlt/pipeline/pipeline.py#L1300); [actual planner/cleanup](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/dlt/pipeline/abort.py#L35).

When its original snapshot is available, this operation rewinds local pipeline state and schemas. It does not promise to undo all previously committed destination rows. The loader explicitly distinguishes committed jobs; DuckDB transactions apply to the original operations that opened them. A consumer cutover/rollback decision therefore uses the application's actual retained destination/database edition and full data comparison. Label “abort pending load” and “restore consumer destination” as separate original operations. [DuckDB transaction scope](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/dlt/destinations/impl/duckdb/sql_client.py#L208).

## DuckDB loading, typing and comparisons

Use the original DuckDB factory, client and loader. The current default insert-values path supports the authored relational reference source without an additional Parquet dependency. Parquet requires the actual installed PyArrow closure. The original copy job accepts parquet/jsonl/typed-jsonl, but the same source warns that missing JSON keys can fail DuckDB JSON loading rather than become null. Keep an explicit chosen native file format in the run configuration; use the standard insert-values path for the initial supplied reference journey. [Current copy job](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/dlt/destinations/impl/duckdb/duck.py#L23).

Destination data and source JSON contain values whose type matters. The nested original fixture has integer identifiers beyond JavaScript's exact integer range. Keep its original file bytes, parse it in Python, and carry large integer/decimal values through the existing typed comparator without a JSON-to-JavaScript-to-JSON round trip. Preserve null, absent key, decimal scale, timestamp timezone/precision and nested list order where those are part of the source contract.

The original normalizer generates its own dlt IDs, load IDs, parent references and list positions. Retain these in inspection/lineage, but compare source business values against the mapped destination columns under the original table/column mapping. A newly generated load ID is not itself a source-data discrepancy. [Original relational normalizer](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/dlt/common/normalizers/json/relational.py#L59).

Incremental cursor state belongs to the actual dlt resource/source. Retain cursor_path, initial/start/last/end values, boundary/deduplication settings, primary-key behavior and the original state changes. A timed cursor extraction is not automatically a source CDC log with deletes. The existing migration intake should declare the actual upstream mode and preserve a supplied full/CDC source where required. [Original Incremental implementation](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/dlt/extract/incremental/__init__.py#L87).

## Unchanged executable and nested data closure

The complete original `upstream/dlt/_workspace/_templates/_single_file_templates/fruitshop_pipeline.py` is independently executable with the installed pinned engine. It contains its own source: 13 customers, three categories, six inventory records with Decimal prices, and 100 purchases from the original seed42/date range. Its original load_shop() creates the fruitshop pipeline with DuckDB and fruitshop_data; the application can import its fruitshop() source and pass it to the already selected original pipeline instead. The full file is unchanged. [Original executable](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/dlt/_workspace/_templates/_single_file_templates/fruitshop_pipeline.py).

Two original JSON files and their original schema companion provide native nested/source-evolution input:

- `tests/normalize/cases/event.event.user_load_1.json`: one root source event with ten original parse_data.intent_ranking entries and an empty entities list. These are input-shape counts, obtained directly from the source.
- `tests/normalize/cases/event.event.many_load_2.json`: two original action/bot source events with their distinct present/null/missing fields.
- `tests/normalize/cases/schemas/event.schema.json`: the original historical schema, including its filters and engine_version. Use it explicitly when reproducing that schema's behavior; a default newly inferred schema has a different interpretation of those fields.

Load the exact JSON file with Python json.load and pass the retained objects to the application's selected original dlt resource/pipeline. Keep the fixture filename/hash in the source intake. If using the original schema companion, let dlt's own Schema.from_dict migration interpret it and retain the resulting actual schema edition. Do not silently transplant its historical filter rules into a default inference run. [Nested fixture](https://github.com/dlt-hub/dlt/blob/2360d229c77f7f64692acc31a4555f4cfcd50ed3/tests/normalize/cases/event.event.user_load_1.json).

The earlier Sling 1,000-row/14-change source remains a separate attributed reference. These upstream dlt inputs complement it with the engine's own authored source and nested values.

## One receiving continuation

Join these leaves to 0C7A's original application/native programme. That programme should retain:

1. Actual environment versions and original workspace/pipeline/database identity.
2. Exact selected original reference filename/hash and input edition.
3. Native extract → normalize → load IDs, step outputs, original schema and destination relation identities.
4. Full typed source-to-destination comparison and the existing edition/cutover decision.
5. A close/reopen through the original pipeline identity, plus the same project's archive/restore and retained source hashes.
6. Any actual failed or interrupted package's original error, previewed retry/abort action and resulting state.

The source pack provides the complete engine leaves and input closure for that receiving operation. Its source inventory is hash-checked; the existing native owner records runtime outputs on the same original programme.
