#!/usr/bin/env node
// MIT. Woo order handoff -> the original SF88 operation and private workspace.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open, unlink} from 'node:fs/promises';
import {isAbsolute, resolve} from 'node:path';
import {isIP} from 'node:net';
import {fileURLToPath} from 'node:url';
import {operation, execution, need} from '../sf88-operator-buyer-cli/config.mjs';
import {BASKET_SCHEMA, validateBasketHandoff} from './basket.mjs';

export const HANDOFF_SCHEMA = 'stellar-forge.sf104.checkout-handoff.v1';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function fields(value, allowed, code) {
  need(isObject(value) && Object.keys(value).every(key => allowed.includes(key)), code);
  return value;
}
export function publicUrl(value, code = 'PUBLIC_HTTPS_URL_REQUIRED') {
  need(typeof value === 'string' && value.length <= 2048 && !/[\x00-\x20\x7f]/.test(value), code);
  let url;
  try { url = new URL(value); } catch { need(false, code); }
  const host = url.hostname.toLowerCase();
  need(url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
    (!url.port || url.port === '443') && !isIP(host.replace(/^\[|\]$/g, '')) &&
    host.includes('.') && !['localhost','local','localdomain','internal','home.arpa'].some(
      name => host === name || host.endsWith('.' + name)) &&
    host.length <= 253 && host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)), code);
  return url;
}
export function reference(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,17}$/.test(value);
}
export function generation(value) {
  return Number.isInteger(value) && value >= 1 && value <= 2147483647;
}
function money(value) {
  return typeof value === 'string' && /^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,8})?$/.test(value) &&
    /[1-9]/.test(value);
}

/** Downloaded merchant data is never allowed to choose a signer, wallet,
 * operator, filesystem path, arbitrary request header or payment intent ID. */
export function validateHandoff(raw) {
  const basket = raw?.schema === BASKET_SCHEMA;
  const h = fields(raw, ['schema','storeOrigin','orderReference','attemptGeneration','routeId',
    'createdAt','storefront','operation', ...(basket ? ['catalogDigest','basketDigest','items'] : ['productId'])], 'WOO_HANDOFF_FIELDS_INVALID');
  need((h.schema === HANDOFF_SCHEMA || basket) && reference(h.orderReference) && generation(h.attemptGeneration) &&
    (basket || reference(h.productId)) &&
    typeof h.routeId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(h.routeId), 'WOO_HANDOFF_IDENTITY_INVALID');
  const store = publicUrl(h.storeOrigin, 'WOO_STORE_ORIGIN_INVALID');
  need(store.pathname === '/' && !store.search &&
    (h.storeOrigin === store.origin || h.storeOrigin === store.origin + '/'), 'WOO_STORE_ORIGIN_INVALID');
  need(typeof h.createdAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?(?:Z|\+00:00)$/.test(h.createdAt) &&
    Number.isFinite(Date.parse(h.createdAt)), 'WOO_CREATED_AT_INVALID');
  fields(h.storefront, ['currency','total'], 'WOO_STOREFRONT_INVALID');
  need(typeof h.storefront.currency === 'string' && /^[A-Z][A-Z0-9]{2,9}$/.test(h.storefront.currency) &&
    money(h.storefront.total), 'WOO_STOREFRONT_INVALID');
  const request = fields(h.operation, ['url','method','expect','orderReference'], 'WOO_OPERATION_FIELDS_INVALID');
  const url = publicUrl(request.url, 'WOO_RESOURCE_INVALID');
  need(['GET','HEAD'].includes(request.method) && request.orderReference === h.orderReference &&
    [...url.searchParams.keys()].length === (basket ? 3 : 2) && url.searchParams.get('sf98_order') === h.orderReference &&
    url.searchParams.get('sf104_attempt') === String(h.attemptGeneration),
    'WOO_ORDER_RESOURCE_MISMATCH');
  const expect = fields(request.expect, ['scheme','network','asset','payTo','maxAtomic','maxTimeoutSeconds'],
    'WOO_PAYMENT_FIELDS_INVALID');
  need(typeof expect.maxAtomic === 'string' && /^[1-9][0-9]*$/.test(expect.maxAtomic) &&
    Number.isInteger(expect.maxTimeoutSeconds) && expect.maxTimeoutSeconds >= 1 &&
    expect.maxTimeoutSeconds <= 86400 &&
    ['asset','payTo'].every(key => typeof expect[key] === 'string' && expect[key].length <= 128 &&
      expect[key].length >= 3 && !/[\x00-\x20\x7f]/.test(expect[key])), 'WOO_PAYMENT_FIELDS_INVALID');
  if (basket) {
    need(h.storeOrigin === store.origin, 'WOO_STORE_ORIGIN_INVALID');
    validateBasketHandoff(h);
  }
  const intentId = 'woo:' + sha256(store.origin).slice(0, 24) + ':' + h.orderReference + ':g' + h.attemptGeneration;
  // This is the SAME original order-reference/approved-URL/header contract.
  operation({...request, intentId});
  return structuredClone({...h, storeOrigin:store.origin});
}

