#!/usr/bin/env node
// MIT. Native gRPC transport into the original SF30 seller lifecycle.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAvailabilityDirectory } from '../availability/store.mjs';
import { readGrpcPrepared } from './prepare.mjs';
import { createGrpcSource } from './source.mjs';
import { startGrpcMerchant } from './merchant.mjs';

export async function nativeFactoryFor(facilitator, allowLocal = false) {
  if (!facilitator) {
    if (allowLocal) throw new TypeError('GRPC_FACILITATOR_REQUIRED');
    return null;
  }
  const endpoint = new URL(facilitator);
  const local = allowLocal && endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1';
  if ((!local && endpoint.protocol !== 'https:') || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new TypeError('GRPC_FACILITATOR_URL_INVALID');
  const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
    import('@x402/core/server'), import('../native-factory.mjs'),
  ]);
  return compiled => createNativeSellerServer(compiled, {
    facilitatorClient: new HTTPFacilitatorClient({ url: endpoint.href.replace(/\/$/, '') }),
  });
}
export async function main(args = process.argv.slice(2), { env = process.env, stdout = process.stdout,
  navigationOrigin = null } = {}) {
  const help = 'node grpc/start.mjs --directory PREPARED_DIRECTORY [--inspect] [--port 8423]\n' +
    '  [--operations-port 8424 | --no-operations] [--facilitator HTTPS_URL] [--allow-local-facilitator]\n' +
    '  [--max-in-flight 64] [--drain-grace-ms 60000] [--availability-dir PRIVATE_DIRECTORY]';
  if (args.length === 1 && args[0] === '--help') { stdout.write(help + '\n'); return; }
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (flags.has(key)) throw new TypeError('GRPC_DUPLICATE_OPTION');
    if (['--inspect', '--no-operations', '--allow-local-facilitator'].includes(key)) { flags.set(key, true); continue; }
    if (!['--directory', '--port', '--operations-port', '--facilitator', '--max-in-flight', '--drain-grace-ms',
      '--availability-dir'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(help);
    flags.set(key, args[++i]);
  }
  if (!flags.has('--directory') || flags.has('--no-operations') && flags.has('--operations-port')) throw new TypeError(help);
  const number = (key, fallback, min, max) => {
    const value = flags.get(key) ?? String(fallback);
    if (!/^(0|[1-9][0-9]*)$/.test(value) || Number(value) < min || Number(value) > max) throw new TypeError('GRPC_OPTION_INVALID');
    return Number(value);
  };
  const prepared = await readGrpcPrepared(resolve(flags.get('--directory')));
  if (flags.has('--inspect')) {
    const source = await createGrpcSource(prepared.source, prepared.protoSource, { env, contract: prepared.contract });
    try { const inspection = await source.ready(); stdout.write(JSON.stringify(inspection, null, 2) + '\n'); return inspection; }
    finally { await source.close(); }
  }
  const nativeFactory = await nativeFactoryFor(flags.get('--facilitator'), flags.has('--allow-local-facilitator'));
  const session = await startGrpcMerchant({ prepared, env, nativeFactory,
    port: number('--port', 8423, 0, 65535),
    operationsPort: flags.has('--no-operations') ? null : number('--operations-port', 8424, 0, 65535),
    maxInFlight: number('--max-in-flight', 64, 1, 1024), drainGraceMs: number('--drain-grace-ms', 60000, 1000, 300000),
    availabilityDirectory: flags.has('--availability-dir') ? validateAvailabilityDirectory(flags.get('--availability-dir')) : undefined,
    navigationOrigin });
  stdout.write(JSON.stringify({ url: session.url, mode: session.mode, dataSource: 'gRPC unary methods',
    protoSha256: prepared.protoSource.sha256, docs: session.url + '/_seller/docs',
    openapi: session.url + '/_seller/openapi.json', health: session.url + '/_seller/health',
    ready: session.url + '/_seller/ready',
    ...(session.operations ? { operations: session.operations.url, availability: session.operations.availabilityUrl,
      availabilityControl: session.operations.availabilityControlUrl } : {}) }) + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () =>
    session.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; }));
  return session;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(issue => { console.error(JSON.stringify({ error: issue.code ?? 'GRPC_START_FAILED' })); process.exitCode = 1; });
