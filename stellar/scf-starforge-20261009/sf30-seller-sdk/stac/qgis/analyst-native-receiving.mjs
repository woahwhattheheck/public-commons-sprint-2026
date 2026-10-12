#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Continue one original QGIS project through its analyst, native maps and receiving.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {open, readFile, mkdir, realpath, lstat, rename, link, unlink} from 'node:fs/promises';
import {basename, dirname, join, resolve, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SCHEMA = 'starforge.stac-qgis-analyst-native-receiving.v1';
const RESULT = 'starforge.stac-qgis-analyst-native-result.v1';
const AUTH = 'X-Starforge-Qgis-Workspace';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function fault(code, message, details) { return Object.assign(new Error(message), {code, details}); }
async function optional(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function privateDirectory(path) {
  await mkdir(path, {recursive: true, mode: 0o700});
  const info = await lstat(path);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) && await realpath(path) === path,
    'Select a canonical private operation directory.');
}
async function atomic(path, bytes) {
  const temporary = path + '.' + randomUUID() + '.partial';
  let file;
  try {
    file = await open(temporary, 'wx', 0o600); await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
    await rename(temporary, path);
  } finally { await file?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function exact(path, bytes) {
  const temporary = path + '.' + randomUUID() + '.partial';
  let file;
  try {
    file = await open(temporary, 'wx', 0o600); await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assert.equal(await readFile(path, 'utf8'), bytes, 'Continue the exact original retained input: ' + basename(path));
    }
  } finally { await file?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function ordinaryFile(path, {symlinks = false} = {}) {
  const name = await realpath(resolve(path)), info = await lstat(symlinks ? name : resolve(path));
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'Select an existing ordinary input file.');
  return name;
}
function inside(root, path) { const rest = relative(root, path); return rest === '' || rest !== '..' && !rest.startsWith('..' + sep) && !rest.startsWith(sep); }
async function privateInput(path, maximum) {
  const info = await lstat(path);
  assert.ok(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077) && info.size <= maximum,
    'Use the selected existing private input file.');
  const bytes = await readFile(path);
  assert.ok(bytes.length <= maximum);
  return {value: JSON.parse(bytes.toString('utf8')), identity: {path, bytes: bytes.length, sha256: sha(bytes)}};
}
function processExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
function connection(value) {
  assert.equal(value.schema, 'starforge.stac-qgis-analyst-startup.v1');
  assert.equal(value.status, 'QGIS_ANALYST_READY');
  const url = new URL(value.operatorUrl);
  assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/'); assert.equal(url.search, ''); assert.equal(url.username, ''); assert.equal(url.password, '');
  assert.match(url.hash, /^#[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(value.pid) && value.pid > 0);
  return url;
}
async function http(url, path, {method = 'GET', body, headers = {}, binary = false, signal} = {}) {
  const response = await fetch(new URL(path, url), {method, redirect: 'error',
    headers: {[AUTH]: url.hash.slice(1), ...(method !== 'GET' && method !== 'HEAD' ? {origin: url.origin} : {}),
      ...(body !== undefined ? {'content-type': binary ? 'application/octet-stream' : 'application/json'} : {}), ...headers},
    ...(body !== undefined ? {body: binary || typeof body === 'string' ? body : JSON.stringify(body)} : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000)});
  if (binary && response.ok) return response;
  assert.match(response.headers.get('content-type') || '', /^application\/json(?:;|$)/i);
  const chunks = []; let count = 0;
  for await (const chunk of response.body) {
    count += chunk.length; assert.ok(count <= 33554432, 'The original control response exceeds its supported size.');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!response.ok) throw Object.assign(fault(value.error || 'ANALYST_NATIVE_HTTP', value.message || 'Original analyst request failed.', value.details), {status: response.status});
  return value;
}
async function download(url, path, target, expected, signal) {
  const response = await http(url, path, {binary: true, signal});
  assert.equal(response.status, 200);
  const advertised = response.headers.get('x-content-sha256');
  assert.match(advertised || '', HASH);
  const length = Number(response.headers.get('content-length'));
  assert.ok(Number.isSafeInteger(length) && length >= 0);
  if (expected) { assert.equal(advertised, expected.sha256); assert.equal(length, expected.bytes); }
  const temporary = target + '.partial', digest = createHash('sha256');
  const file = await open(temporary, 'w', 0o600); let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length; assert.ok(bytes <= length);
      digest.update(chunk); await file.writeFile(chunk);
    }
    await file.sync();
  } finally { await file.close(); }
  const measured = {bytes, sha256: digest.digest('hex')};
  assert.equal(bytes, length); assert.equal(measured.sha256, advertised);
  if (expected) { assert.equal(bytes, expected.bytes); assert.equal(measured.sha256, expected.sha256); }
  await rename(temporary, target);
  return {path: target, ...measured};
}
async function childResult(child, {maximum = 33554432} = {}) {
  const chunks = []; let bytes = 0;
  child.stdout?.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > maximum) child.kill('SIGTERM'); else chunks.push(chunk);
  });
  const errors = []; child.stderr?.on('data', chunk => { if (errors.reduce((n, x) => n + x.length, 0) < 131072) errors.push(chunk); });
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 && bytes <= maximum
      ? resolvePromise(Buffer.concat(chunks).toString('utf8'))
      : reject(fault('ANALYST_NATIVE_CHILD', 'The original child ended before completing its result.',
        {exitCode: code, signal, stderr: Buffer.concat(errors).toString('utf8')})));
  });
}
async function holdOutput(python, path) {
  const script = 'import os,sys,fcntl\nf=os.open(sys.argv[1],os.O_CREAT|os.O_RDWR|getattr(os,"O_NOFOLLOW",0),0o600)\nfcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nprint("HELD",flush=True)\nsys.stdin.buffer.read()\nos.close(f)\n';
  const child = spawn(python, ['-B', '-c', script, path], {stdio: ['pipe', 'pipe', 'pipe']});
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes.toString(); });
  const closed = new Promise((resolvePromise, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolvePromise({code, signal})); });
  await new Promise((resolvePromise, reject) => {
    child.stdout.once('data', bytes => bytes.toString().trim() === 'HELD' ? resolvePromise() : reject(new Error('Output lock not acquired.')));
    child.once('error', reject); child.once('exit', () => reject(fault('ANALYST_NATIVE_OUTPUT_ACTIVE', 'The original receiving output is owned by another active caller.', {detail: stderr})));
  });
  return {assertHeld() { assert.equal(child.exitCode, null, 'The original receiving output lease ended.'); },
    async close() { child.stdin.end(); await closed; }};
}

