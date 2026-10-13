export type RecoveryWorkspaceAlias = string;
export type RecoveryProfileId = string;
export type RecoveryOperationId = string;
export type RecoveryDigest = string;
export type RecoveryFleetRestoreId = string;
export type RecoveryFleetTargetId = string;
/** The original host selects all paths; the caller selects one restored source and one receiving target. */
export type RecoveryFleetSelection = {
  action: 'fleet-prepare';
  fleetTargetId: RecoveryFleetTargetId;
  quiesced: true;
} & (
  | { restoreId: RecoveryOperationId; fleetRestoreId?: never }
  | { fleetRestoreId: RecoveryFleetRestoreId; restoreId?: never }
);
export interface RecoveryIdentity {
  schema: 'stellar-forge.recovery-workspace-identity.v1';
  workspaceId: string;
  directory: string;
  configFile: string;
  configurationSha256: RecoveryDigest;
}
export type RecoverySelection = {
  profileId: RecoveryProfileId;
  id: RecoveryOperationId;
} & (
  | { action:'object-compare';beforeObjectSessionId:string;afterObjectSessionId:string;beforeExpectedRecordSha256:RecoveryDigest;afterExpectedRecordSha256:RecoveryDigest }
  | { action:'object-bundle-export';sourceRequestId:string;sourceReviewHash:RecoveryDigest;sourceAttempt:number;sourceSide?:'before'|'after' }
  | { action:'object-bundle-receive';archiveId:string;objectSessionId:string }
  | { action: 'snapshot'; capturePlanId: string; quiesced: true; destinationName?: string }
  | { action: 'verify'; bundleId: string }
  | { action: 'object-snapshot'; objectSessionId: string; quiesced: true }
  | { action: 'object-verify' | 'object-restore'; objectSessionId: string; expectedRecordSha256: RecoveryDigest }
  | ({ action: 'publisher-prepare' } & (
      | { restoreId: RecoveryOperationId; publisherRestoreId?: never }
      | { publisherRestoreId: string; restoreId?: never }))
  | RecoveryFleetSelection
  | { action: 'push'; bundleId: string }
  | { action: 'pull'; snapshotId: RecoveryDigest; destinationName?: string }
  | { action: 'restore'; snapshotId: RecoveryDigest; destinationName?: string; bundleId?: string }
  | { action: 'resume' }
);
export interface RecoveryWorkspaceConfiguration {
  schema: 'stellar-forge.recovery-workspace-connection.v1';
  connectionFile: string;
  selectionSha256: string;
  workspaces: Record<RecoveryWorkspaceAlias, {
    label: string;
    directory: string;
    configFile: string;
    sourceDirectory: string;
    identity: RecoveryIdentity;
  }>;
}
export interface RecoveryPage { cursor?: string; limit?: number; }
export interface RecoveryWorkspaceInput { workspace: RecoveryWorkspaceAlias; }
export interface RecoveryProfileInput extends RecoveryWorkspaceInput { profileId: RecoveryProfileId; }
export interface RecoveryOriginalInput extends RecoveryProfileInput { id: RecoveryOperationId; }
/** Selects a saved object-snapshot, object-verify, object-restore or object-compare request.
 * The complete request and all referenced original bodies must fit the 64 MiB Support cohort.
 * Both encrypted bundle paths remain external for object-compare; no new native run occurs.
 */
export interface RecoverySupportSelection {
  profileId:RecoveryProfileId; id:RecoveryOperationId; transferId:string; caseId:string;
  expectedRevision:RecoveryDigest;slot:'before'|'after';expectedReviewHash:RecoveryDigest;afterAttempt:number;
}
export interface RecoverySupportInput extends RecoveryProfileInput {transferId:string;}
export type RecoveryAttachmentIdentity =
  | {archiveSha256:RecoveryDigest;pairSha256?:never}
  | {pairSha256:RecoveryDigest;archiveSha256?:never};
