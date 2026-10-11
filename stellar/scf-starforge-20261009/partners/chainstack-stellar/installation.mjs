// MIT. Chainstack installation using the original Stellar merchant and buyer runtimes.
import { open, readFile, lstat, realpath, mkdir, readdir, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { prepareProduct, readPlan, credentialReferences } from '../../sf30-seller-sdk/jsonrpc/config.mjs';
import { preparePackage, prepareBuyerReview } from '../../sf30-seller-sdk/jsonrpc/cli.mjs';
import { createStellarRpcApplication } from '../../sf30-seller-sdk/jsonrpc/application.mjs';
import { admitRequest } from '../../sf30-seller-sdk/jsonrpc/stellar.mjs';
import { compileSellerRoutes } from '../../sf30-seller-sdk/resource-server.mjs';
import { compileSellerOpenApi } from '../../sf30-seller-sdk/developer-portal.mjs';
import { exportSellerClient, inspectSellerClientExport } from '../../sf30-seller-sdk/developer/client-export.mjs';
import { initReleaseStore, stageRelease, inspectRelease, readReleaseState, releaseStatus,
  activateRelease, rollbackRelease, compareReleases, runActiveRelease } from '../../sf82-seller-pilot/releases.mjs';
import { generate as generateHost } from '../../sf99-merchant-deploy/host.mjs';

export const SCHEMA = 'stellar-forge.chainstack-installation.v1';
export const METHODS = Object.freeze(['getTransaction', 'getEvents', 'getLedgerEntries']);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const hash = raw => createHash('sha256').update(raw).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const fail = code => Object.assign(new Error(code), { code });
const need = (condition, code) => { if (!condition) throw fail(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed, code) => need(object(value) && Object.keys(value).every(key => allowed.includes(key)), code);
const id = value => {
  need(typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value), 'CHAINSTACK_ID_INVALID');
  return value;
};
const path = value => {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' &&
    !/[\\\x00-\x1f\x7f]/.test(value), 'CHAINSTACK_ABSOLUTE_PATH_REQUIRED');
  return value;
};
async function directory(value) {
  value = path(value); const stat = await lstat(value);
  need(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(value) === value &&
    !(stat.mode & 0o077), 'CHAINSTACK_PRIVATE_DIRECTORY_REQUIRED');
  return value;
}
async function bytes(file, maximum = 1048576) {
  const handle = await open(path(file), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    need(stat.isFile() && stat.size <= maximum, 'CHAINSTACK_BOUNDED_FILE_REQUIRED');
    const raw = await handle.readFile();
    need(raw.length === stat.size && raw.length <= maximum, 'CHAINSTACK_FILE_CHANGED');
    return raw;
  } finally { await handle.close(); }
}
export async function readJSON(file) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(file)));
}
async function save(file, raw) {
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
}
const saveJSON = (file, value) => save(file, json(value));
async function names(folder) { return (await readdir(folder)).filter(value => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)).sort(); }

/** Public configuration contains credential references; only the native runtime opens their values. */
export function validateInstallation(input) {
  fields(input, ['schema', 'merchant', 'plan', 'runtime'], 'CHAINSTACK_INSTALLATION_FIELDS_INVALID');
  need(input.schema === SCHEMA, 'CHAINSTACK_INSTALLATION_SCHEMA_INVALID');
  const merchant = id(input.merchant);
  need(/^[a-z][a-z0-9-]{0,39}$/.test(merchant), 'CHAINSTACK_MERCHANT_ID_INVALID');
  const { plan } = prepareProduct(input.plan);
  need(plan.operations.length === METHODS.length && METHODS.every(method =>
    plan.operations.some(row => row.method === method)), 'CHAINSTACK_THREE_ORIGINAL_METHODS_REQUIRED');
  fields(input.runtime, ['mode', 'port', 'facilitator', 'allowLoopbackUpstream'], 'CHAINSTACK_RUNTIME_FIELDS_INVALID');
  const { mode, port } = input.runtime;
  need(['native', 'challenge'].includes(mode) && Number.isInteger(port) && port >= 1024 && port <= 65535,
    'CHAINSTACK_EXPLICIT_RUNTIME_REQUIRED');
  need(mode === 'native' ? typeof input.runtime.facilitator === 'string' : input.runtime.facilitator === undefined,
    'CHAINSTACK_RUNTIME_FACILITATOR_MISMATCH');
  need(input.runtime.allowLoopbackUpstream === undefined || typeof input.runtime.allowLoopbackUpstream === 'boolean',
    'CHAINSTACK_LOOPBACK_SELECTION_INVALID');
  if (mode === 'native') {
    const endpoint = new URL(input.runtime.facilitator);
    need(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash &&
      endpoint.href.replace(/\/$/, '') === input.runtime.facilitator.replace(/\/$/, ''), 'CHAINSTACK_FACILITATOR_INVALID');
  }
  return { schema: SCHEMA, merchant, plan, runtime: { ...input.runtime } };
}

