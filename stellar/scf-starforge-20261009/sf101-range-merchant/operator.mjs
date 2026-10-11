// MIT. Explicit-terms, create-only operator configuration for native SF30.
// No wallet, settlement, API-key acquisition, contact or payment is performed.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { compileHttpSellerOffer } from '../sf30-seller-sdk/seller.mjs';
import { readSellerConfig } from '../sf30-seller-sdk/serve.mjs';

const nativeServer = fileURLToPath(new URL('../sf30-seller-sdk/serve.mjs', import.meta.url));
const handlersFile = fileURLToPath(new URL('./handlers.mjs', import.meta.url));
const ACCEPT = new Set(['--out', '--config', '--public-origin', '--network', '--asset', '--pay-to',
  '--amount', '--timeout', '--facilitator', '--port']);
const HELP = `Range Stellar x402 native merchant adapter (independent, not Range-affiliated)

  node operator.mjs init --out PRIVATE_DIR --public-origin https://seller.yourdomain.com \\
    --network stellar:testnet --asset VERIFIED_SEP41_ASSET --pay-to VERIFIED_MERCHANT \\
    --amount POSITIVE_ATOMIC_UNITS [--timeout 60]
  node operator.mjs check --config PRIVATE_DIR/seller.json
  node operator.mjs launch --config PRIVATE_DIR/seller.json [--port 8423]
    [--facilitator https://configured-facilitator.example]

The first launch without facilitator serves actual native 402 challenges ONLY;
NO upstream API call or customer payment. To enable merchant-owned processing,
set RANGE_STELLAR_AUTHORIZATION='Bearer ...' outside source, supply a merchant-
verified facilitator, correct asset/payTo and public HTTPS reverse proxy.
Never ship the resulting private seller config as a public paid merchant claim.
`;

function parse(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { command: 'help', params: new Map() };
  const [command, ...rest] = argv;
  if (!['init', 'check', 'launch'].includes(command)) throw new TypeError(HELP);
  const params = new Map();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i], value = rest[i + 1];
    if (!ACCEPT.has(key) || !value || value.startsWith('--') || params.has(key)) throw new TypeError(HELP);
    params.set(key, value);
  }
  const required = command === 'init' ? ['--out', '--public-origin', '--network', '--asset', '--pay-to', '--amount'] : ['--config'];
  const permitted = command === 'init' ? new Set([...required, '--timeout']) : command === 'check' ? new Set(['--config']) : new Set(['--config', '--facilitator', '--port']);
  if (required.some(k => !params.get(k)) || [...params.keys()].some(k => !permitted.has(k))) throw new TypeError(HELP);
  return { command, params };
}

function makeConfig(params) {
  const origin = new URL(params.get('--public-origin'));
  if (origin.protocol !== 'https:' || origin.origin !== origin.href.replace(/\/$/, '') ||
      origin.username || origin.password || origin.search || origin.hash) {
    throw new TypeError('A canonical public merchant HTTPS origin is required');
  }
  const network = params.get('--network');
  if (!['stellar:testnet', 'stellar:pubnet'].includes(network)) throw new TypeError('Explicit Stellar network required');
  const timeout = params.has('--timeout') ? Number(params.get('--timeout')) : 60;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 86400) throw new TypeError('Invalid timeout');
  const route = {
    id: 'range-stellar-address-transactions',
    path: '/range/stellar/address-transactions',
    definition: {
      method: 'GET', serviceName: 'Stellar Tx Intelligence',
      description: 'Operator-authorized, read-only Stellar address transaction data via Range',
      tags: ['stellar', 'transactions', 'data'],
      payment: {
        scheme: 'exact', network, asset: params.get('--asset'),
        payTo: params.get('--pay-to'), amount: params.get('--amount'),
        maxTimeoutSeconds: timeout,
      },
      queryParameters: [
        { name: 'address', type: 'string', description: 'Stellar G-account with valid SEP-23 checksum', required: true,
          example: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' },
        { name: 'page', type: 'integer', description: 'Page number, 1 through 1000', required: false, example: 1 },
        { name: 'limit', type: 'integer', description: 'Page size, 1 through 100', required: false, example: 10 },
      ],
      outputExample: { data: [], meta: { page: 1, limit: 10, total: 0 } },
    },
    handler: 'rangeStellarTransactions', admit: 'admitRangeStellar',
  };
  compileHttpSellerOffer({ ...route.definition, url: origin.origin + route.path });
  return { schema: 'stellar-forge.seller-service.v1', publicOrigin: origin.origin,
    admissionTimeoutMs: 2000, routes: [route] };
}

export async function main(argv = process.argv.slice(2)) {
  const { command, params } = parse(argv);
  if (command === 'help') { process.stdout.write(HELP); return { command }; }
  if (command === 'init') {
    const config = makeConfig(params);
    const folder = resolve(params.get('--out'));
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const path = resolve(folder, 'seller.json');
    await writeFile(path, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    // Reuse the original parser and its route contract, rather than a competing definition.
    await readSellerConfig(path);
    process.stdout.write(JSON.stringify({ command, config:path, routes:1,
      nativeServer, handlers:handlersFile, network:config.routes[0].definition.payment.network,
      challengeOnlyDefault:true, credentialStored:false }) + '\n');
    return { command, config:path };
  }
  const config = resolve(params.get('--config'));
  const current = await readSellerConfig(config);
  if (current.routes.length !== 1 || current.routes[0].handler !== 'rangeStellarTransactions' ||
      current.routes[0].admit !== 'admitRangeStellar' ||
      current.routes[0].path !== '/range/stellar/address-transactions') {
    throw new TypeError('This config is not the Range Stellar merchant route');
  }
  if (command === 'check') {
    compileHttpSellerOffer({ ...current.routes[0].definition, url: current.publicOrigin + current.routes[0].path });
    process.stdout.write(JSON.stringify({ command, status:'NATIVE_CONFIG_VALID',
      paymentNetwork:current.routes[0].definition.payment.network,
      routes:1, backendRequested:false }) + '\n');
    return { command };
  }
  const port = params.get('--port') ?? '8423';
  if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) throw new TypeError('Invalid port');
  const args = [nativeServer, '--config', config, '--handlers', handlersFile, '--port', port];
  const facilitator = params.get('--facilitator');
  if (facilitator) {
    const url = new URL(facilitator);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new TypeError('Facilitator must be a trusted HTTPS URL');
    }
    if (!/^Bearer [^\s\x00-\x1f\x7f]+$/.test(process.env.RANGE_STELLAR_AUTHORIZATION ?? '')) {
      throw new TypeError('RANGE_STELLAR_AUTHORIZATION missing or malformed');
    }
    args.push('--facilitator', facilitator);
  }
  const child = spawn(process.execPath, args, { stdio:'inherit', env:process.env });
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject); child.once('exit', value => resolveExit(value ?? 1));
  });
  if (code !== 0) throw new Error('Original SF30 seller exited: ' + code);
  return { command, exitCode:code };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(error?.message === HELP ? HELP :
    'Range merchant operator error: ' + error.message + '\n'); process.exitCode = 1; });
}
