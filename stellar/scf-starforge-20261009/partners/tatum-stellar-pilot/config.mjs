// MIT. One-time create-only original SF30 seller-service.v1 config for a merchant-owned Tatum testnet pilot.
import { open, stat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage: node config.mjs --out PRIVATE_FILE --asset STELLAR_TESTNET_CONTRACT \\
  --pay-to STELLAR_ACCOUNT --amount ATOMIC_UNIT_STRING [--public-origin HTTPS_ORIGIN]
Create-only output: 3 GET paid endpoints bound to original SF30. Never supplies payment keys.`;
const FIELDS = new Set(['--out', '--asset', '--pay-to', '--amount', '--public-origin']);

function argsMap(argv) {
  if (argv.length === 1 && argv[0] === '--help') return null;
  const opts = Object.create(null);
  for (let i = 0; i < argv.length; i += 2) {
    if (!FIELDS.has(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--') ||
        Object.hasOwn(opts, argv[i])) throw new TypeError(USAGE);
    opts[argv[i]] = argv[i + 1];
  }
  for (const key of ['--out', '--asset', '--pay-to', '--amount']) {
    if (!opts[key]) throw new TypeError('Missing ' + key + '. ' + USAGE);
  }
  if (!/^C[A-Z2-7]{55}$/.test(opts['--asset']))
    throw new TypeError('--asset must be an explicit verified Stellar testnet Soroban contract ID');
  if (!/^G[A-Z2-7]{55}$/.test(opts['--pay-to']))
    throw new TypeError('--pay-to must be an explicit Stellar classic account address');
  if (!/^[1-9][0-9]{0,17}$/.test(opts['--amount']))
    throw new TypeError('--amount must be a positive atomic-unit integer string');
  if (opts['--public-origin']) {
    const url = new URL(opts['--public-origin']);
    if (url.protocol !== 'https:' || url.username || url.password || url.search ||
        url.hash || url.pathname !== '/' ||
        url.origin !== opts['--public-origin'].replace(/\/$/, '')) {
      throw new TypeError('--public-origin must be an exact HTTPS origin with no path or credentials');
    }
  }
  return opts;
}

function route({ id, path, handler, description, payment }) {
  return { id, path, definition: { method: 'GET', serviceName: 'Tatum Stellar Testnet RPC',
    description, tags: ['stellar', 'testnet', 'tatum', 'read-only', 'x402'],
    payment, outputExample: { provider: 'tatum', network: 'stellar:testnet', data: {} } },
    handler };
}

export function generateConfig(options) {
  const payment = { scheme: 'exact', network: 'stellar:testnet',
    asset: options['--asset'], payTo: options['--pay-to'],
    amount: options['--amount'], maxTimeoutSeconds: 60 };
  return {
    schema: 'stellar-forge.seller-service.v1',
    ...(options['--public-origin'] ? { publicOrigin: options['--public-origin'] } : {}),
    routes: [
      route({ id: 'latest-ledger', path: '/stellar/ledger/latest', handler: 'latestLedger',
        description: 'Read the latest Stellar testnet ledger sequence and closing metadata via Tatum', payment }),
      route({ id: 'fee-stats', path: '/stellar/fee-stats', handler: 'feeStats',
        description: 'Read bounded Stellar testnet Soroban fee statistics via Tatum', payment }),
      route({ id: 'network', path: '/stellar/network', handler: 'networkInfo',
        description: 'Read Stellar testnet network metadata and passphrase via Tatum', payment }),
    ],
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = argsMap(argv);
  if (options === null) { console.log(USAGE); return null; }
  const dest = resolve(options['--out']);
  if (!dest.endsWith('.json')) throw new TypeError('--out must be a .json file');
  const parent = await realpath(dirname(dest));
  if (!(await stat(parent)).isDirectory()) throw new TypeError('Output parent must be an existing directory');
  const config = generateConfig(options);
  const payload = JSON.stringify(config, null, 2) + '\n';
  const handle = await open(dest, 'wx', 0o600);
  try { await handle.writeFile(payload, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  console.log(JSON.stringify({ status: 'CREATED', file: dest,
    sha256: createHash('sha256').update(payload).digest('hex'),
    network: 'stellar:testnet', routeCount: config.routes.length,
    runbook: 'Start existing SF30 serve.mjs with --config and --handlers (absolute path)' }));
  return dest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
