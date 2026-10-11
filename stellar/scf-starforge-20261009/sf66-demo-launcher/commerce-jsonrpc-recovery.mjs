// MIT. Fulfil one settled RPC read through its original retained commerce session.
import { constants } from 'node:fs';
import { mkdir, lstat, open, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readPrivateFile, parseJson } from '../sf103-native-buyer-signer/operator.mjs';
import { config as readBuyerConfig, execution } from '../sf88-operator-buyer-cli/config.mjs';
import { inspectMissingReceiptAttempt, recoverMissingReceipt,
  readMissingReceiptRecovery } from '../sf88-operator-buyer-cli/missing-receipt.mjs';
import { prepareBuyerResponseFile } from '../sf31-buyer-client/response-file.mjs';
import { acquireStateLease } from '../merchant-fleet-gateway/state-lease.mjs';
import { readJsonrpcCommerce, validateJsonrpcCommerceRequest } from './commerce-jsonrpc.mjs';

const SCHEMA = 'stellar-forge.commerce-rpc-response-recovery.v1';
const HASH = /^[a-f0-9]{64}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
async function privateDirectory(path) {
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    (process.getuid === undefined || info.uid === process.getuid()), 'COMMERCE_RPC_PRIVATE_RECOVERY_REQUIRED');
}
async function save(path, value) {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  const directory = await open(dirname(path), constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
}
async function optionalJson(path) {
  try { return parseJson(await readPrivateFile(path, 131072)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function settlement(manual, job) {
  const result = manual?.result, facts = result?.verifiedFacts;
  need(['FINALIZED', 'IDEMPOTENT_FINALIZED'].includes(result?.outcome) &&
    manual.attemptId === job.attempt.id && manual.configSha256 === job.configSha256 &&
    HASH.test(manual.requestSha256 ?? '') && HASH.test(manual.transaction ?? '') &&
    facts?.transaction === manual.transaction && facts.network === job.operation.expect.network &&
    facts.asset === job.operation.expect.asset && facts.recipient === job.operation.expect.payTo &&
    facts.atomicAmount === job.merchant.originalTerms.amount &&
    Number.isSafeInteger(facts.ledger) && facts.ledger > 0,
    'COMMERCE_RPC_VERIFIED_SETTLEMENT_REQUIRED');
  return { requestSha256: manual.requestSha256, transaction: manual.transaction,
    ledger: facts.ledger, network: facts.network, asset: facts.asset, payer: facts.payer,
    recipient: facts.recipient, amountAtomic: facts.atomicAmount,
    receiptRef: result.receipt_ref, proofSha256: result.proof_sha256 };
}
function identity(job, saved, paid) {
  return { intentId: job.operation.intentId, attemptId: job.attempt.id,
    configSha256: job.configSha256, bodySha256: job.bodySha256, bodyBytes: job.bodyBytes,
    originalAttemptStartedAt: job.attempt.startedAt, method: job.operation.method,
    url: job.operation.url, routeId: job.merchant.routeId,
    planSha256: saved.seller.jsonrpcSha256, settlement: paid };
}
function bound(record, expected, destination) {
  need(record?.schema === SCHEMA && isDeepStrictEqual(record.request, expected) &&
    record.response?.path === destination && HASH.test(record.response.sha256 ?? '') &&
    Number.isSafeInteger(record.response.bytes) && record.response.bytes >= 1 &&
    record.response.contentType === 'application/json' &&
    Number.isFinite(Date.parse(record.recoveryReadStartedAt)) &&
    Number.isFinite(Date.parse(record.responseObservedAt)) &&
    Date.parse(record.recoveryReadStartedAt) >= Date.parse(expected.originalAttemptStartedAt) &&
    Date.parse(record.responseObservedAt) >= Date.parse(record.recoveryReadStartedAt),
    'COMMERCE_RPC_RECOVERY_BINDING_CHANGED');
  return record;
}
async function fileMatches(file, { full = false, strict = true } = {}) {
  let info;
  try { info = await lstat(file.path); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  need(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077),
    'COMMERCE_RPC_RECOVERY_FILE_CHANGED');
  if (info.size !== file.bytes) { need(!strict, 'COMMERCE_RPC_RECOVERY_FILE_CHANGED'); return false; }
  if (full && sha(await readPrivateFile(file.path, file.bytes)) !== file.sha256) {
    need(!strict, 'COMMERCE_RPC_RECOVERY_FILE_CHANGED'); return false;
  }
  return true;
}
function delivery(record) {
  return { status: 'SAVED', ...record.response, source: 'SETTLED_RPC_RECOVERY_READ',
    originalAttemptStartedAt: record.request.originalAttemptStartedAt,
    recoveryReadStartedAt: record.recoveryReadStartedAt, responseObservedAt: record.responseObservedAt,
    publishedAt: record.publishedAt, transaction: record.request.settlement.transaction };
}

/** The original SF36 reader authenticates settlement. This adapter owns no signer,
 * approval or payment endpoint; the existing provider and byte writer do the work. */
export function createJsonrpcCommerceRecovery({ saved, queue, application, availability,
  environment = process.env, node = process.execPath, signal } = {}) {
  const options = job => ({ root: queue.root, intentId: job.operation.intentId,
    workspace: saved.buyers.find(row => row.intentId === job.operation.intentId)?.workspace,
    environment, node, signal });
  const directoryFor = job => join(queue.root, 'jobs', job.id, 'rpc-response-recovery');
  function eligible(job) {
    return job.attempt?.kind === 'EXECUTE' && options(job).workspace &&
      job.outcome?.responseFile?.status !== 'SAVED' &&
      (job.outcome?.error?.paymentSent === true || job.outcome?.status === 'PAYMENT_OUTCOME_UNKNOWN' ||
        job.recovery?.observationStatus === 'PAYMENT_OUTCOME_UNKNOWN');
  }
  async function captures(job, paid) {
    const directory = directoryFor(job), expected = identity(job, saved, paid);
    let names;
    try { names = await readdir(directory); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const records = [];
    for (const name of names.filter(name => /^[a-f0-9-]{36}$/.test(name)).sort()) {
      const folder = join(directory, name), read = await optionalJson(join(folder, 'read.json'));
      if (!read) continue;
      bound(read, expected, job.responseDestination);
      const complete = await optionalJson(join(folder, 'completed.json'));
      if (complete) {
        bound(complete, expected, job.responseDestination);
        need(isDeepStrictEqual(complete.response, read.response) &&
          complete.recoveryReadStartedAt === read.recoveryReadStartedAt &&
          complete.responseObservedAt === read.responseObservedAt,
          'COMMERCE_RPC_RECOVERY_BINDING_CHANGED');
      }
      records.push({ folder, read, complete });
    }
    return records;
  }
  async function inspect(job) {
    if (!eligible(job)) return null;
    const original = await inspectMissingReceiptAttempt(options(job));
    const recovered = await readMissingReceiptRecovery({ ...options(job),
      expectedRequestSha256: original.expectedRequestSha256 });
    if (!recovered) return { state: 'PAYMENT_RECONCILIATION_REQUIRED', original,
      settlement: null, responseFile: null, canVerify: true, canRecover: false };
    const paid = settlement(recovered, job), records = await captures(job, paid);
    const complete = records.find(row => row.complete);
    if (complete) {
      need(await fileMatches(complete.complete.response), 'COMMERCE_RPC_RECOVERY_FILE_MISSING');
      return { state: 'SETTLED_RESULT_RECOVERED', original, settlement: paid,
        responseFile: delivery(complete.complete), canVerify: false, canRecover: false };
    }
    const route = availability?.snapshot().routes.find(row => row.id === job.merchant.routeId);
    return { state: 'SETTLED_RESPONSE_RECOVERY_PENDING', original, settlement: paid,
      responseFile: null, canVerify: false, canRecover: !route || route.state === 'selling',
      productState: route?.state ?? 'selling', localCaptureAvailable: records.length > 0 };
  }
  async function verify(job, selected) {
    need(eligible(job), 'COMMERCE_RPC_MISSING_RECEIPT_REQUIRED');
    need(selected.expectedAttemptId === job.attempt.id && selected.expectedConfigSha256 === job.configSha256,
      'COMMERCE_RPC_RECOVERY_SELECTION_CHANGED');
    const { transaction, expectedRequestSha256, expectedAttemptId, expectedConfigSha256 } = selected;
    return recoverMissingReceipt({ ...options(job), transaction, expectedRequestSha256,
      expectedAttemptId, expectedConfigSha256 });
  }
  async function recover(job, selected) {
    need(eligible(job) && !signal?.aborted, 'COMMERCE_RPC_RECOVERY_UNAVAILABLE');
    need(selected.expectedAttemptId === job.attempt.id && selected.expectedConfigSha256 === job.configSha256 &&
      HASH.test(selected.expectedRequestSha256 ?? '') && HASH.test(selected.transaction ?? ''),
      'COMMERCE_RPC_RECOVERY_SELECTION_CHANGED');
    const checked = await readMissingReceiptRecovery({ ...options(job),
      expectedRequestSha256: selected.expectedRequestSha256 });
    const paid = settlement(checked, job);
    need(paid.transaction === selected.transaction, 'COMMERCE_RPC_RECOVERY_SETTLEMENT_CHANGED');
    const cfgPath = join(queue.root, 'jobs', job.id, 'execution.json');
    need(sha(await readPrivateFile(cfgPath, 65536)) === job.configSha256, 'COMMERCE_RPC_RECOVERY_CONFIG_CHANGED');
    const cfg = await readBuyerConfig(cfgPath), { op, download } = execution(cfg);
    need(download && download.destination === job.responseDestination, 'COMMERCE_RPC_RECOVERY_DESTINATION_REQUIRED');
    const reviewed = await readJsonrpcCommerce(saved.seller.jsonrpc,
      { expectedSha256: saved.seller.jsonrpcSha256 });
    const body = op.bodyFile ? await readPrivateFile(op.bodyFile, 131072) : null;
    need(body && body.length === job.bodyBytes && sha(body) === job.bodySha256,
      'COMMERCE_RPC_RECOVERY_BODY_CHANGED');
    const context = { method: op.method, url: new URL(op.url), query: {}, body: parseJson(body),
      rawBody: body, bodyPresent: true, headers: { ...op.headers }, pathParams: {}, signal };
    validateJsonrpcCommerceRequest(reviewed, job.merchant.routeId, context);
    const directory = directoryFor(job); await privateDirectory(directory);
    const lease = await acquireStateLease(directory);
    try {
      const records = await captures(job, paid);
      const complete = records.find(row => row.complete);
      if (complete) {
        need(await fileMatches(complete.complete.response, { full: true }), 'COMMERCE_RPC_RECOVERY_FILE_MISSING');
        return { state: 'SETTLED_RESULT_RECOVERED', responseFile: delivery(complete.complete), providerReads: 0 };
      }
      // Complete the same captured file after a writer/metadata publication gap.
      for (const row of records) if (await fileMatches(row.read.response, { full: true, strict: false })) {
        if (!row.complete) {
          const completed = { ...row.read, publishedAt: now(), publication: 'ORIGINAL_LOCAL_BYTES_RECOVERED' };
          lease.assertHeld(); await save(join(row.folder, 'completed.json'), completed);
          return { state: 'SETTLED_RESULT_RECOVERED', responseFile: delivery(completed), providerReads: 0 };
        }
        return { state: 'SETTLED_RESULT_RECOVERED', responseFile: delivery(row.complete), providerReads: 0 };
      }
      const route = availability?.snapshot().routes.find(row => row.id === job.merchant.routeId);
      need(!route || route.state === 'selling', 'COMMERCE_RPC_PRODUCT_UNAVAILABLE');
      const output = await prepareBuyerResponseFile(download);
      try {
        need(!signal?.aborted, 'COMMERCE_INTERRUPTED');
        const admitted = await application.handlers['admit' + job.merchant.routeId](context);
        need(admitted === true, 'COMMERCE_RPC_PROVIDER_UNAVAILABLE');
        const recoveryReadStartedAt = now();
        const response = await application.handlers[job.merchant.routeId](context);
        need(response.status === 200 && Buffer.isBuffer(response.body), 'COMMERCE_RPC_RECOVERY_READ_FAILED');
        const responseObservedAt = now(), folder = join(directory, randomUUID());
        await privateDirectory(folder);
        const read = { schema: SCHEMA, request: identity(job, saved, paid),
          dataNetwork: reviewed.plan.dataNetwork, recoveryReadStartedAt, responseObservedAt,
          response: { path: download.destination, bytes: response.body.length, sha256: sha(response.body),
            contentType: 'application/json' },
          source: 'NEW_ORIGINAL_PROVIDER_READ_FOR_EXISTING_SETTLED_OPERATION' };
        lease.assertHeld(); await save(join(folder, 'read.json'), read);
        const result = await output.saveBytes(response.body, { contentType: 'application/json', signal });
        need(result.path === read.response.path && result.bytes === read.response.bytes && result.sha256 === read.response.sha256,
          'COMMERCE_RPC_RECOVERY_FILE_CHANGED');
        const completed = { ...read, publishedAt: now(), publication: 'ORIGINAL_PRIVATE_RESPONSE_WRITER' };
        lease.assertHeld(); await save(join(folder, 'completed.json'), completed);
        return { state: 'SETTLED_RESULT_RECOVERED', responseFile: delivery(completed), providerReads: 1 };
      } finally { await output.abort(); }
    } finally { await lease.close(); }
  }
  return Object.freeze({ inspect, verify, recover });
}
