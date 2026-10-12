// MIT. Read the original private Applications environment without loading runtime providers.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { absolute, need, plain, digest } from './storage.mjs';

export async function applicationEnvironment(path, expectedSha256) {
  if (!path) return { environment: process.env, sha256: null };
  absolute(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    const first = await handle.stat();
    need(first.isFile() && first.nlink === 1 && !(first.mode & 0o077) && first.size <= 65536 &&
      (process.getuid === undefined || first.uid === process.getuid()), 'APPLICATION_PRIVATE_ENVIRONMENT_REQUIRED');
    bytes = await handle.readFile();
    const after = await handle.stat();
    need(first.size === after.size && first.mtimeMs === after.mtimeMs && first.ctimeMs === after.ctimeMs &&
      bytes.length === first.size, 'APPLICATION_ENVIRONMENT_CHANGED');
  } finally { await handle.close(); }
  const sha256 = digest(bytes);
  need(expectedSha256 === undefined || expectedSha256 === sha256, 'APPLICATION_ENVIRONMENT_CHANGED',
    'Review the current private environment file before starting this application', 409);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { need(false, 'APPLICATION_ENVIRONMENT_JSON_REQUIRED'); }
  need(plain(value) && Object.keys(value).length <= 128 && Object.entries(value).every(([name, value]) =>
    /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) && typeof value === 'string' && !value.includes('\0') &&
    Buffer.byteLength(value) <= 8192), 'APPLICATION_ENVIRONMENT_VALUES_INVALID');
  need(!['HOME', 'CODEX_HOME'].some(name => Object.hasOwn(value, name)), 'APPLICATION_ENVIRONMENT_HOME_RESERVED');
  return { environment: { ...process.env, ...value }, sha256 };
}
