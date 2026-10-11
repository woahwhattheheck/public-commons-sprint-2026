// MIT. A saved Tenderly simulation product on the original SF30 merchant.
import { createHash } from 'node:crypto';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { unlink, lstat, readdir, realpath } from 'node:fs/promises';
import { compileHttpSellerOffer, normalizeSellerPaymentOptions } from '../../sf30-seller-sdk/seller.mjs';
import { compileSellerRoutes } from '../../sf30-seller-sdk/resource-server.mjs';
import { compileSellerOpenApi } from '../../sf30-seller-sdk/developer-portal.mjs';
import { exportSellerClient, inspectSellerClientExport, adoptSellerClientExport } from '../../sf30-seller-sdk/developer/client-export.mjs';
import { generateSellerClient } from '../../sf30-seller-sdk/developer/client-generator.mjs';
import { canonicalOperationJSON } from '../../sf30-seller-sdk/upstream-idempotency.mjs';
import { privateDirectory, newDirectory, readBytes, writeNew, syncDirectory, json, parse, fileBinding } from '../../sf102-cube-paid-query-adapter/onboarding/files.mjs';

export const PLAN_SCHEMA = 'stellar-forge.tenderly-merchant-plan.v1';
export const REVIEW_SCHEMA = 'stellar-forge.tenderly-merchant-review.v1';
export const PREPARED_SCHEMA = 'stellar-forge.tenderly-prepared.v1';
export const ROUTE_ID = 'tenderly-simulation';
export const HANDLER = 'tenderlySimulation';
export const ADMISSION = 'admitTenderlySimulation';
export const TICKET_HEADER = 'x-merchant-operation';
export const PROVIDER_ORIGIN = 'https://api.tenderly.co';
export const CONTRACT_SOURCE = 'https://docs.tenderly.co/simulations/single-simulations';
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const hash = x => createHash('sha256').update(x).digest('hex');
const allowed = (x, fields, name) => {
  if (!plain(x) || Object.keys(x).some(k => !fields.includes(k))) throw new TypeError('Invalid ' + name);
};
function integer(x, fallback, min, max, name) {
  const value = x ?? fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError('Invalid ' + name);
  return value;
}
function envName(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || value.length > 128) throw new TypeError('Invalid ' + name + ' environment reference');
  return value;
}
function fixedPath(value) {
  if (typeof value !== 'string' || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value) || value.length > 256 || value.startsWith('/_seller')) throw new TypeError('Use one fixed public route path');
  return value;
}

export function templatePlan() {
  return { schema: PLAN_SCHEMA, serviceName: 'Tenderly saved simulation',
    publicOrigin: 'https://merchant.example', routePath: '/evm/simulate',
    provider: { account: 'YOUR_ACCOUNT', project: 'YOUR_PROJECT', accessKeyEnv: 'TENDERLY_ACCESS_KEY' },
    networkId: '1', simulationType: 'quick',
    payment: { scheme: 'exact', network: 'stellar:testnet', asset: 'UNVERIFIED_DEMO_ASSET',
      payTo: 'UNVERIFIED_DEMO_RECIPIENT', amount: '10000', maxTimeoutSeconds: 180 },
    operations: { scope: 'tenderly-simulation-v1', keyEnv: 'TENDERLY_OPERATION_KEY', maxTicketSeconds: 86400,
      maxEntries: 10000, maxStoredBytes: 268435456, waitMs: 15000 },
    limits: { maxGas: 30000000, maxInputBytes: 65536, maxResponseBytes: 1048576, timeoutMs: 60000, maxInFlight: 8 } };
}

