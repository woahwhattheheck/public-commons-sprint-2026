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
    shape('object-compare',{beforeObjectSessionId:id,afterObjectSessionId:id,beforeExpectedRecordSha256:digest,afterExpectedRecordSha256:digest},
      ['beforeObjectSessionId','afterObjectSessionId','beforeExpectedRecordSha256','afterExpectedRecordSha256']),
    shape('object-bundle-export',{sourceRequestId:id,sourceReviewHash:digest,sourceAttempt:{type:'integer',minimum:0},sourceSide:{enum:['before','after'],description:'Required only when exporting an edition from a saved clean completed comparison.'}},
      ['sourceRequestId','sourceReviewHash','sourceAttempt']),
    shape('object-bundle-receive',{archiveId:id,objectSessionId:id},['archiveId','objectSessionId']),
    shape('snapshot', { capturePlanId: id, destinationName: id, quiesced: { const: true,
      description: 'Explicitly acknowledge that the reviewed source producers are quiesced for this capture.' } },
      ['capturePlanId', 'quiesced']),
    shape('verify', { bundleId: bundle }, ['bundleId']),
    shape('object-snapshot', { objectSessionId: id, quiesced: { const: true,
      description: 'Confirm the selected original Object-session writers remain stopped through capture.' } },
      ['objectSessionId', 'quiesced']),
    ...['object-verify', 'object-restore'].map(action => shape(action,
      { objectSessionId: id, expectedRecordSha256: digest }, ['objectSessionId', 'expectedRecordSha256'])),
    { ...shape('publisher-prepare', { restoreId: id, publisherRestoreId: id }),
      oneOf: [{ required: ['restoreId'], not: { required: ['publisherRestoreId'] } },
        { required: ['publisherRestoreId'], not: { required: ['restoreId'] } }] },
    { ...shape('fleet-prepare', { restoreId: id, fleetRestoreId: id, fleetTargetId: id,
        quiesced: { const: true, description: 'Confirm the original fleet producers are stopped and the selected receiving paths remain quiesced.' } },
      ['fleetTargetId', 'quiesced']),
      oneOf: [{ required: ['restoreId'], not: { required: ['fleetRestoreId'] } },
        { required: ['fleetRestoreId'], not: { required: ['restoreId'] } }] },
    shape('push', { bundleId: bundle }, ['bundleId']),
    shape('pull', { snapshotId: digest, destinationName: id }, ['snapshotId']),
    shape('restore', { snapshotId: digest, destinationName: id, bundleId: bundle }, ['snapshotId']),
    shape('resume', {})
  ]
};

export const recoverySupportSelectionSchema={type:'object',additionalProperties:false,
  properties:{profileId:id,id,transferId:alias,caseId:{type:'string',format:'uuid'},expectedRevision:digest,
    slot:{enum:['before','after']},expectedReviewHash:digest,afterAttempt:{type:'integer',minimum:0}},
  required:['profileId','id','transferId','caseId','expectedRevision','slot','expectedReviewHash','afterAttempt']};

