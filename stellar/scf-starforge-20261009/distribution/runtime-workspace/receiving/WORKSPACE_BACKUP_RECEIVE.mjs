#!/usr/bin/env node
// MIT. One retained native operating case; not a default test or CI entrypoint.
import { constants, createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, rename, open, stat, lstat, symlink, copyFile, readlink } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--source', '--operation', '--chromium', '--playwright-root'].includes(process.argv[i]) || !process.argv[i + 1])
    throw new Error('Use --source RUNTIME_WORKSPACE_SOURCE --operation PRIVATE_CASE --chromium EXISTING_CHROME [--playwright-root NODE_MODULES].');
  options[process.argv[i]] = process.argv[i + 1];
}
for (const key of ['--source', '--operation', '--chromium']) if (!options[key]) throw new Error('Missing ' + key);
const sourceRoot = resolve(options['--source']), root = resolve(options['--operation']);
const identity = 'SCF-RUNTIME-WORKSPACE-BACKUP-9F05-20261013';
await mkdir(root, { recursive: true, mode: 0o700 });
const { createRuntimeWorkspace, openRuntimeWorkspace } = await import(pathToFileURL(join(sourceRoot, 'model.mjs')));
const { startRuntimeWorkspace } = await import(pathToFileURL(join(sourceRoot, 'server.mjs')));
const { withWorkspaceWrite, saveJSON, readJSON, privateDirectory, processIdentity, operationLease } =
  await import(pathToFileURL(join(sourceRoot, 'storage.mjs')));
