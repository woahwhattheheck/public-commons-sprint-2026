/// <reference types="node" />
import type {SamActionPayloads, SamMutation, SamMutationEnvelope, SamWorkspaceView, SamGet,
  SamEdition, SamNotice, SamReview, SamChange, SamComparison, SamJson} from './workspace.mjs';
import type {SamConnectionView, SamNativeTask, SamNativeMerchantHost} from './connection.mjs';
import type {MerchantTool, MerchantToolFactory} from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';

export const SAM_MCP_CONNECTION_SCHEMA: 'stellar-forge.samgov-workspace-connection.v1';
export interface SamDeclaredInput {
  label?: string; kind: 'action' | 'packet';
  /** Private host-selected exact input; tools select its alias and SHA-256. */
  file: string; sha256: string;
}
export interface SamMerchantProfile {
  label?: string; origin: string; path: string; payment: Record<string, SamJson>;
  defaultLimit?: number; maxLimit?: number;
}
export interface SamWorkspaceHostEntry {
  label?: string; directory: string; workspaceId?: string;
  inputs?: Record<string, SamDeclaredInput>; merchants?: Record<string, SamMerchantProfile>;
}
export interface SamWorkspaceHostConfiguration {
  schema: typeof SAM_MCP_CONNECTION_SCHEMA; workspaces: Record<string, SamWorkspaceHostEntry>;
}
export interface SamConfiguredWorkspace {
  label: string; directory: string; connectionFile: string; workspaceId: string | null;
  inputs: Record<string, Required<SamDeclaredInput> & {bytes: number}>;
  merchants: Record<string, SamMerchantProfile & {label: string}>;
}
export interface SamReadConfiguration {
  workspaces: Record<string, SamConfiguredWorkspace>; configuration: string; sha256: string;
}
export interface SamMerchantConfiguration {
  exportsDirectory: string; samgovWorkspaces?: SamReadConfiguration | null;
  [otherProvider: string]: unknown;
}
export interface SamCollectionPage {offset: number; limit: number; total: number; nextOffset: number | null}
export interface SamPagedWorkspace extends SamWorkspaceView {
  /** Each collection retains a separate original total and next offset. */
  pages: Partial<Record<'queries' | 'captures' | 'editions' | 'selections' | 'sources' |
    'reviews' | 'changes' | 'handoffs' | 'publications' | 'history', SamCollectionPage>>;
}
export interface SamConnectedStatus extends SamConnectionView {
  workspace: string; state: 'CONNECTED'; native: SamPagedWorkspace;
  tasks: SamNativeTask[]; merchantHosts: SamNativeMerchantHost[];
}
export interface SamDisconnectedStatus {workspace: string; label: string; state: 'DISCONNECTED'}
export interface SamMcpSummary {
  configured: boolean; connected: string[]; pending: number; closing: boolean;
  activeFileReads: number; pendingFileCloses: number; snapshotBytes: number; immutableFileBytes: number;
}
export interface SamMcpInventory extends SamMcpSummary {
  workspaces: Array<{workspace: string; label: string; workspaceId: string | null;
    state: 'CONNECTED' | 'DISCONNECTED';
    inputs: Array<{sourceImport: string; label: string; kind: 'action' | 'packet'; sha256: string; bytes: number}>;
    merchants: Array<SamMerchantProfile & {profile: string; label: string}>}>;
}
export interface SamMcpMutation extends Omit<SamMutation, 'workspace'> {workspace: SamPagedWorkspace}
export type SamExportFormat = 'portable' | 'html' | 'markdown' | 'notices' | 'reviews' | 'changes' | 'sources';
export type SamExportSelection = {format: SamExportFormat} & (
  {revision: number; selectionId?: string; handoffId?: never} |
  {handoffId: string; revision?: never; selectionId?: never}
);
export interface SamRetainedExport {
  schema: 'stellar-forge.samgov-customer-export.v1'; exportId: string;
  intent: {workspace: string; directory: string; requestId: string; selection: SamExportSelection};
  requestSha256: string; workspaceId: string; filename: string; mediaType: string;
  bytes: number; sha256: string; capturedAt: string; completedAt: string; reused?: boolean;
}
export interface SamFileChunk {
  readId: string;
  file: {name: string; contentType: string; bytes: number; sha256: string};
  offset: number; bytesRead: number; nextOffset: number | null; encoding: 'base64'; data: string;
}
export interface SamScope {workspace: string}
export interface SamMcpNativeActions {
  merchant_samgov_save_query: 'save_query';
  merchant_samgov_create_capture: 'start_capture';
  merchant_samgov_resize_capture: 'resize_capture';
  merchant_samgov_save_selection: 'save_selection';
  merchant_samgov_review_notice: 'review_notice';
  merchant_samgov_review_change: 'review_change';
  merchant_samgov_create_handoff: 'create_handoff';
  merchant_samgov_capture_resources: 'capture_resources';
  merchant_samgov_buyer_review: 'buyer_review';
  merchant_samgov_buyer_prepare: 'prepare_buyer';
  merchant_samgov_prepare_opportunity: 'prepare_opportunity';
}
export type SamMcpNativeInputs = {
  [K in keyof SamMcpNativeActions]: SamScope & SamActionPayloads[SamMcpNativeActions[K]];
};
export type SamMcpToolInputs = SamMcpNativeInputs & {
  merchant_samgov_status: {workspace?: string; offset?: number; limit?: number};
  merchant_samgov_connect: SamScope & {expectedInstanceId?: string};
  merchant_samgov_disconnect: SamScope & {instanceId: string};
  merchant_samgov_browser: SamScope;
  merchant_samgov_record: SamScope & {id: string; offset?: number; limit?: number; search?: string};
  merchant_samgov_notice: SamScope & {editionId: string; noticeId: string};
  merchant_samgov_compare: SamScope & {beforeEditionId: string; afterEditionId: string};
  merchant_samgov_capture_run: SamScope & {captureId: string};
  merchant_samgov_capture_status: SamScope & {captureId: string};
  merchant_samgov_capture_pause: SamScope & {captureId: string};
  merchant_samgov_import: SamScope & SamMutationEnvelope & {sourceImport: string; expectedSourceSha256: string};
  merchant_samgov_receive: SamScope & {sourceImport: string; expectedSourceSha256: string};
  merchant_samgov_prepare_merchant: SamScope & SamMutationEnvelope & {selectionId: string; profile: string};
  merchant_samgov_merchant_start: SamScope & {publicationId: string; port?: number};
  merchant_samgov_merchant_stop: SamScope & {publicationId: string};
  merchant_samgov_export: SamScope & {requestId: string} & SamExportSelection;
  merchant_samgov_exports: SamScope & {offset?: number; limit?: number};
  merchant_samgov_file: SamScope & {kind: 'source' | 'export'; id: string;
    readId?: string; expectedSha256?: string; offset?: number; limit?: number};
  merchant_samgov_file_release: SamScope & {readId: string};
};
export type SamMcpToolOutputs = {[K in keyof SamMcpNativeActions]: SamMcpMutation} & {
  merchant_samgov_status: SamMcpInventory | SamConnectedStatus | SamDisconnectedStatus;
  merchant_samgov_connect: SamConnectedStatus;
  merchant_samgov_disconnect: {workspace: string; instanceId: string; state: 'DISCONNECTED'};
  merchant_samgov_browser: {workspace: string; instanceId: string; url: string};
  merchant_samgov_record: SamGet;
  merchant_samgov_notice: {edition: SamEdition; notice: SamNotice; reviews: SamReview[]; changes: SamChange[]};
  merchant_samgov_compare: SamComparison;
  merchant_samgov_capture_run: SamNativeTask;
  merchant_samgov_capture_status: SamNativeTask | {captureId: string; state: 'not_running'; retained: SamGet};
  merchant_samgov_capture_pause: {captureId: string; result: {captureId: string; active: boolean; pauseRequested: boolean} | null};
  merchant_samgov_import: SamMcpMutation;
  merchant_samgov_receive: {workspace: SamPagedWorkspace};
  merchant_samgov_prepare_merchant: SamMcpMutation;
  merchant_samgov_merchant_start: SamNativeMerchantHost;
  merchant_samgov_merchant_stop: SamNativeMerchantHost | {publicationId: string; state: 'not_running'; origin: null};
  merchant_samgov_export: SamRetainedExport;
  merchant_samgov_exports: SamCollectionPage & {exports: SamRetainedExport[]};
  merchant_samgov_file: SamFileChunk;
  merchant_samgov_file_release: {workspace: string; readId: string; released: true};
};
export type SamDeclaredSourceAction = {
  [K in 'import_notice' | 'import_capture' | 'retain_resource']:
    {action: K; payload: Omit<SamActionPayloads[K], keyof SamMutationEnvelope>};
}['import_notice' | 'import_capture' | 'retain_resource'];
export function readSamWorkspaceConfiguration(path: string): Promise<SamReadConfiguration>;
export class MerchantSamWorkspaces {
  constructor(config: SamMerchantConfiguration);
  get summary(): SamMcpSummary;
  call<K extends keyof SamMcpToolInputs>(name: K, args: SamMcpToolInputs[K]): Promise<SamMcpToolOutputs[K]>;
  /** Drains accepted calls and file reads. Applications keeps its original server owner. */
  close(): Promise<void>;
}
export function samgovWorkspaceTools(tool: MerchantToolFactory): MerchantTool[];
export interface SamMerchantSetup {
  directory: string; connection: string; name?: string;
}
