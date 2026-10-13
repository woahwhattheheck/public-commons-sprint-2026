/** MIT. Original source/state custody; no provider credentials in these inputs. */
export interface HostHandoffRoot { name: string; path: string }
export interface HostHandoffSelection {
  schema: 'stellar-forge.recovery-workspace-handoff-selection.v1';
  operationId: string;
  configFile: string;
  workspaceDirectory: string;
  application: { sourceDirectory: string; manifestFile: string };
  roots: HostHandoffRoot[];
  externalFiles?: Array<{ path: string; purpose: string }>;
}
export interface HostHandoffTarget {
  schema: 'stellar-forge.recovery-workspace-handoff-target.v1';
  workspaceId: string;
  manifestSha256: string;
  /** V1 preserves original absolute journal paths; every root must be explicit. */
  mappings: HostHandoffRoot[];
  /** These are local private files supplied outside the encrypted handoff. */
  externalFiles: Array<{ path: string; expectedSha256: string }>;
}
export interface HostHandoffRestoreInput {
  bundleDirectory: string;
  restoreDirectory: string;
  passphraseEnv: string;
  expectedManifestSha256: string;
}
export interface HostHandoffReceivingInput extends HostHandoffRestoreInput { targetFile: string }
export interface HostHandoffAdoptInput extends HostHandoffReceivingInput {
  expectedReviewSha256: string;
  quiesced: true;
}
export interface HostHandoffResult {
  schema: 'stellar-forge.recovery-workspace-handoff-result.v1';
  status: 'HOST_HANDOFF_PLAN_READY' | 'HOST_HANDOFF_EXPORTED' | 'HOST_HANDOFF_RESTORED' |
    'HOST_HANDOFF_REVIEW' | 'HOST_HANDOFF_ADOPTED';
  [key: string]: unknown;
}
export declare const HOST_HANDOFF_SELECTION_SCHEMA: 'stellar-forge.recovery-workspace-handoff-selection.v1';
export declare const HOST_HANDOFF_SCHEMA: 'stellar-forge.recovery-workspace-handoff.v1';
export declare const HOST_HANDOFF_TARGET_SCHEMA: 'stellar-forge.recovery-workspace-handoff-target.v1';
export declare const HOST_HANDOFF_RESULT_SCHEMA: 'stellar-forge.recovery-workspace-handoff-result.v1';
export declare function inspectHostHandoffApplication(application: HostHandoffSelection['application']): Promise<Record<string, unknown>>;
export declare function prepareHostHandoffPlan(input: {
  selection: HostHandoffSelection; planFile: string; quiesced: true;
}): Promise<HostHandoffResult>;
export declare function exportHostHandoff(input: {
  planFile: string; bundleDirectory: string; operationDirectory: string;
  passphraseEnv: string; expectedPlanSha256: string; quiesced?: boolean;
}): Promise<HostHandoffResult>;
export declare function restoreHostHandoff(input: HostHandoffRestoreInput): Promise<HostHandoffResult>;
export declare function inspectRestoredHostHandoff(input: HostHandoffReceivingInput): Promise<HostHandoffResult>;
export declare function adoptRestoredHostHandoff(input: HostHandoffAdoptInput): Promise<HostHandoffResult>;
