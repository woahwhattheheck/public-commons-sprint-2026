// MIT. Complete migration through the existing private operator and file transport.
import { transferDescriptor, validateGrpcTransferArchive, GRPC_TRANSFER_MANIFEST, GRPC_TRANSFER_ARCHIVE,
  GRPC_TRANSFER_MANIFEST_BYTES, GRPC_TRANSFER_ARCHIVE_BYTES } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/transfer/manifest.mjs';
import { uploadGrpcTransferArchive } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/transfer/client.mjs';

const failure = (code, message) => Object.assign(new Error(message), { code });
const selected = (args, names) => Object.fromEntries(names.filter(name => args[name] !== undefined).map(name => [name, args[name]]));
function recordSummary(value) {
  const { manifest, ...record } = value;
  return { ...record, ...(manifest ? { manifestSummary: { id: manifest.id, sha256: manifest.sha256,
    createdAt: manifest.createdAt, origin: manifest.origin, counts: manifest.counts,
    files: manifest.files.length, bytes: manifest.bytes, environmentNames: manifest.environmentNames,
    healthPrefixes: manifest.health.length } } : {}) };
}
export async function executeGrpcTransfer(name, args, context) {
  const action = name.slice('merchant_grpc_transfer_'.length);
  const request = (route, value) => context.request('/api/transfer-' + route, value);
  const original = { operationId: args.operationId, topic: 'workspace-transfer' };
  if (action === 'list') return request('list', selected(args, ['kind', 'offset', 'limit', 'expectedSnapshot']));
  if (action === 'capture') return recordSummary(await request('capture', {
    id: args.operationId, ...selected(args, ['expectedBinding', 'maxBytes']) }));
  if (action === 'read') {
    const record = await request('read', { id: args.operationId });
    if (args.section === 'manifest') {
      if (!record.manifest) throw failure('GRPC_TRANSFER_SNAPSHOT_NOT_COMPLETE', 'The original capture has not committed its complete source manifest.');
      return context.bounded(record.manifest, { ...original, snapshotSha256: record.manifest.sha256 });
    }
    return recordSummary(record);
  }
  if (action === 'files') return request('files', { id: args.operationId,
    ...selected(args, ['kind', 'search', 'offset', 'limit', 'expectedSnapshot']) });
  if (action === 'upload') {
    const source = await context.uploadSource(args);
    return uploadGrpcTransferArchive({ request: (route, body, options) => context.request('/api/transfer-' + route, body, options) },
      { id: args.operationId, path: source.path, expectedSha256: args.expectedSha256, expectedBytes: args.expectedBytes },
      { signal: context.signal });
  }
  if (action === 'upload_status') return request('upload-status', { id: args.operationId });
  if (action === 'inspect') {
    const value = validateGrpcTransferArchive(await request('inspect', { archive: args.archive }));
    return context.bounded(value, { operationId: value.manifest.id, topic: 'workspace-transfer', snapshotSha256: value.manifestSha256 });
  }
  if (action === 'receive') return request('receive', { id: args.operationId, archive: args.archive,
    directory: context.destination(args.destination), ...selected(args, ['expectedSha256', 'expectedBytes', 'expectedManifestSha256']) });
  if (action === 'receipt') return request('receipt', { id: args.operationId });
  if (action === 'open') return request('open', { id: args.operationId, expectedBinding: args.expectedBinding });
  if (action === 'close' || action === 'cancel') return request(action, { id: args.operationId });
  if (action === 'export') {
    const archive = transferDescriptor(await request('read', { id: args.operationId }));
    if (archive.manifestSha256 !== args.expectedManifestSha256)
      throw failure('GRPC_TRANSFER_MANIFEST_CHANGED', 'Use the selected original capture manifest hash.');
    const input = { id: args.operationId, expectedManifestSha256: archive.manifestSha256 };
    return context.retain('workspace-transfer', { ...original, snapshotSha256: archive.manifestSha256 }, [
      { path: GRPC_TRANSFER_MANIFEST, maximum: GRPC_TRANSFER_MANIFEST_BYTES, contentType: 'application/json',
        receive: consume => context.download('manifest-file', input, consume) },
      { path: GRPC_TRANSFER_ARCHIVE, maximum: GRPC_TRANSFER_ARCHIVE_BYTES, contentType: 'application/gzip',
        receive: consume => context.download('archive', input, response => {
          if (response.headers.get('content-length') !== String(archive.bytes) ||
            response.headers.get('x-content-sha256') !== archive.sha256)
            throw failure('GRPC_TRANSFER_ARCHIVE_CHANGED', 'The original archive headers differ from its completed capture.');
          return consume(response);
        }) },
    ]);
  }
  throw failure('INVALID_PARAMS', 'Choose a declared whole-workspace migration action.');
}
