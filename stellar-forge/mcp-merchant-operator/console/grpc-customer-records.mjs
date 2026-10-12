// MIT. Complete original gRPC identities in the retained Merchant Console.
import { canonical, digest, fail } from './records.mjs';

export const GRPC_CUSTOMER_FAMILY = 'grpc';
export const GRPC_CUSTOMER_MANIFEST = 'grpc-workspace-export.json';
export const GRPC_CUSTOMER_TOOL_PREFIX = 'merchant_grpc_export';
export const GRPC_CUSTOMER_WORKSPACE_PATTERN = '^[a-z0-9][a-z0-9_-]{0,63}$';
export const GRPC_CUSTOMER_EXPORT_PATTERN = '^[a-f0-9]{64}$';
const ALIAS = new RegExp(GRPC_CUSTOMER_WORKSPACE_PATTERN);
const SHA = new RegExp(GRPC_CUSTOMER_EXPORT_PATTERN);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const checked = (value, pattern, label) => {
  if (typeof value !== 'string' || !pattern.test(value))
    throw fail('CONSOLE_GRPC_SELECTION', 'Select the original ' + label + '.', 400);
  return value;
};
/** Preserve the native manifest's exact UTF-8 bytes across canonical profile archives. */
export function retainGrpcCustomerManifest(bytes) {
  if (!bytes || bytes.length < 1 || bytes.length > 65000)
    throw fail('CONSOLE_ARCHIVE_CHANGED', 'Retain the complete bounded original gRPC manifest.', 400);
  try { return { manifestText: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }; }
  catch { throw fail('CONSOLE_ARCHIVE_CHANGED', 'Retain the original UTF-8 gRPC manifest bytes.', 400); }
}
export function grpcCustomerManifestBytes(record) {
  if (typeof record.manifestText !== 'string' || !record.manifestText ||
      Buffer.byteLength(record.manifestText, 'utf8') > 65000)
    throw fail('CONSOLE_ARCHIVE_CHANGED', 'Retain the exact original gRPC manifest text with this completed delivery.', 400);
  return Buffer.from(record.manifestText, 'utf8');
}
export function normalizeGrpcCustomer(input) {
  if (!plain(input) || input.family !== GRPC_CUSTOMER_FAMILY)
    throw fail('CONSOLE_GRPC_SELECTION', 'Select the original gRPC customer family.', 400);
  return {
    profileId: input.profileId, family: GRPC_CUSTOMER_FAMILY,
    workspace: checked(input.workspace, ALIAS, 'gRPC workspace alias'),
    exportId: checked(input.exportId, SHA, 'gRPC export ID'),
    expectedManifestSha256: checked(input.expectedManifestSha256, SHA, 'gRPC manifest SHA-256'),
    hostFingerprint: checked(input.expectedHostFingerprint ?? input.hostFingerprint, SHA, 'host fingerprint')
  };
}
/** A workspace is a manifest identity; original export readers take only exportId. */
export function grpcCustomerAccess(selection) {
  const selected = normalizeGrpcCustomer(selection);
  return { name: GRPC_CUSTOMER_TOOL_PREFIX + '_manifest', args: { exportId: selected.exportId } };
}
export function validateGrpcCustomerRecord(record) {
  if (!plain(record) || !plain(record.identity))
    throw fail('CONSOLE_ARCHIVE_CHANGED', 'Retain the original gRPC customer selection.', 400);
  const selected = normalizeGrpcCustomer(record.identity);
  if (canonical(selected) !== canonical(record.identity))
    throw fail('CONSOLE_ARCHIVE_CHANGED', 'The retained gRPC customer selection changed.', 400);
  if (record.state !== 'COMPLETE') return;
  const bytes = grpcCustomerManifestBytes(record);
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw fail('CONSOLE_ARCHIVE_CHANGED', 'Retain the exact original JSON manifest.', 400); }
  const invalid = () => { throw fail('CONSOLE_ARCHIVE_CHANGED', 'Retain the original gRPC export identity and safe complete file metadata.', 400); };
  if (!plain(manifest) || Object.keys(manifest).some(key => !['schema', 'workspace', 'kind', 'original', 'files', 'exportId'].includes(key)) ||
      manifest.schema !== 'stellar-forge.grpc-workspace-export.v1' ||
      manifest.exportId !== selected.exportId || manifest.workspace !== selected.workspace ||
      !['customer', 'revision', 'attempt', 'stream', 'result', 'upgrade', 'health', 'operations'].includes(manifest.kind) ||
      !plain(manifest.original) || !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 7)
    invalid();
  const { exportId, ...source } = manifest;
  if (digest(canonical(source)) !== exportId) invalid();
  const names = new Set(), paths = new Set();
  for (const file of manifest.files) {
    if (!plain(file) || Object.keys(file).some(key => !['name', 'path', 'bytes', 'sha256', 'contentType'].includes(key)) ||
        typeof file.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(file.name) ||
        typeof file.path !== 'string' || file.path.length > 255 ||
        file.path.split('/').some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) || part === '.' || part === '..') ||
        file.path.split('/').length > 8 || file.name !== file.path.replaceAll('/', '-') ||
        names.has(file.name) || paths.has(file.path) || file.name === GRPC_CUSTOMER_MANIFEST ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 1024 * 1024 * 1024 ||
        !SHA.test(file.sha256 ?? '') || typeof file.contentType !== 'string' ||
        !/^[a-z][a-z0-9.+-]*\/[a-z0-9.+-]+(?:; charset=utf-8)?$/.test(file.contentType)) invalid();
    names.add(file.name); paths.add(file.path);
  }
  // The selected family subsequently applies the complete original kind-specific
  // parser. Store/profile loading binds exact bytes and safe metadata without
  // importing any gRPC native runtime or receiving engine.
  const files = [...manifest.files, {
    name: GRPC_CUSTOMER_MANIFEST, bytes: bytes.length, sha256: digest(bytes)
  }];
  if (manifest.workspace !== selected.workspace || digest(bytes) !== selected.expectedManifestSha256 ||
      canonical(manifest) !== canonical(record.manifest) ||
      canonical(record.files) !== canonical(files))
    throw fail('CONSOLE_ARCHIVE_CHANGED', 'Retain the exact gRPC manifest, workspace and complete original file identities.', 400);
}
