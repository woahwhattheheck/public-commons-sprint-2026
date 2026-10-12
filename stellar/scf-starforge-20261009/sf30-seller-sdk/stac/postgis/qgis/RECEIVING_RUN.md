# Continue native PostGIS receiving in QGIS

This executable continuation uses the existing Starforge QGIS workspace, PostGIS reader, native project saver, complete exporter, and create-only receiver. It opens the actual accepted database views through the operator's configured service. It does not stage, promote, roll back, or edit database rows.

The whole PostGIS workflow's operator remains the execution owner. Run this file as the QGIS phase of that same retained workflow, after the database receipt and reader profile are available. The script does not register a second native workload or install another QGIS engine.

## Required receiving inputs

Use an installed QGIS Python environment with QGIS 3.40 or later and its PostgreSQL provider. The application directory is the complete `sf30-seller-sdk` checkout containing both `stac/qgis` and `stac/postgis/qgis`. Configure the actual existing libpq service and, when used, its QGIS authentication configuration before running. Retain the chosen SSL mode and database role.

Save a private UTF-8 JSON handoff with these fields:

| Field | Required value |
|---|---|
| `schema` | `starforge.postgis-qgis-native-handoff.v1` |
| `operationId` | One stable original operation ID, at most 120 characters, using letters, digits, period, underscore, colon, or hyphen. |
| `actor` | The receiving operator's attribution. |
| `title` | The title to use only when creating the original QGIS workspace. |
| `applicationDirectory` | Absolute path to the complete SDK source checkout. |
| `sourceDirectory` | Absolute path to the actual accepted `postgis-receiving.json` directory and its complete nested source files. |
| `expectedManifestSha256` | The exact SHA-256 of that original `postgis-receiving.json` file. |
| `layerIds` | Explicit, unique IDs from that receipt's accepted `layers` array. |
| `connection` | The native connection-reference object described below. |
| `workspaceDirectory` | The one original QGIS workspace directory. It may be newly created or the same retained workspace on continuation. |
| `receivingDirectory` | A separate receiving directory for the complete project archive. It must be new or belong to the same already-started receiving operation. |
| `outputDirectory` | A private output directory, separate from both workspace directories. Reuse it on continuation. |
| `qgisProfileDirectory` | The absolute path to the already configured private QGIS profile. It remains outside the project package. |
| `sourceHead` | Optional original full-source release identifier to retain in the result. The parent workflow verifies its installed source. |
| `projectCrs` | Optional actual QGIS CRS string, or `null` to use the first selected native layer's CRS. |
| `requireUnchangedRows` | Optional boolean, default `true`. A false value retains reported live differences instead of treating them as a failed initial receiving comparison. |

The `connection` object uses the maintained `starforge.postgis-qgis-connection.v1` schema. Its fields are `profileId`, `service`, `authConfigId`, `role`, `sslMode`, and `allowEditing`. Set `profileId` to the receipt's declared database profile and `role` to the actual reader role in its accepted role observations. Use the host's service name and local seven-character authentication configuration ID, or an empty authentication ID when the service uses the host's normal libpq authentication. Set `allowEditing` to `false` for this receiving phase. The default SSL mode remains `verify-full`; an explicitly supplied mode passes through unchanged.

Do not place passwords, connection URLs, expanded host/user credential strings, or an authentication database in the handoff. The maintained parser accepts service and authentication references only. This continuation does not create, unlock, copy, or rotate credentials.

## Run through the actual QGIS interpreter

Use the interpreter that can already import the installed `qgis.core`. The command is:

```sh
QGIS_PYTHON stac/postgis/qgis/examples/receive_project.py --handoff /absolute/private/qgis-handoff.json
```

Replace `QGIS_PYTHON` with that actual interpreter path. If its installation requires an explicit QGIS prefix, append `--qgis-prefix` with the actual absolute installation directory. The script selects offscreen Qt rendering only when the caller has not already selected a Qt platform.

Include this QGIS child, its source reads, two project workspaces, rendered images, and complete archive in the original workflow's honest resource allocation. The reader processes every role-visible row. This guide does not claim an installed runtime or a measured resource peak on any host.

## What the continuation completes

