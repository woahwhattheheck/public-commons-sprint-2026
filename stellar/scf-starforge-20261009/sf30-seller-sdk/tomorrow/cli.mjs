#!/usr/bin/env node
// MIT. Weather operations, original merchant assets and original SF88 customer commands.
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WeatherWorkspace } from './workspace.mjs';
import { startWeatherServer } from './server.mjs';
import { packageWeatherEdition, serveWeatherPackage, purgeExpiredWeatherPackage } from './merchant.mjs';
import { WeatherPurchase } from './customer.mjs';
import { exportAustinForecast } from './austin-intake.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/index.mjs';
import { readJson, readBytes, writeJson } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { need } from './config.mjs';

const flags = {
  init: ['workspace', 'plan', 'title'],
  serve: ['workspace', 'port'],
  view: ['workspace', 'edition'],
  work: ['workspace', 'input'],
  prepare: ['workspace', 'work', 'label'],
  review: ['workspace', 'edition', 'out'],
  acquire: ['workspace', 'edition', 'review'],
  recover: ['workspace', 'edition'],
  decision: ['workspace', 'input'],
  compare: ['workspace', 'before', 'after', 'out'],
  handover: ['workspace', 'editions', 'include-raw', 'out'],
  import: ['workspace', 'input'],
  package: ['workspace', 'edition', 'seller', 'out'],
  'serve-seller': ['package', 'port', 'factory-module'],
  'purge-package': ['package'],
  'prepare-buy': ['workspace', 'buyer-config', 'purchase', 'product', 'catalog', 'selection'],
  'review-buy': ['workspace', 'buyer-config', 'purchase', 'out'],
  buy: ['workspace', 'buyer-config', 'purchase', 'review'],
  'recover-buy': ['workspace', 'buyer-config', 'purchase'],
  'continue-buy-preparation': ['workspace', 'buyer-config', 'purchase'],
  'export-buy': ['workspace', 'buyer-config', 'purchase', 'include-raw', 'out'],
  'austin-forecast': ['workspace', 'editions', 'station-id', 'timestep', 'out', 'provider-issue-pointers'],
};
export const USAGE = 'Tomorrow.io operations\n' +
  '  node cli.mjs init --workspace DIR --plan JSON [--title TEXT]\n' +
  '  node cli.mjs serve --workspace DIR [--port 0]\n' +
  '  node cli.mjs work --workspace DIR --input WORK_JSON\n' +
  '  node cli.mjs prepare --workspace DIR --work WORK_ID [--label TEXT]\n' +
  '  node cli.mjs review --workspace DIR --edition ID --out NEW_JSON\n' +
  '  node cli.mjs acquire --workspace DIR --edition ID --review JSON\n' +
  '  node cli.mjs decision --workspace DIR --input JSON\n' +
  '  node cli.mjs compare --workspace DIR --before ID --after ID [--out NEW_JSON]\n' +
  '  node cli.mjs handover --workspace DIR --out NEW_JSON [--include-raw true]\n' +
  '  node cli.mjs import --workspace DIR --input HANDOVER_JSON\n' +
  '  node cli.mjs package --workspace DIR --edition ID --seller TERMS_JSON --out NEW_DIR\n' +
  '  node cli.mjs serve-seller --package DIR [--port 0] [--factory-module TRUSTED_LOCAL_MODULE]\n' +
  '  node cli.mjs prepare-buy --workspace DIR --buyer-config JSON --purchase DIR --product JSON --catalog JSON --selection JSON\n' +
  '  node cli.mjs review-buy --workspace DIR --buyer-config JSON --purchase DIR --out NEW_JSON\n' +
  '  node cli.mjs buy --workspace DIR --buyer-config JSON --purchase DIR --review JSON\n' +
  '  node cli.mjs recover-buy --workspace DIR --buyer-config JSON --purchase DIR\n' +
  '  node cli.mjs export-buy --workspace DIR --buyer-config JSON --purchase DIR --out NEW_JSON\n' +
  '  node cli.mjs austin-forecast --workspace DIR --editions ID,ID --station-id EXISTING_ID --out NEW_DIR\n' +
  'Use the browser for a continuous keyless evaluation session; licensed files reopen across processes.';

