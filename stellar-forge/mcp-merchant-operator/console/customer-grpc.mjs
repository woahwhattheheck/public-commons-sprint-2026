// MIT. gRPC customer receiving through the original retained-file transport.
import { createRetainedDownload } from '../retained-download.mjs';
import { GRPC_EXPORT_MANIFEST, GRPC_EXPORT_MAX_BYTES, parseGrpcExportManifest } from '../grpc-workspace-export.mjs';
import {
  GRPC_CUSTOMER_FAMILY, GRPC_CUSTOMER_WORKSPACE_PATTERN, GRPC_CUSTOMER_EXPORT_PATTERN,
  normalizeGrpcCustomer, grpcCustomerAccess,
  validateGrpcCustomerRecord, retainGrpcCustomerManifest
} from './grpc-customer-records.mjs';
import { fail } from './records.mjs';

export { normalizeGrpcCustomer, grpcCustomerAccess };
export const GRPC_CUSTOMER_DOWNLOAD = Object.freeze({
  manifestName: GRPC_EXPORT_MANIFEST, parseManifest: parseGrpcExportManifest,
  maximumBytes: GRPC_EXPORT_MAX_BYTES,
  stateSchema: 'stellar-forge.grpc-workspace-download.v1',
  resultSchema: 'stellar-forge.grpc-workspace-received.v1',
  toolPrefix: 'merchant_grpc_export', errorPrefix: 'GRPC_EXPORT',
  clientName: 'starforge-merchant-console',
  validateExportId(value) {
    if (typeof value !== 'string' || !new RegExp(GRPC_CUSTOMER_EXPORT_PATTERN).test(value))
      throw fail('CONSOLE_GRPC_SELECTION', 'Select the original gRPC export ID.', 400);
    return value;
  },
  describe: manifest => ({ workspace: manifest.workspace, kind: manifest.kind, original: manifest.original })
});
export function createGrpcCustomerTransfer({ operator, authorize }, selection, request) {
  const selected = normalizeGrpcCustomer(selection);
  return createRetainedDownload({
    ...GRPC_CUSTOMER_DOWNLOAD,
    parseManifest(bytes, exportId) {
      const manifest = parseGrpcExportManifest(bytes, exportId);
      if (manifest.workspace !== selected.workspace)
        throw fail('CONSOLE_GRPC_WORKSPACE_CHANGED', 'This export belongs to a different original gRPC workspace.', 409);
      return manifest;
    },
    connect: async () => ({
      endpoint: 'urn:stellar-forge:merchant-host:' + selected.hostFingerprint + ':grpc:' + selected.workspace,
      async call(name, args) {
        // The original manifest/file/release tools do not accept workspace.
        const values = { ...args };
        const context = await authorize(request, name, values);
        return operator.call(name, values, context ? { authorization: context } : undefined);
      }
    })
  });
}
export const grpcCustomerFamily = Object.freeze({
  id: GRPC_CUSTOMER_FAMILY, label: 'gRPC merchant, contract and service observations',
  workspaceRequired: true, workspacePattern: GRPC_CUSTOMER_WORKSPACE_PATTERN,
  exportPattern: GRPC_CUSTOMER_EXPORT_PATTERN,
  toolPrefix: GRPC_CUSTOMER_DOWNLOAD.toolPrefix,
  manifestName: GRPC_CUSTOMER_DOWNLOAD.manifestName,
  maximumBytes: GRPC_CUSTOMER_DOWNLOAD.maximumBytes,
  normalize: normalizeGrpcCustomer, access: grpcCustomerAccess,
  createTransfer: createGrpcCustomerTransfer, parseManifest: parseGrpcExportManifest,
  validateRecord: validateGrpcCustomerRecord, retainManifest: retainGrpcCustomerManifest
});
