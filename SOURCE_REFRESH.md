# Retained source refresh

Replace an input edition without losing the previous scientific case. This extension compares the actual retained originals and their interpretation, freezes a dependency plan, and sends only changed selections through the original `Workspace` writers. It adds no scientific model, server, worker farm, cloud service, or dependency beyond the Python standard library.

## Customer workflow

Import the replacement source manifest through the existing source desk or `model.cli source-import`. The previous source collection remains untouched. Open **Source refresh** in the original operator, select previous and replacement editions, and compare their files. Supply explicit mappings for renamed source IDs. Save the rebuild plan, review its selections, prepare the changed selections, and run them through the original queue. Each resulting native ID appears in the saved refresh and in the original workspace. Reopen the same plan after interruption; completed native runs are reused.

An update to the biophysical table derives the affected profile and its dependent runs while preserving unchanged grids and landcover scenarios. A raster, native sidecar path, spatial selection or scientific interpretation change derives the grids or scenarios that actually reference that source, then their dependent runs. A title/citation update or changed unrelated document preserves all unaffected native IDs. Reuse deliberately retains the *original* collection binding; it never relabels old results as newly computed.

The original workspace may contain many editions and runs. Automatic selection includes every retained grid, profile and scenario bound to the previous collection, and every run depending on them. Explicit roots freeze a chosen subset. An empty explicit root set is valid for a source-only comparison. Added sources have no existing dependents until the customer selects them in the original workflow.

## CLI

Run from the original application root with its existing scientific Python environment:

```bash
python -m model.source_refresh_cli --workspace WORKSPACE diff --from OLD_COLLECTION --to NEW_COLLECTION
python -m model.source_refresh_cli --workspace WORKSPACE plan --from OLD_COLLECTION --to NEW_COLLECTION --title "Updated source edition"
python -m model.source_refresh_cli --workspace WORKSPACE apply PLAN_ID --prepare-only --progress
python -m model.source_refresh_cli --workspace WORKSPACE apply PLAN_ID --progress
python -m model.source_refresh_cli --workspace WORKSPACE status PLAN_ID
python -m model.source_refresh_cli --workspace WORKSPACE report PLAN_ID --format html --output refresh.html
python -m model.source_refresh_cli --workspace WORKSPACE export PLAN_ID --output complete-workspace.zip
```

`--workspace` also works after the subcommand. `--mapping mapping.json` accepts an object such as `{"old-mask":"replacement-mask"}`. `--roots roots.json` accepts `{"runs":["NATIVE_RUN_ID"]}` or lists under `grids`, `profiles`, and `scenarios`. `list` and `show PLAN_ID` provide complete structured receiving. JSON goes to stdout; progress events and errors go to stderr. An interrupted CLI exits 130 and keeps the same plan's committed checkpoint.

Only **derived** runs are executed. Unchanged incomplete runs remain in their original state. A prepared refresh can therefore retain an incomplete reused run; the refresh's status describes completion of its replacement operations, not completion of unrelated original science. Use the original run desk to run those original selections deliberately.

## Original operator registration

Install into the current complete application; the installer composes existing files rather than replacing another cohort's whole server or shell:

```bash
python install_source_refresh.py --application CURRENT_APPLICATION --source-root THIS_SOURCE_ROOT --dry-run
python install_source_refresh.py --application CURRENT_APPLICATION --source-root THIS_SOURCE_ROOT
python CURRENT_APPLICATION/operator/server.py --workspace CURRENT_WORKSPACE
```

All original flags still apply, including `--operator-state` for the retained task queue. The installer copies the ten maintained component/guide files, inserts the native registration before the original `main()`, and adds a grayscale navigation link. It checks all composition anchors before writes, preserves current unrelated edits, detects intervening changes, and is repeat-safe. Its complete standard-library source stays with this contribution. New source is included by the original complete workspace backup.

For source-only receiving before installation, `python operator/source_refresh_server.py --workspace CURRENT_WORKSPACE` installs the binding in memory and calls the **original** `server.main()`; it does not create a second implementation or a new queue. Open `/source-refresh` on that original server. The maintained entrypoint after installation is still `operator/server.py`.

