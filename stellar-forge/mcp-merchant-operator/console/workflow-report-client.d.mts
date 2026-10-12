export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type Digest = string;
export interface ConsoleOptions {
  url: string; tokenEnv?: string; environment?: Record<string, string | undefined>;
  signal?: AbortSignal; maximumResponseBytes?: number;
}
export interface ReportSelection { runId: string; baselineRunId?: string | null }
export interface SavedReportSelection { runId: string; baselineRunId: string | null }
export type ReportSlot = { present: false } | { present: true; value: Json };
export interface ReportDifference {
  pointer: string; before: ReportSlot; after: ReportSlot; kind: 'ADDED' | 'REMOVED' | 'CHANGED';
}
export interface OriginalProfile {
  id: string; revision: number; name: string; hostFingerprint: Digest; createdAt: string; updatedAt: string;
  favorites: string[]; host: { configurationFingerprint: Digest; [key: string]: unknown };
  bindingRevision?: number; [key: string]: unknown;
}
export interface OriginalDraft {
  id: string; revision: number; profileId: string; name: string; tool: string;
  toolSchemaSha256: Digest; argumentsJson: string; argumentsSha256: Digest;
  createdAt: string; updatedAt: string; recoveryOf?: string; [key: string]: unknown;
}
export interface OriginalCall {
  id: string; profileId: string; draftId: string; draftRevision: number; tool: string;
  toolSchemaSha256: Digest; argumentsJson: string; argumentsSha256: Digest; requestSha256: Digest;
  workspaceId: string; hostFingerprint: Digest; state: 'RUNNING' | 'COMPLETE' | 'FAILED';
  startedAt: string; completedAt: string | null; resultJson: string | null; resultSha256: Digest | null;
  error: { code: string; message: string; [key: string]: unknown } | null; [key: string]: unknown;
}
export interface OriginalRun {
  id: string; profileId: string; workflowId: string; workflowRevision: number; workflowSha256: Digest;
  revision: number; state: string; workspaceId: string; ownerWorkspaceId: string;
  hostFingerprint: Digest; executionHostFingerprint: Digest; createdAt: string; updatedAt: string;
  completedAt: string | null; inputsJson: string;
  steps: Array<{ id: string; state: string; draftId: string; draftRevision: number | null;
    callId: string; resolvedCallId: string | null; [key: string]: unknown }>;
  events: Array<{ callId?: string; [key: string]: unknown }>; [key: string]: unknown;
}
export interface WorkflowDefinition {
  id: string; revision: number; profileId: string; name: string; contentSha256: Digest;
  steps: Array<{ id: string; name: string; draftId: string; draftRevision: number; [key: string]: unknown }>;
  [key: string]: unknown;
}
export interface ReportArchive {
  schema: 'stellar-forge.merchant-operator-profile.v1'; sourceWorkspaceId: string;
  profile: OriginalProfile; drafts: OriginalDraft[]; calls: OriginalCall[]; deliveries: unknown[];
  bindings?: unknown[];
  workflowData: { schema: string; definitions: WorkflowDefinition[]; runs: OriginalRun[] };
  workflowRecipeData?: { schema: string; installations: unknown[] };
  contentSha256: Digest;
}
export interface ReportRunSummary {
  id: string; name: string; profileId: string; workflowId: string; workflowRevision: number;
  workflowSha256: Digest; revision: number; state: string; error: unknown;
  createdAt: string; updatedAt: string; completedAt: string | null; recordedThrough: string;
  recordedDurationMs: number; recordedNativeDurationMs: number;
  completedSteps: number; recoveredSteps: number; stepCount: number;
  nativeCalls: number; completedNativeCalls: number; pendingNativeCalls: number; failedNativeCalls: number;
  workspaceId: string; ownerWorkspaceId: string; hostFingerprint: Digest; executionHostFingerprint: Digest;
  handover: unknown; eventCount: number; inputsSha256: Digest;
}
export type NativeOutcome = 'NOT_DISPATCHED' | 'PENDING' | 'FAILED' | 'NATIVE_ERROR' | 'RETURNED';
export interface ReportStepSnapshot {
  id: string; name: string; position: number; state: string; tool: string; toolSchemaSha256: Digest;
  contractDefinitionAvailable: boolean; resultSha256: Digest | null; argumentsSha256: Digest | null;
  draftId: string; draftRevision: number; bindings: unknown[]; expect: unknown[]; pauseAfter: boolean;
  callId: string | null; effectiveCallId: string | null; resolvedCallId: string | null;
  originalOutcome: NativeOutcome; outcome: NativeOutcome; resolutionNote: string | null;
  startedAt: string | null; completedAt: string | null; originalCallDurationMs: number | null;
  effectiveCallDurationMs: number | null; error: unknown;
  expectationResults: Array<{ condition: unknown; actual: ReportSlot; status: 'UNAVAILABLE' | 'MISSING' | 'PASS' | 'FAIL' }>;
  recoveries: Array<{ id: string; state: string; outcome: NativeOutcome; selected: boolean;
    startedAt: string; completedAt: string | null; durationMs: number | null }>;
}
export interface ReportStep {
  id: string; change: 'CURRENT' | 'ADDED' | 'REMOVED' | 'CHANGED' | 'UNCHANGED'; flags: string[];
  current: ReportStepSnapshot | null; baseline: ReportStepSnapshot | null;
  differences: Record<'nativeContract' | 'execution' | 'definition' | 'baseArguments' |
    'arguments' | 'effectiveArguments' | 'result', ReportDifference[]>;
  effectiveCallDurationDeltaMs: number | null;
}
export interface WorkflowReport {
  selection: SavedReportSelection; profile: { id: string; name: string };
  current: ReportRunSummary; baseline: ReportRunSummary | null;
  inputs: ReportDifference[]; context: ReportDifference[]; steps: ReportStep[];
  changes: { added: number; removed: number; changed: number; unchanged: number;
    recordedDurationDeltaMs: number; recordedNativeDurationDeltaMs: number } | null;
  source: { workspaceId: string; archiveSha256: Digest; drafts: number; calls: number;
    hostBindings: number; definitions: number; runs: number; recipeInstallations: number };
}
export interface WorkflowReportPacket {
  schema: 'stellar-forge.merchant-workflow-report.v1'; selection: SavedReportSelection;
  archive: ReportArchive; report: WorkflowReport; contentSha256: Digest;
}
export interface ReportReview {
  report: WorkflowReport; contentSha256: Digest; profile: OriginalProfile; sourceWorkspaceId: string;
  currentWorkspaceId: string; archiveSha256: Digest;
}
export interface RunReceipt { id: string; revision: number; state: string; ownerWorkspaceId?: string }
export interface ReportImport {
  profile: OriginalProfile; receivedProfile?: OriginalProfile; reused: boolean; merged?: boolean;
  contentSha256: Digest; reportSha256: Digest; selection: SavedReportSelection;
  run: RunReceipt; baseline: RunReceipt | null;
}
export interface ProfileView {
  profile: OriginalProfile; drafts: OriginalDraft[]; calls: unknown[]; deliveries: unknown[];
  bindings: unknown[]; hostBound: boolean; compositionBound: boolean | null;
}
export interface ListedWorkflowRun {
  id: string; profileId: string; workflowId: string; workflowRevision: number; revision: number;
  state: string; ownerWorkspaceId: string; executionHostFingerprint: Digest; active: boolean;
  stepsComplete: number; stepCount: number; inputsBytes: number; inputsSha256: Digest; eventCount: number;
  custody: 'OWNED' | 'RECEIVED_COPY'; steps: OriginalRun['steps']; [key: string]: unknown;
}
export interface WorkflowList {
  workflows: Array<{ id: string; profileId: string; name: string; revision: number;
    contentSha256: Digest; steps: number; updatedAt: string }>;
  runs: ListedWorkflowRun[];
}
export interface ReportHistory {
  selection: SavedReportSelection; profile: ProfileView; run: OriginalRun; baseline: OriginalRun | null;
}
export interface ReportReceiving { review: ReportReview; received: ReportImport; history: ReportHistory }
export interface ReportFile {
  name: 'report.json' | 'report.html' | 'steps.csv' | 'changes.csv';
  state: 'SAVED' | 'REOPENED'; path: string; bytes: number; sha256: Digest;
}
export interface ReportExports {
  state: 'REOPENED'; directory: string; profileId: string; selection: SavedReportSelection;
  contentSha256: Digest; archiveSha256: Digest; packet: WorkflowReportPacket; files: ReportFile[];
}
export interface OriginalConsole {
  json<T = unknown>(route: string, body?: unknown): Promise<T>;
  response<T>(route: string, options: { body?: unknown; method?: string; signal?: AbortSignal; timeoutMs?: number },
    consume: (response: Response) => Promise<T>): Promise<T>;
  close(): void;
}
export declare function readWorkflowReportFile(path: string): Promise<WorkflowReportPacket>;
export declare function writeWorkflowReportExports(input: { directory: string; packet: WorkflowReportPacket }): Promise<ReportExports>;
export declare function reopenWorkflowReportExports(input: { directory: string }): Promise<ReportExports>;
export declare class MerchantWorkflowReportClient {
  readonly console: OriginalConsole;
  constructor(options: ConsoleOptions);
  host(): Promise<Record<string, unknown>>;
  profiles(): Promise<{ profiles: OriginalProfile[]; host: Record<string, unknown> }>;
  profile(id: string): Promise<ProfileView>;
  workflows(profileId: string): Promise<WorkflowList>;
  run(id: string): Promise<{ run: OriginalRun }>;
  build(selection: ReportSelection): Promise<WorkflowReportPacket>;
  review(packet: WorkflowReportPacket): Promise<ReportReview>;
  history(selection: ReportSelection): Promise<ReportHistory>;
  receive(packet: WorkflowReportPacket, options?: { expectedContentSha256?: Digest }): Promise<ReportReceiving>;
  capture(input: ReportSelection & { directory: string }): Promise<ReportExports>;
  close(): void;
}
