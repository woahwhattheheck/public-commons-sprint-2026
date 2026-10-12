import type { Buffer } from 'node:buffer';
import type {
  Json, JsonObject, PipelineConfiguration, PipelineLimits, PipelineSource, SourceIdentity, ProfileSummary,
  ProviderJob, ProviderDetails, PipelineOutputOption, JobStatus,
} from './contract.mjs';
export type OperationPhase = 'PREPARED' | 'SUBMITTING' | 'SUBMISSION_UNKNOWN' | 'REJECTED' | 'ACTIVE' | 'COMPLETED' | 'STOPPED' | 'FAILED';
export type ActionKind = 'submit' | 'refresh' | 'cancel' | 'reconcile' | 'retain';
export interface PipelineInputSelection {
  path: string; filename: string; contentType?: string; sourceRef?: Json;
}
export interface PipelineInput {
  id: string; index: number; filename: string; contentType: string;
  bytes: number; sha256: string; file: string; sourceRef?: Json;
}
export interface PipelineOutput {
  id: string; providerJobId: string; fileId: string; nodeId: string | null;
  selectionSource: 'input_file_ids' | 'output_node_files'; label: string;
  bytes: number; sha256: string; contentType: string; receivedAt: string; receiptId: string; file: string;
}
export interface PipelinePlan {
  schema: 'stellar-forge.unstructured-pipelines-plan.v1'; id: string; sha256: string;
  requestSha256: string; preparedAt: string;
  payload: {
    request: { requestId: string; profileId: string; label: string; context: JsonObject };
    source: SourceIdentity; profile: ProfileSummary; inputs: PipelineInput[]; limits: PipelineLimits;
    providerContract: { repository: string; commit: string; version: string; openapiVersion: string };
  };
}
export interface PipelineError {
  code: string; action: string; at: string;
  status?: number; receiptId?: string; interrupted?: boolean;
}
export interface ActionResult {
  requestId: string; kind: ActionKind; status: 'COMPLETE'; appliedRevision: number;
  result: { outputId?: string }; error: PipelineError | null;
}
export interface PipelineOperation {
  schema: 'stellar-forge.unstructured-pipelines-operation.v1'; id: string; revision: number;
  phase: OperationPhase; providerJobId: string | null; job: ProviderJob | null; details: ProviderDetails | null;
  outputs: PipelineOutput[];
  cancel: null | {
    requestId: string; reason: string; requestedAt: string;
    status: 'ACKNOWLEDGED' | 'UNKNOWN' | 'REJECTED' | 'CONFIRMED'; receiptId: string | null; confirmedAt?: string;
  };
  reconciliation: null | { requestId: string; providerJobId: string; reason: string; selectedAt: string; receiptId: string };
  pendingCommandId: string | null;
  activeAction: null | { commandId: string; requestId: string; kind: ActionKind; startedAt: string };
  lastAction: null | { commandId: string; requestId: string; kind: ActionKind; finishedAt: string;
    result: { outputId?: string }; error: PipelineError | null };
  lastError: PipelineError | null; updatedAt: string;
  jobReceiptId: string | null; detailsReceiptId: string | null;
  jobObservedAt: string | null; detailsObservedAt: string | null;
}
export interface PipelineView {
  plan: PipelinePlan; operation: PipelineOperation; running: boolean; interrupted: boolean;
  sourceMatches: boolean; profileMatches: boolean; replayed?: boolean;
  outputOptions: PipelineOutputOption[]; actionResult?: ActionResult;
}
export interface ActionOptions { requestId: string; expectedRevision: number; signal?: AbortSignal }
export interface ReviewedActionOptions extends ActionOptions { expectedPlanSha256: string }
export interface PreparePipeline {
  requestId: string; profileId: string; label?: string; context?: JsonObject; inputs: PipelineInputSelection[];
}
export interface PipelineOperations {
  directory: string;
  source(): PipelineSource;
  prepare(request: PreparePipeline): Promise<PipelineView>;
  list(): Promise<PipelineView[]>;
  inspect(id: string): Promise<PipelineView>;
  readInput(id: string, inputId: string): Promise<{ body: Buffer; metadata: PipelineInput }>;
  readOutput(id: string, outputId: string): Promise<{ body: Buffer; metadata: PipelineOutput }>;
  submit(id: string, options: ReviewedActionOptions): Promise<PipelineView>;
  refresh(id: string, options: ActionOptions): Promise<PipelineView>;
  cancel(id: string, options: ActionOptions & { reason: string }): Promise<PipelineView>;
  reconcile(id: string, options: ReviewedActionOptions & { providerJobId: string; reason: string }): Promise<PipelineView>;
  retainOutput(id: string, options: ActionOptions & { fileId: string; nodeId?: string | null }): Promise<PipelineView>;
  listProviderJobs(id: string, options?: { workflowId?: string; status?: JobStatus; signal?: AbortSignal }): Promise<{
    jobs: ProviderJob[]; receiptId: string; receivedAt: string; workflowId: string | null; status: JobStatus | null;
  }>;
  close(): Promise<void>;
}
export function openPipelineOperations(options: {
  directory: string; configuration: PipelineConfiguration;
  env?: Record<string, string | undefined>; fetchImpl?: typeof globalThis.fetch;
}): Promise<PipelineOperations>;
