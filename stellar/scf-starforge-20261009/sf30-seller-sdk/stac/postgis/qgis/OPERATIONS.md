# Native PostGIS receiving in the original QGIS workspace

This adapter opens accepted PostGIS relations through QGIS's native PostgreSQL provider. It extends the existing Starforge receiving plugin, workspace, map/style controls, project history, CLI and complete receiving package. The original STAC and vector readers remain available in the same workspace.

The database controller owns intake, typed mappings, role grants, promotion and rollback. This desktop adapter consumes its exact `postgis-receiving.json`, observes the currently selected database role, and connects the resulting native map layers. The source checkout also contains the database contract at `stac/postgis/RECEIVING.md` and the original desktop guide at `stac/qgis/OPERATIONS.md`. In the installed plugin, the original desktop guide is `starforge_stac/OPERATIONS.md`.

## What the receiving package identifies

An accepted database export contains the receiving manifest, frozen `profile.json` and the complete unchanged original vector export under `source/`. The reader validates all declared member sizes and SHA-256 values, the original capture and selection hashes, the source edition and selection ID, and a complete one-to-one mapping of original layers and fields.

Every database layer identifies its stable schema/view, physical edition, view-definition digest, actual column types, geometry type/dimension/SRID, signed bigint `sf_id`, original `sf_key`, accepted logical row digest and role observations. The selected project is identified independently by the database metadata row `project_id, revision, active_edition_id`.

The receipt describes an observation at the accepted edition. Authorized edits can later change rows without changing that edition. A saved native verification records the current selected role's full visible row count and digest separately from the receipt, and reports `changedSinceReceipt`. A different active edition requires an explicit successor review.

## Install with the existing QGIS plugin

Use QGIS 3.40 or later with its native PostgreSQL provider. The accepted database needs PostgreSQL 15 or later and PostGIS 3.x. The provider checks the actual database versions and typed geometry; a JSON receipt alone is insufficient.

Build the complete existing plugin from the source checkout:

```sh
python stac/qgis/plugin-package.py --out /absolute/output/starforge_stac.zip
```

Here `stac/` is the directory in the seller SDK source. Install that ZIP with QGIS **Plugins → Manage and Install Plugins → Install from ZIP**, or use the already installed complete plugin. The package contains the original plugin plus all eight canonical files in `stac/postgis/qgis/`. There is no second QGIS project engine to install.

Open the original **Starforge STAC Receiving** dock and create or open its workspace. The additional **PostGIS receiving** tab uses that same workspace and its original operation journal. File-based STAC/vector maps and database maps can coexist.

## Configure the actual local connection

The operator selects an existing local libpq service and, optionally, an existing QGIS authentication configuration. The service supplies the real database and user. The selected role field is a receiving check; it does not issue `SET ROLE` or replace the service's identity.

A local service entry can hold endpoint, database and TLS settings:

```ini
[my_accepted_reader]
host=the-configured-database-host
port=5432
dbname=the-configured-existing-database
user=the-configured-existing-reader
sslmode=verify-full
sslrootcert=/absolute/local/path/to/approved-ca.pem
```

These are operator placeholders, not a supplied deployment. Use the organization's normal libpq service location or `PGSERVICEFILE`. Supply authentication through the local QGIS authentication manager or the locally managed libpq credential mechanism. The receiving ZIP does not include those files, passwords or the authentication database.

In **PostGIS receiving**:

1. Choose the accepted receipt.
2. Enter the exact local service name.
3. Select its local QGIS authentication entry when needed.
4. Select the actual existing role listed in the receipt.
5. Choose the connection's SSL mode. The default is `verify-full`.
6. Enable editing only when the intended role and workflow require it.

The connection reference retained in the workspace is:

```json
{
  "schema": "starforge.postgis-qgis-connection.v1",
  "profileId": "the-profile-id-in-the-receipt",
  "service": "my_accepted_reader",
  "authConfigId": "",
  "role": "the_existing_reader",
  "sslMode": "verify-full",
  "allowEditing": false
}
```

