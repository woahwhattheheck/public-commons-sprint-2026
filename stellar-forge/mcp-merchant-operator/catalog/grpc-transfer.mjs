// MIT. Whole original gRPC workspace migration on the existing merchant operator.
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const uuid = { type: 'string', pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' };
const sha = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const integer = { type: 'integer', minimum: 0 };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const binding = object({
  schema: { type: 'string', const: 'stellar-forge.grpc-workspace-binding.v1' },
  directory: { type: 'string', minLength: 1, maxLength: 4096 },
  identity: object({ device: { type: 'string', pattern: '^[0-9]+$' }, inode: { type: 'string', pattern: '^[0-9]+$' } }),
  current: { anyOf: [{ type: 'null' }, object({ revision: sha, generation: { type: 'integer', minimum: 1 }, sha256: sha })] },
});
const selection = object({ kind: { type: 'string', enum: ['capture', 'upload'] }, id: uuid });
const bytes = { type: 'integer', minimum: 1, maximum: 64 * 1024 ** 3 + 256 * 1024 ** 2 };
const page = { offset: integer, limit: { type: 'integer', minimum: 1, maximum: 250 }, expectedSnapshot: sha };
const workspace = { workspace: alias }, operation = { ...workspace, operationId: uuid };
const read = { readOnly: true, idempotent: true };
export function grpcTransferTools(tool) {
  return [
    tool('merchant_grpc_transfer_list', 'Page complete saved workspace captures or receiving receipts. The original binding in this response pins a new capture; continue pages with the returned snapshot.', {
      ...workspace, kind: { type: 'string', enum: ['captures', 'receipts'] }, ...page }, ['workspace'], read),
    tool('merchant_grpc_transfer_capture', 'Capture the complete original native workspace, including all source/call/health/upgrade/incident/preparation/release histories, into one immutable archive. Save operationId and this exact expectedBinding before invoking; repeat the same input to continue its original capture.', {
      ...operation, expectedBinding: binding, maxBytes: { type: 'integer', minimum: 1, maximum: 64 * 1024 ** 3 } },
      ['workspace', 'operationId', 'expectedBinding'], { idempotent: true }),
    tool('merchant_grpc_transfer_read', 'Recover a saved full-workspace capture. Summary includes counts, byte hashes and credential environment names; manifest returns the complete original file inventory through the existing retained-file route when large.', {
      ...operation, section: { type: 'string', enum: ['summary', 'manifest'] } }, ['workspace', 'operationId'], read),
    tool('merchant_grpc_transfer_files', 'Page original paths, roles, lengths and SHA-256 values in the selected immutable workspace capture.', {
      ...operation, ...page, kind: { type: 'string', enum: ['workspace', 'health-prefix', 'observation'] },
      search: { type: 'string', maxLength: 512 } }, ['workspace', 'operationId'], read),
    tool('merchant_grpc_transfer_upload', 'Stream a host-declared workspace-transfer archive or an existing complete workspace-transfer export into the selected original operator. Keep the same operationId, full SHA-256 and byte length to continue a partial upload. Select exactly one file or exportId.', {
      ...operation, file: alias, exportId: sha, expectedExportManifestSha256: sha, expectedSha256: sha, expectedBytes: bytes },
      ['workspace', 'operationId', 'expectedSha256', 'expectedBytes'], { idempotent: true }),
    tool('merchant_grpc_transfer_upload_status', 'Read the original archive intake byte position and completion under its retained upload operation.', operation,
      ['workspace', 'operationId'], read),
    tool('merchant_grpc_transfer_inspect', 'Inspect every selected archive member and its complete source manifest before choosing a receiving destination.', {
      ...workspace, archive: selection }, ['workspace', 'archive'], read),
    tool('merchant_grpc_transfer_receive', 'Receive the complete reviewed archive into a host-declared new workspace destination. The same operationId and exact hashes resume the original private stage and preserve later native edits after completion.', {
      ...operation, archive: selection, destination: alias, expectedSha256: sha, expectedBytes: bytes, expectedManifestSha256: sha },
      ['workspace', 'operationId', 'archive', 'destination', 'expectedSha256', 'expectedBytes', 'expectedManifestSha256'], { idempotent: true }),
    tool('merchant_grpc_transfer_receipt', 'Read the original receiving record, native complete-history verification and current relocated binding. Later source edits remain visible through that current binding.', operation,
      ['workspace', 'operationId'], read),
    tool('merchant_grpc_transfer_open', 'Start the explicitly received native editor using its current exact binding. Returns its new private link; the original parent operator owns and closes this new editor.', {
      ...operation, expectedBinding: binding }, ['workspace', 'operationId', 'expectedBinding'], { idempotent: true }),
    tool('merchant_grpc_transfer_close', 'Close the original received editor and all resources owned by that editor while preserving its saved workspace.', operation,
      ['workspace', 'operationId'], { idempotent: true }),
    tool('merchant_grpc_transfer_cancel', 'Cancel the original in-progress capture or receiving operation and await its settled storage. The same saved operation remains available for continuation.', operation,
      ['workspace', 'operationId'], { idempotent: true }),
    tool('merchant_grpc_transfer_export', 'Retain both exact full-workspace files in the original merchant delivery transport: the source manifest and complete gzip archive. Page/download them using the existing merchant_grpc_export tools and receive with the original migration receiver.', {
      ...operation, expectedManifestSha256: sha }, ['workspace', 'operationId', 'expectedManifestSha256'], { idempotent: true }),
  ];
}