export async function openInstallation(root) {
  root = await directory(root);
  const record = await readJSON(join(root, 'installation.json'));
  need(record.schema === SCHEMA && /^[a-z][a-z0-9-]{0,39}$/.test(record.merchant), 'CHAINSTACK_INSTALLATION_INVALID');
  const store = await directory(join(root, 'releases'));
  return { root, store, record };
}

export async function createInstallation(input, root, releaseId) {
  const spec = validateInstallation(input); root = path(root); id(releaseId);
  await directory(dirname(root));
  await mkdir(root, { mode: 0o700 });
  for (const name of ['packages', 'requests', 'observations', 'clients']) await mkdir(join(root, name), { mode: 0o700 });
  await initReleaseStore(join(root, 'releases'));
  await saveJSON(join(root, 'installation.json'), { schema: SCHEMA, merchant: spec.merchant,
    createdAt: new Date().toISOString(), source: 'ORIGINAL_SF30_JSONRPC_SF82_SF88' });
  return stageInstallation(root, spec, releaseId);
}

export async function stageInstallation(root, input, releaseId) {
  const installation = await openInstallation(root), spec = validateInstallation(input); id(releaseId);
  need(spec.merchant === installation.record.merchant, 'CHAINSTACK_MERCHANT_CHANGED');
  const packageDirectory = join(installation.root, 'packages', releaseId);
  await preparePackage(spec.plan, packageDirectory);
  await saveJSON(join(packageDirectory, 'installation-source.json'), spec);
  const release = await stageRelease(installation.store, { id: releaseId,
    label: 'Chainstack ' + spec.merchant + ' ' + releaseId, jsonrpcPackage: packageDirectory,
    runtime: { port: spec.runtime.port, ...(spec.runtime.mode === 'native' ? { facilitator: spec.runtime.facilitator } : {}),
      ...(spec.runtime.allowLoopbackUpstream === true ? { allowLoopbackUpstream: true } : {}) } });
  const client = await exportClient(installation.root, releaseId);
  return { status: 'CHAINSTACK_RELEASE_PREPARED', release, client,
    requiredEnvironment: credentialReferences(spec.plan) };
}

async function selected(root, releaseId) {
  const installation = await openInstallation(root);
  releaseId ??= (await readReleaseState(installation.store)).active;
  need(releaseId, 'CHAINSTACK_SELECT_OR_ACTIVATE_RELEASE');
  const release = await inspectRelease(installation.store, id(releaseId));
  need(release.source.kind === 'JSONRPC_MERCHANT_PACKAGE', 'CHAINSTACK_ORIGINAL_RPC_RELEASE_REQUIRED');
  const packageDirectory = join(installation.store, 'releases', releaseId, 'jsonrpc', 'package');
  const plan = await readPlan(join(packageDirectory, 'plan.json'));
  need(plan.operations.length === METHODS.length && METHODS.every(method => plan.operations.some(row => row.method === method)),
    'CHAINSTACK_THREE_ORIGINAL_METHODS_REQUIRED');
  return { ...installation, release, packageDirectory, plan };
}

