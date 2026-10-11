// MIT. Compose the original seller CLI without replacing its configuration or payment engine.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSellerOperations } from './server.mjs';

const USAGE = `Usage: node operations/launch.mjs [--operations-port 8424] -- ORIGINAL_SELLER_OPTIONS
Example: node stellar/scf-starforge-20261009/sf30-seller-sdk/operations/launch.mjs -- \\
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/examples/service.json
All options after -- go unchanged to the existing serve.mjs. Keep the separate operations listener private.`;

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); return null; }
  const separator = args.indexOf('--');
  if (![0, 2].includes(separator) || separator === args.length - 1 ||
      (separator === 2 && (args[0] !== '--operations-port' || !/^\d{1,5}$/.test(args[1])))) {
    throw new TypeError(USAGE);
  }
  const port = separator === 2 ? Number(args[1]) : 8424;
  if (port > 65535) throw new RangeError('operations port must be 0–65535');
  const { main: sellerMain } = await import('../serve.mjs');
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
