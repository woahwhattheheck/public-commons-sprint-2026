// MIT. Source-owned agent metadata for the original recovery workspace.
export const RECOVERY_TOOL_PREFIX = 'merchant_recovery_';
export const RECOVERY_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$';
export const RECOVERY_SHA_PATTERN = '^[a-f0-9]{64}$';
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const id = { type: 'string', pattern: RECOVERY_ID_PATTERN };
const digest = { type: 'string', pattern: RECOVERY_SHA_PATTERN };
const bundle = { type: 'string', minLength: 3, maxLength: 1024,
  description: 'An exact bundleId returned by the original workspace, including its declared root ID.' };
const page = { cursor: { type: 'string', minLength: 1, maxLength: 8192,
  description: 'The original nextCursor; keep the same workspace, profile and query.' },
  limit: { type: 'integer', minimum: 1, maximum: 100 } };
const selected = { workspace: alias };
const profile = { ...selected, profileId: id };
const original = { ...profile, id };
const read = { readOnly: true, idempotent: true };
const shape = (action, properties, required = []) => ({ type: 'object', additionalProperties: false,
  properties: { profileId: id, action: { const: action }, id, ...properties },
  required: ['profileId', 'action', 'id', ...required] });
export const recoverySelectionSchema = {
  oneOf: [
    shape('snapshot', { capturePlanId: id, destinationName: id, quiesced: { const: true,
      description: 'Explicitly acknowledge that the reviewed source producers are quiesced for this capture.' } },
      ['capturePlanId', 'quiesced']),
    shape('verify', { bundleId: bundle }, ['bundleId']),
    { ...shape('publisher-prepare', { restoreId: id, publisherRestoreId: id }),
      oneOf: [{ required: ['restoreId'], not: { required: ['publisherRestoreId'] } },
        { required: ['publisherRestoreId'], not: { required: ['restoreId'] } }] },
    shape('push', { bundleId: bundle }, ['bundleId']),
    shape('pull', { snapshotId: digest, destinationName: id }, ['snapshotId']),
    shape('restore', { snapshotId: digest, destinationName: id, bundleId: bundle }, ['snapshotId']),
    shape('resume', {})
  ]
};
export function recoveryWorkspaceTools(tool) {
  return [
    tool('merchant_recovery_status', 'Read the original recovery workspace, host-declared profiles, local capture plans, declared restored publishers and current execution. The browser and MCP share this native owner.',
      selected, ['workspace'], read),
    tool('merchant_recovery_bundles', 'List complete encrypted bundle candidates under this original profile\'s declared roots. Preserve bundleId and snapshotId; original verification authenticates a selected bundle.',
      profile, ['workspace', 'profileId'], read),
    tool('merchant_recovery_inventory', 'Page the configured original remote store\'s completed snapshots. Follow nextCursor unchanged with the same workspace/profile. Local-only profiles keep their native local recovery operations.',
      { ...profile, ...page }, ['workspace', 'profileId'], { ...read, openWorld: true }),
    tool('merchant_recovery_requests', 'Page retained workspace requests, including local capture, verification, publisher preparation and transfers. Follow nextCursor; use request for exact same-ID readback.',
      { ...selected, ...page }, ['workspace'], read),
    tool('merchant_recovery_request', 'Read one original workspace request by profile and operation ID, including native phase, attempts, local progress/result, transfer journal and current error. Use after a lost start/resume/cancel response.',
      original, ['workspace', 'profileId', 'id'], read),
    tool('merchant_recovery_operations', 'Page the original off-host transfer journals under a declared profile. Local capture and publisher preparation are retained as workspace requests.',
      { ...profile, ...page }, ['workspace', 'profileId'], read),
    tool('merchant_recovery_operation', 'Read the original off-host push/pull/restore journal by exact profile and ID, including completed snapshot, paths and provider receipts. Use request for local operations.',
      original, ['workspace', 'profileId', 'id'], read),
    tool('merchant_recovery_review', 'Review a complete native selection without starting it. Inspect exact source, destination, counts, host store and reviewHash. Fresh capture requires actual producer quiescence. Action resume adopts an existing remote journal; publisher-prepare selects exactly one original remote restore or host-declared restored publisher.',
      { ...selected, selection: recoverySelectionSchema }, ['workspace', 'selection'], { ...read, openWorld: true }),
    tool('merchant_recovery_start', 'Start only the exact native selection and expectedReviewHash returned by review. Retain its profile/operation ID. A RUNNING or PREPARED result is an accepted operation; read request until the original COMPLETE or error outcome.',
      { ...selected, selection: recoverySelectionSchema, expectedReviewHash: digest },
      ['workspace', 'selection', 'expectedReviewHash'], { idempotent: true, openWorld: true }),
    tool('merchant_recovery_resume', 'Continue an existing workspace request with its original saved selection. First read that same request after uncertainty. An incomplete fresh capture may require a new native review with explicit producer quiescence.',
      original, ['workspace', 'profileId', 'id'], { idempotent: true, openWorld: true }),
    tool('merchant_recovery_cancel', 'Ask the original workspace to stop this execution while retaining its ID and journal. Read the same request to observe completion or interruption; local verification/restore can finish after the stop request.',
      original, ['workspace', 'profileId', 'id'], { idempotent: true, destructive: true })
  ];
}
