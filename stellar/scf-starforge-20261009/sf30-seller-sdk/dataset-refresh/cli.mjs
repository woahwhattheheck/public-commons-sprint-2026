// MIT. Init, configure, run, inspect and refresh the ORIGINAL SF30 dataset seller.
import { readFile, open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatasetVersions, DATASET_SNAPSHOT_PARAMETER } from './versions.mjs';
import { startVersionedDatasetSeller, datasetControl } from './service.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { readSellerConfig } from '../serve.mjs';

const HELP = `Versioned SF30 CSV seller (Node 22+)

  init --state DIR --dataset FILE [--retention-seconds 3600] [--max-versions 4]
       [--max-retained-bytes 268435456]
  configure --state DIR --payment FILE --origin https://api.example --out FILE [--path /data]
            [--snapshot-selection]
  serve --state DIR --seller FILE [--port 8423] [--handlers FILE]
        [--control-transport unix|loopback]
        [--max-in-flight 64] [--drain-grace-ms 60000]
        [--max-cached-versions 2] [--max-resident-rows 1000000]
        [--facilitator HTTPS_URL] [--allow-local-facilitator]
  status --state DIR
  refresh --state DIR --dataset FILE --expect CURRENT_SNAPSHOT [--expect-revision REVISION]
  activate --state DIR --snapshot RETAINED_SNAPSHOT --expect CURRENT_SNAPSHOT --expect-revision REVISION
  collect --state DIR

init and configure run while this store is offline. status, refresh, activate and collect
use the running seller's private control; the public API has no write route.
Use status's exact current and revision together to reject intervening changes.
--snapshot-selection advertises an optional first-page pin (one query-parameter slot).
Refresh and activation preserve original payment terms and exact dataset-page.v1 format.`;
const commandOptions = {
  init: ['--state', '--dataset', '--retention-seconds', '--max-versions', '--max-retained-bytes'],
  configure: ['--state', '--payment', '--origin', '--out', '--path', '--snapshot-selection'],
  serve: ['--state', '--seller', '--port', '--handlers', '--facilitator', '--allow-local-facilitator',
    '--control-transport', '--max-in-flight', '--drain-grace-ms', '--max-cached-versions', '--max-resident-rows'],
  status: ['--state'], refresh: ['--state', '--dataset', '--expect', '--expect-revision'],
  activate: ['--state', '--snapshot', '--expect', '--expect-revision'], collect: ['--state'],
};
function args(input) {
  const [command, ...tokens] = input;
  if (!commandOptions[command]) throw new TypeError(HELP);
  const options = Object.create(null);
  for (let i = 0; i < tokens.length; i++) {
    const key = tokens[i];
    if (!commandOptions[command].includes(key) || Object.hasOwn(options, key))
      throw new TypeError('Unknown or duplicate option: ' + key);
    if (['--allow-local-facilitator', '--snapshot-selection'].includes(key)) { options[key] = true; continue; }
    if (!tokens[i + 1] || tokens[i + 1].startsWith('--')) throw new TypeError('Missing value for ' + key);
    options[key] = tokens[++i];
  }
  if (!options['--state']) throw new TypeError('--state is required');
  return { command, options, directory: resolve(options['--state']) };
}
function required(options, name) {
  if (!options[name]) throw new TypeError(name + ' is required');
  return options[name];
}
function numeric(options, name, fallback) {
  if (options[name] === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(options[name])) throw new TypeError(name + ' must be an integer');
  const value = Number(options[name]);
  if (!Number.isSafeInteger(value)) throw new TypeError(name + ' exceeds integer range');
  return value;
}
async function json(path, limit) {
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new RangeError('Input file exceeds size limit');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

export async function main(input = process.argv.slice(2)) {
  if (input.length === 1 && input[0] === '--help') { process.stdout.write(HELP + '\n'); return; }
  const { command, options, directory } = args(input);
  if (['status', 'refresh', 'activate', 'collect'].includes(command)) {
    if (command === 'activate') required(options, '--expect-revision');
    const body = ['refresh', 'activate'].includes(command) ? {
      ...(command === 'refresh' ? { configPath: resolve(required(options, '--dataset')) } :
        { snapshot: required(options, '--snapshot') }),
      expectedSnapshot: required(options, '--expect'),
      ...(options['--expect-revision'] === undefined ? {} :
        { expectedRevision: numeric(options, '--expect-revision') }) } : undefined;
    const output = await datasetControl(directory, command, body); print(output); return output;
  }
  const versions = await openDatasetVersions({ directory,
    ...(command === 'serve' ? { maxCachedVersions: numeric(options, '--max-cached-versions', 2),
      maxResidentRows: numeric(options, '--max-resident-rows', 1000000) } : {}),
    ...(command === 'init' ? { initialConfig: resolve(required(options, '--dataset')),
      retentionMs: numeric(options, '--retention-seconds', 3600) * 1000,
      maxVersions: numeric(options, '--max-versions', 4),
      maxRetainedBytes: numeric(options, '--max-retained-bytes', 256 * 1024 * 1024) } : {}) });
  if (command === 'init') {
    try { const output = versions.status(); print(output); return output; } finally { await versions.close(); }
  }
  if (command === 'configure') {
    try {
      const config = await buildDatasetSellerConfig(versions, {
        payment: await json(required(options, '--payment'), 16384),
        origin: required(options, '--origin'), path: options['--path'] ?? '/data' });
      if (options['--snapshot-selection']) {
        const parameters = config.routes[0].definition.queryParameters;
        if (parameters.length >= 32)
          throw new TypeError('Snapshot selection needs one of the native 32 query-parameter slots; configure without --snapshot-selection to keep the full original query contract');
        parameters.push({ ...DATASET_SNAPSHOT_PARAMETER });
      }
      const output = resolve(required(options, '--out'));
      const handle = await open(output, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(config, null, 2) + '\n'); await handle.sync(); }
      finally { await handle.close(); }
      const result = { created: output, snapshot: versions.status().current, mode: 'CONFIG_GENERATED_NOT_RUNNING' };
      print(result); return result;
    } finally { await versions.close(); }
  }
  try {
    const sellerPath = resolve(required(options, '--seller'));
    const config = await readSellerConfig(sellerPath);
    const handlers = options['--handlers'] ?
      await import(pathToFileURL(resolve(dirname(sellerPath), options['--handlers'])).href) : {};
    let nativeFactory = null;
    if (options['--allow-local-facilitator'] && !options['--facilitator'])
      throw new TypeError('--allow-local-facilitator requires --facilitator');
    if (options['--facilitator']) {
      const url = new URL(options['--facilitator']);
      const local = options['--allow-local-facilitator'] && url.protocol === 'http:' && url.hostname === '127.0.0.1';
      if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
        throw new TypeError('Facilitator requires HTTPS or explicitly allowed local HTTP');
      const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
        import('@x402/core/server'), import('../native-factory.mjs'),
      ]);
      nativeFactory = compiled => createNativeSellerServer(compiled, {
        facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }) });
    }
    const service = await startVersionedDatasetSeller({ versions, config,
      port: numeric(options, '--port', 8423), nativeFactory, handlers,
      controlTransport: options['--control-transport'] ?? 'unix',
      maxInFlight: numeric(options, '--max-in-flight', 64), drainGraceMs: numeric(options, '--drain-grace-ms', 60000) });
    print({ url: service.url, mode: service.mode, control: service.controlPath,
      current: versions.status().current, health: service.url + '/_seller/health',
      offers: service.url + '/_seller/offers', docs: service.url + '/_seller/docs' });
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      if (stopping) return; stopping = true;
      service.close().then(() => { process.exitCode = 0; }, error => {
        process.stderr.write(String(error.message) + '\n'); process.exitCode = 1;
      });
    });
    return service;
  } catch (error) { await versions.close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(`${error.code ?? 'DATASET'}: ${error.message}\n`); process.exitCode = 1; });