function normalizePlan(raw) {
  allowed(raw, ['schema', 'serviceName', 'publicOrigin', 'routePath', 'provider', 'networkId', 'simulationType', 'payment', 'operations', 'limits'], 'Tenderly merchant plan');
  if (raw.schema !== PLAN_SCHEMA) throw new TypeError('Expected ' + PLAN_SCHEMA);
  allowed(raw.provider, ['account', 'project', 'accessKeyEnv'], 'Tenderly provider');
  for (const key of ['account', 'project']) if (typeof raw.provider[key] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(raw.provider[key])) throw new TypeError('Invalid Tenderly ' + key + ' slug');
  const origin = new URL(raw.publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== raw.publicOrigin || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new TypeError('publicOrigin must be an exact HTTPS origin');
  if (typeof raw.serviceName !== 'string' || !/^[\x20-\x7e]{1,32}$/.test(raw.serviceName) || !raw.serviceName.trim()) throw new TypeError('serviceName must be 1–32 printable ASCII characters');
  if (typeof raw.networkId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(raw.networkId) || !['quick', 'abi', 'full'].includes(raw.simulationType)) throw new TypeError('Select a numeric string EVM networkId and quick, abi or full simulationType');
  allowed(raw.payment, ['scheme', 'network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds', 'extra'], 'Stellar payment terms');
  const payment = normalizeSellerPaymentOptions({ payment: raw.payment })[0];
  if (payment.extra?.paymentFlow === 'upfront') throw new TypeError('Saved simulation product uses authorization flow: complete the result before settlement');
  allowed(raw.operations, ['scope', 'keyEnv', 'maxTicketSeconds', 'maxEntries', 'maxStoredBytes', 'waitMs'], 'merchant operations');
  if (typeof raw.operations.scope !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(raw.operations.scope)) throw new TypeError('Use a stable merchant operation scope');
  allowed(raw.limits, ['maxGas', 'maxInputBytes', 'maxResponseBytes', 'timeoutMs', 'maxInFlight'], 'simulation limits');
  const limits = {
    maxGas: integer(raw.limits.maxGas, 30000000, 21000, 1000000000, 'maxGas'),
    maxInputBytes: integer(raw.limits.maxInputBytes, 65536, 1, 262144, 'maxInputBytes'),
    maxResponseBytes: integer(raw.limits.maxResponseBytes, 1048576, 1024, 1048576, 'maxResponseBytes'),
    timeoutMs: integer(raw.limits.timeoutMs, 60000, 100, 120000, 'timeoutMs'),
    maxInFlight: integer(raw.limits.maxInFlight, 8, 1, 256, 'maxInFlight') };
  return { schema: PLAN_SCHEMA, serviceName: raw.serviceName, publicOrigin: origin.origin,
    routePath: fixedPath(raw.routePath), provider: { account: raw.provider.account, project: raw.provider.project,
      accessKeyEnv: envName(raw.provider.accessKeyEnv, 'access key') }, networkId: raw.networkId,
    simulationType: raw.simulationType, payment, operations: { scope: raw.operations.scope,
      keyEnv: envName(raw.operations.keyEnv, 'operation key'),
      maxTicketSeconds: integer(raw.operations.maxTicketSeconds, 86400, 1, 604800, 'maxTicketSeconds'),
      maxEntries: integer(raw.operations.maxEntries, 10000, 1, 1000000, 'maxEntries'),
      maxStoredBytes: integer(raw.operations.maxStoredBytes, 268435456, limits.maxResponseBytes, 17179869184, 'maxStoredBytes'),
      waitMs: integer(raw.operations.waitMs, 15000, 1, 120000, 'waitMs') }, limits };
}

export function inspectPlan(raw) {
  const plan = normalizePlan(raw);
  const path = '/api/v1/account/' + plan.provider.account + '/project/' + plan.provider.project + '/simulate';
  return { schema: REVIEW_SCHEMA, plan, planSha256: hash(canonicalOperationJSON(plan)),
    serviceName: plan.serviceName, publicOrigin: plan.publicOrigin,
    route: { id: ROUTE_ID, method: 'POST', path: plan.routePath, url: plan.publicOrigin + plan.routePath },
    provider: { origin: PROVIDER_ORIGIN, path, ...plan.provider }, networkId: plan.networkId,
    simulationType: plan.simulationType, payment: plan.payment, operations: plan.operations,
    limits: plan.limits, requiredEnvironment: [plan.provider.accessKeyEnv, plan.operations.keyEnv] };
}

export function exampleRequest() {
  return { block_number: 16533883, transaction_index: 0,
    from: '0xe2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2',
    to: '0x6b175474e89094c44da98b954eedeac495271d0f', input: '0x18160ddd', gas: 100000, value: '0' };
}

export function providerRequest(rawPlan, body) {
  const plan = normalizePlan(rawPlan);
  allowed(body, ['block_number', 'transaction_index', 'from', 'to', 'input', 'gas', 'value'], 'simulation request');
  for (const key of ['block_number', 'transaction_index']) integer(body[key], undefined, 0, Number.MAX_SAFE_INTEGER, key);
  for (const key of ['from', 'to']) if (!/^0x[0-9a-fA-F]{40}$/.test(body[key] ?? '')) throw new TypeError('Use a complete EVM ' + key + ' address');
  if (typeof body.input !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(body.input) || (body.input.length - 2) / 2 > plan.limits.maxInputBytes) throw new TypeError('input must be complete hex bytes within maxInputBytes');
  integer(body.gas, undefined, 1, plan.limits.maxGas, 'simulation gas');
  if (typeof body.value !== 'string' || !/^(?:0|[1-9][0-9]{0,77})$/.test(body.value) || BigInt(body.value) >= (1n << 256n)) throw new TypeError('value must be an exact unsigned uint256 decimal string');
  return { network_id: plan.networkId, block_number: body.block_number, transaction_index: body.transaction_index,
    from: body.from, to: body.to, input: body.input, gas: body.gas, value: body.value,
    gas_price: 0, simulation_type: plan.simulationType, save: true, save_if_fails: true };
}

export function requestSchema(rawPlan) {
  const plan = normalizePlan(rawPlan);
  return { type: 'object', additionalProperties: false,
    required: ['block_number', 'transaction_index', 'from', 'to', 'input', 'gas', 'value'], properties: {
      block_number: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'Explicit historical EVM block; no relative block or moving latest selection.' },
      transaction_index: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: '0 selects the start of this block; the actual transaction count selects its post-state.' },
      from: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' }, to: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
      input: { type: 'string', pattern: '^0x([0-9a-fA-F]{2})*$', maxLength: 2 + 2 * plan.limits.maxInputBytes },
      gas: { type: 'integer', minimum: 1, maximum: plan.limits.maxGas },
      value: { type: 'string', pattern: '^(0|[1-9][0-9]{0,77})$', description: 'Exact uint256 decimal amount; the runtime enforces the uint256 maximum.' } } };
}

