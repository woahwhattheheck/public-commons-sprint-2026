// MIT. Complete immutable delivery identities for the original gRPC workspace.
import { createHash } from 'node:crypto';
import { canonical as grpcCanonical } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/common.mjs';
export { grpcCanonical };

export const GRPC_EXPORT_SCHEMA = 'stellar-forge.grpc-workspace-export.v1';
export const GRPC_EXPORT_MANIFEST = 'grpc-workspace-export.json';
export const GRPC_EXPORT_MAX_BYTES = 64 * 1024 * 1024;
export const GRPC_CUSTOMER_FILES = Object.freeze([
  { path: 'methods.json', maximum: 4 * 1024 * 1024 },
  { path: 'openapi.json', maximum: 16 * 1024 * 1024 },
  { path: 'client/seller-client.mjs', maximum: 1024 * 1024 },
  { path: 'client/seller-client.d.mts', maximum: 1024 * 1024 },
  { path: 'client/seller-openapi.json', maximum: 16 * 1024 * 1024 },
  { path: 'client/package.json', maximum: 65536 },
  { path: 'client/README.md', maximum: 1024 * 1024 },
]);
const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => { throw Object.assign(new Error('The complete original gRPC export manifest is invalid or changed.'), { code: 'GRPC_EXPORT_INVALID' }); };
export const grpcHash = value => createHash('sha256').update(value).digest('hex');
export function grpcExportIdentity(value) {
  const { exportId, ...source } = value;
  return grpcHash(grpcCanonical(source));
}
export function parseGrpcExportManifest(bytes, exportId) {
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { invalid(); }
  if (!plain(manifest) || Object.keys(manifest).some(key => !['schema', 'exportId', 'workspace', 'kind', 'original', 'files'].includes(key)) ||
      manifest.schema !== GRPC_EXPORT_SCHEMA || !SHA.test(manifest.exportId ?? '') ||
      exportId !== undefined && manifest.exportId !== exportId || !ALIAS.test(manifest.workspace ?? '') ||
      !['customer', 'revision', 'attempt', 'result'].includes(manifest.kind) || !plain(manifest.original) ||
      !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 7 ||
      grpcExportIdentity(manifest) !== manifest.exportId) invalid();
  const original = manifest.original;
  if (Object.keys(original).some(key => !['revision', 'preparation', 'operationId', 'topic'].includes(key)) ||
      original.revision !== undefined && !SHA.test(original.revision) ||
      original.preparation !== undefined && !UUID.test(original.preparation) ||
      original.operationId !== undefined && !UUID.test(original.operationId) ||
      original.topic !== undefined && (typeof original.topic !== 'string' || original.topic.length > 160)) invalid();
  if (manifest.kind === 'customer' && (!original.preparation || !original.revision) ||
      manifest.kind === 'revision' && !original.revision ||
      manifest.kind === 'attempt' && (!original.operationId || !original.revision)) invalid();
  const expected = manifest.kind === 'customer' ? GRPC_CUSTOMER_FILES
    : [{ path: manifest.kind === 'revision' ? 'grpc-revision.json' : manifest.kind === 'attempt' ? 'grpc-attempt.json' : 'grpc-result.json', maximum: 40 * 1024 * 1024 }];
  if (manifest.files.length !== expected.length) invalid();
  let total = 0;
  for (let index = 0; index < expected.length; index++) {
    const file = manifest.files[index], source = expected[index];
    if (!plain(file) || Object.keys(file).some(key => !['name', 'path', 'bytes', 'sha256', 'contentType'].includes(key)) ||
        file.path !== source.path || file.name !== source.path.replaceAll('/', '-') ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > source.maximum ||
        !SHA.test(file.sha256 ?? '') || typeof file.contentType !== 'string' ||
        !/^[a-z][a-z0-9.+-]*\/[a-z0-9.+-]+(?:; charset=utf-8)?$/.test(file.contentType)) invalid();
    total += file.bytes;
  }
  if (total > GRPC_EXPORT_MAX_BYTES) invalid();
  return manifest;
}
