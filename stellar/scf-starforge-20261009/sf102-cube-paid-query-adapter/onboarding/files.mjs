// MIT. Small create-only private snapshot helpers for merchant onboarding.
import { constants } from 'node:fs';
import { open, mkdir, lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve, join } from 'node:path';
import { fail, plain } from './metadata.mjs';

export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export function absolute(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)) fail('Use an absolute file or directory path');
  return resolve(value);
}
export function parse(data, name) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
  catch { fail(`Invalid UTF-8 JSON: ${name}`); }
}
function privateMode(info, directory = false) {
  if (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1) fail('Expected a private regular file or directory');
  if (info.mode & 0o077 || typeof process.getuid === 'function' && info.uid !== process.getuid()) fail('Merchant snapshots must be owned by this user with private permissions');
}
export async function privateDirectory(directory) {
  const path = absolute(directory), info = await lstat(path);
  privateMode(info, true); return path;
}
export async function readBytes(path, { max = 16 * 1024 * 1024, privateFile = false } = {}) {
  const file = await open(absolute(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > max) fail(`Input must be a regular file up to ${max} bytes`);
    if (privateFile) privateMode(before);
    const data = await file.readFile(), after = await file.stat();
    if (data.length > max || data.length !== before.size || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail('Input changed while reading');
    return data;
  } finally { await file.close(); }
}
export async function syncDirectory(path) {
  const dir = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await dir.sync(); } finally { await dir.close(); }
}
export async function writeNew(path, data) {
  const file = await open(absolute(path), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
}
export async function newDirectory(path) {
  const directory = absolute(path);
  await mkdir(directory, { mode: 0o700 });
  return directory;
}
export function fileBinding(data) { return { bytes: data.length, sha256: sha256(data) }; }
export async function readBoundFiles(directory, manifest, expected) {
  if (!plain(manifest.files) || Object.keys(manifest.files).sort().join('\n') !== [...expected].sort().join('\n'))
    fail('Snapshot file manifest does not match the expected package');
  const entries = await Promise.all(expected.map(async name => {
    const binding = manifest.files[name];
    if (!plain(binding) || !Number.isSafeInteger(binding.bytes) || binding.bytes < 0 || !/^[a-f0-9]{64}$/.test(binding.sha256 ?? ''))
      fail(`Invalid snapshot binding: ${name}`);
    const data = await readBytes(join(directory, name), { privateFile: true });
    if (data.length !== binding.bytes || sha256(data) !== binding.sha256) fail(`Snapshot changed: ${name}`);
    return [name, data];
  }));
  return Object.fromEntries(entries);
}
export async function recordedFiles(directory) {
  await privateDirectory(directory);
  const records = [];
  for (const name of (await readdir(directory)).sort()) {
    if (!/^[a-f0-9-]{1,80}\.json$/.test(name)) fail('Unexpected merchant receipt filename');
    const data = await readBytes(join(directory, name), { privateFile: true, max: 65536 });
    records.push(parse(data, name));
  }
  return records;
}