export function sellerConfig(rawPlan) {
  const plan = normalizePlan(rawPlan);
  const offer = compileHttpSellerOffer({ url: plan.publicOrigin + plan.routePath, method: 'POST',
    serviceName: plan.serviceName, tags: ['stellar', 'x402', 'tenderly', 'simulation'],
    description: 'Saved EVM transaction simulation at the explicit block and transaction position',
    bodyType: 'json', body: exampleRequest(), payment: plan.payment });
  offer.extensions.bazaar.schema.properties.input.properties.body = requestSchema(plan);
  return { schema: 'stellar-forge.seller-service.v1', publicOrigin: plan.publicOrigin,
    maxRequestBytes: 2 * plan.limits.maxInputBytes + 4096,
    handlerTimeoutMs: plan.limits.timeoutMs + 5000,
    requestTimeoutMs: Math.max(180000, plan.limits.timeoutMs + plan.operations.waitMs + 30000),
    routes: [{ id: ROUTE_ID, path: plan.routePath, offer, handler: HANDLER, admit: ADMISSION, validateInput: true }] };
}

function responseContract(plan) {
  return { schema: 'stellar-forge.upstream-response-contract.v1', method: 'POST', responses: {
    '200': { content: { 'application/json': { type: 'object', required: ['simulation', 'transaction'], properties: {
      simulation: { type: 'object', required: ['id', 'network_id', 'block_number', 'transaction_index', 'from', 'to', 'input', 'gas', 'value', 'status'], properties: {
        id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' },
        network_id: { type: 'string', const: plan.networkId }, block_number: { type: 'integer', minimum: 0 },
        transaction_index: { type: 'integer', minimum: 0 }, from: { type: 'string' }, to: { type: 'string' },
        input: { type: 'string' }, gas: { type: 'integer', minimum: 1 }, value: { type: 'string' }, status: { type: 'boolean' } } },
      transaction: { type: 'object', required: ['status'], properties: { status: { type: 'boolean' } } } } } } } } };
}

export function upstreamBindings(rawPlan, { stateDirectory, upstreamOrigin = PROVIDER_ORIGIN, allowLoopbackUpstream = false } = {}) {
  const review = inspectPlan(rawPlan), plan = review.plan;
  if (typeof stateDirectory !== 'string' || !isAbsolute(stateDirectory) || resolve(stateDirectory) !== stateDirectory) throw new TypeError('Use an absolute canonical operation stateDirectory');
  if (upstreamOrigin !== PROVIDER_ORIGIN) {
    const local = new URL(upstreamOrigin);
    if (!allowLoopbackUpstream || local.protocol !== 'http:' || local.hostname !== '127.0.0.1' || local.origin !== upstreamOrigin) throw new TypeError('The provider override requires an explicit loopback development origin');
  }
  return { schema: 'stellar-forge.seller-upstreams.v1', bindings: { [HANDLER]: {
    origin: upstreamOrigin, path: review.provider.path, method: 'POST',
    headerEnv: { 'X-Access-Key': plan.provider.accessKeyEnv }, responseMode: 'json',
    responseHeaders: ['content-type'], maxRequestBytes: 2 * plan.limits.maxInputBytes + 4096,
    maxResponseBytes: plan.limits.maxResponseBytes, timeoutMs: plan.limits.timeoutMs, maxInFlight: plan.limits.maxInFlight,
    responseContract: responseContract(plan), idempotency: { ...plan.operations, stateDir: stateDirectory,
      admission: ADMISSION, requestHeader: TICKET_HEADER, backendHeader: 'idempotency-key' } } } };
}

