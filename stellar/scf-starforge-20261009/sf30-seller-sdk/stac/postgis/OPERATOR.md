# PostGIS intake and customer operations

This module turns an original Starforge vector receiving package into a retained PostgreSQL/PostGIS project. Its operator interface covers source inspection, typed mapping, complete staging, comparison with customer edits, publication, rollback, independent reader receiving, complete backup, and restore into a second agreed database.

The database, QGIS and GeoServer each keep their existing native responsibilities. This controller owns the accepted database editions and stable views. The [QGIS adapter](qgis/OPERATIONS.md) extends the original desktop workspace and native map history. The GeoServer publisher consumes the same [receiving contract](RECEIVING.md).

## Commission the selected environment

Use a PostgreSQL 15 or later server with PostGIS 3.x already installed, the selected database and schema, and the existing roles agreed for this project. The controller reads the actual PostgreSQL version, PostGIS build, extension schema, database identity, available SRIDs and privileges before operating.

The Node runtime needs the existing SDK dependency closure from `sf30-seller-sdk/postgres/package.json`: Node >=22.16.0, pg 8.23.1 and pg-cursor 2.22.1. The `stac-postgis` distribution contribution binds that same original driver manifest. The original vector receiver and CRS helper need the native Fiona/GDAL/PROJ environment used for the original export. Pass its actual Python executable through `--python` when it differs from the default.

Keep commissioning credentials in a regular, private JSON file readable only by its owner. The CLI rejects symlinks and group/world access to that file. It accepts the native node-postgres connection fields; for example:

```json
{
  "host": "actual.database.host",
  "port": 5432,
  "database": "selected_database",
  "user": "existing_commissioning_role",
  "password": "set-in-the-private-local-file",
  "ssl": {"rejectUnauthorized": true}
}
```

Replace these illustrative values with the selected native connection. Use the actual TLS trust configuration appropriate for that service. An existing local Unix-socket demonstration can use its socket directory and local authentication. Secrets remain in the native connection file and are not copied into receiving packages, source profiles, the browser, or backups.

The commissioning role needs schema creation rights, ownership of this project's objects and membership of the explicitly selected existing reader/editor roles. It must be able to observe each selected role. Reader/editor roles must not bypass row security. The controller creates its own project metadata, physical tables, indexes, policies and views inside the selected schema; an unrelated existing relation is a conflict.

## Select an explicit source and mapping

Start with [profile.example.json](profile.example.json), replacing the database, source layer IDs, names, fields, geometry and roles with the agreed original source. A profile uses schema `starforge.postgis-intake-profile.v1`.

| Selection | Meaning |
| --- | --- |
| `projectId` | Durable project identity across editions, receiving, backup and independent restore |
| `database.profileId/name/schema` | The selected native database mapping |
| `layer.id/sourceLayerId/relation` | Stable customer layer, original vector layer and public SQL view |
| `fields` | Explicit original field to PostgreSQL column/type mapping |
| `geometry` | Native source and target SRIDs, geometry type, dimension and validity choice |
| `roles` | Existing roles, exact permitted operations and optional row scope |

The entire original source record remains in the retained source and database `_sf_source` value. Every field of a selected source layer has an explicit mapped column; structured values may use JSONB or exact JSON text. Duplicate mappings, omitted source fields, reserved names, unsupported casts and missing required values fail before publication.

Exact source numbers use the original vector JSON parser. PostgreSQL integer and numeric targets receive decimal text without JavaScript number coercion. Choosing `double precision` is an explicit target representation choice; the exact original source remains retained. Supported scalar targets are text, boolean, integer, bigint, numeric, double precision, date, timestamp with/without time zone, jsonb and bytea.

CRS handling compares the actual original source WKT with the selected EPSG definition through the native vector environment. A source without its CRS requires an explicit assignment and explanation. Reprojection uses native PostGIS `ST_Transform`; it never substitutes a coordinate relabeling. Geometry type, 2D/3D contract and validity are checked for every staged row.

A row scope names one mapped column and a nonempty set of text values. It applies through native row-level policies and the invoker's actual identity. Select is required for every declared role; insert, update and delete are separately explicit. Stable identity columns and the immutable source baseline are not writable through those editor grants.

## Start the operator

An installed maintained distribution exposes `starforge stac-postgis COMMAND` and `starforge doctor --feature stac-postgis`. Its source-owned contribution includes all original database/QGIS files and registers the same browser asset manifest used by the server. Package the complete immutable source with the existing distribution builder.

From the SDK source directory:

```sh
node stac/postgis/cli.mjs serve \
  --connection /absolute/private/commissioning.json \
  --profile /absolute/project/profile.json \
  --workspace /absolute/project/intake-workspace \
  --python /absolute/native/python \
  --port 0
```

The command prints the selected local URL. The server binds to `127.0.0.1` and checks the exact host and origin. Its private cookie, same-origin API and content policy keep the connection on the local server. Use the printed URL on that machine; a published internet-facing service is a separate deployment.

The workspace is claimed for its original project and database. Reopen that same directory to continue the work. The interface uses neutral tables, plain form controls and five areas:

