import type { RecoveryIdentity } from './merchant-client.mjs';
export interface RecoveryMerchantReceivingInput {
  schema: 'stellar-forge.recovery-merchant-receiving.v1';
  directory: string;
  workspaceDirectory: string;
  hostConfig: string;
  profileId: string;
  bundleId: string;
  snapshotId: string;
  operationId: string;
  workspace?: string;
  completedOperations: Array<{ id: string; command: 'push' | 'pull' | 'restore' }>;
}
export interface RecoveryMerchantReceivingResult {
  schema: 'stellar-forge.recovery-merchant-receiving-result.v1';
  operationId: string;
  status: 'COMPLETE';
  startedAt: string;
  finishedAt: string;
  snapshotId: string;
  identity: RecoveryIdentity;
  phases: Array<{ name: string; completedAt: string; value: unknown }>;
}
export declare function receiveRecoveryWorkspaceMerchant(input: RecoveryMerchantReceivingInput, options?: {
  onProgress?: (progress: { operationId: string; phase: string }) => void | Promise<void>;
}): Promise<RecoveryMerchantReceivingResult>;
export declare const HELP: string;
export declare function main(argv?: string[]): Promise<RecoveryMerchantReceivingResult | void>;
