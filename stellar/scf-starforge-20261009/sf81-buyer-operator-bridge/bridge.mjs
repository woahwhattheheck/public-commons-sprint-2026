// MIT. Trusted operator-host composition of original SF31 + SF62/SF54/SF59/SF36.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { X402BuyerClient } from '../sf31-buyer-client/buyer.mjs';
import { createPublicHttpsFetch } from '../sf31-buyer-client/public-transport.mjs';

const helper = fileURLToPath(new URL('./approve.py', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const keys = ['SF36_CONSENT_KEY_B64', 'SF36_AUDIT_KEY_B64', 'SF36_OPERATOR_KEY_B64'];
let terminalBusy = false;

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
  // Do not pass unrelated cloud credentials or Python/loader injection settings.
  const env = { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
  for (const name of keys) {
    const value = environment[name];
    if (typeof value !== 'string' || value.length > 4096)
      throw new TypeError('existing SF36 operator keys are required');
    env[name] = value;
  }
  const args = ['-I', '-B', '-u', helper, '--actor', actor, '--service', service,
    '--policy', policy, '--ledger', ledger];
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
      await checkOperatorTerminal(intent?.intentId);
      if (signal?.aborted) throw fail('OPERATOR_ABORTED');
      return await new Promise((resolve, reject) => {
        let child, timer, killTimer, failure, done = false, size = 0;
        const chunks = [];
        const finish = (error, value) => {
          if (done) return; done = true;
          clearTimeout(timer); clearTimeout(killTimer);
          signal?.removeEventListener('abort', abort);
          error ? reject(error) : resolve(value);
        };
        const stop = code => {
          if (done) return;
          failure ??= fail(code);
          if (child && child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM');
            killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1000);
            killTimer.unref();
          }
        };
        const abort = () => stop('OPERATOR_ABORTED');
        try {
          child = spawn(python, args, { env, shell: false, windowsHide: true,
            stdio: ['pipe', 'pipe', 'ignore'] });
        } catch { finish(fail('OPERATOR_START_FAILED')); return; }
        child.once('error', () => finish(fail('OPERATOR_START_FAILED')));
        child.stdout.on('data', chunk => {
          size += chunk.length;
          if (size > 8192) { stop('OPERATOR_RESULT_TOO_LARGE'); return; }
          chunks.push(chunk);
        });
        child.stdin.on('error', () => stop('OPERATOR_INPUT_FAILED'));
        child.once('close', (code, childSignal) => {
          if (failure) { finish(failure); return; }
          if (code !== 0 || childSignal) {
            const error = fail('OPERATOR_NO_APPROVAL');
            try {
              const denied = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              if (denied?.schema === 'stellar-forge.sf81.approval.v1' &&
                  typeof denied.reason === 'string' && denied.reason.length <= 256)
                error.operatorReason = denied.reason;
            } catch {}
            finish(error); return;
          }
          let record;
          try { record = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { finish(fail('OPERATOR_INVALID_RESULT')); return; }
          const r = record?.reservation;
          if (record?.schema !== 'stellar-forge.sf81.approval.v1' || record.input_sha256 !== digest ||
              r?.schema !== 'stellar-forge.sf62.result.v1' ||
              r.outcome !== 'FRESH_RESERVATION_APPROVED' || r.request_id !== intent.intentId ||
              r.reserved_atomic_units !== intent.amount || r.network !== intent.network ||
              r.asset !== intent.asset || !/^[0-9a-f]{64}$/.test(r.request_sha256) ||
              r.signed_requests !== 0 || r.wallet_calls !== 0 || r.payments_confirmed !== 0) {
            finish(fail('OPERATOR_RESERVATION_MISMATCH')); return;
          }
          if (signal?.aborted) { finish(fail('OPERATOR_ABORTED')); return; }
          finish(null, Object.freeze({ ...r, input_sha256: digest }));
        });
        timer = setTimeout(() => stop('OPERATOR_TIMEOUT'), timeoutMs);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        child.stdin.end(raw);
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
