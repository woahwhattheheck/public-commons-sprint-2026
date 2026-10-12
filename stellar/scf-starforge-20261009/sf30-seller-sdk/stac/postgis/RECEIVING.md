# PostGIS intake receiving contract

This is the integration boundary for the complete source-to-database workshare. The database producer, QGIS project consumer, and GeoServer publisher use the same accepted edition. The original vector producer retains the selected GeoJSON/GeoPackage source bytes, every typed source feature and its original identity; this adapter consumes that existing receiving package.

## Product ownership and prerequisites

Database implementation: `stac/postgis/`. QGIS consumer: `stac/postgis/qgis/`. GeoServer consumer: `stac/postgis/geoserver/`. The existing `postgres/source.mjs` remains a read-only seller source; database commissioning uses a separate explicitly selected write connection.

The database runtime uses the repository's existing `pg` dependency. PostgreSQL 15 or later is required for security-invoker views, with an installed PostGIS 3.x extension. The runtime reads the actual server, extension, database, schema, role and relation state before changing managed objects. The selected customer environment and connection profile are commissioning inputs. A version statement in this document is not a native run result.

The caller selects an existing database and existing schema. The connection profile identifier is a reference to the operator's credential/service configuration; credentials are never included in a receiving package. The producer does not create a customer database, extension or login role.

## Source and mapping

The input is an existing `starforge.vector-export.v1` package, opened using the original vector engine and its expected manifest SHA-256. It includes the original `source/capture.json`, source inspection, catalogue, original files and `native/source-features.ndjson`. The original source-feature record is:

```json
{
  "rowKey": "the original 64-character source identity hash",
  "layerId": "the original source layer identifier",
  "sourcePosition": 1,
  "identity": {"mode": "feature-id", "kind": "integer", "value": 9223372036854775807},
  "occurrence": 1,
  "feature": {"type": "Feature", "id": 9223372036854775807, "properties": {}, "geometry": null},
  "propertyKinds": {}
}
```

Read and write this boundary with `parseExactJSON` and `stringifyExactJSON` from the original `stac/vector/json.mjs`. Ordinary JavaScript number coercion or JSON round trips must not change unsafe integers, decimals or typed identities. Repeated source identities retain their original occurrence. Position-derived identities are visible in the source inspection and the edition comparison.

The operator's mapping is `starforge.postgis-intake-profile.v1`. It names the project, existing database/schema and connection-profile reference, one stable relation per original source layer, every original field and its explicit PostgreSQL target name/type, and the source/target SRIDs, geometry type and dimension. Mapping all fields of every selected original source layer is required; structured values may use JSONB or exact JSON text. Missing and explicit null values remain distinguishable in the retained original feature record.

Coordinate assignment and coordinate transformation are separate choices. A supplied source SRID must match the original CRS, or the mapping must explicitly record a reviewed assignment. Transformations use the native PostGIS `ST_Transform` on the original geometry and retain the source geometry. Changing a CRS label alone does not reproject coordinates. The target geometry column has an explicit type, SRID and dimension.

Roles are existing database roles. Each layer records the selected roles, allowed select/insert/update/delete operations and an optional equality scope over a mapped column. The producer installs role grants and row policies only on its managed relations, verifies that scoped roles do not bypass row security, and records actual role reads and privileges. An original read role is never silently converted into a write connection.

## Accepted database receipt

The stable manifest is `postgis-receiving.json`; its schema is `starforge.postgis-intake-receiving.v1`. Consumers must parse its schema and complete original file manifest. The following field names are the stable consumer interface; shown values are explanatory placeholders, not native results.