export function prepareBuyer(raw) {
  const h = validateHandoff(raw);
  const intentId = 'woo:' + sha256(h.storeOrigin).slice(0, 24) + ':' + h.orderReference + ':g' + h.attemptGeneration;
  const op = operation({...h.operation, intentId});
  return {handoff:h, config:{operation:op, captureBody:false}, handoffSha256:sha256(JSON.stringify(h))};
}

/** Reuse an explicitly chosen original workspace without loading keys or a
 * signer. The downloaded handoff cannot replace its trusted operator settings. */
export async function prepareForWorkspace(prepared, path) {
  need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path,
    'WORKSPACE_ABSOLUTE_PATH_REQUIRED');
  const {openWorkspace} = await import('../sf88-operator-buyer-cli/workspace.mjs');
  const workspace = await openWorkspace(['--dir', path]);
  const trusted = workspace.config, terms = prepared.config.operation.expect;
  need(['scheme','network','asset','payTo'].every(key => terms[key] === trusted.operation.expect[key]) &&
    ['network','asset','payTo'].every(key => terms[key] === workspace.manifest.signer[key]),
    'WOO_WORKSPACE_PAYMENT_TERMS_MISMATCH');
  need(BigInt(terms.maxAtomic) <= BigInt(trusted.operation.expect.maxAtomic) &&
    BigInt(terms.maxAtomic) <= BigInt(workspace.manifest.signer.maxAtomic), 'WOO_WORKSPACE_CAP_EXCEEDED');
  const config = {...prepared.config, operator:structuredClone(trusted.operator),
    signerModule:trusted.signerModule, evidenceDir:trusted.evidenceDir, trustedPayer:trusted.trustedPayer,
    ...(trusted.buyerTransport === undefined ? {} : {buyerTransport:structuredClone(trusted.buyerTransport)})};
  execution(config); // Includes original transport-origin binding.
  return {...prepared, config, workspace:path};
}

/** No network or signer import. Repeated exports for one shop/order/generation
 * recover the same original intent even when the filename or formatting varies.
 * Only an audited merchant reset advances the generation for a new approval. */
export async function readHandoff(path) {
  need(typeof path === 'string' && isAbsolute(path), 'HANDOFF_ABSOLUTE_PATH_REQUIRED');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    need(info.isFile() && info.size > 0 && info.size <= 65536, 'WOO_HANDOFF_FILE_INVALID');
    const raw = await file.readFile();
    need(raw.length <= 65536, 'WOO_HANDOFF_FILE_INVALID');
    return validateHandoff(JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw)));
  } finally { await file.close(); }
}

