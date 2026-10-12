// MIT. Original host file primitives shared by configuration and retained downloads.
import { lstat, open } from 'node:fs/promises';

export const failure = (code, message) => Object.assign(new Error(message), { code });

export function identifier(value, label = 'Identifier') {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))
    throw failure('INVALID_PARAMS', label + ' must use 1–64 lowercase letters, digits, underscores or hyphens.');
  return value;
}

export async function privateSupportDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && (info.mode & 0o077))
    throw failure('CONFIGURATION_ERROR', 'Support storage and exports require an existing private directory (0700).');
  return path;
}

export async function writePrivate(path, value) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
}