/** Generate the original SF30 JavaScript/TypeScript client from the immutable selected release. */
export async function exportClient(root, releaseId) {
  const s = await selected(root, releaseId), target = join(s.root, 'clients', s.release.id);
  await mkdir(target, { mode: 0o700 });
  const { service } = prepareProduct(s.plan);
  const neverRun = () => { throw fail('CHAINSTACK_DOCUMENTATION_ONLY'); };
  const compiled = compileSellerRoutes(service.routes.map(route => ({ id: route.id, offer: route.offer,
    maxRequestBytes: route.maxRequestBytes, handler: neverRun, ...(route.admit ? { admit: neverRun } : {}) })));
  const openapi = join(target, 'seller-openapi.json');
  await saveJSON(openapi, compileSellerOpenApi(compiled, { mode: s.release.mode }));
  const client = await exportSellerClient({ openapi, out: join(target, 'javascript') });
  for (const file of ['buyer.mjs', 'buyer.py']) await copyFile(join(HERE, file), join(target, file), constants.COPYFILE_EXCL);
  await saveJSON(join(target, 'release.json'), { schema: 'stellar-forge.chainstack-client.v1',
    releaseId: s.release.id, releaseDigest: s.release.digest, source: s.release.source,
    dataNetwork: s.plan.dataNetwork, paymentNetwork: s.plan.payment.network,
    methods: METHODS, requiredRuntime: 'sf88-operator-buyer-cli', client });
  return { directory: target, releaseId: s.release.id, releaseDigest: s.release.digest, client };
}

export async function status(root) {
  const s = await openInstallation(root);
  return { schema: SCHEMA, merchant: s.record.merchant, release: await releaseStatus(s.store),
    requests: await names(join(s.root, 'requests')), observations: await names(join(s.root, 'observations')) };
}
export async function activate(root, releaseId, expectedGeneration) {
  const s = await selected(root, releaseId);
  return activateRelease(s.store, s.release.id, { expectedGeneration, reason: 'Selected Chainstack installation release' });
}
export async function rollback(root, expectedGeneration) {
  const s = await openInstallation(root);
  return rollbackRelease(s.store, { expectedGeneration, reason: 'Restore previous Chainstack installation release' });
}
export async function compare(root, before, after) {
  const s = await openInstallation(root); return compareReleases(s.store, id(before), id(after));
}
export async function run(root, expectedGeneration) {
  const s = await openInstallation(root); return runActiveRelease(s.store, { expectedGeneration });
}
export async function consoleSession(root, port = 8425) {
  const s = await openInstallation(root);
  const { startReleaseConsole } = await import('../../sf82-seller-pilot/release-console.mjs');
  return startReleaseConsole(s.store, { port });
}

/** A prepared purchase retains exact caller bytes and the original SF88 selected offer. */
export async function prepareRequest(root, { releaseId, method, bodyFile, intentId }) {
  const s = await selected(root, releaseId); id(intentId);
  need(METHODS.includes(method), 'CHAINSTACK_METHOD_INVALID');
  const raw = await bytes(path(bodyFile)), body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  const context = { method: 'POST', url: new URL(s.plan.publicOrigin + '/stellar/' + method), query: {}, body };
  need(admitRequest(method, context, s.plan.limits) === true, 'CHAINSTACK_ORIGINAL_REQUEST_CONTRACT_FAILED');
  const target = join(s.root, 'requests', intentId);
  await mkdir(target, { mode: 0o700 });
  const bodyPath = join(target, 'request.body.json'), configPath = join(target, 'buyer-config.json');
  await save(bodyPath, raw);
  await prepareBuyerReview({ package: s.packageDirectory, method, 'body-file': bodyPath, 'intent-id': intentId, out: configPath });
  const configBytes = await bytes(configPath);
  const record = { schema: 'stellar-forge.chainstack-request.v1', intentId, method,
    releaseId: s.release.id, releaseDigest: s.release.digest, dataNetwork: s.plan.dataNetwork,
    paymentNetwork: s.plan.payment.network, preparedAt: new Date().toISOString(),
    bodyFile: 'request.body.json', bodyBytes: raw.length, bodySha256: hash(raw),
    configFile: 'buyer-config.json', configBytes: configBytes.length, configSha256: hash(configBytes) };
  await saveJSON(join(target, 'request.json'), record);
  return { status: 'CHAINSTACK_BUYER_REQUEST_PREPARED', directory: target, ...record };
}

