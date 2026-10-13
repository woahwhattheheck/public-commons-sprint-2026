# Operate the original client delivery workflow

This entry runs the included dbt Labs Jaffle Shop project through the installed delivery workspace, its original Dagster/dbt runner, the staff browser, client release, and receiving flow. It retains the original operation, request bodies, native run ID, source bytes and output archive. The example is licensed public material; no customer production result is implied.

## Source and runtime

Use the application at `revenue/snowpack_dagster_delivery_workspace/` together with these four operator files. The application pins its actual Dagster, dbt Core and DuckDB adapter requirements. `operate.py` creates an installation from those requirements inside the selected private working directory; it retains installation output and then runs with that virtual environment's Python and dbt entry points. The application preserves those selected executable paths without resolving the Python symlink into the base interpreter.

The browser entry requires an existing installed Node executable, Playwright module directory and Chromium executable. It launches one browser for the same local Staff server after the original native pipeline has completed. It does not start another pipeline or application server.

For a maintained shared host, use the existing complete `host/` closure containing `native_foreground.py`. The operator registers through that original host and its foreground memory/disk admission. Do not assemble a runtime from unrelated single-file versions.

## Prepared directory

The `--project` directory contains:

- `source/`: the complete installed application, including its original example files.
- `operate.py`, `launch.py`, `browser-entry.mjs`, `browser-workflow.mjs`: these exact operator sources.
- `workspace/`: persistent source editions, contracts, native runs and saved review/release history.
- `operation/`: original step requests/responses, installation log, browser progress/downloads, receiving catalogue and completed archive.
- `jobs/`: the maintained host's original native execution record.

Keep the selected private directory for this native invocation's installation and browser temporary storage. The actual workspace and operation records remain persistent.

Run the prepared original operation with explicit installed runtime paths:

```sh
python -B launch.py \
  --host-root /path/to/complete/host \
  --project /path/to/prepared/operator \
  --private-root /path/to/invocation/private-work \
  --node-executable /path/to/node \
  --playwright-module /path/to/playwright \
  --chromium /path/to/chromium \
  --operation-id original-client-delivery
```

The retained launcher declares 1536 MiB memory including memory-backed working storage and a 256 MiB reserve. It declares 64 MiB persistent workspace growth, 16 MiB operation/return growth, 8 MiB native journal growth and 896 MiB private installation/working growth, with the maintained 64 MiB disk reserve. These are workload sizing inputs rather than a measured result. Inspect the real host admission/result before changing a declaration; use its supported original-operation resource amendment when appropriate.

## Original operation and recovery

The first source, project, contract, runtime binding and execution requests are retained before dispatch. Reopening the operator reuses these exact IDs and bodies. The native runner retains the original Dagster UUID and examines its original store after an interrupted outcome; a missing final response never silently creates another pipeline.

The operator only continues to the staff journey when the original selected run is successful. The browser retains actual emitted HTTP request bytes before dispatch and preserves the original download request URLs. It exercises source draft reload, original artifact download, review, client release, receiving, a later received-directory edit, and separate unsaved original/received drafts. The staff origin is reused after restart so these original browser and archive identities remain meaningful.

A shared host record that has already been created must be inspected and resumed through that host's supported same-record selector. Do not allocate another operation ID merely because a tool session disappeared. A definite before-dispatch dependency failure can be continued after its cause is repaired. `operate.py --continue-setup` addresses an existing application run only when its retained state explicitly permits original setup continuation; it does not turn an unknown Dagster outcome into another run.

A completed native operation produces `operation/complete.json`, containing the actual run identity, browser observations and the final complete archive's path and SHA-256. `browser-workflow.json` and the saved request/download files retain the actual browser continuation. No completion file is produced in advance.
