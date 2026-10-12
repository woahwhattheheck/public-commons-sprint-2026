// MIT. Exact transfer identity for the original GraphQL workspace file sets.
import { createHash } from 'node:crypto';

export const GRAPHQL_EXPORT_SCHEMA = 'stellar-forge.graphql-mcp-export.v1';
export const GRAPHQL_EXPORT_MANIFEST = 'graphql-export.json';
export const GRAPHQL_EXPORT_MAX_BYTES = 256_065_000;
export const graphqlExportBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const graphqlExportSha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const alias = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
function fail(message) { throw Object.assign(new Error(message), { code: 'GRAPHQL_DOWNLOAD_MANIFEST_INVALID' }); }
export function graphqlFileName(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\\:\u0000-\u001f\u007f]/.test(value)
      || value.startsWith('/') || value.split('/').length > 32
      || value.split('/').some(part => !part || part === '.' || part === '..')
      || value === GRAPHQL_EXPORT_MANIFEST || value === 'download-state' || value.startsWith('download-state/'))
    fail('Use an original canonical relative file name outside reserved transfer metadata.');
  return value;
}
export function readGraphqlFileManifest(bytes, exportId) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 65000) fail('The original transfer manifest must fit its retained-file limit.');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('The transfer manifest is not valid UTF-8 JSON.'); }
  if (!plain(value) || value.schema !== GRAPHQL_EXPORT_SCHEMA || !alias(value.exportId) || value.exportId !== exportId
      || !alias(value.workspace) || !plain(value.selection) || !plain(value.source) || !sha(value.nativeManifestSha256)
      || !Array.isArray(value.files) || !value.files.length || value.files.length > 513
      || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)))
    fail('The manifest does not identify this original GraphQL workspace export.');
  const names = new Set(); let total = 0;
  for (const file of value.files) {
    if (!plain(file)) fail('The transfer contains an invalid native file record.');
    graphqlFileName(file.name);
    if (names.has(file.name) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 8 * 1024 * 1024
        || !sha(file.sha256) || typeof file.contentType !== 'string' || file.contentType.length > 240 || /[\r\n]/.test(file.contentType))
      fail('A native file has an invalid or repeated byte identity.');
    names.add(file.name); total += file.bytes;
  }
  if (total > GRAPHQL_EXPORT_MAX_BYTES) fail('The original file set exceeds its retained-transfer limit.');
  for (const name of names) {
    const parts = name.split('/');
    for (let index = 1; index < parts.length; index++)
      if (names.has(parts.slice(0, index).join('/'))) fail('A retained file conflicts with another file’s parent directory.');
  }
  const original = value.files.find(file => file.name === 'workspace-files.json');
  if (!original || original.sha256 !== value.nativeManifestSha256 || original.bytes > 65000)
    fail('The exact original workspace manifest is missing from this transfer.');
  return value;
}
