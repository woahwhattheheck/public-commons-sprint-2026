#!/usr/bin/env node
/** MIT. Configure and inspect the native MCP buyer's original SF36 spending owner. */
import {constants} from 'node:fs';
import {open, realpath, stat, link, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {isAbsolute, dirname, resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createMcpSpendingClient, createGovernedNativeMcpOperator} from './native-spend-governor.mjs';

const SCHEMA = 'stellar-forge.mcp-spending-host.v1';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ENV = /^[A-Za-z_][A-Za-z0-9_]*$/;
function need(ok, message) { if (!ok) throw new TypeError(message); }
function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && !value.includes('\0'),
    'Configure an absolute host path.');
  return value;
}
async function privateParent(path) {
  const parent = dirname(path);
  need(await realpath(parent) === resolve(parent), 'Use the real private directory path.');
  const info = await stat(parent);
  need(info.isDirectory() && (info.mode & 0o077) === 0 &&
    (typeof process.getuid !== 'function' || info.uid === process.getuid()),
  'The operator configuration directory must be owned by this user and mode 0700.');
}
function endpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('Configure an absolute HTTPS RPC URL.'); }
  need(url.protocol === 'https:' && !url.username && !url.password && !url.hash,
    'Configure an HTTPS RPC URL without credentials or fragments.');
}

