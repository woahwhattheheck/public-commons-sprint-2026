import type {
  CallerTask, TaskSelection, TaskPreview, TaskRecord, TaskInspection,
  InboxTask, ReceivedInboxTask, compareInboxTasks,
} from "../inbox-task.mjs";
import type { InboxJob, InboxReview, InboxResult, Inbox, InboxRpcResponse } from "../../index.mjs";

export type {
  CallerTask, TaskSelection, TaskRpcResultSelection, TaskPreview, TaskRecord, TaskInspection,
} from "../inbox-task.mjs";

export interface TaskDeskRequestOptions {
  signal?: AbortSignal;
}

export interface TaskDeskClientOptions {
  fetchImpl?: typeof globalThis.fetch;
  headers?: HeadersInit;
  csrfToken?: string;
}

export interface TaskDeskErrorBody {
  code: string;
  message: string;
  details?: unknown;
  nativeResult?: unknown;
}

export class TaskDeskError extends Error {
  readonly name: "TaskDeskError";
  readonly code: string;
  /** HTTP status when headers were received; zero when no response was available. */
  readonly status: number;
  readonly details?: unknown;
  readonly nativeResult?: unknown;
  /** Original caller-retained command identity, including ambiguous POST failures. */
  readonly requestId?: string;
  constructor(message: string, options?: {
    code?: string; status?: number; details?: unknown; nativeResult?: unknown; requestId?: string; cause?: unknown;
  });
  toJSON(): TaskDeskErrorBody & { name: "TaskDeskError"; status: number; requestId?: string };
}

export interface TaskDeskStatus {
  schema: "stellar-forge.inbox-task-desk.v1";
  title: string;
  instanceId: string;
  csrfToken: string;
  roots: { tasks: string; outputs: string; inbox: string;
    existingTask?: string; existingOutput?: string; commerce?: string; customerDelivery?: string };
  runningOperations: number;
  [key: string]: unknown;
}

export interface TaskDeskRpcSourceOptions extends TaskDeskRequestOptions {
  /** Original commerce session; omit to use the desk's configured --commerce root. */
  commerceDirectory?: string;
}
export interface TaskDeskRpcSelection {
  commerceDirectory?: string;
  readId: string;
  responseSha256: string;
}
export type TaskDeskRpcReads = Awaited<ReturnType<Inbox["rpcResponses"]>>;
export interface TaskDeskRpcResponse {
  intentId: string;
  job: InboxRpcResponse["job"];
  recovery: InboxRpcResponse["recovery"];
  delivery: InboxRpcResponse["delivery"];
  verified: Awaited<ReturnType<InboxRpcResponse["verify"]>>;
}

export interface TaskDeskDraft {
  task: CallerTask;
  selections: TaskSelection[];
  predecessorId?: string;
}

export interface TaskDeskCreateInput extends TaskDeskDraft {
  expectedPreviewSha256: TaskPreview["previewSha256"];
}

export type TaskDeskPacket = ReturnType<ReceivedInboxTask["toJSON"]>;
export type TaskDeskComparison = ReturnType<typeof compareInboxTasks>;
export type TaskDeskExecuteResult = Awaited<ReturnType<InboxTask["execute"]>>;
export type TaskDeskRecoverResult = Awaited<ReturnType<InboxTask["recover"]>>;

export interface TaskDeskTaskLocations {
  taskDirectory: string;
  outputDirectory: string;
  retained: boolean;
  mode: "desk" | "original-receiving" | "delivered-packet";
  /** Complete moved packets remain available through the packet GET routes. */
  receiveAllowed: boolean;
}

export interface TaskDeskListEntry {
  id: string;
  record: TaskRecord;
  summary?: { requests: number };
  locations?: TaskDeskTaskLocations;
}

export interface TaskDeskSavedTask {
  id: string;
  record: TaskRecord;
}

export interface TaskDeskTaskDetail extends TaskDeskSavedTask {
  inspection: TaskInspection | null;
  inspectionError?: TaskDeskErrorBody | null;
  packet?: TaskDeskPacket | null;
  packetError?: TaskDeskErrorBody | null;
  packetOpenedAt?: string | null;
  locations?: TaskDeskTaskLocations;
}

export type TaskDeskOperationKind = "execute" | "recover" | "receive";
export type TaskDeskOperationState = "queued" | "running" | "succeeded" | "failed" | "interrupted";

