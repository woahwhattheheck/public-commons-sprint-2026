// MIT. Full Valyu merchant over the original SF30 seller, facilitator and operations.
import { readFile, stat, open, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createValyuServiceConfig, normalizeValyuProvider, validateValyuServiceConfig, VALYU_ROUTE, VALYU_SOURCE } from './config.mjs';
import { createValyuAdapter, createValyuAdmission } from './adapter.mjs';
import { startSellerService, readSellerConfig, validateSellerServiceConfig } from '../serve.mjs';
import { startSellerOperations } from '../operations/server.mjs';

const USAGE = `Usage:
  node valyu/merchant-cli.mjs compile --input merchant-input.json --out seller-service.json
  node valyu/merchant-cli.mjs inspect --config seller-service.json
  node valyu/merchant-cli.mjs serve --config seller-service.json
    [--port 8423] [--operations-port 8424] [--facilitator HTTPS_URL]
    [--allow-local-facilitator] [--history-dir PRIVATE_DIRECTORY] [--history-days 90]
    [--availability-dir PRIVATE_ABSOLUTE_DIRECTORY] [--max-in-flight 64] [--drain-grace-ms 60000]

compile writes a new native SF30 configuration. inspect reads its native offer and
public provider policy. serve binds the seller and original operations desk to
127.0.0.1. Without a facilitator it serves native CHALLENGE_ONLY previews; no
Valyu credential is needed. A facilitator starts the original native paid route
using the server-held API key named by provider.apiKeyEnv. See MERCHANT.md.`;

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(label + ' is outside its supported range');
  return value;
}
async function readInput(file) {
  const info = await stat(file);
  if (!info.isFile() || info.size > 1048576) throw new TypeError('Merchant input must be a regular JSON file up to 1 MiB');
  const bytes = await readFile(file);
  if (bytes.length > 1048576) throw new TypeError('Merchant input exceeds 1 MiB');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
async function writeNewJson(path, value) {
  const target = resolve(path), bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
  if (bytes.length > 1048576) throw new TypeError('Compiled merchant configuration exceeds 1 MiB');
  const handle = await open(target, 'wx', 0o600);
  let saved = false;
  try { await handle.writeFile(bytes); await handle.sync(); saved = true; }
  finally { await handle.close(); if (!saved) await unlink(target).catch(() => {}); }
  const directory = await open(dirname(target), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
  return target;
}
function facilitatorEndpoint(value, allowLocal) {
  const url = new URL(value);
  const local = allowLocal === true && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
    throw new TypeError('Facilitator requires HTTPS; explicit local HTTP requires --allow-local-facilitator');
  return url.href.replace(/\/$/, '');
}

/** Reuse one native listener and its original private operations/history view.
 * Trusted nativeFactory/adapterOptions are only embedding seams, never CLI input. */
export async function startValyuMerchant({ config, port = 8423, operationsPort = 8424,
  facilitatorUrl, allowLocalFacilitator = false, nativeFactory,
  historyDirectory, historyRetentionDays = 90, availabilityDirectory,
  maxInFlight = 64, drainGraceMs = 60000, adapterOptions = {} } = {}) {
  validateSellerServiceConfig(validateValyuServiceConfig(config));
  integer(port, 0, 65535, 'seller port'); integer(operationsPort, 0, 65535, 'operations port');
  if (port !== 0 && port === operationsPort) throw new TypeError('Seller and operations require distinct private ports');
  if (nativeFactory !== undefined && facilitatorUrl !== undefined)
    throw new TypeError('Choose the configured facilitator URL or a trusted native factory');
  if (nativeFactory !== undefined && typeof nativeFactory !== 'function')
    throw new TypeError('Trusted native factory must be a function');
  if (!adapterOptions || typeof adapterOptions !== 'object' || Array.isArray(adapterOptions) ||
      Object.hasOwn(adapterOptions, 'provider')) throw new TypeError('Provider policy comes from the merchant configuration');
  const provider = normalizeValyuProvider(config.provider);
  let factory = nativeFactory ?? null;
  if (facilitatorUrl !== undefined) {
    const url = facilitatorEndpoint(facilitatorUrl, allowLocalFacilitator);
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
      import('@x402/core/server'), import('../native-factory.mjs'),
    ]);
    factory = compiled => createNativeSellerServer(compiled, { facilitatorClient: new HTTPFacilitatorClient({ url }) });
  }
  const adapter = factory ? createValyuAdapter({ ...adapterOptions, provider }) : null;
  const admission = adapter?.handlers.admitValyuSearch ?? createValyuAdmission(provider);
  const handlers = adapter?.handlers ?? {
    admitValyuSearch: admission,
    valyuSearch: async () => ({ status: 503, headers: { 'content-type': 'application/json' },
      body: { error: 'NATIVE_FACILITATOR_REQUIRED' } }),
  };
  let session, operations;
  try {
    session = await startSellerService({ config, port, handlers, nativeFactory: factory,
      maxInFlight, drainGraceMs, availabilityDirectory });
    session.upstreamSnapshot = adapter ? adapter.snapshot : () => ({
      schema: 'stellar-forge.valyu-search-status.v1', capturedAt: new Date().toISOString(),
      endpoint: VALYU_SOURCE.endpoint, mode: 'CHALLENGE_ONLY', active: 0,
    });
    operations = await startSellerOperations(session, { port: operationsPort,
      historyDirectory, historyRetentionDays });
  } catch (error) {
    if (session) await session.close().catch(() => {});
    if (operations) await operations.close().catch(() => {});
    await adapter?.close();
    throw error;
  }
  let closing;
  const close = () => closing ??= (async () => {
    try { await session.close(); }
    finally { try { await operations.close(); } finally { await adapter?.close(); } }
  })();
  return { session, operations, adapter, provider, close };
}
function parseFlags(args, allowed, booleans = new Set()) {
  const options = new Map();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!allowed.has(flag) || options.has(flag)) throw new TypeError(USAGE);
    if (booleans.has(flag)) { options.set(flag, true); continue; }
    const value = args[++index];
    if (typeof value !== 'string' || !value.length || value.startsWith('--')) throw new TypeError(USAGE);
    options.set(flag, value);
  }
  return options;
}
function numberFlag(options, flag, fallback, min, max) {
  if (!options.has(flag)) return fallback;
  const value = options.get(flag);
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError(flag + ' must be a decimal integer');
  return integer(Number(value), min, max, flag);
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || args.length === 1 && args[0] === '--help') { console.log(USAGE); return null; }
  const [command, ...remaining] = args;
  if (command === 'compile') {
    const options = parseFlags(remaining, new Set(['--input', '--out']));
    if (!options.has('--input') || !options.has('--out')) throw new TypeError(USAGE);
    const input = await readInput(options.get('--input'));
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !['publicOrigin', 'payment', 'paymentOptions', 'path', 'serviceName', 'provider'].includes(key)))
      throw new TypeError('Merchant input must contain the documented origin, payment and provider fields');
    const config = createValyuServiceConfig(input);
    validateSellerServiceConfig(validateValyuServiceConfig(config));
    const output = await writeNewJson(options.get('--out'), config);
    console.log(JSON.stringify({ config: output, route: VALYU_ROUTE, provider: config.provider,
      paymentOptions: config.routes[0].offer.accepts }));
    return { config, output };
  }
  if (command === 'inspect') {
    const options = parseFlags(remaining, new Set(['--config']));
    if (!options.has('--config')) throw new TypeError(USAGE);
    const config = validateValyuServiceConfig(await readSellerConfig(options.get('--config')));
    const result = { schema: 'stellar-forge.valyu-merchant-inspection.v1',
      publicOrigin: config.publicOrigin, route: VALYU_ROUTE, provider: normalizeValyuProvider(config.provider),
      offer: config.routes[0].offer };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  if (command !== 'serve') throw new TypeError(USAGE);
  const options = parseFlags(remaining, new Set(['--config', '--port', '--operations-port', '--facilitator',
    '--allow-local-facilitator', '--history-dir', '--history-days', '--availability-dir', '--max-in-flight',
    '--drain-grace-ms']), new Set(['--allow-local-facilitator']));
  if (!options.has('--config')) throw new TypeError(USAGE);
  if (options.has('--allow-local-facilitator') && !options.has('--facilitator'))
    throw new TypeError('--allow-local-facilitator requires --facilitator');
  if (options.has('--history-days') && !options.has('--history-dir'))
    throw new TypeError('--history-days requires --history-dir');
  const config = validateValyuServiceConfig(await readSellerConfig(options.get('--config')));
  const running = await startValyuMerchant({ config,
    port: numberFlag(options, '--port', 8423, 0, 65535),
    operationsPort: numberFlag(options, '--operations-port', 8424, 0, 65535),
    facilitatorUrl: options.get('--facilitator'), allowLocalFacilitator: options.has('--allow-local-facilitator'),
    historyDirectory: options.get('--history-dir'),
    historyRetentionDays: numberFlag(options, '--history-days', 90, 1, 3650),
    availabilityDirectory: options.get('--availability-dir'),
    maxInFlight: numberFlag(options, '--max-in-flight', 64, 1, 4096),
    drainGraceMs: numberFlag(options, '--drain-grace-ms', 60000, 0, 300000) });
  console.log(JSON.stringify({ mode: running.session.mode, seller: running.session.url,
    operations: running.operations.url, provider: running.provider,
    health: running.session.url + '/_seller/health', ready: running.session.url + '/_seller/ready',
    developer: running.session.url + '/_seller/docs', openapi: running.session.url + '/_seller/openapi.json',
    customerClient: running.session.url + '/_seller/client/seller-client.mjs',
    upstreamStatus: running.operations.url + '/api/upstreams' }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    running.close().catch(() => { process.exitCode = 1; });
  });
  return running;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
