// MIT. Local operator setup for the existing SF88 buyer and native SDK adapter.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execution, bytes as sf88Bytes } from '../sf88-operator-buyer-cli/config.mjs';
import { createNativeBuyerSigner, loadNativeSdk, NativeSignerError, requireValue } from './adapter.mjs';

export const CONFIG_SCHEMA = 'stellar-forge.sf103.native-signer.v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function absolute(value) {
  requireValue(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && !value.includes('\0'),
    'NATIVE_CONFIG_ABSOLUTE_PATH_REQUIRED');
  return value;
}
export async function readPrivateFile(path, maximum = 65536) {
  absolute(path);
  let file;
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await file.stat();
    requireValue(info.isFile() && info.size <= maximum && (process.platform === 'win32' ||
      ((info.mode & 0o077) === 0 && info.uid === process.getuid())), 'NATIVE_PRIVATE_FILE_REQUIRED');
    const bytes = await file.readFile();
    requireValue(bytes.length <= maximum, 'NATIVE_INPUT_TOO_LARGE');
    return bytes;
  } catch (error) {
    if (error instanceof NativeSignerError) throw error;
    throw new NativeSignerError('NATIVE_CONFIG_READ_FAILED');
  } finally { await file?.close(); }
}
export function parseJson(raw) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw new NativeSignerError('NATIVE_CONFIG_JSON_INVALID'); }
}
function rpcFor(network, value) {
  if (value === undefined && network === 'stellar:testnet') return 'https://soroban-testnet.stellar.org';
  requireValue(typeof value === 'string', 'NATIVE_PUBNET_RPC_REQUIRED');
  let url;
  try { url = new URL(value); } catch { throw new NativeSignerError('NATIVE_RPC_URL_INVALID'); }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
    'NATIVE_RPC_HTTPS_REQUIRED');
  return url.href;
}
export function validateNativeConfig(value) {
  requireValue(object(value) && value.schema === CONFIG_SCHEMA && Object.keys(value)
    .every(key => ['schema', 'buyerConfig', 'buyerConfigSha256', 'secretEnv', 'signerProvider', 'rpcUrl'].includes(key)),
  'NATIVE_CONFIG_FIELDS_INVALID');
  absolute(value.buyerConfig);
  requireValue(typeof value.buyerConfigSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.buyerConfigSha256),
    'NATIVE_BUYER_CONFIG_DIGEST_REQUIRED');
  requireValue((value.secretEnv !== undefined) !== (value.signerProvider !== undefined), 'NATIVE_ONE_SIGNER_SOURCE_REQUIRED');
  if (value.secretEnv !== undefined)
    requireValue(typeof value.secretEnv === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(value.secretEnv), 'NATIVE_SECRET_ENV_INVALID');
  if (value.signerProvider !== undefined) absolute(value.signerProvider);
  return value;
}

/** Reads public terms and private file metadata, without loading a signer or SDK. */
export async function inspectOperatorConfig(path) {
  const cfg = validateNativeConfig(parseJson(await readPrivateFile(path)));
  const buyerBytes = await readPrivateFile(cfg.buyerConfig);
  requireValue(hash(buyerBytes) === cfg.buyerConfigSha256, 'NATIVE_BUYER_CONFIG_CHANGED');
  const buyer = parseJson(buyerBytes);
  let parsed;
  try { parsed = execution(buyer); } catch { throw new NativeSignerError('NATIVE_SF88_CONFIG_INVALID'); }
  requireValue(typeof buyer.trustedPayer === 'string' && /^[GC][A-Z2-7]{55}$/.test(buyer.trustedPayer),
    'NATIVE_TRUSTED_PAYER_REQUIRED');
  const bodyBytes = parsed.op.bodyFile ? await sf88Bytes(parsed.op.bodyFile, 1048576, 'NATIVE_BODY_FILE_INVALID') : Buffer.alloc(0);
  const expected = { operation: parsed.op, payer: buyer.trustedPayer,
    body: { present: parsed.op.bodyFile !== undefined, bytes: bodyBytes.length, sha256: hash(bodyBytes) } };
  const rpcUrl = rpcFor(parsed.op.expect.network, cfg.rpcUrl);
  if (cfg.signerProvider) {
    const file = await lstat(cfg.signerProvider).catch(() => null);
    requireValue(file?.isFile() && (process.platform === 'win32' || (file.mode & 0o022) === 0),
      'NATIVE_TRUSTED_PROVIDER_FILE_REQUIRED');
  }
  return { config: cfg, expected, rpcUrl, summary: {
    schema: 'stellar-forge.sf103.preflight.v1', status: 'CONFIG_READY',
    intentId: parsed.op.intentId, network: parsed.op.expect.network, payer: buyer.trustedPayer,
    method: parsed.op.method, resourceOrigin: new URL(parsed.op.url).origin,
    maxAtomic: parsed.op.expect.maxAtomic, bodyBytes: expected.body.bytes,
    bodySha256: expected.body.sha256, buyerConfigSha256: cfg.buyerConfigSha256,
    signerSource: cfg.secretEnv ? 'EXISTING_SECRET_ENV' : 'TRUSTED_SEP43_PROVIDER',
    rpcOrigin: new URL(rpcUrl).origin, sdkRequired: '2.28.0', signerLoaded: false, signingAttempts: 0,
  } };
}

/** Called by SF88 only after its original approval/reservation callback succeeds. */
export async function loadOperatorSigner(path, { environment = process.env } = {}) {
  const inspected = await inspectOperatorConfig(path);
  const { config, expected, rpcUrl } = inspected;
  const sdk = await loadNativeSdk();
  let signer;
  try {
    if (config.secretEnv) {
      const secret = environment[config.secretEnv];
      requireValue(typeof secret === 'string' && /^S[A-Z2-7]{55}$/.test(secret), 'NATIVE_EXISTING_SECRET_REQUIRED');
      signer = sdk.createEd25519Signer(secret, expected.operation.expect.network);
    } else {
      const provider = await import(pathToFileURL(config.signerProvider).href);
      requireValue(typeof provider.createSigner === 'function', 'NATIVE_PROVIDER_EXPORT_REQUIRED');
      signer = await provider.createSigner({ network: expected.operation.expect.network, payer: expected.payer });
    }
  } catch (error) {
    if (error instanceof NativeSignerError) throw error;
    throw new NativeSignerError('NATIVE_SIGNER_INITIALIZATION_FAILED');
  }
  const adapter = await createNativeBuyerSigner({ signer, expected, rpcUrl, sdk });
  return { adapter, summary: { ...inspected.summary, status: 'SIGNER_READY', signerLoaded: true,
    sdkVersions: sdk.versions, signingAttempts: 0 } };
}
