// MIT. OpenSearch onboarding uses the original public seller and customer compiler.
import { mkdir, open, unlink, rmdir, access, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileQueryMerchantPlan } from '../postgres/prepare.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { compileSellerOpenApi } from '../developer-portal.mjs';
import { exportSellerClient } from '../developer/client-export.mjs';
import { readSellerConfig } from '../serve.mjs';
import { compileOpenSearchQueries, bindOpenSearchParameters } from './declaration.mjs';
import { readJSONFile, readOpenSearchSourceFile } from './source.mjs';

export function compileOpenSearchMerchantPlan(queries, plan) {
  if (plan?.routes?.some(route => !['GET', 'POST'].includes(route.method)))
    throw new TypeError('OPENSEARCH_MERCHANT_REQUIRES_GET_OR_POST');
  const compiled = compileOpenSearchQueries(queries);
  const bundle = compileQueryMerchantPlan(compiled, plan, {
    schema: 'stellar-forge.opensearch-merchant-plan.v1',
    handlerPrefix: 'openSearchQuery', admitPrefix: 'openSearchAdmit',
    bindParameters: bindOpenSearchParameters,
  });
  for (const route of bundle.service.routes) {
    const mode = bundle.bindings[route.id].input === 'body' ? 'body' : 'queryParams';
    const properties = route.offer.extensions.bazaar.schema.properties.input.properties[mode].properties;
    for (const parameter of Object.values(properties))
      parameter.description = parameter.description.replace('PostgreSQL NUL text', 'NUL text').replace('SQL null', 'null');
  }
  return bundle;
}
export async function assertPrepared(directory) {
  try { await access(resolve(directory, 'INCOMPLETE')); }
  catch (issue) { if (issue.code === 'ENOENT') return; throw issue; }
  throw new Error('OPENSEARCH_PREPARATION_INCOMPLETE');
}
export async function prepareOpenSearchSeller({ sourceFile, planFile, directory } = {}) {
  if (![sourceFile, planFile, directory].every(value => typeof value === 'string' && value.length && value.length <= 4096))
    throw new TypeError('OPENSEARCH_SOURCE_PLAN_DIRECTORY_REQUIRED');
  const { config } = await readOpenSearchSourceFile(sourceFile);
  const plan = await readJSONFile(planFile), bundle = compileOpenSearchMerchantPlan(config.queries, plan);
  const compiled = compileSellerRoutes(bundle.service.routes.map(route => ({
    id: route.id, offer: route.offer, handler() { throw new Error('Preparation only'); }, admit() { return true; },
  })));
  const openapi = compileSellerOpenApi(compiled, { mode: 'CHALLENGE_ONLY' });
  const privateSource = { ...structuredClone(config), bindings: bundle.bindings };
  const target = resolve(directory), created = [];
  await mkdir(target, { mode: 0o700 });
  async function write(name, value, cap) {
    const bytes = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
    if (Buffer.byteLength(bytes) > cap) throw new RangeError('OPENSEARCH_PREPARED_FILE_TOO_LARGE');
    const file = resolve(target, name), handle = await open(file, 'wx', 0o600);
    created.push(file);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  }
  try {
    await write('INCOMPLETE', 'Merchant preparation is in progress.\n', 128);
    for (const [name, value, cap] of [
      ['source.json', privateSource, 262144], ['merchant-plan.json', plan, 262144],
      ['service.json', bundle.service, 1048576], ['bindings.json', bundle.bindings, 262144],
      ['openapi.json', openapi, 16777216],
    ]) await write(name, value, cap);
    await readSellerConfig(resolve(target, 'service.json'));
    await readOpenSearchSourceFile(resolve(target, 'source.json'));
    await exportSellerClient({ openapi: resolve(target, 'openapi.json'), out: resolve(target, 'client') });
    await unlink(resolve(target, 'INCOMPLETE'));
    const handle = await open(target, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    return { directory: target, source: resolve(target, 'source.json'), config: resolve(target, 'service.json'),
      client: resolve(target, 'client'), openapi: resolve(target, 'openapi.json'),
      routes: bundle.service.routes.map(({ id, offer }) => ({
        id, method: offer.extensions.bazaar.info.input.method, url: offer.resource.url, paymentOptions: offer.accepts.length,
      })), launcher: fileURLToPath(new URL('./start.mjs', import.meta.url)) };
  } catch (issue) {
    await rm(resolve(target, 'client'), { recursive: true, force: true }).catch(() => {});
    for (const file of created) await unlink(file).catch(() => {});
    await rmdir(target).catch(() => {});
    throw issue;
  }
}
export async function main(args = process.argv.slice(2)) {
  const help = 'Usage: node opensearch/prepare.mjs --source PRIVATE_SOURCE --plan MERCHANT_PLAN --directory NEW_DIRECTORY';
  if (args.length === 1 && args[0] === '--help') { console.log(help); return; }
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--source', '--plan', '--directory'].includes(args[i]) || options.has(args[i]) ||
        !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(help);
    options.set(args[i], args[i + 1]);
  }
  const result = await prepareOpenSearchSeller({
    sourceFile: options.get('--source'), planFile: options.get('--plan'), directory: options.get('--directory'),
  });
  console.log(JSON.stringify(result, null, 2)); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(issue => {
  console.error(JSON.stringify({ error: issue.code ?? 'OPENSEARCH_PREPARATION_FAILED' })); process.exitCode = 1;
});
