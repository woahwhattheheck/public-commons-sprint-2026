import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {META, REVIEW, RECEIVING, need, normalizeProfile, canonical, digest, sha256, id, hash, integer,
  qi, physicalName, fieldParameter, parseExactJSON} from './contract.mjs';
import {privateDirectory, member, claimDirectory, writeJSONOnce, readJSON, fileRecord, verifyFile,
  copyVerified, listFiles, retainVectorSource, openRetainedSource, sourceFeatures, validateSourceMapping,
  openReceiving} from './files.mjs';
import {createDatabase} from './database.mjs';
import {exportDatabaseBackup, restoreDatabaseBackup} from './backup.mjs';

export {normalizeProfile, parseExactJSON, stringifyExactJSON, ExactNumber} from './contract.mjs';
export {openReceiving} from './files.mjs';
export {verifyReceiving} from './verify.mjs';
export {openBackup} from './backup.mjs';

export async function openPostgisIntake({connection, profile: inputProfile, directory, python} = {}) {
  const profile = normalizeProfile(inputProfile);
  need(typeof directory === 'string' && directory.length, 'POSTGIS_OPERATOR_DIRECTORY_REQUIRED');
  const root = await privateDirectory(directory);
  await claimDirectory(root, {schema: 'starforge.postgis-operator-workspace.v1', projectId: profile.projectId,
    database: profile.database});
  const profileSha256 = digest(profile), sourceOptions = python ? {python} : {};
  await writeJSONOnce(member(root, 'profiles/' + profileSha256 + '.json'), profile);
  const db = await createDatabase(connection, profile);
  const currentTime = async client => (await client.query(
    "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS time")).rows[0].time;
  const sourcePath = source => member(root, source.directory);

  async function inspect() {
    return db.transaction(async client => {
      const current = await db.project(client);
      if (!current) return {schema: 'starforge.postgis-intake-inspection.v1', database: db.environment,
        projectId: profile.projectId, initialized: false, profileSha256};
      const editions = (await client.query('SELECT edition_id,state,created_at::text,accepted_at::text FROM ' +
        db.q(META.editions) + ' WHERE project_id=$1 ORDER BY created_at,edition_id', [profile.projectId])).rows;
      const selected = current.activeEditionId ? await db.edition(client, current.activeEditionId) : null;
      const layers = selected ? await db.describeLayers(client, selected) : [];
      return {schema: 'starforge.postgis-intake-inspection.v1', database: db.environment,
        initialized: true, ...current, editions, layers};
    });
  }

  async function stage({operationId, sourceDirectory, expectedManifestSha256}) {
    id(operationId, 'operationId'); hash(expectedManifestSha256);
    const request = {schema: 'starforge.postgis-stage-request.v1', operationId,
      projectId: profile.projectId, profileSha256, sourceManifestSha256: expectedManifestSha256};
    const editionId = 'edition-' + digest(request).slice(0, 40);
    const saved = await db.transaction(async client => {
      const result = await db.savedOperation(client, operationId, digest(request));
      return result ? {...result, replayed: true, current: await db.project(client)} : null;
    });
    if (saved) return saved;
    const relativeSource = 'sources/' + editionId;
    const original = await retainVectorSource(sourceDirectory, member(root, relativeSource),
      expectedManifestSha256, sourceOptions);
    return db.mutate(operationId, 'stage', request, async (client, current, requestSha256) => {
      const srids = await db.sridDefinitions(client, profile);
      const crsObservation = await validateSourceMapping(original, profile, srids, sourceOptions);
      const stageLayers = [];
      const selected = new Map(profile.layers.map(layer => [layer.sourceLayerId, layer]));
      const batches = new Map(profile.layers.map(layer => [layer.id, []]));
      const loaded = new Map(profile.layers.map(layer => [layer.id, 0n]));
      for (const layer of profile.layers) {
        const baselineTable = physicalName(profile.projectId, editionId, layer.id, 'base');
        await db.createFeatureTable(client, baselineTable, layer);
        stageLayers.push({id: layer.id, sourceLayerId: layer.sourceLayerId, baselineTable, liveTable: null});
      }
      async function flush(layer) {
        const rows = batches.get(layer.id);
        if (!rows.length) return;
        const keys = rows.map(row => row.rowKey);
        need(new Set(keys).size === keys.length, 'POSTGIS_DUPLICATE_SOURCE_ROW');
        await client.query('INSERT INTO ' + db.q(META.identities) +
          '(project_id,layer_id,row_key) SELECT $1,$2,unnest($3::text[]) ON CONFLICT(project_id,layer_id,row_key) DO NOTHING',
          [profile.projectId, layer.id, keys]);
        const identities = (await client.query('SELECT row_key,sf_id::text FROM ' + db.q(META.identities) +
          ' WHERE project_id=$1 AND layer_id=$2 AND row_key=ANY($3::text[])', [profile.projectId, layer.id, keys])).rows;
        const byKey = new Map(identities.map(row => [row.row_key, row.sf_id]));
        need(byKey.size === keys.length, 'POSTGIS_SOURCE_IDENTITY_ASSIGNMENT_INCOMPLETE');
        const values = [], tuples = [];
        const parameter = value => { values.push(value); return '$' + values.length; };
        for (const row of rows) {
          const props = row.feature.properties || {}, fields = [
            parameter(byKey.get(row.rowKey)) + '::bigint',
            parameter(row.rowKey) + '::text',
            parameter(canonical(row)) + '::jsonb'
          ];
          for (const field of layer.fields)
            fields.push(parameter(fieldParameter(props[field.sourceName], Object.hasOwn(props, field.sourceName), field)) + '::' + field.type);
          const geometry = parameter(row.feature.geometry === null ? null : canonical(row.feature.geometry));
          let expression = 'ST_SetSRID(ST_GeomFromGeoJSON(' + geometry + '::text),' + layer.geometry.sourceSrid + ')';
          if (layer.geometry.sourceSrid !== layer.geometry.targetSrid)
            expression = 'ST_Transform(' + expression + ',' + layer.geometry.targetSrid + ')';
          fields.push('CASE WHEN ' + geometry + '::text IS NULL THEN NULL ELSE ' + expression + ' END');
          tuples.push('(' + fields.join(',') + ')');
        }
        const table = stageLayers.find(item => item.id === layer.id).baselineTable;
        await client.query('INSERT INTO ' + db.q(table) + '(' + db.allColumns(layer).map(qi).join(',') +
          ') VALUES ' + tuples.join(','), values);
        loaded.set(layer.id, loaded.get(layer.id) + BigInt(rows.length));
        rows.length = 0;
      }
      for await (const row of sourceFeatures(original)) {
        const layer = selected.get(row.layerId);
        if (!layer) continue;
        const batch = batches.get(layer.id); batch.push(row);
        if (batch.length >= Math.max(1, Math.min(200, Math.floor(60000 / (layer.fields.length + 4))))) await flush(layer);
      }
      for (const layer of profile.layers) {
        await flush(layer);
        const originalLayer = original.inspection.layers.find(item => item.id === layer.sourceLayerId);
        need(loaded.get(layer.id).toString() === String(originalLayer.counts.features),
          'POSTGIS_ORIGINAL_FEATURE_COVERAGE_CHANGED', layer.id);
        const staged = stageLayers.find(item => item.id === layer.id);
        const observed = (await client.query('SELECT count(*)::text AS count, ' +
          'count(*) FILTER(WHERE geom IS NOT NULL AND ST_NDims(geom)<>$1)::text AS wrong_dimensions, ' +
          'count(*) FILTER(WHERE geom IS NOT NULL AND NOT ST_IsValid(geom))::text AS invalid_geometries FROM ' +
          db.q(staged.baselineTable), [layer.geometry.dimension])).rows[0];
        need(observed.count === loaded.get(layer.id).toString() && observed.wrong_dimensions === '0',
          'POSTGIS_NATIVE_FEATURE_COVERAGE_CHANGED', layer.id);
        need(layer.geometry.acceptInvalid || observed.invalid_geometries === '0',
          'POSTGIS_INVALID_GEOMETRY_REVIEW_REQUIRED', {layerId: layer.id, count: observed.invalid_geometries});
        Object.assign(staged, await db.tableDigest(client, staged.baselineTable),
          {sourceFeatureCount: loaded.get(layer.id).toString(), invalidGeometries: observed.invalid_geometries});
      }
      const source = {directory: relativeSource, manifest: original.manifestFile,
        captureSha256: original.manifest.sourceCapture.sha256, selectionSha256: original.manifest.selectionSha256,
        sourceEdition: original.manifest.sourceEdition, selectionId: original.capture.selection.id,
        crsObservation, sourceEngine: original.receiving.engine};
      await client.query('INSERT INTO ' + db.q(META.editions) +
        '(project_id,edition_id,request_sha256,source_json,profile_json,layers_json,state) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,\'staged\')',
        [profile.projectId, editionId, requestSha256, canonical(source), canonical(profile), canonical(stageLayers)]);
      return {schema: 'starforge.postgis-stage-result.v1', projectId: profile.projectId, editionId,
        currentRevision: current.revision, source, layers: stageLayers, database: db.environment};
    });
  }

  async function compare(client, current, successor, {lockLive = false} = {}) {
    need(successor.state === 'staged', 'POSTGIS_SUCCESSOR_MUST_BE_STAGED');
    need(digest(successor.profile) === profileSha256, 'POSTGIS_STAGED_MAPPING_CHANGED');
    const previous = current.activeEditionId ? await db.edition(client, current.activeEditionId) : null;
    if (lockLive && previous) await db.lockTables(client, previous.layers.map(layer => layer.liveTable));
    if (previous) for (const layer of previous.profile.layers)
      await db.assertView(client, layer, previous.layers.find(item => item.id === layer.id).liveTable);
    const changes = [], summaries = [], fullHash = createHash('sha256');
    const empty = 'SELECT NULL::text AS sf_key,NULL::text AS row_hash WHERE false';
    for (const layer of profile.layers) {
      const old = previous?.layers.find(item => item.id === layer.id);
      const incoming = successor.layers.find(item => item.id === layer.id);
      const query = table => table ? 'SELECT sf_key,' + db.rowHashSQL('t') + ' AS row_hash FROM ' + db.q(table) + ' t' : empty;
      const statement = 'WITH b AS (' + query(old?.baselineTable) + '), l AS (' + query(old?.liveTable) +
        '), n AS (' + query(incoming.baselineTable) + ') SELECT sf_key,b.row_hash AS baseline_hash,' +
        'l.row_hash AS live_hash,n.row_hash AS incoming_hash FROM b FULL JOIN l USING(sf_key) FULL JOIN n USING(sf_key) ' +
        'ORDER BY sf_key COLLATE "C"';
      const counts = {sourceAdded: 0, sourceChanged: 0, sourceRemoved: 0, localChanged: 0, conflicts: 0, unchanged: 0};
      for await (const row of db.cursorRows(client, statement)) {
        fullHash.update(canonical({layerId: layer.id, ...row}) + '\n');
        const sourceChanged = row.baseline_hash !== row.incoming_hash;
        const localChanged = row.baseline_hash !== row.live_hash;
        const conflict = sourceChanged && localChanged && row.live_hash !== row.incoming_hash;
        if (!sourceChanged && !localChanged) { counts.unchanged++; continue; }
        if (sourceChanged && row.baseline_hash === null) counts.sourceAdded++;
        else if (sourceChanged && row.incoming_hash === null) counts.sourceRemoved++;
        else if (sourceChanged) counts.sourceChanged++;
        if (localChanged) counts.localChanged++;
        if (conflict) counts.conflicts++;
        changes.push({layerId: layer.id, rowKey: row.sf_key, baselineHash: row.baseline_hash,
          liveHash: row.live_hash, incomingHash: row.incoming_hash, sourceChanged, localChanged, conflict,
          suggestedDecision: conflict ? null : !sourceChanged && localChanged ? 'keep-current' : 'take-source',
          sourceDisposition: row.incoming_hash === null ? 'absent' : row.baseline_hash === null ? 'added' : 'present',
          liveDisposition: row.live_hash === null ? 'absent' : row.baseline_hash === null ? 'operator-insert' : 'present'});
      }
      summaries.push({layerId: layer.id, ...counts});
    }
    const body = {schema: REVIEW, projectId: profile.projectId, editionId: successor.editionId,
      previousEditionId: current.activeEditionId, expectedRevision: current.revision, profileSha256,
      sourceManifestSha256: successor.source.manifest.sha256, completeRowStateSha256: fullHash.digest('hex'),
      summaries, changes};
    return {...body, reviewSha256: digest(body)};
  }

  async function review({editionId}) {
    id(editionId);
    return db.transaction(async client => {
      const current = await db.project(client);
      need(current, 'POSTGIS_PROJECT_NOT_INITIALIZED');
      return compare(client, current, await db.edition(client, editionId));
    }, {repeatable: true});
  }

  async function readRow({editionId, layerId, rowKey}) {
    id(editionId); id(layerId);
    need(typeof rowKey === 'string' && rowKey.length > 0 && rowKey.length <= 160, 'POSTGIS_SOURCE_KEY_REQUIRED');
    return db.transaction(async client => {
      const selected = await db.edition(client, editionId), layer = selected.layers.find(item => item.id === layerId);
      need(layer, 'POSTGIS_EDITION_LAYER_NOT_FOUND', layerId);
      const get = async table => {
        if (!table) return null;
        const row = (await client.query("SELECT (to_jsonb(t)-'geom')::text AS attributes, " +
          "encode(ST_AsEWKB(geom),'hex') AS geometry_ewkb,ST_AsGeoJSON(geom,17,0) AS geometry_json, " +
          db.rowHashSQL('t') + ' AS row_hash FROM ' + db.q(table) + ' t WHERE sf_key=$1', [rowKey])).rows[0];
        return row ? {attributes: parseExactJSON(row.attributes), geometryEWKB: row.geometry_ewkb,
          geometry: row.geometry_json === null ? null : parseExactJSON(row.geometry_json), rowHash: row.row_hash} : null;
      };
      return {projectId: profile.projectId, editionId, layerId, rowKey,
        baseline: await get(layer.baselineTable), current: await get(layer.liveTable)};
    }, {repeatable: true});
  }

  async function promote({operationId, editionId, expectedRevision, reviewSha256, decisions = []}) {
    id(operationId); id(editionId); integer(expectedRevision, 'expectedRevision'); hash(reviewSha256);
    need(Array.isArray(decisions), 'POSTGIS_REVIEW_DECISIONS_REQUIRED');
    const request = {schema: 'starforge.postgis-promotion-request.v1', operationId, projectId: profile.projectId,
      editionId, expectedRevision, reviewSha256, decisions, profileSha256};
    return db.mutate(operationId, 'promote', request, async (client, current) => {
      need(current.revision === expectedRevision, 'POSTGIS_PROJECT_REVISION_CHANGED', current.revision);
      const successor = await db.edition(client, editionId);
      const checked = await compare(client, current, successor, {lockLive: true});
      need(checked.reviewSha256 === reviewSha256, 'POSTGIS_LIVE_REVIEW_CHANGED', checked);
      const approved = new Map(), changes = new Map(checked.changes.map(row => [row.layerId + '\0' + row.rowKey, row]));
      for (const decision of decisions) {
        const key = decision.layerId + '\0' + decision.rowKey;
        need(changes.has(key) && !approved.has(key) && ['keep-current', 'take-source'].includes(decision.choice),
          'POSTGIS_REVIEW_DECISION_INVALID', decision);
        approved.set(key, decision.choice);
      }
      for (const [key, change] of changes)
        need(!change.conflict || approved.has(key), 'POSTGIS_SOURCE_AND_CUSTOMER_EDIT_CONFLICT', change);
      const previous = current.activeEditionId ? await db.edition(client, current.activeEditionId) : null;
      for (const layer of profile.layers) {
        const item = successor.layers.find(row => row.id === layer.id);
        item.liveTable = physicalName(profile.projectId, editionId, layer.id, 'live');
        await db.createFeatureTable(client, item.liveTable, layer);
        await db.copyFeatureRows(client, item.baselineTable, item.liveTable, layer);
        const preserve = checked.changes.filter(row => row.layerId === layer.id &&
          (approved.get(layer.id + '\0' + row.rowKey) || row.suggestedDecision) === 'keep-current').map(row => row.rowKey);
        for (let start = 0; start < preserve.length; start += 1000) {
          const keys = preserve.slice(start, start + 1000);
          await client.query('DELETE FROM ' + db.q(item.liveTable) + ' WHERE sf_key=ANY($1::text[])', [keys]);
          const old = previous?.layers.find(row => row.id === layer.id);
          if (old?.liveTable) await db.copyFeatureRows(client, old.liveTable, item.liveTable, layer, keys);
        }
        await db.installRoles(client, item.liveTable, layer);
      }
      const acceptedAt = await currentTime(client);
      successor.state = 'accepted'; successor.acceptedAt = acceptedAt;
      await client.query('UPDATE ' + db.q(META.editions) +
        " SET layers_json=$3::jsonb,state='accepted',accepted_at=$4::timestamptz WHERE project_id=$1 AND edition_id=$2",
        [profile.projectId, editionId, canonical(successor.layers), acceptedAt]);
      await client.query('UPDATE ' + db.q(META.projects) +
        ' SET active_edition_id=$2,revision=revision+1,profile_json=$3::jsonb,profile_sha256=$4,updated_at=$5::timestamptz WHERE project_id=$1',
        [profile.projectId, editionId, canonical(profile), profileSha256, acceptedAt]);
      await db.switchViews(client, successor, previous, profile);
      return {schema: 'starforge.postgis-promotion-result.v1', projectId: profile.projectId, editionId,
        revision: expectedRevision + 1, previousEditionId: current.activeEditionId, acceptedAt,
        reviewSha256, decisions, layers: await db.describeLayers(client, successor)};
    });
  }

  async function rollback({operationId, editionId, expectedRevision}) {
    id(operationId); id(editionId); integer(expectedRevision, 'expectedRevision');
    const request = {schema: 'starforge.postgis-rollback-request.v1', operationId, projectId: profile.projectId,
      editionId, expectedRevision, profileSha256};
    return db.mutate(operationId, 'rollback', request, async (client, current) => {
      need(current.revision === expectedRevision, 'POSTGIS_PROJECT_REVISION_CHANGED', current.revision);
      need(current.activeEditionId && current.activeEditionId !== editionId, 'POSTGIS_DIFFERENT_RETAINED_EDITION_REQUIRED');
      const selected = await db.edition(client, editionId), previous = await db.edition(client, current.activeEditionId);
      need(selected.state === 'accepted' && selected.layers.every(layer => layer.liveTable), 'POSTGIS_RETAINED_ACCEPTED_EDITION_REQUIRED');
      await db.lockTables(client, selected.layers.concat(previous.layers).map(layer => layer.liveTable));
      for (const layer of previous.profile.layers)
        await db.assertView(client, layer, previous.layers.find(item => item.id === layer.id).liveTable);
      await db.checkRoles(client, selected.profile);
      for (const layer of selected.profile.layers) {
        const physical = selected.layers.find(item => item.id === layer.id);
        for (const role of layer.roles) await db.grantLayer(client, physical.liveTable, layer, role);
      }
      const acceptedAt = await currentTime(client);
      await client.query('UPDATE ' + db.q(META.projects) +
        ' SET active_edition_id=$2,revision=revision+1,profile_json=$3::jsonb,profile_sha256=$4,updated_at=$5::timestamptz WHERE project_id=$1',
        [profile.projectId, editionId, canonical(selected.profile), digest(selected.profile), acceptedAt]);
      await db.switchViews(client, selected, previous, selected.profile);
      return {schema: 'starforge.postgis-rollback-result.v1', projectId: profile.projectId, editionId,
        previousEditionId: previous.editionId, revision: expectedRevision + 1, acceptedAt,
        layers: await db.describeLayers(client, selected)};
    });
  }

  async function exportReceiving({operationId, directory: destination}) {
    id(operationId);
    need(typeof destination === 'string' && destination.length, 'POSTGIS_RECEIVING_DESTINATION_REQUIRED');
    const request = {schema: 'starforge.postgis-receiving-request.v1', operationId,
      projectId: profile.projectId, directory: resolve(destination)};
    const output = await claimDirectory(destination, request);
    let existing = null;
    try { existing = await openReceiving(output); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing) need(existing.manifest.operationId === operationId &&
      existing.manifest.projectId === profile.projectId && existing.manifest.requestSha256 === digest(request),
      'POSTGIS_EXISTING_RECEIVING_OPERATION_CHANGED');
    return db.mutate(operationId, 'export-receiving', request, async (client, current, requestSha256) => {
      if (existing) return {...existing, recoveredCompletedFile: true};
      let observation;
      try { observation = await readJSON(member(output, 'database-observation.json')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!observation) {
        need(current.activeEditionId, 'POSTGIS_ACCEPTED_EDITION_REQUIRED');
        const selected = await db.edition(client, current.activeEditionId);
        await db.lockTables(client, selected.layers.map(layer => layer.liveTable));
        observation = {schema: 'starforge.postgis-receiving-observation.v1',
          projectId: profile.projectId, operationId, requestSha256,
          editionId: selected.editionId, revision: current.revision, acceptedAt: current.updatedAt,
          observedAt: await currentTime(client), database: {
            profileId: selected.profile.database.profileId, name: db.environment.name,
            schema: db.environment.schema, postgresVersion: db.environment.postgresVersion,
            postgisVersion: db.environment.postgisVersion, metadataRelation: META.projects},
          source: selected.source, profile: selected.profile, layers: await db.describeLayers(client, selected)};
        // Freeze the actual complete native observation before any source copies.
        // A retry completes this original historical receipt even if later edits
        // or a successor exist. Each consumer independently checks currentness.
        await writeJSONOnce(member(output, 'database-observation.json'), observation);
      }
      need(observation.schema === 'starforge.postgis-receiving-observation.v1' &&
        observation.projectId === profile.projectId && observation.operationId === operationId &&
        observation.requestSha256 === requestSha256, 'POSTGIS_ORIGINAL_NATIVE_OBSERVATION_CHANGED');
      const retained = await db.edition(client, observation.editionId);
      need(canonical(retained.source) === canonical(observation.source) &&
        canonical(retained.profile) === canonical(observation.profile),
        'POSTGIS_RETAINED_EDITION_SOURCE_CHANGED');
      const original = await openRetainedSource(sourcePath(observation.source),
        observation.source.manifest.sha256, sourceOptions);
      const sourceRoot = member(output, 'source');
      await privateDirectory(sourceRoot);
      for (const record of [...original.manifest.files, original.manifestFile])
        await copyVerified(original.directory, sourceRoot, record);
      await writeJSONOnce(member(output, 'profile.json'), observation.profile);
      const sourceManifest = await fileRecord(member(output, 'source/vector-export.json'), 'source/vector-export.json');
      const mapping = await fileRecord(member(output, 'profile.json'), 'profile.json');
      const receipt = {schema: RECEIVING, projectId: profile.projectId, operationId, requestSha256,
        editionId: observation.editionId, revision: observation.revision, acceptedAt: observation.acceptedAt,
        observedAt: observation.observedAt, database: observation.database,
        source: {manifest: sourceManifest, captureSha256: observation.source.captureSha256,
          selectionSha256: observation.source.selectionSha256, sourceEdition: observation.source.sourceEdition,
          selectionId: observation.source.selectionId},
        mapping, layers: observation.layers,
        files: await listFiles(output, new Set(['postgis-receiving.json']))};
      await writeJSONOnce(member(output, 'postgis-receiving.json'), receipt);
      return openReceiving(output);
    });
  }

  async function exportBackup({operationId, directory: destination}) {
    return exportDatabaseBackup({db, profile, root, sourceOptions, operationId, directory: destination});
  }
  async function restoreBackup({operationId, directory: source, expectedManifestSha256}) {
    return restoreDatabaseBackup({db, profile, root, sourceOptions, operationId,
      directory: source, expectedManifestSha256});
  }
  return {inspect, stage, review, readRow, promote, rollback, exportReceiving, exportBackup, restoreBackup,
    close: () => db.close(), profile, directory: root};
}
