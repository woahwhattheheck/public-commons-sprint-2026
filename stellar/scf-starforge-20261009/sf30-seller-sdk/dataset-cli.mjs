// MIT. Inspect a CSV snapshot or generate a config for the ORIGINAL SF30 server.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDatasetConfig } from './dataset-handler.mjs';

const USAGE = `Usage:
  node dataset-cli.mjs frictionless --help  Retained data packages, reviewed fields and original merchant releases
  node dataset-cli.mjs feeds --help   Retained RSS/Atom editions, operator workspace and merchant handoff
  node dataset-cli.mjs sdmx --help     Retained SDMX editions, merchant publication and customer receiving
  node dataset-cli.mjs odata --help   OData source, retained editions and merchant workspace
  node dataset-cli.mjs xml --workspace DIRECTORY init|serve|source|plan|build|query|compare|export|import
  node dataset-cli.mjs ndjson --workspace DIRECTORY init|serve|source|plan|build|query|compare|export|import|merchant
  node dataset-cli.mjs --dataset FILE
  node dataset-cli.mjs ogc --help      OGC / GeoJSON capture, field review and dataset export
  node dataset-cli.mjs geocoder --help Census address capture, match review, merchant and buyer
  node dataset-cli.mjs --dataset FILE --payment FILE --origin https://api.example \\
    [--path /data] --out seller.json

Inspection prints schema and row count, never source rows. Generation requires the
operator's real public payment terms. Output is create-only. Start the result with
serve.mjs --config seller.json --handlers examples/dataset-application.mjs and set
SF30_DATASET_CONFIG to the same absolute dataset configuration path.`;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Native seller docs and query workspace share the same configured capabilities. */
export function datasetQueryParameters(description) {
  return [
    { name: 'fields', type: 'string', description: 'Comma-separated exposed columns, in output order; omit for all.',
      example: description.columns[0].name },
    { name: 'limit', type: 'integer', description: `Rows per page, from 1 to ${description.maxLimit}.`,
      example: description.defaultLimit },
    { name: 'cursor', type: 'string', description: 'Use page.nextCursor unchanged with the same filters, fields and sort; omit for the first page.', example: '' },
    ...description.columns.filter(c => c.filterable).map(c => ({ name: `where_${c.name}`, type: 'string',
      description: `Exact ${c.type} equality on ${c.name}.${c.nullable ? ' Empty value matches null.' : ''}`,
      example: c.type === 'boolean' ? 'true' : ['integer', 'number'].includes(c.type) ? '0' : 'VALUE' })),
    ...description.columns.filter(c => c.rangeFilterable).flatMap(c => [
      ['gt', 'greater than'], ['gte', 'greater than or equal to'], ['lt', 'less than'], ['lte', 'less than or equal to'],
    ].map(([op, relation]) => ({ name: `${op}_${c.name}`, type: 'string',
      description: `${c.name} ${relation} this ${c.type} value; nulls never match.${c.type === 'string' ? ' UTF-16 code-unit ordering, not date parsing.' : ''}`,
      example: c.type === 'string' ? 'VALUE' : '0' }))),
    ...(description.columns.some(c => c.sortable) ? [{ name: 'sort', type: 'string',
      description: `One enabled column (${description.columns.filter(c => c.sortable).map(c => c.name).join(', ')}); prefix - for descending. Nulls last; ties retain CSV order.`,
      example: description.columns.find(c => c.sortable).name }] : []),
  ];
}

export async function buildDatasetSellerConfig(dataset, { payment, origin, path = '/data' } = {}) {
  if (!object(payment) || Object.keys(payment).some(k => !['scheme', 'network', 'asset', 'amount', 'payTo', 'maxTimeoutSeconds'].includes(k)))
    throw new TypeError('Only public SF30 payment terms are accepted');
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || origin.replace(/\/$/, '') !== url.origin)
    throw new TypeError('origin must be a canonical HTTPS origin');
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9_.~/-]+$/.test(path) || path.includes('//') ||
      path === '/_seller' || path.startsWith('/_seller/') || new URL(path, url).pathname !== path)
    throw new TypeError('path must be a fixed canonical application path');
  const description = dataset.describe();
  const queryParameters = datasetQueryParameters(description);
  const definition = { method: 'GET', description: `${description.name}: filtered CSV snapshot, one paid request per page.`,
    serviceName: 'CSV Dataset API', tags: ['dataset', 'csv'], payment, queryParameters,
    outputExample: { schema: 'stellar-forge.dataset-page.v1', rows: [],
      page: { limit: description.defaultLimit, total: 0, returned: 0, nextCursor: null } } };
  // Import the original compiler only for config generation, so inspection needs no SDK.
  const { compileHttpSellerOffer, paymentRequiredResponse } = await import('./seller.mjs');
  paymentRequiredResponse(compileHttpSellerOffer({ ...definition, url: url.origin + path }));
  return { schema: 'stellar-forge.seller-service.v1', publicOrigin: url.origin, routes: [{
    id: 'dataset', path, definition, handler: 'queryDataset', admit: 'admitDataset',
  }] };
}

export async function main(args = process.argv.slice(2)) {
  if (args[0] === 'frictionless') return (await import('./frictionless/cli.mjs')).main(args.slice(1));
  if (args[0] === 'feeds') return (await import('./feeds/cli.mjs')).main(args.slice(1));
  if (args[0] === 'sdmx') return (await import('./sdmx/cli.mjs')).main(args.slice(1));
  if (args[0] === 'odata') return (await import('./odata/cli.mjs')).main(args.slice(1));
  if (args[0] === 'xml') return (await import('./xml/cli.mjs')).main(args.slice(1));
  if (args[0] === 'ndjson') return (await import('./ndjson/cli.mjs')).main(args.slice(1));
  if (args[0] === 'ogc') return (await import('./ogc/cli.mjs')).main(args.slice(1));
  if (args[0] === 'geocoder') return (await import('./census-geocoder/cli.mjs')).main(args.slice(1));
  if (args.includes('--help')) { console.log(USAGE); return; }
  const allowed = new Set(['--dataset', '--payment', '--origin', '--path', '--out']);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!allowed.has(key) || Object.hasOwn(options, key) || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new TypeError('Invalid, duplicate or missing command option; use --help');
    options[key] = args[i + 1];
  }
  if (!options['--dataset']) throw new TypeError('--dataset is required');
  const dataset = await loadDatasetConfig(options['--dataset']);
  const generate = Object.keys(options).some(k => k !== '--dataset');
  if (!generate) { console.log(JSON.stringify(dataset.describe(), null, 2)); return; }
  if (!options['--payment'] || !options['--origin'] || !options['--out'])
    throw new TypeError('Generation requires --payment, --origin and --out together');
  const bytes = await readFile(options['--payment']);
  if (bytes.length > 16384) throw new TypeError('Payment terms file exceeds 16 KiB');
  const payment = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!object(payment) || Object.keys(payment).some(k => !['scheme', 'network', 'asset', 'amount', 'payTo', 'maxTimeoutSeconds'].includes(k)))
    throw new TypeError('Payment file must contain only public SF30 payment terms, not wallet credentials');
  const config = await buildDatasetSellerConfig(dataset, { payment, origin: options['--origin'], path: options['--path'] });
  await writeFile(options['--out'], JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ created: resolve(options['--out']), rows: dataset.describe().rowCount,
    snapshot: dataset.describe().snapshot, mode: 'CONFIG_GENERATED_NOT_RUNNING' }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(`Dataset: ${error.message}`); process.exitCode = 1; });
