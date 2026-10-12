// MIT. One native local data operation; retained input/output identities remain authoritative.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { issue, identity } from './contract.mjs';
import { atomicJson, readJson } from './files.mjs';

export async function runNative(input, { directory, python = 'python3', environment = process.env,
  signal, timeoutMs = 180000 } = {}) {
  if (typeof python !== 'string' || !python || python.startsWith('-') || /[\x00-\x1f]/.test(python))
    throw issue('CLOUD_PYTHON_EXECUTABLE_INVALID');
  if (signal?.aborted) throw issue('CLOUD_OPERATION_ABORTED');
  const request = { schema: 'stellar-forge.coinmetrics-native-operation.v1', ...input };
  const requestSha256 = identity(request), path = resolve(directory, 'native-' + requestSha256 + '.json');
  await atomicJson(path, { ...request, requestSha256 });
  const prefix = 'native-' + requestSha256 + '-attempt-';
  const attempts = (await readdir(directory)).filter(name => name.startsWith(prefix) && /^\d{6}\.json$/.test(name.slice(prefix.length))).sort();
  for (const name of attempts) {
    try {
      const retained = await readJson(resolve(directory, name.slice(0, -5) + '.result.json'));
      if (retained.requestSha256 !== requestSha256) throw issue('CLOUD_NATIVE_RESULT_CONFLICT', undefined, 409);
      if (retained.ok === true) return { ...retained, reused: true };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (attempts.length >= 1000) throw issue('CLOUD_NATIVE_ATTEMPT_LIMIT');
  const attempt = String(attempts.length + 1).padStart(6, '0');
  const attemptPath = resolve(directory, prefix + attempt + '.json');
  const output = resolve(directory, prefix + attempt + '.result.json');
  await atomicJson(attemptPath, { ...request, requestSha256, output });
  const env = Object.create(null);
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'TZ'])
    if (typeof environment[key] === 'string') env[key] = environment[key];
  return new Promise((done, fail) => {
    const child = spawn(python, ['-I', '-u', fileURLToPath(new URL('./native.py', import.meta.url)), attemptPath],
      { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let code = null, stdout = 0, stderr = 0;
    const stop = value => { code ??= value; child.kill('SIGKILL'); };
    const abort = () => stop('CLOUD_OPERATION_ABORTED');
    const timer = setTimeout(() => stop('CLOUD_NATIVE_TIMEOUT'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', chunk => { stdout += chunk.length; if (stdout > 65536) stop('CLOUD_NATIVE_OUTPUT_LIMIT'); });
    child.stderr.on('data', chunk => { stderr += chunk.length; if (stderr > 65536) stop('CLOUD_NATIVE_OUTPUT_LIMIT'); });
    child.once('error', () => { code ??= 'CLOUD_NATIVE_UNAVAILABLE'; });
    child.once('close', async exitCode => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (code) return fail(issue(code, 'The original local data operation can be reopened from its retained input.', 503));
      try {
        const result = await readJson(output);
        if (result.requestSha256 !== requestSha256) throw issue('CLOUD_NATIVE_RESULT_CONFLICT', undefined, 409);
        if (exitCode !== 0 || result.ok !== true) throw issue(/^CLOUD_[A-Z0-9_]+$/.test(result.error ?? '') ? result.error : 'CLOUD_NATIVE_FAILED',
          typeof result.message === 'string' ? result.message : 'The native data operation could not finish.');
        done(result);
      } catch (error) { fail(error.code ? error : issue('CLOUD_NATIVE_RESULT_UNAVAILABLE', undefined, 503)); }
    });
  });
}