/** The caller selects an existing saved map and the same equipped QGIS host. */
export async function receiveQgisAnalyst(input, {signal, onProgress = value => process.stdout.write(JSON.stringify(value) + '\n')} = {}) {
  assert.equal(input?.schema, SCHEMA);
  const allowed = new Set(['schema', 'operationId', 'workspaceDirectory', 'outputRoot', 'pythonExecutable',
    'nativeRuntimeFile', 'playwrightModule', 'browserExecutable', 'actor', 'projectId', 'featureLayerId',
    'fieldRoundId', 'managerDirectory', 'runtimeDirectory', 'environmentFile', 'timeoutMs']);
  assert.ok(Object.keys(input).every(key => allowed.has(key)), 'Use the documented original receiving input.');
  assert.match(input.operationId || '', ID);
  const selected = {...input};
  for (const key of ['workspaceDirectory', 'outputRoot', 'pythonExecutable', 'nativeRuntimeFile', 'playwrightModule', 'browserExecutable']) {
    assert.ok(typeof selected[key] === 'string' && selected[key]); selected[key] = resolve(selected[key]);
  }
  for (const key of ['managerDirectory', 'runtimeDirectory', 'environmentFile']) if (selected[key]) selected[key] = resolve(selected[key]);
  assert.equal(!!selected.managerDirectory, !!selected.runtimeDirectory, 'Select the original manager and READY runtime together.');
  for (const key of ['pythonExecutable', 'nativeRuntimeFile', 'playwrightModule', 'browserExecutable'])
    selected[key] = await ordinaryFile(selected[key], {symlinks: key !== 'nativeRuntimeFile'});
  const nativeInput = await privateInput(selected.nativeRuntimeFile, 65536);
  const environmentInput = selected.environmentFile ? await privateInput(await ordinaryFile(selected.environmentFile), 1048576) : null;
  if (environmentInput) assert.ok(environmentInput.value && typeof environmentInput.value === 'object' && !Array.isArray(environmentInput.value) &&
    Object.entries(environmentInput.value).every(([name, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && typeof value === 'string' && !value.includes('\u0000')),
    'Use the original private Applications environment JSON.');
  const environment = {...process.env, ...(environmentInput?.value || {})};
  const selectedInputs = {nativeRuntime: nativeInput.identity, environment: environmentInput?.identity || null,
    driverSha256: sha(await readFile(fileURLToPath(import.meta.url)))};
  selected.actor ||= 'Original QGIS receiving analyst';
  assert.ok(typeof selected.actor === 'string' && selected.actor.trim());
  for (const key of ['projectId', 'featureLayerId', 'fieldRoundId']) if (selected[key]) assert.match(selected[key], ID);
  const timeout = selected.timeoutMs ?? 600000;
  assert.ok(Number.isSafeInteger(timeout) && timeout >= 60000 && timeout <= 3600000);
  await privateDirectory(selected.outputRoot);
  assert.equal(await realpath(selected.workspaceDirectory), selected.workspaceDirectory);
  assert.ok(!inside(selected.outputRoot, selected.workspaceDirectory) && !inside(selected.workspaceDirectory, selected.outputRoot),
    'Keep receiving output separate from the active original workspace.');
  const output = selected.outputRoot, recordPath = join(output, 'analyst-native-record.json');
  const lease = await holdOutput(selected.pythonExecutable, join(output, '.analyst-receiving.lock'));
  const identity = sha(JSON.stringify(canonical({selected, selectedInputs})));
  let record, model, browser, page, currentSession, primary, receivedSession, primaryError;
  const owned = new Set(), browserErrors = [];
  const check = () => { lease.assertHeld(); signal?.throwIfAborted(); };
  async function save() {
    lease.assertHeld(); record.updatedAt = new Date().toISOString();
    await atomic(recordPath, json(record));
  }
  async function note(phase, value = {}) { record.phase = phase; await save(); await onProgress({operationId: selected.operationId, phase, ...value}); }
  async function wait(label, read) {
    const end = Date.now() + timeout; let previous = '';
    for (;;) {
      check(); const result = await read();
      if (result.done) return result.value;
      const status = JSON.stringify(result.progress ?? {});
      if (status !== previous) { previous = status; await onProgress({operationId: selected.operationId, phase: label, ...result.progress}); }
      if (Date.now() >= end) throw fault('ANALYST_NATIVE_WAIT', 'Continue the retained original receiving operation.', {phase: label});
      await pause(1000, undefined, {signal});
    }
  }
  async function currentApplication(id) { return (await model.applicationsState()).applications.find(row => row.id === id); }
  async function findRun(id, runId) {
    const app = await currentApplication(id); assert.ok(app);
    let found = app.runs.find(row => row.id === runId), cursor = app.history?.nextCursor;
    const seen = new Set();
    while (!found && cursor) {
      assert.ok(!seen.has(cursor)); seen.add(cursor);
      const next = await model.applicationsHistory({applicationId: id, limit: app.history.limit, cursor});
      found = next.runs.find(row => row.id === runId); cursor = next.nextCursor;
    }
    return found;
  }
  async function managedStart(name, workspace) {
    const sessions = record.sessions[name] ||= {};
    if (!sessions.applicationId) {
      if (!sessions.reviewId) {
        const review = await model.applicationsReview({runtimeId: record.runtimeId, kind: 'stac-qgis-analyst',
          label: 'Original QGIS analyst receiving ' + name,
          settings: {workspaceDirectory: workspace, pythonExecutable: selected.pythonExecutable,
            nativeRuntimeFile: selected.nativeRuntimeFile,
            ...(selected.environmentFile ? {environmentFile: selected.environmentFile} : {})}});
        sessions.reviewId = review.id; sessions.saveRequestId = randomUUID(); await save();
      }
      const saved = await model.applicationsSave({requestId: sessions.saveRequestId, reviewId: sessions.reviewId});
      sessions.applicationId = saved.applicationId; await save();
      if (saved.connectionError) throw fault(saved.connectionError.code, saved.connectionError.message);
    }
    let app = await currentApplication(sessions.applicationId); assert.ok(app);
    if (!app.release) await model.applicationsConnect({applicationId: app.id});
    await wait('CONNECTING-' + name, async () => {
      const value = await currentApplication(sessions.applicationId);
      if (value.error) throw fault(value.error.code, value.error.message);
      if (value.adoption && !value.adoption.active && ['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(value.adoption.phase))
        throw fault('ANALYST_NATIVE_ADOPTION', 'Continue this original saved application connection.', {operationId: value.adoption.id});
      return {done: !!value.release, value, progress: {phase: value.phase}};
    });
    let run = sessions.run, previous = run && await findRun(sessions.applicationId, run.requestId);
    if (previous && !previous.active && previous.phase === 'INTERRUPTED') {
      const recovered = await model.applicationsRecover({applicationId: sessions.applicationId, operationId: run.requestId});
      if (recovered.commandActive) await managedStop(name);
      previous = await findRun(sessions.applicationId, run.requestId);
    }
    if (!run || previous && !previous.active && terminal.has(previous.phase)) {
      const review = await model.applicationsStartReview({applicationId: sessions.applicationId});
      if (run) (sessions.previousRuns ||= []).push({...run, phase: previous.phase, result: previous.result ?? null});
      run = sessions.run = {requestId: randomUUID(), reviewId: review.id}; await save();
    }
    await model.applicationsStart({applicationId: sessions.applicationId, requestId: run.requestId, reviewId: run.reviewId});
    let recovered = false, quiet = 0;
    const active = await wait('STARTING-' + name, async () => {
      const value = await findRun(sessions.applicationId, run.requestId); assert.ok(value);
      if (!value.active && ['PENDING', 'QUEUED', 'INTERRUPTED'].includes(value.phase)) {
        if (!recovered && (previous || ++quiet >= 3)) {
          recovered = true; await model.applicationsRecover({applicationId: sessions.applicationId, operationId: run.requestId});
        } else if (recovered && value.phase === 'INTERRUPTED') throw fault('ANALYST_NATIVE_INTERRUPTED', 'Continue the same saved application operation.', {operationId: run.requestId});
      }
      if (!value.active && terminal.has(value.phase)) throw fault('ANALYST_NATIVE_APP_CLOSED', 'The original application ended before receiving completed.', {phase: value.phase, result: value.result});
      return {done: value.active && !value.stop && !!value.privateUrl, value, progress: {phase: value.phase}};
    });
    const url = new URL(active.privateUrl), startup = await http(url, '/api/launch', {signal});
    connection(startup); assert.equal(startup.workspaceDirectory, workspace);
    run.instanceId = startup.instanceId; await save();
    return {name, url, startup, managed: true};
  }
  async function managedStop(name) {
    const session = record.sessions[name], run = session?.run;
    if (!run || run.stopped) return;
    const original = await findRun(session.applicationId, run.requestId); assert.ok(original);
    if (original.active || ['PENDING', 'QUEUED', 'RUNNING', 'INTERRUPTED'].includes(original.phase)) {
      await model.applicationsStop({applicationId: session.applicationId, operationId: run.requestId});
      const end = Date.now() + 120000;
      for (;;) {
        const current = await findRun(session.applicationId, run.requestId); assert.ok(current);
        if (!current.active && current.phase === 'INTERRUPTED')
          await model.applicationsRecover({applicationId: session.applicationId, operationId: run.requestId});
        if (!current.active && terminal.has(current.phase)) break;
        if (Date.now() >= end) throw fault('ANALYST_NATIVE_STOP_PENDING', 'Original Applications Stop is still draining its selected run.', {operationId: run.requestId});
        await pause(500);
      }
    }
    run.stopped = true; await save();
  }
  async function standaloneStart(name, workspace, sourceRoot) {
    const connectionFile = join(output, name + '-private-connection.json');
    let prior = await optional(connectionFile);
    if (prior) {
      const saved = record.sessions[name];
      assert.ok(saved?.instanceId && prior.instanceId === saved.instanceId && prior.workspaceDirectory === workspace,
        'Keep the original listener connection and saved workspace.');
      try {
        const url = connection(prior), live = await http(url, '/api/launch', {signal});
        assert.deepEqual(live, prior);
        return {name, url, startup: prior, managed: false, child: null, connectionFile};
      } catch (error) {
        if (signal?.aborted) throw error;
        const savedProcess = await optional(join(output, name + '-listener-closed.json'));
        if (savedProcess?.instanceId !== prior.instanceId && processExists(prior.pid))
          throw fault('ANALYST_NATIVE_LISTENER_UNRESOLVED', 'Reconcile the original listener before starting another.', {pid: prior.pid});
      }
    }
    const native = await import(pathToFileURL(join(sourceRoot, 'analyst.mjs')).href);
    const binding = await native.inspectAnalystBinding({pythonExecutable: selected.pythonExecutable,
      workspaceDirectory: workspace, nativeRuntimeFile: selected.nativeRuntimeFile, sourceRoot, environment});
    const retained = record.sessions[name];
    if (retained?.bindingSha256) assert.equal(binding.sha256, retained.bindingSha256,
      'Continue with the original project, selected runtime and complete installed source.');
    record.sessions[name] = {...retained, bindingSha256: binding.sha256}; await save();
    const args = [join(sourceRoot, 'analyst.mjs'), '--workspace', workspace, '--python', selected.pythonExecutable,
      '--native-runtime-file', selected.nativeRuntimeFile, '--connection-file', connectionFile,
      '--source-root', sourceRoot, '--expected-binding', binding.sha256, '--port', '0'];
    const child = spawn(process.execPath, args, {stdio: ['ignore', 'pipe', 'pipe'], env: environment});
    owned.add(child);
    const lines = []; let stream = '', stderr = '', spawnError;
    child.stderr.on('data', bytes => { if (stderr.length < 131072) stderr += bytes.toString(); });
    child.stdout.on('data', bytes => {
      stream += bytes.toString();
      if (stream.length > 4194304) { spawnError = fault('ANALYST_NATIVE_STARTUP_SIZE', 'The original startup output exceeds its limit.'); child.kill('SIGTERM'); return; }
      let index; while ((index = stream.indexOf('\n')) >= 0) { lines.push(stream.slice(0, index)); stream = stream.slice(index + 1); }
    });
    child.once('error', error => { spawnError = error; });
    const startup = await wait('STARTING-' + name, async () => {
      if (spawnError) throw spawnError;
      for (const line of lines.splice(0)) {
        let value; try { value = JSON.parse(line); } catch { continue; }
        if (value.schema === 'starforge.stac-qgis-analyst-startup.v1') return {done: true, value};
      }
      if (child.exitCode !== null) throw fault('ANALYST_NATIVE_LISTENER_START', 'The original listener could not start.', {exitCode: child.exitCode, detail: stderr});
      return {done: false, progress: {phase: 'original-listener-start'}};
    });
    const url = connection(startup); assert.equal(startup.workspaceDirectory, workspace);
    assert.deepEqual(await http(url, '/api/launch', {signal}), startup);
    assert.equal(startup.bindingSha256, binding.sha256);
    record.sessions[name] = {bindingSha256: binding.sha256, instanceId: startup.instanceId, pid: startup.pid, workspaceDirectory: workspace};
    await unlink(join(output, name + '-listener-closed.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await save();
    return {name, url, startup, managed: false, child, connectionFile};
  }
  async function stop(session) {
    if (!session || session.closed) return;
    if (session.managed) await managedStop(session.name);
    else {
      try {
        const live = await http(session.url, '/api/launch');
        assert.equal(live.instanceId, session.startup.instanceId); assert.equal(live.pid, session.startup.pid);
        if (session.child) session.child.kill('SIGTERM'); else process.kill(live.pid, 'SIGTERM');
      } catch (error) { if (error.code !== 'ESRCH' && !['ECONNREFUSED', 'UND_ERR_SOCKET'].includes(error.cause?.code)) throw error; }
      const end = Date.now() + 30000;
      for (;;) {
        const retained = await optional(session.connectionFile);
        if (!retained) break;
        assert.equal(retained.instanceId, session.startup.instanceId, 'The listener connection now belongs to another original instance.');
        if (!processExists(session.startup.pid)) { await unlink(session.connectionFile); break; }
        if (Date.now() >= end) throw fault('ANALYST_NATIVE_STOP_PENDING', 'The original listener is still closing its owned worker.');
        await pause(200);
      }
      if (session.child) {
        while (session.child.exitCode === null && session.child.signalCode === null) await pause(100);
        owned.delete(session.child);
      }
      await atomic(join(output, session.name + '-listener-closed.json'), json({instanceId: session.startup.instanceId, stoppedAt: new Date().toISOString()}));
    }
    session.closed = true;
  }
  async function start(name, workspace, sourceRoot = ROOT) {
    const result = model ? await managedStart(name, workspace) : await standaloneStart(name, workspace, sourceRoot);
    currentSession = result;
    record.startedInstances.push({name, instanceId: result.startup.instanceId, workspaceId: result.startup.workspaceId});
    await save(); return result;
  }
  async function openBrowser(session) {
    if (page) await page.close();
    page = await browser.newPage();
    page.on('pageerror', error => browserErrors.push({message: error.message}));
    await page.goto(session.url.href, {waitUntil: 'domcontentloaded'});
    await page.getByLabel('Responsible analyst', {exact: true}).fill(selected.actor);
    await wait('BROWSER-OPEN', async () => ({done: (await page.locator('#workspace-identity').innerText()).includes(session.startup.workspaceId)}));
    assert.equal(new URL(page.url()).hash, '');
  }
  async function showOperation(session, identity) {
    await page.getByRole('button', {name: 'History', exact: true}).click();
    await page.getByLabel('Saved request ID', {exact: true}).fill(identity);
    await page.getByRole('button', {name: 'Open original request', exact: true}).click();
    const result = await http(session.url, '/api/operations/' + encodeURIComponent(identity), {signal});
    assert.equal(result.requestId, identity); return result;
  }
  async function originalAction(session, name, click) {
    const actionPath = join(output, 'actions', name + '.json');
    let body = await optional(actionPath), routeError;
    if (!body) {
      await page.route('**/api/operations', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const raw = route.request().postData();
        try {
          const proposed = JSON.parse(raw); await exact(actionPath, json(proposed)); body = proposed; await route.continue();
        } catch (error) { routeError = error; await route.abort().catch(() => {}); }
      });
      try {
        await click();
        await wait('RETAINING-' + name, async () => { if (routeError) throw routeError; return {done: !!body}; });
      } finally { await page.unroute('**/api/operations'); }
    }
    assert.ok(body?.requestId);
    let current;
    try { current = await http(session.url, '/api/operations/' + encodeURIComponent(body.requestId), {signal}); }
    catch (error) {
      if (error.status !== 404) throw error;
      current = await http(session.url, '/api/operations', {method: 'POST', body, signal});
    }
    if (current.status !== 'COMPLETED' && !current.workerActive) {
      assert.equal(current.canResume, true, 'Continue on the original selected native host and input.');
      current = await http(session.url, '/api/operations/' + body.requestId + '/continue',
        {method: 'POST', body: {inputSha256: current.inputSha256}, signal});
    }
    current = await wait(name, async () => {
      const value = await http(session.url, '/api/operations/' + body.requestId, {signal});
      if (value.status === 'FAILED' || value.displayStatus === 'INTERRUPTED')
        throw fault(value.error?.code || 'ANALYST_NATIVE_ACTION', value.error?.message || 'Continue the original saved analyst request.', {requestId: body.requestId, original: value.error});
      return {done: value.status === 'COMPLETED', value, progress: {status: value.displayStatus, progress: value.progress}};
    });
    await showOperation(session, body.requestId);
    record.operations[name] = {requestId: body.requestId, inputSha256: current.inputSha256, action: body.action, result: current.result, files: current.files};
    await save(); return current;
  }
  async function capture(name) {
    const target = join(output, 'artifacts', name + '.png');
    await page.screenshot({path: target, fullPage: true});
    const bytes = await readFile(target); record.artifacts[name] = {path: target, bytes: bytes.length, sha256: sha(bytes)}; await save();
  }
  try {
    await privateDirectory(join(output, 'actions')); await privateDirectory(join(output, 'artifacts'));
    record = await optional(recordPath);
    if (record) { assert.equal(record.schema, RESULT); assert.equal(record.inputSha256, identity); }
    else {
      record = {schema: RESULT, operationId: selected.operationId, inputSha256: identity, input: selected, selectedInputs,
        phase: 'PREPARED', startedAt: new Date().toISOString(), sessions: {}, startedInstances: [], operations: {}, artifacts: {}};
      await save();
    }
    if (record.phase === 'COMPLETE') {
      await atomic(join(output, 'analyst-native-result.json'), json(record));
      return record;
    }
    if (selected.managerDirectory) {
      const native = await import(new URL('../../../distribution/runtime-workspace/model.mjs', import.meta.url).href);
      if (!await optional(join(selected.managerDirectory, 'workspace.json'))) await native.createRuntimeWorkspace({directory: selected.managerDirectory});
      model = await native.openRuntimeWorkspace({directory: selected.managerDirectory});
      const state = await model.applicationsState();
      assert.ok(state.catalog.some(row => row.id === 'stac-qgis-analyst'));
      assert.ok(state.providers.some(row => row.id === 'stac-qgis-analyst'));
      const attached = await model.attach({directory: selected.runtimeDirectory, label: 'Original QGIS analyst receiving'});
      assert.equal(attached.status, 'READY');
      if (record.runtimeId) assert.equal(record.runtimeId, attached.runtimeId);
      record.runtimeId = attached.runtimeId; await save();
    }
    const playwright = await import(pathToFileURL(selected.playwrightModule).href);
    browser = await playwright.chromium.launchPersistentContext(join(output, 'browser-private'),
      {executablePath: selected.browserExecutable, headless: true, viewport: {width: 1440, height: 1000},
        args: ['--no-sandbox', '--disable-dev-shm-usage']});
    primary = await start('original', selected.workspaceDirectory);
    let state = (await http(primary.url, '/api/state', {signal})).state;
    if (record.workspaceId) assert.equal(state.id, record.workspaceId);
    record.workspaceId = state.id; record.initialRevision ??= state.revision;
    const wantedProject = record.projectId || selected.projectId;
    const project = state.projects.find(row => row.id === wantedProject) || (!wantedProject ? state.projects.at(-1) : null);
    assert.ok(project?.layers?.length, 'First complete the original native QGIS source and saved-map operation.');
    record.projectId ??= project.id; assert.equal(record.projectId, project.id);
    assert.equal(primary.startup.nativeRuntimeSelected, true);
    await save(); await openBrowser(primary);
    for (const tab of ['Sources', 'Layers', 'Editions', 'Field', 'History']) {
      await page.getByRole('button', {name: tab, exact: true}).click();
      await capture('original-' + tab.toLowerCase());
    }
    async function mapPane(session) {
      await page.getByRole('button', {name: 'Maps', exact: true}).click();
      const selection = page.getByLabel('Saved native project', {exact: true});
      if (await selection.inputValue() !== project.id) await selection.selectOption(project.id);
    }
    await mapPane(primary);
    const reopened = await originalAction(primary, 'native-reopen', () => page.getByRole('button', {name: 'Reopen and verify native map', exact: true}).click());
    await mapPane(primary);
    const rendered = await originalAction(primary, 'native-render', () => page.getByRole('button', {name: 'Render full map', exact: true}).click());
    const pngIndex = rendered.files.findIndex(row => row.path === rendered.result.file.path); assert.ok(pngIndex >= 0);
    record.artifacts.nativeMap = await download(primary.url, '/download/operations/' + rendered.requestId + '/files/' + pngIndex,
      join(output, 'artifacts', 'native-original-map.png'), rendered.result.file, signal);
    await mapPane(primary);
    await page.waitForFunction(() => [...document.images].some(image => image.classList.contains('native-map') && image.complete && image.naturalWidth > 0));
    await capture('original-native-map');
    const vector = project.layers.find(row => row.id === selected.featureLayerId) || (!selected.featureLayerId ? project.layers.find(row => ['vector', 'footprints'].includes(row.kind)) : null);
    if (vector) {
      await page.getByLabel('Saved vector layer', {exact: true}).selectOption(vector.id);
      const features = await originalAction(primary, 'native-features', () => page.getByRole('button', {name: 'Read native features', exact: true}).click());
      assert.equal(features.result.layerId, vector.id); record.nativeFeaturePage = features.result; await save();
      await mapPane(primary); await capture('original-native-features');
    }
    if (selected.fieldRoundId)
      record.artifacts.fieldPackage = await download(primary.url, '/download/field/' + encodeURIComponent(selected.fieldRoundId),
        join(output, 'artifacts', 'original-field-package.zip'), null, signal);
    await page.getByRole('button', {name: 'Transfers', exact: true}).click();
    await page.getByLabel('New archive directory on this host', {exact: true}).fill(join(output, 'original-exports'));
    const exported = await originalAction(primary, 'complete-export', () => page.getByRole('button', {name: 'Export complete original project', exact: true}).click());
    const archive = await download(primary.url, '/download/operations/' + exported.requestId + '/project',
      join(output, 'artifacts', 'complete-original-project.zip'), exported.result, signal);
    record.artifacts.project = archive; await save();
    const snapshotProgram = 'import sys,json,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n b=z.read("workspace-snapshot.json")\n assert len(b)<=33554432\n print(b.decode("utf-8"))\n';
    const snapshot = JSON.parse(await childResult(spawn(selected.pythonExecutable, ['-B', '-c', snapshotProgram, archive.path], {stdio: ['ignore', 'pipe', 'pipe']})));
    assert.equal(snapshot.state.id, state.id);
    await stop(primary);
    primary = await start('original', selected.workspaceDirectory);
    await openBrowser(primary);
    const afterStop = await http(primary.url, '/api/operations/' + rendered.requestId, {signal});
    assert.equal(afterStop.inputSha256, rendered.inputSha256); assert.deepEqual(afterStop.result, rendered.result);
    await showOperation(primary, rendered.requestId); await mapPane(primary);
    await page.waitForFunction(() => [...document.images].some(image => image.classList.contains('native-map') && image.complete && image.naturalWidth > 0));
    await capture('reopened-native-map');
    await page.getByRole('button', {name: 'Transfers', exact: true}).click();
    await page.getByLabel('Complete project ZIP on this computer', {exact: true}).setInputFiles(archive.path);
    const upload = page.locator('section').filter({has: page.getByRole('heading', {name: 'Independent project receiving', exact: true})});
    const resume = upload.getByRole('button', {name: 'Resume original upload', exact: true});
    await (await resume.count() ? resume : upload.getByRole('button', {name: 'Upload original files', exact: true})).click();
    await wait('COMPLETE-PROJECT-UPLOAD', async () => ({done: !!(await page.getByLabel('Original complete archive on this host', {exact: true}).inputValue())}));
    assert.equal(await page.getByLabel('Expected complete archive SHA-256', {exact: true}).inputValue(), archive.sha256);
    const receiverPath = join(output, 'received-project');
    await page.getByLabel('New independent receiving directory on this host', {exact: true}).fill(receiverPath);
    const received = await originalAction(primary, 'independent-receiving', () => page.getByRole('button', {name: 'Receive complete original project', exact: true}).click());
    assert.equal(received.result.directory, receiverPath); assert.deepEqual(received.result.state, snapshot.state);
    record.received = {directory: receiverPath, receipt: received.result.receipt}; await save();
    await stop(primary);
    receivedSession = await start('received', receiverPath, join(receiverPath, 'software'));
    await openBrowser(receivedSession);
    const receivedHistory = await http(receivedSession.url, '/download/history', {signal});
    for (const [key, value] of Object.entries(snapshot)) if (key !== 'analystRequests')
      assert.deepEqual(receivedHistory[key], value, 'The received original ' + key + ' changed.');
    const originalRequests = new Map((snapshot.analystRequests || []).map(row => [row.requestId, row]));
    const continued = new Map();
    for (const name of ['received-native-reopen', 'received-native-render']) {
      const value = await optional(join(output, 'actions', name + '.json'));
      if (value) continued.set(value.requestId, value);
    }
    for (const original of originalRequests.values())
      assert.deepEqual(receivedHistory.analystRequests?.find(row => row.requestId === original.requestId), original,
        'The received original request history changed.');
    for (const row of receivedHistory.analystRequests || []) if (!originalRequests.has(row.requestId)) {
      const body = continued.get(row.requestId);
      assert.ok(body, 'Retain the original receiving continuation for this added request.');
      assert.equal(row.input.action, body.action); assert.deepEqual(row.input.payload, body.payload);
      assert.equal(row.input.revision, body.revision); assert.equal(row.input.actor, body.actor);
    }
    record.receivedSnapshotSha256 = sha(JSON.stringify(canonical(snapshot))); await save();
    await mapPane(receivedSession);
    const receivedMap = await originalAction(receivedSession, 'received-native-reopen', () => page.getByRole('button', {name: 'Reopen and verify native map', exact: true}).click());
    await mapPane(receivedSession);
    const receivedRender = await originalAction(receivedSession, 'received-native-render', () => page.getByRole('button', {name: 'Render full map', exact: true}).click());
    assert.deepEqual(receivedRender.result.readback, rendered.result.readback);
    await mapPane(receivedSession);
    await page.waitForFunction(() => [...document.images].some(image => image.classList.contains('native-map') && image.complete && image.naturalWidth > 0));
    await capture('received-native-map');
    await page.setViewportSize({width: 390, height: 844}); await capture('received-native-mobile');
    await page.setViewportSize({width: 1440, height: 1000});
    for (const tab of ['Sources', 'Layers', 'Editions', 'Field', 'Transfers', 'History']) {
      await page.getByRole('button', {name: tab, exact: true}).click(); await capture('received-' + tab.toLowerCase());
    }
    assert.deepEqual(browserErrors, [], 'The actual operator pages emitted a browser error.');
    await browser.close(); browser = null; page = null;
    await stop(receivedSession);
    record.finalRevision = snapshot.state.revision;
    record.sourceIds = snapshot.state.sources.map(row => row.id);
    record.originalNative = reopened.result; record.receivedNative = receivedMap.result;
    record.completedAt = new Date().toISOString(); record.lastError = null;
    await note('COMPLETE', {workspaceId: record.workspaceId, revision: record.finalRevision,
      sourceEditions: record.sourceIds.length, projectSha256: archive.sha256});
    await atomic(join(output, 'analyst-native-result.json'), json(record));
    return record;
  } catch (error) {
    primaryError = error;
    if (record) {
      record.lastError = {code: error.code || error.name, message: error.message, details: error.details ?? null};
      await save();
    }
    throw error;
  } finally {
    const failures = [];
    if (browser) try { await browser.close(); } catch (error) { failures.push(error); }
    for (const session of [receivedSession, primary, currentSession]) if (session && !session.closed)
      try { await stop(session); } catch (error) { failures.push(error); }
    for (const child of owned) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const end = Date.now() + 15000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < end) await pause(100);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await new Promise(resolvePromise => child.once('close', resolvePromise));
      }
    }
    try { await model?.close(); } catch (error) { failures.push(error); }
    await lease.close();
    if (failures.length) throw new AggregateError([...(primaryError ? [primaryError] : []), ...failures], 'The original receiving operation retained its application and cleanup errors.');
  }
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && ['--help', '-h', 'help'].includes(argv[0])) {
    process.stdout.write('node analyst-native-receiving.mjs /absolute/original-analyst-handoff.json\nRead ANALYST_NATIVE.md for the existing saved project, QGIS runtime and browser input.\n');
    return {exitCode: 0};
  }
  assert.equal(argv.length, 1, 'Select the exact original analyst receiving JSON.');
  const input = await optional(await ordinaryFile(argv[0])); assert.ok(input);
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('The original receiving caller requested Stop.'));
  for (const name of ['SIGINT', 'SIGTERM']) process.on(name, stop);
  try {
    const result = await receiveQgisAnalyst(input, {signal: controller.signal});
    process.stdout.write(JSON.stringify({schema: result.schema, operationId: result.operationId,
      phase: result.phase, workspaceId: result.workspaceId, revision: result.finalRevision,
      resultPath: join(result.input.outputRoot, 'analyst-native-result.json')}) + '\n');
    return {exitCode: 0};
  } finally { for (const name of ['SIGINT', 'SIGTERM']) process.removeListener(name, stop); }
}
export const run = main;
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({error: error.code || error.name, message: error.message, details: error.details ?? null}) + '\n'); process.exitCode = 2; });