See [connection.schema.json](connection.schema.json). Only these declared fields are accepted. The service name has at most 160 characters, and a nonempty authentication ID is the actual seven-character QGIS ID. A receiving package can retain those references, but it cannot make a service or authentication entry exist on another machine. Configure the receiving machine through its local native tools.

## Import and verify an accepted edition

Use **Import PostGIS receipt** and select the original `postgis-receiving.json`. The original importer copies and verifies the complete closure into its workspace. **View original receipt** exposes the full source and typed mappings. Double-click a relation for its exact accepted field and role observations.

Select one or more relations in the table and choose **Verify selected native relations**. The native operation verifies:

- the actual database name and effective role;
- the accepted project metadata and active edition;
- accessible schema and a security-invoker stable view;
- its original physical relation and actual view-definition SHA-256;
- the complete ordered column mapping and typed geometry;
- the selected role's observed read/write privileges and explicit row scope;
- all visible logical rows, their exact signed IDs, source keys and ordered digest;
- native QGIS feature-ID lookup for original samples, including observed large or signed IDs.

The adapter never escalates roles. The database controller's project-row policy allows a receiving role to read only its accepted metadata row and the three metadata columns needed here. A scoped role must not be superuser or bypass row security; the live visible rows are checked against the explicit mapped-column scope.

A full verification reads every role-visible row through the native provider's query result, with progress callbacks during hashing. It commits no partial receiving result after an interrupted read. The provider can allocate memory for its SQL result; reserve resources for the real selected dataset. The readback states the actual completed row count.

Saved results appear under **Read saved native verification** and in the original workspace history. Counts and IDs remain decimal text in the observation. The ordered row digest uses the same PostgreSQL SHA-256 expression, UTC date/time context and canonical per-row digest format as the producer. Feature values are not converted through JavaScript or rounded for comparison.

A completed request replay returns its original observation. A new intentional observation uses a new request ID, so later edits do not overwrite the earlier result.

## Create and operate the native map

After checking the intended connection, choose **Retain selected relations**. This saves their source identities and explicit local connection references through the original layer action.

Switch to **Sources and layers** and choose **Apply to QGIS map**. The original native map controller validates every selected layer before replacing its owned layers. It preserves unrelated map layers and refuses to replace an owned PostgreSQL layer with an unresolved edit buffer.

Use the original controls to:

- edit the retained layer label, native subset expression, opacity and visibility;
- open native layer properties and use ordinary QGIS symbology;
- capture current styles and their original local dependencies;
- reorder or remove retained map selections;
- choose the project display CRS, zoom and save a native map version.

The database geometry keeps its accepted SRID. Reprojection belongs to the project display CRS. A native subset is an analyst filter retained in the layer definition; it does not change the producer's original role-visible denominator.

**Edit selected** opens the PostGIS connection/layer dialog for a database layer. It saves changes only after verifying the actual selected database identity and accepted relation. **Use selected layer connection** copies an already retained connection into the receiving pane, which is useful for a later native observation.

Editing uses QGIS's original tools and PostgreSQL's actual grants. The desktop layer is read-only unless both the explicit editing choice and observed role privileges allow writes. The feature identity columns are read-only in the edit form. Do not change existing `sf_id` or `sf_key`; follow the database controller's contract for new operator-created rows and their negative IDs. The adapter does not create an alternative write API.

Commit or roll back native edit buffers before **Refresh current database layers**, replacing the selected map, or moving to a successor edition. Refresh checks every existing source/URI first, reloads the same native layers and returns current role observations. It does not promote or roll back database editions.

## Review a promotion or rollback explicitly

When the database metadata reports another edition, the adapter stops with `POSTGIS_STALE_RECEIPT`. Obtain that edition's actual complete export from the original database controller and import it as another source. A rollback also produces its own accepted receipt and revision; do not relabel an older receipt as current.

In **Review**, select the original and later sources, compare them, and choose **keep**, **update** or **remove** for every affected map layer. Record the reason.