/** Configuration contains public terms and existing host paths, never key material. */
export async function readMcpSpendingHost(configPath) {
  absolute(configPath); await privateParent(configPath);
  const file = await open(configPath,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let config;
  try {
    const info = await file.stat();
    need(info.isFile() && info.size <= 32768 && (info.mode & 0o077) === 0 &&
      (typeof process.getuid !== 'function' || info.uid === process.getuid()),
    'The host configuration must be a private regular file owned by this user, at most 32 KiB.');
    try { config = JSON.parse(await file.readFile({encoding:'utf8'})); }
    catch { throw new TypeError('The host configuration must contain valid JSON.'); }
  } finally { await file.close(); }
  const allowed = ['schema','payer','signerSecretEnv','rpcUrl','reconciliationRpcUrl',
    'reconciliationHttpsProxyEnv','limits','spending'];
  need(plain(config) && config.schema === SCHEMA && Object.keys(config).every(k=>allowed.includes(k)),
    'Use the stellar-forge.mcp-spending-host.v1 configuration fields.');
  need(typeof config.payer === 'string' && /^[GC][A-Z2-7]{55}$/.test(config.payer),
    'Configure the existing public payer.');
  need(typeof config.signerSecretEnv === 'string' && ENV.test(config.signerSecretEnv),
    'Configure the existing signer environment variable name.');
  endpoint(config.rpcUrl);
  if (config.reconciliationRpcUrl !== undefined) endpoint(config.reconciliationRpcUrl);
  if (config.reconciliationHttpsProxyEnv !== undefined)
    need(typeof config.reconciliationHttpsProxyEnv === 'string' && ENV.test(config.reconciliationHttpsProxyEnv),
      'Configure the trusted reconciliation proxy environment variable name.');
  const limits = config.limits;
  need(plain(limits) && Object.keys(limits).every(k=>
    ['network','asset','payTo','maxAtomic','maxTimeoutSeconds'].includes(k)) &&
    ['stellar:testnet','stellar:pubnet'].includes(limits.network) &&
    [limits.asset,limits.payTo].every(v=>typeof v === 'string' && /^[GC][A-Z2-7]{55}$/.test(v)) &&
    typeof limits.maxAtomic === 'string' && /^[1-9][0-9]{0,18}$/.test(limits.maxAtomic) &&
    BigInt(limits.maxAtomic) <= 9223372036854775807n &&
    Number.isInteger(limits.maxTimeoutSeconds) && limits.maxTimeoutSeconds >= 1 &&
    limits.maxTimeoutSeconds <= 86400, 'Configure the native payer limits within the original SF36 integer ceiling.');
  const spending = config.spending;
  need(plain(spending) && Object.keys(spending).every(k=>
    ['python','actor','service','policy','ledger','stateDirectory','timeoutMs'].includes(k)),
  'Configure the existing original SF36 spending paths and actor/service IDs.');
  for (const k of ['python','policy','ledger','stateDirectory']) absolute(spending[k]);
  for (const k of ['actor','service'])
    need(typeof spending[k] === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(spending[k]),
      'Configure the original policy actor and service IDs.');
  if (spending.timeoutMs !== undefined) need(Number.isSafeInteger(spending.timeoutMs) &&
    spending.timeoutMs >= 100 && spending.timeoutMs <= 300000, 'Use a helper timeout of 100..300000 ms.');
  return structuredClone(config);
}

/** Embedders can provide their original approval UI and native SDK/signer objects. */
export async function openMcpSpendingHost(configPath, {environment = process.env,
  approveQuote, sdk, signer, reconciliationFetchImpl} = {}) {
  const config = await readMcpSpendingHost(configPath);
  if (!sdk) {
    const {loadNativeSdk} = await import(
      '../../stellar/scf-starforge-20261009/sf103-native-buyer-signer/adapter.mjs');
    sdk = await loadNativeSdk();
  }
  if (!signer) {
    const secret = environment[config.signerSecretEnv];
    need(typeof secret === 'string' && secret.length > 0,
      'The configured signer credential must be present on the operator host.');
    signer = sdk.createEd25519Signer(secret,config.limits.network);
  }
  need(signer.address === config.payer, 'The configured signer must match the existing public payer.');
  return createGovernedNativeMcpOperator({payer:config.payer,signer,sdk,limits:config.limits,
    rpcUrl:config.rpcUrl,reconciliationRpcUrl:config.reconciliationRpcUrl,
    reconciliationHttpsProxyEnv:config.reconciliationHttpsProxyEnv,reconciliationFetchImpl,
    ...(approveQuote === undefined ? {} : {approveQuote}),
    spending:{...config.spending,environment}});
}

/** Create one private module for the existing HTTP/stdio workspace launchers. */
export async function configureMcpSpendingModule(configPath, modulePath) {
  await readMcpSpendingHost(configPath);
  absolute(modulePath); await privateParent(modulePath);
  const source = 'import {openMcpSpendingHost} from ' + JSON.stringify(import.meta.url) + ';\n' +
    'const operator = await openMcpSpendingHost(' + JSON.stringify(resolve(configPath)) + ');\n' +
    'export const {approve, signPayment, spendingStatus, reconcilePayment, close} = operator;\n';
  const temporary = join(dirname(modulePath),'.mcp-module-'+randomUUID());
  const file = await open(temporary,'wx',0o600);
  try {
    try { await file.writeFile(source,'utf8'); await file.sync(); }
    finally { await file.close(); }
    await link(temporary,modulePath);
    const directory = await open(dirname(modulePath),constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
  return {schema:SCHEMA,outcome:'CONFIGURED',operatorModule:modulePath,
    config:configPath,launcherEnvironment:{MCP_OPERATOR_MODULE:modulePath}};
}

export async function nativeSpendingMain(argv = process.argv.slice(2), {environment = process.env} = {}) {
  const [action, configPath, value, ...rest] = argv;
  need(rest.length === 0 && ['setup','status'].includes(action) && configPath && value,
    'Usage: native-spend-workspace.mjs setup /absolute/private/config.json /absolute/private/operator.mjs\n' +
    '       native-spend-workspace.mjs status /absolute/private/config.json QUOTE_UUID');
  if (action === 'setup') return configureMcpSpendingModule(configPath,value);
  const config = await readMcpSpendingHost(configPath);
  const client = createMcpSpendingClient({...config.spending,environment});
  try {
    const result = await client.status(value);
    const {binding,...report} = result;
    if (binding && binding.payer !== config.payer) throw new Error('MCP_SPENDING_PAYER_MISMATCH');
    // Status deliberately works without loading a signing SDK or payer secret.
    return {...report,...(binding ? {operation:JSON.parse(binding.invocationJson)} : {})};
  } finally { await client.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  nativeSpendingMain().then(result => process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error => {
    process.stderr.write(JSON.stringify({schema:SCHEMA,outcome:'ERROR',
      reason:error.code ?? error.message,operatorReason:error.operatorReason})+'\n');
    process.exitCode = 2;
  });
}
