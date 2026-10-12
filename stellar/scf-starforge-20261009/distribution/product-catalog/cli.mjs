#!/usr/bin/env node
// MIT. Discover and plan original products through the maintained source-build engines.
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openGitSource } from '../git-source.mjs';
import { sourceBuildCatalog, describeProductSource } from '../runtime-workspace/source-build-workspace.mjs';
import { searchProductCatalog, productSourceSummary, compareProductSources,
  planProductInstallation, formatProductCatalogMarkdown } from './catalog.mjs';

const HELP = 'Starforge product catalogue\n\n' +
  'product-catalog list --repo CHECKOUT [--ref REF] [--query TEXT] [--available-only]\n' +
  'product-catalog inspect --repo CHECKOUT --selection ID [--ref REF]\n' +
  'product-catalog compare --repo CHECKOUT --selection ID --selection ID [--ref REF]\n' +
  'product-catalog plan --repo CHECKOUT --selection ID [--ref REF]\n' +
  '  [--output BUILD_DIRECTORY] [--runtime RUNTIME_DIRECTORY]\n' +
  '  [--native] [--feature NAME ...] [--operator] [--receipt BUILD_RECEIPT.json]\n' +
  '  [--command ORIGINAL_COMMAND -- ORIGINAL_ARGUMENTS...]\n\n' +
  'All commands accept --format json|markdown and --fetch-sources.\n' +
  'inspect, compare and plan also accept --python EXECUTABLE for the source description.\n' +
  'The default ref is HEAD; each invocation resolves one immutable commit before reading products.\n' +
  'Local Git objects are used by default. --fetch-sources permits the original Git reader to\n' +
  'acquire missing objects from the repository\'s existing configured promisor remote.\n' +
  'A completed build receipt supplies its original archive and SHA-256 to the installation plan.\n' +
  'Use the Source Builds workspace or the printed original commands to build and install.\n';

const COMMON = ['--repo', '--ref', '--format', '--fetch-sources'];
const ALLOWED = {
  list: [...COMMON, '--query', '--available-only'],
  inspect: [...COMMON, '--selection', '--python'],
  compare: [...COMMON, '--selection', '--python'],
  plan: [...COMMON, '--selection', '--python', '--output', '--runtime', '--native',
    '--feature', '--operator', '--receipt', '--command'],
};
const FLAGS = new Set(['--fetch-sources', '--available-only', '--native', '--operator']);
function fail(code, message) { throw Object.assign(new TypeError(message), { code }); }

function parse(args) {
  const [command, ...rest] = args, allowed = ALLOWED[command];
  if (!allowed) fail('PRODUCT_CATALOG_COMMAND_UNKNOWN', 'Choose list, inspect, compare or plan.');
  const values = {}, originalArguments = [];
  for (let index = 0; index < rest.length; index++) {
    const name = rest[index];
    if (name === '--' && command === 'plan') { originalArguments.push(...rest.slice(index + 1)); break; }
    const repeatable = name === '--feature' || name === '--selection' && command === 'compare';
    if (!allowed.includes(name) || !repeatable && Object.hasOwn(values, name))
      fail('PRODUCT_CATALOG_OPTION_INVALID', 'Unexpected or repeated option: ' + name);
    if (FLAGS.has(name)) { values[name] = true; continue; }
    const value = rest[++index];
    if (value === undefined || value === '' || value.startsWith('--'))
      fail('PRODUCT_CATALOG_OPTION_VALUE_REQUIRED', 'A value is required for ' + name + '.');
    if (repeatable) (values[name] ??= []).push(value);
    else values[name] = value;
  }
  if (!values['--repo']) fail('PRODUCT_CATALOG_REPOSITORY_REQUIRED', '--repo must name the original Git checkout.');
  const format = values['--format'] ?? 'json';
  if (!['json', 'markdown'].includes(format)) fail('PRODUCT_CATALOG_FORMAT_INVALID', 'Choose json or markdown.');
  if (command !== 'list' && !values['--selection'])
    fail('PRODUCT_CATALOG_SELECTION_REQUIRED', 'Choose the original product with --selection ID.');
  if (command === 'compare' && values['--selection'].length < 2)
    fail('PRODUCT_COMPARISON_SELECTIONS_REQUIRED', 'Choose at least two products with repeated --selection.');
  if (originalArguments.length && !values['--command'])
    fail('PRODUCT_PLAN_COMMAND_REQUIRED', 'Select --command before its original arguments.');
  return { command, values, format, originalArguments };
}