export interface RecoveryToolInputs {
  merchant_recovery_comparison_artifact:RecoveryOriginalInput & {kind:'result'|'html'|'markdown';sha256:RecoveryDigest};
  merchant_recovery_bundle_inspection:RecoveryProfileInput & {archiveId:string};
  merchant_recovery_bundle_report:RecoveryOriginalInput & {kind?:'report'|'verification'|'publication'};
  merchant_recovery_bundle_artifact:RecoveryOriginalInput;
  merchant_recovery_bundle_pair:RecoveryProfileInput & {beforeId:string;afterId:string};
  merchant_recovery_bundle_pair_attach:RecoverySupportInput & {beforeId:string;afterId:string;expectedPairSha256:RecoveryDigest;
    expectedReviewSha256:RecoveryDigest;expectedRevision:RecoveryDigest;actor:string};
  merchant_recovery_bundle_attach:RecoveryOriginalInput & {transferId:string;expectedReviewSha256:RecoveryDigest;
    expectedRevision:RecoveryDigest;actor:string};
  merchant_recovery_bundle_attachment:RecoverySupportInput & RecoveryAttachmentIdentity;
  merchant_recovery_bundle_case_export:RecoverySupportInput & RecoveryAttachmentIdentity;
  merchant_recovery_support_cases:RecoveryProfileInput & {q?:string;offset?:number;limit?:number};
  merchant_recovery_support_transfers:RecoveryProfileInput;
  merchant_recovery_support_transfer:RecoverySupportInput;
  merchant_recovery_support_review:RecoveryWorkspaceInput & {selection:RecoverySupportSelection};
  merchant_recovery_support_save:RecoverySupportInput & {expectedReviewSha256:RecoveryDigest};
  merchant_recovery_support_handoff:RecoverySupportInput;
  merchant_recovery_support_export:RecoverySupportInput & {expectedReviewSha256:RecoveryDigest};
  merchant_recovery_support_package:RecoverySupportInput;
  merchant_recovery_status: RecoveryWorkspaceInput;
  merchant_recovery_object_session: RecoveryProfileInput & { objectSessionId: string };
  merchant_recovery_object_evidence: RecoveryWorkspaceInput & { sha256: RecoveryDigest };
  merchant_recovery_bundles: RecoveryProfileInput;
  merchant_recovery_inventory: RecoveryProfileInput & RecoveryPage;
  merchant_recovery_requests: RecoveryWorkspaceInput & RecoveryPage;
  merchant_recovery_request: RecoveryOriginalInput;
  merchant_recovery_operations: RecoveryProfileInput & RecoveryPage;
  merchant_recovery_operation: RecoveryOriginalInput;
  merchant_recovery_review: RecoveryWorkspaceInput & { selection: RecoverySelection };
  merchant_recovery_start: RecoveryWorkspaceInput & { selection: RecoverySelection; expectedReviewHash: RecoveryDigest };
  merchant_recovery_resume: RecoveryOriginalInput & {
    expectedReviewHash?: RecoveryDigest; afterAttempt?: number; quiesced?: true;
  };
  merchant_recovery_cancel: RecoveryOriginalInput;
}
export interface RecoveryConnectionView {
  instanceId: string;
  workspaceId: string;
  configurationSha256: RecoveryDigest;
  sourceDirectory: string;
  origin: string;
}
/** Native fields are preserved. The original phase/status, not HTTP acceptance, determines completion. */
export type RecoveryToolResult = Record<string, unknown> & {
  workspace: RecoveryWorkspaceAlias;
  connection: RecoveryConnectionView;
};
export interface RecoveryWorkspaceSummary {
  configured: boolean;
  ownership: 'ORIGINAL_RECOVERY_WORKSPACE';
  workspaces: Array<{ workspace: RecoveryWorkspaceAlias; label: string; workspaceId: string; configurationSha256: RecoveryDigest }>;
  activeCalls: number;
  closing: boolean;
}
export const RECOVERY_WORKSPACE_CONNECTION_SCHEMA: 'stellar-forge.recovery-workspace-connection.v1';
export function readRecoveryWorkspaceConfiguration(path: string): Promise<RecoveryWorkspaceConfiguration>;
export function recoveryWorkspaceTools<T>(tool: (
  name: keyof RecoveryToolInputs, description: string, properties: Record<string, unknown>,
  required: string[], options: { readOnly?: boolean; idempotent?: boolean; destructive?: boolean; openWorld?: boolean }
) => T): T[];
export class MerchantRecoveryWorkspaces {
  constructor(config: { recoveryWorkspaces?: Pick<RecoveryWorkspaceConfiguration, 'workspaces'> | null });
  readonly summary: RecoveryWorkspaceSummary;
  call<N extends keyof RecoveryToolInputs>(name: N, args: RecoveryToolInputs[N]): Promise<RecoveryToolResult>;
  close(): Promise<void>;
}