export async function writeBuyerConfig(path, prepared) {
  need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path, 'OUTPUT_ABSOLUTE_PATH_REQUIRED');
  const data = Buffer.from(JSON.stringify(prepared.config, null, 2) + '\n');
  let file;
  try { file = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await previous.stat();
      need(info.isFile() && info.size <= 65536 &&
        (process.platform === 'win32' || (info.mode & 0o077) === 0), 'EXISTING_BUYER_CONFIG_UNSAFE');
      const bytes = await previous.readFile();
      need(bytes.length <= 65536 && bytes.equals(data), 'EXISTING_BUYER_CONFIG_CONFLICT');
      return 'EXISTING_MATCH';
    } finally { await previous.close(); }
  }
  try { await file.writeFile(data); await file.sync(); }
  catch (error) { await file.close().catch(() => {}); await unlink(path).catch(() => {}); throw error; }
  await file.close();
  return 'CREATED';
}

const USAGE = `node buyer.mjs inspect --handoff /absolute/woo-order.json
node buyer.mjs prepare --handoff /absolute/woo-order.json --out /absolute/new-review.json
node buyer.mjs prepare --handoff /absolute/woo-order.json --workspace /absolute/existing-workspace --out /absolute/new-inbox-config.json

prepare writes a private ORIGINAL SF88 review configuration. It makes no network
request and cannot sign or pay. Review it with ../sf88-operator-buyer-cli/cli.mjs
--review --config FILE, then use that CLI's original --init-workspace command.
Keep the same ledger for recovery; each merchant-approved order generation has one
deterministic intent. Only an audited merchant reset can permit a new generation.
The merchant's signed live-order admission checks precede native verification.
With --workspace, prepare copies only that validated workspace's trusted operator
settings into a new original inbox configuration; it never loads keys or a signer.
Enqueue and execute that file through the original SF88 queue with the same workspace.
After native payment, Woo delivery remains in the original merchant review queue.`;

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); return; }
  const action = args[0], options = new Map();
  need(['inspect','prepare'].includes(action), 'WOO_BUYER_ACTION_REQUIRED');
  for (let i = 1; i < args.length; i += 2) {
    need(['--handoff','--out','--workspace'].includes(args[i]) && !options.has(args[i]) &&
      typeof args[i+1] === 'string' && !args[i+1].startsWith('--'), 'WOO_BUYER_ARGUMENT_INVALID');
    options.set(args[i], args[i+1]);
  }
  need(options.has('--handoff') && (action === 'prepare' ? options.has('--out') :
    !options.has('--out') && !options.has('--workspace')),
    'WOO_BUYER_ARGUMENT_REQUIRED');
  let prepared = prepareBuyer(await readHandoff(resolve(options.get('--handoff'))));
  if (options.has('--workspace')) prepared = await prepareForWorkspace(prepared, resolve(options.get('--workspace')));
  const output = action === 'prepare' ? resolve(options.get('--out')) : null;
  const disposition = output ? await writeBuyerConfig(output, prepared) : null;
  const result = {status:output ? 'ORIGINAL_SF88_REVIEW_PREPARED' : 'WOO_ORDER_REVIEW',
    storeOrigin:prepared.handoff.storeOrigin, orderReference:prepared.handoff.orderReference,
    attemptGeneration:prepared.handoff.attemptGeneration,
    ...(prepared.handoff.items ? {items:prepared.handoff.items, catalogDigest:prepared.handoff.catalogDigest,
      basketDigest:prepared.handoff.basketDigest} : {productId:prepared.handoff.productId}), routeId:prepared.handoff.routeId,
    storefront:prepared.handoff.storefront, operation:prepared.config.operation,
    handoffSha256:prepared.handoffSha256, ...(output ? {output, disposition} : {}),
    ...(prepared.workspace ? {workspace:prepared.workspace} : {}),
    payment:'ORIGINAL_BUYER_APPROVAL_REQUIRED', delivery:'ORIGINAL_WOO_MERCHANT_REVIEW', networkRequests:0};
  console.log(JSON.stringify(result, null, 2)); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => {
    console.error(JSON.stringify({error:/^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'WOO_BUYER_COMMAND_FAILED',
      automaticPaymentRetry:false})); process.exitCode = 1;
  });

