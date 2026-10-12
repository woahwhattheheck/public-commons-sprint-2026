// MIT. Portable selection of the original SEC source and saved revision files.
import { createHash } from 'node:crypto';

export const OPERATOR_ARCHIVE_SCHEMA = 'stellar-forge.sec-edgar-operator-archive.v1';
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 8 * 1024 * 1024 * 1024;
export const MAX_MEMBERS = 100000;
export const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const EDITION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const need = (condition, code, message = code) => {
  if (!condition) throw Object.assign(new Error(message), { code, status: 409 });
};
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const encoded = value => Buffer.from(JSON.stringify(canonical(value)) + '\n');
export const same = (left, right) => encoded(left).equals(encoded(right));
export function revisionName(revision) {
  need(Number.isSafeInteger(revision) && revision >= 0 && revision < 1000000000000,
    'EDGAR_PORTABLE_REVISION_INVALID');
  return String(revision).padStart(12, '0') + '.json';
}
export function exportId(value) {
  need(typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value),
    'EDGAR_PORTABLE_ID_INVALID', 'Use a stable export name with letters, numbers, hyphens or underscores.');
  return value;
}
export function validateOperatorManifest(value) {
  need(object(value) && value.schema === OPERATOR_ARCHIVE_SCHEMA,
    'EDGAR_PORTABLE_MANIFEST_INVALID', 'Select a complete SEC operator workspace archive.');
  const selected = value.workspace;
  need(object(selected) && /^edgar-[a-f0-9-]{36}$/.test(selected.workspaceId ?? '') &&
    Number.isSafeInteger(selected.revision) && selected.revision >= 0 && selected.revision + 1 < MAX_MEMBERS &&
    typeof selected.createdAt === 'string' && Number.isFinite(Date.parse(selected.createdAt)) &&
    HASH.test(selected.initialRevisionSha256 ?? '') && HASH.test(selected.revisionSha256 ?? '') &&
    (selected.configSha256 === null || HASH.test(selected.configSha256 ?? '')),
  'EDGAR_PORTABLE_WORKSPACE_INVALID');
  need(Array.isArray(value.editions) && value.editions.length < MAX_MEMBERS &&
    new Set(value.editions.map(row => row?.id)).size === value.editions.length,
  'EDGAR_PORTABLE_EDITIONS_INVALID');
  const expected = new Set();
  for (let revision = 0; revision <= selected.revision; revision++)
    expected.add('workspace/versions/' + revisionName(revision));
  for (const edition of value.editions) {
    need(object(edition) && edition.schema === 'stellar-forge.sec-edgar-edition.v1' &&
      EDITION.test(edition.id ?? '') && ['facts', 'filings'].includes(edition.kind) &&
      /^\d{10}$/.test(edition.cik ?? '') && HASH.test(edition.sourceSha256 ?? '') &&
      Number.isSafeInteger(edition.sourceBytes) && edition.sourceBytes > 0 && edition.sourceBytes <= MAX_FILE_BYTES &&
      Number.isSafeInteger(edition.recordCount) && edition.recordCount >= 0,
    'EDGAR_PORTABLE_EDITION_INVALID');
    expected.add('source-store/editions/' + edition.id + '.json');
    expected.add('source-store/blobs/' + edition.sourceSha256 + '.json');
  }
  need(Array.isArray(value.files) && value.files.length === expected.size && value.files.length + 1 <= MAX_MEMBERS &&
    new Set(value.files.map(file => file?.path)).size === value.files.length,
  'EDGAR_PORTABLE_INVENTORY_INVALID');
  let expanded = encoded(value).length;
  need(expanded <= MAX_MANIFEST_BYTES, 'EDGAR_PORTABLE_MANIFEST_LIMIT');
  const byPath = new Map();
  for (const file of value.files) {
    need(object(file) && expected.has(file.path) && typeof file.bytes === 'string' &&
      /^(0|[1-9][0-9]{0,15})$/.test(file.bytes) && Number(file.bytes) > 0 && Number(file.bytes) <= MAX_FILE_BYTES &&
      HASH.test(file.sha256 ?? ''),
    'EDGAR_PORTABLE_FILE_INVALID');
    expanded += Number(file.bytes);
    need(expanded <= MAX_EXPANDED_BYTES, 'EDGAR_PORTABLE_SIZE_LIMIT');
    byPath.set(file.path, file);
  }
  need(byPath.get('workspace/versions/' + revisionName(0)).sha256 === selected.initialRevisionSha256 &&
    byPath.get('workspace/versions/' + revisionName(selected.revision)).sha256 === selected.revisionSha256,
  'EDGAR_PORTABLE_REVISION_BINDING_INVALID');
  for (const edition of value.editions) {
    const file = byPath.get('source-store/blobs/' + edition.sourceSha256 + '.json');
    need(file.sha256 === edition.sourceSha256 && Number(file.bytes) === edition.sourceBytes,
      'EDGAR_PORTABLE_SOURCE_BINDING_INVALID');
  }
  return value;
}
export function portableSummary(manifest) {
  validateOperatorManifest(manifest);
  return {
    schema: OPERATOR_ARCHIVE_SCHEMA, reviewSha256: digest(encoded(manifest)),
    workspaceId: manifest.workspace.workspaceId, revision: manifest.workspace.revision,
    configSha256: manifest.workspace.configSha256, revisions: manifest.workspace.revision + 1,
    editions: manifest.editions.length, captures: new Set(manifest.editions.map(row => row.sourceSha256)).size,
    files: manifest.files.length, bytes: String(manifest.files.reduce((sum, file) => sum + Number(file.bytes), 0)),
  };
}
