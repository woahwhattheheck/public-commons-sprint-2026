/** MIT. Read the original native MCP spending owner's private public configuration. */
import {constants} from 'node:fs';
import {open, realpath, stat} from 'node:fs/promises';
import {isAbsolute, dirname, resolve} from 'node:path';

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


export {absolute as requireMcpSpendingAbsolutePath, privateParent as requireMcpSpendingPrivateParent};
