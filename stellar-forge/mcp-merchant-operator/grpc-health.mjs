// MIT. Health tooling composes the original workspace and retained export store.
import { validateGrpcHealthSnapshot, GRPC_HEALTH_MAX_BYTES } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/health-record.mjs';
const selected = (args, keys) => Object.fromEntries(keys.filter(key => args[key] !== undefined).map(key => [key, args[key]]));
export async function executeGrpcHealth(name, args, context) {
  const route = {
    merchant_grpc_health_observations: ['health-list', selected(args, ['revision', 'offset', 'limit', 'expectedSnapshot'])],
    merchant_grpc_health_start: ['health-start', { id: args.operationId, revision: args.revision, request: args.request }],
    merchant_grpc_health_read: ['health-read', { id: args.operationId, ...selected(args,
      ['section', 'afterSequence', 'throughSequence', 'expectedSnapshot', 'limit', 'serviceFilter']) }],
    merchant_grpc_health_stop: ['health-cancel', { id: args.operationId }],
    merchant_grpc_health_resume: ['health-resume', { id: args.operationId, expectedVersion: args.expectedVersion }],
    merchant_grpc_health_export: ['health-export', { id: args.operationId,
      ...selected(args, ['expectedVersion', 'throughSequence', 'expectedSnapshot']) }],
  }[name];
  if (!route) throw Object.assign(new Error('Choose an installed original health operation.'), { code: 'METHOD_NOT_FOUND' });
  const value = await context.request('/api/' + route[0], route[1]);
  if (name === 'merchant_grpc_health_export') {
    validateGrpcHealthSnapshot(value);
    if (value.operation.id !== args.operationId) throw Object.assign(new Error('The original health identity changed.'), { code: 'GRPC_HEALTH_RECORD_CHANGED' });
    return context.retain('health', { operationId: value.operation.id, revision: value.operation.revision,
      snapshotSha256: value.snapshotSha256, topic: 'service-health' }, [{
      path: 'grpc-health.json', maximum: GRPC_HEALTH_MAX_BYTES, contentType: 'application/json',
      bytes: Buffer.from(JSON.stringify(value) + '\n'),
    }]);
  }
  return context.bounded(value, { ...(args.operationId ? { operationId: args.operationId } : {}),
    ...(value.operation?.revision ? { revision: value.operation.revision } : {}), topic: 'service-health' });
}
