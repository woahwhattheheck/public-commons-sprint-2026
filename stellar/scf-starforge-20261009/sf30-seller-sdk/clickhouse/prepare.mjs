// MIT. Reuse the original merchant-plan/payment/schema compiler for ClickHouse.
import { mkdir, open, unlink, rmdir, access, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePostgresMerchantPlan } from '../postgres/prepare.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { compileSellerOpenApi } from '../developer-portal.mjs';
import { exportSellerClient } from '../developer/client-export.mjs';
import { readSellerConfig } from '../serve.mjs';
import { compileClickHouseQueries, bindClickHouseParameters } from './declaration.mjs';
import { readJSONFile, readClickHouseSourceFile } from './source.mjs';

export function compileClickHouseMerchantPlan(queries, plan) {
  if (plan?.schema !== 'stellar-forge.clickhouse-merchant-plan.v1') throw new TypeError('CLICKHOUSE_MERCHANT_PLAN_REQUIRED');
  const compiled = compileClickHouseQueries(queries);
  // This original compiler owns all native payment options, public origins,
  // method/body schemas, typed examples and route-collision semantics.
  const bundle = compilePostgresMerchantPlan(queries, { ...plan, schema: 'stellar-forge.postgres-merchant-plan.v1' });
  for (const [index, route] of bundle.service.routes.entries()) {
    const input = route.offer.extensions.bazaar.info.input;
    const mode = bundle.bindings[route.id].input === 'body' ? 'body' : 'queryParams';
    const query = compiled[bundle.bindings[route.id].query];
    bindClickHouseParameters(query, input[mode]);
    route.handler = `clickhouseQuery${index}`; route.admit = `clickhouseAdmit${index}`;
    const schema = route.offer.extensions.bazaar.schema.properties.input.properties[mode];
    for (const [name, spec] of Object.entries(schema.properties)) {
      spec.description = spec.description.replace('PostgreSQL NUL text', 'NUL text') +
        ` Native ClickHouse type: ${query.nativeTypes[name]}.`;
      if (query.parameters[name].type === 'decimal') spec.description +=
        ` At most ${query.parameters[name].precision - query.parameters[name].scale} integer digits and ${query.parameters[name].scale} fractional digits; excess nonzero fractional digits are rejected before payment.`;
    }
  }
  const noOperation = () => { throw new Error('Preparation never executes a seller request'); };
  compileSellerRoutes(bundle.service.routes.map(route => ({ id: route.id, offer: route.offer, handler: noOperation, admit: noOperation })));
  return bundle;
}
export async function assertPrepared(directory) {
  try { await access(resolve(directory, 'INCOMPLETE')); }
  catch (issue) { if (issue.code === 'ENOENT') return; throw issue; }
  throw new Error('CLICKHOUSE_PREPARATION_INCOMPLETE: prepare into a new directory from the retained source and plan');
}
export async function prepareClickHouseSeller({ sourceFile, planFile, directory } = {}) {
  if (![sourceFile, planFile, directory].every(value => typeof value === 'string' && value.length && value.length <= 4096))
    throw new TypeError('CLICKHOUSE_SOURCE_PLAN_DIRECTORY_REQUIRED');
  const { config } = await readClickHouseSourceFile(sourceFile);
  const plan = await readJSONFile(planFile), bundle = compileClickHouseMerchantPlan(config.queries, plan);
  const compiledRoutes = compileSellerRoutes(bundle.service.routes.map(route => ({ id: route.id, offer: route.offer,
    handler() { throw new Error('Preparation only'); }, admit() { return true; } })));
  const openapi = compileSellerOpenApi(compiledRoutes, { mode: 'CHALLENGE_ONLY' });
  const privateSource = { ...structuredClone(config), bindings: bundle.bindings };
  const target = resolve(directory), created = [];
  await mkdir(target, { mode: 0o700 });
  async function write(name, bytes) {
    const file = resolve(target, name), handle = await open(file, 'wx', 0o600); created.push(file);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  }
  try {
    await write('INCOMPLETE', 'Preparation has not completed.\n');
    for (const [name, value, cap] of [['source.json', privateSource, 262144], ['service.json', bundle.service, 1048576],
      ['bindings.json', bundle.bindings, 262144], ['merchant-plan.json', plan, 262144], ['openapi.json', openapi, 16777216]]) {
      const bytes = JSON.stringify(value, null, 2) + '\n';
      if (Buffer.byteLength(bytes) > cap) throw new RangeError('CLICKHOUSE_PREPARED_FILE_TOO_LARGE');
      await write(name, bytes);
    }
    await readSellerConfig(resolve(target, 'service.json'));
    await readClickHouseSourceFile(resolve(target, 'source.json'));
    await exportSellerClient({ openapi: resolve(target, 'openapi.json'), out: resolve(target, 'client') });
    await unlink(resolve(target, 'INCOMPLETE'));
    const handle = await open(target, 'r'); try { await handle.sync(); } finally { await handle.close(); }
    return { directory: target, source: resolve(target, 'source.json'), config: resolve(target, 'service.json'),
      client: resolve(target, 'client'), openapi: resolve(target, 'openapi.json'),
      routes: bundle.service.routes.map(({ id, offer }) => ({ id, method: offer.extensions.bazaar.info.input.method,
        url: offer.resource.url, paymentOptions: offer.accepts.length })),
      launcher: fileURLToPath(new URL('./start.mjs', import.meta.url)) };
  } catch (issue) {
    await rm(resolve(target, 'client'), { recursive: true, force: true }).catch(() => {});
    for (const file of created) await unlink(file).catch(() => {});
    await rmdir(target).catch(() => {}); throw issue;
  }
}
export async function main(args = process.argv.slice(2)) {
  const help = 'Usage: node clickhouse/prepare.mjs --source PRIVATE_SOURCE --plan MERCHANT_PLAN --directory NEW_DIRECTORY';
  if (args.length === 1 && args[0] === '--help') { console.log(help); return; }
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--source', '--plan', '--directory'].includes(args[i]) || options.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(help);
    options.set(args[i], args[i + 1]);
  }
  const result = await prepareClickHouseSeller({ sourceFile: options.get('--source'), planFile: options.get('--plan'), directory: options.get('--directory') });
  console.log(JSON.stringify(result, null, 2)); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(issue => {
  console.error(JSON.stringify({ error: issue.code ?? issue.message })); process.exitCode = 1;
});
