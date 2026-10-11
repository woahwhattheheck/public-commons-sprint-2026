// MIT. Compose the original seller CLI without replacing its configuration or payment engine.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSellerOperations } from './server.mjs';

const USAGE = `Usage: node operations/launch.mjs [--operations-port 8424] [--upstream] -- ORIGINAL_SELLER_OPTIONS
Example (static seller): node stellar/scf-starforge-20261009/sf30-seller-sdk/operations/launch.mjs -- \
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/examples/service.json
Example (existing API): node stellar/scf-starforge-20261009/sf30-seller-sdk/operations/launch.mjs --upstream -- \
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/examples/upstream-service.json \
  --upstreams stellar/scf-starforge-20261009/sf30-seller-sdk/examples/upstreams.json --allow-loopback-upstream
Options after -- pass unchanged to upstream-serve.mjs when --upstream is set,
otherwise to serve.mjs. Both listeners remain private to 127.0.0.1.`;

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); return null; }
  const separator = args.indexOf('--');
  if (separator < 0 || separator === args.length - 1) throw new TypeError(USAGE);
  let port = 8424;
  let upstream = false;
  let portSupplied = false;
  for (let i = 0; i < separator; i++) {
    const flag = args[i];
    if (flag === '--upstream' && !upstream) { upstream = true; continue; }
    if (flag === '--operations-port' && !portSupplied && /^\d{1,5}$/.test(args[i + 1] ?? '')) {
      port = Number(args[++i]);
      portSupplied = true;
      continue;
    }
    throw new TypeError(USAGE);
  }
  if (port > 65535) throw new RangeError('operations port must be 0–65535');
  // Choose only the two maintained launchers. Seller/payment/handler logic stays native.
  const { main: sellerMain } = await import(upstream ? '../upstream-serve.mjs' : '../serve.mjs');
  const session = await sellerMain(args.slice(separator + 1));
  if (!session) throw new TypeError('Seller must be started; use launch --help for usage');
  let operations;
  try { operations = await startSellerOperations(session, { port }); }
  catch (error) { await session.close(); throw error; }
  console.log(JSON.stringify({ operations: operations.url, mode: session.mode,
    snapshot: operations.url + '/api/snapshot', sessionId: operations.observer.snapshot().sessionId }));
  // Original sellerMain owns seller shutdown. This listener owns only the second server.
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    operations.close().catch(() => { process.exitCode = 1; });
  });
  return { session, operations, close: () => Promise.all([operations.close(), session.close()]) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
