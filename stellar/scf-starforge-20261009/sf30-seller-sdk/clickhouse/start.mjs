#!/usr/bin/env node
// MIT. Original SF30 seller/operations lifecycle; no new payment implementation.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readSellerConfig } from '../serve.mjs';
import { validateAvailabilityDirectory } from '../availability/store.mjs';
import { startPostgresMerchant } from '../postgres/merchant.mjs';
import { openClickHouseSourceFile } from './source.mjs';
import { assertPrepared } from './prepare.mjs';

export const startClickHouseMerchant = options => startPostgresMerchant(options);
const HELP = `Usage: node clickhouse/start.mjs --directory PREPARED_DIRECTORY [--inspect]
       [--port 8423] [--operations-port 8424 | --no-operations]
       [--facilitator HTTPS_URL] [--allow-local-facilitator]
       [--max-in-flight 64] [--drain-grace-ms 60000]
       [--availability-dir PRIVATE_ABSOLUTE_DIRECTORY]
--inspect performs the actual source/schema preflight and closes without opening a seller.
Without --facilitator, the original seller returns HTTP 402 and performs no paid query.`;
export async function main(args = process.argv.slice(2), { env = process.env, stdout = process.stdout, navigationOrigin = null, expectedColumnTypes } = {}) {
  if (args.length === 1 && args[0] === '--help') { stdout.write(HELP + '\n'); return; }
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (options.has(name)) throw new TypeError('CLICKHOUSE_DUPLICATE_OPTION');
    if (['--inspect', '--no-operations', '--allow-local-facilitator'].includes(name)) { options.set(name, true); continue; }
    if (!['--directory', '--port', '--operations-port', '--facilitator', '--max-in-flight', '--drain-grace-ms', '--availability-dir'].includes(name) ||
        !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(HELP);
    options.set(name, args[++i]);
  }
  if (!options.has('--directory') || options.has('--allow-local-facilitator') && !options.has('--facilitator') ||
      options.has('--no-operations') && options.has('--operations-port')) throw new TypeError(HELP);
  const directory = resolve(options.get('--directory'));
  await assertPrepared(directory);
  const config = await readSellerConfig(resolve(directory, 'service.json'));
  let nativeFactory = null;
  if (options.has('--facilitator')) {
    let url;
    try { url = new URL(options.get('--facilitator')); } catch { throw new TypeError('CLICKHOUSE_FACILITATOR_URL_INVALID'); }
    const local = options.has('--allow-local-facilitator') && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
      throw new TypeError('CLICKHOUSE_FACILITATOR_URL_INVALID');
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
      import('@x402/core/server'), import('../native-factory.mjs'),
    ]);
    nativeFactory = compiled => createNativeSellerServer(compiled, {
      facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }),
    });
  }
  const { source, config: declaration } = await openClickHouseSourceFile(resolve(directory, 'source.json'), { env });
  if (expectedColumnTypes !== undefined && !isDeepStrictEqual(source.inspect().columnTypes, expectedColumnTypes)) {
    await source.close(); throw Object.assign(new Error('CLICKHOUSE_SCHEMA_CHANGED_REVIEW_AGAIN'), { code: 'CLICKHOUSE_SCHEMA_CHANGED_REVIEW_AGAIN' });
  }
  if (options.has('--inspect')) {
    try { const inspection = source.inspect(); stdout.write(JSON.stringify(inspection, null, 2) + '\n'); return inspection; }
    finally { await source.close(); }
  }
  let session;
  try {
    session = await startClickHouseMerchant({ source, config, bindings: declaration.bindings, nativeFactory,
      port: Number(options.get('--port') ?? 8423),
      operationsPort: options.has('--no-operations') ? null : Number(options.get('--operations-port') ?? 8424),
      maxInFlight: Number(options.get('--max-in-flight') ?? 64), drainGraceMs: Number(options.get('--drain-grace-ms') ?? 60000),
      availabilityDirectory: options.has('--availability-dir') ? validateAvailabilityDirectory(options.get('--availability-dir')) : undefined,
      navigationOrigin });
  } catch (issue) { await source.close(); throw issue; }
  stdout.write(JSON.stringify({ url: session.url, mode: session.mode, dataSource: 'ClickHouse named queries',
    docs: session.url + '/_seller/docs', openapi: session.url + '/_seller/openapi.json',
    health: session.url + '/_seller/health', ready: session.url + '/_seller/ready',
    ...(session.operations ? { operations: session.operations.url, availability: session.operations.availabilityUrl,
      availabilityControl: session.operations.availabilityControlUrl } : {}) }) + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    session.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  });
  return session;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(issue => {
  console.error(JSON.stringify({ error: issue.code ?? issue.message ?? 'CLICKHOUSE_START_FAILED',
    ...(issue.query ? { query: issue.query } : {}), ...(issue.upstreamStatus ? { upstreamStatus: issue.upstreamStatus } : {}) }));
  process.exitCode = 1;
});
