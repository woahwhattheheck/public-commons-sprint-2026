// SPDX-License-Identifier: MIT
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireWorkspaceLease, privateDirectory } from '../vendor/stellar-expert/store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = 'tjlabs.tiptap-browser-receiving.v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const clone = value => structuredClone(value);
const now = () => new Date().toISOString();
function need(value, code, message) { if (!value) throw Object.assign(new Error(message), { code }); }
function clean(error) { return { code: error?.code || 'BROWSER_RECEIVING_FAILED', message: String(error?.message || error) }; }
async function readJSON(path) { return JSON.parse(await fs.readFile(path, 'utf8')); }
async function exists(path) { try { await fs.lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function regular(path) { const stat = await fs.lstat(path); need(stat.isFile() && !stat.isSymbolicLink(), 'FILE_NOT_REGULAR', path); return stat; }
async function directorySync(path) { const file = await fs.open(path, 'r'); try { await file.sync(); } finally { await file.close(); } }
async function atomic(path, bytes) {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + '.tmp-' + randomUUID(), file = await fs.open(temp, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  await fs.rename(temp, path); await directorySync(dirname(path));
}
async function immutable(path, bytes) {
  if (await exists(path)) { await regular(path); need((await fs.readFile(path)).equals(bytes), 'IMMUTABLE_OUTPUT_CHANGED', path); return; }
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + '.tmp-' + randomUUID(), file = await fs.open(temp, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  try { await fs.link(temp, path); }
  catch (error) { if (error.code !== 'EEXIST') throw error; need((await fs.readFile(path)).equals(bytes), 'IMMUTABLE_OUTPUT_CHANGED', path); }
  finally { await fs.unlink(temp); }
  await directorySync(dirname(path));
}
async function descriptor(path, root) {
  const stat = await regular(path), bytes = await fs.readFile(path);
  return { path: relative(root, path).split(sep).join('/'), bytes: bytes.length, sha256: hash(bytes), device: stat.dev, inode: stat.ino };
}
async function verifyFiles(root, files) {
  for (const f of files) {
    need(f.path && !f.path.split('/').some(p => p === '..' || p === ''), 'RESULT_PATH_INVALID', f.path);
    const actual = await descriptor(join(root, f.path), root);
    need(actual.bytes === f.bytes && actual.sha256 === f.sha256, 'RESULT_OUTPUT_CHANGED', f.path);
  }
}
function semantic(value) {
  if(Array.isArray(value))return value.map(semantic);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,semantic(value[k])]));
  return value;
}
function retainedView(value) {
  const view=structuredClone(value);
  for(const key of ['historical','currentRevision','runtime','permissions'])delete view[key];
  for(const doc of view.documents||[])delete doc.access;
  for(const deployment of view.deployments||[])delete deployment.connections;
  return JSON.stringify(semantic(view));
}
function sameResult(a,b){return retainedView(a.view)===retainedView(b.view)&&JSON.stringify(semantic(a.result))===JSON.stringify(semantic(b.result));}

export function receivingLifetime(parentSignal = null) {
  const controller = new AbortController();
  let first = null, finished = false;
  const fail = error => {
    const value = error instanceof Error ? error : new Error(String(error));
    first ||= value;
    if (!controller.signal.aborted) controller.abort(first);
    return first;
  };
  const fromParent = () => fail(parentSignal.reason || Object.assign(new Error('The original receiving operation was interrupted.'), { code: 'RECEIVING_INTERRUPTED' }));
  const handlers = [];
  if (parentSignal) {
    if (parentSignal.aborted) fromParent();
    else { parentSignal.addEventListener('abort', fromParent, { once: true }); handlers.push(() => parentSignal.removeEventListener('abort', fromParent)); }
  } else {
    for (const name of ['SIGINT', 'SIGTERM']) {
      const listener = () => fail(Object.assign(new Error('The original receiving owner received ' + name + '.'), { code: 'RECEIVING_INTERRUPTED', signal: name }));
      process.on(name, listener); handlers.push(() => process.removeListener(name, listener));
    }
  }
  for (const stream of [process.stdout, process.stderr]) {
    const listener = error => fail(error);
    stream.on('error', listener); handlers.push(() => stream.removeListener('error', listener));
  }
  return {
    signal: controller.signal, fail, get first() { return first; },
    check() { if (controller.signal.aborted) throw first || controller.signal.reason; },
    async finish() {
      if (finished) return;
      await new Promise(resolve => setImmediate(resolve));
      for (const remove of handlers) remove();
      finished = true;
    },
  };
}
export async function receivingWrite(stream, value, lifetime) {
  try {
    await new Promise((resolve, reject) => {
      stream.write(value, error => error ? reject(error) : resolve());
    });
  } catch (error) { lifetime.fail(error); throw error; }
}
async function settledWork(promises, lifetime) {
  const rows = await Promise.allSettled(promises.map(promise => Promise.resolve(promise).catch(error => {
    lifetime.fail(error); throw error;
  })));
  const failed = rows.find(row => row.status === 'rejected');
  if (failed) throw lifetime.first || failed.reason;
  lifetime.check(); return rows.map(row => row.value);
}
async function pauseReceiving(milliseconds, signal = null) {
  if (signal?.aborted) throw signal.reason;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() { signal?.removeEventListener('abort', stop); resolve(); }
    function stop() { clearTimeout(timer); signal.removeEventListener('abort', stop); reject(signal.reason); }
    signal?.addEventListener('abort', stop, { once: true });
  });
}
let originalBootId;
async function browserProcessIdentity(pid) {
  try {
    const root = '/proc/' + pid;
    const status = await fs.readFile(root + '/status', 'utf8');
    const uid = /^Uid:\s+(\d+)/m.exec(status);
    if (!uid || Number(uid[1]) !== process.getuid()) return null;
    const stat = await fs.readFile(root + '/stat', 'utf8');
    const visiblePid = Number(stat.slice(0, stat.indexOf(' ')));
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    const raw = await fs.readFile(root + '/cmdline');
    const namespaceRow = /^NSpid:\s+(.+)$/m.exec(status);
    const namespacePids = namespaceRow ? namespaceRow[1].trim().split(/\s+/).map(Number) : [visiblePid];
    const pidNamespace = await fs.readlink(root + '/ns/pid');
    originalBootId ||= (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
    need(Number.isSafeInteger(visiblePid) && visiblePid > 0 && namespacePids.every(n => Number.isSafeInteger(n) && n > 0) &&
      /^\d+$/.test(fields[19] || ''), 'BROWSER_PROCESS_IDENTITY', 'Retain the actual original Linux process identity.');
    return { pid: visiblePid, namespacePid: namespacePids.at(-1), namespacePids, pidNamespace, bootId: originalBootId,
      parent: Number(fields[1]), state: fields[0], startTicks: fields[19], uid: Number(uid[1]),
      argv: raw.toString('utf8').split('\0').filter(Boolean), executable: await fs.realpath(root + '/exe') };
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return null; throw error; }
}
function sameBrowserProcess(a, b) {
  return !!(a && b && a.pid === b.pid && a.startTicks === b.startTicks && a.uid === b.uid &&
    a.executable === b.executable && a.bootId === b.bootId && a.pidNamespace === b.pidNamespace &&
    a.namespacePid === b.namespacePid);
}
function insideBrowserDirectory(root, path) {
  const child = relative(root, path);
  return child !== '' && !child.startsWith('..' + sep) && child !== '..' && !child.startsWith(sep);
}
async function browserProcessRows() {
  const rows = [];
  for (const name of (await fs.readdir('/proc')).filter(name => /^\d+$/.test(name))) {
    const row = await browserProcessIdentity(name); if (row) rows.push(row);
  }
  return rows;
}
const LAUNCH_CUSTODY = Symbol.for('tjlabs.tiptap.original-browser-launch-custody.v1');

class Journal {
  constructor(path, value, lifetime) { this.path = path; this.value = value; this.lifetime = lifetime; this.tail = Promise.resolve(); }
  save() {
    const bytes = json(this.value);
    this.tail = this.tail.then(() => atomic(this.path, bytes), () => atomic(this.path, bytes)); return this.tail;
  }
  async step(key, run) {
    this.lifetime.check();
    const previous = this.value.steps[key];
    if (previous?.state === 'complete') return clone(previous.result);
    const step = previous || { state: 'prepared', createdAt: now(), data: {} };
    this.value.steps[key] = step; await this.save();
    try { const result = await run(step); step.result = result; step.state = 'complete'; step.completedAt = now(); delete step.error; await this.save(); return clone(result); }
    catch (error) { step.error = clean(error); step.lastFailureAt = now(); try { await this.save(); } catch (secondary) { this.lifetime.fail(error); } throw error; }
  }
}
function argumentMap(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) { const key = argv[i]; need(key.startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--'), 'ARGUMENT_REQUIRED', key); result[key.slice(2)] = argv[++i]; }
  return result;
}
async function waitForState(fn, timeout = 60000, description = 'original state', signal = null) {
  const until = Date.now() + timeout; let last;
  while (Date.now() < until) {
    if (signal?.aborted) throw signal.reason;
    try { const value = await fn(); if (signal?.aborted) throw signal.reason; if (value) return value; }
    catch (error) { if (signal?.aborted) throw signal.reason; last = error; }
    await pauseReceiving(150, signal);
  }
  throw Object.assign(new Error('Timed out waiting for ' + description + (last ? ': ' + last.message : '')), { code: 'BROWSER_STATE_TIMEOUT' });
}
async function inspect(page) { return page.evaluate(() => window.migrationWorkspace?.inspect() || null); }
function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return (value.text || '') + (Array.isArray(value.content) ? value.content.map(textOf).join('\n') : '');
}
function count(text, part) { return text.split(part).length - 1; }
function locatorFor(page, action, id) {
  return page.locator('[data-action=' + JSON.stringify(action) + ']' + (id === undefined ? '' : '[data-id=' + JSON.stringify(id) + ']')).first();
}

/** Real browser continuation. The parent supplies its original HTTP callbacks. */
export async function runBrowserJourney({
  directory, sourceRoot, origin, actors, projectId, documentIds, playwright, chromium,
  phase = 'collaboration', runtimeReadySha256, sourceManifestSha256,
  checkpoint, restore, expectedHandoffs = [], historicalRevision = null, onProgress = () => {}, signal = null, recoverCompleted = false,
}) {
  const lifetime = receivingLifetime(signal), attemptId = randomUUID();
  let closure = null, closureValue = null, journalCloseAttempted = false;
  let lease = null, journal, browser = null, completedCandidate = null;
  let outputs, input, journalPath, resultPath, currentLaunch = null, launchSettled = true;
  let closing = false, nativeClosed = false, ownerClosed = false, closePromise = null, monitorStop = false, monitor = null;
  const contexts = new Map(), pages = new Map(), actorOwners = new Map(), downloads = new Set(), tasks = new Set();
  const processes = new Map(), errors = [];
  const noteError = error => { if (errors.length < 64) errors.push(clean(error)); return lifetime.fail(error); };
  const track = promise => {
    const held = Promise.resolve(promise);
    tasks.add(held); held.then(() => tasks.delete(held), error => { tasks.delete(held); noteError(error); });
    return held;
  };
  const waitFor = (fn, timeout, description) => waitForState(fn, timeout, description, lifetime.signal);
  const all = promises => settledWork(promises, lifetime);
  const owner = { close: () => closeOwnedJourney(), get closed() { return ownerClosed; }, get closure() { return closure; } };
  function assertAdmission() { lifetime.check(); need(!closing, 'BROWSER_CLOSING', 'The original browser is draining.'); }
  async function saveProfile(key, context = contexts.get(key), { final = false } = {}) {
    if (!context) return;
    const state = await context.storageState({ indexedDB: true }); state.cookies = [];
    const bytes = json(state);
    for (const actor of Object.values(actors)) need(!bytes.includes(Buffer.from(actor.token)), 'AUTH_IN_PROFILE', 'A host token appeared in a browser profile.');
    await atomic(join(directory, 'profiles', key + '.json'), bytes);
    const held = actorOwners.get(key); if (held) { held.profileSaved = true; if (final) held.finalProfileSaved = true; }
  }
  async function processSelection() {
    const rows = await browserProcessRows(), byPid = new Map(rows.map(row => [row.pid, row])), selected = new Map();
    const launches = journal?.value?.launches || [];
    for (const row of rows) {
      if (row.executable !== (currentLaunch?.executable || journal?.value?.browserExecutable)) continue;
      const argument = row.argv.find(value => value.startsWith('--user-data-dir='));
      if (!argument) continue;
      const profile = resolve(argument.slice('--user-data-dir='.length));
      const launch = launches.find(value => insideBrowserDirectory(value.directory, profile));
      if (launch) selected.set(row.pid, { ...row, launchId: launch.id, profile });
    }
    for (const original of [...Object.values(journal?.value?.browserProcesses || {}), ...processes.values()]) {
      const row = byPid.get(original.pid);
      if (sameBrowserProcess(original, row)) selected.set(row.pid, { ...row, launchId: original.launchId, profile: original.profile });
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) if (!selected.has(row.pid) && selected.has(row.parent)) {
        const parent = selected.get(row.parent);
        selected.set(row.pid, { ...row, launchId: parent.launchId, profile: parent.profile }); changed = true;
      }
    }
    return [...selected.values()];
  }
  async function rememberProcesses() {
    const rows = await processSelection(); let changed = false;
    for (const row of rows) {
      const key = row.pid + ':' + row.startTicks;
      const previous = processes.get(key) || journal?.value?.browserProcesses?.[key];
      if (previous) need(sameBrowserProcess(previous, row) && previous.launchId === row.launchId &&
        previous.profile === row.profile, 'BROWSER_PROCESS_CHANGED', 'The original browser process binding changed.');
      processes.set(key, row);
      if (journal && !journal.value.browserProcesses?.[key]) {
        journal.value.browserProcesses ||= {}; journal.value.browserProcesses[key] = row; changed = true;
      }
    }
    if (changed) await journal.save();
    return rows;
  }
  async function closeProcesses() {
    let rows = await rememberProcesses();
    if (!rows.some(row => row.state !== 'Z')) return;
    const self = await browserProcessIdentity('self');
    need(self, 'BROWSER_PROCESS_IDENTITY', 'Retain the current original browser owner.');
    const launches = journal.value.launches || [];
    for (const row of rows.filter(row => row.state !== 'Z')) {
      const launch = launches.find(value => value.id === row.launchId);
      need(launch && insideBrowserDirectory(launch.directory, row.profile),
        'BROWSER_LAUNCH_UNKNOWN', 'A live browser process has no original launch intent.');
      const actualOwner = await browserProcessIdentity(launch.node.pid);
      need(!sameBrowserProcess(actualOwner, launch.node) ||
        (currentLaunch?.id === launch.id && sameBrowserProcess(actualOwner, self)),
        'BROWSER_OWNER_LIVE', 'Another original Node owner still holds this browser.');
    }
    const sent = new Set(); let kill = false, deadline = Date.now() + 10000;
    for (;;) {
      const live = rows.filter(row => row.state !== 'Z');
      if (!live.length) { await new Promise(resolve => setImmediate(resolve)); return; }
      for (const row of live) {
        const key = row.pid + ':' + row.startTicks + ':' + (kill ? 'KILL' : 'TERM');
        if (sent.has(key)) continue;
        const actual = await browserProcessIdentity(row.pid);
        if (!sameBrowserProcess(actual, row) || actual.state === 'Z') continue;
        need(actual.pidNamespace === self.pidNamespace && actual.namespacePid !== self.namespacePid,
          'BROWSER_SIGNAL_IDENTITY', 'Signal only the retained Chromium leaf in this PID namespace.');
        try { process.kill(actual.namespacePid, kill ? 'SIGKILL' : 'SIGTERM'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
        sent.add(key);
      }
      if (Date.now() >= deadline) {
        need(!kill, 'BROWSER_PROCESS_LIVE', 'The same original Chromium leaves remain live; retain this owner and lease.');
        kill = true; deadline = Date.now() + 10000;
      }
      await pauseReceiving(100); rows = await rememberProcesses();
    }
  }
  async function joinTasks() {
    while (tasks.size) {
      const rows = await Promise.allSettled([...tasks]);
      for (const row of rows) if (row.status === 'rejected') noteError(row.reason);
    }
  }
  async function closeEverything() {
    closing = true;
    for (const [key, held] of actorOwners) {
      if (!held.operatorClosed && !held.operatorLost) {
        if (!held.page) held.operatorClosed = true;
        else if (held.page.isClosed() || held.contextClosed) {
          held.operatorLost = true; noteError(Object.assign(new Error('The original operator closed before its local owners were drained: ' + key), { code: 'OPERATOR_LOST' }));
        } else {
          try {
            const result = await held.page.evaluate(async () => {
              if (!window.migrationWorkspace) return { state: 'NOT_OPENED' };
              if (typeof window.migrationWorkspace.close !== 'function') throw new Error('The original operator close facade is unavailable.');
              return window.migrationWorkspace.close();
            });
            need(result?.state === 'CLOSED' || result?.state === 'NOT_OPENED',
              'OPERATOR_DRAIN_INCOMPLETE', 'The original operator has not drained its local owners.');
            held.operatorClosed = true; held.operatorReceipt = result;
          } catch (error) { noteError(error); }
        }
      }
      if ((held.operatorClosed || held.operatorLost) && !held.finalProfileSaved && !held.contextClosed) {
        try { await saveProfile(key, held.context, { final: true }); }
        catch (error) { noteError(error); }
      }
    }
    // All acquired route handlers are joined before their context is released.
    await joinTasks();
    for (const item of [...downloads]) {
      let settled = false;
      try { await item.cancel(); } catch (error) { noteError(error); }
      try { await item.failure(); settled = true; } catch (error) { noteError(error); }
      if (settled) {
        try { await item.delete(); downloads.delete(item); } catch (error) { noteError(error); }
      }
    }
    for (const [key, held] of actorOwners) {
      if (!held.contextClosed && (held.operatorClosed || held.operatorLost) && held.finalProfileSaved) {
        try { await held.context.close(); held.contextClosed = true; }
        catch (error) { noteError(error); }
      }
      if (held.contextClosed) {
        if (!held.finalProfileSaved && !held.profileLost) {
          held.profileLost = true;
          noteError(Object.assign(new Error('The original browser context closed before its final profile was retained: ' + key), { code: 'BROWSER_PROFILE_NOT_RETAINED' }));
        }
        contexts.delete(key); pages.delete(key);
      }
    }
    const allContextsClosed = [...actorOwners.values()].every(held => held.contextClosed);
    if (browser && allContextsClosed) {
      try { await browser.close(); } catch (error) { noteError(error); }
    }
    if (launchSettled && allContextsClosed && (!browser || !browser.isConnected())) {
      try {
        await closeProcesses();
        browser = null;
      } catch (error) { noteError(error); }
    }
    await joinTasks();
    const nativeProcessesGone = !(await rememberProcesses()).some(row => row.state !== 'Z');
    if (allContextsClosed && !browser && launchSettled && nativeProcessesGone && tasks.size === 0) {
      // A lost transport can make Download.failure/delete reject after its
      // original context, Chromium and all admitted saveAs calls have settled.
      // These exact download owners are then physically closed; keep their
      // first error and private temp files, rather than wait on a dead channel.
      downloads.clear();
    }
    return allContextsClosed && !browser && launchSettled && downloads.size === 0 && tasks.size === 0 && nativeProcessesGone;
  }
  async function drainNativeOwners() {
    while (!nativeClosed) {
      try { nativeClosed = await closeEverything(); }
      catch (error) { noteError(error); }
      if (!nativeClosed) await pauseReceiving(500);
    }
    monitorStop = true; if (monitor) await monitor;
    await joinTasks();
  }
  async function closureDescriptor(path) {
    const row = await descriptor(path, directory);
    return { path: row.path, bytes: row.bytes, sha256: row.sha256 };
  }
  async function closeOwnedJourney() {
    if (ownerClosed) return;
    if (closePromise) return closePromise;
    closePromise = (async () => {
      await drainNativeOwners();
      if (journal && !journalCloseAttempted) {
        journalCloseAttempted = true;
        journal.value.lastClosureErrors = errors;
        journal.value.ownerClosure = { at: now(), browser: true, contexts: true, downloads: true, tasks: true,
          operator: [...actorOwners.values()].every(held => held.operatorClosed),
          profiles: [...actorOwners.values()].every(held => held.finalProfileSaved) };
        try { await journal.save(); } catch (error) { noteError(error); }
      }
      if (lease) await lease.close();
      lease = null;
      if (journal && input && resultPath) {
        if (!closureValue) closureValue = {
          schema: 'tjlabs.tiptap-browser-owner-closed.v1',
          operationId: 'TIPTAP-HOCUSPOCUS-WORKSHARE-0C7A-20261012',
          attemptId, runId: journal.value.runId, phase, inputSha256: hash(json(input)),
          closedAt: now(), result: await exists(resultPath) ? await closureDescriptor(resultPath) : null,
          firstError: lifetime.first ? clean(lifetime.first) : null,
          closed: { browser: true, contexts: true, downloads: true, tasks: true, files: true, lease: true,
            operator: [...actorOwners.values()].every(held => held.operatorClosed),
            profiles: [...actorOwners.values()].every(held => held.finalProfileSaved) },
        };
        const path = join(directory, 'owner-closures', attemptId + '.json');
        await immutable(path, json(closureValue));
        closure = await closureDescriptor(path);
      }
      ownerClosed = true;
    })();
    try { await closePromise; } catch (error) { closePromise = null; throw error; }
  }
  async function finalizeOwners() {
    while (!ownerClosed) {
      try { await closeOwnedJourney(); }
      catch (error) { noteError(error); await pauseReceiving(500); }
    }
  }
  async function launchOriginal(engine) {
    assertAdmission();
    need(!globalThis[LAUNCH_CUSTODY], 'BROWSER_LAUNCH_BUSY', 'Another original Chromium acquisition is active in this Node owner.');
    const launch = { id: randomUUID(), node: await browserProcessIdentity('self'),
      executable: await fs.realpath(resolve(chromium)), directory: join(directory, 'tmp', 'launch-' + randomUUID()), startedAt: now() };
    need(launch.node, 'BROWSER_PROCESS_IDENTITY', 'Retain the actual Node owner before Chromium acquisition.');
    await privateDirectory(launch.directory, { create: true });
    journal.value.launches ||= []; journal.value.launches.push(launch);
    journal.value.browserExecutable = launch.executable; await journal.save();
    need(!globalThis[LAUNCH_CUSTODY], 'BROWSER_LAUNCH_BUSY', 'Another original Chromium acquisition is active in this Node owner.');
    currentLaunch = launch; launchSettled = false; globalThis[LAUNCH_CUSTODY] = launch;
    // Playwright creates its own native profile via os.tmpdir() before spawning.
    // Scope that original acquisition to a retained unique directory and restore
    // the exact prior environment only after the original launch promise settles.
    const hadTemporary = Object.hasOwn(process.env, 'TMPDIR'), previousTemporary = process.env.TMPDIR;
    process.env.TMPDIR = launch.directory;
    monitorStop = false;
    monitor = (async () => {
      while (!monitorStop) {
        try { await rememberProcesses(); } catch (error) { noteError(error); }
        await pauseReceiving(100);
      }
    })();
    try {
      browser = await engine.launch({ headless: true, executablePath: resolve(chromium),
        env: { ...process.env, TMPDIR: launch.directory } });
      await rememberProcesses();
      need((await processSelection()).some(row => row.state !== 'Z'),
        'BROWSER_PROCESS_UNOBSERVED', 'Retain the actual original Chromium process before opening an operator.');
      assertAdmission();
    } finally {
      launchSettled = true;
      if (hadTemporary) process.env.TMPDIR = previousTemporary; else delete process.env.TMPDIR;
      if (globalThis[LAUNCH_CUSTODY] === launch) delete globalThis[LAUNCH_CUSTODY];
    }
  }
  async function actorPage(key) {
    assertAdmission();
    if (pages.has(key)) return pages.get(key);
    const statePath = join(directory, 'profiles', key + '.json');
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
      ...(await exists(statePath) ? { storageState: await readJSON(statePath) } : {}) });
    contexts.set(key, context);
    const held = { context, page: null, operatorClosed: false, operatorLost: false, profileSaved: false, finalProfileSaved: false, contextClosed: false };
    actorOwners.set(key, held);
    context.on('close', () => { held.contextClosed = true; });
    const page = await context.newPage(); held.page = page; pages.set(key, page);
    page.on('download', item => downloads.add(item));
    page.on('dialog', dialog => { track(dialog.accept()).catch(() => {}); });
    return page;
  }
  async function open(page, actor, pane = 'documents', revision = null) {
    assertAdmission();
    const url = origin + '/#/' + pane + '?project=' + encodeURIComponent(projectId) + (revision === null ? '' : '&revision=' + revision);
    const entry = [...actorOwners].find(([, held]) => held.page === page);
    need(entry, 'BROWSER_PAGE_OWNER_MISSING', 'Retain the original page and context before navigation.');
    const [key, held] = entry;
    const previous = await page.evaluate(async () => {
      if (!window.migrationWorkspace) return { state: 'NOT_OPENED' };
      if (typeof window.migrationWorkspace.close !== 'function') throw new Error('The original operator close facade is unavailable.');
      return window.migrationWorkspace.close();
    });
    need(previous?.state === 'CLOSED' || previous?.state === 'NOT_OPENED', 'OPERATOR_NAVIGATION_PENDING',
      'Drain the original installed operator before navigating its page.');
    held.operatorClosed = true; held.operatorReceipt = previous;
    await saveProfile(key, held.context, { final: true });
    assertAdmission();
    held.operatorClosed = false; held.operatorLost = false; held.finalProfileSaved = false;
    // These original routes differ only by hash. A closed app must be replaced,
    // not reused by a same-document fragment navigation.
    await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
    assertAdmission();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitFor(() => page.evaluate(() => !!window.migrationWorkspace), 60000, 'the original operator facade');
    if (!(await inspect(page))?.actorId) {
      await page.locator('#tt-token').fill(actor.token);
      await page.locator('#tt-auth-form button[type=submit]').click();
    }
    await waitFor(async () => {
      const view = await inspect(page);
      return view?.actorId === actor.id && view.projectId === projectId && view.pane === pane && view.storageLoaded &&
        !view.storageError && view.historical === (revision !== null) && (revision === null || view.revision === revision) ? view : false;
    }, 60000, 'rendered ' + pane + ' and selected project revision');
    return inspect(page);
  }
  async function refresh(page, pane = 'documents') {
    await page.locator('#tt-refresh').click();
    await waitFor(async () => {
      const view = await inspect(page);
      return view?.projectId === projectId && view.pane === pane && view.storageLoaded && !view.storageError ? view : false;
    }, 60000, 'current project');
  }
  async function editor(page, actor, documentId, expectedEpoch = null) {
    await open(page, actor, 'documents');
    await locatorFor(page, 'open-document', documentId).click();
    return waitFor(async () => {
      const value = (await inspect(page))?.editor;
      return value?.identity?.documentId === documentId && (!expectedEpoch || value.identity.epochId === expectedEpoch)
        && value.localReady && value.initialSync && value.authenticated ? value : false;
    }, 90000, 'authorized native editor ' + actor.id);
  }
  async function saved(page, marker = null) {
    return waitFor(async () => {
      await page.evaluate(() => window.migrationWorkspace.flushEditor());
      const value = (await inspect(page))?.editor;
      return value?.saved && value.localPersisted && (!marker || textOf(value.json).includes(marker)) ? value : false;
    }, 90000, 'complete native binary persistence');
  }
  async function append(page, marker, step, key) {
    const state = (await inspect(page))?.editor;
    need(state?.identity?.access === 'write' && !state.retired, 'EDITOR_NOT_WRITABLE', key);
    const text = textOf(state.json);
    if (count(text, marker) === 1) return state;
    need(count(text, marker) === 0, 'REFERENCE_EDIT_DUPLICATED', marker);
    if (!step.data[key]) { step.data[key] = { before: state.json, identity: state.identity, marker }; await journal.save(); }
    const box = page.locator('#tt-editor .ProseMirror');
    await box.focus(); await box.press('ControlOrMeta+End'); await page.keyboard.insertText(' ' + marker);
    const value = await waitFor(async () => { const v = (await inspect(page))?.editor; return count(textOf(v?.json), marker) === 1 ? v : false; }, 30000, 'one original browser edit');
    await saveProfile([...pages].find(([, p]) => p === page)[0]);
    return value;
  }
  async function capture(page, name) {
    const path = join(directory, 'tmp', 'screenshots', name + '.png');
    if (!(await exists(path))) await immutable(path, await page.screenshot({ fullPage: true }));
    return { ...await descriptor(path, directory), temporary: true, purpose: 'live-visual-inspection' };
  }
  async function download(page, button, name) {
    assertAdmission();
    const path = join(outputs, name);
    if (await exists(path)) return descriptor(path, directory);
    let listener, stop, timer, resolveEvent, rejectEvent;
    const event = new Promise((resolve, reject) => { resolveEvent = resolve; rejectEvent = reject; });
    const cleanup = () => { page.removeListener('download', listener); lifetime.signal.removeEventListener('abort', stop); clearTimeout(timer); };
    listener = item => { downloads.add(item); cleanup(); resolveEvent(item); };
    stop = () => { cleanup(); rejectEvent(lifetime.signal.reason || new Error('The original download was interrupted.')); };
    page.once('download', listener);
    lifetime.signal.addEventListener('abort', stop, { once: true });
    timer = setTimeout(() => { cleanup(); rejectEvent(Object.assign(new Error('The original UI did not start its selected download.'), { code: 'BROWSER_DOWNLOAD_PENDING' })); }, 60000);
    event.catch(() => {});
    let item;
    try {
      await button.click(); item = await event; lifetime.check();
      need(!(await item.failure()), 'BROWSER_DOWNLOAD_FAILED', name);
      const temporary = path + '.download-' + randomUUID(); await item.saveAs(temporary);
      const bytes = await fs.readFile(temporary); await immutable(path, bytes); await fs.unlink(temporary);
      await item.delete(); downloads.delete(item);
      return descriptor(path, directory);
    } catch (error) {
      cleanup(); rejectEvent(error); await event.catch(() => {}); throw error;
    }
  }
  async function exactHTTPReplay(page) {
    return journal.step('original-http-response-replay', async step => {
      await open(page, actors.operator, 'overview');
      const marker = 'Receiving request ' + journal.value.runId;
      if (!step.data.wire) {
        await locatorFor(page, 'form', 'project.update').click();
        await page.locator('#tt-field-notes').fill(marker);
      } else {
        const pending = (await inspect(page))?.pending;
        if (!pending && step.data.replay) return step.data.replay;
        need(pending?.requestId === step.data.wire.requestId && pending.bodyText === step.data.wire.bodyText,
          'ORIGINAL_UI_PENDING_MISSING', 'Restore the original retained browser profile before replaying this request.');
      }
      let caught = null;
      const route = intercepted => track((async () => {
        const request = intercepted.request(), text = request.postData() || '', body = JSON.parse(text);
        if (body.action !== 'project.update' || body.payload?.notes !== marker) { await intercepted.continue(); return; }
        try {
          const wire = { requestId: body.requestId, bodyText: text, expectedRevision: body.expectedRevision, path: '/api/actions' };
          if (step.data.wire) need(JSON.stringify(wire) === JSON.stringify(step.data.wire), 'HTTP_REPLAY_CHANGED', 'The UI changed the original request.');
          else { step.data.wire = wire; await journal.save(); }
          // The original UI has already committed its exact pending body.
          await saveProfile('operator');
          const response = await intercepted.fetch();
          const bytes = await response.body();
          need(response.ok(), 'ORIGINAL_HTTP_REJECTED', bytes.toString('utf8').slice(0,2000));
          const value = JSON.parse(bytes);
          const path = join(outputs, 'original-committed-http-response.json');
          if (!step.data.originalResponse) { step.data.originalResponse = value; await immutable(path, bytes); await journal.save(); }
          else need(sameResult(value,step.data.originalResponse),
            'ORIGINAL_HTTP_RESULT_CHANGED', 'Replay changed its committed result.');
          await intercepted.abort('failed');
        } catch (error) { caught = error; lifetime.fail(error); try { await intercepted.abort('failed'); } catch {} }
      })());
      if (!step.data.originalResponse) {
        await page.route('**/api/actions', route);
        if (step.data.wire) await locatorFor(page, 'retry-pending').click();
        else await page.locator('#tt-form-submit').click();
        await waitFor(async () => { if(caught) throw caught; const p=(await inspect(page))?.pending;return p?.state === 'uncertain' && p.requestId === step.data.wire?.requestId ? p : false; },60000,'retained original uncertain request');
        await page.unroute('**/api/actions', route);
        if(caught) throw caught;
        await saveProfile('operator');
      }
      const pending=(await inspect(page))?.pending;
      if (pending) {
        need(pending.requestId===step.data.wire.requestId && pending.bodyText===step.data.wire.bodyText,'HTTP_REPLAY_CHANGED','Retry must retain the complete original UI body.');
        await locatorFor(page,'retry-pending').click();
      }
      const observed = await waitFor(async () => {
        const value=await inspect(page);
        return !value.pending && value.lastOutcome?.requestId===step.data.wire.requestId ? value.lastOutcome : false;
      },60000,'original committed replay');
      need(observed.response.replayed===true,'HTTP_REPLAY_NOT_OBSERVED','The server must identify the same committed request replay.');
      need(sameResult(observed.response,step.data.originalResponse),
        'HTTP_REPLAY_RESULT_CHANGED','The replay did not return its original view/result.');
      step.data.replay={requestId:step.data.wire.requestId,bodySha256:hash(step.data.wire.bodyText),expectedRevision:step.data.wire.expectedRevision,
        original:step.data.originalResponse,replay:observed.response};
      await saveProfile('operator');return step.data.replay;
    });
  }
  try {
    lifetime.check();
  directory = resolve(directory); sourceRoot = await fs.realpath(sourceRoot);
  need(await fs.realpath(fileURLToPath(import.meta.url)) === join(sourceRoot, 'receiving', 'browser.mjs'), 'BROWSER_SOURCE_MISMATCH', 'Use the browser entry from the selected source.');
  need(new URL(origin).origin === origin && ['http:', 'https:'].includes(new URL(origin).protocol), 'ORIGIN_INVALID', 'Select the actual application origin.');
  need((recoverCompleted ? actors?.operator?.id : actors?.operator?.token) && projectId, 'BROWSER_INPUT_MISSING', 'The original project and host actors are required.');
  await privateDirectory(directory, { create: true });
  lease = await acquireWorkspaceLease(directory); outputs = join(directory, 'outputs');
  await fs.mkdir(outputs, { recursive: true, mode: 0o700 });
  input = { sourceRoot, origin, projectId, documentIds, phase, runtimeReadySha256, sourceManifestSha256,
    browserSourceSha256: hash(await fs.readFile(fileURLToPath(import.meta.url))),
    playwright: resolve(playwright), chromium: resolve(chromium),
    actors: Object.fromEntries(Object.entries(actors).map(([k, a]) => [k, { id: a.id, name: a.name, tenantIds: a.tenantIds }])) };
  journalPath = join(directory, 'browser-journal.json'); resultPath = join(directory, 'result.json');
    const old = await exists(journalPath) ? await readJSON(journalPath) : null;
    if(old) need(JSON.stringify(old.input)===JSON.stringify(input),'BROWSER_OPERATION_CHANGED','Use the original browser source, inputs and directory.');
    if(recoverCompleted) {
      need(old?.finalCandidate?.state==='complete' && old.finalCandidate.schema===SCHEMA &&
        JSON.stringify(old.finalCandidate.input)===JSON.stringify(input) && await exists(resultPath),
        'BROWSER_COMPLETED_RESULT_REQUIRED','Local closure recovery requires the already-published original complete result and journal.');
      need((await fs.readFile(resultPath)).equals(json(old.finalCandidate)),
        'BROWSER_COMPLETED_RESULT_CHANGED','The immutable browser result differs from its original final candidate.');
    }
    journal = new Journal(journalPath,old || {schema:SCHEMA,runId:randomUUID(),input,state:'prepared',createdAt:now(),steps:{},files:[]}, lifetime);
    await journal.save(); await lease.assert();
    await closeProcesses(); lifetime.check();
    if(journal.value.finalCandidate) {
      await verifyFiles(directory,journal.value.finalCandidate.files);
      await immutable(resultPath,json(journal.value.finalCandidate));
      journal.value.state='complete';await journal.save();completedCandidate=journal.value.finalCandidate;return completedCandidate;
    }
    need(!recoverCompleted,'BROWSER_COMPLETED_RESULT_REQUIRED','Completed-only recovery cannot open a new browser.');
    need(!(await exists(resultPath)),'RESULT_JOURNAL_MISSING','A final browser result exists without its original candidate.');
    await fs.mkdir(join(directory,'tmp'),{recursive:true,mode:0o700});
    const module = await import(pathToFileURL(resolve(playwright)).href), engine=module.chromium || module.default?.chromium;
    need(engine,'PLAYWRIGHT_CHROMIUM_MISSING','Select the original installed Playwright module.');
    await launchOriginal(engine);
    journal.value.state='running';journal.value.browserStartedAt ||= now();await journal.save();
    const operator=await actorPage('operator');await open(operator,actors.operator,'overview');
    if(phase==='collaboration') {
      need(checkpoint && restore && documentIds?.[0] && actors['editor-a'] && actors['editor-b'] && actors.viewer && actors.outsider,
        'COLLABORATION_INPUT_MISSING','Use all original actors, document and parent checkpoint/restore callbacks.');
      await exactHTTPReplay(operator);
      const a=await actorPage('editor-a'),b=await actorPage('editor-b'),doc=documentIds[0];
      const markers={a:'editor-a-'+journal.value.runId,b:'editor-b-'+journal.value.runId,
        deletion:'delete-only-'+journal.value.runId,offline:'offline-merge-'+journal.value.runId,retired:'retired-epoch-'+journal.value.runId};
      if(!journal.value.steps['epoch-restore']?.data?.restore) {
        await editor(a,actors['editor-a'],doc);await editor(b,actors['editor-b'],doc);
      }
      await journal.step('native-concurrent-edit',async step=>{
        const left=(await inspect(a)).editor,right=(await inspect(b)).editor;
        need(left.identity.epochId===right.identity.epochId,'EDITOR_EPOCH_MISMATCH','Both original editors must select the same physical document.');
        step.data.before ||= {left,right};await journal.save();
        await all([append(a,markers.a,step,'a'),append(b,markers.b,step,'b')]);
        const [aSaved,bSaved]=await all([saved(a,markers.b),saved(b,markers.a)]);
        need(aSaved.persisted.sha256===bSaved.persisted.sha256,'CONCURRENT_NATIVE_STATE_MISMATCH','The two native documents have not converged to one persisted binary.');
        return {left:aSaved,right:bSaved,markers:[markers.a,markers.b]};
      });
      await journal.step('native-delete-only-persistence',async step=>{
        if(!step.data.beforeDeletion) {
          await append(a,markers.deletion,step,'insert');await saved(b,markers.deletion);
          step.data.beforeDeletion=await saved(a,markers.deletion);await journal.save();
        }
        const current=(await inspect(a)).editor;
        if(textOf(current.json).includes(markers.deletion)) {
          await a.evaluate(marker=>{
            const root=document.querySelector('#tt-editor .ProseMirror'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
            const nodes=[];let n,text='';while(n=walker.nextNode()){nodes.push({node:n,start:text.length,end:text.length+n.textContent.length});text+=n.textContent;}
            const start=text.indexOf(marker);if(start<0||text.indexOf(marker,start+1)>=0)throw new Error('Original deletion marker is not unique.');
            const left=nodes.find(v=>v.start<=start&&v.end>start),end=start+marker.length,right=nodes.find(v=>v.start<end&&v.end>=end);
            const range=document.createRange();range.setStart(left.node,start-left.start);range.setEnd(right.node,end-right.start);
            const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);root.focus();
          },markers.deletion);
          await a.keyboard.press('Backspace');
        }
        const after=await saved(a);await waitFor(async()=>!textOf((await inspect(b)).editor.json).includes(markers.deletion),30000,'native delete propagation');
        const peer=await saved(b);
        need(!textOf(after.json).includes(markers.deletion) && after.persisted.sha256!==step.data.beforeDeletion.persisted.sha256,
          'DELETION_NOT_PERSISTED','The complete native update must reflect the deletion.');
        need(after.persisted.stateVectorBase64===step.data.beforeDeletion.persisted.stateVectorBase64,
          'REFERENCE_DELETION_VECTOR_CHANGED','The selected reference action was not a pure native deletion; retain its actual before/after bytes for review.');
        need(after.persisted.sha256===peer.persisted.sha256,'DELETION_PEER_MISMATCH','The second editor has not retained the same deleted state.');
        await all([saveProfile('editor-a'),saveProfile('editor-b')]);
        return {before:step.data.beforeDeletion,after,peer,vectorUnchanged:true,completeBinaryChanged:true};
      });
      await journal.step('native-offline-reconnect',async step=>{
        if(!(await inspect(a)).editor.offline)await a.locator('#tt-editor-network-toggle').click();
        await waitFor(async()=>(await inspect(a)).editor.offline,30000,'original provider disconnect');
        if(!step.data.remoteBefore){step.data.remoteBefore=(await inspect(b)).editor;await journal.save();}
        await append(a,markers.offline,step,'offline');
        await a.evaluate(()=>window.migrationWorkspace.flushEditor());
        const local=(await inspect(a)).editor,remote=(await inspect(b)).editor;
        need(local.localPersisted&&!local.saved&&!textOf(remote.json).includes(markers.offline),'OFFLINE_STATE_NOT_ISOLATED','Offline changes must be local until the original socket reconnects.');
        step.data.offline=local;await journal.save();await saveProfile('editor-a');
        await a.locator('#tt-editor-network-toggle').click();
        const [left,right]=await all([saved(a,markers.offline),saved(b,markers.offline)]);
        need(left.persisted.sha256===right.persisted.sha256,'OFFLINE_MERGE_MISMATCH','The original Yjs reconnect has not converged.');
        return {offline:step.data.offline,after:left,peer:right};
      });
      await journal.step('host-tenant-and-viewer-access',async()=>{
        const viewer=await actorPage('viewer');const read=await editor(viewer,actors.viewer,doc);
        need(read.identity.access==='read'&&!read.editable,'VIEWER_EDITABLE','The host viewer must have a read-only native editor.');
        need(await viewer.locator('#tt-editor .ProseMirror').getAttribute('contenteditable')==='false','VIEWER_CONTENTEDITABLE','The viewer document is editable.');
        const outsider=await actorPage('outsider');await open(outsider,actors.outsider,'documents');
        const wrong=await outsider.evaluate(async({projectId,doc,token})=>{
          const r=await fetch('/api/projects/'+encodeURIComponent(projectId)+'/documents/'+encodeURIComponent(doc)+'/session',
            {method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',credentials:'omit'});
          return {status:r.status,body:await r.json()};
        },{projectId,doc,token:actors.outsider.token});
        need([403,404].includes(wrong.status),'TENANT_BOUNDARY_BROKEN','A wrong-tenant actor received the original document session.');
        return {viewer:read,wrongTenant:wrong};
      });
      await journal.step('epoch-restore',async step=>{
        if(step.data.restore && !step.data.closedObservation) {
          // The content effect is retained; an absent original browser observation
          // cannot be manufactured by creating another restore.
          throw Object.assign(new Error('The original restore committed before its old-browser observation was retained. Keep that native result and the saved old-epoch binary for explicit continuation review.'),{code:'EPOCH_BROWSER_OBSERVATION_INTERRUPTED'});
        }
        const before=await saved(a);
        if(!step.data.checkpoint){step.data.checkpoint=await checkpoint({documentId:doc,persisted:before.persisted});await journal.save();}
        if(!(await inspect(a)).editor.offline)await a.locator('#tt-editor-network-toggle').click();
        await append(a,markers.retired,step,'retired');
        await a.evaluate(()=>window.migrationWorkspace.flushEditor());
        step.data.oldOffline=(await inspect(a)).editor;await journal.save();await saveProfile('editor-a');
        await a.locator('#tt-editor-download').click();
        const binary=await download(a,a.getByRole('button',{name:'Download native .yjs',exact:true}),'old-epoch-offline.yjs');
        const manifest=await download(a,a.getByRole('button',{name:'Download state identity',exact:true}),'old-epoch-offline.json');
        await a.locator('[data-close-detail]').first().click();
        step.data.offlineFiles=[binary,manifest];await journal.save();
        step.data.restore=await restore({checkpointId:step.data.checkpoint.checkpointId,documentId:doc,previousEpochId:before.identity.epochId});
        await journal.save();
        await waitFor(async()=>!!(await inspect(a))?.editor?.retired,60000,'old physical epoch retirement');
        const retired=(await inspect(a)).editor;
        need(retired.identity.epochId===before.identity.epochId&&textOf(retired.json).includes(markers.retired)&&!retired.editable,
          'OLD_EPOCH_NOT_RETAINED','The previous native cache must remain separate and read-only.');
        const current=await editor(b,actors['editor-b'],doc,step.data.restore.epochId),persisted=await saved(b);
        need(current.identity.epochId!==before.identity.epochId&&!textOf(persisted.json).includes(markers.retired),
          'OLD_OFFLINE_STATE_ENTERED_NEW_EPOCH','The restored document absorbed an old offline update.');
        const oldFile=await readJSON(join(directory,manifest.path));
        need(oldFile.identity.epochId===before.identity.epochId&&oldFile.sha256===binary.sha256,'OLD_EPOCH_EXPORT_CHANGED','The native offline export is not bound to its original epoch.');
        step.data.closedObservation={retired,current:persisted,offlineFiles:step.data.offlineFiles,checkpoint:step.data.checkpoint,restore:step.data.restore};await journal.save();
        await a.locator('#tt-close-editor').click();
        const reopened=await editor(a,actors['editor-a'],doc,step.data.restore.epochId);await saved(a);
        return {...step.data.closedObservation,reopened};
      });
    } else need(phase==='receiving','BROWSER_PHASE_INVALID','Select the complete collaboration or receiving view journey.');

    await journal.step('desktop-mobile-and-history',async()=>{
      const page=operator,files=[];
      for(const width of [1440,390]) {
        await page.setViewportSize({width,height:1000});
        for(const pane of ['overview','sources','access','editions','migrations','documents','runtime','delivery']) {
          await open(page,actors.operator,pane);
          need(await page.locator('#tt-main h1').count()===1,'OPERATOR_PANE_MISSING',pane);
          files.push(await capture(page,phase+'-'+width+'-'+pane));
        }
      }
      await page.setViewportSize({width:1440,height:1000});
      if(historicalRevision!==null) {
        const view=await open(page,actors.operator,'documents',historicalRevision);
        need(view.historical&&view.revision===historicalRevision,'HISTORICAL_VIEW_MISMATCH','The browser selected another revision.');
        const enabled=await page.locator('[data-action="open-document"]:enabled').count();
        need(enabled===0,'HISTORICAL_EDITOR_ENABLED','A historical document cannot authorize a live editable provider.');
        files.push(await capture(page,phase+'-historical'));
      }
      for(const h of expectedHandoffs) {
        await open(page,actors.operator,'delivery');
        const file=await download(page,locatorFor(page,'download-handoff',h.id),'handoff-'+h.id+'.ndjson.gz');
        need(file.bytes===h.bytes&&file.sha256===h.sha256,'HANDOFF_BROWSER_BYTES_CHANGED',h.id);files.push(file);
      }
      return {files};
    });
    for(const step of Object.values(journal.value.steps)) need(step.state==='complete','BROWSER_STEP_INCOMPLETE','A retained browser step has no completed observation.');
    await drainNativeOwners();
    lifetime.check();
    need([...actorOwners.values()].every(held => held.operatorClosed && held.finalProfileSaved), 'BROWSER_FINAL_PROFILE_INCOMPLETE', 'Complete every original operator drain and final retained profile before the browser result.');
    const files=[];
    for(const name of await fs.readdir(outputs)) if(!(name.includes('.tmp-')||name.includes('.download-')))files.push(await descriptor(join(outputs,name),directory));
    completedCandidate={schema:SCHEMA,runId:journal.value.runId,input,state:'complete',completedAt:now(),ownersClosedAt:now(),
      observations:clone(journal.value.steps),files};
    journal.value.finalCandidate=completedCandidate;await journal.save();
    await verifyFiles(directory,files);await immutable(resultPath,json(completedCandidate));
    journal.value.state='complete';await journal.save();await onProgress({phase:'browser-complete',result:resultPath,files:files.length});
    return completedCandidate;
  } catch(error) {
    lifetime.fail(error);
    try { error.browserJourney = owner; error.closeFailedBrowserJourney = owner.close; } catch {}
    if(journal){journal.value.lastError=clean(error);journal.value.lastFailureAt=now();await journal.save().catch(()=>{});}
    throw error;
  } finally {
    await finalizeOwners();
    if (completedCandidate && closure) Object.defineProperty(completedCandidate, 'ownerClosure', { value: closure, enumerable: false, configurable: true });
    await lifetime.finish();
    if (lifetime.first) {
      try { lifetime.first.browserJourney = owner; lifetime.first.closeFailedBrowserJourney = owner.close; } catch {}
      throw lifetime.first;
    }
  }
}
export async function main(argv=process.argv.slice(2), { signal = null } = {}) {
  const args=argumentMap(argv);
  const input=await readJSON(resolve(args.input));
  need(input.phase==='receiving','PARENT_RECEIVER_REQUIRED','Collaboration uses the original parent receiving callbacks; run receive.mjs.');
  const auth=await readJSON(resolve(args.auth));
  const actors=Object.fromEntries(auth.actors.map(a=>[a.id,a]));
  return runBrowserJourney({...input,actors,directory:args.directory,sourceRoot:args.source,playwright:args.playwright,chromium:args.chromium,signal});
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const cliLifetime = receivingLifetime();
  try {
    const value = await main(process.argv.slice(2), { signal: cliLifetime.signal });
    await receivingWrite(process.stdout, JSON.stringify({ state:value.state,runId:value.runId,files:value.files.length,
      phase:'owner-closed',closure:value.ownerClosure })+'\n',cliLifetime);
    cliLifetime.check();
  } catch (error) {
    cliLifetime.fail(error); process.exitCode=1;
    try { await receivingWrite(process.stderr, JSON.stringify({...clean(cliLifetime.first),
      closure:error.browserJourney?.closure || null})+'\n',cliLifetime); } catch {}
  } finally {
    await cliLifetime.finish();
    if (cliLifetime.first) process.exitCode=1;
  }
}
