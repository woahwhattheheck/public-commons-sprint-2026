import type { RecoveryIdentity } from './merchant-client.mjs';
export const RECOVERY_LAUNCH_SCHEMA: 'stellar-forge.recovery-workspace-launch.v1';
export const RECOVERY_LAUNCH_FILE: 'recovery-workspace-launch.json';
export const RECOVERY_SOURCE_DIRECTORY: string;
export interface RecoveryLaunchView {
  schema: typeof RECOVERY_LAUNCH_SCHEMA;
  instanceId: string;
  pid: number;
  startedAt: string;
  origin: string;
  sourceDirectory: string;
  identity: RecoveryIdentity;
}
/** This launch contains the private native browser URL; keep it on the owning host. */
export interface RecoveryPrivateLaunch extends RecoveryLaunchView { url: string; }
export function recoveryLaunchView(value: RecoveryPrivateLaunch): RecoveryLaunchView;
export function publishRecoveryWorkspaceLaunch(input: {
  directory: string; identity: RecoveryIdentity; origin: string; token: string;
}): Promise<RecoveryPrivateLaunch>;
export function retireRecoveryWorkspaceLaunch(input: {
  directory: string; instanceId: string;
}): Promise<{ retired: boolean }>;
export function readRecoveryWorkspaceSelection(input: {
  directory: string; configFile: string;
}): Promise<RecoveryIdentity>;
/** Host-only attachment result. The merchant adapter sends token solely to this native loopback listener. */
export function readRecoveryWorkspaceLaunch(input: {
  directory: string; configFile: string; expectedIdentity?: RecoveryIdentity;
}): Promise<RecoveryLaunchView & { token: string }>;
