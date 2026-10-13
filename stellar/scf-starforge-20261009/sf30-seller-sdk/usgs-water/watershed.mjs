// MIT. Native watershed lifecycle within the original Water project.
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const COMMANDS = new Set(['list','read','capture','inspect','review','preview','execute','handover','receive','download','working','reopen-working']);
export async function watershedCommand({ directory, command, input = {}, env = process.env, signal } = {}) {
  if (!COMMANDS.has(command)) throw Object.assign(new Error('Choose a watershed operation.'), { code: 'WATER_WATERSHED_COMMAND' });
  const executable = env.USGS_WATERSHED_PYTHON || env.USGS_HECDSS_PYTHON || 'python3';
  return new Promise((done, reject) => {
    const child = spawn(executable, [join(HERE, 'watershed.py'), command, resolve(directory)], {
      stdio: ['pipe','pipe','pipe'], env, detached: process.platform !== 'win32',
    });
    const stdout = [], stderr = [];
    let spawnError, cancelled = false;
    child.on('error', error => { spawnError = error; });
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.stdin.on('error', () => {});
    function abort() {
      cancelled = true;
      if (!child.pid) return;
      if (process.platform === 'win32') {
        // Keep the Python owner, its operation lease and exact Job alive until
        // the original native tree closes. The result stays in saved history.
        return;
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') child.kill(); }
      }
    }
    child.once('close', (code, nativeSignal) => {
      signal?.removeEventListener('abort', abort);
      if (spawnError) return reject(spawnError);
      if (cancelled) return reject(Object.assign(new Error('The watershed operation was interrupted; reopen its saved migration.'), { code: 'WATER_WATERSHED_INTERRUPTED' }));
      let result;
      try { result = JSON.parse(Buffer.concat(stdout).toString('utf8')); }
      catch { return reject(Object.assign(new Error('The native watershed command returned no complete JSON result. ' + Buffer.concat(stderr).toString('utf8')), { code: 'WATER_WATERSHED_NATIVE', exitCode: code, nativeSignal })); }
      if (code || result?.error) return reject(Object.assign(new Error(result?.error?.message || Buffer.concat(stderr).toString('utf8') || 'The watershed operation failed.'), { code: result?.error?.code || 'WATER_WATERSHED_NATIVE' }));
      done(result);
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdin.end(JSON.stringify(input));
  });
}