`operator/source_refresh_native.py` binds the original `Operator.submit(workspace, action, payload, operation_id)` and `_invoke(task)`. `source-refresh.apply` is a normal durable native action. Full export uses the already-existing `workspace.backup` action, output tickets and streaming downloads. Original task interruption/resume, per-workspace serialization and workspace receiving remain unchanged. The browser shares `upstate-operator-capability` and `upstate-selected-workspace` with the original operator, preserves operation IDs across lost responses, tracks the original task, and can resume failed/interrupted tasks. The original bearer, Host/Origin checks and download cookie remain the only session machinery.

GET routes are `/source-refresh/api/catalog`, `show?plan_id=...`, `status?plan_id=...`, and `report?plan_id=...&format=html|csv|json`. POST routes are `diff`, `plan`, `apply`, and `export`. `workspace` selects the existing native registry key; omission selects the original primary. Apply accepts `plan_id`, boolean `execute_runs` and a retained `operation_id`; apply/export return the original task with HTTP 202. Report downloads use the current original bearer. Complete workspace archives stream through `/api/file/` rather than accumulating a large ZIP in browser memory.

Source pair inputs are `from_collection_id`, `to_collection_id`, optional `mapping`, optional `roots`, and optional `title`. No local filesystem paths, executable commands or arbitrary methods are accepted by these HTTP operations. The handler preserves the original access policy and content-security headers, rejects duplicate query/JSON members and cross-site writes, and accepts at most 1 MiB of request JSON. The current handler and all unrelated routes are delegated unchanged.

The transport-independent `dispatch(workspace, action, payload, submit=...)` and `extend_handler(...)` are also exposed for future original-operator composition. The concrete native binding is the reference; caller callbacks are not a replacement for the existing durable queue.

## Persistence and recovery

Immutable plans use the original `_save/_get` content-addressed collection under `source-refresh-plans/`. Each plan retains complete source differences, explicit source mappings, frozen roots, original native selections and the dependency graph. Applying a plan first verifies retained source bytes and reconstructs its native graph; it then uses `save_profile`, `save_scenario`, `prepare_grid`, `prepare_run`, and `run` from that same Workspace. Native run reads use its original `inspect_run` accessor; retained source objects are verified with the original file helper using their object-relative paths. Changed mappings require a new immutable plan, never an edit to an applied one.

Execution lives at `source-refreshes/PLAN_ID/state.sqlite3`. One transaction commits the header and the active step. This avoids rewriting every previous step whenever another node advances. Connections are operation-private, rollback-journal mode is used, and the original per-plan file lock prevents simultaneous application. Full `state()` receiving still returns every step. Native selections remain the authoritative scientific objects; mutable checkpoint IDs are checked by idempotent native preparation before reuse.

If native execution raises an exception, the refresh records the failed step and error type/message. Reopening and applying the same plan reuses completed native objects and resumes remaining work. Cancellation callbacks are checked between native operations. Stop/reconnect during a native stage belongs to the original process supervisor, which the extension does not replace.

Full handover uses the original `Workspace.backup(..., include_intermediates=True)` operation while holding the refresh lock. Browser exports retain the plan binding in the original workspace.backup payload; the native registration acquires that same lock before invoking the original backup. The normal serialized workspace queue and original download tickets are preserved. Use the application's original receiving/restore workflow to reopen the complete workspace independently. Source editions, old and new scientific selections, refresh plans, SQLite checkpoints and reports remain ordinary workspace files.

## Exercised scope

The accompanying workbench drives actual retained files and original-Workspace-shaped writers through replacement, failure, reopening, resumption, cancellation, missing-source mapping, exact unchanged-ID reuse, checkpoint alteration rejection, full fixture backup/receiving, CLI and a real HTTP server. Scientific execution is an invocation probe, not a numerical model in the workbench. Offline Chromium exercises the shipped controls against this retained-file backend; the separate HTTP journey checks routing, queuing and original authorization. The maintained native InVEST execution remains in the original application and its current regional receiving host.

Source addition owners can bind this extension to their cumulative operator without editing its scientific engine. The selected-model cohort's additional selection fields pass through unchanged to the current native writers; source dependencies are read from the actual grid/profile/scenario selections rather than a second hard-coded science pipeline.
