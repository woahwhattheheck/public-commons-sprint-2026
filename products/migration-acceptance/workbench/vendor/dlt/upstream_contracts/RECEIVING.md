# Receive the original dlt staged reference

This receiver belongs to `DLTHUB-PIPELINE-MIGRATION-0C7A-20261013` and the existing 0C7A application programme. It runs the unchanged original dlt reference and retains the complete native result for the maintained application.

## Select the original environment and operation

Use the full dlt installation at upstream commit `2360d229c77f7f64692acc31a4555f4cfcd50ed3`, version 1.31.0, and its DuckDB destination. The complete source companion includes the original dependency lock, which selects DuckDB 1.5.3. The original package supports Python >=3.10,<3.15. The receiver reads the actual installed destination capabilities; its original delete-insert reference requires that native strategy to be available. It records the actual DuckDB version and all available merge strategies.

Run the complete receiver alongside the merged `source_manifest.json` and `upstream/` directory:

```sh
python -B upstream_contracts/run_original_staged_reference.py \
  --operation /absolute/owned/dlt-reference
```

An explicit `--companion /absolute/path/to/upstream_contracts` selects the same full source companion from another location. Select a new empty owned operation directory for this reference, separate from the source companion. The receiver retains its immutable selection and original source bodies there. Its file lock keeps two invocations from advancing the same operation concurrently. Each original stage inherits that same lock descriptor, so an abruptly terminated receiver cannot release the operation while its native child is still running.

The exact original native identity is `dlt_github_pipeline`, dataset `github_3`. The receiver binds the global and native named-pipeline configuration scopes for the pipeline directory and DuckDB credentials to the selected operation directory before importing or invoking the original engine. The same explicit native scope retains dataset `github_3`, the DuckDB destination identity and ordinary persistent mode, so host defaults cannot switch this reference into a fresh development dataset. Existing configuration outside the receiving process remains unchanged. Before advancing an existing native pipeline, it checks the actual native working directory and resolved DuckDB database path and requires the original direct local destination. It runs each unchanged upstream stage with the same selected Python interpreter, complete source closure and the original relative input path. It retains the complete environment distribution inventory and checks all original dlt Python bodies in the 78-file manifest against the installed package.

The retained original source input is `tests/normalize/cases/github.issues.load_page_5_duck.json`: 100 distinct issue IDs, 34 raw label links and 31 raw assignee links. Destination child-table counts come from the actual native output.

## Continue the same native operation

Invoke the same command and operation directory to continue after interruption. The receiver reads the existing native state and original load-package IDs through dlt:

- An operation with no extracted, normalized or completed package runs the original extraction.
- Pending extracted packages run the original normalization.
- Pending normalized packages run the original load.
- A completed operation exports and reports its current native result without starting another extraction.

A stage failure retains its full log and actual package history. The receiver closes its own running child before capturing a result archive. Explicit failed-job, retry and abort choices belong to the maintained application's original native recovery interface. The merged upstream README gives the exact semantics, including snapshot-dependent local rewind on abort.

To collect the same existing operation without advancing a stage:

```sh
python -B upstream_contracts/run_original_staged_reference.py \
  --operation /absolute/owned/dlt-reference --inspect
```

Inspection of pending or failed work retains that actual state and produces its report/archive. Completion requires native queues to be clear, a completed load package, no aborted package or failed job, no unfinished native job transition, and the complete original issue identity set. Actual package failures remain in the full snapshot, while the complete destination export stays linked from the report even if issue identities differ.

## Consume the full output in the maintained application

The command emits line-delimited JSON progress. `native_stage_started` names the actual process and complete log. A running original stage emits a 30-second progress update. `native_reference_finished` identifies the final operation, report and complete archive. Exit status is zero for the complete original reference and one for a retained unsuccessful result.

The operation contains these directly usable products:

| Path | Complete retained content |
| --- | --- |
| `index.html` | Neutral browser report: original operation, installed native versions and capabilities, stages, complete logs, destination tables and source comparison |
| `operation.json` | Selected operation, every invocation and stage, runtime inventory, native queues, complete destination manifest or actual exception |
| `selection.json` | Original reference identity and owned receiving locations |
| `source_manifest.json`, `source/`, `guides/` | All 78 unchanged upstream leaves and reviewed source guides |
| `pipelines/dlt_github_pipeline/` | Actual dlt state, schemas, load packages, traces and files |
| `destination/reference.duckdb` | Actual DuckDB destination database |
| `snapshots/*.json` | Full original pipeline state, schemas and load-package descriptions before and after each stage and continuation |
| `logs/*.log` | Complete native stage stdout/stderr |
| `destination_exports/<invocation>/tables.json` and CSV files | Every native base table, all rows, actual column types and counts, exact file identities and all source/destination issue-ID differences |
| `run_original_staged_reference.py` | Complete editable receiver source used by the operation |

Each export gets a separate retained directory. The complete operating archive is written adjacent to the selected operation as `<operation-name>-complete.tar.gz`; its adjacent JSON receipt supplies each member's byte length and SHA-256 plus the full archive identity. It includes the database, original pipeline files, source, logs, report, exports and receiver. The exclusive lock file is not an archive member.

The application can link `index.html`, expose the full operation and table manifests, and attach the complete archive through its existing private delivery routes. It should keep the original pipeline/load IDs and exact result paths supplied by this receiver. The original 0C7A owner selects where this reference joins the one maintained native programme and records that actual completed result in the source thread.

## Exact source and delivery

The unchanged 78-file companion is merged in private Commons PR37040, commit `d106c9f7c84dc0975608905c2e9117612551cff6`. Its 3,663,599 source bytes include the full original lock and the 14-file staged reference closure. This receiver adds only orchestration, complete retention and receiving/report integration around those unchanged upstream programs.

The complete implementation and this guide live in `revenue/dlthub_pipeline_workshare_20261013/upstream_contracts/`. Keep the upstream manifest, original source identities and attribution with the native output.

## Joined complete application receiving

The maintained `receiving/receive.mjs` now consumes this course through `receiving/upstream_reference.py` inside the existing runtime wrapper. The bridge selects a separate `upstream-original/original-reference` directory, verifies both inherited runtime and operation lease descriptors, and passes them through `main(inherited_fds=...)` into the unchanged original stage children. Standalone CLI use retains its existing behavior and `.reference.lock`.

The complete application keeps the original full archive and result as documentation sources in its existing editable handoffs. Its final result also retains the report, complete exports and logs. A completed original archive is verified and reused after a lost acknowledgement. The full programme's existing `--resume` continues the same original native operation.

Completed receiving holds the original reference lock and requires the archive's operation, HTML report and destination-manifest members to match the exact outside files. If an interrupted retry left an older failed archive beside a completed operation, the maintained receiver refreshes that archive from the same native completed queues before publication.

The application always receives completion through the installed runtime wrapper, including when an original result file already exists. It first reconciles the prior wrapper's PID, kernel start time and boot identity, then awaits the current wrapper's actual exit before retaining observation-log hashes. A surviving original wrapper remains active until it closes.
