// MIT. Approved SF88 order preparation and original SF101 file retrieval.
import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, execution, operation } from '../sf88-operator-buyer-cli/config.mjs';
import { createPublicHttpsFetch } from '../sf31-buyer-client/public-transport.mjs';
import { prepareBuyerResponseFile } from '../sf31-buyer-client/response-file.mjs';
import { need, privatePath, readJson, validateHandoff, sha } from './checkout-config.mjs';
import { writePrivateJson } from './checkout.mjs';

const USAGE = `node purchase.mjs prepare --handoff MERCHANT_HANDOFF.json --config EXISTING_SF88_OPERATOR.json --out NEW_ORDER_OPERATOR.json
node purchase.mjs inspect --handoff MERCHANT_HANDOFF.json
node purchase.mjs retrieve --handoff MERCHANT_HANDOFF.json --out PRIVATE_NEW_FILE [--claim-env SF101_CLAIM_TOKEN]

Review/enqueue/execute with the ORIGINAL SF88 CLI and durable inbox. retrieve only
downloads an existing SF101 entitlement; it never invokes a buyer, signer or payment.
An existing matching output is recovered locally without a network request.`;

export async function preparePurchase({handoff:raw, configuration, output}) {
  const handoff = validateHandoff(raw), original = structuredClone(configuration);
  const {op} = execution(original);
  const current = new URL(op.url), expected = new URL(handoff.purchaseUrl);
  need(current.origin === expected.origin && current.pathname === expected.pathname && op.method === 'GET' && op.bodyFile === undefined,
    'HANDOFF_MUST_MATCH_SELECTED_BUYER_OPERATION');
  need([...current.searchParams.keys()].every(key => key === 'sf98_order') &&
    (current.searchParams.get('sf98_order') === null || current.searchParams.get('sf98_order') === handoff.orderReference),
    'EXISTING_BUYER_QUERY_CONFLICT');
  need(op.orderReference === undefined || op.orderReference === handoff.orderReference, 'EXISTING_BUYER_ORDER_CONFLICT');
  need(['scheme','network','asset','payTo'].every(key => op.expect[key] === handoff.payment[key]) &&
    BigInt(op.expect.maxAtomic) >= BigInt(handoff.payment.amount) &&
    (op.expect.maxTimeoutSeconds === undefined || op.expect.maxTimeoutSeconds >= handoff.payment.maxTimeoutSeconds),
    'HANDOFF_EXCEEDS_EXISTING_BUYER_TERMS');
  original.operation = operation({...op, url:handoff.purchaseUrl, orderReference:handoff.orderReference});
  execution(original);
  await writePrivateJson(privatePath(output), original);
  return {status:'ORIGINAL_SF88_ORDER_PREPARED', output, intentId:op.intentId,
    approvedUrl:original.operation.url, orderReference:handoff.orderReference,
    expectedFile:handoff.file, paymentAuthorization:'ORIGINAL_SF88_REVIEW_AND_EXECUTE_REQUIRED'};
}

async function existingFile(destination, expected) {
  let file;
  try { file = await open(destination, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    const info = await file.stat();
    need(info.isFile() && (process.platform === 'win32' || (info.mode & 0o077) === 0) && info.size === expected.bytes,
      'EXISTING_DELIVERY_FILE_MISMATCH');
    const bytes = await file.readFile();
    need(bytes.length === expected.bytes && sha(bytes) === expected.sha256, 'EXISTING_DELIVERY_FILE_MISMATCH');
    return {path:destination, bytes:bytes.length, sha256:expected.sha256};
  } finally { await file.close(); }
}

/** Retain original public DNS/TLS/redirect behavior. The token is scoped to one
 * exact merchant delivery path, injected only into the trusted transport call.
 * It is never a caller-supplied SF31 payment Authorization header.
 */
function claimTransport(handoff, token) {
  const delivery = new URL(handoff.deliveryUrl);
  const hostname = delivery.hostname.toLowerCase().replace(/\.$/, '');
  return createPublicHttpsFetch({requestImpl:(options, callback) => {
    need(options.hostname === hostname && options.path === delivery.pathname && options.method === 'GET',
      'CLAIM_TOKEN_DESTINATION_MISMATCH');
    return httpsRequest({...options, headers:{...options.headers, authorization:'Bearer ' + token}}, callback);
  }});
}

function verifiedResponse(response, expected) {
  need(response instanceof Response && response.status === 200 && response.body, 'ENTITLEMENT_NOT_AVAILABLE');
  const hash = createHash('sha256'); let size = 0;
  const verifier = new TransformStream({
    transform(chunk, controller) {
      need(chunk instanceof Uint8Array, 'DELIVERY_CHUNK_INVALID');
      size += chunk.byteLength;
      need(size <= expected.bytes, 'DELIVERY_EXCEEDS_APPROVED_FILE');
      hash.update(chunk); controller.enqueue(chunk);
    },
    flush() {
      // The ORIGINAL writer only publishes after EOF. A wrong/missing last byte
      // fails the stream before its create-only final-path publication.
      need(size === expected.bytes && hash.digest('hex') === expected.sha256, 'DELIVERY_FINGERPRINT_MISMATCH');
    },
  });
  return new Response(response.body.pipeThrough(verifier), {status:response.status, headers:response.headers});
}

async function deliveryReceipt(path, handoff, saved, source) {
  const payload = {schema:'stellar-forge.sf101.buyer-file.v1', orderReference:handoff.orderReference,
    purchaseUrl:handoff.purchaseUrl, deliveryUrl:handoff.deliveryUrl,
    handoffSha256:sha(JSON.stringify(handoff)), file:{path:saved.path, sha256:saved.sha256, bytes:saved.bytes},
    observedAt:new Date().toISOString(), source,
    payment:'SEPARATE_ORIGINAL_BUYER_AND_MERCHANT_RECORDS', automaticPaymentRetry:false};
  try { await writePrivateJson(path, payload); return {path, disposition:'WRITTEN'}; }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const old = await readJson(path);
    need(old?.schema === payload.schema && old.handoffSha256 === payload.handoffSha256 &&
      old.orderReference === payload.orderReference && old.file?.path === saved.path &&
      old.file.sha256 === saved.sha256 && old.file.bytes === saved.bytes, 'EXISTING_DELIVERY_RECEIPT_MISMATCH');
    return {path, disposition:'EXISTING_MATCH'};
  }
}

