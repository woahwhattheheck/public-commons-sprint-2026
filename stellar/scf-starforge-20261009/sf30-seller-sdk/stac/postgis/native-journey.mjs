#!/usr/bin/env node
import {resolve, relative, dirname} from 'node:path';
import {readFile, link, unlink, lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {need, id, hash, integer, normalizeProfile, canonical, digest, sha256, qi, fieldParameter} from './contract.mjs';
import {claimDirectory, member, readJSON, writeJSONOnce, fileRecord, verifyFile, syncDirectory, openReceiving} from './files.mjs';
import {inspectCommittedOutput, requireAvailableOutput} from './operation-output.mjs';
import {connectionFile, runPostgisCommand} from './cli.mjs';
import {openPostgisIntake} from './index.mjs';
import {createDatabase} from './database.mjs';
import {verifyReceiving} from './verify.mjs';
import {openBackup} from './backup.mjs';
import {startOperator} from './operator.mjs';
import {identity as geoServerIdentity} from '../../postgres/publisher/files.mjs';

const EXPECTED = 'starforge.postgis-native-journey.v1';

export async function runNativeJourney(input, {progress = () => {}, signal, environment = process.env} = {}) {
  signal?.throwIfAborted();
  need(input?.schema === EXPECTED, 'POSTGIS_NATIVE_JOURNEY_REQUEST_REQUIRED');
  id(input.operationId); need(input.operationId.length <= 100, 'POSTGIS_NATIVE_OPERATION_ID_TOO_LONG');
  need(input.databaseUse === 'selected-native-demonstration-project',
    'POSTGIS_NATIVE_DEMONSTRATION_PROJECT_REQUIRED');
  const profile = normalizeProfile(input.profile), restoreProfile = normalizeProfile(input.restore.profile);
  need(profile.projectId === restoreProfile.projectId &&
    canonical(profile.database) !== canonical(restoreProfile.database),
    'POSTGIS_NATIVE_INDEPENDENT_RESTORE_DATABASE_REQUIRED');
  for (const source of [input.sources.baseline, input.sources.successor]) {
    need(typeof source.directory === 'string' && source.directory.length, 'POSTGIS_NATIVE_ORIGINAL_SOURCE_REQUIRED');
    hash(source.expectedManifestSha256);
  }
  need(input.sources.baseline.expectedManifestSha256 !== input.sources.successor.expectedManifestSha256,
    'POSTGIS_NATIVE_DISTINCT_ORIGINAL_SOURCE_EDITIONS_REQUIRED');
  need(Array.isArray(input.customerEdits) && input.customerEdits.length > 0 &&
    typeof input.customerEditRole === 'string', 'POSTGIS_NATIVE_CUSTOMER_EDITS_REQUIRED');
  need(Array.isArray(input.readers) && input.readers.length > 0 &&
    Array.isArray(input.restore.readers) && input.restore.readers.length > 0,
    'POSTGIS_NATIVE_INDEPENDENT_READER_PROFILES_REQUIRED');
  integer(input.expectedConflicts ?? 1, 'expectedConflicts', 1);
  const root = await claimDirectory(input.directory, input);
  const originalConnection = await connectionFile(input.connectionFile);
  const targetConnection = await connectionFile(input.restore.connectionFile);
  const op = name => input.operationId + ':' + name;
  const state = {};
  const geoServerOperationId = 'postgis-geoserver-' + sha256(input.operationId).slice(0,40);
  function geoServerHandoff(receiving) {
    const selected = input.geoserver;
    need(selected && typeof selected === 'object' && !Array.isArray(selected) &&
      Object.keys(selected).every(key => ['profileFile', 'readerFile', 'expectedProfileSha256',
        'expectedReaderSha256', 'request', 'cycle', 'browser'].includes(key)),
      'POSTGIS_NATIVE_GEOSERVER_CONFIGURATION_REQUIRED');
    need(/^[a-f0-9]{40}$/.test(input.sourceHead || ''), 'POSTGIS_NATIVE_GEOSERVER_SOURCE_HEAD_REQUIRED');
    const request = selected.request;
    need(request && typeof request === 'object' && !Array.isArray(request) &&
      Object.keys(request).every(key => ['operationId', 'kind', 'expectedPublication', 'layers'].includes(key)) &&
      Object.hasOwn(request, 'expectedPublication') && Array.isArray(request.layers) && request.layers.length > 0,
      'POSTGIS_NATIVE_GEOSERVER_ORIGINAL_REQUEST_REQUIRED');
    need(new Set(request.layers.map(layer => layer.layerId)).size === request.layers.length &&
      request.layers.every(layer => profile.layers.some(original => original.id === layer.layerId)),
      'POSTGIS_NATIVE_GEOSERVER_ACCEPTED_LAYER_REQUIRED');
    return {schema: 'starforge.geoserver-native-handoff.v1', operationId: geoServerOperationId,
      parentOperationId: input.operationId, sourceHead: input.sourceHead,
      directory: member(root, 'geoserver/output'), workspaceDirectory: member(root, 'geoserver/workspace'),
      profileFile: selected.profileFile, readerFile: selected.readerFile,
      expectedProfileSha256: selected.expectedProfileSha256, expectedReaderSha256: selected.expectedReaderSha256,
      request: {...request, receivingDirectory: receiving.directory,
        manifestSha256: receiving.manifestFile.sha256},
      ...(selected.cycle === undefined ? {} : {cycle: selected.cycle}),
      ...(selected.browser === undefined ? {} : {browser: selected.browser})};
  }
  async function validateFrozenExport(kind, value) {
    const artifact = await inspectCommittedOutput({kind, projectId: profile.projectId,
      operationId: value.operationId, requestSha256: value.requestSha256,
      directory: value.directory, manifestFile: value.manifestFile}, kind === 'receiving' ? openReceiving : openBackup);
    requireAvailableOutput(artifact, value.operationId);
  }
  async function validateQgisFiles(value) {
    await verifyFile(root, value.handoff); await verifyFile(root, value.resultFile);
    const handoff = await readJSON(member(root, value.handoff.path));
    const result = await readJSON(member(root, value.resultFile.path));
    need(canonical(result) === canonical(value.result) &&
      result.schema === 'starforge.postgis-qgis-native-result.v1' &&
      result.operationId === op('qgis-receiving') && result.operationId === handoff.operationId &&
      result.state === 'complete' && result.sourceId === handoff.expectedManifestSha256 &&
      result.noDatabaseMutation === true, 'POSTGIS_NATIVE_QGIS_ORIGINAL_RESULT_REQUIRED');
    const output = member(root, 'qgis/output');
    need(result.completePackage?.path === member(output, 'Starforge_PostGIS_QGIS_Complete_Project.zip'),
      'POSTGIS_NATIVE_QGIS_PACKAGE_PATH_CHANGED');
    await verifyFile(output, {...result.completePackage, path: 'Starforge_PostGIS_QGIS_Complete_Project.zip'});
    for (const image of result.images || []) if (image.file) {
      need(['PostGIS_QGIS_Received_Map.png', 'PostGIS_QGIS_Reopened_Map.png'].includes(image.file.path),
        'POSTGIS_NATIVE_QGIS_IMAGE_PATH_CHANGED');
      await verifyFile(output, image.file);
    }
    const observationPrefix = 'operation-' + sha256(handoff.operationId).slice(0, 32) + '/native-observations/';
    for (const observed of result.nativeObservations || []) {
      need(typeof observed.path === 'string' && observed.path.startsWith(observationPrefix) &&
        /^(?:original|received)-native-(?:reopen|refresh)-[a-f0-9]{64}\.json$/.test(observed.path.slice(observationPrefix.length)),
        'POSTGIS_NATIVE_QGIS_OBSERVATION_PATH_CHANGED');
      await verifyFile(output, observed);
    }
  }
  async function validateGeoServerFiles(value) {
    need(value?.handoff?.path === 'geoserver-handoff.json' &&
      value?.resultFile?.path === 'geoserver/output/geoserver-native-result.json',
      'POSTGIS_NATIVE_GEOSERVER_RESULT_PATH_CHANGED');
    await verifyFile(root, value.handoff, {signal});
    await verifyFile(root, value.resultFile, {signal});
    const handoff = await readJSON(member(root, value.handoff.path), {signal});
    const result = await readJSON(member(root, value.resultFile.path), {signal});
    const receiving = state['receive-current'];
    need(receiving && canonical(handoff) === canonical(geoServerHandoff(receiving)),
      'POSTGIS_NATIVE_GEOSERVER_HANDOFF_CHANGED');
    need(canonical(result) === canonical(value.result) &&
      result.schema === 'starforge.geoserver-native-result.v1' && result.state === 'complete' &&
      result.operationId === geoServerOperationId && result.parentOperationId === input.operationId &&
      result.requestSha256 === geoServerIdentity(handoff) && result.sourceHead === input.sourceHead &&
      result.projectId === profile.projectId &&
      result.postgis?.editionId === receiving.manifest.editionId &&
      result.postgis?.revision === receiving.manifest.revision,
      'POSTGIS_NATIVE_GEOSERVER_ORIGINAL_RESULT_REQUIRED');
    const output = member(root, 'geoserver/output');
    need(Array.isArray(result.files) && Array.isArray(result.exports) && result.exports.length > 0,
      'POSTGIS_NATIVE_GEOSERVER_COMPLETE_FILES_REQUIRED');
    const paths = new Set();
    for (const file of result.files) {
      need(!paths.has(file.path), 'POSTGIS_NATIVE_GEOSERVER_DUPLICATE_FILE');
      paths.add(file.path); await verifyFile(output, file, {signal});
    }
    const {inspectGeoServerReceiving} = await import('./geoserver/handover.mjs');
    const names = new Set();
    for (const exported of result.exports) {
      need(['publication', 'rollback', 'refresh'].includes(exported.name) && !names.has(exported.name) &&
        exported.directory === member(output, 'exports/' + exported.name) &&
        exported.archive?.path === member(output, 'archives/' + exported.name + '.zip') &&
        exported.projectId === profile.projectId &&
        exported.postgis?.editionId === receiving.manifest.editionId &&
        exported.postgis?.revision === receiving.manifest.revision,
        'POSTGIS_NATIVE_GEOSERVER_EXPORT_CHANGED');
      names.add(exported.name);
      const opened = await inspectGeoServerReceiving(exported.directory,
        {expectedManifestSha256: exported.manifestSha256, signal});
      need(opened.operation.id === exported.operationId &&
        opened.manifest.postgisManifestSha256 === receiving.manifestFile.sha256,
        'POSTGIS_NATIVE_GEOSERVER_EXPORTED_ORIGINAL_CHANGED');
      await verifyFile(output, {...exported.archive, path: 'archives/' + exported.name + '.zip'}, {signal});
    }
    need(names.has('publication') &&
      (handoff.cycle ? names.has('refresh') &&
        result.finalPublication === handoff.cycle.refreshOperationId :
        result.finalPublication === handoff.request.operationId),
      'POSTGIS_NATIVE_GEOSERVER_PUBLICATION_CYCLE_CHANGED');
  }
  async function validatePhaseArtifacts(name, value) {
    if (['receive-successor', 'receive-current', 'receive-restored-project'].includes(name))
      await validateFrozenExport('receiving', value);
    else if (['backup-complete-original', 'backup-restored-project'].includes(name))
      await validateFrozenExport('backup', value);
    else if (name === 'operator-browser-receiving') {
      if (value.screenshot) await verifyFile(root, value.screenshot);
      if (value.restoredScreenshot) await verifyFile(root, value.restoredScreenshot);
    }
    else if (name === 'qgis-complete-receiving') await validateQgisFiles(value);
    else if (name === 'geoserver-complete-receiving') await validateGeoServerFiles(value);
  }

  // This demonstration temporarily withholds one exact exported member. The
  // create-only plan and same-inode held copy restore it after interruption,
  // before any cached export phase is read. No database/source is regenerated.
  async function restoreHeldMember(kind) {
    const directory = member(root, 'recovery-checks/' + kind);
    let plan;
    try { plan = await readJSON(member(directory, 'request.json')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    need(plan.schema === 'starforge.postgis-native-output-check.v1' &&
      plan.operationId === input.operationId && plan.originalRequestSha256 === digest(input) &&
      plan.kind === kind && ['receiving', 'backup'].includes(kind),
      'POSTGIS_NATIVE_OUTPUT_CHECK_CHANGED');
    const target = member(root, plan.original.path), held = member(directory, 'held-original');
    const heldRecord = {...plan.original, path: 'held-original'};
    let heldExists = false;
    try { await verifyFile(directory, heldRecord); heldExists = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (heldExists) {
      try { await link(held, target); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      await verifyFile(root, plan.original);
      await syncDirectory(dirname(target));
      await unlink(held);
      await syncDirectory(directory);
    } else await verifyFile(root, plan.original);
    return plan;
  }
  await restoreHeldMember('receiving'); await restoreHeldMember('backup');

  async function step(name, fn) {
    signal?.throwIfAborted();
    const path = member(root, 'phases/' + name + '.json');
    let result;
    try { result = await readJSON(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!result) {
      await progress({phase: name, state: 'running'});
      signal?.throwIfAborted();
      const value = await fn();
      // A stop drains this original phase and retains its committed result before
      // preventing the next phase. It does not close a pool under an active write.
      result = {schema: 'starforge.postgis-native-phase.v1', operationId: input.operationId,
        phase: name, originalRequestSha256: digest(input), result: value};
      await writeJSONOnce(path, result);
    }
    need(result.schema === 'starforge.postgis-native-phase.v1' && result.operationId === input.operationId &&
      result.phase === name && result.originalRequestSha256 === digest(input), 'POSTGIS_NATIVE_ORIGINAL_PHASE_CHANGED', name);
    await validatePhaseArtifacts(name, result.result);
    state[name] = result.result;
    await progress({phase: name, state: 'complete'});
    signal?.throwIfAborted();
    return result.result;
  }
  let intake, restored, publisher, completedResult;
  async function customerEdit(name, edits) {
    return publisher.mutate(op(name), 'native-customer-edit',
      {schema: 'starforge.postgis-native-customer-edit.v1', operationId: op(name),
        projectId: profile.projectId, role: input.customerEditRole, edits},
      async (client, current) => {
        const observations = [];
        need(current.activeEditionId, 'POSTGIS_NATIVE_CUSTOMER_ACTIVE_EDITION_REQUIRED');
        try {
          await client.query('SET LOCAL ROLE ' + qi(input.customerEditRole));
          for (const edit of edits) {
            const layer = profile.layers.find(item => item.id === edit.layerId);
            need(layer && layer.roles.some(role => role.name === input.customerEditRole &&
              role.permissions.includes('update')), 'POSTGIS_NATIVE_CUSTOMER_ROLE_NOT_MAPPED');
            need(typeof edit.rowKey === 'string' && edit.values && typeof edit.values === 'object' &&
              !Array.isArray(edit.values) && Object.keys(edit.values).length > 0,
              'POSTGIS_NATIVE_CUSTOMER_EDIT_INVALID');
            const parameters = [], assignments = [];
            for (const [name, value] of Object.entries(edit.values)) {
              const field = layer.fields.find(item => item.name === name);
              need(field, 'POSTGIS_NATIVE_CUSTOMER_FIELD_NOT_MAPPED', name);
              const sourceField = {...field, sourceName: name};
              parameters.push(fieldParameter(value, true, sourceField));
              assignments.push(qi(name) + '=$' + parameters.length + '::' + field.type);
            }
            parameters.push(edit.rowKey);
            const changed = (await client.query('UPDATE ' + publisher.q(layer.relation) + ' SET ' + assignments.join(',') +
              ' WHERE sf_key=$' + parameters.length + ' RETURNING sf_id::text,sf_key', parameters)).rows;
            need(changed.length === 1, 'POSTGIS_NATIVE_CUSTOMER_EDIT_COVERAGE_CHANGED', edit.rowKey);
            observations.push({layerId: layer.id, ...changed[0]});
          }
        } finally { await client.query('SET LOCAL ROLE NONE'); }
        return {schema: 'starforge.postgis-native-customer-edit-result.v1', projectId: profile.projectId,
          editionId: current.activeEditionId, revision: current.revision, role: input.customerEditRole,
          rows: observations};
      });
  }
  async function verifyReaders(readers, receiving) {
    const results = [];
    for (const reader of readers) {
      const result = await verifyReceiving({connection: await connectionFile(reader.connectionFile),
        directory: receiving.directory, expectedManifestSha256: receiving.manifestFile.sha256,
        role: reader.role, layerIds: reader.layerIds, signal});
      results.push({current: result.current, selection: result.selection, observations: result.observations});
    }
    return results;
  }
  let primaryError;
  try {
    signal?.throwIfAborted();
    intake = await openPostgisIntake({connection: originalConnection, profile,
      directory: member(root, 'original-workspace'), python: input.python});
    signal?.throwIfAborted();
    publisher = await createDatabase(originalConnection, profile);
    signal?.throwIfAborted();
    await step('initial-native-state', async () => {
      const observed = await intake.inspect();
      need(!observed.initialized || observed.revision === 0 && !observed.activeEditionId &&
        observed.editions.length === 0, 'POSTGIS_NATIVE_EMPTY_DEMONSTRATION_PROJECT_REQUIRED');
      return observed;
    });
    const firstStage = await step('stage-original', () => intake.stage({operationId: op('stage-original'),
      sourceDirectory: input.sources.baseline.directory,
      expectedManifestSha256: input.sources.baseline.expectedManifestSha256}));
    const firstReview = await step('review-original', () => intake.review({editionId: firstStage.editionId}));
    const firstPublished = await step('publish-original', () => intake.promote({operationId: op('publish-original'),
      editionId: firstStage.editionId, expectedRevision: firstReview.expectedRevision,
      reviewSha256: firstReview.reviewSha256, decisions: []}));
    await step('edit-customer-values', () => customerEdit('edit-customer-values', input.customerEdits));
    const secondStage = await step('stage-successor', () => intake.stage({operationId: op('stage-successor'),
      sourceDirectory: input.sources.successor.directory,
      expectedManifestSha256: input.sources.successor.expectedManifestSha256}));
    const secondReview = await step('review-successor', async () => {
      const result = await intake.review({editionId: secondStage.editionId});
      need(result.changes.filter(row => row.conflict).length >= (input.expectedConflicts ?? 1),
        'POSTGIS_NATIVE_REVIEW_CONFLICT_NOT_REPRODUCED');
      const compared = [];
      for (const row of result.changes.filter(row => row.conflict))
        compared.push(await intake.readRow({editionId: secondStage.editionId, layerId: row.layerId, rowKey: row.rowKey}));
      return {...result, comparedRows: compared};
    });
    // Retain the actual selected resolution for each native conflict. The default
    // demonstrates preserving existing customer work while source-only changes
    // follow the incoming edition.
    const choices = input.decisions || secondReview.changes.filter(row => row.conflict)
      .map(row => ({layerId: row.layerId, rowKey: row.rowKey, choice: 'keep-current'}));
    const secondPublished = await step('publish-successor', () => intake.promote({
      operationId: op('publish-successor'), editionId: secondStage.editionId,
      expectedRevision: secondReview.expectedRevision, reviewSha256: secondReview.reviewSha256, decisions: choices}));
    await step('reopen-current-project', async () => {
      await intake.close();
      intake = await openPostgisIntake({connection: originalConnection, profile,
        directory: member(root, 'original-workspace'), python: input.python});
      const observed = await intake.inspect();
      need(observed.activeEditionId === secondPublished.editionId && observed.revision === secondPublished.revision,
        'POSTGIS_NATIVE_REOPEN_CHANGED');
      return observed;
    });
    const secondReceiving = await step('receive-successor', () => intake.exportReceiving({
      operationId: op('receive-successor'), directory: member(root, 'receiving/successor')}));
    await step('read-successor-roles', () => verifyReaders(input.readers, secondReceiving));
    const firstRollback = await step('rollback-original', () => intake.rollback({
      operationId: op('rollback-original'), editionId: firstPublished.editionId, expectedRevision: secondPublished.revision}));
    await step('reject-stale-receiving', async () => {
      const reader = input.readers[0];
      try {
        await verifyReceiving({connection: await connectionFile(reader.connectionFile),
          directory: secondReceiving.directory, expectedManifestSha256: secondReceiving.manifestFile.sha256,
          role: reader.role, layerIds: reader.layerIds});
      } catch (error) {
        need(error.code === 'POSTGIS_RECEIVING_EDITION_CHANGED', 'POSTGIS_NATIVE_WRONG_STALE_RESULT', error.code);
        return {operation: 'original-successor-receiving', rejected: true, code: error.code,
          expectedOldRevision: secondReceiving.manifest.revision, currentRevision: firstRollback.revision};
      }
      need(false, 'POSTGIS_NATIVE_STALE_RECEIVING_WAS_ACCEPTED');
    });
    const successorRollback = await step('return-successor', () => intake.rollback({
      operationId: op('return-successor'), editionId: secondPublished.editionId, expectedRevision: firstRollback.revision}));
    const currentReceiving = await step('receive-current', () => intake.exportReceiving({
      operationId: op('receive-current'), directory: member(root, 'receiving/current')}));
    await step('read-current-roles', () => verifyReaders(input.readers, currentReceiving));
    const backup = await step('backup-complete-original', () => intake.exportBackup({
      operationId: op('backup-complete-original'), directory: member(root, 'backup/original')}));
    await step('read-complete-backup', async () => {
      const read = await openBackup(backup.directory, backup.manifestFile.sha256);
      return {manifest: read.manifestFile, projectId: read.manifest.projectId, revision: read.manifest.revision,
        completeTables: read.manifest.tables, completeSources: read.manifest.sources,
        originalOperations: read.metadata.operations.length};
    });
    restored = await openPostgisIntake({connection: targetConnection, profile: restoreProfile,
      directory: member(root, 'restored-workspace'), python: input.python});
    const restore = await step('restore-independent-project', () => restored.restoreBackup({
      operationId: op('restore-independent-project'), directory: backup.directory,
      expectedManifestSha256: backup.manifestFile.sha256}));
    need(restore.revision === successorRollback.revision && restore.editionId === secondPublished.editionId,
      'POSTGIS_NATIVE_RESTORED_ACTIVE_EDITION_CHANGED');
    const restoredReceiving = await step('receive-restored-project', () => restored.exportReceiving({
      operationId: op('receive-restored-project'), directory: member(root, 'receiving/restored')}));
    await step('read-restored-roles', () => verifyReaders(input.restore.readers, restoredReceiving));
    const restoredBackup = await step('backup-restored-project', () => restored.exportBackup({
      operationId: op('backup-restored-project'), directory: member(root, 'backup/restored')}));
    await step('compare-complete-restored-values', async () => {
      const originalRead = await openBackup(backup.directory, backup.manifestFile.sha256);
      const targetRead = await openBackup(restoredBackup.directory, restoredBackup.manifestFile.sha256);
      const logicalTables = manifest => manifest.tables.map(({editionId, layerId, kind, rowCount, rowSha256}) =>
        ({editionId, layerId, kind, rowCount, rowSha256})).sort((a, b) =>
          canonical([a.editionId, a.layerId, a.kind]).localeCompare(canonical([b.editionId, b.layerId, b.kind]), 'en'));
      const expected = logicalTables(originalRead.manifest), actual = logicalTables(targetRead.manifest);
      need(canonical(expected) === canonical(actual), 'POSTGIS_NATIVE_FULL_RESTORED_TABLES_CHANGED');
      need(canonical(originalRead.manifest.sources) === canonical(targetRead.manifest.sources) &&
        originalRead.manifest.identities.file.sha256 === targetRead.manifest.identities.file.sha256 &&
        originalRead.manifest.identities.rowCount === targetRead.manifest.identities.rowCount,
        'POSTGIS_NATIVE_FULL_RESTORED_ORIGINALS_CHANGED');
      return {allRetainedNativeTablesMatch: true, allOriginalSourcesMatch: true, allStableSourceIdentitiesMatch: true,
        tables: actual, sourceManifest: originalRead.manifestFile, restoredManifest: targetRead.manifestFile};
    });
    await step('recover-restored-original-operations', async () => {
      const before = await restored.operationHistory({limit: 1}), recovered = [];
      for (const name of ['stage-successor', 'publish-successor', 'return-successor']) {
        const original = await intake.recoverOperation({operationId: op(name)});
        const target = await restored.recoverOperation({operationId: op(name)});
        need(target.state === 'committed' && target.executed === false && target.profileChanged === true &&
          canonical(target.original) === canonical(original.original) &&
          target.current.project.profileSha256 === digest(restoreProfile) &&
          target.current.project.revision === successorRollback.revision &&
          target.current.database.name === restoreProfile.database.name &&
          target.current.database.schema === restoreProfile.database.schema,
          'POSTGIS_NATIVE_RESTORED_OPERATION_RECOVERY_CHANGED', op(name));
        recovered.push({operationId: target.operationId, kind: target.original.kind,
          requestSha256: target.original.requestSha256, originalResultSha256: digest(target.original.result),
          originalProfileSha256: target.originalProfileSha256,
          destinationProfileSha256: target.current.project.profileSha256,
          executed: target.executed, originalRequestAndResultPreserved: true});
      }
      const cli = await runPostgisCommand(['recover-operation',
        '--connection', input.restore.connectionFile,
        '--profile', member(root, 'restored-workspace/profiles/' + digest(restoreProfile) + '.json'),
        '--workspace', member(root, 'restored-workspace'),
        '--operation', op('publish-successor')]);
      const originalPublication = await intake.recoverOperation({operationId: op('publish-successor')});
      need(cli.executed === false && cli.profileChanged === true &&
        canonical(cli.original) === canonical(originalPublication.original) &&
        cli.current.database.name === restoreProfile.database.name,
        'POSTGIS_NATIVE_CLI_RESTORED_RECOVERY_CHANGED');
      const after = await restored.operationHistory({limit: 1});
      need(before.total === after.total && before.revision === after.revision,
        'POSTGIS_NATIVE_READ_RECOVERY_MUTATED_PROJECT');
      return {readOnly: true, restoredDatabase: restoreProfile.database,
        originalOperations: recovered, cli: {operationId: cli.operationId, executed: cli.executed,
          originalRequestSha256: cli.original.requestSha256, destinationDatabase: cli.current.database},
        operationCount: after.total, revision: after.revision};
    });
    await step('verify-unavailable-committed-exports', async () => {
      const results = [];
      for (const [kind, value, selected] of [
        ['receiving', currentReceiving, currentReceiving.manifest.mapping],
        ['backup', backup, backup.manifest.metadata]]) {
        const original = await intake.recoverOperation({operationId: value.operationId});
        need(original.artifact?.state === 'available', 'POSTGIS_NATIVE_ORIGINAL_EXPORT_UNAVAILABLE');
        const originalPath = member(value.directory, selected.path);
        const record = await fileRecord(originalPath, relative(root, originalPath));
        const plan = {schema: 'starforge.postgis-native-output-check.v1', operationId: input.operationId,
          originalRequestSha256: digest(input), kind, original: record,
          exportOperationId: value.operationId, exportRequestSha256: value.requestSha256};
        const checkDirectory = await claimDirectory(member(root, 'recovery-checks/' + kind), plan);
        const held = member(checkDirectory, 'held-original');
        await link(originalPath, held);
        await verifyFile(checkDirectory, {...record, path: 'held-original'});
        await syncDirectory(checkDirectory);
        let observation;
        try {
          await unlink(originalPath);
          await syncDirectory(dirname(originalPath));
          const unavailable = await intake.recoverOperation({operationId: value.operationId});
          need(unavailable.artifact?.state === 'unavailable' && unavailable.executed === false &&
            canonical(unavailable.original) === canonical(original.original),
            'POSTGIS_NATIVE_MISSING_EXPORT_RECOVERY_CHANGED');
          let failure;
          try {
            if (kind === 'receiving') await intake.exportReceiving({operationId: value.operationId, directory: value.directory});
            else await intake.exportBackup({operationId: value.operationId, directory: value.directory});
          } catch (error) { failure = error; }
          need(failure?.code === 'POSTGIS_COMMITTED_EXPORT_UNAVAILABLE' &&
            failure.operationId === value.operationId &&
            failure.postgisCommitOutcome === 'committed-output-unavailable',
            'POSTGIS_NATIVE_MISSING_COMMITTED_EXPORT_ACCEPTED');
          let recreated = false;
          try { await lstat(originalPath); recreated = true; }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          need(!recreated, 'POSTGIS_NATIVE_ORIGINAL_EXPORT_WAS_REGENERATED');
          observation = {kind, operationId: value.operationId, state: unavailable.artifact.state,
            rejectedCode: failure.code, originalRequestSha256: original.original.requestSha256,
            originalResultSha256: digest(original.original.result), regenerated: false, member: record};
        } finally { await restoreHeldMember(kind); }
        const available = await intake.recoverOperation({operationId: value.operationId});
        need(available.artifact?.state === 'available' &&
          canonical(available.original) === canonical(original.original),
          'POSTGIS_NATIVE_HELD_ORIGINAL_EXPORT_CHANGED');
        results.push({...observation, originalFilesRestored: true,
          manifestFile: available.artifact.manifestFile});
      }
      return {originalOperationsPreserved: true, currentSnapshotNotCreated: true, exports: results};
    });
    await step('continue-original-publication', async () => {
      const replay = await intake.promote({operationId: op('publish-successor'), editionId: secondStage.editionId,
        expectedRevision: secondReview.expectedRevision, reviewSha256: secondReview.reviewSha256, decisions: choices});
      need(replay.replayed === true && replay.editionId === secondPublished.editionId &&
        replay.current.revision === successorRollback.revision, 'POSTGIS_NATIVE_ORIGINAL_OPERATION_REPLAY_CHANGED');
      return {replayed: replay.replayed, operationId: replay.operationId, originalRevision: replay.revision,
        currentRevision: replay.current.revision, editionId: replay.editionId};
    });
    if (input.playwrightModule && input.chromiumExecutable) await step('operator-browser-receiving', async () => {
      const playwright = await import(input.playwrightModule);
      const server = await startOperator({connection: originalConnection, profile,
        directory: member(root, 'original-workspace'), python: input.python, port: 0, handleSignals: false});
      let browser, restoredServer;
      try {
        browser = await playwright.chromium.launch({headless: true, executablePath: input.chromiumExecutable,
          args: ['--disable-dev-shm-usage']});
        const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
        const failures = [];
        page.on('pageerror', error => failures.push(error.message));
        await page.goto(server.url, {waitUntil: 'networkidle'});
        await page.locator('#project-label').filter({hasText: profile.projectId}).waitFor();
        need(await page.locator('#layers tr').count() === profile.layers.length,
          'POSTGIS_NATIVE_OPERATOR_LAYER_COVERAGE_CHANGED');
        const displayed = await page.locator('#facts').innerText();
        need(displayed.includes(secondPublished.editionId), 'POSTGIS_NATIVE_OPERATOR_EDITION_CHANGED');
        await page.locator('[data-show="history"]').click();
        await page.locator('#operations button').first().waitFor();
        await page.locator('#operations button').first().click();
        need((await page.locator('#operation-detail').innerText()).includes('operationId'),
          'POSTGIS_NATIVE_OPERATOR_ORIGINAL_RESULT_MISSING');
        await page.locator('[data-show="source"]').click();
        await page.locator('#source-form [name="sourceDirectory"]').fill(input.sources.successor.directory);
        await page.locator('#source-form [name="expectedManifestSha256"]').fill(input.sources.successor.expectedManifestSha256);
        await page.locator('#source-form button[value="inspect"]').click();
        await page.locator('#status').filter({hasText: 'Original source and native export inspected.'}).waitFor({timeout: 120000});
        await page.locator('[data-show="overview"]').click();
        const screenshot = member(root, 'operator-current.png');
        await page.screenshot({path: screenshot, fullPage: true});
        need(failures.length === 0, 'POSTGIS_NATIVE_OPERATOR_BROWSER_ERROR', failures);
        const beforeRecovery = await restored.operationHistory({limit: 1});
        await server.close();
        restoredServer = await startOperator({connection: targetConnection, profile: restoreProfile,
          directory: member(root, 'restored-workspace'), python: input.python, port: 0, handleSignals: false});
        await page.goto(restoredServer.url, {waitUntil: 'networkidle'});
        await page.locator('#project-label').filter({hasText: profile.projectId}).waitFor();
        await page.locator('[data-show="history"]').click();
        await page.locator('#operation-recovery-id').fill(op('publish-successor'));
        await page.locator('#operation-recovery-form button[type="submit"]').click();
        await page.locator('#committed-recovery-status').filter({
          hasText: 'Original result recovered. No operation was executed.'}).waitFor();
        const originalRequest = await page.locator('#recovered-original-request').innerText();
        const originalResult = await page.locator('#recovered-original-result').innerText();
        const currentProject = await page.locator('#recovered-current').innerText();
        need(originalRequest.includes(op('publish-successor')) && originalRequest.includes(digest(profile)) &&
          originalResult.includes(secondPublished.requestSha256) &&
          currentProject.includes(restoreProfile.database.name) && currentProject.includes(digest(restoreProfile)),
          'POSTGIS_NATIVE_OPERATOR_RESTORED_RECOVERY_CHANGED');
        const afterRecovery = await restored.operationHistory({limit: 1});
        need(beforeRecovery.total === afterRecovery.total && beforeRecovery.revision === afterRecovery.revision,
          'POSTGIS_NATIVE_OPERATOR_RECOVERY_EXECUTED_COMMAND');
        const restoredScreenshot = member(root, 'operator-restored-recovery.png');
        await page.screenshot({path: restoredScreenshot, fullPage: true});
        need(failures.length === 0, 'POSTGIS_NATIVE_OPERATOR_BROWSER_ERROR', failures);
        return {nativeBrowser: await browser.version(), originalProject: profile.projectId,
          currentEditionId: secondPublished.editionId, nativeSourceInspected: true,
          screenshot: await fileRecord(screenshot, 'operator-current.png'),
          restoredScreenshot: await fileRecord(restoredScreenshot, 'operator-restored-recovery.png'),
          originalOperationRecovery: {operationId: op('publish-successor'), executed: false,
            originalRequestSha256: secondPublished.requestSha256,
            destinationDatabase: restoreProfile.database, operationCount: afterRecovery.total}};
      } finally {
        let failure;
        try { if (browser) await browser.close(); } catch (error) { failure = error; }
        try { await server.close(); } catch (error) { failure ||= error; }
        try { if (restoredServer) await restoredServer.close(); } catch (error) { failure ||= error; }
        if (failure) throw failure;
      }
    });
    if (input.qgis) await step('qgis-complete-receiving', async () => {
      need(typeof input.qgis.python === 'string' && input.qgis.python.length &&
        typeof input.qgis.actor === 'string' && input.qgis.actor.length &&
        input.qgis.connection?.allowEditing === false,
        'POSTGIS_NATIVE_QGIS_RECEIVING_PROFILE_REQUIRED');
      // Release producer pools before this same operation's independent desktop
      // receiving. Each pool has one idempotent close owner.
      await intake.close(); if (restored) await restored.close(); await publisher.close();
      const handoff = {schema: 'starforge.postgis-qgis-native-handoff.v1',
        operationId: op('qgis-receiving'), actor: input.qgis.actor,
        title: input.qgis.title || profile.projectId,
        applicationDirectory: fileURLToPath(new URL('../../', import.meta.url)),
        sourceDirectory: currentReceiving.directory,
        expectedManifestSha256: currentReceiving.manifestFile.sha256,
        layerIds: input.qgis.layerIds, connection: input.qgis.connection,
        workspaceDirectory: member(root, 'qgis/workspace'),
        receivingDirectory: member(root, 'qgis/received'),
        outputDirectory: member(root, 'qgis/output'),
        qgisProfileDirectory: input.qgis.qgisProfileDirectory,
        projectCrs: input.qgis.projectCrs ?? null,
        requireUnchangedRows: true,
        ...(input.sourceHead ? {sourceHead: input.sourceHead} : {})};
      const handoffPath = member(root, 'qgis-handoff.json');
      await writeJSONOnce(handoffPath, handoff);
      const args = [fileURLToPath(new URL('./qgis/examples/receive_project.py', import.meta.url)),
        '--handoff', handoffPath];
      if (input.qgis.qgisPrefix) args.push('--qgis-prefix', input.qgis.qgisPrefix);
      signal?.throwIfAborted();
      await new Promise((resolveNative, rejectNative) => {
        const grouped = process.platform !== 'win32';
        const child = spawn(input.qgis.python, args, {stdio: ['ignore', 'ignore', 'pipe'],
          env: {...environment}, detached: grouped});
        let stderr = '', spawnError, closeError, killTimer, nativeClosed = false;
        function killNative(value) {
          if (!child.pid || nativeClosed) return;
          try { if (grouped) process.kill(-child.pid, value); else child.kill(value); }
          catch (error) { if (error.code !== 'ESRCH') closeError ||= error; }
        }
        const stopNative = () => {
          killNative('SIGTERM');
          killTimer ||= setTimeout(() => killNative('SIGKILL'), 10000);
        };
        signal?.addEventListener('abort', stopNative, {once: true});
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', part => { if (stderr.length < 16384) stderr += part.slice(0, 16384 - stderr.length); });
        child.on('error', error => { spawnError = error; });
        // Only close establishes that the original child and its stdio drained.
        // SIGINT/SIGTERM never reject early while this process still owns it.
        child.once('close', (code, stoppedBy) => {
          nativeClosed = true;
          signal?.removeEventListener('abort', stopNative);
          clearTimeout(killTimer);
          if (signal?.aborted) { rejectNative(signal.reason); return; }
          if (spawnError || closeError) { rejectNative(spawnError || closeError); return; }
          if (code !== 0) {
            rejectNative(Object.assign(new Error('POSTGIS_NATIVE_QGIS_RECEIVING_FAILED'),
              {code: 'POSTGIS_NATIVE_QGIS_RECEIVING_FAILED',
                detail: {exitCode: code, signal: stoppedBy, nativeError: stderr}}));
          } else resolveNative();
        });
        if (signal?.aborted) stopNative();
      });
      const resultPath = member(root, 'qgis/output/qgis-native-result.json');
      const result = await readJSON(resultPath);
      need(result.schema === 'starforge.postgis-qgis-native-result.v1' &&
        result.operationId === handoff.operationId && result.state === 'complete' &&
        result.acceptedEditionId === currentReceiving.manifest.editionId &&
        result.databaseRevision === currentReceiving.manifest.revision &&
        result.noDatabaseMutation === true, 'POSTGIS_NATIVE_QGIS_ORIGINAL_RESULT_REQUIRED');
      return {handoff: await fileRecord(handoffPath, 'qgis-handoff.json'),
        resultFile: await fileRecord(resultPath, 'qgis/output/qgis-native-result.json'), result};
    });
    if (input.geoserver) await step('geoserver-complete-receiving', async () => {
      // This one service continuation uses the final accepted database epoch.
      // Its optional service rollback/refresh does not repeat a database phase.
      await intake.close(); if (restored) await restored.close(); await publisher.close();
      signal?.throwIfAborted();
      const handoff = geoServerHandoff(currentReceiving);
      const handoffPath = member(root, 'geoserver-handoff.json');
      await writeJSONOnce(handoffPath, handoff);
      await syncDirectory(root);
      const {runGeoServerNativeReceiving} = await import('./geoserver/native-receiving.mjs');
      const returned = await runGeoServerNativeReceiving(handoff, {environment, signal,
        processSignals: false, progress: value => progress({phase: 'geoserver/' + value.phase,
          state: value.state, childOperationId: value.operationId})});
      const resultPath = member(root, 'geoserver/output/geoserver-native-result.json');
      const result = await readJSON(resultPath, {signal});
      need(canonical(result) === canonical(returned), 'POSTGIS_NATIVE_GEOSERVER_SAVED_RESULT_CHANGED');
      return {handoff: await fileRecord(handoffPath, 'geoserver-handoff.json', {signal}),
        resultFile: await fileRecord(resultPath, 'geoserver/output/geoserver-native-result.json', {signal}), result};
    });
    completedResult = {schema: 'starforge.postgis-native-journey-result.v1', operationId: input.operationId,
      originalRequestSha256: digest(input), projectId: profile.projectId,
      original: currentReceiving, restored: restoredReceiving,
      completeBackup: {original: backup.manifestFile, restored: restoredBackup.manifestFile},
      phases: Object.keys(state), browserExecuted: Boolean(state['operator-browser-receiving']),
      qgisExecuted: Boolean(state['qgis-complete-receiving']),
      qgis: state['qgis-complete-receiving'] || null,
      ...(input.geoserver ? {geoserverExecuted: Boolean(state['geoserver-complete-receiving']),
        geoserver: state['geoserver-complete-receiving']} : {}),
      verification: state['compare-complete-restored-values'],
      originalOperationRecovery: state['recover-restored-original-operations'],
      committedExportAvailability: state['verify-unavailable-committed-exports']};
  } catch (error) { primaryError = error; throw error; }
  finally {
    let failure;
    try { if (intake) await intake.close(); } catch (error) { failure = error; }
    try { if (restored) await restored.close(); } catch (error) { failure ||= error; }
    try { if (publisher) await publisher.close(); } catch (error) { failure ||= error; }
    if (failure && primaryError && Object.isExtensible(primaryError)) primaryError.postgisCleanupError = failure;
    if (failure && !primaryError) throw failure;
  }
  signal?.throwIfAborted();
  // Final completion is published only after every owned resource has drained.
  await writeJSONOnce(member(root, 'native-result.json'), completedResult);
  return completedResult;
}
async function writeNativeOutput(stream, value) {
  await new Promise((done, reject) => {
    const failed = error => { stream.removeListener('error', failed); reject(error); };
    stream.once('error', failed);
    try {
      stream.write(value, error => {
        stream.removeListener('error', failed); error ? reject(error) : done();
      });
    } catch (error) { stream.removeListener('error', failed); reject(error); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(), stopHandlers = new Map();
  let stopSignal;
  for (const requestedSignal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      if (!controller.signal.aborted) {
        stopSignal = requestedSignal;
        controller.abort(Object.assign(new Error('The original native journey was asked to stop.'),
          {code: 'POSTGIS_NATIVE_JOURNEY_STOPPED', detail: {signal: requestedSignal}}));
      }
    };
    stopHandlers.set(requestedSignal, handler);
    // Repeated stop signals keep the same drain active instead of terminating
    // the parent while a transaction, child or embedded operator still owns work.
    process.on(requestedSignal, handler);
  }
  const outputFailed = error => {
    if (!controller.signal.aborted) controller.abort(Object.assign(
      new Error('The original native output stream closed.'),
      {code: 'POSTGIS_NATIVE_OUTPUT_CLOSED', detail: {originalCode: error.code || null}}));
  };
  process.stdout.on('error', outputFailed); process.stderr.on('error', outputFailed);
  try {
    need(process.argv.length === 3, 'POSTGIS_NATIVE_REQUEST_FILE_REQUIRED');
    const input = await readJSON(resolve(process.argv[2]), {signal: controller.signal});
    const result = await runNativeJourney(input, {signal: controller.signal,
      progress: value => writeNativeOutput(process.stderr, canonical(value) + '\n')});
    await writeNativeOutput(process.stdout, canonical(result) + '\n');
  } catch (error) {
    try {
      await writeNativeOutput(process.stderr, canonical({code: error.code || 'POSTGIS_NATIVE_JOURNEY_FAILED',
        detail: error.code?.startsWith('POSTGIS_') ? error.detail : undefined,
        operationId: error.operationId, commitOutcome: error.postgisCommitOutcome}) + '\n');
    } catch {}
    process.exitCode = stopSignal === 'SIGTERM' ? 143 : stopSignal === 'SIGINT' ? 130 : 1;
  } finally {
    for (const [requestedSignal, handler] of stopHandlers) process.removeListener(requestedSignal, handler);
    process.stdout.removeListener('error', outputFailed); process.stderr.removeListener('error', outputFailed);
  }
}
