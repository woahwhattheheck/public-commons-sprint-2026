// MIT. Managed Ruby, exact Bundler installations and the original received Rails application.
import { spawn } from 'node:child_process';
import { access, open, realpath, lstat, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { exportBaserowRubyClient, completeBaserowRubyClient, inspectBaserowRubyClient } from '../../sf30-seller-sdk/baserow/customer/export.mjs';
import { absolute, canonical, digest, json, need, plain, now, readJSON, saveJSON, operationId, operationLease,
  operationRunning, regular, processIdentity, SCHEMA, MAX_BYTES, hashObject, id, sha, label, member,
  exists, directory, treeDirectories, once, fingerprint, copyFile, copyTree, inventory, openSnapshot } from './files.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, 'worker.mjs');
const ENGINE = join(HERE, 'engine.rb');
const ROOT_FILE = 'ruby-runtime.json';
const PROJECT_EXCLUDES = ['.git', '.bundle', 'vendor/bundle'];
const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
const SIMPLE_ACTIONS = new Set(['install', 'verify', 'export']);
const CUSTOMER_ENTRIES = new Set(['native-dataset-lifecycle', 'baserow-customer-lifecycle']);
const DEFAULT_GEMFILE = '# Original managed Rails operator dependencies; the complete resolved lock is retained before install.\n' +
  'source "https://rubygems.org"\n' +
  'gem "rails", ">= 7.1", "< 9"\n' +
  'gem "sqlite3", ">= 1.6", "< 3"\n' +
  'gem "rackup", ">= 2", "< 3"\n' +
  'gem "puma", ">= 6", "< 8"\n' +
  'gem "nokogiri", ">= 1.16", "< 2"\n' +
  'gem "bigdecimal"\n';
const errorView = error => ({ code: error.code ?? 'RUBY_RUNTIME_FAILED', message: String(error.message ?? error).slice(0, 4000) });
const safeInteger = (value, low, high, code) => { need(Number.isSafeInteger(value) && value >= low && value <= high, code); return value; };
function bundleVersion(value, optional = false) {
  if (optional && value === undefined) return null;
  need(typeof value === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?$/.test(value),
    'RUBY_BUNDLER_VERSION_REQUIRED', 'Select one exact Bundler version, such as an installed version returned by Probe.');
  return value;
}
function cleanRubyEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('BUNDLE_') || ['RUBYOPT','RUBYLIB','GEM_HOME','GEM_PATH'].includes(key)) delete env[key];
  return env;
}
async function small(ruby, args, { cwd = HERE, timeout = 30000 } = {}) {
  const child = spawn(ruby, args, { cwd, env: cleanRubyEnvironment(), shell: false,
    stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), overflow = false, expired = false, killTimer;
  const stop = () => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch {}
    if (!killTimer) { killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null)
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch {} }, 5000); killTimer.unref(); }
  };
  child.stdout.on('data', bytes => { stdout = Buffer.concat([stdout, bytes]); if (stdout.length > 2 * 1024 * 1024) { overflow = true; stop(); } });
  child.stderr.on('data', bytes => { stderr = Buffer.concat([stderr, bytes]).subarray(-16384); });
  const timer = setTimeout(() => { expired = true; stop(); }, timeout); timer.unref();
  let exit;
  try { exit = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', (code, signal) => accept({ code, signal })); }); }
  finally { clearTimeout(timer); clearTimeout(killTimer); }
  need(!expired && !overflow && exit.code === 0, expired ? 'RUBY_PROBE_TIMEOUT' : 'RUBY_PROBE_FAILED',
    stderr.toString('utf8').trim() || 'Run the selected Ruby interpreter and inspect its original error.');
  let value;
  try { value = JSON.parse(stdout.toString('utf8')); } catch { need(false, 'RUBY_PROBE_RESULT_INVALID'); }
  need(plain(value) && !value.error, value?.error?.code ?? 'RUBY_PROBE_FAILED', value?.error?.message);
  return value;
}
export async function probeRuby({ ruby, bundlerVersion } = {}) {
  absolute(ruby); await access(ruby, constants.X_OK);
  const selected = await lstat(ruby), target = await realpath(ruby);
  need(selected.isFile() || selected.isSymbolicLink(), 'RUBY_EXECUTABLE_REQUIRED');
  const bytes = await fingerprint(target);
  const native = await small(ruby, [ENGINE, 'probe']);
  need(native.schema === 'stellar-forge.ruby-probe.v1' && typeof native.ruby_version === 'string' &&
    native.ruby_version.split('.').map(Number)[0] >= 3, 'RUBY_VERSION_REQUIRED', 'Use Ruby 3.1 or newer for the Rails operator.');
  const version = native.ruby_version.split('.').map(Number);
  need(version[0] > 3 || version[1] >= 1, 'RUBY_VERSION_REQUIRED', 'Use Ruby 3.1 or newer for the Rails operator.');
  const chosen = bundleVersion(bundlerVersion, true);
  return { ...native, executable: ruby, executableTarget: target, executableBytes: bytes.bytes,
    executableSha256: bytes.sha256, selectedBundler: chosen,
    bundlerAvailable: chosen === null ? null : native.bundlers.some(item => item.version === chosen) };
}
async function checkRuby(selection) {
  const original = selection.ruby;
  await access(original.executable, constants.X_OK);
  need(await realpath(original.executable) === original.executableTarget, 'RUBY_INTERPRETER_CHANGED', undefined, 409);
  const actual = await fingerprint(original.executableTarget);
  need(actual.bytes === original.executableBytes && actual.sha256 === original.executableSha256,
    'RUBY_INTERPRETER_CHANGED', 'Create a new environment for a changed interpreter.', 409);
}
async function rootDirectory(value, create) {
  const root = await directory(absolute(value), create);
  const selected = { schema: SCHEMA, directory: root, id: digest(root).slice(0, 24) };
  need(create || await exists(join(root, ROOT_FILE)), 'RUBY_WORKSPACE_UNINITIALIZED',
    'Initialize this selected private runtime directory before opening it.');
  await once(join(root, ROOT_FILE), json(selected));
  for (const child of ['environments', 'applications', 'operations', 'locks']) await directory(join(root, child), true);
  return root;
}
async function exclusive(path, fn) {
  const lock = await operationLease(path);
  try { return await fn(); } finally { await lock.close(); }
}