1. **Project** shows the actual database, accepted edition, layers and role-visible observations.
2. **Source and mapping** opens the complete original vector package and its selected mapping.
3. **Review and publish** compares previous source, customer current values and incoming source.
4. **Operations** reopens committed original requests/results and unfinished requests.
5. **Delivery and recovery** exports receiving packages and full backups or restores a complete project.

Applying a changed mapping clears the old review and decisions. Review the staged edition under its matching mapping before publishing. This prevents freezing a publication request that combines a different mapping with an earlier review.

## Stage, review and publish

Select the original vector export directory and the exact SHA-256 of its `vector-export.json`. Native opening verifies the complete original package, capture, selection and features before retaining it.

Staging loads every feature into a new baseline. It retains source identity, order/occurrence, raw values and geometry, the full mapped source, the native CRS observation, and the exact operation request. It does not replace the accepted views.

Review compares three complete editions: the previously accepted source baseline, current customer live rows, and incoming baseline. Source-only changes can take the source; customer-only changes preserve current values. Concurrent changes that cannot be resolved automatically require an explicit per-row choice. The comparison screen opens exact current, incoming and previous values, including original decimal text and full geometry.

Publication checks the original project revision and full review SHA again while holding the project's transaction lock and the affected physical table locks. Another writer or customer edit after review requires a new review; the rejected original request remains inspectable. A successful publication creates the new live edition and changes all stable views in the same transaction. The previous live edition remains available, including its customer edits.

Use `sf_id` as the native feature identity and `sf_key` as the original source identity. Source row identities are stable across repeated source editions. New operator-created rows use a per-project/per-layer negative-ID sequence so their identities remain distinct from imported source identities. Existing identity fields must not be edited.

The metadata includes only this controller's projects, editions, operations and identities. Bootstrap serialization applies when those tables are first created; ordinary work is serialized per project.

## Continue an interrupted operation

Every mutation has an original `operationId` and a full frozen request. Keep both. The browser retains that request locally before sending; the server retains it before invoking the database. The database stores its committed original result in the same transaction as the change.

Use **Continue original request** in Operations. A committed original request returns its original result and current project state. An uncertain COMMIT is reconciled through the same project lock and operation journal. A new operation ID must not be used merely because a response was lost.

Filesystem publication is create-only. A digest in a request's receiving filename binds an interrupted write to its complete original request. Retrying that same request can finish publication while retaining prior receiving files. Legacy complete temporary requests are accepted only when all their bytes match. Partial or conflicting unknown content remains visible in the interrupted-journal view and does not make the whole Operations page unusable.

The server never silently changes a frozen request to match a later mapping or review. A revision or review conflict represents later work that needs its own explicit review and operation. Existing committed operation results remain unchanged.

## Roll back without discarding customer work

Select a retained accepted edition and the current project revision. Rollback changes the stable views and current role grants atomically. The edition being left retains all its live customer rows, and can be selected again later.

The controller verifies the live view definitions, physical dependencies and column contracts before switching them. It grants access to the selected physical edition and removes the selected view/physical privileges from the edition being left. Historical physical tables remain stored. Explicit column-contract migration is separate from an ordinary source refresh.

A QGIS or GeoServer recipient must receive the current accepted receipt after a change of edition. An older receipt remains useful for historical inspection; it does not authorize connecting an old acceptance to today's moved view.

## Export and independently receive

Export receiving from the accepted edition. The output contains the complete original source closure, selected mapping and a native observation of all accepted layers and role scopes. Each file has an exact size and SHA-256. See [RECEIVING.md](RECEIVING.md) for every consumer field.

The export freezes its native observation before copying the remaining original files. An interrupted export can finish that original historical observation even if the active project later advances. Its operation and observation time remain the original ones. A receiving client separately checks whether that edition is still current.

Use an actual independent reader connection:

```sh
node stac/postgis/cli.mjs verify-receiving \
  --connection /absolute/private/reader.json \
  --request /absolute/project/verify-original.json
```

The request contains `directory`, `expectedManifestSha256`, the selected `role` and optionally explicit `layerIds`. Omitting the layer selection verifies all receipt layers. The entire package is still verified for a selected subset.

The verifier uses the reader's actual `current_user`, never an assumed privileged substitute. It checks edition/revision, invoker view, physical dependencies, column types, permissions, primary-key metadata and every visible row. A reader-role scope may legitimately see fewer rows than the commissioning role.

By default, `requireUnchangedRows: true` requires the complete visible rows to match the accepted observation. An explicitly selected `false` reports authorized later row changes while still rejecting a different edition or altered view. Its result records the selected layers and actual observation.

Cancellation owns and ends that verifier's native client, observes its real terminal event and preserves the primary error. Cursor reads on a lost connection also terminate through that same client's events rather than waiting indefinitely for a ready-for-query message that cannot arrive.

### GeoServer primary keys

If GeoServer needs explicit view primary-key discovery, configure `database.primaryKeyMetadata` for the agreed schema/table:

```json
{
  "schema": "selected_schema",
  "table": "gt_pk_metadata",
  "createIfMissing": true,
  "exposePrimaryKeys": true,
  "policy": "autogenerated"
}
```

