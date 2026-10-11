// MIT — Consume the original SF88 inbox API or its exact native list export.
import { basename } from 'node:path';
import { digest, requireValue, readSnapshot } from './files.mjs';
const HASH = /^[a-f0-9]{64}$/;
const text = (value, maximum = 256) => typeof value === 'string' ? value.slice(0, maximum) : null;
function publicUrl(value) {
  try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) ? u.origin + u.pathname : ''; }
  catch { return ''; }
}
export async function readSource(config) {
  if (config.kind === 'collection') {
    const {readCollectionSource} = await import('./collection-package.mjs');
    return readCollectionSource(config);
  }
  let records, bytes;
  if (config.kind === 'inbox') {
    const {openQueue} = await import('../queue.mjs');
    records = await (await openQueue(config.source)).list();
    bytes = Buffer.from(JSON.stringify(records));
  } else {
    bytes = await readSnapshot(config.source);
    try { records = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
    catch { requireValue(false, 'ORIGINAL_INBOX_JSON_REQUIRED'); }
  }
  requireValue(Array.isArray(records) && records.length <= 10000, 'ORIGINAL_INBOX_LIST_REQUIRED');
  const rejected = [], resources = [], seen = new Set();
  let withoutFile = 0;
  for (const job of records) {
    const intent = job?.operation?.intentId;
    if (job?.state === 'REVIEW_REQUIRED') {
      rejected.push({id:text(job.id), code:'ORIGINAL_INBOX_REVIEW_REQUIRED'}); continue;
    }
    if (job?.schema !== 'stellar-forge.sf88.buyer-inbox.v1' || typeof intent !== 'string' ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(intent) || job.id !== digest(intent) ||
      !HASH.test(job.configSha256 ?? '')) {
      rejected.push({id:text(job?.id), code:'ORIGINAL_INBOX_RECORD_INVALID'}); continue;
    }
    const saved = job.outcome?.responseFile;
    if (!saved) { withoutFile++; continue; }
    if (job.outcome.intentId !== intent || job.outcome.mode !== 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT') {
      rejected.push({id:job.id, code:'ORIGINAL_SUMMARY_IDENTITY_MISMATCH'}); continue;
    }
    const id = digest(JSON.stringify([config.kind,config.source,job.id,job.configSha256,
      saved.path ?? saved.destination ?? null,saved.sha256 ?? null]));
    if (seen.has(id)) { rejected.push({id:job.id,code:'DUPLICATE_ORIGINAL_RESOURCE'}); continue; }
    seen.add(id);
    const expect = job.operation.expect ?? {};
    resources.push({id, intentId:intent, inboxId:job.id, configSha256:job.configSha256,
      createdAt:text(job.createdAt), queueState:text(job.state),
      method:text(job.operation.method,16), url:publicUrl(job.operation.url),
      name:typeof saved.path === 'string' ? basename(saved.path) : intent,
      path:typeof saved.path === 'string' ? saved.path : null,
      bytes:Number.isSafeInteger(saved.bytes) && saved.bytes >= 0 ? saved.bytes : null,
      sha256:typeof saved.sha256 === 'string' && HASH.test(saved.sha256) ? saved.sha256 : null,
      contentType:text(saved.contentType), deliveryStatus:text(saved.status),
      buyerStatus:text(job.outcome.status), httpStatus:Number.isInteger(job.outcome.httpStatus) ? job.outcome.httpStatus : null,
      paymentTerms:{scheme:text(expect.scheme),network:text(expect.network),asset:text(expect.asset),
        payTo:text(expect.payTo),maxAtomic:typeof expect.maxAtomic === 'string' ? expect.maxAtomic : null},
      source:{kind:config.kind,path:config.source},
      status:saved.status === 'SAVED' ? 'UNVERIFIED' : 'INCOMPLETE'});
  }
  return {resources, details:{sourceSha256:digest(bytes), sourceBytes:bytes.length,
    jobCount:records.length, resourceCount:resources.length, withoutFile, rejected}};
}