```json
{
  "schema": "starforge.postgis-intake-receiving.v1",
  "projectId": "agreed-project",
  "operationId": "the original accepted operation",
  "requestSha256": "sha256",
  "editionId": "accepted-edition-id",
  "revision": 2,
  "acceptedAt": "the accepted edition UTC timestamp",
  "observedAt": "the original native receiving observation UTC timestamp",
  "database": {
    "profileId": "the selected connection profile reference",
    "name": "the observed current_database()",
    "schema": "the agreed existing schema",
    "postgresVersion": "observed server_version",
    "postgisVersion": "observed postgis_full_version()",
    "metadataRelation": "_sf_intake_projects"
  },
  "source": {
    "manifest": {"path": "source/vector-export.json", "bytes": 123, "sha256": "sha256"},
    "captureSha256": "original capture hash",
    "selectionSha256": "original selection hash",
    "sourceEdition": "original source edition",
    "selectionId": "original selection identifier"
  },
  "mapping": {"path": "profile.json", "bytes": 123, "sha256": "sha256"},
  "layers": [
    {
      "id": "agreed-logical-layer",
      "sourceLayerId": "original-source-layer",
      "title": "Operator layer title",
      "schema": "the agreed existing schema",
      "relation": "stable_layer_view",
      "relationType": "view",
      "physicalRelation": "the accepted retained physical table",
      "viewDefinitionSha256": "SHA-256 of the actual pg_get_viewdef result",
      "observedColumns": [{"attname": "sf_id", "type": "bigint"}],
      "primaryKeyMetadata": null,
      "keyColumn": "sf_id",
      "sourceKeyColumn": "sf_key",
      "geometryColumn": "geom",
      "geometryType": "POINT",
      "dimension": 2,
      "srid": 4326,
      "fields": [
        {"sourceName": "original_name", "name": "target_name", "type": "text", "nullable": true}
      ],
      "rowCount": "observed decimal count",
      "rowSha256": "observed ordered logical row digest",
      "roles": [
        {"name": "existing_reader", "permissions": ["select"], "scope": null,
         "observedPrivileges": {"select": true, "insert": false, "update": false, "delete": false},
         "visibleRows": "observed decimal count",
         "visibleRowSha256": "ordered complete role-visible row digest"}
      ]
    }
  ],
  "files": [
    {"path": "source/vector-export.json", "bytes": 123, "sha256": "sha256"}
  ]
}
```

The accepted source package is under `source/` without rewriting its internal relative paths. `profile.json` is the complete frozen mapping. `files` lists every retained regular file except the enclosing `postgis-receiving.json` itself. File paths are relative, remain inside the package, and may not be symlinks. Counts and PostgreSQL bigint values use decimal text where they can exceed JavaScript's exact integer range.

Each stable relation is a simple, automatically updatable security-invoker view over a retained physical edition table. `sf_id` is the stable signed bigint feature key used by QGIS/GeoServer. `sf_key` binds the original typed source identity and occurrence. `geom` is the typed geometry. Source identity and provenance columns are not granted for arbitrary client updates. Inserted operator rows receive distinct operator identities and remain part of subsequent comparison and backup.

The database owns four metadata relations in the selected schema: `_sf_intake_projects`, `_sf_intake_editions`, `_sf_intake_operations`, and `_sf_intake_identities`. The last retains the original feature identity mapping; edition tables retain every original baseline and live customer row. The current project row exposes `project_id`, `revision`, and `active_edition_id`. Before publication or project refresh, the consumer reads this actual row and requires the receipt's project, edition and revision. It also checks the current database/schema and actual view, key, fields, geometry and access against the receipt. A stale receipt can still be opened for historical inspection; it cannot silently publish a newer or older database edition.

## Transactional lifecycle

`openPostgisIntake({connection, profile, directory, python})` returns the database controller. Its producer operations are `inspect()`, `operationHistory({limit, offset})`, `readRow({editionId, layerId, rowKey})`, `stage({operationId, sourceDirectory, expectedManifestSha256})`, `review({editionId})`, `promote({operationId, editionId, expectedRevision, reviewSha256, decisions})`, `rollback({operationId, editionId, expectedRevision})`, `exportReceiving({operationId, directory})`, `exportBackup({operationId, directory})`, `restoreBackup({operationId, directory, expectedManifestSha256})`, and `close()`. CLI commands expose these same operations. Optional diagnostic fields may be added without changing the consumer fields above.

Staging uses original operation/request identities and one transaction. A repeated identical request reconciles the saved result; reusing its ID for different source or mapping fails. Every original selected feature is loaded with parameterized SQL and explicit field conversion. The stage contains original source baseline plus target-native geometry and attributes.

Review compares the staged source against both the prior original baseline and the current live database, including operator inserts/deletes and changed geometry/attributes. Promotion is revision-checked and binds the exact reviewed live state. Conflicting rows need explicit `keep-current` or `take-source` decisions. Unchanged source retains live customer edits automatically. A missing successor row is an explicit removal in the review; it does not vanish outside the reviewed operation.

Promotion changes all selected layer views in one transaction. It preserves feature keys, retains prior physical editions and original source baselines, carries operator changes according to the reviewed decisions, applies the agreed role profiles, and increments the original project revision once. Unknown commit outcomes are reconciled through the same operation record rather than replayed as a new operation.

