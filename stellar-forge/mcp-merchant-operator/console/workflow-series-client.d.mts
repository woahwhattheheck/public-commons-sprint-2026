export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Inputs = { [key: string]: Json };
export type Digest = string;
export interface ConsoleOptions {
  url: string;
  tokenEnv?: string;
  environment?: Record<string, string | undefined>;
  signal?: AbortSignal;
  maximumResponseBytes?: number;
}
export interface OriginalConsole {
  json<T = unknown>(route: string, body?: unknown): Promise<T>;
  response<T>(route: string, options: { body?: unknown; method?: string; signal?: AbortSignal; timeoutMs?: number },
    consume: (response: Response) => Promise<T>): Promise<T>;
  exportProfile(id: string): Promise<{ archive: ProfileArchive; bytes: Uint8Array; sha256: Digest }>;
  importProfile(archive: ProfileArchive): Promise<ProfileImport>;
  run(id: string): Promise<{ run: OriginalRun }>;
  waitRun(id: string, options?: WaitOptions): Promise<{ run: OriginalRun }>;
  close(): void;
}
export type Cadence = { unit: 'manual' } | { unit: 'day' | 'week' | 'month'; interval: number; anchorDate: string };
export interface CycleBinding {
  target: string;
  pointer: '/id' | '/runId' | '/key' | '/label' | '/period/start' | '/period/end' | '/dueDate' | '/sourceEdition' | '/reason';
}
export interface SeriesSave {
  requestId: string; id: string; profileId: string; expectedRevision?: number;
  name: string; customer: string; task: string; workflowId: string; workflowRevision: number;
  baseInputs?: Inputs; cycleBindings?: CycleBinding[]; cadence?: Cadence; enabled?: boolean;
}
export interface SeriesSummary {
  id: string; profileId: string; revision: number; name: string; customer: string; task: string;
  workflowId: string; workflowRevision: number; enabled: boolean; cadence: Cadence;
  updatedAt: string; contentSha256: Digest;
}
export interface SeriesDefinition extends SeriesSummary {
  schema: 'stellar-forge.merchant-workflow-series.v1';
  baseInputs: Inputs; cycleBindings: CycleBinding[]; workflowSha256: Digest;
  request: Required<SeriesSave>; requestSha256: Digest; workspaceId: string; createdAt: string;
}
export interface SeriesListItem extends SeriesSummary {
  cycles: number; complete: number; active: number; pending: number; nextDue: string | null;
}
export interface CycleRequest {
  seriesId: string; seriesRevision: number; key: string; label: string;
  period: { start: string; end: string }; dueDate: string; sourceEdition?: string; reason: string;
  previousCycleId?: string | null; inputs?: Inputs;
}
export interface CycleReview {
  schema: 'stellar-forge.merchant-workflow-series-review.v1'; kind: 'cycle' | 'start';
  cycleId: string; runId: string; profileId: string; seriesId: string; seriesRevision: number;
  seriesSha256: Digest; currentSeriesRevision: number; currentSeriesSha256: Digest;
  workflowId: string; workflowRevision: number; workflowSha256: Digest; profileRevision: number;
  hostFingerprint: Digest; requestSha256: Digest; inputsSha256: Digest; cycleSha256?: Digest;
  request: Required<CycleRequest>; inputs: Inputs; canStart: boolean; contentSha256: Digest;
  issues: Array<{ code: string; message: string; tool?: string; stepId?: string; pointer?: string }>;
  tools: Array<{ name: string; savedSha256: Digest; currentSha256: Digest | null; state: 'MATCH' | 'CHANGED' | 'MISSING' }>;
  steps: Array<{ id: string; name: string; tool: string; draftId: string; draftRevision: number;
    arguments: Inputs; bindings: Json[]; expect: Json[]; pauseAfter: boolean }>;
}
export interface CycleRecord {
  schema: 'stellar-forge.merchant-workflow-cycle.v1'; id: string; runId: string; profileId: string;
  seriesId: string; seriesRevision: number; seriesSha256: Digest; workflowId: string; workflowRevision: number;
  workflowSha256: Digest; request: Required<CycleRequest>; requestSha256: Digest; inputsJson: string;
  inputsSha256: Digest; review: CycleReview; workspaceId: string; createdAt: string; contentSha256: Digest;
}
export interface OriginalRun {
  id: string; profileId: string; workflowId: string; workflowRevision: number; revision: number;
  state: string; active: boolean; stepsComplete: number; stepCount: number; ownerWorkspaceId: string;
  executionHostFingerprint: Digest; steps: Array<{ id: string; state: string; callId: string; resolvedCallId?: string | null }>;
  [key: string]: unknown;
}
export interface CycleStatus {
  id: string; runId: string; seriesId: string; seriesRevision: number; key: string; label: string;
  period: { start: string; end: string }; dueDate: string; sourceEdition: string; reason: string;
  previousCycleId: string | null; state: string; active: boolean; stepsComplete: number;
  stepCount: number; completedAt: string | null; contentSha256: Digest;
}
export interface CycleView {
  cycle: CycleRecord; cancellation: { cycleId: string; requestId: string; reason: string; createdAt: string;
    workspaceId: string; contentSha256: Digest } | null;
  run: OriginalRun | null; series: SeriesDefinition; currentSeries: SeriesSummary; status: CycleStatus; reused?: boolean;
}
export interface SeriesPage {
  series: SeriesDefinition; revisions: SeriesSummary[]; cycles: CycleStatus[];
  total: number; offset: number; nextOffset: number | null;
}
export interface CalendarRequest { id: string; revision?: number; from: string; to: string; limit?: number }
export interface CalendarResult {
  seriesId: string; seriesRevision: number; manual: boolean; nextFrom: string | null;
  periods: Array<{ key: string; label: string; period: { start: string; end: string }; dueDate: string; existing: CycleStatus | null }>;
}
export interface AgendaRequest {
  profileId: string; from: string; to: string; today?: string; query?: string;
  status?: 'all' | 'open' | 'PROPOSED' | 'PLANNED' | 'READY' | 'RUNNING' | 'PAUSED' | 'WAITING' | 'COMPLETE' | 'CANCELLED';
  includeOverdue?: boolean; includeProposed?: boolean; offset?: number; limit?: number;
}
export interface AgendaItem {
  id: string; kind: 'saved' | 'proposed'; profileId: string; seriesId: string; seriesRevision: number;
  currentSeriesRevision: number; seriesName: string; customer: string; task: string; seriesEnabled: boolean;
  key: string; label: string; period: { start: string; end: string }; dueDate: string;
  sourceEdition: string; reason: string; runId: string | null; state: string; active: boolean;
  stepsComplete: number; stepCount: number | null; completedAt: string | null;
  nextAction: string; dueGroup: 'overdue' | 'today' | 'upcoming' | 'complete' | 'cancelled';
  contentSha256?: Digest; previousCycleId?: string | null;
}
export interface AgendaResult {
  schema: 'stellar-forge.merchant-workflow-agenda.v1'; profileId: string; generatedAt: string;
  query: Required<AgendaRequest>; items: AgendaItem[]; total: number; offset: number; nextOffset: number | null;
  counts: { total: number; saved: number; proposed: number; overdue: number; today: number;
    upcoming: number; complete: number; cancelled: number; active: number; attention: number };
}
export interface AgendaCalendar {
  filename: string; mediaType: 'text/calendar; charset=utf-8'; content: string;
  events: number; generatedAt: string; query: Required<AgendaRequest>;
}
export interface CyclePreparation {
  schema: 'stellar-forge.merchant-workflow-series-preparation.v1'; kind: 'cycle'; reused: false;
  action: { request: Required<CycleRequest>; expectedReviewSha256: Digest }; review: CycleReview;
  existing: CycleStatus | null; contentSha256: Digest;
}
export type StartPreparation = {
  schema: 'stellar-forge.merchant-workflow-series-preparation.v1'; kind: 'start'; reused: false;
  action: { id: string; expectedReviewSha256: Digest }; review: CycleReview;
  cycle: CycleRecord; run: null; contentSha256: Digest;
} | {
  schema: 'stellar-forge.merchant-workflow-series-preparation.v1'; kind: 'start'; reused: true;
  action: null; review: null; cycle: CycleRecord; run: OriginalRun; contentSha256: Digest;
};
export interface ProfileArchive {
  schema: 'stellar-forge.merchant-operator-profile.v1'; sourceWorkspaceId: string;
  profile: { id: string; revision: number; name: string; hostFingerprint: Digest; [key: string]: unknown };
  drafts: unknown[]; calls: unknown[]; deliveries: unknown[]; contentSha256: Digest;
  workflowData?: unknown; workflowRecipeData?: unknown;
  workflowSeriesData?: { schema: string; definitions: SeriesDefinition[]; cycles: CycleRecord[]; cancellations: unknown[] };
  [key: string]: unknown;
}
export interface ProfileImport { profile: ProfileArchive['profile']; reused: boolean; contentSha256: Digest }
export interface FileOutput { state: 'SAVED' | 'REOPENED'; path: string; bytes: number; sha256: Digest }
export interface CustomerFile { name: string; path: string; bytes: number; sha256: Digest; absolutePath?: string }
export interface HandoverManifest {
  schema: 'stellar-forge.merchant-workflow-handover.v1'; profileId: string; sourceWorkspaceId: string;
  selectionSha256: Digest; contentSha256: Digest;
  profile: { path: 'profile.json'; bytes: number; sha256: Digest; contentSha256: Digest };
  customers: Array<{ id: string; identity: unknown; identitySha256: Digest; files: CustomerFile[] }>;
  otherDeliveries: Array<{ id: string; state: string; sourceWorkspaceId: string; identity: unknown; reason: string }>;
  files: Array<{ path: string; bytes: number; sha256: Digest }>;
}
export interface Handover {
  state: 'REOPENED'; directory: string; profileId: string; contentSha256: Digest;
  manifest: HandoverManifest; profile: ProfileArchive;
  files: Array<{ path: string; bytes: number; sha256: Digest; absolutePath: string }>;
}
export interface CaptureInput { profileId: string; directory: string; deliveryIds?: string[] }
export interface ReceivingInput { directory: string }
export interface WaitOptions { timeoutMs?: number; pollMs?: number; signal?: AbortSignal }
export interface RunControl { id: string; expectedRevision: number }
export interface RunRecovery extends RunControl { stepId: string; callId: string; note: string }
export interface RunHandover extends RunControl { handoverId: string; workspaceId: string; hostFingerprint: Digest; note: string }
export declare const SERIES_PREPARATION_SCHEMA: 'stellar-forge.merchant-workflow-series-preparation.v1';
export declare function writeWorkflowSeriesFile(path: string, value: unknown): Promise<FileOutput>;
export declare function validateWorkflowSeriesPreparation(value: unknown): CyclePreparation | StartPreparation;
export declare class MerchantWorkflowSeriesClient {
  readonly console: OriginalConsole;
  constructor(options: ConsoleOptions);
  host(): Promise<Record<string, unknown>>;
  profiles(): Promise<unknown>;
  profile(id: string): Promise<unknown>;
  createProfile(input: unknown): Promise<unknown>;
  bindProfile(input: unknown): Promise<unknown>;
  list(profileId: string): Promise<{ series: SeriesListItem[]; limits: { inputBytes: number; requestBytes: number; calendarPeriods: number } }>;
  series(id: string, options?: { revision?: number; offset?: number; limit?: number }): Promise<SeriesPage>;
  saveSeries(input: SeriesSave): Promise<{ series: SeriesDefinition; currentSeries: SeriesSummary; reused: boolean }>;
  calendar(input: CalendarRequest): Promise<CalendarResult>;
  agenda(input: AgendaRequest): Promise<AgendaResult>;
  agendaCalendar(input: AgendaRequest): Promise<AgendaCalendar>;
  cycle(id: string): Promise<CycleView>;
  prepareCycle(input: CycleRequest): Promise<CyclePreparation>;
  saveCycle(input: CyclePreparation): Promise<CycleView>;
  prepareStart(id: string): Promise<StartPreparation>;
  startCycle(input: StartPreparation): Promise<CycleView>;
  cancelCycle(input: { id: string; requestId: string; reason: string }): Promise<CycleView>;
  run(id: string): Promise<{ run: OriginalRun }>;
  waitCycle(id: string, options?: WaitOptions): Promise<CycleView>;
  resume(input: RunControl): Promise<{ run: OriginalRun }>;
  pause(input: RunControl): Promise<{ run: OriginalRun }>;
  resolve(input: RunRecovery): Promise<{ run: OriginalRun }>;
  handover(input: RunHandover): Promise<{ run: OriginalRun }>;
  exportProfile(id: string): Promise<{ archive: ProfileArchive; bytes: Uint8Array; sha256: Digest }>;
  importProfile(archive: ProfileArchive): Promise<ProfileImport>;
  capture(input: CaptureInput): Promise<Handover>;
  receive(input: ReceivingInput): Promise<Handover & { imported: ProfileImport; workflowSeries: ProfileArchive['workflowSeriesData'] | null }>;
  close(): void;
}
