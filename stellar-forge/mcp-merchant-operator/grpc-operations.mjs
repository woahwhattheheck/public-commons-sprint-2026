// MIT. Incident operations through the original private native workspace and file store.
import { OPERATIONS_FILES } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/operations/report.mjs';
import { validateOperationsExport } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/operations/domain.mjs';
const select = (args, keys) => Object.fromEntries(keys.filter(key => args[key] !== undefined).map(key => [key, args[key]]));
export async function executeGrpcOperations(name, args, context) {
  const routes = {
    merchant_grpc_operations_capture: ['operations-capture', { id: args.captureId, ...select(args, ['selection']) }],
    merchant_grpc_operations_captures: ['operations-captures', select(args, ['offset', 'limit', 'expectedSnapshot'])],
    merchant_grpc_operations_read: ['operations-read', { id: args.captureId, ...select(args,
      ['section', 'recordId', 'offset', 'limit', 'expectedSnapshot', 'search', 'phase', 'method', 'revision']) }],
    merchant_grpc_operations_cases: ['operations-cases', select(args, ['state', 'severity', 'search', 'offset', 'limit', 'expectedSnapshot'])],
    merchant_grpc_operations_case: ['operations-case', { id: args.caseId, ...select(args, ['version']) }],
    merchant_grpc_operations_save: ['operations-save', { id: args.caseId, operationId: args.operationId, captureId: args.captureId,
      expectedVersion: args.expectedVersion, edit: args.edit }],
    merchant_grpc_operations_export: ['operations-export', { id: args.caseId, version: args.version }],
  };
  if (name === 'merchant_grpc_operations_receive') {
    const bundle = validateOperationsExport(await context.receiveBundle(args));
    return context.request('/api/operations-receive', { operationId: args.operationId, bundle });
  }
  const route = routes[name];
  if (!route) throw Object.assign(new Error('Choose an installed original operations tool.'), { code: 'METHOD_NOT_FOUND' });
  const value = await context.request('/api/' + route[0], route[1]);
  if (name === 'merchant_grpc_operations_export') {
    if (value.schema !== 'stellar-forge.grpc-operations-files.v1' || value.case?.id !== args.caseId || value.case?.version !== args.version ||
      !/^[a-f0-9]{64}$/.test(value.exportSha256 ?? ''))
      throw Object.assign(new Error('The original incident export identity changed.'), { code: 'GRPC_OPERATIONS_EXPORT_CHANGED' });
    return context.retain('operations', { operationId: value.case.id, reviewSha256: value.case.sha256,
      snapshotSha256: value.captureSha256, topic: 'operations:' + value.exportSha256 },
      OPERATIONS_FILES.map(file => ({ ...file, receive: consume => context.download(
        { exportSha256: value.exportSha256, file: file.path }, consume) })));
  }
  return context.bounded(value, { ...(args.caseId ? { operationId: args.caseId } : {}),
    ...(args.captureId ? { operationId: args.captureId } : {}), topic: 'operations-incident' });
}
