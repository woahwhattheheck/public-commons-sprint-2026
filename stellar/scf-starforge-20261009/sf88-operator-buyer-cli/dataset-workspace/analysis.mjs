// MIT. The customer's ORIGINAL Python analysis owner, launched from native paths.
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { absolute, privateDirectory, readJson, fault } from '../../sf30-seller-sdk/postgres/publisher/files.mjs';
import { check } from './receiving.mjs';

const MODULE = 'stellar_forge_buyer.analysis_workspace';
const ALIAS = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const LIMIT = 2097152;
const stopped = () => fault('DATASET_ANALYSIS_STOPPED', 'The original analysis operation stopped.', 409);
// Keep the same Python module and native owner. On Linux an abruptly lost
// launcher interrupts that owner too, allowing its original close/recovery path.
const BOOTSTRAP = [
  'import os,sys,signal,runpy',
  'parent=int(sys.argv.pop(1)); source=sys.argv.pop(1)',
  'if sys.platform=="linux":',
  ' import ctypes',
  ' if os.getppid()!=parent: raise SystemExit("ANALYSIS_LAUNCHER_EXITED")',
  ' signal.signal(signal.SIGUSR1,lambda *_: os.killpg(os.getpgrp(),signal.SIGINT))',
  ' if ctypes.CDLL(None,use_errno=True).prctl(1,signal.SIGUSR1,0,0,0)!=0: raise OSError("ANALYSIS_PARENT_SIGNAL_FAILED")',
  ' if os.getppid()!=parent: raise SystemExit("ANALYSIS_LAUNCHER_EXITED")',
  'sys.path.insert(0,source)',
  'sys.argv[0]="stellar_forge_buyer.analysis_workspace"',
  'runpy.run_module("stellar_forge_buyer.analysis_workspace",run_name="__main__")',
].join('\n');

