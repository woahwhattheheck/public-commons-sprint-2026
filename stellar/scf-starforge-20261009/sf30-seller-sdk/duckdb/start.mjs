#!/usr/bin/env node
// MIT. Private data-source launch over ORIGINAL SF30 and its native facilitator.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDuckdbSeller } from './merchant.mjs';

const HELP = `Usage: node duckdb/start.mjs --source SOURCE.json --config SERVICE.json
  [--python /private/venv/bin/python] [--port 8423]
  [--operations-port 8424 | --no-operations]
  [--facilitator HTTPS_URL] [--allow-local-facilitator]
  [--max-in-flight 64] [--drain-grace-ms 60000]
  [--availability-dir PRIVATE_ABSOLUTE_DIRECTORY]
Without a facilitator, original SF30 serves HTTP 402 challenges without paid query execution.`;
export function safeCode(issue) {
  const value = issue?.code ?? issue?.message;
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,100}$/.test(value) ? value : 'DUCKDB_OPERATION_FAILED';
}
export async function main(args = process.argv.slice(2), constraints = {}) {
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return; }
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (flags.has(key)) throw new TypeError('DUCKDB_DUPLICATE_OPTION');
    if (['--no-operations', '--allow-local-facilitator'].includes(key)) { flags.set(key, true); continue; }
    if (!['--source', '--config', '--python', '--port', '--operations-port', '--facilitator', '--max-in-flight', '--drain-grace-ms', '--availability-dir'].includes(key) ||
        !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(HELP);
    flags.set(key, args[++i]);
  }
  if (!flags.has('--source') || !flags.has('--config') || flags.has('--no-operations') && flags.has('--operations-port') ||
      flags.has('--allow-local-facilitator') && !flags.has('--facilitator')) throw new TypeError(HELP);
  let nativeFactory = null;
  if (flags.has('--facilitator')) {
    const url = new URL(flags.get('--facilitator'));
    const local = flags.has('--allow-local-facilitator') && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
      throw new TypeError('DUCKDB_FACILITATOR_URL_INVALID');
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
      import('@x402/core/server'), import('../native-factory.mjs'),
    ]);
    nativeFactory = compiled => createNativeSellerServer(compiled,
      { facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }) });
  }
  const session = await startDuckdbSeller({ sourceFile: resolve(flags.get('--source')), configFile: resolve(flags.get('--config')),
    expectedSourceSha256: constraints.expectedSourceSha256, expectedSourceConfig: constraints.expectedSourceConfig,
    expectedServiceConfig: constraints.expectedServiceConfig,
    availabilityDirectory: flags.get('--availability-dir'),
    python: flags.get('--python') ?? 'python3', nativeFactory,
    port: Number(flags.get('--port') ?? 8423), operationsPort: flags.has('--no-operations') ? null : Number(flags.get('--operations-port') ?? 8424),
    maxInFlight: Number(flags.get('--max-in-flight') ?? 64), drainGraceMs: Number(flags.get('--drain-grace-ms') ?? 60000) });
  process.stdout.write(JSON.stringify({ url: session.seller.url, mode: session.seller.mode,
    docs: session.seller.url + '/_seller/docs', ready: session.seller.url + '/_seller/ready',
    ...(session.operations ? { operations: session.operations.url, availability: session.operations.availabilityUrl,
      availabilityControl: session.operations.availabilityControlUrl } : {}),
    sourceSha256: session.source.describe().sourceSha256, engineVersion: session.source.inspect().engineVersion }) + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    session.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  });
  return session;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(issue => { process.stderr.write(JSON.stringify({ error: safeCode(issue) }) + '\n'); process.exitCode = 1; });
