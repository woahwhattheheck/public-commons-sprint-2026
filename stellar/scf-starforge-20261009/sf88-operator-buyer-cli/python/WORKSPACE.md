# Customer data-analysis workspace

Use an acquired dataset in a local browser, keep saved analyses and their actual results, and reopen the complete analytical database after restart. The workspace uses the original Python `DatasetAcquisition`, `DatasetDelivery` and `DatasetDatabase`. It imports completed native deliveries; it does not execute an acquisition or financial operation.

The Data tab selects original deliveries, reviews retained versions and scalar types, downloads the original manifest, and selects the version served by a named SQL view. The Analysis tab saves parameterized SQL and its revisions, executes it against a reviewed selection, pages retained results and exports JSON or CSV. Activity reopens imports, analyses and consistent database backups.

## Start with a completed original acquisition

Use Python 3.11+ and install this source's Python package beside its matching full native Node runtime. The two workspace modules and their browser assets are included by the existing Python package definition; there are no new dependencies.

```sh
python -m pip install --no-deps ./stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python

python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/analysis \
  --checkout /path/to/public-commons-sprint-2026 \
  source --name inventory \
  --session /private/customer/inventory-acquisition \
  --room /private/customer/inventory-data-room

python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/analysis \
  --checkout /path/to/public-commons-sprint-2026 \
  serve --open
```

Use the existing session produced by [the original dataset application](DATASETS.md). `source` registers its native identity and the hash of its immutable `session.json`. It inspects the original session without running a page. `--room` selects its existing SF100 room; omitting that option chooses a private destination inside this analysis directory. The source alias, exact native paths, source revision and observed acquisition status are saved in the database. The browser uses those declared aliases and does not accept arbitrary source paths.

`serve` binds to `127.0.0.1` and chooses an available port. `--open` opens the private capability link in the local browser. For a remote terminal, read the URL from the private `analysis-launch.json` inside the selected database directory using your existing secure local browser/port-forward setup. The ordinary startup line contains the address and control-file path. Capabilities change at every server launch; open the new private link after restart.

The listener enforces its exact Host and Origin, same-origin browser requests and a capability header for every data operation. It is a local operator application, not an Internet-facing hosted service. Its assets contain no database contents or capability. Python's [HTTP server](https://docs.python.org/3/library/http.server.html) is the local transport.

An already built earlier Python wheel keeps its original source identity. Use a cumulative companion wheel that contains this source, or the source installation above. The workspace's matching Node runtime is needed only when registering or importing original acquisitions.

## Import and select data

1. Select the registered source on **Data**. Choose **Import original delivery**. An incomplete acquisition is rejected; complete sessions are opened through the original native exporter. A previously finalized SF100 room is reused.
2. Inspect the resulting imported version. Its row count, snapshot, table, exact original manifest digest and per-column JSON types remain visible. **Download original manifest** returns the stored original bytes, without JSON re-encoding.
3. Enter a SQL view name such as `inventory` and choose **Select for this view**. The action uses the displayed current revision. A stale selection is rejected without changing the view.
4. Use **Query** beside a current view, or **Query this immutable table** on a selected version, to begin an analysis.

Import does not change an existing SQL view. The exact same native delivery and mapping reuse its existing immutable table. An optional column-mapping JSON object maps original field names to SQL names:

```json
{"units":"available_units"}
```

That creates a separate mapped edition of the same delivery, retaining the original edition. It is not a new merchant snapshot or another purchase. Select its version explicitly before using it through a current view. Each row keeps its original ordering column `_sf_row_number`; scalar handling and identifier rules are described in [SQLITE.md](SQLITE.md).

To select a different native acquisition for an existing source alias, stop this workspace and register it with `source --expected-revision N`. The existing source revision is in Data and in `status`. Re-registering the same paths and immutable session is unchanged. Earlier imported data remains available. Use a different room for a different acquisition; original SF100 identity checks apply when a destination already exists.

## Save and use an analysis

For the original inventory example, whose `available` field is a native Boolean and whose `units` field is an integer:

```sql
SELECT SUM(units) AS available_units, COUNT(*) AS available_skus
FROM inventory
WHERE available = :available;
```

Parameters:

```json
{"available":true}
```

Name the analysis `available_inventory` and choose **Save analysis**. SQL and parameter text are retained as an immutable revision. The editor can load a previous saved revision; its next save uses the current head revision displayed in the editor. Changes made by another client are detected before replacement. Unsaved editor contents are retained in this browser's local draft, and data refresh does not replace them.

