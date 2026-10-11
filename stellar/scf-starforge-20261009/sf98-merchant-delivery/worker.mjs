// MIT. Opt-in continuous delivery through the original SF98 drain and journals.
import { constants } from 'node:fs';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openOutbox } from './outbox.mjs';
import { drainOnce, validateDestination } from './deliver.mjs';
import { acquireDeliveryLease, assertDeliveryLease, inspectDeliveryLease } from './delivery-lock.mjs';

const SCHEMA = 'stellar-forge.sf98.delivery-worker.v1';
const STATE_FILE = 'worker-state.json';

async function checkpoint(directory, state) {
  const temporary = join(directory, '.worker-state.' + process.pid + '.tmp');
  let file;
  try {
    file = await open(temporary, constants.O_WRONLY | constants.O_CREAT |
      (constants.O_NOFOLLOW ?? 0), 0o600);
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077)
      throw new Error('PRIVATE_WORKER_CHECKPOINT_REQUIRED');
    await file.truncate(0);
    await file.writeFile(JSON.stringify(state) + '\n');
    await file.sync();
    await file.close(); file = null;
    await rename(temporary, join(directory, STATE_FILE));
  } finally {
    if (file) await file.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function wait(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolvePromise => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolvePromise(); };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export async function workerStatus(outbox) {
  let lastRun = null;
  try {
    const data = await readFile(join(outbox.dir, STATE_FILE), 'utf8');
    if (data.length > 16384) throw new Error('INVALID_WORKER_CHECKPOINT');
    lastRun = JSON.parse(data);
    if (lastRun.schema !== SCHEMA) throw new Error('INVALID_WORKER_CHECKPOINT');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { schema: SCHEMA, observedAt: new Date().toISOString(),
    deliveryOwner: await inspectDeliveryLease(outbox.dir),
    outbox: await outbox.status(), lastRun };
}

export async function runWorker(outbox, options) {
  const { signal, pollMs = 5000, limit = 20, concurrency = 1,
    timeoutMs = 7000, onCycle = () => {}, clock = Date.now } = options;
  if (!Number.isInteger(pollMs) || pollMs < 50 || pollMs > 60000)
    throw new RangeError('pollMs must be 50-60000');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000)
    throw new RangeError('Invalid delivery batch, concurrency or timeout');
  validateDestination(options.url, options.allowedHost);
  if (typeof options.secret !== 'string' || Buffer.byteLength(options.secret) < 32 ||
      Buffer.byteLength(options.secret) > 1024) throw new Error('WEBHOOK_SECRET_NOT_SET');
  const lease = await acquireDeliveryLease(outbox.dir, { purpose: 'worker' });
  const totals = { cycles: 0, attempted: 0, delivered: 0, exhausted: 0 };
  let state = { schema: SCHEMA, owner: lease.owner, state: 'RUNNING',
    startedAt: new Date(clock()).toISOString(), updatedAt: null,
    nextWakeAt: null, totals, outbox: null };
  try {
    while (!signal?.aborted) {
      await assertDeliveryLease(lease, outbox.dir);
      const result = await drainOnce(outbox, { ...options, lease, signal, limit, concurrency, timeoutMs, clock });
      totals.cycles++;
      totals.attempted += result.attemptThisRun;
      totals.delivered += result.deliveredThisRun;
      totals.exhausted += result.exhaustedThisRun;
      const untilDue = result.nextDueAt === null ? pollMs : Math.max(0, Date.parse(result.nextDueAt) - clock());
      const delay = result.ready > 0 ? 0 : Math.min(pollMs, untilDue);
      state = { ...state, updatedAt: new Date(clock()).toISOString(),
        nextWakeAt: signal?.aborted ? null : new Date(clock() + delay).toISOString(),
        totals: { ...totals }, outbox: result };
      await checkpoint(outbox.dir, state);
      await onCycle(state);
      await wait(delay, signal);
    }
    state = { ...state, state: 'STOPPED', updatedAt: new Date(clock()).toISOString(), nextWakeAt: null };
    await checkpoint(outbox.dir, state);
    return state;
  } catch (error) {
    state = { ...state, state: 'FAILED', updatedAt: new Date(clock()).toISOString(), nextWakeAt: null };
    await checkpoint(outbox.dir, state).catch(() => {});
    throw error;
  } finally { await lease.release(); }
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!['run', 'status'].includes(command) || rest.length % 2)
    throw new Error('Usage: worker.mjs run|status --state /private/outbox [--url URL --allow-host HOST --secret-env SF98_WEBHOOK_SECRET --limit 20 --concurrency 1 --poll-ms 5000 --timeout-ms 7000]');
  const opts = new Map();
  const allowed = ['--state', '--url', '--allow-host', '--secret-env', '--limit', '--concurrency', '--poll-ms', '--timeout-ms'];
  for (let index = 0; index < rest.length; index += 2) {
    if (!allowed.includes(rest[index]) || opts.has(rest[index])) throw new TypeError('Invalid or duplicate worker option');
    opts.set(rest[index], rest[index + 1]);
  }
  if (!opts.has('--state')) throw new Error('--state is required');
  const outbox = await openOutbox(opts.get('--state'));
  if (command === 'status') {
    const result = await workerStatus(outbox);
    process.stdout.write(JSON.stringify(result) + '\n');
    return result;
  }
  const envName = opts.get('--secret-env') || 'SF98_WEBHOOK_SECRET';
  if (!/^[A-Z][A-Z0-9_]{1,64}$/.test(envName)) throw new TypeError('Invalid secret environment name');
  const number = (name, fallback) => {
    const raw = opts.get(name) ?? String(fallback);
    if (!/^[1-9][0-9]{0,5}$/.test(raw)) throw new TypeError('Invalid numeric option: ' + name);
    return Number(raw);
  };
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('SF98_WORKER_STOP_REQUESTED'));
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    const result = await runWorker(outbox, {
      url: opts.get('--url'), allowedHost: opts.get('--allow-host'), secret: process.env[envName],
      signal: controller.signal, limit: number('--limit', 20), concurrency: number('--concurrency', 1),
      pollMs: number('--poll-ms', 5000), timeoutMs: number('--timeout-ms', 7000),
      onCycle: state => {
        if (state.outbox.attemptThisRun > 0 || state.totals.cycles === 1)
          process.stdout.write(JSON.stringify({ schema: SCHEMA, state: state.state,
            updatedAt: state.updatedAt, totals: state.totals, outbox: state.outbox }) + '\n');
      },
    });
    process.stdout.write(JSON.stringify({ schema: SCHEMA, state: result.state, totals: result.totals }) + '\n');
    return result;
  } finally {
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { process.stderr.write(String(error?.message ?? error) + '\n');
    process.exitCode = error.code === 'SF98_DELIVERY_BUSY' ? 75 : 1; });
}
