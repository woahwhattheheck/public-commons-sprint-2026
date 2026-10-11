#!/usr/bin/env node
// MIT. Amberdata customer continuation on the original generated client and SF88 buyer.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGINAL_BUYER = 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli';
export const PAGE_SCHEMA = 'stellar-forge.amberdata-page.v1';
export const SUMMARY_SCHEMA = 'stellar-forge.amberdata-ohlcv-summary.v1';
export const ROUTES = Object.freeze({
  spot_instruments: { method: 'GET', path: '/spot/instruments' },
  spot_ohlcv: { method: 'GET', path: '/spot/ohlcv' },
  ohlcv_summary: { method: 'POST', path: '/research/ohlcv-summary' },
});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, message) => { if (!value) throw new TypeError(message); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : object(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);

/** Bind the merchant's retained product.json; prices remain original SDK/offer terms. */
export function inspectProduct(product) {
  need(object(product) && product.schema === 'stellar-forge.amberdata-research-plan.v1', 'Expected the merchant product.json.');
  need(/^[a-f0-9]{64}$/.test(product.selectionSha256 ?? ''), 'The compiled product selection is required.');
  for (const name of ['provider', 'window', 'units', 'limits']) need(object(product[name]), 'Missing product ' + name + '.');
  const selected = Object.fromEntries(['provider', 'window', 'units', 'limits'].map(key => [key, product[key]]));
  need(sha(canonical(selected)) === product.selectionSha256, 'The retained product selection changed.');
  const origin = new URL(product.publicOrigin);
  need(origin.protocol === 'https:' && origin.origin === product.publicOrigin && !origin.username && !origin.password,
    'Expected the selected canonical HTTPS merchant origin.');
  return product;
}

/** Check the full saved envelope without parsing or rounding the provider's numbers. */
export function inspectPage(value, product, operation) {
  inspectProduct(product);
  need(object(value) && value.schema === PAGE_SCHEMA && ['spot_instruments', 'spot_ohlcv'].includes(value.operation),
    'Expected a complete retained Amberdata page envelope.');
  need(operation === undefined || operation === value.operation, 'The saved page is for another operation.');
  need(value.selectionSha256 === product.selectionSha256, 'The saved page is for another product selection.');
  need(canonical(value.provider) === canonical(product.provider), 'The saved provider selection differs.');
  if (value.operation === 'spot_ohlcv') {
    need(canonical(value.window) === canonical(product.window) && canonical(value.units) === canonical(product.units),
      'The saved OHLCV window or units differ.');
  }
  need(typeof value.body === 'string', 'The exact UTF-8 provider body is required.');
  const bytes = Buffer.from(value.body, 'utf8');
  need(utf8(bytes) === value.body && bytes.length <= product.limits.maxResponseBytes && bytes.length === value.bodyBytes
    && sha(bytes) === value.bodySha256, 'The saved provider body differs from its bytes or digest.');
  const request = value.request;
  need(object(request) && Number.isSafeInteger(request.pageIndex) && request.pageIndex >= 0
    && request.pageIndex < product.limits.maxPages, 'The original page position is required.');
  need(request.pageIndex === 0 ? request.cursor === null && request.previousBodySha256 === null
    : typeof request.cursor === 'string' && request.cursor.length > 0 && /^[a-f0-9]{64}$/.test(request.previousBodySha256 ?? ''),
  'The original page predecessor is required.');
  need(value.continuation === null || (object(value.continuation)
    && (value.continuation.token === null || (typeof value.continuation.token === 'string' && value.continuation.token.length > 0))
    && typeof value.continuation.pageLimitReached === 'boolean'), 'Invalid merchant continuation envelope.');
  if (value.interpretation !== undefined) need(object(value.interpretation)
    && ['ready', 'unavailable'].includes(value.interpretation.status), 'Invalid provider interpretation state.');
  return value;
}

export function inspectCloudsync(source, expectedInterval) {
  need(object(source) && source.schema === 'stellar-forge.amberdata-cloudsync.v1'
    && ['minutes', 'hours', 'days'].includes(source.interval) && typeof source.rowsBody === 'string'
    && (expectedInterval === undefined || source.interval === expectedInterval),
  'CloudSync input must retain the original source contract and selected interval.');
  const rows = Buffer.from(source.rowsBody, 'utf8');
  need(utf8(rows) === source.rowsBody && sha(rows) === source.rowsSha256, 'The retained CloudSync rows changed.');
  need(object(source.original) && source.original.format === 'parquet'
    && /^[a-f0-9]{64}$/.test(source.original.sha256 ?? '') && Number.isSafeInteger(source.original.bytes)
    && source.original.bytes > 0 && typeof source.original.url === 'string', 'The original Parquet identity is required.');
  need(object(source.decoder) && source.decoder.numberFormat === 'binary64-roundtrip-json'
    && typeof source.decoder.name === 'string' && typeof source.decoder.version === 'string'
    && /^[a-f0-9]{64}$/.test(source.decoder.originalRowsSha256 ?? '')
    && Number.isSafeInteger(source.decoder.originalRowsBytes) && source.decoder.originalRowsBytes > 0,
  'The actual decoder and original decoded-file identity are required.');
  return source;
}

/** Build only product inputs. The original SDK builds the paid HTTP request. */
export function operationInputs(product, operation, { after, pages = [], researchInput } = {}) {
  inspectProduct(product);
  need(Object.hasOwn(ROUTES, operation), 'Choose one of this product\'s three operation IDs.');
  if (operation !== 'ohlcv_summary') {
    need(pages.length === 0 && researchInput === undefined, 'Provider reads accept a prior page, not a summary collection.');
    if (after === undefined) return { query: {} };
    const page = inspectPage(after, product, operation);
    need(page.continuation !== null, 'This page has no continuation.');
    need(!page.continuation.pageLimitReached, 'The product page limit has been reached.');
    need(typeof page.continuation.token === 'string' && page.continuation.token.length > 0,
      page.continuation.unavailableReason ?? 'This page has no usable merchant continuation token.');
    return { query: { continuation: page.continuation.token } };
  }
  if (researchInput !== undefined) {
    need(after === undefined && pages.length === 0 && object(researchInput),
      'An explicit research input object cannot be combined with page selections.');
    need(Buffer.byteLength(JSON.stringify(researchInput)) <= product.limits.maxInputBytes,
      'The selected summary input limit has been reached.');
    if (Object.hasOwn(researchInput, 'pages')) {
      need(Object.keys(researchInput).length === 1, 'Pages cannot be mixed with CloudSync inputs.');
      return operationInputs(product, operation, { pages: researchInput.pages });
    }
    need(Object.hasOwn(researchInput, 'cloudsync') && Object.keys(researchInput).every(key => ['cloudsync', 'compareCloudsync'].includes(key)),
      'Choose the original pages or cloudsync research input.');
    inspectCloudsync(researchInput.cloudsync, product.window.timeInterval);
    if (researchInput.compareCloudsync !== undefined) {
      need(Array.isArray(researchInput.compareCloudsync) && researchInput.compareCloudsync.length <= 2,
        'Choose at most two original CloudSync comparison sources.');
      for (const source of researchInput.compareCloudsync) inspectCloudsync(source);
    }
    return { body: researchInput };
  }
  need(after === undefined && Array.isArray(pages) && pages.length > 0 && pages.length <= product.limits.maxPages,
    'A summary requires the ordered saved OHLCV page envelopes.');
  const seen = new Set();
  let previous = null;
  for (let index = 0; index < pages.length; index++) {
    const page = inspectPage(pages[index], product, 'spot_ohlcv');
    need(page.request.pageIndex === index && page.request.previousBodySha256 === previous,
      'Supply the original page sequence from page zero, in order.');
    need(!seen.has(page.bodySha256), 'The same provider page was supplied twice.');
    if (index + 1 < pages.length) need(page.continuation !== null, 'A terminal page cannot have a successor.');
    seen.add(page.bodySha256); previous = page.bodySha256;
  }
  const body = { pages };
  need(Buffer.byteLength(JSON.stringify(body)) <= product.limits.maxInputBytes, 'The selected summary input limit has been reached.');
  return { body };
}

export async function prepareCustomerOperation({ buyer, generated, product, operation, intentId, maxAtomic, acceptIndex, after, pages, researchInput }) {
  need(buyer && typeof buyer.fromRequest === 'function' && generated && typeof generated.buildRequest === 'function',
    'Use the original SF88 Buyer and the merchant\'s original generated client.');
  inspectProduct(product);
  const route = ROUTES[operation], original = generated.operations?.find(row => row.id === operation);
  need(route && original && generated.source?.origin === product.publicOrigin
    && original.method === route.method && original.path === route.path, 'The generated client differs from the selected product.');
  const request = generated.buildRequest(operation, operationInputs(product, operation, { after, pages, researchInput }),
    { intentId, maxAtomic, ...(acceptIndex === undefined ? {} : { acceptIndex }) });
  return buyer.fromRequest(request, { responseFile: { maxBytes: 1048576, timeoutMs: 60000 }, requestTimeoutMs: 60000 });
}

/** Interpretation is deliberately downstream of the original saved native result. */
export function inspectPayload(value, product) {
  if (value?.schema === PAGE_SCHEMA) {
    const page = inspectPage(value, product);
    return { schema: page.schema, operation: page.operation, selectionSha256: page.selectionSha256,
      provider: page.provider, window: page.window, units: page.units,
      pageIndex: page.request.pageIndex, previousBodySha256: page.request.previousBodySha256,
      bodySha256: page.bodySha256, bodyBytes: page.bodyBytes,
      continuationPresent: page.continuation !== null,
      continuationAvailable: typeof page.continuation?.token === 'string' && page.continuation.token.length > 0,
      pageLimitReached: page.continuation?.pageLimitReached ?? false,
      continuationUnavailableReason: page.continuation?.unavailableReason ?? null,
      interpretation: page.interpretation ?? null,
      nativeUpstream: page.nativeUpstream };
  }
  inspectProduct(product);
  need(object(value) && value.schema === SUMMARY_SCHEMA && value.selectionSha256 === product.selectionSha256,
    'Response is not a summary for this retained product.');
  need(canonical(value.provider) === canonical(product.provider) && canonical(value.window) === canonical(product.window)
    && canonical(value.units) === canonical(product.units), 'Summary provider, window or units differ.');
  for (const name of ['open', 'high', 'low', 'close', 'volume']) need(value[name] === null
    || (typeof value[name] === 'string' && /^-?[0-9]+(?:\.[0-9]+)?$/.test(value[name])), 'Summary decimal values must stay strings.');
  need((typeof value.pageChainComplete === 'boolean' || (value.sourceKind === 'cloudsync-parquet' && value.pageChainComplete === null))
    && typeof value.intervalCoverageComplete === 'boolean'
    && typeof value.complete === 'boolean' && Array.isArray(value.sources) && Array.isArray(value.gaps),
  'Summary completeness and source inventories are required.');
  return value;
}

export async function consumeResult(result, { product, output } = {}) {
  const view = { native: result.native, process: { exitCode: result.record.exitCode,
    runtimeError: result.record.runtimeError, recovered: result.record.recovered },
  responseFile: result.delivery, nativeSuccess: result.ok };
  // Native SF88 already saved exact bytes. Export those bytes BEFORE decoding them.
  if (output) {
    try { view.exported = String(await result.saveAs(resolve(output))); }
    catch (error) { view.exportError = error.code ?? error.message; }
  }
  try {
    const bytes = await result.bytes({ limit: 1048576 });
    view.interpretation = inspectPayload(JSON.parse(utf8(bytes)), product);
    view.interpretationStatus = view.interpretation.schema === PAGE_SCHEMA
      ? view.interpretation.interpretation?.status ?? 'unspecified' : 'ready';
  } catch (error) { view.interpretationStatus = 'unavailable'; view.interpretationError = error.code ?? error.message; }
  return view;
}

async function jsonFile(path, max = 1048576) {
  const handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size <= max, 'Expected a regular JSON file within the input limit.');
    const bytes = await handle.readFile();
    need(bytes.length <= max && bytes.length === before.size, 'The selected JSON file changed while reading.');
    return JSON.parse(utf8(bytes));
  } finally { await handle.close(); }
}