async function receiptFile(path) {
  const filename = resolve(path), info = await stat(filename);
  if (!info.isFile() || info.size > 1024 * 1024)
    fail('PRODUCT_PLAN_RECEIPT_FILE_INVALID', 'Choose an original build receipt JSON file up to 1 MiB.');
  const bytes = await readFile(filename);
  if (bytes.length > 1024 * 1024)
    fail('PRODUCT_PLAN_RECEIPT_FILE_INVALID', 'The original build receipt exceeds 1 MiB.');
  return JSON.parse(bytes.toString('utf8'));
}

/** Return the same view consumed by the Source Builds browser, without saving a review. */
export async function readProductCatalogCommand(args) {
  const parsed = parse(args), { command, values } = parsed;
  const repository = await realpath(resolve(values['--repo']));
  const catalog = await sourceBuildCatalog({ repository, ref: values['--ref'] ?? 'HEAD',
    offline: !values['--fetch-sources'] });
  if (command === 'list') return { format: parsed.format, value: searchProductCatalog(catalog,
    { query: values['--query'] ?? '', availableOnly: !!values['--available-only'] }) };
  const requested = command === 'compare' ? values['--selection'] : [values['--selection']];
  if (new Set(requested).size !== requested.length)
    fail('PRODUCT_COMPARISON_DUPLICATE', 'Choose each product once.');
  for (const selection of requested) {
    if (catalog.products.some(product => product.id === selection && product.available)) continue;
    const invalid = catalog.products.find(product => product.path?.endsWith('/' + selection + '.json'));
    if (invalid?.error) fail(invalid.error.code ?? 'PRODUCT_SOURCE_UNAVAILABLE', invalid.error.message);
    fail('PRODUCT_CATALOG_SELECTION_UNKNOWN', 'Unknown committed product: ' + selection);
  }
  // Reuse one exact reader and its source cache for every chosen product. A
  // concurrent branch movement cannot change this invocation's selected commit.
  const source = openGitSource({ repository, ref: catalog.sourceCommit, offline: catalog.offline });
  const reviews = requested.map(selection => describeProductSource(source, { repository, selection,
    offline: catalog.offline, python: values['--python'], includeRequirements: true }));
  let value;
  if (command === 'inspect') value = productSourceSummary(reviews[0]);
  else if (command === 'compare') value = compareProductSources(reviews);
  else value = planProductInstallation(reviews[0], {
    ...(values['--output'] ? { outputDirectory: resolve(values['--output']) } : {}),
    ...(values['--runtime'] ? { runtimeDirectory: resolve(values['--runtime']) } : {}),
    features: values['--feature'] ?? [], native: !!values['--native'], operator: !!values['--operator'],
    ...(values['--receipt'] ? { buildReceipt: await receiptFile(values['--receipt']) } : {}),
    ...(values['--command'] ? { entryCommand: values['--command'], entryArguments: parsed.originalArguments } : {}),
  });
  return { format: parsed.format, value };
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['--help', 'help'].includes(args[0])) {
    process.stdout.write(HELP); return 0;
  }
  const { format, value } = await readProductCatalogCommand(args);
  process.stdout.write(format === 'markdown' ? formatProductCatalogMarkdown(value) :
    JSON.stringify(value, null, 2) + '\n');
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'PRODUCT_CATALOG_ERROR',
      message: error.message }) + '\n');
    process.exitCode = 1;
  });
