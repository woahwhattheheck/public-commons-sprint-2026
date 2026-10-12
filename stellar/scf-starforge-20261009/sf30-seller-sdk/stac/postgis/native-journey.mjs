#!/usr/bin/env node
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {need, id, hash, integer, normalizeProfile, canonical, digest, qi, fieldParameter} from './contract.mjs';
import {claimDirectory, member, readJSON, writeJSONOnce, fileRecord, openReceiving} from './files.mjs';
import {connectionFile} from './cli.mjs';
import {openPostgisIntake} from './index.mjs';
import {createDatabase} from './database.mjs';
import {verifyReceiving} from './verify.mjs';
import {openBackup} from './backup.mjs';
import {startOperator} from './operator.mjs';

const EXPECTED = 'starforge.postgis-native-journey.v1';

export async function runNativeJourney(input, {progress = () => {}} = {}) {
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
  async function step(name, fn) {
    const path = member(root, 'phases/' + name + '.json');
    let result;
    try { result = await readJSON(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!result) {
      progress({phase: name, state: 'running'});
      const value = await fn();
      result = {schema: 'starforge.postgis-native-phase.v1', operationId: input.operationId,
        phase: name, originalRequestSha256: digest(input), result: value};
      await writeJSONOnce(path, result);
    }
    need(result.schema === 'starforge.postgis-native-phase.v1' && result.operationId === input.operationId &&
      result.phase === name && result.originalRequestSha256 === digest(input), 'POSTGIS_NATIVE_ORIGINAL_PHASE_CHANGED', name);
    state[name] = result.result;
    progress({phase: name, state: 'complete'});
    return result.result;
  }
  let intake = await openPostgisIntake({connection: originalConnection, profile,
    directory: member(root, 'original-workspace'), python: input.python});
  let restored;
  const publisher = await createDatabase(originalConnection, profile);
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
        role: reader.role, layerIds: reader.layerIds});
      results.push({current: result.current, selection: result.selection, observations: result.observations});
    }
    return results;
  }
  let primaryError;
  try {
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
        directory: member(root, 'original-workspace'), python: input.python, port: 0});
      let browser;
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
        return {nativeBrowser: await browser.version(), originalProject: profile.projectId,
          currentEditionId: secondPublished.editionId, nativeSourceInspected: true,
          screenshot: await fileRecord(screenshot, 'operator-current.png')};
      } finally {
        let failure;
        try { if (browser) await browser.close(); } catch (error) { failure = error; }
        try { await server.close(); } catch (error) { failure ||= error; }
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
      await new Promise((resolveNative, rejectNative) => {
        const child = spawn(input.qgis.python, args, {stdio: ['ignore', 'ignore', 'pipe'], env: {...process.env}});
        let stderr = '', spawnError;
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', part => { if (stderr.length < 16384) stderr += part.slice(0, 16384 - stderr.length); });
        child.on('error', error => { spawnError = error; });
        child.once('close', (code, signal) => {
          if (spawnError) { rejectNative(spawnError); return; }
          if (code !== 0) {
            rejectNative(Object.assign(new Error('POSTGIS_NATIVE_QGIS_RECEIVING_FAILED'),
              {code: 'POSTGIS_NATIVE_QGIS_RECEIVING_FAILED', detail: {exitCode: code, signal, nativeError: stderr}}));
          } else resolveNative();
        });
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
    const result = {schema: 'starforge.postgis-native-journey-result.v1', operationId: input.operationId,
      originalRequestSha256: digest(input), projectId: profile.projectId,
      original: currentReceiving, restored: restoredReceiving,
      completeBackup: {original: backup.manifestFile, restored: restoredBackup.manifestFile},
      phases: Object.keys(state), browserExecuted: Boolean(state['operator-browser-receiving']),
      qgisExecuted: Boolean(state['qgis-complete-receiving']),
      qgis: state['qgis-complete-receiving'] || null,
      verification: state['compare-complete-restored-values']};
    await writeJSONOnce(member(root, 'native-result.json'), result);
    return result;
  } catch (error) { primaryError = error; throw error; }
  finally {
    let failure;
    try { await intake.close(); } catch (error) { failure = error; }
    try { if (restored) await restored.close(); } catch (error) { failure ||= error; }
    try { await publisher.close(); } catch (error) { failure ||= error; }
    if (failure && primaryError && Object.isExtensible(primaryError)) primaryError.postgisCleanupError = failure;
    if (failure && !primaryError) throw failure;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3, 'POSTGIS_NATIVE_REQUEST_FILE_REQUIRED');
    const input = await readJSON(resolve(process.argv[2]));
    const result = await runNativeJourney(input, {progress: value => process.stderr.write(canonical(value) + '\n')});
    process.stdout.write(canonical(result) + '\n');
  } catch (error) {
    process.stderr.write(canonical({code: error.code || 'POSTGIS_NATIVE_JOURNEY_FAILED',
      detail: error.code?.startsWith('POSTGIS_') ? error.detail : undefined,
      operationId: error.operationId, commitOutcome: error.postgisCommitOutcome}) + '\n');
    process.exitCode = 1;
  }
}
