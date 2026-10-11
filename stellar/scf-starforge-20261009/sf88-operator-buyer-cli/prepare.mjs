// MIT — Offline saved-catalog selection for the existing SF88 review command.
import { createHash } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import { abs, bytes, InputError, need, operation, preparedFrom } from './config.mjs';

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const required = ['--discovery','--row','--accept','--intent-id','--url','--method','--out'];
function index(value) {
  need(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) &&
    Number.isSafeInteger(Number(value)), 'EXPLICIT_SELECTION_INDEX_REQUIRED');
  return Number(value);
}
function https(value) {
  let url;
  try { url = new URL(value); } catch { throw new InputError('DISCOVERED_RESOURCE_URL_INVALID'); }
  need(url.protocol === 'https:' && !url.username && !url.password && !url.hash,
    'DISCOVERED_RESOURCE_HTTPS_REQUIRED');
  return url;
}

/** No network, operator settings, signer, approval or automatic option choice. */
export async function prepare(args) {
  need(args.length === required.length * 2, 'PREPARE_EXPLICIT_SELECTION_REQUIRED');
  const flags = new Map();
  for (let i = 0; i < args.length; i += 2) {
    need(required.includes(args[i]) && !flags.has(args[i]), 'INVALID_PREPARE_FLAGS');
    flags.set(args[i], args[i+1]);
  }
  need(required.every(key => flags.has(key)), 'PREPARE_EXPLICIT_SELECTION_REQUIRED');
  const rowIndex = index(flags.get('--row')), acceptIndex = index(flags.get('--accept'));
  const destination = abs(flags.get('--out'), 'DRAFT_PATH_MUST_BE_ABSOLUTE');
  const raw = await bytes(flags.get('--discovery'), 1048576, 'INVALID_DISCOVERY_FILE');
  let saved;
  try { saved = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw)); }
  catch { throw new InputError('DISCOVERY_JSON_INVALID'); }
  need(object(saved), 'INVALID_SAVED_DISCOVERY');
  let rows, source = null, sourceEnvelope;
  if (saved.mode === 'ORIGINAL_UNSIGNED_CATALOG') {
    need(!Object.hasOwn(saved, 'resources') && !Object.hasOwn(saved, 'items') &&
      ['resources','items'].includes(saved.sourceEnvelope) &&
      typeof saved.source === 'string', 'INVALID_SAVED_DISCOVERY');
    rows = saved.originalListings; source = saved.source; sourceEnvelope = saved.sourceEnvelope;
  } else {
    const resources = Object.hasOwn(saved, 'resources'), items = Object.hasOwn(saved, 'items');
    need(resources !== items && !Object.hasOwn(saved, 'originalListings'), 'INVALID_SAVED_DISCOVERY');
    sourceEnvelope = resources ? 'resources' : 'items'; rows = saved[sourceEnvelope];
  }
  need(Array.isArray(rows) && rowIndex < rows.length && object(rows[rowIndex]), 'DISCOVERY_ROW_NOT_FOUND');
  const row = rows[rowIndex];
  need(Array.isArray(row.accepts) && row.accepts.length >= 1 && row.accepts.length <= 32 &&
    acceptIndex < row.accepts.length && object(row.accepts[acceptIndex]), 'DISCOVERY_ACCEPT_NOT_FOUND');
  need(row.type === undefined || row.type === 'http', 'HTTP_RESOURCE_REQUIRED');
  const advertised = https(typeof row.resource === 'string' ? row.resource : row.resource?.url);
  const requested = https(flags.get('--url'));
  // The operator supplies concrete query values. Selecting another host/path is
  // a different offer; templates must first be resolved in its source workflow.
  need(!/[{}]|%7[bd]/i.test(advertised.pathname) &&
    requested.origin === advertised.origin && requested.pathname === advertised.pathname,
    'CONCRETE_URL_MUST_MATCH_SELECTED_RESOURCE_PATH');
  const input = row.extensions?.bazaar?.info?.input;
  need(input?.type === undefined || input.type === 'http', 'HTTP_RESOURCE_REQUIRED');
  const method = flags.get('--method');
  need(input?.method === undefined || input.method === method, 'DISCOVERED_METHOD_MISMATCH');
  const accepted = row.accepts[acceptIndex];
  need(Number.isInteger(accepted.maxTimeoutSeconds) && accepted.maxTimeoutSeconds >= 1 &&
    accepted.maxTimeoutSeconds <= 86400 &&
    (accepted.extra === undefined || object(accepted.extra)), 'INVALID_DISCOVERED_REQUIREMENT');
  const expect = { scheme:accepted.scheme, network:accepted.network, asset:accepted.asset,
    payTo:accepted.payTo, maxAtomic:accepted.amount, maxTimeoutSeconds:accepted.maxTimeoutSeconds };
  if (accepted.extra?.paymentFlow !== undefined) expect.paymentFlow = accepted.extra.paymentFlow;
  const op = operation({intentId:flags.get('--intent-id'), url:requested.href, method, expect});
  const origin = preparedFrom({schema:'stellar-forge.sf88.saved-discovery.v1',
    discoveryFileSha256:createHash('sha256').update(raw).digest('hex'), source, sourceEnvelope,
    rowIndex, acceptIndex, originalListing:structuredClone(row)});
  const draft = {operation:op, captureBody:false, preparedFrom:origin};
  const data = Buffer.from(JSON.stringify(draft, null, 2) + '\n');
  need(data.length <= 65536, 'PREPARED_CONFIG_EXCEEDS_CONFIG_LIMIT');
  let file;
  try { file = await open(destination, 'wx', 0o600); }
  catch (error) { throw new InputError(error.code === 'EEXIST' ? 'DRAFT_DESTINATION_EXISTS' : 'DRAFT_DESTINATION_UNAVAILABLE'); }
  try { await file.writeFile(data); await file.sync(); }
  catch {
    await file.close().catch(() => {});
    await unlink(destination).catch(() => {});
    throw new InputError('DRAFT_CONFIG_WRITE_FAILED');
  }
  await file.close();
  return {mode:'OFFLINE_CONFIG_PREPARED', configPath:destination,
    configSha256:createHash('sha256').update(data).digest('hex'),
    sourceFileSha256:origin.discoveryFileSha256, rowIndex, acceptIndex,
    intentId:op.intentId, sellerUrl:op.url, method:op.method, acceptedTerms:op.expect,
    sourceStatus:'SAVED_UNVERIFIED_DISCOVERY',
    next:'Review this config with --review; add trusted operator settings separately before execution'};
}
