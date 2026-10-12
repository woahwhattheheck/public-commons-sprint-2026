// MIT. Private local files and shared browser-wallet types.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, resolve, join, dirname } from 'node:path';

export const WALLET_SCHEMA = 'stellar-forge.sf103.browser-wallet.v1';
export const STATE_SCHEMA = 'stellar-forge.sf103.browser-wallet-state.v1';
export const LAUNCH_SCHEMA = 'stellar-forge.sf103.browser-wallet-launch.v1';
export const FREIGHTER_VERSION = '6.0.1';
export const STELLAR_VERSION = '^16.3.0';
export const PASSPHRASES = Object.freeze({
  'stellar:testnet': 'Test SDF Network ; September 2015',
  'stellar:pubnet': 'Public Global Stellar Network ; September 2015',
});
export class WalletError extends Error {
  constructor(code, status = 400) { super(code); this.name = 'WalletError'; this.code = code; this.status = status; }
}
export function requireValue(ok, code, status) { if (!ok) throw new WalletError(code, status); }
export const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export const digest = value => createHash('sha256').update(value).digest('hex');
export function absolute(value) {
  requireValue(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && !value.includes('\0'),
    'WALLET_ABSOLUTE_PATH_REQUIRED');
  return value;
}
export function tokenEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function privateDirectory(directory) {
  absolute(directory);
  const s = await lstat(directory);
  requireValue(s.isDirectory() && await realpath(directory) === directory &&
    (process.platform === 'win32' || (s.uid === process.getuid() && (s.mode & 0o077) === 0)),
  'WALLET_PRIVATE_DIRECTORY_REQUIRED');
  return directory;
}
export async function readPrivate(path, max = 1048576) {
  absolute(path);
  let file;
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const s = await file.stat();
    requireValue(s.isFile() && s.size <= max &&
      (process.platform === 'win32' || (s.uid === process.getuid() && (s.mode & 0o077) === 0)),
    'WALLET_PRIVATE_FILE_REQUIRED');
    const bytes = await file.readFile();
    requireValue(bytes.length <= max, 'WALLET_FILE_TOO_LARGE');
    return bytes;
  } finally { await file?.close(); }
}
export async function readJson(path, max) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readPrivate(path, max))); }
  catch (e) { if (e instanceof WalletError || e.code === 'ENOENT') throw e; throw new WalletError('WALLET_JSON_INVALID'); }
}
export async function writeAtomic(path, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const temp = path + '.tmp-' + randomUUID();
  let file;
  try {
    file = await open(temp, 'wx', 0o600);
    await file.writeFile(bytes); await file.sync(); await file.close(); file = undefined;
    await rename(temp, path);
    if (process.platform !== 'win32') {
      const d = await open(dirname(path), 'r');
      try { await d.sync(); } finally { await d.close(); }
    }
  } finally { await file?.close(); await unlink(temp).catch(() => {}); }
}
export async function writeNew(path, value) {
  const bytes = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  const f = await open(path, 'wx', 0o600);
  try { await f.writeFile(bytes); await f.sync(); }
  catch (error) {
    // Remove only the inode created by this failed write, including ENOSPC.
    const owned = await f.stat().catch(() => null);
    const current = await lstat(path).catch(() => null);
    if (owned && current && owned.dev === current.dev && owned.ino === current.ino)
      await unlink(path).catch(() => {});
    throw error;
  } finally { await f.close(); }
}
export function validateWallet(value, directory) {
  requireValue(object(value) && value.schema === WALLET_SCHEMA && value.directory === directory &&
    typeof value.walletId === 'string' && /^[a-f0-9-]{36}$/.test(value.walletId) &&
    PASSPHRASES[value.network] && /^G[A-Z2-7]{55}$/.test(value.payer) &&
    typeof value.buyerSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.buyerSha256) &&
    value.nativeSignerConfig === join(directory, 'native', 'signer.json') &&
    /^[a-f0-9]{64}$/.test(value.nativeSignerSha256 ?? '') &&
    value.provider === join(directory, 'provider.mjs') &&
    /^[a-f0-9]{64}$/.test(value.providerSha256 ?? '') &&
    typeof value.sourceBuyerConfig === 'string' && isAbsolute(value.sourceBuyerConfig) &&
    /^[a-f0-9]{64}$/.test(value.sourceBuyerSha256 ?? '') &&
    value.nativeBuyerConfig === join(directory, 'native', 'buyer.json') &&
    Number.isSafeInteger(value.requestLifetimeMs) && value.requestLifetimeMs >= 15000 && value.requestLifetimeMs <= 600000,
  'WALLET_CONFIG_INVALID');
  return value;
}
export async function readWallet(directory) {
  await privateDirectory(directory);
  const cfg = validateWallet(await readJson(join(directory, 'wallet.json')), directory);
  requireValue(digest(await readPrivate(cfg.nativeBuyerConfig)) === cfg.buyerSha256, 'WALLET_BUYER_CHANGED');
  requireValue(digest(await readPrivate(cfg.nativeSignerConfig)) === cfg.nativeSignerSha256 &&
    digest(await readPrivate(cfg.provider)) === cfg.providerSha256, 'WALLET_SIGNER_CONFIGURATION_CHANGED');
  return cfg;
}
export function requestIdentity(config, entryXdr) {
  return digest(JSON.stringify([config.walletId, config.buyerSha256, 'signAuthEntry', config.network, config.payer, entryXdr]));
}
export function base64(value, max = 131072) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),
  'WALLET_XDR_INVALID');
  const bytes = Buffer.from(value, 'base64');
  requireValue(bytes.toString('base64') === value, 'WALLET_XDR_INVALID');
  return bytes;
}
export function publicRequest(row) {
  const { result, claimId, entryXdr, ...visible } = row;
  return visible;
}
