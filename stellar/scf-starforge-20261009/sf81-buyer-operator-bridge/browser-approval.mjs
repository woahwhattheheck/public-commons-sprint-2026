// MIT. Host-owned local review transport; original SF62/SF36 owns reservations.
import { createServer, createConnection } from 'node:net';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, lstat, mkdtemp, rmdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';

const SOCKET = 'SF81_APPROVAL_SOCKET', TOKEN = 'SF81_APPROVAL_TOKEN';
const SCHEMA = 'stellar-forge.sf81.browser-channel.v1';
const MAX_FRAME = 512 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9._:-]{1,160}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, status = 409) => Object.assign(new Error(code), { code, status });

/** Copy only the trusted host's ephemeral transport, never keys or seller data. */
export function operatorApprovalEnvironment(environment = process.env) {
  const path = environment[SOCKET], token = environment[TOKEN];
  if (path === undefined && token === undefined) return {};
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') ||
      Buffer.byteLength(path) > 103 || !HASH.test(token ?? ''))
    throw failure('OPERATOR_BROWSER_CHANNEL_CONFIGURATION_INVALID');
  return { [SOCKET]: path, [TOKEN]: token };
}

async function privateSocket(path) {
  let info;
  try { info = await lstat(path); } catch { throw failure('OPERATOR_BROWSER_CHANNEL_UNAVAILABLE'); }
  if (!info.isSocket() || (info.mode & 0o077) ||
      typeof process.getuid === 'function' && info.uid !== process.getuid())
    throw failure('OPERATOR_BROWSER_CHANNEL_NOT_PRIVATE');
}

async function exchange(environment, message, { signal, timeoutMs = 5000 } = {}) {
  const selected = operatorApprovalEnvironment(environment);
  if (!selected[SOCKET]) throw failure('OPERATOR_BROWSER_CHANNEL_REQUIRED');
  if (signal?.aborted) throw failure('OPERATOR_ABORTED');
  await privateSocket(selected[SOCKET]);
  const raw = Buffer.from(JSON.stringify({ schema: SCHEMA, token: selected[TOKEN], ...message }) + '\n');
  if (raw.length > MAX_FRAME) throw failure('OPERATOR_BROWSER_FRAME_TOO_LARGE');
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0), done = false;
    const socket = createConnection(selected[SOCKET]);
    const finish = (error, value) => {
      if (done) return; done = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      socket.destroy(); error ? reject(error) : resolve(value);
    };
    const abort = () => finish(failure('OPERATOR_ABORTED'));
    const timer = setTimeout(() => finish(failure('OPERATOR_BROWSER_CHANNEL_TIMEOUT')), timeoutMs);
    socket.once('connect', () => socket.write(raw));
    socket.on('error', () => finish(failure('OPERATOR_BROWSER_CHANNEL_UNAVAILABLE')));
    socket.once('close', () => finish(failure('OPERATOR_BROWSER_CHANNEL_CLOSED')));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_FRAME) return finish(failure('OPERATOR_BROWSER_FRAME_TOO_LARGE'));
      const end = buffer.indexOf(10);
      if (end < 0) return;
      if (end !== buffer.length - 1) return finish(failure('OPERATOR_BROWSER_RESPONSE_INVALID'));
      let result;
      try { result = JSON.parse(buffer.subarray(0, end)); } catch { return finish(failure('OPERATOR_BROWSER_RESPONSE_INVALID')); }
      if (result?.schema !== SCHEMA || typeof result.ok !== 'boolean')
        return finish(failure('OPERATOR_BROWSER_RESPONSE_INVALID'));
      if (!result.ok) return finish(failure(typeof result.error === 'string' ? result.error : 'OPERATOR_BROWSER_REVIEW_FAILED'));
      finish(null, result);
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function checkBrowserApprovalChannel(environment) {
  await exchange(environment, { type: 'ping' });
}

export async function requestBrowserReview(environment, record, { signal, timeoutMs = 300000 } = {}) {
  const result = await exchange(environment, { type: 'review', record, timeoutMs },
    { signal, timeoutMs: timeoutMs + 1000 });
  if (!ID.test(result.approvalId ?? '') || !['approve', 'reject'].includes(result.decision) ||
      result.inputSha256 !== record.input_sha256 || result.requestSha256 !== record.review.request_sha256)
    throw failure('OPERATOR_BROWSER_DECISION_MISMATCH');
  return result;
}