1. It binds the entire original handoff before action and holds one local operation lock. Every mutation receives a stable child request ID and a saved exact request before the existing workspace API is called.
2. It creates or reopens the original QGIS workspace and records its starting identity and history. The accepted source is imported through `QgisWorkspace.import_source`, with the complete original descriptor and hash checks.
3. It uses `record_check` to verify each explicit relation through the actual QGIS PostgreSQL provider: selected role, accepted metadata revision, physical view dependency, column and geometry contract, privileges, complete visible row digest, and native feature-ID lookup. Existing successful checks retain their original operation result.
4. It appends the selected accepted layers through the original `save_selection` and `save_layers` path. Other original layers remain. An existing layer with a different source or connection requires the normal explicit successor review; this continuation does not replace it silently.
5. It saves a real native QGZ with the original `save_project`, reopens it through `reopen_project`, refreshes its existing managed database layers, and renders the actual visible project. A role with no visible geometry retains that observation instead of receiving an invented map.
6. It freezes the complete original workspace snapshot and exports it through `export_package`. The archive contains the original source closure, native maps, styles and their resources, operation history, all eight adapter files, the existing QGIS software, and its guides and license.
7. It calls the original `receive_package` in the separate receiving directory, compares the entire restored snapshot, reopens the same retained QGZ, refreshes those actual native layers, and saves a second real map image.
8. It verifies that every earlier workspace event and request remains and that receiving did not change the exported original workspace. It writes the final result only after all those stages finish.

The native database receipt is an original observation. Live authorized edits may exist later under the same accepted metadata edition. The adapter reports those differences separately. With the default `requireUnchangedRows: true`, a changed row digest leaves the same receiving operation incomplete for review; the script does not change the database or invent a newer acceptance.

## Continue after an interrupted response

Rerun the same command with the same handoff, output directory, and workspaces. Do not generate another operation ID.

The operation subdirectory retains the exact handoff, child requests, child results, original workspace snapshot, and native reopen records. Each existing workspace mutation reads its original request result before another action. A previously imported source can be read from the retained workspace even if the original external delivery directory is no longer available.

Native reopen and refresh reports contain actual observation timestamps. The first completed report remains unchanged. A resumed native read saves its full timestamped report as a separate SHA-named observation and compares all substantive fields with the original; only the defined native `checkedAt` field is excluded from that comparison. A changed binding, role, field contract, count, extent, or other report value leaves both observations retained for review. The original successful complete-row check keeps its original `readAt` and result. These observation files and their exact hashes are included in the final receiving result.

A rendered PNG carries its original receiving operation, source, project-input hash, and connection-reference hash as image metadata. If publication succeeded before its small result record was written, the continuation checks those exact original bindings and retains that image. It does not overwrite a different image. A previously published archive is reopened, bound to the frozen snapshot, and validated by the same complete receiving engine.

An interrupted receiving directory stays attached to the original archive. The original engine verifies any already extracted files and completes that same receiving operation. It never replaces a different or independently modified workspace.

After the final result exists, another same-command invocation verifies its original archive and image hashes and returns `replayed: true`. That is a readback of the completed historical result; it does not perform another database observation.

## Final files and receiving boundary

The output directory contains:

- `qgis-native-result.json`: actual QGIS version, accepted source/edition/revision, the retained native check, original and received native reopen/refresh results, preserved history counts, and exact output descriptors.
- `Starforge_PostGIS_QGIS_Complete_Project.zip`: the complete original workspace package.
- `PostGIS_QGIS_Received_Map.png` and `PostGIS_QGIS_Reopened_Map.png`: actual renders when a visible geometry extent exists.
- The original operation subdirectory, containing its requests and recovery records.

The QGIS profile, its authentication database, libpq credential files, and database server contents remain external. A receiving host must configure the corresponding local service/authentication reference before opening a database-backed map. A source package remains inspectable when those native connections are unavailable; a successful live map reopen is reported only after the actual provider checks finish.

The final result's `noDatabaseMutation` describes this QGIS receiving phase. It does not describe or replace the parent workflow's earlier explicit database staging and promotion. No native execution outcome is asserted merely because this continuation source is packaged.
