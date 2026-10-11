// MIT. Native x402 settlement -> durable minimal merchant delivery event.
// This does not verify payments: ONLY the original SF30 native server can do so.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { selectServiceRoute } from '../sf30-seller-sdk/route-path.mjs';
import { supportsSellerMethod } from '../sf30-seller-sdk/http-methods.mjs';

export const SCHEMA = 'stellar-forge.sf98.delivery-event.v1';
const hash = x => createHash('sha256').update(x).digest('hex');
const okId = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const date = () => new Date().toISOString();

function parseLine(line, path, index) {
  let data;
  try { data = JSON.parse(line); } catch { throw new Error('CORRUPT_JOURNAL:' + path + ':' + index); }
  if (!data || typeof data !== 'object' || !okId(data.id)) throw new Error('INVALID_JOURNAL_RECORD:' + path + ':' + index);
  return data;
}
async function loadLines(path) {
  let data;
  try { data = await readFile(path, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  if (data && !data.endsWith('\n')) throw new Error('TRUNCATED_JOURNAL:' + path);
  return data.split('\n').filter(Boolean).map((x, i) => parseLine(x, path, i + 1));
}
async function append(dir, name, row) {
  const path = join(dir, name);
  const flags = constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(path, flags, 0o600);
  try {
    const meta = await handle.stat();
    if (!meta.isFile() || (meta.mode & 0o077) !== 0) throw new Error('PRIVATE_JOURNAL_REQUIRED:' + name);
    const bytes = Buffer.from(JSON.stringify(row) + '\n');
    if (bytes.length > 8192) throw new RangeError('JOURNAL_RECORD_TOO_LARGE');
    // One append per record; a single operator process owns this directory.
    const { bytesWritten } = await handle.write(bytes);
    if (bytesWritten !== bytes.length) throw new Error('SHORT_JOURNAL_WRITE');
    await handle.sync();
  } finally { await handle.close(); }
}
function receiptFromSuccess(settled, payment) {
  const headers = settled?.headers;
  if (!headers || typeof headers !== 'object') return null;
  const match = Object.entries(headers).find(([k]) =>
    ['payment-response', 'x-payment-response'].includes(k.toLowerCase()));
  const text = match?.[1];
  if (typeof text !== 'string' || text.length < 8 || text.length > 16384 ||
      !/^[A-Za-z0-9+/=]+$/.test(text)) return null;
  const bytes = Buffer.from(text, 'base64');
  if (!bytes.length || bytes.length > 12288 ||
      bytes.toString('base64').replace(/=+$/, '') !== text.replace(/=+$/, '')) return null;
  let original;
  try { original = JSON.parse(bytes.toString('utf8')); }
  catch { return null; }
  if (!original || typeof original !== 'object' || Array.isArray(original)) return null;
  // The native result and its receipt must describe the selected option. A
  // second advertised network must never be journaled under the first network.
  if (original.success !== true || original.network !== payment.network ||
      (original.amount !== undefined && original.amount !== payment.amount)) return null;
  const transaction = typeof original.transaction === 'string' &&
    /^[0-9a-f]{64}$/i.test(original.transaction) ? original.transaction.toLowerCase() : null;
  return { receiptHash: hash(bytes), transactionHash: transaction && hash(transaction) };
}
function selectedPayment(route, requirement) {
  if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement) ||
      !Array.isArray(route?.offer?.accepts)) return null;
  // processHTTPRequest returns these exact verified requirements, and SF30
  // passes them unchanged as processSettlement's second argument. The native
  // scheme can enrich extra (for example areFeesSponsored), so bind the six
  // configured payment fields rather than comparing an SDK-enriched object to
  // an unevaluated offer. SF30 rejects duplicate network/asset/payee options.
  const fields = ['scheme', 'network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds'];
  const matches = route.offer.accepts.filter(option =>
    fields.every(field => option?.[field] === requirement[field]));
  return matches.length === 1 ? requirement : null;
}
export function nativeEvent(compiled, args, settled, at = date()) {
  if (settled?.success !== true) return null;
  const context = args[3]?.request;
  if (!context || !supportsSellerMethod(context.method) ||
      typeof context.path !== 'string') return null;
  const selected = selectServiceRoute(compiled.routes, context.path, context.method);
  const route = selected?.route;
  const payment = selectedPayment(route, args[1]);
  if (!payment) return null;
  const receipt = receiptFromSuccess(settled, payment);
  if (!receipt) return null;
  const rawRef = context.adapter?.getHeader?.('x-sf98-order-id');
  const reference = typeof rawRef === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(rawRef) ?
    rawRef : null;
  const fingerprint = receipt.transactionHash ?? receipt.receiptHash;
  const id = hash(['sf98.v1', route.id, context.method, payment.network, fingerprint].join('\n'));
  return Object.freeze({
    schema: SCHEMA, id, at, routeId: route.id, method: context.method,
    network: payment.network, amountAtomic: String(payment.amount),
    assetDigest: hash(String(payment.asset)),
    recipientDigest: hash(String(payment.payTo)),
    receiptFingerprint: receipt.receiptHash,
    transactionFingerprint: receipt.transactionHash,
    orderReference: reference,
    authority: 'ORIGINAL_NATIVE_PROCESS_SETTLEMENT_SUCCESS',
  });
}
export async function openOutbox(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || directory === '/' ||
      resolve(directory) !== directory) throw new TypeError('Absolute normalized private state directory required');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await stat(directory);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0)
    throw new Error('PRIVATE_STATE_DIRECTORY_REQUIRED_0700');
  const eventsFile = join(directory, 'events.ndjson');
  const attemptsFile = join(directory, 'deliveries.ndjson');
  // Load once at startup; do not scan a growing journal on every paid request.
  const seen = new Set((await loadLines(eventsFile)).map(row => row.id));
  let appendTail = Promise.resolve();
  return Object.freeze({
    dir: directory,
    async record(event) {
      if (event?.schema !== SCHEMA || !okId(event.id) ||
          !/^[A-Za-z0-9_-]{1,80}$/.test(event.routeId) ||
          !supportsSellerMethod(event.method) ||
          (event.recipientDigest !== undefined && event.recipientDigest !== null && !okId(event.recipientDigest)) ||
          typeof event.receiptFingerprint !== 'string') throw new TypeError('Invalid native settlement event');
      // Native HTTP requests can settle simultaneously. Keep one append in flight,
      // with a stable dedup set updated only after durable journal fsync.
      const operation = appendTail.then(async () => {
        if (seen.has(event.id)) return { id: event.id, duplicate: true };
        await append(directory, 'events.ndjson', event);
        seen.add(event.id);
        return { id: event.id, duplicate: false };
      });
      appendTail = operation.then(() => undefined, () => undefined);
      return operation;
    },
    async recordDelivery(status) {
      if (!okId(status?.id) || !['DELIVERED', 'RETRY', 'EXHAUSTED', 'REQUEUE'].includes(status.state) ||
          !Number.isInteger(status.attempt) || status.attempt < 0 || status.attempt > 100)
        throw new TypeError('Invalid delivery status');
      await append(directory, 'deliveries.ndjson', status);
    },
    async rows() {
      const events = await loadLines(eventsFile), attempts = await loadLines(attemptsFile);
      const states = new Map();
      for (const line of attempts) states.set(line.id, line);
      const unique = new Map();
      for (const event of events) {
        if (event.schema !== SCHEMA) throw new Error('INVALID_EVENT_SCHEMA');
        if (unique.has(event.id) && JSON.stringify(unique.get(event.id)) !== JSON.stringify(event))
          throw new Error('CONFLICTING_EVENT_ID:' + event.id);
        unique.set(event.id, event);
      }
      for (const id of states.keys()) if (!unique.has(id)) throw new Error('ORPHAN_DELIVERY:' + id);
      return [...unique.values()].map(event => ({ event, state: states.get(event.id) ?? null }));
    },
    async status() {
      const rows = await this.rows();
      return { schema: 'stellar-forge.sf98.outbox-status.v1',
        uniqueNativeReceipts: rows.length,
        delivered: rows.filter(x => x.state?.state === 'DELIVERED').length,
        exhausted: rows.filter(x => x.state?.state === 'EXHAUSTED').length,
        pending: rows.filter(x => !x.state || ['RETRY', 'REQUEUE'].includes(x.state.state)).length };
    },
    async requeue(id) {
      if (!okId(id)) throw new TypeError('Invalid event ID');
      const row = (await this.rows()).find(x => x.event.id === id);
      if (!row || row.state?.state !== 'EXHAUSTED') throw new Error('ONLY_EXHAUSTED_EVENTS_CAN_BE_REQUEUED');
      await this.recordDelivery({ id, state: 'REQUEUE', at: date(), attempt: 0, nextAt: null });
    },
  });
}
/**
 * A drop-in, original-native-compatible server factory decorator. Never throw
 * after native success: a secondary delivery-journal fault must not turn an
 * irrevocably settled merchant request into a failed resource response.
 */
export function instrumentNativeSettlement(nativeServer, { compiled, outbox, onWriteFailure = () => {} }) {
  if (!nativeServer || ['processHTTPRequest', 'processSettlement', 'createFailurePathSettlementHeaders']
    .some(name => typeof nativeServer[name] !== 'function') || typeof outbox?.record !== 'function')
    throw new TypeError('Original native server and open SF98 outbox required');
  return Object.freeze({
    processHTTPRequest: (...args) => nativeServer.processHTTPRequest(...args),
    createFailurePathSettlementHeaders: (...args) =>
      nativeServer.createFailurePathSettlementHeaders(...args),
    async processSettlement(...args) {
      const result = await nativeServer.processSettlement(...args);
      if (result?.success === true) {
        try {
          const event = nativeEvent(compiled, args, result);
          if (!event) throw new Error('NATIVE_SUCCESS_WITHOUT_SUPPORTED_SETTLEMENT_RECEIPT');
          await outbox.record(event);
        } catch (error) {
          try { onWriteFailure(error); } catch { /* original payment result always wins */ }
        }
      }
      return result;
    },
  });
}
