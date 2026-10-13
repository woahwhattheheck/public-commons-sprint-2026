// SPDX-License-Identifier: MIT
import type {EventDeliveryDescription,EventDownloadIndex} from './native-analysis-events-download.mjs';
export interface EventInstallationSelection {
 analysisWorkspace?: string; programme?: string; deliveryId?: string; expectedIndexSha256?: string;
}
export interface EventInstallationOptions extends EventInstallationSelection {
 directory: string; sourceDirectory?: string; seedPath?: string; bindingsPath?: string; signal?: AbortSignal;
 onProgress?: (progress: Record<string,unknown>) => unknown | Promise<unknown>;
}
export interface EventInstallationResult {
 schema: 'stellar-forge.analysis-event-installation.v1'; state: 'PREPARED'; directory: string; offline: true;
 selection: Required<EventInstallationSelection>; eventIndex: EventDownloadIndex; workshareCaseId: string;
 requestSha256: string; installationSource: Record<string,unknown>; inputs: Array<{name:string;bytes:number;sha256:string}>;
 outputs: Array<{name:string;bytes:number;sha256:string}>; selections: Array<{field:string;purpose:string}>;
 implementation: Array<{title:string;result:string}>; requiredInputs: string[]; sourceFiles: Array<{path:string;blob:string}>;
 delivery: EventDeliveryDescription & Record<string,unknown>; preparationFile: string; preparationBytes: number; preparationSha256: string;
}
export function prepareNativeAnalysisEventInstallation(options:EventInstallationOptions):Promise<EventInstallationResult>;
export function reopenNativeAnalysisEventInstallation(options:EventInstallationSelection & {directory:string;signal?:AbortSignal}):Promise<EventInstallationResult>;
export function main(argv?:string[]):Promise<number>;
