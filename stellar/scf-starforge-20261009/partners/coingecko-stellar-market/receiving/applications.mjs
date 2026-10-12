// MIT. Operate one retained CoinGecko project through the original installed Applications lifecycle.
import { readFile, writeFile, mkdir, rename, lstat, realpath } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const HASH = /^[a-f0-9]{64}$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function need(value, code) { if (!value) throw Object.assign(new Error(code), { code }); }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function exists(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function save(path, value) {
  const temporary = path + '.' + randomUUID() + '.next';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}
function uuidFor(text) {
  const hex = sha(text);
  return hex.slice(0,8) + '-' + hex.slice(8,12) + '-4' + hex.slice(13,16) + '-a' + hex.slice(17,20) + '-' + hex.slice(20,32);
}
const originalModule = (source, path) => import(pathToFileURL(join(source, path)).href);
const B = 'stellar/scf-starforge-20261009/';
const R = B + 'distribution/runtime-workspace/';
const C = B + 'partners/coingecko-stellar-market/';

export async function receiveCoinGeckoApplication({ manifest, output }) {
  manifest = resolve(manifest); output = resolve(output);
  const inputBytes = await readFile(manifest), input = JSON.parse(inputBytes);
  need(input.schema === 'stellar-forge.coingecko-applications-receiving.v1' &&
    typeof input.operationPrefix === 'string' && input.operationPrefix.length < 160 &&
    /^[a-f0-9-]{36}$/.test(input.projectId ?? '') && Array.isArray(input.originalSources) &&
    input.originalSources.length > 0 && typeof input.playwrightModule === 'string' && input.playwrightModule.length > 0 &&
    input.originalSources.every(item =>
      plain(item) && typeof item.fileId === 'string' && HASH.test(item.sha256)),
  'ORIGINAL_RECEIVING_SELECTION_REQUIRED');
  await mkdir(output, { recursive: true, mode: 0o700 });
  const checkpointPath = join(output, 'application-checkpoint.json');
  let state = await exists(checkpointPath) ? await json(checkpointPath) : {
    schema: 'stellar-forge.coingecko-applications-checkpoint.v1',
    manifestSha256: sha(inputBytes), createdAt: new Date().toISOString(),
    requests: {}, completed: {}, runs: {},
  };
  need(state.manifestSha256 === sha(inputBytes), 'ORIGINAL_RECEIVING_MANIFEST_CHANGED');
  const persist = () => save(checkpointPath, state);
  await persist();
  const report = (name, value) => process.stdout.write(JSON.stringify({
    stage: name, at: new Date().toISOString(), ...value,
  }) + '\n');
  const stage = async (name, fn) => {
    if (state.completed[name]) { report(name, { reopened: true }); return state.completed[name]; }
    const result = await fn();
    state.completed[name] = { ...result, completedAt: new Date().toISOString() };
    await persist(); report(name, { completed: true, ...result }); return result;
  };
  const source = resolve(input.sourceRoot), runtime = resolve(input.runtimeDirectory);
  const market = resolve(input.workspaceDirectory), projectId = input.projectId;
  need(await realpath(source) === source && await realpath(runtime) === runtime &&
    await realpath(market) === market, 'ORIGINAL_CANONICAL_PATHS_REQUIRED');
  const { inspectMerchantRuntime } = await originalModule(source, B + 'sf46-release/runtime-package.mjs');
  const selected = await inspectMerchantRuntime(runtime, { load: false,
    ...(input.sourceManifestSha256 ? { expectedManifest: input.sourceManifestSha256 } : {}) });
  need(selected.sourceRoot === source, 'SELECTED_INSTALLED_SOURCE_REQUIRED');
  const native = await originalModule(source, C + 'workspace/managed.mjs');
  const observedBinding = await native.inspectMarketBinding(market, { projectId });
  if (!state.originalBinding) {
    state.originalBinding = observedBinding;
    await persist();
  }
  const initialBinding = state.originalBinding;
  need(observedBinding.identity.device === initialBinding.identity.device &&
    observedBinding.identity.inode === initialBinding.identity.inode &&
    observedBinding.database.device === initialBinding.database.device &&
    observedBinding.database.inode === initialBinding.database.inode,
  'ORIGINAL_DATABASE_REPLACED');
  const { createRuntimeWorkspace, openRuntimeWorkspace } = await originalModule(source, R + 'model.mjs');
  const consoleDirectory = resolve(input.consoleDirectory);
  if (!await exists(join(consoleDirectory, 'workspace.json'))) {
    await createRuntimeWorkspace({ directory: consoleDirectory, runtimeHome: resolve(input.runtimeHome) });
  }
  let model = await openRuntimeWorkspace({ directory: consoleDirectory }), activeRun = null;
  const application = async () => {
    const list = await model.applicationsState();
    const rows = list.applications ?? list.items;
    need(Array.isArray(rows), 'APPLICATION_CATALOG_RESPONSE_REQUIRED');
    return rows.find(item => item.id === state.applicationId);
  };
  async function waitFor(name, observe, accept, milliseconds = 180000) {
    const end = Date.now() + milliseconds; let current;
    while (Date.now() < end) {
      current = await observe();
      if (accept(current)) return current;
      if (current && (['FAILED', 'LAUNCH_FAILED', 'UNAVAILABLE'].includes(current.phase) ||
          name === 'connection' && ['FAILED', 'LAUNCH_FAILED', 'INTERRUPTED'].includes(current.adoption?.phase)) && name !== 'ended')
        throw Object.assign(new Error(name + ' failed: ' + JSON.stringify(current.result ?? current.error ?? current)),
          { code: 'ORIGINAL_APPLICATION_FAILED' });
      await delay(750);
    }
    throw Object.assign(new Error(name + ' did not finish; reopen the retained operation.'),
      { code: 'ORIGINAL_OPERATION_RETAINED', current });
  }
  async function api(url, path, options = {}) {
    const target = new URL(path, new URL(url).origin);
    const response = await fetch(target, { ...options, redirect: 'error',
      headers: { accept: 'application/json', ...(options.body ? {
        'content-type': 'application/json', 'x-workspace-request': '1',
      } : {}), ...options.headers }, signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw Object.assign(new Error(await response.text()),
      { code: 'ORIGINAL_HTTP_' + response.status });
    return response.json();
  }
  async function download(url, path) {
    const response = await fetch(new URL(path, new URL(url).origin), {
      redirect: 'error', signal: AbortSignal.timeout(120000),
    });
    need(response.ok, 'ORIGINAL_DOWNLOAD_FAILED');
    return Buffer.from(await response.arrayBuffer());
  }
  async function list(url, kind, selectedProject = projectId) {
    const items = [];
    for (let offset = 0; ; ) {
      const page = await api(url, '/api/projects/' + selectedProject + '/' + kind + '?offset=' + offset + '&limit=100');
      need(Array.isArray(page.items) && Number.isSafeInteger(page.total), 'ORIGINAL_PAGE_REQUIRED');
      items.push(...page.items); offset += page.items.length;
      if (offset >= page.total) return items;
      need(page.items.length > 0, 'ORIGINAL_PAGE_INCOMPLETE');
    }
  }
  async function sources(url, selectedProject = projectId, restored = false) {
    const files = await list(url, 'files', selectedProject), observed = [];
    for (const original of input.originalSources) {
      const file = files.find(item => restored ? item.sha256 === original.sha256 : item.id === original.fileId);
      need(file && file.sha256 === original.sha256, 'ORIGINAL_SOURCE_METADATA_CHANGED');
      const bytes = await download(url, '/api/files/' + file.id + '/download');
      need(sha(bytes) === original.sha256, 'ORIGINAL_SOURCE_BYTES_CHANGED');
      observed.push({ originalFileId: original.fileId, fileId: file.id, bytes: bytes.length, sha256: sha(bytes) });
    }
    return observed;
  }
  async function retainedWrite(url, key, path, body, selectedProject = projectId) {
    if (!state.requests[key]) {
      const project = selectedProject ? await api(url, '/api/projects/' + selectedProject) : null;
      state.requests[key] = { path, body: { actor: input.actor ?? 'CoinGecko receiving operator',
        opId: input.operationPrefix + ':' + key, ...(project ? { revision: project.project.revision } : {}),
        ...body } };
      await persist();
    }
    const original = state.requests[key];
    need(original.path === path, 'ORIGINAL_WRITE_TARGET_CHANGED');
    return api(url, original.path, { method: 'POST', body: JSON.stringify(original.body) });
  }
  async function start(name) {
    let run = state.runs[name] ??= { requestId: uuidFor(input.operationPrefix + ':' + name), previous: [] };
    await persist();
    let current = await application();
    if (current?.current?.id === run.requestId && current.current.active) {
      activeRun = run.requestId;
      current = await waitFor(name, application, value => Boolean(value?.current?.privateUrl));
      run.url = current.current.privateUrl;
      run.launch = await api(run.url, '/api/managed-launch');
      need(new URL(run.url).searchParams.get('project') === projectId &&
        run.launch.directory === market && run.launch.workspace.project.id === projectId,
      'ORIGINAL_PROJECT_DEEP_LINK_CHANGED');
      await persist();
      return current;
    }
    const retained = current?.runs?.find(item => item.id === run.requestId);
    if (retained && !retained.active && !['PENDING','QUEUED'].includes(retained.phase)) {
      if (retained.phase === 'INTERRUPTED') {
        await model.applicationsRecover({ applicationId: state.applicationId, operationId: run.requestId });
        current = await application();
        need(!current.current.active, 'ORIGINAL_OPERATION_STILL_RECOVERING');
      }
      const previous = [...(run.previous ?? []), Object.fromEntries(Object.entries(run).filter(([key]) => key !== 'previous'))];
      run = state.runs[name] = { requestId: uuidFor(input.operationPrefix + ':' + name + ':' + previous.length), previous };
      await persist();
    }
    if (!run.reviewId) {
      const review = await model.applicationsStartReview({ applicationId: state.applicationId });
      run.reviewId = review.id; run.selection = review.command.args;
      await persist();
    }
    await model.applicationsStart({ applicationId: state.applicationId,
      requestId: run.requestId, reviewId: run.reviewId });
    activeRun = run.requestId;
    current = await waitFor(name, application, value => Boolean(value?.current?.privateUrl));
    need(current.current.id === run.requestId, 'ORIGINAL_APPLICATION_RUN_CHANGED');
    run.url = current.current.privateUrl;
    run.launch = await api(run.url, '/api/managed-launch');
    await persist();
    need(new URL(run.url).searchParams.get('project') === projectId &&
      run.launch.directory === market && run.launch.workspace.project.id === projectId,
    'ORIGINAL_PROJECT_DEEP_LINK_CHANGED');
    return current;
  }
  async function stop(name) {
    const run = state.runs[name];
    if (!run) return;
    const current = await application();
    if (current?.current?.id === run.requestId && current.current.active) {
      await model.applicationsStop({ applicationId: state.applicationId, operationId: run.requestId });
      await waitFor('ended', application, value => !value?.current?.active, 120000);
    }
    if (activeRun === run.requestId) activeRun = null;
    if (run.launch) {
      const record = await native.readMarketLaunch(join(market, 'managed-launches', run.launch.instanceId + '.json'));
      need(record.status === 'CLOSED', 'ORIGINAL_LAUNCH_NOT_CLOSED');
    }
    need(!(await exists(join(market, 'operator-runtime.json'))), 'ORIGINAL_WORKSPACE_LEASE_RETAINED');
  }
  try {
    await stage('attach-save-connect', async () => {
      const attached = await model.attach({ directory: runtime, label: 'CoinGecko original managed receiving' });
      state.runtimeId = attached.runtimeId; await persist();
      if (!state.reviewId) {
        const review = await model.applicationsReview({
          runtimeId: state.runtimeId, kind: 'coingecko', label: input.applicationLabel ?? 'CoinGecko retained research',
          settings: { workspaceDirectory: market, projectId, port: input.port ?? 0,
            ...(input.configurationFile ? { configurationFile: resolve(input.configurationFile) } : {}),
            ...(input.allowLocalMerchant ? { allowLocalMerchant: true } : {}) },
        });
        state.reviewId = review.id; await persist();
      }
      const saved = await model.applicationsSave({ requestId: uuidFor(input.operationPrefix + ':save'),
        reviewId: state.reviewId });
      state.applicationId = saved.applicationId; await persist();
      if (saved.connectionError) throw Object.assign(new Error(saved.connectionError.message), saved.connectionError);
      const ready = await waitFor('connection', application, value => Boolean(value?.release), 300000);
      return { runtimeId: attached.runtimeId, applicationId: state.applicationId,
        releaseId: ready.release.id, sourceCommit: selected.sourceCommit, originalProjectId: projectId };
    });
    await stage('start-original-research', async () => {
      const current = await start('first'), url = current.current.privateUrl;
      const project = await api(url, '/api/projects/' + projectId);
      const originals = await sources(url);
      const rows = {};
      for (const kind of ['requests','collections','captures','snapshots','comparisons','notes','provider-plans','jobs'])
        rows[kind] = (await list(url, kind)).length;
      need(rows.requests >= 5 && rows.captures >= 10 && rows.snapshots >= 2 && rows.comparisons >= 1,
        'COMPLETE_ORIGINAL_RESEARCH_REQUIRED');
      state.originalCounts = rows; await persist();
      return { projectId, revision: project.project.revision, originalSources: originals, counts: rows,
        instanceId: state.runs.first.launch.instanceId };
    });
    if (!state.completed['stop-and-reopen']) {
      let current = await application();
      if (!current?.current?.active) current = await start('first');
      await stage('research-edit-and-browser', async () => {
        const url = current.current.privateUrl, comparisons = await list(url, 'comparisons');
        const note = await retainedWrite(url, 'managed-research-note', '/api/projects/' + projectId + '/notes', {
          note: { targetType: 'comparison', targetId: comparisons[0].id,
            title: 'Managed research delivery and source continuity',
            text: 'This comparison retains the original five CoinGecko endpoint families and their captured provider sources. The installed Applications workflow opens this same project, its request collection, snapshots and provider plan. Source downloads were checked against the original input hashes. Future acquisition should be evaluated against the original request and provider observation time recorded in each capture.',
            type: 'research', status: 'reviewed',
            sourceFileIds: input.originalSources.map(item => item.fileId) },
        });
        let browserResult = null;
        if (input.playwrightModule) {
          const imported = await import(pathToFileURL(resolve(input.playwrightModule)).href);
          const chromium = imported.chromium ?? imported.default?.chromium;
          need(chromium, 'ORIGINAL_BROWSER_RUNTIME_REQUIRED');
          const browser = await chromium.launch({ headless: true,
            ...(input.browserExecutable ? { executablePath: resolve(input.browserExecutable) } : {}) });
          try {
            const errors = [], context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
            await page.locator('#project-select').waitFor();
            need(await page.locator('#project-select').inputValue() === projectId, 'BROWSER_PROJECT_SELECTION_CHANGED');
            need(!/could not open/i.test(await page.locator('#main').innerText()), 'BROWSER_WORKSPACE_FAILED');
            await page.screenshot({ path: join(output, 'coingecko-managed-desktop.png'), fullPage: true });
            await page.setViewportSize({ width: 390, height: 844 });
            await page.screenshot({ path: join(output, 'coingecko-managed-mobile.png'), fullPage: true });
            need(errors.length === 0, 'BROWSER_RUNTIME_ERROR');
            browserResult = { desktop: [1440,960], mobile: [390,844], errors };
            await context.close();
          } finally { await browser.close(); }
        }
        return { noteId: note.value.id, originalComparisonId: comparisons[0].id, browser: browserResult };
      });
    }
    await stage('stop-and-reopen', async () => {
      await stop('first'); await model.close();
      model = await openRuntimeWorkspace({ directory: consoleDirectory });
      const current = await start('second'), originalSources = await sources(current.current.privateUrl);
      need(state.runs.first.launch.instanceId !== state.runs.second.launch.instanceId,
        'REOPENED_INSTANCE_ID_REUSED');
      return { applicationId: state.applicationId, projectId, originalSources,
        closedInstanceId: state.runs.first.launch.instanceId,
        reopenedInstanceId: state.runs.second.launch.instanceId };
    });
    if (!state.completed['interrupt-and-recover'] && !state.runs.second.interrupted) {
      const current = await application();
      if (!current?.current?.active) await start('second');
    }
    await stage('interrupt-and-recover', async () => {
      let current = await application(), run = state.runs.second;
      if (!run.interrupted) {
        need(current?.current?.id === run.requestId && current.current.active, 'ORIGINAL_INTERRUPT_TARGET_REQUIRED');
        const live = await api(current.current.privateUrl, '/api/managed-launch');
        need(live.instanceId === run.launch.instanceId && live.pid === run.launch.pid, 'ORIGINAL_INTERRUPT_INSTANCE_CHANGED');
        run.interrupted = { instanceId: live.instanceId, pid: live.pid, at: new Date().toISOString() };
        await persist();
      }
      current = await application();
      if (current?.current?.id === run.requestId && current.current.active) {
        const live = await api(current.current.privateUrl, '/api/managed-launch');
        need(live.instanceId === run.interrupted.instanceId && live.pid === run.interrupted.pid,
          'ORIGINAL_INTERRUPT_INSTANCE_CHANGED');
        try { process.kill(live.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      await waitFor('ended', application, value => !value?.current?.active, 120000);
      activeRun = null;
      current = await application();
      if (current.phase === 'INTERRUPTED')
        await model.applicationsRecover({ applicationId: state.applicationId, operationId: run.requestId });
      const ended = await application();
      need(!ended.current.privateUrl, 'INTERRUPTED_URL_REUSED');
      current = await start('recovered');
      const originalSources = await sources(current.current.privateUrl);
      return { originalRunId: run.requestId, originalInstance: run.interrupted,
        recoveredRunId: state.runs.recovered.requestId, projectId, originalSources };
    });
    if (!state.completed['final-stop-and-reopen-data']) {
      const current = await application();
      if (!current?.current?.active) await start('recovered');
    }
    await stage('handover-source-and-receiving', async () => {
      const current = await application();
      need(current?.current?.privateUrl, 'ORIGINAL_RECOVERED_APPLICATION_REQUIRED');
      const url = current.current.privateUrl;
      const result = await retainedWrite(url, 'complete-managed-handover', '/api/projects/' + projectId + '/exports',
        { name: 'Complete CoinGecko managed research and recovery' });
      const bytes = await download(url, '/api/exports/' + result.value.id + '/download');
      const archivePath = join(output, 'coingecko-managed-complete-handover.json.gz');
      await writeFile(archivePath, bytes, { mode: 0o600 });
      const recovery = await originalModule(source, C + 'workspace/recovery.mjs');
      const archive = recovery.readProjectArchive(bytes);
      need(archive.runtime.files.some(file => file.path.endsWith('/workspace/managed.mjs')),
        'PORTABLE_MANAGED_LAUNCH_SOURCE_MISSING');
      const { startMarketWorkspace } = await originalModule(source, C + 'workspace/server.mjs');
      const receiving = await startMarketWorkspace({ directory: resolve(input.receivingDirectory), port: 0 });
      try {
        const restored = await retainedWrite(receiving.url, 'receive-complete-managed-handover', '/api/restore',
          { name: 'Received CoinGecko managed research', contentBase64: bytes.toString('base64') }, null);
        const restoredId = restored.value.project.id;
        const originalSources = await sources(receiving.url, restoredId, true);
        state.receivedProjectId = restoredId; await persist();
        return { exportId: result.value.id, archivePath, bytes: bytes.length, sha256: sha(bytes),
          restoredProjectId: restoredId, originalSources, runtimeFiles: archive.runtime.files.length };
      } finally { await receiving.close(); }
    });
    await stage('final-stop-and-reopen-data', async () => {
      await stop('recovered');
      const binding = await native.inspectMarketBinding(market, { projectId });
      need(binding.identity.device === initialBinding.identity.device &&
        binding.identity.inode === initialBinding.identity.inode &&
        binding.database.device === initialBinding.database.device &&
        binding.database.inode === initialBinding.database.inode,
      'ORIGINAL_DATABASE_REPLACED');
      const { MarketModel } = await originalModule(source, C + 'workspace/model.mjs');
      const retained = new MarketModel(market), received = new MarketModel(resolve(input.receivingDirectory));
      try {
        const original = retained.project(projectId), restored = received.project(state.receivedProjectId);
        need(original.counts.jobs === state.originalCounts.jobs, 'UNREQUESTED_NATIVE_JOB_CREATED');
        return { projectId, receivedProjectId: state.receivedProjectId, counts: original.counts,
          receivedCounts: restored.counts, originalDatabase: binding.database, newPurchases: 0 };
      } finally { received.close(); retained.close(); }
    });
    const result = { schema: 'stellar-forge.coingecko-applications-receiving-result.v1',
      completedAt: new Date().toISOString(), applicationId: state.applicationId,
      projectId, receivedProjectId: state.receivedProjectId, runtimeDirectory: runtime,
      sourceCommit: selected.sourceCommit, sourceManifestSha256: selected.sourceManifestSha256,
      stages: state.completed, runs: state.runs, newPurchases: 0 };
    await save(join(output, 'NATIVE_APPLICATIONS_RECEIVING_RESULT.json'), result);
    return result;
  } finally {
    if (activeRun) {
      const current = await application().catch(() => null);
      if (current?.current?.id === activeRun && current.current.active) {
        await model.applicationsStop({ applicationId: state.applicationId, operationId: activeRun }).catch(() => {});
        await waitFor('ended', application, value => !value?.current?.active, 120000).catch(() => {});
      }
    }
    await model.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    need(['--manifest','--out'].includes(args[i]) && args[i + 1], 'USE_MANIFEST_AND_OUT');
    options[args[i].slice(2)] = args[i + 1];
  }
  receiveCoinGeckoApplication({ manifest: options.manifest, output: options.out }).then(result =>
    process.stdout.write(JSON.stringify({ complete: true, applicationId: result.applicationId,
      projectId: result.projectId, stages: Object.keys(result.stages).length, newPurchases: 0 }) + '\n')
  ).catch(error => { process.stderr.write(JSON.stringify({ code: error.code, message: error.message,
    stack: error.stack }) + '\n'); process.exitCode = 1; });
}