function optionsFor(args) {
  const [command, ...rest] = args;
  need(flags[command] && rest.length % 2 === 0, 'WEATHER_COMMAND_OR_FLAGS_INVALID');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i].startsWith('--') ? rest[i].slice(2) : '';
    need(flags[command].includes(name) && !Object.hasOwn(options, name) && typeof rest[i + 1] === 'string' &&
      rest[i + 1].length && !rest[i + 1].startsWith('--'), 'WEATHER_COMMAND_OR_FLAGS_INVALID');
    options[name] = rest[i + 1];
  }
  const required = name => { need(options[name], 'WEATHER_OPTION_REQUIRED_' + name.toUpperCase().replaceAll('-', '_')); return options[name]; };
  const boolean = (name, fallback = false) => {
    if (options[name] === undefined) return fallback;
    need(['true', 'false'].includes(options[name]), 'WEATHER_BOOLEAN_OPTION_INVALID');
    return options[name] === 'true';
  };
  return { command, options, required, boolean };
}
function editionSummary(view) {
  return { editionId: view.edition.id, state: view.edition.state, rawAvailability: view.edition.rawAvailability,
    rows: view.rows.length, decisions: view.decisions.length, resources: view.edition.resources, sourceError: view.sourceError };
}
async function originalBuyer(path) {
  const config = await readJson(resolve(path), 65536);
  return new Buyer({ runtimeDirectory: resolve(fileURLToPath(new URL('../../sf88-operator-buyer-cli/', import.meta.url))), ...config });
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || args.length === 1 && args[0] === '--help') return { usage: USAGE };
  const { command, options, required, boolean } = optionsFor(args);
  const json = name => readJson(resolve(required(name)), 16777216);
  const publish = async value => {
    if (options.out) { await writeJson(resolve(options.out), value, { exclusive: true }); return { path: resolve(options.out) }; }
    return value;
  };
  if (command === 'serve-seller') {
    let nativeFactory = null;
    if (options['factory-module']) {
      const module = await import(pathToFileURL(resolve(options['factory-module'])).href);
      nativeFactory = module.default; need(typeof nativeFactory === 'function', 'WEATHER_NATIVE_FACTORY_REQUIRED');
    }
    const service = await serveWeatherPackage({ directory: required('package'), port: Number(options.port ?? 0), nativeFactory });
    const stop = () => service.close().catch(() => {}); process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return { url: service.url, mode: service.info?.mode ?? (nativeFactory ? 'NATIVE_X402' : 'CHALLENGE_ONLY'),
      expiresAt: service.expiresAt, productSha256: service.productSha256 };
  }
  if (command === 'purge-package') return purgeExpiredWeatherPackage(required('package'));
  let workspace;
  if (command === 'init') {
    workspace = await WeatherWorkspace.create(required('workspace'), { plan: await json('plan'), title: options.title });
    const state = await workspace.view(); await workspace.close();
    return { directory: workspace.directory, workspaceId: state.workspaceId, title: state.title };
  }
  workspace = await WeatherWorkspace.open(required('workspace'));
  if (command === 'serve') {
    const service = await startWeatherServer({ workspace, port: Number(options.port ?? 0) });
    const stop = () => service.close().catch(() => {}); process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return { url: service.url, workspaceId: (await workspace.view()).workspaceId };
  }
  try {
    switch (command) {
      case 'view': return options.edition ? workspace.editionView(options.edition) : workspace.view();
      case 'work': return workspace.saveWork(await json('input'));
      case 'prepare': return workspace.prepareEdition(required('work'), { label: options.label });
      case 'review': return publish(await workspace.reviewEdition(required('edition')));
      case 'acquire': return editionSummary(await workspace.acquireEdition(required('edition'), await json('review')));
      case 'recover': return editionSummary(await workspace.recoverEdition(required('edition')));
      case 'decision': return workspace.decide(await json('input'));
      case 'compare': return publish(await workspace.compare(required('before'), required('after')));
      case 'handover': return publish(await workspace.handover({ editionIds: options.editions?.split(','), includeRaw: boolean('include-raw') }));
      case 'import': return workspace.importHandover(await json('input'));
      case 'package': return packageWeatherEdition({ workspace, editionId: required('edition'), directory: required('out'), ...await json('seller') });
      case 'austin-forecast': return exportAustinForecast({ workspace, editionIds: required('editions').split(','),
        stationId: required('station-id'), timestep: options.timestep ?? '1h', directory: required('out'),
        providerIssuedByEdition: options['provider-issue-pointers'] ? await json('provider-issue-pointers') : {} });
      default: {
        const buyer = await originalBuyer(required('buyer-config')), directory = required('purchase');
        if (command === 'prepare-buy') {
          const purchase = await WeatherPurchase.prepare({ buyer, workspace, directory, product: await json('product'),
            catalogBytes: await readBytes(resolve(required('catalog')), 1048576), ...await json('selection') });
          return { purchase: purchase.directory, operations: Object.keys(await purchase.original()) };
        }
        const purchase = await WeatherPurchase.open({ buyer, workspace, directory });
        if (command === 'review-buy') return publish(await purchase.review());
        if (command === 'buy') { const result = await purchase.execute({ review: await json('review') });
          return { purchaseId: result.purchaseId, deliveries: result.deliveries, edition: editionSummary(result.edition) }; }
        if (command === 'recover-buy') { const result = await purchase.recover();
          return { purchaseId: result.purchaseId, deliveries: result.deliveries, pending: result.pending, edition: editionSummary(result.edition) }; }
        if (command === 'continue-buy-preparation') return purchase.continuePreparation();
        if (command === 'export-buy') return publish(await purchase.export({ includeRaw: boolean('include-raw', true) }));
        throw new Error('WEATHER_COMMAND_INVALID');
      }
    }
  } finally { await workspace.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(result => { if (result !== undefined) console.log(JSON.stringify(result, null, 2)); })
    .catch(error => { console.error(JSON.stringify({ error: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'WEATHER_COMMAND_FAILED' })); process.exitCode = 1; });
