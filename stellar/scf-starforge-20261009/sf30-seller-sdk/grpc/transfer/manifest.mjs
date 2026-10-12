// MIT. Closed original-state manifest for a complete private gRPC workspace.
import { canonical, sha256, fields, fail } from '../common.mjs';
import { validateGrpcWorkspaceBinding } from '../workspace/binding.mjs';

export const GRPC_TRANSFER_SCHEMA = 'stellar-forge.grpc-workspace-transfer.v1';
export const GRPC_TRANSFER_ARCHIVE_SCHEMA = 'stellar-forge.grpc-workspace-archive.v1';
export const GRPC_TRANSFER_RECEIVING_SCHEMA = 'stellar-forge.grpc-workspace-receiving.v1';
export const GRPC_TRANSFER_MANIFEST = 'grpc-workspace-transfer.json';
export const GRPC_TRANSFER_ARCHIVE = 'grpc-workspace.tar.gz';
export const GRPC_TRANSFER_MANIFEST_BYTES = 16 * 1024 * 1024;
export const GRPC_TRANSFER_FILE_BYTES = 1024 * 1024 * 1024;
export const GRPC_TRANSFER_MAX_BYTES = 64 * 1024 * 1024 * 1024;
export const GRPC_TRANSFER_ARCHIVE_BYTES = GRPC_TRANSFER_MAX_BYTES + 256 * 1024 * 1024;
export const GRPC_TRANSFER_DEFAULT_BYTES = 8 * 1024 * 1024 * 1024;
export const GRPC_TRANSFER_MAX_FILES = 50000;
export const GRPC_TRANSFER_CHUNK_BYTES = 1024 * 1024;
export const GRPC_TRANSFER_COUNTS = Object.freeze([
  'revisions', 'reflections', 'attempts', 'health', 'upgrades', 'incidents', 'preparations', 'releases',
]);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const ENV = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const bad = () => fail('GRPC_TRANSFER_MANIFEST_INVALID', 422);

