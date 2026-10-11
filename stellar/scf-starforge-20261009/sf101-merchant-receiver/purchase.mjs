// MIT. Approved SF88 order preparation and original SF101 file retrieval.
import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, execution, operation } from '../sf88-operator-buyer-cli/config.mjs';
import { createPublicHttpsFetch } from '../sf31-buyer-client/public-transport.mjs';
import { prepareBuyerResponseFile } from '../sf31-buyer-client/response-file.mjs';
import { need, privatePath, readJson, validateHandoff, sha } from './checkout-config.mjs';
import { writePrivateJson } from './checkout.mjs';
import { canonicalDeliveryPath, verifyExistingDeliveryFile, resumeEntitledFile, inspectFileTransfer, resetFileTransfer } from './resumable-transfer.mjs';
export { inspectFileTransfer, resetFileTransfer } from './resumable-transfer.mjs';

const USAGE = `node purchase.mjs prepare --handoff MERCHANT_HANDOFF.json --config EXISTING_SF88_OPERATOR.json --out NEW_ORDER_OPERATOR.json
node purchase.mjs inspect --handoff MERCHANT_HANDOFF.json
node purchase.mjs retrieve --handoff MERCHANT_HANDOFF.json --out PRIVATE_NEW_FILE [--claim-env SF101_CLAIM_TOKEN] [--timeout-ms 30000] [--resume true|false]
node purchase.mjs transfer --handoff MERCHANT_HANDOFF.json --out PRIVATE_NEW_FILE
node purchase.mjs reset-transfer --handoff MERCHANT_HANDOFF.json --out PRIVATE_NEW_FILE

Review/enqueue/execute with the ORIGINAL SF88 CLI and durable inbox. retrieve only
downloads an existing SF101 entitlement; it never invokes a buyer, signer or payment.
An existing matching output is recovered locally without a network request.
Linux resumes the same retained transfer by default. transfer reads its state;
reset-transfer discards that transfer's partial bytes for an explicit fresh GET.`;

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

/** Retain original public DNS/TLS/redirect behavior. The token is scoped to one
 * exact merchant delivery path, injected only into the trusted transport call.
 * It is never a caller-supplied SF31 payment Authorization header.
 */
function claimTransport(handoff, token, timeoutMs = 30000) {
  const delivery = new URL(handoff.deliveryUrl);
  const hostname = delivery.hostname.toLowerCase().replace(/\.$/, '');
  return createPublicHttpsFetch({timeoutMs, requestImpl:(options, callback) => {
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
export async function retrieveFile({handoff:raw, destination:requestedDestination, token, signal, fetchImpl,
  resume = process.platform === 'linux', timeoutMs = 30000}) {
  const handoff = validateHandoff(raw);
  const destination = await canonicalDeliveryPath(requestedDestination);
  need(typeof resume === 'boolean', 'DELIVERY_RESUME_OPTION_INVALID');
  need(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300000, 'DELIVERY_TIMEOUT_INVALID');
  const receiptPath = destination + '.sf101.json';
  const local = await verifyExistingDeliveryFile(destination, handoff.file);
  if (local) {
    const saved = {path:local.path, bytes:local.bytes, sha256:local.sha256};
    if (resume) await inspectFileTransfer({handoff, destination});
    return {status:'EXISTING_LOCAL_BYTES_MATCH', orderReference:handoff.orderReference,
      file:saved, receipt:await deliveryReceipt(receiptPath, handoff, saved, 'EXISTING_LOCAL_FILE'), httpRequests:0};
  }
  try { await lstat(receiptPath); throw new Error('DELIVERY_RECEIPT_WITHOUT_FILE'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  need(fetchImpl === undefined || typeof fetchImpl === 'function', 'TRUSTED_DOWNLOAD_FETCH_REQUIRED');
  async function fetchDelivery(headers, requestSignal) {
    need(typeof token === 'string' && Buffer.byteLength(token) >= 32 && Buffer.byteLength(token) <= 1024 &&
      !/[\x00-\x20\x7f]/.test(token), 'PRIVATE_CLAIM_TOKEN_REQUIRED');
    const transport = fetchImpl ?? claimTransport(handoff, token, timeoutMs);
    return transport(handoff.deliveryUrl, {method:'GET', redirect:'manual',
      ...(requestSignal ? {signal:requestSignal} : {}),
      headers:{...headers, ...(fetchImpl ? {authorization:'Bearer ' + token, 'accept-encoding':'identity'} : {})}});
  }
  if (resume) {
    const result = await resumeEntitledFile({handoff, destination, signal, timeoutMs, fetchDelivery});
    const receipt = await deliveryReceipt(receiptPath, handoff, result.saved, 'ORIGINAL_SF101_HTTP_DELIVERY');
    return {status:'APPROVED_FILE_SAVED', orderReference:handoff.orderReference,
      file:result.saved, receipt, httpRequests:result.httpRequests, transfer:result.transfer};
  }
  const writer = await prepareBuyerResponseFile({destination, maxBytes:handoff.file.bytes, timeoutMs});
  let response;
  try {
    response = await fetchDelivery({}, signal);
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
  const action = args[0]; need(['prepare','inspect','retrieve','transfer','reset-transfer'].includes(action), 'PURCHASE_ACTION_REQUIRED');
  const allowed = {prepare:['--handoff','--config','--out'], inspect:['--handoff'],
    retrieve:['--handoff','--out','--claim-env','--timeout-ms','--resume'],
    transfer:['--handoff','--out'], 'reset-transfer':['--handoff','--out']}[action], values = new Map();
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
    need(!values.has('--resume') || ['true','false'].includes(values.get('--resume')), 'DELIVERY_RESUME_OPTION_INVALID');
    need(!values.has('--timeout-ms') || /^[1-9][0-9]{0,5}$/.test(values.get('--timeout-ms')), 'DELIVERY_TIMEOUT_INVALID');
    const controller = new AbortController();
    const stop = () => controller.abort(Object.assign(new Error('DELIVERY_ABORTED'), {code:'DELIVERY_ABORTED'}));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      result = await retrieveFile({handoff, destination:resolve(values.get('--out')), token:process.env[name],
        signal:controller.signal, timeoutMs:Number(values.get('--timeout-ms') ?? 30000),
        resume:values.has('--resume') ? values.get('--resume') === 'true' : process.platform === 'linux'});
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  }
  if (action === 'transfer' || action === 'reset-transfer') {
    need(values.has('--out'), 'PRIVATE_DELIVERY_OUTPUT_REQUIRED');
    const actionFunction = action === 'transfer' ? inspectFileTransfer : resetFileTransfer;
    result = await actionFunction({handoff, destination:resolve(values.get('--out'))});
  }
  console.log(JSON.stringify(result)); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => {
    console.error(JSON.stringify({error:/^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'PURCHASE_COMMAND_FAILED',
      ...(typeof error.partialPath === 'string' ? {partialPath:error.partialPath} : {}),
      ...(typeof error.transferState === 'string' ? {transferState:error.transferState, retainedBytes:error.retainedBytes,
        resumable:error.resumable, ...(error.checkpointError ? {checkpointError:error.checkpointError} : {})} : {}),
      automaticPaymentRetry:false}));
    process.exitCode=1;
  });
