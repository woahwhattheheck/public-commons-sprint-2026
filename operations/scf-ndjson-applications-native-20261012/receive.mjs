// MIT. Receive the original retained NDJSON project through managed Applications.
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = 'stellar/scf-starforge-20261009/';
const SCHEMA = 'stellar-forge.ndjson-applications-receiving.v1';
const run = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (value, message) => { if (!value) throw new Error(message); };
const moduleAt = (root, file) => import(pathToFileURL(join(root, ROOT + file)).href);

/** Reuses one original dataset operation, installed runtime and saved application. */
export async function receiveNdjsonApplications(config, { onProgress = () => {} } = {}) {
  for (const key of ['runtimeDirectory', 'nativeOutcome', 'pythonExecutable', 'receivingDirectory'])
    need(typeof config[key] === 'string' && isAbsolute(config[key]), 'Select an absolute ' + key);
  const outcomeBytes = await readFile(config.nativeOutcome);
  const outcome = JSON.parse(outcomeBytes);
  need(outcome.schema === 'stellar-forge.ndjson-release-native-operation.v1' &&
    outcome.preparation?.length === 2 && outcome.receiving?.length === 2,
  'Select the completed original NDJSON dataset lifecycle outcome');
  const expected = outcome.preparation[1];
  const expectedRow = outcome.receiving[1].query.response.body.rows[0];
  const workspaceDirectory = await realpath(config.workspaceDirectory ??
    join(dirname(config.nativeOutcome), 'source-workspace'));
  const bootstrap = config.bootstrapSourceRoot ?? join(config.runtimeDirectory, 'package', 'source');
  const { inspectMerchantRuntime } = await moduleAt(bootstrap, 'sf46-release/runtime-package.mjs');
  const runtime = await inspectMerchantRuntime(config.runtimeDirectory, { load: false });
  if (config.expectedSourceCommit)
    need(runtime.sourceCommit === config.expectedSourceCommit, 'The selected installed source changed');
  const { createRuntimeWorkspace, openRuntimeWorkspace } =
    await moduleAt(runtime.sourceRoot, 'distribution/runtime-workspace/model.mjs');
  const { makePrivate, privateDirectory, readJSON, saveJSON, operationLease, canonical } =
    await moduleAt(runtime.sourceRoot, 'distribution/runtime-workspace/storage.mjs');
  const { applicationEnvironment } =
    await moduleAt(runtime.sourceRoot, 'distribution/runtime-workspace/application-command.mjs');
  const { managedCommandAlive } =
    await moduleAt(runtime.sourceRoot, 'distribution/runtime-workspace/managed-workspace.mjs');
  const { environment } = await applicationEnvironment(config.environmentFile);
  const inspectBinding = async () => {
    const observed = await run(config.pythonExecutable, [
      join(runtime.sourceRoot, ROOT + 'sf30-seller-sdk/ndjson/cli.py'),
      '--workspace', workspaceDirectory, 'binding',
    ], { encoding: 'utf8', env: environment, timeout: 15000, maxBuffer: 65536 });
    return JSON.parse(observed.stdout);
  };
  const original = await inspectBinding();
  need(original.schema === 'stellar-forge.ndjson-managed-binding.v1',
    'The selected runtime must include the original managed NDJSON producer');
  try { await makePrivate(config.receivingDirectory); }
  catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(config.receivingDirectory); }
  const lease = await operationLease(join(config.receivingDirectory, 'receiving.lock'));
  const receiptPath = join(config.receivingDirectory, 'receiving.json');
  const selection = {
    runtimeDirectory: runtime.directory, sourceCommit: runtime.sourceCommit,
    installationId: runtime.installationId, sourceManifestSha256: runtime.sourceManifestSha256,
    nativeOutcomeSha256: hash(outcomeBytes), workspaceDirectory,
    pythonExecutable: config.pythonExecutable, bindingSha256: original.sha256,
    environmentFile: config.environmentFile ?? null,
    applicationWorkspace: config.applicationWorkspace ?? join(config.receivingDirectory, 'applications'),
    connectionFile: join(config.receivingDirectory, 'console-url'),
  };
  let journal, model, stage = 'OPEN';
  try {
    journal = await readJSON(receiptPath, true);
    if (journal) {
      need(journal.schema === SCHEMA &&
        JSON.stringify(canonical(journal.selection)) === JSON.stringify(canonical(selection)),
      'Continue this receiving operation with its original retained selection');
      if (journal.completedAt) return journal;
    } else {
      journal = { schema: SCHEMA, createdAt: new Date().toISOString(), selection,
        saveRequestId: randomUUID(), passes: ['first-open', 'reopen'].map(name => ({ name, requestId: randomUUID() })) };
      await saveJSON(receiptPath, journal);
    }
    const persist = async () => {
      journal.updatedAt = new Date().toISOString(); await saveJSON(receiptPath, journal, true);
    };
    const progress = phase => onProgress({ stage, phase, applicationId: journal.applicationId ?? null });
    try { await readFile(join(selection.applicationWorkspace, 'workspace.json')); }
    catch (error) {
      if (error.code !== 'ENOENT' || config.applicationWorkspace) throw error;
      await createRuntimeWorkspace({ directory: selection.applicationWorkspace });
    }
    model = await openRuntimeWorkspace({ directory: selection.applicationWorkspace });
    const attached = await model.attach({ directory: runtime.directory, label: 'JSON Lines receiving' });
    const application = async () => {
      const item = (await model.applicationsState()).applications.find(value => value.id === journal.applicationId);
      need(item, 'The saved original NDJSON application is missing'); return item;
    };
    const waitFor = async (accept, recover) => {
      const began = Date.now(), attempted = new Set(); let nextProgress = began;
      for (;;) {
        const item = await application();
        if (accept(item)) return item;
        const operation = item.current ?? item.adoption;
        const recoverable = operation && ['PENDING', 'QUEUED', 'INTERRUPTED'].includes(operation.phase);
        const alive = operation?.state ? await managedCommandAlive(operation.state) : false;
        if (recoverable && !operation.active && !alive && recover && !attempted.has(operation.id)) {
          attempted.add(operation.id); await recover(item); continue;
        }
        need(!['FAILED', 'UNAVAILABLE'].includes(item.phase) &&
          item.adoption?.phase !== 'FAILED', 'The original operation failed; reopen its recorded output');
        need(Date.now() - began < 180000, 'The original operation remains recorded; continue this same receiving');
        if (Date.now() >= nextProgress) { progress(item.phase); nextProgress = Date.now() + 15000; }
        await delay(500);
      }
    };
    if (!journal.reviewId) {
      stage = 'REVIEW';
      const review = await model.applicationsReview({ runtimeId: attached.runtimeId, kind: 'ndjson',
        label: 'Retained JSON Lines project', ...(config.homeId ? { homeId: config.homeId } : {}),
        settings: { workspaceDirectory, pythonExecutable: config.pythonExecutable,
          connectionFile: selection.connectionFile, port: 0,
          ...(config.environmentFile ? { environmentFile: config.environmentFile } : {}) } });
      need(review.command.command === 'dataset-ndjson', 'The original source command changed');
      journal.reviewId = review.id; await persist();
    }
    if (!journal.applicationId) {
      stage = 'SAVE';
      const saved = await model.applicationsSave({ requestId: journal.saveRequestId, reviewId: journal.reviewId });
      journal.applicationId = saved.applicationId; await persist();
      if (saved.connectionError) throw new Error(saved.connectionError.message);
    }
    stage = 'ADOPT';
    await model.applicationsConnect({ applicationId: journal.applicationId });
    const attachedApp = await application();
    if (!attachedApp.release && attachedApp.adoption && !attachedApp.adoption.active) {
      const op = attachedApp.adoption;
      if (op.phase === 'QUEUED') await model.resumeQueued(op.id);
      else if (op.phase === 'INTERRUPTED') await model.recoverManagedOperation(op.id);
    }
    await waitFor(item => Boolean(item.release), async item => {
      if (item.adoption?.id) await model.recoverManagedOperation(item.adoption.id);
    });
    for (const pass of journal.passes) {
      if (pass.stoppedAt) continue;
      await model.close(); model = await openRuntimeWorkspace({ directory: selection.applicationWorkspace });
      if (!pass.opened) {
        stage = 'START_' + pass.name;
        if (!pass.reviewId) {
          pass.reviewId = (await model.applicationsStartReview({ applicationId: journal.applicationId })).id;
          await persist();
        }
        const selected = await application();
        const recover = () => model.applicationsRecover({
          applicationId: journal.applicationId, operationId: pass.requestId });
        if (!selected.runs.some(item => item.id === pass.requestId))
          await model.applicationsStart({ applicationId: journal.applicationId,
            requestId: pass.requestId, reviewId: pass.reviewId });
        else if (['PENDING', 'QUEUED', 'INTERRUPTED'].includes(selected.current?.phase) &&
          !selected.current.active) await recover();
        const active = await waitFor(item => item.current?.id === pass.requestId &&
          Boolean(item.current.privateUrl), recover);
        const url = new URL(active.current.privateUrl);
        need(url.hostname === '127.0.0.1' && /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)),
          'The original console URL is missing');
        need((await readFile(selection.connectionFile, 'utf8')).trim() === url.href,
          'The original MCP connection file differs from the opened console');
        const request = async (path, body) => {
          const response = await fetch(new URL(path, url), {
            method: body ? 'POST' : 'GET', redirect: 'error',
            headers: { authorization: 'Bearer ' + url.hash.slice(1),
              ...(body ? { 'content-type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
          });
          need(response.ok, 'Original console request failed: ' + path + ' HTTP ' + response.status);
          return response;
        };
        const get = async path => (await request(path)).json();
        const launch = await get('/api/launch'), state = await get('/api/state');
        need(launch.bindingSha256 === selection.bindingSha256 && launch.workspace === workspaceDirectory,
          'The original live workspace binding changed');
        const build = state.builds.find(value => value.id === expected.build);
        need(build?.native?.snapshot === expected.snapshot &&
          state.sources.some(value => value.id === expected.source) &&
          state.plans.some(value => value.id === expected.plan), 'Original source, mapping or build changed');
        const result = await (await request('/api/query', {
          build: expected.build, query: { where_id: '9007199254740993' },
        })).json();
        need(result.response.status === 200 &&
          JSON.stringify(canonical(result.response.body.rows[0])) === JSON.stringify(canonical(expectedRow)),
        'The exact native customer row changed');
        const comparison = state.comparisons.find(value =>
          JSON.stringify(canonical(value.counts)) === JSON.stringify(canonical(outcome.comparison)));
        need(comparison, 'The original complete edition comparison is missing');
        const changes = Buffer.from(await (await request('/api/changes/download?id=' + comparison.id)).arrayBuffer());
        const project = Buffer.from(await (await request('/api/export?build=' + expected.build)).arrayBuffer());
        need(changes.length > 0 && project.length > 0, 'Original complete downloads are empty');
        need((await (await request('/')).text()).includes('app.js'), 'The original source console page is missing');
        pass.opened = { at: new Date().toISOString(), build: expected.build, snapshot: expected.snapshot,
          stateSha256: hash(JSON.stringify(canonical(state))), querySha256: hash(JSON.stringify(canonical(result.response.body.rows))),
          completeChangesSha256: hash(changes), completeChangesBytes: changes.length,
          originalProjectBytes: project.length, bindingSha256: launch.bindingSha256,
          executedSourceRoot: launch.sourceRoot, privateUrlSha256: hash(url.href), pid: launch.pid };
        await persist(); progress('OPEN');
      }
      stage = 'STOP_' + pass.name;
      await model.applicationsStop({ applicationId: journal.applicationId, operationId: pass.requestId });
      const stopped = await waitFor(item => item.phase === 'STOPPED' &&
        item.current?.id === pass.requestId && !item.current.active);
      need((await inspectBinding()).sha256 === selection.bindingSha256, 'The retained workspace binding changed');
      try { await readFile(selection.connectionFile); throw new Error('The stopped console retained its connection'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      pass.stoppedAt = new Date().toISOString(); pass.phase = stopped.current.phase;
      await persist(); progress('STOPPED');
    }
    for (const key of ['stateSha256', 'querySha256', 'completeChangesSha256'])
      need(journal.passes[0].opened[key] === journal.passes[1].opened[key],
        'The original retained customer changed across reopen: ' + key);
    need(journal.passes[0].opened.privateUrlSha256 !== journal.passes[1].opened.privateUrlSha256,
      'The original console session did not reopen');
    journal.completedAt = new Date().toISOString(); delete journal.issue; await persist(); return journal;
  } catch (error) {
    if (journal) {
      journal.issue = { stage, at: new Date().toISOString(), message: String(error.message).slice(0, 700) };
      await saveJSON(receiptPath, journal, true).catch(() => {});
    }
    throw error;
  } finally { if (model) await model.close(); await lease.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
  const result = await receiveNdjsonApplications(config, {
    onProgress: value => process.stdout.write(JSON.stringify(value) + '\n'),
  });
  process.stdout.write(JSON.stringify({ schema: result.schema, status: 'COMPLETED',
    applicationId: result.applicationId, sourceCommit: result.selection.sourceCommit,
    bindingSha256: result.selection.bindingSha256, passes: result.passes }) + '\n');
}
