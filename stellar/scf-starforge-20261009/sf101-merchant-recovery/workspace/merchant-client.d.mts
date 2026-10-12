export type RecoveryWorkspaceAlias = string;
export type RecoveryProfileId = string;
export type RecoveryOperationId = string;
export type RecoveryDigest = string;
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
  | { action: 'snapshot'; capturePlanId: string; quiesced: true; destinationName?: string }
  | { action: 'verify'; bundleId: string }
  | ({ action: 'publisher-prepare' } & (
      | { restoreId: RecoveryOperationId; publisherRestoreId?: never }
      | { publisherRestoreId: string; restoreId?: never }))
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
export interface RecoveryToolInputs {
  merchant_recovery_status: RecoveryWorkspaceInput;
  merchant_recovery_bundles: RecoveryProfileInput;
  merchant_recovery_inventory: RecoveryProfileInput & RecoveryPage;
  merchant_recovery_requests: RecoveryWorkspaceInput & RecoveryPage;
  merchant_recovery_request: RecoveryOriginalInput;
  merchant_recovery_operations: RecoveryProfileInput & RecoveryPage;
  merchant_recovery_operation: RecoveryOriginalInput;
  merchant_recovery_review: RecoveryWorkspaceInput & { selection: RecoverySelection };
  merchant_recovery_start: RecoveryWorkspaceInput & { selection: RecoverySelection; expectedReviewHash: RecoveryDigest };
  merchant_recovery_resume: RecoveryOriginalInput;
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
  constructor(config: { recoveryWorkspaces?: RecoveryWorkspaceConfiguration | null });
  readonly summary: RecoveryWorkspaceSummary;
  call<N extends keyof RecoveryToolInputs>(name: N, args: RecoveryToolInputs[N]): Promise<RecoveryToolResult>;
  close(): Promise<void>;
}