- **Update** preserves the logical map ID, display choices and saved style when the complete stable column and geometry contract is unchanged.
- **Keep** preserves the old binding and its history. It does not make a stale database view reopen as that historical edition.
- **Remove** removes only the current map selection. Original sources, reviews and saved maps remain in history.
- A changed relation, column mapping or geometry contract requires explicit inspection and a new layer selection. It cannot be silently substituted beneath an existing style.

If the new receipt needs a different local service/authentication reference, select that exact later receipt in **PostGIS receiving**, configure its actual local connection and choose **Use this connection for reviewed successor choices**. This uses the same comparison, per-layer decisions, reason and original review operation. Otherwise the original **Apply reviewed decisions** control preserves the prior connection reference.

Verify the later relations, apply the reviewed selection through **Apply to QGIS map**, then save the next native project version. Native checks reject any stable view that has moved to another physical edition or changed its definition without the corresponding accepted identity.

## Save, receive and reopen the complete workspace

Use the original **Save native map version** action. It retains one operation input, a create-only native QGZ, independent native reopening and the workspace event. A replay uses that same input and saved file.

Before reading a saved QGZ with database layers, the adapter inspects its XML. Every layer must have the original selected source/layer identity. Database URIs must contain only the retained service/authentication references, accepted relation, key, geometry and subset. Mixed file layers must resolve to their exact retained local members. The adapter then checks the live database and uses the original QGIS reader and native readback.

The original **Export complete project** includes:

- current workspace state, original history and requests;
- every retained source edition, profile and complete original vector package;
- saved native QGZ versions;
- captured style files and their dependencies;
- saved PostGIS checks;
- the complete original application software, including this adapter and guide.

The export is a receiving workspace with live database references. It is **not a PostgreSQL database backup**. Database backup/restore remains with the original controller. The package does not copy local service configuration, passwords or QGIS's authentication database.

Receive the complete package into a new destination through the original **Receive archive** action or CLI, verify its expected SHA-256, configure the corresponding local service/auth entry and reopen the retained project. If that machine uses another authentication ID, edit the current retained layer reference, verify it and save a new map version. Preserve the original delivered version as history.

A saved historical QGZ whose stable view has since advanced will remain verifiably retained but cannot truthfully reopen that old database state. Use the original vector files included under that receipt's `source/` as a separate original file-source selection when an offline source map is required, or use an explicitly restored database edition through the controller.

## Original operation recovery

The dock saves its original request body, ID, actor, workspace ID and expected revision before a mutation. An interrupted response therefore leaves a visible pending original action.

Reopen the same workspace and use **Resume pending action**. The original operation lookup returns a committed result before any compare-and-swap check or repeated native work. If no result was committed, the same request can retry its read-only validation and commit once against the retained revision. A real intervening workspace change is returned as a conflict.

Do not change the body behind a retained request ID. Read its result and current state first. Releasing a local pending marker preserves original files and operation history; it does not reverse a committed action. QGIS's own edit buffers must be resolved separately before a layer refresh or replacement.

## CLI over the same workspace

Use the Python interpreter supplied by the installed QGIS environment for commands beginning with `native-`. The original CLI creates and closes one QgsApplication for those commands. File-only import, history, source inspection and receiving can use a compatible ordinary Python runtime.

From the source checkout, put `stac/qgis` on the Python module path. In an installed plugin/package, use its containing software directory:

```sh
PYTHONPATH=/absolute/source/stac/qgis python -m starforge_stac.cli create \
  --workspace /absolute/workspace --title "Accepted database map"

PYTHONPATH=/absolute/source/stac/qgis python -m starforge_stac.cli source-open \
  --directory /absolute/accepted-export --expected-sha256 RECEIPT_SHA256
```

Create an import input using the actual current workspace revision and one deliberate request ID:

```json
{
  "directory": "/absolute/accepted-export",
  "expectedManifestSha256": "the_actual_receiving_sha256",
  "revision": 0,
  "requestId": "desktop-import-001",
  "actor": "the_named_operator"
}
```