export function describeResult(response, { plan, body } = {}) {
  if (!response || response.status < 200 || response.status > 299) return null;
  let value;
  try {
    const bytes = Buffer.isBuffer(response.body) || response.body instanceof Uint8Array ? Buffer.from(response.body) :
      Buffer.from(typeof response.body === 'string' ? response.body : canonicalOperationJSON(response.body ?? null));
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw Object.assign(new Error('TENDERLY_RESULT_INVALID'), { code: 'TENDERLY_RESULT_INVALID', status: 502 }); }
  const sim = value?.simulation;
  const invalid = () => { throw Object.assign(new Error('TENDERLY_RESULT_MISMATCH'), { code: 'TENDERLY_RESULT_MISMATCH', status: 502 }); };
  if (!plain(sim) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sim.id ?? '') || !/^[1-9][0-9]*$/.test(sim.network_id ?? '') ||
      !Number.isSafeInteger(sim.block_number) || sim.block_number < 0 || !Number.isSafeInteger(sim.transaction_index) || sim.transaction_index < 0 ||
      typeof sim.status !== 'boolean' || typeof value.transaction?.status !== 'boolean' || value.transaction.status !== sim.status) invalid();
  if (plan && sim.network_id !== normalizePlan(plan).networkId) invalid();
  if (body) {
    const expected = providerRequest(plan, body);
    for (const key of ['network_id', 'block_number', 'transaction_index', 'gas']) if (sim[key] !== expected[key]) invalid();
    for (const key of ['from', 'to', 'input']) if (typeof sim[key] !== 'string' || sim[key].toLowerCase() !== expected[key].toLowerCase()) invalid();
    try { if (BigInt(sim.value) !== BigInt(expected.value)) invalid(); } catch { invalid(); }
  }
  return { simulationId: sim.id, networkId: sim.network_id, blockNumber: sim.block_number,
    transactionIndex: sim.transaction_index, succeeded: sim.status, gasUsed: sim.gas_used ?? value.transaction.gas_used ?? null };
}

