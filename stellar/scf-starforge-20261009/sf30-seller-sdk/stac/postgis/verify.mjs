import {createHash} from 'node:crypto';
import {openReceiving} from './files.mjs';
import {need, canonical, qi, relation, META, sha256} from './contract.mjs';

const TEXT_TYPES = {getTypeParser: () => value => value};
const abort = signal => { if (signal?.aborted) throw signal.reason || new Error('POSTGIS_RECEIVING_ABORTED'); };
export async function verifyReceiving({connection, directory, expectedManifestSha256, role, signal,
  requireUnchangedRows = true, layerIds} = {}) {
  abort(signal);
  need(connection && typeof connection === 'object', 'POSTGIS_READER_CONNECTION_REQUIRED');
  const original = await openReceiving(directory, expectedManifestSha256, {signal});
  const receipt = original.manifest;
  const selectedLayers = layerIds === undefined ? receipt.layers : (() => {
    need(Array.isArray(layerIds) && layerIds.length > 0 && new Set(layerIds).size === layerIds.length &&
      layerIds.every(id => receipt.layers.some(layer => layer.id === id)), 'POSTGIS_RECEIVING_SELECTED_LAYERS_REQUIRED');
    return receipt.layers.filter(layer => layerIds.includes(layer.id));
  })();
  const {Client} = await import('pg');
  const {default: Cursor} = await import('pg-cursor');
  const client = new Client({...connection, types: TEXT_TYPES, pipeline: false, application_name: 'starforge-postgis-receiving'});
  const q = name => relation(receipt.database.schema, name);
  const checked = [];
  let ending, ended = false, primaryError, cleanupError, connectionError;
  client.once('end', () => { ended = true; });
  client.on('error', error => { connectionError ||= error; });
  const closeClient = () => {
    if (!ending) {
      ending = Promise.resolve().then(() => client.end());
      ending.catch(error => { cleanupError ||= error; });
    }
    return ending;
  };
  const cancellation = () => { void closeClient(); };
  signal?.addEventListener('abort', cancellation, {once: true});
  const nativeCallback = invoke => new Promise((resolveNative, rejectNative) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; client.removeListener('end', onEnd);
      if (error) rejectNative(error); else resolveNative(value);
    };
    const onEnd = () => finish(connectionError || signal?.reason || new Error('POSTGIS_RECEIVING_CONNECTION_ENDED'));
    if (ended) { onEnd(); return; }
    client.once('end', onEnd);
    try { invoke(finish); } catch (error) { finish(error); }
  });
  try {
    abort(signal);
    // pg's public connect callback can remain pending when end() closes an
    // in-progress connection. Its actual native end event is the other terminal
    // observation for this same owned client, without an abandoned race.
    await nativeCallback(callback => client.connect(callback));
    abort(signal);
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
    for (const layer of selectedLayers) {
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
          const rows = await nativeCallback(callback => cursor.read(256, callback));
          if (!rows.length) break;
          for (const row of rows) { hashed.update(canonical(row) + '\n'); count++; }
        }
      } catch (error) {
        primaryError ||= error; throw error;
      } finally {
        try {
          if (ending || ended) await closeClient();
          else await nativeCallback(callback => cursor.close(callback));
        } catch (error) {
          if (!primaryError) throw error;
          cleanupError ||= error;
        }
      }
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
      selection: {layerIds: selectedLayers.map(layer => layer.id)},
      observations: {layers: checked, allAcceptedRowsMatch: checked.every(layer => layer.matchesAcceptedRows)}};
  } catch (error) {
    primaryError ||= error;
    if (!ending && !ended) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { cleanupError ||= rollbackError; }
    }
    throw primaryError;
  } finally {
    signal?.removeEventListener('abort', cancellation);
    try { await closeClient(); } catch (error) { cleanupError ||= error; }
    if (primaryError && signal?.aborted && Object.isExtensible(primaryError))
      primaryError.postgisCancellationReason = signal.reason;
    if (primaryError && cleanupError) {
      if (Object.isExtensible(primaryError)) primaryError.postgisCleanupError = cleanupError;
      else {
        const joined = new AggregateError([primaryError, cleanupError], 'The original native read and its cleanup both failed.', {cause: primaryError});
        joined.code = primaryError?.code || 'POSTGIS_RECEIVING_CLEANUP_FAILED';
        throw joined;
      }
    }
    if (!primaryError && (cleanupError || connectionError)) throw cleanupError || connectionError;
  }
}
