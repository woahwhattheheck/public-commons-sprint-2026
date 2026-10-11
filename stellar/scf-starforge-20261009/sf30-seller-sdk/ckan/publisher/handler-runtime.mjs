// MIT. Portable CKAN edition adapter; dataset parsing and queries remain original.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, posix, resolve } from 'node:path';

const HASH = /^[a-f0-9]{64}$/;
const fail = (code, message = code) => { throw Object.assign(new Error(message), { code }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function member(name) {
  if (typeof name !== 'string' || !name || name.length > 512 || name.includes('\\') ||
      name.includes('\0') || posix.isAbsolute(name) || posix.normalize(name) !== name ||
      name.split('/').some(part => !part || part === '.' || part === '..') ||
      ['merchant-manifest.json', 'handlers.mjs'].includes(name)) fail('CKAN_MERCHANT_MEMBER_INVALID');
  return name;
}
async function regular(path, maximum, retain = false) {
  if (await realpath(path) !== path) fail('CKAN_MERCHANT_PATH_CHANGED');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.mode & 0o077 || before.size > maximum)
      fail('CKAN_MERCHANT_FILE_INVALID');
    const hash = createHash('sha256'), parts = []; let count = 0;
    for await (const part of handle.createReadStream({ autoClose: false })) {
      count += part.length; if (count > maximum) fail('CKAN_MERCHANT_FILE_TOO_LARGE');
      hash.update(part); if (retain) parts.push(part);
    }
    const after = await handle.stat();
    if (count !== before.size || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail('CKAN_MERCHANT_FILE_CHANGED');
    return { sha256: hash.digest('hex'), bytes: count, ...(retain ? { content: Buffer.concat(parts) } : {}) };
  } finally { await handle.close(); }
}
export async function inspectCkanMerchantFiles(directory, expectedManifestSha256) {
  const root = resolve(directory);
  if (!HASH.test(expectedManifestSha256 ?? '') || await realpath(root) !== root)
    fail('CKAN_MERCHANT_REVIEW_REQUIRED');
  const retained = await regular(join(root, 'merchant-manifest.json'), 4194304, true);
  if (retained.sha256 !== expectedManifestSha256) fail('CKAN_MERCHANT_MANIFEST_CHANGED');
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(retained.content)); }
  catch { fail('CKAN_MERCHANT_MANIFEST_INVALID'); }
  if (!object(manifest) || manifest.schema !== 'stellar-forge.ckan-merchant-package.v1' ||
      !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 10020 ||
      !HASH.test(manifest.dataset?.snapshot ?? '') || !Number.isSafeInteger(manifest.dataset?.rowCount) ||
      manifest.dataset.rowCount < 0 || !HASH.test(manifest.capture?.manifestSha256 ?? ''))
    fail('CKAN_MERCHANT_MANIFEST_INVALID');
  const names = new Set();
  for (const entry of manifest.files) {
    if (!object(entry) || !HASH.test(entry.sha256 ?? '') ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 268435456)
      fail('CKAN_MERCHANT_FILE_DESCRIPTOR_INVALID');
    const name = member(entry.file);
    if (names.has(name)) fail('CKAN_MERCHANT_DUPLICATE_FILE');
    names.add(name);
    const observed = await regular(join(root, name), entry.bytes);
    if (observed.bytes !== entry.bytes || observed.sha256 !== entry.sha256)
      fail('CKAN_MERCHANT_FILE_CHANGED', 'Retained merchant file changed: ' + name);
  }
  for (const required of ['data.csv', 'dataset.json', 'source.json', 'capture/capture.json',
    'openapi.json', 'selections.json', 'route-bindings.json',
    'runtime/dataset-handler.mjs', 'runtime/handler-runtime.mjs']) {
    if (!names.has(required)) fail('CKAN_MERCHANT_FILE_MISSING');
  }
  return { directory: root, manifest, manifestSha256: retained.sha256, manifestBytes: retained.content };
}
/** The generated entry has already verified this exact module before importing. */
export async function openCkanMerchantHandlers(directory, expectedManifestSha256) {
  const retained = await inspectCkanMerchantFiles(directory, expectedManifestSha256);
  const datasetModule = new URL('./dataset-handler.mjs', import.meta.url);
  const loader = await import(datasetModule.href);
  const dataset = await loader.loadDatasetConfig(join(retained.directory, 'dataset.json'));
  const description = dataset.describe(), snapshot = description.snapshot;
  if (snapshot !== retained.manifest.dataset.snapshot || description.rowCount !== retained.manifest.dataset.rowCount)
    fail('CKAN_MERCHANT_DATASET_CHANGED');
  const normalized = new WeakMap();
  function request(context) {
    const original = context.query ?? {};
    const parameters = original instanceof URLSearchParams;
    const incoming = parameters ? new URLSearchParams(original) : object(original) ? { ...original } : original;
    const selected = parameters ? incoming.getAll('snapshot') :
      object(incoming) && Object.hasOwn(incoming, 'snapshot') ? [incoming.snapshot] : [];
    if (selected.length > 1 || selected.length === 1 && selected[0] !== snapshot)
      return { error: { status: 409, body: { error: 'DATASET_SNAPSHOT_CHANGED',
        message: 'Select the published CKAN edition for this resource.' } } };
    if (parameters) incoming.delete('snapshot'); else if (object(incoming)) delete incoming.snapshot;
    return { context: { ...context, query: incoming } };
  }
  function admitDataset(context) {
    const value = request(context);
    if (value.error) return value.error;
    const admission = dataset.admit(value.context);
    if (admission === true) normalized.set(context, value.context);
    return admission;
  }
  function queryDataset(context) {
    const selected = normalized.get(context);
    normalized.delete(context);
    if (selected) return dataset.handle(selected);
    const value = request(context);
    return value.error ?? dataset.handle(value.context);
  }
  return Object.freeze({ queryDataset, admitDataset, describe: dataset.describe });
}