/** fetchImpl is a trusted embedding seam for actual local service acceptance.
 * The normal CLI always uses the original public HTTPS connection controls.
 */
export async function retrieveFile({handoff:raw, destination, token, signal, fetchImpl}) {
  const handoff = validateHandoff(raw);
  privatePath(destination);
  const receiptPath = destination + '.sf101.json';
  const local = await existingFile(destination, handoff.file);
  if (local) return {status:'EXISTING_LOCAL_BYTES_MATCH', orderReference:handoff.orderReference,
    file:local, receipt:await deliveryReceipt(receiptPath, handoff, local, 'EXISTING_LOCAL_FILE'), httpRequests:0};
  try { await lstat(receiptPath); throw new Error('DELIVERY_RECEIPT_WITHOUT_FILE'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  need(typeof token === 'string' && Buffer.byteLength(token) >= 32 && Buffer.byteLength(token) <= 1024 &&
    !/[\x00-\x20\x7f]/.test(token), 'PRIVATE_CLAIM_TOKEN_REQUIRED');
  need(fetchImpl === undefined || typeof fetchImpl === 'function', 'TRUSTED_DOWNLOAD_FETCH_REQUIRED');
  const fetchDelivery = fetchImpl ?? claimTransport(handoff, token);
  const writer = await prepareBuyerResponseFile({destination, maxBytes:handoff.file.bytes, timeoutMs:30000});
  let response;
  try {
    response = await fetchDelivery(handoff.deliveryUrl, {method:'GET', redirect:'manual', ...(signal ? {signal} : {}),
      ...(fetchImpl ? {headers:{authorization:'Bearer ' + token}} : {})});
    const checked = verifiedResponse(response, handoff.file);
    const saved = await writer.save({response:checked}, {signal});
    const receipt = await deliveryReceipt(receiptPath, handoff, saved, 'ORIGINAL_SF101_HTTP_DELIVERY');
    return {status:'APPROVED_FILE_SAVED', orderReference:handoff.orderReference, file:saved, receipt, httpRequests:1};
  } finally {
    if (response?.body && !response.body.locked && !response.bodyUsed) try { await response.body.cancel(); } catch {}
    await writer.abort();
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); return; }
  const action = args[0]; need(['prepare','inspect','retrieve'].includes(action), 'PURCHASE_ACTION_REQUIRED');
  const allowed = {prepare:['--handoff','--config','--out'], inspect:['--handoff'],
    retrieve:['--handoff','--out','--claim-env']}[action], values = new Map();
  for (let i=1; i<args.length; i+=2) {
    need(allowed.includes(args[i]) && !values.has(args[i]) && args[i+1] && !args[i+1].startsWith('--'), 'PURCHASE_OPTION_INVALID');
    values.set(args[i], args[i+1]);
  }
  need(values.has('--handoff'), 'PURCHASE_HANDOFF_REQUIRED');
  const handoff = validateHandoff(await readJson(resolve(values.get('--handoff'))));
  let result;
  if (action === 'inspect') result = {status:'MERCHANT_ORDER_REVIEW', ...handoff,
    approval:'ORIGINAL_SF88_REVIEW_AND_EXECUTE_REQUIRED', claimToken:'SEPARATE_PRIVATE_CHANNEL'};
  if (action === 'prepare') {
    need(values.has('--config') && values.has('--out'), 'BUYER_CONFIG_AND_OUTPUT_REQUIRED');
    result = await preparePurchase({handoff, configuration:await config(resolve(values.get('--config'))), output:resolve(values.get('--out'))});
  }
  if (action === 'retrieve') {
    need(values.has('--out'), 'PRIVATE_DELIVERY_OUTPUT_REQUIRED');
    const name = values.get('--claim-env') ?? 'SF101_CLAIM_TOKEN';
    need(/^[A-Z][A-Z0-9_]{1,64}$/.test(name), 'CLAIM_ENV_NAME_INVALID');
    result = await retrieveFile({handoff, destination:resolve(values.get('--out')), token:process.env[name]});
  }
  console.log(JSON.stringify(result)); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => {
    console.error(JSON.stringify({error:/^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'PURCHASE_COMMAND_FAILED',
      ...(typeof error.partialPath === 'string' ? {partialPath:error.partialPath} : {}), automaticPaymentRetry:false}));
    process.exitCode=1;
  });
