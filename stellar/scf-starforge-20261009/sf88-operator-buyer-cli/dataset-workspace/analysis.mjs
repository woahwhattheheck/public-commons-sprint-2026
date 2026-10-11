// MIT. The customer's ORIGINAL Python analysis owner, launched from native paths.
import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { absolute, privateDirectory, readJson, fault } from '../../sf30-seller-sdk/postgres/publisher/files.mjs';
import { check } from './receiving.mjs';

const MODULE = 'stellar_forge_buyer.analysis_workspace';
const ALIAS = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function analysisLauncher(settings = null) {
  let active = null, closed = false, working = false;
  if (settings !== null) {
    check(settings && Object.keys(settings).every(key => ['python', 'checkout', 'directory'].includes(key)), 'DATASET_ANALYSIS_SETTINGS_INVALID');
    for (const key of ['python', 'checkout', 'directory']) absolute(settings[key], key);
  }
  function command(entry, alias, expectedRevision = 0) {
    check(settings !== null, 'DATASET_ANALYSIS_NOT_CONFIGURED', 'Configure the original Python analysis launcher on this operator host.');
    check(ALIAS.test(alias ?? ''), 'DATASET_ANALYSIS_ALIAS_INVALID', 'Use a source name beginning with a letter, followed by letters, numbers or underscores.');
    const common = ['-m', MODULE, '--database', settings.directory, '--checkout', settings.checkout, '--node', process.execPath];
    return { executable: settings.python,
      register: [...common, 'source', '--name', alias, '--session', entry.session, '--room', entry.room,
        '--expected-revision', String(expectedRevision)],
      serve: [...common, 'serve'], status: [...common, 'status'] };
  }
  function environment() {
    return { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', TZ: 'UTC', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPATH: join(settings.checkout, 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python') };
  }
  async function run(args) {
    const child = spawn(settings.python, args, { env: environment(), shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = [], errors = []; let total = 0, exceeded = false;
    const collect = target => chunk => {
      total += chunk.length;
      if (total > 2097152) { exceeded = true; child.kill('SIGINT'); return; }
      target.push(chunk);
    };
    child.stdout.on('data', collect(output)); child.stderr.on('data', collect(errors));
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
    });
    check(!exceeded, 'DATASET_ANALYSIS_RESPONSE_LIMIT');
    if (exit.code !== 0) {
      const text = Buffer.concat(errors).toString('utf8');
      const original = text.match(/\b(ANALYSIS_[A-Z0-9_]+|DATASET_[A-Z0-9_]+)\b/g)?.at(-1);
      throw fault(original ?? 'DATASET_ANALYSIS_COMMAND_FAILED',
        original ?? 'The original analysis command did not complete. Retained analytical data is unchanged.', 409);
    }
    try { return JSON.parse(Buffer.concat(output).toString('utf8')); }
    catch { throw fault('DATASET_ANALYSIS_RESPONSE_INVALID'); }
  }
  async function stopOwned() {
    const current = active;
    if (!current) return;
    current.child.kill('SIGINT');
    // The original Python owner drains its already-dispatched analytical job.
    await current.closed;
    if (active === current) active = null;
  }
  async function open(entry, alias) {
    check(!closed && !working, 'DATASET_ANALYSIS_BUSY', 'The original analysis launcher is already working.', 409);
    working = true;
    try {
      const plan = command(entry, alias);
      await stopOwned();
      await privateDirectory(settings.directory, true);
      let exists = false;
      try { await lstat(join(settings.directory, 'datasets.sqlite3')); exists = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const state = exists ? await run(plan.status) : { sources: [] };
      const prior = (state.sources ?? []).find(source => source.name === alias);
      const revision = prior?.revision ?? 0;
      const exact = command(entry, alias, revision);
      const registered = await run(exact.register);
      check(!closed, 'DATASET_ANALYSIS_CLOSED');
      const child = spawn(settings.python, exact.serve, { env: environment(), shell: false,
        stdio: ['ignore', 'pipe', 'pipe'] });
      let startupError = null, output = '', ready = false;
      const current = { child, url: null, alias, sessionId: entry.sessionId, closed: null };
      current.closed = new Promise(resolve => {
        child.once('error', error => { startupError = error; resolve(); });
        child.once('close', () => { if (active === current) active = null; resolve(); });
      });
      child.stdout.on('data', chunk => {
        if (output.length > 65536) return;
        output += chunk.toString('utf8');
        for (const line of output.split('\n')) {
          try { if (JSON.parse(line).status === 'LISTENING') ready = true; } catch { /* Wait for its complete original line. */ }
        }
      });
      child.stderr.on('data', () => {});
      active = current;
      for (let index = 0; index < 200 && !ready && !startupError && active === current; index++) await pause(50);
      check(ready && active === current && !startupError, 'DATASET_ANALYSIS_START_FAILED', 'The original analysis server did not open.', 409);
      const launch = await readJson(join(settings.directory, 'analysis-launch.json'));
      let url; try { url = new URL(launch.url); } catch { throw fault('DATASET_ANALYSIS_LAUNCH_INVALID'); }
      check(launch.pid === child.pid && url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
        url.port && url.pathname === '/' && !url.search && !url.username && !url.password && url.hash.length > 20,
      'DATASET_ANALYSIS_LAUNCH_INVALID');
      current.url = url.href;
      return { alias, registered, workspaceId: launch.workspace_id, url: current.url };
    } catch (error) {
      await stopOwned();
      throw error;
    } finally { working = false; }
  }
  return { configured: settings !== null, command, open,
    state: () => ({ configured: settings !== null, working, running: Boolean(active),
      ...(active?.url ? { url: active.url, alias: active.alias, sessionId: active.sessionId } : {}) }),
    async close() { closed = true; await stopOwned(); } };
}
