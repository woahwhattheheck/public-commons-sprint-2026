// MIT. Call the maintained Python source archive without changing its writer.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { need, MAX_MANIFEST_BYTES } from './manifest.mjs';

export async function nativeArchive(action, input, { python = process.env.PYTHON ?? 'python3', signal } = {}) {
  need(['archive', 'inspect', 'extract'].includes(action), 'EDGAR_PORTABLE_ACTION_INVALID');
  const child = spawn(python, ['-B', fileURLToPath(new URL('./archive.py', import.meta.url))], {
    stdio: ['pipe', 'pipe', 'pipe'], shell: false, signal,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  const output = [], errors = [];
  let size = 0, errorSize = 0, failure = null;
  child.stdout.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_MANIFEST_BYTES + 1024 * 1024) {
      failure = Object.assign(new Error('The complete archive response exceeds its manifest limit.'), {
        code: 'EDGAR_PORTABLE_ARCHIVE_RESPONSE_LIMIT',
      });
      child.kill('SIGTERM');
    } else output.push(chunk);
  });
  child.stderr.on('data', chunk => {
    if (errorSize < 65536) errors.push(chunk.subarray(0, 65536 - errorSize));
    errorSize += chunk.length;
  });
  const ended = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  child.stdin.on('error', error => { failure ??= error; });
  child.stdin.end(JSON.stringify({ ...input, action }));
  const result = await ended;
  if (failure) throw failure;
  if (result.code !== 0) {
    let value;
    try { value = JSON.parse(Buffer.concat(errors).toString('utf8')); } catch {}
    throw Object.assign(new Error(value?.message ?? 'The original archive operation did not finish.'), {
      code: value?.error ?? 'EDGAR_PORTABLE_ARCHIVE_FAILED', exitCode: result.code,
    });
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(output))); }
  catch { need(false, 'EDGAR_PORTABLE_ARCHIVE_RESPONSE_INVALID'); }
}
