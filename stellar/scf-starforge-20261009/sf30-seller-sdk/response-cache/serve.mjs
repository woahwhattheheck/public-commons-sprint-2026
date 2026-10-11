// MIT. Launch the existing SF30 server with selected application-result caches.
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readSellerConfig, startSellerService } from '../serve.mjs';
import { bindResponseCaches } from './bind.mjs';
import { startCacheControl } from './control.mjs';

export async function startCachedSeller({ config, handlers, policy, socketPath,
  closeSource, ...sellerOptions } = {}) {
  if (closeSource !== undefined && typeof closeSource !== 'function') throw new TypeError('closeSource must be a function');
  const binding = bindResponseCaches({ config, handlers, policy });
  let seller, control, closing;
  const close = () => closing ??= (async () => {
    let failure;
    try { await seller?.close(); } catch (error) { failure = error; }
    try { await control?.close(); } catch (error) { failure ??= error; }
    const results = await binding.close();
    try { await closeSource?.(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
    if (results.some(result => !result.drained)) throw new Error('CACHE_SOURCE_DRAIN_INCOMPLETE');
  })();
  try {
    seller = await startSellerService({ ...sellerOptions, config: binding.config, handlers: binding.handlers });
    if (socketPath) control = await startCacheControl({ socketPath, binding });
    return { ...seller, binding, socketPath: control?.socketPath, close };
  } catch (error) { await close().catch(() => {}); throw error; }
}

const USAGE = `Usage: node response-cache/serve.mjs --config FILE --handlers FILE --cache FILE
  [--port 8423] [--socket /private/cache/control.sock] [--close-export NAME]
  [--facilitator HTTPS_URL] [--allow-local-facilitator]
  [--max-in-flight 64] [--drain-grace-ms 60000]

Uses the ORIGINAL seller and optional official x402 native factory. Without a
facilitator it serves original challenges; application handlers never execute.
Policy and source exports remain private operator configuration.`;

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(USAGE + '\n'); return null; }
  const flags = new Map(), allowed = new Set(['--config', '--handlers', '--cache', '--port',
    '--socket', '--close-export', '--facilitator', '--max-in-flight', '--drain-grace-ms']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flags.has(flag)) throw new TypeError('Duplicate option');
    if (flag === '--allow-local-facilitator') { flags.set(flag, true); continue; }
    if (!allowed.has(flag) || !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(USAGE);
    flags.set(flag, args[++i]);
  }
  if (!flags.has('--config') || !flags.has('--handlers') || !flags.has('--cache') ||
      flags.has('--allow-local-facilitator') && !flags.has('--facilitator')) throw new TypeError(USAGE);
  const configPath = resolve(flags.get('--config')), config = await readSellerConfig(configPath);
  const sourcePath = resolve(dirname(configPath), flags.get('--handlers'));
  const handlers = await import(pathToFileURL(sourcePath).href);
  const policyPath = resolve(flags.get('--cache')), info = await stat(policyPath);
  if (!info.isFile() || info.size > 1024 * 1024) throw new TypeError('Cache policy must be a JSON file up to 1 MiB');
  const bytes = await readFile(policyPath);
  if (bytes.length > 1024 * 1024) throw new TypeError('Cache policy too large');
  const policy = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const closeSource = flags.has('--close-export') ? handlers[flags.get('--close-export')] : undefined;
  if (flags.has('--close-export') && typeof closeSource !== 'function') throw new TypeError('Missing source close export');
  let nativeFactory = null;
  if (flags.has('--facilitator')) {
    const url = new URL(flags.get('--facilitator'));
    const local = flags.get('--allow-local-facilitator') && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
      throw new TypeError('Explicit HTTPS facilitator required');
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
      import('@x402/core/server'), import('../native-factory.mjs'),
    ]);
    nativeFactory = compiled => createNativeSellerServer(compiled, {
      facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }),
    });
  }
  const portText = flags.get('--port') ?? '8423';
  if (!/^\d{1,5}$/.test(portText)) throw new TypeError('Invalid port');
  const session = await startCachedSeller({ config, handlers, policy, closeSource, nativeFactory,
    port: Number(portText), socketPath: flags.get('--socket'),
    maxInFlight: Number(flags.get('--max-in-flight') ?? 64),
    drainGraceMs: Number(flags.get('--drain-grace-ms') ?? 60000) });
  process.stdout.write(JSON.stringify({ url: session.url, mode: session.mode,
    health: session.url + '/_seller/health', docs: session.url + '/_seller/docs',
    ...(session.socketPath ? { controlSocket: session.socketPath } : {}),
    cachedRoutes: Object.keys(session.binding.stats()) }) + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    session.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  });
  return session;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(String(error?.message ?? error) + '\n'); process.exitCode = 1; });
}
