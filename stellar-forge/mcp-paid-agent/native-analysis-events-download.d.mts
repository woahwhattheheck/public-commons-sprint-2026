// SPDX-License-Identifier: MIT
import type {EventConnectionOptions, EventFileIdentity} from './native-analysis-events-client.mjs';
export interface EventDownloadIndex {
 schema: 'stellar-forge.analysis-event-downloads.v1';
 workspace_id: string;
 programme: string;
 delivery_id: string;
 accepted_operation_id: string;
 edition_id: string;
 review_sha256: string;
 workspace_programme_edition_id: string;
 workspace_programme_revision: number;
 files: Array<EventFileIdentity & {mime: string}>;
 index_sha256: string;
}
export interface EventDeliverySelection extends EventConnectionOptions {programme: string; deliveryId: string;}
export interface EventDeliveryDownloadOptions extends EventDeliverySelection {
 directory: string;
 expectedIndexSha256: string;
 chunkSize?: number;
 onProgress?: (progress: Record<string, unknown>) => unknown | Promise<unknown>;
}
export interface EventDeliveryDescription {
 workspaceId: string; programme: string; deliveryId: string; acceptedOperationId: string;
 selectedEditionId: string; reviewSha256: string; workspaceProgrammeEditionId: string;
 workspaceProgrammeRevision: number; indexSha256: string; workspaceArchiveSha256: string;
}
export function inspectNativeAnalysisEventDelivery(options: EventDeliverySelection): Promise<EventDeliveryDescription & {
 schema: 'stellar-forge.analysis-event-download.v1'; state: 'REVIEW'; analysisWorkspace: string;
 index: EventDownloadIndex; indexFile: EventFileIdentity;
}>;
export function downloadNativeAnalysisEventDelivery(options: EventDeliveryDownloadOptions): Promise<Record<string, unknown>>;
export function reopenNativeAnalysisEventDelivery(options: Omit<EventDeliveryDownloadOptions, 'client' | 'url' | 'tokenEnv' | 'environment' | 'chunkSize' | 'onProgress'>):
 Promise<EventDeliveryDescription & {schema: 'stellar-forge.analysis-event-download.v1'; state: 'COMPLETE';
 analysisWorkspace: string; directory: string; exportId: string; offline: true; resumed: true;
 resumedBytes: number; files: number; bytes: number; indexFile: string;}>;
export function main(argv?: string[]): Promise<number>;