Rollback selects an existing retained edition at the current expected revision and switches only the managed layer views. It retains the edition being left, including its current operator edits, and records another original operation and revision. Changes to the stable view's column contract require an explicit mapping migration; `CREATE OR REPLACE VIEW` must not silently reorder or recast the existing column interface.

## QGIS consumer

Retain the existing QGIS workspace, project, styles, source history and receive/export workflow. Add accepted PostGIS layers through the native PostgreSQL provider using the selected service/auth reference, stable relation, `sf_id`, `geom`, SRID and geometry type. Reopen the resulting QGZ in an independent native QGIS instance and inspect actual feature IDs, fields, CRS and role behavior. Connection secrets stay in the local service/auth manager.

Source refresh consumes a new accepted receipt and retains the old project/source edition and operator styles. A failed or interrupted change resumes the original workspace operation. The portable operator package retains the complete original source and database receipt, its exact project definition and how to supply the target connection profile.

## GeoServer consumer

Retain the original workspace, datastore, feature type, style and applicable role configuration before mutating them. Match the chosen existing PostGIS store to the receipt's actual database/schema. Publish the stable accepted relations with explicit geometry/SRID and retained style/advertised layer settings. Re-read the server's actual saved configuration, capabilities and native features under the selected service/read roles.

Refresh checks the current accepted database revision and compares the previous publication snapshot. Selective rollback changes only the objects and fields owned by the original publication operation, preserving unrelated or later customer edits. Retain actual WFS/WMS/native feature receiving together with the database receipt and original configuration. A response receipt contains observed server versions and native results; it must not substitute an example result.

## Independent receiving and recovery

The receiving package is a complete original-source and operator handover, including the accepted database receipt and consumer results. A complete database backup additionally contains a transactionally locked snapshot of managed metadata, all retained edition tables, stable identities, source baselines, role profiles and all original source packages. Credentials and unrelated customer tables are excluded.

Restoration creates an independent selected destination, checks its existing schema/roles/version profile, restores the whole original project and retained editions, and performs a new native read before making the received project usable. Source refresh, operator edits, rollback and the independent restored instance are the meaningful end-to-end journey; generated example outputs are not acceptance results.

### Read an imported original operation without executing it

A restored project preserves every imported committed operation's unchanged original request, request SHA-256, result and commit time. Its current destination profile can differ from the profile captured by that original request. Recover the committed record through the current destination; do not replay the old profile-bound mutation to retrieve its result.

`await intake.recoverOperation({operationId})` is read-only and does not capture source, take a new snapshot, restore files, execute a database mutation or add a new operation. It returns:

```js
{
  schema: 'starforge.postgis-operation-recovery.v1',
  projectId,
  operationId,
  state: 'committed',
  executed: false,
  original: {
    operationId, kind, requestSha256, request, result, committedAt
  },
  current: {
    project,  // current original project and its destination profile
    database  // actual selected database environment
  },
  originalProfileSha256: null, // or the SHA-256 retained in the original request
  profileChanged: false,      // compares that recorded SHA with the current profile
  artifact: null              // or the verified original export status below
}
```

`current.project` includes `projectId`, `productVersion`, `revision`, `activeEditionId`, `profileSha256`, `profile`, `createdAt` and `updatedAt`. `current.database` is the observed environment: `profileId`, `name`, `schema`, `postgresVersion`, `postgisVersion`, `metadataRelation`, `owner` and `extensionSchema`. These current fields do not replace any original request/result values. A null `originalProfileSha256` means the action did not retain that field; it is not an inferred proof that the profiles match.

Only original `export-receiving` and `export-backup` operations have an artifact result:

```js
{
  kind: 'receiving',      // or 'backup'
  state: 'available',     // or 'unavailable'
  directory,             // the original committed output directory
  expectedManifest,      // unchanged manifestFile from the original result
  manifestFile,          // verified descriptor, or null
  issue: null            // or {code, message}
}
```

Available means the original manifest identity and complete package files passed their native verification. It does not assert that the historical database edition is current. The independent database reader remains responsible for the current-edition, role, definition and row checks.

An unavailable artifact leaves its original result and expected manifest intact. The readback identifies the missing or changed output. Restore the exact original files and recheck that same operation; the recovery method does not reconstruct an original snapshot from newer database state. Even if the original export command is invoked again, a committed export with missing or changed output fails as `POSTGIS_COMMITTED_EXPORT_UNAVAILABLE` with its original `operationId` and artifact `detail`. Its destination is not reclaimed and no replacement snapshot is created.