export function transferId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('GRPC_TRANSFER_ID_INVALID');
  return value;
}
export function transferSha(value) {
  if (typeof value !== 'string' || !SHA.test(value)) fail('GRPC_TRANSFER_SHA256_INVALID');
  return value;
}
export function transferInteger(value, maximum, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) bad();
  return value;
}
export function transferPath(value) {
  if (typeof value !== 'string' || !value || value.length > 512 || value.startsWith('/') ||
      /[\\\x00-\x1f\x7f]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..'))
    fail('GRPC_TRANSFER_PATH_INVALID');
  if (!value.startsWith('workspace/') && !value.startsWith('observations/'))
    fail('GRPC_TRANSFER_PATH_INVALID');
  return value;
}
function sortedUnique(values, validate) {
  if (!Array.isArray(values)) bad();
  for (let i = 0; i < values.length; i++) {
    validate(values[i]);
    if (i && values[i - 1] >= values[i]) bad();
  }
}
export function validateGrpcTransferManifest(value) {
  fields(value, ['schema', 'id', 'createdAt', 'origin', 'counts', 'environmentNames', 'health', 'files', 'bytes', 'sha256'],
    'GRPC_TRANSFER_MANIFEST_FIELDS_INVALID');
  if (value.schema !== GRPC_TRANSFER_SCHEMA) bad();
  transferId(value.id); transferSha(value.sha256);
  if (typeof value.createdAt !== 'string' || value.createdAt.length > 40 ||
      !/^\d{4}-\d{2}-\d{2}T/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) bad();
  fields(value.origin, ['directory', 'binding'], 'GRPC_TRANSFER_ORIGIN_INVALID');
  validateGrpcWorkspaceBinding(value.origin.binding);
  if (value.origin.directory !== value.origin.binding.directory) bad();
  fields(value.counts, GRPC_TRANSFER_COUNTS, 'GRPC_TRANSFER_COUNTS_INVALID');
  for (const key of GRPC_TRANSFER_COUNTS) transferInteger(value.counts[key], GRPC_TRANSFER_MAX_FILES);
  if (value.environmentNames?.length > 4096) bad();
  sortedUnique(value.environmentNames, name => { if (typeof name !== 'string' || !ENV.test(name)) bad(); });
  if (!Array.isArray(value.files) || value.files.length > GRPC_TRANSFER_MAX_FILES) bad();
  let bytes = 0, previous = '';
  const paths = new Map();
  for (const file of value.files) {
    fields(file, ['path', 'bytes', 'sha256', 'kind'], 'GRPC_TRANSFER_FILE_FIELDS_INVALID');
    transferPath(file.path); transferSha(file.sha256); transferInteger(file.bytes, GRPC_TRANSFER_FILE_BYTES);
    if (file.path <= previous || paths.has(file.path)) bad();
    const parts = file.path.split('/');
    for (let depth = 1; depth < parts.length; depth++)
      if (paths.has(parts.slice(0, depth).join('/'))) bad();
    previous = file.path; paths.set(file.path, file); bytes += file.bytes;
    if (bytes > GRPC_TRANSFER_MAX_BYTES) fail('GRPC_TRANSFER_TOO_LARGE', 413);
    if (!['workspace', 'health-prefix', 'observation'].includes(file.kind)) bad();
    if ((file.kind === 'observation') !== file.path.startsWith('observations/')) bad();
    if (file.kind === 'health-prefix' && !/^workspace\/health\/[a-f0-9-]{36}\/events\.ndjson$/.test(file.path)) bad();
    if (file.path === 'workspace/.grpc-transfer-source.json' ||
        file.path === 'workspace/.grpc-transfer-receiving.json' ||
        /^workspace\/\.grpc-transfer-observations(?:\/|$)/.test(file.path)) bad();
    if (/^workspace\/(?:run\.json|managed-launches(?:\/|$)|merchant-releases\.receiving(?:\/|$))/.test(file.path) ||
        file.path === 'workspace/merchant-releases/runtime.json' ||
        /^workspace\/merchant-releases\/releases\/[^/]+\/(?:pilot-runtime\.json|runtime-readiness\.json|grpc-runtime(?:\/|$))/.test(file.path))
      bad();
    if (file.path === 'workspace/transfers' || file.path === 'workspace/temporary') bad();
    if (file.path === 'workspace/lease.lock' || file.path.startsWith('workspace/transfers/') ||
        file.path.startsWith('workspace/temporary/') || /\/(?:run|state)\.lock(?:\/|$)/.test(file.path) ||
        /\/.sf82-(?:run|state)\.lock\.lifetime$/.test(file.path)) bad();
  }
  transferInteger(value.bytes, GRPC_TRANSFER_MAX_BYTES);
  if (value.bytes !== bytes) bad();
  if (!Array.isArray(value.health) || value.health.length > GRPC_TRANSFER_MAX_FILES) bad();
  previous = '';
  for (const health of value.health) {
    fields(health, ['id', 'throughSequence', 'snapshotSha256', 'bytes'], 'GRPC_TRANSFER_HEALTH_FIELDS_INVALID');
    transferId(health.id); transferSha(health.snapshotSha256);
    transferInteger(health.throughSequence, 10130); transferInteger(health.bytes, GRPC_TRANSFER_FILE_BYTES);
    if (health.id <= previous) bad();
    previous = health.id;
    const journal = paths.get('workspace/health/' + health.id + '/events.ndjson');
    if (!paths.has('workspace/health/' + health.id + '/operation.json') ||
        !journal || journal.kind !== 'health-prefix' || journal.bytes !== health.bytes) bad();
  }
  if (value.health.length !== value.counts.health) bad();
  const { sha256: expected, ...body } = value;
  if (sha256(canonical(body)) !== expected) fail('GRPC_TRANSFER_MANIFEST_CHANGED', 409);
  if (Buffer.byteLength(JSON.stringify(value)) > GRPC_TRANSFER_MANIFEST_BYTES)
    fail('GRPC_TRANSFER_MANIFEST_TOO_LARGE', 413);
  return structuredClone(value);
}
export function createGrpcTransferManifest(body) {
  const value = { ...body, schema: GRPC_TRANSFER_SCHEMA };
  delete value.sha256;
  value.files = [...value.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  value.environmentNames = [...new Set(value.environmentNames)].sort();
  value.health = [...value.health].sort((a, b) => a.id.localeCompare(b.id));
  value.bytes = value.files.reduce((sum, file) => sum + file.bytes, 0);
  return validateGrpcTransferManifest({ ...value, sha256: sha256(canonical(value)) });
}
export function validateGrpcTransferArchive(value, { manifest = true } = {}) {
  if (!value || value.schema !== GRPC_TRANSFER_ARCHIVE_SCHEMA || value.filename !== GRPC_TRANSFER_ARCHIVE) bad();
  transferSha(value.sha256); transferSha(value.manifestSha256);
  transferInteger(value.bytes, GRPC_TRANSFER_ARCHIVE_BYTES, 1);
  if (manifest) {
    validateGrpcTransferManifest(value.manifest);
    if (value.manifest.sha256 !== value.manifestSha256) bad();
  }
  return structuredClone(value);
}
export function normalizeGrpcTransferCapture(body) {
  fields(body, ['id', 'expectedBinding', 'maxBytes'], 'GRPC_TRANSFER_CAPTURE_FIELDS_INVALID');
  transferId(body.id);
  const maxBytes = body.maxBytes ?? GRPC_TRANSFER_DEFAULT_BYTES;
  transferInteger(maxBytes, GRPC_TRANSFER_MAX_BYTES, 1);
  const expectedBinding = body.expectedBinding === undefined ? undefined : validateGrpcWorkspaceBinding(body.expectedBinding);
  return { id: body.id, maxBytes, ...(expectedBinding ? { expectedBinding } : {}) };
}
export function transferDescriptor(record) {
  if (!record || record.state !== 'COMPLETED' || !record.archive) fail('GRPC_TRANSFER_NOT_COMPLETE', 409);
  const archive = validateGrpcTransferArchive({ ...record.archive, manifest: record.manifest ?? record.archive.manifest });
  return { ...archive, id: record.id, createdAt: record.createdAt };
}