The controller verifies the six native GeoTools metadata columns and updates only this project's selected stable views. It preserves unrelated rows. The key column is `sf_id`; `autogenerated` lets the native table/view default allocate a new operator row. Use `assigned` only when that is the existing selected datastore contract. The actual publisher owns its selected workspace, store, namespace, layer and publication/rollback requests.

## Complete backup and independent restore

A complete backup includes:

- original project and profile, all source and customer editions, including editions that are no longer active;
- all original source packages, full operation requests/results and stable imported identities;
- every baseline/live row as native text values plus exact EWKB geometry;
- the selected active edition, role mappings, counts and complete row hashes.

The snapshot reads under the same project transaction and locks the retained physical tables against customer DML. It streams row files instead of building one giant in-memory backup.

Restore requires a second selected existing database/schema and an empty project with the original `projectId`. It preserves the original layer contract, source identity, customer values, operation history and rollback editions. The destination database mapping is explicit; credentials and actual existing role creation remain with that selected environment.

The importer verifies every file and original source through the native receiver, inserts exact identities, restores all typed rows and geometries, and checks the complete database counts and hashes before accepting the restore. It advances shared imported-ID and per-layer operator-ID sequences without changing another project's rows. Only the restored active edition receives the selected live grants; later rollback regrants its selected retained edition.

Historic operation results keep their original paths and observation identities. A restore and a new receiving export have their own original operations and current destination observations.

## CLI and module use

Every mutating command reads one original request JSON. Command arguments do not embed passwords.

| Command | Required request fields |
| --- | --- |
| `inspect` | None |
| `history` | Optional `limit` (at most 500) and `offset` |
| `stage` | `operationId`, `sourceDirectory`, `expectedManifestSha256` |
| `review` | `editionId` |
| `row` | `editionId`, `layerId`, `rowKey` |
| `promote` | `operationId`, `editionId`, `expectedRevision`, `reviewSha256`, optional `decisions` |
| `rollback` | `operationId`, `editionId`, `expectedRevision` |
| `export-receiving` | `operationId`, destination `directory` |
| `export-backup` | `operationId`, destination `directory` |
| `restore-backup` | `operationId`, original backup `directory`, `expectedManifestSha256` |
| `verify-receiving` | Receiving `directory`, `expectedManifestSha256`, optional `role`, `layerIds`, `requireUnchangedRows` |

An explicit review decision is `{"layerId":"…","rowKey":"…","choice":"keep-current"}` or `"take-source"`.

All database commands other than receiving verification require `--connection`, `--profile` and `--workspace`. For programmatic use, import `openPostgisIntake`, `openReceiving`, `verifyReceiving` and `openBackup` from `./index.mjs`, and close the owned intake in the caller's cleanup.

## Run one complete native customer journey

Copy [native-journey.example.json](native-journey.example.json) to a private original request. Replace its placeholders with the actual two distinct original vector exports, profiles, existing role connections, selected customer edits and independent restore environment. The selected customer edit must conflict with a real changed row in the successor source; set the expected conflict floor and explicit decisions accordingly.

Run:

```sh
node stac/postgis/native-journey.mjs /absolute/private/original-native-journey.json
```

The single retained journey stages and publishes the original source, applies the agreed customer edits under the actual selected role, stages the successor, opens the conflict values, publishes the selected decisions, closes/reopens the project, independently verifies readers, rolls back, checks stale receiving, returns to the successor, exports the whole backup, restores it independently and compares all restored values and identities. It replays the original publication result and preserves its full phase history.

If both the actual Playwright module and Chromium executable are supplied, the same journey also opens the real operator, its original operation and native source inspection, and saves the current screenshot. Its result states whether that browser phase actually ran. When the original request includes `qgis`, the same journey launches `qgis/examples/receive_project.py` through that actual QGIS interpreter. It passes the exact accepted receipt, existing service/authentication reference and one retained QGIS operation; the child independently verifies every selected relation, saves/reopens the native project, preserves existing layers/history, exports the complete project, receives it into a second workspace and reopens that received map. Producer pools close before this independent desktop phase. `qgisExecuted` and the complete child result identify whether it actually completed. See [QGIS receiving inputs](qgis/RECEIVING_RUN.md).

A failed phase is resumed from the same request, operation and directory. A phase output is retained only after its complete native action succeeds. The result is `native-result.json`; until that file is produced by the native run, source review alone is not a claimed database or desktop run.

## Native references

- [node-postgres Client API](https://node-postgres.com/apis/client)
- [node-postgres cursor API](https://node-postgres.com/apis/cursor)
- [PostgreSQL CREATE VIEW](https://www.postgresql.org/docs/15/sql-createview.html)
- [PostgreSQL row security](https://www.postgresql.org/docs/15/ddl-rowsecurity.html)
- [PostGIS ST_Transform](https://postgis.net/docs/ST_Transform.html)
- [GeoServer/GeoTools primary-key metadata](https://docs.geoserver.org/3.0.x/en/user/data/database/primarykey/)