If the original operation has no committed record in the selected project, recovery throws `POSTGIS_ORIGINAL_OPERATION_NOT_COMMITTED`. This result does not execute the request. An operator can continue the retained uncommitted request on its original database, or explicitly commission separate work; changing an old request's profile or operation ID is not a recovery read.

The CLI exposes `recover-operation --connection PRIVATE_JSON --profile CURRENT_PROFILE_JSON --workspace DIRECTORY --operation ORIGINAL_ID`. A `--request` file containing only `operationId` is an alternative to `--operation`. The existing private operator exposes **Recover committed operation** in Operations and `POST /api/recover-operation` with `{request:{operationId}}`; it uses the currently configured installation even when displaying an imported request. The full original/current result can be saved from that view without an additional native action.



## Complete reader and operator API

`openReceiving(directory, expectedManifestSha256, {signal})` verifies the whole original source/file closure and returns `{directory, manifest, manifestFile, profile}`. The optional signal passes through the original file descriptor hashing and JSON reads. It does not alter an original manifest or record partial verification as complete.

`verifyReceiving({connection, directory, expectedManifestSha256, role, signal, requireUnchangedRows = true, layerIds})` additionally verifies the actual selected independent reader. `layerIds` is an optional nonempty unique subset of original receipt layers; omission selects all layers. Every selected role-visible row is read and hashed. The result adds `verified`, `current`, `selection.layerIds` and `observations`. The full original file closure is checked even when selecting fewer database layers.

The reader's `current_user` must be a recorded selected role. It verifies the actual current metadata revision, accepted physical relation, view definition, typed columns, exact observed permissions and complete visible row digest. `requireUnchangedRows:false` explicitly reports later live edits; a changed edition or changed view still fails.

If GeoServer key metadata is selected, `profile.database.primaryKeyMetadata` names its actual schema/table, `createIfMissing`, `exposePrimaryKeys:true` and policy `autogenerated` or `assigned`. Each layer's non-null `primaryKeyMetadata` includes the same schema/table/exposure and full `observedRows`: `table_schema`, `table_name`, `pk_column`, `pk_column_idx`, `pk_policy`, `pk_sequence`. A single-key index may be null. The database role and GeoServer service ACL identities remain separate.

An uncommitted interrupted receiving export resumes its original frozen `database-observation.json`. A committed export is recovered and verified through its saved output rather than recreated. `acceptedAt` is the edition's acceptance time; `observedAt` is the native export observation time. Completing those original files after a later project change does not make the historical edition current. Consumers make that native comparison when receiving.

The full [operator guide](OPERATOR.md) covers the neutral local interface, original-request recovery, source mapping, complete backup/restore, exact CLI requests, and the one retained [native customer journey](native-journey.mjs). The [QGIS guide](qgis/OPERATIONS.md) describes native project/style/history reuse and independent complete receiving.

## Optional GeoServer receiving in the original native journey

The same `native-journey.mjs` request may include `geoserver`. Supply the exact private `profileFile` and independent database `readerFile`, together with their observed `expectedProfileSha256` and `expectedReaderSha256`. Also retain `sourceHead` for the complete composed application. These are selected installed-service inputs; the example paths, styles, access roles and map bounds must be replaced with their actual operator choices.

The nested `request` is the original service operation: `{operationId, kind, expectedPublication, layers}`. Its `layers` select accepted original layer IDs with their explicit service names, titles, styles, access and map settings. `expectedPublication` remains the original compare-and-set value, including an explicit null for the appropriate first publication. Optional `cycle:{rollbackOperationId,refreshOperationId}` exercises those declared service transitions. Optional `browser:{playwrightModule,chromiumExecutable}` uses the equipped browser against the same service result.

The parent binds this child to its verified final **receive-current** directory and manifest; callers do not supply a second receipt or independently replace its edition. It derives one stable child operation ID and calls the maintained GeoServer receiving implementation with parent signal ownership. On continuation, the child retains the original service operation and the parent verifies its frozen saved result, complete receiving directories and export archives. A missing or changed original result remains a recovery issue. Completing the optional service cycle does not repeat a database stage or promotion, and the final parent result is saved only after owned services, database pools and child processes have drained.

See the [complete example](native-journey.example.json) for the exact input fields and the maintained [GeoServer receiving implementation](geoserver/native-receiving.mjs) for its existing service workflow.
