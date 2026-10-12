// MIT. Private customer catalog; original paid-job buyer records remain authoritative.
import { realpath, lstat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { absolute, privateDirectory, readBytes, parseJson, digest, jsonBytes,
  writeJson, object, safeCode } from '../node/store.mjs';

export const SCHEMA = 'stellar-forge.sf88.job-workspace.v1';
export const HASH = /^[a-f0-9]{64}$/;
export const STATES = ['PREPARED','AWAITING_SETTLEMENT','QUEUED','RUNNING','CANCELLING',
  'COMPLETED','FAILED','INTERRUPTED','CANCELLED'];
export const now = () => new Date().toISOString();
export function requireValue(condition, code, status = 400) {
  if (!condition) throw Object.assign(new Error(code), { code, status });
}
export const failure = error => safeCode(error?.code, 'JOB_WORKSPACE_OPERATION_FAILED');
export function within(path, root) {
  const suffix = relative(root, path);
  return suffix === '' || !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'));
}
export async function canonicalDirectory(path, { privateState = false, create = false } = {}) {
  path = absolute(path);
  if (privateState) await privateDirectory(path, { create });
  const stat = await lstat(path);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'DIRECTORY_REQUIRED');
  const canonical = await realpath(path);
  requireValue(path === canonical, 'CANONICAL_DIRECTORY_REQUIRED');
  return canonical;
}
export const catalogPath = directory => join(absolute(directory), 'workspace.json');
export const buyerId = receipt => digest(JSON.stringify([receipt.acceptance.statusUrl, receipt.acceptanceSha256]));
export const resourceId = (directory, id, sha256) => digest(JSON.stringify(['paid-jobs', absolute(directory), id, sha256]));
export function validateCatalog(value, directory) {
  requireValue(object(value) && value.schema === SCHEMA && value.directory === absolute(directory) &&
    Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    Array.isArray(value.buyerRoots) && value.buyerRoots.length <= 30 &&
    Array.isArray(value.fileRoots) && value.fileRoots.length <= 30 &&
    Array.isArray(value.entries) && value.entries.length <= 10000, 'JOB_WORKSPACE_STATE_INVALID');
  for (const root of [...value.buyerRoots, ...value.fileRoots]) requireValue(absolute(root) === root, 'JOB_WORKSPACE_ROOT_INVALID');
  const seen = new Set();
  for (const entry of value.entries) {
    requireValue(object(entry) && HASH.test(entry.id) && !seen.has(entry.id) &&
      absolute(entry.directory) === entry.directory && typeof entry.label === 'string' && entry.label.length <= 512 &&
      typeof entry.archived === 'boolean' && Number.isSafeInteger(entry.revision) && entry.revision >= 0 &&
      typeof entry.createdAt === 'string' && object(entry.receipt) &&
      entry.receipt.schema === 'stellar-forge.job-buyer-receipt.v1' && buyerId(entry.receipt) === entry.id &&
      [join(directory, 'buyers'), ...value.buyerRoots].some(root => within(entry.directory, root)),
      'JOB_WORKSPACE_ENTRY_INVALID');
    seen.add(entry.id);
  }
  return value;
}
export async function readCatalog(directory) {
  directory = await canonicalDirectory(directory, { privateState: true });
  const bytes = await readBytes(catalogPath(directory), 64 * 1024 * 1024);
  return { catalog: validateCatalog(parseJson(bytes), directory), bytes };
}
export async function saveCatalog(directory, catalog) {
  validateCatalog(catalog, directory);
  const bytes = jsonBytes(catalog);
  requireValue(bytes.length <= 64 * 1024 * 1024, 'JOB_WORKSPACE_CAPACITY_REACHED', 409);
  await writeJson(catalogPath(directory), catalog);
}
export function delivered(receipt) {
  const d = receipt.delivery, s = receipt.latestStatus, a = receipt.acceptance;
  if (!d) return null;
  requireValue(s?.state === 'COMPLETED' && d.jobId === a.jobId && d.functionId === a.functionId &&
    d.inputSha256 === a.inputSha256 && d.acceptanceSha256 === receipt.acceptanceSha256 &&
    d.sourceUrl === a.resultUrl && HASH.test(d.sha256) && d.sha256 === s.result?.sha256 &&
    d.bytes === s.result?.bytes && d.contentType === s.result?.contentType &&
    d.filename === s.result?.filename && Number.isSafeInteger(d.completedRevision) &&
    d.completedRevision >= 0 && d.completedRevision <= s.revision &&
    HASH.test(d.nativeSettlement?.id ?? '') && d.nativeSettlement.id === s.nativeSettlement?.id &&
    d.nativeSettlement.at === s.nativeSettlement?.at &&
    typeof d.path === 'string' && absolute(d.path) === d.path,
    'JOB_DELIVERY_PROVENANCE_MISMATCH', 409);
  return d;
}