async function retainedOrNew(path, expected) {
  let retained;
  try { retained = await readBytes(path, { privateFile: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (retained !== undefined) {
    if (!retained.equals(expected)) throw new TypeError('Retained preparation file differs: ' + path);
    return;
  }
  try { await writeNew(path, expected); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await readBytes(path, { privateFile: true })).equals(expected)) throw new TypeError('Concurrent preparation file differs: ' + path);
  }
}

async function resumeClient(directory, openapi) {
  const generated = generateSellerClient(openapi);
  const payloads = { 'seller-client.mjs': Buffer.from(generated.javascript), 'seller-client.d.mts': Buffer.from(generated.declarations),
    'seller-openapi.json': openapi, 'package.json': Buffer.from(generated.packageJson), 'README.md': Buffer.from(generated.readme) };
  await privateDirectory(directory);
  // Confirm every retained byte before filling any missing file. The original
  // exporter owns both the generated source and its completion receipt.
  for (const [name, expected] of Object.entries(payloads)) {
    try {
      if (!(await readBytes(join(directory, name), { privateFile: true })).equals(expected)) throw new TypeError('Retained client source differs: ' + name);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const previous = await inspectSellerClientExport({ directory });
  if (previous.state === 'COMPLETE') return previous;
  for (const [name, expected] of Object.entries(payloads)) await retainedOrNew(join(directory, name), expected);
  await syncDirectory(directory);
  const inspected = await inspectSellerClientExport({ directory });
  return adoptSellerClientExport({ directory, expectedFilesSha256: inspected.filesSha256 });
}

export async function prepareProduct({ plan: rawPlan, out } = {}) {
  const review = inspectPlan(rawPlan), plan = review.plan;
  if (typeof out !== 'string' || !isAbsolute(out) || resolve(out) !== out) throw new TypeError('Choose a canonical absolute output directory');
  const directory = out, stateDirectory = join(directory, 'operations');
  const config = sellerConfig(plan), bindings = upstreamBindings(plan, { stateDirectory });
  const route = config.routes[0];
  const compiled = compileSellerRoutes([{ ...route, admit: () => null, handler: () => { throw new Error('Offline preparation'); } }]);
  const openapi = compileSellerOpenApi(compiled, { mode: 'NATIVE_X402' });
  openapi.paths[plan.routePath].post.description += ' Public input pins the EVM state; the merchant supplies network, save flags and private provider access. A simulation status false is a delivered revert outcome.';
  const files = { 'plan.json': json(plan), 'seller-service.json': json(config), 'upstreams.json': json(bindings),
    'openapi.json': json(openapi), 'review.json': json(review), 'request.example.json': json(exampleRequest()) };
  const manifest = { schema: PREPARED_SCHEMA, planSha256: review.planSha256,
    files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, fileBinding(bytes)])) };
  await privateDirectory(dirname(directory));
  try { await newDirectory(directory); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(directory);
  if (await realpath(directory) !== directory) throw new TypeError('Use the original canonical package directory');
  const names = await readdir(directory);
  if (names.some(name => ![...Object.keys(files), 'prepared.json', 'INCOMPLETE', 'operations', 'client', 'workspace-package.json'].includes(name)))
    throw new TypeError('Output contains unrelated files');
  // A completed package may have live operation state: reopen it without any
  // writes. A changed plan always needs a different immutable package.
  if (names.includes('prepared.json') && !names.includes('INCOMPLETE')) {
    const prepared = await readPreparedProduct(directory);
    if (prepared.planSha256 !== review.planSha256) throw new TypeError('Prepared merchant belongs to another plan');
    return prepared;
  }
  const marker = json({ schema: PREPARED_SCHEMA + '.pending', planSha256: review.planSha256 });
  for (const [name, bytes] of Object.entries({ ...files, 'prepared.json': json(manifest), INCOMPLETE: marker })) {
    try {
      if (!(await readBytes(join(directory, name), { privateFile: true })).equals(bytes)) throw new TypeError('Retained preparation file differs: ' + name);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await retainedOrNew(join(directory, 'INCOMPLETE'), marker);
  try { await newDirectory(stateDirectory); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(stateDirectory);
  for (const [name, bytes] of Object.entries(files)) await retainedOrNew(join(directory, name), bytes);
  const clientDirectory = join(directory, 'client');
  try { await lstat(clientDirectory); await resumeClient(clientDirectory, files['openapi.json']); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { await exportSellerClient({ openapi: join(directory, 'openapi.json'), out: clientDirectory }); }
    catch (concurrent) {
      if (concurrent.code !== 'EEXIST') throw concurrent;
      await resumeClient(clientDirectory, files['openapi.json']);
    }
  }
  await retainedOrNew(join(directory, 'prepared.json'), json(manifest));
  await unlink(join(directory, 'INCOMPLETE')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await syncDirectory(directory);
  return { ...manifest, directory, planFile: join(directory, 'plan.json'), serviceFile: join(directory, 'seller-service.json'),
    upstreamsFile: join(directory, 'upstreams.json'), openapiFile: join(directory, 'openapi.json'), clientDirectory, stateDirectory, review };
}

export async function readPreparedProduct(directory) {
  directory = resolve(directory); await privateDirectory(directory);
  try { await lstat(join(directory, 'INCOMPLETE')); throw new TypeError('Resume this exact plan and package to complete preparation'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const manifest = parse(await readBytes(join(directory, 'prepared.json'), { privateFile: true, max: 65536 }), 'prepared merchant');
  if (manifest.schema !== PREPARED_SCHEMA || !plain(manifest.files)) throw new TypeError('Invalid prepared merchant');
  const expected = ['plan.json', 'seller-service.json', 'upstreams.json', 'openapi.json', 'review.json', 'request.example.json'];
  if (Object.keys(manifest.files).sort().join('\n') !== expected.sort().join('\n')) throw new TypeError('Incomplete prepared merchant');
  const content = {};
  for (const name of expected) {
    const bytes = await readBytes(join(directory, name), { privateFile: true });
    const binding = fileBinding(bytes);
    if (binding.bytes !== manifest.files[name]?.bytes || binding.sha256 !== manifest.files[name]?.sha256) throw new TypeError('Prepared merchant file changed: ' + name);
    content[name] = parse(bytes, name);
  }
  const review = inspectPlan(content['plan.json']);
  if (review.planSha256 !== manifest.planSha256) throw new TypeError('Prepared merchant plan changed');
  return { ...manifest, directory, plan: review.plan, review, stateDirectory: join(directory, 'operations'),
    planFile: join(directory, 'plan.json'), serviceFile: join(directory, 'seller-service.json'), upstreamsFile: join(directory, 'upstreams.json'),
    openapiFile: join(directory, 'openapi.json'), clientDirectory: join(directory, 'client') };
}
