#!/usr/bin/env node
// Compose original SF82 seller, SF30 operations and SF93 private support capture.
// No new payment, signer, routing, capture, or settlement implementation.
import { lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch as launchSeller } from '../sf82-seller-pilot/pilot.mjs';
import { startSellerOperations } from '../sf30-seller-sdk/operations/server.mjs';
import { captureBundle } from '../sf93-seller-support-bundle/bundle.mjs';

const HELP = `SF96: original OpenAPI seller pilot + operations + private support handoff

START (Node 22+, full source checkout):
  node pilot-ops.mjs start --ops-port 0 --support-parent /private/support -- \\
    --spec ORIGINAL_OPENAPI.json --config SELECTIONS.json \\
    --bindings BINDINGS.json --out /private/NEW_COMPILED_SELLER --port 0
RESUME (the same compiled original seller):
  node pilot-ops.mjs start --ops-port 0 --support-parent /private/support -- \\
    --resume /private/COMPILED_SELLER
CAPTURE (separate shell, while the original seller is still live):
  node pilot-ops.mjs capture --seller http://127.0.0.1:SELLER_PORT \\
    --ops http://127.0.0.1:OPS_PORT --support-parent /private/support

START forwards every option after -- unchanged to ORIGINAL SF82. Seller and
operations use one SF30 session, two loopback-only listeners. CAPTURE invokes
ORIGINAL SF93, creates a private, non-overwriting case directory, and sends
NO request to a payable route. Ctrl-C closes the seller and operations.\n`;
const validPort = s => /^(0|[1-9]\d{0,4})$/.test(s) && Number(s) <= 65535;

function keyValues(args, allowed) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!allowed.includes(key) || result[key] !== undefined ||
        !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(HELP);
    result[key] = args[i + 1];
  }
  return result;
}

async function privateParent(input) {
  if (typeof input !== 'string' || !input || input === '/')
    throw new TypeError('Supply an existing owner-private --support-parent');
  const path = resolve(input);
  if (path === '/' || path === process.cwd())
    throw new TypeError('--support-parent must not be / or the current checkout');
  const entry = await lstat(path);
  if (!entry.isDirectory() || (entry.mode & 0o077) !== 0)
    throw new TypeError('--support-parent must be a non-symlink directory, mode 0700 or stricter');
  return path;
}

export async function start(args, dependencies = {}) {
  const separator = args.indexOf('--');
  if (separator < 0 || separator === args.length - 1)
    throw new TypeError('START requires -- followed by native SF82 arguments\n' + HELP);
  const opts = keyValues(args.slice(0, separator), ['--ops-port', '--support-parent']);
  if (!opts['--support-parent']) throw new TypeError('START requires --support-parent');
  const support = await privateParent(opts['--support-parent']);
  const port = opts['--ops-port'] ?? '0';
  if (!validPort(port)) throw new TypeError('--ops-port must be 0–65535');
  const originalLaunch = dependencies.launchSeller ?? launchSeller;
  const originalOps = dependencies.startSellerOperations ?? startSellerOperations;
  const session = await originalLaunch(args.slice(separator + 1));
  if (!session || typeof session.url !== 'string' || typeof session.close !== 'function')
    throw new Error('Original SF82 did not start a live seller session');
  let operations;
  try {
    operations = await originalOps(session, { port: Number(port) });
    if (!operations || typeof operations.url !== 'string' ||
        typeof operations.close !== 'function') throw new TypeError('Original SF30 operations did not start');
  } catch (error) { await session.close().catch(() => {}); throw error; }
  let closing = null;
  const close = () => closing ??= Promise.allSettled([operations.close(), session.close()])
    .then(results => { if (results.some(r => r.status === 'rejected')) throw new Error('Operator listeners did not fully close'); });
  const capture = `node ${JSON.stringify(fileURLToPath(import.meta.url))} capture --seller ${session.url} --ops ${operations.url} --support-parent ${JSON.stringify(support)}`;
  const result = {
    schema: 'stellar-forge.seller-pilot-ops.v1', state: 'RUNNING',
    seller: session.url, operations: operations.url, mode: session.mode,
    routes: session.compiled?.routes?.length ?? null,
    sellerHealth: session.url + '/_seller/health',
    sellerOffers: session.url + '/_seller/offers',
    operationsDashboard: operations.url + '/',
    captureCommand: capture,
    note: 'HTTP success and challenge counters are not proof of on-chain payment or revenue.'
  };
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!dependencies.noSignals) {
    // The ORIGINAL seller also handles signals. Our callback closes only the
    // separate operations listener; reentrant close() is reserved for callers.
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => { operations.close().catch(() => { process.exitCode = 1; }); });
  }
  return { ...result, session, operations, close };
}

export async function capture(args, dependencies = {}) {
  const opts = keyValues(args, ['--seller', '--ops', '--support-parent']);
  if (!opts['--seller'] || !opts['--ops'] || !opts['--support-parent'])
    throw new TypeError('CAPTURE requires --seller, --ops and --support-parent\n' + HELP);
  const parent = await privateParent(opts['--support-parent']);
  // SF93 validates loopback origins and writes a create-only 0700 directory.
  // The case name is unique across captures and process restarts.
  const name = `seller-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${randomUUID()}`;
  const originalCapture = dependencies.captureBundle ?? captureBundle;
  const result = await originalCapture({ seller: opts['--seller'], ops: opts['--ops'], out: join(parent, name) });
  process.stdout.write(JSON.stringify({ schema: 'stellar-forge.seller-pilot-ops-case.v1', ...result }) + '\n');
  return result;
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  if (argv.length === 1 && ['--help', 'help'].includes(argv[0])) {
    process.stdout.write(HELP); return null;
  }
  const [command, ...args] = argv;
  if (command === 'start') return start(args, dependencies);
  if (command === 'capture') return capture(args, dependencies);
  throw new TypeError(HELP);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });