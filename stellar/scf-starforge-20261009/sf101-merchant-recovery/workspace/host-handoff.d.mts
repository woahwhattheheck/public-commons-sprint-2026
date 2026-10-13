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
export interface HostHandoffReceivingInput extends HostHandoffRestoreInput {
  targetFile: string;
  /** Private original receiving operation; enables resumable staged root publication. */
  operationDirectory?: string;
  /** Linux publication helper; default /usr/bin/python3, bound into the review. */
  python?: string;
}
export interface HostHandoffAdoptInput extends HostHandoffReceivingInput {
  expectedReviewSha256: string;
  quiesced: true;
  /** Applies to the retained adoption operation; publication drains before its lease closes. */
  signal?: AbortSignal;
}
export interface HostHandoffPathObservation {
  path: string;
  kind: 'file' | 'directory' | 'entry';
  actualKind?: 'file' | 'directory';
  exists: boolean;
  required: boolean;
  role: string;
  profileId: string;
  operationId?: string;
  selectionId: string | null;
  custody: 'captured' | 'external';
}
export interface HostHandoffPathInventory {
  schema: 'stellar-forge.recovery-workspace-host-paths.v1';
  paths: HostHandoffPathObservation[];
  planSources: Array<{ path: string; bytes: number; sha256: string; roots: HostHandoffRoot[] }>;
  unavailablePlans: Array<{ path: string; profileId: string; operationId: string;
    expectedSha256: string; actualSha256: string | null; rootsRetainedInRequest: boolean;
    reason: 'ORIGINAL_PLAN_MISSING' | 'ORIGINAL_PLAN_CHANGED' }>;
  objectSources: Array<{
    directory: string;
    stateRoot: string;
    prepared: boolean;
    treeSha256?: string;
    nativeReviewSha256?: string;
    objectSession?: Record<string, unknown>;
    assemblies?: Array<Record<string, unknown>>;
    absentLedger?: { path: string; state: 'ABSENT' };
    restoreMode?: 'ORIGINAL_CANONICAL_STATE_ROOT';
    walletEnvironmentExported?: false;
  }>;
}
export interface HostHandoffResult {
  schema: 'stellar-forge.recovery-workspace-handoff-result.v1';
  status: 'HOST_HANDOFF_PLAN_READY' | 'HOST_HANDOFF_EXPORTED' | 'HOST_HANDOFF_RESTORED' |
    'HOST_HANDOFF_REVIEW' | 'HOST_HANDOFF_ADOPTED';
  pathInventory?: HostHandoffPathInventory;
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

/** Reads recorded status only. Does not authenticate a bundle or inspect current receiving state. */
export declare function inspectHostHandoffAdoption(input: {
  operationDirectory: string; expectedReviewSha256: string;
  /** Optional executable for reading the recorded operation; default /usr/bin/python3. */
  python?: string;
}): Promise<Record<string, unknown>>;
