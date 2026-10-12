#!/usr/bin/env node
// MIT. Inspect and initialize declared merchant providers through their original hooks.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileBytes, failure } from './host-files.mjs';
import { MERCHANT_PROVIDER_REGISTRY, initializeMerchantProvider } from './providers.mjs';
import { MERCHANT_TOOLS, merchantToolFamily } from './catalog.mjs';

const HELP = 'Merchant providers\n\n' +
  '  merchant-providers list\n' +
  '  merchant-providers inspect PROVIDER_ID\n' +
  '  merchant-providers init PROVIDER_ID --options HOST_SETUP_JSON\n\n' +
  'list and inspect read source metadata without constructing provider runtimes.\n' +
  'The setup file contains the selected provider’s original initializer options,\n' +
  'including directory and its original connection or workspace references.\n' +
  'Existing init-* commands and initializer exports remain available.\n';

export function inspectMerchantProvider(id) {
  const registry = MERCHANT_PROVIDER_REGISTRY;
  const selected = id === undefined ? registry.sources : registry.sources.filter(source => source.id === registry.forId(id).id);
  return { schema: 'stellar-forge.merchant-provider-inspection.v1', sourceCommit: registry.sourceCommit,
    providers: selected.map(source => {
      const tools = MERCHANT_TOOLS.filter(tool => merchantToolFamily(tool.name) === source.family);
      return { ...source, toolCount: tools.length, ...(id === undefined ? {} : { tools,
        instructions: registry.forId(source.id).instructions }) };
    }) };
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['--help', 'help'].includes(args[0])) {
    process.stdout.write(HELP); return;
  }
  const [command, id, option, filename, ...extra] = args;
  let result;
  if (command === 'list' && args.length === 1) result = inspectMerchantProvider();
  else if (command === 'inspect' && args.length === 2) result = inspectMerchantProvider(id);
  else if (command === 'init' && args.length === 4 && option === '--options' && !extra.length) {
    const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fileBytes(resolve(filename), 1024 * 1024)));
    result = await initializeMerchantProvider(id, raw);
  } else throw failure('CONFIGURATION_ERROR', 'Use merchant-providers list, inspect ID, or init ID --options HOST_SETUP_JSON.');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { console.error((error.code ? error.code + ': ' : '') + error.message); process.exitCode = 1; });