/** Explicit operator reads execute the original provider application, preserving original response bytes. */
export async function observeProvider(root, { releaseId, observationId, provider, requests }, { env = process.env } = {}) {
  const s = await selected(root, releaseId); id(observationId);
  need(typeof provider === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(provider), 'CHAINSTACK_PROVIDER_LABEL_INVALID');
  need(Array.isArray(requests) && requests.length >= 3 && requests.length <= 12 &&
    METHODS.every(method => requests.some(row => row.method === method)), 'CHAINSTACK_THREE_METHOD_INPUTS_REQUIRED');
  const entries = [], seen = new Set();
  for (const request of requests) {
    fields(request, ['id', 'method', 'bodyFile'], 'CHAINSTACK_OBSERVATION_REQUEST_INVALID'); id(request.id);
    need(!seen.has(request.id) && METHODS.includes(request.method), 'CHAINSTACK_OBSERVATION_REQUEST_INVALID'); seen.add(request.id);
    const raw = await bytes(path(request.bodyFile)), body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    const context = { method: 'POST', url: new URL(s.plan.publicOrigin + '/stellar/' + request.method),
      query: {}, pathParams: {}, headers: { 'content-type': 'application/json' }, body };
    need(admitRequest(request.method, context, s.plan.limits) === true, 'CHAINSTACK_ORIGINAL_REQUEST_CONTRACT_FAILED');
    entries.push({ request, raw, context });
  }
  const target = join(s.root, 'observations', observationId);
  await mkdir(target, { mode: 0o700 });
  const started = { schema: 'stellar-forge.chainstack-provider-observation.v1', observationId,
    provider, releaseId: s.release.id, releaseDigest: s.release.digest, dataNetwork: s.plan.dataNetwork,
    startedAt: new Date().toISOString(), transport: 'ORIGINAL_SF30_STELLAR_RPC_APPLICATION' };
  await saveJSON(join(target, 'started.json'), started);
  const results = []; let application, diagnosis, failureCode;
  try {
    application = createStellarRpcApplication(s.plan, { env,
      allowLoopbackUpstream: s.release.runtime.allowLoopbackUpstream === true });
    diagnosis = await application.diagnose();
    await saveJSON(join(target, 'diagnosis.json'), diagnosis);
    for (const { request, raw, context } of entries) {
      const bodyName = request.id + '.request.json', responseName = request.id + '.response.json';
      await save(join(target, bodyName), raw);
      const response = await application.handlers[request.method](context);
      const output = response.body instanceof Uint8Array ? Buffer.from(response.body) :
        typeof response.body === 'string' ? Buffer.from(response.body) : json(response.body);
      await save(join(target, responseName), output);
      results.push({ id: request.id, method: request.method, status: response.status,
        requestFile: bodyName, requestBytes: raw.length, requestSha256: hash(raw),
        responseFile: responseName, responseBytes: output.length, responseSha256: hash(output) });
    }
  } catch (error) {
    failureCode = typeof error.code === 'string' && /^(STELLAR_RPC|UPSTREAM)_[A-Z0-9_]+$/.test(error.code)
      ? error.code : 'CHAINSTACK_PROVIDER_OPERATION_FAILED';
  } finally { await application?.close(); }
  const manifest = { ...started, completedAt: new Date().toISOString(),
    state: failureCode || results.some(row => row.status !== 200) ? 'REQUIRES_OPERATOR_REVIEW' : 'COMPLETE',
    ...(failureCode ? { failureCode } : {}), diagnosis, results };
  await saveJSON(join(target, 'observation.json'), manifest);
  return { directory: target, ...manifest };
}

