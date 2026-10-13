#!/usr/bin/env node
// MIT. Search and export original registrations, or open the same browser catalog.
import { mainOperatingReturn } from './operating-plan-return-cli.mjs';
import { mainOperatingPlan } from './operating-plan-cli.mjs';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportCommandCatalog, findCatalogItem, renderCatalogText, searchCommandCatalog } from './catalog.mjs';
import { loadCommandCatalog } from './load.mjs';
import { startDiscoveryServer } from './server.mjs';
import { mainRequirements, REQUIREMENT_ACTIONS } from './product-requirements-cli.mjs';
import { saveExport } from './write-json.mjs';

const HELP = [
  'Starforge command finder', '',
  '  starforge discover [search] [WORDS] [--kind KIND] [--source ID] [--feature GROUP]',
  '                     [--page NUMBER] [--page-size NUMBER] [--json]',
  '  starforge discover show KIND:NAME',
  '  starforge discover export [WORDS] [--kind KIND] [--source ID] [--feature GROUP]',
  '                     [--out NEW_FILE]',
  '  starforge discover serve [--port NUMBER] [--host 127.0.0.1|localhost|::1]', '',
  '  starforge discover plan --help',
  '  starforge discover plan-return --help',
  '  starforge discover requirements --repository /absolute/git-repository --help',
  '  starforge discover review-request PRODUCT_ID --repository /absolute/git-repository --help', '',
  'Kinds: command, source, feature, export, application, merchant; default all.',
  'Search terms are ANDed. Put exact phrases in double quotes inside your argument.',
  'Export includes every match. An output file is created exclusively.',
  'Runtime groups describe declarations owned by the selected source.',
  'Use starforge COMMAND --help to open a selected command’s native usage.', '',
].join('\n');

export function parseDiscoveryArguments(args) {
  const original = [...args];
  let action = 'search';
  if (['search', 'show', 'export', 'serve'].includes(args[0])) action = args.shift();
  if (args.some(value => ['--help', '-h'].includes(value))) return { action: 'help' };
  const options = {}, words = [], seen = new Set();
  const flags = action === 'serve' ? ['--port', '--host'] :
    action === 'show' ? [] :
    ['--kind', '--source', '--feature', ...(action === 'search' ? ['--page', '--page-size', '--json'] : ['--out'])];
  let literal = false;
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!literal && value === '--') { literal = true; continue; }
    if (!literal && value.startsWith('--')) {
      if (!flags.includes(value) || seen.has(value)) throw new TypeError('Unknown or repeated option: ' + value);
      seen.add(value);
      if (value === '--json') { options.json = true; continue; }
      if (args[index + 1] === undefined || args[index + 1].startsWith('--')) throw new TypeError('Missing value for ' + value);
      const raw = args[++index], key = { '--page-size': 'pageSize', '--out': 'out' }[value] ?? value.slice(2);
      options[key] = ['--page', '--page-size', '--port'].includes(value) ? Number(raw) : raw;
    } else words.push(value);
  }
  if (action === 'serve' && words.length) throw new TypeError('serve takes only --port and --host.');
  if (action === 'show' && words.length !== 1) throw new TypeError('show requires one KIND:NAME.');
  return { action, options, query: words.join(' '), original };
}

export async function main(args = process.argv.slice(2)) {
  if (args[0] === 'plan-return') return mainOperatingReturn(args.slice(1));
  if (args[0] === 'plan') return mainOperatingPlan(args.slice(1));
  if (REQUIREMENT_ACTIONS.includes(args[0])) return mainRequirements(args);
  const { action, options = {}, query = '' } = parseDiscoveryArguments([...args]);
  if (action === 'help') { console.log(HELP); return; }
  if (action === 'serve') {
    const application = await startDiscoveryServer(options);
    console.log(JSON.stringify({ ...application.health(),
      schema: 'stellar-forge.operator-discovery-startup.v1', url: application.url }));
    const stop = () => { application.close().catch(error => {
      console.error(error.message); process.exitCode = 1;
    }).finally(() => { process.off('SIGINT', stop); process.off('SIGTERM', stop); }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return application;
  }
  const catalog = await loadCommandCatalog();
  if (action === 'show') {
    const item = findCatalogItem(catalog, query);
    console.log(JSON.stringify({ package: catalog.package, ...item,
      registrationSources: catalog.sources.filter(source => item.sourceIds.includes(source.id)) }, null, 2));
    return item;
  }
  const result = action === 'export'
    ? exportCommandCatalog(catalog, { ...options, query })
    : searchCommandCatalog(catalog, { ...options, query });
  if (action === 'export' && options.out) {
    await saveExport(options.out, result);
    console.log(JSON.stringify({ file: resolve(options.out), entries: result.total, package: catalog.package }));
  } else console.log(action === 'export' || options.json ? JSON.stringify(result, null, 2) : renderCatalogText(result));
  return result;
}

if (process.argv[1] && await realpath(resolve(process.argv[1])).then(
  entry => pathToFileURL(entry).href === import.meta.url, () => false))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