**Run analysis** records the exact SQL, parameters and reviewed current-view identities before dispatch. The original `DatasetDatabase.query` reads those view identities and the returned rows in the same SQLite transaction. If a current view changed since review, the operation fails with `DATASET_SQL_VIEWS_CHANGED`. Refresh, review the new selection and run explicitly. SQLite's [transaction isolation](https://www.sqlite.org/isolation.html) keeps the accepted query's selection consistent while another client later activates a view.

The retained result includes the actual transaction's view revisions and physical read tables. It remains associated with that execution when views, saved queries or the editor subsequently change. Opening or exporting a result never reruns SQL. Parameter text is parsed by Python, so the browser does not round a signed 64-bit integer parameter before SQLite receives it. Boolean parameters bind as the ordinary SQLite `0`/`1` values.

Default maximum rows is 1,000, adjustable to 100,000. The workspace also limits each query to 4 MiB of returned scalar values and 20 seconds. Results record truncation explicitly. Browser pages contain at most 100 saved rows. Invalid SQL retains its SQLite diagnostic in the failed activity record and leaves previous successful results intact. The original read-only authorizer prohibits database writes, attached databases and file/extension functions.

### Result exports

**JSON** exports ordered columns and native scalar rows, plus the exact executed request, view bindings, read tables and retained result identity. Signed 64-bit integers are emitted as their exact JSON number text. Binary values use an explicit base64 envelope; a non-finite real produced by an SQL expression uses an explicit `sqlite-real` envelope because JSON cannot encode it as a number.

**CSV** exports every retained row, including rows beyond the currently visible browser page, with ordinary CSV quoting and the saved column order. Nulls become empty fields; binary values are base64. The JSON result retains their type information. CSV does not rerun the query and does not infer payment or settlement from data values.

The browser displays typed textual cells so JavaScript does not round large SQLite integers. `result_sha256` identifies the canonical retained typed result, including its original data selection; it is checked when that result is reopened. It is not the hash of the separately formatted JSON or CSV download.

## Back up and reopen

Choose **Create database backup**. The original SQLite backup operation creates a consistent copy containing the imported rows, exact original manifests, current views, activation history, registered source descriptions, saved query revisions and retained analysis results. The completed action gives its local path, byte count and SHA-256. Files of at most 256 MiB can also be downloaded from the browser; larger backups remain complete at the displayed local path. Download rechecks the recorded digest.

The native backup directory is create-only and unique for that action. To reopen a copied backup, keep its file named `datasets.sqlite3` in a private directory and start the same workspace there:

```sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/restored-analysis \
  serve --open
```

Omit `--checkout` to use retained data and analyses without any Node runtime, source acquisition directory, wallet keys or network access. Old source aliases remain recorded, but imports are disabled in that invocation. Backup copies do not copy external acquisition/room files, native financial state, or previous standalone backup files. Those original products retain their existing recovery mechanisms. A backup captures its own in-progress job record; opening the copied database marks that record interrupted, without replaying it. All committed analytical data and earlier completed results remain usable.

One process owns background work for each analysis database. A second workspace process cannot recover a live process's jobs. An abrupt stop rolls back an incomplete SQLite transaction; on the next open, unfinished work is marked **INTERRUPTED**, and no job is automatically dispatched. If an import committed before its activity record was finalized, explicitly importing the same original delivery reuses the retained version. Completed results are committed atomically with their completion state.

The read-only status command is available while the browser process is running:

```sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/analysis status
```

For embedding, import `AnalysisWorkspace` and `serve` from `stellar_forge_buyer.analysis_workspace`. The controller exposes `register_source`, `save_query`, `saved_query`, `start`, `job`, `export_result`, `state` and `close`. `serve` returns the standard server, private control-file path and local capability URL. Call `server.server_close()` and `workspace.close()` after stopping the server; ordinary shutdown waits for its already dispatched analytical work.

The original standalone database API remains available. `DatasetDatabase.view_bindings()` returns the current view identities; pass that list as `expected_views` to `query` when a caller has reviewed them. `QueryResult.views` and `QueryResult.read_tables` identify the actual read transaction. `manifest_bytes(version_id)` returns the verified original manifest bytes, while the existing `manifest()` returns its parsed object.
