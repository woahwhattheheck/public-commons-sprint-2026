// MIT. Host-selected original n8n merchant operations.
import type { JsonObject, N8nPrepareRequest, N8nRenewRequest, N8nExportRequest, N8nFileRequest,
  N8nAgentStatus, N8nJobPage, N8nJobDetail, N8nExportPage, N8nManifestReply, N8nFileChunk,
  NativeJobHandoff, NativeJobRecord, N8nDispatchRecord } from
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/n8n/index.d.ts';
export const N8N_WORKSPACE_CONNECTION_SCHEMA: 'stellar-forge.n8n-workspace-connection.v1';
export interface N8nWorkspaceSelection { label: string; directory: string; sourceDirectory: string; }
export interface N8nWorkspaceConnection {
  schema: typeof N8N_WORKSPACE_CONNECTION_SCHEMA;
  selectionSha256: string;
  workspaces: Record<string, N8nWorkspaceSelection>;
}
export interface N8nWorkspaceConnectionInput {
  schema: typeof N8N_WORKSPACE_CONNECTION_SCHEMA;
  workspaces: Record<string, { label?: string; directory: string; sourceDirectory?: string }>;
}
export function readN8nWorkspaceConfiguration(path: string): Promise<N8nWorkspaceConnection>;
export interface N8nToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
}
export function n8nWorkspaceTools<T>(tool: (name: string, description: string,
  properties: Record<string, unknown>, required: string[], annotations: {
    readOnly?: boolean; destructive?: boolean; idempotent?: boolean; openWorld?: boolean;
  }) => T): T[];
export interface N8nWorkspaceSummary {
  configured: boolean;
  ownership: 'ORIGINAL_N8N_MERCHANT';
  workspaces: Array<{ workspace: string; label: string }>;
  activeCalls: number;
  activeFileReads: number;
  closing: boolean;
}
type Selected = { workspace: string };
type Reply<T> = T & Selected;
export interface N8nWorkspaceStatus extends Omit<N8nAgentStatus, 'services'>, Selected {
  services: Record<string, { configured: boolean; origin: string | null }>;
  launch: { instanceId: string; startedAt: string; configurationSha256: string; applicationSha256: string };
}
export class MerchantN8nWorkspaces {
  constructor(config: { n8nWorkspaces?: N8nWorkspaceConnection | null });
  readonly summary: N8nWorkspaceSummary;
  call(name: 'merchant_n8n_status', args: Selected): Promise<N8nWorkspaceStatus>;
  call(name: 'merchant_n8n_jobs', args: Selected & { cursor?: string; limit?: number; q?: string; status?: string }): Promise<Reply<N8nJobPage>>;
  call(name: 'merchant_n8n_job', args: Selected & { jobId: string }): Promise<Reply<N8nJobDetail>>;
  call(name: 'merchant_n8n_prepare', args: Selected & N8nPrepareRequest): Promise<Reply<NativeJobHandoff>>;
  call(name: 'merchant_n8n_renew', args: Selected & N8nRenewRequest): Promise<Reply<NativeJobHandoff>>;
  call(name: 'merchant_n8n_cancel' | 'merchant_n8n_retry', args: Selected & {
    jobId: string; expectedRevision: number; reason: string;
  }): Promise<Reply<NativeJobRecord>>;
  call(name: 'merchant_n8n_reconcile', args: Selected & {
    jobId: string; expectedRevision: number; reason: string; executionId?: string;
  }): Promise<Reply<N8nDispatchRecord>>;
  call(name: 'merchant_n8n_authorize_rerun', args: Selected & {
    jobId: string; expectedRevision: number; jobRevision: number; reason: string;
  }): Promise<Reply<{ job: NativeJobRecord; dispatch: N8nDispatchRecord }>>;
  call(name: 'merchant_n8n_export', args: Selected & N8nExportRequest): Promise<Reply<N8nManifestReply>>;
  call(name: 'merchant_n8n_exports', args: Selected & { cursor?: string; limit?: number; jobId?: string }): Promise<Reply<N8nExportPage>>;
  call(name: 'merchant_n8n_manifest', args: Selected & { exportId: string }): Promise<Reply<N8nManifestReply>>;
  call(name: 'merchant_n8n_file', args: Selected & N8nFileRequest): Promise<Reply<N8nFileChunk>>;
  call(name: 'merchant_n8n_file_release', args: Selected & { exportId: string; readId: string }): Promise<Reply<{ state: 'FILE_READ_RELEASED'; exportId: string; readId: string }>>;
  call(name: 'merchant_n8n_worker_start' | 'merchant_n8n_worker_stop', args: Selected): Promise<Reply<JsonObject>>;
  /** Drains adapter calls and temporary reads; the original merchant remains its owner. */
  close(): Promise<void>;
}
