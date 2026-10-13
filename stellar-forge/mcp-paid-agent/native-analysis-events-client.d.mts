// SPDX-License-Identifier: MIT
export interface EventNativeClient {
 endpoint: string;
 analysisWorkspace: string;
 call(operation: string, request?: Record<string, unknown>, options?: {signal?: AbortSignal; requestSignal?: AbortSignal | null; timeoutMs?: number}): Promise<Record<string, unknown>>;
}
export interface EventConnectionOptions {
 url?: string;
 analysisWorkspace: string;
 tokenEnv?: string;
 environment?: Record<string, string | undefined>;
 signal?: AbortSignal;
 client?: EventNativeClient;
}
export interface EventFileIdentity {name: string; bytes: number; sha256: string;}
export interface EventInputOptions extends EventConnectionOptions {
 directory: string;
 expectedWorkspaceId: string;
 inputId: string;
 ndjsonPath?: string;
 manifestPath?: string;
 ndjsonName?: string;
 manifestName?: string;
 onProgress?: (progress: {inputId: string; kind: 'ndjson' | 'manifest'; received: number; bytes: number}) => unknown | Promise<unknown>;
}
export interface EventInputReceipt {
 schema: 'stellar-forge.analysis-event-input-receiving.v1';
 state: 'COMPLETE';
 analysisWorkspace: string;
 workspaceId: string;
 inputId: string;
 files: {ndjson: EventFileIdentity; manifest: EventFileIdentity};
 directory: string;
}
export interface EventRecordIdentity {
 schema: 'stellar-forge.analysis-event-record.v1';
 workspace_id: string;
 kind: 'overview' | 'programme' | 'action' | 'fields' | 'values';
 record_id: string;
 bytes: number;
 sha256: string;
}
export function openNativeAnalysisEventsClient(options: Omit<EventConnectionOptions, 'client'>): Promise<EventNativeClient>;
export function nativeEventConnection(options: EventConnectionOptions): Promise<EventNativeClient>;
export function receiveNativeAnalysisEventInput(options: EventInputOptions): Promise<EventInputReceipt>;
export function readNativeAnalysisEventRecord(options: EventConnectionOptions & {record: EventRecordIdentity}):
 Promise<{record: EventRecordIdentity; bytes: Uint8Array; text: string}>;

export interface EventPayloadSource {
 schema: 'stellar-forge.event-feed-payload-fields.v1' | 'stellar-forge.event-feed-payload-values.v1';
 workspace_id: string; input_id: string; edition_id: string; events: number;
 original_files: {ndjson: {bytes: number; sha256: string}; manifest: {bytes: number; sha256: string}};
 receiver: {cli_sha256: string; core_sha256: string};
}
export interface EventPayloadInspectionOptions extends EventConnectionOptions {
 inputId: string; expectedWorkspaceId: string;
}
export function inspectNativeAnalysisEventFields(options: EventPayloadInspectionOptions):
 Promise<{record: EventRecordIdentity; bytes: Uint8Array; text: string; value: EventPayloadSource & {field_count: number; fields: Array<Record<string, unknown>>}}>;
export function inspectNativeAnalysisEventFieldValues(options: EventPayloadInspectionOptions & {pointer: string; offset?: number; limit?: number}):
 Promise<{record: EventRecordIdentity; bytes: Uint8Array; text: string; value: EventPayloadSource & {pointer: string; offset: number; limit: number; total: number; next_offset: number | null; rows: Array<Record<string, unknown>>}}>;