```sh
PYTHONPATH=/absolute/source/stac/qgis python -m starforge_stac.cli import \
  --workspace /absolute/workspace --input /absolute/import.json

PYTHONPATH=/absolute/source/stac/qgis python -m starforge_stac.cli postgis-layers \
  --workspace /absolute/workspace --source-id ACTUAL_IMPORTED_RECEIPT_SHA256
```

For a native check, the input is:

```json
{
  "sourceId": "the_actual_imported_receipt_sha256",
  "layerIds": ["the_actual_accepted_layer_id"],
  "connection": {
    "profileId": "the_profile_id_in_that_receipt",
    "service": "my_accepted_reader",
    "authConfigId": "",
    "role": "the_existing_reader",
    "sslMode": "verify-full",
    "allowEditing": false
  },
  "revision": 1,
  "requestId": "desktop-check-001",
  "actor": "the_named_operator"
}
```

```sh
PYTHONPATH=/absolute/source/stac/qgis QGIS_PYTHON -m starforge_stac.cli native-postgis-check \
  --workspace /absolute/workspace --input /absolute/check.json --progress
```

Replace `QGIS_PYTHON` with the actual installed QGIS interpreter command. The example revisions are illustrative; always read the current workspace and retain the exact intended input before dispatch.

For **native-postgis-select**, supply the complete `layers` array and the same `revision, requestId, actor` fields. Use each receipt's `layer_definition(layerId, connection)` through the maintained Python source API, or use the desktop **Retain selected relations** control. Preserve unrelated existing layer definitions; this is the original full-layer replacement action.

Other supported commands:

| Command | Required binding | Result |
|---|---|---|
| `open` | `--workspace` | Current original workspace state |
| `history` | `--workspace` | State and original event history |
| `operation` | `--workspace --request-id` | The saved original request result |
| `compare` | `--workspace --left --right` | Accepted source/column differences |
| `review` | Original JSON input and workspace | Complete per-layer successor choices |
| `native-save` | Original revision/request/actor input; optional projectCrs | Saved native project and independent readback |
| `native-open` | `--workspace --project-id` | Exact native project reopening |
| `native-postgis-refresh` | `--workspace --project-id` | Reopen and refresh those retained database bindings |
| `export` | `--workspace --file --revision` | Complete package at a new explicit destination |
| `receive` | `--workspace --file --expected-sha256` | Complete original receiving into the selected destination |

A CLI `review` input uses `leftSourceId, rightSourceId, decisions, note, revision, requestId, actor`. Each decision has `layerId` and `decision`; an updated PostGIS decision may additionally supply an explicit `connection`. Native refresh is a read/reload of the reopened project, not a saved new project version.

## Receiving checklist and practical limits

The receiving operator should be able to inspect the exact original receipt and mappings, observe their actual selected role, reopen the native map, follow a deliberate successor review, read earlier observations and produce a complete package with its original history.

This source does not assert an unexecuted QGIS/PostgreSQL installation result. Record the real QGIS, PostgreSQL and PostGIS versions, actual receipt/source SHA, role, selected relations, current row observations, saved project ID and final receiving-package hash when the native workflow is run. Keep publisher examples and an operator's database observations labeled with their actual provenance.

The adapter's desktop inspection uses native SELECT operations. Changes to database edition, view shape, role grants, source mappings or saved URI stop the corresponding operation with an explicit finding. Later authorized row edits within the same edition are reported as current content observations. A recipient can inspect both without losing the accepted original.

## Maintained native API references

- [QgsDataSourceUri service/authentication references](https://qgis.org/pyqgis/3.44/core/QgsDataSourceUri.html)
- [QgsAbstractDatabaseProviderConnection native reads](https://qgis.org/pyqgis/3.44/core/QgsAbstractDatabaseProviderConnection.html)
- [QgsAuthConfigSelect native authentication control](https://qgis.org/pyqgis/3.44/gui/QgsAuthConfigSelect.html)
- [PostgreSQL connection service files](https://www.postgresql.org/docs/current/libpq-pgservice.html)
- [PostgreSQL security-invoker views](https://www.postgresql.org/docs/current/sql-createview.html)
