#!/usr/bin/env node
// MIT. Compose the maintained seller and operations UI with a PostgreSQL source.
import { pathToFileURL } from 'node:url';
import { readSellerConfig, startSellerService } from '../serve.mjs';
import { openPostgresQueryFile, bindPostgresSeller } from './config.mjs';

export async function startPostgresSeller({ sourceFile, configFile, port = 8423,
  operationsPort = null, nativeFactory = null, maxInFlight = 64, drainGraceMs = 60000 } = {}) {
  const config = await readSellerConfig(configFile), opened = await openPostgresQueryFile(sourceFile);
  let seller = null, operations = null, closing = null;
  const close = () => closing ??= (async () => {
    try { if (seller) await seller.close(); }
    finally { try { if (operations) await operations.close(); } finally { await opened.source.close(); } }
  })();
  try {
    const handlers = bindPostgresSeller(config, opened.source, opened.bindings);
    seller = await startSellerService({ config, handlers, port, nativeFactory, maxInFlight, drainGraceMs });
    if (operationsPort !== null) {
      const { startSellerOperations } = await import('../operations/server.mjs');
      operations = await startSellerOperations(seller, { port: operationsPort });
    }
    return { seller, source: opened.source, operations, close };
  } catch (error) { await close(); throw error; }
}

const USAGE = `Usage: node postgres/launch.mjs --source PRIVATE_SOURCE.json --config SELLER.json
  [--port 8423] [--operations-port 8424] [--max-in-flight 64] [--drain-grace-ms 60000]
  [--facilitator HTTPS_URL] [--allow-local-facilitator]
The original SF30 server owns HTTP/payment behavior. Without a facilitator this
starts its challenge-only mode. No data query runs during challenge-only requests.`;

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); return; }
  const options = new Map();
  const keys = new Set(['--source', '--config', '--port', '--operations-port', '--max-in-flight', '--drain-grace-ms', '--facilitator', '--allow-local-facilitator']);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!keys.has(key) || options.has(key)) throw new TypeError('Unknown or repeated PostgreSQL launcher option');
    if (key === '--allow-local-facilitator') options.set(key, true);
    else { const value = args[++i]; if (!value || value.startsWith('--')) throw new TypeError('Missing launcher option value'); options.set(key, value); }
  }
  if (!options.has('--source') || !options.has('--config')) throw new TypeError(USAGE);
  const integer = (key, fallback) => {
    if (!options.has(key)) return fallback;
    if (!/^(?:0|[1-9]\d*)$/.test(options.get(key))) throw new TypeError('Integer launcher option required');
    return Number(options.get(key));
  };
  let nativeFactory = null;
  if (options.has('--facilitator')) {
    const url = new URL(options.get('--facilitator'));
    const local = options.get('--allow-local-facilitator') === true && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
      throw new TypeError('Facilitator needs HTTPS or explicit loopback permission');
    const { createNativeSellerServer } = await import('../native-factory.mjs');
    const { HTTPFacilitatorClient } = await import('@x402/core/server');
    nativeFactory = compiled => createNativeSellerServer(compiled, { facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }) });
  }
  const session = await startPostgresSeller({ sourceFile: options.get('--source'), configFile: options.get('--config'),
    port: integer('--port', 8423), operationsPort: integer('--operations-port', null),
    maxInFlight: integer('--max-in-flight', 64), drainGraceMs: integer('--drain-grace-ms', 60000), nativeFactory });
  console.log(JSON.stringify({ url: session.seller.url, mode: session.seller.mode,
    ...(session.operations ? { operations: session.operations.url } : {}),
    routeIds: session.seller.compiled.routes.map(route => route.id), source: 'POSTGRESQL' }));
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    if (stopping) return; stopping = true;
    try { await session.close(); } catch { process.exitCode = 1; }
  });
  return session;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => { console.error('POSTGRES_SELLER_START_FAILED: check private source, driver packages and original seller configuration'); process.exitCode = 1; });