/** Short admission transitions share one original operation generation. */
async function transition(path, fn) {
  const deadline = Date.now() + 5000;
  while (true) {
    let lock;
    try { lock = await operationLease(join(path, 'admission.lock')); }
    catch (error) {
      if (error.code !== 'RUNTIME_WORKSPACE_OPERATION_RUNNING' || Date.now() >= deadline) throw error;
      await new Promise(accept => setTimeout(accept, 25)); continue;
    }
    try { return await fn(); } finally { await lock.close(); }
  }
}
async function initialState(path, input) {
  await directory(join(path, 'attempts'), true);
  let state = await readJSON(join(path, 'state.json'), true);
  if (!state) {
    try { await saveJSON(join(path, 'state.json'), { phase: 'QUEUED', attempt: 0, generation: 0, updatedAt: input.createdAt }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    state = await readJSON(join(path, 'state.json'));
  }
  need(Number.isSafeInteger(state.attempt) && state.attempt >= 0 &&
    (state.generation === undefined || Number.isSafeInteger(state.generation) && state.generation >= 0),
    'RUBY_OPERATION_STATE_INVALID');
  return state;
}
function cancelledGeneration(stop, state) {
  return stop && (stop.generation === undefined ? stop.attempt === state.attempt :
    stop.generation === (state.generation ?? 0));
}

function validateOperation(request, selectedId) {
  need(request?.schema === 'stellar-forge.ruby-operation.v1' && request.id === selectedId, 'RUBY_OPERATION_CHANGED');
  const { sha256, ...content } = request;
  need(hashObject(content) === sha256, 'RUBY_OPERATION_CHANGED', undefined, 409);
  return request;
}
export async function openRubyRuntime({ directory: root, create = false } = {}) {
  root = await rootDirectory(root, create);
  let closed = false;
  const pending = new Set();
  const call = operation => async (...args) => {
    need(!closed, 'RUBY_WORKSPACE_CLOSED', undefined, 409);
    const task = Promise.resolve().then(() => operation(...args)); pending.add(task);
    try { return await task; } finally { pending.delete(task); }
  };
  const envPath = value => join(root, 'environments', id(value));
  const appPath = value => join(root, 'applications', id(value));
  const opPath = value => join(root, 'operations', operationId(value));
  async function selected(value) {
    const result = await readJSON(join(envPath(value), 'selection.json'));
    need(result?.schema === 'stellar-forge.ruby-selection.v1' && result.id === value, 'RUBY_ENVIRONMENT_CHANGED');
    const { sha256, ...content } = result;
    need(hashObject(content) === sha256, 'RUBY_ENVIRONMENT_CHANGED', undefined, 409);
    return result;
  }
  async function request(value) { return validateOperation(await readJSON(join(opPath(value), 'request.json')), value); }
  async function operation({ operationId: value }) {
    const input = await request(value), path = opPath(value);
    const state = await readJSON(join(path, 'state.json'), true) ?? { phase: 'QUEUED', attempt: 0 };
    const active = await operationRunning(join(path, 'worker.lock'));
    const progress = state.attempt ? await readJSON(join(path, 'attempts', String(state.attempt), 'progress.json'), true) : null;
    const original = state.attempt ? await readJSON(join(path, 'attempts', String(state.attempt), 'result.json'), true) : null;
    if (original) need(original.operationId === value && original.requestSha256 === input.sha256, 'RUBY_OPERATION_RESULT_CHANGED');
    const stop = await readJSON(join(path, 'stop.json'), true);
    const complete = original?.state === 'COMPLETE';
    const phase = active ? 'RUNNING' : complete ? 'SUCCEEDED' :
      state.phase === 'RUNNING' ? cancelledGeneration(stop, state) ? 'CANCELLED' : 'INTERRUPTED' : state.phase;
    const startup = state.attempt ? await readJSON(join(path, 'attempts', String(state.attempt), 'startup.json'), true) : null;
    return { id: value, environmentId: input.environmentId, applicationId: input.applicationId ?? null,
      action: input.action, phase, stage: progress?.stage ?? state.stage ?? null, active,
      stopRequested: Boolean(cancelledGeneration(stop, state)), attempt: state.attempt,
      createdAt: input.createdAt, updatedAt: progress?.updatedAt ?? state.updatedAt ?? input.createdAt,
      result: original ?? state.result ?? null, error: state.error ?? original?.error ?? null,
      progress, url: active && startup?.operationId === value ? startup.url : null };
  }
  async function operationsFor(environmentId = null, applicationId = null) {
    const values = [];
    for (const name of (await readdir(join(root, 'operations'))).sort()) {
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name)) continue;
      const input = await readJSON(join(opPath(name), 'request.json'), true);
      if (!input || environmentId && input.environmentId !== environmentId || applicationId && input.applicationId !== applicationId) continue;
      values.push(await operation({ operationId: name }));
    }
    return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }
  async function environment(value) {
    const input = await selected(value), installation = await readJSON(join(envPath(value), 'installation.json'), true);
    const received = await readJSON(join(envPath(value), 'received.json'), true);
    const operations = await operationsFor(value), current = operations.find(op => op.action !== 'application-serve');
    const lock = await readJSON(join(envPath(value), 'lock.json'), true);
    const definition = input.kind === 'received' ? received?.definition : input;
    const name = definition?.gemfile;
    const sourceBytes = name ? await regular(join(envPath(value), 'project', member(name)), 4 * 1024 * 1024) : null;
    const lockBytes = lock && name ? await regular(join(envPath(value), 'lock', name.replaceAll('/', '_') + '.lock'), 16 * 1024 * 1024) : null;
    let phase = installation ? 'READY' : 'SELECTED';
    if (current?.active) phase = current.action === 'install' || current.action === 'receive' ? 'INSTALLING' : phase;
    else if (!installation && ['FAILED','INTERRUPTED'].includes(current?.phase)) phase = current.phase;
    return { id: value, title: input.title, directory: envPath(value), selectionSha256: input.sha256,
      ruby: input.ruby, bundlerVersion: input.bundlerVersion ?? received?.bundlerVersion ?? null,
      profile: input.profile, project: definition?.project ? { originalDirectory: definition.project.originalDirectory,
        files: definition.project.files.length, sha256: definition.project.sha256 } : null,
      gemfile: sourceBytes ? { name, bytes: sourceBytes.length, sha256: digest(sourceBytes), text: sourceBytes.toString('utf8') } : null,
      lock: lockBytes ? { ...lock, text: lockBytes.toString('utf8') } : null,
      phase, lockSha256: lock?.sha256 ?? installation?.lockSha256 ?? null,
      installation, received, operations };
  }
  async function appSelection(value) {
    const record = await readJSON(join(appPath(value), 'application.json'));
    need(record.schema === 'stellar-forge.ruby-application.v1' && record.id === value, 'RUBY_APPLICATION_CHANGED');
    const { sha256, ...body } = record;
    need(hashObject(body) === sha256, 'RUBY_APPLICATION_CHANGED', undefined, 409);
    return record;
  }
  async function application({ id: value }) {
    const input = await appSelection(value), runs = await operationsFor(input.environmentId, value);
    const launches = runs.filter(op => op.action === 'application-serve'), current = launches[0] ?? null;
    const registration = runs.find(op => op.action === 'application-register');
    const registered = await readJSON(join(appPath(value), 'registered.json'), true);
    let phase = registered?.applicationSha256 === input.sha256 ? 'READY' : registration?.phase ?? 'QUEUED';
    if (current) phase = current.active ? current.stopRequested ? 'STOPPING' : current.url ? 'RUNNING' : 'STARTING' :
      current.phase === 'SUCCEEDED' || current.phase === 'CANCELLED' ? 'STOPPED' : current.phase;
    return { id: value, title: input.title, environmentId: input.environmentId, directory: input.directory,
      source: input.source, selectionSha256: input.sha256, phase, registration: registration ?? registered,
      current: current ? { ...current, operationId: current.id } : null, runs: launches };
  }
  async function inspect() {
    const environments = [], applications = [];
    for (const value of (await readdir(join(root, 'environments'))).sort()) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value) || !await exists(join(envPath(value), 'selection.json'))) continue;
      try { environments.push(await environment(value)); } catch (error) { environments.push({ id: value, phase: 'UNAVAILABLE', error: errorView(error) }); }
    }
    for (const value of (await readdir(join(root, 'applications'))).sort()) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value) || !await exists(join(appPath(value), 'application.json'))) continue;
      try { applications.push(await application({ id: value })); } catch (error) { applications.push({ id: value, phase: 'UNAVAILABLE', error: errorView(error) }); }
    }
    return { schema: SCHEMA, directory: root, defaults: { profile: 'rails-operator', gemfile: 'Gemfile', port: 9292 },
      environments, applications, operations: await operationsFor() };
  }
  async function retainSupport(path) {
    await directory(join(path, 'support'), true);
    const entries = [];
    for (const name of ['engine.rb', 'application.rb']) {
      const bytes = await regular(join(HERE, name), 4 * 1024 * 1024);
      await once(join(path, 'support', name), bytes); entries.push({ name, bytes: bytes.length, sha256: digest(bytes) });
    }
    return entries;
  }
  async function createEnvironment(input = {}) {
    const value = id(input.id), title = label(input.title), key = operationId(input.requestId);
    const ruby = absolute(input.ruby), version = bundleVersion(input.bundlerVersion);
    const projectDirectory = input.projectDirectory ? absolute(input.projectDirectory) : null;
    const gemfile = member(input.gemfile ?? 'Gemfile');
    need(projectDirectory || gemfile === 'Gemfile', 'RUBY_DEFAULT_GEMFILE_INVALID');
    const original = { id: value, title, ruby, bundlerVersion: version, projectDirectory, gemfile, requestId: key };
    return exclusive(join(root, 'locks', 'environment-' + value + '.lock'), async () => {
      const path = await directory(envPath(value), true), choicePath = join(path, 'create-request.json');
      await once(choicePath, json(original));
      if (await exists(join(path, 'selection.json'))) return environment(value);
      const native = await probeRuby({ ruby, bundlerVersion: version });
      const project = join(path, 'project');
      if (projectDirectory) {
        const inside = resolve(projectDirectory);
        need(!path.startsWith(inside + '/') && path !== inside, 'RUBY_SOURCE_CONTAINS_OUTPUT');
        await copyTree(inside, project, { exclude: PROJECT_EXCLUDES });
        need(await exists(join(project, gemfile)), 'RUBY_GEMFILE_MISSING');
      } else { await directory(project, true); await once(join(project, gemfile), DEFAULT_GEMFILE); }
      const projectFiles = await inventory(project, { privateOnly: true });
      need(projectFiles.some(file => file.name === gemfile), 'RUBY_GEMFILE_MISSING');
      const client = join(path, 'client');
      if (!await exists(join(client, 'baserow-ruby-client.json'))) {
        if (!await exists(client)) await exportBaserowRubyClient({ out: client });
        else await completeBaserowRubyClient({ directory: client });
      }
      const clientState = await inspectBaserowRubyClient({ directory: client });
      need(clientState.state === 'COMPLETE', 'RUBY_CLIENT_SOURCE_INCOMPLETE');
      const clientFiles = await inventory(client, { privateOnly: true });
      const support = await retainSupport(path);
      const body = { schema: 'stellar-forge.ruby-selection.v1', id: value, title, requestId: key,
        createdAt: now(), kind: 'source', profile: 'rails-operator', ruby: native, bundlerVersion: version,
        gemfile, project: { originalDirectory: projectDirectory, files: projectFiles, sha256: hashObject(projectFiles) },
        client: { files: clientFiles, sha256: hashObject(clientFiles) }, support };
      await once(join(path, 'selection.json'), json({ ...body, sha256: hashObject(body) }));
      return environment(value);
    });
  }

  async function selectionAdmission(environmentId, applicationId, fn) {
    return exclusive(join(root, 'locks', 'environment-' + id(environmentId) + '.lock'), async () =>
      applicationId ? exclusive(join(root, 'locks', 'application-' + id(applicationId) + '.lock'), fn) : fn());
  }
  async function stoppedApplication(environmentId, applicationId) {
    const app = await appSelection(id(applicationId));
    need(app.environmentId === environmentId, 'RUBY_APPLICATION_ENVIRONMENT_CHANGED');
    const active = await application({ id: applicationId });
    need(!active.current?.active && !['QUEUED','RUNNING','INTERRUPTED'].includes(active.current?.phase),
      'RUBY_APPLICATION_RUNNING', 'Stop the selected Rails application before retaining its complete database and files.', 409);
  }
  async function assertNoBusy(environmentId, applicationId, own = null) {
    for (const op of await operationsFor(environmentId)) {
      if (op.id === own || applicationId && op.applicationId && applicationId !== op.applicationId) continue;
      if (applicationId === null && op.action === 'application-serve') continue;
      need(!op.active && !['QUEUED','RUNNING','INTERRUPTED'].includes(op.phase), 'RUBY_OPERATION_RUNNING',
        'Continue or stop original operation ' + op.id + ' before starting another operation for this selection.', 409);
    }
  }
  async function admit({ environmentId, applicationId = null, action, operationId: key, parameters = {} }) {
    id(environmentId); operationId(key);
    const selection = await selected(environmentId);
    const identity = { schema: 'stellar-forge.ruby-operation.v1', id: key, environmentId, applicationId,
      action, selectionSha256: selection.sha256, parameters };
    const path = await directory(opPath(key), true);
    return transition(path, async () => {
      const old = await readJSON(join(path, 'request.json'), true);
      if (old) {
        const { createdAt, sha256, ...prior } = validateOperation(old, key);
        need(hashObject(prior) === hashObject(identity), 'RUBY_OPERATION_CHANGED', 'Use the original selected operation UUID with its original arguments.', 409);
        await initialState(path, old);
        return operation({ operationId: key });
      }
      await assertNoBusy(environmentId, applicationId, key);
      if (['export','verify'].includes(action) && applicationId) await stoppedApplication(environmentId, applicationId);
      const content = { ...identity, createdAt: now() }, input = { ...content, sha256: hashObject(content) };
      await once(join(path, 'request.json'), json(input));
      await initialState(path, input);
      return operation({ operationId: key });
    });
  }
  async function spawnWorker(key) {
    const observed = await operation({ operationId: key });
    if (observed.active || observed.phase === 'SUCCEEDED' || observed.phase === 'CANCELLED') return observed;
    const output = await open(join(opPath(key), 'worker.log'), 'a', 0o600);
    try {
      const child = spawn(process.execPath, [WORKER, '--directory', root, '--operation-id', key], {
        cwd: root, env: process.env, shell: false, detached: true, stdio: ['ignore', output.fd, output.fd] });
      await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
      child.unref();
    } finally { await output.close(); }
    return operation({ operationId: key });
  }

  async function start({ id: value, operationId: key, action, offline = false, applicationId = null } = {}) {
    need(SIMPLE_ACTIONS.has(action) && typeof offline === 'boolean', 'RUBY_ACTION_INVALID');
    id(value); operationId(key);
    if (applicationId) need(['export','verify'].includes(action), 'RUBY_APPLICATION_EXPORT_OR_VERIFY_REQUIRED');
    const observed = await selectionAdmission(value, applicationId, async () => {
      return admit({ environmentId: value, applicationId, action, operationId: key, parameters: { offline } });
    });
    if (observed.phase === 'FAILED' || observed.phase === 'INTERRUPTED') return observed;
    return spawnWorker(key);
  }
  async function run({ id: value, operationId: key, entry, argv = [] } = {}) {
    id(value); operationId(key);
    need(CUSTOMER_ENTRIES.has(entry) && Array.isArray(argv) && argv.length <= 512 &&
      argv.every(item => typeof item === 'string' && !item.includes('\0') && item.length <= 65536) &&
      Buffer.byteLength(JSON.stringify(argv)) <= 1024 * 1024, 'RUBY_CUSTOMER_ARGUMENTS_INVALID');
    const observed = await selectionAdmission(value, null, async () => {
      need(await exists(join(envPath(value), 'installation.json')), 'RUBY_INSTALLATION_REQUIRED');
      return admit({ environmentId: value, action: 'customer-command', operationId: key, parameters: { entry, argv } });
    });
    if (['FAILED','INTERRUPTED','CANCELLED'].includes(observed.phase)) return observed;
    return spawnWorker(key);
  }
  async function resume({ operationId: key } = {}) {
    operationId(key);
    const input = await request(key);
    return selectionAdmission(input.environmentId, input.applicationId, async () => {
      const accepted = await transition(opPath(key), async () => {
        const current = await initialState(opPath(key), input);
        const observed = await operation({ operationId: key });
        if (observed.active || observed.phase === 'SUCCEEDED') return false;
        need(['QUEUED','FAILED','INTERRUPTED','CANCELLED'].includes(observed.phase), 'RUBY_OPERATION_STATE_INVALID');
        await assertNoBusy(input.environmentId, input.applicationId, key);
        if (['export','verify'].includes(input.action) && input.applicationId) await stoppedApplication(input.environmentId, input.applicationId);
        await saveJSON(join(opPath(key), 'state.json'), { ...current, phase: 'QUEUED',
          generation: (current.generation ?? 0) + 1, error: null, updatedAt: now() }, true);
        return true;
      });
      return accepted ? spawnWorker(key) : operation({ operationId: key });
    });
  }
  async function cancel({ operationId: key } = {}) {
    operationId(key);
    const input = await request(key);
    await transition(opPath(key), async () => {
      const current = await initialState(opPath(key), input);
      const observed = await operation({ operationId: key });
      if (observed.phase === 'SUCCEEDED') return;
      await saveJSON(join(opPath(key), 'stop.json'), { operationId: key, attempt: current.attempt,
        generation: current.generation ?? 0, requestedAt: now() }, true);
      // A worker that already holds its long lease still must pass this short
      // admission transition before it advances the attempt or starts Ruby.
      if (!observed.active || current.phase !== 'RUNNING')
        await saveJSON(join(opPath(key), 'state.json'), { ...current, phase: 'CANCELLED', updatedAt: now() }, true);
    });
    return operation({ operationId: key });
  }
  async function registerApplication({ id: value, title, environmentId, directory: source, requestId } = {}) {
    id(value); id(environmentId); label(title); operationId(requestId); absolute(source);
    const selection = await selected(environmentId);
    need(await exists(join(envPath(environmentId), 'installation.json')), 'RUBY_INSTALLATION_REQUIRED');
    await directory(source);
    const native = await readJSON(join(source, 'application-delivery.json'), true);
    const configuration = native ?? await readJSON(join(source, 'application.json'));
    const format = native ? 'native' : 'baserow';
    need(configuration?.schema === (native ? 'stellar-forge.ruby-native-dataset-application.v1' :
      'stellar-forge.baserow-rails-operator-application.v1'), 'RUBY_ORIGINAL_APPLICATION_REQUIRED');
    const name = native ? 'application-delivery.json' : 'operator-result.json';
    const original = await fingerprint(join(source, name), { privateOnly: true });
    const identity = { schema: 'stellar-forge.ruby-application.v1', id: value, title, environmentId,
      directory: join(appPath(value), 'workspace'), source: { format, originalDirectory: source,
        manifest: { name, ...original } }, requestId, environmentSelectionSha256: selection.sha256 };
    return selectionAdmission(environmentId, value, async () => {
      await directory(appPath(value), true);
      await once(join(appPath(value), 'application.json'), json({ ...identity, sha256: hashObject(identity) }));
      await admit({ environmentId, applicationId: value, action: 'application-register', operationId: requestId, parameters: {} });
      await spawnWorker(requestId);
      return application({ id: value });
    });
  }
  async function launchApplication({ id: value, operationId: key, port = 9292,
    expectedApplicationSha256, expectedEnvironmentSelectionSha256 } = {}, { foreground = false } = {}) {
    id(value); operationId(key); safeInteger(port, 1, 65535, 'RUBY_PORT_INVALID');
    const app = await appSelection(value);
    if (expectedApplicationSha256 !== undefined) need(sha(expectedApplicationSha256) === app.sha256, 'RUBY_APPLICATION_CHANGED', undefined, 409);
    if (expectedEnvironmentSelectionSha256 !== undefined) need(sha(expectedEnvironmentSelectionSha256) ===
      (await selected(app.environmentId)).sha256, 'RUBY_ENVIRONMENT_CHANGED', undefined, 409);
    const admission = await selectionAdmission(app.environmentId, value, async () => {
      const registered = await readJSON(join(appPath(value), 'registered.json'), true);
      need(registered?.applicationSha256 === app.sha256, 'RUBY_APPLICATION_REGISTRATION_INCOMPLETE');
      return admit({ environmentId: app.environmentId, applicationId: value, action: 'application-serve',
        operationId: key, parameters: { port,
          ...(expectedApplicationSha256 === undefined ? {} : { expectedApplicationSha256 }),
          ...(expectedEnvironmentSelectionSha256 === undefined ? {} : { expectedEnvironmentSelectionSha256 }) } });
    });
    if (foreground) {
      need(!admission.active, 'RUBY_APPLICATION_RUNNING', undefined, 409);
      return executeRubyOperation({ directory: root, operationId: key, announce: true });
    }
    if (['FAILED','INTERRUPTED','CANCELLED'].includes(admission.phase)) return admission;
    return spawnWorker(key);
  }
  async function stopApplication({ id: value } = {}) {
    const app = await application({ id: value });
    if (app.current && !terminal.has(app.current.phase)) await cancel({ operationId: app.current.id });
    return application({ id: value });
  }
  async function receive({ id: value, title, ruby, bundlerVersion, archive, expectedSha256, operationId: key } = {}) {
    id(value); label(title); absolute(ruby); absolute(archive); sha(expectedSha256); operationId(key);
    const version = bundleVersion(bundlerVersion, true);
    const original = { id: value, title, ruby, bundlerVersion: version, archive, expectedSha256, operationId: key };
    await exclusive(join(root, 'locks', 'environment-' + value + '.lock'), async () => {
      const path = await directory(envPath(value), true);
      await once(join(path, 'receive-request.json'), json(original));
      if (!await exists(join(path, 'selection.json'))) {
        const selectedRuby = await probeRuby({ ruby, ...(version ? { bundlerVersion: version } : {}) });
        const copied = await copyFile(archive, join(path, 'input.tar'), { sha256: expectedSha256 });
        const support = await retainSupport(path);
        const body = { schema: 'stellar-forge.ruby-selection.v1', id: value, title, requestId: key, createdAt: now(),
          kind: 'received', profile: 'rails-operator', ruby: selectedRuby, bundlerVersion: version, gemfile: null,
          project: null, client: null, support, archive: { name: 'input.tar', ...copied } };
        await once(join(path, 'selection.json'), json({ ...body, sha256: hashObject(body) }));
      }
      await admit({ environmentId: value, action: 'receive', operationId: key, parameters: { offline: true } });
    });
    return spawnWorker(key);
  }
  async function log({ operationId: key, offset = 0, limit = 65536 } = {}) {
    const input = await request(operationId(key));
    safeInteger(offset, 0, Number.MAX_SAFE_INTEGER, 'RUBY_LOG_OFFSET_INVALID');
    safeInteger(limit, 1, 1024 * 1024, 'RUBY_LOG_LIMIT_INVALID');
    const file = await open(join(opPath(input.id), 'worker.log'), constants.O_RDONLY | constants.O_NOFOLLOW).catch(error => {
      if (error.code === 'ENOENT') return null; throw error;
    });
    if (!file) return { offset: 0, nextOffset: 0, totalBytes: 0, text: '' };
    try {
      const info = await file.stat(); need(info.isFile(), 'RUBY_LOG_INVALID');
      const at = Math.min(offset, info.size), bytes = Buffer.alloc(Math.min(limit, info.size - at));
      const read = await file.read(bytes, 0, bytes.length, at);
      return { offset: at, nextOffset: at + read.bytesRead, totalBytes: info.size, text: bytes.subarray(0, read.bytesRead).toString('utf8') };
    } finally { await file.close(); }
  }
  async function openFile({ operationId: key, name } = {}) {
    member(name);
    const op = await operation({ operationId: key });
    need(op.result?.state === 'COMPLETE', 'RUBY_OUTPUT_INCOMPLETE');
    const descriptor = op.result.files?.find(file => file.name === name);
    need(descriptor, 'RUBY_OUTPUT_UNKNOWN', undefined, 404);
    const filename = join(opPath(key), 'attempts', String(op.attempt), member(descriptor.path));
    const handle = await openSnapshot(filename, descriptor, opPath(key));
    return { handle, bytes: descriptor.bytes, sha256: descriptor.sha256, name,
      type: descriptor.type ?? (name.endsWith('.tar') ? 'application/x-tar' : name.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8') };
  }
  return {
    directory: root, inspect: call(inspect), probe: call(probeRuby), create: call(createEnvironment),
    start: call(start), run: call(run), resume: call(resume), cancel: call(cancel), operation: call(operation), log: call(log),
    application: call(application), registerApplication: call(registerApplication), launchApplication: call(launchApplication),
    stopApplication: call(stopApplication), receive: call(receive), openFile: call(openFile),
    runApplication: call(input => launchApplication(input, { foreground: true })),
    async close() { closed = true; await Promise.allSettled([...pending]); },
  };
}

/** One native worker and its inherited original kernel lease, including engine children. */
export async function executeRubyOperation({ directory: root, operationId: key, announce = false } = {}) {
  root = await rootDirectory(root, false); operationId(key);
  const operationPath = join(root, 'operations', key), request = validateOperation(await readJSON(join(operationPath, 'request.json')), key);
  const env = join(root, 'environments', id(request.environmentId));
  const selection = await readJSON(join(env, 'selection.json'));
  const { sha256: selectionSha, ...selectionBody } = selection;
  need(selectionSha === request.selectionSha256 && hashObject(selectionBody) === selectionSha, 'RUBY_ENVIRONMENT_CHANGED');
  let lease;
  try { lease = await operationLease(join(operationPath, 'worker.lock')); }
  catch (error) { if (error.code === 'RUNTIME_WORKSPACE_OPERATION_RUNNING') return { state: 'ALREADY_RUNNING', operationId: key }; throw error; }
  let child, finished, monitor, monitorTask = null, stopped = false, hardStop = null;
  let attemptPath, attempt, generation, originalState;
  const stop = () => {
    stopped = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch {}
      if (!hardStop) hardStop = setTimeout(() => {
        if (child && child.exitCode === null && child.signalCode === null)
          try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch {}
      }, 10000);
      hardStop?.unref();
    }
  };
  async function completed(state) {
    const value = state.attempt ? await readJSON(join(operationPath, 'attempts', String(state.attempt), 'result.json'), true) : null;
    if (value) need(value.operationId === key && value.requestSha256 === request.sha256, 'RUBY_OPERATION_RESULT_CHANGED');
    if (value?.state !== 'COMPLETE') return null;
    await saveJSON(join(operationPath, 'state.json'), { ...state, phase: 'SUCCEEDED', result: value, updatedAt: now() }, true);
    return value;
  }
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    const early = await transition(operationPath, async () => {
      originalState = await initialState(operationPath, request);
      const retained = await completed(originalState);
      return retained ?? (['SUCCEEDED','CANCELLED'].includes(originalState.phase) ? originalState : null);
    });
    if (early) return early;
    await checkRuby(selection);
    for (const file of selection.support) {
      const bytes = await regular(join(env, 'support', member(file.name)), 4 * 1024 * 1024);
      need(bytes.length === file.bytes && digest(bytes) === file.sha256, 'RUBY_ENGINE_CHANGED');
    }
    const admission = await transition(operationPath, async () => {
      const current = await initialState(operationPath, request);
      const retained = await completed(current);
      if (retained) return retained;
      const cancel = await readJSON(join(operationPath, 'stop.json'), true);
      if (stopped || current.phase === 'CANCELLED' || cancelledGeneration(cancel, current)) {
        const value = { ...current, phase: 'CANCELLED', updatedAt: now() };
        await saveJSON(join(operationPath, 'state.json'), value, true); return value;
      }
      attempt = current.attempt + 1; generation = current.generation ?? 0;
      attemptPath = await directory(join(operationPath, 'attempts', String(attempt)), true);
      await saveJSON(join(operationPath, 'state.json'), { phase: 'RUNNING', attempt, generation, updatedAt: now(),
        pid: process.pid, processStart: await processIdentity(), stage: 'STARTING' }, true);
      return null;
    });
    if (admission) return admission;
    const beforeSpawn = await readJSON(join(operationPath, 'stop.json'), true);
    if (cancelledGeneration(beforeSpawn, { attempt, generation })) stopped = true;
    need(!stopped, 'RUBY_OPERATION_CANCELLED');
    const args = [join(env, 'support', 'engine.rb'), 'operate', '--directory', root, '--operation-id', key,
      '--attempt', String(attempt), '--lease-fd', '3'];
    child = spawn(selection.ruby.executable, args, { cwd: env, env: cleanRubyEnvironment(), shell: false,
      detached: true, stdio: ['ignore', 'inherit', 'inherit', lease.fd] });
    finished = new Promise((accept, reject) => { child.once('error', reject); child.once('close', (code, signal) => accept({ code, signal })); });
    finished.catch(() => {});
    await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
    if (stopped) stop();
    let announced = false;
    monitor = setInterval(() => {
      if (monitorTask) return;
      monitorTask = (async () => {
        const cancel = await readJSON(join(operationPath, 'stop.json'), true);
        if (cancelledGeneration(cancel, { attempt, generation })) stop();
        if (announce && !announced) {
          const startup = await readJSON(join(attemptPath, 'startup.json'), true);
          if (startup?.operationId === key) { process.stdout.write(JSON.stringify(startup) + '\n'); announced = true; }
        }
      })().catch(error => { process.stderr.write(json({ error: errorView(error) })); stop(); })
        .finally(() => { monitorTask = null; });
    }, 500); monitor.unref();
    const exit = await finished;
    if (monitorTask) await monitorTask;
    const result = await readJSON(join(attemptPath, 'result.json'), true);
    if (result) need(result.operationId === key && result.requestSha256 === request.sha256, 'RUBY_OPERATION_RESULT_CHANGED');
    const state = await transition(operationPath, async () => {
      const cancel = await readJSON(join(operationPath, 'stop.json'), true), succeeded = result?.state === 'COMPLETE';
      const value = { phase: succeeded ? 'SUCCEEDED' :
        stopped || result?.state === 'CANCELLED' || cancelledGeneration(cancel, { attempt, generation }) ? 'CANCELLED' : 'FAILED',
        attempt, generation, updatedAt: now(), result, exit,
        error: result?.error ?? (succeeded ? null : { code: 'RUBY_ENGINE_FAILED',
          message: 'Open the complete original worker log, then resume this selected operation.' }) };
      await saveJSON(join(operationPath, 'state.json'), value, true); return value;
    });
    return result ?? state;
  } catch (error) {
    const signalled = stopped;
    stop(); if (finished) await finished.catch(() => {});
    if (originalState) await transition(operationPath, async () => {
      const current = await initialState(operationPath, request);
      const cancel = await readJSON(join(operationPath, 'stop.json'), true);
      await saveJSON(join(operationPath, 'state.json'), { ...current,
        phase: signalled || current.phase === 'CANCELLED' || cancelledGeneration(cancel, current) ? 'CANCELLED' : 'FAILED',
        attempt: attempt ?? current.attempt, generation: generation ?? current.generation ?? 0,
        updatedAt: now(), error: errorView(error) }, true);
    });
    throw error;
  } finally {
    clearInterval(monitor); clearTimeout(hardStop); if (monitorTask) await monitorTask;
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
    if (child && child.exitCode === null && child.signalCode === null) { stop(); if (finished) await finished.catch(() => {}); }
    clearTimeout(hardStop); await lease.close();
  }
}
