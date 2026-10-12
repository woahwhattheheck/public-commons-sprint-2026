import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectCommittedOutput, requireAvailableOutput} from './operation-output.mjs';
import {BACKUP, META, need, id, hash, integer, canonical, digest, qi, ql, physicalName,
  normalizeProfile, parseExactJSON, viewContract} from './contract.mjs';
import {privateDirectory, member, claimDirectory, readJSON, fileRecord, verifyFile, writeJSONOnce,
  copyVerified, listFiles, openRetainedSource, retainVectorSource, writeSnapshotRows, readSnapshotRows} from './files.mjs';

export async function openBackup(directory, expectedManifestSha256) {
  const root = await privateDirectory(directory);
  const manifestFile = await fileRecord(member(root, 'postgis-backup.json'), 'postgis-backup.json');
  if (expectedManifestSha256) need(manifestFile.sha256 === hash(expectedManifestSha256), 'POSTGIS_BACKUP_MANIFEST_CHANGED');
  const manifest = await readJSON(member(root, manifestFile.path));
  need(manifest.schema === BACKUP, 'POSTGIS_COMPLETE_DATABASE_BACKUP_REQUIRED');
  id(manifest.projectId); id(manifest.operationId); hash(manifest.requestSha256);
  integer(manifest.revision, 'revision');
  need(Array.isArray(manifest.files) && Array.isArray(manifest.tables) && Array.isArray(manifest.sources),
    'POSTGIS_BACKUP_INDEX_REQUIRED');
  const files = new Map();
  for (const record of manifest.files) {
    need(!files.has(record.path), 'POSTGIS_BACKUP_DUPLICATE_FILE', record.path);
    files.set(record.path, record); await verifyFile(root, record);
  }
  const selectedFile = descriptor => {
    need(descriptor && files.has(descriptor.path) && canonical(files.get(descriptor.path)) === canonical(descriptor),
      'POSTGIS_BACKUP_MEMBER_NOT_BOUND', descriptor?.path);
    return descriptor;
  };
  selectedFile(manifest.metadata); selectedFile(manifest.identities.file);
  for (const table of manifest.tables) {
    id(table.editionId); id(table.layerId);
    need(['baseline', 'live'].includes(table.kind), 'POSTGIS_BACKUP_TABLE_KIND_INVALID');
    selectedFile(table.file); hash(table.rowSha256);
    need(typeof table.rowCount === 'string' && /^\d+$/.test(table.rowCount), 'POSTGIS_BACKUP_ROW_COUNT_REQUIRED');
  }
  for (const source of manifest.sources) {
    id(source.editionId); selectedFile(source.manifest);
    need(source.manifest.path === 'sources/' + source.editionId + '/vector-export.json',
      'POSTGIS_BACKUP_ORIGINAL_SOURCE_PATH_CHANGED');
  }
  const metadata = await readJSON(member(root, manifest.metadata.path));
  need(metadata.schema === 'starforge.postgis-backup-metadata.v1' &&
    metadata.project?.projectId === manifest.projectId &&
    metadata.project.revision === manifest.revision &&
    metadata.project.activeEditionId === manifest.editionId &&
    Array.isArray(metadata.editions) && Array.isArray(metadata.operations),
    'POSTGIS_BACKUP_METADATA_CHANGED');
  const editions = new Map(), expectedTables = new Set();
  for (const edition of metadata.editions) {
    id(edition.editionId); hash(edition.requestSha256);
    need(!editions.has(edition.editionId) && ['staged', 'accepted'].includes(edition.state),
      'POSTGIS_BACKUP_EDITION_INVALID');
    const profile = normalizeProfile(edition.profile);
    need(profile.projectId === manifest.projectId && Array.isArray(edition.layers) &&
      edition.layers.length === profile.layers.length, 'POSTGIS_BACKUP_EDITION_PROFILE_CHANGED');
    editions.set(edition.editionId, edition);
    const source = manifest.sources.filter(item => item.editionId === edition.editionId);
    need(source.length === 1 && source[0].manifest.sha256 === edition.source.manifest.sha256,
      'POSTGIS_BACKUP_ORIGINAL_SOURCE_MISSING', edition.editionId);
    for (const layer of profile.layers) {
      const native = edition.layers.filter(item => item.id === layer.id);
      need(native.length === 1, 'POSTGIS_BACKUP_LAYER_MAPPING_CHANGED', layer.id);
      for (const [kind, table] of [['baseline', native[0].baselineTable], ['live', native[0].liveTable]]) {
        need(kind !== 'baseline' || table, 'POSTGIS_BACKUP_BASELINE_MISSING', layer.id);
        need(edition.state !== 'accepted' || kind !== 'live' || table, 'POSTGIS_BACKUP_ACCEPTED_LIVE_MISSING', layer.id);
        if (!table) continue;
        need(table === physicalName(manifest.projectId, edition.editionId, layer.id, kind === 'baseline' ? 'base' : 'live'),
          'POSTGIS_BACKUP_PHYSICAL_TABLE_CHANGED');
        const key = edition.editionId + ':' + layer.id + ':' + kind;
        const indexed = manifest.tables.filter(item => item.editionId === edition.editionId && item.layerId === layer.id && item.kind === kind);
        need(indexed.length === 1 && indexed[0].table === table, 'POSTGIS_BACKUP_COMPLETE_TABLE_MISSING', key);
        expectedTables.add(key);
      }
    }
  }
  need(manifest.tables.length === expectedTables.size && manifest.sources.length === editions.size,
    'POSTGIS_BACKUP_UNEXPECTED_TABLE_OR_SOURCE');
  if (manifest.editionId) need(editions.get(manifest.editionId)?.state === 'accepted', 'POSTGIS_BACKUP_ACTIVE_EDITION_MISSING');
  const operations = new Set();
  for (const operation of metadata.operations) {
    id(operation.operation_id); hash(operation.request_sha256);
    need(operation.project_id === manifest.projectId && !operations.has(operation.operation_id),
      'POSTGIS_BACKUP_ORIGINAL_OPERATION_INVALID');
    operations.add(operation.operation_id);
    const request = parseExactJSON(operation.request_json), result = parseExactJSON(operation.result_json);
    need(digest(request) === operation.request_sha256 && result.operationId === operation.operation_id &&
      result.requestSha256 === operation.request_sha256, 'POSTGIS_BACKUP_ORIGINAL_OPERATION_CHANGED');
  }
  return {directory: root, manifest, manifestFile, metadata};
}