const HELP = `Amberdata customer on the original SF88 Node Buyer (Node22+)

  prepare --source-root ROOT --state PRIVATE --profile PROFILE.json --client seller-client.mjs
          --product product.json --operation spot_instruments|spot_ohlcv|ohlcv_summary
          --intent ID --max-atomic N --accept INDEX [--after PAGE.json | --page PAGE.json ... | --input INPUT.json]
  review  --source-root ROOT --state PRIVATE --intent ID
  execute --source-root ROOT --state PRIVATE --intent ID --product product.json [--out NEW_FILE]
  recover --source-root ROOT --state PRIVATE --intent ID --product product.json [--out NEW_FILE]
  inspect --source-root ROOT --state PRIVATE --intent ID
  list    --source-root ROOT --state PRIVATE

ROOT is the original repository/source root containing stellar/. prepare is local
native review; execute is one original approved buyer attempt. recover reads the
same saved operation without HTTP. --after consumes only a retained merchant token.
--page is repeatable and order is preserved. Every continuation is a separate,
explicitly reviewed request. --out exports exact saved response bytes create-only.
--input passes a complete research input object, preserving its embedded source text.
`;
function parse(argv) {
  const command = argv[0] ?? 'help', flags = {}, pages = [];
  const shared = ['source-root', 'state'];
  const allowed = { prepare: [...shared, 'profile', 'client', 'product', 'operation', 'intent', 'max-atomic', 'accept', 'after', 'page', 'input'],
    review: [...shared, 'intent'], execute: [...shared, 'intent', 'product', 'out'],
    recover: [...shared, 'intent', 'product', 'out'], inspect: [...shared, 'intent'], list: shared };
  need(allowed[command], HELP);
  for (let index = 1; index < argv.length; index++) {
    const key = argv[index].slice(2), value = argv[index + 1];
    need(argv[index].startsWith('--') && allowed[command].includes(key) && value !== undefined
      && !value.startsWith('--') && (key === 'page' || !Object.hasOwn(flags, key)), 'Use supported --name value options.');
    index++;
    if (key === 'page') pages.push(value); else flags[key] = value;
  }
  return { command, flags, pages };
}
const required = (flags, key) => { need(flags[key], '--' + key + ' is required.'); return flags[key]; };
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || ['help', '--help', '-h'].includes(argv[0])) { process.stdout.write(HELP); return; }
  const { command, flags, pages } = parse(argv);
  const sourceRoot = resolve(flags['source-root'] ?? join(HERE, '../../../../..'));
  const runtimeDirectory = join(sourceRoot, ORIGINAL_BUYER);
  const { Buyer } = await import(pathToFileURL(join(runtimeDirectory, 'node/index.mjs')).href);
  const buyer = new Buyer({ runtimeDirectory, stateDirectory: resolve(required(flags, 'state')),
    ...(flags.profile ? { operatorProfile: resolve(flags.profile) } : {}) });
  let output;
  if (command === 'list') {
    output = [];
    for await (const operation of buyer.list()) output.push(await operation.inspect());
  } else if (command === 'prepare') {
    const accept = Number(required(flags, 'accept'));
    need(/^(0|[1-9][0-9]*)$/.test(flags.accept) && Number.isSafeInteger(accept), 'Choose an original zero-based accept index.');
    required(flags, 'profile');
    const product = inspectProduct(await jsonFile(required(flags, 'product')));
    const generated = await import(pathToFileURL(resolve(required(flags, 'client'))).href);
    const operation = await prepareCustomerOperation({ buyer, generated, product,
      operation: required(flags, 'operation'), intentId: required(flags, 'intent'),
      maxAtomic: required(flags, 'max-atomic'), acceptIndex: accept,
      after: flags.after ? await jsonFile(flags.after) : undefined,
      researchInput: flags.input ? await jsonFile(flags.input) : undefined,
      pages: await Promise.all(pages.map(path => jsonFile(path))) });
    output = { intentId: operation.intentId, directory: operation.directory, review: (await operation.review()).native };
  } else {
    const operation = buyer.operation(required(flags, 'intent'));
    if (command === 'inspect') output = await operation.inspect();
    else if (command === 'review') output = (await operation.review()).native;
    else {
      const product = inspectProduct(await jsonFile(required(flags, 'product')));
      const result = command === 'execute' ? await operation.execute({ review: await operation.review() }) : await operation.recover();
      output = result ? await consumeResult(result, { product, output: flags.out }) : {
        status: 'ORIGINAL_RESULT_NOT_RECORDED', operation: await operation.inspect() };
      if (!result || !result.ok || output.interpretationStatus === 'unavailable' || output.exportError) process.exitCode = 2;
    }
  }
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write(JSON.stringify({ error: error.code ?? error.message,
    ...(error.operation ? { operationDirectory: error.operation.directory } : {}) }) + '\n');
  process.exitCode = 2;
});