/** Reopen reads retained files only; it never repeats provider reads or buyer execution. */
export async function reopenObservation(root, observationId) {
  const s = await openInstallation(root), folder = join(s.root, 'observations', id(observationId));
  let record;
  try { record = await readJSON(join(folder, 'observation.json')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { ...(await readJSON(join(folder, 'started.json'))), state: 'INTERRUPTED', directory: folder };
  }
  need(record.schema === 'stellar-forge.chainstack-provider-observation.v1' && record.observationId === observationId,
    'CHAINSTACK_OBSERVATION_INVALID');
  for (const row of record.results) {
    id(row.id);
    for (const [kind, file] of [['request', row.id + '.request.json'], ['response', row.id + '.response.json']]) {
      need(row[kind + 'File'] === file, 'CHAINSTACK_OBSERVATION_FILE_INVALID');
      const raw = await bytes(join(folder, file));
      need(raw.length === row[kind + 'Bytes'] && hash(raw) === row[kind + 'Sha256'], 'CHAINSTACK_OBSERVATION_CHANGED');
    }
  }
  return { ...record, directory: folder };
}
export async function requestFromObservation(root, { observationId, entryId, intentId }) {
  const observation = await reopenObservation(root, observationId);
  const entry = observation.results?.find(row => row.id === entryId);
  need(entry && entry.status === 200, 'CHAINSTACK_SUCCESSFUL_OBSERVATION_ENTRY_REQUIRED');
  return prepareRequest(root, { releaseId: observation.releaseId, method: entry.method,
    bodyFile: join(observation.directory, entry.requestFile), intentId });
}

/** The host output comes from the original SF99 retained-release deployment. */
export async function exportHost(root, { serviceUser, serviceGroup, environmentFile, out, sourceRoot }) {
  const s = await selected(root), state = await readReleaseState(s.store);
  const plan = { schema: 'stellar-forge.merchant-host.v1', merchant: s.record.merchant,
    kind: 'release', mode: s.release.mode === 'NATIVE_X402' ? 'native' : 'challenge',
    serviceUser, ...(serviceGroup ? { serviceGroup } : {}), privateRoot: s.root,
    environmentFile: path(environmentFile), release: { store: s.store, expectedGeneration: state.generation } };
  const planFile = join(s.root, 'host-' + state.generation + '.json');
  await saveJSON(planFile, plan);
  return generateHost(planFile, path(out), sourceRoot ? { sourceRoot: path(sourceRoot) } : undefined);
}

export async function inspectClient(root, releaseId) {
  const s = await selected(root, releaseId);
  return inspectSellerClientExport({ directory: join(s.root, 'clients', s.release.id, 'javascript') });
}

/** Export the selected original requests and clients as one private, portable handoff. */
export async function exportHandoff(root, requestIds, out) {
  const installation = await openInstallation(root);
  need(Array.isArray(requestIds) && requestIds.length >= 1 && requestIds.length <= 12,
    'CHAINSTACK_HANDOFF_REQUESTS_REQUIRED');
  const selectedIds = requestIds.map(id);
  need(new Set(selectedIds).size === selectedIds.length, 'CHAINSTACK_HANDOFF_DUPLICATE_REQUEST');
  out = path(out);
  need(out !== installation.root && !out.startsWith(installation.root + '/'),
    'CHAINSTACK_HANDOFF_OUTSIDE_INSTALLATION_REQUIRED');
  await directory(dirname(out));
  const {
    CLIENT_EXPORT_FILES, CLIENT_EXPORT_MANIFEST, readSellerClientFile,
  } = await import('../../sf30-seller-sdk/developer/client-export.mjs');
  const payloads = new Map(), requests = [], releases = new Map();
  let totalBytes = 0;
  function retain(name, raw) {
    need(!payloads.has(name), 'CHAINSTACK_HANDOFF_DUPLICATE_FILE');
    raw = Buffer.from(raw); totalBytes += raw.length;
    need(totalBytes <= 128 * 1024 * 1024, 'CHAINSTACK_HANDOFF_SIZE_LIMIT');
    payloads.set(name, raw);
  }
  for (const intentId of selectedIds) {
    const requestDirectory = await directory(join(installation.root, 'requests', intentId));
    const recordRaw = await bytes(join(requestDirectory, 'request.json'));
    const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(recordRaw));
    need(record.schema === 'stellar-forge.chainstack-request.v1' &&
      record.intentId === intentId && METHODS.includes(record.method) &&
      record.bodyFile === 'request.body.json' && record.configFile === 'buyer-config.json',
      'CHAINSTACK_HANDOFF_REQUEST_INVALID');
    const bodyRaw = await bytes(join(requestDirectory, record.bodyFile));
    const configRaw = await bytes(join(requestDirectory, record.configFile));
    need(bodyRaw.length === record.bodyBytes && hash(bodyRaw) === record.bodySha256 &&
      configRaw.length === record.configBytes && hash(configRaw) === record.configSha256,
      'CHAINSTACK_HANDOFF_REQUEST_CHANGED');
    const s = await selected(installation.root, record.releaseId);
    need(s.release.digest === record.releaseDigest &&
      s.plan.dataNetwork === record.dataNetwork &&
      s.plan.payment.network === record.paymentNetwork, 'CHAINSTACK_HANDOFF_RELEASE_CHANGED');
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bodyRaw));
    need(admitRequest(record.method, {
      method: 'POST', url: new URL(s.plan.publicOrigin + '/stellar/' + record.method),
      query: {}, body,
    }, s.plan.limits) === true, 'CHAINSTACK_ORIGINAL_REQUEST_CONTRACT_FAILED');
    const prefix = 'requests/' + intentId + '/';
    retain(prefix + 'request.json', recordRaw);
    retain(prefix + record.bodyFile, bodyRaw);
    retain(prefix + record.configFile, configRaw);
    requests.push({ intentId, method: record.method, releaseId: record.releaseId,
      releaseDigest: record.releaseDigest, directory: 'requests/' + intentId,
      bodySha256: record.bodySha256, configSha256: record.configSha256 });
    if (releases.has(s.release.id)) continue;
    const clientDirectory = await directory(join(installation.root, 'clients', s.release.id));
    const inspected = await inspectClient(installation.root, s.release.id);
    need(inspected.state === 'COMPLETE' && inspected.manifestRetained &&
      inspected.origin === s.plan.publicOrigin && inspected.mode === s.release.mode &&
      inspected.manifestFile?.sha256, 'CHAINSTACK_HANDOFF_CLIENT_INCOMPLETE');
    const clientRecordRaw = await bytes(join(clientDirectory, 'release.json'));
    const clientRecord = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(clientRecordRaw));
    need(clientRecord.schema === 'stellar-forge.chainstack-client.v1' &&
      clientRecord.releaseId === s.release.id && clientRecord.releaseDigest === s.release.digest &&
      clientRecord.dataNetwork === s.plan.dataNetwork &&
      clientRecord.paymentNetwork === s.plan.payment.network &&
      Array.isArray(clientRecord.methods) && clientRecord.methods.length === METHODS.length &&
      METHODS.every(method => clientRecord.methods.includes(method)),
      'CHAINSTACK_HANDOFF_CLIENT_RELEASE_CHANGED');
    const clientPrefix = 'clients/' + s.release.id + '/';
    retain(clientPrefix + 'release.json', clientRecordRaw);
    const openapiRaw = await bytes(join(clientDirectory, 'seller-openapi.json'), 16 * 1024 * 1024);
    need(hash(openapiRaw) === inspected.sourceSha256, 'CHAINSTACK_HANDOFF_CLIENT_SOURCE_CHANGED');
    retain(clientPrefix + 'seller-openapi.json', openapiRaw);
    for (const filename of ['buyer.mjs', 'buyer.py'])
      retain(clientPrefix + filename, await bytes(join(clientDirectory, filename)));
    for (const filename of [...CLIENT_EXPORT_FILES, CLIENT_EXPORT_MANIFEST]) {
      const original = await readSellerClientFile({
        directory: join(clientDirectory, 'javascript'),
        file: filename, expectedManifestSha256: inspected.manifestFile.sha256,
      });
      retain(clientPrefix + 'javascript/' + filename, original.bytes);
    }
    releases.set(s.release.id, {
      releaseId: s.release.id, releaseDigest: s.release.digest,
      dataNetwork: s.plan.dataNetwork, paymentNetwork: s.plan.payment.network,
      publicOrigin: s.plan.publicOrigin, mode: s.release.mode,
      directory: 'clients/' + s.release.id,
      clientSourceSha256: inspected.sourceSha256,
      clientManifestSha256: inspected.manifestFile.sha256,
      clientFilesSha256: inspected.filesSha256,
    });
  }
  retain('BUYER.md', await bytes(join(HERE, 'BUYER.md')));
  const files = [...payloads].map(([name, raw]) => ({
    path: name, bytes: raw.length, sha256: hash(raw),
  })).sort((a, b) => a.path.localeCompare(b.path));
  const content = {
    schema: 'stellar-forge.chainstack-handoff.v1',
    merchant: installation.record.merchant, createdAt: new Date().toISOString(),
    requests, releases: [...releases.values()], files, totalBytes,
    requestPathMode: 'RETAINED_BYTES_WITH_BUYER_BODY_OVERRIDE',
  };
  const handoff = { ...content, handoffId: hash(json(content)) };
  await mkdir(out, { mode: 0o700 });
  const directories = new Set([out]);
  for (const [name, raw] of payloads) {
    const destination = join(out, name), parent = dirname(destination);
    await mkdir(parent, { mode: 0o700, recursive: true });
    directories.add(parent);
    await save(destination, raw);
  }
  // Completion is retained only after every selected original payload is written.
  await saveJSON(join(out, 'handoff.json'), handoff);
  for (const folder of [...directories].sort((a, b) => b.length - a.length)) {
    const handle = await open(folder, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }
  return { status: 'CHAINSTACK_HANDOFF_READY', directory: out,
    handoffId: handoff.handoffId, requestCount: requests.length,
    releaseCount: releases.size, fileCount: files.length,
    totalBytes, manifestFile: 'handoff.json', manifestSha256: hash(json(handoff)) };
}