export interface TaskDeskOperationResultMap {
  execute: TaskDeskExecuteResult;
  recover: TaskDeskRecoverResult;
  receive: TaskDeskPacket;
}

export interface TaskDeskOperationCommon {
  /** The original command requestId, persisted before dispatch. */
  id: string;
  taskId: string;
  intentId: string | null;
  reviewId: string | null;
  /** Original directories selected when this command was accepted. */
  locations?: TaskDeskTaskLocations;
  state: TaskDeskOperationState;
  startedAt: string | null;
  finishedAt: string | null;
  error?: TaskDeskErrorBody | null;
  /** A journal-write issue retained separately from the completed native result. */
  persistenceError?: TaskDeskErrorBody;
}

export type TaskDeskOperation<K extends TaskDeskOperationKind = TaskDeskOperationKind> = {
  [P in K]: TaskDeskOperationCommon & {
    kind: P;
    result?: TaskDeskOperationResultMap[P] | null;
  }
}[K];

export interface TaskDeskOperationReply<K extends TaskDeskOperationKind = TaskDeskOperationKind> {
  operation: TaskDeskOperation<K>;
}

export interface TaskDeskWaitOptions extends TaskDeskRequestOptions {
  /** Delay between metadata reads; defaults to 1000 ms. */
  pollIntervalMs?: number;
  /** Zero, the default, waits until a terminal state or caller cancellation. */
  timeoutMs?: number;
}


export interface TaskDeskCustomerTaskIdentity {
  taskSha256: string; planSha256: string; system: string; id: string; revision: string;
}
export interface TaskDeskCustomerInspection {
  schema: string;
  task: TaskDeskCustomerTaskIdentity;
  intents: { intentId: string; role: string; jobId: string; nativeState: string;
    originalStatus: string | null; recoveredReadId: string | null; bytes: number; sha256: string }[];
}
export interface TaskDeskCustomerSelection {
  id: string; title: string; note: string; intentIds: string[];
  /** Complete source containing the executing native delivery reader; excludes private state. */
  sourceRoot: string;
  /** Original full source census stored outside sourceRoot. */
  sourceManifest: string;
}
export interface TaskDeskCustomerRequest extends TaskDeskCustomerSelection {
  kind: "inbox-task"; packetDirectory: string; expectedTaskSha256: string;
}
export interface TaskDeskCustomerPreview {
  schema: string; request: TaskDeskCustomerRequest; task: TaskDeskCustomerTaskIdentity;
  capture: { sha256: string; bytes: number; capturedAt: string };
  /** Original native outcome and any later recovered read stay separate in each row. */
  jobs: Record<string, unknown>[];
  packetFiles: { name: string; bytes: number; sha256: string }[];
  source: { sha256: string; files: number; bytes: number };
  previewSha256: string;
}
export interface TaskDeskCustomerPrepare {
  request: TaskDeskCustomerRequest; expectedPreviewSha256: string;
}
export interface TaskDeskCustomerPackage {
  filename: string; mediaType: "application/x-ndjson"; bytes: number; sha256: string; manifestSha256: string;
}
export interface TaskDeskCustomerDelivery {
  schema: string; id: string; state: "PREPARING" | "COMPLETE";
  request: TaskDeskCustomerRequest; previewSha256: string;
  package?: TaskDeskCustomerPackage; manifest?: Record<string, unknown>;
}
export interface TaskDeskCustomerHistory {
  deliveries: { id: string; title: string; createdAt: string; state: "PREPARING" | "COMPLETE";
    outputsComplete: boolean; package: TaskDeskCustomerPackage | null; taskSha256: string }[];
  issues: { id: string; code: string; message: string }[];
}
export interface TaskDeskCustomerSourceManifest {
  schema: "stellar-forge.sf88.customer-delivery-source.v1";
  files: { path: string; bytes: number; sha256: string }[];
  bytes: number; sha256: string;
}

/**
 * Original InboxTask desk transport. Every mutation is sent once.
 * Retained native result/error fields remain available even after HTTP success.
 */
