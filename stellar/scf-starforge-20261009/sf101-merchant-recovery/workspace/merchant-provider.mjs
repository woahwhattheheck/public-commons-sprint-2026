// MIT. SF101 recovery workspace source-owned merchant registration.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { recoveryWorkspaceTools } from './merchant-catalog.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'recovery-workspaces', family: 'recoveryWorkspaces',
  title: 'Merchant recovery workspaces', order: 610, catalogOrder: 610,
  configKey: 'recoveryWorkspaces', summary: true, dependencies: [],
  configuration: { input: 'recoveryWorkspaceConnection', privateExports: true,
    read: async (value, { hostPath }) =>
      (await import('./merchant-client.mjs')).readRecoveryWorkspaceConfiguration(hostPath(value)) },
  tools: recoveryWorkspaceTools, maxRequestBytes: 128 * 1024,
  concurrency: 'provider', shutdown: 'drain',
  load: () => import('./merchant-client.mjs'),
  create: (module, config) => new module.MerchantRecoveryWorkspaces(config),
  initialize: async options =>
    (await import('./merchant-setup.mjs')).initializeRecoveryWorkspaceMerchant(options),
  instructions: [{ prefix: 'merchant_recovery_', order: 610, text:
    'Use the host-selected recovery workspace alias. Read merchant_recovery_status to inspect the original profiles, capture plans, declared restored publishers and fleets, receiving targets and current native execution. The provider borrows the same running workspace as the browser and Applications. Review each complete selection with its stable profile and operation ID, inspect the exact source/destination, snapshot, counts and native reviewHash, then send that unchanged selection and expectedReviewHash to merchant_recovery_start. Fresh capture requires actual source-producer quiescence. Local-only profiles support capture, verification, retained request readback and declared publisher/fleet preparation. Transfer profiles use the existing original S3 configuration and passphrase environment. Page requests, operations and inventory with their unchanged original nextCursor. A returned RUNNING or PREPARED phase is accepted work; read merchant_recovery_request by exact profile/ID for its original COMPLETE, interruption or error. After a lost mutation response, read that same request before continuing. The original MCP error reason retains sanitized native JSON with HTTP/provider metadata and the exact readback tool. Use merchant_recovery_resume only for that retained selection, or review action resume to adopt an existing original remote journal. Cancellation requests a native stop and leaves the journal; original local stages may complete after cancellation. Publisher preparation selects either restoreId from an original COMPLETE remote restore or publisherRestoreId from the host declaration. Fleet preparation uses action fleet-prepare with exactly one restoreId or fleetRestoreId, one host-declared fleetTargetId and quiesced:true. Review the original snapshot/plan, full receiving paths, target availability, service UID/GID, engine operationId and reviewSha256. Start with the outer workspace reviewHash; the workspace binds the separate native receiving review. Retain the same request until its original FLEET_RECEIVING_COMPLETE result, then use the original managed-fleet startup and health controls for the prepared deployment. Preparation can finish after a stop request. Closing the MCP adapter drains its HTTP calls; the original workspace remains the execution owner.' }]
});
