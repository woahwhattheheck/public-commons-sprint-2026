import type { Buffer } from 'node:buffer';
import type { PipelineConfiguration, JsonObject, JobStatus } from './contract.mjs';
export interface ProviderResponse {
  method: string; path: string; query: Record<string, string>;
  status: number; headers: Record<string, string>; body: Buffer;
  complete: boolean; receivedAt: string; completedAt: string;
}
export interface ProviderRequest {
  method?: string; path: string; query?: Record<string, string>;
  body?: FormData; maxBytes?: number; timeoutMs?: number;
}
export interface NetworkOptions { signal?: AbortSignal }
export interface ProviderListFilter { workflowId?: string; status?: JobStatus }
export interface ClientInput { body: Uint8Array; filename: string; contentType: string }
export interface PipelineClient {
  ready(): void;
  prepareCreate(requestData: JsonObject, inputs: ClientInput[]): ProviderRequest;
  request(spec: ProviderRequest, options?: NetworkOptions): Promise<ProviderResponse>;
  specForJob(id: string): ProviderRequest;
  specForDetails(id: string): ProviderRequest;
  specForCancel(id: string): ProviderRequest;
  specForList(filters?: ProviderListFilter): ProviderRequest;
  specForOutput(id: string, fileId: string, nodeId?: string | null): ProviderRequest;
  create(requestData: JsonObject, inputs: ClientInput[], options?: NetworkOptions): Promise<ProviderResponse>;
  getJob(id: string, options?: NetworkOptions): Promise<ProviderResponse>;
  getDetails(id: string, options?: NetworkOptions): Promise<ProviderResponse>;
  cancelJob(id: string, options?: NetworkOptions): Promise<ProviderResponse>;
  listJobs(filters?: ProviderListFilter, options?: NetworkOptions): Promise<ProviderResponse>;
  download(id: string, fileId: string, nodeId?: string | null, options?: NetworkOptions): Promise<ProviderResponse>;
}
export function createPipelineClient(options: {
  configuration: PipelineConfiguration; env?: Record<string, string | undefined>; fetchImpl?: typeof globalThis.fetch;
}): PipelineClient;
