// MIT. Open one retained original RSS/Atom/OPML customer through Applications.
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = 'stellar/scf-starforge-20261009/';
const SCHEMA = 'stellar-forge.feed-managed-reception.v1';
const run = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const moduleAt = (root, path) => import(pathToFileURL(join(root, ROOT + path)).href);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function requireValue(value, code) {
  if (!value) throw Object.assign(new Error(code), { code });
}
function argument(args, name, value) {
  const indices = args.flatMap((part, index) => part === name ? [index] : []);
  requireValue(indices.length === 1 && args[indices[0] + 1] === value, 'FEEDS_RECEIVING_COMMAND_CHANGED');
}

/** Uses the original runtime installer, Applications model, operator and dataset engine. */
export async function receiveFeedManagedApplication(config, { onProgress = () => {} } = {}) {
  for (const key of ['runtimeDirectory', 'feedDirectory', 'pythonExecutable', 'receptionDirectory'])
    requireValue(typeof config[key] === 'string' && isAbsolute(config[key]), 'FEEDS_RECEIVING_PATH_REQUIRED');
  requireValue(/^[a-f0-9]{40}$/.test(config.expectedSourceCommit ?? '') && hex(config.expectedManifest),
    'FEEDS_RECEIVING_INSTALLED_SOURCE_REQUIRED');
  const expected = config.expected;
  requireValue(expected && typeof expected.collectionId === 'string' &&
    Number.isSafeInteger(expected.collectionRevision) && expected.collectionRevision >= 1 &&
    hex(expected.runId) && hex(expected.editionId) && hex(expected.originalOPMLSha256) && hex(expected.snapshot),
  'FEEDS_RECEIVING_ORIGINAL_CUSTOMER_REQUIRED');
  requireValue(typeof expected.feedId === 'string' && typeof expected.note === 'string' &&
    Number.isSafeInteger(expected.rows) && expected.rows > 0, 'FEEDS_RECEIVING_ORIGINAL_CUSTOMER_REQUIRED');
  const bootstrapSourceRoot = config.bootstrapSourceRoot ?? join(config.runtimeDirectory, 'package', 'source');
  requireValue(isAbsolute(bootstrapSourceRoot), 'FEEDS_RECEIVING_PATH_REQUIRED');
  const { inspectMerchantRuntime } = await moduleAt(bootstrapSourceRoot, 'sf46-release/runtime-package.mjs');
  const installed = await inspectMerchantRuntime(config.runtimeDirectory,
    { expectedManifest: config.expectedManifest, load: false });
  requireValue(installed.sourceCommit === config.expectedSourceCommit, 'FEEDS_RECEIVING_SOURCE_CHANGED');
  const { createRuntimeWorkspace, openRuntimeWorkspace } =
    await moduleAt(installed.sourceRoot, 'distribution/runtime-workspace/model.mjs');
  const { managedCommandAlive } =
    await moduleAt(installed.sourceRoot, 'distribution/runtime-workspace/managed-workspace.mjs');
  const { applicationEnvironment } =
    await moduleAt(installed.sourceRoot, 'distribution/runtime-workspace/application-command.mjs');
  const { rssAtomStartup } =
    await moduleAt(installed.sourceRoot, 'distribution/runtime-workspace/application-rss-atom.mjs');
  const { makePrivate, privateDirectory, readJSON, saveJSON, operationLease, canonical } =
    await moduleAt(installed.sourceRoot, 'distribution/runtime-workspace/storage.mjs');
  const { environment, sha256: environmentSha256 } = await applicationEnvironment(config.environmentFile);
  const originalCli = join(installed.sourceRoot, ROOT + 'sf30-seller-sdk/feeds/cli.py');
  const inspect = async () => {
    const result = await run(config.pythonExecutable, [originalCli, '--workspace', config.feedDirectory, 'binding'],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 65536, env: environment });
    const binding = JSON.parse(result.stdout);
    requireValue(binding.schema === 'stellar-forge.feed-managed-binding.v1' &&
      binding.workspace === config.feedDirectory && hex(binding.sha256), 'FEEDS_RECEIVING_BINDING_CHANGED');
    const { sha256: expectedHash, sourceRoot, ...body } = binding;
    requireValue(sha256(JSON.stringify(canonical(body)) + '\n') === expectedHash,
      'FEEDS_RECEIVING_BINDING_CHANGED');
    requireValue(await realpath(binding.python.executable) === await realpath(config.pythonExecutable),
      'FEEDS_RECEIVING_PYTHON_CHANGED');
    return binding;
  };
  const original = await inspect();
  if (config.applicationWorkspace !== undefined)
    requireValue(typeof config.applicationWorkspace === 'string' && isAbsolute(config.applicationWorkspace),
      'FEEDS_RECEIVING_PATH_REQUIRED');
  try { await makePrivate(config.receptionDirectory); }
  catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(config.receptionDirectory); }
  const lease = await operationLease(join(config.receptionDirectory, 'receiving.lock'));
  const receiptPath = join(config.receptionDirectory, 'feed-managed-reception.json');
  let journal, continuing = false, stage = 'OPEN_RECEIVING', model;
  try {
    journal = await readJSON(receiptPath, true); continuing = Boolean(journal);
    const selection = {
      runtimeDirectory: installed.directory, sourceCommit: installed.sourceCommit,
      sourceManifestSha256: installed.sourceManifestSha256, installationId: installed.installationId,
      feedDirectory: original.workspace, bindingSha256: original.sha256,
      pythonExecutable: config.pythonExecutable, environmentFile: config.environmentFile ?? null, environmentSha256,
      applicationWorkspace: config.applicationWorkspace ?? join(config.receptionDirectory, 'runtime-workspace'),
      homeId: config.homeId ?? null, expected,
    };
    if (journal) {
      requireValue(journal.schema === SCHEMA &&
        journal.operationId === (config.operationId ?? 'SCF-RSS-ATOM-APPLICATIONS-8F43-20261012') &&
        JSON.stringify(canonical(journal.selection)) === JSON.stringify(canonical(selection)),
      'FEEDS_RECEIVING_SELECTION_CHANGED');
    } else {
      journal = { schema: SCHEMA, operationId: config.operationId ?? 'SCF-RSS-ATOM-APPLICATIONS-8F43-20261012',
        createdAt: new Date().toISOString(), selection, source: original.source,
        applicationWorkspace: selection.applicationWorkspace, saveRequestId: randomUUID(),
        passes: [{ name: 'first-open', requestId: randomUUID() }, { name: 'reopen', requestId: randomUUID() }] };
      await saveJSON(receiptPath, journal);
    }
    const persist = async () => { journal.updatedAt = new Date().toISOString(); await saveJSON(receiptPath, journal, true); };
    const progress = value => onProgress({ stage, applicationId: journal.applicationId ?? null, ...value });
    if (journal.completedAt) return journal;
    let existing;
    try { existing = await readFile(join(journal.applicationWorkspace, 'workspace.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!existing) {
      requireValue(!config.applicationWorkspace, 'FEEDS_RECEIVING_EXISTING_APPLICATIONS_WORKSPACE_MISSING');
      await createRuntimeWorkspace({ directory: journal.applicationWorkspace });
    }
    model = await openRuntimeWorkspace({ directory: journal.applicationWorkspace });
    const attached = await model.attach({ directory: installed.directory, label: config.label ?? 'Retained research library' });
    journal.runtimeId = attached.runtimeId; await persist();
    const checkCommand = command => {
      requireValue(command.command === 'dataset-feeds', 'FEEDS_RECEIVING_COMMAND_CHANGED');
      argument(command.args, '--python', selection.pythonExecutable);
      argument(command.args, '--workspace', selection.feedDirectory);
      argument(command.args, '--expected-binding', selection.bindingSha256);
      argument(command.args, '--startup-format', 'json');
      argument(command.args, '--landing', 'subscriptions');
      argument(command.args, '--port', '0');
    };
    const app = async () => {
      const value = (await model.applicationsState()).applications.find(item => item.id === journal.applicationId);
      requireValue(value, 'FEEDS_RECEIVING_APPLICATION_MISSING');
      return value;
    };
    const awaitState = async (label, accept, recover) => {
      const started = Date.now(), recovered = new Set(); let nextProgress = started;
      for (;;) {
        const value = await app();
        const interrupted = value.phase === 'INTERRUPTED' || value.adoption?.phase === 'INTERRUPTED';
        if (value.phase === 'INTERRUPTED' && value.current?.state)
          value.receivingCommandAlive = await managedCommandAlive(value.current.state);
        if (accept(value)) return value;
        if (interrupted && recover && !value.receivingCommandAlive) {
          const current = value.current ?? value.adoption;
          const key = JSON.stringify([current?.id, current?.phase, current?.state]);
          if (!recovered.has(key)) { recovered.add(key); await recover(value); continue; }
        }
        if (['FAILED', 'UNAVAILABLE', 'STOPPED'].includes(value.phase) || value.adoption?.phase === 'FAILED')
          throw Object.assign(new Error('Continue the original operation recorded in this receiving journal'),
            { code: 'FEEDS_RECEIVING_ORIGINAL_OPERATION_ENDED' });
        if (Date.now() >= nextProgress) {
          progress({ label, phase: value.phase, operationId: value.current?.id ?? value.adoption?.id ?? null });
          nextProgress = Date.now() + 15000;
        }
        requireValue(Date.now() - started < 180000, 'FEEDS_RECEIVING_OPERATION_PENDING');
        await delay(500);
      }
    };
    if (!journal.configurationReviewId) {
      stage = 'REVIEW_CONFIGURATION';
      const review = await model.applicationsReview({ runtimeId: attached.runtimeId, kind: 'rss-atom',
        label: config.label ?? 'Retained research library',
        ...(config.homeId ? { homeId: config.homeId } : {}),
        settings: { workspaceDirectory: selection.feedDirectory, pythonExecutable: selection.pythonExecutable,
          landing: 'subscriptions', port: 0, ...(config.environmentFile ? { environmentFile: config.environmentFile } : {}) } });
      checkCommand(review.command);
      journal.configurationReviewId = review.id; await persist();
    }
    if (!journal.applicationId) {
      stage = 'SAVE_AND_ADOPT';
      const saved = await model.applicationsSave({ requestId: journal.saveRequestId, reviewId: journal.configurationReviewId });
      journal.applicationId = saved.applicationId; journal.configurationRevision = saved.revision;
      journal.adoptionOperationId = saved.connection?.operationId ?? saved.connection?.id ?? null;
      await persist();
      if (saved.connectionError)
        throw Object.assign(new Error(saved.connectionError.message), { code: saved.connectionError.code });
    }
    stage = 'CONNECT_ORIGINAL_RUNTIME';
    await model.applicationsConnect({ applicationId: journal.applicationId });
    const recoverAdoption = async value => {
      const operation = value.adoption;
      if (!operation || operation.active) return;
      journal.adoptionOperationId = operation.id;
      journal.adoptionRecovery = { at: new Date().toISOString(), result: operation.phase === 'QUEUED' ?
        await model.resumeQueued(operation.id) : await model.recoverManagedOperation(operation.id) };
      await persist();
    };
    const connection = await app();
    if (!connection.release && connection.adoption && !connection.adoption.active &&
        (connection.adoption.phase === 'INTERRUPTED' ||
          continuing && ['QUEUED', 'FAILED'].includes(connection.adoption.phase)))
      await recoverAdoption(connection);
    await awaitState('Original managed runtime adoption', value => Boolean(value.release), recoverAdoption);
    for (const pass of journal.passes) {
      if (pass.stoppedAt) continue;
      await model.close(); model = await openRuntimeWorkspace({ directory: journal.applicationWorkspace });
      if (!pass.reviewId) {
        stage = 'REVIEW_' + pass.name.toUpperCase();
        const review = await model.applicationsStartReview({ applicationId: journal.applicationId });
        checkCommand(review.command); pass.reviewId = review.id; await persist();
      }
      const recoverPass = async () => {
        pass.recovery = { at: new Date().toISOString(),
          result: await model.applicationsRecover({ applicationId: journal.applicationId, operationId: pass.requestId }) };
        await persist();
      };
      const ownedUrl = value => value.current?.id === pass.requestId ?
        value.current.privateUrl ?? (value.receivingCommandAlive ? value.current.url?.url : null) : null;
      if (!pass.opened) {
        stage = 'START_' + pass.name.toUpperCase();
        const savedRun = (await app()).runs.find(value => value.id === pass.requestId);
        if (savedRun) await recoverPass();
        else await model.applicationsStart({ applicationId: journal.applicationId,
          requestId: pass.requestId, reviewId: pass.reviewId });
        const running = await awaitState('Original RSS/Atom/OPML startup',
          value => Boolean(ownedUrl(value)), recoverPass);
        const url = new URL(ownedUrl(running));
        requireValue(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
          /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)), 'FEEDS_RECEIVING_ORIGINAL_URL_REQUIRED');
        const request = async (path, body) => {
          const response = await fetch(new URL(path, url), {
            redirect: 'error', method: body ? 'POST' : 'GET',
            headers: { authorization: 'Bearer ' + url.hash.slice(1), ...(body ? { 'content-type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
          });
          requireValue(response.ok, 'FEEDS_RECEIVING_ORIGINAL_BROWSER_READ_FAILED');
          return response;
        };
        const get = async path => (await request(path)).json();
        const launch = await get('/api/launch');
        const nativeRequest = await model.applicationsOutput({ applicationId: journal.applicationId, operationId: pass.requestId });
        requireValue(nativeRequest.operationId === pass.requestId, 'FEEDS_RECEIVING_OPERATION_CHANGED');
        const startupRequest = { command: 'dataset-feeds', args: running.current.args };
        const verified = await rssAtomStartup(startupRequest, JSON.stringify(launch));
        requireValue(verified?.url === url.href && verified.original.workspace === selection.feedDirectory &&
          verified.original.bindingSha256 === selection.bindingSha256, 'FEEDS_RECEIVING_LIVE_BINDING_CHANGED');
        const links = running.current.privateLinks?.length ? running.current.privateLinks :
          running.receivingCommandAlive ? running.current.url?.links : [];
        requireValue(links?.length === 2 &&
          links.every(link => verified.links.some(item => item.id === link.id && item.url === link.url)),
        'FEEDS_RECEIVING_ORIGINAL_DESTINATIONS_MISSING');
        for (const link of verified.links) {
          const page = await request(new URL(link.url).pathname);
          const text = await page.text();
          requireValue(text.includes(link.id === 'retained-feeds' ? 'app.js' : 'subscriptions.js'),
            'FEEDS_RECEIVING_ORIGINAL_PAGE_MISSING');
        }
        const collection = await get('/api/subscriptions/collection?id=' + encodeURIComponent(expected.collectionId));
        requireValue(collection.collection.id === expected.collectionId &&
          collection.collection.revision === expected.collectionRevision &&
          Object.keys(collection.missingRegistrations).length === 0, 'FEEDS_RECEIVING_COLLECTION_CHANGED');
        const acquisition = await get('/api/subscriptions/run?id=' + expected.runId);
        requireValue(acquisition.run.id === expected.runId && acquisition.run.collectionId === expected.collectionId,
          'FEEDS_RECEIVING_ACQUISITION_CHANGED');
        const edition = await get('/api/edition?id=' + expected.editionId);
        requireValue(edition.id === expected.editionId && edition.rowCount === expected.rows,
          'FEEDS_RECEIVING_EDITION_CHANGED');
        const records = await get('/api/records?feed=' + encodeURIComponent(expected.feedId));
        requireValue(records.items.some(item => item.review.note === expected.note), 'FEEDS_RECEIVING_OPERATOR_NOTE_CHANGED');
        const opml = Buffer.from(await (await request('/api/subscriptions/original?source=' + expected.originalOPMLSha256)).arrayBuffer());
        requireValue(sha256(opml) === expected.originalOPMLSha256, 'FEEDS_RECEIVING_ORIGINAL_OPML_CHANGED');
        let activity = await (await request('/api/action', { action: 'query', editionId: expected.editionId,
          params: { limit: '1' } })).json();
        const actionStarted = Date.now();
        while (activity.state === 'RUNNING') {
          requireValue(Date.now() - actionStarted < 60000, 'FEEDS_RECEIVING_ORIGINAL_QUERY_PENDING');
          await delay(200); activity = await get('/api/activity');
        }
        requireValue(activity.state === 'DONE' && activity.result.response.status === 200 &&
          activity.result.dataset.snapshot === expected.snapshot &&
          activity.result.response.body.page.total === expected.rows, 'FEEDS_RECEIVING_ORIGINAL_DATASET_CHANGED');
        const retained = { collection: collection.collection, acquisition: acquisition.run,
          edition, records: records.items, originalOPMLSha256: sha256(opml), snapshot: activity.result.dataset.snapshot };
        pass.opened = { observedAt: new Date().toISOString(), originalStateSha256: sha256(JSON.stringify(canonical(retained))),
          collectionRevision: collection.collection.revision, editionId: edition.id,
          snapshot: activity.result.dataset.snapshot, originalOPMLBytes: opml.length,
          bindingSha256: verified.original.bindingSha256, executedSourceRoot: verified.original.sourceRoot,
          privateUrlSha256: sha256(url.href), port: Number(url.port || 80), pid: verified.original.pid,
          originalDestinations: verified.links.map(({ id, url }) => ({ id, privateUrlSha256: sha256(url) })) };
        await persist(); progress({ operationId: pass.requestId, phase: 'RUNNING', collectionRevision: expected.collectionRevision });
      }
      stage = 'STOP_' + pass.name.toUpperCase();
      await model.applicationsStop({ applicationId: journal.applicationId, operationId: pass.requestId });
      const stopped = await awaitState('Original feed process drain',
        value => value.phase === 'STOPPED' && value.current?.id === pass.requestId && !value.current.active, recoverPass);
      requireValue((await inspect()).sha256 === selection.bindingSha256, 'FEEDS_RECEIVING_BINDING_CHANGED');
      pass.stoppedAt = new Date().toISOString(); pass.terminalPhase = stopped.current.phase;
      await persist(); progress({ operationId: pass.requestId, phase: 'STOPPED' });
    }
    requireValue(journal.passes[0].opened.originalStateSha256 === journal.passes[1].opened.originalStateSha256,
      'FEEDS_RECEIVING_RETAINED_STATE_CHANGED');
    requireValue(journal.passes[0].opened.privateUrlSha256 !== journal.passes[1].opened.privateUrlSha256,
      'FEEDS_RECEIVING_SESSION_NOT_REOPENED');
    stage = 'COMPLETED'; journal.completedAt = new Date().toISOString(); delete journal.issue;
    await persist(); progress({ phase: 'COMPLETED', receiptPath }); return journal;
  } catch (error) {
    if (journal) {
      journal.issue = { stage, at: new Date().toISOString(), code: error.code ?? 'FEEDS_RECEIVING_FAILED',
        message: String(error.message ?? error).slice(0, 600) };
      await saveJSON(receiptPath, journal, true).catch(() => {});
    }
    throw error;
  } finally { if (model) await model.close(); await lease.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  requireValue(process.argv[2], 'FEEDS_RECEIVING_CONFIGURATION_REQUIRED');
  const config = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
  const result = await receiveFeedManagedApplication(config,
    { onProgress: value => process.stdout.write(JSON.stringify(value) + '\n') });
  process.stdout.write(JSON.stringify({ status: 'COMPLETED', operationId: result.operationId,
    applicationId: result.applicationId, sourceCommit: result.selection.sourceCommit,
    bindingSha256: result.selection.bindingSha256, operations: result.passes.map(pass => ({
      name: pass.name, requestId: pass.requestId, openedAt: pass.opened.observedAt,
      stoppedAt: pass.stoppedAt, collectionRevision: pass.opened.collectionRevision,
      editionId: pass.opened.editionId, snapshot: pass.opened.snapshot,
    })) }) + '\n');
}