export async function exportDatabaseBackup({db, profile, root, sourceOptions, operationId, directory}) {
  id(operationId);
  need(typeof directory === 'string' && directory.length, 'POSTGIS_BACKUP_DESTINATION_REQUIRED');
  const request = {schema: 'starforge.postgis-backup-request.v1', operationId,
    projectId: profile.projectId, directory: resolve(directory)};
  async function verifiedResult(result) {
    const artifact = await inspectCommittedOutput({kind: 'backup', projectId: profile.projectId,
      operationId, requestSha256: result.requestSha256, directory: request.directory,
      manifestFile: result.manifestFile}, openBackup);
    requireAvailableOutput(artifact, operationId);
    return {...result, artifact};
  }
  const committed = await db.transaction(async client => {
    const saved = await db.savedOperation(client, operationId, digest(request));
    return saved ? {...saved, replayed: true, current: await db.project(client)} : null;
  }, {readOnly: true});
  if (committed) return verifiedResult(committed);
  const output = await claimDirectory(directory, request);
  let completed = null;
  try { completed = await openBackup(output); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (completed) need(completed.manifest.operationId === operationId &&
    completed.manifest.requestSha256 === digest(request), 'POSTGIS_ORIGINAL_BACKUP_OPERATION_CHANGED');
  const result = await db.mutate(operationId, 'export-backup', request, async (client, current, requestSha256) => {
    if (completed) return {...completed, recoveredCompletedFile: true};
    const editionIds = (await client.query('SELECT edition_id FROM ' + db.q(META.editions) +
      ' WHERE project_id=$1 ORDER BY edition_id', [profile.projectId])).rows.map(row => row.edition_id);
    const editions = [];
    for (const editionId of editionIds) editions.push(await db.edition(client, editionId));
    await db.lockTables(client, editions.flatMap(edition => edition.layers.flatMap(layer =>
      [layer.baselineTable, layer.liveTable].filter(Boolean))));
    const currentEdition = editions.find(edition => edition.editionId === current.activeEditionId);
    const observations = currentEdition ? await db.describeLayers(client, currentEdition) : [];
    const operations = (await client.query('SELECT project_id,operation_id,kind,request_sha256,' +
      'request_json::text,result_json::text,committed_at::text FROM ' + db.q(META.operations) +
      ' WHERE project_id=$1 ORDER BY committed_at,operation_id', [profile.projectId])).rows;
    const tables = [], sources = [];
    for (const edition of editions) {
      const original = await openRetainedSource(member(root, edition.source.directory),
        edition.source.manifest.sha256, sourceOptions);
      const sourceDirectory = member(output, 'sources/' + edition.editionId);
      await privateDirectory(sourceDirectory);
      for (const record of [...original.manifest.files, original.manifestFile])
        await copyVerified(original.directory, sourceDirectory, record);
      sources.push({editionId: edition.editionId, manifest: await fileRecord(
        member(sourceDirectory, 'vector-export.json'), 'sources/' + edition.editionId + '/vector-export.json')});
      for (const layer of edition.profile.layers) {
        const native = edition.layers.find(item => item.id === layer.id);
        for (const [kind, table] of [['baseline', native.baselineTable], ['live', native.liveTable]]) {
          if (!table) continue;
          const rowDigest = createHash('sha256'); let count = 0n;
          const fields = layer.fields.map((field, i) => qi(field.name) + '::text AS ' + qi('field_' + i));
          const statement = 'SELECT sf_id::text,sf_key,_sf_source::text AS source_json,' +
            (fields.length ? fields.join(',') + ',' : '') +
            "encode(ST_AsEWKB(geom),'hex') AS geometry_ewkb," + db.rowHashSQL('t') + ' AS row_hash FROM ' +
            db.q(table) + ' t ORDER BY sf_key COLLATE "C"';
          async function* rows() {
            for await (const row of db.cursorRows(client, statement)) {
              rowDigest.update(canonical({sf_id: row.sf_id, sf_key: row.sf_key, row_hash: row.row_hash}) + '\n');
              count++;
              yield {sfId: row.sf_id, rowKey: row.sf_key, sourceJson: row.source_json,
                values: layer.fields.map((_, i) => row['field_' + i]), geometryEWKB: row.geometry_ewkb};
            }
          }
          const file = await writeSnapshotRows(output,
            'tables/' + edition.editionId + '/' + layer.id + '/' + kind + '.ndjson', rows());
          tables.push({editionId: edition.editionId, layerId: layer.id, kind, table, file,
            rowCount: count.toString(), rowSha256: rowDigest.digest('hex')});
        }
      }
    }
    let identityCount = 0n;
    async function* identities() {
      for await (const row of db.cursorRows(client, 'SELECT project_id,layer_id,row_key,sf_id::text FROM ' +
        db.q(META.identities) + ' WHERE project_id=$1 ORDER BY layer_id COLLATE "C",row_key COLLATE "C"',
        [profile.projectId])) { identityCount++; yield row; }
    }
    const identityFile = await writeSnapshotRows(output, 'identities.ndjson', identities());
    const metadata = {schema: 'starforge.postgis-backup-metadata.v1', project: current,
      editions, operations, database: db.environment, currentLayerObservations: observations};
    const metadataFile = await writeSnapshotRows(output, 'database-metadata.json', [metadata]);
    const createdAt = (await client.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC'," +
      "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS time")).rows[0].time;
    const manifest = {schema: BACKUP, projectId: profile.projectId, operationId, requestSha256,
      editionId: current.activeEditionId, revision: current.revision, createdAt,
      database: db.environment, metadata: metadataFile,
      identities: {file: identityFile, rowCount: identityCount.toString()}, tables, sources,
      files: await listFiles(output, new Set(['postgis-backup.json']))};
    await writeJSONOnce(member(output, 'postgis-backup.json'), manifest);
    return openBackup(output);
  });
  return verifiedResult(result);
}

