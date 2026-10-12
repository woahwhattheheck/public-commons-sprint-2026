#!/usr/bin/env node
// MIT. Receive one complete water-quality project through the installed Applications lifecycle.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { readPrivateJson } from '../routescan/quota.mjs';

const SCHEMA = 'stellar-forge.wqx-managed-receiving-input.v1';
const RESULT = 'stellar-forge.wqx-managed-receiving.v1';
const PREFIX = 'stellar/scf-starforge-20261009/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
function need(value, message) { if (!value) throw new Error(message); }
async function optional(path) {
  try { return await readPrivateJson(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function save(path, value) {
  const temporary = path + '.tmp-' + process.pid;
  await writeFile(temporary, json(value), { mode: 0o600 });
  await rename(temporary, path);
}
async function privateDirectory(path) {
  const { privateDirectory } = await import('../../distribution/runtime-workspace/storage.mjs');
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return privateDirectory(path);
}
export async function receiveManagedWaterQuality(configFile) {
  const config = await readPrivateJson(resolve(configFile));
  need(config.schema === SCHEMA, 'Select the original managed receiving configuration.');
  for (const field of ['runtimeDirectory', 'directory', 'projectDirectory'])
    need(typeof config[field] === 'string' && resolve(config[field]) === config[field], 'Use an absolute ' + field + '.');
  need(/^[a-f0-9]{40}$/.test(config.expectedSourceCommit ?? '') &&
    /^[a-f0-9]{64}$/.test(config.expectedManifest ?? ''), 'Retain the actual installed source commit and manifest.');
  need(/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(config.reviewId ?? '') &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(config.planId ?? ''), 'Select the original saved scientific review and Open Waters plan.');
  const runtime = await inspectMerchantRuntime(config.runtimeDirectory, { expectedManifest: config.expectedManifest, load: false });
  need(runtime.sourceCommit === config.expectedSourceCommit, 'The selected installed source changed.');
  const directory = await privateDirectory(config.directory);
  const controller = join(directory, 'applications');
  const resultPath = join(directory, 'managed-receiving.json');
  const inputSha256 = hash(JSON.stringify(config));
  let retained = await optional(resultPath);
  if (retained) {
    need(retained.schema === RESULT && retained.inputSha256 === inputSha256, 'Reopen this operation with its original configuration.');
    if (retained.status === 'COMPLETE') return retained;
  } else {
    retained = {
      schema: RESULT, inputSha256, status: 'RECEIVING', startedAt: new Date().toISOString(),
      sourceCommit: runtime.sourceCommit, sourceManifestSha256: runtime.sourceManifestSha256,
      installationId: runtime.installationId, profileId: runtime.profileId,
      directory, controller, projectDirectory: config.projectDirectory, saveRequestId: randomUUID(),
      stages: [{ name: 'first', requestId: randomUUID() }, { name: 'reopen', requestId: randomUUID() }],
    };
    await save(resultPath, retained);
  }
  const selected = relative => pathToFileURL(join(runtime.sourceRoot, PREFIX, relative)).href;
  const modelModule = await import(selected('distribution/runtime-workspace/model.mjs'));
  const serverModule = await import(selected('distribution/runtime-workspace/server.mjs'));
  const projectModule = await import(selected('sf30-seller-sdk/wqx-water-quality/project.mjs'));
  if (!await optional(join(controller, 'workspace.json')))
    await modelModule.createRuntimeWorkspace({ directory: controller });
  let model = await modelModule.openRuntimeWorkspace({ directory: controller });
  const attached = await model.attach({ directory: runtime.directory, label: 'Water quality receiving runtime' });
  need(attached.status === 'READY', 'Finish the original runtime installation before receiving this application.');
  retained.runtimeId = attached.runtimeId;
  await save(resultPath, retained);
  await model.close();
  model = null;
  const host = await serverModule.startRuntimeWorkspace({ directory: controller, port: 0 });
  const token = new URL(host.url).hash.slice(1);
  const timeoutMs = config.timeoutMs ?? 300000;
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 3600000, 'Choose a valid receiving timeout.');
  let currentRun = null;
  async function action(path, value) {
    const response = await fetch(host.origin + path, {
      method: value === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', origin: host.origin, 'x-runtime-workspace-token': token },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      signal: AbortSignal.timeout(Math.min(timeoutMs, 120000)),
    });
    const result = await response.json();
    need(response.ok, path + ': ' + (result.error ?? response.status) + ' ' + (result.message ?? ''));
    return result;
  }
  async function application() {
    const state = await action('/api/applications/state?historyLimit=2');
    const value = state.applications.find(item => item.id === retained.applicationId);
    need(value, 'The original saved application is missing.');
    return value;
  }
  async function waitFor(label, decide) {
    const expires = Date.now() + timeoutMs;
    while (Date.now() < expires) {
      const value = await application(), accepted = await decide(value);
      if (accepted) return accepted;
      await delay(250);
    }
    throw new Error('The original ' + label + ' operation remains available in ' + controller + '.');
  }
  async function stop(stage) {
    await action('/api/applications/stop', { applicationId: retained.applicationId, operationId: stage.requestId });
    await waitFor('Stop', value => {
      const run = value.runs.find(item => item.id === stage.requestId);
      if (run && !run.active && ['SUCCEEDED', 'CANCELLED'].includes(run.phase)) return value;
      if (run?.phase === 'FAILED') throw new Error('The original managed Stop failed; inspect its retained operation.');
      return null;
    });
    stage.stoppedAt = new Date().toISOString();
    await save(resultPath, retained);
  }
  async function receive(stage, value) {
    const launch = value.current.url.original;
    need(launch.directory === config.projectDirectory && launch.reviewId === config.reviewId &&
      launch.planId === config.planId, 'The original managed source selection changed.');
    const project = await projectModule.openWaterQualityProject(config.projectDirectory);
    const reads = [];
    try {
      const review = await project.readReview(config.reviewId), plan = await project.readOpenWaters(config.planId);
      need(plan.reviewId === review.reviewId && plan.reviewSha256 === review.reviewSha256,
        'The selected receiving plan must retain the original scientific review.');
      need(launch.reviewSha256 === review.reviewSha256 && launch.planSha256 === plan.planSha256,
        'The original launch and project decisions differ.');
      const origin = new URL(value.current.privateUrl).origin;
      const sourceRoot = join(runtime.sourceRoot, PREFIX, 'sf30-seller-sdk/wqx-water-quality');
      const assetManifest = JSON.parse(await readFile(join(sourceRoot, 'browser-assets.json'), 'utf8'));
      need(assetManifest.schema === 'stellar-forge.browser-assets.v1' && assetManifest.root === './' &&
        Array.isArray(assetManifest.routes), 'Read the original browser asset manifest from this installed source.');
      const routes = new Map();
      for (const [path, selected] of assetManifest.routes) {
        need((path === '/' || /^\/[A-Za-z0-9_.-]+$/.test(path)) && Array.isArray(selected) &&
          /^ui\/[A-Za-z0-9_.-]+$/.test(selected[0]) && !routes.has(path),
          'The original browser source has an invalid or duplicate asset route.');
        routes.set(path, selected[0]);
      }
      need(routes.has('/') && routes.has('/app.mjs') && routes.has('/openwaters.mjs') && routes.has('/style.css'),
        'The original complete browser application is required.');
      for (const path of [...routes.keys(), '/api/workspace']) {
        const response = await fetch(origin + path, { signal: AbortSignal.timeout(60000) });
        need(response.ok, 'The original water-quality application did not serve ' + path + '.');
        const bytes = Buffer.from(await response.arrayBuffer());
        need(bytes.length > 0, 'The original application returned an empty ' + path + '.');
        if (routes.has(path)) {
          const expected = await readFile(join(sourceRoot, routes.get(path)));
          need(bytes.length === expected.length && hash(bytes) === hash(expected), 'The served browser asset differs from its installed original source: ' + path);
        }
        reads.push({ path, status: response.status, bytes: bytes.length, sha256: hash(bytes) });
      }
      const links = value.current.privateLinks;
      need(Array.isArray(links) && links.length === 11, 'Receive all eleven original reports and source exports.');
      const formats = new Set();
      for (const link of links) {
        const url = new URL(link.url), parts = url.pathname.split('/'), format = parts.at(-1);
        const isReview = parts[2] === 'reviews';
        need(url.origin === origin && parts[3] === (isReview ? config.reviewId : config.planId),
          'An export points outside the selected original project.');
        const key = (isReview ? 'review/' : 'open-waters/') + format;
        need(!formats.has(key), 'An original export was repeated.');
        formats.add(key);
        let expected = isReview
          ? format === 'bundle' ? await project.exportReviewBundle({ reviewId: config.reviewId })
            : await project.exportReview({ reviewId: config.reviewId, format })
          : await project.exportOpenWaters({ planId: config.planId, format });
        const expectedHash = hash(expected.bytes), expectedBytes = expected.bytes.length, filename = expected.filename;
        expected = null;
        global.gc?.();
        const response = await fetch(link.url, { signal: AbortSignal.timeout(120000) });
        need(response.ok, 'The original full export failed: ' + key);
        const digest = createHash('sha256'); let bytes = 0;
        for await (const chunk of response.body) { digest.update(chunk); bytes += chunk.length; }
        const sha256 = digest.digest('hex');
        need(bytes === expectedBytes && sha256 === expectedHash,
          'The complete original export changed: ' + key);
        need(response.headers.get('content-disposition')?.includes(filename),
          'The original export filename changed: ' + key);
        reads.push({ path: url.pathname, status: response.status, bytes, sha256, filename });
        global.gc?.();
      }
      for (const format of ['html', 'json', 'csv', 'geojson', 'bundle']) need(formats.has('review/' + format), 'Missing scientific export.');
      for (const format of ['locations', 'results', 'crosswalk', 'report', 'references', 'bundle'])
        need(formats.has('open-waters/' + format), 'Missing Open Waters export.');
      stage.receivedAt = new Date().toISOString();
      stage.original = launch;
      stage.reads = reads;
      await save(resultPath, retained);
    } finally { await project.close(); }
  }
  try {
    const catalog = await action('/api/applications/state?historyLimit=1');
    need(catalog.catalog.some(item => item.id === 'wqx-water-quality' && item.command === 'water-quality-managed'),
      'The selected Applications source must contain the original complete WQX product.');
    if (!retained.applicationId) {
      if (!retained.reviewId) {
        const settings = { projectDirectory: config.projectDirectory, reviewId: config.reviewId, planId: config.planId, port: 0, merchantPort: 0 };
        for (const key of ['bundleFile', 'buyerConfig', 'facilitator', 'allowLocalFacilitator', 'environmentFile'])
          if (config[key] !== undefined) settings[key] = config[key];
        const review = await action('/api/applications/review', {
          runtimeId: attached.runtimeId, kind: 'wqx-water-quality', settings, label: 'Water quality and Open Waters receiving',
        });
        retained.reviewId = review.id;
        await save(resultPath, retained);
      }
      const saved = await action('/api/applications/save', { requestId: retained.saveRequestId, reviewId: retained.reviewId });
      need(saved.saved && saved.applicationId, 'The original application was not saved.');
      retained.applicationId = saved.applicationId;
      await save(resultPath, retained);
    }
    await action('/api/applications/connect', { applicationId: retained.applicationId });
    await waitFor('runtime adoption', value => {
      if (value.release) return value;
      if (value.adoption?.phase === 'FAILED') throw new Error('The original runtime adoption failed; inspect its retained operation.');
      return null;
    });
    for (const stage of retained.stages) {
      if (stage.stoppedAt && stage.receivedAt) continue;
      if (stage.stoppedAt) {
        stage.attempts ??= [];
        stage.attempts.push({ requestId: stage.requestId, startReviewId: stage.startReviewId, stoppedAt: stage.stoppedAt });
        stage.requestId = randomUUID();
        delete stage.startReviewId; delete stage.stoppedAt;
        await save(resultPath, retained);
      }
      currentRun = stage;
      if (!stage.receivedAt) {
        if (!stage.startReviewId) {
          const review = await action('/api/applications/start-review', { applicationId: retained.applicationId });
          stage.startReviewId = review.id;
          await save(resultPath, retained);
        }
        await action('/api/applications/start', {
          applicationId: retained.applicationId, requestId: stage.requestId, reviewId: stage.startReviewId,
        });
        let recovered = false;
        const live = await waitFor('managed Start', async value => {
          const run = value.runs.find(item => item.id === stage.requestId);
          if (run?.active && run.privateUrl && run.url?.original && value.current?.id === stage.requestId) return value;
          if (run?.phase === 'FAILED') throw new Error('The original managed command failed; inspect its retained operation.');
          if (run && ['INTERRUPTED', 'QUEUED'].includes(run.phase) && !run.active && !recovered) {
            recovered = true;
            await action('/api/applications/recover', { applicationId: retained.applicationId, operationId: stage.requestId });
          }
          return null;
        });
        await receive(stage, live);
      }
      await stop(stage);
      currentRun = null;
    }
    const [first, reopened] = retained.stages;
    for (const key of ['directory', 'projectBindingId', 'sourceSha256', 'projectRevision', 'projectSelectionSha256',
      'reviewId', 'reviewSha256', 'planId', 'planSha256'])
      need(first.original[key] === reopened.original[key], 'The original ' + key + ' changed during fresh Start.');
    need(first.original.launchId !== reopened.original.launchId, 'Reopen must start the original project in a new managed process.');
    delete retained.error;
    retained.status = 'COMPLETE';
    retained.completedAt = new Date().toISOString();
    retained.httpReads = retained.stages.reduce((n, stage) => n + stage.reads.length, 0);
    retained.completeExportDownloads = retained.stages.reduce((n, stage) => n + stage.reads.filter(read => read.filename).length, 0);
    await save(resultPath, retained);
    return retained;
  } catch (error) {
    retained.error = { message: error.message, observedAt: new Date().toISOString() };
    await save(resultPath, retained);
    throw error;
  } finally {
    if (currentRun) await stop(currentRun).catch(() => {});
    await host.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node --expose-gc receive-managed.mjs /absolute/private-input.json');
  receiveManagedWaterQuality(process.argv[2]).then(value => {
    process.stdout.write(json({ status: value.status, applicationId: value.applicationId,
      sourceCommit: value.sourceCommit, sourceManifestSha256: value.sourceManifestSha256,
      httpReads: value.httpReads, completeExportDownloads: value.completeExportDownloads,
      result: join(value.directory, 'managed-receiving.json') }));
  }).catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
}
