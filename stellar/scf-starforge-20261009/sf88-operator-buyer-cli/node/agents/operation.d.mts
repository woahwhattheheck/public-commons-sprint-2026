import type { Operation, Review, BuyerResult, OperationStatus, BuyerStreamSummary } from '../index.mjs';

export interface OperationBinding {
  readonly schema: 'stellar-forge.node-agent-binding.v1';
  readonly intentId: string;
  readonly operationDirectory: string;
  readonly configSha256: string;
  readonly bodySha256: string;
  readonly ticketSha256: string | null;
  /** Original native workspace, when adopted through Buyer.fromWorkspace. */
  readonly nativeWorkspace?: string | null;
}
export interface ResultSummary {
  intentId: string; nativeStatus: unknown; httpStatus: number | null; ok: boolean;
  exitCode: number | null; runtimeError: string | null; recoveredFromNativeOutput: boolean;
  recordedAt: string; deliveryStatus: string;
  file: { path: string; bytes: number; sha256: string; contentType: string | null } | null;
  stream: BuyerStreamSummary | null;
}
export type OutcomePhase = 'prepared' | 'awaiting_result' | 'result';
export interface OperationOutcome {
  binding: OperationBinding; phase: OutcomePhase; source: 'inspection' | 'recovered' | 'executed';
  operation: OperationStatus; result: BuyerResult | null;
}
export interface OutcomeSummary extends Omit<OperationOutcome, 'result'> { result: ResultSummary | null; }
export type ReadFormat = 'file' | 'json' | 'text' | 'base64' | 'csv' | 'sse' | 'ndjson';
export interface AgentReadOptions {
  format?: ReadFormat;
  /** Maximum bytes buffered for scalar data or selected records. Default 8 MiB. */
  limitBytes?: number;
  offset?: number;
  limitRecords?: number;
  allowPartial?: boolean;
  maxRecordBytes?: number;
  maxRecords?: number;
  headers?: boolean;
  binding?: OperationBinding | null;
  signal?: AbortSignal;
}
export interface ResponseArtifact {
  schema: 'stellar-forge.node-agent-artifact.v1'; binding: OperationBinding;
  result: ResultSummary; format: ReadFormat; partial: boolean;
  records: { total: number; offset: number; returned: number; nextOffset: number | null } | null;
  data: unknown;
}
export function summarizeResult(result: BuyerResult | null): ResultSummary | null;
export function summarizeOutcome(outcome: OperationOutcome): OutcomeSummary;
export class BuyerAgent {
  readonly operation: Operation;
  constructor(operation: Operation);
  binding(expected?: OperationBinding | null): Promise<OperationBinding>;
  review(options?: { binding?: OperationBinding | null }): Promise<Review>;
  savedReview(options?: { binding?: OperationBinding | null }): Promise<Review>;
  recover(options?: { binding?: OperationBinding | null }): Promise<OperationOutcome>;
  execute(options?: { review?: Review | null; binding?: OperationBinding | null; signal?: AbortSignal }): Promise<OperationOutcome>;
  read(options?: AgentReadOptions): Promise<ResponseArtifact>;
  saveAs(destination: string, options?: { binding?: OperationBinding | null; signal?: AbortSignal }):
    ReturnType<BuyerResult['saveAs']>;
}