export class TaskDeskClient {
  readonly baseUrl: string;
  constructor(baseUrl: string | URL, options?: TaskDeskClientOptions);
  clearSession(): void;
  getStatus(options?: TaskDeskRequestOptions): Promise<TaskDeskStatus>;
  listJobs(options?: TaskDeskRequestOptions): Promise<{
    jobs: InboxJob[];
    process: InboxResult["process"];
  }>;
  listRpcResponses(intentId: string, options?: TaskDeskRpcSourceOptions): Promise<TaskDeskRpcReads>;
  getRpcResponse(intentId: string, selection: TaskDeskRpcSelection, options?: TaskDeskRequestOptions): Promise<TaskDeskRpcResponse>;
  /** Streaming complete saved read; the caller consumes Response.body. */
  downloadRpcResponse(intentId: string, selection: TaskDeskRpcSelection, options?: TaskDeskRequestOptions): Promise<Response>;
  listTasks(options?: TaskDeskRequestOptions): Promise<{ tasks: TaskDeskListEntry[]; issues: { id: string; error: TaskDeskErrorBody }[] }>;
  previewTask(input: TaskDeskDraft, options?: TaskDeskRequestOptions): Promise<TaskPreview>;
  createTask(input: TaskDeskCreateInput, options?: TaskDeskRequestOptions): Promise<TaskDeskTaskDetail>;
  getTask(taskId: string, options?: TaskDeskRequestOptions): Promise<TaskDeskTaskDetail>;
  reviewTask(taskId: string, input: { intentId: string }, options?: TaskDeskRequestOptions): Promise<{
    reviewId: string; review: InboxReview;
  }>;
  executeTask(taskId: string, input: {
    intentId: string; reviewId: string; requestId: string;
  }, options?: TaskDeskRequestOptions): Promise<TaskDeskOperationReply<"execute">>;
  recoverTask(taskId: string, input: {
    intentId: string; requestId: string;
  }, options?: TaskDeskRequestOptions): Promise<TaskDeskOperationReply<"recover">>;
  receiveTask(taskId: string, input: {
    requestId: string;
  }, options?: TaskDeskRequestOptions): Promise<TaskDeskOperationReply<"receive">>;
  getOperation(operationId: string, options?: TaskDeskRequestOptions): Promise<TaskDeskOperationReply>;
  listOperations(options?: TaskDeskRequestOptions & { taskId?: string }): Promise<{
    operations: TaskDeskOperation[];
  }>;
  compareTask(taskId: string, previousId: string, options?: TaskDeskRequestOptions): Promise<TaskDeskComparison>;
  getPacket(taskId: string, options?: TaskDeskRequestOptions): Promise<TaskDeskPacket>;
  /** Complete clean report as HTML text. */
  getPacketReview(taskId: string, options?: TaskDeskRequestOptions): Promise<string>;
  /** Streaming received bytes for the original intent; caller consumes Response.body. */
  downloadIntentResponse(taskId: string, intentId: string, options?: TaskDeskRequestOptions): Promise<Response>;
  /** Streaming complete packet TAR; caller consumes Response.body. */
  downloadPacketArchive(taskId: string, options?: TaskDeskRequestOptions): Promise<Response>;
  inspectCustomerTask(taskId: string, options?: TaskDeskRequestOptions): Promise<TaskDeskCustomerInspection>;
  listCustomerDeliveries(taskId: string, options?: TaskDeskRequestOptions): Promise<TaskDeskCustomerHistory>;
  previewCustomerDelivery(taskId: string, input: TaskDeskCustomerSelection, options?: TaskDeskRequestOptions): Promise<TaskDeskCustomerPreview>;
  /** Same original delivery ID and exact preview request on continuation; no implicit retry. */
  prepareCustomerDelivery(taskId: string, input: TaskDeskCustomerPrepare, options?: TaskDeskRequestOptions): Promise<TaskDeskCustomerDelivery>;
  getCustomerDelivery(taskId: string, deliveryId: string, options?: TaskDeskRequestOptions): Promise<TaskDeskCustomerDelivery>;
  downloadCustomerDelivery(taskId: string, deliveryId: string, options?: TaskDeskRequestOptions): Promise<Response>;
  createCustomerSourceManifest(input: { sourceRoot: string; destination: string }, options?: TaskDeskRequestOptions): Promise<TaskDeskCustomerSourceManifest>;
  /**
   * Resolves at succeeded, failed or interrupted, retaining the original result/error.
   * Timeout and abort cancel only this polling wait, never native work.
   */
  waitForOperation(operationId: string, options?: TaskDeskWaitOptions): Promise<TaskDeskOperation>;
}
