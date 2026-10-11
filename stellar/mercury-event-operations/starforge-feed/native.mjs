// MIT. Invoke the original Python Mercury CLI without a shell or a second worker engine.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FeedError } from '../../scf-starforge-20261009/sf30-seller-sdk/webhook-feed/model.mjs';
import { bundlePath, readJson } from './plan.mjs';
import { DELIVERY_PATH, TOKEN_ENV, HMAC_ENV, validateMercuryScope } from './bridge.mjs';

export const MERCURY_SOURCE = fileURLToPath(new URL('../', import.meta.url));
export async function mercuryConfiguration(bundle) {
  const path = bundlePath(bundle.directory, bundle.config.mercuryConfig), source = await readJson(path, 262144);
  const scope = validateMercuryScope({ network: source.network ?? 'mainnet', provider_scope: source.provider_scope ?? 'customer-primary',
    provider_base: source.api_base, contracts: source.contracts }, { allowLocalProvider: bundle.config.allowLocalProvider });
  if (JSON.stringify(scope) !== JSON.stringify(validateMercuryScope(bundle.config.scope, { allowLocalProvider: bundle.config.allowLocalProvider })))
    throw new FeedError('MERCURY_BUNDLE_SCOPE_CHANGED', 409);
  const expected = 'http://127.0.0.1:' + bundle.config.ports.bridge + DELIVERY_PATH;
  if (source.destination?.kind !== 'http' || source.destination.url !== expected ||
      source.destination.token_env !== TOKEN_ENV || source.destination.hmac_secret_env !== HMAC_ENV ||
      source.destination.idempotency_supported !== true || source.allow_local_http !== true)
    throw new FeedError('MERCURY_DESTINATION_CHANGED', 409);
  return { path, source };
}
function argumentsFor(configPath, args) {
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) throw new TypeError('Native Mercury argument array required');
  return ['-B', '-m', 'mercury_ops', ...(configPath ? ['--config', configPath] : []), ...args];
}
export async function callMercury({ configPath, args, python = 'python3', inherit = false } = {}) {
  const child = spawn(python, argumentsFor(configPath, args), { cwd: MERCURY_SOURCE, env: process.env,
    stdio: inherit ? ['inherit', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', tooLarge = false, bytes = 0;
  if (!inherit) for (const [stream, isOutput] of [[child.stdout, true], [child.stderr, false]]) { stream.setEncoding('utf8'); stream.on('data', chunk => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 2097152) { tooLarge = true; child.kill('SIGTERM'); return; }
    if (isOutput) stdout += chunk; else stderr += chunk;
  }); }
  const result = await new Promise((done, fail) => {
    child.once('error', fail); child.once('close', (code, signal) => done({ code, signal }));
  });
  if (tooLarge) throw new FeedError('MERCURY_COMMAND_OUTPUT_TOO_LARGE', 503);
  if (result.code !== 0) throw new FeedError('MERCURY_COMMAND_FAILED', 503, { exitCode: result.code,
    signal: result.signal, ...(inherit ? {} : { detail: stderr.trim().slice(0, 1000) }) });
  if (inherit) return result;
  try { return stdout.trim() ? JSON.parse(stdout) : null; }
  catch { throw new FeedError('MERCURY_COMMAND_RESPONSE_INVALID', 503); }
}
export async function startMercuryApplication({ bundle, python = 'python3' }) {
  const { path } = await mercuryConfiguration(bundle), port = bundle.config.ports.mercury;
  const child = spawn(python, argumentsFor(path, ['serve', '--host', '127.0.0.1', '--port', String(port), '--shutdown-timeout', '25']),
    { cwd: MERCURY_SOURCE, env: process.env, stdio: ['ignore', 'pipe', 'inherit'] });
  let exited = null, closing, startupError = null, announced = false, announcement = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', text => {
    process.stdout.write(text);
    if (announced || announcement.length > 262144) return;
    announcement += text;
    try {
      const ready = JSON.parse(announcement);
      announced = ready.state === 'serving' && ready.url === 'http://127.0.0.1:' + port;
    } catch {}
  });
  const exit = new Promise(done => {
    child.once('error', error => { startupError = error; exited = { code: null, signal: null }; done(exited); });
    child.once('exit', (code, signal) => { exited = { code, signal }; done(exited); });
  });
  const close = () => closing ??= (async () => {
    if (exited) return exited;
    child.kill('SIGTERM');
    let timer;
    const grace = new Promise(done => { timer = setTimeout(() => done(null), 30000); });
    const result = await Promise.race([exit, grace]); clearTimeout(timer);
    if (result !== null) return result;
    child.kill('SIGKILL'); return exit;
  })();
  const origin = 'http://127.0.0.1:' + port;
  try {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (exited) throw new FeedError('MERCURY_START_FAILED', 503, { exitCode: exited.code, reason: startupError?.code ?? 'PROCESS_EXITED' });
      try {
        if (!announced) throw new Error('Waiting for this native process to announce its listener');
        const response = await fetch(origin + '/healthz', { redirect: 'error', signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok && !exited) return { child, origin, close, exited: exit };
      } catch {}
      await new Promise(done => setTimeout(done, 200));
    }
    throw new FeedError('MERCURY_START_TIMEOUT', 503);
  } catch (error) { await close(); throw error; }
}
