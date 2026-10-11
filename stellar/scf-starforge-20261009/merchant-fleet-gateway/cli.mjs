// MIT. Operator entrypoint; source uses existing original SF30 seller processes.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMerchantFleet, startMerchantFleet } from './gateway.mjs';

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node cli.mjs [--manifest FILE] [--state PRIVATE_DIRECTORY] [--port 8400] [--admin-port 8401]\n' +
      '--state enables durable live rollout on Linux; an empty state requires --manifest.\n');
    return null;
  }
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--manifest', '--state', '--port', '--admin-port'].includes(flag) ||
        options.has(flag) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new TypeError('Use [--manifest FILE] [--state PRIVATE_DIRECTORY] [--port N] [--admin-port N]');
    }
    options.set(flag, args[++i]);
  }
  if (!options.has('--manifest') && !options.has('--state'))
    throw new TypeError('--manifest FILE or a retained --state PRIVATE_DIRECTORY is required');
  const parsePort = (flag, fallback) => {
    const raw = options.get(flag) ?? String(fallback);
    if (!/^\d{1,5}$/.test(raw) || Number(raw) > 65535) throw new TypeError('Invalid ' + flag);
    return Number(raw);
  };
  // With retained state the original input may no longer exist. Let startup
  // choose its retained snapshot before attempting to read an optional input.
  let fleet = null;
  if (options.has('--manifest') && !options.has('--state'))
    fleet = await loadMerchantFleet(resolve(options.get('--manifest')));
  const service = await startMerchantFleet(fleet, {
    port: parsePort('--port', 8400), adminPort: parsePort('--admin-port', 8401),
    stateDirectory: options.has('--state') ? resolve(options.get('--state')) : null,
    initialManifest: options.has('--manifest') ? resolve(options.get('--manifest')) : null,
  });
  process.stdout.write(JSON.stringify({ publicURL: service.publicURL,
    privateHealthURL: service.adminURL + '/_fleet/health',
    privateControlFile: service.controlPath,
    revision: service.status().revision,
    merchants: service.status().merchants.map(t => ({ id: t.id, host: t.host, mode: t.mode })) }) + '\n');
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    if (closing) return;
    closing = true;
    service.close().then(() => { process.exitCode = 0; },
      error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
  });
  return service;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(String(error?.message ?? error) + '\n'); process.exitCode = 1; });
}