export function analysisLauncher(settings = null) {
  let active = null, transient = null, closed = false, working = null, closing = null;
  if (settings !== null) {
    check(settings && Object.keys(settings).every(key => ['python', 'checkout', 'directory'].includes(key)), 'DATASET_ANALYSIS_SETTINGS_INVALID');
    for (const key of ['checkout', 'directory']) absolute(settings[key], key);
    if (settings.python !== 'python3') absolute(settings.python, 'python executable');
  }
  function configured() {
    check(settings !== null, 'DATASET_ANALYSIS_NOT_CONFIGURED', 'Configure the original Python analysis launcher on this operator host.');
  }
  function common() {
    configured();
    return ['-m', MODULE, '--database', settings.directory, '--checkout', settings.checkout, '--node', process.execPath];
  }
  function command(entry, alias, expectedRevision = 0) {
    check(ALIAS.test(alias ?? ''), 'DATASET_ANALYSIS_ALIAS_INVALID', 'Use a source name beginning with a letter, followed by letters, numbers or underscores.');
    const args = common();
    return { executable: settings.python,
      register: [...args, 'source', '--name', alias, '--session', entry.session, '--room', entry.room,
        '--expected-revision', String(expectedRevision)],
      serve: [...args, 'serve'], status: [...args, 'status'] };
  }
  function environment() {
    return { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', TZ: 'UTC',
      PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' };
  }
  function launch(args) {
    configured();
    const child = spawn(settings.python, ['-B', '-c', BOOTSTRAP, String(process.pid),
      join(settings.checkout, 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python'), ...args.slice(2)],
    { env: environment(), shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const current = { child, done: false, error: null, exit: null, stopping: null, url: null, workspaceId: null };
    current.closed = new Promise(resolve => {
      child.once('error', error => { current.error = error; current.done = true; resolve(); });
      child.once('close', (code, signal) => {
        current.exit = { code, signal }; current.done = true;
        if (active === current) active = null;
        if (transient === current) transient = null;
        resolve();
      });
    });
    return current;
  }
  function stopProcess(current) {
    if (!current || current.done) return Promise.resolve();
    if (current.stopping) return current.stopping;
    current.stopping = (async () => {
      try {
        if (process.platform !== 'win32') process.kill(-current.child.pid, 'SIGINT');
        else current.child.kill('SIGINT');
      } catch (error) { if (error.code !== 'ESRCH') current.error ??= error; }
      // The original Python owner drains dispatched jobs. Its native Runtime
      // closes its child on interruption; the bounded fallback owns this group.
      const timer = setTimeout(() => {
        if (current.done) return;
        try {
          if (process.platform !== 'win32') process.kill(-current.child.pid, 'SIGKILL');
          else current.child.kill('SIGKILL');
        } catch (error) { if (error.code !== 'ESRCH') current.error ??= error; }
      }, 20000);
      try { await current.closed; } finally { clearTimeout(timer); }
    })();
    return current.stopping;
  }
  async function stopOwned() { await Promise.all([stopProcess(active), stopProcess(transient)]); }
  async function run(args, signal) {
    if (signal?.aborted || closed) throw stopped();
    const current = launch(args); transient = current;
    const output = [], errors = []; let total = 0, exceeded = false, timedOut = false;
    const collect = target => chunk => {
      total += chunk.length;
      if (total > LIMIT) { exceeded = true; void stopProcess(current); return; }
      target.push(chunk);
    };
    current.child.stdout.on('data', collect(output)); current.child.stderr.on('data', collect(errors));
    const abort = () => { void stopProcess(current); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; abort(); }, 360000);
    try {
      await current.closed;
      if (signal?.aborted || closed) throw stopped();
      check(!exceeded, 'DATASET_ANALYSIS_RESPONSE_LIMIT');
      check(!timedOut, 'DATASET_ANALYSIS_COMMAND_TIMEOUT');
      if (current.error || current.exit?.code !== 0) {
        const text = Buffer.concat(errors).toString('utf8');
        const original = text.match(/\b(ANALYSIS_[A-Z0-9_]+|DATASET_[A-Z0-9_]+|OBJECT_[A-Z0-9_]+)\b/g)?.at(-1);
        throw fault(original ?? 'DATASET_ANALYSIS_COMMAND_FAILED',
          original ?? 'The original analysis command did not complete.', 409);
      }
      try { return JSON.parse(Buffer.concat(output).toString('utf8')); }
      catch { throw fault('DATASET_ANALYSIS_RESPONSE_INVALID'); }
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async function http(current, path, value, signal) {
    check(current && current === active && !current.done && current.url, 'DATASET_ANALYSIS_NOT_RUNNING', undefined, 409);
    if (signal?.aborted) throw stopped();
    const launch = new URL(current.url), body = value === undefined ? null : Buffer.from(JSON.stringify(value));
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      const req = request(new URL(path, launch.origin), { method: body ? 'POST' : 'GET',
        headers: { 'X-Analysis-Capability': launch.hash.slice(1), Origin: launch.origin,
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': String(body.length) } : {}) },
        signal }, response => {
        response.on('data', chunk => {
          size += chunk.length;
          if (size > LIMIT) { req.destroy(fault('DATASET_ANALYSIS_RESPONSE_LIMIT')); return; }
          chunks.push(chunk);
        });
        response.once('error', reject);
        response.once('end', () => {
          let data; try { data = JSON.parse(Buffer.concat(chunks)); }
          catch { reject(fault('DATASET_ANALYSIS_RESPONSE_INVALID')); return; }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            const code = /^[A-Z0-9_]{1,120}$/.test(data?.error ?? '') ? data.error : 'DATASET_ANALYSIS_REQUEST_FAILED';
            reject(fault(code, code, response.statusCode)); return;
          }
          resolve(data);
        });
      });
      req.setTimeout(360000, () => req.destroy(fault('DATASET_ANALYSIS_REQUEST_TIMEOUT')));
      req.once('error', error => reject(signal?.aborted ? stopped() : error));
      req.end(body);
    });
  }
  async function savedState(signal) {
    configured();
    if (active?.url && !active.done) return http(active, '/api/state', undefined, signal);
    try { await lstat(join(settings.directory, 'datasets.sqlite3')); }
    catch (error) { if (error.code === 'ENOENT') return { workspace_id: null, sources: [] }; throw error; }
    return run([...common(), 'status'], signal);
  }
  async function serve(signal) {
    if (active?.url && !active.done) return active;
    if (signal?.aborted || closed) throw stopped();
    await privateDirectory(settings.directory, true);
    const current = launch([...common(), 'serve', '--port', '0']); active = current;
    let output = '', errors = '', ready = false, oversized = false;
    current.child.stdout.on('data', chunk => {
      if (Buffer.byteLength(output) + chunk.length > 65536) { oversized = true; void stopProcess(current); return; }
      output += chunk.toString('utf8');
      for (const line of output.split('\n')) {
        try { if (JSON.parse(line).status === 'LISTENING') ready = true; } catch { /* Wait for its complete original line. */ }
      }
    });
    current.child.stderr.on('data', chunk => { if (errors.length < 65536) errors += chunk.toString('utf8').slice(0, 65536 - errors.length); });
    const abort = () => { void stopProcess(current); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      for (let index = 0; index < 300 && !ready && !current.done && !signal?.aborted && !closed; index++) await pause(50);
      if (signal?.aborted || closed) throw stopped();
      const original = errors.match(/\b(ANALYSIS_[A-Z0-9_]+|DATASET_[A-Z0-9_]+)\b/g)?.at(-1);
      check(ready && !current.done && !oversized, original ?? 'DATASET_ANALYSIS_START_FAILED',
        'The original analysis server did not open.', 409);
      const saved = await readJson(join(settings.directory, 'analysis-launch.json'));
      let url; try { url = new URL(saved.url); } catch { throw fault('DATASET_ANALYSIS_LAUNCH_INVALID'); }
      check(saved.pid === current.child.pid && /^[a-f0-9]{32}$/.test(saved.workspace_id ?? '') &&
        url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && url.pathname === '/' &&
        !url.search && !url.username && !url.password && /^[A-Za-z0-9_-]{32,128}$/.test(url.hash.slice(1)),
      'DATASET_ANALYSIS_LAUNCH_INVALID');
      current.url = url.href; current.workspaceId = saved.workspace_id;
      const state = await http(current, '/api/state', undefined, signal);
      check(state.workspace_id === current.workspaceId, 'DATASET_ANALYSIS_WORKSPACE_CHANGED', undefined, 409);
      return current;
    } catch (error) { await stopProcess(current); throw error; }
    finally { signal?.removeEventListener('abort', abort); }
  }
  function exclusive(kind, action, signal) {
    check(!closed && !working, 'DATASET_ANALYSIS_BUSY', 'The original analysis launcher is already working.', 409);
    const task = { kind, promise: null }; working = task;
    const abort = () => { void stopOwned(); };
    signal?.addEventListener('abort', abort, { once: true });
    task.promise = Promise.resolve().then(() => {
      if (closed || signal?.aborted) throw stopped();
      return action();
    }).finally(() => { signal?.removeEventListener('abort', abort); if (working === task) working = null; });
    return task.promise;
  }
  function publicState() {
    return { configured: settings !== null, working: Boolean(working), action: working?.kind ?? null,
      running: Boolean(active && !active.done), directory: settings?.directory ?? null,
      ...(active?.url ? { url: active.url, workspaceId: active.workspaceId,
        alias: active.alias ?? null, sessionId: active.sessionId ?? null } : {}) };
  }
  function openDataset(entry, alias) {
    return exclusive('DATASET_SOURCE', async () => {
      command(entry, alias);
      await stopOwned(); await privateDirectory(settings.directory, true);
      const state = await savedState(), prior = (state.sources ?? []).find(source => source.name === alias);
      const registered = await run(command(entry, alias, prior?.revision ?? 0).register);
      const current = await serve(); current.alias = alias; current.sessionId = entry.sessionId;
      return { alias, registered, workspaceId: current.workspaceId, url: current.url };
    });
  }
  function attachObject({ name, session, destination, format, expected_revision, workspaceId = null } = {}, { signal } = {}) {
    configured();
    check(ALIAS.test(name ?? '') && ['json', 'csv'].includes(format), 'OBJECT_ANALYSIS_SOURCE_INVALID');
    absolute(session, 'original object session'); absolute(destination, 'recorded object destination');
    check(Number.isSafeInteger(expected_revision) && expected_revision >= 0, 'ANALYSIS_SOURCE_REVISION_REQUIRED');
    return exclusive('OBJECT_SOURCE', async () => {
      const current = await serve(signal);
      check(workspaceId === null || current.workspaceId === workspaceId, 'DATASET_ANALYSIS_WORKSPACE_CHANGED', undefined, 409);
      const registered = await http(current, '/api/object-source',
        { name, session, destination, format, expected_revision }, signal);
      check(registered?.name === name && Number.isSafeInteger(registered.revision) && registered.revision > 0,
        'OBJECT_ANALYSIS_REGISTRATION_INVALID');
      current.alias = name;
      return { alias: name, registered, workspaceId: current.workspaceId, url: current.url };
    }, signal);
  }
  async function acquireSnapshotLease() {
    check(!working && !active, 'OBJECT_ANALYSIS_STOP_BEFORE_BACKUP',
      'Stop the analysis workspace before reviewing or capturing its database.', 409);
    if (settings === null) return async () => {};
    try { await lstat(settings.directory); } catch (error) { if (error.code === 'ENOENT') return async () => {}; throw error; }
    await privateDirectory(settings.directory);
    // Hold the ORIGINAL Python analysis.lock through capture. This is the same
    // inherited-open-description flock pattern used by the native seller.
    const handle = await open(join(settings.directory, 'analysis.lock'),
      constants.O_RDWR | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      const info = await handle.stat();
      check(info.isFile() && info.nlink === 1 && !(info.mode & 0o077), 'ANALYSIS_PRIVATE_LOCK_REQUIRED');
      await new Promise((resolve, reject) => {
        const child = spawn('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '75', '3'],
          { shell: false, stdio: ['ignore', 'ignore', 'ignore', handle.fd] });
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.once('error', () => { clearTimeout(timer); reject(fault('FLOCK_UNAVAILABLE')); });
        child.once('exit', code => {
          clearTimeout(timer);
          if (code === 0) resolve(); else reject(fault(code === 75 ? 'OBJECT_ANALYSIS_STOP_BEFORE_BACKUP' : 'FLOCK_FAILED', undefined, 409));
        });
      });
      return () => handle.close();
    } catch (error) { await handle.close(); throw error; }
  }
  return { configured: settings !== null, command, open: openDataset, attachObject, state: publicState, acquireSnapshotLease,
    inspect: ({ signal } = {}) => exclusive('STATUS', () => savedState(signal), signal),
    reopen: ({ signal } = {}) => exclusive('OPEN', async () => {
      const current = await serve(signal); return { workspaceId: current.workspaceId, url: current.url };
    }, signal),
    stop: () => stopOwned(),
    wait: () => active?.closed ?? Promise.resolve(),
    async close() {
      if (closing) return closing; closed = true;
      closing = (async () => {
        await stopOwned(); await working?.promise.catch(() => {}); await stopOwned();
      })();
      return closing;
    } };
}
