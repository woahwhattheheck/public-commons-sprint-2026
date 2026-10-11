// MIT. Compose the original seller CLI without replacing its configuration or payment engine.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSellerOperations } from './server.mjs';

const USAGE = `Usage: node operations/launch.mjs [--operations-port 8424] [--upstream]
  [--history-dir PRIVATE_DIRECTORY] [--history-days 90] [--operation-controls] -- ORIGINAL_SELLER_OPTIONS
Example (static seller): node stellar/scf-starforge-20261009/sf30-seller-sdk/operations/launch.mjs -- \
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/examples/service.json
Example (existing API): node stellar/scf-starforge-20261009/sf30-seller-sdk/operations/launch.mjs --upstream -- \
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/examples/upstream-service.json \
  --upstreams stellar/scf-starforge-20261009/sf30-seller-sdk/examples/upstreams.json --allow-loopback-upstream
Options after -- pass unchanged to upstream-serve.mjs when --upstream is set,
otherwise to serve.mjs. Both listeners remain private to 127.0.0.1.
History is optional. --history-dir retains UTC day/route aggregates every 5 seconds
and at graceful shutdown; --history-days sets retained calendar days (default 90).
Reuse the directory when restarting this merchant. Use a different directory per merchant.
--operation-controls enables explicit merchant-operation recovery for idempotent upstreams.
Open the private operationControl URL printed at startup; its fragment is a local control token.
Operation recovery uses the original ledger and makes no backend or payment request.`;

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); return null; }
  const separator = args.indexOf('--');
  if (separator < 0 || separator === args.length - 1) throw new TypeError(USAGE);
  let port = 8424;
  let upstream = false;
  let operationControls = false;
  let portSupplied = false;
  let historyDirectory, historyRetentionDays = 90, historyDaysSupplied = false;
  for (let i = 0; i < separator; i++) {
    const flag = args[i];
    if (flag === '--upstream' && !upstream) { upstream = true; continue; }
    if (flag === '--operation-controls' && !operationControls) { operationControls = true; continue; }
    if (flag === '--history-dir' && historyDirectory === undefined &&
        args[i + 1] && i + 1 < separator && !args[i + 1].startsWith('--')) {
      historyDirectory = args[++i];
      continue;
    }
    if (flag === '--history-days' && !historyDaysSupplied && /^\d{1,4}$/.test(args[i + 1] ?? '')) {
      historyRetentionDays = Number(args[++i]);
      historyDaysSupplied = true;
      continue;
    }
    if (flag === '--operations-port' && !portSupplied && /^\d{1,5}$/.test(args[i + 1] ?? '')) {
      port = Number(args[++i]);
      portSupplied = true;
      continue;
    }
    throw new TypeError(USAGE);
  }
  if (port > 65535) throw new RangeError('operations port must be 0–65535');
  if (historyDaysSupplied && historyDirectory === undefined) throw new TypeError('--history-days requires --history-dir');
  if (operationControls && !upstream) throw new TypeError('--operation-controls requires --upstream');
  // Choose only the two maintained launchers. Seller/payment/handler logic stays native.
  const { main: sellerMain } = await import(upstream ? '../upstream-serve.mjs' : '../serve.mjs');
  const session = await sellerMain(args.slice(separator + 1));
  if (!session) throw new TypeError('Seller must be started; use launch --help for usage');
  // The native CLI also listens for signals and dereferences session.close.
  // Share its drain promise so both listeners wait for the same shutdown.
  const nativeClose = session.close.bind(session);
  let sellerClosing;
  session.close = (...options) => sellerClosing ??= Promise.resolve().then(() => nativeClose(...options));
  let operations;
  try { operations = await startSellerOperations(session, { port, historyDirectory, historyRetentionDays, operationControls }); }
  catch (error) { await session.close(); throw error; }
  console.log(JSON.stringify({ operations: operations.url, mode: session.mode,
    snapshot: operations.url + '/api/snapshot', sessionId: operations.observer.snapshot().sessionId,
    history: historyDirectory === undefined ? null : operations.url + '/api/history',
    merchantOperations:operations.merchantOperationsUrl,operationControl:operations.operationControlUrl,
    availability:operations.availabilityUrl,availabilityControl:operations.availabilityControlUrl }));
  // Let original requests finish before the final usage checkpoint; the
  // original seller still owns its drain and any forced-close deadline.
  let closing;
  const close = () => closing ??= (async () => {
    try { await session.close(); } finally { await operations.close(); }
  })();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    close().catch(() => { process.exitCode = 1; });
  });
  return { session, operations, close };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

