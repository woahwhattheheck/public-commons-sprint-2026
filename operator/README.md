# Upper Savannah scientific operator

This operator connects the original scientific workspace to a local browser. It covers source intake, parameter profiles, model grids, explicit land-cover scenarios, native NDR/SDR runs, observed-load comparisons, seven-map delivery, full backup and receiving.

## Open the workspace

Use the same Python environment as the original model CLI. It must contain the selected InVEST 3.20.0 release and the model's installed GIS dependencies.

```sh
python -B operator/server.py \
  --workspace /absolute/scientific-workspace \
  --create \
  --title 'Upper Savannah source study' \
  --source-manifest /absolute/original-capture/source-manifest.json
```

Omit `--create` when opening a retained workspace. Repeat `--source-manifest` for additional original source editions. The server prints its actual loopback operator URL; open that complete URL in the local browser. The initial capability is held in the URL fragment, copied into the tab's session storage and removed from the address. Named people can connect with their assigned private access link. The startup capability remains local installation-owner access. See [TEAM_ACCESS.md](TEAM_ACCESS.md) for project roles, credential management and installation recovery.

The default listener binds `127.0.0.1` on an available port. The interface, styles and scripts are local files. The scientific model is the existing `model.workspace.Workspace`; the operator does not implement another model, grid engine, coefficient table or calibration procedure.

## Work through an actual source study

1. **Retain source data.** Open Original sources and select an operator-registered manifest, an original source ZIP, or a single original table/file with its title, URI, vintage, kind and units. Preview the exact selected manifest before import. The native intake verifies and retains source bodies and sidecars. Native source inspection shows raster headers, vector fields/layers or the first original CSV rows and offers the complete original download.
2. **Save a parameter profile.** Select the actual combined biophysical CSV and its source edition, add original references, and enter the intended NDR and SDR parameters. The original model checks all required coefficients and parameters. Revising a profile creates another immutable selection.
3. **Prepare the reporting grid.** Select the actual DEM, original reference land cover, precipitation, rainfall erosivity and soil erodibility; preserve the land-cover cell size separately from the upstream buffer; choose the original reporting boundary, covering hydrologic model domain and positive context buffer. Optional selections use exact native field equality. The original engine preserves the source pixel grid, source vintages, units and native resampling decisions.
4. **Define scenarios.** Retain an unchanged source baseline. For each alternative, select an actual polygon mask, original integer land-cover codes, replacement code, and a reason. The source edition stays intact.
5. **Run the original models.** Prepare a run from a complete grid, saved profile and scenario, review the retained selection, then start it. The interface reads original stage status, native logs and output hashes. A failed or interrupted task resumes its original selection; completed native stages are reused by the model.
6. **Compare outputs and observations.** Compare completed baseline and alternative runs on the same grid. Upload original observation CSVs with their column mapping, source period and source URI. Explicit annual mass-rate inputs require their actual annualization method. Context measurements, unaccepted qualifiers and other excluded rows remain retained. Observed comparisons join the original catchment identifiers and display annual mass, residuals, coverage and summary metrics.
7. **Build the complete delivery.** Choose completed paired native runs, original protected-land/parcel/hydrography/wetland sources, actual drinking-water and designated high-quality-water overlays, contact metadata and map settings. Optional parcel priority produces the original parcel GIS/CSV inventory. The original delivery engine generates the seven map families, physical rasters, metadata, interpretation report, working archive and audited delivery package. PDFs can be viewed in the operator; every output is downloaded as its exact retained file.
8. **Save, receive and continue the project.** In Guided journey, choose **Save view and transfer project**. Project continuity opens the complete-project form with the saved analysis and chosen operation history. Select a whole ZIP or incremental handover, then receive that edition on the destination and choose **Open received project**. The separate receiving workspace retains the original project identity, source, results, application, saved notes and original inputs needed by the selected unfinished tasks. Inspect its history and use **Resume unfinished work** to continue those selections.

The interface starts with actual imported entities. It supplies no sample coefficient table, synthetic observations, invented source designations or prepared model result.

## Guided analysis and portable working view

Open **Guided journey** to select a retained baseline, explain its original
inputs and geography, revise a case, calculate through the original queue,
compare physical results, open maps and create the working handover. The native
run desk and scenario experiments preserve each run's actual model selection.

Choose **Save view and notes** to retain the current analysis in the scientific
workspace. **Save view and transfer project** saves that view and opens the
complete continuity handoff. Its archive or incremental edition captures the
chosen task history and the same selected baseline, alternative,
comparison, map view, delivery and notes in `operator-session.json`. When its
archive opens in a receiving workspace or a new browser, the saved guide resumes
against the same project and scientific records. Distinct prior notes remain
available in the guide's note versions.

The original reference resolution is preserved when revising a prepared grid.
The grid form reads the selected original land-cover header and uses that
edition's native square-cell resolution. Previously saved grid revisions keep
their original selection. Cell size and upstream context buffer remain
independent values. The issuer requires final Upper Savannah map data on a 30 × 30 m regional
grid, with an external modeling buffer chosen for the catchment (RFP p. 2).
The Gura grid supports the original working demonstration. An omitted `resolution_m` retains the historic
30 m selection identity.

The official InVEST 3.20.0 Gura release data use 15 m cells and the original
watershed's explicit zero upstream buffer through
`source_tools/receive_gura_native.py`. The earlier working edition retains its
separate 300 m grid and recorded buffer through `source_tools/receive_gura.py`.
The guide below identifies both receivers, original archives and cell areas.

See `GUIDED_JOURNEY.md` for the complete operating sequence.

## Original operation lifecycle

The operator maintains one serial task queue. Every submitted action has an operation ID and exact selection hash. A repeated submission with the same identity returns the retained task; reusing that identity with a changed selection is rejected. A concurrently active identical selection is reused.

Each attempt records its timestamps, native outcome and error. Closing the server drains the running operation; queued tasks remain available as interrupted work when reopened. A task can be cancelled before it starts. Resume uses the same task and delegates continuation to the original model's existing grid/run/delivery stages.

The active task journal lives in the configured operator-state directory. **Project continuity** carries selected scientific operation history and required unfinished inputs into the native archive, then rejoins them to the receiving queue. It preserves original request identities and reuses completed results before offering explicit resumption. Scientific workspace backups carry source, model stage state, application and the saved operator view; use the complete-project route when the handoff also needs task history and unimported uploads. Transport-control attempts remain with the operator that executed them.

Forms keep the entered draft open when the server rejects a selection or a request fails. Large original files stream directly to an immutable operator upload, then enter the original model through the selected operation. Physical paths are chosen by the CLI operator; the browser works with registered sources, uploaded original files and retained entity identifiers.

## Capacity and file downloads

Defaults:

| Setting | Default |
| --- | --- |
| Bind address | `127.0.0.1` |
| HTTP port | Available local port |
| Active model tasks | One |
| JSON request limit | 4 MiB |
| Original upload limit | 4 GiB |
| Source ZIP declared extraction limit | 64 GiB |
| Source ZIP members | 20,000 |
| Native log chunk | 64 KiB |
| CSV preview | 30 original rows |
| Vector preview | 20 original features |

Select actual storage capacity with `--upload-limit-mib` and `--source-extraction-limit-mib`. Set `--operator-state` and `--restore-directory` when the receiver uses separate storage. These limits govern original data intake; they do not change scientific parameters.

After the authenticated tab opens, a separate installation-specific HttpOnly, SameSite Strict session cookie supports file downloads. It is accepted only for file reads and rechecks the current person's project access. It supports native browser streaming and byte ranges for large archives/PDFs without putting credentials in query strings or loading an entire ZIP into browser memory. A download ticket identifies a retained workspace file by its expected byte length and SHA256. Changed files fail readback.

Source ZIPs accept ordinary unencrypted relative file paths and original sidecars. The receiver rejects traversal, duplicate file names and link/special-file members. Native workspace restore continues to use the original portable archive verifier.

## HTTP interface

All routes below require `Authorization: Bearer <operator capability>`. File downloads additionally accept the separate scoped cookie established by `POST /api/session`.

| Route | Original operation |
| --- | --- |
| `GET /api/state?workspace=...` | Model overview, retained task summaries and registered source choices |
| `GET /api/item?workspace=...&kind=...&id=...` | Exact retained entity and authenticated original-file tickets |
| `GET /api/source-info?workspace=...&collection=...&source=...` | Actual original source header/schema/sample |
| `GET /api/run-log?workspace=...&id=...&offset=...` | Next retained native log bytes |
| `GET /api/task?id=...` | Original operation, selected inputs and attempts |
| `GET /api/runtime` | Actual installed package versions |
| `POST /api/upload` | Stream an original file with `X-Upload-Filename` |
| `POST /api/source-preview` | Preview a registered manifest or retained upload |
| `POST /api/operator-session` | Save the selected guide and notes with project identity and revision checks |
| `POST /api/actions` | Submit one original action |
| `POST /api/task/resume` | Resume the same retained task |
| `POST /api/task/cancel` | Cancel a task before it starts |
| `GET /api/file/<ticket>` | Exact retained file; `?download=1` requests attachment disposition |

Action requests use `{workspace, action, payload, operation_id}`. Supported actions are `source.import`, `profile.save`, `scenario.save`, `grid.prepare`, `run.prepare`, `run.start`, `run.compare`, `observation.import`, `observation.compare`, `delivery.build`, `workspace.backup` and `workspace.restore`.

The native CLI remains available for reproducible source acquisition, original analysis and command-line receiving. Browser forms use those same persisted model selections.


### Original land-cover classes and source inspection

Raster cell size follows the original land-cover reference. Spatial land-cover legends and point inspection show descriptions from retained original biophysical tables, including the Gura sources, while physical outputs keep their native numeric scales. The original profile table remains available from the profile detail during a native calculation. Guided Step 7 opens the scenario report desk as well as full regional delivery generation.

## Named people and project access

Open **Manage team access** in the sidebar to assign administrators and project viewers/analysts. The complete operating and receiving guide is [TEAM_ACCESS.md](TEAM_ACCESS.md). Keep the operator-state directory outside application source and every scientific workspace.
