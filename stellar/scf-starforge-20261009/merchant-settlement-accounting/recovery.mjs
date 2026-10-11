// MIT. Recover a completed original SF31 purchase into private merchant accounting.
// Uses the original SF86 RPC verifier; never creates a reservation or SF98 event.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { compileTerms } from './reconcile.mjs';
import { supportsSellerMethod } from '../sf30-seller-sdk/http-methods.mjs';
import { createOfficialEventDecoder } from '../sf43-agent-commerce/verify.mjs';
import { createPublicHttpsFetch } from '../sf31-buyer-client/public-transport.mjs';

export const RECOVERY_SCHEMA = 'stellar-forge.merchant-recovered-settlement.v1';
export const RECOVERY_ORIGIN = 'RECOVERED_ORIGINAL_SF31_OUTCOME';
const CONFIG_SCHEMA = 'stellar-forge.merchant-recovery-request.v1';
const JSON_LIMIT = 200_000;
const RESPONSE_LIMIT = 64 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const need = (value, code) => { if (!value) throw new Error(code); };
const canonical = value => JSON.stringify(value, (_, v) => object(v)
  ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
const parse = bytes => { try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('RECOVERY_INVALID_JSON'); } };
const normalized = path => {
  need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path && path !== '/',
    'RECOVERY_ABSOLUTE_NORMALIZED_PATH_REQUIRED');
  return path;
};
async function directory(path, { create = false } = {}) {
  normalized(path);
  if (create) try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0,
    'RECOVERY_PRIVATE_DIRECTORY_REQUIRED');
}
async function readPrivate(path, max = JSON_LIMIT, { allowEmpty = false } = {}) {
  normalized(path);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    need(info.isFile() && (info.mode & 0o077) === 0 && info.size <= max &&
      (allowEmpty || info.size > 0), 'RECOVERY_PRIVATE_REGULAR_FILE_REQUIRED');
    const bytes = await handle.readFile();
    need(bytes.length <= max && (allowEmpty || bytes.length > 0), 'RECOVERY_SOURCE_SIZE_INVALID');
    return bytes;
  } finally { await handle.close(); }
}
async function writePrivate(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
const identity = (network, transaction) => sha(network + '\n' + transaction);

// This checks the retained client request and native outcome. It does not assert
// that a locally retained request proves an HTTP intent on the Stellar ledger.
function bindOriginalSources({ outcome, request, terms, routeId, payer }) {
  const intent = object(request?.intent) ? request.intent : request;
  need(object(outcome) && object(intent) &&
    outcome.status === 'DELIVERED_REPORTED_SETTLED' &&
    outcome.settlement === 'REPORTED_SUCCESS' &&
    Number.isSafeInteger(outcome.httpStatus) && outcome.httpStatus >= 200 && outcome.httpStatus < 300,
  'RECOVERY_COMPLETED_ORIGINAL_SF31_OUTCOME_REQUIRED');
  const q = outcome.requirement, receipt = outcome.receipt;
  need(object(q) && object(receipt) && receipt.success === true,
    'RECOVERY_NATIVE_TERMS_AND_SUCCESS_RECEIPT_REQUIRED');
  need(typeof outcome.intentId === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(outcome.intentId) &&
    intent.intentId === outcome.intentId && intent.url === outcome.resource &&
    supportsSellerMethod(intent.method), 'RECOVERY_ORIGINAL_REQUEST_MISMATCH');
  let resource;
  try { resource = new URL(outcome.resource); } catch { throw new Error('RECOVERY_INVALID_RESOURCE'); }
  need(['https:', 'http:'].includes(resource.protocol) && !resource.username && !resource.password &&
    !resource.hash && (resource.protocol === 'https:' ||
      (q.network === 'stellar:testnet' && ['127.0.0.1', '[::1]', 'localhost'].includes(resource.hostname))),
  'RECOVERY_RESOURCE_NOT_PUBLIC_HTTPS_OR_TESTNET_LOOPBACK');
  need(q.scheme === 'exact' && ['stellar:testnet', 'stellar:pubnet'].includes(q.network) &&
    ['scheme', 'network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds'].every(key => intent[key] === q[key]) &&
    object(intent.acceptedTerms) && canonical(intent.acceptedTerms) === canonical(q),
  'RECOVERY_RETAINED_ACCEPTED_TERMS_MISMATCH');
  need(typeof intent.bodyPresent === 'boolean' && Number.isSafeInteger(intent.bodyBytes) &&
    intent.bodyBytes >= 0 && intent.bodyBytes <= 1_048_576 && hex(intent.bodySha256) &&
    (intent.bodyPresent || (intent.bodyBytes === 0 && intent.bodySha256 === sha(''))) &&
    (!['GET', 'HEAD'].includes(intent.method) || !intent.bodyPresent),
  'RECOVERY_ORIGINAL_REQUEST_BODY_IDENTITY_REQUIRED');
  need(receipt.network === q.network && receipt.payer === payer && hex(receipt.transaction) &&
    (receipt.amount === undefined || receipt.amount === q.amount), 'RECOVERY_RECEIPT_TERMS_MISMATCH');
  const matches = [...compileTerms(terms).values()].filter(term => term.routeId === routeId &&
    term.method === intent.method && term.network === q.network && term.asset === q.asset &&
    term.payTo === q.payTo && term.amountAtomic === q.amount);
  need(matches.length === 1, 'RECOVERY_EXACT_MERCHANT_OPTION_REQUIRED');
  const term = matches[0];
  return { recoveryId: identity(q.network, receipt.transaction), intentId: outcome.intentId,
    routeId, method: intent.method, network: q.network, asset: q.asset, recipient: q.payTo,
    payer, amountAtomic: q.amount, transaction: receipt.transaction,
    receiptFingerprint: sha(canonical(receipt)), receiptFingerprintEncoding: 'CANONICAL_RECEIPT_JSON_SHA256',
    resource: outcome.resource, optionId: term.optionId,
    requestBody: { present: intent.bodyPresent, bytes: intent.bodyBytes, sha256: intent.bodySha256 },
    httpStatus: outcome.httpStatus,
    contentType: typeof outcome.contentType === 'string' ? outcome.contentType : null };
}
async function loadInput(configFile) {
  const config = parse(await readPrivate(configFile));
  const keys = ['schema', 'outcomeFile', 'requestFile', 'termsFile', 'routeId', 'payer',
    'rpcEndpoint', 'httpsProxyEnv', 'response'];
  need(object(config) && config.schema === CONFIG_SCHEMA && Object.keys(config).every(key => keys.includes(key)),
    'RECOVERY_INVALID_REQUEST_CONFIG');
  need(config.httpsProxyEnv === undefined ||
    (typeof config.httpsProxyEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(config.httpsProxyEnv)),
  'RECOVERY_INVALID_PROXY_ENVIRONMENT_NAME');
  const source = new Map();
  for (const [name, key] of [['outcome.json', 'outcomeFile'], ['request.json', 'requestFile'], ['terms.json', 'termsFile']])
    source.set(name, await readPrivate(config[key]));
  const outcome = parse(source.get('outcome.json'));
  const request = parse(source.get('request.json'));
  const terms = parse(source.get('terms.json'));
  const binding = bindOriginalSources({ outcome, request, terms, routeId: config.routeId, payer: config.payer });
  const { rpcNetwork, validStrKey } = await import('../sf86-rpc-transfer-reconcile/terms.mjs');
  need(validStrKey(binding.payer, 'G'), 'RECOVERY_TRUSTED_PAYER_REQUIRED');
  const profile = rpcNetwork(binding.network, config.rpcEndpoint);
  need(profile.live, 'RECOVERY_ORIGINAL_PUBLIC_RPC_REQUIRED');
  let response = null;
  if (config.response !== undefined) {
    const r = config.response;
    need(binding.method !== 'HEAD' && object(r) &&
      Object.keys(r).every(key => ['file', 'sha256', 'bytes'].includes(key)) && hex(r.sha256) &&
      Number.isSafeInteger(r.bytes) && r.bytes >= 0 && r.bytes <= RESPONSE_LIMIT,
    'RECOVERY_SAVED_RESPONSE_IDENTITY_REQUIRED');
    const bytes = await readPrivate(r.file, RESPONSE_LIMIT, { allowEmpty: true });
    need(bytes.length === r.bytes && sha(bytes) === r.sha256, 'RECOVERY_SAVED_RESPONSE_CHANGED');
    source.set('response.bin', bytes);
    response = { file: 'response.bin', sha256: r.sha256, bytes: r.bytes, contentType: binding.contentType,
      origin: 'RETAINED_ORIGINAL_SF31_RESPONSE_FILE' };
  }
  const sources = Object.fromEntries([...source].map(([name, bytes]) => [name, { sha256: sha(bytes), bytes: bytes.length }]));
  return { config, source, outcome, binding, profile, response, sources };
}
const reviewed = input => ({ schema: CONFIG_SCHEMA, origin: RECOVERY_ORIGIN, ...input.binding,
  rpcEndpoint: input.profile.endpoint, response: input.response, sources: input.sources,
  reservation: 'ABSENT_NO_SF81_RECORD', outbox: 'NO_SF98_CAPTURE_OR_ENQUEUE',
  sourceBinding: 'RETAINED_CLIENT_FILES_AND_OPERATOR_ROUTE_SELECTION',
  nextOperation: 'READ_ONLY_ORIGINAL_SF86_TRANSFER_RECONCILIATION' });

/** Offline input review: reads selected files, no SDK, keys, listener, or RPC. */
export async function reviewRecoveredSettlement({ configFile } = {}) {
  return reviewed(await loadInput(configFile));
}
function verifyProofBinding(proof, entry) {
  need(object(proof) && proof.schema === 'stellar-forge.sf86.rpc-reconciliation.v1' &&
    proof.intentId === entry.intentId && proof.transaction === entry.transaction &&
    proof.network === entry.network && proof.asset === entry.asset && proof.payer === entry.payer &&
    proof.recipient === entry.recipient && proof.atomicAmount === entry.amountAtomic,
  'RECOVERY_RETAINED_PROOF_BINDING_MISMATCH');
}
async function readEntry(recoveredDir, recoveryId) {
  need(hex(recoveryId), 'RECOVERY_INVALID_ID');
  const entryDir = join(recoveredDir, recoveryId);
  await directory(entryDir);
  const entryBytes = await readPrivate(join(entryDir, 'entry.json'));
  const data = parse(entryBytes);
  need(object(data) && data.schema === RECOVERY_SCHEMA && data.origin === RECOVERY_ORIGIN &&
    data.recoveryId === recoveryId && identity(data.network, data.transaction) === recoveryId &&
    typeof data.importedAt === 'string' && !Number.isNaN(Date.parse(data.importedAt)) &&
    data.sourceBinding === 'RETAINED_CLIENT_FILES_AND_OPERATOR_ROUTE_SELECTION' &&
    data.reservation === 'ABSENT_NO_SF81_RECORD' && data.outbox === 'NO_SF98_CAPTURE_OR_ENQUEUE' &&
    object(data.sources), 'RECOVERY_INVALID_RETAINED_ENTRY');
  const expected = ['outcome.json', 'request.json', 'terms.json', 'proof.json',
    ...(data.response === null ? [] : ['response.bin'])].sort();
  need(Object.keys(data.sources).sort().join('\n') === expected.join('\n') &&
    (await readdir(entryDir)).sort().join('\n') === ['entry.json', ...expected].sort().join('\n'),
  'RECOVERY_UNEXPECTED_RETAINED_FILE');
  const source = new Map();
  for (const name of expected) {
    const bytes = await readPrivate(join(entryDir, name), name === 'response.bin' ? RESPONSE_LIMIT : JSON_LIMIT,
      { allowEmpty: name === 'response.bin' });
    const descriptor = data.sources[name];
    need(object(descriptor) && descriptor.bytes === bytes.length && descriptor.sha256 === sha(bytes),
      'RECOVERY_RETAINED_SOURCE_CHANGED');
    source.set(name, bytes);
  }
  const binding = bindOriginalSources({ outcome: parse(source.get('outcome.json')),
    request: parse(source.get('request.json')), terms: parse(source.get('terms.json')),
    routeId: data.routeId, payer: data.payer });
  need(Object.entries(binding).every(([key, value]) => canonical(data[key]) === canonical(value)),
    'RECOVERY_RETAINED_BINDING_CHANGED');
  if (data.response !== null) need(object(data.response) && data.method !== 'HEAD' &&
    data.response.file === 'response.bin' && data.response.sha256 === data.sources['response.bin'].sha256 &&
    data.response.bytes === data.sources['response.bin'].bytes && data.response.contentType === binding.contentType &&
    data.response.origin === 'RETAINED_ORIGINAL_SF31_RESPONSE_FILE', 'RECOVERY_RETAINED_RESPONSE_CHANGED');
  const proofBytes = source.get('proof.json'), proof = parse(proofBytes);
  verifyProofBinding(proof, data);
  return { data, fileDigest: sha(entryBytes), proof: { data: proof, fileDigest: sha(proofBytes) }, source };
}
const publicEntry = ({ data, fileDigest, proof }) => ({ data, fileDigest, proof });
function requireSameImport(existing, input) {
  need(Object.entries(input.binding).every(([key, value]) => canonical(existing.data[key]) === canonical(value)) &&
    canonical(existing.data.response) === canonical(input.response) &&
    Object.entries(input.sources).every(([name, value]) => canonical(existing.data.sources[name]) === canonical(value)),
  'RECOVERY_TRANSACTION_ALREADY_BOUND_TO_DIFFERENT_SOURCE');
  return { status: 'ALREADY_IMPORTED', ...publicEntry(existing) };
}

/** Independent RPC reconciliation followed by one durable, immutable local import. */
export async function importRecoveredSettlement({ configFile, recoveredDir, fetchImpl,
  decodeContractEvent, signal } = {}) {
  const input = await loadInput(configFile);
  await directory(recoveredDir, { create: true });
  const { recoveryId } = input.binding;
  if (await exists(join(recoveredDir, recoveryId)))
    return requireSameImport(await readEntry(recoveredDir, recoveryId), input);
  need(signal === undefined || signal instanceof AbortSignal, 'RECOVERY_INVALID_ABORT_SIGNAL');
  signal?.throwIfAborted();
  const { reconcileReportedReceipt } = await import('../sf86-rpc-transfer-reconcile/verify.mjs');
  need(typeof reconcileReportedReceipt === 'function', 'ORIGINAL_SF86_REPORTED_RECEIPT_VERIFIER_REQUIRED');
  let transport = fetchImpl;
  if (transport === undefined) {
    const request = createPublicHttpsFetch({ trustedProxy: input.config.httpsProxyEnv === undefined ? null :
      { mode: 'explicit-connect', origin: new URL(input.profile.endpoint).origin, proxyEnv: input.config.httpsProxyEnv } });
    // Both original transports prohibit following redirects. SF86 requests
    // redirect:error; SF31 exposes the same one-request behavior as manual.
    transport = (url, options) => request(url, { ...options, redirect: 'manual' });
  }
  const proof = await reconcileReportedReceipt({ intentId: input.binding.intentId,
    requirement: input.outcome.requirement, receipt: input.outcome.receipt, payer: input.binding.payer,
    rpcEndpoint: input.profile.endpoint, fetchImpl: transport,
    decodeContractEvent: decodeContractEvent ?? await createOfficialEventDecoder(), signal });
  verifyProofBinding(proof, input.binding);
  need(proof.verdict === input.profile.verdict && proof.source === input.profile.source,
    'RECOVERY_ORIGINAL_PUBLIC_TRANSFER_MATCH_REQUIRED');
  signal?.throwIfAborted();
  const proofBytes = json(proof);
  input.source.set('proof.json', proofBytes);
  const entry = { schema: RECOVERY_SCHEMA, origin: RECOVERY_ORIGIN,
    importedAt: new Date().toISOString(), ...input.binding,
    sourceBinding: 'RETAINED_CLIENT_FILES_AND_OPERATOR_ROUTE_SELECTION',
    reservation: 'ABSENT_NO_SF81_RECORD', outbox: 'NO_SF98_CAPTURE_OR_ENQUEUE',
    response: input.response,
    sources: { ...input.sources, 'proof.json': { sha256: sha(proofBytes), bytes: proofBytes.length } } };
  const staging = join(recoveredDir, '.import-' + recoveryId + '-' + randomUUID());
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const [name, bytes] of input.source) await writePrivate(join(staging, name), bytes);
    await writePrivate(join(staging, 'entry.json'), json(entry));
    await syncDirectory(staging);
    signal?.throwIfAborted();
    try { await rename(staging, join(recoveredDir, recoveryId)); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      return requireSameImport(await readEntry(recoveredDir, recoveryId), input);
    }
    await syncDirectory(recoveredDir);
    return { status: 'IMPORTED', ...publicEntry(await readEntry(recoveredDir, recoveryId)) };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

/** Canonical accounting consumes this explicit source alongside its SF98 reader. */
export async function readRecoveredSettlements(recoveredDir) {
  await directory(recoveredDir);
  const names = (await readdir(recoveredDir)).sort();
  need(names.length <= 2000, 'RECOVERY_STORE_TOO_LARGE');
  const entries = [];
  for (const name of names) {
    // Atomic imports are not visible as settled entries until directory rename.
    if (/^\.import-[a-f0-9]{64}-[a-f0-9-]{36}$/.test(name)) continue;
    need(hex(name), 'RECOVERY_UNEXPECTED_STORE_ENTRY');
    entries.push(publicEntry(await readEntry(recoveredDir, name)));
  }
  return { entries, hashes: entries.map(({ data, fileDigest }) => ({ recoveryId: data.recoveryId, sha256: fileDigest })) };
}

/** Return the retained delivered bytes. Never contact the merchant or buy again. */
export async function readRecoveredResponse({ recoveredDir, recoveryId } = {}) {
  await directory(recoveredDir);
  const entry = await readEntry(recoveredDir, recoveryId);
  need(entry.data.response !== null, 'RECOVERY_HAS_NO_SAVED_RESPONSE');
  return { ...entry.data.response, recoveryId, bytes: entry.source.get('response.bin') };
}

/** Copy to a new owner-selected private destination, preserving the retained source. */
export async function exportRecoveredResponse({ recoveredDir, recoveryId, outputFile } = {}) {
  normalized(outputFile);
  need(!outputFile.startsWith(recoveredDir + '/'), 'RECOVERY_RESPONSE_OUTPUT_MUST_BE_OUTSIDE_STORE');
  const response = await readRecoveredResponse({ recoveredDir, recoveryId });
  await writePrivate(outputFile, response.bytes);
  return { recoveryId, outputFile, sha256: response.sha256, bytes: response.bytes.length,
    contentType: response.contentType, source: response.origin };
}
