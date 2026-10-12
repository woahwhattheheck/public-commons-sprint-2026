// MIT. Customer application using the original seller client and buyer response writer.
import { constants } from 'node:fs';
import { open, mkdir, lstat, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const SCHEMA = 'tjlabs.redis-customer-export.v1';
const RESULT_SCHEMA = 'stellar-forge.redis-result.v1';
const MAX_ATOMIC = 170141183460469231731687303715884105727n;
const PRODUCT_KINDS = new Set(['get', 'hash', 'sorted-set', 'stream', 'list', 'set']);
const OPERATION_ID = /^[A-Za-z0-9_-]{1,80}$/;
const QUERY_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const selectedQuery = product => product.query ?? product.id;
const selectedCursor = product => product.cursorParameter ?? 'cursor';
const SUCCESS = new Set(['NO_PAYMENT_REQUIRED', 'DELIVERED_REPORTED_SETTLED']);
const plain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const fail = (code, detail) => Object.assign(new Error(detail), { code: 'CUSTOMER_EXPORT_' + code });

function record(value, allowed, label) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw fail('INPUT', 'Use the declared ' + label + ' fields.');
}
function text(value, maximum, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value))
    throw fail('INPUT', 'Supply a printable ' + label + '.');
  return value;
}
function atomic(value, label) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,38})$/.test(value) || BigInt(value) > MAX_ATOMIC)
    throw fail('INPUT', label + ' must be a canonical Stellar i128 atomic-unit string.');
  return BigInt(value);
}
function query(value) {
  if (!plain(value) || Object.keys(value).length > 32 ||
      Object.entries(value).some(([key, item]) => !key || typeof item !== 'string' || item.length > 8192))
    throw fail('INPUT', 'Keep each original query parameter as text.');
  return structuredClone(value);
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw fail('INPUT', label + ' is outside the selected bounds.');
  return value;
}
export function validateCustomerExportPlan(value) {
  record(value, ['schema', 'operationId', 'budget', 'response', 'products'], 'customer export plan');
  if (value.schema !== SCHEMA) throw fail('INPUT', 'Select a ' + SCHEMA + ' plan.');
  text(value.operationId, 80, 'original business operation ID');
  record(value.budget, ['maxCalls', 'maxAtomic'], 'call/payment budget');
  integer(value.budget.maxCalls, 1, 100000, 'maxCalls');
  atomic(value.budget.maxAtomic, 'Aggregate maximum');
  record(value.response, ['maxBytes', 'timeoutMs'], 'response-file limits');
  integer(value.response.maxBytes, 1, 64 * 1024 * 1024, 'Response maxBytes');
  integer(value.response.timeoutMs, 1, 2147483647, 'Response timeoutMs');
  if (!Array.isArray(value.products) || value.products.length < 1 || value.products.length > 64)
    throw fail('INPUT', 'Select 1–64 products from the original generated client.');
  const seen = new Set();
  for (const item of value.products) {
    record(item, ['id', 'query', 'kind', 'cursorParameter', 'input', 'maxAtomic', 'acceptIndex', 'paymentFlow'], 'product');
    if (typeof item.id !== 'string' || !OPERATION_ID.test(item.id) || seen.has(item.id) ||
        typeof selectedQuery(item) !== 'string' || !QUERY_NAME.test(selectedQuery(item)) ||
        has(item, 'query') && typeof item.query !== 'string' || !PRODUCT_KINDS.has(item.kind))
      throw fail('INPUT', 'Select distinct original operation IDs and their declared query names and Redis kinds.');
    if (has(item, 'cursorParameter') && (item.kind !== 'set' || typeof item.cursorParameter !== 'string' ||
        !QUERY_NAME.test(item.cursorParameter)))
      throw fail('INPUT', 'A set cursorParameter must name its original declared query parameter.');
    seen.add(item.id); query(item.input); atomic(item.maxAtomic, 'Per-call maximum');
    integer(item.acceptIndex, 0, 31, 'acceptIndex');
    if (!['authorization', 'upfront'].includes(item.paymentFlow))
      throw fail('INPUT', 'Choose the original offer paymentFlow explicitly.');
  }
  return structuredClone(value);
}
function authorization(plan, product, page, remaining) {
  const ceiling = atomic(product.maxAtomic, 'Per-call maximum');
  return {
    intentId: plan.operationId + ':' + product.id + ':' + page,
    maxAtomic: String(ceiling < remaining ? ceiling : remaining),
    acceptIndex: product.acceptIndex, paymentFlow: product.paymentFlow,
  };
}
function expectedTerms(request) {
  return { scheme: request.expect.scheme, network: request.expect.network,
    asset: request.expect.asset, payTo: request.expect.payTo,
    paymentFlow: request.expect.paymentFlow, maxTimeoutSeconds: request.expect.maxTimeoutSeconds };
}
function inspectBindings(generated, plan) {
  if (typeof generated?.createSellerClient !== 'function' || typeof generated?.buildRequest !== 'function' ||
      !Array.isArray(generated.operations) || !/^[a-f0-9]{64}$/.test(generated.source?.sourceSha256 ?? ''))
    throw fail('CLIENT', 'Load the original complete generated seller client.');
  const terms = [];
  for (const item of plan.products) {
    const operation = generated.operations.find(row => row.id === item.id);
    if (!operation || operation.method !== 'GET')
      throw fail('CLIENT', 'The generated seller does not expose the selected read product: ' + item.id);
    const request = generated.buildRequest(item.id, { query: item.input },
      authorization(plan, item, 0, atomic(plan.budget.maxAtomic, 'Aggregate maximum')));
    const selected = operation.offer.accepts[item.acceptIndex];
    if (BigInt(selected.amount) > atomic(item.maxAtomic, 'Per-call maximum'))
      throw fail('BUDGET', 'The saved ' + item.id + ' price exceeds its explicit per-call ceiling.');
    terms.push({ id: item.id, query: selectedQuery(item), kind: item.kind,
      ...(item.kind === 'set' ? { cursorParameter: selectedCursor(item) } : {}),
      path: operation.path, ...expectedTerms(request), advertisedAtomic: selected.amount });
  }
  const currencies = new Set(terms.map(row => JSON.stringify([row.network, row.asset])));
  if (currencies.size !== 1)
    throw fail('BUDGET', 'One aggregate atomic budget requires the same network and asset for all selected products.');
  return terms;
}
async function readLocalJson(path, maximum = 32 * 1024 * 1024) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > maximum)
      throw fail('FILE', 'Read a complete bounded original JSON file: ' + path);
    const bytes = await file.readFile();
    if (bytes.length !== info.size) throw fail('FILE', 'Original file changed while reading: ' + path);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await file.close(); }
}
async function saveManifest(directory, manifest) {
  const temporary = join(directory, '.customer-export-' + randomUUID());
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(json(manifest)); await file.sync(); await file.close(); file = null;
    await rename(temporary, join(directory, 'customer-export.json'));
    if (process.platform !== 'win32') {
      const parent = await open(directory, 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    }
  } finally {
    if (file) await file.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
async function readResponse(directory, descriptor, maximum) {
  if (!/^[A-Za-z0-9_-]{1,80}-[0-9]{6}\.json$/.test(descriptor?.name ?? '') ||
      !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1 || descriptor.bytes > maximum ||
      !/^[a-f0-9]{64}$/.test(descriptor.sha256 ?? ''))
    throw fail('FILE', 'Invalid original response descriptor.');
  const file = await open(join(directory, descriptor.name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== descriptor.bytes)
      throw fail('FILE', 'The complete response file size changed: ' + descriptor.name);
    const bytes = await file.readFile();
    if (bytes.length !== descriptor.bytes || sha(bytes) !== descriptor.sha256)
      throw fail('FILE', 'The complete response file identity changed: ' + descriptor.name);
    return bytes;
  } finally { await file.close(); }
}
function resultView(result) {
  const ids = {};
  for (const name of ['x-request-id', 'x-sf30-request-id', 'x-correlation-id']) {
    const value = result?.response?.headers?.get(name);
    if (value !== null && value !== undefined) ids[name] = value;
  }
  return {
    intentId: result?.intentId, ...(result?.requestId === undefined ? {} : { requestId: result.requestId }),
    status: result?.status, resource: result?.resource, httpStatus: result?.httpStatus,
    attempts: result?.attempts, settlement: result?.settlement, receipt: result?.receipt,
    reason: result?.reason, requirement: result?.requirement, responseRequestIds: ids,
  };
}
function decodePage(bytes, product) {
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!plain(data) || data.schema !== RESULT_SCHEMA || data.query !== selectedQuery(product) || data.kind !== product.kind ||
      !Array.isArray(data.columns) || !Array.isArray(data.rows) ||
      !Number.isSafeInteger(data.rowCount) || data.rowCount !== data.rows.length ||
      typeof data.truncated !== 'boolean')
    throw fail('RESULT', 'The saved response is not the selected original Redis result.');
  if (has(data, 'nextInput')) query(data.nextInput);
  if (product.kind === 'set') {
    if (typeof data.scanCursor !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(data.scanCursor) ||
        BigInt(data.scanCursor) > 18446744073709551615n || data.scanComplete !== (data.scanCursor === '0') ||
        data.truncated !== !data.scanComplete || data.iterationConsistency !== 'native-sscan' ||
        data.duplicatesPossible !== true || data.scanComplete && has(data, 'nextInput') ||
        has(data, 'nextInput') && data.nextInput[selectedCursor(product)] !== data.scanCursor)
      throw fail('RESULT', 'Retain the native set cursor, completion and duplicate-member semantics.');
  }
  if (!data.truncated && has(data, 'nextInput'))
    throw fail('RESULT', 'The response supplies a continuation after declaring this read complete.');
  return data;
}
function errorView(error) {
  return { code: error?.code ?? error?.name ?? 'ERROR',
    ...(typeof error?.paymentSent === 'boolean' ? { paymentSent: error.paymentSent } : {}),
    ...(error?.partialPath ? { partialPath: error.partialPath, bytes: error.bytes ?? 0 } : {}) };
}
/** Read the existing exported operation and its whole response files. This makes no seller call. */
export async function inspectCustomerExport({ directory } = {}) {
  directory = resolve(directory);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw fail('FILE', 'Select the original customer export directory.');
  const manifest = await readLocalJson(join(directory, 'customer-export.json'));
  if (manifest.schema !== SCHEMA || !Array.isArray(manifest.calls)) throw fail('FILE', 'Invalid original customer export.');
  const plan = validateCustomerExportPlan(manifest.plan);
  if (sha(json(plan)) !== manifest.planSha256) throw fail('FILE', 'The original customer plan identity changed.');
  for (const call of manifest.calls) if (call.file)
    await readResponse(directory, call.file, plan.response.maxBytes);
  return manifest;
}
/**
 * One explicitly budgeted customer operation. Use the customer's existing buyer,
 * approval and official signer. The output manifest retains application progress;
 * the existing buyer remains responsible for its wallet, intent and receipt state.
 */
export async function runCustomerExport({ generated, clientManifest, buyer, approve, sign,
  prepareBuyerResponseFile, plan: input, directory, signal } = {}) {
  const plan = validateCustomerExportPlan(input);
  const terms = inspectBindings(generated, plan);
  if (!buyer || typeof buyer.call !== 'function' || typeof approve !== 'function' || typeof sign !== 'function' ||
      typeof prepareBuyerResponseFile !== 'function')
    throw fail('BUYER', 'Supply the existing buyer, approval, official signer and original response-file writer.');
  if (!clientManifest || clientManifest.sourceSha256 !== generated.source.sourceSha256 ||
      !/^[a-f0-9]{64}$/.test(clientManifest.filesSha256 ?? ''))
    throw fail('CLIENT', 'Keep the complete original generated-client manifest with this application.');
  directory = resolve(directory);
  // One directory is one original business operation. Opening it again is read-only.
  await mkdir(directory, { mode: 0o700 });
  const client = generated.createSellerClient({ buyer });
  const manifest = {
    schema: SCHEMA, operationId: plan.operationId, status: 'RUNNING', startedAt: new Date().toISOString(),
    source: { ...generated.source, filesSha256: clientManifest.filesSha256 },
    planSha256: sha(json(plan)), plan, terms,
    budget: { maxCalls: plan.budget.maxCalls, maxAtomic: plan.budget.maxAtomic,
      callsUsed: 0, authorizationCeilingsAtomic: '0', observedRequirementAtomic: '0' },
    products: plan.products.map(item => ({ id: item.id, query: selectedQuery(item), kind: item.kind,
      ...(item.kind === 'set' ? { cursorParameter: selectedCursor(item) } : {}), status: 'READY',
      pages: 0, rows: 0, nextInput: structuredClone(item.input) })),
    calls: [],
  };
  await saveManifest(directory, manifest);
  try {
    // Round-robin gives every selected product its first page before continuing any feed.
    while (manifest.products.some(item => item.status === 'READY')) {
      for (let index = 0; index < manifest.products.length; index++) {
        const progress = manifest.products[index], product = plan.products[index];
        if (progress.status !== 'READY') continue;
        signal?.throwIfAborted();
        if (manifest.budget.callsUsed >= plan.budget.maxCalls) { manifest.status = 'CALL_BUDGET_REACHED'; break; }
        const remaining = BigInt(plan.budget.maxAtomic) - BigInt(manifest.budget.authorizationCeilingsAtomic);
        const auth = authorization(plan, product, progress.pages, remaining);
        const selected = generated.operations.find(item => item.id === product.id).offer.accepts[product.acceptIndex];
        if (BigInt(selected.amount) > BigInt(auth.maxAtomic)) { manifest.status = 'PAYMENT_BUDGET_REACHED'; break; }
        const pageInput = structuredClone(progress.nextInput);
        const request = generated.buildRequest(product.id, { query: pageInput }, auth);
        const name = product.id + '-' + String(progress.pages).padStart(6, '0') + '.json';
        const destination = join(directory, name);
        const writer = await prepareBuyerResponseFile({
          destination, maxBytes: plan.response.maxBytes, timeoutMs: plan.response.timeoutMs,
          expectedContentType: 'application/json', reservationTag: sha(auth.intentId).slice(0,48),
        });
        const call = {
          index: manifest.calls.length, product: product.id, page: progress.pages, intentId: auth.intentId,
          phase: 'PREPARED', input: pageInput,
          request: { url: request.url, method: request.method, expect: request.expect },
          output: { name, destination, partialPath: writer.partialPath },
        };
        manifest.calls.push(call);
        try {
          // Retain the exact original request/intent and budget before its single delegation.
          call.phase = 'INVOKING'; call.invokingAt = new Date().toISOString();
          manifest.budget.callsUsed++;
          manifest.budget.authorizationCeilingsAtomic =
            String(BigInt(manifest.budget.authorizationCeilingsAtomic) + BigInt(auth.maxAtomic));
          await saveManifest(directory, manifest);
          const result = await client.call(product.id, { query: pageInput }, { ...auth, approve, sign, signal });
          call.phase = 'RETURNED'; call.returnedAt = new Date().toISOString(); call.result = resultView(result);
          await saveManifest(directory, manifest);
          // Save the unread full response before decoding any rows or following a cursor.
          if (result?.response?.ok) {
            const file = await writer.save(result, { signal });
            call.file = { name, bytes: file.bytes, sha256: file.sha256, contentType: file.contentType,
              cleanupWarnings: file.cleanupWarnings };
            call.phase = 'RESPONSE_SAVED'; await saveManifest(directory, manifest);
          }
          // Interpret returned identity and payment metadata after retaining its complete response.
          if (result?.intentId !== auth.intentId) throw fail('IDENTITY', 'The buyer returned a different original intent.');
          if (result?.requirement?.amount !== undefined) {
            atomic(result.requirement.amount, 'Returned requirement');
            manifest.budget.observedRequirementAtomic =
              String(BigInt(manifest.budget.observedRequirementAtomic) + BigInt(result.requirement.amount));
          }
          if (!SUCCESS.has(result?.status) || !call.file) {
            progress.status = 'BUYER_REVIEW'; manifest.status = 'BUYER_REVIEW';
            call.phase = 'BUYER_REVIEW'; break;
          }
          const bytes = await readResponse(directory, call.file, plan.response.maxBytes);
          const data = decodePage(bytes, product);
          call.data = { schema: data.schema, query: data.query, kind: data.kind, rowCount: data.rowCount, truncated: data.truncated,
            ...(has(data, 'nextInput') ? { nextInput: structuredClone(data.nextInput) } : {}),
            ...(has(data, 'continuationUnavailable') ? { continuationUnavailable: data.continuationUnavailable } : {}),
            ...(product.kind === 'set' ? { scanCursor: data.scanCursor, scanComplete: data.scanComplete,
              iterationConsistency: data.iterationConsistency, duplicatesPossible: data.duplicatesPossible } : {}),
          };
          progress.pages++; progress.rows += data.rowCount; call.phase = 'COMPLETE';
          if (has(data, 'nextInput')) {
            // Preserve empty SSCAN pages, repeated members and all exact textual offsets/IDs.
            progress.nextInput = structuredClone(data.nextInput);
          } else {
            delete progress.nextInput;
            progress.status = data.truncated ? 'SOURCE_LIMIT_REACHED' : 'COMPLETE';
            if (data.truncated) progress.continuationUnavailable = data.continuationUnavailable ?? 'NO_NEXT_INPUT';
          }
          await saveManifest(directory, manifest);
        } catch (error) {
          call.error = errorView(error); call.phase = call.file ? 'SAVED_RESPONSE_REVIEW' : 'CALL_REVIEW';
          progress.status = 'REVIEW'; manifest.status = 'REVIEW';
          await saveManifest(directory, manifest);
          throw error;
        } finally { await writer.abort(); }
        if (manifest.status !== 'RUNNING') break;
      }
      if (manifest.status !== 'RUNNING') break;
    }
    if (manifest.status === 'RUNNING')
      manifest.status = manifest.products.every(item => item.status === 'COMPLETE') ? 'COMPLETE' : 'SOURCE_LIMIT_REACHED';
    manifest.finishedAt = new Date().toISOString();
    await saveManifest(directory, manifest);
    return { directory, ...manifest };
  } catch (error) {
    manifest.status = signal?.aborted ? 'CANCELLED_REVIEW' : 'REVIEW';
    manifest.error = errorView(error); manifest.finishedAt = new Date().toISOString();
    try { await saveManifest(directory, manifest); }
    catch (saveError) { error.manifestSaveError = errorView(saveError); }
    error.exportDirectory = directory; error.customerExport = manifest;
    throw error;
  }
}

const USAGE = 'node customer-export.mjs review|run --sdk-root STARFORGE_ROOT --client GENERATED_CLIENT --plan PLAN.json --out NEW_EXPORT [--buyer-context EXISTING_BUYER.mjs]\n' +
  'node customer-export.mjs status --out ORIGINAL_EXPORT';
export async function main(args = process.argv.slice(2)) {
  const command = args[0], allowed = command === 'status' ? ['--out'] :
    ['--sdk-root', '--client', '--plan', '--out', '--buyer-context'];
  if (!['review', 'run', 'status'].includes(command)) throw new TypeError(USAGE);
  const options = new Map();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!allowed.includes(flag) || options.has(flag) || !value || value.startsWith('--')) throw new TypeError(USAGE);
    options.set(flag, value);
  }
  if (!options.has('--out')) throw new TypeError(USAGE);
  let result;
  if (command === 'status') result = await inspectCustomerExport({ directory: options.get('--out') });
  else {
    for (const required of ['--sdk-root', '--client', '--plan']) if (!options.has(required)) throw new TypeError(USAGE);
    const sdkRoot = resolve(options.get('--sdk-root')), clientDirectory = resolve(options.get('--client'));
    const { inspectSellerClientExport } = await import(pathToFileURL(join(sdkRoot, 'sf30-seller-sdk/developer/client-export.mjs')));
    const inspected = await inspectSellerClientExport({ directory: clientDirectory });
    if (inspected.state !== 'COMPLETE') throw fail('CLIENT', 'Complete the original generated client export before using it.');
    const generated = await import(pathToFileURL(join(clientDirectory, 'seller-client.mjs')));
    if (generated.source.sourceSha256 !== inspected.sourceSha256)
      throw fail('CLIENT', 'Loaded client and saved original OpenAPI identity differ.');
    const plan = validateCustomerExportPlan(await readLocalJson(resolve(options.get('--plan')), 1024 * 1024));
    const terms = inspectBindings(generated, plan);
    result = { status: 'REVIEWED', source: generated.source, filesSha256: inspected.filesSha256, terms, plan,
      outputDirectory: resolve(options.get('--out')) };
    if (command === 'run') {
      if (!options.has('--buyer-context')) throw new TypeError(USAGE);
      const adapter = await import(pathToFileURL(resolve(options.get('--buyer-context'))));
      if (typeof adapter.createBuyerContext !== 'function') throw fail('BUYER', 'Export createBuyerContext from the existing buyer adapter.');
      const context = await adapter.createBuyerContext({ sdkRoot, source: generated.source, plan });
      const { prepareBuyerResponseFile } = await import(pathToFileURL(join(sdkRoot, 'sf31-buyer-client/response-file.mjs')));
      try {
        result = await runCustomerExport({ generated, clientManifest: inspected.manifest,
          buyer: context.buyer, approve: context.approve, sign: context.sign, signal: context.signal,
          prepareBuyerResponseFile, plan, directory: options.get('--out') });
      } finally { if (typeof context?.close === 'function') await context.close(); }
    }
  }
  process.stdout.write(json(result));
  if (command === 'run' && result.status !== 'COMPLETE') process.exitCode = 2;
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(json({ code: error.code ?? error.name, message: error.message,
      ...(error.exportDirectory ? { exportDirectory: error.exportDirectory } : {}),
      ...(error.customerExport ? { status: error.customerExport.status, callsUsed: error.customerExport.budget.callsUsed } : {}) }));
    process.exitCode = 1;
  });
}
