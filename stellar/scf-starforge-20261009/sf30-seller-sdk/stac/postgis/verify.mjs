import {createHash} from 'node:crypto';
import {openReceiving} from './files.mjs';
import {need, canonical, qi, relation, META, sha256} from './contract.mjs';

const TEXT_TYPES = {getTypeParser: () => value => value};
const abort = signal => { if (signal?.aborted) throw signal.reason || new Error('POSTGIS_RECEIVING_ABORTED'); };
export async function verifyReceiving({connection, directory, expectedManifestSha256, role, signal,
  requireUnchangedRows = true} = {}) {
  abort(signal);
  need(connection && typeof connection === 'object', 'POSTGIS_READER_CONNECTION_REQUIRED');
  const original = await openReceiving(directory, expectedManifestSha256);
  const receipt = original.manifest;
  const {Client} = await import('pg');
  const {default: Cursor} = await import('pg-cursor');
  const client = new Client({...connection, types: TEXT_TYPES, application_name: 'starforge-postgis-receiving'});
  const q = name => relation(receipt.database.schema, name);
  const checked = [];
  try {
    await client.connect();
    await client.query("SET TIME ZONE 'UTC'");
    await client.query("SET DateStyle='ISO, YMD'");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const server = (await client.query("SELECT current_database() AS name,current_user AS role,session_user AS session_role," +
      "current_setting('server_version') AS version,current_setting('transaction_read_only') AS read_only," +
      "n.nspname AS extension_schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='postgis'")).rows[0];
    need(server && server.read_only === 'on' && server.name === receipt.database.name, 'POSTGIS_RECEIVING_DATABASE_CHANGED');
    if (role) need(server.role === role, 'POSTGIS_RECEIVING_ROLE_CHANGED', {expected: role, observed: server.role});
    await client.query('SET LOCAL search_path TO pg_catalog,' + qi(server.extension_schema) + ',' + qi(receipt.database.schema));
    const postgis = (await client.query('SELECT postgis_full_version() AS version')).rows[0].version;
    const current = (await client.query('SELECT project_id,revision,active_edition_id FROM ' +
      q(META.projects) + ' WHERE project_id=$1', [receipt.projectId])).rows;
    need(current.length === 1 && current[0].revision === String(receipt.revision) &&
      current[0].active_edition_id === receipt.editionId, 'POSTGIS_RECEIVING_EDITION_CHANGED',
      {projectId: receipt.projectId, expectedEdition: receipt.editionId, expectedRevision: receipt.revision, observed: current});
    for (const layer of receipt.layers) {
      abort(signal);
      const selectedRole = layer.roles.find(item => item.name === server.role);
      need(selectedRole, 'POSTGIS_RECEIVING_SELECTED_ROLE_NOT_ACCEPTED', {layerId: layer.id, role: server.role});
      const view = (await client.query("SELECT relkind,reloptions::text,pg_get_viewdef(oid,true) AS definition " +
        'FROM pg_class WHERE oid=$1::regclass', [q(layer.relation)])).rows[0];
      need(view?.relkind === 'v' && view.reloptions?.includes('security_invoker=true'), 'POSTGIS_RECEIVING_VIEW_CHANGED', layer.id);
      need(typeof layer.viewDefinitionSha256 === 'string' && sha256(view.definition) === layer.viewDefinitionSha256,
        'POSTGIS_RECEIVING_VIEW_DEFINITION_CHANGED', layer.id);
      need(typeof layer.physicalRelation === 'string', 'POSTGIS_RECEIVING_PHYSICAL_EDITION_REQUIRED');
      const dependencies = (await client.query(
        "SELECT DISTINCT d.refobjid::regclass::text AS relation FROM pg_rewrite r JOIN pg_depend d ON d.objid=r.oid " +
        "JOIN pg_class c ON c.oid=d.refobjid WHERE r.ev_class=$1::regclass AND d.refclassid='pg_class'::regclass " +
        "AND c.relkind IN ('r','p','f')", [q(layer.relation)])).rows;
      const physical = (await client.query('SELECT $1::regclass::text AS relation', [q(layer.physicalRelation)])).rows[0].relation;
      need(dependencies.length === 1 && dependencies[0].relation === physical,
        'POSTGIS_RECEIVING_PHYSICAL_EDITION_CHANGED', layer.id);
      const columns = (await client.query(
        'SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type FROM pg_attribute a ' +
        'WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum', [q(layer.relation)])).rows;
      need(canonical(columns) === canonical(layer.observedColumns), 'POSTGIS_RECEIVING_COLUMNS_CHANGED', layer.id);
      const privileges = {};
      for (const permission of ['select', 'insert', 'update', 'delete']) {
        const fn = permission === 'insert' || permission === 'update' ? 'has_any_column_privilege' : 'has_table_privilege';
        privileges[permission] = (await client.query('SELECT ' + fn + '(current_user,$1,$2) AS permitted',
          [q(layer.relation), permission.toUpperCase()])).rows[0].permitted === 't';
        need(privileges[permission] === selectedRole.permissions.includes(permission),
          'POSTGIS_RECEIVING_PRIVILEGES_CHANGED', {layerId: layer.id, permission, observed: privileges[permission]});
      }
      const hashed = createHash('sha256'); let count = 0n;
      const rowHash = "encode(sha256(convert_to((to_jsonb(t)-ARRAY['sf_id','sf_key','_sf_source','geom'])::text || '|' || " +
        "COALESCE(encode(ST_AsEWKB(t.geom),'hex'),'null'),'UTF8')),'hex')";
      const cursor = client.query(new Cursor('SELECT sf_id::text,sf_key,' + rowHash +
        ' AS row_hash FROM ' + q(layer.relation) + ' t ORDER BY sf_key COLLATE "C"', [], {types: TEXT_TYPES}));
      try {
        for (;;) {
          abort(signal);
          const rows = await new Promise((resolveRows, reject) => cursor.read(256, (error, rows) => error ? reject(error) : resolveRows(rows)));
          if (!rows.length) break;
          for (const row of rows) { hashed.update(canonical(row) + '\n'); count++; }
        }
      } finally { await new Promise((resolveClose, reject) => cursor.close(error => error ? reject(error) : resolveClose())); }
      const observation = {layerId: layer.id, role: server.role, rowCount: count.toString(),
        rowSha256: hashed.digest('hex'), observedColumns: columns, observedPrivileges: privileges,
        viewDefinitionSha256: sha256(view.definition)};
      observation.matchesAcceptedRows = observation.rowCount === selectedRole.visibleRows &&
        observation.rowSha256 === selectedRole.visibleRowSha256;
      if (requireUnchangedRows) need(observation.matchesAcceptedRows, 'POSTGIS_RECEIVING_LIVE_ROWS_CHANGED', observation);
      if (layer.primaryKeyMetadata) {
        const metadata = layer.primaryKeyMetadata;
        const rows = (await client.query('SELECT table_schema,table_name,pk_column,pk_column_idx::text,pk_policy,pk_sequence FROM ' +
          relation(metadata.schema, metadata.table) + ' WHERE table_schema=$1 AND table_name=$2 ORDER BY pk_column',
          [layer.schema, layer.relation])).rows;
        need(canonical(rows) === canonical(metadata.observedRows), 'POSTGIS_RECEIVING_GEOTOOLS_KEY_CHANGED', layer.id);
        observation.primaryKeyMetadata = {schema: metadata.schema, table: metadata.table, observedRows: rows};
      }
      checked.push(observation);
    }
    abort(signal);
    await client.query('COMMIT');
    return {...original, verified: true,
      current: {projectId: receipt.projectId, editionId: current[0].active_edition_id, revision: receipt.revision,
        database: server.name, postgresVersion: server.version, postgisVersion: postgis,
        role: server.role, sessionRole: server.session_role, readOnly: true},
      observations: {layers: checked, allAcceptedRowsMatch: checked.every(layer => layer.matchesAcceptedRows)}};
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { await client.end().catch(() => {}); }
}