await privateDirectory(root);
const nativeLease = await operationLease(join(root,'native-case.lock'));
const files = {
  journal: join(root, 'OPERATING_CASE.json'), source: join(root, 'original-workspace'),
  retainedSource: join(root, 'retained-original-workspace'), control: join(root, 'receiving-control'),
  externalHome: join(root, 'external-runtime-home'), retainedHome: join(root, 'retained-external-runtime-home'),
  backups: join(root, 'source-backups'), receiving: join(root, 'receiving-backups'),
  output: join(root, 'operator-output'), screenshots: join(root, 'screens'),
};
for (const path of [files.output, files.screenshots]) await mkdir(path, { recursive: true, mode: 0o700 });
const exists = async path => { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
let caseState;
try { caseState = JSON.parse(await readFile(files.journal, 'utf8')); }
catch (e) {
  if (e.code !== 'ENOENT') throw e;
  caseState = { schema: 'starforge.workspace-backup.native-case.v1', operationId: identity,
    directory: root, sourceRoot, createdAt: new Date().toISOString(), steps: {}, ids: {}, attempts: [] };
}
if (caseState.operationId !== identity || caseState.directory !== root || caseState.sourceRoot !== sourceRoot)
  throw new Error('The retained native case has different original inputs.');
const now = () => new Date().toISOString(), check = (value, message) => { if (!value) throw new Error(message); };
async function checkpoint() { await saveJSON(files.journal, caseState, true); }
for (const name of ['writerReview','installationReview','review','export','restore','upload'])
  caseState.ids[name] ??= randomUUID();
caseState.inputSeed ??= randomUUID();
function id(name) { check(Boolean(caseState.ids[name]), 'Original request ID was not retained: ' + name); return caseState.ids[name]; }
async function step(name, action) {
  if (caseState.steps[name]?.status === 'COMPLETE') return caseState.steps[name].result;
  caseState.steps[name] ??= { startedAt: now() };
  caseState.steps[name].status = 'RUNNING'; await checkpoint();
  try {
    const result = await action();
    caseState.steps[name] = { ...caseState.steps[name], status: 'COMPLETE', completedAt: now(), result };
    await checkpoint(); process.stdout.write(JSON.stringify({ step: name, status: 'COMPLETE', result }) + '\n');
    return result;
  } catch (error) {
    caseState.steps[name] = { ...caseState.steps[name], status: 'INTERRUPTED', interruptedAt: now(),
      error: { code: error.code ?? null, message: error.message } };
    await checkpoint(); throw error;
  }
}
async function hashFile(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const hash = createHash('sha256'); let bytes = 0;
  try { for await (const chunk of handle.createReadStream({ autoClose: false })) { hash.update(chunk); bytes += chunk.length; } }
  finally { await handle.close(); }
  return { bytes, sha256: hash.digest('hex') };
}
async function command(name, args, { input = null } = {}) {
  const commandDirectory = join(files.output,'attempts',attempt.id);
  await mkdir(commandDirectory,{recursive:true,mode:0o700});
  const output = join(commandDirectory,name+'.stdout'), error=join(commandDirectory,name+'.stderr');
  caseState.commandAttempts ??= [];
  caseState.commandAttempts.push({attemptId:attempt.id,name,args,output,error,startedAt:now()});
  await checkpoint();
  const out = await open(output, 'wx', 0o600), err = await open(error, 'wx', 0o600);
  try {
    const child = spawn(process.execPath, [join(sourceRoot, 'cli.mjs'), ...args],
      { cwd: root, shell: false, stdio: ['pipe', out.fd, err.fd, nativeLease.fd] });
    if (input !== null) child.stdin.end(input); else child.stdin.end();
    const [code, signal] = await once(child, 'exit');
    check(code === 0, name + ' failed (' + code + '/' + signal + '): ' + (await readFile(error, 'utf8')).slice(-4000));
    return JSON.parse(await readFile(output, 'utf8'));
  } finally { await out.close(); await err.close(); }
}
async function waitOperation(model, storageDirectory, operationId, { timeout = 180000 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const state = await model.workspaceBackupState({ storageDirectory });
    const value = state.operations.find(item => item.operationId === operationId);
    if (value?.phase === 'COMPLETE') return value;
    if (value?.phase === 'FAILED') throw Object.assign(new Error(value.error?.message ?? 'Operation failed'), { code: value.error?.code, operation: value });
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error('Original operation remains pending: ' + operationId);
}
async function sourceCohort() {
  const destination = join(files.source, 'operating-source');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const selected = [];
  async function copy(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = join(directory, item.name), path = relative(sourceRoot, name);
      if (item.isDirectory() && item.name === 'public') await copy(name);
      else if (item.isFile() && /\.(?:mjs|py|html|css|md|mts|json)$/.test(item.name)) {
        const target = join(destination, path);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        if (!await exists(target)) await copyFile(name, target, constants.COPYFILE_EXCL);
        const original = await hashFile(name), actual = await hashFile(target);
        check(original.sha256 === actual.sha256 && original.bytes === actual.bytes, 'Original source cohort changed: ' + path);
        selected.push({ path, ...actual });
      }
    }
  }
  await copy(sourceRoot);
  return selected.sort((a, b) => a.path.localeCompare(b.path));
}
async function createBinary(path) {
  const wanted = 129 * 65536, existed = await exists(path);
  const file = await open(path, existed ? 'r+' : 'wx', 0o600);
  try {
    const before = await file.stat();
    check(before.size <= wanted, 'Original binary input exceeds its retained intended size.');
    const chunk = Buffer.alloc(65536);
    for (let i = 0; i < 129; i++) {
      for (let j = 0; j < chunk.length; j += 32)
        createHash('sha256').update(caseState.inputSeed + ':' + i + ':' + j).digest().copy(chunk,j);
      const start = i * chunk.length;
      if (before.size > start) {
        const actual = Buffer.alloc(Math.min(chunk.length,before.size-start));
        await file.read(actual,0,actual.length,start);
        check(actual.equals(chunk.subarray(0,actual.length)), 'Original generated input prefix changed.');
      }
      const offset = Math.max(0, before.size-start);
      if (offset < chunk.length) {
        let used = offset;
        while (used < chunk.length) {
          const value = await file.write(chunk,used,chunk.length-used,start+used);
          check(value.bytesWritten>0,'Original input write made no progress.'); used += value.bytesWritten;
        }
      }
    }
    await file.sync();
  } finally { await file.close(); }
  return hashFile(path);
}
async function acquireInstallChild(path) {
  const program = [
    'import os,sys,fcntl,json',
    'fd=os.open(sys.argv[1],os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)',
    'fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)',
    'print(json.dumps({"pid":os.getpid(),"held":True}),flush=True)',
    'sys.stdin.buffer.read(1)',
    'os.close(fd)',
  ].join('\n');
  const child = spawn('python3', ['-u', '-c', program, path], { cwd: root, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stderr.on('data', text => { err += text; });
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Installation lease child did not report readiness: ' + err)), 10000);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.stdout.on('data', text => { out += text; if (out.includes('\n')) { clearTimeout(timer); done(); } });
    child.once('exit', code => { if (!out.includes('\n')) { clearTimeout(timer); reject(new Error('Installation lease child exited ' + code + ': ' + err)); } });
  });
  const receipt = JSON.parse(out.split('\n')[0]); check(receipt.held, 'The real native installation lease was not held.');
  return { child, receipt, async close() {
    if (child.exitCode !== null) return;
    child.stdin.end('x');
    await once(child, 'exit');
  } };
}
async function rejected(action) {
  try { await action(); } catch (error) { return { code: error.code ?? null, message: error.message }; }
  throw new Error('A live original writer was accepted for backup.');
}
let original = null, control = null, server = null, browser = null;
const attempt = { id: randomUUID(), startedAt: now(), status: 'RUNNING' };
caseState.attempts.push(attempt); await checkpoint();
try {
  await step('selected_runtime_browser_assets', async () => {
    const manifest = JSON.parse(await readFile(join(sourceRoot,'browser-assets.json'),'utf8'));
    const route = manifest.routes.find(row=>row[0]==='/workspace-receiving.mjs');
    check(route?.[1]?.[0]==='workspace-receiving.mjs','Selected runtime browser manifest omits the receiving screen.');
    const asset = await hashFile(join(sourceRoot,'public',route[1][0]));
    return {manifest:await hashFile(join(sourceRoot,'browser-assets.json')),route,asset};
  });
  await step('create_original_workspace', async () => {
    let config;
    if (await exists(join(files.source, 'workspace.json'))) config = await readJSON(join(files.source, 'workspace.json'));
    else config = await createRuntimeWorkspace({ directory: files.source, runtimeHome: files.externalHome });
    check(config.directory === files.source, 'Original workspace location differs.');
    caseState.workspaceId = config.workspaceId;
    const inputs = join(files.source, 'customer-records'); await mkdir(inputs, { recursive: true, mode: 0o700 });
    const text = 'Original receiving record — source, history, café and UTF-8.\n';
    if (!await exists(join(inputs, 'record.txt'))) await writeFile(join(inputs, 'record.txt'), text, { flag: 'wx', mode: 0o600 });
    if (!await exists(join(inputs, 'record-link'))) await symlink('record.txt', join(inputs, 'record-link'));
    const binary = await createBinary(join(inputs, 'binary.dat'));
    const cohort = await sourceCohort();
    const child = spawn('python3', ['-c',
      'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("create table if not exists receiving(id text primary key, note text)"); c.execute("insert or ignore into receiving values (?,?)",("original","retained native source and operator history")); c.commit(); c.close()',
      join(inputs, 'records.sqlite')], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const [code] = await once(child, 'exit'); check(code === 0, 'Native SQLite input creation failed.');
    return { workspaceId: config.workspaceId, binary, sourceFiles: cohort, sqlite: await hashFile(join(inputs, 'records.sqlite')) };
  });
  if (!caseState.steps.move_original_to_retained?.result) {
    if (await exists(join(files.source,'workspace.json'))) {
      const config = await readJSON(join(files.source,'workspace.json'));
      check(config.workspaceId === caseState.workspaceId,'Original source identity changed before moving.');
      original = await openRuntimeWorkspace({directory:files.source});
    } else {
      const retained = await readJSON(join(files.retainedSource,'workspace.json'));
      check(retained.workspaceId === caseState.workspaceId && retained.directory === files.source,
        'The original stopped source was not retained after its move.');
      check(caseState.steps.inspect_complete_original_archive?.status === 'COMPLETE',
        'The original source moved before complete archive inspection.');
    }
  }
  await step('reject_live_workspace_writer', async () => {
    let entered, release;
    const held = new Promise(done => { entered = done; }), finish = new Promise(done => { release = done; });
    const writer = withWorkspaceWrite(files.source, async () => { entered(); await finish; });
    await held;
    try {
      return await rejected(() => original.workspaceBackupReview({ requestId: id('writerReview'), label: 'Native active-writer check', storageDirectory: files.backups }));
    } finally { release(); await writer; }
  });
  await step('reject_live_installation_lease', async () => {
    const target = join(files.source, 'customer-records', 'install.lock');
    const held = await acquireInstallChild(target);
    try {
      const result = await rejected(() => original.workspaceBackupReview({
        requestId: id('installationReview'), label: 'Native installation-lease check', storageDirectory: files.backups }));
      return { nativeLease: held.receipt, rejected: result };
    } finally { await held.close(); }
  });
  const review = await step('review_original_workspace', () => original.workspaceBackupReview({
    requestId: id('review'), label: 'Complete native operating workspace', storageDirectory: files.backups }));
  const exportOperation = await step('start_original_backup', () => original.workspaceBackupCreate({
    requestId: id('export'), reviewId: review.reviewId, reviewSha256: review.reviewSha256, storageDirectory: files.backups }));
  const exported = await step('complete_original_backup', () => waitOperation(original, files.backups, exportOperation.operationId));
  const archive = exported.result;
  await step('cli_complete_archive_download', async () => {
    const output = join(files.output, 'original-workspace-backup.tgz');
    if (await exists(output)) {
      const existing = await hashFile(output);
      check(existing.sha256 === archive.sha256 && existing.bytes === archive.bytes, 'Retained original download changed.');
      return { output, ...existing };
    }
    const result = await command('backup-download', ['workspace-backup-download', '--workspace', files.source,
      '--storage', files.backups, '--archive-id', archive.archiveId, '--output', output]);
    const actual = await hashFile(output);
    check(actual.sha256 === archive.sha256 && actual.bytes === archive.bytes, 'CLI archive identity differs.');
    return result;
  });
  const archivePath = caseState.steps.cli_complete_archive_download.result.output;
  await step('create_receiving_control', async () => {
    if (await exists(join(files.control, 'workspace.json'))) return readJSON(join(files.control, 'workspace.json'));
    return createRuntimeWorkspace({ directory: files.control });
  });
  control = await openRuntimeWorkspace({ directory: files.control });
  const inspected = await step('inspect_complete_original_archive', () => control.workspaceBackupInspect({
    archivePath, sha256: archive.sha256, storageDirectory: files.receiving }));
  check(inspected.review.workspaceId === caseState.workspaceId && inspected.review.directory === files.source,
    'Archive inspection changed the original workspace identity.');
  await step('move_original_to_retained', async () => {
    if (original) { await original.close(); original = null; }
    const sourceExists = await exists(files.source), retainedExists = await exists(files.retainedSource);
    if (retainedExists) {
      const config = await readJSON(join(files.retainedSource, 'workspace.json'));
      check(config.workspaceId === caseState.workspaceId, 'Retained source identity differs.');
      check(!sourceExists, 'Unrecorded original destination exists before restoration.');
    } else {
      check(sourceExists, 'Original source is absent before cold receiving.');
      await rename(files.source, files.retainedSource);
    }
    return { originalDirectory: files.source, retainedDirectory: files.retainedSource, workspaceId: caseState.workspaceId };
  });
  const restore = await step('start_original_restore', () => control.workspaceBackupRestore({
    requestId: id('restore'), archiveId: inspected.archiveId, manifestSha256: inspected.manifestSha256,
    directory: files.source, storageDirectory: files.receiving }));
  await step('interrupt_original_restore_child', async () => {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      const value = (await control.workspaceBackupState({ storageDirectory: files.receiving })).operations
        .find(item => item.operationId === restore.operationId);
      if (value?.phase === 'COMPLETE') return {operationId:restore.operationId,exercised:false,
        reason:'Original restore completed before a qualified interruption was confirmed.',completedOriginalPreserved:true};
      if (caseState.interruption?.operationId === restore.operationId) {
        const retained = caseState.interruption;
        const active = await processIdentity(retained.child.pid);
        if (active !== retained.child.processStart) {
          check(value?.workerActive === false && ['FAILED','INTERRUPTED'].includes(value.phase),
            'Original restore writer is not locally identifiable; retain its original lease until its stopped state is observable.');
          const marker = await readJSON(join(files.source,'.workspace-backup-receiving.json'));
          check(marker.operationId === restore.operationId && marker.phase === 'RESTORING',
            'Original interrupted receiving marker is not retained.');
          return { ...retained, exercised:true, observedStoppedAt: now(), retainedPhase: value.phase };
        }
        // Resume only the same original qualified child, never a replacement.
        if (await readlink('/proc/self/ns/pid') !== retained.child.pidNamespace)
          throw new Error('Original restore child is in another PID namespace; retain its original worker lease.');
        process.kill(retained.child.pid, 'SIGKILL'); retained.signalSentAt = now(); retained.exercised = true; await checkpoint(); return retained;
      }
      const child = value?.child;
      if (Number.isInteger(child?.pid) && typeof child.processStart === 'string' &&
          child.pidNamespace === await readlink('/proc/self/ns/pid') &&
          Number.isInteger(value.restoredFiles) && await processIdentity(child.pid) === child.processStart) {
        caseState.interruption = { operationId: restore.operationId, child, observedAt: now(),
          restoredFiles: value.restoredFiles ?? null, signal: 'SIGKILL' };
        await checkpoint();
        // This exact descendant PID is resolved through the current namespace
        // and its original start identity immediately before the signal.
        if (await processIdentity(child.pid) !== child.processStart) continue;
        process.kill(child.pid, 'SIGKILL');
        caseState.interruption.signalSentAt = now(); caseState.interruption.exercised = true; await checkpoint();
        return caseState.interruption;
      }
      await new Promise(done => setTimeout(done, 5));
    }
    throw new Error('No qualified original restore child was observed; no process was signalled.');
  });
  await step('observe_original_restore_interruption', async () => {
    if (caseState.steps.interrupt_original_restore_child.result.exercised === false) {
      const complete = (await control.workspaceBackupState({storageDirectory:files.receiving})).operations.find(item=>item.operationId===restore.operationId);
      check(complete?.phase==='COMPLETE','Completed original restore is no longer retained.'); return complete;
    }
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      const value = (await control.workspaceBackupState({ storageDirectory: files.receiving })).operations
        .find(item => item.operationId === restore.operationId);
      if (value?.workerActive === false && ['FAILED','INTERRUPTED'].includes(value.phase)) return value;
      await new Promise(done => setTimeout(done, 50));
    }
    throw new Error('Original restore writer remains unresolved; continuation has not been started.');
  });
  const nodeModules = options['--playwright-root'] ?? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
  check(nodeModules, 'Supply the existing Playwright module root.');
  const { chromium } = await import(pathToFileURL(join(nodeModules, 'playwright', 'index.mjs')));
  server = await startRuntimeWorkspace({ directory: files.control, port: 0 });
  const tmp = join(root, 'browser-tmp'); await mkdir(tmp, { recursive: true, mode: 0o700 });
  browser = await chromium.launch({ executablePath: resolve(options['--chromium']), headless: true,
    env: { ...process.env, TMPDIR: tmp }, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1360, height: 950 }, acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.url);
  await step('selected_runtime_serves_receiving_asset', async () => {
    const response = await page.request.get(server.origin+'/workspace-receiving.mjs');
    check(response.ok(),'Installed Runtime server does not serve the selected receiving module.');
    const bytes = await response.body(), sha256=createHash('sha256').update(bytes).digest('hex');
    check(sha256===caseState.steps.selected_runtime_browser_assets.result.asset.sha256,'Served receiving asset differs from the selected native source.');
    return {bytes:bytes.length,sha256};
  });
  await page.locator('[data-view="workspace-backups"]').click();
  await page.locator('#wb-storage').fill(files.receiving);
  await page.getByRole('button', { name: 'Open backup storage', exact: true }).click();
  const row = page.locator('#wb-operations article').filter({ hasText: restore.operationId });
  await row.waitFor();
  await step('browser_continue_same_restore', async () => {
    const retained = (await control.workspaceBackupState({ storageDirectory: files.receiving })).operations.find(item => item.operationId === restore.operationId);
    if (retained?.phase !== 'COMPLETE')
      await row.getByRole('button', { name: /^(Check or continue|Continue) original operation$/ }).click();
    const result = await waitOperation(control, files.receiving, restore.operationId);
    check(result.operationId === restore.operationId && result.result.workspaceId === caseState.workspaceId,
      'Browser continuation changed original restore identity.');
    return result;
  });
  const restored = caseState.steps.browser_continue_same_restore.result.result;
  await step('compare_restored_native_inputs', async () => {
    const paths = ['customer-records/record.txt', 'customer-records/binary.dat', 'customer-records/records.sqlite',
      ...caseState.steps.create_original_workspace.result.sourceFiles.map(file => 'operating-source/' + file.path)];
    for (const path of paths) {
      const before = await hashFile(join(files.retainedSource, path)), after = await hashFile(join(files.source, path));
      check(before.bytes === after.bytes && before.sha256 === after.sha256, 'Restored original file differs: ' + path);
    }
    check(await readlink(join(files.source,'customer-records','record-link')) === 'record.txt', 'Retained relative link changed.');
    return { filesVerified: paths.length, relativeLinksVerified: 1, workspaceId: caseState.workspaceId, directory: files.source };
  });
  await step('review_missing_external_binding', async () => {
    if (await exists(files.externalHome)) await rename(files.externalHome, files.retainedHome);
    const review = await control.workspaceBackupBindings({ receivingId: restored.receivingId, storageDirectory: files.receiving });
    check(review.runtimeHomeReady === false && review.canOpen === false, 'Missing original external home was not surfaced.');
    const recoveredObserver = await openRuntimeWorkspace({ directory: files.source });
    const state = await recoveredObserver.workspaceBackupState();
    check(state.workspaceId === caseState.workspaceId, 'Pending receiving observer could not read its original identity.');
    check(state.storageDirectory === files.receiving, 'Restored observer did not retain the original receiving storage.');
    await recoveredObserver.close();
    return review;
  });
  await step('restore_external_home', async () => {
    if (!await exists(files.externalHome)) await rename(files.retainedHome, files.externalHome);
    await privateDirectory(files.externalHome); return { path: files.externalHome };
  });
  await step('browser_binding_review_and_reopen', async () => {
    await page.locator('#wb-refresh').click();
    await row.getByRole('button', { name: 'Review restored bindings', exact: true }).click();
    await page.getByRole('button', { name: 'Record review and show reopening command', exact: true }).click();
    await page.locator('#wb-bindings').getByRole('heading', { name: 'Reopen the restored workspace', exact: true }).waitFor();
    await page.screenshot({ path: join(files.screenshots, 'desktop-workspace-receiving.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(files.screenshots, 'phone-workspace-receiving.png'), fullPage: true });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'The receiving page overflows its phone viewport.');
    check(errors.length === 0, 'Browser errors: ' + errors.join('; '));
    return { receivingId: restored.receivingId, desktop: 'desktop-workspace-receiving.png',
      phone: 'phone-workspace-receiving.png', browserErrors: errors };
  });
  await step('resume_original_workspace_mutation', async () => {
    const model = await openRuntimeWorkspace({ directory: files.source });
    try {
      const state = await model.state();
      check(state.workspaceId === caseState.workspaceId, 'Restored workspace ID changed.');
      await withWorkspaceWrite(files.source, async () => {
        const path = join(files.source,'customer-records','receiving-opened.json');
        if (await exists(path)) {
          const prior = await readJSON(path);
          check(prior.workspaceId === caseState.workspaceId && prior.receivingId === restored.receivingId, 'Original reopening record differs.');
        } else await saveJSON(path,{workspaceId:caseState.workspaceId,receivingId:restored.receivingId,openedAt:now()});
      });
      return { workspaceId: state.workspaceId, mutation: 'customer-records/receiving-opened.json' };
    } finally { await model.close(); }
  });
  await step('start_original_partial_upload', async () => {
    const previous = (await control.workspaceBackupState({storageDirectory:files.receiving})).uploads.find(item=>item.uploadId===id('upload'));
    if (previous?.receivedBytes > 0 || previous?.complete) return previous;
    const stream = createReadStream(archivePath,{start:0,end:Math.min(1024*1024,archive.bytes-1)-1});
    try { return await control.workspaceBackupUpload({storageDirectory:files.receiving,requestId:id('upload'),
      sha256:archive.sha256,bytes:archive.bytes,offset:0,body:stream}); }
    finally {stream.destroy();}
  });
  await step('browser_resumable_archive_intake', async () => {
    await page.setViewportSize({ width: 1360, height: 950 });
    await page.locator('#wb-refresh').click();
    const selectedUpload = page.locator('#wb-uploads tr').filter({hasText:id('upload')});
    await selectedUpload.waitFor();
    const before = (await control.workspaceBackupState({storageDirectory:files.receiving})).uploads.find(item=>item.uploadId===id('upload'));
    if (before?.complete) {
      await selectedUpload.getByRole('button',{name:'Inspect retained archive',exact:true}).click();
    } else {
      await selectedUpload.getByRole('button',{name:'Continue this upload',exact:true}).click();
      await page.locator('#wb-file').setInputFiles(archivePath);
    await page.locator('#wb-sha').fill(archive.sha256);
      await page.getByRole('button', { name: 'Receive and inspect complete archive', exact: true }).click();
    }
    await page.locator('#wb-inspection').waitFor({ state: 'visible', timeout: 120000 });
    const state = await control.workspaceBackupState({ storageDirectory: files.receiving });
    const upload = state.uploads.find(item => item.uploadId === id('upload') && item.sha256 === archive.sha256 && item.complete);
    check(upload?.receivedBytes === archive.bytes, 'Browser did not retain the complete original archive.');
    await page.screenshot({ path: join(files.screenshots, 'desktop-archive-intake.png'), fullPage: true });
    return { uploadId: upload.uploadId, sha256: upload.sha256, bytes: upload.bytes, receivedBytes: upload.receivedBytes };
  });
  await step('final_cli_and_source_handover', async () => {
    const state = await command('receiving-status', ['workspace-backups', '--workspace', files.control, '--storage', files.receiving]);
    check(state.operations.some(item => item.operationId === restore.operationId && item.phase === 'COMPLETE'),
      'CLI no longer returns the completed original restore.');
    const summary = { operationId: identity, originalWorkspaceId: caseState.workspaceId,
      archive: { archiveId: archive.archiveId, sha256: archive.sha256, bytes: archive.bytes },
      exportOperationId: exportOperation.operationId, restoreOperationId: restore.operationId,
      receivingId: restored.receivingId, originalDirectory: files.source, retainedOriginal: files.retainedSource,
      controlDirectory: files.control, sourceRoot, interruption:caseState.steps.interrupt_original_restore_child.result, steps: Object.keys(caseState.steps), screenshots: await readdir(files.screenshots) };
    await saveJSON(join(files.output, 'COMPLETE_RECEIVING_RESULT.json'), summary, true);
    return summary;
  });
  attempt.status = 'COMPLETE'; attempt.completedAt = now(); await checkpoint();
  process.stdout.write(JSON.stringify({ status: 'COMPLETE', operation: identity, journal: files.journal,
    result: join(files.output, 'COMPLETE_RECEIVING_RESULT.json') }) + '\n');
} catch (error) {
  attempt.status = 'INTERRUPTED'; attempt.interruptedAt = now();
  attempt.error = { code: error.code ?? null, message: error.message };
  await checkpoint(); process.stderr.write(JSON.stringify(attempt) + '\n'); process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close().catch(() => {});
  if (control) await control.close().catch(() => {});
  if (original) await original.close().catch(() => {});
  await nativeLease.close();
}
