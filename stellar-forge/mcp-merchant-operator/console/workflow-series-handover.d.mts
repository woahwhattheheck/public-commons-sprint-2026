import type { OriginalConsole, CaptureInput, ReceivingInput, Handover, ProfileImport, ProfileArchive } from './workflow-series-client.mjs';
export declare const SERIES_HANDOVER_SELECTION: 'stellar-forge.merchant-workflow-handover-selection.v1';
export declare const SERIES_HANDOVER_SCHEMA: 'stellar-forge.merchant-workflow-handover.v1';
export declare function captureWorkflowSeriesHandover(client: OriginalConsole, input: CaptureInput): Promise<Handover>;
export declare function reopenWorkflowSeriesHandover(input: ReceivingInput): Promise<Handover>;
export declare function receiveWorkflowSeriesHandover(client: OriginalConsole, input: ReceivingInput): Promise<Handover & {
  imported: ProfileImport; workflowSeries: ProfileArchive['workflowSeriesData'] | null
}>;
