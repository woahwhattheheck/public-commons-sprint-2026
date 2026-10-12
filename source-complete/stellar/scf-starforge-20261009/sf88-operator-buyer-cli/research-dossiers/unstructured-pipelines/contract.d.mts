export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type JobStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'STOPPED' | 'FAILED';
export type ProcessingStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'SUCCESS' | 'COMPLETED_WITH_ERRORS' | 'STOPPED' | 'FAILED';
export interface PipelineLimits {
  maxInputs: number; maxInputBytes: number; maxTotalInputBytes: number;
  maxRequestDataBytes: number; maxResponseBytes: number; maxOutputBytes: number; requestTimeoutMs: number;
}
export interface PipelineProfile {
  id: string; label?: string;
  requestData: JsonObject & ({ template_id: string; job_nodes?: never } | { template_id?: never; job_nodes: JsonObject[] });
}
export interface ProfileSummary {
  id: string; label: string; sha256: string; mode: 'template' | 'nodes';
  templateId?: string; nodeCount?: number;
}
export interface PipelineConfiguration {
  schema: 'stellar-forge.unstructured-pipelines-config.v1';
  account: string; apiUrl: string; apiKeyEnv: string;
  profiles: PipelineProfile[]; limits?: Partial<PipelineLimits>;
}
export interface SourceIdentity { account: string; apiUrl: string; configSha256: string }
export interface PipelineSource { identity: SourceIdentity; profiles: ProfileSummary[]; limits: PipelineLimits }
export interface NormalizedProfile {
  id: string; label: string; requestData: JsonObject; sha256: string; summary: ProfileSummary;
}
export interface NormalizedConfiguration {
  account: string; apiUrl: string; apiKeyEnv: string; configSha256: string;
  profiles: NormalizedProfile[]; limits: PipelineLimits;
}
export interface ProviderNodeFile {
  file_id: string; node_id: string; node_type: string; node_subtype: string;
  [key: string]: unknown;
}
export interface ProviderJob {
  id: string; workflow_id: string; workflow_name: string; status: JobStatus; created_at: string;
  runtime?: number | null; input_file_ids?: string[] | null; output_node_files?: ProviderNodeFile[] | null;
  job_type?: string | null; [key: string]: unknown;
}
export interface ProviderNodeDetails {
  ready: number; in_progress: number; success: number; failure: number;
  node_name?: string | null; node_type?: string | null; node_subtype?: string | null;
  [key: string]: unknown;
}
export interface ProviderDetails {
  id: string; processing_status: ProcessingStatus; node_stats: ProviderNodeDetails[];
  message?: string | null; [key: string]: unknown;
}
export interface PipelineOutputOption {
  fileId: string; nodeId: string | null; label: string;
  source: 'input_file_ids' | 'output_node_files';
}
export const CONFIG_SCHEMA: 'stellar-forge.unstructured-pipelines-config.v1';
export const PLAN_SCHEMA: 'stellar-forge.unstructured-pipelines-plan.v1';
export const STATE_SCHEMA: 'stellar-forge.unstructured-pipelines-operation.v1';
export const SDK_SOURCE: Readonly<{repository: string; commit: string; version: string; openapiVersion: string}>;
export const SERVICE_LIMITS: Readonly<{maxInputs: 10; maxInputBytes: 50000000; minimumLaunchIntervalMs: 1000; maxRunningJobs: 5}>;
export const DEFAULT_LIMITS: Readonly<PipelineLimits>;
export const JOB_STATUSES: readonly JobStatus[];
export const PROCESSING_STATUSES: readonly ProcessingStatus[];
export function text(value: unknown, code: string, max?: number): string;
export function requestId(value: unknown): string;
export function providerId(value: unknown): string;
export function operationId(value: unknown): string;
export function inputId(value: unknown): string;
export function outputId(value: unknown): string;
export function profileId(value: unknown): string;
export function canonical<T extends Json>(value: T): T;
export function boundedJson<T extends Json>(value: T, max: number, code?: string): T;
export function jsonDigest(value: Json): string;
export function normalizeApiUrl(value: unknown): string;
export function apiEndpoint(apiUrl: string, path: string, query?: Record<string, string | number | null | undefined>): string;
export function jobPath(id: string, suffix?: string): string;
export function normalizeLimits(value?: Partial<PipelineLimits>): PipelineLimits;
export function normalizeProfile(value: PipelineProfile, limits?: PipelineLimits): NormalizedProfile;
export function normalizeConfiguration(value: PipelineConfiguration): NormalizedConfiguration;
export function publicSource(value: NormalizedConfiguration): PipelineSource;
export function validateJob(value: unknown, expectedId?: string | null): ProviderJob;
export function validateDetails(value: unknown, expectedId: string): ProviderDetails;
export function phaseForJob(job: ProviderJob): 'ACTIVE' | 'COMPLETED' | 'STOPPED' | 'FAILED';
export function pipelineOutputOptions(job: ProviderJob | null | undefined): PipelineOutputOption[];
export function selectedOutput(job: ProviderJob, fileId: string, nodeId?: string | null): PipelineOutputOption;
