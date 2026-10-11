#!/usr/bin/env node
// MIT. The maintained seller, native x402 payment and operations lifecycle.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSellerConfig } from '../serve.mjs';
import { validateAvailabilityDirectory } from '../availability/store.mjs';
import { startPostgresMerchant } from '../postgres/merchant.mjs';
import { createMysqlNativeFactory } from '../mysql/merchant.mjs';
import { openOpenSearchSourceFile } from './source.mjs';
import { assertPrepared } from './prepare.mjs';

export const startOpenSearchMerchant = options => startPostgresMerchant(options);
export const createOpenSearchNativeFactory = createMysqlNativeFactory;
export async function startOpenSearchSeller({
  directory, env = process.env, port = 8423, operationsPort = 8424,
  nativeFactory = null, maxInFlight = 64, drainGraceMs = 60000, availabilityDirectory,
} = {}) {
  const target = resolve(directory);
  await assertPrepared(target);
  if (availabilityDirectory !== undefined) validateAvailabilityDirectory(availabilityDirectory);
  const config = await readSellerConfig(resolve(target, 'service.json'));
  const { source, config: declaration } = await openOpenSearchSourceFile(resolve(target, 'source.json'), { env });
  try {
    const session = await startOpenSearchMerchant({
      source, config, bindings: declaration.bindings, port, operationsPort, nativeFactory,
      maxInFlight, drainGraceMs, availabilityDirectory,
    });
    return { ...session, source };
  } catch (issue) { await source.close(); throw issue; }
}
const HELP = `Usage: node opensearch/start.mjs --directory PREPARED_DIRECTORY [--inspect]
       [--port 8423] [--operations-port 8424 | --no-operations]
       [--facilitator HTTPS_URL] [--allow-local-facilitator]
       [--max-in-flight 64] [--drain-grace-ms 60000]
       [--availability-dir PRIVATE_ABSOLUTE_DIRECTORY]
--inspect reads the original source version, mappings and native query probes.
The default seller advertises HTTP 402; configure the existing facilitator for paid delivery.`;
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return; }
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (options.has(name)) throw new TypeError('OPENSEARCH_DUPLICATE_OPTION');
    if (['--inspect', '--no-operations', '--allow-local-facilitator'].includes(name)) { options.set(name, true); continue; }
    if (!['--directory', '--port', '--operations-port', '--facilitator', '--max-in-flight', '--drain-grace-ms', '--availability-dir'].includes(name) ||
        !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(HELP);
    options.set(name, args[++i]);
  }
  if (!options.has('--directory') || options.has('--no-operations') && options.has('--operations-port'))
    throw new TypeError(HELP);
  const directory = resolve(options.get('--directory'));
  await assertPrepared(directory);
  if (options.has('--inspect')) {
    const { source } = await openOpenSearchSourceFile(resolve(directory, 'source.json'));
    try { const inspection = source.inspect(); console.log(JSON.stringify(inspection, null, 2)); return inspection; }
    finally { await source.close(); }
  }
  const nativeFactory = await createOpenSearchNativeFactory({
    facilitator: options.get('--facilitator'), allowLocalFacilitator: options.has('--allow-local-facilitator'),
  });
  const session = await startOpenSearchSeller({
    directory, nativeFactory,
    port: Number(options.get('--port') ?? 8423),
    operationsPort: options.has('--no-operations') ? null : Number(options.get('--operations-port') ?? 8424),
    maxInFlight: Number(options.get('--max-in-flight') ?? 64),
    drainGraceMs: Number(options.get('--drain-grace-ms') ?? 60000),
    availabilityDirectory: options.has('--availability-dir') ? options.get('--availability-dir') : undefined,
  });
  console.log(JSON.stringify({
    url: session.url, mode: session.mode, dataSource: 'OpenSearch named PIT searches',
    docs: session.url + '/_seller/docs', openapi: session.url + '/_seller/openapi.json',
    health: session.url + '/_seller/health',
    ...(session.operations ? { operations: session.operations.url } : {}),
  }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    session.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  });
  return session;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(issue => {
  console.error(JSON.stringify({ error: issue.code ?? 'OPENSEARCH_START_FAILED',
    ...(issue.query ? { query: issue.query } : {}), ...(issue.upstreamStatus ? { upstreamStatus: issue.upstreamStatus } : {}) }));
  process.exitCode = 1;
});
