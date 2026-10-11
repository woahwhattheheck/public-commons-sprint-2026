#!/usr/bin/env node
// MIT. An operator launcher composing ORIGINAL SF30 source, server and native SDK.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSellerConfig } from '../serve.mjs';
import { openPostgresSourceFile } from './config.mjs';
import { startPostgresMerchant } from './merchant.mjs';
const HELP = `Usage: node postgres/start.mjs --source FILE --config SELLER_FILE [--port 8423]
       [--facilitator HTTPS_URL] [--allow-local-facilitator]
       [--operations-port 8424 | --no-operations]
       [--max-in-flight 64] [--drain-grace-ms 60000]
Uses the existing SF30 seller. Without --facilitator, only original HTTP 402 challenges are served.`;
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return; }
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (options.has(key)) throw new TypeError('POSTGRES_DUPLICATE_OPTION');
    if (['--allow-local-facilitator', '--no-operations'].includes(key)) { options.set(key, true); continue; }
    if (!['--source', '--config', '--port', '--facilitator', '--operations-port', '--max-in-flight', '--drain-grace-ms'].includes(key) ||
        !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(HELP);
    options.set(key, args[++i]);
  }
  if (!options.has('--source') || !options.has('--config') ||
      options.has('--allow-local-facilitator') && !options.has('--facilitator') ||
      options.has('--no-operations') && options.has('--operations-port')) throw new TypeError(HELP);
  const config = await readSellerConfig(resolve(options.get('--config')));
  let nativeFactory = null;
  if (options.has('--facilitator')) {
    let url;
    try { url = new URL(options.get('--facilitator')); } catch { throw new TypeError('POSTGRES_FACILITATOR_URL_INVALID'); }
    const local = options.has('--allow-local-facilitator') && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
      throw new TypeError('POSTGRES_FACILITATOR_URL_INVALID');
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
      import('@x402/core/server'), import('../native-factory.mjs'),
    ]);
    nativeFactory = compiled => createNativeSellerServer(compiled,
      { facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }) });
  }
  const { source, config: declaration } = await openPostgresSourceFile(resolve(options.get('--source')));
  let session;
  try {
    session = await startPostgresMerchant({ source, config, bindings: declaration.bindings,
      port: Number(options.get('--port') ?? 8423), nativeFactory,
      operationsPort: options.has('--no-operations') ? null : Number(options.get('--operations-port') ?? 8424),
      maxInFlight: Number(options.get('--max-in-flight') ?? 64),
      drainGraceMs: Number(options.get('--drain-grace-ms') ?? 60000) });
  } catch (issue) { await source.close(); throw issue; }
  process.stdout.write(JSON.stringify({ url: session.url, mode: session.mode,
    docs: session.url + '/_seller/docs', openapi: session.url + '/_seller/openapi.json',
    health: session.url + '/_seller/health', ready: session.url + '/_seller/ready',
    ...(session.operations ? { operations: session.operations.url } : {}),
    dataSource: 'PostgreSQL named queries' }) + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    session.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  });
  return session;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(issue => { process.stderr.write(JSON.stringify({ error: issue.code ?? issue.message ?? 'POSTGRES_START_FAILED',
    ...(issue.query ? { query: issue.query } : {}), ...(issue.sqlState ? { sqlState: issue.sqlState } : {}) }) + '\n'); process.exitCode = 1; });
}
