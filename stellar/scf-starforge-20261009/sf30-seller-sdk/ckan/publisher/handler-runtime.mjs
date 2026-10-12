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
  const names = new Set(), semanticFiles = new Map();
  for (const entry of manifest.files) {
    if (!object(entry) || !HASH.test(entry.sha256 ?? '') ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 268435456)
      fail('CKAN_MERCHANT_FILE_DESCRIPTOR_INVALID');
    const name = member(entry.file);
    if (names.has(name)) fail('CKAN_MERCHANT_DUPLICATE_FILE');
    names.add(name);
    const semanticFile = manifest.semantics !== undefined && ['semantics.json', 'table-schema.json'].includes(name);
    if (semanticFile && entry.bytes > 4194304) fail('CKAN_MERCHANT_SEMANTICS_TOO_LARGE');
    const observed = await regular(join(root, name), entry.bytes, semanticFile);
    if (observed.bytes !== entry.bytes || observed.sha256 !== entry.sha256)
      fail('CKAN_MERCHANT_FILE_CHANGED', 'Retained merchant file changed: ' + name);
    if (semanticFile) semanticFiles.set(name, observed.content);
  }
  for (const required of ['data.csv', 'dataset.json', 'source.json', 'capture/capture.json',
    'openapi.json', 'selections.json', 'route-bindings.json',
    'runtime/dataset-handler.mjs', 'runtime/handler-runtime.mjs']) {
    if (!names.has(required)) fail('CKAN_MERCHANT_FILE_MISSING');
  }
  let semantics;
  if (manifest.semantics !== undefined) {
    const binding = manifest.semantics, review = manifest.sourceSemanticReview;
    if (!object(binding) || binding.file !== 'semantics.json' || binding.csvwFile !== 'table-schema.json' ||
        !HASH.test(binding.sha256 ?? '') || !HASH.test(binding.definitionSha256 ?? '') ||
        !object(review) || !HASH.test(review.sha256 ?? '') || !HASH.test(review.definitionSha256 ?? '') ||
        !semanticFiles.has(binding.file) || !semanticFiles.has(binding.csvwFile))
      fail('CKAN_MERCHANT_SEMANTICS_INVALID');
    let csvw;
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      semantics = JSON.parse(decoder.decode(semanticFiles.get(binding.file)));
      csvw = JSON.parse(decoder.decode(semanticFiles.get(binding.csvwFile)));
    } catch { fail('CKAN_MERCHANT_SEMANTICS_INVALID'); }
    if (!object(semantics) || semantics.schema !== 'stellar-forge.ckan-semantics.v1' ||
        semantics.sha256 !== binding.sha256 || semantics.definitionSha256 !== binding.definitionSha256 ||
        semantics.source?.captureManifestSha256 !== manifest.capture.manifestSha256 ||
        !Array.isArray(semantics.columns) || !semantics.columns.length || semantics.columns.length > 64 ||
        !object(semantics.csvw) || JSON.stringify(semantics.csvw) !== JSON.stringify(csvw))
      fail('CKAN_MERCHANT_SEMANTICS_CHANGED');
  }
  return { directory: root, manifest, manifestSha256: retained.sha256, manifestBytes: retained.content,
    ...(semantics ? { semantics } : {}) };
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
  const semantics = retained.semantics;
  if (semantics && (semantics.columns.length !== description.columns.length ||
      semantics.columns.some((column, index) => {
        const physical = description.columns[index];
        return column.name !== physical.name || column.type !== physical.type || column.nullable !== physical.nullable;
      }))) fail('CKAN_MERCHANT_SEMANTICS_COLUMNS_CHANGED');
  // Read the original policy, not a replacement dataset configuration. The
  // generic loader above validates both the configuration and its page budget.
  let maxPageBytes;
  if (semantics) {
    const descriptor = retained.manifest.files.find(file => file.file === 'dataset.json');
    const policy = await regular(join(retained.directory, 'dataset.json'), 65536, true);
    if (policy.sha256 !== descriptor.sha256 || policy.bytes !== descriptor.bytes)
      fail('CKAN_MERCHANT_FILE_CHANGED');
    maxPageBytes = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(policy.content)).maxPageBytes ?? 921600;
  }
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
    if (semantics) {
      const meanings = parameters ? incoming.getAll('semantics') :
        object(incoming) && Object.hasOwn(incoming, 'semantics') ? [incoming.semantics] : [];
      if (meanings.length > 1 || meanings.length === 1 && meanings[0] !== semantics.sha256)
        return { error: { status: 409, body: { error: 'CKAN_SEMANTICS_CHANGED',
          message: 'Select the reviewed meaning advertised by this CKAN merchant edition.' } } };
      if (parameters) incoming.delete('semantics'); else if (object(incoming)) delete incoming.semantics;
    }
    return { context: { ...context, query: incoming } };
  }
  function decorate(response) {
    if (!semantics || response.status !== 200) return response;
    const body = { ...response.body, semantics };
    if (Buffer.byteLength(JSON.stringify(body)) > maxPageBytes)
      return { status: 413, body: { error: 'DATASET_PAGE_TOO_LARGE',
        message: 'Use a smaller limit or select fewer fields; this page includes its reviewed semantic document.' } };
    return { ...response, headers: { ...response.headers, 'x-ckan-semantics-sha256': semantics.sha256 }, body };
  }
  function admitDataset(context) {
    normalized.delete(context);
    const value = request(context);
    if (value.error) return value.error;
    const admission = dataset.admit(value.context);
    if (admission !== true) return admission;
    if (!semantics) {
      normalized.set(context, { context: value.context });
      return true;
    }
    // The original engine prepares the page during admission. Consume that
    // exact cached page, add the retained meaning, and check the total bytes
    // before SF82 proceeds to payment. The paid handler returns this same page.
    const response = decorate(dataset.handle(value.context));
    if (response.status !== 200) return response;
    normalized.set(context, { response });
    return true;
  }
  function queryDataset(context) {
    const selected = normalized.get(context);
    normalized.delete(context);
    if (selected) return selected.response ?? dataset.handle(selected.context);
    const value = request(context);
    return value.error ?? decorate(dataset.handle(value.context));
  }
  return Object.freeze({ queryDataset, admitDataset,
    describe: semantics ? () => ({ ...description, semantics: { ...retained.manifest.semantics } }) : dataset.describe });
}