export async function restoreDatabaseBackup({db, profile, root, sourceOptions, operationId, directory, expectedManifestSha256}) {
  id(operationId); hash(expectedManifestSha256);
  const original = await openBackup(directory, expectedManifestSha256);
  need(original.manifest.projectId === profile.projectId, 'POSTGIS_RESTORE_ORIGINAL_PROJECT_REQUIRED');
  const sourceProfile = normalizeProfile(original.metadata.project.profile);
  need(canonical(profile.layers) === canonical(sourceProfile.layers) &&
    canonical(viewContract(profile)) === canonical(viewContract(sourceProfile)),
    'POSTGIS_RESTORE_ORIGINAL_LAYER_ROLE_PROFILE_REQUIRED');
  need(!original.metadata.operations.some(row => row.operation_id === operationId),
    'POSTGIS_RESTORE_NEW_ORIGINAL_OPERATION_ID_REQUIRED');
  const request = {schema: 'starforge.postgis-restore-request.v1', operationId, projectId: profile.projectId,
    backupManifestSha256: expectedManifestSha256, destinationDatabase: profile.database};
  return db.mutate(operationId, 'restore-backup', request, async (client, current) => {
    const occupied = (await client.query('SELECT ' +
      '(SELECT count(*)::text FROM ' + db.q(META.editions) + ' WHERE project_id=$1) AS editions,' +
      '(SELECT count(*)::text FROM ' + db.q(META.operations) + ' WHERE project_id=$1) AS operations,' +
      '(SELECT count(*)::text FROM ' + db.q(META.identities) + ' WHERE project_id=$1) AS identities',
      [profile.projectId])).rows[0];
    need(current.revision === 0 && !current.activeEditionId &&
      occupied.editions === '0' && occupied.operations === '0' && occupied.identities === '0',
      'POSTGIS_RESTORE_EMPTY_DESTINATION_PROJECT_REQUIRED');
    for (const layer of profile.layers) {
      const exists = (await client.query('SELECT to_regclass($1) AS relation', [db.q(layer.relation)])).rows[0].relation;
      need(exists === null, 'POSTGIS_RESTORE_EXISTING_RELATION_CONFLICT', layer.relation);
    }
    const editions = [];
    for (const saved of original.metadata.editions) {
      const edition = parseExactJSON(canonical(saved));
      edition.profile.database = profile.database;
      normalizeProfile(edition.profile);
      await db.checkRoles(client, edition.profile);
      const sourceRecord = original.manifest.sources.find(item => item.editionId === edition.editionId);
      const destination = member(root, 'sources/' + edition.editionId);
      await retainVectorSource(member(original.directory, 'sources/' + edition.editionId), destination,
        sourceRecord.manifest.sha256, sourceOptions);
      edition.source.directory = 'sources/' + edition.editionId;
      await writeJSONOnce(member(root, 'profiles/' + digest(edition.profile) + '.json'), edition.profile);
      editions.push(edition);
    }
    // Restoration preserves positive source identities within their logical layer.
    // The table lock prevents concurrent source allocation while the shared native
    // identity sequence is advanced; no other project's rows are changed.
    await client.query('LOCK TABLE ' + db.q(META.identities) + ' IN SHARE ROW EXCLUSIVE MODE');
    let identityCount = 0n;
    const identityBatch = [];
    async function flushIdentities() {
      if (!identityBatch.length) return;
      const parameters = [], tuples = identityBatch.map(row => {
        const start = parameters.length;
        parameters.push(profile.projectId, row.layer_id, row.row_key, row.sf_id);
        return '($' + (start + 1) + ',$' + (start + 2) + ',$' + (start + 3) + ',$' + (start + 4) + '::bigint)';
      });
      await client.query('INSERT INTO ' + db.q(META.identities) +
        '(project_id,layer_id,row_key,sf_id) OVERRIDING SYSTEM VALUE VALUES ' + tuples.join(','), parameters);
      identityBatch.length = 0;
    }
    const knownLayers = new Set(editions.flatMap(edition => edition.profile.layers.map(layer => layer.id)));
    for await (const row of readSnapshotRows(original.directory, original.manifest.identities.file)) {
      need(row.project_id === profile.projectId && knownLayers.has(row.layer_id) &&
        typeof row.row_key === 'string' && /^[a-f0-9]{64}$/.test(row.row_key) &&
        typeof row.sf_id === 'string' && /^[1-9]\d*$/.test(row.sf_id) && BigInt(row.sf_id) <= 9223372036854775807n,
        'POSTGIS_RESTORE_SOURCE_IDENTITY_INVALID');
      identityBatch.push(row);
      if (identityBatch.length >= 500) await flushIdentities();
      identityCount++;
    }
    await flushIdentities();
    need(identityCount.toString() === original.manifest.identities.rowCount,
      'POSTGIS_RESTORE_IDENTITY_COVERAGE_CHANGED');
    const identitySequence = (await client.query("SELECT pg_get_serial_sequence($1,'sf_id') AS name",
      [db.q(META.identities)])).rows[0].name;
    const globalMaximum = (await client.query('SELECT COALESCE(max(sf_id),0)::text AS maximum FROM ' +
      db.q(META.identities))).rows[0].maximum;
    if (BigInt(globalMaximum) > 0n) await client.query('SELECT setval($1::regclass,GREATEST(' +
      "$2::bigint,COALESCE(pg_sequence_last_value($1::regclass),1)),true)", [identitySequence, globalMaximum]);
    const minimumIds = new Map();
    for (const edition of editions) {
      for (const layer of edition.profile.layers) {
        const native = edition.layers.find(item => item.id === layer.id);
        for (const [kind, table] of [['baseline', native.baselineTable], ['live', native.liveTable]]) {
          if (!table) continue;
          const record = original.manifest.tables.find(item => item.editionId === edition.editionId &&
            item.layerId === layer.id && item.kind === kind);
          await db.createFeatureTable(client, table, layer);
          const batch = [];
          const maximumBatch = Math.max(1, Math.min(200, Math.floor(60000 / (layer.fields.length + 4))));
          async function flush() {
            if (!batch.length) return;
            const parameters = [], tuples = [];
            const param = value => { parameters.push(value); return '$' + parameters.length; };
            for (const row of batch) {
              const values = [param(row.sfId) + '::bigint', param(row.rowKey) + '::text',
                param(row.sourceJson) + '::jsonb'];
              row.values.forEach((value, i) => values.push(param(value) + '::' + layer.fields[i].type));
              const geometry = param(row.geometryEWKB);
              values.push('CASE WHEN ' + geometry + "::text IS NULL THEN NULL ELSE ST_GeomFromEWKB(decode(" + geometry + "::text,'hex')) END");
              tuples.push('(' + values.join(',') + ')');
            }
            await client.query('INSERT INTO ' + db.q(table) + '(' + db.allColumns(layer).map(qi).join(',') +
              ') VALUES ' + tuples.join(','), parameters);
            batch.length = 0;
          }
          for await (const row of readSnapshotRows(original.directory, record.file)) {
            need(row && typeof row.sfId === 'string' && /^-?[1-9]\d*$/.test(row.sfId) &&
              BigInt(row.sfId) >= -9223372036854775807n && BigInt(row.sfId) <= 9223372036854775807n &&
              typeof row.rowKey === 'string' && row.rowKey.length <= 160 &&
              (row.sourceJson === null || typeof row.sourceJson === 'string') &&
              Array.isArray(row.values) && row.values.length === layer.fields.length &&
              row.values.every(value => value === null || typeof value === 'string') &&
              (row.geometryEWKB === null || typeof row.geometryEWKB === 'string' && /^(?:[a-f0-9]{2})+$/.test(row.geometryEWKB)),
              'POSTGIS_RESTORE_NATIVE_ROW_INVALID');
            if (row.sourceJson !== null) parseExactJSON(row.sourceJson);
            const value = BigInt(row.sfId);
            if (value < 0n) minimumIds.set(layer.id, value < (minimumIds.get(layer.id) || 0n) ? value : minimumIds.get(layer.id));
            batch.push(row); if (batch.length >= maximumBatch) await flush();
          }
          await flush();
          const observed = await db.tableDigest(client, table);
          need(observed.rowCount === record.rowCount && observed.rowSha256 === record.rowSha256,
            'POSTGIS_RESTORE_COMPLETE_NATIVE_ROWS_CHANGED', {editionId: edition.editionId, layerId: layer.id, kind});
          const unmatched = (await client.query('SELECT count(*)::text AS count FROM ' + db.q(table) +
            ' t LEFT JOIN ' + db.q(META.identities) + ' i ON i.project_id=$1 AND i.layer_id=$2 AND i.row_key=t.sf_key ' +
            'WHERE (t.sf_id>0 AND (i.sf_id IS NULL OR i.sf_id<>t.sf_id)) OR ' +
            "(t.sf_id<0 AND t.sf_key NOT LIKE 'operator:%')", [profile.projectId, layer.id])).rows[0].count;
          need(unmatched === '0', 'POSTGIS_RESTORE_ROW_IDENTITY_CHANGED', table);
          if (kind === 'live') await db.installRoles(client, table, layer);
        }
      }
      await client.query('INSERT INTO ' + db.q(META.editions) +
        '(project_id,edition_id,request_sha256,source_json,profile_json,layers_json,state,created_at,accepted_at)' +
        ' VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8::timestamptz,$9::timestamptz)',
        [profile.projectId, edition.editionId, edition.requestSha256, canonical(edition.source), canonical(edition.profile),
          canonical(edition.layers), edition.state, edition.createdAt, edition.acceptedAt]);
    }
    for (const [layerId, minimum] of minimumIds)
      await client.query('SELECT setval($1::regclass,GREATEST($2::bigint,' +
        'COALESCE(pg_sequence_last_value($1::regclass),1)),true)',
        [db.q(db.operatorSequence(layerId)), (-minimum).toString()]);
    for (const row of original.metadata.operations)
      await client.query('INSERT INTO ' + db.q(META.operations) +
        '(project_id,operation_id,kind,request_sha256,request_json,result_json,committed_at)' +
        ' VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz)',
        [profile.projectId, row.operation_id, row.kind, row.request_sha256, row.request_json, row.result_json, row.committed_at]);
    const savedProject = original.metadata.project;
    await client.query('UPDATE ' + db.q(META.projects) +
      ' SET profile_sha256=$2,profile_json=$3::jsonb,revision=$4::bigint,active_edition_id=$5,' +
      'created_at=$6::timestamptz,updated_at=$7::timestamptz WHERE project_id=$1',
      [profile.projectId, digest(profile), canonical(profile), String(savedProject.revision),
        savedProject.activeEditionId, savedProject.createdAt, savedProject.updatedAt]);
    const active = editions.find(edition => edition.editionId === savedProject.activeEditionId);
    if (active) await db.switchViews(client, active, null, active.profile);
    // All retained live editions keep their policies; only the active edition is
    // granted to receiving roles until an explicit original rollback selects it.
    for (const edition of editions) if (edition !== active) {
      for (const layer of edition.profile.layers) {
        const table = edition.layers.find(item => item.id === layer.id).liveTable;
        if (!table) continue;
        for (const role of layer.roles) {
          await client.query('REVOKE ALL ON TABLE ' + db.q(table) + ' FROM ' + qi(role.name));
          for (const permission of ['INSERT', 'UPDATE', 'SELECT', 'REFERENCES'])
            await client.query('REVOKE ' + permission + '(' + db.userColumns(layer).map(qi).join(',') +
              ') ON TABLE ' + db.q(table) + ' FROM ' + qi(role.name));
        }
      }
    }
    return {schema: 'starforge.postgis-restore-result.v1', projectId: profile.projectId,
      editionId: savedProject.activeEditionId, revision: savedProject.revision,
      backup: {manifest: original.manifestFile, database: original.manifest.database,
        operationId: original.manifest.operationId},
      database: db.environment, retainedEditions: editions.map(edition => edition.editionId),
      restoredIdentities: identityCount.toString(), restoredTables: original.manifest.tables.length,
      restoredOperations: original.metadata.operations.length,
      layers: active ? await db.describeLayers(client, active) : []};
  });
}