export async function finishBrowserReview(environment, decision, state) {
  if (!['APPROVED', 'FAILED'].includes(state)) throw failure('OPERATOR_BROWSER_RESULT_INVALID');
  await exchange(environment, { type: 'result', approvalId: decision.approvalId,
    requestSha256: decision.requestSha256, inputSha256: decision.inputSha256, state });
}

/** One owned broker per operator console; the browser token remains with its HTTP host. */
export async function createBrowserApprovalBroker({ directory = tmpdir() } = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new TypeError('Absolute host directory required');
  if (Buffer.byteLength(join(directory, 'sf81-XXXXXX', 'review.sock')) > 103)
    throw new TypeError('Host socket directory is too long');
  const owned = await mkdtemp(join(directory, 'sf81-'));
  const path = join(owned, 'review.sock'), token = randomBytes(32).toString('hex');
  const environment = Object.freeze(operatorApprovalEnvironment({ [SOCKET]: path, [TOKEN]: token }));
  const secret = Buffer.from(token), records = new Map(), sockets = new Set();
  let closed = false, closing;
  const view = entry => entry ? structuredClone(entry.public) : null;
  const send = (socket, value) => {
    if (!socket.destroyed) socket.end(JSON.stringify({ schema: SCHEMA, ...value }) + '\n');
  };
  const retire = (entry, state, code) => {
    if (!['AWAITING_OPERATOR', 'APPROVING'].includes(entry.public.state)) return;
    clearTimeout(entry.timer); entry.public.state = state;
    entry.public.completedAt = new Date().toISOString();
    send(entry.socket, { ok: false, error: code });
  };
  const forIntent = intent => [...records.values()].reverse().find(entry => entry.public.intentId === intent);
  const server = createServer(socket => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0), consumed = false, entry;
    const parseTimer = setTimeout(() => socket.destroy(), 5000);
    socket.on('error', () => {});
    socket.once('close', () => {
      clearTimeout(parseTimer); sockets.delete(socket);
      if (entry?.public.state === 'AWAITING_OPERATOR') {
        clearTimeout(entry.timer); entry.public.state = 'FAILED';
        entry.public.completedAt = new Date().toISOString();
      }
    });
    socket.on('data', chunk => {
      if (consumed) { socket.destroy(); return; }
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_FRAME) { socket.destroy(); return; }
      const end = buffer.indexOf(10);
      if (end < 0) return;
      consumed = true; clearTimeout(parseTimer);
      try {
        if (closed || end !== buffer.length - 1) throw failure('OPERATOR_BROWSER_REQUEST_INVALID');
        const message = JSON.parse(buffer.subarray(0, end));
        const supplied = Buffer.from(typeof message?.token === 'string' ? message.token : '');
        if (message?.schema !== SCHEMA || supplied.length !== secret.length || !timingSafeEqual(supplied, secret))
          throw failure('OPERATOR_BROWSER_CHANNEL_UNAUTHORIZED');
        if (message.type === 'ping') { send(socket, { ok: true }); return; }
        if (message.type === 'result') {
          const original = records.get(message.approvalId);
          if (!original || message.requestSha256 !== original.public.review.request_sha256 ||
              message.inputSha256 !== original.inputSha256 || !['APPROVED', 'FAILED'].includes(message.state))
            throw failure('OPERATOR_BROWSER_RESULT_MISMATCH');
          if (original.public.state === 'APPROVING') {
            original.public.state = message.state;
            original.public.completedAt = new Date().toISOString();
          } else if (original.public.state !== message.state && message.state !== 'FAILED') {
            throw failure('OPERATOR_BROWSER_RESULT_STATE_MISMATCH');
          }
          send(socket, { ok: true }); return;
        }
        if (message.type !== 'review') throw failure('OPERATOR_BROWSER_REQUEST_INVALID');
        const record = message.record, review = record?.review;
        const timeoutMs = message.timeoutMs;
        if (record?.schema !== 'stellar-forge.sf81.review.v1' || !HASH.test(record.input_sha256 ?? '') ||
            review?.schema !== 'stellar-forge.sf62.operator-review.v1' || !ID.test(review.request_id ?? '') ||
            !HASH.test(review.request_sha256 ?? '') || !object(review.complete_original_accepted_terms) ||
            !object(record.current_native_budget_estimate) || record.current_native_budget_estimate.approved !== true ||
            !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 900000)
          throw failure('OPERATOR_BROWSER_REVIEW_INVALID');
        const previous = forIntent(review.request_id);
        // Original consumers may re-enter an unpaid dataset page only after
        // their authenticated absence check. The native ledger still decides
        // fresh reservation; retain each failed/rejected review independently.
        if (previous && ['AWAITING_OPERATOR', 'APPROVING', 'APPROVED'].includes(previous.public.state))
          throw failure('OPERATOR_BROWSER_INTENT_ALREADY_REVIEWED');
        if (records.size >= 256) {
          const old = [...records.values()].find(item => !['AWAITING_OPERATOR', 'APPROVING'].includes(item.public.state));
          if (!old) throw failure('OPERATOR_BROWSER_BUSY');
          records.delete(old.public.id);
        }
        const now = Date.now();
        entry = { socket, inputSha256: record.input_sha256, public: {
          id: randomUUID(), intentId: review.request_id, state: 'AWAITING_OPERATOR',
          createdAt: new Date(now).toISOString(), expiresAt: new Date(now + timeoutMs).toISOString(),
          review, current_native_budget_estimate: record.current_native_budget_estimate,
        } };
        entry.timer = setTimeout(() => retire(entry, 'EXPIRED', 'OPERATOR_BROWSER_REVIEW_EXPIRED'), timeoutMs);
        records.set(entry.public.id, entry);
      } catch (error) { send(socket, { ok: false, error: error.code ?? 'OPERATOR_BROWSER_REQUEST_INVALID' }); }
    });
  });
  try {
    await chmod(owned, 0o700);
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(path, resolve);
    });
    await chmod(path, 0o600);
  } catch (error) {
    server.close(); await rmdir(owned).catch(() => {}); throw error;
  }
  return Object.freeze({ environment,
    snapshot(intentId) { return view(forIntent(intentId)); },
    decide({ intent, approvalId, requestSha256, decision } = {}) {
      const entry = records.get(approvalId);
      if (closed || !entry || entry.public.intentId !== intent ||
          entry.public.review.request_sha256 !== requestSha256 || !['approve', 'reject'].includes(decision))
        throw failure('OPERATOR_BROWSER_DECISION_MISMATCH');
      if (entry.decision === decision && ['APPROVING', 'APPROVED', 'REJECTED'].includes(entry.public.state)) return view(entry);
      if (entry.public.state !== 'AWAITING_OPERATOR') throw failure('OPERATOR_BROWSER_REVIEW_NO_LONGER_PENDING');
      if (Date.now() >= Date.parse(entry.public.expiresAt)) {
        retire(entry, 'EXPIRED', 'OPERATOR_BROWSER_REVIEW_EXPIRED');
        throw failure('OPERATOR_BROWSER_REVIEW_EXPIRED');
      }
      if (entry.socket.destroyed) {
        retire(entry, 'FAILED', 'OPERATOR_BROWSER_CHANNEL_CLOSED');
        throw failure('OPERATOR_BROWSER_CHANNEL_CLOSED');
      }
      clearTimeout(entry.timer); entry.decision = decision;
      entry.public.state = decision === 'approve' ? 'APPROVING' : 'REJECTED';
      entry.public.decidedAt = new Date().toISOString();
      send(entry.socket, { ok: true, approvalId, decision, requestSha256, inputSha256: entry.inputSha256 });
      return view(entry);
    },
    revoke(intentId) {
      const entry = forIntent(intentId);
      if (entry) retire(entry, 'FAILED', 'OPERATOR_ABORTED');
    },
    close() {
      return closing ??= (async () => {
        closed = true;
        for (const entry of records.values()) retire(entry, 'FAILED', 'OPERATOR_BROWSER_CHANNEL_CLOSED');
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await rmdir(owned);
      })();
    },
  });
}
