// MIT. Trusted operator-host composition of original SF31 + SF62/SF54/SF59/SF36.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { X402BuyerClient } from '../sf31-buyer-client/buyer.mjs';
import { createPublicHttpsFetch } from '../sf31-buyer-client/public-transport.mjs';
import { operatorApprovalEnvironment, checkBrowserApprovalChannel,
  requestBrowserReview, finishBrowserReview } from './browser-approval.mjs';
export { createBrowserApprovalBroker, operatorApprovalEnvironment } from './browser-approval.mjs';

const helper = fileURLToPath(new URL('./approve.py', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const keys = ['SF36_CONSENT_KEY_B64', 'SF36_AUDIT_KEY_B64', 'SF36_OPERATOR_KEY_B64'];
let terminalBusy = false;

/** Versioned wire formats implemented by this bridge and its paired helper. */
export const OPERATOR_APPROVAL_CAPABILITIES = Object.freeze({
  schema: 'stellar-forge.sf81.capabilities.v1',
  review_channels: Object.freeze(['terminal', 'pipe']),
  review_schema: 'stellar-forge.sf81.review.v1',
  decision_schema: 'stellar-forge.sf81.decision.v1',
  approval_schema: 'stellar-forge.sf81.approval.v1',
  operator_review_schema: 'stellar-forge.sf62.operator-review.v1',
});

/**
 * Query this imported module's own helper with the same trusted Python selected
 * for createOperatorApproval. Other operator fields are deliberately unused.
 * Import the bridge from the original retained runtime before calling this
 * probe; it does not select or relocate a foreign helper or accounting runtime.
 * A supported result describes the pipe protocol. checkOperatorChannel checks
 * the owning host's live transport separately.
 */
export async function probeOperatorApprovalCapabilities({ python } = {},
  { timeoutMs = 3000, signal } = {}) {
  if (typeof python !== 'string' || !isAbsolute(python) || python.includes('\0'))
    throw new TypeError('python must be the trusted absolute interpreter path');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000)
    throw new TypeError('capability timeout must be 100..30000 milliseconds');
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new TypeError('signal must be an AbortSignal');
  const selection = Object.freeze({ python, helper });
  const result = (code, capabilities = null) => Object.freeze({
    schema: 'stellar-forge.sf81.capability-probe.v1',
    supported: code === 'OPERATOR_BROWSER_REVIEW_SUPPORTED',
    code, selection, capabilities,
  });
  if (signal?.aborted) return result('OPERATOR_CAPABILITIES_ABORTED');
  return await new Promise(resolve => {
    let child, timer, killTimer, failure, done = false, output = Buffer.alloc(0);
    const finish = (code, capabilities) => {
      if (done) return;
      done = true; clearTimeout(timer); clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      resolve(result(code, capabilities));
    };
    const stop = code => {
      if (done) return;
      failure ??= code;
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1000);
        killTimer.unref();
      }
    };
    const abort = () => stop('OPERATOR_CAPABILITIES_ABORTED');
    try {
      child = spawn(python, ['-I', '-B', '-u', helper, '--capabilities'], {
        env: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
        shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch { finish('OPERATOR_CAPABILITIES_UNAVAILABLE'); return; }
    child.once('error', () => finish('OPERATOR_CAPABILITIES_UNAVAILABLE'));
    child.stdout.on('error', () => stop('OPERATOR_CAPABILITIES_UNAVAILABLE'));
    child.stdout.on('data', chunk => {
      if (done || failure) return;
      if (output.length + chunk.length > 8192) {
        stop('OPERATOR_CAPABILITIES_INVALID'); return;
      }
      output = Buffer.concat([output, chunk]);
    });
    child.once('close', (exitCode, childSignal) => {
      if (failure) { finish(failure); return; }
      // An original helper without the query rejects these arguments in its
      // parser before it can read stdin or enter the original approval flow.
      if (exitCode === 2 && !childSignal && output.toString('utf8').trim() === '') {
        finish('OPERATOR_CAPABILITIES_UNSUPPORTED'); return;
      }
      if (exitCode !== 0 || childSignal) {
        finish('OPERATOR_CAPABILITIES_UNAVAILABLE'); return;
      }
      let advertised;
      try { advertised = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(output)); }
      catch { finish('OPERATOR_CAPABILITIES_INVALID'); return; }
      const expected = OPERATOR_APPROVAL_CAPABILITIES;
      if (!advertised || typeof advertised !== 'object' || Array.isArray(advertised) ||
          !Array.isArray(advertised.review_channels) ||
          !expected.review_channels.every(channel => advertised.review_channels.includes(channel)) ||
          !Object.entries(expected).every(([key, value]) =>
            key === 'review_channels' || advertised[key] === value)) {
        finish('OPERATOR_CAPABILITIES_UNSUPPORTED'); return;
      }
      finish('OPERATOR_BROWSER_REVIEW_SUPPORTED', expected);
    });
    timer = setTimeout(() => stop('OPERATOR_CAPABILITIES_TIMEOUT'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export class OperatorBridgeError extends Error {
  constructor(code, intentId) {
    super(code); this.name = 'OperatorBridgeError'; this.code = code;
    this.intentId = intentId;
    this.reservationState = 'CHECK_NATIVE_LEDGER_DO_NOT_RELEASE_OR_RETRY';
    this.paymentSent = false;
  }
}

/** Check the actual approval device without reading input or requesting consent. */
export async function checkOperatorTerminal(intentId) {
  try {
    // A tool may allocate a TTY stream without making it the controlling TTY.
    // SF62 opens this same device, independent of the subprocess stdin pipe.
    const terminal = await open('/dev/tty', constants.O_RDWR | (constants.O_NOCTTY ?? 0));
    try {
      if (!(await terminal.stat()).isCharacterDevice()) throw new Error('not a terminal');
    } finally { await terminal.close(); }
  } catch {
    throw new OperatorBridgeError('OPERATOR_CONTROLLING_TERMINAL_REQUIRED', intentId);
  }
}

/** Resolve the host-selected channel; a failed browser selection never falls back. */
export async function checkOperatorChannel(intentId, { environment = process.env } = {}) {
  try {
    const selected = operatorApprovalEnvironment(environment);
    if (Object.keys(selected).length) await checkBrowserApprovalChannel(selected);
    else await checkOperatorTerminal(intentId);
  } catch (error) {
    if (error instanceof OperatorBridgeError) throw error;
    throw new OperatorBridgeError(error.code ?? 'OPERATOR_CHANNEL_UNAVAILABLE', intentId);
  }
}

/** Construction is privileged configuration, never values supplied by a seller/agent. */
export function createOperatorApproval({ python, actor, service, policy, ledger,
  environment = process.env, timeoutMs = 300_000 } = {}) {
  for (const path of [python, policy, ledger])
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0'))
      throw new TypeError('python, policy and ledger must be trusted absolute paths');
  for (const id of [actor, service])
    if (typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(id))
      throw new TypeError('verified actor and service IDs are required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 900_000)
    throw new TypeError('approval timeout must be 100..900000 milliseconds');
  const browserEnvironment = operatorApprovalEnvironment(environment);
  const browser = Object.keys(browserEnvironment).length > 0;
  // Python receives only the existing native accounting keys, not transport tokens.
  const env = { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
  for (const name of keys) {
    const value = environment[name];
    if (typeof value !== 'string' || value.length > 4096)
      throw new TypeError('existing SF36 operator keys are required');
    env[name] = value;
  }
  const args = ['-I', '-B', '-u', helper, '--actor', actor, '--service', service,
    '--policy', policy, '--ledger', ledger,
    ...(browser ? ['--review-channel', 'pipe'] : [])];
  return async function approve(intent, { signal } = {}) {
    const fail = code => new OperatorBridgeError(code, intent?.intentId);
    if (signal !== undefined && !(signal instanceof AbortSignal))
      throw new TypeError('signal must be an AbortSignal');
    if (signal?.aborted) throw fail('OPERATOR_ABORTED');
    if (terminalBusy) throw fail('OPERATOR_BUSY');
    const raw = Buffer.from(JSON.stringify(intent), 'utf8');
    if (raw.length > 65_536) throw fail('OPERATOR_INTENT_TOO_LARGE');
    const digest = sha256(raw);
    terminalBusy = true;
    try {
      await checkOperatorChannel(intent?.intentId, { environment: browserEnvironment });
      if (signal?.aborted) throw fail('OPERATOR_ABORTED');
      return await new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        let child, timer, killTimer, failure, done = false;
        let buffered = Buffer.alloc(0), finalRecord, reviewSeen = false, decision;
        const transport = new AbortController();
        const finish = (error, value) => {
          if (done) return; done = true;
          clearTimeout(timer); clearTimeout(killTimer);
          signal?.removeEventListener('abort', abort);
          transport.abort();
          error ? reject(error) : resolve(value);
        };
        const stop = code => {
          if (done) return;
          failure ??= fail(code);
          transport.abort();
          if (child && child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM');
            killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1000);
            killTimer.unref();
          }
        };
        const abort = () => stop('OPERATOR_ABORTED');
        const receive = frame => {
          let record;
          try { record = JSON.parse(frame); } catch { stop('OPERATOR_INVALID_RESULT'); return; }
          if (browser && record?.schema === 'stellar-forge.sf81.review.v1') {
            const r = record.review;
            if (reviewSeen || finalRecord || record.input_sha256 !== digest ||
                r?.request_id !== intent.intentId || r.max_atomic_units_to_reserve !== intent.amount ||
                r.network !== intent.network || r.asset !== intent.asset ||
                !/^[0-9a-f]{64}$/.test(r.request_sha256 ?? '') ||
                record.current_native_budget_estimate?.approved !== true) {
              stop('OPERATOR_REVIEW_MISMATCH'); return;
            }
            reviewSeen = true;
            const remaining = deadline - Date.now();
            if (remaining < 100) { stop('OPERATOR_TIMEOUT'); return; }
            void requestBrowserReview(browserEnvironment, record,
              { signal: transport.signal, timeoutMs: remaining }).then(answer => {
              if (done || failure || signal?.aborted) return;
              decision = answer;
              child.stdin.end(JSON.stringify({
                schema: 'stellar-forge.sf81.decision.v1',
                input_sha256: digest, request_sha256: answer.requestSha256,
                decision: answer.decision,
              }) + '\n');
            }, error => stop(error.code ?? 'OPERATOR_BROWSER_REVIEW_FAILED'));
            return;
          }
          if (frame.length > 8192 || finalRecord ||
              record?.schema !== 'stellar-forge.sf81.approval.v1' ||
              browser && record.reservation && (!decision || decision.decision !== 'approve')) {
            stop('OPERATOR_INVALID_RESULT'); return;
          }
          finalRecord = record;
        };
        try {
          child = spawn(python, args, { env, shell: false, windowsHide: true,
            stdio: ['pipe', 'pipe', 'ignore'] });
        } catch { finish(fail('OPERATOR_START_FAILED')); return; }
        child.once('error', () => finish(fail('OPERATOR_START_FAILED')));
        child.stdout.on('data', chunk => {
          buffered = Buffer.concat([buffered, chunk]);
          if (buffered.length > (browser ? 512 * 1024 : 8192)) {
            stop('OPERATOR_RESULT_TOO_LARGE'); return;
          }
          let end;
          while ((end = buffered.indexOf(10)) >= 0) {
            const frame = buffered.subarray(0, end);
            buffered = buffered.subarray(end + 1);
            if (frame.length) receive(frame);
          }
        });
        child.stdin.on('error', () => stop('OPERATOR_INPUT_FAILED'));
        child.once('close', async (code, childSignal) => {
          if (buffered.length) receive(buffered);
          let error = failure;
          if (!error && (code !== 0 || childSignal)) {
            error = fail('OPERATOR_NO_APPROVAL');
            if (typeof finalRecord?.reason === 'string' && finalRecord.reason.length <= 256)
              error.operatorReason = finalRecord.reason;
          }
          const r = finalRecord?.reservation;
          if (!error && (finalRecord?.schema !== 'stellar-forge.sf81.approval.v1' ||
              finalRecord.input_sha256 !== digest || r?.schema !== 'stellar-forge.sf62.result.v1' ||
              r.outcome !== 'FRESH_RESERVATION_APPROVED' || r.request_id !== intent.intentId ||
              r.reserved_atomic_units !== intent.amount || r.network !== intent.network ||
              r.asset !== intent.asset || !/^[0-9a-f]{64}$/.test(r.request_sha256 ?? '') ||
              browser && r.request_sha256 !== decision?.requestSha256 ||
              r.signed_requests !== 0 || r.wallet_calls !== 0 || r.payments_confirmed !== 0))
            error = fail('OPERATOR_RESERVATION_MISMATCH');
          if (signal?.aborted) error ??= fail('OPERATOR_ABORTED');
          if (browser && decision) {
            try { await finishBrowserReview(browserEnvironment, decision, error ? 'FAILED' : 'APPROVED'); }
            catch (reportError) { error ??= fail(reportError.code ?? 'OPERATOR_BROWSER_RESULT_UNCONFIRMED'); }
          }
          error ??= failure;
          if (signal?.aborted) error ??= fail('OPERATOR_ABORTED');
          finish(error, error ? undefined : Object.freeze({ ...r, input_sha256: digest }));
        });
        timer = setTimeout(() => stop('OPERATOR_TIMEOUT'), Math.max(1, deadline - Date.now()));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        if (browser) child.stdin.write(Buffer.concat([raw, Buffer.from('\n')]));
        else child.stdin.end(raw);
      });
    } finally { terminalBusy = false; }
  };
}

/** One stable operation ID, original wire client, original signer, no blind retries. */
export class OperatorApprovedBuyer {
  #buyer; #approve;
  constructor({ operator, fetchImpl = createPublicHttpsFetch() } = {}) {
    this.#buyer = new X402BuyerClient({ fetchImpl });
    this.#approve = createOperatorApproval(operator);
  }
  discover(options) { return this.#buyer.discover(options); }
  async call(options = {}) {
    if ('approve' in options) throw new TypeError('operator approval cannot be replaced per call');
    const { sign, signal, intentId } = options;
    if (typeof sign !== 'function' || typeof intentId !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,160}$/.test(intentId))
      throw new TypeError('original signer and stable intentId required');
    let reservation = null;
    const checkAbort = () => {
      if (signal?.aborted) throw new OperatorBridgeError('OPERATOR_ABORTED', intentId);
    };
    checkAbort();
    try {
      const result = await this.#buyer.call({ ...options,
        approve: async intent => {
          reservation = await this.#approve(intent, { signal });
          checkAbort(); return true;
        },
        sign: async payload => {
          checkAbort();
          const signed = await sign(payload);
          checkAbort(); return signed;
        },
      });
      return { ...result, operatorReservation: reservation };
    } catch (error) {
      // Preserve original SF31 paymentSent/unknown-outcome semantics unchanged.
      if (error && typeof error === 'object' && Object.isExtensible(error))
        error.operatorReservation = reservation;
      throw error;
    }
  }
}