export function recoveryWorkspaceTools(tool) {
  return [
    tool('merchant_recovery_comparison_artifact','Read one complete immutable native comparison result, HTML report or Markdown report from the exact saved original request. Select the returned artifact SHA-256; this does not authenticate again or restore.',
      {...original,kind:{enum:['result','html','markdown']},sha256:digest},['workspace','profileId','id','kind','sha256'],read),
    tool('merchant_recovery_bundle_inspection','Inspect every encrypted archive member and original manifest from a host-declared archive. This structural read retains its full report; it does not authenticate or restore.',
      {...profile,archiveId:id},['workspace','profileId','archiveId'],{idempotent:true}),
    tool('merchant_recovery_bundle_report','Read the exact full report or native verification result retained by a completed encrypted-bundle request.',
      {...original,kind:{enum:['report','verification','publication']}},['workspace','profileId','id'],read),
    tool('merchant_recovery_bundle_artifact','Read the complete original exported ciphertext archive path, bytes and SHA-256. Transfer it as binary; never convert it into model context.',
      original,['workspace','profileId','id'],read),
    tool('merchant_recovery_bundle_pair','Read the exact two-file pair identity from completed before/after exports of one saved authenticated comparison. Review its pair SHA before attaching; no native verification occurs.',
      {...profile,beforeId:id,afterId:id},['workspace','profileId','beforeId','afterId'],read),
    tool('merchant_recovery_bundle_pair_attach','Attach both complete comparison archives as one original SF49 source delivery to the saved comparison Support case. Bind the exact pair SHA, original Support review and current case revision.',
      {...profile,beforeId:id,afterId:id,transferId:alias,expectedPairSha256:digest,expectedReviewSha256:digest,expectedRevision:digest,actor:{type:'string',minLength:1,maxLength:200}},
      ['workspace','profileId','beforeId','afterId','transferId','expectedPairSha256','expectedReviewSha256','expectedRevision','actor'],{idempotent:true}),
    tool('merchant_recovery_bundle_attach','Attach a completed original encrypted archive through existing SF49 source delivery to an already saved recovery Support case with actual commissioning terms. Preserve its exact original case revision and operator.',
      {...original,transferId:alias,expectedReviewSha256:digest,expectedRevision:digest,actor:{type:'string',minLength:1,maxLength:200}},
      ['workspace','profileId','id','transferId','expectedReviewSha256','expectedRevision','actor'],{idempotent:true}),
    tool('merchant_recovery_bundle_attachment','Read the original binary attachment request/result after a missing response. Select exactly one archiveSha256 or comparison pairSha256. An unfinished attachment requires explicit continuation with identical arguments.',
      {...profile,transferId:alias,archiveSha256:digest,pairSha256:digest},['workspace','profileId','transferId'],read),
    tool('merchant_recovery_bundle_case_export','Export the whole saved case revision that actually contains the original encrypted archive or two-file comparison attachment. Select exactly one archiveSha256 or pairSha256, including the existing full source editions and history.',
      {...profile,transferId:alias,archiveSha256:digest,pairSha256:digest},['workspace','profileId','transferId'],{idempotent:true}),
    tool('merchant_recovery_support_cases','List existing Support cases in this host-declared profile. Select an exact case revision; this never creates a case.',
      {...profile,q:{type:'string',maxLength:1000},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200}},
      ['workspace','profileId'],read),
    tool('merchant_recovery_support_transfers','List retained recovery/comparison-to-Support transfers, including incomplete preparations and saved original case results.',
      profile,['workspace','profileId'],read),
    tool('merchant_recovery_support_transfer','Read the exact original prepared transfer and saved case result after a lost review/save/export response.',
      {...profile,transferId:alias},['workspace','profileId','transferId'],read),
    tool('merchant_recovery_support_review','Freeze the complete saved Object recovery or backup-comparison request and every referenced original evidence/artifact body into a review for one existing Support case revision and before/after slot. The complete cohort is capped at 64 MiB without truncation. Encrypted native backups remain external; no comparison or verification is dispatched.',
      {...selected,selection:recoverySupportSelectionSchema},['workspace','selection'],{idempotent:true}),
    tool('merchant_recovery_support_save','Save only the exact confirmed recovery-to-Support review through the original case CAS. A repeated original transfer reconciles immutable history without overwriting later case edits.',
      {...profile,transferId:alias,expectedReviewSha256:digest},['workspace','profileId','transferId','expectedReviewSha256'],{idempotent:true}),
    tool('merchant_recovery_support_handoff','Return the complete saved Support handoff text and its exact byte/hash identity, preserving workspace and every original recovery evidence or comparison artifact body. It does not contain external encrypted backups.',
      {...profile,transferId:alias},['workspace','profileId','transferId'],read),
    tool('merchant_recovery_support_export','Export the saved transfer through the existing full case-source-package engine, retaining original case history and any genuine attached SF49 source editions. An external native backup is included only if it exists in that actual source inventory.',
      {...profile,transferId:alias,expectedReviewSha256:digest},['workspace','profileId','transferId','expectedReviewSha256'],{idempotent:true}),
    tool('merchant_recovery_support_package','Verify the complete original package already exported for this transfer. This never saves or replays a recovery request.',
      {...profile,transferId:alias},['workspace','profileId','transferId'],read),
    tool('merchant_recovery_status', 'Read the original recovery workspace, host-declared profiles, local capture plans, declared restored publishers and fleets, fleet receiving targets and current execution. The browser and MCP share this native owner.',
      selected, ['workspace'], read),
    tool('merchant_recovery_object_session', 'Inspect one host-declared original standalone Object session and retain its complete native evidence. This observes source bytes without acquisition, payment or backup dispatch.',
      { ...profile, objectSessionId: id }, ['workspace', 'profileId', 'objectSessionId'], read),
    tool('merchant_recovery_object_evidence', 'Read the exact retained native Object inspection or operation evidence by its returned SHA-256. This never invokes a native operation.',
      { ...selected, sha256: digest }, ['workspace', 'sha256'], read),
    tool('merchant_recovery_bundles', 'List complete encrypted bundle candidates under this original profile\'s declared roots. Preserve bundleId and snapshotId; original verification authenticates a selected bundle.',
      profile, ['workspace', 'profileId'], read),
    tool('merchant_recovery_inventory', 'Page the configured original remote store\'s completed snapshots. Follow nextCursor unchanged with the same workspace/profile. Local-only profiles keep their native local recovery operations.',
      { ...profile, ...page }, ['workspace', 'profileId'], { ...read, openWorld: true }),
    tool('merchant_recovery_requests', 'Page retained workspace requests, including local capture, verification, publisher/fleet preparation and transfers. Follow nextCursor; use request for exact same-ID readback.',
      { ...selected, ...page }, ['workspace'], read),
    tool('merchant_recovery_request', 'Read one original workspace request by profile and operation ID, including native phase, attempts, local progress/result, transfer journal and current error. Use after a lost start/resume/cancel response.',
      original, ['workspace', 'profileId', 'id'], read),
    tool('merchant_recovery_operations', 'Page the original off-host transfer journals under a declared profile. Local capture and publisher/fleet preparation are retained as workspace requests.',
      { ...profile, ...page }, ['workspace', 'profileId'], read),
    tool('merchant_recovery_operation', 'Read the original off-host push/pull/restore journal by exact profile and ID, including completed snapshot, paths and provider receipts. Use request for local operations.',
      original, ['workspace', 'profileId', 'id'], read),
    tool('merchant_recovery_review', 'Review a complete native selection without starting it. Inspect exact source, destination, counts, host store and reviewHash. Fresh capture requires actual producer quiescence. Action resume adopts an existing remote journal; publisher-prepare selects exactly one original remote restore or host-declared restored publisher. Fleet-prepare selects exactly one restoreId or fleetRestoreId, one host-declared fleetTargetId and explicit quiesced:true; inspect the original receiving review, source roots, destination availability and operation ID.',
      { ...selected, selection: recoverySelectionSchema }, ['workspace', 'selection'], { ...read, openWorld: true }),
    tool('merchant_recovery_start', 'Start only the exact native selection and expectedReviewHash returned by review. Retain its profile/operation ID. A RUNNING or PREPARED result is an accepted operation; read request until the original COMPLETE or error outcome.',
      { ...selected, selection: recoverySelectionSchema, expectedReviewHash: digest },
      ['workspace', 'selection', 'expectedReviewHash'], { idempotent: true, openWorld: true }),
    tool('merchant_recovery_resume', 'Continue an existing workspace request with its original saved selection. First read that same request after uncertainty. Standalone Object, comparison and encrypted-bundle requests require their exact expectedReviewHash and observed afterAttempt; object-snapshot additionally requires fresh quiesced:true. An older attempt returns the current retained request without another dispatch.',
      { ...original, expectedReviewHash: digest, afterAttempt: { type: 'integer', minimum: 0 }, quiesced: { const: true } },
      ['workspace', 'profileId', 'id'], { idempotent: true, openWorld: true }),
    tool('merchant_recovery_cancel', 'Ask the original workspace to stop this execution while retaining its ID and journal. Read the same request to observe completion or interruption; local verification/restore or fleet preparation can finish after the stop request.',
      original, ['workspace', 'profileId', 'id'], { idempotent: true, destructive: true })
  ];
}
