// MIT. Resolve the installed original runtime; this partner has no payment engine.
import { readFile, lstat, mkdir, writeFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const here = dirname(fileURLToPath(import.meta.url));
export function sourceRoot(value = process.env.STARFORGE_SOURCE_ROOT) {
  return value ? resolve(value) : resolve(here, '../../../../..');
}
export function nativePath(root, path) {
  return resolve(root, 'stellar/scf-starforge-20261009', path);
}
export const nativeImport = (root, path) => import(pathToFileURL(nativePath(root, path)).href);
export async function readJson(path, maxBytes = 1048576) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > maxBytes) throw new TypeError('Use a regular bounded JSON file');
  const bytes = await readFile(path);
  if (bytes.length > maxBytes) throw new TypeError('JSON file grew beyond its limit');
  return { bytes, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
}
export async function privateNewDirectory(path) {
  await mkdir(resolve(path), { mode: 0o700 });
  return resolve(path);
}
export async function createJson(path, value) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(jsonBytes(value)); await handle.sync(); }
  finally { await handle.close(); }
}
export async function createBytes(path, bytes) {
  await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
}
export function argumentsMap(args, allowed, switches = []) {
  const values = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.includes(key) || values.has(key)) throw new TypeError('Unknown or duplicate option: ' + key);
    if (switches.includes(key)) { values.set(key, true); continue; }
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError('Missing option value: ' + key);
    values.set(key, args[++i]);
  }
  return values;
}
export const required = (options, name) => {
  if (!options.has(name)) throw new TypeError('Required option: ' + name);
  return options.get(name);
};
