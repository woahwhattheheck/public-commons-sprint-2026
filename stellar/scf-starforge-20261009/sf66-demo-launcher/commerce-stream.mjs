// MIT. Stream presentation over the original frozen SF88 inbox and SF31 files.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execution } from '../sf88-operator-buyer-cli/config.mjs';
import { BuyerResult } from '../sf88-operator-buyer-cli/node/result.mjs';
import { readExaAnswer } from '../sf88-operator-buyer-cli/node/examples/exa-answer.mjs';
import { readPrivateFile, parseJson } from '../sf103-native-buyer-signer/operator.mjs';
import { analyzeOne } from '../sf52-buyer-outcomes/outcomes.mjs';

const runtime = fileURLToPath(new URL('../sf88-operator-buyer-cli/', import.meta.url));
const HASH = /^[a-f0-9]{64}$/;
const PARTIAL = /^\.x402-response-[a-f0-9-]{36}\.partial$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;

function retainedFile(download, saved) {
  if (!saved || !integer(saved.bytes, 0, download.maxBytes)) return null;
  if (saved.status === 'SAVED' && typeof saved.path === 'string' &&
      resolve(saved.path) === resolve(download.destination) && HASH.test(saved.sha256 ?? ''))
    return { available:true, status:'SAVED', path:saved.path, name:basename(saved.path),
      bytes:saved.bytes, sha256:saved.sha256, contentType:saved.contentType ?? null };
  if (saved.status === 'FAILED' && typeof saved.partialPath === 'string' && saved.bytes > 0 &&
      dirname(resolve(saved.partialPath)) === dirname(resolve(download.destination)) && PARTIAL.test(basename(saved.partialPath)) &&
      HASH.test(saved.partialSha256 ?? '') && saved.stream?.format === download.stream.format &&
      integer(saved.stream.lastCompleteByte, 0, saved.bytes))
    return { available:true, status:'PARTIAL', path:saved.partialPath,
      name:basename(download.destination) + '.partial', bytes:saved.bytes, sha256:saved.partialSha256,
      contentType:saved.contentType ?? null };
  return null;
}

async function observeCapture(download) {
  // This is the writer's existing reservation, not a second progress journal.
  const lock = join(dirname(download.destination), `.${basename(download.destination)}.x402-download.lock`);
  try {
    const held = parseJson(await readPrivateFile(lock, 4096));
    need(typeof held.destination === 'string' && resolve(held.destination) === resolve(download.destination) &&
      typeof held.partialPath === 'string' &&
      dirname(resolve(held.partialPath)) === dirname(resolve(download.destination)) && PARTIAL.test(basename(held.partialPath)) &&
      integer(held.pid, 1, Number.MAX_SAFE_INTEGER), 'COMMERCE_STREAM_RESERVATION_INVALID');
    const file = await open(held.partialPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await file.stat();
      need(info.isFile() && (info.mode & 0o077) === 0 && info.size <= download.maxBytes &&
        (process.platform === 'win32' || info.uid === process.getuid()), 'COMMERCE_STREAM_PARTIAL_INVALID');
      return { bytes:info.size, lastWriteAt:new Date(info.mtimeMs).toISOString(), observedAt:new Date().toISOString() };
    } finally { await file.close(); }
  } catch (error) {
    // Allocation/final publication may race an observation. The next original
    // inbox snapshot supplies the completed outcome when it becomes available.
    if (error.code === 'ENOENT') return null;
    return { bytes:null, observationError:error.code ?? 'COMMERCE_STREAM_OBSERVATION_PENDING' };
  }
}

