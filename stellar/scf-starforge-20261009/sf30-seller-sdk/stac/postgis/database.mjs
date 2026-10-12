import {createHash} from 'node:crypto';
import {META, need, canonical, digest, parseExactJSON, qi, ql, relation, geometryType, viewContract, physicalName} from './contract.mjs';

const TEXT_TYPES = {getTypeParser: () => value => value};
const PRIVILEGES = ['select', 'insert', 'update', 'delete'];
export async function createDatabase(connection, profile) {
  const {Pool} = await import('pg');
  need(connection && typeof connection === 'object', 'POSTGIS_WRITE_CONNECTION_REQUIRED');
  const pool = new Pool({...connection, types: TEXT_TYPES, pipeline: false, max: 3, application_name: 'starforge-postgis-intake'});
  pool.on('error', () => {});
  let first, environment, extensionSchema, owner, closing;
  const close = () => closing ||= pool.end();
  try {
    first = await pool.connect();
    const observed = (await first.query(
      "SELECT current_database() AS name, current_user AS owner, current_setting('server_version') AS version, " +
      "current_setting('server_version_num') AS version_number, n.nspname AS extension_schema, e.extversion AS extension_version " +
      "FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='postgis'")).rows;
    need(observed.length === 1, 'POSTGIS_INSTALLED_EXTENSION_REQUIRED');
    const row = observed[0];
    need(row.name === profile.database.name, 'POSTGIS_SELECTED_DATABASE_CHANGED');
    need(Number(row.version_number) >= 150000 && /^3\./.test(row.extension_version), 'POSTGIS_SUPPORTED_NATIVE_VERSION_REQUIRED');
    extensionSchema = row.extension_schema; owner = row.owner;
    const schema = (await first.query('SELECT oid FROM pg_namespace WHERE nspname=$1', [profile.database.schema])).rows;
    need(schema.length === 1, 'POSTGIS_EXISTING_SCHEMA_REQUIRED', profile.database.schema);
    await setup(first);
    const native = (await first.query('SELECT postgis_full_version() AS version')).rows[0];
    environment = {profileId: profile.database.profileId, name: row.name, schema: profile.database.schema,
      postgresVersion: row.version, postgisVersion: native.version, metadataRelation: META.projects,
      owner, extensionSchema};
  } catch (error) {
    if (first) first.release();
    try { await close(); } catch (cleanupError) { if (Object.isExtensible(error)) error.postgisCleanupError = cleanupError; }
    throw error;
  }
  first.release();
  function q(name) { return relation(profile.database.schema, name); }
  async function setup(client) {
    await client.query("SET standard_conforming_strings=on");
    await client.query("SET TIME ZONE 'UTC'");
    await client.query("SET DateStyle='ISO, YMD'");
    await client.query('SET search_path TO pg_catalog,' + qi(extensionSchema) + ',' + qi(profile.database.schema));
  }
  async function transaction(fn, {readOnly = false, lock = true, repeatable = false} = {}) {
    const client = await pool.connect();
    let committed = false, commitStarted = false;
    try {
      await setup(client);
      await client.query('BEGIN ISOLATION LEVEL ' + (repeatable ? 'REPEATABLE READ' : 'READ COMMITTED') +
        (readOnly ? ' READ ONLY' : ''));
      if (lock) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        ['starforge.postgis:' + profile.database.schema + ':' + profile.projectId]);
      const result = await fn(client);
      commitStarted = true; await client.query('COMMIT'); committed = true;
      return result;
    } catch (error) {
      if (!committed) await client.query('ROLLBACK').catch(() => {});
      if (commitStarted && !committed) error.postgisCommitOutcome = 'reconcile-original-operation';
      throw error;
    } finally { client.release(); }
  }
  async function initialized(client) {
    return (await client.query('SELECT to_regclass($1) AS relation', [q(META.projects)])).rows[0].relation !== null;
  }
  async function ensure(client) {
    const rights = (await client.query("SELECT has_schema_privilege(current_user,$1,'USAGE') AS usage, " +
      "has_schema_privilege(current_user,$1,'CREATE') AS can_create", [profile.database.schema])).rows[0];
    need(rights.usage === 't' && rights.can_create === 't', 'POSTGIS_SCHEMA_COMMISSIONING_PERMISSION_REQUIRED');
    if (!await initialized(client)) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['starforge.postgis-bootstrap:' + profile.database.schema]);
      await client.query('CREATE TABLE IF NOT EXISTS ' + q(META.projects) + ' (' +
        'project_id text PRIMARY KEY, product_version integer NOT NULL DEFAULT 1, ' +
        'profile_sha256 text NOT NULL, profile_json jsonb NOT NULL, revision bigint NOT NULL DEFAULT 0, ' +
        'active_edition_id text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), ' +
        'updated_at timestamptz NOT NULL DEFAULT clock_timestamp())');
      await client.query('CREATE TABLE IF NOT EXISTS ' + q(META.editions) + ' (' +
        'project_id text NOT NULL REFERENCES ' + q(META.projects) + '(project_id), edition_id text NOT NULL, ' +
        'request_sha256 text NOT NULL, source_json jsonb NOT NULL, profile_json jsonb NOT NULL, layers_json jsonb NOT NULL, ' +
        "state text NOT NULL CHECK (state IN ('staged','accepted')), " +
        'created_at timestamptz NOT NULL DEFAULT clock_timestamp(), accepted_at timestamptz, ' +
        'PRIMARY KEY(project_id,edition_id))');
      await client.query('CREATE TABLE IF NOT EXISTS ' + q(META.operations) + ' (' +
        'project_id text NOT NULL REFERENCES ' + q(META.projects) + '(project_id), operation_id text NOT NULL, ' +
        'kind text NOT NULL, request_sha256 text NOT NULL, request_json jsonb NOT NULL, result_json jsonb NOT NULL, ' +
        'committed_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(project_id,operation_id))');
      await client.query('CREATE TABLE IF NOT EXISTS ' + q(META.identities) + ' (' +
        'project_id text NOT NULL REFERENCES ' + q(META.projects) + '(project_id), layer_id text NOT NULL, row_key text NOT NULL, ' +
        'sf_id bigint GENERATED ALWAYS AS IDENTITY, PRIMARY KEY(project_id,layer_id,row_key), UNIQUE(project_id,layer_id,sf_id))');
      for (const table of Object.values(META)) await client.query('REVOKE ALL ON TABLE ' + q(table) + ' FROM PUBLIC');
    }
    let current = await project(client);
    if (!current) {
      // Existing customer relations are not adopted as this project's views.
      for (const layer of profile.layers) {
        const existing = (await client.query('SELECT to_regclass($1) AS relation', [q(layer.relation)])).rows[0].relation;
        need(existing === null, 'POSTGIS_EXISTING_CUSTOMER_RELATION_CONFLICT', layer.relation);
      }
      await client.query('INSERT INTO ' + q(META.projects) + '(project_id,profile_sha256,profile_json) VALUES($1,$2,$3::jsonb)',
        [profile.projectId, digest(profile), canonical(profile)]);
      current = await project(client);
    }
    need(current.productVersion === 1, 'POSTGIS_METADATA_VERSION_CHANGED');
    need(canonical(current.profile.database) === canonical(profile.database), 'POSTGIS_EXPLICIT_DATABASE_PROFILE_MIGRATION_REQUIRED');
    need(canonical(viewContract(current.profile)) === canonical(viewContract(profile)),
      'POSTGIS_EXPLICIT_COLUMN_CONTRACT_MIGRATION_REQUIRED');
    await checkRoles(client, profile);
    return current;
  }
  async function project(client, {forUpdate = false} = {}) {
    if (!await initialized(client)) return null;
    const row = (await client.query('SELECT * FROM ' + q(META.projects) + ' WHERE project_id=$1' +
      (forUpdate ? ' FOR UPDATE' : ''), [profile.projectId])).rows[0];
    if (!row) return null;
    const revision = Number(row.revision);
    need(Number.isSafeInteger(revision), 'POSTGIS_REVISION_EXACT_RANGE_EXCEEDED');
    return {projectId: row.project_id, productVersion: Number(row.product_version), revision,
      activeEditionId: row.active_edition_id, profileSha256: row.profile_sha256,
      profile: parseExactJSON(row.profile_json), createdAt: row.created_at, updatedAt: row.updated_at};
  }
  async function edition(client, editionId) {
    const row = (await client.query('SELECT * FROM ' + q(META.editions) + ' WHERE project_id=$1 AND edition_id=$2',
      [profile.projectId, editionId])).rows[0];
    need(row, 'POSTGIS_EDITION_NOT_FOUND', editionId);
    return {editionId: row.edition_id, requestSha256: row.request_sha256,
      source: parseExactJSON(row.source_json), profile: parseExactJSON(row.profile_json),
      layers: parseExactJSON(row.layers_json), state: row.state, createdAt: row.created_at, acceptedAt: row.accepted_at};
  }
  async function committedOperation(client, operationId) {
    if (!await initialized(client)) return null;
    const row = (await client.query('SELECT operation_id,kind,request_sha256,request_json::text,result_json::text,' +
      'committed_at::text FROM ' + q(META.operations) + ' WHERE project_id=$1 AND operation_id=$2',
      [profile.projectId, operationId])).rows[0];
    if (!row) return null;
    const request = parseExactJSON(row.request_json), result = parseExactJSON(row.result_json);
    need(request && typeof request === 'object' && !Array.isArray(request) &&
      result && typeof result === 'object' && !Array.isArray(result) &&
      request.projectId === profile.projectId && request.operationId === row.operation_id &&
      digest(request) === row.request_sha256 && result.operationId === row.operation_id &&
      result.requestSha256 === row.request_sha256 &&
      (result.projectId === undefined || result.projectId === profile.projectId) &&
      typeof row.kind === 'string' && row.kind.length > 0,
      'POSTGIS_COMMITTED_OPERATION_RECORD_CHANGED', operationId);
    return {operationId: row.operation_id, kind: row.kind, requestSha256: row.request_sha256,
      request, result, committedAt: row.committed_at};
  }
  async function savedOperation(client, operationId, requestSha256) {
    const original = await committedOperation(client, operationId);
    if (!original) return null;
    need(original.requestSha256 === requestSha256, 'POSTGIS_ORIGINAL_OPERATION_REQUEST_CONFLICT', operationId);
    return original.result;
  }
  async function mutate(operationId, kind, request, fn) {
    const requestSha256 = digest(request);
    try {
      return await transaction(async client => {
        await ensure(client);
        const saved = await savedOperation(client, operationId, requestSha256);
        if (saved) return {...saved, replayed: true, current: await project(client)};
        const current = await project(client, {forUpdate: true});
        const result = await fn(client, current, requestSha256);
        const body = {...result, operationId, requestSha256, replayed: false};
        await client.query('INSERT INTO ' + q(META.operations) +
          '(project_id,operation_id,kind,request_sha256,request_json,result_json) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
          [profile.projectId, operationId, kind, requestSha256, canonical(request), canonical(body)]);
        return body;
      });
    } catch (error) {
      if (error.postgisCommitOutcome) {
        // The same project lock waits for the original transaction to finish.
        try {
          const reconciled = await transaction(async client => {
            const saved = await savedOperation(client, operationId, requestSha256);
            return saved ? {...saved, replayed: true, reconciled: true, current: await project(client)} : null;
          });
          if (reconciled) return reconciled;
        } catch {}
        error.operationId = operationId;
      }
      throw error;
    }
  }
  async function checkRoles(client, selectedProfile) {
    const names = [...new Set(selectedProfile.layers.flatMap(layer => layer.roles.map(role => role.name)))];
    const rows = (await client.query(
      'SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[])', [names])).rows;
    const byName = new Map(rows.map(row => [row.rolname, row]));
    for (const layer of selectedProfile.layers) for (const role of layer.roles) {
      const row = byName.get(role.name);
      need(row, 'POSTGIS_EXISTING_ROLE_NOT_FOUND', role.name);
      need(role.name !== owner && row.rolsuper !== 't' && row.rolbypassrls !== 't',
        'POSTGIS_RECEIVING_ROLE_MUST_OBSERVE_ROW_SECURITY', role.name);
      const canSet = (await client.query('SELECT pg_has_role(current_user,$1,\'USAGE\') AS permitted, ' +
        '(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser', [role.name])).rows[0];
      need(canSet.permitted === 't' || canSet.superuser === 't', 'POSTGIS_ROLE_OBSERVATION_MEMBERSHIP_REQUIRED', role.name);
    }
  }
  async function sridDefinitions(client, selectedProfile) {
    const ids = [...new Set(selectedProfile.layers.flatMap(layer => [layer.geometry.sourceSrid, layer.geometry.targetSrid]))];
    const rows = (await client.query('SELECT srid,srtext FROM spatial_ref_sys WHERE srid=ANY($1::integer[])', [ids])).rows;
    const result = new Map(rows.map(row => [Number(row.srid), row.srtext]));
    need(result.size === ids.length && [...result.values()].every(Boolean), 'POSTGIS_REGISTERED_SRID_REQUIRED');
    return result;
  }
  const operatorSequence = layerId => physicalName(profile.projectId, 'operator', layerId, 'seq');
  async function createFeatureTable(client, table, layer) {
    await client.query('CREATE SEQUENCE IF NOT EXISTS ' + q(operatorSequence(layer.id)) + ' AS bigint');
    await client.query('REVOKE ALL ON SEQUENCE ' + q(operatorSequence(layer.id)) + ' FROM PUBLIC');
    const fields = layer.fields.map(field => qi(field.name) + ' ' + field.type + (field.nullable ? '' : ' NOT NULL'));
    const columns = [
      'sf_id bigint PRIMARY KEY DEFAULT (-nextval(' + ql(q(operatorSequence(layer.id))) + '::regclass))',
      "sf_key text NOT NULL UNIQUE DEFAULT ('operator:' || gen_random_uuid()::text)",
      '_sf_source jsonb',
      ...fields,
      'geom geometry(' + geometryType(layer) + ',' + layer.geometry.targetSrid + ')'
    ];
    await client.query('CREATE TABLE ' + q(table) + ' (' + columns.join(',') + ')');
    await client.query('REVOKE ALL ON TABLE ' + q(table) + ' FROM PUBLIC');
    await client.query('CREATE INDEX ON ' + q(table) + ' USING gist(geom)');
  }
  async function lockTables(client, tables) {
    for (const table of [...new Set(tables)].sort()) await client.query('LOCK TABLE ' + q(table) + ' IN SHARE ROW EXCLUSIVE MODE');
  }
  const userColumns = layer => ['sf_id', 'sf_key', ...layer.fields.map(field => field.name), 'geom'];
  const allColumns = layer => ['sf_id', 'sf_key', '_sf_source', ...layer.fields.map(field => field.name), 'geom'];
  function rowHashSQL(alias = 't') {
    return "encode(sha256(convert_to((to_jsonb(" + alias + ")-ARRAY['sf_id','sf_key','_sf_source','geom'])::text || '|' || " +
      "COALESCE(encode(ST_AsEWKB(" + alias + ".geom),'hex'),'null'),'UTF8')),'hex')";
  }
  async function copyFeatureRows(client, source, destination, layer, keys = null) {
    const columns = allColumns(layer).map(qi).join(',');
    await client.query('INSERT INTO ' + q(destination) + '(' + columns + ') SELECT ' + columns + ' FROM ' + q(source) +
      (keys ? ' WHERE sf_key=ANY($1::text[])' : ''), keys ? [keys] : []);
  }
  async function installRoles(client, table, layer) {
    await client.query('ALTER TABLE ' + q(table) + ' ENABLE ROW LEVEL SECURITY');
    for (const role of layer.roles) {
      const condition = role.scope ? qi(role.scope.column) + '::text = ANY(ARRAY[' +
        role.scope.values.map(ql).join(',') + ']::text[])' : 'true';
      for (const permission of role.permissions) {
        const policy = '_sf_' + digest({role: role.name, permission}).slice(0, 32);
        await client.query('CREATE POLICY ' + qi(policy) + ' ON ' + q(table) + ' FOR ' + permission.toUpperCase() +
          ' TO ' + qi(role.name) +
          (permission === 'insert' ? ' WITH CHECK (' + condition + ')' :
            permission === 'update' ? ' USING (' + condition + ') WITH CHECK (' + condition + ')' : ' USING (' + condition + ')'));
      }
      await grantLayer(client, table, layer, role);
    }
  }
  async function grantLayer(client, target, layer, role) {
    for (const permission of role.permissions) {
      const columns = layer.fields.map(field => field.name).concat('geom').map(qi).join(',');
      await client.query('GRANT ' + permission.toUpperCase() +
        (permission === 'insert' || permission === 'update' ? '(' + columns + ')' : '') +
        ' ON TABLE ' + q(target) + ' TO ' + qi(role.name));
      if (permission === 'insert') await client.query('GRANT USAGE ON SEQUENCE ' + q(operatorSequence(layer.id)) + ' TO ' + qi(role.name));
    }
  }
  async function projectRoleAccess(client, selectedProfile, previousProfile = null) {
    await client.query('ALTER TABLE ' + q(META.projects) + ' ENABLE ROW LEVEL SECURITY');
    const names = [...new Set([...(previousProfile?.layers || []), ...selectedProfile.layers]
      .flatMap(layer => layer.roles.map(role => role.name)))];
    const currentNames = new Set(selectedProfile.layers.flatMap(layer => layer.roles.map(role => role.name)));
    for (const name of names) {
      const policy = '_sf_project_' + digest({project: profile.projectId, role: name}).slice(0, 32);
      await client.query('DROP POLICY IF EXISTS ' + qi(policy) + ' ON ' + q(META.projects));
      if (currentNames.has(name)) {
        await client.query('CREATE POLICY ' + qi(policy) + ' ON ' + q(META.projects) +
          ' FOR SELECT TO ' + qi(name) + ' USING (project_id=' + ql(profile.projectId) + ')');
        await client.query('GRANT USAGE ON SCHEMA ' + qi(profile.database.schema) + ' TO ' + qi(name));
        await client.query('GRANT SELECT(project_id,revision,active_edition_id) ON TABLE ' +
          q(META.projects) + ' TO ' + qi(name));
      }
    }
  }
  async function revokeLayer(client, table, layer, role) {
    await client.query('REVOKE ALL ON TABLE ' + q(table) + ' FROM ' + qi(role));
    for (const permission of ['INSERT', 'UPDATE', 'SELECT', 'REFERENCES'])
      await client.query('REVOKE ' + permission + '(' + userColumns(layer).map(qi).join(',') +
        ') ON TABLE ' + q(table) + ' FROM ' + qi(role));
  }
  async function primaryKeyMappings(client, selectedProfile, {install = false} = {}) {
    const configured = selectedProfile.database.primaryKeyMetadata;
    if (!configured) return new Map();
    const target = relation(configured.schema, configured.table);
    let exists = (await client.query('SELECT to_regclass($1) AS relation', [target])).rows[0].relation;
    if (!exists && install && configured.createIfMissing) {
      await client.query('CREATE TABLE ' + target + ' (table_schema varchar(63) NOT NULL, table_name varchar(63) NOT NULL,' +
        'pk_column varchar(63) NOT NULL,pk_column_idx integer,pk_policy varchar(32),pk_sequence varchar(128),' +
        "UNIQUE(table_schema,table_name,pk_column),CHECK(pk_policy IN ('sequence','assigned','autogenerated')))");
      await client.query('REVOKE ALL ON TABLE ' + target + ' FROM PUBLIC');
      exists = target;
    }
    need(exists, 'POSTGIS_SELECTED_GEOTOOLS_METADATA_TABLE_REQUIRED', target);
    const result = new Map();
    for (const layer of selectedProfile.layers) {
      const expected = [{table_schema: selectedProfile.database.schema, table_name: layer.relation,
        pk_column: 'sf_id', pk_column_idx: null, pk_policy: configured.policy, pk_sequence: null}];
      const read = async () => (await client.query(
        'SELECT table_schema,table_name,pk_column,pk_column_idx::text,pk_policy,pk_sequence FROM ' + target +
        ' WHERE table_schema=$1 AND table_name=$2 ORDER BY pk_column',
        [selectedProfile.database.schema, layer.relation])).rows;
      let rows = await read();
      if (!rows.length && install) {
        await client.query('INSERT INTO ' + target +
          '(table_schema,table_name,pk_column,pk_column_idx,pk_policy,pk_sequence) VALUES($1,$2,\'sf_id\',NULL,$3,NULL)',
          [selectedProfile.database.schema, layer.relation, configured.policy]);
        rows = await read();
      }
      need(canonical(rows) === canonical(expected), 'POSTGIS_EXISTING_GEOTOOLS_KEY_MAPPING_CONFLICT',
        {layerId: layer.id, expected, observed: rows});
      if (install) for (const role of layer.roles)
        await client.query('GRANT SELECT(table_schema,table_name,pk_column,pk_column_idx,pk_policy,pk_sequence) ON TABLE ' +
          target + ' TO ' + qi(role.name));
      result.set(layer.id, {schema: configured.schema, table: configured.table,
        exposePrimaryKeys: true, observedRows: rows});
    }
    return result;
  }
  async function switchViews(client, selected, previous, selectedProfile) {
    await projectRoleAccess(client, selectedProfile, previous?.profile);
    await primaryKeyMappings(client, selectedProfile, {install: true});
    for (const layer of selectedProfile.layers) {
      const physical = selected.layers.find(item => item.id === layer.id);
      need(physical?.liveTable, 'POSTGIS_LIVE_EDITION_REQUIRED', layer.id);
      const oldRoles = previous?.profile.layers.find(item => item.id === layer.id)?.roles || [];
      const allRoles = [...new Set([...oldRoles, ...layer.roles].map(role => role.name))];
      await client.query('CREATE OR REPLACE VIEW ' + q(layer.relation) + ' WITH (security_invoker=true) AS SELECT ' +
        userColumns(layer).map(qi).join(',') + ' FROM ' + q(physical.liveTable));
      await client.query('REVOKE ALL ON TABLE ' + q(layer.relation) + ' FROM PUBLIC');
      for (const name of allRoles) await revokeLayer(client, layer.relation, layer, name);
      for (const role of layer.roles) await grantLayer(client, layer.relation, layer, role);
      if (previous && previous.editionId !== selected.editionId) {
        const old = previous.layers.find(item => item.id === layer.id);
        if (old?.liveTable) for (const role of oldRoles)
          await revokeLayer(client, old.liveTable, layer, role.name);
      }
    }
  }
  async function observeRoles(client, selected, layer) {
    const result = [];
    for (const role of layer.roles) {
      const privileges = {};
      for (const privilege of PRIVILEGES) {
        const fn = privilege === 'insert' || privilege === 'update' ? 'has_any_column_privilege' : 'has_table_privilege';
        privileges[privilege] = (await client.query('SELECT ' + fn + '($1,$2,$3) AS permitted',
          [role.name, q(layer.relation), privilege.toUpperCase()])).rows[0].permitted === 't';
        need(privileges[privilege] === role.permissions.includes(privilege),
          'POSTGIS_ROLE_PRIVILEGE_PROFILE_CONFLICT', {role: role.name, privilege, observed: privileges[privilege]});
      }
      const condition = role.scope ? qi(role.scope.column) + '::text = ANY(ARRAY[' +
        role.scope.values.map(ql).join(',') + ']::text[])' : null;
      const expected = await tableDigest(client, layer.relation, condition);
      let visible;
      try {
        await client.query('SET LOCAL ROLE ' + qi(role.name));
        const binding = (await client.query('SELECT project_id,revision,active_edition_id FROM ' +
          q(META.projects) + ' WHERE project_id=$1', [profile.projectId])).rows;
        need(binding.length === 1 && binding[0].active_edition_id === selected.editionId,
          'POSTGIS_ROLE_CURRENT_EDITION_NOT_VISIBLE', role.name);
        visible = await tableDigest(client, layer.relation);
      } finally { await client.query('SET LOCAL ROLE NONE'); }
      need(visible.rowCount === expected.rowCount && visible.rowSha256 === expected.rowSha256,
        'POSTGIS_NATIVE_ROW_SCOPE_CHANGED', role.name);
      result.push({...role, observedPrivileges: privileges,
        visibleRows: visible.rowCount, visibleRowSha256: visible.rowSha256});
    }
    return result;
  }
  async function* cursorRows(client, statement, parameters = []) {
    const {default: Cursor} = await import('pg-cursor');
    let cursor, ended = false, connectionError, primaryError;
    const onEnd = () => { ended = true; };
    const onError = error => { connectionError ||= error; };
    client.on('end', onEnd); client.on('error', onError);
    const nativeCallback = invoke => new Promise((resolveNative, rejectNative) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true; client.removeListener('end', terminalEnd); client.removeListener('error', terminalError);
        if (error) rejectNative(error); else resolveNative(value);
      };
      const terminalEnd = () => finish(connectionError || new Error('POSTGIS_CURSOR_CONNECTION_ENDED'));
      const terminalError = error => finish(error);
      if (ended || connectionError) { finish(connectionError || new Error('POSTGIS_CURSOR_CONNECTION_ENDED')); return; }
      client.once('end', terminalEnd); client.once('error', terminalError);
      try { invoke(finish); } catch (error) { finish(error); }
    });
    try {
      cursor = client.query(new Cursor(statement, parameters, {types: TEXT_TYPES}));
      for (;;) {
        const rows = await nativeCallback(callback => cursor.read(256, callback));
        if (!rows.length) break;
        for (const row of rows) yield row;
      }
    } catch (error) {
      primaryError = error; throw error;
    } finally {
      try {
        // pg-cursor.close waits for readyForQuery; a ended connection cannot
        // produce it. The same client's native terminal event settles reads.
        if (cursor && !ended && !connectionError) await nativeCallback(callback => cursor.close(callback));
      } catch (error) {
        if (!primaryError) throw error;
        if (Object.isExtensible(primaryError)) primaryError.cleanupError = error;
      } finally {
        client.removeListener('end', onEnd); client.removeListener('error', onError);
      }
    }
  }
  async function tableDigest(client, table, condition = null) {
    const hash = createHash('sha256'); let count = 0n;
    for await (const row of cursorRows(client, 'SELECT sf_id::text,sf_key,' + rowHashSQL('t') +
      ' AS row_hash FROM ' + q(table) + ' t' + (condition ? ' WHERE ' + condition : '') + ' ORDER BY sf_key COLLATE "C"')) {
      hash.update(canonical(row) + '\n'); count++;
    }
    return {rowCount: count.toString(), rowSha256: hash.digest('hex')};
  }
  async function assertView(client, layer, table) {
    const view = (await client.query("SELECT c.oid::text,c.relkind,c.reloptions::text FROM pg_class c WHERE c.oid=$1::regclass",
      [q(layer.relation)])).rows[0];
    need(view?.relkind === 'v' && view.reloptions?.includes('security_invoker=true'),
      'POSTGIS_SECURITY_INVOKER_VIEW_REQUIRED', layer.relation);
    const dependencies = (await client.query(
      "SELECT DISTINCT d.refobjid::text AS oid FROM pg_rewrite r JOIN pg_depend d ON d.objid=r.oid " +
      "JOIN pg_class c ON c.oid=d.refobjid WHERE r.ev_class=$1::oid AND d.refclassid='pg_class'::regclass " +
      "AND c.relkind IN ('r','p','f')", [view.oid])).rows;
    const expectedOid = (await client.query('SELECT $1::regclass::oid::text AS oid', [q(table)])).rows[0].oid;
    need(dependencies.length === 1 && dependencies[0].oid === expectedOid, 'POSTGIS_VIEW_EDITION_BINDING_CHANGED', layer.relation);
    const columns = (await client.query(
      'SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type FROM pg_attribute a ' +
      'WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum',
      [q(layer.relation)])).rows;
    const physical = (await client.query(
      'SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type FROM pg_attribute a ' +
      'WHERE a.attrelid=$1::regclass AND a.attname=ANY($2::text[]) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum',
      [q(table), userColumns(layer)])).rows;
    need(canonical(columns) === canonical(physical) &&
      canonical(columns.map(column => column.attname)) === canonical(userColumns(layer)),
      'POSTGIS_STABLE_VIEW_COLUMNS_CHANGED', layer.relation);
    return columns;
  }
  async function describeLayers(client, selected) {
    const result = [], keyMappings = await primaryKeyMappings(client, selected.profile);
    for (const layer of selected.profile.layers) {
      const actual = selected.layers.find(item => item.id === layer.id);
      need(actual?.liveTable, 'POSTGIS_ACCEPTED_LAYER_REQUIRED', layer.id);
      const table = await tableDigest(client, actual.liveTable);
      const columns = await assertView(client, layer, actual.liveTable);
      result.push({id: layer.id, sourceLayerId: layer.sourceLayerId, title: layer.title,
        schema: profile.database.schema, relation: layer.relation, relationType: 'view', physicalRelation: actual.liveTable,
        keyColumn: 'sf_id', sourceKeyColumn: 'sf_key', geometryColumn: 'geom',
        geometryType: layer.geometry.type, dimension: layer.geometry.dimension, srid: layer.geometry.targetSrid,
        fields: layer.fields, ...table, primaryKeyMetadata: keyMappings.get(layer.id) || null, roles: await observeRoles(client, selected, layer),
        observedColumns: columns, viewDefinitionSha256: createHash('sha256').update((await client.query(
          'SELECT pg_get_viewdef($1::regclass,true) AS definition', [q(layer.relation)])).rows[0].definition).digest('hex')});
    }
    return result;
  }
  return {pool, environment, owner, q, transaction, initialized, ensure, project, edition, committedOperation, savedOperation,
    mutate, checkRoles, projectRoleAccess, primaryKeyMappings, sridDefinitions, createFeatureTable, lockTables, userColumns, allColumns,
    rowHashSQL, copyFeatureRows, installRoles, grantLayer, switchViews, observeRoles, cursorRows,
    tableDigest, assertView, describeLayers, operatorSequence, close};
}
