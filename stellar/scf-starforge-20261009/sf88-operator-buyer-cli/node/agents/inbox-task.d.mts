import type { Inbox, InboxJob, InboxResult, InboxReview, InboxResponse, InboxRpcResponse, VerifiedFile } from '../index.mjs';

export interface CallerTask {
  system: string;
  id: string;
  revision: string;
  title: string;
  purpose: string;
  service: string;
}
export interface TaskRpcResultSelection {
  commerceDirectory: string;
  /** Original create-only recovery read directory identity. */
  readId: string;
  responseSha256: string;
}
export interface TaskSelection {
  intentId: string;
  role: string;
  sourceEdition?: string | null;
  /** Selected merchant/provider context; the native merchant configuration owns routing. */
  facilitator?: string | null;
  decisionRef?: string | null;
  reservationRef?: string | null;
  /** Exact separately timed result of this original settled request. */
  rpcResult?: TaskRpcResultSelection;
}
export type NormalizedTaskSelection = Required<Omit<TaskSelection, 'rpcResult'>> & Pick<TaskSelection, 'rpcResult'>;
export interface TaskPredecessor {
  taskSha256: string;
  system: string;
  id: string;
  revision: string;
}
export interface TaskEntry {
  selection: NormalizedTaskSelection;
  binding: {
    jobId: string; intentId: string; configSha256: string; bodySha256: string | null;
    ticketSha256: string | null; operationSha256: string;
    rpcResultSha256?: string;
  };
  request: InboxJob['operation'];
}
export interface TaskManifest {
  schema: 'stellar-forge.inbox-task.v1';
  task: CallerTask;
  inboxDirectory: string;
  predecessor: TaskPredecessor | null;
  entries: TaskEntry[];
}
export interface TaskRecord {
  schema: 'stellar-forge.inbox-task-record.v1';
  taskSha256: string;
  createdAt: string;
  manifest: TaskManifest;
}
export interface TaskInput {
  inbox: Inbox;
  task: CallerTask;
  selections: TaskSelection[];
  predecessor?: TaskPredecessor | null;
  signal?: AbortSignal;
}
export interface TaskPreview {
  previewSha256: string;
  manifest: TaskManifest;
  process: InboxResult['process'];
}
export interface TaskInspection {
  schema: 'stellar-forge.inbox-task-inspection.v1';
  taskSha256: string;
  task: CallerTask;
  entries: { selection: NormalizedTaskSelection; job: InboxJob; delivery: Record<string, unknown> | null }[];
  process: InboxResult['process'];
  savedResults: number;
  requiredResults: number;
}
export interface TaskOutputFile {
  intentId: string;
  path: string;
  bytes: number;
  sha256: string;
  contentType: string | null;
}
export interface TaskReceivingPlan {
  schema: 'stellar-forge.inbox-task-receiving.v1';
  createdAt: string;
  task: TaskRecord;
  jobs: InboxJob[];
  files: TaskOutputFile[];
}
export interface TaskPacket {
  schema: 'stellar-forge.inbox-task-packet.v1';
  taskSha256: string;
  planSha256: string;
  receivedAt: string;
  files: (TaskOutputFile | {path: string; bytes: number; sha256: string})[];
}
export function previewInboxTask(input: TaskInput): Promise<TaskPreview>;
export function createInboxTask(input: TaskInput & {
  directory: string; expectedPreviewSha256: string;
}): Promise<InboxTask>;
export function openInboxTask(input: {
  inbox: Inbox; directory: string; expectedTaskSha256?: string;
}): Promise<InboxTask>;

export class InboxTask {
  readonly inbox: Inbox;
  readonly directory: string;
  readonly record: TaskRecord;
  readonly taskSha256: string;
  readonly manifest: TaskManifest;
  constructor(inbox: Inbox, directory: string, record: TaskRecord);
  inspect(options?: {signal?: AbortSignal}): Promise<TaskInspection>;
  review(intentId: string, options?: {signal?: AbortSignal}): Promise<InboxReview>;
  execute(intentId: string, options: {review: InboxReview; workspaceDirectory?: string; signal?: AbortSignal}):
    Promise<{taskSha256: string; dispatched: false; job: InboxJob} |
      {taskSha256: string; dispatched: true; result: InboxResult<InboxJob>}>;
  recover(intentId: string, options?: {signal?: AbortSignal}):
    Promise<{taskSha256: string; result: InboxResult<InboxJob>}>;
  response(intentId: string, options?: {signal?: AbortSignal}): Promise<InboxResponse | InboxRpcResponse | null>;
  receive(options: {directory: string; signal?: AbortSignal}): Promise<ReceivedInboxTask>;
}
export function openInboxTaskPacket(input: {
  directory: string; expectedTaskSha256?: string; signal?: AbortSignal;
}): Promise<ReceivedInboxTask>;
export interface TaskNativeOutcome {
  intentId: string;
  state: string | null;
  responseStatus: string | null;
  httpStatus: number | null;
  nativeStatus: unknown;
  nativeError: unknown;
  lastError: unknown;
  evidenceError: unknown;
  responseCleanupError: unknown;
  recoveredResult?: {readId: string; source: 'SETTLED_RPC_RECOVERY_READ'; httpStatus: 200;
    httpStatusSource: 'ORIGINAL_RPC_RECOVERY_HTTP_200_CONTRACT'; recoveryReadStartedAt: string;
    responseObservedAt: string; publishedAt: string; transaction: string; bytes: number; sha256: string};
}
export class ReceivedInboxTask {
  readonly directory: string;
  readonly packet: TaskPacket;
  readonly plan: TaskReceivingPlan;
  readonly taskSha256: string;
  readonly task: CallerTask;
  readonly files: TaskOutputFile[];
  readonly outcomes: TaskNativeOutcome[];
  response(intentId: string): VerifiedFile;
  toJSON(): {schema: TaskPacket['schema']; directory: string; taskSha256: string;
    task: CallerTask; files: TaskOutputFile[]; outcomes: TaskNativeOutcome[]; report: string};
}
export function compareInboxTasks(previous: TaskRecord, next: TaskRecord): {
  previous: string; next: string;
  entries: { role: string; previousIntent: string | null; nextIntent: string; reusedOriginalIntent: boolean;
    sourceChanged: boolean; facilitatorChanged: boolean; requestChanged: boolean; resultChanged: boolean;
    previous: TaskEntry | null; next: TaskEntry }[];
  removedRoles: string[];
};
