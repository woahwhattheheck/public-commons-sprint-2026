// Small transport custody helpers; durable comparison jobs belong to ../service.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, rename, rm, link } from 'node:fs/promises';
import { isAbsolute, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const JOB_SCHEMA = 'erp-reconciliation.job.v1';
export const PART_SCHEMA = 'erp-reconciliation.report-chunk.v1';
export const ERROR_SCHEMA = 'erp-reconciliation.agx-error.v1';
export const SHA = /^[a-f0-9]{64}$/;
export const JOB = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
export class AdapterError extends Error { constructor(code) { super(code); this.code = code; } }
export const need = (yes, code) => { if (!yes) throw new AdapterError(code); };

export async function privateDirectory(path, create = false) {
  need(typeof path === 'string' && isAbsolute(path), 'ABSOLUTE_PRIVATE_DIRECTORY_REQUIRED');
  if (create) await mkdir(path, { mode: 0o700 });
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    (!process.getuid || info.uid === process.getuid()), 'PRIVATE_DIRECTORY_REQUIRED');
  need(await realpath(path) === resolve(path), 'DIRECTORY_SYMLINK_REJECTED');
  return path;
}

export async function readPrivate(path, maximum) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint: true });
    need(before.isFile() && before.size <= BigInt(maximum) && !(before.mode & 0o077n), 'PRIVATE_FILE_REQUIRED');
    const bytes = await file.readFile();
    const after = await file.stat({ bigint: true });
    need(BigInt(bytes.length) === before.size && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs, 'FILE_CHANGED');
    return bytes;
  } finally { await file.close(); }
}

export async function atomic(path, value, exclusive = false) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const temporary = path + '.tmp-' + randomUUID();
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(data); await file.sync(); await file.close(); file = null;
    if (exclusive) { await link(temporary, path); await rm(temporary); }
    else await rename(temporary, path);
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await file?.close(); await rm(temporary, { force: true }); }
}