async function paymentObservation(job, selected) {
  if (!job.attempt || job.attempt.kind !== 'EXECUTE') return null;
  try {
    need(typeof job.evidencePath === 'string' && resolve(job.evidencePath) === resolve(selected.evidencePath),
      'COMMERCE_STREAM_EVIDENCE_PATH_CHANGED');
    const evidence = parseJson(await readPrivateFile(job.evidencePath, 4194304));
    const observed = evidence.observation, terms = observed?.buyer?.requirement;
    need(evidence.schema === 'scf82.checkout-evidence.v1' && evidence.intentId === selected.op.intentId &&
      observed?.intentId === selected.op.intentId && evidence.observedAt === observed.observedAt &&
      Number.isFinite(Date.parse(evidence.observedAt)) && Date.parse(evidence.observedAt) >= Date.parse(job.attempt.startedAt),
    'COMMERCE_STREAM_EVIDENCE_INTENT_CHANGED');
    if (terms) need(['scheme','network','asset','payTo'].every(key => terms[key] === selected.op.expect[key]) &&
      typeof terms.amount === 'string' && /^[1-9][0-9]*$/.test(terms.amount) &&
      BigInt(terms.amount) <= BigInt(selected.op.expect.maxAtomic), 'COMMERCE_STREAM_EVIDENCE_TERMS_CHANGED');
    if (evidence.operatorReservation) need(evidence.operatorReservation.requestId === selected.op.intentId &&
      (evidence.operatorReservation.network === undefined || evidence.operatorReservation.network === selected.op.expect.network),
    'COMMERCE_STREAM_EVIDENCE_RESERVATION_CHANGED');
    return { buyerStatus:observed.buyer.status, settlement:observed.buyer.settlement ?? null,
      receipt:observed.buyer.receipt ?? null, reservation:evidence.operatorReservation ?? null,
      observedAt:evidence.observedAt, transfer:analyzeOne(observed) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { error:error.code ?? 'COMMERCE_STREAM_EVIDENCE_UNAVAILABLE' };
  }
}

/** One reader attached to an original queue; every browser selection is an intent. */
export function createCommerceStreamAccess(queueRoot) {
  need(typeof queueRoot === 'string' && resolve(queueRoot) === queueRoot, 'COMMERCE_STREAM_INBOX_REQUIRED');
  const configurations = new Map();
  async function configuration(job) {
    need(HASH.test(job?.id ?? '') && HASH.test(job.configSha256 ?? ''), 'COMMERCE_STREAM_ORIGINAL_JOB_REQUIRED');
    const key = job.id + ':' + job.configSha256;
    if (configurations.has(key)) return configurations.get(key);
    const bytes = await readPrivateFile(join(queueRoot, 'jobs', job.id, 'execution.json'));
    need(sha(bytes) === job.configSha256, 'COMMERCE_STREAM_REQUEST_CHANGED');
    const raw = parseJson(bytes), selected = { ...execution(raw), evidencePath:join(raw.evidenceDir, job.id + '.json') };
    need(selected.op.intentId === job.operation.intentId && sha(selected.op.intentId) === job.id,
      'COMMERCE_STREAM_INTENT_CHANGED');
    configurations.set(key, selected);
    return selected;
  }
  async function original(job) {
    const selected = await configuration(job);
    need(selected.download?.stream, 'COMMERCE_STREAM_NOT_CONFIGURED');
    need(job.outcome && job.outcome.intentId === job.operation.intentId,
      'COMMERCE_STREAM_ORIGINAL_RESULT_REQUIRED');
    // The exact native summary is the reader's record. No process result or
    // financial success is supplied or inferred by this presentation adapter.
    return { selected, result:new BuyerResult({native:job.outcome}, selected.download, runtime) };
  }
  async function inspect(job, { active = false } = {}) {
    const selected = await configuration(job), { op, download, requestTimeoutMs } = selected;
    if (!download?.stream) return null;
    const saved = job.outcome?.responseFile, file = retainedFile(download, saved);
    const live = active && !saved ? await observeCapture(download) : null;
    const phase = file?.status === 'SAVED' ? 'COMPLETE' : file?.status === 'PARTIAL' ? 'PARTIAL' :
      saved?.status === 'FAILED' ? 'FAILED' : active ? (live?.bytes > 0 ? 'CAPTURING' : 'AWAITING_RESPONSE') :
      job.state === 'QUEUED' ? 'PREPARED' : job.state === 'CANCELLED' ? 'CANCELLED' :
      job.outcome ? 'NO_CAPTURE' : 'RECOVERY_REQUIRED';
    const observedPayment = await paymentObservation(job, selected);
    return { phase, format:download.stream.format,
      configuration:{paymentFlow:op.expect.paymentFlow ?? 'authorization', requestTimeoutMs, responseFile:download},
      bytes:file?.bytes ?? live?.bytes ?? saved?.bytes ?? 0,
      records:saved?.stream?.records ?? null, complete:saved?.stream?.complete ?? false,
      lastCompleteByte:saved?.stream?.lastCompleteByte ?? null,
      pendingRecord:saved?.stream?.pendingRecord ?? null, sha256:file?.sha256 ?? null,
      lastWriteAt:live?.lastWriteAt ?? null, observedAt:live?.observedAt ?? null,
      observationError:live?.observationError ?? null,
      error:saved?.code ?? null, canReadRecords:Boolean(file), canDownloadPartial:file?.status === 'PARTIAL',
      canReadAnswer:Boolean(file) && download.stream.format === 'sse' && job.merchant?.routeId === 'exa-answer',
      payment:{buyerStatus:job.outcome?.status ?? observedPayment?.buyerStatus ?? null,
        settlement:job.outcome?.sellerReportedSettlement ?? observedPayment?.settlement ?? null,
        receipt:observedPayment?.receipt ?? null, transfer:observedPayment?.transfer ?? null,
        reservation:job.outcome?.operatorReservation ?? observedPayment?.reservation ?? null,
        observedAt:observedPayment?.observedAt ?? null,
        evidencePath:job.outcome?.evidencePath ?? job.evidencePath ?? null,
        evidenceError:job.outcome?.evidenceError?.code ?? observedPayment?.error ?? null,
        paymentSent:job.outcome?.error?.paymentSent ?? null},
    };
  }
  async function records(job, { offset = 0, limit = 25, query = '', allowPartial = false, signal } = {}) {
    need(integer(offset, 0, 1000000) && integer(limit, 1, 100) && typeof query === 'string' &&
      query.length <= 256 && typeof allowPartial === 'boolean', 'COMMERCE_STREAM_PAGE_INVALID');
    const {selected, result} = await original(job), format = selected.download.stream.format;
    const iterator = format === 'sse' ? result.events({allowPartial, signal}) : result.ndjson({allowPartial, signal});
    const needle = query.toLocaleLowerCase(), rows = [];
    let totalRecords = 0, matches = 0;
    for await (const record of iterator) {
      totalRecords++;
      const text = format === 'sse' ? record.data : JSON.stringify(record);
      const haystack = format === 'sse' ? `${record.event}\n${record.id}\n${text}` : text;
      if (needle && !haystack.toLocaleLowerCase().includes(needle)) continue;
      if (matches >= offset && rows.length < limit) rows.push({ordinal:totalRecords,
        ...(format === 'sse' ? {index:record.index, event:record.event, id:record.id, retry:record.retry} : {}),
        text:text.slice(0, 8192), characters:text.length, truncated:text.length > 8192});
      matches++;
    }
    // Exhaust the original iterator: it checks the complete retained digest,
    // even when the requested page or complete partial prefix ends earlier.
    return {intentId:job.operation.intentId, format, offset, limit, query, totalRecords, matches, rows,
      nextOffset:offset + rows.length < matches ? offset + rows.length : null,
      partial:result.delivery.status !== 'SAVED', sha256:result.delivery.sha256 ?? result.delivery.partialSha256,
      capture:result.stream};
  }
  async function answer(job, { allowPartial = false, signal } = {}) {
    need(job.merchant?.routeId === 'exa-answer', 'COMMERCE_EXA_ANSWER_ROUTE_REQUIRED');
    const {result} = await original(job);
    const report = await readExaAnswer(result, {allowPartial, signal});
    return {intentId:job.operation.intentId, ...report,
      answer:report.answer.slice(0, 262144), answerCharacters:report.answer.length,
      answerTruncated:report.answer.length > 262144, citations:report.citations.slice(0, 200),
      citationCount:report.citations.length, citationsTruncated:report.citations.length > 200};
  }
  async function file(job, { allowPartial = false } = {}) {
    const {selected, result} = await original(job), descriptor = retainedFile(selected.download, result.delivery);
    need(descriptor && (descriptor.status === 'SAVED' || allowPartial === true), 'COMMERCE_STREAM_FILE_UNAVAILABLE');
    return descriptor;
  }
  return Object.freeze({inspect, records, answer, file});
}
